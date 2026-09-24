import "server-only";
/**
 * API de leitura do motor de indicadores para as telas e para os próximos módulos (Meu Desempenho,
 * Bônus, Ranking, Dashboard do Gestor, Cockpit, Relatórios). Tudo aqui é calculado pelo motor
 * (src/server/kpis/engine.ts) a partir do registro de fórmulas: nenhum número é montado na UI.
 */
import { list } from "@/server/db";
import { COLLECTIONS, type CurrentUser, type Department, type Goal, type User } from "@/domain/types";
import { DEPARTMENT_KEYS, DEPARTMENT_LABELS, type DepartmentKey } from "@/domain/constants";
import { listFormulas, type KpiFormulaMeta } from "./formulas";
import {
  SCORECARD_KEYS,
  computeKpiBatch,
  computeKpis,
  getHistory,
  loadKpiDocs,
  resolveDefinition,
  scorecardKeysFor,
  type ComputeOptions,
  type HistoryPoint,
  type KpiDefinition,
  type KpiResult,
} from "./engine";
import { monthPeriod, previousPeriod, type Period } from "./period";
import { SCOPE_LABELS, departmentLabel, kpiHref, type KpiScope, type KpiStatus } from "./schemas";

export { parsePeriod, previousPeriod, listRecentMonths, periodFromKey, monthPeriod, currentMonthKey, periodOptions, inPeriod, type Period, type PeriodKind } from "./period";
export {
  computeKpi,
  computeKpis,
  computeKpiBatch,
  computeKpiForScopes,
  getHistory,
  storeSnapshots,
  computeAttainment,
  statusFor,
  SCORECARD_KEYS,
  type KpiDefinition,
  type KpiResult,
  type KpiTrend,
  type HistoryPoint,
  type ComputeOptions,
  type KpiBatchRequest,
} from "./engine";
export { kpiHref, formatKpiValue, formatKpiDelta, type KpiScope, type KpiStatus } from "./schemas";
export { listFormulas, type KpiFormulaMeta, type KpiSource } from "./formulas";

/** Departamentos que têm indicadores próprios (ordem da jornada). */
export const OPERATIONAL_DEPARTMENTS: DepartmentKey[] = ["marketing", "vendas", "financeiro", "implantacao", "cs", "suporte"];

const DEPARTMENT_ORDER: Record<string, number> = Object.fromEntries([...OPERATIONAL_DEPARTMENTS, "administrativo", "diretoria", "empresa"].map((d, i) => [d, i]));

// ---------------------------------------------------------------------------
// Definições
// ---------------------------------------------------------------------------

/**
 * Definições de indicadores: documentos de `kpis` (com os metadados da fórmula) e, com
 * `includeVirtual`, as fórmulas do registro que ainda não têm documento (sem meta própria).
 */
export async function listKpiDefinitions(options: { includeVirtual?: boolean; activeOnly?: boolean } = {}): Promise<KpiDefinition[]> {
  const docs = await loadKpiDocs();
  const defs = docs.map((d) => resolveDefinition(d.key, docs)).filter((d): d is KpiDefinition => d !== null);
  if (options.includeVirtual) {
    const keys = new Set(docs.map((d) => d.key));
    for (const f of listFormulas()) {
      if (keys.has(f.key)) continue;
      const def = resolveDefinition(f.key, docs);
      if (def) defs.push(def);
    }
  }
  return defs
    .filter((d) => !options.activeOnly || d.active !== false)
    .sort((a, b) => (DEPARTMENT_ORDER[a.department] ?? 99) - (DEPARTMENT_ORDER[b.department] ?? 99) || a.name.localeCompare(b.name, "pt-BR"));
}

// ---------------------------------------------------------------------------
// Metas
// ---------------------------------------------------------------------------

export interface GoalView extends Goal {
  kpiName: string;
  unit: KpiDefinition["unit"];
  suffix?: string;
  direction: KpiDefinition["direction"];
  scopeLabel: string;
}

async function nameMaps(): Promise<{ users: Map<string, User>; departments: Department[] }> {
  const [users, departments] = await Promise.all([list<User>(COLLECTIONS.users), list<Department>(COLLECTIONS.departments)]);
  return { users: new Map(users.map((u) => [u.id, u])), departments };
}

function scopeLabelFor(scope: KpiScope, scopeId: string | undefined, users: Map<string, User>): string {
  if (scope === "empresa") return "Empresa";
  if (scope === "departamento") return departmentLabel(scopeId);
  return (scopeId && users.get(scopeId)?.name) || "Colaborador removido";
}

/** Metas de uma competência (AAAA-MM), opcionalmente filtradas por escopo. */
export async function listGoals(period: Period | string, scope?: KpiScope, scopeId?: string): Promise<GoalView[]> {
  const key = typeof period === "string" ? period : period.key;
  const [goals, docs, { users }] = await Promise.all([list<Goal>(COLLECTIONS.goals, { where: [["period", "==", key]] }), loadKpiDocs(), nameMaps()]);
  return goals
    .filter((g) => (!scope || g.scope === scope) && (!scopeId || g.scopeId === scopeId))
    .map((g) => {
      const def = resolveDefinition(g.kpiKey, docs);
      return {
        ...g,
        kpiName: def?.name ?? g.kpiKey,
        unit: def?.unit ?? "numero",
        suffix: def?.formulaMeta?.suffix,
        direction: def?.direction ?? "maior_melhor",
        scopeLabel: scopeLabelFor(g.scope, g.scopeId, users),
      };
    })
    .sort((a, b) => KPI_SCOPE_ORDER[a.scope] - KPI_SCOPE_ORDER[b.scope] || a.scopeLabel.localeCompare(b.scopeLabel, "pt-BR") || a.kpiName.localeCompare(b.kpiName, "pt-BR"));
}

const KPI_SCOPE_ORDER: Record<KpiScope, number> = { empresa: 0, departamento: 1, usuario: 2 };

// ---------------------------------------------------------------------------
// Scorecards
// ---------------------------------------------------------------------------

export interface Scorecard {
  subject: { scope: KpiScope; id?: string; name: string; department?: DepartmentKey | "empresa" };
  period: Period;
  items: KpiResult[];
  /** Média ponderada (peso da meta ou do indicador) do atingimento, cada indicador limitado a 100%. */
  overallAttainment: number | null;
  achieved: number;
  withTarget: number;
}

function summarize(items: KpiResult[]): Pick<Scorecard, "overallAttainment" | "achieved" | "withTarget"> {
  const scored = items.filter((i) => i.attainment !== null);
  const weight = scored.reduce((s, i) => s + (i.weight || 0), 0);
  const overall = weight > 0 ? scored.reduce((s, i) => s + Math.min(1, i.attainment!) * (i.weight || 0), 0) / weight : null;
  return { overallAttainment: overall, achieved: scored.filter((i) => i.status === "atingida").length, withTarget: scored.length };
}

/**
 * Indicadores relevantes à função do colaborador (SCORECARD_KEYS pelo departamento) + os que têm meta
 * pessoal no período, no escopo "usuario". Para a Diretoria, a função é a empresa: os indicadores vêm no
 * escopo "empresa" (subject continua sendo o usuário). null se o usuário não existe.
 */
export async function getUserScorecard(userId: string, period: Period, options: ComputeOptions = {}): Promise<Scorecard | null> {
  const [{ users }, goals] = await Promise.all([nameMaps(), list<Goal>(COLLECTIONS.goals, { where: [["period", "==", period.key]] })]);
  const user = users.get(userId);
  if (!user) return null;
  const board = user.departmentId === "diretoria";
  const items = await computeKpis(scorecardKeysFor(user, goals, period.key), period, board ? "empresa" : "usuario", board ? undefined : userId, options);
  return { subject: { scope: board ? "empresa" : "usuario", id: userId, name: user.name, department: user.departmentId }, period, items, ...summarize(items) };
}

/** Indicadores do departamento (mesma lista da função + indicadores cadastrados para o departamento), escopo "departamento". */
export async function getDepartmentScorecard(dep: DepartmentKey, period: Period, options: ComputeOptions = {}): Promise<Scorecard> {
  const docs = await loadKpiDocs();
  const keys = [...(SCORECARD_KEYS[dep] ?? []), ...docs.filter((d) => d.department === dep && d.active !== false).map((d) => d.key)];
  const items = await computeKpis(keys, period, "departamento", dep, options);
  return { subject: { scope: "departamento", id: dep, name: DEPARTMENT_LABELS[dep], department: dep }, period, items, ...summarize(items) };
}

/** Indicador principal de cada departamento (aba Diretoria da planilha): o primeiro da lista com meta definida. */
const PRINCIPAL_KPIS: Record<string, string[]> = {
  marketing: ["mqls", "leads_captados"],
  vendas: ["receita_vendida", "novas_vendas"],
  financeiro: ["inadimplencia", "mrr"],
  implantacao: ["entregas_prazo", "implantacoes_concluidas"],
  cs: ["saude_cliente", "taxa_renovacao"],
  suporte: ["sla_solucao", "csat"],
};

/** Destaques do cockpit (planilha: leads, receita, MRR, saúde). */
const HEADLINE_KPIS = ["leads_captados", "receita_vendida", "mrr", "saude_cliente", "churn"];

/** Saúde média abaixo deste valor dispara ação (regra da aba Diretoria da planilha de relatórios). */
const HEALTH_ACTION_THRESHOLD = 70;

export interface CompanyDepartmentRow {
  department: DepartmentKey;
  label: string;
  manager?: { id: string; name: string };
  result: KpiResult | null;
  alert: { tone: "warning" | "danger"; message: string } | null;
}

export interface CompanyScorecard {
  period: Period;
  headline: KpiResult[];
  departments: CompanyDepartmentRow[];
  alerts: { department: DepartmentKey; tone: "warning" | "danger"; message: string; href: string }[];
  overallAttainment: number | null;
}

function alertFor(result: KpiResult | null): CompanyDepartmentRow["alert"] {
  if (!result || result.value === null) return null;
  if (result.key === "saude_cliente" && result.value < HEALTH_ACTION_THRESHOLD) return { tone: "danger", message: `Saúde média abaixo de ${HEALTH_ACTION_THRESHOLD}: acionar planos de sucesso` };
  if (result.status === "critico") return { tone: "danger", message: `${result.kpi.name} em situação crítica` };
  if (result.status === "atencao") return { tone: "warning", message: `${result.kpi.name} em atenção` };
  return null;
}

/** Cockpit: destaques da empresa + indicador principal de cada departamento com responsável e alerta. */
export async function getCompanyScorecard(period: Period): Promise<CompanyScorecard> {
  const { users, departments } = await nameMaps();
  const [headline, ...byDep] = await computeKpiBatch(
    [{ keys: HEADLINE_KPIS, scope: "empresa" }, ...OPERATIONAL_DEPARTMENTS.map((dep) => ({ keys: PRINCIPAL_KPIS[dep], scope: "departamento" as const, scopeId: dep }))],
    period,
    { withSources: false },
  );
  const rows: CompanyDepartmentRow[] = OPERATIONAL_DEPARTMENTS.map((dep, i) => {
    const candidates = byDep[i];
    const result = candidates.find((r) => r.target !== null && r.value !== null) ?? candidates.find((r) => r.value !== null) ?? candidates[0] ?? null;
    const managerId = departments.find((d) => d.key === dep)?.managerId;
    const manager = managerId ? users.get(managerId) : undefined;
    return { department: dep, label: DEPARTMENT_LABELS[dep], manager: manager ? { id: manager.id, name: manager.name } : undefined, result, alert: alertFor(result) };
  });
  const principal = rows.map((r) => r.result).filter((r): r is KpiResult => r !== null);
  return {
    period,
    headline,
    departments: rows,
    alerts: rows.filter((r) => r.alert).map((r) => ({ department: r.department, tone: r.alert!.tone, message: r.alert!.message, href: r.result!.href })),
    overallAttainment: summarize(principal).overallAttainment,
  };
}

// ---------------------------------------------------------------------------
// Drill-down
// ---------------------------------------------------------------------------

export interface BreakdownRow {
  id: string;
  name: string;
  subtitle?: string;
  avatarUrl?: string;
  value: number | null;
  target: number | null;
  attainment: number | null;
  status: KpiStatus | null;
  href: string;
}

export interface KpiDrilldown {
  result: KpiResult;
  subjectName: string;
  /** Nomes dos colaboradores por id (coluna "Responsável" da tabela de origem). */
  userNames: Record<string, string>;
  history: HistoryPoint[];
  byUser: BreakdownRow[];
  byDepartment: BreakdownRow[];
}

function sortBreakdown(rows: BreakdownRow[], direction: KpiDefinition["direction"]): BreakdownRow[] {
  return rows.sort((a, b) => {
    if (a.value === null) return 1;
    if (b.value === null) return -1;
    return direction === "menor_melhor" ? a.value - b.value : b.value - a.value;
  });
}

/**
 * Tudo que a tela de drill-down precisa: resultado com registros de origem, histórico de 8 meses e a
 * quebra por colaborador e por departamento (cada linha leva ao mesmo drill-down no escopo da linha).
 * `withBreakdown: false` omite as quebras (colaborador vendo o próprio escopo).
 */
export async function getKpiDrilldown(kpiKey: string, period: Period, scope: KpiScope = "empresa", scopeId?: string, options: { withBreakdown?: boolean } = {}): Promise<KpiDrilldown | null> {
  const withBreakdown = options.withBreakdown ?? true;
  const [[result], history, { users }] = await Promise.all([computeKpis([kpiKey], period, scope, scopeId), getHistory(kpiKey, scope, scopeId, 8), nameMaps()]);
  if (!result) return null;

  const subjectName = scopeLabelFor(scope, scopeId, users);
  const userNames = Object.fromEntries(Array.from(users.values()).map((u) => [u.id, u.name]));
  if (!withBreakdown) return { result, subjectName, userNames, history, byUser: [], byDepartment: [] };

  const own = result.kpi.formulaMeta?.department ?? result.kpi.department;
  const activeUsers = Array.from(users.values()).filter((u) => u.active !== false);
  const departmentKeys = DEPARTMENT_KEYS.filter((d) => d !== "diretoria");
  const batch = await computeKpiBatch(
    [...activeUsers.map((u) => ({ keys: [kpiKey], scope: "usuario" as const, scopeId: u.id })), ...departmentKeys.map((d) => ({ keys: [kpiKey], scope: "departamento" as const, scopeId: d }))],
    period,
    { withTrend: false, withSources: false },
  );

  const byUser: BreakdownRow[] = [];
  activeUsers.forEach((u, i) => {
    const r = batch[i][0];
    if (!r || r.value === null) return;
    if (r.value === 0 && u.departmentId !== own && r.target === null) return;
    byUser.push({ id: u.id, name: u.name, subtitle: u.jobTitle ?? DEPARTMENT_LABELS[u.departmentId], avatarUrl: u.avatarUrl, value: r.value, target: r.target, attainment: r.attainment, status: r.status, href: kpiHref(kpiKey, period, "usuario", u.id) });
  });

  const byDepartment: BreakdownRow[] = [];
  departmentKeys.forEach((d, i) => {
    const r = batch[activeUsers.length + i][0];
    if (!r || r.value === null) return;
    if (r.value === 0 && d !== own && r.target === null) return;
    byDepartment.push({ id: d, name: DEPARTMENT_LABELS[d], value: r.value, target: r.target, attainment: r.attainment, status: r.status, href: kpiHref(kpiKey, period, "departamento", d) });
  });

  return { result, subjectName, userNames, history, byUser: sortBreakdown(byUser, result.kpi.direction), byDepartment: sortBreakdown(byDepartment, result.kpi.direction) };
}

// ---------------------------------------------------------------------------
// Admin de indicadores
// ---------------------------------------------------------------------------

export interface KpiAdminRow {
  definition: KpiDefinition;
  current: { value: number | null; status: KpiStatus | null; attainment: number | null; href: string } | null;
}

export interface KpiAdminData {
  period: Period;
  rows: KpiAdminRow[];
  formulas: KpiFormulaMeta[];
  owners: { id: string; name: string }[];
}

export async function getKpiAdminData(period: Period): Promise<KpiAdminData> {
  const [definitions, { users }] = await Promise.all([listKpiDefinitions(), nameMaps()]);
  const [results] = await computeKpiBatch([{ keys: definitions.map((d) => d.key), scope: "empresa" }], period, { withTrend: false, withSources: false });
  const byKey = new Map(results.map((r) => [r.key, r]));
  return {
    period,
    rows: definitions.map((definition) => {
      const r = byKey.get(definition.key);
      return { definition, current: r ? { value: r.value, status: r.status, attainment: r.attainment, href: r.href } : null };
    }),
    formulas: listFormulas(),
    owners: Array.from(users.values())
      .filter((u) => u.active !== false)
      .map((u) => ({ id: u.id, name: u.name }))
      .sort((a, b) => a.name.localeCompare(b.name, "pt-BR")),
  };
}

// ---------------------------------------------------------------------------
// Quadro de metas (/performance/metas)
// ---------------------------------------------------------------------------

export interface GoalPermissions {
  /** Pode criar/editar metas da empresa (admin/diretoria). */
  canCompany: boolean;
  /** Departamentos cujas metas (de departamento e de colaboradores) pode gerenciar. */
  departments: DepartmentKey[];
  /** Colaboradores cujas metas pode gerenciar. */
  userIds: string[];
}

/**
 * Quem gerencia metas: admin/diretoria gerenciam todas; gestor gerencia as do seu departamento, dos
 * departamentos que lidera (departments.managerId) e dos colaboradores desses departamentos ou liderados
 * diretos; os demais só leem.
 */
export async function getGoalPermissions(user: CurrentUser): Promise<GoalPermissions> {
  const { users, departments } = await nameMaps();
  const all = Array.from(users.values()).filter((u) => u.active !== false);
  if (user.isDirector) return { canCompany: true, departments: [...DEPARTMENT_KEYS], userIds: all.map((u) => u.id) };
  if (user.role !== "gestor") return { canCompany: false, departments: [], userIds: [] };
  const deps = Array.from(new Set<DepartmentKey>([user.departmentId, ...departments.filter((d) => d.managerId === user.id).map((d) => d.key)]));
  const userIds = all.filter((u) => deps.includes(u.departmentId) || u.managerId === user.id).map((u) => u.id);
  return { canCompany: false, departments: deps, userIds };
}

export function canManageGoal(perms: GoalPermissions, scope: KpiScope, scopeId?: string): boolean {
  if (scope === "empresa") return perms.canCompany;
  if (scope === "departamento") return Boolean(scopeId) && perms.departments.includes(scopeId as DepartmentKey);
  return Boolean(scopeId) && perms.userIds.includes(scopeId!);
}

export interface GoalRow {
  goal: Goal;
  kpiName: string;
  unit: KpiDefinition["unit"];
  suffix?: string;
  direction: KpiDefinition["direction"];
  scopeLabel: string;
  value: number | null;
  attainment: number | null;
  status: KpiStatus | null;
  note?: string;
  href: string;
  canEdit: boolean;
}

export interface GoalsBoard {
  period: Period;
  rows: GoalRow[];
  permissions: GoalPermissions;
  canManageAny: boolean;
  /** Metas do mês anterior que o usuário pode copiar e que ainda não existem no período. */
  copyableFromPrevious: number;
  previousLabel: string;
  kpis: { key: string; name: string; unit: KpiDefinition["unit"]; suffix?: string; direction: KpiDefinition["direction"]; department: string; target?: number }[];
  users: { id: string; name: string; departmentId: DepartmentKey }[];
  departments: { key: DepartmentKey; label: string }[];
  scopeLabels: typeof SCOPE_LABELS;
}

function goalSignature(g: Pick<Goal, "kpiKey" | "scope" | "scopeId">): string {
  return `${g.kpiKey}|${g.scope}|${g.scopeId ?? ""}`;
}

/** Metas visíveis ao usuário no período, com valor atual, atingimento e permissão de edição. */
export async function getGoalsBoard(user: CurrentUser, period: Period): Promise<GoalsBoard> {
  const previous = previousPeriod(period.kind === "mes" ? period : monthPeriod(period.key.slice(0, 7)));
  const [goals, prevGoals, perms, definitions, { users }] = await Promise.all([
    list<Goal>(COLLECTIONS.goals, { where: [["period", "==", period.key]] }),
    list<Goal>(COLLECTIONS.goals, { where: [["period", "==", previous.key]] }),
    getGoalPermissions(user),
    listKpiDefinitions({ includeVirtual: true }),
    nameMaps(),
  ]);

  const visible = goals.filter((g) => {
    if (user.isDirector) return true;
    if (g.scope === "usuario" && g.scopeId === user.id) return true;
    if (g.scope === "departamento" && g.scopeId === user.departmentId) return true;
    if (user.role === "gestor") return g.scope === "empresa" || canManageGoal(perms, g.scope, g.scopeId);
    return false;
  });

  // Uma requisição por escopo; o motor carrega definições, metas e dados uma única vez.
  const groups = new Map<string, { scope: KpiScope; scopeId?: string; goals: Goal[] }>();
  for (const g of visible) {
    const k = `${g.scope}|${g.scopeId ?? ""}`;
    const group = groups.get(k) ?? { scope: g.scope, scopeId: g.scopeId, goals: [] };
    group.goals.push(g);
    groups.set(k, group);
  }
  const groupList = Array.from(groups.values());
  const batch = await computeKpiBatch(
    groupList.map((gr) => ({ keys: gr.goals.map((g) => g.kpiKey), scope: gr.scope, scopeId: gr.scopeId })),
    period,
    { withTrend: false, withSources: false },
  );

  const defByKey = new Map(definitions.map((d) => [d.key, d]));
  const rows: GoalRow[] = [];
  groupList.forEach((gr, i) => {
    for (const goal of gr.goals) {
      const r = batch[i].find((x) => x.key === goal.kpiKey);
      const def = r?.kpi ?? defByKey.get(goal.kpiKey);
      rows.push({
        goal,
        kpiName: def?.name ?? goal.kpiKey,
        unit: def?.unit ?? "numero",
        suffix: def?.formulaMeta?.suffix,
        direction: def?.direction ?? "maior_melhor",
        scopeLabel: scopeLabelFor(goal.scope, goal.scopeId, users),
        value: r?.value ?? null,
        attainment: r?.attainment ?? null,
        status: r?.status ?? null,
        note: r ? r.note : "Indicador sem fórmula no registro.",
        href: kpiHref(goal.kpiKey, period, goal.scope, goal.scopeId),
        canEdit: canManageGoal(perms, goal.scope, goal.scopeId),
      });
    }
  });
  rows.sort((a, b) => KPI_SCOPE_ORDER[a.goal.scope] - KPI_SCOPE_ORDER[b.goal.scope] || a.scopeLabel.localeCompare(b.scopeLabel, "pt-BR") || a.kpiName.localeCompare(b.kpiName, "pt-BR"));

  const existing = new Set(goals.map(goalSignature));
  const copyable = prevGoals.filter((g) => !existing.has(goalSignature(g)) && canManageGoal(perms, g.scope, g.scopeId)).length;
  const activeUsers = Array.from(users.values()).filter((u) => u.active !== false);

  return {
    period,
    rows,
    permissions: perms,
    canManageAny: perms.canCompany || perms.departments.length > 0 || perms.userIds.length > 0,
    copyableFromPrevious: copyable,
    previousLabel: previous.label,
    kpis: definitions
      .filter((d) => d.active !== false && d.formulaMeta)
      .map((d) => ({ key: d.key, name: d.name, unit: d.unit, suffix: d.formulaMeta?.suffix, direction: d.direction, department: departmentLabel(d.department), target: d.target })),
    users: activeUsers
      .filter((u) => user.isDirector || perms.userIds.includes(u.id) || u.id === user.id)
      .map((u) => ({ id: u.id, name: u.name, departmentId: u.departmentId }))
      .sort((a, b) => a.name.localeCompare(b.name, "pt-BR")),
    departments: DEPARTMENT_KEYS.map((key) => ({ key, label: DEPARTMENT_LABELS[key] })),
    scopeLabels: SCOPE_LABELS,
  };
}
