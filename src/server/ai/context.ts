import "server-only";
/**
 * Builders de contexto dos agentes: reaproveitam as queries dos módulos e devolvem os dados
 * estruturados (usados pelas regras determinísticas) e um AgentContext (resumo + fatos) enviado à IA.
 */
import { getById, list } from "@/server/db";
import { computeSlaState } from "@/server/sla";
import { listOpportunities } from "@/server/sales/queries";
import { getProject } from "@/server/implementation/queries";
import { getTicket } from "@/server/support/queries";
import { getHealthDetail } from "@/server/cs/queries";
import { formatCurrency, formatDate, formatDateTime } from "@/lib/format";
import { OPPORTUNITY_STAGE_LABELS } from "@/components/sales/model";
import {
  COLLECTIONS,
  type Client,
  type CurrentUser,
  type DomainEvent,
  type Kpi,
  type KpiSnapshot,
  type Lead,
  type Opportunity,
  type Renewal,
  type SlaInstance,
  type SuccessPlan,
  type SupportTicket,
  type Task,
  type User,
} from "@/domain/types";
import type { AgentContext } from "./types";

const DAY_MS = 86_400_000;
const OPEN_TASK = new Set<Task["status"]>(["aberta", "em_andamento", "aguardando"]);

export interface BuiltContext<T> {
  subject: { id: string; label: string; href?: string };
  data: T;
  context: AgentContext;
}

function asCurrentUser(user: User): CurrentUser {
  return {
    ...user,
    isAdmin: user.role === "admin",
    isManager: user.role === "gestor" || user.role === "admin" || user.role === "diretoria",
    isDirector: user.role === "diretoria" || user.role === "admin",
  };
}

const daysSince = (iso: string | undefined, now = Date.now()) => (iso ? Math.max(0, Math.floor((now - new Date(iso).getTime()) / DAY_MS)) : undefined);

// ---------------------------------------------------------------------------
// Comercial
// ---------------------------------------------------------------------------

export interface OpportunityBrief {
  id: string;
  title: string;
  clientName: string;
  stage: string;
  temperature: string;
  monthlyTotal: number;
  daysSinceActivity: number;
  nextActionAt?: string;
}

export interface CommercialData {
  userName: string;
  stalledDays: number;
  open: OpportunityBrief[];
  overdue: OpportunityBrief[];
  noNextAction: OpportunityBrief[];
  stalled: OpportunityBrief[];
  hot: OpportunityBrief[];
  pipeline: { stage: string; count: number; monthly: number }[];
  leadsUncontacted: { id: string; name: string; company?: string; createdAt: string; temperature: string }[];
  overdueTasks: { id: string; title: string; dueAt?: string }[];
}

export async function buildCommercialContext(userId: string): Promise<BuiltContext<CommercialData> | null> {
  const user = await getById<User>(COLLECTIONS.users, userId);
  if (!user) return null;
  const nowIso = new Date().toISOString();
  const [opps, leads, tasks] = await Promise.all([
    listOpportunities(asCurrentUser(user)),
    list<Lead>(COLLECTIONS.leads, { where: [["ownerId", "==", userId]] }),
    list<Task>(COLLECTIONS.tasks, { where: [["assigneeId", "==", userId]] }),
  ]);
  const brief = (r: (typeof opps.rows)[number]): OpportunityBrief => ({
    id: r.id,
    title: r.title,
    clientName: r.clientName,
    stage: r.stage,
    temperature: r.temperature,
    monthlyTotal: r.monthlyTotal,
    daysSinceActivity: r.daysSinceActivity,
    nextActionAt: r.nextActionAt,
  });
  const mine = opps.rows.filter((r) => r.ownerId === userId && r.stage !== "ganho" && r.stage !== "perdido");
  const pipeline = new Map<string, { count: number; monthly: number }>();
  for (const r of mine) {
    const e = pipeline.get(r.stage) ?? { count: 0, monthly: 0 };
    pipeline.set(r.stage, { count: e.count + 1, monthly: e.monthly + r.monthlyTotal });
  }
  const data: CommercialData = {
    userName: user.name,
    stalledDays: opps.settings.diasSemMovimentoParaParada,
    open: mine.map(brief),
    overdue: mine.filter((r) => r.overdue).map(brief),
    noNextAction: mine.filter((r) => r.noNextAction).map(brief),
    stalled: mine.filter((r) => r.stalled).map(brief),
    hot: mine.filter((r) => r.temperature === "quente").map(brief),
    pipeline: Array.from(pipeline, ([stage, v]) => ({ stage, ...v })),
    leadsUncontacted: leads
      .filter((l) => l.status === "novo" && !l.lastContactAt)
      .map((l) => ({ id: l.id, name: l.name, company: l.company, createdAt: l.createdAt, temperature: l.temperature })),
    overdueTasks: tasks.filter((t) => OPEN_TASK.has(t.status) && t.dueAt && t.dueAt < nowIso).map((t) => ({ id: t.id, title: t.title, dueAt: t.dueAt })),
  };
  const monthly = mine.reduce((s, r) => s + r.monthlyTotal, 0);
  return {
    subject: { id: user.id, label: user.name, href: "/vendas" },
    data,
    context: {
      summary: [
        `Vendedor: ${user.name}. ${mine.length} oportunidade(s) abertas somando ${formatCurrency(monthly)} de mensalidade.`,
        `Por etapa: ${data.pipeline.map((p) => `${OPPORTUNITY_STAGE_LABELS[p.stage as Opportunity["stage"]] ?? p.stage} ${p.count}`).join(", ") || "nenhuma"}.`,
        `${data.overdue.length} com follow-up vencido, ${data.noNextAction.length} sem próxima ação, ${data.stalled.length} parada(s) há mais de ${data.stalledDays} dias.`,
        `${data.leadsUncontacted.length} lead(s) sem primeiro contato; ${data.overdueTasks.length} tarefa(s) atrasada(s).`,
      ].join(" "),
      facts: { ...data, open: data.open.slice(0, 20) },
    },
  };
}

// ---------------------------------------------------------------------------
// Implantação
// ---------------------------------------------------------------------------

export interface ImplementationData {
  projectId: string;
  name: string;
  clientName: string;
  status: string;
  phase: string;
  progress: number;
  overdue: boolean;
  daysLate: number;
  dueDate: string;
  pendingInPhase: string[];
  gateMissing: string[];
  waitingClient?: { reason: string; since: string };
  blocked?: { reason: string; since: string };
  slaState?: string;
  trainingsScheduled: number;
  trainingsDone: number;
  openTasks: number;
  postGoLiveTickets: number;
}

export async function buildImplementationContext(projectId: string): Promise<BuiltContext<ImplementationData> | null> {
  const detail = await getProject(projectId);
  if (!detail) return null;
  const { project, row, gate, sla, trainings, tasks } = detail;
  const data: ImplementationData = {
    projectId: project.id,
    name: project.name,
    clientName: detail.client.tradeName,
    status: project.status,
    phase: project.currentPhase,
    progress: project.progress,
    overdue: row.overdue,
    daysLate: row.daysLate,
    dueDate: project.dueDate,
    pendingInPhase: row.pendingInPhase,
    gateMissing: gate.missing,
    waitingClient: project.waitingClient ? { reason: project.waitingClient.reason, since: project.waitingClient.since } : undefined,
    blocked: project.blocked ? { reason: project.blocked.reason, since: project.blocked.since } : undefined,
    slaState: sla?.state,
    trainingsScheduled: trainings.filter((t) => t.status === "agendado").length,
    trainingsDone: trainings.filter((t) => t.status === "realizado").length,
    openTasks: tasks.filter((t) => OPEN_TASK.has(t.status)).length,
    postGoLiveTickets: detail.postGoLiveTickets.length,
  };
  return {
    subject: { id: project.id, label: project.name.includes(detail.client.tradeName) ? project.name : `${project.name} — ${detail.client.tradeName}`, href: `/implantacao/${project.id}` },
    data,
    context: {
      summary: [
        `Projeto ${project.name} (${detail.client.tradeName}): status ${project.status}, fase ${project.currentPhase}, ${project.progress}% concluído, prazo ${formatDate(project.dueDate)}${row.overdue ? ` (atrasado ${row.daysLate} dia(s))` : ""}.`,
        `Pendências da fase: ${row.pendingInPhase.join("; ") || "nenhuma"}. Falta para o go-live: ${gate.missing.join("; ") || "nada"}.`,
        project.waitingClient ? `Aguardando cliente desde ${formatDate(project.waitingClient.since)}: ${project.waitingClient.reason}.` : "",
        project.blocked ? `Bloqueado: ${project.blocked.reason}.` : "",
      ]
        .filter(Boolean)
        .join(" "),
      facts: { ...data },
    },
  };
}

// ---------------------------------------------------------------------------
// Suporte
// ---------------------------------------------------------------------------

export interface SupportData {
  ticketId: string;
  number: string;
  subject: string;
  clientId: string;
  clientName: string;
  status: SupportTicket["status"];
  priority: SupportTicket["priority"];
  open: boolean;
  firstResponseAt?: string;
  hoursOpen: number;
  slaState?: string;
  articles: { id: string; title: string; score: number }[];
  previousSimilar: { id: string; number: string; subject: string }[];
  previousCount: number;
  reopenRate: number;
  csatAverage?: number;
  hasOpportunity: boolean;
}

export async function buildSupportContext(ticketId: string): Promise<BuiltContext<SupportData> | null> {
  const detail = await getTicket(ticketId);
  if (!detail) return null;
  const { ticket, row } = detail;
  const words = new Set(ticket.subject.toLowerCase().split(/\W+/).filter((w) => w.length > 3));
  const similar = detail.previous.filter((p) => p.subject.toLowerCase().split(/\W+/).some((w) => words.has(w)));
  const data: SupportData = {
    ticketId: ticket.id,
    number: ticket.number,
    subject: ticket.subject,
    clientId: ticket.clientId,
    clientName: detail.client?.tradeName ?? row.clientName,
    status: ticket.status,
    priority: ticket.priority,
    open: row.open,
    firstResponseAt: ticket.firstResponseAt,
    hoursOpen: Math.floor((Date.now() - new Date(ticket.openedAt).getTime()) / 3_600_000),
    slaState: row.sla?.view.state,
    articles: detail.suggestedArticles.map((a) => ({ id: a.id, title: a.title, score: a.score })),
    previousSimilar: similar.map((p) => ({ id: p.id, number: p.number, subject: p.subject })),
    previousCount: detail.previous.length,
    reopenRate: detail.clientStats.reopenRate,
    csatAverage: detail.clientStats.csatAverage,
    hasOpportunity: Boolean(detail.opportunity),
  };
  return {
    subject: { id: ticket.id, label: `${ticket.number} · ${ticket.subject}`, href: `/suporte/chamados?chamado=${ticket.id}` },
    data,
    context: {
      summary: [
        `Chamado ${ticket.number} de ${data.clientName}: "${ticket.subject}" (${ticket.priority}, ${ticket.status}), aberto há ${data.hoursOpen}h${ticket.firstResponseAt ? "" : ", sem primeira resposta"}.`,
        `SLA: ${data.slaState ?? "sem SLA"}. Artigos sugeridos: ${data.articles.map((a) => a.title).join("; ") || "nenhum"}.`,
        `Histórico do cliente: ${data.previousCount} chamado(s) anteriores, ${similar.length} parecido(s), reincidência ${(data.reopenRate * 100).toFixed(0)}%.`,
        `Descrição: ${ticket.description.slice(0, 600)}`,
      ].join(" "),
      facts: { ...data },
    },
  };
}

// ---------------------------------------------------------------------------
// Customer Success
// ---------------------------------------------------------------------------

export interface CsData {
  clientId: string;
  tradeName: string;
  mrr: number;
  score?: number;
  level?: string;
  factors: { key: string; label: string; value: number; weight: number; note?: string }[];
  adoptionPct?: number;
  lastInteractionAt?: string;
  daysSinceInteraction?: number;
  nextInteractionAt?: string;
  activePlan?: { id: string; objective: string };
  renewal?: { id: string; dueDate: string; status: string; daysLeft: number };
  openTickets: number;
  explanation: string[];
}

export async function buildCsContext(clientId: string): Promise<BuiltContext<CsData> | null> {
  const [health, client, plans, renewals, tickets] = await Promise.all([
    getHealthDetail(clientId),
    getById<Client>(COLLECTIONS.clients, clientId),
    list<SuccessPlan>(COLLECTIONS.successPlans, { where: [["clientId", "==", clientId]] }),
    list<Renewal>(COLLECTIONS.renewals, { where: [["clientId", "==", clientId]] }),
    list<SupportTicket>(COLLECTIONS.supportTickets, { where: [["clientId", "==", clientId]] }),
  ]);
  if (!health || !client) return null;
  const account = health.account;
  const lastInteraction = [account?.lastInteractionAt, client.lastInteractionAt].filter((v): v is string => Boolean(v)).sort().pop();
  const plan = plans.find((p) => p.status === "ativo");
  const renewal = renewals.filter((r) => r.status === "aguardando" || r.status === "em_negociacao").sort((a, b) => (a.dueDate < b.dueDate ? -1 : 1))[0];
  const data: CsData = {
    clientId,
    tradeName: client.tradeName,
    mrr: client.mrr ?? 0,
    score: health.latest?.score,
    level: health.latest?.level,
    factors: (health.latest?.factors ?? []).map((f) => ({ key: f.key, label: f.label, value: f.value, weight: f.weight, note: f.note })),
    adoptionPct: account?.adoptionPct,
    lastInteractionAt: lastInteraction,
    daysSinceInteraction: daysSince(lastInteraction),
    nextInteractionAt: account?.nextInteractionAt ?? client.nextInteractionAt,
    activePlan: plan ? { id: plan.id, objective: plan.objective } : undefined,
    renewal: renewal ? { id: renewal.id, dueDate: renewal.dueDate, status: renewal.status, daysLeft: Math.ceil((new Date(renewal.dueDate).getTime() - Date.now()) / DAY_MS) } : undefined,
    openTickets: tickets.filter((t) => t.status !== "resolvido" && t.status !== "fechado").length,
    explanation: health.explanation,
  };
  return {
    subject: { id: clientId, label: client.tradeName, href: `/clientes/${clientId}?aba=cs` },
    data,
    context: {
      summary: [
        `Cliente ${client.tradeName}: MRR ${formatCurrency(data.mrr)}, saúde ${data.score ?? "sem cálculo"} (${data.level ?? "—"}), adoção ${data.adoptionPct ?? "—"}%.`,
        `Fatores: ${data.factors.map((f) => `${f.label} ${f.value}`).join(", ") || "sem cálculo"}.`,
        `Última interação: ${lastInteraction ? formatDate(lastInteraction) : "nunca"}. Plano ativo: ${plan?.objective ?? "nenhum"}. Renovação: ${renewal ? formatDate(renewal.dueDate) : "nenhuma aberta"}. Chamados abertos: ${data.openTickets}.`,
      ].join(" "),
      facts: { ...data },
    },
  };
}

// ---------------------------------------------------------------------------
// Executivo
// ---------------------------------------------------------------------------

export interface ExecutiveData {
  period: string;
  mrr: number;
  activeClients: number;
  riskClients: { id: string; tradeName: string; mrr: number }[];
  overdueTasks: number;
  breachedSlas: number;
  stalledOpportunities: number;
  openPipelineMonthly: number;
  kpisCritical: { kpiKey: string; name: string; value: number; target?: number }[];
  kpisTotal: number;
  insights: { title: string; occurredAt: string }[];
}

/** Resumo executivo do período (AAAA-MM): carteira, riscos, execução e, se existirem, scorecards e insights. */
export async function buildExecutiveContext(period: string): Promise<BuiltContext<ExecutiveData>> {
  const [clients, tasks, slas, opps, snapshots, insights, kpis] = await Promise.all([
    list<Client>(COLLECTIONS.clients),
    list<Task>(COLLECTIONS.tasks),
    list<SlaInstance>(COLLECTIONS.slaInstances),
    list<Opportunity>(COLLECTIONS.opportunities),
    list<KpiSnapshot>(COLLECTIONS.kpiSnapshots, { where: [["period", "==", period]] }),
    list<DomainEvent>(COLLECTIONS.events, { where: [["type", "==", "insight.detected"]] }),
    list<Kpi>(COLLECTIONS.kpis),
  ]);
  const kpiName = new Map(kpis.map((k) => [k.key, k.name]));
  const nowIso = new Date().toISOString();
  const now = Date.now();
  const active = clients.filter((c) => c.status === "ativo" || c.status === "em_implantacao");
  const inPeriod = (iso: string | undefined) => Boolean(iso && iso.slice(0, 7) === period);
  // Snapshots da empresa: o mais recente de cada KPI.
  const latestByKpi = new Map<string, KpiSnapshot>();
  for (const s of snapshots.filter((x) => x.scope === "empresa")) {
    const prev = latestByKpi.get(s.kpiKey);
    if (!prev || prev.computedAt < s.computedAt) latestByKpi.set(s.kpiKey, s);
  }
  const openOpps = opps.filter((o) => o.stage !== "ganho" && o.stage !== "perdido");
  const data: ExecutiveData = {
    period,
    mrr: active.reduce((s, c) => s + (c.mrr ?? 0), 0),
    activeClients: active.length,
    riskClients: active.filter((c) => c.healthLevel === "risco").map((c) => ({ id: c.id, tradeName: c.tradeName, mrr: c.mrr ?? 0 })),
    overdueTasks: tasks.filter((t) => OPEN_TASK.has(t.status) && t.dueAt && t.dueAt < nowIso).length,
    breachedSlas: slas.filter((s) => (s.breachedAt && inPeriod(s.breachedAt)) || (s.status === "em_andamento" && computeSlaState(s).state === "violado")).length,
    stalledOpportunities: openOpps.filter((o) => (daysSince(o.lastActivityAt, now) ?? 0) > 7).length,
    openPipelineMonthly: openOpps.reduce((s, o) => s + o.monthlyTotal, 0),
    kpisCritical: Array.from(latestByKpi.values())
      .filter((s) => s.status === "critico")
      .map((s) => ({ kpiKey: s.kpiKey, name: kpiName.get(s.kpiKey) ?? s.kpiKey, value: s.value, target: s.target })),
    kpisTotal: latestByKpi.size,
    insights: insights
      .filter((e) => inPeriod(e.occurredAt))
      .sort((a, b) => (a.occurredAt < b.occurredAt ? 1 : -1))
      .slice(0, 10)
      .map((e) => ({ title: e.title, occurredAt: e.occurredAt })),
  };
  return {
    subject: { id: period, label: `Competência ${period}`, href: "/gestao/cockpit" },
    data,
    context: {
      summary: [
        `Competência ${period}: ${data.activeClients} cliente(s) ativos, MRR ${formatCurrency(data.mrr)}.`,
        `${data.riskClients.length} cliente(s) em risco (${formatCurrency(data.riskClients.reduce((s, c) => s + c.mrr, 0))} de MRR).`,
        `${data.overdueTasks} tarefa(s) atrasada(s), ${data.breachedSlas} SLA(s) violado(s), ${data.stalledOpportunities} oportunidade(s) parada(s); pipeline aberto ${formatCurrency(data.openPipelineMonthly)}/mês.`,
        data.kpisTotal > 0 ? `${data.kpisCritical.length} de ${data.kpisTotal} indicador(es) em nível crítico.` : "Sem fotografia de indicadores no período.",
        data.insights.length > 0 ? `Insights: ${data.insights.map((i) => `${i.title} (${formatDateTime(i.occurredAt)})`).join("; ")}.` : "",
      ]
        .filter(Boolean)
        .join(" "),
      facts: { ...data },
    },
  };
}
