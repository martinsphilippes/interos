import "server-only";
/**
 * Leituras do módulo Performance: Meu Desempenho (por função), Bônus e Premiação, Ranking e Campanhas.
 * Números vêm do motor de KPIs (src/server/kpis), das comissões (src/server/sales/commissions.ts), do motor
 * de bônus (./bonus) e da gamificação (./gamification, ./ranking). Nada é calculado na UI.
 */
import { create, getById, list } from "@/server/db";
import { COLLECTIONS, type BonusRule, type CurrentUser, type DomainEvent, type GamificationCampaign, type Settings, type User } from "@/domain/types";
import { DEPARTMENT_LABELS, type DepartmentKey } from "@/domain/constants";
import {
  computeAttainment,
  computeKpiBatch,
  computeKpis,
  currentMonthKey,
  getGoalPermissions,
  getHistory,
  getUserScorecard,
  listKpiDefinitions,
  monthPeriod,
  periodFromKey,
  statusFor,
  type HistoryPoint,
  type KpiResult,
  type KpiStatus,
  type Period,
  type Scorecard,
} from "@/server/kpis/queries";
import { inPeriod, localDayKey } from "@/server/kpis/period";
import { getCommissionSummary, listActiveCommissionRules, type CommissionSummary } from "@/server/sales/commissions";
import { REVENUE_TYPES, type CommissionRuleView } from "@/components/sales/model";
import { activeRuleFor, computeBonus, computeBonusForUsers, listBonusBlocks, listBonusHistory, listBonusRules, type BonusBlockView, type BonusComputation } from "./bonus";
import { listUserPoints } from "./gamification";
import { getUserRankingSummary, type UserRankingSummary } from "./ranking";
import { DEFAULT_SALES_PRIZES, describePrize, prizeValue, type SalesPrizeSettings } from "./schemas";

export { computeBonus, computeBonusForUsers, storeBonusResults, listBonusBlocks } from "./bonus";
export { awardPointsForEvent } from "./gamification";
export { getRanking } from "./ranking";

// ---------------------------------------------------------------------------
// Quem pode ver quem
// ---------------------------------------------------------------------------

export interface PerformanceAccess {
  /** Pode escolher outro colaborador (gestor, diretoria, admin). */
  canViewOthers: boolean;
  /** Colaboradores que pode ver/gerir (inclui o próprio). */
  userIds: string[];
  /** Colaboradores que pode gerir (bloqueios, fechamento), exceto ele mesmo quando não é admin. */
  manageableIds: string[];
  people: { id: string; name: string; department: DepartmentKey; jobTitle?: string }[];
}

/** Mesma hierarquia das metas: admin/diretoria veem todos; gestor, os seus departamentos e liderados. */
export async function getPerformanceAccess(viewer: CurrentUser): Promise<PerformanceAccess> {
  const [perms, users] = await Promise.all([getGoalPermissions(viewer), list<User>(COLLECTIONS.users)]);
  const active = users.filter((u) => u.active !== false);
  const ids = viewer.isManager ? Array.from(new Set([viewer.id, ...perms.userIds])) : [viewer.id];
  const people = active
    .filter((u) => ids.includes(u.id))
    .map((u) => ({ id: u.id, name: u.name, department: u.departmentId, jobTitle: u.jobTitle }))
    .sort((a, b) => a.name.localeCompare(b.name, "pt-BR"));
  return {
    canViewOthers: viewer.isManager && people.length > 1,
    userIds: ids,
    manageableIds: viewer.isManager ? ids.filter((id) => id !== viewer.id || viewer.isAdmin) : [],
    people,
  };
}

/** Colaborador exibido: o pedido na URL quando o visitante pode vê-lo; senão, o próprio visitante. */
export function resolveSubjectId(viewer: CurrentUser, access: PerformanceAccess, requested: string | undefined): string {
  return requested && access.userIds.includes(requested) ? requested : viewer.id;
}

// ---------------------------------------------------------------------------
// Prêmios de Vendas (setting "premios_vendas")
// ---------------------------------------------------------------------------

/** Setting "premios_vendas"; cria com os padrões do plano de comissionamento 2026 na primeira leitura. */
export async function getSalesPrizeSettings(): Promise<SalesPrizeSettings> {
  const docs = await list<Settings>(COLLECTIONS.settings, { where: [["key", "==", "premios_vendas"]] });
  if (docs[0]) return { ...DEFAULT_SALES_PRIZES, ...(docs[0].value as Partial<SalesPrizeSettings>) };
  await create<Settings>(
    COLLECTIONS.settings,
    { key: "premios_vendas", value: { ...DEFAULT_SALES_PRIZES }, description: "Prêmios por meta mensal batida em Vendas (adesão, recorrência, hardware) e valor do salário mínimo de referência." },
    "setting_premios_vendas",
  );
  return { ...DEFAULT_SALES_PRIZES };
}

export interface SalesPrizeLine {
  type: (typeof REVENUE_TYPES)[number];
  sold: number;
  goal: number;
  attainment: number | null;
  prize: number;
  prizeText: string;
  earned: boolean;
  missing: number;
}

export interface SalesPerformance {
  competence: string;
  summary: CommissionSummary;
  rules: CommissionRuleView[];
  prizes: SalesPrizeLine[];
  prizeTotal: number;
  minimumWage: number;
}

async function getSalesPerformance(userId: string, comp: string): Promise<SalesPerformance> {
  const [summary, rules, settings] = await Promise.all([getCommissionSummary(userId, comp), listActiveCommissionRules(), getSalesPrizeSettings()]);
  const spec = { setup: settings.adesao, recorrencia: settings.recorrencia, hardware: settings.hardware } as const;
  const prizes: SalesPrizeLine[] = REVENUE_TYPES.map((type) => {
    const prize = prizeValue(spec[type], settings.salarioMinimo);
    const goal = summary.goals[type];
    const earned = goal > 0 && summary.sold[type] >= goal;
    return { type, sold: summary.sold[type], goal, attainment: summary.attainment[type], prize, prizeText: describePrize(spec[type]), earned, missing: goal > 0 ? Math.max(0, goal - summary.sold[type]) : 0 };
  });
  return {
    competence: comp,
    summary,
    rules: rules.map((r) => ({ id: r.id, name: r.name, productId: r.productId, revenueType: r.revenueType, mode: r.mode, value: r.value, releaseCondition: r.releaseCondition, releaseInstallment: r.releaseInstallment })),
    prizes,
    prizeTotal: prizes.filter((p) => p.earned).reduce((s, p) => s + p.prize, 0),
    minimumWage: settings.salarioMinimo,
  };
}

// ---------------------------------------------------------------------------
// Meu Desempenho
// ---------------------------------------------------------------------------

export interface HighlightSeries {
  result: KpiResult;
  history: HistoryPoint[];
}

export interface MyPerformance {
  user: Pick<User, "id" | "name" | "departmentId" | "jobTitle" | "avatarUrl" | "managerId">;
  period: Period;
  /** Competência usada no bônus/comissão (o próprio mês, ou o mês atual quando o período não é mensal). */
  month: Period;
  scorecard: Scorecard;
  highlights: HighlightSeries[];
  tasks: { completed: KpiResult | null; onTime: KpiResult | null; overdue: KpiResult | null };
  sales: SalesPerformance | null;
  bonus: BonusComputation | null;
  gamification: (UserRankingSummary & { recentPoints: { id: string; points: number; reason: string; createdAt: string }[] }) | null;
}

/** Três indicadores principais: com meta e maior peso primeiro; depois os que têm valor. */
function pickHighlights(items: KpiResult[]): KpiResult[] {
  return [...items]
    .filter((i) => i.value !== null || i.target !== null)
    .sort((a, b) => Number(b.target !== null) - Number(a.target !== null) || (b.weight || 0) - (a.weight || 0) || Number(b.value !== null) - Number(a.value !== null))
    .slice(0, 3);
}

/** Tudo do Meu Desempenho de um colaborador no período. null se o usuário não existe. */
export async function getMyPerformance(userId: string, period: Period): Promise<MyPerformance | null> {
  const user = await getById<User>(COLLECTIONS.users, userId);
  if (!user) return null;
  const month = period.kind === "mes" ? period : monthPeriod(currentMonthKey());
  const [scorecard, taskResults, gamification, points, rule] = await Promise.all([
    getUserScorecard(userId, period),
    computeKpis(["tarefas_concluidas", "tarefas_no_prazo_pct", "tarefas_atrasadas"], period, "usuario", userId, { withTrend: true, withSources: false }),
    getUserRankingSummary(userId, period),
    listUserPoints(userId, 6),
    list<BonusRule>(COLLECTIONS.bonusRules, { where: [["department", "==", user.departmentId]] }).then((rules) => activeRuleFor(rules, user.departmentId)),
  ]);
  if (!scorecard) return null;

  const top = pickHighlights(scorecard.items);
  const [histories, sales, bonus] = await Promise.all([
    Promise.all(top.map((r) => getHistory(r.key, scorecard.subject.scope, scorecard.subject.scope === "empresa" ? undefined : userId, 6))),
    user.departmentId === "vendas" ? getSalesPerformance(userId, month.key) : Promise.resolve(null),
    rule ? computeBonus(userId, month) : Promise.resolve(null),
  ]);

  return {
    user: { id: user.id, name: user.name, departmentId: user.departmentId, jobTitle: user.jobTitle, avatarUrl: user.avatarUrl, managerId: user.managerId },
    period,
    month,
    scorecard,
    highlights: top.map((result, i) => ({ result, history: histories[i] })),
    tasks: {
      completed: taskResults.find((r) => r.key === "tarefas_concluidas") ?? null,
      onTime: taskResults.find((r) => r.key === "tarefas_no_prazo_pct") ?? null,
      overdue: taskResults.find((r) => r.key === "tarefas_atrasadas") ?? null,
    },
    sales,
    bonus,
    gamification: gamification ? { ...gamification, recentPoints: points.map((p) => ({ id: p.id, points: p.points, reason: p.reason, createdAt: p.createdAt })) } : null,
  };
}

// ---------------------------------------------------------------------------
// Bônus e Premiação
// ---------------------------------------------------------------------------

export interface BonusAuditEntry {
  id: string;
  blockId: string;
  type: DomainEvent["type"];
  title: string;
  actorName: string;
  occurredAt: string;
  description?: string;
}

export interface BonusPageData {
  month: Period;
  subject: BonusComputation | null;
  history: Awaited<ReturnType<typeof listBonusHistory>>;
  /** Equipe (gestor/admin): colaboradores com regra de bônus. */
  team: BonusComputation[];
  blocks: BonusBlockView[];
  audit: BonusAuditEntry[];
  canManage: boolean;
  /** Bloqueadores disponíveis por colaborador (da regra vigente do seu departamento). */
  blockOptions: { userId: string; name: string; blockers: { key: string; label: string }[] }[];
  kpiUnits: Record<string, { unit: KpiResult["kpi"]["unit"]; suffix?: string; direction: KpiResult["kpi"]["direction"] }>;
}

export async function getBonusPageData(viewer: CurrentUser, access: PerformanceAccess, requestedSubjectId: string, month: Period): Promise<BonusPageData> {
  const subjectId = resolveSubjectId(viewer, access, requestedSubjectId);
  const [rules, users] = await Promise.all([listBonusRules(), list<User>(COLLECTIONS.users)]);
  const byId = new Map(users.map((u) => [u.id, u]));
  const teamIds = access.manageableIds.filter((id) => {
    const u = byId.get(id);
    return u && u.active !== false && activeRuleFor(rules, u.departmentId);
  });
  const ids = Array.from(new Set([subjectId, ...teamIds]));
  const [computations, history, blocks] = await Promise.all([
    computeBonusForUsers(ids, month),
    listBonusHistory(subjectId),
    listBonusBlocks({ userIds: access.manageableIds.length > 0 ? Array.from(new Set([subjectId, ...access.manageableIds])) : [subjectId] }),
  ]);
  const audit = blocks.length > 0 ? await list<DomainEvent>(COLLECTIONS.events, { where: [["entityId", "in", blocks.map((b) => b.id)]] }) : [];
  const kpiUnits: BonusPageData["kpiUnits"] = {};
  for (const c of computations) for (const l of [...c.individual.lines, ...c.collective.lines]) kpiUnits[l.kpiKey] = { unit: l.unit, suffix: l.suffix, direction: l.direction };

  return {
    month,
    subject: computations.find((c) => c.userId === subjectId) ?? null,
    history,
    team: computations.filter((c) => teamIds.includes(c.userId)).sort((a, b) => a.userName.localeCompare(b.userName, "pt-BR")),
    blocks,
    audit: audit
      .filter((e) => e.entityType === "bonus_block")
      .sort((a, b) => (a.occurredAt < b.occurredAt ? -1 : 1))
      .map((e) => ({ id: e.id, blockId: e.entityId!, type: e.type, title: e.title, actorName: e.actorName, occurredAt: e.occurredAt, description: e.description })),
    canManage: teamIds.length > 0,
    blockOptions: teamIds
      .map((id) => {
        const u = byId.get(id)!;
        const rule = activeRuleFor(rules, u.departmentId);
        return { userId: id, name: u.name, blockers: rule?.blockers ?? [] };
      })
      .sort((a, b) => a.name.localeCompare(b.name, "pt-BR")),
    kpiUnits,
  };
}

// ---------------------------------------------------------------------------
// Regras de bônus (admin)
// ---------------------------------------------------------------------------

export interface BonusRulesAdminData {
  rules: BonusRule[];
  kpis: { key: string; name: string; unit: KpiResult["kpi"]["unit"]; suffix?: string; direction: KpiResult["kpi"]["direction"]; department: string }[];
  departments: { key: DepartmentKey; label: string }[];
}

export async function getBonusRulesAdminData(): Promise<BonusRulesAdminData> {
  const [rules, defs] = await Promise.all([listBonusRules(), listKpiDefinitions({ includeVirtual: true, activeOnly: true })]);
  return {
    rules,
    kpis: defs
      .filter((d) => d.formulaMeta)
      .map((d) => ({ key: d.key, name: d.name, unit: d.unit, suffix: d.formulaMeta?.suffix, direction: d.direction, department: d.department === "empresa" ? "Empresa" : DEPARTMENT_LABELS[d.department] })),
    departments: (Object.keys(DEPARTMENT_LABELS) as DepartmentKey[]).map((key) => ({ key, label: DEPARTMENT_LABELS[key] })),
  };
}

// ---------------------------------------------------------------------------
// Campanhas de gamificação
// ---------------------------------------------------------------------------

export async function listCampaigns(): Promise<GamificationCampaign[]> {
  const items = await list<GamificationCampaign>(COLLECTIONS.gamificationCampaigns);
  const order: Record<GamificationCampaign["status"], number> = { ativa: 0, planejada: 1, encerrada: 2 };
  return items.sort((a, b) => order[a.status] - order[b.status] || (a.startDate < b.startDate ? 1 : -1));
}

export interface CampaignParticipantRow {
  userId: string;
  name: string;
  department: DepartmentKey;
  value: number | null;
  attainment: number | null;
  status: KpiStatus | null;
  reached: boolean;
  position: number;
}

export interface CampaignProgress {
  campaign: GamificationCampaign;
  period: Period;
  metricLabel: string;
  unit: KpiResult["kpi"]["unit"];
  suffix?: string;
  direction: KpiResult["kpi"]["direction"];
  participants: CampaignParticipantRow[];
  /** Média do atingimento (limitado a 100%) dos participantes. */
  progress: number | null;
  reachedCount: number;
  /** Participação do visitante (quando participa). */
  mine: CampaignParticipantRow | null;
}

/** Colaborador "principal" de um evento (dono/responsável/atendente/quem originou; senão, o autor). */
function eventUserId(event: DomainEvent): string | undefined {
  const p = event.payload ?? {};
  const candidates = [p.ownerId, p.assigneeId, p.attendantId, p.originUserId, p.leadOwnerId, p.userId, event.actorId];
  return candidates.find((v): v is string => typeof v === "string" && v.length > 0 && v !== "system");
}

function campaignPeriod(c: GamificationCampaign): Period {
  const from = localDayKey(c.startDate.length === 10 ? `${c.startDate}T12:00:00Z` : c.startDate);
  const to = localDayKey(c.endDate.length === 10 ? `${c.endDate}T12:00:00Z` : c.endDate);
  return periodFromKey(`${from}_${to}`) ?? monthPeriod(currentMonthKey());
}

/** Campanhas com progresso: indicador do motor de KPIs (escopo usuario) ou contagem de eventos do tipo no período. */
export async function getCampaignsProgress(viewerId: string): Promise<CampaignProgress[]> {
  const [campaigns, users, defs] = await Promise.all([listCampaigns(), list<User>(COLLECTIONS.users), listKpiDefinitions({ includeVirtual: true })]);
  const active = users.filter((u) => u.active !== false);
  const defByKey = new Map(defs.map((d) => [d.key, d]));
  const eventTypes = Array.from(new Set(campaigns.map((c) => (c.metric.kind === "evento" ? c.metric.eventType : null)).filter((t): t is DomainEvent["type"] => Boolean(t))));
  const events = eventTypes.length > 0 ? await list<DomainEvent>(COLLECTIONS.events, { where: [["type", "in", eventTypes]] }) : [];

  const out: CampaignProgress[] = [];
  for (const campaign of campaigns) {
    const period = campaignPeriod(campaign);
    const people = (campaign.participantIds.length > 0 ? active.filter((u) => campaign.participantIds.includes(u.id)) : active.filter((u) => campaign.departments.includes(u.departmentId))).sort((a, b) =>
      a.name.localeCompare(b.name, "pt-BR"),
    );
    let values: (number | null)[] = [];
    let metricLabel = "";
    let unit: KpiResult["kpi"]["unit"] = "numero";
    let suffix: string | undefined;
    let direction: KpiResult["kpi"]["direction"] = "maior_melhor";
    if (campaign.metric.kind === "kpi") {
      const key = campaign.metric.kpiKey;
      const def = defByKey.get(key);
      metricLabel = def?.name ?? key;
      unit = def?.unit ?? "numero";
      suffix = def?.formulaMeta?.suffix;
      direction = def?.direction ?? "maior_melhor";
      const batch = people.length > 0 ? await computeKpiBatch(people.map((u) => ({ keys: [key], scope: "usuario" as const, scopeId: u.id })), period, { withTrend: false, withSources: false }) : [];
      values = batch.map((r) => r[0]?.value ?? null);
    } else {
      const type = campaign.metric.eventType;
      metricLabel = `Eventos "${type}"`;
      const counts = new Map<string, number>();
      for (const e of events) {
        if (e.type !== type || !inPeriod(e.occurredAt, period)) continue;
        const uid = eventUserId(e);
        if (uid) counts.set(uid, (counts.get(uid) ?? 0) + 1);
      }
      values = people.map((u) => counts.get(u.id) ?? 0);
    }
    const rows = people.map((u, i) => {
      const attainment = computeAttainment(values[i], direction, campaign.target);
      return { userId: u.id, name: u.name, department: u.departmentId, value: values[i], attainment, status: statusFor(attainment), reached: attainment !== null && attainment >= 1, position: 0 };
    });
    rows.sort((a, b) => (b.attainment ?? -1) - (a.attainment ?? -1) || a.name.localeCompare(b.name, "pt-BR"));
    rows.forEach((r, i) => (r.position = i + 1));
    const scored = rows.filter((r) => r.attainment !== null);
    out.push({
      campaign,
      period,
      metricLabel,
      unit,
      suffix,
      direction,
      participants: rows,
      progress: scored.length > 0 ? scored.reduce((s, r) => s + Math.min(1, r.attainment!), 0) / scored.length : null,
      reachedCount: rows.filter((r) => r.reached).length,
      mine: rows.find((r) => r.userId === viewerId) ?? null,
    });
  }
  return out;
}

export interface CampaignFormOptions {
  kpis: { key: string; name: string; department: string }[];
  users: { id: string; name: string; department: DepartmentKey }[];
}

export async function getCampaignFormOptions(): Promise<CampaignFormOptions> {
  const [defs, users] = await Promise.all([listKpiDefinitions({ includeVirtual: true, activeOnly: true }), list<User>(COLLECTIONS.users)]);
  return {
    kpis: defs.filter((d) => d.formulaMeta).map((d) => ({ key: d.key, name: d.name, department: d.department === "empresa" ? "Empresa" : DEPARTMENT_LABELS[d.department] })),
    users: users
      .filter((u) => u.active !== false)
      .map((u) => ({ id: u.id, name: u.name, department: u.departmentId }))
      .sort((a, b) => a.name.localeCompare(b.name, "pt-BR")),
  };
}
