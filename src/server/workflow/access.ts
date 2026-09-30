import "server-only";
/**
 * Autorização da tela Workflow (operacao.workflow): escopo das etapas e jornadas (A7/A29).
 *
 * Dono de uma etapa = responsável (assigneeId) e o departamento da etapa. Padrão = empresa para todos (comportamento
 * anterior); a consulta SEMPRE passa por resolveDataScope para que a restrição configurada pelo CEO/CTO valha no
 * quadro, no drawer da etapa, na jornada completa e nas actions por etapa.
 */
import { can } from "@/server/auth/session";
import { canSeeRecord, filterByScope, resolveDataScope, scopeAllows, type DataScope } from "@/server/auth/scope";
import { getById, list } from "@/server/db";
import { COLLECTIONS, type CurrentUser, type WorkflowStep } from "@/domain/types";

export const WORKFLOW_SCREEN = "operacao.workflow" as const;

type StepOwner = Pick<WorkflowStep, "assigneeId" | "department">;

const ownerOf = (step: StepOwner) => ({ owners: [step.assigneeId], departmentId: step.department });

export function workflowScope(user: CurrentUser): Promise<DataScope> {
  return resolveDataScope(user, WORKFLOW_SCREEN);
}

export function scopeSteps<T extends StepOwner>(steps: readonly T[], scope: DataScope): T[] {
  return filterByScope(steps, ownerOf, scope);
}

/** O usuário vê esta etapa? (tela + escopo) */
export function canSeeStep(user: CurrentUser, step: StepOwner): Promise<boolean> {
  return canSeeRecord(user, WORKFLOW_SCREEN, [step.assigneeId], step.department);
}

/** Como canSeeStep, pelo id; etapa inexistente = true (a action/página devolve "não encontrada" depois). */
export async function canSeeStepId(user: CurrentUser, stepId: string): Promise<boolean> {
  if (!can(user, "operacao.workflow.ver")) return false;
  const scope = await workflowScope(user);
  if (!scope.userIds && !scope.departmentKeys) return true;
  const step = await getById<WorkflowStep>(COLLECTIONS.workflowSteps, stepId);
  return step ? scopeAllows(scope, [step.assigneeId], step.department) : true;
}

/** A jornada (instância) está no escopo quando alguma etapa dela está. Só lê as etapas quando o escopo recorta. */
export async function canSeeInstance(user: CurrentUser, instanceId: string): Promise<boolean> {
  if (!can(user, "operacao.workflow.ver")) return false;
  const scope = await workflowScope(user);
  if (!scope.userIds && !scope.departmentKeys) return true;
  const steps = await list<WorkflowStep>(COLLECTIONS.workflowSteps, { where: [["instanceId", "==", instanceId]] });
  return steps.some((s) => scopeAllows(scope, [s.assigneeId], s.department));
}
