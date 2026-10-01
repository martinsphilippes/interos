"use server";
/**
 * Server Actions do módulo de Vendas. Padrão: requirePermission(chave do catálogo, src/domain/permissions/vendas.ts)
 * → validação zod → escopo do registro (assert*Access: fora do escopo = PermissionError) → serviço (regras e eventos)
 * → revalidatePath. Todas devolvem ActionResult com mensagem em português; falhas pelo tratamento único (failAction,
 * que relança redirect/notFound do Next).
 */
import { revalidatePath } from "next/cache";
import { z } from "zod";
import { failAction, requirePermission } from "@/server/auth/session";
import type { ActionResult, CurrentUser, Opportunity, UserRef } from "@/domain/types";
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
import { assertOpportunityAccess, assertProposalAccess, assertVisitAccess, opportunityInScope, opportunityScope } from "./access";
import { proposalSaveKey, proposalTransitionKey } from "./permission-keys";
import { getWonContext, type WonContext } from "./queries";
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

/** Validação: a primeira mensagem do zod (como antes); o resto pelo tratamento único (failAction). */
function fail(error: unknown, fallback: string): Failure {
  if (error instanceof z.ZodError) return { ok: false, error: zodMessage(error) };
  return failAction(error, fallback, "vendas");
}

const actorOf = (user: CurrentUser): UserRef => ({ id: user.id, name: user.name });

/** Mensagens das negações (as mesmas de antes do catálogo, quando existiam). */
const OWNER_DENIED = "Seu perfil não permite criar oportunidades para outro vendedor";
const VISIT_SELLER_DENIED = "Você só pode agendar visitas para você mesmo";
const SWEEP_DENIED = "Só gestores e administradores executam a varredura";

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
    const user = await requirePermission("vendas.oportunidades.criar");
    const data = createOpportunitySchema.parse(input);
    // Em nome de outro vendedor: exige também a chave de atribuição (catálogo: checkedIn de atribuir).
    if (data.ownerId !== user.id) await requirePermission("vendas.oportunidades.atribuir", OWNER_DENIED);
    const opp = await createOpportunity({ ...data, nextActionAt: new Date(data.nextActionAt).toISOString() }, { ...actorOf(user), departmentId: user.departmentId });
    revalidateSales(opp.clientId);
    return { ok: true, data: { id: opp.id } };
  } catch (error) {
    return fail(error, "Não foi possível criar a oportunidade");
  }
}

export async function changeOpportunityStage(input: unknown): Promise<ActionResult<{ stage: Opportunity["stage"] }>> {
  try {
    const user = await requirePermission("vendas.oportunidades.editar");
    const data = changeStageSchema.parse(input);
    await assertOpportunityAccess(user, data.opportunityId);
    const opp = await changeStage(data.opportunityId, data.stage, actorOf(user));
    revalidateSales(opp.clientId);
    return { ok: true, data: { stage: opp.stage } };
  } catch (error) {
    return fail(error, "Não foi possível mudar a etapa");
  }
}

export async function updateOpportunity(input: unknown): Promise<ActionResult<{ id: string }>> {
  try {
    const user = await requirePermission("vendas.oportunidades.editar");
    const data = updateOpportunitySchema.parse(input);
    await assertOpportunityAccess(user, data.opportunityId);
    const opp = await updateOpportunityData(data, actorOf(user));
    revalidateSales(opp.clientId);
    return { ok: true, data: { id: opp.id } };
  } catch (error) {
    return fail(error, "Não foi possível salvar a oportunidade");
  }
}

export async function scheduleOpportunityNextAction(input: unknown): Promise<ActionResult<{ id: string }>> {
  try {
    const user = await requirePermission("vendas.oportunidades.editar");
    const data = scheduleNextActionSchema.parse(input);
    await assertOpportunityAccess(user, data.opportunityId);
    const opp = await scheduleNextAction(data.opportunityId, data.nextAction, data.nextActionAt, actorOf(user));
    revalidateSales(opp.clientId);
    return { ok: true, data: { id: opp.id } };
  } catch (error) {
    return fail(error, "Não foi possível agendar a próxima ação");
  }
}

export async function registerOpportunityContactAction(input: unknown): Promise<ActionResult<{ eventId: string }>> {
  try {
    const user = await requirePermission("vendas.oportunidades.registrar");
    const data = registerContactSchema.parse(input);
    const opp = await assertOpportunityAccess(user, data.opportunityId);
    const event = await registerOpportunityContact(data, actorOf(user));
    revalidateSales(opp.clientId);
    return { ok: true, data: { eventId: event.id } };
  } catch (error) {
    return fail(error, "Não foi possível registrar o contato");
  }
}

export async function createOpportunityTaskAction(input: unknown): Promise<ActionResult<{ id: string }>> {
  try {
    const user = await requirePermission("vendas.oportunidades.criar-tarefa");
    const data = createOpportunityTaskSchema.parse(input);
    const opp = await assertOpportunityAccess(user, data.opportunityId);
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
    const user = await requirePermission("vendas.oportunidades.ganhar");
    const data = markWonSchema.parse(input);
    await assertOpportunityAccess(user, data.opportunityId);
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

/** Contexto do diálogo de ganho: contatos do cliente e proposta aceita (pré-preenchimento do fechamento). */
export async function getWonContextAction(input: unknown): Promise<ActionResult<WonContext>> {
  try {
    const user = await requirePermission("vendas.oportunidades.ganhar");
    const { opportunityId } = opportunityIdSchema.parse(input);
    await assertOpportunityAccess(user, opportunityId);
    const context = await getWonContext(opportunityId);
    if (!context) return { ok: false, error: "Oportunidade não encontrada" };
    return { ok: true, data: context };
  } catch (error) {
    return fail(error, "Não foi possível carregar os dados do fechamento");
  }
}

export async function markOpportunityLostAction(input: unknown): Promise<ActionResult<{ id: string }>> {
  try {
    const user = await requirePermission("vendas.oportunidades.perder");
    const data = markLostSchema.parse(input);
    await assertOpportunityAccess(user, data.opportunityId);
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
    const user = await requirePermission("vendas.oportunidades.reabrir");
    const data = opportunityIdSchema.parse(input);
    await assertOpportunityAccess(user, data.opportunityId);
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
    const user = await requirePermission("vendas.oportunidades.enviar");
    const data = workspaceMessageSchema.parse(input);
    const opp = await assertOpportunityAccess(user, data.opportunityId);
    const result = await sendOrRegisterMessage(data, actorOf(user));
    revalidateSales(opp.clientId);
    return { ok: true, data: result };
  } catch (error) {
    return fail(error, "Não foi possível registrar a mensagem");
  }
}

export async function registerInternalNoteAction(input: unknown): Promise<ActionResult<{ eventId: string }>> {
  try {
    const user = await requirePermission("vendas.oportunidades.registrar");
    const data = internalNoteSchema.parse(input);
    const opp = await assertOpportunityAccess(user, data.opportunityId);
    const event = await registerInternalNote(data, actorOf(user));
    revalidateSales(opp.clientId);
    return { ok: true, data: { eventId: event.id } };
  } catch (error) {
    return fail(error, "Não foi possível salvar a nota");
  }
}

export async function registerCallAction(input: unknown): Promise<ActionResult<{ communicationId: string; eventId: string }>> {
  try {
    const user = await requirePermission("vendas.oportunidades.registrar");
    const data = registerCallSchema.parse(input);
    const opp = await assertOpportunityAccess(user, data.opportunityId);
    const result = await registerCall(data, actorOf(user));
    revalidateSales(opp.clientId);
    return { ok: true, data: result };
  } catch (error) {
    return fail(error, "Não foi possível registrar a ligação");
  }
}

export async function attachOpportunityDocumentAction(input: unknown): Promise<ActionResult<{ id: string }>> {
  try {
    const user = await requirePermission("vendas.oportunidades.anexar");
    const data = attachDocumentSchema.parse(input);
    const opp = await assertOpportunityAccess(user, data.opportunityId);
    const doc = await attachOpportunityDocument(data, actorOf(user));
    revalidateSales(opp.clientId);
    return { ok: true, data: { id: doc.id } };
  } catch (error) {
    return fail(error, "Não foi possível anexar o documento");
  }
}

/**
 * Transferir para outro vendedor: exige a chave de atribuição e a oportunidade no escopo; o NOVO responsável precisa
 * ter acesso efetivo ao módulo (resolvePermissionsForUser em transferOpportunity, A28). `stillVisible` diz se quem
 * transferiu continua vendo a oportunidade no próprio escopo.
 */
export async function transferOpportunityAction(input: unknown): Promise<ActionResult<{ ownerId: string; stillVisible: boolean }>> {
  try {
    const user = await requirePermission("vendas.oportunidades.atribuir");
    const data = transferOpportunitySchema.parse(input);
    const current = await assertOpportunityAccess(user, data.opportunityId);
    const opp = await transferOpportunity(data, actorOf(user));
    revalidateSales(opp.clientId);
    revalidatePath("/tarefas");
    const stillVisible = opportunityInScope(await opportunityScope(user), { ownerId: opp.ownerId, originUserId: current.originUserId });
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
    const user = await requirePermission("vendas.central.executar-varredura", SWEEP_DENIED);
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

/** Criar (sem proposalId) ou editar rascunho (com proposalId): a chave sai do argumento (permission-keys.ts). */
export async function saveProposalAction(input: unknown): Promise<ActionResult<{ id: string }>> {
  try {
    const user = proposalSaveKey(input) === "vendas.propostas.editar" ? await requirePermission("vendas.propostas.editar") : await requirePermission("vendas.propostas.criar");
    const data = saveProposalSchema.parse(input);
    await assertOpportunityAccess(user, data.opportunityId);
    if (data.proposalId) {
      const { proposal } = await assertProposalAccess(user, data.proposalId);
      if (proposal.opportunityId !== data.opportunityId) return { ok: false, error: "A proposta não pertence a esta oportunidade" };
    }
    const proposal = await saveProposal(data, actorOf(user));
    revalidateSales(proposal.clientId);
    return { ok: true, data: { id: proposal.id } };
  } catch (error) {
    return fail(error, "Não foi possível salvar a proposta");
  }
}

export async function transitionProposalAction(input: unknown): Promise<ActionResult<{ id: string; status: string; opportunityId: string }>> {
  try {
    // enviar/visualizada/negociação → enviar; aceitar/recusar → aprovar (permission-keys.ts).
    const user = proposalTransitionKey(input) === "vendas.propostas.aprovar" ? await requirePermission("vendas.propostas.aprovar") : await requirePermission("vendas.propostas.enviar");
    const data = proposalTransitionSchema.parse(input);
    await assertProposalAccess(user, data.proposalId);
    const proposal = await transitionProposal(data.proposalId, data.transition, actorOf(user), data.reason);
    revalidateSales(proposal.clientId);
    return { ok: true, data: { id: proposal.id, status: proposal.status, opportunityId: proposal.opportunityId } };
  } catch (error) {
    return fail(error, "Não foi possível atualizar a proposta");
  }
}

export async function newProposalVersionAction(input: unknown): Promise<ActionResult<{ id: string }>> {
  try {
    const user = await requirePermission("vendas.propostas.criar");
    const data = proposalIdSchema.parse(input);
    await assertProposalAccess(user, data.proposalId);
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

export async function createVisitAction(input: unknown): Promise<ActionResult<{ id: string }>> {
  try {
    const user = await requirePermission("vendas.visitas.criar");
    const data = createVisitSchema.parse(input);
    // Para outro vendedor: exige também a chave de atribuição (catálogo: checkedIn de vendas.visitas.atribuir).
    if (data.sellerId !== user.id) await requirePermission("vendas.visitas.atribuir", VISIT_SELLER_DENIED);
    const visit = await createVisit(data, actorOf(user));
    revalidateSales(visit.clientId);
    return { ok: true, data: { id: visit.id } };
  } catch (error) {
    return fail(error, "Não foi possível agendar a visita");
  }
}

export async function completeVisitAction(input: unknown): Promise<ActionResult<{ id: string }>> {
  try {
    const user = await requirePermission("vendas.visitas.concluir");
    const data = completeVisitSchema.parse(input);
    await assertVisitAccess(user, data.visitId);
    const visit = await completeVisit(data, actorOf(user));
    revalidateSales(visit.clientId);
    return { ok: true, data: { id: visit.id } };
  } catch (error) {
    return fail(error, "Não foi possível concluir a visita");
  }
}

export async function cancelVisitAction(input: unknown): Promise<ActionResult<{ id: string }>> {
  try {
    const user = await requirePermission("vendas.visitas.cancelar");
    const data = cancelVisitSchema.parse(input);
    await assertVisitAccess(user, data.visitId);
    const visit = await cancelVisit(data, actorOf(user));
    revalidateSales(visit.clientId);
    return { ok: true, data: { id: visit.id } };
  } catch (error) {
    return fail(error, "Não foi possível cancelar a visita");
  }
}

export async function rescheduleVisitAction(input: unknown): Promise<ActionResult<{ id: string }>> {
  try {
    const user = await requirePermission("vendas.visitas.editar");
    const data = rescheduleVisitSchema.parse(input);
    await assertVisitAccess(user, data.visitId);
    const visit = await rescheduleVisit(data, actorOf(user));
    revalidateSales(visit.clientId);
    return { ok: true, data: { id: visit.id } };
  } catch (error) {
    return fail(error, "Não foi possível remarcar a visita");
  }
}
