import "server-only";
/**
 * Central de Atendimento — regras das conversas (abrir, distribuir, responder, nota interna, transferir, encerrar,
 * identificar o contato).
 *
 * Princípios:
 * - Uma conversa ABERTA por canal + contato (chave canônica de src/domain/phone.ts). Id determinístico por contato e
 *   ordem (`cv_<hash>_<n>`), criado com createIfAbsent: duas mensagens simultâneas do mesmo número não abrem duas.
 * - As mensagens ficam em `communications` (com `conversationId`); a conversa guarda só o estado do atendimento.
 * - Envio sempre pelo helper único `sendOrRecord` (envio real quando o canal está conectado; senão registro manual).
 * - WhatsApp fora da janela de 24 h: a Meta recusa texto livre. Com o canal conectado, a Central não tenta enviar —
 *   o operador usa o WhatsApp do aparelho (registro manual) até os modelos aprovados chegarem (fase 1, PR 2).
 * - SLA pelo motor único (src/server/sla.ts), com a regra escolhida na fila; transferir não zera o relógio.
 */
import { createHash } from "node:crypto";
import { createIfAbsent, getById, getManyByIds, list, nextNumber, nowIso, update } from "@/server/db";
import { emitEvent } from "@/server/events";
import { notify } from "@/server/notifications";
import { completeSla, getSlaRule, markSlaResponded, startSla } from "@/server/sla";
import { BusinessError } from "@/server/auth/error-classes";
import { sendOrRecord, recordCommunication } from "@/server/integrations/communications";
import { isConnected } from "@/server/integrations/status";
import { createTicketFromConversation, findOpenTicketForClient, recordConversationReplyOnTicket } from "@/server/support/service";
import {
  COLLECTIONS,
  type Client,
  type Communication,
  type Contact,
  type Conversation,
  type ConversationChannel,
  type ConversationCloseReason,
  type Lead,
  type ServiceQueue,
  type SlaInstance,
  type SupportTicket,
  type User,
  type UserRef,
} from "@/domain/types";
import { contactKeyOf, withNinthDigit } from "@/domain/phone";
import { CHANNEL_INFO, CHANNEL_NAMES, metaReplyWindow } from "@/domain/channels";
import { replySubject } from "@/domain/email-inbound";
import { CLOSE_REASON_LABELS, isOpenConversation, pickAssignee, whatsappWindow, type QueueCandidate } from "@/domain/conversations";
import { MESSAGE_VARIABLES, fillTemplate, placeholderCount, templateParams } from "@/domain/message-variables";
import { resolveIdentity, type ResolvedIdentity } from "./identity";
import { chooseQueue, getQueue, listActiveQueues, listQueues } from "./queues";
import { patchFields } from "./store";

export const SYSTEM_ACTOR: UserRef = { id: "sistema", name: "Central de Atendimento" };
const CHANNEL_LABEL: Record<ConversationChannel, string> = CHANNEL_NAMES;
/** Nota interna: comunicação do canal "interno" ligada só à conversa (sem cliente: não aparece em outras telas). */
export const NOTE_TEMPLATE_KEY = "nota_interna";

export function conversationHref(id: string): string {
  return `/comunicacao?conversa=${id}`;
}

function preview(text: string): string {
  const t = text.replace(/\s+/g, " ").trim();
  return t.length > 140 ? `${t.slice(0, 137)}…` : t;
}

async function loadConversation(id: string): Promise<Conversation> {
  const c = await getById<Conversation>(COLLECTIONS.conversations, id);
  if (!c) throw new BusinessError("Conversa não encontrada");
  return c;
}

function requireOpen(c: Conversation): void {
  if (!isOpenConversation(c)) throw new BusinessError("Esta conversa já foi encerrada");
}

// ---------------------------------------------------------------------------
// Abertura
// ---------------------------------------------------------------------------

/** Conversa aberta do contato no canal (a mais recente), se houver. */
export async function findOpenConversation(channel: ConversationChannel, contactKey: string): Promise<Conversation | undefined> {
  if (!contactKey) return undefined;
  const all = await list<Conversation>(COLLECTIONS.conversations, { where: [["contactKey", "==", contactKey]] });
  return all.filter((c) => c.channel === channel && isOpenConversation(c)).sort((a, b) => (a.openedAt < b.openedAt ? 1 : -1))[0];
}

function conversationIdFor(channel: ConversationChannel, contactKey: string, n: number): string {
  const hash = createHash("sha256").update(`${channel}|${contactKey}`).digest("hex").slice(0, 16);
  return `cv_${hash}_${n}`;
}

export interface OpenConversationInput {
  channel: ConversationChannel;
  address: string;
  identity: ResolvedIdentity;
  displayName?: string;
  ticketId?: string;
  at?: string;
}

/**
 * Encontra a conversa aberta do contato ou abre uma nova (idempotente sob concorrência). `created` indica se esta
 * chamada abriu a conversa — só então ela é distribuída.
 */
export async function findOrOpenConversation(input: OpenConversationInput): Promise<{ conversation: Conversation; created: boolean }> {
  const contactKey = contactKeyOf(input.channel, input.address);
  if (!contactKey) throw new BusinessError(input.channel === "email" ? "E-mail inválido" : "Telefone inválido");
  const existing = await findOpenConversation(input.channel, contactKey);
  if (existing) return { conversation: existing, created: false };

  const previous = (await list<Conversation>(COLLECTIONS.conversations, { where: [["contactKey", "==", contactKey]] })).filter((c) => c.channel === input.channel);
  const at = input.at ?? nowIso();
  let n = previous.length + 1;
  for (let attempt = 0; attempt < 5; attempt++, n++) {
    const id = conversationIdFor(input.channel, contactKey, n);
    const { created, doc } = await createIfAbsent<Conversation>(COLLECTIONS.conversations, id, {
      number: await nextNumber("AT", { initFrom: { collection: COLLECTIONS.conversations } }),
      channel: input.channel,
      status: "nova",
      contactKey,
      address: input.address,
      displayName: input.displayName,
      identity: input.identity.identity,
      clientId: input.identity.clientId,
      contactId: input.identity.contactId,
      leadId: input.identity.leadId,
      ticketId: input.ticketId,
      openedAt: at,
      lastMessageAt: at,
      awaitingReply: false,
      transfers: 0,
    });
    if (created) return { conversation: doc, created: true };
    // Outra mensagem do mesmo contato abriu primeiro: usa a dela (se ainda estiver aberta).
    if (isOpenConversation(doc)) return { conversation: doc, created: false };
  }
  throw new BusinessError("Não foi possível abrir a conversa");
}

// ---------------------------------------------------------------------------
// Distribuição
// ---------------------------------------------------------------------------

/** Conversas abertas por responsável (carga). */
export async function loadByAssignee(): Promise<Map<string, number>> {
  const open = await list<Conversation>(COLLECTIONS.conversations, { where: [["status", "in", ["em_atendimento", "aguardando_cliente"]]] });
  const loads = new Map<string, number>();
  for (const c of open) if (c.assigneeId) loads.set(c.assigneeId, (loads.get(c.assigneeId) ?? 0) + 1);
  return loads;
}

/**
 * Operadores da fila para uma conversa do canal: disponível = ativo, online, atende na Central e atende o canal
 * (ficha do usuário › Atendimento na Central). Limite próprio, quando definido, vale no lugar do da fila.
 */
async function candidatesFor(queue: ServiceQueue, loads: Map<string, number>, channel: ConversationChannel): Promise<QueueCandidate[]> {
  const users = await getManyByIds<User>(COLLECTIONS.users, queue.memberIds);
  return queue.memberIds.map((id) => {
    const u = users.get(id);
    return { id, available: Boolean(u && isAvailableFor(u, channel)), load: loads.get(id) ?? 0, limit: u?.central?.maxConcurrent };
  });
}

/** O usuário pode receber conversa deste canal agora? */
export function isAvailableFor(u: Pick<User, "active" | "presence" | "central">, channel: ConversationChannel): boolean {
  if (u.active === false || u.presence !== "online") return false;
  if (u.central?.attends === false) return false;
  return !u.central?.channels?.length || u.central.channels.includes(channel);
}

/** Responsável natural: atendente do chamado aberto, dono do lead ou quem atendeu a última conversa do contato. */
async function preferredAssignee(c: Conversation): Promise<string | undefined> {
  if (c.ticketId) {
    const t = await getById<SupportTicket>(COLLECTIONS.supportTickets, c.ticketId);
    if (t?.assigneeId) return t.assigneeId;
  }
  if (c.leadId) {
    const lead = await getById<Lead>(COLLECTIONS.leads, c.leadId);
    if (lead?.ownerId) return lead.ownerId;
  }
  const previous = (await list<Conversation>(COLLECTIONS.conversations, { where: [["contactKey", "==", c.contactKey]] }))
    .filter((x) => x.id !== c.id && x.channel === c.channel && x.assigneeId)
    .sort((a, b) => (a.openedAt < b.openedAt ? 1 : -1))[0];
  return previous?.assigneeId;
}

async function startConversationSla(c: Conversation, queue: ServiceQueue | undefined, ownerId: string | undefined): Promise<string | undefined> {
  if (!queue?.slaRuleKey || c.slaInstanceId) return c.slaInstanceId;
  const rule = await getSlaRule(queue.slaRuleKey);
  if (!rule || !rule.active) return undefined;
  const sla = await startSla({ ruleKey: rule.key, entityType: "conversa", entityId: c.id, clientId: c.clientId, ownerId, department: queue.department, startedAt: c.openedAt });
  return sla.id;
}

/**
 * Coloca a conversa nova na fila certa e, se houver operador disponível, atribui. Também inicia o SLA da fila.
 */
export async function routeNewConversation(c: Conversation, ctx: { hasOpenTicket: boolean; queueId?: string }): Promise<Conversation> {
  const queues = await listActiveQueues();
  // Fila escolhida no menu de boas-vindas (se ainda ativa e atendendo o canal); senão, a regra de entrada.
  const chosen = ctx.queueId ? queues.find((q) => q.id === ctx.queueId && q.channels.includes(c.channel)) : undefined;
  const queue = chosen ?? chooseQueue(queues, { channel: c.channel, identity: c.identity, hasOpenTicket: ctx.hasOpenTicket });
  const loads = await loadByAssignee();
  const preferredId = await preferredAssignee(c);
  let assigneeId: string | undefined;
  if (queue) {
    assigneeId = pickAssignee({ strategy: queue.strategy, candidates: await candidatesFor(queue, loads, c.channel), maxConcurrent: queue.maxConcurrent, preferredId, lastAssignedId: queue.lastAssignedId });
  }
  const now = nowIso();
  const slaInstanceId = await startConversationSla(c, queue, assigneeId);
  const patch: Partial<Conversation> = {
    queueId: queue?.id,
    status: assigneeId ? "em_atendimento" : "na_fila",
    assigneeId,
    assignedAt: assigneeId ? now : undefined,
    slaInstanceId,
    queuedAt: now,
    menuPending: undefined,
  };
  await patchFields<Conversation>(COLLECTIONS.conversations, c.id, patch);
  if (queue && assigneeId) await update<ServiceQueue>(COLLECTIONS.serviceQueues, queue.id, { lastAssignedId: assigneeId });
  const next = { ...c, ...patch };
  if (assigneeId) await announceAssignment(next, assigneeId, SYSTEM_ACTOR, queue?.name);
  return next;
}

async function announceAssignment(c: Conversation, assigneeId: string, actor: UserRef, queueName?: string): Promise<void> {
  const who = await displayNameOf(c);
  await emitEvent({
    type: "conversation.assigned",
    actor,
    clientId: c.clientId,
    entity: { type: "conversation", id: c.id },
    title: `Atendimento ${c.number} (${CHANNEL_LABEL[c.channel]}) com ${who} atribuído`,
    payload: { conversationId: c.id, assigneeId, queueId: c.queueId, queueName },
    timeline: false,
  });
  if (assigneeId !== actor.id) {
    await notify({
      userIds: [assigneeId],
      kind: "acao",
      title: `Novo atendimento: ${who}`,
      body: c.lastMessagePreview,
      href: conversationHref(c.id),
      entity: { type: "conversation", id: c.id },
    });
  }
}

/**
 * Distribui as conversas que esperam na fila (mais antigas primeiro) entre os operadores disponíveis. Chamada quando
 * alguém fica online, encerra ou transfere um atendimento, e ao abrir a Central.
 */
export async function distributeWaiting(options: { queueIds?: string[] } = {}): Promise<number> {
  const waiting = (await list<Conversation>(COLLECTIONS.conversations, { where: [["status", "==", "na_fila"]] }))
    .filter((c) => !options.queueIds || (c.queueId && options.queueIds.includes(c.queueId)))
    .sort((a, b) => (a.openedAt < b.openedAt ? -1 : 1));
  if (waiting.length === 0) return 0;
  const queues = new Map((await listActiveQueues()).map((q) => [q.id, q]));
  const loads = await loadByAssignee();
  let assigned = 0;
  for (const c of waiting) {
    const queue = c.queueId ? queues.get(c.queueId) : undefined;
    if (!queue) continue;
    const assigneeId = pickAssignee({ strategy: queue.strategy, candidates: await candidatesFor(queue, loads, c.channel), maxConcurrent: queue.maxConcurrent, preferredId: await preferredAssignee(c), lastAssignedId: queue.lastAssignedId });
    if (!assigneeId) continue;
    const now = nowIso();
    await update<Conversation>(COLLECTIONS.conversations, c.id, { assigneeId, assignedAt: now, status: c.awaitingReply || !c.lastOutboundAt ? "em_atendimento" : "aguardando_cliente" });
    await update<ServiceQueue>(COLLECTIONS.serviceQueues, queue.id, { lastAssignedId: assigneeId });
    queue.lastAssignedId = assigneeId;
    loads.set(assigneeId, (loads.get(assigneeId) ?? 0) + 1);
    if (c.slaInstanceId) await update<SlaInstance>(COLLECTIONS.slaInstances, c.slaInstanceId, { ownerId: assigneeId });
    await announceAssignment({ ...c, assigneeId }, assigneeId, SYSTEM_ACTOR, queue.name);
    assigned += 1;
  }
  return assigned;
}

/**
 * Usuário desativado: sai de todas as filas e as conversas abertas com ele voltam para a fila de origem (com nota),
 * para outro operador assumir.
 */
export async function releaseUserFromCentral(userId: string): Promise<number> {
  const { removeFromAllQueues } = await import("./queues");
  await removeFromAllQueues(userId);
  const open = (await list<Conversation>(COLLECTIONS.conversations, { where: [["assigneeId", "==", userId]] })).filter(isOpenConversation);
  for (const c of open) {
    await patchFields<Conversation>(COLLECTIONS.conversations, c.id, { assigneeId: undefined, assignedAt: undefined, status: "na_fila", queuedAt: nowIso() });
    if (c.slaInstanceId) await patchFields<SlaInstance>(COLLECTIONS.slaInstances, c.slaInstanceId, { ownerId: undefined });
    await addConversationNote(c.id, "O responsável foi desativado: a conversa voltou para a fila.", SYSTEM_ACTOR);
  }
  if (open.length > 0) await distributeWaitingSafely();
  return open.length;
}

let lastThrottled = 0;

/** Distribuição ao abrir a Central: no máximo a cada 30 s por instância do servidor. */
export async function distributeWaitingThrottled(): Promise<void> {
  if (Date.now() - lastThrottled < 30_000) return;
  lastThrottled = Date.now();
  await distributeWaitingSafely();
}

/** Variante segura (nunca derruba quem chamou): presença, abertura da Central. */
export async function distributeWaitingSafely(): Promise<void> {
  try {
    await distributeWaiting();
  } catch (error) {
    console.error("[conversas] falha ao distribuir a fila", error);
  }
}

// ---------------------------------------------------------------------------
// Entrada de mensagens (o webhook chama por src/server/conversations/inbound.ts)
// ---------------------------------------------------------------------------

export interface InboundRecordInput {
  conversation: Conversation;
  body: string;
  at: string;
  communicationId: string;
}

/** Atualiza a conversa com a mensagem do cliente: reabre a janela de 24 h e volta para "em atendimento". */
export async function applyInbound(input: InboundRecordInput): Promise<Conversation> {
  const c = input.conversation;
  const patch: Partial<Conversation> = {
    lastMessageAt: input.at,
    lastMessagePreview: preview(input.body),
    lastMessageDirection: "entrada",
    lastInboundAt: input.at,
    awaitingReply: true,
  };
  if (c.status === "aguardando_cliente") patch.status = "em_atendimento";
  await update<Conversation>(COLLECTIONS.conversations, c.id, patch);
  return { ...c, ...patch };
}

// ---------------------------------------------------------------------------
// Ações do operador
// ---------------------------------------------------------------------------

/** O operador assume a conversa (da fila ou de outra pessoa, quando permitido pela action). */
export async function assumeConversation(id: string, actor: UserRef): Promise<Conversation> {
  const c = await loadConversation(id);
  requireOpen(c);
  if (c.assigneeId === actor.id) return c;
  return assignConversation(c, actor.id, actor);
}

/** Atribui a conversa a alguém (gestor distribuindo ou operador assumindo). */
export async function assignConversation(c: Conversation, assigneeId: string, actor: UserRef): Promise<Conversation> {
  const user = await getById<User>(COLLECTIONS.users, assigneeId);
  if (!user || user.active === false) throw new BusinessError("Operador não encontrado ou inativo");
  const now = nowIso();
  const patch: Partial<Conversation> = {
    assigneeId,
    assignedAt: now,
    status: c.status === "na_fila" || c.status === "nova" ? (c.awaitingReply || !c.lastOutboundAt ? "em_atendimento" : "aguardando_cliente") : c.status,
  };
  await update<Conversation>(COLLECTIONS.conversations, c.id, patch);
  if (c.slaInstanceId) await update<SlaInstance>(COLLECTIONS.slaInstances, c.slaInstanceId, { ownerId: assigneeId });
  const next = { ...c, ...patch };
  await announceAssignment(next, assigneeId, actor);
  return next;
}

export interface SendMessageInput {
  body: string;
  /** Enviar pelo WhatsApp/e-mail do aparelho (registro manual). */
  manual?: boolean;
  /** false = quem chamou já registra a resposta no chamado (resposta dada pela tela do chamado). */
  recordOnTicket?: boolean;
}

export interface SendMessageResult {
  communication: Communication;
  delivery: "enviada" | "falha" | "manual" | "nao_enviada";
  manualUrl: string | null;
  error?: string;
}

/** Resposta ao cliente pela conversa (quem responde e ainda não é o responsável passa a ser). */
export async function sendConversationMessage(id: string, input: SendMessageInput, actor: UserRef): Promise<SendMessageResult> {
  const c = await loadConversation(id);
  requireOpen(c);
  if (c.channel === "whatsapp" && !input.manual && isConnected("whatsapp") && !whatsappWindow(c.lastInboundAt).open) {
    throw new BusinessError(
      "Fora da janela de 24 h do WhatsApp: a Meta só aceita modelo aprovado. Envie pelo WhatsApp do aparelho (fica como registro manual) ou por e-mail.",
    );
  }
  // Instagram/Messenger: 24 h normal; até 7 dias com a etiqueta de atendimento humano; depois, a Meta recusa.
  let metaHumanAgentTag = false;
  if ((c.channel === "instagram" || c.channel === "messenger") && !input.manual) {
    const w = metaReplyWindow(c.lastInboundAt);
    if (!w.open) throw new BusinessError(`Fora da janela do ${CHANNEL_NAMES[c.channel]}: a Meta só aceita resposta até 7 dias depois da última mensagem do cliente. Peça para a pessoa escrever de novo ou fale por outro canal.`);
    metaHumanAgentTag = w.humanAgentTag;
  }
  // E-mail: «Re: <assunto>», encadeado na última mensagem do cliente e com a assinatura de quem responde.
  const text = c.channel === "email" ? await withEmailSignature(input.body, actor.id) : input.body;
  const sent = await sendOrRecord({
    channel: c.channel,
    to: c.address,
    subject: replySubject(c.subject),
    text,
    clientId: c.clientId,
    contactId: c.contactId,
    entity: c.leadId && !c.clientId ? { type: "lead", id: c.leadId } : c.ticketId ? { type: "ticket", id: c.ticketId } : { type: "conversation", id: c.id },
    actor,
    conversationId: c.id,
    forceManual: input.manual,
    inReplyTo: c.channel === "email" ? c.lastInboundMessageId : undefined,
    metaHumanAgentTag,
  });
  if (sent.delivery === "falha" || sent.delivery === "nao_enviada") {
    return { communication: sent.communication, delivery: sent.delivery, manualUrl: sent.manualUrl, error: sent.error };
  }
  await applyOutbound(c, input.body, actor);
  if (c.ticketId && input.recordOnTicket !== false) {
    try {
      await recordConversationReplyOnTicket(c.ticketId, { channel: c.channel, body: input.body, authorId: actor.id, manual: sent.delivery === "manual" });
    } catch (error) {
      console.error("[conversas] falha ao registrar a resposta no chamado", error);
    }
  }
  return { communication: sent.communication, delivery: sent.delivery, manualUrl: sent.manualUrl };
}

/** Texto do e-mail com a assinatura do usuário (ficha do usuário › Atendimento na Central), se houver. */
export async function withEmailSignature(body: string, userId: string): Promise<string> {
  const u = await getById<User>(COLLECTIONS.users, userId);
  const signature = u?.central?.emailSignature?.trim();
  return signature ? `${body.trimEnd()}\n\n-- \n${signature}` : body;
}

/** Estado da conversa depois de uma resposta da equipe (primeira resposta, SLA, responsável). */
async function applyOutbound(c: Conversation, body: string, actor: UserRef): Promise<void> {
  const now = nowIso();
  const patch: Partial<Conversation> = {
    lastMessageAt: now,
    lastMessagePreview: preview(body),
    lastMessageDirection: "saida",
    lastOutboundAt: now,
    awaitingReply: false,
    status: "aguardando_cliente",
    firstResponseAt: c.firstResponseAt ?? now,
  };
  if (!c.assigneeId) {
    patch.assigneeId = actor.id;
    patch.assignedAt = now;
  }
  await update<Conversation>(COLLECTIONS.conversations, c.id, patch);
  if (c.slaInstanceId && !c.firstResponseAt) await markSlaResponded(c.slaInstanceId);
  if (c.slaInstanceId && !c.assigneeId) await update<SlaInstance>(COLLECTIONS.slaInstances, c.slaInstanceId, { ownerId: actor.id });
}

/**
 * Resposta dada fora da Central (Caixa de Entrada do Marketing) numa mensagem que pertence a uma conversa: a conversa
 * acompanha (deixa de esperar resposta, conta a primeira resposta). Nunca derruba quem chamou.
 */
export async function noteOutboundElsewhere(conversationId: string, body: string, actor: UserRef): Promise<void> {
  try {
    const c = await getById<Conversation>(COLLECTIONS.conversations, conversationId);
    if (c && isOpenConversation(c)) await applyOutbound(c, body, actor);
  } catch (error) {
    console.error("[conversas] falha ao atualizar a conversa após resposta externa", error);
  }
}

/** Valores das variáveis de mensagem para a conversa (modelos e respostas rápidas). */
export async function conversationValues(c: Conversation, actor: UserRef): Promise<Record<string, string>> {
  const [contact, client, lead] = await Promise.all([
    c.contactId ? getById<Contact>(COLLECTIONS.contacts, c.contactId) : null,
    c.clientId ? getById<Client>(COLLECTIONS.clients, c.clientId) : null,
    c.leadId ? getById<Lead>(COLLECTIONS.leads, c.leadId) : null,
  ]);
  const person = contact?.name ?? lead?.name ?? c.displayName ?? "";
  return {
    contato: person.split(" ")[0] ?? "",
    cliente: client?.tradeName ?? lead?.company ?? "",
    operador: actor.name.split(" ")[0] ?? actor.name,
    atendimento: c.number,
  };
}

/**
 * Envia um modelo aprovado na conversa (a forma de escrever no WhatsApp fora da janela de 24 h). Variável sem valor
 * (ex.: cliente de um contato não identificado) impede o envio — nunca vai «-» para o cliente.
 */
export async function sendConversationTemplate(id: string, templateIdValue: string, actor: UserRef): Promise<SendMessageResult> {
  const c = await loadConversation(id);
  requireOpen(c);
  if (c.channel !== "whatsapp") throw new BusinessError("Modelos são do WhatsApp");
  const { getTemplate, templateKeyOf, templateUsable } = await import("./templates");
  const template = await getTemplate(templateIdValue);
  if (!template || !templateUsable(template, "conversa")) throw new BusinessError("Modelo indisponível: precisa estar aprovado e com as variáveis ligadas");
  const values = await conversationValues(c, actor);
  const { params, missing } = templateParams(template.variables.slice(0, placeholderCount(template.body)), values);
  if (missing.length) throw new BusinessError(`Falta informação para o modelo: ${missing.map((m) => MESSAGE_VARIABLES[m as keyof typeof MESSAGE_VARIABLES]?.label ?? m).join(", ")}. Identifique o contato ou use outro modelo.`);
  const text = fillTemplate(template.body, params);
  const sent = await sendOrRecord({
    channel: "whatsapp",
    to: c.address,
    text,
    clientId: c.clientId,
    contactId: c.contactId,
    entity: c.leadId && !c.clientId ? { type: "lead", id: c.leadId } : c.ticketId ? { type: "ticket", id: c.ticketId } : { type: "conversation", id: c.id },
    actor,
    conversationId: c.id,
    templateKey: templateKeyOf(template),
    whatsappTemplate: { name: template.name, language: template.language, params },
  });
  if (sent.delivery === "falha" || sent.delivery === "nao_enviada") return { communication: sent.communication, delivery: sent.delivery, manualUrl: sent.manualUrl, error: sent.error };
  await applyOutbound(c, text, actor);
  return { communication: sent.communication, delivery: sent.delivery, manualUrl: sent.manualUrl };
}

/** Nota interna (o cliente nunca vê): só na conversa. */
export async function addConversationNote(id: string, body: string, actor: UserRef): Promise<Communication> {
  const c = await loadConversation(id);
  return recordCommunication({
    channel: "interno",
    direction: "saida",
    userId: actor.id,
    body,
    templateKey: NOTE_TEMPLATE_KEY,
    conversationId: c.id,
    entityType: "conversation",
    entityId: c.id,
    status: "enviada",
    provider: "outro",
    createdBy: actor.id,
  });
}

export interface TransferInput {
  toUserId?: string;
  toQueueId?: string;
  note: string;
}

/** Transfere para uma pessoa ou para uma fila. A nota fica na conversa; o SLA continua de onde estava. */
export async function transferConversation(id: string, input: TransferInput, actor: UserRef): Promise<Conversation> {
  const c = await loadConversation(id);
  requireOpen(c);
  if (!input.toUserId && !input.toQueueId) throw new BusinessError("Escolha para quem transferir");
  let patch: Partial<Conversation>;
  let target: string;
  if (input.toUserId) {
    if (input.toUserId === c.assigneeId) throw new BusinessError("A conversa já está com essa pessoa");
    const user = await getById<User>(COLLECTIONS.users, input.toUserId);
    if (!user || user.active === false) throw new BusinessError("Operador não encontrado ou inativo");
    patch = { assigneeId: user.id, assignedAt: nowIso(), status: c.status === "na_fila" || c.status === "nova" ? "em_atendimento" : c.status, transfers: (c.transfers ?? 0) + 1 };
    target = user.name;
  } else {
    const queue = await getQueue(input.toQueueId!);
    if (!queue || !queue.active) throw new BusinessError("Fila não encontrada ou inativa");
    if (!queue.channels.includes(c.channel)) throw new BusinessError(`A fila ${queue.name} não atende ${CHANNEL_LABEL[c.channel]}`);
    patch = { queueId: queue.id, assigneeId: undefined, assignedAt: undefined, status: "na_fila", transfers: (c.transfers ?? 0) + 1, queuedAt: nowIso() };
    target = `fila ${queue.name}`;
  }
  await patchFields<Conversation>(COLLECTIONS.conversations, c.id, patch);
  if (c.slaInstanceId) await patchFields<SlaInstance>(COLLECTIONS.slaInstances, c.slaInstanceId, { ownerId: patch.assigneeId });
  await addConversationNote(c.id, `Transferido para ${target}: ${input.note}`, actor);
  await emitEvent({
    type: "conversation.transferred",
    actor,
    clientId: c.clientId,
    entity: { type: "conversation", id: c.id },
    title: `Atendimento ${c.number} transferido para ${target}`,
    description: input.note,
    payload: { conversationId: c.id, fromUserId: c.assigneeId, toUserId: input.toUserId, toQueueId: input.toQueueId },
    timeline: false,
  });
  const next = { ...c, ...patch };
  if (input.toUserId && input.toUserId !== actor.id) {
    await notify({
      userIds: [input.toUserId],
      kind: "acao",
      title: `${actor.name} transferiu um atendimento para você`,
      body: input.note,
      href: conversationHref(c.id),
      entity: { type: "conversation", id: c.id },
    });
  }
  if (input.toQueueId) await distributeWaitingSafely();
  return next;
}

export interface CloseInput {
  reason: ConversationCloseReason;
  summary?: string;
  /** Texto automático de encerramento (ex.: «sem resposta do cliente»); padrão = mensagem de encerramento configurada. */
  autoText?: string;
  /** false = o operador desmarcou a mensagem de encerramento. */
  sendClosingMessage?: boolean;
  /** Chamado: nada, vincular ao chamado aberto do cliente, ou abrir um novo com o resumo. */
  ticket: "nenhum" | "vincular" | "novo";
  ticketId?: string;
}

/** Encerra a conversa. Com «abrir chamado», cria o chamado com o resumo e liga os dois. */
export async function closeConversation(id: string, input: CloseInput, actor: UserRef): Promise<{ conversation: Conversation; ticketId?: string }> {
  const c = await loadConversation(id);
  requireOpen(c);
  let ticketId = c.ticketId;
  if (input.ticket === "vincular") {
    if (!input.ticketId) throw new BusinessError("Escolha o chamado");
    const ticket = await getById<SupportTicket>(COLLECTIONS.supportTickets, input.ticketId);
    if (!ticket || ticket.clientId !== c.clientId) throw new BusinessError("Chamado não encontrado para este cliente");
    ticketId = ticket.id;
  } else if (input.ticket === "novo") {
    if (!c.clientId) throw new BusinessError("Identifique o cliente antes de abrir um chamado");
    const summary = input.summary?.trim();
    if (!summary || summary.length < 3) throw new BusinessError("Escreva o resumo para abrir o chamado");
    const ticket = await createTicketFromConversation(
      { clientId: c.clientId, contactId: c.contactId, channel: c.channel, subject: summary.length > 80 ? `${summary.slice(0, 77)}…` : summary, description: summary, assigneeId: c.assigneeId ?? actor.id },
      actor,
    );
    ticketId = ticket.id;
  }
  const now = nowIso();
  const patch: Partial<Conversation> = {
    status: "encerrada",
    closedAt: now,
    closedById: actor.id,
    closeReason: input.ticket === "novo" ? "virou_chamado" : input.reason,
    closeSummary: input.summary?.trim() || undefined,
    ticketId,
    awaitingReply: false,
  };
  await update<Conversation>(COLLECTIONS.conversations, c.id, patch);
  if (c.slaInstanceId) await completeSla(c.slaInstanceId);
  const next = { ...c, ...patch };
  // Mensagem automática de encerramento (se ligada; só sai com o canal conectado e a janela aberta).
  try {
    const { getAutoMessages, sendAutoMessage } = await import("./auto-messages");
    const auto = await getAutoMessages();
    const text = input.autoText ?? (auto.encerramento.ativa && input.sendClosingMessage !== false ? auto.encerramento.texto : "");
    if (text) await sendAutoMessage(next, input.autoText ? "encerramentoSemResposta" : "encerramento", text, { allowRepeat: true });
  } catch (error) {
    console.error("[conversas] falha na mensagem automática de encerramento", error);
  }
  await emitEvent({
    type: "conversation.closed",
    actor,
    clientId: c.clientId,
    entity: { type: "conversation", id: c.id },
    title: `Atendimento ${c.number} por ${CHANNEL_LABEL[c.channel]} encerrado: ${CLOSE_REASON_LABELS[next.closeReason!].toLowerCase()}`,
    description: next.closeSummary,
    payload: { conversationId: c.id, reason: next.closeReason, ticketId, channel: c.channel },
    // O resumo vai para a linha do tempo do cliente (Cliente 360).
    timeline: Boolean(c.clientId),
  });
  await distributeWaitingSafely();
  return { conversation: next, ticketId };
}

// ---------------------------------------------------------------------------
// Resposta dada pela tela do chamado
// ---------------------------------------------------------------------------

export interface TicketReplyInput {
  ticketId: string;
  clientId: string;
  contactId?: string;
  channel: ConversationChannel;
  to: string;
  body: string;
}

/**
 * Resposta do chamado por WhatsApp/e-mail: sai pela conversa da Central do contato (a aberta ligada ao chamado, a
 * aberta do contato, ou uma nova com quem respondeu). Assim a resposta do cliente volta para a mesma conversa e tudo
 * fica no Cliente 360. WhatsApp conectado com a janela de 24 h fechada: vai pelo aparelho (registro manual). A
 * interação no chamado fica com quem chamou (recordOnTicket: false).
 */
export async function replyFromTicket(input: TicketReplyInput, actor: UserRef): Promise<SendMessageResult & { conversationId: string }> {
  const contactKey = contactKeyOf(input.channel, input.to);
  if (!contactKey) throw new BusinessError(input.channel === "email" ? "E-mail do contato inválido" : "Telefone do contato inválido");
  const linked = (await list<Conversation>(COLLECTIONS.conversations, { where: [["ticketId", "==", input.ticketId]] })).find((c) => c.channel === input.channel && c.contactKey === contactKey && isOpenConversation(c));
  let conversation = linked;
  if (!conversation) {
    const identity: ResolvedIdentity = { identity: "cliente", clientId: input.clientId, contactId: input.contactId };
    const opened = await findOrOpenConversation({ channel: input.channel, address: input.to, identity, ticketId: input.ticketId });
    conversation = opened.conversation;
    const patch: Partial<Conversation> = {};
    if (!conversation.ticketId) patch.ticketId = input.ticketId;
    if (opened.created) {
      const queue = chooseQueue(await listActiveQueues(), { channel: input.channel, identity: "cliente", hasOpenTicket: true });
      Object.assign(patch, { queueId: queue?.id, assigneeId: actor.id, assignedAt: nowIso(), status: "em_atendimento" as const });
    }
    if (Object.keys(patch).length) {
      await update<Conversation>(COLLECTIONS.conversations, conversation.id, patch);
      conversation = { ...conversation, ...patch };
    }
  }
  const manual = input.channel === "whatsapp" && isConnected("whatsapp") && !whatsappWindow(conversation.lastInboundAt).open;
  const result = await sendConversationMessage(conversation.id, { body: input.body, manual, recordOnTicket: false }, actor);
  return { ...result, conversationId: conversation.id };
}

/** Conversas da Central ligadas ao chamado (a primeira é a de origem). */
export async function ticketConversations(ticketId: string): Promise<Conversation[]> {
  return (await list<Conversation>(COLLECTIONS.conversations, { where: [["ticketId", "==", ticketId]] })).sort((a, b) => (a.openedAt < b.openedAt ? -1 : 1));
}

// ---------------------------------------------------------------------------
// Reabrir (histórico)
// ---------------------------------------------------------------------------

/**
 * Reabre um atendimento encerrado. Volta para quem atendeu, se essa pessoa estiver disponível (online, ativa, atende o
 * canal e abaixo do limite); senão, para a fila de antes (ou a regra de entrada). O SLA começa de novo.
 * Um contato tem uma conversa aberta por canal: se já existe outra aberta, a reabertura é recusada e aponta para ela.
 */
export async function reopenConversation(id: string, actor: UserRef): Promise<Conversation> {
  const c = await loadConversation(id);
  if (isOpenConversation(c)) throw new BusinessError("Este atendimento já está aberto");
  const other = await findOpenConversation(c.channel, c.contactKey);
  if (other) throw new BusinessError(`Já existe um atendimento aberto com este contato (${other.number}). Continue por ele.`);

  const now = nowIso();
  // Estado de encerramento sai; o resto (mensagens, chamado, identificação) continua.
  const reset: Partial<Conversation> = {
    closedAt: undefined,
    closedById: undefined,
    closeReason: undefined,
    closeSummary: undefined,
    slaInstanceId: undefined,
    firstResponseAt: undefined,
    menuPending: undefined,
    reopenedAt: now,
    reopenCount: (c.reopenCount ?? 0) + 1,
    openedAt: now,
    awaitingReply: false,
  };
  await patchFields<Conversation>(COLLECTIONS.conversations, c.id, { ...reset, status: "nova" });
  const base: Conversation = { ...c, ...reset, status: "nova" };

  const previous = c.assigneeId ? await getById<User>(COLLECTIONS.users, c.assigneeId) : null;
  const queues = await listActiveQueues();
  const queue = queues.find((q) => q.id === c.queueId && q.channels.includes(c.channel));
  const loads = await loadByAssignee();
  const backToPrevious = previous && isAvailableFor(previous, c.channel) && (loads.get(previous.id) ?? 0) < Math.max(1, previous.central?.maxConcurrent ?? queue?.maxConcurrent ?? 1);
  let next: Conversation;
  if (previous && backToPrevious) {
    const slaInstanceId = await startConversationSla(base, queue, previous.id);
    const patch: Partial<Conversation> = { queueId: queue?.id ?? c.queueId, assigneeId: previous.id, assignedAt: now, status: "em_atendimento", slaInstanceId, queuedAt: now };
    await patchFields<Conversation>(COLLECTIONS.conversations, c.id, patch);
    next = { ...base, ...patch };
    await announceAssignment(next, previous.id, actor, queue?.name);
  } else {
    await patchFields<Conversation>(COLLECTIONS.conversations, c.id, { assigneeId: undefined, assignedAt: undefined });
    next = await routeNewConversation({ ...base, assigneeId: undefined, assignedAt: undefined }, { hasOpenTicket: Boolean(c.ticketId), queueId: c.queueId });
  }
  await addConversationNote(c.id, `Atendimento reaberto por ${actor.name}.`, SYSTEM_ACTOR);
  await emitEvent({
    type: "conversation.reopened",
    actor,
    clientId: c.clientId,
    entity: { type: "conversation", id: c.id },
    title: `${actor.name} reabriu o atendimento ${c.number}`,
    payload: { conversationId: c.id, channel: c.channel, assigneeId: next.assigneeId, queueId: next.queueId },
  });
  return next;
}

// ---------------------------------------------------------------------------
// Novo atendimento (a equipe começa a conversa)
// ---------------------------------------------------------------------------

export interface StartInput {
  channel: ConversationChannel;
  /** Telefone ou e-mail. */
  address: string;
  clientId?: string;
  contactId?: string;
  leadId?: string;
  queueId?: string;
  body: string;
  manual?: boolean;
  /** WhatsApp: envia este modelo aprovado em vez do texto (fora da janela de 24 h). */
  templateId?: string;
}

export async function startConversation(input: StartInput, actor: UserRef): Promise<{ conversation: Conversation; result: SendMessageResult }> {
  const identity = await identityFromInput(input);
  const ticket = identity.clientId ? await findOpenTicketForClient(identity.clientId) : undefined;
  const { conversation, created } = await findOrOpenConversation({ channel: input.channel, address: input.address, identity, ticketId: ticket?.id });
  if (created) {
    const queue = input.queueId ? await getQueue(input.queueId) : undefined;
    if (input.queueId && (!queue || !queue.active)) throw new BusinessError("Fila não encontrada ou inativa");
    const queueId = queue?.id ?? chooseQueue(await listActiveQueues(), { channel: input.channel, identity: identity.identity, hasOpenTicket: Boolean(ticket) })?.id;
    const now = nowIso();
    const patch: Partial<Conversation> = { queueId, assigneeId: actor.id, assignedAt: now, status: "em_atendimento" };
    await update<Conversation>(COLLECTIONS.conversations, conversation.id, patch);
    Object.assign(conversation, patch);
    await emitEvent({
      type: "conversation.opened",
      actor,
      clientId: conversation.clientId,
      entity: { type: "conversation", id: conversation.id },
      title: `${actor.name} iniciou o atendimento ${conversation.number} por ${CHANNEL_LABEL[input.channel]}`,
      payload: { conversationId: conversation.id, channel: input.channel, origin: "equipe" },
      timeline: false,
    });
  }
  // WhatsApp conectado e o cliente não escreveu nas últimas 24 h: sem modelo aprovado, vai pelo aparelho (registro
  // manual) em vez de a Meta recusar.
  if (input.templateId) return { conversation: { ...conversation }, result: await sendConversationTemplate(conversation.id, input.templateId, actor) };
  const fresh = (await getById<Conversation>(COLLECTIONS.conversations, conversation.id)) ?? conversation;
  const manual = input.manual || (input.channel === "whatsapp" && isConnected("whatsapp") && !whatsappWindow(fresh.lastInboundAt).open);
  const result = await sendConversationMessage(conversation.id, { body: input.body, manual }, actor);
  return { conversation: { ...conversation }, result };
}

async function identityFromInput(input: StartInput): Promise<ResolvedIdentity> {
  if (input.contactId) {
    const contact = await getById<Contact>(COLLECTIONS.contacts, input.contactId);
    if (!contact) throw new BusinessError("Contato não encontrado");
    return { identity: "cliente", clientId: contact.clientId, contactId: contact.id, name: contact.name };
  }
  if (input.clientId) {
    const client = await getById<Client>(COLLECTIONS.clients, input.clientId);
    if (!client) throw new BusinessError("Cliente não encontrado");
    return { identity: "cliente", clientId: client.id, name: client.tradeName };
  }
  if (input.leadId) {
    const lead = await getById<Lead>(COLLECTIONS.leads, input.leadId);
    if (!lead) throw new BusinessError("Lead não encontrado");
    return lead.clientId ? { identity: "cliente", clientId: lead.clientId, leadId: lead.id, name: lead.name, ownerId: lead.ownerId } : { identity: "lead", leadId: lead.id, name: lead.name, ownerId: lead.ownerId };
  }
  return resolveIdentity(input.channel, input.address);
}

// ---------------------------------------------------------------------------
// Identificação do contato («Quem é este número?»)
// ---------------------------------------------------------------------------

export interface LinkIdentityInput {
  kind: "contato" | "cliente" | "lead" | "novo_lead" | "nenhum";
  id?: string;
  /** Novo lead: nome. */
  name?: string;
  /** Atualizar o telefone do contato/lead para o número da conversa (formato com 9 dígitos). */
  fixPhone?: boolean;
}

export async function linkConversationIdentity(id: string, input: LinkIdentityInput, actor: UserRef): Promise<Conversation> {
  const c = await loadConversation(id);
  let patch: Partial<Conversation>;
  if (input.kind === "contato") {
    const contact = input.id ? await getById<Contact>(COLLECTIONS.contacts, input.id) : null;
    if (!contact) throw new BusinessError("Contato não encontrado");
    patch = { identity: "cliente", clientId: contact.clientId, contactId: contact.id, leadId: undefined };
    if (input.fixPhone && c.channel === "whatsapp") await update<Contact>(COLLECTIONS.contacts, contact.id, { whatsapp: withNinthDigit(c.address).replace(/\D/g, "") });
  } else if (input.kind === "cliente") {
    const client = input.id ? await getById<Client>(COLLECTIONS.clients, input.id) : null;
    if (!client) throw new BusinessError("Cliente não encontrado");
    patch = { identity: "cliente", clientId: client.id, contactId: undefined, leadId: undefined };
  } else if (input.kind === "lead") {
    const lead = input.id ? await getById<Lead>(COLLECTIONS.leads, input.id) : null;
    if (!lead) throw new BusinessError("Lead não encontrado");
    patch = lead.clientId ? { identity: "cliente", clientId: lead.clientId, leadId: lead.id, contactId: undefined } : { identity: "lead", leadId: lead.id, clientId: undefined, contactId: undefined };
    if (input.fixPhone && c.channel === "whatsapp") await update<Lead>(COLLECTIONS.leads, lead.id, { phone: withNinthDigit(c.address).replace(/\D/g, "") });
  } else if (input.kind === "novo_lead") {
    const lead = await createLeadFromConversation(c, input.name?.trim() || c.displayName || c.address, actor);
    patch = { identity: "lead", leadId: lead.id, clientId: undefined, contactId: undefined };
  } else {
    patch = { identity: "desconhecido", clientId: undefined, contactId: undefined, leadId: undefined };
  }
  await patchFields<Conversation>(COLLECTIONS.conversations, c.id, patch);
  // As mensagens já trocadas passam a contar no histórico do cliente/lead.
  const messages = await list<Communication>(COLLECTIONS.communications, { where: [["conversationId", "==", c.id]] });
  for (const m of messages) {
    if (m.channel === "interno") continue;
    await patchFields<Communication>(COLLECTIONS.communications, m.id, {
      clientId: patch.clientId,
      contactId: patch.contactId,
      ...(patch.leadId && !patch.clientId ? { entityType: "lead", entityId: patch.leadId } : {}),
    });
  }
  return { ...c, ...patch };
}

async function createLeadFromConversation(c: Conversation, name: string, actor: UserRef): Promise<Lead> {
  // Usa o cadastro do Marketing (pontuação, evento lead.created, distribuição). Import dinâmico: só é preciso aqui.
  const [{ createLead }, { createLeadSchema }] = await Promise.all([import("@/server/marketing/service"), import("@/server/marketing/schemas")]);
  const input = createLeadSchema.parse({
    name: name.length >= 2 ? name : `Contato ${c.address}`,
    phone: c.channel === "whatsapp" ? c.address : undefined,
    email: c.channel === "email" ? c.address : undefined,
    origin: c.channel,
    ownerId: c.assigneeId ?? actor.id,
    notes: `Criado na Central de Atendimento a partir do atendimento ${c.number}.`,
  });
  return createLead(input, actor);
}

// ---------------------------------------------------------------------------
// Leitura auxiliar
// ---------------------------------------------------------------------------

export async function displayNameOf(c: Pick<Conversation, "clientId" | "contactId" | "leadId" | "displayName" | "address"> & { channel?: ConversationChannel }): Promise<string> {
  if (c.contactId) {
    const contact = await getById<Contact>(COLLECTIONS.contacts, c.contactId);
    if (contact) return contact.name;
  }
  if (c.clientId) {
    const client = await getById<Client>(COLLECTIONS.clients, c.clientId);
    if (client) return client.tradeName;
  }
  if (c.leadId) {
    const lead = await getById<Lead>(COLLECTIONS.leads, c.leadId);
    if (lead) return lead.name;
  }
  if (!c.displayName && c.channel && CHANNEL_INFO[c.channel].addressKind === "id") return `Contato do ${CHANNEL_INFO[c.channel].label}`;
  return c.displayName || c.address;
}

/** Fila da conversa (ou a primeira ativa) — usado pelas telas. */
export async function queueById(): Promise<Map<string, ServiceQueue>> {
  return new Map((await listQueues()).map((q) => [q.id, q]));
}

