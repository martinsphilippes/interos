"use server";
/**
 * Server Actions do Meu Dia. Conclusão rápida de tarefa direto da lista de prioridades:
 * faz o mínimo (status, completedAt/By, encerra SLA, emite task.completed) sem depender do
 * módulo de tarefas, que é construído em paralelo.
 */
import { revalidatePath } from "next/cache";
import { z } from "zod";
import { requireUser } from "@/server/auth/session";
import { getById, nowIso, update } from "@/server/db";
import { emitEvent } from "@/server/events";
import { completeSla } from "@/server/sla";
import { COLLECTIONS, type ActionResult, type Task } from "@/domain/types";

const taskIdSchema = z.string({ message: "Identificador da tarefa inválido" }).trim().min(1, "Identificador da tarefa obrigatório");

function fail(error: unknown): { ok: false; error: string } {
  if (error instanceof z.ZodError) return { ok: false, error: error.issues.map((i) => i.message).join(" · ") };
  console.error("[meu-dia]", error);
  return { ok: false, error: error instanceof Error && error.message ? error.message : "Não foi possível concluir a operação. Tente novamente." };
}

export async function completeTaskQuick(taskId: unknown): Promise<ActionResult<{ id: string }>> {
  const user = await requireUser();
  try {
    const id = taskIdSchema.parse(taskId);
    const task = await getById<Task>(COLLECTIONS.tasks, id);
    if (!task) throw new Error("Tarefa não encontrada");
    if (task.status === "concluida") return { ok: true, data: { id } };
    if (task.status === "cancelada") throw new Error("Tarefa cancelada não pode ser concluída");

    const completedAt = nowIso();
    await update<Task>(COLLECTIONS.tasks, id, { status: "concluida", completedAt, completedBy: user.id });
    if (task.slaInstanceId) await completeSla(task.slaInstanceId);

    await emitEvent({
      type: "task.completed",
      actor: { id: user.id, name: user.name },
      clientId: task.clientId,
      entity: { type: "task", id },
      title: `Tarefa concluída por ${user.name}: ${task.title}`,
      department: task.departmentId,
      payload: {
        assigneeId: task.assigneeId,
        completedBy: user.id,
        dueAt: task.dueAt,
        late: Boolean(task.dueAt && completedAt > task.dueAt),
        processType: task.processType,
        processId: task.processId,
        origin: "meu-dia",
      },
    });

    revalidatePath("/meu-dia");
    revalidatePath("/tarefas");
    if (task.clientId) revalidatePath(`/clientes/${task.clientId}`);
    if (task.processType === "workflow") revalidatePath("/workflow");
    return { ok: true, data: { id } };
  } catch (error) {
    return fail(error);
  }
}
