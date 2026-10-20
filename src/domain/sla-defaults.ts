/**
 * SLA padrão por departamento: a regra de SLA de chave `tarefa.<departamento>` vale para toda tarefa daquele
 * departamento criada sem SLA próprio (manual, recorrente, automática ou passo de fluxo sem horas). Sem a regra (ou
 * com ela desativada), a tarefa segue sem SLA, só com a data de entrega. Módulo puro (servidor, cliente e testes).
 */
import { DEPARTMENT_KEYS, type DepartmentKey } from "./constants";

const PREFIX = "tarefa.";

/** Chave da regra de SLA padrão das tarefas de um departamento (ex.: `tarefa.suporte`). */
export function departmentTaskSlaKey(department: DepartmentKey): string {
  return `${PREFIX}${department}`;
}

/** Departamento cuja regra padrão de tarefas tem esta chave, ou null quando a chave não é de SLA padrão. */
export function departmentOfTaskSlaKey(key: string): DepartmentKey | null {
  if (!key.startsWith(PREFIX)) return null;
  const department = key.slice(PREFIX.length);
  return (DEPARTMENT_KEYS as readonly string[]).includes(department) ? (department as DepartmentKey) : null;
}
