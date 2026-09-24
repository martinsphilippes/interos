import "server-only";
/**
 * Leituras do módulo de Vendas. Todas filtram por organização via `list()` (igualdade apenas) e
 * agregam/ordenam em memória; nomes de clientes/usuários são resolvidos em lote (sem N+1).
 *
 * Visibilidade: gestores, diretoria e admin veem todas as oportunidades; os demais veem as que
 * são donos ou originaram (ex.: suporte/CS que abriram upsell). A Central tem escopo "meu" ou
 * "equipe" (gestor: ele + liderados diretos; diretoria/admin: todo o time de vendas).
 */
import { getById, getManyByIds, list } from "@/server/db";
import { ORG_ID } from "@/server/db";
import { computeSlaState } from "@/server/sla";
import { dateKey, formatCompetence } from "@/lib/format";
import {
  COLLECTIONS,
  type Client,
  type Commission,
  type CommissionRule,
  type Contact,
  type CurrentUser,
  type DomainEvent,
  type Opportunity,
  type Organization,
  type Product,
  type Proposal,
  type SlaInstance,
  type SlaView,
  type Task,
  type TimelineEvent,
  type User,
  type Visit,
} from "@/domain/types";
import type { DepartmentKey } from "@/domain/constants";
import { effectiveProposalStatus, isOpenStage, type CommissionRuleView } from "@/components/sales/model";
import { competenceOf, getCommissionSummary, listActiveCommissionRules, type CommissionSummary } from "./commissions";
import { HEADQUARTERS, formatAddressLine, geocode, googleMapsSearchUrl, route } from "./maps";
import { getLastSweep, getOpportunitySettings, getPipelineStages, maybeRunFollowupSweep, type OpportunitySettings, type PipelineStage } from "./service";
import { OPEN_STAGES } from "./schemas";

// ---------------------------------------------------------------------------
// Tipos de leitura (serializáveis para Client Components)
// ---------------------------------------------------------------------------

export interface UserLite {
  id: string;
  name: string;
  avatarUrl?: string;
  jobTitle?: string;
  departmentId?: DepartmentKey;
}

export interface OpportunityRow extends Opportunity {
  clientName: string;
  clientCity?: string;
  /** Padrões de faturamento do cadastro (diálogo de ganho). */
  clientLegalName?: string;
  clientDocument?: string;
  clientEmail?: string;
  ownerName: string;
  ownerAvatarUrl?: string;
  contactName?: string;
  contactPhone?: string;
  contactWhatsapp?: string;
  daysInStage: number;
  daysSinceActivity: number;
  overdue: boolean;
  noNextAction: boolean;
  stalled: boolean;
  /** Status efetivo da proposta vinculada (vencida calculada na leitura). */
  proposalStatus?: Proposal["status"];
}

export interface ProductOption {
  id: string;
  name: string;
  category: Product["category"];
  setupPrice: number;
  monthlyPrice: number;
  hardwarePrice: number;
}

export interface ClientOptionLite {
  id: string;
  tradeName: string;
  status: Client["status"];
}

export interface SalesFormOptions {
  products: ProductOption[];
  sellers: UserLite[];
  clients: ClientOptionLite[];
}

// ---------------------------------------------------------------------------
// Utilitários
// ---------------------------------------------------------------------------

const DAY_MS = 86_400_000;

function toLite(u: User): UserLite {
  return { id: u.id, name: u.name, avatarUrl: u.avatarUrl, jobTitle: u.jobTitle, departmentId: u.departmentId };
}

function daysSince(iso: string | undefined, now: number): number {
  if (!iso) return 0;
  return Math.max(0, Math.floor((now - new Date(iso).getTime()) / DAY_MS));
}

export function todayKey(): string {
  return dateKey(new Date());
}

export function currentCompetence(): string {
  return todayKey().slice(0, 7);
}

function lastCompetences(count: number, from = currentCompetence()): string[] {
  const [y, m] = from.split("-").map(Number);
  const out: string[] = [];
  for (let i = count - 1; i >= 0; i--) out.push(new Date(Date.UTC(y, m - 1 - i, 1)).toISOString().slice(0, 7));
  return out;
}

/** Oportunidades que o usuário pode ver nas listas (pipeline, tabela, drawer). */
export function canSeeOpportunity(user: Pick<CurrentUser, "id" | "isManager">, opp: Pick<Opportunity, "ownerId" | "originUserId">): boolean {
  return user.isManager || opp.ownerId === user.id || opp.originUserId === user.id;
}

export async function listSalesUsers(): Promise<User[]> {
  const users = await list<User>(COLLECTIONS.users, { where: [["departmentId", "==", "vendas"]] });
  return users.filter((u) => u.active !== false).sort((a, b) => a.name.localeCompare(b.name, "pt-BR"));
}

export type ScopeKind = "meu" | "equipe";

export interface SalesScope {
  kind: ScopeKind;
  label: string;
  userIds: string[];
}

/** Escopo da Central: "meu" (só o usuário) ou "equipe" (gestor: ele + liderados; diretoria/admin: vendas inteiro). */
export async function resolveScope(user: CurrentUser, requested: string | undefined): Promise<SalesScope> {
  if (requested !== "equipe" || !user.isManager) return { kind: "meu", label: "Minhas vendas", userIds: [user.id] };
  const all = await list<User>(COLLECTIONS.users);
  const active = all.filter((u) => u.active !== false);
  const ids = user.isDirector
    ? active.filter((u) => u.departmentId === "vendas").map((u) => u.id)
    : [user.id, ...active.filter((u) => u.managerId === user.id).map((u) => u.id)];
  return { kind: "equipe", label: user.isDirector ? "Time de vendas" : "Minha equipe", userIds: Array.from(new Set(ids)) };
}

async function buildRows(opps: Opportunity[], settings: OpportunitySettings): Promise<OpportunityRow[]> {
  const now = Date.now();
  const nowIso = new Date(now).toISOString();
  const today = todayKey();
  const [clients, owners, primaryContacts, proposals] = await Promise.all([
    getManyByIds<Client>(COLLECTIONS.clients, opps.map((o) => o.clientId)),
    getManyByIds<User>(COLLECTIONS.users, opps.map((o) => o.ownerId)),
    list<Contact>(COLLECTIONS.contacts, { where: [["isPrimary", "==", true]] }),
    getManyByIds<Proposal>(COLLECTIONS.proposals, opps.map((o) => o.proposalId ?? "")),
  ]);
  const contactByClient = new Map(primaryContacts.map((c) => [c.clientId, c]));
  return opps.map((o) => {
    const client = clients.get(o.clientId);
    const owner = owners.get(o.ownerId);
    const contact = contactByClient.get(o.clientId);
    const proposal = o.proposalId ? proposals.get(o.proposalId) : undefined;
    const open = isOpenStage(o.stage);
    const sinceActivity = daysSince(o.lastActivityAt, now);
    return {
      ...o,
      clientName: client?.tradeName ?? "Cliente removido",
      clientCity: client?.address?.city,
      clientLegalName: client?.legalName,
      clientDocument: client?.document,
      clientEmail: client?.email,
      ownerName: owner?.name ?? "Sem vendedor",
      ownerAvatarUrl: owner?.avatarUrl,
      contactName: contact?.name,
      contactPhone: contact?.phone ?? client?.phone,
      contactWhatsapp: contact?.whatsapp ?? client?.whatsapp ?? contact?.phone,
      daysInStage: daysSince(o.stageChangedAt, now),
      daysSinceActivity: sinceActivity,
      overdue: open && Boolean(o.nextActionAt && o.nextActionAt < nowIso),
      noNextAction: open && !o.nextActionAt,
      stalled: open && sinceActivity > settings.diasSemMovimentoParaParada,
      proposalStatus: proposal ? effectiveProposalStatus(proposal, today) : undefined,
    };
  });
}

// ---------------------------------------------------------------------------
// Oportunidades
// ---------------------------------------------------------------------------

export interface OpportunityListResult {
  rows: OpportunityRow[];
  stages: PipelineStage[];
  settings: OpportunitySettings;
  sellers: UserLite[];
  products: ProductOption[];
}

/** Oportunidades visíveis ao usuário (todas as etapas), com dados de exibição resolvidos. */
export async function listOpportunities(user: CurrentUser): Promise<OpportunityListResult> {
  const [opps, settings, stages, sellers, products] = await Promise.all([
    list<Opportunity>(COLLECTIONS.opportunities),
    getOpportunitySettings(),
    getPipelineStages(),
    listSalesUsers(),
    listProductOptions(),
  ]);
  const visible = opps.filter((o) => canSeeOpportunity(user, o));
  const rows = await buildRows(visible, settings);
  rows.sort((a, b) => (a.lastActivityAt < b.lastActivityAt ? 1 : -1));
  // Vendedores que aparecem nas oportunidades (inclui donos fora do departamento de vendas).
  const sellerMap = new Map(sellers.map((s) => [s.id, toLite(s)]));
  for (const r of rows) if (!sellerMap.has(r.ownerId)) sellerMap.set(r.ownerId, { id: r.ownerId, name: r.ownerName, avatarUrl: r.ownerAvatarUrl });
  return { rows, stages, settings, sellers: Array.from(sellerMap.values()).sort((a, b) => a.name.localeCompare(b.name, "pt-BR")), products };
}

export async function listProductOptions(): Promise<ProductOption[]> {
  const products = await list<Product>(COLLECTIONS.products);
  return products
    .filter((p) => p.active)
    .sort((a, b) => a.order - b.order)
    .map((p) => ({ id: p.id, name: p.name, category: p.category, setupPrice: p.setupPrice, monthlyPrice: p.monthlyPrice, hardwarePrice: p.hardwarePrice }));
}

export async function getSalesFormOptions(): Promise<SalesFormOptions> {
  const [products, sellers, clients] = await Promise.all([listProductOptions(), listSalesUsers(), list<Client>(COLLECTIONS.clients)]);
  return {
    products,
    sellers: sellers.map(toLite),
    clients: clients
      .filter((c) => c.status !== "cancelado")
      .map((c) => ({ id: c.id, tradeName: c.tradeName, status: c.status }))
      .sort((a, b) => a.tradeName.localeCompare(b.tradeName, "pt-BR")),
  };
}

export interface OpportunityDetail {
  opportunity: OpportunityRow;
  client: Pick<Client, "id" | "tradeName" | "legalName" | "document" | "email" | "phone" | "whatsapp" | "address" | "status">;
  contacts: Contact[];
  proposals: (Proposal & { effectiveStatus: Proposal["status"] })[];
  tasks: Task[];
  visits: Visit[];
  /** Eventos da oportunidade, das propostas e das visitas, no formato da timeline. */
  activities: TimelineEvent[];
  sla: (SlaInstance & { view: SlaView }) | null;
  users: Record<string, UserLite>;
  products: ProductOption[];
  stages: PipelineStage[];
}

export async function getOpportunityDetail(user: CurrentUser, id: string): Promise<OpportunityDetail | null> {
  const opp = await getById<Opportunity>(COLLECTIONS.opportunities, id);
  if (!opp || !canSeeOpportunity(user, opp)) return null;
  const [settings, client, contacts, proposals, tasks, visits, slas, products, stages] = await Promise.all([
    getOpportunitySettings(),
    getById<Client>(COLLECTIONS.clients, opp.clientId),
    list<Contact>(COLLECTIONS.contacts, { where: [["clientId", "==", opp.clientId]] }),
    list<Proposal>(COLLECTIONS.proposals, { where: [["opportunityId", "==", opp.id]] }),
    list<Task>(COLLECTIONS.tasks, { where: [["processId", "==", opp.id]] }),
    list<Visit>(COLLECTIONS.visits, { where: [["opportunityId", "==", opp.id]] }),
    list<SlaInstance>(COLLECTIONS.slaInstances, { where: [["entityId", "==", opp.id]] }),
    listProductOptions(),
    getPipelineStages(),
  ]);
  if (!client) return null;
  const [row] = await buildRows([opp], settings);
  const entityIds = [opp.id, ...proposals.map((p) => p.id), ...visits.map((v) => v.id)];
  const events = await list<DomainEvent>(COLLECTIONS.events, { where: [["entityId", "in", entityIds]] });
  const activities: TimelineEvent[] = events
    .sort((a, b) => (a.occurredAt < b.occurredAt ? 1 : -1))
    .map((e) => ({
      id: e.id,
      organizationId: e.organizationId,
      createdAt: e.createdAt,
      updatedAt: e.updatedAt,
      clientId: e.clientId ?? opp.clientId,
      eventId: e.id,
      type: e.type,
      occurredAt: e.occurredAt,
      actorId: e.actorId,
      actorName: e.actorName,
      title: e.title,
      description: e.description,
      entityType: e.entityType,
      entityId: e.entityId,
      department: e.department,
    }));

  const today = todayKey();
  const oppTasks = tasks.filter((t) => t.processType === "opportunity").sort((a, b) => {
    const ao = a.status === "concluida" || a.status === "cancelada" ? 1 : 0;
    const bo = b.status === "concluida" || b.status === "cancelada" ? 1 : 0;
    return ao - bo || (a.dueAt ?? "9").localeCompare(b.dueAt ?? "9");
  });
  const activeSla = slas.filter((s) => s.entityType === "oportunidade").sort((a, b) => (a.startedAt < b.startedAt ? 1 : -1))[0];
  const userIds = [opp.ownerId, opp.originUserId, ...proposals.map((p) => p.ownerId), ...oppTasks.map((t) => t.assigneeId), ...visits.map((v) => v.sellerId)];
  const users = await getManyByIds<User>(COLLECTIONS.users, userIds.filter((x): x is string => Boolean(x)));

  return {
    opportunity: row,
    client: { id: client.id, tradeName: client.tradeName, legalName: client.legalName, document: client.document, email: client.email, phone: client.phone, whatsapp: client.whatsapp, address: client.address, status: client.status },
    contacts: contacts.sort((a, b) => Number(b.isPrimary) - Number(a.isPrimary) || a.name.localeCompare(b.name, "pt-BR")),
    proposals: proposals
      .sort((a, b) => (a.createdAt < b.createdAt ? 1 : -1))
      .map((p) => ({ ...p, effectiveStatus: effectiveProposalStatus(p, today) })),
    tasks: oppTasks,
    visits: visits.sort((a, b) => (a.scheduledAt < b.scheduledAt ? 1 : -1)),
    activities,
    sla: activeSla ? { ...activeSla, view: computeSlaState(activeSla) } : null,
    users: Object.fromEntries(Array.from(users.values()).map((u) => [u.id, toLite(u)])),
    products,
    stages,
  };
}

// ---------------------------------------------------------------------------
// Central de Vendas
// ---------------------------------------------------------------------------

export interface ContactNowItem {
  row: OpportunityRow;
  score: number;
  reasons: string[];
}

export interface SalesOverview {
  scope: SalesScope;
  competence: string;
  settings: OpportunitySettings;
  stats: {
    pipelineMonthly: number;
    pipelineSetup: number;
    pipelineHardware: number;
    openCount: number;
    overdueCount: number;
    noNextActionCount: number;
    stalledCount: number;
    wonMonthCount: number;
    wonMonthMonthly: number;
    wonMonthSetup: number;
    createdMonthCount: number;
    /** Ganhas no mês / criadas no mês (null sem oportunidades criadas). */
    conversion: number | null;
    /** Mensalidade média das ganhas no mês. */
    avgTicket: number | null;
  };
  commission: CommissionSummary;
  contactNow: ContactNowItem[];
  funnel: { stage: string; label: string; count: number; monthly: number; setup: number }[];
  wonHistory: { competence: string; label: string; count: number; monthly: number; setup: number }[];
  rules: CommissionRuleView[];
  lastSweep: Awaited<ReturnType<typeof getLastSweep>>;
  /** Filtro de vendedor para os links de drill-down (escopo "meu"). */
  sellerParam?: string;
}

/**
 * Painel do vendedor/gestor. Antes de calcular, dispara a varredura de follow-up se a última
 * execução tiver mais de 1 hora (na Onda 5 isso vira automação agendada).
 */
export async function getSalesOverview(user: CurrentUser, escopo?: string): Promise<SalesOverview> {
  try {
    await maybeRunFollowupSweep();
  } catch (error) {
    console.error("[vendas] falha na varredura de follow-up", error);
  }

  const scope = await resolveScope(user, escopo);
  const comp = currentCompetence();
  const [all, settings, stages, rules, lastSweep] = await Promise.all([
    list<Opportunity>(COLLECTIONS.opportunities),
    getOpportunitySettings(),
    getPipelineStages(),
    listActiveCommissionRules(),
    getLastSweep(),
  ]);
  const ids = new Set(scope.userIds);
  const mine = all.filter((o) => ids.has(o.ownerId));
  const rows = await buildRows(mine, settings);
  const open = rows.filter((r) => isOpenStage(r.stage));
  const wonMonth = rows.filter((r) => r.stage === "ganho" && r.wonAt && competenceOf(r.wonAt) === comp);
  const createdMonth = rows.filter((r) => competenceOf(r.createdAt) === comp);
  const commission = await getCommissionSummary(scope.userIds, comp, { opportunities: mine });

  // "Contatar agora": urgência = follow-up vencido > sem próxima ação > parada > quente com valor alto.
  const annual = (r: OpportunityRow) => r.monthlyTotal * 12 + r.setupTotal + r.hardwareTotal;
  const avgValue = open.length > 0 ? open.reduce((s, r) => s + annual(r), 0) / open.length : 0;
  const now = Date.now();
  const contactNow: ContactNowItem[] = [];
  for (const r of open) {
    let score = 0;
    const reasons: string[] = [];
    if (r.overdue && r.nextActionAt) {
      const late = Math.max(0, Math.floor((now - new Date(r.nextActionAt).getTime()) / DAY_MS));
      score += 100 + late * 5;
      reasons.push(late > 0 ? `Follow-up vencido há ${late} ${late === 1 ? "dia" : "dias"}` : "Follow-up vence hoje");
    }
    if (r.noNextAction) {
      score += 60;
      reasons.push("Sem próxima ação");
    }
    if (r.stalled) {
      score += 40 + r.daysSinceActivity;
      reasons.push(`Parada há ${r.daysSinceActivity} dias`);
    }
    if (r.temperature === "quente" && annual(r) >= avgValue && avgValue > 0) {
      score += 30 + Math.min(annual(r) / 1000, 30);
      reasons.push("Quente com valor alto");
    }
    if (score > 0) contactNow.push({ row: r, score, reasons });
  }
  contactNow.sort((a, b) => b.score - a.score);

  const funnel = stages.map((s) => {
    const inStage = open.filter((r) => r.stage === s.key);
    return { stage: s.key, label: s.label, count: inStage.length, monthly: inStage.reduce((t, r) => t + r.monthlyTotal, 0), setup: inStage.reduce((t, r) => t + r.setupTotal, 0) };
  });
  // Etapas abertas fora das colunas configuradas também entram no funil.
  for (const key of OPEN_STAGES) {
    if (funnel.some((f) => f.stage === key)) continue;
    const inStage = open.filter((r) => r.stage === key);
    if (inStage.length > 0) funnel.push({ stage: key, label: key, count: inStage.length, monthly: inStage.reduce((t, r) => t + r.monthlyTotal, 0), setup: inStage.reduce((t, r) => t + r.setupTotal, 0) });
  }

  const wonHistory = lastCompetences(6, comp).map((k) => {
    const won = rows.filter((r) => r.stage === "ganho" && r.wonAt && competenceOf(r.wonAt) === k);
    return { competence: k, label: formatCompetence(k), count: won.length, monthly: won.reduce((t, r) => t + r.monthlyTotal, 0), setup: won.reduce((t, r) => t + r.setupTotal, 0) };
  });

  const wonMonthMonthly = wonMonth.reduce((t, r) => t + r.monthlyTotal, 0);
  return {
    scope,
    competence: comp,
    settings,
    stats: {
      pipelineMonthly: open.reduce((t, r) => t + r.monthlyTotal, 0),
      pipelineSetup: open.reduce((t, r) => t + r.setupTotal, 0),
      pipelineHardware: open.reduce((t, r) => t + r.hardwareTotal, 0),
      openCount: open.length,
      overdueCount: open.filter((r) => r.overdue).length,
      noNextActionCount: open.filter((r) => r.noNextAction).length,
      stalledCount: open.filter((r) => r.stalled).length,
      wonMonthCount: wonMonth.length,
      wonMonthMonthly,
      wonMonthSetup: wonMonth.reduce((t, r) => t + r.setupTotal, 0),
      createdMonthCount: createdMonth.length,
      conversion: createdMonth.length > 0 ? wonMonth.length / createdMonth.length : null,
      avgTicket: wonMonth.length > 0 ? wonMonthMonthly / wonMonth.length : null,
    },
    commission,
    contactNow: contactNow.slice(0, 12),
    funnel,
    wonHistory,
    rules: rules.map(ruleView),
    lastSweep,
    sellerParam: scope.kind === "meu" ? user.id : undefined,
  };
}

function ruleView(r: CommissionRule): CommissionRuleView {
  return { id: r.id, name: r.name, productId: r.productId, revenueType: r.revenueType, mode: r.mode, value: r.value, releaseCondition: r.releaseCondition, releaseInstallment: r.releaseInstallment };
}

// ---------------------------------------------------------------------------
// Propostas
// ---------------------------------------------------------------------------

export interface ProposalRow extends Proposal {
  effectiveStatus: Proposal["status"];
  clientName: string;
  ownerName: string;
  opportunityTitle: string;
  opportunityStage?: Opportunity["stage"];
  /** Última versão do número (as anteriores ficam como histórico). */
  isLatest: boolean;
}

export async function listProposals(user: CurrentUser): Promise<ProposalRow[]> {
  const [proposals, opps] = await Promise.all([list<Proposal>(COLLECTIONS.proposals), list<Opportunity>(COLLECTIONS.opportunities)]);
  const oppById = new Map(opps.map((o) => [o.id, o]));
  const visible = proposals.filter((p) => {
    const opp = oppById.get(p.opportunityId);
    return user.isManager || p.ownerId === user.id || (opp ? canSeeOpportunity(user, opp) : false);
  });
  const [clients, owners] = await Promise.all([getManyByIds<Client>(COLLECTIONS.clients, visible.map((p) => p.clientId)), getManyByIds<User>(COLLECTIONS.users, visible.map((p) => p.ownerId))]);
  const latestVersion = new Map<string, number>();
  for (const p of visible) latestVersion.set(p.number, Math.max(latestVersion.get(p.number) ?? 0, p.version));
  const today = todayKey();
  return visible
    .map((p) => {
      const opp = oppById.get(p.opportunityId);
      return {
        ...p,
        effectiveStatus: effectiveProposalStatus(p, today),
        clientName: clients.get(p.clientId)?.tradeName ?? "Cliente removido",
        ownerName: owners.get(p.ownerId)?.name ?? "—",
        opportunityTitle: opp?.title ?? "Oportunidade removida",
        opportunityStage: opp?.stage,
        isLatest: latestVersion.get(p.number) === p.version,
      };
    })
    .sort((a, b) => (a.updatedAt < b.updatedAt ? 1 : -1));
}

export interface ProposalDetail {
  proposal: Proposal & { effectiveStatus: Proposal["status"] };
  client: Client;
  contact: Contact | null;
  opportunity: Opportunity;
  owner: UserLite | null;
  versions: (Pick<Proposal, "id" | "version" | "status" | "createdAt"> & { effectiveStatus: Proposal["status"] })[];
  activities: TimelineEvent[];
  products: ProductOption[];
  organization: { name: string } | null;
}

export async function getProposalDetail(user: CurrentUser, id: string): Promise<ProposalDetail | null> {
  const proposal = await getById<Proposal>(COLLECTIONS.proposals, id);
  if (!proposal) return null;
  const [client, opportunity, contacts, siblings, events, products, owner, organization] = await Promise.all([
    getById<Client>(COLLECTIONS.clients, proposal.clientId),
    getById<Opportunity>(COLLECTIONS.opportunities, proposal.opportunityId),
    list<Contact>(COLLECTIONS.contacts, { where: [["clientId", "==", proposal.clientId]] }),
    list<Proposal>(COLLECTIONS.proposals, { where: [["number", "==", proposal.number]] }),
    list<DomainEvent>(COLLECTIONS.events, { where: [["entityId", "==", proposal.id]] }),
    listProductOptions(),
    getById<User>(COLLECTIONS.users, proposal.ownerId),
    getById<Organization>(COLLECTIONS.organizations, ORG_ID),
  ]);
  if (!client || !opportunity) return null;
  if (!user.isManager && proposal.ownerId !== user.id && !canSeeOpportunity(user, opportunity)) return null;
  const today = todayKey();
  return {
    proposal: { ...proposal, effectiveStatus: effectiveProposalStatus(proposal, today) },
    client,
    contact: contacts.find((c) => c.isPrimary) ?? contacts[0] ?? null,
    opportunity,
    owner: owner ? toLite(owner) : null,
    versions: siblings.sort((a, b) => b.version - a.version).map((p) => ({ id: p.id, version: p.version, status: p.status, createdAt: p.createdAt, effectiveStatus: effectiveProposalStatus(p, today) })),
    activities: events
      .sort((a, b) => (a.occurredAt < b.occurredAt ? 1 : -1))
      .map((e) => ({ id: e.id, organizationId: e.organizationId, createdAt: e.createdAt, updatedAt: e.updatedAt, clientId: e.clientId ?? proposal.clientId, eventId: e.id, type: e.type, occurredAt: e.occurredAt, actorId: e.actorId, actorName: e.actorName, title: e.title, description: e.description, entityType: e.entityType, entityId: e.entityId, department: e.department })),
    products,
    organization: organization ? { name: organization.name } : null,
  };
}

/** Oportunidades abertas (para "Nova proposta" na página de propostas). */
export async function listOpenOpportunityOptions(user: CurrentUser): Promise<{ id: string; title: string; clientName: string; products: Opportunity["products"] }[]> {
  const opps = (await list<Opportunity>(COLLECTIONS.opportunities)).filter((o) => isOpenStage(o.stage) && canSeeOpportunity(user, o));
  const clients = await getManyByIds<Client>(COLLECTIONS.clients, opps.map((o) => o.clientId));
  return opps
    .map((o) => ({ id: o.id, title: o.title, clientName: clients.get(o.clientId)?.tradeName ?? "—", products: o.products }))
    .sort((a, b) => a.clientName.localeCompare(b.clientName, "pt-BR"));
}

// ---------------------------------------------------------------------------
// Visitas
// ---------------------------------------------------------------------------

export interface VisitRow extends Visit {
  clientName: string;
  sellerName: string;
  sellerAvatarUrl?: string;
  opportunityTitle?: string;
  addressLine: string;
  mapsUrl: string | null;
  /** Distância estimada da sede (Juazeiro do Norte), quando há coordenada. */
  distanceKm?: number;
  travelMinutes?: number;
}

async function toVisitRows(visits: Visit[]): Promise<VisitRow[]> {
  const [clients, sellers, opps] = await Promise.all([
    getManyByIds<Client>(COLLECTIONS.clients, visits.map((v) => v.clientId ?? "")),
    getManyByIds<User>(COLLECTIONS.users, visits.map((v) => v.sellerId)),
    getManyByIds<Opportunity>(COLLECTIONS.opportunities, visits.map((v) => v.opportunityId ?? "")),
  ]);
  const rows: VisitRow[] = [];
  for (const v of visits) {
    const position = await geocode(v.address);
    const estimate = position ? await route(HEADQUARTERS.position, position) : null;
    rows.push({
      ...v,
      clientName: v.clientId ? (clients.get(v.clientId)?.tradeName ?? "Cliente removido") : "Sem cliente",
      sellerName: sellers.get(v.sellerId)?.name ?? "—",
      sellerAvatarUrl: sellers.get(v.sellerId)?.avatarUrl,
      opportunityTitle: v.opportunityId ? opps.get(v.opportunityId)?.title : undefined,
      addressLine: formatAddressLine(v.address),
      mapsUrl: googleMapsSearchUrl(v.address),
      distanceKm: estimate?.distanceKm,
      travelMinutes: estimate?.durationMinutes,
    });
  }
  return rows;
}

export async function listVisits(user: CurrentUser): Promise<VisitRow[]> {
  const visits = await list<Visit>(COLLECTIONS.visits);
  const visible = user.isManager ? visits : visits.filter((v) => v.sellerId === user.id || v.createdBy === user.id);
  const rows = await toVisitRows(visible);
  // Pendentes primeiro (mais próximas), depois o histórico (mais recentes).
  const pending = (v: Visit) => v.status === "agendada" || v.status === "remarcada";
  return rows.sort((a, b) => {
    if (pending(a) !== pending(b)) return pending(a) ? -1 : 1;
    return pending(a) ? a.scheduledAt.localeCompare(b.scheduledAt) : b.scheduledAt.localeCompare(a.scheduledAt);
  });
}

export async function getVisitDetail(user: CurrentUser, id: string): Promise<{ visit: VisitRow; activities: TimelineEvent[] } | null> {
  const visit = await getById<Visit>(COLLECTIONS.visits, id);
  if (!visit) return null;
  if (!user.isManager && visit.sellerId !== user.id && visit.createdBy !== user.id) return null;
  const [[row], events] = await Promise.all([toVisitRows([visit]), list<DomainEvent>(COLLECTIONS.events, { where: [["entityId", "==", visit.id]] })]);
  return {
    visit: row,
    activities: events
      .sort((a, b) => (a.occurredAt < b.occurredAt ? 1 : -1))
      .map((e) => ({ id: e.id, organizationId: e.organizationId, createdAt: e.createdAt, updatedAt: e.updatedAt, clientId: e.clientId ?? visit.clientId ?? "", eventId: e.id, type: e.type, occurredAt: e.occurredAt, actorId: e.actorId, actorName: e.actorName, title: e.title, description: e.description, entityType: e.entityType, entityId: e.entityId, department: e.department })),
  };
}

/** Endereço cadastrado de cada cliente (pré-preenche o formulário de visita). */
export async function listClientAddresses(): Promise<Record<string, Client["address"]>> {
  const clients = await list<Client>(COLLECTIONS.clients);
  return Object.fromEntries(clients.filter((c) => c.status !== "cancelado").map((c) => [c.id, c.address ?? {}]));
}

/** Oportunidades abertas por cliente (select de oportunidade no formulário de visita). */
export async function listOpenOpportunitiesByClient(user: CurrentUser): Promise<Record<string, { id: string; title: string }[]>> {
  const opps = (await list<Opportunity>(COLLECTIONS.opportunities)).filter((o) => isOpenStage(o.stage) && canSeeOpportunity(user, o));
  const out: Record<string, { id: string; title: string }[]> = {};
  for (const o of opps) (out[o.clientId] ??= []).push({ id: o.id, title: o.title });
  return out;
}

// ---------------------------------------------------------------------------
// Agenda
// ---------------------------------------------------------------------------

export type AgendaView = "semana" | "mes";

export interface AgendaItem {
  id: string;
  kind: "visita" | "tarefa" | "followup";
  at: string;
  day: string;
  title: string;
  subtitle?: string;
  href: string;
  done: boolean;
  overdue: boolean;
  ownerName?: string;
}

export interface AgendaData {
  view: AgendaView;
  anchor: string;
  start: string;
  end: string;
  days: string[];
  items: AgendaItem[];
  scope: SalesScope;
}

function addDaysKey(key: string, days: number): string {
  const [y, m, d] = key.split("-").map(Number);
  return new Date(Date.UTC(y, m - 1, d + days)).toISOString().slice(0, 10);
}

function weekStart(key: string): string {
  const [y, m, d] = key.split("-").map(Number);
  const dow = new Date(Date.UTC(y, m - 1, d)).getUTCDay();
  return addDaysKey(key, -((dow + 6) % 7));
}

/** Intervalo exibido: semana (seg–dom) ou grade do mês (semanas completas). */
export function agendaRange(view: AgendaView, anchor: string): { start: string; end: string; days: string[] } {
  let start: string;
  let end: string;
  if (view === "semana") {
    start = weekStart(anchor);
    end = addDaysKey(start, 6);
  } else {
    const [y, m] = anchor.split("-").map(Number);
    const first = `${anchor.slice(0, 7)}-01`;
    const last = new Date(Date.UTC(y, m, 0)).toISOString().slice(0, 10);
    start = weekStart(first);
    end = addDaysKey(weekStart(last), 6);
  }
  const days: string[] = [];
  for (let k = start; k <= end; k = addDaysKey(k, 1)) days.push(k);
  return { start, end, days };
}

export async function getAgenda(user: CurrentUser, options: { view: AgendaView; anchor: string; escopo?: string }): Promise<AgendaData> {
  const scope = await resolveScope(user, options.escopo);
  const ids = new Set(scope.userIds);
  const { start, end, days } = agendaRange(options.view, options.anchor);
  const [visits, tasks, opps, users] = await Promise.all([
    list<Visit>(COLLECTIONS.visits),
    list<Task>(COLLECTIONS.tasks, { where: [["assigneeId", "in", scope.userIds]] }),
    list<Opportunity>(COLLECTIONS.opportunities),
    getManyByIds<User>(COLLECTIONS.users, scope.userIds),
  ]);
  const clientIds = [...visits.map((v) => v.clientId ?? ""), ...opps.map((o) => o.clientId)];
  const clients = await getManyByIds<Client>(COLLECTIONS.clients, clientIds);
  const nowIso = new Date().toISOString();
  const inRange = (iso: string | undefined) => {
    if (!iso) return false;
    const k = dateKey(iso);
    return k >= start && k <= end;
  };
  const team = scope.kind === "equipe";
  const items: AgendaItem[] = [];

  for (const v of visits) {
    if (!ids.has(v.sellerId) || v.status === "cancelada" || !inRange(v.scheduledAt)) continue;
    items.push({
      id: `visita:${v.id}`,
      kind: "visita",
      at: v.scheduledAt,
      day: dateKey(v.scheduledAt),
      title: `Visita · ${v.objective}`,
      subtitle: v.clientId ? clients.get(v.clientId)?.tradeName : undefined,
      href: `/vendas/visitas?visita=${v.id}`,
      done: v.status === "realizada",
      overdue: v.status !== "realizada" && v.scheduledAt < nowIso,
      ownerName: team ? users.get(v.sellerId)?.name : undefined,
    });
  }
  for (const t of tasks) {
    if (!t.dueAt || t.status === "cancelada" || !inRange(t.dueAt)) continue;
    items.push({
      id: `tarefa:${t.id}`,
      kind: "tarefa",
      at: t.dueAt,
      day: dateKey(t.dueAt),
      title: t.title,
      subtitle: t.clientName,
      href: `/tarefas?tarefa=${t.id}`,
      done: t.status === "concluida",
      overdue: t.status !== "concluida" && t.dueAt < nowIso,
      ownerName: team ? t.assigneeName : undefined,
    });
  }
  for (const o of opps) {
    if (!ids.has(o.ownerId) || !isOpenStage(o.stage) || !inRange(o.nextActionAt)) continue;
    items.push({
      id: `followup:${o.id}`,
      kind: "followup",
      at: o.nextActionAt!,
      day: dateKey(o.nextActionAt),
      title: `Follow-up · ${o.nextAction ?? o.title}`,
      subtitle: clients.get(o.clientId)?.tradeName,
      href: `/vendas/oportunidades?oportunidade=${o.id}`,
      done: false,
      overdue: o.nextActionAt! < nowIso,
      ownerName: team ? users.get(o.ownerId)?.name : undefined,
    });
  }
  items.sort((a, b) => a.at.localeCompare(b.at));
  return { view: options.view, anchor: options.anchor, start, end, days, items, scope };
}

// Reexporta tipos usados pelas páginas.
export type { CommissionSummary, OpportunitySettings, PipelineStage };
export type { Commission };
