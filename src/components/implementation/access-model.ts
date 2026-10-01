/**
 * Capacidades da Implantação na interface (A5/A11): booleans calculados NO SERVIDOR a partir do catálogo
 * (src/server/implementation/access.ts#implementationCapabilities) e entregues por props. Servem só para esconder
 * botões e controles; toda Server Action revalida a permissão (requirePermission) e o escopo do registro.
 * Arquivo puro (sem dependências de servidor) para poder ser importado pelos Client Components.
 */
export interface ImplementationCapabilities {
  /** Alterar responsável e equipe do projeto (implantacao.projetos.atribuir). */
  assignTeam: boolean;
  /** Plano: adicionar tarefa avulsa (implantacao.projetos.plano.criar). */
  addTask: boolean;
  /** Plano: concluir tarefa (implantacao.projetos.plano.concluir). */
  completeTask: boolean;
  /** Plano: reabrir tarefa concluída (implantacao.projetos.plano.reabrir). */
  reopenTask: boolean;
  /** Plano: atribuir responsável da tarefa (implantacao.projetos.plano.atribuir). */
  assignTask: boolean;
  /** Checklist: adicionar item (implantacao.projetos.checklist.criar). */
  addChecklistItem: boolean;
  /** Checklist: marcar/desmarcar item (implantacao.projetos.checklist.concluir). */
  toggleChecklist: boolean;
  /** Pendências: registrar pendência do cliente ou bloqueio (implantacao.projetos.pendencias.criar). */
  registerPending: boolean;
  /** Pendências: retomar projeto ou resolver bloqueio (implantacao.projetos.pendencias.concluir). */
  resolvePending: boolean;
  /** Documentos: anexar (implantacao.projetos.documentos.anexar). */
  attachDocument: boolean;
  /** Kanban: mudar a fase do projeto (implantacao.kanban.editar). */
  movePhase: boolean;
  /** Treinamentos: agendar/registrar (implantacao.treinamentos.criar). */
  scheduleTraining: boolean;
  /** Treinamentos: registrar realizado (implantacao.treinamentos.concluir). */
  completeTraining: boolean;
  /** Treinamentos: cancelar agendado (implantacao.treinamentos.cancelar). */
  cancelTraining: boolean;
  /** Templates: criar (implantacao.checklists.criar). */
  createTemplate: boolean;
  /** Templates: editar (implantacao.checklists.editar). */
  editTemplate: boolean;
  /** Templates: ativar/desativar (implantacao.checklists.ativar). */
  toggleTemplate: boolean;
  /** Go-live: registrar validação interna (implantacao.go-live.validar). */
  validateGoLive: boolean;
  /** Go-live: registrar aceite do cliente (implantacao.go-live.registrar-aceite). */
  registerAcceptance: boolean;
  /**
   * Go-live: aprovar, como guarda de borda (implantacao.go-live.aprovar). A aprovação de UM projeto depende também de
   * canApproveGoLive (aprovar-qualquer, ou responsável quando a regra permite) — calculada por projeto no servidor.
   */
  approveGoLive: boolean;
  /** Go-live: alterar a regra "exige aprovação do gestor" (implantacao.go-live.configurar). */
  configureGoLive: boolean;
}

/** Sem nenhuma capacidade (padrão seguro). */
export const NO_IMPLEMENTATION_CAPABILITIES: ImplementationCapabilities = {
  assignTeam: false,
  addTask: false,
  completeTask: false,
  reopenTask: false,
  assignTask: false,
  addChecklistItem: false,
  toggleChecklist: false,
  registerPending: false,
  resolvePending: false,
  attachDocument: false,
  movePhase: false,
  scheduleTraining: false,
  completeTraining: false,
  cancelTraining: false,
  createTemplate: false,
  editTemplate: false,
  toggleTemplate: false,
  validateGoLive: false,
  registerAcceptance: false,
  approveGoLive: false,
  configureGoLive: false,
};
