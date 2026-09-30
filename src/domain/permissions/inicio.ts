/**
 * Catálogo de acessos — módulo Início (`inicio.acessar`).
 *
 * Gerado UMA vez a partir do catálogo consolidado da etapa 6A (A24); daqui em diante este arquivo é a fonte de
 * verdade. Cada regra (`rule`) é a regra PADRÃO e reproduz o comportamento anterior ao catálogo; o comentário
 * "Hoje:" registra o predicado de origem. Ajustes por perfil/usuário não entram aqui (ficam em permission_profiles).
 */
import type { ModuleDef } from "./types";

export const INICIO = {
  key: "inicio",
  label: "Início",
  // Hoje: MODULE_ACCESS.inicio = "all" (src/domain/constants.ts:58)
  rule: "all",
  deactivatable: false,
  protected: true,
  screens: [
    {
      key: "inicio.meu-dia",
      module: "inicio",
      label: "Meu Dia",
      description: "Tela operacional principal: prioridades unificadas e blocos de apoio por perfil. Destino de todos os redirects de acesso negado (?erro=sem-permissao).",
      routes: ["/meu-dia"],
      protected: true,
      // Hoje: requireUser() (src/app/(app)/meu-dia/page.tsx:29); módulo inicio = "all"
      // (src/domain/constants.ts:58). CHAVE PROTEGIDA (A9 I4): inicio.meu-dia.ver não pode ser negada (evita
      // loop de redirect).
      rule: "all",
      nav: {
        // Hoje: NAVIGATION.inicio (src/domain/constants.ts:96) filtrado por canAccessModule(user,'inicio') em
        // src/app/(app)/layout.tsx:11 e src/app/(app)/menu/page.tsx:16
        menu: "inicio",
        href: "/meu-dia",
        order: 1,
        label: "Meu Dia",
        icon: "Sun",
        // Hoje: MOBILE_NAV (src/domain/constants.ts:222) sem filtro hoje (mobile-nav.tsx:42-44); derivado de
        // can(tela.ver), equivalente porque a regra efetiva é 'todos'
        mobile: 1,
      },
      sections: [
        {
          key: "inicio.meu-dia.prioridades.ver",
          label: "Prioridades e resumo",
          // Onde: MeuDiaHeader + PrioritiesList (meu-dia/page.tsx:52-54); itens de byOwner(ids) em
          // src/server/meu-dia/queries.ts:377-403 · Hoje: requireUser (meu-dia/page.tsx:29)
          rule: "all",
        },
        {
          key: "inicio.meu-dia.equipe.ver",
          label: "Visão da equipe",
          // Onde: Alternância ?escopo=equipe (meu-dia/page.tsx:31) + TeamBlock (page.tsx:58) · Hoje: canToggle
          // = user.isManager (src/server/meu-dia/queries.ts:246-247); TeamBlock só com scope 'equipe'
          // (page.tsx:41,58)
          rule: { manager: true },
        },
        {
          key: "inicio.meu-dia.insights.ver",
          label: "Alertas de gestão (insights)",
          // Onde: InsightsBlock (meu-dia/page.tsx:57) · Hoje: showInsights = isManager || isDirector
          // (meu-dia/page.tsx:35) ≡ isManager; getTopInsightsForUser devolve [] se !isManager
          // (src/server/insights/engine.ts:95)
          rule: { manager: true },
        },
        {
          key: "inicio.meu-dia.financeiro.ver",
          label: "Financeiro do dia (fila da equipe financeira)",
          // Onde: FinanceBlock perfil 'financeiro' (meu-dia/page.tsx:62; queries.ts:958-1011): cobranças,
          // títulos a pagar, comissões liberadas, fila de contratos · Hoje: profileOf().finance =
          // isFinanceTeam(user) (meu-dia/queries.ts:279-281; commissions/permissions.ts:18-20)
          rule: { any: [{ role: ["admin", "diretoria", "financeiro"] }, { department: "financeiro" }] },
        },
        {
          key: "inicio.meu-dia.cobrancas-vendas.ver",
          label: "Cobranças vencidas e contratos das minhas vendas (perfil vendedor)",
          // Onde: FinanceBlock perfil 'vendas' (meu-dia/queries.ts:1012-1028) + contratos aguardando
          // assinatura das próprias vendas (queries.ts:413-422) · Hoje: profileOf().sales = isSeller(user) ||
          // members.some(isSeller) (meu-dia/queries.ts:280-281); para gestor/diretoria depende de haver
          // vendedor na equipe exibida (condição de DADOS, continua na consulta); perfil financeiro tem
          // precedência (else-if queries.ts:1012)
          rule: { any: [{ role: "vendas" }, { department: "vendas" }, { manager: true }] },
        },
        {
          key: "inicio.meu-dia.contratos.ver",
          label: "Contratos pendentes",
          // Onde: ContractsBlock (meu-dia/page.tsx:63; queries.ts:414-422) · Hoje: requireUser; próprios +
          // fila inteira se perfil financeiro + das próprias vendas se vendedor (queries.ts:419-421)
          rule: "all",
        },
        {
          key: "inicio.meu-dia.agenda.ver",
          label: "Agenda e visitas",
          // Onde: AgendaBlock (meu-dia/page.tsx:59) · Hoje: requireUser; visitas por sellerId ∈ escopo
          // (queries.ts:388)
          rule: "all",
        },
        {
          key: "inicio.meu-dia.aguardando.ver",
          label: "Clientes aguardando retorno",
          // Onde: AwaitingBlock (meu-dia/page.tsx:60; queries.ts:793-838); link para
          // /marketing/caixa-de-entrada (components/meu-dia/blocks.tsx:357) deve passar por canSeeHref · Hoje:
          // requireUser
          rule: "all",
        },
        {
          key: "inicio.meu-dia.followups.ver",
          label: "Follow-ups (leads e oportunidades)",
          // Onde: FollowupsBlock (meu-dia/page.tsx:61; queries.ts:1117-1126) · Hoje: requireUser;
          // leads/oportunidades por ownerId ∈ escopo (queries.ts:380-381)
          rule: "all",
        },
        {
          key: "inicio.meu-dia.etapas.ver",
          label: "Etapas de workflow comigo",
          // Onde: StepsBlock (meu-dia/page.tsx:64) · Hoje: requireUser; workflowSteps.assigneeId ∈ escopo
          // (queries.ts:379)
          rule: "all",
        },
        {
          key: "inicio.meu-dia.clientes-atencao.ver",
          label: "Clientes que precisam de atenção",
          // Onde: AttentionClientsBlock (meu-dia/page.tsx:65; queries.ts:690-735) · Hoje: requireUser;
          // clients.ownerCsId ∈ escopo (queries.ts:385)
          rule: "all",
        },
        {
          key: "inicio.meu-dia.metas.ver",
          label: "Metas do mês",
          // Onde: GoalsBlock (meu-dia/page.tsx:66; computeGoals queries.ts:298-306) · Hoje: requireUser; metas
          // da EMPRESA só para isDirector (queries.ts:306)
          rule: "all",
        },
        {
          key: "inicio.meu-dia.notificacoes.ver",
          label: "Notificações recentes",
          // Onde: NotificationsBlock (meu-dia/page.tsx:67) · Hoje: requireUser; só do próprio userId
          // (queries.ts:390)
          rule: "all",
        },
      ],
      actions: [],
      scope: {
        entity: "agregado (tasks, workflowSteps, leads, opportunities, implementationProjects, supportTickets, clients, csAccounts, renewals, slaInstances, visits, trainings, contracts, successPlans, goals)",
        ownerFields: [
          "tasks.assigneeId",
          "workflowSteps.assigneeId",
          "leads.ownerId",
          "opportunities.ownerId",
          "implementationProjects.ownerId",
          "supportTickets.assigneeId",
          "clients.ownerCsId",
          "csAccounts.ownerId",
          "renewals.ownerId",
          "slaInstances.ownerId",
          "visits.sellerId",
          "trainings.instructorId",
          "contracts.ownerId",
          "contracts.sellerId",
          "successPlans.ownerId",
          "goals.scopeId",
        ],
        allowed: ["meus", "equipe", "empresa"],
        // Hoje: Visão inicial SEMPRE 'meus' para todos; ?escopo=equipe só para isManager
        // (meu-dia/queries.ts:246-247). Equipe: gestor = ele + usuários com managerId === ele (1 nível, SEM
        // departamentos geridos) (queries.ts:248); diretoria/admin (isDirector) = todos os ativos = empresa
        // (queries.ts:248). Demais: sempre meus. Filtro por byOwner(field, ids) (queries.ts:228-232, 377-403).
        defaultByRole: {
          admin: "empresa",
          diretoria: "empresa",
          gestor: "equipe",
          marketing: "meus",
          vendas: "meus",
          financeiro: "meus",
          implantacao: "meus",
          cs: "meus",
          suporte: "meus",
          colaborador: "meus",
        },
        initialView: "meus",
        variants: { equipe: { reportLevels: 1, includeSelf: true, description: "Você e seus liderados diretos" } },
        applyAt: [
          "src/server/meu-dia/queries.ts#resolveScope",
          "src/server/meu-dia/queries.ts#getMeuDia",
          "src/server/meu-dia/queries.ts#computeGoals",
          "src/server/insights/engine.ts#getTopInsightsForUser",
        ],
      },
    },
    {
      key: "inicio.notificacoes",
      module: "inicio",
      label: "Notificações",
      description: "Central de notificações do próprio usuário (filtros por leitura e tipo).",
      routes: ["/notificacoes"],
      // Hoje: requireUser() (src/app/(app)/notificacoes/page.tsx:22); listNotifications(user.id) (page.tsx:28)
      rule: "all",
      nav: {
        // Hoje: NAVIGATION.inicio (src/domain/constants.ts:97) filtrado por canAccessModule(user,'inicio') em
        // src/app/(app)/layout.tsx:11 e src/app/(app)/menu/page.tsx:16
        menu: "inicio",
        href: "/notificacoes",
        order: 2,
        label: "Notificações",
        icon: "Bell",
      },
      sections: [],
      actions: [
        {
          key: "inicio.notificacoes.editar",
          label: "Marcar como lida / marcar todas como lidas",
          verb: "editar",
          // Hoje: requireUser (notifications/actions.ts:33, 46; fora do try) + loadOwn (actions.ts:26-30:
          // notification.userId === user.id) · Só sobre registros próprios (escopo fixo 'meus').
          rule: "all",
          guards: ["src/server/notifications/actions.ts#markRead", "src/server/notifications/actions.ts#markAllRead"],
        },
        {
          key: "inicio.notificacoes.excluir",
          label: "Excluir notificação",
          verb: "excluir",
          // Hoje: requireUser (notifications/actions.ts:57) + loadOwn (actions.ts:26-30)
          rule: "all",
          guards: ["src/server/notifications/actions.ts#deleteNotification"],
        },
      ],
      scope: {
        entity: "notifications",
        ownerFields: ["userId"],
        allowed: ["meus"],
        // Hoje: Todos os papéis: só as próprias (notificacoes/page.tsx:28; notifications/actions.ts:26-30;
        // layout.tsx:22 contador). Escopo fixo, não configurável.
        defaultByRole: {
          admin: "meus",
          diretoria: "meus",
          gestor: "meus",
          marketing: "meus",
          vendas: "meus",
          financeiro: "meus",
          implantacao: "meus",
          cs: "meus",
          suporte: "meus",
          colaborador: "meus",
        },
        fixed: true,
        applyAt: ["src/server/notifications.ts#listNotifications", "src/server/notifications/actions.ts#loadOwn"],
      },
    },
    {
      key: "inicio.menu",
      module: "inicio",
      label: "Menu (Mais)",
      description: "Página 'Mais' do mobile: lista as seções e itens de navegação visíveis ao usuário. Conteúdo derivado das permissões efetivas.",
      routes: ["/menu"],
      // Hoje: requireUser() (src/app/(app)/menu/page.tsx:15) + filtro duplicado do layout:
      // canAccessModule(section.key) e item.roles (menu/page.tsx:16-19)
      rule: "all",
      nav: {
        // Não é item de NAVIGATION: /menu é o 4º item de MOBILE_NAV ('Mais'); o conteúdo é o próprio menu
        // derivado.
        menu: null,
        href: "/menu",
        // Hoje: MOBILE_NAV (src/domain/constants.ts:225) sem filtro hoje (mobile-nav.tsx:42-44); derivado de
        // can(tela.ver), equivalente porque a regra efetiva é 'todos'
        mobile: 4,
      },
      sections: [],
      actions: [],
      scope: null,
    },
    {
      key: "inicio.em-construcao",
      module: "inicio",
      label: "Tela em construção",
      description: "Catch-all que mostra 'Módulo em construção' para hrefs de navegação sem página; notFound para o resto. Hoje inalcançável (todos os hrefs têm page.tsx).",
      routes: ["/[...slug]"],
      // Hoje: findNavItem → notFound (src/app/(app)/[...slug]/page.tsx:16-22, 35); requireUser (l.37);
      // EmptyState 'Sem permissão' se !canAccessModule(user, section.key) (l.39) — ignora item.roles. A14:
      // passa a exigir a tela do href (canSeeHref).
      rule: "all",
      sections: [],
      actions: [],
      scope: null,
    },
    {
      key: "inicio.barra-superior",
      module: "inicio",
      label: "Barra superior e atalhos",
      description: "Pseudo-tela sem page.tsx própria (shell de (app)/layout.tsx): busca global, seletor de presença, sino, botão '+' de ações rápidas, navegação lateral/mobile e menus de ajuda/usuário. Abriga as regras de visibilidade desses controles.",
      routes: [],
      virtual: true,
      hostRoutes: ["(layout)"],
      // Hoje: requireUser() em src/app/(app)/layout.tsx:10 (todas as páginas autenticadas)
      rule: "all",
      sections: [
        {
          key: "inicio.barra-superior.busca.ver",
          label: "Busca global",
          // Onde: GlobalSearch (src/components/layout/global-search.tsx) via searchGlobal; SHORTCUTS
          // (global-search.tsx:42-51) · Hoje: requireUser (search/actions.ts:13); 'automacao' só role admin
          // (search/actions.ts:16; search/queries.ts:330-335). A14: resultados passam a ser filtrados por
          // canSeeHref + escopo da tela de destino.
          rule: "all",
        },
        {
          key: "inicio.barra-superior.presenca.ver",
          label: "Seletor de presença (Online/Ausente/Ocupado)",
          // Onde: PresenceSelect (components/layout/presence-select.tsx), prop showPresence · Hoje:
          // showPresence = user.isManager || PRESENCE_ROLES.includes(user.role) (src/app/(app)/layout.tsx:7,
          // 18) — só visibilidade; setPresence é exceção justificada
          rule: { any: [{ manager: true }, { role: ["vendas", "suporte", "cs", "implantacao"] }] },
        },
        {
          key: "inicio.barra-superior.acoes-rapidas.ver",
          label: "Ações rápidas (botão +)",
          // Onde: QUICK_ACTIONS (constants.ts:243-258) filtradas em (app)/layout.tsx:15-17 · Hoje:
          // canAccessModule(action.module) && (isAdmin || !roles || roles.includes(role))
          // (src/app/(app)/layout.tsx:15-17) sobre QUICK_ACTIONS (src/domain/constants.ts:243-258). Derivação
          // estruturada: cada atalho = nav.quickAction da tela dona; visível = can(via) ∧ quickAction.rule.
          // tarefa→operacao.tarefas (via operacao.tarefas.criar, rule all); lead→marketing.leads
          // (marketing.leads.criar, all); oportunidade→vendas.oportunidades (vendas.oportunidades.criar,
          // {role:[admin,diretoria,gestor,vendas,cs]}); chamado→suporte.chamados (suporte.chamados.criar,
          // all); visita→vendas.visitas (vendas.visitas.criar, {role:[admin,diretoria,gestor,vendas]});
          // cliente→operacao.clientes (operacao.clientes.criar, all).
          rule: "all",
        },
        {
          key: "inicio.barra-superior.navegacao.ver",
          label: "Menu lateral, navegação mobile, ajuda e menu do usuário",
          // Onde: NAVIGATION (layout.tsx:11-14), MOBILE_NAV (constants.ts:221-226, hoje sem filtro),
          // help-menu.tsx:9-13, user-menu.tsx:115-124 · Hoje: requireUser; cada item passa a usar
          // canSeeHref(href) (A11) Derivação: item de menu = tela com nav.menu ≠ null; visível = can(tela.ver)
          // ∧ nav.rule (quando houver); seção do menu aparece se tiver algum item visível; MOBILE_NAV = telas
          // com nav.mobile.
          rule: "all",
        },
      ],
      actions: [],
      scope: null,
    },
  ],
} as const satisfies ModuleDef;
