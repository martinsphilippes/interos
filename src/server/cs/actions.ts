"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { canAccessModule, requireUser } from "@/server/auth/session";
import type { ActionResult, CurrentUser, UserRef } from "@/domain/types";
import {
  activateCustomer as activateCustomerService,
  closeSuccessPlan,
  completeRenewal,
  createCsUpsell,
  createRenewalForContract,
  createSuccessPlan,
  escalateRisk,
  loseRenewal,
  recalculateAllHealth,
  recalculateClientHealth,
  registerCheckpoint as registerCheckpointService,
  registerChurn as registerChurnService,
  setPlanActionDone,
  startRenewalNegotiation,
  updateSuccessPlan,
} from "./service";
import {
  checkpointSchema,
  churnSchema,
  clientIdSchema,
  closePlanSchema,
  createRenewalSchema,
  escalateSchema,
  loseRenewalSchema,
  planActionToggleSchema,
  renewalIdSchema,
  renewSchema,
  successPlanSchema,
  upsellSchema,
  zodMessage,
} from "./schemas";

/**
 * Server Actions do módulo de Customer Success.
 *
 * Padrão: requireUser() + acesso ao módulo "cs" → validação zod (ZodError vira { ok: false, error }) →
 * serviço (mutação + eventos) → revalidatePath das rotas afetadas.
 */

const actor = (user: CurrentUser): UserRef => ({ id: user.id, name: user.name });

function fail(error: unknown, fallback: string): { ok: false; error: string } {
  if (error instanceof z.ZodError) return { ok: false, error: zodMessage(error) };
  console.error(`[cs] ${fallback}`, error);
  return { ok: false, error: error instanceof Error && error.message ? error.message : fallback };
}

async function requireCsUser(): Promise<CurrentUser> {
  const user = await requireUser();
  if (!canAccessModule(user, "cs")) throw new Error("Seu perfil não tem acesso ao Customer Success");
  return user;
}

const CS_PATHS = ["/cs", "/cs/saude", "/cs/checkpoints", "/cs/planos", "/cs/renovacoes", "/cs/riscos", "/cs/upsell", "/cs/churn"];

function revalidateCs(clientId?: string, extra: string[] = []) {
  for (const p of [...CS_PATHS, ...extra]) revalidatePath(p);
  revalidatePath("/meu-dia");
  if (clientId) {
    revalidatePath("/clientes");
    revalidatePath(`/clientes/${clientId}`);
  }
}

// ---------------------------------------------------------------------------
// Saúde
// ---------------------------------------------------------------------------

export async function recalculateHealth(input: unknown): Promise<ActionResult<{ score: number; level: string; changed: boolean }>> {
  try {
    const user = await requireCsUser();
    const { clientId } = clientIdSchema.parse(input);
    const result = await recalculateClientHealth(clientId, actor(user));
    if (!result) return { ok: false, error: "Cliente não encontrado" };
    revalidateCs(clientId);
    return { ok: true, data: { score: result.score, level: result.level, changed: result.changed } };
  } catch (error) {
    return fail(error, "Não foi possível recalcular a saúde");
  }
}

export async function recalculateAllHealthAction(): Promise<ActionResult<{ count: number; changed: number; risk: number }>> {
  try {
    const user = await requireCsUser();
    if (!user.isManager) return { ok: false, error: "Apenas gestores e administradores podem recalcular a carteira inteira" };
    const result = await recalculateAllHealth(actor(user));
    revalidateCs(undefined, ["/clientes"]);
    return { ok: true, data: { count: result.count, changed: result.changed, risk: result.risk } };
  } catch (error) {
    return fail(error, "Não foi possível recalcular a carteira");
  }
}

// ---------------------------------------------------------------------------
// Checkpoints
// ---------------------------------------------------------------------------

export async function registerCheckpoint(input: unknown): Promise<ActionResult<{ tasksCreated: number; score?: number; nextInteractionAt: string }>> {
  try {
    const user = await requireCsUser();
    const data = checkpointSchema.parse(input);
    const result = await registerCheckpointService(data, actor(user));
    revalidateCs(data.clientId, ["/tarefas"]);
    return { ok: true, data: { tasksCreated: result.tasksCreated, score: result.health?.score, nextInteractionAt: result.nextInteractionAt } };
  } catch (error) {
    return fail(error, "Não foi possível registrar o checkpoint");
  }
}

// ---------------------------------------------------------------------------
// Planos de sucesso
// ---------------------------------------------------------------------------

export async function saveSuccessPlan(input: unknown): Promise<ActionResult<{ id: string }>> {
  try {
    const user = await requireCsUser();
    const data = successPlanSchema.parse(input);
    const payload = { clientId: data.clientId, ownerId: data.ownerId, objective: data.objective, checkpointAt: data.checkpointAt, actions: data.actions };
    const plan = data.id ? await updateSuccessPlan(data.id, payload, actor(user)) : await createSuccessPlan(payload, actor(user), "manual");
    revalidateCs(data.clientId, ["/tarefas"]);
    return { ok: true, data: { id: plan.id } };
  } catch (error) {
    return fail(error, "Não foi possível salvar o plano de sucesso");
  }
}

export async function togglePlanAction(input: unknown): Promise<ActionResult<{ done: boolean }>> {
  try {
    const user = await requireCsUser();
    const data = planActionToggleSchema.parse(input);
    await setPlanActionDone(data.planId, data.actionId, data.done, actor(user));
    revalidateCs(undefined, ["/tarefas"]);
    return { ok: true, data: { done: data.done } };
  } catch (error) {
    return fail(error, "Não foi possível atualizar a ação");
  }
}

export async function closePlan(input: unknown): Promise<ActionResult<{ status: string }>> {
  try {
    const user = await requireCsUser();
    const data = closePlanSchema.parse(input);
    await closeSuccessPlan(data.planId, data.status, data.result, actor(user));
    revalidateCs(undefined, ["/tarefas"]);
    return { ok: true, data: { status: data.status } };
  } catch (error) {
    return fail(error, "Não foi possível encerrar o plano");
  }
}

// ---------------------------------------------------------------------------
// Renovações
// ---------------------------------------------------------------------------

export async function startNegotiation(input: unknown): Promise<ActionResult<{ taskId: string }>> {
  try {
    const user = await requireCsUser();
    const { renewalId } = renewalIdSchema.parse(input);
    const task = await startRenewalNegotiation(renewalId, actor(user));
    revalidateCs(task.clientId, ["/tarefas"]);
    return { ok: true, data: { taskId: task.id } };
  } catch (error) {
    return fail(error, "Não foi possível iniciar a negociação");
  }
}

export async function renewContract(input: unknown): Promise<ActionResult<{ newEndDate: string }>> {
  try {
    const user = await requireCsUser();
    const data = renewSchema.parse(input);
    const result = await completeRenewal(data.renewalId, data.termMonths, data.notes, actor(user));
    revalidateCs(undefined, ["/financeiro/contratos", "/financeiro/recorrencia", "/tarefas"]);
    return { ok: true, data: result };
  } catch (error) {
    return fail(error, "Não foi possível registrar a renovação");
  }
}

export async function markRenewalLost(input: unknown): Promise<ActionResult<{ clientId: string }>> {
  try {
    const user = await requireCsUser();
    const data = loseRenewalSchema.parse(input);
    const result = await loseRenewal(data.renewalId, data.reason, actor(user));
    revalidateCs(result.clientId, ["/tarefas"]);
    return { ok: true, data: result };
  } catch (error) {
    return fail(error, "Não foi possível registrar a perda da renovação");
  }
}

export async function createRenewal(input: unknown): Promise<ActionResult<{ id: string }>> {
  try {
    const user = await requireCsUser();
    const { contractId } = createRenewalSchema.parse(input);
    const renewal = await createRenewalForContract(contractId, actor(user));
    revalidateCs(renewal.clientId, ["/tarefas"]);
    return { ok: true, data: { id: renewal.id } };
  } catch (error) {
    return fail(error, "Não foi possível criar a renovação");
  }
}

// ---------------------------------------------------------------------------
// Riscos, churn, upsell e ativação
// ---------------------------------------------------------------------------

export async function escalateToManager(input: unknown): Promise<ActionResult<{ notified: number }>> {
  try {
    const user = await requireCsUser();
    const data = escalateSchema.parse(input);
    const notified = await escalateRisk(data.clientId, data.note, { ...actor(user), managerId: user.managerId });
    revalidateCs(data.clientId);
    return { ok: true, data: { notified } };
  } catch (error) {
    return fail(error, "Não foi possível escalar o risco");
  }
}

export async function registerChurn(input: unknown): Promise<ActionResult<{ lostMrr: number; newMrr: number; fullChurn: boolean }>> {
  try {
    const user = await requireCsUser();
    const data = churnSchema.parse(input);
    const result = await registerChurnService(data, actor(user));
    revalidateCs(data.clientId, ["/financeiro", "/financeiro/contratos", "/financeiro/recorrencia"]);
    return { ok: true, data: { lostMrr: result.lostMrr, newMrr: result.newMrr, fullChurn: result.fullChurn } };
  } catch (error) {
    return fail(error, "Não foi possível registrar o cancelamento");
  }
}

export async function generateUpsell(input: unknown): Promise<ActionResult<{ id: string; kind: string }>> {
  try {
    const user = await requireCsUser();
    const data = upsellSchema.parse(input);
    const opp = await createCsUpsell(data, actor(user));
    revalidateCs(data.clientId, ["/vendas", "/vendas/oportunidades", "/vendas/pipeline"]);
    return { ok: true, data: { id: opp.id, kind: opp.kind } };
  } catch (error) {
    return fail(error, "Não foi possível gerar a oportunidade");
  }
}

export async function activateCustomer(input: unknown): Promise<ActionResult<{ activatedAt: string }>> {
  try {
    const user = await requireCsUser();
    const { clientId } = clientIdSchema.parse(input);
    const result = await activateCustomerService(clientId, actor(user));
    revalidateCs(clientId, ["/workflow"]);
    return { ok: true, data: result };
  } catch (error) {
    return fail(error, "Não foi possível ativar o cliente");
  }
}
