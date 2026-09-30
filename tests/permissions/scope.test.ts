/**
 * Escopo (A7/A23): resolveDataScope (via computeDataScope, com o escopo padrão de cada tela) produz o MESMO conjunto
 * de usuários/registros que cada resolveScope atual dos módulos, para todos os usuários do seed e os sintéticos.
 * O banco é substituído por fixtures em memória (sem Firestore).
 */
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { Department, SupportTicket, Task, User } from "@/domain/types";
import type { ScreenKey } from "@/domain/permissions";
import { computeDataScope, defaultScopeKind, filterByScope, scopeAllows, type OrgSnapshot } from "@/server/auth/scope";
import { asCurrentUser, SEED_DEPARTMENTS, SEED_USERS, SYNTHETIC_USERS, type FixtureUser } from "./fixtures";

// ---------------------------------------------------------------------------
// Banco em memória
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
    if (op === "array-contains") return Array.isArray(v) && v.includes(value);
    if (op === "array-contains-any") return Array.isArray(v) && (value as unknown[]).some((x) => v.includes(x));
    return false;
  };
  const list = async (name: string, options: { where?: [string, string, unknown][] } = {}) => rows(name).filter((r) => (options.where ?? []).every((w) => match(r, w)));
  const getById = async (name: string, id: string) => rows(name).find((r) => r.id === id) ?? null;
  const getManyByIds = async (name: string, ids: string[]) => new Map(rows(name).filter((r) => ids.includes(r.id as string)).map((r) => [r.id as string, r]));
  const fail = async () => {
    throw new Error("escrita não esperada no teste de escopo");
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

const { resolveScope: resolveSalesScope } = await import("@/server/sales/queries");
const { resolveScope: resolveImplementationScope } = await import("@/server/implementation/queries");
const { resolveScope: resolveMeuDiaScope } = await import("@/server/meu-dia/queries");
const { resolveScope: resolveCsScope } = await import("@/server/cs/queries");
const { resolveManagerScope } = await import("@/server/management/queries");
const { getPerformanceAccess } = await import("@/server/performance/queries");
const { resolveCommissionScope } = await import("@/server/commissions/queries");
const { loadScope: loadTaskScope } = await import("@/server/tasks/queries");
const { getSupportOverview } = await import("@/server/support/queries");

// ---------------------------------------------------------------------------
// Organização de teste: seed + sintéticos (+ um inativo, que nunca entra)
// ---------------------------------------------------------------------------
const iso = "2026-01-01T00:00:00.000Z";
const inactive: FixtureUser = { id: "user_inativo", name: "Inativo", role: "vendas", departmentId: "vendas", managerId: "user_igor", active: false, kind: "sintetico" };
const PEOPLE: FixtureUser[] = [...SEED_USERS, ...SYNTHETIC_USERS, inactive];
const asUserDoc = (u: FixtureUser): User => ({ id: u.id, organizationId: "intercert", createdAt: iso, updatedAt: iso, name: u.name, email: `${u.id}@t`, role: u.role, departmentId: u.departmentId, managerId: u.managerId, active: u.active }) as User;

/** Dois cenários de departamentos: o do seed e um em que o gestor sintético lidera CS e Suporte (multi). */
const DEPARTMENT_SCENARIOS: Record<string, Pick<Department, "key" | "managerId">[]> = {
  seed: SEED_DEPARTMENTS,
  multi: SEED_DEPARTMENTS.map((d) => (d.key === "cs" || d.key === "suporte" ? { ...d, managerId: "syn_lando_multi" } : d)),
};

const TASKS: Task[] = PEOPLE.flatMap((u, i) => [
  { id: `t_${i}_a`, assigneeId: u.id, departmentId: u.departmentId },
  { id: `t_${i}_b`, assigneeId: u.id, departmentId: i % 2 ? "vendas" : "cs" },
  { id: `t_${i}_c`, assigneeId: PEOPLE[(i + 3) % PEOPLE.length].id, departmentId: u.departmentId },
]).map((t) => ({ ...t, organizationId: "intercert", createdAt: iso, updatedAt: iso, title: t.id, status: "aberta", priority: "media", creatorId: "user_hercules", origin: "manual" }) as unknown as Task);

const TICKETS: SupportTicket[] = PEOPLE.flatMap((u, i) => [
  { id: `tk_${i}_a`, assigneeId: u.id, status: "aberto" },
  { id: `tk_${i}_b`, assigneeId: undefined, status: i % 2 ? "em_atendimento" : "aberto" },
  { id: `tk_${i}_c`, assigneeId: u.id, status: "resolvido" },
]).map(
  (t, n) =>
    ({
      ...t,
      organizationId: "intercert",
      createdAt: iso,
      updatedAt: iso,
      number: `CH-${n}`,
      clientId: "cli_1",
      subject: t.id,
      description: "",
      channel: "portal",
      priority: "media",
      queue: "n1",
      openedAt: iso,
      reopenCount: 0,
    }) as unknown as SupportTicket,
);

function useScenario(name: keyof typeof DEPARTMENT_SCENARIOS): OrgSnapshot {
  const departments = DEPARTMENT_SCENARIOS[name].map((d) => ({ ...d, id: `dept_${d.key}`, organizationId: "intercert", createdAt: iso, updatedAt: iso, name: d.key, order: 1 }));
  store.data = new Map<string, Record<string, unknown>[]>([
    ["users", PEOPLE.map(asUserDoc) as unknown as Record<string, unknown>[]],
    ["departments", departments],
    ["tasks", TASKS as unknown as Record<string, unknown>[]],
    ["support_tickets", TICKETS as unknown as Record<string, unknown>[]],
    ["clients", [{ id: "cli_1", organizationId: "intercert", tradeName: "Cliente" }]],
  ]);
  return { users: PEOPLE.map(asUserDoc), departments: DEPARTMENT_SCENARIOS[name] };
}

const ACTIVE_IDS = PEOPLE.filter((u) => u.active).map((u) => u.id).sort();
const sorted = (ids: Iterable<string>) => [...new Set(ids)].sort();
/** Conjunto de pessoas do escopo (empresa = todos os ativos). */
const peopleOf = (u: FixtureUser, screen: ScreenKey, org: OrgSnapshot, kind = defaultScopeKind(u, screen)) => {
  const scope = computeDataScope(u, screen, kind, org);
  return scope.userIds ? sorted(scope.userIds) : ACTIVE_IDS;
};

const SUBJECTS = PEOPLE.filter((u) => u.active);

describe.each(Object.keys(DEPARTMENT_SCENARIOS))("escopo ≡ resolvedores atuais (departamentos: %s)", (scenario) => {
  let org: OrgSnapshot;
  beforeEach(() => {
    org = useScenario(scenario as keyof typeof DEPARTMENT_SCENARIOS);
  });

  it("Meu Dia: equipe = o próprio + liderados diretos; diretoria/admin = empresa; demais = meus", async () => {
    for (const u of SUBJECTS) {
      const current = await resolveMeuDiaScope(asCurrentUser(u), "equipe");
      expect(peopleOf(u, "inicio.meu-dia", org), u.id).toEqual(sorted(current.members.map((m) => m.id)));
    }
  });

  it("Central de Vendas e Agenda: gestor = equipe (1 nível); diretoria/admin = time de Vendas; demais = meus", async () => {
    for (const u of SUBJECTS) {
      const current = await resolveSalesScope(asCurrentUser(u), "equipe");
      expect(peopleOf(u, "vendas.central", org), u.id).toEqual(sorted(current.userIds));
      expect(peopleOf(u, "vendas.agenda", org), u.id).toEqual(sorted(current.userIds));
    }
  });

  it("Implantação: limite empresa; 'equipe' do gestor = 1 nível, da diretoria = departamento; visão inicial igual", async () => {
    for (const u of SUBJECTS) {
      const cu = asCurrentUser(u);
      const team = await resolveImplementationScope(cu, "equipe");
      if (cu.isManager) expect(peopleOf(u, "implantacao.projetos", org, cu.isDirector ? "departamento" : "equipe"), u.id).toEqual(sorted(team.userIds ?? []));
      else expect(team.userIds, u.id).toBeNull();
      expect(defaultScopeKind(u, "implantacao.projetos"), u.id).toBe("empresa");
      const initial = await resolveImplementationScope(cu, undefined);
      const ours = computeDataScope(u, "implantacao.projetos", "empresa", org).initialKind;
      expect(ours === "equipe" ? "equipe" : "todos", u.id).toBe(initial.kind);
      expect(sorted((await resolveImplementationScope(cu, "meus")).userIds ?? []), u.id).toEqual(peopleOf(u, "implantacao.projetos", org, "meus"));
    }
  });

  it("Performance (meu desempenho, metas, bônus): gestor = departamento ∪ liderados ∪ geridos; diretoria = empresa", async () => {
    for (const u of SUBJECTS) {
      const access = await getPerformanceAccess(asCurrentUser(u));
      for (const screen of ["performance.meu-desempenho", "performance.metas", "performance.bonus"] as const) {
        expect(peopleOf(u, screen, org), `${u.id} ${screen}`).toEqual(sorted(access.userIds));
      }
    }
  });

  it("Comissões e Contas a Pagar: equipe financeira = empresa; gestor = equipe (getGoalPermissions); demais = próprias", async () => {
    for (const u of SUBJECTS) {
      const current = await resolveCommissionScope(asCurrentUser(u));
      for (const screen of ["financeiro.comissoes", "financeiro.contas-a-pagar"] as const) {
        const kind = defaultScopeKind(u, screen);
        expect(kind === "empresa" ? "all" : kind === "equipe" ? "team" : "own", `${u.id} ${screen}`).toBe(current.kind);
        if (current.kind !== "all") expect(peopleOf(u, screen, org), `${u.id} ${screen}`).toEqual(sorted(current.userIds));
      }
    }
  });

  it("Dashboard do Gestor: gestor = liderados em 2 níveis (sem o próprio); diretoria = empresa", async () => {
    for (const u of SUBJECTS) {
      const cu = asCurrentUser(u);
      if (!cu.isManager) {
        expect(cu.permissions.has("gestao.dashboard.ver"), u.id).toBe(false);
        continue;
      }
      const current = await resolveManagerScope(cu);
      const ids = sorted(current.members.map((m) => m.id));
      if (cu.isDirector) {
        expect(defaultScopeKind(u, "gestao.dashboard"), u.id).toBe("empresa");
        // A lista da diretoria omite o próprio e o departamento Diretoria (apresentação), dentro da empresa.
        expect(ids, u.id).toEqual(ACTIVE_IDS.filter((id) => id !== u.id && PEOPLE.find((p) => p.id === id)!.departmentId !== "diretoria"));
      } else {
        expect(peopleOf(u, "gestao.dashboard", org), u.id).toEqual(ids);
      }
    }
  });

  it("Customer Success: limite empresa para todos; visão inicial 'meus' só para analista de CS não gestor", () => {
    for (const u of SUBJECTS) {
      const cu = asCurrentUser(u);
      for (const screen of ["cs.carteira", "cs.saude", "cs.checkpoints", "cs.planos", "cs.riscos", "cs.upsell"] as const) {
        expect(defaultScopeKind(u, screen), `${u.id} ${screen}`).toBe("empresa");
        expect(resolveCsScope(cu, "todos").ownerId, u.id).toBeUndefined();
        const initial = resolveCsScope(cu, undefined);
        const ours = computeDataScope(u, screen, "empresa", org).initialKind;
        expect(ours === "meus" ? u.id : undefined, `${u.id} ${screen}`).toBe(initial.ownerId);
      }
    }
  });

  it("Suporte: limite empresa; visão inicial 'meus' com a fila sem atendente para quem não é gestor", async () => {
    for (const u of SUBJECTS) {
      const cu = asCurrentUser(u);
      expect(defaultScopeKind(u, "suporte.central"), u.id).toBe("empresa");
      const scope = computeDataScope(u, "suporte.central", "empresa", org);
      const initial = scope.initialKind === "empresa" ? scope : computeDataScope(u, "suporte.central", scope.initialKind, org);
      const overview = await getSupportOverview(cu);
      const expectedIds = TICKETS.filter((t) => ["aberto", "em_atendimento", "reaberto", "aguardando_cliente"].includes(t.status))
        .filter((t) => scopeAllows(initial, [t.assigneeId]))
        .map((t) => t.id);
      expect(sorted(overview.rows.map((r) => r.id)), u.id).toEqual(sorted(expectedIds));
      expect(overview.scope, u.id).toBe(initial.kind === "empresa" ? "equipe" : "minha");
    }
  });

  it("Tarefas: gestores = empresa; demais = departamento do registro + as próprias; 'minha' = as próprias", async () => {
    for (const u of SUBJECTS) {
      const cu = asCurrentUser(u);
      const team = await loadTaskScope(cu, "team");
      const scope = computeDataScope(u, "operacao.tarefas", defaultScopeKind(u, "operacao.tarefas"), org);
      const ours = filterByScope(TASKS, (t) => ({ owners: [t.assigneeId], departmentId: t.departmentId }), scope);
      expect(sorted(ours.map((t) => t.id)), u.id).toEqual(sorted(team.map((t) => t.id)));
      const mine = await loadTaskScope(cu, "mine");
      const meus = filterByScope(TASKS, (t) => ({ owners: [t.assigneeId] }), computeDataScope(u, "operacao.tarefas", "meus", org));
      expect(sorted(meus.map((t) => t.id)), u.id).toEqual(sorted(mine.map((t) => t.id)));
    }
  });
});

describe("escopo — regras gerais", () => {
  it("'unidades' resolve como empresa; tela sem escopo = empresa", () => {
    const org = useScenario("seed");
    const u = SEED_USERS[5];
    expect(computeDataScope(u, "vendas.oportunidades", "unidades", org).kind).toBe("empresa");
    expect(computeDataScope(u, "vendas.oportunidades", "unidades", org).userIds).toBeUndefined();
    expect(defaultScopeKind(u, "gestao.cockpit")).toBe("empresa");
  });

  it("scopeAllows: qualquer dono no escopo basta; sem dono só com a fila sem responsável", () => {
    const scope = { userIds: new Set(["a"]), departmentKeys: undefined, poolUnassigned: false };
    expect(scopeAllows(scope, ["b", "a"])).toBe(true);
    expect(scopeAllows(scope, ["b"])).toBe(false);
    expect(scopeAllows(scope, [])).toBe(false);
    expect(scopeAllows({ ...scope, poolUnassigned: true }, [undefined])).toBe(true);
    expect(scopeAllows({ userIds: undefined, departmentKeys: undefined, poolUnassigned: false }, ["x"])).toBe(true);
  });
});
