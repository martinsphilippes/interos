import type { registerHandler as RegisterFn } from "../emit";
import type { EventType } from "@/domain/constants";

/**
 * Handlers da gamificação (Performance):
 *
 * - task.completed, support.ticket.resolved, support.csat.received, opportunity.won, proposal.sent,
 *   lead.qualified, implementation.go_live, customer.checkpoint.completed, upsell.created
 *     → credita pontos ao colaborador do evento (valores no setting "gamificacao"), de forma idempotente
 *       (gamification_points/gp_<eventId>_<userId>), e avalia as medalhas ligadas ao evento.
 * - goal.achieved → avalia a medalha "Mês 100%" (todas as metas do mês atingidas).
 *
 * O serviço é importado dinamicamente para evitar ciclo de módulos (gamification → events → handlers).
 *
 * INTEGRAÇÃO: chamar `registerGamificationHandlers(registerHandler)` em src/server/events/handlers/index.ts
 * dentro de `ensureHandlersRegistered()`.
 */
export const GAMIFICATION_EVENT_TYPES: EventType[] = [
  "task.completed",
  "support.ticket.resolved",
  "support.csat.received",
  "opportunity.won",
  "proposal.sent",
  "lead.qualified",
  "implementation.go_live",
  "customer.checkpoint.completed",
  "upsell.created",
  "goal.achieved",
];

let registered = false;

export function registerGamificationHandlers(registerHandler: typeof RegisterFn): void {
  if (registered) return;
  registered = true;
  for (const type of GAMIFICATION_EVENT_TYPES) {
    registerHandler(type, async function gamificationOnEvent(event) {
      const { awardPointsForEvent } = await import("@/server/performance/gamification");
      await awardPointsForEvent(event);
    });
  }
}
