/**
 * Etapa CP/CR 3 — baixa parcial, resíduo, quitar pelo já pago e título a receber avulso (regras puras de
 * src/domain/settlements.ts e o lançamento do recebimento em src/domain/cash-entries.ts). Inclui os casos do checklist de
 * aceitação: R$ 100 vencido ontem sem baixa → Vencido; parcial 40 → em aberto 60, Parcial, lançamento 40; quitar 100
 * pagando 90 → valor 90 Pago; parcial 30 de 100 com resíduo → original 30 pago + "— Resíduo" 70; desfazer devolve o saldo.
 */
import { describe, expect, it } from "vitest";
import {
  PARTIAL_COMMISSION_BLOCKED,
  RESIDUAL_SUFFIX,
  SETTLEMENT_TOLERANCE,
  isCommissionLinkedPayable,
  isSettledByPayments,
  openAmount,
  originalAmountFor,
  payablePaidAmount,
  payablePaymentUndoBlock,
  payableSettlement,
  planPayment,
  planSettleByPaid,
  planUndoPayment,
  receivableSettlement,
  residualDescription,
  residualNote,
  settlementProblems,
  settlementStatus,
  shiftDueMonths,
  splitInstallments,
  sumPayments,
} from "@/domain/settlements";
import { UNDO_COMMISSION_BLOCKED, buildPayableCashEntry, buildReceivableCashEntry, cashEntryProblems } from "@/domain/cash-entries";
import type { CashEntry, Payable, PayablePayment, Receivable } from "@/domain/types";

const TODAY = "2026-10-01";
const YESTERDAY = "2026-09-30T12:00:00.000Z";
const TOMORROW = "2026-10-02T12:00:00.000Z";
const actor = { id: "user_karem", name: "Karem Feitosa" };

const pay = (amount: number, over: Partial<PayablePayment> = {}): PayablePayment => ({ id: `bx_${amount}`, date: "2026-09-20", amount, accountId: "fa_1", transactionId: `ce_${amount}`, method: "pix", by: "user_karem", at: "2026-09-20T15:00:00.000Z", ...over });

const payable = (over: Partial<Payable> = {}): Payable =>
  ({
    id: "pag_1",
    organizationId: "intercert",
    createdAt: "2026-09-01T00:00:00.000Z",
    updatedAt: "2026-09-01T00:00:00.000Z",
    code: "PAG-2026-00001",
    creditorType: "fornecedor",
    creditorName: "Gráfica Cariri",
    category: "outros",
    description: "Impressão de material",
    amount: 100,
    competence: "2026-09",
    dueDate: TOMORROW,
    status: "a_pagar",
    origin: "manual",
    sourceIds: { commissionIds: [] },
    history: [],
    ...over,
  }) as Payable;

const receivable = (over: Partial<Receivable> = {}): Receivable => ({
  id: "rec_1",
  organizationId: "intercert",
  createdAt: "2026-09-01T00:00:00.000Z",
  updatedAt: "2026-09-01T00:00:00.000Z",
  code: "REC-2026-00001",
  description: "Consultoria avulsa",
  amount: 100,
  dueDate: TOMORROW,
  competence: "2026-10",
  payerName: "Padaria Pão Quente",
  status: "aberto",
  history: [],
  ...over,
});

describe("pago, em aberto e status calculado", () => {
  it("checklist: R$ 100 vencido ontem sem baixa → Vencido, em aberto 100", () => {
    const v = payableSettlement(payable({ dueDate: YESTERDAY }), TODAY);
    expect(v).toEqual({ paid: 0, open: 100, status: "vencido", partial: false });
  });

  it("checklist: baixa parcial de 40 em título de 100 que não venceu → Parcial, em aberto 60", () => {
    const v = payableSettlement(payable({ payments: [pay(40)] }), TODAY);
    expect(v).toEqual({ paid: 40, open: 60, status: "parcial", partial: true });
  });

  it("parcial vencido mostra Vencido (a regra do vencimento vem antes da de baixa)", () => {
    expect(payableSettlement(payable({ dueDate: YESTERDAY, payments: [pay(40)] }), TODAY).status).toBe("vencido");
  });

  it("sem baixa e sem vencer → Em aberto; cancelado continua cancelado e sem em aberto", () => {
    expect(payableSettlement(payable(), TODAY).status).toBe("em_aberto");
    expect(payableSettlement(payable({ status: "cancelado" }), TODAY)).toMatchObject({ status: "cancelado", open: 0 });
  });

  it("tolerância de meio centavo: 99,996 pagos de 100 = Pago; 99,99 = Parcial com 0,01 em aberto", () => {
    expect(isSettledByPayments(100, 99.996)).toBe(true);
    expect(settlementStatus({ amount: 100, paid: 99.99, dueDate: TOMORROW, recorded: "aberto", today: TODAY })).toBe("parcial");
    expect(openAmount(100, 99.99)).toBe(0.01);
    expect(SETTLEMENT_TOLERANCE).toBe(0.005);
  });

  it("valor zero nunca é 'pago' pela soma; em aberto nunca é negativo", () => {
    expect(isSettledByPayments(0, 0)).toBe(false);
    expect(openAmount(100, 130)).toBe(0);
  });

  it("centavos exatos: 0,1 + 0,2 somam 0,30 (sem erro de ponto flutuante)", () => {
    expect(sumPayments([{ amount: 0.1 }, { amount: 0.2 }])).toBe(0.3);
    expect(openAmount(1, 0.3)).toBe(0.7);
  });

  it("título pago ANTIGO sem payments[] conta como uma baixa do valor total", () => {
    const old = payable({ status: "pago", amount: 99.9 });
    expect(payablePaidAmount(old)).toBe(99.9);
    expect(payableSettlement(old, TODAY)).toEqual({ paid: 99.9, open: 0, status: "pago", partial: false });
  });

  it("título negativo (estorno a recuperar) espelha o em aberto com o sinal do título", () => {
    expect(openAmount(-50, 0)).toBe(-50);
    expect(openAmount(-50, -50)).toBe(0);
  });

  it("título a receber avulso usa as baixas e o status gravado", () => {
    expect(receivableSettlement(receivable({ payments: [pay(25)] }), TODAY)).toEqual({ paid: 25, open: 75, status: "parcial", partial: true });
    expect(receivableSettlement(receivable({ status: "pago", payments: [pay(100)] }), TODAY).status).toBe("pago");
    expect(receivableSettlement(receivable({ status: "cancelado" }), TODAY).status).toBe("cancelado");
  });
});

describe("planos das baixas", () => {
  it("checklist: quitar R$ 100 pagando 90 → valor 90, Pago (desconto)", () => {
    const r = planPayment("total", { amount: 100, paid: 0 }, 90);
    expect(r).toEqual({ ok: true, value: { payAmount: 90, newAmount: 90, amountChanged: true, settles: true, residualAmount: 0 } });
  });

  it("quitar sem valor paga o em aberto (100 − 40 = 60) e não muda o valor; com juros o valor sobe", () => {
    expect(planPayment("total", { amount: 100, paid: 40 })).toEqual({ ok: true, value: { payAmount: 60, newAmount: 100, amountChanged: false, settles: true, residualAmount: 0 } });
    const juros = planPayment("total", { amount: 100, paid: 40 }, 65);
    expect(juros.ok && juros.value.newAmount).toBe(105);
  });

  it("checklist: parcial de 40 em 100 mantém o valor e não quita; parcial que cobre o restante quita sozinho", () => {
    expect(planPayment("parcial", { amount: 100, paid: 0 }, 40)).toEqual({ ok: true, value: { payAmount: 40, newAmount: 100, amountChanged: false, settles: false, residualAmount: 0 } });
    const fecha = planPayment("parcial", { amount: 100, paid: 40 }, 60);
    expect(fecha.ok && fecha.value.settles).toBe(true);
  });

  it("parcial acima do em aberto é recusado (indica Pagar total); valor zero/negativo recusado", () => {
    const r = planPayment("parcial", { amount: 100, paid: 40 }, 61);
    expect(r.ok).toBe(false);
    expect(!r.ok && r.error).toMatch(/passa do em aberto/);
    expect(planPayment("parcial", { amount: 100, paid: 0 }, 0).ok).toBe(false);
    expect(planPayment("total", { amount: 100, paid: 0 }, -5).ok).toBe(false);
  });

  it("checklist: parcial 30 de 100 com resíduo → original vale 30 (pago) e o resíduo leva 70", () => {
    const r = planPayment("residuo", { amount: 100, paid: 0 }, 30);
    expect(r).toEqual({ ok: true, value: { payAmount: 30, newAmount: 30, amountChanged: true, settles: true, residualAmount: 70 } });
  });

  it("resíduo depois de uma parcial: 100, já pagos 40, paga 20 → original 60, resíduo 40", () => {
    const r = planPayment("residuo", { amount: 100, paid: 40 }, 20);
    expect(r.ok && r.value).toMatchObject({ newAmount: 60, residualAmount: 40 });
  });

  it("resíduo exige valor MENOR que o em aberto", () => {
    expect(planPayment("residuo", { amount: 100, paid: 0 }, 100).ok).toBe(false);
    expect(planPayment("residuo", { amount: 100, paid: 0 }).ok).toBe(false);
  });

  it("título sem valor em aberto é recusado; título negativo só pelo valor integral", () => {
    expect(planPayment("total", { amount: 100, paid: 100 }).ok).toBe(false);
    expect(planPayment("total", { amount: -50, paid: 0 })).toEqual({ ok: true, value: { payAmount: -50, newAmount: -50, amountChanged: false, settles: true, residualAmount: 0 } });
    expect(planPayment("parcial", { amount: -50, paid: 0 }, 10).ok).toBe(false);
  });

  it("quitar pelo já pago: valor := já pago; exige baixa; recusa quando já quitado", () => {
    expect(planSettleByPaid({ amount: 100, paid: 40, paymentsCount: 1 })).toEqual({ ok: true, value: { newAmount: 40 } });
    expect(planSettleByPaid({ amount: 100, paid: 0, paymentsCount: 0 }).ok).toBe(false);
    expect(planSettleByPaid({ amount: 100, paid: 100, paymentsCount: 2 }).ok).toBe(false);
  });

  it("valor original guardado uma vez (ajustes seguintes não sobrescrevem)", () => {
    expect(originalAmountFor({ amount: 100 })).toBe(100);
    expect(originalAmountFor({ amount: 90, originalAmount: 100 })).toBe(100);
  });
});

describe("resíduo", () => {
  it("'Descrição — Resíduo' e resíduo de resíduo NÃO empilha o sufixo", () => {
    expect(residualDescription("Aluguel da sala 402")).toBe(`Aluguel da sala 402${RESIDUAL_SUFFIX}`);
    expect(residualDescription("Aluguel da sala 402 — Resíduo")).toBe("Aluguel da sala 402 — Resíduo");
    expect(residualDescription("Aluguel da sala 402 - resíduo")).toBe("Aluguel da sala 402 — Resíduo");
    expect(residualDescription("Licenças (parcela 2/3)")).toBe("Licenças (parcela 2/3) — Resíduo");
  });

  it("observação explica de onde veio o resíduo", () => {
    expect(residualNote({ code: "PAG-2026-00001", id: "pag_1", amount: 100 }, 30, 70)).toBe("Resíduo do título PAG-2026-00001: de R$ 100,00 foram pagos R$ 30,00 na baixa com resíduo; restaram R$ 70,00.");
  });
});

describe("títulos de comissão e desfazer uma baixa", () => {
  it("título de comissão/bônus/estorno ou com comissões vinculadas = só pagamento integral", () => {
    expect(isCommissionLinkedPayable(payable({ origin: "comissao_automatica" }))).toBe(true);
    expect(isCommissionLinkedPayable(payable({ origin: "bonus" }))).toBe(true);
    expect(isCommissionLinkedPayable(payable({ origin: "manual", sourceIds: { commissionIds: ["com_1"] } }))).toBe(true);
    expect(isCommissionLinkedPayable(payable())).toBe(false);
    expect(PARTIAL_COMMISSION_BLOCKED).toMatch(/valor integral/);
  });

  it("desfazer: título pago segue a regra da etapa 2; aberto com baixa parcial pode (exceto comissão); sem baixa não", () => {
    expect(payablePaymentUndoBlock(payable({ status: "pago", payments: [pay(100)] }))).toBeNull();
    expect(payablePaymentUndoBlock(payable({ status: "pago", origin: "comissao_automatica" }))).toBe(UNDO_COMMISSION_BLOCKED);
    expect(payablePaymentUndoBlock(payable({ status: "a_pagar", payments: [pay(40)] }))).toBeNull();
    expect(payablePaymentUndoBlock(payable({ status: "a_pagar", payments: [pay(40)], sourceIds: { commissionIds: ["com_1"] } }))).toBe(UNDO_COMMISSION_BLOCKED);
    expect(payablePaymentUndoBlock(payable({ status: "a_pagar" }))).toMatch(/Só título pago/);
  });

  it("checklist: desfazer a baixa parcial devolve o saldo (sem baixas → em aberto 100)", () => {
    const p = payable({ payments: [pay(40)] });
    const plan = planUndoPayment({ settled: false, amount: p.amount, payments: p.payments }, "bx_40");
    expect(plan).toEqual({ payment: p.payments![0], remaining: [], reopen: false });
    expect(payableSettlement({ ...p, payments: plan.remaining }, TODAY)).toMatchObject({ paid: 0, open: 100, status: "em_aberto" });
  });

  it("desfazer a quitação com desconto devolve o valor original; com resíduo NÃO (o restante está no resíduo)", () => {
    expect(planUndoPayment({ settled: true, amount: 90, originalAmount: 100, payments: [pay(90)] })).toMatchObject({ reopen: true, restoreAmount: 100, remaining: [] });
    expect(planUndoPayment({ settled: true, amount: 30, originalAmount: 100, residualId: "pag_2", payments: [pay(30)] }).restoreAmount).toBeUndefined();
  });

  it("desfazer uma baixa ESPECÍFICA entre várias (por id) mantém as outras", () => {
    const plan = planUndoPayment({ settled: false, amount: 100, payments: [pay(10), pay(20), pay(30)] }, "bx_20");
    expect(plan.payment?.id).toBe("bx_20");
    expect(plan.remaining.map((x) => x.id)).toEqual(["bx_10", "bx_30"]);
  });
});

describe("lançamento de caixa das baixas", () => {
  it("checklist: baixa parcial de 40 gera DESPESA de 40 (não o valor do título)", () => {
    const d = buildPayableCashEntry(payable(), "bx_1", { date: "2026-09-20", amount: 40, accountId: "fa_1", actor })!;
    expect(d).toMatchObject({ amount: 40, type: "despesa", accountId: "fa_1", origin: { kind: "payable", id: "pag_1", paymentId: "bx_1" } });
  });

  it("recebimento de título avulso gera RECEITA com contato cliente (cadastrado ou nome livre) e origem receivable", () => {
    const d = buildReceivableCashEntry(receivable({ clientId: "client_001", categoryId: "fc_outras" }), "bx_r1", { date: "2026-10-01", amount: 25, accountId: "fa_1", actor })!;
    expect(d).toMatchObject({ amount: 25, type: "receita", categoryId: "fc_outras", contact: { type: "cliente", id: "client_001", name: "Padaria Pão Quente" }, origin: { kind: "receivable", id: "rec_1", paymentId: "bx_r1" }, notes: "Baixa de conta a receber" });
    expect(buildReceivableCashEntry(receivable(), "bx", { date: "2026-10-01", amount: 25, accountId: "fa_1", actor })!.contact).toEqual({ type: "cliente", name: "Padaria Pão Quente" });
    expect(buildReceivableCashEntry(receivable(), "bx", { date: "2026-10-01", amount: 0, accountId: "fa_1", actor })).toBeNull();
  });

  it("invariantes: lançamento de título a receber precisa de baixa com o mesmo transactionId e baixa precisa de lançamento", () => {
    const entry = { id: "ce_r", accountId: "fa_1", amount: 25, type: "receita", origin: { kind: "receivable", id: "rec_1", paymentId: "bx_r" } } as CashEntry;
    const ok = cashEntryProblems({ entries: [entry], accountIds: new Set(["fa_1"]), payables: [], billings: [], receivables: [{ id: "rec_1", status: "aberto", payments: [pay(25, { id: "bx_r", transactionId: "ce_r" })] }] });
    expect(ok).toEqual([]);
    const orphan = cashEntryProblems({ entries: [], accountIds: new Set(["fa_1"]), payables: [], billings: [], receivables: [{ id: "rec_1", status: "aberto", payments: [pay(25, { id: "bx_r", transactionId: "ce_r" })] }] });
    expect(orphan[0]).toMatch(/sem lançamento/);
    const missing = cashEntryProblems({ entries: [entry], accountIds: new Set(["fa_1"]), payables: [], billings: [], receivables: [] });
    expect(missing[0]).toMatch(/título a receber inexistente/);
  });
});

describe("invariantes das baixas (verify)", () => {
  it("soma das baixas ≤ valor + 0,005; quitado com baixas soma ≈ valor; baixa com conta e lançamento", () => {
    expect(settlementProblems([{ label: "título", id: "a", amount: 100, status: "a_pagar", settled: false, payments: [pay(40)] }])).toEqual([]);
    expect(settlementProblems([{ label: "título", id: "b", amount: 100, status: "a_pagar", settled: false, payments: [pay(60), pay(50)] }])[0]).toMatch(/somam 110.00 > valor 100.00/);
    expect(settlementProblems([{ label: "título", id: "c", amount: 100, status: "pago", settled: true, payments: [pay(90)] }])[0]).toMatch(/quitado/);
    expect(settlementProblems([{ label: "título", id: "d", amount: 90, status: "pago", settled: true, payments: [pay(90)] }])).toEqual([]);
    expect(settlementProblems([{ label: "título", id: "e", amount: 100, status: "a_pagar", settled: false, payments: [pay(40, { transactionId: "" })] }])[0]).toMatch(/sem conta ou sem lançamento/);
  });
});

describe("parcelamento do título avulso (mesmo padrão de Contas a Pagar)", () => {
  it("R$ 1.000 em 3x → 333,33 + 333,33 + 333,34 (sobra na última)", () => {
    expect(splitInstallments(1000, 3)).toEqual([333.33, 333.33, 333.34]);
  });

  it("vencimentos mensais mantêm o dia limitado ao fim do mês", () => {
    expect(shiftDueMonths("2026-01-31", 1)).toBe("2026-02-28T12:00:00.000Z");
    expect(shiftDueMonths("2026-01-31", 2)).toBe("2026-03-31T12:00:00.000Z");
  });
});
