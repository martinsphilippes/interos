import "server-only";
import { create, getById, list, update, nowIso } from "@/server/db";
import { emitEvent } from "@/server/events";
import { startSla } from "@/server/sla";
import { formatDateTime } from "@/lib/format";
import {
  COLLECTIONS,
  type ChecklistItem,
  type Client,
  type Department,
  type User,
  type UserRef,
  type WorkflowInstance,
  type WorkflowStep,
  type WorkflowTemplate,
} from "@/domain/types";
import type { JourneyStage } from "@/domain/constants";

/**
 * TODO(workflow): substituir por `createWorkflowInstanceForClient` de `src/server/workflow/service.ts`
 * assim que o módulo de workflow existir. Este fallback cobre apenas o mínimo: cria a instância da
 * jornada ("jornada-cliente") na etapa inicial e a primeira etapa (workflow_step) com checklist do
 * gate, responsável padrão e SLA, emitindo `workflow.started` e `workflow.stage.started`.
 */

export const JOURNEY_TEMPLATE_KEY = "jornada-cliente";

async function getPublishedTemplate(): Promise<WorkflowTemplate | null> {
  const templates = await list<WorkflowTemplate>(COLLECTIONS.workflowTemplates, { where: [["key", "==", JOURNEY_TEMPLATE_KEY]] });
  const published = templates.filter((t) => t.published);
  published.sort((a, b) => b.version - a.version);
  return published[0] ?? null;
}

/** Responsável padrão da etapa: usuário ativo com o papel padrão no departamento; senão o gestor do departamento. */
async function resolveAssignee(stage: WorkflowTemplate["stages"][number], fallback: UserRef): Promise<UserRef> {
  const users = await list<User>(COLLECTIONS.users, { where: [["departmentId", "==", stage.department]] });
  const active = users.filter((u) => u.active !== false);
  const byRole = stage.defaultAssigneeRole ? active.find((u) => u.role === stage.defaultAssigneeRole) : undefined;
  if (byRole) return { id: byRole.id, name: byRole.name };
  const departments = await list<Department>(COLLECTIONS.departments, { where: [["key", "==", stage.department]] });
  const managerId = departments[0]?.managerId;
  const manager = managerId ? active.find((u) => u.id === managerId) ?? (await getById<User>(COLLECTIONS.users, managerId)) : null;
  if (manager) return { id: manager.id, name: manager.name };
  return active[0] ? { id: active[0].id, name: active[0].name } : fallback;
}

export interface CreateWorkflowInstanceResult {
  instance: WorkflowInstance;
  step: WorkflowStep;
}

/**
 * Cria a jornada de um cliente recém-cadastrado. Devolve null quando o template não existe
 * (o cadastro do cliente segue normalmente; a jornada pode ser iniciada depois pelo módulo de workflow).
 */
export async function createWorkflowInstanceForClient(
  client: Client,
  actor: UserRef,
  initialStageKey?: JourneyStage,
): Promise<CreateWorkflowInstanceResult | null> {
  const template = await getPublishedTemplate();
  if (!template) return null;

  const stageKey: JourneyStage = initialStageKey ?? (client.status === "lead" ? "marketing" : "vendas");
  const stage = template.stages.find((s) => s.key === stageKey) ?? template.stages[0];
  if (!stage) return null;

  const now = nowIso();
  const assignee = await resolveAssignee(stage, actor);

  const instance = await create<WorkflowInstance>(COLLECTIONS.workflowInstances, {
    templateId: template.id,
    templateKey: template.key,
    templateVersion: template.version,
    clientId: client.id,
    clientName: client.tradeName,
    title: `Jornada — ${client.tradeName}`,
    currentStageKey: stage.key,
    status: "ativo",
    startedAt: now,
    context: { leadId: client.leadId },
    gateData: {},
    createdBy: actor.id,
  });

  const checklist: ChecklistItem[] = stage.gate.checklist.map((c) => ({ id: c.key, label: c.label, required: c.required, done: false }));
  const step = await create<WorkflowStep>(COLLECTIONS.workflowSteps, {
    instanceId: instance.id,
    clientId: client.id,
    clientName: client.tradeName,
    templateKey: template.key,
    stageKey: stage.key,
    stageName: stage.name,
    department: stage.department,
    order: stage.order,
    status: "em_andamento",
    assigneeId: assignee.id,
    assigneeName: assignee.name,
    startedAt: now,
    checklist,
    fields: {},
    taskIds: [],
    createdBy: actor.id,
  });

  let dueAt: string | undefined;
  let slaInstanceId: string | undefined;
  if (stage.slaRuleKey || stage.slaHours) {
    const sla = await startSla({
      ruleKey: stage.slaRuleKey ?? `workflow.${stage.key}`,
      entityType: "workflow_step",
      entityId: step.id,
      clientId: client.id,
      ownerId: assignee.id,
      department: stage.department,
      startedAt: now,
      resolutionHours: stage.slaHours,
    });
    dueAt = sla.dueAt;
    slaInstanceId = sla.id;
    await update<WorkflowStep>(COLLECTIONS.workflowSteps, step.id, { dueAt, slaInstanceId });
  }

  await update<WorkflowInstance>(COLLECTIONS.workflowInstances, instance.id, { currentStepId: step.id });

  await emitEvent({
    type: "workflow.started",
    actor,
    clientId: client.id,
    entity: { type: "workflow_instance", id: instance.id },
    title: "Jornada do cliente iniciada",
    description: `Etapa inicial: ${stage.name} · responsável ${assignee.name}`,
    department: stage.department,
    payload: { templateKey: template.key, templateVersion: template.version, stageKey: stage.key },
  });
  await emitEvent({
    type: "workflow.stage.started",
    actor,
    clientId: client.id,
    entity: { type: "workflow_step", id: step.id },
    title: `Etapa ${stage.name} iniciada`,
    description: `Responsável: ${assignee.name}${dueAt ? ` · prazo do SLA: ${formatDateTime(dueAt)}` : ""}`,
    department: stage.department,
    payload: { stageKey: stage.key, assigneeId: assignee.id, dueAt, slaInstanceId },
    timeline: false,
  });

  return {
    instance: { ...instance, currentStepId: step.id },
    step: { ...step, dueAt, slaInstanceId },
  };
}
