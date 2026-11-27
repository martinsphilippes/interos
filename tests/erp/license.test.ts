/**
 * Licença por empresa (contrato v2), sobre o recorte real do catálogo: o lote inclui as dependências de quem liga,
 * desliga em cascata quem ficaria sem dependência (também no desligamento agendado), recusa o que não é unidade, o que
 * ainda não é vendável e datas no passado, e monta o retrato completo com unidades explícitas.
 */
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { catalogDiff, indexCatalog, normalizeCatalog } from "@/domain/erp/catalog";
import { buildSnapshot, deactivations, describeDisplayChange, displayDivergences, hasDisplayWork, isOnState, planDisplayChanges, planLicenseChanges, type ErpLicenseItem } from "@/domain/erp/license";

const index = indexCatalog(normalizeCatalog(JSON.parse(readFileSync(new URL("./fixtures/catalogo-v2-recorte.json", import.meta.url), "utf8"))));
const NOW = new Date("2026-11-26T12:00:00.000Z");
const FUTURE = "2026-12-10T03:00:00.000Z";
const on = (...codes: string[]): ErpLicenseItem[] => codes.map((code) => ({ code, state: "active" }));

describe("planLicenseChanges", () => {
  it("ligar cotações inclui pedidos de compra, fornecedores e produtos, dizendo quem exigiu cada um", () => {
    const plan = planLicenseChanges(index, [], [{ code: "05.02", state: "active" }], NOW);
    expect(plan.errors).toEqual([]);
    expect(plan.changes.map((c) => [c.code, c.origin, c.relatedTo ?? null])).toEqual([
      ["01.03", "dependencia", "05.04"],
      ["01.04", "dependencia", "05.04"],
      ["05.02", "pedido", null],
      ["05.04", "dependencia", "05.02"],
    ]);
    expect(plan.items.map((i) => i.code)).toEqual(["01.03", "01.04", "05.02", "05.04"]);
  });

  it("o que já está ligado não entra de novo", () => {
    const plan = planLicenseChanges(index, on("01.03", "01.04"), [{ code: "05.02", state: "active" }], NOW);
    expect(plan.changes.map((c) => c.code)).toEqual(["05.02", "05.04"]);
  });

  it("desligar produtos desliga em cascata, explicitamente, quem depende dele (inclusive em cadeia)", () => {
    const current = on("01.03", "01.04", "05.04", "05.02", "07.01", "07.02");
    const plan = planLicenseChanges(index, current, [{ code: "01.04", state: "inactive" }], NOW);
    const cascade = plan.changes.filter((c) => c.origin === "cascata");
    expect(cascade.map((c) => [c.code, c.to, c.relatedTo])).toEqual([
      ["05.02", "inactive", "05.04"],
      ["05.04", "inactive", "01.04"],
      ["07.01", "inactive", "01.04"],
    ]);
    expect(plan.items.find((i) => i.code === "07.02")?.state).toBe("active");
    expect(deactivations(plan).map((c) => c.code)).toEqual(["01.04", "05.02", "05.04", "07.01"]);
  });

  it("desligamento agendado leva os dependentes para a mesma data", () => {
    const current = on("01.03", "01.04", "05.04", "05.02");
    const plan = planLicenseChanges(index, current, [{ code: "05.04", state: "suspension_scheduled", effectiveAt: FUTURE }], NOW);
    expect(plan.errors).toEqual([]);
    expect(plan.changes.find((c) => c.code === "05.02")).toMatchObject({ to: "suspension_scheduled", effectiveAt: FUTURE, origin: "cascata" });
    expect(isOnState("suspension_scheduled")).toBe(true);
    expect(deactivations(plan).map((c) => c.code)).toEqual(["05.02", "05.04"]);
  });

  it("recusa item que não é unidade, unidade ainda não vendável e data passada ou ausente", () => {
    const plan = planLicenseChanges(
      index,
      [],
      [
        { code: "07.03", state: "active" },
        { code: "36.17", state: "active" },
        { code: "07.02", state: "trial" },
        { code: "07.01", state: "activation_scheduled", effectiveAt: "2026-01-01T00:00:00.000Z" },
      ],
      NOW,
    );
    expect(plan.errors.map((e) => [e.code, e.reason])).toEqual([
      ["07.03", "nao_e_unidade"],
      ["36.17", "nao_vendavel"],
      ["07.02", "data_invalida"],
      ["07.01", "data_invalida"],
    ]);
    expect(plan.changes).toEqual([]);
  });

  it("unidade não vendável que a empresa já tem continua (acesso preservado)", () => {
    const plan = planLicenseChanges(index, on("36.17"), [{ code: "07.02", state: "active" }], NOW);
    expect(plan.errors).toEqual([]);
    expect(plan.items.map((i) => i.code)).toEqual(["07.02", "36.17"]);
  });

  it("teste com data futura, sem mudança e desligar o que não estava contratado viram avisos", () => {
    const plan = planLicenseChanges(index, on("07.02"), [{ code: "07.02", state: "active" }, { code: "05.04", state: "inactive" }, { code: "07.01", state: "trial", until: FUTURE }], NOW);
    expect(plan.warnings.map((w) => [w.code, w.reason])).toEqual([
      ["07.02", "sem_mudanca"],
      ["05.04", "sem_mudanca"],
    ]);
    expect(plan.changes.find((c) => c.code === "07.01")).toMatchObject({ to: "trial", until: FUTURE });
  });
});

describe("buildSnapshot", () => {
  it("retrato completo com unidades explícitas, versão nova e condições anteriores preservadas", () => {
    const s = buildSnapshot({
      companyId: "c0ffee",
      licenseVersion: 8,
      items: [{ code: "07.02", state: "active" }, { code: "05.02", state: "trial", until: FUTURE }],
      previous: { commercialStatus: "active", validUntil: "2027-11-30T23:59:59-03:00", limits: { users: 15 }, display: "upsell", controlMode: "enforced" },
      controlMode: "enforced",
      issuedAt: NOW.toISOString(),
    });
    expect(s).toMatchObject({ licenseVersion: 8, companyId: "c0ffee", product: "erp-intercert", commercialStatus: "active", validUntil: "2027-11-30T23:59:59-03:00", limits: { users: 15 }, display: "upsell", controlMode: "enforced" });
    expect(s.items).toEqual([
      { code: "07.02", state: "active", until: null, effectiveAt: null, reason: null },
      { code: "05.02", state: "trial", until: FUTURE, effectiveAt: null, reason: null },
    ]);
    expect(s.items.some((i) => /^\d\d$/.test(i.code))).toBe(false);
  });

  it("exibição por unidade segue em toda versão; o lote com exibição nova substitui", () => {
    const previous = { commercialStatus: "active" as const, display: "hidden" as const, displays: [{ code: "05.02", display: "upsell" as const }] };
    const kept = buildSnapshot({ companyId: "c0ffee", licenseVersion: 9, items: [], previous, issuedAt: NOW.toISOString() });
    expect(kept).toMatchObject({ display: "hidden", displays: [{ code: "05.02", display: "upsell" }] });
    const changed = buildSnapshot({ companyId: "c0ffee", licenseVersion: 10, items: [], previous, display: { display: "locked", displays: [] }, issuedAt: NOW.toISOString() });
    expect(changed).toMatchObject({ display: "locked", displays: [] });
    // sem retrato anterior: lista vazia (o ERP usa o padrão dele)
    expect(buildSnapshot({ companyId: "c0ffee", licenseVersion: 1, items: [], previous: null, issuedAt: NOW.toISOString() })).toMatchObject({ display: null, displays: [] });
  });
});

describe("planDisplayChanges (fase A: exibição do que está desligado)", () => {
  const current = { display: "hidden" as const, displays: [{ code: "05.02", display: "upsell" as const }] };

  it("padrão da empresa e escolha por unidade; igual ao atual não conta; null volta ao padrão", () => {
    const plan = planDisplayChanges(index, current, {
      companyDefault: "locked",
      units: [
        { code: "05.04", display: "upsell" },
        { code: "05.02", display: null },
        { code: "07.01", display: null }, // já segue o padrão: sem mudança
      ],
    });
    expect(plan.errors).toEqual([]);
    expect(plan.display).toBe("locked");
    expect(plan.displays).toEqual([{ code: "05.04", display: "upsell" }]);
    expect(plan.changes).toEqual([
      { code: null, from: "hidden", to: "locked" },
      { code: "05.02", from: "upsell", to: null },
      { code: "05.04", from: null, to: "upsell" },
    ]);
    // nada pedido: nada muda, e a exibição atual continua
    expect(planDisplayChanges(index, current, null)).toEqual({ display: "hidden", effective: "hidden", displays: [{ code: "05.02", display: "upsell" }], changes: [], errors: [] });
    expect(planDisplayChanges(index, current, { companyDefault: "hidden" }).changes).toEqual([]);
  });

  it("recusa o que não é unidade (função incluída, código inexistente) e unidade repetida", () => {
    const plan = planDisplayChanges(index, current, { units: [{ code: "01.05", display: "upsell" }, { code: "99.99", display: "hidden" }, { code: "05.04", display: "locked" }, { code: "05.04", display: "upsell" }] });
    expect(plan.errors.map((e) => [e.code, e.reason])).toEqual([
      ["01.05", "nao_e_unidade"],
      ["99.99", "nao_e_unidade"],
      ["05.04", "repetida"],
    ]);
    expect(plan.displays).toEqual([
      { code: "05.02", display: "upsell" },
      { code: "05.04", display: "locked" },
    ]);
  });

  it("texto da mudança para a revisão e o histórico", () => {
    expect(describeDisplayChange({ code: "05.02", from: null, to: "upsell" }, "Cotações")).toBe("05.02 Cotações: seguir o padrão da empresa → mostrar com “contratar”");
    expect(describeDisplayChange({ code: null, from: "hidden", to: "locked" }, null)).toBe("Padrão da empresa: esconder → mostrar com cadeado");
    expect(describeDisplayChange({ code: "01.05", from: "locked", to: null, stale: true }, null)).toBe("01.05: mostrar com cadeado → sai da lista (deixou de ser unidade no catálogo)");
  });

  it("revisão: o padrão que o ERP calcula aparece, mas só vai no retrato o padrão escolhido", () => {
    const fromErp = { display: "hidden" as const, fixed: null, displays: [] };
    // nada escolhido: o retrato não fixa o padrão (o ERP continua decidindo); a tela mostra o do ERP
    expect(planDisplayChanges(index, fromErp, { units: [{ code: "05.02", display: "upsell" }] })).toMatchObject({ display: null, effective: "hidden", displays: [{ code: "05.02", display: "upsell" }] });
    // escolher o mesmo que o ERP já mostra não é mudança
    expect(planDisplayChanges(index, fromErp, { companyDefault: "hidden" }).changes).toEqual([]);
    // escolher outro: passa a ir no retrato
    const chosen = planDisplayChanges(index, fromErp, { companyDefault: "locked" });
    expect(chosen).toMatchObject({ display: "locked", effective: "locked", changes: [{ code: null, from: "hidden", to: "locked" }] });
  });

  it("revisão: escolha de código que deixou de ser unidade sai da lista, mas sozinha não é motivo de envio", () => {
    const withStale = { display: "hidden" as const, displays: [{ code: "01.05", display: "locked" as const }, { code: "05.02", display: "upsell" as const }] };
    const plan = planDisplayChanges(index, withStale, null);
    expect(plan.errors).toEqual([]);
    expect(plan.displays).toEqual([{ code: "05.02", display: "upsell" }]);
    expect(plan.changes).toEqual([{ code: "01.05", from: "locked", to: null, stale: true }]);
    expect(hasDisplayWork(plan)).toBe(false);
    // pedir para voltar ao padrão o mesmo código não é erro; outra mudança junto é envio normal
    const more = planDisplayChanges(index, withStale, { units: [{ code: "01.05", display: null }, { code: "05.04", display: "locked" }] });
    expect(more.errors).toEqual([]);
    expect(hasDisplayWork(more)).toBe(true);
    expect(more.displays).toEqual([{ code: "05.02", display: "upsell" }, { code: "05.04", display: "locked" }]);
  });

  it("revisão: confere a exibição do INTEROS com a do ERP (e se o ERP aceita escolha por unidade)", () => {
    const current = { display: "locked" as const, displays: [{ code: "05.02", display: "upsell" as const }] };
    expect(displayDivergences(index, current, null)).toEqual({ supported: null, divergences: [] });
    // ERP sem a fase A: não devolve `displays`
    expect(displayDivergences(index, current, { display: "locked" })).toEqual({ supported: false, divergences: [] });
    expect(displayDivergences(index, current, { display: "locked", displays: [{ code: "05.02", display: "upsell" }] })).toEqual({ supported: true, divergences: [] });
    const diff = displayDivergences(index, current, { display: "hidden", displays: [{ code: "05.02", display: "locked" }, { code: "05.04", display: "upsell" }] });
    expect(diff.supported).toBe(true);
    expect(diff.divergences).toEqual([
      "Padrão da empresa: INTEROS cadeado, ERP esconder",
      expect.stringMatching(/^05\.02 .*: INTEROS contratar, ERP cadeado$/),
      expect.stringMatching(/^05\.04 .*: INTEROS o padrão, ERP contratar$/),
    ]);
    // padrão ainda não fixado pelo INTEROS: o do ERP não é divergência
    expect(displayDivergences(index, { display: null, displays: [] }, { display: "upsell", displays: [] }).divergences).toEqual([]);
  });
});

describe("dependências \"basta um\" (requiredAnyOf do catálogo v2)", () => {
  // O recorte não tem unidade com "basta um": a 05.08 passa a exigir pedido de compra OU recebimento.
  const fixture = () => JSON.parse(readFileSync(new URL("./fixtures/catalogo-v2-recorte.json", import.meta.url), "utf8"));
  const raw = fixture();
  const reposicao = raw.items.find((i: { code: string }) => i.code === "05.08");
  reposicao.dependencies = { ...(reposicao.dependencies ?? {}), requiredAnyOf: [["05.04", "05.06"]] };
  const anyIndex = indexCatalog(normalizeCatalog(raw));

  it("o índice resolve o grupo para unidades e a diferença do catálogo registra a mudança", () => {
    expect(anyIndex.requiredAnyUnitsOf("05.08")).toEqual([["05.04", "05.06"]]);
    expect(anyIndex.anyOfDependentUnitsOf("05.06")).toEqual(["05.08"]);
    expect(anyIndex.requiredAnyUnitsOf("05.02")).toEqual([]);
    expect(catalogDiff(normalizeCatalog(fixture()), normalizeCatalog(raw)).changed).toContainEqual({ code: "05.08", fields: ["requiresAny"] });
  });

  it("catálogo gravado por uma versão anterior (sem o campo) continua abrindo e não acusa mudança à toa", () => {
    const stored = normalizeCatalog(fixture());
    for (const item of stored.items) delete (item as Partial<typeof item>).requiresAny;
    expect(() => indexCatalog(stored)).not.toThrow();
    expect(indexCatalog(stored).requiredAnyUnitsOf("05.08")).toEqual([]);
    expect(catalogDiff(stored, normalizeCatalog(fixture())).changed).toEqual([]);
    expect(catalogDiff(stored, normalizeCatalog(raw)).changed).toEqual([{ code: "05.08", fields: ["requiresAny"] }]);
  });

  it("ligar sem nenhuma das alternativas para o lote, com a explicação (a escolha é de quem pede)", () => {
    const plan = planLicenseChanges(anyIndex, on("01.04"), [{ code: "05.08", state: "active" }], NOW);
    expect(plan.errors).toEqual([expect.objectContaining({ code: "05.08", reason: "falta_alternativa" })]);
    expect(plan.errors[0].message).toBe("Sugestão de reposição exige um destes: 05.04 Pedido de compra ou 05.06 Recebimento de mercadorias. Inclua um deles no pedido.");
  });

  it("com uma alternativa no mesmo lote (ou já ligada), passa", () => {
    const plan = planLicenseChanges(anyIndex, [], [{ code: "05.08", state: "active" }, { code: "05.06", state: "active" }], NOW);
    expect(plan.errors).toEqual([]);
    expect(plan.items.map((i) => i.code)).toEqual(["01.03", "01.04", "05.06", "05.08"]);
    expect(planLicenseChanges(anyIndex, on("01.03", "01.04", "05.04"), [{ code: "05.08", state: "active" }], NOW).errors).toEqual([]);
  });

  it("desligar a única alternativa leva junto, explicitamente; com outra ligada, não", () => {
    const only = planLicenseChanges(anyIndex, on("01.03", "01.04", "05.06", "05.08"), [{ code: "05.06", state: "inactive" }], NOW);
    expect(only.changes.find((c) => c.code === "05.08")).toMatchObject({ to: "inactive", origin: "cascata", relatedTo: "05.06" });
    const both = planLicenseChanges(anyIndex, on("01.03", "01.04", "05.04", "05.06", "05.08"), [{ code: "05.06", state: "inactive" }], NOW);
    expect(both.changes.find((c) => c.code === "05.08")).toBeUndefined();
    expect(both.items.find((i) => i.code === "05.08")?.state).toBe("active");
  });
});
