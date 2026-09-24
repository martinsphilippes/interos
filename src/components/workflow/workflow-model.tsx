/**
 * Modelo de visualização do Workflow: tipos enriquecidos, filtros da URL e helpers puros.
 * Sem React e sem firebase: importado pelas queries (servidor) e pelos componentes (cliente).
 */
import { DEPARTMENT_KEYS, JOURNEY_STAGES, WORKFLOW_STEP_STATUS, type DepartmentKey, type JourneyStage, type WorkflowStepStatus } from "@/domain/constants";
import type { ChecklistItem, Comment, SlaView, WorkflowInstance, WorkflowStage, WorkflowStep, WorkflowTemplate } from "@/domain/types";
import type { GateEvaluation } from "@/server/workflow/gates";
import type { TaskListItem } from "@/components/tasks/task-model";

// ---------------------------------------------------------------------------
// Views e filtros (URL)
// ---------------------------------------------------------------------------

export const WORKFLOW_VIEWS = ["kanban", "lista"] as const;
export type WorkflowView = (typeof WORKFLOW_VIEWS)[number];

export function parseWorkflowView(value: unknown): WorkflowView {
  return value === "lista" ? "lista" : "kanban";
}

export const OPEN_STEP_STATUSES: readonly WorkflowStepStatus[] = ["em_andamento", "aguardando_cliente", "aguardando_aprovacao"];

export function isOpenStepStatus(status: WorkflowStepStatus): boolean {
  return OPEN_STEP_STATUSES.includes(status);
}

export interface WorkflowFilters {
  departmentId?: DepartmentKey;
  assigneeId?: string;
  mine?: boolean;
  /** Só etapas com SLA em risco ou violado. */
  slaRisk?: boolean;
  status?: WorkflowStepStatus;
  stageKey?: string;
  q?: string;
}

export const FILTER_PARAM = {
  departmentId: "dep",
  assigneeId: "resp",
  mine: "mine",
  slaRisk: "sla",
  status: "status",
  stageKey: "etapa_chave",
  q: "q",
} as const;

function oneOf<T extends string>(value: string | null, allowed: readonly T[]): T | undefined {
  return value && (allowed as readonly string[]).includes(value) ? (value as T) : undefined;
}

export function filtersFromParams(get: (key: string) => string | null): WorkflowFilters {
  const q = get(FILTER_PARAM.q)?.trim();
  return {
    departmentId: oneOf(get(FILTER_PARAM.departmentId), DEPARTMENT_KEYS),
    assigneeId: get(FILTER_PARAM.assigneeId) || undefined,
    mine: get(FILTER_PARAM.mine) === "1",
    slaRisk: get(FILTER_PARAM.slaRisk) === "risco",
    status: oneOf(get(FILTER_PARAM.status), WORKFLOW_STEP_STATUS),
    stageKey: get(FILTER_PARAM.stageKey) || undefined,
    q: q || undefined,
  };
}

export function hasActiveFilters(filters: WorkflowFilters): boolean {
  return Boolean(filters.departmentId || filters.assigneeId || filters.mine || filters.slaRisk || filters.status || filters.stageKey || filters.q);
}

function normalize(text: string): string {
  return text
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase();
}

export function applyWorkflowFilters(items: StepCardItem[], filters: WorkflowFilters, currentUserId: string): StepCardItem[] {
  const q = filters.q ? normalize(filters.q) : "";
  return items.filter((item) => {
    if (filters.departmentId && item.department !== filters.departmentId) return false;
    if (filters.assigneeId && item.assigneeId !== filters.assigneeId) return false;
    if (filters.mine && item.assigneeId !== currentUserId) return false;
    if (filters.slaRisk && !(item.sla && (item.sla.state === "em_risco" || item.sla.state === "violado"))) return false;
    if (filters.status && item.status !== filters.status) return false;
    if (filters.stageKey && item.stageKey !== filters.stageKey) return false;
    if (q && !normalize(`${item.clientName} ${item.assigneeName ?? ""} ${item.stageName}`).includes(q)) return false;
    return true;
  });
}

// ---------------------------------------------------------------------------
// Itens enriquecidos
// ---------------------------------------------------------------------------

export interface StepCardItem {
  id: string;
  instanceId: string;
  clientId: string;
  clientName: string;
  stageKey: string;
  stageName: string;
  department: DepartmentKey;
  order: number;
  status: WorkflowStepStatus;
  assigneeId?: string;
  assigneeName?: string;
  assigneeAvatarUrl?: string;
  startedAt?: string;
  dueAt?: string;
  updatedAt: string;
  /** Dias corridos desde o início da etapa. */
  daysInStage: number;
  sla: SlaView | null;
  checklistDone: number;
  checklistTotal: number;
  waitingClientReason?: string;
  approvalPending: boolean;
  exceptionReason?: string;
}

export interface WorkflowSummary {
  active: number;
  mine: number;
  slaRisk: number;
  awaitingApproval: number;
  waitingClient: number;
}

export interface BoardColumn {
  key: string;
  name: string;
  department: DepartmentKey;
  items: StepCardItem[];
}

export interface WorkflowBoardData {
  columns: BoardColumn[];
  items: StepCardItem[];
  summary: WorkflowSummary;
}

export interface StepEventView {
  id: string;
  type: string;
  title: string;
  description?: string;
  actorName: string;
  occurredAt: string;
  occurredAtLabel: string;
}

export interface StepNoteView extends Comment {
  createdAtLabel: string;
}

export interface StageRef {
  key: string;
  name: string;
  department: DepartmentKey;
}

/** Tudo que o drawer/painel de uma etapa mostra. */
export interface StepDetail {
  step: WorkflowStep;
  stage: WorkflowStage;
  instance: Pick<WorkflowInstance, "id" | "clientId" | "clientName" | "currentStageKey" | "status" | "templateVersion">;
  client: { id: string; tradeName: string; status: string };
  sla: SlaView | null;
  gate: GateEvaluation;
  nextStage: StageRef | null;
  tasks: TaskListItem[];
  events: StepEventView[];
  notes: StepNoteView[];
  assigneeAvatarUrl?: string;
  startedAtLabel?: string;
  completedAtLabel?: string;
  dueAtLabel?: string;
  /** Usuário atual pode aprovar (papel aprovador, gestor ou admin). */
  canApprove: boolean;
  /** Usuário atual pode concluir com motivo de exceção (gestor, diretoria ou admin). */
  canException: boolean;
  /** Quem receberá o pedido de aprovação. */
  approverNames: string[];
}

export interface InstanceStepView {
  step: WorkflowStep;
  stage: WorkflowStage | null;
  sla: SlaView | null;
  state: "done" | "current" | "pending";
  startedAtLabel?: string;
  completedAtLabel?: string;
  /** Duração legível da etapa (concluída: início→fim; atual: início→agora). */
  durationLabel?: string;
  checklistDone: number;
  checklistTotal: number;
}

export interface InstanceDetail {
  instance: WorkflowInstance;
  template: Pick<WorkflowTemplate, "id" | "key" | "name" | "version"> | null;
  stages: WorkflowStage[];
  steps: InstanceStepView[];
  client: { id: string; tradeName: string; status: string; currentStage?: string };
  timeline: StepEventView[];
  startedAtLabel: string;
  completedAtLabel?: string;
}

export interface AssignableUserOption {
  id: string;
  name: string;
  departmentId: DepartmentKey;
  role: string;
  avatarUrl?: string;
}

export interface TemplateListItem {
  id: string;
  key: string;
  name: string;
  version: number;
  published: boolean;
  stagesCount: number;
  updatedAt: string;
  updatedAtLabel: string;
  /** Instâncias que rodam nesta versão. */
  instances: number;
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

export function stepHref(stepId: string): string {
  return `/workflow?etapa=${stepId}`;
}

export function instanceHref(instanceId: string): string {
  return `/workflow/${instanceId}`;
}

export function clientHref(clientId: string): string {
  return `/clientes/${clientId}`;
}

export function taskHref(taskId: string): string {
  return `/tarefas?tarefa=${taskId}`;
}

export function checklistProgress(checklist: ChecklistItem[] | undefined): { done: number; total: number } {
  const items = checklist ?? [];
  return { done: items.filter((c) => c.done).length, total: items.length };
}

/** Ordem das colunas do kanban: etapas do template publicado, senão JOURNEY_STAGES. */
export function boardColumnsFrom(stages: WorkflowStage[] | null | undefined): StageRef[] {
  if (stages && stages.length > 0) {
    return [...stages].sort((a, b) => a.order - b.order).map((s) => ({ key: s.key, name: s.name, department: s.department }));
  }
  return JOURNEY_STAGES.map((key) => ({ key, name: key.charAt(0).toUpperCase() + key.slice(1), department: key as DepartmentKey }));
}

/** Ordena cards: SLA violado/em risco primeiro, depois prazo mais próximo, depois mais antigo na etapa. */
export function sortStepCards(items: StepCardItem[]): StepCardItem[] {
  const rank = (i: StepCardItem) => (i.sla?.state === "violado" ? 0 : i.sla?.state === "em_risco" ? 1 : i.sla?.state === "em_atencao" ? 2 : 3);
  return [...items].sort((a, b) => rank(a) - rank(b) || (a.dueAt ?? "9").localeCompare(b.dueAt ?? "9") || (a.startedAt ?? "").localeCompare(b.startedAt ?? ""));
}

export function isJourneyStage(key: string): key is JourneyStage {
  return (JOURNEY_STAGES as readonly string[]).includes(key);
}
