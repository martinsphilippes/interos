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
  type Contact,
  type Contract,
  type ContractAmendment,
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
import { AGING_BUCKETS, agingBucket, allSigned, daysBetween, evaluateReleaseGate, isContractExpired, listBillingsSwept, pendingRecurringInstallments, requiredPaymentBilling, todayKey, type AgingBucketKey } from "./billing";
import { getFinanceAlertSettings } from "./alerts";
import { getGateSettings, mergedBillingData } from "./service";
import { buildContractSummary, redactContractSummary, type ContractSummaryData } from "@/components/finance/contract-summary";
import type { DataScope } from "@/server/auth/scope";
import { getCurrentUser } from "@/server/auth/session";
import { canSeeFinanceValues, filterBillingsByContracts, filterContractsByScope, isCompanyScope, ownersPredicate, visibleContractIds } from "./access";
import { maskMoneyText, redactAmendment, redactBilling, redactContract } from "./redact";
import { BILLING_STATUSES, BILLING_TYPES, BOLETO_FILTERS, boletoState, CONTRACT_QUEUE_GROUPS, PERIOD_OPTIONS, type BoletoFilter, type ContractQueueGroup, type PeriodKey, type ReleaseGate } from "./schemas";

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

/**
 * Opções de leitura das telas (A7/A13): `scope` = escopo da tela (resolveDataScope; ausente = empresa, como antes) e
 * `hideValues` = sem "Visualizar valores" (os números saem zerados e o resultado marca `valuesHidden`).
 */
export interface FinanceReadOptions {
  scope?: DataScope;
  hideValues?: boolean;
}

async function scoped<T extends Contract>(contracts: T[], scope: DataScope | undefined): Promise<T[]> {
  return scope ? filterContractsByScope(contracts, scope) : contracts;
}
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
  /** Vigência terminada sem renovação aplicada (estado derivado, D24b). */
  expired: boolean;
  endDate?: string;
}

export interface ContractListResult {
  rows: ContractRow[];
  total: number;
  facets: { clients: Option[]; owners: Option[] };
  /** Valores ocultos (A13): setupTotal/monthlyTotal/hardwareTotal chegam zerados. */
  valuesHidden?: boolean;
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

export async function listContracts(filters: ContractFilters = {}, options: FinanceReadOptions = {}): Promise<ContractListResult> {
  const [all, steps] = await Promise.all([list<Contract>(COLLECTIONS.contracts), financeStepsByClient()]);
  const contracts = await scoped(all, options.scope);
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
        setupTotal: options.hideValues ? 0 : c.setupTotal,
        monthlyTotal: options.hideValues ? 0 : c.monthlyTotal,
        hardwareTotal: options.hideValues ? 0 : c.hardwareTotal,
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
        expired: isContractExpired(c),
        endDate: c.endDate,
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
  return { rows, total: contracts.length, facets: { clients, owners }, ...(options.hideValues ? { valuesHidden: true } : {}) };
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
  /** Valores ocultos (A13): quantias zeradas; a tela mostra "Restrito". */
  valuesHidden?: boolean;
}

export async function getFinanceOverview(options: FinanceReadOptions = {}): Promise<FinanceOverview> {
  const [allContracts, allBillings, allWon] = await Promise.all([
    list<Contract>(COLLECTIONS.contracts),
    listBillingsSwept(),
    list<Opportunity>(COLLECTIONS.opportunities, { where: [["stage", "==", "ganho"]] }),
  ]);
  // Escopo (A7): contratos e cobranças pelos donos do contrato; vendas ganhas pelo vendedor da oportunidade.
  const scope = options.scope;
  const contracts = await scoped(allContracts, scope);
  const billings = scope && !isCompanyScope(scope) ? filterBillingsByContracts(allBillings, new Set(contracts.map((c) => c.id))) : allBillings;
  const allows = scope ? await ownersPredicate(scope) : () => true;
  const wonOpps = allWon.filter((o) => allows([o.ownerId]));
  const month = todayKey().slice(0, 7);
  const inGroup = (g: ContractQueueGroup) => contracts.filter((c) => (CONTRACT_QUEUE_GROUPS[g] as readonly string[]).includes(c.status)).length;
  const released = contracts.filter((c) => c.status === "liberado");
  // MRR só dos contratos liberados com vigência em curso (vencidos sem renovação ficam de fora, D24b).
  const inForce = released.filter((c) => !isContractExpired(c));
  const overdue = billings.filter((b) => b.status === "vencida");
  const active = billings.filter((b) => b.status !== "cancelada");
  const billedMonth = active.filter((b) => b.competence === month).reduce((s, b) => s + b.amount, 0);
  const receivedMonth = billings.filter((b) => b.status === "paga" && monthOf(b.paidAt) === month).reduce((s, b) => s + (b.paidAmount ?? b.amount), 0);
  const overdueAmount = overdue.reduce((s, b) => s + b.amount, 0);

  // Venda "sem contrato" olha TODOS os contratos (o contrato pode ser de outro dono fora do escopo).
  const withContract = new Set(allContracts.filter((c) => c.status !== "cancelado" && c.opportunityId).map((c) => c.opportunityId));
  const orphans = wonOpps.filter((o) => !withContract.has(o.id));
  const names = await clientNames(orphans.map((o) => o.clientId));

  const overview: FinanceOverview = {
    counts: {
      contrato: inGroup("contrato"),
      assinatura: inGroup("assinatura"),
      pagamento: inGroup("pagamento"),
      pendencia: inGroup("pendencia"),
      liberadosMes: released.filter((c) => monthOf(c.releasedAt) === month).length,
    },
    mrrActive: inForce.reduce((s, c) => s + c.monthlyTotal, 0),
    activeContracts: inForce.length,
    overdue: { amount: overdueAmount, count: overdue.length },
    billedMonth,
    receivedMonth,
    delinquency: billedMonth > 0 ? overdueAmount / billedMonth : null,
    wonWithoutContract: orphans
      .map((o) => ({ opportunityId: o.id, title: o.title, clientId: o.clientId, clientName: names.get(o.clientId) ?? o.clientId, monthlyTotal: o.monthlyTotal, setupTotal: o.setupTotal, wonAt: o.wonAt }))
      .sort((a, b) => (b.wonAt ?? "").localeCompare(a.wonAt ?? "")),
    month,
  };
  return options.hideValues ? redactOverview(overview) : overview;
}

/** Visão geral sem valores (A13): contagens ficam; quantias e a inadimplência (razão entre quantias) saem. */
export function redactOverview(o: FinanceOverview): FinanceOverview {
  return {
    ...o,
    mrrActive: 0,
    overdue: { amount: 0, count: o.overdue.count },
    billedMonth: 0,
    receivedMonth: 0,
    delinquency: null,
    wonWithoutContract: o.wonWithoutContract.map((w) => ({ ...w, monthlyTotal: 0, setupTotal: 0 })),
    valuesHidden: true,
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
  /** Resumo do contratado (D7): o que a venda contratou, com vendedor e contato. */
  summary: ContractSummaryData;
  /** Vigência terminada sem renovação (estado derivado). */
  expired: boolean;
  /** Mensalidades que "Gerar próximas cobranças" criaria agora (0 = botão não aparece). */
  pendingRecurring: number;
  /** Aditivos do contrato (D25), do mais recente ao mais antigo. */
  amendments: ContractAmendment[];
  /** Valores ocultos (A13): contrato, cobranças, aditivos, resumo e catálogo chegam sem números. */
  valuesHidden?: boolean;
}

/**
 * Detalhe do contrato sem valores (A13), para o que vai à tela. O gate, o hash do documento e as cobranças pendentes
 * já foram calculados com os dados reais em getContract; textos livres (histórico) têm as quantias mascaradas.
 */
export function redactContractDetail(detail: ContractDetail): ContractDetail {
  return {
    ...detail,
    contract: redactContract(detail.contract),
    opportunity: null,
    billings: detail.billings.map(redactBilling),
    amendments: detail.amendments.map(redactAmendment),
    summary: redactContractSummary(detail.summary),
    products: detail.products.map((p) => ({ ...p, setupPrice: 0, monthlyPrice: 0, hardwarePrice: 0 })),
    history: detail.history.map((e) => ({ ...e, title: maskMoneyText(e.title), description: maskMoneyText(e.description) })),
    gate: { ...detail.gate, checks: detail.gate.checks.map((c) => ({ ...c, detail: maskMoneyText(c.detail) })) },
    valuesHidden: true,
  };
}

/** Memoizado por requisição: generateMetadata e a página compartilham a leitura. */
export const getContract = cache(async (id: string): Promise<ContractDetail | null> => {
  const contract = await getById<Contract>(COLLECTIONS.contracts, id);
  if (!contract) return null;
  const [client, opportunity, billings, settings, clientDocs, timeline, steps, projects, contractEvents, catalog, amendments, alertSettings] = await Promise.all([
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
    list<ContractAmendment>(COLLECTIONS.contractAmendments, { where: [["contractId", "==", contract.id]] }),
    getFinanceAlertSettings(),
  ]);
  if (!client) return null;

  billings.sort((a, b) => a.dueDate.localeCompare(b.dueDate) || (a.installment ?? 0) - (b.installment ?? 0) || a.type.localeCompare(b.type));
  const billingIds = new Set(billings.map((b) => b.id));
  const documents = clientDocs
    .filter((d) => (d.entityType === "contract" && d.entityId === contract.id) || (d.entityType === "billing" && d.entityId && billingIds.has(d.entityId)) || contract.documentIds.includes(d.id))
    .sort((a, b) => b.createdAt.localeCompare(a.createdAt));

  const project = projects.find((p) => p.status !== "cancelada") ?? null;
  amendments.sort((a, b) => b.createdAt.localeCompare(a.createdAt));
  const related = new Set([contract.id, ...billingIds, ...(project ? [project.id] : []), ...(contract.opportunityId ? [contract.opportunityId] : []), ...amendments.map((a) => a.id)]);
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
    contract.cancelledBy,
    contract.sellerId,
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
  const contactId = contract.contactId ?? opportunity?.closing?.contactId;
  const contact = contactId ? await getById<Contact>(COLLECTIONS.contacts, contactId) : null;
  const sellerId = contract.sellerId ?? opportunity?.ownerId;
  const summary = buildContractSummary(contract, { billings, sellerName: sellerId ? users[sellerId]?.name : undefined, contact });
  return {
    summary,
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
    expired: isContractExpired(contract),
    pendingRecurring: contract.status === "liberado" || contract.status === "pago" ? pendingRecurringInstallments(contract, billings, { horizonMonths: alertSettings.horizonteCobrancasMeses }).length : 0,
    amendments,
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
  /** Valores ocultos (A13): mensalidade zerada. */
  valuesHidden?: boolean;
}

export async function listSignatureQueue(options: FinanceReadOptions = {}): Promise<SignatureQueue> {
  const contracts = (await scoped(await list<Contract>(COLLECTIONS.contracts), options.scope)).filter((c) => c.status === "aguardando_assinatura" || c.status === "aguardando_contrato" || (c.status === "pendencia" && !allSigned(c)));
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
      monthlyTotal: options.hideValues ? 0 : c.monthlyTotal,
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
    ...(options.hideValues ? { valuesHidden: true } : {}),
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
  /** Situação do boleto: sem boleto · emitido · pago (D20). */
  boleto?: BoletoFilter;
}

export function parseBillingFilters(params: SearchParams): BillingFilters {
  const status = one(params, "status");
  const type = one(params, "tipo");
  const comp = one(params, "competencia");
  const boleto = one(params, "boleto");
  return {
    status: (BILLING_STATUSES as readonly string[]).includes(status ?? "") ? (status as Billing["status"]) : undefined,
    type: (BILLING_TYPES as readonly string[]).includes(type ?? "") ? (type as Billing["type"]) : undefined,
    competence: comp && /^\d{4}-\d{2}$/.test(comp) ? comp : undefined,
    clientId: one(params, "cliente"),
    contractId: one(params, "contrato"),
    boleto: (BOLETO_FILTERS as readonly string[]).includes(boleto ?? "") ? (boleto as BoletoFilter) : undefined,
  };
}

export interface BillingRow extends Billing {
  clientName: string;
  contractNumber: string;
  /** Dias de atraso (vencidas) ou até o vencimento (negativo = já venceu). */
  daysToDue: number;
  /** Situação do boleto (badge/filtro). */
  boletoState: BoletoFilter;
}

export interface BillingListResult {
  rows: BillingRow[];
  totals: { count: number; amount: number; open: number; overdue: number; paid: number };
  facets: { clients: Option[]; competences: Option[] };
  /** Valores ocultos (A13): quantias zeradas. */
  valuesHidden?: boolean;
}

export async function listBillings(filters: BillingFilters = {}, options: FinanceReadOptions = {}): Promise<BillingListResult> {
  const swept = await listBillingsSwept(filters.contractId ? { where: [["contractId", "==", filters.contractId]] } : {});
  // Escopo (A7): a cobrança herda os donos do contrato.
  const billings = options.scope ? filterBillingsByContracts(swept, await visibleContractIds(options.scope)) : swept;
  const [names, contracts] = await Promise.all([clientNames(billings.map((b) => b.clientId)), getManyByIds<Contract>(COLLECTIONS.contracts, billings.map((b) => b.contractId))]);
  const today = todayKey();
  const filtered = billings.filter(
    (b) =>
      (!filters.status || b.status === filters.status) &&
      (!filters.type || b.type === filters.type) &&
      (!filters.competence || b.competence === filters.competence) &&
      (!filters.clientId || b.clientId === filters.clientId) &&
      (!filters.boleto || boletoState(b) === filters.boleto),
  );
  const rank: Record<Billing["status"], number> = { vencida: 0, aberta: 1, paga: 2, cancelada: 3 };
  const rows: BillingRow[] = filtered
    .map((b) => (options.hideValues ? redactBilling(b) : b))
    .map((b) => ({ ...b, clientName: names.get(b.clientId) ?? b.clientId, contractNumber: contracts.get(b.contractId)?.number ?? "—", daysToDue: daysBetween(today, dateKey(b.dueDate)), boletoState: boletoState(b) }))
    .sort((a, b) => rank[a.status] - rank[b.status] || (a.status === "paga" || a.status === "cancelada" ? b.dueDate.localeCompare(a.dueDate) : a.dueDate.localeCompare(b.dueDate)));

  const sum = (items: Billing[]) => items.reduce((s, b) => s + b.amount, 0);
  const competences = Array.from(new Set(billings.map((b) => b.competence)))
    .sort()
    .reverse()
    .map((c) => ({ value: c, label: formatCompetence(c) }));
  const clients = Array.from(new Set(billings.map((b) => b.clientId)))
    .map((id) => ({ value: id, label: names.get(id) ?? id }))
    .sort((a, b) => a.label.localeCompare(b.label, "pt-BR"));
  const hide = options.hideValues;
  return {
    rows,
    totals: {
      count: filtered.length,
      amount: hide ? 0 : sum(filtered.filter((b) => b.status !== "cancelada")),
      open: hide ? 0 : sum(filtered.filter((b) => b.status === "aberta")),
      overdue: hide ? 0 : sum(filtered.filter((b) => b.status === "vencida")),
      paid: hide ? 0 : filtered.filter((b) => b.status === "paga").reduce((s, b) => s + (b.paidAmount ?? b.amount), 0),
    },
    facets: { clients, competences },
    ...(hide ? { valuesHidden: true } : {}),
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
  oldestOverdue?: Pick<Billing, "id" | "type" | "installment" | "amount" | "dueDate" | "status" | "boleto" | "pix" | "paymentUrl" | "externalId">;
  /** Boletos registrados/emitidos nas cobranças em aberto e vencidas do cliente. */
  boletoIssued: number;
  /** Cobranças em aberto/vencidas ainda sem boleto registrado. */
  boletoMissing: number;
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
  /** Valores ocultos (A13): quantias zeradas (contagens e dias ficam). */
  valuesHidden?: boolean;
}

export async function getReceivablesAging(options: FinanceReadOptions = {}): Promise<ReceivablesAging> {
  const swept = await listBillingsSwept();
  const billings = options.scope ? filterBillingsByContracts(swept, await visibleContractIds(options.scope)) : swept;
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
    const row = byClient.get(b.clientId) ?? { clientId: b.clientId, clientName: names.get(b.clientId) ?? b.clientId, open: 0, overdue: 0, overdueCount: 0, openCount: 0, oldestOverdueDays: 0, buckets: {}, boletoIssued: 0, boletoMissing: 0 };
    row.buckets[key] = (row.buckets[key] ?? 0) + b.amount;
    if (boletoState(b) === "sem_boleto") row.boletoMissing += 1;
    else row.boletoIssued += 1;
    if (b.status === "vencida") {
      row.overdue += b.amount;
      row.overdueCount += 1;
      row.oldestOverdueDays = Math.max(row.oldestOverdueDays, -daysBetween(today, dateKey(b.dueDate)));
      if (!row.oldestOverdue || b.dueDate < row.oldestOverdue.dueDate) row.oldestOverdue = { id: b.id, type: b.type, installment: b.installment, amount: b.amount, dueDate: b.dueDate, status: b.status, boleto: b.boleto, pix: b.pix, paymentUrl: b.paymentUrl, externalId: b.externalId };
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
  const aging: ReceivablesAging = { buckets, totalOpen, totalOverdue, totalToReceive: totalOpen + totalOverdue, byClient: clients, delinquents: clients.filter((c) => c.overdueCount > 0), monthly };
  return options.hideValues ? redactAging(aging) : aging;
}

/** Contas a Receber sem valores (A13): ordem, contagens, faixas e dias ficam; quantias saem. */
export function redactAging(a: ReceivablesAging): ReceivablesAging {
  const client = (c: ReceivableClient): ReceivableClient => ({
    ...c,
    open: 0,
    overdue: 0,
    buckets: Object.fromEntries(Object.keys(c.buckets).map((k) => [k, 0])),
    oldestOverdue: c.oldestOverdue ? redactBilling(c.oldestOverdue) : undefined,
  });
  return {
    buckets: a.buckets.map((b) => ({ ...b, amount: 0 })),
    totalOpen: 0,
    totalOverdue: 0,
    totalToReceive: 0,
    byClient: a.byClient.map(client),
    delinquents: a.delinquents.map(client),
    monthly: a.monthly.map((m) => ({ ...m, billed: 0, received: 0 })),
    valuesHidden: true,
  };
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
  /** Valores ocultos (A13): MRR e quantias zerados (contagens, datas e variações relativas ficam de fora também). */
  valuesHidden?: boolean;
}

export async function getRecurrenceMetrics(options: FinanceReadOptions = {}): Promise<RecurrenceMetrics> {
  const [allContracts, allChurn, goals] = await Promise.all([
    list<Contract>(COLLECTIONS.contracts),
    list<ChurnRecord>(COLLECTIONS.churnRecords),
    list<{ id: string; organizationId: string; createdAt: string; updatedAt: string; key: string; value: { mrrCrescimento?: number } }>(COLLECTIONS.settings, { where: [["key", "==", "metas_referencia"]] }),
  ]);
  // Escopo (A7): contratos pelos donos; churn pelos clientes dos contratos visíveis.
  const contracts = await scoped(allContracts, options.scope);
  const visibleClients = new Set(contracts.map((c) => c.clientId));
  const churn = options.scope && !isCompanyScope(options.scope) ? allChurn.filter((r) => visibleClients.has(r.clientId)) : allChurn;
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
    released
      .filter((c) => c.releasedAt! <= endIso && !(cancelledAt.has(c.id) && cancelledAt.get(c.id)! <= endIso) && !(c.status === "liberado" && c.endDate && dateKey(c.endDate) < dateKey(endIso)))
      .reduce((s, c) => s + c.monthlyTotal, 0);

  const months = Array.from({ length: 9 }, (_, i) => monthKey(i - 8));
  const points = months.map((m) => ({ month: m, label: formatCompetence(m), mrr: m === month ? mrrAt(new Date().toISOString()) : mrrAt(lastDayIso(m)) }));
  const history: MrrPoint[] = points.slice(1).map((p, i) => {
    const prev = points[i].mrr;
    return { ...p, growth: prev > 0 ? (p.mrr - prev) / prev : null };
  });

  // Vigência terminada sem renovação = fora do MRR (estado derivado; os vencidos seguem na lista de renovação).
  const active = contracts.filter((c) => c.status === "liberado" && !isContractExpired(c));
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
  const renewable = contracts.filter((c) => c.status === "liberado");
  const names = await clientNames(renewable.map((c) => c.clientId));
  const renewals: RenewalRow[] = renewable
    .filter((c) => c.endDate)
    .map((c) => ({ contractId: c.id, number: c.number, clientId: c.clientId, clientName: names.get(c.clientId) ?? c.clientId, endDate: c.endDate!, daysLeft: daysBetween(today, dateKey(c.endDate!)), monthlyTotal: c.monthlyTotal }))
    .sort((a, b) => a.endDate.localeCompare(b.endDate));

  const target = goals[0]?.value?.mrrCrescimento;
  const metrics: RecurrenceMetrics = {
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
  return options.hideValues ? redactRecurrence(metrics) : metrics;
}

/** Recorrência sem valores (A13): contagens, datas e produtos ficam; MRR, quantias e variações saem. */
export function redactRecurrence(m: RecurrenceMetrics): RecurrenceMetrics {
  return {
    ...m,
    mrr: 0,
    byProduct: m.byProduct.map((p) => ({ ...p, mrr: 0 })),
    newMrrMonth: 0,
    lostMrrMonth: 0,
    netNewMrr: 0,
    growthMonth: null,
    history: m.history.map((h) => ({ ...h, mrr: 0, growth: null })),
    renewals: m.renewals.map((r) => ({ ...r, monthlyTotal: 0 })),
    valuesHidden: true,
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
  /** Último pagamento identificado (data, valor pago e forma). */
  lastPayment?: { billingId: string; contractId: string; paidAt: string; amount: number; method?: string; type: Billing["type"]; installment?: number; competence: string };
  contracts: { id: string; number: string; status: Contract["status"]; monthlyTotal: number }[];
  /** Contrato ainda no Financeiro (não liberado nem cancelado), se houver. */
  pendingContract?: { id: string; number: string; status: Contract["status"]; pendingReason?: string };
  /** Contrato vigente: o liberado mais recente; sem liberado, o mais recente não cancelado (D7/D17). */
  currentContractId?: string;
  /** Valores ocultos ("Visualizar valores", A13): quantias zeradas; a ficha mostra "Restrito". */
  valuesHidden?: boolean;
}

/** Contrato vigente do cliente: o liberado mais recente; sem liberado, o mais recente ainda não cancelado. */
export function pickCurrentContract(contracts: Contract[]): Contract | undefined {
  const byRecency = (a: Contract, b: Contract) => (b.releasedAt ?? b.createdAt).localeCompare(a.releasedAt ?? a.createdAt);
  return [...contracts].filter((c) => c.status === "liberado").sort(byRecency)[0] ?? [...contracts].filter((c) => c.status !== "cancelado").sort((a, b) => b.createdAt.localeCompare(a.createdAt))[0];
}

/**
 * Resumo financeiro do cliente. Aceita contratos e cobranças já carregados (a ficha 360º lê ambos uma única vez,
 * com a varredura de vencidas aplicada); sem eles, lê do Financeiro.
 */
export async function getClientFinancialSummary(clientId: string, preloaded?: { contracts: Contract[]; billings: Billing[] }, options: { hideValues?: boolean } = {}): Promise<ClientFinancialSummary> {
  // Sem a opção explícita, vale o usuário da requisição (A13): sem "Visualizar valores" o resumo sai sem números.
  const hideValues = options.hideValues ?? (await viewerHidesValues());
  const summary = await buildClientFinancialSummary(clientId, preloaded);
  return hideValues ? redactClientFinancialSummary(summary) : summary;
}

/** O usuário da requisição NÃO tem "Visualizar valores"? Sem sessão (ou fora de requisição) → oculta (falha fechada). */
async function viewerHidesValues(): Promise<boolean> {
  try {
    const user = await getCurrentUser();
    return !user || !canSeeFinanceValues(user);
  } catch {
    return true;
  }
}

/** Resumo financeiro do cliente sem valores (A13): contagens, datas e contratos ficam; quantias saem. */
export function redactClientFinancialSummary(s: ClientFinancialSummary): ClientFinancialSummary {
  return {
    ...s,
    mrr: 0,
    openAmount: 0,
    overdueAmount: 0,
    paidLast12Months: 0,
    nextDue: s.nextDue ? { ...s.nextDue, amount: 0 } : undefined,
    lastPayment: s.lastPayment ? { ...s.lastPayment, amount: 0 } : undefined,
    contracts: s.contracts.map((c) => ({ ...c, monthlyTotal: 0 })),
    valuesHidden: true,
  };
}

async function buildClientFinancialSummary(clientId: string, preloaded?: { contracts: Contract[]; billings: Billing[] }): Promise<ClientFinancialSummary> {
  const [contracts, billings] = preloaded
    ? [preloaded.contracts, preloaded.billings]
    : await Promise.all([list<Contract>(COLLECTIONS.contracts, { where: [["clientId", "==", clientId]] }), listBillingsSwept({ where: [["clientId", "==", clientId]] })]);
  const today = todayKey();
  const yearAgo = dateKey(new Date(Date.now() - 365 * 86_400_000));
  const open = billings.filter((b) => b.status === "aberta");
  const overdue = billings.filter((b) => b.status === "vencida");
  const next = [...open].sort((a, b) => a.dueDate.localeCompare(b.dueDate)).find((b) => dateKey(b.dueDate) >= today);
  const paid = billings.filter((b) => b.status === "paga" && b.paidAt).sort((a, b) => b.paidAt!.localeCompare(a.paidAt!) || b.dueDate.localeCompare(a.dueDate));
  const last = paid[0];
  const pending = contracts.filter((c) => c.status !== "liberado" && c.status !== "cancelado").sort((a, b) => b.createdAt.localeCompare(a.createdAt))[0];
  return {
    mrr: contracts.filter((c) => c.status === "liberado" && !isContractExpired(c)).reduce((s, c) => s + c.monthlyTotal, 0),
    openAmount: open.reduce((s, b) => s + b.amount, 0),
    openCount: open.length,
    overdueAmount: overdue.reduce((s, b) => s + b.amount, 0),
    overdueCount: overdue.length,
    paidLast12Months: paid.filter((b) => dateKey(b.paidAt) >= yearAgo).reduce((s, b) => s + (b.paidAmount ?? b.amount), 0),
    nextDue: next ? { billingId: next.id, dueDate: next.dueDate, amount: next.amount, type: next.type } : undefined,
    lastPayment: last ? { billingId: last.id, contractId: last.contractId, paidAt: last.paidAt!, amount: last.paidAmount ?? last.amount, method: last.method, type: last.type, installment: last.installment, competence: last.competence } : undefined,
    contracts: [...contracts].sort((a, b) => b.createdAt.localeCompare(a.createdAt)).map((c) => ({ id: c.id, number: c.number, status: c.status, monthlyTotal: c.monthlyTotal })),
    pendingContract: pending ? { id: pending.id, number: pending.number, status: pending.status, pendingReason: pending.pendingReason } : undefined,
    currentContractId: pickCurrentContract(contracts)?.id,
  };
}
