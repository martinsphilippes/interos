import "server-only";
/**
 * Geração das linhas dos relatórios A PARTIR DOS MESMOS DADOS dos dashboards: indicadores pelo motor de
 * KPIs (computeKpis / getCompanyScorecard, com fallback para o snapshot gravado quando o indicador de
 * estado não é reconstruível no passado) e registros pelo DataBundle do motor (mesma carga e cache).
 * Nada de fórmula de indicador é refeito aqui; os volumes operacionais são contagens simples.
 */
import { list } from "@/server/db";
import { getSetting } from "@/server/admin/queries";
import { computeKpis, statusFor, type KpiResult } from "@/server/kpis/engine";
import { loadDataBundle, type DataBundle } from "@/server/kpis/formulas";
import { getCompanyScorecard } from "@/server/kpis/queries";
import { currentMonthKey, inPeriod, localDayKey, monthPeriod, periodFromKey, periodReference, type Period } from "@/server/kpis/period";
import { STATUS_LABELS, formatKpiValue, type KpiScope, type KpiStatus } from "@/server/kpis/schemas";
import { COLLECTIONS, type Client, type ClientProduct, type Commission, type CurrentUser, type DomainEvent, type KpiSnapshot, type Payable, type Product, type Proposal, type User } from "@/domain/types";
import { CLIENT_STATUS_LABELS, DEPARTMENT_KEYS, DEPARTMENT_LABELS, EVENT_TYPES, PRIORITY_LABELS, TASK_STATUS_LABELS, type DepartmentKey, type EventType } from "@/domain/constants";
import { formatCompetence } from "@/lib/format";
import { ORIGIN_LABELS } from "@/components/tasks/task-model";
import { AUDIT_ENTITY_LABELS, REPORT_DEFINITIONS, type ReportDefinition, type ReportFilters, type ReportKey, type ReportValue } from "./definitions";
import { EVENT_TYPE_LABELS, eventTypeGroups } from "@/domain/event-labels";
import { eventChanges, summarizeChanges } from "@/domain/audit-format";
import { canSeeFinanceValues } from "@/server/finance/access";
import { maskMoneyText } from "@/server/finance/redact";
import { formatDateTime } from "@/lib/format";
import { COMMISSION_STATUS_LABELS, PAYABLE_ORIGIN_LABELS, PAYABLE_STATUS_LABELS, payableCategoryLabel } from "@/domain/commissions";
import { can } from "@/server/auth/permissions";
import { resolveDataScope, scopeAllows, type DataScope } from "@/server/auth/scope";
import type { PermissionKey } from "@/domain/permissions";
import { resolveCommissionScope } from "@/server/commissions/queries";

export type { ReportValue } from "./definitions";

export interface ReportRow {
  cells: Record<string, ReportValue>;
  /** Link da linha na prévia (registro de origem). */
  href?: string;
}

export interface AppliedFilter {
  label: string;
  value: string;
}

export interface ReportData {
  definition: ReportDefinition;
  rows: ReportRow[];
  totals: Record<string, ReportValue> | null;
  filters: AppliedFilter[];
  /** Filtros efetivos (com padrões e restrições de acesso aplicados). */
  effective: ReportFilters;
  /** Chave do período para o nome do arquivo (ex.: 2026-04_2026-09). */
  periodKey: string;
  periodLabel: string;
  generatedAt: string;
  notes: string[];
  /** Filtros travados pelo escopo do usuário (a interface mostra desabilitados). */
  locked: (keyof ReportFilters)[];
}

export class ReportAccessError extends Error {}

const MAX_MONTHS = 24;
const DAY_MS = 86_400_000;
const MONTH_RE = /^\d{4}-(0[1-9]|1[0-2])$/;
const DAY_RE = /^\d{4}-\d{2}-\d{2}$/;

/** Departamento dono de cada relatório operacional (acesso de quem não é gestor). */
const OPERATIONAL_OWNER: Partial<Record<ReportKey, DepartmentKey>> = { oportunidades: "vendas", comissoes: "vendas", contratos: "financeiro", chamados: "suporte", clientes: "cs", contas_a_pagar: "financeiro" };

// ---------------------------------------------------------------------------
// Acesso
// ---------------------------------------------------------------------------

type ReportUser = Pick<CurrentUser, "isManager" | "departmentId"> & Partial<Pick<CurrentUser, "id" | "role" | "isAdmin" | "isDirector" | "permissions">>;

/** Seção do catálogo (Gestão › Relatórios) de cada relatório. */
export function reportPermissionKey(key: ReportKey): PermissionKey {
  return `gestao.relatorios.${key.replace(/_/g, "-")}.ver` as PermissionKey;
}

/**
 * Gestores, diretoria e admin acessam tudo; os demais, os relatórios do próprio departamento (e Tarefas). Comissões
 * também para a equipe financeira (que paga as comissões). O CONTEÚDO de Comissões é recortado por escopo em
 * buildReport (D15): financeiro/admin/diretoria veem todos; gestor, só a equipe; vendedor, só as próprias.
 */
export function canAccessReport(user: ReportUser, key: ReportKey): boolean {
  // Fachada do catálogo: gestao.relatorios.<tipo>.ver (mesma regra padrão). Sem papel informado, a regra antiga.
  if (user.role) return can({ role: user.role, departmentId: user.departmentId, permissions: user.permissions }, reportPermissionKey(key));
  // Auditoria (D29): sem papel informado, só diretoria/admin (mesma regra padrão da chave do catálogo).
  if (key === "auditoria") return Boolean(user.isAdmin || user.isDirector);
  if (user.isManager) return true;
  const def = REPORT_DEFINITIONS[key];
  if (key === "tarefas") return true;
  if (key === "comissoes" && (user.role === "financeiro" || user.departmentId === "financeiro")) return true;
  if (key === "contas_a_pagar" && (user.role === "financeiro" || user.departmentId === "financeiro")) return true;
  if (key === "diretoria") return false;
  const owner = def.department ?? OPERATIONAL_OWNER[key];
  return owner === user.departmentId;
}

export function listReportsForUser(user: ReportUser): ReportDefinition[] {
  return Object.values(REPORT_DEFINITIONS).filter((d) => canAccessReport(user, d.key));
}

/** Chave de exportação do tipo (gestao.relatorios.<tipo>.exportar), exigida pela API além de gestao.relatorios.exportar. */
export function reportExportKey(key: ReportKey): PermissionKey {
  return `gestao.relatorios.${key.replace(/_/g, "-")}.exportar` as PermissionKey;
}

/**
 * Escopos que recortam o CONTEÚDO dos relatórios (A7), lidos uma vez por relatório:
 * - `report`: escopo da tela Relatórios (padrão "empresa" para todos = sem recorte); fora de "empresa", as linhas
 *   entram só quando o responsável (ou o departamento do registro) está no escopo;
 * - `tasks`: escopo de Tarefas (operacao.tarefas) — padrão: gestores = empresa; demais = departamento (o relatório
 *   de Tarefas trava o filtro no próprio departamento, como antes);
 * - Comissões: resolveCommissionScope (escopo de financeiro.comissoes, D15).
 */
interface ReportScopes {
  report: DataScope;
  tasks: DataScope | null;
}

function restricted(scope: DataScope): boolean {
  return Boolean(scope.userIds || scope.departmentKeys);
}

/** Registro dentro do escopo do relatório (qualquer dono no escopo, ou o departamento do registro). */
function allowedBy(scope: DataScope, owners: readonly (string | undefined | null)[], departmentId?: string | null): boolean {
  return !restricted(scope) || scopeAllows(scope, owners, departmentId);
}

/** Pessoas que o escopo do relatório permite filtrar (null = todas). */
export async function reportAllowedUserIds(user: CurrentUser): Promise<ReadonlySet<string> | null> {
  return (await resolveDataScope(user, "gestao.relatorios")).userIds ?? null;
}

/** Restrições forçadas pelo escopo: Tarefas só do próprio departamento (escopo "departamento" de Tarefas). */
function forcedFilters(user: Pick<CurrentUser, "departmentId">, key: ReportKey, scopes: ReportScopes): { filters: ReportFilters; locked: (keyof ReportFilters)[] } {
  if (key === "tarefas" && scopes.tasks?.kind === "departamento") return { filters: { departamento: user.departmentId }, locked: ["departamento"] };
  return { filters: {}, locked: [] };
}

// ---------------------------------------------------------------------------
// Períodos
// ---------------------------------------------------------------------------

function shiftMonth(key: string, delta: number): string {
  const [y, m] = key.split("-").map(Number);
  return new Date(Date.UTC(y, m - 1 + delta, 1)).toISOString().slice(0, 7);
}

function monthRange(filters: ReportFilters): { months: Period[]; from: string; to: string } {
  const current = currentMonthKey();
  let to = filters.ate && MONTH_RE.test(filters.ate.slice(0, 7)) ? filters.ate.slice(0, 7) : current;
  let from = filters.de && MONTH_RE.test(filters.de.slice(0, 7)) ? filters.de.slice(0, 7) : shiftMonth(to, -5);
  if (from > to) [from, to] = [to, from];
  const months: Period[] = [];
  for (let k = from; k <= to && months.length < MAX_MONTHS; k = shiftMonth(k, 1)) months.push(monthPeriod(k));
  return { months, from, to: months[months.length - 1]?.key ?? to };
}

function dayRange(filters: ReportFilters): Period {
  const today = localDayKey();
  const to = filters.ate && DAY_RE.test(filters.ate) ? filters.ate : today;
  const from = filters.de && DAY_RE.test(filters.de) ? filters.de : `${to.slice(0, 7)}-01`;
  return periodFromKey(`${from}_${to}`) ?? periodFromKey(`${today.slice(0, 7)}-01_${today}`)!;
}

// ---------------------------------------------------------------------------
// Indicadores por competência (motor de KPIs + snapshot de indicadores de estado)
// ---------------------------------------------------------------------------

interface MonthKpis {
  period: Period;
  results: Map<string, KpiResult>;
  bundle: DataBundle;
}

async function loadMonthKpis(months: Period[], keys: string[], scope: KpiScope, scopeId: string | undefined): Promise<{ data: MonthKpis[]; snapshots: KpiSnapshot[] }> {
  const [data, snapshots] = await Promise.all([
    Promise.all(
      months.map(async (period) => {
        const [results, bundle] = await Promise.all([computeKpis(keys, period, scope, scopeId, { withTrend: false, withSources: false }), loadDataBundle(period)]);
        return { period, results: new Map(results.map((r) => [r.key, r])), bundle };
      }),
    ),
    list<KpiSnapshot>(COLLECTIONS.kpiSnapshots, { where: [["period", "in", months.map((m) => m.key)]] }),
  ]);
  return { data, snapshots };
}

/** Valor do indicador: cálculo do motor; indicador de estado indisponível no passado → snapshot gravado. */
function kpiValue(month: MonthKpis, snapshots: KpiSnapshot[], key: string, scope: KpiScope, scopeId?: string): number | null {
  const r = month.results.get(key);
  if (r && r.value !== null) return r.value;
  if (r && r.kpi.formulaMeta?.kind !== "estado") return null;
  const candidates: { scope: KpiScope; scopeId?: string }[] = [{ scope, scopeId }];
  if (scope === "departamento") candidates.push({ scope: "empresa" });
  for (const c of candidates) {
    const snap = snapshots
      .filter((s) => s.kpiKey === key && s.period === month.period.key && s.scope === c.scope && (s.scopeId || undefined) === (c.scopeId || undefined))
      .sort((a, b) => (a.computedAt < b.computedAt ? 1 : -1))[0];
    if (snap) return snap.value;
  }
  return null;
}

function statusLabel(status: KpiStatus | null): string | null {
  return status ? STATUS_LABELS[status] : null;
}

function avg(values: number[]): number | null {
  return values.length > 0 ? values.reduce((s, v) => s + v, 0) / values.length : null;
}

// ---------------------------------------------------------------------------
// Relatórios departamentais
// ---------------------------------------------------------------------------

interface DepartmentalInput {
  months: Period[];
  scope: KpiScope;
  scopeId?: string;
  /** Colaborador filtrado (atribuição dos volumes operacionais). */
  userId?: string;
}

async function buildMarketing(input: DepartmentalInput): Promise<ReportRow[]> {
  const keys = ["leads_captados", "mqls", "cpl", "conversao_mql", "conversao_mql_oportunidade"];
  const { data, snapshots } = await loadMonthKpis(input.months, keys, input.scope, input.scopeId);
  return data.map((m) => {
    const mqls = m.results.get("mqls");
    return {
      cells: {
        competencia: formatCompetence(m.period.key),
        leads: kpiValue(m, snapshots, "leads_captados", input.scope, input.scopeId),
        mqls: mqls?.value ?? null,
        investimento: m.results.get("cpl")?.numerator ?? null,
        cpl: m.results.get("cpl")?.value ?? null,
        oportunidades: m.results.get("conversao_mql_oportunidade")?.numerator ?? null,
        conversao: m.results.get("conversao_mql")?.value ?? null,
        meta: mqls?.target ?? null,
        atingimento: mqls?.attainment ?? null,
        status: statusLabel(statusFor(mqls?.attainment ?? null, 85)),
      },
      href: mqls?.href,
    };
  });
}

async function buildSales(input: DepartmentalInput): Promise<ReportRow[]> {
  const keys = ["mqls", "novas_vendas", "receita_vendida", "ticket_medio", "conversao_funil", "ciclo_vendas_dias"];
  const [{ data }, proposals] = await Promise.all([loadMonthKpis(input.months, keys, input.scope, input.scopeId), list<Proposal>(COLLECTIONS.proposals)]);
  return data.map((m) => {
    const revenue = m.results.get("receita_vendida");
    const sent = proposals.filter((p) => inPeriod(p.sentAt, m.period) && (!input.userId || p.ownerId === input.userId)).length;
    return {
      cells: {
        competencia: formatCompetence(m.period.key),
        mqls: m.results.get("mqls")?.value ?? null,
        propostas: sent,
        vendas: m.results.get("novas_vendas")?.value ?? null,
        receita: revenue?.value ?? null,
        ticket: m.results.get("ticket_medio")?.value ?? null,
        conversao: m.results.get("conversao_funil")?.value ?? null,
        ciclo: m.results.get("ciclo_vendas_dias")?.value ?? null,
        meta: revenue?.target ?? null,
        atingimento: revenue?.attainment ?? null,
        status: statusLabel(statusFor(revenue?.attainment ?? null, 85)),
      },
      href: revenue?.href,
    };
  });
}

/** Regra da planilha (aba Financeiro). */
function financeStatus(variationPct: number | null, delinquency: number | null): KpiStatus | null {
  if (delinquency === null) return null;
  if (variationPct === null) return delinquency <= 0.04 ? "atingida" : delinquency <= 0.06 ? "atencao" : "critico";
  if (variationPct >= 0 && delinquency <= 0.04) return "atingida";
  if (variationPct >= -0.05 && delinquency <= 0.06) return "atencao";
  return "critico";
}

async function buildFinance(input: DepartmentalInput): Promise<ReportRow[]> {
  const keys = ["faturamento", "recebido", "inadimplencia", "mrr", "contratos_assinados"];
  const { data, snapshots } = await loadMonthKpis(input.months, keys, input.scope, input.scopeId);
  return data.map((m) => {
    const billed = m.results.get("faturamento");
    const delinquency = m.results.get("inadimplencia");
    const budget = billed?.target ?? null;
    const variation = billed?.value !== null && billed?.value !== undefined && budget !== null ? billed.value - budget : null;
    const variationPct = variation !== null && budget ? variation / budget : null;
    // Prazo de recebimento: dias entre a emissão e o pagamento das cobranças pagas na competência.
    const paid = m.bundle.billing.filter((b) => b.paidAt && inPeriod(b.paidAt, m.period) && (!input.userId || m.bundle.contractById.get(b.contractId)?.ownerId === input.userId));
    const receiveDays = avg(paid.map((b) => Math.max(0, (Date.parse(b.paidAt!) - Date.parse(b.createdAt)) / DAY_MS)));
    return {
      cells: {
        competencia: formatCompetence(m.period.key),
        faturado: billed?.value ?? null,
        recebido: m.results.get("recebido")?.value ?? null,
        vencido: delinquency?.numerator ?? null,
        inadimplencia: delinquency?.value ?? null,
        mrr: kpiValue(m, snapshots, "mrr", input.scope, input.scopeId),
        contratos: m.results.get("contratos_assinados")?.value ?? null,
        prazo_recebimento: receiveDays,
        orcamento: budget,
        variacao: variation,
        variacao_pct: variationPct,
        status: statusLabel(financeStatus(variationPct, delinquency?.value ?? null)),
      },
      href: billed?.href,
    };
  });
}

async function buildImplementation(input: DepartmentalInput): Promise<ReportRow[]> {
  const keys = ["implantacoes_concluidas", "tempo_medio_implantacao", "entregas_prazo", "qualidade_implantacao", "backlog_implantacao"];
  const { data, snapshots } = await loadMonthKpis(input.months, keys, input.scope, input.scopeId);
  return data.map((m) => {
    const ref = periodReference(m.period, new Date(m.bundle.now));
    const projects = m.bundle.projects.filter((p) => p.status !== "cancelada" && (!input.userId || p.ownerId === input.userId));
    const openAtRef = projects.filter((p) => p.createdAt < ref && !(p.goLiveAt && p.goLiveAt <= ref));
    const onTime = m.results.get("entregas_prazo");
    return {
      cells: {
        competencia: formatCompetence(m.period.key),
        novas: projects.filter((p) => inPeriod(p.createdAt, m.period)).length,
        em_andamento: openAtRef.filter((p) => p.startDate && p.startDate < ref).length,
        concluidas: m.results.get("implantacoes_concluidas")?.value ?? null,
        atrasadas: openAtRef.filter((p) => p.dueDate && p.dueDate < ref).length,
        tempo_medio: m.results.get("tempo_medio_implantacao")?.value ?? null,
        no_prazo: onTime?.value ?? null,
        satisfacao: m.results.get("qualidade_implantacao")?.value ?? null,
        backlog: kpiValue(m, snapshots, "backlog_implantacao", input.scope, input.scopeId),
        meta: onTime?.target ?? null,
        atingimento: onTime?.attainment ?? null,
        status: statusLabel(statusFor(onTime?.attainment ?? null, 90)),
      },
      href: onTime?.href,
    };
  });
}

async function buildCs(input: DepartmentalInput): Promise<ReportRow[]> {
  const keys = ["clientes_ativos", "saude_cliente", "csat_cs", "churn", "upsell_gerado", "taxa_renovacao", "adocao_media"];
  const { data, snapshots } = await loadMonthKpis(input.months, keys, input.scope, input.scopeId);
  return data.map((m) => {
    const health = m.results.get("saude_cliente");
    const healthValue = kpiValue(m, snapshots, "saude_cliente", input.scope, input.scopeId);
    const target = health?.target ?? null;
    const attainment = healthValue !== null && target ? healthValue / target : null;
    return {
      cells: {
        competencia: formatCompetence(m.period.key),
        ativos: kpiValue(m, snapshots, "clientes_ativos", input.scope, input.scopeId),
        onboardings: m.bundle.clients.filter((c) => inPeriod(c.activatedAt, m.period) && (!input.userId || c.ownerCsId === input.userId)).length,
        saude: healthValue,
        csat: kpiValue(m, snapshots, "csat_cs", input.scope, input.scopeId),
        cancelamentos: m.results.get("churn")?.numerator ?? null,
        churn: m.results.get("churn")?.value ?? null,
        upsell: m.results.get("upsell_gerado")?.value ?? null,
        renovacoes: m.results.get("taxa_renovacao")?.numerator ?? null,
        adocao: kpiValue(m, snapshots, "adocao_media", input.scope, input.scopeId),
        meta: target,
        status: statusLabel(statusFor(attainment, 90)),
      },
      href: health?.href,
    };
  });
}

async function buildSupport(input: DepartmentalInput): Promise<ReportRow[]> {
  const keys = ["chamados_abertos", "chamados_resolvidos", "backlog_suporte", "sla_resposta", "sla_solucao", "tempo_medio_resposta_min", "tempo_medio_solucao_h", "reincidencia", "csat"];
  const [{ data, snapshots }, goals] = await Promise.all([loadMonthKpis(input.months, keys, input.scope, input.scopeId), getSetting<{ csat?: number }>("metas_referencia", { csat: 8.5 })]);
  const csatTarget = typeof goals.csat === "number" ? goals.csat : 8.5;
  return data.map((m) => {
    const sla = m.results.get("sla_solucao")?.value ?? null;
    const csat = m.results.get("csat")?.value ?? null;
    let status: KpiStatus | null = null;
    if (sla !== null && csat !== null) {
      if (sla >= 0.9 && csat >= csatTarget) status = "atingida";
      else if (sla >= 0.85 && csat >= csatTarget * (4.2 / 4.5)) status = "atencao";
      else status = "critico";
    }
    return {
      cells: {
        competencia: formatCompetence(m.period.key),
        novos: m.results.get("chamados_abertos")?.value ?? null,
        resolvidos: m.results.get("chamados_resolvidos")?.value ?? null,
        backlog: kpiValue(m, snapshots, "backlog_suporte", input.scope, input.scopeId),
        sla_resposta: m.results.get("sla_resposta")?.value ?? null,
        sla_solucao: sla,
        resposta_media: m.results.get("tempo_medio_resposta_min")?.value ?? null,
        solucao_media: m.results.get("tempo_medio_solucao_h")?.value ?? null,
        reabertos: m.results.get("reincidencia")?.numerator ?? null,
        reincidencia: m.results.get("reincidencia")?.value ?? null,
        csat,
        status: statusLabel(status),
      },
      href: m.results.get("sla_solucao")?.href,
    };
  });
}

async function buildBoard(months: Period[]): Promise<ReportRow[]> {
  const boards = await Promise.all(months.map((p) => getCompanyScorecard(p)));
  const rows: ReportRow[] = [];
  boards.forEach((board, i) => {
    const comp = formatCompetence(months[i].key);
    for (const r of board.headline) {
      rows.push({
        cells: {
          competencia: comp,
          departamento: "Empresa",
          indicador: r.kpi.name,
          realizado: formatKpiValue(r.value, r.kpi.unit, r.kpi.formulaMeta?.suffix),
          meta: r.target !== null ? formatKpiValue(r.target, r.kpi.unit, r.kpi.formulaMeta?.suffix) : null,
          atingimento: r.attainment,
          status: statusLabel(r.status),
          responsavel: null,
          alerta: r.key === "saude_cliente" && r.value !== null && r.value < 70 ? "Saúde média abaixo de 70: acionar planos de sucesso" : null,
        },
        href: r.href,
      });
    }
    for (const d of board.departments) {
      const r = d.result;
      rows.push({
        cells: {
          competencia: comp,
          departamento: d.label,
          indicador: r?.kpi.name ?? "—",
          realizado: r ? formatKpiValue(r.value, r.kpi.unit, r.kpi.formulaMeta?.suffix) : null,
          meta: r && r.target !== null ? formatKpiValue(r.target, r.kpi.unit, r.kpi.formulaMeta?.suffix) : null,
          atingimento: r?.attainment ?? null,
          status: statusLabel(r?.status ?? null),
          responsavel: d.manager?.name ?? null,
          alerta: r?.key === "inadimplencia" && r.value !== null && r.value > 0.04 ? "Inadimplência acima de 4%" : (d.alert?.message ?? null),
        },
        href: r?.href,
      });
    }
  });
  return rows;
}

// ---------------------------------------------------------------------------
// Relatórios operacionais
// ---------------------------------------------------------------------------

interface OperationalInput {
  period: Period;
  filters: ReportFilters;
  bundle: DataBundle;
  products: Map<string, Product>;
  /** Registro no escopo do usuário (donos do registro e, quando houver, o departamento). */
  inScope: (owners: readonly (string | undefined | null)[], departmentId?: string | null) => boolean;
}

function userName(bundle: DataBundle, id: string | undefined): string | null {
  return (id && bundle.userById.get(id)?.name) || null;
}

function clientName(bundle: DataBundle, id: string | undefined): string | null {
  return (id && bundle.clientById.get(id)?.tradeName) || null;
}

const OPEN_TASK = new Set(["aberta", "em_andamento", "aguardando"]);

function buildTasks({ period, filters, bundle, inScope }: OperationalInput): ReportRow[] {
  const today = localDayKey();
  const items = bundle.tasks.filter((t) => {
    if (!inScope([t.assigneeId], t.departmentId)) return false;
    if (!(inPeriod(t.createdAt, period) || inPeriod(t.dueAt, period) || inPeriod(t.completedAt, period))) return false;
    if (filters.departamento && t.departmentId !== filters.departamento) return false;
    if (filters.colaborador && t.assigneeId !== filters.colaborador) return false;
    if (filters.cliente && t.clientId !== filters.cliente) return false;
    const overdue = OPEN_TASK.has(t.status) && Boolean(t.dueAt) && localDayKey(t.dueAt!) < today;
    if (filters.status === "atrasadas") return overdue;
    if (filters.status && t.status !== filters.status) return false;
    return true;
  });
  return items
    .sort((a, b) => ((a.dueAt ?? "9999") < (b.dueAt ?? "9999") ? -1 : 1))
    .map((t) => {
      const overdue = OPEN_TASK.has(t.status) && Boolean(t.dueAt) && localDayKey(t.dueAt!) < today;
      return {
        cells: {
          titulo: t.title,
          cliente: t.clientName ?? clientName(bundle, t.clientId),
          departamento: DEPARTMENT_LABELS[t.departmentId] ?? t.departmentId,
          responsavel: userName(bundle, t.assigneeId) ?? t.assigneeName ?? null,
          prioridade: PRIORITY_LABELS[t.priority] ?? t.priority,
          status: TASK_STATUS_LABELS[t.status] ?? t.status,
          prazo: t.dueAt ?? null,
          concluida_em: t.completedAt ?? null,
          atrasada: overdue ? "Sim" : "Não",
          origem: ORIGIN_LABELS[t.origin] ?? t.origin,
        },
        href: `/tarefas?tarefa=${t.id}`,
      };
    });
}

const STAGE_LABELS: Record<string, string> = { qualificacao: "Qualificação", diagnostico: "Diagnóstico", proposta: "Proposta", negociacao: "Negociação", fechamento: "Fechamento", ganho: "Ganho", perdido: "Perdido" };
const KIND_LABELS: Record<string, string> = { nova_venda: "Nova venda", upsell: "Upsell", cross_sell: "Cross-sell", renovacao: "Renovação" };

function buildOpportunities({ period, filters, bundle, inScope }: OperationalInput): ReportRow[] {
  return bundle.opportunities
    .filter((o) => {
      if (!inScope([o.ownerId])) return false;
      if (!(inPeriod(o.createdAt, period) || inPeriod(o.wonAt, period) || inPeriod(o.lostAt, period))) return false;
      if (filters.colaborador && o.ownerId !== filters.colaborador) return false;
      if (filters.cliente && o.clientId !== filters.cliente) return false;
      if (filters.produto && !o.products.some((p) => p.productId === filters.produto)) return false;
      if (filters.status === "abertas") return o.stage !== "ganho" && o.stage !== "perdido";
      if (filters.status && o.stage !== filters.status) return false;
      return true;
    })
    .sort((a, b) => (a.createdAt < b.createdAt ? 1 : -1))
    .map((o) => ({
      cells: {
        titulo: o.title,
        cliente: clientName(bundle, o.clientId),
        responsavel: userName(bundle, o.ownerId),
        etapa: STAGE_LABELS[o.stage] ?? o.stage,
        tipo: KIND_LABELS[o.kind] ?? o.kind,
        probabilidade: (o.probability ?? 0) / 100,
        setup: o.setupTotal ?? 0,
        mensalidade: o.monthlyTotal ?? 0,
        hardware: o.hardwareTotal ?? 0,
        valor: (o.setupTotal ?? 0) + (o.monthlyTotal ?? 0) + (o.hardwareTotal ?? 0),
        criada_em: o.createdAt,
        fechada_em: o.wonAt ?? o.lostAt ?? null,
        motivo_perda: o.lossReason ?? null,
      },
      href: `/vendas/oportunidades?oportunidade=${o.id}`,
    }));
}

const CONTRACT_STATUS_LABELS: Record<string, string> = Object.fromEntries((REPORT_DEFINITIONS.contratos.statusOptions ?? []).map((o) => [o.value, o.label]));
const FINANCIAL_LABELS: Record<string, string> = { pendente: "Pendente", aprovado: "Aprovado", pendencia: "Pendência" };

function buildContracts({ period, filters, bundle, inScope }: OperationalInput): ReportRow[] {
  return bundle.contracts
    .filter((c) => {
      if (!inScope([c.ownerId])) return false;
      if (!(inPeriod(c.createdAt, period) || inPeriod(c.signedAt, period) || inPeriod(c.releasedAt, period))) return false;
      if (filters.colaborador && c.ownerId !== filters.colaborador) return false;
      if (filters.cliente && c.clientId !== filters.cliente) return false;
      if (filters.produto && !c.items.some((i) => i.productId === filters.produto)) return false;
      if (filters.status && c.status !== filters.status) return false;
      return true;
    })
    .sort((a, b) => (a.createdAt < b.createdAt ? 1 : -1))
    .map((c) => ({
      cells: {
        numero: c.number,
        cliente: clientName(bundle, c.clientId),
        status: CONTRACT_STATUS_LABELS[c.status] ?? c.status,
        financeiro: FINANCIAL_LABELS[c.financialStatus] ?? c.financialStatus,
        setup: c.setupTotal ?? 0,
        mensalidade: c.monthlyTotal ?? 0,
        hardware: c.hardwareTotal ?? 0,
        assinado_em: c.signedAt ?? null,
        liberado_em: c.releasedAt ?? null,
        responsavel: userName(bundle, c.ownerId),
      },
      href: `/financeiro/contratos/${c.id}`,
    }));
}

const TICKET_STATUS_LABELS: Record<string, string> = Object.fromEntries((REPORT_DEFINITIONS.chamados.statusOptions ?? []).filter((o) => o.value !== "abertos").map((o) => [o.value, o.label]));
const TICKET_PRIORITY_LABELS: Record<string, string> = { critico: "Crítico", alto: "Alto", medio: "Médio", baixo: "Baixo" };
const OPEN_TICKET = new Set(["aberto", "em_atendimento", "aguardando_cliente", "reaberto"]);

function buildTickets({ period, filters, bundle, products, inScope }: OperationalInput): ReportRow[] {
  const now = bundle.now;
  return bundle.tickets
    .filter((t) => {
      if (!inScope([t.assigneeId])) return false;
      if (!(inPeriod(t.openedAt, period) || inPeriod(t.resolvedAt, period))) return false;
      if (filters.colaborador && t.assigneeId !== filters.colaborador) return false;
      if (filters.cliente && t.clientId !== filters.cliente) return false;
      if (filters.produto && t.productId !== filters.produto) return false;
      if (filters.status === "abertos") return OPEN_TICKET.has(t.status);
      if (filters.status && t.status !== filters.status) return false;
      return true;
    })
    .sort((a, b) => (a.openedAt < b.openedAt ? 1 : -1))
    .map((t) => {
      const sla = bundle.ticketSla.get(t.id);
      let slaText: string | null = null;
      if (sla) {
        if (t.resolvedAt) slaText = t.resolvedAt <= sla.dueAt ? "Dentro" : "Fora";
        else if (sla.status === "pausado") slaText = "Pausado";
        else slaText = sla.dueAt < now ? "Violado" : "No prazo";
      }
      return {
        cells: {
          numero: t.number,
          assunto: t.subject,
          cliente: clientName(bundle, t.clientId),
          produto: (t.productId && products.get(t.productId)?.name) || null,
          prioridade: TICKET_PRIORITY_LABELS[t.priority] ?? t.priority,
          status: TICKET_STATUS_LABELS[t.status] ?? t.status,
          responsavel: userName(bundle, t.assigneeId),
          aberto_em: t.openedAt,
          primeira_resposta: t.firstResponseAt ?? null,
          resolvido_em: t.resolvedAt ?? null,
          sla: slaText,
          csat: t.csatScore ?? null,
          reaberturas: t.reopenCount ?? 0,
        },
        href: `/suporte/chamados/${t.id}`,
      };
    });
}

const HEALTH_LABELS: Record<string, string> = { saudavel: "Saudável", atencao: "Atenção", risco: "Risco" };

async function buildClients({ filters, bundle, inScope }: OperationalInput): Promise<ReportRow[]> {
  const clientProducts = filters.produto ? await list<ClientProduct>(COLLECTIONS.clientProducts, { where: [["productId", "==", filters.produto]] }) : [];
  const withProduct = new Set(clientProducts.filter((p) => p.status !== "cancelado").map((p) => p.clientId));
  return bundle.clients
    .filter((c: Client) => {
      if (!inScope([c.ownerCsId, c.ownerSalesId, c.ownerImplementationId])) return false;
      if (filters.status && c.status !== filters.status) return false;
      if (filters.colaborador && ![c.ownerCsId, c.ownerSalesId, c.ownerImplementationId].includes(filters.colaborador)) return false;
      if (filters.produto && !withProduct.has(c.id)) return false;
      return true;
    })
    .sort((a, b) => a.tradeName.localeCompare(b.tradeName, "pt-BR"))
    .map((c) => ({
      cells: {
        nome: c.tradeName,
        razao_social: c.legalName,
        status: CLIENT_STATUS_LABELS[c.status] ?? c.status,
        segmento: c.segment ?? null,
        cidade: c.address?.city ? `${c.address.city}${c.address.state ? `/${c.address.state}` : ""}` : null,
        mrr: c.mrr ?? 0,
        saude: c.healthScore ?? null,
        nivel: c.healthLevel ? HEALTH_LABELS[c.healthLevel] : null,
        cs: userName(bundle, c.ownerCsId),
        vendedor: userName(bundle, c.ownerSalesId),
        ativado_em: c.activatedAt ?? null,
      },
      href: `/clientes/${c.id}`,
    }));
}

const REVENUE_LABELS: Record<string, string> = { setup: "Adesão", recorrencia: "Recorrência", hardware: "Hardware" };
const COMMISSION_STATUS: Record<string, string> = COMMISSION_STATUS_LABELS;

/** `allowedUserIds` null = todos (equipe financeira/admin/diretoria); gestor = equipe; demais = só as próprias. */
async function buildCommissions(months: Period[], filters: ReportFilters, bundle: DataBundle, products: Map<string, Product>, allowedUserIds: string[] | null): Promise<ReportRow[]> {
  const keys = new Set(months.map((m) => m.key));
  if (allowedUserIds && filters.colaborador && !allowedUserIds.includes(filters.colaborador)) return [];
  const commissions = await list<Commission>(
    COLLECTIONS.commissions,
    filters.colaborador ? { where: [["userId", "==", filters.colaborador]] } : allowedUserIds ? { where: [["userId", "in", allowedUserIds]] } : {},
  );
  return commissions
    .filter((c) => keys.has(c.competence))
    .filter((c) => !allowedUserIds || allowedUserIds.includes(c.userId))
    .filter((c) => (!filters.cliente || c.clientId === filters.cliente) && (!filters.produto || c.productId === filters.produto) && (!filters.status || c.status === filters.status))
    .sort((a, b) => a.competence.localeCompare(b.competence) || (userName(bundle, a.userId) ?? "").localeCompare(userName(bundle, b.userId) ?? "", "pt-BR"))
    .map((c) => ({
      cells: {
        colaborador: userName(bundle, c.userId),
        cliente: clientName(bundle, c.clientId),
        produto: (c.productId && products.get(c.productId)?.name) || null,
        tipo: REVENUE_LABELS[c.revenueType] ?? c.revenueType,
        base: c.baseAmount,
        valor: c.amount,
        competencia: formatCompetence(c.competence),
        status: COMMISSION_STATUS[c.status] ?? c.status,
        liberacao: c.eligibleAt ?? c.releaseAt ?? null,
      },
      href: `/financeiro/comissoes?comissao=${c.id}`,
    }));
}

const PAYABLE_STATUS: Record<string, string> = PAYABLE_STATUS_LABELS;
const PAYABLE_ORIGIN: Record<string, string> = PAYABLE_ORIGIN_LABELS;

/** Contas a pagar (D28): títulos das competências do período, com situação derivada "vencido" para os em aberto. */
async function buildPayables(months: Period[], filters: ReportFilters, inScope: OperationalInput["inScope"]): Promise<ReportRow[]> {
  const keys = new Set(months.map((m) => m.key));
  const today = localDayKey();
  const payables = await list<Payable>(COLLECTIONS.payables);
  const overdue = (p: Payable) => (p.status === "previsto" || p.status === "aprovado" || p.status === "a_pagar") && p.dueDate.slice(0, 10) < today;
  return payables
    .filter((p) => keys.has(p.competence) && inScope([p.creditorId, p.createdBy]))
    .filter((p) => (filters.status === "vencido" ? overdue(p) : !filters.status || p.status === filters.status))
    .sort((a, b) => a.dueDate.localeCompare(b.dueDate) || (a.code ?? a.id).localeCompare(b.code ?? b.id))
    .map((p) => ({
      cells: {
        codigo: p.code ?? p.id,
        credor: p.creditorName,
        categoria: payableCategoryLabel(p.category),
        centro: p.costCenter ?? null,
        competencia: formatCompetence(p.competence),
        vencimento: p.dueDate,
        valor: p.amount,
        status: overdue(p) ? `Vencido (${PAYABLE_STATUS[p.status] ?? p.status})` : (PAYABLE_STATUS[p.status] ?? p.status),
        origem: `${PAYABLE_ORIGIN[p.origin] ?? p.origin}${p.installments ? ` · parcela ${p.installment}/${p.installments}` : ""}`,
        pago_em: p.paidAt ?? null,
      },
      href: `/financeiro/contas-a-pagar?titulo=${p.id}`,
    }));
}

// ---------------------------------------------------------------------------
// Auditoria (D29): eventos com alterações "de → para" e motivo
// ---------------------------------------------------------------------------

/** Texto sem acento e em minúsculas (busca do filtro "texto"). */
function fold(text: string): string {
  return text.normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase();
}

/** Rota da entidade do evento na prévia (a exportação leva só o texto). */
function auditHref(e: DomainEvent): string | undefined {
  const id = e.entityId;
  if (!id) return undefined;
  switch (e.entityType) {
    case "contract":
      return `/financeiro/contratos/${id}`;
    case "billing":
    case "contract_amendment":
      return typeof e.payload?.contractId === "string" ? `/financeiro/contratos/${e.payload.contractId}` : undefined;
    case "client":
      return `/clientes/${id}`;
    case "payable":
      return `/financeiro/contas-a-pagar?titulo=${id}`;
    case "opportunity":
      return `/vendas/oportunidades?oportunidade=${id}`;
    case "project":
      return `/implantacao/${id}`;
    case "financial_account":
      return `/financeiro/cadastros?aba=contas&item=${id}`;
    case "cost_center":
      return `/financeiro/cadastros?aba=centros&item=${id}`;
    case "finance_category":
      return `/financeiro/cadastros?aba=categorias&item=${id}`;
    case "finance_registry":
      return "/financeiro/cadastros?aba=categorias";
    default:
      return e.clientId ? `/clientes/${e.clientId}?aba=timeline` : undefined;
  }
}

/** Referência legível da entidade: rótulo do tipo + número do contrato / nome do cliente ou usuário. */
function auditEntity(e: DomainEvent, bundle: DataBundle): string {
  const label = e.entityType ? (AUDIT_ENTITY_LABELS[e.entityType] ?? e.entityType) : "—";
  const contractId = typeof e.payload?.contractId === "string" ? e.payload.contractId : e.entityType === "contract" ? e.entityId : undefined;
  const ref =
    (contractId && bundle.contractById.get(contractId)?.number) ||
    (e.entityType === "user" && e.entityId && userName(bundle, e.entityId)) ||
    (e.entityType === "setting" && e.entityId) ||
    clientName(bundle, e.clientId) ||
    null;
  return ref ? `${label} · ${ref}` : label;
}

/**
 * Relatório de Auditoria: eventos do período com `payload.changes` (ou from/to de situação) ou motivo. Filtros:
 * período, quem fez (colaborador), tipo de entidade, tipo de evento e texto livre. Escopo da tela Relatórios aplicado
 * pelo ator; sem "Visualizar valores" as quantias saem como "Restrito" (e "R$ …" mascarado nos textos).
 */
async function buildAudit(op: OperationalInput, user: CurrentUser): Promise<ReportRow[]> {
  const { filters, bundle, period } = op;
  const where: [string, "==", unknown][] = [];
  if (filters.evento) where.push(["type", "==", filters.evento]);
  else if (filters.entidade) where.push(["entityType", "==", filters.entidade]);
  if (filters.colaborador) where.push(["actorId", "==", filters.colaborador]);
  const events = await list<DomainEvent>(COLLECTIONS.events, where.length ? { where } : undefined);
  const hideValues = !canSeeFinanceValues(user);
  const text = filters.texto ? fold(filters.texto) : "";
  const mask = (v: string | undefined) => (hideValues ? maskMoneyText(v) : v);
  const rows: { at: string; row: ReportRow }[] = [];
  for (const e of events) {
    if (!inPeriod(e.occurredAt, period)) continue;
    if (filters.entidade && e.entityType !== filters.entidade) continue;
    if (!op.inScope([e.actorId])) continue;
    const changes = eventChanges(e.type, e.payload);
    const reason = typeof e.payload?.reason === "string" && e.payload.reason.trim() ? e.payload.reason.trim() : null;
    if (!changes && !reason) continue;
    const labels = e.payload?.labels && typeof e.payload.labels === "object" ? (e.payload.labels as Record<string, string>) : undefined;
    const cells = {
      quando: formatDateTime(e.occurredAt),
      quem: e.actorName || userName(bundle, e.actorId) || e.actorId,
      evento: EVENT_TYPE_LABELS[e.type] ?? e.type,
      entidade: auditEntity(e, bundle),
      titulo: mask(e.title) ?? "",
      alteracoes: changes ? summarizeChanges(changes, { labels, hideValues, max: 20 }) : null,
      motivo: mask(reason ?? undefined) ?? null,
    };
    if (text && !fold([cells.quem, cells.evento, cells.entidade, cells.titulo, cells.alteracoes ?? "", cells.motivo ?? "", e.description ?? ""].join(" ")).includes(text)) continue;
    rows.push({ at: e.occurredAt, row: { cells, href: auditHref(e) } });
  }
  return rows.sort((a, b) => b.at.localeCompare(a.at)).map((r) => r.row);
}

// ---------------------------------------------------------------------------
// Totais e filtros aplicados
// ---------------------------------------------------------------------------

function computeTotals(def: ReportDefinition, rows: ReportRow[]): Record<string, ReportValue> | null {
  if (rows.length === 0) return null;
  const totals: Record<string, ReportValue> = {};
  let any = false;
  for (const col of def.columns) {
    if (!col.total) continue;
    const values = rows.map((r) => r.cells[col.key]).filter((v): v is number => typeof v === "number" && !Number.isNaN(v));
    if (values.length === 0) {
      totals[col.key] = null;
      continue;
    }
    any = true;
    totals[col.key] = col.total === "soma" ? values.reduce((s, v) => s + v, 0) : values.reduce((s, v) => s + v, 0) / values.length;
  }
  if (!any) return null;
  totals[def.columns[0].key] = `Total (${rows.length} ${rows.length === 1 ? "linha" : "linhas"})`;
  return totals;
}

async function describeFilters(def: ReportDefinition, filters: ReportFilters, periodLabel: string, bundle: DataBundle, products: Map<string, Product>): Promise<AppliedFilter[]> {
  const out: AppliedFilter[] = [];
  if (def.filters.includes("periodo_mes") || def.filters.includes("periodo_data")) out.push({ label: "Período", value: periodLabel });
  if (filters.departamento) out.push({ label: "Departamento", value: DEPARTMENT_LABELS[filters.departamento as DepartmentKey] ?? filters.departamento });
  if (filters.colaborador) out.push({ label: def.collaboratorLabel ?? "Colaborador", value: userName(bundle, filters.colaborador) ?? filters.colaborador });
  if (filters.entidade) out.push({ label: "Entidade", value: AUDIT_ENTITY_LABELS[filters.entidade] ?? filters.entidade });
  if (filters.evento) out.push({ label: "Evento", value: EVENT_TYPE_LABELS[filters.evento as EventType] ?? filters.evento });
  if (filters.texto) out.push({ label: "Texto", value: `"${filters.texto}"` });
  if (filters.cliente) out.push({ label: "Cliente", value: clientName(bundle, filters.cliente) ?? filters.cliente });
  if (filters.produto) out.push({ label: "Produto", value: products.get(filters.produto)?.name ?? filters.produto });
  if (filters.status) out.push({ label: "Status", value: def.statusOptions?.find((o) => o.value === filters.status)?.label ?? filters.status });
  if (out.length === 1 && def.group === "departamental" && def.key !== "diretoria") out.push({ label: "Escopo", value: `Departamento de ${DEPARTMENT_LABELS[def.department!]}` });
  return out;
}

/** Mantém só os filtros que o relatório aceita e com valores válidos. */
function sanitize(def: ReportDefinition, filters: ReportFilters, users: Map<string, User>): ReportFilters {
  const out: ReportFilters = { de: filters.de, ate: filters.ate };
  if (def.filters.includes("departamento") && filters.departamento && (DEPARTMENT_KEYS as readonly string[]).includes(filters.departamento)) out.departamento = filters.departamento;
  if (def.filters.includes("colaborador") && filters.colaborador && users.has(filters.colaborador)) out.colaborador = filters.colaborador;
  if (def.filters.includes("cliente") && filters.cliente) out.cliente = filters.cliente;
  if (def.filters.includes("produto") && filters.produto) out.produto = filters.produto;
  if (def.filters.includes("status") && filters.status && def.statusOptions?.some((o) => o.value === filters.status)) out.status = filters.status;
  if (def.filters.includes("entidade") && filters.entidade && /^[a-z_]{2,40}$/.test(filters.entidade)) out.entidade = filters.entidade;
  if (def.filters.includes("evento") && filters.evento && (EVENT_TYPES as readonly string[]).includes(filters.evento)) out.evento = filters.evento;
  if (def.filters.includes("texto") && filters.texto) out.texto = filters.texto.slice(0, 120);
  return out;
}

// ---------------------------------------------------------------------------
// Entrada principal
// ---------------------------------------------------------------------------

/**
 * Monta o relatório (linhas, totais, filtros aplicados e nome do período) respeitando o acesso do usuário.
 * Lança ReportAccessError quando o usuário não pode ver o relatório.
 */
export async function buildReport(key: ReportKey, rawFilters: ReportFilters, user: CurrentUser): Promise<ReportData> {
  if (!canAccessReport(user, key)) throw new ReportAccessError("Você não tem acesso a este relatório.");
  const def = REPORT_DEFINITIONS[key];
  const monthly = def.filters.includes("periodo_mes");
  const range = monthly ? monthRange(rawFilters) : null;
  const dayPeriod = def.filters.includes("periodo_data") ? dayRange(rawFilters) : null;
  const refPeriod = range ? range.months[range.months.length - 1] : (dayPeriod ?? monthPeriod(currentMonthKey()));

  const [bundle, productList, reportScope, tasksScope, commissionScope] = await Promise.all([
    loadDataBundle(refPeriod),
    list<Product>(COLLECTIONS.products),
    resolveDataScope(user, "gestao.relatorios"),
    key === "tarefas" ? resolveDataScope(user, "operacao.tarefas") : Promise.resolve(null),
    key === "comissoes" ? resolveCommissionScope(user) : Promise.resolve(null),
  ]);
  const products = new Map(productList.map((p) => [p.id, p]));
  const forced = forcedFilters(user, key, { report: reportScope, tasks: tasksScope });
  const filters = { ...sanitize(def, rawFilters, bundle.userById), ...forced.filters };
  const locked = [...forced.locked];
  // Comissões: quem só vê as próprias tem o colaborador travado (D15, como antes).
  if (commissionScope?.kind === "own") {
    filters.colaborador = user.id;
    locked.push("colaborador");
  }
  const notes: string[] = [];
  // Escopo da tela Relatórios fora de "empresa": colaborador fora do escopo é descartado; nos departamentais sem
  // colaborador, o recorte vira o próprio usuário (o agregado do departamento incluiria pessoas fora do escopo).
  const reportRestricted = restricted(reportScope);
  if (reportRestricted && filters.colaborador && !scopeAllows(reportScope, [filters.colaborador])) delete filters.colaborador;
  if (reportRestricted && def.group === "departamental" && def.key !== "diretoria" && !filters.colaborador) {
    const ownDepartment = reportScope.kind === "departamento" && def.department && reportScope.departmentKeys?.has(def.department);
    if (!ownDepartment && def.filters.includes("colaborador")) {
      filters.colaborador = user.id;
      locked.push("colaborador");
      notes.push("Seu escopo de relatórios mostra os seus próprios números.");
    }
  }
  // Tarefas também respeitam o escopo de Tarefas (padrão: departamento + as próprias; com o filtro travado acima, o
  // resultado é o de antes: as tarefas do próprio departamento).
  const inScope: OperationalInput["inScope"] = (owners, departmentId) => allowedBy(reportScope, owners, departmentId) && (!tasksScope || allowedBy(tasksScope, owners, departmentId));

  let periodKey: string;
  let periodLabel: string;
  if (range) {
    filters.de = range.from;
    filters.ate = range.to;
    periodKey = range.from === range.to ? range.from : `${range.from}_${range.to}`;
    periodLabel = range.from === range.to ? range.months[0].label : `${formatCompetence(range.from)} a ${formatCompetence(range.to)}`;
  } else if (dayPeriod) {
    const [from, to] = dayPeriod.key.split("_");
    filters.de = from;
    filters.ate = to;
    periodKey = dayPeriod.key;
    periodLabel = dayPeriod.label;
  } else {
    delete filters.de;
    delete filters.ate;
    periodKey = localDayKey();
    periodLabel = "Fotografia atual";
  }

  const collaborator = filters.colaborador;
  const departmental: DepartmentalInput | null =
    range && def.group === "departamental" && def.department
      ? { months: range.months, scope: collaborator ? "usuario" : "departamento", scopeId: collaborator ?? def.department, userId: collaborator }
      : null;
  const op: OperationalInput = { period: dayPeriod ?? refPeriod, filters, bundle, products, inScope };

  let rows: ReportRow[];
  switch (key) {
    case "marketing":
      rows = await buildMarketing(departmental!);
      break;
    case "vendas":
      rows = await buildSales(departmental!);
      break;
    case "financeiro":
      rows = await buildFinance(departmental!);
      notes.push("Orçamento = meta de faturamento do período (goals ou meta do indicador). Prazo de recebimento = dias entre a emissão e o pagamento das cobranças pagas na competência.");
      break;
    case "implantacao":
      rows = await buildImplementation(departmental!);
      notes.push("Qualidade: fração de projetos com go-live sem chamado crítico nos 30 dias seguintes (o projeto ainda não registra nota de satisfação).");
      break;
    case "cs":
      rows = await buildCs(departmental!);
      notes.push("Satisfação: média registrada nas contas de CS (escala 0–10); o NPS ainda não é registrado no sistema.");
      break;
    case "suporte":
      rows = await buildSupport(departmental!);
      break;
    case "diretoria":
      // Consolidado da empresa: fora do escopo "empresa" não há linhas (o CEO/CTO restringiu o escopo).
      rows = reportRestricted ? [] : await buildBoard(range!.months);
      if (reportRestricted) notes.push("O relatório da Diretoria é consolidado da empresa e não está no seu escopo de relatórios.");
      break;
    case "tarefas":
      rows = buildTasks(op);
      break;
    case "oportunidades":
      rows = buildOpportunities(op);
      break;
    case "contratos":
      rows = buildContracts(op);
      break;
    case "chamados":
      rows = buildTickets(op);
      break;
    case "clientes":
      rows = await buildClients(op);
      break;
    case "comissoes": {
      // D15: o gestor só vê a equipe (antes qualquer gestor via todas); equipe financeira/admin/diretoria, todas.
      // allowedUserIds = escopo de Comissões ∩ escopo da tela Relatórios.
      const scope = commissionScope!;
      const byCommission = scope.kind === "all" ? null : scope.userIds;
      const byReport = reportScope.userIds ? Array.from(reportScope.userIds) : null;
      const allowed = byCommission && byReport ? byCommission.filter((id) => byReport.includes(id)) : (byCommission ?? byReport);
      rows = await buildCommissions(range!.months, filters, bundle, products, allowed);
      if (scope.kind === "team") notes.push("Gestor: comissões da sua equipe.");
      break;
    }
    case "auditoria":
      rows = await buildAudit(op, user);
      notes.push("Eventos com alterações registradas (de → para) ou motivo, do mais recente ao mais antigo. Quantias só com \"Visualizar valores\"; salário nunca aparece.");
      break;
    case "contas_a_pagar":
      rows = await buildPayables(range!.months, filters, inScope);
      notes.push("Situação \"Vencido\" = título em aberto (previsto, aprovado ou a pagar) com vencimento anterior a hoje.");
      break;
  }
  if (def.group === "departamental" && range && range.months.some((m) => m.key !== currentMonthKey())) {
    notes.push("Indicadores de estado (saúde, backlog, clientes ativos, MRR) de meses fechados usam o snapshot gravado quando o cálculo não é reconstruível.");
  }

  return {
    definition: def,
    rows,
    totals: computeTotals(def, rows),
    filters: await describeFilters(def, filters, periodLabel, bundle, products),
    effective: filters,
    periodKey,
    periodLabel,
    generatedAt: new Date().toISOString(),
    notes,
    locked,
  };
}

// ---------------------------------------------------------------------------
// Opções de filtro
// ---------------------------------------------------------------------------

export interface ReportFilterOptions {
  users: { value: string; label: string; departmentId: DepartmentKey }[];
  clients: { value: string; label: string }[];
  products: { value: string; label: string }[];
  departments: { value: string; label: string }[];
  /** Auditoria: tipos de entidade e de evento. */
  entities: { value: string; label: string }[];
  events: { value: string; label: string }[];
}

/** Opções dos filtros; `allowedUserIds` (escopo da tela Relatórios) limita os colaboradores oferecidos. */
export async function getReportFilterOptions(allowedUserIds?: ReadonlySet<string> | null): Promise<ReportFilterOptions> {
  const [users, clients, products] = await Promise.all([list<User>(COLLECTIONS.users), list<Client>(COLLECTIONS.clients), list<Product>(COLLECTIONS.products)]);
  return {
    users: users
      .filter((u) => u.active !== false && (!allowedUserIds || allowedUserIds.has(u.id)))
      .map((u) => ({ value: u.id, label: u.name, departmentId: u.departmentId }))
      .sort((a, b) => a.label.localeCompare(b.label, "pt-BR")),
    clients: clients.map((c) => ({ value: c.id, label: c.tradeName })).sort((a, b) => a.label.localeCompare(b.label, "pt-BR")),
    products: products.map((p) => ({ value: p.id, label: p.name })).sort((a, b) => a.label.localeCompare(b.label, "pt-BR")),
    departments: DEPARTMENT_KEYS.filter((d) => d !== "diretoria").map((d) => ({ value: d, label: DEPARTMENT_LABELS[d] })),
    entities: Object.entries(AUDIT_ENTITY_LABELS)
      .map(([value, label]) => ({ value, label }))
      .sort((a, b) => a.label.localeCompare(b.label, "pt-BR")),
    // Rótulo de negócio + área (a interface não mostra a chave técnica).
    events: eventTypeGroups()
      .flatMap((g) => g.types.map((t) => ({ value: t.value, label: `${t.label} · ${g.label}` })))
      .sort((a, b) => a.label.localeCompare(b.label, "pt-BR")),
  };
}

/** Nome do arquivo exportado: interos-<tipo>-<periodo>.<ext>. */
export function reportFileName(data: Pick<ReportData, "definition" | "periodKey">, ext: string): string {
  return `interos-${data.definition.key}-${data.periodKey}.${ext}`;
}
