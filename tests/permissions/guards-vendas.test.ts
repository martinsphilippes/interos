/**
 * Guardas do trilho B — módulo Vendas (Central, Pipeline, Oportunidades, Agenda, Visitas e Propostas): cobertura real
 * das páginas e actions (verificador A15), despacho de chave por argumento (propostas), capacidades padrão ≡
 * comportamento anterior, escopos padrão e predicados de escopo ≡ as regras antigas (canSeeOpportunity, visitas,
 * propostas) e escopo por registro/listas com banco em memória (T8: registro de outro vendedor → negado).
 */
import path from "node:path";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { NODE_BY_KEY, type PermissionKey, type ScreenKey } from "@/domain/permissions";
import { computeDataScope, defaultScopeKind, type OrgSnapshot } from "@/server/auth/scope";
import { BusinessError, PermissionError } from "@/server/auth/errors";
import { asCurrentUser, ALL_USERS, SEED_DEPARTMENTS, SEED_USERS, SYNTHETIC_USERS, label, type FixtureUser } from "./fixtures";
import { legacyCanAccessModule, legacyUser } from "./legacy";

// ---------------------------------------------------------------------------
// Banco em memória (mesmo padrão de guards-marketing.test.ts)
// ---------------------------------------------------------------------------
const store = vi.hoisted(() => ({ data: new Map<string, Record<string, unknown>[]>() }));

vi.mock("@/server/db", () => {
  type Row = Record<string, unknown>;
  const rows = (name: string): Row[] => store.data.get(name) ?? [];
  const match = (row: Row, [field, op, value]: [string, string, unknown]) => {
    const v = row[field];
    if (op === "==") return v === value;
    if (op === "!=") return v !== value;
    if (op === "in") return (value as unknown[]).includes(v);
    return false;
  };
  const list = async (name: string, options: { where?: [string, string, unknown][] } = {}) => rows(name).filter((r) => (options.where ?? []).every((w) => match(r, w)));
  const getById = async (name: string, id: string) => rows(name).find((r) => r.id === id) ?? null;
  const getManyByIds = async (name: string, ids: string[]) => new Map(rows(name).filter((r) => ids.includes(r.id as string)).map((r) => [r.id as string, r]));
  const fail = async () => {
    throw new Error("escrita não esperada no teste de guardas");
  };
  return {
    ORG_ID: "intercert",
    nowIso: () => "2026-09-30T12:00:00.000Z",
    list,
    getById,
    getManyByIds,
    create: fail,
    update: fail,
    remove: fail,
    batchSet: fail,
    col: () => {
      throw new Error("col() não disponível no teste");
    },
    newId: () => "novo",
    stripUndefined: <T>(v: T) => v,
    counterId: () => "c",
    clearCollection: fail,
  };
});

const { analyzeAccess } = await import("../../scripts/check-access/analyze");
const { proposalSaveKey, proposalTransitionKey } = await import("@/server/sales/permission-keys");
const { SALES_SCREENS, assertOpportunityAccess, assertProposalAccess, assertVisitAccess, opportunityInScope, proposalInScope, salesCapabilities, visitInScope } = await import("@/server/sales/access");
const { getOpportunityDetail, getProposalDetail, getVisitDetail, hasTeamView, listOpenOpportunityOptions, listOpportunities, listProposals, listVisits, resolveScope } = await import("@/server/sales/queries");

const SCOPE_PATHS = /^src\/app\/\(app\)\/vendas\/|^src\/server\/sales\/|^src\/components\/sales\//;
const SUBJECTS = [...SEED_USERS, ...SYNTHETIC_USERS];
const byId = (id: string) => SEED_USERS.find((u) => u.id === id)!;
const inModule = (u: FixtureUser) => legacyCanAccessModule(legacyUser(u), "vendas");
const isManager = (u: Pick<FixtureUser, "role">) => u.role === "gestor" || u.role === "admin" || u.role === "diretoria";

// ---------------------------------------------------------------------------
// Cobertura (A15) no repositório real
// ---------------------------------------------------------------------------
describe("cobertura do trilho B (verificador de acesso) — Vendas", () => {
  it("nenhuma pendência em páginas, actions e guards de Vendas", () => {
    const report = analyzeAccess(path.resolve(__dirname, "../.."));
    const mine = report.findings.filter((f) => SCOPE_PATHS.test(f.target));
    expect(mine).toEqual([]);
  });
});

// ---------------------------------------------------------------------------
// Despacho de chave por argumento
// ---------------------------------------------------------------------------
describe("propostas: chave pelo argumento", () => {
  it("saveProposalAction: sem proposalId (ou vazio) = criar; com proposalId = editar", () => {
    expect(proposalSaveKey({ opportunityId: "o" })).toBe("vendas.propostas.criar");
    expect(proposalSaveKey({ proposalId: "" })).toBe("vendas.propostas.criar");
    expect(proposalSaveKey({ proposalId: undefined })).toBe("vendas.propostas.criar");
    expect(proposalSaveKey(null)).toBe("vendas.propostas.criar");
    expect(proposalSaveKey("texto")).toBe("vendas.propostas.criar");
    expect(proposalSaveKey({ proposalId: "prop_1" })).toBe("vendas.propostas.editar");
  });

  it("transitionProposalAction: enviar/visualizada/negociação = enviar; aceitar/recusar = aprovar", () => {
    for (const t of ["enviar", "visualizada", "negociacao"]) expect(proposalTransitionKey({ transition: t }), t).toBe("vendas.propostas.enviar");
    for (const t of ["aceitar", "recusar"]) expect(proposalTransitionKey({ transition: t }), t).toBe("vendas.propostas.aprovar");
    expect(proposalTransitionKey({ transition: "invalida" })).toBe("vendas.propostas.enviar");
    expect(proposalTransitionKey(undefined)).toBe("vendas.propostas.enviar");
  });

  it("as chaves existem no catálogo", () => {
    for (const key of ["vendas.propostas.criar", "vendas.propostas.editar", "vendas.propostas.enviar", "vendas.propostas.aprovar"] as PermissionKey[]) expect(NODE_BY_KEY.has(key), key).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// Padrão = comportamento anterior
// ---------------------------------------------------------------------------
describe("permissões padrão ≡ comportamento anterior", () => {
  it("ações de oportunidades, propostas e visitas ≡ acesso ao módulo (requireSalesUser)", () => {
    for (const u of ALL_USERS) {
      const cu = asCurrentUser(u);
      const caps = salesCapabilities(cu);
      const { assign: visitAssign, ...visits } = caps.visits;
      const flags = [...Object.values(caps.opportunities), ...Object.values(caps.proposals), ...Object.values(visits)];
      expect(flags.every((f) => f === inModule(u)), label(u)).toBe(true);
      // Antes: varredura manual e visita para outro vendedor só com isManager (dentro do módulo).
      expect(caps.sweep, label(u)).toBe(inModule(u) && isManager(u));
      expect(visitAssign, label(u)).toBe(inModule(u) && isManager(u));
      for (const screen of Object.values(SALES_SCREENS)) expect(cu.permissions.has(`${screen}.ver` as PermissionKey), `${label(u)} ${screen}`).toBe(inModule(u));
    }
  });

  it("seções da Central: todas para quem tem o módulo (antes: sem recorte)", () => {
    for (const u of ALL_USERS) {
      const cu = asCurrentUser(u);
      for (const key of ["vendas.central.workspace.ver", "vendas.central.painel.ver", "vendas.central.comissao.ver", "vendas.central.sugestoes.ver"] as PermissionKey[]) expect(cu.permissions.has(key), `${label(u)} ${key}`).toBe(inModule(u));
    }
  });

  it("escopos padrão: oportunidades/pipeline/propostas/visitas = empresa para gestores e 'meus' para os demais", () => {
    for (const u of SUBJECTS) {
      for (const screen of [SALES_SCREENS.opportunities, SALES_SCREENS.pipeline, SALES_SCREENS.proposals, SALES_SCREENS.visits]) {
        expect(defaultScopeKind(u, screen), `${label(u)} ${screen}`).toBe(isManager(u) ? "empresa" : "meus");
      }
    }
  });

  it("escopos padrão da Central e da Agenda: gestor = equipe; diretoria/admin = time de Vendas; demais = meus", () => {
    for (const u of SUBJECTS) {
      const expected = u.role === "gestor" ? "equipe" : u.role === "admin" || u.role === "diretoria" ? "departamento" : "meus";
      for (const screen of [SALES_SCREENS.central, SALES_SCREENS.agenda]) expect(defaultScopeKind(u, screen), `${label(u)} ${screen}`).toBe(expected);
    }
  });
});

// ---------------------------------------------------------------------------
// Predicados puros ≡ regras antigas
// ---------------------------------------------------------------------------
describe("predicados de escopo (padrão) ≡ regras antigas", () => {
  const org: OrgSnapshot = {
    users: SUBJECTS.map((u) => ({ id: u.id, departmentId: u.departmentId, managerId: u.managerId, active: true })),
    departments: SEED_DEPARTMENTS,
  };
  const scopeOf = (u: FixtureUser, screen: ScreenKey) => computeDataScope(u, screen, defaultScopeKind(u, screen), org);
  const people = ["user_vinicius", "user_igor", "user_camila", undefined];
  const opps = people.flatMap((ownerId) => people.map((originUserId) => ({ ownerId: ownerId ?? "user_hercules", originUserId })));

  it("oportunidades (e pipeline): isManager ∨ dono ∨ quem originou (antigo canSeeOpportunity)", () => {
    for (const u of SUBJECTS) {
      for (const screen of [SALES_SCREENS.opportunities, SALES_SCREENS.pipeline]) {
        const scope = scopeOf(u, screen);
        for (const o of opps) expect(opportunityInScope(scope, o), `${label(u)} ${screen} ${JSON.stringify(o)}`).toBe(isManager(u) || o.ownerId === u.id || o.originUserId === u.id);
      }
    }
  });

  it("propostas: isManager ∨ dono da proposta ∨ oportunidade visível", () => {
    for (const u of SUBJECTS) {
      const scope = scopeOf(u, SALES_SCREENS.proposals);
      for (const o of opps) {
        for (const ownerId of ["user_vinicius", "user_igor"]) {
          const legacy = isManager(u) || ownerId === u.id || o.ownerId === u.id || o.originUserId === u.id;
          expect(proposalInScope(scope, { ownerId }, o), `${label(u)} ${ownerId} ${JSON.stringify(o)}`).toBe(legacy);
        }
      }
    }
  });

  it("visitas: isManager ∨ vendedor ∨ quem agendou", () => {
    for (const u of SUBJECTS) {
      const scope = scopeOf(u, SALES_SCREENS.visits);
      for (const sellerId of ["user_vinicius", "user_igor"]) {
        for (const createdBy of [undefined, "user_vinicius", "user_camila"]) {
          expect(visitInScope(scope, { sellerId, createdBy }), `${label(u)} ${sellerId}/${createdBy}`).toBe(isManager(u) || sellerId === u.id || createdBy === u.id);
        }
      }
    }
  });
});

// ---------------------------------------------------------------------------
// Escopo por registro (listas, detalhes e actions) com banco em memória
// ---------------------------------------------------------------------------
const iso = "2026-01-01T00:00:00.000Z";
const base = { organizationId: "intercert", createdAt: iso, updatedAt: iso };
const opp = (id: string, ownerId: string, extra: Record<string, unknown> = {}) => ({ ...base, id, clientId: "cli_1", title: id, kind: "nova_venda", stage: "proposta", ownerId, temperature: "morno", probability: 50, products: [], setupTotal: 0, monthlyTotal: 0, hardwareTotal: 0, lastActivityAt: iso, stageChangedAt: iso, ...extra });
const proposal = (id: string, opportunityId: string, ownerId: string) => ({ ...base, id, clientId: "cli_1", opportunityId, number: `PR-${id}`, version: 1, status: "rascunho", items: [], setupTotal: 0, monthlyTotal: 0, hardwareTotal: 0, discountTotal: 0, validUntil: "2026-12-31T23:59:59.000Z", ownerId });
const visit = (id: string, sellerId: string, createdBy?: string) => ({ ...base, id, clientId: "cli_1", sellerId, createdBy, status: "agendada", scheduledAt: "2026-10-01T10:00:00.000Z", durationMinutes: 60, objective: id });

function seedStore() {
  store.data = new Map<string, Record<string, unknown>[]>([
    ["users", SUBJECTS.map((u) => ({ ...base, id: u.id, name: u.name, email: `${u.id}@t`, role: u.role, departmentId: u.departmentId, managerId: u.managerId, active: true }))],
    ["departments", SEED_DEPARTMENTS.map((d) => ({ ...base, id: `dept_${d.key}`, key: d.key, managerId: d.managerId, name: d.key, order: 1 }))],
    ["clients", [{ ...base, id: "cli_1", tradeName: "Cliente 1", legalName: "Cliente 1 Ltda", status: "prospect" }]],
    ["contacts", []],
    ["products", []],
    ["settings", [{ ...base, id: "setting_pipeline_stages", key: "pipeline_stages", value: { stages: [{ key: "qualificacao", label: "Qualificação" }, { key: "proposta", label: "Proposta" }] } }]],
    ["opportunities", [opp("opp_vini", "user_vinicius"), opp("opp_igor", "user_igor"), opp("opp_origem", "user_igor", { originUserId: "user_camila" })]],
    ["proposals", [proposal("prop_vini", "opp_vini", "user_vinicius"), proposal("prop_igor", "opp_igor", "user_igor")]],
    ["visits", [visit("vis_vini", "user_vinicius"), visit("vis_igor", "user_igor", "user_igor"), visit("vis_agendada_por_vini", "user_igor", "user_vinicius")]],
    ["tasks", []],
    ["events", []],
    ["sla_instances", []],
    ["permission_profiles", []],
  ]);
}

/** Usuário com escopo/permissões ajustados por exceção individual (como o CEO/CTO configuraria). */
const withAdjust = (u: FixtureUser, scopes: Record<string, string>, grants: Record<string, boolean> = {}) => asCurrentUser(u, { userOverride: { scopes: scopes as never, grants } });

describe("escopo por registro (Vendas)", () => {
  beforeEach(seedStore);
  const vinicius = byId("user_vinicius");
  const igor = byId("user_igor");
  const camila = byId("user_camila");

  it("T8: vendedor (escopo próprio) → oportunidade, proposta e visita de outro dono = PermissionError; as próprias passam", async () => {
    const cu = asCurrentUser(vinicius);
    await expect(assertOpportunityAccess(cu, "opp_igor")).rejects.toBeInstanceOf(PermissionError);
    await expect(assertOpportunityAccess(cu, "opp_vini")).resolves.toMatchObject({ id: "opp_vini" });
    await expect(assertProposalAccess(cu, "prop_igor")).rejects.toBeInstanceOf(PermissionError);
    await expect(assertProposalAccess(cu, "prop_vini")).resolves.toMatchObject({ proposal: { id: "prop_vini" } });
    await expect(assertVisitAccess(cu, "vis_igor")).rejects.toBeInstanceOf(PermissionError);
    await expect(assertVisitAccess(cu, "vis_vini")).resolves.toMatchObject({ id: "vis_vini" });
    // Quem agendou continua podendo alterar (createdBy), como antes.
    await expect(assertVisitAccess(cu, "vis_agendada_por_vini")).resolves.toMatchObject({ id: "vis_agendada_por_vini" });
    // Quem originou (CS que abriu o upsell) altera a oportunidade, como antes.
    await expect(assertOpportunityAccess(asCurrentUser(camila), "opp_origem")).resolves.toMatchObject({ id: "opp_origem" });
    // Inexistente: erro de negócio "não encontrada" (mensagem de antes), não acesso negado.
    await expect(assertOpportunityAccess(cu, "nao_existe")).rejects.toBeInstanceOf(BusinessError);
    await expect(assertProposalAccess(cu, "nao_existe")).rejects.toBeInstanceOf(BusinessError);
    await expect(assertVisitAccess(cu, "nao_existe")).rejects.toBeInstanceOf(BusinessError);
  });

  it("gestor: empresa por padrão; restrito a 'meus' pelo CEO/CTO, perde os registros do liderado", async () => {
    await expect(assertOpportunityAccess(asCurrentUser(igor), "opp_vini")).resolves.toMatchObject({ id: "opp_vini" });
    await expect(assertProposalAccess(asCurrentUser(igor), "prop_vini")).resolves.toBeTruthy();
    await expect(assertVisitAccess(asCurrentUser(igor), "vis_vini")).resolves.toBeTruthy();
    const restricted = withAdjust(igor, { "vendas.oportunidades": "meus", "vendas.propostas": "meus", "vendas.visitas": "meus" });
    await expect(assertOpportunityAccess(restricted, "opp_vini")).rejects.toBeInstanceOf(PermissionError);
    await expect(assertOpportunityAccess(restricted, "opp_igor")).resolves.toBeTruthy();
    // Propostas restritas mesmo com a oportunidade visível: as duas checagens valem.
    const onlyProposals = withAdjust(igor, { "vendas.propostas": "meus" });
    await expect(assertProposalAccess(onlyProposals, "prop_vini")).rejects.toBeInstanceOf(PermissionError);
    await expect(assertVisitAccess(restricted, "vis_vini")).rejects.toBeInstanceOf(PermissionError);
    expect((await listOpportunities(restricted)).rows.map((r) => r.id).sort()).toEqual(["opp_igor", "opp_origem"]);
  });

  it("tela negada nega o registro mesmo sendo o dono", async () => {
    const noScreen = withAdjust(vinicius, {}, { "vendas.oportunidades.ver": false });
    await expect(assertOpportunityAccess(noScreen, "opp_vini")).rejects.toBeInstanceOf(PermissionError);
    expect(salesCapabilities(noScreen).opportunities.edit).toBe(false);
  });

  it("listas e detalhes filtram pelo escopo da tela", async () => {
    const cu = asCurrentUser(vinicius);
    expect((await listOpportunities(cu)).rows.map((r) => r.id)).toEqual(["opp_vini"]);
    expect((await listOpportunities(cu, "vendas.pipeline")).rows.map((r) => r.id)).toEqual(["opp_vini"]);
    expect(await getOpportunityDetail(cu, "opp_igor")).toBeNull();
    expect((await getOpportunityDetail(cu, "opp_vini"))?.opportunity.id).toBe("opp_vini");
    expect((await listProposals(cu)).map((p) => p.id)).toEqual(["prop_vini"]);
    expect(await getProposalDetail(cu, "prop_igor")).toBeNull();
    expect((await listVisits(cu)).map((v) => v.id).sort()).toEqual(["vis_agendada_por_vini", "vis_vini"]);
    expect(await getVisitDetail(cu, "vis_igor")).toBeNull();
    expect((await listOpenOpportunityOptions(cu)).map((o) => o.id)).toEqual(["opp_vini"]);
    const manager = asCurrentUser(igor);
    expect((await listOpportunities(manager)).rows).toHaveLength(3);
    expect(await listVisits(manager)).toHaveLength(3);
  });

  it("Central/Agenda: 'Equipe' = escopo efetivo; sem escopo maior que 'meus' a visão fica em 'Minha'", async () => {
    const manager = asCurrentUser(igor);
    expect(await hasTeamView(manager, "vendas.central")).toBe(true);
    const team = await resolveScope(manager, "equipe", "vendas.central");
    expect(team.kind).toBe("equipe");
    expect([...team.userIds].sort()).toEqual(["user_igor", "user_vinicius"]);
    expect((await resolveScope(manager, undefined)).userIds).toEqual(["user_igor"]);
    const seller = asCurrentUser(vinicius);
    expect(await hasTeamView(seller, "vendas.agenda")).toBe(false);
    expect(await resolveScope(seller, "equipe", "vendas.agenda")).toMatchObject({ kind: "meu", userIds: ["user_vinicius"] });
    const restricted = withAdjust(igor, { "vendas.central": "meus" });
    expect(await hasTeamView(restricted, "vendas.central")).toBe(false);
    expect((await resolveScope(restricted, "equipe", "vendas.central")).kind).toBe("meu");
    // Ampliado para a empresa pelo CEO/CTO: todos os usuários ativos.
    const wide = withAdjust(vinicius, { "vendas.agenda": "empresa" });
    expect((await resolveScope(wide, "equipe", "vendas.agenda")).userIds).toHaveLength(SUBJECTS.length);
  });
});
