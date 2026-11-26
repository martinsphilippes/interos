/**
 * Motor de comissões v3 — regras puras (src/server/commissions/rules.ts + simulate.ts): tetos (base × valor final),
 * mensalidades específicas, faturamento × pagamento, base bruta/líquida/referência com deduções, regras por produto,
 * serviço, plano e vendedor, combinação, prioridade, cumulativa × exclusiva, versões (não retroatividade), validação
 * do formulário e status exibidos. Cada caso do pedido COM.01–COM.08 tem pelo menos um teste.
 */
import { describe, expect, it } from "vitest";
import { commissionDisplayStatus } from "@/domain/commissions";
import type { CommissionRule, CommissionRuleVersion, Product } from "@/domain/types";
import { defaultPriority, effectivePriority, resolveRules, ruleFromInput, rulesAsOf, shapeBase, snapshotRule } from "@/server/commissions/rules";
import { ruleInputSchema } from "@/server/commissions/schemas";
import { simulateCommission } from "@/server/commissions/simulate";

let seq = 0;
function rule(over: Partial<CommissionRule> = {}): CommissionRule {
  seq++;
  return {
    id: over.id ?? `r${seq}`,
    organizationId: "org",
    createdAt: "2026-01-01T00:00:00.000Z",
    updatedAt: over.updatedAt ?? `2026-01-01T00:00:${String(seq % 60).padStart(2, "0")}.000Z`,
    name: over.name ?? `Regra ${seq}`,
    revenueType: "setup",
    mode: "percentual",
    value: 10,
    releaseCondition: "pagamento",
    active: true,
    scope: "padrao",
    trigger: "pagamento",
    baseSource: "contratado",
    minTenureDays: 0,
    recurringCompetences: null,
    overridesDefault: true,
    ...over,
  };
}

const product = (over: Partial<Product> = {}): Product => ({
  id: "erp",
  organizationId: "org",
  createdAt: "2026-01-01T00:00:00.000Z",
  updatedAt: "2026-01-01T00:00:00.000Z",
  name: "ERP Intercert",
  category: "erp",
  setupPrice: 400,
  monthlyPrice: 400,
  hardwarePrice: 0,
  billingType: "ambos",
  commission: { setupPct: 0, recurringPct: 0, hardwarePct: 0, recurringReleaseInstallment: 3 },
  active: true,
  order: 1,
  ...over,
});

const ERP = product();
const SERVICE = product({ id: "consultoria", name: "Consultoria fiscal", category: "consultoria" });
const PRODUCTS = [ERP, SERVICE];

function line(result: ReturnType<typeof simulateCommission>, type: "setup" | "recorrencia" | "hardware" = "setup") {
  const l = result.lines.filter((x) => x.revenueType === type);
  expect(l.length).toBeGreaterThan(0);
  return l;
}

describe("COM.01 — adesão (percentual ou valor fixo)", () => {
  it("percentual sobre a adesão", () => {
    const r = simulateCommission([rule({ value: 25 })], PRODUCTS, { productId: "erp", setupValue: 400 });
    expect(line(r)[0].amount).toBe(100);
    expect(r.total).toBe(100);
  });
  it("valor fixo por unidade", () => {
    const r = simulateCommission([rule({ mode: "valor", value: 80 })], PRODUCTS, { productId: "erp", setupValue: 400, quantity: 2 });
    expect(line(r)[0].amount).toBe(160);
  });
});

describe("COM.02 — teto da base × teto do valor final", () => {
  it("exemplo do pedido: adesão 400, teto da base 100, 25% → R$ 25", () => {
    const r = simulateCommission([rule({ value: 25, baseCap: 100 })], PRODUCTS, { productId: "erp", setupValue: 400 });
    const l = line(r)[0];
    expect(l.amount).toBe(25);
    expect(l.detail.eligibleBase).toBe(400);
    expect(l.detail.base).toBe(100);
    expect(l.detail.baseCapApplied).toBe(true);
    expect(l.steps.some((s) => s.label === "Teto da base" && s.value.includes("R$"))).toBe(true);
  });
  it("base abaixo do teto não muda", () => {
    const l = line(simulateCommission([rule({ value: 25, baseCap: 500 })], PRODUCTS, { productId: "erp", setupValue: 400 }))[0];
    expect(l.amount).toBe(100);
    expect(l.detail.baseCapApplied).toBe(false);
  });
  it("teto do valor final é independente do teto da base", () => {
    const onlyAmountCap = line(simulateCommission([rule({ value: 25, amountCap: 50 })], PRODUCTS, { productId: "erp", setupValue: 400 }))[0];
    expect(onlyAmountCap.amount).toBe(50);
    expect(onlyAmountCap.detail.amountBeforeCap).toBe(100);
    expect(onlyAmountCap.detail.amountCapApplied).toBe(true);
    const both = line(simulateCommission([rule({ value: 25, baseCap: 100, amountCap: 20 })], PRODUCTS, { productId: "erp", setupValue: 400 }))[0];
    expect(both.detail.base).toBe(100);
    expect(both.detail.amountBeforeCap).toBe(25);
    expect(both.amount).toBe(20);
    const capNotReached = line(simulateCommission([rule({ value: 25, baseCap: 100, amountCap: 40 })], PRODUCTS, { productId: "erp", setupValue: 400 }))[0];
    expect(capNotReached.amount).toBe(25);
    expect(capNotReached.detail.amountCapApplied).toBe(false);
  });
});

describe("COM.03 — mensalidades específicas, faturamento × pagamento", () => {
  const monthly = (over: Partial<CommissionRule> = {}) => rule({ revenueType: "recorrencia", installments: [1, 3, 6], value: 50, ...over });
  it("só as mensalidades listadas geram comissão", () => {
    const rules = [monthly()];
    expect(line(simulateCommission(rules, PRODUCTS, { productId: "erp", monthlyValue: 200, installment: 3 }), "recorrencia")[0].amount).toBe(100);
    const second = line(simulateCommission(rules, PRODUCTS, { productId: "erp", monthlyValue: 200, installment: 2 }), "recorrencia")[0];
    expect(second.amount).toBe(0);
    expect(second.notApplicable).toContain("2ª mensalidade");
    expect(line(simulateCommission(rules, PRODUCTS, { productId: "erp", monthlyValue: 200, installment: 6 }), "recorrencia")[0].amount).toBe(100);
    expect(line(simulateCommission(rules, PRODUCTS, { productId: "erp", monthlyValue: 200, installment: 7 }), "recorrencia")[0].notApplicable).toBeTruthy();
  });
  it("não considera todas as mensalidades: a lista ordena e remove repetidas", () => {
    const snap = snapshotRule(monthly({ installments: [6, 1, 3, 3] }));
    expect(snap.installments).toEqual([1, 3, 6]);
    expect(snap.releaseInstallment).toBe(1);
    expect(snap.recurringCompetences).toBeNull();
  });
  it("após o pagamento: mensalidade só faturada não libera", () => {
    const r = simulateCommission([monthly()], PRODUCTS, { productId: "erp", monthlyValue: 200, installment: 3, event: "faturado" });
    const l = line(r, "recorrencia")[0];
    expect(l.status).not.toBe("liberada");
    expect(l.amount).toBe(100);
    expect(r.total).toBe(0);
  });
  it("no faturamento: libera sem esperar o pagamento", () => {
    const r = simulateCommission([monthly({ trigger: "faturamento" })], PRODUCTS, { productId: "erp", monthlyValue: 200, installment: 3, event: "faturado" });
    expect(line(r, "recorrencia")[0].status).toBe("liberada");
    expect(r.total).toBe(100);
  });
  it("faixa contínua antiga continua valendo (regra sem lista)", () => {
    const old = rule({ revenueType: "recorrencia", releaseInstallment: 2, recurringCompetences: 2, value: 10 });
    expect(line(simulateCommission([old], PRODUCTS, { productId: "erp", monthlyValue: 100, installment: 1 }), "recorrencia")[0].notApplicable).toBeTruthy();
    expect(line(simulateCommission([old], PRODUCTS, { productId: "erp", monthlyValue: 100, installment: 3 }), "recorrencia")[0].amount).toBe(10);
    expect(line(simulateCommission([old], PRODUCTS, { productId: "erp", monthlyValue: 100, installment: 4 }), "recorrencia")[0].notApplicable).toBeTruthy();
  });
});

describe("COM.04 — base bruta, líquida (deduções) e referência", () => {
  const steps: { label: string; value: string }[] = [];
  it("bruto desfaz o desconto do item", () => {
    const l = line(simulateCommission([rule({ value: 10, baseKind: "bruto" })], PRODUCTS, { productId: "erp", setupValue: 400, discountPct: 20 }))[0];
    expect(l.detail.eligibleBase).toBe(400);
    expect(l.amount).toBe(40);
  });
  it("líquido (padrão) usa o valor depois do desconto", () => {
    const l = line(simulateCommission([rule({ value: 10 })], PRODUCTS, { productId: "erp", setupValue: 400, discountPct: 20 }))[0];
    expect(l.detail.base).toBe(320);
    expect(l.amount).toBe(32);
  });
  it("líquido com deduções percentuais e fixas configuradas na regra", () => {
    const out = shapeBase({ baseKind: "liquido", deductions: [{ label: "ISS", mode: "percentual", value: 5 }, { label: "Taxa", mode: "valor", value: 2 }] }, 100, { quantity: 1, discountPct: 0 }, steps);
    expect(out.deductions).toBe(7);
    expect(out.base).toBe(93);
    expect(steps.at(-1)?.value).toContain("ISS");
  });
  it("deduções nunca deixam a base negativa", () => {
    expect(shapeBase({ deductions: [{ label: "Taxa", mode: "valor", value: 500 }] }, 100, { quantity: 1, discountPct: 0 }, []).base).toBe(0);
  });
  it("referência fixa por unidade ignora o valor vendido", () => {
    const l = line(simulateCommission([rule({ value: 10, baseKind: "referencia", referenceValue: 150 })], PRODUCTS, { productId: "erp", setupValue: 999, quantity: 2 }))[0];
    expect(l.detail.base).toBe(300);
    expect(l.amount).toBe(30);
  });
  it("base recebida usa o valor líquido recebido", () => {
    const l = line(simulateCommission([rule({ revenueType: "recorrencia", baseSource: "recebido", value: 10 })], PRODUCTS, { productId: "erp", monthlyValue: 200, receivedValue: 150, installment: 1 }), "recorrencia")[0];
    expect(l.amount).toBe(15);
  });
});

describe("COM.05 / COM.06 — produto e serviço específicos", () => {
  const general = rule({ name: "Geral", value: 5 });
  const erp = rule({ name: "ERP", productId: "erp", value: 20 });
  const service = rule({ name: "Consultoria", productId: "consultoria", value: 40 });
  it("regra do produto vence a geral", () => {
    const r = simulateCommission([general, erp, service], PRODUCTS, { productId: "erp", setupValue: 100 });
    expect(line(r)[0].rule.name).toBe("ERP");
    expect(r.skipped.map((s) => s.name)).toContain("Geral");
  });
  it("serviço tem regra própria, independente do produto", () => {
    expect(line(simulateCommission([general, erp, service], PRODUCTS, { productId: "consultoria", setupValue: 100 }))[0].amount).toBe(40);
  });
  it("categoria vale para todos os produtos da categoria, abaixo do produto", () => {
    const cat = rule({ name: "Categoria ERP", productCategory: "erp", value: 15 });
    expect(line(simulateCommission([general, cat], PRODUCTS, { productId: "erp", setupValue: 100 }))[0].rule.name).toBe("Categoria ERP");
    expect(line(simulateCommission([general, cat, erp], PRODUCTS, { productId: "erp", setupValue: 100 }))[0].rule.name).toBe("ERP");
  });
});

describe("COM.07 — plano específico", () => {
  const erp = rule({ name: "ERP", productId: "erp", value: 20 });
  const star = rule({ name: "ERP Star", productId: "erp", planId: "star", value: 30 });
  it("plano vence o produto quando o item é do plano", () => {
    expect(line(simulateCommission([erp, star], PRODUCTS, { productId: "erp", planId: "star", setupValue: 100 }))[0].rule.name).toBe("ERP Star");
  });
  it("sem o plano no item, a regra do plano não se aplica", () => {
    expect(line(simulateCommission([erp, star], PRODUCTS, { productId: "erp", setupValue: 100 }))[0].rule.name).toBe("ERP");
    expect(line(simulateCommission([erp, star], PRODUCTS, { productId: "erp", planId: "basic", setupValue: 100 }))[0].rule.name).toBe("ERP");
  });
  it("plano com regras diferentes para adesão e mensalidade", () => {
    const starMonthly = rule({ name: "Star mensal", planId: "star", revenueType: "recorrencia", installments: [3], value: 25 });
    const r = simulateCommission([star, starMonthly], PRODUCTS, { productId: "erp", planId: "star", setupValue: 100, monthlyValue: 200, installment: 3 });
    expect(line(r, "setup")[0].amount).toBe(30);
    expect(line(r, "recorrencia")[0].amount).toBe(50);
  });
});

describe("COM.08 — vendedor diferenciado", () => {
  const general = rule({ name: "Geral", value: 10 });
  const ana = rule({ name: "Ana", scope: "vendedor", userId: "ana", value: 30 });
  it("a mesma venda gera valores diferentes conforme o vendedor", () => {
    expect(line(simulateCommission([general, ana], PRODUCTS, { sellerId: "ana", productId: "erp", setupValue: 100 }))[0].amount).toBe(30);
    expect(line(simulateCommission([general, ana], PRODUCTS, { sellerId: "bruno", productId: "erp", setupValue: 100 }))[0].amount).toBe(10);
  });
  it("vendedor + produto vence vendedor geral", () => {
    const anaErp = rule({ name: "Ana ERP", scope: "vendedor", userId: "ana", productId: "erp", value: 50 });
    expect(line(simulateCommission([general, ana, anaErp], PRODUCTS, { sellerId: "ana", productId: "erp", setupValue: 100 }))[0].rule.name).toBe("Ana ERP");
  });
});

describe("Combinação de condições numa regra (exemplo do pedido)", () => {
  it("ERP Intercert + Star + vendedor + 3ª mensalidade paga + líquido + teto da base 100 + 25%", () => {
    const combo = rule({
      name: "Star 3ª mensalidade",
      scope: "vendedor",
      userId: "ana",
      productId: "erp",
      planId: "star",
      revenueType: "recorrencia",
      installments: [3],
      trigger: "pagamento",
      baseKind: "liquido",
      deductions: [{ label: "Impostos", mode: "percentual", value: 10 }],
      baseCap: 100,
      value: 25,
    });
    const general = rule({ revenueType: "recorrencia", value: 1 });
    const hit = simulateCommission([combo, general], PRODUCTS, { sellerId: "ana", productId: "erp", planId: "star", monthlyValue: 400, installment: 3 });
    const l = line(hit, "recorrencia")[0];
    expect(l.rule.name).toBe("Star 3ª mensalidade");
    expect(l.detail.eligibleBase).toBe(360);
    expect(l.detail.base).toBe(100);
    expect(l.amount).toBe(25);
    expect(l.status).toBe("liberada");
    // Qualquer condição diferente → a regra não se aplica.
    expect(line(simulateCommission([combo, general], PRODUCTS, { sellerId: "bruno", productId: "erp", planId: "star", monthlyValue: 400, installment: 3 }), "recorrencia")[0].rule.id).toBe(general.id);
    expect(line(simulateCommission([combo, general], PRODUCTS, { sellerId: "ana", productId: "erp", monthlyValue: 400, installment: 3 }), "recorrencia")[0].rule.id).toBe(general.id);
    expect(line(simulateCommission([combo, general], PRODUCTS, { sellerId: "ana", productId: "erp", planId: "star", monthlyValue: 400, installment: 2 }), "recorrencia")[0].notApplicable).toBeTruthy();
  });
});

describe("Prioridade, cumulativa × exclusiva, duplicidade", () => {
  it("prioridade padrão segue a ordem do pedido", () => {
    expect(defaultPriority({ scope: "contrato", contractId: "c" })).toBe(0);
    expect(defaultPriority({ scope: "vendedor", userId: "u", productId: "p" })).toBe(10);
    expect(defaultPriority({ scope: "vendedor", userId: "u", planId: "s" })).toBe(10);
    expect(defaultPriority({ scope: "vendedor", userId: "u" })).toBe(15);
    expect(defaultPriority({ scope: "padrao", planId: "s" })).toBe(20);
    expect(defaultPriority({ scope: "padrao", productId: "p" })).toBe(30);
    expect(defaultPriority({ scope: "padrao", productCategory: "erp" })).toBe(35);
    expect(defaultPriority({ scope: "padrao" })).toBe(40);
  });
  it("prioridade explícita muda a ordem", () => {
    const general = rule({ name: "Geral prioritária", value: 5, priority: 1 });
    const ana = rule({ name: "Ana", scope: "vendedor", userId: "ana", value: 30 });
    expect(effectivePriority(general)).toBe(1);
    expect(line(simulateCommission([general, ana], PRODUCTS, { sellerId: "ana", productId: "erp", setupValue: 100 }))[0].rule.name).toBe("Geral prioritária");
  });
  it("não acumula por padrão: a exclusiva mais prioritária encerra", () => {
    const r = simulateCommission([rule({ value: 10 }), rule({ productId: "erp", value: 20 })], PRODUCTS, { productId: "erp", setupValue: 100 });
    expect(line(r)).toHaveLength(1);
    expect(r.total).toBe(20);
  });
  it("cumulativa soma-se às seguintes quando o administrador escolhe", () => {
    const bonus = rule({ name: "Bônus ERP", productId: "erp", value: 5, overridesDefault: false });
    const r = simulateCommission([rule({ name: "Geral", value: 10 }), bonus], PRODUCTS, { productId: "erp", setupValue: 100 });
    expect(line(r).map((l) => l.rule.name).sort()).toEqual(["Bônus ERP", "Geral"]);
    expect(r.total).toBe(15);
  });
  it("nunca devolve a mesma regra duas vezes (sem duplicidade para o mesmo evento)", () => {
    const a = rule({ productId: "erp", value: 5, overridesDefault: false });
    const out = resolveRules([a, a, rule({ value: 10 })], { contractId: "c", productId: "erp", productCategory: "erp", revenueType: "setup", saleDate: "2026-05-01" }, ERP);
    expect(out.map((r) => r.id)).toEqual([a.id, out[1].id]);
    expect(new Set(out.map((r) => r.id)).size).toBe(out.length);
  });
  it("regras antigas (sem campos v3) mantêm a precedência contrato > vendedor > produto > padrão", () => {
    const ctx = { contractId: "c1", sellerId: "ana", productId: "erp", productCategory: "erp", revenueType: "setup" as const, saleDate: "2026-05-01" };
    const padrao = rule({ name: "padrão" });
    const prod = rule({ name: "produto", productId: "erp" });
    const vend = rule({ name: "vendedor", scope: "vendedor", userId: "ana" });
    const exc = rule({ name: "exceção", scope: "contrato", contractId: "c1" });
    expect(resolveRules([padrao, prod, vend, exc], ctx, ERP)[0].name).toBe("exceção");
    expect(resolveRules([padrao, prod, vend], ctx, ERP)[0].name).toBe("vendedor");
    expect(resolveRules([padrao, prod], ctx, ERP)[0].name).toBe("produto");
    expect(resolveRules([padrao], ctx, ERP)[0].name).toBe("padrão");
  });
  it("padrão do cadastro do produto só entra quando nada se aplica", () => {
    const withDefault = product({ commission: { setupPct: 7, recurringPct: 0, hardwarePct: 0, recurringReleaseInstallment: 3 } });
    expect(simulateCommission([], [withDefault], { productId: "erp", setupValue: 100 }).lines[0].amount).toBe(7);
    expect(simulateCommission([rule({ value: 10 })], [withDefault], { productId: "erp", setupValue: 100 }).lines[0].amount).toBe(10);
  });
  it("tipo de receita sem regra aparece como descoberto", () => {
    expect(simulateCommission([rule({ value: 10 })], PRODUCTS, { productId: "erp", setupValue: 100, monthlyValue: 50 }).uncovered).toEqual(["recorrencia"]);
  });
});

describe("Versões — não retroatividade", () => {
  const base = rule({ id: "rv", value: 10 });
  const version = (n: number, effectiveFrom: string, value: number, retroactive = false): CommissionRuleVersion => ({
    id: `rv_${n}`,
    organizationId: "org",
    createdAt: effectiveFrom,
    updatedAt: effectiveFrom,
    ruleId: "rv",
    version: n,
    rule: { ...base, value },
    effectiveFrom,
    retroactive,
    changedBy: "u",
  });
  it("venda usa a versão vigente na data da venda", () => {
    const versions = [version(1, "2026-01-01T00:00:00.000Z", 10, true), version(2, "2026-06-01T00:00:00.000Z", 20)];
    expect(rulesAsOf([base], versions, "2026-05-31T12:00:00.000Z")[0].value).toBe(10);
    expect(rulesAsOf([base], versions, "2026-06-02T12:00:00.000Z")[0].value).toBe(20);
    expect(rulesAsOf([base], versions, "2026-06-02T12:00:00.000Z")[0].version).toBe(2);
  });
  it("reaplicação autorizada vale também para vendas anteriores", () => {
    const versions = [version(1, "2026-01-01T00:00:00.000Z", 10, true), version(2, "2026-06-01T00:00:00.000Z", 20, true)];
    expect(rulesAsOf([base], versions, "2026-02-01T12:00:00.000Z")[0].value).toBe(20);
  });
  it("regra criada depois da venda (sem reaplicar) não alcança a venda", () => {
    expect(rulesAsOf([base], [version(1, "2026-06-01T00:00:00.000Z", 10)], "2026-05-01T12:00:00.000Z")).toHaveLength(0);
  });
  it("regra sem versões (anterior ao versionamento) vale como está", () => {
    expect(rulesAsOf([base], [], "2020-01-01T00:00:00.000Z")[0].value).toBe(10);
  });
  it("exceção por contrato usa sempre a versão atual", () => {
    const exc = rule({ id: "rv", scope: "contrato", contractId: "c", value: 99 });
    expect(rulesAsOf([exc], [version(1, "2026-06-01T00:00:00.000Z", 10)], "2026-01-01T12:00:00.000Z")[0].value).toBe(99);
  });
  it("a regra desativada numa versão posterior continua valendo para vendas anteriores", () => {
    const off: CommissionRuleVersion = { ...version(2, "2026-06-01T00:00:00.000Z", 10), rule: { ...base, active: false } };
    const v1 = version(1, "2026-01-01T00:00:00.000Z", 10, true);
    expect(rulesAsOf([base], [v1, off], "2026-03-01T12:00:00.000Z")[0].active).toBe(true);
    expect(rulesAsOf([base], [v1, off], "2026-07-01T12:00:00.000Z")[0].active).toBe(false);
  });
});

describe("Formulário (ruleInputSchema + ruleFromInput)", () => {
  const ok = {
    name: "Regra teste",
    scope: "padrao",
    revenueType: "recorrencia",
    mode: "percentual",
    value: 25,
    trigger: "pagamento",
    baseSource: "contratado",
    minTenureDays: 0,
    recurringCompetences: null,
    releaseInstallment: 1,
    overridesDefault: true,
  };
  it("aceita a regra completa e normaliza código e mensalidades", () => {
    const parsed = ruleInputSchema.parse({ ...ok, code: "com-erp-03", installments: [6, 3, 3], baseCap: 100, amountCap: 80, deductions: [{ label: "ISS", mode: "percentual", value: 5 }] });
    expect(parsed.code).toBe("COM-ERP-03");
    const data = ruleFromInput(parsed);
    expect(data.installments).toEqual([3, 6]);
    expect(data.releaseInstallment).toBe(3);
    expect(data.recurringCompetences).toBeNull();
    expect(data.baseCap).toBe(100);
    expect(data.amountCap).toBe(80);
    expect(data.deductions).toHaveLength(1);
  });
  it.each([
    [{ trigger: "faturamento", baseSource: "recebido" }, "faturamento"],
    [{ baseKind: "referencia" }, "referência"],
    [{ baseKind: "bruto", deductions: [{ label: "ISS", mode: "percentual", value: 5 }] }, "Deduções"],
    [{ revenueType: "setup", trigger: "pagamento", installments: [3] }, "recorrência"],
    [{ mode: "valor", baseCap: 100 }, "Teto da base"],
    [{ installments: [3], trigger: "mensalidade_n" }, "faturamento ou após o pagamento"],
  ])("recusa combinação inválida %#", (patch, message) => {
    const r = ruleInputSchema.safeParse({ ...ok, ...patch });
    expect(r.success).toBe(false);
    expect(r.error?.issues.map((i) => i.message).join(" | ")).toContain(message);
  });
});

describe("Status exibidos no controle", () => {
  it("mapeia os status gravados para os do pedido", () => {
    expect(commissionDisplayStatus("prevista")).toBe("prevista");
    expect(commissionDisplayStatus("em_carencia")).toBe("aguardando_condicao");
    expect(commissionDisplayStatus("aguardando_recebimento")).toBe("aguardando_condicao");
    expect(commissionDisplayStatus("liberada")).toBe("liberada");
    expect(commissionDisplayStatus("titulo_gerado", "previsto")).toBe("liberada");
    expect(commissionDisplayStatus("titulo_gerado", "aprovado")).toBe("aprovada");
    expect(commissionDisplayStatus("titulo_gerado", "a_pagar")).toBe("aprovada");
    expect(commissionDisplayStatus("paga")).toBe("paga");
    expect(commissionDisplayStatus("cancelada")).toBe("cancelada");
    expect(commissionDisplayStatus("estornada")).toBe("estornada");
    expect(commissionDisplayStatus("bloqueada")).toBe("bloqueada");
  });
});
