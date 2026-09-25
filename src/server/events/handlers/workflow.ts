import type { registerHandler as RegisterFn } from "../emit";
import { getById, list, update } from "../../db";
import { COLLECTIONS, type Client, type Contract, type DomainEvent, type Opportunity, type Proposal, type WorkflowInstance, type WorkflowStep } from "@/domain/types";
import type { GateContextData } from "@/server/workflow/gates";

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
let registered = false;

/** Idempotente: pode ser chamado por handlers/index.ts e pelo serviço de workflow sem duplicar handlers. */
export function registerWorkflowHandlers(registerHandler: typeof RegisterFn): void {
  if (registered) return;
  registered = true;
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

  const { completeGate, evaluateStepGate } = await import("@/server/workflow/service");
  const { describeMissing } = await import("@/server/workflow/gates");

  // Marca no checklist do gate o que os dados dos módulos já comprovam, para que a etapa só seja
  // concluída "por exceção" quando algo realmente ficou pendente (e o motivo diga o quê).
  const { context } = await evaluateStepGate(step, { instance });
  const proven = await provenChecklist(expectedStageKey, context.data);
  const checklist = (step.checklist ?? []).filter((c) => !c.done && proven.has(c.id)).map((c) => ({ id: c.id, done: true }));
  const { evaluation } = await evaluateStepGate({ ...step, checklist: (step.checklist ?? []).map((c) => (proven.has(c.id) ? { ...c, done: true } : c)) }, { instance });
  const missing = evaluation.ok ? "" : describeMissing(evaluation);

  const result = await completeGate({
    stepId: step.id,
    actor: { id: event.actorId, name: event.actorName },
    checklist: checklist.length > 0 ? checklist : undefined,
    exceptionReason: missing ? `${exceptionReason} · pendente no gate: ${missing}` : exceptionReason,
    system: true,
  });
  if (result.status !== "completed") {
    console.warn(`[workflow] ${event.type} não avançou a etapa ${expectedStageKey} do cliente ${event.clientId}: ${result.status}`);
  }
}

/** Itens do checklist do gate comprovados pelos dados de Vendas/Financeiro (chaves do template padrão). */
async function provenChecklist(stageKey: string, data: GateContextData): Promise<Set<string>> {
  const proven = new Set<string>();
  const opp = data.opportunity as Opportunity | undefined;
  const c = data.contract as Contract | undefined;
  if (stageKey === "vendas" && opp) {
    if (opp.diagnosis?.trim()) proven.add("diagnostico");
    const proposals = await list<Proposal>(COLLECTIONS.proposals, { where: [["opportunityId", "==", opp.id]] });
    if (proposals.some((p) => p.sentAt)) proven.add("proposta_enviada");
    if (proposals.some((p) => p.status === "aceita")) proven.add("proposta_aceita");
    const b = opp.billingData;
    if (b?.legalName && b.document && b.email && b.paymentCondition) proven.add("dados_faturamento");
  }
  if (stageKey === "financeiro" && c) {
    if (c.number && c.items.length > 0) proven.add("contrato_gerado");
    if (c.signedAt) proven.add("assinatura");
    if (c.financialStatus === "aprovado") proven.add("pagamento");
    if (c.proposalId) proven.add("escopo");
  }
  return proven;
}
