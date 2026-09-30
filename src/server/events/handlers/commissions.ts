import type { registerHandler as RegisterFn } from "../emit";
import { COLLECTIONS, type Billing, type DomainEvent } from "@/domain/types";

/**
 * Handlers do motor de comissões v2 (src/server/commissions/engine.ts). Todos reconciliam o contrato afetado — o
 * motor é idempotente (chave determinística + transições em transação), então receber o mesmo evento mais de uma vez,
 * ou em paralelo com a varredura diária "comissoes", não duplica comissão, título nem evento.
 *
 * - contract.signed    → libera o gatilho "contrato assinado";
 * - payment.approved   → gera/atualiza a comissão da parcela/competência paga (em carência ou Elegível → título);
 * - payment.overdue    → comissões que dependem da cobrança vencida ficam "aguardando recebimento";
 * - contract.cancelled → o que não foi adquirido vira cancelada (nada futuro é gerado);
 * - financial.released → início do contrato conhecido: conta a carência.
 *
 * A venda ganha (opportunity.won) gera as previstas pelo handler de Vendas (processWonOpportunity →
 * calculateCommissionsForOpportunity), depois que o contrato existe.
 */
let registered = false;

function contractIdOf(event: DomainEvent): string | null {
  if (event.entityType === "contract" && event.entityId) return event.entityId;
  return typeof event.payload.contractId === "string" ? event.payload.contractId : null;
}

async function billingContractId(event: DomainEvent): Promise<string | null> {
  const direct = typeof event.payload.contractId === "string" ? event.payload.contractId : null;
  if (direct) return direct;
  const billingId = event.entityType === "billing" && event.entityId ? event.entityId : typeof event.payload.billingId === "string" ? event.payload.billingId : null;
  if (!billingId) return null;
  const { getById } = await import("@/server/db");
  const billing = await getById<Billing>(COLLECTIONS.billing, billingId);
  return billing?.contractId ?? null;
}

async function reconcile(contractId: string | null, event: DomainEvent): Promise<void> {
  if (!contractId) return;
  const { reconcileContractCommissions } = await import("@/server/commissions/engine");
  await reconcileContractCommissions(contractId, { id: event.actorId, name: event.actorName });
}

export function registerCommissionHandlers(registerHandler: typeof RegisterFn): void {
  if (registered) return;
  registered = true;

  registerHandler("contract.signed", async function commissionsOnContractSigned(event) {
    await reconcile(contractIdOf(event), event);
  });
  registerHandler("payment.approved", async function commissionsOnPaymentApproved(event) {
    await reconcile(await billingContractId(event), event);
  });
  registerHandler("payment.overdue", async function commissionsOnPaymentOverdue(event) {
    await reconcile(await billingContractId(event), event);
  });
  registerHandler("contract.cancelled", async function commissionsOnContractCancelled(event) {
    await reconcile(contractIdOf(event), event);
  });
  registerHandler("financial.released", async function commissionsOnFinancialReleased(event) {
    await reconcile(contractIdOf(event), event);
  });
}
