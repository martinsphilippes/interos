/**
 * Administração › Empresas ERP (src/domain/erp/companies.ts): situação de cada empresa vinculada calculada só com o
 * que o INTEROS guarda — a mais urgente vale (falha > não aplicada > aprovação > envio > leitura que falhou > aviso >
 * sem licença > em dia) —, unidades e módulos ligados, aviso do ERP (gravado no vínculo) só nos últimos 7 dias,
 * alteração recusada ou em conflito depois da licença confirmada, aprovação pendente contada mesmo atrás de outra
 * alteração mais urgente, vínculo encerrado fora e busca por nome, id e CNPJ.
 */
import { describe, expect, it } from "vitest";
import { buildErpCompanyRows, countBySituation, matchesErpCompany, needsAttention, situationOf, type ErpCompanyInputs } from "@/domain/erp/companies";
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

const change = (clientId: string, status: ErpChangeRequest["status"], at = ago(1), extra: Partial<ErpChangeRequest> = {}) =>
  ({
    id: `chg_${clientId}_${status}_${at}`,
    clientId,
    kind: "licenca",
    status,
    requestedAt: at,
    updatedAt: at,
    requestedBy: { id: "u", name: "Ana" },
    lastError: status === "falhou" ? { message: "ERP fora do ar" } : null,
    nextAttemptAt: null,
    result: null,
    ...extra,
  }) as unknown as ErpChangeRequest;

function inputs(extra: Partial<ErpCompanyInputs> = {}): ErpCompanyInputs {
  const links = [
    link("a", { lastEvent: { type: "license.applied", at: ago(2), receivedAt: ago(2) }, lastWarning: { type: "limit.reached", at: ago(10) } }), // aviso fora dos 7 dias
    link("b"),
    link("c"),
    link("d", { lastEvent: { type: "license.rejected", at: ago(3), receivedAt: ago(3) }, lastWarning: { type: "license.rejected", at: ago(3) } }),
    link("e", { lastSyncError: { code: "network", message: "Sem resposta", at: ago(0), requestId: null } }),
    link("f", { status: "encerrado" }),
    link("g"),
  ];
  return {
    links,
    licenses: new Map([
      [`homologacao__a`, license(`homologacao__a`, ["01.03", "01.04", "07.01"])],
      [`homologacao__b`, license(`homologacao__b`, ["01.04"])],
      [`homologacao__c`, license(`homologacao__c`, ["01.04"])],
      [`homologacao__e`, license(`homologacao__e`, ["01.04"])],
      [`homologacao__g`, license(`homologacao__g`, ["01.04"])],
    ]),
    openChanges: [change("b", "aguardando_aprovacao"), change("c", "falhou", ago(1), { nextAttemptAt: ago(-0.01) } as Partial<ErpChangeRequest>)],
    // g: recusada depois da licença confirmada; a: recusada ANTES da licença confirmada (resolvida)
    notAppliedChanges: [change("g", "recusada", ago(1), { result: { status: "rejected", rejectedItems: [{ code: "05.02", reason: "dependency_missing", message: "Falta 05.04" }] } } as Partial<ErpChangeRequest>), change("a", "conflito", ago(5))],
    clients: new Map([
      ["a", { tradeName: "Ótica Árvore", status: "ativo" }],
      ["b", { tradeName: "Bazar", status: "ativo" }],
      ["c", { tradeName: "Casa", status: "em_implantacao" }],
      ["d", { legalName: "Doces Ltda", status: "ativo" }],
      ["e", { tradeName: "Empório", status: "ativo" }],
      ["g", { tradeName: "Galpão", status: "ativo" }],
    ]),
    now: NOW,
    ...extra,
  };
}

describe("Empresas ERP: situação e lista", () => {
  it("uma linha por vínculo ativo, com a situação mais urgente primeiro", () => {
    const rows = buildErpCompanyRows(inputs());
    expect(rows.map((r) => [r.clientId, r.situation])).toEqual([
      ["c", "falha"],
      ["g", "nao_aplicada"],
      ["b", "aguardando_aprovacao"],
      ["e", "erro_leitura"],
      ["d", "aviso_erp"],
      ["a", "em_dia"],
    ]);
    expect(rows.find((r) => r.clientId === "f")).toBeUndefined();
    expect(rows.filter(needsAttention).map((r) => r.clientId)).toEqual(["c", "g", "b", "e", "d"]);
  });

  it("licença: unidades e módulos ligados, versão, exibição; eventos e avisos vêm do vínculo", () => {
    const rows = buildErpCompanyRows(inputs());
    const a = rows.find((r) => r.clientId === "a")!;
    expect(a.clientName).toBe("Ótica Árvore");
    expect(a.license).toMatchObject({ appliedVersion: 3, units: 3, modules: 2, display: "locked", unitDisplays: 1 });
    expect(a.lastEvent).toEqual({ type: "license.applied", at: ago(2) });
    expect(a.warning).toBeNull(); // limite de 10 dias atrás: fora da janela
    expect(a.notApplied).toBeNull(); // conflito anterior à licença confirmada: resolvido
    const d = rows.find((r) => r.clientId === "d")!;
    expect(d.clientName).toBe("Doces Ltda");
    expect(d.license).toBeNull();
    expect(d.warning).toEqual({ type: "license.rejected", at: ago(3) });
    // sem o aviso, a mesma empresa sem licença fica como "Licença não registrada"
    const noWarning = inputs({ links: inputs().links.map((l) => (l.clientId === "d" ? { ...l, lastWarning: null } : l)) });
    expect(buildErpCompanyRows(noWarning).find((r) => r.clientId === "d")?.situation).toBe("sem_licenca");
  });

  it("alteração não aplicada (recusada ou conflito) mostra o motivo; uma alteração aberta depois decide", () => {
    const g = buildErpCompanyRows(inputs()).find((r) => r.clientId === "g")!;
    expect(g.notApplied).toMatchObject({ status: "recusada", message: "Falta 05.04" });
    const reopened = buildErpCompanyRows(inputs({ openChanges: [change("g", "aguardando_aprovacao", ago(0))] })).find((r) => r.clientId === "g")!;
    expect(reopened.situation).toBe("aguardando_aprovacao");
  });

  it("alteração aberta: a mais urgente decide; aprovação pendente conta mesmo atrás de outra", () => {
    const opens = [{ ...change("a", "falhou", ago(3)), kind: "provisionamento" } as ErpChangeRequest, change("a", "aguardando_aprovacao", ago(0)), change("b", "aplicada")];
    const rows = buildErpCompanyRows(inputs({ openChanges: opens }));
    const a = rows.find((r) => r.clientId === "a")!;
    expect(a.open).toMatchObject({ status: "falhou", kind: "provisionamento", lastError: "ERP fora do ar", requestedBy: "Ana" });
    expect(a.awaitingApproval).toBe(true);
    expect(rows.find((r) => r.clientId === "b")?.open).toBeNull(); // concluída não conta
    // a próxima tentativa automática aparece (c, nos dados de base)
    expect(buildErpCompanyRows(inputs()).find((r) => r.clientId === "c")?.open?.nextAttemptAt).toBe(ago(-0.01));
  });

  it("leitura com erro só conta se for mais nova que a última leitura boa", () => {
    const base = { open: null, notApplied: null, warning: null, license: { appliedVersion: 1 } as never };
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
    expect(matchesErpCompany(a, "Posto 2233")).toBe(false); // termo misto não vira busca por documento
    expect(matchesErpCompany(a, "  ")).toBe(true);
    expect(matchesErpCompany({ clientName: "Sem vínculo", cnpj: "99888777000166" }, "99.888")).toBe(true);
    expect(countBySituation(rows)).toEqual({ falha: 1, nao_aplicada: 1, aguardando_aprovacao: 1, enviando: 0, erro_leitura: 1, aviso_erp: 1, sem_licenca: 0, em_dia: 1 });
  });
});
