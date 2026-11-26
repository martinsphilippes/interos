/**
 * Gestão de Produtos (domínio): linha do tempo das versões de preço e pacote, cálculo por modelo de preço, validação
 * e simulação sem cobrança dupla.
 */
import { describe, expect, it } from "vitest";
import {
  appendVersion,
  cancelVersion,
  CommercialRuleError,
  describePrice,
  describeTiers,
  monthlyFor,
  priceProblems,
  versionAt,
  versionState,
  withValidity,
  type CommercialModule,
  type PackageVersion,
  type PriceVersion,
  type ProductPackage,
} from "@/domain/products/commercial";
import { comparePackage, extraInsidePackage, normalizeItems, packageUnitProblems, quote, type QuoteUnit } from "@/domain/products/quote";

const actor = { id: "u1", name: "Ana" };
const fmt = (v: number) => `R$ ${v.toFixed(2).replace(".", ",")}`;

function price(over: Partial<PriceVersion> = {}): Omit<PriceVersion, "version" | "validTo"> {
  return { model: "fixo", monthly: 100, unitPrice: 0, includedQuantity: 0, unitLabel: null, tiers: [], setup: 0, validFrom: "2026-12-01", reason: "Tabela 2026", createdAt: "2026-11-26T12:00:00Z", createdBy: actor, ...over };
}

function versions(...list: Omit<PriceVersion, "version" | "validTo">[]): PriceVersion[] {
  return withValidity(list.map((p, i) => ({ ...p, version: i + 1, validTo: null }) as PriceVersion));
}

function moduleOf(code: string, prices: PriceVersion[], over: Partial<CommercialModule> = {}): CommercialModule {
  return { id: code, code, name: `Módulo ${code}`, summary: null, status: "a_venda", segments: [], requiresCommercial: [], notes: null, prices, createdAt: "", updatedAt: "", updatedBy: actor, ...over };
}

describe("linha do tempo das versões", () => {
  it("cada versão termina na véspera da próxima; a última fica sem fim", () => {
    const all = versions(price({ validFrom: "2026-01-01" }), price({ validFrom: "2026-07-01", monthly: 120 }));
    expect(all.map((v) => [v.version, v.validFrom, v.validTo])).toEqual([
      [1, "2026-01-01", "2026-06-30"],
      [2, "2026-07-01", null],
    ]);
    expect(versionAt(all, "2026-06-30")?.version).toBe(1);
    expect(versionAt(all, "2026-07-01")?.version).toBe(2);
    expect(versionAt(all, "2025-12-31")).toBeNull();
    expect(versionState(all[0], "2026-11-26")).toBe("encerrada");
    expect(versionState(all[1], "2026-11-26")).toBe("vigente");
  });

  it("nova versão começa hoje ou depois e depois do início da última", () => {
    const base = versions(price({ validFrom: "2026-11-01" }));
    expect(() => appendVersion(base, price({ validFrom: "2026-11-25" }), "2026-11-26")).toThrow(CommercialRuleError);
    // Versão de hoje: a nova não pode começar no mesmo dia (corrigir = cancelar a de hoje e criar de novo).
    const today = versions(price({ validFrom: "2026-11-26" }));
    expect(() => appendVersion(today, price({ validFrom: "2026-11-26" }), "2026-11-26")).toThrow(/depois de 26\/11\/2026.*cancele-a/);
    const { versions: next, created } = appendVersion(base, price({ validFrom: "2026-12-01", monthly: 130 }), "2026-11-26");
    expect(created.version).toBe(2);
    expect(next[0].validTo).toBe("2026-11-30");
    expect(versionState(created, "2026-11-26")).toBe("agendada");
    // Já há uma agendada: a nova precisa vir depois dela.
    expect(() => appendVersion(next, price({ validFrom: "2026-11-28" }), "2026-11-26")).toThrow(/agendada para 01\/12\/2026/);
  });

  it("cancelar a agendada devolve a vigência à anterior; o número não é reaproveitado", () => {
    const base = versions(price({ validFrom: "2026-11-01" }), price({ validFrom: "2026-12-01", monthly: 130 }));
    const { versions: after, cancelled } = cancelVersion(base, 2, "2026-11-26", actor, "Valor errado", "2026-11-26T13:00:00Z");
    expect(cancelled.cancelledAt).toBeTruthy();
    expect(versionState(cancelled, "2026-11-26")).toBe("cancelada");
    expect(after[0].validTo).toBeNull();
    expect(versionAt(after, "2026-12-15")?.version).toBe(1);
    const { created } = appendVersion(after, price({ validFrom: "2026-12-01", monthly: 125 }), "2026-11-26");
    expect(created.version).toBe(3);
    expect(() => cancelVersion(after, 2, "2026-11-26", actor, "de novo", "x")).toThrow(/já foi cancelada/);
  });

  it("versão que já começou antes de hoje não é cancelada; a de hoje pode (correção no mesmo dia)", () => {
    const base = versions(price({ validFrom: "2026-11-01" }), price({ validFrom: "2026-11-26", monthly: 999 }));
    expect(() => cancelVersion(base, 1, "2026-11-26", actor, "x", "x")).toThrow(/começa hoje ou depois/);
    const { versions: after } = cancelVersion(base, 2, "2026-11-26", actor, "Digitado errado", "x");
    expect(versionAt(after, "2026-11-26")?.version).toBe(1);
  });
});

describe("cálculo por modelo de preço", () => {
  it("fixo ignora a quantidade", () => {
    expect(monthlyFor({ model: "fixo", monthly: 89.9, unitPrice: 0, includedQuantity: 0, tiers: [] }, 7)).toBe(89.9);
  });

  it("por quantidade: base com unidades incluídas + adicional por unidade", () => {
    const p = { model: "por_quantidade" as const, monthly: 50, unitPrice: 30, includedQuantity: 1, tiers: [] };
    expect(monthlyFor(p, 1)).toBe(50);
    expect(monthlyFor(p, 3)).toBe(110);
    expect(monthlyFor({ ...p, monthly: 0, includedQuantity: 0, unitPrice: 19.9 }, 3)).toBe(59.7);
  });

  it("por faixa: o valor é o da faixa em que a quantidade cai", () => {
    const tiers = [
      { upTo: 3, monthly: 99 },
      { upTo: 10, monthly: 199 },
      { upTo: null, monthly: 349 },
    ];
    const p = { model: "por_faixa" as const, monthly: 0, unitPrice: 0, includedQuantity: 0, tiers };
    expect([1, 3, 4, 10, 11, 500].map((q) => monthlyFor(p, q))).toEqual([99, 99, 199, 199, 349, 349]);
    expect(describeTiers(tiers, "usuário", fmt)).toEqual(["até 3 usuários: R$ 99,00/mês", "até 10 usuários: R$ 199,00/mês", "acima de 10 usuários: R$ 349,00/mês"]);
  });

  it("validação de negócio: faixas crescentes, última sem limite, o que é contado", () => {
    const ok = { model: "por_faixa" as const, monthly: 0, unitPrice: 0, includedQuantity: 0, setup: 0, unitLabel: "usuário", tiers: [{ upTo: 3, monthly: 99 }, { upTo: null, monthly: 199 }] };
    expect(priceProblems(ok)).toEqual([]);
    expect(priceProblems({ ...ok, tiers: [{ upTo: 3, monthly: 99 }, { upTo: 2, monthly: 1 }, { upTo: null, monthly: 2 }] }).join(" ")).toMatch(/Faixa 2/);
    expect(priceProblems({ ...ok, tiers: [{ upTo: 3, monthly: 99 }, { upTo: 5, monthly: 199 }] }).join(" ")).toMatch(/última faixa/);
    expect(priceProblems({ ...ok, unitLabel: " " }).join(" ")).toMatch(/o que é contado/);
    expect(priceProblems({ ...ok, model: "por_quantidade", monthly: 0, unitPrice: 0 }).join(" ")).toMatch(/base ou o valor por unidade/);
    expect(priceProblems({ ...ok, model: "fixo", monthly: -1 }).join(" ")).toMatch(/Mensalidade inválida/);
  });

  it("descrição curta para listas e propostas", () => {
    expect(describePrice({ ...price(), monthly: 89.9, setup: 300 } as PriceVersion, fmt)).toBe("R$ 89,90/mês · implantação R$ 300,00");
    expect(describePrice({ ...price(), model: "por_quantidade", monthly: 50, includedQuantity: 1, unitPrice: 30, unitLabel: "terminal" } as PriceVersion, fmt)).toBe("R$ 50,00/mês com 1 terminal + R$ 30,00 por terminal adicional");
    expect(describePrice({ ...price(), model: "por_quantidade", monthly: 0, unitPrice: 19.9, unitLabel: "usuário" } as PriceVersion, fmt)).toBe("R$ 19,90 por usuário/mês");
  });
});

describe("simulação sem cobrança dupla", () => {
  const units = new Map<string, QuoteUnit>(
    [
      { code: "07.01", name: "PDV", requires: ["18.01"] },
      { code: "07.02", name: "Caixa", requires: [] },
      { code: "18.01", name: "Contas a receber", requires: [] },
      { code: "18.02", name: "Contas a pagar", requires: [] },
      { code: "12.01", name: "Loja virtual", requires: [] },
      { code: "04.01", name: "Emissão de NF-e", requires: [], sellable: false },
    ].map((u) => [u.code, { module: u.code.slice(0, 2), moduleName: "M", sellable: true, ...u }]),
  );
  const modules = new Map<string, CommercialModule>([
    ["07.01", moduleOf("07.01", versions(price({ validFrom: "2026-01-01", model: "por_quantidade", monthly: 60, includedQuantity: 1, unitPrice: 25, unitLabel: "terminal", setup: 200 })))],
    ["07.02", moduleOf("07.02", versions(price({ validFrom: "2026-01-01", monthly: 40 })))],
    ["18.01", moduleOf("18.01", versions(price({ validFrom: "2026-01-01", monthly: 30 })))],
    ["18.02", moduleOf("18.02", versions(price({ validFrom: "2026-01-01", model: "por_faixa", unitLabel: "usuário", tiers: [{ upTo: 3, monthly: 20 }, { upTo: null, monthly: 45 }] })))],
    ["12.01", moduleOf("12.01", [], { status: "sob_consulta" })],
  ]);
  const pkgVersion: PackageVersion = { version: 1, units: ["07.01", "07.02", "18.01"], monthly: 99, setup: 150, validFrom: "2026-01-01", validTo: null, reason: "Lançamento", createdAt: "", createdBy: actor };
  const pkg: ProductPackage = { id: "varejo", name: "Varejo essencial", segment: "varejo", description: null, status: "a_venda", basedOn: null, versions: [pkgVersion], createdAt: "", updatedAt: "", updatedBy: actor };

  it("o que está no pacote não é cobrado de novo; avulso fora do pacote é cobrado pela versão vigente", () => {
    const r = quote({ date: "2026-11-26", units, modules, pkg, items: [{ code: "07.02", quantity: 1 }, { code: "18.02", quantity: 5 }] });
    const byCode = new Map(r.lines.map((l) => [l.code, l]));
    expect(byCode.get("varejo")).toMatchObject({ status: "cobrado", monthly: 99, setup: 150 });
    expect(byCode.get("07.02")).toMatchObject({ status: "incluido", monthly: 0 });
    expect(byCode.get("18.02")).toMatchObject({ status: "cobrado", monthly: 45, priceVersion: 1 });
    expect([r.monthly, r.setup, r.complete]).toEqual([144, 150, true]);
  });

  it("dentro do pacote, só a quantidade além da incluída é cobrada", () => {
    const r = quote({ date: "2026-11-26", units, modules, pkg, items: [{ code: "07.01", quantity: 3 }] });
    expect(r.lines.find((l) => l.code === "07.01")).toMatchObject({ status: "cobrado", monthly: 50 });
    expect(extraInsidePackage(versionAt(modules.get("18.02")!.prices, "2026-11-26")!, 5)).toBe(25);
    expect(extraInsidePackage(versionAt(modules.get("07.02")!.prices, "2026-11-26")!, 9)).toBe(0);
  });

  it("sem preço vigente ou sob consulta = total incompleto; não homologado e descontinuado = indisponível", () => {
    const disc = new Map(modules);
    disc.set("18.01", { ...modules.get("18.01")!, status: "descontinuado" });
    const r = quote({ date: "2026-11-26", units, modules: disc, pkg: null, items: [{ code: "12.01", quantity: 1 }, { code: "04.01", quantity: 1 }, { code: "18.01", quantity: 1 }, { code: "99.99", quantity: 1 }] });
    const status = Object.fromEntries(r.lines.map((l) => [l.code, l.status]));
    expect(status).toEqual({ "12.01": "sem_preco", "04.01": "indisponivel", "18.01": "indisponivel", "99.99": "indisponivel" });
    expect(r.complete).toBe(false);
    expect(r.monthly).toBe(0);
  });

  it("aponta dependências que faltam (técnicas e comerciais) sem incluir sozinho", () => {
    const withRule = new Map(modules);
    withRule.set("18.02", { ...modules.get("18.02")!, requiresCommercial: ["18.01"] });
    const r = quote({ date: "2026-11-26", units, modules: withRule, pkg: null, items: [{ code: "07.01", quantity: 1 }, { code: "18.02", quantity: 1 }] });
    expect(r.missingDependencies).toEqual([{ code: "18.01", name: "Módulo 18.01", requiredBy: ["07.01", "18.02"] }]);
    expect(r.lines.some((l) => l.code === "18.01")).toBe(false);
  });

  it("compara o pacote com a soma avulsa (economia)", () => {
    const c = comparePackage(pkgVersion, modules, "2026-11-26");
    expect(c).toMatchObject({ monthly: 130, setup: 200, unpriced: [], savingMonthly: 31, savingPct: 23.8 });
  });

  it("itens repetidos somam a quantidade", () => {
    expect(normalizeItems([{ code: "07.01", quantity: 1 }, { code: "07.01", quantity: 2 }, { code: "18.01", quantity: 0 }])).toEqual([
      { code: "07.01", quantity: 3 },
      { code: "18.01", quantity: 1 },
    ]);
  });

  it("valida as unidades de um pacote: inexistentes bloqueiam; não homologadas e dependências faltando avisam", () => {
    const { errors, warnings } = packageUnitProblems(["07.01", "04.01", "77.77"], units, modules);
    expect(errors).toEqual(["77.77 não é uma unidade comercial do catálogo do ERP."]);
    expect(warnings.join(" | ")).toMatch(/04\.01 Emissão de NF-e: o ERP ainda não vende/);
    expect(warnings.join(" | ")).toMatch(/07\.01 PDV exige 18\.01 Contas a receber/);
    expect(packageUnitProblems([], units, modules).errors).toEqual(["Escolha pelo menos um módulo para o pacote."]);
  });
});
