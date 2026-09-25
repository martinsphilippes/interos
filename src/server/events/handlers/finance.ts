import type { registerHandler as RegisterFn } from "../emit";

/**
 * Handlers do módulo Financeiro:
 *
 * - opportunity.won  → NÃO é tratado aqui: o handler de Vendas (processWonOpportunity) chama
 *                      `ensureContractForOpportunity` deste serviço, caminho único e idempotente do contrato.
 * - contract.signed  → tarefa "Gerar cobrança e liberar" para o responsável financeiro + notificação.
 * - payment.overdue  → notifica o financeiro (responsável e gestor) e o vendedor do cliente.
 *
 * O serviço é importado dinamicamente para evitar ciclo de módulos (service.ts registra estes handlers
 * ao ser importado).
 *
 * INTEGRAÇÃO: chamar `registerFinanceHandlers(registerHandler)` em src/server/events/handlers/index.ts
 * dentro de `ensureHandlersRegistered()`, para que os eventos acima sejam tratados mesmo quando o
 * serviço financeiro ainda não foi carregado no processo.
 */
let registered = false;

export function registerFinanceHandlers(registerHandler: typeof RegisterFn): void {
  if (registered) return;
  registered = true;

  registerHandler("contract.signed", async function financeOnContractSigned(event) {
    if (event.entityType !== "contract" || !event.entityId) return;
    const { onContractSigned } = await import("@/server/finance/service");
    await onContractSigned(event);
  });

  registerHandler("payment.overdue", async function financeOnPaymentOverdue(event) {
    const { onPaymentOverdue } = await import("@/server/finance/service");
    await onPaymentOverdue(event);
  });
}
