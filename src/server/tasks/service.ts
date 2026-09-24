import "server-only";
/**
 * Serviço de tarefas SEM validação de sessão. Usado pelas Server Actions (que validam sessão e
 * entrada) e por motores internos (workflow, automações) que criam/concluem tarefas em nome de um ator.
 *
 * Toda mutação emite evento; nenhuma regra de negócio fica em componentes.
 */
import { FieldValue } from "firebase-admin/firestore";
import { addDays, addMonths, addWeeks } from "date-fns";
import { batchSet, col, create, getById, nowIso, update } from "@/server/db";
import { emitEvent } from "@/server/events";
import { completeSla } from "@/server/sla";
import { COLLECTIONS, type ChecklistItem, type Client, type Comment, type Task, type User, type UserRef } from "@/domain/types";
import type { DepartmentKey, Priority, TaskStatus } from "@/domain/constants";
import { TASK_STATUS_LABELS } from "@/domain/constants";
import { shortId } from "@/lib/utils";

export interface CreateTaskInternalInput {
  title: string;
  description?: string;
  clientId?: string;
  assigneeId?: string;
  departmentId: DepartmentKey;
  priority?: Priority;
  dueAt?: string;
  startAt?: string;
  /** Rótulos (viram itens não concluídos) ou itens completos. */
  checklist?: (string | ChecklistItem)[];
  tags?: string[];
  recurrence?: Task["recurrence"];
  processType?: Task["processType"];
  processId?: string;
  origin?: Task["origin"];
  sourceEventId?: string;
  slaInstanceId?: string;
  /** Padrão: o ator. */
  creatorId?: string;
  status?: TaskStatus;
}

/** Cria uma tarefa em nome de `actor`, denormaliza nomes e emite task.created (+ task.assigned). */
export async function createTaskInternal(input: CreateTaskInternalInput, actor: UserRef): Promise<Task> {
  const [assignee, client] = await Promise.all([
    input.assigneeId ? getById<User>(COLLECTIONS.users, input.assigneeId) : null,
    input.clientId ? getById<Client>(COLLECTIONS.clients, input.clientId) : null,
  ]);
  if (input.assigneeId && !assignee) throw new Error("Responsável não encontrado");
  if (input.clientId && !client) throw new Error("Cliente não encontrado");

  const checklist: ChecklistItem[] = (input.checklist ?? []).map((item) =>
    typeof item === "string" ? { id: shortId("chk"), label: item, done: false } : { ...item, id: item.id || shortId("chk") },
  );
  const origin = input.origin ?? "manual";

  const task = await create<Task>(COLLECTIONS.tasks, {
    title: input.title,
    description: input.description,
    clientId: client?.id,
    clientName: client?.tradeName,
    processType: input.processType,
    processId: input.processId,
    departmentId: input.departmentId,
    assigneeId: assignee?.id,
    assigneeName: assignee?.name,
    creatorId: input.creatorId ?? actor.id,
    createdBy: actor.id,
    priority: input.priority ?? "media",
    dueAt: input.dueAt,
    startAt: input.startAt,
    status: input.status ?? "aberta",
    checklist,
    tags: input.tags ?? [],
    recurrence: input.recurrence,
    origin,
    sourceEventId: input.sourceEventId,
    slaInstanceId: input.slaInstanceId,
    // Novas tarefas entram no fim da coluna do kanban.
    order: Date.now(),
  });

  await emitEvent({
    type: "task.created",
    actor,
    clientId: task.clientId,
    entity: { type: "task", id: task.id },
    title: `Tarefa criada: ${task.title}`,
    description: task.assigneeName ? `Responsável: ${task.assigneeName}` : undefined,
    department: task.departmentId,
    payload: {
      origin,
      assigneeId: task.assigneeId,
      priority: task.priority,
      dueAt: task.dueAt,
      processType: task.processType,
      processId: task.processId,
      recurring: Boolean(task.recurrence),
    },
  });

  if (task.assigneeId && task.assigneeId !== actor.id) {
    await emitEvent({
      type: "task.assigned",
      actor,
      clientId: task.clientId,
      entity: { type: "task", id: task.id },
      title: `${task.title}${task.clientName ? ` — ${task.clientName}` : ""}`,
      department: task.departmentId,
      payload: { assigneeId: task.assigneeId, assigneeName: task.assigneeName },
      timeline: false,
    });
  }

  return task;
}

/** Remove campos do documento (o `update` de db.ts ignora `undefined`). */
export async function clearTaskFields(id: string, fields: (keyof Task)[]): Promise<void> {
  if (fields.length === 0) return;
  const patch: Record<string, unknown> = { updatedAt: nowIso() };
  for (const f of fields) patch[f] = FieldValue.delete();
  await col(COLLECTIONS.tasks).doc(id).update(patch);
}

/** Próximo prazo de uma tarefa recorrente a partir de uma data base. */
export function nextOccurrenceDueAt(baseIso: string, recurrence: NonNullable<Task["recurrence"]>): string {
  const base = new Date(baseIso);
  const next =
    recurrence.freq === "diaria" ? addDays(base, recurrence.interval) : recurrence.freq === "semanal" ? addWeeks(base, recurrence.interval) : addMonths(base, recurrence.interval);
  return next.toISOString();
}

/**
 * Cria a próxima ocorrência de uma tarefa recorrente (prazo = prazo anterior + intervalo; sem prazo
 * anterior usa a conclusão como base). Respeita `recurrence.until`. Devolve null quando não há próxima.
 */
export async function spawnNextOccurrence(task: Task, actor: UserRef): Promise<Task | null> {
  if (!task.recurrence) return null;
  const base = task.dueAt ?? task.completedAt ?? nowIso();
  const dueAt = nextOccurrenceDueAt(base, task.recurrence);
  if (task.recurrence.until && dueAt > task.recurrence.until) return null;
  return createTaskInternal(
    {
      title: task.title,
      description: task.description,
      clientId: task.clientId,
      assigneeId: task.assigneeId,
      departmentId: task.departmentId,
      priority: task.priority,
      dueAt,
      checklist: task.checklist.map((c) => ({ id: shortId("chk"), label: c.label, done: false, required: c.required })),
      tags: task.tags,
      recurrence: task.recurrence,
      processType: task.processType,
      processId: task.processId,
      origin: "automacao",
      creatorId: task.creatorId,
    },
    actor,
  );
}

export interface CompleteTaskResult {
  task: Task;
  next: Task | null;
}

/** Conclui a tarefa: completedAt/By, encerra o SLA, emite task.completed e gera a próxima recorrência. */
export async function completeTaskInternal(task: Task, actor: UserRef): Promise<CompleteTaskResult> {
  if (task.status === "concluida") return { task, next: null };
  const completedAt = nowIso();
  await update<Task>(COLLECTIONS.tasks, task.id, { status: "concluida", completedAt, completedBy: actor.id });
  const completed: Task = { ...task, status: "concluida", completedAt, completedBy: actor.id };

  if (task.slaInstanceId) {
    const sla = await completeSla(task.slaInstanceId);
    if (sla) {
      await emitEvent({
        type: "sla.completed",
        actor,
        clientId: task.clientId,
        entity: { type: "sla_instance", id: sla.id },
        title: `SLA da tarefa "${task.title}" encerrado${completedAt > sla.dueAt ? " com atraso" : " no prazo"}`,
        department: task.departmentId,
        payload: { taskId: task.id, ownerId: sla.ownerId, breached: completedAt > sla.dueAt, dueAt: sla.dueAt, completedAt },
        timeline: false,
      });
    }
  }

  await emitEvent({
    type: "task.completed",
    actor,
    clientId: task.clientId,
    entity: { type: "task", id: task.id },
    title: `Tarefa concluída por ${actor.name}: ${task.title}`,
    department: task.departmentId,
    payload: {
      assigneeId: task.assigneeId,
      completedBy: actor.id,
      dueAt: task.dueAt,
      late: Boolean(task.dueAt && completedAt > task.dueAt),
      processType: task.processType,
      processId: task.processId,
    },
  });

  const next = await spawnNextOccurrence(completed, actor);
  return { task: completed, next };
}

/** Reabre uma tarefa concluída ou cancelada. */
export async function reopenTaskInternal(task: Task, actor: UserRef): Promise<Task> {
  if (task.status !== "concluida" && task.status !== "cancelada") return task;
  await update<Task>(COLLECTIONS.tasks, task.id, { status: "aberta" });
  await clearTaskFields(task.id, ["completedAt", "completedBy"]);
  await emitEvent({
    type: "task.status_changed",
    actor,
    clientId: task.clientId,
    entity: { type: "task", id: task.id },
    title: `Tarefa reaberta por ${actor.name}: ${task.title}`,
    department: task.departmentId,
    payload: { from: task.status, to: "aberta", assigneeId: task.assigneeId },
  });
  return { ...task, status: "aberta", completedAt: undefined, completedBy: undefined };
}

/** Cancela a tarefa (encerra o SLA, se houver). */
export async function cancelTaskInternal(task: Task, actor: UserRef, reason?: string): Promise<Task> {
  if (task.status === "cancelada") return task;
  await update<Task>(COLLECTIONS.tasks, task.id, { status: "cancelada" });
  if (task.slaInstanceId) await completeSla(task.slaInstanceId);
  await emitEvent({
    type: "task.status_changed",
    actor,
    clientId: task.clientId,
    entity: { type: "task", id: task.id },
    title: `Tarefa cancelada por ${actor.name}: ${task.title}`,
    description: reason,
    department: task.departmentId,
    payload: { from: task.status, to: "cancelada", reason, assigneeId: task.assigneeId },
  });
  return { ...task, status: "cancelada" };
}

/** Muda o status aplicando as regras de conclusão/reabertura/cancelamento quando cabível. */
export async function setTaskStatusInternal(task: Task, status: TaskStatus, actor: UserRef): Promise<CompleteTaskResult> {
  if (task.status === status) return { task, next: null };
  if (status === "concluida") return completeTaskInternal(task, actor);
  if (status === "cancelada") return { task: await cancelTaskInternal(task, actor), next: null };

  let current = task;
  if (task.status === "concluida" || task.status === "cancelada") current = await reopenTaskInternal(task, actor);
  if (current.status === status) return { task: current, next: null };

  const patch: Partial<Task> = { status };
  if (status === "em_andamento" && !current.startAt) patch.startAt = nowIso();
  await update<Task>(COLLECTIONS.tasks, task.id, patch);
  await emitEvent({
    type: "task.status_changed",
    actor,
    clientId: task.clientId,
    entity: { type: "task", id: task.id },
    title: `${task.title}: ${TASK_STATUS_LABELS[current.status]} → ${TASK_STATUS_LABELS[status]}`,
    department: task.departmentId,
    payload: { from: current.status, to: status, assigneeId: task.assigneeId },
  });
  return { task: { ...current, ...patch }, next: null };
}

/** Atribui responsável e emite task.assigned (o handler de notificações avisa o novo responsável). */
export async function assignTaskInternal(task: Task, assigneeId: string, actor: UserRef): Promise<Task> {
  const assignee = await getById<User>(COLLECTIONS.users, assigneeId);
  if (!assignee || assignee.active === false) throw new Error("Responsável não encontrado ou inativo");
  if (task.assigneeId === assignee.id) return task;
  await update<Task>(COLLECTIONS.tasks, task.id, { assigneeId: assignee.id, assigneeName: assignee.name });
  await emitEvent({
    type: "task.assigned",
    actor,
    clientId: task.clientId,
    entity: { type: "task", id: task.id },
    title: `${task.title}${task.clientName ? ` — ${task.clientName}` : ""}`,
    description: `Atribuída a ${assignee.name} por ${actor.name}`,
    department: task.departmentId,
    payload: { assigneeId: assignee.id, assigneeName: assignee.name, previousAssigneeId: task.assigneeId },
  });
  return { ...task, assigneeId: assignee.id, assigneeName: assignee.name };
}

/** Grava um comentário na tarefa e emite comment.added (notifica responsável e criador). */
export async function addTaskCommentInternal(task: Task, body: string, actor: UserRef): Promise<Comment> {
  const comment = await create<Comment>(COLLECTIONS.comments, {
    entityType: "task",
    entityId: task.id,
    clientId: task.clientId,
    authorId: actor.id,
    authorName: actor.name,
    body,
    createdBy: actor.id,
  });
  await emitEvent({
    type: "comment.added",
    actor,
    clientId: task.clientId,
    entity: { type: "task", id: task.id },
    title: `Comentário de ${actor.name} em "${task.title}"`,
    description: body.length > 280 ? `${body.slice(0, 277)}…` : body,
    department: task.departmentId,
    payload: { entityType: "task", entityId: task.id, commentId: comment.id },
  });
  return comment;
}

/** Reordena as tarefas de uma coluna do kanban (grava `order` sequencial). */
export async function reorderTasksInternal(orderedIds: string[]): Promise<void> {
  const now = nowIso();
  await batchSet(orderedIds.map((id, index) => ({ collection: COLLECTIONS.tasks, id, data: { order: index + 1, updatedAt: now }, merge: true })));
}
