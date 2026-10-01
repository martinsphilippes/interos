/**
 * Guardas do trilho B — módulos Início e Operação (Meu Dia, Notificações, Tarefas, Clientes 360º, Workflow, SLA e a
 * busca global): cobertura real das páginas e actions (verificador A15), despacho de chaves das actions por
 * argumento, equivalência das permissões padrão com o comportamento anterior e escopo por registro (T7/T8) com banco
 * em memória.
 */
import path from "node:path";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { NODE_BY_KEY, type PermissionKey } from "@/domain/permissions";
import { TASK_STATUS, type TaskStatus } from "@/domain/constants";
import { computeDataScope, defaultScopeKind } from "@/server/auth/scope";
import { asCurrentUser, ALL_USERS, SEED_DEPARTMENTS, SEED_USERS, SYNTHETIC_USERS, label, type FixtureUser } from "./fixtures";
import { legacyCanAccessModule, legacyIsFinanceTeam, legacyUser } from "./legacy";

// ---------------------------------------------------------------------------
// Banco em memória (mesmo padrão de scope.test.ts)
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
const { statusChangeKeys, deleteTaskKeys } = await import("@/server/tasks/permission-keys");
const { canSeeTask, taskCapabilities } = await import("@/server/tasks/access");
const { CLIENT_SECTION_KEYS, canSeeClient, canSeeClientId, clientCapabilities, clientSectionAccess } = await import("@/server/clients/access");
const { canSeeInstance, canSeeStep, canSeeStepId } = await import("@/server/workflow/access");
const { meuDiaSections } = await import("@/server/meu-dia/queries");

const SCOPE_PATHS = /^src\/app\/\(app\)\/(meu-dia|tarefas|clientes|workflow|sla|notificacoes)\/|^src\/server\/(tasks|clients|workflow|notifications|meu-dia|search|users)\/|^src\/components\/(tasks|clients|workflow|meu-dia|search|notifications)\//;
const SUBJECTS = [...SEED_USERS, ...SYNTHETIC_USERS];
const byId = (id: string) => SEED_USERS.find((u) => u.id === id)!;

// ---------------------------------------------------------------------------
// Cobertura (A15) no repositório real
// ---------------------------------------------------------------------------
describe("cobertura do trilho B (verificador de acesso)", () => {
  it("nenhuma pendência em páginas, actions e guards de Início/Operação", () => {
    const report = analyzeAccess(path.resolve(__dirname, "../.."));
    const mine = report.findings.filter((f) => SCOPE_PATHS.test(f.target));
    expect(mine).toEqual([]);
  });
});

// ---------------------------------------------------------------------------
// Despacho de chaves por argumento
// ---------------------------------------------------------------------------
describe("Tarefas: chaves exigidas pela troca de status e pela exclusão", () => {
  it("concluir/cancelar/reabrir usam as chaves próprias; status intermediário = editar", () => {
    expect(statusChangeKeys("aberta", "concluida")).toEqual(["operacao.tarefas.concluir"]);
    expect(statusChangeKeys("em_andamento", "cancelada")).toEqual(["operacao.tarefas.cancelar"]);
    expect(statusChangeKeys("concluida", "aberta")).toEqual(["operacao.tarefas.reabrir"]);
    expect(statusChangeKeys("cancelada", "em_andamento")).toEqual(["operacao.tarefas.reabrir", "operacao.tarefas.editar"]);
    expect(statusChangeKeys("aberta", "aguardando")).toEqual(["operacao.tarefas.editar"]);
  });

  it("toda combinação de status devolve só chaves existentes no catálogo", () => {
    for (const from of TASK_STATUS as readonly TaskStatus[]) for (const to of TASK_STATUS as readonly TaskStatus[]) for (const key of statusChangeKeys(from, to)) expect(NODE_BY_KEY.has(key), `${from}→${to}: ${key}`).toBe(true);
  });

  it("excluir tarefa de outra pessoa exige também excluir-qualquer", () => {
    expect(deleteTaskKeys({ creatorId: "u1" }, "u1")).toEqual(["operacao.tarefas.excluir"]);
    expect(deleteTaskKeys({ creatorId: "u2" }, "u1")).toEqual(["operacao.tarefas.excluir", "operacao.tarefas.excluir-qualquer"]);
  });
});

// ---------------------------------------------------------------------------
// Padrão = comportamento anterior (botões, seções e escopos)
// ---------------------------------------------------------------------------
describe("permissões padrão ≡ comportamento anterior", () => {
  it("Tarefas: tudo liberado; excluir de outras pessoas só gestores (isManager)", () => {
    for (const u of ALL_USERS) {
      const cu = asCurrentUser(u);
      const caps = taskCapabilities(cu);
      const { deleteAny, ...rest } = caps;
      expect(deleteAny, label(u)).toBe(cu.isManager);
      expect(Object.values(rest).every(Boolean), label(u)).toBe(true);
    }
  });

  it("Clientes 360º: todas as seções e ações liberadas para todos", () => {
    for (const u of ALL_USERS) {
      const cu = asCurrentUser(u);
      expect(Object.values(clientSectionAccess(cu)).every(Boolean), label(u)).toBe(true);
      expect(Object.values(clientCapabilities(cu)).every(Boolean), label(u)).toBe(true);
    }
  });

  it("Meu Dia: financeiro ≡ isFinanceTeam; equipe e insights ≡ isManager; blocos exigem o módulo de origem; demais para todos", () => {
    for (const u of ALL_USERS) {
      const cu = asCurrentUser(u);
      const legacy = legacyUser(u);
      const { financeiro, equipe, insights, cobrancasVendas, contratos, followups, visitas, ...rest } = meuDiaSections(cu);
      // Bloco Financeiro: equipe financeira E acesso ao módulo (papel cs/marketing lotado no Financeiro não abre o módulo).
      expect(financeiro, label(u)).toBe(legacyIsFinanceTeam(legacy) && legacyCanAccessModule(legacy, "financeiro"));
      expect(equipe, label(u)).toBe(cu.isManager);
      expect(insights, label(u)).toBe(cu.isManager);
      // Cobranças dos clientes do vendedor: só para quem abre Contas a Receber (módulo Financeiro).
      expect(cobrancasVendas, label(u)).toBe((u.role === "vendas" || u.departmentId === "vendas" || cu.isManager) && legacyCanAccessModule(legacy, "financeiro"));
      // Correção deliberada: o bloco só aparece para quem abre a tela de onde o dado vem (antes aparecia para todos,
      // vazio ou com links para telas negadas — ex.: Contratos para Marketing/Implantação/CS/Suporte).
      expect(contratos, label(u)).toBe(legacyCanAccessModule(legacy, "financeiro"));
      expect(followups, label(u)).toBe(legacyCanAccessModule(legacy, "vendas"));
      expect(visitas, label(u)).toBe(legacyCanAccessModule(legacy, "vendas"));
      expect(Object.values(rest).every(Boolean), label(u)).toBe(true);
    }
  });

  it("Meu Dia: negar o módulo de origem no perfil tira os cards e blocos dele (ex.: Performance para o Financeiro)", () => {
    const analyst = ALL_USERS.find((u) => u.id === "user_anapaula")!;
    const denied = asCurrentUser(analyst, { roleProfile: { grants: { "performance.acessar": false }, scopes: {} } });
    expect(meuDiaSections(asCurrentUser(analyst)).metas).toBe(true);
    expect(meuDiaSections(denied).metas).toBe(false);
  });

  it("escopos padrão: Clientes e Workflow = empresa; SLA = empresa para gestores e departamento para os demais", () => {
    for (const u of SUBJECTS) {
      const manager = u.role === "admin" || u.role === "diretoria" || u.role === "gestor";
      expect(defaultScopeKind(u, "operacao.clientes"), label(u)).toBe("empresa");
      expect(defaultScopeKind(u, "operacao.workflow"), label(u)).toBe("empresa");
      expect(defaultScopeKind(u, "operacao.sla"), label(u)).toBe(manager ? "empresa" : "departamento");
      if (!manager) expect([...(computeDataScope(u, "operacao.sla", "departamento", { users: [], departments: SEED_DEPARTMENTS }).departmentKeys ?? [])], label(u)).toEqual([u.departmentId]);
    }
  });

  it("chaves de seção da ficha existem no catálogo", () => {
    for (const key of Object.values(CLIENT_SECTION_KEYS)) expect(NODE_BY_KEY.has(key), key).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// Escopo por registro (T7/T8) com banco em memória
// ---------------------------------------------------------------------------
const iso = "2026-01-01T00:00:00.000Z";
const base = { organizationId: "intercert", createdAt: iso, updatedAt: iso };

function seedStore() {
  store.data = new Map<string, Record<string, unknown>[]>([
    ["users", SUBJECTS.map((u) => ({ ...base, id: u.id, name: u.name, email: `${u.id}@t`, role: u.role, departmentId: u.departmentId, managerId: u.managerId, active: true }))],
    ["departments", SEED_DEPARTMENTS.map((d) => ({ ...base, id: `dept_${d.key}`, key: d.key, managerId: d.managerId, name: d.key, order: 1 }))],
    [
      "clients",
      [
        { ...base, id: "cli_vinicius", tradeName: "Cliente do Vinícius", ownerSalesId: "user_vinicius" },
        { ...base, id: "cli_outro", tradeName: "Cliente de outro", ownerSalesId: "user_igor", ownerCsId: "user_camila" },
      ],
    ],
    [
      "workflow_steps",
      [
        { ...base, id: "wfs_cs", instanceId: "wfi_1", assigneeId: "user_camila", department: "cs", status: "em_andamento" },
        { ...base, id: "wfs_vendas", instanceId: "wfi_2", assigneeId: "user_vinicius", department: "vendas", status: "em_andamento" },
      ],
    ],
  ]);
}

/** Usuário com escopo ajustado por exceção individual (como o CEO/CTO configuraria). */
const withScopes = (u: FixtureUser, scopes: Record<string, string>, grants: Record<string, boolean> = {}) =>
  asCurrentUser(u, { userOverride: { scopes: scopes as never, grants } });

describe("escopo por registro (Clientes, Tarefas, Workflow)", () => {
  beforeEach(seedStore);
  const vinicius = byId("user_vinicius");

  it("Clientes 360º: padrão empresa vê qualquer cliente; com 'meus' só os dele (T8)", async () => {
    expect(await canSeeClient(asCurrentUser(vinicius), { ownerSalesId: "user_igor" })).toBe(true);
    const restricted = withScopes(vinicius, { "operacao.clientes": "meus" });
    expect(await canSeeClient(restricted, { ownerSalesId: "user_vinicius" })).toBe(true);
    expect(await canSeeClient(restricted, { ownerSalesId: "user_igor", ownerCsId: "user_camila" })).toBe(false);
    expect(await canSeeClientId(restricted, "cli_outro")).toBe(false);
    expect(await canSeeClientId(restricted, "cli_vinicius")).toBe(true);
  });

  it("Clientes 360º: tela negada nega qualquer registro", async () => {
    const denied = withScopes(vinicius, {}, { "operacao.clientes.ver": false });
    expect(await canSeeClientId(denied, "cli_vinicius")).toBe(false);
  });

  it("Tarefas: departamento + vínculos (responsável/criador) + cliente visível; fora disso, acesso negado", async () => {
    const cu = asCurrentUser(vinicius);
    const other = { assigneeId: "user_camila", creatorId: "user_felipe", departmentId: "cs" as const };
    expect(await canSeeTask(cu, other)).toBe(false);
    expect(await canSeeTask(cu, { ...other, departmentId: "vendas" })).toBe(true);
    expect(await canSeeTask(cu, { ...other, creatorId: "user_vinicius" })).toBe(true);
    expect(await canSeeTask(cu, { ...other, clientId: "cli_outro" })).toBe(true);
    const restricted = withScopes(vinicius, { "operacao.clientes": "meus" });
    expect(await canSeeTask(restricted, { ...other, clientId: "cli_outro" })).toBe(false);
    expect(await canSeeTask(restricted, { ...other, clientId: "cli_vinicius" })).toBe(true);
    // Gestor: empresa.
    expect(await canSeeTask(asCurrentUser(byId("user_igor")), other)).toBe(true);
  });

  it("Tarefas: tela negada (URL/action direta) nega até a própria tarefa (T6/T7)", async () => {
    const denied = withScopes(vinicius, {}, { "operacao.tarefas.ver": false });
    expect(await canSeeTask(denied, { assigneeId: "user_vinicius", creatorId: "user_vinicius", departmentId: "vendas" })).toBe(false);
    const caps = taskCapabilities(withScopes(vinicius, {}, { "operacao.tarefas.editar": false }));
    expect(caps.edit).toBe(false);
    expect(caps.complete).toBe(true);
  });

  it("Workflow: padrão empresa; com 'meus' só as etapas/jornadas do próprio usuário", async () => {
    expect(await canSeeStep(asCurrentUser(vinicius), { assigneeId: "user_camila", department: "cs" })).toBe(true);
    const restricted = withScopes(vinicius, { "operacao.workflow": "meus" });
    expect(await canSeeStep(restricted, { assigneeId: "user_camila", department: "cs" })).toBe(false);
    expect(await canSeeStepId(restricted, "wfs_cs")).toBe(false);
    expect(await canSeeStepId(restricted, "wfs_vendas")).toBe(true);
    expect(await canSeeInstance(restricted, "wfi_1")).toBe(false);
    expect(await canSeeInstance(restricted, "wfi_2")).toBe(true);
  });
});

// Garante que as chaves literais usadas acima existem (erro de digitação vira falha, não "negado").
describe("chaves usadas nos testes", () => {
  it("existem no catálogo", () => {
    const keys: PermissionKey[] = ["operacao.clientes.ver", "operacao.tarefas.ver", "operacao.tarefas.editar", "operacao.workflow.ver"];
    for (const k of keys) expect(NODE_BY_KEY.has(k), k).toBe(true);
  });
});
