import "server-only";
/**
 * REGISTRO DE FÓRMULAS dos indicadores. Toda regra de cálculo de KPI mora aqui (nunca na UI).
 *
 * Cada fórmula recebe `{ period, scope, scopeId, data }` e devolve o valor, o numerador/denominador
 * (quando é uma razão) e os `sourceIds`: os registros que compõem o número, com link para a tela de
 * origem — é a base do drill-down "de onde veio este número".
 *
 * Os dados vêm de um `DataBundle`, carregado UMA vez (Promise.all das coleções, filtradas por organização
 * via list()) e cacheado em memória por 60s. Datas são filtradas em memória com `inPeriod`.
 *
 * Regra geral de escopo (cada fórmula documenta a sua atribuição em `attribution`):
 * - empresa: todos os registros;
 * - usuario: registros atribuídos ao colaborador (dono/responsável/atendente, conforme a fórmula);
 * - departamento: quando o registro tem departamento próprio (tarefa, etapa de workflow, origem da
 *   oportunidade), usa-o; senão, o departamento dono do indicador enxerga todos os registros e os demais
 *   departamentos enxergam os registros atribuídos aos seus colaboradores.
 *
 * Tipos de indicador (`kind`): "fluxo" (contagem/soma de eventos no período), "taxa" (razão ou média no
 * período) e "estado" (fotografia no fim do período; quando não dá para reconstruir o passado, a fórmula
 * devolve null fora do período corrente e o motor usa o snapshot gravado).
 */
import { list } from "@/server/db";
import {
  COLLECTIONS,
  type Billing,
  type Campaign,
  type ChurnRecord,
  type Client,
  type CollectionName,
  type Contract,
  type CsAccount,
  type CsatResponse,
  type ImplementationProject,
  type KpiDirection,
  type Lead,
  type Opportunity,
  type Renewal,
  type Settings,
  type SlaInstance,
  type SupportTicket,
  type Task,
  type User,
  type WorkflowStep,
} from "@/domain/types";
import type { DepartmentKey } from "@/domain/constants";
import { dateKey, formatCurrency } from "@/lib/format";
import { inPeriod, isCurrentPeriod, periodReference, type Period } from "./period";
import type { KpiDepartment, KpiScope, KpiUnit } from "./schemas";

// ---------------------------------------------------------------------------
// Tipos públicos
// ---------------------------------------------------------------------------

export type KpiKind = "fluxo" | "taxa" | "estado";

/** Registro que compõe o número do indicador (linha da tabela de origem no drill-down). */
export interface KpiSource {
  collection: CollectionName;
  id: string;
  label: string;
  href: string;
  /** Linha secundária (cliente, situação, motivo...). */
  detail?: string;
  /** Contribuição numérica do registro (valor em R$, dias, nota...), quando faz sentido. */
  value?: number;
  /** Data que colocou o registro no período. */
  date?: string;
  /** Colaborador a quem o registro é atribuído (base da quebra por usuário). */
  userId?: string;
  /** Para razões: o registro conta a favor (true) ou contra (false) o indicador. */
  ok?: boolean;
}

export interface FormulaResult {
  /** null = indisponível (sem base de cálculo ou sem dado de origem; nunca inventamos número). */
  value: number | null;
  numerator?: number;
  denominator?: number;
  sourceIds: KpiSource[];
  /** Explicação quando o valor é null ou tem ressalva. */
  note?: string;
}

export interface FormulaContext {
  period: Period;
  scope: KpiScope;
  scopeId?: string;
  data: DataBundle;
}

export interface KpiFormulaMeta {
  key: string;
  label: string;
  department: KpiDepartment;
  unit: KpiUnit;
  direction: KpiDirection;
  kind: KpiKind;
  /** O que o número mede e como é calculado. */
  description: string;
  /** Regra de atribuição por colaborador/departamento. */
  attribution: string;
  /** Coleção principal de origem (gravada em Kpi.source). */
  source: CollectionName;
  /** Sufixo de exibição para unidade "numero" (ex.: "min"). */
  suffix?: string;
  numeratorLabel?: string;
  denominatorLabel?: string;
  /** Unidades do numerador/denominador (padrão: número). */
  numeratorUnit?: KpiUnit;
  denominatorUnit?: KpiUnit;
  /** Como exibir `KpiSource.value` na tabela de origem (rótulo e unidade da coluna). */
  sourceValue?: { label: string; unit: KpiUnit; suffix?: string };
}

export interface KpiFormula extends KpiFormulaMeta {
  compute(ctx: FormulaContext): FormulaResult;
}

// ---------------------------------------------------------------------------
// DataBundle: carga única e cache de 60s
// ---------------------------------------------------------------------------

interface RawData {
  loadedAt: string;
  users: User[];
  userById: Map<string, User>;
  leads: Lead[];
  campaigns: Campaign[];
  opportunities: Opportunity[];
  contracts: Contract[];
  contractById: Map<string, Contract>;
  billing: Billing[];
  projects: ImplementationProject[];
  tickets: SupportTicket[];
  /** SLA vigente de cada chamado (mesma regra do módulo de Suporte). */
  ticketSla: Map<string, SlaInstance>;
  workflowSteps: WorkflowStep[];
  /** SLA das etapas de workflow por id da instância de SLA. */
  stepSla: Map<string, SlaInstance>;
  csat: CsatResponse[];
  churn: ChurnRecord[];
  renewals: Renewal[];
  csAccounts: CsAccount[];
  clients: Client[];
  clientById: Map<string, Client>;
  tasks: Task[];
  /** Data do cancelamento total do cliente (registro de churn mais recente; sem registro, a última atualização). */
  clientCancelledAt: Map<string, string>;
  opportunitySettings: { diasSemMovimentoParaParada: number };
}

export interface DataBundle extends RawData {
  period: Period;
  /** Agora (ISO) no momento da carga. */
  now: string;
}

const CACHE_TTL_MS = 60_000;
let rawCache: { at: number; promise: Promise<RawData> } | null = null;
const bundleCache = new Map<string, { at: number; promise: Promise<DataBundle> }>();

async function loadRaw(): Promise<RawData> {
  const [users, leads, campaigns, opportunities, contracts, billing, projects, tickets, slas, stepSlas, workflowSteps, csat, churn, renewals, csAccounts, clients, tasks, oppSettings] = await Promise.all([
    list<User>(COLLECTIONS.users),
    list<Lead>(COLLECTIONS.leads),
    list<Campaign>(COLLECTIONS.campaigns),
    list<Opportunity>(COLLECTIONS.opportunities),
    list<Contract>(COLLECTIONS.contracts),
    list<Billing>(COLLECTIONS.billing),
    list<ImplementationProject>(COLLECTIONS.implementationProjects),
    list<SupportTicket>(COLLECTIONS.supportTickets),
    list<SlaInstance>(COLLECTIONS.slaInstances, { where: [["entityType", "==", "chamado"]] }),
    list<SlaInstance>(COLLECTIONS.slaInstances, { where: [["entityType", "==", "workflow_step"]] }),
    list<WorkflowStep>(COLLECTIONS.workflowSteps),
    list<CsatResponse>(COLLECTIONS.csatResponses),
    list<ChurnRecord>(COLLECTIONS.churnRecords),
    list<Renewal>(COLLECTIONS.renewals),
    list<CsAccount>(COLLECTIONS.csAccounts),
    list<Client>(COLLECTIONS.clients),
    list<Task>(COLLECTIONS.tasks),
    list<Settings>(COLLECTIONS.settings, { where: [["key", "==", "oportunidade"]] }),
  ]);

  const slaById = new Map(slas.map((s) => [s.id, s]));
  const ticketSla = new Map<string, SlaInstance>();
  for (const s of [...slas].sort((a, b) => (a.startedAt < b.startedAt ? -1 : 1))) if (!s.supersededBy) ticketSla.set(s.entityId, s);
  for (const t of tickets) {
    const current = t.slaInstanceId ? slaById.get(t.slaInstanceId) : undefined;
    if (current) ticketSla.set(t.id, current);
  }

  const clientById = new Map(clients.map((c) => [c.id, c]));
  const clientCancelledAt = new Map<string, string>();
  for (const r of churn) {
    if (clientById.get(r.clientId)?.status !== "cancelado") continue;
    if (!clientCancelledAt.has(r.clientId) || r.date > clientCancelledAt.get(r.clientId)!) clientCancelledAt.set(r.clientId, r.date);
  }
  for (const c of clients) if (c.status === "cancelado" && !clientCancelledAt.has(c.id)) clientCancelledAt.set(c.id, c.updatedAt);

  const stalledDays = Number((oppSettings[0]?.value as { diasSemMovimentoParaParada?: number } | undefined)?.diasSemMovimentoParaParada);
  return {
    loadedAt: new Date().toISOString(),
    users,
    userById: new Map(users.map((u) => [u.id, u])),
    leads,
    campaigns,
    opportunities,
    contracts,
    contractById: new Map(contracts.map((c) => [c.id, c])),
    billing,
    projects,
    tickets,
    ticketSla,
    workflowSteps,
    stepSla: new Map(stepSlas.map((x) => [x.id, x])),
    csat,
    churn,
    renewals,
    csAccounts,
    clients,
    clientById,
    tasks,
    clientCancelledAt,
    opportunitySettings: { diasSemMovimentoParaParada: Number.isFinite(stalledDays) && stalledDays > 0 ? stalledDays : 7 },
  };
}

function getRaw(): Promise<RawData> {
  if (rawCache && Date.now() - rawCache.at < CACHE_TTL_MS) return rawCache.promise;
  const promise = loadRaw();
  rawCache = { at: Date.now(), promise };
  promise.catch(() => {
    if (rawCache?.promise === promise) rawCache = null;
  });
  return promise;
}

/** Dados de um período (carga única compartilhada entre períodos; cache de 60s por chave de período). */
export function loadDataBundle(period: Period): Promise<DataBundle> {
  const cached = bundleCache.get(period.key);
  if (cached && Date.now() - cached.at < CACHE_TTL_MS && rawCache && Date.now() - rawCache.at < CACHE_TTL_MS) return cached.promise;
  const promise = getRaw().then((raw) => ({ ...raw, period, now: new Date().toISOString() }));
  bundleCache.set(period.key, { at: Date.now(), promise });
  promise.catch(() => bundleCache.delete(period.key));
  return promise;
}

/**
 * Invalida o cache (chamado pelos handlers de eventos que alteram números). Os dados brutos são
 * compartilhados entre períodos, então a invalidação vale para todos; `periodKey` fica no log.
 */
export function invalidateDataBundle(periodKey?: string): void {
  void periodKey;
  rawCache = null;
  bundleCache.clear();
}

// ---------------------------------------------------------------------------
// Utilitários
// ---------------------------------------------------------------------------

const DAY_MS = 86_400_000;

interface Attribution<T> {
  user?: (item: T) => string | undefined;
  department?: (item: T) => DepartmentKey | undefined;
}

/** Filtro de escopo (regra geral descrita no topo do arquivo). */
function scopeFilter<T>(ctx: FormulaContext, own: KpiDepartment, attr: Attribution<T>): (item: T) => boolean {
  const { scope, scopeId, data } = ctx;
  if (scope === "empresa" || !scopeId) return () => true;
  if (scope === "usuario") return (item) => attr.user?.(item) === scopeId;
  const userDept = (item: T) => {
    const uid = attr.user?.(item);
    return uid ? data.userById.get(uid)?.departmentId : undefined;
  };
  if (attr.department) return (item) => (attr.department!(item) ?? userDept(item)) === scopeId;
  if (scopeId === own) return () => true;
  return (item) => userDept(item) === scopeId;
}

function ratio(numerator: number, denominator: number): number | null {
  return denominator > 0 ? numerator / denominator : null;
}

function avg(values: number[]): number | null {
  return values.length > 0 ? values.reduce((s, v) => s + v, 0) / values.length : null;
}

function sum<T>(items: T[], fn: (item: T) => number): number {
  return items.reduce((s, i) => s + (fn(i) || 0), 0);
}

function days(from: string, to: string): number {
  return (new Date(to).getTime() - new Date(from).getTime()) / DAY_MS;
}

function clientName(data: DataBundle, clientId: string | undefined): string {
  return (clientId && data.clientById.get(clientId)?.tradeName) || "Cliente removido";
}

function unavailableOutsideCurrent(ctx: FormulaContext, what: string): FormulaResult | null {
  if (isCurrentPeriod(ctx.period, new Date(ctx.data.now))) return null;
  return { value: null, sourceIds: [], note: `${what} é uma fotografia do momento atual; para períodos passados vale o snapshot gravado.` };
}

// Fontes (links de drill-down)
const src = {
  lead: (l: Lead, extra: Partial<KpiSource> = {}): KpiSource => ({ collection: COLLECTIONS.leads, id: l.id, label: l.company ? `${l.name} · ${l.company}` : l.name, href: `/marketing/leads?lead=${l.id}`, userId: l.ownerId, ...extra }),
  opportunity: (o: Opportunity, data: DataBundle, extra: Partial<KpiSource> = {}): KpiSource => ({ collection: COLLECTIONS.opportunities, id: o.id, label: o.title, href: `/vendas/oportunidades?oportunidade=${o.id}`, detail: clientName(data, o.clientId), userId: o.ownerId, ...extra }),
  contract: (c: Contract, data: DataBundle, extra: Partial<KpiSource> = {}): KpiSource => ({ collection: COLLECTIONS.contracts, id: c.id, label: `Contrato ${c.number}`, href: `/financeiro/contratos/${c.id}`, detail: clientName(data, c.clientId), userId: c.ownerId, ...extra }),
  billing: (b: Billing, data: DataBundle, extra: Partial<KpiSource> = {}): KpiSource => ({
    collection: COLLECTIONS.billing,
    id: b.id,
    label: `${BILLING_TYPE_LABEL[b.type]}${b.installment ? ` ${b.installment}` : ""} · venc. ${dateKey(b.dueDate).split("-").reverse().join("/")}`,
    href: `/financeiro/contratos/${b.contractId}`,
    detail: clientName(data, b.clientId),
    userId: data.contractById.get(b.contractId)?.ownerId,
    value: b.amount,
    ...extra,
  }),
  project: (p: ImplementationProject, data: DataBundle, extra: Partial<KpiSource> = {}): KpiSource => ({ collection: COLLECTIONS.implementationProjects, id: p.id, label: p.name, href: `/implantacao/${p.id}`, detail: clientName(data, p.clientId), userId: p.ownerId, ...extra }),
  ticket: (t: SupportTicket, data: DataBundle, extra: Partial<KpiSource> = {}): KpiSource => ({ collection: COLLECTIONS.supportTickets, id: t.id, label: `${t.number} · ${t.subject}`, href: `/suporte/chamados/${t.id}`, detail: clientName(data, t.clientId), userId: t.assigneeId, ...extra }),
  client: (c: Client, extra: Partial<KpiSource> = {}): KpiSource => ({ collection: COLLECTIONS.clients, id: c.id, label: c.tradeName, href: `/clientes/${c.id}?aba=cs`, userId: c.ownerCsId, ...extra }),
  task: (t: Task, extra: Partial<KpiSource> = {}): KpiSource => ({ collection: COLLECTIONS.tasks, id: t.id, label: t.title, href: `/tarefas?tarefa=${t.id}`, detail: t.clientName, userId: t.assigneeId, ...extra }),
  step: (s: WorkflowStep, extra: Partial<KpiSource> = {}): KpiSource => ({ collection: COLLECTIONS.workflowSteps, id: s.id, label: `${s.stageName} · ${s.clientName}`, href: `/workflow?etapa=${s.id}`, userId: s.assigneeId, ...extra }),
};

const BILLING_TYPE_LABEL: Record<Billing["type"], string> = { setup: "Adesão", mensalidade: "Mensalidade", hardware: "Hardware", servico: "Serviço" };

// ---------------------------------------------------------------------------
// Blocos reutilizados por várias fórmulas
// ---------------------------------------------------------------------------

const salesAttr: Attribution<Opportunity> = { user: (o) => o.ownerId };

function wonInPeriod(ctx: FormulaContext): Opportunity[] {
  const inScope = scopeFilter(ctx, "vendas", salesAttr);
  return ctx.data.opportunities.filter((o) => o.stage === "ganho" && inPeriod(o.wonAt, ctx.period) && inScope(o));
}

function soldSum(ctx: FormulaContext, amount: (o: Opportunity) => number): FormulaResult {
  const won = wonInPeriod(ctx);
  const sourceIds = won.map((o) => src.opportunity(o, ctx.data, { value: amount(o), date: o.wonAt }));
  return { value: sum(won, amount), sourceIds };
}

function isOpenStage(stage: Opportunity["stage"]): boolean {
  return stage !== "ganho" && stage !== "perdido";
}

/** Data em que o contrato deixou de compor o MRR (mesma regra da Recorrência do Financeiro). */
function contractEndOfMrr(c: Contract, data: DataBundle): string | undefined {
  if (c.status !== "cancelado") return undefined;
  const churnDate = data.churn
    .filter((r) => r.clientId === c.clientId && r.date >= (c.releasedAt ?? ""))
    .map((r) => r.date)
    .sort()[0];
  return churnDate ?? c.updatedAt;
}

/** Vendedor dono do contrato (oportunidade de origem); sem oportunidade, o responsável financeiro. */
function contractSeller(c: Contract, data: DataBundle): string | undefined {
  return (c.opportunityId && data.opportunities.find((o) => o.id === c.opportunityId)?.ownerId) || c.ownerId;
}

function mrrContracts(ctx: FormulaContext, at: string): Contract[] {
  const inScope = scopeFilter(ctx, "financeiro", { user: (c: Contract) => contractSeller(c, ctx.data) });
  return ctx.data.contracts.filter((c) => {
    if (!c.releasedAt || c.releasedAt > at) return false;
    const end = contractEndOfMrr(c, ctx.data);
    return !(end && end <= at) && inScope(c);
  });
}

function billingAttr(data: DataBundle): Attribution<Billing> {
  return { user: (b) => data.contractById.get(b.contractId)?.ownerId };
}

/** Cobrança em aberto (não paga até `at`) e vencida antes de `at`. */
function overdueAt(b: Billing, at: string): boolean {
  if (b.status === "cancelada") return false;
  const paid = b.paidAt && b.paidAt <= at;
  return !paid && dateKey(b.dueDate) < dateKey(at);
}

const projectAttr: Attribution<ImplementationProject> = { user: (p) => p.ownerId };

function concludedInPeriod(ctx: FormulaContext): ImplementationProject[] {
  const inScope = scopeFilter(ctx, "implantacao", projectAttr);
  return ctx.data.projects.filter((p) => p.status === "concluida" && inPeriod(p.goLiveAt, ctx.period) && inScope(p));
}

function ticketsAfterGoLive(p: ImplementationProject, data: DataBundle): SupportTicket[] {
  if (!p.goLiveAt) return [];
  const end = new Date(new Date(p.goLiveAt).getTime() + 30 * DAY_MS).toISOString();
  return data.tickets.filter((t) => t.clientId === p.clientId && t.openedAt >= p.goLiveAt! && t.openedAt <= end);
}

function postGoLiveTickets(ctx: FormulaContext): FormulaResult {
  const projects = concludedInPeriod(ctx);
  const sourceIds: KpiSource[] = [];
  let total = 0;
  for (const p of projects) {
    const tickets = ticketsAfterGoLive(p, ctx.data);
    total += tickets.length;
    sourceIds.push(src.project(p, ctx.data, { value: tickets.length, date: p.goLiveAt, detail: `${clientName(ctx.data, p.clientId)} · ${tickets.length} chamado(s) em 30 dias` }));
    for (const t of tickets) sourceIds.push(src.ticket(t, ctx.data, { date: t.openedAt, userId: p.ownerId, detail: `Após go-live de ${p.name}` }));
  }
  return { value: ratio(total, projects.length), numerator: total, denominator: projects.length, sourceIds };
}

const ticketAttr: Attribution<SupportTicket> = { user: (t) => t.assigneeId };
const OPEN_TICKET = new Set<SupportTicket["status"]>(["aberto", "em_atendimento", "aguardando_cliente", "reaberto"]);

/** Avaliação de SLA no período (mesma regra do relatório de SLA do Suporte, generalizada para qualquer período). */
function evaluateSla(t: SupportTicket, sla: SlaInstance | undefined, period: Period, nowIso: string): { response?: boolean; resolution?: boolean } {
  const out: { response?: boolean; resolution?: boolean } = {};
  if (!sla) return out;
  if (sla.responseDueAt) {
    if (t.firstResponseAt && inPeriod(t.firstResponseAt, period)) out.response = t.firstResponseAt <= sla.responseDueAt;
    else if (!t.firstResponseAt && sla.responseDueAt < nowIso && inPeriod(sla.responseDueAt, period)) out.response = false;
  }
  if (t.resolvedAt && inPeriod(t.resolvedAt, period)) out.resolution = t.resolvedAt <= sla.dueAt;
  else if (!t.resolvedAt && OPEN_TICKET.has(t.status) && sla.status !== "pausado" && sla.dueAt < nowIso && inPeriod(sla.dueAt, period)) out.resolution = false;
  return out;
}

function slaCompliance(ctx: FormulaContext, kind: "response" | "resolution"): FormulaResult {
  const inScope = scopeFilter(ctx, "suporte", ticketAttr);
  const sourceIds: KpiSource[] = [];
  let met = 0;
  for (const t of ctx.data.tickets.filter(inScope)) {
    const sla = ctx.data.ticketSla.get(t.id);
    const e = evaluateSla(t, sla, ctx.period, ctx.data.now)[kind];
    if (e === undefined) continue;
    if (e) met += 1;
    const at = kind === "response" ? (t.firstResponseAt ?? sla?.responseDueAt) : (t.resolvedAt ?? sla?.dueAt);
    sourceIds.push(src.ticket(t, ctx.data, { ok: e, date: at, detail: `${clientName(ctx.data, t.clientId)} · ${e ? "dentro do SLA" : "fora do SLA"}` }));
  }
  return { value: ratio(met, sourceIds.length), numerator: met, denominator: sourceIds.length, sourceIds };
}

const clientCsAttr: Attribution<Client> = { user: (c) => c.ownerCsId };

function activeClientsAt(ctx: FormulaContext, at: string): Client[] {
  const inScope = scopeFilter(ctx, "cs", clientCsAttr);
  return ctx.data.clients.filter((c) => c.activatedAt && c.activatedAt <= at && !(ctx.data.clientCancelledAt.get(c.id) && ctx.data.clientCancelledAt.get(c.id)! <= at) && inScope(c));
}

/** Clientes com cancelamento total no período (registro de churn que zerou o cliente). */
function cancelledInPeriod(ctx: FormulaContext): Client[] {
  const inScope = scopeFilter(ctx, "cs", clientCsAttr);
  return ctx.data.clients.filter((c) => inPeriod(ctx.data.clientCancelledAt.get(c.id), ctx.period) && inScope(c));
}

const taskAttr: Attribution<Task> = { user: (t) => t.assigneeId, department: (t) => t.departmentId };

function completedTasks(ctx: FormulaContext, own: KpiDepartment): Task[] {
  const inScope = scopeFilter(ctx, own, taskAttr);
  return ctx.data.tasks.filter((t) => t.status === "concluida" && inPeriod(t.completedAt, ctx.period) && inScope(t));
}

// ---------------------------------------------------------------------------
// Registro
// ---------------------------------------------------------------------------

const LIST: KpiFormula[] = [
  // ----------------------------------------------------------------- Marketing
  {
    key: "leads_captados",
    label: "Leads captados",
    department: "marketing",
    unit: "numero",
    direction: "maior_melhor",
    kind: "fluxo",
    source: COLLECTIONS.leads,
    description: "Leads criados no período (data de criação), de qualquer origem.",
    attribution: "Responsável atual do lead (ownerId).",
    compute(ctx) {
      const inScope = scopeFilter(ctx, "marketing", { user: (l: Lead) => l.ownerId });
      const leads = ctx.data.leads.filter((l) => inPeriod(l.createdAt, ctx.period) && inScope(l));
      return { value: leads.length, sourceIds: leads.map((l) => src.lead(l, { date: l.createdAt, detail: l.origin })) };
    },
  },
  {
    key: "mqls",
    label: "MQLs (leads qualificados)",
    department: "marketing",
    unit: "numero",
    direction: "maior_melhor",
    kind: "fluxo",
    source: COLLECTIONS.leads,
    description: "Leads que passaram no gate de MQL no período (data de qualificação).",
    attribution: "Responsável atual do lead (ownerId).",
    compute(ctx) {
      const inScope = scopeFilter(ctx, "marketing", { user: (l: Lead) => l.ownerId });
      const leads = ctx.data.leads.filter((l) => inPeriod(l.qualifiedAt, ctx.period) && inScope(l));
      return { value: leads.length, sourceIds: leads.map((l) => src.lead(l, { date: l.qualifiedAt })) };
    },
  },
  {
    key: "desqualificados",
    label: "Leads desqualificados",
    department: "marketing",
    unit: "numero",
    direction: "menor_melhor",
    kind: "fluxo",
    source: COLLECTIONS.leads,
    description: "Leads captados no período que estão desqualificados.",
    attribution: "Responsável atual do lead (ownerId).",
    compute(ctx) {
      const inScope = scopeFilter(ctx, "marketing", { user: (l: Lead) => l.ownerId });
      const leads = ctx.data.leads.filter((l) => l.status === "desqualificado" && inPeriod(l.createdAt, ctx.period) && inScope(l));
      return { value: leads.length, sourceIds: leads.map((l) => src.lead(l, { date: l.createdAt, detail: l.disqualificationReason })) };
    },
  },
  {
    key: "cpl",
    label: "Custo por lead (CPL)",
    department: "marketing",
    unit: "moeda",
    direction: "menor_melhor",
    kind: "taxa",
    source: COLLECTIONS.campaigns,
    numeratorLabel: "Investimento no período",
    denominatorLabel: "Leads captados",
    numeratorUnit: "moeda",
    description:
      "Investimento em campanhas no período ÷ leads captados no período. O investimento é proporcional: gasto da campanha × fração dos seus dias ativos que cai no período (mesma regra da Visão Geral do Marketing).",
    attribution: "Colaborador: campanhas das quais é dono e os leads captados por elas. Departamento: campanhas de donos do departamento (Marketing vê todas).",
    compute(ctx) {
      const { data, period, scope, scopeId } = ctx;
      const today = dateKey(data.now);
      const startKey = dateKey(period.start);
      const endKey = dateKey(new Date(Date.parse(period.end) - 1).toISOString());
      const campaignInScope = scopeFilter(ctx, "marketing", { user: (c: Campaign) => c.ownerId });
      const campaigns = data.campaigns.filter(campaignInScope);
      const campaignIds = new Set(campaigns.map((c) => c.id));
      const leads = data.leads.filter((l) => inPeriod(l.createdAt, period) && (scope === "empresa" || (scope === "departamento" && scopeId === "marketing") || (l.campaignId !== undefined && campaignIds.has(l.campaignId))));
      const sourceIds: KpiSource[] = [];
      let investment = 0;
      for (const c of campaigns) {
        const spent = campaignSpend(c, startKey, endKey, today);
        if (spent <= 0) continue;
        investment += spent;
        sourceIds.push({ collection: COLLECTIONS.campaigns, id: c.id, label: c.name, href: `/marketing/campanhas?campanha=${c.id}`, detail: "Investimento proporcional no período", value: spent, userId: c.ownerId });
      }
      for (const l of leads) sourceIds.push(src.lead(l, { date: l.createdAt, detail: "Lead captado" }));
      if (leads.length === 0 || investment <= 0) return { value: null, numerator: investment, denominator: leads.length, sourceIds, note: leads.length === 0 ? "Sem leads captados no período." : "Sem investimento registrado no período." };
      return { value: investment / leads.length, numerator: investment, denominator: leads.length, sourceIds };
    },
  },
  {
    key: "conversao_mql",
    label: "Conversão lead → MQL",
    department: "marketing",
    unit: "percentual",
    direction: "maior_melhor",
    kind: "taxa",
    source: COLLECTIONS.leads,
    numeratorLabel: "Leads do período já qualificados",
    denominatorLabel: "Leads captados",
    description: "Dos leads captados no período, a fração que já foi qualificada (MQL).",
    attribution: "Responsável atual do lead (ownerId).",
    compute(ctx) {
      const inScope = scopeFilter(ctx, "marketing", { user: (l: Lead) => l.ownerId });
      const captured = ctx.data.leads.filter((l) => inPeriod(l.createdAt, ctx.period) && inScope(l));
      const qualified = captured.filter((l) => Boolean(l.qualifiedAt));
      return { value: ratio(qualified.length, captured.length), numerator: qualified.length, denominator: captured.length, sourceIds: captured.map((l) => src.lead(l, { date: l.createdAt, ok: Boolean(l.qualifiedAt), detail: l.qualifiedAt ? "Qualificado" : "Não qualificado" })) };
    },
  },
  {
    key: "conversao_mql_oportunidade",
    label: "Conversão MQL → oportunidade",
    department: "marketing",
    unit: "percentual",
    direction: "maior_melhor",
    kind: "taxa",
    source: COLLECTIONS.leads,
    numeratorLabel: "MQLs com oportunidade",
    denominatorLabel: "MQLs do período",
    description: "Dos leads qualificados no período, a fração que já virou oportunidade de vendas.",
    attribution: "Responsável atual do lead (ownerId).",
    compute(ctx) {
      const inScope = scopeFilter(ctx, "marketing", { user: (l: Lead) => l.ownerId });
      const mqls = ctx.data.leads.filter((l) => inPeriod(l.qualifiedAt, ctx.period) && inScope(l));
      const withOpp = mqls.filter((l) => Boolean(l.opportunityId));
      return { value: ratio(withOpp.length, mqls.length), numerator: withOpp.length, denominator: mqls.length, sourceIds: mqls.map((l) => src.lead(l, { date: l.qualifiedAt, ok: Boolean(l.opportunityId), detail: l.opportunityId ? "Com oportunidade" : "Sem oportunidade" })) };
    },
  },

  // -------------------------------------------------------------------- Vendas
  {
    key: "novas_vendas",
    label: "Novas vendas",
    department: "vendas",
    unit: "numero",
    direction: "maior_melhor",
    kind: "fluxo",
    source: COLLECTIONS.opportunities,
    description: "Oportunidades ganhas no período (data do ganho), de qualquer tipo (nova venda, upsell, cross-sell).",
    attribution: "Vendedor dono da oportunidade (ownerId).",
    compute(ctx) {
      const won = wonInPeriod(ctx);
      return { value: won.length, sourceIds: won.map((o) => src.opportunity(o, ctx.data, { date: o.wonAt, value: o.setupTotal + o.monthlyTotal + o.hardwareTotal })) };
    },
  },
  {
    key: "receita_vendida",
    label: "Receita vendida",
    department: "vendas",
    unit: "moeda",
    direction: "maior_melhor",
    kind: "fluxo",
    source: COLLECTIONS.opportunities,
    description: "Soma de adesão + 1 mensalidade + hardware das oportunidades ganhas no período.",
    attribution: "Vendedor dono da oportunidade (ownerId).",
    compute: (ctx) => soldSum(ctx, (o) => o.setupTotal + o.monthlyTotal + o.hardwareTotal),
  },
  {
    key: "mrr_vendido",
    label: "MRR vendido",
    department: "vendas",
    unit: "moeda",
    direction: "maior_melhor",
    kind: "fluxo",
    source: COLLECTIONS.opportunities,
    description: "Soma das mensalidades das oportunidades ganhas no período (receita recorrente nova).",
    attribution: "Vendedor dono da oportunidade (ownerId).",
    compute: (ctx) => soldSum(ctx, (o) => o.monthlyTotal),
  },
  {
    key: "setup_vendido",
    label: "Adesão/setup vendido",
    department: "vendas",
    unit: "moeda",
    direction: "maior_melhor",
    kind: "fluxo",
    source: COLLECTIONS.opportunities,
    description: "Soma das adesões (setup) das oportunidades ganhas no período. Base da meta de adesão do comissionamento.",
    attribution: "Vendedor dono da oportunidade (ownerId).",
    compute: (ctx) => soldSum(ctx, (o) => o.setupTotal),
  },
  {
    key: "recorrencia_vendida",
    label: "Recorrência vendida",
    department: "vendas",
    unit: "moeda",
    direction: "maior_melhor",
    kind: "fluxo",
    source: COLLECTIONS.opportunities,
    description: "Soma das mensalidades vendidas no período (mesmo valor do MRR vendido). Base da meta de recorrência do comissionamento.",
    attribution: "Vendedor dono da oportunidade (ownerId).",
    compute: (ctx) => soldSum(ctx, (o) => o.monthlyTotal),
  },
  {
    key: "hardware_vendido",
    label: "Hardware vendido",
    department: "vendas",
    unit: "moeda",
    direction: "maior_melhor",
    kind: "fluxo",
    source: COLLECTIONS.opportunities,
    description: "Soma do hardware das oportunidades ganhas no período. Base da meta de hardware do comissionamento.",
    attribution: "Vendedor dono da oportunidade (ownerId).",
    compute: (ctx) => soldSum(ctx, (o) => o.hardwareTotal),
  },
  {
    key: "conversao_funil",
    label: "Conversão do funil",
    department: "vendas",
    unit: "percentual",
    direction: "maior_melhor",
    kind: "taxa",
    source: COLLECTIONS.opportunities,
    numeratorLabel: "Ganhas no período",
    denominatorLabel: "Criadas no período",
    description: "Oportunidades ganhas no período ÷ oportunidades criadas no período (mesma regra da Central de Vendas).",
    attribution: "Vendedor dono da oportunidade (ownerId).",
    compute(ctx) {
      const inScope = scopeFilter(ctx, "vendas", salesAttr);
      const created = ctx.data.opportunities.filter((o) => inPeriod(o.createdAt, ctx.period) && inScope(o));
      const won = wonInPeriod(ctx);
      const sourceIds = [
        ...won.map((o) => src.opportunity(o, ctx.data, { date: o.wonAt, ok: true, detail: `${clientName(ctx.data, o.clientId)} · ganha` })),
        ...created.filter((o) => !won.includes(o)).map((o) => src.opportunity(o, ctx.data, { date: o.createdAt, detail: `${clientName(ctx.data, o.clientId)} · criada (${o.stage})` })),
      ];
      return { value: ratio(won.length, created.length), numerator: won.length, denominator: created.length, sourceIds };
    },
  },
  {
    key: "ticket_medio",
    label: "Ticket médio",
    department: "vendas",
    unit: "moeda",
    direction: "maior_melhor",
    kind: "taxa",
    source: COLLECTIONS.opportunities,
    numeratorLabel: "Mensalidades ganhas",
    denominatorLabel: "Vendas ganhas",
    numeratorUnit: "moeda",
    description: "Mensalidade média das oportunidades ganhas no período.",
    attribution: "Vendedor dono da oportunidade (ownerId).",
    compute(ctx) {
      const won = wonInPeriod(ctx);
      const monthly = sum(won, (o) => o.monthlyTotal);
      return { value: ratio(monthly, won.length), numerator: monthly, denominator: won.length, sourceIds: won.map((o) => src.opportunity(o, ctx.data, { date: o.wonAt, value: o.monthlyTotal })) };
    },
  },
  {
    key: "ciclo_vendas_dias",
    label: "Ciclo de vendas",
    department: "vendas",
    unit: "dias",
    direction: "menor_melhor",
    kind: "taxa",
    source: COLLECTIONS.opportunities,
    description: "Média de dias entre a criação e o ganho das oportunidades ganhas no período.",
    attribution: "Vendedor dono da oportunidade (ownerId).",
    compute(ctx) {
      const won = wonInPeriod(ctx);
      const cycles = won.map((o) => days(o.createdAt, o.wonAt!));
      return { value: avg(cycles), numerator: sum(cycles, (c) => c), denominator: won.length, sourceIds: won.map((o, i) => src.opportunity(o, ctx.data, { date: o.wonAt, value: cycles[i] })) };
    },
  },
  {
    key: "followups_atrasados",
    label: "Follow-ups atrasados",
    department: "vendas",
    unit: "numero",
    direction: "menor_melhor",
    kind: "estado",
    source: COLLECTIONS.opportunities,
    description: "Oportunidades abertas com a próxima ação vencida agora (fotografia atual).",
    attribution: "Vendedor dono da oportunidade (ownerId).",
    compute(ctx) {
      const unavailable = unavailableOutsideCurrent(ctx, "Follow-ups atrasados");
      if (unavailable) return unavailable;
      const inScope = scopeFilter(ctx, "vendas", salesAttr);
      const late = ctx.data.opportunities.filter((o) => isOpenStage(o.stage) && o.nextActionAt && o.nextActionAt < ctx.data.now && inScope(o));
      return { value: late.length, sourceIds: late.map((o) => src.opportunity(o, ctx.data, { date: o.nextActionAt, detail: `${clientName(ctx.data, o.clientId)} · ${o.nextAction ?? "próxima ação"}` })) };
    },
  },
  {
    key: "oportunidades_paradas",
    label: "Oportunidades paradas",
    department: "vendas",
    unit: "numero",
    direction: "menor_melhor",
    kind: "estado",
    source: COLLECTIONS.opportunities,
    description: "Oportunidades abertas sem atividade há mais dias que o limite configurado (settings/oportunidade, padrão 7) — fotografia atual.",
    attribution: "Vendedor dono da oportunidade (ownerId).",
    compute(ctx) {
      const unavailable = unavailableOutsideCurrent(ctx, "Oportunidades paradas");
      if (unavailable) return unavailable;
      const inScope = scopeFilter(ctx, "vendas", salesAttr);
      const limit = ctx.data.opportunitySettings.diasSemMovimentoParaParada;
      const stalled = ctx.data.opportunities.filter((o) => isOpenStage(o.stage) && Math.floor(days(o.lastActivityAt, ctx.data.now)) > limit && inScope(o));
      return { value: stalled.length, sourceIds: stalled.map((o) => src.opportunity(o, ctx.data, { date: o.lastActivityAt, value: Math.floor(days(o.lastActivityAt, ctx.data.now)), detail: `${clientName(ctx.data, o.clientId)} · sem atividade` })) };
    },
  },

  // ---------------------------------------------------------------- Financeiro
  {
    key: "faturamento",
    label: "Faturamento",
    department: "financeiro",
    unit: "moeda",
    direction: "maior_melhor",
    kind: "fluxo",
    source: COLLECTIONS.billing,
    description: "Soma das cobranças (não canceladas) com vencimento no período.",
    attribution: "Responsável financeiro do contrato da cobrança (contract.ownerId).",
    compute(ctx) {
      const inScope = scopeFilter(ctx, "financeiro", billingAttr(ctx.data));
      const items = ctx.data.billing.filter((b) => b.status !== "cancelada" && inPeriod(b.dueDate, ctx.period) && inScope(b));
      return { value: sum(items, (b) => b.amount), sourceIds: items.map((b) => src.billing(b, ctx.data, { date: b.dueDate })) };
    },
  },
  {
    key: "recebido",
    label: "Recebido",
    department: "financeiro",
    unit: "moeda",
    direction: "maior_melhor",
    kind: "fluxo",
    source: COLLECTIONS.billing,
    description: "Soma dos pagamentos recebidos no período (data do pagamento; valor pago ou, na falta, o valor da cobrança).",
    attribution: "Responsável financeiro do contrato da cobrança (contract.ownerId).",
    compute(ctx) {
      const inScope = scopeFilter(ctx, "financeiro", billingAttr(ctx.data));
      const items = ctx.data.billing.filter((b) => b.status === "paga" && inPeriod(b.paidAt, ctx.period) && inScope(b));
      return { value: sum(items, (b) => b.paidAmount ?? b.amount), sourceIds: items.map((b) => src.billing(b, ctx.data, { date: b.paidAt, value: b.paidAmount ?? b.amount })) };
    },
  },
  {
    key: "inadimplencia",
    label: "Inadimplência",
    department: "financeiro",
    unit: "percentual",
    direction: "menor_melhor",
    kind: "taxa",
    source: COLLECTIONS.billing,
    numeratorLabel: "Vencido em aberto",
    denominatorLabel: "Faturado no período",
    numeratorUnit: "moeda",
    denominatorUnit: "moeda",
    description: "Das cobranças com vencimento no período, o valor vencido e não pago até o fim do período (ou até agora) ÷ o valor faturado.",
    attribution: "Responsável financeiro do contrato da cobrança (contract.ownerId).",
    compute(ctx) {
      const inScope = scopeFilter(ctx, "financeiro", billingAttr(ctx.data));
      const at = periodReference(ctx.period, new Date(ctx.data.now));
      const billed = ctx.data.billing.filter((b) => b.status !== "cancelada" && inPeriod(b.dueDate, ctx.period) && inScope(b));
      const overdue = billed.filter((b) => overdueAt(b, at));
      const overdueAmount = sum(overdue, (b) => b.amount);
      const billedAmount = sum(billed, (b) => b.amount);
      return {
        value: ratio(overdueAmount, billedAmount),
        numerator: overdueAmount,
        denominator: billedAmount,
        sourceIds: billed.map((b) => src.billing(b, ctx.data, { date: b.dueDate, ok: !overdueAt(b, at), detail: `${clientName(ctx.data, b.clientId)} · ${overdueAt(b, at) ? "vencida" : b.paidAt && b.paidAt <= at ? "paga" : "a vencer"}` })),
      };
    },
  },
  {
    key: "contas_receber",
    label: "Contas a receber",
    department: "financeiro",
    unit: "moeda",
    direction: "faixa",
    kind: "estado",
    source: COLLECTIONS.billing,
    description: "Valor em aberto ainda a vencer no fim do período (ou agora): cobranças emitidas, não pagas e com vencimento a partir da data de referência.",
    attribution: "Responsável financeiro do contrato da cobrança (contract.ownerId).",
    compute(ctx) {
      const inScope = scopeFilter(ctx, "financeiro", billingAttr(ctx.data));
      const at = periodReference(ctx.period, new Date(ctx.data.now));
      const items = ctx.data.billing.filter((b) => b.status !== "cancelada" && b.createdAt <= at && !(b.paidAt && b.paidAt <= at) && dateKey(b.dueDate) >= dateKey(at) && inScope(b));
      return { value: sum(items, (b) => b.amount), sourceIds: items.map((b) => src.billing(b, ctx.data, { date: b.dueDate })) };
    },
  },
  {
    key: "mrr",
    label: "MRR",
    department: "financeiro",
    unit: "moeda",
    direction: "maior_melhor",
    kind: "estado",
    source: COLLECTIONS.contracts,
    description: "Receita recorrente mensal no fim do período: mensalidades dos contratos liberados e ainda não cancelados na data de referência (mesma regra da Recorrência do Financeiro).",
    attribution: "Vendedor da oportunidade de origem do contrato (sem oportunidade, o responsável do contrato).",
    compute(ctx) {
      const at = periodReference(ctx.period, new Date(ctx.data.now));
      const contracts = mrrContracts(ctx, at);
      return { value: sum(contracts, (c) => c.monthlyTotal), sourceIds: contracts.map((c) => src.contract(c, ctx.data, { value: c.monthlyTotal, date: c.releasedAt, userId: contractSeller(c, ctx.data) })) };
    },
  },
  {
    key: "crescimento_mrr",
    label: "Crescimento do MRR",
    department: "financeiro",
    unit: "percentual",
    direction: "maior_melhor",
    kind: "taxa",
    source: COLLECTIONS.contracts,
    numeratorLabel: "Variação do MRR",
    denominatorLabel: "MRR no início do período",
    numeratorUnit: "moeda",
    denominatorUnit: "moeda",
    description: "(MRR no fim do período − MRR no início) ÷ MRR no início.",
    attribution: "Mesma do MRR.",
    compute(ctx) {
      const at = periodReference(ctx.period, new Date(ctx.data.now));
      const endContracts = mrrContracts(ctx, at);
      const startContracts = mrrContracts(ctx, ctx.period.start);
      const endMrr = sum(endContracts, (c) => c.monthlyTotal);
      const startMrr = sum(startContracts, (c) => c.monthlyTotal);
      const startIds = new Set(startContracts.map((c) => c.id));
      const endIds = new Set(endContracts.map((c) => c.id));
      const sourceIds = [
        ...endContracts.filter((c) => !startIds.has(c.id)).map((c) => src.contract(c, ctx.data, { value: c.monthlyTotal, date: c.releasedAt, ok: true, detail: `${clientName(ctx.data, c.clientId)} · novo MRR` })),
        ...startContracts.filter((c) => !endIds.has(c.id)).map((c) => src.contract(c, ctx.data, { value: -c.monthlyTotal, date: contractEndOfMrr(c, ctx.data), ok: false, detail: `${clientName(ctx.data, c.clientId)} · MRR perdido` })),
      ];
      return { value: ratio(endMrr - startMrr, startMrr), numerator: endMrr - startMrr, denominator: startMrr, sourceIds };
    },
  },
  {
    key: "contratos_assinados",
    label: "Contratos assinados",
    department: "financeiro",
    unit: "numero",
    direction: "maior_melhor",
    kind: "fluxo",
    source: COLLECTIONS.contracts,
    description: "Contratos com assinatura concluída no período.",
    attribution: "Responsável financeiro do contrato (ownerId).",
    compute(ctx) {
      const inScope = scopeFilter(ctx, "financeiro", { user: (c: Contract) => c.ownerId });
      const items = ctx.data.contracts.filter((c) => inPeriod(c.signedAt, ctx.period) && inScope(c));
      return { value: items.length, sourceIds: items.map((c) => src.contract(c, ctx.data, { date: c.signedAt, value: c.monthlyTotal })) };
    },
  },
  {
    key: "tempo_liberacao_dias",
    label: "Tempo de liberação",
    department: "financeiro",
    unit: "dias",
    direction: "menor_melhor",
    kind: "taxa",
    source: COLLECTIONS.contracts,
    description: "Média de dias entre a assinatura e a liberação financeira dos contratos liberados no período.",
    attribution: "Responsável financeiro do contrato (ownerId).",
    compute(ctx) {
      const inScope = scopeFilter(ctx, "financeiro", { user: (c: Contract) => c.ownerId });
      const items = ctx.data.contracts.filter((c) => c.signedAt && inPeriod(c.releasedAt, ctx.period) && inScope(c));
      const values = items.map((c) => Math.max(0, days(c.signedAt!, c.releasedAt!)));
      return { value: avg(values), numerator: sum(values, (v) => v), denominator: items.length, sourceIds: items.map((c, i) => src.contract(c, ctx.data, { date: c.releasedAt, value: values[i] })) };
    },
  },

  // --------------------------------------------------------------- Implantação
  {
    key: "implantacoes_concluidas",
    label: "Implantações concluídas",
    department: "implantacao",
    unit: "numero",
    direction: "maior_melhor",
    kind: "fluxo",
    source: COLLECTIONS.implementationProjects,
    description: "Projetos com go-live no período.",
    attribution: "Responsável do projeto (ownerId).",
    compute(ctx) {
      const items = concludedInPeriod(ctx);
      return { value: items.length, sourceIds: items.map((p) => src.project(p, ctx.data, { date: p.goLiveAt })) };
    },
  },
  {
    key: "entregas_prazo",
    label: "Entregas no prazo",
    department: "implantacao",
    unit: "percentual",
    direction: "maior_melhor",
    kind: "taxa",
    source: COLLECTIONS.implementationProjects,
    numeratorLabel: "Go-lives no prazo",
    denominatorLabel: "Go-lives no período",
    description: "Dos projetos com go-live no período, a fração com go-live até a data prevista (goLiveAt ≤ dueDate).",
    attribution: "Responsável do projeto (ownerId).",
    compute(ctx) {
      const items = concludedInPeriod(ctx);
      const onTime = items.filter((p) => p.goLiveAt! <= p.dueDate);
      return { value: ratio(onTime.length, items.length), numerator: onTime.length, denominator: items.length, sourceIds: items.map((p) => src.project(p, ctx.data, { date: p.goLiveAt, ok: p.goLiveAt! <= p.dueDate, detail: `${clientName(ctx.data, p.clientId)} · ${p.goLiveAt! <= p.dueDate ? "no prazo" : "atrasado"}` })) };
    },
  },
  {
    key: "tempo_medio_implantacao",
    label: "Tempo médio de implantação",
    department: "implantacao",
    unit: "dias",
    direction: "menor_melhor",
    kind: "taxa",
    source: COLLECTIONS.implementationProjects,
    description: "Média de dias entre o início real e o go-live dos projetos concluídos no período.",
    attribution: "Responsável do projeto (ownerId).",
    compute(ctx) {
      const items = concludedInPeriod(ctx).filter((p) => p.startDate);
      const values = items.map((p) => days(p.startDate!, p.goLiveAt!));
      return { value: avg(values), numerator: sum(values, (v) => v), denominator: items.length, sourceIds: items.map((p, i) => src.project(p, ctx.data, { date: p.goLiveAt, value: values[i] })) };
    },
  },
  {
    key: "ativacao_7_dias",
    label: "Ativação em até 7 dias",
    department: "implantacao",
    unit: "percentual",
    direction: "maior_melhor",
    kind: "taxa",
    source: COLLECTIONS.implementationProjects,
    numeratorLabel: "Go-lives em até 7 dias da liberação",
    denominatorLabel: "Go-lives com contrato liberado",
    description: "Dos projetos com go-live no período e contrato liberado, a fração com go-live em até 7 dias da liberação financeira.",
    attribution: "Responsável do projeto (ownerId).",
    compute(ctx) {
      const items = concludedInPeriod(ctx).filter((p) => p.contractId && ctx.data.contractById.get(p.contractId)?.releasedAt);
      const within = (p: ImplementationProject) => days(ctx.data.contractById.get(p.contractId!)!.releasedAt!, p.goLiveAt!) <= 7;
      const ok = items.filter(within);
      return {
        value: ratio(ok.length, items.length),
        numerator: ok.length,
        denominator: items.length,
        sourceIds: items.map((p) => src.project(p, ctx.data, { date: p.goLiveAt, ok: within(p), value: days(ctx.data.contractById.get(p.contractId!)!.releasedAt!, p.goLiveAt!), detail: `${clientName(ctx.data, p.clientId)} · dias desde a liberação` })),
      };
    },
  },
  {
    key: "backlog_implantacao",
    label: "Backlog de implantação",
    department: "implantacao",
    unit: "numero",
    direction: "menor_melhor",
    kind: "estado",
    source: COLLECTIONS.implementationProjects,
    description: "Projetos em aberto no fim do período (ou agora): criados até a data de referência, sem go-live até ela e não cancelados.",
    attribution: "Responsável do projeto (ownerId).",
    compute(ctx) {
      const inScope = scopeFilter(ctx, "implantacao", projectAttr);
      const at = periodReference(ctx.period, new Date(ctx.data.now));
      const items = ctx.data.projects.filter((p) => p.status !== "cancelada" && p.createdAt <= at && !(p.goLiveAt && p.goLiveAt <= at) && inScope(p));
      return { value: items.length, sourceIds: items.map((p) => src.project(p, ctx.data, { date: p.dueDate, detail: `${clientName(ctx.data, p.clientId)} · ${p.status.replace(/_/g, " ")}` })) };
    },
  },
  {
    key: "chamados_30_dias",
    label: "Chamados nos 30 dias pós go-live",
    department: "implantacao",
    unit: "numero",
    direction: "menor_melhor",
    kind: "taxa",
    source: COLLECTIONS.supportTickets,
    numeratorLabel: "Chamados abertos em até 30 dias do go-live",
    denominatorLabel: "Projetos com go-live no período",
    description: "Média de chamados abertos pelo cliente nos 30 dias seguintes ao go-live, por projeto com go-live no período (a janela de projetos recentes ainda está correndo).",
    attribution: "Responsável do projeto (ownerId) — indicador individual do bônus de Implantação.",
    compute: postGoLiveTickets,
  },
  {
    key: "chamados_pos_implantacao",
    label: "Chamados pós-implantação (equipe)",
    department: "implantacao",
    unit: "numero",
    direction: "menor_melhor",
    kind: "taxa",
    source: COLLECTIONS.supportTickets,
    numeratorLabel: "Chamados abertos em até 30 dias do go-live",
    denominatorLabel: "Projetos com go-live no período",
    description: "Mesma regra de chamados nos 30 dias pós go-live, usada como indicador coletivo do bônus de Implantação.",
    attribution: "Responsável do projeto (ownerId).",
    compute: postGoLiveTickets,
  },
  {
    key: "qualidade_implantacao",
    label: "Qualidade da implantação",
    department: "implantacao",
    unit: "percentual",
    direction: "maior_melhor",
    kind: "taxa",
    source: COLLECTIONS.supportTickets,
    numeratorLabel: "Go-lives sem chamado crítico em 30 dias",
    denominatorLabel: "Go-lives no período",
    description: "Não há nota de satisfação/aceite no projeto; por isso mede a fração de projetos com go-live no período sem chamado crítico nos 30 dias seguintes.",
    attribution: "Responsável do projeto (ownerId).",
    compute(ctx) {
      const items = concludedInPeriod(ctx);
      const clean = (p: ImplementationProject) => !ticketsAfterGoLive(p, ctx.data).some((t) => t.priority === "critico");
      const ok = items.filter(clean);
      return { value: ratio(ok.length, items.length), numerator: ok.length, denominator: items.length, sourceIds: items.map((p) => src.project(p, ctx.data, { date: p.goLiveAt, ok: clean(p), detail: `${clientName(ctx.data, p.clientId)} · ${clean(p) ? "sem chamado crítico" : "com chamado crítico"}` })) };
    },
  },
  {
    key: "produtividade",
    label: "Produtividade (tarefas concluídas)",
    department: "implantacao",
    unit: "numero",
    direction: "maior_melhor",
    kind: "fluxo",
    source: COLLECTIONS.tasks,
    description: "Tarefas concluídas no período. Na visão da empresa conta as tarefas do departamento de Implantação (dono do indicador); a produtividade da empresa toda é o indicador \"Tarefas concluídas\".",
    attribution: "Responsável da tarefa (assigneeId); departamento = departamento da tarefa.",
    compute(ctx) {
      const scoped: FormulaContext = ctx.scope === "empresa" ? { ...ctx, scope: "departamento", scopeId: "implantacao" } : ctx;
      const items = completedTasks(scoped, "implantacao");
      return { value: items.length, sourceIds: items.map((t) => src.task(t, { date: t.completedAt })) };
    },
  },

  // ------------------------------------------------------------------------ CS
  {
    key: "clientes_ativos",
    label: "Clientes ativos",
    department: "cs",
    unit: "numero",
    direction: "maior_melhor",
    kind: "estado",
    source: COLLECTIONS.clients,
    description: "Clientes ativados até o fim do período (ou agora) e sem cancelamento total até essa data.",
    attribution: "Responsável de CS do cliente (ownerCsId).",
    compute(ctx) {
      const at = periodReference(ctx.period, new Date(ctx.data.now));
      const items = activeClientsAt(ctx, at);
      return { value: items.length, sourceIds: items.map((c) => src.client(c, { date: c.activatedAt, value: c.mrr })) };
    },
  },
  {
    key: "saude_cliente",
    label: "Saúde média da carteira",
    department: "cs",
    unit: "numero",
    direction: "maior_melhor",
    kind: "estado",
    source: COLLECTIONS.healthScores,
    description: "Média do health score atual dos clientes ativos com score calculado (fotografia atual).",
    attribution: "Responsável de CS do cliente (ownerCsId).",
    compute(ctx) {
      const unavailable = unavailableOutsideCurrent(ctx, "A saúde da carteira");
      if (unavailable) return unavailable;
      const items = activeClientsAt(ctx, ctx.data.now).filter((c) => typeof c.healthScore === "number");
      return { value: avg(items.map((c) => c.healthScore!)), numerator: sum(items, (c) => c.healthScore!), denominator: items.length, sourceIds: items.map((c) => src.client(c, { value: c.healthScore, detail: c.healthLevel })) };
    },
  },
  {
    key: "clientes_risco",
    label: "Clientes em risco",
    department: "cs",
    unit: "numero",
    direction: "menor_melhor",
    kind: "estado",
    source: COLLECTIONS.clients,
    description: "Clientes ativos com nível de saúde \"risco\" agora (fotografia atual).",
    attribution: "Responsável de CS do cliente (ownerCsId).",
    compute(ctx) {
      const unavailable = unavailableOutsideCurrent(ctx, "Clientes em risco");
      if (unavailable) return unavailable;
      const items = activeClientsAt(ctx, ctx.data.now).filter((c) => c.healthLevel === "risco");
      return { value: items.length, sourceIds: items.map((c) => src.client(c, { value: c.healthScore, detail: `Saúde ${c.healthScore ?? "—"} · MRR ${formatCurrency(c.mrr)}` })) };
    },
  },
  {
    key: "adocao_media",
    label: "Adoção média",
    department: "cs",
    unit: "percentual",
    direction: "maior_melhor",
    kind: "estado",
    source: COLLECTIONS.csAccounts,
    description: "Média do percentual de adoção das contas de CS de clientes ativos (fotografia atual).",
    attribution: "Responsável da conta de CS (ownerId).",
    compute(ctx) {
      const unavailable = unavailableOutsideCurrent(ctx, "A adoção média");
      if (unavailable) return unavailable;
      const inScope = scopeFilter(ctx, "cs", { user: (a: CsAccount) => a.ownerId });
      const active = new Set(activeClientsAt({ ...ctx, scope: "empresa", scopeId: undefined }, ctx.data.now).map((c) => c.id));
      const items = ctx.data.csAccounts.filter((a) => active.has(a.clientId) && inScope(a));
      const values = items.map((a) => (a.adoptionPct ?? 0) / 100);
      return {
        value: avg(values),
        sourceIds: items.map((a, i) => ({ collection: COLLECTIONS.csAccounts, id: a.id, label: clientName(ctx.data, a.clientId), href: `/clientes/${a.clientId}?aba=cs`, value: values[i], userId: a.ownerId })),
      };
    },
  },
  {
    key: "csat_cs",
    label: "Satisfação da carteira (CS)",
    department: "cs",
    unit: "numero",
    direction: "maior_melhor",
    kind: "estado",
    source: COLLECTIONS.csAccounts,
    description: "Média da satisfação (0–10) registrada nas contas de CS de clientes ativos (fotografia atual). Não há NPS registrado no sistema.",
    attribution: "Responsável da conta de CS (ownerId).",
    compute(ctx) {
      const unavailable = unavailableOutsideCurrent(ctx, "A satisfação da carteira");
      if (unavailable) return unavailable;
      const inScope = scopeFilter(ctx, "cs", { user: (a: CsAccount) => a.ownerId });
      const active = new Set(activeClientsAt({ ...ctx, scope: "empresa", scopeId: undefined }, ctx.data.now).map((c) => c.id));
      const items = ctx.data.csAccounts.filter((a) => active.has(a.clientId) && typeof a.satisfaction === "number" && inScope(a));
      if (items.length === 0) return { value: null, sourceIds: [], note: "Nenhuma conta de CS com satisfação registrada." };
      return {
        value: avg(items.map((a) => a.satisfaction!)),
        sourceIds: items.map((a) => ({ collection: COLLECTIONS.csAccounts, id: a.id, label: clientName(ctx.data, a.clientId), href: `/clientes/${a.clientId}?aba=cs`, value: a.satisfaction, userId: a.ownerId })),
      };
    },
  },
  {
    key: "taxa_renovacao",
    label: "Taxa de renovação",
    department: "cs",
    unit: "percentual",
    direction: "maior_melhor",
    kind: "taxa",
    source: COLLECTIONS.renewals,
    numeratorLabel: "Renovadas",
    denominatorLabel: "Renovações decididas no período",
    description: "Das renovações decididas no período (renovadas ou perdidas; data da última atualização), a fração renovada.",
    attribution: "Responsável da renovação (ownerId).",
    compute(ctx) {
      const inScope = scopeFilter(ctx, "cs", { user: (r: Renewal) => r.ownerId });
      const decided = ctx.data.renewals.filter((r) => (r.status === "renovado" || r.status === "perdido") && inPeriod(r.updatedAt, ctx.period) && inScope(r));
      const renewed = decided.filter((r) => r.status === "renovado");
      return {
        value: ratio(renewed.length, decided.length),
        numerator: renewed.length,
        denominator: decided.length,
        sourceIds: decided.map((r) => ({ collection: COLLECTIONS.renewals, id: r.id, label: `Renovação · ${clientName(ctx.data, r.clientId)}`, href: `/clientes/${r.clientId}?aba=cs`, detail: r.status === "renovado" ? "Renovada" : `Perdida${r.result ? ` · ${r.result}` : ""}`, date: r.updatedAt, ok: r.status === "renovado", userId: r.ownerId })),
      };
    },
  },
  {
    key: "churn",
    label: "Churn (clientes)",
    department: "cs",
    unit: "percentual",
    direction: "menor_melhor",
    kind: "taxa",
    source: COLLECTIONS.churnRecords,
    numeratorLabel: "Clientes cancelados no período",
    denominatorLabel: "Clientes ativos no início do período",
    description: "Clientes com cancelamento total no período ÷ clientes ativos no início do período (mesma regra do painel de Churn do CS).",
    attribution: "Responsável de CS do cliente (ownerCsId).",
    compute(ctx) {
      const base = activeClientsAt(ctx, ctx.period.start);
      const cancelled = cancelledInPeriod(ctx);
      const sourceIds = cancelled.map((c) => {
        const record = ctx.data.churn.find((r) => r.clientId === c.id && r.date === ctx.data.clientCancelledAt.get(c.id));
        return record
          ? { collection: COLLECTIONS.churnRecords, id: record.id, label: c.tradeName, href: `/clientes/${c.id}?aba=cs`, detail: record.reason, date: record.date, value: record.lostMrr, userId: c.ownerCsId }
          : src.client(c, { date: ctx.data.clientCancelledAt.get(c.id), detail: "Cancelado (sem registro de churn)" });
      });
      return { value: ratio(cancelled.length, base.length), numerator: cancelled.length, denominator: base.length, sourceIds };
    },
  },
  {
    key: "churn_receita",
    label: "Churn de receita",
    department: "cs",
    unit: "percentual",
    direction: "menor_melhor",
    kind: "taxa",
    source: COLLECTIONS.churnRecords,
    numeratorLabel: "MRR perdido no período",
    denominatorLabel: "MRR no início do período",
    numeratorUnit: "moeda",
    denominatorUnit: "moeda",
    description: "MRR perdido nos registros de churn do período (totais e parciais) ÷ MRR no início do período.",
    attribution: "Responsável de CS do cliente (ownerCsId); o MRR de base é o dos contratos desses clientes.",
    compute(ctx) {
      const clientInScope = scopeFilter(ctx, "cs", clientCsAttr);
      const recordInScope = (r: ChurnRecord) => {
        const client = ctx.data.clientById.get(r.clientId);
        return client ? clientInScope(client) : ctx.scope === "empresa";
      };
      const records = ctx.data.churn.filter((r) => inPeriod(r.date, ctx.period) && recordInScope(r));
      const scopedClients = new Set(ctx.data.clients.filter(clientInScope).map((c) => c.id));
      const baseContracts = mrrContracts({ ...ctx, scope: "empresa", scopeId: undefined }, ctx.period.start).filter((c) => ctx.scope === "empresa" || scopedClients.has(c.clientId));
      const lost = sum(records, (r) => r.lostMrr);
      const base = sum(baseContracts, (c) => c.monthlyTotal);
      return {
        value: ratio(lost, base),
        numerator: lost,
        denominator: base,
        sourceIds: records.map((r) => ({ collection: COLLECTIONS.churnRecords, id: r.id, label: clientName(ctx.data, r.clientId), href: `/clientes/${r.clientId}?aba=cs`, detail: r.reason, date: r.date, value: r.lostMrr, userId: ctx.data.clientById.get(r.clientId)?.ownerCsId ?? r.responsibleId })),
      };
    },
  },
  {
    key: "churn_inicial_90_dias",
    label: "Churn inicial (até 90 dias)",
    department: "cs",
    unit: "percentual",
    direction: "menor_melhor",
    kind: "taxa",
    source: COLLECTIONS.churnRecords,
    numeratorLabel: "Cancelados até 90 dias da ativação",
    denominatorLabel: "Clientes ativados nos 90 dias anteriores",
    description: "Base = clientes ativados nos 90 dias anteriores ao fim do período; mede a fração dessa base que cancelou até a data de referência (janela de retenção 31–90 dias do deck de Implantação).",
    attribution: "Responsável de CS do cliente (ownerCsId).",
    compute(ctx) {
      const inScope = scopeFilter(ctx, "cs", clientCsAttr);
      const at = periodReference(ctx.period, new Date(ctx.data.now));
      const since = new Date(Date.parse(at) - 90 * DAY_MS).toISOString();
      const base = ctx.data.clients.filter((c) => c.activatedAt && c.activatedAt > since && c.activatedAt <= at && inScope(c));
      const churned = (c: Client) => {
        const cancelled = ctx.data.clientCancelledAt.get(c.id);
        return Boolean(cancelled && cancelled <= at);
      };
      const lost = base.filter(churned);
      return { value: ratio(lost.length, base.length), numerator: lost.length, denominator: base.length, sourceIds: base.map((c) => src.client(c, { date: c.activatedAt, ok: !churned(c), detail: churned(c) ? "Cancelado" : "Ativo" })) };
    },
  },
  {
    key: "upsell_gerado",
    label: "Upsell gerado",
    department: "cs",
    unit: "moeda",
    direction: "maior_melhor",
    kind: "fluxo",
    source: COLLECTIONS.opportunities,
    description: "Receita (adesão + 1 mensalidade + hardware) das oportunidades de upsell/cross-sell ganhas no período.",
    attribution: "Quem originou a oportunidade (originUserId); departamento = departamento de origem (originDepartment), exceto o CS, que vê todo upsell ganho.",
    compute(ctx) {
      // O CS (dono do indicador) enxerga todo upsell ganho; outros departamentos, o que originaram.
      const ownView = ctx.scope === "departamento" && ctx.scopeId === "cs";
      const inScope = ownView ? () => true : scopeFilter(ctx, "cs", { user: (o: Opportunity) => o.originUserId, department: (o: Opportunity) => o.originDepartment });
      const items = ctx.data.opportunities.filter((o) => (o.kind === "upsell" || o.kind === "cross_sell") && o.stage === "ganho" && inPeriod(o.wonAt, ctx.period) && inScope(o));
      const amount = (o: Opportunity) => o.setupTotal + o.monthlyTotal + o.hardwareTotal;
      return { value: sum(items, amount), sourceIds: items.map((o) => src.opportunity(o, ctx.data, { date: o.wonAt, value: amount(o), userId: o.originUserId })) };
    },
  },

  // ------------------------------------------------------------------- Suporte
  {
    key: "chamados_abertos",
    label: "Chamados abertos",
    department: "suporte",
    unit: "numero",
    direction: "menor_melhor",
    kind: "fluxo",
    source: COLLECTIONS.supportTickets,
    description: "Chamados abertos no período (data de abertura).",
    attribution: "Atendente responsável (assigneeId).",
    compute(ctx) {
      const inScope = scopeFilter(ctx, "suporte", ticketAttr);
      const items = ctx.data.tickets.filter((t) => inPeriod(t.openedAt, ctx.period) && inScope(t));
      return { value: items.length, sourceIds: items.map((t) => src.ticket(t, ctx.data, { date: t.openedAt, detail: `${clientName(ctx.data, t.clientId)} · ${t.priority}` })) };
    },
  },
  {
    key: "chamados_resolvidos",
    label: "Chamados resolvidos",
    department: "suporte",
    unit: "numero",
    direction: "maior_melhor",
    kind: "fluxo",
    source: COLLECTIONS.supportTickets,
    description: "Chamados resolvidos no período (data da resolução).",
    attribution: "Atendente responsável (assigneeId).",
    compute(ctx) {
      const inScope = scopeFilter(ctx, "suporte", ticketAttr);
      const items = ctx.data.tickets.filter((t) => inPeriod(t.resolvedAt, ctx.period) && inScope(t));
      return { value: items.length, sourceIds: items.map((t) => src.ticket(t, ctx.data, { date: t.resolvedAt })) };
    },
  },
  {
    key: "sla_resposta",
    label: "SLA de primeira resposta",
    department: "suporte",
    unit: "percentual",
    direction: "maior_melhor",
    kind: "taxa",
    source: COLLECTIONS.slaInstances,
    numeratorLabel: "Respostas no prazo",
    denominatorLabel: "Respostas avaliadas",
    description: "Chamados respondidos no período dentro do prazo de resposta ÷ chamados avaliados (respondidos no período, ou com prazo de resposta vencido no período sem resposta). Mesma regra do relatório de SLA.",
    attribution: "Atendente responsável (assigneeId).",
    compute: (ctx) => slaCompliance(ctx, "response"),
  },
  {
    key: "sla_solucao",
    label: "SLA de solução",
    department: "suporte",
    unit: "percentual",
    direction: "maior_melhor",
    kind: "taxa",
    source: COLLECTIONS.slaInstances,
    numeratorLabel: "Soluções no prazo",
    denominatorLabel: "Soluções avaliadas",
    description: "Chamados resolvidos no período dentro do prazo ÷ chamados avaliados (resolvidos no período, ou abertos com prazo vencido no período). Mesma regra do relatório de SLA.",
    attribution: "Atendente responsável (assigneeId).",
    compute: (ctx) => slaCompliance(ctx, "resolution"),
  },
  {
    key: "tempo_medio_resposta_min",
    label: "Tempo médio de primeira resposta",
    department: "suporte",
    unit: "numero",
    suffix: "min",
    direction: "menor_melhor",
    kind: "taxa",
    source: COLLECTIONS.supportTickets,
    description: "Média, em minutos corridos, entre a abertura e a primeira resposta dos chamados respondidos no período.",
    attribution: "Atendente responsável (assigneeId).",
    compute(ctx) {
      const inScope = scopeFilter(ctx, "suporte", ticketAttr);
      const items = ctx.data.tickets.filter((t) => inPeriod(t.firstResponseAt, ctx.period) && inScope(t));
      const values = items.map((t) => (new Date(t.firstResponseAt!).getTime() - new Date(t.openedAt).getTime()) / 60_000);
      return { value: avg(values), numerator: sum(values, (v) => v), denominator: items.length, sourceIds: items.map((t, i) => src.ticket(t, ctx.data, { date: t.firstResponseAt, value: values[i] })) };
    },
  },
  {
    key: "tempo_medio_solucao_h",
    label: "Tempo médio de solução",
    department: "suporte",
    unit: "horas",
    direction: "menor_melhor",
    kind: "taxa",
    source: COLLECTIONS.supportTickets,
    description: "Média, em horas corridas, entre a abertura e a resolução dos chamados resolvidos no período.",
    attribution: "Atendente responsável (assigneeId).",
    compute(ctx) {
      const inScope = scopeFilter(ctx, "suporte", ticketAttr);
      const items = ctx.data.tickets.filter((t) => inPeriod(t.resolvedAt, ctx.period) && inScope(t));
      const values = items.map((t) => (new Date(t.resolvedAt!).getTime() - new Date(t.openedAt).getTime()) / 3_600_000);
      return { value: avg(values), numerator: sum(values, (v) => v), denominator: items.length, sourceIds: items.map((t, i) => src.ticket(t, ctx.data, { date: t.resolvedAt, value: values[i] })) };
    },
  },
  {
    key: "reincidencia",
    label: "Reincidência de chamados",
    department: "suporte",
    unit: "percentual",
    direction: "menor_melhor",
    kind: "taxa",
    source: COLLECTIONS.supportTickets,
    numeratorLabel: "Chamados reabertos no período",
    denominatorLabel: "Chamados resolvidos no período",
    description: "Chamados de reabertura criados no período ÷ chamados resolvidos no período (mesma regra da Central de Suporte).",
    attribution: "Atendente responsável (assigneeId).",
    compute(ctx) {
      const inScope = scopeFilter(ctx, "suporte", ticketAttr);
      const reopened = ctx.data.tickets.filter((t) => t.reopenedFromId && inPeriod(t.openedAt, ctx.period) && inScope(t));
      const resolved = ctx.data.tickets.filter((t) => inPeriod(t.resolvedAt, ctx.period) && inScope(t));
      return {
        value: ratio(reopened.length, resolved.length),
        numerator: reopened.length,
        denominator: resolved.length,
        sourceIds: [...reopened.map((t) => src.ticket(t, ctx.data, { date: t.openedAt, ok: false, detail: `${clientName(ctx.data, t.clientId)} · reaberto` })), ...resolved.map((t) => src.ticket(t, ctx.data, { date: t.resolvedAt, detail: `${clientName(ctx.data, t.clientId)} · resolvido` }))],
      };
    },
  },
  {
    key: "csat",
    label: "CSAT (0–10)",
    department: "suporte",
    unit: "numero",
    direction: "maior_melhor",
    kind: "taxa",
    source: COLLECTIONS.csatResponses,
    description: "Média das notas de satisfação (escala 0–10) respondidas no período.",
    attribution: "Atendente avaliado (attendantId).",
    compute(ctx) {
      const inScope = scopeFilter(ctx, "suporte", { user: (r: CsatResponse) => r.attendantId });
      const items = ctx.data.csat.filter((r) => inPeriod(r.respondedAt, ctx.period) && inScope(r));
      const tickets = new Map(ctx.data.tickets.map((t) => [t.id, t]));
      return {
        value: avg(items.map((r) => r.score)),
        numerator: sum(items, (r) => r.score),
        denominator: items.length,
        sourceIds: items.map((r) => ({ collection: COLLECTIONS.csatResponses, id: r.id, label: tickets.get(r.ticketId) ? `${tickets.get(r.ticketId)!.number} · ${tickets.get(r.ticketId)!.subject}` : "Avaliação de chamado", href: `/suporte/chamados/${r.ticketId}`, detail: r.comment ?? clientName(ctx.data, r.clientId), value: r.score, date: r.respondedAt, userId: r.attendantId })),
      };
    },
  },
  {
    key: "backlog_suporte",
    label: "Backlog de chamados",
    department: "suporte",
    unit: "numero",
    direction: "menor_melhor",
    kind: "estado",
    source: COLLECTIONS.supportTickets,
    description: "Chamados em aberto no fim do período (ou agora): abertos até a data de referência e sem resolução/fechamento até ela.",
    attribution: "Atendente responsável (assigneeId).",
    compute(ctx) {
      const inScope = scopeFilter(ctx, "suporte", ticketAttr);
      const at = periodReference(ctx.period, new Date(ctx.data.now));
      const items = ctx.data.tickets.filter((t) => {
        if (t.openedAt > at || !inScope(t)) return false;
        const done = [t.resolvedAt, t.closedAt].filter((d): d is string => Boolean(d)).sort()[0];
        if (done) return done > at;
        return OPEN_TICKET.has(t.status);
      });
      return { value: items.length, sourceIds: items.map((t) => src.ticket(t, ctx.data, { date: t.openedAt, detail: `${clientName(ctx.data, t.clientId)} · ${t.priority}` })) };
    },
  },
  {
    key: "oportunidades_suporte",
    label: "Oportunidades geradas pelo suporte",
    department: "suporte",
    unit: "numero",
    direction: "maior_melhor",
    kind: "fluxo",
    source: COLLECTIONS.opportunities,
    description: "Oportunidades criadas no período com origem no Suporte (diagnóstico → registro no CRM → vendas). Base do extra de R$ 50 por oportunidade válida.",
    attribution: "Quem originou a oportunidade (originUserId); departamento = departamento de origem (originDepartment).",
    compute(ctx) {
      const inScope = scopeFilter(ctx, "suporte", { user: (o: Opportunity) => o.originUserId, department: (o: Opportunity) => o.originDepartment });
      const items = ctx.data.opportunities.filter((o) => o.originDepartment === "suporte" && inPeriod(o.createdAt, ctx.period) && inScope(o));
      return { value: items.length, sourceIds: items.map((o) => src.opportunity(o, ctx.data, { date: o.createdAt, userId: o.originUserId, ok: o.stage !== "perdido", detail: `${clientName(ctx.data, o.clientId)} · ${o.stage}` })) };
    },
  },
  {
    key: "auditoria_qualidade",
    label: "Auditoria de qualidade",
    department: "suporte",
    unit: "percentual",
    direction: "maior_melhor",
    kind: "taxa",
    source: COLLECTIONS.supportTickets,
    description: "Aprovação na auditoria de qualidade dos atendimentos/implantações. O INTEROS ainda não registra auditorias; o indicador fica indisponível até existir essa fonte.",
    attribution: "Colaborador auditado.",
    compute: () => ({ value: null, sourceIds: [], note: "Indisponível: não há registros de auditoria de qualidade no sistema." }),
  },

  // ------------------------------------------------------------------ Operação
  {
    key: "tarefas_concluidas",
    label: "Tarefas concluídas",
    department: "empresa",
    unit: "numero",
    direction: "maior_melhor",
    kind: "fluxo",
    source: COLLECTIONS.tasks,
    description: "Tarefas concluídas no período.",
    attribution: "Responsável da tarefa (assigneeId); departamento = departamento da tarefa.",
    compute(ctx) {
      const items = completedTasks(ctx, "empresa");
      return { value: items.length, sourceIds: items.map((t) => src.task(t, { date: t.completedAt })) };
    },
  },
  {
    key: "tarefas_atrasadas",
    label: "Tarefas atrasadas",
    department: "empresa",
    unit: "numero",
    direction: "menor_melhor",
    kind: "estado",
    source: COLLECTIONS.tasks,
    description: "Tarefas não canceladas, criadas até a data de referência (fim do período ou agora), com prazo vencido e não concluídas até ela.",
    attribution: "Responsável da tarefa (assigneeId); departamento = departamento da tarefa.",
    compute(ctx) {
      const inScope = scopeFilter(ctx, "empresa", taskAttr);
      const at = periodReference(ctx.period, new Date(ctx.data.now));
      const items = ctx.data.tasks.filter((t) => t.status !== "cancelada" && t.dueAt && t.dueAt < at && t.createdAt <= at && !(t.completedAt && t.completedAt <= at) && inScope(t));
      return { value: items.length, sourceIds: items.map((t) => src.task(t, { date: t.dueAt })) };
    },
  },
  {
    key: "tarefas_no_prazo_pct",
    label: "Tarefas no prazo",
    department: "empresa",
    unit: "percentual",
    direction: "maior_melhor",
    kind: "taxa",
    source: COLLECTIONS.tasks,
    numeratorLabel: "Concluídas até o prazo",
    denominatorLabel: "Concluídas com prazo",
    description: "Das tarefas com prazo concluídas no período, a fração concluída até o prazo.",
    attribution: "Responsável da tarefa (assigneeId); departamento = departamento da tarefa.",
    compute(ctx) {
      const items = completedTasks(ctx, "empresa").filter((t) => t.dueAt);
      const onTime = (t: Task) => t.completedAt! <= t.dueAt!;
      return { value: ratio(items.filter(onTime).length, items.length), numerator: items.filter(onTime).length, denominator: items.length, sourceIds: items.map((t) => src.task(t, { date: t.completedAt, ok: onTime(t), detail: onTime(t) ? "No prazo" : "Após o prazo" })) };
    },
  },
  {
    key: "sla_workflow_cumprido",
    label: "SLA do workflow cumprido",
    department: "empresa",
    unit: "percentual",
    direction: "maior_melhor",
    kind: "taxa",
    source: COLLECTIONS.workflowSteps,
    numeratorLabel: "Etapas concluídas no prazo",
    denominatorLabel: "Etapas concluídas com prazo",
    description: "Das etapas de workflow concluídas no período que tinham prazo, a fração concluída até o prazo.",
    attribution: "Responsável da etapa (assigneeId); departamento = departamento da etapa.",
    compute(ctx) {
      const inScope = scopeFilter(ctx, "empresa", { user: (s: WorkflowStep) => s.assigneeId, department: (s: WorkflowStep) => s.department });
      const dueOf = (s: WorkflowStep) => s.dueAt ?? (s.slaInstanceId ? ctx.data.stepSla.get(s.slaInstanceId)?.dueAt : undefined);
      const items = ctx.data.workflowSteps.filter((s) => s.status === "concluida" && dueOf(s) && inPeriod(s.completedAt, ctx.period) && inScope(s));
      const onTime = (s: WorkflowStep) => s.completedAt! <= dueOf(s)!;
      if (items.length === 0) return { value: null, sourceIds: [], note: "Nenhuma etapa com prazo foi concluída no período." };
      return { value: ratio(items.filter(onTime).length, items.length), numerator: items.filter(onTime).length, denominator: items.length, sourceIds: items.map((s) => src.step(s, { date: s.completedAt, ok: onTime(s), detail: onTime(s) ? "No prazo" : "Após o prazo" })) };
    },
  },
];

/** Investimento proporcional da campanha no intervalo (mesma regra de campaignSpendInPeriod do Marketing). */
function campaignSpend(campaign: Campaign, startKey: string, endKey: string, todayKey: string): number {
  if (!campaign.spent) return 0;
  const cStart = dateKey(campaign.startDate);
  const cEnd = [campaign.endDate ? dateKey(campaign.endDate) : todayKey, todayKey].sort()[0];
  if (cEnd < cStart) return 0;
  const span = (a: string, b: string) => Math.round((Date.parse(`${b}T00:00:00Z`) - Date.parse(`${a}T00:00:00Z`)) / DAY_MS) + 1;
  const overlapStart = cStart > startKey ? cStart : startKey;
  const overlapEnd = cEnd < endKey ? cEnd : endKey;
  if (overlapEnd < overlapStart) return 0;
  return (campaign.spent * span(overlapStart, overlapEnd)) / span(cStart, cEnd);
}

/** Coluna "valor" da tabela de origem, quando difere da unidade do indicador. */
const SOURCE_VALUE: Record<string, KpiFormulaMeta["sourceValue"]> = {
  novas_vendas: { label: "Valor vendido", unit: "moeda" },
  oportunidades_paradas: { label: "Dias sem atividade", unit: "dias" },
  contratos_assinados: { label: "Mensalidade", unit: "moeda" },
  crescimento_mrr: { label: "Variação do MRR", unit: "moeda" },
  ativacao_7_dias: { label: "Dias desde a liberação", unit: "dias" },
  chamados_30_dias: { label: "Chamados", unit: "numero" },
  chamados_pos_implantacao: { label: "Chamados", unit: "numero" },
  clientes_ativos: { label: "MRR", unit: "moeda" },
  saude_cliente: { label: "Saúde", unit: "numero" },
  clientes_risco: { label: "Saúde", unit: "numero" },
  csat_cs: { label: "Satisfação", unit: "numero" },
  csat: { label: "Nota", unit: "numero" },
  churn: { label: "MRR perdido", unit: "moeda" },
  churn_receita: { label: "MRR perdido", unit: "moeda" },
  cpl: { label: "Investimento", unit: "moeda" },
  tempo_medio_resposta_min: { label: "Minutos", unit: "numero", suffix: "min" },
};

function withSourceValue(f: KpiFormula): KpiFormula {
  const fallback = f.unit === "moeda" || f.unit === "dias" || f.unit === "horas" || f.unit === "percentual" ? { label: "Valor", unit: f.unit } : { label: "Valor", unit: "numero" as const };
  return { ...f, sourceValue: SOURCE_VALUE[f.key] ?? fallback };
}

export const FORMULAS: ReadonlyMap<string, KpiFormula> = new Map(LIST.map((f) => [f.key, withSourceValue(f)]));

export function getFormula(key: string): KpiFormula | undefined {
  return FORMULAS.get(key);
}

/** Metadados serializáveis de todas as fórmulas (para selects e documentação na UI). */
export function listFormulas(): KpiFormulaMeta[] {
  return Array.from(FORMULAS.values()).map(({ compute: _compute, ...meta }) => {
    void _compute;
    return meta;
  });
}
