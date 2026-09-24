"use server";
/**
 * Server Actions do Suporte. Padrão: requireUser() → permissão → validação zod → serviço (regras e
 * eventos) → revalidatePath. Todas devolvem ActionResult com mensagem em português.
 */
import { revalidatePath } from "next/cache";
import { z } from "zod";
import { requireUser } from "@/server/auth/session";
import type { ActionResult, CurrentUser, UserRef } from "@/domain/types";
import {
  addInternalNote,
  addTicketAttachment,
  assignTicket,
  closeTicket,
  createOpportunityFromTicket,
  createTicket,
  maybeRunSlaAlerts,
  registerCall,
  reopenTicket,
  replyToTicket,
  resolveTicket,
  resumeTicket,
  saveArticle,
  setWaitingClient,
  SupportError,
  updateClassification,
} from "./service";
import { getClientTicketContext, type ClientTicketContext } from "./queries";
import {
  articleSchema,
  assignSchema,
  attachmentSchema,
  callSchema,
  canEditArticles,
  canOperateSupport,
  classifySchema,
  closeSchema,
  createTicketSchema,
  noteSchema,
  reopenSchema,
  replySchema,
  resolveSchema,
  ticketIdSchema,
  ticketOpportunitySchema,
  waitingSchema,
  zodMessage,
} from "./schemas";

const actor = (user: CurrentUser): UserRef => ({ id: user.id, name: user.name });

function fail(error: unknown, fallback: string): { ok: false; error: string } {
  if (error instanceof z.ZodError) return { ok: false, error: zodMessage(error) };
  if (error instanceof SupportError) return { ok: false, error: error.message };
  console.error(`[suporte] ${fallback}`, error);
  return { ok: false, error: error instanceof Error && error.message ? `${fallback}: ${error.message}` : fallback };
}

async function requireOperator(): Promise<CurrentUser> {
  const user = await requireUser();
  if (!canOperateSupport(user)) throw new SupportError("Seu perfil não pode operar chamados de suporte");
  return user;
}

function revalidateSupport(ticketId?: string, clientId?: string) {
  revalidatePath("/suporte");
  revalidatePath("/suporte/chamados");
  revalidatePath("/suporte/sla");
  if (ticketId) revalidatePath(`/suporte/chamados/${ticketId}`);
  if (clientId) revalidatePath(`/clientes/${clientId}`);
}

// ---------------------------------------------------------------------------
// Chamados
// ---------------------------------------------------------------------------

/** Abertura de chamado: qualquer usuário autenticado (ex.: CS ou vendas pela ficha do cliente). */
export async function createTicketAction(input: unknown): Promise<ActionResult<{ id: string; number: string }>> {
  try {
    const user = await requireUser();
    const data = createTicketSchema.parse(input);
    const ticket = await createTicket(data, actor(user));
    revalidateSupport(ticket.id, ticket.clientId);
    return { ok: true, data: { id: ticket.id, number: ticket.number } };
  } catch (error) {
    return fail(error, "Não foi possível abrir o chamado");
  }
}

/** Contatos e produtos do cliente para o formulário de novo chamado. */
export async function loadClientTicketContext(clientId: unknown): Promise<ActionResult<ClientTicketContext>> {
  try {
    await requireUser();
    const id = z.string().trim().min(1, "Cliente inválido").parse(clientId);
    return { ok: true, data: await getClientTicketContext(id) };
  } catch (error) {
    return fail(error, "Não foi possível carregar os dados do cliente");
  }
}

export async function assumeTicketAction(input: unknown): Promise<ActionResult<{ id: string }>> {
  try {
    const user = await requireOperator();
    const { ticketId } = ticketIdSchema.parse(input);
    const ticket = await assignTicket(ticketId, user.id, actor(user));
    revalidateSupport(ticket.id, ticket.clientId);
    return { ok: true, data: { id: ticket.id } };
  } catch (error) {
    return fail(error, "Não foi possível assumir o chamado");
  }
}

export async function assignTicketAction(input: unknown): Promise<ActionResult<{ id: string }>> {
  try {
    const user = await requireOperator();
    const data = assignSchema.parse(input);
    const ticket = await assignTicket(data.ticketId, data.assigneeId, actor(user));
    revalidateSupport(ticket.id, ticket.clientId);
    return { ok: true, data: { id: ticket.id } };
  } catch (error) {
    return fail(error, "Não foi possível atribuir o chamado");
  }
}

export async function replyTicketAction(input: unknown): Promise<ActionResult<{ id: string }>> {
  try {
    const user = await requireOperator();
    const data = replySchema.parse(input);
    const interaction = await replyToTicket(data.ticketId, data.channel, data.body, actor(user));
    revalidateSupport(data.ticketId, interaction.clientId);
    return { ok: true, data: { id: interaction.id } };
  } catch (error) {
    return fail(error, "Não foi possível enviar a resposta");
  }
}

export async function addNoteAction(input: unknown): Promise<ActionResult<{ id: string }>> {
  try {
    const user = await requireOperator();
    const data = noteSchema.parse(input);
    const interaction = await addInternalNote(data.ticketId, data.body, actor(user));
    revalidatePath(`/suporte/chamados/${data.ticketId}`);
    return { ok: true, data: { id: interaction.id } };
  } catch (error) {
    return fail(error, "Não foi possível registrar a nota");
  }
}

export async function registerCallAction(input: unknown): Promise<ActionResult<{ id: string }>> {
  try {
    const user = await requireOperator();
    const data = callSchema.parse(input);
    const interaction = await registerCall(data.ticketId, { direction: data.direction, durationMinutes: data.durationMinutes, summary: data.summary }, actor(user));
    revalidateSupport(data.ticketId, interaction.clientId);
    return { ok: true, data: { id: interaction.id } };
  } catch (error) {
    return fail(error, "Não foi possível registrar a ligação");
  }
}

export async function addAttachmentAction(input: unknown): Promise<ActionResult<{ id: string }>> {
  try {
    const user = await requireOperator();
    const data = attachmentSchema.parse(input);
    const id = await addTicketAttachment(data.ticketId, { name: data.name, url: data.url }, actor(user));
    revalidatePath(`/suporte/chamados/${data.ticketId}`);
    return { ok: true, data: { id } };
  } catch (error) {
    return fail(error, "Não foi possível adicionar o anexo");
  }
}

export async function classifyTicketAction(input: unknown): Promise<ActionResult<{ slaRestarted: boolean }>> {
  try {
    const user = await requireOperator();
    const data = classifySchema.parse(input);
    const result = await updateClassification(data.ticketId, { productId: data.productId, category: data.category, priority: data.priority, queue: data.queue }, actor(user));
    revalidateSupport(data.ticketId);
    return { ok: true, data: result };
  } catch (error) {
    return fail(error, "Não foi possível salvar a classificação");
  }
}

export async function waitingClientAction(input: unknown): Promise<ActionResult> {
  try {
    const user = await requireOperator();
    const data = waitingSchema.parse(input);
    await setWaitingClient(data.ticketId, data.reason, actor(user));
    revalidateSupport(data.ticketId);
    return { ok: true, data: undefined };
  } catch (error) {
    return fail(error, "Não foi possível pausar o chamado");
  }
}

export async function resumeTicketAction(input: unknown): Promise<ActionResult> {
  try {
    const user = await requireOperator();
    const { ticketId } = ticketIdSchema.parse(input);
    await resumeTicket(ticketId, actor(user));
    revalidateSupport(ticketId);
    return { ok: true, data: undefined };
  } catch (error) {
    return fail(error, "Não foi possível retomar o chamado");
  }
}

export async function resolveTicketAction(input: unknown): Promise<ActionResult<{ csatLink: string }>> {
  try {
    const user = await requireOperator();
    const { ticketId, ...data } = resolveSchema.parse(input);
    const result = await resolveTicket(ticketId, data, actor(user));
    revalidateSupport(ticketId);
    return { ok: true, data: result };
  } catch (error) {
    return fail(error, "Não foi possível resolver o chamado");
  }
}

export async function closeTicketAction(input: unknown): Promise<ActionResult> {
  try {
    const user = await requireOperator();
    const data = closeSchema.parse(input);
    await closeTicket(data.ticketId, actor(user), data.note);
    revalidateSupport(data.ticketId);
    return { ok: true, data: undefined };
  } catch (error) {
    return fail(error, "Não foi possível fechar o chamado");
  }
}

export async function reopenTicketAction(input: unknown): Promise<ActionResult<{ id: string; number: string }>> {
  try {
    const user = await requireUser();
    const data = reopenSchema.parse(input);
    const ticket = await reopenTicket(data.ticketId, data.reason, actor(user));
    revalidateSupport(data.ticketId, ticket.clientId);
    revalidatePath(`/suporte/chamados/${ticket.id}`);
    return { ok: true, data: { id: ticket.id, number: ticket.number } };
  } catch (error) {
    return fail(error, "Não foi possível reabrir o chamado");
  }
}

export async function createTicketOpportunityAction(input: unknown): Promise<ActionResult<{ id: string }>> {
  try {
    const user = await requireOperator();
    const data = ticketOpportunitySchema.parse(input);
    const opp = await createOpportunityFromTicket(data.ticketId, { productId: data.productId, need: data.need, notes: data.notes }, actor(user));
    revalidateSupport(data.ticketId, opp.clientId);
    revalidatePath("/vendas/oportunidades");
    return { ok: true, data: { id: opp.id } };
  } catch (error) {
    return fail(error, "Não foi possível gerar a oportunidade");
  }
}

/** Força a varredura de alertas de SLA (respeita o intervalo de 10 minutos). */
export async function runSlaAlertsAction(): Promise<ActionResult<{ ran: boolean; atRisk: number; breached: number }>> {
  try {
    await requireOperator();
    const result = await maybeRunSlaAlerts();
    if (result) revalidatePath("/suporte");
    return { ok: true, data: { ran: Boolean(result), atRisk: result?.atRisk ?? 0, breached: result?.breached ?? 0 } };
  } catch (error) {
    return fail(error, "Não foi possível verificar os SLAs");
  }
}

// ---------------------------------------------------------------------------
// Base de conhecimento
// ---------------------------------------------------------------------------

export async function saveArticleAction(input: unknown): Promise<ActionResult<{ id: string }>> {
  try {
    const user = await requireUser();
    if (!canEditArticles(user)) return { ok: false, error: "Só suporte, gestores e administradores editam a base de conhecimento" };
    const data = articleSchema.parse(input);
    const article = await saveArticle(data, actor(user));
    revalidatePath("/suporte/base-de-conhecimento");
    revalidatePath(`/suporte/base-de-conhecimento/${article.id}`);
    if (data.sourceTicketId) revalidatePath(`/suporte/chamados/${data.sourceTicketId}`);
    return { ok: true, data: { id: article.id } };
  } catch (error) {
    return fail(error, "Não foi possível salvar o artigo");
  }
}
