/**
 * Capacidades do módulo de Marketing calculadas no SERVIDOR (src/server/marketing/access.ts#marketingCapabilities) e
 * entregues aos Client Components pelo MarketingAccessProvider. Servem só para esconder ou desabilitar controles: as
 * Server Actions revalidam a permissão (requirePermission) e o escopo em toda chamada.
 */

export interface MarketingCapabilities {
  leads: {
    create: boolean;
    import: boolean;
    edit: boolean;
    register: boolean;
    assign: boolean;
    qualify: boolean;
    disqualify: boolean;
  };
  campaigns: {
    create: boolean;
    edit: boolean;
  };
  inbox: {
    assume: boolean;
    reply: boolean;
  };
  prospect: {
    create: boolean;
    edit: boolean;
    import: boolean;
    assign: boolean;
    register: boolean;
    convert: boolean;
  };
  /** Criar tarefa ("Agendar disparo" da prospecção em destaque) — chave operacao.tarefas.criar. */
  createTask: boolean;
}

/** Sem provedor (ou sem sessão): nada liberado — na dúvida, o controle não aparece. */
export const NO_MARKETING_CAPABILITIES: MarketingCapabilities = {
  leads: { create: false, import: false, edit: false, register: false, assign: false, qualify: false, disqualify: false },
  campaigns: { create: false, edit: false },
  inbox: { assume: false, reply: false },
  prospect: { create: false, edit: false, import: false, assign: false, register: false, convert: false },
  createTask: false,
};
