/**
 * Administração › Empresas ERP (src/domain/erp/companies.ts): situação de cada empresa vinculada calculada só com o
 * que o INTEROS guarda — a mais urgente vale (falha > aprovação > envio > ERP sem resposta > aviso > sem licença > em
 * dia) —, contagem de unidades e módulos ligados, aviso do ERP só nos últimos 7 dias, vínculo encerrado fora e busca
 * por nome, id e CNPJ.
 */
import { describe, expect, it } from "vitest";
import { buildErpCompanyRows, countBySituation, matchesErpCompany, situationOf, type ErpCompanyInputs } from "@/domain/erp/companies";
import type { ErpChangeRequest, ErpLicenseRecord, ErpLink } from "@/domain/erp/types";

const NOW = new Date("2026-11-27T12:00:00.000Z");
const ago = (days: number) => new Date(NOW.getTime() - days * 86400000).toISOString();

function link(id: string, extra: Partial<ErpLink> = {}): ErpLink {
  return {
    id: `homologacao__${id}`,
    organizationId: "org",
    createdAt: ago(30),
    updatedAt: ago(1),
    clientId: id,
    environment: "homologacao",
    erpCompanyId: `emp_${id}`,
    erpCompanyName: `Empresa ${id}`,
    cnpj: "11222333000181",
    erpKind: "varejo",
    status: "ativo",
    method: "identificacao",
    linkedAt: ago(30),
    linkedBy: { id: "u", name: "Ana" },
    provisioningChangeId: null,
    lastSyncAt: ago(1),
    lastSyncError: null,
    ...extra,
  } as ErpLink;
}

function license(linkId: string, codes: string[], extra: Partial<ErpLicenseRecord> = {}): ErpLicenseRecord {
  return {
    id: linkId,
    organizationId: "org",
    createdAt: ago(20),
    updatedAt: ago(2),
    linkId,
    clientId: linkId.split("__")[1],
    environment: "homologacao",
    erpCompanyId: "x",
    issuedVersion: 3,
    appliedVersion: 3,
    appliedAt: ago(2),
    openChangeId: null,
    current: {
      licenseVersion: 3,
      companyId: "x",
      product: "erp-intercert",
      commercialStatus: "active",
      display: "locked",
      displays: [{ code: "05.02", display: "upsell" }],
      items: [...codes.map((code) => ({ code, state: "active" as const })), { code: "24.13", state: "inactive" as const }],
      issuedAt: ago(2),
    },
    ...extra,
  } as ErpLicenseRecord;
}

const change = (clientId: string, status: ErpChangeRequest["status"], requestedAt = ago(1)) =>
  ({ id: `chg_${clientId}_${status}`, clientId, kind: "licenca", status, requestedAt, requestedBy: { id: "u", name: "Ana" }, lastError: status === "falhou" ? { message: "ERP fora do ar" } : null }) as unknown as ErpChangeRequest;

function inputs(extra: Partial<ErpCompanyInputs> = {}): ErpCompanyInputs {
  const links = [link("a"), link("b"), link("c"), link("d"), link("e", { lastSyncError: { code: "network", message: "Sem resposta", at: ago(0), requestId: null } }), link("f", { status: "encerrado" })];
  return {
    links,
    licenses: new Map([
      [`homologacao__a`, license(`homologacao__a`, ["01.03", "01.04", "07.01"])],
      [`homologacao__b`, license(`homologacao__b`, ["01.04"])],
      [`homologacao__c`, license(`homologacao__c`, ["01.04"])],
      [`homologacao__e`, license(`homologacao__e`, ["01.04"])],
    ]),
    openChanges: [change("b", "aguardando_aprovacao"), change("c", "falhou")],
    clients: new Map([
      ["a", { tradeName: "Ótica Árvore", status: "ativo" }],
      ["b", { tradeName: "Bazar", status: "ativo" }],
      ["c", { tradeName: "Casa", status: "em_implantacao" }],
      ["d", { legalName: "Doces Ltda", status: "ativo" }],
      ["e", { tradeName: "Empório", status: "ativo" }],
    ]),
    events: [
      { erpCompanyId: "emp_a", type: "license.applied", receivedAt: ago(2) },
      { erpCompanyId: "emp_a", type: "limit.reached", receivedAt: ago(10) }, // fora dos 7 dias: não é aviso
      { erpCompanyId: "emp_d", type: "license.rejected", receivedAt: ago(3) },
      { erpCompanyId: "emp_d", type: "sync.stale", receivedAt: ago(1) }, // informativo
    ],
    now: NOW,
    ...extra,
  };
}

describe("Empresas ERP: situação e lista", () => {
  it("uma linha por vínculo ativo, com a situação mais urgente primeiro", () => {
    const rows = buildErpCompanyRows(inputs());
    expect(rows.map((r) => [r.clientId, r.situation])).toEqual([
      ["c", "falha"],
      ["b", "aguardando_aprovacao"],
      ["e", "erro_leitura"],
      ["d", "aviso_erp"],
      ["a", "em_dia"],
    ]);
    expect(rows.find((r) => r.clientId === "f")).toBeUndefined();
  });

  it("licença: unidades e módulos ligados, versão, exibição; sem licença registrada quando o INTEROS ainda não emitiu", () => {
    const rows = buildErpCompanyRows(inputs());
    const a = rows.find((r) => r.clientId === "a")!;
    expect(a.clientName).toBe("Ótica Árvore");
    expect(a.license).toMatchObject({ appliedVersion: 3, units: 3, modules: 2, display: "locked", unitDisplays: 1 });
    expect(a.lastEvent).toEqual({ type: "license.applied", receivedAt: ago(2) });
    expect(a.warning).toBeNull();
    const d = rows.find((r) => r.clientId === "d")!;
    expect(d.clientName).toBe("Doces Ltda");
    expect(d.license).toBeNull();
    // o aviso recusado vale (3 dias); o informativo mais novo é o último evento, mas não vira aviso
    expect(d.warning).toEqual({ type: "license.rejected", receivedAt: ago(3) });
    expect(d.lastEvent?.type).toBe("sync.stale");
    // sem aviso, a mesma empresa sem licença fica como "Licença não registrada"
    expect(buildErpCompanyRows(inputs({ events: [] })).find((r) => r.clientId === "d")?.situation).toBe("sem_licenca");
  });

  it("alteração aberta: a mais antiga trava a próxima; o erro dela aparece", () => {
    const rows = buildErpCompanyRows(inputs({ openChanges: [change("a", "enviando", ago(0)), change("a", "falhou", ago(2)), change("b", "aplicada")] }));
    expect(rows.find((r) => r.clientId === "a")?.open).toMatchObject({ status: "falhou", lastError: "ERP fora do ar", requestedBy: "Ana" });
    expect(rows.find((r) => r.clientId === "b")?.open).toBeNull(); // concluída não conta
  });

  it("leitura com erro só conta se for mais nova que a última leitura boa", () => {
    const base = { open: null, warning: null, license: { appliedVersion: 1 } as never };
    expect(situationOf({ ...base, lastSyncAt: ago(0), lastSyncError: { message: "x", at: ago(1) } })).toBe("em_dia");
    expect(situationOf({ ...base, lastSyncAt: ago(1), lastSyncError: { message: "x", at: ago(0) } })).toBe("erro_leitura");
    expect(situationOf({ ...base, lastSyncAt: null, lastSyncError: { message: "x", at: ago(0) } })).toBe("erro_leitura");
  });

  it("busca por nome (sem acento), id da empresa e CNPJ com ou sem pontuação; contagem por situação", () => {
    const rows = buildErpCompanyRows(inputs());
    const a = rows.find((r) => r.clientId === "a")!;
    expect(matchesErpCompany(a, "otica arv")).toBe(true);
    expect(matchesErpCompany(a, "emp_a")).toBe(true);
    expect(matchesErpCompany(a, "11.222.333/0001-81")).toBe(true);
    expect(matchesErpCompany(a, "2233")).toBe(true);
    expect(matchesErpCompany(a, "padaria")).toBe(false);
    expect(matchesErpCompany(a, "  ")).toBe(true);
    expect(countBySituation(rows)).toEqual({ falha: 1, aguardando_aprovacao: 1, enviando: 0, erro_leitura: 1, aviso_erp: 1, sem_licenca: 0, em_dia: 1 });
  });
});
