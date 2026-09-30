import "server-only";
/**
 * Leituras do Meu Dia. Consulta DIRETAMENTE as coleções (sem depender das queries dos outros
 * módulos), filtra pelo usuário atual (ou pela equipe, no modo gestor) e monta um único objeto
 * `MeuDiaData` serializável para a página. Só filtros de igualdade no Firestore; agregação em memória.
 *
 * Ordenação das prioridades: score = urgência (atraso) + prazo (proximidade) + impacto (MRR,
 * criticidade do chamado, valor da oportunidade) + prioridade (PRIORITY_WEIGHT) + estado do SLA.
 */
import { getManyByIds, list } from "@/server/db";
import { computeSlaState } from "@/server/sla";
import { listNotifications } from "@/server/notifications";
import { sweepOverdue } from "@/server/finance/billing";
import { getDueSoonDays } from "@/server/finance/regua";
import { can } from "@/server/auth/permissions";
import { resolveDataScope } from "@/server/auth/scope";
import { toNotificationItem } from "@/components/notifications/model";
import {
  COLLECTIONS,
  type BaseEntity,
  type Billing,
  type Client,
  type CollectionName,
  type Commission,
  type Communication,
  type Contract,
  type SuccessPlan,
  type TicketInteraction,
  type CsAccount,
  type CurrentUser,
  type Goal,
  type ImplementationProject,
  type Lead,
  type Notification,
  type Opportunity,
  type Payable,
  type PayableStatus,
  type Renewal,
  type Settings,
  type SlaInstance,
  type SlaView,
  type SupportTicket,
  type Task,
  type Training,
  type User,
  type Visit,
  type WorkflowStep,
} from "@/domain/types";
import { DEPARTMENT_LABELS, PRIORITY_WEIGHT, type DepartmentKey, type Priority } from "@/domain/constants";
import { PAYABLE_STATUS_LABELS } from "@/domain/commissions";
import { formatCurrency } from "@/lib/format";
import { computeKpiBatch, kpiHref, monthPeriod, type KpiResult } from "@/server/kpis/queries";
import { CONTRACT_STATUS_LABELS } from "@/components/clients/labels";
import type {
  AgendaItem,
  AttentionClient,
  AwaitingItem,
  PendingContractItem,
  FinanceDigest,
  FinanceItem,
  FinanceSection,
  FollowupItem,
  GoalItem,
  MeuDiaData,
  MeuDiaScope,
  MeuDiaSections,
  MeuDiaStats,
  NotificationItem,
  PriorityItem,
  PriorityKind,
  ReasonTone,
  StepItem,
  TeamMember,
} from "@/components/meu-dia/model";

export type { MeuDiaData, MeuDiaScope } from "@/components/meu-dia/model";

// ---------------------------------------------------------------------------
// Datas em America/Sao_Paulo (rótulos calculados no servidor para não divergir na hidratação)
// ---------------------------------------------------------------------------

const TZ = "America/Sao_Paulo";
const keyFormat = new Intl.DateTimeFormat("en-CA", { timeZone: TZ, year: "numeric", month: "2-digit", day: "2-digit" });
const timeFormat = new Intl.DateTimeFormat("pt-BR", { timeZone: TZ, hour: "2-digit", minute: "2-digit" });
const hourFormat = new Intl.DateTimeFormat("en-US", { timeZone: TZ, hour: "numeric", hourCycle: "h23" });
const longDateFormat = new Intl.DateTimeFormat("pt-BR", { timeZone: TZ, weekday: "long", day: "numeric", month: "long", year: "numeric" });
const MONTHS_SHORT = ["jan", "fev", "mar", "abr", "mai", "jun", "jul", "ago", "set", "out", "nov", "dez"];
const HOUR_MS = 3_600_000;
const DAY_MS = 86_400_000;

function dayKey(iso: string): string {
  return keyFormat.format(new Date(iso));
}

function addDaysToKey(key: string, days: number): string {
  const [y, m, d] = key.split("-").map(Number);
  return new Date(Date.UTC(y, m - 1, d + days)).toISOString().slice(0, 10);
}

function timeLabel(iso: string): string {
  return timeFormat.format(new Date(iso));
}

/** "Hoje, 14:00" · "Ontem, 09:30" · "Amanhã, 08:00" · "3 out, 17:00". */
function dateLabel(iso: string, today: string): string {
  const key = dayKey(iso);
  const [y, m, d] = key.split("-").map(Number);
  let day: string;
  if (key === today) day = "Hoje";
  else if (key === addDaysToKey(today, -1)) day = "Ontem";
  else if (key === addDaysToKey(today, 1)) day = "Amanhã";
  else day = `${d} ${MONTHS_SHORT[m - 1]}${String(y) !== today.slice(0, 4) ? ` ${y}` : ""}`;
  return `${day}, ${timeLabel(iso)}`;
}

function humanDuration(ms: number): string {
  const abs = Math.abs(ms);
  if (abs < HOUR_MS) return `${Math.max(1, Math.round(abs / 60_000))} min`;
  if (abs < DAY_MS) return `${Math.floor(abs / HOUR_MS)}h`;
  const days = Math.floor(abs / DAY_MS);
  return `${days} dia${days === 1 ? "" : "s"}`;
}

function ago(iso: string, nowMs: number): string {
  return `há ${humanDuration(nowMs - new Date(iso).getTime())}`;
}

function until(iso: string, nowMs: number): string {
  return `em ${humanDuration(new Date(iso).getTime() - nowMs)}`;
}

function greetingFor(now: Date): string {
  const hour = Number(hourFormat.format(now)) % 24;
  if (hour < 12) return "Bom dia";
  if (hour < 18) return "Boa tarde";
  return "Boa noite";
}

function plural(count: number, singular: string, pluralForm: string): string {
  return `${count} ${count === 1 ? singular : pluralForm}`;
}

// ---------------------------------------------------------------------------
// Pontuação
// ---------------------------------------------------------------------------

const OVERDUE_CAP_HOURS = 72;
const AHEAD_WINDOW_HOURS = 48;

/** Atraso (0..40) ou proximidade do prazo (0..25). */
function urgencyScore(dueAt: string | undefined, nowMs: number): number {
  if (!dueAt) return 0;
  const diffHours = (new Date(dueAt).getTime() - nowMs) / HOUR_MS;
  if (diffHours < 0) return 40 * Math.min(-diffHours / OVERDUE_CAP_HOURS, 1);
  return 25 * Math.max(0, 1 - diffHours / AHEAD_WINDOW_HOURS);
}

function slaScore(sla: SlaView | null | undefined): number {
  if (!sla) return 0;
  if (sla.state === "violado") return 40;
  if (sla.state === "em_risco") return 30;
  if (sla.state === "em_atencao") return 12;
  return 0;
}

function priorityScore(priority?: Priority): number {
  return priority ? PRIORITY_WEIGHT[priority] * 3 : 0;
}

/** Impacto normalizado (0..20) em relação ao maior valor do conjunto. */
function impactScore(value: number | undefined, max: number): number {
  if (!value || max <= 0) return 0;
  return 20 * Math.min(value / max, 1);
}

const TICKET_PRIORITY: Record<SupportTicket["priority"], Priority> = { critico: "critica", alto: "alta", medio: "media", baixo: "baixa" };
const TICKET_PRIORITY_LABEL: Record<SupportTicket["priority"], string> = { critico: "Crítico", alto: "Alto", medio: "Médio", baixo: "Baixo" };
const TICKET_IMPACT: Record<SupportTicket["priority"], number> = { critico: 20, alto: 14, medio: 8, baixo: 3 };

/** Texto e tom do motivo a partir do estado do SLA (null quando não há SLA). */
function slaReason(sla: SlaView | null, nowMs: number): { reason: string; tone: ReasonTone } | null {
  if (!sla) return null;
  const pct = Math.round(sla.consumedPct);
  switch (sla.state) {
    case "violado":
      return { reason: `SLA violado ${ago(sla.dueAt, nowMs)}`, tone: "danger" };
    case "em_risco":
      return { reason: `SLA em risco ${pct}%`, tone: "danger" };
    case "em_atencao":
      return { reason: `SLA em atenção ${pct}%`, tone: "warning" };
    case "pausado":
      return { reason: "SLA pausado (aguardando cliente)", tone: "muted" };
    case "concluido":
      return { reason: "SLA concluído", tone: "muted" };
    default:
      return { reason: `SLA vence ${until(sla.dueAt, nowMs)}`, tone: "info" };
  }
}

const SLA_ENTITY_KIND: Record<SlaInstance["entityType"], PriorityKind> = {
  tarefa: "tarefa",
  workflow_step: "etapa",
  chamado: "chamado",
  projeto: "projeto",
  cs: "cliente",
  oportunidade: "oportunidade",
};

function slaEntityHref(sla: SlaInstance): string {
  switch (sla.entityType) {
    case "tarefa":
      return `/tarefas?tarefa=${sla.entityId}`;
    case "workflow_step":
      return `/workflow?etapa=${sla.entityId}`;
    case "chamado":
      return `/suporte/chamados?chamado=${sla.entityId}`;
    case "projeto":
      return `/implantacao/${sla.entityId}`;
    case "oportunidade":
      return `/vendas/oportunidades?oportunidade=${sla.entityId}`;
    default:
      return sla.clientId ? `/clientes/${sla.clientId}?aba=cs` : "/cs";
  }
}

// ---------------------------------------------------------------------------
// Escopo (eu / equipe)
// ---------------------------------------------------------------------------

/** Lista documentos cujo campo `field` pertence a um dos usuários do escopo. */
async function byOwner<T extends BaseEntity>(name: CollectionName, field: string, ids: string[]): Promise<T[]> {
  if (ids.length === 0) return [];
  if (ids.length === 1) return list<T>(name, { where: [[field, "==", ids[0]]] });
  return list<T>(name, { where: [[field, "in", ids]] });
}

interface ScopeInfo {
  members: User[];
  allUsers: User[];
  canToggle: boolean;
  scope: MeuDiaScope;
}

/**
 * Escopo do Meu Dia pela tela `inicio.meu-dia` (resolveDataScope): visão inicial sempre "eu"; a alternância para a
 * equipe exige a seção "Visão da equipe" e um escopo mais amplo que "meus". Padrão: gestor = ele + liderados diretos;
 * diretoria/admin = toda a organização; demais = só o próprio. O próprio usuário sempre faz parte da equipe.
 * Exportada para a equivalência com resolveDataScope (tests/permissions).
 */
export async function resolveScope(user: CurrentUser, requested: MeuDiaScope): Promise<ScopeInfo> {
  const [activeUsers, data] = await Promise.all([list<User>(COLLECTIONS.users, { where: [["active", "==", true]] }), resolveDataScope(user, "inicio.meu-dia")]);
  const allUsers = activeUsers.sort((a, b) => a.name.localeCompare(b.name, "pt-BR"));
  const canToggle = data.kind !== "meus" && can(user, "inicio.meu-dia.equipe.ver");
  if (requested !== "equipe" || !canToggle) return { members: [user], allUsers, canToggle, scope: "eu" };
  const team = data.userIds ? allUsers.filter((u) => data.userIds!.has(u.id)) : allUsers;
  if (!team.some((u) => u.id === user.id)) team.unshift(user);
  return { members: team, allUsers, canToggle, scope: "equipe" };
}

/** Seções visíveis do Meu Dia (catálogo inicio.meu-dia.<secao>.ver). */
export function meuDiaSections(user: CurrentUser): MeuDiaSections {
  return {
    prioridades: can(user, "inicio.meu-dia.prioridades.ver"),
    equipe: can(user, "inicio.meu-dia.equipe.ver"),
    insights: can(user, "inicio.meu-dia.insights.ver"),
    financeiro: can(user, "inicio.meu-dia.financeiro.ver"),
    cobrancasVendas: can(user, "inicio.meu-dia.cobrancas-vendas.ver"),
    contratos: can(user, "inicio.meu-dia.contratos.ver"),
    agenda: can(user, "inicio.meu-dia.agenda.ver"),
    aguardando: can(user, "inicio.meu-dia.aguardando.ver"),
    followups: can(user, "inicio.meu-dia.followups.ver"),
    etapas: can(user, "inicio.meu-dia.etapas.ver"),
    clientesAtencao: can(user, "inicio.meu-dia.clientes-atencao.ver"),
    metas: can(user, "inicio.meu-dia.metas.ver"),
    notificacoes: can(user, "inicio.meu-dia.notificacoes.ver"),
  };
}

// ---------------------------------------------------------------------------
// Metas do mês
// ---------------------------------------------------------------------------

// ---------------------------------------------------------------------------
// Perfil financeiro / comercial (D17): o Meu Dia é um só; o que muda é o que entra nele.
// ---------------------------------------------------------------------------

/** Contratos ainda no Financeiro (fila da equipe financeira). */
const PENDING_CONTRACT_STATUSES: Contract["status"][] = ["aguardando_contrato", "aguardando_assinatura", "assinado", "aguardando_pagamento", "pago", "pendencia"];
/** Contratos das vendas do vendedor que dependem do cliente assinar. */
const SELLER_CONTRACT_STATUSES = new Set<Contract["status"]>(["aguardando_contrato", "aguardando_assinatura"]);
const OPEN_PAYABLE_STATUSES: PayableStatus[] = ["previsto", "aprovado", "a_pagar"];
/** Padrão de "vencem nos próximos N dias"; com a régua de cobrança ativa vale o menor marco antes do vencimento (getDueSoonDays). */
const DEFAULT_DUE_SOON_DAYS = 3;
const FINANCE_SECTION_LIMIT = 6;
const BILLING_TYPE_LABEL: Record<Billing["type"], string> = { setup: "Adesão", mensalidade: "Mensalidade", hardware: "Hardware", servico: "Serviço" };

interface MeuDiaProfile {
  /** Equipe financeira, gestor financeiro, admin ou diretoria: fila do Financeiro inteira. */
  finance: boolean;
  /** Vendedor (ou equipe com vendedores, no modo gestor): só o que é das próprias vendas. */
  sales: boolean;
}

/**
 * Perfil financeiro = seção "Financeiro do dia" (padrão: equipe financeira, admin, diretoria ≡ isFinanceTeam);
 * perfil comercial = vendedor (ou equipe com vendedores) E a seção "Cobranças e contratos das minhas vendas".
 */
function profileOf(user: CurrentUser, members: User[], sections: MeuDiaSections): MeuDiaProfile {
  const isSeller = (u: Pick<User, "role" | "departmentId">) => u.role === "vendas" || u.departmentId === "vendas";
  return { finance: sections.financeiro, sales: sections.cobrancasVendas && (isSeller(user) || members.some(isSeller)) };
}

function billingLabel(b: Billing): string {
  return `${BILLING_TYPE_LABEL[b.type]}${b.installment ? ` ${b.installment}` : ""} · ${b.competence.split("-").reverse().join("/")}`;
}

const OPEN_TASK_STATUS = new Set<Task["status"]>(["aberta", "em_andamento"]);
const OPEN_STEP_STATUS = new Set<WorkflowStep["status"]>(["pendente", "em_andamento", "aguardando_cliente", "aguardando_aprovacao"]);
const OPEN_TICKET_STATUS = new Set<SupportTicket["status"]>(["aberto", "em_atendimento", "reaberto", "aguardando_cliente"]);
const OPEN_OPP_STAGE = (stage: Opportunity["stage"]) => stage !== "ganho" && stage !== "perdido";
const OPEN_LEAD_STATUS = new Set<Lead["status"]>(["novo", "em_contato"]);

/**
 * Metas do mês com o valor calculado pelo motor de indicadores (mesmo número do Meu Desempenho, do
 * Dashboard do Gestor e do drill-down): uma única carga para todos os escopos das metas.
 */
async function computeGoals(user: CurrentUser, scopeInfo: ScopeInfo, month: string): Promise<GoalItem[]> {
  const memberIds = new Set(scopeInfo.members.map((u) => u.id));
  const goals = await list<Goal>(COLLECTIONS.goals, { where: [["period", "==", month]] });
  // No modo equipe, as metas dos departamentos representados na equipe também entram.
  const teamDepartments = new Set(scopeInfo.scope === "equipe" ? scopeInfo.members.map((u) => u.departmentId) : []);
  const relevant = goals.filter((g) => {
    if (g.scope === "usuario") return Boolean(g.scopeId && memberIds.has(g.scopeId));
    if (g.scope === "departamento") return g.scopeId === user.departmentId || (Boolean(g.scopeId) && teamDepartments.has(g.scopeId as DepartmentKey));
    return user.isDirector;
  });
  if (relevant.length === 0) return [];

  const period = monthPeriod(month);
  const groups = new Map<string, { scope: Goal["scope"]; scopeId?: string; keys: string[] }>();
  for (const g of relevant) {
    const k = `${g.scope}|${g.scopeId ?? ""}`;
    const group = groups.get(k) ?? { scope: g.scope, scopeId: g.scopeId, keys: [] };
    group.keys.push(g.kpiKey);
    groups.set(k, group);
  }
  const requests = Array.from(groups.values());
  const batches = await computeKpiBatch(requests, period, { withTrend: false, withSources: false });
  const resultFor = new Map<string, KpiResult>();
  requests.forEach((req, i) => {
    for (const r of batches[i] ?? []) resultFor.set(`${req.scope}|${req.scopeId ?? ""}|${r.key}`, r);
  });

  const scopeLabelOf = (g: Goal): string => {
    if (g.scope === "usuario") return scopeInfo.allUsers.find((u) => u.id === g.scopeId)?.name.split(" ")[0] ?? "Você";
    if (g.scope === "departamento") return DEPARTMENT_LABELS[g.scopeId as keyof typeof DEPARTMENT_LABELS] ?? g.scopeId ?? "Departamento";
    return "Empresa";
  };

  const items: GoalItem[] = relevant.map((g) => {
    const r = resultFor.get(`${g.scope}|${g.scopeId ?? ""}|${g.kpiKey}`);
    const value = r?.value ?? null;
    return {
      id: g.id,
      kpiKey: g.kpiKey,
      name: r?.kpi.name ?? g.kpiKey,
      unit: r?.kpi.unit ?? "numero",
      direction: r?.kpi.direction ?? "maior_melhor",
      scopeLabel: scopeLabelOf(g),
      target: g.target,
      value,
      attainment: r?.attainment === null || r?.attainment === undefined ? null : Number(r.attainment.toFixed(3)),
      source: value === null ? "indisponivel" : "calculado",
      href: r?.href ?? kpiHref(g.kpiKey, period, g.scope, g.scopeId),
    };
  });
  // Metas pessoais primeiro, depois departamento e empresa; dentro do grupo, maior peso.
  const order: Record<Goal["scope"], number> = { usuario: 0, departamento: 1, empresa: 2 };
  const weightOf = new Map(relevant.map((g) => [g.id, g]));
  return items.sort((a, b) => {
    const ga = weightOf.get(a.id)!;
    const gb = weightOf.get(b.id)!;
    return order[ga.scope] - order[gb.scope] || gb.weight - ga.weight || a.name.localeCompare(b.name, "pt-BR");
  });
}

// ---------------------------------------------------------------------------
// Montagem
// ---------------------------------------------------------------------------

export async function getMeuDia(user: CurrentUser, requestedScope: MeuDiaScope = "eu"): Promise<MeuDiaData> {
  const now = new Date();
  const nowMs = now.getTime();
  const nowIso = now.toISOString();
  const today = dayKey(nowIso);
  const month = today.slice(0, 7);
  const scopeInfo = await resolveScope(user, requestedScope);
  const { members, allUsers, scope } = scopeInfo;
  const ids = members.map((u) => u.id);
  const userById = new Map(allUsers.map((u) => [u.id, u]));
  const nameOf = (id: string | undefined) => (id ? userById.get(id)?.name : undefined);
  const isTeam = scope === "equipe";
  const sections = meuDiaSections(user);
  const profile = profileOf(user, members, sections);
  const canCompleteTasks = can(user, "operacao.tarefas.concluir");
  const wantsBillings = profile.finance || profile.sales;

  const [tasks, steps, leads, opps, projects, tickets, csClients, csAccounts, renewals, ownedSlas, visits, trainings, unread, oppSettings, goals, ownedContracts, successPlans, communications, openBillingsRaw, payables, eligibleCommissions, queueContracts, sellerContracts] = await Promise.all([
    byOwner<Task>(COLLECTIONS.tasks, "assigneeId", ids),
    byOwner<WorkflowStep>(COLLECTIONS.workflowSteps, "assigneeId", ids),
    byOwner<Lead>(COLLECTIONS.leads, "ownerId", ids),
    byOwner<Opportunity>(COLLECTIONS.opportunities, "ownerId", ids),
    byOwner<ImplementationProject>(COLLECTIONS.implementationProjects, "ownerId", ids),
    byOwner<SupportTicket>(COLLECTIONS.supportTickets, "assigneeId", ids),
    byOwner<Client>(COLLECTIONS.clients, "ownerCsId", ids),
    byOwner<CsAccount>(COLLECTIONS.csAccounts, "ownerId", ids),
    byOwner<Renewal>(COLLECTIONS.renewals, "ownerId", ids),
    byOwner<SlaInstance>(COLLECTIONS.slaInstances, "ownerId", ids),
    byOwner<Visit>(COLLECTIONS.visits, "sellerId", ids),
    byOwner<Training>(COLLECTIONS.trainings, "instructorId", ids),
    sections.notificacoes ? listNotifications(user.id, { unreadOnly: true }) : Promise.resolve([] as Notification[]),
    list<Settings>(COLLECTIONS.settings, { where: [["key", "==", "oportunidade"]] }),
    sections.metas ? computeGoals(user, scopeInfo, month) : Promise.resolve([] as GoalItem[]),
    byOwner<Contract>(COLLECTIONS.contracts, "ownerId", ids),
    byOwner<SuccessPlan>(COLLECTIONS.successPlans, "ownerId", ids),
    // Mensagens recebidas/enviadas (coleção pequena): base de "clientes aguardando retorno".
    sections.aguardando ? list<Communication>(COLLECTIONS.communications) : Promise.resolve([] as Communication[]),
    // Perfil financeiro/comercial (D17): cobranças em aberto (a varredura de vencidas roda na leitura, como no
    // Financeiro), títulos abertos, comissões elegíveis sem título, fila de contratos e contratos das vendas.
    wantsBillings ? list<Billing>(COLLECTIONS.billing, { where: [["status", "in", ["aberta", "vencida"]]] }) : Promise.resolve([] as Billing[]),
    profile.finance ? list<Payable>(COLLECTIONS.payables, { where: [["status", "in", OPEN_PAYABLE_STATUSES]] }) : Promise.resolve([] as Payable[]),
    profile.finance ? list<Commission>(COLLECTIONS.commissions, { where: [["status", "==", "liberada"]] }) : Promise.resolve([] as Commission[]),
    profile.finance ? list<Contract>(COLLECTIONS.contracts, { where: [["status", "in", PENDING_CONTRACT_STATUSES]] }) : Promise.resolve([] as Contract[]),
    profile.sales ? byOwner<Contract>(COLLECTIONS.contracts, "sellerId", ids) : Promise.resolve([] as Contract[]),
  ]);
  const openBillings = wantsBillings ? await sweepOverdue(openBillingsRaw) : [];
  const DUE_SOON_DAYS = wantsBillings ? await getDueSoonDays() : DEFAULT_DUE_SOON_DAYS;

  // Contratos ainda no Financeiro (não liberados nem cancelados): os de que o usuário é responsável; a fila
  // inteira para a equipe financeira; e, para o vendedor, os das próprias vendas que dependem da assinatura
  // (contratos antigos sem sellerId chegam pela oportunidade ganha).
  const contractById = new Map<string, Contract>();
  for (const c of [...ownedContracts, ...queueContracts, ...sellerContracts]) contractById.set(c.id, c);
  if (profile.sales) {
    const wonContractIds = opps.filter((o) => o.stage === "ganho" && o.contractId && !contractById.has(o.contractId)).map((o) => o.contractId!);
    for (const [id, c] of await getManyByIds<Contract>(COLLECTIONS.contracts, wonContractIds)) contractById.set(id, c);
  }
  const sellerOf = (c: Contract) => c.sellerId ?? opps.find((o) => o.id === c.opportunityId)?.ownerId;
  const pendingContracts = Array.from(contractById.values()).filter((c) => {
    if (c.status === "liberado" || c.status === "cancelado") return false;
    if (ids.includes(c.ownerId ?? "") || profile.finance) return true;
    return profile.sales && SELLER_CONTRACT_STATUSES.has(c.status) && ids.includes(sellerOf(c) ?? "");
  });

  // Clientes referenciados (nomes e MRR para o impacto), resolvidos em lote.
  const clientIds = new Set<string>();
  for (const x of [...tasks, ...leads, ...opps, ...projects, ...tickets, ...renewals, ...ownedSlas, ...visits, ...trainings, ...pendingContracts, ...successPlans, ...openBillings]) if (x.clientId) clientIds.add(x.clientId);
  for (const s of steps) clientIds.add(s.clientId);
  const clientById = new Map<string, Client>(csClients.map((c) => [c.id, c]));
  const missingClients = Array.from(clientIds).filter((id) => !clientById.has(id));
  const fetched = await getManyByIds<Client>(COLLECTIONS.clients, missingClients);
  for (const [id, c] of fetched) clientById.set(id, c);
  const clientName = (id: string | undefined) => (id ? clientById.get(id)?.tradeName : undefined);
  const clientMrr = (id: string | undefined) => (id ? (clientById.get(id)?.mrr ?? 0) : 0);
  const maxMrr = Math.max(0, ...Array.from(clientById.values()).map((c) => c.mrr ?? 0));
  const mrrLabel = (id: string | undefined) => {
    const mrr = clientMrr(id);
    return mrr > 0 ? `MRR ${formatCurrency(mrr, true)}` : undefined;
  };

  // SLAs referenciados pelas entidades (podem ter ownerId diferente do responsável atual).
  const slaById = new Map<string, SlaInstance>(ownedSlas.map((s) => [s.id, s]));
  const missingSlas = [...tasks, ...steps, ...tickets, ...projects].map((x) => x.slaInstanceId ?? "").filter((id) => id && !slaById.has(id));
  const fetchedSlas = await getManyByIds<SlaInstance>(COLLECTIONS.slaInstances, missingSlas);
  for (const [id, s] of fetchedSlas) slaById.set(id, s);
  const slaViewOf = (id: string | undefined): SlaView | null => {
    const sla = id ? slaById.get(id) : undefined;
    return sla ? computeSlaState(sla, now) : null;
  };

  const csByClient = new Map(csAccounts.map((a) => [a.clientId, a]));
  const stalledDays = Number(oppSettings[0]?.value?.diasSemMovimentoParaParada ?? 7);

  // -------------------------------------------------------------------------
  // Prioridades de agora
  // -------------------------------------------------------------------------
  const priorities: PriorityItem[] = [];
  const seen = new Set<string>();
  const push = (item: Omit<PriorityItem, "id">) => {
    const id = `${item.kind}:${item.entityId}`;
    if (seen.has(id)) return;
    seen.add(id);
    priorities.push({ ...item, id });
  };

  // Tarefas: abertas/em andamento com prazo hoje ou vencido, ou sem prazo mas críticas.
  const openTasks = tasks.filter((t) => OPEN_TASK_STATUS.has(t.status));
  for (const t of openTasks) {
    const dueKey = t.dueAt ? dayKey(t.dueAt) : undefined;
    const overdueDay = Boolean(dueKey && dueKey < today);
    const isToday = dueKey === today;
    if (!overdueDay && !isToday && !(t.dueAt === undefined && t.priority === "critica")) continue;
    const sla = slaViewOf(t.slaInstanceId);
    let reason: string;
    let tone: ReasonTone;
    if (t.dueAt && t.dueAt < nowIso) {
      reason = `Atrasada ${ago(t.dueAt, nowMs)}`;
      tone = "danger";
    } else if (t.dueAt) {
      reason = `Vence ${until(t.dueAt, nowMs)}`;
      tone = "warning";
    } else {
      reason = "Sem prazo · prioridade crítica";
      tone = "warning";
    }
    push({
      kind: "tarefa",
      entityId: t.id,
      title: t.title,
      clientId: t.clientId,
      clientName: t.clientName ?? clientName(t.clientId),
      reason,
      reasonTone: tone,
      dueAt: t.dueAt,
      dueLabel: t.dueAt ? dateLabel(t.dueAt, today) : undefined,
      priority: t.priority,
      sla,
      impactLabel: mrrLabel(t.clientId),
      score: urgencyScore(t.dueAt, nowMs) + priorityScore(t.priority) + impactScore(clientMrr(t.clientId), maxMrr) + slaScore(sla),
      href: `/tarefas?tarefa=${t.id}`,
      canComplete: canCompleteTasks,
      assigneeId: t.assigneeId,
      assigneeName: isTeam ? (t.assigneeName ?? nameOf(t.assigneeId)) : undefined,
      overdue: Boolean(t.dueAt && t.dueAt < nowIso),
    });
  }

  // Etapas de workflow atribuídas, com SLA.
  const openSteps = steps.filter((s) => OPEN_STEP_STATUS.has(s.status));
  for (const s of openSteps) {
    const sla = slaViewOf(s.slaInstanceId);
    if (!sla) continue;
    const r = slaReason(sla, nowMs)!;
    push({
      kind: "etapa",
      entityId: s.id,
      title: `Etapa ${s.stageName}`,
      clientId: s.clientId,
      clientName: s.clientName,
      reason: s.status === "aguardando_aprovacao" ? `Aguardando aprovação · ${r.reason}` : r.reason,
      reasonTone: r.tone,
      dueAt: s.dueAt,
      dueLabel: s.dueAt ? dateLabel(s.dueAt, today) : undefined,
      sla,
      impactLabel: mrrLabel(s.clientId),
      score: slaScore(sla) + urgencyScore(s.dueAt, nowMs) + impactScore(clientMrr(s.clientId), maxMrr),
      href: `/workflow?etapa=${s.id}`,
      canComplete: false,
      assigneeId: s.assigneeId,
      assigneeName: isTeam ? (s.assigneeName ?? nameOf(s.assigneeId)) : undefined,
      overdue: sla.state === "violado",
    });
  }

  // Leads novos/em contato com follow-up vencido ou sem contato há 24h.
  const openLeads = leads.filter((l) => OPEN_LEAD_STATUS.has(l.status));
  for (const l of openLeads) {
    const nextOverdue = Boolean(l.nextActionAt && l.nextActionAt < nowIso);
    const lastTouch = l.lastContactAt ?? l.createdAt;
    const staleHours = (nowMs - new Date(lastTouch).getTime()) / HOUR_MS;
    if (!nextOverdue && staleHours < 24) continue;
    const temperatureBonus = l.temperature === "quente" ? 10 : l.temperature === "morno" ? 5 : 0;
    push({
      kind: "lead",
      entityId: l.id,
      title: `${l.name}${l.company ? ` · ${l.company}` : ""}`,
      clientId: l.clientId,
      clientName: l.company ?? clientName(l.clientId),
      reason: nextOverdue ? `Follow-up vencido ${ago(l.nextActionAt!, nowMs)}` : `Sem contato ${ago(lastTouch, nowMs)}`,
      reasonTone: nextOverdue ? "danger" : "warning",
      dueAt: l.nextActionAt,
      dueLabel: l.nextActionAt ? dateLabel(l.nextActionAt, today) : undefined,
      impactLabel: `Lead ${l.temperature} · score ${l.score}`,
      score: (nextOverdue ? urgencyScore(l.nextActionAt, nowMs) : 25 * Math.min(staleHours / OVERDUE_CAP_HOURS, 1)) + temperatureBonus + (l.score / 100) * 10,
      href: `/marketing/leads?lead=${l.id}`,
      canComplete: false,
      assigneeId: l.ownerId,
      assigneeName: isTeam ? nameOf(l.ownerId) : undefined,
      overdue: nextOverdue,
    });
  }

  // Oportunidades: follow-up vencido, sem próxima ação ou paradas.
  const openOpps = opps.filter((o) => OPEN_OPP_STAGE(o.stage));
  const maxMonthly = Math.max(0, ...openOpps.map((o) => o.monthlyTotal ?? 0));
  for (const o of openOpps) {
    const nextOverdue = Boolean(o.nextActionAt && o.nextActionAt < nowIso);
    const noNext = !o.nextAction && !o.nextActionAt;
    const idleDays = (nowMs - new Date(o.lastActivityAt).getTime()) / DAY_MS;
    const stalled = idleDays >= stalledDays;
    if (!nextOverdue && !noNext && !stalled) continue;
    let reason: string;
    let tone: ReasonTone;
    if (nextOverdue) {
      reason = `Follow-up vencido ${ago(o.nextActionAt!, nowMs)}${o.nextAction ? ` · ${o.nextAction}` : ""}`;
      tone = "danger";
    } else if (noNext) {
      reason = "Sem próxima ação";
      tone = "warning";
    } else {
      reason = `Parada há ${Math.floor(idleDays)} dias`;
      tone = "warning";
    }
    push({
      kind: "oportunidade",
      entityId: o.id,
      title: o.title,
      clientId: o.clientId,
      clientName: clientName(o.clientId),
      reason,
      reasonTone: tone,
      dueAt: o.nextActionAt,
      dueLabel: o.nextActionAt ? dateLabel(o.nextActionAt, today) : undefined,
      impactLabel: o.monthlyTotal > 0 ? `${formatCurrency(o.monthlyTotal)}/mês` : o.setupTotal > 0 ? `${formatCurrency(o.setupTotal)} adesão` : undefined,
      score: urgencyScore(o.nextActionAt, nowMs) + (noNext ? 15 : 0) + (stalled ? 20 : 0) + impactScore(o.monthlyTotal, maxMonthly) + (o.probability / 100) * 5,
      href: `/vendas?oportunidade=${o.id}`,
      canComplete: false,
      assigneeId: o.ownerId,
      assigneeName: isTeam ? nameOf(o.ownerId) : undefined,
      overdue: nextOverdue,
    });
  }

  // Projetos de implantação: atrasados, aguardando cliente, bloqueados ou prontos para go-live.
  for (const p of projects) {
    if (p.status === "concluida" || p.status === "cancelada") continue;
    const late = p.dueDate < nowIso;
    let reason: string | null = null;
    let tone: ReasonTone = "warning";
    let bonus = 0;
    if (p.status === "bloqueada") {
      reason = "Bloqueada";
      tone = "danger";
      bonus = 25;
    } else if (p.status === "pronta_para_go_live") {
      reason = "Pronta para go-live";
      tone = "info";
      bonus = 20;
    } else if (p.status === "aguardando_cliente") {
      reason = `Aguardando cliente ${p.waitingClient?.since ? ago(p.waitingClient.since, nowMs) : ""}`.trim();
      tone = "warning";
      bonus = 10;
    } else if (late) {
      reason = `Atrasada ${ago(p.dueDate, nowMs)}`;
      tone = "danger";
    }
    if (!reason) continue;
    if (late && p.status !== "em_implantacao") reason += ` · prazo vencido ${ago(p.dueDate, nowMs)}`;
    const sla = slaViewOf(p.slaInstanceId);
    push({
      kind: "projeto",
      entityId: p.id,
      title: p.name,
      clientId: p.clientId,
      clientName: clientName(p.clientId),
      reason,
      reasonTone: tone,
      dueAt: p.dueDate,
      dueLabel: dateLabel(p.dueDate, today),
      sla,
      impactLabel: `${p.progress}% concluído`,
      score: urgencyScore(p.dueDate, nowMs) + bonus + slaScore(sla) + impactScore(clientMrr(p.clientId), maxMrr),
      href: `/implantacao/${p.id}`,
      canComplete: false,
      assigneeId: p.ownerId,
      assigneeName: isTeam ? nameOf(p.ownerId) : undefined,
      overdue: late,
    });
  }

  // Chamados abertos: crítico/alto primeiro, com SLA calculado.
  for (const t of tickets) {
    if (!OPEN_TICKET_STATUS.has(t.status)) continue;
    const sla = slaViewOf(t.slaInstanceId);
    const r = slaReason(sla, nowMs);
    let reason = r?.reason ?? "Sem SLA registrado";
    let tone: ReasonTone = r?.tone ?? "muted";
    if (t.status === "aberto" && !t.firstResponseAt) {
      reason = `Sem primeira resposta · ${reason}`;
      tone = tone === "muted" ? "warning" : tone;
    } else if (t.status === "reaberto") {
      reason = `Reaberto · ${reason}`;
    } else if (t.status === "aguardando_cliente") {
      reason = "Aguardando cliente";
      tone = "muted";
    }
    const priority = TICKET_PRIORITY[t.priority];
    push({
      kind: "chamado",
      entityId: t.id,
      title: `${t.number} · ${t.subject}`,
      clientId: t.clientId,
      clientName: clientName(t.clientId),
      reason,
      reasonTone: tone,
      dueAt: sla?.dueAt,
      dueLabel: sla ? dateLabel(sla.dueAt, today) : undefined,
      priority,
      sla,
      impactLabel: TICKET_PRIORITY_LABEL[t.priority],
      score: slaScore(sla) + priorityScore(priority) + TICKET_IMPACT[t.priority] + (t.status === "aberto" && !t.firstResponseAt ? 10 : 0),
      href: `/suporte/chamados?chamado=${t.id}`,
      canComplete: false,
      assigneeId: t.assigneeId,
      assigneeName: isTeam ? nameOf(t.assigneeId) : undefined,
      overdue: sla?.state === "violado",
    });
  }

  // Clientes da carteira (ownerCsId) com saúde em risco/atenção ou checkpoint vencido.
  const attentionClients: AttentionClient[] = [];
  for (const c of csClients) {
    if (c.status !== "ativo") continue;
    const nextOverdue = Boolean(c.nextInteractionAt && c.nextInteractionAt < nowIso);
    const level = c.healthLevel;
    if (level !== "risco" && level !== "atencao" && !nextOverdue) continue;
    const cs = csByClient.get(c.id);
    const detail = cs?.riskReasons?.[0];
    let reason: string;
    let tone: ReasonTone;
    let bonus: number;
    if (level === "risco") {
      reason = `Saúde em risco (${c.healthScore ?? "—"})${detail ? ` · ${detail}` : ""}`;
      tone = "danger";
      bonus = 30;
    } else if (level === "atencao") {
      reason = `Saúde em atenção (${c.healthScore ?? "—"})${detail ? ` · ${detail}` : ""}`;
      tone = "warning";
      bonus = 15;
    } else {
      reason = `Checkpoint vencido ${ago(c.nextInteractionAt!, nowMs)}`;
      tone = "warning";
      bonus = 5;
    }
    if (nextOverdue && level !== "saudavel" && level !== undefined) reason += ` · checkpoint vencido ${ago(c.nextInteractionAt!, nowMs)}`;
    attentionClients.push({ id: c.id, tradeName: c.tradeName, healthLevel: level, healthScore: c.healthScore, mrr: c.mrr ?? 0, reason, tone, href: `/clientes/${c.id}?aba=cs`, ownerName: isTeam ? nameOf(c.ownerCsId) : undefined });
    push({
      kind: "cliente",
      entityId: c.id,
      title: c.tradeName,
      clientId: c.id,
      clientName: c.tradeName,
      reason,
      reasonTone: tone,
      dueAt: c.nextInteractionAt,
      dueLabel: c.nextInteractionAt ? dateLabel(c.nextInteractionAt, today) : undefined,
      impactLabel: mrrLabel(c.id),
      score: bonus + urgencyScore(c.nextInteractionAt, nowMs) + impactScore(c.mrr, maxMrr),
      href: `/clientes/${c.id}?aba=cs`,
      canComplete: false,
      assigneeId: c.ownerCsId,
      assigneeName: isTeam ? nameOf(c.ownerCsId) : undefined,
      overdue: nextOverdue,
    });
  }
  attentionClients.sort((a, b) => (a.tone === b.tone ? b.mrr - a.mrr : a.tone === "danger" ? -1 : 1));

  // Renovações na janela (windowOpensAt já passou), aguardando ou em negociação.
  for (const r of renewals) {
    if (r.status !== "aguardando" && r.status !== "em_negociacao") continue;
    if (r.windowOpensAt > nowIso) continue;
    const daysLeft = (new Date(r.dueDate).getTime() - nowMs) / DAY_MS;
    const riskBonus = r.risk === "risco" ? 15 : r.risk === "atencao" ? 8 : 0;
    push({
      kind: "renovacao",
      entityId: r.id,
      title: `Renovação · ${clientName(r.clientId) ?? "cliente"}`,
      clientId: r.clientId,
      clientName: clientName(r.clientId),
      reason: daysLeft < 0 ? `Renovação vencida ${ago(r.dueDate, nowMs)}` : `${r.status === "em_negociacao" ? "Em negociação · " : ""}Vence ${until(r.dueDate, nowMs)}`,
      reasonTone: daysLeft < 0 ? "danger" : daysLeft <= 15 ? "warning" : "info",
      dueAt: r.dueDate,
      dueLabel: dateLabel(r.dueDate, today),
      impactLabel: mrrLabel(r.clientId),
      score: (daysLeft < 0 ? 40 : 25 * Math.max(0, 1 - daysLeft / 60)) + riskBonus + impactScore(clientMrr(r.clientId), maxMrr),
      href: `/cs/renovacoes`,
      canComplete: false,
      assigneeId: r.ownerId,
      assigneeName: isTeam ? nameOf(r.ownerId) : undefined,
      overdue: daysLeft < 0,
    });
  }

  // SLAs em risco/violados do responsável que ainda não apareceram por outra fonte.
  const riskSlas = ownedSlas.filter((s) => s.status === "em_andamento").map((s) => ({ sla: s, view: computeSlaState(s, now) })).filter((x) => x.view.state === "em_risco" || x.view.state === "violado");
  for (const { sla, view } of riskSlas) {
    const kind = SLA_ENTITY_KIND[sla.entityType];
    const entityId = sla.entityType === "cs" ? (sla.clientId ?? sla.entityId) : sla.entityId;
    if (seen.has(`${kind}:${entityId}`)) continue;
    const r = slaReason(view, nowMs)!;
    push({
      kind: "sla",
      entityId: sla.id,
      title: sla.ruleName,
      clientId: sla.clientId,
      clientName: clientName(sla.clientId),
      reason: r.reason,
      reasonTone: r.tone,
      dueAt: sla.dueAt,
      dueLabel: dateLabel(sla.dueAt, today),
      sla: view,
      impactLabel: mrrLabel(sla.clientId),
      score: slaScore(view) + impactScore(clientMrr(sla.clientId), maxMrr),
      href: slaEntityHref(sla),
      canComplete: false,
      assigneeId: sla.ownerId,
      assigneeName: isTeam ? nameOf(sla.ownerId) : undefined,
      overdue: view.state === "violado",
    });
  }

  // Clientes aguardando retorno: mensagens recebidas (lead, oportunidade ou cliente da carteira) sem
  // resposta posterior e chamados abertos cuja última interação veio do cliente.
  const awaiting: AwaitingItem[] = [];
  const myLeadIds = new Set(leads.map((l) => l.id));
  const myOppIds = new Set(openOpps.map((o) => o.id));
  const myClientIds = new Set([...csClients.map((c) => c.id), ...openOpps.map((o) => o.clientId)]);
  const lastOutgoing = new Map<string, string>();
  for (const c of communications) {
    if (c.direction !== "saida") continue;
    for (const key of [c.entityId ? `e:${c.entityId}` : null, c.clientId ? `c:${c.clientId}` : null]) {
      if (key && (lastOutgoing.get(key) ?? "") < c.createdAt) lastOutgoing.set(key, c.createdAt);
    }
  }
  const CHANNEL_TEXT: Record<Communication["channel"], string> = { whatsapp: "WhatsApp", voip: "Ligação", email: "E-mail", interno: "Interno" };
  const incoming = communications.filter((c) => c.direction === "entrada" && c.status !== "lida").sort((a, b) => b.createdAt.localeCompare(a.createdAt));
  const awaitingSeen = new Set<string>();
  for (const c of incoming) {
    const isLead = c.entityType === "lead" && c.entityId && myLeadIds.has(c.entityId);
    const isOpp = c.entityType === "opportunity" && c.entityId && myOppIds.has(c.entityId);
    const isClient = !isLead && !isOpp && c.clientId && myClientIds.has(c.clientId);
    if (!isLead && !isOpp && !isClient) continue;
    const key = isClient ? `c:${c.clientId}` : `e:${c.entityId}`;
    if (awaitingSeen.has(key)) continue;
    awaitingSeen.add(key);
    const answeredAt = [lastOutgoing.get(key), c.clientId ? lastOutgoing.get(`c:${c.clientId}`) : undefined].filter(Boolean).sort().pop();
    if (answeredAt && answeredAt > c.createdAt) continue;
    const lead = isLead ? leads.find((l) => l.id === c.entityId) : undefined;
    const opp = isOpp ? openOpps.find((o) => o.id === c.entityId) : undefined;
    const kind: AwaitingItem["kind"] = lead ? "lead" : opp ? "oportunidade" : "cliente";
    const title = lead ? `${lead.name}${lead.company ? ` · ${lead.company}` : ""}` : opp ? opp.title : (clientName(c.clientId) ?? "Cliente");
    const href = lead ? `/marketing/leads?lead=${lead.id}` : opp ? `/vendas?oportunidade=${opp.id}` : `/clientes/${c.clientId}?aba=timeline`;
    const ownerId = lead?.ownerId ?? opp?.ownerId ?? clientById.get(c.clientId ?? "")?.ownerCsId;
    awaiting.push({ id: `${kind}:${c.id}`, kind, title, clientId: c.clientId, clientName: clientName(c.clientId), excerpt: c.body, channel: CHANNEL_TEXT[c.channel], receivedAt: c.createdAt, receivedLabel: dateLabel(c.createdAt, today), href, assigneeName: isTeam ? nameOf(ownerId) : undefined });
  }
  const openTicketIds = tickets.filter((t) => OPEN_TICKET_STATUS.has(t.status) && t.status !== "aguardando_cliente").map((t) => t.id);
  const interactions = openTicketIds.length ? await list<TicketInteraction>(COLLECTIONS.ticketInteractions, { where: [["ticketId", "in", openTicketIds]] }) : [];
  const lastByTicket = new Map<string, TicketInteraction>();
  for (const i of interactions) {
    if (i.kind === "nota_interna" || i.kind === "status") continue;
    const cur = lastByTicket.get(i.ticketId);
    if (!cur || cur.createdAt < i.createdAt) lastByTicket.set(i.ticketId, i);
  }
  for (const t of tickets) {
    const last = lastByTicket.get(t.id);
    if (!last || last.authorId) continue; // última mensagem foi do atendente
    awaiting.push({ id: `chamado:${t.id}`, kind: "chamado", title: `${t.number} · ${t.subject}`, clientId: t.clientId, clientName: clientName(t.clientId), excerpt: last.body, channel: last.kind === "ligacao" ? "Ligação" : last.kind === "whatsapp" ? "WhatsApp" : "Mensagem", receivedAt: last.createdAt, receivedLabel: dateLabel(last.createdAt, today), href: `/suporte/chamados/${t.id}`, assigneeName: isTeam ? nameOf(t.assigneeId) : undefined });
  }
  awaiting.sort((a, b) => a.receivedAt.localeCompare(b.receivedAt));
  for (const a of awaiting) {
    if (a.kind === "chamado") {
      // O chamado já está nas prioridades (fonte de chamados): só marca que o cliente aguarda retorno.
      const existing = priorities.find((p) => p.id === a.id);
      if (existing) {
        existing.pending = true;
        existing.reason = `Cliente aguardando retorno ${ago(a.receivedAt, nowMs)} · ${existing.reason}`;
        existing.reasonTone = existing.reasonTone === "danger" ? "danger" : "warning";
      }
      continue;
    }
    const waitingHours = (nowMs - new Date(a.receivedAt).getTime()) / HOUR_MS;
    push({
      kind: "retorno",
      entityId: a.id,
      title: a.title,
      clientId: a.clientId,
      clientName: a.clientName,
      reason: `Aguardando seu retorno ${ago(a.receivedAt, nowMs)} · ${a.channel}`,
      reasonTone: waitingHours >= 4 ? "danger" : "warning",
      dueAt: a.receivedAt,
      dueLabel: a.receivedLabel,
      impactLabel: a.excerpt ? `“${a.excerpt.slice(0, 60)}${a.excerpt.length > 60 ? "…" : ""}”` : undefined,
      score: 20 + 20 * Math.min(waitingHours / 24, 1) + impactScore(clientMrr(a.clientId), maxMrr),
      href: a.href,
      canComplete: false,
      assigneeName: a.assigneeName,
      overdue: waitingHours >= 24,
    });
  }

  // Contratos pendentes no Financeiro (aguardando contrato, assinatura, pagamento ou com pendência).
  const contractItems: PendingContractItem[] = pendingContracts
    .map((c) => {
      const pendingSigners = c.signers?.filter((sg) => sg.status === "pendente").length ?? 0;
      const detail = c.status === "pendencia" ? c.pendingReason : c.status === "pago" ? "aguardando liberação" : c.status === "aguardando_assinatura" && pendingSigners ? `${pendingSigners} assinatura${pendingSigners === 1 ? "" : "s"} pendente${pendingSigners === 1 ? "" : "s"}` : undefined;
      return { id: c.id, number: c.number, clientId: c.clientId, clientName: clientName(c.clientId), status: c.status, statusLabel: CONTRACT_STATUS_LABELS[c.status], detail, monthlyTotal: c.monthlyTotal, sinceLabel: ago(c.updatedAt, nowMs), href: `/financeiro/contratos/${c.id}`, updatedAt: c.updatedAt };
    })
    .sort((a, b) => (a.status === "pendencia" ? -1 : b.status === "pendencia" ? 1 : a.updatedAt.localeCompare(b.updatedAt)))
    .map(({ updatedAt: _u, ...rest }) => {
      void _u;
      return rest;
    });
  for (const c of pendingContracts) {
    const idleDays = (nowMs - new Date(c.updatedAt).getTime()) / DAY_MS;
    const item = contractItems.find((x) => x.id === c.id)!;
    push({
      kind: "contrato",
      entityId: c.id,
      title: `Contrato ${c.number}`,
      clientId: c.clientId,
      clientName: clientName(c.clientId),
      reason: `${item.statusLabel}${item.detail ? ` · ${item.detail}` : ""} · parado ${ago(c.updatedAt, nowMs)}`,
      reasonTone: c.status === "pendencia" || idleDays >= 3 ? "danger" : "warning",
      dueAt: c.updatedAt,
      dueLabel: dateLabel(c.updatedAt, today),
      impactLabel: c.monthlyTotal > 0 ? `${formatCurrency(c.monthlyTotal)}/mês` : undefined,
      score: (c.status === "pendencia" ? 30 : 18) + 20 * Math.min(idleDays / 7, 1) + impactScore(c.monthlyTotal, Math.max(1, ...pendingContracts.map((x) => x.monthlyTotal))),
      href: item.href,
      canComplete: false,
      assigneeId: c.ownerId,
      assigneeName: isTeam ? nameOf(c.ownerId) : undefined,
      overdue: idleDays >= 3,
    });
  }

  // -------------------------------------------------------------------------
  // Financeiro do dia (D17): parametrizado pelo perfil. Cada item entra nas prioridades (com link real) e no
  // bloco "Financeiro do dia"; a contagem do card "Pendências" soma exatamente o que entrou.
  // -------------------------------------------------------------------------
  let finance: FinanceDigest | undefined;
  if (wantsBillings) {
    const dueSoonLimit = addDaysToKey(today, DUE_SOON_DAYS);
    const overdueBillings = openBillings.filter((b) => b.status === "vencida").sort((a, b) => a.dueDate.localeCompare(b.dueDate));
    const dueSoon = openBillings.filter((b) => b.status === "aberta" && dayKey(b.dueDate) >= today && dayKey(b.dueDate) <= dueSoonLimit).sort((a, b) => a.dueDate.localeCompare(b.dueDate));
    const maxBilling = Math.max(1, ...openBillings.map((b) => b.amount));
    const sections: FinanceSection[] = [];
    const sumOf = (items: { amount?: number }[]) => Math.round(items.reduce((s, i) => s + (i.amount ?? 0), 0) * 100) / 100;
    const addSection = (section: Omit<FinanceSection, "count" | "total" | "items">, all: FinanceItem[]) => {
      if (all.length === 0) return;
      sections.push({ ...section, items: all.slice(0, FINANCE_SECTION_LIMIT), count: all.length, total: sumOf(all) });
    };
    const pushFinance = (item: FinanceItem, score: number, overdue: boolean) => {
      push({
        kind: item.kind,
        entityId: item.id.slice(item.kind.length + 1),
        title: item.title,
        clientId: item.clientId,
        clientName: item.clientName,
        reason: item.detail ?? item.title,
        reasonTone: item.tone,
        dueAt: item.dueAt,
        dueLabel: item.dueLabel,
        impactLabel: item.amount !== undefined ? formatCurrency(item.amount) : undefined,
        score,
        href: item.href,
        canComplete: false,
        assigneeName: item.assigneeName,
        overdue,
        pending: true,
      });
    };
    const billingItem = (b: Billing, href: string, kind: "vencida" | "a_vencer"): FinanceItem => {
      const days = Math.max(0, Math.round((nowMs - new Date(b.dueDate).getTime()) / DAY_MS));
      return {
        id: `cobranca:${b.id}`,
        kind: "cobranca",
        title: `${clientName(b.clientId) ?? "Cliente"} · ${billingLabel(b)}`,
        detail: kind === "vencida" ? `Vencida há ${days} dia${days === 1 ? "" : "s"}` : `Vence ${dateLabel(b.dueDate, today).split(",")[0].toLowerCase()}`,
        amount: b.amount,
        dueAt: b.dueDate,
        dueLabel: dateLabel(b.dueDate, today),
        tone: kind === "vencida" ? "danger" : "warning",
        href,
        clientId: b.clientId,
        clientName: clientName(b.clientId),
      };
    };

    if (profile.finance) {
      const overdueItems = overdueBillings.map((b) => billingItem(b, `/financeiro/cobrancas?cliente=${b.clientId}&status=vencida`, "vencida"));
      overdueItems.forEach((item, i) => {
        const b = overdueBillings[i];
        const days = (nowMs - new Date(b.dueDate).getTime()) / DAY_MS;
        pushFinance(item, 30 + 20 * Math.min(days / 30, 1) + impactScore(b.amount, maxBilling), true);
      });
      addSection({ key: "cobrancas_vencidas", title: "Cobranças vencidas", description: "Inadimplência para cobrar", href: "/financeiro/cobrancas?status=vencida" }, overdueItems);

      const dueSoonItems = dueSoon.map((b) => billingItem(b, `/financeiro/cobrancas?cliente=${b.clientId}&status=aberta`, "a_vencer"));
      dueSoonItems.forEach((item, i) => pushFinance(item, 10 + urgencyScore(dueSoon[i].dueDate, nowMs) + impactScore(dueSoon[i].amount, maxBilling), false));
      addSection({ key: "vencimentos", title: `Vencem nos próximos ${DUE_SOON_DAYS} dias`, description: "Cobranças em aberto a acompanhar", href: "/financeiro/contas-a-receber" }, dueSoonItems);

      // Títulos: vencidos primeiro, depois a aprovar (previstos) e a pagar (aprovados/programados).
      const payableItems: FinanceItem[] = [];
      for (const p of [...payables].sort((a, b) => a.dueDate.localeCompare(b.dueDate))) {
        const overdue = dayKey(p.dueDate) < today;
        const action = p.status === "previsto" ? "A aprovar" : "A pagar";
        const item: FinanceItem = {
          id: `titulo:${p.id}`,
          kind: "titulo",
          title: `${p.code ?? p.id} · ${p.creditorName}`,
          detail: `${overdue ? "Vencido · " : ""}${action} (${PAYABLE_STATUS_LABELS[p.status]}) · ${p.description}`,
          amount: p.amount,
          dueAt: p.dueDate,
          dueLabel: dateLabel(p.dueDate, today),
          tone: overdue ? "danger" : p.status === "previsto" ? "info" : "warning",
          href: `/financeiro/contas-a-pagar?titulo=${p.id}`,
        };
        payableItems.push(item);
        pushFinance(item, (overdue ? 30 : p.status === "previsto" ? 15 : 20) + urgencyScore(p.dueDate, nowMs), overdue);
      }
      addSection({ key: "titulos", title: "Títulos a aprovar e a pagar", description: "Contas a pagar em aberto (comissões e lançamentos)", href: "/financeiro/contas-a-pagar" }, payableItems);

      const commissionItems: FinanceItem[] = eligibleCommissions
        .filter((c) => !c.payableId)
        .sort((a, b) => (a.eligibleAt ?? a.updatedAt).localeCompare(b.eligibleAt ?? b.updatedAt))
        .map((c) => ({
          id: `comissao:${c.id}`,
          kind: "comissao",
          title: `${c.code ?? c.id} · ${nameOf(c.userId) ?? "Vendedor"}`,
          detail: `Elegível sem título a pagar${c.productName ? ` · ${c.productName}` : ""}`,
          amount: c.amount,
          dueAt: c.eligibleAt,
          dueLabel: c.eligibleAt ? dateLabel(c.eligibleAt, today) : undefined,
          tone: "info",
          href: `/financeiro/comissoes?comissao=${c.id}`,
          clientId: c.clientId,
          clientName: clientName(c.clientId),
        }));
      commissionItems.forEach((item) => pushFinance(item, 12, false));
      addSection({ key: "comissoes", title: "Comissões elegíveis sem título", description: "Gerar o título em Contas a Pagar", href: "/financeiro/comissoes?status=liberada" }, commissionItems);

      finance = { profile: "financeiro", title: isTeam ? "Financeiro do dia (equipe)" : "Financeiro do dia", description: "Cobranças, títulos e comissões que dependem do Financeiro", href: "/financeiro", hrefLabel: "Financeiro", sections, count: sections.reduce((s, x) => s + x.count, 0) };
    } else if (profile.sales) {
      // Vendedor: cobrança vencida de cliente seu (conta ou contrato da própria venda), para acionar o cliente.
      const missingContracts = overdueBillings.map((b) => b.contractId).filter((id) => !contractById.has(id));
      for (const [id, c] of await getManyByIds<Contract>(COLLECTIONS.contracts, missingContracts)) contractById.set(id, c);
      const mine = overdueBillings.filter((b) => {
        const client = clientById.get(b.clientId);
        const contract = contractById.get(b.contractId);
        return ids.includes(client?.ownerSalesId ?? "") || ids.includes(contract ? (sellerOf(contract) ?? "") : "");
      });
      const items = mine.map((b) => {
        const item = billingItem(b, `/clientes/${b.clientId}?aba=financeiro`, "vencida");
        const sellerId = clientById.get(b.clientId)?.ownerSalesId ?? (contractById.get(b.contractId) ? sellerOf(contractById.get(b.contractId)!) : undefined);
        return { ...item, detail: `${item.detail} · acione o cliente`, assigneeName: isTeam ? nameOf(sellerId) : undefined };
      });
      items.forEach((item, i) => pushFinance(item, 25 + 15 * Math.min((nowMs - new Date(mine[i].dueDate).getTime()) / DAY_MS / 30, 1) + impactScore(mine[i].amount, maxBilling), true));
      addSection({ key: "cobrancas_vencidas", title: "Clientes seus com cobrança vencida", description: "Acione o cliente; a baixa é feita pelo Financeiro" }, items);
      if (sections.length > 0) finance = { profile: "vendas", title: isTeam ? "Cobranças vencidas das vendas da equipe" : "Cobranças vencidas dos seus clientes", description: "Para acionar junto ao cliente", href: "/financeiro/contas-a-receber", hrefLabel: "Contas a receber", sections, count: sections.reduce((s, x) => s + x.count, 0) };
    }
  }
  const financeCount = finance?.count ?? 0;

  priorities.sort((a, b) => b.score - a.score || (a.dueAt ?? "9").localeCompare(b.dueAt ?? "9"));
  // Horário à direita da lista: hora quando é hoje; senão o dia ("Ontem", "3 out").
  const shortWhen = (iso: string | undefined) => {
    if (!iso) return undefined;
    const label = dateLabel(iso, today);
    return dayKey(iso) === today ? timeLabel(iso) : label.split(",")[0];
  };
  const cappedPriorities = priorities.slice(0, 100).map((p) => ({ ...p, score: Math.round(p.score * 10) / 10, timeLabel: shortWhen(p.dueAt) }));

  // -------------------------------------------------------------------------
  // Indicadores do cabeçalho
  // -------------------------------------------------------------------------
  const tasksToday = openTasks.filter((t) => t.dueAt && dayKey(t.dueAt) === today).length;
  const overdueTasks = openTasks.filter((t) => t.dueAt && dayKey(t.dueAt) < today).length;
  const followupsOverdue = openLeads.filter((l) => l.nextActionAt && l.nextActionAt < nowIso).length + openOpps.filter((o) => o.nextActionAt && o.nextActionAt < nowIso).length;
  // Meta: atingimento médio das metas pessoais do mês (ou das metas visíveis, sem metas pessoais).
  const personalGoals = goals.filter((g) => g.scopeLabel !== "Empresa" && g.attainment !== null);
  const goalBase = (personalGoals.length ? personalGoals : goals).filter((g) => g.attainment !== null);
  const goalAttainment = goalBase.length ? goalBase.reduce((sum, g) => sum + Math.min(g.attainment as number, 1.5), 0) / goalBase.length : null;
  const stats: MeuDiaStats = {
    tasksInProgress: openTasks.length,
    pendingOnYou: openSteps.filter((st) => st.status !== "aguardando_cliente").length + awaiting.length + pendingContracts.length + financeCount,
    goalAttainment: goalAttainment === null ? null : Number(goalAttainment.toFixed(3)),
    tasksToday,
    overdueTasks,
    followupsOverdue,
    slaAtRisk: riskSlas.length,
    clientsAttention: attentionClients.length,
    unreadNotifications: unread.length,
  };
  const summaryParts = [plural(tasksToday, "tarefa hoje", "tarefas hoje"), plural(overdueTasks, "atrasada", "atrasadas"), plural(riskSlas.length, "SLA em risco", "SLAs em risco")];
  if (followupsOverdue > 0) summaryParts.push(plural(followupsOverdue, "follow-up vencido", "follow-ups vencidos"));

  // -------------------------------------------------------------------------
  // Agenda de hoje: tarefas com início/prazo hoje, visitas e treinamentos de hoje.
  // -------------------------------------------------------------------------
  const agenda: AgendaItem[] = [];
  for (const t of tasks) {
    if (t.status === "cancelada") continue;
    const at = t.startAt && dayKey(t.startAt) === today ? t.startAt : t.dueAt && dayKey(t.dueAt) === today ? t.dueAt : undefined;
    if (!at) continue;
    agenda.push({ id: `tarefa:${t.id}`, kind: "tarefa", at, timeLabel: timeLabel(at), title: t.title, clientId: t.clientId, clientName: t.clientName ?? clientName(t.clientId), href: `/tarefas?tarefa=${t.id}`, done: t.status === "concluida", assigneeName: isTeam ? (t.assigneeName ?? nameOf(t.assigneeId)) : undefined });
  }
  for (const v of visits) {
    if (v.status === "cancelada" || v.status === "remarcada" || dayKey(v.scheduledAt) !== today) continue;
    agenda.push({ id: `visita:${v.id}`, kind: "visita", at: v.scheduledAt, timeLabel: timeLabel(v.scheduledAt), title: `${v.kind === "tecnica" ? "Visita técnica" : "Visita"} · ${v.objective}`, clientId: v.clientId, clientName: clientName(v.clientId), href: `/vendas/visitas?visita=${v.id}`, done: v.status === "realizada", assigneeName: isTeam ? nameOf(v.sellerId) : undefined });
  }
  for (const tr of trainings) {
    if (tr.status === "cancelado" || dayKey(tr.scheduledAt) !== today) continue;
    agenda.push({ id: `treinamento:${tr.id}`, kind: "treinamento", at: tr.scheduledAt, timeLabel: timeLabel(tr.scheduledAt), title: `Treinamento · ${tr.subject}`, clientId: tr.clientId, clientName: clientName(tr.clientId), href: tr.projectId ? `/implantacao/${tr.projectId}?aba=treinamentos` : "/implantacao/treinamentos", done: tr.status === "realizado", assigneeName: isTeam ? nameOf(tr.instructorId) : undefined });
  }
  // Checkpoints de CS do dia (próxima interação da carteira e checkpoints dos planos de sucesso).
  for (const c of csClients) {
    if (!c.nextInteractionAt || dayKey(c.nextInteractionAt) !== today) continue;
    agenda.push({ id: `checkpoint:${c.id}`, kind: "checkpoint", at: c.nextInteractionAt, timeLabel: timeLabel(c.nextInteractionAt), title: `Checkpoint · ${c.tradeName}`, clientId: c.id, clientName: c.tradeName, href: `/clientes/${c.id}?aba=cs`, done: false, assigneeName: isTeam ? nameOf(c.ownerCsId) : undefined });
  }
  for (const sp of successPlans) {
    if (sp.status !== "ativo" || !sp.checkpointAt || dayKey(sp.checkpointAt) !== today) continue;
    agenda.push({ id: `plano:${sp.id}`, kind: "checkpoint", at: sp.checkpointAt, timeLabel: timeLabel(sp.checkpointAt), title: `Checkpoint do plano · ${sp.objective}`, clientId: sp.clientId, clientName: clientName(sp.clientId), href: `/clientes/${sp.clientId}?aba=cs`, done: false, assigneeName: isTeam ? nameOf(sp.ownerId) : undefined });
  }
  agenda.sort((a, b) => a.at.localeCompare(b.at));
  // Próximas visitas (comerciais e técnicas) dos próximos 7 dias, depois de hoje.
  const visitHorizon = addDaysToKey(today, 7);
  const upcomingVisits: AgendaItem[] = visits
    .filter((v) => v.status === "agendada" && dayKey(v.scheduledAt) > today && dayKey(v.scheduledAt) <= visitHorizon)
    .sort((a, b) => a.scheduledAt.localeCompare(b.scheduledAt))
    .slice(0, 6)
    .map((v) => ({
      id: `visita:${v.id}`,
      kind: "visita",
      at: v.scheduledAt,
      timeLabel: dateLabel(v.scheduledAt, today),
      title: `${v.kind === "tecnica" ? "Visita técnica" : "Visita"} · ${v.objective}`,
      clientId: v.clientId,
      clientName: clientName(v.clientId),
      href: `/vendas/visitas?visita=${v.id}`,
      done: false,
      assigneeName: isTeam ? nameOf(v.sellerId) : undefined,
    }));

  // -------------------------------------------------------------------------
  // Follow-ups dos próximos 3 dias (inclui vencidos, marcados).
  // -------------------------------------------------------------------------
  const horizon = new Date(nowMs + 3 * DAY_MS).toISOString();
  const followups: FollowupItem[] = [];
  for (const l of openLeads) {
    if (!l.nextActionAt || l.nextActionAt > horizon) continue;
    followups.push({ id: `lead:${l.id}`, kind: "lead", title: `${l.name}${l.company ? ` · ${l.company}` : ""}`, clientId: l.clientId, clientName: l.company ?? clientName(l.clientId), nextAction: l.nextAction, nextActionAt: l.nextActionAt, nextActionLabel: dateLabel(l.nextActionAt, today), overdue: l.nextActionAt < nowIso, href: `/marketing/leads?lead=${l.id}`, valueLabel: `Lead ${l.temperature}`, assigneeName: isTeam ? nameOf(l.ownerId) : undefined });
  }
  for (const o of openOpps) {
    if (!o.nextActionAt || o.nextActionAt > horizon) continue;
    followups.push({ id: `oportunidade:${o.id}`, kind: "oportunidade", title: o.title, clientId: o.clientId, clientName: clientName(o.clientId), nextAction: o.nextAction, nextActionAt: o.nextActionAt, nextActionLabel: dateLabel(o.nextActionAt, today), overdue: o.nextActionAt < nowIso, href: `/vendas?oportunidade=${o.id}`, valueLabel: o.monthlyTotal > 0 ? `${formatCurrency(o.monthlyTotal)}/mês` : undefined, assigneeName: isTeam ? nameOf(o.ownerId) : undefined });
  }
  followups.sort((a, b) => a.nextActionAt.localeCompare(b.nextActionAt));

  // -------------------------------------------------------------------------
  // Minhas etapas de workflow (todas as abertas, SLA primeiro).
  // -------------------------------------------------------------------------
  const SLA_ORDER: Record<string, number> = { violado: 0, em_risco: 1, em_atencao: 2, dentro_do_prazo: 3, pausado: 4, concluido: 5 };
  const stepItems: StepItem[] = openSteps
    .map((s) => {
      const sla = slaViewOf(s.slaInstanceId);
      const checklist = s.checklist ?? [];
      return { id: s.id, stageName: s.stageName, status: s.status, clientId: s.clientId, clientName: s.clientName, sla, dueAt: s.dueAt, dueLabel: s.dueAt ? dateLabel(s.dueAt, today) : undefined, checklistDone: checklist.filter((c) => c.done).length, checklistTotal: checklist.length, href: `/workflow?etapa=${s.id}`, assigneeName: isTeam ? (s.assigneeName ?? nameOf(s.assigneeId)) : undefined };
    })
    .sort((a, b) => (SLA_ORDER[a.sla?.state ?? "concluido"] ?? 9) - (SLA_ORDER[b.sla?.state ?? "concluido"] ?? 9) || (a.dueAt ?? "9").localeCompare(b.dueAt ?? "9"));

  // -------------------------------------------------------------------------
  // Notificações recentes (5 não lidas do próprio usuário).
  // -------------------------------------------------------------------------
  const notifications: NotificationItem[] = unread.slice(0, 5).map((n) => toNotificationItem(n, now));

  // -------------------------------------------------------------------------
  // Minha equipe (modo gestor): uma linha por colaborador.
  // -------------------------------------------------------------------------
  let team: TeamMember[] = [];
  if (isTeam) {
    const rows = members.map((u) => {
      const mine = openTasks.filter((t) => t.assigneeId === u.id);
      const overdue = mine.filter((t) => t.dueAt && dayKey(t.dueAt) < today).length;
      const slaRisk = riskSlas.filter((x) => x.sla.ownerId === u.id).length;
      return { id: u.id, name: u.name, avatarUrl: u.avatarUrl, jobTitle: u.jobTitle, openTasks: mine.length, overdueTasks: overdue, slaRisk, load: 0, href: `/tarefas?view=equipe&resp=${u.id}` };
    });
    const avg = rows.length ? rows.reduce((s, r) => s + r.openTasks, 0) / rows.length : 0;
    team = rows.map((r) => ({ ...r, load: avg > 0 ? Number((r.openTasks / avg).toFixed(2)) : 0 })).sort((a, b) => b.overdueTasks - a.overdueTasks || b.slaRisk - a.slaRisk || b.openTasks - a.openTasks || a.name.localeCompare(b.name, "pt-BR"));
  }

  // Seção negada: nada dela sai do servidor (o bloco também não aparece na página).
  return {
    user: { id: user.id, name: user.name, firstName: user.name.split(" ")[0] },
    sections,
    scope,
    canToggleScope: scopeInfo.canToggle,
    teamSize: members.length,
    greeting: greetingFor(now),
    todayLabel: longDateFormat.format(now),
    summaryLine: summaryParts.join(" · "),
    stats,
    priorities: sections.prioridades ? cappedPriorities : [],
    agenda: sections.agenda ? agenda : [],
    upcomingVisits: sections.agenda ? upcomingVisits : [],
    followups: sections.followups ? followups : [],
    steps: sections.etapas ? stepItems : [],
    attentionClients: sections.clientesAtencao ? attentionClients.slice(0, 8) : [],
    goals,
    notifications,
    team: sections.equipe ? team : [],
    awaiting,
    contracts: sections.contratos ? contractItems : [],
    finance: profile.finance || profile.sales ? finance : undefined,
  };
}
