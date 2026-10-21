/**
 * Catálogo de acessos — módulo Comunicação (`comunicacao.acessar`): Central de Atendimento omnichannel.
 *
 * Módulo NOVO (não havia comportamento anterior): as regras padrão abaixo são a proposta aprovada (tela «Permissões da
 * Central»). Operador atende o que é seu e a fila das filas em que está; gestor vê e distribui a empresa; canais e
 * filas são do gestor. Ajustes por perfil/usuário seguem pelo mecanismo comum (permission_profiles).
 */
import type { ModuleDef } from "./types";

export const COMUNICACAO = {
  key: "comunicacao",
  label: "Comunicação",
  // Quem atende cliente ou lead (mesma lista de MODULE_ACCESS.comunicacao) + admin.
  rule: { role: ["admin", "diretoria", "gestor", "suporte", "vendas", "financeiro", "marketing", "cs", "implantacao"] },
  deactivatable: true,
  screens: [
    {
      key: "comunicacao.central",
      module: "comunicacao",
      label: "Central de Atendimento",
      description: "Conversas de WhatsApp e e-mail numa tela só: filas, conversa com nota interna e o contexto do cliente (Cliente 360). Ações: assumir, responder, transferir, encerrar, iniciar atendimento e identificar o contato.",
      routes: ["/comunicacao"],
      rule: "all",
      nav: {
        menu: "comunicacao",
        href: "/comunicacao",
        order: 1,
        label: "Central de Atendimento",
        icon: "MessagesSquare",
        wave: 5,
      },
      viewGuards: [
        { guard: "src/server/conversations/actions.ts#identityCandidatesAction", label: "Sugestões de «Quem é este número?»" },
        { guard: "src/server/conversations/actions.ts#searchConversationTargetsAction", label: "Busca de cliente, contato ou lead para iniciar atendimento" },
      ],
      sections: [],
      actions: [
        {
          key: "comunicacao.central.atender",
          label: "Assumir e responder conversas (inclui nota interna)",
          verb: "atender",
          rule: "all",
          guards: [
            "src/server/conversations/actions.ts#assumeConversationAction",
            "src/server/conversations/actions.ts#sendConversationMessageAction",
            "src/server/conversations/actions.ts#addConversationNoteAction",
            "src/server/conversations/actions.ts#sendConversationTemplateAction",
          ],
          recordCondition: "conversa dentro do escopo da Central (minha, sem responsável numa fila minha, ou escopo maior)",
        },
        {
          key: "comunicacao.central.iniciar",
          label: "Iniciar atendimento (escrever primeiro para cliente, contato ou lead)",
          verb: "iniciar",
          rule: "all",
          guards: ["src/server/conversations/actions.ts#startConversationAction"],
        },
        {
          key: "comunicacao.central.transferir",
          label: "Transferir conversa para pessoa ou fila",
          verb: "transferir",
          rule: "all",
          guards: ["src/server/conversations/actions.ts#transferConversationAction"],
          recordCondition: "conversa dentro do escopo da Central",
        },
        {
          key: "comunicacao.central.encerrar",
          label: "Encerrar atendimento",
          verb: "encerrar",
          rule: "all",
          guards: ["src/server/conversations/actions.ts#closeConversationAction"],
          recordCondition: "conversa dentro do escopo da Central",
        },
        {
          key: "comunicacao.central.identificar",
          label: "Identificar o contato (vincular a cliente, contato ou lead)",
          verb: "identificar",
          rule: "all",
          guards: ["src/server/conversations/actions.ts#linkConversationIdentityAction"],
          recordCondition: "conversa dentro do escopo da Central",
        },
        {
          key: "comunicacao.central.distribuir",
          label: "Atribuir conversa a outro operador",
          verb: "distribuir",
          rule: { manager: true },
          guards: ["src/server/conversations/actions.ts#assignConversationAction"],
        },
      ],
      scope: {
        entity: "conversations",
        ownerFields: ["assigneeId"],
        allowed: ["meus", "equipe", "empresa"],
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
        variants: {
          equipe: { reportLevels: 1, includeSelf: true, description: "Você e seus liderados diretos" },
        },
        // Com "meus", as conversas sem responsável das filas em que a pessoa está continuam visíveis.
        poolUnassigned: true,
        applyAt: ["src/server/conversations/queries.ts#getCentralOverview", "src/server/conversations/queries.ts#getConversationDetail", "src/server/conversations/actions.ts (assertConversationAccess)"],
      },
    },
    {
      key: "comunicacao.canais",
      module: "comunicacao",
      label: "Canais e filas",
      description: "Estado real de cada canal (lido do provedor) e as filas da Central: operadores, distribuição, limite de conversas, SLA e transbordo.",
      routes: ["/comunicacao/canais"],
      rule: { manager: true },
      nav: {
        menu: "comunicacao",
        href: "/comunicacao/canais",
        order: 2,
        label: "Canais e filas",
        icon: "SlidersHorizontal",
        wave: 5,
      },
      sections: [
        { key: "comunicacao.canais.canais.ver", label: "Estado dos canais", rule: { manager: true }, tab: "canais" },
        { key: "comunicacao.canais.filas.ver", label: "Filas e distribuição", rule: { manager: true }, tab: "filas" },
        { key: "comunicacao.canais.modelos.ver", label: "Modelos do WhatsApp", rule: { manager: true }, tab: "modelos" },
        { key: "comunicacao.canais.respostas.ver", label: "Respostas rápidas", rule: { manager: true }, tab: "respostas" },
        { key: "comunicacao.canais.automaticas.ver", label: "Mensagens automáticas", rule: { manager: true }, tab: "automaticas" },
        { key: "comunicacao.canais.registros.ver", label: "Registros técnicos", rule: { manager: true }, tab: "registros" },
      ],
      actions: [
        {
          key: "comunicacao.canais.filas.editar",
          label: "Criar e editar filas",
          verb: "editar",
          rule: { manager: true },
          guards: ["src/server/conversations/actions.ts#saveQueueAction"],
        },
        {
          key: "comunicacao.canais.modelos.editar",
          label: "Cadastrar modelos, ligar variáveis e sincronizar com a Meta",
          verb: "editar",
          rule: { manager: true },
          guards: ["src/server/conversations/actions.ts#saveTemplateAction", "src/server/conversations/actions.ts#syncTemplatesAction"],
        },
        {
          key: "comunicacao.canais.respostas.editar",
          label: "Criar e editar respostas rápidas",
          verb: "editar",
          rule: { manager: true },
          guards: ["src/server/conversations/actions.ts#saveQuickReplyAction"],
        },
        {
          key: "comunicacao.canais.automaticas.editar",
          label: "Configurar mensagens automáticas",
          verb: "editar",
          rule: { manager: true },
          guards: ["src/server/conversations/actions.ts#saveAutoMessagesAction"],
        },
      ],
      scope: null,
    },
  ],
} as const satisfies ModuleDef;
