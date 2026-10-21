import "server-only";
/**
 * Entrada de mensagens na Central de Atendimento (webhooks do WhatsApp e do e-mail chamam aqui).
 *
 * 1. Repetida? O provedor reenvia o mesmo aviso quando não recebe 200 a tempo: a comunicação tem id derivado do id da
 *    mensagem no provedor (createIfAbsent) — o segundo aviso não grava nada.
 * 2. Quem é? Identificação única (cliente/contato, lead ou desconhecido).
 * 3. Conversa: encontra a aberta do contato ou abre uma nova (e distribui na fila).
 * 4. Chamado aberto do cliente: a mensagem também entra no chamado (como antes).
 * 5. Registro técnico do que aconteceu.
 */
import { createHash } from "node:crypto";
import { create, createIfAbsent, getById, nowIso, update } from "@/server/db";
import { emitEvent } from "@/server/events";
import { notify } from "@/server/notifications";
import { isConnected } from "@/server/integrations/status";
import { findOpenTicketForClient, receivedEventOf, recordInboundOnTicket } from "@/server/support/service";
import { CHANNEL_NAMES } from "@/domain/channels";
import { COLLECTIONS, type Communication, type Conversation, type ConversationChannel } from "@/domain/types";
import { resolveIdentity } from "./identity";
import { applyInbound, conversationHref, displayNameOf, findOrOpenConversation, routeNewConversation } from "./service";
import { logChannelEvent } from "./channel-events";
import { inboundEmailBody } from "@/domain/email-inbound";
import { businessStatus, canAutoSend, getAutoMessages, menuText, pickMenuOption, sendAutoMessage } from "./auto-messages";

export interface InboundMessage {
  channel: ConversationChannel;
  /** Telefone (WhatsApp) ou e-mail de quem escreveu. */
  from: string;
  body: string;
  /** Id da mensagem no provedor (wamid…). */
  externalId?: string;
  /** Nome do perfil no canal. */
  displayName?: string;
  /** Quando o provedor diz que a mensagem foi enviada (ISO). */
  at?: string;
  /** E-mail: assunto (vira o assunto da conversa) e Message-ID (a resposta sai encadeada nele). */
  subject?: string;
  messageId?: string;
  /** Chat do site: e-mail e telefone que o visitante informou (ajudam a reconhecer quem é). */
  hints?: { email?: string; phone?: string };
}

export interface InboundResult {
  duplicate: boolean;
  conversationId?: string;
  communicationId?: string;
  /** "chamado": entrou também no chamado aberto do cliente. */
  matched?: "chamado" | "conversa";
  opened?: boolean;
}

const CUSTOMER: { id: string; name: string } = { id: "cliente", name: "Cliente" };

/** Id da comunicação de entrada a partir do id do provedor (estável e seguro para chave). */
export function inboundCommunicationId(channel: ConversationChannel, externalId: string): string {
  return `cmin_${createHash("sha256").update(`${channel}|${externalId}`).digest("hex").slice(0, 32)}`;
}

function inboundProvider(channel: ConversationChannel): Communication["provider"] {
  if (channel === "whatsapp") return isConnected("whatsapp") ? "meta" : "outro";
  if (channel === "email") return "resend";
  if (channel === "instagram" || channel === "messenger") return "meta";
  if (channel === "telegram") return "telegram";
  return "interos";
}

export async function receiveInboundMessage(input: InboundMessage): Promise<InboundResult> {
  const started = Date.now();
  const at = input.at ?? nowIso();
  const commId = input.externalId ? inboundCommunicationId(input.channel, input.externalId) : undefined;
  if (commId && (await getById<Communication>(COLLECTIONS.communications, commId))) {
    await logChannelEvent({ channel: input.channel, kind: "mensagem_recebida", result: "duplicado", detail: "Aviso repetido do provedor: a mensagem já tinha entrado e foi ignorada.", externalId: input.externalId, contact: input.from, communicationId: commId, durationMs: Date.now() - started });
    return { duplicate: true, communicationId: commId };
  }

  const identity = await resolveIdentity(input.channel, input.from, input.hints);
  const ticket = identity.clientId ? await findOpenTicketForClient(identity.clientId) : undefined;
  const { conversation, created } = await findOrOpenConversation({ channel: input.channel, address: input.from, identity, displayName: input.displayName, ticketId: ticket?.id, at });
  // E-mail: o assunto entra no texto só na mensagem que abre a conversa (nas respostas ele se repete à toa).
  const body = input.channel === "email" && created ? inboundEmailBody({ subject: input.subject ?? "", text: input.body }, true) : input.body;
  if (input.channel === "email") {
    const patch: Partial<Conversation> = {};
    if (input.subject && !conversation.subject) patch.subject = input.subject;
    if (input.messageId) patch.lastInboundMessageId = input.messageId;
    if (Object.keys(patch).length) {
      await update<Conversation>(COLLECTIONS.conversations, conversation.id, patch);
      Object.assign(conversation, patch);
    }
  }

  const entity = ticket ? { type: "ticket", id: ticket.id } : identity.leadId && !identity.clientId ? { type: "lead", id: identity.leadId } : { type: "conversation", id: conversation.id };
  const data = {
    clientId: identity.clientId,
    contactId: identity.contactId,
    channel: input.channel,
    direction: "entrada" as const,
    entityType: entity.type,
    entityId: entity.id,
    body,
    status: "recebida" as const,
    externalId: input.externalId,
    provider: inboundProvider(input.channel),
    conversationId: conversation.id,
    address: input.from,
    createdAt: at,
  };
  let communication: Communication;
  if (commId) {
    const claim = await createIfAbsent<Communication>(COLLECTIONS.communications, commId, data);
    if (!claim.created) {
      await logChannelEvent({ channel: input.channel, kind: "mensagem_recebida", result: "duplicado", detail: "Aviso repetido do provedor (chegou ao mesmo tempo): ignorado.", externalId: input.externalId, contact: input.from, communicationId: commId, conversationId: conversation.id, durationMs: Date.now() - started });
      return { duplicate: true, communicationId: commId, conversationId: conversation.id };
    }
    communication = claim.doc;
  } else {
    communication = await create<Communication>(COLLECTIONS.communications, data);
  }

  const wasWaiting = conversation.awaitingReply;
  let current = await applyInbound({ conversation, body, at, communicationId: communication.id });
  const who = identity.name ?? input.displayName ?? input.from;

  // Mensagens automáticas (desligadas por padrão): fora do horário e menu de boas-vindas.
  const auto = await getAutoMessages();
  if (auto.foraDoHorario.ativa) {
    const status = await businessStatus(new Date(at));
    if (!status.open) await sendAutoMessage(current, "foraDoHorario", auto.foraDoHorario.texto.replace(/\{proximaAbertura\}/g, status.nextOpening));
  }
  let menuSent = false;
  if (created && !ticket && auto.menu.ativa && auto.menu.opcoes.length > 0 && canAutoSend(current)) {
    menuSent = await sendAutoMessage(current, "menu", menuText(auto.menu), { allowRepeat: true });
    if (menuSent) {
      await update<Conversation>(COLLECTIONS.conversations, current.id, { menuPending: true, menuAttempts: 0 });
      current = { ...current, menuPending: true, menuAttempts: 0 };
    }
  } else if (!created && current.menuPending) {
    // Resposta ao menu: a opção escolhe a fila; inválida → repete uma vez; depois vai para a fila padrão.
    const option = pickMenuOption(body, auto.menu.opcoes);
    if (option) current = await routeNewConversation(current, { hasOpenTicket: Boolean(ticket), queueId: option.filaId });
    else if ((current.menuAttempts ?? 0) < 1 && (await sendAutoMessage(current, "menu", `Não entendi. ${menuText(auto.menu)}`, { allowRepeat: true }))) {
      await update<Conversation>(COLLECTIONS.conversations, current.id, { menuAttempts: (current.menuAttempts ?? 0) + 1 });
    } else current = await routeNewConversation(current, { hasOpenTicket: Boolean(ticket) });
  }

  if (created) {
    await emitEvent({
      type: "conversation.opened",
      actor: { id: CUSTOMER.id, name: who },
      clientId: current.clientId,
      entity: { type: "conversation", id: current.id },
      title: `${who} iniciou um atendimento por ${CHANNEL_NAMES[input.channel]} (${current.number})`,
      payload: { conversationId: current.id, channel: input.channel, origin: "cliente", identity: identity.identity },
      timeline: false,
    });
    // Com menu enviado, a fila sai da resposta do cliente.
    if (!menuSent) current = await routeNewConversation(current, { hasOpenTicket: Boolean(ticket) });
  } else if (current.assigneeId && !ticket && !wasWaiting) {
    await notify({
      userIds: [current.assigneeId],
      kind: "acao",
      title: `${await displayNameOf(current)} respondeu`,
      body: current.lastMessagePreview,
      href: conversationHref(current.id),
      entity: { type: "conversation", id: current.id },
    });
  }

  if (ticket) {
    await recordInboundOnTicket(ticket, { channel: input.channel, body, who, communicationId: communication.id, from: input.from, conversationId: current.id });
  } else {
    await emitEvent({
      type: receivedEventOf(input.channel),
      actor: { id: CUSTOMER.id, name: who },
      clientId: identity.clientId,
      entity: identity.leadId && !identity.clientId ? { type: "lead", id: identity.leadId } : { type: "communication", id: communication.id },
      title: input.channel === "email" ? `E-mail recebido de ${who}${input.subject ? `: ${input.subject}` : ""}` : `${CHANNEL_NAMES[input.channel]}: mensagem recebida de ${who}`,
      description: body,
      department: "marketing",
      payload: { communicationId: communication.id, from: input.from, conversationId: current.id, leadId: identity.leadId },
    });
  }

  await logChannelEvent({
    channel: input.channel,
    kind: "mensagem_recebida",
    result: "processado",
    detail: created
      ? `Atendimento ${current.number} aberto${current.assigneeId ? " e atribuído" : " na fila"}.`
      : ticket
        ? `Mensagem no atendimento ${current.number} e no chamado ${ticket.number}.`
        : `Mensagem no atendimento ${current.number}.`,
    externalId: input.externalId,
    contact: input.from,
    conversationId: current.id,
    communicationId: communication.id,
    durationMs: Date.now() - started,
  });
  return { duplicate: false, conversationId: current.id, communicationId: communication.id, matched: ticket ? "chamado" : "conversa", opened: created };
}
