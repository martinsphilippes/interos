/**
 * Capacidades do Suporte na interface (A5/A11): booleans calculados NO SERVIDOR a partir do catálogo
 * (src/server/support/access.ts#supportCapabilities) e entregues por props. Servem só para esconder botões e
 * controles; toda Server Action revalida a permissão (requirePermission) e o escopo do chamado.
 * Arquivo puro (sem dependências de servidor) para poder ser importado pelos Client Components.
 */
export interface SupportCapabilities {
  /** Abrir chamado (suporte.chamados.criar). */
  createTicket: boolean;
  /** Assumir chamado (suporte.chamados.assumir). */
  assume: boolean;
  /** Atribuir/transferir para atendente ou fila (suporte.chamados.atribuir). */
  assign: boolean;
  /** Responder ao cliente (suporte.chamados.enviar). */
  reply: boolean;
  /** Registrar ligação ou nota interna (suporte.chamados.registrar). */
  register: boolean;
  /** Adicionar anexo (suporte.chamados.anexar). */
  attach: boolean;
  /** Classificar: produto, categoria, criticidade, fila (suporte.chamados.classificar). */
  classify: boolean;
  /** Aguardar cliente / retomar (suporte.chamados.pausar). */
  pause: boolean;
  /** Resolver (suporte.chamados.concluir). */
  resolve: boolean;
  /** Fechar chamado resolvido (suporte.chamados.fechar). */
  close: boolean;
  /** Reabrir (suporte.chamados.reabrir). */
  reopen: boolean;
  /** Gerar oportunidade comercial (suporte.chamados.criar-oportunidade). */
  createOpportunity: boolean;
  /** Criar artigo da base, inclusive a partir de chamado (suporte.base-de-conhecimento.criar). */
  createArticle: boolean;
  /** Editar e publicar artigo (suporte.base-de-conhecimento.editar). */
  editArticle: boolean;
  /** Avaliar artigo, "foi útil?" (suporte.base-de-conhecimento.avaliar). */
  voteArticle: boolean;
}

export type SupportCapability = keyof SupportCapabilities;

/** Tudo liberado: padrão para chamadores antigos que não informam as capacidades. */
export const ALL_SUPPORT_CAPABILITIES: SupportCapabilities = {
  createTicket: true,
  assume: true,
  assign: true,
  reply: true,
  register: true,
  attach: true,
  classify: true,
  pause: true,
  resolve: true,
  close: true,
  reopen: true,
  createOpportunity: true,
  createArticle: true,
  editArticle: true,
  voteArticle: true,
};

/** Capacidades de operação do chamado (as que antes dependiam de canOperateSupport). */
export const OPERATOR_CAPABILITIES = ["assume", "assign", "reply", "register", "attach", "classify", "pause", "resolve", "close", "createOpportunity"] as const satisfies readonly SupportCapability[];

/** Pode operar o chamado em alguma coisa? (controla menus e blocos que agrupam as operações) */
export function canOperateAny(can: SupportCapabilities): boolean {
  return OPERATOR_CAPABILITIES.some((c) => can[c]);
}

/** Pode escrever na conversa (responder ao cliente ou registrar ligação/nota)? */
export function canCompose(can: Pick<SupportCapabilities, "reply" | "register">): boolean {
  return can.reply || can.register;
}
