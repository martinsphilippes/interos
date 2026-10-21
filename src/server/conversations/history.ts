import "server-only";
/**
 * Histórico de atendimentos (/comunicacao/historico): conversas encerradas de qualquer canal, no escopo da tela
 * comunicacao.historico (operador: as suas; gestor: a equipe; direção: todas — com "meus", as encerradas sem
 * responsável das filas da pessoa também).
 *
 * Consulta limitada ao período (até 12 meses) e a HISTORY_LIMIT conversas, mais recentes primeiro. A busca olha o
 * contato (nome, telefone, e-mail, número AT) e, com 3+ letras, o texto das mensagens e notas do período.
 */
import { getById, getManyByIds, list } from "@/server/db";
import { can, canSeeHref } from "@/server/auth/session";
import { computeSlaState } from "@/server/sla";
import { COLLECTIONS, type CurrentUser, type Communication, type Conversation, type ConversationChannel, type ConversationCloseReason, type SupportTicket, type User } from "@/domain/types";
import { CLOSE_REASON_LABELS, isOpenConversation } from "@/domain/conversations";
import { firstResponseMs, snippetAround, textMatches } from "@/domain/conversation-history";
import { displayPhone } from "@/domain/phone";
import { listQueues } from "./queues";
import { accessContext, buildThread, conversationInScope, loadNames, nameOf, type ThreadEntry } from "./queries";
import { findOpenConversation } from "./service";

export const HISTORY_LIMIT = 500;
const EXPORT_LIMIT = 5000;

export interface HistoryFilters {
  q?: string;
  channel?: ConversationChannel;
  queueId?: string;
  assigneeId?: string;
  reason?: ConversationCloseReason;
  sla?: "dentro" | "estourado";
  days: number;
}

export interface HistoryRow {
  id: string;
  number: string;
  channel: ConversationChannel;
  name: string;
  subtitle: string;
  address: string;
  clientId?: string;
  queueName?: string;
  assigneeName?: string;
  openedAt: string;
  closedAt: string;
  firstResponseMs?: number;
  /** Resultado do SLA (sem regra na fila = sem SLA). */
  sla?: "dentro" | "estourado";
  reason?: ConversationCloseReason;
  reasonLabel?: string;
  summary?: string;
  ticket?: { id: string; number: string };
  /** Trecho que casou com a busca (quando veio do texto da conversa). */
  snippet?: string;
}

export interface HistoryResult {
  rows: HistoryRow[];
  /** Mais conversas que o limite: refine o filtro. */
  truncated: boolean;
  queues: { id: string; name: string }[];
  operators: { id: string; name: string }[];
  scopeKind: string;
}

interface Loaded {
  rows: HistoryRow[];
  conversations: Map<string, Conversation>;
  truncated: boolean;
  queues: { id: string; name: string }[];
  operators: { id: string; name: string }[];
  scopeKind: string;
}

async function load(user: CurrentUser, f: HistoryFilters, limit: number): Promise<Loaded> {
  const since = new Date(Date.now() - f.days * 86_400_000).toISOString();
  const queues = await listQueues();
  const ctx = await accessContext(user, queues, "comunicacao.historico");
  let items = (await list<Conversation>(COLLECTIONS.conversations, { where: [["status", "==", "encerrada"]] })).filter((c) => (c.closedAt ?? c.lastMessageAt) >= since && conversationInScope(c, ctx));
  // Opções dos filtros saem do escopo inteiro do período (antes dos outros filtros).
  const operatorIds = Array.from(new Set(items.map((c) => c.assigneeId).filter((x): x is string => Boolean(x))));
  if (f.channel) items = items.filter((c) => c.channel === f.channel);
  if (f.queueId) items = items.filter((c) => c.queueId === f.queueId);
  if (f.assigneeId) items = items.filter((c) => c.assigneeId === f.assigneeId);
  if (f.reason) items = items.filter((c) => c.closeReason === f.reason);

  const names = await loadNames(items, queues);
  const operators = await getManyByIds<User>(COLLECTIONS.users, operatorIds);

  if (f.sla) {
    items = items.filter((c) => {
      const sla = c.slaInstanceId ? names.slas.get(c.slaInstanceId) : undefined;
      if (!sla) return false;
      const late = computeSlaState(sla).state === "violado";
      return f.sla === "estourado" ? late : !late;
    });
  }

  const snippets = new Map<string, string>();
  const q = f.q?.trim();
  if (q) {
    const byMeta = new Set(
      items
        .filter((c) => {
          const { name, subtitle } = nameOf(c, names);
          return textMatches(q, [name, subtitle, c.address, c.displayName, c.number, c.closeSummary, c.subject]);
        })
        .map((c) => c.id),
    );
    // Texto das mensagens: só com 3+ caracteres (evita varrer o período para «a»).
    if (q.replace(/\s/g, "").length >= 3) {
      const rest = items.filter((c) => !byMeta.has(c.id)).map((c) => c.id);
      if (rest.length) {
        const messages = await list<Communication>(COLLECTIONS.communications, { where: [["conversationId", "in", rest]] });
        for (const m of messages) {
          if (m.conversationId && !snippets.has(m.conversationId) && m.body && textMatches(q, [m.body])) snippets.set(m.conversationId, snippetAround(m.body, q));
        }
      }
    }
    items = items.filter((c) => byMeta.has(c.id) || snippets.has(c.id));
  }

  items.sort((a, b) => ((a.closedAt ?? "") < (b.closedAt ?? "") ? 1 : -1));
  const truncated = items.length > limit;
  items = items.slice(0, limit);

  const tickets = await getManyByIds<SupportTicket>(COLLECTIONS.supportTickets, items.map((c) => c.ticketId ?? "").filter(Boolean));
  const rows = items.map((c): HistoryRow => {
    const { name, subtitle } = nameOf(c, names);
    const sla = c.slaInstanceId ? names.slas.get(c.slaInstanceId) : undefined;
    const ticket = c.ticketId ? tickets.get(c.ticketId) : undefined;
    return {
      id: c.id,
      number: c.number,
      channel: c.channel,
      name,
      subtitle,
      address: c.channel === "whatsapp" ? displayPhone(c.address) : c.address,
      clientId: c.clientId,
      queueName: c.queueId ? names.queues.get(c.queueId)?.name : undefined,
      assigneeName: c.assigneeId ? (names.users.get(c.assigneeId)?.name ?? operators.get(c.assigneeId)?.name) : undefined,
      openedAt: c.openedAt,
      closedAt: c.closedAt ?? c.lastMessageAt,
      firstResponseMs: firstResponseMs(c),
      sla: sla ? (computeSlaState(sla).state === "violado" ? "estourado" : "dentro") : undefined,
      reason: c.closeReason,
      reasonLabel: c.closeReason ? CLOSE_REASON_LABELS[c.closeReason] : undefined,
      summary: c.closeSummary,
      ticket: ticket ? { id: ticket.id, number: ticket.number } : undefined,
      snippet: snippets.get(c.id),
    };
  });
  return {
    rows,
    conversations: new Map(items.map((c) => [c.id, c])),
    truncated,
    queues: queues.filter((q) => q.active || items.some((c) => c.queueId === q.id)).map((q) => ({ id: q.id, name: q.name })),
    operators: operatorIds
      .map((id) => ({ id, name: operators.get(id)?.name ?? "Usuário removido" }))
      .sort((a, b) => a.name.localeCompare(b.name, "pt-BR")),
    scopeKind: ctx.scope.kind,
  };
}

export async function getHistory(user: CurrentUser, filters: HistoryFilters): Promise<HistoryResult> {
  const { rows, truncated, queues, operators, scopeKind } = await load(user, filters, HISTORY_LIMIT);
  return { rows, truncated, queues, operators, scopeKind };
}

export interface HistoryPreview {
  row: HistoryRow;
  thread: ThreadEntry[];
  messageCount: number;
  /** Pode reabrir (permissão) — e, se não pode agora, por quê (outro atendimento aberto). */
  canReopen: boolean;
  openElsewhere?: { id: string; number: string };
  canOpenClient: boolean;
}

/** Conversa encerrada para a prévia. `row` vem da lista já filtrada pelo escopo: fora dela = null. */
export async function getHistoryPreview(user: CurrentUser, id: string, row: HistoryRow | undefined): Promise<HistoryPreview | null> {
  if (!row) return null;
  const c = await getById<Conversation>(COLLECTIONS.conversations, id);
  if (!c || c.id !== row.id || isOpenConversation(c)) return null;
  const messages = await list<Communication>(COLLECTIONS.communications, { where: [["conversationId", "==", c.id]] });
  const authorIds = messages.map((m) => m.userId ?? m.createdBy).filter((x): x is string => Boolean(x));
  const authors = await getManyByIds<User>(COLLECTIONS.users, [...authorIds, c.closedById ?? ""]);
  const thread = buildThread(c, messages, authors, { viewerId: user.id, customerName: row.name, customerRole: row.subtitle });
  const other = await findOpenConversation(c.channel, c.contactKey);
  return {
    row,
    thread,
    messageCount: thread.filter((t) => t.kind === "message").length,
    canReopen: can(user, "comunicacao.historico.reabrir"),
    openElsewhere: other ? { id: other.id, number: other.number } : undefined,
    canOpenClient: Boolean(c.clientId) && canSeeHref(user, `/clientes/${c.clientId}`),
  };
}

/** Linhas para o CSV (mesmos filtros e escopo da tela; até 5.000). */
export async function getHistoryForExport(user: CurrentUser, filters: HistoryFilters): Promise<{ rows: HistoryRow[]; truncated: boolean }> {
  const { rows, truncated } = await load(user, filters, EXPORT_LIMIT);
  return { rows, truncated };
}

/** A conversa está no escopo do histórico do usuário? (actions) */
export async function historyConversationInScope(user: CurrentUser, c: Conversation): Promise<boolean> {
  return conversationInScope(c, await accessContext(user, undefined, "comunicacao.historico"));
}
