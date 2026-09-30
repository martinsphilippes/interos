"use server";
/**
 * Server Actions do Suporte. Padrão: requirePermission(chave do catálogo src/domain/permissions/suporte.ts) →
 * validação zod → escopo do chamado (A29: atendente dentro do escopo ou chamado na fila) → serviço (regras e
 * eventos) → revalidatePath. Falhas pelo tratamento único (failAction: relança redirect/notFound, mostra
 * PermissionError/SupportError e esconde erros técnicos); validação com a primeira mensagem do zod, como antes.
 */
import { revalidatePath } from "next/cache";
import { z } from "zod";
import { failAction, requirePermission } from "@/server/auth/session";
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
  transferTicket,
  updateClassification,
  voteArticle,
  type ResolveResult,
} from "./service";
import { getClientTicketContext, type ClientTicketContext } from "./queries";
import {
  articleSchema,
  assignSchema,
  attachmentSchema,
  callSchema,
  classifySchema,
  closeSchema,
  createTicketSchema,
  noteSchema,
  reopenSchema,
  replySchema,
  resolveSchema,
  ticketIdSchema,
  ticketOpportunitySchema,
  transferSchema,
  articleVoteSchema,
  waitingSchema,
  zodMessage,
} from "./schemas";
import { assertTicketAccess } from "./access";

const actor = (user: CurrentUser): UserRef => ({ id: user.id, name: user.name });

function fail(error: unknown, fallback: string): { ok: false; error: string } {
  if (error instanceof z.ZodError) return { ok: false, error: zodMessage(error) };
  return failAction(error, fallback, "suporte");
}

/** Mensagem de negação das operações de chamado (a mesma de antes do catálogo). */
const OPERATOR_DENIED = "Seu perfil não pode operar chamados de suporte";
/** Mensagem de negação da edição da base (a mesma de antes do catálogo). */
const ARTICLES_DENIED = "Só suporte, gestores e administradores editam a base de conhecimento";

/** Artigo com id = edição; sem id = criação (a chave depende do argumento, antes da validação). */
function articleIdOf(input: unknown): string | undefined {
  const id = input && typeof input === "object" ? (input as { id?: unknown }).id : undefined;
  return typeof id === "string" && id.trim() ? id.trim() : undefined;
}

function revalidateSupport(ticketId?: string, clientId?: string) {
  revalidatePath("/suporte");
  revalidatePath("/suporte/chamados");
  if (ticketId) revalidatePath(`/suporte/chamados/${ticketId}`);
  if (clientId) revalidatePath(`/clientes/${clientId}`);
}

// ---------------------------------------------------------------------------
// Chamados
// ---------------------------------------------------------------------------

/** Abertura de chamado: quem tem suporte.chamados.criar (ex.: CS pela ficha do cliente). */
export async function createTicketAction(input: unknown): Promise<ActionResult<{ id: string; number: string }>> {
  try {
    const user = await requirePermission("suporte.chamados.criar");
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
    await requirePermission("suporte.chamados.criar");
    const id = z.string().trim().min(1, "Cliente inválido").parse(clientId);
    return { ok: true, data: await getClientTicketContext(id) };
  } catch (error) {
    return fail(error, "Não foi possível carregar os dados do cliente");
  }
}

export async function assumeTicketAction(input: unknown): Promise<ActionResult<{ id: string }>> {
  try {
    const user = await requirePermission("suporte.chamados.assumir", OPERATOR_DENIED);
    const { ticketId } = ticketIdSchema.parse(input);
    await assertTicketAccess(user, ticketId);
    const ticket = await assignTicket(ticketId, user.id, actor(user));
    revalidateSupport(ticket.id, ticket.clientId);
    return { ok: true, data: { id: ticket.id } };
  } catch (error) {
    return fail(error, "Não foi possível assumir o chamado");
  }
}

export async function assignTicketAction(input: unknown): Promise<ActionResult<{ id: string }>> {
  try {
    const user = await requirePermission("suporte.chamados.atribuir", OPERATOR_DENIED);
    const data = assignSchema.parse(input);
    await assertTicketAccess(user, data.ticketId);
    const ticket = await assignTicket(data.ticketId, data.assigneeId, actor(user));
    revalidateSupport(ticket.id, ticket.clientId);
    return { ok: true, data: { id: ticket.id } };
  } catch (error) {
    return fail(error, "Não foi possível atribuir o chamado");
  }
}

/** Resposta ao cliente. `manual` = registrada sem envio (integração não conectada); `to` = destinatário para wa.me/mailto. */
export async function replyTicketAction(input: unknown): Promise<ActionResult<{ id: string; manual: boolean; to?: string }>> {
  try {
    const user = await requirePermission("suporte.chamados.enviar", OPERATOR_DENIED);
    const data = replySchema.parse(input);
    await assertTicketAccess(user, data.ticketId);
    const result = await replyToTicket(data.ticketId, data.channel, data.body, actor(user));
    revalidateSupport(data.ticketId, result.interaction.clientId);
    return { ok: true, data: { id: result.interaction.id, manual: result.manual, to: result.to } };
  } catch (error) {
    return fail(error, "Não foi possível enviar a resposta");
  }
}

export async function addNoteAction(input: unknown): Promise<ActionResult<{ id: string }>> {
  try {
    const user = await requirePermission("suporte.chamados.registrar", OPERATOR_DENIED);
    const data = noteSchema.parse(input);
    await assertTicketAccess(user, data.ticketId);
    const interaction = await addInternalNote(data.ticketId, data.body, actor(user));
    revalidatePath("/suporte");
    revalidatePath(`/suporte/chamados/${data.ticketId}`);
    return { ok: true, data: { id: interaction.id } };
  } catch (error) {
    return fail(error, "Não foi possível registrar a nota");
  }
}

export async function registerCallAction(input: unknown): Promise<ActionResult<{ id: string }>> {
  try {
    const user = await requirePermission("suporte.chamados.registrar", OPERATOR_DENIED);
    const data = callSchema.parse(input);
    await assertTicketAccess(user, data.ticketId);
    const interaction = await registerCall(data.ticketId, { direction: data.direction, durationMinutes: data.durationMinutes, summary: data.summary }, actor(user));
    revalidateSupport(data.ticketId, interaction.clientId);
    return { ok: true, data: { id: interaction.id } };
  } catch (error) {
    return fail(error, "Não foi possível registrar a ligação");
  }
}

export async function addAttachmentAction(input: unknown): Promise<ActionResult<{ id: string }>> {
  try {
    const user = await requirePermission("suporte.chamados.anexar", OPERATOR_DENIED);
    const data = attachmentSchema.parse(input);
    await assertTicketAccess(user, data.ticketId);
    const id = await addTicketAttachment(data.ticketId, { name: data.name, url: data.url }, actor(user));
    revalidatePath("/suporte");
    revalidatePath(`/suporte/chamados/${data.ticketId}`);
    return { ok: true, data: { id } };
  } catch (error) {
    return fail(error, "Não foi possível adicionar o anexo");
  }
}

/** Transferência para outro atendente e/ou fila, com nota (interação de status + notificação). */
export async function transferTicketAction(input: unknown): Promise<ActionResult<{ id: string }>> {
  try {
    const user = await requirePermission("suporte.chamados.atribuir", OPERATOR_DENIED);
    const data = transferSchema.parse(input);
    await assertTicketAccess(user, data.ticketId);
    const ticket = await transferTicket(data.ticketId, { assigneeId: data.assigneeId, queue: data.queue, note: data.note }, actor(user));
    revalidateSupport(ticket.id, ticket.clientId);
    return { ok: true, data: { id: ticket.id } };
  } catch (error) {
    return fail(error, "Não foi possível transferir o chamado");
  }
}

export async function classifyTicketAction(input: unknown): Promise<ActionResult<{ slaRestarted: boolean }>> {
  try {
    const user = await requirePermission("suporte.chamados.classificar", OPERATOR_DENIED);
    const data = classifySchema.parse(input);
    await assertTicketAccess(user, data.ticketId);
    const result = await updateClassification(data.ticketId, { productId: data.productId, category: data.category, priority: data.priority, queue: data.queue }, actor(user));
    revalidateSupport(data.ticketId);
    return { ok: true, data: result };
  } catch (error) {
    return fail(error, "Não foi possível salvar a classificação");
  }
}

export async function waitingClientAction(input: unknown): Promise<ActionResult> {
  try {
    const user = await requirePermission("suporte.chamados.pausar", OPERATOR_DENIED);
    const data = waitingSchema.parse(input);
    await assertTicketAccess(user, data.ticketId);
    await setWaitingClient(data.ticketId, data.reason, actor(user));
    revalidateSupport(data.ticketId);
    return { ok: true, data: undefined };
  } catch (error) {
    return fail(error, "Não foi possível pausar o chamado");
  }
}

export async function resumeTicketAction(input: unknown): Promise<ActionResult> {
  try {
    const user = await requirePermission("suporte.chamados.pausar", OPERATOR_DENIED);
    const { ticketId } = ticketIdSchema.parse(input);
    await assertTicketAccess(user, ticketId);
    await resumeTicket(ticketId, actor(user));
    revalidateSupport(ticketId);
    return { ok: true, data: undefined };
  } catch (error) {
    return fail(error, "Não foi possível retomar o chamado");
  }
}

export async function resolveTicketAction(input: unknown): Promise<ActionResult<ResolveResult>> {
  try {
    const user = await requirePermission("suporte.chamados.concluir", OPERATOR_DENIED);
    const { ticketId, ...data } = resolveSchema.parse(input);
    await assertTicketAccess(user, ticketId);
    const result = await resolveTicket(ticketId, data, actor(user));
    revalidateSupport(ticketId);
    return { ok: true, data: result };
  } catch (error) {
    return fail(error, "Não foi possível resolver o chamado");
  }
}

export async function closeTicketAction(input: unknown): Promise<ActionResult> {
  try {
    const user = await requirePermission("suporte.chamados.fechar", OPERATOR_DENIED);
    const data = closeSchema.parse(input);
    await assertTicketAccess(user, data.ticketId);
    await closeTicket(data.ticketId, actor(user), data.note);
    revalidateSupport(data.ticketId);
    return { ok: true, data: undefined };
  } catch (error) {
    return fail(error, "Não foi possível fechar o chamado");
  }
}

export async function reopenTicketAction(input: unknown): Promise<ActionResult<{ id: string; number: string }>> {
  try {
    const user = await requirePermission("suporte.chamados.reabrir");
    const data = reopenSchema.parse(input);
    await assertTicketAccess(user, data.ticketId);
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
    const user = await requirePermission("suporte.chamados.criar-oportunidade", OPERATOR_DENIED);
    const data = ticketOpportunitySchema.parse(input);
    await assertTicketAccess(user, data.ticketId);
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
    await requirePermission("suporte.central.executar-varredura", OPERATOR_DENIED);
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
    // Criar e editar são ações distintas no catálogo: a chave depende de o artigo já existir.
    const user = articleIdOf(input) ? await requirePermission("suporte.base-de-conhecimento.editar", ARTICLES_DENIED) : await requirePermission("suporte.base-de-conhecimento.criar", ARTICLES_DENIED);
    const data = articleSchema.parse(input);
    if (data.sourceTicketId) await assertTicketAccess(user, data.sourceTicketId);
    const article = await saveArticle(data, actor(user));
    revalidatePath("/suporte/base-de-conhecimento");
    revalidatePath(`/suporte/base-de-conhecimento/${article.id}`);
    if (data.sourceTicketId) revalidatePath(`/suporte/chamados/${data.sourceTicketId}`);
    return { ok: true, data: { id: article.id } };
  } catch (error) {
    return fail(error, "Não foi possível salvar o artigo");
  }
}

/** "Este artigo foi útil?" — quem vê a Base de Conhecimento pode votar (suporte.base-de-conhecimento.avaliar). */
export async function voteArticleAction(input: unknown): Promise<ActionResult> {
  try {
    const user = await requirePermission("suporte.base-de-conhecimento.avaliar");
    const data = articleVoteSchema.parse(input);
    await voteArticle(data.articleId, data.helpful, actor(user));
    revalidatePath(`/suporte/base-de-conhecimento/${data.articleId}`);
    return { ok: true, data: undefined };
  } catch (error) {
    return fail(error, "Não foi possível registrar o voto");
  }
}
