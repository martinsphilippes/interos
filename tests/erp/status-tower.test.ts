/**
 * Estado por unidade (comercial × operacional × sincronização → rótulo principal), resumo por módulo, blocos da Torre
 * (desativado ≠ sem movimento ≠ dado indisponível), pacotes como ponto de partida, CNPJ e a seleção pendente da tela.
 */
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { indexCatalog, normalizeCatalog } from "@/domain/erp/catalog";
import { moduleSummary, unitStatus, type ErpRuntimeModule, type ErpUnitStatus } from "@/domain/erp/status";
import { towerBlocks, type TowerUnitState } from "@/domain/erp/tower";
import { ERP_PACKAGES, packageCustomizations, packageUnits } from "@/domain/erp/packages";
import { isValidCnpj } from "@/domain/documents";
import { isNoopDraft } from "@/components/erp/erp-draft-store";
import type { ErpLicenseItem } from "@/domain/erp/license";

const index = indexCatalog(normalizeCatalog(JSON.parse(readFileSync(new URL("./fixtures/catalogo-v2-recorte.json", import.meta.url), "utf8"))));
const item = (code: string) => {
  const i = index.byCode.get(code);
  if (!i) throw new Error(`sem ${code} no recorte`);
  return i;
};
const runtime = (module: string, state: string, extra: Partial<ErpRuntimeModule> = {}): ErpRuntimeModule => ({ module, state, ...extra });
const lic = (code: string, state: ErpLicenseItem["state"], extra: Partial<ErpLicenseItem> = {}): ErpLicenseItem => ({ code, state, ...extra });

describe("unitStatus", () => {
  const pdv = item("07.01"); // vendas.pdv
  it("contratado e ligado no ERP com contrato aplicado = ativo e sincronizado", () => {
    const s = unitStatus({ item: pdv, contracted: lic("07.01", "active"), runtime: runtime("vendas.pdv", "enabled"), effective: null, mode: "enforced" });
    expect([s.primary, s.sync.state, s.operational.state, s.commercial.state]).toEqual(["ativo", "sincronizado", "ativo", "active"]);
  });

  it("contratado mas desligado no ERP (contrato aplicado) = divergente", () => {
    const s = unitStatus({ item: pdv, contracted: lic("07.01", "active"), runtime: runtime("vendas.pdv", "disabled"), effective: null, mode: "enforced" });
    expect([s.primary, s.sync.state]).toEqual(["divergente", "divergente"]);
  });

  it("modo legado: o ERP não aplica o contrato, então não aponta divergência", () => {
    const s = unitStatus({ item: pdv, contracted: lic("07.01", "inactive"), runtime: runtime("vendas.pdv", "enabled"), effective: null, mode: "legacy" });
    expect(s.sync.state).toBe("sincronizado");
  });

  it("ligado com configuração pendente = aguardando configuração, com o que falta", () => {
    const s = unitStatus({ item: pdv, contracted: lic("07.01", "active"), runtime: runtime("vendas.pdv", "enabled", { configuration: { ready: false, missing: ["Cadastrar terminal"] } }), effective: null, mode: "enforced" });
    expect(s.primary).toBe("aguardando_configuracao");
    expect(s.configuration).toEqual({ ready: false, missing: ["Cadastrar terminal"] });
  });

  it("alteração aberta e recusa têm prioridade sobre o resto (processando, aprovação, falha)", () => {
    const base = { item: pdv, contracted: lic("07.01", "active"), runtime: runtime("vendas.pdv", "enabled"), effective: null, mode: "enforced" as const };
    expect(unitStatus({ ...base, signals: { openChange: { status: "enviando" } } }).primary).toBe("processando");
    expect(unitStatus({ ...base, signals: { openChange: { status: "aguardando_aprovacao" } } }).primary).toBe("aguardando_aprovacao");
    expect(unitStatus({ ...base, signals: { openChange: { status: "falhou" } } }).primary).toBe("falha");
    const rejected = unitStatus({ ...base, signals: { rejected: "Depende de 01.04" } });
    expect([rejected.primary, rejected.notice]).toEqual(["falha", "Depende de 01.04"]);
  });

  it("teste, agendamento e encerramento têm rótulos próprios", () => {
    const on = runtime("vendas.pdv", "enabled");
    expect(unitStatus({ item: pdv, contracted: lic("07.01", "trial", { until: "2026-12-10T02:59:59Z" }), runtime: on, effective: null, mode: "enforced" }).primary).toBe("em_teste");
    expect(unitStatus({ item: pdv, contracted: lic("07.01", "suspension_scheduled", { effectiveAt: "2026-12-10T03:00:00Z" }), runtime: on, effective: null, mode: "enforced" }).primary).toBe("agendado");
    const draining = unitStatus({ item: pdv, contracted: lic("07.01", "active"), runtime: runtime("vendas.pdv", "draining", { drainUntil: "2026-12-01T00:00:00Z" }), effective: null, mode: "enforced" });
    expect([draining.primary, draining.operational.until]).toEqual(["em_encerramento", "2026-12-01T00:00:00Z"]);
  });

  it("sem contrato: vendável = não contratado; sem leitura do ERP = operacional desconhecido", () => {
    const s = unitStatus({ item: pdv, contracted: null, runtime: null, effective: null, mode: null });
    expect([s.primary, s.operational.state]).toEqual(["nao_contratado", "desconhecido"]);
  });
});

describe("moduleSummary", () => {
  it("conta unidades, contratadas, ativas e disponíveis do módulo; ativação parcial quando só parte está ligada", () => {
    const statuses = new Map<string, ErpUnitStatus>();
    for (const u of index.units) {
      const contracted = u.code === "07.01" || u.code === "07.02" ? lic(u.code, "active") : null;
      statuses.set(u.code, unitStatus({ item: u, contracted, runtime: u.v1Key ? runtime(u.v1Key, contracted ? "enabled" : "absent") : null, effective: null, mode: "enforced" }));
    }
    const s = moduleSummary(index, "07", statuses);
    expect(s.units).toBe(3);
    expect(s.contracted).toBe(2);
    expect(s.active).toBe(2);
    expect(s.available).toBe(1);
    expect(s.partial).toBe(true);
  });
});

describe("towerBlocks", () => {
  const vendas = (units: TowerUnitState[], summary: Record<string, unknown> | null) => towerBlocks(summary, new Map(units.map((u) => [u.code, u]))).find((b) => b.key === "vendas")!;
  const sales = { vendas: { quantidadeVendas: 12, receitaLiquidaCentavos: 123_400, ticketMedioCentavos: 10_283, margemBrutaBps: 3_150 } };
  const noSales = { vendas: { quantidadeVendas: 0, receitaLiquidaCentavos: 0 } };

  it("ligado com venda = ativo; ligado sem venda = sem movimento (não é módulo desativado)", () => {
    const on: TowerUnitState = { code: "07.01", on: true, contracted: true, offSince: null, history: "read" };
    expect(vendas([on], sales).state).toBe("ativo");
    expect(vendas([on], sales).indicators.find((i) => i.label === "Receita líquida")?.value).toBe(123_400);
    expect(vendas([on], noSales).state).toBe("sem_movimento");
  });

  it("ligado mas o ERP não devolveu o bloco = dados indisponíveis", () => {
    const on: TowerUnitState = { code: "07.01", on: true, contracted: true, offSince: null, history: "read" };
    expect(vendas([on], null).state).toBe("indisponivel");
    expect(vendas([on], { meta: {} }).state).toBe("indisponivel");
  });

  it("desligado com consulta histórica: mostra os números como histórico e a data da desativação", () => {
    const off: TowerUnitState = { code: "07.01", on: false, contracted: true, offSince: "2026-11-20T15:00:00Z", history: "read" };
    const b = vendas([off], sales);
    expect(b.state).toBe("desativado");
    expect(b.offSince).toBe("2026-11-20T15:00:00Z");
    expect(b.indicators.length).toBeGreaterThan(0);
    expect(b.note).toContain("20/11/2026");
  });

  it("desligado sem consulta histórica pelo contrato: não mostra números", () => {
    const off: TowerUnitState = { code: "07.01", on: false, contracted: true, offSince: "2026-11-20T15:00:00Z", history: "none" };
    expect(vendas([off], sales).indicators).toEqual([]);
  });

  it("nunca contratado: não contratado, sem números (a Torre devolve dado de módulo não contratado)", () => {
    const never: TowerUnitState = { code: "07.01", on: false, contracted: false, offSince: null, history: null };
    const b = vendas([never], sales);
    expect([b.state, b.indicators.length]).toEqual(["nao_contratado", 0]);
  });
});

describe("pacotes", () => {
  it("pacotes só trazem unidades do catálogo e a personalização mostra o que entrou e saiu", () => {
    const pkg = ERP_PACKAGES.find((p) => p.key === "varejo_essencial")!;
    const units = packageUnits(index, pkg).units;
    expect(units.every((c) => index.byCode.get(c)?.unit)).toBe(true);
    const custom = packageCustomizations(units, [...units.filter((c) => c !== "07.02"), "05.04"]);
    expect(custom.added).toEqual(["05.04"]);
    expect(custom.removed).toEqual(["07.02"]);
  });
});

describe("isValidCnpj", () => {
  it("confere os dígitos verificadores (com ou sem máscara) e recusa repetidos", () => {
    expect(isValidCnpj("11.222.333/0001-81")).toBe(true);
    expect(isValidCnpj("11222333000181")).toBe(true);
    expect(isValidCnpj("11222333000180")).toBe(false);
    expect(isValidCnpj("00000000000000")).toBe(false);
    expect(isValidCnpj("1122233300018")).toBe(false);
  });
});

describe("seleção pendente", () => {
  it("alteração que já é o contratado deixa de contar (aplicada por outra pessoa ou pelo envio)", () => {
    expect(isNoopDraft({ code: "07.01", state: "inactive" }, undefined)).toBe(true);
    expect(isNoopDraft({ code: "07.01", state: "inactive" }, lic("07.01", "inactive"))).toBe(true);
    expect(isNoopDraft({ code: "07.01", state: "inactive" }, lic("07.01", "active"))).toBe(false);
    expect(isNoopDraft({ code: "07.01", state: "active" }, lic("07.01", "active"))).toBe(true);
    expect(isNoopDraft({ code: "07.01", state: "trial", until: "2026-12-10T02:59:59Z" }, lic("07.01", "trial", { until: "2026-12-01T02:59:59Z" }))).toBe(false);
    expect(isNoopDraft({ code: "07.01", state: "active" }, lic("07.01", "trial"))).toBe(false);
  });
});
