import "server-only";
/**
 * Regras de cobrança: plano de parcelas de um contrato, critérios do gate de liberação, aging de
 * contas a receber e a detecção automática de vencidas (feita na leitura, sem cron).
 */
import { firestore } from "@/server/firebase-admin";
import { col, getManyByIds, list, nowIso, type ListOptions } from "@/server/db";
import { emitEvent } from "@/server/events";
import { dateKey, formatCurrency, formatDate } from "@/lib/format";
import { COLLECTIONS, type Billing, type Client, type Contract, type UserRef } from "@/domain/types";
import type { FinanceGateSettings, ReleaseCheck, ReleaseGate } from "./schemas";

export const SYSTEM_ACTOR: UserRef = { id: "system", name: "INTEROS (automação)" };

const TYPE_LABEL: Record<Billing["type"], string> = { setup: "Adesão", mensalidade: "Mensalidade", hardware: "Hardware", servico: "Serviço" };

// ---------------------------------------------------------------------------
// Datas
// ---------------------------------------------------------------------------

/** Hoje (AAAA-MM-DD) no fuso da operação. */
export function todayKey(): string {
  return dateKey(new Date());
}

/** ISO de uma data AAAA-MM-DD às 12:00 UTC (09:00 em São Paulo), padrão dos vencimentos. */
export function dueIso(key: string): string {
  return `${key.slice(0, 10)}T12:00:00.000Z`;
}

/** Dia `day` do mês `offset` meses depois de AAAA-MM (limitado ao último dia do mês). */
export function dayInMonth(yearMonth: string, offset: number, day: number): string {
  const [y, m] = yearMonth.split("-").map(Number);
  const first = new Date(Date.UTC(y, m - 1 + offset, 1));
  const last = new Date(Date.UTC(first.getUTCFullYear(), first.getUTCMonth() + 1, 0)).getUTCDate();
  const d = new Date(Date.UTC(first.getUTCFullYear(), first.getUTCMonth(), Math.min(day, last), 12));
  return d.toISOString();
}

/** Diferença em dias corridos entre duas chaves AAAA-MM-DD (b - a). */
export function daysBetween(a: string, b: string): number {
  return Math.round((Date.parse(`${b.slice(0, 10)}T00:00:00Z`) - Date.parse(`${a.slice(0, 10)}T00:00:00Z`)) / 86_400_000);
}

/** Primeiro vencimento padrão: próximo dia `billingDay` que esteja a pelo menos 3 dias de hoje. */
export function defaultFirstDueDate(billingDay: number): string {
  const today = todayKey();
  for (let offset = 0; offset < 3; offset++) {
    const candidate = dayInMonth(today.slice(0, 7), offset, billingDay);
    if (daysBetween(today, dateKey(candidate)) >= 3) return candidate;
  }
  return dayInMonth(today.slice(0, 7), 1, billingDay);
}

// ---------------------------------------------------------------------------
// Plano de cobranças
// ---------------------------------------------------------------------------

export type BillingDraft = Pick<Billing, "clientId" | "contractId" | "type" | "competence" | "installment" | "amount" | "dueDate" | "status" | "method">;

/**
 * Cobranças de um contrato: adesão e hardware no primeiro vencimento; mensalidades do prazo
 * (recorrência mensal = 1 por mês; anual = 1 por ano no valor de 12 meses; único = nenhuma).
 */
export function buildBillingPlan(contract: Contract, firstDueDate: string): BillingDraft[] {
  const drafts: BillingDraft[] = [];
  const firstKey = dateKey(firstDueDate);
  const base = { clientId: contract.clientId, contractId: contract.id, status: "aberta" as const, method: "boleto" };
  if (contract.setupTotal > 0) drafts.push({ ...base, type: "setup", competence: firstKey.slice(0, 7), amount: round2(contract.setupTotal), dueDate: firstDueDate });
  if (contract.hardwareTotal > 0) drafts.push({ ...base, type: "hardware", competence: firstKey.slice(0, 7), amount: round2(contract.hardwareTotal), dueDate: firstDueDate });
  if (contract.monthlyTotal > 0 && contract.recurrence !== "unico") {
    const step = contract.recurrence === "anual" ? 12 : 1;
    const count = contract.recurrence === "anual" ? Math.max(1, Math.ceil(contract.termMonths / 12)) : contract.termMonths;
    const amount = round2(contract.monthlyTotal * step);
    for (let i = 0; i < count; i++) {
      // A 1ª parcela vence junto com a adesão; as demais no dia de vencimento dos meses seguintes.
      const dueDate = i === 0 ? firstDueDate : dayInMonth(firstKey.slice(0, 7), i * step, contract.billingDay);
      drafts.push({ ...base, type: "mensalidade", competence: dateKey(dueDate).slice(0, 7), installment: i + 1, amount, dueDate });
    }
  }
  return drafts;
}

export const round2 = (n: number) => Math.round(n * 100) / 100;

// ---------------------------------------------------------------------------
// Gate de liberação
// ---------------------------------------------------------------------------

/** Cobrança que o gate exige paga, conforme a configuração (null quando nenhuma é exigida). */
export function requiredPaymentBilling(billings: Billing[], requirement: FinanceGateSettings["exigePagamento"]): Billing | null {
  const active = billings.filter((b) => b.status !== "cancelada").sort((a, b) => a.dueDate.localeCompare(b.dueDate) || (a.installment ?? 0) - (b.installment ?? 0));
  if (requirement === "nenhum" || active.length === 0) return null;
  if (requirement === "setup") return active.find((b) => b.type === "setup") ?? active[0];
  return active.find((b) => b.type === "mensalidade" && b.installment === 1) ?? active.find((b) => b.type === "mensalidade") ?? active[0];
}

export function allSigned(contract: Pick<Contract, "signers">): boolean {
  return contract.signers.length > 0 && contract.signers.every((s) => s.status === "assinado");
}

/** Avalia os critérios configuráveis do gate financeiro para o botão "Liberar para implantação". */
export function evaluateReleaseGate(contract: Contract, billings: Billing[], settings: FinanceGateSettings): ReleaseGate {
  const active = billings.filter((b) => b.status !== "cancelada");
  const checks: ReleaseCheck[] = [];
  checks.push({ key: "cobrancas", label: "Cobranças geradas", ok: active.length > 0, detail: active.length > 0 ? `${active.length} cobrança(s)` : "Gere as cobranças do contrato" });
  if (settings.exigeContratoAssinado) {
    const signed = contract.signers.filter((s) => s.status === "assinado").length;
    checks.push({ key: "assinatura", label: "Contrato assinado por todos", ok: allSigned(contract), detail: `${signed}/${contract.signers.length} assinatura(s)` });
  }
  if (settings.exigePagamento !== "nenhum") {
    const required = requiredPaymentBilling(billings, settings.exigePagamento);
    const label = settings.exigePagamento === "setup" ? "Adesão paga" : "Primeira mensalidade paga";
    checks.push({
      key: "pagamento",
      label,
      ok: required?.status === "paga",
      detail: required ? `${TYPE_LABEL[required.type]}${required.installment ? ` ${required.installment}` : ""} · ${formatCurrency(required.amount)} · vence ${formatDate(required.dueDate)}` : "Nenhuma cobrança gerada",
    });
  }
  checks.push({ key: "pendencia", label: "Sem pendência financeira", ok: contract.status !== "pendencia", detail: contract.pendingReason });
  const releasable = contract.status !== "liberado" && contract.status !== "cancelado";
  return { ok: releasable && checks.every((c) => c.ok), checks, settings };
}

/**
 * Status do contrato derivado do seu estado (usado ao resolver pendência e após pagamentos).
 * Liberado e cancelado são terminais e não mudam aqui.
 */
export function deriveContractStatus(contract: Contract, billings: Billing[], settings: FinanceGateSettings): Contract["status"] {
  if (contract.status === "liberado" || contract.status === "cancelado") return contract.status;
  if (!contract.signatureEnvelopeId) return "aguardando_contrato";
  if (!allSigned(contract)) return "aguardando_assinatura";
  const active = billings.filter((b) => b.status !== "cancelada");
  if (active.length === 0) return "assinado";
  const required = requiredPaymentBilling(billings, settings.exigePagamento === "nenhum" ? "setup" : settings.exigePagamento);
  return required?.status === "paga" ? "pago" : "aguardando_pagamento";
}

// ---------------------------------------------------------------------------
// Vencidas: detecção na leitura
// ---------------------------------------------------------------------------

/** Cobrança em aberto com vencimento anterior a hoje (fuso da operação). */
export function isPastDue(billing: Pick<Billing, "status" | "dueDate">, today = todayKey()): boolean {
  return billing.status === "aberta" && dateKey(billing.dueDate) < today;
}

/**
 * Marca como vencidas as cobranças em aberto já vencidas e emite `payment.overdue` uma única vez por
 * cobrança (a troca de status é transacional: leituras concorrentes não duplicam o evento).
 * Devolve a lista com os status atualizados.
 */
export async function sweepOverdue(billings: Billing[]): Promise<Billing[]> {
  const today = todayKey();
  const due = billings.filter((b) => isPastDue(b, today));
  if (due.length === 0) return billings;
  const flipped = new Set<string>();
  for (const b of due) {
    const ref = col(COLLECTIONS.billing).doc(b.id);
    const changed = await firestore.runTransaction(async (tx) => {
      const snap = await tx.get(ref);
      if (snap.get("status") !== "aberta") return false;
      tx.update(ref, { status: "vencida", updatedAt: nowIso() });
      return true;
    });
    if (changed) flipped.add(b.id);
  }
  if (flipped.size > 0) {
    const clients = await getManyByIds<Client>(COLLECTIONS.clients, due.map((b) => b.clientId));
    for (const b of due.filter((x) => flipped.has(x.id))) {
      const client = clients.get(b.clientId);
      await emitEvent({
        type: "payment.overdue",
        actor: SYSTEM_ACTOR,
        clientId: b.clientId,
        entity: { type: "billing", id: b.id },
        title: `Cobrança vencida: ${TYPE_LABEL[b.type]}${b.installment ? ` ${b.installment}` : ""} de ${formatCurrency(b.amount)}`,
        description: `${client?.tradeName ?? "Cliente"} · vencimento ${formatDate(b.dueDate)}`,
        department: "financeiro",
        payload: { billingId: b.id, contractId: b.contractId, clientId: b.clientId, type: b.type, installment: b.installment ?? null, amount: b.amount, dueDate: b.dueDate },
      });
    }
  }
  return billings.map((b) => (isPastDue(b, today) ? { ...b, status: "vencida" as const } : b));
}

/** Lista cobranças já com a varredura de vencidas aplicada. */
export async function listBillingsSwept(options: ListOptions = {}): Promise<Billing[]> {
  return sweepOverdue(await list<Billing>(COLLECTIONS.billing, options));
}

// ---------------------------------------------------------------------------
// Aging
// ---------------------------------------------------------------------------

export const AGING_BUCKETS = [
  { key: "a_vencer_0_7", label: "A vencer 0–7 dias", overdue: false },
  { key: "a_vencer_8_30", label: "A vencer 8–30 dias", overdue: false },
  { key: "a_vencer_31", label: "A vencer 31+ dias", overdue: false },
  { key: "vencida_1_15", label: "Vencidas 1–15 dias", overdue: true },
  { key: "vencida_16_30", label: "Vencidas 16–30 dias", overdue: true },
  { key: "vencida_31_60", label: "Vencidas 31–60 dias", overdue: true },
  { key: "vencida_60", label: "Vencidas 60+ dias", overdue: true },
] as const;
export type AgingBucketKey = (typeof AGING_BUCKETS)[number]["key"];

/** Faixa de aging de uma cobrança em aberto/vencida (dias em relação a hoje). */
export function agingBucket(billing: Pick<Billing, "dueDate">, today = todayKey()): AgingBucketKey {
  const days = daysBetween(today, dateKey(billing.dueDate));
  if (days >= 0) return days <= 7 ? "a_vencer_0_7" : days <= 30 ? "a_vencer_8_30" : "a_vencer_31";
  const late = -days;
  if (late <= 15) return "vencida_1_15";
  if (late <= 30) return "vencida_16_30";
  if (late <= 60) return "vencida_31_60";
  return "vencida_60";
}

