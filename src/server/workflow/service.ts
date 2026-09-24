import "server-only";
/**
 * Motor de workflow com gates — funções de negócio SEM validação de sessão.
 * Usadas pelas Server Actions (que validam sessão/entrada), por handlers de eventos de outros
 * módulos (oportunidade ganha, liberação financeira, go-live, ativação) e pelo seed.
 *
 * Regra central: nenhuma etapa avança sem gate concluído; cada passagem grava evento, responsável,
 * prazo (SLA), checklist e tarefas automáticas da próxima etapa.
 */
import { FieldValue } from "firebase-admin/firestore";
import { col, create, getById, getManyByIds, list, nowIso, stripUndefined, update } from "@/server/db";
import { emitEvent } from "@/server/events";
import { registerHandler } from "@/server/events/emit";
import { registerWorkflowHandlers } from "@/server/events/handlers/workflow";
import { notify } from "@/server/notifications";
import { addBusinessHours, completeSla, computeSlaState, getHolidays, pauseSla, resumeSla, startSla } from "@/server/sla";
import { createTaskInternal } from "@/server/tasks/service";
import { formatDateTime } from "@/lib/format";
import {
  COLLECTIONS,
  type ChecklistItem,
  type Client,
  type Comment,
  type Contract,
  type CsAccount,
  type Department,
  type Document,
  type ImplementationProject,
  type Lead,
  type Opportunity,
  type SlaInstance,
  type SlaView,
  type SuccessPlan,
  type Task,
  type Training,
  type User,
  type UserRef,
  type WorkflowInstance,
  type WorkflowStage,
  type WorkflowStep,
  type WorkflowTemplate,
} from "@/domain/types";
import type { ClientStatus, DepartmentKey, RoleKey } from "@/domain/constants";
import { coerceGateValue, describeMissing, evaluateGate, type GateContextData, type GateEvaluation } from "./gates";

// ---------------------------------------------------------------------------
// Registro idempotente dos handlers de evento do workflow.
// O integrador deve chamar `registerWorkflowHandlers` também em src/server/events/handlers/index.ts,
// para que os eventos de outros módulos avancem a jornada mesmo sem este serviço ter sido importado.
// ---------------------------------------------------------------------------

let handlersRegistered = false;
export function ensureWorkflowHandlers(): void {
  if (handlersRegistered) return;
  handlersRegistered = true;
  registerWorkflowHandlers(registerHandler);
}
ensureWorkflowHandlers();

export const JOURNEY_TEMPLATE_KEY = "jornada-cliente";

/** Ator das operações: referência do usuário com papel opcional (resolvido no banco quando ausente). */
export type WorkflowActor = UserRef & { role?: RoleKey };

const MANAGER_ROLES: readonly RoleKey[] = ["admin", "diretoria", "gestor"];

function isManagerRole(role: RoleKey | undefined): boolean {
  return role !== undefined && MANAGER_ROLES.includes(role);
}

async function resolveActorRole(actor: WorkflowActor): Promise<RoleKey | undefined> {
  if (actor.role) return actor.role;
  const user = await getById<User>(COLLECTIONS.users, actor.id);
  return user?.role;
}

function ref(user: Pick<User, "id" | "name">): UserRef {
  return { id: user.id, name: user.name };
}

// ---------------------------------------------------------------------------
// Templates e etapas
// ---------------------------------------------------------------------------

/** Versão publicada mais recente do template. */
export async function getPublishedTemplate(key: string = JOURNEY_TEMPLATE_KEY): Promise<WorkflowTemplate | null> {
  const templates = await list<WorkflowTemplate>(COLLECTIONS.workflowTemplates, { where: [["key", "==", key]] });
  const published = templates.filter((t) => t.published).sort((a, b) => b.version - a.version);
  return published[0] ?? null;
}

/** Template na versão em que a instância começou (instâncias não migram de versão). */
export async function getTemplateForInstance(instance: Pick<WorkflowInstance, "templateId" | "templateKey" | "templateVersion">): Promise<WorkflowTemplate | null> {
  const exact = await getById<WorkflowTemplate>(COLLECTIONS.workflowTemplates, instance.templateId);
  if (exact) return exact;
  const versions = await list<WorkflowTemplate>(COLLECTIONS.workflowTemplates, { where: [["key", "==", instance.templateKey]] });
  return versions.find((t) => t.version === instance.templateVersion) ?? versions.filter((t) => t.published).sort((a, b) => b.version - a.version)[0] ?? null;
}

export function sortedStages(template: Pick<WorkflowTemplate, "stages">): WorkflowStage[] {
  return [...template.stages].sort((a, b) => a.order - b.order);
}

export function findStage(template: Pick<WorkflowTemplate, "stages">, stageKey: string): WorkflowStage | null {
  return template.stages.find((s) => s.key === stageKey) ?? null;
}

export function nextStageOf(template: Pick<WorkflowTemplate, "stages">, stageKey: string): WorkflowStage | null {
  const stages = sortedStages(template);
  const index = stages.findIndex((s) => s.key === stageKey);
  if (index < 0) return null;
  return stages[index + 1] ?? null;
}

// ---------------------------------------------------------------------------
// Responsáveis e notificações
// ---------------------------------------------------------------------------

export async function getDepartmentManager(department: DepartmentKey): Promise<User | null> {
  const departments = await list<Department>(COLLECTIONS.departments, { where: [["key", "==", department]] });
  const managerId = departments[0]?.managerId;
  if (!managerId) return null;
  const manager = await getById<User>(COLLECTIONS.users, managerId);
  return manager && manager.active !== false ? manager : null;
}

/**
 * Responsável padrão da etapa: usuário ativo do departamento com o papel padrão (o menos carregado
 * em etapas abertas); senão o gestor do departamento; senão qualquer usuário ativo do departamento.
 */
export async function resolveStageAssignee(stage: WorkflowStage): Promise<UserRef | null> {
  const users = (await list<User>(COLLECTIONS.users, { where: [["departmentId", "==", stage.department]] })).filter((u) => u.active !== false);
  const candidates = stage.defaultAssigneeRole ? users.filter((u) => u.role === stage.defaultAssigneeRole) : [];
  if (candidates.length === 1) return ref(candidates[0]);
  if (candidates.length > 1) {
    const open = await listOpenStepsByDepartment(stage.department);
    const load = new Map<string, number>();
    for (const s of open) if (s.assigneeId) load.set(s.assigneeId, (load.get(s.assigneeId) ?? 0) + 1);
    candidates.sort((a, b) => (load.get(a.id) ?? 0) - (load.get(b.id) ?? 0) || a.name.localeCompare(b.name, "pt-BR"));
    return ref(candidates[0]);
  }
  const manager = await getDepartmentManager(stage.department);
  if (manager) return ref(manager);
  return users[0] ? ref(users[0]) : null;
}

/** Usuários que podem aprovar o gate: papel aprovador no departamento da etapa + gestor do departamento. */
export async function resolveApprovers(stage: WorkflowStage): Promise<User[]> {
  const approvers = new Map<string, User>();
  if (stage.gate.approverRole) {
    const byRole = await list<User>(COLLECTIONS.users, { where: [["role", "==", stage.gate.approverRole]] });
    // Papéis transversais (admin, diretoria) aprovam qualquer departamento; os demais só o da etapa.
    const crossDepartment = stage.gate.approverRole === "admin" || stage.gate.approverRole === "diretoria";
    for (const u of byRole) if (u.active !== false && (crossDepartment || u.departmentId === stage.department)) approvers.set(u.id, u);
  }
  const manager = await getDepartmentManager(stage.department);
  if (manager) approvers.set(manager.id, manager);
  return Array.from(approvers.values());
}

function canApproveStage(stage: WorkflowStage, role: RoleKey | undefined): boolean {
  if (isManagerRole(role)) return true;
  return Boolean(stage.gate.approverRole && role === stage.gate.approverRole);
}

// ---------------------------------------------------------------------------
// Steps: criação, leitura e utilitários
// ---------------------------------------------------------------------------

async function loadStep(stepId: string): Promise<WorkflowStep> {
  const step = await getById<WorkflowStep>(COLLECTIONS.workflowSteps, stepId);
  if (!step) throw new Error("Etapa não encontrada");
  return step;
}

async function loadInstance(instanceId: string): Promise<WorkflowInstance> {
  const instance = await getById<WorkflowInstance>(COLLECTIONS.workflowInstances, instanceId);
  if (!instance) throw new Error("Jornada não encontrada");
  return instance;
}

/** Remove campos do step (o `update` de db.ts ignora `undefined`). */
async function clearStepFields(stepId: string, fields: (keyof WorkflowStep)[]): Promise<void> {
  if (fields.length === 0) return;
  const patch: Record<string, unknown> = { updatedAt: nowIso() };
  for (const f of fields) patch[f] = FieldValue.delete();
  await col(COLLECTIONS.workflowSteps).doc(stepId).update(patch);
}

/** Substitui o mapa `approval` inteiro (o `update` de db.ts faz merge profundo e manteria chaves antigas). */
async function setStepApproval(stepId: string, approval: NonNullable<WorkflowStep["approval"]>, extra: Partial<Pick<WorkflowStep, "status" | "exceptionReason">> = {}): Promise<void> {
  const patch: Record<string, unknown> = { approval: stripUndefined(approval), updatedAt: nowIso() };
  for (const [k, v] of Object.entries(extra)) if (v !== undefined) patch[k] = v;
  await col(COLLECTIONS.workflowSteps).doc(stepId).update(patch);
}

function stepEntity(step: Pick<WorkflowStep, "id">) {
  return { type: "workflow_step", id: step.id };
}

export const OPEN_STEP_STATUSES: readonly WorkflowStep["status"][] = ["em_andamento", "aguardando_cliente", "aguardando_aprovacao"];

export async function listOpenStepsByDepartment(department: DepartmentKey): Promise<WorkflowStep[]> {
  const steps = await list<WorkflowStep>(COLLECTIONS.workflowSteps, { where: [["department", "==", department]] });
  return steps.filter((s) => OPEN_STEP_STATUSES.includes(s.status));
}

interface StartStepInput {
  instance: WorkflowInstance;
  stage: WorkflowStage;
  actor: UserRef;
}

/**
 * Instancia uma etapa: responsável, SLA, checklist do gate, tarefas automáticas, evento
 * workflow.stage.started e notificações (responsável = ação; gestor do departamento = informativa).
 */
async function startStep({ instance, stage, actor }: StartStepInput): Promise<WorkflowStep> {
  const now = nowIso();
  const assignee = await resolveStageAssignee(stage);
  const checklist: ChecklistItem[] = stage.gate.checklist.map((c) => ({ id: c.key, label: c.label, required: c.required, done: false }));

  const step = await create<WorkflowStep>(COLLECTIONS.workflowSteps, {
    instanceId: instance.id,
    clientId: instance.clientId,
    clientName: instance.clientName,
    templateKey: instance.templateKey,
    stageKey: stage.key,
    stageName: stage.name,
    department: stage.department,
    order: stage.order,
    status: "em_andamento",
    assigneeId: assignee?.id,
    assigneeName: assignee?.name,
    startedAt: now,
    checklist,
    fields: {},
    taskIds: [],
    createdBy: actor.id,
  });

  // SLA da etapa (regra por chave ou horas fixas do template).
  let sla: SlaInstance | null = null;
  if (stage.slaRuleKey || stage.slaHours) {
    sla = await startSla({
      ruleKey: stage.slaRuleKey ?? `workflow.${stage.key}`,
      entityType: "workflow_step",
      entityId: step.id,
      clientId: instance.clientId,
      ownerId: assignee?.id,
      department: stage.department,
      startedAt: now,
      resolutionHours: stage.slaHours,
    });
    await update<WorkflowStep>(COLLECTIONS.workflowSteps, step.id, { dueAt: sla.dueAt, slaInstanceId: sla.id });
    await emitEvent({
      type: "sla.started",
      actor,
      clientId: instance.clientId,
      entity: stepEntity(step),
      title: `SLA da etapa ${stage.name} iniciado: ${sla.ruleName}`,
      description: `Prazo: ${formatDateTime(sla.dueAt)}`,
      department: stage.department,
      payload: { slaInstanceId: sla.id, dueAt: sla.dueAt, ownerId: assignee?.id, ruleKey: sla.ruleKey },
      timeline: false,
    });
  }

  // Tarefas automáticas da etapa (prazo em horas úteis a partir de agora).
  const holidays = await getHolidays();
  const taskIds: string[] = [];
  for (const auto of stage.autoTasks) {
    const task = await createTaskInternal(
      {
        title: auto.title,
        description: auto.description,
        clientId: instance.clientId,
        assigneeId: assignee?.id,
        departmentId: stage.department,
        priority: auto.priority,
        dueAt: addBusinessHours(new Date(now), auto.dueInHours, holidays).toISOString(),
        processType: "workflow",
        processId: step.id,
        origin: "workflow",
        tags: ["workflow", stage.key],
      },
      actor,
    );
    taskIds.push(task.id);
  }
  if (taskIds.length > 0) await update<WorkflowStep>(COLLECTIONS.workflowSteps, step.id, { taskIds });

  await emitEvent({
    type: "workflow.stage.started",
    actor,
    clientId: instance.clientId,
    entity: stepEntity(step),
    title: `Etapa ${stage.name} iniciada`,
    description: `${assignee ? `Responsável: ${assignee.name}` : "Sem responsável definido"}${sla ? ` · prazo do SLA: ${formatDateTime(sla.dueAt)}` : ""}${taskIds.length ? ` · ${taskIds.length} tarefa(s) automática(s)` : ""}`,
    department: stage.department,
    payload: { stageKey: stage.key, instanceId: instance.id, assigneeId: assignee?.id, dueAt: sla?.dueAt, slaInstanceId: sla?.id, taskIds },
  });

  const href = `/workflow?etapa=${step.id}`;
  if (assignee && assignee.id !== actor.id) {
    await notify({
      userIds: [assignee.id],
      kind: "acao",
      title: `Nova etapa com você: ${stage.name} — ${instance.clientName}`,
      body: sla ? `Prazo do SLA: ${formatDateTime(sla.dueAt)}` : `Gate: ${stage.gate.name}`,
      href,
      entity: stepEntity(step),
    });
  }
  const manager = await getDepartmentManager(stage.department);
  if (manager && manager.id !== assignee?.id && manager.id !== actor.id) {
    await notify({
      userIds: [manager.id],
      kind: "informativa",
      title: `${instance.clientName} entrou em ${stage.name}`,
      body: assignee ? `Responsável: ${assignee.name}` : "Etapa sem responsável — defina um.",
      href,
      entity: stepEntity(step),
    });
  }

  return { ...step, dueAt: sla?.dueAt, slaInstanceId: sla?.id, taskIds };
}

// ---------------------------------------------------------------------------
// Instância
// ---------------------------------------------------------------------------

export interface CreateInstanceInput {
  clientId: string;
  clientName?: string;
  /** Etapa inicial (padrão: marketing para status lead; vendas para os demais). */
  startStageKey?: string;
  actor: WorkflowActor;
  context?: WorkflowInstance["context"];
  templateKey?: string;
}

export interface CreateInstanceResult {
  instance: WorkflowInstance;
  step: WorkflowStep;
  /** true quando o cliente já tinha uma jornada ativa e ela foi devolvida sem criar outra. */
  existing: boolean;
}

/** Cria a jornada de um cliente (idempotente: devolve a jornada ativa existente, se houver). */
export async function createWorkflowInstanceForClient(input: CreateInstanceInput): Promise<CreateInstanceResult> {
  const client = await getById<Client>(COLLECTIONS.clients, input.clientId);
  if (!client) throw new Error("Cliente não encontrado");

  if (client.workflowInstanceId) {
    const current = await getById<WorkflowInstance>(COLLECTIONS.workflowInstances, client.workflowInstanceId);
    if (current && current.status === "ativo") {
      const step = current.currentStepId ? await getById<WorkflowStep>(COLLECTIONS.workflowSteps, current.currentStepId) : null;
      if (step) return { instance: current, step, existing: true };
    }
  }

  const template = await getPublishedTemplate(input.templateKey ?? JOURNEY_TEMPLATE_KEY);
  if (!template) throw new Error("Não há template de workflow publicado");
  const stages = sortedStages(template);
  const startKey = input.startStageKey ?? (client.status === "lead" ? "marketing" : "vendas");
  const stage = stages.find((s) => s.key === startKey) ?? stages[0];
  if (!stage) throw new Error("Template sem etapas");

  const clientName = input.clientName ?? client.tradeName;
  const now = nowIso();
  const instance = await create<WorkflowInstance>(COLLECTIONS.workflowInstances, {
    templateId: template.id,
    templateKey: template.key,
    templateVersion: template.version,
    clientId: client.id,
    clientName,
    title: `Jornada — ${clientName}`,
    currentStageKey: stage.key,
    status: "ativo",
    startedAt: now,
    context: { leadId: client.leadId, ...(input.context ?? {}) },
    gateData: {},
    createdBy: input.actor.id,
  });

  await emitEvent({
    type: "workflow.started",
    actor: input.actor,
    clientId: client.id,
    entity: { type: "workflow_instance", id: instance.id },
    title: "Jornada do cliente iniciada",
    description: `Template ${template.name} v${template.version} · etapa inicial: ${stage.name}`,
    department: stage.department,
    payload: { templateKey: template.key, templateVersion: template.version, stageKey: stage.key },
  });

  const step = await startStep({ instance, stage, actor: input.actor });
  await update<WorkflowInstance>(COLLECTIONS.workflowInstances, instance.id, { currentStepId: step.id });
  await update<Client>(COLLECTIONS.clients, client.id, { workflowInstanceId: instance.id, currentStage: stage.key as Client["currentStage"] });

  return { instance: { ...instance, currentStepId: step.id }, step, existing: false };
}

// ---------------------------------------------------------------------------
// Contexto do gate
// ---------------------------------------------------------------------------

export interface GateContext {
  data: GateContextData;
  documentsCount: number;
}

function latest<T extends { createdAt: string }>(items: T[]): T | undefined {
  return [...items].sort((a, b) => (a.createdAt < b.createdAt ? 1 : -1))[0];
}

/**
 * Monta o objeto lido pelos paths dos campos obrigatórios: lead, opportunity, contract, project, cs
 * (e client) referenciados em `instance.context`, com fallback para o registro mais recente do cliente.
 * Alguns valores são derivados para bater com os paths do template (project.checklist = todos feitos,
 * project.trainingDone, project.acceptance, cs.successPlanId).
 */
export async function buildGateContext(instance: WorkflowInstance): Promise<GateContext> {
  const clientId = instance.clientId;
  const byClient = { where: [["clientId", "==", clientId]] as [string, "==", unknown][] };
  const [client, leadById, oppById, contractById, projectById, opportunities, contracts, projects, csAccounts, plans, trainings, documents] = await Promise.all([
    getById<Client>(COLLECTIONS.clients, clientId),
    instance.context.leadId ? getById<Lead>(COLLECTIONS.leads, instance.context.leadId) : Promise.resolve(null),
    instance.context.opportunityId ? getById<Opportunity>(COLLECTIONS.opportunities, instance.context.opportunityId) : Promise.resolve(null),
    instance.context.contractId ? getById<Contract>(COLLECTIONS.contracts, instance.context.contractId) : Promise.resolve(null),
    instance.context.projectId ? getById<ImplementationProject>(COLLECTIONS.implementationProjects, instance.context.projectId) : Promise.resolve(null),
    list<Opportunity>(COLLECTIONS.opportunities, byClient),
    list<Contract>(COLLECTIONS.contracts, byClient),
    list<ImplementationProject>(COLLECTIONS.implementationProjects, byClient),
    list<CsAccount>(COLLECTIONS.csAccounts, byClient),
    list<SuccessPlan>(COLLECTIONS.successPlans, byClient),
    list<Training>(COLLECTIONS.trainings, byClient),
    list<Document>(COLLECTIONS.documents, byClient),
  ]);

  const lead = leadById ?? (client?.leadId ? await getById<Lead>(COLLECTIONS.leads, client.leadId) : null) ?? latest(await list<Lead>(COLLECTIONS.leads, byClient));
  const opportunity = oppById ?? opportunities.find((o) => o.stage === "ganho") ?? latest(opportunities);
  const contract = contractById ?? contracts.find((c) => c.status !== "cancelado") ?? latest(contracts);
  const project = projectById ?? projects.find((p) => p.status !== "cancelada") ?? latest(projects);
  const cs = latest(csAccounts);
  const activePlan = plans.find((p) => p.status === "ativo") ?? latest(plans);
  const trainingDone = trainings.some((t) => t.status === "realizado");

  const data: GateContextData = {
    client: client ?? undefined,
    lead: lead ?? undefined,
    opportunity: opportunity ?? undefined,
    contract: contract ?? undefined,
    project: project
      ? {
          ...project,
          checklist: project.checklist.length > 0 && project.checklist.every((c) => c.done) ? true : undefined,
          checklistItems: project.checklist,
          trainingDone: trainingDone || project.currentPhase === "go_live" || project.status === "concluida" ? true : undefined,
          acceptance: project.acceptance?.acceptedBy ?? undefined,
        }
      : undefined,
    cs: cs ? { ...cs, successPlanId: activePlan?.id } : client?.ownerCsId ? { ownerId: client.ownerCsId, successPlanId: activePlan?.id } : undefined,
    instance: { id: instance.id, gateData: instance.gateData, context: instance.context },
  };

  return { data, documentsCount: documents.length };
}

/** Avalia o gate de uma etapa carregando template e contexto. */
export async function evaluateStepGate(step: WorkflowStep, options: { instance?: WorkflowInstance; template?: WorkflowTemplate } = {}): Promise<{ evaluation: GateEvaluation; stage: WorkflowStage; instance: WorkflowInstance; template: WorkflowTemplate; context: GateContext }> {
  const instance = options.instance ?? (await loadInstance(step.instanceId));
  const template = options.template ?? (await getTemplateForInstance(instance));
  if (!template) throw new Error("Template da jornada não encontrado");
  const stage = findStage(template, step.stageKey);
  if (!stage) throw new Error(`Etapa ${step.stageKey} não existe no template v${template.version}`);
  const context = await buildGateContext(instance);
  return { evaluation: evaluateGate(step, stage, context.data, { documentsCount: context.documentsCount }), stage, instance, template, context };
}

// ---------------------------------------------------------------------------
// Conclusão do gate
// ---------------------------------------------------------------------------

export interface CompleteGateInput {
  stepId: string;
  actor: WorkflowActor;
  /** Valores manuais do gate, por path. Mesclados com os já gravados. */
  fields?: Record<string, unknown>;
  /** Itens do checklist a marcar/desmarcar. */
  checklist?: { id: string; done: boolean }[];
  notes?: string;
  /** Permite concluir com pendências (só gestor/admin/diretoria ou chamadas de sistema). */
  exceptionReason?: string;
  /** Chamada por handler de evento: aceita exceção e dispensa aprovação (o evento é a aprovação). */
  system?: boolean;
}

export type CompleteGateResult =
  | { status: "blocked"; step: WorkflowStep; evaluation: GateEvaluation; message: string }
  | { status: "awaiting_approval"; step: WorkflowStep; approverNames: string[] }
  | { status: "completed"; step: WorkflowStep; nextStep: WorkflowStep | null; instanceCompleted: boolean; clientStatus?: ClientStatus };

function applyChecklistUpdates(checklist: ChecklistItem[], updates: { id: string; done: boolean }[] | undefined, actorId: string): ChecklistItem[] {
  if (!updates || updates.length === 0) return checklist;
  const now = nowIso();
  return checklist.map((item) => {
    const u = updates.find((x) => x.id === item.id);
    if (!u || u.done === item.done) return item;
    return { ...item, done: u.done, doneAt: u.done ? now : undefined, doneBy: u.done ? actorId : undefined };
  });
}

function mergeFields(current: Record<string, unknown>, incoming: Record<string, unknown> | undefined, stage: WorkflowStage): Record<string, unknown> {
  if (!incoming) return current;
  const merged = { ...current };
  for (const [path, raw] of Object.entries(incoming)) {
    const field = stage.gate.requiredFields.find((f) => f.path === path);
    const value = field ? coerceGateValue(raw, field.type) : raw;
    if (value === undefined || value === null || value === "") delete merged[path];
    else merged[path] = value;
  }
  return merged;
}

/**
 * Valida o gate e conclui a etapa (ou pede aprovação). Sempre persiste campos/checklist/notas
 * recebidos, mesmo quando o gate bloqueia — o trabalho parcial não se perde.
 */
export async function completeGate(input: CompleteGateInput): Promise<CompleteGateResult> {
  const actor: UserRef = { id: input.actor.id, name: input.actor.name };
  const role = input.system ? undefined : await resolveActorRole(input.actor);
  const step = await loadStep(input.stepId);
  if (step.status === "concluida" || step.status === "pulada") throw new Error("Esta etapa já foi concluída");

  const instance = await loadInstance(step.instanceId);
  if (instance.status !== "ativo") throw new Error("A jornada não está ativa");
  const template = await getTemplateForInstance(instance);
  if (!template) throw new Error("Template da jornada não encontrado");
  const stage = findStage(template, step.stageKey);
  if (!stage) throw new Error(`Etapa ${step.stageKey} não existe no template v${template.version}`);

  // 1) Persiste o que veio junto (campos manuais, checklist, notas).
  const fields = mergeFields(step.fields ?? {}, input.fields, stage);
  const checklist = applyChecklistUpdates(step.checklist ?? [], input.checklist, actor.id);
  const patch: Partial<WorkflowStep> = {};
  if (input.fields) patch.fields = fields;
  if (input.checklist) patch.checklist = checklist;
  if (input.notes) patch.notes = input.notes;
  if (Object.keys(patch).length > 0) await update<WorkflowStep>(COLLECTIONS.workflowSteps, step.id, patch);
  const current: WorkflowStep = { ...step, ...patch, fields, checklist };

  // 2) Avalia o gate.
  const context = await buildGateContext(instance);
  const evaluation = evaluateGate(current, stage, context.data, { documentsCount: context.documentsCount });
  const exception = input.exceptionReason?.trim();
  if (!evaluation.ok) {
    const allowed = Boolean(exception) && (input.system || isManagerRole(role));
    if (!allowed) {
      const message = exception ? "Só gestores ou administradores podem concluir uma etapa com pendências." : `Gate "${stage.gate.name}" não atendido — ${describeMissing(evaluation)}`;
      return { status: "blocked", step: current, evaluation, message };
    }
  }

  // 3) Aprovação (quando exigida e ainda não concedida).
  if (stage.gate.requiresApproval && !current.approval?.approvedAt && !input.system) {
    if (!canApproveStage(stage, role)) {
      if (current.status === "aguardando_aprovacao") throw new Error("Esta etapa já aguarda aprovação");
      const approvers = await resolveApprovers(stage);
      const requestedAt = nowIso();
      await setStepApproval(step.id, { requestedAt }, { status: "aguardando_aprovacao", exceptionReason: exception || undefined });
      const targets = approvers.map((u) => u.id).filter((id) => id !== actor.id);
      await emitEvent({
        type: "workflow.stage.blocked",
        actor,
        clientId: instance.clientId,
        entity: stepEntity(step),
        title: `Etapa ${stage.name} aguardando aprovação`,
        description: `Aprovador(es): ${approvers.map((u) => u.name).join(", ") || "não definido"}${exception ? ` · exceção: ${exception}` : ""}`,
        department: stage.department,
        payload: { stageKey: stage.key, instanceId: instance.id, approverIds: approvers.map((u) => u.id), approverRole: stage.gate.approverRole, exceptionReason: exception },
      });
      if (targets.length > 0) {
        await notify({
          userIds: targets,
          kind: "acao",
          title: `Aprovação pendente: ${stage.name} — ${instance.clientName}`,
          body: `${actor.name} concluiu o gate "${stage.gate.name}" e aguarda sua aprovação.`,
          href: `/workflow?etapa=${step.id}`,
          entity: stepEntity(step),
        });
      }
      return { status: "awaiting_approval", step: { ...current, status: "aguardando_aprovacao", approval: { ...(current.approval ?? {}), requestedAt } }, approverNames: approvers.map((u) => u.name) };
    }
    // O próprio ator pode aprovar: registra a aprovação e segue.
    current.approval = { ...(current.approval ?? {}), approvedAt: nowIso(), approvedBy: actor.id };
  }

  // Chamada de sistema com o gate atendido não é exceção: o motivo só é registrado quando algo ficou pendente
  // (ou quando um usuário informou a exceção explicitamente).
  const recordedException = input.system && evaluation.ok ? undefined : exception;
  return finalizeStep({ step: current, stage, instance, template, actor, exceptionReason: recordedException, fields, system: input.system });
}

interface FinalizeInput {
  step: WorkflowStep;
  stage: WorkflowStage;
  instance: WorkflowInstance;
  template: WorkflowTemplate;
  actor: UserRef;
  fields: Record<string, unknown>;
  exceptionReason?: string;
  system?: boolean;
}

/** Conclui a etapa, encerra o SLA, grava gateData, avança para a próxima etapa e atualiza o cliente. */
async function finalizeStep({ step, stage, instance, template, actor, fields, exceptionReason, system }: FinalizeInput): Promise<Extract<CompleteGateResult, { status: "completed" }>> {
  const completedAt = nowIso();
  const approval = stage.gate.requiresApproval && !step.approval?.approvedAt ? { ...(step.approval ?? {}), approvedAt: completedAt, approvedBy: actor.id } : step.approval;
  await update<WorkflowStep>(COLLECTIONS.workflowSteps, step.id, {
    status: "concluida",
    completedAt,
    completedBy: actor.id,
    exceptionReason: exceptionReason || undefined,
    approval,
    fields,
  });
  await clearStepFields(step.id, step.waitingClient ? ["waitingClient"] : []);

  if (step.slaInstanceId) {
    const sla = await completeSla(step.slaInstanceId);
    if (sla) {
      const breached = completedAt > sla.dueAt;
      await emitEvent({
        type: "sla.completed",
        actor,
        clientId: instance.clientId,
        entity: stepEntity(step),
        title: `SLA da etapa ${stage.name} encerrado ${breached ? "com atraso" : "no prazo"}`,
        department: stage.department,
        payload: { slaInstanceId: sla.id, ownerId: sla.ownerId, breached, dueAt: sla.dueAt, completedAt },
        timeline: false,
      });
    }
  }

  const gateData = { ...(instance.gateData ?? {}), [stage.key]: fields };
  await update<WorkflowInstance>(COLLECTIONS.workflowInstances, instance.id, { gateData });

  await emitEvent({
    type: "workflow.stage.completed",
    actor,
    clientId: instance.clientId,
    entity: stepEntity(step),
    title: `Etapa ${stage.name} concluída por ${actor.name}`,
    description: exceptionReason ? `Gate "${stage.gate.name}" concluído por exceção: ${exceptionReason}` : `Gate "${stage.gate.name}" atendido`,
    department: stage.department,
    payload: { stageKey: stage.key, instanceId: instance.id, exceptionReason, system: Boolean(system), fields: JSON.parse(JSON.stringify(fields)) as Record<string, unknown> },
  });

  const completedStep: WorkflowStep = { ...step, status: "concluida", completedAt, completedBy: actor.id, exceptionReason: exceptionReason || undefined, approval, fields, waitingClient: undefined };
  const client = await getById<Client>(COLLECTIONS.clients, instance.clientId);
  const clientPatch: Partial<Client> = {};
  let clientStatus: ClientStatus | undefined;

  // Mudanças de status do cliente ligadas à passagem de gate.
  if (client) {
    if (stage.key === "marketing" && client.status === "lead") clientStatus = "prospect";
    if (stage.key === "financeiro" && (client.status === "lead" || client.status === "prospect")) clientStatus = "em_implantacao";
    if (stage.key === "implantacao" && client.status !== "ativo") {
      clientStatus = "ativo";
      if (!client.activatedAt) clientPatch.activatedAt = completedAt;
    }
  }

  const next = nextStageOf(template, stage.key);
  let nextStep: WorkflowStep | null = null;
  if (next) {
    nextStep = await startStep({ instance: { ...instance, gateData }, stage: next, actor });
    await update<WorkflowInstance>(COLLECTIONS.workflowInstances, instance.id, { currentStageKey: next.key, currentStepId: nextStep.id });
    clientPatch.currentStage = next.key as Client["currentStage"];
  } else {
    await update<WorkflowInstance>(COLLECTIONS.workflowInstances, instance.id, { status: "concluido", completedAt });
    await emitEvent({
      type: "workflow.completed",
      actor,
      clientId: instance.clientId,
      entity: { type: "workflow_instance", id: instance.id },
      title: "Jornada do cliente concluída",
      description: `Última etapa: ${stage.name}`,
      department: stage.department,
      payload: { templateKey: instance.templateKey, templateVersion: instance.templateVersion },
    });
  }

  if (client) {
    if (clientStatus && clientStatus !== client.status) clientPatch.status = clientStatus;
    if (Object.keys(clientPatch).length > 0) await update<Client>(COLLECTIONS.clients, client.id, clientPatch);
    if (clientPatch.status) {
      await emitEvent({
        type: "client.status_changed",
        actor,
        clientId: client.id,
        entity: { type: "client", id: client.id },
        title: `Status do cliente: ${client.status} → ${clientPatch.status}`,
        description: `Alterado pela conclusão da etapa ${stage.name}`,
        department: stage.department,
        payload: { from: client.status, to: clientPatch.status, stageKey: stage.key },
      });
    }
  }

  return { status: "completed", step: completedStep, nextStep, instanceCompleted: !next, clientStatus: clientPatch.status };
}

// ---------------------------------------------------------------------------
// Aprovação
// ---------------------------------------------------------------------------

export async function approveGate(stepId: string, actor: WorkflowActor): Promise<CompleteGateResult> {
  const role = await resolveActorRole(actor);
  const step = await loadStep(stepId);
  if (step.status !== "aguardando_aprovacao") throw new Error("Esta etapa não está aguardando aprovação");
  const instance = await loadInstance(step.instanceId);
  const template = await getTemplateForInstance(instance);
  if (!template) throw new Error("Template da jornada não encontrado");
  const stage = findStage(template, step.stageKey);
  if (!stage) throw new Error("Etapa não existe no template");
  if (!canApproveStage(stage, role)) throw new Error("Você não tem permissão para aprovar esta etapa");

  const approvedAt = nowIso();
  const approval = { requestedAt: step.approval?.requestedAt, approvedAt, approvedBy: actor.id };
  await setStepApproval(step.id, approval);
  const approved: WorkflowStep = { ...step, approval };

  // Revalida o gate: se algo foi desfeito entre o pedido e a aprovação, bloqueia (salvo exceção já registrada).
  const context = await buildGateContext(instance);
  const evaluation = evaluateGate(approved, stage, context.data, { documentsCount: context.documentsCount });
  if (!evaluation.ok && !step.exceptionReason) {
    return { status: "blocked", step: approved, evaluation, message: `Gate "${stage.gate.name}" não atendido — ${describeMissing(evaluation)}` };
  }
  return finalizeStep({ step: approved, stage, instance, template, actor: { id: actor.id, name: actor.name }, fields: approved.fields ?? {}, exceptionReason: step.exceptionReason });
}

export async function rejectGate(stepId: string, actor: WorkflowActor, reason: string): Promise<WorkflowStep> {
  const role = await resolveActorRole(actor);
  const step = await loadStep(stepId);
  if (step.status !== "aguardando_aprovacao") throw new Error("Esta etapa não está aguardando aprovação");
  const instance = await loadInstance(step.instanceId);
  const template = await getTemplateForInstance(instance);
  const stage = template ? findStage(template, step.stageKey) : null;
  if (!stage) throw new Error("Etapa não existe no template");
  if (!canApproveStage(stage, role)) throw new Error("Você não tem permissão para rejeitar esta etapa");

  const rejectedAt = nowIso();
  const approval = { requestedAt: step.approval?.requestedAt, rejectedAt, reason };
  await setStepApproval(step.id, approval, { status: "em_andamento" });
  await clearStepFields(step.id, step.exceptionReason ? ["exceptionReason"] : []);
  await emitEvent({
    type: "workflow.gate.rejected",
    actor,
    clientId: instance.clientId,
    entity: stepEntity(step),
    title: `Aprovação da etapa ${stage.name} rejeitada por ${actor.name}`,
    description: reason,
    department: stage.department,
    payload: { stageKey: stage.key, instanceId: instance.id, reason, assigneeId: step.assigneeId },
  });
  if (step.assigneeId && step.assigneeId !== actor.id) {
    await notify({
      userIds: [step.assigneeId],
      kind: "atencao",
      title: `Aprovação rejeitada: ${stage.name} — ${instance.clientName}`,
      body: reason,
      href: `/workflow?etapa=${step.id}`,
      entity: stepEntity(step),
    });
  }
  return { ...step, status: "em_andamento", approval, exceptionReason: undefined };
}

// ---------------------------------------------------------------------------
// Aguardando cliente / retomar
// ---------------------------------------------------------------------------

export async function setStepWaitingClient(stepId: string, reason: string, actor: WorkflowActor): Promise<WorkflowStep> {
  const step = await loadStep(stepId);
  if (step.status !== "em_andamento") throw new Error("Só etapas em andamento podem aguardar o cliente");
  const since = nowIso();
  const waitingClient = { reason, since };
  await update<WorkflowStep>(COLLECTIONS.workflowSteps, step.id, { status: "aguardando_cliente", waitingClient });
  if (step.slaInstanceId) await pauseSla(step.slaInstanceId, reason);
  await emitEvent({
    type: "sla.paused",
    actor,
    clientId: step.clientId,
    entity: stepEntity(step),
    title: `Etapa ${step.stageName} aguardando cliente`,
    description: reason,
    department: step.department,
    payload: { stageKey: step.stageKey, instanceId: step.instanceId, slaInstanceId: step.slaInstanceId, reason },
  });
  return { ...step, status: "aguardando_cliente", waitingClient };
}

export async function resumeStep(stepId: string, actor: WorkflowActor): Promise<WorkflowStep> {
  const step = await loadStep(stepId);
  if (step.status !== "aguardando_cliente") throw new Error("Esta etapa não está aguardando o cliente");
  await update<WorkflowStep>(COLLECTIONS.workflowSteps, step.id, { status: "em_andamento" });
  await clearStepFields(step.id, ["waitingClient"]);
  let dueAt = step.dueAt;
  if (step.slaInstanceId) {
    await resumeSla(step.slaInstanceId);
    const sla = await getById<SlaInstance>(COLLECTIONS.slaInstances, step.slaInstanceId);
    if (sla) {
      dueAt = sla.dueAt;
      await update<WorkflowStep>(COLLECTIONS.workflowSteps, step.id, { dueAt });
    }
  }
  await emitEvent({
    type: "sla.resumed",
    actor,
    clientId: step.clientId,
    entity: stepEntity(step),
    title: `Etapa ${step.stageName} retomada`,
    description: dueAt ? `Novo prazo do SLA: ${formatDateTime(dueAt)}` : undefined,
    department: step.department,
    payload: { stageKey: step.stageKey, instanceId: step.instanceId, slaInstanceId: step.slaInstanceId, dueAt, pausedReason: step.waitingClient?.reason },
  });
  return { ...step, status: "em_andamento", waitingClient: undefined, dueAt };
}

// ---------------------------------------------------------------------------
// Reatribuir, checklist, campos, notas
// ---------------------------------------------------------------------------

export async function reassignStep(stepId: string, assigneeId: string, actor: WorkflowActor): Promise<WorkflowStep> {
  const step = await loadStep(stepId);
  if (!OPEN_STEP_STATUSES.includes(step.status)) throw new Error("Só etapas abertas podem ser reatribuídas");
  const assignee = await getById<User>(COLLECTIONS.users, assigneeId);
  if (!assignee || assignee.active === false) throw new Error("Responsável não encontrado ou inativo");
  if (step.assigneeId === assignee.id) return step;
  await update<WorkflowStep>(COLLECTIONS.workflowSteps, step.id, { assigneeId: assignee.id, assigneeName: assignee.name });
  if (step.slaInstanceId) await update<SlaInstance>(COLLECTIONS.slaInstances, step.slaInstanceId, { ownerId: assignee.id });
  await emitEvent({
    type: "workflow.stage.started",
    actor,
    clientId: step.clientId,
    entity: stepEntity(step),
    title: `Etapa ${step.stageName} reatribuída para ${assignee.name}`,
    description: `Por ${actor.name}${step.assigneeName ? ` · antes: ${step.assigneeName}` : ""}`,
    department: step.department,
    payload: { stageKey: step.stageKey, instanceId: step.instanceId, assigneeId: assignee.id, previousAssigneeId: step.assigneeId, reassigned: true },
    timeline: false,
  });
  if (assignee.id !== actor.id) {
    await notify({
      userIds: [assignee.id],
      kind: "acao",
      title: `Etapa atribuída a você: ${step.stageName} — ${step.clientName}`,
      body: `Reatribuída por ${actor.name}`,
      href: `/workflow?etapa=${step.id}`,
      entity: stepEntity(step),
    });
  }
  return { ...step, assigneeId: assignee.id, assigneeName: assignee.name };
}

export async function updateStepChecklist(stepId: string, updates: { id: string; done: boolean }[], actor: WorkflowActor): Promise<WorkflowStep> {
  const step = await loadStep(stepId);
  if (!OPEN_STEP_STATUSES.includes(step.status)) throw new Error("Só etapas abertas podem ter o checklist alterado");
  const checklist = applyChecklistUpdates(step.checklist ?? [], updates, actor.id);
  await update<WorkflowStep>(COLLECTIONS.workflowSteps, step.id, { checklist });
  const changed = updates.map((u) => checklist.find((c) => c.id === u.id)).filter((c): c is ChecklistItem => Boolean(c));
  const done = checklist.filter((c) => c.done).length;
  await emitEvent({
    type: "workflow.stage.started",
    actor,
    clientId: step.clientId,
    entity: stepEntity(step),
    title: `Checklist de ${step.stageName}: ${changed.map((c) => `${c.done ? "concluído" : "reaberto"} "${c.label}"`).join(", ")}`,
    description: `${done}/${checklist.length} itens concluídos`,
    department: step.department,
    payload: { stageKey: step.stageKey, instanceId: step.instanceId, checklist: true, done, total: checklist.length },
    timeline: false,
  });
  return { ...step, checklist };
}

export async function updateStepFields(stepId: string, fields: Record<string, unknown>, actor: WorkflowActor): Promise<WorkflowStep> {
  const step = await loadStep(stepId);
  if (!OPEN_STEP_STATUSES.includes(step.status)) throw new Error("Só etapas abertas podem ter campos preenchidos");
  const instance = await loadInstance(step.instanceId);
  const template = await getTemplateForInstance(instance);
  const stage = template ? findStage(template, step.stageKey) : null;
  if (!stage) throw new Error("Etapa não existe no template");
  const merged = mergeFields(step.fields ?? {}, fields, stage);
  await update<WorkflowStep>(COLLECTIONS.workflowSteps, step.id, { fields: merged });
  // Chaves removidas precisam ser apagadas explicitamente (set com merge não remove).
  const removed = Object.keys(step.fields ?? {}).filter((k) => !(k in merged));
  if (removed.length > 0) {
    const patch: Record<string, unknown> = {};
    for (const k of removed) patch[`fields.${k}`] = FieldValue.delete();
    await col(COLLECTIONS.workflowSteps).doc(step.id).update(patch);
  }
  const labels = Object.keys(fields).map((path) => stage.gate.requiredFields.find((f) => f.path === path)?.label ?? path);
  await emitEvent({
    type: "workflow.stage.started",
    actor,
    clientId: step.clientId,
    entity: stepEntity(step),
    title: `Campos do gate de ${step.stageName} preenchidos por ${actor.name}`,
    description: labels.join(", "),
    department: step.department,
    payload: { stageKey: step.stageKey, instanceId: step.instanceId, fields: JSON.parse(JSON.stringify(merged)) as Record<string, unknown>, updated: Object.keys(fields) },
    timeline: false,
  });
  return { ...step, fields: merged };
}

/** Nota da etapa: gravada em `comments` (entityType workflow_step) e espelhada como note.added na timeline. */
export async function addStepNote(stepId: string, note: string, actor: WorkflowActor): Promise<Comment> {
  const step = await loadStep(stepId);
  const comment = await create<Comment>(COLLECTIONS.comments, {
    entityType: "workflow_step",
    entityId: step.id,
    clientId: step.clientId,
    authorId: actor.id,
    authorName: actor.name,
    body: note,
    createdBy: actor.id,
  });
  await emitEvent({
    type: "note.added",
    actor,
    clientId: step.clientId,
    entity: stepEntity(step),
    title: `Nota de ${actor.name} na etapa ${step.stageName}`,
    description: note.length > 280 ? `${note.slice(0, 277)}…` : note,
    department: step.department,
    payload: { stageKey: step.stageKey, instanceId: step.instanceId, commentId: comment.id },
  });
  return comment;
}

// ---------------------------------------------------------------------------
// Leituras usadas por outros módulos (Meu Dia, Cliente 360º, dashboards)
// ---------------------------------------------------------------------------

export type StepWithSla = WorkflowStep & { sla: SlaView | null };

async function attachSla(steps: WorkflowStep[]): Promise<StepWithSla[]> {
  const slas = await getManyByIds<SlaInstance>(
    COLLECTIONS.slaInstances,
    steps.map((s) => s.slaInstanceId ?? "").filter(Boolean),
  );
  const now = new Date();
  return steps.map((s) => ({ ...s, sla: s.slaInstanceId && slas.get(s.slaInstanceId) ? computeSlaState(slas.get(s.slaInstanceId)!, now) : null }));
}

/** Etapas abertas de um responsável, com SLA calculado, ordenadas por prazo. */
export async function listStepsForUser(userId: string): Promise<StepWithSla[]> {
  const steps = await list<WorkflowStep>(COLLECTIONS.workflowSteps, { where: [["assigneeId", "==", userId]] });
  const open = steps.filter((s) => OPEN_STEP_STATUSES.includes(s.status));
  return (await attachSla(open)).sort((a, b) => (a.dueAt ?? "9").localeCompare(b.dueAt ?? "9"));
}

/** Etapas abertas de um departamento, com SLA calculado. */
export async function listStepsByDepartment(department: DepartmentKey): Promise<StepWithSla[]> {
  const open = await listOpenStepsByDepartment(department);
  return (await attachSla(open)).sort((a, b) => (a.dueAt ?? "9").localeCompare(b.dueAt ?? "9"));
}

export interface InstanceDetailData {
  instance: WorkflowInstance;
  template: WorkflowTemplate | null;
  stages: WorkflowStage[];
  steps: StepWithSla[];
  client: Client | null;
  /** Tarefas por step (processType workflow). */
  tasksByStep: Record<string, Task[]>;
}

/** Instância com etapas ordenadas, cliente, template e tarefas de cada etapa. */
export async function getInstanceDetail(instanceId: string): Promise<InstanceDetailData | null> {
  const instance = await getById<WorkflowInstance>(COLLECTIONS.workflowInstances, instanceId);
  if (!instance) return null;
  const [template, rawSteps, client, tasks] = await Promise.all([
    getTemplateForInstance(instance),
    list<WorkflowStep>(COLLECTIONS.workflowSteps, { where: [["instanceId", "==", instanceId]] }),
    getById<Client>(COLLECTIONS.clients, instance.clientId),
    list<Task>(COLLECTIONS.tasks, { where: [["clientId", "==", instance.clientId], ["processType", "==", "workflow"]] }),
  ]);
  const steps = (await attachSla(rawSteps)).sort((a, b) => a.order - b.order || (a.startedAt ?? "").localeCompare(b.startedAt ?? ""));
  const tasksByStep: Record<string, Task[]> = {};
  for (const t of tasks) {
    if (!t.processId) continue;
    (tasksByStep[t.processId] ??= []).push(t);
  }
  return { instance, template, stages: template ? sortedStages(template) : [], steps, client, tasksByStep };
}
