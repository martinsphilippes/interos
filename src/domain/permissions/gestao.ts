/**
 * Catálogo de acessos — módulo Gestão (`gestao.acessar`).
 *
 * Gerado UMA vez a partir do catálogo consolidado da etapa 6A (A24); daqui em diante este arquivo é a fonte de
 * verdade. Cada regra (`rule`) é a regra PADRÃO e reproduz o comportamento anterior ao catálogo; o comentário
 * "Hoje:" registra o predicado de origem. Ajustes por perfil/usuário não entram aqui (ficam em permission_profiles).
 */
import type { ModuleDef } from "./types";

export const GESTAO = {
  key: "gestao",
  label: "Gestão",
  // Hoje: MODULE_ACCESS.gestao = [diretoria, gestor] (constants.ts:67) + admin = isManager
  rule: { manager: true },
  deactivatable: true,
  screens: [
    {
      key: "gestao.dashboard",
      module: "gestao",
      label: "Dashboard do Gestor",
      description: "Equipe, departamento ou empresa no período: produtividade, SLA, tarefas, pendências críticas, metas, carga com redistribuição e alertas.",
      routes: ["/gestao"],
      // Hoje: src/app/(app)/gestao/page.tsx:54 requireRole('gestor','diretoria') (admin passa, session.ts:75)
      // ≡ isManager
      rule: { manager: true },
      nav: {
        // Hoje: NAVIGATION.gestao (src/domain/constants.ts:196) filtrado por canAccessModule(user,'gestao') em
        // src/app/(app)/layout.tsx:11 e src/app/(app)/menu/page.tsx:16
        menu: "gestao",
        href: "/gestao",
        order: 1,
        label: "Dashboard do Gestor",
        icon: "LayoutDashboard",
        wave: 4,
      },
      sections: [
        {
          key: "gestao.dashboard.colaborador.ver",
          label: "Visão do colaborador (tarefas, SLAs, etapas, clientes, scorecard, bônus, histórico)",
          // Onde: /gestao/equipe/[userId] · Hoje: src/app/(app)/gestao/equipe/[userId]/page.tsx:46
          // requireRole('gestor','diretoria') + l.49-50 canManageMember → notFound
          rule: { manager: true },
          routes: ["/gestao/equipe/[userId]"],
        },
      ],
      actions: [
        {
          key: "gestao.dashboard.atribuir",
          label: "Redistribuir tarefas da equipe",
          verb: "atribuir",
          // Hoje: src/server/management/actions.ts:19 requireUser (fora do try) + :21 isManager + :26-27
          // canManageMember (origem e destino)
          rule: { manager: true },
          guards: ["src/server/management/actions.ts#redistributeTasks"],
          recordCondition: "origem e destino ∈ escopo (canManageMember)",
        },
      ],
      scope: {
        entity: "membros da equipe e seus itens (tasks, slaInstances, workflowSteps, clientes)",
        ownerFields: ["users.managerId", "users.departmentId", "departments.managerId", "tasks.assigneeId"],
        allowed: ["equipe", "departamento", "empresa"],
        // Hoje: admin/diretoria: empresa (ativos fora do departamento diretoria) ou departamento escolhido
        // (management/queries.ts:108-129); canManageMember = qualquer ativo (l.164). gestor: teamOf 2 níveis
        // por managerId, SEM membros de departamento (l.82-87, 131, 146-154); ?departamento= só entre os
        // geridos e filtra a própria equipe (l.132-144).
        defaultByRole: { admin: "empresa", diretoria: "empresa", gestor: "equipe" },
        variants: {
          equipe: { reportLevels: 2, includeSelf: false, description: "Seus liderados diretos e os liderados deles" },
        },
        applyAt: [
          "src/server/management/queries.ts#resolveManagerScope",
          "src/server/management/queries.ts#getManagerDashboard",
          "src/server/management/queries.ts#canManageMember",
          "src/server/management/queries.ts#getTeamMemberView",
          "src/server/management/actions.ts#redistributeTasks",
        ],
      },
    },
    {
      key: "gestao.cockpit",
      module: "gestao",
      label: "Cockpit da Diretoria",
      description: "Indicadores da empresa com variação, receita, Saúde da operação, desempenho por departamento, funil, alertas estratégicos e cadeia da operação.",
      routes: ["/gestao/cockpit"],
      // Hoje: src/app/(app)/gestao/cockpit/page.tsx:46 requireRole('diretoria') (admin passa) ≡ isDirector. O
      // item de menu aparece hoje para gestor (constants.ts:197) — A14: menu coerente.
      rule: { director: true },
      nav: {
        // Hoje: NAVIGATION.gestao (src/domain/constants.ts:197) filtrado por canAccessModule(user,'gestao') em
        // src/app/(app)/layout.tsx:11 e src/app/(app)/menu/page.tsx:16
        menu: "gestao",
        href: "/gestao/cockpit",
        order: 2,
        label: "Cockpit Diretoria",
        icon: "Radar",
        wave: 4,
      },
      sections: [
        {
          key: "gestao.cockpit.sugestoes.ver",
          label: "Sugestões do assistente executivo",
          // Onde: gestao/cockpit/page.tsx:215 (AgentSuggestions kind=executivo; demo em
          // admin/automacoes/page.tsx:66) · Hoje: getAgentSuggestions: canAccessModule(user,'gestao')
          // (automations/actions.ts:224,236)
          rule: "all",
          viewGuards: [
            {
              // Hoje: automations/actions.ts:236 (módulo gestao = gestor|diretoria|admin) A14 nominal: hoje um
              // gestor não-diretor pode chamar a action diretamente (o card só aparece no cockpit, diretoria);
              // passa a exigir gestao.cockpit.ver.
              guard: "src/server/automations/actions.ts#getAgentSuggestions?kind=executivo",
              label: "Gerar sugestões do assistente executivo",
            },
          ],
        },
      ],
      actions: [
        {
          key: "gestao.cockpit.configurar",
          label: "Configurar a Saúde da operação (componentes, pesos, faixas)",
          verb: "configurar",
          // Hoje: src/server/kpis/actions.ts:285 user.isDirector; formulário só para isDirector
          // (cockpit/page.tsx:48, :141) · Também chamada pela aba saude-indice de /admin/configuracoes
          // (settings-tabs.tsx:135). Grava settings sem changes (A16).
          rule: { director: true },
          guards: ["src/server/kpis/actions.ts#saveOperationHealthSettings"],
        },
      ],
      scope: null,
    },
    {
      key: "gestao.relatorios",
      module: "gestao",
      label: "Relatórios",
      description: "Central de relatórios departamentais e operacionais: filtros, prévia com totais e exportação CSV/XLSX/PDF. Cada tipo é uma seção com regra própria de visualização e de exportação. Aberta por URL a todos hoje; por isso a tela exige só o módulo ATIVO (moduleGate), não gestao.acessar. O item de menu continua exigindo gestao.acessar (nav.rule).",
      routes: ["/gestao/relatorios"],
      moduleGate: "ativo",
      // Hoje: src/app/(app)/gestao/relatorios/page.tsx:25 requireUser (sem módulo); catálogo filtrado por
      // listReportsForUser (l.26) e canAccessReport (l.38)
      rule: "all",
      nav: {
        // Hoje: NAVIGATION.gestao (src/domain/constants.ts:198) filtrado por canAccessModule(user,'gestao') em
        // src/app/(app)/layout.tsx:11 e src/app/(app)/menu/page.tsx:16 · Por que a regra: A tela tem
        // moduleGate 'ativo' (a rota continua aberta a todos por URL, relatorios/page.tsx:25), mas o item
        // 'Relatórios' fica na seção Gestão do menu (src/domain/constants.ts:198), filtrada por
        // canAccessModule(user,'gestao') (src/app/(app)/layout.tsx:11). Hoje só gestor, diretoria e admin veem
        // o item. nav.rule = {can: gestao.acessar} reproduz isso: item visível = can(gestao.relatorios.ver) ∧
        // can(gestao.acessar). moduleGate NÃO afeta o menu.
        menu: "gestao",
        href: "/gestao/relatorios",
        order: 3,
        label: "Relatórios",
        icon: "BarChart3",
        wave: 4,
        rule: { can: "gestao.acessar" },
      },
      sections: [
        {
          key: "gestao.relatorios.marketing.ver",
          label: "Relatório de Marketing",
          // Onde: /gestao/relatorios?tipo=marketing (prévia) · Hoje: canAccessReport
          // (src/server/reports/build.ts:72-81) — definitions.ts:53
          rule: { any: [{ manager: true }, { department: "marketing" }] },
        },
        {
          key: "gestao.relatorios.vendas.ver",
          label: "Relatório de Vendas",
          // Onde: /gestao/relatorios?tipo=vendas (prévia) · Hoje: canAccessReport
          // (src/server/reports/build.ts:72-81) — definitions.ts:74
          rule: { any: [{ manager: true }, { department: "vendas" }] },
        },
        {
          key: "gestao.relatorios.financeiro.ver",
          label: "Relatório Financeiro",
          // Onde: /gestao/relatorios?tipo=financeiro (prévia) · Hoje: canAccessReport
          // (src/server/reports/build.ts:72-81) — definitions.ts:96
          rule: { any: [{ manager: true }, { department: "financeiro" }] },
        },
        {
          key: "gestao.relatorios.implantacao.ver",
          label: "Relatório de Implantação",
          // Onde: /gestao/relatorios?tipo=implantacao (prévia) · Hoje: canAccessReport
          // (src/server/reports/build.ts:72-81) — definitions.ts:120
          rule: { any: [{ manager: true }, { department: "implantacao" }] },
        },
        {
          key: "gestao.relatorios.cs.ver",
          label: "Relatório de CS",
          // Onde: /gestao/relatorios?tipo=cs (prévia) · Hoje: canAccessReport
          // (src/server/reports/build.ts:72-81) — definitions.ts:143
          rule: { any: [{ manager: true }, { department: "cs" }] },
        },
        {
          key: "gestao.relatorios.suporte.ver",
          label: "Relatório de Suporte",
          // Onde: /gestao/relatorios?tipo=suporte (prévia) · Hoje: canAccessReport
          // (src/server/reports/build.ts:72-81) — definitions.ts:166
          rule: { any: [{ manager: true }, { department: "suporte" }] },
        },
        {
          key: "gestao.relatorios.diretoria.ver",
          label: "Relatório da Diretoria",
          // Onde: /gestao/relatorios?tipo=diretoria (prévia) · Hoje: canAccessReport
          // (src/server/reports/build.ts:72-81) — reports/build.ts:73 isManager; :78 diretoria → false para os
          // demais
          rule: { manager: true },
        },
        {
          key: "gestao.relatorios.tarefas.ver",
          label: "Relatório de Tarefas",
          // Onde: /gestao/relatorios?tipo=tarefas (prévia) · Hoje: canAccessReport
          // (src/server/reports/build.ts:72-81) — reports/build.ts:75 tarefas → true (conteúdo por
          // forcedFilters l.90)
          rule: "all",
          scope: {
            entity: "tasks (linhas do relatório)",
            ownerFields: ["tasks.departmentId", "tasks.assigneeId"],
            allowed: ["meus", "departamento", "empresa"],
            defaultByRole: {
              admin: "empresa",
              diretoria: "empresa",
              gestor: "empresa",
              marketing: "departamento",
              vendas: "departamento",
              financeiro: "departamento",
              implantacao: "departamento",
              cs: "departamento",
              suporte: "departamento",
              colaborador: "departamento",
            },
            applyAt: ["src/server/reports/build.ts#forcedFilters", "src/server/reports/build.ts#buildReport"],
          },
        },
        {
          key: "gestao.relatorios.oportunidades.ver",
          label: "Relatório de Oportunidades",
          // Onde: /gestao/relatorios?tipo=oportunidades (prévia) · Hoje: canAccessReport
          // (src/server/reports/build.ts:72-81) — definitions.ts:229
          rule: { any: [{ manager: true }, { department: "vendas" }] },
        },
        {
          key: "gestao.relatorios.contratos.ver",
          label: "Relatório de Contratos",
          // Onde: /gestao/relatorios?tipo=contratos (prévia) · Hoje: canAccessReport
          // (src/server/reports/build.ts:72-81) — definitions.ts:262
          rule: { any: [{ manager: true }, { department: "financeiro" }] },
        },
        {
          key: "gestao.relatorios.chamados.ver",
          label: "Relatório de Chamados",
          // Onde: /gestao/relatorios?tipo=chamados (prévia) · Hoje: canAccessReport
          // (src/server/reports/build.ts:72-81) — definitions.ts:292
          rule: { any: [{ manager: true }, { department: "suporte" }] },
        },
        {
          key: "gestao.relatorios.clientes.ver",
          label: "Relatório de Clientes",
          // Onde: /gestao/relatorios?tipo=clientes (prévia) · Hoje: canAccessReport
          // (src/server/reports/build.ts:72-81) — definitions.ts:324
          rule: { any: [{ manager: true }, { department: "cs" }] },
        },
        {
          key: "gestao.relatorios.comissoes.ver",
          label: "Relatório de Comissões",
          // Onde: /gestao/relatorios?tipo=comissoes (prévia) · Hoje: canAccessReport
          // (src/server/reports/build.ts:72-81) — reports/build.ts:73, :76 (papel/depto financeiro), :79-80
          // (definitions.ts:346 depto vendas)
          rule: { any: [{ manager: true }, { role: "financeiro" }, { department: ["financeiro", "vendas"] }] },
          scope: { sameAs: "financeiro.comissoes", applyAt: ["src/server/reports/build.ts#buildCommissions"] },
        },
        {
          key: "gestao.relatorios.contas-a-pagar.ver",
          label: "Relatório de Contas a Pagar",
          // Onde: /gestao/relatorios?tipo=contas_a_pagar (prévia) · Hoje: canAccessReport
          // (src/server/reports/build.ts:72-81) — reports/build.ts:73, :77, :79-80 (definitions.ts:376) ·
          // Conteúdo SEM escopo hoje (buildPayables reports/build.ts:635-660 lista todos os títulos, também
          // para gestor de outra área). Candidato A14: aplicar o escopo de financeiro.contas-a-pagar.
          rule: { any: [{ manager: true }, { role: "financeiro" }, { department: "financeiro" }] },
        },
      ],
      actions: [
        {
          key: "gestao.relatorios.exportar",
          label: "Exportar relatórios (CSV, XLSX, PDF)",
          verb: "exportar",
          // Hoje: src/app/api/relatorios/[tipo]/route.ts:23 requireUser (redirect 307) + :25 canAccessReport →
          // 403 + :45 ReportAccessError → 403 · O GET exige, nesta ordem, gestao.relatorios.exportar e
          // gestao.relatorios.<tipo>.exportar; responde 401 JSON sem sessão e 403 sem permissão (A14: hoje
          // 307).
          rule: "all",
          guards: ["src/app/api/relatorios/[tipo]/route.ts#GET"],
        },
        {
          key: "gestao.relatorios.marketing.exportar",
          label: "Exportar relatório de Marketing",
          verb: "exportar",
          // Hoje: src/app/api/relatorios/[tipo]/route.ts:25 canAccessReport (mesma regra da prévia)
          rule: { any: [{ manager: true }, { department: "marketing" }] },
          guards: [],
          checkedIn: ["src/app/api/relatorios/[tipo]/route.ts#GET?tipo=marketing"],
        },
        {
          key: "gestao.relatorios.vendas.exportar",
          label: "Exportar relatório de Vendas",
          verb: "exportar",
          // Hoje: src/app/api/relatorios/[tipo]/route.ts:25 canAccessReport (mesma regra da prévia)
          rule: { any: [{ manager: true }, { department: "vendas" }] },
          guards: [],
          checkedIn: ["src/app/api/relatorios/[tipo]/route.ts#GET?tipo=vendas"],
        },
        {
          key: "gestao.relatorios.financeiro.exportar",
          label: "Exportar relatório Financeiro",
          verb: "exportar",
          // Hoje: src/app/api/relatorios/[tipo]/route.ts:25 canAccessReport (mesma regra da prévia)
          rule: { any: [{ manager: true }, { department: "financeiro" }] },
          guards: [],
          checkedIn: ["src/app/api/relatorios/[tipo]/route.ts#GET?tipo=financeiro"],
          sensitive: true,
        },
        {
          key: "gestao.relatorios.implantacao.exportar",
          label: "Exportar relatório de Implantação",
          verb: "exportar",
          // Hoje: src/app/api/relatorios/[tipo]/route.ts:25 canAccessReport (mesma regra da prévia)
          rule: { any: [{ manager: true }, { department: "implantacao" }] },
          guards: [],
          checkedIn: ["src/app/api/relatorios/[tipo]/route.ts#GET?tipo=implantacao"],
        },
        {
          key: "gestao.relatorios.cs.exportar",
          label: "Exportar relatório de CS",
          verb: "exportar",
          // Hoje: src/app/api/relatorios/[tipo]/route.ts:25 canAccessReport (mesma regra da prévia)
          rule: { any: [{ manager: true }, { department: "cs" }] },
          guards: [],
          checkedIn: ["src/app/api/relatorios/[tipo]/route.ts#GET?tipo=cs"],
        },
        {
          key: "gestao.relatorios.suporte.exportar",
          label: "Exportar relatório de Suporte",
          verb: "exportar",
          // Hoje: src/app/api/relatorios/[tipo]/route.ts:25 canAccessReport (mesma regra da prévia)
          rule: { any: [{ manager: true }, { department: "suporte" }] },
          guards: [],
          checkedIn: ["src/app/api/relatorios/[tipo]/route.ts#GET?tipo=suporte"],
        },
        {
          key: "gestao.relatorios.diretoria.exportar",
          label: "Exportar relatório da Diretoria",
          verb: "exportar",
          // Hoje: src/app/api/relatorios/[tipo]/route.ts:25 canAccessReport (mesma regra da prévia)
          rule: { manager: true },
          guards: [],
          checkedIn: ["src/app/api/relatorios/[tipo]/route.ts#GET?tipo=diretoria"],
          sensitive: true,
        },
        {
          key: "gestao.relatorios.tarefas.exportar",
          label: "Exportar relatório de Tarefas",
          verb: "exportar",
          // Hoje: src/app/api/relatorios/[tipo]/route.ts:25 canAccessReport (mesma regra da prévia)
          rule: "all",
          guards: [],
          checkedIn: ["src/app/api/relatorios/[tipo]/route.ts#GET?tipo=tarefas"],
        },
        {
          key: "gestao.relatorios.oportunidades.exportar",
          label: "Exportar relatório de Oportunidades",
          verb: "exportar",
          // Hoje: src/app/api/relatorios/[tipo]/route.ts:25 canAccessReport (mesma regra da prévia)
          rule: { any: [{ manager: true }, { department: "vendas" }] },
          guards: [],
          checkedIn: ["src/app/api/relatorios/[tipo]/route.ts#GET?tipo=oportunidades"],
          sensitive: true,
        },
        {
          key: "gestao.relatorios.contratos.exportar",
          label: "Exportar relatório de Contratos",
          verb: "exportar",
          // Hoje: src/app/api/relatorios/[tipo]/route.ts:25 canAccessReport (mesma regra da prévia)
          rule: { any: [{ manager: true }, { department: "financeiro" }] },
          guards: [],
          checkedIn: ["src/app/api/relatorios/[tipo]/route.ts#GET?tipo=contratos"],
          sensitive: true,
        },
        {
          key: "gestao.relatorios.chamados.exportar",
          label: "Exportar relatório de Chamados",
          verb: "exportar",
          // Hoje: src/app/api/relatorios/[tipo]/route.ts:25 canAccessReport (mesma regra da prévia)
          rule: { any: [{ manager: true }, { department: "suporte" }] },
          guards: [],
          checkedIn: ["src/app/api/relatorios/[tipo]/route.ts#GET?tipo=chamados"],
        },
        {
          key: "gestao.relatorios.clientes.exportar",
          label: "Exportar relatório de Clientes",
          verb: "exportar",
          // Hoje: src/app/api/relatorios/[tipo]/route.ts:25 canAccessReport (mesma regra da prévia)
          rule: { any: [{ manager: true }, { department: "cs" }] },
          guards: [],
          checkedIn: ["src/app/api/relatorios/[tipo]/route.ts#GET?tipo=clientes"],
        },
        {
          key: "gestao.relatorios.comissoes.exportar",
          label: "Exportar relatório de Comissões",
          verb: "exportar",
          // Hoje: src/app/api/relatorios/[tipo]/route.ts:25 canAccessReport (mesma regra da prévia)
          rule: { any: [{ manager: true }, { role: "financeiro" }, { department: ["financeiro", "vendas"] }] },
          guards: [],
          checkedIn: ["src/app/api/relatorios/[tipo]/route.ts#GET?tipo=comissoes"],
          sensitive: true,
        },
        {
          key: "gestao.relatorios.contas-a-pagar.exportar",
          label: "Exportar relatório de Contas a Pagar",
          verb: "exportar",
          // Hoje: src/app/api/relatorios/[tipo]/route.ts:25 canAccessReport (mesma regra da prévia)
          rule: { any: [{ manager: true }, { role: "financeiro" }, { department: "financeiro" }] },
          guards: [],
          checkedIn: ["src/app/api/relatorios/[tipo]/route.ts#GET?tipo=contas_a_pagar"],
          sensitive: true,
        },
      ],
      scope: {
        entity: "linhas dos relatórios",
        ownerFields: ["por tipo (ver seções tarefas e comissoes)"],
        allowed: ["meus", "equipe", "departamento", "empresa"],
        // Hoje: O escopo varia por TIPO: Tarefas e Comissões têm recorte (seções); oportunidades, contratos,
        // chamados, clientes, contas a pagar e departamentais: empresa para quem acessa o tipo.
        // getReportFilterOptions (reports/build.ts:835) lista todos os usuários e clientes.
        defaultByRole: {
          admin: "empresa",
          diretoria: "empresa",
          gestor: "empresa",
          marketing: "empresa",
          vendas: "empresa",
          financeiro: "empresa",
          implantacao: "empresa",
          cs: "empresa",
          suporte: "empresa",
          colaborador: "empresa",
        },
        applyAt: [
          "src/server/reports/build.ts#buildReport",
          "src/server/reports/build.ts#getReportFilterOptions",
          "src/server/reports/build.ts#canAccessReport",
          "src/server/reports/build.ts#listReportsForUser",
          "src/app/api/relatorios/[tipo]/route.ts#GET",
        ],
      },
    },
  ],
} as const satisfies ModuleDef;
