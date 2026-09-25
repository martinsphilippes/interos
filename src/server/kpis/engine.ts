import "server-only";
import { computeAttainment } from "./attainment";
/**
 * Motor de indicadores: valor (fórmula do registro) + meta (goals do período/escopo, senão a meta do
 * indicador) + atingimento + status + tendência + registros de origem. Também grava snapshots mensais,
 * monta o histórico e reage a eventos que alteram números (invalidação de cache, kpi.updated e metas
 * atingidas).
 */
import { batchSet, list, nowIso, ORG_ID } from "@/server/db";
import { emitEvent } from "@/server/events";
import { notify } from "@/server/notifications";
import { COLLECTIONS, type DomainEvent, type Goal, type Kpi, type KpiSnapshot, type User, type UserRef } from "@/domain/types";
import { DEPARTMENT_KEYS, type DepartmentKey } from "@/domain/constants";
import { formatCompetence } from "@/lib/format";
import { getFormula, invalidateDataBundle, loadDataBundle, type DataBundle, type KpiFormula, type KpiFormulaMeta, type KpiSource } from "./formulas";
import { currentMonthKey, isCurrentPeriod, listRecentMonths, monthPeriod, periodMonths, previousPeriod, type Period } from "./period";
import { formatKpiValue, kpiHref, type KpiScope, type KpiStatus } from "./schemas";

// ---------------------------------------------------------------------------
// Tipos públicos
// ---------------------------------------------------------------------------

/** Definição efetiva: documento de `kpis` (ou definição virtual criada a partir do registro de fórmulas). */
export interface KpiDefinition extends Kpi {
  formulaMeta: KpiFormulaMeta | null;
  /** true quando não há documento em `kpis` (definição derivada do registro, sem meta própria). */
  virtual: boolean;
}

export interface KpiTrend {
  period: Period;
  value: number | null;
  delta: number | null;
  /** Variação relativa (fração); null com base zero. */
  deltaPct: number | null;
  direction: "up" | "down" | "flat" | null;
  /** A variação é boa considerando o sentido do indicador (null para faixa ou sem base). */
  favorable: boolean | null;
  /** O valor anterior veio de snapshot gravado (e não do cálculo ao vivo). */
  fromSnapshot: boolean;
}

export type TargetSource = "meta" | "meta_colaborador" | "indicador";

export interface KpiResult {
  key: string;
  kpi: KpiDefinition;
  period: Period;
  scope: KpiScope;
  scopeId?: string;
  value: number | null;
  numerator?: number;
  denominator?: number;
  note?: string;
  target: number | null;
  targetMin?: number;
  targetMax?: number;
  targetSource: TargetSource | null;
  goalId?: string;
  weight: number;
  attainment: number | null;
  status: KpiStatus | null;
  trend: KpiTrend | null;
  sourceIds: KpiSource[];
  /** Link do drill-down deste resultado. */
  href: string;
}

export interface ComputeOptions {
  /** Calcula a tendência (período anterior). Padrão: true. */
  withTrend?: boolean;
  /** Mantém os registros de origem. Padrão: true. */
  withSources?: boolean;
}

export interface HistoryPoint {
  period: string;
  label: string;
  value: number | null;
  target: number | null;
  attainment: number | null;
  status: KpiStatus | null;
  source: "snapshot" | "ao_vivo";
}

// ---------------------------------------------------------------------------
// Mapas de função → indicadores
// ---------------------------------------------------------------------------

/** Indicadores relevantes por departamento/função (scorecards do Meu Desempenho e do gestor). */
export const SCORECARD_KEYS: Record<DepartmentKey, string[]> = {
  marketing: ["leads_captados", "mqls", "cpl", "conversao_mql"],
  vendas: ["novas_vendas", "receita_vendida", "ticket_medio", "conversao_funil", "followups_atrasados", "setup_vendido", "recorrencia_vendida", "hardware_vendido"],
  financeiro: ["faturamento", "recebido", "inadimplencia", "mrr", "tempo_liberacao_dias"],
  implantacao: ["implantacoes_concluidas", "entregas_prazo", "ativacao_7_dias", "tempo_medio_implantacao", "chamados_30_dias", "produtividade"],
  cs: ["saude_cliente", "clientes_risco", "taxa_renovacao", "churn", "upsell_gerado", "adocao_media"],
  suporte: ["sla_resposta", "sla_solucao", "csat", "reincidencia", "chamados_resolvidos", "oportunidades_suporte"],
  administrativo: ["tarefas_concluidas", "tarefas_no_prazo_pct", "tarefas_atrasadas"],
  diretoria: ["mrr", "receita_vendida", "churn", "saude_cliente", "sla_solucao", "entregas_prazo"],
};

/** Chaves de `user.monthlyGoals` (metas padrão do cadastro) → indicador. */
const MONTHLY_GOAL_KEYS: Record<string, string> = {
  leads: "leads_captados",
  mqls: "mqls",
  setup: "setup_vendido",
  recorrencia: "recorrencia_vendida",
  hardware: "hardware_vendido",
  inadimplencia: "inadimplencia",
  mrr_crescimento: "crescimento_mrr",
  prazo: "entregas_prazo",
  ativacao7: "ativacao_7_dias",
  csat: "csat",
  sla_resposta: "sla_resposta",
  sla_solucao: "sla_solucao",
  saude_cliente: "saude_cliente",
  taxa_renovacao: "taxa_renovacao",
};

/** Chaves de meta aceitas como sinônimos (compatibilidade com o comissionamento de Vendas). */
const GOAL_ALIASES: Record<string, string[]> = {
  setup_vendido: ["setup", "vendas_setup", "meta_setup"],
  recorrencia_vendida: ["recorrencia", "vendas_recorrencia", "meta_recorrencia"],
  hardware_vendido: ["hardware", "vendas_hardware", "meta_hardware"],
};

const DEFAULT_ATTENTION_PCT = 85;
const SYSTEM_ACTOR: UserRef = { id: "system", name: "INTEROS (indicadores)" };

// ---------------------------------------------------------------------------
// Definições
// ---------------------------------------------------------------------------

function virtualDefinition(formula: KpiFormula): KpiDefinition {
  const { compute: _compute, ...meta } = formula;
  void _compute;
  return {
    id: `kpi_${formula.key}`,
    organizationId: "",
    createdAt: "",
    updatedAt: "",
    key: formula.key,
    name: formula.label,
    department: formula.department,
    description: formula.description,
    formula: formula.key,
    source: formula.source,
    period: "mensal",
    unit: formula.unit,
    direction: formula.direction,
    attentionPct: DEFAULT_ATTENTION_PCT,
    weight: 1,
    active: true,
    formulaMeta: meta,
    virtual: true,
  };
}

function toDefinition(doc: Kpi): KpiDefinition {
  const formula = getFormula(doc.formula);
  let formulaMeta: KpiFormulaMeta | null = null;
  if (formula) {
    const { compute: _compute, ...meta } = formula;
    void _compute;
    formulaMeta = meta;
  }
  return { ...doc, attentionPct: doc.attentionPct ?? DEFAULT_ATTENTION_PCT, weight: doc.weight ?? 1, formulaMeta, virtual: false };
}

/** Definição por chave: documento de `kpis` quando existe; senão, a definição virtual do registro. */
export function resolveDefinition(key: string, docs: Kpi[]): KpiDefinition | null {
  const doc = docs.find((k) => k.key === key);
  if (doc) return toDefinition(doc);
  const formula = getFormula(key);
  return formula ? virtualDefinition(formula) : null;
}

export async function loadKpiDocs(): Promise<Kpi[]> {
  return list<Kpi>(COLLECTIONS.kpis);
}

// ---------------------------------------------------------------------------
// Meta, atingimento e status
// ---------------------------------------------------------------------------

export { computeAttainment };

export function statusFor(attainment: number | null, attentionPct = DEFAULT_ATTENTION_PCT): KpiStatus | null {
  if (attainment === null) return null;
  if (attainment >= 1) return "atingida";
  if (attainment >= attentionPct / 100) return "atencao";
  return "critico";
}

function sameScopeId(a: string | undefined, b: string | undefined): boolean {
  return (a || undefined) === (b || undefined);
}

/** empresa ≡ departamento dono do indicador (a regra de escopo das fórmulas dá o mesmo número). */
function equivalentScopes(def: KpiDefinition, scope: KpiScope, scopeId?: string): { scope: KpiScope; scopeId?: string }[] {
  const own = def.formulaMeta?.department ?? def.department;
  const out: { scope: KpiScope; scopeId?: string }[] = [{ scope, scopeId }];
  if (scope === "empresa" && own !== "empresa") out.push({ scope: "departamento", scopeId: own });
  if (scope === "departamento" && (scopeId === own || scopeId === def.department)) out.push({ scope: "empresa" });
  return out;
}

interface TargetInfo {
  target: number | null;
  targetMin?: number;
  targetMax?: number;
  source: TargetSource | null;
  goalId?: string;
  weight: number;
}

function findGoal(goals: Goal[], def: KpiDefinition, periodKey: string, scope: KpiScope, scopeId?: string): Goal | undefined {
  const keys = [def.key, ...(GOAL_ALIASES[def.key] ?? [])];
  for (const candidate of equivalentScopes(def, scope, scopeId)) {
    const goal = goals.find((g) => g.period === periodKey && keys.includes(g.kpiKey) && g.scope === candidate.scope && sameScopeId(g.scopeId, candidate.scopeId));
    if (goal) return goal;
  }
  return undefined;
}

function resolveTarget(def: KpiDefinition, period: Period, scope: KpiScope, scopeId: string | undefined, goals: Goal[], users: Map<string, User>): TargetInfo {
  const kind = def.formulaMeta?.kind ?? "taxa";
  const scale = kind === "fluxo" ? periodMonths(period) : 1;
  const goal = period.kind === "mes" ? findGoal(goals, def, period.key, scope, scopeId) : undefined;
  if (goal) return { target: goal.target, source: "meta", goalId: goal.id, weight: goal.weight ?? def.weight };

  if (scope === "usuario" && scopeId) {
    const personal = users.get(scopeId)?.monthlyGoals ?? {};
    const entry = Object.entries(personal).find(([k]) => k === def.key || MONTHLY_GOAL_KEYS[k] === def.key);
    if (entry && typeof entry[1] === "number") return { target: entry[1] * scale, source: "meta_colaborador", weight: def.weight };
  }

  const own = def.formulaMeta?.department ?? def.department;
  const companyLevel = scope === "empresa" || (scope === "departamento" && (scopeId === own || scopeId === def.department));
  // Metas de volume (fluxo) da empresa não valem para um colaborador ou outro departamento.
  if (kind === "fluxo" && !companyLevel) return { target: null, source: null, weight: def.weight };
  if (def.target === undefined && def.targetMin === undefined && def.targetMax === undefined) return { target: null, source: null, weight: def.weight };
  return {
    target: def.target !== undefined ? def.target * scale : null,
    targetMin: def.targetMin !== undefined ? def.targetMin * scale : undefined,
    targetMax: def.targetMax !== undefined ? def.targetMax * scale : undefined,
    source: "indicador",
    weight: def.weight,
  };
}

// ---------------------------------------------------------------------------
// Snapshots
// ---------------------------------------------------------------------------

export function snapshotDocId(kpiKey: string, periodKey: string, scope: KpiScope, scopeId?: string): string {
  return `snap_${kpiKey}_${periodKey}_${scope}_${scopeId || "org"}`;
}

function matchSnapshot(snaps: KpiSnapshot[], def: KpiDefinition, periodKey: string, scope: KpiScope, scopeId?: string): KpiSnapshot | undefined {
  for (const candidate of equivalentScopes(def, scope, scopeId)) {
    const found = snaps
      .filter((s) => s.kpiKey === def.key && s.period === periodKey && s.scope === candidate.scope && sameScopeId(s.scopeId, candidate.scopeId))
      .sort((a, b) => (a.computedAt < b.computedAt ? 1 : -1))[0];
    if (found) return found;
  }
  return undefined;
}

// ---------------------------------------------------------------------------
// Cálculo
// ---------------------------------------------------------------------------

interface EngineInput {
  docs: Kpi[];
  goals: Goal[];
  users: Map<string, User>;
  /** Snapshots por competência, lidos uma vez por cálculo em lote. */
  snapshots: Map<string, Promise<KpiSnapshot[]>>;
}

function snapshotsOf(input: EngineInput, periodKey: string): Promise<KpiSnapshot[]> {
  let cached = input.snapshots.get(periodKey);
  if (!cached) {
    cached = list<KpiSnapshot>(COLLECTIONS.kpiSnapshots, { where: [["period", "==", periodKey]] });
    input.snapshots.set(periodKey, cached);
  }
  return cached;
}

async function loadEngineInput(periodKeys: string[]): Promise<EngineInput> {
  const monthKeys = Array.from(new Set(periodKeys.filter((k) => /^\d{4}-\d{2}$/.test(k))));
  const [docs, goals, users] = await Promise.all([
    loadKpiDocs(),
    monthKeys.length > 0 ? list<Goal>(COLLECTIONS.goals, { where: [["period", "in", monthKeys]] }) : Promise.resolve([] as Goal[]),
    list<User>(COLLECTIONS.users),
  ]);
  return { docs, goals, users: new Map(users.map((u) => [u.id, u])), snapshots: new Map() };
}

function evaluate(def: KpiDefinition, bundle: DataBundle, scope: KpiScope, scopeId: string | undefined) {
  const formula = getFormula(def.formula);
  if (!formula) return { value: null, sourceIds: [] as KpiSource[], note: `Fórmula "${def.formula}" não existe no registro.` };
  try {
    return formula.compute({ period: bundle.period, scope, scopeId, data: bundle });
  } catch (error) {
    console.error(`[kpis] falha ao calcular ${def.key}`, error);
    return { value: null, sourceIds: [] as KpiSource[], note: "Falha no cálculo deste indicador." };
  }
}

function trendFor(def: KpiDefinition, value: number | null, previous: Period, previousValue: number | null, fromSnapshot: boolean): KpiTrend {
  if (value === null || previousValue === null) return { period: previous, value: previousValue, delta: null, deltaPct: null, direction: null, favorable: null, fromSnapshot };
  const delta = value - previousValue;
  const direction = Math.abs(delta) < 1e-9 ? "flat" : delta > 0 ? "up" : "down";
  const favorable = def.direction === "faixa" || direction === "flat" ? null : def.direction === "maior_melhor" ? delta > 0 : delta < 0;
  return { period: previous, value: previousValue, delta, deltaPct: previousValue !== 0 ? delta / Math.abs(previousValue) : null, direction, favorable, fromSnapshot };
}

async function computeWith(input: EngineInput, keys: string[], period: Period, scope: KpiScope, scopeId: string | undefined, options: ComputeOptions): Promise<KpiResult[]> {
  const withTrend = options.withTrend ?? true;
  const withSources = options.withSources ?? true;
  const previous = previousPeriod(period);
  const [bundle, prevBundle, prevSnaps] = await Promise.all([
    loadDataBundle(period),
    withTrend ? loadDataBundle(previous) : Promise.resolve(null),
    withTrend && previous.kind === "mes" ? snapshotsOf(input, previous.key) : Promise.resolve([] as KpiSnapshot[]),
  ]);

  const out: KpiResult[] = [];
  for (const key of Array.from(new Set(keys))) {
    const def = resolveDefinition(key, input.docs);
    if (!def) continue;
    const result = evaluate(def, bundle, scope, scopeId);
    const target = resolveTarget(def, period, scope, scopeId, input.goals, input.users);
    const attainment = computeAttainment(result.value, def.direction, target.target, target.targetMin, target.targetMax);

    let trend: KpiTrend | null = null;
    if (withTrend && prevBundle) {
      // Mesmo número do gráfico de histórico: snapshot gravado do mês anterior quando existe; senão, ao vivo.
      const snap = matchSnapshot(prevSnaps, def, previous.key, scope, scopeId);
      const prevValue = snap ? snap.value : evaluate(def, prevBundle, scope, scopeId).value;
      const fromSnapshot = Boolean(snap);
      trend = trendFor(def, result.value, previous, prevValue, fromSnapshot);
    }

    out.push({
      key,
      kpi: def,
      period,
      scope,
      scopeId: scope === "empresa" ? undefined : scopeId,
      value: result.value,
      numerator: result.numerator,
      denominator: result.denominator,
      note: result.note,
      target: target.target,
      targetMin: target.targetMin,
      targetMax: target.targetMax,
      targetSource: target.source,
      goalId: target.goalId,
      weight: target.weight,
      attainment,
      status: statusFor(attainment, def.attentionPct),
      trend,
      sourceIds: withSources ? result.sourceIds : [],
      href: kpiHref(key, period, scope, scopeId),
    });
  }
  return out;
}

/** Vários indicadores do mesmo período/escopo reaproveitando o mesmo DataBundle. Chaves desconhecidas são ignoradas. */
export async function computeKpis(keys: string[], period: Period, scope: KpiScope = "empresa", scopeId?: string, options: ComputeOptions = {}): Promise<KpiResult[]> {
  const input = await loadEngineInput([period.key, previousPeriod(period).key]);
  return computeWith(input, keys, period, scope, scopeId, options);
}

/** Um indicador: valor, meta, atingimento, status, tendência e registros de origem. null se a chave não existe. */
export async function computeKpi(kpiKey: string, period: Period, scope: KpiScope = "empresa", scopeId?: string, options: ComputeOptions = {}): Promise<KpiResult | null> {
  const [result] = await computeKpis([kpiKey], period, scope, scopeId, options);
  return result ?? null;
}

export interface KpiBatchRequest {
  keys: string[];
  scope: KpiScope;
  scopeId?: string;
}

/**
 * Cálculo em lote para vários escopos (quebras por usuário/departamento, quadro de metas), com uma única
 * carga de definições, metas e dados. Devolve um array por requisição, na mesma ordem.
 */
export async function computeKpiBatch(requests: KpiBatchRequest[], period: Period, options: ComputeOptions = {}): Promise<KpiResult[][]> {
  const input = await loadEngineInput([period.key, previousPeriod(period).key]);
  const out: KpiResult[][] = [];
  for (const r of requests) out.push(await computeWith(input, r.keys, period, r.scope, r.scopeId, options));
  return out;
}

/** Um indicador para vários escopos (sem tendência e sem registros de origem). */
export async function computeKpiForScopes(kpiKey: string, period: Period, scopes: { scope: KpiScope; scopeId?: string }[]): Promise<KpiResult[]> {
  const batch = await computeKpiBatch(
    scopes.map((s) => ({ keys: [kpiKey], scope: s.scope, scopeId: s.scopeId })),
    period,
    { withTrend: false, withSources: false },
  );
  return batch.flat();
}

// ---------------------------------------------------------------------------
// Histórico
// ---------------------------------------------------------------------------

/**
 * Série mensal (mais antigo → mais recente) combinando os snapshots gravados dos meses passados com o
 * cálculo ao vivo do mês atual. Mês passado sem snapshot é calculado ao vivo quando a fórmula permite.
 */
export async function getHistory(kpiKey: string, scope: KpiScope = "empresa", scopeId?: string, months = 8): Promise<HistoryPoint[]> {
  const periods = listRecentMonths(months);
  const [input, snaps] = await Promise.all([loadEngineInput(periods.map((p) => p.key)), list<KpiSnapshot>(COLLECTIONS.kpiSnapshots, { where: [["kpiKey", "==", kpiKey]] })]);
  const def = resolveDefinition(kpiKey, input.docs);
  if (!def) return [];
  const points: HistoryPoint[] = [];
  for (const period of periods) {
    const current = isCurrentPeriod(period);
    const snap = current ? undefined : matchSnapshot(snaps, def, period.key, scope, scopeId);
    const target = resolveTarget(def, period, scope, scopeId, input.goals, input.users);
    if (snap) {
      const t = target.source === "meta" || snap.target === undefined ? target.target : snap.target;
      const attainment = computeAttainment(snap.value, def.direction, t, target.targetMin, target.targetMax);
      points.push({ period: period.key, label: formatCompetence(period.key), value: snap.value, target: t, attainment, status: statusFor(attainment, def.attentionPct), source: "snapshot" });
      continue;
    }
    const [live] = await computeWith(input, [kpiKey], period, scope, scopeId, { withTrend: false, withSources: false });
    points.push({ period: period.key, label: formatCompetence(period.key), value: live?.value ?? null, target: live?.target ?? null, attainment: live?.attainment ?? null, status: live?.status ?? null, source: "ao_vivo" });
  }
  return points;
}

// ---------------------------------------------------------------------------
// Snapshots
// ---------------------------------------------------------------------------

const OPERATIONAL_DEPARTMENTS: DepartmentKey[] = ["marketing", "vendas", "financeiro", "implantacao", "cs", "suporte"];
const MAX_SNAPSHOT_SOURCES = 300;

/** Chaves do scorecard de um colaborador: as da função (departamento) + as que têm meta pessoal no período. */
export function scorecardKeysFor(user: Pick<User, "id" | "departmentId">, goals: Goal[] = [], periodKey?: string): string[] {
  const base = SCORECARD_KEYS[user.departmentId] ?? SCORECARD_KEYS.administrativo;
  const personal = goals.filter((g) => g.scope === "usuario" && g.scopeId === user.id && (!periodKey || g.period === periodKey)).map((g) => g.kpiKey);
  return Array.from(new Set([...base, ...personal.filter((k) => getFormula(k) || base.includes(k))]));
}

/**
 * Grava/atualiza `kpi_snapshots` do período (id determinístico snap_<kpi>_<periodo>_<escopo>_<id>):
 * empresa (todos os indicadores ativos + scorecards), departamentos operacionais (indicadores do
 * departamento) e colaboradores ativos (indicadores da sua função). Valores indisponíveis não são gravados.
 */
export async function storeSnapshots(period: Period): Promise<{ written: number; skipped: number }> {
  const input = await loadEngineInput([period.key, previousPeriod(period).key]);
  const active = input.docs.filter((d) => d.active !== false);
  const computedAt = nowIso();
  const writes = new Map<string, Omit<KpiSnapshot, "id">>();
  let skipped = 0;

  const push = (results: KpiResult[]) => {
    for (const r of results) {
      if (r.value === null) {
        skipped += 1;
        continue;
      }
      const snapshot: Omit<KpiSnapshot, "id"> = {
        organizationId: ORG_ID,
        createdAt: computedAt,
        updatedAt: computedAt,
        kpiKey: r.key,
        period: period.key,
        scope: r.scope,
        scopeId: r.scopeId,
        value: r.value,
        target: r.target ?? undefined,
        attainment: r.attainment ?? undefined,
        status: r.status ?? undefined,
        computedAt,
        sourceIds: r.sourceIds.slice(0, MAX_SNAPSHOT_SOURCES).map((s) => s.id),
      };
      writes.set(snapshotDocId(r.key, period.key, r.scope, r.scopeId), snapshot);
    }
  };

  const allScorecard = Object.values(SCORECARD_KEYS).flat();
  push(await computeWith(input, [...active.map((d) => d.key), ...allScorecard], period, "empresa", undefined, { withTrend: false }));
  for (const dep of OPERATIONAL_DEPARTMENTS) {
    const keys = [...SCORECARD_KEYS[dep], ...active.filter((d) => d.department === dep).map((d) => d.key)];
    push(await computeWith(input, keys, period, "departamento", dep, { withTrend: false }));
  }
  // Diretoria acompanha a empresa (já gravada acima); os demais, a própria função.
  for (const user of Array.from(input.users.values()).filter((u) => u.active !== false && u.departmentId !== "diretoria")) {
    push(await computeWith(input, scorecardKeysFor(user, input.goals, period.key), period, "usuario", user.id, { withTrend: false }));
  }

  await batchSet(Array.from(writes.entries()).map(([id, data]) => ({ collection: COLLECTIONS.kpiSnapshots, id, data: { ...data } })));
  return { written: writes.size, skipped };
}

// ---------------------------------------------------------------------------
// Reação a eventos (chamado por src/server/events/handlers/kpis.ts)
// ---------------------------------------------------------------------------

const KPI_UPDATE_INTERVAL_MS = 60_000;
let lastKpiUpdateAt = 0;

/** Colaboradores envolvidos no evento (dono, responsável, atendente, quem originou, autor). */
function eventUserIds(event: DomainEvent): string[] {
  const p = event.payload ?? {};
  const candidates = [p.ownerId, p.assigneeId, p.attendantId, p.originUserId, p.userId, p.responsibleId, event.actorId];
  return Array.from(new Set(candidates.filter((v): v is string => typeof v === "string" && v.length > 0 && v !== "system")));
}

/**
 * Evento que altera números: invalida o cache de dados do período atual e, no máximo 1x por minuto,
 * emite `kpi.updated` e verifica as metas pessoais dos colaboradores do evento (goal.achieved +
 * notificação ao colaborador e ao gestor na primeira vez que a meta é atingida no período).
 * Nada é recalculado para a empresa inteira aqui: os números são calculados na leitura.
 */
export async function processKpiEvent(event: DomainEvent): Promise<void> {
  const periodKey = currentMonthKey();
  invalidateDataBundle(periodKey);
  const now = Date.now();
  if (now - lastKpiUpdateAt < KPI_UPDATE_INTERVAL_MS) return;
  lastKpiUpdateAt = now;

  await emitEvent({
    type: "kpi.updated",
    actor: SYSTEM_ACTOR,
    entity: { type: "kpi_period", id: periodKey },
    title: "Indicadores atualizados",
    description: `Dados alterados por: ${event.title}`,
    payload: { period: periodKey, trigger: event.type, triggerEventId: event.id },
    timeline: false,
  });
  await checkGoalsAchieved(eventUserIds(event), monthPeriod(periodKey));
}

async function checkGoalsAchieved(userIds: string[], period: Period): Promise<void> {
  if (userIds.length === 0) return;
  const goals = (await list<Goal>(COLLECTIONS.goals, { where: [["period", "==", period.key]] })).filter((g) => g.scope === "usuario" && g.scopeId && userIds.includes(g.scopeId));
  if (goals.length === 0) return;
  const input = await loadEngineInput([period.key]);

  for (const userId of Array.from(new Set(goals.map((g) => g.scopeId!)))) {
    const user = input.users.get(userId);
    if (!user || user.active === false) continue;
    const mine = goals.filter((g) => g.scopeId === userId);
    const results = await computeWith(input, mine.map((g) => g.kpiKey), period, "usuario", userId, { withTrend: false, withSources: false });
    for (const goal of mine) {
      const result = results.find((r) => r.goalId === goal.id);
      if (!result || result.attainment === null || result.attainment < 1) continue;
      const previous = await list<DomainEvent>(COLLECTIONS.events, { where: [["entityId", "==", goal.id]] });
      if (previous.some((e) => e.type === "goal.achieved" && e.payload?.period === period.key)) continue;

      const valueText = formatKpiValue(result.value, result.kpi.unit, result.kpi.formulaMeta?.suffix);
      const targetText = formatKpiValue(result.target, result.kpi.unit, result.kpi.formulaMeta?.suffix);
      const event = await emitEvent({
        type: "goal.achieved",
        actor: SYSTEM_ACTOR,
        entity: { type: "goal", id: goal.id },
        title: `Meta atingida: ${result.kpi.name}`,
        description: `${user.name} · ${valueText} de ${targetText} (${period.label})`,
        department: user.departmentId,
        payload: { goalId: goal.id, kpiKey: goal.kpiKey, period: period.key, userId, value: result.value, target: result.target, attainment: result.attainment },
        timeline: false,
      });
      await notify({
        userIds: [userId, user.managerId ?? ""],
        kind: "informativa",
        title: `Meta atingida: ${result.kpi.name}`,
        body: `${user.name} chegou a ${valueText} (meta ${targetText}) em ${period.label}.`,
        href: result.href,
        entity: { type: "goal", id: goal.id },
        eventId: event.id,
      });
    }
  }
}

/** Departamentos válidos como escopo (para validação de parâmetros de URL). */
export function isDepartmentKey(value: string | undefined): value is DepartmentKey {
  return Boolean(value) && (DEPARTMENT_KEYS as readonly string[]).includes(value as string);
}
