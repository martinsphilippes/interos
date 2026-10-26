import type { registerHandler as RegisterFn } from "../emit";

/**
 * Handlers do Estoque (src/server/stock/service.ts):
 *
 * - contract.signed    → reserva os equipamentos do contrato (itens de estoque vinculados aos produtos), se a
 *                        configuração do estoque mandar; a falta é apontada e avisada ao responsável.
 * - contract.cancelled → libera o que estava separado; o que já saiu fica como "devolução pendente".
 *
 * Idempotentes: a reserva tem id por contrato+item e a liberação só mexe em reservas ativas/entregues.
 */
let registered = false;

export function registerStockHandlers(registerHandler: typeof RegisterFn): void {
  if (registered) return;
  registered = true;

  registerHandler("contract.signed", async function stockOnContractSigned(event) {
    if (event.entityType !== "contract" || !event.entityId) return;
    const { onContractSignedStock } = await import("@/server/stock/service");
    await onContractSignedStock(event.entityId, { id: event.actorId, name: event.actorName });
  });

  registerHandler("contract.cancelled", async function stockOnContractCancelled(event) {
    const contractId = event.entityType === "contract" && event.entityId ? event.entityId : typeof event.payload.contractId === "string" ? event.payload.contractId : null;
    if (!contractId) return;
    const reason = typeof event.payload.reason === "string" && event.payload.reason.trim() ? `Contrato cancelado: ${event.payload.reason.trim()}` : "Contrato cancelado";
    const { releaseContractReservations } = await import("@/server/stock/service");
    await releaseContractReservations(contractId, reason, { id: event.actorId, name: event.actorName });
  });
}
