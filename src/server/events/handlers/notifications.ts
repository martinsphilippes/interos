import type { registerHandler as RegisterFn } from "../emit";
import { notify } from "../../notifications";
import { getById } from "../../db";
import { COLLECTIONS, type Task } from "@/domain/types";

/**
 * Notificações derivadas de eventos genéricos. Handlers de módulos específicos
 * (workflow, leads, chamados...) registram suas próprias notificações.
 */
export function registerNotificationHandlers(registerHandler: typeof RegisterFn): void {
  registerHandler("task.assigned", async (event) => {
    const assigneeId = String(event.payload.assigneeId ?? "");
    if (!assigneeId || assigneeId === event.actorId) return;
    await notify({
      userIds: [assigneeId],
      kind: "acao",
      title: "Nova tarefa atribuída a você",
      body: event.title,
      href: event.entityId ? `/tarefas?tarefa=${event.entityId}` : "/tarefas",
      entity: event.entityId ? { type: "task", id: event.entityId } : undefined,
      eventId: event.id,
    });
  });

  registerHandler("comment.added", async (event) => {
    const entityType = String(event.payload.entityType ?? "");
    const entityId = String(event.payload.entityId ?? "");
    if (entityType !== "task" || !entityId) return;
    const task = await getById<Task>(COLLECTIONS.tasks, entityId);
    const targets = [task?.assigneeId, task?.creatorId].filter((id): id is string => Boolean(id) && id !== event.actorId);
    if (targets.length === 0) return;
    await notify({
      userIds: targets,
      kind: "informativa",
      title: `Novo comentário em "${task?.title ?? "tarefa"}"`,
      body: event.description,
      href: `/tarefas?tarefa=${entityId}`,
      entity: { type: "task", id: entityId },
      eventId: event.id,
    });
  });

  registerHandler("sla.at_risk", async (event) => {
    const ownerId = String(event.payload.ownerId ?? "");
    if (!ownerId) return;
    await notify({ userIds: [ownerId], kind: "atencao", title: "SLA em risco", body: event.title, href: event.payload.href as string | undefined, eventId: event.id });
  });

  registerHandler("sla.breached", async (event) => {
    const ownerId = String(event.payload.ownerId ?? "");
    if (!ownerId) return;
    await notify({ userIds: [ownerId], kind: "critica", title: "SLA violado", body: event.title, href: event.payload.href as string | undefined, eventId: event.id });
  });
}
