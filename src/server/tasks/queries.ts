import "server-only";
/**
 * Leituras da Central de Tarefas. Só filtros de igualdade no Firestore; agregação em memória.
 * Rótulos de data são calculados aqui (fuso America/Sao_Paulo) para evitar divergência
 * servidor/navegador na hidratação.
 */
import { getById, getManyByIds, list, nowIso } from "@/server/db";
import { computeSlaState } from "@/server/sla";
import { COLLECTIONS, type Client, type Comment, type CurrentUser, type DomainEvent, type SlaInstance, type Task, type User } from "@/domain/types";
import type { TaskProcessType } from "@/domain/types";
import {
  addDaysToKey,
  applyTaskFilters,
  isOpenStatus,
  processHrefFor,
  sortForKanban,
  sortTasks,
  type AssignableUser,
  type ClientOption,
  type DueTone,
  type TaskCommentView,
  type TaskDetail,
  type TaskEventView,
  type TaskFilters,
  type TaskListItem,
  type TaskSummary,
  type TaskView,
} from "@/components/tasks/task-model";

export type { AssignableUser, ClientOption, TaskDetail, TaskFilters, TaskListItem, TaskSummary, TaskView } from "@/components/tasks/task-model";

// ---------------------------------------------------------------------------
// Datas em America/Sao_Paulo
// ---------------------------------------------------------------------------

const TZ = "America/Sao_Paulo";
const keyFormat = new Intl.DateTimeFormat("en-CA", { timeZone: TZ, year: "numeric", month: "2-digit", day: "2-digit" });
const timeFormat = new Intl.DateTimeFormat("pt-BR", { timeZone: TZ, hour: "2-digit", minute: "2-digit" });
const MONTHS_SHORT = ["jan", "fev", "mar", "abr", "mai", "jun", "jul", "ago", "set", "out", "nov", "dez"];

/** AAAA-MM-DD de um instante ISO no fuso de São Paulo. */
export function dayKey(iso: string): string {
  return keyFormat.format(new Date(iso));
}

export function todayKey(): string {
  return dayKey(nowIso());
}

/** AAAA-MM do mês atual em São Paulo. */
export function currentMonthKey(): string {
  return todayKey().slice(0, 7);
}

/** "Hoje, 14:00" · "Ontem, 09:30" · "Amanhã, 08:00" · "3 out, 17:00" · "3 out 2025, 17:00". */
export function dateLabel(iso: string, today: string, withTime = true): string {
  const key = dayKey(iso);
  const [y, m, d] = key.split("-").map(Number);
  let day: string;
  if (key === today) day = "Hoje";
  else if (key === addDaysToKey(today, -1)) day = "Ontem";
  else if (key === addDaysToKey(today, 1)) day = "Amanhã";
  else day = `${d} ${MONTHS_SHORT[m - 1]}${String(y) !== today.slice(0, 4) ? ` ${y}` : ""}`;
  return withTime ? `${day}, ${timeFormat.format(new Date(iso))}` : day;
}

function dueToneFor(task: Task, dueKey: string | undefined, today: string): DueTone {
  if (!dueKey) return "none";
  if (!isOpenStatus(task.status)) return "none";
  if (dueKey < today) return "overdue";
  if (dueKey === today) return "today";
  return "upcoming";
}

// ---------------------------------------------------------------------------
// Enriquecimento (SLA em lote, avatares, rótulos)
// ---------------------------------------------------------------------------

/** Anexa estado de SLA, avatar do responsável e rótulos de data a uma lista de tarefas. */
export async function enrichTasks(tasks: Task[]): Promise<TaskListItem[]> {
  if (tasks.length === 0) return [];
  const today = todayKey();
  const now = new Date();
  const [slas, users] = await Promise.all([
    getManyByIds<SlaInstance>(
      COLLECTIONS.slaInstances,
      tasks.map((t) => t.slaInstanceId ?? "").filter(Boolean),
    ),
    getManyByIds<User>(
      COLLECTIONS.users,
      tasks.map((t) => t.assigneeId ?? "").filter(Boolean),
    ),
  ]);
  return tasks.map((task) => {
    const sla = task.slaInstanceId ? slas.get(task.slaInstanceId) : undefined;
    const assignee = task.assigneeId ? users.get(task.assigneeId) : undefined;
    const dueDayKey = task.dueAt ? dayKey(task.dueAt) : undefined;
    return {
      ...task,
      checklist: task.checklist ?? [],
      tags: task.tags ?? [],
      assigneeName: assignee?.name ?? task.assigneeName,
      assigneeAvatarUrl: assignee?.avatarUrl,
      sla: sla ? computeSlaState(sla, now) : null,
      dueDayKey,
      dueLabel: task.dueAt ? dateLabel(task.dueAt, today) : undefined,
      dueTone: dueToneFor(task, dueDayKey, today),
      completedLabel: task.completedAt ? dateLabel(task.completedAt, today) : undefined,
      updatedLabel: dateLabel(task.updatedAt, today),
      checklistDone: (task.checklist ?? []).filter((c) => c.done).length,
      checklistTotal: (task.checklist ?? []).length,
    };
  });
}

// ---------------------------------------------------------------------------
// Escopo por usuário
// ---------------------------------------------------------------------------

/**
 * "mine": tarefas do usuário. "team": gestor/diretoria/admin veem toda a organização; os demais veem
 * o próprio departamento mais as suas tarefas (caso estejam alocadas fora dele).
 */
async function loadScope(user: CurrentUser, scope: "mine" | "team"): Promise<Task[]> {
  if (scope === "mine") return list<Task>(COLLECTIONS.tasks, { where: [["assigneeId", "==", user.id]] });
  if (user.isManager) return list<Task>(COLLECTIONS.tasks);
  const [dept, own] = await Promise.all([
    list<Task>(COLLECTIONS.tasks, { where: [["departmentId", "==", user.departmentId]] }),
    list<Task>(COLLECTIONS.tasks, { where: [["assigneeId", "==", user.id]] }),
  ]);
  const map = new Map<string, Task>();
  for (const t of [...dept, ...own]) map.set(t.id, t);
  return Array.from(map.values());
}

export interface ListTasksOptions extends TaskFilters {
  /** AAAA-MM da view de calendário (padrão: mês atual). */
  month?: string;
}

/**
 * Tarefas de uma view, já enriquecidas. Cada view define o recorte no servidor; os filtros opcionais
 * (mesmos da URL) são aplicados aqui também para quem consome fora da página (Meu Dia, dashboards).
 */
export async function listTasksForUser(user: CurrentUser, view: TaskView, options: ListTasksOptions = {}): Promise<TaskListItem[]> {
  const raw = await loadScope(user, view === "minha" ? "mine" : "team");
  const items = await enrichTasks(raw);
  const today = todayKey();
  const { month, ...filters } = options;

  let scoped: TaskListItem[];
  switch (view) {
    case "atrasadas":
      scoped = items.filter((t) => t.dueTone === "overdue");
      break;
    case "concluidas":
      scoped = items.filter((t) => t.status === "concluida");
      break;
    case "kanban": {
      // Coluna "Concluída" mostra só a última semana para não crescer sem limite.
      const weekAgo = addDaysToKey(today, -7);
      scoped = sortForKanban(items.filter((t) => t.status !== "cancelada" && (t.status !== "concluida" || (t.completedAt && dayKey(t.completedAt) >= weekAgo))));
      break;
    }
    case "calendario": {
      const key = month ?? currentMonthKey();
      scoped = items.filter((t) => t.dueDayKey?.startsWith(key));
      break;
    }
    default:
      scoped = items;
  }

  const hasFilters = Object.values(filters).some((v) => v !== undefined && v !== false && v !== "");
  if (!hasFilters) return view === "kanban" ? scoped : sortTasks(scoped, view === "concluidas" ? "atualizacao" : "prazo");
  return applyTaskFilters(scoped, filters, {
    userId: user.id,
    todayKey: today,
    defaultStatus: view === "kanban" || view === "calendario" || view === "concluidas" ? "todas" : "abertas",
    defaultSort: view === "concluidas" ? "atualizacao" : "prazo",
  });
}

// ---------------------------------------------------------------------------
// Detalhe
// ---------------------------------------------------------------------------

export async function getTaskDetail(id: string): Promise<TaskDetail | null> {
  const task = await getById<Task>(COLLECTIONS.tasks, id);
  if (!task) return null;
  const today = todayKey();
  const [[item], comments, events, creator] = await Promise.all([
    enrichTasks([task]),
    list<Comment>(COLLECTIONS.comments, { where: [["entityType", "==", "task"], ["entityId", "==", id]] }),
    list<DomainEvent>(COLLECTIONS.events, { where: [["entityType", "==", "task"], ["entityId", "==", id]] }),
    getById<User>(COLLECTIONS.users, task.creatorId),
  ]);
  const commentViews: TaskCommentView[] = comments
    .sort((a, b) => (a.createdAt < b.createdAt ? -1 : 1))
    .map((c) => ({ ...c, createdAtLabel: dateLabel(c.createdAt, today) }));
  const eventViews: TaskEventView[] = events
    .sort((a, b) => (a.occurredAt < b.occurredAt ? 1 : -1))
    .map((e) => ({ id: e.id, type: e.type, title: e.title, description: e.description, actorName: e.actorName, occurredAt: e.occurredAt, occurredAtLabel: dateLabel(e.occurredAt, today) }));
  return { task: item, comments: commentViews, events: eventViews, creatorName: creator?.name, processHref: processHrefFor(task) };
}

// ---------------------------------------------------------------------------
// Listas auxiliares
// ---------------------------------------------------------------------------

export async function listAssignableUsers(): Promise<AssignableUser[]> {
  const users = await list<User>(COLLECTIONS.users, { where: [["active", "==", true]] });
  return users
    .map((u) => ({ id: u.id, name: u.name, departmentId: u.departmentId, role: u.role, avatarUrl: u.avatarUrl, jobTitle: u.jobTitle }))
    .sort((a, b) => a.name.localeCompare(b.name, "pt-BR"));
}

export async function listClientsForSelect(): Promise<ClientOption[]> {
  const clients = await list<Client>(COLLECTIONS.clients);
  return clients.map((c) => ({ id: c.id, tradeName: c.tradeName, status: c.status })).sort((a, b) => a.tradeName.localeCompare(b.tradeName, "pt-BR"));
}

// ---------------------------------------------------------------------------
// Resumo (StatCards)
// ---------------------------------------------------------------------------

/** Semana corrente começa na segunda-feira (São Paulo). */
function weekStartKey(today: string): string {
  const [y, m, d] = today.split("-").map(Number);
  const dow = new Date(Date.UTC(y, m - 1, d)).getUTCDay(); // 0 = domingo
  return addDaysToKey(today, -((dow + 6) % 7));
}

/** Contadores das tarefas do próprio usuário: hoje, atrasadas, em andamento e concluídas na semana. */
export async function countTaskSummary(user: CurrentUser): Promise<TaskSummary> {
  const tasks = await list<Task>(COLLECTIONS.tasks, { where: [["assigneeId", "==", user.id]] });
  const today = todayKey();
  const weekStart = weekStartKey(today);
  const summary: TaskSummary = { today: 0, overdue: 0, inProgress: 0, completedThisWeek: 0 };
  for (const t of tasks) {
    const open = isOpenStatus(t.status);
    const dueKey = t.dueAt ? dayKey(t.dueAt) : undefined;
    if (open && dueKey === today) summary.today++;
    if (open && dueKey && dueKey < today) summary.overdue++;
    if (t.status === "em_andamento") summary.inProgress++;
    if (t.status === "concluida" && t.completedAt && dayKey(t.completedAt) >= weekStart) summary.completedThisWeek++;
  }
  return summary;
}

// ---------------------------------------------------------------------------
// Reutilizáveis por outros módulos (Meu Dia, workflow, Cliente 360º)
// ---------------------------------------------------------------------------

/** Tarefas abertas de um responsável, ordenadas por prazo. */
export async function listOpenTasksByAssignee(userId: string): Promise<TaskListItem[]> {
  const tasks = await list<Task>(COLLECTIONS.tasks, { where: [["assigneeId", "==", userId]] });
  return sortTasks(await enrichTasks(tasks.filter((t) => isOpenStatus(t.status))), "prazo");
}

/** Tarefas vinculadas a um processo (etapa de workflow, projeto, chamado...). */
export async function listTasksByProcess(processType: TaskProcessType, processId: string): Promise<TaskListItem[]> {
  const tasks = await list<Task>(COLLECTIONS.tasks, { where: [["processType", "==", processType], ["processId", "==", processId]] });
  return sortTasks(await enrichTasks(tasks), "prazo");
}

/** Todas as tarefas de um cliente (abertas primeiro, por prazo). */
export async function listTasksByClient(clientId: string): Promise<TaskListItem[]> {
  const tasks = await list<Task>(COLLECTIONS.tasks, { where: [["clientId", "==", clientId]] });
  const items = await enrichTasks(tasks);
  const open = sortTasks(items.filter((t) => isOpenStatus(t.status)), "prazo");
  const closed = sortTasks(items.filter((t) => !isOpenStatus(t.status)), "atualizacao");
  return [...open, ...closed];
}
