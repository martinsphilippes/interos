import "server-only";
/**
 * Saúde da operação (Cockpit, Dashboard do Gestor) e Índice de desempenho (Meu Desempenho, equipe).
 *
 * Os dois são VISÕES do motor de indicadores: nenhum número novo é apurado aqui, só combinado.
 *
 * Saúde da operação (setting "saude_operacao", criado com os padrões na primeira leitura):
 *   cada componente (produtividade, SLA, qualidade, atrasos, satisfação, metas) tem indicadores com peso e uma
 *   normalização para 0–100 (health-schemas.ts). Nota do componente = média ponderada das notas dos indicadores
 *   com dado; nota geral = média ponderada dos componentes com dado; faixa pelos limiares configurados.
 *   "metas" = atingimento médio (peso da meta, cada uma limitada a 100%) das metas do período no escopo.
 *
 * Índice de desempenho (setting "indice_desempenho", por departamento): Eficiência, Entrega e Qualidade a
 *   partir do scorecard da função. Nota do indicador = atingimento da meta (limitado a 100%); sem meta, um
 *   percentual vale direto (invertido quando menor é melhor); os demais ficam fora.
 */
import { create, getById, list } from "@/server/db";
import { COLLECTIONS, type Goal, type Settings, type User } from "@/domain/types";
import { DEPARTMENT_LABELS, type DepartmentKey } from "@/domain/constants";
import { computeKpiBatch, computeKpis, type KpiResult } from "./engine";
import { getUserScorecard, type Scorecard } from "./queries";
import type { Period } from "./period";
import { formatKpiValue, kpiHref } from "./schemas";
import {
  DEFAULT_OPERATION_HEALTH,
  DEFAULT_PERFORMANCE_INDEX,
  GOALS_ENTRY_KEY,
  PERFORMANCE_DIMENSIONS,
  PERFORMANCE_DIMENSION_LABELS,
  bandFor,
  bandTone,
  describeNormalization,
  mergeOperationHealth,
  mergePerformanceIndex,
  normalizeValue,
  type HealthBand,
  type OperationHealthConfig,
  type PerformanceDimension,
  type PerformanceIndexConfig,
} from "./health-schemas";
import type { Tone } from "@/components/ui/tone";

export const OPERATION_HEALTH_SETTING = "saude_operacao";
export const PERFORMANCE_INDEX_SETTING = "indice_desempenho";

// ---------------------------------------------------------------------------
// Configuração
// ---------------------------------------------------------------------------

async function readOrCreate(key: string, fallback: Record<string, unknown>, description: string): Promise<unknown> {
  const docs = await list<Settings>(COLLECTIONS.settings, { where: [["key", "==", key]] });
  if (docs[0]) return docs[0].value;
  await create<Settings>(COLLECTIONS.settings, { key, value: fallback, description }, `setting_${key}`);
  return fallback;
}

export async function getOperationHealthConfig(): Promise<OperationHealthConfig> {
  const value = await readOrCreate(
    OPERATION_HEALTH_SETTING,
    DEFAULT_OPERATION_HEALTH as unknown as Record<string, unknown>,
    "Componentes, pesos, normalização e faixas do índice de Saúde da operação (Cockpit e Dashboard do Gestor).",
  );
  return mergeOperationHealth(value);
}

export async function getPerformanceIndexConfig(): Promise<PerformanceIndexConfig> {
  const value = await readOrCreate(
    PERFORMANCE_INDEX_SETTING,
    DEFAULT_PERFORMANCE_INDEX as unknown as Record<string, unknown>,
    "Pesos e indicadores de Eficiência, Entrega e Qualidade do Índice de desempenho, por departamento.",
  );
  return mergePerformanceIndex(value);
}

// ---------------------------------------------------------------------------
// Saúde da operação
// ---------------------------------------------------------------------------

export type HealthScope = { kind: "empresa" } | { kind: "departamento"; department: DepartmentKey };

export interface HealthItem {
  kpiKey: string;
  name: string;
  weight: number;
  value: number | null;
  valueText: string;
  /** Nota 0–100 (null = sem dado, fica fora da média). */
  score: number | null;
  normalization: string;
  href: string | null;
  note?: string;
}

export interface HealthComponent {
  key: string;
  label: string;
  description?: string;
  weight: number;
  score: number | null;
  /** Peso efetivo entre os componentes com dado (fração). */
  share: number | null;
  /** Pontos que o componente soma à nota geral (share × nota). */
  contribution: number | null;
  items: HealthItem[];
  href: string | null;
}

export interface OperationHealth {
  period: Period;
  scope: HealthScope;
  scopeLabel: string;
  score: number | null;
  band: HealthBand | null;
  tone: Tone;
  components: HealthComponent[];
  bands: HealthBand[];
}

function weightedMean(parts: { weight: number; score: number | null }[]): number | null {
  const scored = parts.filter((p) => p.score !== null && p.weight > 0);
  const weight = scored.reduce((s, p) => s + p.weight, 0);
  return weight > 0 ? scored.reduce((s, p) => s + p.weight * (p.score as number), 0) / weight : null;
}

/**
 * Metas do período no escopo e o atingimento médio ponderado (peso da meta, cada uma limitada a 100%).
 * Empresa: metas da empresa e dos departamentos (`companyOnly`: só as da empresa, a "Meta global" do Cockpit);
 * departamento: metas do departamento e dos seus colaboradores.
 */
export async function goalsAttainment(period: Period, scope: HealthScope, options: { companyOnly?: boolean } = {}): Promise<{ attainment: number | null; count: number; href: string }> {
  if (period.kind !== "mes") return { attainment: null, count: 0, href: `/performance/metas?periodo=${period.key}` };
  const [goals, users] = await Promise.all([list<Goal>(COLLECTIONS.goals, { where: [["period", "==", period.key]] }), list<User>(COLLECTIONS.users)]);
  const usersOf = new Set(scope.kind === "departamento" ? users.filter((u) => u.departmentId === scope.department).map((u) => u.id) : []);
  const inScope = goals.filter((g) =>
    scope.kind === "empresa" ? g.scope === "empresa" || (!options.companyOnly && g.scope === "departamento") : (g.scope === "departamento" && g.scopeId === scope.department) || (g.scope === "usuario" && g.scopeId !== undefined && usersOf.has(g.scopeId)),
  );
  const href = `/performance/metas?periodo=${period.key}`;
  if (inScope.length === 0) return { attainment: null, count: 0, href };
  const groups = new Map<string, Goal[]>();
  for (const g of inScope) groups.set(`${g.scope}|${g.scopeId ?? ""}`, [...(groups.get(`${g.scope}|${g.scopeId ?? ""}`) ?? []), g]);
  const entries = Array.from(groups.values());
  const batch = await computeKpiBatch(
    entries.map((gs) => ({ keys: gs.map((g) => g.kpiKey), scope: gs[0].scope, scopeId: gs[0].scopeId })),
    period,
    { withTrend: false, withSources: false },
  );
  const parts: { weight: number; score: number | null }[] = [];
  entries.forEach((gs, i) => {
    for (const g of gs) {
      const r = batch[i].find((x) => x.goalId === g.id) ?? batch[i].find((x) => x.key === g.kpiKey);
      parts.push({ weight: g.weight || 1, score: r?.attainment === null || r?.attainment === undefined ? null : Math.min(1, r.attainment) });
    }
  });
  return { attainment: weightedMean(parts), count: inScope.length, href };
}

/**
 * Saúde da operação no período para a empresa ou um departamento: nota 0–100, faixa e componentes com a
 * contribuição de cada um e o link de drill-down de cada indicador.
 */
export async function computeOperationHealth(period: Period, scope: HealthScope = { kind: "empresa" }): Promise<OperationHealth> {
  const config = await getOperationHealthConfig();
  const keys = new Set<string>();
  for (const c of config.componentes) {
    for (const k of c.kpis) {
      if (k.normalizacao.tipo === "metas_periodo" || k.kpiKey === GOALS_ENTRY_KEY) continue;
      keys.add(k.kpiKey);
      if (k.normalizacao.baseKpi) keys.add(k.normalizacao.baseKpi);
    }
  }
  const needsGoals = config.componentes.some((c) => c.kpis.some((k) => k.normalizacao.tipo === "metas_periodo" || k.kpiKey === GOALS_ENTRY_KEY));
  const [results, goals] = await Promise.all([
    computeKpis(Array.from(keys), period, scope.kind === "empresa" ? "empresa" : "departamento", scope.kind === "departamento" ? scope.department : undefined, { withTrend: false, withSources: false }),
    needsGoals ? goalsAttainment(period, scope) : Promise.resolve(null),
  ]);
  const byKey = new Map<string, KpiResult>(results.map((r) => [r.key, r]));

  const components: HealthComponent[] = config.componentes.map((c) => {
    const items: HealthItem[] = c.kpis.map((entry) => {
      if (entry.normalizacao.tipo === "metas_periodo" || entry.kpiKey === GOALS_ENTRY_KEY) {
        const score = normalizeValue({ tipo: "metas_periodo" }, null, { attainment: goals?.attainment ?? null });
        return {
          kpiKey: GOALS_ENTRY_KEY,
          name: "Metas do período",
          weight: entry.peso,
          value: goals?.attainment ?? null,
          valueText: goals && goals.attainment !== null ? `${Math.round(goals.attainment * 100)}% em ${goals.count} meta(s)` : "Sem metas cadastradas",
          score,
          normalization: describeNormalization({ tipo: "metas_periodo" }),
          href: goals?.href ?? null,
          note: goals && goals.count === 0 ? "Nenhuma meta cadastrada para o período neste escopo." : undefined,
        };
      }
      const r = byKey.get(entry.kpiKey);
      const base = entry.normalizacao.baseKpi ? byKey.get(entry.normalizacao.baseKpi) : undefined;
      const score = r ? normalizeValue(entry.normalizacao, r.value, { attainment: r.attainment, base: base?.value ?? null }) : null;
      return {
        kpiKey: entry.kpiKey,
        name: r?.kpi.name ?? entry.kpiKey,
        weight: entry.peso,
        value: r?.value ?? null,
        valueText: r ? formatKpiValue(r.value, r.kpi.unit, r.kpi.formulaMeta?.suffix) : "—",
        score,
        normalization: describeNormalization(entry.normalizacao, base?.kpi.name),
        href: r?.href ?? null,
        note: r ? (r.value === null ? (r.note ?? "Sem dado no período.") : undefined) : "Indicador inexistente no registro de fórmulas.",
      };
    });
    const score = weightedMean(items.map((i) => ({ weight: i.weight, score: i.score })));
    return { key: c.key, label: c.label, description: c.descricao, weight: c.peso, score, share: null, contribution: null, items, href: items.find((i) => i.href)?.href ?? null };
  });

  const scoredWeight = components.filter((c) => c.score !== null && c.weight > 0).reduce((s, c) => s + c.weight, 0);
  for (const c of components) {
    if (c.score === null || scoredWeight <= 0) continue;
    c.share = c.weight / scoredWeight;
    c.contribution = c.share * c.score;
  }
  const score = weightedMean(components.map((c) => ({ weight: c.weight, score: c.score })));
  const band = bandFor(score, config.faixas);
  return {
    period,
    scope,
    scopeLabel: scope.kind === "empresa" ? "Empresa" : DEPARTMENT_LABELS[scope.department],
    score: score === null ? null : Math.round(score * 10) / 10,
    band,
    tone: bandTone(band, config.faixas),
    components,
    bands: config.faixas,
  };
}

// ---------------------------------------------------------------------------
// Índice de desempenho
// ---------------------------------------------------------------------------

export interface IndexItem {
  kpiKey: string;
  name: string;
  score: number | null;
  valueText: string;
  basis: "meta" | "percentual" | null;
  href: string;
}

export interface IndexDimension {
  key: PerformanceDimension;
  label: string;
  weight: number;
  score: number | null;
  items: IndexItem[];
}

export interface PerformanceIndex {
  userId: string;
  department: DepartmentKey;
  period: Period;
  score: number | null;
  band: HealthBand | null;
  tone: Tone;
  meta: number;
  dimensions: IndexDimension[];
}

/** Nota 0–100 de um resultado do motor para o índice (ver regra no topo do arquivo). */
function indexScore(r: KpiResult): { score: number | null; basis: IndexItem["basis"] } {
  if (r.attainment !== null) return { score: Math.min(1, r.attainment) * 100, basis: "meta" };
  if (r.value !== null && r.kpi.unit === "percentual" && r.kpi.direction !== "faixa") {
    const v = r.kpi.direction === "menor_melhor" ? 1 - r.value : r.value;
    return { score: Math.max(0, Math.min(100, v * 100)), basis: "percentual" };
  }
  return { score: null, basis: null };
}

/**
 * Índice de desempenho do colaborador no período (0–100) com as dimensões Eficiência, Entrega e Qualidade.
 * Aceita o scorecard já calculado (evita recalcular na mesma requisição).
 */
export async function computePerformanceIndex(userId: string, period: Period, precomputed?: Scorecard | null, preloadedConfig?: PerformanceIndexConfig): Promise<PerformanceIndex | null> {
  const [config, user] = await Promise.all([preloadedConfig ? Promise.resolve(preloadedConfig) : getPerformanceIndexConfig(), getById<User>(COLLECTIONS.users, userId)]);
  if (!user) return null;
  const scorecard = precomputed ?? (await getUserScorecard(userId, period, { withTrend: false, withSources: false }));
  if (!scorecard) return null;
  return indexFromScorecard(user, scorecard, config);
}

/** Índice a partir de um scorecard já calculado (sem nova consulta; indicadores fora do scorecard ficam de fora). */
export function indexFromScorecard(user: Pick<User, "id" | "departmentId">, scorecard: Scorecard, config: PerformanceIndexConfig): PerformanceIndex {
  const dep = config.departamentos[user.departmentId] ?? DEFAULT_PERFORMANCE_INDEX.departamentos[user.departmentId];
  const byKey = new Map(scorecard.items.map((r) => [r.key, r]));
  const dimensions: IndexDimension[] = PERFORMANCE_DIMENSIONS.map((key) => {
    const items: IndexItem[] = (dep.indicadores[key] ?? [])
      .map((k) => byKey.get(k))
      .filter((r): r is KpiResult => Boolean(r))
      .map((r) => {
        const s = indexScore(r);
        return { kpiKey: r.key, name: r.kpi.name, score: s.score, basis: s.basis, valueText: formatKpiValue(r.value, r.kpi.unit, r.kpi.formulaMeta?.suffix), href: r.href || kpiHref(r.key, scorecard.period, scorecard.subject.scope, scorecard.subject.id) };
      });
    const scored = items.filter((i) => i.score !== null);
    const score = scored.length > 0 ? scored.reduce((s, i) => s + (i.score as number), 0) / scored.length : null;
    return { key, label: PERFORMANCE_DIMENSION_LABELS[key], weight: dep.pesos[key], score, items };
  });
  const raw = weightedMean(dimensions.map((d) => ({ weight: d.weight, score: d.score })));
  const score = raw === null ? null : Math.round(raw);
  const band = bandFor(score, config.faixas);
  return { userId: user.id, department: user.departmentId, period: scorecard.period, score, band, tone: bandTone(band, config.faixas), meta: config.meta, dimensions };
}
