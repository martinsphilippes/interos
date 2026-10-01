/**
 * Baixas parciais, resíduo e quitação (etapa CP/CR 3) — regras PURAS (sem Firestore, sem React), usadas pelos serviços
 * de Contas a Pagar (`src/server/commissions/payables.ts`) e de títulos a receber avulsos (`src/server/receivables`),
 * pelas telas (status calculado e valor em aberto), pelo `verify.ts` do seed e pelos testes.
 *
 * Valores em reais arredondados em CENTAVOS; comparação com tolerância de meio centavo (`SETTLEMENT_TOLERANCE`).
 *  - pago (soma das baixas): baixas antigas sem `payments[]` (título a pagar pago antes da etapa 2) contam como UMA baixa
 *    do valor total;
 *  - valor em aberto = valor − pago, nunca negativo;
 *  - status CALCULADO (só exibição; o status gravado continua): Pago (pago + 0,005 ≥ valor e valor > 0, ou gravado
 *    pago), Vencido (não pago e vencimento < hoje), Parcial (não venceu e tem baixa), Em aberto (não venceu, sem baixa);
 *    cancelado continua cancelado.
 */
import { roundCents, type Check } from "./finance-registry";
import { payableUndoBlock, UNDO_COMMISSION_BLOCKED } from "./cash-entries";
import type { Payable, PayablePayment, Receivable } from "./types";

/** Meio centavo: diferenças menores são arredondamento. */
export const SETTLEMENT_TOLERANCE = 0.005;

export type SettlementStatus = "pago" | "vencido" | "parcial" | "em_aberto" | "cancelado";
export const SETTLEMENT_STATUS_LABELS: Record<SettlementStatus, string> = { pago: "Pago", vencido: "Vencido", parcial: "Parcial", em_aberto: "Em aberto", cancelado: "Cancelado" };

/** Sufixo do título que leva o restante de um pagamento parcial com resíduo (não empilha: resíduo de resíduo). */
export const RESIDUAL_SUFFIX = " — Resíduo";

const toCents = (value: number) => (Number.isFinite(value) ? Math.round(value * 100) : 0);
const fromCents = (cents: number) => (cents === 0 ? 0 : cents / 100);

// ---------------------------------------------------------------------------
// Pago, em aberto e status calculado
// ---------------------------------------------------------------------------

/** Soma das baixas em centavos exatos. */
export function sumPayments(payments: readonly Pick<PayablePayment, "amount">[] | undefined): number {
  return fromCents((payments ?? []).reduce((s, p) => s + toCents(p.amount), 0));
}

/** Já pago de um título a pagar: soma das baixas; título PAGO sem `payments[]` (antigo) = uma baixa do valor total. */
export function payablePaidAmount(p: Pick<Payable, "status" | "amount" | "payments">): number {
  if ((p.payments?.length ?? 0) === 0) return p.status === "pago" ? roundCents(p.amount) : 0;
  return sumPayments(p.payments);
}

/** Já recebido de um título a receber avulso (sempre pelas baixas: o título nasceu com a etapa 3). */
export function receivablePaidAmount(r: Pick<Receivable, "payments">): number {
  return sumPayments(r.payments);
}

/**
 * Valor em aberto = valor − pago, nunca negativo (centavos). Título NEGATIVO (estorno de comissão, "valor a recuperar")
 * espelha o cálculo e devolve o restante com o sinal do título.
 */
export function openAmount(amount: number, paid: number): number {
  if (!Number.isFinite(amount)) return 0;
  if (amount < 0) return fromCents(-Math.max(0, toCents(-amount) - toCents(-paid)));
  return fromCents(Math.max(0, toCents(amount) - toCents(paid)));
}

/** Quitado pela soma das baixas: valor > 0 e pago + 0,005 ≥ valor. */
export function isSettledByPayments(amount: number, paid: number): boolean {
  return amount > 0 && paid + SETTLEMENT_TOLERANCE >= amount;
}

export interface SettlementInput {
  amount: number;
  paid: number;
  /** ISO ou AAAA-MM-DD; comparado pelo dia (vencimentos são gravados ao meio-dia UTC). */
  dueDate: string;
  /** Status gravado reduzido: aberto (qualquer status antes de pago), pago ou cancelado. */
  recorded: "aberto" | "pago" | "cancelado";
  /** Hoje (AAAA-MM-DD, São Paulo). */
  today: string;
}

/** Status CALCULADO para exibição (ver cabeçalho). */
export function settlementStatus(input: SettlementInput): SettlementStatus {
  if (input.recorded === "cancelado") return "cancelado";
  if (input.recorded === "pago" || isSettledByPayments(input.amount, input.paid)) return "pago";
  if (input.dueDate.slice(0, 10) < input.today) return "vencido";
  if (toCents(input.paid) !== 0) return "parcial";
  return "em_aberto";
}

export interface SettlementView {
  paid: number;
  open: number;
  status: SettlementStatus;
  /** Tem baixa e ainda não quitou (o "Quitar pelo já pago" só aparece assim). */
  partial: boolean;
}

function view(amount: number, paid: number, dueDate: string, recorded: SettlementInput["recorded"], today: string): SettlementView {
  const status = settlementStatus({ amount, paid, dueDate, recorded, today });
  const settled = status === "pago" || status === "cancelado";
  return { paid, open: settled ? 0 : openAmount(amount, paid), status, partial: !settled && toCents(paid) !== 0 };
}

/** Título a pagar: status gravado previsto/aprovado/a pagar = aberto. */
export function payableSettlement(p: Pick<Payable, "status" | "amount" | "payments" | "dueDate">, today: string): SettlementView {
  const recorded = p.status === "pago" ? "pago" : p.status === "cancelado" ? "cancelado" : "aberto";
  return view(p.amount, payablePaidAmount(p), p.dueDate, recorded, today);
}

export function receivableSettlement(r: Pick<Receivable, "status" | "amount" | "payments" | "dueDate">, today: string): SettlementView {
  return view(r.amount, receivablePaidAmount(r), r.dueDate, r.status, today);
}

// ---------------------------------------------------------------------------
// Planos das ações de baixa (quitar, parcial, resíduo, quitar pelo já pago)
// ---------------------------------------------------------------------------

/** "total" = Quitar; "parcial" = Baixa parcial; "residuo" = Pagar parcialmente com resíduo. */
export type PaymentMode = "total" | "parcial" | "residuo";

export interface PaymentPlan {
  /** Valor desta baixa. */
  payAmount: number;
  /** Valor do título depois da baixa (Quitar e resíduo ajustam para a soma das baixas). */
  newAmount: number;
  amountChanged: boolean;
  /** O título fica pago com esta baixa. */
  settles: boolean;
  /** Valor do novo título "— Resíduo" (0 fora do modo resíduo). */
  residualAmount: number;
}

const brl = (v: number) => `R$ ${v.toFixed(2).replace(".", ",")}`;

/**
 * Plano da baixa conforme o modo:
 *  - total: paga `value` (padrão = em aberto) e ajusta o valor do título para a soma das baixas (desconto/juros);
 *  - parcial: 0 < value ≤ em aberto; mantém o valor; quita sozinho quando cobre o restante;
 *  - residuo: 0 < value < em aberto; o título fica pago pelo total pago (valor := soma das baixas) e o restante vai para
 *    o título "— Resíduo".
 * Título negativo (estorno a recuperar) só aceita a quitação pelo valor exato.
 */
export function planPayment(mode: PaymentMode, current: { amount: number; paid: number }, value?: number): Check<PaymentPlan> {
  const amount = roundCents(current.amount);
  const paid = roundCents(current.paid);
  const open = openAmount(amount, paid);
  if (value !== undefined && (!Number.isFinite(value) || roundCents(value) <= 0)) return { ok: false, error: "Informe um valor maior que zero" };
  const v = value === undefined ? undefined : roundCents(value);
  if (amount < 0) {
    if (mode !== "total" || (v !== undefined && toCents(v) !== toCents(Math.abs(open)))) return { ok: false, error: "Título de valor a recuperar só é baixado pelo valor integral" };
    return { ok: true, value: { payAmount: open, newAmount: amount, amountChanged: false, settles: true, residualAmount: 0 } };
  }
  if (toCents(open) <= 0) return { ok: false, error: "Este título não tem valor em aberto" };
  if (mode === "total") {
    const payAmount = v ?? open;
    const newAmount = fromCents(toCents(paid) + toCents(payAmount));
    return { ok: true, value: { payAmount, newAmount, amountChanged: toCents(newAmount) !== toCents(amount), settles: true, residualAmount: 0 } };
  }
  if (v === undefined) return { ok: false, error: "Informe o valor da baixa" };
  if (mode === "parcial") {
    if (toCents(v) > toCents(open)) return { ok: false, error: `O valor passa do em aberto (${brl(open)}): para quitar com juros use "Pagar" (total)` };
    const settles = isSettledByPayments(amount, fromCents(toCents(paid) + toCents(v)));
    return { ok: true, value: { payAmount: v, newAmount: amount, amountChanged: false, settles, residualAmount: 0 } };
  }
  if (toCents(v) >= toCents(open)) return { ok: false, error: `Com resíduo, o valor precisa ser menor que o em aberto (${brl(open)}); para pagar tudo use "Pagar" (total)` };
  const newAmount = fromCents(toCents(paid) + toCents(v));
  return { ok: true, value: { payAmount: v, newAmount, amountChanged: true, settles: true, residualAmount: fromCents(toCents(open) - toCents(v)) } };
}

/** Quitar pelo já pago: valor := já pago, sem nova baixa nem lançamento; exige ao menos uma baixa e saldo em aberto. */
export function planSettleByPaid(current: { amount: number; paid: number; paymentsCount: number }): Check<{ newAmount: number }> {
  if (current.paymentsCount === 0 || toCents(current.paid) <= 0) return { ok: false, error: "Registre ao menos uma baixa antes de quitar pelo já pago" };
  if (current.amount <= 0) return { ok: false, error: "Título de valor a recuperar não pode ser quitado pelo já pago" };
  if (isSettledByPayments(current.amount, current.paid)) return { ok: false, error: "O já pago cobre o valor: o título já está quitado" };
  return { ok: true, value: { newAmount: roundCents(current.paid) } };
}

/** "Descrição — Resíduo" sem empilhar o sufixo (resíduo de resíduo continua "— Resíduo"). */
export function residualDescription(description: string): string {
  const base = description.replace(/\s*[—–-]\s*Res[íi]duo\s*$/i, "").trim();
  return `${base}${RESIDUAL_SUFFIX}`;
}

/** Observação gravada no título de resíduo. */
export function residualNote(original: { code?: string; id: string; amount: number }, paidNow: number, residual: number): string {
  return `Resíduo do título ${original.code ?? original.id}: de ${brl(roundCents(original.amount))} foram pagos ${brl(paidNow)} na baixa com resíduo; restaram ${brl(residual)}.`;
}

/** Valor do título ANTES do primeiro ajuste (guardado uma vez; ajustes seguintes não sobrescrevem). */
export function originalAmountFor(current: { amount: number; originalAmount?: number }): number {
  return current.originalAmount ?? roundCents(current.amount);
}

// ---------------------------------------------------------------------------
// Títulos de comissão (pagamento integral) e desfazer uma baixa
// ---------------------------------------------------------------------------

export const PARTIAL_COMMISSION_BLOCKED = "Título de comissão/bônus é pago pelo valor integral (o valor segue a memória de cálculo da comissão): pagamento parcial, com resíduo, valor diferente ou quitar pelo já pago não são permitidos.";

/** Título ligado a comissão/bônus/estorno (ou com comissões vinculadas): só o pagamento integral existente. */
export function isCommissionLinkedPayable(p: Pick<Payable, "origin" | "sourceIds">): boolean {
  return p.origin === "comissao_automatica" || p.origin === "bonus" || p.origin === "estorno" || (p.sourceIds?.commissionIds?.length ?? 0) > 0;
}

/**
 * Pode desfazer UMA baixa? Título pago: regra da etapa 2 (`payableUndoBlock`: comissão/bônus/estorno recusado). Título
 * ainda aberto (aprovado/a pagar) com baixa parcial: pode, exceto se ligado a comissão. Sem baixa: nada a desfazer.
 */
export function payablePaymentUndoBlock(p: Pick<Payable, "status" | "origin" | "sourceIds" | "payments">): string | null {
  if (p.status === "pago") return payableUndoBlock(p);
  if ((p.payments?.length ?? 0) > 0 && (p.status === "aprovado" || p.status === "a_pagar")) return isCommissionLinkedPayable(p) ? UNDO_COMMISSION_BLOCKED : null;
  return payableUndoBlock(p);
}

export interface UndoPlan<P> {
  payment: P | null;
  remaining: P[];
  /** O título estava pago e volta a ter saldo. */
  reopen: boolean;
  /** Valor devolvido ao título (quitação que ajustou o valor, sem resíduo). */
  restoreAmount?: number;
}

/**
 * Desfazer a baixa indicada (ou a última): remove do `payments[]`; título pago volta a aberto; se a quitação tinha
 * ajustado o valor (desconto/juros ou quitar pelo já pago) e NÃO houve resíduo, o valor volta ao original.
 */
export function planUndoPayment<P extends { id: string }>(current: { settled: boolean; amount: number; originalAmount?: number; residualId?: string; payments?: readonly P[] }, paymentId?: string): UndoPlan<P> {
  const list = current.payments ?? [];
  const payment = paymentId ? (list.find((x) => x.id === paymentId) ?? null) : list.length ? list[list.length - 1] : null;
  const remaining = list.filter((x) => x.id !== payment?.id);
  const restore = current.settled && current.originalAmount !== undefined && !current.residualId && toCents(current.originalAmount) !== toCents(current.amount) ? roundCents(current.originalAmount) : undefined;
  return { payment, remaining, reopen: current.settled, ...(restore !== undefined ? { restoreAmount: restore } : {}) };
}

// ---------------------------------------------------------------------------
// Parcelamento (mesmo padrão de Contas a Pagar: sobra de centavos na ÚLTIMA parcela)
// ---------------------------------------------------------------------------

/** Parcelas com centavos exatos (a última leva o resto — decisão 5 do dono). */
export function splitInstallments(total: number, n: number): number[] {
  const count = Math.max(1, Math.floor(n));
  const cents = toCents(total);
  const base = Math.floor(cents / count);
  return Array.from({ length: count }, (_, i) => fromCents(i === count - 1 ? cents - base * (count - 1) : base));
}

/** Vencimento `months` meses depois de AAAA-MM-DD, mantendo o dia limitado ao fim do mês (ISO ao meio-dia UTC). */
export function shiftDueMonths(dueDate: string, months: number): string {
  const [y, m, d] = dueDate.slice(0, 10).split("-").map(Number);
  const first = new Date(Date.UTC(y, m - 1 + months, 1));
  const last = new Date(Date.UTC(first.getUTCFullYear(), first.getUTCMonth() + 1, 0)).getUTCDate();
  return new Date(Date.UTC(first.getUTCFullYear(), first.getUTCMonth(), Math.min(d, last), 12)).toISOString();
}

// ---------------------------------------------------------------------------
// Invariantes (verify.ts do seed)
// ---------------------------------------------------------------------------

export interface SettlementRecord {
  label: string;
  id: string;
  amount: number;
  status: string;
  /** Status gravado que significa quitado. */
  settled: boolean;
  payments?: readonly Pick<PayablePayment, "id" | "amount" | "accountId" | "transactionId">[];
}

/**
 * Soma das baixas ≤ valor + 0,005 (títulos positivos); título quitado COM baixas tem soma ≈ valor; toda baixa tem conta
 * e lançamento (`transactionId`); ids de baixa únicos no título.
 */
export function settlementProblems(records: readonly SettlementRecord[]): string[] {
  const problems: string[] = [];
  for (const r of records) {
    const payments = r.payments ?? [];
    if (payments.length === 0) continue;
    const paid = sumPayments(payments);
    if (r.amount > 0 && paid > r.amount + SETTLEMENT_TOLERANCE) problems.push(`${r.label} ${r.id}: baixas somam ${paid.toFixed(2)} > valor ${r.amount.toFixed(2)}`);
    if (r.settled && r.amount > 0 && Math.abs(paid - r.amount) > SETTLEMENT_TOLERANCE) problems.push(`${r.label} ${r.id}: quitado com baixas somando ${paid.toFixed(2)} ≠ valor ${r.amount.toFixed(2)}`);
    if (!r.settled && r.status !== "cancelado" && isSettledByPayments(r.amount, paid)) problems.push(`${r.label} ${r.id}: baixas cobrem o valor mas o status gravado é ${r.status}`);
    const ids = new Set<string>();
    for (const p of payments) {
      if (ids.has(p.id)) problems.push(`${r.label} ${r.id}: baixa ${p.id} repetida`);
      ids.add(p.id);
      if (!p.accountId || !p.transactionId) problems.push(`${r.label} ${r.id}: baixa ${p.id} sem conta ou sem lançamento`);
    }
  }
  return problems;
}
