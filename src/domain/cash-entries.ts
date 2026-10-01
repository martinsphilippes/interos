/**
 * Lançamentos de caixa e baixas com conta (etapa CP/CR 2) — regras PURAS (sem Firestore, sem React). Usadas pelos
 * serviços de baixa (`payPayable`, `registerPayment`), pelo extrato/saldo das contas (`/financeiro/cadastros`), pelo
 * `verify.ts` do seed e pelos testes.
 *
 * Regra "NÃO CONTAR EM DOBRO" (realizado): toda baixa feita com conta grava um lançamento de caixa na MESMA transação e
 * guarda o id dele (`PayablePayment.transactionId`, `Billing.cashEntryId`). Os totais realizados somam:
 *   1. os lançamentos de caixa (fonte de verdade do dinheiro que entrou/saiu); e
 *   2. as baixas ANTIGAS que não têm lançamento (título pago sem `payments[]`/baixa sem `transactionId`; cobrança paga
 *      sem `cashEntryId`) — pela própria baixa.
 * Uma baixa com lançamento NUNCA é somada pela baixa (já está no lançamento). Não há migração automática: baixas antigas
 * continuam entrando pelo item 2 até alguém, com autorização, criar os lançamentos delas.
 */
import { roundCents, type AccountMovement } from "./finance-registry";
import type { Billing, CashEntry, CashEntryContact, CashEntryType, Payable, PayablePayment, Receivable } from "./types";

export const CASH_ENTRY_TYPES: readonly CashEntryType[] = ["receita", "despesa", "transferencia"];
export const CASH_ENTRY_TYPE_LABELS: Record<CashEntryType, string> = { receita: "Receita", despesa: "Despesa", transferencia: "Transferência" };

/** Observação gravada no lançamento conforme a origem da baixa. */
export const PAYABLE_PAYMENT_NOTE = "Baixa de conta a pagar";
export const BILLING_PAYMENT_NOTE = "Baixa de conta a receber";

/** Dados do lançamento antes de gravar (o serviço completa id, organização e datas). */
export type CashEntryDraft = Omit<CashEntry, "id" | "organizationId" | "createdAt" | "updatedAt">;

// ---------------------------------------------------------------------------
// Sinal no saldo
// ---------------------------------------------------------------------------

/** Receita entra, despesa sai; transferência pelo lado gravado (`transferDirection`); sem lado = fora do saldo. */
export function cashEntryDirection(e: Pick<CashEntry, "type" | "transferDirection">): "entrada" | "saida" | null {
  if (e.type === "receita") return "entrada";
  if (e.type === "despesa") return "saida";
  return e.transferDirection ?? null;
}

/** Valor com sinal (+ entrada, − saída; 0 quando fora do saldo), em centavos exatos. */
export function signedCashAmount(e: Pick<CashEntry, "type" | "transferDirection" | "amount">): number {
  const dir = cashEntryDirection(e);
  if (!dir || !Number.isFinite(e.amount)) return 0;
  const value = roundCents(Math.abs(e.amount));
  return dir === "entrada" ? value : -value;
}

/** Movimentos para `accountBalance` (saldo = saldo inicial + entradas − saídas). */
export function cashEntryMovements(entries: readonly Pick<CashEntry, "accountId" | "type" | "transferDirection" | "amount">[]): AccountMovement[] {
  const out: AccountMovement[] = [];
  for (const e of entries) {
    const direction = cashEntryDirection(e);
    if (!direction) continue;
    out.push({ accountId: e.accountId, direction, amount: Math.abs(e.amount) });
  }
  return out;
}

// ---------------------------------------------------------------------------
// Montagem do lançamento a partir da baixa
// ---------------------------------------------------------------------------

export interface PaymentBase {
  /** AAAA-MM-DD (São Paulo). */
  date: string;
  amount: number;
  accountId: string;
  actor: { id: string; name?: string };
}

/** Contato do título a pagar: fornecedor cadastrado/nome livre ou colaborador. */
export function payableContact(p: Pick<Payable, "creditorType" | "creditorId" | "creditorName" | "supplierId">): CashEntryContact {
  if (p.creditorType === "fornecedor") return { type: "fornecedor", ...(p.supplierId ? { id: p.supplierId } : {}), name: p.creditorName };
  return { type: "colaborador", ...(p.creditorId ? { id: p.creditorId } : {}), name: p.creditorName };
}

/**
 * Lançamento da baixa de um título a pagar: DESPESA com o valor pago (título negativo — estorno de comissão, "valor a
 * recuperar" — vira RECEITA com o valor absoluto). Classificação (categoria/centro) = a do título (campos novos).
 * Valor zero não gera lançamento (devolve null).
 */
export function buildPayableCashEntry(payable: Pick<Payable, "id" | "code" | "description" | "creditorType" | "creditorId" | "creditorName" | "supplierId" | "categoryId" | "costCenterId">, paymentId: string, base: PaymentBase): CashEntryDraft | null {
  const amount = roundCents(base.amount);
  if (!Number.isFinite(amount) || amount === 0) return null;
  return {
    date: base.date.slice(0, 10),
    amount: Math.abs(amount),
    type: amount > 0 ? "despesa" : "receita",
    description: `${payable.code ?? payable.id} · ${payable.description}`.slice(0, 240),
    accountId: base.accountId,
    ...(payable.categoryId ? { categoryId: payable.categoryId } : {}),
    ...(payable.costCenterId ? { costCenterId: payable.costCenterId } : {}),
    contact: payableContact(payable),
    reconciled: false,
    origin: { kind: "payable", id: payable.id, paymentId },
    notes: PAYABLE_PAYMENT_NOTE,
    createdBy: base.actor.id,
    ...(base.actor.name ? { createdByName: base.actor.name } : {}),
  };
}

/** Lançamento da baixa de uma cobrança: RECEITA com o valor recebido; contato = cliente; baixa única (paymentId = cobrança). */
export function buildBillingCashEntry(billing: Pick<Billing, "id" | "clientId">, label: { description: string; clientName: string }, base: PaymentBase): CashEntryDraft | null {
  const amount = roundCents(base.amount);
  if (!Number.isFinite(amount) || amount <= 0) return null;
  return {
    date: base.date.slice(0, 10),
    amount,
    type: "receita",
    description: label.description.slice(0, 240),
    accountId: base.accountId,
    contact: { type: "cliente", id: billing.clientId, name: label.clientName },
    reconciled: false,
    origin: { kind: "billing", id: billing.id, paymentId: billing.id },
    notes: BILLING_PAYMENT_NOTE,
    createdBy: base.actor.id,
    ...(base.actor.name ? { createdByName: base.actor.name } : {}),
  };
}

/**
 * Lançamento do recebimento de um título a receber AVULSO (etapa CP/CR 3): RECEITA com o valor recebido; contato =
 * cliente cadastrado ou o nome livre do pagador; classificação = a do título; origem "receivable" com o id da baixa.
 */
export function buildReceivableCashEntry(receivable: Pick<Receivable, "id" | "code" | "description" | "clientId" | "payerName" | "categoryId" | "costCenterId">, paymentId: string, base: PaymentBase): CashEntryDraft | null {
  const amount = roundCents(base.amount);
  if (!Number.isFinite(amount) || amount <= 0) return null;
  return {
    date: base.date.slice(0, 10),
    amount,
    type: "receita",
    description: `${receivable.code ?? receivable.id} · ${receivable.description}`.slice(0, 240),
    accountId: base.accountId,
    ...(receivable.categoryId ? { categoryId: receivable.categoryId } : {}),
    ...(receivable.costCenterId ? { costCenterId: receivable.costCenterId } : {}),
    contact: { type: "cliente", ...(receivable.clientId ? { id: receivable.clientId } : {}), name: receivable.payerName },
    reconciled: false,
    origin: { kind: "receivable", id: receivable.id, paymentId },
    notes: BILLING_PAYMENT_NOTE,
    createdBy: base.actor.id,
    ...(base.actor.name ? { createdByName: base.actor.name } : {}),
  };
}

// ---------------------------------------------------------------------------
// Desfazer pagamento (títulos a pagar)
// ---------------------------------------------------------------------------

/** Mensagem do bloqueio de desfazer em título ligado a comissão/bônus. */
export const UNDO_COMMISSION_BLOCKED = "Este título paga comissão: desfazer o pagamento por aqui deixaria a comissão como paga. Use o estorno da comissão (Financeiro › Comissões), que registra o valor a recuperar.";

/**
 * Pode desfazer o pagamento? Só título pago; título de comissão/bônus/estorno (ou com comissões vinculadas) NÃO — o
 * circuito de comissões tem o próprio estorno. Devolve a mensagem do bloqueio ou null.
 */
export function payableUndoBlock(p: Pick<Payable, "status" | "origin" | "sourceIds">): string | null {
  if (p.status !== "pago") return "Só título pago pode ter o pagamento desfeito";
  if (p.origin === "comissao_automatica" || p.origin === "bonus" || p.origin === "estorno" || (p.sourceIds?.commissionIds?.length ?? 0) > 0) return UNDO_COMMISSION_BLOCKED;
  return null;
}

/** Baixa que será desfeita: a indicada ou a última com lançamento; título antigo sem `payments[]` → null (nada a apagar). */
export function paymentToUndo(payments: readonly PayablePayment[] | undefined, paymentId?: string): PayablePayment | null {
  const list = payments ?? [];
  if (paymentId) return list.find((x) => x.id === paymentId) ?? null;
  return list.length ? list[list.length - 1] : null;
}

// ---------------------------------------------------------------------------
// Realizado sem contar em dobro
// ---------------------------------------------------------------------------

export interface RealizedInput {
  entries: readonly Pick<CashEntry, "date" | "type" | "amount" | "transferDirection">[];
  payables: readonly Pick<Payable, "status" | "amount" | "paidAt" | "payments">[];
  billings: readonly Pick<Billing, "status" | "paidAmount" | "amount" | "paidAt" | "cashEntryId">[];
  /** Período (AAAA-MM-DD, inclusivo). Sem limites = tudo. */
  from?: string;
  to?: string;
  /** Converte o instante gravado (paidAt) em AAAA-MM-DD; padrão = os 10 primeiros caracteres (baixas gravadas ao meio-dia UTC). */
  toDay?: (iso: string) => string;
}

export interface RealizedTotals {
  receitas: number;
  despesas: number;
  resultado: number;
  /** Quanto veio de lançamentos e quanto de baixas antigas sem lançamento (transparência). */
  fromEntries: { receitas: number; despesas: number };
  fromLegacy: { receitas: number; despesas: number };
}

/**
 * Realizado = lançamentos + baixas antigas sem `transactionId` (ver cabeçalho). Transferências não são receita nem
 * despesa. Título pago com `payments[]`: cada baixa SEM `transactionId` entra pela baixa; as com `transactionId` já estão
 * nos lançamentos. Título pago sem `payments[]` (antigo): entra pelo valor e `paidAt`. Título negativo (estorno a
 * recuperar) reduz as despesas, como o lançamento de receita que a baixa dele gera hoje.
 */
export function realizedTotals(input: RealizedInput): RealizedTotals {
  const toDay = input.toDay ?? ((iso: string) => iso.slice(0, 10));
  const inPeriod = (day: string) => Boolean(day) && (!input.from || day >= input.from) && (!input.to || day <= input.to);
  let er = 0;
  let ed = 0;
  let lr = 0;
  let ld = 0;
  for (const e of input.entries) {
    if (!inPeriod(e.date) || !Number.isFinite(e.amount)) continue;
    const v = Math.round(Math.abs(e.amount) * 100);
    if (e.type === "receita") er += v;
    else if (e.type === "despesa") ed += v;
  }
  for (const p of input.payables) {
    if (p.status !== "pago") continue;
    const payments = p.payments ?? [];
    if (payments.length === 0) {
      if (p.paidAt && inPeriod(toDay(p.paidAt)) && Number.isFinite(p.amount)) ld += Math.round(p.amount * 100);
      continue;
    }
    for (const pay of payments) if (!pay.transactionId && inPeriod(pay.date) && Number.isFinite(pay.amount)) ld += Math.round(pay.amount * 100);
  }
  for (const b of input.billings) {
    if (b.status !== "paga" || b.cashEntryId || !b.paidAt || !inPeriod(toDay(b.paidAt))) continue;
    const value = b.paidAmount ?? b.amount;
    if (Number.isFinite(value)) lr += Math.round(value * 100);
  }
  const receitas = (er + lr) / 100;
  const despesas = (ed + ld) / 100;
  return { receitas, despesas, resultado: roundCents(receitas - despesas), fromEntries: { receitas: er / 100, despesas: ed / 100 }, fromLegacy: { receitas: lr / 100, despesas: ld / 100 } };
}

// ---------------------------------------------------------------------------
// Extrato
// ---------------------------------------------------------------------------

export interface StatementLine<T> {
  entry: T;
  signed: number;
  /** Saldo depois deste lançamento. */
  balance: number;
}

export interface Statement<T> {
  /** Saldo no início do período (saldo inicial + tudo antes de `from`). */
  opening: number;
  /** Saldo no fim do período. */
  closing: number;
  inflow: number;
  outflow: number;
  lines: StatementLine<T>[];
}

/**
 * Extrato de UMA conta no período: saldo de abertura, lançamentos em ordem cronológica com saldo corrente e saldo de
 * fechamento. Ordem: data, depois criação (estável).
 */
export function buildStatement<T extends Pick<CashEntry, "accountId" | "date" | "type" | "transferDirection" | "amount" | "createdAt">>(account: { id: string; initialBalance: number }, entries: readonly T[], period: { from?: string; to?: string } = {}): Statement<T> {
  const own = entries.filter((e) => e.accountId === account.id).sort((a, b) => a.date.localeCompare(b.date) || a.createdAt.localeCompare(b.createdAt));
  let cents = Math.round((Number.isFinite(account.initialBalance) ? account.initialBalance : 0) * 100);
  let inflow = 0;
  let outflow = 0;
  const lines: StatementLine<T>[] = [];
  let opening: number | null = null;
  for (const e of own) {
    if (period.to && e.date > period.to) break;
    const signed = Math.round(signedCashAmount(e) * 100);
    if (period.from && e.date < period.from) {
      cents += signed;
      continue;
    }
    if (opening === null) opening = cents;
    cents += signed;
    if (signed > 0) inflow += signed;
    else outflow -= signed;
    lines.push({ entry: e, signed: signed / 100, balance: cents / 100 });
  }
  return { opening: (opening ?? cents) / 100, closing: cents / 100, inflow: inflow / 100, outflow: outflow / 100, lines };
}

// ---------------------------------------------------------------------------
// Invariantes (verify.ts do seed)
// ---------------------------------------------------------------------------

/**
 * Coerência lançamento ↔ baixa: todo lançamento aponta para conta existente e para uma baixa existente com o MESMO
 * transactionId; nenhuma baixa com transactionId fica sem lançamento.
 */
export function cashEntryProblems(input: {
  entries: readonly Pick<CashEntry, "id" | "accountId" | "amount" | "type" | "origin">[];
  accountIds: ReadonlySet<string>;
  payables: readonly Pick<Payable, "id" | "status" | "payments">[];
  billings: readonly Pick<Billing, "id" | "status" | "cashEntryId" | "paymentAccountId">[];
  /** Títulos a receber avulsos (etapa CP/CR 3). */
  receivables?: readonly Pick<Receivable, "id" | "status" | "payments">[];
}): string[] {
  const problems: string[] = [];
  const entryIds = new Set(input.entries.map((e) => e.id));
  const payables = new Map(input.payables.map((p) => [p.id, p]));
  const billings = new Map(input.billings.map((b) => [b.id, b]));
  const receivables = new Map((input.receivables ?? []).map((r) => [r.id, r]));
  for (const e of input.entries) {
    if (!input.accountIds.has(e.accountId)) problems.push(`lançamento ${e.id} aponta para conta inexistente ${e.accountId}`);
    if (!(e.amount > 0)) problems.push(`lançamento ${e.id} com valor não positivo (${e.amount})`);
    if (!e.origin) continue;
    if (e.origin.kind === "payable") {
      const p = payables.get(e.origin.id);
      const pay = p?.payments?.find((x) => x.id === e.origin!.paymentId);
      if (!p) problems.push(`lançamento ${e.id} aponta para título inexistente ${e.origin.id}`);
      else if (!pay || pay.transactionId !== e.id) problems.push(`lançamento ${e.id} sem baixa correspondente no título ${p.id}`);
      else if (pay.accountId !== e.accountId) problems.push(`lançamento ${e.id} em conta diferente da baixa do título ${p.id}`);
    } else if (e.origin.kind === "receivable") {
      const r = receivables.get(e.origin.id);
      const pay = r?.payments?.find((x) => x.id === e.origin!.paymentId);
      if (!r) problems.push(`lançamento ${e.id} aponta para título a receber inexistente ${e.origin.id}`);
      else if (!pay || pay.transactionId !== e.id) problems.push(`lançamento ${e.id} sem baixa correspondente no título a receber ${r.id}`);
      else if (pay.accountId !== e.accountId) problems.push(`lançamento ${e.id} em conta diferente da baixa do título a receber ${r.id}`);
      else if (e.type !== "receita") problems.push(`lançamento ${e.id} do título a receber ${r.id} não é receita`);
    } else {
      const b = billings.get(e.origin.id);
      if (!b) problems.push(`lançamento ${e.id} aponta para cobrança inexistente ${e.origin.id}`);
      else if (b.status !== "paga" || b.cashEntryId !== e.id) problems.push(`lançamento ${e.id} sem baixa correspondente na cobrança ${b.id} (${b.status})`);
      else if (b.paymentAccountId !== e.accountId) problems.push(`lançamento ${e.id} em conta diferente da baixa da cobrança ${b.id}`);
    }
  }
  for (const p of input.payables) for (const pay of p.payments ?? []) if (pay.transactionId && !entryIds.has(pay.transactionId)) problems.push(`baixa ${pay.id} do título ${p.id} com transactionId ${pay.transactionId} sem lançamento`);
  for (const r of input.receivables ?? []) for (const pay of r.payments ?? []) if (pay.transactionId && !entryIds.has(pay.transactionId)) problems.push(`baixa ${pay.id} do título a receber ${r.id} com transactionId ${pay.transactionId} sem lançamento`);
  for (const b of input.billings) if (b.cashEntryId && !entryIds.has(b.cashEntryId)) problems.push(`cobrança ${b.id} com cashEntryId ${b.cashEntryId} sem lançamento`);
  for (const b of input.billings) if (b.cashEntryId && b.status !== "paga") problems.push(`cobrança ${b.id} ${b.status} ainda com lançamento ${b.cashEntryId}`);
  return problems;
}
