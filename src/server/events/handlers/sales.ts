import type { registerHandler as RegisterFn } from "../emit";

/**
 * Handlers do módulo de Vendas:
 *
 * - opportunity.won     → contrato inicial, client_products em implantação, tarefa do financeiro,
 *                         comissões previstas e notificações (gestor de vendas e financeiro).
 *                         O avanço da etapa "vendas" da jornada fica com o handler de workflow.
 * - proposal.accepted   → notifica vendedor e gestor de vendas.
 * - payment.approved    → NÃO é tratado aqui desde o motor de comissões v2: o handler de comissões
 *                         (./commissions.ts) reconcilia o contrato da cobrança.
 *
 * O serviço é importado dinamicamente para evitar ciclo (src/server/sales/service.ts registra estes
 * handlers ao ser importado). Idempotentes: podem receber o mesmo evento mais de uma vez.
 *
 * INTEGRAÇÃO: chamar `registerSalesHandlers(registerHandler)` em src/server/events/handlers/index.ts
 * dentro de `ensureHandlersRegistered()`.
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
}
