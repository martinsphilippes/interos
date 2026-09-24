/**
 * Registro central dos handlers de eventos.
 *
 * Cada módulo exporta uma função `register()` que chama `registerHandler(tipo, fn)`.
 * A ordem importa apenas dentro do mesmo tipo de evento. Mantenha handlers idempotentes.
 *
 * opportunity.won: Vendas (contrato via Financeiro, produtos, comissões) → Workflow (avança a etapa
 * "vendas") → Marketing (lead de origem vira "convertido"). O contrato tem um único caminho:
 * `ensureContractForOpportunity` do Financeiro, chamado por `processWonOpportunity`.
 *
 * Onda 3 — entrega e relacionamento:
 * - contract.released: o Financeiro chama `createProjectFromContract` (Implantação), idempotente por contrato.
 * - implementation.go_live: `approveGoLive` faz o handoff de forma síncrona (conta de CS via
 *   `ensureCsAccount`, ID determinístico `csacc_<clientId>`, health score pelo motor do CS) → Workflow conclui
 *   Implantação e abre CS → CS (`onGoLive`, no-op quando a conta já existe).
 * - customer.activated: Workflow conclui CS e abre Suporte.
 * - support.csat.received: Suporte (tarefa de investigação para nota baixa) e CS (recalcula a saúde).
 *
 * Ondas 4 e 5 — gestão, performance e automações:
 * - KPIs: eventos que mudam números invalidam o cache do motor de indicadores, emitem `kpi.updated` (1x/min) e
 *   verificam as metas pessoais (`goal.achieved`).
 * - Gamificação: credita pontos (idempotente por gp_<eventId>_<userId>) e avalia medalhas.
 * - Automações: handler "*" registrado por ÚLTIMO, para que as regras vejam o estado já atualizado pelos módulos.
 */
import { registerHandler } from "../emit";
import { registerNotificationHandlers } from "./notifications";
import { registerClientHandlers } from "./client";
import { registerSalesHandlers } from "./sales";
import { registerWorkflowHandlers } from "./workflow";
import { registerMarketingHandlers } from "./marketing";
import { registerFinanceHandlers } from "./finance";
import { registerImplementationHandlers } from "./implementation";
import { registerCsHandlers } from "./cs";
import { registerSupportHandlers } from "./support";
import { registerKpiHandlers } from "./kpis";
import { registerGamificationHandlers } from "./gamification";
import { registerAutomationHandlers } from "./automations";

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
  registerImplementationHandlers(registerHandler);
  registerCsHandlers(registerHandler);
  registerSupportHandlers(registerHandler);
  registerKpiHandlers(registerHandler);
  registerGamificationHandlers(registerHandler);
  registerAutomationHandlers(registerHandler);
}
