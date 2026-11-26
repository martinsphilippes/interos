/**
 * Simulador de comissões (puro, sem banco): monta um contrato fictício com os valores informados, resolve as regras
 * pelo MESMO motor das comissões reais (resolveRules → planSlots → evaluateSlot) e devolve, por tipo de receita, a regra
 * aplicada, a base, o percentual, os tetos, o valor final e a memória de cálculo — e também as regras que casaram mas
 * ficaram de fora (prioridade/exclusividade), para explicar "por que esta regra e não aquela".
 *
 * A parcela simulada é a N-ésima mensalidade (recorrência), a adesão e o hardware. `event` diz se a parcela foi paga
 * ("pago") ou só faturada ("faturado"); carências são consideradas cumpridas (o simulador mostra o valor, não a data).
 */
import { netContractItem, effectiveTotals } from "@/domain/sale-closing";
import { COMMISSION_REVENUE_TYPES } from "@/domain/commissions";
import type { Billing, CommissionCalcStep, CommissionRevenueType, CommissionRule, CommissionRuleSnapshot, Contract, Product } from "@/domain/types";
import { effectivePriority, evaluateSlot, planSlots, resolveRules, ruleMatches, round2, type EvaluatedStatus, type SlotDetail } from "./rules";

export interface SimulationInput {
  sellerId?: string;
  productId?: string;
  planId?: string;
  planName?: string;
  /** Valor da venda avulsa / hardware (tipo de receita hardware). */
  saleValue?: number;
  setupValue?: number;
  monthlyValue?: number;
  /** Valor líquido efetivamente recebido na mensalidade simulada (regras com base "recebido"). */
  receivedValue?: number;
  /** Número da mensalidade simulada (1 = primeira). */
  installment?: number;
  quantity?: number;
  discountPct?: number;
  /** AAAA-MM-DD (padrão: hoje). */
  saleDate?: string;
  event?: "pago" | "faturado";
}

export interface SimulatedLine {
  revenueType: CommissionRevenueType;
  rule: CommissionRuleSnapshot;
  status: EvaluatedStatus;
  amount: number;
  detail: SlotDetail;
  formula: string;
  steps: CommissionCalcStep[];
  /** A parcela simulada não gera comissão nesta regra (ex.: mensalidade fora da lista). */
  notApplicable?: string;
}

export interface SimulationResult {
  lines: SimulatedLine[];
  total: number;
  /** Regras que casaram com a venda mas não foram aplicadas (perderam na prioridade). */
  skipped: { revenueType: CommissionRevenueType; ruleId: string; name: string; priority: number; reason: string }[];
  /** Tipos de receita com valor e sem nenhuma regra. */
  uncovered: CommissionRevenueType[];
}

const DAY = 86_400_000;
const todayKey = () => new Date().toISOString().slice(0, 10);

function addMonthsKey(day: string, months: number, billingDay: number): string {
  const [y, m] = day.split("-").map(Number);
  const first = new Date(Date.UTC(y, m - 1 + months, 1));
  const last = new Date(Date.UTC(first.getUTCFullYear(), first.getUTCMonth() + 1, 0)).getUTCDate();
  return new Date(Date.UTC(first.getUTCFullYear(), first.getUTCMonth(), Math.min(billingDay, last), 12)).toISOString();
}

export function simulateCommission(rules: CommissionRule[], products: Product[], input: SimulationInput): SimulationResult {
  const saleDay = input.saleDate?.slice(0, 10) || todayKey();
  const saleIso = `${saleDay}T12:00:00.000Z`;
  const n = Math.max(1, Math.floor(input.installment ?? 1));
  const product = products.find((p) => p.id === input.productId);
  const billingDay = 10;
  const raw = {
    productId: input.productId ?? "simulacao",
    productName: product?.name ?? "Produto simulado",
    quantity: Math.max(1, Math.floor(input.quantity ?? 1)),
    setupValue: Math.max(0, input.setupValue ?? 0),
    monthlyValue: Math.max(0, input.monthlyValue ?? 0),
    hardwareValue: Math.max(0, input.saleValue ?? 0),
    discountPct: Math.min(Math.max(input.discountPct ?? 0, 0), 100),
    ...(input.planId ? { planId: input.planId, planName: input.planName } : {}),
  };
  const item = netContractItem(raw);
  const totals = effectiveTotals([item]);
  const contract: Contract = {
    id: "simulacao",
    organizationId: "simulacao",
    createdAt: saleIso,
    updatedAt: saleIso,
    clientId: "simulacao",
    number: "SIMULAÇÃO",
    version: 1,
    status: "liberado",
    items: [raw],
    setupTotal: totals.setupTotal,
    monthlyTotal: totals.monthlyTotal,
    hardwareTotal: totals.hardwareTotal,
    billingDay,
    firstDueDate: addMonthsKey(saleDay, 1, billingDay),
    recurrence: "mensal",
    termMonths: Math.max(12, n),
    startDate: saleIso,
    signedAt: saleIso,
    releasedAt: saleIso,
    signers: [],
    financialStatus: "aprovado",
    documentIds: [],
    sellerId: input.sellerId,
  };
  const paidEvent = input.event !== "faturado";
  const billings: Billing[] = [];
  const bill = (type: Billing["type"], installment: number, amount: number, paid: boolean, paidAmount?: number): void => {
    const dueDate = addMonthsKey(saleDay, installment, billingDay);
    billings.push({
      id: `sim_${type}_${installment}`,
      organizationId: "simulacao",
      createdAt: new Date(Date.parse(dueDate) - 10 * DAY).toISOString(),
      updatedAt: dueDate,
      clientId: "simulacao",
      contractId: "simulacao",
      type,
      competence: dueDate.slice(0, 7),
      installment,
      amount,
      dueDate,
      status: paid ? "paga" : "aberta",
      ...(paid ? { paidAt: dueDate, paidAmount: paidAmount ?? amount } : {}),
    });
  };
  if (totals.setupTotal > 0) bill("setup", 1, totals.setupTotal, paidEvent || n > 1);
  if (totals.hardwareTotal > 0) bill("hardware", 1, totals.hardwareTotal, paidEvent || n > 1);
  if (totals.monthlyTotal > 0) for (let i = 1; i <= n; i++) bill("mensalidade", i, totals.monthlyTotal, i < n || paidEvent, i === n ? input.receivedValue : undefined);

  // "Agora" depois da parcela simulada e de qualquer carência: o simulador mostra o valor, não a espera.
  const maxTenure = rules.reduce((m, r) => Math.max(m, r.minTenureDays ?? 0), 0);
  const now = new Date(Date.parse(addMonthsKey(saleDay, n, billingDay)) + (maxTenure + 1) * DAY);

  const lines: SimulatedLine[] = [];
  const skipped: SimulationResult["skipped"] = [];
  const uncovered: CommissionRevenueType[] = [];
  const has: Record<CommissionRevenueType, boolean> = { setup: item.setupValue > 0, recorrencia: item.monthlyValue > 0, hardware: item.hardwareValue > 0 };
  for (const revenueType of COMMISSION_REVENUE_TYPES) {
    if (!has[revenueType]) continue;
    const ctx = { contractId: contract.id, sellerId: input.sellerId, productId: item.productId, productCategory: product?.category, planId: input.planId, revenueType, saleDate: saleDay };
    const applied = resolveRules(rules, ctx, product);
    if (applied.length === 0) uncovered.push(revenueType);
    const appliedIds = new Set(applied.map((r) => r.id));
    const winner = applied[applied.length - 1];
    for (const r of rules.filter((x) => ruleMatches(x, ctx) && !appliedIds.has(x.id))) {
      skipped.push({ revenueType, ruleId: r.id, name: r.name, priority: effectivePriority(r), reason: winner ? `"${winner.name}" (prioridade ${winner.priority ?? "—"}) é exclusiva e foi avaliada antes` : "não aplicada" });
    }
    for (const rule of applied) {
      const specs = planSlots(rule, item, contract, totals, billings);
      const target = revenueType === "recorrencia" ? specs.find((sp) => sp.installment === n) : specs[0];
      if (!target) {
        lines.push({
          revenueType,
          rule,
          status: "prevista",
          amount: 0,
          detail: { eligibleBase: 0, base: 0, deductions: 0, baseCapApplied: false, amountBeforeCap: 0, amountCapApplied: false },
          formula: "—",
          steps: [{ label: "Regra aplicada", value: rule.name }],
          notApplicable: revenueType === "recorrencia" ? `A ${n}ª mensalidade não gera comissão nesta regra` : "Sem parcela comissionável",
        });
        continue;
      }
      const ev = evaluateSlot({ rule, spec: target, item, contract, billings, saleDate: saleIso, now });
      lines.push({ revenueType, rule, status: ev.status, amount: ev.amount, detail: ev.detail, formula: ev.formula, steps: ev.steps });
    }
  }
  return { lines, total: round2(lines.filter((l) => l.status === "liberada").reduce((s, l) => s + l.amount, 0)), skipped, uncovered };
}
