import type { registerHandler as RegisterFn } from "../emit";
import type { DomainEvent } from "@/domain/types";

/**
 * Handlers do módulo de Suporte:
 *
 * - support.ticket.created   → notifica a fila (toda a equipe de suporte; "ação" para crítico/alto) e,
 *                              quando o cliente está nos 30 dias após o go-live, anota no payload do
 *                              evento (postGoLive, suggestTrainingRelated) — o chamado não é alterado.
 * - sla.at_risk, sla.breached → para chamados (payload.entityType = "chamado"): avisa o gestor de suporte
 *                              (violação) e a fila quando não há atendente. O responsável é avisado pelo
 *                              handler genérico de notificações. Os eventos são emitidos por
 *                              `checkSlaAlerts()` (src/server/support/service.ts), chamado pela Central.
 * - support.csat.received    → nota ≤ 6: tarefa "Investigar avaliação baixa" para o gestor de suporte e
 *                              aviso ao atendente. A saúde do cliente é recalculada pelo handler do CS
 *                              (registerCsHandlers também escuta support.csat.received).
 * - support.ticket.reopened  → avisa o atendente e o gestor de suporte.
 *
 * O serviço é importado dinamicamente para evitar ciclo (src/server/support/service.ts registra estes
 * handlers ao ser importado). Idempotentes: podem receber o mesmo evento mais de uma vez.
 *
 * INTEGRAÇÃO: chamar `registerSupportHandlers(registerHandler)` em src/server/events/handlers/index.ts
 * dentro de `ensureHandlersRegistered()`.
 */
let registered = false;

async function service() {
  return import("@/server/support/service");
}

export function registerSupportHandlers(registerHandler: typeof RegisterFn): void {
  if (registered) return;
  registered = true;

  registerHandler("support.ticket.created", async function supportOnTicketCreated(event) {
    const { onTicketCreated } = await service();
    await onTicketCreated(event);
  });

  const slaAlert = async function supportOnSlaAlert(event: DomainEvent) {
    if (event.payload.entityType !== "chamado") return;
    const { onTicketSlaAlert } = await service();
    await onTicketSlaAlert(event);
  };
  registerHandler("sla.at_risk", slaAlert);
  registerHandler("sla.breached", slaAlert);

  registerHandler("support.csat.received", async function supportOnCsatReceived(event) {
    const { onCsatReceived } = await service();
    await onCsatReceived(event);
  });

  registerHandler("support.ticket.reopened", async function supportOnTicketReopened(event) {
    const { onTicketReopened } = await service();
    await onTicketReopened(event);
  });
}
