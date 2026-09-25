import type { registerHandler as RegisterFn } from "../emit";

/**
 * Handlers do módulo de Implantação:
 *
 * - implementation.created        → tarefa de kickoff para o responsável (+1 dia útil) e avisos ao
 *                                   responsável e ao gestor de implantação (idempotente).
 * - implementation.task.completed → recalcula progresso, avança a fase quando as obrigatórias dela
 *                                   terminam e marca "pronta para go-live" quando todas terminam.
 *
 * O go-live (implementation.go_live) é tratado pelo handler do workflow (conclui a etapa Implantação);
 * o handoff para o CS é feito de forma síncrona por `approveGoLive` antes de emitir o evento, para que
 * qualquer handler de CS encontre a conta já criada (cs_accounts por clientId).
 *
 * Chamados pós-go-live não alteram o ticket: a consulta `getPostGoLiveTickets` (queries.ts) mostra os
 * chamados abertos nos 30 dias após o go-live como indicador de qualidade da implantação.
 *
 * O serviço é importado dinamicamente para evitar ciclo de módulos (service.ts registra estes handlers
 * ao ser importado).
 *
 * INTEGRAÇÃO: chamar `registerImplementationHandlers(registerHandler)` em src/server/events/handlers/index.ts
 * dentro de `ensureHandlersRegistered()`.
 */
let registered = false;

export function registerImplementationHandlers(registerHandler: typeof RegisterFn): void {
  if (registered) return;
  registered = true;

  registerHandler("implementation.created", async function implementationOnCreated(event) {
    const { onProjectCreated } = await import("@/server/implementation/service");
    await onProjectCreated(event);
  });

  registerHandler("implementation.task.completed", async function implementationOnTaskCompleted(event) {
    const projectId = String(event.payload.projectId ?? (event.entityType === "project" ? event.entityId : "") ?? "");
    if (!projectId) return;
    const { syncProjectProgress } = await import("@/server/implementation/service");
    await syncProjectProgress(projectId, { id: event.actorId, name: event.actorName }, { advancePhase: true });
  });
}
