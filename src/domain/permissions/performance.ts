/**
 * Catálogo de acessos — módulo Performance (`performance.acessar`).
 *
 * Gerado UMA vez a partir do catálogo consolidado da etapa 6A (A24); daqui em diante este arquivo é a fonte de
 * verdade. Cada regra (`rule`) é a regra PADRÃO e reproduz o comportamento anterior ao catálogo; o comentário
 * "Hoje:" registra o predicado de origem. Ajustes por perfil/usuário não entram aqui (ficam em permission_profiles).
 */
import type { ModuleDef } from "./types";

export const PERFORMANCE = {
  key: "performance",
  label: "Performance",
  // Hoje: MODULE_ACCESS.performance = "all" (constants.ts:66)
  rule: "all",
  deactivatable: true,
  screens: [
    {
      key: "performance.meu-desempenho",
      module: "performance",
      label: "Meu Desempenho",
      description: "Meta geral, índice de desempenho, metas, indicadores da função, bônus e comissões do colaborador. Gestão escolhe outro colaborador com ?usuario=.",
      routes: ["/performance"],
      // Hoje: src/app/(app)/performance/page.tsx:67 requireUser; módulo performance = "all" (constants.ts:66)
      rule: "all",
      nav: {
        // Hoje: NAVIGATION.performance (src/domain/constants.ts:185) filtrado por
        // canAccessModule(user,'performance') em src/app/(app)/layout.tsx:11 e src/app/(app)/menu/page.tsx:16
        menu: "performance",
        href: "/performance",
        order: 1,
        label: "Meu Desempenho",
        icon: "Gauge",
        wave: 4,
      },
      sections: [
        {
          key: "performance.meu-desempenho.comissoes.ver",
          label: "Vendas e comissões › Minhas comissões",
          // Onde: performance/page.tsx:75 e :266-270 (MyCommissionsCard; só com bloco de vendas); link para a
          // memória = canSeeHref('/financeiro/comissoes') (hoje
          // canAccessModule(financeiro)||canAccessModule(vendas)) · Hoje: getUserCommissionsDigest →
          // resolveCommissionScope + scopeAllows (commissions/queries.ts:313-315): mesmo escopo de
          // financeiro.comissoes
          rule: "all",
        },
      ],
      actions: [
        {
          key: "performance.meu-desempenho.configurar",
          label: "Configurar o Índice de desempenho (pesos e indicadores por departamento)",
          verb: "configurar",
          // Hoje: src/server/kpis/actions.ts:298 user.isDirector; botão só com indexConfig para isDirector
          // (performance/page.tsx:71, :207) · Também chamada pela aba saude-indice de /admin/configuracoes
          // (settings-tabs.tsx:144): a aba usa esta chave. Grava settings direto sem changes
          // (kpis/actions.ts:260-279) → migrar para auditChanges (A16).
          rule: { director: true },
          guards: ["src/server/kpis/actions.ts#savePerformanceIndexSettings"],
        },
      ],
      scope: {
        entity: "colaborador exibido (sujeito ?usuario=)",
        ownerFields: ["users.id", "users.departmentId", "users.managerId", "departments.managerId"],
        allowed: ["meus", "equipe", "departamento", "empresa"],
        // Hoje: admin/diretoria: todos os ativos (getGoalPermissions src/server/kpis/queries.ts:390,
        // isDirector). gestor: ele + departamento próprio + departamentos que gere (departments.managerId) +
        // liderados diretos (semântica nº2, kpis/queries.ts:391-394 → performance/queries.ts:66). Demais: só o
        // próprio. ?usuario= fora do conjunto volta ao próprio (resolveSubjectId
        // performance/queries.ts:80-82).
        defaultByRole: {
          admin: "empresa",
          diretoria: "empresa",
          gestor: "departamento",
          marketing: "meus",
          vendas: "meus",
          financeiro: "meus",
          implantacao: "meus",
          cs: "meus",
          suporte: "meus",
          colaborador: "meus",
        },
        variants: {
          departamento: {
            ownDepartment: true,
            managedDepartments: true,
            departmentBy: "people",
            reportLevels: 1,
            includeSelf: true,
            description: "Seu departamento, os departamentos que você lidera e seus liderados diretos",
          },
        },
        applyAt: [
          "src/server/performance/queries.ts#getPerformanceAccess",
          "src/server/performance/queries.ts#resolveSubjectId",
          "src/app/(app)/performance/page.tsx",
          "src/server/performance/queries.ts#getMyPerformance",
          "src/server/commissions/queries.ts#getUserCommissionsDigest",
        ],
      },
    },
    {
      key: "performance.metas",
      module: "performance",
      label: "Metas",
      description: "Metas mensais por indicador (empresa, departamento, colaborador), com o atingimento calculado.",
      routes: ["/performance/metas"],
      // Hoje: src/app/(app)/performance/metas/page.tsx:18 requireUser; visibilidade por meta em getGoalsBoard
      // (kpis/queries.ts:447-453)
      rule: "all",
      nav: {
        // Hoje: NAVIGATION.performance (src/domain/constants.ts:186) filtrado por
        // canAccessModule(user,'performance') em src/app/(app)/layout.tsx:11 e src/app/(app)/menu/page.tsx:16
        menu: "performance",
        href: "/performance/metas",
        order: 2,
        label: "Metas",
        icon: "Goal",
        wave: 4,
      },
      sections: [],
      actions: [
        {
          key: "performance.metas.criar",
          label: "Criar meta",
          verb: "criar",
          // Hoje: kpis/actions.ts:156-197: getGoalPermissions + canManageGoal (l.161-162); role !== 'gestor' e
          // não diretor → nada
          rule: { manager: true },
          guards: ["src/server/kpis/actions.ts#upsertGoal?sem id"],
          recordCondition: "canManageGoal(escopo da meta) — meta de empresa só diretoria/admin",
        },
        {
          key: "performance.metas.editar",
          label: "Editar meta",
          verb: "editar",
          // Hoje: kpis/actions.ts:161-162 e :177 canManageGoal(getGoalPermissions) (kpis/queries.ts:387-401)
          rule: { manager: true },
          guards: ["src/server/kpis/actions.ts#upsertGoal?com id"],
          recordCondition: "canManageGoal(goal.scope, goal.scopeId)",
        },
        {
          key: "performance.metas.excluir",
          label: "Excluir meta",
          verb: "excluir",
          // Hoje: kpis/actions.ts:205-206 canManageGoal
          rule: { manager: true },
          guards: ["src/server/kpis/actions.ts#deleteGoal"],
          recordCondition: "canManageGoal(goal.scope, goal.scopeId)",
        },
        {
          key: "performance.metas.copiar",
          label: "Copiar metas do mês anterior",
          verb: "copiar",
          // Hoje: kpis/actions.ts:234 nega se !canCompany && departments vazio; :236 copia só as geríveis
          rule: { manager: true },
          guards: ["src/server/kpis/actions.ts#copyGoalsFromPreviousMonth"],
        },
      ],
      scope: {
        entity: "goals",
        ownerFields: ["goals.scope", "goals.scopeId"],
        allowed: ["meus", "equipe", "departamento", "empresa"],
        // Hoje: admin/diretoria: todas (kpis/queries.ts:448). gestor: próprias, do departamento próprio, TODAS
        // de empresa e as geríveis (l.449-451). Demais: as próprias e a do próprio departamento; metas de
        // empresa NÃO aparecem (l.449-452).
        defaultByRole: {
          admin: "empresa",
          diretoria: "empresa",
          gestor: "departamento",
          marketing: "meus",
          vendas: "meus",
          financeiro: "meus",
          implantacao: "meus",
          cs: "meus",
          suporte: "meus",
          colaborador: "meus",
        },
        variants: {
          departamento: {
            ownDepartment: true,
            managedDepartments: true,
            departmentBy: "people",
            reportLevels: 1,
            includeSelf: true,
            description: "Seu departamento, os departamentos que você lidera e seus liderados diretos",
          },
        },
        // 'meus' inclui a meta do próprio departamento; metas de empresa visíveis a partir de 'departamento'
        // (gestor).
        applyAt: [
          "src/server/kpis/queries.ts#getGoalsBoard",
          "src/server/kpis/queries.ts#getGoalPermissions",
          "src/server/kpis/queries.ts#canManageGoal",
          "src/server/kpis/actions.ts#upsertGoal/deleteGoal/copyGoalsFromPreviousMonth",
        ],
      },
    },
    {
      key: "performance.bonus",
      module: "performance",
      label: "Bônus e Premiação",
      description: "Projeção do bônus do mês com cálculo explicado, simulador, histórico e regulamento. A gestão vê a equipe, bloqueios e fechamento.",
      routes: ["/performance/bonus"],
      // Hoje: src/app/(app)/performance/bonus/page.tsx:37 requireUser + getPerformanceAccess/resolveSubjectId
      // (l.40-41)
      rule: "all",
      nav: {
        // Hoje: NAVIGATION.performance (src/domain/constants.ts:187) filtrado por
        // canAccessModule(user,'performance') em src/app/(app)/layout.tsx:11 e src/app/(app)/menu/page.tsx:16
        menu: "performance",
        href: "/performance/bonus",
        order: 3,
        label: "Bônus",
        icon: "Award",
        wave: 4,
      },
      sections: [
        {
          key: "performance.bonus.equipe.ver",
          label: "Aba Equipe e bloqueios",
          // Onde: performance/bonus/page.tsx:98-102 (aba) e :208-217 (BonusTeamPanel) · Hoje: data.canManage =
          // manageableIds com regra vigente (performance/queries.ts:301-304, 325); manageableIds só para
          // isManager (l.74)
          rule: { manager: true },
        },
        {
          key: "performance.bonus.regras.ver",
          label: "Regras de bônus",
          // Onde: /performance/bonus/regras (editor versionado); link só isAdmin (bonus/page.tsx:87) · Hoje:
          // src/app/(app)/performance/bonus/regras/page.tsx:12 requireRole('admin')
          rule: { role: "admin" },
          routes: ["/performance/bonus/regras"],
        },
      ],
      actions: [
        {
          key: "performance.bonus.equipe.bloquear",
          label: "Registrar bloqueio de bônus",
          verb: "bloquear",
          // Hoje: performance/actions.ts:63 isManager + :65 assertCanManage (l.51-54)
          rule: { manager: true },
          guards: ["src/server/performance/actions.ts#registerBonusBlock"],
          recordCondition: "alvo ∈ manageableIds (escopo)",
          sensitive: true,
        },
        {
          key: "performance.bonus.equipe.aprovar",
          label: "Confirmar bloqueio (zera o bônus do mês)",
          verb: "aprovar",
          // Hoje: performance/actions.ts:87-93 → decide() l.76 isManager + l.80 assertCanManage
          rule: { manager: true },
          guards: ["src/server/performance/actions.ts#confirmBonusBlock"],
          sensitive: true,
        },
        {
          key: "performance.bonus.equipe.cancelar",
          label: "Revogar bloqueio",
          verb: "cancelar",
          // Hoje: performance/actions.ts:96-102 → decide()
          rule: { manager: true },
          guards: ["src/server/performance/actions.ts#revokeBonusBlock"],
          sensitive: true,
        },
        {
          key: "performance.bonus.equipe.concluir",
          label: "Fechar competência (apurar e gravar bônus)",
          verb: "concluir",
          // Hoje: performance/actions.ts:115 isManager; :118 diretoria/admin = empresa, gestor =
          // manageableIds; UI canClose = isManager (bonus/page.tsx:217)
          rule: { manager: true },
          guards: ["src/server/performance/actions.ts#closeBonusPeriod"],
          sensitive: true,
        },
        {
          key: "performance.bonus.regras.editar",
          label: "Publicar nova versão da regra de bônus",
          verb: "editar",
          // Hoje: performance/actions.ts:164 user.isAdmin
          rule: { role: "admin" },
          guards: ["src/server/performance/actions.ts#saveBonusRule"],
          sensitive: true,
        },
      ],
      scope: {
        entity: "bônus do colaborador (bonus_results, bonus_blocks)",
        ownerFields: ["userId"],
        allowed: ["meus", "equipe", "departamento", "empresa"],
        // Hoje: Colaborador exibido como em Meu Desempenho. Aba Equipe e ações: manageableIds
        // (performance/queries.ts:74, sem o próprio salvo admin). Fechamento: diretoria/admin empresa; gestor
        // manageableIds (performance/actions.ts:118).
        defaultByRole: {
          admin: "empresa",
          diretoria: "empresa",
          gestor: "departamento",
          marketing: "meus",
          vendas: "meus",
          financeiro: "meus",
          implantacao: "meus",
          cs: "meus",
          suporte: "meus",
          colaborador: "meus",
        },
        variants: {
          departamento: {
            ownDepartment: true,
            managedDepartments: true,
            departmentBy: "people",
            reportLevels: 1,
            includeSelf: true,
            description: "Seu departamento, os departamentos que você lidera e seus liderados diretos",
          },
        },
        manageExcludesSelf: true,
        applyAt: [
          "src/server/performance/queries.ts#getPerformanceAccess",
          "src/server/performance/queries.ts#getBonusPageData",
          "src/server/performance/actions.ts#assertCanManage",
          "src/server/performance/actions.ts#closeBonusPeriod",
          "src/server/performance/bonus.ts#listBonusBlocks",
        ],
      },
    },
    {
      key: "performance.ranking",
      module: "performance",
      label: "Ranking",
      description: "Classificação por pontos (individual, equipe, departamento), medalhas, nível e campanhas ativas. Placar da empresa (sem escopo por dono).",
      routes: ["/performance/ranking"],
      // Hoje: src/app/(app)/performance/ranking/page.tsx:35 requireUser; ranking da empresa para todos
      // (performance/ranking.ts:216-228); link para o desempenho de outro só isManager com alvo em
      // access.userIds (page.tsx:53)
      rule: "all",
      nav: {
        // Hoje: NAVIGATION.performance (src/domain/constants.ts:188) filtrado por
        // canAccessModule(user,'performance') em src/app/(app)/layout.tsx:11 e src/app/(app)/menu/page.tsx:16
        menu: "performance",
        href: "/performance/ranking",
        order: 4,
        label: "Ranking",
        icon: "Trophy",
        wave: 4,
      },
      sections: [],
      actions: [],
      scope: null,
    },
    {
      key: "performance.campanhas",
      module: "performance",
      label: "Campanhas",
      description: "Campanhas e desafios de gamificação com meta por pessoa, prêmio e ranking próprio.",
      routes: ["/performance/campanhas"],
      // Hoje: src/app/(app)/performance/campanhas/page.tsx:13 requireUser; formulário só isManager (l.14, 20)
      rule: "all",
      nav: {
        // Hoje: NAVIGATION.performance (src/domain/constants.ts:189) filtrado por
        // canAccessModule(user,'performance') em src/app/(app)/layout.tsx:11 e src/app/(app)/menu/page.tsx:16
        menu: "performance",
        href: "/performance/campanhas",
        order: 5,
        label: "Campanhas",
        icon: "Sparkles",
        wave: 4,
      },
      sections: [],
      actions: [
        {
          key: "performance.campanhas.criar",
          label: "Criar campanha de gamificação",
          verb: "criar",
          // Hoje: performance/actions.ts:218 isManager
          rule: { manager: true },
          guards: ["src/server/performance/actions.ts#upsertCampaign?sem id"],
        },
        {
          key: "performance.campanhas.editar",
          label: "Editar campanha de gamificação",
          verb: "editar",
          // Hoje: performance/actions.ts:218 isManager (qualquer gestor edita qualquer campanha)
          rule: { manager: true },
          guards: ["src/server/performance/actions.ts#upsertCampaign?com id"],
        },
        {
          key: "performance.campanhas.excluir",
          label: "Excluir campanha de gamificação",
          verb: "excluir",
          // Hoje: performance/actions.ts:265 isManager
          rule: { manager: true },
          guards: ["src/server/performance/actions.ts#deleteCampaign"],
        },
      ],
      scope: {
        entity: "gamification_campaigns",
        ownerFields: ["departments[]", "participantIds[]", "ownerId"],
        allowed: ["meus", "departamento", "empresa"],
        // Hoje: admin/diretoria/gestor: todas, inclusive planejadas (campanhas/page.tsx:16). Demais: não
        // planejadas em que participa ou que incluem o próprio departamento. Filtro NA PÁGINA — descer para
        // getCampaignsProgress.
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
        // 'departamento' aqui = participo ∪ inclui meu departamento, e só não planejadas.
        applyAt: [
          "src/server/performance/queries.ts#getCampaignsProgress",
          "src/app/(app)/performance/campanhas/page.tsx",
          "src/server/performance/queries.ts#getCampaignFormOptions",
        ],
      },
    },
    {
      key: "performance.indicadores",
      module: "performance",
      label: "Indicador (detalhamento)",
      description: "Detalhamento de um indicador (valor, meta, tendência, fórmula e registros). A rota fica sob /gestao, mas é aberta a todos a partir de Meu Dia, Performance, Metas, Bônus e da busca — por isso pertence ao módulo performance (não desativa com o módulo Gestão).",
      routes: ["/gestao/indicadores/[kpiKey]"],
      // Hoje: src/app/(app)/gestao/indicadores/[kpiKey]/page.tsx:37 requireUser (sem módulo); não gestor
      // forçado ao próprio escopo (l.46-50)
      rule: "all",
      sections: [
        {
          key: "performance.indicadores.detalhamento.ver",
          label: "Quebra por colaborador e por departamento",
          // Onde: gestao/indicadores/[kpiKey]/page.tsx:58 (withBreakdown) e KpiBreakdownTable · Hoje:
          // getKpiDrilldown(..., { withBreakdown: user.isManager }) (page.tsx:58; kpis/queries.ts:298-305)
          rule: { manager: true },
        },
      ],
      actions: [],
      scope: {
        entity: "indicador por escopo (empresa | departamento | usuario)",
        ownerFields: ["escopo=usuario → userId (?id=)", "escopo=departamento → DepartmentKey (?id=)"],
        allowed: ["meus", "equipe", "departamento", "empresa"],
        // Hoje: isManager: qualquer escopo da empresa (page.tsx:41-56; gestor NÃO limitado à equipe). Demais:
        // forçados a usuario=self (page.tsx:46-50). getKpiDrilldown (kpis/queries.ts:298) sem viewer.
        defaultByRole: {
          admin: "empresa",
          diretoria: "empresa",
          gestor: "empresa",
          marketing: "meus",
          vendas: "meus",
          financeiro: "meus",
          implantacao: "meus",
          cs: "meus",
          suporte: "meus",
          colaborador: "meus",
        },
        applyAt: ["src/app/(app)/gestao/indicadores/[kpiKey]/page.tsx", "src/server/kpis/queries.ts#getKpiDrilldown"],
      },
    },
  ],
} as const satisfies ModuleDef;
