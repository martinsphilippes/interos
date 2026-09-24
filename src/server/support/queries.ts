import "server-only";
/**
 * Leituras do Suporte (Central, chamados, SLA, CSAT, base de conhecimento, ficha 360º).
 * Todas usam `list()` com igualdade e agregam em memória; nomes de clientes/usuários são resolvidos em lote.
 */
import { getById, getManyByIds, list } from "@/server/db";
import { computeSlaState } from "@/server/sla";
import { listSlaRules } from "@/server/admin/queries";
import { dateKey, formatCompetence } from "@/lib/format";
import {
  COLLECTIONS,
  type Client,
  type ClientProduct,
  type Contact,
  type Contract,
  type CsatResponse,
  type CurrentUser,
  type Document,
  type Kpi,
  type Opportunity,
  type Product,
  type Settings,
  type SlaInstance,
  type SlaRule,
  type SlaView,
  type SupportTicket,
  type User,
} from "@/domain/types";
import type { SlaState } from "@/domain/constants";
import { csatPath, getSupportTeam, isOpenTicket, type SlaInstanceExtra, type SupportTicketExtra, type TicketInteractionExtra } from "./service";
import { TICKET_PRIORITIES, canOperateSupport, type TicketPriority } from "./schemas";
import { normalizeText, plainText, rankArticles, type KnowledgeArticleExtra } from "./knowledge-search";

// ---------------------------------------------------------------------------
// Tipos compartilhados com os componentes
// ---------------------------------------------------------------------------

export interface SupportUser {
  id: string;
  name: string;
  avatarUrl?: string;
  jobTitle?: string;
}

/** Campos do SLA necessários para recalcular o estado no navegador (contagem regressiva). */
export interface SlaLive {
  status: SlaInstance["status"];
  startedAt: string;
  dueAt: string;
  responseDueAt?: string;
  respondedAt?: string;
  pausedAt?: string;
  pauseReason?: string;
  completedAt?: string;
  attentionPct: number;
  riskPct: number;
  ruleName: string;
  view: SlaView;
}

export interface TicketRow {
  id: string;
  number: string;
  clientId: string;
  clientName: string;
  productId?: string;
  productName?: string;
  subject: string;
  channel: SupportTicket["channel"];
  priority: SupportTicket["priority"];
  status: SupportTicket["status"];
  queue: string;
  category?: string;
  assigneeId?: string;
  assigneeName?: string;
  openedAt: string;
  firstResponseAt?: string;
  resolvedAt?: string;
  closedAt?: string;
  reopenedFromId?: string;
  reopenCount: number;
  csatScore?: number;
  rootCause?: string;
  open: boolean;
  sla?: SlaLive;
}

const toUser = (u: User): SupportUser => ({ id: u.id, name: u.name, avatarUrl: u.avatarUrl, jobTitle: u.jobTitle });

const PRIORITY_RANK: Record<TicketPriority, number> = { critico: 0, alto: 1, medio: 2, baixo: 3 };
const SLA_RANK: Partial<Record<SlaState, number>> = { violado: 0, em_risco: 1 };

/** Ordem da fila: SLA violado > em risco > criticidade > prazo mais próximo > mais antigo. */
export function compareQueue(a: TicketRow, b: TicketRow): number {
  const sa = a.open && a.sla ? (SLA_RANK[a.sla.view.state] ?? 2) : 3;
  const sb = b.open && b.sla ? (SLA_RANK[b.sla.view.state] ?? 2) : 3;
  if (sa !== sb) return sa - sb;
  const pa = PRIORITY_RANK[a.priority];
  const pb = PRIORITY_RANK[b.priority];
  if (pa !== pb) return pa - pb;
  const da = a.sla?.dueAt ?? "9";
  const db = b.sla?.dueAt ?? "9";
  if (da !== db) return da < db ? -1 : 1;
  return a.openedAt < b.openedAt ? -1 : 1;
}

function slaLive(sla: SlaInstance | undefined, now: Date): SlaLive | undefined {
  if (!sla) return undefined;
  return {
    status: sla.status,
    startedAt: sla.startedAt,
    dueAt: sla.dueAt,
    responseDueAt: sla.responseDueAt,
    respondedAt: sla.respondedAt,
    pausedAt: sla.pausedAt,
    pauseReason: sla.pauseReason,
    completedAt: sla.completedAt,
    attentionPct: sla.attentionPct,
    riskPct: sla.riskPct,
    ruleName: sla.ruleName,
    view: computeSlaState(sla, now),
  };
}

const monthKey = (iso: string | undefined) => (iso ? dateKey(iso).slice(0, 7) : "");

/** Últimos `n` meses (AAAA-MM), do mais antigo ao atual, no fuso da operação. */
function lastMonths(n: number, reference = new Date()): string[] {
  const [y, m] = dateKey(reference).slice(0, 7).split("-").map(Number);
  const out: string[] = [];
  for (let i = n - 1; i >= 0; i--) {
    const d = new Date(Date.UTC(y, m - 1 - i, 1));
    out.push(`${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, "0")}`);
  }
  return out;
}

const avg = (values: number[]) => (values.length ? values.reduce((s, v) => s + v, 0) / values.length : undefined);

// ---------------------------------------------------------------------------
// Base carregada uma vez por requisição
// ---------------------------------------------------------------------------

interface SupportBase {
  tickets: SupportTicketExtra[];
  slaByTicket: Map<string, SlaInstanceExtra>;
  clients: Map<string, Client>;
  users: Map<string, User>;
  products: Map<string, Product>;
}

async function loadBase(): Promise<SupportBase> {
  const [tickets, slas, products] = await Promise.all([
    list<SupportTicketExtra>(COLLECTIONS.supportTickets),
    list<SlaInstanceExtra>(COLLECTIONS.slaInstances, { where: [["entityType", "==", "chamado"]] }),
    list<Product>(COLLECTIONS.products),
  ]);
  const slaById = new Map(slas.map((s) => [s.id, s]));
  // Instância vigente: a referenciada pelo chamado; sem referência, a mais recente não substituída.
  const slaByTicket = new Map<string, SlaInstanceExtra>();
  for (const s of [...slas].sort((a, b) => (a.startedAt < b.startedAt ? -1 : 1))) if (!s.supersededBy) slaByTicket.set(s.entityId, s);
  for (const t of tickets) {
    const current = t.slaInstanceId ? slaById.get(t.slaInstanceId) : undefined;
    if (current) slaByTicket.set(t.id, current);
  }
  const [clients, users] = await Promise.all([
    getManyByIds<Client>(COLLECTIONS.clients, tickets.map((t) => t.clientId)),
    getManyByIds<User>(COLLECTIONS.users, tickets.map((t) => t.assigneeId ?? "")),
  ]);
  return { tickets, slaByTicket, clients, users, products: new Map(products.map((p) => [p.id, p])) };
}

function toRow(t: SupportTicketExtra, base: SupportBase, now: Date): TicketRow {
  return {
    id: t.id,
    number: t.number,
    clientId: t.clientId,
    clientName: base.clients.get(t.clientId)?.tradeName ?? "Cliente removido",
    productId: t.productId,
    productName: t.productId ? base.products.get(t.productId)?.name : undefined,
    subject: t.subject,
    channel: t.channel,
    priority: t.priority,
    status: t.status,
    queue: t.queue,
    category: t.category,
    assigneeId: t.assigneeId,
    assigneeName: t.assigneeId ? base.users.get(t.assigneeId)?.name : undefined,
    openedAt: t.openedAt,
    firstResponseAt: t.firstResponseAt,
    resolvedAt: t.resolvedAt,
    closedAt: t.closedAt,
    reopenedFromId: t.reopenedFromId,
    reopenCount: t.reopenCount ?? 0,
    csatScore: t.csatScore,
    rootCause: t.rootCause,
    open: isOpenTicket(t),
    sla: slaLive(base.slaByTicket.get(t.id), now),
  };
}

// ---------------------------------------------------------------------------
// Opções de formulário e filtros
// ---------------------------------------------------------------------------

export interface SupportOptions {
  clients: { id: string; name: string; document?: string; city?: string }[];
  products: { id: string; name: string; category: Product["category"] }[];
  team: SupportUser[];
  categories: string[];
  /** Prazos das regras suporte.<criticidade> (exibidos no formulário). */
  slaRules: { priority: TicketPriority; responseHours?: number; resolutionHours: number; businessHoursOnly: boolean }[];
  canOperate: boolean;
}

export async function getSupportOptions(user: CurrentUser): Promise<SupportOptions> {
  const [clients, products, team, tickets, rules] = await Promise.all([
    list<Client>(COLLECTIONS.clients),
    list<Product>(COLLECTIONS.products),
    getSupportTeam(),
    list<SupportTicket>(COLLECTIONS.supportTickets),
    listSlaRules(),
  ]);
  const categories = Array.from(new Set(tickets.map((t) => t.category).filter((c): c is string => Boolean(c)))).sort((a, b) => a.localeCompare(b, "pt-BR"));
  return {
    clients: clients
      .filter((c) => c.status !== "lead")
      .sort((a, b) => a.tradeName.localeCompare(b.tradeName, "pt-BR"))
      .map((c) => ({ id: c.id, name: c.tradeName, document: c.document, city: c.address?.city })),
    products: products
      .filter((p) => p.active !== false)
      .sort((a, b) => a.order - b.order)
      .map((p) => ({ id: p.id, name: p.name, category: p.category })),
    team: team.map(toUser),
    categories,
    slaRules: TICKET_PRIORITIES.flatMap((priority) => {
      const rule = rules.find((r) => r.key === `suporte.${priority}` && r.active !== false);
      return rule ? [{ priority, responseHours: rule.responseHours, resolutionHours: rule.resolutionHours, businessHoursOnly: rule.businessHoursOnly }] : [];
    }),
    canOperate: canOperateSupport(user),
  };
}

export interface ClientTicketContext {
  contacts: { id: string; name: string; role?: string; isPrimary: boolean }[];
  products: { id: string; name: string; status: ClientProduct["status"] }[];
}

/** Contatos e produtos do cliente escolhido no formulário de novo chamado. */
export async function getClientTicketContext(clientId: string): Promise<ClientTicketContext> {
  const [contacts, products] = await Promise.all([
    list<Contact>(COLLECTIONS.contacts, { where: [["clientId", "==", clientId]] }),
    list<ClientProduct>(COLLECTIONS.clientProducts, { where: [["clientId", "==", clientId]] }),
  ]);
  return {
    contacts: contacts
      .sort((a, b) => Number(b.isPrimary) - Number(a.isPrimary) || a.name.localeCompare(b.name, "pt-BR"))
      .map((c) => ({ id: c.id, name: c.name, role: c.role, isPrimary: c.isPrimary })),
    products: products
      .filter((p) => p.status !== "cancelado")
      .map((p) => ({ id: p.productId, name: p.productName, status: p.status })),
  };
}

// ---------------------------------------------------------------------------
// Lista de chamados
// ---------------------------------------------------------------------------

export interface TicketFilters {
  status?: SupportTicket["status"][];
  priority?: TicketPriority;
  queue?: string;
  assigneeId?: string;
  channel?: SupportTicket["channel"];
  productId?: string;
  clientId?: string;
  openOnly?: boolean;
}

export async function listTickets(filters: TicketFilters = {}): Promise<TicketRow[]> {
  const now = new Date();
  const base = await loadBase();
  let tickets = base.tickets;
  if (filters.openOnly) tickets = tickets.filter(isOpenTicket);
  if (filters.status?.length) tickets = tickets.filter((t) => filters.status!.includes(t.status));
  if (filters.priority) tickets = tickets.filter((t) => t.priority === filters.priority);
  if (filters.queue) tickets = tickets.filter((t) => t.queue === filters.queue);
  if (filters.assigneeId) tickets = tickets.filter((t) => t.assigneeId === filters.assigneeId);
  if (filters.channel) tickets = tickets.filter((t) => t.channel === filters.channel);
  if (filters.productId) tickets = tickets.filter((t) => t.productId === filters.productId);
  if (filters.clientId) tickets = tickets.filter((t) => t.clientId === filters.clientId);
  return tickets.map((t) => toRow(t, base, now)).sort(compareQueue);
}

// ---------------------------------------------------------------------------
// Central de Atendimento
// ---------------------------------------------------------------------------

export type OverviewScope = "minha" | "equipe";

export interface SupportOverview {
  scope: OverviewScope;
  /** Instante do cálculo (ms): referência dos relógios de SLA no navegador até a hidratação. */
  generatedAt: number;
  rows: TicketRow[];
  stats: {
    open: number;
    inProgress: number;
    waiting: number;
    atRisk: number;
    breached: number;
    resolvedToday: number;
    responsePending: number;
    backlog: number;
    csatAverage?: number;
    csatCount: number;
    csatTarget: number;
    reopenRate?: number;
    reopenedMonth: number;
    resolvedMonth: number;
    reopenTarget: number;
    /** Cumprimento do SLA de solução no mês (fração 0–1; undefined sem base) e sua base. */
    slaCompliance?: number;
    slaMet: number;
    slaEvaluated: number;
    slaTarget: number;
  };
}

interface Targets {
  csat: number;
  reopenMax: number;
  slaResolution: number;
  slaResponse: number;
}

async function getTargets(): Promise<Targets> {
  const [settings, kpis] = await Promise.all([list<Settings>(COLLECTIONS.settings, { where: [["key", "==", "metas_referencia"]] }), list<Kpi>(COLLECTIONS.kpis, { where: [["department", "==", "suporte"]] })]);
  const refs = (settings[0]?.value ?? {}) as { csat?: number; reincidenciaMax?: number; slaSuporte?: number };
  const kpi = (key: string) => kpis.find((k) => k.key === key)?.target;
  return {
    csat: Number(refs.csat ?? kpi("csat") ?? 8.5),
    reopenMax: Number(refs.reincidenciaMax ?? kpi("reincidencia") ?? 0.1),
    slaResolution: Number(kpi("sla_solucao") ?? refs.slaSuporte ?? 0.9),
    slaResponse: Number(kpi("sla_resposta") ?? 0.95),
  };
}

/**
 * Fila e indicadores da Central. Escopo "minha": chamados do atendente e os sem atendente (que ele pode
 * assumir). Escopo "equipe": todos (padrão de gestores).
 */
export async function getSupportOverview(user: Pick<CurrentUser, "id" | "isManager">, scope?: OverviewScope): Promise<SupportOverview> {
  const effective: OverviewScope = scope ?? (user.isManager ? "equipe" : "minha");
  const now = new Date();
  const [base, csat, targets] = await Promise.all([loadBase(), list<CsatResponse>(COLLECTIONS.csatResponses), getTargets()]);
  const inScope = (t: SupportTicket) => effective === "equipe" || t.assigneeId === user.id || (!t.assigneeId && isOpenTicket(t));
  const tickets = base.tickets.filter(inScope);
  const rows = tickets.map((t) => toRow(t, base, now));
  const open = rows.filter((r) => r.open);
  const today = dateKey(now);
  const month = monthKey(now.toISOString());

  const csatMonth = csat.filter((c) => monthKey(c.respondedAt) === month && (effective === "equipe" || c.attendantId === user.id));
  // Reincidência do mês: chamados reabertos no mês / chamados resolvidos no mês.
  const mine = (t: SupportTicket) => effective === "equipe" || t.assigneeId === user.id;
  const reopenedMonth = base.tickets.filter((t) => t.reopenedFromId && monthKey(t.openedAt) === month && mine(t)).length;
  const resolvedMonth = base.tickets.filter((t) => t.resolvedAt && monthKey(t.resolvedAt) === month && mine(t)).length;
  // SLA de solução do mês: mesma regra do relatório de SLA (resolvidos no mês no prazo + vencidos no mês em aberto).
  const sla = emptyCompliance();
  const nowStr = now.toISOString();
  for (const t of base.tickets) if (mine(t)) add(sla, { resolution: evaluate(t, base.slaByTicket.get(t.id), month, nowStr).resolution });

  return {
    scope: effective,
    generatedAt: now.getTime(),
    rows: open.sort(compareQueue),
    stats: {
      open: open.filter((r) => r.status === "aberto" || r.status === "reaberto").length,
      inProgress: open.filter((r) => r.status === "em_atendimento").length,
      waiting: open.filter((r) => r.status === "aguardando_cliente").length,
      atRisk: open.filter((r) => r.sla?.view.state === "em_risco").length,
      breached: open.filter((r) => r.sla?.view.state === "violado").length,
      resolvedToday: rows.filter((r) => r.resolvedAt && dateKey(r.resolvedAt) === today).length,
      responsePending: open.filter((r) => !r.firstResponseAt).length,
      backlog: open.length,
      csatAverage: avg(csatMonth.map((c) => c.score)),
      csatCount: csatMonth.length,
      csatTarget: targets.csat,
      reopenRate: resolvedMonth > 0 ? reopenedMonth / resolvedMonth : undefined,
      reopenedMonth,
      resolvedMonth,
      reopenTarget: targets.reopenMax,
      slaCompliance: sla.resolutionTotal > 0 ? sla.resolutionMet / sla.resolutionTotal : undefined,
      slaMet: sla.resolutionMet,
      slaEvaluated: sla.resolutionTotal,
      slaTarget: targets.slaResolution,
    },
  };
}

// ---------------------------------------------------------------------------
// Chamado (página completa e drawer)
// ---------------------------------------------------------------------------

export interface TicketDetail {
  ticket: SupportTicketExtra;
  row: TicketRow;
  client: Client | null;
  contact: Contact | null;
  contacts: Contact[];
  interactions: TicketInteractionExtra[];
  users: Record<string, SupportUser>;
  clientProducts: ClientProduct[];
  contract: Pick<Contract, "id" | "number" | "status" | "monthlyTotal" | "endDate" | "startDate"> | null;
  previous: TicketRow[];
  clientStats: { total: number; reopened: number; reopenRate: number; csatAverage?: number };
  documents: Document[];
  suggestedArticles: ArticleSuggestion[];
  opportunity: Pick<Opportunity, "id" | "title" | "stage" | "ownerId" | "originUserId"> | null;
  csat: CsatResponse | null;
  reopenedFrom: { id: string; number: string } | null;
  reopenedAs: { id: string; number: string; status: SupportTicket["status"] }[];
  /** Produtos ativos do catálogo que o cliente ainda não tem (para gerar oportunidade). */
  availableProducts: { id: string; name: string; category: Product["category"]; monthlyPrice: number; setupPrice: number }[];
  catalog: { id: string; name: string }[];
  team: SupportUser[];
  /** Link público de avaliação (só para quem opera o suporte e chamado resolvido/fechado). */
  csatLink?: string;
}

/** Leitura leve para metadados (título da aba). */
export async function getTicketTitle(id: string): Promise<string | null> {
  const ticket = await getById<SupportTicket>(COLLECTIONS.supportTickets, id);
  return ticket ? `${ticket.number} · ${ticket.subject}` : null;
}

export async function getTicket(id: string, user?: CurrentUser): Promise<TicketDetail | null> {
  const ticket = await getById<SupportTicketExtra>(COLLECTIONS.supportTickets, id);
  if (!ticket) return null;
  const now = new Date();
  const [client, interactions, clientTickets, slas, contacts, clientProducts, contracts, documents, csatList, catalog, team, articles] = await Promise.all([
    getById<Client>(COLLECTIONS.clients, ticket.clientId),
    list<TicketInteractionExtra>(COLLECTIONS.ticketInteractions, { where: [["ticketId", "==", ticket.id]] }),
    list<SupportTicketExtra>(COLLECTIONS.supportTickets, { where: [["clientId", "==", ticket.clientId]] }),
    list<SlaInstanceExtra>(COLLECTIONS.slaInstances, { where: [["clientId", "==", ticket.clientId]] }),
    list<Contact>(COLLECTIONS.contacts, { where: [["clientId", "==", ticket.clientId]] }),
    list<ClientProduct>(COLLECTIONS.clientProducts, { where: [["clientId", "==", ticket.clientId]] }),
    list<Contract>(COLLECTIONS.contracts, { where: [["clientId", "==", ticket.clientId]] }),
    list<Document>(COLLECTIONS.documents, { where: [["entityId", "==", ticket.id]] }),
    list<CsatResponse>(COLLECTIONS.csatResponses, { where: [["ticketId", "==", ticket.id]] }),
    list<Product>(COLLECTIONS.products),
    getSupportTeam(),
    list<KnowledgeArticleExtra>(COLLECTIONS.knowledgeArticles),
  ]);
  const opportunity = ticket.originatedOpportunityId ? await getById<Opportunity>(COLLECTIONS.opportunities, ticket.originatedOpportunityId) : null;

  const ticketSlas = slas.filter((s) => s.entityType === "chamado");
  const slaById = new Map(ticketSlas.map((s) => [s.id, s]));
  const slaByTicket = new Map<string, SlaInstanceExtra>();
  for (const s of ticketSlas) if (!s.supersededBy) slaByTicket.set(s.entityId, s);
  for (const t of clientTickets) if (t.slaInstanceId && slaById.get(t.slaInstanceId)) slaByTicket.set(t.id, slaById.get(t.slaInstanceId)!);

  const userIds = [ticket.assigneeId, ...interactions.map((i) => i.authorId), ...clientTickets.map((t) => t.assigneeId), ...documents.map((d) => d.uploadedBy), opportunity?.ownerId, opportunity?.originUserId];
  const users = await getManyByIds<User>(COLLECTIONS.users, userIds.filter((x): x is string => Boolean(x)));
  const products = new Map(catalog.map((p) => [p.id, p]));
  const base: SupportBase = { tickets: clientTickets, slaByTicket, clients: new Map(client ? [[client.id, client]] : []), users, products };

  const row = toRow(ticket, base, now);
  const previous = clientTickets
    .filter((t) => t.id !== ticket.id)
    .map((t) => toRow(t, base, now))
    .sort((a, b) => (a.openedAt < b.openedAt ? 1 : -1));
  const reopened = clientTickets.filter((t) => t.reopenedFromId).length;
  const clientCsat = clientTickets.map((t) => t.csatScore).filter((s): s is number => typeof s === "number");

  interactions.sort((a, b) => (a.createdAt < b.createdAt ? -1 : a.createdAt > b.createdAt ? 1 : 0));
  contracts.sort((a, b) => (a.createdAt < b.createdAt ? 1 : -1));
  const contract = contracts.find((c) => c.status !== "cancelado") ?? contracts[0] ?? null;

  const ownedIds = new Set(clientProducts.filter((p) => p.status !== "cancelado").map((p) => p.productId));
  const activeCatalog = catalog.filter((p) => p.active !== false).sort((a, b) => a.order - b.order);
  const usersRecord: Record<string, SupportUser> = {};
  for (const [uid, u] of users) usersRecord[uid] = toUser(u);
  for (const u of team) usersRecord[u.id] = toUser(u);

  const reopenedFromTicket = ticket.reopenedFromId ? (clientTickets.find((t) => t.id === ticket.reopenedFromId) ?? (await getById<SupportTicket>(COLLECTIONS.supportTickets, ticket.reopenedFromId))) : null;
  const resolvedOrClosed = ticket.status === "resolvido" || ticket.status === "fechado";

  return {
    ticket,
    row,
    client,
    contact: contacts.find((c) => c.id === ticket.contactId) ?? null,
    contacts,
    interactions,
    users: usersRecord,
    clientProducts: clientProducts.sort((a, b) => a.productName.localeCompare(b.productName, "pt-BR")),
    contract: contract ? { id: contract.id, number: contract.number, status: contract.status, monthlyTotal: contract.monthlyTotal, endDate: contract.endDate, startDate: contract.startDate } : null,
    previous,
    clientStats: {
      total: clientTickets.length,
      reopened,
      reopenRate: clientTickets.length > 0 ? reopened / clientTickets.length : 0,
      csatAverage: avg(clientCsat),
    },
    documents: documents.filter((d) => d.entityType === "ticket").sort((a, b) => (a.createdAt < b.createdAt ? 1 : -1)),
    suggestedArticles: suggestArticles(articles, `${ticket.subject} ${ticket.category ?? ""} ${ticket.description}`, ticket.productId, products),
    opportunity: opportunity ? { id: opportunity.id, title: opportunity.title, stage: opportunity.stage, ownerId: opportunity.ownerId, originUserId: opportunity.originUserId } : null,
    csat: csatList[0] ?? null,
    reopenedFrom: reopenedFromTicket ? { id: reopenedFromTicket.id, number: reopenedFromTicket.number } : null,
    reopenedAs: clientTickets.filter((t) => t.reopenedFromId === ticket.id).map((t) => ({ id: t.id, number: t.number, status: t.status })),
    availableProducts: activeCatalog.filter((p) => !ownedIds.has(p.id)).map((p) => ({ id: p.id, name: p.name, category: p.category, monthlyPrice: p.monthlyPrice, setupPrice: p.setupPrice })),
    catalog: activeCatalog.map((p) => ({ id: p.id, name: p.name })),
    team: team.map(toUser),
    csatLink: resolvedOrClosed && user && canOperateSupport(user) ? csatPath(ticket.id) : undefined,
  };
}

// ---------------------------------------------------------------------------
// Relatório de SLA
// ---------------------------------------------------------------------------

export interface SlaCompliance {
  responseMet: number;
  responseTotal: number;
  resolutionMet: number;
  resolutionTotal: number;
  /** Frações 0–1; undefined quando não há base. */
  responsePct?: number;
  resolutionPct?: number;
}

export interface SlaReport {
  month: string;
  months: string[];
  rules: SlaRule[];
  targets: Targets;
  overall: SlaCompliance & { avgResponseMinutes?: number; avgResolutionHours?: number; resolved: number; opened: number };
  byAttendant: (SlaCompliance & { user: SupportUser; resolved: number; avgResponseMinutes?: number; avgResolutionHours?: number })[];
  byPriority: (SlaCompliance & { priority: TicketPriority; resolved: number; avgResolutionHours?: number })[];
  series: { month: string; label: string; responsePct?: number; resolutionPct?: number; opened: number; resolved: number }[];
  /** Chamados abertos em risco ou violados agora. */
  critical: TicketRow[];
}

function emptyCompliance(): SlaCompliance {
  return { responseMet: 0, responseTotal: 0, resolutionMet: 0, resolutionTotal: 0 };
}

function finish<T extends SlaCompliance>(c: T): T {
  c.responsePct = c.responseTotal > 0 ? c.responseMet / c.responseTotal : undefined;
  c.resolutionPct = c.resolutionTotal > 0 ? c.resolutionMet / c.resolutionTotal : undefined;
  return c;
}

/**
 * Avaliação de um chamado no mês:
 * - resposta: respondido no mês (firstResponseAt ≤ responseDueAt) ou prazo de resposta vencido no mês sem resposta;
 * - solução: resolvido no mês (resolvedAt ≤ dueAt) ou prazo vencido no mês ainda em aberto (violado).
 */
function evaluate(t: SupportTicket, sla: SlaInstance | undefined, month: string, nowIso: string) {
  const out = { response: undefined as boolean | undefined, resolution: undefined as boolean | undefined };
  if (!sla) return out;
  if (sla.responseDueAt) {
    if (t.firstResponseAt && monthKey(t.firstResponseAt) === month) out.response = t.firstResponseAt <= sla.responseDueAt;
    else if (!t.firstResponseAt && sla.responseDueAt < nowIso && monthKey(sla.responseDueAt) === month) out.response = false;
  }
  if (t.resolvedAt && monthKey(t.resolvedAt) === month) out.resolution = t.resolvedAt <= sla.dueAt;
  else if (!t.resolvedAt && isOpenTicket(t) && sla.status !== "pausado" && sla.dueAt < nowIso && monthKey(sla.dueAt) === month) out.resolution = false;
  return out;
}

function add(c: SlaCompliance, e: { response?: boolean; resolution?: boolean }) {
  if (e.response !== undefined) {
    c.responseTotal++;
    if (e.response) c.responseMet++;
  }
  if (e.resolution !== undefined) {
    c.resolutionTotal++;
    if (e.resolution) c.resolutionMet++;
  }
}

export async function getSlaReport(month?: string): Promise<SlaReport> {
  const now = new Date();
  const nowIso = now.toISOString();
  const months = lastMonths(6, now);
  const selected = month && months.includes(month) ? month : months[months.length - 1];
  const [base, rules, targets, team] = await Promise.all([loadBase(), listSlaRules(), getTargets(), getSupportTeam()]);

  const overall = { ...emptyCompliance(), resolved: 0, opened: 0 };
  const responseMinutes: number[] = [];
  const resolutionHours: number[] = [];
  const byUser = new Map<string, SlaCompliance & { resolved: number; responses: number[]; resolutions: number[] }>();
  const byPriority = new Map<TicketPriority, SlaCompliance & { resolved: number; resolutions: number[] }>();
  for (const p of TICKET_PRIORITIES) byPriority.set(p, { ...emptyCompliance(), resolved: 0, resolutions: [] });

  for (const t of base.tickets) {
    const sla = base.slaByTicket.get(t.id);
    const e = evaluate(t, sla, selected, nowIso);
    add(overall, e);
    if (monthKey(t.openedAt) === selected) overall.opened++;
    const respMin = t.firstResponseAt && monthKey(t.firstResponseAt) === selected ? (new Date(t.firstResponseAt).getTime() - new Date(t.openedAt).getTime()) / 60_000 : undefined;
    const resolH = t.resolvedAt && monthKey(t.resolvedAt) === selected ? (new Date(t.resolvedAt).getTime() - new Date(t.openedAt).getTime()) / 3_600_000 : undefined;
    if (respMin !== undefined) responseMinutes.push(respMin);
    if (resolH !== undefined) {
      resolutionHours.push(resolH);
      overall.resolved++;
    }

    const pr = byPriority.get(t.priority)!;
    add(pr, e);
    if (resolH !== undefined) {
      pr.resolved++;
      pr.resolutions.push(resolH);
    }

    if (t.assigneeId) {
      const u = byUser.get(t.assigneeId) ?? { ...emptyCompliance(), resolved: 0, responses: [], resolutions: [] };
      add(u, e);
      if (respMin !== undefined) u.responses.push(respMin);
      if (resolH !== undefined) {
        u.resolved++;
        u.resolutions.push(resolH);
      }
      byUser.set(t.assigneeId, u);
    }
  }

  const series = months.map((m) => {
    const c = emptyCompliance();
    let opened = 0;
    let resolved = 0;
    for (const t of base.tickets) {
      add(c, evaluate(t, base.slaByTicket.get(t.id), m, nowIso));
      if (monthKey(t.openedAt) === m) opened++;
      if (t.resolvedAt && monthKey(t.resolvedAt) === m) resolved++;
    }
    finish(c);
    return { month: m, label: formatCompetence(m), responsePct: c.responsePct, resolutionPct: c.resolutionPct, opened, resolved };
  });

  const teamMap = new Map(team.map((u) => [u.id, u]));
  const attendantRows = Array.from(byUser.entries())
    .map(([uid, c]) => {
      const u = teamMap.get(uid) ?? base.users.get(uid);
      return finish({
        responseMet: c.responseMet,
        responseTotal: c.responseTotal,
        resolutionMet: c.resolutionMet,
        resolutionTotal: c.resolutionTotal,
        user: u ? toUser(u) : { id: uid, name: uid },
        resolved: c.resolved,
        avgResponseMinutes: avg(c.responses),
        avgResolutionHours: avg(c.resolutions),
      });
    })
    .filter((r) => r.responseTotal + r.resolutionTotal + r.resolved > 0)
    .sort((a, b) => a.user.name.localeCompare(b.user.name, "pt-BR"));

  const critical = base.tickets
    .filter(isOpenTicket)
    .map((t) => toRow(t, base, now))
    .filter((r) => r.sla?.view.state === "violado" || r.sla?.view.state === "em_risco")
    .sort(compareQueue);

  return {
    month: selected,
    months,
    rules: rules.filter((r) => r.key.startsWith("suporte.")).sort((a, b) => PRIORITY_RANK[(a.key.split(".")[1] as TicketPriority) ?? "baixo"] - PRIORITY_RANK[(b.key.split(".")[1] as TicketPriority) ?? "baixo"]),
    targets,
    overall: { ...finish(overall), avgResponseMinutes: avg(responseMinutes), avgResolutionHours: avg(resolutionHours) },
    byAttendant: attendantRows,
    byPriority: TICKET_PRIORITIES.map((p) => {
      const c = byPriority.get(p)!;
      return finish({ priority: p, responseMet: c.responseMet, responseTotal: c.responseTotal, resolutionMet: c.resolutionMet, resolutionTotal: c.resolutionTotal, resolved: c.resolved, avgResolutionHours: avg(c.resolutions) });
    }),
    series,
    critical,
  };
}

// ---------------------------------------------------------------------------
// Relatório de CSAT
// ---------------------------------------------------------------------------

export interface CsatBucket {
  average?: number;
  count: number;
  promoters: number;
  detractors: number;
}

export interface CsatReport {
  month: string;
  target: number;
  team: CsatBucket;
  byAttendant: (CsatBucket & { user: SupportUser })[];
  byProduct: (CsatBucket & { productId: string; productName: string })[];
  series: { month: string; label: string; average?: number; count: number }[];
  recent: { id: string; score: number; comment?: string; respondedAt: string; ticketId: string; ticketNumber?: string; clientName?: string; attendantName?: string }[];
}

function bucket(items: CsatResponse[]): CsatBucket {
  return {
    average: avg(items.map((c) => c.score)),
    count: items.length,
    promoters: items.filter((c) => c.score >= 9).length,
    detractors: items.filter((c) => c.score <= 6).length,
  };
}

export async function getCsatReport(month?: string): Promise<CsatReport> {
  const now = new Date();
  const months = lastMonths(6, now);
  const selected = month && months.includes(month) ? month : months[months.length - 1];
  const [responses, targets, products] = await Promise.all([list<CsatResponse>(COLLECTIONS.csatResponses), getTargets(), list<Product>(COLLECTIONS.products)]);
  const inMonth = responses.filter((r) => monthKey(r.respondedAt) === selected);

  const byAttendant = new Map<string, CsatResponse[]>();
  const byProduct = new Map<string, CsatResponse[]>();
  for (const r of inMonth) {
    if (r.attendantId) byAttendant.set(r.attendantId, [...(byAttendant.get(r.attendantId) ?? []), r]);
    if (r.productId) byProduct.set(r.productId, [...(byProduct.get(r.productId) ?? []), r]);
  }
  const recentAll = [...responses].sort((a, b) => (a.respondedAt < b.respondedAt ? 1 : -1)).slice(0, 12);
  const [users, tickets] = await Promise.all([
    getManyByIds<User>(COLLECTIONS.users, [...byAttendant.keys(), ...recentAll.map((r) => r.attendantId ?? "")]),
    getManyByIds<SupportTicket>(COLLECTIONS.supportTickets, recentAll.map((r) => r.ticketId)),
  ]);
  const clients = await getManyByIds<Client>(COLLECTIONS.clients, recentAll.map((r) => r.clientId));
  const productNames = new Map(products.map((p) => [p.id, p.name]));

  return {
    month: selected,
    target: targets.csat,
    team: bucket(inMonth),
    byAttendant: Array.from(byAttendant.entries())
      .map(([uid, items]) => ({ ...bucket(items), user: users.get(uid) ? toUser(users.get(uid)!) : { id: uid, name: uid } }))
      .sort((a, b) => (b.average ?? 0) - (a.average ?? 0)),
    byProduct: Array.from(byProduct.entries())
      .map(([pid, items]) => ({ ...bucket(items), productId: pid, productName: productNames.get(pid) ?? pid }))
      .sort((a, b) => b.count - a.count),
    series: months.map((m) => {
      const items = responses.filter((r) => monthKey(r.respondedAt) === m);
      return { month: m, label: formatCompetence(m), average: avg(items.map((c) => c.score)), count: items.length };
    }),
    recent: recentAll.map((r) => ({
      id: r.id,
      score: r.score,
      comment: r.comment,
      respondedAt: r.respondedAt,
      ticketId: r.ticketId,
      ticketNumber: tickets.get(r.ticketId)?.number,
      clientName: clients.get(r.clientId)?.tradeName,
      attendantName: r.attendantId ? users.get(r.attendantId)?.name : undefined,
    })),
  };
}

// ---------------------------------------------------------------------------
// Base de conhecimento
// ---------------------------------------------------------------------------

export interface ArticleRow {
  id: string;
  title: string;
  productId?: string;
  productName?: string;
  module?: string;
  category?: string;
  problem?: string;
  keywords: string[];
  tags: string[];
  authorId: string;
  authorName: string;
  views: number;
  helpful: number;
  notHelpful: number;
  published: boolean;
  updatedAt: string;
  excerpt: string;
  /** Texto usado só pela busca (corpo sem markdown, limitado). */
  body: string;
}

export interface ArticleSuggestion {
  id: string;
  title: string;
  productName?: string;
  module?: string;
  problem?: string;
  score: number;
}

/** Texto normalizado (minúsculas, sem acentos) para busca. */
export const normalize = normalizeText;

type RankableArticle = KnowledgeArticleExtra & { productName?: string };

function rankable(articles: KnowledgeArticleExtra[], products: Map<string, Product>): RankableArticle[] {
  return articles.map((a) => ({ ...a, productName: a.productId ? products.get(a.productId)?.name : undefined }));
}

/**
 * Sugestões para um texto livre (assunto do chamado, problema de um artigo): busca ponderada em qualquer termo
 * (título e problema pesam mais, depois palavras-chave, tags, módulo/categoria e corpo); mesmo produto soma 3.
 */
export function suggestArticles(articles: KnowledgeArticleExtra[], text: string, productId: string | undefined, products: Map<string, Product>, limit = 3): ArticleSuggestion[] {
  const ranked = rankArticles(
    rankable(
      articles.filter((a) => a.published),
      products,
    ),
    text,
    { mode: "any", minScore: 5, boost: (a) => (productId && a.productId === productId ? 3 : 0), limit },
  );
  return ranked.map((a) => ({ id: a.id, title: a.title, productName: a.productName, module: a.module, problem: a.problem, score: a.score }));
}

function excerpt(body: string): string {
  const plain = plainText(body).replace(/\s+/g, " ");
  return plain.length > 180 ? `${plain.slice(0, 177)}…` : plain;
}

const uniqSorted = (values: (string | undefined)[]) =>
  Array.from(new Set(values.filter((v): v is string => Boolean(v)))).sort((a, b) => a.localeCompare(b, "pt-BR"));

export interface ArticleListData {
  articles: ArticleRow[];
  products: { id: string; name: string }[];
  categories: string[];
  modules: string[];
}

export async function listArticles(options: { includeDrafts?: boolean } = {}): Promise<ArticleListData> {
  const [articles, products] = await Promise.all([list<KnowledgeArticleExtra>(COLLECTIONS.knowledgeArticles), list<Product>(COLLECTIONS.products)]);
  const visible = options.includeDrafts ? articles : articles.filter((a) => a.published);
  const authors = await getManyByIds<User>(COLLECTIONS.users, visible.map((a) => a.authorId));
  const productNames = new Map(products.map((p) => [p.id, p.name]));
  return {
    articles: visible
      .map((a) => ({
        id: a.id,
        title: a.title,
        productId: a.productId,
        productName: a.productId ? productNames.get(a.productId) : undefined,
        module: a.module,
        category: a.category,
        problem: a.problem,
        keywords: a.keywords ?? [],
        tags: a.tags ?? [],
        authorId: a.authorId,
        authorName: authors.get(a.authorId)?.name ?? "—",
        views: a.views ?? 0,
        helpful: a.helpful ?? 0,
        notHelpful: a.notHelpful ?? 0,
        published: a.published,
        updatedAt: a.updatedAt,
        excerpt: excerpt(a.body),
        body: plainText(a.body).slice(0, 2000),
      }))
      .sort((a, b) => b.views - a.views || a.title.localeCompare(b.title, "pt-BR")),
    products: products
      .filter((p) => p.active !== false)
      .sort((a, b) => a.order - b.order)
      .map((p) => ({ id: p.id, name: p.name })),
    categories: uniqSorted(articles.map((a) => a.category)),
    modules: uniqSorted(articles.map((a) => a.module)),
  };
}

export interface ArticleDetail {
  article: KnowledgeArticleExtra;
  productName?: string;
  author?: SupportUser;
  related: ArticleSuggestion[];
  sourceTicket?: { id: string; number: string; subject: string };
}

export async function getArticle(id: string): Promise<ArticleDetail | null> {
  const article = await getById<KnowledgeArticleExtra>(COLLECTIONS.knowledgeArticles, id);
  if (!article) return null;
  const [author, products, articles, source] = await Promise.all([
    getById<User>(COLLECTIONS.users, article.authorId),
    list<Product>(COLLECTIONS.products),
    list<KnowledgeArticleExtra>(COLLECTIONS.knowledgeArticles),
    article.sourceTicketId ? getById<SupportTicket>(COLLECTIONS.supportTickets, article.sourceTicketId) : null,
  ]);
  const productMap = new Map(products.map((p) => [p.id, p]));
  const others = articles.filter((a) => a.id !== article.id);
  // Relacionados: pelo problema/título/palavras-chave; sem coincidência de texto, os do mesmo produto e módulo.
  let related = suggestArticles(others, [article.title, article.problem, ...(article.keywords ?? []), ...article.tags].filter(Boolean).join(" "), article.productId, productMap, 4);
  if (related.length < 4 && article.productId) {
    const seen = new Set(related.map((r) => r.id));
    const sameProduct = others
      .filter((a) => a.published && !seen.has(a.id) && a.productId === article.productId)
      .sort((a, b) => Number(b.module === article.module) - Number(a.module === article.module) || (b.views ?? 0) - (a.views ?? 0))
      .slice(0, 4 - related.length)
      .map((a) => ({ id: a.id, title: a.title, productName: productMap.get(a.productId!)?.name, module: a.module, problem: a.problem, score: 0 }));
    related = [...related, ...sameProduct];
  }
  return {
    article,
    productName: article.productId ? productMap.get(article.productId)?.name : undefined,
    author: author ? toUser(author) : undefined,
    related,
    sourceTicket: source ? { id: source.id, number: source.number, subject: source.subject } : undefined,
  };
}

// ---------------------------------------------------------------------------
// Ficha 360º (aba Suporte)
// ---------------------------------------------------------------------------

export interface ClientSupport {
  tickets: TicketRow[];
  total: number;
  open: number;
  reopened: number;
  reopenRate: number;
  csatAverage?: number;
  csatCount: number;
  recentCsat: CsatResponse[];
}

export async function getClientSupport(clientId: string): Promise<ClientSupport> {
  const now = new Date();
  const [tickets, slas, csat, client, products] = await Promise.all([
    list<SupportTicketExtra>(COLLECTIONS.supportTickets, { where: [["clientId", "==", clientId]] }),
    list<SlaInstanceExtra>(COLLECTIONS.slaInstances, { where: [["clientId", "==", clientId]] }),
    list<CsatResponse>(COLLECTIONS.csatResponses, { where: [["clientId", "==", clientId]] }),
    getById<Client>(COLLECTIONS.clients, clientId),
    list<Product>(COLLECTIONS.products),
  ]);
  const slaById = new Map(slas.filter((s) => s.entityType === "chamado").map((s) => [s.id, s]));
  const slaByTicket = new Map<string, SlaInstanceExtra>();
  for (const t of tickets) {
    const s = t.slaInstanceId ? slaById.get(t.slaInstanceId) : undefined;
    if (s) slaByTicket.set(t.id, s);
  }
  const users = await getManyByIds<User>(COLLECTIONS.users, tickets.map((t) => t.assigneeId ?? ""));
  const base: SupportBase = { tickets, slaByTicket, clients: new Map(client ? [[client.id, client]] : []), users, products: new Map(products.map((p) => [p.id, p])) };
  const rows = tickets.map((t) => toRow(t, base, now)).sort((a, b) => (a.openedAt < b.openedAt ? 1 : -1));
  const reopened = tickets.filter((t) => t.reopenedFromId).length;
  csat.sort((a, b) => (a.respondedAt < b.respondedAt ? 1 : -1));
  return {
    tickets: rows,
    total: tickets.length,
    open: rows.filter((r) => r.open).length,
    reopened,
    reopenRate: tickets.length > 0 ? reopened / tickets.length : 0,
    csatAverage: avg(csat.map((c) => c.score)),
    csatCount: csat.length,
    recentCsat: csat.slice(0, 5),
  };
}
