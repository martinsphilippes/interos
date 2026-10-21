import "server-only";
/**
 * Entrada de mensagens na Central de Atendimento (o webhook do WhatsApp chama aqui; o e-mail de entrada usará o mesmo
 * caminho).
 *
 * 1. Repetida? O provedor reenvia o mesmo aviso quando não recebe 200 a tempo: a comunicação tem id derivado do id da
 *    mensagem no provedor (createIfAbsent) — o segundo aviso não grava nada.
 * 2. Quem é? Identificação única (cliente/contato, lead ou desconhecido).
 * 3. Conversa: encontra a aberta do contato ou abre uma nova (e distribui na fila).
 * 4. Chamado aberto do cliente: a mensagem também entra no chamado (como antes).
 * 5. Registro técnico do que aconteceu.
 */
import { createHash } from "node:crypto";
import { create, createIfAbsent, getById, nowIso } from "@/server/db";
import { emitEvent } from "@/server/events";
import { notify } from "@/server/notifications";
import { isConnected } from "@/server/integrations/status";
import { findOpenTicketForClient, recordInboundOnTicket } from "@/server/support/service";
import { COLLECTIONS, type Communication, type ConversationChannel } from "@/domain/types";
import { resolveIdentity } from "./identity";
import { applyInbound, conversationHref, displayNameOf, findOrOpenConversation, routeNewConversation } from "./service";
import { logChannelEvent } from "./channel-events";

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

export async function receiveInboundMessage(input: InboundMessage): Promise<InboundResult> {
  const started = Date.now();
  const at = input.at ?? nowIso();
  const commId = input.externalId ? inboundCommunicationId(input.channel, input.externalId) : undefined;
  if (commId && (await getById<Communication>(COLLECTIONS.communications, commId))) {
    await logChannelEvent({ channel: input.channel, kind: "mensagem_recebida", result: "duplicado", detail: "Aviso repetido do provedor: a mensagem já tinha entrado e foi ignorada.", externalId: input.externalId, contact: input.from, communicationId: commId, durationMs: Date.now() - started });
    return { duplicate: true, communicationId: commId };
  }

  const identity = await resolveIdentity(input.channel, input.from);
  const ticket = identity.clientId ? await findOpenTicketForClient(identity.clientId) : undefined;
  const { conversation, created } = await findOrOpenConversation({ channel: input.channel, address: input.from, identity, displayName: input.displayName, ticketId: ticket?.id, at });

  const entity = ticket ? { type: "ticket", id: ticket.id } : identity.leadId && !identity.clientId ? { type: "lead", id: identity.leadId } : { type: "conversation", id: conversation.id };
  const data = {
    clientId: identity.clientId,
    contactId: identity.contactId,
    channel: input.channel,
    direction: "entrada" as const,
    entityType: entity.type,
    entityId: entity.id,
    body: input.body,
    status: "recebida" as const,
    externalId: input.externalId,
    provider: (input.channel === "whatsapp" && isConnected("whatsapp") ? "meta" : input.channel === "email" ? "resend" : "outro") as Communication["provider"],
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
  let current = await applyInbound({ conversation, body: input.body, at, communicationId: communication.id });
  const who = identity.name ?? input.displayName ?? input.from;

  if (created) {
    await emitEvent({
      type: "conversation.opened",
      actor: { id: CUSTOMER.id, name: who },
      clientId: current.clientId,
      entity: { type: "conversation", id: current.id },
      title: `${who} iniciou um atendimento por ${input.channel === "whatsapp" ? "WhatsApp" : "e-mail"} (${current.number})`,
      payload: { conversationId: current.id, channel: input.channel, origin: "cliente", identity: identity.identity },
      timeline: false,
    });
    current = await routeNewConversation(current, { hasOpenTicket: Boolean(ticket) });
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
    await recordInboundOnTicket(ticket, { channel: input.channel, body: input.body, who, communicationId: communication.id, from: input.from, conversationId: current.id });
  } else if (input.channel === "whatsapp") {
    await emitEvent({
      type: "whatsapp.message.received",
      actor: { id: CUSTOMER.id, name: who },
      clientId: identity.clientId,
      entity: identity.leadId && !identity.clientId ? { type: "lead", id: identity.leadId } : { type: "communication", id: communication.id },
      title: `WhatsApp recebido de ${who}`,
      description: input.body,
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
