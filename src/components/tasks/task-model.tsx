/**
 * Modelo de visualização da Central de Tarefas: tipos, views, filtros e ordenação.
 *
 * Módulo puro (sem React, sem firebase): é importado tanto pelas queries no servidor quanto
 * pelos client components, para que o filtro aplicado na URL produza o mesmo resultado nos dois lados.
 */
import { PRIORITIES, PRIORITY_WEIGHT, DEPARTMENT_KEYS, TASK_STATUS, type DepartmentKey, type Priority, type TaskStatus } from "@/domain/constants";
import type { Comment, SlaView, Task, TaskProcessType } from "@/domain/types";

// ---------------------------------------------------------------------------
// Views
// ---------------------------------------------------------------------------

export const TASK_VIEWS = ["minha", "equipe", "kanban", "calendario", "atrasadas", "concluidas"] as const;
export type TaskView = (typeof TASK_VIEWS)[number];

export const TASK_VIEW_LABELS: Record<TaskView, string> = {
  minha: "Minha lista",
  equipe: "Equipe",
  kanban: "Kanban",
  calendario: "Calendário",
  atrasadas: "Atrasadas",
  concluidas: "Concluídas",
};

export function parseTaskView(value: unknown): TaskView {
  return typeof value === "string" && (TASK_VIEWS as readonly string[]).includes(value) ? (value as TaskView) : "minha";
}

export const OPEN_STATUSES: readonly TaskStatus[] = ["aberta", "em_andamento", "aguardando"];
export const KANBAN_COLUMNS: readonly TaskStatus[] = ["aberta", "em_andamento", "aguardando", "concluida"];

export function isOpenStatus(status: TaskStatus): boolean {
  return OPEN_STATUSES.includes(status);
}

// ---------------------------------------------------------------------------
// Itens enriquecidos (calculados no servidor, em America/Sao_Paulo)
// ---------------------------------------------------------------------------

export type DueTone = "overdue" | "today" | "upcoming" | "none";

export interface TaskListItem extends Task {
  /** Estado do SLA calculado na leitura (null quando a tarefa não tem SLA). */
  sla: SlaView | null;
  assigneeAvatarUrl?: string;
  /** AAAA-MM-DD do prazo no fuso de São Paulo. */
  dueDayKey?: string;
  /** Prazo legível: "Hoje, 14:00", "Ontem, 09:30", "3 out, 17:00". */
  dueLabel?: string;
  /** Cor semântica do prazo. Atrasada = dia do prazo já passou (granularidade de dia). */
  dueTone: DueTone;
  completedLabel?: string;
  updatedLabel: string;
  checklistDone: number;
  checklistTotal: number;
}

export interface TaskCommentView extends Comment {
  createdAtLabel: string;
}

export interface TaskEventView {
  id: string;
  type: string;
  title: string;
  description?: string;
  actorName: string;
  occurredAt: string;
  occurredAtLabel: string;
}

export interface TaskDetail {
  task: TaskListItem;
  comments: TaskCommentView[];
  events: TaskEventView[];
  creatorName?: string;
  processHref?: string;
}

export interface AssignableUser {
  id: string;
  name: string;
  departmentId: DepartmentKey;
  role: string;
  avatarUrl?: string;
  jobTitle?: string;
}

export interface ClientOption {
  id: string;
  tradeName: string;
  status: string;
}

export interface TaskSummary {
  today: number;
  overdue: number;
  inProgress: number;
  completedThisWeek: number;
}

// ---------------------------------------------------------------------------
// Filtros (mantidos na URL)
// ---------------------------------------------------------------------------

export type StatusFilter = TaskStatus | "abertas" | "todas";
export type DueFilter = "hoje" | "atrasadas" | "semana" | "sem";
export type TaskSort = "prazo" | "prioridade" | "atualizacao";

export interface TaskFilters {
  q?: string;
  assigneeId?: string;
  departmentId?: DepartmentKey;
  priority?: Priority;
  status?: StatusFilter;
  clientId?: string;
  mine?: boolean;
  due?: DueFilter;
  sort?: TaskSort;
}

/** Nome do parâmetro de URL de cada filtro. */
export const FILTER_PARAM = {
  q: "q",
  assigneeId: "resp",
  departmentId: "dep",
  priority: "prio",
  status: "status",
  clientId: "cliente",
  mine: "mine",
  due: "prazo",
  sort: "ordem",
} as const;

export const STATUS_FILTER_OPTIONS: { value: StatusFilter; label: string }[] = [
  { value: "abertas", label: "Abertas" },
  { value: "aberta", label: "Aberta" },
  { value: "em_andamento", label: "Em andamento" },
  { value: "aguardando", label: "Aguardando" },
  { value: "concluida", label: "Concluída" },
  { value: "cancelada", label: "Cancelada" },
  { value: "todas", label: "Todas" },
];

export const DUE_FILTER_OPTIONS: { value: DueFilter; label: string }[] = [
  { value: "hoje", label: "Hoje" },
  { value: "atrasadas", label: "Atrasadas" },
  { value: "semana", label: "Próximos 7 dias" },
  { value: "sem", label: "Sem prazo" },
];

export const SORT_OPTIONS: { value: TaskSort; label: string }[] = [
  { value: "prazo", label: "Prazo" },
  { value: "prioridade", label: "Prioridade" },
  { value: "atualizacao", label: "Atualização" },
];

function oneOf<T extends string>(value: string | null, allowed: readonly T[]): T | undefined {
  return value && (allowed as readonly string[]).includes(value) ? (value as T) : undefined;
}

/** Lê os filtros de um URLSearchParams (ou objeto equivalente), ignorando valores inválidos. */
export function filtersFromParams(get: (key: string) => string | null): TaskFilters {
  const q = get(FILTER_PARAM.q)?.trim();
  return {
    q: q || undefined,
    assigneeId: get(FILTER_PARAM.assigneeId) || undefined,
    departmentId: oneOf(get(FILTER_PARAM.departmentId), DEPARTMENT_KEYS),
    priority: oneOf(get(FILTER_PARAM.priority), PRIORITIES),
    status: oneOf(get(FILTER_PARAM.status), [...TASK_STATUS, "abertas", "todas"] as const),
    clientId: get(FILTER_PARAM.clientId) || undefined,
    mine: get(FILTER_PARAM.mine) === "1",
    due: oneOf(get(FILTER_PARAM.due), ["hoje", "atrasadas", "semana", "sem"] as const),
    sort: oneOf(get(FILTER_PARAM.sort), ["prazo", "prioridade", "atualizacao"] as const),
  };
}

export function hasActiveFilters(filters: TaskFilters): boolean {
  return Boolean(filters.q || filters.assigneeId || filters.departmentId || filters.priority || filters.status || filters.clientId || filters.mine || filters.due);
}

/** Soma dias a uma chave AAAA-MM-DD (aritmética em UTC, independente de fuso). */
export function addDaysToKey(key: string, days: number): string {
  const [y, m, d] = key.split("-").map(Number);
  return new Date(Date.UTC(y, m - 1, d + days)).toISOString().slice(0, 10);
}

function normalize(text: string): string {
  return text
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase();
}

export interface FilterContext {
  userId: string;
  todayKey: string;
  /** Status assumido quando o filtro de status não está na URL (varia por view). */
  defaultStatus?: StatusFilter;
  defaultSort?: TaskSort;
}

export function applyTaskFilters(items: TaskListItem[], filters: TaskFilters, ctx: FilterContext): TaskListItem[] {
  const status = filters.status ?? ctx.defaultStatus ?? "abertas";
  const q = filters.q ? normalize(filters.q) : "";
  const weekEnd = addDaysToKey(ctx.todayKey, 7);

  const out = items.filter((t) => {
    if (status === "abertas" && !isOpenStatus(t.status)) return false;
    if (status !== "abertas" && status !== "todas" && t.status !== status) return false;
    if (filters.mine && t.assigneeId !== ctx.userId) return false;
    if (filters.assigneeId && t.assigneeId !== filters.assigneeId) return false;
    if (filters.departmentId && t.departmentId !== filters.departmentId) return false;
    if (filters.priority && t.priority !== filters.priority) return false;
    if (filters.clientId && t.clientId !== filters.clientId) return false;
    if (filters.due === "hoje" && t.dueDayKey !== ctx.todayKey) return false;
    if (filters.due === "atrasadas" && t.dueTone !== "overdue") return false;
    if (filters.due === "semana" && !(t.dueDayKey && t.dueDayKey >= ctx.todayKey && t.dueDayKey <= weekEnd)) return false;
    if (filters.due === "sem" && t.dueAt) return false;
    if (q) {
      const haystack = normalize(`${t.title} ${t.clientName ?? ""} ${t.tags.join(" ")} ${t.assigneeName ?? ""}`);
      if (!haystack.includes(q)) return false;
    }
    return true;
  });

  return sortTasks(out, filters.sort ?? ctx.defaultSort ?? "prazo");
}

export function sortTasks(items: TaskListItem[], sort: TaskSort): TaskListItem[] {
  const byDue = (a: TaskListItem, b: TaskListItem) => {
    if (a.dueAt === b.dueAt) return 0;
    if (!a.dueAt) return 1;
    if (!b.dueAt) return -1;
    return a.dueAt < b.dueAt ? -1 : 1;
  };
  const byPriority = (a: TaskListItem, b: TaskListItem) => PRIORITY_WEIGHT[b.priority] - PRIORITY_WEIGHT[a.priority];
  const byUpdated = (a: TaskListItem, b: TaskListItem) => (a.updatedAt === b.updatedAt ? 0 : a.updatedAt < b.updatedAt ? 1 : -1);
  const sorted = [...items];
  if (sort === "prazo") sorted.sort((a, b) => byDue(a, b) || byPriority(a, b) || byUpdated(a, b));
  else if (sort === "prioridade") sorted.sort((a, b) => byPriority(a, b) || byDue(a, b) || byUpdated(a, b));
  else sorted.sort((a, b) => byUpdated(a, b) || byDue(a, b));
  return sorted;
}

/** Ordem do kanban: `order` crescente, depois criação. */
export function sortForKanban(items: TaskListItem[]): TaskListItem[] {
  return [...items].sort((a, b) => {
    const ao = a.order ?? Number.MAX_SAFE_INTEGER;
    const bo = b.order ?? Number.MAX_SAFE_INTEGER;
    if (ao !== bo) return ao - bo;
    return a.createdAt < b.createdAt ? -1 : 1;
  });
}

// ---------------------------------------------------------------------------
// Links entre módulos (contratos de URL)
// ---------------------------------------------------------------------------

export function taskHref(taskId: string): string {
  return `/tarefas?tarefa=${taskId}`;
}

export function clientHref(clientId: string): string {
  return `/clientes/${clientId}`;
}

/** Link "Abrir processo" de uma tarefa vinculada a workflow, projeto, chamado, oportunidade ou lead. */
export function processHrefFor(task: Pick<Task, "processType" | "processId" | "clientId">): string | undefined {
  if (!task.processType || !task.processId) return undefined;
  if (task.processType === "workflow") return `/workflow?etapa=${task.processId}`;
  // Os demais módulos ainda não têm rota própria: cai no Cliente 360º por enquanto.
  return task.clientId ? clientHref(task.clientId) : undefined;
}

export const PROCESS_TYPE_LABELS: Record<TaskProcessType, string> = {
  workflow: "Etapa de workflow",
  lead: "Lead",
  opportunity: "Oportunidade",
  contract: "Contrato",
  project: "Projeto de implantação",
  ticket: "Chamado",
  cs: "Customer Success",
  renewal: "Renovação",
  prospect: "Prospecção",
};

export const ORIGIN_LABELS: Record<Task["origin"], string> = {
  manual: "Manual",
  workflow: "Workflow",
  automacao: "Automação",
  evento: "Evento",
};

export const RECURRENCE_LABELS: Record<NonNullable<Task["recurrence"]>["freq"], string> = {
  diaria: "Diária",
  semanal: "Semanal",
  mensal: "Mensal",
};

export function describeRecurrence(recurrence: Task["recurrence"]): string | null {
  if (!recurrence) return null;
  const unit = recurrence.freq === "diaria" ? "dia" : recurrence.freq === "semanal" ? "semana" : "mês";
  const plural = recurrence.freq === "diaria" ? "dias" : recurrence.freq === "semanal" ? "semanas" : "meses";
  return recurrence.interval === 1 ? `A cada ${unit}` : `A cada ${recurrence.interval} ${plural}`;
}
