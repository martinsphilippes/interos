import "server-only";
/**
 * Leituras do módulo de Implantação. Filtros de igualdade via list() e agregação em memória.
 * Reutilizáveis: listProjects, getProject, getImplementationOverview, listTemplates,
 * getClientImplementation (ficha 360) e getPostGoLiveTickets (qualidade da implantação).
 *
 * Visibilidade (A7/A23): o LIMITE é o escopo efetivo da tela (resolveDataScope, catálogo
 * src/domain/permissions/implantacao.ts; dono = responsável ou equipe do projeto); a VISÃO da URL (?escopo=
 * todos/equipe/meus) só estreita dentro dele. Padrão = comportamento anterior: limite "empresa" para todos.
 */
import { getById, getManyByIds, list } from "@/server/db";
import { computeDataScope, filterByScope, resolveDataScope, type DataScope } from "@/server/auth/scope";
import { can } from "@/server/auth/permissions";
import { computeSlaState } from "@/server/sla";
import { dateKey } from "@/lib/format";
import {
  COLLECTIONS,
  IMPLEMENTATION_PHASES,
  type Billing,
  type Client,
  type Contact,
  type Contract,
  type CurrentUser,
  type Department,
  type Document,
  type ImplementationPhase,
  type ImplementationStatus,
  type ImplementationTask,
  type ImplementationTemplate,
  type Product,
  type SaleSnapshot,
  type SlaInstance,
  type SlaView,
  type SupportTicket,
  type TimelineEvent,
  type Training,
  type User,
  type WorkflowInstance,
  type WorkflowStep,
} from "@/domain/types";
import type { RoleKey } from "@/domain/constants";
import { buildSaleSnapshot, canApproveGoLive, getGoLiveSettings } from "./service";
import { buildContractSummary, redactContractSummary, type ContractSummaryData } from "@/components/finance/contract-summary";
import { projectOwners, trainingOwners, type ImplementationScreen } from "./access";
import {
  ACTIVE_PROJECT_STATUSES,
  evaluateGoLiveGate,
  isActiveProject,
  pendingRequired,
  type GoLiveGate,
  type GoLiveSettings,
  type ProjectFilters,
  type ProjectRecord,
  type ProjectScope,
} from "./schemas";

const DAY_MS = 86_400_000;

export interface UserLite {
  id: string;
  name: string;
  avatarUrl?: string;
  role: RoleKey;
  departmentId: string;
  jobTitle?: string;
}

export interface ProductLite {
  id: string;
  name: string;
}

export interface ProjectRow {
  id: string;
  name: string;
  clientId: string;
  clientName: string;
  products: ProductLite[];
  ownerId: string;
  ownerName: string;
  ownerAvatarUrl?: string;
  teamIds: string[];
  status: ImplementationStatus;
  currentPhase: ImplementationPhase;
  progress: number;
  startDate?: string;
  dueDate: string;
  goLiveAt?: string;
  overdue: boolean;
  /** Dias de atraso em relação ao prazo (projetos abertos vencidos ou concluídos depois do prazo). */
  daysLate: number;
  sla: SlaView | null;
  externalDelayDays: number;
  internalDelayDays: number;
  waitingReason?: string;
  blockedReason?: string;
  /** Concluído com goLiveAt <= dueDate. */
  onTime?: boolean;
  /** Dias entre a liberação financeira e o go-live. */
  activationDays?: number;
  /** Tarefas obrigatórias abertas da fase atual (o que falta para avançar). */
  pendingInPhase: string[];
  /** false quando a venda não contratou implantação (D9): indicador leve na lista e no kanban. */
  implementationRequired?: boolean;
}

export interface ScopeInfo {
  kind: ProjectScope;
  label: string;
  /** null = sem restrição. */
  userIds: string[] | null;
  canTeam: boolean;
}

export function toUserLite(u: User): UserLite {
  return { id: u.id, name: u.name, avatarUrl: u.avatarUrl, role: u.role, departmentId: u.departmentId, jobTitle: u.jobTitle };
}

/** Usuários ativos, com a equipe de implantação primeiro (seletores de responsável, instrutor, equipe). */
export async function listAssignableUsers(): Promise<UserLite[]> {
  const users = (await list<User>(COLLECTIONS.users)).filter((u) => u.active !== false);
  const rank = (u: User) => (u.departmentId === "implantacao" ? 0 : u.departmentId === "suporte" || u.departmentId === "cs" ? 1 : 2);
  return users.sort((a, b) => rank(a) - rank(b) || a.name.localeCompare(b.name, "pt-BR")).map(toUserLite);
}

interface ResolvedScope {
  info: ScopeInfo;
  /** Limite efetivo da tela (nunca ampliado pela visão da URL). */
  limit: DataScope;
}

const isUnrestricted = (scope: Pick<DataScope, "userIds" | "departmentKeys">) => !scope.userIds && !scope.departmentKeys;

/**
 * Visão da lista dentro do limite da tela: "meus" (responsável ou equipe do projeto), "equipe" (gestor: ele +
 * liderados diretos; diretoria/admin: departamento de implantação — scope.variants do catálogo) ou "todos" (= o
 * limite). Visão inicial: equipe para gestores de implantação (initialView do catálogo).
 */
async function resolveScopeWithLimit(user: CurrentUser, requested: ProjectScope | undefined, screen: ImplementationScreen): Promise<ResolvedScope> {
  const limit = await resolveDataScope(user, screen);
  const canTeam = user.isManager && limit.kind !== "meus";
  const initial: ProjectScope = limit.initialKind === "meus" ? "meus" : limit.initialKind === "equipe" && canTeam ? "equipe" : "todos";
  const kind: ProjectScope = requested ?? initial;
  const within = (ids: Iterable<string>) => Array.from(new Set(ids)).filter((id) => !limit.userIds || limit.userIds.has(id));
  if (kind === "meus") return { info: { kind, label: "Meus projetos", userIds: [user.id], canTeam }, limit };
  if (kind === "equipe" && canTeam) {
    const [users, departments] = await Promise.all([list<User>(COLLECTIONS.users), list<Department>(COLLECTIONS.departments)]);
    const team = computeDataScope(user, screen, user.isDirector ? "departamento" : "equipe", { users, departments });
    return { info: { kind: "equipe", label: user.isDirector ? "Equipe de implantação" : "Minha equipe", userIds: within(team.userIds ?? []), canTeam }, limit };
  }
  return { info: { kind: "todos", label: isUnrestricted(limit) ? "Todos os projetos" : "Todos do seu acesso", userIds: null, canTeam }, limit };
}

/** Escopo da visão (ver resolveScopeWithLimit). O limite da tela é aplicado à parte, por filterByScope. */
export async function resolveScope(user: CurrentUser, requested: ProjectScope | undefined, screen: ImplementationScreen = "implantacao.projetos"): Promise<ScopeInfo> {
  return (await resolveScopeWithLimit(user, requested, screen)).info;
}

function inScope(p: Pick<ProjectRecord, "ownerId" | "teamIds">, scope: ScopeInfo): boolean {
  if (!scope.userIds) return true;
  const ids = new Set(scope.userIds);
  return ids.has(p.ownerId) || (p.teamIds ?? []).some((id) => ids.has(id));
}

/** Projetos dentro do limite da tela (escopo efetivo) e da visão escolhida. */
function visibleProjects<T extends Pick<ProjectRecord, "ownerId" | "teamIds">>(projects: readonly T[], { info, limit }: ResolvedScope): T[] {
  return filterByScope(projects, (p) => ({ owners: projectOwners(p) }), limit).filter((p) => inScope(p, info));
}

function daysBetween(from: string, to: string): number {
  return (new Date(to).getTime() - new Date(from).getTime()) / DAY_MS;
}

async function buildRows(projects: ProjectRecord[]): Promise<ProjectRow[]> {
  if (projects.length === 0) return [];
  const now = new Date();
  const nowIso = now.toISOString();
  const activeIds = projects.filter((p) => isActiveProject(p.status)).map((p) => p.id);
  const [clients, owners, slas, contracts, products, tasks] = await Promise.all([
    getManyByIds<Client>(COLLECTIONS.clients, projects.map((p) => p.clientId)),
    getManyByIds<User>(COLLECTIONS.users, projects.map((p) => p.ownerId)),
    getManyByIds<SlaInstance>(COLLECTIONS.slaInstances, projects.map((p) => p.slaInstanceId ?? "")),
    getManyByIds<Contract>(COLLECTIONS.contracts, projects.map((p) => p.contractId ?? "")),
    list<Product>(COLLECTIONS.products),
    list<ImplementationTask>(COLLECTIONS.implementationTasks, { where: [["projectId", "in", activeIds]] }),
  ]);
  const productNames = new Map(products.map((p) => [p.id, p.name]));
  const tasksByProject = new Map<string, ImplementationTask[]>();
  for (const t of tasks) tasksByProject.set(t.projectId, [...(tasksByProject.get(t.projectId) ?? []), t]);

  return projects.map((p) => {
    const client = clients.get(p.clientId);
    const owner = owners.get(p.ownerId);
    const sla = p.slaInstanceId ? slas.get(p.slaInstanceId) : undefined;
    const contract = p.contractId ? contracts.get(p.contractId) : undefined;
    const active = isActiveProject(p.status);
    const overdue = active && p.dueDate < nowIso;
    const reference = p.goLiveAt ?? (active ? nowIso : undefined);
    const daysLate = reference && reference > p.dueDate ? Math.ceil(daysBetween(p.dueDate, reference)) : 0;
    return {
      id: p.id,
      name: p.name,
      clientId: p.clientId,
      clientName: client?.tradeName ?? "Cliente removido",
      products: p.productIds.map((id) => ({ id, name: productNames.get(id) ?? id })),
      ownerId: p.ownerId,
      ownerName: owner?.name ?? "—",
      ownerAvatarUrl: owner?.avatarUrl,
      teamIds: p.teamIds ?? [],
      status: p.status,
      currentPhase: p.currentPhase,
      progress: p.progress ?? 0,
      startDate: p.startDate,
      dueDate: p.dueDate,
      goLiveAt: p.goLiveAt,
      overdue,
      daysLate,
      sla: sla ? computeSlaState(sla, now) : null,
      externalDelayDays: p.externalDelayDays ?? 0,
      internalDelayDays: p.internalDelayDays ?? 0,
      waitingReason: p.waitingClient?.reason,
      blockedReason: p.blocked?.reason,
      onTime: p.status === "concluida" && p.goLiveAt ? p.goLiveAt <= p.dueDate : undefined,
      activationDays: p.goLiveAt && contract?.releasedAt ? Math.round(daysBetween(contract.releasedAt, p.goLiveAt) * 10) / 10 : undefined,
      pendingInPhase: active ? pendingRequired(tasksByProject.get(p.id) ?? [], [p.currentPhase]).map((t) => t.title) : [],
      implementationRequired: p.saleSnapshot?.implementationRequired ?? contract?.implementationRequired,
    };
  });
}

const STATUS_ORDER: Record<ImplementationStatus, number> = { bloqueada: 0, aguardando_cliente: 1, pronta_para_go_live: 2, em_implantacao: 3, aguardando_inicio: 4, concluida: 5, cancelada: 6 };

function monthKey(iso: string | undefined): string {
  return dateKey(iso).slice(0, 7);
}

/** Lista de projetos com filtros da URL e escopo. Abertos primeiro (bloqueados/aguardando no topo), depois por prazo. */
export async function listProjects(user: CurrentUser, filters: ProjectFilters = {}): Promise<{ rows: ProjectRow[]; scope: ScopeInfo; total: number }> {
  const [all, resolved] = await Promise.all([list<ProjectRecord>(COLLECTIONS.implementationProjects), resolveScopeWithLimit(user, filters.scope, "implantacao.projetos")]);
  const scope = resolved.info;
  const scoped = visibleProjects(all, resolved);
  const rows = await buildRows(scoped);
  const thisMonth = monthKey(new Date().toISOString());
  const filtered = rows.filter((r) => {
    if (filters.status === "ativos" && !ACTIVE_PROJECT_STATUSES.includes(r.status)) return false;
    if (filters.status && filters.status !== "ativos" && r.status !== filters.status) return false;
    if (filters.ownerId && r.ownerId !== filters.ownerId) return false;
    if (filters.productId && !r.products.some((p) => p.id === filters.productId)) return false;
    if (filters.overdue && !r.overdue) return false;
    if (filters.kpi === "concluidas_mes" && !(r.status === "concluida" && monthKey(r.goLiveAt) === thisMonth)) return false;
    if (filters.kpi === "no_prazo" && r.status !== "concluida") return false;
    if (filters.kpi === "ativacao_7d" && (r.status !== "concluida" || r.activationDays === undefined)) return false;
    return true;
  });
  filtered.sort((a, b) => STATUS_ORDER[a.status] - STATUS_ORDER[b.status] || (a.status === "concluida" ? (b.goLiveAt ?? "").localeCompare(a.goLiveAt ?? "") : a.dueDate.localeCompare(b.dueDate)));
  return { rows: filtered, scope, total: scoped.length };
}

// ---------------------------------------------------------------------------
// Dashboard
// ---------------------------------------------------------------------------

export interface ImplementationOverview {
  scope: ScopeInfo;
  counts: {
    aguardandoInicio: number;
    emImplantacao: number;
    atrasadas: number;
    bloqueadas: number;
    aguardandoCliente: number;
    prontas: number;
    concluidasMes: number;
  };
  /** Dias corridos médios entre início e go-live (concluídas nos últimos 90 dias); null sem base. */
  avgDays: number | null;
  avgDaysBase: number;
  /** Fração 0–1 das concluídas com go-live dentro do prazo; null sem base. */
  onTimePct: number | null;
  onTimeBase: number;
  /** Fração 0–1 das concluídas ativadas em até 7 dias após a liberação financeira; null sem base. */
  activation7Pct: number | null;
  activationBase: number;
  byStatus: { status: ImplementationStatus; count: number }[];
  goLivesByMonth: { month: string; total: number; onTime: number }[];
}

export async function getImplementationOverview(user: CurrentUser, requestedScope?: ProjectScope): Promise<ImplementationOverview> {
  const [all, resolved] = await Promise.all([list<ProjectRecord>(COLLECTIONS.implementationProjects), resolveScopeWithLimit(user, requestedScope, "implantacao.projetos")]);
  const scope = resolved.info;
  const projects = visibleProjects(all, resolved);
  const now = new Date();
  const nowIso = now.toISOString();
  const thisMonth = monthKey(nowIso);
  const since90 = new Date(now.getTime() - 90 * DAY_MS).toISOString();
  const concluded = projects.filter((p) => p.status === "concluida" && p.goLiveAt);
  const contracts = await getManyByIds<Contract>(COLLECTIONS.contracts, concluded.map((p) => p.contractId ?? ""));

  const recent = concluded.filter((p) => p.goLiveAt! >= since90 && p.startDate);
  const avgDays = recent.length ? Math.round((recent.reduce((s, p) => s + daysBetween(p.startDate!, p.goLiveAt!), 0) / recent.length) * 10) / 10 : null;
  const onTime = concluded.filter((p) => p.goLiveAt! <= p.dueDate).length;
  const withRelease = concluded.filter((p) => p.contractId && contracts.get(p.contractId)?.releasedAt);
  const activated7 = withRelease.filter((p) => daysBetween(contracts.get(p.contractId!)!.releasedAt!, p.goLiveAt!) <= 7).length;

  const byStatus = (["aguardando_inicio", "em_implantacao", "aguardando_cliente", "bloqueada", "pronta_para_go_live", "concluida"] as ImplementationStatus[]).map((status) => ({ status, count: projects.filter((p) => p.status === status).length }));

  // Últimos 6 meses (inclui o atual).
  const months: string[] = [];
  const cursor = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 15));
  for (let i = 5; i >= 0; i--) months.push(new Date(Date.UTC(cursor.getUTCFullYear(), cursor.getUTCMonth() - i, 15)).toISOString().slice(0, 7));
  const goLivesByMonth = months.map((month) => {
    const inMonth = concluded.filter((p) => monthKey(p.goLiveAt) === month);
    return { month, total: inMonth.length, onTime: inMonth.filter((p) => p.goLiveAt! <= p.dueDate).length };
  });

  return {
    scope,
    counts: {
      aguardandoInicio: projects.filter((p) => p.status === "aguardando_inicio").length,
      emImplantacao: projects.filter((p) => p.status === "em_implantacao").length,
      atrasadas: projects.filter((p) => isActiveProject(p.status) && p.dueDate < nowIso).length,
      bloqueadas: projects.filter((p) => p.status === "bloqueada").length,
      aguardandoCliente: projects.filter((p) => p.status === "aguardando_cliente").length,
      prontas: projects.filter((p) => p.status === "pronta_para_go_live").length,
      concluidasMes: concluded.filter((p) => monthKey(p.goLiveAt) === thisMonth).length,
    },
    avgDays,
    avgDaysBase: recent.length,
    onTimePct: concluded.length ? onTime / concluded.length : null,
    onTimeBase: concluded.length,
    activation7Pct: withRelease.length ? activated7 / withRelease.length : null,
    activationBase: withRelease.length,
    byStatus,
    goLivesByMonth,
  };
}

/** Kanban: projetos ativos do escopo. */
export async function listKanbanProjects(user: CurrentUser, requestedScope?: ProjectScope): Promise<{ rows: ProjectRow[]; scope: ScopeInfo }> {
  const [all, resolved] = await Promise.all([list<ProjectRecord>(COLLECTIONS.implementationProjects), resolveScopeWithLimit(user, requestedScope, "implantacao.kanban")]);
  const rows = await buildRows(visibleProjects(all.filter((p) => isActiveProject(p.status)), resolved));
  rows.sort((a, b) => a.dueDate.localeCompare(b.dueDate));
  return { rows, scope: resolved.info };
}

// ---------------------------------------------------------------------------
// Projeto
// ---------------------------------------------------------------------------

export interface ProjectDetail {
  project: ProjectRecord;
  row: ProjectRow;
  client: Pick<Client, "id" | "tradeName" | "legalName" | "status">;
  contract: Pick<Contract, "id" | "number" | "releasedAt" | "endDate"> | null;
  tasks: ImplementationTask[];
  trainings: Training[];
  documents: Document[];
  events: TimelineEvent[];
  users: UserLite[];
  sla: (SlaView & { startedAt: string; status: SlaInstance["status"] }) | null;
  gate: GoLiveGate;
  settings: GoLiveSettings;
  postGoLiveTickets: SupportTicket[];
  workflowStep: Pick<WorkflowStep, "id" | "status" | "stageName"> | null;
  /** Contato principal do cliente (sugestão para "quem aceitou"). */
  primaryContactName?: string;
  /** Dados da venda (D9): fotografia gravada na criação do projeto; projetos antigos montam na leitura. */
  sale: { snapshot: SaleSnapshot; summary: ContractSummaryData; sellerName?: string } | null;
}

/** Documento do projeto (para checar tela e escopo antes de montar o detalhe). */
export async function getProjectRecord(id: string): Promise<ProjectRecord | null> {
  return getById<ProjectRecord>(COLLECTIONS.implementationProjects, id);
}

export interface ProjectDetailOptions {
  /** Documento já lido (evita a segunda leitura depois da checagem de escopo). */
  project?: ProjectRecord;
  /**
   * Seções negadas NÃO são lidas (nem enviadas ao navegador): `sale` (dados da venda), `documents` (aba Documentos)
   * e `history` (aba Histórico: timeline e chamados pós-go-live). Ausente = todas.
   */
  include?: { sale?: boolean; documents?: boolean; history?: boolean };
  /** Sem "Visualizar valores" (financeiro.valores.ver, A13): os valores da venda saem zerados e marcados "Restrito". */
  hideValues?: boolean;
}

/** Fotografia da venda sem valores (A13). */
function redactSaleSnapshot(snapshot: SaleSnapshot): SaleSnapshot {
  return { ...snapshot, items: snapshot.items.map((i) => ({ ...i, setupValue: 0, monthlyValue: 0, hardwareValue: 0 })), monthlyTotal: 0, setupTotal: 0, hardwareTotal: 0 };
}

export async function getProject(id: string, options: ProjectDetailOptions = {}): Promise<ProjectDetail | null> {
  const project = options.project ?? (await getById<ProjectRecord>(COLLECTIONS.implementationProjects, id));
  if (!project) return null;
  const include = { sale: options.include?.sale ?? true, documents: options.include?.documents ?? true, history: options.include?.history ?? true };
  const none = <T,>(): Promise<T[]> => Promise.resolve([]);
  const [rows, client, contract, tasks, trainings, projectDocs, timeline, users, sla, settings, postGoLiveTickets, contacts] = await Promise.all([
    buildRows([project]),
    getById<Client>(COLLECTIONS.clients, project.clientId),
    project.contractId ? getById<Contract>(COLLECTIONS.contracts, project.contractId) : Promise.resolve(null),
    list<ImplementationTask>(COLLECTIONS.implementationTasks, { where: [["projectId", "==", id]] }),
    list<Training>(COLLECTIONS.trainings, { where: [["projectId", "==", id]] }),
    include.documents ? list<Document>(COLLECTIONS.documents, { where: [["entityId", "==", id]] }) : none<Document>(),
    include.history ? list<TimelineEvent>(COLLECTIONS.timelineEvents, { where: [["clientId", "==", project.clientId]] }) : none<TimelineEvent>(),
    listAssignableUsers(),
    project.slaInstanceId ? getById<SlaInstance>(COLLECTIONS.slaInstances, project.slaInstanceId) : Promise.resolve(null),
    getGoLiveSettings(),
    include.history ? getPostGoLiveTickets(project) : none<SupportTicket>(),
    list<Contact>(COLLECTIONS.contacts, { where: [["clientId", "==", project.clientId]] }),
  ]);
  const instance = client?.workflowInstanceId ? await getById<WorkflowInstance>(COLLECTIONS.workflowInstances, client.workflowInstanceId) : null;
  const step = instance?.currentStageKey === "implantacao" && instance.currentStepId ? await getById<WorkflowStep>(COLLECTIONS.workflowSteps, instance.currentStepId) : null;

  tasks.sort((a, b) => IMPLEMENTATION_PHASES.indexOf(a.phase) - IMPLEMENTATION_PHASES.indexOf(b.phase) || (a.dueAt ?? "").localeCompare(b.dueAt ?? "") || a.title.localeCompare(b.title, "pt-BR"));
  trainings.sort((a, b) => b.scheduledAt.localeCompare(a.scheduledAt));
  // Dados da venda: fotografia do projeto (ou montada do contrato para projetos anteriores ao handoff).
  let sale: ProjectDetail["sale"] = null;
  if (contract && include.sale) {
    const original = project.saleSnapshot ?? (await buildSaleSnapshot(contract));
    const snapshot = options.hideValues ? redactSaleSnapshot(original) : original;
    const [billings, seller] = await Promise.all([
      list<Billing>(COLLECTIONS.billing, { where: [["contractId", "==", contract.id]] }),
      snapshot.sellerId ? getById<User>(COLLECTIONS.users, snapshot.sellerId) : Promise.resolve(null),
    ]);
    const summary = buildContractSummary(
      { ...contract, implementationRequired: contract.implementationRequired ?? snapshot.implementationRequired, implementationNotes: contract.implementationNotes ?? snapshot.implementationNotes, commercialNotes: contract.commercialNotes ?? snapshot.commercialNotes, paymentMethod: contract.paymentMethod ?? snapshot.paymentMethod, saleNumber: contract.saleNumber ?? snapshot.saleNumber },
      { billings, sellerName: seller?.name, contact: snapshot.contactName ? { name: snapshot.contactName, phone: snapshot.contactPhone, email: snapshot.contactEmail } : null },
    );
    sale = { snapshot, summary: options.hideValues ? redactContractSummary(summary) : summary, sellerName: seller?.name };
  }

  // Histórico: eventos do cliente desde a criação do projeto (inclui workflow, financeiro e suporte do período).
  const since = project.createdAt < (project.startDate ?? project.createdAt) ? project.createdAt : (project.startDate ?? project.createdAt);
  const events = timeline.filter((e) => e.occurredAt >= since || e.entityId === project.id).sort((a, b) => b.occurredAt.localeCompare(a.occurredAt));

  return {
    project,
    row: rows[0],
    client: client ? { id: client.id, tradeName: client.tradeName, legalName: client.legalName, status: client.status } : { id: project.clientId, tradeName: "Cliente removido", legalName: "", status: "inativo" },
    contract: contract ? { id: contract.id, number: contract.number, releasedAt: contract.releasedAt, endDate: contract.endDate } : null,
    tasks,
    trainings,
    documents: projectDocs.filter((d) => d.entityType === "project").sort((a, b) => b.createdAt.localeCompare(a.createdAt)),
    events,
    users,
    sla: sla ? { ...computeSlaState(sla), startedAt: sla.startedAt, status: sla.status } : null,
    gate: evaluateGoLiveGate(project, tasks, trainings),
    settings,
    postGoLiveTickets,
    workflowStep: step ? { id: step.id, status: step.status, stageName: step.stageName } : null,
    primaryContactName: (contacts.find((c) => c.isPrimary) ?? contacts[0])?.name,
    sale,
  };
}

/** Chamados abertos pelo cliente nos 30 dias após o go-live (indicador de qualidade da implantação). */
export async function getPostGoLiveTickets(projectOrId: string | Pick<ProjectRecord, "clientId" | "goLiveAt">): Promise<SupportTicket[]> {
  const project = typeof projectOrId === "string" ? await getById<ProjectRecord>(COLLECTIONS.implementationProjects, projectOrId) : projectOrId;
  if (!project?.goLiveAt) return [];
  const end = new Date(new Date(project.goLiveAt).getTime() + 30 * DAY_MS).toISOString();
  const tickets = await list<SupportTicket>(COLLECTIONS.supportTickets, { where: [["clientId", "==", project.clientId]] });
  return tickets.filter((t) => t.openedAt >= project.goLiveAt! && t.openedAt <= end).sort((a, b) => a.openedAt.localeCompare(b.openedAt));
}

// ---------------------------------------------------------------------------
// Go-live
// ---------------------------------------------------------------------------

export interface GoLiveCandidate {
  row: ProjectRow;
  gate: GoLiveGate;
  trainingsDone: number;
  canApprove: boolean;
}

/** Projetos prontos para go-live e os que faltam pouco (progresso >= 80%), com o gate avaliado. */
export async function listGoLiveCandidates(user: CurrentUser, requestedScope?: ProjectScope): Promise<{ ready: GoLiveCandidate[]; almost: GoLiveCandidate[]; recent: ProjectRow[]; scope: ScopeInfo; settings: GoLiveSettings }> {
  const [all, resolved, settings] = await Promise.all([list<ProjectRecord>(COLLECTIONS.implementationProjects), resolveScopeWithLimit(user, requestedScope, "implantacao.go-live"), getGoLiveSettings()]);
  const scope = resolved.info;
  const scoped = visibleProjects(all, resolved);
  // Guarda de borda (implantacao.go-live.aprovar) ∧ helper único por projeto (aprovar-qualquer ou responsável, A22).
  const mayApprove = can(user, "implantacao.go-live.aprovar");
  const candidates = scoped.filter((p) => isActiveProject(p.status) && (p.status === "pronta_para_go_live" || (p.progress ?? 0) >= 80));
  const ids = candidates.map((p) => p.id);
  const since30 = new Date(Date.now() - 30 * DAY_MS).toISOString();
  const recentDone = scoped.filter((p) => p.status === "concluida" && (p.goLiveAt ?? "") >= since30).sort((a, b) => (b.goLiveAt ?? "").localeCompare(a.goLiveAt ?? ""));
  const [rows, recentRows, tasks, trainings] = await Promise.all([
    buildRows(candidates),
    buildRows(recentDone),
    list<ImplementationTask>(COLLECTIONS.implementationTasks, { where: [["projectId", "in", ids]] }),
    list<Training>(COLLECTIONS.trainings, { where: [["projectId", "in", ids]] }),
  ]);
  const byId = new Map(candidates.map((p) => [p.id, p]));
  const result = rows.map((row) => {
    const project = byId.get(row.id)!;
    const projectTrainings = trainings.filter((t) => t.projectId === row.id);
    const gate = evaluateGoLiveGate(
      project,
      tasks.filter((t) => t.projectId === row.id),
      projectTrainings,
    );
    const canApprove = mayApprove && canApproveGoLive(project, user, settings);
    return { row, gate, trainingsDone: projectTrainings.filter((t) => t.status === "realizado").length, canApprove };
  });
  const byMissing = (a: GoLiveCandidate, b: GoLiveCandidate) => a.gate.missing.length - b.gate.missing.length || a.row.dueDate.localeCompare(b.row.dueDate);
  return {
    ready: result.filter((c) => c.row.status === "pronta_para_go_live").sort(byMissing),
    almost: result.filter((c) => c.row.status !== "pronta_para_go_live").sort(byMissing),
    recent: recentRows,
    scope,
    settings,
  };
}

// ---------------------------------------------------------------------------
// Treinamentos
// ---------------------------------------------------------------------------

export interface TrainingRow extends Training {
  clientName: string;
  projectName?: string;
  projectStatus?: ImplementationStatus;
  instructorName: string;
  productName?: string;
}

/** Treinamentos do escopo da tela (instrutor ou donos do projeto) e os projetos ativos do escopo (para agendar). */
export async function listTrainings(user: CurrentUser): Promise<{ rows: TrainingRow[]; projects: { id: string; name: string; clientName: string; productIds: string[] }[]; users: UserLite[]; products: ProductLite[] }> {
  const [allTrainings, allProjects, users, products, limit] = await Promise.all([
    list<Training>(COLLECTIONS.trainings),
    list<ProjectRecord>(COLLECTIONS.implementationProjects),
    listAssignableUsers(),
    list<Product>(COLLECTIONS.products),
    resolveDataScope(user, "implantacao.treinamentos"),
  ]);
  const allById = new Map(allProjects.map((p) => [p.id, p]));
  const trainings = filterByScope(allTrainings, (t) => ({ owners: trainingOwners(t, t.projectId ? allById.get(t.projectId) : null) }), limit);
  const projects = filterByScope(allProjects, (p) => ({ owners: projectOwners(p) }), limit);
  const clients = await getManyByIds<Client>(COLLECTIONS.clients, [...trainings.map((t) => t.clientId), ...projects.map((p) => p.clientId)]);
  const projectById = new Map(projects.map((p) => [p.id, p]));
  const userNames = new Map(users.map((u) => [u.id, u.name]));
  const productNames = new Map(products.map((p) => [p.id, p.name]));
  const rows = trainings
    .map((t) => {
      const project = t.projectId ? projectById.get(t.projectId) : undefined;
      return {
        ...t,
        clientName: clients.get(t.clientId)?.tradeName ?? "—",
        projectName: project?.name,
        projectStatus: project?.status,
        instructorName: userNames.get(t.instructorId) ?? "—",
        productName: t.productId ? productNames.get(t.productId) : undefined,
      };
    })
    .sort((a, b) => b.scheduledAt.localeCompare(a.scheduledAt));
  return {
    rows,
    projects: projects
      .filter((p) => isActiveProject(p.status))
      .map((p) => ({ id: p.id, name: p.name, clientName: clients.get(p.clientId)?.tradeName ?? "—", productIds: p.productIds }))
      .sort((a, b) => a.clientName.localeCompare(b.clientName, "pt-BR")),
    users,
    products: products.map((p) => ({ id: p.id, name: p.name })),
  };
}

// ---------------------------------------------------------------------------
// Templates
// ---------------------------------------------------------------------------

export interface TemplateRow extends ImplementationTemplate {
  productName?: string;
  taskCount: number;
  checklistCount: number;
  /** Produtos cujo cadastro aponta para este template. */
  linkedProducts: string[];
}

export async function listTemplates(): Promise<{ templates: TemplateRow[]; products: ProductLite[] }> {
  const [templates, products] = await Promise.all([list<ImplementationTemplate>(COLLECTIONS.implementationTemplates), list<Product>(COLLECTIONS.products)]);
  const productNames = new Map(products.map((p) => [p.id, p.name]));
  const rows = templates
    .map((t) => ({
      ...t,
      phases: [...t.phases].sort((a, b) => a.order - b.order),
      productName: t.productId ? productNames.get(t.productId) : undefined,
      taskCount: t.phases.reduce((s, p) => s + p.tasks.length, 0),
      checklistCount: t.phases.reduce((s, p) => s + p.checklist.length, 0),
      linkedProducts: products.filter((p) => p.implementationTemplateId === t.id).map((p) => p.name),
    }))
    .sort((a, b) => Number(b.active) - Number(a.active) || a.name.localeCompare(b.name, "pt-BR"));
  return { templates: rows, products: products.filter((p) => p.active).sort((a, b) => a.order - b.order).map((p) => ({ id: p.id, name: p.name })) };
}

// ---------------------------------------------------------------------------
// Ficha 360
// ---------------------------------------------------------------------------

export interface ClientImplementation {
  projects: ProjectRecord[];
  tasks: ImplementationTask[];
  trainings: Training[];
  /** Projeto ativo mais recente (ou o último concluído). */
  current: ProjectRecord | null;
}

/**
 * Implantação de um cliente (ficha 360). Com `user`, aplica o escopo da tela de projetos (A29): projetos fora do
 * escopo — e as tarefas e treinamentos deles — não entram. Sem `user` (chamadores de sistema), tudo.
 */
export async function getClientImplementation(clientId: string, user?: CurrentUser): Promise<ClientImplementation> {
  const byClient = { where: [["clientId", "==", clientId]] as [string, "==", unknown][] };
  const [allProjects, allTasks, allTrainings, limit] = await Promise.all([
    list<ProjectRecord>(COLLECTIONS.implementationProjects, byClient),
    list<ImplementationTask>(COLLECTIONS.implementationTasks, byClient),
    list<Training>(COLLECTIONS.trainings, byClient),
    user ? resolveDataScope(user, "implantacao.projetos") : Promise.resolve(null),
  ]);
  const projects = limit ? filterByScope(allProjects, (p) => ({ owners: projectOwners(p) }), limit) : allProjects;
  const visibleIds = new Set(projects.map((p) => p.id));
  const byId = new Map(allProjects.map((p) => [p.id, p]));
  const tasks = limit ? allTasks.filter((t) => visibleIds.has(t.projectId)) : allTasks;
  const trainings = limit ? filterByScope(allTrainings, (t) => ({ owners: trainingOwners(t, t.projectId ? byId.get(t.projectId) : null) }), limit) : allTrainings;
  projects.sort((a, b) => b.createdAt.localeCompare(a.createdAt));
  tasks.sort((a, b) => IMPLEMENTATION_PHASES.indexOf(a.phase) - IMPLEMENTATION_PHASES.indexOf(b.phase) || (a.dueAt ?? "").localeCompare(b.dueAt ?? ""));
  trainings.sort((a, b) => b.scheduledAt.localeCompare(a.scheduledAt));
  return { projects, tasks, trainings, current: projects.find((p) => isActiveProject(p.status)) ?? projects[0] ?? null };
}

/** Filtros disponíveis na lista (responsáveis com projeto e produtos presentes, dentro do escopo da tela). */
export async function listFilterOptions(user: CurrentUser): Promise<{ owners: UserLite[]; products: ProductLite[] }> {
  const [allProjects, products, limit] = await Promise.all([list<ProjectRecord>(COLLECTIONS.implementationProjects), list<Product>(COLLECTIONS.products), resolveDataScope(user, "implantacao.projetos")]);
  const projects = filterByScope(allProjects, (p) => ({ owners: projectOwners(p) }), limit);
  const ownerIds = Array.from(new Set(projects.flatMap((p) => [p.ownerId, ...(p.teamIds ?? [])])));
  const owners = await getManyByIds<User>(COLLECTIONS.users, ownerIds);
  const used = new Set(projects.flatMap((p) => p.productIds));
  return {
    owners: Array.from(owners.values()).sort((a, b) => a.name.localeCompare(b.name, "pt-BR")).map(toUserLite),
    products: products.filter((p) => used.has(p.id)).sort((a, b) => a.order - b.order).map((p) => ({ id: p.id, name: p.name })),
  };
}
