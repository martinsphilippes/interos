/**
 * Guardas do trilho B — Performance e Gestão (Meu Desempenho, Metas, Bônus, Ranking, Campanhas, Indicadores,
 * Dashboard do Gestor, Cockpit e Relatórios): cobertura real das páginas, actions e da API de relatórios (verificador
 * A15), chaves de ação padrão ≡ predicados anteriores, chave de exportação por tipo, escopos padrão, predicados puros
 * (campanhas e metas) e, com banco em memória, a equivalência de quem vê/gerencia quem (?usuario=, bônus, metas,
 * equipe do gestor) no seed — e o efeito de um escopo restringido pelo CEO/CTO.
 */
import path from "node:path";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { NODE_BY_KEY, type PermissionKey, type ScreenKey } from "@/domain/permissions";
import { COLLECTIONS, type GamificationCampaign } from "@/domain/types";
import { defaultScopeKind } from "@/server/auth/scope";
import { REPORT_DEFINITIONS, type ReportKey } from "@/server/reports/definitions";
import { asCurrentUser, ALL_USERS, SEED_DEPARTMENTS, SEED_USERS, SYNTHETIC_USERS, label, type FixtureUser } from "./fixtures";
import { legacyCanAccessReport, legacyScreenAccess, legacyUser } from "./legacy";

// ---------------------------------------------------------------------------
// Banco em memória (mesmo padrão dos demais guards-*.test.ts)
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
const { reportExportKey, reportPermissionKey, canAccessReport } = await import("@/server/reports/build");
const { campaignInScope, getPerformanceAccess } = await import("@/server/performance/queries");
const { canSeeGoal, getGoalPermissions, getGoalScope } = await import("@/server/kpis/queries");
const { canManageMember, memberAccess } = await import("@/server/management/queries");

const SCOPE_PATHS =
  /^src\/app\/\(app\)\/(performance|gestao)\/|^src\/server\/(kpis|performance|management|reports)\/|^src\/app\/api\/relatorios\/|^src\/components\/(performance|management|reports|kpis)\//;
const SUBJECTS = [...SEED_USERS, ...SYNTHETIC_USERS];
const REPORT_KEYS = Object.keys(REPORT_DEFINITIONS) as ReportKey[];

function seedDb(users: FixtureUser[] = SEED_USERS): void {
  store.data.clear();
  store.data.set(COLLECTIONS.users, users.map((u) => ({ ...u, organizationId: "intercert" })));
  store.data.set(COLLECTIONS.departments, SEED_DEPARTMENTS.map((d) => ({ ...d, id: d.key, organizationId: "intercert" })));
}

// ---------------------------------------------------------------------------
// Oráculos congelados (antes do catálogo)
// ---------------------------------------------------------------------------
/** kpis/queries.ts#getGoalPermissions (antes): userIds gerenciáveis. */
function legacyGoalUserIds(u: FixtureUser, users: FixtureUser[]): string[] {
  const lu = legacyUser(u);
  const active = users.filter((x) => x.active !== false);
  if (lu.isDirector) return active.map((x) => x.id);
  if (u.role !== "gestor") return [];
  const deps = new Set([u.departmentId, ...SEED_DEPARTMENTS.filter((d) => d.managerId === u.id).map((d) => d.key)]);
  return active.filter((x) => deps.has(x.departmentId) || x.managerId === u.id).map((x) => x.id);
}

/** performance/queries.ts#getPerformanceAccess (antes). */
function legacyPerformanceIds(u: FixtureUser, users: FixtureUser[]): { ids: string[]; manageable: string[] } {
  const lu = legacyUser(u);
  const ids = lu.isManager ? Array.from(new Set([u.id, ...legacyGoalUserIds(u, users)])) : [u.id];
  return { ids, manageable: lu.isManager ? ids.filter((id) => id !== u.id || lu.isAdmin) : [] };
}

/** management/queries.ts#canManageMember (antes): diretoria/admin qualquer ativo; gestor a equipe (2 níveis). */
function legacyCanManageMember(u: FixtureUser, memberId: string, users: FixtureUser[]): boolean {
  const lu = legacyUser(u);
  const active = users.filter((x) => x.active !== false);
  if (lu.isDirector) return active.some((x) => x.id === memberId);
  if (!lu.isManager) return false;
  const direct = active.filter((x) => x.managerId === u.id && x.id !== u.id);
  const directIds = new Set(direct.map((x) => x.id));
  const second = active.filter((x) => x.managerId && directIds.has(x.managerId) && x.id !== u.id);
  return [...direct, ...second].some((x) => x.id === memberId);
}

// ---------------------------------------------------------------------------
// Cobertura (A15) no repositório real
// ---------------------------------------------------------------------------
describe("cobertura do trilho B (verificador de acesso) — Performance e Gestão", () => {
  it("nenhuma pendência em páginas, actions, API de relatórios e guards do escopo", () => {
    const report = analyzeAccess(path.resolve(__dirname, "../.."));
    const mine = report.findings.filter((f) => SCOPE_PATHS.test(f.target));
    expect(mine).toEqual([]);
  });
});

// ---------------------------------------------------------------------------
// Padrão = comportamento anterior
// ---------------------------------------------------------------------------
describe("permissões padrão ≡ predicados anteriores", () => {
  const cases: { keys: PermissionKey[]; legacy: (u: ReturnType<typeof legacyUser>) => boolean; source: string }[] = [
    { keys: ["performance.metas.criar", "performance.metas.editar", "performance.metas.excluir", "performance.metas.copiar"], legacy: (u) => u.isManager, source: "getGoalPermissions (gestor/diretoria/admin)" },
    { keys: ["performance.bonus.equipe.ver", "performance.bonus.equipe.bloquear", "performance.bonus.equipe.aprovar", "performance.bonus.equipe.cancelar", "performance.bonus.equipe.concluir"], legacy: (u) => u.isManager, source: "user.isManager (bônus)" },
    { keys: ["performance.bonus.regras.ver", "performance.bonus.regras.editar"], legacy: (u) => u.isAdmin, source: "requireRole('admin') / isAdmin" },
    { keys: ["performance.campanhas.criar", "performance.campanhas.editar", "performance.campanhas.excluir"], legacy: (u) => u.isManager, source: "user.isManager (campanhas)" },
    { keys: ["performance.meu-desempenho.configurar", "gestao.cockpit.configurar"], legacy: (u) => u.isDirector, source: "user.isDirector (índices)" },
    { keys: ["admin.indicadores.editar", "admin.indicadores.ativar", "admin.indicadores.registrar-snapshot"], legacy: (u) => u.isAdmin, source: "user.isAdmin (indicadores)" },
    { keys: ["gestao.dashboard.ver", "gestao.dashboard.colaborador.ver", "gestao.dashboard.atribuir"], legacy: (u) => u.isManager, source: "requireRole('gestor','diretoria') / isManager" },
    { keys: ["gestao.cockpit.ver"], legacy: (u) => u.isDirector, source: "requireRole('diretoria')" },
    { keys: ["performance.indicadores.detalhamento.ver"], legacy: (u) => u.isManager, source: "withBreakdown: user.isManager" },
    { keys: ["performance.meu-desempenho.ver", "performance.metas.ver", "performance.bonus.ver", "performance.ranking.ver", "performance.campanhas.ver", "performance.indicadores.ver", "gestao.relatorios.ver", "gestao.relatorios.exportar", "gestao.cockpit.sugestoes.ver"], legacy: () => true, source: "requireUser" },
  ];

  for (const c of cases) {
    it(`${c.keys.join(", ")} ≡ ${c.source}`, () => {
      for (const key of c.keys) expect(NODE_BY_KEY.has(key), key).toBe(true);
      for (const u of ALL_USERS) {
        const cu = asCurrentUser(u);
        const lu = legacyUser(u);
        // Sugestões do cockpit só existem para quem entra no cockpit (hierarquia).
        const expected = (key: PermissionKey) => (key === "gestao.cockpit.sugestoes.ver" ? lu.isDirector : key === "gestao.relatorios.ver" || key === "gestao.relatorios.exportar" ? true : c.legacy(lu));
        for (const key of c.keys) expect(cu.permissions.has(key), `${label(u)} ${key}`).toBe(expected(key));
      }
    });
  }

  it("telas do escopo ≡ guarda anterior de cada página", () => {
    const screens = ["performance.meu-desempenho", "performance.metas", "performance.bonus", "performance.ranking", "performance.campanhas", "performance.indicadores", "gestao.dashboard", "gestao.cockpit", "gestao.relatorios"];
    for (const u of ALL_USERS) {
      const cu = asCurrentUser(u);
      for (const s of screens) expect(cu.permissions.has(`${s}.ver` as PermissionKey), `${label(u)} ${s}`).toBe(legacyScreenAccess(legacyUser(u), s));
    }
  });

  it("relatórios: prévia (canAccessReport) ≡ predicado anterior; exportação do tipo ≡ prévia", () => {
    for (const u of ALL_USERS) {
      const cu = asCurrentUser(u);
      // Auditoria (etapa 6B) não tem predicado anterior: teste próprio abaixo.
      for (const key of REPORT_KEYS.filter((k) => k !== "auditoria")) {
        const legacy = legacyCanAccessReport(legacyUser(u), key);
        expect(canAccessReport(cu, key), `${label(u)} ${key}`).toBe(legacy);
        expect(cu.permissions.has(reportExportKey(key)), `${label(u)} exportar ${key}`).toBe(legacy);
      }
    }
  });

  it("relatório de Auditoria (D29): prévia e exportação só para diretoria e administrador (chaves próprias)", () => {
    for (const u of ALL_USERS) {
      const cu = asCurrentUser(u);
      const expected = cu.role === "admin" || cu.role === "diretoria";
      expect(canAccessReport(cu, "auditoria"), `${label(u)} auditoria`).toBe(expected);
      expect(cu.permissions.has("gestao.relatorios.auditoria.exportar"), `${label(u)} exportar auditoria`).toBe(expected);
    }
    // Sem papel informado (chamadores antigos): mesma regra, por isAdmin/isDirector.
    expect(canAccessReport({ isManager: true, departmentId: "vendas" }, "auditoria")).toBe(false);
    expect(canAccessReport({ isManager: true, departmentId: "diretoria", isDirector: true }, "auditoria")).toBe(true);
    // Um gestor só acessa se o perfil conceder a seção (sem a exportação, a API continua negando).
    const gestor = ALL_USERS.find((u) => asCurrentUser(u).role === "gestor")!;
    const granted = asCurrentUser(gestor, { roleProfile: { grants: { "gestao.relatorios.auditoria.ver": true } } });
    expect(canAccessReport(granted, "auditoria")).toBe(true);
    expect(granted.permissions.has("gestao.relatorios.auditoria.exportar")).toBe(false);
  });

  it("chaves de prévia e exportação existem para todos os tipos (contas_a_pagar → contas-a-pagar)", () => {
    for (const key of REPORT_KEYS) {
      expect(NODE_BY_KEY.has(reportPermissionKey(key)), key).toBe(true);
      expect(NODE_BY_KEY.has(reportExportKey(key)), key).toBe(true);
    }
    expect(reportExportKey("contas_a_pagar")).toBe("gestao.relatorios.contas-a-pagar.exportar");
  });

  it("negar a exportação de um tipo no perfil não afeta a prévia nem os outros tipos", () => {
    const gestor = SEED_USERS.find((u) => u.role === "gestor")!;
    const cu = asCurrentUser(gestor, { roleProfile: { grants: { "gestao.relatorios.financeiro.exportar": false } } });
    expect(cu.permissions.has("gestao.relatorios.financeiro.exportar")).toBe(false);
    expect(cu.permissions.has("gestao.relatorios.financeiro.ver")).toBe(true);
    expect(cu.permissions.has("gestao.relatorios.vendas.exportar")).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// Escopos padrão
// ---------------------------------------------------------------------------
describe("escopos padrão das telas", () => {
  const expectFor = (screen: ScreenKey, map: (u: FixtureUser) => string) => {
    for (const u of SUBJECTS) expect(defaultScopeKind(u, screen), `${label(u)} ${screen}`).toBe(map(u));
  };
  const director = (u: FixtureUser) => u.role === "admin" || u.role === "diretoria";

  it("Meu Desempenho, Metas e Bônus: diretoria/admin empresa; gestor departamento; demais meus", () => {
    for (const s of ["performance.meu-desempenho", "performance.metas", "performance.bonus"] as ScreenKey[]) expectFor(s, (u) => (director(u) ? "empresa" : u.role === "gestor" ? "departamento" : "meus"));
  });

  it("Campanhas: gestão empresa; demais departamento", () => {
    expectFor("performance.campanhas", (u) => (director(u) || u.role === "gestor" ? "empresa" : "departamento"));
  });

  it("Indicadores: gestão empresa; demais meus", () => {
    expectFor("performance.indicadores", (u) => (director(u) || u.role === "gestor" ? "empresa" : "meus"));
  });

  it("Dashboard do Gestor: diretoria/admin empresa; gestor equipe", () => {
    for (const u of SUBJECTS.filter((x) => legacyUser(x).isManager)) expect(defaultScopeKind(u, "gestao.dashboard"), label(u)).toBe(director(u) ? "empresa" : "equipe");
  });

  it("Relatórios: empresa para todos (sem recorte por padrão)", () => {
    expectFor("gestao.relatorios", () => "empresa");
  });
});

// ---------------------------------------------------------------------------
// Predicados puros
// ---------------------------------------------------------------------------
describe("campanhas: registro no escopo (editar/remover) ≡ lista", () => {
  const viewer = { id: "u1", departmentId: "vendas" as const };
  const base: Pick<GamificationCampaign, "status" | "departments" | "participantIds"> = { status: "ativa", departments: ["vendas"], participantIds: [] };

  it("empresa vê todas, inclusive planejadas", () => {
    expect(campaignInScope({ ...base, status: "planejada", departments: ["cs"] }, viewer, "empresa")).toBe(true);
  });

  it("departamento: não planejadas do departamento ou em que participa", () => {
    expect(campaignInScope(base, viewer, "departamento")).toBe(true);
    expect(campaignInScope({ ...base, status: "planejada" }, viewer, "departamento")).toBe(false);
    expect(campaignInScope({ ...base, departments: ["cs"] }, viewer, "departamento")).toBe(false);
    expect(campaignInScope({ ...base, departments: ["cs"], participantIds: ["u1"] }, viewer, "departamento")).toBe(true);
  });

  it("meus: só as em que participa (lista de participantes ou, sem lista, o departamento da campanha)", () => {
    expect(campaignInScope(base, viewer, "meus")).toBe(true);
    expect(campaignInScope({ ...base, participantIds: ["u2"] }, viewer, "meus")).toBe(false);
    expect(campaignInScope({ ...base, participantIds: ["u1"] }, viewer, "meus")).toBe(true);
  });
});

describe("metas: leitura pelo escopo", () => {
  const user = { id: "u1", departmentId: "vendas" as const };
  const scope = (kind: "meus" | "departamento" | "empresa", userIds: string[] = [], departments: ("vendas" | "cs")[] = []) => ({ kind, canCompany: kind === "empresa", departments, userIds });

  it("próprias e do próprio departamento sempre; empresa só a partir de equipe/departamento", () => {
    expect(canSeeGoal(user, scope("meus"), { scope: "usuario", scopeId: "u1" })).toBe(true);
    expect(canSeeGoal(user, scope("meus"), { scope: "departamento", scopeId: "vendas" })).toBe(true);
    expect(canSeeGoal(user, scope("meus"), { scope: "empresa" })).toBe(false);
    expect(canSeeGoal(user, scope("meus"), { scope: "usuario", scopeId: "u2" })).toBe(false);
    expect(canSeeGoal(user, scope("departamento", ["u2"], ["vendas"]), { scope: "empresa" })).toBe(true);
    expect(canSeeGoal(user, scope("departamento", ["u2"], ["vendas"]), { scope: "usuario", scopeId: "u2" })).toBe(true);
    expect(canSeeGoal(user, scope("departamento", ["u2"], ["vendas"]), { scope: "usuario", scopeId: "u3" })).toBe(false);
    expect(canSeeGoal(user, scope("empresa"), { scope: "usuario", scopeId: "u3" })).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// Banco em memória: quem vê/gerencia quem
// ---------------------------------------------------------------------------
describe("equivalência no seed (banco em memória)", () => {
  beforeEach(() => seedDb());

  it("?usuario= e gestão de bônus (getPerformanceAccess) ≡ antes, para Meu Desempenho e Bônus", async () => {
    for (const u of SEED_USERS) {
      const cu = asCurrentUser(u);
      const legacy = legacyPerformanceIds(u, SEED_USERS);
      for (const screen of ["performance.meu-desempenho", "performance.bonus"] as const) {
        const access = await getPerformanceAccess(cu, screen);
        expect([...access.userIds].sort(), `${label(u)} ${screen}`).toEqual([...legacy.ids].sort());
        expect([...access.manageableIds].sort(), `${label(u)} ${screen} gerir`).toEqual([...legacy.manageable].sort());
        expect(access.canViewOthers, `${label(u)} ${screen} escolher`).toBe(legacyUser(u).isManager && legacy.ids.length > 1);
      }
    }
  });

  it("metas gerenciáveis (getGoalPermissions) ≡ antes", async () => {
    for (const u of SEED_USERS) {
      const perms = await getGoalPermissions(asCurrentUser(u));
      expect([...perms.userIds].sort(), label(u)).toEqual([...legacyGoalUserIds(u, SEED_USERS)].sort());
      expect(perms.canCompany, label(u)).toBe(legacyUser(u).isDirector);
    }
  });

  it("colaboradores do Dashboard do Gestor (canManageMember) ≡ antes", async () => {
    for (const u of SEED_USERS) {
      const cu = asCurrentUser(u);
      for (const m of SEED_USERS) expect(await canManageMember(cu, m.id), `${label(u)} → ${m.id}`).toBe(legacyCanManageMember(u, m.id, SEED_USERS));
    }
  });

  it("detalhe do colaborador: fora do escopo = negado; inexistente só é revelado a quem tem escopo empresa", async () => {
    const gestor = SEED_USERS.find((u) => u.role === "gestor")!;
    const outsider = SEED_USERS.find((m) => !legacyCanManageMember(gestor, m.id, SEED_USERS) && m.id !== gestor.id)!;
    expect(await memberAccess(asCurrentUser(gestor), outsider.id)).toBe("denied");
    expect(await memberAccess(asCurrentUser(gestor), "user_inexistente")).toBe("denied");
    const admin = SEED_USERS.find((u) => u.role === "admin")!;
    expect(await memberAccess(asCurrentUser(admin), "user_inexistente")).toBe("not-found");
    expect(await memberAccess(asCurrentUser(admin), outsider.id)).toBe("ok");
  });

  it("escopo restringido pelo CEO/CTO vale: diretoria com Meu Desempenho em 'meus' não escolhe outro colaborador", async () => {
    const admin = SEED_USERS.find((u) => u.role === "admin")!;
    const restricted = asCurrentUser(admin, { userOverride: { scopes: { "performance.meu-desempenho": "meus", "performance.metas": "meus" } } });
    const access = await getPerformanceAccess(restricted);
    expect(access.userIds).toEqual([admin.id]);
    expect(access.canViewOthers).toBe(false);
    const goals = await getGoalScope(restricted);
    expect(goals.kind).toBe("meus");
    expect(goals.canCompany).toBe(false);
  });

  it("sem a seção Equipe e bloqueios, ninguém é gerenciável no bônus (mesmo com escopo empresa)", async () => {
    const admin = SEED_USERS.find((u) => u.role === "admin")!;
    const cu = asCurrentUser(admin, { userOverride: { grants: { "performance.bonus.equipe.ver": false } } });
    const access = await getPerformanceAccess(cu, "performance.bonus");
    expect(access.manageableIds).toEqual([]);
    expect(access.userIds.length).toBeGreaterThan(1);
  });
});
