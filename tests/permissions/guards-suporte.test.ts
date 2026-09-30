/**
 * Guardas do trilho B — Suporte: cobertura real das páginas e actions (verificador A15), mapeamento função → chave do
 * catálogo (artigo: criar × editar pelo argumento), capacidades padrão ≡ comportamento anterior (requireOperator =
 * canOperateSupport; canEditArticles; abrir/reabrir/avaliar = módulo, A14), escopos padrão (empresa; visão inicial
 * "minha fila" para quem não é gestor), escopo por chamado com banco em memória (T8: chamado de outro atendente →
 * negado; fila sem atendente continua visível) e seções do chamado que não são lidas nem enviadas sem a chave.
 */
import { readFileSync } from "node:fs";
import path from "node:path";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { SCREENS, type ScreenKey } from "@/domain/permissions";
import { defaultScopeKind, resolveDataScope } from "@/server/auth/scope";
import { PermissionError } from "@/server/auth/errors";
import { ALL_SUPPORT_CAPABILITIES, OPERATOR_CAPABILITIES, canOperateAny } from "@/components/support/access-model";
import { asCurrentUser, ALL_USERS, SEED_USERS, SYNTHETIC_USERS, label, type FixtureUser } from "./fixtures";
import { legacyCanAccessModule, legacyCanEditArticles, legacyCanOperateSupport, legacyUser } from "./legacy";

// ---------------------------------------------------------------------------
// Banco em memória (mesmo padrão de guards-cs.test.ts)
// ---------------------------------------------------------------------------
const store = vi.hoisted(() => ({ data: new Map<string, Record<string, unknown>[]>(), reads: [] as string[] }));

vi.mock("@/server/db", () => {
  type Row = Record<string, unknown>;
  const rows = (name: string): Row[] => store.data.get(name) ?? [];
  const match = (row: Row, [field, op, value]: [string, string, unknown]) => {
    const v = row[field];
    if (op === "==") return v === value;
    if (op === "in") return (value as unknown[]).includes(v);
    return false;
  };
  const list = async (name: string, options: { where?: [string, string, unknown][] } = {}) => {
    store.reads.push(`list:${name}`);
    return rows(name).filter((r) => (options.where ?? []).every((w) => match(r, w)));
  };
  const getById = async (name: string, id: string) => {
    store.reads.push(`get:${name}`);
    return rows(name).find((r) => r.id === id) ?? null;
  };
  const getManyByIds = async (name: string, ids: string[]) => {
    store.reads.push(`many:${name}`);
    return new Map(rows(name).filter((r) => ids.includes(r.id as string)).map((r) => [r.id as string, r]));
  };
  const fail = async () => {
    throw new Error("escrita não esperada no teste de guardas");
  };
  return { ORG_ID: "intercert", nowIso: () => "2026-09-30T12:00:00.000Z", list, getById, getManyByIds, create: fail, update: fail, remove: fail, batchSet: fail, col: () => ({}), newId: () => "novo", stripUndefined: <T>(v: T) => v, counterId: () => "c", clearCollection: fail };
});

const { analyzeAccess } = await import("../../scripts/check-access/analyze");
const access = await import("@/server/support/access");
const queries = await import("@/server/support/queries");

const ROOT = path.resolve(__dirname, "../..");
const SCOPE_PATHS = /^src\/app\/\(app\)\/suporte\/|^src\/server\/support\/|^src\/components\/support\//;
const ACTIONS_FILE = "src/server/support/actions.ts";
const SUPPORT_SCREENS = SCREENS.filter((s) => s.module === "suporte").map((s) => s.key as ScreenKey);
const SUBJECTS = [...SEED_USERS, ...SYNTHETIC_USERS];
const byId = (id: string) => SEED_USERS.find((u) => u.id === id)!;
const inModule = (u: FixtureUser) => legacyCanAccessModule(legacyUser(u), "suporte");
const isManager = (u: Pick<FixtureUser, "role">) => u.role === "gestor" || u.role === "admin" || u.role === "diretoria";

// ---------------------------------------------------------------------------
// Cobertura (A15) no repositório real
// ---------------------------------------------------------------------------
describe("cobertura do trilho B (verificador de acesso) — Suporte", () => {
  it("nenhuma pendência em páginas, actions e guards do escopo", () => {
    const report = analyzeAccess(ROOT);
    expect(report.findings.filter((f) => SCOPE_PATHS.test(f.target))).toEqual([]);
  });

  it("as 6 páginas exigem a tela dona da rota (sem requireUser + canAccessModule)", () => {
    const pages: [string, string][] = [
      ["page.tsx", "suporte.central"],
      ["chamados/page.tsx", "suporte.chamados"],
      ["chamados/[id]/page.tsx", "suporte.chamados"],
      ["base-de-conhecimento/page.tsx", "suporte.base-de-conhecimento"],
      ["base-de-conhecimento/[id]/page.tsx", "suporte.base-de-conhecimento"],
      ["sla/page.tsx", "operacao.sla"],
    ];
    for (const [file, screen] of pages) {
      const source = readFileSync(path.join(ROOT, "src/app/(app)/suporte", file), "utf8");
      expect(source, file).toContain(`requireScreen("${screen}")`);
      expect(source, file).not.toMatch(/canAccessModule|requireUser\(|canOperateSupport|canEditArticles|isManager|isAdmin/);
    }
  });

  it("detalhes (A30): o título da aba só é lido depois de checar a tela; chamado fora do escopo = acesso negado", () => {
    const ticket = readFileSync(path.join(ROOT, "src/app/(app)/suporte/chamados/[id]/page.tsx"), "utf8");
    expect(ticket).toMatch(/can\(user, "suporte\.chamados\.ver"\)\) return \{ title: "Chamado" \}/);
    expect(ticket).toMatch(/access === "denied"\) redirect\(ACCESS_DENIED_REDIRECT\)/);
    const article = readFileSync(path.join(ROOT, "src/app/(app)/suporte/base-de-conhecimento/[id]/page.tsx"), "utf8");
    expect(article).toMatch(/can\(user, "suporte\.base-de-conhecimento\.ver"\)\) return \{ title: "Artigo" \}/);
  });
});

// ---------------------------------------------------------------------------
// Função → chave (actions.ts ≡ catálogo)
// ---------------------------------------------------------------------------
describe("actions do Suporte: a primeira chave exigida é a dona no catálogo", () => {
  const source = readFileSync(path.join(ROOT, ACTIONS_FILE), "utf8");
  const functions = [...source.matchAll(/export async function (\w+)\([\s\S]*?\n\}\n?/g)].map((m) => ({ name: m[1], body: m[0] }));
  const owners = new Map<string, Set<string>>();
  for (const s of SCREENS) {
    for (const a of s.actions) {
      for (const g of a.guards) {
        if (!g.startsWith(`${ACTIONS_FILE}#`)) continue;
        const fn = g.split("#")[1].split("?")[0];
        owners.set(fn, (owners.get(fn) ?? new Set()).add(a.key));
      }
    }
  }
  const body = (name: string) => functions.find((f) => f.name === name)!.body;

  it("todas as 19 funções exportadas têm dono e o exigem antes de validar ou ler", () => {
    expect(functions.length).toBe(19);
    expect(owners.size).toBe(19);
    for (const fn of functions) {
      const required = [...fn.body.matchAll(/requirePermission\("([^"]+)"/g)].map((m) => m[1]);
      expect(owners.get(fn.name), fn.name).toBeDefined();
      expect(required.length, fn.name).toBeGreaterThan(0);
      for (const key of required) expect(owners.get(fn.name)!.has(key), `${fn.name}: ${key}`).toBe(true);
      const parse = fn.body.indexOf(".parse(");
      if (parse >= 0) expect(fn.body.indexOf("requirePermission("), fn.name).toBeLessThan(parse);
    }
  });

  it("artigo: com id exige editar, sem id exige criar (antes da validação)", () => {
    expect(body("saveArticleAction")).toMatch(/articleIdOf\(input\) \? await requirePermission\("suporte\.base-de-conhecimento\.editar", ARTICLES_DENIED\) : await requirePermission\("suporte\.base-de-conhecimento\.criar", ARTICLES_DENIED\)/);
  });

  it("A14: abrir/reabrir chamado e avaliar artigo deixam de ser 'qualquer autenticado'", () => {
    expect(body("createTicketAction")).toContain('requirePermission("suporte.chamados.criar")');
    expect(body("loadClientTicketContext")).toContain('requirePermission("suporte.chamados.criar")');
    expect(body("reopenTicketAction")).toContain('requirePermission("suporte.chamados.reabrir")');
    expect(body("voteArticleAction")).toContain('requirePermission("suporte.base-de-conhecimento.avaliar")');
  });

  it("não sobra guarda local nem fail() que expõe error.message", () => {
    expect(source).not.toMatch(/requireOperator|requireUser|canAccessModule|canOperateSupport|canEditArticles|error\.message/);
    expect(source).toMatch(/return failAction\(error, fallback, "suporte"\)/);
  });

  it("actions sobre um chamado conferem o escopo do chamado (T8)", () => {
    const withoutTicket = new Set(["createTicketAction", "loadClientTicketContext", "runSlaAlertsAction", "voteArticleAction"]);
    for (const fn of functions) {
      if (withoutTicket.has(fn.name)) continue;
      if (fn.name === "saveArticleAction") {
        expect(fn.body).toMatch(/if \(data\.sourceTicketId\) await assertTicketAccess\(user, data\.sourceTicketId\)/);
        continue;
      }
      expect(/await assertTicketAccess\(user, (data\.)?ticketId\)/.test(fn.body), fn.name).toBe(true);
    }
  });
});

// ---------------------------------------------------------------------------
// Padrão = comportamento anterior
// ---------------------------------------------------------------------------
describe("capacidades padrão ≡ comportamento anterior", () => {
  it("operações de chamado ≡ canOperateSupport ∧ módulo; artigos ≡ canEditArticles ∧ módulo; abrir/reabrir/avaliar ≡ módulo (A14)", () => {
    for (const u of ALL_USERS) {
      const caps = access.supportCapabilities(asCurrentUser(u));
      const legacy = legacyUser(u);
      for (const cap of OPERATOR_CAPABILITIES) expect(caps[cap], `${label(u)} ${cap}`).toBe(legacyCanOperateSupport(legacy) && inModule(u));
      expect(caps.createArticle, `${label(u)} createArticle`).toBe(legacyCanEditArticles(legacy) && inModule(u));
      expect(caps.editArticle, `${label(u)} editArticle`).toBe(legacyCanEditArticles(legacy) && inModule(u));
      for (const cap of ["createTicket", "reopen", "voteArticle"] as const) expect(caps[cap], `${label(u)} ${cap}`).toBe(inModule(u));
      // O menu de ações do workspace aparece para quem operava antes (canOperate).
      expect(canOperateAny(caps), label(u)).toBe(legacyCanOperateSupport(legacy) && inModule(u));
    }
  });

  it("escopos padrão: empresa nas telas do Suporte; visão inicial da Central = equipe para gestores, minha fila para os demais", async () => {
    for (const u of SUBJECTS) {
      for (const screen of SUPPORT_SCREENS) {
        if (SCREENS.find((s) => s.key === screen)?.scope) expect(defaultScopeKind(u, screen), `${label(u)} ${screen}`).toBe("empresa");
      }
      const central = await resolveDataScope(asCurrentUser(u), "suporte.central");
      expect(central.kind, label(u)).toBe("empresa");
      expect(central.initialKind, label(u)).toBe(isManager(u) ? "empresa" : "meus");
      expect(central.poolUnassigned).toBe(true);
    }
  });

  it("chamadores antigos (sem capacidades) continuam vendo tudo", () => {
    expect(Object.values(ALL_SUPPORT_CAPABILITIES).every(Boolean)).toBe(true);
    expect(Object.keys(ALL_SUPPORT_CAPABILITIES).sort()).toEqual(Object.keys(access.SUPPORT_CAPABILITY_KEYS).sort());
  });

  it("visualizar sem editar: negar operações some com os botões e mantém a tela", () => {
    const rafael = byId("user_rafael");
    const cu = asCurrentUser(rafael, { userOverride: { grants: { "suporte.chamados.fechar": false, "suporte.chamados.enviar": false, "suporte.base-de-conhecimento.editar": false } } });
    const caps = access.supportCapabilities(cu);
    expect(caps.close).toBe(false);
    expect(caps.reply).toBe(false);
    expect(caps.editArticle).toBe(false);
    expect(caps.assume && caps.resolve && caps.register && caps.createArticle).toBe(true);
    expect(cu.permissions.has("suporte.chamados.ver") && cu.permissions.has("suporte.base-de-conhecimento.ver")).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// Escopo por chamado (T8), fila, lista e detalhe — banco em memória
// ---------------------------------------------------------------------------
describe("escopo por chamado (T8), fila da Central e detalhes — banco em memória", () => {
  const rafael = byId("user_rafael");
  const lando = byId("user_lando");
  const meus = { userOverride: { scopes: { "suporte.chamados": "meus" as const } } };
  const ticket = (id: string, assigneeId: string | undefined, status = "em_atendimento") => ({
    id,
    organizationId: "intercert",
    number: id.toUpperCase(),
    subject: `Assunto ${id}`,
    description: "Descrição",
    clientId: "cli_1",
    channel: "whatsapp",
    priority: "medio",
    status,
    queue: "n1",
    assigneeId,
    openedAt: "2026-09-29T10:00:00.000Z",
    createdAt: "2026-09-29T10:00:00.000Z",
    updatedAt: "2026-09-29T10:00:00.000Z",
  });

  beforeEach(() => {
    store.reads.length = 0;
    store.data = new Map<string, Record<string, unknown>[]>([
      ["support_tickets", [ticket("t_rafael", "user_rafael"), ticket("t_larissa", "user_larissa"), ticket("t_fila", undefined, "aberto"), ticket("t_fila_fechado", undefined, "fechado")]],
      ["clients", [{ id: "cli_1", organizationId: "intercert", tradeName: "Cliente Um", status: "ativo" }]],
      ["contracts", [{ id: "ct_1", organizationId: "intercert", clientId: "cli_1", number: "CT-1", status: "liberado", monthlyTotal: 990, createdAt: "2026-01-01T00:00:00.000Z" }]],
      ["client_products", [{ id: "cp_1", organizationId: "intercert", clientId: "cli_1", productId: "p_1", productName: "PDV", status: "ativo" }]],
      ["users", [...SEED_USERS.map((u) => ({ ...u, organizationId: "intercert" }))]],
      ["departments", []],
    ]);
  });

  it("padrão (empresa): tudo visível e a action não é negada", async () => {
    const cu = asCurrentUser(rafael);
    expect(await access.checkTicketAccess(cu, "t_larissa")).toBe("ok");
    await expect(access.assertTicketAccess(cu, "t_larissa")).resolves.toBeUndefined();
    expect((await queries.listTickets({}, cu)).map((r) => r.id).sort()).toEqual(["t_fila", "t_fila_fechado", "t_larissa", "t_rafael"]);
  });

  it("escopo 'meus': chamado de outro atendente → negado (página e action); fila sem atendente continua visível", async () => {
    const cu = asCurrentUser(rafael, meus);
    expect(await access.checkTicketAccess(cu, "t_larissa")).toBe("denied");
    await expect(access.assertTicketAccess(cu, "t_larissa")).rejects.toBeInstanceOf(PermissionError);
    expect(await access.checkTicketAccess(cu, "t_rafael")).toBe("ok");
    expect(await access.checkTicketAccess(cu, "t_fila")).toBe("ok");
    expect(await access.checkTicketAccess(cu, "nao_existe")).toBe("missing");
    expect(await queries.getTicket("t_larissa", cu)).toBeNull();
    expect(await queries.getTicketTitle("t_larissa", cu)).toBeNull();
    expect(await queries.getTicketTitle("t_rafael", cu)).toBe("T_RAFAEL · Assunto t_rafael");
    expect((await queries.listTickets({}, cu)).map((r) => r.id).sort()).toEqual(["t_fila", "t_fila_fechado", "t_rafael"]);
  });

  it("sem a tela de Chamados: nada é lido e o acesso é negado (sem revelar se o chamado existe)", async () => {
    const cu = asCurrentUser(rafael, { userOverride: { grants: { "suporte.chamados.ver": false } } });
    expect(await access.checkTicketAccess(cu, "nao_existe")).toBe("denied");
    expect(await queries.getTicketTitle("t_rafael", cu)).toBeNull();
    expect(store.reads).toEqual([]);
  });

  it("Central: analista = minha fila (dele + fila aberta); ?escopo=equipe = todos; gestor começa na equipe", async () => {
    const analyst = await queries.getSupportOverview(asCurrentUser(rafael));
    expect(analyst.scope).toBe("minha");
    expect(analyst.teamAvailable).toBe(true);
    expect(analyst.rows.map((r) => r.id).sort()).toEqual(["t_fila", "t_rafael"]);
    const team = await queries.getSupportOverview(asCurrentUser(rafael), "equipe");
    expect(team.rows.map((r) => r.id).sort()).toEqual(["t_fila", "t_larissa", "t_rafael"]);
    expect((await queries.getSupportOverview(asCurrentUser(lando))).scope).toBe("equipe");
  });

  it("Central com limite 'meus': ?escopo=equipe não amplia e a opção Equipe some", async () => {
    const overview = await queries.getSupportOverview(asCurrentUser(rafael, meus), "equipe");
    expect(overview.scope).toBe("minha");
    expect(overview.teamAvailable).toBe(false);
    expect(overview.rows.map((r) => r.id).sort()).toEqual(["t_fila", "t_rafael"]);
  });

  it("detalhe: sem 'Contexto do cliente' o contrato e o histórico não são lidos; sem 'valores' o valor não vai ao cliente", async () => {
    const full = await queries.getTicket("t_rafael", asCurrentUser(rafael));
    expect(full?.contract?.monthlyTotal).toBe(990);
    expect(full?.clientContext).toBe(true);
    expect(full?.valuesRestricted).toBe(false);
    expect(full?.previous.map((r) => r.id).sort()).toEqual(["t_fila", "t_fila_fechado", "t_larissa"]);

    store.reads.length = 0;
    const noContext = await queries.getTicket("t_rafael", asCurrentUser(rafael, { userOverride: { grants: { "suporte.chamados.cliente.ver": false } } }));
    expect(noContext?.clientContext).toBe(false);
    expect(noContext?.contract).toBeNull();
    expect(noContext?.previous).toEqual([]);
    expect(noContext?.clientProducts).toEqual([]);
    expect(store.reads).not.toContain("list:contracts");

    const noValues = await queries.getTicket("t_rafael", asCurrentUser(rafael, { userOverride: { grants: { "financeiro.valores.ver": false } } }));
    expect(noValues?.valuesRestricted).toBe(true);
    expect(noValues?.contract?.monthlyTotal).toBe(0);

    const scoped = await queries.getTicket("t_rafael", asCurrentUser(rafael, meus));
    expect(scoped?.previous.map((r) => r.id).sort()).toEqual(["t_fila", "t_fila_fechado"]);
  });

  it("link público de CSAT só com suporte.chamados.csat.ver", async () => {
    store.data.set("support_tickets", [ticket("t_ok", "user_rafael", "resolvido")]);
    expect((await queries.getTicket("t_ok", asCurrentUser(rafael)))?.csatLink).toBeTruthy();
    expect((await queries.getTicket("t_ok", asCurrentUser(rafael, { userOverride: { grants: { "suporte.chamados.csat.ver": false } } })))?.csatLink).toBeUndefined();
  });
});
