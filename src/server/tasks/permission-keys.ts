/**
 * Chaves do catálogo exigidas pelas ações da Central de Tarefas (puro: usado pelas actions e pelos testes).
 *
 * `changeTaskStatus` é um despacho pelo argumento (catálogo: guards com qualificador `?status=`): concluir exige
 * `operacao.tarefas.concluir`, cancelar `operacao.tarefas.cancelar`, sair de concluída/cancelada exige
 * `operacao.tarefas.reabrir` (e, se o destino não for "aberta", também `operacao.tarefas.editar`), e os status
 * intermediários `operacao.tarefas.editar`. Sem isso a troca de status seria um atalho para contornar as chaves
 * próprias de concluir/cancelar/reabrir.
 */
import type { TaskStatus } from "@/domain/constants";
import type { PermissionKey } from "@/domain/permissions";

export function statusChangeKeys(from: TaskStatus, to: TaskStatus): PermissionKey[] {
  if (from === to) return ["operacao.tarefas.editar"];
  if (to === "concluida") return ["operacao.tarefas.concluir"];
  if (to === "cancelada") return ["operacao.tarefas.cancelar"];
  if (from === "concluida" || from === "cancelada") return to === "aberta" ? ["operacao.tarefas.reabrir"] : ["operacao.tarefas.reabrir", "operacao.tarefas.editar"];
  return ["operacao.tarefas.editar"];
}

/** Excluir: a própria tarefa exige `excluir`; a de outra pessoa exige também `excluir-qualquer`. */
export function deleteTaskKeys(task: { creatorId?: string }, userId: string): PermissionKey[] {
  return task.creatorId === userId ? ["operacao.tarefas.excluir"] : ["operacao.tarefas.excluir", "operacao.tarefas.excluir-qualquer"];
}
