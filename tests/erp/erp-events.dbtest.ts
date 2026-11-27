/**
 * Eventos ERP → INTEROS no banco (npm run test:db), pela mesma função do webhook (`receiveErpEvent`), com o corpo
 * assinado como o ERP assina (`X-ERP-Signature: t=<unix>,v1=<hex>`):
 * - sem segredo 503; assinatura ausente, errada ou vencida 401; corpo grande 413; corpo inválido 400;
 * - tipo novo e empresa sem vínculo: 200 e registrados como ignorados (o ERP não repete à toa);
 * - pedido de módulo: histórico do cliente + tarefa para o comercial (avisado pela notificação de tarefa); a mesma
 *   entrega repetida ou simultânea não duplica nada;
 * - limite do contrato: um registro e uma tarefa por mês e tipo, mesmo com o aviso diário do ERP; sem comercial, a tarefa
 *   fica sem responsável em vendas;
 * - mudança automática de módulos no formato do ERP (`{ module, action }`);
 * - resposta perdida + "licença aplicada": a alteração conclui pelo histórico do ERP sem reenviar; aviso de alteração já
 *   concluída não muda nada;
 * - processamento interrompido: dentro de 2 minutos responde 503; depois disso é retomado sem repetir o histórico;
 * - "ERP sem licença nova": um registro por empresa, fora da lista de recentes.
 *
 * Isolamento: clientes, empresas, usuário e registros com prefixo próprio, apagados no fim.
 */
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { docdb } from "@/server/docdb";
import { create, getById, list, update } from "@/server/db";
import { COLLECTIONS, type Client, type DomainEvent, type Notification, type Task, type TimelineEvent, type User } from "@/domain/types";
import { setErpFetch } from "@/server/erp/http";
import { signBody } from "@/server/erp/signature";
import { importErpCatalog, resetCatalogCache } from "@/server/erp/catalog-store";
import { linkClientToErp } from "@/server/erp/links";
import { getChange, reviewLicenseChange, submitLicenseChange } from "@/server/erp/changes";
import { ERP_EVENTS_MAX_BYTES, erpEventDocId, erpStaleDocId, erpTaskId, getErpEventsOverview, receiveErpEvent, type ErpInboundRecord } from "@/server/erp/inbound";
import { createFakeErp, type FakeErp } from "./fake-erp";

const RUN = `erpev${Date.now().toString(36)}`;
const CLIENT_A = `${RUN}_a`;
const CLIENT_B = `${RUN}_b`;
const CLIENTS = [CLIENT_A, CLIENT_B];
const COMPANY_A = `${RUN}companyA`;
const COMPANY_B = `${RUN}companyB`;
const UNLINKED = `${RUN}semvinculo`;
const SELLER = { id: `${RUN}_vera`, name: "Vera Vendas" };
const ANA = { id: `${RUN}_ana`, name: "Ana Comercial" };
const SECRET = "segredo-dos-eventos-de-teste-com-mais-de-32-caracteres";
const ENV_KEYS = ["ERP_INTERCERT_URL", "ERP_INTERCERT_AMBIENTE", "ERP_INTERCERT_TOKEN_LICENCAS", "ERP_INTERCERT_SEGREDO_ASSINATURA", "ERP_INTERCERT_SEGREDO_EVENTOS"] as const;
const savedEnv: Record<string, string | undefined> = {};
let erp: FakeErp;
let clock = Date.parse("2026-11-27T12:00:00.000Z");

/** Monta o corpo como o ERP: `{ type, companyId, at, data, eventId }`, eventId = `<type>:<companyId>:<at>`. */
function body(type: string, companyId: string, data: Record<string, unknown>, at = new Date((clock += 1000)).toISOString()): string {
  return JSON.stringify({ type, companyId, at, data, eventId: `${type}:${companyId}:${at}` });
}

async function deliver(raw: string, options: { secret?: string; signedAt?: number; now?: number; signature?: string | null } = {}) {
  const now = options.now ?? Date.now();
  const signature = options.signature !== undefined ? options.signature : signBody(options.secret ?? SECRET, raw, options.signedAt ?? now);
  return receiveErpEvent({ rawBody: raw, signature, now: new Date(now) });
}

const recordOf = (raw: string) => getById<ErpInboundRecord>(COLLECTIONS.erpEvents, erpEventDocId("homologacao", (JSON.parse(raw) as { eventId: string }).eventId));
const clientEvents = async (clientId: string, type: string) => (await list<DomainEvent>(COLLECTIONS.events, { where: [["clientId", "==", clientId]] })).filter((e) => e.type === type);
const tasksOf = (clientId: string) => list<Task>(COLLECTIONS.tasks, { where: [["clientId", "==", clientId]] });

beforeAll(async () => {
  for (const k of ENV_KEYS) savedEnv[k] = process.env[k];
  process.env.ERP_INTERCERT_URL = "http://localhost:9";
  process.env.ERP_INTERCERT_AMBIENTE = "homologacao";
  process.env.ERP_INTERCERT_TOKEN_LICENCAS = "token-de-teste";
  process.env.ERP_INTERCERT_SEGREDO_ASSINATURA = "segredo-de-teste-com-mais-de-32-caracteres!";
  process.env.ERP_INTERCERT_SEGREDO_EVENTOS = SECRET;
  erp = createFakeErp();
  setErpFetch(erp.fetch);
  resetCatalogCache();
  await importErpCatalog(null);
  erp.addCompany(COMPANY_A, "Loja A", ["01.03", "01.04", "05.04", "07.01", "07.02"]);
  erp.addCompany(COMPANY_B, "Loja B", ["01.04"]);
  await create<User>(COLLECTIONS.users, { name: SELLER.name, email: `${RUN}@teste.local`, role: "vendas", departmentId: "vendas", active: true } as unknown as Parameters<typeof create<User>>[1], SELLER.id);
  await create<Client>(COLLECTIONS.clients, { legalName: "Loja A Eventos", tradeName: "Loja A Eventos", status: "ativo", address: {}, mrr: 0, tags: [], ownerSalesId: SELLER.id } as unknown as Parameters<typeof create<Client>>[1], CLIENT_A);
  await create<Client>(COLLECTIONS.clients, { legalName: "Loja B Eventos", tradeName: "Loja B Eventos", status: "ativo", address: {}, mrr: 0, tags: [] } as unknown as Parameters<typeof create<Client>>[1], CLIENT_B);
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
  const tasks = (await sql`select id from interos.tasks where data->>'clientId' = any(${CLIENTS})`) as unknown as { id: string }[];
  const taskIds = tasks.map((t) => t.id);
  const changes = (await sql`select id from interos.erp_change_requests where data->>'clientId' = any(${CLIENTS})`) as unknown as { id: string }[];
  const entityIds = [...taskIds, ...changes.map((c) => c.id)];
  if (entityIds.length) {
    await sql`delete from interos.notifications where data->>'entityId' = any(${entityIds})`;
    await sql`delete from interos.sla_instances where data->>'entityId' = any(${taskIds})`;
  }
  await sql`delete from interos.notifications where data->>'userId' = ${SELLER.id}`;
  await sql`delete from interos.tasks where data->>'clientId' = any(${CLIENTS})`;
  await sql`delete from interos.erp_events where data->>'erpCompanyId' like ${`${RUN}%`}`;
  await sql`delete from interos.erp_change_requests where data->>'clientId' = any(${CLIENTS})`;
  await sql`delete from interos.erp_licenses where data->>'clientId' = any(${CLIENTS})`;
  await sql`delete from interos.erp_links where data->>'clientId' = any(${CLIENTS})`;
  await sql`delete from interos.erp_links where id like ${`__empresa__homologacao__${RUN}%`}`;
  await sql`delete from interos.timeline_events where data->>'clientId' = any(${CLIENTS})`;
  await sql`delete from interos.events where data->>'clientId' = any(${CLIENTS})`;
  await sql`delete from interos.clients where id = any(${CLIENTS})`;
  await sql`delete from interos.users where id = ${SELLER.id}`;
});

describe("recebimento", () => {
  it("sem o segredo configurado responde 503 e nada é gravado", async () => {
    delete process.env.ERP_INTERCERT_SEGREDO_EVENTOS;
    try {
      const raw = body("upsell.requested", COMPANY_A, { requestId: "req_sem_segredo" });
      expect((await deliver(raw)).status).toBe(503);
      expect(await recordOf(raw)).toBeNull();
    } finally {
      process.env.ERP_INTERCERT_SEGREDO_EVENTOS = SECRET;
    }
  });

  it("assinatura ausente, de outro segredo ou vencida: 401 com o motivo; nada é gravado", async () => {
    const raw = body("upsell.requested", COMPANY_A, { requestId: "req_assinatura" });
    expect(await deliver(raw, { signature: null })).toMatchObject({ status: 401, body: { reason: "missing" } });
    expect(await deliver(raw, { signature: "t=abc,v1=xyz" })).toMatchObject({ status: 401, body: { reason: "malformed" } });
    expect(await deliver(raw, { secret: "outro-segredo-qualquer-com-mais-de-32-caracteres" })).toMatchObject({ status: 401, body: { reason: "mismatch" } });
    expect(await deliver(raw, { signedAt: Date.now() - 6 * 60_000 })).toMatchObject({ status: 401, body: { reason: "expired" } });
    // Corpo alterado depois de assinado.
    const signature = signBody(SECRET, raw, Date.now());
    expect((await receiveErpEvent({ rawBody: raw.replace("req_assinatura", "req_trocado"), signature })).status).toBe(401);
    expect(await recordOf(raw)).toBeNull();
  });

  it("corpo acima de 64 KB: 413; JSON ou envelope inválido: 400", async () => {
    const big = body("upsell.requested", COMPANY_A, { requestId: "req_grande", padding: "x".repeat(ERP_EVENTS_MAX_BYTES) });
    expect((await deliver(big)).status).toBe(413);
    expect((await deliver("{não é json")).status).toBe(400);
    expect(await deliver(JSON.stringify({ type: "upsell.requested", companyId: COMPANY_A }))).toMatchObject({ status: 400 });
  });

  it("tipo novo e empresa sem vínculo: 200, registrados como ignorados", async () => {
    const novo = body("invoice.created", COMPANY_A, { id: 1 });
    expect(await deliver(novo)).toMatchObject({ status: 200, body: { received: true, status: "ignorado" } });
    expect((await recordOf(novo))?.outcome).toMatch(/ainda não tratado/);
    const solto = body("upsell.requested", UNLINKED, { requestId: "req_solto", code: "05.02" });
    expect(await deliver(solto)).toMatchObject({ status: 200, body: { status: "ignorado" } });
    expect((await recordOf(solto))?.outcome).toMatch(/sem vínculo/);
  });
});

describe("pedido de módulo", () => {
  const raw = body("upsell.requested", COMPANY_A, { requestId: "req_1", code: "05.02", module: "compras.cotacoes", name: "Cotações" });

  it("vira histórico do cliente e tarefa para o comercial, que é avisado", async () => {
    expect(await deliver(raw)).toMatchObject({ status: 200, body: { status: "processado" }, clientId: CLIENT_A });
    const timeline = await clientEvents(CLIENT_A, "erp.module_requested");
    expect(timeline).toHaveLength(1);
    expect(timeline[0].title).toBe("Pediram 05.02 Cotações no ERP");
    const task = await getById<Task>(COLLECTIONS.tasks, erpTaskId(`erp-pedido:homologacao:${COMPANY_A}:req_1`));
    expect(task).toMatchObject({ clientId: CLIENT_A, assigneeId: SELLER.id, departmentId: "vendas", priority: "alta", origin: "evento", status: "aberta" });
    expect(task?.tags).toEqual(["erp", "oportunidade"]);
    const notes = await list<Notification>(COLLECTIONS.notifications, { where: [["userId", "==", SELLER.id]] });
    expect(notes.filter((n) => n.entityId === task?.id)).toHaveLength(1);
    expect((await recordOf(raw))?.outcome).toMatch(/Tarefa criada para Vera Vendas/);
  });

  it("a mesma entrega repetida: 200 'repetido' sem novo histórico nem tarefa", async () => {
    expect(await deliver(raw)).toMatchObject({ status: 200, body: { duplicate: true, status: "processado" } });
    expect(await clientEvents(CLIENT_A, "erp.module_requested")).toHaveLength(1);
    expect((await tasksOf(CLIENT_A)).filter((t) => t.sourceEventId?.startsWith("erp-pedido:"))).toHaveLength(1);
  });

  it("duas entregas ao mesmo tempo: uma processa, a outra espera (503) ou vê repetido; nada duplica", async () => {
    const twin = body("upsell.requested", COMPANY_A, { requestId: "req_2", code: "05.06", name: "Inventário" });
    const results = await Promise.all([deliver(twin), deliver(twin)]);
    const statuses = results.map((r) => r.status);
    expect(statuses).toContain(200);
    expect(statuses.every((s) => s === 200 || s === 503)).toBe(true);
    expect((await clientEvents(CLIENT_A, "erp.module_requested")).filter((e) => e.payload?.requestId === "req_2")).toHaveLength(1);
    expect((await tasksOf(CLIENT_A)).filter((t) => t.sourceEventId === `erp-pedido:homologacao:${COMPANY_A}:req_2`)).toHaveLength(1);
    expect((await recordOf(twin))?.status).toBe("processado");
  });
});

describe("limite do contrato", () => {
  it("cliente sem comercial: tarefa sem responsável em vendas; o aviso do dia seguinte não repete no mês", async () => {
    const day1 = body("limit.reached", COMPANY_B, { kind: "users", used: 5, limit: 5 }, "2026-11-10T10:00:00.000Z");
    const day2 = body("limit.reached", COMPANY_B, { kind: "users", used: 5, limit: 5 }, "2026-11-11T10:00:00.000Z");
    expect((await deliver(day1)).status).toBe(200);
    expect((await deliver(day2)).status).toBe(200);
    const timeline = await clientEvents(CLIENT_B, "erp.limit_reached");
    expect(timeline).toHaveLength(1);
    expect(timeline[0].title).toBe("Limite de usuários atingido no ERP (5 de 5)");
    const tasks = (await tasksOf(CLIENT_B)).filter((t) => t.sourceEventId?.startsWith("erp-limite:"));
    expect(tasks).toHaveLength(1);
    expect(tasks[0]).toMatchObject({ departmentId: "vendas", sourceEventId: `erp-limite:homologacao:${COMPANY_B}:users:2026-11` });
    expect(tasks[0].assigneeId).toBeUndefined();
    expect((await recordOf(day2))?.outcome).toMatch(/já avisado neste mês/);
  });

  it("documentos fiscais: só aviso, com o mês informado pelo ERP", async () => {
    const raw = body("limit.reached", COMPANY_B, { kind: "fiscalDocumentsPerMonth", used: 1201, limit: 1200, month: "2026-11", blocking: false });
    expect((await deliver(raw)).status).toBe(200);
    const [event] = (await clientEvents(CLIENT_B, "erp.limit_reached")).filter((e) => e.payload?.kind === "fiscalDocumentsPerMonth");
    expect(event.description).toMatch(/não bloqueia/);
    expect((await tasksOf(CLIENT_B)).filter((t) => t.sourceEventId === `erp-limite:homologacao:${COMPANY_B}:fiscalDocumentsPerMonth:2026-11`)).toHaveLength(1);
  });
});

describe("mudança automática de módulos", () => {
  it("formato do ERP ({ module, action }) vira uma linha no histórico", async () => {
    const raw = body("license.transition", COMPANY_A, { licenseVersion: 1, changes: [{ module: "vendas.pdv", action: "disable", history: "read" }], companyState: "suspended" });
    expect((await deliver(raw)).status).toBe(200);
    const [event] = await clientEvents(CLIENT_A, "erp.license_transition");
    expect(event.description).toBe("vendas.pdv desligado · situação da empresa: suspensa");
    expect(event.payload?.changes).toEqual({ "vendas.pdv": { from: "ligado", to: "desligado" } });
    // A linha do histórico do cliente leva o "de → para" (como as alterações feitas pelo INTEROS).
    const [line] = await list<TimelineEvent>(COLLECTIONS.timelineEvents, { where: [["eventId", "==", event.id]] });
    expect(line?.changes).toEqual({ "vendas.pdv": { from: "ligado", to: "desligado" } });
  });
});

describe("licença aplicada", () => {
  let changeId = "";
  let version = 0;

  it("resposta perdida: o aviso do ERP conclui a alteração pelo histórico, sem reenviar", async () => {
    const review = await reviewLicenseChange({ clientId: CLIENT_A, draft: [{ code: "05.02", state: "active" }] });
    erp.failNextPut("lost_response");
    const change = await submitLicenseChange({ clientId: CLIENT_A, draft: [{ code: "05.02", state: "active" }], baseVersion: review.baseVersion, reason: "Aditivo de cotações", actor: ANA, canApprove: false });
    expect(change.status).toBe("falhou");
    changeId = change.id;
    version = change.licenseVersion!;
    const puts = erp.calls.filter((c) => c.method === "PUT").length;
    const raw = body("license.applied", COMPANY_A, { licenseVersion: version, runtimeVersion: 2, rejectedItems: [], warnings: [] });
    expect(await deliver(raw)).toMatchObject({ status: 200, body: { status: "processado" } });
    expect((await getChange(changeId))?.status).toBe("aplicada");
    expect(erp.calls.filter((c) => c.method === "PUT").length).toBe(puts);
    expect((await recordOf(raw))?.outcome).toMatch(/concluída pelo aviso do ERP \(Aplicada/);
  });

  it("aviso de alteração já concluída, ou de versão que o INTEROS não emitiu, não muda nada", async () => {
    const again = body("license.applied", COMPANY_A, { licenseVersion: version });
    expect((await deliver(again)).status).toBe(200);
    expect((await recordOf(again))?.outcome).toMatch(/já estava concluída/);
    const other = body("license.applied", COMPANY_A, { licenseVersion: version + 50 });
    expect((await deliver(other)).status).toBe(200);
    expect((await recordOf(other))?.outcome).toMatch(/Nenhuma alteração do INTEROS com a versão/);
  });
});

describe("retomada e avisos diários", () => {
  it("processando há menos de 2 min: 503; depois disso é retomado sem repetir o histórico", async () => {
    const raw = body("license.transition", COMPANY_B, { licenseVersion: 1, changes: [{ module: "cadastros.produtos", action: "enable" }], companyState: "active" });
    expect((await deliver(raw)).status).toBe(200);
    const id = erpEventDocId("homologacao", (JSON.parse(raw) as { eventId: string }).eventId);
    const now = Date.now();
    // Simula uma queda depois de registrar no histórico e antes de concluir.
    await update<ErpInboundRecord>(COLLECTIONS.erpEvents, id, { status: "processando", claimedAt: new Date(now - 30_000).toISOString() });
    expect((await deliver(raw, { now })).status).toBe(503);
    await update<ErpInboundRecord>(COLLECTIONS.erpEvents, id, { claimedAt: new Date(now - 3 * 60_000).toISOString() });
    expect(await deliver(raw, { now })).toMatchObject({ status: 200, body: { status: "processado" } });
    expect((await getById<ErpInboundRecord>(COLLECTIONS.erpEvents, id))?.attempts).toBe(2);
    expect((await clientEvents(CLIENT_B, "erp.license_transition")).filter((e) => e.payload?.erpEventId === (JSON.parse(raw) as { eventId: string }).eventId)).toHaveLength(1);
  });

  it("'ERP sem licença nova' todo dia: um registro por empresa, fora da lista de recentes", async () => {
    for (const day of ["2026-11-25", "2026-11-26"]) {
      const raw = body("sync.stale", COMPANY_A, { appliedVersion: 1, lastSnapshotAt: "2026-11-20T00:00:00.000Z", ageDays: 6 }, `${day}T03:00:00.000Z`);
      expect(await deliver(raw)).toMatchObject({ status: 200, body: { status: "processado" } });
    }
    // Nova tentativa atrasada do aviso de um dia antes não volta o registro no tempo.
    const late = body("sync.stale", COMPANY_A, { appliedVersion: 1, lastSnapshotAt: "2026-11-20T00:00:00.000Z", ageDays: 4 }, "2026-11-24T03:00:00.000Z");
    expect((await deliver(late)).status).toBe(200);
    const stale = await getById<ErpInboundRecord>(COLLECTIONS.erpEvents, erpStaleDocId("homologacao", COMPANY_A));
    expect(stale).toMatchObject({ attempts: 2, clientId: CLIENT_A, at: "2026-11-26T03:00:00.000Z" });
    expect(stale?.outcome).toMatch(/há 6 dia\(s\)/);
    const overview = await getErpEventsOverview("homologacao", 200);
    expect(overview.recent.some((r) => r.type === "sync.stale")).toBe(false);
    expect(overview.recent.some((r) => r.erpCompanyId === COMPANY_A && r.type === "upsell.requested")).toBe(true);
    expect(overview.staleCompanies).toBeGreaterThanOrEqual(1);
    const sorted = [...overview.recent].sort((a, b) => (a.receivedAt < b.receivedAt ? 1 : -1));
    expect(overview.recent.map((r) => r.id)).toEqual(sorted.map((r) => r.id));
  });
});
