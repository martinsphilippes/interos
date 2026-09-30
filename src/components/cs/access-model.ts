/**
 * Capacidades do Customer Success na interface (A5/A11): booleans calculados NO SERVIDOR a partir do catálogo
 * (src/server/cs/access.ts#csCapabilities) e entregues por props. Servem só para esconder botões, controles e links;
 * toda Server Action revalida a permissão (requirePermission) e o escopo do registro.
 * Arquivo puro (sem dependências de servidor) para poder ser importado pelos Client Components.
 */
export interface CsCapabilities {
  /** Carteira: concluir o gate de ativação (cs.carteira.ativar-cliente). */
  activate: boolean;
  /** Saúde: recalcular um cliente (cs.saude.recalcular). */
  recalculate: boolean;
  /** Saúde: recalcular a carteira inteira (cs.saude.recalcular-carteira; padrão = gestores). */
  recalculateAll: boolean;
  /** Checkpoints: registrar (cs.checkpoints.criar). */
  checkpoint: boolean;
  /** Planos: criar (cs.planos.criar). */
  createPlan: boolean;
  /** Planos: editar e marcar ações (cs.planos.editar). */
  editPlan: boolean;
  /** Planos: encerrar (cs.planos.concluir). */
  closePlan: boolean;
  /** Renovações: criar para contrato vencendo (cs.renovacoes.criar). */
  createRenewal: boolean;
  /** Renovações: iniciar negociação (cs.renovacoes.negociar). */
  negotiate: boolean;
  /** Renovações: renovar o contrato com aditivo (cs.renovacoes.renovar). */
  renew: boolean;
  /** Renovações: registrar perda (cs.renovacoes.perder). */
  loseRenewal: boolean;
  /** Riscos: escalar ao gestor (cs.riscos.escalar). */
  escalate: boolean;
  /** Upsell: gerar oportunidade (cs.upsell.criar-oportunidade). */
  upsell: boolean;
  /** Churn: registrar cancelamento (cs.churn.registrar). */
  churn: boolean;
  /** Carteira: registrar ligação/WhatsApp com o cliente (operacao.clientes.registrar). */
  contact: boolean;
  /** Carteira: criar tarefa para o cliente (operacao.tarefas.criar). */
  createTask: boolean;
}

/** Links internos que as telas de CS mostram (calculados no servidor com canSeeHref). */
export interface CsLinks {
  /** /cs (carteira). */
  portfolio: boolean;
  /** /cs/saude (drill-down do score). */
  health: boolean;
  /** /cs/checkpoints. */
  checkpoints: boolean;
  /** /cs/planos. */
  plans: boolean;
  /** /cs/renovacoes. */
  renewals: boolean;
  /** /cs/riscos. */
  risks: boolean;
  /** /cs/upsell. */
  upsell: boolean;
  /** /cs/churn. */
  churn: boolean;
  /** /clientes/<id> (Cliente 360). */
  client: boolean;
  /** /financeiro/contratos. */
  contracts: boolean;
  /** /financeiro/contas-a-receber. */
  receivables: boolean;
  /** /tarefas. */
  tasks: boolean;
  /** /vendas/oportunidades. */
  opportunities: boolean;
}

/** Tudo liberado: comportamento anterior ao catálogo, para chamadores que ainda não passam as capacidades. */
export const ALL_CS_CAPABILITIES: CsCapabilities = {
  activate: true,
  recalculate: true,
  recalculateAll: true,
  checkpoint: true,
  createPlan: true,
  editPlan: true,
  closePlan: true,
  createRenewal: true,
  negotiate: true,
  renew: true,
  loseRenewal: true,
  escalate: true,
  upsell: true,
  churn: true,
  contact: true,
  createTask: true,
};

export const ALL_CS_LINKS: CsLinks = {
  portfolio: true,
  health: true,
  checkpoints: true,
  plans: true,
  renewals: true,
  risks: true,
  upsell: true,
  churn: true,
  client: true,
  contracts: true,
  receivables: true,
  tasks: true,
  opportunities: true,
};
