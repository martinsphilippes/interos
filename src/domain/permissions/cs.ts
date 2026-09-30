/**
 * Catálogo de acessos — módulo Customer Success (`cs.acessar`).
 *
 * Gerado UMA vez a partir do catálogo consolidado da etapa 6A (A24); daqui em diante este arquivo é a fonte de
 * verdade. Cada regra (`rule`) é a regra PADRÃO e reproduz o comportamento anterior ao catálogo; o comentário
 * "Hoje:" registra o predicado de origem. Ajustes por perfil/usuário não entram aqui (ficam em permission_profiles).
 */
import type { ModuleDef } from "./types";

export const CS = {
  key: "cs",
  label: "Customer Success",
  // Hoje: MODULE_ACCESS.cs (constants.ts:64) + admin
  rule: { role: ["admin", "diretoria", "gestor", "cs", "vendas", "suporte"] },
  deactivatable: true,
  screens: [
    {
      key: "cs.carteira",
      module: "cs",
      label: "Carteira",
      description: "Carteira de clientes do CS com filtros, saúde, próxima interação, indicadores e ativação de clientes recém-implantados.",
      routes: ["/cs"],
      // Hoje: src/app/(app)/cs/page.tsx:20-21 (M cs)
      rule: "all",
      nav: {
        // Hoje: NAVIGATION.cs (src/domain/constants.ts:162) filtrado por canAccessModule(user,'cs') em
        // src/app/(app)/layout.tsx:11 e src/app/(app)/menu/page.tsx:16
        menu: "cs",
        href: "/cs",
        order: 1,
        label: "Carteira",
        icon: "Briefcase",
        wave: 3,
      },
      sections: [
        {
          key: "cs.carteira.sugestoes.ver",
          label: "Sugestões do assistente de CS",
          // Onde: AgentSuggestions kind=cs na aba CS do Cliente 360 (clientes/[id]/page.tsx:76, hoje
          // canAccessModule(cs)) · Hoje: getAgentSuggestions: canAccessModule(user,'cs')
          // (automations/actions.ts:236)
          rule: "all",
          viewGuards: [
            {
              // Hoje: automations/actions.ts:236 (módulo cs)
              guard: "src/server/automations/actions.ts#getAgentSuggestions?kind=cs",
              label: "Gerar sugestões do assistente de CS",
            },
          ],
        },
      ],
      actions: [
        {
          key: "cs.carteira.ativar-cliente",
          label: "Ativar cliente (concluir o gate de ativação)",
          verb: "ativar-cliente",
          // Hoje: cs/actions.ts:251-261 → requireCsUser (cs/actions.ts:55-59 = só canAccessModule('cs')); gate
          // de negócio cs/service.ts:731-735 · Botão também na aba CS do Cliente 360 (client-cs-panel.tsx:43).
          rule: "all",
          guards: ["src/server/cs/actions.ts#activateCustomer"],
        },
      ],
      scope: {
        entity: "csAccounts/clients (carteira de CS)",
        ownerFields: ["csAccounts.ownerId", "clients.ownerCsId (fallback)"],
        allowed: ["meus", "equipe", "departamento", "empresa"],
        // Hoje: resolveScope (src/server/cs/queries.ts:80-85): departmentId==='cs' && !isManager → visão
        // inicial = própria carteira (l.83); qualquer outro → 'todos' (l.84). ?responsavel=todos|<qualquer id>
        // aceito para todos (l.81-82) e ScopeSelect oferece 'Toda a equipe' (scope-select.tsx:16) → alcance
        // efetivo = empresa para todos do módulo.
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
        initialView: {
          when: {
            all: [
              { department: "cs" },
              { role: ["marketing", "vendas", "financeiro", "implantacao", "cs", "suporte", "colaborador"] },
            ],
          },
          view: "meus",
          otherwise: "empresa",
        },
        applyAt: [
          "src/server/cs/queries.ts#resolveScope (limitar ?responsavel ao escopo efetivo)",
          "src/server/cs/queries.ts#getPortfolio",
          "src/server/cs/queries.ts#getCsOverview (sem chamadores)",
          "src/server/cs/queries.ts#listPortfolio (sem chamadores)",
          "src/server/cs/actions.ts#activateCustomer",
          "src/server/cs/actions.ts#registerCheckpoint",
        ],
      },
    },
    {
      key: "cs.saude",
      module: "cs",
      label: "Saúde dos clientes",
      description: "Distribuição por nível de saúde, pesos do score, lista por cliente e detalhe do score (drawer ?cliente=).",
      routes: ["/cs/saude"],
      // Hoje: src/app/(app)/cs/saude/page.tsx:31-32 (M cs); runDueSweeps(['saude_clientes']) como sistema
      // (l.35); getHealthDetail sem escopo (l.37)
      rule: "all",
      nav: {
        // Hoje: NAVIGATION.cs (src/domain/constants.ts:163) filtrado por canAccessModule(user,'cs') em
        // src/app/(app)/layout.tsx:11 e src/app/(app)/menu/page.tsx:16
        menu: "cs",
        href: "/cs/saude",
        order: 2,
        label: "Saúde",
        icon: "HeartPulse",
        wave: 3,
      },
      sections: [],
      actions: [
        {
          key: "cs.saude.recalcular",
          label: "Recalcular saúde de um cliente",
          verb: "recalcular",
          // Hoje: cs/actions.ts:76-87 → requireCsUser (cs/actions.ts:55-59 = só canAccessModule('cs'))
          rule: "all",
          guards: ["src/server/cs/actions.ts#recalculateHealth"],
        },
        {
          key: "cs.saude.recalcular-carteira",
          label: "Recalcular a saúde da carteira inteira",
          verb: "recalcular",
          // Hoje: cs/actions.ts:89-99: requireCsUser + user.isManager (l.92); botão só isManager
          // (cs/saude/page.tsx:61)
          rule: { manager: true },
          guards: ["src/server/cs/actions.ts#recalculateAllHealthAction"],
        },
      ],
      scope: {
        entity: "clients/csAccounts (saúde)",
        ownerFields: ["csAccounts.ownerId", "clients.ownerCsId"],
        allowed: ["meus", "equipe", "departamento", "empresa"],
        // Hoje: getHealthOverview (cs/queries.ts:404-405, 423) com resolveScope; getHealthDetail(clientId)
        // (l.465) sem escopo. resolveScope (src/server/cs/queries.ts:80-85): departmentId==='cs' && !isManager
        // → visão inicial = própria carteira (l.83); qualquer outro → 'todos' (l.84).
        // ?responsavel=todos|<qualquer id> aceito para todos (l.81-82) e ScopeSelect oferece 'Toda a equipe'
        // (scope-select.tsx:16) → alcance efetivo = empresa para todos do módulo.
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
        initialView: {
          when: {
            all: [
              { department: "cs" },
              { role: ["marketing", "vendas", "financeiro", "implantacao", "cs", "suporte", "colaborador"] },
            ],
          },
          view: "meus",
          otherwise: "empresa",
        },
        sameAs: "cs.carteira",
        applyAt: [
          "src/server/cs/queries.ts#getHealthOverview",
          "src/server/cs/queries.ts#getHealthDetail",
          "src/server/cs/actions.ts#recalculateHealth",
          "src/server/cs/actions.ts#recalculateAllHealthAction",
          "src/server/ai/context.ts:288",
        ],
      },
    },
    {
      key: "cs.checkpoints",
      module: "cs",
      label: "Checkpoints",
      description: "Agenda de próximas interações, clientes sem próxima interação e checkpoints recentes.",
      routes: ["/cs/checkpoints"],
      // Hoje: src/app/(app)/cs/checkpoints/page.tsx:26-27 (M cs)
      rule: "all",
      nav: {
        // Hoje: NAVIGATION.cs (src/domain/constants.ts:164) filtrado por canAccessModule(user,'cs') em
        // src/app/(app)/layout.tsx:11 e src/app/(app)/menu/page.tsx:16
        menu: "cs",
        href: "/cs/checkpoints",
        order: 3,
        label: "Checkpoints",
        icon: "CalendarCheck",
        wave: 3,
      },
      sections: [],
      actions: [
        {
          key: "cs.checkpoints.criar",
          label: "Registrar checkpoint",
          verb: "criar",
          // Hoje: cs/actions.ts:105-115 → requireCsUser (cs/actions.ts:55-59 = só canAccessModule('cs'));
          // cliente cancelado não recebe (cs/service.ts:300-302) · CheckpointDialog em /cs/checkpoints, /cs,
          // /cs/riscos, drawer de saúde e aba CS do Cliente 360.
          rule: "all",
          guards: ["src/server/cs/actions.ts#registerCheckpoint"],
        },
      ],
      scope: {
        entity: "clients/csAccounts (agenda)",
        ownerFields: ["csAccounts.ownerId", "clients.ownerCsId"],
        allowed: ["meus", "equipe", "departamento", "empresa"],
        // Hoje: getCheckpointAgenda (cs/queries.ts:547-548, 571) com resolveScope. resolveScope
        // (src/server/cs/queries.ts:80-85): departmentId==='cs' && !isManager → visão inicial = própria
        // carteira (l.83); qualquer outro → 'todos' (l.84). ?responsavel=todos|<qualquer id> aceito para todos
        // (l.81-82) e ScopeSelect oferece 'Toda a equipe' (scope-select.tsx:16) → alcance efetivo = empresa
        // para todos do módulo.
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
        initialView: {
          when: {
            all: [
              { department: "cs" },
              { role: ["marketing", "vendas", "financeiro", "implantacao", "cs", "suporte", "colaborador"] },
            ],
          },
          view: "meus",
          otherwise: "empresa",
        },
        sameAs: "cs.carteira",
        applyAt: ["src/server/cs/queries.ts#getCheckpointAgenda", "src/server/cs/actions.ts#registerCheckpoint"],
      },
    },
    {
      key: "cs.planos",
      module: "cs",
      label: "Plano de Sucesso",
      description: "Planos de sucesso por status, com drawer de criação/edição (?novo=1, ?plano=<id>), ações do plano e encerramento.",
      routes: ["/cs/planos"],
      // Hoje: src/app/(app)/cs/planos/page.tsx:34-35 (M cs); getSuccessPlan(planId) sem escopo (l.40)
      rule: "all",
      nav: {
        // Hoje: NAVIGATION.cs (src/domain/constants.ts:165) filtrado por canAccessModule(user,'cs') em
        // src/app/(app)/layout.tsx:11 e src/app/(app)/menu/page.tsx:16
        menu: "cs",
        href: "/cs/planos",
        order: 4,
        label: "Plano de Sucesso",
        icon: "Route",
        wave: 3,
      },
      sections: [],
      actions: [
        {
          key: "cs.planos.criar",
          label: "Criar plano de sucesso",
          verb: "criar",
          // Hoje: cs/actions.ts:121-132 → requireCsUser (cs/actions.ts:55-59 = só canAccessModule('cs'))
          rule: "all",
          guards: ["src/server/cs/actions.ts#saveSuccessPlan?sem id"],
        },
        {
          key: "cs.planos.editar",
          label: "Editar plano e marcar ações do plano",
          verb: "editar",
          // Hoje: cs/actions.ts:121-144 → requireCsUser (cs/actions.ts:55-59 = só canAccessModule('cs'))
          rule: "all",
          guards: ["src/server/cs/actions.ts#saveSuccessPlan?com id", "src/server/cs/actions.ts#togglePlanAction"],
        },
        {
          key: "cs.planos.concluir",
          label: "Encerrar plano (concluído ou cancelado)",
          verb: "concluir",
          // Hoje: cs/actions.ts:146-156 → requireCsUser (cs/actions.ts:55-59 = só canAccessModule('cs'))
          rule: "all",
          guards: ["src/server/cs/actions.ts#closePlan"],
        },
      ],
      scope: {
        entity: "successPlans",
        ownerFields: ["ownerId", "actions[].responsibleId"],
        allowed: ["meus", "equipe", "departamento", "empresa"],
        // Hoje: listSuccessPlans (cs/queries.ts:633-641) filtra ownerId === scope.ownerId; getSuccessPlan
        // (l.668-670) sem escopo. resolveScope (src/server/cs/queries.ts:80-85): departmentId==='cs' &&
        // !isManager → visão inicial = própria carteira (l.83); qualquer outro → 'todos' (l.84).
        // ?responsavel=todos|<qualquer id> aceito para todos (l.81-82) e ScopeSelect oferece 'Toda a equipe'
        // (scope-select.tsx:16) → alcance efetivo = empresa para todos do módulo.
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
        initialView: {
          when: {
            all: [
              { department: "cs" },
              { role: ["marketing", "vendas", "financeiro", "implantacao", "cs", "suporte", "colaborador"] },
            ],
          },
          view: "meus",
          otherwise: "empresa",
        },
        applyAt: [
          "src/server/cs/queries.ts#listSuccessPlans",
          "src/server/cs/queries.ts#getSuccessPlan",
          "src/server/cs/actions.ts#saveSuccessPlan/togglePlanAction/closePlan",
        ],
      },
    },
    {
      key: "cs.renovacoes",
      module: "cs",
      label: "Renovações",
      description: "Renovações abertas, contratos vencendo sem renovação e renovações encerradas; negociação, renovação (aditivo) e perda.",
      routes: ["/cs/renovacoes"],
      // Hoje: src/app/(app)/cs/renovacoes/page.tsx:33-34 (M cs); runDueSweeps(['renovacoes']) (l.36);
      // listRenewals() sem viewer (l.37)
      rule: "all",
      nav: {
        // Hoje: NAVIGATION.cs (src/domain/constants.ts:166) filtrado por canAccessModule(user,'cs') em
        // src/app/(app)/layout.tsx:11 e src/app/(app)/menu/page.tsx:16
        menu: "cs",
        href: "/cs/renovacoes",
        order: 5,
        label: "Renovações",
        icon: "RefreshCw",
        wave: 3,
      },
      sections: [],
      actions: [
        {
          key: "cs.renovacoes.criar",
          label: "Criar renovação para contrato",
          verb: "criar",
          // Hoje: cs/actions.ts:199-209 → requireCsUser (cs/actions.ts:55-59 = só canAccessModule('cs'));
          // cs/service.ts:889-895
          rule: "all",
          guards: ["src/server/cs/actions.ts#createRenewal"],
        },
        {
          key: "cs.renovacoes.negociar",
          label: "Iniciar negociação da renovação",
          verb: "negociar",
          // Hoje: cs/actions.ts:162-172 → requireCsUser (cs/actions.ts:55-59 = só canAccessModule('cs'))
          rule: "all",
          guards: ["src/server/cs/actions.ts#startNegotiation"],
        },
        {
          key: "cs.renovacoes.renovar",
          label: "Renovar contrato (gera e aplica aditivo de renovação)",
          verb: "renovar",
          // Hoje: cs/actions.ts:174-185 → só requireCsUser (cs/actions.ts:55-59 = só canAccessModule('cs'));
          // cs/service.ts:990-1036 cria e APLICA o aditivo (applyAmendment l.1010) sem requireFinanceOperator
          // · Chave própria exigida pela A14 (padrão = hoje). Recomendação (não padrão): exigir também
          // financeiro.contratos.aditivos.aplicar quando sem assinatura.
          rule: "all",
          guards: ["src/server/cs/actions.ts#renewContract"],
          sensitive: true,
        },
        {
          key: "cs.renovacoes.perder",
          label: "Registrar perda da renovação",
          verb: "perder",
          // Hoje: cs/actions.ts:187-197 → requireCsUser (cs/actions.ts:55-59 = só canAccessModule('cs')) ·
          // Depois a UI leva a /cs/churn?registrar=<clientId>, que exige cs.churn.registrar.
          rule: "all",
          guards: ["src/server/cs/actions.ts#markRenewalLost"],
        },
      ],
      scope: {
        entity: "renewals (+ contracts vencendo sem renovação)",
        ownerFields: ["renewals.ownerId", "clients.ownerCsId (linhas vindas de contracts)"],
        allowed: ["meus", "equipe", "departamento", "empresa"],
        // Hoje: SEM escopo: listRenewals() (cs/queries.ts:713-782) lista tudo para qualquer papel do módulo.
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
          "src/server/cs/queries.ts#listRenewals",
          "src/server/cs/actions.ts#startNegotiation/renewContract/markRenewalLost/createRenewal",
        ],
      },
    },
    {
      key: "cs.riscos",
      module: "cs",
      label: "Riscos",
      description: "Clientes em risco/atenção com motivos, MRR em risco, financeiro vencido, plano ativo, checkpoint e escalação ao gestor.",
      routes: ["/cs/riscos"],
      // Hoje: src/app/(app)/cs/riscos/page.tsx:99-100 (M cs)
      rule: "all",
      nav: {
        // Hoje: NAVIGATION.cs (src/domain/constants.ts:167) filtrado por canAccessModule(user,'cs') em
        // src/app/(app)/layout.tsx:11 e src/app/(app)/menu/page.tsx:16
        menu: "cs",
        href: "/cs/riscos",
        order: 6,
        label: "Riscos",
        icon: "AlertTriangle",
        wave: 3,
      },
      sections: [],
      actions: [
        {
          key: "cs.riscos.escalar",
          label: "Escalar risco ao gestor",
          verb: "escalar",
          // Hoje: cs/actions.ts:215-225 → requireCsUser (cs/actions.ts:55-59 = só canAccessModule('cs'));
          // cs/service.ts:662-666
          rule: "all",
          guards: ["src/server/cs/actions.ts#escalateToManager"],
        },
      ],
      scope: {
        entity: "clients/csAccounts",
        ownerFields: ["csAccounts.ownerId", "clients.ownerCsId"],
        allowed: ["meus", "equipe", "departamento", "empresa"],
        // Hoje: listRisks (cs/queries.ts:795-799) com resolveScope. resolveScope
        // (src/server/cs/queries.ts:80-85): departmentId==='cs' && !isManager → visão inicial = própria
        // carteira (l.83); qualquer outro → 'todos' (l.84). ?responsavel=todos|<qualquer id> aceito para todos
        // (l.81-82) e ScopeSelect oferece 'Toda a equipe' (scope-select.tsx:16) → alcance efetivo = empresa
        // para todos do módulo.
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
        initialView: {
          when: {
            all: [
              { department: "cs" },
              { role: ["marketing", "vendas", "financeiro", "implantacao", "cs", "suporte", "colaborador"] },
            ],
          },
          view: "meus",
          otherwise: "empresa",
        },
        sameAs: "cs.carteira",
        applyAt: ["src/server/cs/queries.ts#listRisks", "src/server/cs/actions.ts#escalateToManager"],
      },
    },
    {
      key: "cs.upsell",
      module: "cs",
      label: "Upsell",
      description: "Matriz produto × cliente da carteira e oportunidades de upsell/cross-sell originadas pelo CS.",
      routes: ["/cs/upsell"],
      // Hoje: src/app/(app)/cs/upsell/page.tsx:27-28 (M cs)
      rule: "all",
      nav: {
        // Hoje: NAVIGATION.cs (src/domain/constants.ts:168) filtrado por canAccessModule(user,'cs') em
        // src/app/(app)/layout.tsx:11 e src/app/(app)/menu/page.tsx:16
        menu: "cs",
        href: "/cs/upsell",
        order: 7,
        label: "Upsell",
        icon: "TrendingUp",
        wave: 3,
      },
      sections: [],
      actions: [
        {
          key: "cs.upsell.criar-oportunidade",
          label: "Gerar oportunidade de upsell/cross-sell",
          verb: "criar-oportunidade",
          // Hoje: cs/actions.ts:239-249 → requireCsUser (cs/actions.ts:55-59 = só canAccessModule('cs')) (não
          // exige módulo vendas); cs/service.ts:1189-1201
          rule: "all",
          guards: ["src/server/cs/actions.ts#generateUpsell"],
        },
      ],
      scope: {
        entity: "clients/csAccounts + opportunities de origem CS",
        ownerFields: ["csAccounts.ownerId", "clients.ownerCsId", "opportunities.ownerId"],
        allowed: ["meus", "equipe", "departamento", "empresa"],
        // Hoje: getUpsellMatrix (cs/queries.ts:850-877) com resolveScope. resolveScope
        // (src/server/cs/queries.ts:80-85): departmentId==='cs' && !isManager → visão inicial = própria
        // carteira (l.83); qualquer outro → 'todos' (l.84). ?responsavel=todos|<qualquer id> aceito para todos
        // (l.81-82) e ScopeSelect oferece 'Toda a equipe' (scope-select.tsx:16) → alcance efetivo = empresa
        // para todos do módulo.
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
        initialView: {
          when: {
            all: [
              { department: "cs" },
              { role: ["marketing", "vendas", "financeiro", "implantacao", "cs", "suporte", "colaborador"] },
            ],
          },
          view: "meus",
          otherwise: "empresa",
        },
        sameAs: "cs.carteira",
        applyAt: ["src/server/cs/queries.ts#getUpsellMatrix", "src/server/cs/actions.ts#generateUpsell"],
      },
    },
    {
      key: "cs.churn",
      module: "cs",
      label: "Churn",
      description: "Indicadores de churn, registros de cancelamento e registro de churn (?registrar=<clientId>).",
      routes: ["/cs/churn"],
      // Hoje: src/app/(app)/cs/churn/page.tsx:52-53 (M cs); getChurnMetrics/getChurnFormOptions sem viewer
      // (l.55)
      rule: "all",
      nav: {
        // Hoje: NAVIGATION.cs (src/domain/constants.ts:169) filtrado por canAccessModule(user,'cs') em
        // src/app/(app)/layout.tsx:11 e src/app/(app)/menu/page.tsx:16
        menu: "cs",
        href: "/cs/churn",
        order: 8,
        label: "Churn",
        icon: "UserMinus",
        wave: 3,
      },
      sections: [],
      actions: [
        {
          key: "cs.churn.registrar",
          label: "Registrar cancelamento (churn) — cancela produtos e contratos",
          verb: "registrar",
          // Hoje: cs/actions.ts:227-237 → só requireCsUser (cs/actions.ts:55-59 = só canAccessModule('cs'));
          // cs/service.ts:1083-1130 chama cancelContract (finance/service.ts:1667) · Chave própria exigida
          // pela A14 (padrão = hoje). Recomendação (não padrão): retirar de Vendas/Suporte.
          rule: "all",
          guards: ["src/server/cs/actions.ts#registerChurn"],
          sensitive: true,
        },
      ],
      scope: {
        entity: "churnRecords (+ clients do formulário)",
        ownerFields: ["churnRecords.responsibleId", "clients.ownerCsId"],
        allowed: ["meus", "equipe", "departamento", "empresa"],
        // Hoje: SEM escopo: getChurnMetrics (cs/queries.ts:944-) e getChurnFormOptions (l.1048-1063) tudo.
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
          "src/server/cs/queries.ts#getChurnMetrics",
          "src/server/cs/queries.ts#getChurnFormOptions",
          "src/server/cs/actions.ts#registerChurn",
        ],
      },
    },
  ],
} as const satisfies ModuleDef;
