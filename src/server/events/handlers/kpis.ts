import type { registerHandler as RegisterFn } from "../emit";
import type { EventType } from "@/domain/constants";

/**
 * Handlers do motor de indicadores (KPIs).
 *
 * Eventos que alteram números invalidam o cache de dados dos indicadores; no máximo 1x por minuto o motor
 * emite `kpi.updated` e verifica as metas pessoais dos colaboradores do evento (emitindo `goal.achieved` e
 * notificando colaborador e gestor na primeira vez que a meta é atingida no mês). Nada é recalculado para a
 * empresa inteira de forma síncrona: os indicadores são calculados na leitura.
 *
 * O motor é importado dinamicamente para evitar ciclo de módulos (engine → events → handlers).
 *
 * INTEGRAÇÃO: chamar `registerKpiHandlers(registerHandler)` em src/server/events/handlers/index.ts dentro de
 * `ensureHandlersRegistered()`.
 */
export const KPI_EVENT_TYPES: EventType[] = [
  "opportunity.won",
  "opportunity.lost",
  "lead.created",
  "lead.qualified",
  "payment.approved",
  "payment.overdue",
  "contract.signed",
  "financial.released",
  "implementation.go_live",
  "support.ticket.resolved",
  "support.ticket.reopened",
  "support.csat.received",
  "churn.registered",
  "task.completed",
  "customer.activated",
];

let registered = false;

export function registerKpiHandlers(registerHandler: typeof RegisterFn): void {
  if (registered) return;
  registered = true;
  for (const type of KPI_EVENT_TYPES) {
    registerHandler(type, async function kpisOnDataChanged(event) {
      const { processKpiEvent } = await import("@/server/kpis/engine");
      await processKpiEvent(event);
    });
  }
}
