/**
 * Guardas do trilho B — Customer Success: cobertura real das páginas e actions (verificador A15), mapeamento função →
 * chave do catálogo (renovar e registrar churn com chaves próprias, A14), capacidades padrão ≡ comportamento anterior
 * (requireCsUser = módulo cs; recalcular a carteira = gestores), escopos padrão (empresa, visão inicial "meus" do
 * analista), escopo por registro com banco em memória (T8: cliente, plano, renovação e churn de outro responsável →
 * negado) e listas/detalhes que nunca ampliam o limite da tela.
 */
import { readFileSync } from "node:fs";
import path from "node:path";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { SCREENS, type ScreenKey } from "@/domain/permissions";
import { defaultScopeKind } from "@/server/auth/scope";
import { PermissionError } from "@/server/auth/errors";
import { ALL_CS_CAPABILITIES, ALL_CS_LINKS } from "@/components/cs/access-model";
import { asCurrentUser, ALL_USERS, SEED_USERS, SYNTHETIC_USERS, label, type FixtureUser } from "./fixtures";
import { legacyCanAccessModule, legacyUser } from "./legacy";

// ---------------------------------------------------------------------------
// Banco em memória (mesmo padrão de guards-implantacao.test.ts)
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
const access = await import("@/server/cs/access");
const queries = await import("@/server/cs/queries");

const ROOT = path.resolve(__dirname, "../..");
const SCOPE_PATHS = /^src\/app\/\(app\)\/cs\/|^src\/server\/cs\/|^src\/components\/cs\//;
const ACTIONS_FILE = "src/server/cs/actions.ts";
const CS_SCREENS = SCREENS.filter((s) => s.module === "cs").map((s) => s.key as ScreenKey);
const SUBJECTS = [...SEED_USERS, ...SYNTHETIC_USERS];
const byId = (id: string) => SEED_USERS.find((u) => u.id === id)!;
const inModule = (u: FixtureUser) => legacyCanAccessModule(legacyUser(u), "cs");
const isManager = (u: Pick<FixtureUser, "role">) => u.role === "gestor" || u.role === "admin" || u.role === "diretoria";

// ---------------------------------------------------------------------------
// Cobertura (A15) no repositório real
// ---------------------------------------------------------------------------
describe("cobertura do trilho B (verificador de acesso) — Customer Success", () => {
  it("nenhuma pendência em páginas, actions e guards do escopo", () => {
    const report = analyzeAccess(ROOT);
    expect(report.findings.filter((f) => SCOPE_PATHS.test(f.target))).toEqual([]);
  });

  it("as 8 páginas exigem a tela dona da rota (sem requireUser + canAccessModule)", () => {
    const pages: [string, string][] = [
      ["page.tsx", "cs.carteira"],
      ["saude/page.tsx", "cs.saude"],
      ["checkpoints/page.tsx", "cs.checkpoints"],
      ["planos/page.tsx", "cs.planos"],
      ["renovacoes/page.tsx", "cs.renovacoes"],
      ["riscos/page.tsx", "cs.riscos"],
      ["upsell/page.tsx", "cs.upsell"],
      ["churn/page.tsx", "cs.churn"],
    ];
    expect(CS_SCREENS.length).toBe(pages.length);
    for (const [file, screen] of pages) {
      const source = readFileSync(path.join(ROOT, "src/app/(app)/cs", file), "utf8");
      expect(source, file).toContain(`requireScreen("${screen}")`);
      expect(source, file).not.toMatch(/canAccessModule|requireUser|isManager|isAdmin/);
    }
  });
});

// ---------------------------------------------------------------------------
// Função → chave (actions.ts ≡ catálogo)
// ---------------------------------------------------------------------------
describe("actions do CS: a primeira chave exigida é a dona no catálogo", () => {
  const source = readFileSync(path.join(ROOT, ACTIONS_FILE), "utf8");
  const functions = [...source.matchAll(/export async function (\w+)\([\s\S]*?\n\}\n/g)].map((m) => ({ name: m[1], body: m[0] }));
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

  it("todas as 14 funções exportadas têm dono e o exigem antes de qualquer leitura", () => {
    expect(functions.length).toBe(14);
    expect(owners.size).toBe(14);
    for (const fn of functions) {
      const required = [...fn.body.matchAll(/requirePermission\("([^"]+)"/g)].map((m) => m[1]);
      expect(owners.get(fn.name), fn.name).toBeDefined();
      expect(owners.get(fn.name)!.has(required[0]), `${fn.name}: ${required[0]}`).toBe(true);
      const parse = fn.body.indexOf(".parse(");
      if (parse >= 0) expect(fn.body.indexOf("requirePermission("), fn.name).toBeLessThan(parse);
      expect(fn.body.indexOf("requirePermission("), fn.name).toBeLessThan(fn.body.indexOf("await ", fn.body.indexOf("requirePermission(") + 20));
    }
  });

  it("A14: renovar contrato e registrar churn exigem chaves próprias", () => {
    expect(body("renewContract")).toContain('requirePermission("cs.renovacoes.renovar")');
    expect(body("registerChurn")).toContain('requirePermission("cs.churn.registrar")');
  });

  it("plano: com id exige editar, sem id exige criar (antes da validação)", () => {
    expect(body("saveSuccessPlan")).toMatch(/planIdOf\(input\) \? await requirePermission\("cs\.planos\.editar"\) : await requirePermission\("cs\.planos\.criar"\)/);
  });

  it("não sobra guarda local nem fail() que devolve qualquer mensagem", () => {
    expect(source).not.toMatch(/requireCsUser|canAccessModule|requireUser|user\.isManager/);
    expect(source).toMatch(/return failAction\(error, fallback, "cs"\)/);
  });

  it("actions sobre um registro conferem o escopo (cliente, plano ou renovação); o recálculo em lote recorta pelo escopo", () => {
    for (const fn of functions) {
      if (fn.name === "recalculateAllHealthAction") {
        expect(fn.body).toMatch(/resolveDataScope\(user, "cs\.saude"\)/);
        continue;
      }
      expect(/assert(CsClient|Plan|PlanDraft|Renewal|ContractRenewal)Access\(user/.test(fn.body), fn.name).toBe(true);
    }
  });
});

// ---------------------------------------------------------------------------
// Padrão = comportamento anterior
// ---------------------------------------------------------------------------
describe("capacidades padrão ≡ comportamento anterior", () => {
  const csKeys = Object.entries(access.CS_CAPABILITY_KEYS).filter(([, key]) => key.startsWith("cs."));

  it("toda ação do CS ≡ módulo cs (requireCsUser); recalcular a carteira ≡ módulo ∧ isManager", () => {
    for (const u of ALL_USERS) {
      const caps = access.csCapabilities(asCurrentUser(u));
      for (const [cap] of csKeys) {
        const expected = cap === "recalculateAll" ? inModule(u) && isManager(u) : inModule(u);
        expect(caps[cap as keyof typeof caps], `${label(u)} ${cap}`).toBe(expected);
      }
    }
  });

  it("links internos das telas do CS ≡ módulo cs", () => {
    for (const u of ALL_USERS) {
      const links = access.csLinks(asCurrentUser(u));
      for (const k of ["portfolio", "health", "checkpoints", "plans", "renewals", "risks", "upsell", "churn"] as const) expect(links[k], `${label(u)} ${k}`).toBe(inModule(u));
    }
  });

  it("escopos padrão: empresa em todas as telas do CS (antes: ?responsavel=todos aceito de qualquer usuário)", () => {
    for (const u of SUBJECTS) for (const screen of CS_SCREENS) expect(defaultScopeKind(u, screen), `${label(u)} ${screen}`).toBe("empresa");
  });

  it("chamadores antigos (sem capacidades) continuam vendo tudo", () => {
    expect(Object.values(ALL_CS_CAPABILITIES).every(Boolean)).toBe(true);
    expect(Object.keys(ALL_CS_CAPABILITIES).sort()).toEqual(Object.keys(access.CS_CAPABILITY_KEYS).sort());
    expect(Object.keys(ALL_CS_LINKS).sort()).toEqual(Object.keys(access.CS_LINK_HREFS).sort());
  });
});

// ---------------------------------------------------------------------------
// Ajustes do CEO/CTO
// ---------------------------------------------------------------------------
describe("ajustes do CEO/CTO refletem nas capacidades", () => {
  const camila = byId("user_camila");

  it("visualizar sem editar: negar renovar/churn/planos some com os botões; as telas continuam", () => {
    const cu = asCurrentUser(camila, { userOverride: { grants: { "cs.renovacoes.renovar": false, "cs.churn.registrar": false, "cs.planos.editar": false, "cs.planos.concluir": false } } });
    const caps = access.csCapabilities(cu);
    expect(caps.renew).toBe(false);
    expect(caps.churn).toBe(false);
    expect(caps.editPlan).toBe(false);
    expect(caps.closePlan).toBe(false);
    expect(caps.negotiate && caps.createPlan && caps.checkpoint).toBe(true);
    expect(cu.permissions.has("cs.renovacoes.ver") && cu.permissions.has("cs.churn.ver") && cu.permissions.has("cs.planos.ver")).toBe(true);
  });

  it("tela negada: o link some e as ações dela também", () => {
    const cu = asCurrentUser(camila, { userOverride: { grants: { "cs.churn.ver": false } } });
    expect(access.csLinks(cu).churn).toBe(false);
    expect(access.csCapabilities(cu).churn).toBe(false);
    expect(access.csLinks(cu).renewals).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// Escopo por registro e listas com banco em memória (T8)
// ---------------------------------------------------------------------------
const iso = "2026-01-01T00:00:00.000Z";
const base = { organizationId: "intercert", createdAt: iso, updatedAt: iso };
const client = (id: string, ownerCsId: string | undefined, extra: Record<string, unknown> = {}) => ({ ...base, id, tradeName: `Cliente ${id}`, legalName: `${id} Ltda`, status: "ativo", ownerCsId, mrr: 100, activatedAt: iso, ...extra });
const plan = (id: string, ownerId: string, responsibles: string[] = []) => ({
  ...base,
  id,
  clientId: "cli_felipe",
  ownerId,
  objective: "Objetivo",
  status: "ativo",
  origin: "manual",
  actions: responsibles.map((r, i) => ({ id: `a${i}`, description: "Ação", responsibleId: r, dueAt: "2026-12-01T00:00:00.000Z", done: false })),
});
const renewal = (id: string, ownerId: string, contractId: string, clientId: string) => ({ ...base, id, contractId, clientId, ownerId, status: "aguardando", dueDate: "2026-11-30T00:00:00.000Z", windowOpensAt: iso });

function seedStore() {
  store.reads = [];
  const soon = new Date(Date.now() + 30 * 86_400_000).toISOString();
  store.data = new Map<string, Record<string, unknown>[]>([
    ["users", SUBJECTS.map((u) => ({ ...base, id: u.id, name: u.name, role: u.role, departmentId: u.departmentId, managerId: u.managerId, active: true }))],
    ["departments", []],
    [
      "clients",
      [
        client("cli_camila", "user_camila"),
        client("cli_felipe", "user_felipe"),
        // Conta de CS vence o responsável do cliente (mesma regra do filtro "Carteira de <pessoa>").
        client("cli_conta_camila", "user_felipe"),
        client("cli_venc_camila", "user_camila"),
        client("cli_venc_felipe", "user_felipe"),
      ],
    ],
    ["cs_accounts", [{ ...base, id: "acc_1", clientId: "cli_conta_camila", ownerId: "user_camila" }]],
    ["success_plans", [plan("pl_felipe", "user_felipe"), plan("pl_felipe_acao_camila", "user_felipe", ["user_camila"]), plan("pl_camila", "user_camila")]],
    ["renewals", [renewal("rn_camila", "user_camila", "ctr_camila", "cli_camila"), renewal("rn_felipe", "user_felipe", "ctr_felipe", "cli_felipe")]],
    [
      "contracts",
      [
        { ...base, id: "ctr_camila", clientId: "cli_camila", number: "CT-1", status: "liberado", monthlyTotal: 100, endDate: "2026-11-30T00:00:00.000Z" },
        { ...base, id: "ctr_felipe", clientId: "cli_felipe", number: "CT-2", status: "liberado", monthlyTotal: 200, endDate: "2026-11-30T00:00:00.000Z" },
        { ...base, id: "ctr_venc_camila", clientId: "cli_venc_camila", number: "CT-3", status: "liberado", monthlyTotal: 300, endDate: soon },
        { ...base, id: "ctr_venc_felipe", clientId: "cli_venc_felipe", number: "CT-4", status: "liberado", monthlyTotal: 400, endDate: soon },
      ],
    ],
    [
      "churn_records",
      [
        { ...base, id: "ch_camila", clientId: "cli_camila", responsibleId: "user_camila", date: "2026-09-10T12:00:00.000Z", lostMrr: 10, reasonCategory: "preco", reason: "Preço", productIds: [] },
        { ...base, id: "ch_felipe", clientId: "cli_felipe", responsibleId: "user_felipe", date: "2026-09-11T12:00:00.000Z", lostMrr: 20, reasonCategory: "preco", reason: "Preço", productIds: [] },
      ],
    ],
    ["health_scores", [{ ...base, id: "hs_1", clientId: "cli_felipe", score: 50, level: "atencao", computedAt: iso, factors: [] }]],
    ["client_products", [{ ...base, id: "cp_1", clientId: "cli_camila", productName: "P", monthlyValue: 10, status: "ativo" }, { ...base, id: "cp_2", clientId: "cli_felipe", productName: "P", monthlyValue: 20, status: "ativo" }]],
    ["settings", []],
  ]);
}

describe("escopo por registro (T8), listas e detalhes — banco em memória", () => {
  const camila = byId("user_camila");
  const felipe = byId("user_felipe");
  const meus = (...screens: ScreenKey[]) => ({ userOverride: { scopes: Object.fromEntries(screens.map((s) => [s, "meus" as const])) } });
  const ALL = CS_SCREENS;
  beforeEach(seedStore);

  it("padrão (empresa): as actions não leem o registro para decidir", async () => {
    const cu = asCurrentUser(camila);
    await access.assertCsClientAccess(cu, "cli_felipe", "cs.carteira");
    await access.assertPlanAccess(cu, "pl_felipe");
    await access.assertPlanDraftAccess(cu, { ownerId: "user_felipe" });
    await access.assertRenewalAccess(cu, "rn_felipe");
    await access.assertContractRenewalAccess(cu, "ctr_venc_felipe");
    expect(store.reads).toEqual([]);
  });

  it("escopo 'meus': cliente de outro responsável → PermissionError em todas as telas; a conta de CS vale como dono", async () => {
    const cu = asCurrentUser(camila, meus(...ALL));
    for (const screen of ["cs.carteira", "cs.saude", "cs.checkpoints", "cs.riscos", "cs.upsell", "cs.churn"] as const) {
      await expect(access.assertCsClientAccess(cu, "cli_felipe", screen), screen).rejects.toBeInstanceOf(PermissionError);
      await expect(access.assertCsClientAccess(cu, "cli_camila", screen), screen).resolves.toBeUndefined();
      await expect(access.assertCsClientAccess(cu, "cli_conta_camila", screen), screen).resolves.toBeUndefined();
    }
    expect(await access.canSeeCsClient(cu, "cli_felipe")).toBe(false);
    expect(await access.canSeeCsClient(cu, "cli_conta_camila")).toBe(true);
  });

  it("escopo 'meus': plano, renovação e contrato de outro responsável → negado", async () => {
    const cu = asCurrentUser(camila, meus(...ALL));
    await expect(access.assertPlanAccess(cu, "pl_felipe")).rejects.toBeInstanceOf(PermissionError);
    await expect(access.assertPlanAccess(cu, "pl_felipe_acao_camila")).resolves.toBeUndefined();
    await expect(access.assertPlanDraftAccess(cu, { ownerId: "user_felipe" })).rejects.toBeInstanceOf(PermissionError);
    await expect(access.assertPlanDraftAccess(cu, { ownerId: "user_felipe", actions: [{ responsibleId: "user_camila" }] })).resolves.toBeUndefined();
    await expect(access.assertRenewalAccess(cu, "rn_felipe")).rejects.toBeInstanceOf(PermissionError);
    await expect(access.assertRenewalAccess(cu, "rn_camila")).resolves.toBeUndefined();
    await expect(access.assertContractRenewalAccess(cu, "ctr_venc_felipe")).rejects.toBeInstanceOf(PermissionError);
    await expect(access.assertContractRenewalAccess(cu, "ctr_venc_camila")).resolves.toBeUndefined();
  });

  it("visão da carteira: padrão ≡ antes (analista = própria carteira; gestor = todos); ?responsavel= nunca amplia o limite", async () => {
    const analyst = await queries.resolveCsView(asCurrentUser(camila), "cs.carteira");
    expect(analyst.ownerId).toBe("user_camila");
    expect(analyst.restricted).toBe(false);
    expect((await queries.resolveCsView(asCurrentUser(camila), "cs.carteira", "user_felipe")).ownerId).toBe("user_felipe");
    expect((await queries.resolveCsView(asCurrentUser(felipe), "cs.carteira")).ownerId).toBeUndefined();
    const limited = asCurrentUser(felipe, meus("cs.carteira"));
    const other = await queries.resolveCsView(limited, "cs.carteira", "user_camila");
    expect(other.ownerId).toBe("user_felipe");
    const all = await queries.resolveCsView(limited, "cs.carteira", "todos");
    expect(all.restricted).toBe(true);
    expect(all.allows?.(["user_camila"])).toBe(false);
  });

  it("listas: carteira, planos, renovações e churn só com o que está no escopo; padrão = tudo", async () => {
    const cu = asCurrentUser(camila, meus(...ALL));
    const portfolio = await queries.getPortfolio(cu, { responsavel: "todos" });
    expect(portfolio.rows.map((r) => r.clientId).sort()).toEqual(["cli_camila", "cli_conta_camila", "cli_venc_camila"]);
    expect(portfolio.owners.map((o) => o.id)).toEqual(["user_camila"]);
    // O escopo que vai para a página/Client Components é serializável (o filtro fica no servidor).
    expect(portfolio.scope).toEqual({ param: "todos", restricted: true });
    expect((await queries.getPortfolio(asCurrentUser(camila), { responsavel: "todos" })).rows).toHaveLength(5);

    const plans = await queries.listSuccessPlans(cu, { responsavel: "todos", status: "todos" });
    expect(plans.rows.map((r) => r.plan.id).sort()).toEqual(["pl_camila", "pl_felipe_acao_camila"]);
    expect((await queries.listSuccessPlans(asCurrentUser(camila), { responsavel: "todos", status: "todos" })).rows).toHaveLength(3);

    const renewals = await queries.listRenewals(cu);
    expect(renewals.open.map((r) => r.id)).toEqual(["rn_camila"]);
    expect(renewals.unscheduled.map((r) => r.contractId)).toEqual(["ctr_venc_camila"]);
    const allRenewals = await queries.listRenewals(asCurrentUser(camila));
    expect(allRenewals.open).toHaveLength(2);
    expect(allRenewals.unscheduled).toHaveLength(2);

    const churn = await queries.getChurnMetrics(cu);
    expect(churn.records.map((r) => r.id)).toEqual(["ch_camila"]);
    expect((await queries.getChurnMetrics(asCurrentUser(camila))).records).toHaveLength(2);
    const form = await queries.getChurnFormOptions(cu);
    expect(form.clients.map((c) => c.id)).toEqual(["cli_camila"]);
  });

  it("detalhes por id (?plano=, ?cliente=): fora do escopo = null; sem a tela = null; padrão = o registro", async () => {
    const cu = asCurrentUser(camila, meus(...ALL));
    expect(await queries.getSuccessPlan("pl_felipe", cu)).toBeNull();
    expect((await queries.getSuccessPlan("pl_felipe_acao_camila", cu))?.id).toBe("pl_felipe_acao_camila");
    expect((await queries.getSuccessPlan("pl_felipe", asCurrentUser(camila)))?.id).toBe("pl_felipe");
    expect(await queries.getHealthDetail("cli_felipe", cu)).toBeNull();
    expect((await queries.getHealthDetail("cli_felipe", asCurrentUser(camila)))?.clientId).toBe("cli_felipe");
    const semSaude = asCurrentUser(camila, { userOverride: { grants: { "cs.saude.ver": false } } });
    expect(await queries.getHealthDetail("cli_felipe", semSaude)).toBeNull();
    // Assistente/sistema (sem usuário): sem recorte, como antes.
    expect((await queries.getHealthDetail("cli_felipe"))?.clientId).toBe("cli_felipe");
  });
});
