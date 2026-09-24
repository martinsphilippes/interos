import "server-only";
/**
 * Leituras da tela de automações (/admin/automacoes): regras com estatísticas de execução, detalhe
 * de uma regra com histórico, opções do editor e sugestões de caminhos por tipo de evento.
 */
import { eventTypeLabel } from "@/domain/event-labels";
import { getById, list } from "@/server/db";
import { COLLECTIONS, type AutomationRule, type DomainEvent, type SlaRule, type User } from "@/domain/types";
import { DEPARTMENT_KEYS, DEPARTMENT_LABELS, ROLE_LABELS, type DepartmentKey, type RoleKey } from "@/domain/constants";
import { describeCondition } from "./conditions";
import { describeAction } from "./actions-registry";
import { normalizeRule } from "./engine";
import { getSweepStatus, type SweepStatusItem } from "./scheduler";
import { SCAN_ENTITY_LABELS, SCHEDULE_LABELS, SWEEP_DEFINITIONS, type AutomationRuleRecord, type AutomationRunRecord, type RuleSchedule } from "./schemas";

const DAY_MS = 86_400_000;

export interface RuleListItem {
  id: string;
  name: string;
  description?: string;
  active: boolean;
  triggerLabel: string;
  triggerKind: "evento" | "agendado";
  conditions: string[];
  actions: string[];
  runCount: number;
  lastRunAt?: string;
  recentErrors: number;
  recentIgnored: number;
  lastError?: string;
}

export function triggerLabel(rule: AutomationRuleRecord): string {
  const t = rule.trigger;
  if (t.type === "evento") return t.eventType ? `Evento ${eventTypeLabel(t.eventType)}` : "Evento (não definido)";
  const freq = SCHEDULE_LABELS[(t.schedule as RuleSchedule) ?? "diaria"] ?? t.schedule;
  if (t.sweep) return `${freq} · varredura ${SWEEP_DEFINITIONS[t.sweep].label}`;
  if (t.entity) return `${freq} · ${SCAN_ENTITY_LABELS[t.entity]}`;
  return `${freq} · sem alvo`;
}

async function allRules(): Promise<AutomationRuleRecord[]> {
  const raw = await list<AutomationRule>(COLLECTIONS.automationRules);
  return raw.map(normalizeRule).sort((a, b) => Number(b.active) - Number(a.active) || a.name.localeCompare(b.name, "pt-BR"));
}

export interface AutomationsOverview {
  rules: RuleListItem[];
  sweeps: SweepStatusItem[];
  stats: { active: number; total: number; runs7d: number; errors7d: number };
}

/** Regras com contagem de execuções e erros dos últimos 7 dias (uma leitura de automation_runs). */
export async function getAutomationsOverview(): Promise<AutomationsOverview> {
  const since = new Date(Date.now() - 7 * DAY_MS).toISOString();
  const [rules, runs, sweeps] = await Promise.all([allRules(), list<AutomationRunRecord>(COLLECTIONS.automationRuns), getSweepStatus()]);
  const recent = runs.filter((r) => r.ranAt >= since);
  const byRule = new Map<string, AutomationRunRecord[]>();
  for (const r of recent) byRule.set(r.ruleId, [...(byRule.get(r.ruleId) ?? []), r]);

  const items: RuleListItem[] = rules.map((rule) => {
    const ruleRuns = (byRule.get(rule.id) ?? []).sort((a, b) => (a.ranAt < b.ranAt ? 1 : -1));
    const errors = ruleRuns.filter((r) => r.status === "erro");
    return {
      id: rule.id,
      name: rule.name,
      description: rule.description,
      active: rule.active,
      triggerLabel: triggerLabel(rule),
      triggerKind: rule.trigger.type,
      conditions: rule.conditions.map(describeCondition),
      actions: rule.actions.map(describeAction),
      runCount: rule.runCount,
      lastRunAt: rule.lastRunAt,
      recentErrors: errors.length,
      recentIgnored: ruleRuns.filter((r) => r.status === "ignorada").length,
      lastError: errors[0]?.detail,
    };
  });
  return {
    rules: items,
    sweeps,
    stats: {
      active: rules.filter((r) => r.active).length,
      total: rules.length,
      runs7d: recent.filter((r) => r.status !== "ignorada").length,
      errors7d: recent.filter((r) => r.status === "erro").length,
    },
  };
}

export interface RecipientOption {
  value: string;
  label: string;
}

export interface EditorOptions {
  slaRules: { key: string; name: string }[];
  recipients: RecipientOption[];
  users: { id: string; name: string; departmentId: DepartmentKey; role: RoleKey }[];
}

export async function getEditorOptions(): Promise<EditorOptions> {
  const [slaRules, users] = await Promise.all([list<SlaRule>(COLLECTIONS.slaRules), list<User>(COLLECTIONS.users)]);
  const active = users.filter((u) => u.active !== false).sort((a, b) => a.name.localeCompare(b.name, "pt-BR"));
  const roles = Array.from(new Set(active.map((u) => u.role)));
  return {
    slaRules: slaRules.filter((r) => r.active !== false).map((r) => ({ key: r.key, name: r.name })).sort((a, b) => a.key.localeCompare(b.key)),
    recipients: [
      { value: "responsavel_entidade", label: "Responsável pelo registro" },
      { value: "responsavel_cliente", label: "Responsável pelo cliente no departamento" },
      { value: "gestor_departamento", label: "Gestor do departamento" },
      ...DEPARTMENT_KEYS.map((d) => ({ value: `department.${d}.managerId`, label: `Gestor de ${DEPARTMENT_LABELS[d]}` })),
      ...DEPARTMENT_KEYS.map((d) => ({ value: `departamento:${d}`, label: `Equipe de ${DEPARTMENT_LABELS[d]}` })),
      ...roles.map((r) => ({ value: `papel:${r}`, label: `Papel: ${ROLE_LABELS[r]}` })),
      ...active.map((u) => ({ value: u.id, label: `Usuário: ${u.name}` })),
    ],
    users: active.map((u) => ({ id: u.id, name: u.name, departmentId: u.departmentId, role: u.role })),
  };
}

export interface RuleDetail {
  rule: AutomationRuleRecord;
  runs: AutomationRunRecord[];
  stats: { total: number; success: number; errors: number; ignored: number };
}

export async function getRuleDetail(id: string): Promise<RuleDetail | null> {
  const raw = await getById<AutomationRule>(COLLECTIONS.automationRules, id);
  if (!raw) return null;
  const runs = (await list<AutomationRunRecord>(COLLECTIONS.automationRuns, { where: [["ruleId", "==", id]] })).sort((a, b) => (a.ranAt < b.ranAt ? 1 : -1));
  return {
    rule: normalizeRule(raw),
    runs: runs.slice(0, 50),
    stats: {
      total: runs.length,
      success: runs.filter((r) => r.status === "sucesso").length,
      errors: runs.filter((r) => r.status === "erro").length,
      ignored: runs.filter((r) => r.status === "ignorada").length,
    },
  };
}

/** Campos conhecidos por tipo de entidade (sugestões de caminho no editor). */
const ENTITY_FIELDS: Record<string, string[]> = {
  lead: ["status", "temperature", "score", "origin", "ownerId", "createdAt", "lastContactAt", "hoursSinceCreatedAt", "nextActionAt"],
  opportunity: ["stage", "temperature", "probability", "ownerId", "monthlyTotal", "setupTotal", "lastActivityAt", "hoursSinceLastActivity", "nextActionAt", "kind"],
  task: ["status", "priority", "assigneeId", "departmentId", "dueAt", "origin", "processType"],
  ticket: ["status", "priority", "queue", "channel", "assigneeId", "openedAt", "hoursSinceOpenedAt", "reopenCount", "csatScore"],
  project: ["status", "currentPhase", "progress", "ownerId", "dueDate", "externalDelayDays", "internalDelayDays"],
  renewal: ["status", "risk", "dueDate", "ownerId"],
  client: ["status", "healthLevel", "healthScore", "mrr", "currentStage", "ownerSalesId", "ownerCsId", "lastInteractionAt", "daysSinceLastInteraction"],
  contract: ["status", "financialStatus", "monthlyTotal", "setupTotal", "ownerId"],
  billing: ["status", "type", "amount", "dueDate"],
  success_plan: ["status", "origin", "ownerId", "checkpointAt"],
  workflow_step: ["stageKey", "status", "department", "assigneeId", "dueAt"],
  sla_instance: ["ruleKey", "entityType", "status", "ownerId", "dueAt"],
};

const COMMON_PATHS = ["client.tradeName", "client.status", "client.healthLevel", "client.healthScore", "client.mrr", "cs.adoptionPct", "cs.riskLevel", "cs.ownerId", "department.key", "department.managerId", "event.actorId", "event.title"];

/** Caminhos sugeridos para um tipo de evento: payload dos últimos eventos + campos da entidade + comuns. */
export async function getPathSuggestions(eventType: string | undefined, entity?: string): Promise<string[]> {
  const out = new Set<string>();
  let entityType = entity;
  if (eventType) {
    const events = (await list<DomainEvent>(COLLECTIONS.events, { where: [["type", "==", eventType]] })).sort((a, b) => (a.occurredAt < b.occurredAt ? 1 : -1)).slice(0, 20);
    for (const e of events) {
      for (const key of Object.keys(e.payload ?? {})) if (!key.startsWith("__")) out.add(`payload.${key}`);
      entityType ??= e.entityType;
    }
    if (eventType.startsWith("sla.")) for (const f of ENTITY_FIELDS.sla_instance) out.add(`sla.${f}`);
  }
  if (entityType) {
    for (const f of ENTITY_FIELDS[entityType] ?? ["status"]) {
      out.add(`entity.${f}`);
      out.add(`${entityType}.${f}`);
    }
  }
  for (const p of COMMON_PATHS) out.add(p);
  return Array.from(out);
}


