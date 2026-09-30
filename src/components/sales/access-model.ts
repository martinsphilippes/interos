/**
 * Capacidades do módulo de Vendas calculadas no SERVIDOR (src/server/sales/access.ts#salesCapabilities) e entregues
 * aos Client Components pelo SalesAccessProvider. Servem só para esconder ou desabilitar controles: as Server Actions
 * revalidam a permissão (requirePermission) e o escopo do registro em toda chamada.
 */

export interface SalesCapabilities {
  opportunities: {
    /** Abrir a tela Oportunidades (links "Detalhes completos"). */
    view: boolean;
    create: boolean;
    /** Editar dados, mudar etapa e agendar próxima ação. */
    edit: boolean;
    /** Registrar contato, ligação e nota interna. */
    register: boolean;
    /** Enviar mensagem ao cliente (e-mail/WhatsApp ou registro manual). */
    send: boolean;
    attach: boolean;
    createTask: boolean;
    win: boolean;
    lose: boolean;
    reopen: boolean;
    /** Transferir para outro vendedor / criar em nome de outro vendedor. */
    assign: boolean;
  };
  proposals: {
    view: boolean;
    create: boolean;
    edit: boolean;
    /** Enviar e registrar visualização/negociação. */
    send: boolean;
    /** Registrar aceite ou recusa do cliente. */
    approve: boolean;
  };
  visits: {
    view: boolean;
    create: boolean;
    /** Agendar para outro vendedor. */
    assign: boolean;
    complete: boolean;
    cancel: boolean;
    edit: boolean;
  };
  /** Executar a varredura de follow-up (Central). */
  sweep: boolean;
}

/** Sem provedor (ou sem sessão): nada liberado — na dúvida, o controle não aparece. */
export const NO_SALES_CAPABILITIES: SalesCapabilities = {
  opportunities: { view: false, create: false, edit: false, register: false, send: false, attach: false, createTask: false, win: false, lose: false, reopen: false, assign: false },
  proposals: { view: false, create: false, edit: false, send: false, approve: false },
  visits: { view: false, create: false, assign: false, complete: false, cancel: false, edit: false },
  sweep: false,
};
