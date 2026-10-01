/**
 * Guardas do trilho B — Financeiro (Comissões e Contas a Pagar): cobertura real das páginas e actions (verificador
 * A15), mapeamento função → chave do catálogo (inclusive as chaves extras "checkedIn"), capacidades padrão ≡
 * predicados anteriores (isFinanceTeam/isFinanceManager, cópia congelada em legacy.ts), visibilidade padrão ≡ o antigo
 * resolveCommissionScope (equipe financeira = todas; gestor = ele + getPerformanceAccess; demais = próprias), seções
 * Minhas × Todas e escopo configurado, e asserções por registro (T4/T8) com banco em memória.
 */
import { readFileSync } from "node:fs";
import path from "node:path";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { SCREENS } from "@/domain/permissions";
import { BusinessError, PermissionError } from "@/server/auth/errors";
import type { Commission, Payable, User } from "@/domain/types";
import { asCurrentUser, ALL_USERS, SEED_DEPARTMENTS, SEED_USERS, SYNTHETIC_USERS, label, type FixtureUser } from "./fixtures";
import { legacyCanAccessModule, legacyIsFinanceManager, legacyIsFinanceTeam, legacyScreenAccess, legacyUser } from "./legacy";

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
    if (op === "in") return (value as unknown[]).includes(v);
    return false;
  };
  const list = async (name: string, options: { where?: [string, string, unknown][] } = {}) => rows(name).filter((r) => (options.where ?? []).every((w) => match(r, w)));
  const getById = async (name: string, id: string) => rows(name).find((r) => r.id === id) ?? null;
  const getManyByIds = async (name: string, ids: string[]) => new Map(rows(name).filter((r) => ids.includes(r.id as string)).map((r) => [r.id as string, r]));
  const fail = async () => {
    throw new Error("escrita não esperada no teste de guardas");
  };
  return { ORG_ID: "intercert", nowIso: () => "2026-09-30T12:00:00.000Z", list, getById, getManyByIds, create: fail, update: fail, remove: fail, batchSet: fail, newId: () => "novo", stripUndefined: <T>(v: T) => v, counterId: () => "c", clearCollection: fail };
});

const { analyzeAccess } = await import("../../scripts/check-access/analyze");
const access = await import("@/server/commissions/access");
const { resolveCommissionScope } = await import("@/server/commissions/queries");
const { canViewAllCommissions, canApprovePayables, canOperatePayables, canViewPayables } = await import("@/server/commissions/permissions");
const { getPerformanceAccess } = await import("@/server/performance/queries");

const ROOT = path.resolve(__dirname, "../..");
const SCOPE_PATHS = /^src\/app\/\(app\)\/financeiro\/(comissoes|contas-a-pagar)\/|^src\/server\/commissions\/|^src\/components\/commissions\/|^src\/components\/performance\/my-commissions/;
const ACTIONS_FILE = "src/server/commissions/actions.ts";

// ---------------------------------------------------------------------------
// Organização de teste: seed + sintéticos (+ um inativo); uma comissão e um título por pessoa, um título de fornecedor
// ---------------------------------------------------------------------------
const iso = "2026-01-01T00:00:00.000Z";
const inactive: FixtureUser = { id: "user_inativo", name: "Inativo", role: "vendas", departmentId: "vendas", managerId: "user_igor", active: false, kind: "sintetico" };
const PEOPLE: FixtureUser[] = [...SEED_USERS, ...SYNTHETIC_USERS, inactive];
const SUBJECTS = PEOPLE.filter((u) => u.active);
const base = { organizationId: "intercert", createdAt: iso, updatedAt: iso };
const USERS = PEOPLE.map((u) => ({ ...base, id: u.id, name: u.name, email: `${u.id}@t`, role: u.role, departmentId: u.departmentId, managerId: u.managerId, active: u.active }) as unknown as User);
const COMMISSIONS = PEOPLE.map((u) => ({ ...base, id: `com_${u.id}`, code: `COM-${u.id}`, userId: u.id, clientId: "cli_1", status: "prevista", amount: 10, baseAmount: 100, competence: "2026-09", revenueType: "setup" }) as unknown as Commission);
const PAYABLES = [
  ...PEOPLE.map((u) => ({ ...base, id: `pag_${u.id}`, creditorId: u.id, creditorName: u.name, origin: "comissao_automatica", status: "previsto", amount: 10 }) as unknown as Payable),
  { ...base, id: "pag_fornecedor", creditorName: "Fornecedor", supplierId: "sup_1", origin: "manual", status: "previsto", amount: 50 } as unknown as Payable,
];

beforeEach(() => {
  const departments = SEED_DEPARTMENTS.map((d) => ({ ...d, ...base, id: `dept_${d.key}`, name: d.key, order: 1 }));
  store.data = new Map<string, Record<string, unknown>[]>([
    ["users", USERS as unknown as Record<string, unknown>[]],
    ["departments", departments],
    ["commissions", COMMISSIONS as unknown as Record<string, unknown>[]],
    ["payables", PAYABLES as unknown as Record<string, unknown>[]],
  ]);
});

const sorted = (ids: Iterable<string>) => [...new Set(ids)].sort();
const ALL_IDS = sorted(PEOPLE.map((u) => u.id));
const isManager = (u: Pick<FixtureUser, "role">) => u.role === "gestor" || u.role === "admin" || u.role === "diretoria";

/** O antigo resolveCommissionScope (commissions/queries.ts antes do catálogo): null = todas. */
async function legacyCommissionOwners(u: FixtureUser): Promise<string[] | null> {
  if (legacyIsFinanceTeam(legacyUser(u))) return null;
  if (!isManager(u)) return [u.id];
  const team = await getPerformanceAccess(asCurrentUser(u));
  return sorted([u.id, ...team.userIds]);
}

// ---------------------------------------------------------------------------
// Cobertura (A15) no repositório real
// ---------------------------------------------------------------------------
describe("cobertura do trilho B (verificador de acesso) — Comissões e Contas a Pagar", () => {
  it("nenhuma pendência em páginas, actions e guards do escopo", () => {
    const report = analyzeAccess(ROOT);
    expect(report.findings.filter((f) => SCOPE_PATHS.test(f.target))).toEqual([]);
  });
});

// ---------------------------------------------------------------------------
// Função → chave (actions.ts ≡ catálogo)
// ---------------------------------------------------------------------------
describe("actions de Comissões e Contas a Pagar: a primeira chave exigida é a dona no catálogo", () => {
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

  // Etapa CP/CR 2: + undoPayablePaymentAction (desfazer pagamento).
  it("todas as 17 funções exportadas têm dono e o exigem antes da validação, do escopo e do serviço", () => {
    expect(functions.length).toBe(17);
    for (const fn of functions) {
      const keys = [...fn.body.matchAll(/requirePermission\("([^"]+)"\)/g)].map((m) => m[1]);
      expect(keys.length, fn.name).toBeGreaterThan(0);
      expect(owners.get(fn.name)?.has(keys[0]), `${fn.name} → ${keys[0]}`).toBe(true);
      expect(fn.body.indexOf("requirePermission("), fn.name).toBeLessThan(fn.body.indexOf(".parse("));
    }
  });

  it("fornecedor: com id = editar, sem id = cadastrar (escolha pelo argumento)", () => {
    expect(body("saveSupplierAction")).toMatch(/rawId\(input\) \? await requirePermission\("financeiro\.contas-a-pagar\.fornecedores\.editar"\) : await requirePermission\("financeiro\.contas-a-pagar\.fornecedores\.criar"\)/);
    expect(body("saveSupplierAction")).toMatch(/can\(user, "financeiro\.contas-a-pagar\.fornecedores\.ativar"\)/);
  });

  it("checkedIn: exceção por contrato e título de comissão exigem a chave extra", () => {
    expect(body("saveCommissionRuleAction")).toMatch(/data\.scope === "contrato" \|\| \(existing && ruleScope\(existing\) === "contrato"\)\) await requirePermission\("financeiro\.comissoes\.regras\.criar-excecao"/);
    expect(body("saveCommissionRuleAction")).toMatch(/can\(user, "financeiro\.comissoes\.regras\.ativar"\)/);
    expect(body("setCommissionRuleActiveAction")).toMatch(/ruleScope\(existing\) === "contrato"\) await requirePermission\("financeiro\.comissoes\.regras\.criar-excecao"/);
    expect(body("approvePayableAction")).toMatch(/if \(isCommissionPayable\(payable\)\) await requirePermission\("financeiro\.comissoes\.aprovar"/);
  });

  it("actions sobre comissão ou título conferem o escopo do registro", () => {
    for (const name of ["reverseCommissionAction", "blockCommissionAction", "unblockCommissionAction", "regenerateCommissionPayableAction"]) expect(body(name), name).toMatch(/await assertCommissionAccess\(user, data\.commissionId\)/);
    for (const name of ["approvePayableAction", "schedulePayableAction", "payPayableAction", "cancelPayableAction", "updatePayableAction", "addPayableAttachmentAction"]) expect(body(name), name).toMatch(/assertPayableAccess\(user, data\.payableId\)/);
    expect(body("createManualPayableAction")).toMatch(/await assertCreditorInScope\(user, data\)/);
  });

  it("não sobra guarda local nem fail() que engula redirect", () => {
    expect(source).not.toMatch(/requireWith|requireUser|class PermissionError|canOperatePayables|canReverseCommission|canManageCommissionRules/);
    expect(source).toMatch(/return failAction\(error, fallback, "comissoes"\)/);
  });

  it("página de Comissões: sem as seções Minhas/Todas não lê as comissões", () => {
    const page = readFileSync(path.join(ROOT, "src/app/(app)/financeiro/comissoes/page.tsx"), "utf8");
    const check = page.indexOf('!can(user, "financeiro.comissoes.minhas.ver") && !can(user, "financeiro.comissoes.todas.ver")');
    expect(check).toBeGreaterThan(0);
    expect(check).toBeLessThan(page.indexOf("getCommissionsWorkspace(user"));
  });
});

// ---------------------------------------------------------------------------
// Padrão = comportamento anterior
// ---------------------------------------------------------------------------
describe("capacidades padrão ≡ comportamento anterior", () => {
  const financeScreen = (u: FixtureUser) => legacyScreenAccess(legacyUser(u), "financeiro.contas-a-pagar");
  const commissionScreen = (u: FixtureUser) => legacyCanAccessModule(legacyUser(u), "financeiro") || legacyCanAccessModule(legacyUser(u), "vendas");

  it("Contas a Pagar: aprovar/pagar ≡ isFinanceManager; operar e fluxo de caixa ≡ isFinanceTeam (na tela)", () => {
    for (const u of ALL_USERS) {
      const lu = legacyUser(u);
      const caps = access.payableCapabilities(asCurrentUser(u));
      const screen = financeScreen(u);
      expect(caps.approve, `${label(u)} aprovar`).toBe(screen && legacyIsFinanceManager(lu));
      expect(caps.approveCommission, `${label(u)} aprovar comissão`).toBe(caps.approve);
      expect(caps.pay, `${label(u)} pagar`).toBe(screen && legacyIsFinanceManager(lu));
      for (const k of ["schedule", "edit", "attach", "cancel", "create", "operate", "cashFlow"] as const) expect(caps[k], `${label(u)} ${k}`).toBe(screen && legacyIsFinanceTeam(lu));
      expect(caps.readOnly, label(u)).toBe(!(screen && legacyIsFinanceTeam(lu)));
      expect(caps.suppliers, `${label(u)} fornecedores`).toBe(screen);
    }
  });

  it("Comissões: estornar/bloquear/desbloquear/gerar título ≡ isFinanceManager (na tela)", () => {
    for (const u of ALL_USERS) {
      const caps = access.commissionCapabilities(asCurrentUser(u));
      const expected = commissionScreen(u) && legacyIsFinanceManager(legacyUser(u));
      for (const [k, v] of Object.entries(caps)) expect(v, `${label(u)} ${k}`).toBe(expected);
    }
  });

  it("fachadas: canViewAllCommissions ≡ tela ∧ isFinanceTeam; demais predicados seguem as chaves", () => {
    // "Todas as comissões" é seção da tela (catálogo: todas.ver ≡ página ∧ …, T0). Quem é da equipe financeira SEM a
    // tela (papel sem os módulos Financeiro/Vendas lotado no Financeiro) deixa de ver as de terceiros fora da tela
    // (relatório); nenhum no seed nem nos sintéticos.
    const diverging = ALL_USERS.filter((u) => legacyIsFinanceTeam(legacyUser(u)) && !commissionScreen(u)).map((u) => u.id);
    expect(diverging).toEqual(["combo_implantacao_financeiro", "combo_colaborador_financeiro"].filter((id) => diverging.includes(id)));
    expect(diverging.every((id) => id.startsWith("combo_"))).toBe(true);
    for (const u of ALL_USERS) {
      const cu = asCurrentUser(u);
      const expected = commissionScreen(u) && legacyIsFinanceTeam(legacyUser(u));
      expect(canViewAllCommissions(cu), label(u)).toBe(expected);
      // Sem permissions (Pick do usuário): matriz padrão do papel — mesmo resultado.
      const { permissions: _omit, ...plain } = cu;
      void _omit;
      expect(canViewAllCommissions(plain), label(u)).toBe(expected);
      expect(canApprovePayables(cu), label(u)).toBe(access.payableCapabilities(cu).approve);
      expect(canOperatePayables(cu), label(u)).toBe(access.payableCapabilities(cu).edit);
      expect(canViewPayables(cu), label(u)).toBe(financeScreen(u));
    }
  });
});

describe("visibilidade padrão ≡ antigo resolveCommissionScope", () => {
  it("comissões: equipe financeira = todas; gestor = ele + equipe (getPerformanceAccess); demais = próprias", async () => {
    for (const u of SUBJECTS) {
      const cu = asCurrentUser(u);
      const legacy = await legacyCommissionOwners(u);
      const vis = await access.commissionVisibility(cu);
      const visible = sorted(COMMISSIONS.filter((c) => access.commissionAllowed(vis, c.userId)).map((c) => c.userId));
      expect(visible, label(u)).toEqual(legacy ?? ALL_IDS);
      const scope = await resolveCommissionScope(cu);
      expect(scope.kind, label(u)).toBe(legacy === null ? "all" : isManager(u) ? "team" : "own");
      if (scope.kind !== "all") expect(sorted(scope.userIds), label(u)).toEqual(legacy);
    }
  });

  it("contas a pagar: equipe financeira = todos os títulos (inclusive fornecedor); gestor = credores da equipe", async () => {
    for (const u of SUBJECTS) {
      const cu = asCurrentUser(u);
      if (!cu.permissions.has("financeiro.contas-a-pagar.ver")) continue;
      const legacy = await legacyCommissionOwners(u);
      const vis = await access.payableVisibility(cu);
      const visible = sorted(PAYABLES.filter((p) => access.payableAllowed(vis, p)).map((p) => p.id));
      const expected = sorted(PAYABLES.filter((p) => legacy === null || (p.creditorId && legacy.includes(p.creditorId))).map((p) => p.id));
      expect(visible, label(u)).toEqual(expected);
    }
  });
});

// ---------------------------------------------------------------------------
// Seções Minhas × Todas e escopo configurado
// ---------------------------------------------------------------------------
describe("seções Minhas × Todas e escopo configurado pelo CEO/CTO", () => {
  const vendedor = SEED_USERS.find((u) => u.role === "vendas" && u.departmentId === "vendas")!;
  const financeiro = SEED_USERS.find((u) => u.role === "financeiro")!;

  it("puro: sem Todas → só as próprias; sem as duas → nenhuma; Todas sem Minhas → terceiros sem as próprias", () => {
    const empresa = { kind: "empresa" as const };
    expect(access.buildCommissionVisibility("a", { own: true, all: false }, null)).toMatchObject({ kind: "own", ownerIds: new Set(["a"]) });
    expect(access.buildCommissionVisibility("a", { own: false, all: false }, null)).toMatchObject({ kind: "none", ownerIds: new Set() });
    const others = access.buildCommissionVisibility("a", { own: false, all: true }, empresa);
    expect(others).toMatchObject({ kind: "all", ownerIds: null, excludeSelf: true });
    expect(access.commissionAllowed(others, "a")).toBe(false);
    expect(access.commissionAllowed(others, "b")).toBe(true);
    const team = access.buildCommissionVisibility("a", { own: true, all: true }, { kind: "departamento", userIds: new Set(["a"]), departmentKeys: new Set(["vendas"]) }, [
      { id: "b", departmentId: "vendas", active: true },
      { id: "c", departmentId: "cs", active: true },
      { id: "d", departmentId: "vendas", active: false },
    ]);
    expect(team.kind).toBe("team");
    expect(sorted(team.ownerIds!)).toEqual(["a", "b"]);
    expect(access.buildCommissionVisibility("a", { own: true, all: true }, { kind: "meus", userIds: new Set(["a"]) }).kind).toBe("own");
  });

  it("vendedor com exceção 'Todas' + escopo empresa passa a ver as de todos", async () => {
    const cu = asCurrentUser(vendedor, { userOverride: { grants: { "financeiro.comissoes.todas.ver": true }, scopes: { "financeiro.comissoes": "empresa" } } });
    const vis = await access.commissionVisibility(cu);
    expect(vis.kind).toBe("all");
    expect((await resolveCommissionScope(cu)).kind).toBe("all");
  });

  it("financeiro com escopo 'meus' vê só as próprias; sem 'Minhas' e sem 'Todas', nenhuma", async () => {
    const meus = asCurrentUser(financeiro, { userOverride: { scopes: { "financeiro.comissoes": "meus" } } });
    expect(sorted(COMMISSIONS.filter((c) => access.commissionAllowed(access.buildCommissionVisibility(meus.id, { own: true, all: true }, { kind: "meus", userIds: new Set([meus.id]) }), c.userId)).map((c) => c.userId))).toEqual([financeiro.id]);
    expect((await access.commissionVisibility(meus)).kind).toBe("own");
    const none = asCurrentUser(financeiro, { userOverride: { grants: { "financeiro.comissoes.minhas.ver": false, "financeiro.comissoes.todas.ver": false } } });
    expect((await access.commissionVisibility(none)).kind).toBe("none");
    expect(await resolveCommissionScope(none)).toEqual({ kind: "own", userIds: [] });
  });

  it("financeiro com escopo 'equipe' em Contas a Pagar perde os títulos de fornecedor (sem credor colaborador)", async () => {
    const cu = asCurrentUser(financeiro, { userOverride: { scopes: { "financeiro.contas-a-pagar": "equipe" } } });
    const vis = await access.payableVisibility(cu);
    expect(vis.creditorIds).not.toBeNull();
    expect(access.payableAllowed(vis, { creditorId: undefined })).toBe(false);
    expect(access.payableAllowed(vis, { creditorId: financeiro.id })).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// Registro fora do escopo (T4/T8)
// ---------------------------------------------------------------------------
describe("asserções por registro", () => {
  const vendedor = SEED_USERS.find((u) => u.role === "vendas" && u.departmentId === "vendas")!;
  const colega = SEED_USERS.find((u) => u.role === "vendas" && u.id !== vendedor.id) ?? SEED_USERS.find((u) => u.id !== vendedor.id)!;
  const financeiro = SEED_USERS.find((u) => u.role === "financeiro")!;
  const gestorFora = SYNTHETIC_USERS.find((u) => u.id === "syn_gestor_cs")!;

  it("T4/T8: vendedor abre a própria comissão e não a do colega; inexistente = regra de negócio", async () => {
    const cu = asCurrentUser(vendedor);
    await expect(access.assertCommissionAccess(cu, `com_${vendedor.id}`)).resolves.toMatchObject({ userId: vendedor.id });
    await expect(access.assertCommissionAccess(cu, `com_${colega.id}`)).rejects.toBeInstanceOf(PermissionError);
    await expect(access.assertCommissionAccess(cu, "com_inexistente")).rejects.toBeInstanceOf(BusinessError);
  });

  it("título: financeiro acessa todos; gestor de outra área não acessa o de fornecedor nem o de fora da equipe", async () => {
    const fin = asCurrentUser(financeiro);
    await expect(access.assertPayableAccess(fin, "pag_fornecedor")).resolves.toMatchObject({ id: "pag_fornecedor" });
    const g = asCurrentUser(gestorFora);
    await expect(access.assertPayableAccess(g, "pag_fornecedor")).rejects.toBeInstanceOf(PermissionError);
    await expect(access.assertPayableAccess(g, `pag_${vendedor.id}`)).rejects.toBeInstanceOf(PermissionError);
    await expect(access.assertPayableAccess(g, `pag_${gestorFora.id}`)).resolves.toMatchObject({ creditorId: gestorFora.id });
    await expect(access.assertPayableAccess(fin, "pag_inexistente")).rejects.toBeInstanceOf(BusinessError);
  });

  it("lançamento manual com escopo menor que empresa: só colaborador do escopo; fornecedor negado", async () => {
    const cu = asCurrentUser(financeiro, { userOverride: { scopes: { "financeiro.contas-a-pagar": "meus" } } });
    await expect(access.assertCreditorInScope(cu, { creditorType: "colaborador", creditorId: financeiro.id })).resolves.toBeUndefined();
    await expect(access.assertCreditorInScope(cu, { creditorType: "colaborador", creditorId: vendedor.id })).rejects.toBeInstanceOf(PermissionError);
    await expect(access.assertCreditorInScope(cu, { creditorType: "fornecedor" })).rejects.toBeInstanceOf(PermissionError);
    await expect(access.assertCreditorInScope(asCurrentUser(financeiro), { creditorType: "fornecedor" })).resolves.toBeUndefined();
  });
});
