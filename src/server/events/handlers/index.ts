/**
 * Registro central dos handlers de eventos.
 *
 * Cada módulo exporta uma função `register()` que chama `registerHandler(tipo, fn)`.
 * A ordem importa apenas dentro do mesmo tipo de evento. Mantenha handlers idempotentes.
 *
 * opportunity.won: Vendas (contrato via Financeiro, produtos, comissões) → Workflow (avança a etapa
 * "vendas") → Marketing (lead de origem vira "convertido"). O contrato tem um único caminho:
 * `ensureContractForOpportunity` do Financeiro, chamado por `processWonOpportunity`.
 */
import { registerHandler } from "../emit";
import { registerNotificationHandlers } from "./notifications";
import { registerClientHandlers } from "./client";
import { registerSalesHandlers } from "./sales";
import { registerWorkflowHandlers } from "./workflow";
import { registerMarketingHandlers } from "./marketing";
import { registerFinanceHandlers } from "./finance";

let registered = false;

export function ensureHandlersRegistered(): void {
  if (registered) return;
  registered = true;
  registerNotificationHandlers(registerHandler);
  registerClientHandlers(registerHandler);
  registerSalesHandlers(registerHandler);
  registerWorkflowHandlers(registerHandler);
  registerMarketingHandlers(registerHandler);
  registerFinanceHandlers(registerHandler);
}
