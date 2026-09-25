"use server";
/**
 * Server Actions do módulo de Vendas. Padrão: requireUser() → validação zod → serviço (regras e
 * eventos) → revalidatePath. Todas devolvem ActionResult com mensagem em português.
 */
import { revalidatePath } from "next/cache";
import { z } from "zod";
import { canAccessModule, requireUser } from "@/server/auth/session";
import { getById } from "@/server/db";
import { COLLECTIONS, type ActionResult, type CurrentUser, type Opportunity, type UserRef } from "@/domain/types";
import {
  cancelVisitSchema,
  changeStageSchema,
  completeVisitSchema,
  createOpportunityTaskSchema,
  createVisitSchema,
  markLostSchema,
  markWonSchema,
  opportunityIdSchema,
  productLineSchema,
  proposalIdSchema,
  proposalTransitionSchema,
  registerContactSchema,
  rescheduleVisitSchema,
  saveProposalSchema,
  scheduleNextActionSchema,
  updateOpportunitySchema,
  attachDocumentSchema,
  internalNoteSchema,
  registerCallSchema,
  transferOpportunitySchema,
  workspaceMessageSchema,
  zodMessage,
} from "./schemas";
import { attachOpportunityDocument, registerCall, registerInternalNote, sendOrRegisterMessage, transferOpportunity, type MessageResult } from "./workspace";
import {
  cancelVisit,
  changeStage,
  completeVisit,
  createOpportunity,
  createOpportunityTask,
  createVisit,
  detectStalledOpportunities,
  markOpportunityLost,
  markOpportunityWon,
  newProposalVersion,
  registerOpportunityContact,
  reopenOpportunity,
  rescheduleVisit,
  saveProposal,
  scheduleNextAction,
  transitionProposal,
  updateOpportunityData,
  type SweepResult,
} from "./service";

type Failure = { ok: false; error: string };

function fail(error: unknown, fallback: string): Failure {
  if (error instanceof z.ZodError) return { ok: false, error: zodMessage(error) };
  if (error instanceof Error && error.message) {
    // Erros de regra do serviço já vêm em português; erros técnicos ficam no log.
    if (!/firestore|firebase|ECONN|deadline|permission/i.test(error.message)) return { ok: false, error: error.message };
  }
  console.error(`[vendas] ${fallback}`, error);
  return { ok: false, error: fallback };
}

const actorOf = (user: CurrentUser): UserRef => ({ id: user.id, name: user.name });

async function requireSalesUser(): Promise<CurrentUser> {
  const user = await requireUser();
  if (!canAccessModule(user, "vendas")) throw new Error("Seu perfil não tem acesso ao módulo de Vendas");
  return user;
}

/** Só o dono, quem originou, ou gestores/admin alteram a oportunidade. */
async function requireOpportunityAccess(user: CurrentUser, opportunityId: string): Promise<Opportunity> {
  const opp = await getById<Opportunity>(COLLECTIONS.opportunities, opportunityId);
  if (!opp) throw new Error("Oportunidade não encontrada");
  if (!user.isManager && opp.ownerId !== user.id && opp.originUserId !== user.id) throw new Error("Você não tem permissão para alterar esta oportunidade");
  return opp;
}

function revalidateSales(clientId?: string) {
  revalidatePath("/vendas", "layout");
  revalidatePath("/meu-dia");
  if (clientId) revalidatePath(`/clientes/${clientId}`);
}

// ---------------------------------------------------------------------------
// Oportunidades
// ---------------------------------------------------------------------------

const createOpportunitySchema = z.object({
  clientId: z.string().trim().min(1, "Escolha o cliente"),
  title: z.string().trim().min(3, "Informe o título da oportunidade").max(200),
  kind: z.enum(["nova_venda", "upsell", "cross_sell", "renovacao"], { message: "Tipo inválido" }),
  ownerId: z.string().trim().min(1, "Escolha o vendedor"),
  temperature: z.enum(["quente", "morno", "frio"], { message: "Temperatura inválida" }),
  products: z.array(productLineSchema).max(50),
  need: z.string().trim().max(2000).optional().transform((v) => (v ? v : undefined)),
  nextAction: z.string().trim().min(3, "Descreva a próxima ação").max(300),
  nextActionAt: z.string().trim().min(1, "Informe a data da próxima ação").refine((v) => !Number.isNaN(new Date(v).getTime()), "Data inválida"),
});

export async function createOpportunityAction(input: unknown): Promise<ActionResult<{ id: string }>> {
  try {
    const user = await requireSalesUser();
    const data = createOpportunitySchema.parse(input);
    const opp = await createOpportunity({ ...data, nextActionAt: new Date(data.nextActionAt).toISOString() }, { ...actorOf(user), departmentId: user.departmentId });
    revalidateSales(opp.clientId);
    return { ok: true, data: { id: opp.id } };
  } catch (error) {
    return fail(error, "Não foi possível criar a oportunidade");
  }
}

export async function changeOpportunityStage(input: unknown): Promise<ActionResult<{ stage: Opportunity["stage"] }>> {
  try {
    const user = await requireSalesUser();
    const data = changeStageSchema.parse(input);
    await requireOpportunityAccess(user, data.opportunityId);
    const opp = await changeStage(data.opportunityId, data.stage, actorOf(user));
    revalidateSales(opp.clientId);
    return { ok: true, data: { stage: opp.stage } };
  } catch (error) {
    return fail(error, "Não foi possível mudar a etapa");
  }
}

export async function updateOpportunity(input: unknown): Promise<ActionResult<{ id: string }>> {
  try {
    const user = await requireSalesUser();
    const data = updateOpportunitySchema.parse(input);
    await requireOpportunityAccess(user, data.opportunityId);
    const opp = await updateOpportunityData(data, actorOf(user));
    revalidateSales(opp.clientId);
    return { ok: true, data: { id: opp.id } };
  } catch (error) {
    return fail(error, "Não foi possível salvar a oportunidade");
  }
}

export async function scheduleOpportunityNextAction(input: unknown): Promise<ActionResult<{ id: string }>> {
  try {
    const user = await requireSalesUser();
    const data = scheduleNextActionSchema.parse(input);
    await requireOpportunityAccess(user, data.opportunityId);
    const opp = await scheduleNextAction(data.opportunityId, data.nextAction, data.nextActionAt, actorOf(user));
    revalidateSales(opp.clientId);
    return { ok: true, data: { id: opp.id } };
  } catch (error) {
    return fail(error, "Não foi possível agendar a próxima ação");
  }
}

export async function registerOpportunityContactAction(input: unknown): Promise<ActionResult<{ eventId: string }>> {
  try {
    const user = await requireSalesUser();
    const data = registerContactSchema.parse(input);
    const opp = await requireOpportunityAccess(user, data.opportunityId);
    const event = await registerOpportunityContact(data, actorOf(user));
    revalidateSales(opp.clientId);
    return { ok: true, data: { eventId: event.id } };
  } catch (error) {
    return fail(error, "Não foi possível registrar o contato");
  }
}

export async function createOpportunityTaskAction(input: unknown): Promise<ActionResult<{ id: string }>> {
  try {
    const user = await requireSalesUser();
    const data = createOpportunityTaskSchema.parse(input);
    const opp = await requireOpportunityAccess(user, data.opportunityId);
    const task = await createOpportunityTask(data, actorOf(user));
    revalidateSales(opp.clientId);
    revalidatePath("/tarefas");
    return { ok: true, data: { id: task.id } };
  } catch (error) {
    return fail(error, "Não foi possível criar a tarefa");
  }
}

export async function markOpportunityWonAction(input: unknown): Promise<ActionResult<{ id: string; contractId?: string }>> {
  try {
    const user = await requireSalesUser();
    const data = markWonSchema.parse(input);
    await requireOpportunityAccess(user, data.opportunityId);
    const opp = await markOpportunityWon(data, actorOf(user));
    revalidateSales(opp.clientId);
    revalidatePath("/workflow");
    revalidatePath("/tarefas");
    revalidatePath("/financeiro", "layout");
    return { ok: true, data: { id: opp.id, contractId: opp.contractId } };
  } catch (error) {
    return fail(error, "Não foi possível marcar como ganha");
  }
}

export async function markOpportunityLostAction(input: unknown): Promise<ActionResult<{ id: string }>> {
  try {
    const user = await requireSalesUser();
    const data = markLostSchema.parse(input);
    await requireOpportunityAccess(user, data.opportunityId);
    const opp = await markOpportunityLost(data, actorOf(user));
    revalidateSales(opp.clientId);
    revalidatePath("/marketing", "layout");
    return { ok: true, data: { id: opp.id } };
  } catch (error) {
    return fail(error, "Não foi possível marcar como perdida");
  }
}

export async function reopenOpportunityAction(input: unknown): Promise<ActionResult<{ stage: Opportunity["stage"] }>> {
  try {
    const user = await requireSalesUser();
    const data = opportunityIdSchema.parse(input);
    await requireOpportunityAccess(user, data.opportunityId);
    const opp = await reopenOpportunity(data.opportunityId, actorOf(user));
    revalidateSales(opp.clientId);
    return { ok: true, data: { stage: opp.stage } };
  } catch (error) {
    return fail(error, "Não foi possível reabrir a oportunidade");
  }
}

// ---------------------------------------------------------------------------
// Workspace: comunicação registrada manualmente, anexos e transferência
// ---------------------------------------------------------------------------

/** Envia pelo provedor quando o canal está conectado; senão registra manualmente (delivery "manual"). */
export async function registerWorkspaceMessageAction(input: unknown): Promise<ActionResult<MessageResult>> {
  try {
    const user = await requireSalesUser();
    const data = workspaceMessageSchema.parse(input);
    const opp = await requireOpportunityAccess(user, data.opportunityId);
    const result = await sendOrRegisterMessage(data, actorOf(user));
    revalidateSales(opp.clientId);
    return { ok: true, data: result };
  } catch (error) {
    return fail(error, "Não foi possível registrar a mensagem");
  }
}

export async function registerInternalNoteAction(input: unknown): Promise<ActionResult<{ eventId: string }>> {
  try {
    const user = await requireSalesUser();
    const data = internalNoteSchema.parse(input);
    const opp = await requireOpportunityAccess(user, data.opportunityId);
    const event = await registerInternalNote(data, actorOf(user));
    revalidateSales(opp.clientId);
    return { ok: true, data: { eventId: event.id } };
  } catch (error) {
    return fail(error, "Não foi possível salvar a nota");
  }
}

export async function registerCallAction(input: unknown): Promise<ActionResult<{ communicationId: string; eventId: string }>> {
  try {
    const user = await requireSalesUser();
    const data = registerCallSchema.parse(input);
    const opp = await requireOpportunityAccess(user, data.opportunityId);
    const result = await registerCall(data, actorOf(user));
    revalidateSales(opp.clientId);
    return { ok: true, data: result };
  } catch (error) {
    return fail(error, "Não foi possível registrar a ligação");
  }
}

export async function attachOpportunityDocumentAction(input: unknown): Promise<ActionResult<{ id: string }>> {
  try {
    const user = await requireSalesUser();
    const data = attachDocumentSchema.parse(input);
    const opp = await requireOpportunityAccess(user, data.opportunityId);
    const doc = await attachOpportunityDocument(data, actorOf(user));
    revalidateSales(opp.clientId);
    return { ok: true, data: { id: doc.id } };
  } catch (error) {
    return fail(error, "Não foi possível anexar o documento");
  }
}

/** Transferir para outro vendedor: dono ou gestores. Quem transfere perde o acesso se não for gestor. */
export async function transferOpportunityAction(input: unknown): Promise<ActionResult<{ ownerId: string; stillVisible: boolean }>> {
  try {
    const user = await requireSalesUser();
    const data = transferOpportunitySchema.parse(input);
    const current = await requireOpportunityAccess(user, data.opportunityId);
    const opp = await transferOpportunity(data, actorOf(user));
    revalidateSales(opp.clientId);
    revalidatePath("/tarefas");
    const stillVisible = user.isManager || opp.ownerId === user.id || current.originUserId === user.id;
    return { ok: true, data: { ownerId: opp.ownerId, stillVisible } };
  } catch (error) {
    return fail(error, "Não foi possível transferir a oportunidade");
  }
}

// ---------------------------------------------------------------------------
// Varredura de follow-up
// ---------------------------------------------------------------------------

export async function runFollowupSweep(): Promise<ActionResult<SweepResult>> {
  try {
    const user = await requireSalesUser();
    if (!user.isManager) return { ok: false, error: "Só gestores e administradores executam a varredura" };
    const result = await detectStalledOpportunities(actorOf(user));
    revalidateSales();
    revalidatePath("/tarefas");
    return { ok: true, data: result };
  } catch (error) {
    return fail(error, "Não foi possível executar a varredura");
  }
}

// ---------------------------------------------------------------------------
// Propostas
// ---------------------------------------------------------------------------

export async function saveProposalAction(input: unknown): Promise<ActionResult<{ id: string }>> {
  try {
    const user = await requireSalesUser();
    const data = saveProposalSchema.parse(input);
    await requireOpportunityAccess(user, data.opportunityId);
    const proposal = await saveProposal(data, actorOf(user));
    revalidateSales(proposal.clientId);
    return { ok: true, data: { id: proposal.id } };
  } catch (error) {
    return fail(error, "Não foi possível salvar a proposta");
  }
}

export async function transitionProposalAction(input: unknown): Promise<ActionResult<{ id: string; status: string; opportunityId: string }>> {
  try {
    const user = await requireSalesUser();
    const data = proposalTransitionSchema.parse(input);
    const current = await getById<{ id: string; organizationId: string; createdAt: string; updatedAt: string; opportunityId: string }>(COLLECTIONS.proposals, data.proposalId);
    if (!current) return { ok: false, error: "Proposta não encontrada" };
    await requireOpportunityAccess(user, current.opportunityId);
    const proposal = await transitionProposal(data.proposalId, data.transition, actorOf(user), data.reason);
    revalidateSales(proposal.clientId);
    return { ok: true, data: { id: proposal.id, status: proposal.status, opportunityId: proposal.opportunityId } };
  } catch (error) {
    return fail(error, "Não foi possível atualizar a proposta");
  }
}

export async function newProposalVersionAction(input: unknown): Promise<ActionResult<{ id: string }>> {
  try {
    const user = await requireSalesUser();
    const data = proposalIdSchema.parse(input);
    const current = await getById<{ id: string; organizationId: string; createdAt: string; updatedAt: string; opportunityId: string }>(COLLECTIONS.proposals, data.proposalId);
    if (!current) return { ok: false, error: "Proposta não encontrada" };
    await requireOpportunityAccess(user, current.opportunityId);
    const proposal = await newProposalVersion(data.proposalId, actorOf(user));
    revalidateSales(proposal.clientId);
    return { ok: true, data: { id: proposal.id } };
  } catch (error) {
    return fail(error, "Não foi possível gerar nova versão");
  }
}

// ---------------------------------------------------------------------------
// Visitas
// ---------------------------------------------------------------------------

async function requireVisitAccess(user: CurrentUser, visitId: string) {
  const visit = await getById<{ id: string; organizationId: string; createdAt: string; updatedAt: string; sellerId: string; createdBy?: string; clientId?: string }>(COLLECTIONS.visits, visitId);
  if (!visit) throw new Error("Visita não encontrada");
  if (!user.isManager && visit.sellerId !== user.id && visit.createdBy !== user.id) throw new Error("Você não tem permissão para alterar esta visita");
  return visit;
}

export async function createVisitAction(input: unknown): Promise<ActionResult<{ id: string }>> {
  try {
    const user = await requireSalesUser();
    const data = createVisitSchema.parse(input);
    if (!user.isManager && data.sellerId !== user.id) return { ok: false, error: "Você só pode agendar visitas para você mesmo" };
    const visit = await createVisit(data, actorOf(user));
    revalidateSales(visit.clientId);
    return { ok: true, data: { id: visit.id } };
  } catch (error) {
    return fail(error, "Não foi possível agendar a visita");
  }
}

export async function completeVisitAction(input: unknown): Promise<ActionResult<{ id: string }>> {
  try {
    const user = await requireSalesUser();
    const data = completeVisitSchema.parse(input);
    await requireVisitAccess(user, data.visitId);
    const visit = await completeVisit(data, actorOf(user));
    revalidateSales(visit.clientId);
    return { ok: true, data: { id: visit.id } };
  } catch (error) {
    return fail(error, "Não foi possível concluir a visita");
  }
}

export async function cancelVisitAction(input: unknown): Promise<ActionResult<{ id: string }>> {
  try {
    const user = await requireSalesUser();
    const data = cancelVisitSchema.parse(input);
    await requireVisitAccess(user, data.visitId);
    const visit = await cancelVisit(data, actorOf(user));
    revalidateSales(visit.clientId);
    return { ok: true, data: { id: visit.id } };
  } catch (error) {
    return fail(error, "Não foi possível cancelar a visita");
  }
}

export async function rescheduleVisitAction(input: unknown): Promise<ActionResult<{ id: string }>> {
  try {
    const user = await requireSalesUser();
    const data = rescheduleVisitSchema.parse(input);
    await requireVisitAccess(user, data.visitId);
    const visit = await rescheduleVisit(data, actorOf(user));
    revalidateSales(visit.clientId);
    return { ok: true, data: { id: visit.id } };
  } catch (error) {
    return fail(error, "Não foi possível remarcar a visita");
  }
}
