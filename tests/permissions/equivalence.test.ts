/**
 * T0 (A3/A18/A31): as regras PADRÃO do catálogo reproduzem o comportamento anterior. Para cada chave com predicado
 * equivalente, can(usuário, chave) === predicado antigo (cópia congelada em legacy.ts), para os 15 usuários do seed,
 * os sintéticos e as 80 combinações papel × departamento. As diferenças são SÓ as correções deliberadas (A14/A27),
 * listadas nominalmente e conferidas por igualdade (nem a mais, nem a menos). As fachadas são comparadas sem máscara.
 * O bloco "consistência interna" compara o código novo com ele mesmo e não conta como equivalência.
 */
import { readFileSync, readdirSync, statSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { DEPARTMENT_KEYS, type RoleKey } from "@/domain/constants";
import { MODULE_KEYS, NODE_BY_KEY, PERMISSION_NODES, SCREENS, deriveMobileNav, deriveNavigation, deriveQuickActions, deriveSubject, type PermissionKey } from "@/domain/permissions";
import { can, canSeeHref, resolvePermissions, screenForHref } from "@/server/auth/permissions";
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
import { canOperateFinance } from "@/server/finance/access";
import { canOperateImplementation } from "@/server/implementation/access";
import { canEditArticles, canOperateSupport } from "@/server/support/access";
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
  legacyRequireRole,
  legacyScreenAccess,
  legacyUser,
  type LegacyUser,
} from "./legacy";

/** Arquivos .ts/.tsx sob `dir` (recursivo). */
function listSources(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const full = path.join(dir, name);
    if (statSync(full).isDirectory()) return listSources(full);
    return /\.tsx?$/.test(name) ? [full] : [];
  });
}

const USERS = ALL_USERS.map((u) => ({ fixture: u, current: asCurrentUser(u), legacy: legacyUser(u) }));

/** Chaves comparadas com um oráculo antigo neste arquivo (cobertura do T0, conferida no último teste). */
const COVERED = new Set<string>();

/** Diferenças (usuário, chave) entre o catálogo e o predicado antigo. */
function differences(keys: readonly string[], legacy: (u: LegacyUser, key: string) => boolean): string[] {
  for (const key of keys) COVERED.add(key);
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

  it("Portal do cliente (novo, D31: ver, gerar e revogar) ≡ módulo Financeiro ∧ canOperateFinance (quem opera o Financeiro)", () => {
    const legacy = (u: LegacyUser) => legacyCanAccessModule(u, "financeiro") && legacyCanOperateFinance(u);
    expect(differences(["financeiro.contratos.portal.ver", "financeiro.contratos.portal.gerar", "financeiro.contratos.portal.revogar"], legacy)).toEqual([]);
  });

  it("relatório de Auditoria (novo, D29: ver e exportar) ≡ diretoria/administrador (isDirector)", () => {
    expect(differences(["gestao.relatorios.auditoria.ver", "gestao.relatorios.auditoria.exportar"], (u) => Boolean(u.isDirector))).toEqual([]);
  });

  it("relatórios (ver e exportar) ≡ canAccessReport", () => {
    // Auditoria (etapa 6B) é relatório NOVO, sem predicado anterior: coberto no teste de guards de Gestão.
    const keys = REPORT_KEYS.filter((r) => r !== "auditoria").flatMap((r) => [`gestao.relatorios.${r.replace(/_/g, "-")}.ver`, `gestao.relatorios.${r.replace(/_/g, "-")}.exportar`]);
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
    // Ações de todas as telas do Administração e seções das telas só-admin (abas de Configurações, Workflows,
    // Automações). A tela nova Perfis e acessos (A10) não tem predicado antigo: padrão = só admin, como as demais.
    const openToManagers = new Set(["admin.usuarios", "admin.departamentos"]);
    const keys = [
      ...SCREENS.filter((s) => s.module === "admin").flatMap((s) => s.actions.map((a) => a.key)),
      ...SCREENS.filter((s) => s.module === "admin" && !openToManagers.has(s.key)).flatMap((s) => s.sections.map((x) => x.key)),
      "performance.bonus.regras.editar",
    ];
    expect(keys.length).toBeGreaterThan(60);
    expect(differences(keys, (u) => u.isAdmin)).toEqual([]);
  });

  it("Usuários › remuneração ≡ quem entra na página (requireRole admin, gestor, diretoria)", () => {
    expect(differences(["admin.usuarios.remuneracao.ver"], (u) => legacyRequireRole(u, "admin", "gestor", "diretoria"))).toEqual([]);
  });

  it("Configurações Financeiras (abas e edição) ≡ requireRole('admin') de /admin/configuracoes e upsertSetting", () => {
    const screen = SCREENS.find((s) => s.key === "financeiro.configuracoes")!;
    const keys = [...screen.sections.map((x) => x.key), ...screen.actions.map((a) => a.key)];
    expect(keys.length).toBe(14);
    expect(differences(keys, (u) => legacyRequireRole(u, "admin"))).toEqual([]);
  });

  it("Meu Dia: equipe e insights ≡ isManager (∨ isDirector); cobranças de vendas ≡ vendedor ∨ gestor", () => {
    expect(differences(["inicio.meu-dia.equipe.ver"], (u) => u.isManager)).toEqual([]);
    expect(differences(["inicio.meu-dia.insights.ver"], (u) => u.isManager || u.isDirector)).toEqual([]);
    // meu-dia/queries.ts:280-281: isSeller(user) || members.some(isSeller); só gestor tem membros (visão equipe). A
    // presença de vendedor na equipe é condição de DADOS e continua na consulta.
    expect(differences(["inicio.meu-dia.cobrancas-vendas.ver"], (u) => u.role === "vendas" || u.departmentId === "vendas" || u.isManager)).toEqual([]);
  });

  it("SLA › qualidade de chamados ≡ módulo Suporte (sla/page.tsx:351)", () => {
    expect(differences(["operacao.sla.qualidade-chamados.ver"], (u) => legacyCanAccessModule(u, "suporte"))).toEqual([]);
  });

  it("Marketing: criar/editar campanha ≡ isManager ∨ papel marketing (marketing/actions.ts:291)", () => {
    expect(differences(["marketing.campanhas.criar", "marketing.campanhas.editar"], (u) => u.isManager || u.role === "marketing")).toEqual([]);
  });

  it("Vendas: executar varredura e atribuir visita ≡ requireSalesUser ∧ isManager", () => {
    expect(differences(["vendas.central.executar-varredura", "vendas.visitas.atribuir"], (u) => legacyCanAccessModule(u, "vendas") && u.isManager)).toEqual([]);
  });

  it("Financeiro: liberar com pendência ≡ requireFinanceOperator ∧ isManager; enviar boleto ≡ requireFinanceOperator", () => {
    const operator = (u: LegacyUser) => legacyCanAccessModule(u, "financeiro") && legacyCanOperateFinance(u);
    expect(differences(["financeiro.contratos.liberar-com-pendencia"], (u) => operator(u) && u.isManager)).toEqual([]);
    expect(differences(["financeiro.cobrancas.boleto.enviar"], operator)).toEqual([]);
  });

  it("Comissões › Todas ≡ página (Financeiro ∨ Vendas) ∧ (canViewAllCommissions ∨ isManager)", () => {
    const page = (u: LegacyUser) => legacyCanAccessModule(u, "financeiro") || legacyCanAccessModule(u, "vendas");
    expect(differences(["financeiro.comissoes.todas.ver"], (u) => page(u) && (legacyIsFinanceTeam(u) || u.isManager))).toEqual([]);
  });

  it("go-live configurar ≡ isManager (implementation/actions.ts:344); recalcular carteira ≡ requireCsUser ∧ isManager", () => {
    expect(differences(["implantacao.go-live.configurar"], (u) => u.isManager)).toEqual([]);
    expect(differences(["cs.saude.recalcular-carteira"], (u) => legacyCanAccessModule(u, "cs") && u.isManager)).toEqual([]);
  });

  it("Performance: bônus da equipe e detalhamento de indicadores ≡ isManager; regras de bônus ≡ requireRole('admin')", () => {
    expect(differences(["performance.bonus.equipe.ver", "performance.indicadores.detalhamento.ver"], (u) => u.isManager)).toEqual([]);
    expect(differences(["performance.bonus.regras.ver"], (u) => legacyRequireRole(u, "admin"))).toEqual([]);
  });

  it("Meu Dia › Financeiro do dia ≡ isFinanceTeam; seletor de presença ≡ isManager ∨ papel operacional", () => {
    expect(differences(["inicio.meu-dia.financeiro.ver"], (u) => legacyIsFinanceTeam(u))).toEqual([]);
    const presence: RoleKey[] = ["vendas", "suporte", "cs", "implantacao"];
    expect(differences(["inicio.barra-superior.presenca.ver"], (u) => u.isManager || presence.includes(u.role))).toEqual([]);
  });
});

describe("T0 — fachadas (predicados antigos com o mesmo nome e assinatura)", () => {
  type Subject = Parameters<typeof canOperateFinance>[0] & Parameters<typeof canManageCommissionRules>[0];
  interface Facade {
    name: string;
    now: (subject: Subject) => boolean;
    before: (old: LegacyUser) => boolean;
    /** Quem muda de propósito (a mudança é sempre permitido → negado), com a correção nominal que justifica. */
    changes?: { when: (old: LegacyUser) => boolean; because: string };
  }
  const M = (old: LegacyUser, m: string) => legacyCanAccessModule(old, m);
  // Comparação SEM máscara: cada fachada contra o predicado antigo para todos os usuários, com e sem permissions.
  const FACADES: Facade[] = [
    { name: "canOperateFinance", now: canOperateFinance, before: legacyCanOperateFinance, changes: { when: (o) => !M(o, "financeiro"), because: "Fachadas de operação incluem o módulo" } },
    { name: "canOperateImplementation", now: canOperateImplementation, before: legacyCanOperateImplementation, changes: { when: (o) => !M(o, "implantacao"), because: "Fachadas de operação incluem o módulo" } },
    { name: "canOperateSupport", now: canOperateSupport, before: legacyCanOperateSupport, changes: { when: (o) => !M(o, "suporte"), because: "A14: requireOperator do Suporte exige o módulo" } },
    { name: "canEditArticles", now: canEditArticles, before: legacyCanEditArticles, changes: { when: (o) => !M(o, "suporte"), because: "A14: canEditArticles exige o módulo" } },
    { name: "canOperatePayables", now: canOperatePayables, before: legacyCanOperatePayables, changes: { when: (o) => !M(o, "financeiro"), because: "A14: Comissões/CaP exigem o módulo nas actions" } },
    { name: "canViewCommissionRules", now: canViewCommissionRules, before: legacyCanViewCommissionRules, changes: { when: (o) => !M(o, "financeiro"), because: "Comissões: botões seguem a página de destino" } },
    { name: "canViewPayables", now: canViewPayables, before: legacyCanViewPayables, changes: { when: (o) => !M(o, "financeiro"), because: "Comissões: botões seguem a página de destino" } },
    { name: "canManageCommissionRules", now: canManageCommissionRules, before: legacyIsFinanceManager },
    { name: "canApprovePayables", now: canApprovePayables, before: legacyIsFinanceManager },
    { name: "canPayPayables", now: canPayPayables, before: legacyIsFinanceManager },
    { name: "canReverseCommission", now: canReverseCommission, before: legacyIsFinanceManager },
  ];

  function subjects(fixture: FixtureUser, current: Subject, old: LegacyUser): [string, Subject][] {
    const plain = { id: fixture.id, role: fixture.role, departmentId: fixture.departmentId, isAdmin: old.isAdmin, isManager: old.isManager, isDirector: old.isDirector };
    return [
      [label(fixture), current],
      [`${label(fixture)} (sem permissions)`, plain],
    ];
  }

  it("diferenças sem máscara = exatamente as correções nominais (nem a mais, nem a menos)", () => {
    const diff: string[] = [];
    const exp: string[] = [];
    for (const { fixture, current, legacy: old } of USERS) {
      for (const [tag, subject] of subjects(fixture, current, old)) {
        for (const f of FACADES) {
          const before = f.before(old);
          const now = f.now(subject);
          if (now !== before) diff.push(`${tag} ${f.name}: ${before} → ${now}`);
          if (before && f.changes?.when(old)) exp.push(`${tag} ${f.name}: true → false`);
        }
      }
    }
    expect(diff.sort()).toEqual(exp.sort());
    expect(diff.length).toBeGreaterThan(0);
  });

  it("Comissões (aberta por Financeiro ∨ Vendas): botões Regras e Contas a Pagar mudam só para quem não tem o Financeiro", () => {
    // Contexto real de chamada: ws.can.viewRules/viewPayables (commissions/queries.ts) na página /financeiro/comissoes.
    const affected = new Set<string>();
    for (const { fixture, current, legacy: old } of USERS) {
      if (!(M(old, "financeiro") || M(old, "vendas"))) continue;
      for (const [name, now, before] of [
        ["viewRules", canViewCommissionRules(current), legacyCanViewCommissionRules(old)],
        ["viewPayables", canViewPayables(current), legacyCanViewPayables(old)],
      ] as const) {
        if (now !== before) affected.add(`${fixture.id} ${name} ${before}→${now}`);
      }
    }
    expect([...affected].sort()).toEqual(
      ["syn_cs_fin", "combo_cs_financeiro", "combo_marketing_financeiro", "combo_suporte_financeiro"].flatMap((id) => [`${id} viewPayables true→false`, `${id} viewRules true→false`]).sort(),
    );
    // No seed ninguém é afetado.
    const seedIds = new Set(SEED_USERS.map((u) => u.id));
    expect([...affected].filter((a) => seedIds.has(a.split(" ")[0]))).toEqual([]);
  });

  it("todo chamador de canOperateFinance/canOperateImplementation exige o módulo antes (a mudança não é observável)", () => {
    const root = path.resolve(__dirname, "../..");
    const facades = [
      { name: "canOperateFinance", module: "financeiro", guardFile: "src/server/finance/actions.ts" },
      { name: "canOperateImplementation", module: "implantacao", guardFile: "src/server/implementation/actions.ts" },
    ];
    const files = listSources(path.join(root, "src"));
    for (const f of facades) {
      const callers = files.filter((file) => !file.endsWith("/access.ts") && new RegExp(`\\b${f.name}\\(`).test(readFileSync(file, "utf8")));
      // Os módulos passaram a usar as chaves do catálogo direto (requirePermission/can); zero chamadores é o
      // esperado. A checagem abaixo continua valendo para quem voltar a chamar a fachada.
      for (const file of callers) {
        const rel = path.relative(root, file);
        if (rel === f.guardFile) {
          // requireFinanceOperator/requireOperator: canAccessModule(user, "<m>") vem antes da fachada.
          const src = readFileSync(file, "utf8");
          const moduleCheck = src.indexOf(`canAccessModule(user, "${f.module}")`);
          const facadeCall = src.indexOf(`${f.name}(user)`);
          expect(moduleCheck, `${rel}: checagem do módulo`).toBeGreaterThan(-1);
          expect(moduleCheck, `${rel}: módulo antes de ${f.name}`).toBeLessThan(facadeCall);
          continue;
        }
        // Página: a rota pertence a uma tela cujo acesso exige o módulo (hierarquia do catálogo).
        const match = rel.match(/^src\/app\/\(app\)(\/.*)\/page\.tsx$/);
        expect(match, `${rel}: chamador fora de página/guarda conhecida`).not.toBeNull();
        const href = match![1].replace(/\[[^\]]+\]/g, "x");
        const owner = screenForHref(href);
        expect(owner, `${rel}: rota sem tela`).not.toBeNull();
        for (const key of owner!.keys) expect(NODE_BY_KEY.get(key)?.requires.keys, `${rel} (${key})`).toContain(`${f.module}.acessar`);
      }
    }
  });
});

describe("T0 — menu, barra do celular e atalhos '+'", () => {
  it("menu do layout e de /menu (visibleNavigation) ≡ filtro anterior, exceto A14/A27 (Administração, Cockpit, Contas a Pagar)", () => {
    const diff: string[] = [];
    const exp: string[] = [];
    for (const { fixture, current, legacy: old } of USERS) {
      const before = new Set(legacyMenu(old).flatMap((s) => s.hrefs));
      const now = new Set(visibleNavigation(current).flatMap((s) => s.items.map((i) => i.href)));
      for (const href of new Set([...before, ...now])) if (before.has(href) !== now.has(href)) diff.push(`${label(fixture)} ${href} ${now.has(href) ? "+" : "-"}`);
      // Esperado (nominal): gestor/diretoria veem Usuários e Departamentos; gestor deixa de ver o Cockpit;
      // papel Vendas lotado no Financeiro passa a ver Contas a Pagar (a rota já abria).
      if (fixture.role === "gestor" || fixture.role === "diretoria") exp.push(`${label(fixture)} /admin/departamentos +`, `${label(fixture)} /admin/usuarios +`);
      if (fixture.role === "gestor") exp.push(`${label(fixture)} /gestao/cockpit -`);
      if (fixture.role === "vendas" && fixture.departmentId === "financeiro") exp.push(`${label(fixture)} /financeiro/contas-a-pagar +`);
    }
    expect(diff.sort()).toEqual(exp.sort());
  });

  it("atalhos '+' e MOBILE_NAV idênticos para todos", () => {
    for (const { fixture, current, legacy: old } of USERS) {
      expect(deriveQuickActions(deriveSubject(current), current.permissions.has).map((q) => q.key), label(fixture)).toEqual(legacyQuickActions(old));
      expect(visibleQuickActions(current).map((q) => q.key), label(fixture)).toEqual(legacyQuickActions(old));
      expect(deriveMobileNav(current.permissions.has).map((i) => i.href), label(fixture)).toEqual(legacyMobileNav());
    }
  });
});

/** Consistência interna do código novo (NÃO é equivalência com o comportamento anterior; não entra no T0). */
describe("consistência interna — menu e canSeeHref", () => {
  it("visibleNavigation (layout e /menu) = menu derivado do catálogo, com os mesmos itens de NAVIGATION", () => {
    for (const { current } of USERS) {
      const derived = deriveNavigation(deriveSubject(current), current.permissions.has).map((s) => [s.key, s.items.map((i) => i.href)]);
      expect(visibleNavigation(current).map((s) => [s.key, s.items.map((i) => i.href)])).toEqual(derived);
    }
  });

  it("canSeeHref de cada item do menu ≡ chave de visualização da tela", () => {
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

describe("T0 — cobertura", () => {
  it("toda chave com regra padrão não trivial tem oráculo antigo no T0", () => {
    const missing = PERMISSION_NODES.filter((n) => n.rule !== "all" && !COVERED.has(n.key)).map((n) => `${n.key} ${JSON.stringify(n.rule)}`);
    expect(missing).toEqual([]);
  });
});
