import "server-only";
/**
 * Atendimentos da Central no Cliente 360 (aba Atendimentos): conversas do cliente (só metadados — o texto fica na
 * Central, com o escopo dela), indicadores de 90 dias e «Como falar com eles» (janela de 24 h do WhatsApp e e-mail de
 * cada contato, com as recusas de comunicação do cliente).
 */
import { getManyByIds, list } from "@/server/db";
import { isConnected } from "@/server/integrations/status";
import { COLLECTIONS, type Client, type Contact, type Conversation, type ConversationChannel, type User } from "@/domain/types";
import { CLOSE_REASON_LABELS, CONVERSATION_STATUS_LABELS, isOpenConversation, whatsappWindow } from "@/domain/conversations";
import { contactKeyOf } from "@/domain/phone";
import { firstResponseMs } from "@/domain/conversation-history";
import { listQueues } from "./queues";

export interface ClientConversationRow {
  id: string;
  number: string;
  channel: ConversationChannel;
  at: string;
  contactName?: string;
  queueName?: string;
  assigneeName?: string;
  open: boolean;
  statusLabel: string;
  reasonLabel?: string;
  ticketId?: string;
}

export interface ContactReach {
  id: string;
  name: string;
  role?: string;
  whatsapp?: { number: string; windowOpenUntil?: string; daysSinceLast?: number };
  email?: string;
}

export interface ClientConversations {
  rows: ClientConversationRow[];
  total90d: number;
  byChannel90d: Record<ConversationChannel, number>;
  /** Média da 1ª resposta (ms) nas conversas de 90 dias que tiveram resposta. */
  avgFirstResponseMs?: number;
  contacts: ContactReach[];
  optOut: { whatsapp: boolean; email: boolean };
  whatsappConnected: boolean;
}

export async function getClientConversations(client: Pick<Client, "id" | "communicationOptOut">, contacts: readonly Contact[], now: number = Date.now()): Promise<ClientConversations> {
  const [conversations, queues] = await Promise.all([list<Conversation>(COLLECTIONS.conversations, { where: [["clientId", "==", client.id]] }), listQueues()]);
  const since = new Date(now - 90 * 86_400_000).toISOString();
  const recent = conversations.filter((c) => c.openedAt >= since);
  const responded = recent.map(firstResponseMs).filter((x): x is number => x !== undefined);

  const sorted = [...conversations].sort((a, b) => Number(isOpenConversation(b)) - Number(isOpenConversation(a)) || (a.lastMessageAt < b.lastMessageAt ? 1 : -1)).slice(0, 10);
  const users = await getManyByIds<User>(COLLECTIONS.users, sorted.map((c) => c.assigneeId ?? "").filter(Boolean));
  const contactById = new Map(contacts.map((c) => [c.id, c]));
  const queueName = new Map(queues.map((q) => [q.id, q.name]));

  // Última mensagem do cliente por número (a janela de 24 h é do número, não da conversa).
  const lastInboundByKey = new Map<string, string>();
  for (const c of conversations) {
    if (c.channel !== "whatsapp" || !c.lastInboundAt) continue;
    const prev = lastInboundByKey.get(c.contactKey);
    if (!prev || prev < c.lastInboundAt) lastInboundByKey.set(c.contactKey, c.lastInboundAt);
  }

  return {
    rows: sorted.map((c) => {
      const open = isOpenConversation(c);
      return {
        id: c.id,
        number: c.number,
        channel: c.channel,
        at: open ? c.lastMessageAt : (c.closedAt ?? c.lastMessageAt),
        contactName: c.contactId ? contactById.get(c.contactId)?.name : c.displayName,
        queueName: c.queueId ? queueName.get(c.queueId) : undefined,
        assigneeName: c.assigneeId ? users.get(c.assigneeId)?.name : undefined,
        open,
        statusLabel: CONVERSATION_STATUS_LABELS[c.status],
        reasonLabel: c.closeReason ? CLOSE_REASON_LABELS[c.closeReason] : undefined,
        ticketId: c.ticketId,
      };
    }),
    total90d: recent.length,
    byChannel90d: { whatsapp: recent.filter((c) => c.channel === "whatsapp").length, email: recent.filter((c) => c.channel === "email").length },
    avgFirstResponseMs: responded.length ? responded.reduce((a, b) => a + b, 0) / responded.length : undefined,
    contacts: contacts
      .filter((c) => c.whatsapp || c.phone || c.email)
      .sort((a, b) => Number(b.isPrimary) - Number(a.isPrimary) || a.name.localeCompare(b.name, "pt-BR"))
      .slice(0, 8)
      .map((c) => {
        const number = c.whatsapp || c.phone;
        const key = number ? contactKeyOf("whatsapp", number) : "";
        const last = key ? lastInboundByKey.get(key) : undefined;
        const window = whatsappWindow(last, now);
        return {
          id: c.id,
          name: c.name,
          role: c.role,
          whatsapp: number ? { number, windowOpenUntil: window.open ? window.closesAt : undefined, daysSinceLast: last ? Math.floor((now - new Date(last).getTime()) / 86_400_000) : undefined } : undefined,
          email: c.email,
        };
      }),
    optOut: { whatsapp: Boolean(client.communicationOptOut?.whatsapp), email: Boolean(client.communicationOptOut?.email) },
    whatsappConnected: isConnected("whatsapp"),
  };
}
