import type { registerHandler as RegisterFn } from "../emit";
import type { DomainEvent } from "@/domain/types";

/**
 * Handlers do módulo de Customer Success:
 *
 * - customer.risk.detected       → plano de sucesso automático (se não houver ativo), tarefa para o CS e
 *                                  notificação ao gestor de CS.
 * - support.ticket.resolved,
 *   support.csat.received,
 *   payment.overdue,
 *   payment.approved             → recalcula a saúde do cliente.
 * - implementation.go_live       → garante a conta de CS do cliente (idempotente).
 * - task.completed               → marca como feita a ação do plano de sucesso ligada à tarefa.
 * - task.status_changed          → tarefa de plano reaberta desmarca a ação.
 * - renewal.due                  → tarefa antecipada de renovação para o CS e notificação.
 * - call.completed,
 *   whatsapp.message.sent,
 *   visit.completed              → atualiza a última interação da conta de CS.
 *
 * O serviço é importado dinamicamente para evitar ciclo de módulos (src/server/cs/service.ts registra
 * estes handlers ao ser importado). Idempotentes: podem receber o mesmo evento mais de uma vez.
 *
 * INTEGRAÇÃO: chamar `registerCsHandlers(registerHandler)` em src/server/events/handlers/index.ts dentro
 * de `ensureHandlersRegistered()`, para que eventos de outros módulos (tarefas, suporte, financeiro)
 * sejam tratados mesmo quando o serviço de CS ainda não foi carregado no processo.
 */
let registered = false;

async function service() {
  return import("@/server/cs/service");
}

export function registerCsHandlers(registerHandler: typeof RegisterFn): void {
  if (registered) return;
  registered = true;

  registerHandler("customer.risk.detected", async function csOnRiskDetected(event) {
    const { onRiskDetected } = await service();
    await onRiskDetected(event);
  });

  const recalc = async function csRecalculateHealth(event: DomainEvent) {
    if (!event.clientId) return;
    const { recalculateHealthFromEvent } = await service();
    await recalculateHealthFromEvent(event);
  };
  registerHandler("support.ticket.resolved", recalc);
  registerHandler("support.csat.received", recalc);
  registerHandler("payment.overdue", recalc);
  registerHandler("payment.approved", recalc);

  registerHandler("implementation.go_live", async function csOnGoLive(event) {
    if (!event.clientId) return;
    const { onGoLive } = await service();
    await onGoLive(event);
  });

  registerHandler("task.completed", async function csOnTaskCompleted(event) {
    if (event.payload.processType !== "cs" || !event.payload.processId || !event.entityId) return;
    const { syncPlanActionFromTask } = await service();
    await syncPlanActionFromTask(event, true);
  });

  registerHandler("task.status_changed", async function csOnTaskReopened(event) {
    if (event.payload.from !== "concluida" || !event.entityId) return;
    const { syncPlanActionFromTask } = await service();
    await syncPlanActionFromTask(event, false);
  });

  registerHandler("renewal.due", async function csOnRenewalDue(event) {
    if (event.entityType !== "renewal" || !event.entityId) return;
    const { onRenewalDue } = await service();
    await onRenewalDue(event);
  });

  const touch = async function csTouchInteraction(event: DomainEvent) {
    if (!event.clientId || event.actorId === "system") return;
    const { touchInteraction } = await service();
    await touchInteraction(event);
  };
  registerHandler("call.completed", touch);
  registerHandler("whatsapp.message.sent", touch);
  registerHandler("visit.completed", touch);
}
