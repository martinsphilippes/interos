/**
 * Modelo do motor de automações (TRIGGER → CONDIÇÃO → AÇÃO): tipos estendidos, rótulos, varreduras
 * nativas e validação zod. Sem dependências de servidor: pode ser importado por Client Components.
 *
 * Os campos além de `AutomationRule`/`AutomationRun` (src/domain/types.ts) são aditivos e opcionais
 * (ver "needs" do relatório): trigger.sweep/entity, lastScheduledAt, operador older_than_hours e os
 * campos de rastreio do automation_run.
 */
import { z } from "zod";
import {
  DEPARTMENT_KEYS,
  EVENT_TYPES,
  HEALTH_LEVELS,
  NOTIFICATION_KINDS,
  PRIORITIES,
  ROLE_KEYS,
  type DepartmentKey,
  type EventType,
} from "@/domain/constants";
import type { AutomationRule, AutomationRun } from "@/domain/types";

// ---------------------------------------------------------------------------
// Condições
// ---------------------------------------------------------------------------

export const CONDITION_OPERATORS = ["==", "!=", ">", "<", ">=", "<=", "contains", "exists", "older_than_hours"] as const;
export type ConditionOperator = (typeof CONDITION_OPERATORS)[number];

export const CONDITION_OPERATOR_LABELS: Record<ConditionOperator, string> = {
  "==": "é igual a",
  "!=": "é diferente de",
  ">": "maior que",
  "<": "menor que",
  ">=": "maior ou igual a",
  "<=": "menor ou igual a",
  contains: "contém",
  exists: "está preenchido",
  older_than_hours: "há mais de (horas)",
};

export interface RuleCondition {
  path: string;
  operator: ConditionOperator;
  value?: unknown;
}

// ---------------------------------------------------------------------------
// Gatilhos, frequências e varreduras
// ---------------------------------------------------------------------------

export const SCHEDULES = ["horaria", "diaria", "semanal"] as const;
export type RuleSchedule = (typeof SCHEDULES)[number];
export const SCHEDULE_LABELS: Record<RuleSchedule, string> = { horaria: "A cada hora", diaria: "Diária", semanal: "Semanal" };
export const SCHEDULE_INTERVAL_MS: Record<RuleSchedule, number> = { horaria: 3_600_000, diaria: 86_400_000, semanal: 7 * 86_400_000 };

/**
 * Varreduras nativas. Cada uma é uma função nomeada em sweeps.ts; a frequência padrão pode ser
 * sobrescrita por uma regra agendada ativa que aponte para a varredura (trigger.sweep).
 */
export const SWEEP_KEYS = [
  "sla_alerts",
  "followup_vendas",
  "oportunidades_paradas",
  "leads_sem_contato_24h",
  "renovacoes",
  "saude_clientes",
  "implantacoes_atrasadas",
  "tarefas_recorrentes",
  "kpi_snapshots",
] as const;
export type SweepKey = (typeof SWEEP_KEYS)[number];

export const SWEEP_DEFINITIONS: Record<SweepKey, { label: string; description: string; schedule: RuleSchedule }> = {
  sla_alerts: { label: "Alertas de SLA", description: "Emite SLA em risco e SLA violado (uma única vez por instância) para chamados, tarefas, etapas de workflow, projetos e oportunidades.", schedule: "horaria" },
  followup_vendas: { label: "Follow-up de vendas", description: "Serviço de Vendas: tarefa de follow-up para próxima ação vencida e oportunidade parada.", schedule: "horaria" },
  oportunidades_paradas: { label: "Resumo de oportunidades paradas", description: "Resumo diário ao vendedor e ao gestor comercial de oportunidades paradas ou sem próxima ação.", schedule: "diaria" },
  leads_sem_contato_24h: { label: "Leads sem contato em 24h", description: "Lead novo sem primeiro contato há mais de 24 horas gera tarefa para o responsável (ou gestor de marketing).", schedule: "horaria" },
  renovacoes: { label: "Renovações", description: "Serviço de CS: cria renovações na janela de 90 dias e emite renovação próxima.", schedule: "diaria" },
  saude_clientes: { label: "Saúde dos clientes", description: "Serviço de CS: recalcula o health score de toda a carteira.", schedule: "diaria" },
  implantacoes_atrasadas: { label: "Implantações atrasadas", description: "Projetos com prazo vencido: avisa o responsável e o gestor de implantação uma vez por dia.", schedule: "diaria" },
  tarefas_recorrentes: { label: "Tarefas recorrentes", description: "Garante a próxima ocorrência das tarefas recorrentes concluídas que ficaram sem sucessora.", schedule: "diaria" },
  kpi_snapshots: { label: "Fotografia dos indicadores", description: "Grava os snapshots do motor de KPIs (quando o módulo de indicadores estiver instalado).", schedule: "diaria" },
};

/** Entidades que uma regra agendada pode varrer (só registros em aberto). */
export const SCAN_ENTITIES = ["opportunity", "lead", "task", "ticket", "project", "renewal", "client"] as const;
export type ScanEntity = (typeof SCAN_ENTITIES)[number];
export const SCAN_ENTITY_LABELS: Record<ScanEntity, string> = {
  opportunity: "Oportunidades abertas",
  lead: "Leads em aberto",
  task: "Tarefas abertas",
  ticket: "Chamados abertos",
  project: "Projetos de implantação em andamento",
  renewal: "Renovações em aberto",
  client: "Clientes ativos",
};

export interface RuleTrigger {
  type: "evento" | "agendado";
  eventType?: EventType;
  /** Frequência ("horaria" | "diaria" | "semanal"); regras antigas podem trazer expressão cron. */
  schedule?: string;
  sweep?: SweepKey;
  entity?: ScanEntity;
}

// ---------------------------------------------------------------------------
// Ações
// ---------------------------------------------------------------------------

export type RuleActionType = AutomationRule["actions"][number]["type"];
export const ACTION_TYPES = ["criar_tarefa", "notificar", "mudar_status", "iniciar_sla", "criar_handoff", "criar_plano_sucesso", "webhook"] as const satisfies readonly RuleActionType[];
export const ACTION_TYPE_LABELS: Record<RuleActionType, string> = {
  criar_tarefa: "Criar tarefa",
  notificar: "Notificar",
  mudar_status: "Mudar status",
  iniciar_sla: "Iniciar SLA",
  criar_handoff: "Criar handoff",
  criar_plano_sucesso: "Criar plano de sucesso",
  webhook: "Chamar webhook",
};

export interface RuleAction {
  type: RuleActionType;
  params: Record<string, unknown>;
}

export type AutomationRuleRecord = Omit<AutomationRule, "trigger" | "conditions" | "actions"> & {
  trigger: RuleTrigger;
  conditions: RuleCondition[];
  actions: RuleAction[];
  /** Última execução agendada (controle de frequência das regras agendadas). */
  lastScheduledAt?: string;
};

export type ActionOutcomeStatus = "sucesso" | "ignorada" | "erro" | "simulada";

export interface ActionOutcome {
  type: RuleActionType;
  status: ActionOutcomeStatus;
  detail: string;
  /** Resumo curto para títulos ("tarefa criada", "notificação enviada"). */
  effect?: string;
  /** Cliente afetado (a execução vai para a timeline dele). */
  clientId?: string;
  href?: string;
}

export interface ConditionResult {
  path: string;
  operator: ConditionOperator;
  expected?: unknown;
  actual: unknown;
  ok: boolean;
}

export type AutomationRunRecord = AutomationRun & {
  eventType?: string;
  entityType?: string;
  entityId?: string;
  clientId?: string;
  trigger?: "evento" | "agendado" | "manual";
  actions?: ActionOutcome[];
  conditions?: ConditionResult[];
  depth?: number;
};

/** Destinos aceitos por criar_tarefa (assignee) e notificar (to). */
export const RECIPIENT_PRESETS = [
  { value: "responsavel_entidade", label: "Responsável pelo registro" },
  { value: "responsavel_cliente", label: "Responsável pelo cliente no departamento" },
  { value: "gestor_departamento", label: "Gestor do departamento" },
] as const;

/** Campos que a ação mudar_status pode alterar (lista branca: coleção → campo → valores). */
export const STATUS_WHITELIST: Record<string, { label: string; fields: Record<string, { label: string; values: readonly string[] }> }> = {
  tasks: { label: "Tarefa", fields: { status: { label: "Status", values: ["aberta", "em_andamento", "aguardando"] }, priority: { label: "Prioridade", values: PRIORITIES } } },
  leads: { label: "Lead", fields: { temperature: { label: "Temperatura", values: ["quente", "morno", "frio"] }, status: { label: "Status", values: ["novo", "em_contato"] } } },
  opportunities: { label: "Oportunidade", fields: { temperature: { label: "Temperatura", values: ["quente", "morno", "frio"] } } },
  cs_accounts: { label: "Conta de CS", fields: { riskLevel: { label: "Nível de risco", values: HEALTH_LEVELS } } },
};

export const SLA_ENTITY_TYPES = ["tarefa", "workflow_step", "chamado", "projeto", "cs", "oportunidade"] as const;
export const HANDOFF_DEPARTMENTS = ["vendas", "financeiro", "implantacao", "cs", "suporte"] as const satisfies readonly DepartmentKey[];

const recipient = z.string().trim().min(1, "Informe o destinatário");

export const ACTION_PARAM_SCHEMAS = {
  criar_tarefa: z.object({
    title: z.string().trim().min(3, "Título da tarefa com pelo menos 3 caracteres"),
    description: z.string().trim().max(2000).optional(),
    assignee: recipient.optional(),
    department: z.enum(DEPARTMENT_KEYS).optional(),
    priority: z.enum(PRIORITIES).default("media"),
    dueInHours: z.coerce.number().min(0).max(24 * 365).default(24),
  }),
  notificar: z.object({
    to: z.union([recipient, z.array(recipient).min(1)]).default("responsavel_entidade"),
    kind: z.enum(NOTIFICATION_KINDS).default("informativa"),
    title: z.string().trim().max(200).optional(),
    body: z.string().trim().max(1000).optional(),
    href: z.string().trim().max(500).optional(),
  }),
  mudar_status: z
    .object({ collection: z.string().min(1), field: z.string().min(1), value: z.string().min(1) })
    .refine((p) => STATUS_WHITELIST[p.collection]?.fields[p.field]?.values.includes(p.value), "Alteração fora da lista de campos permitidos"),
  iniciar_sla: z.object({ ruleKey: z.string().trim().min(1, "Escolha a regra de SLA"), entityType: z.enum(SLA_ENTITY_TYPES).optional() }),
  criar_handoff: z.object({
    department: z.enum(HANDOFF_DEPARTMENTS),
    title: z.string().trim().max(200).optional(),
    note: z.string().trim().max(1000).optional(),
    dueInHours: z.coerce.number().min(1).max(24 * 30).default(8),
  }),
  criar_plano_sucesso: z.object({
    objective: z.string().trim().min(3, "Informe o objetivo do plano"),
    actions: z.array(z.string().trim().min(3)).max(10).default([]),
    checkpointInDays: z.coerce.number().min(1).max(180).default(15),
  }),
  webhook: z.object({
    url: z.string().trim().url("URL inválida").refine((u) => /^https?:\/\//.test(u), "Use http(s)"),
    method: z.enum(["GET", "POST", "PUT", "PATCH"]).default("POST"),
  }),
} satisfies Record<RuleActionType, z.ZodType>;

export type ActionParams<T extends RuleActionType> = z.output<(typeof ACTION_PARAM_SCHEMAS)[T]>;

// ---------------------------------------------------------------------------
// Entrada do editor
// ---------------------------------------------------------------------------

const PATH_RE = /^[A-Za-z_][\w]*(\.[\w]+)*$/;

export const conditionSchema = z.object({
  path: z.string().trim().regex(PATH_RE, "Caminho inválido (use pontos, ex.: payload.priority)"),
  operator: z.enum(CONDITION_OPERATORS),
  value: z.union([z.string(), z.number(), z.boolean(), z.null()]).optional(),
});

export const actionSchema = z.object({ type: z.enum(ACTION_TYPES), params: z.record(z.string(), z.unknown()) });

export const ruleInputSchema = z
  .object({
    id: z.string().min(1).optional(),
    name: z.string().trim().min(3, "Informe um nome com pelo menos 3 caracteres").max(120),
    description: z.string().trim().max(500).optional(),
    active: z.boolean(),
    trigger: z.object({
      type: z.enum(["evento", "agendado"]),
      eventType: z.enum(EVENT_TYPES).optional(),
      schedule: z.enum(SCHEDULES).optional(),
      sweep: z.enum(SWEEP_KEYS).optional(),
      entity: z.enum(SCAN_ENTITIES).optional(),
    }),
    conditions: z.array(conditionSchema).max(20),
    actions: z.array(actionSchema).max(10),
  })
  .superRefine((rule, ctx) => {
    const t = rule.trigger;
    if (t.type === "evento" && !t.eventType) ctx.addIssue({ code: "custom", path: ["trigger", "eventType"], message: "Escolha o evento que dispara a regra" });
    if (t.type === "agendado") {
      if (!t.schedule) ctx.addIssue({ code: "custom", path: ["trigger", "schedule"], message: "Escolha a frequência" });
      if (Boolean(t.sweep) === Boolean(t.entity)) ctx.addIssue({ code: "custom", path: ["trigger"], message: "Escolha uma varredura nativa ou um tipo de registro para varrer" });
    }
    const needsActions = t.type === "evento" || Boolean(t.entity);
    if (needsActions && rule.actions.length === 0) ctx.addIssue({ code: "custom", path: ["actions"], message: "Inclua pelo menos uma ação" });
    rule.conditions.forEach((c, i) => {
      if (c.operator !== "exists" && (c.value === undefined || c.value === null || c.value === "")) {
        ctx.addIssue({ code: "custom", path: ["conditions", i, "value"], message: `Condição ${i + 1}: informe o valor` });
      }
      if (c.operator === "older_than_hours" && !Number.isFinite(Number(c.value))) {
        ctx.addIssue({ code: "custom", path: ["conditions", i, "value"], message: `Condição ${i + 1}: informe um número de horas` });
      }
    });
    rule.actions.forEach((a, i) => {
      const parsed = ACTION_PARAM_SCHEMAS[a.type].safeParse(a.params);
      if (!parsed.success) {
        const first = parsed.error.issues[0];
        ctx.addIssue({ code: "custom", path: ["actions", i], message: `Ação ${i + 1} (${ACTION_TYPE_LABELS[a.type]}): ${first?.message ?? "parâmetros inválidos"}` });
      }
    });
  });
export type RuleInput = z.input<typeof ruleInputSchema>;

export const ruleIdSchema = z.object({ id: z.string().min(1) });
export const toggleRuleSchema = z.object({ id: z.string().min(1), active: z.boolean() });
export const runSweepsSchema = z.object({ only: z.array(z.string()).optional(), force: z.boolean().default(true) });

/** Primeira mensagem de um ZodError, em português. */
export function zodMessage(error: z.ZodError): string {
  return error.issues[0]?.message ?? "Dados inválidos";
}

// ---------------------------------------------------------------------------
// Rótulos auxiliares
// ---------------------------------------------------------------------------

const EVENT_DOMAIN_LABELS: Record<string, string> = {
  client: "Clientes",
  contact: "Clientes",
  task: "Tarefas",
  comment: "Colaboração",
  document: "Colaboração",
  note: "Colaboração",
  workflow: "Workflow",
  sla: "SLA",
  notification: "Sistema",
  user: "Sistema",
  department: "Sistema",
  product: "Sistema",
  lead: "Marketing",
  prospect: "Marketing",
  prospect_list: "Marketing",
  campaign: "Marketing",
  opportunity: "Vendas",
  proposal: "Vendas",
  visit: "Vendas",
  whatsapp: "Comunicação",
  call: "Comunicação",
  contract: "Financeiro",
  billing: "Financeiro",
  payment: "Financeiro",
  financial: "Financeiro",
  implementation: "Implantação",
  customer: "Customer Success",
  success_plan: "Customer Success",
  renewal: "Customer Success",
  churn: "Customer Success",
  upsell: "Customer Success",
  support: "Suporte",
  kpi: "Performance",
  goal: "Performance",
  commission: "Performance",
  bonus: "Performance",
  gamification: "Performance",
  achievement: "Performance",
  automation: "Automações",
  report: "Gestão",
  insight: "Gestão",
  ai: "Gestão",
};

export function eventDomain(type: string): string {
  return EVENT_DOMAIN_LABELS[type.split(".")[0]] ?? "Outros";
}

/** EVENT_TYPES agrupados por domínio (para o select do gatilho). */
export function groupedEventTypes(): { domain: string; types: EventType[] }[] {
  const groups = new Map<string, EventType[]>();
  for (const t of EVENT_TYPES) {
    const d = eventDomain(t);
    groups.set(d, [...(groups.get(d) ?? []), t]);
  }
  return Array.from(groups, ([domain, types]) => ({ domain, types }));
}

/** Converte frequência antiga (cron) em horaria/diaria/semanal. */
export function normalizeSchedule(value: string | undefined): RuleSchedule {
  if (value && (SCHEDULES as readonly string[]).includes(value)) return value as RuleSchedule;
  const parts = (value ?? "").trim().split(/\s+/);
  if (parts.length === 5) {
    if (parts[1] === "*" || parts[1].startsWith("*/")) return "horaria";
    if (parts[4] !== "*") return "semanal";
  }
  return "diaria";
}

export const ROLE_RECIPIENTS = ROLE_KEYS.map((r) => `papel:${r}`);
export const DEPARTMENT_RECIPIENTS = DEPARTMENT_KEYS.map((d) => `departamento:${d}`);
