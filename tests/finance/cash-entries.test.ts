/**
 * Etapa CP/CR 2 — baixas com conta e lançamentos de caixa (regras puras de src/domain/cash-entries.ts): montagem do
 * lançamento a partir da baixa, sinal no saldo, saldo da conta com lançamentos, extrato, desfazer pagamento (bloqueio
 * de título de comissão), realizado SEM contar em dobro e invariantes do verify.
 */
import { describe, expect, it } from "vitest";
import {
  BILLING_PAYMENT_NOTE,
  PAYABLE_PAYMENT_NOTE,
  UNDO_COMMISSION_BLOCKED,
  buildBillingCashEntry,
  buildPayableCashEntry,
  buildStatement,
  cashEntryDirection,
  cashEntryMovements,
  cashEntryProblems,
  payableUndoBlock,
  paymentToUndo,
  realizedTotals,
  signedCashAmount,
} from "@/domain/cash-entries";
import { accountBalance } from "@/domain/finance-registry";
import type { Billing, CashEntry, Payable, PayablePayment } from "@/domain/types";

const actor = { id: "user_karem", name: "Karem Feitosa" };

const payable = (over: Partial<Payable> = {}): Payable =>
  ({
    id: "pag_1",
    organizationId: "intercert",
    createdAt: "2026-09-01T00:00:00.000Z",
    updatedAt: "2026-09-01T00:00:00.000Z",
    code: "PAG-2026-00001",
    creditorType: "fornecedor",
    creditorName: "Imobiliária Cariri",
    supplierId: "sup_1",
    category: "aluguel",
    description: "Aluguel da sala 402",
    amount: 2800,
    competence: "2026-09",
    dueDate: "2026-09-10T12:00:00.000Z",
    status: "a_pagar",
    origin: "manual",
    sourceIds: { commissionIds: [] },
    history: [],
    ...over,
  }) as Payable;

const entry = (over: Partial<CashEntry> = {}): CashEntry => ({
  id: "ce_1",
  organizationId: "intercert",
  createdAt: "2026-09-10T12:00:00.000Z",
  updatedAt: "2026-09-10T12:00:00.000Z",
  date: "2026-09-10",
  amount: 100,
  type: "despesa",
  description: "x",
  accountId: "fa_1",
  reconciled: false,
  ...over,
});

const payment = (over: Partial<PayablePayment> = {}): PayablePayment => ({ id: "bx_ce_1", date: "2026-09-10", amount: 2800, accountId: "fa_1", transactionId: "ce_1", method: "pix", by: "user_karem", at: "2026-09-10T15:00:00.000Z", ...over });

describe("montagem do lançamento a partir da baixa", () => {
  it("título a pagar → DESPESA com o valor do título, conta, contato fornecedor, origem e observação", () => {
    const d = buildPayableCashEntry(payable({ categoryId: "fc_aluguel", costCenterId: "cc_adm" }), "bx_1", { date: "2026-09-10T12:00:00.000Z", amount: 2800, accountId: "fa_1", actor })!;
    expect(d).toMatchObject({ date: "2026-09-10", amount: 2800, type: "despesa", accountId: "fa_1", categoryId: "fc_aluguel", costCenterId: "cc_adm", reconciled: false, notes: PAYABLE_PAYMENT_NOTE });
    expect(d.contact).toEqual({ type: "fornecedor", id: "sup_1", name: "Imobiliária Cariri" });
    expect(d.origin).toEqual({ kind: "payable", id: "pag_1", paymentId: "bx_1" });
    expect(d.description).toBe("PAG-2026-00001 · Aluguel da sala 402");
    expect(d.createdBy).toBe("user_karem");
  });

  it("colaborador vira contato colaborador; sem categoria/centro novos o lançamento não inventa classificação", () => {
    const d = buildPayableCashEntry(payable({ creditorType: "colaborador", creditorId: "user_ana", creditorName: "Ana", supplierId: undefined }), "bx_1", { date: "2026-09-10", amount: 500, accountId: "fa_1", actor })!;
    expect(d.contact).toEqual({ type: "colaborador", id: "user_ana", name: "Ana" });
    expect(d.categoryId).toBeUndefined();
    expect(d.costCenterId).toBeUndefined();
  });

  it("título negativo (estorno a recuperar) → RECEITA positiva; valor zero não gera lançamento", () => {
    const d = buildPayableCashEntry(payable({ amount: -150.5 }), "bx_1", { date: "2026-09-10", amount: -150.5, accountId: "fa_1", actor })!;
    expect(d.type).toBe("receita");
    expect(d.amount).toBe(150.5);
    expect(buildPayableCashEntry(payable(), "bx_1", { date: "2026-09-10", amount: 0, accountId: "fa_1", actor })).toBeNull();
  });

  it("cobrança → RECEITA com o valor recebido, contato cliente, baixa única (paymentId = cobrança)", () => {
    const d = buildBillingCashEntry({ id: "bill_1", clientId: "client_001" }, { description: "Mensalidade 3 · contrato CT-2026-0001 · Padaria", clientName: "Padaria" }, { date: "2026-09-05", amount: 349.9, accountId: "fa_1", actor })!;
    expect(d).toMatchObject({ type: "receita", amount: 349.9, accountId: "fa_1", notes: BILLING_PAYMENT_NOTE, reconciled: false });
    expect(d.contact).toEqual({ type: "cliente", id: "client_001", name: "Padaria" });
    expect(d.origin).toEqual({ kind: "billing", id: "bill_1", paymentId: "bill_1" });
    expect(buildBillingCashEntry({ id: "b", clientId: "c" }, { description: "x", clientName: "y" }, { date: "2026-09-05", amount: 0, accountId: "fa_1", actor })).toBeNull();
  });
});

describe("saldo da conta = saldo inicial + lançamentos", () => {
  it("receita entra, despesa sai; transferência pelo lado gravado; sem lado fica fora", () => {
    expect(cashEntryDirection({ type: "receita" })).toBe("entrada");
    expect(cashEntryDirection({ type: "despesa" })).toBe("saida");
    expect(cashEntryDirection({ type: "transferencia", transferDirection: "entrada" })).toBe("entrada");
    expect(cashEntryDirection({ type: "transferencia" })).toBeNull();
    expect(signedCashAmount({ type: "despesa", amount: 10.005 })).toBe(-10.01);
    expect(signedCashAmount({ type: "transferencia", amount: 50 })).toBe(0);
  });

  it("pagar R$ 2.800 da conta de R$ 48.250,35 → saldo cai; desfazer (lançamento apagado) → saldo volta; receber sobe", () => {
    const account = { id: "fa_1", initialBalance: 48250.35 };
    const paid = [entry({ amount: 2800, type: "despesa" })];
    expect(accountBalance(account, cashEntryMovements(paid))).toBe(45450.35);
    expect(accountBalance(account, cashEntryMovements([]))).toBe(48250.35);
    const received = [...paid, entry({ id: "ce_2", amount: 349.9, type: "receita" })];
    expect(accountBalance(account, cashEntryMovements(received))).toBe(45800.25);
    // Lançamento de outra conta não mexe neste saldo.
    expect(accountBalance(account, cashEntryMovements([entry({ accountId: "fa_2", amount: 999 })]))).toBe(48250.35);
  });
});

describe("extrato", () => {
  const entries = [
    entry({ id: "a", date: "2026-08-20", amount: 100, type: "receita", createdAt: "2026-08-20T10:00:00Z" }),
    entry({ id: "b", date: "2026-09-02", amount: 30, type: "despesa", createdAt: "2026-09-02T10:00:00Z" }),
    entry({ id: "c", date: "2026-09-02", amount: 50, type: "receita", createdAt: "2026-09-02T11:00:00Z" }),
    entry({ id: "d", date: "2026-10-05", amount: 10, type: "despesa", createdAt: "2026-10-05T10:00:00Z" }),
    entry({ id: "x", accountId: "fa_2", date: "2026-09-03", amount: 999, type: "receita" }),
  ];
  it("saldo anterior, lançamentos do período com saldo corrente e saldo no fim; outra conta fora", () => {
    const st = buildStatement({ id: "fa_1", initialBalance: 1000 }, entries, { from: "2026-09-01", to: "2026-09-30" });
    expect(st.opening).toBe(1100);
    expect(st.lines.map((l) => [l.entry.id, l.signed, l.balance])).toEqual([
      ["b", -30, 1070],
      ["c", 50, 1120],
    ]);
    expect(st.closing).toBe(1120);
    expect(st.inflow).toBe(50);
    expect(st.outflow).toBe(30);
  });
  it("período sem lançamentos: abertura = fechamento", () => {
    const st = buildStatement({ id: "fa_1", initialBalance: 1000 }, entries, { from: "2026-11-01", to: "2026-11-30" });
    expect(st.lines).toEqual([]);
    expect(st.opening).toBe(1110);
    expect(st.closing).toBe(1110);
  });
});

describe("desfazer pagamento", () => {
  it("só título pago; título de comissão, bônus, estorno ou com comissões vinculadas é recusado (estorno de comissão)", () => {
    expect(payableUndoBlock(payable({ status: "a_pagar" }))).toMatch(/Só título pago/);
    expect(payableUndoBlock(payable({ status: "pago" }))).toBeNull();
    expect(payableUndoBlock(payable({ status: "pago", origin: "recorrencia" }))).toBeNull();
    for (const origin of ["comissao_automatica", "bonus", "estorno"] as const) expect(payableUndoBlock(payable({ status: "pago", origin }))).toBe(UNDO_COMMISSION_BLOCKED);
    expect(payableUndoBlock(payable({ status: "pago", origin: "manual", sourceIds: { commissionIds: ["com_1"] } }))).toBe(UNDO_COMMISSION_BLOCKED);
  });
  it("baixa a desfazer: a indicada ou a última; título antigo sem payments[] → nenhuma (nada a apagar)", () => {
    const list = [payment({ id: "p1" }), payment({ id: "p2", transactionId: "ce_2" })];
    expect(paymentToUndo(list)?.id).toBe("p2");
    expect(paymentToUndo(list, "p1")?.id).toBe("p1");
    expect(paymentToUndo(list, "p9")).toBeNull();
    expect(paymentToUndo(undefined)).toBeNull();
  });
});

describe("realizado sem contar em dobro (lançamentos + baixas antigas sem transactionId)", () => {
  const billing = (over: Partial<Billing>): Pick<Billing, "status" | "paidAmount" | "amount" | "paidAt" | "cashEntryId"> => ({ status: "paga", amount: 300, paidAmount: 300, paidAt: "2026-09-05T12:00:00.000Z", ...over });

  it("baixa COM lançamento conta uma vez só (pelo lançamento); antiga sem lançamento conta pela baixa", () => {
    const r = realizedTotals({
      entries: [entry({ id: "ce_1", amount: 2800, type: "despesa", date: "2026-09-10" }), entry({ id: "ce_2", amount: 349.9, type: "receita", date: "2026-09-05" })],
      payables: [
        payable({ status: "pago", paidAt: "2026-09-10T12:00:00.000Z", payments: [payment()] }), // tem lançamento ce_1: não soma de novo
        payable({ id: "pag_old", status: "pago", amount: 1000, paidAt: "2026-09-01T12:00:00.000Z" }), // antigo, sem payments[]
        payable({ id: "pag_open", status: "a_pagar", amount: 777 }), // aberto: fora
      ],
      billings: [billing({ cashEntryId: "ce_2", paidAmount: 349.9 }), billing({ paidAmount: 300 }), billing({ status: "aberta", paidAt: undefined })],
    });
    expect(r.fromEntries).toEqual({ receitas: 349.9, despesas: 2800 });
    expect(r.fromLegacy).toEqual({ receitas: 300, despesas: 1000 });
    expect(r.receitas).toBe(649.9);
    expect(r.despesas).toBe(3800);
    expect(r.resultado).toBe(-3150.1);
  });

  it("baixa em payments[] SEM transactionId entra pela baixa; transferência não é receita nem despesa; período filtra", () => {
    const r = realizedTotals({
      entries: [entry({ type: "transferencia", transferDirection: "saida", amount: 500 }), entry({ id: "late", amount: 10, date: "2026-10-02" })],
      payables: [payable({ status: "pago", payments: [payment({ transactionId: "" as string, amount: 120 })] })],
      billings: [billing({ paidAt: "2026-08-31T12:00:00.000Z" })],
      from: "2026-09-01",
      to: "2026-09-30",
    });
    expect(r).toMatchObject({ receitas: 0, despesas: 120 });
  });

  it("título de estorno (negativo) pago antigo reduz despesas", () => {
    const r = realizedTotals({ entries: [], payables: [payable({ status: "pago", amount: -200, paidAt: "2026-09-02T12:00:00.000Z" })], billings: [] });
    expect(r.despesas).toBe(-200);
  });
});

describe("invariantes do verify (lançamento ↔ baixa)", () => {
  const accounts = new Set(["fa_1"]);
  it("coerente: sem problemas", () => {
    expect(
      cashEntryProblems({
        entries: [entry({ origin: { kind: "payable", id: "pag_1", paymentId: "bx_ce_1" } }), entry({ id: "ce_2", type: "receita", origin: { kind: "billing", id: "bill_1", paymentId: "bill_1" } })],
        accountIds: accounts,
        payables: [{ id: "pag_1", status: "pago", payments: [payment()] }],
        billings: [{ id: "bill_1", status: "paga", cashEntryId: "ce_2", paymentAccountId: "fa_1" }],
      }),
    ).toEqual([]);
  });
  it("acusa conta inexistente, lançamento órfão, baixa sem lançamento e cobrança estornada com lançamento", () => {
    const problems = cashEntryProblems({
      entries: [entry({ accountId: "fa_x", origin: { kind: "payable", id: "pag_1", paymentId: "bx_outro" } })],
      accountIds: accounts,
      payables: [{ id: "pag_1", status: "pago", payments: [payment({ id: "bx_2", transactionId: "ce_9" })] }],
      billings: [{ id: "bill_1", status: "aberta", cashEntryId: "ce_7" }],
    });
    expect(problems.some((p) => /conta inexistente fa_x/.test(p))).toBe(true);
    expect(problems.some((p) => /sem baixa correspondente no título pag_1/.test(p))).toBe(true);
    expect(problems.some((p) => /transactionId ce_9 sem lançamento/.test(p))).toBe(true);
    expect(problems.some((p) => /cobrança bill_1 com cashEntryId ce_7 sem lançamento/.test(p))).toBe(true);
    expect(problems.some((p) => /bill_1 aberta ainda com lançamento/.test(p))).toBe(true);
  });
});
