/**
 * Catálogo de acessos — módulo Suporte (`suporte.acessar`).
 *
 * Gerado UMA vez a partir do catálogo consolidado da etapa 6A (A24); daqui em diante este arquivo é a fonte de
 * verdade. Cada regra (`rule`) é a regra PADRÃO e reproduz o comportamento anterior ao catálogo; o comentário
 * "Hoje:" registra o predicado de origem. Ajustes por perfil/usuário não entram aqui (ficam em permission_profiles).
 */
import type { ModuleDef } from "./types";

export const SUPORTE = {
  key: "suporte",
  label: "Suporte",
  // Hoje: MODULE_ACCESS.suporte (constants.ts:65) + admin
  rule: { role: ["admin", "diretoria", "gestor", "suporte", "implantacao", "cs"] },
  deactivatable: true,
  screens: [
    {
      key: "suporte.central",
      module: "suporte",
      label: "Central de Suporte",
      description: "Workspace do atendente (fila, conversa e contexto) e painel de qualidade (?view=painel) com SLA, CSAT e reincidência. As ações sobre chamados usam as chaves de suporte.chamados.",
      routes: ["/suporte"],
      // Hoje: src/app/(app)/suporte/page.tsx:62-63 (M suporte)
      rule: "all",
      nav: {
        // Hoje: NAVIGATION.suporte (src/domain/constants.ts:176) filtrado por canAccessModule(user,'suporte')
        // em src/app/(app)/layout.tsx:11 e src/app/(app)/menu/page.tsx:16
        menu: "suporte",
        href: "/suporte",
        order: 1,
        label: "Central de Suporte",
        icon: "Headset",
      },
      sections: [
        {
          key: "suporte.central.workspace.ver",
          label: "Workspace do atendente",
          // Onde: suporte/page.tsx:117-169 (SupportWorkspace; QUEUE_TABS são filtros de UI) · Hoje: só módulo
          rule: "all",
        },
        {
          key: "suporte.central.painel.ver",
          label: "Painel de qualidade",
          // Onde: suporte/page.tsx:67, 108-114 (?view=painel → SupportPanel) · Hoje: só módulo
          rule: "all",
        },
      ],
      actions: [
        {
          key: "suporte.central.executar-varredura",
          label: "Verificar alertas de SLA agora",
          verb: "executar-varredura",
          // Hoje: requireOperator (support/actions.ts:63-67) = canOperateSupport (support/schemas.ts:82-84),
          // SEM canAccessModule (support/actions.ts:279-281) · Sem chamador na UI; a página roda
          // maybeRunSlaAlerts como sistema (page.tsx:70-75).
          rule: { any: [{ manager: true }, { role: ["suporte", "implantacao"] }, { department: "suporte" }] },
          guards: ["src/server/support/actions.ts#runSlaAlertsAction"],
        },
      ],
      scope: {
        entity: "supportTickets (+ csat.attendantId nos indicadores)",
        ownerFields: ["assigneeId"],
        allowed: ["meus", "equipe", "empresa"],
        // Hoje: getSupportOverview (support/queries.ts:354-358): 'minha' = assigneeId===user || (sem atendente
        // && aberto); 'equipe' = todos. Visão inicial = equipe se isManager, minha para os demais (l.355), mas
        // ?escopo=equipe é aceito de qualquer papel (suporte/page.tsx:31-52, 65-66) → teto = empresa.
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
        initialView: { when: { manager: true }, view: "empresa", otherwise: "meus" },
        sameAs: "suporte.chamados",
        poolUnassigned: true,
        applyAt: [
          "src/server/support/queries.ts#getSupportOverview",
          "src/app/(app)/suporte/page.tsx (getTicket do ?chamado=)",
        ],
      },
    },
    {
      key: "suporte.chamados",
      module: "suporte",
      label: "Chamados",
      description: "Histórico de chamados com filtros e a página do chamado (conversa, status, cliente, classificação, anexos). Dona das ações de chamado (também usadas na Central).",
      routes: ["/suporte/chamados", "/suporte/chamados/[id]"],
      // Hoje: suporte/chamados/page.tsx:21-22 e chamados/[id]/page.tsx:29-30 (M suporte; notFound l.33).
      // generateMetadata do detalhe chama getTicketTitle antes da guarda (l.22-25).
      rule: "all",
      nav: {
        // Hoje: NAVIGATION.suporte (src/domain/constants.ts:177) filtrado por canAccessModule(user,'suporte')
        // em src/app/(app)/layout.tsx:11 e src/app/(app)/menu/page.tsx:16
        menu: "suporte",
        href: "/suporte/chamados",
        order: 2,
        label: "Chamados",
        icon: "Ticket",
        quickAction: {
          key: "chamado",
          label: "Novo chamado",
          description: "Registre um atendimento",
          href: "/suporte/chamados?novo=1",
          icon: "Ticket",
          order: 4,
          via: "suporte.chamados.criar",
          rule: "all",
        },
      },
      sections: [
        {
          key: "suporte.chamados.cliente.ver",
          label: "Contexto do cliente no chamado (contrato, produtos, histórico)",
          // Onde: components/support/ticket-side-panels.tsx:35-90 (contract.monthlyTotal l.85 sob
          // financeiro.valores.ver); support/queries.ts:497, 514 · Hoje: só módulo
          rule: "all",
        },
        {
          key: "suporte.chamados.csat.ver",
          label: "Link público da pesquisa CSAT",
          // Onde: support/queries.ts:517 (csatLink se resolvido/fechado e canOperateSupport) · Hoje:
          // canOperateSupport(user) em support/queries.ts:517
          rule: { any: [{ manager: true }, { role: ["suporte", "implantacao"] }, { department: "suporte" }] },
        },
        {
          key: "suporte.chamados.sugestoes.ver",
          label: "Sugestões do assistente no chamado",
          // Onde: chamados/[id]/page.tsx:113 (AgentSuggestions kind=suporte) · Hoje: getAgentSuggestions:
          // canAccessModule(user,'suporte') (automations/actions.ts:224,236)
          rule: "all",
          viewGuards: [
            {
              // Hoje: automations/actions.ts:236 (módulo suporte)
              guard: "src/server/automations/actions.ts#getAgentSuggestions?kind=suporte",
              label: "Gerar sugestões do assistente de suporte",
            },
          ],
        },
      ],
      actions: [
        {
          key: "suporte.chamados.criar",
          label: "Abrir chamado",
          verb: "criar",
          // Hoje: só requireUser (support/actions.ts:80-83, 94-96) — qualquer autenticado. Entradas de UI só
          // com módulo: QUICK_ACTIONS 'chamado' (constants.ts:255), suporte/page.tsx:102,
          // chamados/page.tsx:40, Cliente 360 (clientes/[id]/page.tsx:47-49,83) · A14: efetivo passa a 'quem
          // tem o módulo suporte' = quem vê a entrada hoje.
          rule: "all",
          guards: [
            "src/server/support/actions.ts#createTicketAction",
            "src/server/support/actions.ts#loadClientTicketContext",
          ],
        },
        {
          key: "suporte.chamados.assumir",
          label: "Assumir chamado",
          verb: "assumir",
          // Hoje: requireOperator (support/actions.ts:63-67) = canOperateSupport (support/schemas.ts:82-84),
          // SEM canAccessModule (l.104-106)
          rule: { any: [{ manager: true }, { role: ["suporte", "implantacao"] }, { department: "suporte" }] },
          guards: ["src/server/support/actions.ts#assumeTicketAction"],
        },
        {
          key: "suporte.chamados.atribuir",
          label: "Atribuir / transferir chamado (atendente ou fila)",
          verb: "atribuir",
          // Hoje: requireOperator (support/actions.ts:63-67) = canOperateSupport (support/schemas.ts:82-84),
          // SEM canAccessModule (l.116-118, 180-182) · assignTicketAction sem chamador na UI.
          rule: { any: [{ manager: true }, { role: ["suporte", "implantacao"] }, { department: "suporte" }] },
          guards: ["src/server/support/actions.ts#assignTicketAction", "src/server/support/actions.ts#transferTicketAction"],
        },
        {
          key: "suporte.chamados.enviar",
          label: "Responder ao cliente",
          verb: "enviar",
          // Hoje: requireOperator (support/actions.ts:63-67) = canOperateSupport (support/schemas.ts:82-84),
          // SEM canAccessModule (l.129-131); replyToTicket auto-atribui se sem atendente
          // (support/service.ts:406-408)
          rule: { any: [{ manager: true }, { role: ["suporte", "implantacao"] }, { department: "suporte" }] },
          guards: ["src/server/support/actions.ts#replyTicketAction"],
        },
        {
          key: "suporte.chamados.registrar",
          label: "Registrar ligação ou nota interna",
          verb: "registrar",
          // Hoje: requireOperator (support/actions.ts:63-67) = canOperateSupport (support/schemas.ts:82-84),
          // SEM canAccessModule (l.154-156, 141-143)
          rule: { any: [{ manager: true }, { role: ["suporte", "implantacao"] }, { department: "suporte" }] },
          guards: ["src/server/support/actions.ts#registerCallAction", "src/server/support/actions.ts#addNoteAction"],
        },
        {
          key: "suporte.chamados.anexar",
          label: "Adicionar anexo",
          verb: "anexar",
          // Hoje: requireOperator (support/actions.ts:63-67) = canOperateSupport (support/schemas.ts:82-84),
          // SEM canAccessModule (l.166-168)
          rule: { any: [{ manager: true }, { role: ["suporte", "implantacao"] }, { department: "suporte" }] },
          guards: ["src/server/support/actions.ts#addAttachmentAction"],
        },
        {
          key: "suporte.chamados.classificar",
          label: "Classificar (produto, categoria, criticidade, fila)",
          verb: "classificar",
          // Hoje: requireOperator (support/actions.ts:63-67) = canOperateSupport (support/schemas.ts:82-84),
          // SEM canAccessModule (l.192-194); mudar criticidade recalcula o SLA (service.ts:616-643)
          rule: { any: [{ manager: true }, { role: ["suporte", "implantacao"] }, { department: "suporte" }] },
          guards: ["src/server/support/actions.ts#classifyTicketAction"],
        },
        {
          key: "suporte.chamados.pausar",
          label: "Aguardar cliente / retomar (pausa o SLA)",
          verb: "pausar",
          // Hoje: requireOperator (support/actions.ts:63-67) = canOperateSupport (support/schemas.ts:82-84),
          // SEM canAccessModule (l.204-206, 216-218)
          rule: { any: [{ manager: true }, { role: ["suporte", "implantacao"] }, { department: "suporte" }] },
          guards: ["src/server/support/actions.ts#waitingClientAction", "src/server/support/actions.ts#resumeTicketAction"],
        },
        {
          key: "suporte.chamados.concluir",
          label: "Resolver chamado",
          verb: "concluir",
          // Hoje: requireOperator (support/actions.ts:63-67) = canOperateSupport (support/schemas.ts:82-84),
          // SEM canAccessModule (l.228-230)
          rule: { any: [{ manager: true }, { role: ["suporte", "implantacao"] }, { department: "suporte" }] },
          guards: ["src/server/support/actions.ts#resolveTicketAction"],
        },
        {
          key: "suporte.chamados.fechar",
          label: "Fechar chamado resolvido",
          verb: "fechar",
          // Hoje: requireOperator (support/actions.ts:63-67) = canOperateSupport (support/schemas.ts:82-84),
          // SEM canAccessModule (l.240-242); exige status resolvido (service.ts:750)
          rule: { any: [{ manager: true }, { role: ["suporte", "implantacao"] }, { department: "suporte" }] },
          guards: ["src/server/support/actions.ts#closeTicketAction"],
        },
        {
          key: "suporte.chamados.reabrir",
          label: "Reabrir chamado (reincidência)",
          verb: "reabrir",
          // Hoje: só requireUser (support/actions.ts:252-254); botão para todos que veem o chamado · A14:
          // passa a exigir módulo + tela.
          rule: "all",
          guards: ["src/server/support/actions.ts#reopenTicketAction"],
        },
        {
          key: "suporte.chamados.criar-oportunidade",
          label: "Gerar oportunidade comercial a partir do chamado",
          verb: "criar-oportunidade",
          // Hoje: requireOperator (support/actions.ts:63-67) = canOperateSupport (support/schemas.ts:82-84),
          // SEM canAccessModule (l.265-267); não checa o módulo vendas · Recomendação (não padrão): exigir
          // também vendas.acessar.
          rule: { any: [{ manager: true }, { role: ["suporte", "implantacao"] }, { department: "suporte" }] },
          guards: ["src/server/support/actions.ts#createTicketOpportunityAction"],
          sensitive: true,
        },
      ],
      scope: {
        entity: "supportTickets",
        ownerFields: ["assigneeId"],
        allowed: ["meus", "equipe", "empresa"],
        // Hoje: Empresa para todos com módulo: listTickets() sem viewer (support/queries.ts:281-294);
        // getTicket(id,user) não filtra por dono (l.439-441); getTicketTitle sem viewer (l.434-437); ações por
        // id via loadTicket (service.ts:104-106) sem checar atendente.
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
        poolUnassigned: true,
        applyAt: [
          "src/server/support/queries.ts#listTickets",
          "src/server/support/queries.ts#getTicket",
          "src/server/support/queries.ts#getTicketTitle (generateMetadata)",
          "src/server/support/queries.ts#getClientSupport",
          "src/server/support/queries.ts#getSlaReport",
          "src/server/support/queries.ts#getCsatReport",
          "src/server/support/service.ts#loadTicket",
          "src/server/ai/context.ts#buildSupportContext",
          "src/server/search/queries.ts (chamados)",
        ],
      },
    },
    {
      key: "suporte.base-de-conhecimento",
      module: "suporte",
      label: "Base de Conhecimento",
      description: "Artigos por produto, módulo, categoria e problema; rascunhos só para quem edita; avaliação 'foi útil?'.",
      routes: ["/suporte/base-de-conhecimento", "/suporte/base-de-conhecimento/[id]"],
      // Hoje: base-de-conhecimento/page.tsx:27-28 e [id]/page.tsx:32-33 (M suporte). generateMetadata do
      // detalhe lê getArticle sem guarda (l.22-25).
      rule: "all",
      nav: {
        // Hoje: NAVIGATION.suporte (src/domain/constants.ts:178) filtrado por canAccessModule(user,'suporte')
        // em src/app/(app)/layout.tsx:11 e src/app/(app)/menu/page.tsx:16
        menu: "suporte",
        href: "/suporte/base-de-conhecimento",
        order: 3,
        label: "Base de Conhecimento",
        icon: "BookOpen",
      },
      sections: [
        {
          key: "suporte.base-de-conhecimento.rascunhos.ver",
          label: "Rascunhos (artigos não publicados)",
          // Onde: base-de-conhecimento/page.tsx:30-32 (includeDrafts: editor); [id]/page.tsx:35-37 (rascunho →
          // notFound se não editor) · Hoje: canEditArticles (support/schemas.ts:86-88)
          rule: { any: [{ manager: true }, { role: "suporte" }, { department: "suporte" }] },
        },
      ],
      actions: [
        {
          key: "suporte.base-de-conhecimento.criar",
          label: "Criar artigo (inclusive a partir de chamado)",
          verb: "criar",
          // Hoje: support/actions.ts:294-297 requireUser + canEditArticles (sem módulo)
          rule: { any: [{ manager: true }, { role: "suporte" }, { department: "suporte" }] },
          guards: ["src/server/support/actions.ts#saveArticleAction?sem id"],
        },
        {
          key: "suporte.base-de-conhecimento.editar",
          label: "Editar e publicar artigo",
          verb: "editar",
          // Hoje: support/actions.ts:294-297 requireUser + canEditArticles
          rule: { any: [{ manager: true }, { role: "suporte" }, { department: "suporte" }] },
          guards: ["src/server/support/actions.ts#saveArticleAction?com id"],
        },
        {
          key: "suporte.base-de-conhecimento.avaliar",
          label: "Avaliar artigo ('foi útil?')",
          verb: "avaliar",
          // Hoje: só requireUser (support/actions.ts:309-312) · A14: passa a exigir módulo + tela (intenção
          // documentada no código).
          rule: "all",
          guards: ["src/server/support/actions.ts#voteArticleAction"],
        },
      ],
      scope: null,
    },
  ],
} as const satisfies ModuleDef;
