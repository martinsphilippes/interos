/**
 * Guardas do trilho B — Implantação: cobertura real das páginas e actions (verificador A15), mapeamento função →
 * chave do catálogo (inclusive a chave extra "checkedIn" do go-live, A22), capacidades e seções padrão ≡
 * comportamento anterior (requireOperator/canOperateImplementation; go-live configurar = isManager), escopos padrão
 * (empresa), escopo por registro com banco em memória (T8: projeto/tarefa/treinamento de outro responsável → negado;
 * a visão ?escopo= nunca amplia o limite) e detalhe do projeto sem ler seções negadas nem valores (A13).
 */
import { readFileSync } from "node:fs";
import path from "node:path";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { SCREENS, type PermissionKey, type ScreenKey } from "@/domain/permissions";
import { defaultScopeKind } from "@/server/auth/scope";
import { PermissionError } from "@/server/auth/errors";
import { NO_IMPLEMENTATION_CAPABILITIES } from "@/components/implementation/access-model";
import { asCurrentUser, ALL_USERS, SEED_USERS, SYNTHETIC_USERS, label, type FixtureUser } from "./fixtures";
import { legacyCanAccessModule, legacyCanOperateImplementation, legacyUser } from "./legacy";

// ---------------------------------------------------------------------------
// Banco em memória (mesmo padrão de guards-financeiro-contratos.test.ts)
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
const access = await import("@/server/implementation/access");
const queries = await import("@/server/implementation/queries");
const { canApproveGoLive } = await import("@/server/implementation/service");

const ROOT = path.resolve(__dirname, "../..");
const SCOPE_PATHS = /^src\/app\/\(app\)\/implantacao\/|^src\/server\/implementation\/|^src\/components\/implementation\//;
const ACTIONS_FILE = "src/server/implementation/actions.ts";
const SCREENS_WITH_SCOPE: ScreenKey[] = ["implantacao.projetos", "implantacao.kanban", "implantacao.treinamentos", "implantacao.go-live"];
const SUBJECTS = [...SEED_USERS, ...SYNTHETIC_USERS];
const byId = (id: string) => SEED_USERS.find((u) => u.id === id)!;
const inModule = (u: FixtureUser) => legacyCanAccessModule(legacyUser(u), "implantacao");
const operates = (u: FixtureUser) => inModule(u) && legacyCanOperateImplementation(legacyUser(u));
const isManager = (u: Pick<FixtureUser, "role">) => u.role === "gestor" || u.role === "admin" || u.role === "diretoria";

// ---------------------------------------------------------------------------
// Cobertura (A15) no repositório real
// ---------------------------------------------------------------------------
describe("cobertura do trilho B (verificador de acesso) — Implantação", () => {
  it("nenhuma pendência em páginas, actions e guards do escopo", () => {
    const report = analyzeAccess(ROOT);
    expect(report.findings.filter((f) => SCOPE_PATHS.test(f.target))).toEqual([]);
  });

  it("as 6 páginas exigem a tela dona da rota", () => {
    const pages: [string, string][] = [
      ["page.tsx", "implantacao.projetos"],
      ["[projectId]/page.tsx", "implantacao.projetos"],
      ["kanban/page.tsx", "implantacao.kanban"],
      ["checklists/page.tsx", "implantacao.checklists"],
      ["treinamentos/page.tsx", "implantacao.treinamentos"],
      ["go-live/page.tsx", "implantacao.go-live"],
    ];
    for (const [file, screen] of pages) {
      const source = readFileSync(path.join(ROOT, "src/app/(app)/implantacao", file), "utf8");
      expect(source, file).toContain(`requireScreen("${screen}")`);
      expect(source, file).not.toMatch(/canAccessModule|requireUser|canOperateImplementation/);
    }
  });
});

// ---------------------------------------------------------------------------
// Função → chave (actions.ts ≡ catálogo)
// ---------------------------------------------------------------------------
describe("actions da Implantação: a primeira chave exigida é a dona no catálogo", () => {
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

  it("todas as 22 funções exportadas têm dono e o exigem antes de qualquer leitura", () => {
    expect(functions.length).toBe(22);
    expect(owners.size).toBe(22);
    for (const fn of functions) {
      const required = [...fn.body.matchAll(/requirePermission\("([^"]+)"/g)].map((m) => m[1]);
      expect(owners.get(fn.name), fn.name).toBeDefined();
      expect(owners.get(fn.name)!.has(required[0]), `${fn.name}: ${required[0]}`).toBe(true);
      // requirePermission vem antes do parse, do escopo e do serviço.
      expect(fn.body.indexOf("requirePermission("), fn.name).toBeLessThan(fn.body.indexOf(".parse("));
    }
  });

  it("modelo: com id exige editar, sem id exige criar (antes da validação)", () => {
    expect(body("saveImplementationTemplate")).toMatch(
      /templateIdOf\(input\) \? await requirePermission\("implantacao\.checklists\.editar"\) : await requirePermission\("implantacao\.checklists\.criar"\)/,
    );
  });

  it("checkedIn (A22): aprovar go-live sem ser o responsável ou com 'exige gestor' exige aprovar-qualquer", () => {
    expect(body("approveProjectGoLive")).toMatch(/if \(settings\.exigeAprovacaoGestor \|\| project\.ownerId !== user\.id\) \{\s*await requirePermission\("implantacao\.go-live\.aprovar-qualquer"/);
  });

  it("não sobra guarda local nem fail() com lista negra própria", () => {
    expect(source).not.toMatch(/requireOperator|canOperateImplementation|canAccessModule|requireUser|isManager\)/);
    expect(source).toMatch(/return failAction\(error, fallback, "implantacao"\)/);
  });

  it("actions sobre um registro conferem o escopo (projeto, tarefa ou treinamento)", () => {
    const unscoped = ["updateGoLiveSettings", "saveImplementationTemplate", "toggleImplementationTemplate"];
    for (const fn of functions) {
      if (unscoped.includes(fn.name)) continue;
      expect(/assert(Project|Task|Training)Access\(user/.test(fn.body), fn.name).toBe(true);
    }
  });
});

// ---------------------------------------------------------------------------
// Padrão = comportamento anterior
// ---------------------------------------------------------------------------
describe("capacidades e seções padrão ≡ comportamento anterior", () => {
  it("operações ≡ módulo ∧ canOperateImplementation (requireOperator); configurar go-live ≡ isManager", () => {
    for (const u of ALL_USERS) {
      const { configureGoLive, ...ops } = access.implementationCapabilities(asCurrentUser(u));
      for (const [k, v] of Object.entries(ops)) expect(v, `${label(u)} ${k}`).toBe(operates(u));
      // Antes: requireUser + isManager (sem módulo). A14: exige o módulo — todo gestor/diretoria/admin o tem.
      expect(configureGoLive, label(u)).toBe(isManager(u));
      expect(isManager(u) && !inModule(u), label(u)).toBe(false);
    }
  });

  it("seções (abas, indicadores, dados da venda, sugestões, regra do go-live) para todos com o módulo", () => {
    const sections = SCREENS.filter((s) => s.module === "implantacao").flatMap((s) => s.sections.map((x) => x.key as PermissionKey));
    expect(sections.length).toBe(11);
    for (const u of ALL_USERS) {
      const cu = asCurrentUser(u);
      for (const key of sections) expect(cu.permissions.has(key), `${label(u)} ${key}`).toBe(inModule(u));
      for (const v of Object.values(access.projectSections(cu))) expect(v, label(u)).toBe(inModule(u));
    }
  });

  it("aprovar go-live (helper único, A22) ≡ isManager ∨ (regra permite ∧ responsável)", () => {
    const project = { ownerId: "user_marcos" };
    for (const u of ALL_USERS) {
      const cu = asCurrentUser(u);
      for (const exige of [true, false]) {
        const before = isManager(u) || (!exige && u.id === project.ownerId);
        expect(canApproveGoLive(project, cu, { exigeAprovacaoGestor: exige }), `${label(u)} exige=${exige}`).toBe(before);
      }
    }
  });

  it("escopos padrão: empresa nas telas com escopo (antes: 'todos' aceito de qualquer usuário)", () => {
    for (const u of SUBJECTS) for (const screen of SCREENS_WITH_SCOPE) expect(defaultScopeKind(u, screen), `${label(u)} ${screen}`).toBe("empresa");
  });

  it("sem provedor, nada liberado", () => {
    expect(Object.values(NO_IMPLEMENTATION_CAPABILITIES).some(Boolean)).toBe(false);
    expect(Object.keys(NO_IMPLEMENTATION_CAPABILITIES).sort()).toEqual(Object.keys(access.IMPLEMENTATION_CAPABILITY_KEYS).sort());
  });
});

// ---------------------------------------------------------------------------
// Ajustes do CEO/CTO
// ---------------------------------------------------------------------------
describe("ajustes do CEO/CTO refletem nas capacidades", () => {
  const marcos = byId("user_marcos");
  const lando = byId("user_lando");

  it("visualizar sem editar: negar ações some com os botões, a tela e as abas continuam", () => {
    const cu = asCurrentUser(marcos, { userOverride: { grants: { "implantacao.projetos.plano.concluir": false, "implantacao.kanban.editar": false, "implantacao.go-live.aprovar": false } } });
    const caps = access.implementationCapabilities(cu);
    expect(caps.completeTask).toBe(false);
    expect(caps.movePhase).toBe(false);
    expect(caps.approveGoLive).toBe(false);
    expect(caps.addTask).toBe(true);
    expect(access.projectSections(cu).plan).toBe(true);
    expect(cu.permissions.has("implantacao.kanban.ver")).toBe(true);
  });

  it("aba negada: a seção some sem afetar as outras", () => {
    const cu = asCurrentUser(marcos, { userOverride: { grants: { "implantacao.projetos.historico.ver": false, "implantacao.projetos.dados-da-venda.ver": false } } });
    const sections = access.projectSections(cu);
    expect(sections.history).toBe(false);
    expect(sections.saleData).toBe(false);
    expect(sections.plan && sections.goLive && sections.documents).toBe(true);
  });

  it("gestor sem 'aprovar qualquer': só aprova como responsável e com a regra que permite", () => {
    const cu = asCurrentUser(lando, { userOverride: { grants: { "implantacao.go-live.aprovar-qualquer": false } } });
    expect(canApproveGoLive({ ownerId: "user_marcos" }, cu, { exigeAprovacaoGestor: false })).toBe(false);
    expect(canApproveGoLive({ ownerId: lando.id }, cu, { exigeAprovacaoGestor: false })).toBe(true);
    expect(canApproveGoLive({ ownerId: lando.id }, cu, { exigeAprovacaoGestor: true })).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// Escopo por registro e listas com banco em memória (T8)
// ---------------------------------------------------------------------------
const iso = "2026-01-01T00:00:00.000Z";
const base = { organizationId: "intercert", createdAt: iso, updatedAt: iso };
const project = (id: string, ownerId: string, extra: Record<string, unknown> = {}) => ({
  ...base,
  id,
  name: `Projeto ${id}`,
  clientId: "cli_1",
  productIds: [],
  ownerId,
  teamIds: [],
  status: "em_implantacao",
  currentPhase: "kickoff",
  progress: 10,
  dueDate: "2026-12-31T00:00:00.000Z",
  checklist: [],
  ...extra,
});

function seedStore() {
  store.reads = [];
  store.data = new Map<string, Record<string, unknown>[]>([
    ["users", SUBJECTS.map((u) => ({ ...base, id: u.id, name: u.name, role: u.role, departmentId: u.departmentId, managerId: u.managerId, active: true }))],
    ["departments", []],
    ["clients", [{ ...base, id: "cli_1", tradeName: "Cliente 1", legalName: "Cliente 1 Ltda", status: "em_implantacao" }]],
    [
      "implementation_projects",
      [
        project("prj_marcos", "user_marcos"),
        project("prj_bruno", "user_bruno"),
        project("prj_bruno_time", "user_bruno", { teamIds: ["user_marcos"] }),
        project("prj_venda", "user_bruno", {
          contractId: "ctr_1",
          saleSnapshot: { items: [{ productId: "p1", productName: "Produto", quantity: 1, setupValue: 900, monthlyValue: 300, hardwareValue: 0 }], monthlyTotal: 300, setupTotal: 900, hardwareTotal: 0, capturedAt: iso },
        }),
      ],
    ],
    ["implementation_tasks", [{ ...base, id: "tsk_bruno", projectId: "prj_bruno", clientId: "cli_1", title: "Tarefa", phase: "kickoff", status: "aberta", required: true }]],
    [
      "trainings",
      [
        { ...base, id: "trn_bruno", projectId: "prj_bruno", clientId: "cli_1", subject: "Treino", instructorId: "user_bruno", status: "agendado", scheduledAt: iso, participants: [] },
        { ...base, id: "trn_marcos_instrutor", projectId: "prj_bruno", clientId: "cli_1", subject: "Treino 2", instructorId: "user_marcos", status: "agendado", scheduledAt: iso, participants: [] },
      ],
    ],
    [
      "contracts",
      [{ ...base, id: "ctr_1", clientId: "cli_1", number: "CT-1", version: 1, status: "ativo", items: [{ productId: "p1", productName: "Produto", quantity: 1, setupValue: 900, monthlyValue: 300, hardwareValue: 0 }], setupTotal: 900, monthlyTotal: 300, hardwareTotal: 0, billingDay: 10, recurrence: "mensal", termMonths: 12, signers: [], financialStatus: "liberado", documentIds: [] }],
    ],
    ["documents", [{ ...base, id: "doc_1", entityType: "project", entityId: "prj_venda", name: "Termo", url: "https://exemplo.test/termo", uploadedBy: "user_bruno" }]],
    ["timeline_events", [{ ...base, id: "tl_1", clientId: "cli_1", occurredAt: iso, title: "Evento" }]],
    ["support_tickets", []],
    ["settings", []],
  ]);
}

describe("escopo por registro (T8) e listas — banco em memória", () => {
  const marcos = byId("user_marcos");
  const meus = { userOverride: { scopes: { "implantacao.projetos": "meus" as const } } };
  beforeEach(seedStore);

  it("padrão (empresa): a action não lê o registro para decidir", async () => {
    const cu = asCurrentUser(marcos);
    await access.assertProjectAccess(cu, "prj_bruno");
    await access.assertTaskAccess(cu, "tsk_bruno");
    await access.assertTrainingAccess(cu, "trn_bruno");
    expect(store.reads).toEqual([]);
  });

  it("escopo 'meus': projeto de outro responsável → PermissionError; o próprio e o da equipe passam", async () => {
    const cu = asCurrentUser(marcos, meus);
    await expect(access.assertProjectAccess(cu, "prj_bruno")).rejects.toBeInstanceOf(PermissionError);
    await expect(access.assertProjectAccess(cu, "prj_bruno", "implantacao.kanban")).rejects.toBeInstanceOf(PermissionError);
    await expect(access.assertProjectAccess(cu, "prj_bruno", "implantacao.go-live")).rejects.toBeInstanceOf(PermissionError);
    await expect(access.assertProjectAccess(cu, "prj_marcos")).resolves.toBeUndefined();
    await expect(access.assertProjectAccess(cu, "prj_bruno_time")).resolves.toBeUndefined();
  });

  it("escopo 'meus': tarefa de projeto alheio → negado; treinamento em que é instrutor → permitido", async () => {
    const cu = asCurrentUser(marcos, meus);
    await expect(access.assertTaskAccess(cu, "tsk_bruno")).rejects.toBeInstanceOf(PermissionError);
    await expect(access.assertTrainingAccess(cu, "trn_bruno")).rejects.toBeInstanceOf(PermissionError);
    await expect(access.assertTrainingAccess(cu, "trn_marcos_instrutor")).resolves.toBeUndefined();
  });

  it("detalhe por id: canSeeProject respeita tela e escopo", async () => {
    expect(await access.canSeeProject(asCurrentUser(marcos), project("x", "user_bruno"))).toBe(true);
    expect(await access.canSeeProject(asCurrentUser(marcos, meus), project("x", "user_bruno"))).toBe(false);
    const semTela = asCurrentUser(marcos, { userOverride: { grants: { "implantacao.projetos.ver": false } } });
    expect(await access.canSeeProject(semTela, project("x", "user_marcos"))).toBe(false);
  });

  it("listas: a visão 'todos' (ou 'equipe') nunca amplia o limite da tela", async () => {
    const cu = asCurrentUser(marcos, meus);
    const all = await queries.listProjects(cu, { scope: "todos" });
    expect(all.rows.map((r) => r.id).sort()).toEqual(["prj_bruno_time", "prj_marcos"]);
    expect(all.scope.label).toBe("Todos do seu acesso");
    const kanban = await queries.listKanbanProjects(cu, "todos");
    expect(kanban.rows.map((r) => r.id).sort()).toEqual(["prj_bruno_time", "prj_marcos"]);
    const options = await queries.listFilterOptions(cu);
    expect(options.owners.map((o) => o.id).sort()).toEqual(["user_bruno", "user_marcos"]);
    const trainings = await queries.listTrainings(cu);
    expect(trainings.rows.map((t) => t.id)).toEqual(["trn_marcos_instrutor"]);
    expect(trainings.projects.map((p) => p.id).sort()).toEqual(["prj_bruno_time", "prj_marcos"]);
    // Padrão: tudo, como antes.
    expect((await queries.listProjects(asCurrentUser(marcos), { scope: "todos" })).rows).toHaveLength(4);
    expect((await queries.listTrainings(asCurrentUser(marcos))).rows).toHaveLength(2);
  });

  it("Cliente 360: com o usuário, projetos fora do escopo (e seus treinamentos) não entram", async () => {
    const semRecorte = await queries.getClientImplementation("cli_1");
    expect(semRecorte.projects).toHaveLength(4);
    const recortado = await queries.getClientImplementation("cli_1", asCurrentUser(marcos, meus));
    expect(recortado.projects.map((p) => p.id).sort()).toEqual(["prj_bruno_time", "prj_marcos"]);
    expect(recortado.trainings.map((t) => t.id)).toEqual(["trn_marcos_instrutor"]);
  });

  it("detalhe: seções negadas não são lidas e, sem 'Visualizar valores', a venda sai sem números", async () => {
    const full = await queries.getProject("prj_venda");
    expect(full?.documents).toHaveLength(1);
    expect(full?.sale?.summary.monthlyTotal).toBe(300);
    store.reads = [];
    const restricted = await queries.getProject("prj_venda", { include: { documents: false, history: false }, hideValues: true });
    expect(store.reads.some((r) => r === "list:documents" || r === "list:timeline_events" || r === "list:support_tickets")).toBe(false);
    expect(restricted?.documents).toEqual([]);
    expect(restricted?.events).toEqual([]);
    expect(restricted?.sale?.summary.valuesHidden).toBe(true);
    expect(restricted?.sale?.summary.monthlyTotal).toBe(0);
    expect(restricted?.sale?.snapshot.items[0].monthlyValue).toBe(0);
    expect(restricted?.sale?.snapshot.setupTotal).toBe(0);
    const noSale = await queries.getProject("prj_venda", { include: { sale: false } });
    expect(noSale?.sale).toBeNull();
  });
});
