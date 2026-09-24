import "server-only";
/**
 * SLA global: leitura de TODAS as instâncias de SLA (tarefas, etapas de workflow, chamados, implantação, CS e
 * oportunidades) com o estado calculado na leitura pelo motor (computeSlaState), filtros e agregados.
 *
 * Regras (também exibidas na tela):
 * - Relevantes no período: concluídas no período, ou em aberto iniciadas antes do fim do período (no período
 *   corrente) / com prazo dentro do período (períodos passados). Instâncias substituídas (supersededBy) ficam fora.
 * - Dentro do prazo = em aberto sem risco (inclui "em atenção" e pausadas) + concluídas no prazo; Em risco =
 *   em aberto com o prazo consumido acima do limite de risco da regra; Violados = concluídas após o prazo ou em
 *   aberto com prazo vencido.
 * - Taxa de cumprimento = concluídas no prazo ÷ (concluídas no período + em aberto com prazo vencido no período).
 * - Tempo médio de 1ª resposta: SLAs com prazo de resposta respondidos no período; de resolução: concluídas no
 *   período (horas corridas entre o início do SLA e a conclusão).
 */
import { getManyByIds, list } from "@/server/db";
import { computeSlaState } from "@/server/sla";
import { getSetting } from "@/server/admin/queries";
import { loadKpiDocs } from "@/server/kpis/engine";
import { inPeriod, isCurrentPeriod, type Period } from "@/server/kpis/period";
import {
  COLLECTIONS,
  type Client,
  type ImplementationProject,
  type Opportunity,
  type SlaInstance,
  type SupportTicket,
  type Task,
  type User,
  type WorkflowStep,
} from "@/domain/types";
import { DEPARTMENT_LABELS, SLA_STATE_LABELS, type DepartmentKey, type SlaState } from "@/domain/constants";
import type { SlaLive } from "@/server/support/queries";
import { SLA_ENTITY_TYPES, SLA_TYPE_LABELS, normalizePriority, type SlaEntityType, type SlaFilters, type SlaPriority } from "./schemas";

export interface SlaItem {
  id: string;
  entityType: SlaEntityType;
  entityId: string;
  typeLabel: string;
  /** Protocolo/título da entidade (ex.: "CH-2026-0039", título da tarefa). */
  reference: string;
  title: string;
  href: string;
  clientId?: string;
  clientName?: string;
  department?: DepartmentKey;
  departmentLabel?: string;
  ownerId?: string;
  ownerName?: string;
  ownerAvatarUrl?: string;
  priority?: SlaPriority;
  ruleName: string;
  state: SlaState;
  stateLabel: string;
  /** Classificação da tela: dentro | risco | violado. */
  bucket: "dentro" | "risco" | "violado";
  active: boolean;
  startedAt: string;
  dueAt: string;
  completedAt?: string;
  remainingMs: number;
  /** Campos para a contagem regressiva no navegador. */
  live: SlaLive;
}

export interface SlaCompliance {
  met: number;
  evaluated: number;
  rate: number | null;
}

export interface SlaGroupRow extends SlaCompliance {
  key: string;
  label: string;
  total: number;
  violated: number;
  atRisk: number;
}

export interface SlaSummary {
  period: Period;
  items: SlaItem[];
  counts: { total: number; onTime: number; atRisk: number; violated: number };
  compliance: SlaCompliance;
  response: { avgMinutes: number | null; count: number };
  resolution: { avgHours: number | null; count: number };
  dueNextHour: SlaItem[];
  byDepartment: SlaGroupRow[];
  byOwner: SlaGroupRow[];
}

export interface SlaOverview extends SlaSummary {
  filters: SlaFilters;
  current: boolean;
  /** Críticos (em risco + violados em aberto), do menor prazo restante ao maior. */
  critical: SlaItem[];
  /** Lista exibida (críticos, "todos" ou "vencem na próxima hora"). */
  listed: SlaItem[];
  targets: { compliance: number; responseMinutes: number | null; resolutionHours: number | null };
  options: {
    departments: { value: string; label: string }[];
    owners: { value: string; label: string }[];
    clients: { value: string; label: string }[];
  };
}

const HOUR_MS = 3_600_000;

interface LoadedData {
  instances: SlaInstance[];
  users: Map<string, User>;
  clients: Map<string, Client>;
  tickets: Map<string, SupportTicket>;
  tasks: Map<string, Task>;
  steps: Map<string, WorkflowStep>;
  projects: Map<string, ImplementationProject>;
  opportunities: Map<string, Opportunity>;
}

async function loadData(): Promise<LoadedData> {
  const [instances, users] = await Promise.all([list<SlaInstance>(COLLECTIONS.slaInstances), list<User>(COLLECTIONS.users)]);
  const valid = instances.filter((s) => !s.supersededBy);
  const idsOf = (type: SlaEntityType) => valid.filter((s) => s.entityType === type).map((s) => s.entityId);
  const [clients, tickets, tasks, steps, projects, opportunities] = await Promise.all([
    getManyByIds<Client>(COLLECTIONS.clients, valid.map((s) => s.clientId ?? "").filter(Boolean)),
    getManyByIds<SupportTicket>(COLLECTIONS.supportTickets, idsOf("chamado")),
    getManyByIds<Task>(COLLECTIONS.tasks, idsOf("tarefa")),
    getManyByIds<WorkflowStep>(COLLECTIONS.workflowSteps, idsOf("workflow_step")),
    getManyByIds<ImplementationProject>(COLLECTIONS.implementationProjects, idsOf("projeto")),
    getManyByIds<Opportunity>(COLLECTIONS.opportunities, idsOf("oportunidade")),
  ]);
  return { instances: valid, users: new Map(users.map((u) => [u.id, u])), clients, tickets, tasks, steps, projects, opportunities };
}

function describe(s: SlaInstance, data: LoadedData): { reference: string; title: string; href: string; priority?: SlaPriority; department?: DepartmentKey; clientId?: string } {
  switch (s.entityType) {
    case "chamado": {
      const t = data.tickets.get(s.entityId);
      return { reference: t?.number ?? "Chamado", title: t?.subject ?? s.ruleName, href: `/suporte/chamados/${s.entityId}`, priority: normalizePriority(t?.priority), department: s.department ?? "suporte", clientId: s.clientId ?? t?.clientId };
    }
    case "tarefa": {
      const t = data.tasks.get(s.entityId);
      return { reference: "Tarefa", title: t?.title ?? s.ruleName, href: `/tarefas?tarefa=${s.entityId}`, priority: normalizePriority(t?.priority), department: t?.departmentId ?? s.department, clientId: s.clientId ?? t?.clientId };
    }
    case "workflow_step": {
      const st = data.steps.get(s.entityId);
      return { reference: "Etapa", title: st ? `${st.stageName}` : s.ruleName, href: `/workflow?etapa=${s.entityId}`, department: st?.department ?? s.department, clientId: s.clientId ?? st?.clientId };
    }
    case "projeto": {
      const p = data.projects.get(s.entityId);
      return { reference: "Projeto", title: p?.name ?? s.ruleName, href: `/implantacao/${s.entityId}`, department: s.department ?? "implantacao", clientId: s.clientId ?? p?.clientId };
    }
    case "oportunidade": {
      const o = data.opportunities.get(s.entityId);
      return { reference: "Oportunidade", title: o?.title ?? s.ruleName, href: `/vendas/oportunidades?oportunidade=${s.entityId}`, department: s.department ?? "vendas", clientId: s.clientId ?? o?.clientId };
    }
    default:
      return { reference: "CS", title: s.ruleName, href: s.clientId ? `/clientes/${s.clientId}?aba=cs` : "/cs", department: s.department ?? "cs", clientId: s.clientId };
  }
}

function toItem(s: SlaInstance, data: LoadedData, now: Date): SlaItem {
  const view = computeSlaState(s, now);
  const d = describe(s, data);
  const client = d.clientId ? data.clients.get(d.clientId) : undefined;
  const owner = s.ownerId ? data.users.get(s.ownerId) : undefined;
  const department = d.department ?? owner?.departmentId;
  const bucket: SlaItem["bucket"] = view.state === "violado" ? "violado" : view.state === "em_risco" ? "risco" : "dentro";
  return {
    id: s.id,
    entityType: s.entityType,
    entityId: s.entityId,
    typeLabel: SLA_TYPE_LABELS[s.entityType],
    reference: d.reference,
    title: d.title,
    href: d.href,
    clientId: d.clientId,
    clientName: client?.tradeName,
    department,
    departmentLabel: department ? DEPARTMENT_LABELS[department] : undefined,
    ownerId: s.ownerId,
    ownerName: owner?.name,
    ownerAvatarUrl: owner?.avatarUrl,
    priority: d.priority,
    ruleName: s.ruleName,
    state: view.state,
    stateLabel: SLA_STATE_LABELS[view.state],
    bucket,
    active: s.status !== "concluido",
    startedAt: s.startedAt,
    dueAt: s.dueAt,
    completedAt: s.completedAt,
    remainingMs: view.remainingMs,
    live: {
      status: s.status,
      startedAt: s.startedAt,
      dueAt: s.dueAt,
      responseDueAt: s.responseDueAt,
      respondedAt: s.respondedAt,
      pausedAt: s.pausedAt,
      pauseReason: s.pauseReason,
      completedAt: s.completedAt,
      attentionPct: s.attentionPct,
      riskPct: s.riskPct,
      ruleName: s.ruleName,
      view,
    },
  };
}

function relevant(s: SlaInstance, period: Period, current: boolean): boolean {
  if (s.status === "concluido") return inPeriod(s.completedAt, period);
  if (s.startedAt >= period.end) return false;
  return current || inPeriod(s.dueAt, period);
}

function matches(item: SlaItem, filters: SlaFilters): boolean {
  if (filters.departamento && item.department !== filters.departamento) return false;
  if (filters.responsavel && item.ownerId !== filters.responsavel) return false;
  if (filters.cliente && item.clientId !== filters.cliente) return false;
  if (filters.prioridade && item.priority !== filters.prioridade) return false;
  if (filters.tipo && item.entityType !== filters.tipo) return false;
  if (filters.q) {
    const q = filters.q.toLocaleLowerCase("pt-BR");
    const hay = [item.reference, item.title, item.clientName, item.ownerName, item.ruleName].filter(Boolean).join(" ").toLocaleLowerCase("pt-BR");
    if (!hay.includes(q)) return false;
  }
  return true;
}

/** Avaliação de cumprimento de uma instância no período (undefined = ainda não avaliável). */
function evaluation(item: SlaItem, period: Period, nowIso: string): boolean | undefined {
  if (!item.active) return inPeriod(item.completedAt, period) ? item.completedAt! <= item.dueAt : undefined;
  if (item.live.status === "pausado") return undefined;
  return item.dueAt < nowIso && inPeriod(item.dueAt, period) ? false : undefined;
}

function compliance(items: SlaItem[], period: Period, nowIso: string): SlaCompliance {
  let met = 0;
  let evaluated = 0;
  for (const i of items) {
    const e = evaluation(i, period, nowIso);
    if (e === undefined) continue;
    evaluated += 1;
    if (e) met += 1;
  }
  return { met, evaluated, rate: evaluated > 0 ? met / evaluated : null };
}

function groupRows(items: SlaItem[], period: Period, nowIso: string, keyOf: (i: SlaItem) => string | undefined, labelOf: (key: string) => string): SlaGroupRow[] {
  const groups = new Map<string, SlaItem[]>();
  for (const i of items) {
    const k = keyOf(i);
    if (!k) continue;
    groups.set(k, [...(groups.get(k) ?? []), i]);
  }
  return Array.from(groups.entries())
    .map(([key, group]) => ({ key, label: labelOf(key), total: group.length, violated: group.filter((g) => g.bucket === "violado").length, atRisk: group.filter((g) => g.bucket === "risco").length, ...compliance(group, period, nowIso) }))
    .sort((a, b) => (b.rate ?? -1) - (a.rate ?? -1) || a.label.localeCompare(b.label, "pt-BR"));
}

function avg(values: number[]): number | null {
  return values.length > 0 ? values.reduce((s, v) => s + v, 0) / values.length : null;
}

function summarize(items: SlaItem[], period: Period, data: LoadedData, now: Date): SlaSummary {
  const nowIso = now.toISOString();
  const responses: number[] = [];
  for (const i of items) {
    const respondedAt = i.live.respondedAt ?? (i.entityType === "chamado" ? data.tickets.get(i.entityId)?.firstResponseAt : undefined);
    if (i.live.responseDueAt && respondedAt && inPeriod(respondedAt, period)) responses.push((Date.parse(respondedAt) - Date.parse(i.startedAt)) / 60_000);
  }
  const resolutions = items.filter((i) => !i.active && i.completedAt).map((i) => (Date.parse(i.completedAt!) - Date.parse(i.startedAt)) / HOUR_MS);
  const dueNextHour = items.filter((i) => i.active && i.live.status !== "pausado" && i.remainingMs > 0 && i.remainingMs <= HOUR_MS).sort((a, b) => a.remainingMs - b.remainingMs);
  return {
    period,
    items,
    counts: {
      total: items.length,
      onTime: items.filter((i) => i.bucket === "dentro").length,
      atRisk: items.filter((i) => i.bucket === "risco").length,
      violated: items.filter((i) => i.bucket === "violado").length,
    },
    compliance: compliance(items, period, nowIso),
    response: { avgMinutes: avg(responses), count: responses.length },
    resolution: { avgHours: avg(resolutions), count: resolutions.length },
    dueNextHour,
    byDepartment: groupRows(items, period, nowIso, (i) => i.department, (k) => DEPARTMENT_LABELS[k as DepartmentKey] ?? k),
    byOwner: groupRows(items, period, nowIso, (i) => i.ownerId, (k) => data.users.get(k)?.name ?? "Colaborador removido"),
  };
}

async function loadItems(period: Period, now: Date): Promise<{ data: LoadedData; items: SlaItem[] }> {
  const data = await loadData();
  const current = isCurrentPeriod(period, now);
  const items = data.instances.filter((s) => relevant(s, period, current)).map((s) => toItem(s, data, now));
  return { data, items };
}

/**
 * Resumo de SLA de um conjunto de responsáveis (Dashboard do Gestor, Meu Desempenho): mesmas regras da tela
 * /sla. Sem `ownerIds`, a empresa toda.
 */
export async function getSlaSummary(period: Period, options: { ownerIds?: string[]; filters?: SlaFilters } = {}): Promise<SlaSummary> {
  const now = new Date();
  const { data, items } = await loadItems(period, now);
  const owners = options.ownerIds ? new Set(options.ownerIds) : null;
  const filtered = items.filter((i) => (!owners || (i.ownerId && owners.has(i.ownerId))) && matches(i, options.filters ?? {}));
  return summarize(filtered, period, data, now);
}

/** Resumos de vários períodos com uma única leitura das instâncias (comparativo com o período anterior). */
export async function getSlaSummaries(periods: Period[], options: { ownerIds?: string[]; filters?: SlaFilters } = {}): Promise<SlaSummary[]> {
  const now = new Date();
  const data = await loadData();
  const owners = options.ownerIds ? new Set(options.ownerIds) : null;
  return periods.map((period) => {
    const current = isCurrentPeriod(period, now);
    const items = data.instances
      .filter((s) => relevant(s, period, current))
      .map((s) => toItem(s, data, now))
      .filter((i) => (!owners || (i.ownerId && owners.has(i.ownerId))) && matches(i, options.filters ?? {}));
    return summarize(items, period, data, now);
  });
}

const STATE_ORDER: Record<SlaItem["bucket"], number> = { violado: 0, risco: 1, dentro: 2 };

/** Tudo da tela /sla: indicadores, críticos, listas, agrupamentos e opções dos filtros. */
export async function getSlaOverview(period: Period, filters: SlaFilters): Promise<SlaOverview> {
  const now = new Date();
  const [{ data, items }, refs, kpiDocs] = await Promise.all([loadItems(period, now), getSetting<{ slaSuporte?: number }>("metas_referencia", { slaSuporte: 0.9 }), loadKpiDocs()]);
  const filtered = items.filter((i) => matches(i, filters));
  const summary = summarize(filtered, period, data, now);
  const critical = filtered.filter((i) => i.active && i.bucket !== "dentro").sort((a, b) => STATE_ORDER[a.bucket] - STATE_ORDER[b.bucket] || a.remainingMs - b.remainingMs);
  const listed =
    filters.janela === "1h"
      ? summary.dueNextHour
      : filters.lista === "todos"
        ? [...filtered].sort((a, b) => Number(b.active) - Number(a.active) || STATE_ORDER[a.bucket] - STATE_ORDER[b.bucket] || a.remainingMs - b.remainingMs)
        : critical;

  const target = (key: string) => kpiDocs.find((k) => k.key === key)?.target ?? null;
  // Metas de tempo médio vêm dos indicadores de Suporte: só valem quando a tela está filtrada em chamados.
  const onlyTickets = filters.tipo === "chamado";

  const ownerIds = new Set(items.map((i) => i.ownerId).filter((id): id is string => Boolean(id)));
  const clientIds = new Set(items.map((i) => i.clientId).filter((id): id is string => Boolean(id)));
  const departments = new Set(items.map((i) => i.department).filter((d): d is DepartmentKey => Boolean(d)));

  return {
    ...summary,
    filters,
    current: isCurrentPeriod(period, now),
    critical,
    listed,
    targets: {
      compliance: typeof refs.slaSuporte === "number" ? refs.slaSuporte : 0.9,
      responseMinutes: onlyTickets ? target("tempo_medio_resposta_min") : null,
      resolutionHours: onlyTickets ? target("tempo_medio_solucao_h") : null,
    },
    options: {
      departments: Array.from(departments)
        .map((d) => ({ value: d, label: DEPARTMENT_LABELS[d] }))
        .sort((a, b) => a.label.localeCompare(b.label, "pt-BR")),
      owners: Array.from(ownerIds)
        .map((id) => ({ value: id, label: data.users.get(id)?.name ?? "Colaborador removido" }))
        .sort((a, b) => a.label.localeCompare(b.label, "pt-BR")),
      clients: Array.from(clientIds)
        .map((id) => ({ value: id, label: data.clients.get(id)?.tradeName ?? "Cliente removido" }))
        .sort((a, b) => a.label.localeCompare(b.label, "pt-BR")),
    },
  };
}

export { SLA_ENTITY_TYPES };
