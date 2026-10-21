import "server-only";
/**
 * Leituras da Central de Atendimento (lista de conversas e conversa aberta com o contexto do cliente).
 *
 * Escopo (catálogo comunicacao.central): "meus" = conversas comigo + as sem responsável das filas em que sou operador;
 * "equipe" = as minhas e dos meus liderados (+ a fila); "empresa" = todas. A mesma regra vale para abrir por id
 * (`?conversa=`) e para as actions (assertConversationAccess).
 */
import { getById, getManyByIds, list } from "@/server/db";
import { can } from "@/server/auth/session";
import { resolveDataScope, type DataScope } from "@/server/auth/scope";
import { computeSlaState } from "@/server/sla";
import { isConnected } from "@/server/integrations/status";
import { communicationStatusLabel } from "@/server/integrations/communications";
import { isOpenTicket } from "@/server/support/service";
import {
  COLLECTIONS,
  type Client,
  type Communication,
  type Contact,
  type Conversation,
  type ConversationChannel,
  type CurrentUser,
  type Lead,
  type ChannelEvent,
  type ServiceQueue,
  type SlaInstance,
  type SlaRule,
  type SupportTicket,
  type User,
} from "@/domain/types";
import type { SlaState } from "@/domain/constants";
import { displayPhone } from "@/domain/phone";
import { CLOSE_REASON_LABELS, CONVERSATION_STATUS_LABELS, isOpenConversation, whatsappWindow, type WindowState } from "@/domain/conversations";
import { listQueues, queuesOf } from "./queues";
import { NOTE_TEMPLATE_KEY } from "./service";

export const CENTRAL_TABS = ["minhas", "fila", "aguardando", "todas"] as const;
export type CentralTab = (typeof CENTRAL_TABS)[number];

export function isCentralTab(v: unknown): v is CentralTab {
  return typeof v === "string" && (CENTRAL_TABS as readonly string[]).includes(v);
}

const OPEN_STATUSES = ["nova", "na_fila", "em_atendimento", "aguardando_cliente"] as const;

export interface ConversationRow {
  id: string;
  number: string;
  channel: ConversationChannel;
  status: Conversation["status"];
  statusLabel: string;
  name: string;
  /** Empresa, "Lead" ou "Não identificado". */
  subtitle: string;
  identity: Conversation["identity"];
  preview?: string;
  lastMessageAt: string;
  lastMessageDirection?: "entrada" | "saida";
  awaitingReply: boolean;
  /** Desde quando o cliente espera resposta (última mensagem dele sem resposta). */
  waitingSince?: string;
  assigneeId?: string;
  assigneeName?: string;
  queueId?: string;
  queueName?: string;
  sla?: { state: SlaState; dueAt: string };
  /** WhatsApp: a janela de 24 h está aberta (dá para responder com texto livre). */
  windowOpen: boolean;
}

export interface CentralOverview {
  tab: CentralTab;
  rows: ConversationRow[];
  counts: Record<CentralTab, number>;
  queues: { id: string; name: string; waiting: number }[];
  /** Filas em que o usuário é operador. */
  myQueueIds: string[];
  /** Limite do escopo (o "todas" mostra até onde ele vai). */
  scopeKind: DataScope["kind"];
  generatedAt: number;
}

// ---------------------------------------------------------------------------
// Escopo
// ---------------------------------------------------------------------------

interface AccessContext {
  scope: DataScope;
  myQueueIds: Set<string>;
  /** Filas ativas sem nenhum operador: o que espera nelas fica visível para qualquer operador (ninguém fica sem ver). */
  orphanQueueIds: Set<string>;
}

async function accessContext(user: CurrentUser, queues?: ServiceQueue[]): Promise<AccessContext> {
  const [scope, all] = await Promise.all([resolveDataScope(user, "comunicacao.central"), queues ? Promise.resolve(queues) : listQueues()]);
  return { scope, myQueueIds: new Set(queuesOf(all, user.id).map((q) => q.id)), orphanQueueIds: new Set(all.filter((q) => q.active && q.memberIds.length === 0).map((q) => q.id)) };
}

/** A conversa entra no escopo do usuário? */
export function conversationInScope(c: Pick<Conversation, "assigneeId" | "queueId">, ctx: AccessContext): boolean {
  const { scope } = ctx;
  if (!scope.userIds && !scope.departmentKeys) return true;
  if (c.assigneeId) return Boolean(scope.userIds?.has(c.assigneeId));
  // Sem responsável: as filas em que a pessoa está, filas sem operador ou conversa ainda sem fila.
  return !c.queueId || ctx.myQueueIds.has(c.queueId) || ctx.orphanQueueIds.has(c.queueId);
}

/** Para as actions: carrega a conversa e confere o escopo. Fora do escopo = "não encontrada" (não revela que existe). */
export async function loadConversationInScope(user: CurrentUser, id: string): Promise<Conversation | null> {
  const c = await getById<Conversation>(COLLECTIONS.conversations, id);
  if (!c) return null;
  return conversationInScope(c, await accessContext(user)) ? c : null;
}

// ---------------------------------------------------------------------------
// Lista
// ---------------------------------------------------------------------------

interface Names {
  clients: Map<string, Client>;
  contacts: Map<string, Contact>;
  leads: Map<string, Lead>;
  users: Map<string, User>;
  queues: Map<string, ServiceQueue>;
  slas: Map<string, SlaInstance>;
}

async function loadNames(items: Conversation[], queues: ServiceQueue[]): Promise<Names> {
  const ids = (f: (c: Conversation) => string | undefined) => items.map(f).filter((x): x is string => Boolean(x));
  const [clients, contacts, leads, users, slas] = await Promise.all([
    getManyByIds<Client>(COLLECTIONS.clients, ids((c) => c.clientId)),
    getManyByIds<Contact>(COLLECTIONS.contacts, ids((c) => c.contactId)),
    getManyByIds<Lead>(COLLECTIONS.leads, ids((c) => c.leadId)),
    getManyByIds<User>(COLLECTIONS.users, ids((c) => c.assigneeId)),
    getManyByIds<SlaInstance>(COLLECTIONS.slaInstances, ids((c) => c.slaInstanceId)),
  ]);
  return { clients, contacts, leads, users, slas, queues: new Map(queues.map((q) => [q.id, q])) };
}

function nameOf(c: Conversation, n: Pick<Names, "clients" | "contacts" | "leads">): { name: string; subtitle: string } {
  const client = c.clientId ? n.clients.get(c.clientId) : undefined;
  const contact = c.contactId ? n.contacts.get(c.contactId) : undefined;
  const lead = c.leadId ? n.leads.get(c.leadId) : undefined;
  if (contact) return { name: contact.name, subtitle: client?.tradeName ?? "Cliente" };
  if (client) return { name: client.tradeName, subtitle: "Cliente" };
  if (lead) return { name: lead.name, subtitle: lead.company ? `Lead · ${lead.company}` : "Lead" };
  const address = c.channel === "whatsapp" ? displayPhone(c.address) : c.address;
  return { name: c.displayName || address, subtitle: c.displayName ? `${address} · não identificado` : "Não identificado" };
}

function toRow(c: Conversation, n: Names, now: number): ConversationRow {
  const { name, subtitle } = nameOf(c, n);
  const sla = c.slaInstanceId ? n.slas.get(c.slaInstanceId) : undefined;
  const view = sla ? computeSlaState(sla, new Date(now)) : undefined;
  return {
    id: c.id,
    number: c.number,
    channel: c.channel,
    status: c.status,
    statusLabel: CONVERSATION_STATUS_LABELS[c.status],
    name,
    subtitle,
    identity: c.identity,
    preview: c.lastMessagePreview,
    lastMessageAt: c.lastMessageAt,
    lastMessageDirection: c.lastMessageDirection,
    awaitingReply: c.awaitingReply,
    waitingSince: c.awaitingReply ? c.lastInboundAt : undefined,
    assigneeId: c.assigneeId,
    assigneeName: c.assigneeId ? n.users.get(c.assigneeId)?.name : undefined,
    queueId: c.queueId,
    queueName: c.queueId ? n.queues.get(c.queueId)?.name : undefined,
    sla: view ? { state: view.state, dueAt: view.dueAt } : undefined,
    windowOpen: c.channel !== "whatsapp" || whatsappWindow(c.lastInboundAt, now).open,
  };
}

/** Quem espera resposta primeiro (o mais antigo no topo); depois o resto, mais recente primeiro. */
function sortRows(rows: ConversationRow[]): ConversationRow[] {
  return [...rows].sort((a, b) => {
    if (a.awaitingReply !== b.awaitingReply) return a.awaitingReply ? -1 : 1;
    if (a.awaitingReply) return (a.waitingSince ?? a.lastMessageAt) < (b.waitingSince ?? b.lastMessageAt) ? -1 : 1;
    return a.lastMessageAt < b.lastMessageAt ? 1 : -1;
  });
}

export interface CentralFilters {
  tab?: CentralTab;
  queueId?: string;
  channel?: ConversationChannel;
  q?: string;
}

function matchesText(row: ConversationRow, q: string): boolean {
  const t = q.trim().toLowerCase();
  if (!t) return true;
  const digits = t.replace(/\D/g, "");
  return [row.name, row.subtitle, row.number, row.preview].some((v) => v?.toLowerCase().includes(t)) || (digits.length >= 4 && row.subtitle.replace(/\D/g, "").includes(digits));
}

export async function getCentralOverview(user: CurrentUser, filters: CentralFilters = {}): Promise<CentralOverview> {
  const now = Date.now();
  const queues = await listQueues();
  const ctx = await accessContext(user, queues);
  const open = (await list<Conversation>(COLLECTIONS.conversations, { where: [["status", "in", [...OPEN_STATUSES]]] })).filter((c) => conversationInScope(c, ctx));
  const names = await loadNames(open, queues);
  let rows = open.map((c) => toRow(c, names, now));
  if (filters.queueId) rows = rows.filter((r) => r.queueId === filters.queueId);
  if (filters.channel) rows = rows.filter((r) => r.channel === filters.channel);
  if (filters.q) rows = rows.filter((r) => matchesText(r, filters.q!));

  const inTab: Record<CentralTab, (r: ConversationRow) => boolean> = {
    minhas: (r) => r.assigneeId === user.id && r.status !== "aguardando_cliente",
    fila: (r) => !r.assigneeId,
    aguardando: (r) => r.assigneeId === user.id && r.status === "aguardando_cliente",
    todas: () => true,
  };
  const counts = Object.fromEntries(CENTRAL_TABS.map((t) => [t, rows.filter(inTab[t]).length])) as Record<CentralTab, number>;
  // Sem conversas minhas, abre a fila (o operador começa o dia pela fila).
  const tab = filters.tab ?? (counts.minhas > 0 ? "minhas" : counts.fila > 0 ? "fila" : "minhas");
  const waitingByQueue = new Map<string, number>();
  for (const c of open) if (!c.assigneeId && c.queueId) waitingByQueue.set(c.queueId, (waitingByQueue.get(c.queueId) ?? 0) + 1);

  return {
    tab,
    rows: sortRows(rows.filter(inTab[tab])),
    counts,
    queues: queues.filter((q) => q.active && (!ctx.scope.userIds || ctx.myQueueIds.has(q.id) || ctx.orphanQueueIds.has(q.id))).map((q) => ({ id: q.id, name: q.name, waiting: waitingByQueue.get(q.id) ?? 0 })),
    myQueueIds: Array.from(ctx.myQueueIds),
    scopeKind: ctx.scope.kind,
    generatedAt: now,
  };
}

// ---------------------------------------------------------------------------
// Conversa aberta
// ---------------------------------------------------------------------------

/** Item da conversa (serializável; a tela converte em ThreadItem da ConversationThread). */
export type ThreadEntry =
  | { kind: "message"; id: string; at: string; direction: "entrada" | "saida"; authorName: string; authorRole?: string; body: string; channel: ConversationChannel; manual: boolean; delivered: boolean; statusLabel: string }
  | { kind: "note"; id: string; at: string; authorName: string; body: string }
  | { kind: "system"; id: string; at: string; title: string; description?: string };

export interface ConversationContext {
  client?: { id: string; tradeName: string; status: Client["status"]; healthScore?: number; healthLevel?: Client["healthLevel"]; mrr: number };
  contact?: { id: string; name: string; role?: string };
  contacts: { id: string; name: string; role?: string; whatsapp?: string; phone?: string; email?: string; isPrimary: boolean }[];
  lead?: { id: string; name: string; company?: string; status: Lead["status"]; origin: string; ownerName?: string; score: number };
  openTickets: { id: string; number: string; subject: string; status: SupportTicket["status"]; priority: SupportTicket["priority"] }[];
  previous: { id: string; number: string; channel: ConversationChannel; at: string; reason?: string; assigneeName?: string }[];
}

export interface ConversationCapabilities {
  reply: boolean;
  note: boolean;
  assume: boolean;
  transfer: boolean;
  close: boolean;
  identify: boolean;
  assign: boolean;
  createTicket: boolean;
  createLead: boolean;
}

export interface ConversationDetail {
  conversation: Conversation;
  row: ConversationRow;
  thread: ThreadEntry[];
  window: WindowState;
  /** O canal da conversa está conectado ao provedor (senão, tudo é registro manual). */
  channelConnected: boolean;
  /** Prazo da primeira resposta e da solução (regra da fila). */
  sla?: { state: SlaState; dueAt: string; responseDueAt?: string; respondedAt?: string };
  context: ConversationContext;
  capabilities: ConversationCapabilities;
}

export async function getConversationDetail(user: CurrentUser, id: string): Promise<ConversationDetail | null> {
  const conversation = await loadConversationInScope(user, id);
  if (!conversation) return null;
  const now = Date.now();
  const queues = await listQueues();
  const names = await loadNames([conversation], queues);
  const row = toRow(conversation, names, now);

  const [messages, contacts, tickets, previousAll] = await Promise.all([
    list<Communication>(COLLECTIONS.communications, { where: [["conversationId", "==", conversation.id]] }),
    conversation.clientId ? list<Contact>(COLLECTIONS.contacts, { where: [["clientId", "==", conversation.clientId]] }) : Promise.resolve([] as Contact[]),
    conversation.clientId ? list<SupportTicket>(COLLECTIONS.supportTickets, { where: [["clientId", "==", conversation.clientId]] }) : Promise.resolve([] as SupportTicket[]),
    list<Conversation>(COLLECTIONS.conversations, { where: [["contactKey", "==", conversation.contactKey]] }),
  ]);
  const authorIds = messages.map((m) => m.userId ?? m.createdBy).filter((x): x is string => Boolean(x));
  const previous = previousAll.filter((c) => c.id !== conversation.id && !isOpenConversation(c)).sort((a, b) => ((a.closedAt ?? a.openedAt) < (b.closedAt ?? b.openedAt) ? 1 : -1)).slice(0, 5);
  const authors = await getManyByIds<User>(COLLECTIONS.users, [...authorIds, ...previous.map((p) => p.assigneeId ?? "")]);
  const customerName = row.name;

  const thread: ThreadEntry[] = [];
  for (const m of messages.sort((a, b) => (a.createdAt < b.createdAt ? -1 : 1))) {
    const author = m.userId ?? m.createdBy;
    const authorName = author ? (authors.get(author)?.name ?? (author === "sistema" ? "Central de Atendimento" : "Equipe")) : "Equipe";
    if (m.templateKey === NOTE_TEMPLATE_KEY) {
      thread.push({ kind: "note", id: m.id, at: m.createdAt, authorName, body: m.body ?? "" });
      continue;
    }
    if (m.channel !== "whatsapp" && m.channel !== "email") continue;
    thread.push({
      kind: "message",
      id: m.id,
      at: m.createdAt,
      direction: m.direction,
      authorName: m.direction === "entrada" ? customerName : author === user.id ? "Você" : authorName,
      authorRole: m.direction === "entrada" ? row.subtitle : undefined,
      body: m.body ?? "",
      channel: m.channel,
      manual: m.status === "manual",
      delivered: m.status === "entregue" || m.status === "lida",
      statusLabel: communicationStatusLabel(m.status),
    });
    if (m.direction === "saida" && (m.status === "falha" || m.status === "nao_enviada")) {
      thread.push({ kind: "system", id: `${m.id}_erro`, at: m.createdAt, title: m.status === "falha" ? "Falha no envio" : "Não enviada", description: m.error });
    }
  }
  if (conversation.status === "encerrada" && conversation.closedAt) {
    const closer = conversation.closedById ? (authors.get(conversation.closedById)?.name ?? "") : "";
    thread.push({ kind: "system", id: `${conversation.id}_fim`, at: conversation.closedAt, title: `Atendimento encerrado${closer ? ` por ${closer}` : ""}`, description: [conversation.closeReason ? CLOSE_REASON_LABELS[conversation.closeReason] : undefined, conversation.closeSummary].filter(Boolean).join(" · ") });
  }

  const client = conversation.clientId ? names.clients.get(conversation.clientId) : undefined;
  const contact = conversation.contactId ? names.contacts.get(conversation.contactId) : undefined;
  const lead = conversation.leadId ? names.leads.get(conversation.leadId) : undefined;
  const leadOwner = lead?.ownerId ? await getById<User>(COLLECTIONS.users, lead.ownerId) : null;
  const sla = conversation.slaInstanceId ? names.slas.get(conversation.slaInstanceId) : undefined;
  const slaView = sla ? computeSlaState(sla, new Date(now)) : undefined;

  const open = isOpenConversation(conversation);
  const capabilities: ConversationCapabilities = {
    reply: open && can(user, "comunicacao.central.atender"),
    note: can(user, "comunicacao.central.atender"),
    assume: open && conversation.assigneeId !== user.id && can(user, "comunicacao.central.atender") && (!conversation.assigneeId || can(user, "comunicacao.central.distribuir")),
    transfer: open && can(user, "comunicacao.central.transferir"),
    close: open && can(user, "comunicacao.central.encerrar"),
    identify: can(user, "comunicacao.central.identificar"),
    assign: open && can(user, "comunicacao.central.distribuir"),
    createTicket: can(user, "suporte.chamados.criar"),
    createLead: can(user, "marketing.leads.criar"),
  };

  return {
    conversation,
    row,
    thread,
    window: conversation.channel === "whatsapp" ? whatsappWindow(conversation.lastInboundAt, now) : { open: true },
    channelConnected: isConnected(conversation.channel === "whatsapp" ? "whatsapp" : "email"),
    sla: slaView && sla ? { state: slaView.state, dueAt: slaView.dueAt, responseDueAt: sla.responseDueAt, respondedAt: sla.respondedAt } : undefined,
    context: {
      client: client ? { id: client.id, tradeName: client.tradeName, status: client.status, healthScore: client.healthScore, healthLevel: client.healthLevel, mrr: client.mrr } : undefined,
      contact: contact ? { id: contact.id, name: contact.name, role: contact.role } : undefined,
      contacts: contacts
        .sort((a, b) => Number(b.isPrimary) - Number(a.isPrimary) || a.name.localeCompare(b.name, "pt-BR"))
        .slice(0, 6)
        .map((c) => ({ id: c.id, name: c.name, role: c.role, whatsapp: c.whatsapp, phone: c.phone, email: c.email, isPrimary: c.isPrimary })),
      lead: lead ? { id: lead.id, name: lead.name, company: lead.company, status: lead.status, origin: lead.origin, ownerName: leadOwner?.name, score: lead.score } : undefined,
      openTickets: tickets
        .filter(isOpenTicket)
        .sort((a, b) => (a.openedAt < b.openedAt ? 1 : -1))
        .slice(0, 5)
        .map((t) => ({ id: t.id, number: t.number, subject: t.subject, status: t.status, priority: t.priority })),
      previous: previous.map((p) => ({ id: p.id, number: p.number, channel: p.channel, at: p.closedAt ?? p.openedAt, reason: p.closeReason ? CLOSE_REASON_LABELS[p.closeReason] : undefined, assigneeName: p.assigneeId ? authors.get(p.assigneeId)?.name : undefined })),
    },
    capabilities,
  };
}

/** Pessoas para transferir/atribuir: operadores das filas ativas (com presença e carga). */
export async function getTransferOptions(): Promise<{ users: { id: string; name: string; presence?: User["presence"]; load: number; queueNames: string[] }[]; queues: { id: string; name: string; channels: ConversationChannel[] }[] }> {
  const queues = (await listQueues()).filter((q) => q.active);
  const memberIds = Array.from(new Set(queues.flatMap((q) => q.memberIds)));
  const [users, open] = await Promise.all([
    getManyByIds<User>(COLLECTIONS.users, memberIds),
    list<Conversation>(COLLECTIONS.conversations, { where: [["status", "in", ["em_atendimento", "aguardando_cliente"]]] }),
  ]);
  const load = new Map<string, number>();
  for (const c of open) if (c.assigneeId) load.set(c.assigneeId, (load.get(c.assigneeId) ?? 0) + 1);
  return {
    users: Array.from(users.values())
      .filter((u) => u.active !== false)
      .map((u) => ({ id: u.id, name: u.name, presence: u.presence, load: load.get(u.id) ?? 0, queueNames: queues.filter((q) => q.memberIds.includes(u.id)).map((q) => q.name) }))
      .sort((a, b) => a.name.localeCompare(b.name, "pt-BR")),
    queues: queues.map((q) => ({ id: q.id, name: q.name, channels: q.channels })),
  };
}


// ---------------------------------------------------------------------------
// Canais e filas
// ---------------------------------------------------------------------------

export interface ChannelHealth {
  channel: ConversationChannel;
  /** Último aviso recebido do provedor (qualquer tipo). */
  lastEventAt?: string;
  failures24h: number;
  duplicates24h: number;
  received24h: number;
  rejected24h: number;
}

/** Saúde de cada canal nas últimas 24 h, pelos registros técnicos. */
export async function getChannelHealth(now: number = Date.now()): Promise<ChannelHealth[]> {
  const since = new Date(now - 24 * 3600_000).toISOString();
  const out: ChannelHealth[] = [];
  for (const channel of ["whatsapp", "email"] as const) {
    const events = await list<ChannelEvent>(COLLECTIONS.channelEvents, { where: [["channel", "==", channel]] });
    const recent = events.filter((e) => e.occurredAt >= since);
    out.push({
      channel,
      lastEventAt: events.reduce<string | undefined>((max, e) => (!max || e.occurredAt > max ? e.occurredAt : max), undefined),
      failures24h: recent.filter((e) => e.result === "falha").length,
      duplicates24h: recent.filter((e) => e.result === "duplicado").length,
      received24h: recent.filter((e) => e.kind === "mensagem_recebida" && e.result === "processado").length,
      rejected24h: recent.filter((e) => e.result === "recusado").length,
    });
  }
  return out;
}

export interface QueueAdminRow {
  queue: ServiceQueue;
  members: { id: string; name: string; presence?: User["presence"]; active: boolean }[];
  waiting: number;
  open: number;
  overflowName?: string;
}

export interface QueuesAdmin {
  rows: QueueAdminRow[];
  users: { id: string; name: string; departmentId: User["departmentId"] }[];
  slaRules: { key: string; name: string }[];
}

export async function getQueuesAdmin(): Promise<QueuesAdmin> {
  const [queues, users, rules, open] = await Promise.all([
    listQueues(),
    list<User>(COLLECTIONS.users),
    list<SlaRule>(COLLECTIONS.slaRules),
    list<Conversation>(COLLECTIONS.conversations, { where: [["status", "in", [...OPEN_STATUSES]]] }),
  ]);
  const byId = new Map(users.map((u) => [u.id, u]));
  const names = new Map(queues.map((q) => [q.id, q.name]));
  return {
    rows: queues.map((q) => ({
      queue: q,
      members: q.memberIds.map((id) => byId.get(id)).filter((u): u is User => Boolean(u)).map((u) => ({ id: u.id, name: u.name, presence: u.presence, active: u.active !== false })),
      waiting: open.filter((c) => c.queueId === q.id && !c.assigneeId).length,
      open: open.filter((c) => c.queueId === q.id).length,
      overflowName: q.overflowQueueId ? names.get(q.overflowQueueId) : undefined,
    })),
    users: users.filter((u) => u.active !== false).map((u) => ({ id: u.id, name: u.name, departmentId: u.departmentId })).sort((a, b) => a.name.localeCompare(b.name, "pt-BR")),
    slaRules: rules
      .filter((r) => r.active && (r.appliesTo === "conversa" || r.appliesTo === "chamado"))
      .map((r) => ({ key: r.key, name: r.name }))
      .sort((a, b) => a.name.localeCompare(b.name, "pt-BR")),
  };
}
