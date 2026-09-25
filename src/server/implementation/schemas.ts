/**
 * Implantação: esquemas zod das Server Actions, tipos compartilhados e regras PURAS (sem firebase),
 * usadas pelo serviço no servidor e pelos componentes (progresso, fases, gate de go-live).
 */
import { z } from "zod";
import {
  IMPLEMENTATION_PHASES,
  type ImplementationPhase,
  type ImplementationProject,
  type ImplementationStatus,
  type ImplementationTask,
  type Training,
} from "@/domain/types";
import { ROLE_KEYS } from "@/domain/constants";

// ---------------------------------------------------------------------------
// Tipos
// ---------------------------------------------------------------------------

/**
 * Projeto como gravado no Firestore. `validation` e `blocked` são campos aditivos deste módulo
 * (ainda não declarados em ImplementationProject de src/domain/types.ts).
 */
export type ProjectRecord = ImplementationProject & {
  /** Validação interna antes do go-live (quem validou e quando). */
  validation?: { validatedBy: string; validatedAt: string; notes?: string };
  /** Bloqueio interno (atraso de responsabilidade da Intercert). */
  blocked?: { reason: string; since: string; byId: string };
};

/** Configuração "go_live" em `settings`. */
export interface GoLiveSettings {
  /** true: só gestor/admin/diretoria aprovam; false: o responsável do projeto também pode aprovar. */
  exigeAprovacaoGestor: boolean;
}
export const GO_LIVE_SETTING_KEY = "go_live";
export const DEFAULT_GO_LIVE_SETTINGS: GoLiveSettings = { exigeAprovacaoGestor: true };

/** Status em que o projeto está "vivo" (conta como carga e aparece no kanban). */
export const ACTIVE_PROJECT_STATUSES: readonly ImplementationStatus[] = ["aguardando_inicio", "em_implantacao", "aguardando_cliente", "bloqueada", "pronta_para_go_live"];

export function isActiveProject(status: ImplementationStatus): boolean {
  return ACTIVE_PROJECT_STATUSES.includes(status);
}

/** Quem opera a implantação (Suporte e CS apenas consultam). */
export function canOperateImplementation(user: { isAdmin: boolean; isManager: boolean; role: string; departmentId: string }): boolean {
  return user.isAdmin || user.isManager || user.role === "implantacao" || user.departmentId === "implantacao";
}

// ---------------------------------------------------------------------------
// Regras puras: fases, progresso e gate de go-live
// ---------------------------------------------------------------------------

export function phaseIndex(phase: ImplementationPhase): number {
  return IMPLEMENTATION_PHASES.indexOf(phase);
}

/** Fases que existem no plano do projeto, na ordem padrão (sempre inclui a fase atual). */
export function projectPhases(tasks: Pick<ImplementationTask, "phase">[], current?: ImplementationPhase): ImplementationPhase[] {
  const present = new Set<ImplementationPhase>(tasks.map((t) => t.phase));
  if (current) present.add(current);
  return IMPLEMENTATION_PHASES.filter((p) => present.has(p));
}

const isOpenTask = (t: Pick<ImplementationTask, "status">) => t.status !== "concluida" && t.status !== "cancelada";

/** Progresso = tarefas obrigatórias concluídas / total de obrigatórias (0–100). Sem obrigatórias, usa todas. */
export function computeProgress(tasks: Pick<ImplementationTask, "status" | "required">[]): number {
  const valid = tasks.filter((t) => t.status !== "cancelada");
  const base = valid.some((t) => t.required) ? valid.filter((t) => t.required) : valid;
  if (base.length === 0) return 0;
  return Math.round((base.filter((t) => t.status === "concluida").length / base.length) * 100);
}

/** Tarefas obrigatórias ainda abertas das fases informadas. */
export function pendingRequired<T extends Pick<ImplementationTask, "status" | "required" | "phase">>(tasks: T[], phases: ImplementationPhase[]): T[] {
  const set = new Set(phases);
  return tasks.filter((t) => t.required && isOpenTask(t) && set.has(t.phase));
}

/**
 * Tarefas obrigatórias que precisam estar concluídas ANTES do go-live: todas, menos as da própria fase
 * Go-live (acompanhamento do primeiro dia, aceite e handoff), que são concluídas na aprovação.
 */
export function pendingBeforeGoLive<T extends Pick<ImplementationTask, "status" | "required" | "phase">>(tasks: T[]): T[] {
  return tasks.filter((t) => t.required && isOpenTask(t) && t.phase !== "go_live");
}

export interface GoLiveCheck {
  key: "status" | "checklist" | "tarefas" | "treinamento" | "validacao" | "aceite";
  label: string;
  ok: boolean;
  /** O que falta, em linguagem simples. */
  detail?: string;
}

export interface GoLiveGate {
  ok: boolean;
  checks: GoLiveCheck[];
  missing: string[];
}

/** Gate obrigatório do go-live: checklist, tarefas, treinamento, validação e aceite do cliente. */
export function evaluateGoLiveGate(
  project: Pick<ProjectRecord, "status" | "checklist" | "validation" | "acceptance">,
  tasks: Pick<ImplementationTask, "status" | "required" | "phase" | "title">[],
  trainings: Pick<Training, "status">[],
): GoLiveGate {
  const checklistPending = project.checklist.filter((c) => c.required !== false && !c.done);
  const tasksPending = pendingBeforeGoLive(tasks);
  const trainingsDone = trainings.filter((t) => t.status === "realizado").length;
  const statusOk = project.status !== "aguardando_cliente" && project.status !== "bloqueada" && project.status !== "cancelada" && project.status !== "concluida";
  const statusDetail =
    project.status === "aguardando_cliente"
      ? "Projeto aguardando o cliente: retome antes do go-live"
      : project.status === "bloqueada"
        ? "Projeto bloqueado: resolva o bloqueio antes do go-live"
        : project.status === "concluida"
          ? "Go-live já registrado"
          : project.status === "cancelada"
            ? "Projeto cancelado"
            : undefined;
  const checks: GoLiveCheck[] = [
    { key: "status", label: "Projeto sem pendências de status", ok: statusOk, detail: statusDetail },
    {
      key: "checklist",
      label: "Checklist obrigatório completo",
      ok: checklistPending.length === 0,
      detail: checklistPending.length ? `${checklistPending.length} item(ns): ${checklistPending.slice(0, 3).map((c) => c.label).join(", ")}${checklistPending.length > 3 ? "…" : ""}` : undefined,
    },
    {
      key: "tarefas",
      label: "Tarefas obrigatórias concluídas",
      ok: tasksPending.length === 0,
      detail: tasksPending.length ? `${tasksPending.length} tarefa(s): ${tasksPending.slice(0, 3).map((t) => t.title).join(", ")}${tasksPending.length > 3 ? "…" : ""}` : undefined,
    },
    { key: "treinamento", label: "Pelo menos um treinamento realizado", ok: trainingsDone > 0, detail: trainingsDone ? undefined : "Registre um treinamento realizado" },
    {
      key: "validacao",
      label: "Validação interna registrada",
      ok: Boolean(project.validation?.validatedBy && project.validation.validatedAt),
      detail: project.validation?.validatedBy ? undefined : "Informe quem validou e a data",
    },
    {
      key: "aceite",
      label: "Aceite do cliente registrado",
      ok: Boolean(project.acceptance?.acceptedBy && project.acceptance.acceptedAt),
      detail: project.acceptance?.acceptedBy ? undefined : "Registre quem aceitou, a data e observações",
    },
  ];
  const failed = checks.filter((c) => !c.ok);
  return { ok: failed.length === 0, checks, missing: failed.map((c) => (c.detail ? `${c.label.toLowerCase()} (${c.detail})` : c.label.toLowerCase())) };
}

// ---------------------------------------------------------------------------
// Esquemas das actions
// ---------------------------------------------------------------------------

export function zodMessage(error: z.ZodError): string {
  return error.issues[0]?.message ?? "Dados inválidos";
}

const id = (label: string) => z.string(`${label} obrigatório`).trim().min(1, `${label} obrigatório`);
const isoDate = z.string("Data inválida").refine((v) => !Number.isNaN(Date.parse(v)), { message: "Data inválida" });
const text = (label: string, max: number) => z.string(`${label} obrigatório`).trim().min(1, `${label} obrigatório`).max(max, `${label} muito longo (máx. ${max} caracteres)`);
const optionalText = (max: number) =>
  z
    .string()
    .trim()
    .max(max, `Texto muito longo (máx. ${max} caracteres)`)
    .optional()
    .transform((v) => (v ? v : undefined));
const url = z.url("Informe um link válido (https://…)");
const optionalUrl = z.union([z.literal(""), url]).optional().transform((v) => (v ? v : undefined));
const phase = z.enum(IMPLEMENTATION_PHASES, { message: "Fase inválida" });

export const projectIdSchema = z.object({ projectId: id("Projeto") });
export const taskIdSchema = z.object({ taskId: id("Tarefa") });
export const trainingIdSchema = z.object({ trainingId: id("Treinamento") });

export const changePhaseSchema = z.object({ projectId: id("Projeto"), phase });

export const completeTaskSchema = z.object({ taskId: id("Tarefa"), evidence: optionalText(1000) });

export const assignTaskSchema = z.object({ taskId: id("Tarefa"), assigneeId: id("Responsável") });

export const addTaskSchema = z.object({
  projectId: id("Projeto"),
  phase,
  title: text("Título", 160),
  description: optionalText(1000),
  assigneeId: z.string().trim().optional().transform((v) => (v ? v : undefined)),
  dueAt: isoDate.optional(),
  required: z.boolean().default(false),
  dependsOn: z.array(z.string().trim().min(1)).max(20).default([]),
});

export const updateTeamSchema = z.object({
  projectId: id("Projeto"),
  ownerId: id("Responsável"),
  teamIds: z.array(z.string().trim().min(1)).max(20, "Equipe muito grande"),
});

export const toggleChecklistSchema = z.object({ projectId: id("Projeto"), itemId: id("Item"), done: z.boolean() });
export const addChecklistItemSchema = z.object({ projectId: id("Projeto"), label: text("Item", 200), required: z.boolean().default(true) });

export const trainingSchema = z.object({
  projectId: id("Projeto"),
  subject: text("Assunto", 200),
  productId: z.string().trim().optional().transform((v) => (v ? v : undefined)),
  instructorId: id("Instrutor"),
  scheduledAt: isoDate,
  participants: z.array(z.string().trim().min(1).max(120)).max(60, "Participantes demais"),
  materialUrl: optionalUrl,
  evidence: optionalText(1000),
  notes: optionalText(2000),
  /** "realizado" registra um treinamento que já aconteceu. */
  status: z.enum(["agendado", "realizado"]).default("agendado"),
});

export const completeTrainingSchema = z.object({ trainingId: id("Treinamento"), evidence: optionalText(1000), notes: optionalText(2000) });

export const waitingClientSchema = z.object({
  projectId: id("Projeto"),
  reason: text("Motivo", 500),
  since: isoDate.optional(),
  responsibleId: id("Responsável"),
  evidence: optionalText(1000),
});

export const blockSchema = z.object({ projectId: id("Projeto"), reason: text("Motivo", 500) });

export const documentSchema = z.object({
  projectId: id("Projeto"),
  name: text("Nome do documento", 160),
  url,
  category: optionalText(60),
});

export const validationSchema = z.object({ projectId: id("Projeto"), validatedBy: text("Validado por", 120), validatedAt: isoDate, notes: optionalText(1000) });

export const acceptanceSchema = z.object({ projectId: id("Projeto"), acceptedBy: text("Quem aceitou", 120), acceptedAt: isoDate, notes: optionalText(1000) });

export const goLiveSettingsSchema = z.object({ exigeAprovacaoGestor: z.boolean() });

const templateTaskSchema = z.object({
  title: text("Título da tarefa", 160),
  description: optionalText(1000),
  dueInDays: z.number("Prazo inválido").int("Prazo em dias inteiros").min(0, "Prazo não pode ser negativo").max(120, "Prazo máximo de 120 dias"),
  required: z.boolean(),
  role: z.enum(ROLE_KEYS).optional(),
});

const templatePhaseSchema = z.object({
  key: phase,
  name: text("Nome da fase", 80),
  order: z.number().int().min(1).max(20),
  tasks: z.array(templateTaskSchema).max(40, "Tarefas demais na fase"),
  checklist: z.array(z.object({ label: text("Item do checklist", 200), required: z.boolean() })).max(40, "Itens demais no checklist"),
});

export const templateSchema = z
  .object({
    id: z.string().trim().optional().transform((v) => (v ? v : undefined)),
    name: text("Nome", 120),
    productId: z.string().trim().optional().transform((v) => (v ? v : undefined)),
    totalDays: z.number("Total de dias inválido").int("Use dias inteiros").min(1, "Mínimo de 1 dia").max(365, "Máximo de 365 dias"),
    active: z.boolean(),
    phases: z.array(templatePhaseSchema).min(1, "Inclua pelo menos uma fase").max(IMPLEMENTATION_PHASES.length),
  })
  .refine((t) => new Set(t.phases.map((p) => p.key)).size === t.phases.length, { message: "Cada fase só pode aparecer uma vez", path: ["phases"] });
export type TemplateInput = z.infer<typeof templateSchema>;

export const templateActiveSchema = z.object({ templateId: id("Template"), active: z.boolean() });

// ---------------------------------------------------------------------------
// Filtros da lista de projetos (URL)
// ---------------------------------------------------------------------------

export type ProjectScope = "todos" | "equipe" | "meus";

export interface ProjectFilters {
  status?: ImplementationStatus | "ativos";
  ownerId?: string;
  productId?: string;
  overdue?: boolean;
  scope?: ProjectScope;
  /** Drill-down dos indicadores. */
  kpi?: "concluidas_mes" | "no_prazo" | "ativacao_7d";
}

export const PROJECT_STATUS_FILTERS: ImplementationStatus[] = ["aguardando_inicio", "em_implantacao", "aguardando_cliente", "bloqueada", "pronta_para_go_live", "concluida", "cancelada"];

export function readProjectFilters(get: (key: string) => string | null | undefined): ProjectFilters {
  const status = get("status") ?? undefined;
  const scope = get("escopo") ?? undefined;
  const kpi = get("kpi") ?? undefined;
  return {
    status: status === "ativos" || (status && (PROJECT_STATUS_FILTERS as string[]).includes(status)) ? (status as ProjectFilters["status"]) : undefined,
    ownerId: get("responsavel") || undefined,
    productId: get("produto") || undefined,
    overdue: get("atrasadas") === "1",
    scope: scope === "todos" || scope === "equipe" || scope === "meus" ? scope : undefined,
    kpi: kpi === "concluidas_mes" || kpi === "no_prazo" || kpi === "ativacao_7d" ? kpi : undefined,
  };
}
