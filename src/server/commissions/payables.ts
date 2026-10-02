import "server-only";
/**
 * Contas a Pagar (D13). Coleção `payables`, um título por comissão elegível (id determinístico pag_<commissionId>,
 * criado com createIfAbsent — varredura e handlers podem rodar em paralelo sem duplicar), além de títulos manuais do
 * Financeiro e do título negativo que registra o estorno de uma comissão já paga.
 *
 * Fluxo: previsto → aprovado → a_pagar → pago (cancelado a qualquer momento antes de pago). Pagar marca as comissões
 * do título como pagas NA MESMA TRANSAÇÃO; cancelar devolve as comissões para "Elegível" (liberada) com o motivo.
 * Toda operação grava o histórico no próprio título e emite evento com auditChanges (from → to) e motivo (D16).
 */
import { firestore } from "@/server/firebase-admin";
import { col, create, createIfAbsent, getById, getManyByIds, list, newId, ORG_ID, prepareNextNumber, txGetOwn, txNextNumber, txNextNumbers, nowIso, stripUndefined, update } from "@/server/db";
import { emitEvent } from "@/server/events";
import { getSetting } from "@/server/admin/queries";
import { SETTING_DEFAULTS, type ComissoesPagamentoConfig, type ContasAPagarConfig } from "@/server/admin/schemas";
import { auditChanges, describeChanges } from "@/server/audit";
import { dayInMonth } from "@/server/finance/billing";
import { dateKey, formatCurrency, formatDate } from "@/lib/format";
import { COMMISSION_REVENUE_LABELS, PAYABLE_CATEGORIES, PAYABLE_STATUS_LABELS, payableCategoryLabel } from "@/domain/commissions";
import { COLLECTIONS, type CashEntry, type Client, type Commission, type Document, type FinancialAccount, type Payable, type PayableHistoryEntry, type PayablePayment, type PayableRecurrence, type PayableStatus, type Supplier, type User, type UserRef } from "@/domain/types";
import { buildPayableCashEntry } from "@/domain/cash-entries";
import { resolveEffectiveCostCenter, roundCents } from "@/domain/finance-registry";
import { PARTIAL_COMMISSION_BLOCKED, isCommissionLinkedPayable, openAmount, originalAmountFor, payablePaidAmount, payablePaymentUndoBlock, planPayment, planSettleByPaid, planUndoPayment, residualDescription, residualNote, type PaymentMode } from "@/domain/settlements";
import { BusinessError } from "@/server/auth/error-classes";
import { ACCOUNT_REQUIRED_MESSAGE, emitCashEntryEvent, newCashEntryId, txCreateCashEntry, txDeleteCashEntry, txReadCashEntry, txReadPaymentAccount } from "@/server/finance-registry/cash-entries";
import { assignPayableCode, cleanPatch, deleteField, historyEntry, SYSTEM_ACTOR, transitionCommission } from "./store";
import { describeRepeat, planOccurrences, type RepeatInput } from "@/domain/title-repeat";
import { classificationLabel, ENGINE_ONLY_CATEGORY_KEYS, LEGACY_FALLBACK_CATEGORY } from "@/domain/title-classification";
import { legacyFieldsFor, loadClassificationContext, readPlannedAccount, resolveOrThrow, type ClassificationContext } from "@/server/finance-registry/classification";
import { applySeriesEdit, chunk, findPayableFutures, hasSettlement, PAYABLE_SERIES_FIELDS, payableSeriesSkip, payableSeriesUnavailable, SERIES_SKIP_COMMISSION, SERIES_SKIP_SETTLED, seriesEditFrom, seriesMatchOf, summarizeSkipped, type SeriesMatch } from "@/domain/title-series";

export async function getCommissionPaymentSettings(): Promise<ComissoesPagamentoConfig> {
  const value = await getSetting<ComissoesPagamentoConfig>("comissoes_pagamento", SETTING_DEFAULTS.comissoes_pagamento);
  const dia = Number(value.diaPagamento);
  return { diaPagamento: Number.isInteger(dia) && dia >= 1 && dia <= 28 ? dia : SETTING_DEFAULTS.comissoes_pagamento.diaPagamento };
}

/** Competência da elegibilidade e vencimento no dia configurado do mês seguinte. */
export function commissionPayableSchedule(eligibleAt: string, diaPagamento: number): { competence: string; dueDate: string } {
  const competence = dateKey(eligibleAt).slice(0, 7);
  return { competence, dueDate: dayInMonth(competence, 1, diaPagamento) };
}

function payableHistory(actor: UserRef, action: string, extra: Partial<PayableHistoryEntry> = {}, at?: string): PayableHistoryEntry {
  return cleanPatch({ at: at ?? nowIso(), by: actor.id, byName: actor.name, action, ...extra }) as unknown as PayableHistoryEntry;
}

const code = (p: Pick<Payable, "code" | "id">) => p.code ?? p.id;

// ---------------------------------------------------------------------------
// Geração a partir da comissão elegível
// ---------------------------------------------------------------------------

export interface EnsurePayableOptions {
  actor?: UserRef;
  emit?: boolean;
  /** Seed: datas do título na data da elegibilidade. */
  backfill?: boolean;
  settings?: ComissoesPagamentoConfig;
}

/**
 * Título da comissão elegível (idempotente): cria `pag_<commissionId>` (ou `_2`, `_3`… depois de um título cancelado)
 * e passa a comissão de "Elegível" para "Título gerado" em transação. Devolve null quando a comissão não está elegível.
 */
export async function ensurePayableForCommission(commission: Commission, options: EnsurePayableOptions = {}): Promise<{ payable: Payable; created: boolean } | null> {
  if (commission.status !== "liberada" || commission.payableId) return null;
  const actor = options.actor ?? SYSTEM_ACTOR;
  const settings = options.settings ?? (await getCommissionPaymentSettings());
  const attempt = (commission.previousPayableIds?.length ?? 0) + 1;
  const id = attempt === 1 ? `pag_${commission.id}` : `pag_${commission.id}_${attempt}`;
  const eligibleAt = commission.eligibleAt ?? commission.releaseAt ?? nowIso();
  const { competence, dueDate } = commissionPayableSchedule(eligibleAt, settings.diaPagamento);
  const [user, client] = await Promise.all([getById<User>(COLLECTIONS.users, commission.userId), getById<Client>(COLLECTIONS.clients, commission.clientId)]);
  const createdAt = options.backfill ? (eligibleAt < nowIso() ? eligibleAt : nowIso()) : nowIso();
  const description = [`Comissão ${commission.code ?? ""}`.trim(), COMMISSION_REVENUE_LABELS[commission.revenueType], commission.productName, client?.tradeName].filter(Boolean).join(" · ");
  const { created, doc } = await createIfAbsent<Payable>(COLLECTIONS.payables, id, {
    creditorType: "colaborador",
    creditorId: commission.userId,
    creditorName: user?.name ?? "Colaborador",
    category: "comissao_comercial",
    description,
    amount: commission.amount,
    competence,
    dueDate,
    status: "previsto",
    origin: "comissao_automatica",
    sourceIds: { commissionIds: [commission.id], contractId: commission.contractId, opportunityId: commission.opportunityId, saleNumber: commission.saleNumber, billingId: commission.billingId, clientId: commission.clientId },
    history: [payableHistory(actor, "Título gerado pela comissão elegível", { to: "previsto" }, createdAt)],
    createdBy: actor.id,
    createdAt,
    updatedAt: createdAt,
  });
  let payable = doc;
  if (created) payable = { ...doc, code: await assignPayableCode(id, createdAt) };
  const linked = await transitionCommission(commission.id, ["liberada"], (cur) => (cur.payableId ? null : { status: "titulo_gerado", payableId: id }), historyEntry(actor, "titulo_gerado", "liberada", `Título ${code(payable)} (vence ${formatDate(dueDate)})`, createdAt));
  if (created && options.emit !== false) {
    await emitEvent({
      type: "payable.created",
      actor,
      clientId: commission.clientId,
      entity: { type: "payable", id },
      title: `Título ${code(payable)} gerado: ${formatCurrency(payable.amount)} para ${payable.creditorName}`,
      description: `${description} · vence ${formatDate(dueDate)}`,
      department: "financeiro",
      payload: { payableId: id, code: payable.code, commissionIds: [commission.id], amount: payable.amount, dueDate, competence, creditorId: commission.userId, linked: Boolean(linked) },
      timeline: false,
    });
  }
  return { payable, created };
}

// ---------------------------------------------------------------------------
// Transições do título
// ---------------------------------------------------------------------------

async function loadPayable(id: string): Promise<Payable> {
  const p = await getById<Payable>(COLLECTIONS.payables, id);
  if (!p) throw new Error("Título não encontrado");
  return p;
}

/** Transição transacional do título (status atual precisa estar em `allowed`). */
async function transitionPayable(id: string, allowed: readonly PayableStatus[], patch: Partial<Payable>, entry: PayableHistoryEntry): Promise<{ before: Payable; after: Payable }> {
  const ref = col(COLLECTIONS.payables).doc(id);
  return firestore.runTransaction(async (tx) => {
    // Título de outra organização = inexistente (mesmo isolamento de getById).
    const snap = await txGetOwn(tx, ref);
    if (!snap) throw new Error("Título não encontrado");
    const before = { ...(snap.data() as Omit<Payable, "id">), id } as Payable;
    if (!allowed.includes(before.status)) throw new Error(`Título ${PAYABLE_STATUS_LABELS[before.status].toLowerCase()} não permite esta ação`);
    const data = cleanPatch({ ...patch, updatedAt: nowIso(), history: [...(before.history ?? []), entry] });
    tx.update(ref, data);
    return { before, after: { ...before, ...(data as Partial<Payable>) } };
  });
}

async function emitPayable(type: "payable.created" | "payable.approved" | "payable.scheduled" | "payable.paid" | "payable.cancelled" | "payable.updated" | "payable.payment_undone" | "payable.partially_paid" | "payable.settled_by_paid" | "payable.series_updated" | "payable.series_cancelled", actor: UserRef, p: Payable, title: string, payload: Record<string, unknown>, description?: string) {
  await emitEvent({
    type,
    actor,
    clientId: p.sourceIds.clientId,
    entity: { type: "payable", id: p.id },
    title,
    description,
    department: "financeiro",
    payload: { payableId: p.id, code: p.code, amount: p.amount, creditorId: p.creditorId, commissionIds: p.sourceIds.commissionIds, ...payload },
    timeline: false,
  });
}

export async function approvePayable(id: string, actor: UserRef, note?: string, options: { emit?: boolean; at?: string } = {}): Promise<Payable> {
  const at = options.at ?? nowIso();
  const { before, after } = await transitionPayable(id, ["previsto"], { status: "aprovado", approvedBy: actor.id, approvedAt: at }, payableHistory(actor, "Aprovado", { from: "previsto", to: "aprovado", reason: note }, at));
  if (options.emit !== false) await emitPayable("payable.approved", actor, after, `Título ${code(after)} aprovado (${formatCurrency(after.amount)})`, auditChanges<Payable>(before, after, ["status", "approvedBy"], note) as unknown as Record<string, unknown>, note);
  return after;
}

export async function schedulePayable(id: string, input: { dueDate?: string; note?: string }, actor: UserRef, options: { emit?: boolean; at?: string } = {}): Promise<Payable> {
  const at = options.at ?? nowIso();
  const current = await loadPayable(id);
  const dueDate = input.dueDate ? `${input.dueDate.slice(0, 10)}T12:00:00.000Z` : current.dueDate;
  const { before, after } = await transitionPayable(id, ["aprovado"], { status: "a_pagar", scheduledBy: actor.id, scheduledAt: at, dueDate }, payableHistory(actor, `Programado para ${formatDate(dueDate)}`, { from: "aprovado", to: "a_pagar", reason: input.note }, at));
  const audit = auditChanges<Payable>(before, after, ["status", "dueDate"], input.note);
  if (options.emit !== false) await emitPayable("payable.scheduled", actor, after, `Título ${code(after)} programado para ${formatDate(dueDate)}`, audit as unknown as Record<string, unknown>, describeChanges(audit, { status: "Situação", dueDate: "Vencimento" }));
  return after;
}

export interface PayPayableInput {
  paidAt: string;
  paymentMethod: string;
  receiptUrl?: string;
  notes?: string;
  /**
   * Conta financeira da baixa (etapa CP/CR 2). Com conta: a baixa entra em `payments[]` e o lançamento de DESPESA é
   * gravado na mesma transação. Opcional no serviço (seed e chamadores automáticos antigos seguem como antes, sem
   * lançamento); a action manual exige (`requireManualPaymentAccount`).
   */
  accountId?: string;
  /**
   * Valor da baixa (etapa CP/CR 3). Quitar: padrão = valor em aberto (sem baixas = valor do título, como antes); valor
   * diferente ajusta o valor do título para a soma das baixas (desconto/juros). Parcial e resíduo: obrigatório.
   */
  amount?: number;
  /** Motivo do ajuste de valor (desconto, juros, resíduo): vai para o histórico e a auditoria. */
  reason?: string;
}

export interface PayablePaymentResult {
  payable: Payable;
  commissionIds: string[];
  cashEntry?: CashEntry;
  /** Título "— Resíduo" criado na mesma transação (pagar parcialmente com resíduo). */
  residual?: Payable;
  /** A baixa quitou o título (status pago). */
  settled: boolean;
}

const brl = (v: number) => formatCurrency(v);

/**
 * Núcleo das baixas do título a pagar (etapas CP/CR 2 e 3) — UMA transação grava a baixa em `payments[]`, o lançamento
 * de caixa, o novo valor do título (Quitar com desconto/juros, resíduo), as comissões pagas (título de comissão, só
 * quitação integral) e, no modo resíduo, o título "— Resíduo" com o número PAG reservado no mesmo contador. Fluxo de
 * aprovação mantido: só título aprovado/a pagar recebe baixa; o status gravado continua até quitar.
 */
async function recordPayablePayment(mode: PaymentMode, id: string, input: PayPayableInput, actor: UserRef, options: { emit?: boolean; at?: string }): Promise<PayablePaymentResult> {
  const paidAt = `${input.paidAt.slice(0, 10)}T12:00:00.000Z`;
  const at = options.at ?? nowIso();
  const ref = col(COLLECTIONS.payables).doc(id);
  const accountId = input.accountId?.trim() || undefined;
  const cashEntryId = accountId ? newCashEntryId() : undefined;
  const reason = input.reason?.trim() || undefined;
  // Resíduo: id e numeração preparados fora; o número só é consumido se a transação gravar.
  const residualRef = mode === "residuo" ? col(COLLECTIONS.payables).doc() : null;
  const numbering = residualRef ? await prepareNextNumber("PAG", { pad: 5, year: dateKey(at).slice(0, 4), initFrom: { collection: COLLECTIONS.payables, field: "code" } }) : null;
  const result = await firestore.runTransaction(async (tx) => {
    // Título de outra organização = inexistente (mesmo isolamento de getById).
    const snap = await txGetOwn(tx, ref);
    if (!snap) throw new Error("Título não encontrado");
    const before = { ...(snap.data() as Omit<Payable, "id">), id } as Payable;
    if (before.status !== "aprovado" && before.status !== "a_pagar") throw new Error(before.status === "pago" ? "Este título já está pago" : "Aprove o título antes de pagar");
    const paidBefore = payablePaidAmount(before);
    const openBefore = openAmount(before.amount, paidBefore);
    // Título de comissão/bônus: só o pagamento integral existente (o valor segue a memória de cálculo da comissão).
    if (isCommissionLinkedPayable(before) && (mode !== "total" || (input.amount !== undefined && Math.round(input.amount * 100) !== Math.round(openBefore * 100)))) throw new BusinessError(PARTIAL_COMMISSION_BLOCKED);
    const plan = planPayment(mode, { amount: before.amount, paid: paidBefore }, input.amount);
    if (!plan.ok) throw new BusinessError(plan.error);
    const { payAmount, newAmount, amountChanged, settles, residualAmount } = plan.value;
    // Sem conta só o caminho antigo (quitação integral sem baixas anteriores: seed e chamadores automáticos).
    if (!accountId && (mode !== "total" || input.amount !== undefined || (before.payments?.length ?? 0) > 0)) throw new BusinessError(ACCOUNT_REQUIRED_MESSAGE);
    const commissionRefs = settles ? (before.sourceIds.commissionIds ?? []).map((cid) => col(COLLECTIONS.commissions).doc(cid)) : [];
    const commissionSnaps = commissionRefs.length > 0 ? await tx.getAll(...commissionRefs) : [];
    // Conta lida na transação (antes das escritas): existe na organização e está ativa.
    const account: FinancialAccount | null = accountId ? await txReadPaymentAccount(tx, accountId) : null;
    const number = numbering ? await txNextNumber(tx, numbering) : null;
    // ---- escritas
    const paymentId = cashEntryId ? `bx_${cashEntryId}` : undefined;
    const draft = account && paymentId ? buildPayableCashEntry(before, paymentId, { date: paidAt.slice(0, 10), amount: payAmount, accountId: account.id, actor }) : null;
    const payment: PayablePayment | undefined =
      draft && paymentId && cashEntryId ? (cleanPatch({ id: paymentId, date: paidAt.slice(0, 10), amount: payAmount, accountId: account!.id, transactionId: cashEntryId, method: input.paymentMethod, receiptUrl: input.receiptUrl, by: actor.id, byName: actor.name, at }) as unknown as PayablePayment) : undefined;
    const accountLabel = account ? ` · conta ${account.name}` : "";
    const residualCode = number?.code;
    const openAfter = settles ? 0 : openAmount(before.amount, paidBefore + payAmount);
    const action =
      mode === "residuo"
        ? `Pago com resíduo: ${brl(payAmount)} (${input.paymentMethod})${accountLabel} · resíduo ${residualCode} de ${brl(residualAmount)}`
        : mode === "parcial"
          ? settles
            ? `Pago (baixa parcial de ${brl(payAmount)} quitou o restante, ${input.paymentMethod})${accountLabel}`
            : `Baixa parcial de ${brl(payAmount)} (${input.paymentMethod})${accountLabel} · em aberto ${brl(openAfter)}`
          : `Pago (${input.paymentMethod})${accountLabel}${amountChanged ? ` · valor ajustado de ${brl(before.amount)} para ${brl(newAmount)}` : ""}${paidBefore ? ` · ${brl(payAmount)} nesta baixa` : ""}`;
    const historyChanges = amountChanged ? { amount: { from: before.amount, to: newAmount } } : undefined;
    const entry = payableHistory(actor, action, { from: before.status, to: settles ? "pago" : undefined, reason: reason ?? (mode === "total" ? input.notes : input.notes?.trim() || undefined), changes: historyChanges }, at);
    const patch = cleanPatch({
      ...(settles ? { status: "pago", paidAt, paidBy: actor.id, paymentMethod: input.paymentMethod, receiptUrl: input.receiptUrl } : {}),
      // Quitar mantém o comportamento anterior (observações da baixa no título); parcial/resíduo guardam só no histórico.
      ...(mode === "total" ? { notes: input.notes ?? before.notes } : {}),
      ...(payment ? { payments: [...(before.payments ?? []), payment] } : {}),
      ...(amountChanged ? { amount: newAmount, originalAmount: originalAmountFor(before) } : {}),
      ...(residualRef ? { residualId: residualRef.id } : {}),
      updatedAt: nowIso(),
      history: [...(before.history ?? []), entry],
    });
    tx.update(ref, patch);
    const cashEntry = draft && cashEntryId ? txCreateCashEntry(tx, cashEntryId, draft) : undefined;
    let residual: Payable | undefined;
    if (residualRef && number) {
      const now = nowIso();
      const data = stripUndefined({
        organizationId: ORG_ID,
        code: number.code,
        creditorType: before.creditorType,
        creditorId: before.creditorId,
        creditorName: before.creditorName,
        supplierId: before.supplierId,
        category: before.category,
        costCenter: before.costCenter,
        categoryId: before.categoryId,
        costCenterId: before.costCenterId,
        accountId: before.accountId,
        description: residualDescription(before.description),
        amount: residualAmount,
        competence: before.competence,
        dueDate: before.dueDate,
        // Decisão (etapa CP/CR 3): o resíduo herda o MESMO status de aprovação do original (aprovado/a pagar), porque o
        // valor já foi aprovado no título de origem; não volta para "Previsto".
        status: before.status,
        approvedBy: before.approvedBy,
        approvedAt: before.approvedAt,
        scheduledBy: before.scheduledBy,
        scheduledAt: before.scheduledAt,
        // Resíduo é sempre lançamento manual (nunca ocorrência da varredura recorrente nem comissão).
        origin: "manual",
        sourceIds: stripUndefined({ commissionIds: [], clientId: before.sourceIds?.clientId }),
        seriesId: before.seriesId,
        residualOf: before.id,
        notes: residualNote(before, payAmount, residualAmount),
        history: [payableHistory(actor, `Resíduo do título ${code(before)}: ${brl(residualAmount)} restantes`, { to: before.status, reason }, now)],
        createdBy: actor.id,
        createdAt: now,
        updatedAt: now,
      }) as Omit<Payable, "id">;
      tx.set(residualRef, data);
      number.commit();
      residual = { ...data, id: residualRef.id } as Payable;
    }
    const paidCommissions: string[] = [];
    for (const cs of commissionSnaps) {
      const c = cs.data() as Commission | undefined;
      if (!c || c.status !== "titulo_gerado" || c.payableId !== id) continue;
      tx.update(cs.ref, cleanPatch({ status: "paga", paidAt, updatedAt: nowIso(), history: [...(c.history ?? []), historyEntry(actor, "paga", "titulo_gerado", `Título ${code(before)} pago em ${formatDate(paidAt)}`, at)] }));
      paidCommissions.push(cs.id);
    }
    return { before, after: { ...before, ...(patch as Partial<Payable>) }, paidCommissions, cashEntry, accountName: account?.name, residual, settles, paidBefore, payAmount, openAfter };
  });
  const { before, after, paidCommissions, cashEntry, accountName, residual, settles, paidBefore, payAmount, openAfter } = result;
  if (options.emit !== false) {
    const tail = `${formatDate(paidAt)} · ${input.paymentMethod}${accountName ? ` · conta ${accountName}` : ""}${input.receiptUrl ? " · com comprovante" : ""}`;
    const money = { mode, paymentAmount: payAmount, accountId: cashEntry?.accountId ?? null, cashEntryId: cashEntry?.id ?? null, paymentId: cashEntry?.origin?.paymentId ?? null };
    if (settles) {
      const audit = auditChanges<Payable>(before, after, ["status", "paidAt", "paymentMethod", "receiptUrl", "amount"], reason ?? input.notes);
      if (mode === "residuo" && residual) audit.changes.residualCode = { from: null, to: residual.code ?? residual.id };
      const what = mode === "residuo" ? ` com resíduo (${brl(payAmount)} pagos; resíduo ${residual?.code} de ${brl(residual?.amount ?? 0)})` : "";
      await emitPayable("payable.paid", actor, after, `Título ${code(after)} pago${what}: ${brl(after.amount)} para ${after.creditorName}`, { ...audit, ...money, paidCommissionIds: paidCommissions }, tail);
    } else {
      const changes = { paidTotal: { from: paidBefore, to: roundCents(paidBefore + payAmount) }, openAmount: { from: openAmount(before.amount, paidBefore), to: openAfter } };
      await emitPayable("payable.partially_paid", actor, after, `Baixa parcial do título ${code(after)}: ${brl(payAmount)} (em aberto ${brl(openAfter)})`, { changes, ...(reason ? { reason } : {}), ...money }, tail);
    }
    if (cashEntry) await emitCashEntryEvent("cash_entry.created", actor, cashEntry, { accountName });
    if (residual) {
      await emitEvent({
        type: "payable.residual_created",
        actor,
        clientId: residual.sourceIds.clientId,
        entity: { type: "payable", id: residual.id },
        title: `Título ${residual.code} (resíduo de ${code(before)}): ${brl(residual.amount)} para ${residual.creditorName}`,
        description: residual.notes,
        department: "financeiro",
        payload: { payableId: residual.id, code: residual.code, amount: residual.amount, residualOf: before.id, originalCode: before.code ?? null, creditorId: residual.creditorId ?? null, changes: { residualAmount: { from: null, to: residual.amount }, status: { from: null, to: residual.status } }, ...(reason ? { reason } : {}) },
        timeline: false,
      });
    }
    for (const cid of paidCommissions) {
      const c = await getById<Commission>(COLLECTIONS.commissions, cid);
      if (!c) continue;
      await emitEvent({
        type: "commission.paid",
        actor,
        clientId: c.clientId,
        entity: { type: "commission", id: cid },
        title: `Comissão ${c.code ?? cid} paga: ${formatCurrency(c.amount)}`,
        description: `Título ${code(after)} · ${formatDate(paidAt)}`,
        department: "financeiro",
        payload: { commissionId: cid, userId: c.userId, amount: c.amount, payableId: id, contractId: c.contractId, changes: { status: { from: "titulo_gerado", to: "paga" } } },
        timeline: false,
      });
    }
  }
  return { payable: after, commissionIds: paidCommissions, cashEntry, residual, settled: settles };
}

/**
 * Quitar (total) — baixa do título + comissões pagas na mesma transação (commission.paid e payable.paid uma única vez).
 * Com conta, a mesma transação grava a baixa em `payments[]` (com o `transactionId`) e o lançamento de caixa. Valor da
 * baixa = em aberto (sem baixas anteriores = valor do título, como antes); valor informado diferente ajusta o valor do
 * título para a soma das baixas (desconto/juros, etapa CP/CR 3). O que já era gravado (paidAt, paidBy, paymentMethod,
 * receiptUrl, status pago, comissões pagas) continua igual.
 */
export async function payPayable(id: string, input: PayPayableInput, actor: UserRef, options: { emit?: boolean; at?: string } = {}): Promise<PayablePaymentResult> {
  return recordPayablePayment("total", id, input, actor, options);
}

/** Baixa parcial (etapa CP/CR 3): grava a baixa e mantém o valor; quando cobre o restante, o título fica pago. */
export async function partialPayPayable(id: string, input: PayPayableInput & { amount: number }, actor: UserRef, options: { emit?: boolean; at?: string } = {}): Promise<PayablePaymentResult> {
  return recordPayablePayment("parcial", id, input, actor, options);
}

/**
 * Pagar parcialmente com resíduo (etapa CP/CR 3): quita o original pelo total pago (valor := soma das baixas) e cria
 * "Descrição — Resíduo" com o restante (mesmo vencimento, classificação, credor, conta prevista, série e status de
 * aprovação), tudo na mesma transação.
 */
export async function payPayableWithResidual(id: string, input: PayPayableInput & { amount: number }, actor: UserRef, options: { emit?: boolean; at?: string } = {}): Promise<PayablePaymentResult> {
  return recordPayablePayment("residuo", id, input, actor, options);
}

/** Quitar pelo já pago (etapa CP/CR 3): valor := já pago, status pago, sem nova baixa nem lançamento. */
export async function settlePayableByPaid(id: string, input: { reason?: string }, actor: UserRef, options: { emit?: boolean } = {}): Promise<{ payable: Payable }> {
  const reason = input.reason?.trim() || undefined;
  const ref = col(COLLECTIONS.payables).doc(id);
  const result = await firestore.runTransaction(async (tx) => {
    const snap = await txGetOwn(tx, ref);
    if (!snap) throw new Error("Título não encontrado");
    const before = { ...(snap.data() as Omit<Payable, "id">), id } as Payable;
    if (before.status !== "aprovado" && before.status !== "a_pagar") throw new BusinessError(before.status === "pago" ? "Este título já está pago" : "Aprove o título antes de quitar");
    if (isCommissionLinkedPayable(before)) throw new BusinessError(PARTIAL_COMMISSION_BLOCKED);
    const paid = payablePaidAmount(before);
    const plan = planSettleByPaid({ amount: before.amount, paid, paymentsCount: before.payments?.length ?? 0 });
    if (!plan.ok) throw new BusinessError(plan.error);
    const last = before.payments![before.payments!.length - 1];
    const now = nowIso();
    const paidAt = `${last.date}T12:00:00.000Z`;
    const entry = payableHistory(actor, `Quitado pelo já pago: valor ajustado de ${brl(before.amount)} para ${brl(plan.value.newAmount)} (sem nova baixa)`, { from: before.status, to: "pago", reason, changes: { amount: { from: before.amount, to: plan.value.newAmount } } }, now);
    const patch = cleanPatch({ status: "pago", amount: plan.value.newAmount, originalAmount: originalAmountFor(before), paidAt, paidBy: actor.id, paymentMethod: last.method, receiptUrl: last.receiptUrl, updatedAt: now, history: [...(before.history ?? []), entry] });
    tx.update(ref, patch);
    return { before, after: { ...before, ...(patch as Partial<Payable>) } };
  });
  const { before, after } = result;
  if (options.emit !== false) {
    const audit = auditChanges<Payable>(before, after, ["status", "amount", "paidAt"], reason);
    await emitPayable("payable.settled_by_paid", actor, after, `Título ${code(after)} quitado pelo já pago: ${brl(after.amount)} (era ${brl(before.amount)})`, audit as unknown as Record<string, unknown>, reason ?? "Sem nova baixa nem lançamento de caixa");
  }
  return { payable: after };
}

/**
 * Desfazer UMA baixa (etapas CP/CR 2 e 3): remove a baixa indicada (ou a última), apaga o lançamento de caixa dela NA
 * MESMA transação, com motivo e auditoria. Título pago volta para "A pagar" e limpa paidAt/paidBy (e a forma/comprovante
 * da baixa desfeita); se a quitação tinha ajustado o valor (desconto/juros ou quitar pelo já pago) e não houve resíduo,
 * o valor volta ao original. Título ainda aberto com baixa parcial: só remove a baixa (o status continua). Título
 * antigo sem `payments[]` também desfaz (não há lançamento a apagar). Título de comissão/bônus/estorno NÃO desfaz por
 * aqui: o estorno da comissão é o caminho (não mexe no circuito de comissões).
 */
export async function undoPayablePayment(id: string, input: { reason: string; paymentId?: string }, actor: UserRef, options: { emit?: boolean } = {}): Promise<{ payable: Payable; cashEntryId?: string }> {
  const reason = input.reason.trim();
  if (reason.length < 5) throw new BusinessError("Descreva o motivo para desfazer o pagamento (mín. 5 caracteres)");
  const ref = col(COLLECTIONS.payables).doc(id);
  const result = await firestore.runTransaction(async (tx) => {
    const snap = await txGetOwn(tx, ref);
    if (!snap) throw new Error("Título não encontrado");
    const before = { ...(snap.data() as Omit<Payable, "id">), id } as Payable;
    const blocked = payablePaymentUndoBlock(before);
    if (blocked) throw new BusinessError(blocked);
    const plan = planUndoPayment({ settled: before.status === "pago", amount: before.amount, originalAmount: before.originalAmount, residualId: before.residualId, payments: before.payments }, input.paymentId);
    const payment = plan.payment;
    if (input.paymentId && !payment) throw new BusinessError("Baixa não encontrada neste título");
    const cashEntry = payment?.transactionId ? await txReadCashEntry(tx, payment.transactionId) : null;
    const now = nowIso();
    const restore = plan.restoreAmount;
    const label = plan.reopen ? `Pagamento desfeito${payment && (before.payments?.length ?? 0) > 1 ? ` (baixa de ${brl(payment.amount)})` : ""}` : `Baixa parcial de ${brl(payment?.amount ?? 0)} desfeita`;
    const patch: Record<string, unknown> = {
      ...(plan.reopen ? { status: "a_pagar", paidAt: deleteField(), paidBy: deleteField(), paymentMethod: deleteField(), receiptUrl: deleteField() } : {}),
      ...(payment ? { payments: plan.remaining.length ? plan.remaining : deleteField() } : {}),
      ...(restore !== undefined ? { amount: restore, originalAmount: deleteField() } : {}),
      updatedAt: now,
      history: [
        ...(before.history ?? []),
        payableHistory(actor, `${label}${cashEntry ? " · lançamento de caixa apagado" : ""}${restore !== undefined ? ` · valor volta para ${brl(restore)}` : ""}`, { ...(plan.reopen ? { from: "pago" as const, to: "a_pagar" as const } : {}), reason, ...(restore !== undefined ? { changes: { amount: { from: before.amount, to: restore } } } : {}) }, now),
      ],
    };
    tx.update(ref, patch);
    if (cashEntry) txDeleteCashEntry(tx, cashEntry.id);
    const after = { ...before } as Payable;
    if (plan.reopen) {
      after.status = "a_pagar";
      for (const k of ["paidAt", "paidBy", "paymentMethod", "receiptUrl"] as const) delete after[k];
    }
    if (payment) {
      if (plan.remaining.length) after.payments = plan.remaining;
      else delete after.payments;
    }
    if (restore !== undefined) {
      after.amount = restore;
      delete after.originalAmount;
    }
    after.history = patch.history as PayableHistoryEntry[];
    return { before, after, cashEntry, payment, reopen: plan.reopen };
  });
  const { before, after, cashEntry, payment, reopen } = result;
  if (options.emit !== false) {
    const audit = auditChanges<Payable>(before, after, ["status", "paidAt", "paymentMethod", "receiptUrl", "amount"], reason);
    if (!reopen && payment) {
      const paidBefore = payablePaidAmount(before);
      audit.changes.paidTotal = { from: paidBefore, to: roundCents(paidBefore - payment.amount) };
      audit.changes.openAmount = { from: openAmount(before.amount, paidBefore), to: openAmount(after.amount, paidBefore - payment.amount) };
    }
    const account = cashEntry ? await getById<FinancialAccount>(COLLECTIONS.financialAccounts, cashEntry.accountId) : null;
    const title = reopen ? `Pagamento do título ${code(after)} desfeito (${formatCurrency(payment?.amount ?? after.amount)})` : `Baixa parcial do título ${code(after)} desfeita (${formatCurrency(payment?.amount ?? 0)})`;
    await emitPayable("payable.payment_undone", actor, after, title, { ...audit, paymentId: payment?.id ?? null, cashEntryId: cashEntry?.id ?? null, accountId: cashEntry?.accountId ?? null }, `${reason}${cashEntry ? ` · lançamento de ${formatCurrency(cashEntry.amount)} apagado${account ? ` da conta ${account.name}` : ""}` : " · baixa antiga sem lançamento de caixa"}`);
    if (cashEntry) await emitCashEntryEvent("cash_entry.deleted", actor, cashEntry, { accountName: account?.name, reason: `Pagamento do título ${code(after)} desfeito: ${reason}` });
  }
  return { payable: after, cashEntryId: cashEntry?.id };
}

/** Cancela o título (antes de pago). Comissões ligadas voltam para "Elegível" com o motivo (novo título sob demanda). */
export async function cancelPayable(id: string, reason: string, actor: UserRef, options: { emit?: boolean } = {}): Promise<{ payable: Payable; commissionIds: string[] }> {
  const trimmed = reason.trim();
  if (trimmed.length < 5) throw new Error("Descreva o motivo do cancelamento");
  const ref = col(COLLECTIONS.payables).doc(id);
  const result = await firestore.runTransaction(async (tx) => {
    // Título de outra organização = inexistente (mesmo isolamento de getById).
    const snap = await txGetOwn(tx, ref);
    if (!snap) throw new Error("Título não encontrado");
    const before = { ...(snap.data() as Omit<Payable, "id">), id } as Payable;
    if (before.status === "pago") throw new Error("Título pago não pode ser cancelado: estorne a comissão");
    if (before.status === "cancelado") throw new Error("Este título já está cancelado");
    // Etapa CP/CR 3: título com baixa parcial tem dinheiro já saído da conta — desfaça as baixas antes de cancelar.
    if ((before.payments?.length ?? 0) > 0) throw new BusinessError("Este título tem baixa parcial registrada: desfaça as baixas (histórico de baixas) antes de cancelar, ou quite pelo já pago");
    const commissionRefs = before.origin === "comissao_automatica" ? (before.sourceIds.commissionIds ?? []).map((cid) => col(COLLECTIONS.commissions).doc(cid)) : [];
    const commissionSnaps = commissionRefs.length > 0 ? await tx.getAll(...commissionRefs) : [];
    const now = nowIso();
    const patch = cleanPatch({ status: "cancelado", cancelledAt: now, cancelledBy: actor.id, cancelReason: trimmed, updatedAt: now, history: [...(before.history ?? []), payableHistory(actor, "Cancelado", { from: before.status, to: "cancelado", reason: trimmed }, now)] });
    tx.update(ref, patch);
    const returned: string[] = [];
    for (const cs of commissionSnaps) {
      const c = cs.data() as Commission | undefined;
      if (!c || c.status !== "titulo_gerado" || c.payableId !== id) continue;
      tx.update(cs.ref, {
        status: "liberada",
        payableId: deleteField(),
        previousPayableIds: [...(c.previousPayableIds ?? []), id],
        updatedAt: now,
        history: [...(c.history ?? []), historyEntry(actor, "liberada", "titulo_gerado", `Título ${code(before)} cancelado: ${trimmed}`)],
      });
      returned.push(cs.id);
    }
    return { before, after: { ...before, ...(patch as Partial<Payable>) }, returned };
  });
  const { before, after, returned } = result;
  if (options.emit !== false) {
    const audit = auditChanges<Payable>(before, after, ["status"], trimmed);
    await emitPayable("payable.cancelled", actor, after, `Título ${code(after)} cancelado`, { ...audit, returnedCommissionIds: returned }, trimmed);
    for (const cid of returned) {
      await emitEvent({
        type: "commission.updated",
        actor,
        clientId: before.sourceIds.clientId,
        entity: { type: "commission", id: cid },
        title: `Comissão voltou para Elegível (título ${code(before)} cancelado)`,
        description: trimmed,
        department: "financeiro",
        payload: { commissionId: cid, payableId: id, changes: { status: { from: "titulo_gerado", to: "liberada" } }, reason: trimmed },
        timeline: false,
      });
    }
  }
  return { payable: after, commissionIds: returned };
}

export interface UpdatePayableInput {
  description?: string;
  dueDate?: string;
  amount?: number;
  notes?: string;
  costCenter?: string;
  /** Série recorrente: encerra a série nesta data (AAAA-MM-DD). */
  recurrenceUntil?: string;
  reason: string;
  // Etapa CP/CR 4 — ausente = mantém; "" = limpa.
  documentNumber?: string;
  /** Categoria/subcategoria de DESPESA do cadastro (não em título de comissão/bônus/estorno). */
  categoryId?: string;
  costCenterId?: string;
  accountId?: string;
  // Etapa CP/CR 5 — credor (só título manual; ausente = mantém): colaborador do cadastro, fornecedor cadastrado ou
  // nome livre. Vai para os futuros na edição em série.
  creditorType?: "colaborador" | "fornecedor";
  creditorId?: string;
  supplierId?: string;
  creditorName?: string;
}

/** Plano de uma alteração (validado): patch, o que gravar (campos limpos viram FieldValue.delete) e a auditoria legível. */
interface PayableUpdatePlan {
  reason: string;
  patch: Partial<Payable>;
  writePatch: Record<string, unknown>;
  /** Mudanças legíveis (nomes, nunca ids). */
  readable: Record<string, { from: unknown; to: unknown }>;
  changes: ReturnType<typeof auditChanges>;
  registry: ClassificationContext | null;
}

/** Campos que a alteração pode LIMPAR (FieldValue.delete em vez de gravar undefined). */
const PAYABLE_CLEARABLE = ["documentNumber", "categoryId", "costCenterId", "accountId", "creditorId", "supplierId"] as const;
const PAYABLE_UPDATE_FIELDS = ["description", "dueDate", "amount", "notes", "costCenter", "recurrence", "category", "documentNumber", "categoryId", "costCenterId", "accountId", "creditorName", "creditorType"] as const;
const PAYABLE_DESCRIBE_LABELS: Record<string, string> = { description: "Descrição", dueDate: "Vencimento", amount: "Valor", notes: "Observações", costCenter: "Centro de custo", recurrence: "Recorrência", category: "Categoria (configuração)", documentNumber: "Nº do documento", categoryName: "Categoria", subcategoryName: "Subcategoria", costCenterName: "Centro de custo (cadastro)", plannedAccountName: "Conta prevista", creditorName: "Credor", creditorType: "Tipo de credor", competence: "Competência" };
const describePayableValue = (field: string, v: unknown) => (v === null ? "—" : field === "amount" ? formatCurrency(Number(v)) : field === "dueDate" ? formatDate(String(v)) : field === "category" ? payableCategoryLabel(String(v)) : typeof v === "object" ? JSON.stringify(v) : String(v));

/** Credor novo do título (etapa CP/CR 5): valida colaborador/fornecedor como no lançamento manual. */
async function resolveCreditorChange(current: Payable, input: UpdatePayableInput): Promise<Partial<Payable> | null> {
  if (input.creditorType === undefined && input.creditorId === undefined && input.supplierId === undefined && input.creditorName === undefined) return null;
  const type = input.creditorType ?? current.creditorType;
  let next: Pick<Payable, "creditorType" | "creditorId" | "creditorName" | "supplierId">;
  if (type === "colaborador") {
    const userId = input.creditorId ?? current.creditorId;
    const user = userId ? await getById<User>(COLLECTIONS.users, userId) : null;
    if (!user) throw new BusinessError("Selecione o colaborador");
    next = { creditorType: "colaborador", creditorId: user.id, creditorName: user.name, supplierId: undefined };
  } else if (input.supplierId) {
    const supplier = await getById<Supplier>(COLLECTIONS.suppliers, input.supplierId);
    if (!supplier) throw new BusinessError("Fornecedor não encontrado");
    if (supplier.active === false && supplier.id !== current.supplierId) throw new BusinessError(`O fornecedor ${supplier.name} está inativo`);
    next = { creditorType: "fornecedor", creditorId: undefined, creditorName: supplier.name, supplierId: supplier.id };
  } else {
    const name = (input.creditorName ?? (input.supplierId === "" ? "" : current.creditorName)).trim();
    if (name.length < 2) throw new BusinessError("Informe o credor");
    next = { creditorType: "fornecedor", creditorId: undefined, creditorName: name, supplierId: undefined };
  }
  const changed = next.creditorType !== current.creditorType || (next.creditorId ?? null) !== (current.creditorId ?? null) || next.creditorName !== current.creditorName || (next.supplierId ?? null) !== (current.supplierId ?? null);
  if (!changed) return null;
  if (isCommissionLinkedPayable(current)) throw new BusinessError("O credor de título de comissão/bônus/estorno segue o motor de comissões e não muda por aqui");
  return next;
}

/**
 * Valida e monta a alteração de UM título (regras de quem edita o quê): valor só em título manual ainda não aprovado;
 * categoria de comissão/bônus/estorno segue o motor; conta prevista nova ativa; classificação nova validada. Null = nada
 * mudou.
 */
async function planPayableUpdate(current: Payable, input: UpdatePayableInput): Promise<PayableUpdatePlan | null> {
  const reason = input.reason.trim();
  if (reason.length < 5) throw new Error("Informe o motivo da alteração");
  if (current.status === "pago" || current.status === "cancelado") throw new Error("Título pago ou cancelado não pode ser alterado");
  if (input.amount !== undefined && input.amount !== current.amount && (current.origin !== "manual" || current.status !== "previsto")) throw new Error("O valor só pode ser alterado em título manual ainda previsto (o de comissão segue a memória de cálculo)");
  const keep = (value: string | undefined, currentValue: string | undefined) => (value === undefined ? currentValue : value.trim() || undefined);
  const nextCategoryId = keep(input.categoryId, current.categoryId);
  if (nextCategoryId !== current.categoryId && isCommissionLinkedPayable(current)) throw new BusinessError("A categoria de título de comissão/bônus/estorno segue o motor de comissões e não muda por aqui");
  const nextCenterId = keep(input.costCenterId, current.costCenterId);
  const nextAccountId = keep(input.accountId, current.accountId);
  const creditor = await resolveCreditorChange(current, input);
  const classificationChanged = nextCategoryId !== current.categoryId || nextCenterId !== current.costCenterId;
  const registry = classificationChanged || current.categoryId || current.costCenterId ? await loadClassificationContext() : null;
  // Valida só o que mudou (um cadastro arquivado depois de gravado não impede alterar outros campos do título).
  const resolved = registry && classificationChanged ? resolveOrThrow({ categoryId: nextCategoryId, costCenterId: nextCenterId }, "despesa", registry) : null;
  const legacy = resolved && registry ? legacyFieldsFor(resolved, registry) : {};
  // Conta prevista nova: precisa existir e estar ativa (a que já estava gravada não é revalidada).
  if (nextAccountId !== current.accountId) await readPlannedAccount(nextAccountId);
  const patch: Partial<Payable> = {
    description: input.description?.trim() || current.description,
    dueDate: input.dueDate ? `${input.dueDate.slice(0, 10)}T12:00:00.000Z` : current.dueDate,
    amount: input.amount ?? current.amount,
    notes: input.notes?.trim() || current.notes,
    // Centro antigo: o do cadastro (derivado) quando a classificação mudou; senão o informado no select antigo.
    costCenter: legacy.costCenter ?? (input.costCenter?.trim() || current.costCenter),
    documentNumber: keep(input.documentNumber, current.documentNumber),
    categoryId: nextCategoryId,
    costCenterId: nextCenterId,
    accountId: nextAccountId,
    ...(creditor ?? {}),
  };
  // Chave antiga da categoria acompanha a categoria do cadastro (títulos de comissão nunca chegam aqui com mudança).
  if (legacy.category && !isCommissionLinkedPayable(current)) patch.category = legacy.category;
  if (input.recurrenceUntil && current.recurrence) patch.recurrence = { ...current.recurrence, until: input.recurrenceUntil.slice(0, 10) };
  const audit = auditChanges<Payable>(current, { ...current, ...patch }, [...PAYABLE_UPDATE_FIELDS], reason);
  const writePatch: Record<string, unknown> = { ...patch };
  const touched = Object.keys(audit.changes).length > 0 || (creditor !== null && ((patch.creditorId ?? null) !== (current.creditorId ?? null) || (patch.supplierId ?? null) !== (current.supplierId ?? null)));
  if (!touched) return null;
  // Ids viram nomes legíveis na auditoria (categoria/subcategoria, centro, conta prevista).
  const names = await registryNames(registry, [current.accountId, nextAccountId]);
  const readable = readablePayableChanges(audit.changes, names);
  // Campos limpos ("") saem do documento (FieldValue.delete) em vez de gravar undefined.
  for (const k of PAYABLE_CLEARABLE) if (patch[k] === undefined && current[k] !== undefined) writePatch[k] = deleteField();
  return { reason, patch, writePatch, readable, changes: { ...audit, changes: readable }, registry };
}

/** Mudanças com ids trocados por nomes (categoria/subcategoria, centro, conta prevista). */
function readablePayableChanges(changes: Record<string, { from: unknown; to: unknown }>, names: Awaited<ReturnType<typeof registryNames>>): Record<string, { from: unknown; to: unknown }> {
  const readable: Record<string, { from: unknown; to: unknown }> = {};
  for (const [k, c] of Object.entries(changes)) {
    if (k === "categoryId") {
      const from = names.category(c.from as string | null);
      const to = names.category(c.to as string | null);
      if (from.category !== to.category) readable.categoryName = { from: from.category ?? null, to: to.category ?? null };
      if (from.subcategory !== to.subcategory) readable.subcategoryName = { from: from.subcategory ?? null, to: to.subcategory ?? null };
    } else if (k === "costCenterId") readable.costCenterName = { from: names.center(c.from as string | null), to: names.center(c.to as string | null) };
    else if (k === "accountId") readable.plannedAccountName = { from: names.account(c.from as string | null), to: names.account(c.to as string | null) };
    else readable[k] = c;
  }
  return readable;
}

/** Remove do objeto em memória os campos limpos (o Firestore já os apagou). */
function dropCleared(after: Payable, patch: Partial<Payable>): Payable {
  for (const k of PAYABLE_CLEARABLE) if (patch[k] === undefined) delete (after as unknown as Record<string, unknown>)[k];
  return after;
}

/**
 * Alteração manual do título (auditada): valor só em título manual ainda não aprovado. Etapa CP/CR 4: também nº do
 * documento, centro → categoria → subcategoria do cadastro e conta prevista (ausente = mantém; "" = limpa). A categoria
 * de título de comissão/bônus/estorno segue o motor (não muda); os campos antigos `category`/`costCenter` acompanham o
 * cadastro escolhido (derivados), sem apagar o que estava gravado quando a classificação é limpa. Etapa CP/CR 5: também
 * o credor (só título manual).
 */
export async function updatePayable(id: string, input: UpdatePayableInput, actor: UserRef): Promise<Payable> {
  const current = await loadPayable(id);
  const plan = await planPayableUpdate(current, input);
  if (!plan) return current;
  const { after } = await transitionPayable(id, [current.status], plan.writePatch as Partial<Payable>, payableHistory(actor, "Alterado", { reason: plan.reason, changes: plan.readable }));
  dropCleared(after, plan.patch);
  await emitPayable("payable.updated", actor, after, `Título ${code(after)} alterado`, { ...plan.changes, categoryId: after.categoryId ?? null, costCenterId: after.costCenterId ?? null, accountId: after.accountId ?? null, labels: PAYABLE_AUDIT_LABELS }, describeChanges(plan.changes, PAYABLE_DESCRIBE_LABELS, describePayableValue));
  return after;
}

// ---------------------------------------------------------------------------
// Edição e cancelamento em série (etapa CP/CR 5, regras puras em src/domain/title-series.ts)
// ---------------------------------------------------------------------------

/** Título que ficou fora da série, com o motivo (mostrado na tela e gravado no evento resumo). */
export interface SeriesSkipped {
  id: string;
  code: string;
  reason: string;
}

export interface PayableSeriesResult {
  payable: Payable;
  /** Futuros alterados/cancelados (sem contar o próprio título). */
  updated: number;
  skipped: SeriesSkipped[];
  match: SeriesMatch;
}

/** Visibilidade do usuário (escopo de Contas a Pagar): futuros fora do escopo nem entram na conta. */
export type PayableFilter = (p: Payable) => boolean;

/**
 * "Salvar este + N futuros": a alteração do título (mesmas regras de `updatePayable`) e, nos futuros iguais
 * (`findPayableFutures`), só o que MUDOU — descrição com o sufixo de parcela de cada um refeito, valor, credor,
 * classificação (com os campos antigos derivados de novo para cada um), conta prevista, observações e o dia do vencimento
 * no próprio mês. Fluxo de aprovação (decisão 1): futuro que a regra atual não deixa alterar (valor fora de título manual
 * previsto) fica FORA inteiro, com o motivo. Gravação: o título e os futuros na MESMA transação (lotes atômicos de 400
 * quando passar disso — o limite do Firestore é 500 escritas por transação), histórico em cada título, evento
 * `payable.updated` por título e o resumo `payable.series_updated` (de → para + motivo + quantos alterados/pulados).
 */
export async function updatePayableSeries(id: string, input: UpdatePayableInput, actor: UserRef, options: { allow?: PayableFilter } = {}): Promise<PayableSeriesResult> {
  const current = await loadPayable(id);
  const all = await list<Payable>(COLLECTIONS.payables);
  const unavailable = payableSeriesUnavailable(current, all);
  if (unavailable) throw new BusinessError(`Este título não tem alteração em série: ${unavailable}`);
  const plan = await planPayableUpdate(current, input);
  const futures = findPayableFutures(current, all).filter(options.allow ?? (() => true));
  const match = seriesMatchOf(current);
  if (!plan) return { payable: current, updated: 0, skipped: [], match };
  const after = { ...current, ...plan.patch } as Payable;
  const edit = seriesEditFrom(current, after, PAYABLE_SERIES_FIELDS);
  const registry = plan.registry ?? (edit.fields.categoryId !== undefined || edit.fields.costCenterId !== undefined ? await loadClassificationContext() : null);
  // Patch de cada futuro (só as diferenças) e os campos antigos derivados de novo quando a classificação muda nele.
  const planned: { future: Payable; patch: Record<string, unknown> }[] = [];
  const skipped: SeriesSkipped[] = [];
  for (const f of futures) {
    const raw = applySeriesEdit(f, edit);
    if ("dueDate" in raw) raw.dueDate = `${raw.dueDate}T12:00:00.000Z`;
    if (registry && ("categoryId" in raw || "costCenterId" in raw)) {
      const next = { categoryId: ("categoryId" in raw ? raw.categoryId : f.categoryId) as string | null | undefined, costCenterId: ("costCenterId" in raw ? raw.costCenterId : f.costCenterId) as string | null | undefined };
      const effective = resolveEffectiveCostCenter(next, registry.categories, registry.centers).id ?? undefined;
      const legacy = legacyFieldsFor({ categoryId: next.categoryId ?? undefined, effectiveCostCenterId: effective, names: {} }, registry);
      delete raw.category;
      delete raw.costCenter;
      if (legacy.category && legacy.category !== f.category) raw.category = legacy.category;
      if (legacy.costCenter && legacy.costCenter !== f.costCenter) raw.costCenter = legacy.costCenter;
    }
    if (Object.keys(raw).length === 0) continue;
    const reason = payableSeriesSkip(f, raw);
    if (reason) skipped.push({ id: f.id, code: code(f), reason });
    else planned.push({ future: f, patch: raw });
  }
  const names = await registryNames(registry, [current.accountId, after.accountId, ...planned.map((x) => x.future.accountId)]);
  const now = nowIso();
  const head = `Alterado em série (este + ${planned.length} futuro${planned.length === 1 ? "" : "s"})`;
  const results: { before: Payable; after: Payable; readable: Record<string, { from: unknown; to: unknown }> }[] = [];
  let edited: Payable = current;
  // Lote 1 leva o título editado; cada lote é uma transação (tudo ou nada). Reler dentro da transação: futuro que
  // recebeu baixa ou mudou de situação entretanto fica FORA (motivo), o editado com outra situação aborta tudo.
  const batches = chunk(planned);
  if (batches.length === 0) batches.push([]);
  for (let b = 0; b < batches.length; b++) {
    const batch = batches[b];
    const out = await firestore.runTransaction(async (tx) => {
      const refs = batch.map((x) => col(COLLECTIONS.payables).doc(x.future.id));
      const editedRef = col(COLLECTIONS.payables).doc(id);
      const editedSnap = b === 0 ? await txGetOwn(tx, editedRef) : null;
      const snaps = await Promise.all(refs.map((r) => txGetOwn(tx, r)));
      const done: { before: Payable; after: Payable; readable: Record<string, { from: unknown; to: unknown }> }[] = [];
      const late: SeriesSkipped[] = [];
      let editedAfter: Payable | null = null;
      if (b === 0) {
        if (!editedSnap) throw new Error("Título não encontrado");
        const before = { ...(editedSnap.data() as Omit<Payable, "id">), id } as Payable;
        if (before.status !== current.status) throw new Error(`Título ${PAYABLE_STATUS_LABELS[before.status].toLowerCase()} não permite esta ação`);
        const data = cleanPatch({ ...plan.writePatch, updatedAt: now, history: [...(before.history ?? []), payableHistory(actor, planned.length > 0 ? head : "Alterado", { reason: plan.reason, changes: plan.readable }, now)] });
        tx.update(editedRef, data);
        editedAfter = dropCleared({ ...before, ...(data as Partial<Payable>) }, plan.patch);
      }
      batch.forEach((x, i) => {
        const snap = snaps[i];
        const before = snap ? ({ ...(snap.data() as Omit<Payable, "id">), id: x.future.id } as Payable) : null;
        const why = before ? payableSeriesSkip(before, x.patch) : SERIES_SKIP_SETTLED;
        if (!before || why) {
          late.push({ id: x.future.id, code: code(x.future), reason: why ?? SERIES_SKIP_SETTLED });
          return;
        }
        const write: Record<string, unknown> = {};
        const view: Record<string, unknown> = {};
        for (const [k, v] of Object.entries(x.patch)) {
          write[k] = v === null ? deleteField() : v;
          view[k] = v === null ? undefined : v;
        }
        const nextView = { ...before, ...view } as Payable;
        const audit = auditChanges<Payable>(before, nextView, [...PAYABLE_UPDATE_FIELDS, "competence"], plan.reason);
        const readable = readablePayableChanges(audit.changes, names);
        tx.update(refs[i], cleanPatch({ ...write, updatedAt: now, history: [...(before.history ?? []), payableHistory(actor, `Alterado em série (a partir de ${code(current)})`, { reason: plan.reason, changes: readable }, now)] }));
        for (const [k, v] of Object.entries(view)) if (v === undefined) delete (nextView as unknown as Record<string, unknown>)[k];
        done.push({ before, after: nextView, readable });
      });
      return { done, late, editedAfter };
    });
    results.push(...out.done);
    skipped.push(...out.late);
    if (out.editedAfter) edited = out.editedAfter;
  }
  // Eventos: um por título (o editado e cada futuro) + o resumo da série.
  await emitPayable("payable.updated", actor, edited, `Título ${code(edited)} alterado`, { ...plan.changes, categoryId: edited.categoryId ?? null, costCenterId: edited.costCenterId ?? null, accountId: edited.accountId ?? null, labels: PAYABLE_AUDIT_LABELS, series: { role: "editado", futures: results.length } }, describeChanges(plan.changes, PAYABLE_DESCRIBE_LABELS, describePayableValue));
  for (const r of results) {
    const changes = { changes: r.readable, reason: plan.reason };
    await emitPayable("payable.updated", actor, r.after, `Título ${code(r.after)} alterado em série (a partir de ${code(current)})`, { ...changes, categoryId: r.after.categoryId ?? null, costCenterId: r.after.costCenterId ?? null, accountId: r.after.accountId ?? null, labels: PAYABLE_AUDIT_LABELS, series: { role: "futuro", editedId: current.id, editedCode: code(current) } }, describeChanges(changes, PAYABLE_DESCRIBE_LABELS, describePayableValue));
  }
  await emitPayable("payable.series_updated", actor, edited, `Série alterada a partir de ${code(edited)}: ${results.length} futuro${results.length === 1 ? "" : "s"} alterado${results.length === 1 ? "" : "s"}${skipped.length ? `, ${skipped.length} fora` : ""}`, { ...plan.changes, changes: { ...plan.readable, futuresUpdated: { from: null, to: results.length } }, ...seriesPayload(match, current.seriesId, results.map((r) => r.after), skipped), labels: PAYABLE_AUDIT_LABELS }, `${plan.reason}${skipped.length ? ` · fora: ${summarizeSkipped(skipped).map((s) => `${s.count} (${s.reason})`).join("; ")}` : ""}`);
  return { payable: edited, updated: results.length, skipped, match };
}

/** Parte comum do evento resumo da série: como os futuros foram encontrados, quais foram alterados e quais ficaram fora. */
function seriesPayload(match: SeriesMatch, seriesId: string | undefined, titles: { id: string; code?: string }[], skipped: SeriesSkipped[]): Record<string, unknown> {
  return { match, seriesId: seriesId ?? null, titleIds: titles.map((t) => t.id), titleCodes: titles.map((t) => t.code ?? t.id), skipped, skippedSummary: summarizeSkipped(skipped) };
}

/**
 * "Cancelar este + N futuros" (decisão 4: cancelar em vez de excluir): o título e os futuros iguais (mesma regra da
 * edição) ficam cancelados com o motivo, na mesma transação (lotes de 400). Título com baixa parcial não cancela
 * (regra da etapa 3); futuro que recebeu baixa entretanto fica FORA. Comissão/bônus/estorno e série recorrente não têm
 * cancelamento em série (o modelo da série recorrente continua encerrando a série pelo cancelamento normal).
 */
export async function cancelPayableSeries(id: string, reason: string, actor: UserRef, options: { allow?: PayableFilter } = {}): Promise<PayableSeriesResult> {
  const trimmed = reason.trim();
  if (trimmed.length < 5) throw new Error("Descreva o motivo do cancelamento");
  const current = await loadPayable(id);
  if (current.status === "pago") throw new Error("Título pago não pode ser cancelado: estorne a comissão");
  if (current.status === "cancelado") throw new Error("Este título já está cancelado");
  if ((current.payments?.length ?? 0) > 0) throw new BusinessError("Este título tem baixa parcial registrada: desfaça as baixas (histórico de baixas) antes de cancelar, ou quite pelo já pago");
  const all = await list<Payable>(COLLECTIONS.payables);
  const unavailable = payableSeriesUnavailable(current, all);
  if (unavailable) throw new BusinessError(`Este título não tem cancelamento em série: ${unavailable}`);
  const futures = findPayableFutures(current, all).filter(options.allow ?? (() => true));
  const match = seriesMatchOf(current);
  const now = nowIso();
  const cancelled: Payable[] = [];
  const skipped: SeriesSkipped[] = [];
  let edited: Payable = current;
  const batches = chunk(futures);
  if (batches.length === 0) batches.push([]);
  for (let b = 0; b < batches.length; b++) {
    const batch = batches[b];
    const out = await firestore.runTransaction(async (tx) => {
      const ids = b === 0 ? [id, ...batch.map((f) => f.id)] : batch.map((f) => f.id);
      const refs = ids.map((x) => col(COLLECTIONS.payables).doc(x));
      const snaps = await Promise.all(refs.map((r) => txGetOwn(tx, r)));
      const done: Payable[] = [];
      const late: SeriesSkipped[] = [];
      snaps.forEach((snap, i) => {
        const isEdited = b === 0 && i === 0;
        const before = snap ? ({ ...(snap.data() as Omit<Payable, "id">), id: ids[i] } as Payable) : null;
        if (isEdited) {
          if (!before) throw new Error("Título não encontrado");
          if (before.status === "pago" || before.status === "cancelado") throw new Error("Este título já foi pago ou cancelado");
          if ((before.payments?.length ?? 0) > 0) throw new BusinessError("Este título tem baixa parcial registrada: desfaça as baixas antes de cancelar");
        } else if (!before || hasSettlement(before) || isCommissionLinkedPayable(before)) {
          const f = batch[b === 0 ? i - 1 : i];
          late.push({ id: f.id, code: code(f), reason: before && isCommissionLinkedPayable(before) ? SERIES_SKIP_COMMISSION : SERIES_SKIP_SETTLED });
          return;
        }
        const label = isEdited ? (futures.length ? `Cancelado em série (este + ${futures.length} futuro${futures.length === 1 ? "" : "s"})` : "Cancelado") : `Cancelado em série (a partir de ${code(current)})`;
        const patch = cleanPatch({ status: "cancelado", cancelledAt: now, cancelledBy: actor.id, cancelReason: trimmed, updatedAt: now, history: [...(before!.history ?? []), payableHistory(actor, label, { from: before!.status, to: "cancelado", reason: trimmed }, now)] });
        tx.update(refs[i], patch);
        done.push({ ...before!, ...(patch as Partial<Payable>) });
      });
      return { done, late };
    });
    for (const p of out.done) {
      if (p.id === id) edited = p;
      else cancelled.push(p);
    }
    skipped.push(...out.late);
  }
  const statusFrom = (p: Payable) => futures.find((f) => f.id === p.id)?.status ?? current.status;
  await emitPayable("payable.cancelled", actor, edited, `Título ${code(edited)} cancelado`, { ...auditChanges<Payable>(current, edited, ["status"], trimmed), returnedCommissionIds: [], series: { role: "editado", futures: cancelled.length } }, trimmed);
  for (const p of cancelled) await emitPayable("payable.cancelled", actor, p, `Título ${code(p)} cancelado em série (a partir de ${code(current)})`, { ...auditChanges<Payable>({ ...p, status: statusFrom(p) }, p, ["status"], trimmed), returnedCommissionIds: [], series: { role: "futuro", editedId: current.id, editedCode: code(current) } }, trimmed);
  await emitPayable("payable.series_cancelled", actor, edited, `Série cancelada a partir de ${code(edited)}: este + ${cancelled.length} futuro${cancelled.length === 1 ? "" : "s"}${skipped.length ? `, ${skipped.length} fora` : ""}`, { changes: { status: { from: current.status, to: "cancelado" }, futuresCancelled: { from: null, to: cancelled.length } }, reason: trimmed, ...seriesPayload(match, current.seriesId, cancelled, skipped) }, trimmed);
  return { payable: edited, updated: cancelled.length, skipped, match };
}

/** Nomes dos cadastros para a auditoria (categoria-mãe/subcategoria, centro, conta). */
async function registryNames(ctx: ClassificationContext | null, accountIds: (string | undefined)[]): Promise<{ category: (id: string | null) => { category?: string; subcategory?: string }; center: (id: string | null) => string | null; account: (id: string | null) => string | null }> {
  const ids = Array.from(new Set(accountIds.filter((x): x is string => Boolean(x))));
  const accounts = ids.length ? await getManyByIds<FinancialAccount>(COLLECTIONS.financialAccounts, ids) : new Map<string, FinancialAccount>();
  const cats = new Map((ctx?.categories ?? []).map((c) => [c.id, c]));
  return {
    category: (id) => {
      const c = id ? cats.get(id) : undefined;
      if (!c) return id ? { category: id } : {};
      const parent = c.parentId ? cats.get(c.parentId) : undefined;
      return parent ? { category: parent.name, subcategory: c.name } : { category: c.name };
    },
    center: (id) => (id ? (ctx?.centers.find((c) => c.id === id)?.name ?? id) : null),
    account: (id) => (id ? (accounts.get(id)?.name ?? id) : null),
  };
}

/**
 * Rótulos da auditoria dos títulos a pagar (etapa CP/CR 4, `payload.labels`): os campos ANTIGOS derivados do cadastro
 * aparecem como "(configuração)" para não se confundirem com a categoria/centro do cadastro.
 */
const PAYABLE_AUDIT_LABELS: Record<string, string> = { category: "Categoria (configuração)", costCenter: "Centro de custo (configuração)", costCenterName: "Centro de custo", categoryName: "Categoria", subcategoryName: "Subcategoria", documentNumber: "Nº do documento", plannedAccountName: "Conta prevista" };

export interface ManualPayableInput {
  creditorType: "colaborador" | "fornecedor";
  creditorId?: string;
  creditorName?: string;
  supplierId?: string;
  /** Chave antiga do setting (formulário sem cadastros). Com `categoryId`, é derivada do cadastro. */
  category?: string;
  costCenter?: string;
  description: string;
  amount: number;
  /** AAAA-MM; vazia = mês do vencimento (etapa CP/CR 4; cada ocorrência da repetição: o mês do próprio vencimento). */
  competence?: string;
  dueDate: string;
  notes?: string;
  /** Parcelamento ANTIGO (N títulos mensais "(parcela i/N)"): mantido para chamadores existentes (seed). */
  installments?: number;
  recurrence?: PayableRecurrence;
  attachmentUrl?: string;
  attachmentName?: string;
  // Formulário de títulos (etapa CP/CR 4) — opcionais.
  /** Categoria OU subcategoria de DESPESA do cadastro (`finance_categories`). */
  categoryId?: string;
  /** Centro de custo próprio do título (vazio = o da categoria). */
  costCenterId?: string;
  /** Conta financeira prevista (pré-seleciona a conta na baixa). */
  accountId?: string;
  /** Nº do documento do credor (NF, boleto). */
  documentNumber?: string;
  /** Repetição Único/Fixo/Parcelado com intervalo em dias/semanas/meses (src/domain/title-repeat.ts). */
  repeat?: RepeatInput;
}

/** Categorias e centros de custo aceitos (setting `contas_a_pagar` + as fixas do circuito). */
export async function getPayablesSettings(): Promise<ContasAPagarConfig & { categoriasComRotulo: { value: string; label: string }[] }> {
  const value = await getSetting<ContasAPagarConfig>("contas_a_pagar", SETTING_DEFAULTS.contas_a_pagar);
  const categorias = Array.from(new Set([...(Array.isArray(value.categorias) ? value.categorias : SETTING_DEFAULTS.contas_a_pagar.categorias), ...PAYABLE_CATEGORIES])).filter((c) => typeof c === "string" && c);
  const centrosDeCusto = Array.isArray(value.centrosDeCusto) ? value.centrosDeCusto.filter((c) => typeof c === "string" && c) : [];
  return { categorias, centrosDeCusto, categoriasComRotulo: categorias.map((c) => ({ value: c, label: payableCategoryLabel(c) })) };
}

/** Parcelas com centavos exatos (a última leva o resto). */
function splitAmount(total: number, n: number): number[] {
  const cents = Math.round(total * 100);
  const base = Math.floor(cents / n);
  return Array.from({ length: n }, (_, i) => (i === n - 1 ? cents - base * (n - 1) : base) / 100);
}

function shiftDue(dueDate: string, months: number): string {
  const key = dueDate.slice(0, 10);
  const [y, m, d] = key.split("-").map(Number);
  const first = new Date(Date.UTC(y, m - 1 + months, 1));
  const last = new Date(Date.UTC(first.getUTCFullYear(), first.getUTCMonth() + 1, 0)).getUTCDate();
  return new Date(Date.UTC(first.getUTCFullYear(), first.getUTCMonth(), Math.min(d, last), 12)).toISOString();
}

/**
 * Título manual (D28): valida credor (fornecedor cadastrado ou nome livre; colaborador do cadastro), categoria do
 * setting, centro de custo; parcelamento gera N títulos `pag_<base>_p<n>` (createIfAbsent) com vencimentos mensais;
 * recorrência marca o título como série (`seriesId` = próprio id) para a varredura `contas_recorrentes`; anexo vira
 * documento (entityType "payable"). Devolve o primeiro título (e os demais em `parcels`).
 */
export async function createManualPayable(input: ManualPayableInput, actor: UserRef, options: { emit?: boolean; createdAt?: string } = {}): Promise<Payable & { parcels?: Payable[] }> {
  let creditorName = input.creditorName?.trim() ?? "";
  let supplierId: string | undefined;
  if (input.creditorType === "colaborador") {
    const user = input.creditorId ? await getById<User>(COLLECTIONS.users, input.creditorId) : null;
    if (!user) throw new Error("Selecione o colaborador");
    creditorName = user.name;
  } else if (input.supplierId) {
    const supplier = await getById<Supplier>(COLLECTIONS.suppliers, input.supplierId);
    if (!supplier) throw new Error("Fornecedor não encontrado");
    if (supplier.active === false) throw new Error(`O fornecedor ${supplier.name} está inativo`);
    creditorName = supplier.name;
    supplierId = supplier.id;
  }
  if (!creditorName) throw new Error("Informe o credor");
  const settings = await getPayablesSettings();
  // Classificação pelos cadastros (etapa CP/CR 4): valida categoria de DESPESA/centro e deriva os campos antigos
  // (`category` chave e `costCenter` nome) para listas, filtros, relatório e KPIs existentes.
  const registry = input.categoryId || input.costCenterId ? await loadClassificationContext() : null;
  const resolved = registry ? resolveOrThrow({ categoryId: input.categoryId, costCenterId: input.costCenterId }, "despesa", registry) : null;
  const legacy = resolved && registry ? legacyFieldsFor(resolved, registry) : {};
  const category = legacy.category ?? input.category ?? LEGACY_FALLBACK_CATEGORY;
  const costCenter = legacy.costCenter ?? input.costCenter;
  if (!legacy.category && input.category && !settings.categorias.includes(input.category)) throw new Error(`Categoria "${input.category}" não está em Configurações › Contas a pagar`);
  if (!legacy.costCenter && input.costCenter && settings.centrosDeCusto.length > 0 && !settings.centrosDeCusto.includes(input.costCenter)) throw new Error(`Centro de custo "${input.costCenter}" não está em Configurações › Contas a pagar`);
  if (ENGINE_ONLY_CATEGORY_KEYS.includes(category)) throw new BusinessError("Comissões e estornos nascem do motor de comissões, não de lançamento manual");
  const account = await readPlannedAccount(input.accountId);
  const documentNumber = input.documentNumber?.trim() || undefined;
  const n = Math.max(1, Math.min(48, Math.floor(input.installments ?? 1)));
  const now = options.createdAt ?? nowIso();
  const amount = Math.round(input.amount * 100) / 100;
  const base = {
    creditorType: input.creditorType,
    creditorId: input.creditorType === "colaborador" ? input.creditorId : undefined,
    creditorName,
    supplierId,
    category,
    costCenter,
    categoryId: resolved?.categoryId,
    costCenterId: resolved?.costCenterId,
    accountId: account?.id,
    documentNumber,
    status: "previsto" as const,
    origin: "manual" as const,
    sourceIds: { commissionIds: [] },
    notes: input.notes?.trim() || undefined,
    createdBy: actor.id,
  };
  // Nomes legíveis na auditoria (nunca ids soltos): categoria, subcategoria, centro efetivo e conta prevista.
  const readable = { categoryName: resolved?.names.category, subcategoryName: resolved?.names.subcategory, costCenterName: resolved?.names.center, plannedAccountName: account?.name };
  const emitCreated = async (p: Payable, extra: Record<string, unknown> = {}) => {
    if (options.emit === false) return;
    const audit = auditChanges<Payable & typeof readable>(null, { ...p, ...readable }, ["creditorName", "category", "description", "amount", "competence", "dueDate", "costCenter", "documentNumber", "categoryName", "subcategoryName", "costCenterName", "plannedAccountName"]);
    await emitPayable("payable.created", actor, p, `Título ${p.code} lançado: ${formatCurrency(p.amount)} para ${creditorName}`, { origin: "manual", category, supplierId: supplierId ?? null, costCenter: costCenter ?? null, categoryId: p.categoryId ?? null, costCenterId: p.costCenterId ?? null, accountId: p.accountId ?? null, ...extra, ...audit, labels: PAYABLE_AUDIT_LABELS }, `${classificationLabel(resolved?.names ?? {}) ?? payableCategoryLabel(category)}${p.installments ? ` · parcela ${p.installment}/${p.installments}` : ""}${p.recurrence ? ` · recorrente (${p.recurrence.frequency})` : ""} · vence ${formatDate(p.dueDate)}`);
  };
  const attach = async (payableId: string) => {
    if (!input.attachmentUrl) return undefined;
    return addPayableAttachment(payableId, { name: input.attachmentName?.trim() || `Anexo · ${input.description.trim()}`, url: input.attachmentUrl }, actor, { emit: false });
  };

  // Repetição Fixo/Parcelado (etapa CP/CR 4): N títulos `pag_<base>_p<i>` gravados numa transação só, com os números PAG
  // reservados no mesmo contador; mesma série (`seriesId`); só o parcelado grava a parcela {n, total}.
  const repeatMode = input.repeat?.mode ?? "unico";
  if (repeatMode !== "unico") {
    if (input.recurrence) throw new BusinessError("Use a repetição OU a série recorrente, não os dois");
    const plan = planOccurrences({ description: input.description, amount, dueDate: input.dueDate, competence: input.competence, repeat: input.repeat });
    if (!plan.ok) throw new BusinessError(plan.error);
    const baseId = newId(COLLECTIONS.payables);
    const numbering = await prepareNextNumber("PAG", { pad: 5, year: dateKey(now).slice(0, 4), initFrom: { collection: COLLECTIONS.payables, field: "code" } });
    const label = describeRepeat(input.repeat);
    const parcels = await firestore.runTransaction(async (tx) => {
      const { codes, commit } = await txNextNumbers(tx, numbering, plan.value.length);
      const out: Payable[] = [];
      plan.value.forEach((o, i) => {
        const id = `pag_${baseId}_p${o.index}`;
        const data = stripUndefined({
          ...base,
          organizationId: ORG_ID,
          code: codes[i],
          description: o.description,
          amount: o.amount,
          competence: o.competence,
          dueDate: `${o.dueDate}T12:00:00.000Z`,
          installment: o.installment?.n,
          installments: o.installment?.total,
          seriesId: baseId,
          history: [payableHistory(actor, `Lançamento manual ${repeatMode === "parcelado" ? `parcelado (${o.index}/${o.total})` : `fixo (${o.index} de ${o.total})`} · ${label}`, { to: "previsto" }, now)],
          createdAt: now,
          updatedAt: now,
        }) as Omit<Payable, "id">;
        tx.create(col(COLLECTIONS.payables).doc(id), data);
        out.push({ ...data, id } as Payable);
      });
      commit();
      return out;
    });
    for (const p of parcels) await emitCreated(p, { seriesId: baseId, repeat: input.repeat, occurrence: parcels.indexOf(p) + 1, occurrences: parcels.length, ...(p.installments ? { installment: p.installment, installments: p.installments } : {}) });
    const doc = await attach(parcels[0].id);
    if (doc) parcels[0] = { ...parcels[0], attachmentIds: [doc.id] };
    return { ...parcels[0], parcels };
  }

  if (n > 1) {
    const baseId = newId(COLLECTIONS.payables);
    const parts = splitAmount(amount, n);
    const parcels: Payable[] = [];
    for (let i = 0; i < n; i++) {
      const id = `pag_${baseId}_p${i + 1}`;
      const dueDate = shiftDue(input.dueDate, i);
      const competence = dateKey(dueDate).slice(0, 7);
      const { created, doc } = await createIfAbsent<Payable>(COLLECTIONS.payables, id, {
        ...base,
        description: `${input.description.trim()} (parcela ${i + 1}/${n})`,
        amount: parts[i],
        competence,
        dueDate,
        installment: i + 1,
        installments: n,
        seriesId: baseId,
        history: [payableHistory(actor, `Lançamento manual parcelado (${i + 1}/${n})`, { to: "previsto" }, now)],
        createdAt: now,
        updatedAt: now,
      });
      const p = created ? { ...doc, code: await assignPayableCode(id, now) } : doc;
      parcels.push(p);
      if (created) await emitCreated(p, { installment: i + 1, installments: n, seriesId: baseId });
    }
    await attach(parcels[0].id);
    return { ...parcels[0], parcels };
  }

  const payable = await create<Payable>(COLLECTIONS.payables, {
    ...base,
    description: input.description.trim(),
    amount,
    // Competência vazia = mês do vencimento (etapa CP/CR 4).
    competence: input.competence || input.dueDate.slice(0, 7),
    dueDate: `${input.dueDate.slice(0, 10)}T12:00:00.000Z`,
    recurrence: input.recurrence ? stripUndefined({ frequency: input.recurrence.frequency, dayOfMonth: input.recurrence.dayOfMonth, until: input.recurrence.until?.slice(0, 10) }) : undefined,
    history: [payableHistory(actor, input.recurrence ? `Lançamento manual recorrente (${input.recurrence.frequency}, dia ${input.recurrence.dayOfMonth})` : "Lançamento manual", { to: "previsto" }, now)],
    createdAt: now,
    updatedAt: now,
  });
  // Série recorrente: o próprio título é o modelo (seriesId = id); as ocorrências vêm da varredura.
  if (input.recurrence) await update<Payable>(COLLECTIONS.payables, payable.id, { seriesId: payable.id });
  const withCode = { ...payable, seriesId: input.recurrence ? payable.id : undefined, code: await assignPayableCode(payable.id, now) };
  await emitCreated(withCode, input.recurrence ? { recurrence: withCode.recurrence, seriesId: payable.id } : {});
  const doc = await attach(payable.id);
  if (doc) withCode.attachmentIds = [doc.id];
  return withCode;
}

/** Anexo por link (como em documentos): `documents` com entityType "payable" + `attachmentIds` no título. */
export async function addPayableAttachment(payableId: string, input: { name: string; url: string }, actor: UserRef, options: { emit?: boolean } = {}): Promise<Document> {
  const p = await loadPayable(payableId);
  const doc = await create<Document>(COLLECTIONS.documents, {
    clientId: p.sourceIds?.clientId,
    entityType: "payable",
    entityId: p.id,
    name: input.name.trim(),
    url: input.url.trim(),
    version: 1,
    uploadedBy: actor.id,
    category: "Contas a pagar",
    createdBy: actor.id,
  });
  await update<Payable>(COLLECTIONS.payables, p.id, { attachmentIds: [...(p.attachmentIds ?? []), doc.id] });
  if (options.emit !== false) await emitPayable("payable.updated", actor, { ...p, attachmentIds: [...(p.attachmentIds ?? []), doc.id] }, `Anexo adicionado ao título ${code(p)}: ${doc.name}`, { attachmentId: doc.id, url: doc.url }, doc.url);
  return doc;
}

export async function listPayableAttachments(payable: Pick<Payable, "id" | "attachmentIds">): Promise<Document[]> {
  if (!payable.attachmentIds?.length) return [];
  const docs = await getManyByIds<Document>(COLLECTIONS.documents, payable.attachmentIds);
  return payable.attachmentIds.map((id) => docs.get(id)).filter((d): d is Document => Boolean(d));
}
