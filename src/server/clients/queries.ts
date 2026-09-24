import "server-only";
import { cache } from "react";
import { getById, getManyByIds, list } from "@/server/db";
import { computeSlaState } from "@/server/sla";
import { listBillingsSwept } from "@/server/finance/billing";
import { getClientFinancialSummary, type ClientFinancialSummary } from "@/server/finance/queries";
import {
  COLLECTIONS,
  type Billing,
  type Campaign,
  type Client,
  type ClientProduct,
  type Contact,
  type Contract,
  type CsAccount,
  type CsatResponse,
  type CurrentUser,
  type Document,
  type HealthScore,
  type ImplementationProject,
  type ImplementationTask,
  type Lead,
  type LeadSource,
  type Opportunity,
  type Product,
  type Proposal,
  type Renewal,
  type SlaInstance,
  type SlaView,
  type SuccessPlan,
  type SupportTicket,
  type Task,
  type TimelineEvent,
  type Training,
  type User,
  type UserRef,
  type WorkflowInstance,
  type WorkflowStep,
} from "@/domain/types";
import type { ClientStatus, DepartmentKey, HealthLevel, JourneyStage, ProductCategory } from "@/domain/constants";
import { CLIENT_STATUS, HEALTH_LEVELS, JOURNEY_STAGES } from "@/domain/constants";

/**
 * Leituras do módulo Clientes 360º. Todas filtram por organização via `list()` (igualdade apenas)
 * e ordenam/agregam em memória.
 */

// ---------------------------------------------------------------------------
// Utilitários
// ---------------------------------------------------------------------------

/** Normaliza texto para busca: minúsculas e sem acentos. */
export function normalizeText(value: string | undefined | null): string {
  return (value ?? "")
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .trim();
}

const digits = (value: string | undefined | null) => (value ?? "").replace(/\D/g, "");

/** Campos de usuário seguros para enviar a Client Components. */
export interface UserSummary {
  id: string;
  name: string;
  avatarUrl?: string;
  jobTitle?: string;
  departmentId?: DepartmentKey;
}

function toSummary(u: User): UserSummary {
  return { id: u.id, name: u.name, avatarUrl: u.avatarUrl, jobTitle: u.jobTitle, departmentId: u.departmentId };
}

async function resolveUsers(ids: (string | undefined)[]): Promise<Record<string, UserSummary>> {
  const map = await getManyByIds<User>(COLLECTIONS.users, ids.filter((id): id is string => Boolean(id)));
  const out: Record<string, UserSummary> = {};
  for (const [id, u] of map) out[id] = toSummary(u);
  return out;
}

function byIsoDesc<T>(field: (item: T) => string | undefined) {
  return (a: T, b: T) => {
    const av = field(a);
    const bv = field(b);
    if (av === bv) return 0;
    if (!av) return 1;
    if (!bv) return -1;
    return av < bv ? 1 : -1;
  };
}

// ---------------------------------------------------------------------------
// Cliente
// ---------------------------------------------------------------------------

/** Memoizado por requisição: generateMetadata e a página compartilham a mesma leitura. */
export const getClient = cache(async (id: string): Promise<Client | null> => {
  return getById<Client>(COLLECTIONS.clients, id);
});

// ---------------------------------------------------------------------------
// Lista de clientes
// ---------------------------------------------------------------------------

export type ClientSort = "nome" | "mrr" | "interacao" | "saude";

export interface ClientListFilters {
  q?: string;
  status?: ClientStatus[];
  stage?: JourneyStage;
  ownerSalesId?: string;
  ownerCsId?: string;
  health?: HealthLevel;
  segment?: string;
  city?: string;
  sort?: ClientSort;
  dir?: "asc" | "desc";
}

export interface ClientListItem extends Client {
  ownerSales?: UserSummary;
  ownerCs?: UserSummary;
}

export interface ClientStats {
  total: number;
  active: number;
  implementing: number;
  pipeline: number;
  mrr: number;
  atRisk: number;
}

export interface ClientFacets {
  segments: string[];
  cities: string[];
  sellers: UserSummary[];
  csOwners: UserSummary[];
}

export interface ClientListResult {
  items: ClientListItem[];
  total: number;
  stats: ClientStats;
  facets: ClientFacets;
}

/** Converte searchParams da rota /clientes em filtros tipados (parâmetros em português na URL). */
export function parseClientFilters(params: Record<string, string | string[] | undefined>): ClientListFilters {
  const one = (key: string) => {
    const v = params[key];
    return Array.isArray(v) ? v[0] : v;
  };
  const statusRaw = one("status");
  const status = statusRaw
    ? statusRaw
        .split(",")
        .map((s) => s.trim())
        .filter((s): s is ClientStatus => (CLIENT_STATUS as readonly string[]).includes(s))
    : undefined;
  const stageRaw = one("etapa");
  const healthRaw = one("saude");
  const sortRaw = one("ordenar");
  const dirRaw = one("dir");
  return {
    q: one("q")?.trim() || undefined,
    status: status && status.length > 0 ? status : undefined,
    stage: stageRaw && (JOURNEY_STAGES as readonly string[]).includes(stageRaw) ? (stageRaw as JourneyStage) : undefined,
    ownerSalesId: one("vendedor") || undefined,
    ownerCsId: one("cs") || undefined,
    health: healthRaw && (HEALTH_LEVELS as readonly string[]).includes(healthRaw) ? (healthRaw as HealthLevel) : undefined,
    segment: one("segmento") || undefined,
    city: one("cidade") || undefined,
    sort: sortRaw && ["nome", "mrr", "interacao", "saude"].includes(sortRaw) ? (sortRaw as ClientSort) : undefined,
    dir: dirRaw === "asc" || dirRaw === "desc" ? dirRaw : undefined,
  };
}

function matchesSearch(client: Client, contactNames: string[], term: string, termDigits: string): boolean {
  const haystack = [client.tradeName, client.legalName, client.address?.city, client.email, ...contactNames].map(normalizeText).join(" ");
  if (haystack.includes(term)) return true;
  if (termDigits.length >= 4) {
    return [client.document, client.phone, client.whatsapp].some((v) => digits(v).includes(termDigits));
  }
  return false;
}

export async function listClients(filters: ClientListFilters = {}): Promise<ClientListResult> {
  const clients = await list<Client>(COLLECTIONS.clients);

  // Indicadores do topo são sempre sobre a base inteira (o filtro só afeta a tabela).
  const stats: ClientStats = {
    total: clients.length,
    active: clients.filter((c) => c.status === "ativo").length,
    implementing: clients.filter((c) => c.status === "em_implantacao").length,
    pipeline: clients.filter((c) => c.status === "prospect" || c.status === "lead").length,
    mrr: clients.filter((c) => c.status === "ativo").reduce((s, c) => s + (c.mrr || 0), 0),
    atRisk: clients.filter((c) => c.status === "ativo" && c.healthLevel === "risco").length,
  };

  const users = await resolveUsers(clients.flatMap((c) => [c.ownerSalesId, c.ownerCsId]));
  const facets: ClientFacets = {
    segments: Array.from(new Set(clients.map((c) => c.segment).filter((s): s is string => Boolean(s)))).sort((a, b) => a.localeCompare(b, "pt-BR")),
    cities: Array.from(new Set(clients.map((c) => c.address?.city).filter((s): s is string => Boolean(s)))).sort((a, b) => a.localeCompare(b, "pt-BR")),
    sellers: Array.from(new Set(clients.map((c) => c.ownerSalesId)))
      .map((id) => (id ? users[id] : undefined))
      .filter((u): u is UserSummary => Boolean(u))
      .sort((a, b) => a.name.localeCompare(b.name, "pt-BR")),
    csOwners: Array.from(new Set(clients.map((c) => c.ownerCsId)))
      .map((id) => (id ? users[id] : undefined))
      .filter((u): u is UserSummary => Boolean(u))
      .sort((a, b) => a.name.localeCompare(b.name, "pt-BR")),
  };

  let items: Client[] = clients;
  if (filters.status?.length) items = items.filter((c) => filters.status!.includes(c.status));
  if (filters.stage) items = items.filter((c) => c.currentStage === filters.stage);
  if (filters.ownerSalesId) items = items.filter((c) => c.ownerSalesId === filters.ownerSalesId);
  if (filters.ownerCsId) items = items.filter((c) => c.ownerCsId === filters.ownerCsId);
  if (filters.health) items = items.filter((c) => c.healthLevel === filters.health);
  if (filters.segment) items = items.filter((c) => c.segment === filters.segment);
  if (filters.city) items = items.filter((c) => normalizeText(c.address?.city) === normalizeText(filters.city));

  if (filters.q) {
    const term = normalizeText(filters.q);
    const termDigits = digits(filters.q);
    // Busca por nome de contato exige a coleção de contatos (pequena; uma leitura).
    const contacts = await list<Contact>(COLLECTIONS.contacts);
    const namesByClient = new Map<string, string[]>();
    for (const contact of contacts) {
      const names = namesByClient.get(contact.clientId) ?? [];
      names.push(contact.name);
      namesByClient.set(contact.clientId, names);
    }
    items = items.filter((c) => matchesSearch(c, namesByClient.get(c.id) ?? [], term, termDigits));
  }

  const sort: ClientSort = filters.sort ?? "nome";
  const defaultDir: Record<ClientSort, "asc" | "desc"> = { nome: "asc", mrr: "desc", interacao: "desc", saude: "asc" };
  const dir = filters.dir ?? defaultDir[sort];
  const sign = dir === "asc" ? 1 : -1;
  items = [...items].sort((a, b) => {
    switch (sort) {
      case "mrr":
        return sign * ((a.mrr || 0) - (b.mrr || 0));
      case "saude": {
        // Sem score vai sempre para o fim.
        if (a.healthScore === undefined && b.healthScore === undefined) return a.tradeName.localeCompare(b.tradeName, "pt-BR");
        if (a.healthScore === undefined) return 1;
        if (b.healthScore === undefined) return -1;
        return sign * (a.healthScore - b.healthScore);
      }
      case "interacao": {
        if (!a.lastInteractionAt && !b.lastInteractionAt) return 0;
        if (!a.lastInteractionAt) return 1;
        if (!b.lastInteractionAt) return -1;
        return sign * a.lastInteractionAt.localeCompare(b.lastInteractionAt);
      }
      default:
        return sign * a.tradeName.localeCompare(b.tradeName, "pt-BR");
    }
  });

  return {
    items: items.map((c) => ({ ...c, ownerSales: c.ownerSalesId ? users[c.ownerSalesId] : undefined, ownerCs: c.ownerCsId ? users[c.ownerCsId] : undefined })),
    total: items.length,
    stats,
    facets,
  };
}

// ---------------------------------------------------------------------------
// Busca (busca global, selects)
// ---------------------------------------------------------------------------

export interface ClientSearchResult {
  id: string;
  tradeName: string;
  legalName: string;
  document?: string;
  city?: string;
  status: ClientStatus;
  href: string;
}

export async function searchClients(term: string, limit = 10): Promise<ClientSearchResult[]> {
  const normalized = normalizeText(term);
  const termDigits = digits(term);
  if (!normalized && termDigits.length < 4) return [];
  const clients = await list<Client>(COLLECTIONS.clients);
  const matches = clients.filter((c) => matchesSearch(c, [], normalized, termDigits));
  // Prioriza quem começa com o termo, depois clientes ativos.
  matches.sort((a, b) => {
    const aStarts = normalizeText(a.tradeName).startsWith(normalized) ? 0 : 1;
    const bStarts = normalizeText(b.tradeName).startsWith(normalized) ? 0 : 1;
    if (aStarts !== bStarts) return aStarts - bStarts;
    const aActive = a.status === "ativo" ? 0 : 1;
    const bActive = b.status === "ativo" ? 0 : 1;
    if (aActive !== bActive) return aActive - bActive;
    return a.tradeName.localeCompare(b.tradeName, "pt-BR");
  });
  return matches.slice(0, limit).map((c) => ({
    id: c.id,
    tradeName: c.tradeName,
    legalName: c.legalName,
    document: c.document,
    city: c.address?.city,
    status: c.status,
    href: `/clientes/${c.id}`,
  }));
}

// ---------------------------------------------------------------------------
// Clientes que precisam de atenção (Meu Dia)
// ---------------------------------------------------------------------------

export interface ClientAttention {
  client: Client;
  severity: "risco" | "atencao";
  reasons: string[];
  href: string;
}

/**
 * Clientes com saúde em risco/atenção, próxima interação vencida ou cobrança vencida.
 * Gestores, diretoria e admin veem toda a base; os demais só os clientes pelos quais respondem.
 */
export async function listClientsNeedingAttention(user: Pick<CurrentUser, "id" | "isManager">): Promise<ClientAttention[]> {
  const [clients, overdueBilling] = await Promise.all([
    list<Client>(COLLECTIONS.clients),
    list<Billing>(COLLECTIONS.billing, { where: [["status", "==", "vencida"]] }),
  ]);
  const overdueByClient = new Map<string, number>();
  for (const b of overdueBilling) overdueByClient.set(b.clientId, (overdueByClient.get(b.clientId) ?? 0) + b.amount);

  const now = new Date().toISOString();
  const out: ClientAttention[] = [];
  for (const client of clients) {
    if (client.status === "cancelado" || client.status === "inativo") continue;
    if (!user.isManager && ![client.ownerCsId, client.ownerSalesId, client.ownerImplementationId].includes(user.id)) continue;
    const reasons: string[] = [];
    let severity: ClientAttention["severity"] = "atencao";
    if (client.healthLevel === "risco") {
      reasons.push(`Saúde em risco${client.healthScore !== undefined ? ` (score ${client.healthScore})` : ""}`);
      severity = "risco";
    } else if (client.healthLevel === "atencao") {
      reasons.push(`Saúde em atenção${client.healthScore !== undefined ? ` (score ${client.healthScore})` : ""}`);
    }
    const overdue = overdueByClient.get(client.id);
    if (overdue) {
      reasons.push(`Cobrança vencida em aberto (${new Intl.NumberFormat("pt-BR", { style: "currency", currency: "BRL" }).format(overdue)})`);
      severity = "risco";
    }
    if (client.nextInteractionAt && client.nextInteractionAt < now) reasons.push("Próxima interação vencida");
    if (reasons.length === 0) continue;
    out.push({ client, severity, reasons, href: `/clientes/${client.id}` });
  }
  out.sort((a, b) => {
    if (a.severity !== b.severity) return a.severity === "risco" ? -1 : 1;
    return (a.client.lastInteractionAt ?? "") < (b.client.lastInteractionAt ?? "") ? -1 : 1;
  });
  return out;
}

// ---------------------------------------------------------------------------
// Opções de formulário (cadastro/edição)
// ---------------------------------------------------------------------------

export interface ClientFormOptions {
  leadSources: { key: string; name: string }[];
  campaigns: { id: string; name: string }[];
  sellers: UserSummary[];
  csOwners: UserSummary[];
}

export async function getClientFormOptions(): Promise<ClientFormOptions> {
  const [sources, campaigns, sellers, csUsers] = await Promise.all([
    list<LeadSource>(COLLECTIONS.leadSources),
    list<Campaign>(COLLECTIONS.campaigns),
    list<User>(COLLECTIONS.users, { where: [["departmentId", "==", "vendas"]] }),
    list<User>(COLLECTIONS.users, { where: [["departmentId", "==", "cs"]] }),
  ]);
  const activeUsers = (users: User[]) =>
    users
      .filter((u) => u.active !== false)
      .sort((a, b) => a.name.localeCompare(b.name, "pt-BR"))
      .map(toSummary);
  return {
    leadSources: sources
      .filter((s) => s.active !== false)
      .sort((a, b) => a.name.localeCompare(b.name, "pt-BR"))
      .map((s) => ({ key: s.key, name: s.name })),
    campaigns: campaigns
      .filter((c) => c.status !== "encerrada")
      .sort((a, b) => a.name.localeCompare(b.name, "pt-BR"))
      .map((c) => ({ id: c.id, name: c.name })),
    sellers: activeUsers(sellers),
    csOwners: activeUsers(csUsers),
  };
}

// ---------------------------------------------------------------------------
// Ficha 360º
// ---------------------------------------------------------------------------

export type TicketWithSla = SupportTicket & { sla?: SlaView };

/**
 * Resumo financeiro da ficha: vem do módulo Financeiro (`getClientFinancialSummary`, que também
 * marca cobranças vencidas na leitura). `mrr` usa os contratos liberados e, sem eles, os produtos ativos.
 */
export type FinancialSummary = ClientFinancialSummary;

export interface SupportSummary {
  total: number;
  open: number;
  reopened: number;
  /** Reincidência: reabertos / total (0–1). */
  reopenRate: number;
  csatAverage?: number;
  csatCount: number;
}

export interface Client360 {
  client: Client;
  contacts: Contact[];
  products: ClientProduct[];
  /** Produtos ativos do catálogo que o cliente ainda não tem (nem em implantação). */
  availableProducts: Product[];
  catalog: Product[];
  /** Categorias já contratadas (define upsell x cross-sell ao gerar oportunidade). */
  ownedCategories: ProductCategory[];
  timeline: TimelineEvent[];
  lead: Lead | null;
  campaign: Campaign | null;
  opportunities: Opportunity[];
  proposals: Proposal[];
  contracts: Contract[];
  billing: Billing[];
  projects: ImplementationProject[];
  implementationTasks: ImplementationTask[];
  trainings: Training[];
  csAccount: CsAccount | null;
  healthScore: HealthScore | null;
  successPlans: SuccessPlan[];
  renewals: Renewal[];
  tickets: TicketWithSla[];
  csat: CsatResponse[];
  documents: Document[];
  tasks: Task[];
  workflow: { instance: WorkflowInstance | null; steps: WorkflowStep[] };
  users: Record<string, UserSummary>;
  financial: FinancialSummary;
  support: SupportSummary;
}

const OPEN_TASK_STATUSES = new Set(["aberta", "em_andamento", "aguardando"]);
const OPEN_TICKET_STATUSES = new Set(["aberto", "em_atendimento", "aguardando_cliente", "reaberto"]);

/** Agrega tudo que a Ficha 360º mostra em uma única chamada (leituras em paralelo). */
export async function getClient360(id: string): Promise<Client360 | null> {
  const client = await getClient(id);
  if (!client) return null;

  const byClient = (field = "clientId") => ({ where: [[field, "==", id]] as [string, "==", unknown][] });

  const [
    contacts,
    products,
    catalog,
    timeline,
    lead,
    campaign,
    opportunities,
    proposals,
    contracts,
    billing,
    projects,
    implementationTasks,
    trainings,
    csAccounts,
    healthScores,
    successPlans,
    renewals,
    tickets,
    csat,
    documents,
    tasks,
    instance,
    steps,
    slas,
  ] = await Promise.all([
    list<Contact>(COLLECTIONS.contacts, byClient()),
    list<ClientProduct>(COLLECTIONS.clientProducts, byClient()),
    list<Product>(COLLECTIONS.products),
    list<TimelineEvent>(COLLECTIONS.timelineEvents, byClient()),
    client.leadId ? getById<Lead>(COLLECTIONS.leads, client.leadId) : Promise.resolve(null),
    client.campaignId ? getById<Campaign>(COLLECTIONS.campaigns, client.campaignId) : Promise.resolve(null),
    list<Opportunity>(COLLECTIONS.opportunities, byClient()),
    list<Proposal>(COLLECTIONS.proposals, byClient()),
    list<Contract>(COLLECTIONS.contracts, byClient()),
    listBillingsSwept(byClient()),
    list<ImplementationProject>(COLLECTIONS.implementationProjects, byClient()),
    list<ImplementationTask>(COLLECTIONS.implementationTasks, byClient()),
    list<Training>(COLLECTIONS.trainings, byClient()),
    list<CsAccount>(COLLECTIONS.csAccounts, byClient()),
    list<HealthScore>(COLLECTIONS.healthScores, byClient()),
    list<SuccessPlan>(COLLECTIONS.successPlans, byClient()),
    list<Renewal>(COLLECTIONS.renewals, byClient()),
    list<SupportTicket>(COLLECTIONS.supportTickets, byClient()),
    list<CsatResponse>(COLLECTIONS.csatResponses, byClient()),
    list<Document>(COLLECTIONS.documents, byClient()),
    list<Task>(COLLECTIONS.tasks, byClient()),
    client.workflowInstanceId ? getById<WorkflowInstance>(COLLECTIONS.workflowInstances, client.workflowInstanceId) : Promise.resolve(null),
    list<WorkflowStep>(COLLECTIONS.workflowSteps, byClient()),
    list<SlaInstance>(COLLECTIONS.slaInstances, byClient()),
  ]);

  // Ordenações.
  contacts.sort((a, b) => Number(b.isPrimary) - Number(a.isPrimary) || a.name.localeCompare(b.name, "pt-BR"));
  timeline.sort(byIsoDesc((e) => e.occurredAt));
  opportunities.sort(byIsoDesc((o) => o.lastActivityAt ?? o.createdAt));
  proposals.sort(byIsoDesc((p) => p.createdAt));
  contracts.sort(byIsoDesc((c) => c.createdAt));
  billing.sort((a, b) => (a.dueDate < b.dueDate ? 1 : -1));
  projects.sort(byIsoDesc((p) => p.startDate ?? p.createdAt));
  implementationTasks.sort((a, b) => (a.dueAt ?? "").localeCompare(b.dueAt ?? ""));
  trainings.sort(byIsoDesc((t) => t.scheduledAt));
  successPlans.sort(byIsoDesc((p) => p.createdAt));
  renewals.sort((a, b) => a.dueDate.localeCompare(b.dueDate));
  tickets.sort(byIsoDesc((t) => t.openedAt));
  csat.sort(byIsoDesc((c) => c.respondedAt));
  documents.sort(byIsoDesc((d) => d.createdAt));
  tasks.sort((a, b) => {
    const aOpen = OPEN_TASK_STATUSES.has(a.status) ? 0 : 1;
    const bOpen = OPEN_TASK_STATUSES.has(b.status) ? 0 : 1;
    if (aOpen !== bOpen) return aOpen - bOpen;
    if (aOpen === 0) return (a.dueAt ?? "9").localeCompare(b.dueAt ?? "9");
    return (b.completedAt ?? b.updatedAt).localeCompare(a.completedAt ?? a.updatedAt);
  });
  const instanceSteps = steps.filter((s) => !instance || s.instanceId === instance.id).sort((a, b) => a.order - b.order);

  // Catálogo e produtos disponíveis.
  const activeCatalog = catalog.filter((p) => p.active !== false).sort((a, b) => a.order - b.order);
  const ownedProductIds = new Set(products.filter((p) => p.status !== "cancelado").map((p) => p.productId));
  const availableProducts = activeCatalog.filter((p) => !ownedProductIds.has(p.id));
  const ownedCategories = Array.from(new Set(catalog.filter((p) => ownedProductIds.has(p.id)).map((p) => p.category)));
  products.sort((a, b) => {
    const rank = (s: ClientProduct["status"]) => (s === "ativo" ? 0 : s === "em_implantacao" ? 1 : s === "suspenso" ? 2 : 3);
    return rank(a.status) - rank(b.status) || a.productName.localeCompare(b.productName, "pt-BR");
  });

  // SLA dos chamados calculado na leitura.
  const slaByEntity = new Map(slas.filter((s) => s.entityType === "chamado").map((s) => [s.entityId, s]));
  const ticketsWithSla: TicketWithSla[] = tickets.map((t) => {
    const sla = (t.slaInstanceId ? slas.find((s) => s.id === t.slaInstanceId) : undefined) ?? slaByEntity.get(t.id);
    return sla ? { ...t, sla: computeSlaState(sla) } : t;
  });

  // Resumo financeiro (fonte: módulo Financeiro).
  const financeSummary = await getClientFinancialSummary(id);
  const financial: FinancialSummary = {
    ...financeSummary,
    mrr: financeSummary.mrr || products.filter((p) => p.status === "ativo").reduce((s, p) => s + p.monthlyValue, 0),
  };

  // Resumo de suporte: reincidência e CSAT.
  const reopened = tickets.filter((t) => t.reopenedFromId || t.reopenCount > 0).length;
  const csatScores = csat.length > 0 ? csat.map((c) => c.score) : tickets.map((t) => t.csatScore).filter((s): s is number => typeof s === "number");
  const support: SupportSummary = {
    total: tickets.length,
    open: tickets.filter((t) => OPEN_TICKET_STATUSES.has(t.status)).length,
    reopened,
    reopenRate: tickets.length > 0 ? reopened / tickets.length : 0,
    csatAverage: csatScores.length > 0 ? csatScores.reduce((s, v) => s + v, 0) / csatScores.length : undefined,
    csatCount: csatScores.length,
  };

  // Saúde e conta de CS mais recentes.
  healthScores.sort(byIsoDesc((h) => h.computedAt));
  csAccounts.sort(byIsoDesc((a) => a.updatedAt));

  // Usuários envolvidos, resolvidos em lote.
  const users = await resolveUsers([
    client.ownerSalesId,
    client.ownerCsId,
    client.ownerImplementationId,
    lead?.ownerId,
    campaign?.ownerId,
    ...opportunities.flatMap((o) => [o.ownerId, o.originUserId]),
    ...proposals.map((p) => p.ownerId),
    ...contracts.flatMap((c) => [c.ownerId, c.releasedBy]),
    ...projects.flatMap((p) => [p.ownerId, ...p.teamIds]),
    ...implementationTasks.map((t) => t.assigneeId),
    ...trainings.map((t) => t.instructorId),
    ...csAccounts.map((a) => a.ownerId),
    ...successPlans.flatMap((p) => [p.ownerId, ...p.actions.map((a) => a.responsibleId)]),
    ...renewals.map((r) => r.ownerId),
    ...tickets.map((t) => t.assigneeId),
    ...documents.map((d) => d.uploadedBy),
    ...tasks.flatMap((t) => [t.assigneeId, t.creatorId]),
    ...instanceSteps.map((s) => s.assigneeId),
    ...timeline.map((e) => e.actorId),
  ]);

  return {
    client,
    contacts,
    products,
    availableProducts,
    catalog: activeCatalog,
    ownedCategories,
    timeline,
    lead,
    campaign,
    opportunities,
    proposals,
    contracts,
    billing,
    projects,
    implementationTasks,
    trainings,
    csAccount: csAccounts[0] ?? null,
    healthScore: healthScores[0] ?? null,
    successPlans,
    renewals,
    tickets: ticketsWithSla,
    csat,
    documents,
    tasks,
    workflow: { instance, steps: instanceSteps },
    users,
    financial,
    support,
  };
}

/** Referência de usuário (id + nome) a partir do mapa resolvido, com fallback para o id. */
export function userRefFrom(users: Record<string, UserSummary>, id: string | undefined): UserRef | undefined {
  if (!id) return undefined;
  const u = users[id];
  return u ? { id: u.id, name: u.name } : { id, name: id };
}
