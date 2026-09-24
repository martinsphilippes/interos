import "server-only";
import { cache } from "react";
/**
 * Leituras do módulo Financeiro. Filtram por organização via `list()` (igualdade apenas) e agregam em
 * memória. Toda leitura de cobranças passa por `listBillingsSwept`, que marca vencidas na primeira
 * detecção (e emite payment.overdue uma vez).
 */
import { getById, getManyByIds, list } from "@/server/db";
import { computeSlaState } from "@/server/sla";
import { dateKey, formatCompetence } from "@/lib/format";
import {
  COLLECTIONS,
  type Billing,
  type ChurnRecord,
  type Client,
  type Communication,
  type Contract,
  type Document,
  type DomainEvent,
  type ImplementationProject,
  type Opportunity,
  type Product,
  type SlaInstance,
  type SlaView,
  type TimelineEvent,
  type User,
  type WorkflowStep,
} from "@/domain/types";
import { AGING_BUCKETS, agingBucket, allSigned, daysBetween, evaluateReleaseGate, listBillingsSwept, requiredPaymentBilling, todayKey, type AgingBucketKey } from "./billing";
import { getGateSettings, mergedBillingData } from "./service";
import { BILLING_STATUSES, BILLING_TYPES, CONTRACT_QUEUE_GROUPS, PERIOD_OPTIONS, type ContractQueueGroup, type PeriodKey, type ReleaseGate } from "./schemas";

// ---------------------------------------------------------------------------
// Utilitários
// ---------------------------------------------------------------------------

export interface UserLite {
  id: string;
  name: string;
  avatarUrl?: string;
}

export interface Option {
  value: string;
  label: string;
}

type SearchParams = Record<string, string | string[] | undefined>;
const one = (params: SearchParams, key: string) => {
  const v = params[key];
  return (Array.isArray(v) ? v[0] : v)?.trim() || undefined;
};

async function usersMap(ids: (string | undefined)[]): Promise<Record<string, UserLite>> {
  const map = await getManyByIds<User>(COLLECTIONS.users, ids.filter((id): id is string => Boolean(id) && id !== "system"));
  const out: Record<string, UserLite> = {};
  for (const [id, u] of map) out[id] = { id, name: u.name, avatarUrl: u.avatarUrl };
  return out;
}

async function clientNames(ids: string[]): Promise<Map<string, string>> {
  const map = await getManyByIds<Client>(COLLECTIONS.clients, ids);
  return new Map(Array.from(map.values()).map((c) => [c.id, c.tradeName]));
}

/** Competência AAAA-MM do instante (fuso da operação). */
const monthOf = (iso: string | undefined) => (iso ? dateKey(iso).slice(0, 7) : "");

/** AAAA-MM `offset` meses a partir do mês corrente. */
function monthKey(offset: number): string {
  const [y, m] = todayKey().slice(0, 7).split("-").map(Number);
  const d = new Date(Date.UTC(y, m - 1 + offset, 1));
  return d.toISOString().slice(0, 7);
}

function lastDayIso(yearMonth: string): string {
  const [y, m] = yearMonth.split("-").map(Number);
  return new Date(Date.UTC(y, m, 0, 23, 59, 59)).toISOString();
}

function periodStart(period: PeriodKey | undefined): string | null {
  if (!period) return null;
  const now = Date.now();
  if (period === "mes") return `${todayKey().slice(0, 7)}-01`;
  const days = period === "30d" ? 30 : period === "90d" ? 90 : 365;
  return dateKey(new Date(now - days * 86_400_000));
}

/** Etapa Financeiro mais relevante por cliente (aberta primeiro) com o SLA calculado. */
async function financeStepsByClient(): Promise<Map<string, WorkflowStep & { sla: SlaView | null }>> {
  const steps = (await list<WorkflowStep>(COLLECTIONS.workflowSteps, { where: [["department", "==", "financeiro"]] })).filter((s) => s.stageKey === "financeiro");
  const slas = await getManyByIds<SlaInstance>(COLLECTIONS.slaInstances, steps.map((s) => s.slaInstanceId ?? ""));
  const out = new Map<string, WorkflowStep & { sla: SlaView | null }>();
  const rank = (s: WorkflowStep) => (s.status === "concluida" || s.status === "pulada" ? 1 : 0);
  for (const s of steps.sort((a, b) => rank(a) - rank(b) || b.createdAt.localeCompare(a.createdAt))) {
    if (out.has(s.clientId)) continue;
    const sla = s.slaInstanceId ? slas.get(s.slaInstanceId) : undefined;
    out.set(s.clientId, { ...s, sla: sla ? computeSlaState(sla) : null });
  }
  return out;
}

// ---------------------------------------------------------------------------
// Fila de contratos
// ---------------------------------------------------------------------------

export interface ContractFilters {
  status?: string;
  clientId?: string;
  ownerId?: string;
  period?: PeriodKey;
  q?: string;
}

export function parseContractFilters(params: SearchParams): ContractFilters {
  const period = one(params, "periodo");
  return {
    status: one(params, "status"),
    clientId: one(params, "cliente"),
    ownerId: one(params, "responsavel"),
    period: PERIOD_OPTIONS.some((p) => p.value === period) ? (period as PeriodKey) : undefined,
    q: one(params, "q"),
  };
}

export interface ContractRow {
  id: string;
  number: string;
  version: number;
  status: Contract["status"];
  financialStatus: Contract["financialStatus"];
  clientId: string;
  clientName: string;
  setupTotal: number;
  monthlyTotal: number;
  hardwareTotal: number;
  signersSigned: number;
  signersTotal: number;
  ownerId?: string;
  ownerName?: string;
  createdAt: string;
  updatedAt: string;
  releasedAt?: string;
  pendingReason?: string;
  sla: SlaView | null;
  stepStatus?: WorkflowStep["status"];
}

export interface ContractListResult {
  rows: ContractRow[];
  total: number;
  facets: { clients: Option[]; owners: Option[] };
}

function matchesStatus(contract: Contract, status: string | undefined, releasedMonth: string): boolean {
  if (!status) return true;
  if (status === "liberados_mes") return contract.status === "liberado" && monthOf(contract.releasedAt) === releasedMonth;
  if (status in CONTRACT_QUEUE_GROUPS) return (CONTRACT_QUEUE_GROUPS[status as ContractQueueGroup] as readonly string[]).includes(contract.status);
  return contract.status === status;
}

const normalize = (text: string) =>
  text
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase();

export async function listContracts(filters: ContractFilters = {}): Promise<ContractListResult> {
  const [contracts, steps] = await Promise.all([list<Contract>(COLLECTIONS.contracts), financeStepsByClient()]);
  const [names, users] = await Promise.all([clientNames(contracts.map((c) => c.clientId)), usersMap(contracts.map((c) => c.ownerId))]);
  const start = periodStart(filters.period);
  const month = todayKey().slice(0, 7);
  const term = filters.q ? normalize(filters.q) : "";

  const rows: ContractRow[] = contracts
    .filter((c) => matchesStatus(c, filters.status, month))
    .filter((c) => !filters.clientId || c.clientId === filters.clientId)
    .filter((c) => !filters.ownerId || c.ownerId === filters.ownerId)
    .filter((c) => !start || dateKey(c.createdAt) >= start || (c.releasedAt !== undefined && dateKey(c.releasedAt) >= start))
    .filter((c) => !term || normalize(`${c.number} ${names.get(c.clientId) ?? ""}`).includes(term))
    .map((c) => {
      const step = steps.get(c.clientId);
      // SLA só faz sentido enquanto o contrato está no Financeiro.
      const inFinance = c.status !== "liberado" && c.status !== "cancelado";
      return {
        id: c.id,
        number: c.number,
        version: c.version,
        status: c.status,
        financialStatus: c.financialStatus,
        clientId: c.clientId,
        clientName: names.get(c.clientId) ?? c.clientId,
        setupTotal: c.setupTotal,
        monthlyTotal: c.monthlyTotal,
        hardwareTotal: c.hardwareTotal,
        signersSigned: c.signers.filter((s) => s.status === "assinado").length,
        signersTotal: c.signers.length,
        ownerId: c.ownerId,
        ownerName: c.ownerId ? users[c.ownerId]?.name : undefined,
        createdAt: c.createdAt,
        updatedAt: c.updatedAt,
        releasedAt: c.releasedAt,
        pendingReason: c.pendingReason,
        sla: inFinance ? (step?.sla ?? null) : null,
        stepStatus: inFinance ? step?.status : undefined,
      };
    });

  // Abertos primeiro (pendência e SLA mais apertado no topo), depois liberados recentes.
  const order: Record<Contract["status"], number> = { pendencia: 0, aguardando_contrato: 1, aguardando_assinatura: 2, assinado: 3, aguardando_pagamento: 4, pago: 5, liberado: 6, cancelado: 7 };
  rows.sort((a, b) => order[a.status] - order[b.status] || (a.sla?.remainingMs ?? Infinity) - (b.sla?.remainingMs ?? Infinity) || b.updatedAt.localeCompare(a.updatedAt));

  const clients = Array.from(new Map(contracts.map((c) => [c.clientId, names.get(c.clientId) ?? c.clientId])).entries())
    .map(([value, label]) => ({ value, label }))
    .sort((a, b) => a.label.localeCompare(b.label, "pt-BR"));
  const owners = Object.values(users)
    .map((u) => ({ value: u.id, label: u.name }))
    .sort((a, b) => a.label.localeCompare(b.label, "pt-BR"));
  return { rows, total: contracts.length, facets: { clients, owners } };
}

// ---------------------------------------------------------------------------
// Visão geral (cards)
// ---------------------------------------------------------------------------

export interface WonWithoutContract {
  opportunityId: string;
  title: string;
  clientId: string;
  clientName: string;
  monthlyTotal: number;
  setupTotal: number;
  wonAt?: string;
}

export interface FinanceOverview {
  counts: { contrato: number; assinatura: number; pagamento: number; pendencia: number; liberadosMes: number };
  mrrActive: number;
  activeContracts: number;
  overdue: { amount: number; count: number };
  billedMonth: number;
  receivedMonth: number;
  /** Vencido em aberto ÷ faturado no mês (fração); null quando nada foi faturado no mês. */
  delinquency: number | null;
  wonWithoutContract: WonWithoutContract[];
  month: string;
}

export async function getFinanceOverview(): Promise<FinanceOverview> {
  const [contracts, billings, wonOpps] = await Promise.all([
    list<Contract>(COLLECTIONS.contracts),
    listBillingsSwept(),
    list<Opportunity>(COLLECTIONS.opportunities, { where: [["stage", "==", "ganho"]] }),
  ]);
  const month = todayKey().slice(0, 7);
  const inGroup = (g: ContractQueueGroup) => contracts.filter((c) => (CONTRACT_QUEUE_GROUPS[g] as readonly string[]).includes(c.status)).length;
  const released = contracts.filter((c) => c.status === "liberado");
  const overdue = billings.filter((b) => b.status === "vencida");
  const active = billings.filter((b) => b.status !== "cancelada");
  const billedMonth = active.filter((b) => b.competence === month).reduce((s, b) => s + b.amount, 0);
  const receivedMonth = billings.filter((b) => b.status === "paga" && monthOf(b.paidAt) === month).reduce((s, b) => s + (b.paidAmount ?? b.amount), 0);
  const overdueAmount = overdue.reduce((s, b) => s + b.amount, 0);

  const withContract = new Set(contracts.filter((c) => c.status !== "cancelado" && c.opportunityId).map((c) => c.opportunityId));
  const orphans = wonOpps.filter((o) => !withContract.has(o.id));
  const names = await clientNames(orphans.map((o) => o.clientId));

  return {
    counts: {
      contrato: inGroup("contrato"),
      assinatura: inGroup("assinatura"),
      pagamento: inGroup("pagamento"),
      pendencia: inGroup("pendencia"),
      liberadosMes: released.filter((c) => monthOf(c.releasedAt) === month).length,
    },
    mrrActive: released.reduce((s, c) => s + c.monthlyTotal, 0),
    activeContracts: released.length,
    overdue: { amount: overdueAmount, count: overdue.length },
    billedMonth,
    receivedMonth,
    delinquency: billedMonth > 0 ? overdueAmount / billedMonth : null,
    wonWithoutContract: orphans
      .map((o) => ({ opportunityId: o.id, title: o.title, clientId: o.clientId, clientName: names.get(o.clientId) ?? o.clientId, monthlyTotal: o.monthlyTotal, setupTotal: o.setupTotal, wonAt: o.wonAt }))
      .sort((a, b) => (b.wonAt ?? "").localeCompare(a.wonAt ?? "")),
    month,
  };
}

// ---------------------------------------------------------------------------
// Contrato (página de detalhe)
// ---------------------------------------------------------------------------

export interface ProductOption {
  id: string;
  name: string;
  setupPrice: number;
  monthlyPrice: number;
  hardwarePrice: number;
}

export interface ContractDetail {
  contract: Contract;
  client: Client;
  opportunity: Opportunity | null;
  billings: Billing[];
  documents: Document[];
  history: TimelineEvent[];
  users: Record<string, UserLite>;
  gate: ReleaseGate;
  /** Cobrança cujo pagamento o gate exige (destacada na lista). */
  requiredBillingId?: string;
  billingData: ReturnType<typeof mergedBillingData>;
  missingBillingFields: string[];
  step: (WorkflowStep & { sla: SlaView | null }) | null;
  project: Pick<ImplementationProject, "id" | "name" | "status" | "ownerId" | "dueDate"> | null;
  reminders: Record<string, { count: number; lastAt: string }>;
  sentAt?: string;
  products: ProductOption[];
  /** Itens/condições editáveis (não assinado por todos, não liberado/cancelado). */
  editable: boolean;
}

/** Memoizado por requisição: generateMetadata e a página compartilham a leitura. */
export const getContract = cache(async (id: string): Promise<ContractDetail | null> => {
  const contract = await getById<Contract>(COLLECTIONS.contracts, id);
  if (!contract) return null;
  const [client, opportunity, billings, settings, clientDocs, timeline, steps, projects, contractEvents, catalog] = await Promise.all([
    getById<Client>(COLLECTIONS.clients, contract.clientId),
    contract.opportunityId ? getById<Opportunity>(COLLECTIONS.opportunities, contract.opportunityId) : Promise.resolve(null),
    listBillingsSwept({ where: [["contractId", "==", contract.id]] }),
    getGateSettings(),
    list<Document>(COLLECTIONS.documents, { where: [["clientId", "==", contract.clientId]] }),
    list<TimelineEvent>(COLLECTIONS.timelineEvents, { where: [["clientId", "==", contract.clientId]] }),
    list<WorkflowStep>(COLLECTIONS.workflowSteps, { where: [["clientId", "==", contract.clientId]] }),
    list<ImplementationProject>(COLLECTIONS.implementationProjects, { where: [["contractId", "==", contract.id]] }),
    list<DomainEvent>(COLLECTIONS.events, { where: [["entityId", "==", contract.id]] }),
    list<Product>(COLLECTIONS.products),
  ]);
  if (!client) return null;

  billings.sort((a, b) => a.dueDate.localeCompare(b.dueDate) || (a.installment ?? 0) - (b.installment ?? 0) || a.type.localeCompare(b.type));
  const billingIds = new Set(billings.map((b) => b.id));
  const documents = clientDocs
    .filter((d) => (d.entityType === "contract" && d.entityId === contract.id) || (d.entityType === "billing" && d.entityId && billingIds.has(d.entityId)) || contract.documentIds.includes(d.id))
    .sort((a, b) => b.createdAt.localeCompare(a.createdAt));

  const project = projects.find((p) => p.status !== "cancelada") ?? null;
  const related = new Set([contract.id, ...billingIds, ...(project ? [project.id] : []), ...(contract.opportunityId ? [contract.opportunityId] : [])]);
  const history = timeline
    .filter((e) => (e.entityId && related.has(e.entityId)) || e.department === "financeiro")
    .sort((a, b) => b.occurredAt.localeCompare(a.occurredAt));

  const financeStep = steps.filter((s) => s.stageKey === "financeiro").sort((a, b) => b.createdAt.localeCompare(a.createdAt))[0] ?? null;
  const sla = financeStep?.slaInstanceId ? await getById<SlaInstance>(COLLECTIONS.slaInstances, financeStep.slaInstanceId) : null;

  const reminders: Record<string, { count: number; lastAt: string }> = {};
  const sentAt = contractEvents
    .filter((e) => e.type === "contract.sent_for_signature")
    .map((e) => e.occurredAt)
    .sort()
    .pop();
  // Lembretes enviados desde o último envio (evento notification.sent do serviço, com o e-mail no payload).
  for (const e of contractEvents.filter((x) => x.type === "notification.sent" && typeof x.payload.email === "string" && (!sentAt || x.occurredAt >= sentAt))) {
    const email = String(e.payload.email).toLowerCase();
    const cur = reminders[email] ?? { count: 0, lastAt: "" };
    reminders[email] = { count: cur.count + 1, lastAt: e.occurredAt > cur.lastAt ? e.occurredAt : cur.lastAt };
  }

  const billingData = mergedBillingData(client, opportunity);
  const missingBillingFields = [
    !billingData.legalName && "Razão social",
    !billingData.document && "CPF/CNPJ",
    !billingData.email && "E-mail de faturamento",
    !billingData.address.street && "Logradouro",
    !billingData.address.city && "Cidade",
    !billingData.address.state && "UF",
    !billingData.address.zip && "CEP",
  ].filter((x): x is string => Boolean(x));

  const users = await usersMap([
    contract.ownerId,
    contract.releasedBy,
    contract.createdBy,
    opportunity?.ownerId,
    client.ownerSalesId,
    client.ownerImplementationId,
    project?.ownerId,
    financeStep?.assigneeId,
    ...documents.map((d) => d.uploadedBy),
    ...history.map((e) => e.actorId),
  ]);

  const signedByAll = Boolean(contract.signatureEnvelopeId) && allSigned(contract);
  return {
    contract,
    client,
    opportunity,
    billings,
    documents,
    history,
    users,
    gate: evaluateReleaseGate(contract, billings, settings),
    requiredBillingId: settings.exigePagamento === "nenhum" ? undefined : requiredPaymentBilling(billings, settings.exigePagamento)?.id,
    billingData,
    missingBillingFields,
    step: financeStep ? { ...financeStep, sla: sla ? computeSlaState(sla) : null } : null,
    project: project ? { id: project.id, name: project.name, status: project.status, ownerId: project.ownerId, dueDate: project.dueDate } : null,
    reminders,
    sentAt,
    products: catalog
      .filter((p) => p.active)
      .sort((a, b) => a.order - b.order)
      .map((p) => ({ id: p.id, name: p.name, setupPrice: p.setupPrice, monthlyPrice: p.monthlyPrice, hardwarePrice: p.hardwarePrice })),
    editable: contract.status !== "liberado" && contract.status !== "cancelado" && !signedByAll,
  };
});

// ---------------------------------------------------------------------------
// Assinaturas
// ---------------------------------------------------------------------------

export interface SignatureRow {
  contractId: string;
  number: string;
  version: number;
  status: Contract["status"];
  clientId: string;
  clientName: string;
  monthlyTotal: number;
  sentAt?: string;
  daysWaiting: number;
  signers: Contract["signers"];
  pendingCount: number;
  remindersSent: number;
  lastReminderAt?: string;
  ownerName?: string;
}

export interface SignatureQueue {
  waiting: SignatureRow[];
  toSend: SignatureRow[];
}

export async function listSignatureQueue(): Promise<SignatureQueue> {
  const contracts = (await list<Contract>(COLLECTIONS.contracts)).filter((c) => c.status === "aguardando_assinatura" || c.status === "aguardando_contrato" || (c.status === "pendencia" && !allSigned(c)));
  const ids = contracts.map((c) => c.id);
  const [names, users, sentEvents, comms] = await Promise.all([
    clientNames(contracts.map((c) => c.clientId)),
    usersMap(contracts.map((c) => c.ownerId)),
    list<DomainEvent>(COLLECTIONS.events, { where: [["type", "==", "contract.sent_for_signature"]] }),
    list<Communication>(COLLECTIONS.communications, { where: [["templateKey", "==", "lembrete_assinatura"]] }),
  ]);
  const idSet = new Set(ids);
  const sentAt = new Map<string, string>();
  for (const e of sentEvents) if (e.entityId && idSet.has(e.entityId) && (sentAt.get(e.entityId) ?? "") < e.occurredAt) sentAt.set(e.entityId, e.occurredAt);
  const today = todayKey();

  const rows = contracts.map((c) => {
    const reminders = comms.filter((m) => m.entityId === c.id && (!sentAt.get(c.id) || m.createdAt >= sentAt.get(c.id)!));
    const since = sentAt.get(c.id) ?? c.updatedAt;
    return {
      contractId: c.id,
      number: c.number,
      version: c.version,
      status: c.status,
      clientId: c.clientId,
      clientName: names.get(c.clientId) ?? c.clientId,
      monthlyTotal: c.monthlyTotal,
      sentAt: sentAt.get(c.id),
      daysWaiting: Math.max(0, daysBetween(dateKey(since), today)),
      signers: c.signers,
      pendingCount: c.signers.filter((s) => s.status !== "assinado").length,
      remindersSent: reminders.length,
      lastReminderAt: reminders.map((r) => r.createdAt).sort().pop(),
      ownerName: c.ownerId ? users[c.ownerId]?.name : undefined,
      envelope: Boolean(c.signatureEnvelopeId),
    };
  });
  return {
    waiting: rows.filter((r) => r.envelope).sort((a, b) => b.daysWaiting - a.daysWaiting),
    toSend: rows.filter((r) => !r.envelope).sort((a, b) => b.daysWaiting - a.daysWaiting),
  };
}

// ---------------------------------------------------------------------------
// Cobranças
// ---------------------------------------------------------------------------

export interface BillingFilters {
  status?: Billing["status"];
  type?: Billing["type"];
  competence?: string;
  clientId?: string;
  contractId?: string;
}

export function parseBillingFilters(params: SearchParams): BillingFilters {
  const status = one(params, "status");
  const type = one(params, "tipo");
  const comp = one(params, "competencia");
  return {
    status: (BILLING_STATUSES as readonly string[]).includes(status ?? "") ? (status as Billing["status"]) : undefined,
    type: (BILLING_TYPES as readonly string[]).includes(type ?? "") ? (type as Billing["type"]) : undefined,
    competence: comp && /^\d{4}-\d{2}$/.test(comp) ? comp : undefined,
    clientId: one(params, "cliente"),
    contractId: one(params, "contrato"),
  };
}

export interface BillingRow extends Billing {
  clientName: string;
  contractNumber: string;
  /** Dias de atraso (vencidas) ou até o vencimento (negativo = já venceu). */
  daysToDue: number;
}

export interface BillingListResult {
  rows: BillingRow[];
  totals: { count: number; amount: number; open: number; overdue: number; paid: number };
  facets: { clients: Option[]; competences: Option[] };
}

export async function listBillings(filters: BillingFilters = {}): Promise<BillingListResult> {
  const billings = await listBillingsSwept(filters.contractId ? { where: [["contractId", "==", filters.contractId]] } : {});
  const [names, contracts] = await Promise.all([clientNames(billings.map((b) => b.clientId)), getManyByIds<Contract>(COLLECTIONS.contracts, billings.map((b) => b.contractId))]);
  const today = todayKey();
  const filtered = billings.filter(
    (b) => (!filters.status || b.status === filters.status) && (!filters.type || b.type === filters.type) && (!filters.competence || b.competence === filters.competence) && (!filters.clientId || b.clientId === filters.clientId),
  );
  const rank: Record<Billing["status"], number> = { vencida: 0, aberta: 1, paga: 2, cancelada: 3 };
  const rows: BillingRow[] = filtered
    .map((b) => ({ ...b, clientName: names.get(b.clientId) ?? b.clientId, contractNumber: contracts.get(b.contractId)?.number ?? "—", daysToDue: daysBetween(today, dateKey(b.dueDate)) }))
    .sort((a, b) => rank[a.status] - rank[b.status] || (a.status === "paga" || a.status === "cancelada" ? b.dueDate.localeCompare(a.dueDate) : a.dueDate.localeCompare(b.dueDate)));

  const sum = (items: Billing[]) => items.reduce((s, b) => s + b.amount, 0);
  const competences = Array.from(new Set(billings.map((b) => b.competence)))
    .sort()
    .reverse()
    .map((c) => ({ value: c, label: formatCompetence(c) }));
  const clients = Array.from(new Set(billings.map((b) => b.clientId)))
    .map((id) => ({ value: id, label: names.get(id) ?? id }))
    .sort((a, b) => a.label.localeCompare(b.label, "pt-BR"));
  return {
    rows,
    totals: {
      count: filtered.length,
      amount: sum(filtered.filter((b) => b.status !== "cancelada")),
      open: sum(filtered.filter((b) => b.status === "aberta")),
      overdue: sum(filtered.filter((b) => b.status === "vencida")),
      paid: filtered.filter((b) => b.status === "paga").reduce((s, b) => s + (b.paidAmount ?? b.amount), 0),
    },
    facets: { clients, competences },
  };
}

// ---------------------------------------------------------------------------
// Contas a receber
// ---------------------------------------------------------------------------

export interface AgingBucketView {
  key: AgingBucketKey;
  label: string;
  overdue: boolean;
  amount: number;
  count: number;
}

export interface ReceivableClient {
  clientId: string;
  clientName: string;
  open: number;
  overdue: number;
  overdueCount: number;
  openCount: number;
  oldestOverdueDays: number;
  nextDueDate?: string;
  buckets: Partial<Record<AgingBucketKey, number>>;
  /** Cobrança vencida mais antiga (alvo da ação de cobrança). */
  oldestOverdue?: Pick<Billing, "id" | "type" | "installment" | "amount" | "dueDate" | "status">;
}

export interface MonthlyFlow {
  competence: string;
  label: string;
  billed: number;
  received: number;
}

export interface ReceivablesAging {
  buckets: AgingBucketView[];
  totalOpen: number;
  totalOverdue: number;
  totalToReceive: number;
  byClient: ReceivableClient[];
  delinquents: ReceivableClient[];
  monthly: MonthlyFlow[];
}

export async function getReceivablesAging(): Promise<ReceivablesAging> {
  const billings = await listBillingsSwept();
  const today = todayKey();
  const receivable = billings.filter((b) => b.status === "aberta" || b.status === "vencida");
  const names = await clientNames(receivable.map((b) => b.clientId));

  const buckets: AgingBucketView[] = AGING_BUCKETS.map((b) => ({ key: b.key, label: b.label, overdue: b.overdue, amount: 0, count: 0 }));
  const byClient = new Map<string, ReceivableClient>();
  for (const b of receivable) {
    const key = agingBucket(b, today);
    const bucket = buckets.find((x) => x.key === key)!;
    bucket.amount += b.amount;
    bucket.count += 1;
    const row = byClient.get(b.clientId) ?? { clientId: b.clientId, clientName: names.get(b.clientId) ?? b.clientId, open: 0, overdue: 0, overdueCount: 0, openCount: 0, oldestOverdueDays: 0, buckets: {} };
    row.buckets[key] = (row.buckets[key] ?? 0) + b.amount;
    if (b.status === "vencida") {
      row.overdue += b.amount;
      row.overdueCount += 1;
      row.oldestOverdueDays = Math.max(row.oldestOverdueDays, -daysBetween(today, dateKey(b.dueDate)));
      if (!row.oldestOverdue || b.dueDate < row.oldestOverdue.dueDate) row.oldestOverdue = { id: b.id, type: b.type, installment: b.installment, amount: b.amount, dueDate: b.dueDate, status: b.status };
    } else {
      row.open += b.amount;
      row.openCount += 1;
      if (!row.nextDueDate || b.dueDate < row.nextDueDate) row.nextDueDate = b.dueDate;
    }
    byClient.set(b.clientId, row);
  }
  const clients = Array.from(byClient.values()).sort((a, b) => b.overdue - a.overdue || b.open + b.overdue - (a.open + a.overdue));

  // Faturado (por competência) x recebido (por data de pagamento) nos últimos 6 meses.
  const months = Array.from({ length: 6 }, (_, i) => monthKey(i - 5));
  const monthly = months.map((m) => ({
    competence: m,
    label: formatCompetence(m),
    billed: billings.filter((b) => b.status !== "cancelada" && b.competence === m).reduce((s, b) => s + b.amount, 0),
    received: billings.filter((b) => b.status === "paga" && monthOf(b.paidAt) === m).reduce((s, b) => s + (b.paidAmount ?? b.amount), 0),
  }));

  const totalOpen = receivable.filter((b) => b.status === "aberta").reduce((s, b) => s + b.amount, 0);
  const totalOverdue = receivable.filter((b) => b.status === "vencida").reduce((s, b) => s + b.amount, 0);
  return { buckets, totalOpen, totalOverdue, totalToReceive: totalOpen + totalOverdue, byClient: clients, delinquents: clients.filter((c) => c.overdueCount > 0), monthly };
}

// ---------------------------------------------------------------------------
// Recorrência
// ---------------------------------------------------------------------------

export interface MrrPoint {
  month: string;
  label: string;
  mrr: number;
  /** Variação sobre o mês anterior (fração); null no primeiro mês ou com base zero. */
  growth: number | null;
}

export interface RenewalRow {
  contractId: string;
  number: string;
  clientId: string;
  clientName: string;
  endDate: string;
  daysLeft: number;
  monthlyTotal: number;
}

export interface RecurrenceMetrics {
  mrr: number;
  activeContracts: number;
  byProduct: { productId: string; name: string; mrr: number; contracts: number }[];
  newMrrMonth: number;
  newContractsMonth: number;
  lostMrrMonth: number;
  churnCountMonth: number;
  netNewMrr: number;
  growthMonth: number | null;
  history: MrrPoint[];
  renewals: RenewalRow[];
  targetGrowth: number | null;
}

export async function getRecurrenceMetrics(): Promise<RecurrenceMetrics> {
  const [contracts, churn, goals] = await Promise.all([
    list<Contract>(COLLECTIONS.contracts),
    list<ChurnRecord>(COLLECTIONS.churnRecords),
    list<{ id: string; organizationId: string; createdAt: string; updatedAt: string; key: string; value: { mrrCrescimento?: number } }>(COLLECTIONS.settings, { where: [["key", "==", "metas_referencia"]] }),
  ]);
  const month = todayKey().slice(0, 7);
  const released = contracts.filter((c) => c.releasedAt);

  // Data em que o contrato deixou de compor o MRR: churn do cliente após a liberação; sem registro, a última atualização.
  const cancelledAt = new Map<string, string>();
  for (const c of released.filter((x) => x.status === "cancelado")) {
    const churnDate = churn
      .filter((r) => r.clientId === c.clientId && r.date >= (c.releasedAt ?? ""))
      .map((r) => r.date)
      .sort()[0];
    cancelledAt.set(c.id, churnDate ?? c.updatedAt);
  }
  const mrrAt = (endIso: string) =>
    released.filter((c) => c.releasedAt! <= endIso && !(cancelledAt.has(c.id) && cancelledAt.get(c.id)! <= endIso)).reduce((s, c) => s + c.monthlyTotal, 0);

  const months = Array.from({ length: 9 }, (_, i) => monthKey(i - 8));
  const points = months.map((m) => ({ month: m, label: formatCompetence(m), mrr: m === month ? mrrAt(new Date().toISOString()) : mrrAt(lastDayIso(m)) }));
  const history: MrrPoint[] = points.slice(1).map((p, i) => {
    const prev = points[i].mrr;
    return { ...p, growth: prev > 0 ? (p.mrr - prev) / prev : null };
  });

  const active = contracts.filter((c) => c.status === "liberado");
  const byProduct = new Map<string, { productId: string; name: string; mrr: number; contracts: Set<string> }>();
  for (const c of active) {
    for (const item of c.items) {
      const cur = byProduct.get(item.productId) ?? { productId: item.productId, name: item.productName, mrr: 0, contracts: new Set<string>() };
      cur.mrr += item.monthlyValue * (1 - (item.discountPct ?? 0) / 100);
      cur.contracts.add(c.id);
      byProduct.set(item.productId, cur);
    }
  }

  const newThisMonth = released.filter((c) => monthOf(c.releasedAt) === month);
  const churnThisMonth = churn.filter((r) => monthOf(r.date) === month);
  const newMrrMonth = newThisMonth.reduce((s, c) => s + c.monthlyTotal, 0);
  const lostMrrMonth = churnThisMonth.reduce((s, r) => s + r.lostMrr, 0);

  const today = todayKey();
  const names = await clientNames(active.map((c) => c.clientId));
  const renewals: RenewalRow[] = active
    .filter((c) => c.endDate)
    .map((c) => ({ contractId: c.id, number: c.number, clientId: c.clientId, clientName: names.get(c.clientId) ?? c.clientId, endDate: c.endDate!, daysLeft: daysBetween(today, dateKey(c.endDate!)), monthlyTotal: c.monthlyTotal }))
    .sort((a, b) => a.endDate.localeCompare(b.endDate));

  const target = goals[0]?.value?.mrrCrescimento;
  return {
    mrr: active.reduce((s, c) => s + c.monthlyTotal, 0),
    activeContracts: active.length,
    byProduct: Array.from(byProduct.values())
      .map((p) => ({ productId: p.productId, name: p.name, mrr: Math.round(p.mrr * 100) / 100, contracts: p.contracts.size }))
      .filter((p) => p.mrr > 0)
      .sort((a, b) => b.mrr - a.mrr),
    newMrrMonth,
    newContractsMonth: newThisMonth.length,
    lostMrrMonth,
    churnCountMonth: churnThisMonth.length,
    netNewMrr: newMrrMonth - lostMrrMonth,
    growthMonth: history[history.length - 1]?.growth ?? null,
    history,
    renewals,
    targetGrowth: typeof target === "number" ? target : null,
  };
}

// ---------------------------------------------------------------------------
// Resumo financeiro do cliente (ficha 360º)
// ---------------------------------------------------------------------------

export interface ClientFinancialSummary {
  /** Soma das mensalidades dos contratos liberados. */
  mrr: number;
  openAmount: number;
  openCount: number;
  overdueAmount: number;
  overdueCount: number;
  paidLast12Months: number;
  nextDue?: { billingId: string; dueDate: string; amount: number; type: Billing["type"] };
  contracts: { id: string; number: string; status: Contract["status"]; monthlyTotal: number }[];
  /** Contrato ainda no Financeiro (não liberado nem cancelado), se houver. */
  pendingContract?: { id: string; number: string; status: Contract["status"]; pendingReason?: string };
}

export async function getClientFinancialSummary(clientId: string): Promise<ClientFinancialSummary> {
  const [contracts, billings] = await Promise.all([list<Contract>(COLLECTIONS.contracts, { where: [["clientId", "==", clientId]] }), listBillingsSwept({ where: [["clientId", "==", clientId]] })]);
  const today = todayKey();
  const yearAgo = dateKey(new Date(Date.now() - 365 * 86_400_000));
  const open = billings.filter((b) => b.status === "aberta");
  const overdue = billings.filter((b) => b.status === "vencida");
  const next = [...open].sort((a, b) => a.dueDate.localeCompare(b.dueDate)).find((b) => dateKey(b.dueDate) >= today);
  const pending = contracts.filter((c) => c.status !== "liberado" && c.status !== "cancelado").sort((a, b) => b.createdAt.localeCompare(a.createdAt))[0];
  return {
    mrr: contracts.filter((c) => c.status === "liberado").reduce((s, c) => s + c.monthlyTotal, 0),
    openAmount: open.reduce((s, b) => s + b.amount, 0),
    openCount: open.length,
    overdueAmount: overdue.reduce((s, b) => s + b.amount, 0),
    overdueCount: overdue.length,
    paidLast12Months: billings.filter((b) => b.status === "paga" && b.paidAt && dateKey(b.paidAt) >= yearAgo).reduce((s, b) => s + (b.paidAmount ?? b.amount), 0),
    nextDue: next ? { billingId: next.id, dueDate: next.dueDate, amount: next.amount, type: next.type } : undefined,
    contracts: contracts.sort((a, b) => b.createdAt.localeCompare(a.createdAt)).map((c) => ({ id: c.id, number: c.number, status: c.status, monthlyTotal: c.monthlyTotal })),
    pendingContract: pending ? { id: pending.id, number: pending.number, status: pending.status, pendingReason: pending.pendingReason } : undefined,
  };
}
