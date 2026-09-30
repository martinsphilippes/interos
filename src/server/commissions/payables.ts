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
import { col, create, createIfAbsent, getById, getManyByIds, newId, nowIso, stripUndefined, update } from "@/server/db";
import { emitEvent } from "@/server/events";
import { getSetting } from "@/server/admin/queries";
import { SETTING_DEFAULTS, type ComissoesPagamentoConfig, type ContasAPagarConfig } from "@/server/admin/schemas";
import { auditChanges, describeChanges } from "@/server/audit";
import { dayInMonth } from "@/server/finance/billing";
import { dateKey, formatCurrency, formatDate } from "@/lib/format";
import { COMMISSION_REVENUE_LABELS, PAYABLE_CATEGORIES, PAYABLE_STATUS_LABELS, payableCategoryLabel } from "@/domain/commissions";
import { COLLECTIONS, type Client, type Commission, type Document, type Payable, type PayableHistoryEntry, type PayableRecurrence, type PayableStatus, type Supplier, type User, type UserRef } from "@/domain/types";
import { assignPayableCode, cleanPatch, deleteField, historyEntry, SYSTEM_ACTOR, transitionCommission } from "./store";

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
    const snap = await tx.get(ref);
    if (!snap.exists) throw new Error("Título não encontrado");
    const before = { ...(snap.data() as Omit<Payable, "id">), id } as Payable;
    if (!allowed.includes(before.status)) throw new Error(`Título ${PAYABLE_STATUS_LABELS[before.status].toLowerCase()} não permite esta ação`);
    const data = cleanPatch({ ...patch, updatedAt: nowIso(), history: [...(before.history ?? []), entry] });
    tx.update(ref, data);
    return { before, after: { ...before, ...(data as Partial<Payable>) } };
  });
}

async function emitPayable(type: "payable.created" | "payable.approved" | "payable.scheduled" | "payable.paid" | "payable.cancelled" | "payable.updated", actor: UserRef, p: Payable, title: string, payload: Record<string, unknown>, description?: string) {
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
}

/** Baixa do título + comissões pagas na mesma transação (commission.paid e payable.paid uma única vez). */
export async function payPayable(id: string, input: PayPayableInput, actor: UserRef, options: { emit?: boolean; at?: string } = {}): Promise<{ payable: Payable; commissionIds: string[] }> {
  const paidAt = `${input.paidAt.slice(0, 10)}T12:00:00.000Z`;
  const at = options.at ?? nowIso();
  const ref = col(COLLECTIONS.payables).doc(id);
  const result = await firestore.runTransaction(async (tx) => {
    const snap = await tx.get(ref);
    if (!snap.exists) throw new Error("Título não encontrado");
    const before = { ...(snap.data() as Omit<Payable, "id">), id } as Payable;
    if (before.status !== "aprovado" && before.status !== "a_pagar") throw new Error(before.status === "pago" ? "Este título já está pago" : "Aprove o título antes de pagar");
    const commissionRefs = (before.sourceIds.commissionIds ?? []).map((cid) => col(COLLECTIONS.commissions).doc(cid));
    const commissionSnaps = commissionRefs.length > 0 ? await tx.getAll(...commissionRefs) : [];
    const entry = payableHistory(actor, `Pago (${input.paymentMethod})`, { from: before.status, to: "pago", reason: input.notes }, at);
    const patch = cleanPatch({ status: "pago", paidAt, paidBy: actor.id, paymentMethod: input.paymentMethod, receiptUrl: input.receiptUrl, notes: input.notes ?? before.notes, updatedAt: nowIso(), history: [...(before.history ?? []), entry] });
    tx.update(ref, patch);
    const paidCommissions: string[] = [];
    for (const cs of commissionSnaps) {
      const c = cs.data() as Commission | undefined;
      if (!c || c.status !== "titulo_gerado" || c.payableId !== id) continue;
      tx.update(cs.ref, cleanPatch({ status: "paga", paidAt, updatedAt: nowIso(), history: [...(c.history ?? []), historyEntry(actor, "paga", "titulo_gerado", `Título ${code(before)} pago em ${formatDate(paidAt)}`, at)] }));
      paidCommissions.push(cs.id);
    }
    return { before, after: { ...before, ...(patch as Partial<Payable>) }, paidCommissions };
  });
  const { before, after, paidCommissions } = result;
  if (options.emit !== false) {
    const audit = auditChanges<Payable>(before, after, ["status", "paidAt", "paymentMethod", "receiptUrl"], input.notes);
    await emitPayable("payable.paid", actor, after, `Título ${code(after)} pago: ${formatCurrency(after.amount)} para ${after.creditorName}`, { ...audit, paidCommissionIds: paidCommissions }, `${formatDate(paidAt)} · ${input.paymentMethod}${input.receiptUrl ? " · com comprovante" : ""}`);
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
  return { payable: after, commissionIds: paidCommissions };
}

/** Cancela o título (antes de pago). Comissões ligadas voltam para "Elegível" com o motivo (novo título sob demanda). */
export async function cancelPayable(id: string, reason: string, actor: UserRef, options: { emit?: boolean } = {}): Promise<{ payable: Payable; commissionIds: string[] }> {
  const trimmed = reason.trim();
  if (trimmed.length < 5) throw new Error("Descreva o motivo do cancelamento");
  const ref = col(COLLECTIONS.payables).doc(id);
  const result = await firestore.runTransaction(async (tx) => {
    const snap = await tx.get(ref);
    if (!snap.exists) throw new Error("Título não encontrado");
    const before = { ...(snap.data() as Omit<Payable, "id">), id } as Payable;
    if (before.status === "pago") throw new Error("Título pago não pode ser cancelado: estorne a comissão");
    if (before.status === "cancelado") throw new Error("Este título já está cancelado");
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
}

/** Alteração manual do título (auditada): valor só em título manual ainda não aprovado. */
export async function updatePayable(id: string, input: UpdatePayableInput, actor: UserRef): Promise<Payable> {
  const reason = input.reason.trim();
  if (reason.length < 5) throw new Error("Informe o motivo da alteração");
  const current = await loadPayable(id);
  if (current.status === "pago" || current.status === "cancelado") throw new Error("Título pago ou cancelado não pode ser alterado");
  if (input.amount !== undefined && input.amount !== current.amount && (current.origin !== "manual" || current.status !== "previsto")) throw new Error("O valor só pode ser alterado em título manual ainda previsto (o de comissão segue a memória de cálculo)");
  const patch: Partial<Payable> = {
    description: input.description?.trim() || current.description,
    dueDate: input.dueDate ? `${input.dueDate.slice(0, 10)}T12:00:00.000Z` : current.dueDate,
    amount: input.amount ?? current.amount,
    notes: input.notes?.trim() || current.notes,
    costCenter: input.costCenter?.trim() || current.costCenter,
  };
  if (input.recurrenceUntil && current.recurrence) patch.recurrence = { ...current.recurrence, until: input.recurrenceUntil.slice(0, 10) };
  const audit = auditChanges<Payable>(current, { ...current, ...patch }, ["description", "dueDate", "amount", "notes", "costCenter", "recurrence"], reason);
  if (Object.keys(audit.changes).length === 0) return current;
  const { after } = await transitionPayable(id, [current.status], patch, payableHistory(actor, "Alterado", { reason, changes: audit.changes }));
  await emitPayable("payable.updated", actor, after, `Título ${code(after)} alterado`, audit as unknown as Record<string, unknown>, describeChanges(audit, { description: "Descrição", dueDate: "Vencimento", amount: "Valor", notes: "Observações", costCenter: "Centro de custo", recurrence: "Recorrência" }, (field, v) => (v === null ? "—" : field === "amount" ? formatCurrency(Number(v)) : field === "dueDate" ? formatDate(String(v)) : typeof v === "object" ? JSON.stringify(v) : String(v))));
  return after;
}

export interface ManualPayableInput {
  creditorType: "colaborador" | "fornecedor";
  creditorId?: string;
  creditorName?: string;
  supplierId?: string;
  category: string;
  costCenter?: string;
  description: string;
  amount: number;
  competence: string;
  dueDate: string;
  notes?: string;
  installments?: number;
  recurrence?: PayableRecurrence;
  attachmentUrl?: string;
  attachmentName?: string;
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
  if (!settings.categorias.includes(input.category)) throw new Error(`Categoria "${input.category}" não está em Configurações › Contas a pagar`);
  if (input.costCenter && settings.centrosDeCusto.length > 0 && !settings.centrosDeCusto.includes(input.costCenter)) throw new Error(`Centro de custo "${input.costCenter}" não está em Configurações › Contas a pagar`);
  const n = Math.max(1, Math.min(48, Math.floor(input.installments ?? 1)));
  const now = options.createdAt ?? nowIso();
  const amount = Math.round(input.amount * 100) / 100;
  const base = {
    creditorType: input.creditorType,
    creditorId: input.creditorType === "colaborador" ? input.creditorId : undefined,
    creditorName,
    supplierId,
    category: input.category,
    costCenter: input.costCenter,
    status: "previsto" as const,
    origin: "manual" as const,
    sourceIds: { commissionIds: [] },
    notes: input.notes?.trim() || undefined,
    createdBy: actor.id,
  };
  const emitCreated = async (p: Payable, extra: Record<string, unknown> = {}) => {
    if (options.emit === false) return;
    await emitPayable("payable.created", actor, p, `Título ${p.code} lançado: ${formatCurrency(p.amount)} para ${creditorName}`, { origin: "manual", category: input.category, supplierId: supplierId ?? null, costCenter: input.costCenter ?? null, ...extra, ...auditChanges<Payable>(null, p, ["creditorName", "category", "description", "amount", "competence", "dueDate"]) }, `${payableCategoryLabel(input.category)}${p.installments ? ` · parcela ${p.installment}/${p.installments}` : ""}${p.recurrence ? ` · recorrente (${p.recurrence.frequency})` : ""} · vence ${formatDate(p.dueDate)}`);
  };

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
    if (input.attachmentUrl) await addPayableAttachment(parcels[0].id, { name: input.attachmentName?.trim() || `Anexo · ${input.description.trim()}`, url: input.attachmentUrl }, actor, { emit: false });
    return { ...parcels[0], parcels };
  }

  const payable = await create<Payable>(COLLECTIONS.payables, {
    ...base,
    description: input.description.trim(),
    amount,
    competence: input.competence,
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
  if (input.attachmentUrl) {
    const doc = await addPayableAttachment(payable.id, { name: input.attachmentName?.trim() || `Anexo · ${input.description.trim()}`, url: input.attachmentUrl }, actor, { emit: false });
    withCode.attachmentIds = [doc.id];
  }
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
