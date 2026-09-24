import "server-only";
/**
 * Leituras do módulo de Customer Success. Cada tela faz uma leitura em lote das coleções envolvidas
 * (filtradas por organização via `list()`, igualdade apenas) e agrega em memória, sem N+1.
 */
import { getById, getManyByIds, list } from "@/server/db";
import { getSetting } from "@/server/admin/queries";
import { dateKey } from "@/lib/format";
import {
  COLLECTIONS,
  type Billing,
  type ChurnRecord,
  type Client,
  type ClientProduct,
  type Contact,
  type Contract,
  type CsAccount,
  type CsatResponse,
  type CurrentUser,
  type DomainEvent,
  type HealthScore,
  type LeadSource,
  type Opportunity,
  type Product,
  type Renewal,
  type SuccessPlan,
  type SupportTicket,
  type TimelineEvent,
  type User,
} from "@/domain/types";
import { HEALTH_LEVELS, type DepartmentKey, type HealthLevel } from "@/domain/constants";
import { csatAverage, getHealthConfig, HEALTH_WINDOW_DAYS, isOpenTicket, isPortfolioClient, lastInteractionOf, overdueBillings, type HealthConfig } from "./health";
import { checkActivation, getLastHealthSweep, RENEWAL_LOOKAHEAD_DAYS, type ActivationCheck, type RecalculateAllResult, type SuccessPlanWithTasks } from "./service";
import { explainHealth } from "./schemas";

const DAY_MS = 86_400_000;
const OPEN_OPPORTUNITY = new Set<Opportunity["stage"]>(["qualificacao", "diagnostico", "proposta", "negociacao", "fechamento"]);
const OPEN_RENEWAL = new Set<Renewal["status"]>(["aguardando", "em_negociacao"]);

type SearchParams = Record<string, string | string[] | undefined>;
const one = (params: SearchParams, key: string) => {
  const v = params[key];
  return (Array.isArray(v) ? v[0] : v) || undefined;
};
const isLevel = (v: string | undefined): v is HealthLevel => Boolean(v) && (HEALTH_LEVELS as readonly string[]).includes(v!);

// ---------------------------------------------------------------------------
// Usuários e escopo
// ---------------------------------------------------------------------------

export interface UserLite {
  id: string;
  name: string;
  avatarUrl?: string;
  jobTitle?: string;
  departmentId: DepartmentKey;
}

const toLite = (u: User): UserLite => ({ id: u.id, name: u.name, avatarUrl: u.avatarUrl, jobTitle: u.jobTitle, departmentId: u.departmentId });
const byName = (a: { name: string }, b: { name: string }) => a.name.localeCompare(b.name, "pt-BR");

export async function listActiveUsers(): Promise<UserLite[]> {
  const users = await list<User>(COLLECTIONS.users);
  return users.filter((u) => u.active !== false).map(toLite).sort(byName);
}

/** Usuários de CS (responsáveis possíveis pela carteira). */
export async function listCsUsers(): Promise<UserLite[]> {
  return (await listActiveUsers()).filter((u) => u.departmentId === "cs");
}

export interface CsScope {
  /** Responsável filtrado; undefined = carteira inteira. */
  ownerId?: string;
  /** Valor do parâmetro `responsavel` na URL ("todos" ou id). */
  param: string;
}

/** Escopo padrão: analista de CS vê a própria carteira; gestores e demais áreas veem a equipe inteira. */
export function resolveScope(user: Pick<CurrentUser, "id" | "departmentId" | "isManager">, requested?: string): CsScope {
  if (requested === "todos") return { param: "todos" };
  if (requested) return { ownerId: requested, param: requested };
  if (user.departmentId === "cs" && !user.isManager) return { ownerId: user.id, param: user.id };
  return { param: "todos" };
}

function inScope(client: Client, account: CsAccount | undefined, scope: CsScope): boolean {
  if (!scope.ownerId) return true;
  return (account?.ownerId ?? client.ownerCsId) === scope.ownerId;
}

// ---------------------------------------------------------------------------
// Base da carteira (uma leitura por coleção)
// ---------------------------------------------------------------------------

interface CsBase {
  clients: Client[];
  accounts: Map<string, CsAccount>;
  products: Map<string, ClientProduct[]>;
  tickets: Map<string, SupportTicket[]>;
  csat: Map<string, CsatResponse[]>;
  billings: Map<string, Billing[]>;
  opportunities: Map<string, Opportunity[]>;
  plans: Map<string, SuccessPlan[]>;
  renewals: Renewal[];
  contacts: Map<string, Contact[]>;
  users: Map<string, UserLite>;
  catalog: Product[];
}

function groupBy<T extends { clientId: string }>(items: T[]): Map<string, T[]> {
  const map = new Map<string, T[]>();
  for (const item of items) {
    const arr = map.get(item.clientId) ?? [];
    arr.push(item);
    map.set(item.clientId, arr);
  }
  return map;
}

async function loadBase(): Promise<CsBase> {
  const [clients, accounts, products, tickets, csat, billings, opportunities, plans, renewals, contacts, users, catalog] = await Promise.all([
    list<Client>(COLLECTIONS.clients),
    list<CsAccount>(COLLECTIONS.csAccounts),
    list<ClientProduct>(COLLECTIONS.clientProducts),
    list<SupportTicket>(COLLECTIONS.supportTickets),
    list<CsatResponse>(COLLECTIONS.csatResponses),
    list<Billing>(COLLECTIONS.billing),
    list<Opportunity>(COLLECTIONS.opportunities),
    list<SuccessPlan>(COLLECTIONS.successPlans),
    list<Renewal>(COLLECTIONS.renewals),
    list<Contact>(COLLECTIONS.contacts),
    list<User>(COLLECTIONS.users),
    list<Product>(COLLECTIONS.products),
  ]);
  const accountMap = new Map<string, CsAccount>();
  for (const a of [...accounts].sort((x, y) => (x.updatedAt < y.updatedAt ? -1 : 1))) accountMap.set(a.clientId, a);
  return {
    clients,
    accounts: accountMap,
    products: groupBy(products),
    tickets: groupBy(tickets),
    csat: groupBy(csat),
    billings: groupBy(billings),
    opportunities: groupBy(opportunities),
    plans: groupBy(plans),
    renewals,
    contacts: groupBy(contacts),
    users: new Map(users.map((u) => [u.id, toLite(u)])),
    catalog: catalog.filter((p) => p.active !== false).sort((a, b) => a.order - b.order),
  };
}

// ---------------------------------------------------------------------------
// Carteira
// ---------------------------------------------------------------------------

export interface PortfolioRow {
  clientId: string;
  tradeName: string;
  legalName: string;
  status: Client["status"];
  phone?: string;
  whatsapp?: string;
  mrr: number;
  activatedAt?: string;
  healthScore?: number;
  healthLevel?: HealthLevel;
  owner?: UserLite;
  products: { id: string; name: string; status: ClientProduct["status"] }[];
  accountId?: string;
  adoptionPct?: number;
  csatAvg?: number;
  csatCount: number;
  openTickets: number;
  overdueAmount: number;
  overdueCount: number;
  lastInteractionAt?: string;
  nextInteractionAt?: string;
  nextOverdue: boolean;
  riskLevel?: HealthLevel;
  riskReasons: string[];
  openOpportunities: number;
  activePlanId?: string;
  /** Jornada na etapa de CS: ativação pendente (botão "Ativar cliente"). */
  activationPending: boolean;
  contacts: Contact[];
}

export interface PortfolioFilters {
  ownerId?: string;
  health?: HealthLevel;
  productId?: string;
  risk?: HealthLevel;
  noInteraction?: boolean;
  overdue?: boolean;
  q?: string;
}

export interface PortfolioStats {
  clients: number;
  mrr: number;
  byLevel: Record<HealthLevel, number>;
  unscored: number;
  noInteraction30: number;
  overdueNext: number;
  renewals60: number;
  openUpsell: number;
  activationPending: number;
}

export interface PortfolioResult {
  scope: CsScope;
  filters: PortfolioFilters;
  rows: PortfolioRow[];
  stats: PortfolioStats;
  owners: UserLite[];
  products: { id: string; name: string }[];
}

export function parsePortfolioFilters(params: SearchParams): PortfolioFilters {
  const health = one(params, "saude");
  const risk = one(params, "risco");
  return {
    health: isLevel(health) ? health : undefined,
    risk: isLevel(risk) ? risk : undefined,
    productId: one(params, "produto"),
    noInteraction: one(params, "sem_interacao") === "1",
    overdue: one(params, "vencidas") === "1",
    q: one(params, "q")?.trim(),
  };
}

const normalize = (v: string | undefined) =>
  (v ?? "")
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase();

function buildRows(base: CsBase, scope: CsScope, now: Date): PortfolioRow[] {
  const nowIso = now.toISOString();
  const since = new Date(now.getTime() - HEALTH_WINDOW_DAYS * DAY_MS).toISOString();
  const today = dateKey(now);
  return base.clients
    .filter((c) => isPortfolioClient(c) && inScope(c, base.accounts.get(c.id), scope))
    .map((c) => {
      const account = base.accounts.get(c.id);
      const products = (base.products.get(c.id) ?? []).filter((p) => p.status !== "cancelado");
      const overdue = overdueBillings(base.billings.get(c.id) ?? [], today);
      const csat = csatAverage(base.csat.get(c.id) ?? [], since);
      const next = account?.nextInteractionAt ?? c.nextInteractionAt;
      const ownerId = account?.ownerId ?? c.ownerCsId;
      const plan = (base.plans.get(c.id) ?? []).find((p) => p.status === "ativo");
      return {
        clientId: c.id,
        tradeName: c.tradeName,
        legalName: c.legalName,
        status: c.status,
        phone: c.phone,
        whatsapp: c.whatsapp,
        mrr: c.mrr ?? 0,
        activatedAt: account?.activatedAt ?? c.activatedAt,
        healthScore: c.healthScore,
        healthLevel: c.healthLevel,
        owner: ownerId ? base.users.get(ownerId) : undefined,
        products: products.map((p) => ({ id: p.id, name: p.productName, status: p.status })),
        accountId: account?.id,
        adoptionPct: account?.adoptionPct,
        csatAvg: csat?.avg,
        csatCount: csat?.count ?? 0,
        openTickets: (base.tickets.get(c.id) ?? []).filter(isOpenTicket).length,
        overdueAmount: overdue.reduce((s, b) => s + b.amount, 0),
        overdueCount: overdue.length,
        lastInteractionAt: lastInteractionOf(c, account ?? null),
        nextInteractionAt: next,
        nextOverdue: Boolean(next && next < nowIso),
        riskLevel: account?.riskLevel,
        riskReasons: account?.riskReasons ?? [],
        openOpportunities: (base.opportunities.get(c.id) ?? []).filter((o) => OPEN_OPPORTUNITY.has(o.stage)).length,
        activePlanId: plan?.id,
        activationPending: c.currentStage === "cs",
        contacts: (base.contacts.get(c.id) ?? []).sort((a, b) => Number(b.isPrimary) - Number(a.isPrimary)),
      };
    });
}

function daysSince(iso: string | undefined, now: Date): number | null {
  if (!iso) return null;
  return Math.floor((now.getTime() - new Date(iso).getTime()) / DAY_MS);
}

function computeStats(base: CsBase, rows: PortfolioRow[], now: Date): PortfolioStats {
  const ids = new Set(rows.map((r) => r.clientId));
  const in60 = new Date(now.getTime() + 60 * DAY_MS).toISOString();
  const byLevel: Record<HealthLevel, number> = { saudavel: 0, atencao: 0, risco: 0 };
  for (const r of rows) if (r.healthLevel) byLevel[r.healthLevel] += 1;
  return {
    clients: rows.length,
    mrr: rows.reduce((s, r) => s + r.mrr, 0),
    byLevel,
    unscored: rows.filter((r) => !r.healthLevel).length,
    noInteraction30: rows.filter((r) => (daysSince(r.lastInteractionAt, now) ?? Infinity) > 30).length,
    overdueNext: rows.filter((r) => r.nextOverdue).length,
    renewals60: base.renewals.filter((r) => ids.has(r.clientId) && OPEN_RENEWAL.has(r.status) && r.dueDate <= in60).length,
    openUpsell: rows.reduce((s, r) => s + (base.opportunities.get(r.clientId) ?? []).filter((o) => OPEN_OPPORTUNITY.has(o.stage) && (o.kind === "upsell" || o.kind === "cross_sell")).length, 0),
    activationPending: rows.filter((r) => r.activationPending).length,
  };
}

function applyFilters(rows: PortfolioRow[], filters: PortfolioFilters, now: Date): PortfolioRow[] {
  let out = rows;
  if (filters.health) out = out.filter((r) => r.healthLevel === filters.health);
  if (filters.risk) out = out.filter((r) => r.riskLevel === filters.risk);
  if (filters.productId) out = out.filter((r) => r.products.some((p) => p.id === filters.productId || p.name === filters.productId));
  if (filters.noInteraction) out = out.filter((r) => (daysSince(r.lastInteractionAt, now) ?? Infinity) > 30);
  if (filters.overdue) out = out.filter((r) => r.nextOverdue);
  if (filters.q) {
    const term = normalize(filters.q);
    out = out.filter((r) => normalize(`${r.tradeName} ${r.legalName}`).includes(term));
  }
  return out;
}

/** Carteira de CS: linhas filtradas, indicadores do escopo (sem os filtros) e opções de filtro. */
export async function getPortfolio(user: CurrentUser, params: SearchParams): Promise<PortfolioResult> {
  const now = new Date();
  const scope = resolveScope(user, one(params, "responsavel"));
  const filters = parsePortfolioFilters(params);
  const base = await loadBase();
  const scoped = buildRows(base, scope, now);
  const rows = applyFilters(scoped, filters, now).sort((a, b) => {
    // Risco primeiro, depois menor score, depois nome.
    const rank = (r: PortfolioRow) => (r.healthLevel === "risco" ? 0 : r.healthLevel === "atencao" ? 1 : r.healthLevel ? 2 : 3);
    return rank(a) - rank(b) || (a.healthScore ?? 101) - (b.healthScore ?? 101) || a.tradeName.localeCompare(b.tradeName, "pt-BR");
  });
  const ownerIds = new Set(buildRows(base, { param: "todos" }, now).map((r) => r.owner?.id).filter(Boolean));
  const csUsers = Array.from(base.users.values()).filter((u) => u.departmentId === "cs" || ownerIds.has(u.id));
  const productNames = new Map<string, string>();
  for (const r of scoped) for (const p of r.products) productNames.set(p.name, p.name);
  return {
    scope,
    filters: { ...filters, ownerId: scope.ownerId },
    rows,
    stats: computeStats(base, scoped, now),
    owners: csUsers.sort(byName),
    products: Array.from(productNames.keys())
      .sort((a, b) => a.localeCompare(b, "pt-BR"))
      .map((name) => ({ id: name, name })),
  };
}

/** Linhas da carteira para um escopo e filtros (reuso por outros módulos). */
export async function listPortfolio(filters: PortfolioFilters = {}): Promise<PortfolioRow[]> {
  const now = new Date();
  const base = await loadBase();
  return applyFilters(buildRows(base, { ownerId: filters.ownerId, param: filters.ownerId ?? "todos" }, now), filters, now);
}

/** Indicadores da carteira do usuário (ou do responsável informado / "todos"). */
export async function getCsOverview(user: CurrentUser, requestedScope?: string): Promise<PortfolioStats> {
  const now = new Date();
  const base = await loadBase();
  return computeStats(base, buildRows(base, resolveScope(user, requestedScope), now), now);
}

// ---------------------------------------------------------------------------
// Saúde
// ---------------------------------------------------------------------------

export interface HealthRow {
  clientId: string;
  tradeName: string;
  owner?: UserLite;
  mrr: number;
  score?: number;
  level?: HealthLevel;
  computedAt?: string;
  previousScore?: number;
  /** Os dois fatores que mais tiram pontos. */
  weakest: { label: string; value: number }[];
}

export interface HealthOverview {
  scope: CsScope;
  rows: HealthRow[];
  distribution: Record<HealthLevel, { count: number; mrr: number }>;
  unscored: number;
  config: HealthConfig;
  lastSweep: { ranAt?: string; result?: RecalculateAllResult };
  owners: UserLite[];
}

function latestByClient(scores: HealthScore[]): Map<string, HealthScore[]> {
  const map = new Map<string, HealthScore[]>();
  for (const s of scores) {
    const arr = map.get(s.clientId) ?? [];
    arr.push(s);
    map.set(s.clientId, arr);
  }
  for (const arr of map.values()) arr.sort((a, b) => (a.computedAt < b.computedAt ? 1 : -1));
  return map;
}

export async function getHealthOverview(user: CurrentUser, params: SearchParams): Promise<HealthOverview> {
  const scope = resolveScope(user, one(params, "responsavel"));
  const levelFilter = one(params, "nivel");
  const [clients, accounts, scores, users, config, lastSweep] = await Promise.all([
    list<Client>(COLLECTIONS.clients),
    list<CsAccount>(COLLECTIONS.csAccounts),
    list<HealthScore>(COLLECTIONS.healthScores),
    listActiveUsers(),
    getHealthConfig(),
    getLastHealthSweep(),
  ]);
  const accountBy = new Map(accounts.map((a) => [a.clientId, a]));
  const userBy = new Map(users.map((u) => [u.id, u]));
  const history = latestByClient(scores);
  const distribution: HealthOverview["distribution"] = { saudavel: { count: 0, mrr: 0 }, atencao: { count: 0, mrr: 0 }, risco: { count: 0, mrr: 0 } };
  let unscored = 0;
  const rows: HealthRow[] = [];
  for (const c of clients) {
    const account = accountBy.get(c.id);
    if (!isPortfolioClient(c) || !inScope(c, account, scope)) continue;
    const [latest, previous] = history.get(c.id) ?? [];
    const level = latest?.level ?? c.healthLevel;
    if (level) {
      distribution[level].count += 1;
      distribution[level].mrr += c.mrr ?? 0;
    } else unscored += 1;
    const ownerId = account?.ownerId ?? c.ownerCsId;
    rows.push({
      clientId: c.id,
      tradeName: c.tradeName,
      owner: ownerId ? userBy.get(ownerId) : undefined,
      mrr: c.mrr ?? 0,
      score: latest?.score ?? c.healthScore,
      level,
      computedAt: latest?.computedAt,
      previousScore: previous?.score,
      weakest: latest
        ? [...latest.factors]
            .filter((f) => f.value < 75)
            .sort((a, b) => b.weight * (100 - b.value) - a.weight * (100 - a.value))
            .slice(0, 2)
            .map((f) => ({ label: f.label, value: f.value }))
        : [],
    });
  }
  const filtered = isLevel(levelFilter) ? rows.filter((r) => r.level === levelFilter) : rows;
  filtered.sort((a, b) => (a.score ?? 101) - (b.score ?? 101) || a.tradeName.localeCompare(b.tradeName, "pt-BR"));
  return { scope, rows: filtered, distribution, unscored, config, lastSweep, owners: users.filter((u) => u.departmentId === "cs") };
}

export interface HealthDetail {
  clientId: string;
  tradeName: string;
  mrr: number;
  latest: HealthScore | null;
  /** Do mais antigo para o mais recente (gráfico). */
  history: { computedAt: string; score: number; level: HealthLevel }[];
  explanation: string[];
  account: CsAccount | null;
}

export async function getHealthDetail(clientId: string): Promise<HealthDetail | null> {
  const client = await getById<Client>(COLLECTIONS.clients, clientId);
  if (!client) return null;
  const [scores, accounts] = await Promise.all([
    list<HealthScore>(COLLECTIONS.healthScores, { where: [["clientId", "==", clientId]] }),
    list<CsAccount>(COLLECTIONS.csAccounts, { where: [["clientId", "==", clientId]] }),
  ]);
  scores.sort((a, b) => (a.computedAt < b.computedAt ? 1 : -1));
  const latest = scores[0] ?? null;
  return {
    clientId,
    tradeName: client.tradeName,
    mrr: client.mrr ?? 0,
    latest,
    history: scores
      .slice(0, 12)
      .reverse()
      .map((s) => ({ computedAt: s.computedAt, score: s.score, level: s.level })),
    explanation: latest ? explainHealth(latest) : [],
    account: accounts.sort((a, b) => (a.updatedAt < b.updatedAt ? 1 : -1))[0] ?? null,
  };
}

// ---------------------------------------------------------------------------
// Checkpoints (agenda)
// ---------------------------------------------------------------------------

export interface AgendaItem {
  clientId: string;
  tradeName: string;
  owner?: UserLite;
  nextInteractionAt: string;
  lastInteractionAt?: string;
  healthScore?: number;
  healthLevel?: HealthLevel;
  adoptionPct?: number;
  overdue: boolean;
}

export interface RecentCheckpoint {
  id: string;
  clientId: string;
  tradeName: string;
  occurredAt: string;
  actorName: string;
  title: string;
  description?: string;
}

export interface CheckpointAgenda {
  scope: CsScope;
  view: "semana" | "mes";
  offset: number;
  /** Chaves AAAA-MM-DD do período exibido. */
  start: string;
  end: string;
  days: { key: string; items: AgendaItem[] }[];
  overdue: AgendaItem[];
  withoutSchedule: { clientId: string; tradeName: string; owner?: UserLite }[];
  recent: RecentCheckpoint[];
  owners: UserLite[];
}

/** Soma dias a uma chave AAAA-MM-DD (aritmética em UTC, sem fuso). */
function addDaysKey(key: string, days: number): string {
  const [y, m, d] = key.split("-").map(Number);
  return new Date(Date.UTC(y, m - 1, d + days)).toISOString().slice(0, 10);
}

function periodRange(view: "semana" | "mes", offset: number, today: string): { start: string; end: string } {
  const [y, m, d] = today.split("-").map(Number);
  if (view === "mes") {
    const first = new Date(Date.UTC(y, m - 1 + offset, 1));
    const last = new Date(Date.UTC(first.getUTCFullYear(), first.getUTCMonth() + 1, 0));
    return { start: first.toISOString().slice(0, 10), end: last.toISOString().slice(0, 10) };
  }
  // Semana de segunda a domingo.
  const weekday = new Date(Date.UTC(y, m - 1, d)).getUTCDay();
  const monday = addDaysKey(today, -((weekday + 6) % 7) + offset * 7);
  return { start: monday, end: addDaysKey(monday, 6) };
}

export async function getCheckpointAgenda(user: CurrentUser, params: SearchParams): Promise<CheckpointAgenda> {
  const scope = resolveScope(user, one(params, "responsavel"));
  const view = one(params, "visao") === "mes" ? "mes" : "semana";
  const offset = Math.max(-24, Math.min(24, Number(one(params, "ref") ?? 0) || 0));
  const now = new Date();
  const nowIso = now.toISOString();
  const today = dateKey(now);
  const { start, end } = periodRange(view, offset, today);

  const [clients, accounts, users, events] = await Promise.all([
    list<Client>(COLLECTIONS.clients),
    list<CsAccount>(COLLECTIONS.csAccounts),
    listActiveUsers(),
    list<DomainEvent>(COLLECTIONS.events, { where: [["type", "==", "customer.checkpoint.completed"]] }),
  ]);
  const accountBy = new Map(accounts.map((a) => [a.clientId, a]));
  const userBy = new Map(users.map((u) => [u.id, u]));
  const items: AgendaItem[] = [];
  const withoutSchedule: CheckpointAgenda["withoutSchedule"] = [];
  const scopedIds = new Set<string>();
  const names = new Map<string, string>();
  for (const c of clients) {
    names.set(c.id, c.tradeName);
    const account = accountBy.get(c.id);
    if (!isPortfolioClient(c) || !inScope(c, account, scope)) continue;
    scopedIds.add(c.id);
    const ownerId = account?.ownerId ?? c.ownerCsId;
    const next = account?.nextInteractionAt ?? c.nextInteractionAt;
    if (!next) {
      withoutSchedule.push({ clientId: c.id, tradeName: c.tradeName, owner: ownerId ? userBy.get(ownerId) : undefined });
      continue;
    }
    items.push({
      clientId: c.id,
      tradeName: c.tradeName,
      owner: ownerId ? userBy.get(ownerId) : undefined,
      nextInteractionAt: next,
      lastInteractionAt: lastInteractionOf(c, account ?? null),
      healthScore: c.healthScore,
      healthLevel: c.healthLevel,
      adoptionPct: account?.adoptionPct,
      overdue: next < nowIso,
    });
  }
  items.sort((a, b) => a.nextInteractionAt.localeCompare(b.nextInteractionAt));

  const days: CheckpointAgenda["days"] = [];
  for (let key = start; key <= end; key = addDaysKey(key, 1)) days.push({ key, items: [] });
  const dayIndex = new Map(days.map((d, i) => [d.key, i]));
  for (const item of items) {
    const idx = dayIndex.get(dateKey(item.nextInteractionAt));
    if (idx !== undefined) days[idx].items.push(item);
  }

  const since = new Date(now.getTime() - 30 * DAY_MS).toISOString();
  const recent = events
    .filter((e) => e.clientId && scopedIds.has(e.clientId) && e.occurredAt >= since)
    .sort((a, b) => (a.occurredAt < b.occurredAt ? 1 : -1))
    .slice(0, 20)
    .map((e) => ({ id: e.id, clientId: e.clientId!, tradeName: names.get(e.clientId!) ?? e.clientId!, occurredAt: e.occurredAt, actorName: e.actorName, title: e.title, description: e.description }));

  return { scope, view, offset, start, end, days, overdue: items.filter((i) => i.overdue), withoutSchedule, recent, owners: users.filter((u) => u.departmentId === "cs") };
}

// ---------------------------------------------------------------------------
// Planos de sucesso
// ---------------------------------------------------------------------------

export interface PlanRow {
  plan: SuccessPlanWithTasks;
  tradeName: string;
  owner?: UserLite;
  done: number;
  total: number;
  overdueActions: number;
}

export interface PlansResult {
  scope: CsScope;
  status: SuccessPlan["status"] | "todos";
  rows: PlanRow[];
  counts: Record<SuccessPlan["status"], number>;
  users: UserLite[];
  clients: { id: string; tradeName: string }[];
}

export async function listSuccessPlans(user: CurrentUser, params: SearchParams): Promise<PlansResult> {
  const scope = resolveScope(user, one(params, "responsavel"));
  const statusParam = one(params, "status");
  const status: PlansResult["status"] = statusParam === "concluido" || statusParam === "cancelado" || statusParam === "todos" ? statusParam : "ativo";
  const [plans, clients, users] = await Promise.all([list<SuccessPlan>(COLLECTIONS.successPlans), list<Client>(COLLECTIONS.clients), listActiveUsers()]);
  const clientBy = new Map(clients.map((c) => [c.id, c]));
  const userBy = new Map(users.map((u) => [u.id, u]));
  const nowIso = new Date().toISOString();
  const scoped = plans.filter((p) => !scope.ownerId || p.ownerId === scope.ownerId);
  const counts: PlansResult["counts"] = { ativo: 0, concluido: 0, cancelado: 0 };
  for (const p of scoped) counts[p.status] += 1;
  const rows = scoped
    .filter((p) => status === "todos" || p.status === status)
    .map((p) => ({
      plan: p as PlanRow["plan"],
      tradeName: clientBy.get(p.clientId)?.tradeName ?? p.clientId,
      owner: userBy.get(p.ownerId),
      done: p.actions.filter((a) => a.done).length,
      total: p.actions.length,
      overdueActions: p.actions.filter((a) => !a.done && a.dueAt < nowIso).length,
    }))
    .sort((a, b) => (a.plan.createdAt < b.plan.createdAt ? 1 : -1));
  return {
    scope,
    status,
    rows,
    counts,
    users,
    clients: clients
      .filter((c) => c.status !== "cancelado" && (isPortfolioClient(c) || c.status === "em_implantacao"))
      .map((c) => ({ id: c.id, tradeName: c.tradeName }))
      .sort((a, b) => a.tradeName.localeCompare(b.tradeName, "pt-BR")),
  };
}

export async function getSuccessPlan(id: string): Promise<SuccessPlanWithTasks | null> {
  return getById<SuccessPlan>(COLLECTIONS.successPlans, id);
}

// ---------------------------------------------------------------------------
// Renovações
// ---------------------------------------------------------------------------

export interface RenewalRow {
  id: string;
  clientId: string;
  tradeName: string;
  contractId: string;
  contractNumber: string;
  mrr: number;
  dueDate: string;
  daysLeft: number;
  healthLevel?: HealthLevel;
  healthScore?: number;
  owner?: UserLite;
  status: Renewal["status"];
  notes?: string;
  result?: string;
  windowOpen: boolean;
  updatedAt: string;
}

export interface UnscheduledRenewal {
  contractId: string;
  contractNumber: string;
  clientId: string;
  tradeName: string;
  mrr: number;
  endDate: string;
  daysLeft: number;
  healthLevel?: HealthLevel;
}

export interface RenewalsResult {
  open: RenewalRow[];
  closed: RenewalRow[];
  unscheduled: UnscheduledRenewal[];
  totals: { openCount: number; openMrr: number; in60: number; negotiating: number; renewedMrr90: number; lostMrr90: number };
}

export async function listRenewals(): Promise<RenewalsResult> {
  const [renewals, contracts, clients, users] = await Promise.all([
    list<Renewal>(COLLECTIONS.renewals),
    list<Contract>(COLLECTIONS.contracts),
    list<Client>(COLLECTIONS.clients),
    listActiveUsers(),
  ]);
  const now = new Date();
  const nowIso = now.toISOString();
  const contractBy = new Map(contracts.map((c) => [c.id, c]));
  const clientBy = new Map(clients.map((c) => [c.id, c]));
  const userBy = new Map(users.map((u) => [u.id, u]));
  const daysLeft = (iso: string) => Math.ceil((new Date(iso).getTime() - now.getTime()) / DAY_MS);

  const rows: RenewalRow[] = renewals.map((r) => {
    const contract = contractBy.get(r.contractId);
    const client = clientBy.get(r.clientId);
    return {
      id: r.id,
      clientId: r.clientId,
      tradeName: client?.tradeName ?? r.clientId,
      contractId: r.contractId,
      contractNumber: contract?.number ?? r.contractId,
      mrr: contract?.monthlyTotal ?? 0,
      dueDate: r.dueDate,
      daysLeft: daysLeft(r.dueDate),
      healthLevel: client?.healthLevel ?? r.risk,
      healthScore: client?.healthScore,
      owner: userBy.get(r.ownerId),
      status: r.status,
      notes: r.notes,
      result: r.result,
      windowOpen: r.windowOpensAt <= nowIso,
      updatedAt: r.updatedAt,
    };
  });
  const open = rows.filter((r) => OPEN_RENEWAL.has(r.status)).sort((a, b) => a.dueDate.localeCompare(b.dueDate));
  const since90 = new Date(now.getTime() - 90 * DAY_MS).toISOString();
  const closed = rows.filter((r) => !OPEN_RENEWAL.has(r.status) && r.updatedAt >= since90).sort((a, b) => (a.updatedAt < b.updatedAt ? 1 : -1));

  const openContracts = new Set(open.map((r) => r.contractId));
  const horizon = new Date(now.getTime() + RENEWAL_LOOKAHEAD_DAYS * DAY_MS).toISOString();
  const unscheduled: UnscheduledRenewal[] = contracts
    .filter((c) => c.status === "liberado" && c.endDate && c.endDate <= horizon && !openContracts.has(c.id))
    .filter((c) => !renewals.some((r) => r.contractId === c.id && r.dueDate.slice(0, 10) === c.endDate!.slice(0, 10)))
    .map((c) => {
      const client = clientBy.get(c.clientId);
      return { contractId: c.id, contractNumber: c.number, clientId: c.clientId, tradeName: client?.tradeName ?? c.clientId, mrr: c.monthlyTotal, endDate: c.endDate!, daysLeft: daysLeft(c.endDate!), healthLevel: client?.healthLevel };
    })
    .sort((a, b) => a.endDate.localeCompare(b.endDate));

  const in60 = new Date(now.getTime() + 60 * DAY_MS).toISOString();
  return {
    open,
    closed,
    unscheduled,
    totals: {
      openCount: open.length,
      openMrr: open.reduce((s, r) => s + r.mrr, 0),
      in60: open.filter((r) => r.dueDate <= in60).length,
      negotiating: open.filter((r) => r.status === "em_negociacao").length,
      renewedMrr90: closed.filter((r) => r.status === "renovado").reduce((s, r) => s + r.mrr, 0),
      lostMrr90: closed.filter((r) => r.status === "perdido").reduce((s, r) => s + r.mrr, 0),
    },
  };
}

// ---------------------------------------------------------------------------
// Riscos
// ---------------------------------------------------------------------------

export interface RiskRow extends PortfolioRow {
  activePlanObjective?: string;
}

export interface RisksResult {
  scope: CsScope;
  rows: RiskRow[];
  totals: { risk: number; attention: number; mrrRisk: number; mrrAttention: number; withoutPlan: number; overdueAmount: number };
  owners: UserLite[];
}

export async function listRisks(user: CurrentUser, params: SearchParams): Promise<RisksResult> {
  const now = new Date();
  const scope = resolveScope(user, one(params, "responsavel"));
  const base = await loadBase();
  const rows: RiskRow[] = buildRows(base, scope, now)
    .filter((r) => r.healthLevel === "risco" || r.healthLevel === "atencao")
    .map((r) => ({ ...r, activePlanObjective: r.activePlanId ? (base.plans.get(r.clientId) ?? []).find((p) => p.id === r.activePlanId)?.objective : undefined }))
    .sort((a, b) => (a.healthLevel === b.healthLevel ? (a.healthScore ?? 0) - (b.healthScore ?? 0) || b.mrr - a.mrr : a.healthLevel === "risco" ? -1 : 1));
  const risk = rows.filter((r) => r.healthLevel === "risco");
  const attention = rows.filter((r) => r.healthLevel === "atencao");
  return {
    scope,
    rows,
    totals: {
      risk: risk.length,
      attention: attention.length,
      mrrRisk: risk.reduce((s, r) => s + r.mrr, 0),
      mrrAttention: attention.reduce((s, r) => s + r.mrr, 0),
      withoutPlan: rows.filter((r) => !r.activePlanId).length,
      overdueAmount: rows.reduce((s, r) => s + r.overdueAmount, 0),
    },
    owners: Array.from(base.users.values())
      .filter((u) => u.departmentId === "cs")
      .sort(byName),
  };
}

// ---------------------------------------------------------------------------
// Upsell
// ---------------------------------------------------------------------------

export type UpsellCell = "contratado" | "em_implantacao" | "oportunidade" | "disponivel";

export interface UpsellMatrix {
  scope: CsScope;
  products: { id: string; name: string; monthlyPrice: number; setupPrice: number }[];
  rows: { clientId: string; tradeName: string; healthLevel?: HealthLevel; healthScore?: number; cells: Record<string, UpsellCell> }[];
  opportunities: {
    id: string;
    title: string;
    clientId: string;
    tradeName: string;
    kind: Opportunity["kind"];
    stage: Opportunity["stage"];
    monthlyTotal: number;
    setupTotal: number;
    owner?: UserLite;
    origin?: UserLite;
    createdAt: string;
    wonAt?: string;
  }[];
  totals: { open: number; openMrr: number; won: number; wonMrr: number; available: number };
  owners: UserLite[];
}

export async function getUpsellMatrix(user: CurrentUser, params: SearchParams): Promise<UpsellMatrix> {
  const now = new Date();
  const scope = resolveScope(user, one(params, "responsavel"));
  const base = await loadBase();
  const rows = buildRows(base, scope, now).sort((a, b) => a.tradeName.localeCompare(b.tradeName, "pt-BR"));
  let available = 0;
  const matrixRows = rows.map((r) => {
    const owned = base.products.get(r.clientId) ?? [];
    const opps = (base.opportunities.get(r.clientId) ?? []).filter((o) => OPEN_OPPORTUNITY.has(o.stage));
    const cells: Record<string, UpsellCell> = {};
    for (const p of base.catalog) {
      const cp = owned.find((x) => x.productId === p.id && x.status !== "cancelado");
      if (cp) cells[p.id] = cp.status === "em_implantacao" ? "em_implantacao" : "contratado";
      else if (opps.some((o) => o.products.some((x) => x.productId === p.id))) cells[p.id] = "oportunidade";
      else {
        cells[p.id] = "disponivel";
        available += 1;
      }
    }
    return { clientId: r.clientId, tradeName: r.tradeName, healthLevel: r.healthLevel, healthScore: r.healthScore, cells };
  });

  const scopedIds = new Set(rows.map((r) => r.clientId));
  const names = new Map(base.clients.map((c) => [c.id, c.tradeName]));
  const csOpps = Array.from(base.opportunities.values())
    .flat()
    .filter((o) => (o.kind === "upsell" || o.kind === "cross_sell") && o.originDepartment === "cs" && o.stage !== "perdido")
    .filter((o) => !scope.ownerId || scopedIds.has(o.clientId))
    .sort((a, b) => (a.createdAt < b.createdAt ? 1 : -1));
  const open = csOpps.filter((o) => OPEN_OPPORTUNITY.has(o.stage));
  const won = csOpps.filter((o) => o.stage === "ganho");
  return {
    scope,
    products: base.catalog.map((p) => ({ id: p.id, name: p.name, monthlyPrice: p.monthlyPrice, setupPrice: p.setupPrice })),
    rows: matrixRows,
    opportunities: csOpps.map((o) => ({
      id: o.id,
      title: o.title,
      clientId: o.clientId,
      tradeName: names.get(o.clientId) ?? o.clientId,
      kind: o.kind,
      stage: o.stage,
      monthlyTotal: o.monthlyTotal,
      setupTotal: o.setupTotal,
      owner: base.users.get(o.ownerId),
      origin: o.originUserId ? base.users.get(o.originUserId) : undefined,
      createdAt: o.createdAt,
      wonAt: o.wonAt,
    })),
    totals: { open: open.length, openMrr: open.reduce((s, o) => s + o.monthlyTotal, 0), won: won.length, wonMrr: won.reduce((s, o) => s + o.monthlyTotal, 0), available },
    owners: Array.from(base.users.values())
      .filter((u) => u.departmentId === "cs")
      .sort(byName),
  };
}

// ---------------------------------------------------------------------------
// Churn
// ---------------------------------------------------------------------------

export interface ChurnMonth {
  month: string;
  /** Clientes cancelados no mês / ativos no início do mês (fração). */
  rate: number | null;
  cancelledClients: number;
  activeAtStart: number;
  lostMrr: number;
  records: number;
}

export interface ChurnMetrics {
  months: ChurnMonth[];
  target: number;
  current: ChurnMonth;
  previous: ChurnMonth | null;
  status: "atingida" | "atencao" | "critico";
  byReason: { key: ChurnRecord["reasonCategory"]; count: number; lostMrr: number }[];
  byProduct: { productId: string; name: string; count: number }[];
  byOrigin: { key: string; name: string; count: number; lostMrr: number }[];
  records: { id: string; clientId: string; tradeName: string; date: string; lostMrr: number; reasonCategory: ChurnRecord["reasonCategory"]; reason: string; products: string[]; responsible?: UserLite; full: boolean }[];
  totals: { lostMrr8m: number; cancelled8m: number };
}

/** Início do mês AAAA-MM à meia-noite de São Paulo (UTC-3), em ISO. */
const monthStartIso = (ym: string) => `${ym}-01T03:00:00.000Z`;

function lastMonths(count: number, today: string): string[] {
  const [y, m] = today.split("-").map(Number);
  return Array.from({ length: count }, (_, i) => {
    const d = new Date(Date.UTC(y, m - 1 - (count - 1 - i), 1));
    return d.toISOString().slice(0, 7);
  });
}

export async function getChurnMetrics(): Promise<ChurnMetrics> {
  const [records, clients, products, sources, users, metas] = await Promise.all([
    list<ChurnRecord>(COLLECTIONS.churnRecords),
    list<Client>(COLLECTIONS.clients),
    list<Product>(COLLECTIONS.products),
    list<LeadSource>(COLLECTIONS.leadSources),
    listActiveUsers(),
    getSetting<{ churnMax?: number }>("metas_referencia", {}),
  ]);
  const clientBy = new Map(clients.map((c) => [c.id, c]));
  const productName = new Map(products.map((p) => [p.id, p.name]));
  const sourceName = new Map(sources.map((s) => [s.key, s.name]));
  const userBy = new Map(users.map((u) => [u.id, u]));
  const target = typeof metas.churnMax === "number" ? metas.churnMax : 0.03;

  // Data do cancelamento total: registro mais recente dos clientes cancelados.
  const cancelDate = new Map<string, string>();
  for (const r of records) {
    const client = clientBy.get(r.clientId);
    if (client?.status !== "cancelado") continue;
    if (!cancelDate.has(r.clientId) || r.date > cancelDate.get(r.clientId)!) cancelDate.set(r.clientId, r.date);
  }
  const fullRecord = (r: ChurnRecord) => cancelDate.get(r.clientId) === r.date;

  const today = dateKey(new Date());
  const months = lastMonths(8, today).map((ym): ChurnMonth => {
    const start = monthStartIso(ym);
    const activeAtStart = clients.filter((c) => c.activatedAt && c.activatedAt < start && !(cancelDate.has(c.id) && cancelDate.get(c.id)! < start)).length;
    const inMonth = records.filter((r) => dateKey(r.date).slice(0, 7) === ym);
    const cancelledClients = new Set(inMonth.filter(fullRecord).map((r) => r.clientId)).size;
    return {
      month: ym,
      rate: activeAtStart > 0 ? cancelledClients / activeAtStart : null,
      cancelledClients,
      activeAtStart,
      lostMrr: inMonth.reduce((s, r) => s + r.lostMrr, 0),
      records: inMonth.length,
    };
  });
  const current = months[months.length - 1];
  const previous = months[months.length - 2] ?? null;
  const rate = current.rate ?? 0;
  const status: ChurnMetrics["status"] = rate <= target ? "atingida" : rate <= target * 1.15 ? "atencao" : "critico";

  const since = monthStartIso(months[0].month);
  const window = records.filter((r) => r.date >= since);
  const reasonMap = new Map<ChurnRecord["reasonCategory"], { count: number; lostMrr: number }>();
  const productMap = new Map<string, number>();
  const originMap = new Map<string, { count: number; lostMrr: number }>();
  for (const r of window) {
    const reason = reasonMap.get(r.reasonCategory) ?? { count: 0, lostMrr: 0 };
    reason.count += 1;
    reason.lostMrr += r.lostMrr;
    reasonMap.set(r.reasonCategory, reason);
    for (const p of r.productIds) productMap.set(p, (productMap.get(p) ?? 0) + 1);
    const originKey = clientBy.get(r.clientId)?.origin ?? r.origin ?? "sem_origem";
    const origin = originMap.get(originKey) ?? { count: 0, lostMrr: 0 };
    origin.count += 1;
    origin.lostMrr += r.lostMrr;
    originMap.set(originKey, origin);
  }

  return {
    months,
    target,
    current,
    previous,
    status,
    byReason: Array.from(reasonMap.entries())
      .map(([key, v]) => ({ key, ...v }))
      .sort((a, b) => b.count - a.count),
    byProduct: Array.from(productMap.entries())
      .map(([productId, count]) => ({ productId, name: productName.get(productId) ?? productId, count }))
      .sort((a, b) => b.count - a.count),
    byOrigin: Array.from(originMap.entries())
      .map(([key, v]) => ({ key, name: key === "sem_origem" ? "Sem origem" : sourceName.get(key) ?? key, ...v }))
      .sort((a, b) => b.count - a.count),
    records: [...records]
      .sort((a, b) => (a.date < b.date ? 1 : -1))
      .slice(0, 30)
      .map((r) => ({
        id: r.id,
        clientId: r.clientId,
        tradeName: clientBy.get(r.clientId)?.tradeName ?? r.clientId,
        date: r.date,
        lostMrr: r.lostMrr,
        reasonCategory: r.reasonCategory,
        reason: r.reason,
        products: r.productIds.map((p) => productName.get(p) ?? p),
        responsible: userBy.get(r.responsibleId),
        full: fullRecord(r),
      })),
    totals: { lostMrr8m: window.reduce((s, r) => s + r.lostMrr, 0), cancelled8m: months.reduce((s, m) => s + m.cancelledClients, 0) },
  };
}

export interface ChurnFormClient {
  id: string;
  tradeName: string;
  ownerCsId?: string;
  products: { id: string; name: string; monthlyValue: number; status: ClientProduct["status"] }[];
}

/** Clientes com produtos vigentes (para o diálogo de cancelamento). */
export async function getChurnFormOptions(): Promise<{ clients: ChurnFormClient[]; users: UserLite[] }> {
  const [clients, products, users] = await Promise.all([list<Client>(COLLECTIONS.clients), list<ClientProduct>(COLLECTIONS.clientProducts), listActiveUsers()]);
  const byClient = groupBy(products.filter((p) => p.status !== "cancelado"));
  return {
    clients: clients
      .filter((c) => c.status !== "cancelado" && (byClient.get(c.id)?.length ?? 0) > 0)
      .map((c) => ({
        id: c.id,
        tradeName: c.tradeName,
        ownerCsId: c.ownerCsId,
        products: (byClient.get(c.id) ?? []).map((p) => ({ id: p.id, name: p.productName, monthlyValue: p.monthlyValue, status: p.status })),
      }))
      .sort((a, b) => a.tradeName.localeCompare(b.tradeName, "pt-BR")),
    users,
  };
}

// ---------------------------------------------------------------------------
// Ficha 360º (aba CS)
// ---------------------------------------------------------------------------

export interface ClientCs {
  account: CsAccount | null;
  health: HealthScore | null;
  history: { computedAt: string; score: number; level: HealthLevel }[];
  explanation: string[];
  plans: SuccessPlanWithTasks[];
  renewals: Renewal[];
  checkpoints: TimelineEvent[];
  activation: ActivationCheck;
  users: Record<string, UserLite>;
}

export async function getClientCs(clientId: string): Promise<ClientCs | null> {
  const client = await getById<Client>(COLLECTIONS.clients, clientId);
  if (!client) return null;
  const byClient = { where: [["clientId", "==", clientId]] as [string, "==", unknown][] };
  const [accounts, scores, plans, renewals, timeline, activation] = await Promise.all([
    list<CsAccount>(COLLECTIONS.csAccounts, byClient),
    list<HealthScore>(COLLECTIONS.healthScores, byClient),
    list<SuccessPlan>(COLLECTIONS.successPlans, byClient),
    list<Renewal>(COLLECTIONS.renewals, byClient),
    list<TimelineEvent>(COLLECTIONS.timelineEvents, byClient),
    checkActivation(clientId),
  ]);
  scores.sort((a, b) => (a.computedAt < b.computedAt ? 1 : -1));
  const account = accounts.sort((a, b) => (a.updatedAt < b.updatedAt ? 1 : -1))[0] ?? null;
  const userIds = [account?.ownerId, ...plans.flatMap((p) => [p.ownerId, ...p.actions.map((a) => a.responsibleId)]), ...renewals.map((r) => r.ownerId)].filter((id): id is string => Boolean(id));
  const userMap = await getManyByIds<User>(COLLECTIONS.users, userIds);
  const users: Record<string, UserLite> = {};
  for (const [id, u] of userMap) users[id] = toLite(u);
  return {
    account,
    health: scores[0] ?? null,
    history: scores
      .slice(0, 12)
      .reverse()
      .map((s) => ({ computedAt: s.computedAt, score: s.score, level: s.level })),
    explanation: scores[0] ? explainHealth(scores[0]) : [],
    plans: plans.sort((a, b) => (a.createdAt < b.createdAt ? 1 : -1)) as ClientCs["plans"],
    renewals: renewals.sort((a, b) => a.dueDate.localeCompare(b.dueDate)),
    checkpoints: timeline.filter((t) => t.type === "customer.checkpoint.completed").sort((a, b) => (a.occurredAt < b.occurredAt ? 1 : -1)),
    activation,
    users,
  };
}
