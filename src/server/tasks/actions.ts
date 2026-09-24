"use server";
/**
 * Server Actions da Central de Tarefas. Padrão: requireUser() → validação zod → serviço → revalidação.
 * Todas devolvem ActionResult com mensagem em português.
 */
import { revalidatePath } from "next/cache";
import { z } from "zod";
import { requireUser } from "@/server/auth/session";
import { getById, getManyByIds, nowIso, remove, update } from "@/server/db";
import { emitEvent } from "@/server/events";
import { COLLECTIONS, type ActionResult, type ChecklistItem, type Client, type CurrentUser, type Task, type UserRef } from "@/domain/types";
import { shortId } from "@/lib/utils";
import {
  addChecklistItemSchema,
  addCommentSchema,
  assignTaskSchema,
  cancelTaskSchema,
  changeTaskStatusSchema,
  checklistItemSchema,
  createTaskSchema,
  reorderTaskSchema,
  taskIdSchema,
  updateTaskSchema,
} from "./schemas";
import {
  addTaskCommentInternal,
  assignTaskInternal,
  cancelTaskInternal,
  clearTaskFields,
  completeTaskInternal,
  createTaskInternal,
  reopenTaskInternal,
  reorderTasksInternal,
  setTaskStatusInternal,
} from "./service";

type Failure = { ok: false; error: string };

function fail(error: unknown): Failure {
  if (error instanceof z.ZodError) return { ok: false, error: error.issues.map((i) => i.message).join(" · ") };
  if (error instanceof Error && error.message) {
    console.error("[tasks]", error);
    return { ok: false, error: error.message };
  }
  console.error("[tasks]", error);
  return { ok: false, error: "Não foi possível concluir a operação. Tente novamente." };
}

function actorOf(user: CurrentUser): UserRef {
  return { id: user.id, name: user.name };
}

function revalidateTaskPaths(...tasks: (Pick<Task, "clientId" | "processType"> | null | undefined)[]): void {
  revalidatePath("/tarefas");
  revalidatePath("/meu-dia");
  for (const t of tasks) {
    if (!t) continue;
    if (t.clientId) revalidatePath(`/clientes/${t.clientId}`);
    if (t.processType === "workflow") revalidatePath("/workflow");
  }
}

async function loadTask(id: string): Promise<Task> {
  const task = await getById<Task>(COLLECTIONS.tasks, id);
  if (!task) throw new Error("Tarefa não encontrada");
  return task;
}

// ---------------------------------------------------------------------------

export async function createTask(input: unknown): Promise<ActionResult<{ id: string }>> {
  const user = await requireUser();
  try {
    const data = createTaskSchema.parse(input);
    const task = await createTaskInternal(
      {
        ...data,
        assigneeId: data.assigneeId || user.id,
        clientId: data.clientId || undefined,
        description: data.description || undefined,
        origin: "manual",
      },
      actorOf(user),
    );
    revalidateTaskPaths(task);
    return { ok: true, data: { id: task.id } };
  } catch (error) {
    return fail(error);
  }
}

export async function updateTask(input: unknown): Promise<ActionResult<{ id: string }>> {
  const user = await requireUser();
  try {
    const { id, ...patch } = updateTaskSchema.parse(input);
    const task = await loadTask(id);
    const actor = actorOf(user);

    const set: Partial<Task> = {};
    const clear: (keyof Task)[] = [];
    const changed: string[] = [];

    if (patch.title !== undefined && patch.title !== task.title) {
      set.title = patch.title;
      changed.push("título");
    }
    if (patch.description !== undefined && (patch.description ?? undefined) !== task.description) {
      if (patch.description) set.description = patch.description;
      else clear.push("description");
      changed.push("descrição");
    }
    if (patch.priority !== undefined && patch.priority !== task.priority) {
      set.priority = patch.priority;
      changed.push("prioridade");
    }
    if (patch.departmentId !== undefined && patch.departmentId !== task.departmentId) {
      set.departmentId = patch.departmentId;
      changed.push("departamento");
    }
    if (patch.dueAt !== undefined && (patch.dueAt ?? undefined) !== task.dueAt) {
      if (patch.dueAt) set.dueAt = patch.dueAt;
      else clear.push("dueAt");
      changed.push("prazo");
    }
    if (patch.startAt !== undefined && (patch.startAt ?? undefined) !== task.startAt) {
      if (patch.startAt) set.startAt = patch.startAt;
      else clear.push("startAt");
      changed.push("início");
    }
    if (patch.tags !== undefined && patch.tags.join("|") !== task.tags.join("|")) {
      set.tags = patch.tags;
      changed.push("tags");
    }
    if (patch.recurrence !== undefined && JSON.stringify(patch.recurrence ?? null) !== JSON.stringify(task.recurrence ?? null)) {
      if (patch.recurrence) set.recurrence = patch.recurrence;
      else clear.push("recurrence");
      changed.push("recorrência");
    }
    if (patch.clientId !== undefined && (patch.clientId || undefined) !== task.clientId) {
      if (patch.clientId) {
        const client = await getById<Client>(COLLECTIONS.clients, patch.clientId);
        if (!client) throw new Error("Cliente não encontrado");
        set.clientId = client.id;
        set.clientName = client.tradeName;
      } else {
        clear.push("clientId", "clientName");
      }
      changed.push("cliente");
    }

    if (Object.keys(set).length > 0) await update<Task>(COLLECTIONS.tasks, id, set);
    if (clear.length > 0) await clearTaskFields(id, clear);

    // Responsável passa pelo fluxo de atribuição (evento + notificação).
    let current: Task = { ...task, ...set };
    if (patch.assigneeId !== undefined && (patch.assigneeId || undefined) !== task.assigneeId) {
      if (patch.assigneeId) {
        current = await assignTaskInternal(current, patch.assigneeId, actor);
      } else {
        await clearTaskFields(id, ["assigneeId", "assigneeName"]);
        changed.push("responsável (removido)");
      }
    }

    if (changed.length > 0) {
      await emitEvent({
        type: "task.updated",
        actor,
        clientId: current.clientId ?? task.clientId,
        entity: { type: "task", id },
        title: `Tarefa atualizada por ${actor.name}: ${current.title}`,
        description: `Campos alterados: ${changed.join(", ")}`,
        department: current.departmentId,
        payload: { changed, patch: JSON.parse(JSON.stringify(patch)) as Record<string, unknown> },
      });
    }
    revalidateTaskPaths(task, current);
    return { ok: true, data: { id } };
  } catch (error) {
    return fail(error);
  }
}

export async function changeTaskStatus(input: unknown): Promise<ActionResult<{ id: string; nextTaskId?: string }>> {
  const user = await requireUser();
  try {
    const { id, status } = changeTaskStatusSchema.parse(input);
    const task = await loadTask(id);
    const result = await setTaskStatusInternal(task, status, actorOf(user));
    revalidateTaskPaths(task);
    return { ok: true, data: { id, nextTaskId: result.next?.id } };
  } catch (error) {
    return fail(error);
  }
}

export async function completeTask(input: unknown): Promise<ActionResult<{ id: string; nextTaskId?: string }>> {
  const user = await requireUser();
  try {
    const { id } = taskIdSchema.parse(input);
    const task = await loadTask(id);
    const result = await completeTaskInternal(task, actorOf(user));
    revalidateTaskPaths(task);
    return { ok: true, data: { id, nextTaskId: result.next?.id } };
  } catch (error) {
    return fail(error);
  }
}

export async function reopenTask(input: unknown): Promise<ActionResult<{ id: string }>> {
  const user = await requireUser();
  try {
    const { id } = taskIdSchema.parse(input);
    const task = await loadTask(id);
    if (task.status !== "concluida" && task.status !== "cancelada") throw new Error("Só é possível reabrir tarefas concluídas ou canceladas");
    await reopenTaskInternal(task, actorOf(user));
    revalidateTaskPaths(task);
    return { ok: true, data: { id } };
  } catch (error) {
    return fail(error);
  }
}

export async function cancelTask(input: unknown): Promise<ActionResult<{ id: string }>> {
  const user = await requireUser();
  try {
    const { id, reason } = cancelTaskSchema.parse(input);
    const task = await loadTask(id);
    if (task.status === "concluida") throw new Error("Tarefa concluída não pode ser cancelada; reabra antes");
    await cancelTaskInternal(task, actorOf(user), reason);
    revalidateTaskPaths(task);
    return { ok: true, data: { id } };
  } catch (error) {
    return fail(error);
  }
}

/** Exclusão definitiva: apenas criador, gestor, diretoria ou admin. */
export async function deleteTask(input: unknown): Promise<ActionResult<{ id: string }>> {
  const user = await requireUser();
  try {
    const { id } = taskIdSchema.parse(input);
    const task = await loadTask(id);
    if (!user.isManager && task.creatorId !== user.id) throw new Error("Você não tem permissão para excluir esta tarefa");
    await remove(COLLECTIONS.tasks, id);
    await emitEvent({
      type: "task.updated",
      actor: actorOf(user),
      clientId: task.clientId,
      entity: { type: "task", id },
      title: `Tarefa excluída por ${user.name}: ${task.title}`,
      department: task.departmentId,
      payload: { deleted: true, status: task.status, assigneeId: task.assigneeId },
    });
    revalidateTaskPaths(task);
    return { ok: true, data: { id } };
  } catch (error) {
    return fail(error);
  }
}

export async function assignTask(input: unknown): Promise<ActionResult<{ id: string }>> {
  const user = await requireUser();
  try {
    const { id, assigneeId } = assignTaskSchema.parse(input);
    const task = await loadTask(id);
    await assignTaskInternal(task, assigneeId, actorOf(user));
    revalidateTaskPaths(task);
    return { ok: true, data: { id } };
  } catch (error) {
    return fail(error);
  }
}

// ---------------------------------------------------------------------------
// Checklist
// ---------------------------------------------------------------------------

async function saveChecklist(task: Task, checklist: ChecklistItem[], actor: UserRef, description: string): Promise<void> {
  await update<Task>(COLLECTIONS.tasks, task.id, { checklist });
  const done = checklist.filter((c) => c.done).length;
  await emitEvent({
    type: "task.updated",
    actor,
    clientId: task.clientId,
    entity: { type: "task", id: task.id },
    title: `Checklist de "${task.title}": ${description}`,
    description: `${done}/${checklist.length} itens concluídos`,
    department: task.departmentId,
    payload: { checklist: true, done, total: checklist.length },
    timeline: false,
  });
}

export async function toggleChecklistItem(input: unknown): Promise<ActionResult<{ id: string; done: boolean }>> {
  const user = await requireUser();
  try {
    const { id, itemId } = checklistItemSchema.parse(input);
    const task = await loadTask(id);
    const item = task.checklist.find((c) => c.id === itemId);
    if (!item) throw new Error("Item do checklist não encontrado");
    const done = !item.done;
    const checklist = task.checklist.map((c) => (c.id === itemId ? { ...c, done, doneAt: done ? nowIso() : undefined, doneBy: done ? user.id : undefined } : c));
    await saveChecklist(task, checklist, actorOf(user), `${done ? "concluído" : "reaberto"} "${item.label}"`);
    revalidateTaskPaths(task);
    return { ok: true, data: { id, done } };
  } catch (error) {
    return fail(error);
  }
}

export async function addChecklistItem(input: unknown): Promise<ActionResult<{ id: string; itemId: string }>> {
  const user = await requireUser();
  try {
    const { id, label } = addChecklistItemSchema.parse(input);
    const task = await loadTask(id);
    if (task.checklist.length >= 50) throw new Error("Limite de 50 itens no checklist");
    const item: ChecklistItem = { id: shortId("chk"), label, done: false };
    await saveChecklist(task, [...task.checklist, item], actorOf(user), `item adicionado "${label}"`);
    revalidateTaskPaths(task);
    return { ok: true, data: { id, itemId: item.id } };
  } catch (error) {
    return fail(error);
  }
}

export async function removeChecklistItem(input: unknown): Promise<ActionResult<{ id: string }>> {
  const user = await requireUser();
  try {
    const { id, itemId } = checklistItemSchema.parse(input);
    const task = await loadTask(id);
    const item = task.checklist.find((c) => c.id === itemId);
    if (!item) throw new Error("Item do checklist não encontrado");
    await saveChecklist(
      task,
      task.checklist.filter((c) => c.id !== itemId),
      actorOf(user),
      `item removido "${item.label}"`,
    );
    revalidateTaskPaths(task);
    return { ok: true, data: { id } };
  } catch (error) {
    return fail(error);
  }
}

// ---------------------------------------------------------------------------
// Comentários e ordenação
// ---------------------------------------------------------------------------

export async function addComment(input: unknown): Promise<ActionResult<{ id: string }>> {
  const user = await requireUser();
  try {
    const { taskId, body } = addCommentSchema.parse(input);
    const task = await loadTask(taskId);
    const comment = await addTaskCommentInternal(task, body, actorOf(user));
    revalidateTaskPaths(task);
    return { ok: true, data: { id: comment.id } };
  } catch (error) {
    return fail(error);
  }
}

/** Reordena uma coluna do kanban. As tarefas informadas precisam existir; o status não é alterado aqui. */
export async function reorderTask(input: unknown): Promise<ActionResult<{ count: number }>> {
  await requireUser();
  try {
    const { orderedIds } = reorderTaskSchema.parse(input);
    const existing = await getManyByIds<Task>(COLLECTIONS.tasks, orderedIds);
    const ids = orderedIds.filter((id) => existing.has(id));
    await reorderTasksInternal(ids);
    revalidatePath("/tarefas");
    return { ok: true, data: { count: ids.length } };
  } catch (error) {
    return fail(error);
  }
}
