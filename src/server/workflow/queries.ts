import "server-only";
/**
 * Leituras do módulo Workflow. Só filtros de igualdade no Firestore; agregação em memória.
 * Rótulos de data são calculados aqui (fuso America/Sao_Paulo) para evitar divergência na hidratação.
 */
import { getById, getManyByIds, list } from "@/server/db";
import { computeSlaState } from "@/server/sla";
import { dateLabel, listAssignableUsers as listAssignableTaskUsers, listTasksByProcess, todayKey } from "@/server/tasks/queries";
import { COLLECTIONS, type Client, type Comment, type CurrentUser, type DomainEvent, type SlaInstance, type TimelineEvent, type User, type WorkflowInstance, type WorkflowStage, type WorkflowStep, type WorkflowTemplate } from "@/domain/types";
import type { RoleKey } from "@/domain/constants";
import { OPEN_STEP_STATUSES, evaluateStepGate, findStage, getPublishedTemplate, getTemplateForInstance, nextStageOf, resolveApprovers, sortedStages } from "./service";
import {
  boardColumnsFrom,
  sortStepCards,
  type AssignableUserOption,
  type InstanceDetail,
  type InstanceStepView,
  type StepCardItem,
  type StepDetail,
  type StepEventView,
  type StepNoteView,
  type TemplateListItem,
  type WorkflowBoardData,
  type WorkflowSummary,
} from "@/components/workflow/workflow-model";

export type { AssignableUserOption, InstanceDetail, StepCardItem, StepDetail, TemplateListItem, WorkflowBoardData, WorkflowSummary } from "@/components/workflow/workflow-model";

const DAY_MS = 86_400_000;

function daysBetween(fromIso: string | undefined, toIso: string): number {
  if (!fromIso) return 0;
  return Math.max(0, Math.floor((new Date(toIso).getTime() - new Date(fromIso).getTime()) / DAY_MS));
}

/** "2 dias", "5 horas", "30 min". */
function durationLabel(fromIso: string | undefined, toIso: string | undefined): string | undefined {
  if (!fromIso || !toIso) return undefined;
  const ms = Math.max(0, new Date(toIso).getTime() - new Date(fromIso).getTime());
  const days = Math.floor(ms / DAY_MS);
  if (days >= 1) return `${days} dia${days === 1 ? "" : "s"}`;
  const hours = Math.floor(ms / 3_600_000);
  if (hours >= 1) return `${hours} hora${hours === 1 ? "" : "s"}`;
  return `${Math.max(1, Math.floor(ms / 60_000))} min`;
}

// ---------------------------------------------------------------------------
// Cards (kanban/lista) e resumo
// ---------------------------------------------------------------------------

/** Enriquece etapas com SLA calculado, avatar do responsável e contadores. */
export async function enrichSteps(steps: WorkflowStep[]): Promise<StepCardItem[]> {
  if (steps.length === 0) return [];
  const now = new Date();
  const nowIso = now.toISOString();
  const [slas, users] = await Promise.all([
    getManyByIds<SlaInstance>(
      COLLECTIONS.slaInstances,
      steps.map((s) => s.slaInstanceId ?? "").filter(Boolean),
    ),
    getManyByIds<User>(
      COLLECTIONS.users,
      steps.map((s) => s.assigneeId ?? "").filter(Boolean),
    ),
  ]);
  return steps.map((step) => {
    const sla = step.slaInstanceId ? slas.get(step.slaInstanceId) : undefined;
    const assignee = step.assigneeId ? users.get(step.assigneeId) : undefined;
    const checklist = step.checklist ?? [];
    return {
      id: step.id,
      instanceId: step.instanceId,
      clientId: step.clientId,
      clientName: step.clientName,
      stageKey: step.stageKey,
      stageName: step.stageName,
      department: step.department,
      order: step.order,
      status: step.status,
      assigneeId: step.assigneeId,
      assigneeName: assignee?.name ?? step.assigneeName,
      assigneeAvatarUrl: assignee?.avatarUrl,
      startedAt: step.startedAt,
      dueAt: step.dueAt,
      updatedAt: step.updatedAt,
      daysInStage: daysBetween(step.startedAt, nowIso),
      sla: sla ? computeSlaState(sla, now) : null,
      checklistDone: checklist.filter((c) => c.done).length,
      checklistTotal: checklist.length,
      waitingClientReason: step.waitingClient?.reason,
      approvalPending: step.status === "aguardando_aprovacao",
      exceptionReason: step.exceptionReason,
    };
  });
}

function summarize(items: StepCardItem[], userId: string): WorkflowSummary {
  const summary: WorkflowSummary = { active: 0, mine: 0, slaRisk: 0, awaitingApproval: 0, waitingClient: 0 };
  for (const item of items) {
    summary.active++;
    if (item.assigneeId === userId) summary.mine++;
    if (item.sla && (item.sla.state === "em_risco" || item.sla.state === "violado")) summary.slaRisk++;
    if (item.status === "aguardando_aprovacao") summary.awaitingApproval++;
    if (item.status === "aguardando_cliente") summary.waitingClient++;
  }
  return summary;
}

/** Todas as etapas abertas (uma por jornada ativa), agrupadas por coluna do template publicado. */
export async function getWorkflowBoard(user: CurrentUser): Promise<WorkflowBoardData> {
  const [steps, template] = await Promise.all([
    list<WorkflowStep>(COLLECTIONS.workflowSteps, { where: [["status", "in", [...OPEN_STEP_STATUSES]]] }),
    getPublishedTemplate(),
  ]);
  const items = sortStepCards(await enrichSteps(steps));
  const columns = boardColumnsFrom(template?.stages).map((col) => ({ ...col, items: items.filter((i) => i.stageKey === col.key) }));
  // Etapas de chaves fora do template (versões antigas) ganham colunas próprias no fim.
  const known = new Set(columns.map((c) => c.key));
  for (const item of items) {
    if (known.has(item.stageKey)) continue;
    known.add(item.stageKey);
    columns.push({ key: item.stageKey, name: item.stageName, department: item.department, items: items.filter((i) => i.stageKey === item.stageKey) });
  }
  return { columns, items, summary: summarize(items, user.id) };
}

// ---------------------------------------------------------------------------
// Detalhe da etapa (drawer)
// ---------------------------------------------------------------------------

function toEventView(e: Pick<DomainEvent, "id" | "type" | "title" | "description" | "actorName" | "occurredAt">, today: string): StepEventView {
  return { id: e.id, type: e.type, title: e.title, description: e.description, actorName: e.actorName, occurredAt: e.occurredAt, occurredAtLabel: dateLabel(e.occurredAt, today) };
}

function isManager(role: RoleKey): boolean {
  return role === "admin" || role === "diretoria" || role === "gestor";
}

export async function getStepDetail(stepId: string, user: CurrentUser): Promise<StepDetail | null> {
  const step = await getById<WorkflowStep>(COLLECTIONS.workflowSteps, stepId);
  if (!step) return null;
  const instance = await getById<WorkflowInstance>(COLLECTIONS.workflowInstances, step.instanceId);
  if (!instance) return null;
  const template = await getTemplateForInstance(instance);
  if (!template) return null;
  const stage = findStage(template, step.stageKey);
  if (!stage) return null;

  const today = todayKey();
  const [{ evaluation }, client, sla, assignee, tasks, events, notes, approvers] = await Promise.all([
    evaluateStepGate(step, { instance, template }),
    getById<Client>(COLLECTIONS.clients, step.clientId),
    step.slaInstanceId ? getById<SlaInstance>(COLLECTIONS.slaInstances, step.slaInstanceId) : Promise.resolve(null),
    step.assigneeId ? getById<User>(COLLECTIONS.users, step.assigneeId) : Promise.resolve(null),
    listTasksByProcess("workflow", step.id),
    list<DomainEvent>(COLLECTIONS.events, { where: [["entityType", "==", "workflow_step"], ["entityId", "==", step.id]] }),
    list<Comment>(COLLECTIONS.comments, { where: [["entityType", "==", "workflow_step"], ["entityId", "==", step.id]] }),
    stage.gate.requiresApproval ? resolveApprovers(stage) : Promise.resolve([]),
  ]);

  const next = nextStageOf(template, stage.key);
  const canApprove = isManager(user.role) || (Boolean(stage.gate.approverRole) && user.role === stage.gate.approverRole);

  return {
    step: { ...step, checklist: step.checklist ?? [], fields: step.fields ?? {}, taskIds: step.taskIds ?? [] },
    stage,
    instance: { id: instance.id, clientId: instance.clientId, clientName: instance.clientName, currentStageKey: instance.currentStageKey, status: instance.status, templateVersion: instance.templateVersion },
    client: { id: step.clientId, tradeName: client?.tradeName ?? step.clientName, status: client?.status ?? "" },
    sla: sla ? computeSlaState(sla) : null,
    gate: evaluation,
    nextStage: next ? { key: next.key, name: next.name, department: next.department } : null,
    tasks,
    events: events.sort((a, b) => (a.occurredAt < b.occurredAt ? 1 : -1)).map((e) => toEventView(e, today)),
    notes: notes.sort((a, b) => (a.createdAt < b.createdAt ? 1 : -1)).map((n): StepNoteView => ({ ...n, createdAtLabel: dateLabel(n.createdAt, today) })),
    assigneeAvatarUrl: assignee?.avatarUrl,
    startedAtLabel: step.startedAt ? dateLabel(step.startedAt, today) : undefined,
    completedAtLabel: step.completedAt ? dateLabel(step.completedAt, today) : undefined,
    dueAtLabel: step.dueAt ? dateLabel(step.dueAt, today) : undefined,
    canApprove,
    canException: isManager(user.role),
    approverNames: approvers.map((u) => u.name),
  };
}

// ---------------------------------------------------------------------------
// Jornada completa (/workflow/[instanceId])
// ---------------------------------------------------------------------------

export async function getInstanceView(instanceId: string): Promise<InstanceDetail | null> {
  const instance = await getById<WorkflowInstance>(COLLECTIONS.workflowInstances, instanceId);
  if (!instance) return null;
  const today = todayKey();
  const nowIso = new Date().toISOString();
  const [template, rawSteps, client, timeline] = await Promise.all([
    getTemplateForInstance(instance),
    list<WorkflowStep>(COLLECTIONS.workflowSteps, { where: [["instanceId", "==", instanceId]] }),
    getById<Client>(COLLECTIONS.clients, instance.clientId),
    list<TimelineEvent>(COLLECTIONS.timelineEvents, { where: [["clientId", "==", instance.clientId]] }),
  ]);
  const stages = template ? sortedStages(template) : [];
  const slas = await getManyByIds<SlaInstance>(
    COLLECTIONS.slaInstances,
    rawSteps.map((s) => s.slaInstanceId ?? "").filter(Boolean),
  );
  const now = new Date();
  const ordered = [...rawSteps].sort((a, b) => a.order - b.order || (a.startedAt ?? "").localeCompare(b.startedAt ?? ""));
  const stepViews: InstanceStepView[] = ordered.map((step) => {
    const sla = step.slaInstanceId ? slas.get(step.slaInstanceId) : undefined;
    const checklist = step.checklist ?? [];
    const state: InstanceStepView["state"] = step.status === "concluida" || step.status === "pulada" ? "done" : step.id === instance.currentStepId || OPEN_STEP_STATUSES.includes(step.status) ? "current" : "pending";
    return {
      step: { ...step, checklist, fields: step.fields ?? {}, taskIds: step.taskIds ?? [] },
      stage: stages.find((s) => s.key === step.stageKey) ?? null,
      sla: sla ? computeSlaState(sla, now) : null,
      state,
      startedAtLabel: step.startedAt ? dateLabel(step.startedAt, today, false) : undefined,
      completedAtLabel: step.completedAt ? dateLabel(step.completedAt, today, false) : undefined,
      durationLabel: durationLabel(step.startedAt, step.completedAt ?? (state === "current" ? nowIso : undefined)),
      checklistDone: checklist.filter((c) => c.done).length,
      checklistTotal: checklist.length,
    };
  });

  const workflowTimeline = timeline
    .filter((e) => e.type.startsWith("workflow.") || e.type.startsWith("sla.") || e.type === "client.status_changed" || (e.type === "note.added" && e.entityType === "workflow_step"))
    .sort((a, b) => (a.occurredAt < b.occurredAt ? 1 : -1))
    .map((e) => toEventView(e, today));

  return {
    instance,
    template: template ? { id: template.id, key: template.key, name: template.name, version: template.version } : null,
    stages,
    steps: stepViews,
    client: { id: instance.clientId, tradeName: client?.tradeName ?? instance.clientName, status: client?.status ?? "", currentStage: client?.currentStage },
    timeline: workflowTimeline,
    startedAtLabel: dateLabel(instance.startedAt, today, false),
    completedAtLabel: instance.completedAt ? dateLabel(instance.completedAt, today, false) : undefined,
  };
}

// ---------------------------------------------------------------------------
// Usuários para reatribuição
// ---------------------------------------------------------------------------

export async function listAssignableUsers(): Promise<AssignableUserOption[]> {
  const users = await listAssignableTaskUsers();
  return users.map((u) => ({ id: u.id, name: u.name, departmentId: u.departmentId, role: u.role, avatarUrl: u.avatarUrl }));
}

// ---------------------------------------------------------------------------
// Admin de templates
// ---------------------------------------------------------------------------

export async function listWorkflowTemplates(): Promise<TemplateListItem[]> {
  const today = todayKey();
  const [templates, instances] = await Promise.all([list<WorkflowTemplate>(COLLECTIONS.workflowTemplates), list<WorkflowInstance>(COLLECTIONS.workflowInstances)]);
  const usage = new Map<string, number>();
  for (const i of instances) usage.set(i.templateId, (usage.get(i.templateId) ?? 0) + 1);
  return templates
    .map((t) => ({
      id: t.id,
      key: t.key,
      name: t.name,
      version: t.version,
      published: t.published,
      stagesCount: t.stages?.length ?? 0,
      updatedAt: t.updatedAt,
      updatedAtLabel: dateLabel(t.updatedAt, today),
      instances: usage.get(t.id) ?? 0,
    }))
    .sort((a, b) => a.key.localeCompare(b.key) || b.version - a.version);
}

export interface TemplateDetail {
  template: WorkflowTemplate;
  stages: WorkflowStage[];
  /** Outras versões do mesmo template (para navegação). */
  versions: { id: string; version: number; published: boolean }[];
  instances: number;
  slaRuleKeys: string[];
}

export async function getWorkflowTemplateDetail(id: string): Promise<TemplateDetail | null> {
  const template = await getById<WorkflowTemplate>(COLLECTIONS.workflowTemplates, id);
  if (!template) return null;
  const [siblings, instances, rules] = await Promise.all([
    list<WorkflowTemplate>(COLLECTIONS.workflowTemplates, { where: [["key", "==", template.key]] }),
    list<WorkflowInstance>(COLLECTIONS.workflowInstances, { where: [["templateId", "==", id]] }),
    list<{ id: string; organizationId: string; createdAt: string; updatedAt: string; key: string; appliesTo: string; active: boolean }>(COLLECTIONS.slaRules, { where: [["appliesTo", "==", "workflow"]] }),
  ]);
  return {
    template: { ...template, stages: template.stages ?? [] },
    stages: sortedStages(template),
    versions: siblings.map((t) => ({ id: t.id, version: t.version, published: t.published })).sort((a, b) => b.version - a.version),
    instances: instances.length,
    slaRuleKeys: rules.filter((r) => r.active).map((r) => r.key).sort(),
  };
}
