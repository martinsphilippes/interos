/**
 * Catálogo de módulos do ERP (recorte real do catalogo-modulos-erp-v2: módulos 01, 05, 07, 24, 27, 36 e 46):
 * normalização tolerante, nomes legíveis, papel de cada item na contratação, unidade dona (inclusão em cadeia e
 * duplicatas), dependências entre unidades, cascata ao desligar, vendável e diferença entre versões.
 */
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import {
  catalogDiff,
  compareCodes,
  dependentsClosure,
  displayItemName,
  indexCatalog,
  isUnitSellable,
  normalizeCatalog,
  normalizeSearch,
  requiredClosure,
} from "@/domain/erp/catalog";

const raw = JSON.parse(readFileSync(new URL("./fixtures/catalogo-v2-recorte.json", import.meta.url), "utf8"));
const catalog = normalizeCatalog(raw);
const index = indexCatalog(catalog);

describe("normalizeCatalog", () => {
  it("lê versão, produto e itens em ordem natural de código", () => {
    expect(catalog.catalogVersion).toBe("2.0.0-proposta");
    expect(catalog.product?.code).toBeTruthy();
    expect(catalog.items.length).toBe(150);
    const codes = catalog.items.map((i) => i.code);
    expect([...codes].sort(compareCodes)).toEqual(codes);
    expect(compareCodes("07.02", "07.10")).toBeLessThan(0);
    expect(compareCodes("07", "07.01")).toBeLessThan(0);
  });

  it("é tolerante: ignora campos desconhecidos, códigos inválidos e duplicados; recusa documento sem itens", () => {
    const c = normalizeCatalog({ catalogVersion: "9", items: [{ code: "99", name: "X", novo: 1 }, { code: "ab" }, { code: "99", name: "dup" }, null] });
    expect(c.items.map((i) => i.code)).toEqual(["99"]);
    expect(c.items[0].level).toBe("module");
    expect(() => normalizeCatalog({ catalogVersion: "1" })).toThrow();
  });

  it("nomes em caixa alta ficam legíveis, com siglas preservadas", () => {
    expect(displayItemName("PDV — PONTO DE VENDA")).toBe("PDV — Ponto de venda");
    expect(displayItemName("E-COMMERCE E VENDAS DIGITAIS")).toBe("E-commerce e vendas digitais");
    expect(displayItemName("WHATSAPP E ATENDIMENTO DIGITAL")).toBe("WhatsApp e atendimento digital");
    expect(displayItemName("PRODUÇÃO E PCP")).toBe("Produção e PCP");
    expect(displayItemName("Abertura de caixa")).toBe("Abertura de caixa");
    expect(index.byCode.get("07")?.name).toBe("PDV — Ponto de venda");
  });

  it("busca sem acento", () => {
    expect(normalizeSearch("Fechamento de CAIXA — Conferência")).toBe("fechamento de caixa — conferencia");
    expect(index.searchTextOf("07.03")).toContain("fechamento de caixa");
    expect(index.searchTextOf("07.02")).toContain("caixa.operacao");
  });
});

describe("papel de cada item", () => {
  it("módulo, unidade, incluído, plataforma e futuro", () => {
    expect(index.roleOf("07")).toBe("module");
    expect(index.roleOf("07.02")).toBe("unit");
    expect(index.roleOf("07.03")).toBe("included");
    expect(index.ownerUnitOf("07.03")).toBe("07.02");
    expect(index.roleOf("24.01")).toBe("core");
    expect(index.roleOf("27.01")).toBe("future");
  });

  it("duplicata (aliasOf) acompanha a unidade do original", () => {
    const alias = catalog.items.find((i) => i.aliasOf && index.ownerUnitOf(i.aliasOf));
    if (alias) expect(index.ownerUnitOf(alias.code)).toBe(index.ownerUnitOf(alias.aliasOf as string));
  });

  it("toda unidade é contratável por si; NF-e/serviço externo e banco só depois da homologação", () => {
    expect(index.units.every((u) => u.unit)).toBe(true);
    const bank = index.byCode.get("36.17");
    if (bank) expect(isUnitSellable(bank)).toBe(false);
    expect(isUnitSellable(index.byCode.get("07.02")!)).toBe(true);
    expect(isUnitSellable({ ...index.byCode.get("07.02")!, sellable: false })).toBe(false);
    expect(isUnitSellable(index.byCode.get("07.03")!)).toBe(false);
  });
});

describe("dependências entre unidades", () => {
  it("cotações exigem pedidos de compra, que exigem fornecedores e produtos (em cadeia, com quem exigiu)", () => {
    const { all, added } = requiredClosure(index, ["05.02"]);
    expect(all).toEqual(["01.03", "01.04", "05.02", "05.04"]);
    expect(added).toEqual([
      { code: "01.03", requiredBy: "05.04" },
      { code: "01.04", requiredBy: "05.04" },
      { code: "05.04", requiredBy: "05.02" },
    ]);
  });

  it("o que já está ligado não aparece como incluído por dependência", () => {
    expect(requiredClosure(index, ["05.02"], new Set(["01.03", "01.04"])).added.map((a) => a.code)).toEqual(["05.04"]);
  });

  it("desligar produtos derruba, em cascata, só as unidades ligadas que dependem dela", () => {
    const enabled = new Set(["01.04", "05.04", "05.02", "07.01", "07.02"]);
    const cascade = dependentsClosure(index, ["01.04"], enabled);
    expect(cascade.map((c) => c.code)).toEqual(["05.02", "05.04", "07.01"]);
    expect(cascade.find((c) => c.code === "05.02")?.because).toBe("05.04");
    expect(index.dependentUnitsOf("05.04")).toContain("05.02");
  });
});

describe("catalogDiff", () => {
  it("novos, retirados e alterados entre versões", () => {
    const next = normalizeCatalog({
      ...raw,
      catalogVersion: "2.1.0",
      items: [
        ...raw.items.filter((i: { code: string }) => i.code !== "27.01"),
        { code: "54", level: "module", name: "NOVO MÓDULO", devStatus: "PLAN", availability: "indisponivel", commercialClass: "RECURSO_FUTURO" },
      ].map((i: { code: string; devStatus?: string }) => (i.code === "07.03" ? { ...i, devStatus: "PARC" } : i)),
    });
    const diff = catalogDiff(catalog, next);
    expect(diff.added).toEqual(["54"]);
    expect(diff.removed).toEqual(["27.01"]);
    expect(diff.changed).toContainEqual({ code: "07.03", fields: ["devStatus"] });
  });

  it("primeira importação não marca tudo como novo", () => {
    expect(catalogDiff(null, catalog)).toEqual({ added: [], removed: [], changed: [] });
  });
});
