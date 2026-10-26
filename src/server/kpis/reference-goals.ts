import "server-only";
/**
 * Metas de referência efetivas (ver src/domain/reference-goals.ts): a meta mensal do KPI correspondente é a fonte única;
 * a configuração `metas_referencia` só vale enquanto o KPI não existe ou não tem meta. Todos os leitores usam daqui.
 */
import { list, update } from "@/server/db";
import { getSetting } from "@/server/admin/queries";
import { SETTING_DEFAULTS, type MetasReferencia } from "@/server/admin/schemas";
import { COLLECTIONS, type Kpi } from "@/domain/types";
import { REFERENCE_GOALS, resolveReferenceGoals, type ReferenceGoalRow } from "@/domain/reference-goals";

async function loadKpis(): Promise<Kpi[]> {
  return list<Kpi>(COLLECTIONS.kpis, { where: [["key", "in", REFERENCE_GOALS.map((g) => g.kpiKey)]] });
}

/** Linhas da tela (com departamento, KPI e origem do valor). */
export async function getReferenceGoalRows(): Promise<ReferenceGoalRow[]> {
  const [setting, kpis] = await Promise.all([getSetting<MetasReferencia>("metas_referencia", SETTING_DEFAULTS.metas_referencia), loadKpis()]);
  return resolveReferenceGoals(setting, kpis);
}

/** Metas efetivas no formato da configuração (o que os painéis, alertas e relatórios usam). */
export async function getReferenceGoals(): Promise<MetasReferencia> {
  const rows = await getReferenceGoalRows();
  return Object.fromEntries(rows.map((r) => [r.field, r.value])) as MetasReferencia;
}

/** Depois de salvar a aba: leva cada valor para a meta mensal do KPI correspondente (quando o KPI existe). */
export async function syncReferenceGoalsToKpis(value: MetasReferencia): Promise<string[]> {
  const kpis = await loadKpis();
  const changed: string[] = [];
  for (const def of REFERENCE_GOALS) {
    const kpi = kpis.find((k) => k.key === def.kpiKey);
    const next = value[def.field];
    if (!kpi || typeof next !== "number" || kpi.target === next) continue;
    await update<Kpi>(COLLECTIONS.kpis, kpi.id, { target: next });
    changed.push(kpi.key);
  }
  return changed;
}
