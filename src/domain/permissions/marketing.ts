/**
 * Catálogo de acessos — módulo Marketing (`marketing.acessar`).
 *
 * Gerado UMA vez a partir do catálogo consolidado da etapa 6A (A24); daqui em diante este arquivo é a fonte de
 * verdade. Cada regra (`rule`) é a regra PADRÃO e reproduz o comportamento anterior ao catálogo; o comentário
 * "Hoje:" registra o predicado de origem. Ajustes por perfil/usuário não entram aqui (ficam em permission_profiles).
 */
import type { ModuleDef } from "./types";

export const MARKETING = {
  key: "marketing",
  label: "Marketing",
  // Hoje: MODULE_ACCESS.marketing (constants.ts:60) + admin sempre (session.ts:79-80). Hoje só filtra o menu;
  // as páginas só exigem requireUser (A14).
  rule: { role: ["admin", "diretoria", "gestor", "marketing", "vendas"] },
  deactivatable: true,
  screens: [
    {
      key: "marketing.visao-geral",
      module: "marketing",
      label: "Visão Geral de Marketing",
      description: "Indicadores de captação, painel de captação/caixa, desempenho por canal, automações de captação, destaque de prospecção e gráficos por campanha.",
      routes: ["/marketing"],
      // Hoje: Só requireUser (src/app/(app)/marketing/page.tsx:46). O módulo (MODULE_ACCESS.marketing,
      // constants.ts:60) só filtra o menu. A14: a página passa a exigir marketing.acessar.
      rule: "all",
      nav: {
        // Hoje: NAVIGATION.marketing (src/domain/constants.ts:114) filtrado por
        // canAccessModule(user,'marketing') em src/app/(app)/layout.tsx:11 e src/app/(app)/menu/page.tsx:16
        menu: "marketing",
        href: "/marketing",
        order: 1,
        label: "Visão Geral",
        icon: "Megaphone",
      },
      sections: [
        {
          key: "marketing.visao-geral.automacoes.ver",
          label: "Automações de captação",
          // Onde: CaptureAutomations (marketing/page.tsx:131; components/marketing/capture-panels.tsx:88-148);
          // interruptor = can('admin.automacoes.ativar') (hoje canToggleAutomations = isAdmin &&
          // canAccessModule(admin), marketing/workspace.ts:215) · Hoje: visualização sem guarda própria
          // (page.tsx:131)
          rule: "all",
        },
      ],
      actions: [],
      scope: {
        entity: "lead (painel e indicadores) + prospect_list/prospect + campaign",
        ownerFields: ["lead.ownerId", "prospectList.ownerId", "prospect.ownerId"],
        allowed: ["meus", "equipe", "departamento", "empresa"],
        // Hoje: Empresa para todos: getMarketingWorkspace (src/server/marketing/workspace.ts:58-73) e
        // getMarketingOverview (marketing/queries.ts:239) não recebem o viewer.
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
        // Os agregados devem usar o mesmo DataScope de marketing.leads (sameAs).
        applyAt: [
          "src/server/marketing/workspace.ts#getMarketingWorkspace",
          "src/server/marketing/queries.ts#getMarketingOverview",
          "src/server/marketing/queries.ts#loadEnrichedLeads",
        ],
      },
    },
    {
      key: "marketing.leads",
      module: "marketing",
      label: "Leads",
      description: "Lista e kanban de leads; drawer ?lead=<id>; captação, contato, qualificação (MQL) e repasse a Vendas.",
      routes: ["/marketing/leads"],
      // Hoje: Só requireUser (src/app/(app)/marketing/leads/page.tsx:22); listLeads/getLead sem viewer (l.26).
      // A14: passa a exigir o módulo.
      rule: "all",
      nav: {
        // Hoje: NAVIGATION.marketing (src/domain/constants.ts:115) filtrado por
        // canAccessModule(user,'marketing') em src/app/(app)/layout.tsx:11 e src/app/(app)/menu/page.tsx:16
        menu: "marketing",
        href: "/marketing/leads",
        order: 2,
        label: "Leads",
        icon: "UserPlus",
        quickAction: {
          key: "lead",
          label: "Novo lead",
          description: "Cadastre um lead captado",
          href: "/marketing/leads?novo=1",
          icon: "UserPlus",
          order: 2,
          via: "marketing.leads.criar",
          rule: "all",
        },
      },
      sections: [],
      actions: [
        {
          key: "marketing.leads.criar",
          label: "Cadastrar lead",
          verb: "criar",
          // Hoje: requireUser dentro do try (marketing/actions.ts:101 e :90); ação rápida 'Novo lead'
          // (constants.ts:245) · checkLeadDuplicates é leitura do formulário; a deduplicação continua varrendo
          // a empresa, devolvendo só o mínimo com escopo < empresa.
          rule: "all",
          guards: [
            "src/server/marketing/actions.ts#createLeadAction",
            "src/server/marketing/actions.ts#checkLeadDuplicates",
          ],
        },
        {
          key: "marketing.leads.importar",
          label: "Importar leads (planilha)",
          verb: "importar",
          // Hoje: requireUser (marketing/actions.ts:246)
          rule: "all",
          guards: ["src/server/marketing/actions.ts#importLeads"],
        },
        {
          key: "marketing.leads.editar",
          label: "Editar lead (dados, consentimento LGPD, próxima ação, status)",
          verb: "editar",
          // Hoje: requireUser (marketing/actions.ts:114, 138, 150, 162)
          rule: "all",
          guards: [
            "src/server/marketing/actions.ts#updateLeadAction",
            "src/server/marketing/actions.ts#setLeadConsent",
            "src/server/marketing/actions.ts#setLeadNextAction",
            "src/server/marketing/actions.ts#changeLeadStatusAction",
          ],
        },
        {
          key: "marketing.leads.registrar",
          label: "Registrar contato com o lead",
          verb: "registrar",
          // Hoje: requireUser (marketing/actions.ts:174)
          rule: "all",
          guards: ["src/server/marketing/actions.ts#registerLeadContact"],
        },
        {
          key: "marketing.leads.atribuir",
          label: "Atribuir responsável do lead",
          verb: "atribuir",
          // Hoje: requireUser (marketing/actions.ts:126); serviço só exige usuário ativo (service.ts:224-233)
          rule: "all",
          guards: ["src/server/marketing/actions.ts#assignLeadAction"],
        },
        {
          key: "marketing.leads.qualificar",
          label: "Qualificar lead (MQL) e repassar a Vendas",
          verb: "qualificar",
          // Hoje: requireUser (marketing/actions.ts:191) · Cria cliente, oportunidade, tarefa e workflow
          // (service.ts:736-826 → handoffToSales) sem checar o módulo vendas. Padrão = hoje.
          rule: "all",
          guards: ["src/server/marketing/actions.ts#qualifyLead"],
          sensitive: true,
        },
        {
          key: "marketing.leads.desqualificar",
          label: "Desqualificar ou marcar lead como duplicado",
          verb: "desqualificar",
          // Hoje: requireUser (marketing/actions.ts:222 e :234)
          rule: "all",
          guards: [
            "src/server/marketing/actions.ts#disqualifyLeadAction",
            "src/server/marketing/actions.ts#markLeadDuplicateAction",
          ],
        },
      ],
      scope: {
        entity: "lead",
        ownerFields: ["ownerId"],
        allowed: ["meus", "equipe", "departamento", "empresa"],
        // Hoje: Empresa para todos: listLeads (marketing/queries.ts:164-172) filtra só por parâmetros da URL;
        // getLead (l.174-219) sem viewer; actions carregam por loadLead (service.ts:218-222) sem checar dono.
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
        // Leads sem dono: visíveis a quem tem marketing.leads.atribuir ou marketing.caixa-de-entrada.assumir
        // mesmo com escopo 'meus' (poolUnassigned).
        applyAt: [
          "src/server/marketing/queries.ts#listLeads",
          "src/server/marketing/queries.ts#getLead",
          "src/server/marketing/queries.ts#loadEnrichedLeads",
          "src/server/marketing/service.ts#loadLead",
          "src/server/marketing/service.ts#markLeadDuplicate (original também no escopo)",
        ],
      },
    },
    {
      key: "marketing.campanhas",
      module: "marketing",
      label: "Campanhas",
      description: "Investimento e resultado por campanha (leads, MQLs, CPL, conversão); drawer ?campanha=<id>|nova.",
      routes: ["/marketing/campanhas"],
      // Hoje: Só requireUser (src/app/(app)/marketing/campanhas/page.tsx:18). A14: passa a exigir o módulo.
      rule: "all",
      nav: {
        // Hoje: NAVIGATION.marketing (src/domain/constants.ts:116) filtrado por
        // canAccessModule(user,'marketing') em src/app/(app)/layout.tsx:11 e src/app/(app)/menu/page.tsx:16
        menu: "marketing",
        href: "/marketing/campanhas",
        order: 3,
        label: "Campanhas",
        icon: "Flag",
      },
      sections: [],
      actions: [
        {
          key: "marketing.campanhas.criar",
          label: "Criar campanha",
          verb: "criar",
          // Hoje: marketing/actions.ts:291 (isManager || role marketing); UI marketing/page.tsx:53,106-112 e
          // campanhas/page.tsx:22-23,37-41,51
          rule: { any: [{ manager: true }, { role: "marketing" }] },
          guards: ["src/server/marketing/actions.ts#saveCampaign?sem id"],
        },
        {
          key: "marketing.campanhas.editar",
          label: "Editar campanha",
          verb: "editar",
          // Hoje: marketing/actions.ts:291 (mesmo predicado inline em 3 lugares)
          rule: { any: [{ manager: true }, { role: "marketing" }] },
          guards: ["src/server/marketing/actions.ts#saveCampaign?com id"],
        },
      ],
      scope: {
        entity: "campaign",
        ownerFields: ["ownerId"],
        allowed: ["meus", "equipe", "departamento", "empresa"],
        // Hoje: Empresa para todos: listCampaigns (marketing/queries.ts:317-360); saveCampaign edita qualquer
        // id (service.ts:991-1017).
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
        applyAt: ["src/server/marketing/queries.ts#listCampaigns", "src/server/marketing/service.ts#saveCampaign"],
      },
    },
    {
      key: "marketing.caixa-de-entrada",
      module: "marketing",
      label: "Caixa de Entrada",
      description: "Mensagens de WhatsApp e e-mail recebidas (30 dias) de leads e clientes, e leads novos sem responsável (72 h).",
      routes: ["/marketing/caixa-de-entrada"],
      // Hoje: Só requireUser (src/app/(app)/marketing/caixa-de-entrada/page.tsx:14). A14: passa a exigir o
      // módulo; link do Meu Dia (components/meu-dia/blocks.tsx:357) deve passar por canSeeHref.
      rule: "all",
      nav: {
        // Hoje: NAVIGATION.marketing (src/domain/constants.ts:117) filtrado por
        // canAccessModule(user,'marketing') em src/app/(app)/layout.tsx:11 e src/app/(app)/menu/page.tsx:16
        menu: "marketing",
        href: "/marketing/caixa-de-entrada",
        order: 4,
        label: "Caixa de Entrada",
        icon: "Inbox",
      },
      sections: [],
      actions: [
        {
          key: "marketing.caixa-de-entrada.assumir",
          label: "Assumir atendimento (mensagem ou lead novo)",
          verb: "assumir",
          // Hoje: requireUser (marketing/actions.ts:262); serviço impede assumir lead com outro dono
          // (service.ts:905-912)
          rule: "all",
          guards: ["src/server/marketing/actions.ts#assumeInboxItemAction"],
        },
        {
          key: "marketing.caixa-de-entrada.enviar",
          label: "Responder mensagem (WhatsApp/e-mail ou registro manual)",
          verb: "enviar",
          // Hoje: requireUser (marketing/actions.ts:274); pode enviar pelo canal conectado
          // (service.ts:932-989) · Responde também a clientes (não só leads).
          rule: "all",
          guards: ["src/server/marketing/actions.ts#replyInboxAction"],
        },
      ],
      scope: {
        entity: "communication (entrada) + lead novo sem dono",
        ownerFields: ["communication.userId", "lead.ownerId", "communication.clientId → client.ownerSalesId/ownerCsId"],
        allowed: ["meus", "equipe", "departamento", "empresa"],
        // Hoje: Empresa para todos: getInbox (marketing/queries.ts:444-487) sem viewer.
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
          "src/server/marketing/queries.ts#getInbox",
          "src/server/marketing/service.ts#assumeInboxItem",
          "src/server/marketing/service.ts#replyToInbox",
        ],
      },
    },
    {
      key: "marketing.prospeccao",
      module: "marketing",
      label: "Prospecção Ativa",
      description: "Listas de contatos para abordagem ativa; detalhe da lista (/marketing/prospeccao/[listId]) com painel, planejamento, desempenho e contatos.",
      routes: ["/marketing/prospeccao", "/marketing/prospeccao/[listId]"],
      // Hoje: Só requireUser (prospeccao/page.tsx:15; prospeccao/[listId]/page.tsx:27). generateMetadata em
      // [listId]/page.tsx:19-23 lê getProspectListDetail sem guarda — requireScreen e escopo valem também ali.
      // A14: passa a exigir o módulo.
      rule: "all",
      nav: {
        // Hoje: NAVIGATION.marketing (src/domain/constants.ts:118) filtrado por
        // canAccessModule(user,'marketing') em src/app/(app)/layout.tsx:11 e src/app/(app)/menu/page.tsx:16
        menu: "marketing",
        href: "/marketing/prospeccao",
        order: 5,
        label: "Prospecção Ativa",
        icon: "Crosshair",
      },
      sections: [],
      actions: [
        {
          key: "marketing.prospeccao.criar",
          label: "Criar lista de prospecção",
          verb: "criar",
          // Hoje: requireUser (marketing/actions.ts:307)
          rule: "all",
          guards: ["src/server/marketing/actions.ts#createProspectListAction"],
        },
        {
          key: "marketing.prospeccao.editar",
          label: "Editar lista e planejamento; pausar, encerrar ou reativar",
          verb: "editar",
          // Hoje: requireUser (marketing/actions.ts:319, 331); setProspectListStatus não usa o ator (sem
          // auditoria)
          rule: "all",
          guards: [
            "src/server/marketing/actions.ts#updateProspectListAction",
            "src/server/marketing/actions.ts#setProspectListStatus",
          ],
        },
        {
          key: "marketing.prospeccao.importar",
          label: "Importar contatos para a lista",
          verb: "importar",
          // Hoje: requireUser (marketing/actions.ts:343)
          rule: "all",
          guards: ["src/server/marketing/actions.ts#importProspects"],
        },
        {
          key: "marketing.prospeccao.atribuir",
          label: "Atribuir contatos a responsável",
          verb: "atribuir",
          // Hoje: requireUser (marketing/actions.ts:355)
          rule: "all",
          guards: ["src/server/marketing/actions.ts#assignProspectsAction"],
        },
        {
          key: "marketing.prospeccao.registrar",
          label: "Registrar tentativa e agendar próxima ação",
          verb: "registrar",
          // Hoje: requireUser (marketing/actions.ts:367, 379); scheduleProspectAction não usa o ator
          rule: "all",
          guards: [
            "src/server/marketing/actions.ts#recordProspectAttempt",
            "src/server/marketing/actions.ts#scheduleProspectAction",
          ],
        },
        {
          key: "marketing.prospeccao.converter",
          label: "Converter contato em lead ou oportunidade",
          verb: "converter",
          // Hoje: requireUser (marketing/actions.ts:393) · Com target=oportunidade cria cliente e oportunidade
          // via handoffToSales (service.ts:1198-1254) sem checar o módulo vendas.
          rule: "all",
          guards: ["src/server/marketing/actions.ts#convertProspectAction"],
          sensitive: true,
        },
      ],
      scope: {
        entity: "prospect_list / prospect",
        ownerFields: ["prospectList.ownerId", "prospect.ownerId"],
        allowed: ["meus", "equipe", "departamento", "empresa"],
        // Hoje: Empresa para todos: listProspectLists (marketing/queries.ts:370-385) e getProspectListDetail
        // (l.387-434) sem viewer; loadProspectList/loadProspect (service.ts:1019-1029) sem checar dono.
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
          "src/server/marketing/queries.ts#listProspectLists",
          "src/server/marketing/queries.ts#getProspectListDetail (inclusive generateMetadata)",
          "src/server/marketing/service.ts#loadProspectList",
          "src/server/marketing/service.ts#loadProspect",
        ],
      },
    },
  ],
} as const satisfies ModuleDef;
