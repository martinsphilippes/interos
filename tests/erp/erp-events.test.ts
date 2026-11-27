/**
 * Leitura dos eventos ERP → INTEROS (módulo puro): envelope válido e inválido, tipo novo aceito (registrado e ignorado),
 * e os dados de cada tipo no formato que o ERP manda hoje (transição com `{ module, action }`, limite com e sem bloqueio).
 */
import { describe, expect, it } from "vitest";
import { companyStateLabel, eventLicenseVersion, limitOf, moduleRequestOf, monthOf, parseErpEvent, rejectedItemsOf, transitionChangeMap, transitionChangesOf } from "@/domain/erp/events";

const envelope = (over: Record<string, unknown> = {}) => ({ type: "license.applied", companyId: "emp_123", at: "2026-11-27T12:00:00.000Z", data: { licenseVersion: 3 }, eventId: "license.applied:emp_123:2026-11-27T12:00:00.000Z", ...over });

describe("parseErpEvent", () => {
  it("aceita o envelope do ERP e marca o tipo conhecido", () => {
    const r = parseErpEvent(envelope());
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.event).toMatchObject({ type: "license.applied", known: true, erpCompanyId: "emp_123", data: { licenseVersion: 3 } });
  });

  it("tipo novo é aceito como desconhecido (o ERP não precisa repetir)", () => {
    const r = parseErpEvent(envelope({ type: "invoice.created" }));
    expect(r.ok && r.event.known).toBe(false);
  });

  it("recusa o que não é envelope: tipo, empresa, data, identificador e dados", () => {
    expect(parseErpEvent(null).ok).toBe(false);
    expect(parseErpEvent([]).ok).toBe(false);
    expect(parseErpEvent(envelope({ type: "License Applied" })).ok).toBe(false);
    expect(parseErpEvent(envelope({ companyId: "../x" })).ok).toBe(false);
    expect(parseErpEvent(envelope({ companyId: "a".repeat(65) })).ok).toBe(false);
    expect(parseErpEvent(envelope({ at: "ontem" })).ok).toBe(false);
    expect(parseErpEvent(envelope({ eventId: "curto" })).ok).toBe(false);
    expect(parseErpEvent(envelope({ data: [1, 2] })).ok).toBe(false);
  });

  it("sem dados vira objeto vazio", () => {
    const r = parseErpEvent(envelope({ data: undefined }));
    expect(r.ok && r.event.data).toEqual({});
  });
});

describe("dados de cada tipo", () => {
  it("versão da licença só inteira e positiva", () => {
    expect(eventLicenseVersion({ data: { licenseVersion: 4 } })).toBe(4);
    expect(eventLicenseVersion({ data: { licenseVersion: 0 } })).toBeNull();
    expect(eventLicenseVersion({ data: { licenseVersion: "4" } })).toBeNull();
    expect(eventLicenseVersion({ data: { licenseVersion: 2.5 } })).toBeNull();
  });

  it("itens recusados com código e mensagem (ou motivo)", () => {
    expect(rejectedItemsOf({ data: { rejectedItems: [{ code: "07.09", reason: "not_homologated", message: "Ainda depende de homologação" }, { code: "99.01", reason: "unknown_code" }, "lixo"] } })).toEqual([
      { code: "07.09", message: "Ainda depende de homologação" },
      { code: "99.01", message: "unknown_code" },
    ]);
  });

  it("transição no formato do ERP: módulo e ação viram 'ligado'/'desligado'", () => {
    expect(transitionChangesOf({ data: { changes: [{ module: "vendas.pdv", action: "disable", history: "read" }, { module: "caixa.operacao", action: "enable" }, { code: "05.02", from: "trial", to: "active" }] } })).toEqual([
      { code: "vendas.pdv", from: "ligado", to: "desligado" },
      { code: "caixa.operacao", from: "desligado", to: "ligado" },
      { code: "05.02", from: "trial", to: "active" },
    ]);
    expect(transitionChangesOf({ data: { changes: [{ module: "x", action: "pause" }] } })).toEqual([{ code: "x", from: null, to: "pause" }]);
    expect(transitionChangesOf({ data: {} })).toEqual([]);
    expect(transitionChangeMap(transitionChangesOf({ data: { changes: [{ module: "vendas.pdv", action: "disable" }, { module: "x", action: "pause" }] } }))).toEqual({
      "vendas.pdv": { from: "ligado", to: "desligado" },
      x: { from: "—", to: "pause" },
    });
  });

  it("pedido de módulo: id, código, módulo e nome", () => {
    expect(moduleRequestOf({ data: { requestId: "req_1", code: "05.02", module: "compras.cotacoes", name: "Cotações" } })).toEqual({ requestId: "req_1", code: "05.02", module: "compras.cotacoes", name: "Cotações" });
    expect(moduleRequestOf({ data: { requestId: "req_2", code: null, module: "x" } })).toEqual({ requestId: "req_2", code: null, module: "x", name: null });
  });

  it("limite: usuários bloqueia; documentos fiscais só avisa e trazem o mês", () => {
    expect(limitOf({ data: { kind: "users", used: 5, limit: 5 } })).toMatchObject({ kind: "users", label: "usuários", used: 5, limit: 5, blocking: true, month: null });
    expect(limitOf({ data: { kind: "fiscalDocumentsPerMonth", used: 1201, limit: 1200, month: "2026-11", blocking: false } })).toMatchObject({ label: "documentos fiscais no mês", blocking: false, month: "2026-11" });
    expect(limitOf({ data: { kind: "outro" } })).toMatchObject({ kind: "outro", label: "outro", used: null, limit: null });
  });

  it("mês de referência do instante e situação da empresa em português", () => {
    expect(monthOf("2026-11-27T12:00:00.000Z")).toBe("2026-11");
    expect(companyStateLabel("suspended")).toBe("suspensa");
    expect(companyStateLabel("novo_estado")).toBe("novo_estado");
    expect(companyStateLabel(null)).toBeNull();
  });
});
