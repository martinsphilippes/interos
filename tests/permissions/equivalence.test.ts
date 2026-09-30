/**
 * T0 (A3/A18/A31): as regras PADRÃO do catálogo reproduzem o comportamento anterior. Para cada chave com predicado
 * equivalente, can(usuário, chave) === predicado antigo (cópia congelada em legacy.ts), para os 15 usuários do seed,
 * os sintéticos e as 80 combinações papel × departamento. As diferenças são SÓ as correções deliberadas (A14/A27),
 * listadas nominalmente e conferidas por igualdade (nem a mais, nem a menos).
 */
import { describe, expect, it } from "vitest";
import { DEPARTMENT_KEYS, type RoleKey } from "@/domain/constants";
import { MODULE_KEYS, SCREENS, deriveMobileNav, deriveNavigation, deriveQuickActions, deriveSubject, type PermissionKey } from "@/domain/permissions";
import { can, canSeeHref, resolvePermissions } from "@/server/auth/permissions";
import { visibleNavigation, visibleQuickActions } from "@/server/auth/navigation";
import {
  canApprovePayables,
  canManageCommissionRules,
  canOperatePayables,
  canPayPayables,
  canReverseCommission,
  canViewCommissionRules,
  canViewPayables,
} from "@/server/commissions/permissions";
import { canOperateFinance } from "@/server/finance/schemas";
import { canOperateImplementation } from "@/server/implementation/schemas";
import { canEditArticles, canOperateSupport } from "@/server/support/schemas";
import { REPORT_KEYS } from "@/server/reports/definitions";
import { ALL_USERS, asCurrentUser, label, SEED_USERS, type FixtureUser } from "./fixtures";
import {
  legacyCanAccessModule,
  legacyCanAccessReport,
  legacyCanEditArticles,
  legacyCanOperateFinance,
  legacyCanOperateImplementation,
  legacyCanOperatePayables,
  legacyCanOperateSupport,
  legacyCanViewCommissionRules,
  legacyCanViewPayables,
  legacyIsFinanceManager,
  legacyIsFinanceTeam,
  legacyMenu,
  legacyMobileNav,
  legacyQuickActions,
  legacyScreenAccess,
  legacyUser,
  type LegacyUser,
} from "./legacy";

const USERS = ALL_USERS.map((u) => ({ fixture: u, current: asCurrentUser(u), legacy: legacyUser(u) }));

/** Diferenças (usuário, chave) entre o catálogo e o predicado antigo. */
function differences(keys: readonly string[], legacy: (u: LegacyUser, key: string) => boolean): string[] {
  const out: string[] = [];
  for (const { fixture, current, legacy: old } of USERS) {
    for (const key of keys) {
      const now = can(current, key as PermissionKey);
      const before = legacy(old, key);
      if (now !== before) out.push(`${label(fixture)} ${key}: ${before ? "permitido" : "negado"} → ${now ? "permitido" : "negado"}`);
    }
  }
  return out.sort();
}

/** Mesmas diferenças esperadas, por regra nominal. */
function expected(keys: readonly string[], predicate: (u: FixtureUser, key: string) => boolean, legacy: (u: LegacyUser, key: string) => boolean): string[] {
  const out: string[] = [];
  for (const { fixture, legacy: old } of USERS) {
    for (const key of keys) {
      if (!predicate(fixture, key)) continue;
      const before = legacy(old, key);
      out.push(`${label(fixture)} ${key}: ${before ? "permitido" : "negado"} → ${before ? "negado" : "permitido"}`);
    }
  }
  return out.sort();
}

const inModule = (role: RoleKey, m: string) => legacyCanAccessModule(legacyUser({ id: "x", role, departmentId: "vendas" }), m);
const actionKeys = (screen: string, filter: (key: string) => boolean = () => true) =>
  SCREENS.find((s) => s.key === screen)!.actions.map((a) => a.key).filter(filter);

describe("T0 — módulos (<m>.acessar ≡ canAccessModule)", () => {
  const keys = MODULE_KEYS.map((m) => `${m}.acessar`);
  it("idêntico, exceto A27: Administração passa a {gestores} (gestor e diretoria)", () => {
    const diff = differences(keys, (u, k) => legacyCanAccessModule(u, k.split(".")[0]));
    const exp = expected(keys, (u, k) => k === "admin.acessar" && (u.role === "gestor" || u.role === "diretoria"), (u, k) => legacyCanAccessModule(u, k.split(".")[0]));
    expect(diff).toEqual(exp);
  });
});

describe("T0 — telas (<tela>.ver ≡ guarda da página)", () => {
  const keys = SCREENS.map((s) => `${s.key}.ver`);
  it("idêntico, exceto A14: páginas de Marketing passam a exigir o módulo", () => {
    const legacy = (u: LegacyUser, k: string) => legacyScreenAccess(u, k.replace(/\.ver$/, ""));
    const diff = differences(keys, legacy);
    const exp = expected(keys, (u, k) => k.startsWith("marketing.") && !inModule(u.role, "marketing"), legacy);
    expect(diff).toEqual(exp);
    expect(diff.length).toBeGreaterThan(0);
  });

  it("no seed, só perdem as 5 telas de Marketing (abertas hoje por URL) os usuários sem o módulo", () => {
    const legacy = (u: LegacyUser, k: string) => legacyScreenAccess(u, k.replace(/\.ver$/, ""));
    const seedIds = new Set(SEED_USERS.map((u) => u.id));
    const affected = new Set(differences(keys, legacy).filter((d) => seedIds.has(d.split(" ")[0])).map((d) => d.split(" ")[0]));
    expect([...affected].sort()).toEqual(["user_anapaula", "user_bruno", "user_camila", "user_larissa", "user_marcos", "user_rafael"]);
  });
});

describe("T0 — ações e seções com predicado equivalente", () => {
  const financeOps = [
    ...actionKeys("financeiro.contratos", (k) => !["financeiro.contratos.liberar-com-pendencia"].includes(k)),
    ...actionKeys("financeiro.cobrancas", (k) => k !== "financeiro.cobrancas.boleto.enviar"),
  ];

  it("contratos/cobranças ≡ módulo Financeiro ∧ canOperateFinance (requireFinanceOperator)", () => {
    const legacy = (u: LegacyUser) => legacyCanAccessModule(u, "financeiro") && legacyCanOperateFinance(u);
    expect(differences(financeOps, legacy)).toEqual([]);
  });

  const payableOps = [
    "financeiro.contas-a-pagar.criar",
    "financeiro.contas-a-pagar.editar",
    "financeiro.contas-a-pagar.anexar",
    "financeiro.contas-a-pagar.programar",
    "financeiro.contas-a-pagar.cancelar",
    "financeiro.contas-a-pagar.fornecedores.criar",
    "financeiro.contas-a-pagar.fornecedores.editar",
    "financeiro.contas-a-pagar.fornecedores.ativar",
    "financeiro.contas-a-pagar.fluxo-caixa.ver",
  ];
  it("operar títulos ≡ canOperatePayables, exceto A14: actions de CaP passam a exigir o módulo Financeiro", () => {
    const legacy = (u: LegacyUser) => legacyCanOperatePayables(u);
    const exp = expected(payableOps, (u) => legacyIsFinanceTeam(legacyUser(u)) && !inModule(u.role, "financeiro"), legacy);
    expect(differences(payableOps, legacy)).toEqual(exp);
  });

  const financeManagerKeys = [
    "financeiro.contas-a-pagar.aprovar",
    "financeiro.contas-a-pagar.pagar",
    "financeiro.comissoes.estornar",
    "financeiro.comissoes.bloquear",
    "financeiro.comissoes.desbloquear",
    "financeiro.comissoes.gerar-titulo",
    "financeiro.comissoes.aprovar",
    "financeiro.comissoes.regras.editar",
    "financeiro.comissoes.regras.ativar",
    "financeiro.comissoes.regras.configurar",
    "financeiro.comissoes.regras.criar-excecao",
  ];
  it("aprovar/pagar/estornar/regras ≡ isFinanceManager", () => {
    expect(differences(financeManagerKeys, (u) => legacyIsFinanceManager(u))).toEqual([]);
  });

  it("ver regras de comissão e Contas a Pagar ≡ módulo Financeiro ∧ predicado da página", () => {
    expect(differences(["financeiro.comissoes.regras.ver"], (u) => legacyCanAccessModule(u, "financeiro") && legacyCanViewCommissionRules(u))).toEqual([]);
    expect(differences(["financeiro.contas-a-pagar.ver"], (u) => legacyCanAccessModule(u, "financeiro") && legacyCanViewPayables(u))).toEqual([]);
  });

  const implementationOps = [
    ...actionKeys("implantacao.projetos"),
    ...actionKeys("implantacao.kanban"),
    ...actionKeys("implantacao.checklists"),
    ...actionKeys("implantacao.treinamentos"),
    "implantacao.go-live.validar",
    "implantacao.go-live.registrar-aceite",
    "implantacao.go-live.aprovar",
  ];
  it("operar implantação ≡ módulo Implantação ∧ canOperateImplementation (requireOperator)", () => {
    const legacy = (u: LegacyUser) => legacyCanAccessModule(u, "implantacao") && legacyCanOperateImplementation(u);
    expect(differences(implementationOps, legacy)).toEqual([]);
  });

  const supportOps = [
    "suporte.central.executar-varredura",
    "suporte.chamados.csat.ver",
    "suporte.chamados.assumir",
    "suporte.chamados.atribuir",
    "suporte.chamados.enviar",
    "suporte.chamados.registrar",
    "suporte.chamados.anexar",
    "suporte.chamados.classificar",
    "suporte.chamados.pausar",
    "suporte.chamados.concluir",
    "suporte.chamados.fechar",
    "suporte.chamados.criar-oportunidade",
  ];
  it("operar chamados ≡ canOperateSupport, exceto A14: requireOperator do Suporte passa a exigir o módulo", () => {
    const legacy = (u: LegacyUser) => legacyCanOperateSupport(u);
    const exp = expected(supportOps, (u) => legacyCanOperateSupport(legacyUser(u)) && !inModule(u.role, "suporte"), legacy);
    expect(differences(supportOps, legacy)).toEqual(exp);
  });

  const articleOps = ["suporte.base-de-conhecimento.criar", "suporte.base-de-conhecimento.editar", "suporte.base-de-conhecimento.rascunhos.ver"];
  it("editar artigos ≡ canEditArticles, exceto A14: passa a exigir o módulo Suporte", () => {
    const legacy = (u: LegacyUser) => legacyCanEditArticles(u);
    const exp = expected(articleOps, (u) => legacyCanEditArticles(legacyUser(u)) && !inModule(u.role, "suporte"), legacy);
    expect(differences(articleOps, legacy)).toEqual(exp);
  });

  it("relatórios (ver e exportar) ≡ canAccessReport", () => {
    const keys = REPORT_KEYS.flatMap((r) => [`gestao.relatorios.${r.replace(/_/g, "-")}.ver`, `gestao.relatorios.${r.replace(/_/g, "-")}.exportar`]);
    const legacy = (u: LegacyUser, k: string) => legacyCanAccessReport(u, k.split(".")[2].replace(/-/g, "_") as (typeof REPORT_KEYS)[number]);
    expect(differences(keys, legacy)).toEqual([]);
  });

  it("gestores: aprovar gate de qualquer etapa, exceção no gate, aprovar qualquer go-live, ver colaborador, metas, bônus e campanhas ≡ isManager", () => {
    const keys = [
      "operacao.workflow.aprovar-qualquer",
      "operacao.workflow.concluir-com-excecao",
      "implantacao.go-live.aprovar-qualquer",
      "gestao.dashboard.colaborador.ver",
      "gestao.dashboard.atribuir",
      "operacao.tarefas.excluir-qualquer",
      ...actionKeys("performance.metas"),
      ...actionKeys("performance.bonus", (k) => k.startsWith("performance.bonus.equipe.")),
      ...actionKeys("performance.campanhas"),
    ];
    expect(differences(keys, (u) => u.isManager)).toEqual([]);
  });

  it("diretoria: configurar índice de performance e saúde da operação ≡ isDirector", () => {
    expect(differences(["performance.meu-desempenho.configurar", "gestao.cockpit.configurar"], (u) => u.isDirector)).toEqual([]);
  });

  it("administração (requireAdmin/requireRole('admin')/isAdmin) ≡ papel admin", () => {
    const keys = [...SCREENS.filter((s) => s.module === "admin").flatMap((s) => s.actions.map((a) => a.key)), "performance.bonus.regras.editar"];
    expect(keys.length).toBeGreaterThan(40);
    expect(differences(keys, (u) => u.isAdmin)).toEqual([]);
  });

  it("Meu Dia › Financeiro do dia ≡ isFinanceTeam; seletor de presença ≡ isManager ∨ papel operacional", () => {
    expect(differences(["inicio.meu-dia.financeiro.ver"], (u) => legacyIsFinanceTeam(u))).toEqual([]);
    const presence: RoleKey[] = ["vendas", "suporte", "cs", "implantacao"];
    expect(differences(["inicio.barra-superior.presenca.ver"], (u) => u.isManager || presence.includes(u.role))).toEqual([]);
  });
});

describe("T0 — fachadas (predicados antigos com o mesmo nome e assinatura)", () => {
  it("delegam para can e reproduzem o predicado antigo no contexto em que são chamados", () => {
    const problems: string[] = [];
    for (const { fixture, current, legacy: old } of USERS) {
      const plain = { id: fixture.id, role: fixture.role, departmentId: fixture.departmentId, isAdmin: old.isAdmin, isManager: old.isManager, isDirector: old.isDirector };
      for (const subject of [current, plain]) {
        const tag = `${label(fixture)}${subject === current ? "" : " (sem permissions)"}`;
        const fin = legacyCanAccessModule(old, "financeiro");
        const check = (name: string, now: boolean, before: boolean) => now !== before && problems.push(`${tag} ${name}: ${before} → ${now}`);
        check("canOperateFinance", fin && canOperateFinance(subject), fin && legacyCanOperateFinance(old));
        check("canOperateImplementation", legacyCanAccessModule(old, "implantacao") && canOperateImplementation(subject), legacyCanAccessModule(old, "implantacao") && legacyCanOperateImplementation(old));
        check("canOperateSupport (página)", legacyCanAccessModule(old, "suporte") && canOperateSupport(subject), legacyCanAccessModule(old, "suporte") && legacyCanOperateSupport(old));
        check("canEditArticles (página)", legacyCanAccessModule(old, "suporte") && canEditArticles(subject), legacyCanAccessModule(old, "suporte") && legacyCanEditArticles(old));
        check("canManageCommissionRules", canManageCommissionRules(subject), legacyIsFinanceManager(old));
        check("canApprovePayables", canApprovePayables(subject), legacyIsFinanceManager(old));
        check("canPayPayables", canPayPayables(subject), legacyIsFinanceManager(old));
        check("canReverseCommission", canReverseCommission(subject), legacyIsFinanceManager(old));
        check("canViewCommissionRules (página)", fin && canViewCommissionRules(subject), fin && legacyCanViewCommissionRules(old));
        check("canViewPayables (página)", fin && canViewPayables(subject), fin && legacyCanViewPayables(old));
        check("canOperatePayables (com módulo)", fin && canOperatePayables(subject), fin && legacyCanOperatePayables(old));
      }
    }
    expect(problems).toEqual([]);
  });
});

describe("T0 — menu, barra do celular e atalhos '+'", () => {
  it("menu derivado ≡ filtro atual do layout, exceto A14/A27 (Administração, Cockpit, Contas a Pagar)", () => {
    const diff: string[] = [];
    const exp: string[] = [];
    for (const { fixture, current, legacy: old } of USERS) {
      const before = new Set(legacyMenu(old).flatMap((s) => s.hrefs));
      const now = new Set(deriveNavigation(deriveSubject(current), current.permissions.has).flatMap((s) => s.items.map((i) => i.href)));
      for (const href of new Set([...before, ...now])) if (before.has(href) !== now.has(href)) diff.push(`${label(fixture)} ${href} ${now.has(href) ? "+" : "-"}`);
      // Esperado (nominal): gestor/diretoria veem Usuários e Departamentos; gestor deixa de ver o Cockpit;
      // papel Vendas lotado no Financeiro passa a ver Contas a Pagar (a rota já abria).
      if (fixture.role === "gestor" || fixture.role === "diretoria") exp.push(`${label(fixture)} /admin/departamentos +`, `${label(fixture)} /admin/usuarios +`);
      if (fixture.role === "gestor") exp.push(`${label(fixture)} /gestao/cockpit -`);
      if (fixture.role === "vendas" && fixture.departmentId === "financeiro") exp.push(`${label(fixture)} /financeiro/contas-a-pagar +`);
    }
    expect(diff.sort()).toEqual(exp.sort());
  });

  it("visibleNavigation (layout e /menu) = menu derivado, com os mesmos itens de NAVIGATION", () => {
    for (const { current } of USERS) {
      const derived = deriveNavigation(deriveSubject(current), current.permissions.has).map((s) => [s.key, s.items.map((i) => i.href)]);
      expect(visibleNavigation(current).map((s) => [s.key, s.items.map((i) => i.href)])).toEqual(derived);
    }
  });

  it("atalhos '+' e MOBILE_NAV idênticos para todos", () => {
    for (const { fixture, current, legacy: old } of USERS) {
      expect(deriveQuickActions(deriveSubject(current), current.permissions.has).map((q) => q.key), label(fixture)).toEqual(legacyQuickActions(old));
      expect(visibleQuickActions(current).map((q) => q.key), label(fixture)).toEqual(legacyQuickActions(old));
      expect(deriveMobileNav(current.permissions.has).map((i) => i.href), label(fixture)).toEqual(legacyMobileNav());
    }
  });

  it("canSeeHref de cada item do menu ≡ item visível", () => {
    for (const { current } of USERS) {
      for (const s of SCREENS) {
        if (!s.nav?.href || s.nav.rule) continue;
        expect(canSeeHref(current, s.nav.href), `${current.id} ${s.nav.href}`).toBe(current.permissions.has(`${s.key}.ver` as PermissionKey));
      }
    }
  });
});

describe("T0 — sem curto-circuito de admin", () => {
  it("admin tem todas as chaves pela regra padrão; um papel qualquer não herda nada de admin", () => {
    const admin = resolvePermissions({ role: "admin", departmentId: "diretoria" });
    const missing = SCREENS.flatMap((s) => [`${s.key}.ver`, ...s.sections.map((x) => x.key), ...s.actions.map((a) => a.key)]).filter((k) => !admin.has(k as PermissionKey));
    expect(missing).toEqual([]);
    for (const d of DEPARTMENT_KEYS) expect(resolvePermissions({ role: "colaborador", departmentId: d }).has("admin.acessar")).toBe(false);
  });
});
