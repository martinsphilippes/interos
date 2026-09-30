"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { failAction, requirePermission } from "@/server/auth/session";
import { resolveDataScope } from "@/server/auth/scope";
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
import { assertContractRenewalAccess, assertCsClientAccess, assertPlanAccess, assertPlanDraftAccess, assertRenewalAccess, clientOwners, isUnrestricted, loadOwnerFilter } from "./access";

/**
 * Server Actions do módulo de Customer Success.
 *
 * Padrão: requirePermission(chave do catálogo src/domain/permissions/cs.ts) → validação zod → escopo do registro
 * (cliente, plano ou renovação; A29) → serviço (mutação + eventos) → revalidatePath das rotas afetadas. Falhas pelo
 * tratamento único (failAction: relança redirect/notFound, esconde erros técnicos); validação com a primeira
 * mensagem do zod, como antes.
 */

type Failure = { ok: false; error: string };

const actor = (user: CurrentUser): UserRef => ({ id: user.id, name: user.name });

function fail(error: unknown, fallback: string): Failure {
  if (error instanceof z.ZodError) return { ok: false, error: zodMessage(error) };
  return failAction(error, fallback, "cs");
}

/** Mensagem de negação do recálculo da carteira (a mesma de antes do catálogo; padrão = gestores). */
const RECALCULATE_ALL_DENIED = "Apenas gestores e administradores podem recalcular a carteira inteira";

/** Plano com id = edição; sem id = criação (a chave depende do argumento, antes da validação). */
function planIdOf(input: unknown): string | undefined {
  const id = input && typeof input === "object" ? (input as { id?: unknown }).id : undefined;
  return typeof id === "string" && id.trim() ? id.trim() : undefined;
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
    const user = await requirePermission("cs.saude.recalcular");
    const { clientId } = clientIdSchema.parse(input);
    await assertCsClientAccess(user, clientId, "cs.saude");
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
    const user = await requirePermission("cs.saude.recalcular-carteira", RECALCULATE_ALL_DENIED);
    // Com o escopo de Saúde restrito, recalcula só os clientes que o usuário vê (a varredura diária cobre o resto).
    const scope = await resolveDataScope(user, "cs.saude");
    const allows = isUnrestricted(scope) ? null : await loadOwnerFilter(scope);
    const result = await recalculateAllHealth(actor(user), allows ? { include: (client, account) => allows(clientOwners(client, account)) } : {});
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
    const user = await requirePermission("cs.checkpoints.criar");
    const data = checkpointSchema.parse(input);
    await assertCsClientAccess(user, data.clientId, "cs.checkpoints");
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
    // Criar e editar são ações distintas no catálogo: a chave depende de o plano já existir.
    const user = planIdOf(input) ? await requirePermission("cs.planos.editar") : await requirePermission("cs.planos.criar");
    const data = successPlanSchema.parse(input);
    if (data.id) await assertPlanAccess(user, data.id);
    await assertPlanDraftAccess(user, { ownerId: data.ownerId, actions: data.actions });
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
    const user = await requirePermission("cs.planos.editar");
    const data = planActionToggleSchema.parse(input);
    await assertPlanAccess(user, data.planId);
    await setPlanActionDone(data.planId, data.actionId, data.done, actor(user));
    revalidateCs(undefined, ["/tarefas"]);
    return { ok: true, data: { done: data.done } };
  } catch (error) {
    return fail(error, "Não foi possível atualizar a ação");
  }
}

export async function closePlan(input: unknown): Promise<ActionResult<{ status: string }>> {
  try {
    const user = await requirePermission("cs.planos.concluir");
    const data = closePlanSchema.parse(input);
    await assertPlanAccess(user, data.planId);
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
    const user = await requirePermission("cs.renovacoes.negociar");
    const { renewalId } = renewalIdSchema.parse(input);
    await assertRenewalAccess(user, renewalId);
    const task = await startRenewalNegotiation(renewalId, actor(user));
    revalidateCs(task.clientId, ["/tarefas"]);
    return { ok: true, data: { taskId: task.id } };
  } catch (error) {
    return fail(error, "Não foi possível iniciar a negociação");
  }
}

export async function renewContract(input: unknown): Promise<ActionResult<{ newEndDate: string; amendmentNumber: string; applied: boolean }>> {
  try {
    const user = await requirePermission("cs.renovacoes.renovar");
    const data = renewSchema.parse(input);
    await assertRenewalAccess(user, data.renewalId);
    const result = await completeRenewal(data.renewalId, data.termMonths, data.notes, actor(user), { readjustment: data.readjustment, requiresSignature: data.requiresSignature });
    revalidateCs(undefined, ["/financeiro/contratos", "/financeiro/recorrencia", "/financeiro/cobrancas", "/tarefas"]);
    revalidatePath("/financeiro", "layout");
    return { ok: true, data: result };
  } catch (error) {
    return fail(error, "Não foi possível registrar a renovação");
  }
}

export async function markRenewalLost(input: unknown): Promise<ActionResult<{ clientId: string }>> {
  try {
    const user = await requirePermission("cs.renovacoes.perder");
    const data = loseRenewalSchema.parse(input);
    await assertRenewalAccess(user, data.renewalId);
    const result = await loseRenewal(data.renewalId, data.reason, actor(user));
    revalidateCs(result.clientId, ["/tarefas"]);
    return { ok: true, data: result };
  } catch (error) {
    return fail(error, "Não foi possível registrar a perda da renovação");
  }
}

export async function createRenewal(input: unknown): Promise<ActionResult<{ id: string }>> {
  try {
    const user = await requirePermission("cs.renovacoes.criar");
    const { contractId } = createRenewalSchema.parse(input);
    await assertContractRenewalAccess(user, contractId);
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
    const user = await requirePermission("cs.riscos.escalar");
    const data = escalateSchema.parse(input);
    await assertCsClientAccess(user, data.clientId, "cs.riscos");
    const notified = await escalateRisk(data.clientId, data.note, { ...actor(user), managerId: user.managerId });
    revalidateCs(data.clientId);
    return { ok: true, data: { notified } };
  } catch (error) {
    return fail(error, "Não foi possível escalar o risco");
  }
}

export async function registerChurn(input: unknown): Promise<ActionResult<{ lostMrr: number; newMrr: number; fullChurn: boolean }>> {
  try {
    const user = await requirePermission("cs.churn.registrar");
    const data = churnSchema.parse(input);
    await assertCsClientAccess(user, data.clientId, "cs.churn");
    const result = await registerChurnService(data, actor(user));
    revalidateCs(data.clientId, ["/financeiro", "/financeiro/contratos", "/financeiro/recorrencia"]);
    return { ok: true, data: { lostMrr: result.lostMrr, newMrr: result.newMrr, fullChurn: result.fullChurn } };
  } catch (error) {
    return fail(error, "Não foi possível registrar o cancelamento");
  }
}

export async function generateUpsell(input: unknown): Promise<ActionResult<{ id: string; kind: string }>> {
  try {
    const user = await requirePermission("cs.upsell.criar-oportunidade");
    const data = upsellSchema.parse(input);
    await assertCsClientAccess(user, data.clientId, "cs.upsell");
    const opp = await createCsUpsell(data, actor(user));
    revalidateCs(data.clientId, ["/vendas", "/vendas/oportunidades", "/vendas/pipeline"]);
    return { ok: true, data: { id: opp.id, kind: opp.kind } };
  } catch (error) {
    return fail(error, "Não foi possível gerar a oportunidade");
  }
}

export async function activateCustomer(input: unknown): Promise<ActionResult<{ activatedAt: string }>> {
  try {
    const user = await requirePermission("cs.carteira.ativar-cliente");
    const { clientId } = clientIdSchema.parse(input);
    await assertCsClientAccess(user, clientId, "cs.carteira");
    const result = await activateCustomerService(clientId, actor(user));
    revalidateCs(clientId, ["/workflow"]);
    return { ok: true, data: result };
  } catch (error) {
    return fail(error, "Não foi possível ativar o cliente");
  }
}
