import "server-only";
/**
 * Serviço de Implantação: regras de negócio SEM validação de sessão. Usado pelas Server Actions (que
 * validam sessão, permissão e entrada), pelos handlers de evento (implementation.created,
 * implementation.task.completed) e pelo Financeiro (criação do projeto na liberação do contrato).
 *
 * Ciclo do projeto: aguardando_inicio → em_implantacao → pronta_para_go_live → (gate + aprovação)
 * concluida. Em qualquer ponto antes do go-live: aguardando_cliente (pausa SLA do projeto e da etapa
 * de workflow; acumula atraso externo) ou bloqueada (atraso interno; SLA segue correndo).
 *
 * Erros de regra são lançados como Error com mensagem em português (as actions repassam ao usuário).
 */
import { FieldValue } from "firebase-admin/firestore";
import { batchSet, col, create, getById, getManyByIds, list, newId, nowIso, update } from "@/server/db";
import { emitEvent } from "@/server/events";
import { registerHandler } from "@/server/events/emit";
import { registerImplementationHandlers } from "@/server/events/handlers/implementation";
import { notify } from "@/server/notifications";
import { addBusinessHours, businessDaysToHours, completeSla, getHolidays, pauseSla, resumeSla, startSla } from "@/server/sla";
import { completeTaskInternal, createTaskInternal } from "@/server/tasks/service";
import { getDepartmentManager, reassignStep, resumeStep, setStepWaitingClient, updateStepChecklist } from "@/server/workflow/service";
import { getSetting } from "@/server/admin/queries";
import { formatDate } from "@/lib/format";
import { shortId } from "@/lib/utils";
import {
  COLLECTIONS,
  type Client,
  type ClientProduct,
  type Contract,
  type CsAccount,
  type Document,
  type DomainEvent,
  type ImplementationPhase,
  type ImplementationProject,
  type ImplementationTask,
  type Settings,
  type SlaInstance,
  type Task,
  type Training,
  type User,
  type UserRef,
  type WorkflowInstance,
  type WorkflowStep,
} from "@/domain/types";
import type { RoleKey } from "@/domain/constants";
import { IMPLEMENTATION_PHASE_LABELS } from "@/components/clients/labels";
import { combineTemplates, templatesForProducts } from "./templates";
import {
  DEFAULT_GO_LIVE_SETTINGS,
  GO_LIVE_SETTING_KEY,
  computeProgress,
  evaluateGoLiveGate,
  isActiveProject,
  pendingBeforeGoLive,
  pendingRequired,
  phaseIndex,
  projectPhases,
  type GoLiveSettings,
  type ProjectRecord,
} from "./schemas";

// Registro idempotente dos handlers da Implantação (ver src/server/events/handlers/implementation.ts).
registerImplementationHandlers(registerHandler);

/** Ator das operações, com papel (aprovação de go-live e mudança de fase). */
export type ImplementationActor = UserRef & { role?: RoleKey; isManager?: boolean };

const SYSTEM_ACTOR: UserRef = { id: "system", name: "INTEROS" };
const OPEN_TASK = new Set<ImplementationTask["status"]>(["aberta", "em_andamento", "aguardando"]);
const projectEntity = (id: string) => ({ type: "project", id });
const projectHref = (id: string) => `/implantacao/${id}`;
const phaseLabel = (p: ImplementationPhase) => IMPLEMENTATION_PHASE_LABELS[p];
const ref = (u: Pick<User, "id" | "name">): UserRef => ({ id: u.id, name: u.name });

// ---------------------------------------------------------------------------
// Utilitários
// ---------------------------------------------------------------------------

export async function loadProject(id: string): Promise<ProjectRecord> {
  const project = await getById<ProjectRecord>(COLLECTIONS.implementationProjects, id);
  if (!project) throw new Error("Projeto de implantação não encontrado");
  return project;
}

async function loadTask(id: string): Promise<ImplementationTask> {
  const task = await getById<ImplementationTask>(COLLECTIONS.implementationTasks, id);
  if (!task) throw new Error("Tarefa do projeto não encontrada");
  return task;
}

async function loadClient(id: string): Promise<Client> {
  const client = await getById<Client>(COLLECTIONS.clients, id);
  if (!client) throw new Error("Cliente não encontrado");
  return client;
}

export async function projectTasks(projectId: string): Promise<ImplementationTask[]> {
  return list<ImplementationTask>(COLLECTIONS.implementationTasks, { where: [["projectId", "==", projectId]] });
}

export async function projectTrainings(projectId: string): Promise<Training[]> {
  return list<Training>(COLLECTIONS.trainings, { where: [["projectId", "==", projectId]] });
}

/** Remove campos do documento (o `update` de db.ts ignora `undefined`). */
async function clearFields(collection: typeof COLLECTIONS.implementationProjects | typeof COLLECTIONS.implementationTasks, id: string, fields: string[]): Promise<void> {
  if (fields.length === 0) return;
  const patch: Record<string, unknown> = { updatedAt: nowIso() };
  for (const f of fields) patch[f] = FieldValue.delete();
  await col(collection).doc(id).update(patch);
}

function assertActive(project: ProjectRecord): void {
  if (project.status === "concluida") throw new Error("O go-live deste projeto já foi registrado");
  if (project.status === "cancelada") throw new Error("Projeto cancelado");
}

async function activeUser(id: string, label: string): Promise<User> {
  const user = await getById<User>(COLLECTIONS.users, id);
  if (!user || user.active === false) throw new Error(`${label} não encontrado ou inativo`);
  return user;
}

/** Horas úteis (seg–sex, 08–18h, UTC-3, sem feriados) entre dois instantes. */
function businessHoursBetween(start: Date, end: Date, holidays: Set<string>): number {
  if (end <= start) return 0;
  const offset = 3 * 3_600_000;
  const ls = start.getTime() - offset;
  const le = end.getTime() - offset;
  const first = new Date(ls);
  let day = Date.UTC(first.getUTCFullYear(), first.getUTCMonth(), first.getUTCDate());
  let totalMs = 0;
  while (day <= le) {
    const d = new Date(day);
    const weekday = d.getUTCDay();
    if (weekday !== 0 && weekday !== 6 && !holidays.has(d.toISOString().slice(0, 10))) {
      const s = Math.max(day + 8 * 3_600_000, ls);
      const e = Math.min(day + 18 * 3_600_000, le);
      if (e > s) totalMs += e - s;
    }
    day += 86_400_000;
  }
  return totalMs / 3_600_000;
}

/** Dias úteis (1 casa decimal) entre `since` e agora. */
async function businessDaysSince(since: string): Promise<number> {
  const holidays = await getHolidays();
  const hours = businessHoursBetween(new Date(since), new Date(), holidays);
  return Math.round((hours / 10) * 10) / 10;
}

/** Etapa "implantacao" aberta da jornada do cliente (para pausar/retomar junto com o projeto). */
async function currentImplementationStep(client: Client): Promise<{ instance: WorkflowInstance; step: WorkflowStep } | null> {
  if (!client.workflowInstanceId) return null;
  const instance = await getById<WorkflowInstance>(COLLECTIONS.workflowInstances, client.workflowInstanceId);
  if (!instance || instance.status !== "ativo" || instance.currentStageKey !== "implantacao" || !instance.currentStepId) return null;
  const step = await getById<WorkflowStep>(COLLECTIONS.workflowSteps, instance.currentStepId);
  if (!step || step.status === "concluida" || step.status === "pulada") return null;
  return { instance, step };
}

export async function getGoLiveSettings(): Promise<GoLiveSettings> {
  return getSetting<GoLiveSettings>(GO_LIVE_SETTING_KEY, DEFAULT_GO_LIVE_SETTINGS);
}

export async function saveGoLiveSettings(value: GoLiveSettings, actor: UserRef): Promise<void> {
  const existing = await list<Settings>(COLLECTIONS.settings, { where: [["key", "==", GO_LIVE_SETTING_KEY]] });
  if (existing[0]) await update<Settings>(COLLECTIONS.settings, existing[0].id, { value: { ...value } });
  else await create<Settings>(COLLECTIONS.settings, { key: GO_LIVE_SETTING_KEY, value: { ...value }, description: "Regras de aprovação do go-live da implantação.", createdBy: actor.id }, `setting_${GO_LIVE_SETTING_KEY}`);
}

/** Pode aprovar o go-live: gestor/admin/diretoria; o responsável do projeto só quando a configuração permitir. */
export function canApproveGoLive(project: Pick<ImplementationProject, "ownerId">, actor: Pick<ImplementationActor, "id" | "isManager">, settings: GoLiveSettings): boolean {
  if (actor.isManager) return true;
  return !settings.exigeAprovacaoGestor && project.ownerId === actor.id;
}

// ---------------------------------------------------------------------------
// Criação do projeto (chamada pelo Financeiro na liberação do contrato)
// ---------------------------------------------------------------------------

/** Responsável do projeto: implantador do cliente; senão o analista de implantação com menos projetos ativos; senão o gestor. */
export async function pickImplementationOwner(client: Client): Promise<User | null> {
  if (client.ownerImplementationId) {
    const current = await getById<User>(COLLECTIONS.users, client.ownerImplementationId);
    if (current && current.active !== false) return current;
  }
  const [users, projects, manager] = await Promise.all([
    list<User>(COLLECTIONS.users, { where: [["departmentId", "==", "implantacao"]] }),
    list<ImplementationProject>(COLLECTIONS.implementationProjects),
    getDepartmentManager("implantacao"),
  ]);
  const analysts = users.filter((u) => u.active !== false && u.role === "implantacao");
  if (analysts.length > 0) {
    const load = new Map<string, number>();
    for (const p of projects) if (isActiveProject(p.status)) load.set(p.ownerId, (load.get(p.ownerId) ?? 0) + 1);
    analysts.sort((a, b) => (load.get(a.id) ?? 0) - (load.get(b.id) ?? 0) || a.name.localeCompare(b.name, "pt-BR"));
    return analysts[0];
  }
  return manager ?? users.find((u) => u.active !== false) ?? null;
}

/**
 * Cria o projeto de implantação a partir dos produtos do contrato, combinando os templates de cada
 * produto (fases, tarefas e checklist). Idempotente por contrato. Inicia o SLA do projeto, coloca o
 * cliente em implantação e emite implementation.created (o handler cria a tarefa de kickoff e avisa
 * o responsável e o gestor).
 */
export async function createProjectFromContract(contract: Contract, actor: UserRef, clientArg?: Client): Promise<ImplementationProject | null> {
  const existing = (await list<ImplementationProject>(COLLECTIONS.implementationProjects, { where: [["contractId", "==", contract.id]] })).find((p) => p.status !== "cancelada");
  if (existing) return existing;
  const client = clientArg ?? (await loadClient(contract.clientId));

  const productIds = Array.from(new Set(contract.items.map((i) => i.productId)));
  const [{ products, templates }, holidays, owner] = await Promise.all([templatesForProducts(productIds), getHolidays(), pickImplementationOwner(client)]);
  if (!owner) throw new Error("Nenhum usuário de implantação ativo para assumir o projeto");

  const now = new Date();
  const projectId = newId(COLLECTIONS.implementationProjects);
  const plan = combineTemplates(templates, Array.from(products.values()), { projectId, clientId: client.id, ownerId: owner.id, actorId: actor.id, start: now, holidays });
  const dueDate = addBusinessHours(now, businessDaysToHours(plan.totalDays), holidays).toISOString();
  const productNames = contract.items.map((i) => (i.quantity > 1 ? `${i.productName} (${i.quantity})` : i.productName));

  const project = await create<ImplementationProject>(
    COLLECTIONS.implementationProjects,
    {
      clientId: client.id,
      contractId: contract.id,
      workflowInstanceId: client.workflowInstanceId,
      name: `Implantação ${client.tradeName}`,
      productIds,
      scope: `Contrato ${contract.number} v${contract.version}. Produtos: ${productNames.join(", ")}.`,
      ownerId: owner.id,
      teamIds: [owner.id],
      status: "aguardando_inicio",
      currentPhase: plan.phases[0] ?? "kickoff",
      dueDate,
      progress: 0,
      externalDelayDays: 0,
      internalDelayDays: 0,
      checklist: plan.checklist,
      createdBy: actor.id,
    },
    projectId,
  );

  const stamp = nowIso();
  await batchSet(plan.tasks.map((t) => ({ collection: COLLECTIONS.implementationTasks, id: newId(COLLECTIONS.implementationTasks), data: { ...t, organizationId: contract.organizationId, createdAt: stamp, updatedAt: stamp } })));

  const sla = await startSla({
    ruleKey: "implantacao.projeto",
    entityType: "projeto",
    entityId: project.id,
    clientId: client.id,
    ownerId: owner.id,
    department: "implantacao",
    resolutionHours: businessDaysToHours(plan.totalDays),
  });
  await update<ImplementationProject>(COLLECTIONS.implementationProjects, project.id, { slaInstanceId: sla.id });

  // A jornada passa a referenciar o projeto (o gate da etapa Implantação lê project.*).
  if (client.workflowInstanceId) {
    const instance = await getById<WorkflowInstance>(COLLECTIONS.workflowInstances, client.workflowInstanceId);
    if (instance && instance.status === "ativo") await update<WorkflowInstance>(COLLECTIONS.workflowInstances, instance.id, { context: { ...instance.context, projectId: project.id } });
  }

  const clientPatch: Partial<Client> = { ownerImplementationId: owner.id };
  if (client.status !== "em_implantacao" && client.status !== "ativo") clientPatch.status = "em_implantacao";
  await update<Client>(COLLECTIONS.clients, client.id, clientPatch);
  if (clientPatch.status) {
    await emitEvent({
      type: "client.status_changed",
      actor,
      clientId: client.id,
      entity: { type: "client", id: client.id },
      title: `Status do cliente: ${client.status} → em_implantacao`,
      description: `Liberação financeira do contrato ${contract.number}`,
      department: "financeiro",
      payload: { from: client.status, to: "em_implantacao", contractId: contract.id },
    });
  }

  await emitEvent({
    type: "implementation.created",
    actor,
    clientId: client.id,
    entity: projectEntity(project.id),
    title: `Projeto de implantação criado: ${project.name}`,
    description: `Responsável: ${owner.name} · ${plan.phases.length} fase(s) · ${plan.tasks.length} tarefa(s) · prazo ${formatDate(dueDate)} (${plan.totalDays} dia(s) útil(eis))`,
    department: "implantacao",
    payload: { projectId: project.id, contractId: contract.id, ownerId: owner.id, productIds, templateIds: templates.map((t) => t.id), taskCount: plan.tasks.length, dueDate, slaInstanceId: sla.id },
  });
  await emitEvent({
    type: "sla.started",
    actor,
    clientId: client.id,
    entity: projectEntity(project.id),
    title: `SLA do projeto de implantação iniciado: ${sla.ruleName}`,
    description: `Prazo: ${formatDate(sla.dueAt)}`,
    department: "implantacao",
    payload: { slaInstanceId: sla.id, dueAt: sla.dueAt, ownerId: owner.id, ruleKey: sla.ruleKey },
    timeline: false,
  });
  return { ...project, slaInstanceId: sla.id };
}

/** Handler de implementation.created: tarefa de kickoff (+1 dia útil) para o responsável e avisos. Idempotente. */
export async function onProjectCreated(event: DomainEvent): Promise<void> {
  const projectId = event.entityType === "project" && event.entityId ? event.entityId : String(event.payload.projectId ?? "");
  const project = projectId ? await getById<ProjectRecord>(COLLECTIONS.implementationProjects, projectId) : null;
  if (!project) return;
  const client = await getById<Client>(COLLECTIONS.clients, project.clientId);
  const clientName = client?.tradeName ?? project.name;
  const title = `Kickoff de implantação: ${clientName}`;
  const existing = await list<Task>(COLLECTIONS.tasks, { where: [["processId", "==", project.id]] });
  if (!existing.some((t) => t.title === title && t.status !== "cancelada")) {
    const holidays = await getHolidays();
    await createTaskInternal(
      {
        title,
        description: `Agende e conduza o kickoff com o cliente: confirme o contato responsável, o escopo (${project.scope ?? "ver contrato"}) e o cronograma. Prazo do projeto: ${formatDate(project.dueDate)}.`,
        clientId: project.clientId,
        assigneeId: project.ownerId,
        departmentId: "implantacao",
        priority: "alta",
        dueAt: addBusinessHours(new Date(event.occurredAt), businessDaysToHours(1), holidays).toISOString(),
        processType: "project",
        processId: project.id,
        origin: "evento",
        sourceEventId: event.id,
        checklist: ["Confirmar contato responsável", "Validar escopo contratado", "Definir cronograma com o cliente"],
        tags: ["implantacao", "kickoff"],
      },
      { id: event.actorId, name: event.actorName },
    );
  }
  const manager = await getDepartmentManager("implantacao");
  await notify({
    userIds: [project.ownerId].filter((id) => id !== event.actorId),
    kind: "acao",
    title: `Novo projeto de implantação: ${clientName}`,
    body: `Prazo ${formatDate(project.dueDate)}. Agende o kickoff.`,
    href: projectHref(project.id),
    entity: projectEntity(project.id),
    eventId: event.id,
  });
  if (manager && manager.id !== project.ownerId && manager.id !== event.actorId) {
    await notify({
      userIds: [manager.id],
      kind: "informativa",
      title: `${clientName} liberado para implantação`,
      body: `Projeto atribuído a ${(await getById<User>(COLLECTIONS.users, project.ownerId))?.name ?? "responsável"}.`,
      href: projectHref(project.id),
      entity: projectEntity(project.id),
      eventId: event.id,
    });
  }
}

// ---------------------------------------------------------------------------
// Início, progresso e fases
// ---------------------------------------------------------------------------

/** Primeiro trabalho no projeto: aguardando_inicio → em_implantacao (+ startDate) e implementation.started. */
async function ensureStarted(project: ProjectRecord, actor: UserRef): Promise<ProjectRecord> {
  if (project.status !== "aguardando_inicio") return project;
  const startDate = project.startDate ?? nowIso();
  await update<ImplementationProject>(COLLECTIONS.implementationProjects, project.id, { status: "em_implantacao", startDate });
  await emitEvent({
    type: "implementation.started",
    actor,
    clientId: project.clientId,
    entity: projectEntity(project.id),
    title: `Implantação iniciada: ${project.name}`,
    description: `Fase atual: ${phaseLabel(project.currentPhase)}`,
    department: "implantacao",
    payload: { projectId: project.id, kind: "inicio", startDate },
  });
  return { ...project, status: "em_implantacao", startDate };
}

/**
 * Recalcula o progresso e o status do projeto a partir das tarefas:
 * - progresso = obrigatórias concluídas / total de obrigatórias;
 * - com `advancePhase` (conclusão de tarefa), a fase atual avança quando todas as obrigatórias dela terminam;
 * - todas as obrigatórias antes do go-live concluídas → pronta_para_go_live (o inverso ao reabrir).
 * Idempotente: chamado pelo handler de implementation.task.completed (com avanço de fase) e após
 * reabrir/adicionar tarefas, mudar a fase manualmente ou retomar o projeto (sem avanço, para não
 * desfazer um retorno manual de fase).
 */
export async function syncProjectProgress(projectId: string, actor: UserRef = SYSTEM_ACTOR, options: { advancePhase?: boolean } = {}): Promise<ProjectRecord | null> {
  const project = await getById<ProjectRecord>(COLLECTIONS.implementationProjects, projectId);
  if (!project) return null;
  const tasks = await projectTasks(projectId);
  const progress = project.status === "concluida" ? 100 : computeProgress(tasks);
  const patch: Partial<ImplementationProject> = {};
  if (progress !== project.progress) patch.progress = progress;
  if (!isActiveProject(project.status)) {
    if (Object.keys(patch).length > 0) await update<ImplementationProject>(COLLECTIONS.implementationProjects, projectId, patch);
    return { ...project, ...patch };
  }

  const phases = projectPhases(tasks, project.currentPhase);
  let phase = project.currentPhase;
  while (options.advancePhase && phase !== "go_live" && pendingRequired(tasks, [phase]).length === 0) {
    const next = phases.find((p) => phaseIndex(p) > phaseIndex(phase));
    if (!next) break;
    phase = next;
  }
  const readyForGoLive = pendingBeforeGoLive(tasks).length === 0 && tasks.length > 0;
  if (readyForGoLive && phases.includes("go_live")) phase = "go_live";
  if (phase !== project.currentPhase) patch.currentPhase = phase;

  let status = project.status;
  if (readyForGoLive && (status === "em_implantacao" || status === "aguardando_inicio")) status = "pronta_para_go_live";
  if (!readyForGoLive && status === "pronta_para_go_live") status = "em_implantacao";
  if (status !== project.status) patch.status = status;
  if (status !== "aguardando_inicio" && !project.startDate) patch.startDate = nowIso();

  if (Object.keys(patch).length === 0) return project;
  await update<ImplementationProject>(COLLECTIONS.implementationProjects, projectId, patch);

  if (patch.currentPhase) {
    await emitEvent({
      type: "implementation.started",
      actor,
      clientId: project.clientId,
      entity: projectEntity(project.id),
      title: `Fase avançada: ${phaseLabel(project.currentPhase)} → ${phaseLabel(patch.currentPhase)}`,
      description: "Todas as tarefas obrigatórias da fase foram concluídas.",
      department: "implantacao",
      payload: { projectId, kind: "fase", from: project.currentPhase, to: patch.currentPhase, automatic: true },
    });
  }
  if (patch.status === "pronta_para_go_live") {
    const manager = await getDepartmentManager("implantacao");
    await notify({
      userIds: [project.ownerId, manager?.id ?? ""].filter((id) => id && id !== actor.id),
      kind: "acao",
      title: `Pronto para go-live: ${project.name}`,
      body: "Tarefas obrigatórias concluídas. Confira checklist, treinamento, validação e aceite do cliente.",
      href: `${projectHref(project.id)}?aba=go-live`,
      entity: projectEntity(project.id),
    });
  }
  return { ...project, ...patch };
}

/**
 * Muda a fase do projeto (kanban). Avançar exige as tarefas obrigatórias concluídas da fase atual até
 * a fase anterior ao destino; voltar é livre.
 */
export async function changePhase(projectId: string, phase: ImplementationPhase, actor: ImplementationActor): Promise<ProjectRecord> {
  let project = await loadProject(projectId);
  assertActive(project);
  if (project.currentPhase === phase) return project;
  const tasks = await projectTasks(projectId);
  const from = phaseIndex(project.currentPhase);
  const to = phaseIndex(phase);
  if (to > from) {
    const crossed = projectPhases(tasks, project.currentPhase).filter((p) => phaseIndex(p) >= from && phaseIndex(p) < to);
    const pending = pendingRequired(tasks, crossed);
    if (pending.length > 0) {
      const list = pending.slice(0, 4).map((t) => `${t.title} (${phaseLabel(t.phase)})`).join("; ");
      throw new Error(`Para avançar para ${phaseLabel(phase)}, conclua ${pending.length} tarefa(s) obrigatória(s): ${list}${pending.length > 4 ? "…" : ""}`);
    }
  }
  project = await ensureStarted(project, actor);
  const patch: Partial<ImplementationProject> = { currentPhase: phase };
  if (project.status === "pronta_para_go_live" && phase !== "go_live") patch.status = "em_implantacao";
  await update<ImplementationProject>(COLLECTIONS.implementationProjects, projectId, patch);
  await emitEvent({
    type: "implementation.started",
    actor,
    clientId: project.clientId,
    entity: projectEntity(project.id),
    title: `Fase alterada: ${phaseLabel(project.currentPhase)} → ${phaseLabel(phase)}`,
    description: `Por ${actor.name}`,
    department: "implantacao",
    payload: { projectId, kind: "fase", from: project.currentPhase, to: phase, automatic: false },
  });
  return (await syncProjectProgress(projectId, actor)) ?? { ...project, ...patch };
}

// ---------------------------------------------------------------------------
// Tarefas do plano
// ---------------------------------------------------------------------------

export async function completeImplementationTask(taskId: string, evidence: string | undefined, actor: ImplementationActor): Promise<ImplementationTask> {
  const task = await loadTask(taskId);
  if (task.status === "concluida") throw new Error("Esta tarefa já está concluída");
  if (task.status === "cancelada") throw new Error("Tarefa cancelada não pode ser concluída");
  const project = await loadProject(task.projectId);
  assertActive(project);
  if (task.dependsOn && task.dependsOn.length > 0) {
    const deps = await getManyByIds<ImplementationTask>(COLLECTIONS.implementationTasks, task.dependsOn);
    const open = Array.from(deps.values()).filter((d) => d.status !== "concluida" && d.status !== "cancelada");
    if (open.length > 0) throw new Error(`Conclua antes as dependências: ${open.map((d) => d.title).join(", ")}`);
  }
  const completedAt = nowIso();
  await update<ImplementationTask>(COLLECTIONS.implementationTasks, task.id, { status: "concluida", completedAt, evidence: evidence ?? task.evidence });
  if (task.taskId) {
    const linked = await getById<Task>(COLLECTIONS.tasks, task.taskId);
    if (linked && linked.status !== "concluida" && linked.status !== "cancelada") {
      try {
        await completeTaskInternal(linked, actor);
      } catch (error) {
        console.error(`[implantacao] falha ao concluir a tarefa vinculada ${linked.id}`, error);
      }
    }
  }
  await ensureStarted(project, actor);
  // O handler de implementation.task.completed recalcula progresso, fase e status do projeto.
  await emitEvent({
    type: "implementation.task.completed",
    actor,
    clientId: task.clientId,
    entity: projectEntity(project.id),
    title: `Tarefa concluída: ${task.title}`,
    description: evidence ? `Evidência: ${evidence}` : `${phaseLabel(task.phase)}${task.required ? " · obrigatória" : ""}`,
    department: "implantacao",
    payload: { projectId: project.id, taskId: task.id, phase: task.phase, required: task.required, evidence },
  });
  return { ...task, status: "concluida", completedAt, evidence: evidence ?? task.evidence };
}

export async function reopenImplementationTask(taskId: string, actor: ImplementationActor): Promise<ImplementationTask> {
  const task = await loadTask(taskId);
  if (task.status !== "concluida") throw new Error("Só tarefas concluídas podem ser reabertas");
  const project = await loadProject(task.projectId);
  assertActive(project);
  await update<ImplementationTask>(COLLECTIONS.implementationTasks, task.id, { status: "aberta" });
  await clearFields(COLLECTIONS.implementationTasks, task.id, ["completedAt"]);
  await emitEvent({
    type: "implementation.started",
    actor,
    clientId: task.clientId,
    entity: projectEntity(project.id),
    title: `Tarefa reaberta: ${task.title}`,
    department: "implantacao",
    payload: { projectId: project.id, taskId: task.id, kind: "tarefa_reaberta" },
    timeline: false,
  });
  await syncProjectProgress(project.id, actor);
  return { ...task, status: "aberta", completedAt: undefined };
}

export async function assignImplementationTask(taskId: string, assigneeId: string, actor: ImplementationActor): Promise<ImplementationTask> {
  const task = await loadTask(taskId);
  const assignee = await activeUser(assigneeId, "Responsável");
  if (task.assigneeId === assignee.id) return task;
  await update<ImplementationTask>(COLLECTIONS.implementationTasks, task.id, { assigneeId: assignee.id });
  await emitEvent({
    type: "implementation.started",
    actor,
    clientId: task.clientId,
    entity: projectEntity(task.projectId),
    title: `Tarefa "${task.title}" atribuída a ${assignee.name}`,
    department: "implantacao",
    payload: { projectId: task.projectId, taskId: task.id, kind: "tarefa_atribuida", assigneeId: assignee.id },
    timeline: false,
  });
  if (assignee.id !== actor.id) {
    await notify({
      userIds: [assignee.id],
      kind: "acao",
      title: `Tarefa de implantação atribuída a você`,
      body: `${task.title}${task.dueAt ? ` · prazo ${formatDate(task.dueAt)}` : ""}`,
      href: `${projectHref(task.projectId)}?aba=plano`,
      entity: projectEntity(task.projectId),
    });
  }
  return { ...task, assigneeId: assignee.id };
}

export interface AddTaskInput {
  projectId: string;
  phase: ImplementationPhase;
  title: string;
  description?: string;
  assigneeId?: string;
  dueAt?: string;
  required: boolean;
  dependsOn: string[];
}

/** Tarefa avulsa no plano do projeto. */
export async function addImplementationTask(input: AddTaskInput, actor: ImplementationActor): Promise<ImplementationTask> {
  const project = await loadProject(input.projectId);
  assertActive(project);
  if (input.assigneeId) await activeUser(input.assigneeId, "Responsável");
  if (input.dependsOn.length > 0) {
    const deps = await getManyByIds<ImplementationTask>(COLLECTIONS.implementationTasks, input.dependsOn);
    if (Array.from(deps.values()).some((d) => d.projectId !== project.id) || deps.size !== new Set(input.dependsOn).size) throw new Error("Dependência inválida para este projeto");
  }
  const task = await create<ImplementationTask>(COLLECTIONS.implementationTasks, {
    projectId: project.id,
    clientId: project.clientId,
    phase: input.phase,
    title: input.title,
    description: input.description,
    assigneeId: input.assigneeId ?? project.ownerId,
    dueAt: input.dueAt,
    status: "aberta",
    required: input.required,
    dependsOn: input.dependsOn.length > 0 ? input.dependsOn : undefined,
    createdBy: actor.id,
  });
  await emitEvent({
    type: "implementation.started",
    actor,
    clientId: project.clientId,
    entity: projectEntity(project.id),
    title: `Tarefa adicionada ao plano: ${task.title}`,
    description: `${phaseLabel(task.phase)}${task.required ? " · obrigatória" : ""}`,
    department: "implantacao",
    payload: { projectId: project.id, taskId: task.id, kind: "tarefa_adicionada" },
  });
  if (task.assigneeId && task.assigneeId !== actor.id) {
    await notify({
      userIds: [task.assigneeId],
      kind: "acao",
      title: "Tarefa de implantação atribuída a você",
      body: task.title,
      href: `${projectHref(project.id)}?aba=plano`,
      entity: projectEntity(project.id),
    });
  }
  await syncProjectProgress(project.id, actor);
  return task;
}

// ---------------------------------------------------------------------------
// Equipe e checklist
// ---------------------------------------------------------------------------

export async function updateProjectTeam(projectId: string, ownerId: string, teamIds: string[], actor: ImplementationActor): Promise<ProjectRecord> {
  const project = await loadProject(projectId);
  assertActive(project);
  const owner = await activeUser(ownerId, "Responsável");
  const members = await getManyByIds<User>(COLLECTIONS.users, teamIds);
  const team = Array.from(new Set([owner.id, ...Array.from(members.values()).filter((u) => u.active !== false).map((u) => u.id)]));
  await update<ImplementationProject>(COLLECTIONS.implementationProjects, projectId, { ownerId: owner.id, teamIds: team });
  if (owner.id !== project.ownerId) {
    if (project.slaInstanceId) await update<SlaInstance>(COLLECTIONS.slaInstances, project.slaInstanceId, { ownerId: owner.id });
    await update<Client>(COLLECTIONS.clients, project.clientId, { ownerImplementationId: owner.id });
    if (owner.id !== actor.id) {
      await notify({
        userIds: [owner.id],
        kind: "acao",
        title: `Você é o responsável pela implantação: ${project.name}`,
        body: `Atribuído por ${actor.name}. Prazo ${formatDate(project.dueDate)}.`,
        href: projectHref(project.id),
        entity: projectEntity(project.id),
      });
    }
  }
  const names = [owner.name, ...team.filter((id) => id !== owner.id).map((id) => members.get(id)?.name).filter(Boolean)];
  await emitEvent({
    type: "implementation.started",
    actor,
    clientId: project.clientId,
    entity: projectEntity(project.id),
    title: owner.id !== project.ownerId ? `Responsável da implantação: ${owner.name}` : "Equipe da implantação atualizada",
    description: `Equipe: ${names.join(", ")}`,
    department: "implantacao",
    payload: { projectId, kind: "equipe", ownerId: owner.id, previousOwnerId: project.ownerId, teamIds: team },
  });
  return { ...project, ownerId: owner.id, teamIds: team };
}

export async function toggleChecklistItem(projectId: string, itemId: string, done: boolean, actor: ImplementationActor): Promise<ProjectRecord> {
  const project = await loadProject(projectId);
  assertActive(project);
  const item = project.checklist.find((c) => c.id === itemId);
  if (!item) throw new Error("Item do checklist não encontrado");
  if (item.done === done) return project;
  const now = nowIso();
  const checklist = project.checklist.map((c) => (c.id === itemId ? { id: c.id, label: c.label, required: c.required, done, ...(done ? { doneAt: now, doneBy: actor.id } : {}) } : c));
  // Substitui o array inteiro (o merge do update manteria doneAt/doneBy de itens desmarcados).
  await col(COLLECTIONS.implementationProjects).doc(projectId).update({ checklist: checklist.map((c) => JSON.parse(JSON.stringify(c)) as Record<string, unknown>), updatedAt: now });
  const doneCount = checklist.filter((c) => c.done).length;
  await emitEvent({
    type: "implementation.started",
    actor,
    clientId: project.clientId,
    entity: projectEntity(project.id),
    title: `Checklist: ${done ? "concluído" : "reaberto"} "${item.label}"`,
    description: `${doneCount}/${checklist.length} itens concluídos`,
    department: "implantacao",
    payload: { projectId, kind: "checklist", itemId, done, doneCount, total: checklist.length },
    timeline: false,
  });
  return { ...project, checklist };
}

export async function addChecklistItem(projectId: string, label: string, required: boolean, actor: ImplementationActor): Promise<ProjectRecord> {
  const project = await loadProject(projectId);
  assertActive(project);
  if (project.checklist.some((c) => c.label.toLowerCase() === label.toLowerCase())) throw new Error("Já existe um item com este texto no checklist");
  const checklist = [...project.checklist, { id: shortId("chk"), label, required, done: false }];
  await update<ImplementationProject>(COLLECTIONS.implementationProjects, projectId, { checklist });
  await emitEvent({
    type: "implementation.started",
    actor,
    clientId: project.clientId,
    entity: projectEntity(project.id),
    title: `Item adicionado ao checklist: ${label}`,
    description: required ? "Obrigatório para o go-live" : "Opcional",
    department: "implantacao",
    payload: { projectId, kind: "checklist_item", required },
    timeline: false,
  });
  return { ...project, checklist };
}

// ---------------------------------------------------------------------------
// Treinamentos
// ---------------------------------------------------------------------------

export interface TrainingInput {
  projectId: string;
  subject: string;
  productId?: string;
  instructorId: string;
  scheduledAt: string;
  participants: string[];
  materialUrl?: string;
  evidence?: string;
  notes?: string;
  status: "agendado" | "realizado";
}

export async function scheduleTraining(input: TrainingInput, actor: ImplementationActor): Promise<Training> {
  const project = await loadProject(input.projectId);
  if (project.status === "cancelada") throw new Error("Projeto cancelado");
  const instructor = await activeUser(input.instructorId, "Instrutor");
  if (input.productId && !project.productIds.includes(input.productId)) throw new Error("O produto não faz parte deste projeto");
  const done = input.status === "realizado";
  const training = await create<Training>(COLLECTIONS.trainings, {
    clientId: project.clientId,
    projectId: project.id,
    productId: input.productId,
    subject: input.subject,
    instructorId: instructor.id,
    scheduledAt: input.scheduledAt,
    completedAt: done ? input.scheduledAt : undefined,
    participants: input.participants,
    materialUrl: input.materialUrl,
    evidence: input.evidence,
    notes: input.notes,
    status: input.status,
    createdBy: actor.id,
  });
  await ensureStarted(project, actor);
  if (done) {
    await emitTrainingCompleted(training, project, actor);
  } else {
    await emitEvent({
      type: "implementation.started",
      actor,
      clientId: project.clientId,
      entity: projectEntity(project.id),
      title: `Treinamento agendado: ${training.subject}`,
      description: `${formatDate(training.scheduledAt, "dd/MM/yyyy HH:mm")} com ${instructor.name}`,
      department: "implantacao",
      payload: { projectId: project.id, kind: "treinamento_agendado", trainingId: training.id, instructorId: instructor.id },
    });
    if (instructor.id !== actor.id) {
      await notify({
        userIds: [instructor.id],
        kind: "acao",
        title: `Treinamento agendado: ${training.subject}`,
        body: `${project.name} · ${formatDate(training.scheduledAt, "dd/MM/yyyy HH:mm")}`,
        href: `${projectHref(project.id)}?aba=treinamentos`,
        entity: projectEntity(project.id),
      });
    }
  }
  return training;
}

async function emitTrainingCompleted(training: Training, project: ProjectRecord, actor: UserRef): Promise<void> {
  await emitEvent({
    type: "implementation.training.completed",
    actor,
    clientId: training.clientId,
    entity: projectEntity(project.id),
    title: `Treinamento realizado: ${training.subject}`,
    description: [training.participants.length ? `Participantes: ${training.participants.join(", ")}` : "", training.evidence ? `Evidência: ${training.evidence}` : ""].filter(Boolean).join(" · ") || undefined,
    department: "implantacao",
    payload: { projectId: project.id, trainingId: training.id, instructorId: training.instructorId, productId: training.productId, participants: training.participants.length },
  });
}

export async function completeTraining(trainingId: string, evidence: string | undefined, notes: string | undefined, actor: ImplementationActor): Promise<Training> {
  const training = await getById<Training>(COLLECTIONS.trainings, trainingId);
  if (!training) throw new Error("Treinamento não encontrado");
  if (training.status === "realizado") throw new Error("Este treinamento já foi registrado como realizado");
  if (training.status === "cancelado") throw new Error("Treinamento cancelado");
  const completedAt = nowIso();
  await update<Training>(COLLECTIONS.trainings, training.id, { status: "realizado", completedAt, evidence: evidence ?? training.evidence, notes: notes ?? training.notes });
  const done: Training = { ...training, status: "realizado", completedAt, evidence: evidence ?? training.evidence, notes: notes ?? training.notes };
  const project = training.projectId ? await getById<ProjectRecord>(COLLECTIONS.implementationProjects, training.projectId) : null;
  if (project) await emitTrainingCompleted(done, project, actor);
  else {
    await emitEvent({
      type: "implementation.training.completed",
      actor,
      clientId: training.clientId,
      entity: { type: "training", id: training.id },
      title: `Treinamento realizado: ${training.subject}`,
      department: "implantacao",
      payload: { trainingId: training.id },
    });
  }
  return done;
}

export async function cancelTraining(trainingId: string, actor: ImplementationActor): Promise<Training> {
  const training = await getById<Training>(COLLECTIONS.trainings, trainingId);
  if (!training) throw new Error("Treinamento não encontrado");
  if (training.status !== "agendado") throw new Error("Só treinamentos agendados podem ser cancelados");
  await update<Training>(COLLECTIONS.trainings, training.id, { status: "cancelado" });
  await emitEvent({
    type: "implementation.started",
    actor,
    clientId: training.clientId,
    entity: training.projectId ? projectEntity(training.projectId) : { type: "training", id: training.id },
    title: `Treinamento cancelado: ${training.subject}`,
    department: "implantacao",
    payload: { projectId: training.projectId, kind: "treinamento_cancelado", trainingId: training.id },
  });
  return { ...training, status: "cancelado" };
}

// ---------------------------------------------------------------------------
// Pendência do cliente e bloqueio interno
// ---------------------------------------------------------------------------

export interface WaitingClientInput {
  projectId: string;
  reason: string;
  since?: string;
  responsibleId: string;
  evidence?: string;
}

/** AGUARDANDO CLIENTE: pausa o SLA do projeto e a etapa de workflow; o tempo parado vira atraso externo. */
export async function setProjectWaitingClient(input: WaitingClientInput, actor: ImplementationActor): Promise<ProjectRecord> {
  const project = await loadProject(input.projectId);
  assertActive(project);
  if (project.status === "aguardando_cliente") throw new Error("O projeto já está aguardando o cliente");
  if (project.status === "bloqueada") throw new Error("Resolva o bloqueio interno antes de registrar pendência do cliente");
  const responsible = await activeUser(input.responsibleId, "Responsável");
  const since = input.since && input.since < nowIso() ? input.since : nowIso();
  const waitingClient = { reason: input.reason, since, responsibleId: responsible.id, evidence: input.evidence };
  await update<ImplementationProject>(COLLECTIONS.implementationProjects, project.id, { status: "aguardando_cliente", waitingClient, startDate: project.startDate ?? nowIso() });
  if (project.slaInstanceId) await pauseSla(project.slaInstanceId, input.reason);

  const client = await loadClient(project.clientId);
  const current = await currentImplementationStep(client);
  if (current && current.step.status === "em_andamento") {
    try {
      await setStepWaitingClient(current.step.id, input.reason, actor);
    } catch (error) {
      console.error(`[implantacao] falha ao pausar a etapa ${current.step.id}`, error);
    }
  }
  const event = await emitEvent({
    type: "implementation.waiting_client",
    actor,
    clientId: project.clientId,
    entity: projectEntity(project.id),
    title: `Implantação aguardando o cliente: ${project.name}`,
    description: `${input.reason}${input.evidence ? ` · Evidência: ${input.evidence}` : ""} · Responsável: ${responsible.name}`,
    department: "implantacao",
    payload: { projectId: project.id, reason: input.reason, since, responsibleId: responsible.id, evidence: input.evidence, slaInstanceId: project.slaInstanceId },
  });
  await notify({
    userIds: [responsible.id, project.ownerId].filter((id) => id !== actor.id),
    kind: "atencao",
    title: `Pendência do cliente: ${client.tradeName}`,
    body: input.reason,
    href: `${projectHref(project.id)}?aba=pendencias`,
    entity: projectEntity(project.id),
    eventId: event.id,
  });
  return { ...project, status: "aguardando_cliente", waitingClient };
}

/** Retoma um projeto aguardando o cliente: retoma SLA e etapa, soma o atraso externo e desloca o prazo. */
export async function resumeProject(projectId: string, actor: ImplementationActor): Promise<ProjectRecord> {
  const project = await loadProject(projectId);
  if (project.status !== "aguardando_cliente" || !project.waitingClient) throw new Error("O projeto não está aguardando o cliente");
  const since = project.waitingClient.since;
  const days = await businessDaysSince(since);
  const pausedMs = Math.max(0, Date.now() - new Date(since).getTime());
  const externalDelayDays = Math.round(((project.externalDelayDays ?? 0) + days) * 10) / 10;
  const dueDate = new Date(new Date(project.dueDate).getTime() + pausedMs).toISOString();
  await update<ImplementationProject>(COLLECTIONS.implementationProjects, project.id, { status: project.startDate ? "em_implantacao" : "aguardando_inicio", externalDelayDays, dueDate });
  await clearFields(COLLECTIONS.implementationProjects, project.id, ["waitingClient"]);
  if (project.slaInstanceId) await resumeSla(project.slaInstanceId);

  const client = await loadClient(project.clientId);
  const current = await currentImplementationStep(client);
  if (current && current.step.status === "aguardando_cliente") {
    try {
      await resumeStep(current.step.id, actor);
    } catch (error) {
      console.error(`[implantacao] falha ao retomar a etapa ${current.step.id}`, error);
    }
  }
  await emitEvent({
    type: "implementation.resumed",
    actor,
    clientId: project.clientId,
    entity: projectEntity(project.id),
    title: `Implantação retomada: ${project.name}`,
    description: `Pendência do cliente resolvida após ${days.toLocaleString("pt-BR")} dia(s) útil(eis): ${project.waitingClient.reason}. Novo prazo: ${formatDate(dueDate)}.`,
    department: "implantacao",
    payload: { projectId, kind: "externo", delayDays: days, externalDelayDays, dueDate },
  });
  return (await syncProjectProgress(projectId, actor)) ?? project;
}

/** Bloqueio interno (responsabilidade da Intercert): o SLA continua correndo e o tempo vira atraso interno. */
export async function blockProject(projectId: string, reason: string, actor: ImplementationActor): Promise<ProjectRecord> {
  const project = await loadProject(projectId);
  assertActive(project);
  if (project.status === "bloqueada") throw new Error("O projeto já está bloqueado");
  if (project.status === "aguardando_cliente") throw new Error("O projeto está aguardando o cliente; retome antes de bloquear");
  const blocked = { reason, since: nowIso(), byId: actor.id };
  await update<ProjectRecord>(COLLECTIONS.implementationProjects, project.id, { status: "bloqueada", blocked });
  await emitEvent({
    type: "workflow.stage.blocked",
    actor,
    clientId: project.clientId,
    entity: projectEntity(project.id),
    title: `Implantação bloqueada: ${project.name}`,
    description: reason,
    department: "implantacao",
    payload: { projectId, kind: "bloqueio_interno", reason },
  });
  const manager = await getDepartmentManager("implantacao");
  await notify({
    userIds: [project.ownerId, manager?.id ?? ""].filter((id) => id && id !== actor.id),
    kind: "atencao",
    title: `Implantação bloqueada: ${project.name}`,
    body: reason,
    href: `${projectHref(project.id)}?aba=pendencias`,
    entity: projectEntity(project.id),
  });
  return { ...project, status: "bloqueada", blocked };
}

export async function unblockProject(projectId: string, actor: ImplementationActor): Promise<ProjectRecord> {
  const project = await loadProject(projectId);
  if (project.status !== "bloqueada") throw new Error("O projeto não está bloqueado");
  const since = project.blocked?.since ?? project.updatedAt;
  const days = await businessDaysSince(since);
  const internalDelayDays = Math.round(((project.internalDelayDays ?? 0) + days) * 10) / 10;
  await update<ImplementationProject>(COLLECTIONS.implementationProjects, project.id, { status: project.startDate ? "em_implantacao" : "aguardando_inicio", internalDelayDays });
  await clearFields(COLLECTIONS.implementationProjects, project.id, ["blocked"]);
  await emitEvent({
    type: "implementation.resumed",
    actor,
    clientId: project.clientId,
    entity: projectEntity(project.id),
    title: `Bloqueio interno resolvido: ${project.name}`,
    description: `${project.blocked?.reason ?? "Bloqueio"} · ${days.toLocaleString("pt-BR")} dia(s) útil(eis) de atraso interno`,
    department: "implantacao",
    payload: { projectId, kind: "interno", delayDays: days, internalDelayDays },
  });
  return (await syncProjectProgress(projectId, actor)) ?? project;
}

// ---------------------------------------------------------------------------
// Documentos, validação e aceite
// ---------------------------------------------------------------------------

export async function addProjectDocument(input: { projectId: string; name: string; url: string; category?: string }, actor: ImplementationActor): Promise<Document> {
  const project = await loadProject(input.projectId);
  const doc = await create<Document>(COLLECTIONS.documents, {
    clientId: project.clientId,
    entityType: "project",
    entityId: project.id,
    name: input.name,
    url: input.url,
    version: 1,
    uploadedBy: actor.id,
    category: input.category ?? "implantacao",
    createdBy: actor.id,
  });
  await emitEvent({
    type: "document.added",
    actor,
    clientId: project.clientId,
    entity: projectEntity(project.id),
    title: `Documento anexado à implantação: ${input.name}`,
    department: "implantacao",
    payload: { projectId: project.id, documentId: doc.id, url: input.url, category: doc.category },
  });
  return doc;
}

export async function registerValidation(input: { projectId: string; validatedBy: string; validatedAt: string; notes?: string }, actor: ImplementationActor): Promise<ProjectRecord> {
  const project = await loadProject(input.projectId);
  assertActive(project);
  const validation = { validatedBy: input.validatedBy, validatedAt: input.validatedAt, notes: input.notes };
  await update<ProjectRecord>(COLLECTIONS.implementationProjects, project.id, { validation });
  await emitEvent({
    type: "implementation.started",
    actor,
    clientId: project.clientId,
    entity: projectEntity(project.id),
    title: `Validação interna registrada: ${input.validatedBy}`,
    description: `Em ${formatDate(input.validatedAt)}${input.notes ? ` · ${input.notes}` : ""}`,
    department: "implantacao",
    payload: { projectId: project.id, kind: "validacao", ...validation },
  });
  return { ...project, validation };
}

export async function registerAcceptance(input: { projectId: string; acceptedBy: string; acceptedAt: string; notes?: string }, actor: ImplementationActor): Promise<ProjectRecord> {
  const project = await loadProject(input.projectId);
  assertActive(project);
  const acceptance = { acceptedBy: input.acceptedBy, acceptedAt: input.acceptedAt, notes: input.notes };
  await update<ImplementationProject>(COLLECTIONS.implementationProjects, project.id, { acceptance });
  await emitEvent({
    type: "implementation.started",
    actor,
    clientId: project.clientId,
    entity: projectEntity(project.id),
    title: `Aceite do cliente registrado: ${input.acceptedBy}`,
    description: `Em ${formatDate(input.acceptedAt)}${input.notes ? ` · ${input.notes}` : ""}`,
    department: "implantacao",
    payload: { projectId: project.id, kind: "aceite", ...acceptance },
  });
  return { ...project, acceptance };
}

// ---------------------------------------------------------------------------
// Go-live e handoff para CS
// ---------------------------------------------------------------------------

export interface GoLiveResult {
  project: ProjectRecord;
  csAccountId: string;
  csOwner: UserRef;
  onboardingTaskId: string;
  healthScore: number;
  activatedProducts: number;
}

/** Usuário de CS com a menor carteira (contas de CS) entre os ativos do departamento. */
async function pickCsOwner(): Promise<User> {
  const [users, accounts, manager] = await Promise.all([
    list<User>(COLLECTIONS.users, { where: [["departmentId", "==", "cs"]] }),
    list<CsAccount>(COLLECTIONS.csAccounts),
    getDepartmentManager("cs"),
  ]);
  const candidates = users.filter((u) => u.active !== false);
  if (candidates.length === 0) {
    if (manager) return manager;
    throw new Error("Nenhum usuário de Customer Success ativo para receber o handoff");
  }
  const load = new Map<string, number>();
  for (const a of accounts) load.set(a.ownerId, (load.get(a.ownerId) ?? 0) + 1);
  candidates.sort((a, b) => (load.get(a.id) ?? 0) - (load.get(b.id) ?? 0) || a.name.localeCompare(b.name, "pt-BR"));
  return candidates[0];
}

/**
 * Aprova o go-live. Exige o gate completo (checklist obrigatório, tarefas obrigatórias, treinamento
 * realizado, validação e aceite do cliente) e a permissão da configuração "go_live". Efeitos:
 * projeto concluído (progresso 100, SLA encerrado), produtos do cliente ativos (MRR recalculado),
 * cliente ativo em CS, handoff para CS (conta, health score inicial, tarefa de onboarding e avisos)
 * e implementation.go_live (o handler do workflow conclui a etapa Implantação e abre a de CS).
 */
export async function approveGoLive(projectId: string, actor: ImplementationActor): Promise<GoLiveResult> {
  const project = await loadProject(projectId);
  const [tasks, trainings, settings, client] = await Promise.all([projectTasks(projectId), projectTrainings(projectId), getGoLiveSettings(), loadClient(project.clientId)]);
  if (!canApproveGoLive(project, actor, settings)) {
    throw new Error(settings.exigeAprovacaoGestor ? "Só gestores ou administradores podem aprovar o go-live" : "Só o responsável do projeto ou gestores podem aprovar o go-live");
  }
  const gate = evaluateGoLiveGate(project, tasks, trainings);
  if (!gate.ok) throw new Error(`Gate de go-live não atendido: ${gate.missing.join("; ")}`);

  const goLiveAt = nowIso();
  // 1) Projeto concluído; tarefas da fase Go-live (acompanhamento, aceite, handoff) fecham com a aprovação.
  await update<ImplementationProject>(COLLECTIONS.implementationProjects, project.id, { status: "concluida", goLiveAt, completedAt: goLiveAt, progress: 100, currentPhase: "go_live" });
  const openGoLiveTasks = tasks.filter((t) => t.phase === "go_live" && OPEN_TASK.has(t.status));
  for (const t of openGoLiveTasks) {
    await update<ImplementationTask>(COLLECTIONS.implementationTasks, t.id, { status: "concluida", completedAt: goLiveAt, evidence: t.evidence ?? `Concluída na aprovação do go-live por ${actor.name}` });
  }
  if (project.slaInstanceId) {
    const sla = await completeSla(project.slaInstanceId);
    if (sla) {
      await emitEvent({
        type: "sla.completed",
        actor,
        clientId: project.clientId,
        entity: projectEntity(project.id),
        title: `SLA do projeto de implantação encerrado ${goLiveAt > sla.dueAt ? "com atraso" : "no prazo"}`,
        department: "implantacao",
        payload: { slaInstanceId: sla.id, ownerId: sla.ownerId, breached: goLiveAt > sla.dueAt, dueAt: sla.dueAt, completedAt: goLiveAt },
        timeline: false,
      });
    }
  }

  // 2) Produtos em implantação do cliente passam a ativos; MRR = soma das mensalidades ativas.
  const clientProducts = await list<ClientProduct>(COLLECTIONS.clientProducts, { where: [["clientId", "==", client.id]] });
  const toActivate = clientProducts.filter((p) => p.status === "em_implantacao" && ((project.contractId && p.contractId === project.contractId) || project.productIds.includes(p.productId)));
  for (const p of toActivate) await update<ClientProduct>(COLLECTIONS.clientProducts, p.id, { status: "ativo", startedAt: goLiveAt });
  const activatedIds = new Set(toActivate.map((p) => p.id));
  const mrr = Math.round(clientProducts.filter((p) => p.status === "ativo" || activatedIds.has(p.id)).reduce((s, p) => s + (p.monthlyValue || 0), 0) * 100) / 100;

  // 3) Handoff para CS: conta, health score inicial e tarefa de onboarding.
  const trainingsDone = trainings.filter((t) => t.status === "realizado");
  const [existingAccounts, contract] = await Promise.all([
    list<CsAccount>(COLLECTIONS.csAccounts, { where: [["clientId", "==", client.id]] }),
    project.contractId ? getById<Contract>(COLLECTIONS.contracts, project.contractId) : Promise.resolve(null),
  ]);
  const existingAccount = existingAccounts[0];
  const csOwner = existingAccount ? ((await getById<User>(COLLECTIONS.users, existingAccount.ownerId)) ?? (await pickCsOwner())) : await pickCsOwner();
  const products = await getManyByIds<{ id: string; organizationId: string; createdAt: string; updatedAt: string; name: string }>(COLLECTIONS.products, project.productIds);
  const productNames = project.productIds.map((id) => products.get(id)?.name ?? id);
  const optionalPending = project.checklist.filter((c) => !c.done).map((c) => c.label);
  const optionalTasks = tasks.filter((t) => !t.required && OPEN_TASK.has(t.status) && t.phase !== "go_live").map((t) => t.title);
  const notes = [
    `Handoff da implantação (${formatDate(goLiveAt)}).`,
    `Produtos: ${productNames.join(", ")}.`,
    `Treinamentos: ${trainingsDone.length ? trainingsDone.map((t) => `${t.subject} (${formatDate(t.completedAt ?? t.scheduledAt)})`).join("; ") : "nenhum"}.`,
    `Aceite: ${project.acceptance?.acceptedBy} em ${formatDate(project.acceptance?.acceptedAt)}${project.acceptance?.notes ? ` — ${project.acceptance.notes}` : ""}.`,
    `Pendências: ${[...optionalPending, ...optionalTasks].join("; ") || "nenhuma"}.`,
    `Atraso: ${project.externalDelayDays ?? 0} dia(s) do cliente, ${project.internalDelayDays ?? 0} interno(s).`,
  ].join("\n");
  const nextInteractionAt = new Date(Date.now() + 7 * 86_400_000).toISOString();
  // Caminho único da conta de CS: `ensureCsAccount` do CS (idempotente, ID `csacc_<clientId>`). O dono
  // escolhido aqui (menor carteira) é gravado no cliente antes, para que a conta nasça com ele.
  const cs = await import("@/server/cs/service");
  if (!existingAccount && client.ownerCsId !== csOwner.id) {
    await update<Client>(COLLECTIONS.clients, client.id, { ownerCsId: csOwner.id });
  }
  const account = await cs.ensureCsAccount(client.id, actor);
  const csAccountId = account.id;
  const manualReasons = account.riskReasons.filter((r) => r !== "Recém-implantado");
  await update<CsAccount>(COLLECTIONS.csAccounts, account.id, {
    nextInteractionAt,
    notes: [account.notes, notes].filter(Boolean).join("\n\n"),
    renewalDate: account.renewalDate ?? contract?.endDate,
    riskReasons: existingAccount ? account.riskReasons : ["Recém-implantado", ...manualReasons],
  });

  // 4) Cliente ativo em CS (a ativação formal "cliente ativado" é o gate do CS).
  const clientPatch: Partial<Client> = { currentStage: "cs", ownerCsId: csOwner.id, mrr, nextInteractionAt };
  if (client.status !== "ativo") {
    clientPatch.status = "ativo";
    clientPatch.activatedAt = goLiveAt;
  }
  await update<Client>(COLLECTIONS.clients, client.id, clientPatch);
  if (clientPatch.status) {
    await emitEvent({
      type: "client.status_changed",
      actor,
      clientId: client.id,
      entity: { type: "client", id: client.id },
      title: `Status do cliente: ${client.status} → ativo`,
      description: `Go-live da implantação aprovado por ${actor.name}`,
      department: "implantacao",
      payload: { from: client.status, to: "ativo", projectId: project.id },
    });
  }

  const holidays = await getHolidays();
  const onboarding = await createTaskInternal(
    {
      title: `Onboarding pós-go-live: ${client.tradeName}`,
      description: notes,
      clientId: client.id,
      assigneeId: csOwner.id,
      departmentId: "cs",
      priority: "alta",
      dueAt: addBusinessHours(new Date(goLiveAt), businessDaysToHours(3), holidays).toISOString(),
      processType: "cs",
      processId: csAccountId,
      origin: "evento",
      checklist: ["Contato de boas-vindas", "Apresentar o CS responsável", "Revisar pendências da implantação", "Agendar checkpoint de 7 dias"],
      tags: ["cs", "onboarding", "handoff"],
    },
    actor,
  );

  // 5) Jornada: marca no gate da etapa Implantação o que o projeto comprova e emite o go-live
  //    (o handler do workflow conclui a etapa e abre a de CS).
  const current = await currentImplementationStep(client);
  if (current) {
    const proven = new Set(["kickoff", "configuracao", "treinamento", "aceite", "handoff"]);
    const updates = (current.step.checklist ?? []).filter((c) => proven.has(c.id) && !c.done).map((c) => ({ id: c.id, done: true }));
    if (updates.length > 0) {
      try {
        await updateStepChecklist(current.step.id, updates, actor);
      } catch (error) {
        console.error(`[implantacao] falha ao marcar o checklist da etapa ${current.step.id}`, error);
      }
    }
    if (current.instance.context.projectId !== project.id) {
      await update<WorkflowInstance>(COLLECTIONS.workflowInstances, current.instance.id, { context: { ...current.instance.context, projectId: project.id } });
    }
  }
  const trainingText = trainingsDone.map((t) => t.subject).join(", ");
  const event = await emitEvent({
    type: "implementation.go_live",
    actor,
    clientId: client.id,
    entity: projectEntity(project.id),
    title: `Go-live aprovado: ${client.tradeName}`,
    description: `Produtos ativos: ${toActivate.map((p) => p.productName).join(", ") || productNames.join(", ")} · Treinamentos: ${trainingText || "—"} · Aceite: ${project.acceptance?.acceptedBy} · Handoff para CS: ${csOwner.name}`,
    department: "implantacao",
    payload: {
      projectId: project.id,
      contractId: project.contractId,
      goLiveAt,
      startDate: project.startDate,
      dueDate: project.dueDate,
      onTime: goLiveAt <= project.dueDate,
      csOwnerId: csOwner.id,
      csAccountId,
      onboardingTaskId: onboarding.id,
      activatedProductIds: toActivate.map((p) => p.productId),
      mrr,
      externalDelayDays: project.externalDelayDays ?? 0,
      internalDelayDays: project.internalDelayDays ?? 0,
    },
  });

  // A etapa de CS aberta pelo workflow fica com o mesmo responsável da conta de CS.
  const instance = client.workflowInstanceId ? await getById<WorkflowInstance>(COLLECTIONS.workflowInstances, client.workflowInstanceId) : null;
  if (instance?.status === "ativo" && instance.currentStageKey === "cs" && instance.currentStepId) {
    const csStep = await getById<WorkflowStep>(COLLECTIONS.workflowSteps, instance.currentStepId);
    if (csStep && csStep.assigneeId !== csOwner.id) {
      try {
        await reassignStep(csStep.id, csOwner.id, actor);
      } catch (error) {
        console.error(`[implantacao] falha ao reatribuir a etapa de CS ${csStep.id}`, error);
      }
    }
  }

  // Health score inicial pelo motor único do CS (histórico em health_scores; emite customer.health_changed
  // quando o nível muda).
  const health = await cs.recalculateClientHealth(client.id, actor);

  const [csManager, implManager] = await Promise.all([getDepartmentManager("cs"), getDepartmentManager("implantacao")]);
  await notify({
    userIds: [csOwner.id].filter((id) => id !== actor.id),
    kind: "acao",
    title: `Novo cliente na sua carteira: ${client.tradeName}`,
    body: `Go-live aprovado em ${formatDate(goLiveAt)}. Faça o onboarding em até 3 dias úteis.`,
    href: `/clientes/${client.id}?aba=cs`,
    entity: { type: "client", id: client.id },
    eventId: event.id,
  });
  await notify({
    userIds: [csManager?.id ?? "", implManager?.id ?? "", project.ownerId].filter((id) => id && id !== actor.id && id !== csOwner.id),
    kind: "informativa",
    title: `Go-live: ${client.tradeName}`,
    body: `Handoff para ${csOwner.name}. Produtos: ${productNames.join(", ")}.`,
    href: projectHref(project.id),
    entity: projectEntity(project.id),
    eventId: event.id,
  });

  return {
    project: { ...project, status: "concluida", goLiveAt, completedAt: goLiveAt, progress: 100, currentPhase: "go_live" },
    csAccountId,
    csOwner: ref(csOwner),
    onboardingTaskId: onboarding.id,
    healthScore: health?.score ?? 0,
    activatedProducts: toActivate.length,
  };
}
