import "server-only";
/**
 * Autorização da Central de Tarefas (operacao.tarefas): ações permitidas e visibilidade de uma tarefa (A7/A29).
 *
 * Lista: escopo da tela (resolveDataScope) — padrão: gestores/diretoria/admin = empresa; demais = departamento do
 * registro + as próprias. Detalhe e ações sobre uma tarefa (catálogo, nota do escopo): visível = escopo da lista ∪
 * vínculo (responsável ou criador) ∪ tarefa ligada a cliente visível (Cliente 360) ∪ etapa de workflow visível — os
 * links vindos da ficha do cliente e do Workflow continuam abrindo a tarefa, como antes.
 */
import { can } from "@/server/auth/session";
import { canSeeRecord, resolveDataScope, scopeAllows } from "@/server/auth/scope";
import { getById } from "@/server/db";
import { canSeeClientId } from "@/server/clients/access";
import { COLLECTIONS, type CurrentUser, type Task, type WorkflowStep } from "@/domain/types";
import { parseProcessTaskId } from "@/domain/workflow-graph";
import type { TaskCapabilities } from "@/components/tasks/task-model";

export const TASKS_SCREEN = "operacao.tarefas" as const;

export function taskCapabilities(user: CurrentUser): TaskCapabilities {
  return {
    create: can(user, "operacao.tarefas.criar"),
    edit: can(user, "operacao.tarefas.editar"),
    complete: can(user, "operacao.tarefas.concluir"),
    reopen: can(user, "operacao.tarefas.reabrir"),
    cancel: can(user, "operacao.tarefas.cancelar"),
    assign: can(user, "operacao.tarefas.atribuir"),
    comment: can(user, "operacao.tarefas.comentar"),
    deleteOwn: can(user, "operacao.tarefas.excluir"),
    deleteAny: can(user, "operacao.tarefas.excluir-qualquer"),
    answerProcess: can(user, "operacao.tarefas.responder-processo"),
  };
}

type TaskRef = Pick<Task, "assigneeId" | "creatorId" | "departmentId" | "clientId" | "processType" | "processId">;

/** O usuário pode abrir/agir sobre esta tarefa? (tela + escopo + vínculos, ver cabeçalho) */
export async function canSeeTask(user: CurrentUser, task: TaskRef): Promise<boolean> {
  if (!can(user, "operacao.tarefas.ver")) return false;
  const scope = await resolveDataScope(user, TASKS_SCREEN);
  if (scopeAllows(scope, [task.assigneeId, task.creatorId], task.departmentId)) return true;
  if (task.clientId && (await canSeeClientId(user, task.clientId))) return true;
  if (task.processType === "workflow" && task.processId && !parseProcessTaskId(task.processId)) {
    const step = await getById<WorkflowStep>(COLLECTIONS.workflowSteps, task.processId);
    if (step && (await canSeeRecord(user, "operacao.workflow", [step.assigneeId], step.department))) return true;
  }
  return false;
}
