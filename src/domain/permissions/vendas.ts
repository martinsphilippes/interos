/**
 * Catálogo de acessos — módulo Vendas (`vendas.acessar`).
 *
 * Gerado UMA vez a partir do catálogo consolidado da etapa 6A (A24); daqui em diante este arquivo é a fonte de
 * verdade. Cada regra (`rule`) é a regra PADRÃO e reproduz o comportamento anterior ao catálogo; o comentário
 * "Hoje:" registra o predicado de origem. Ajustes por perfil/usuário não entram aqui (ficam em permission_profiles).
 */
import type { ModuleDef } from "./types";

export const VENDAS = {
  key: "vendas",
  label: "Vendas",
  // Hoje: MODULE_ACCESS.vendas (constants.ts:61) + admin (session.ts:79-80)
  rule: { role: ["admin", "diretoria", "gestor", "vendas", "marketing", "cs", "suporte"] },
  deactivatable: true,
  screens: [
    {
      key: "vendas.central",
      module: "vendas",
      label: "Central de Vendas",
      description: "Workspace do vendedor (fila, conversa e contexto) e, com ?view=painel, metas, comissão, simulador, funil e histórico. Gestores alternam Minha/Equipe (?escopo=equipe).",
      routes: ["/vendas"],
      // Hoje: src/app/(app)/vendas/page.tsx:32-33: requireUser + canAccessModule(user,'vendas') →
      // /meu-dia?erro=sem-permissao
      rule: "all",
      nav: {
        // Hoje: NAVIGATION.vendas (src/domain/constants.ts:125) filtrado por canAccessModule(user,'vendas') em
        // src/app/(app)/layout.tsx:11 e src/app/(app)/menu/page.tsx:16
        menu: "vendas",
        href: "/vendas",
        order: 1,
        label: "Central de Vendas",
        icon: "Handshake",
        wave: 2,
      },
      sections: [
        {
          key: "vendas.central.workspace.ver",
          label: "Workspace (fila, conversa e contexto)",
          // Onde: vendas/page.tsx:67-110; sales/workspace-queries.ts#getSalesWorkspace (l.126-232) e
          // #getWorkspaceOpportunity (l.364-481) · Hoje: vendas/page.tsx:32-33 (só módulo)
          rule: "all",
        },
        {
          key: "vendas.central.painel.ver",
          label: "Painel (metas, funil, histórico, contatar agora)",
          // Onde: vendas/page.tsx:35,58-65 (?view=painel); vendas/painel-view.tsx:25-150;
          // sales/queries.ts#getSalesOverview · Hoje: vendas/page.tsx:32-33 (só módulo)
          rule: "all",
        },
        {
          key: "vendas.central.comissao.ver",
          label: "Meta, comissão do mês e simulador de comissão",
          // Onde: painel-view.tsx:63-110 e :138-146; dados em sales/queries.ts:382-391 · Hoje: só módulo; soma
          // da equipe para isManager com ?escopo=equipe (sales/queries.ts:147-153,391) · Recomendação (não
          // padrão): exigir financeiro.comissoes.minhas.ver / .todas.ver conforme o escopo (R11).
          rule: "all",
        },
        {
          key: "vendas.central.sugestoes.ver",
          label: "Sugestões do assistente comercial",
          // Onde: AgentSuggestions kind=comercial (vendas/painel-view.tsx:115; demo em
          // admin/automacoes/page.tsx:67) · Hoje: getAgentSuggestions: requireUser + canAccessModule(vendas) +
          // carteira própria salvo isManager (src/server/automations/actions.ts:233-237)
          rule: "all",
          viewGuards: [
            {
              // Hoje: src/server/automations/actions.ts:236-237 (módulo vendas; subject === user.id ||
              // isManager)
              guard: "src/server/automations/actions.ts#getAgentSuggestions?kind=comercial",
              label: "Gerar sugestões do assistente comercial",
              recordCondition: "subjectId === user.id OU escopo efetivo de vendas.central maior que 'meus' (≡ isManager no padrão)",
            },
          ],
        },
      ],
      actions: [
        {
          key: "vendas.central.executar-varredura",
          label: "Executar varredura de follow-up",
          verb: "executar-varredura",
          // Hoje: src/server/sales/actions.ts:322-323 (requireSalesUser + user.isManager); botão só isManager
          // (vendas/page.tsx:51) · A varredura automática (runDueSweeps ao abrir a tela) roda como ator de
          // sistema e não passa por esta chave.
          rule: { manager: true },
          guards: ["src/server/sales/actions.ts#runFollowupSweep"],
        },
      ],
      scope: {
        entity: "opportunities (fila, KPIs e painel) + visits/communications/proposals da fila",
        ownerFields: ["ownerId", "originUserId (só no 'meus' do workspace)"],
        allowed: ["meus", "equipe", "departamento", "empresa"],
        // Hoje: Visão inicial SEMPRE 'meus': workspace = ownerId ∪ originUserId
        // (sales/workspace-queries.ts:138); painel = ownerId (sales/queries.ts:385-386). ?escopo=equipe só
        // isManager (queries.ts:147): gestor = ele + managerId==user (1 nível, l.152); diretoria/admin =
        // usuários ativos do departamento 'vendas' (l.150-151, departamento FIXO). Demais: só 'meus'.
        defaultByRole: {
          admin: "departamento",
          diretoria: "departamento",
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
        variants: {
          equipe: { reportLevels: 1, includeSelf: true, description: "Você e seus liderados diretos" },
          departamento: { fixedDepartment: "vendas", departmentBy: "people", description: "Todo o departamento de Vendas" },
        },
        applyAt: [
          "src/server/sales/queries.ts#resolveScope (resolveScope(user, pedido, tela) sobre resolveDataScope)",
          "src/server/sales/queries.ts#hasTeamView (botão Minha/Equipe quando o escopo efetivo é maior que 'meus')",
          "src/server/sales/workspace-queries.ts#getSalesWorkspace",
          "src/server/sales/queries.ts#getSalesOverview",
          "src/server/sales/commissions.ts#getCommissionSummary (queries.ts:391)",
          "src/app/(app)/vendas/page.tsx (toggle Minha/Equipe l.37,50)",
        ],
      },
    },
    {
      key: "vendas.pipeline",
      module: "vendas",
      label: "Pipeline",
      description: "Kanban do funil; arrastar entre etapas (vendas.oportunidades.editar) e soltar em Ganho/Perdido (ganhar/perder). ?oportunidade=<id> abre o drawer.",
      routes: ["/vendas/pipeline"],
      // Hoje: src/app/(app)/vendas/pipeline/page.tsx:22-23 (M vendas)
      rule: "all",
      nav: {
        // Hoje: NAVIGATION.vendas (src/domain/constants.ts:126) filtrado por canAccessModule(user,'vendas') em
        // src/app/(app)/layout.tsx:11 e src/app/(app)/menu/page.tsx:16
        menu: "vendas",
        href: "/vendas/pipeline",
        order: 2,
        label: "Pipeline",
        icon: "Kanban",
        wave: 2,
      },
      sections: [],
      actions: [],
      scope: {
        entity: "opportunities",
        ownerFields: ["ownerId", "originUserId"],
        allowed: ["meus", "equipe", "departamento", "empresa"],
        // Hoje: Mesma consulta de Oportunidades: listOpportunities → canSeeOpportunity
        // (sales/queries.ts:128-130, 210-218): isManager = empresa; demais = ownerId ∪ originUserId.
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
        sameAs: "vendas.oportunidades",
        applyAt: ["src/server/sales/queries.ts#listOpportunities", "src/server/sales/queries.ts#getOpportunityDetail"],
      },
    },
    {
      key: "vendas.oportunidades",
      module: "vendas",
      label: "Oportunidades",
      description: "Lista de oportunidades visíveis; tela DONA da entidade oportunidade — ações disparadas da Central, do Pipeline e do drawer usam as chaves desta tela.",
      routes: ["/vendas/oportunidades"],
      // Hoje: src/app/(app)/vendas/oportunidades/page.tsx:22-23 (M vendas); lista recortada por
      // canSeeOpportunity (sales/queries.ts:218)
      rule: "all",
      nav: {
        // Hoje: NAVIGATION.vendas (src/domain/constants.ts:127) filtrado por canAccessModule(user,'vendas') em
        // src/app/(app)/layout.tsx:11 e src/app/(app)/menu/page.tsx:16
        menu: "vendas",
        href: "/vendas/oportunidades",
        order: 3,
        label: "Oportunidades",
        icon: "Target",
        wave: 2,
        quickAction: {
          key: "oportunidade",
          label: "Nova oportunidade",
          description: "Abra uma negociação",
          href: "/vendas/oportunidades?novo=1",
          icon: "Target",
          order: 3,
          via: "vendas.oportunidades.criar",
          rule: { role: ["admin", "diretoria", "gestor", "vendas", "cs"] },
        },
      },
      sections: [],
      actions: [
        {
          key: "vendas.oportunidades.criar",
          label: "Criar oportunidade",
          verb: "criar",
          // Hoje: src/server/sales/actions.ts:108-110 (requireSalesUser = só módulo, l.72-76). O atalho '+'
          // tem regra própria (QUICK_ACTIONS roles [diretoria,gestor,vendas,cs] + admin, constants.ts:247-254)
          // · Quando ownerId ≠ user, checar também vendas.oportunidades.atribuir (padrão all → sem mudança).
          rule: "all",
          guards: ["src/server/sales/actions.ts#createOpportunityAction"],
        },
        {
          key: "vendas.oportunidades.editar",
          label: "Editar dados, mudar etapa e agendar próxima ação",
          verb: "editar",
          // Hoje: sales/actions.ts:120-157: requireSalesUser + requireOpportunityAccess (l.79-84: isManager ||
          // owner || originUser = ESCOPO)
          rule: "all",
          guards: [
            "src/server/sales/actions.ts#updateOpportunity",
            "src/server/sales/actions.ts#changeOpportunityStage",
            "src/server/sales/actions.ts#scheduleOpportunityNextAction",
          ],
        },
        {
          key: "vendas.oportunidades.registrar",
          label: "Registrar contato, ligação e nota interna",
          verb: "registrar",
          // Hoje: sales/actions.ts:159-170, 261-285: requireSalesUser + requireOpportunityAccess
          rule: "all",
          guards: [
            "src/server/sales/actions.ts#registerOpportunityContactAction",
            "src/server/sales/actions.ts#registerCallAction",
            "src/server/sales/actions.ts#registerInternalNoteAction",
          ],
        },
        {
          key: "vendas.oportunidades.enviar",
          label: "Enviar mensagem ao cliente (e-mail/WhatsApp ou registro manual)",
          verb: "enviar",
          // Hoje: sales/actions.ts:248-259: requireSalesUser + requireOpportunityAccess
          rule: "all",
          guards: ["src/server/sales/actions.ts#registerWorkspaceMessageAction"],
        },
        {
          key: "vendas.oportunidades.anexar",
          label: "Anexar documento à oportunidade",
          verb: "anexar",
          // Hoje: sales/actions.ts:287-298: requireSalesUser + requireOpportunityAccess
          rule: "all",
          guards: ["src/server/sales/actions.ts#attachOpportunityDocumentAction"],
        },
        {
          key: "vendas.oportunidades.criar-tarefa",
          label: "Criar tarefa da oportunidade",
          verb: "criar-tarefa",
          // Hoje: sales/actions.ts:172-184: requireSalesUser + requireOpportunityAccess
          rule: "all",
          guards: ["src/server/sales/actions.ts#createOpportunityTaskAction"],
        },
        {
          key: "vendas.oportunidades.ganhar",
          label: "Marcar como ganha (fechamento estruturado)",
          verb: "ganhar",
          // Hoje: sales/actions.ts:186-214: requireSalesUser + requireOpportunityAccess; getWonContextAction é
          // a leitura do diálogo de ganho · O fechamento define condições de cobrança e o evento
          // opportunity.won gera o CONTRATO (processWonOpportunity → ensureContractForOpportunity).
          // Recomendação (não padrão): exigir também financeiro.contratos.criar.
          rule: "all",
          guards: [
            "src/server/sales/actions.ts#markOpportunityWonAction",
            "src/server/sales/actions.ts#getWonContextAction",
          ],
          sensitive: true,
        },
        {
          key: "vendas.oportunidades.perder",
          label: "Marcar como perdida",
          verb: "perder",
          // Hoje: sales/actions.ts:216-228: requireSalesUser + requireOpportunityAccess
          rule: "all",
          guards: ["src/server/sales/actions.ts#markOpportunityLostAction"],
        },
        {
          key: "vendas.oportunidades.reabrir",
          label: "Reabrir oportunidade perdida",
          verb: "reabrir",
          // Hoje: sales/actions.ts:230-241: requireSalesUser + requireOpportunityAccess
          rule: "all",
          guards: ["src/server/sales/actions.ts#reopenOpportunityAction"],
        },
        {
          key: "vendas.oportunidades.atribuir",
          label: "Transferir para outro vendedor",
          verb: "atribuir",
          // Hoje: sales/actions.ts:301-314 + destino precisa do módulo vendas (sales/workspace.ts:181) ·
          // workspace.ts:181 passa a can(novoDono,'vendas.acessar') — exige resolver permissões efetivas de
          // OUTRO usuário (resolveEffectivePermissions(userId)).
          rule: "all",
          guards: ["src/server/sales/actions.ts#transferOpportunityAction"],
          checkedIn: ["src/server/sales/actions.ts#createOpportunityAction?ownerId≠user"],
        },
      ],
      scope: {
        entity: "opportunities",
        ownerFields: ["ownerId", "originUserId"],
        allowed: ["meus", "equipe", "departamento", "empresa"],
        // Hoje: canSeeOpportunity (sales/queries.ts:128-130): isManager (gestor de QUALQUER área, diretoria,
        // admin) = empresa; demais = ownerId ∪ originUserId. Aplicado em listOpportunities (l.218),
        // getOpportunityDetail (l.264), listOpenOpportunityOptions (l.579), listOpenOpportunitiesByClient
        // (l.660), requireOpportunityAccess (actions.ts:79-84), canEdit (workspace-queries.ts:480). Sem
        // escopo: getWonContext (queries.ts:824) e busca global.
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
        applyAt: [
          "src/server/sales/access.ts#opportunityInScope",
          "src/server/sales/queries.ts#listOpportunities",
          "src/server/sales/queries.ts#getOpportunityDetail",
          "src/server/sales/queries.ts#listOpenOpportunityOptions",
          "src/server/sales/queries.ts#listOpenOpportunitiesByClient",
          "src/server/sales/queries.ts#getWonContext",
          "src/server/sales/access.ts#assertOpportunityAccess",
          "src/server/sales/workspace-queries.ts#getWorkspaceOpportunity",
          "src/server/ai/context.ts:85",
          "src/server/search/queries.ts:281-285",
          "src/server/clients/queries.ts:508",
        ],
      },
    },
    {
      key: "vendas.agenda",
      module: "vendas",
      label: "Agenda comercial",
      description: "Visitas, tarefas com prazo e follow-ups do vendedor ou da equipe, em semana/mês. 'Nova visita' usa as chaves de vendas.visitas.",
      routes: ["/vendas/agenda"],
      // Hoje: src/app/(app)/vendas/agenda/page.tsx:29-30 (M vendas); toggle Minha/Equipe só isManager (l.68)
      rule: "all",
      nav: {
        // Hoje: NAVIGATION.vendas (src/domain/constants.ts:128) filtrado por canAccessModule(user,'vendas') em
        // src/app/(app)/layout.tsx:11 e src/app/(app)/menu/page.tsx:16
        menu: "vendas",
        href: "/vendas/agenda",
        order: 4,
        label: "Agenda",
        icon: "Calendar",
        wave: 2,
      },
      sections: [],
      actions: [],
      scope: {
        entity: "visits + tasks + opportunities (nextActionAt)",
        ownerFields: ["visits.sellerId", "tasks.assigneeId", "opportunities.ownerId"],
        allowed: ["meus", "equipe", "departamento", "empresa"],
        // Hoje: getAgenda → resolveScope (sales/queries.ts:725-790, 146-154). Visão inicial 'meus' =
        // [user.id]. ?escopo=equipe só isManager: gestor = ele + managerId==user (1 nível); diretoria/admin =
        // usuários ativos do departamento 'vendas'.
        defaultByRole: {
          admin: "departamento",
          diretoria: "departamento",
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
        variants: {
          equipe: { reportLevels: 1, includeSelf: true, description: "Você e seus liderados diretos" },
          departamento: { fixedDepartment: "vendas", departmentBy: "people", description: "Todo o departamento de Vendas" },
        },
        applyAt: ["src/server/sales/queries.ts#getAgenda", "src/server/sales/queries.ts#resolveScope"],
      },
    },
    {
      key: "vendas.visitas",
      module: "vendas",
      label: "Visitas",
      description: "Visitas comerciais: agendar, concluir, cancelar e remarcar; drawer ?visita=<id>; formulário ?nova=1.",
      routes: ["/vendas/visitas"],
      // Hoje: src/app/(app)/vendas/visitas/page.tsx:21-22 (M vendas)
      rule: "all",
      nav: {
        // Hoje: NAVIGATION.vendas (src/domain/constants.ts:129) filtrado por canAccessModule(user,'vendas') em
        // src/app/(app)/layout.tsx:11 e src/app/(app)/menu/page.tsx:16
        menu: "vendas",
        href: "/vendas/visitas",
        order: 5,
        label: "Visitas",
        icon: "MapPin",
        wave: 2,
        quickAction: {
          key: "visita",
          label: "Registrar visita",
          description: "Agende ou registre uma visita",
          href: "/vendas/visitas?nova=1",
          icon: "MapPin",
          order: 5,
          via: "vendas.visitas.criar",
          rule: { role: ["admin", "diretoria", "gestor", "vendas"] },
        },
      },
      sections: [],
      actions: [
        {
          key: "vendas.visitas.criar",
          label: "Agendar visita",
          verb: "criar",
          // Hoje: sales/actions.ts:391-395 (requireSalesUser). O atalho '+' tem regra própria (roles
          // [diretoria,gestor,vendas] + admin, constants.ts:256)
          rule: "all",
          guards: ["src/server/sales/actions.ts#createVisitAction"],
        },
        {
          key: "vendas.visitas.atribuir",
          label: "Agendar visita para outro vendedor",
          verb: "atribuir",
          // Hoje: sales/actions.ts:395 (!isManager && sellerId≠user → erro); UI canChooseSeller = isManager
          // (visitas/page.tsx:43, agenda/page.tsx:57, opportunity-actions.tsx:208-209)
          rule: { manager: true },
          guards: [],
          checkedIn: ["src/server/sales/actions.ts#createVisitAction?sellerId≠user"],
        },
        {
          key: "vendas.visitas.concluir",
          label: "Concluir visita (registrar resultado)",
          verb: "concluir",
          // Hoje: sales/actions.ts:404-415: requireSalesUser + requireVisitAccess (l.384-389 = escopo)
          rule: "all",
          guards: ["src/server/sales/actions.ts#completeVisitAction"],
        },
        {
          key: "vendas.visitas.cancelar",
          label: "Cancelar visita",
          verb: "cancelar",
          // Hoje: sales/actions.ts:417-428: requireSalesUser + requireVisitAccess
          rule: "all",
          guards: ["src/server/sales/actions.ts#cancelVisitAction"],
        },
        {
          key: "vendas.visitas.editar",
          label: "Remarcar visita",
          verb: "editar",
          // Hoje: sales/actions.ts:430-441: requireSalesUser + requireVisitAccess
          rule: "all",
          guards: ["src/server/sales/actions.ts#rescheduleVisitAction"],
        },
      ],
      scope: {
        entity: "visits",
        ownerFields: ["sellerId", "createdBy"],
        allowed: ["meus", "equipe", "departamento", "empresa"],
        // Hoje: isManager = empresa; demais = sellerId ∪ createdBy: listVisits (sales/queries.ts:627-629),
        // getVisitDetail (l.639-642), requireVisitAccess (actions.ts:384-389).
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
        applyAt: [
          "src/server/sales/queries.ts#listVisits",
          "src/server/sales/queries.ts#getVisitDetail",
          "src/server/sales/access.ts#assertVisitAccess",
          "src/server/sales/workspace-queries.ts#getClientVisits",
          "src/server/sales/workspace-queries.ts#getSalesWorkspace",
        ],
      },
    },
    {
      key: "vendas.propostas",
      module: "vendas",
      label: "Propostas",
      description: "Propostas comerciais (rascunho → enviada → visualizada → negociação → aceita/recusada), drawer ?proposta=<id> e página imprimível /vendas/propostas/[id].",
      routes: ["/vendas/propostas", "/vendas/propostas/[id]"],
      // Hoje: src/app/(app)/vendas/propostas/page.tsx:18-19 e propostas/[id]/page.tsx:41-45 (M vendas); [id]
      // fora do escopo → notFound (sales/queries.ts:560)
      rule: "all",
      nav: {
        // Hoje: NAVIGATION.vendas (src/domain/constants.ts:130) filtrado por canAccessModule(user,'vendas') em
        // src/app/(app)/layout.tsx:11 e src/app/(app)/menu/page.tsx:16
        menu: "vendas",
        href: "/vendas/propostas",
        order: 6,
        label: "Propostas",
        icon: "FileText",
        wave: 2,
      },
      sections: [],
      actions: [
        {
          key: "vendas.propostas.criar",
          label: "Criar proposta ou nova versão",
          verb: "criar",
          // Hoje: sales/actions.ts:365-378 e 337-348: requireSalesUser + requireOpportunityAccess na
          // oportunidade
          rule: "all",
          guards: [
            "src/server/sales/actions.ts#newProposalVersionAction",
            "src/server/sales/actions.ts#saveProposalAction?sem proposalId",
          ],
        },
        {
          key: "vendas.propostas.editar",
          label: "Editar rascunho da proposta (itens, descontos, condições, validade)",
          verb: "editar",
          // Hoje: sales/actions.ts:337-348: requireSalesUser + requireOpportunityAccess (l.341); só rascunho é
          // editável (service.ts:772-775)
          rule: "all",
          guards: ["src/server/sales/actions.ts#saveProposalAction?com proposalId"],
        },
        {
          key: "vendas.propostas.enviar",
          label: "Enviar proposta e registrar visualização/negociação",
          verb: "enviar",
          // Hoje: sales/actions.ts:350-363: requireSalesUser + requireOpportunityAccess (l.354-356)
          rule: "all",
          guards: ["src/server/sales/actions.ts#transitionProposalAction?transition=enviar|visualizada|negociacao"],
        },
        {
          key: "vendas.propostas.aprovar",
          label: "Registrar aceite ou recusa do cliente",
          verb: "aprovar",
          // Hoje: mesma de transitionProposalAction (sales/actions.ts:350-363) · Aceitar copia itens para os
          // produtos da oportunidade e alimenta fechamento/contrato.
          rule: "all",
          guards: ["src/server/sales/actions.ts#transitionProposalAction?transition=aceitar|recusar"],
        },
      ],
      scope: {
        entity: "proposals",
        ownerFields: ["ownerId", "opportunity.ownerId", "opportunity.originUserId"],
        allowed: ["meus", "equipe", "departamento", "empresa"],
        // Hoje: isManager = empresa; demais = proposal.ownerId ∪ canSeeOpportunity(oportunidade):
        // listProposals (sales/queries.ts:507-513), getProposalDetail (l.546-560). Divergência atual: as ações
        // exigem acesso à OPORTUNIDADE (actions.ts:341,356,371).
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
        applyAt: [
          "src/server/sales/queries.ts#listProposals",
          "src/server/sales/queries.ts#getProposalDetail",
          "src/server/sales/actions.ts#saveProposalAction/transitionProposalAction/newProposalVersionAction",
          "src/server/sales/access.ts#assertProposalAccess (oportunidade no escopo de Oportunidades E proposta no escopo de Propostas)",
          "src/server/search/queries.ts:286-290",
          "src/server/clients/queries.ts:509",
        ],
      },
    },
  ],
} as const satisfies ModuleDef;
