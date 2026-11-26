/**
 * Alterações de módulos no banco (npm run test:db), contra um ERP simulado com as regras do real:
 * - primeira licença parte do que a empresa usa hoje (nada é desligado por omissão) e não sai sem leitura do ERP;
 * - dois usuários na mesma empresa: um envia, o outro recebe "versão mudou" (nada duplicado), também ao mesmo tempo;
 * - desligamento com pendência exige aprovação de OUTRA pessoa; alteração aberta bloqueia a próxima; cancelamento;
 * - queda de rede e empresa ocupada: fica aguardando sincronização e a rotina reenvia com a MESMA chave e o MESMO corpo;
 * - resposta perdida (o ERP aplicou): reconciliação pelo histórico do ERP, sem reenviar;
 * - a segunda empresa fica isolada e o histórico guarda quem, quando, motivo, antes/depois e a referência no ERP.
 *
 * Isolamento: clientes, vínculos, licenças, alterações, eventos e avisos com prefixo próprio, apagados no fim.
 */
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { docdb } from "@/server/docdb";
import { create, getById, list } from "@/server/db";
import { COLLECTIONS, type Client, type DomainEvent } from "@/domain/types";
import type { ErpChangeRequest, ErpLicenseRecord } from "@/domain/erp/types";
import { setErpFetch } from "@/server/erp/http";
import { importErpCatalog, resetCatalogCache } from "@/server/erp/catalog-store";
import { linkClientToErp } from "@/server/erp/links";
import { ErpChangeBlocked, approveLicenseChange, cancelLicenseChange, getChange, listClientChanges, processPendingErpChanges, reconcileChange, reviewLicenseChange, submitLicenseChange } from "@/server/erp/changes";
import { createFakeErp, type FakeErp } from "./fake-erp";

const RUN = `erp${Date.now().toString(36)}`;
const CLIENT_A = `${RUN}_a`;
const CLIENT_B = `${RUN}_b`;
const CLIENTS = [CLIENT_A, CLIENT_B];
const COMPANY_A = `${RUN}companyA`;
const COMPANY_B = `${RUN}companyB`;
const ANA = { id: `${RUN}_ana`, name: "Ana Comercial" };
const BRUNO = { id: `${RUN}_bruno`, name: "Bruno Diretor" };
const ENV_KEYS = ["ERP_INTERCERT_URL", "ERP_INTERCERT_AMBIENTE", "ERP_INTERCERT_TOKEN_LICENCAS", "ERP_INTERCERT_SEGREDO_ASSINATURA"] as const;
const savedEnv: Record<string, string | undefined> = {};
let erp: FakeErp;

const licenseOf = (clientId: string) => getById<ErpLicenseRecord>(COLLECTIONS.erpLicenses, `homologacao__${clientId}`);
const putsOf = (eventId: string) => erp.calls.filter((c) => c.method === "PUT" && c.eventId === eventId);
async function blocked(promise: Promise<unknown>): Promise<string> {
  try {
    await promise;
  } catch (error) {
    if (error instanceof ErpChangeBlocked) return error.code;
    throw error;
  }
  throw new Error("esperava ErpChangeBlocked");
}

beforeAll(async () => {
  for (const k of ENV_KEYS) savedEnv[k] = process.env[k];
  process.env.ERP_INTERCERT_URL = "http://localhost:9";
  process.env.ERP_INTERCERT_AMBIENTE = "homologacao";
  process.env.ERP_INTERCERT_TOKEN_LICENCAS = "token-de-teste";
  process.env.ERP_INTERCERT_SEGREDO_ASSINATURA = "segredo-de-teste-com-mais-de-32-caracteres!";
  erp = createFakeErp();
  setErpFetch(erp.fetch);
  resetCatalogCache();
  await importErpCatalog(null);
  // A: PDV, caixa, produtos, fornecedores e pedidos de compra ligados hoje. B: só produtos.
  erp.addCompany(COMPANY_A, "Loja A", ["01.03", "01.04", "05.04", "07.01", "07.02"]);
  erp.addCompany(COMPANY_B, "Loja B", ["01.04"]);
  for (const [id, name] of [
    [CLIENT_A, "Loja A Teste"],
    [CLIENT_B, "Loja B Teste"],
  ]) {
    await create<Client>(COLLECTIONS.clients, { legalName: name, tradeName: name, status: "ativo", address: {}, mrr: 0, tags: [] } as unknown as Parameters<typeof create<Client>>[1], id);
  }
  await linkClientToErp({ clientId: CLIENT_A, environment: "homologacao", erpCompanyId: COMPANY_A, erpCompanyName: "Loja A", cnpj: null, erpKind: "varejo", method: "identificacao", actor: ANA });
  await linkClientToErp({ clientId: CLIENT_B, environment: "homologacao", erpCompanyId: COMPANY_B, erpCompanyName: "Loja B", cnpj: null, erpKind: "varejo", method: "identificacao", actor: ANA });
});

afterAll(async () => {
  setErpFetch(null);
  resetCatalogCache();
  for (const k of ENV_KEYS) {
    if (savedEnv[k] === undefined) delete process.env[k];
    else process.env[k] = savedEnv[k];
  }
  const sql = docdb.sql();
  const changes = (await sql`select id from interos.erp_change_requests where data->>'clientId' = any(${CLIENTS})`) as unknown as { id: string }[];
  const ids = changes.map((c) => c.id);
  if (ids.length) await sql`delete from interos.notifications where data->>'entityId' = any(${ids})`;
  await sql`delete from interos.erp_change_requests where data->>'clientId' = any(${CLIENTS})`;
  await sql`delete from interos.erp_licenses where data->>'clientId' = any(${CLIENTS})`;
  await sql`delete from interos.erp_links where data->>'clientId' = any(${CLIENTS})`;
  await sql`delete from interos.erp_links where id like ${`__empresa__homologacao__${RUN}%`}`;
  await sql`delete from interos.events where data->>'clientId' = any(${CLIENTS})`;
  await sql`delete from interos.clients where id = any(${CLIENTS})`;
});

describe("primeira licença", () => {
  it("sem leitura do ERP não monta retrato (desligaria o que a empresa usa)", async () => {
    // Fora do ar de verdade: as leituras falham também nas repetições automáticas.
    erp.downReads(100);
    try {
      expect(await blocked(submitLicenseChange({ clientId: CLIENT_B, draft: [{ code: "05.04", state: "active" }], baseVersion: 0, reason: "Teste ERP fora do ar", actor: ANA, canApprove: false }))).toBe("erp_indisponivel");
    } finally {
      erp.downReads(0);
    }
    expect(erp.calls.some((c) => c.method === "PUT")).toBe(false);
    expect(await licenseOf(CLIENT_B)).toBeNull();
  });

  it("parte do que a empresa usa hoje: liga cotações (com a dependência já ligada) sem desligar nada", async () => {
    const review = await reviewLicenseChange({ clientId: CLIENT_A, draft: [{ code: "05.02", state: "active" }] });
    expect(review.initial).toBe(true);
    expect(review.baseVersion).toBe(0);
    expect(review.plan.changes.map((c) => c.code)).toEqual(["05.02"]);
    const change = await submitLicenseChange({ clientId: CLIENT_A, draft: [{ code: "05.02", state: "active" }], baseVersion: 0, reason: "Aditivo 2026-118: cotações", contractReference: "2026-118", actor: ANA, canApprove: false });
    expect(change.status).toBe("aplicada");
    expect(change.licenseVersion).toBe(1);
    expect(change.snapshot?.items.map((i) => i.code).sort()).toEqual(["01.03", "01.04", "05.02", "05.04", "07.01", "07.02"]);
    const record = await licenseOf(CLIENT_A);
    expect([record?.issuedVersion, record?.appliedVersion, record?.openChangeId]).toEqual([1, 1, null]);
    expect(erp.companies.get(COMPANY_A)?.modules.get("vendas.pdv")).toBe("enabled");
    const events = (await list<DomainEvent>(COLLECTIONS.events, { where: [["clientId", "==", CLIENT_A]] })).filter((e) => e.type === "erp.license_changed");
    expect(events).toHaveLength(1);
  });
});

describe("edição concorrente", () => {
  it("dois usuários com a mesma versão: o primeiro envia, o segundo recebe 'versão mudou' e nada é duplicado", async () => {
    const reviewAna = await reviewLicenseChange({ clientId: CLIENT_A, draft: [{ code: "05.06", state: "active" }] });
    const reviewBruno = await reviewLicenseChange({ clientId: CLIENT_A, draft: [{ code: "05.08", state: "active" }] });
    expect(reviewAna.baseVersion).toBe(reviewBruno.baseVersion);
    const putsBefore = erp.calls.filter((c) => c.method === "PUT").length;
    const first = await submitLicenseChange({ clientId: CLIENT_A, draft: [{ code: "05.06", state: "active" }], baseVersion: reviewAna.baseVersion, reason: "Pedido da Ana", actor: ANA, canApprove: false });
    expect(first.status).toBe("aplicada");
    expect(await blocked(submitLicenseChange({ clientId: CLIENT_A, draft: [{ code: "05.08", state: "active" }], baseVersion: reviewBruno.baseVersion, reason: "Pedido do Bruno", actor: BRUNO, canApprove: true }))).toBe("versao_mudou");
    expect(erp.calls.filter((c) => c.method === "PUT").length).toBe(putsBefore + 1);
  });

  it("ao mesmo tempo: só um passa; o outro é recusado sem gravar alteração", async () => {
    const base = (await licenseOf(CLIENT_A))!.issuedVersion;
    const before = (await listClientChanges(CLIENT_A)).length;
    const results = await Promise.allSettled([
      submitLicenseChange({ clientId: CLIENT_A, draft: [{ code: "05.08", state: "active" }], baseVersion: base, reason: "Simultâneo 1", actor: ANA, canApprove: false }),
      submitLicenseChange({ clientId: CLIENT_A, draft: [{ code: "05.19", state: "active" }], baseVersion: base, reason: "Simultâneo 2", actor: BRUNO, canApprove: false }),
    ]);
    expect(results.filter((r) => r.status === "fulfilled")).toHaveLength(1);
    const rejected = results.find((r) => r.status === "rejected") as PromiseRejectedResult;
    expect(rejected.reason).toBeInstanceOf(ErpChangeBlocked);
    expect(["versao_mudou", "alteracao_aberta"]).toContain((rejected.reason as ErpChangeBlocked).code);
    expect((await listClientChanges(CLIENT_A)).length).toBe(before + 1);
  });
});

describe("desligamento com pendência", () => {
  let pendingId = "";
  it("caixa aberto: o desligamento do caixa (e do PDV em cascata) aguarda aprovação e nada vai ao ERP", async () => {
    erp.companies.get(COMPANY_A)!.blockers.set("caixa.operacao", [{ key: "open_cash_sessions", label: "Caixas abertos", count: 1 }]);
    const base = (await licenseOf(CLIENT_A))!.issuedVersion;
    const change = await submitLicenseChange({ clientId: CLIENT_A, draft: [{ code: "07.02", state: "inactive" }], baseVersion: base, reason: "Cliente pediu para tirar o caixa", actor: ANA, canApprove: false });
    pendingId = change.id;
    expect(change.status).toBe("aguardando_aprovacao");
    expect(change.licenseVersion).toBeNull();
    expect(change.plan.map((p) => [p.code, p.origin])).toEqual(
      expect.arrayContaining([
        ["07.02", "pedido"],
        ["07.01", "cascata"],
      ]),
    );
    expect(change.approvalReasons.join(" ")).toContain("Caixas abertos");
    expect(putsOf(change.id)).toHaveLength(0);
  });

  it("com alteração aberta, outra não é enviada", async () => {
    const base = (await licenseOf(CLIENT_A))!.issuedVersion;
    expect(await blocked(submitLicenseChange({ clientId: CLIENT_A, draft: [{ code: "05.20", state: "active" }], baseVersion: base, reason: "Outra coisa", actor: BRUNO, canApprove: true }))).toBe("alteracao_aberta");
  });

  it("quem pediu não aprova; outra pessoa aprova e o ERP põe o caixa em encerramento (só conclui pendências)", async () => {
    expect(await blocked(approveLicenseChange(pendingId, ANA))).toBe("estado_invalido");
    const approved = await approveLicenseChange(pendingId, BRUNO);
    expect(approved.status).toBe("aplicada");
    expect(approved.approval?.by.id).toBe(BRUNO.id);
    expect(erp.companies.get(COMPANY_A)?.modules.get("caixa.operacao")).toBe("draining");
    expect(putsOf(pendingId)).toHaveLength(1);
    expect((await licenseOf(CLIENT_A))?.openChangeId).toBeNull();
  });

  it("cancelar uma alteração aguardando aprovação: nada vai ao ERP e a empresa fica livre", async () => {
    const base = (await licenseOf(CLIENT_A))!.issuedVersion;
    erp.companies.get(COMPANY_A)!.blockers.set("compras.pedidos", [{ key: "open_orders", label: "Pedidos de compra abertos", count: 2 }]);
    const change = await submitLicenseChange({ clientId: CLIENT_A, draft: [{ code: "05.04", state: "inactive" }], baseVersion: base, reason: "Tirar compras", actor: ANA, canApprove: false });
    expect(change.status).toBe("aguardando_aprovacao");
    const cancelled = await cancelLicenseChange(change.id, BRUNO, "Cliente desistiu");
    expect(cancelled.status).toBe("cancelada");
    expect(cancelled.cancelled?.reason).toBe("Cliente desistiu");
    expect(putsOf(change.id)).toHaveLength(0);
    expect((await licenseOf(CLIENT_A))?.openChangeId).toBeNull();
    erp.companies.get(COMPANY_A)!.blockers.delete("compras.pedidos");
  });
});

describe("falha e retomada sem duplicar", () => {
  it("queda de rede: aguarda sincronização; a rotina reenvia com a mesma chave e o mesmo corpo", async () => {
    const base = (await licenseOf(CLIENT_A))!.issuedVersion;
    erp.failNextPut("network");
    const change = await submitLicenseChange({ clientId: CLIENT_A, draft: [{ code: "05.20", state: "active" }], baseVersion: base, reason: "Teste de queda", actor: ANA, canApprove: false });
    expect(change.status).toBe("falhou");
    expect(change.lastError?.retryable).toBe(true);
    expect(change.nextAttemptAt).not.toBeNull();
    const res = await processPendingErpChanges(new Date(Date.parse(change.nextAttemptAt!) + 1000));
    expect(res.applied).toBeGreaterThanOrEqual(1);
    expect((await getChange(change.id))?.status).toBe("aplicada");
    const puts = putsOf(change.id);
    expect(puts.length).toBeGreaterThanOrEqual(1);
    expect(new Set(puts.map((p) => JSON.stringify(p.body))).size).toBe(1);
  });

  it("empresa ocupada no ERP (license_busy) é temporário: nova tentativa aplica", async () => {
    const base = (await licenseOf(CLIENT_A))!.issuedVersion;
    erp.failNextPut("busy");
    const change = await submitLicenseChange({ clientId: CLIENT_A, draft: [{ code: "05.05", state: "active" }], baseVersion: base, reason: "Teste ocupado", actor: ANA, canApprove: false });
    expect([change.status, change.lastError?.code, change.lastError?.retryable]).toEqual(["falhou", "license_busy", true]);
    await processPendingErpChanges(new Date(Date.parse(change.nextAttemptAt!) + 1000));
    expect((await getChange(change.id))?.status).toBe("aplicada");
  });

  it("resposta perdida: o ERP aplicou; a reconciliação pelo histórico conclui sem reenviar", async () => {
    const base = (await licenseOf(CLIENT_A))!.issuedVersion;
    erp.failNextPut("lost_response");
    const change = await submitLicenseChange({ clientId: CLIENT_A, draft: [{ code: "05.19", state: "active" }], baseVersion: base, reason: "Teste resposta perdida", actor: ANA, canApprove: false });
    expect(change.status).toBe("falhou");
    expect(erp.companies.get(COMPANY_A)?.appliedVersion).toBe(change.licenseVersion);
    const putsBefore = putsOf(change.id).length;
    expect(await reconcileChange((await getChange(change.id))!)).toBe(true);
    const done = await getChange(change.id);
    expect(done?.status).toBe("aplicada");
    expect(putsOf(change.id).length).toBe(putsBefore);
    expect((await licenseOf(CLIENT_A))?.appliedVersion).toBe(change.licenseVersion);
  });
});

describe("isolamento e histórico", () => {
  it("a outra empresa não muda e não tem histórico desta", async () => {
    expect([...erp.companies.get(COMPANY_B)!.modules.entries()]).toEqual([["cadastros.produtos", "enabled"]]);
    expect(erp.calls.filter((c) => c.method === "PUT" && c.path.includes(COMPANY_B))).toHaveLength(0);
    expect(await licenseOf(CLIENT_B)).toBeNull();
    expect(await listClientChanges(CLIENT_B)).toEqual([]);
  });

  it("o histórico guarda quem, quando, motivo, antes e depois, aprovação e a referência no ERP", async () => {
    const history = await listClientChanges(CLIENT_A);
    const applied = history.filter((c) => c.status === "aplicada");
    expect(applied.length).toBeGreaterThanOrEqual(5);
    for (const c of applied) {
      expect(c.requestedBy.id).toBeTruthy();
      expect(c.reason.length).toBeGreaterThanOrEqual(3);
      expect(c.before.length + c.after.length).toBeGreaterThan(0);
      expect(c.result?.at).toBeTruthy();
    }
    const approvedOne = applied.find((c) => c.approval && !c.approval.self) as ErpChangeRequest;
    expect(approvedOne.approval?.by.name).toBe(BRUNO.name);
    expect(history.some((c) => c.status === "cancelada" && c.cancelled?.by.id === BRUNO.id)).toBe(true);
    const versions = applied.map((c) => c.licenseVersion as number).sort((a, b) => a - b);
    expect(new Set(versions).size).toBe(versions.length);
  });
});
