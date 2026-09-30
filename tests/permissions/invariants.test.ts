/**
 * Invariantes de segurança das permissões (A9) e helpers puros da administração de acessos (A6/A16):
 * anti-auto-bloqueio (I1/I2/I4/I5), perfil admin protegido (I3), anti-escalada (I6), validação dos ajustes
 * recebidos (chaves do catálogo, booleanos, escopos permitidos, sem __proto__) e auditoria "de → para".
 */
import { describe, expect, it } from "vitest";
import { MODULE_KEYS, PROTECTED_KEYS } from "@/domain/permissions";
import {
  ADMIN_CORE_KEYS,
  checkAccessInvariants,
  hasAccessAdministrator,
  permissionsInState,
  withActiveModules,
  withRoleProfile,
  withUser,
  withUserOverride,
  withoutUser,
  type AccessState,
  type AccessUser,
} from "@/server/auth/invariants";
import {
  activeModulesFrom,
  allowedScopesFor,
  buildAccessTree,
  buildScopeOptions,
  defaultValueText,
  describeDiff,
  diffAdjustments,
  inactiveModulesFrom,
  permissionPath,
  roleDefaults,
  validateAdjustments,
  validateInactiveModules,
} from "@/server/auth/access-admin";
import { SEED_DEPARTMENTS, SEED_USERS } from "./fixtures";

const users: AccessUser[] = SEED_USERS.map((u) => ({ id: u.id, name: u.name, role: u.role, departmentId: u.departmentId, active: true, managerId: u.managerId }));
const base: AccessState = { users, departments: SEED_DEPARTMENTS, roleProfiles: {}, userOverrides: {} };
const HERCULES = "user_hercules";
const PHILIPPE = "user_philippe";
const KAREM = "user_karem"; // gestora do Financeiro
const VINICIUS = "user_vinicius";

const codes = (v: { code: string }[]) => v.map((x) => x.code);

describe("estado de acesso", () => {
  it("seed padrão tem administrador de acessos (I1) e só admins têm as chaves de gestão", () => {
    expect(hasAccessAdministrator(base)).toBe(true);
    const holders = users.filter((u) => ADMIN_CORE_KEYS.every((k) => permissionsInState(base, u).has(k))).map((u) => u.id);
    expect(holders.sort()).toEqual([HERCULES, PHILIPPE].sort());
  });
});

describe("I1 — sempre um administrador de acessos ativo", () => {
  it("desativar o último administrador é recusado; com dois, desativar um é aceito", () => {
    const withoutPhilippe = withoutUser(base, PHILIPPE);
    const after = withUser(withoutPhilippe, { ...users.find((u) => u.id === HERCULES)!, active: false });
    // Ator hipotético (outro usuário com gestão) — Philippe removido do estado: Hércules seria o último.
    const v = checkAccessInvariants({ actorId: "ninguem", before: withoutPhilippe, after, change: { kind: "user.update", userId: HERCULES } });
    expect(codes(v)).toContain("I1");
    const ok = checkAccessInvariants({ actorId: HERCULES, before: base, after: withUser(base, { ...users.find((u) => u.id === PHILIPPE)!, active: false }), change: { kind: "user.update", userId: PHILIPPE } });
    expect(codes(ok)).not.toContain("I1");
  });

  it("negar a chave de gestão no perfil admin (tirando de todos) é recusado", () => {
    const after = withRoleProfile(base, "admin", { grants: { "admin.acessos.gerir": false } });
    const v = checkAccessInvariants({ actorId: HERCULES, before: base, after, change: { kind: "profile", role: "admin" } });
    expect(codes(v)).toEqual(expect.arrayContaining(["I1", "I2", "I3"]));
  });

  it("exceção que retira a gestão do outro admin é aceita enquanto sobra um", () => {
    const after = withUserOverride(base, PHILIPPE, { grants: { "admin.acessos.gerir": false } });
    const v = checkAccessInvariants({ actorId: HERCULES, before: base, after, change: { kind: "override", userId: PHILIPPE } });
    expect(v).toEqual([]);
  });

  it("estado anterior já sem administrador não trava gravações", () => {
    const broken = withRoleProfile(base, "admin", { grants: { "admin.usuarios.editar": false } });
    expect(hasAccessAdministrator(broken)).toBe(false);
    const after = withRoleProfile(broken, "vendas", { grants: { "vendas.visitas.ver": false } });
    const v = checkAccessInvariants({ actorId: HERCULES, before: broken, after, change: { kind: "profile", role: "vendas" } });
    expect(codes(v)).not.toContain("I1");
  });
});

describe("I2 — ninguém se bloqueia nem se promove", () => {
  it("ninguém edita as próprias exceções", () => {
    const after = withUserOverride(base, HERCULES, { grants: { "vendas.visitas.ver": false } });
    const v = checkAccessInvariants({ actorId: HERCULES, before: base, after, change: { kind: "override", userId: HERCULES } });
    expect(codes(v)).toContain("I2");
  });

  it("não retira de si chave protegida via perfil do próprio papel", () => {
    const after = withRoleProfile(base, "admin", { grants: { "admin.acessos.ver": false } });
    const v = checkAccessInvariants({ actorId: HERCULES, before: base, after, change: { kind: "profile", role: "admin" } });
    expect(codes(v)).toContain("I2");
    expect(v.find((x) => x.code === "I2")?.message).toContain("Perfis e acessos");
  });

  it("não muda o próprio papel, não se desativa, não se exclui", () => {
    const self = users.find((u) => u.id === HERCULES)!;
    const role = checkAccessInvariants({ actorId: HERCULES, before: base, after: withUser(base, { ...self, role: "gestor" }), change: { kind: "user.update", userId: HERCULES } });
    expect(codes(role)).toContain("I2");
    const off = checkAccessInvariants({ actorId: HERCULES, before: base, after: withUser(base, { ...self, active: false }), change: { kind: "user.update", userId: HERCULES } });
    expect(codes(off)).toContain("I2");
    const del = checkAccessInvariants({ actorId: HERCULES, before: base, after: withoutUser(base, HERCULES), change: { kind: "user.delete", userId: HERCULES } });
    expect(codes(del)).toContain("I2");
  });

  it("editar o próprio cargo/telefone continua permitido", () => {
    const self = users.find((u) => u.id === HERCULES)!;
    const v = checkAccessInvariants({ actorId: HERCULES, before: base, after: withUser(base, { ...self, name: "Hércules A." }), change: { kind: "user.update", userId: HERCULES } });
    expect(v).toEqual([]);
  });
});

describe("I3 — perfil admin mantém as chaves protegidas", () => {
  it.each(PROTECTED_KEYS.filter((k) => !k.startsWith("inicio.")))("negar %s no perfil admin é recusado", (key) => {
    const after = withRoleProfile(base, "admin", { grants: { [key]: false } });
    const v = checkAccessInvariants({ actorId: PHILIPPE, before: base, after, change: { kind: "profile", role: "admin" } });
    expect(codes(v)).toContain("I3");
  });

  it("ajustar chaves não protegidas do perfil admin é aceito", () => {
    const after = withRoleProfile(base, "admin", { grants: { "vendas.visitas.ver": false } });
    expect(checkAccessInvariants({ actorId: HERCULES, before: base, after, change: { kind: "profile", role: "admin" } })).toEqual([]);
  });
});

describe("I4 — Início/Administração ativos e Meu Dia nunca negado", () => {
  it("activeModules sem inicio/admin é recusado", () => {
    const after = withActiveModules(base, MODULE_KEYS.filter((m) => m !== "admin"));
    const v = checkAccessInvariants({ actorId: HERCULES, before: base, after, change: { kind: "modules" } });
    expect(codes(v)).toContain("I4");
  });

  it("negar Meu Dia em qualquer perfil ou exceção é recusado", () => {
    const p = checkAccessInvariants({ actorId: HERCULES, before: base, after: withRoleProfile(base, "vendas", { grants: { "inicio.meu-dia.ver": false } }), change: { kind: "profile", role: "vendas" } });
    expect(codes(p)).toContain("I4");
    const o = checkAccessInvariants({ actorId: HERCULES, before: base, after: withUserOverride(base, VINICIUS, { grants: { "inicio.acessar": false } }), change: { kind: "override", userId: VINICIUS } });
    expect(codes(o)).toContain("I4");
  });

  it("desativar módulo comum é aceito e nega o módulo a todos, admin incluído", () => {
    const after = withActiveModules(base, activeModulesFrom(["financeiro"]));
    expect(checkAccessInvariants({ actorId: HERCULES, before: base, after, change: { kind: "modules" } })).toEqual([]);
    expect(permissionsInState(after, users.find((u) => u.id === HERCULES)!).has("financeiro.acessar")).toBe(false);
  });
});

describe("I5 — gestor de departamento não é excluído", () => {
  it("excluir quem é departments.managerId é recusado", () => {
    const v = checkAccessInvariants({ actorId: HERCULES, before: base, after: withoutUser(base, KAREM), change: { kind: "user.delete", userId: KAREM } });
    expect(codes(v)).toContain("I5");
    const ok = checkAccessInvariants({ actorId: HERCULES, before: base, after: withoutUser(base, VINICIUS), change: { kind: "user.delete", userId: VINICIUS } });
    expect(codes(ok)).not.toContain("I5");
  });
});

describe("I6 — anti-escalada", () => {
  it("sem admin.acessos.gerir não se edita perfil, exceção nem módulo", () => {
    for (const change of [{ kind: "profile", role: "vendas" }, { kind: "override", userId: VINICIUS }, { kind: "modules" }] as const) {
      const v = checkAccessInvariants({ actorId: KAREM, before: base, after: base, change });
      expect(codes(v)).toContain("I6");
    }
  });

  it("o ator só concede chaves que ele próprio tem", () => {
    // Karem (gestora) recebe por exceção a gestão de acessos, mas não vê Produtos: não pode conceder Produtos a outros.
    const delegated = withUserOverride(base, KAREM, { grants: { "admin.acessos.gerir": true, "admin.acessos.ver": true, "admin.usuarios.editar": true } });
    expect(permissionsInState(delegated, users.find((u) => u.id === KAREM)!).has("admin.produtos.ver")).toBe(false);
    const after = withUserOverride(delegated, VINICIUS, { grants: { "admin.produtos.ver": true } });
    const v = checkAccessInvariants({ actorId: KAREM, before: delegated, after, change: { kind: "override", userId: VINICIUS } });
    expect(codes(v)).toContain("I6");
    const fine = withUserOverride(delegated, VINICIUS, { grants: { "financeiro.acessar": true } });
    expect(codes(checkAccessInvariants({ actorId: KAREM, before: delegated, after: fine, change: { kind: "override", userId: VINICIUS } }))).not.toContain("I6");
  });

  it("escopo concedido nunca mais amplo que o do ator", () => {
    const delegated = withUserOverride(base, KAREM, { grants: { "admin.acessos.gerir": true, "admin.acessos.ver": true } });
    const after = withUserOverride(delegated, VINICIUS, { scopes: { "vendas.oportunidades": "empresa" } });
    const v = checkAccessInvariants({ actorId: KAREM, before: delegated, after, change: { kind: "override", userId: VINICIUS } });
    expect(v.some((x) => x.code === "I6" && x.key === "escopo:vendas.oportunidades")).toBe(permissionsInState(delegated, users.find((u) => u.id === KAREM)!).scopes["vendas.oportunidades"] !== "empresa");
  });

  it("atribuir ou retirar o papel admin exige gerir acessos", () => {
    const vin = users.find((u) => u.id === VINICIUS)!;
    const v = checkAccessInvariants({ actorId: KAREM, before: base, after: withUser(base, { ...vin, role: "admin" }), change: { kind: "user.update", userId: VINICIUS } });
    expect(codes(v)).toContain("I6");
    const ok = checkAccessInvariants({ actorId: HERCULES, before: base, after: withUser(base, { ...vin, role: "admin" }), change: { kind: "user.update", userId: VINICIUS } });
    expect(codes(ok)).not.toContain("I6");
  });
});

describe("validação dos ajustes recebidos", () => {
  it("aceita chaves do catálogo com booleanos e escopos permitidos", () => {
    const r = validateAdjustments({ grants: { "financeiro.contas-a-pagar.ver": false }, scopes: { "vendas.oportunidades": "meus" } });
    expect(r).toEqual({ ok: true, value: { grants: { "financeiro.contas-a-pagar.ver": false }, scopes: { "vendas.oportunidades": "meus" } } });
  });

  it("recusa chave inexistente, valor não booleano, escopo fora do permitido, 'unidades' e __proto__", () => {
    expect(validateAdjustments({ grants: { "nao.existe.ver": true } }).ok).toBe(false);
    expect(validateAdjustments({ grants: { "vendas.acessar": "true" } }).ok).toBe(false);
    expect(validateAdjustments({ scopes: { "vendas.oportunidades": "unidades" } }).ok).toBe(false);
    expect(validateAdjustments({ scopes: { "vendas.oportunidades": "tudo" } }).ok).toBe(false);
    const proto = JSON.parse('{"__proto__": {"admin.acessos.gerir": true}}');
    expect(validateAdjustments({ grants: proto }).ok).toBe(false);
    expect(validateAdjustments({ grants: [] }).ok).toBe(false);
  });

  it("escopos configuráveis nunca oferecem 'unidades' e só telas sem sameAs/fixed", () => {
    for (const s of buildScopeOptions()) {
      expect(s.options.map((o) => o.value)).not.toContain("unidades");
      expect(allowedScopesFor(s.screen)).toEqual(s.options.map((o) => o.value));
    }
  });

  it("módulos: só existentes e desativáveis; lista completa ↔ inativos", () => {
    expect(validateInactiveModules(["financeiro", "marketing"])).toEqual({ ok: true, value: ["financeiro", "marketing"] });
    expect(validateInactiveModules(["admin"]).ok).toBe(false);
    expect(validateInactiveModules(["inicio"]).ok).toBe(false);
    expect(validateInactiveModules(["xyz"]).ok).toBe(false);
    expect(activeModulesFrom([])).toBeUndefined();
    expect(inactiveModulesFrom(activeModulesFrom(["cs"]))).toEqual(["cs"]);
    expect(inactiveModulesFrom(undefined)).toEqual([]);
  });
});

describe("auditoria e árvore", () => {
  it("rótulos de negócio: 'Contas a Pagar › Visualizar: Padrão (permitido) → Negado'", () => {
    expect(permissionPath("financeiro.contas-a-pagar.ver")).toMatch(/› Visualizar$/);
    const defaults = roleDefaults("financeiro");
    const diff = diffAdjustments(null, { grants: { "financeiro.contas-a-pagar.ver": false }, scopes: {} }, (k) => defaultValueText(defaults[k]), () => "Padrão");
    expect(diff.changes["financeiro.contas-a-pagar.ver"]).toEqual({ from: "Padrão (permitido)", to: "Negado" });
    expect(describeDiff(diff)).toBe(`${permissionPath("financeiro.contas-a-pagar.ver")}: Padrão (permitido) → Negado`);
  });

  it("voltar ao padrão também é auditado; nada mudou → diff vazio", () => {
    const before = { grants: { "vendas.visitas.ver": false } };
    const back = diffAdjustments(before, { grants: {}, scopes: {} }, () => "Padrão (permitido)", () => "Padrão");
    expect(back.changes["vendas.visitas.ver"]).toEqual({ from: "Negado", to: "Padrão (permitido)" });
    expect(Object.keys(diffAdjustments(before, { grants: { "vendas.visitas.ver": false }, scopes: {} }, () => "", () => "").changes)).toEqual([]);
  });

  it("árvore: todo nó tem pai exibido na própria árvore e profundidade coerente", () => {
    const tree = buildAccessTree();
    const byKey = new Map(tree.map((n) => [n.key, n]));
    for (const n of tree) {
      if (n.kind === "modulo") expect(n.parent).toBeNull();
      else {
        const parent = byKey.get(n.parent!);
        expect(parent, n.key).toBeDefined();
        expect(n.depth).toBe(parent!.depth + 1);
      }
      expect(n.ruleText.length).toBeGreaterThan(0);
    }
  });
});
