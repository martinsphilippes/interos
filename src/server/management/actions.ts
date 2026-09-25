"use server";
/**
 * Ações do Dashboard do Gestor. Redistribuir tarefas reaproveita o serviço de tarefas
 * (assignTaskInternal): cada reatribuição grava o evento task.assigned (auditoria e timeline) e o handler
 * de notificações avisa o novo responsável; o responsável anterior recebe um resumo.
 */
import { revalidatePath } from "next/cache";
import { z } from "zod";
import { getManyByIds, list } from "@/server/db";
import { requireUser } from "@/server/auth/session";
import { assignTaskInternal } from "@/server/tasks/service";
import { notify } from "@/server/notifications";
import { isOpenStatus } from "@/components/tasks/task-model";
import { COLLECTIONS, type ActionResult, type Task, type User } from "@/domain/types";
import { canManageMember } from "./queries";
import { redistributeTasksSchema, zodMessage } from "./schemas";

export async function redistributeTasks(input: unknown): Promise<ActionResult<{ moved: number; skipped: number }>> {
  const user = await requireUser();
  try {
    if (!user.isManager) return { ok: false, error: "Apenas gestores podem redistribuir tarefas." };
    const { fromUserId, toUserId, taskIds } = redistributeTasksSchema.parse(input);
    if (fromUserId === toUserId) return { ok: false, error: "Escolha um responsável diferente do atual." };

    const users = (await list<User>(COLLECTIONS.users)).filter((u) => u.active !== false);
    if (!canManageMember(user, fromUserId, users)) return { ok: false, error: "Este colaborador não faz parte da sua equipe." };
    if (toUserId !== user.id && !canManageMember(user, toUserId, users)) return { ok: false, error: "O novo responsável precisa ser da sua equipe." };
    const target = users.find((u) => u.id === toUserId);
    if (!target) return { ok: false, error: "Novo responsável não encontrado ou inativo." };

    const tasks = await getManyByIds<Task>(COLLECTIONS.tasks, taskIds);
    const actor = { id: user.id, name: user.name };
    const moved: Task[] = [];
    let skipped = 0;
    for (const id of taskIds) {
      const task = tasks.get(id);
      // Só tarefas abertas que ainda estão com o colaborador de origem (evita sobrescrever mudança concorrente).
      if (!task || task.assigneeId !== fromUserId || !isOpenStatus(task.status)) {
        skipped += 1;
        continue;
      }
      moved.push(await assignTaskInternal(task, toUserId, actor));
    }

    if (moved.length > 0) {
      await notify({
        userIds: [fromUserId],
        kind: "informativa",
        title: `${moved.length} tarefa(s) redistribuída(s) para ${target.name}`,
        body: `${user.name} redistribuiu: ${moved
          .slice(0, 5)
          .map((t) => t.title)
          .join("; ")}${moved.length > 5 ? "…" : ""}`,
        href: "/tarefas",
      });
    }

    revalidatePath("/gestao");
    revalidatePath(`/gestao/equipe/${fromUserId}`);
    revalidatePath(`/gestao/equipe/${toUserId}`);
    revalidatePath("/tarefas");
    revalidatePath("/meu-dia");
    return { ok: true, data: { moved: moved.length, skipped } };
  } catch (error) {
    if (error instanceof z.ZodError) return { ok: false, error: zodMessage(error) };
    return { ok: false, error: error instanceof Error ? error.message : "Não foi possível redistribuir as tarefas." };
  }
}
