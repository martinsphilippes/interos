import "server-only";
/**
 * Agendador das automações: roda as varreduras nativas (sweeps.ts) e as regras agendadas que varrem
 * registros, respeitando a frequência de cada uma. O controle fica em settings/sweeps:
 *   value.automacoes.<chave>.{ lastRunAt, lastStatus, lastSummary, lastError, durationMs }
 * As regras agendadas guardam a própria última execução em automation_rules.lastScheduledAt.
 *
 * Chamado pela rota /api/cron/sweep (Vercel Cron, 1x por dia no plano Hobby), pelo botão
 * "Executar varreduras agora" em /admin/automacoes e, de forma preguiçosa, pelas telas dos módulos
 * (Central de Vendas, Saúde e Renovações do CS, Central de Suporte), que já rodam as suas.
 */
import { col, list, nowIso } from "@/server/db";
import { COLLECTIONS, type AutomationRule } from "@/domain/types";
import { bumpRuleRun, invalidateRulesCache, normalizeRule, recordStandaloneRun, runEntityScan } from "./engine";
import { LEGACY_LAST_RUN_FIELDS, SWEEPS, mergeSweepsSetting, readSweepsSetting } from "./sweeps";
import { SCHEDULE_INTERVAL_MS, SCHEDULE_LABELS, SCAN_ENTITY_LABELS, SWEEP_DEFINITIONS, SWEEP_KEYS, type AutomationRuleRecord, type RuleSchedule, type SweepKey } from "./schemas";

export interface SweepState {
  lastRunAt?: string;
  lastStatus?: "executada" | "erro";
  lastSummary?: string;
  lastError?: string;
  durationMs?: number;
}

export interface SweepStatusItem extends SweepState {
  key: SweepKey;
  label: string;
  description: string;
  schedule: RuleSchedule;
  /** Regras agendadas ativas que controlam a frequência desta varredura. */
  ruleIds: string[];
  nextRunAt?: string;
}

export interface SweepReportItem {
  key: string;
  label: string;
  kind: "varredura" | "regra";
  status: "executada" | "pulada" | "erro";
  summary: string;
  durationMs?: number;
}

export interface SweepReport {
  ranAt: string;
  forced: boolean;
  items: SweepReportItem[];
}

const SCHEDULE_ORDER: RuleSchedule[] = ["horaria", "diaria", "semanal"];

function effectiveSchedule(key: SweepKey, rules: AutomationRuleRecord[]): { schedule: RuleSchedule; ruleIds: string[] } {
  const linked = rules.filter((r) => r.trigger.type === "agendado" && r.trigger.sweep === key);
  if (linked.length === 0) return { schedule: SWEEP_DEFINITIONS[key].schedule, ruleIds: [] };
  // A regra mais frequente manda.
  const schedule = linked.map((r) => r.trigger.schedule as RuleSchedule).sort((a, b) => SCHEDULE_ORDER.indexOf(a) - SCHEDULE_ORDER.indexOf(b))[0];
  return { schedule, ruleIds: linked.map((r) => r.id) };
}

async function readState(): Promise<{ automacoes: Record<string, SweepState>; raw: Record<string, unknown> }> {
  const doc = await readSweepsSetting();
  const raw = (doc?.value ?? {}) as Record<string, unknown>;
  return { automacoes: (raw.automacoes ?? {}) as Record<string, SweepState>, raw };
}

function lastRunOf(key: SweepKey, state: { automacoes: Record<string, SweepState>; raw: Record<string, unknown> }): string | undefined {
  const own = state.automacoes[key]?.lastRunAt;
  const legacyField = LEGACY_LAST_RUN_FIELDS[key];
  const legacy = legacyField && typeof state.raw[legacyField] === "string" ? (state.raw[legacyField] as string) : undefined;
  return [own, legacy].filter((v): v is string => Boolean(v)).sort().pop();
}

async function activeScheduledRules(): Promise<AutomationRuleRecord[]> {
  const raw = await list<AutomationRule>(COLLECTIONS.automationRules, { where: [["active", "==", true]] });
  return raw.map(normalizeRule).filter((r) => r.trigger.type === "agendado");
}

/** Situação das varreduras para a tela de automações. */
export async function getSweepStatus(): Promise<SweepStatusItem[]> {
  const [state, rules] = await Promise.all([readState(), activeScheduledRules()]);
  return SWEEP_KEYS.map((key) => {
    const { schedule, ruleIds } = effectiveSchedule(key, rules);
    const lastRunAt = lastRunOf(key, state);
    return {
      ...state.automacoes[key],
      key,
      label: SWEEP_DEFINITIONS[key].label,
      description: SWEEP_DEFINITIONS[key].description,
      schedule,
      ruleIds,
      lastRunAt,
      nextRunAt: lastRunAt ? new Date(new Date(lastRunAt).getTime() + SCHEDULE_INTERVAL_MS[schedule]).toISOString() : undefined,
    };
  });
}

/**
 * Roda as varreduras vencidas (ou todas, com force) e as regras agendadas de varredura de registros.
 * `only` restringe a chaves de varredura e/ou IDs de regra.
 */
export async function runSweeps(options: { only?: string[]; force?: boolean } = {}): Promise<SweepReport> {
  const force = options.force === true;
  const only = options.only && options.only.length > 0 ? new Set(options.only) : null;
  const now = new Date();
  const ranAt = now.toISOString();
  const [state, rules] = await Promise.all([readState(), activeScheduledRules()]);
  const items: SweepReportItem[] = [];

  for (const key of SWEEP_KEYS) {
    if (only && !only.has(key)) continue;
    const def = SWEEP_DEFINITIONS[key];
    const { schedule, ruleIds } = effectiveSchedule(key, rules);
    const last = lastRunOf(key, state);
    if (!force && last && now.getTime() - new Date(last).getTime() < SCHEDULE_INTERVAL_MS[schedule]) {
      items.push({ key, label: def.label, kind: "varredura", status: "pulada", summary: `${SCHEDULE_LABELS[schedule]}; última execução em ${new Date(last).toLocaleString("pt-BR", { timeZone: "America/Sao_Paulo" })}` });
      continue;
    }
    // Marca antes de rodar para que chamadas simultâneas não repitam a varredura.
    await mergeSweepsSetting({ automacoes: { [key]: { lastRunAt: ranAt } } });
    const started = Date.now();
    try {
      const outcome = await SWEEPS[key](now);
      const durationMs = Date.now() - started;
      await mergeSweepsSetting({ automacoes: { [key]: { lastRunAt: ranAt, lastStatus: "executada", lastSummary: outcome.summary, lastError: null, durationMs } } });
      items.push({ key, label: def.label, kind: "varredura", status: "executada", summary: outcome.summary, durationMs });
      for (const ruleId of ruleIds) {
        const rule = rules.find((r) => r.id === ruleId)!;
        await recordStandaloneRun(rule, { status: "sucesso", detail: `${def.label}: ${outcome.summary}`, trigger: "agendado" });
        await bumpRuleRun(rule.id);
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      console.error(`[automacoes] varredura ${key} falhou`, error);
      const durationMs = Date.now() - started;
      await mergeSweepsSetting({ automacoes: { [key]: { lastRunAt: ranAt, lastStatus: "erro", lastError: message, durationMs } } });
      items.push({ key, label: def.label, kind: "varredura", status: "erro", summary: message, durationMs });
      for (const ruleId of ruleIds) {
        const rule = rules.find((r) => r.id === ruleId)!;
        await recordStandaloneRun(rule, { status: "erro", detail: `${def.label}: ${message}`, trigger: "agendado" });
      }
    }
  }

  // Regras agendadas que varrem registros (trigger.entity).
  for (const rule of rules.filter((r) => r.trigger.entity)) {
    if (only && !only.has(rule.id)) continue;
    const schedule = rule.trigger.schedule as RuleSchedule;
    if (!force && rule.lastScheduledAt && now.getTime() - new Date(rule.lastScheduledAt).getTime() < SCHEDULE_INTERVAL_MS[schedule]) {
      items.push({ key: rule.id, label: rule.name, kind: "regra", status: "pulada", summary: `${SCHEDULE_LABELS[schedule]}; última execução em ${new Date(rule.lastScheduledAt).toLocaleString("pt-BR", { timeZone: "America/Sao_Paulo" })}` });
      continue;
    }
    await col(COLLECTIONS.automationRules).doc(rule.id).update({ lastScheduledAt: nowIso() });
    const started = Date.now();
    try {
      const scan = await runEntityScan(rule);
      const target = SCAN_ENTITY_LABELS[rule.trigger.entity!].toLowerCase();
      items.push({
        key: rule.id,
        label: rule.name,
        kind: "regra",
        status: scan.errors > 0 && scan.executed === 0 ? "erro" : "executada",
        summary: `${scan.scanned} ${target} · ${scan.matched} atendem às condições · ${scan.executed} execução(ões) · ${scan.skipped} já tratada(s)${scan.errors ? ` · ${scan.errors} erro(s)` : ""}`,
        durationMs: Date.now() - started,
      });
    } catch (error) {
      console.error(`[automacoes] regra agendada ${rule.id} falhou`, error);
      items.push({ key: rule.id, label: rule.name, kind: "regra", status: "erro", summary: error instanceof Error ? error.message : String(error), durationMs: Date.now() - started });
    }
  }
  invalidateRulesCache();
  return { ranAt, forced: force, items };
}
