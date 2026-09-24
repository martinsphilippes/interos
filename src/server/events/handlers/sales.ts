import type { registerHandler as RegisterFn } from "../emit";
import { getById } from "../../db";
import { COLLECTIONS, type Billing, type DomainEvent } from "@/domain/types";

/**
 * Handlers do módulo de Vendas:
 *
 * - opportunity.won     → contrato inicial, client_products em implantação, tarefa do financeiro,
 *                         comissões previstas e notificações (gestor de vendas e financeiro).
 *                         O avanço da etapa "vendas" da jornada fica com o handler de workflow.
 * - proposal.accepted   → notifica vendedor e gestor de vendas.
 * - payment.approved    → libera comissões (recorrência a partir da parcela configurada).
 *
 * O serviço é importado dinamicamente para evitar ciclo (src/server/sales/service.ts registra estes
 * handlers ao ser importado). Idempotentes: podem receber o mesmo evento mais de uma vez.
 *
 * INTEGRAÇÃO: chamar `registerSalesHandlers(registerHandler)` em src/server/events/handlers/index.ts
 * dentro de `ensureHandlersRegistered()`, para que payment.approved emitido pelo Financeiro libere
 * comissões mesmo quando o serviço de vendas ainda não foi carregado no processo.
 */
let registered = false;

export function registerSalesHandlers(registerHandler: typeof RegisterFn): void {
  if (registered) return;
  registered = true;

  registerHandler("opportunity.won", async function salesOnOpportunityWon(event) {
    if (event.entityType !== "opportunity" || !event.entityId) return;
    const { processWonOpportunity } = await import("@/server/sales/service");
    await processWonOpportunity(event.entityId, { id: event.actorId, name: event.actorName }, event.id);
  });

  registerHandler("proposal.accepted", async function salesOnProposalAccepted(event) {
    if (!event.entityId) return;
    const { notifyProposalAccepted } = await import("@/server/sales/service");
    await notifyProposalAccepted(event);
  });

  registerHandler("payment.approved", async function salesOnPaymentApproved(event) {
    const billing = await billingFromEvent(event);
    if (!billing) return;
    const { releaseCommissionsForBilling } = await import("@/server/sales/commissions");
    await releaseCommissionsForBilling(billing, { id: event.actorId, name: event.actorName });
  });
}

/** Cobrança do evento: entidade `billing` ou `payload.billingId` (tolerante ao formato do Financeiro). */
async function billingFromEvent(event: DomainEvent): Promise<Billing | null> {
  const id = event.entityType === "billing" && event.entityId ? event.entityId : typeof event.payload.billingId === "string" ? event.payload.billingId : null;
  if (!id) return null;
  return getById<Billing>(COLLECTIONS.billing, id);
}
