/**
 * Licença por empresa (contrato v2), sobre o recorte real do catálogo: o lote inclui as dependências de quem liga,
 * desliga em cascata quem ficaria sem dependência (também no desligamento agendado), recusa o que não é unidade, o que
 * ainda não é vendável e datas no passado, e monta o retrato completo com unidades explícitas.
 */
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { indexCatalog, normalizeCatalog } from "@/domain/erp/catalog";
import { buildSnapshot, deactivations, isOnState, planLicenseChanges, type ErpLicenseItem } from "@/domain/erp/license";

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
});
