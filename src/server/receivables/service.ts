import "server-only";
/**
 * Títulos a receber AVULSOS (etapa CP/CR 3) — receitas fora de contrato. Coleção `receivables` (regra `if false`), código
 * REC-AAAA-NNNNN, sem fluxo de aprovação (aberto → pago; cancelado com motivo). NÃO toca nas cobranças de contrato
 * (`billing`), que continuam com o próprio caminho de baixa (`registerPayment`).
 *
 * Recebimentos com as MESMAS regras das baixas de Contas a Pagar (src/domain/settlements.ts): receber (quitar, com
 * desconto/juros ajustando o valor), receber parcialmente, receber com resíduo, quitar pelo já recebido e desfazer UM
 * recebimento. Cada recebimento grava o lançamento de RECEITA na MESMA transação (origem "receivable"); o resíduo nasce
 * na mesma transação com o número REC reservado no mesmo contador. Toda mudança vai para `history[]` e para o evento com
 * `changes` (de → para) e motivo.
 */
import { FieldValue } from "firebase-admin/firestore";
import { firestore } from "@/server/firebase-admin";
import { col, create, getById, getManyByIds, newId, nextNumber, nowIso, ORG_ID, prepareNextNumber, stripUndefined, txGetOwn, txNextNumber, update } from "@/server/db";
import { emitEvent } from "@/server/events";
import { auditChanges } from "@/server/audit";
import { BusinessError } from "@/server/auth/error-classes";
import { dateKey, formatCurrency, formatDate } from "@/lib/format";
import { buildReceivableCashEntry } from "@/domain/cash-entries";
import { roundCents } from "@/domain/finance-registry";
import { openAmount, originalAmountFor, planPayment, planSettleByPaid, planUndoPayment, receivablePaidAmount, residualDescription, residualNote, shiftDueMonths, splitInstallments, type PaymentMode } from "@/domain/settlements";
import { COLLECTIONS, type CashEntry, type Client, type CostCenter, type Document, type FinanceCategory, type FinancialAccount, type Receivable, type ReceivableHistoryEntry, type ReceivablePayment, type ReceivableStatus, type UserRef } from "@/domain/types";
import { ACCOUNT_REQUIRED_MESSAGE, emitCashEntryEvent, newCashEntryId, txCreateCashEntry, txDeleteCashEntry, txReadCashEntry, txReadPaymentAccount } from "@/server/finance-registry/cash-entries";
import { cleanPatch, deleteField } from "@/server/commissions/store";
import type { ReceivableCreateInput, ReceivableUpdateInput } from "./schemas";

export const RECEIVABLE_STATUS_LABELS: Record<ReceivableStatus, string> = { aberto: "Em aberto", pago: "Recebido", cancelado: "Cancelado" };

const brl = (v: number) => formatCurrency(v);
const code = (r: Pick<Receivable, "code" | "id">) => r.code ?? r.id;
const noonIso = (day: string) => `${day.slice(0, 10)}T12:00:00.000Z`;

function history(actor: UserRef, action: string, extra: Partial<ReceivableHistoryEntry> = {}, at?: string): ReceivableHistoryEntry {
  return cleanPatch({ at: at ?? nowIso(), by: actor.id, byName: actor.name, action, ...extra }) as unknown as ReceivableHistoryEntry;
}

async function emitReceivable(type: "receivable.created" | "receivable.updated" | "receivable.received" | "receivable.partially_received" | "receivable.residual_created" | "receivable.settled_by_paid" | "receivable.payment_undone" | "receivable.cancelled", actor: UserRef, r: Receivable, title: string, payload: Record<string, unknown>, description?: string) {
  await emitEvent({
    type,
    actor,
    clientId: r.clientId,
    entity: { type: "receivable", id: r.id },
    title,
    description,
    department: "financeiro",
    payload: { receivableId: r.id, code: r.code ?? null, amount: r.amount, clientId: r.clientId ?? null, payerName: r.payerName, ...payload },
    // Fora da timeline do cliente (como os títulos a pagar): auditoria e histórico do próprio título.
    timeline: false,
  });
}

/** Numeração REC-AAAA-NNNNN (só chamada quando o título acabou de ser criado). */
async function assignReceivableCode(id: string, createdAt: string): Promise<string> {
  const value = await nextNumber("REC", { pad: 5, year: dateKey(createdAt).slice(0, 4), initFrom: { collection: COLLECTIONS.receivables, field: "code" } });
  await update<Receivable>(COLLECTIONS.receivables, id, { code: value });
  return value;
}

// ---------------------------------------------------------------------------
// Validação da classificação e do pagador (cadastros reais)
// ---------------------------------------------------------------------------

interface Classification {
  clientId?: string;
  payerName: string;
  categoryId?: string;
  costCenterId?: string;
  accountId?: string;
  names: { category?: string; center?: string; account?: string };
}

/**
 * Pagador: cliente cadastrado (nome do cadastro) ou nome livre; categoria só de RECEITA e ativa (categoria ou
 * subcategoria); centro de custo e conta prevista ativos. Centro vazio = herda da categoria (resolveEffectiveCostCenter).
 */
async function resolveClassification(input: { clientId?: string; payerName?: string; categoryId?: string; costCenterId?: string; accountId?: string }): Promise<Classification> {
  const [client, category, center, account] = await Promise.all([
    input.clientId ? getById<Client>(COLLECTIONS.clients, input.clientId) : Promise.resolve(null),
    input.categoryId ? getById<FinanceCategory>(COLLECTIONS.financeCategories, input.categoryId) : Promise.resolve(null),
    input.costCenterId ? getById<CostCenter>(COLLECTIONS.costCenters, input.costCenterId) : Promise.resolve(null),
    input.accountId ? getById<FinancialAccount>(COLLECTIONS.financialAccounts, input.accountId) : Promise.resolve(null),
  ]);
  if (input.clientId && !client) throw new BusinessError("Cliente não encontrado");
  const payerName = client ? client.tradeName || client.legalName : (input.payerName?.trim() ?? "");
  if (payerName.length < 2) throw new BusinessError("Informe o cliente ou o nome do pagador");
  if (input.categoryId) {
    if (!category || category.archived) throw new BusinessError("Categoria não encontrada ou arquivada");
    if (category.type !== "receita") throw new BusinessError(`A categoria "${category.name}" é de despesa: título a receber usa só categorias de RECEITA`);
  }
  if (input.costCenterId && (!center || center.archived)) throw new BusinessError("Centro de custo não encontrado ou arquivado");
  if (input.accountId && (!account || account.archived)) throw new BusinessError("Conta financeira prevista não encontrada ou arquivada");
  return {
    clientId: client?.id,
    payerName,
    categoryId: category?.id,
    costCenterId: center?.id,
    accountId: account?.id,
    names: { category: category?.name, center: center?.name, account: account?.name },
  };
}

// ---------------------------------------------------------------------------
// Criar (único ou parcelado mensal)
// ---------------------------------------------------------------------------

/**
 * Novo título a receber avulso: único ou parcelado mensal (`rec_<base>_p<n>`, centavos exatos com a sobra na ÚLTIMA
 * parcela, vencimentos mensais mantendo o dia, competência acompanha). Competência vazia = mês do vencimento. Anexo
 * por link vira documento (entityType "receivable") ligado ao primeiro título.
 */
export async function createReceivables(input: ReceivableCreateInput, actor: UserRef, options: { emit?: boolean; createdAt?: string } = {}): Promise<Receivable[]> {
  const cls = await resolveClassification(input);
  const n = Math.max(1, Math.min(48, Math.floor(input.installments ?? 1)));
  const now = options.createdAt ?? nowIso();
  const parts = splitInstallments(roundCents(input.amount), n);
  const baseId = n > 1 ? newId(COLLECTIONS.receivables) : undefined;
  const created: Receivable[] = [];
  for (let i = 0; i < n; i++) {
    const dueDate = n > 1 ? shiftDueMonths(input.dueDate, i) : noonIso(input.dueDate);
    const competence = input.competence ? (i === 0 ? input.competence : shiftDueMonths(`${input.competence}-01`, i).slice(0, 7)) : dateKey(dueDate).slice(0, 7);
    const description = n > 1 ? `${input.description.trim()} (parcela ${i + 1}/${n})` : input.description.trim();
    const data = stripUndefined({
      description,
      amount: parts[i],
      dueDate,
      competence,
      clientId: cls.clientId,
      payerName: cls.payerName,
      categoryId: cls.categoryId,
      costCenterId: cls.costCenterId,
      accountId: cls.accountId,
      documentNumber: input.documentNumber,
      notes: input.notes,
      status: "aberto" as const,
      installment: n > 1 ? i + 1 : undefined,
      installments: n > 1 ? n : undefined,
      seriesId: baseId,
      history: [history(actor, n > 1 ? `Título a receber lançado (parcela ${i + 1}/${n})` : "Título a receber lançado", { to: "aberto" }, now)],
      createdBy: actor.id,
      createdAt: now,
      updatedAt: now,
    }) as Omit<Receivable, "id" | "organizationId" | "createdAt" | "updatedAt"> & { createdAt: string; updatedAt: string };
    const doc = await create<Receivable>(COLLECTIONS.receivables, data, baseId ? `rec_${baseId}_p${i + 1}` : undefined);
    const r = { ...doc, code: await assignReceivableCode(doc.id, now) };
    created.push(r);
    if (options.emit !== false) {
      const audit = auditChanges<Receivable & { categoryName?: string; costCenterName?: string; plannedAccountName?: string }>(null, { ...r, categoryName: cls.names.category, costCenterName: cls.names.center, plannedAccountName: cls.names.account }, ["description", "payerName", "amount", "dueDate", "competence", "categoryName", "costCenterName", "plannedAccountName", "documentNumber"]);
      await emitReceivable("receivable.created", actor, r, `Título a receber ${r.code} lançado: ${brl(r.amount)} de ${r.payerName}`, { ...audit, ...(baseId ? { seriesId: baseId, installment: i + 1, installments: n } : {}) }, `${description} · vence ${formatDate(dueDate)}`);
    }
  }
  if (input.attachmentUrl) await addReceivableAttachment(created[0].id, { name: input.attachmentName?.trim() || `Anexo · ${input.description.trim()}`, url: input.attachmentUrl }, actor, { emit: false });
  return created;
}

// ---------------------------------------------------------------------------
// Alterar e cancelar
// ---------------------------------------------------------------------------

async function loadReceivable(id: string): Promise<Receivable> {
  const r = await getById<Receivable>(COLLECTIONS.receivables, id);
  if (!r) throw new BusinessError("Título a receber não encontrado");
  return r;
}

/** Transação simples sobre o título (status atual em `allowed`). */
async function patchReceivable(id: string, allowed: readonly ReceivableStatus[], build: (before: Receivable) => Record<string, unknown>): Promise<{ before: Receivable; after: Receivable }> {
  const ref = col(COLLECTIONS.receivables).doc(id);
  return firestore.runTransaction(async (tx) => {
    const snap = await txGetOwn(tx, ref);
    if (!snap) throw new BusinessError("Título a receber não encontrado");
    const before = { ...(snap.data() as Omit<Receivable, "id">), id } as Receivable;
    if (!allowed.includes(before.status)) throw new BusinessError(`Título ${RECEIVABLE_STATUS_LABELS[before.status].toLowerCase()} não permite esta ação`);
    const patch = cleanPatch({ ...build(before), updatedAt: nowIso() });
    tx.update(ref, patch);
    const after = { ...before } as Record<string, unknown>;
    for (const [k, v] of Object.entries(patch)) {
      // FieldValue.delete() remove o campo.
      if (v instanceof FieldValue) delete after[k];
      else after[k] = v;
    }
    return { before, after: after as unknown as Receivable };
  });
}

/**
 * Alteração auditada (motivo obrigatório): descrição, vencimento, competência, pagador, classificação, conta prevista,
 * nº do documento e observações; o VALOR só sem recebimentos (depois disso, o valor muda pelas baixas).
 */
export async function updateReceivable(id: string, input: Omit<ReceivableUpdateInput, "receivableId">, actor: UserRef): Promise<Receivable> {
  const reason = input.reason.trim();
  const current = await loadReceivable(id);
  if (current.status !== "aberto") throw new BusinessError("Título recebido ou cancelado não pode ser alterado");
  if (input.amount !== undefined && roundCents(input.amount) !== roundCents(current.amount) && (current.payments?.length ?? 0) > 0) throw new BusinessError("O valor só muda sem recebimentos registrados (use quitar com desconto/juros ou quitar pelo já recebido)");
  // Ausente = mantém; "" = limpa (categoria, centro, conta prevista, nº do documento, observações).
  const keep = (value: string | undefined, currentValue: string | undefined) => (value === undefined ? currentValue : value || undefined);
  const cls = await resolveClassification({
    clientId: input.clientId ?? (input.payerName ? undefined : current.clientId),
    payerName: input.payerName ?? current.payerName,
    categoryId: keep(input.categoryId, current.categoryId),
    costCenterId: keep(input.costCenterId, current.costCenterId),
    accountId: keep(input.accountId, current.accountId),
  });
  const next: Receivable = {
    ...current,
    description: input.description?.trim() || current.description,
    amount: input.amount !== undefined ? roundCents(input.amount) : current.amount,
    dueDate: input.dueDate ? noonIso(input.dueDate) : current.dueDate,
    competence: input.competence ?? current.competence,
    clientId: cls.clientId,
    payerName: cls.payerName,
    categoryId: cls.categoryId,
    costCenterId: cls.costCenterId,
    accountId: cls.accountId,
    documentNumber: keep(input.documentNumber, current.documentNumber),
    notes: keep(input.notes, current.notes),
  };
  const fields = ["description", "amount", "dueDate", "competence", "payerName", "categoryId", "costCenterId", "accountId", "documentNumber", "notes"] as const;
  const audit = auditChanges<Receivable>(current, next, [...fields], reason);
  if (Object.keys(audit.changes).length === 0) return current;
  // Nomes legíveis na auditoria (nunca ids soltos).
  const names = await nameLookup([current.categoryId, next.categoryId], [current.costCenterId, next.costCenterId], [current.accountId, next.accountId]);
  const readable: Record<string, { from: unknown; to: unknown }> = {};
  for (const [k, c] of Object.entries(audit.changes)) {
    if (k === "categoryId") readable.categoryName = { from: names.get(String(c.from)) ?? null, to: names.get(String(c.to)) ?? null };
    else if (k === "costCenterId") readable.costCenterName = { from: names.get(String(c.from)) ?? null, to: names.get(String(c.to)) ?? null };
    else if (k === "accountId") readable.plannedAccountName = { from: names.get(String(c.from)) ?? null, to: names.get(String(c.to)) ?? null };
    else readable[k] = c;
  }
  const { after } = await patchReceivable(id, ["aberto"], (before) => {
    if ((before.payments?.length ?? 0) > 0 && roundCents(next.amount) !== roundCents(before.amount)) throw new BusinessError("O valor só muda sem recebimentos registrados");
    return {
      description: next.description,
      amount: next.amount,
      dueDate: next.dueDate,
      competence: next.competence,
      clientId: next.clientId ?? deleteField(),
      payerName: next.payerName,
      categoryId: next.categoryId ?? deleteField(),
      costCenterId: next.costCenterId ?? deleteField(),
      accountId: next.accountId ?? deleteField(),
      documentNumber: next.documentNumber ?? deleteField(),
      notes: next.notes ?? deleteField(),
      updatedBy: actor.id,
      history: [...(before.history ?? []), history(actor, "Alterado", { reason, changes: readable })],
    };
  });
  await emitReceivable("receivable.updated", actor, after, `Título a receber ${code(after)} alterado`, { changes: readable, reason }, reason);
  return after;
}

async function nameLookup(categoryIds: (string | undefined)[], centerIds: (string | undefined)[], accountIds: (string | undefined)[]): Promise<Map<string, string>> {
  const clean = (ids: (string | undefined)[]) => Array.from(new Set(ids.filter((x): x is string => Boolean(x))));
  const [cats, centers, accounts] = await Promise.all([getManyByIds<FinanceCategory>(COLLECTIONS.financeCategories, clean(categoryIds)), getManyByIds<CostCenter>(COLLECTIONS.costCenters, clean(centerIds)), getManyByIds<FinancialAccount>(COLLECTIONS.financialAccounts, clean(accountIds))]);
  const out = new Map<string, string>();
  for (const m of [cats, centers, accounts]) for (const [k, v] of m) out.set(k, v.name);
  return out;
}

/** Cancelar (em vez de excluir — decisão 4): só título aberto SEM recebimento; motivo obrigatório. */
export async function cancelReceivable(id: string, reason: string, actor: UserRef): Promise<Receivable> {
  const trimmed = reason.trim();
  const now = nowIso();
  const { before, after } = await patchReceivable(id, ["aberto"], (cur) => {
    if ((cur.payments?.length ?? 0) > 0) throw new BusinessError("Este título tem recebimento registrado: desfaça os recebimentos antes de cancelar, ou quite pelo já recebido");
    return { status: "cancelado", cancelledAt: now, cancelledBy: actor.id, cancelReason: trimmed, updatedBy: actor.id, history: [...(cur.history ?? []), history(actor, "Cancelado", { from: "aberto", to: "cancelado", reason: trimmed }, now)] };
  });
  await emitReceivable("receivable.cancelled", actor, after, `Título a receber ${code(after)} cancelado`, auditChanges<Receivable>(before, after, ["status"], trimmed) as unknown as Record<string, unknown>, trimmed);
  return after;
}

// ---------------------------------------------------------------------------
// Recebimentos (quitar, parcial, resíduo), quitar pelo já recebido e desfazer
// ---------------------------------------------------------------------------

export interface ReceiveInput {
  paidAt: string;
  method: string;
  accountId: string;
  amount?: number;
  receiptUrl?: string;
  notes?: string;
  reason?: string;
}

export interface ReceiveResult {
  receivable: Receivable;
  cashEntry: CashEntry;
  residual?: Receivable;
  settled: boolean;
}

/**
 * Recebimento (uma transação): baixa em `payments[]` + lançamento de RECEITA + novo valor (quitar com desconto/juros,
 * resíduo) + título "— Resíduo" (modo resíduo). A conta é obrigatória (lida e validada na transação).
 */
export async function receiveReceivable(mode: PaymentMode, id: string, input: ReceiveInput, actor: UserRef, options: { emit?: boolean; at?: string } = {}): Promise<ReceiveResult> {
  const accountId = input.accountId?.trim();
  if (!accountId) throw new BusinessError(ACCOUNT_REQUIRED_MESSAGE);
  const day = input.paidAt.slice(0, 10);
  const at = options.at ?? nowIso();
  const reason = input.reason?.trim() || undefined;
  const ref = col(COLLECTIONS.receivables).doc(id);
  const cashEntryId = newCashEntryId();
  const paymentId = `bx_${cashEntryId}`;
  const residualRef = mode === "residuo" ? col(COLLECTIONS.receivables).doc() : null;
  const numbering = residualRef ? await prepareNextNumber("REC", { pad: 5, year: dateKey(at).slice(0, 4), initFrom: { collection: COLLECTIONS.receivables, field: "code" } }) : null;
  const result = await firestore.runTransaction(async (tx) => {
    const snap = await txGetOwn(tx, ref);
    if (!snap) throw new BusinessError("Título a receber não encontrado");
    const before = { ...(snap.data() as Omit<Receivable, "id">), id } as Receivable;
    if (before.status !== "aberto") throw new BusinessError(before.status === "pago" ? "Este título já está recebido" : "Título cancelado não recebe baixa");
    const paidBefore = receivablePaidAmount(before);
    const plan = planPayment(mode, { amount: before.amount, paid: paidBefore }, input.amount);
    if (!plan.ok) throw new BusinessError(plan.error);
    const { payAmount, newAmount, amountChanged, settles, residualAmount } = plan.value;
    const account = (await txReadPaymentAccount(tx, accountId))!;
    const number = numbering ? await txNextNumber(tx, numbering) : null;
    // ---- escritas
    const draft = buildReceivableCashEntry(before, paymentId, { date: day, amount: payAmount, accountId: account.id, actor })!;
    const payment = cleanPatch({ id: paymentId, date: day, amount: payAmount, accountId: account.id, transactionId: cashEntryId, method: input.method, receiptUrl: input.receiptUrl, by: actor.id, byName: actor.name, at }) as unknown as ReceivablePayment;
    const openAfter = settles ? 0 : openAmount(before.amount, paidBefore + payAmount);
    const action =
      mode === "residuo"
        ? `Recebido com resíduo: ${brl(payAmount)} (${input.method}) · conta ${account.name} · resíduo ${number?.code} de ${brl(residualAmount)}`
        : mode === "parcial"
          ? settles
            ? `Recebido (recebimento parcial de ${brl(payAmount)} quitou o restante, ${input.method}) · conta ${account.name}`
            : `Recebimento parcial de ${brl(payAmount)} (${input.method}) · conta ${account.name} · em aberto ${brl(openAfter)}`
          : `Recebido (${input.method}) · conta ${account.name}${amountChanged ? ` · valor ajustado de ${brl(before.amount)} para ${brl(newAmount)}` : ""}${paidBefore ? ` · ${brl(payAmount)} neste recebimento` : ""}`;
    const entry = history(actor, action, { from: "aberto", to: settles ? "pago" : undefined, reason: reason ?? (input.notes?.trim() || undefined), changes: amountChanged ? { amount: { from: before.amount, to: newAmount } } : undefined }, at);
    const patch = cleanPatch({
      ...(settles ? { status: "pago", paidAt: noonIso(day) } : {}),
      payments: [...(before.payments ?? []), payment],
      ...(amountChanged ? { amount: newAmount, originalAmount: originalAmountFor(before) } : {}),
      ...(residualRef ? { residualId: residualRef.id } : {}),
      updatedBy: actor.id,
      updatedAt: nowIso(),
      history: [...(before.history ?? []), entry],
    });
    tx.update(ref, patch);
    const cashEntry = txCreateCashEntry(tx, cashEntryId, draft);
    let residual: Receivable | undefined;
    if (residualRef && number) {
      const now = nowIso();
      const data = stripUndefined({
        organizationId: ORG_ID,
        code: number.code,
        description: residualDescription(before.description),
        amount: residualAmount,
        dueDate: before.dueDate,
        competence: before.competence,
        clientId: before.clientId,
        payerName: before.payerName,
        categoryId: before.categoryId,
        costCenterId: before.costCenterId,
        accountId: before.accountId,
        documentNumber: before.documentNumber,
        notes: residualNote(before, payAmount, residualAmount).replace("foram pagos", "foram recebidos").replace("baixa com resíduo", "recebimento com resíduo"),
        status: "aberto",
        seriesId: before.seriesId,
        residualOf: before.id,
        history: [history(actor, `Resíduo do título ${code(before)}: ${brl(residualAmount)} restantes`, { to: "aberto", reason }, now)],
        createdBy: actor.id,
        createdAt: now,
        updatedAt: now,
      }) as Omit<Receivable, "id">;
      tx.set(residualRef, data);
      number.commit();
      residual = { ...data, id: residualRef.id } as Receivable;
    }
    return { before, after: { ...before, ...(patch as Partial<Receivable>) } as Receivable, cashEntry, accountName: account.name, residual, settles, paidBefore, payAmount, openAfter };
  });
  const { before, after, cashEntry, accountName, residual, settles, paidBefore, payAmount, openAfter } = result;
  if (options.emit !== false) {
    const tail = `${formatDate(noonIso(day))} · ${input.method} · conta ${accountName}${input.receiptUrl ? " · com comprovante" : ""}`;
    const money = { mode, paymentAmount: payAmount, accountId: cashEntry.accountId, cashEntryId: cashEntry.id, paymentId };
    if (settles) {
      const audit = auditChanges<Receivable>(before, after, ["status", "paidAt", "amount"], reason ?? input.notes);
      if (residual) audit.changes.residualCode = { from: null, to: residual.code ?? residual.id };
      const what = residual ? ` com resíduo (${brl(payAmount)} recebidos; resíduo ${residual.code} de ${brl(residual.amount)})` : "";
      await emitReceivable("receivable.received", actor, after, `Título a receber ${code(after)} recebido${what}: ${brl(after.amount)} de ${after.payerName}`, { ...audit, ...money }, tail);
    } else {
      const changes = { paidTotal: { from: paidBefore, to: roundCents(paidBefore + payAmount) }, openAmount: { from: openAmount(before.amount, paidBefore), to: openAfter } };
      await emitReceivable("receivable.partially_received", actor, after, `Recebimento parcial do título ${code(after)}: ${brl(payAmount)} (em aberto ${brl(openAfter)})`, { changes, ...(reason ? { reason } : {}), ...money }, tail);
    }
    await emitCashEntryEvent("cash_entry.created", actor, cashEntry, { accountName });
    if (residual) {
      await emitReceivable("receivable.residual_created", actor, residual, `Título a receber ${residual.code} (resíduo de ${code(before)}): ${brl(residual.amount)} de ${residual.payerName}`, { residualOf: before.id, originalCode: before.code ?? null, changes: { residualAmount: { from: null, to: residual.amount }, status: { from: null, to: "aberto" } }, ...(reason ? { reason } : {}) }, residual.notes);
    }
  }
  return { receivable: after, cashEntry, residual, settled: settles };
}

/** Quitar pelo já recebido: valor := já recebido, status pago, sem nova baixa nem lançamento. */
export async function settleReceivableByPaid(id: string, input: { reason?: string }, actor: UserRef): Promise<Receivable> {
  const reason = input.reason?.trim() || undefined;
  const now = nowIso();
  const { before, after } = await patchReceivable(id, ["aberto"], (cur) => {
    const paid = receivablePaidAmount(cur);
    const plan = planSettleByPaid({ amount: cur.amount, paid, paymentsCount: cur.payments?.length ?? 0 });
    if (!plan.ok) throw new BusinessError(plan.error.replace("já pago", "já recebido"));
    const last = cur.payments![cur.payments!.length - 1];
    return {
      status: "pago",
      amount: plan.value.newAmount,
      originalAmount: originalAmountFor(cur),
      paidAt: noonIso(last.date),
      updatedBy: actor.id,
      history: [...(cur.history ?? []), history(actor, `Quitado pelo já recebido: valor ajustado de ${brl(cur.amount)} para ${brl(plan.value.newAmount)} (sem nova baixa)`, { from: "aberto", to: "pago", reason, changes: { amount: { from: cur.amount, to: plan.value.newAmount } } }, now)],
    };
  });
  await emitReceivable("receivable.settled_by_paid", actor, after, `Título a receber ${code(after)} quitado pelo já recebido: ${brl(after.amount)} (era ${brl(before.amount)})`, auditChanges<Receivable>(before, after, ["status", "amount", "paidAt"], reason) as unknown as Record<string, unknown>, reason ?? "Sem nova baixa nem lançamento de caixa");
  return after;
}

/**
 * Desfazer UM recebimento (indicado ou o último): remove a baixa e apaga o lançamento NA MESMA transação; título pago
 * volta a "Em aberto" (e ao valor original quando a quitação tinha ajustado o valor sem resíduo).
 */
export async function undoReceivablePayment(id: string, input: { reason: string; paymentId?: string }, actor: UserRef): Promise<{ receivable: Receivable; cashEntryId?: string }> {
  const reason = input.reason.trim();
  if (reason.length < 5) throw new BusinessError("Descreva o motivo para desfazer o recebimento (mín. 5 caracteres)");
  const ref = col(COLLECTIONS.receivables).doc(id);
  const result = await firestore.runTransaction(async (tx) => {
    const snap = await txGetOwn(tx, ref);
    if (!snap) throw new BusinessError("Título a receber não encontrado");
    const before = { ...(snap.data() as Omit<Receivable, "id">), id } as Receivable;
    if (before.status === "cancelado") throw new BusinessError("Título cancelado não tem recebimento a desfazer");
    if ((before.payments?.length ?? 0) === 0) throw new BusinessError("Este título não tem recebimento registrado");
    const plan = planUndoPayment({ settled: before.status === "pago", amount: before.amount, originalAmount: before.originalAmount, residualId: before.residualId, payments: before.payments }, input.paymentId);
    if (!plan.payment) throw new BusinessError("Recebimento não encontrado neste título");
    const cashEntry = plan.payment.transactionId ? await txReadCashEntry(tx, plan.payment.transactionId) : null;
    const now = nowIso();
    const restore = plan.restoreAmount;
    const label = `${plan.reopen ? "Recebimento desfeito" : "Recebimento parcial desfeito"} (${brl(plan.payment.amount)})${cashEntry ? " · lançamento de caixa apagado" : ""}${restore !== undefined ? ` · valor volta para ${brl(restore)}` : ""}`;
    const patch: Record<string, unknown> = {
      ...(plan.reopen ? { status: "aberto", paidAt: deleteField() } : {}),
      payments: plan.remaining.length ? plan.remaining : deleteField(),
      ...(restore !== undefined ? { amount: restore, originalAmount: deleteField() } : {}),
      updatedBy: actor.id,
      updatedAt: now,
      history: [...(before.history ?? []), history(actor, label, { ...(plan.reopen ? { from: "pago" as const, to: "aberto" as const } : {}), reason, ...(restore !== undefined ? { changes: { amount: { from: before.amount, to: restore } } } : {}) }, now)],
    };
    tx.update(ref, patch);
    if (cashEntry) txDeleteCashEntry(tx, cashEntry.id);
    const after = { ...before, history: patch.history as ReceivableHistoryEntry[] } as Receivable;
    if (plan.reopen) {
      after.status = "aberto";
      delete after.paidAt;
    }
    if (plan.remaining.length) after.payments = plan.remaining;
    else delete after.payments;
    if (restore !== undefined) {
      after.amount = restore;
      delete after.originalAmount;
    }
    return { before, after, cashEntry, payment: plan.payment, reopen: plan.reopen };
  });
  const { before, after, cashEntry, payment, reopen } = result;
  const audit = auditChanges<Receivable>(before, after, ["status", "paidAt", "amount"], reason);
  const paidBefore = receivablePaidAmount(before);
  audit.changes.paidTotal = { from: paidBefore, to: roundCents(paidBefore - payment.amount) };
  audit.changes.openAmount = { from: reopen ? 0 : openAmount(before.amount, paidBefore), to: openAmount(after.amount, paidBefore - payment.amount) };
  const account = cashEntry ? await getById<FinancialAccount>(COLLECTIONS.financialAccounts, cashEntry.accountId) : null;
  await emitReceivable("receivable.payment_undone", actor, after, `Recebimento do título ${code(after)} desfeito (${brl(payment.amount)})`, { ...audit, paymentId: payment.id, cashEntryId: cashEntry?.id ?? null, accountId: cashEntry?.accountId ?? null }, `${reason}${cashEntry ? ` · lançamento de ${brl(cashEntry.amount)} apagado${account ? ` da conta ${account.name}` : ""}` : ""}`);
  if (cashEntry) await emitCashEntryEvent("cash_entry.deleted", actor, cashEntry, { accountName: account?.name, reason: `Recebimento do título ${code(after)} desfeito: ${reason}` });
  return { receivable: after, cashEntryId: cashEntry?.id };
}

// ---------------------------------------------------------------------------
// Anexos (mesmo padrão de documentos dos títulos a pagar)
// ---------------------------------------------------------------------------

export async function addReceivableAttachment(receivableId: string, input: { name: string; url: string }, actor: UserRef, options: { emit?: boolean } = {}): Promise<Document> {
  const r = await loadReceivable(receivableId);
  if (r.status === "cancelado") throw new BusinessError("Título cancelado não recebe anexos");
  const doc = await create<Document>(COLLECTIONS.documents, {
    clientId: r.clientId,
    entityType: "receivable",
    entityId: r.id,
    name: input.name.trim(),
    url: input.url.trim(),
    version: 1,
    uploadedBy: actor.id,
    category: "Contas a receber",
    createdBy: actor.id,
  });
  const attachmentIds = [...(r.attachmentIds ?? []), doc.id];
  await update<Receivable>(COLLECTIONS.receivables, r.id, { attachmentIds });
  if (options.emit !== false) await emitReceivable("receivable.updated", actor, { ...r, attachmentIds }, `Anexo adicionado ao título a receber ${code(r)}: ${doc.name}`, { attachmentId: doc.id, url: doc.url, changes: { attachments: { from: r.attachmentIds?.length ?? 0, to: attachmentIds.length } } }, doc.url);
  return doc;
}

export async function listReceivableAttachments(r: Pick<Receivable, "attachmentIds">): Promise<Document[]> {
  if (!r.attachmentIds?.length) return [];
  const docs = await getManyByIds<Document>(COLLECTIONS.documents, r.attachmentIds);
  return r.attachmentIds.map((x) => docs.get(x)).filter((d): d is Document => Boolean(d));
}
