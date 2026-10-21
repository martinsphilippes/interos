"use server";
/**
 * Server Actions da Central de Atendimento. Padrão: requirePermission (catálogo src/domain/permissions/comunicacao.ts)
 * → validação zod → escopo da conversa (fora do escopo = não encontrada) → serviço → revalidatePath. Falhas pelo
 * tratamento único (failAction).
 */
import { revalidatePath } from "next/cache";
import { z } from "zod";
import { can, failAction, requirePermission } from "@/server/auth/session";
import { resolveDataScope, scopeAllows } from "@/server/auth/scope";
import { BusinessError, PermissionError } from "@/server/auth/errors";
import { getById, list } from "@/server/db";
import { COLLECTIONS, type ActionResult, type Client, type Contact, type Conversation, type CurrentUser, type Lead, type UserRef } from "@/domain/types";
import { emailIdentity, phoneIdentity } from "@/domain/phone";
import {
  addConversationNote,
  assignConversation,
  distributeWaitingSafely,
  assumeConversation,
  closeConversation,
  linkConversationIdentity,
  sendConversationMessage,
  sendConversationTemplate,
  startConversation,
  reopenConversation,
  transferConversation,
} from "./service";
import { identityCandidates, type IdentityCandidate } from "./identity";
import { loadConversationInScope } from "./queries";
import { getHistoryForExport, historyConversationInScope } from "./history";
import { formatDurationShort, toCsv } from "@/domain/conversation-history";
import { saveQueue, saveUserCentral } from "./queues";
import { saveTemplate, syncTemplatesFromMeta } from "./templates";
import { countQuickReplyUse, saveQuickReply } from "./quick-replies";
import { saveAutoMessages } from "./auto-messages";
import {
  assignSchema,
  closeSchema,
  conversationIdSchema,
  historyFiltersSchema,
  linkIdentitySchema,
  noteSchema,
  saveAutoMessagesSchema,
  saveQueueSchema,
  saveUserCentralSchema,
  saveQuickReplySchema,
  saveTemplateSchema,
  searchTargetsSchema,
  sendTemplateSchema,
  syncTemplatesSchema,
  type ConversationTarget,
  sendMessageSchema,
  startSchema,
  transferSchema,
} from "./schemas";

const actor = (user: CurrentUser): UserRef => ({ id: user.id, name: user.name });

function fail(error: unknown, fallback: string): { ok: false; error: string } {
  if (error instanceof z.ZodError) return { ok: false, error: error.issues[0]?.message ?? "Dados inválidos" };
  return failAction(error, fallback, "comunicacao");
}

/** Leads que a pessoa pode ver (escopo da tela de Leads do Marketing); sem a tela, nenhum. */
async function leadVisibility(user: CurrentUser): Promise<(lead: Pick<Lead, "ownerId">) => boolean> {
  if (!can(user, "marketing.leads.ver")) return () => false;
  const scope = await resolveDataScope(user, "marketing.leads");
  return (lead) => scopeAllows(scope, [lead.ownerId]);
}

async function assertLeadVisible(user: CurrentUser, leadId: string | undefined): Promise<void> {
  const lead = leadId ? await getById<Lead>(COLLECTIONS.leads, leadId) : null;
  if (!lead || !(await leadVisibility(user))(lead)) throw new BusinessError("Lead não encontrado");
}

async function assertConversationAccess(user: CurrentUser, conversationId: string) {
  const c = await loadConversationInScope(user, conversationId);
  if (!c) throw new BusinessError("Conversa não encontrada");
  return c;
}

function revalidateCentral(clientId?: string) {
  revalidatePath("/comunicacao");
  revalidatePath("/marketing/caixa-de-entrada");
  if (clientId) revalidatePath(`/clientes/${clientId}`);
}

// ---------------------------------------------------------------------------
// Operador
// ---------------------------------------------------------------------------

export async function assumeConversationAction(input: unknown): Promise<ActionResult<{ id: string }>> {
  try {
    const user = await requirePermission("comunicacao.central.atender");
    const data = conversationIdSchema.parse(input);
    const c = await assertConversationAccess(user, data.conversationId);
    // Tirar de outra pessoa é distribuir (gestor).
    if (c.assigneeId && c.assigneeId !== user.id && !can(user, "comunicacao.central.distribuir")) throw new PermissionError("Esta conversa já está com outra pessoa");
    await assumeConversation(c.id, actor(user));
    revalidateCentral(c.clientId);
    return { ok: true, data: { id: c.id } };
  } catch (error) {
    return fail(error, "Não foi possível assumir a conversa");
  }
}

export async function sendConversationMessageAction(input: unknown): Promise<ActionResult<{ delivery: string; manualUrl: string | null; error?: string }>> {
  try {
    const user = await requirePermission("comunicacao.central.atender");
    const data = sendMessageSchema.parse(input);
    const c = await assertConversationAccess(user, data.conversationId);
    if (c.assigneeId && c.assigneeId !== user.id && !can(user, "comunicacao.central.distribuir")) throw new PermissionError("Esta conversa está com outra pessoa: peça a transferência");
    const result = await sendConversationMessage(c.id, { body: data.body, manual: data.manual }, actor(user));
    if (data.quickReplyId && (result.delivery === "enviada" || result.delivery === "manual")) await countQuickReplyUse(data.quickReplyId);
    revalidateCentral(c.clientId);
    if (result.delivery === "falha" || result.delivery === "nao_enviada") return { ok: false, error: result.error ?? "A mensagem não saiu" };
    return { ok: true, data: { delivery: result.delivery, manualUrl: result.manualUrl } };
  } catch (error) {
    return fail(error, "Não foi possível enviar a mensagem");
  }
}

export async function addConversationNoteAction(input: unknown): Promise<ActionResult<{ id: string }>> {
  try {
    const user = await requirePermission("comunicacao.central.atender");
    const data = noteSchema.parse(input);
    const c = await assertConversationAccess(user, data.conversationId);
    const note = await addConversationNote(c.id, data.body, actor(user));
    revalidateCentral();
    return { ok: true, data: { id: note.id } };
  } catch (error) {
    return fail(error, "Não foi possível salvar a nota");
  }
}

export async function transferConversationAction(input: unknown): Promise<ActionResult<{ id: string }>> {
  try {
    const user = await requirePermission("comunicacao.central.transferir");
    const data = transferSchema.parse(input);
    const c = await assertConversationAccess(user, data.conversationId);
    await transferConversation(c.id, { toUserId: data.toUserId, toQueueId: data.toQueueId, note: data.note }, actor(user));
    revalidateCentral(c.clientId);
    return { ok: true, data: { id: c.id } };
  } catch (error) {
    return fail(error, "Não foi possível transferir a conversa");
  }
}

export async function closeConversationAction(input: unknown): Promise<ActionResult<{ id: string; ticketId?: string }>> {
  try {
    const user = await requirePermission("comunicacao.central.encerrar");
    const data = closeSchema.parse(input);
    // Abrir chamado com o resumo exige também a chave de criar chamado (checkedIn do catálogo).
    if (data.ticket === "novo") await requirePermission("suporte.chamados.criar");
    const c = await assertConversationAccess(user, data.conversationId);
    const result = await closeConversation(c.id, { reason: data.reason, summary: data.summary, ticket: data.ticket, ticketId: data.ticketId, sendClosingMessage: data.sendClosingMessage }, actor(user));
    revalidateCentral(c.clientId);
    if (result.ticketId) revalidatePath("/suporte");
    return { ok: true, data: { id: c.id, ticketId: result.ticketId } };
  } catch (error) {
    return fail(error, "Não foi possível encerrar o atendimento");
  }
}

export async function linkConversationIdentityAction(input: unknown): Promise<ActionResult<{ id: string }>> {
  try {
    const user = await requirePermission("comunicacao.central.identificar");
    const data = linkIdentitySchema.parse(input);
    if (data.kind === "novo_lead") await requirePermission("marketing.leads.criar");
    const c = await assertConversationAccess(user, data.conversationId);
    if (data.kind === "lead") await assertLeadVisible(user, data.id);
    const next = await linkConversationIdentity(c.id, { kind: data.kind, id: data.id, name: data.name, fixPhone: data.fixPhone }, actor(user));
    revalidateCentral(next.clientId);
    revalidatePath("/marketing/leads");
    return { ok: true, data: { id: c.id } };
  } catch (error) {
    return fail(error, "Não foi possível identificar o contato");
  }
}

export async function assignConversationAction(input: unknown): Promise<ActionResult<{ id: string }>> {
  try {
    const user = await requirePermission("comunicacao.central.distribuir");
    const data = assignSchema.parse(input);
    const c = await assertConversationAccess(user, data.conversationId);
    await assignConversation(c, data.assigneeId, actor(user));
    revalidateCentral(c.clientId);
    return { ok: true, data: { id: c.id } };
  } catch (error) {
    return fail(error, "Não foi possível atribuir a conversa");
  }
}

export async function startConversationAction(input: unknown): Promise<ActionResult<{ id: string; delivery: string; manualUrl: string | null }>> {
  try {
    const user = await requirePermission("comunicacao.central.iniciar");
    const data = startSchema.parse(input);
    if (data.leadId) await assertLeadVisible(user, data.leadId);
    const { conversation, result } = await startConversation(data, actor(user));
    revalidateCentral(conversation.clientId);
    if (result.delivery === "falha" || result.delivery === "nao_enviada") return { ok: false, error: result.error ?? "A mensagem não saiu" };
    return { ok: true, data: { id: conversation.id, delivery: result.delivery, manualUrl: result.manualUrl } };
  } catch (error) {
    return fail(error, "Não foi possível iniciar o atendimento");
  }
}

export async function sendConversationTemplateAction(input: unknown): Promise<ActionResult<{ delivery: string; manualUrl: string | null }>> {
  try {
    const user = await requirePermission("comunicacao.central.atender");
    const data = sendTemplateSchema.parse(input);
    const c = await assertConversationAccess(user, data.conversationId);
    if (c.assigneeId && c.assigneeId !== user.id && !can(user, "comunicacao.central.distribuir")) throw new PermissionError("Esta conversa está com outra pessoa: peça a transferência");
    const result = await sendConversationTemplate(c.id, data.templateId, actor(user));
    revalidateCentral(c.clientId);
    if (result.delivery === "falha" || result.delivery === "nao_enviada") return { ok: false, error: result.error ?? "O modelo não saiu" };
    return { ok: true, data: { delivery: result.delivery, manualUrl: result.manualUrl } };
  } catch (error) {
    return fail(error, "Não foi possível enviar o modelo");
  }
}

// ---------------------------------------------------------------------------
// Leituras chamadas pela tela (viewGuards da tela comunicacao.central)
// ---------------------------------------------------------------------------

export async function identityCandidatesAction(input: unknown): Promise<ActionResult<IdentityCandidate[]>> {
  try {
    const user = await requirePermission("comunicacao.central.ver");
    const data = conversationIdSchema.parse(input);
    const c = await assertConversationAccess(user, data.conversationId);
    const [candidates, seesLead, leads] = await Promise.all([identityCandidates(c.channel, c.address, c.displayName), leadVisibility(user), list<Lead>(COLLECTIONS.leads)]);
    const leadById = new Map(leads.map((l) => [l.id, l]));
    // Leads fora do escopo da pessoa não aparecem nas sugestões.
    return { ok: true, data: candidates.filter((x) => x.kind !== "lead" || (leadById.has(x.id) && seesLead(leadById.get(x.id)!))) };
  } catch (error) {
    return fail(error, "Não foi possível buscar sugestões");
  }
}

/** Busca de quem atender em «Novo atendimento»: contatos, clientes e leads por nome, telefone ou e-mail. */
export async function searchConversationTargetsAction(input: unknown): Promise<ActionResult<ConversationTarget[]>> {
  try {
    const user = await requirePermission("comunicacao.central.ver");
    const { q } = searchTargetsSchema.parse(input);
    const seesLead = await leadVisibility(user);
    const term = q.toLowerCase();
    const phone = phoneIdentity(q);
    const email = emailIdentity(q);
    const [contacts, clients, leads] = await Promise.all([list<Contact>(COLLECTIONS.contacts), list<Client>(COLLECTIONS.clients), list<Lead>(COLLECTIONS.leads)]);
    const clientById = new Map(clients.map((c) => [c.id, c]));
    const hit = (name: string | undefined, phones: (string | undefined)[], mail: string | undefined) =>
      Boolean(name?.toLowerCase().includes(term)) || (phone.length >= 8 && phones.some((p) => phoneIdentity(p).endsWith(phone.slice(-8)))) || (Boolean(email) && emailIdentity(mail) === email);
    const out: ConversationTarget[] = [];
    for (const c of contacts) {
      const client = clientById.get(c.clientId);
      if (client && hit(c.name, [c.whatsapp, c.phone], c.email)) out.push({ kind: "contato", id: c.id, clientId: c.clientId, name: c.name, company: client.tradeName, whatsapp: c.whatsapp ?? c.phone, email: c.email });
    }
    for (const c of clients) {
      if (c.status !== "cancelado" && hit(c.tradeName, [c.whatsapp, c.phone], c.email)) out.push({ kind: "cliente", id: c.id, clientId: c.id, name: c.tradeName, whatsapp: c.whatsapp ?? c.phone, email: c.email });
    }
    for (const l of leads) {
      if (l.status !== "desqualificado" && !l.duplicateOfId && seesLead(l) && hit(l.name, [l.phone], l.email)) out.push({ kind: "lead", id: l.id, clientId: l.clientId, name: l.name, company: l.company, whatsapp: l.phone, email: l.email });
    }
    return { ok: true, data: out.slice(0, 12) };
  } catch (error) {
    return fail(error, "Não foi possível buscar");
  }
}

// ---------------------------------------------------------------------------
// Filas (tela Canais e filas)
// ---------------------------------------------------------------------------

export async function saveQueueAction(input: unknown): Promise<ActionResult<{ id: string }>> {
  try {
    await requirePermission("comunicacao.canais.filas.editar");
    const data = saveQueueSchema.parse(input);
    const queue = await saveQueue({ ...data, slaRuleKey: data.slaRuleKey, overflowQueueId: data.overflowQueueId });
    revalidatePath("/comunicacao");
    revalidatePath("/comunicacao/canais");
    return { ok: true, data: { id: queue.id } };
  } catch (error) {
    return fail(error, "Não foi possível salvar a fila");
  }
}

// ---------------------------------------------------------------------------
// Modelos, respostas rápidas e mensagens automáticas (tela Canais e filas)
// ---------------------------------------------------------------------------

export async function saveTemplateAction(input: unknown): Promise<ActionResult<{ id: string; sentToMeta: boolean; error?: string }>> {
  try {
    await requirePermission("comunicacao.canais.modelos.editar");
    const data = saveTemplateSchema.parse(input);
    const r = await saveTemplate(data);
    revalidatePath("/comunicacao/canais");
    return { ok: true, data: { id: r.template.id, sentToMeta: r.sentToMeta, error: r.error } };
  } catch (error) {
    return fail(error, "Não foi possível salvar o modelo");
  }
}

export async function syncTemplatesAction(input: unknown): Promise<ActionResult<{ created: number; updated: number; total: number }>> {
  try {
    await requirePermission("comunicacao.canais.modelos.editar");
    syncTemplatesSchema.parse(input ?? {});
    const r = await syncTemplatesFromMeta();
    if (!r.ok) return { ok: false, error: r.error ?? "Não foi possível ler os modelos da Meta" };
    revalidatePath("/comunicacao/canais");
    return { ok: true, data: { created: r.created, updated: r.updated, total: r.total } };
  } catch (error) {
    return fail(error, "Não foi possível sincronizar os modelos");
  }
}

export async function saveQuickReplyAction(input: unknown): Promise<ActionResult<{ id: string }>> {
  try {
    await requirePermission("comunicacao.canais.respostas.editar");
    const data = saveQuickReplySchema.parse(input);
    const reply = await saveQuickReply(data);
    revalidatePath("/comunicacao/canais");
    revalidatePath("/comunicacao");
    return { ok: true, data: { id: reply.id } };
  } catch (error) {
    return fail(error, "Não foi possível salvar a resposta rápida");
  }
}

export async function saveAutoMessagesAction(input: unknown): Promise<ActionResult<{ saved: true }>> {
  try {
    const user = await requirePermission("comunicacao.canais.automaticas.editar");
    const data = saveAutoMessagesSchema.parse(input);
    await saveAutoMessages(data, user.id);
    revalidatePath("/comunicacao/canais");
    return { ok: true, data: { saved: true } };
  } catch (error) {
    return fail(error, "Não foi possível salvar as mensagens automáticas");
  }
}

// ---------------------------------------------------------------------------
// Histórico de atendimentos
// ---------------------------------------------------------------------------

export async function reopenConversationAction(input: unknown): Promise<ActionResult<{ id: string; assigned: boolean }>> {
  try {
    const user = await requirePermission("comunicacao.historico.reabrir");
    const { conversationId } = conversationIdSchema.parse(input);
    const c = await getById<Conversation>(COLLECTIONS.conversations, conversationId);
    if (!c || !(await historyConversationInScope(user, c))) throw new BusinessError("Conversa não encontrada");
    const next = await reopenConversation(c.id, actor(user));
    revalidateCentral(c.clientId);
    revalidatePath("/comunicacao/historico");
    return { ok: true, data: { id: next.id, assigned: Boolean(next.assigneeId) } };
  } catch (error) {
    return fail(error, "Não foi possível reabrir o atendimento");
  }
}

const CHANNEL_NAME = { whatsapp: "WhatsApp", email: "E-mail" } as const;

export async function exportHistoryAction(input: unknown): Promise<ActionResult<{ filename: string; csv: string; truncated: boolean }>> {
  try {
    const user = await requirePermission("comunicacao.historico.exportar");
    const filters = historyFiltersSchema.parse(input ?? {});
    const { rows, truncated } = await getHistoryForExport(user, filters);
    const fmt = (iso: string) => new Date(iso).toLocaleString("pt-BR", { timeZone: "America/Sao_Paulo", dateStyle: "short", timeStyle: "short" });
    const csv = toCsv(
      ["Atendimento", "Canal", "Contato", "Tipo", "Telefone/e-mail", "Fila", "Operador", "Aberta", "Encerrada", "1ª resposta", "SLA", "Motivo", "Resumo", "Chamado"],
      rows.map((r) => [
        r.number,
        CHANNEL_NAME[r.channel],
        r.name,
        r.subtitle,
        r.address,
        r.queueName,
        r.assigneeName,
        fmt(r.openedAt),
        fmt(r.closedAt),
        formatDurationShort(r.firstResponseMs),
        r.sla === "estourado" ? "Estourado" : r.sla === "dentro" ? "Dentro" : "",
        r.reasonLabel,
        r.summary,
        r.ticket?.number,
      ]),
    );
    return { ok: true, data: { filename: `historico-atendimentos-${new Date().toISOString().slice(0, 10)}.csv`, csv, truncated } };
  } catch (error) {
    return fail(error, "Não foi possível exportar o histórico");
  }
}

// ---------------------------------------------------------------------------
// Ficha do usuário › Atendimento na Central
// ---------------------------------------------------------------------------

export async function saveUserCentralAction(input: unknown): Promise<ActionResult<{ queuesChanged: number }>> {
  try {
    await requirePermission("comunicacao.canais.filas.editar");
    const data = saveUserCentralSchema.parse(input);
    const r = await saveUserCentral(data);
    // A pessoa pode ter ficado disponível para a fila (entrou numa fila, voltou a atender, aumentou o limite).
    await distributeWaitingSafely();
    revalidatePath("/admin/usuarios");
    revalidatePath("/comunicacao/canais");
    revalidatePath("/comunicacao");
    return { ok: true, data: r };
  } catch (error) {
    return fail(error, "Não foi possível salvar o atendimento na Central");
  }
}
