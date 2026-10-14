/**
 * Modo restrito das exceções ("Liberar só o que eu marcar"): tudo começa bloqueado; marcar um item libera o caminho
 * até ele e, dentro dele, o que o papel já dá; o Início segue sempre o papel. Também cobre a anti-escalada do
 * caminho (I6), a auditoria da troca de modo, a prévia antes de salvar e a mesma regra na interface (access-model).
 */
import { describe, expect, it } from "vitest";
import { PERMISSION_NODES, type PermissionKey } from "@/domain/permissions";
import { RESTRICTED_EXEMPT_MODULES, defaultPermissionsFor, enclosingKeysOf, resolvePermissions, sanitizeAdjustments } from "@/server/auth/permissions";
import { RESTRICTED_CHANGE_KEY, buildAccessTree, diffAdjustments, summarizeAccessPreview } from "@/server/auth/access-admin";
import { checkAccessInvariants, withUserOverride, type AccessState, type AccessUser } from "@/server/auth/invariants";
import { RESTRICTED_EXEMPT_MODULE_KEYS, draftDecision, enclosingIndex, pathKeysOf, treeIndex } from "@/components/admin/access-model";
import { SEED_DEPARTMENTS, SEED_USERS } from "./fixtures";

const vinicius = SEED_USERS.find((u) => u.id === "user_vinicius")!; // vendas/vendas
const gestorVendas = { id: "user_gestor_vendas", role: "gestor" as const, departmentId: "vendas" };
const keysOf = (module: string) => PERMISSION_NODES.filter((n) => n.module === module).map((n) => n.key);

describe("modo restrito — resolução", () => {
  it("sem nada marcado: só o Início (segue o papel); o resto fica bloqueado com origem 'restrito'", () => {
    const perms = resolvePermissions(gestorVendas, { userOverride: { grants: {}, restricted: true } });
    const base = defaultPermissionsFor("gestor", "vendas");
    for (const key of keysOf("inicio")) expect(perms.has(key)).toBe(base.has(key));
    expect(perms.has("inicio.meu-dia.ver")).toBe(true);
    expect(perms.has("vendas.acessar")).toBe(false);
    expect(perms.origin["vendas.acessar"]).toBe("restrito");
    expect([...perms.keys].every((k) => k.startsWith("inicio."))).toBe(true);
  });

  it("marcar um módulo libera, dentro dele, exatamente o que o papel dá; os outros módulos ficam bloqueados", () => {
    const perms = resolvePermissions(gestorVendas, { userOverride: { grants: { "vendas.acessar": true }, restricted: true } });
    const base = defaultPermissionsFor("gestor", "vendas");
    for (const key of keysOf("vendas")) expect(perms.has(key), key).toBe(base.has(key));
    expect(base.has("financeiro.acessar") || base.has("cs.acessar") || base.has("operacao.acessar")).toBe(true);
    for (const key of [...keysOf("financeiro"), ...keysOf("cs"), ...keysOf("operacao"), ...keysOf("admin")].filter((k) => k !== "financeiro.comissoes.ver" && !k.startsWith("financeiro.comissoes."))) {
      expect(perms.has(key), key).toBe(false);
    }
  });

  it("tela aberta por mais de um módulo (Comissões) fica dentro de qualquer um deles", () => {
    expect(enclosingKeysOf("financeiro.comissoes.minhas.ver")).toEqual(expect.arrayContaining(["financeiro.acessar", "vendas.acessar"]));
    const perms = resolvePermissions(vinicius, { userOverride: { grants: { "vendas.acessar": true }, restricted: true } });
    expect(perms.has("financeiro.comissoes.ver")).toBe(true);
    expect(perms.has("financeiro.acessar")).toBe(false);
    expect(perms.has("financeiro.dashboard.ver")).toBe(false);
  });

  it("marcar uma tela libera o caminho até ela, mas não as telas vizinhas; dentro dela vale o papel", () => {
    const perms = resolvePermissions(gestorVendas, { userOverride: { grants: { "vendas.pipeline.ver": true }, restricted: true } });
    expect(perms.has("vendas.acessar")).toBe(true);
    expect(perms.origin["vendas.acessar"]).toBe("caminho");
    expect(perms.has("vendas.pipeline.ver")).toBe(true);
    expect(perms.has("vendas.propostas.ver")).toBe(false);
    expect(perms.origin["vendas.propostas.ver"]).toBe("restrito");
  });

  it("marcar uma ação libera o caminho mesmo que o papel negue a tela (Permitir vence)", () => {
    const perms = resolvePermissions(vinicius, { userOverride: { grants: { "financeiro.cobrancas.baixar": true }, restricted: true } });
    expect(perms.has("financeiro.acessar")).toBe(true);
    expect(perms.has("financeiro.cobrancas.ver")).toBe(true);
    expect(perms.has("financeiro.cobrancas.baixar")).toBe(true);
    expect(perms.has("financeiro.contas-a-pagar.ver")).toBe(false);
  });

  it("Negar continua cortando partes dentro do que foi liberado", () => {
    const perms = resolvePermissions(gestorVendas, { userOverride: { grants: { "vendas.acessar": true, "vendas.propostas.ver": false }, restricted: true } });
    expect(perms.has("vendas.pipeline.ver")).toBe(true);
    expect(perms.has("vendas.propostas.ver")).toBe(false);
  });

  it("o caso real: módulos marcados Permitir/Negar no modo restrito dão só os módulos permitidos", () => {
    const grants = { "cs.acessar": false, "admin.acessar": false, "gestao.acessar": false, "vendas.acessar": true, "suporte.acessar": false, "operacao.acessar": false, "marketing.acessar": false, "financeiro.acessar": false, "implantacao.acessar": false, "performance.acessar": true };
    const normal = resolvePermissions(gestorVendas, { userOverride: { grants } });
    const restricted = resolvePermissions(gestorVendas, { userOverride: { grants, restricted: true } });
    const modules = (p: typeof normal) => PERMISSION_NODES.filter((n) => n.kind === "modulo" && p.has(n.key)).map((n) => n.module);
    expect(modules(restricted)).toEqual(["inicio", "vendas", "performance"]);
    // No modo normal o resto do papel continua valendo nas telas dos módulos não marcados (ex.: Relatórios com moduleGate).
    expect(normal.keys.size).toBeGreaterThanOrEqual(restricted.keys.size);
  });

  it("sem o modo, nada muda (mesmo resultado de antes) e o perfil do papel ignora `restricted`", () => {
    const grants = { "vendas.propostas.ver": false };
    const before = resolvePermissions(vinicius, { userOverride: { grants } });
    const off = resolvePermissions(vinicius, { userOverride: { grants, restricted: false } });
    expect([...off.keys]).toEqual([...before.keys]);
    const roleRestricted = resolvePermissions(vinicius, { roleProfile: { grants: {}, restricted: true } });
    expect([...roleRestricted.keys]).toEqual([...defaultPermissionsFor(vinicius.role, vinicius.departmentId).keys]);
  });

  it("sanitizeAdjustments só aceita `restricted: true` literal", () => {
    expect(sanitizeAdjustments({ grants: {}, restricted: true }).restricted).toBe(true);
    expect(sanitizeAdjustments({ grants: {}, restricted: "sim" as unknown as boolean }).restricted).toBe(false);
    expect(sanitizeAdjustments(null).restricted).toBe(false);
  });
});

describe("modo restrito — invariantes e auditoria", () => {
  const users: AccessUser[] = [
    ...SEED_USERS.map((u) => ({ id: u.id, name: u.name, role: u.role, departmentId: u.departmentId, active: true, managerId: u.managerId })),
    { ...gestorVendas, name: "Gestor Vendas", active: true },
  ];
  const base: AccessState = { users, departments: SEED_DEPARTMENTS, roleProfiles: {}, userOverrides: {} };

  it("I6: o caminho liberado entra na anti-escalada (o ator não concede o módulo que não tem)", () => {
    // Ator sem Financeiro que tem gerir acessos por exceção (ex.: gestor de vendas promovido a gerir acessos).
    const actorId = gestorVendas.id;
    const withActor = withUserOverride(base, actorId, { grants: { "admin.acessar": true, "admin.usuarios.ver": true, "admin.acessos.gerir": true, "financeiro.acessar": false } });
    const after = withUserOverride(withActor, "user_vinicius", { grants: { "vendas.acessar": true, "financeiro.cobrancas.ver": true }, restricted: true });
    const violations = checkAccessInvariants({ actorId, before: withActor, after, change: { kind: "override", userId: "user_vinicius" } });
    expect(violations.some((v) => v.code === "I6" && v.key === "financeiro.acessar")).toBe(true);
  });

  it("administrador pode ligar o modo e marcar módulos sem violar invariantes", () => {
    const after = withUserOverride(base, gestorVendas.id, { grants: { "vendas.acessar": true }, restricted: true });
    expect(checkAccessInvariants({ actorId: "user_hercules", before: base, after, change: { kind: "override", userId: gestorVendas.id } })).toEqual([]);
  });

  it("a troca de modo entra na auditoria 'de → para'", () => {
    const diff = diffAdjustments({ grants: {} }, { grants: {}, scopes: {}, restricted: true }, () => "Não marcado", () => "Padrão");
    expect(diff.changes[RESTRICTED_CHANGE_KEY]).toEqual({ from: "Papel + exceções", to: "Só o que foi marcado" });
    expect(diff.labels[RESTRICTED_CHANGE_KEY]).toBe("Modo de liberação");
    expect(diffAdjustments({ grants: {} }, { grants: {}, scopes: {} }, () => "x", () => "y").changes).toEqual({});
  });
});

describe("prévia antes de salvar", () => {
  it("modo normal: separa o que foi marcado do que o papel libera, por módulo", () => {
    const perms = resolvePermissions(gestorVendas, { userOverride: { grants: { "financeiro.contas-a-pagar.ver": true } } });
    const preview = summarizeAccessPreview(perms, false);
    expect(preview.restricted).toBe(false);
    expect(preview.marked.screens).toBe(1);
    expect(preview.inherited.screens).toBe(preview.screens - 1);
    const vendas = preview.modules.find((m) => m.key === "vendas")!;
    expect(vendas.inheritedScreens).toBe(vendas.screens);
    expect(preview.modules.reduce((s, m) => s + m.screens, 0)).toBe(preview.screens);
  });

  it("modo restrito: só o Início e o que foi marcado aparecem", () => {
    const perms = resolvePermissions(gestorVendas, { userOverride: { grants: { "vendas.pipeline.ver": true }, restricted: true } });
    const preview = summarizeAccessPreview(perms, true);
    expect(preview.modules.map((m) => m.key)).toEqual(["inicio", "vendas"]);
    expect(preview.modules.find((m) => m.key === "vendas")!.screens).toBe(1);
  });
});

describe("modo restrito — mesma regra na interface", () => {
  it("os módulos isentos são os mesmos do servidor", () => {
    expect([...RESTRICTED_EXEMPT_MODULE_KEYS]).toEqual([...RESTRICTED_EXEMPT_MODULES]);
  });

  it("draftDecision coincide com o servidor em todos os nós (papel sem ajustes)", () => {
    const tree = buildAccessTree();
    const index = treeIndex(tree);
    const enclosing = enclosingIndex(tree, index.ancestors);
    const moduleOf = new Map(tree.map((n) => [n.key, n.module]));
    const profile = resolvePermissions(gestorVendas);
    for (const grants of [{ "vendas.acessar": true }, { "vendas.pipeline.ver": true, "vendas.acessar": false }, { "financeiro.cobrancas.baixar": true }, {}] as Record<string, boolean>[]) {
      const server = resolvePermissions(gestorVendas, { userOverride: { grants, restricted: true } });
      const ctx = {
        grants,
        restricted: true,
        roleValue: (key: string) => profile.has(key as PermissionKey),
        enclosing,
        pathKeys: pathKeysOf(grants, index.ancestors),
        exempt: (key: string) => RESTRICTED_EXEMPT_MODULE_KEYS.includes(moduleOf.get(key) ?? ""),
      };
      for (const n of tree) {
        const draft = draftDecision(n.key, ctx);
        const origin = server.origin[n.key as PermissionKey];
        if (draft.source === "caminho") expect(origin, n.key).toBe("caminho");
        if (draft.source === "restrito") expect(origin === "restrito" || origin === "hierarquia", n.key).toBe(true);
        if (origin === "restrito") expect(draft.source, n.key).toBe("restrito");
      }
    }
  });
});
