import type { registerHandler as RegisterFn } from "../emit";
import { getById, update } from "../../db";
import { COLLECTIONS, type Client, type DomainEvent, type WorkflowInstance, type WorkflowStep } from "@/domain/types";

/**
 * Handlers que avançam a jornada do cliente a partir de eventos de outros módulos:
 *
 * - opportunity.won        → conclui a etapa "vendas"      (exceção "negócio ganho")
 * - financial.released     → conclui a etapa "financeiro"  (a liberação é a aprovação financeira)
 * - implementation.go_live → conclui a etapa "implantacao"
 * - customer.activated     → conclui a etapa "cs"
 *
 * Tolerantes: se o cliente não tem jornada ativa ou não está na etapa esperada, não fazem nada.
 * O serviço é importado dinamicamente para evitar ciclo de módulos (service.ts registra estes handlers).
 *
 * INTEGRAÇÃO: chamar `registerWorkflowHandlers(registerHandler)` em src/server/events/handlers/index.ts
 * dentro de `ensureHandlersRegistered()`. O serviço também se registra sozinho (idempotente) ao ser importado.
 */
export function registerWorkflowHandlers(registerHandler: typeof RegisterFn): void {
  registerHandler("opportunity.won", (event) => advanceStage(event, "vendas", "Negócio ganho (oportunidade marcada como ganha)", "opportunityId"));
  registerHandler("financial.released", (event) => advanceStage(event, "financeiro", "Liberação financeira registrada", "contractId"));
  registerHandler("implementation.go_live", (event) => advanceStage(event, "implantacao", "Go-live registrado pela implantação", "projectId"));
  registerHandler("customer.activated", (event) => advanceStage(event, "cs", "Cliente ativado pelo Customer Success"));
}

const ENTITY_FOR_CONTEXT: Record<string, string> = { opportunityId: "opportunity", contractId: "contract", projectId: "project" };

async function advanceStage(event: DomainEvent, expectedStageKey: string, exceptionReason: string, contextKey?: "opportunityId" | "contractId" | "projectId"): Promise<void> {
  if (!event.clientId) return;
  const client = await getById<Client>(COLLECTIONS.clients, event.clientId);
  if (!client?.workflowInstanceId) return;
  const instance = await getById<WorkflowInstance>(COLLECTIONS.workflowInstances, client.workflowInstanceId);
  if (!instance || instance.status !== "ativo") return;

  // Guarda a referência da entidade no contexto da instância (alimenta o gate), mesmo que a etapa não avance agora.
  if (contextKey && event.entityId && event.entityType === ENTITY_FOR_CONTEXT[contextKey] && instance.context[contextKey] !== event.entityId) {
    await update<WorkflowInstance>(COLLECTIONS.workflowInstances, instance.id, { context: { ...instance.context, [contextKey]: event.entityId } });
  }

  if (instance.currentStageKey !== expectedStageKey || !instance.currentStepId) return;
  const step = await getById<WorkflowStep>(COLLECTIONS.workflowSteps, instance.currentStepId);
  if (!step || step.status === "concluida" || step.status === "pulada") return;

  const { completeGate } = await import("@/server/workflow/service");
  const result = await completeGate({
    stepId: step.id,
    actor: { id: event.actorId, name: event.actorName },
    exceptionReason,
    system: true,
  });
  if (result.status !== "completed") {
    console.warn(`[workflow] ${event.type} não avançou a etapa ${expectedStageKey} do cliente ${event.clientId}: ${result.status}`);
  }
}
