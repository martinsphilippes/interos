import "server-only";
/**
 * Leituras de GESTÃO: Dashboard do Gestor (/gestao), visão do colaborador (/gestao/equipe/[userId]) e
 * Cockpit da Diretoria (/gestao/cockpit).
 *
 * Indicadores vêm SEMPRE do motor de KPIs (getDepartmentScorecard, getUserScorecard, computeKpiBatch,
 * getHistory); os números operacionais (tarefas, SLAs, etapas, clientes críticos, volumes de handoff) são
 * lidos das coleções com filtros de igualdade e agregados em memória. O cockpit usa o DataBundle do motor
 * (carga única e cache por período) para os volumes que não são indicadores.
 */
import { getById, list } from "@/server/db";
import { computeSlaState } from "@/server/sla";
import { dateLabel, dayKey, todayKey } from "@/server/tasks/queries";
import { evaluateInsights, evaluateInsightsForDepartments, type Insight } from "@/server/insights/engine";
import { SCORECARD_KEYS, computeKpiBatch, getHistory, loadKpiDocs, statusFor, type HistoryPoint, type KpiResult } from "@/server/kpis/engine";
import { loadDataBundle } from "@/server/kpis/formulas";
import { OPERATIONAL_DEPARTMENTS, getCompanyScorecard, getDepartmentScorecard, getUserScorecard, summarizeScorecard, type Scorecard } from "@/server/kpis/queries";
import { inPeriod, isCurrentPeriod, localDayKey, periodReference, previousPeriod, type Period } from "@/server/kpis/period";
import { formatKpiValue, kpiHref, type KpiStatus, type KpiUnit } from "@/server/kpis/schemas";
import { computeOperationHealth, getPerformanceIndexConfig, goalsAttainment, indexFromScorecard, type OperationHealth } from "@/server/kpis/operation-health";
import { getSlaSummary } from "@/server/sla-report/queries";
import { getSetting } from "@/server/admin/queries";
import { slaHref as slaPageHref } from "@/server/sla-report/schemas";
import { isOpenStatus, processHrefFor, PROCESS_TYPE_LABELS } from "@/components/tasks/task-model";
import {
  COLLECTIONS,
  type Billing,
  type Client,
  type CurrentUser,
  type Department,
  type DomainEvent,
  type GamificationPoints,
  type ImplementationProject,
  type Proposal,
  type SlaInstance,
  type SlaView,
  type SupportTicket,
  type Task,
  type User,
  type WorkflowStep,
} from "@/domain/types";
import { DEPARTMENT_KEYS, DEPARTMENT_LABELS, ROLE_LABELS, SLA_STATE_LABELS, TASK_STATUS_LABELS, WORKFLOW_STEP_STATUS_LABELS, type DepartmentKey, type Priority, type TaskStatus } from "@/domain/constants";
import { formatCurrency } from "@/lib/format";
import { OVERLOAD_RATIO, STALLED_STEP_DAYS, type FocusKey } from "./schemas";

const DAY_MS = 86_400_000;
const OPEN_STEP_STATUSES: WorkflowStep["status"][] = ["pendente", "em_andamento", "aguardando_cliente", "aguardando_aprovacao"];
const OPEN_TICKET_STATUSES: SupportTicket["status"][] = ["aberto", "em_atendimento", "aguardando_cliente", "reaberto"];
const RISK_STATES = new Set(["em_risco", "violado"]);

// ---------------------------------------------------------------------------
// Escopo do gestor
// ---------------------------------------------------------------------------

export interface ManagerScope {
  kind: "equipe" | "departamento" | "empresa";
  department?: DepartmentKey;
  label: string;
  description: string;
  /** Colaboradores da tabela (sem o próprio gestor). */
  members: User[];
  /** Departamentos cujos indicadores e alertas aparecem no dashboard. */
  departments: DepartmentKey[];
  /** Admin/diretoria escolhem departamento ou empresa; gestor de vários departamentos, um deles (?departamento=). */
  canChoose: boolean;
  /** Opções do seletor de departamento. */
  options: { value: string; label: string }[];
  /** Valor atual do seletor. */
  selected: string;
}

async function loadOrg(): Promise<{ users: User[]; departments: Department[] }> {
  const [users, departments] = await Promise.all([list<User>(COLLECTIONS.users), list<Department>(COLLECTIONS.departments)]);
  return { users: users.filter((u) => u.active !== false), departments };
}

function byName(a: { name: string }, b: { name: string }): number {
  return a.name.localeCompare(b.name, "pt-BR");
}

/** Equipe do gestor: liderados diretos (managerId) e os liderados deles (1 nível de recursão). */
function teamOf(managerId: string, users: User[]): User[] {
  const direct = users.filter((u) => u.managerId === managerId && u.id !== managerId);
  const directIds = new Set(direct.map((u) => u.id));
  const second = users.filter((u) => u.managerId && directIds.has(u.managerId) && u.id !== managerId && !directIds.has(u.id));
  return [...direct, ...second].sort(byName);
}

function managedDepartments(user: Pick<User, "id" | "departmentId">, departments: Department[]): DepartmentKey[] {
  const keys = new Set<DepartmentKey>([user.departmentId, ...departments.filter((d) => d.managerId === user.id).map((d) => d.key)]);
  keys.delete("diretoria");
  return DEPARTMENT_KEYS.filter((k) => keys.has(k));
}

function isDepartment(value: string | undefined): value is DepartmentKey {
  return Boolean(value) && (DEPARTMENT_KEYS as readonly string[]).includes(value as string);
}

function scopeFrom(user: CurrentUser, requested: string | undefined, users: User[], departments: Department[]): ManagerScope {
  const scope = resolveScope(user, requested, users, departments);
  const options = user.isDirector
    ? [{ value: "empresa", label: "Empresa inteira" }, ...DEPARTMENT_KEYS.filter((d) => d !== "diretoria").map((d) => ({ value: d as string, label: DEPARTMENT_LABELS[d] }))]
    : [{ value: "equipe", label: "Minha equipe" }, ...managedDepartments(user, departments).map((d) => ({ value: d as string, label: DEPARTMENT_LABELS[d] }))];
  return { ...scope, options };
}

function resolveScope(user: CurrentUser, requested: string | undefined, users: User[], departments: Department[]): Omit<ManagerScope, "options"> {
  if (user.isDirector) {
    if (isDepartment(requested) && requested !== "diretoria") {
      return {
        kind: "departamento",
        department: requested,
        label: DEPARTMENT_LABELS[requested],
        description: `Colaboradores de ${DEPARTMENT_LABELS[requested]}`,
        members: users.filter((u) => u.departmentId === requested && u.id !== user.id).sort(byName),
        departments: [requested],
        canChoose: true,
        selected: requested,
      };
    }
    return {
      kind: "empresa",
      label: "Empresa",
      description: "Todos os colaboradores ativos",
      members: users.filter((u) => u.id !== user.id && u.departmentId !== "diretoria").sort(byName),
      departments: OPERATIONAL_DEPARTMENTS,
      canChoose: true,
      selected: "empresa",
    };
  }
  const members = teamOf(user.id, users);
  const managed = managedDepartments(user, departments);
  // Gestor de mais de um departamento pode olhar um deles (só os colaboradores da sua equipe nesse departamento).
  if (isDepartment(requested) && managed.includes(requested)) {
    return {
      kind: "departamento",
      department: requested,
      label: DEPARTMENT_LABELS[requested],
      description: `Sua equipe em ${DEPARTMENT_LABELS[requested]}`,
      members: members.filter((m) => m.departmentId === requested),
      departments: [requested],
      canChoose: managed.length > 1,
      selected: requested,
    };
  }
  return {
    kind: "equipe",
    label: `Equipe de ${user.name.split(" ")[0]}`,
    description: "Seus liderados diretos e os liderados deles",
    members,
    departments: managed,
    canChoose: managed.length > 1,
    selected: "equipe",
  };
}

export async function resolveManagerScope(user: CurrentUser, requested?: string): Promise<ManagerScope> {
  const { users, departments } = await loadOrg();
  return scopeFrom(user, requested, users, departments);
}

/** O gestor pode ver o colaborador? Diretoria/admin: qualquer usuário ativo; gestor: a própria equipe. */
export function canManageMember(user: CurrentUser, memberId: string, users: User[]): boolean {
  if (user.isDirector) return users.some((u) => u.id === memberId);
  if (!user.isManager) return false;
  return teamOf(user.id, users).some((u) => u.id === memberId);
}

// ---------------------------------------------------------------------------
// Itens operacionais (tarefas, SLAs, etapas, clientes)
// ---------------------------------------------------------------------------

export interface TaskRow {
  id: string;
  title: string;
  status: TaskStatus;
  statusLabel: string;
  priority: Priority;
  dueAt?: string;
  dueLabel?: string;
  overdue: boolean;
  completedAt?: string;
  completedLabel?: string;
  clientId?: string;
  clientName?: string;
  processLabel?: string;
  processHref?: string;
  href: string;
  assigneeId?: string;
}

function isOverdue(t: Task, today: string): boolean {
  return isOpenStatus(t.status) && Boolean(t.dueAt) && dayKey(t.dueAt!) < today;
}

function toTaskRow(t: Task, today: string): TaskRow {
  return {
    id: t.id,
    title: t.title,
    status: t.status,
    statusLabel: TASK_STATUS_LABELS[t.status],
    priority: t.priority,
    dueAt: t.dueAt,
    dueLabel: t.dueAt ? dateLabel(t.dueAt, today) : undefined,
    overdue: isOverdue(t, today),
    completedAt: t.completedAt,
    completedLabel: t.completedAt ? dateLabel(t.completedAt, today) : undefined,
    clientId: t.clientId,
    clientName: t.clientName,
    processLabel: t.processType ? PROCESS_TYPE_LABELS[t.processType] : undefined,
    processHref: processHrefFor(t),
    href: `/tarefas?tarefa=${t.id}`,
    assigneeId: t.assigneeId,
  };
}

function sortByDue(a: TaskRow, b: TaskRow): number {
  return (a.dueAt ?? "9999") < (b.dueAt ?? "9999") ? -1 : (a.dueAt ?? "9999") > (b.dueAt ?? "9999") ? 1 : 0;
}

export interface SlaRow {
  id: string;
  ruleName: string;
  entityLabel: string;
  href: string;
  clientId?: string;
  ownerId?: string;
  view: SlaView;
  stateLabel: string;
}

const SLA_ENTITY_LABELS: Record<SlaInstance["entityType"], string> = {
  tarefa: "Tarefa",
  workflow_step: "Etapa de workflow",
  chamado: "Chamado",
  projeto: "Projeto de implantação",
  cs: "Customer Success",
  oportunidade: "Oportunidade",
};

function slaHref(s: SlaInstance): string {
  switch (s.entityType) {
    case "tarefa":
      return `/tarefas?tarefa=${s.entityId}`;
    case "workflow_step":
      return `/workflow?etapa=${s.entityId}`;
    case "chamado":
      return `/suporte/chamados/${s.entityId}`;
    case "projeto":
      return `/implantacao/${s.entityId}`;
    case "oportunidade":
      return `/vendas/oportunidades?oportunidade=${s.entityId}`;
    default:
      return s.clientId ? `/clientes/${s.clientId}?aba=cs` : "/cs";
  }
}

const SLA_SEVERITY: Record<string, number> = { violado: 0, em_risco: 1, em_atencao: 2, pausado: 3, dentro_do_prazo: 4, concluido: 5 };

function toSlaRow(s: SlaInstance, now: Date): SlaRow {
  const view = computeSlaState(s, now);
  return { id: s.id, ruleName: s.ruleName, entityLabel: SLA_ENTITY_LABELS[s.entityType], href: slaHref(s), clientId: s.clientId, ownerId: s.ownerId, view, stateLabel: SLA_STATE_LABELS[view.state] };
}

export interface StepRow {
  id: string;
  stageName: string;
  clientId: string;
  clientName: string;
  department: DepartmentKey;
  status: WorkflowStep["status"];
  statusLabel: string;
  sla: SlaView | null;
  daysIdle: number;
  stalled: boolean;
  reason: string | null;
  href: string;
  instanceHref: string;
  assigneeId?: string;
}

function toStepRow(step: WorkflowStep, sla: SlaInstance | undefined, now: Date): StepRow {
  const view = sla ? computeSlaState(sla, now) : null;
  const daysIdle = Math.floor((now.getTime() - Date.parse(step.updatedAt)) / DAY_MS);
  let reason: string | null = null;
  if (step.status === "aguardando_aprovacao") reason = "Aguardando aprovação";
  else if (view?.state === "violado") reason = "SLA violado";
  else if (daysIdle >= STALLED_STEP_DAYS) reason = `Sem movimentação há ${daysIdle} dias`;
  return {
    id: step.id,
    stageName: step.stageName,
    clientId: step.clientId,
    clientName: step.clientName,
    department: step.department,
    status: step.status,
    statusLabel: WORKFLOW_STEP_STATUS_LABELS[step.status],
    sla: view,
    daysIdle,
    stalled: reason !== null,
    reason,
    href: `/workflow?etapa=${step.id}`,
    instanceHref: `/workflow/${step.instanceId}`,
    assigneeId: step.assigneeId,
  };
}

export interface CriticalClient {
  id: string;
  name: string;
  healthScore?: number;
  mrr: number;
  reasons: string[];
  href: string;
  /** Colaboradores ligados ao cliente (responsáveis, chamados e etapas abertas). */
  memberIds: string[];
}

interface OperationalData {
  tasks: Task[];
  slas: SlaInstance[];
  steps: WorkflowStep[];
  stepSlas: Map<string, SlaInstance>;
  clients: Client[];
  tickets: SupportTicket[];
  billing: Billing[];
}

async function loadOperational(memberIds: string[]): Promise<OperationalData> {
  const [tasks, slas, steps, clients, tickets, billing] = await Promise.all([
    list<Task>(COLLECTIONS.tasks, { where: [["assigneeId", "in", memberIds]] }),
    list<SlaInstance>(COLLECTIONS.slaInstances, { where: [["ownerId", "in", memberIds]] }),
    list<WorkflowStep>(COLLECTIONS.workflowSteps, { where: [["status", "in", OPEN_STEP_STATUSES]] }),
    list<Client>(COLLECTIONS.clients),
    list<SupportTicket>(COLLECTIONS.supportTickets, { where: [["status", "in", OPEN_TICKET_STATUSES]] }),
    list<Billing>(COLLECTIONS.billing, { where: [["status", "in", ["aberta", "vencida"]]] }),
  ]);
  const stepSlaIds = new Set(steps.map((s) => s.slaInstanceId).filter(Boolean));
  const missing = Array.from(stepSlaIds).filter((id) => !slas.some((s) => s.id === id));
  const extra = missing.length > 0 ? await list<SlaInstance>(COLLECTIONS.slaInstances, { where: [["entityType", "==", "workflow_step"]] }) : [];
  const stepSlas = new Map<string, SlaInstance>();
  for (const s of [...slas, ...extra]) if (stepSlaIds.has(s.id)) stepSlas.set(s.id, s);
  return { tasks, slas: slas.filter((s) => s.status !== "concluido"), steps, stepSlas, clients, tickets, billing };
}

/** Clientes críticos: saúde em risco, chamado crítico aberto ou cobrança vencida. */
function criticalClients(data: OperationalData, memberIds: Set<string>, today: string): CriticalClient[] {
  const ticketsByClient = new Map<string, SupportTicket[]>();
  for (const t of data.tickets) ticketsByClient.set(t.clientId, [...(ticketsByClient.get(t.clientId) ?? []), t]);
  const overdueByClient = new Map<string, number>();
  for (const b of data.billing) {
    if (b.paidAt || dayKey(b.dueDate) >= today) continue;
    overdueByClient.set(b.clientId, (overdueByClient.get(b.clientId) ?? 0) + b.amount);
  }
  const stepsByClient = new Map<string, WorkflowStep[]>();
  for (const s of data.steps) stepsByClient.set(s.clientId, [...(stepsByClient.get(s.clientId) ?? []), s]);

  const out: CriticalClient[] = [];
  for (const c of data.clients) {
    if (c.status === "cancelado") continue;
    const reasons: string[] = [];
    if (c.healthLevel === "risco") reasons.push(`Saúde em risco${c.healthScore !== undefined ? ` (${Math.round(c.healthScore)})` : ""}`);
    const tickets = ticketsByClient.get(c.id) ?? [];
    const critical = tickets.filter((t) => t.priority === "critico");
    if (critical.length > 0) reasons.push(`${critical.length} chamado(s) crítico(s) aberto(s)`);
    const overdue = overdueByClient.get(c.id);
    if (overdue) reasons.push(`Cobrança vencida (${formatCurrency(overdue)})`);
    if (reasons.length === 0) continue;
    const linked = new Set<string>();
    for (const id of [c.ownerCsId, c.ownerSalesId, c.ownerImplementationId]) if (id && memberIds.has(id)) linked.add(id);
    for (const t of tickets) if (t.assigneeId && memberIds.has(t.assigneeId)) linked.add(t.assigneeId);
    for (const s of stepsByClient.get(c.id) ?? []) if (s.assigneeId && memberIds.has(s.assigneeId)) linked.add(s.assigneeId);
    out.push({ id: c.id, name: c.tradeName, healthScore: c.healthScore, mrr: c.mrr, reasons, href: `/clientes/${c.id}`, memberIds: Array.from(linked) });
  }
  return out.sort((a, b) => b.reasons.length - a.reasons.length || b.mrr - a.mrr);
}

// ---------------------------------------------------------------------------
// Dashboard do Gestor
// ---------------------------------------------------------------------------

export interface MemberRow {
  id: string;
  name: string;
  avatarUrl?: string;
  jobTitle?: string;
  roleLabel: string;
  departmentId: DepartmentKey;
  departmentLabel: string;
  openTasks: number;
  overdueTasks: number;
  completedInPeriod: number;
  /** Abertas ÷ média de abertas da equipe (1 = na média). */
  load: number | null;
  slaAtRisk: number;
  stalledSteps: number;
  criticalClients: number;
  criticalGoals: number;
  attainment: number | null;
  /** Status do atingimento médio (mesma régua do motor: atenção a partir de 85%). */
  attainmentStatus: KpiStatus | null;
  achieved: number;
  withTarget: number;
  points: number;
  rank: number | null;
  /** Tarefas do período: concluídas no período ÷ (concluídas + em aberto com prazo até o fim do período). */
  tasksDone: number;
  tasksTotal: number;
  /** Cumprimento de SLA do colaborador no período (mesma regra da tela /sla). */
  slaRate: number | null;
  /** Nota de Qualidade do Índice de desempenho (0–100). */
  quality: number | null;
  /** Índice de desempenho (0–100). */
  performanceIndex: number | null;
  /** Resultado pelo atingimento das metas: Acima da meta / No caminho / Abaixo da meta. */
  result: { label: string; tone: "success" | "info" | "warning" | "danger" | "neutral" };
}

export interface ReassignTask {
  id: string;
  title: string;
  dueLabel?: string;
  overdue: boolean;
  clientName?: string;
  priority: Priority;
}

export interface ManagerDashboard {
  scope: ManagerScope;
  period: Period;
  stats: Record<FocusKey, number>;
  members: MemberRow[];
  teamAverageOpen: number;
  criticalClients: CriticalClient[];
  /** Indicadores do(s) departamento(s) em situação crítica (card "Metas em risco"). */
  criticalKpis: KpiResult[];
  scorecards: Scorecard[];
  insights: Insight[];
  reassign: { targets: { id: string; name: string; subtitle: string }[]; tasksByUser: Record<string, ReassignTask[]> };
  summary: ManagerSummary;
  week: TeamWeek;
  goals: DepartmentGoalRow[];
  alerts: ManagerAlert[];
}

export interface ManagerSummary {
  members: number;
  /** Tarefas no prazo (motor: tarefas_no_prazo_pct) somando numerador/denominador dos colaboradores. */
  productivity: { rate: number | null; met: number; total: number; target: number | null; status: KpiStatus | null };
  sla: { rate: number | null; met: number; evaluated: number; target: number };
  tasks: { done: number; total: number };
  /** Soma dos focos críticos (atrasadas, SLAs em risco, etapas paradas, clientes críticos, metas críticas). */
  pending: number;
}

export interface TeamWeekDay {
  key: string;
  label: string;
  due: number;
  onTime: number;
  rate: number | null;
  future: boolean;
}

export interface TeamWeek {
  label: string;
  days: TeamWeekDay[];
  target: number | null;
  overall: number | null;
}

export interface DepartmentGoalRow {
  key: string;
  label: string;
  department: DepartmentKey;
  value: string;
  target: string;
  attainment: number | null;
  status: KpiStatus | null;
  href: string;
}

export interface ManagerAlert {
  key: string;
  kind: "sla" | "capacidade" | "implantacao" | "backlog" | "meta";
  tone: "danger" | "warning";
  title: string;
  detail?: string;
  href: string;
}

const WEEKDAY_LABELS = ["Dom", "Seg", "Ter", "Qua", "Qui", "Sex", "Sáb"];

/** Semana corrente (seg–sex): por dia, tarefas da equipe com prazo no dia e quantas foram entregues até o prazo. */
function teamWeek(tasks: Task[], now: Date, target: number | null): TeamWeek {
  const today = localDayKey(now);
  const ref = new Date(`${today}T12:00:00Z`);
  const monday = new Date(ref.getTime() - ((ref.getUTCDay() + 6) % 7) * DAY_MS);
  const days: TeamWeekDay[] = [];
  let due = 0;
  let onTime = 0;
  for (let i = 0; i < 5; i++) {
    const d = new Date(monday.getTime() + i * DAY_MS);
    const key = d.toISOString().slice(0, 10);
    const future = key > today;
    const ofDay = tasks.filter((t) => t.status !== "cancelada" && t.dueAt && localDayKey(t.dueAt) === key);
    const ok = ofDay.filter((t) => t.status === "concluida" && t.completedAt && t.completedAt <= t.dueAt!).length;
    // Dia futuro: ainda não avaliado. Hoje: só as que já venceram ou já foram entregues contam.
    const evaluated = future ? [] : key === today ? ofDay.filter((t) => (t.status === "concluida" && t.completedAt) || t.dueAt! < now.toISOString()) : ofDay;
    const okEvaluated = evaluated.filter((t) => t.status === "concluida" && t.completedAt && t.completedAt <= t.dueAt!).length;
    due += evaluated.length;
    onTime += okEvaluated;
    days.push({ key, label: `${WEEKDAY_LABELS[d.getUTCDay()]} ${key.slice(8, 10)}/${key.slice(5, 7)}`, due: ofDay.length, onTime: ok, rate: evaluated.length > 0 ? okEvaluated / evaluated.length : null, future });
  }
  const first = days[0].key;
  const last = days[4].key;
  return { label: `Semana atual (${first.slice(8, 10)}/${first.slice(5, 7)} a ${last.slice(8, 10)}/${last.slice(5, 7)})`, days, target, overall: due > 0 ? onTime / due : null };
}

function resultFor(status: KpiStatus | null): MemberRow["result"] {
  if (status === "atingida") return { label: "Acima da meta", tone: "success" };
  if (status === "atencao") return { label: "No caminho", tone: "info" };
  if (status === "critico") return { label: "Abaixo da meta", tone: "danger" };
  return { label: "Sem meta", tone: "neutral" };
}

export async function getManagerDashboard(user: CurrentUser, options: { departamento?: string; period: Period }): Promise<ManagerDashboard> {
  const { period } = options;
  const { users, departments } = await loadOrg();
  const scope = scopeFrom(user, options.departamento, users, departments);
  const memberIds = scope.members.map((m) => m.id);
  const memberSet = new Set(memberIds);

  const backlogKeys = (dep: DepartmentKey) => (dep === "suporte" ? ["backlog_suporte"] : dep === "implantacao" ? ["backlog_implantacao"] : []);
  const backlogDeps = scope.departments.filter((d) => backlogKeys(d).length > 0);
  const [data, points, scorecards, userScorecards, insights, productivityBatch, sla, indexConfig, projects, backlogBatch, refs] = await Promise.all([
    loadOperational(memberIds),
    list<GamificationPoints>(COLLECTIONS.gamificationPoints, { where: [["period", "==", period.key]] }),
    Promise.all(scope.departments.map((d) => getDepartmentScorecard(d, period, { withSources: false }))),
    Promise.all(scope.members.map((m) => getUserScorecard(m.id, period, { withTrend: false, withSources: false }))),
    scope.kind === "empresa" ? evaluateInsights({ period, scope: "empresa" }) : evaluateInsightsForDepartments(period, scope.departments),
    memberIds.length > 0 ? computeKpiBatch(memberIds.map((id) => ({ keys: ["tarefas_no_prazo_pct"], scope: "usuario" as const, scopeId: id })), period, { withTrend: false, withSources: false }) : Promise.resolve([] as KpiResult[][]),
    getSlaSummary(period, { ownerIds: memberIds }),
    getPerformanceIndexConfig(),
    list<ImplementationProject>(COLLECTIONS.implementationProjects),
    backlogDeps.length > 0 ? computeKpiBatch(backlogDeps.map((d) => ({ keys: backlogKeys(d), scope: "departamento" as const, scopeId: d })), period, { withTrend: false, withSources: false }) : Promise.resolve([] as KpiResult[][]),
    getSetting<{ slaSuporte?: number }>("metas_referencia", { slaSuporte: 0.9 }),
  ]);

  const now = new Date();
  const today = todayKey();
  const clients = criticalClients(data, memberSet, today);
  const stepRows = data.steps.filter((s) => s.assigneeId && memberSet.has(s.assigneeId)).map((s) => toStepRow(s, s.slaInstanceId ? data.stepSlas.get(s.slaInstanceId) : undefined, now));
  const slaRows = data.slas.map((s) => toSlaRow(s, now));

  // Ranking de pontos da organização no período.
  const pointsByUser = new Map<string, number>();
  for (const p of points) pointsByUser.set(p.userId, (pointsByUser.get(p.userId) ?? 0) + p.points);
  const ranking = Array.from(pointsByUser.entries()).filter(([, v]) => v > 0).sort((a, b) => b[1] - a[1]).map(([id]) => id);

  const openByUser = new Map<string, number>();
  for (const t of data.tasks) if (t.assigneeId && isOpenStatus(t.status)) openByUser.set(t.assigneeId, (openByUser.get(t.assigneeId) ?? 0) + 1);
  const teamAverageOpen = memberIds.length > 0 ? memberIds.reduce((s, id) => s + (openByUser.get(id) ?? 0), 0) / memberIds.length : 0;

  const slaByOwner = new Map(sla.byOwner.map((r) => [r.key, r]));
  const periodTasks = (tasks: Task[]) => {
    const done = tasks.filter((t) => t.status === "concluida" && inPeriod(t.completedAt, period)).length;
    const pendingDue = tasks.filter((t) => isOpenStatus(t.status) && t.dueAt && t.dueAt < period.end).length;
    return { done, total: done + pendingDue };
  };

  const members: MemberRow[] = scope.members.map((m, i) => {
    const tasks = data.tasks.filter((t) => t.assigneeId === m.id);
    const open = tasks.filter((t) => isOpenStatus(t.status)).length;
    const card = userScorecards[i];
    const index = card ? indexFromScorecard(m, card, indexConfig) : null;
    const mine = periodTasks(tasks);
    return {
      tasksDone: mine.done,
      tasksTotal: mine.total,
      slaRate: slaByOwner.get(m.id)?.rate ?? null,
      quality: index?.dimensions.find((d) => d.key === "qualidade")?.score ?? null,
      performanceIndex: index?.score ?? null,
      result: resultFor(statusFor(card?.overallAttainment ?? null)),
      id: m.id,
      name: m.name,
      avatarUrl: m.avatarUrl,
      jobTitle: m.jobTitle,
      roleLabel: ROLE_LABELS[m.role],
      departmentId: m.departmentId,
      departmentLabel: DEPARTMENT_LABELS[m.departmentId],
      openTasks: open,
      overdueTasks: tasks.filter((t) => isOverdue(t, today)).length,
      completedInPeriod: tasks.filter((t) => t.status === "concluida" && inPeriod(t.completedAt, period)).length,
      load: teamAverageOpen > 0 ? open / teamAverageOpen : null,
      slaAtRisk: slaRows.filter((s) => s.ownerId === m.id && RISK_STATES.has(s.view.state)).length,
      stalledSteps: stepRows.filter((s) => s.assigneeId === m.id && s.stalled).length,
      criticalClients: clients.filter((c) => c.memberIds.includes(m.id)).length,
      criticalGoals: card?.items.filter((r) => r.status === "critico").length ?? 0,
      attainment: card?.overallAttainment ?? null,
      attainmentStatus: statusFor(card?.overallAttainment ?? null),
      achieved: card?.achieved ?? 0,
      withTarget: card?.withTarget ?? 0,
      points: pointsByUser.get(m.id) ?? 0,
      rank: ranking.indexOf(m.id) >= 0 ? ranking.indexOf(m.id) + 1 : null,
    };
  });

  const criticalKpis = scorecards.flatMap((s) => s.items.filter((r) => r.status === "critico"));
  const teamClients = scope.kind === "empresa" ? clients : clients.filter((c) => c.memberIds.length > 0);

  const tasksByUser: Record<string, ReassignTask[]> = {};
  for (const t of data.tasks.filter((x) => isOpenStatus(x.status)).sort((a, b) => ((a.dueAt ?? "9999") < (b.dueAt ?? "9999") ? -1 : 1))) {
    if (!t.assigneeId) continue;
    (tasksByUser[t.assigneeId] ??= []).push({ id: t.id, title: t.title, dueLabel: t.dueAt ? dateLabel(t.dueAt, today) : undefined, overdue: isOverdue(t, today), clientName: t.clientName, priority: t.priority });
  }
  const targets = [...scope.members, ...(memberSet.has(user.id) ? [] : [user])].map((u) => ({ id: u.id, name: u.name, subtitle: u.jobTitle ?? DEPARTMENT_LABELS[u.departmentId] })).sort(byName);

  const stats: Record<FocusKey, number> = {
    atrasadas: members.reduce((s, m) => s + m.overdueTasks, 0),
    sla: slaRows.filter((s) => RISK_STATES.has(s.view.state)).length,
    etapas: stepRows.filter((s) => s.stalled).length,
    clientes: teamClients.length,
    metas: criticalKpis.length,
  };

  // Produtividade: numerador/denominador do indicador tarefas_no_prazo_pct de cada colaborador (mesma fórmula do motor).
  const productivityResults = productivityBatch.map((r) => r[0]).filter((r): r is KpiResult => Boolean(r));
  const prodMet = productivityResults.reduce((s, r) => s + (r.numerator ?? 0), 0);
  const prodTotal = productivityResults.reduce((s, r) => s + (r.denominator ?? 0), 0);
  const prodTarget = productivityResults.find((r) => r.target !== null)?.target ?? null;
  const prodRate = prodTotal > 0 ? prodMet / prodTotal : null;
  const allTasks = periodTasks(data.tasks);

  const goals: DepartmentGoalRow[] = scorecards.flatMap((card) =>
    card.items
      .filter((r) => r.target !== null)
      .map((r) => ({
        key: `${card.subject.id}-${r.key}`,
        label: scorecards.length > 1 ? `${r.kpi.name} · ${card.subject.name}` : r.kpi.name,
        department: card.subject.id as DepartmentKey,
        value: formatKpiValue(r.value, r.kpi.unit, r.kpi.formulaMeta?.suffix),
        target: formatKpiValue(r.target, r.kpi.unit, r.kpi.formulaMeta?.suffix),
        attainment: r.attainment,
        status: r.status,
        href: r.href,
      })),
  );

  // Alertas do gestor.
  const alerts: ManagerAlert[] = [];
  const oneDep = scope.kind === "departamento" ? scope.department : undefined;
  if (sla.dueNextHour.length > 0) {
    alerts.push({ key: "sla-1h", kind: "sla", tone: "danger", title: `${sla.dueNextHour.length} SLA(s) vencem em até 1 hora`, detail: sla.dueNextHour.slice(0, 3).map((i) => `${i.reference === "Tarefa" || i.reference === "Etapa" ? i.title : i.reference}${i.ownerName ? ` · ${i.ownerName.split(" ")[0]}` : ""}`).join(" · "), href: slaPageHref({ janela: "1h", departamento: oneDep, periodo: period.key }) });
  }
  for (const m of members.filter((x) => x.load !== null && x.load > OVERLOAD_RATIO).sort((a, b) => (b.load ?? 0) - (a.load ?? 0)).slice(0, 3)) {
    alerts.push({ key: `load-${m.id}`, kind: "capacidade", tone: "danger", title: `${m.name.split(" ")[0]} está com ${Math.round((m.load ?? 0) * 100)}% da carga média`, detail: `${m.openTasks} tarefas abertas · média da equipe ${teamAverageOpen.toFixed(1).replace(".", ",")}`, href: `/gestao/equipe/${m.id}` });
  }
  const nowIso = now.toISOString();
  const lateProjects = projects.filter((p) => p.status !== "concluida" && p.status !== "cancelada" && p.dueDate && p.dueDate < nowIso && (memberSet.has(p.ownerId) || (scope.kind !== "equipe" && scope.departments.includes("implantacao"))));
  if (lateProjects.length > 0) {
    alerts.push({ key: "impl-late", kind: "implantacao", tone: "warning", title: `${lateProjects.length} implantação(ões) atrasada(s)`, detail: lateProjects.slice(0, 3).map((p) => p.name).join(" · "), href: "/implantacao?atrasadas=1" });
  }
  backlogDeps.forEach((dep, i) => {
    const r = backlogBatch[i]?.[0];
    if (!r || r.value === null || r.target === null || r.value <= r.target) return;
    alerts.push({ key: `backlog-${dep}`, kind: "backlog", tone: "warning", title: `${r.kpi.name} elevado: ${formatKpiValue(r.value, r.kpi.unit)} (meta até ${formatKpiValue(r.target, r.kpi.unit)})`, href: r.href });
  });
  for (const r of criticalKpis.slice(0, 3)) {
    alerts.push({ key: `meta-${r.scopeId ?? ""}-${r.key}`, kind: "meta", tone: "warning", title: `${r.kpi.name} abaixo do esperado`, detail: `${formatKpiValue(r.value, r.kpi.unit, r.kpi.formulaMeta?.suffix)} de ${formatKpiValue(r.target, r.kpi.unit, r.kpi.formulaMeta?.suffix)} (${r.attainment !== null ? Math.round(r.attainment * 100) : "—"}%)`, href: r.href });
  }

  return {
    scope,
    period,
    stats,
    summary: {
      members: members.length,
      productivity: { rate: prodRate, met: prodMet, total: prodTotal, target: prodTarget, status: statusFor(prodRate === null || prodTarget === null ? null : prodRate / prodTarget) },
      sla: { rate: sla.compliance.rate, met: sla.compliance.met, evaluated: sla.compliance.evaluated, target: typeof refs.slaSuporte === "number" ? refs.slaSuporte : 0.9 },
      tasks: allTasks,
      pending: stats.atrasadas + stats.sla + stats.etapas + stats.clientes + stats.metas,
    },
    week: teamWeek(data.tasks, now, prodTarget),
    goals,
    alerts,
    members,
    teamAverageOpen,
    criticalClients: teamClients,
    criticalKpis,
    scorecards,
    insights,
    reassign: { targets, tasksByUser },
  };
}

// ---------------------------------------------------------------------------
// Visão do colaborador (/gestao/equipe/[userId])
// ---------------------------------------------------------------------------

export interface BonusProjection {
  projectedAmount: number | null;
  payoutPct: number | null;
  tierLabel: string | null;
  overallAttainment: number | null;
  blocked: boolean;
  blockReason?: string;
  extrasAmount: number | null;
}

export interface MemberEvent {
  id: string;
  title: string;
  description?: string;
  occurredAt: string;
  occurredLabel: string;
  href?: string;
}

export interface TeamMemberView {
  member: { id: string; name: string; avatarUrl?: string; jobTitle?: string; roleLabel: string; departmentId: DepartmentKey; departmentLabel: string; email: string; managerName?: string };
  period: Period;
  tasks: { overdue: TaskRow[]; open: TaskRow[]; waiting: TaskRow[]; completed: TaskRow[]; counts: Record<TaskStatus, number> };
  slas: SlaRow[];
  steps: StepRow[];
  clients: { id: string; name: string; roles: string[]; healthScore?: number; healthLevel?: Client["healthLevel"]; mrr: number; critical: string[]; href: string }[];
  scorecard: Scorecard | null;
  bonus: BonusProjection | null;
  events: MemberEvent[];
  reassignTargets: { id: string; name: string; subtitle: string }[];
}

function num(value: unknown): number | null {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

/**
 * Bônus projetado pelo motor de bônus da Performance (src/server/performance/bonus.ts, construído em
 * paralelo). Import dinâmico: se o módulo ou a função não existirem, ou o cálculo falhar, a seção some.
 */
async function loadBonusProjection(userId: string, period: Period): Promise<BonusProjection | null> {
  try {
    // Caminho como string: o módulo é de outro agente e pode mudar de assinatura; lemos os campos defensivamente.
    const mod = (await import("@/server/performance/bonus" as string)) as { computeBonus?: (userId: string, period: Period | string) => Promise<unknown> };
    if (typeof mod.computeBonus !== "function") return null;
    const raw = await mod.computeBonus(userId, period);
    if (!raw || typeof raw !== "object") return null;
    const r = raw as Record<string, unknown>;
    const tier = r.tier && typeof r.tier === "object" ? (r.tier as Record<string, unknown>) : {};
    const blocks = Array.isArray(r.blocks) ? (r.blocks as Record<string, unknown>[]) : [];
    return {
      projectedAmount: num(r.totalAmount) ?? num(r.projectedAmount),
      payoutPct: num(r.payoutPct) ?? num(tier.payoutPct),
      tierLabel: typeof tier.label === "string" ? tier.label : typeof r.tierLabel === "string" ? r.tierLabel : null,
      overallAttainment: num(r.overallAttainment),
      blocked: r.blocked === true,
      blockReason: typeof blocks[0]?.reason === "string" ? (blocks[0].reason as string) : undefined,
      extrasAmount: num(r.extrasAmount),
    };
  } catch (error) {
    console.error("[gestao] bônus projetado indisponível", error);
    return null;
  }
}

function eventHref(e: DomainEvent): string | undefined {
  if (e.entityType === "task" && e.entityId) return `/tarefas?tarefa=${e.entityId}`;
  if (e.entityType === "workflow_step" && e.entityId) return `/workflow?etapa=${e.entityId}`;
  if (e.clientId) return `/clientes/${e.clientId}?aba=timeline`;
  return undefined;
}

export async function getTeamMemberView(user: CurrentUser, memberId: string, period: Period): Promise<TeamMemberView | null> {
  const { users, departments } = await loadOrg();
  if (!canManageMember(user, memberId, users)) return null;
  const member = users.find((u) => u.id === memberId);
  if (!member) return null;

  const [data, scorecard, bonus, ownEvents, assignedEvents] = await Promise.all([
    loadOperational([memberId]),
    getUserScorecard(memberId, period, { withSources: false }),
    loadBonusProjection(memberId, period),
    list<DomainEvent>(COLLECTIONS.events, { where: [["actorId", "==", memberId]] }),
    list<DomainEvent>(COLLECTIONS.events, { where: [["payload.assigneeId", "==", memberId]] }),
  ]);

  const now = new Date();
  const today = todayKey();
  const rows = data.tasks.map((t) => toTaskRow(t, today));
  const counts = { aberta: 0, em_andamento: 0, aguardando: 0, concluida: 0, cancelada: 0 } as Record<TaskStatus, number>;
  for (const t of data.tasks) counts[t.status] += 1;

  const memberSet = new Set([memberId]);
  const critical = new Map(criticalClients(data, memberSet, today).map((c) => [c.id, c]));
  const ticketsClients = new Set(data.tickets.filter((t) => t.assigneeId === memberId).map((t) => t.clientId));
  const stepClients = new Set(data.steps.filter((s) => s.assigneeId === memberId).map((s) => s.clientId));
  const clients = data.clients
    .filter((c) => c.status !== "cancelado")
    .map((c) => {
      const roles: string[] = [];
      if (c.ownerSalesId === memberId) roles.push("Vendas");
      if (c.ownerImplementationId === memberId) roles.push("Implantação");
      if (c.ownerCsId === memberId) roles.push("CS");
      if (ticketsClients.has(c.id)) roles.push("Chamado aberto");
      if (stepClients.has(c.id)) roles.push("Etapa de workflow");
      return { c, roles };
    })
    .filter((x) => x.roles.length > 0)
    .map(({ c, roles }) => ({ id: c.id, name: c.tradeName, roles, healthScore: c.healthScore, healthLevel: c.healthLevel, mrr: c.mrr, critical: critical.get(c.id)?.reasons ?? [], href: `/clientes/${c.id}` }))
    .sort((a, b) => b.critical.length - a.critical.length || b.mrr - a.mrr);

  const events = new Map<string, DomainEvent>();
  for (const e of [...ownEvents, ...assignedEvents]) events.set(e.id, e);
  const recent = Array.from(events.values())
    .sort((a, b) => (a.occurredAt < b.occurredAt ? 1 : -1))
    .slice(0, 20)
    .map((e) => ({ id: e.id, title: e.title, description: e.description, occurredAt: e.occurredAt, occurredLabel: dateLabel(e.occurredAt, today), href: eventHref(e) }));

  const manager = member.managerId ? users.find((u) => u.id === member.managerId) : undefined;
  const scope = scopeFrom(user, user.isDirector ? member.departmentId : undefined, users, departments);
  const reassignTargets = [...scope.members, user]
    .filter((u, i, arr) => u.id !== memberId && arr.findIndex((x) => x.id === u.id) === i)
    .map((u) => ({ id: u.id, name: u.name, subtitle: u.jobTitle ?? DEPARTMENT_LABELS[u.departmentId] }))
    .sort(byName);

  return {
    member: { id: member.id, name: member.name, avatarUrl: member.avatarUrl, jobTitle: member.jobTitle, roleLabel: ROLE_LABELS[member.role], departmentId: member.departmentId, departmentLabel: DEPARTMENT_LABELS[member.departmentId], email: member.email, managerName: manager?.name },
    period,
    tasks: {
      overdue: rows.filter((t) => t.overdue).sort(sortByDue),
      open: rows.filter((t) => !t.overdue && (t.status === "aberta" || t.status === "em_andamento")).sort(sortByDue),
      waiting: rows.filter((t) => !t.overdue && t.status === "aguardando").sort(sortByDue),
      completed: rows.filter((t) => t.status === "concluida" && inPeriod(t.completedAt, period)).sort((a, b) => ((a.completedAt ?? "") < (b.completedAt ?? "") ? 1 : -1)),
      counts,
    },
    slas: data.slas.map((s) => toSlaRow(s, now)).sort((a, b) => SLA_SEVERITY[a.view.state] - SLA_SEVERITY[b.view.state] || a.view.remainingMs - b.view.remainingMs),
    steps: data.steps
      .filter((s) => s.assigneeId === memberId)
      .map((s) => toStepRow(s, s.slaInstanceId ? data.stepSlas.get(s.slaInstanceId) : undefined, now))
      .sort((a, b) => Number(b.stalled) - Number(a.stalled) || b.daysIdle - a.daysIdle),
    clients,
    scorecard,
    bonus,
    events: recent,
    reassignTargets,
  };
}

/** Nome do colaborador para metadados da página (sem checagem de escopo). */
export async function getMemberName(memberId: string): Promise<string | null> {
  const u = await getById<User>(COLLECTIONS.users, memberId);
  return u?.name ?? null;
}

// ---------------------------------------------------------------------------
// Cockpit da Diretoria
// ---------------------------------------------------------------------------

export type StageHealth = "verde" | "ambar" | "vermelho" | "neutro";

/** Métrica operacional (volume que não é indicador do registro), com link de drill-down. */
export interface OperationalMetric {
  key: string;
  label: string;
  value: number | null;
  unit: KpiUnit;
  href: string;
  hint?: string;
  status?: KpiStatus | null;
}

export type StageMetric = { kind: "kpi"; label?: string; result: KpiResult } | { kind: "op"; metric: OperationalMetric };

export interface CockpitStage {
  department: DepartmentKey;
  label: string;
  manager?: { id: string; name: string };
  health: StageHealth;
  healthReason: string;
  metrics: StageMetric[];
}

export interface CockpitHandoff {
  from: DepartmentKey;
  to: DepartmentKey;
  label: string;
  rate: number | null;
  numerator: number;
  denominator: number;
  rateHref: string;
  description: string;
  /** Etapas abertas do estágio de origem com SLA violado. */
  stuck: number;
  atRisk: number;
  stuckHref: string;
}

export interface FunnelStep {
  key: string;
  label: string;
  value: number;
  href: string;
}

export interface CockpitDepartmentRow {
  department: DepartmentKey;
  label: string;
  manager?: { id: string; name: string };
  /** Indicador principal do departamento (aba Diretoria da planilha) com meta e realizado. */
  principal: KpiResult | null;
  /** Atingimento médio das metas do scorecard do departamento. */
  attainment: number | null;
  status: KpiStatus | null;
  productivity: number | null;
  sla: number | null;
  href: string;
}

export interface Cockpit {
  period: Period;
  previous: Period;
  current: boolean;
  strip: {
    mrr: KpiResult | null;
    newSales: KpiResult | null;
    soldRevenue: KpiResult | null;
    activeClients: KpiResult | null;
    received: KpiResult | null;
    globalGoal: { attainment: number | null; previous: number | null; count: number; href: string };
  };
  health: OperationHealth;
  departments: CockpitDepartmentRow[];
  salesFunnel: { leads: number | null; qualified: number | null; proposals: number; sales: number | null; conversion: number | null; hrefs: { leads: string; qualified: string; proposals: string; sales: string } };
  operation: {
    implementation: { inProgress: number; late: number; href: string; lateHref: string };
    support: { opened: KpiResult | null; backlog: number; sla: KpiResult | null };
    finance: { delinquency: KpiResult | null };
  };
  company: KpiResult[];
  stages: CockpitStage[];
  handoffs: CockpitHandoff[];
  bottlenecks: Insight[];
  mrrHistory: HistoryPoint[];
  revenueHistory: HistoryPoint[];
  funnel: FunnelStep[];
}

const COMPANY_KEYS = ["clientes_ativos", "faturamento", "mrr", "novas_vendas", "churn", "clientes_risco"];

const STAGE_KPIS: Record<string, { key: string; label?: string }[]> = {
  marketing: [{ key: "leads_captados", label: "Leads" }, { key: "cpl", label: "CPL" }, { key: "mqls", label: "MQLs" }, { key: "conversao_mql", label: "Conversão em MQL" }],
  vendas: [{ key: "novas_vendas", label: "Vendas" }, { key: "conversao_funil", label: "Conversão" }, { key: "ticket_medio", label: "Ticket médio" }, { key: "oportunidades_paradas", label: "Oportunidades paradas" }],
  financeiro: [{ key: "contratos_assinados", label: "Contratos assinados" }, { key: "faturamento", label: "Receita (faturamento)" }, { key: "mrr", label: "Recorrência (MRR)" }],
  implantacao: [{ key: "backlog_implantacao", label: "Projetos ativos" }, { key: "tempo_medio_implantacao", label: "Tempo médio" }, { key: "implantacoes_concluidas", label: "Go-lives" }, { key: "entregas_prazo", label: "No prazo" }],
  cs: [{ key: "saude_cliente", label: "Saúde média" }, { key: "clientes_risco", label: "Em risco" }, { key: "adocao_media", label: "Adoção" }, { key: "taxa_renovacao", label: "Renovação" }, { key: "upsell_gerado", label: "Upsell" }],
  suporte: [{ key: "chamados_abertos", label: "Chamados" }, { key: "sla_solucao", label: "SLA de solução" }, { key: "csat", label: "CSAT" }, { key: "reincidencia", label: "Reincidência" }],
};

const EXTRA_KPIS = ["inadimplencia", "conversao_mql_oportunidade", "leads_captados", "mqls", "implantacoes_concluidas", "recebido", "receita_vendida", "backlog_suporte"];

const HANDOFF_LABELS: Record<string, string> = {
  marketing: "MQL → oportunidade",
  vendas: "Ganho → contrato liberado",
  financeiro: "Liberado → go-live",
  implantacao: "Go-live → cliente ativado",
  cs: "Clientes ativos → chamados",
};

function opportunityValue(o: { setupTotal: number; monthlyTotal: number; hardwareTotal: number }): number {
  return (o.setupTotal || 0) + (o.monthlyTotal || 0) + (o.hardwareTotal || 0);
}

/** Saúde do estágio: vermelho com metade ou mais dos indicadores críticos; âmbar com algum crítico/atenção. */
function stageHealth(metrics: StageMetric[]): { health: StageHealth; reason: string } {
  const statuses = metrics.map((m) => (m.kind === "kpi" ? m.result.status : (m.metric.status ?? null))).filter((s): s is KpiStatus => s !== null);
  if (statuses.length === 0) return { health: "neutro", reason: "Nenhum indicador com meta neste estágio" };
  const critical = statuses.filter((s) => s === "critico").length;
  const attention = statuses.filter((s) => s === "atencao").length;
  const summary = `${critical} crítico(s), ${attention} em atenção, ${statuses.length - critical - attention} atingido(s)`;
  if (critical * 2 >= statuses.length) return { health: "vermelho", reason: summary };
  if (critical + attention > 0) return { health: "ambar", reason: summary };
  return { health: "verde", reason: summary };
}

function workflowRiskHref(dep: DepartmentKey): string {
  return `/workflow?departamento=${dep}&dep=${dep}&sla=risco`;
}

/**
 * Cockpit: faixa da empresa, cadeia Marketing → Vendas → Financeiro → Implantação → CS → Suporte com a
 * saúde de cada estágio, taxas de passagem e volume parado nos handoffs, gargalos (insights), histórico de
 * MRR e receita e o funil do período. Uma carga de dados do motor (computeKpiBatch + DataBundle).
 */
export async function getCockpit(period: Period): Promise<Cockpit> {
  const stageKeys = Object.values(STAGE_KPIS).flat().map((k) => k.key);
  const previous = previousPeriod(period);
  const kpiDocs = await loadKpiDocs();
  const depKeys = (dep: DepartmentKey) => Array.from(new Set([...(SCORECARD_KEYS[dep] ?? []), ...kpiDocs.filter((d) => d.department === dep && d.active !== false).map((d) => d.key)]));
  const [[results, ...depResults], bundle, mrrHistory, revenueHistory, bottlenecks, org, health, globalGoal, previousGoal, sla, proposals, principal] = await Promise.all([
    computeKpiBatch(
      [
        { keys: Array.from(new Set([...COMPANY_KEYS, ...stageKeys, ...EXTRA_KPIS])), scope: "empresa" },
        ...OPERATIONAL_DEPARTMENTS.map((dep) => ({ keys: [...depKeys(dep), "tarefas_no_prazo_pct"], scope: "departamento" as const, scopeId: dep })),
      ],
      period,
      { withSources: false },
    ),
    loadDataBundle(period),
    getHistory("mrr", "empresa", undefined, 8),
    getHistory("faturamento", "empresa", undefined, 8),
    evaluateInsights({ period, scope: "empresa" }),
    loadOrg(),
    computeOperationHealth(period, { kind: "empresa" }),
    goalsAttainment(period, { kind: "empresa" }, { companyOnly: true }),
    previous.kind === "mes" ? goalsAttainment(previous, { kind: "empresa" }, { companyOnly: true }) : Promise.resolve(null),
    getSlaSummary(period),
    list<Proposal>(COLLECTIONS.proposals),
    getCompanyScorecard(period),
  ]);
  const byKey = new Map(results.map((r) => [r.key, r]));
  const now = new Date(bundle.now);
  const ref = periodReference(period, now);
  const current = isCurrentPeriod(period, now);
  const snapshotHint = current ? undefined : "Fotografia atual (não reconstruída para o período)";

  // Volumes operacionais a partir do mesmo DataBundle dos indicadores.
  const open = bundle.opportunities.filter((o) => o.stage !== "ganho" && o.stage !== "perdido");
  const pipeline = open.reduce((s, o) => s + opportunityValue(o), 0);
  const forecastBase = open.filter((o) => o.nextActionAt && o.nextActionAt < period.end);
  const forecast = forecastBase.reduce((s, o) => s + opportunityValue(o) * ((o.probability || 0) / 100), 0);
  const pendingContracts = bundle.contracts.filter((c) => c.status === "pendencia" || c.financialStatus === "pendencia").length;
  const openProjects = bundle.projects.filter((p) => p.status !== "concluida" && p.status !== "cancelada");
  const lateProjects = openProjects.filter((p) => p.dueDate && p.dueDate < ref).length;
  const waitingClient = openProjects.filter((p) => p.status === "aguardando_cliente").length;
  const supportChurn = bundle.churn.filter((r) => r.reasonCategory === "tecnico" && inPeriod(r.date, period));
  const delinquency = byKey.get("inadimplencia");

  const kpi = (key: string, label?: string): StageMetric[] => {
    const r = byKey.get(key);
    return r ? [{ kind: "kpi", label, result: r }] : [];
  };
  const op = (metric: OperationalMetric): StageMetric => ({ kind: "op", metric });

  const stageMetrics: Record<string, StageMetric[]> = {
    marketing: STAGE_KPIS.marketing.flatMap((k) => kpi(k.key, k.label)),
    vendas: [
      op({ key: "pipeline", label: "Pipeline aberto", value: pipeline, unit: "moeda", href: "/vendas/pipeline", hint: `${open.length} oportunidade(s) abertas${snapshotHint ? " · agora" : ""}` }),
      ...STAGE_KPIS.vendas.flatMap((k) => kpi(k.key, k.label)),
      op({ key: "forecast", label: "Forecast", value: forecast, unit: "moeda", href: "/vendas/oportunidades", hint: `Valor × probabilidade de ${forecastBase.length} aberta(s) com próxima ação até o fim do período` }),
    ],
    financeiro: [
      ...STAGE_KPIS.financeiro.flatMap((k) => kpi(k.key, k.label)),
      op({ key: "vencidos", label: "Vencidos", value: delinquency?.numerator ?? null, unit: "moeda", href: delinquency?.href ?? kpiHref("inadimplencia", period), hint: delinquency?.value !== null && delinquency?.value !== undefined ? `Inadimplência de ${(delinquency.value * 100).toFixed(1).replace(".", ",")}%` : undefined, status: delinquency?.status ?? null }),
      op({ key: "pendencias", label: "Pendências financeiras", value: pendingContracts, unit: "numero", href: "/financeiro/contratos?status=pendencia", hint: "Contratos com pendência agora" }),
    ],
    implantacao: [
      ...STAGE_KPIS.implantacao.flatMap((k) => kpi(k.key, k.label)),
      op({ key: "atrasos", label: "Projetos atrasados", value: lateProjects, unit: "numero", href: "/implantacao?atrasadas=1", hint: "Abertos com prazo vencido", status: lateProjects > 0 ? "atencao" : null }),
      op({ key: "pendencias_cliente", label: "Pendências do cliente", value: waitingClient, unit: "numero", href: "/implantacao?status=aguardando_cliente", hint: "Projetos aguardando o cliente agora" }),
    ],
    cs: STAGE_KPIS.cs.flatMap((k) => kpi(k.key, k.label)),
    suporte: [
      ...STAGE_KPIS.suporte.flatMap((k) => kpi(k.key, k.label)),
      op({ key: "churn_suporte", label: "Churn por motivo técnico", value: supportChurn.length, unit: "numero", href: "/cs/churn", hint: supportChurn.length > 0 ? `${formatCurrency(supportChurn.reduce((s, r) => s + r.lostMrr, 0))} de MRR perdido` : "Cancelamentos por motivo técnico no período", status: supportChurn.length > 0 ? "critico" : null }),
    ],
  };

  const managers = new Map(org.departments.map((d) => [d.key, d.managerId]));
  const stages: CockpitStage[] = OPERATIONAL_DEPARTMENTS.map((dep) => {
    const metrics = stageMetrics[dep] ?? [];
    const { health, reason } = stageHealth(metrics);
    const managerId = managers.get(dep);
    const manager = managerId ? org.users.find((u) => u.id === managerId) : undefined;
    return { department: dep, label: DEPARTMENT_LABELS[dep], manager: manager ? { id: manager.id, name: manager.name } : undefined, health, healthReason: reason, metrics };
  });

  // Volume parado nos handoffs: etapas abertas do estágio de origem com SLA violado / em risco.
  const stuckBy = new Map<DepartmentKey, { violated: number; risk: number }>();
  for (const step of bundle.workflowSteps) {
    if (!OPEN_STEP_STATUSES.includes(step.status) || !step.slaInstanceId) continue;
    const sla = bundle.stepSla.get(step.slaInstanceId);
    if (!sla) continue;
    const state = computeSlaState(sla, now).state;
    const entry = stuckBy.get(step.department) ?? { violated: 0, risk: 0 };
    if (state === "violado") entry.violated += 1;
    else if (state === "em_risco") entry.risk += 1;
    stuckBy.set(step.department, entry);
  }

  // Taxas de passagem.
  const mqlToOpp = byKey.get("conversao_mql_oportunidade");
  const won = bundle.opportunities.filter((o) => o.stage === "ganho" && inPeriod(o.wonAt, period));
  const contractOf = (oppId: string, contractId?: string) => (contractId ? bundle.contractById.get(contractId) : undefined) ?? bundle.contracts.find((c) => c.opportunityId === oppId);
  const wonReleased = won.filter((o) => Boolean(contractOf(o.id, o.contractId)?.releasedAt));
  const released = bundle.contracts.filter((c) => inPeriod(c.releasedAt, period));
  const releasedLive = released.filter((c) => bundle.projects.some((p) => (p.contractId === c.id || (!p.contractId && p.clientId === c.clientId)) && p.goLiveAt && p.goLiveAt <= ref));
  const goLives = bundle.projects.filter((p) => inPeriod(p.goLiveAt, period));
  const activated = goLives.filter((p) => {
    const client = bundle.clientById.get(p.clientId);
    const account = bundle.csAccounts.find((a) => a.clientId === p.clientId);
    return Boolean(client?.activatedAt ?? account?.activatedAt);
  });
  const activeClients = bundle.clients.filter((c) => c.status === "ativo");
  const withTickets = new Set(bundle.tickets.filter((t) => inPeriod(t.openedAt, period)).map((t) => t.clientId));
  const activeWithTickets = activeClients.filter((c) => withTickets.has(c.id));

  const rate = (n: number, d: number) => (d > 0 ? n / d : null);
  const passage: Record<string, { n: number; d: number; href: string; description: string; rate?: number | null }> = {
    marketing: { n: mqlToOpp?.numerator ?? 0, d: mqlToOpp?.denominator ?? 0, rate: mqlToOpp?.value ?? null, href: mqlToOpp?.href ?? kpiHref("conversao_mql_oportunidade", period), description: "MQLs do período que já viraram oportunidade" },
    vendas: { n: wonReleased.length, d: won.length, href: "/financeiro/contratos", description: "Vendas ganhas no período com contrato liberado pelo Financeiro" },
    financeiro: { n: releasedLive.length, d: released.length, href: "/implantacao/go-live", description: "Contratos liberados no período com go-live realizado" },
    implantacao: { n: activated.length, d: goLives.length, href: "/cs", description: "Go-lives do período com cliente ativado pelo CS" },
    cs: { n: activeWithTickets.length, d: activeClients.length, href: "/suporte/chamados", description: "Clientes ativos que abriram chamado no período (demanda para o Suporte)" },
  };

  const handoffs: CockpitHandoff[] = OPERATIONAL_DEPARTMENTS.slice(0, -1).map((from, i) => {
    const to = OPERATIONAL_DEPARTMENTS[i + 1];
    const p = passage[from];
    const stuck = stuckBy.get(from) ?? { violated: 0, risk: 0 };
    return {
      from,
      to,
      label: HANDOFF_LABELS[from],
      rate: p.rate !== undefined ? p.rate : rate(p.n, p.d),
      numerator: p.n,
      denominator: p.d,
      rateHref: p.href,
      description: p.description,
      stuck: stuck.violated,
      atRisk: stuck.risk,
      stuckHref: workflowRiskHref(from),
    };
  });

  const created = bundle.opportunities.filter((o) => inPeriod(o.createdAt, period)).length;
  const activatedInPeriod = bundle.clients.filter((c) => inPeriod(c.activatedAt, period)).length;
  const funnel: FunnelStep[] = [
    { key: "leads", label: "Leads", value: byKey.get("leads_captados")?.value ?? 0, href: kpiHref("leads_captados", period) },
    { key: "mqls", label: "MQLs", value: byKey.get("mqls")?.value ?? 0, href: kpiHref("mqls", period) },
    { key: "oportunidades", label: "Oportunidades", value: created, href: "/vendas/oportunidades" },
    { key: "vendas", label: "Vendas", value: byKey.get("novas_vendas")?.value ?? 0, href: kpiHref("novas_vendas", period) },
    { key: "liberados", label: "Contratos liberados", value: released.length, href: "/financeiro/contratos" },
    { key: "golives", label: "Go-lives", value: byKey.get("implantacoes_concluidas")?.value ?? 0, href: kpiHref("implantacoes_concluidas", period) },
    { key: "ativados", label: "Clientes ativados", value: activatedInPeriod, href: "/cs" },
  ];

  // Desempenho por departamento: scorecard (atingimento), produtividade (tarefas no prazo) e SLA (tela /sla).
  const slaByDep = new Map(sla.byDepartment.map((r) => [r.key, r]));
  const departmentRows: CockpitDepartmentRow[] = OPERATIONAL_DEPARTMENTS.map((dep, i) => {
    const items = depResults[i] ?? [];
    const scorecardItems = items.filter((r) => r.key !== "tarefas_no_prazo_pct" || depKeys(dep).includes("tarefas_no_prazo_pct"));
    const { overallAttainment } = summarizeScorecard(scorecardItems);
    const row = principal.departments.find((d) => d.department === dep);
    return {
      department: dep,
      label: DEPARTMENT_LABELS[dep],
      manager: row?.manager,
      principal: row?.result ?? null,
      attainment: overallAttainment,
      status: statusFor(overallAttainment),
      productivity: items.find((r) => r.key === "tarefas_no_prazo_pct")?.value ?? null,
      sla: slaByDep.get(dep)?.rate ?? null,
      href: `/gestao?departamento=${dep}&periodo=${encodeURIComponent(period.key)}`,
    };
  });

  const proposalsInPeriod = proposals.filter((p) => (p.sentAt ? inPeriod(p.sentAt, period) : p.status !== "rascunho" && inPeriod(p.createdAt, period))).length;
  const leads = byKey.get("leads_captados")?.value ?? null;
  const sales = byKey.get("novas_vendas")?.value ?? null;
  const backlog = byKey.get("backlog_suporte")?.value ?? bundle.tickets.filter((t) => t.status === "aberto" || t.status === "em_atendimento" || t.status === "aguardando_cliente" || t.status === "reaberto").length;

  return {
    period,
    previous,
    current,
    strip: {
      mrr: byKey.get("mrr") ?? null,
      newSales: byKey.get("novas_vendas") ?? null,
      soldRevenue: byKey.get("receita_vendida") ?? null,
      activeClients: byKey.get("clientes_ativos") ?? null,
      received: byKey.get("recebido") ?? null,
      globalGoal: { attainment: globalGoal.attainment, previous: previousGoal?.attainment ?? null, count: globalGoal.count, href: globalGoal.href },
    },
    health,
    departments: departmentRows,
    salesFunnel: {
      leads,
      qualified: byKey.get("mqls")?.value ?? null,
      proposals: proposalsInPeriod,
      sales,
      conversion: leads && sales !== null ? sales / leads : null,
      hrefs: { leads: kpiHref("leads_captados", period), qualified: kpiHref("mqls", period), proposals: "/vendas/propostas", sales: kpiHref("novas_vendas", period) },
    },
    operation: {
      implementation: { inProgress: openProjects.length, late: lateProjects, href: "/implantacao", lateHref: "/implantacao?atrasadas=1" },
      support: { opened: byKey.get("chamados_abertos") ?? null, backlog: typeof backlog === "number" ? backlog : 0, sla: byKey.get("sla_solucao") ?? null },
      finance: { delinquency: delinquency ?? null },
    },
    company: COMPANY_KEYS.map((k) => byKey.get(k)).filter((r): r is KpiResult => Boolean(r)),
    stages,
    handoffs,
    bottlenecks,
    mrrHistory,
    revenueHistory,
    funnel,
  };
}
