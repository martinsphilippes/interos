import "server-only";
/**
 * Leituras das telas do Financeiro › Comissões, Regras e Contas a Pagar. O escopo de visibilidade (D15) é resolvido
 * AQUI, no servidor: financeiro/admin/diretoria veem tudo; gestor, a equipe (getPerformanceAccess); vendedor, só o que
 * é dele. Todo número exibido sai dos documentos do motor (nada calculado só na tela).
 */
import { getById, getManyByIds, list } from "@/server/db";
import { getPerformanceAccess } from "@/server/performance/queries";
import { dateKey } from "@/lib/format";
import { PRODUCT_CATEGORY_LABELS } from "@/domain/constants";
import {
  COMMISSION_REVENUE_LABELS,
  COMMISSION_STATUS_LABELS,
  COMMISSION_STATUSES,
  PAYABLE_STATUSES,
  commissionSlotLabel,
} from "@/domain/commissions";
import {
  COLLECTIONS,
  type Billing,
  type Client,
  type Commission,
  type CommissionCalcStep,
  type CommissionRule,
  type CommissionRuleSnapshot,
  type CommissionStatus,
  type Contract,
  type CurrentUser,
  type DomainEvent,
  type Payable,
  type PayableHistoryEntry,
  type PayableStatus,
  type Product,
  type User,
} from "@/domain/types";
import { getCommissionPaymentSettings } from "./payables";
import {
  canApprovePayables,
  canManageCommissionRules,
  canOperatePayables,
  canPayPayables,
  canReverseCommission,
  canViewAllCommissions,
  canViewCommissionRules,
  canViewPayables,
  commissionScopeFor,
  scopeAllows,
  type CommissionScope,
} from "./permissions";
import { describeSnapshot, isLegacyRule, ruleScope, snapshotRule } from "./rules";

type SearchParams = Record<string, string | string[] | undefined>;
const first = (v: string | string[] | undefined) => (Array.isArray(v) ? v[0] : v)?.trim() || undefined;
const MONTH = /^\d{4}-(0[1-9]|1[0-2])$/;

/** Escopo de comissões do usuário (D15). */
export async function resolveCommissionScope(viewer: CurrentUser): Promise<CommissionScope> {
  if (canViewAllCommissions(viewer)) return { kind: "all" };
  if (!viewer.isManager) return { kind: "own", userIds: [viewer.id] };
  const access = await getPerformanceAccess(viewer);
  return commissionScopeFor(viewer, access.userIds);
}

async function commissionsInScope(scope: CommissionScope): Promise<Commission[]> {
  if (scope.kind === "all") return list<Commission>(COLLECTIONS.commissions);
  return list<Commission>(COLLECTIONS.commissions, { where: [["userId", "in", scope.userIds]] });
}

// ---------------------------------------------------------------------------
// Comissões
// ---------------------------------------------------------------------------

export interface CommissionFilters {
  vendedor?: string;
  status?: CommissionStatus;
  competencia?: string;
  cliente?: string;
  contrato?: string;
}

export function parseCommissionFilters(sp: SearchParams): CommissionFilters {
  const status = first(sp.status);
  const comp = first(sp.competencia);
  return {
    vendedor: first(sp.vendedor),
    status: status && (COMMISSION_STATUSES as string[]).includes(status) ? (status as CommissionStatus) : undefined,
    competencia: comp && MONTH.test(comp) ? comp : undefined,
    cliente: first(sp.cliente),
    contrato: first(sp.contrato),
  };
}

export interface CommissionRow {
  id: string;
  code: string;
  userId: string;
  userName: string;
  clientId: string;
  clientName: string;
  contractId?: string;
  contractNumber?: string;
  saleNumber?: string;
  opportunityId?: string;
  productName: string;
  revenueType: Commission["revenueType"];
  slotLabel: string;
  baseAmount: number;
  amount: number;
  competence: string;
  status: CommissionStatus;
  eligibleAt?: string;
  payableId?: string;
  payableCode?: string;
  ruleName?: string;
  createdAt: string;
  /** Previsão (D27): vencimento da cobrança que adquire a comissão (N-ésima mensalidade ou a parcela aguardada). */
  expectedAt?: string;
  /** Texto da previsão: "vencimento da 3ª mensalidade". */
  expectedLabel?: string;
}

export interface TraceLink {
  key: string;
  label: string;
  value: string;
  href?: string;
}

export interface HistoryItem {
  id: string;
  at: string;
  title: string;
  subtitle?: string;
  by?: string;
  tone: "neutral" | "success" | "warning" | "danger" | "info" | "brand";
}

export interface CommissionDetail extends CommissionRow {
  steps: CommissionCalcStep[];
  formula?: string;
  ruleText?: string;
  rule?: CommissionRuleSnapshot;
  legacy: boolean;
  trace: TraceLink[];
  history: HistoryItem[];
  cancelReason?: string;
  blockedReason?: string;
  reverseReason?: string;
  reversalPayableId?: string;
  canRegeneratePayable: boolean;
}

export interface CountAmount {
  count: number;
  amount: number;
}

export interface CommissionsWorkspace {
  scope: CommissionScope["kind"];
  kpis: Record<"prevista" | "em_carencia" | "aguardando_recebimento" | "liberada" | "titulo_gerado" | "paga" | "bloqueada" | "void", CountAmount>;
  rows: CommissionRow[];
  total: number;
  facets: { sellers: Opt[]; clients: Opt[]; contracts: Opt[]; competences: Opt[] };
  selected: CommissionDetail | null;
  can: { reverse: boolean; viewPayables: boolean; viewRules: boolean };
}

interface Opt {
  value: string;
  label: string;
}

const round2 = (n: number) => Math.round(n * 100) / 100;
const competenceLabel = (c: string) => {
  const [y, m] = c.split("-");
  return `${m}/${y}`;
};

function toRow(c: Commission, users: Map<string, User>, clients: Map<string, Client>, contracts: Map<string, Contract>, payables: Map<string, Payable>): CommissionRow {
  const contract = c.contractId ? contracts.get(c.contractId) : undefined;
  return {
    id: c.id,
    code: c.code ?? c.id,
    userId: c.userId,
    userName: users.get(c.userId)?.name ?? "—",
    clientId: c.clientId,
    clientName: clients.get(c.clientId)?.tradeName ?? "—",
    contractId: c.contractId,
    contractNumber: contract?.number,
    saleNumber: c.saleNumber ?? contract?.saleNumber,
    opportunityId: c.opportunityId,
    productName: c.productName ?? contract?.items.find((i) => i.productId === c.productId)?.productName ?? "—",
    revenueType: c.revenueType,
    slotLabel: commissionSlotLabel(c.slot, c.revenueType, contract?.setupInstallments),
    baseAmount: c.baseAmount,
    amount: c.amount,
    competence: c.competence,
    status: c.status,
    eligibleAt: c.eligibleAt ?? (c.status === "liberada" || c.status === "paga" ? c.releaseAt : undefined),
    payableId: c.payableId,
    payableCode: c.payableId ? (payables.get(c.payableId)?.code ?? c.payableId) : undefined,
    ruleName: c.ruleSnapshot?.name,
    createdAt: c.createdAt,
    expectedAt: c.expectedAt,
    expectedLabel: expectedLabelOf(c),
  };
}

/** "vencimento da 3ª mensalidade" (gatilho mensalidade_n) ou "vencimento da parcela" (demais, quando há previsão). */
function expectedLabelOf(c: Pick<Commission, "expectedAt" | "ruleSnapshot" | "slot" | "revenueType">): string | undefined {
  if (!c.expectedAt) return undefined;
  if (c.ruleSnapshot?.trigger === "mensalidade_n") return `vencimento da ${c.ruleSnapshot.releaseInstallment}ª mensalidade`;
  if (c.revenueType === "recorrencia" && c.slot?.startsWith("m")) return `vencimento da ${c.slot.slice(1)}ª mensalidade`;
  return "vencimento da cobrança";
}

const STATUS_TONE: Record<CommissionStatus, HistoryItem["tone"]> = {
  prevista: "neutral",
  em_carencia: "info",
  aguardando_recebimento: "warning",
  liberada: "brand",
  titulo_gerado: "info",
  paga: "success",
  bloqueada: "danger",
  cancelada: "neutral",
  estornada: "danger",
};

export async function getCommissionsWorkspace(viewer: CurrentUser, filters: CommissionFilters, selectedId?: string): Promise<CommissionsWorkspace> {
  const scope = await resolveCommissionScope(viewer);
  const all = await commissionsInScope(scope);
  const [users, clients, contracts, payables] = await Promise.all([
    getManyByIds<User>(COLLECTIONS.users, all.map((c) => c.userId)),
    getManyByIds<Client>(COLLECTIONS.clients, all.map((c) => c.clientId)),
    getManyByIds<Contract>(COLLECTIONS.contracts, all.map((c) => c.contractId ?? "")),
    getManyByIds<Payable>(COLLECTIONS.payables, all.map((c) => c.payableId ?? "")),
  ]);
  const rowsAll = all.map((c) => toRow(c, users, clients, contracts, payables));

  const kpis: CommissionsWorkspace["kpis"] = { prevista: z(), em_carencia: z(), aguardando_recebimento: z(), liberada: z(), titulo_gerado: z(), paga: z(), bloqueada: z(), void: z() };
  // KPIs respeitam os filtros de vendedor/competência/cliente/contrato (não o de status: cada card é um status).
  const base = rowsAll.filter((r) => (!filters.vendedor || r.userId === filters.vendedor) && (!filters.competencia || r.competence === filters.competencia) && (!filters.cliente || r.clientId === filters.cliente) && (!filters.contrato || r.contractId === filters.contrato));
  for (const r of base) {
    const k = r.status === "cancelada" || r.status === "estornada" ? "void" : r.status;
    kpis[k].count++;
    kpis[k].amount = round2(kpis[k].amount + r.amount);
  }
  // Sem filtro de situação, canceladas e estornadas ficam fora da lista (continuam nos KPIs e no filtro).
  const rows = base
    .filter((r) => (filters.status ? r.status === filters.status : r.status !== "cancelada" && r.status !== "estornada"))
    .sort((a, b) => b.competence.localeCompare(a.competence) || b.createdAt.localeCompare(a.createdAt) || a.code.localeCompare(b.code));

  const opt = (entries: [string, string][]) => Array.from(new Map(entries).entries()).map(([value, label]) => ({ value, label })).sort((a, b) => a.label.localeCompare(b.label, "pt-BR"));
  const facets = {
    sellers: scope.kind === "own" ? [] : opt(rowsAll.map((r) => [r.userId, r.userName])),
    clients: opt(rowsAll.map((r) => [r.clientId, r.clientName])),
    contracts: opt(rowsAll.filter((r) => r.contractId).map((r) => [r.contractId!, `${r.contractNumber ?? r.contractId} · ${r.clientName}`])),
    competences: Array.from(new Set(rowsAll.map((r) => r.competence)))
      .sort()
      .reverse()
      .map((c) => ({ value: c, label: competenceLabel(c) })),
  };

  const can = { reverse: canReverseCommission(viewer), viewPayables: canViewPayables(viewer), viewRules: canViewCommissionRules(viewer) };
  const chosen = selectedId ? all.find((c) => c.id === selectedId) : undefined;
  const selected = chosen && scopeAllows(scope, chosen.userId) ? await commissionDetail(chosen, toRow(chosen, users, clients, contracts, payables), contracts, payables, can) : null;
  return { scope: scope.kind, kpis, rows, total: rowsAll.length, facets, selected, can };
}

const z = (): CountAmount => ({ count: 0, amount: 0 });

// ---------------------------------------------------------------------------
// "Minhas comissões" (Meu Desempenho, D17): item a item, com data provável e link para a memória
// ---------------------------------------------------------------------------

export interface UserCommissionRow extends CommissionRow {
  /** Data provável/efetiva relevante para a situação (elegibilidade, pagamento previsto do título, pagamento). */
  whenAt?: string;
  /** "Elegível em", "Pagamento previsto", "Paga em", "Previsão"… */
  whenLabel: string;
  /** Link para a memória de cálculo em Financeiro › Comissões (quem tem acesso à tela). */
  href?: string;
}

export interface UserCommissionsDigest {
  userId: string;
  rows: UserCommissionRow[];
  total: number;
  /** Totais por grupo de situação (valores do motor, não recalculados na tela). */
  totals: { previstas: CountAmount; em_carencia: CountAmount; aguardando_recebimento: CountAmount; elegiveis: CountAmount; a_pagar: CountAmount; pagas: CountAmount };
  /** Link para a tela de comissões com o filtro do vendedor (ou "Minhas comissões"). */
  href: string;
}

const WHEN_LABEL: Record<CommissionStatus, string> = {
  prevista: "Previsão",
  em_carencia: "Elegível em",
  aguardando_recebimento: "Aguardando cobrança de",
  liberada: "Elegível desde",
  titulo_gerado: "Pagamento previsto",
  paga: "Paga em",
  bloqueada: "Bloqueada",
  cancelada: "Cancelada em",
  estornada: "Estornada em",
};

/**
 * Comissões de um colaborador para o Meu Desempenho. O escopo D15 vale aqui também: devolve null quando o visitante
 * não pode ver as comissões desse usuário (vendedor só vê as próprias; gestor, a equipe; financeiro, todas).
 */
export async function getUserCommissionsDigest(viewer: CurrentUser, userId: string, options: { canOpenFinance: boolean; limit?: number } = { canOpenFinance: false }): Promise<UserCommissionsDigest | null> {
  const scope = await resolveCommissionScope(viewer);
  if (!scopeAllows(scope, userId)) return null;
  const all = await list<Commission>(COLLECTIONS.commissions, { where: [["userId", "==", userId]] });
  const [users, clients, contracts, payables, billings] = await Promise.all([
    getManyByIds<User>(COLLECTIONS.users, [userId]),
    getManyByIds<Client>(COLLECTIONS.clients, all.map((c) => c.clientId)),
    getManyByIds<Contract>(COLLECTIONS.contracts, all.map((c) => c.contractId ?? "")),
    getManyByIds<Payable>(COLLECTIONS.payables, all.map((c) => c.payableId ?? "")),
    getManyByIds<Billing>(COLLECTIONS.billing, all.filter((c) => c.status === "prevista" || c.status === "aguardando_recebimento").map((c) => c.billingId ?? "")),
  ]);
  const totals: UserCommissionsDigest["totals"] = { previstas: z(), em_carencia: z(), aguardando_recebimento: z(), elegiveis: z(), a_pagar: z(), pagas: z() };
  const bucket = (s: CommissionStatus): keyof UserCommissionsDigest["totals"] | null =>
    s === "prevista" ? "previstas" : s === "em_carencia" ? "em_carencia" : s === "aguardando_recebimento" ? "aguardando_recebimento" : s === "liberada" ? "elegiveis" : s === "titulo_gerado" ? "a_pagar" : s === "paga" ? "pagas" : null;
  const rows: UserCommissionRow[] = [];
  for (const c of all) {
    const k = bucket(c.status);
    if (k) {
      totals[k].count++;
      totals[k].amount = round2(totals[k].amount + c.amount);
    }
    if (c.status === "cancelada" || c.status === "estornada") continue;
    const row = toRow(c, users, clients, contracts, payables);
    const payable = c.payableId ? payables.get(c.payableId) : undefined;
    const billing = c.billingId ? billings.get(c.billingId) : undefined;
    // Previsão (D27): para prevista/aguardando, o vencimento da cobrança que adquire a comissão (3ª mensalidade,
    // parcela aguardada); não mais a adesão.
    const whenAt =
      c.status === "paga"
        ? (c.paidAt ?? payable?.paidAt)
        : c.status === "titulo_gerado"
          ? payable?.dueDate
          : c.status === "prevista" || c.status === "aguardando_recebimento"
            ? (c.expectedAt ?? c.eligibleAt ?? billing?.dueDate)
            : (c.eligibleAt ?? c.releaseAt);
    const whenLabel = (c.status === "prevista" || c.status === "aguardando_recebimento") && row.expectedLabel ? `${WHEN_LABEL[c.status]} (${row.expectedLabel})` : WHEN_LABEL[c.status];
    rows.push({ ...row, whenAt, whenLabel, href: options.canOpenFinance ? `/financeiro/comissoes?comissao=${c.id}` : undefined });
  }
  const order: Record<CommissionStatus, number> = { liberada: 0, titulo_gerado: 1, aguardando_recebimento: 2, em_carencia: 3, prevista: 4, paga: 5, bloqueada: 6, cancelada: 7, estornada: 8 };
  rows.sort((a, b) => order[a.status] - order[b.status] || (b.whenAt ?? "").localeCompare(a.whenAt ?? "") || b.competence.localeCompare(a.competence));
  const limit = options.limit ?? 12;
  return {
    userId,
    rows: rows.slice(0, limit),
    total: rows.length,
    totals,
    href: scope.kind === "own" ? "/financeiro/comissoes" : `/financeiro/comissoes?vendedor=${userId}`,
  };
}

async function commissionDetail(c: Commission, row: CommissionRow, contracts: Map<string, Contract>, payables: Map<string, Payable>, can: CommissionsWorkspace["can"]): Promise<CommissionDetail> {
  const [billing, eventsByEntity, eventsByPayload, reversal] = await Promise.all([
    c.billingId ? getById<Billing>(COLLECTIONS.billing, c.billingId) : Promise.resolve(null),
    list<DomainEvent>(COLLECTIONS.events, { where: [["entityId", "==", c.id]] }),
    list<DomainEvent>(COLLECTIONS.events, { where: [["payload.commissionIds", "array-contains", c.id]] }),
    c.reversalPayableId ? getById<Payable>(COLLECTIONS.payables, c.reversalPayableId) : Promise.resolve(null),
  ]);
  const contract = c.contractId ? contracts.get(c.contractId) : undefined;
  const payable = c.payableId ? payables.get(c.payableId) : undefined;
  const rule = c.ruleSnapshot;
  const trace: TraceLink[] = [];
  if (row.saleNumber || c.opportunityId) trace.push({ key: "venda", label: "Venda", value: row.saleNumber ?? "Oportunidade", href: c.opportunityId ? `/vendas/oportunidades?oportunidade=${c.opportunityId}` : undefined });
  if (contract) trace.push({ key: "contrato", label: "Contrato", value: contract.number, href: `/financeiro/contratos/${contract.id}` });
  if (billing) {
    const kind = { setup: "Adesão", mensalidade: "Mensalidade", hardware: "Hardware", servico: "Serviço" }[billing.type];
    const state = billing.status === "paga" ? `paga em ${dateKey(billing.paidAt ?? billing.dueDate).split("-").reverse().join("/")}` : billing.status;
    trace.push({ key: "cobranca", label: "Recebimento", value: `${kind}${billing.installment ? ` ${billing.installment}` : ""} · ${state}`, href: `/financeiro/cobrancas?cliente=${billing.clientId}&competencia=${billing.competence}&tipo=${billing.type}` });
  }
  if (rule) trace.push({ key: "regra", label: "Regra", value: rule.name, href: can.viewRules && rule.source === "regra" ? `/financeiro/comissoes/regras?regra=${rule.id}` : undefined });
  trace.push({ key: "comissao", label: "Comissão", value: row.code });
  if (payable) trace.push({ key: "titulo", label: "Título", value: payable.code ?? payable.id, href: can.viewPayables ? `/financeiro/contas-a-pagar?titulo=${payable.id}` : undefined });
  if (reversal) trace.push({ key: "estorno", label: "Estorno", value: reversal.code ?? reversal.id, href: can.viewPayables ? `/financeiro/contas-a-pagar?titulo=${reversal.id}` : undefined });

  const history: HistoryItem[] = (c.history ?? []).map((h, i) => ({
    id: `h${i}`,
    at: h.at,
    title: h.from ? `${COMMISSION_STATUS_LABELS[h.from]} → ${COMMISSION_STATUS_LABELS[h.to]}` : COMMISSION_STATUS_LABELS[h.to],
    subtitle: h.note,
    by: h.byName,
    tone: STATUS_TONE[h.to],
  }));
  const events = new Map<string, DomainEvent>();
  for (const e of [...eventsByEntity, ...eventsByPayload]) events.set(e.id, e);
  for (const e of events.values()) {
    if (!e.type.startsWith("commission") && !e.type.startsWith("payable")) continue;
    history.push({ id: e.id, at: e.occurredAt, title: e.title, subtitle: e.description, by: e.actorName, tone: e.type.endsWith("reversed") || e.type.endsWith("cancelled") ? "danger" : e.type.endsWith("paid") ? "success" : "info" });
  }
  history.sort((a, b) => b.at.localeCompare(a.at));

  return {
    ...row,
    steps: c.calc?.steps ?? legacySteps(c),
    formula: c.calc?.formula,
    rule,
    ruleText: rule ? describeSnapshot(rule) : undefined,
    legacy: !c.sourceKey,
    trace,
    history,
    cancelReason: c.cancelReason,
    blockedReason: c.blockedReason,
    reverseReason: c.reverseReason,
    reversalPayableId: c.reversalPayableId,
    canRegeneratePayable: c.status === "liberada" && !c.payableId,
  };
}

/** Comissões do motor v1 não têm memória gravada: mostra o que o documento permite reconstituir. */
function legacySteps(c: Commission): CommissionCalcStep[] {
  return [
    { label: "Origem", value: "Calculada pelo motor anterior (antes da memória de cálculo)" },
    { label: "Base", value: `R$ ${c.baseAmount.toFixed(2).replace(".", ",")} (${COMMISSION_REVENUE_LABELS[c.revenueType].toLowerCase()})` },
    { label: "Valor", value: `R$ ${c.amount.toFixed(2).replace(".", ",")}` },
  ];
}

// ---------------------------------------------------------------------------
// Regras
// ---------------------------------------------------------------------------

export interface RuleRow {
  id: string;
  name: string;
  scope: "padrao" | "vendedor" | "contrato";
  revenueType: CommissionRule["revenueType"];
  target: string;
  productLabel?: string;
  description: string;
  validity?: string;
  overridesDefault: boolean;
  active: boolean;
  reason?: string;
  legacy: boolean;
  updatedAt: string;
  updatedBy?: string;
  /** Valores do formulário de edição. */
  form: {
    id: string;
    name: string;
    scope: "padrao" | "vendedor" | "contrato";
    userId?: string;
    contractId?: string;
    revenueType: CommissionRule["revenueType"];
    productId?: string;
    productCategory?: string;
    mode: CommissionRule["mode"];
    value: number;
    trigger: CommissionRuleSnapshot["trigger"];
    baseSource: CommissionRuleSnapshot["baseSource"];
    minTenureDays: number;
    recurringCompetences: number | null;
    releaseInstallment: number;
    validFrom?: string;
    validTo?: string;
    overridesDefault: boolean;
    reason?: string;
    active: boolean;
  };
  commissions: number;
}

export interface RulesWorkspace {
  rules: RuleRow[];
  productDefaults: { id: string; name: string; setupPct: number; recurringPct: number; hardwarePct: number; recurringReleaseInstallment: number }[];
  history: HistoryItem[];
  options: { sellers: Opt[]; contracts: Opt[]; products: Opt[]; categories: Opt[] };
  paymentDay: number;
  canManage: boolean;
  selectedId?: string;
}

export async function getRulesWorkspace(viewer: CurrentUser, selectedId?: string): Promise<RulesWorkspace> {
  const [rules, users, contracts, products, events, commissions, settings] = await Promise.all([
    list<CommissionRule>(COLLECTIONS.commissionRules),
    list<User>(COLLECTIONS.users),
    list<Contract>(COLLECTIONS.contracts),
    list<Product>(COLLECTIONS.products),
    list<DomainEvent>(COLLECTIONS.events, { where: [["type", "==", "commission_rule.changed"]] }),
    list<Commission>(COLLECTIONS.commissions),
    getCommissionPaymentSettings(),
  ]);
  const userById = new Map(users.map((u) => [u.id, u]));
  const contractById = new Map(contracts.map((c) => [c.id, c]));
  const productById = new Map(products.map((p) => [p.id, p]));
  const clientIds = contracts.map((c) => c.clientId);
  const clients = await getManyByIds<Client>(COLLECTIONS.clients, clientIds);
  const usage = new Map<string, number>();
  for (const c of commissions) if (c.ruleId) usage.set(c.ruleId, (usage.get(c.ruleId) ?? 0) + 1);

  const rows: RuleRow[] = rules.map((r) => {
    const snap = snapshotRule(r);
    const scope = ruleScope(r);
    const contract = r.contractId ? contractById.get(r.contractId) : undefined;
    const target =
      scope === "contrato"
        ? `${contract?.number ?? r.contractId} · ${contract ? (clients.get(contract.clientId)?.tradeName ?? "") : ""}`
        : scope === "vendedor"
          ? (userById.get(r.userId ?? "")?.name ?? "Vendedor")
          : "Todos os vendedores";
    const productLabel = r.productId ? productById.get(r.productId)?.name : r.productCategory ? `Categoria ${PRODUCT_CATEGORY_LABELS[r.productCategory] ?? r.productCategory}` : undefined;
    const validity = r.validFrom || r.validTo ? `${r.validFrom ? `de ${r.validFrom.split("-").reverse().join("/")}` : ""}${r.validTo ? ` até ${r.validTo.split("-").reverse().join("/")}` : ""}`.trim() : undefined;
    return {
      id: r.id,
      name: r.name,
      scope,
      revenueType: r.revenueType,
      target,
      productLabel,
      description: describeSnapshot(snap),
      validity,
      overridesDefault: snap.overridesDefault,
      active: r.active,
      reason: r.reason,
      legacy: isLegacyRule(r),
      updatedAt: r.updatedAt,
      updatedBy: r.updatedBy ? userById.get(r.updatedBy)?.name : undefined,
      form: {
        id: r.id,
        name: r.name,
        scope,
        userId: r.userId,
        contractId: r.contractId,
        revenueType: r.revenueType,
        productId: r.productId,
        productCategory: r.productCategory,
        mode: r.mode,
        value: r.value,
        trigger: snap.trigger,
        baseSource: snap.baseSource,
        minTenureDays: snap.minTenureDays,
        recurringCompetences: snap.recurringCompetences,
        releaseInstallment: snap.releaseInstallment,
        validFrom: r.validFrom,
        validTo: r.validTo,
        overridesDefault: snap.overridesDefault,
        reason: r.reason,
        active: r.active,
      },
      commissions: usage.get(r.id) ?? 0,
    };
  });
  const scopeOrder = { contrato: 0, vendedor: 1, padrao: 2 } as const;
  rows.sort((a, b) => scopeOrder[a.scope] - scopeOrder[b.scope] || Number(b.active) - Number(a.active) || a.name.localeCompare(b.name, "pt-BR"));

  const history: HistoryItem[] = events
    .sort((a, b) => b.occurredAt.localeCompare(a.occurredAt))
    .slice(0, 40)
    .map((e) => ({ id: e.id, at: e.occurredAt, title: e.title, subtitle: e.description, by: e.actorName, tone: e.payload.action === "deactivated" ? "danger" : e.payload.action === "created" ? "success" : "info" }));

  const sellers = users.filter((u) => u.active !== false && (u.departmentId === "vendas" || u.role === "vendas")).map((u) => ({ value: u.id, label: u.name }));
  const contractOpts = contracts
    .filter((c) => c.status !== "cancelado" && (c.sellerId || c.opportunityId))
    .map((c) => ({ value: c.id, label: `${c.number} · ${clients.get(c.clientId)?.tradeName ?? ""}` }))
    .sort((a, b) => b.label.localeCompare(a.label, "pt-BR"));
  return {
    rules: rows,
    productDefaults: products
      .filter((p) => p.active)
      .sort((a, b) => a.order - b.order)
      .map((p) => ({ id: p.id, name: p.name, setupPct: p.commission?.setupPct ?? 0, recurringPct: p.commission?.recurringPct ?? 0, hardwarePct: p.commission?.hardwarePct ?? 0, recurringReleaseInstallment: p.commission?.recurringReleaseInstallment ?? 3 })),
    history,
    options: {
      sellers: sellers.sort((a, b) => a.label.localeCompare(b.label, "pt-BR")),
      contracts: contractOpts,
      products: products.filter((p) => p.active).map((p) => ({ value: p.id, label: p.name })),
      categories: Object.entries(PRODUCT_CATEGORY_LABELS).map(([value, label]) => ({ value, label })),
    },
    paymentDay: settings.diaPagamento,
    canManage: canManageCommissionRules(viewer),
    selectedId,
  };
}

// ---------------------------------------------------------------------------
// Contas a pagar
// ---------------------------------------------------------------------------

export interface PayableFilters {
  status?: PayableStatus;
  categoria?: Payable["category"];
  credor?: string;
  competencia?: string;
  vencimento?: "vencidos" | "7dias" | "mes" | "proximo_mes";
}

export function parsePayableFilters(sp: SearchParams): PayableFilters {
  const status = first(sp.status);
  const categoria = first(sp.categoria);
  const comp = first(sp.competencia);
  const venc = first(sp.vencimento);
  return {
    status: status && (PAYABLE_STATUSES as string[]).includes(status) ? (status as PayableStatus) : undefined,
    categoria: categoria && /^[a-z0-9_]{2,40}$/.test(categoria) ? (categoria as Payable["category"]) : undefined,
    credor: first(sp.credor),
    competencia: comp && MONTH.test(comp) ? comp : undefined,
    vencimento: venc === "vencidos" || venc === "7dias" || venc === "mes" || venc === "proximo_mes" ? venc : undefined,
  };
}

export interface PayableRow {
  id: string;
  code: string;
  creditorName: string;
  creditorId?: string;
  category: Payable["category"];
  origin: Payable["origin"];
  description: string;
  amount: number;
  competence: string;
  dueDate: string;
  status: PayableStatus;
  overdue: boolean;
  paidAt?: string;
}

export interface PayableDetail extends PayableRow {
  trace: TraceLink[];
  history: HistoryItem[];
  commission?: { id: string; code: string; status: CommissionStatus; steps: CommissionCalcStep[]; ruleText?: string };
  paymentMethod?: string;
  receiptUrl?: string;
  notes?: string;
  cancelReason?: string;
  approvedBy?: string;
  approvedAt?: string;
  scheduledAt?: string;
}

export interface PayablesWorkspace {
  kpis: { previsto: CountAmount; aprovado: CountAmount; a_pagar: CountAmount; vencidos: CountAmount; pagosMes: CountAmount };
  rows: PayableRow[];
  total: number;
  facets: { creditors: Opt[]; competences: Opt[] };
  selected: PayableDetail | null;
  can: { approve: boolean; pay: boolean; operate: boolean; readOnly: boolean };
  users: Opt[];
}

function isOverduePayable(p: Pick<Payable, "status" | "dueDate">, today: string): boolean {
  return (p.status === "previsto" || p.status === "aprovado" || p.status === "a_pagar") && dateKey(p.dueDate) < today;
}

function addMonthsKey(comp: string, n: number): string {
  const [y, m] = comp.split("-").map(Number);
  return new Date(Date.UTC(y, m - 1 + n, 1)).toISOString().slice(0, 7);
}

export async function getPayablesWorkspace(viewer: CurrentUser, filters: PayableFilters, selectedId?: string): Promise<PayablesWorkspace> {
  const full = canViewAllCommissions(viewer);
  const scope = await resolveCommissionScope(viewer);
  const all = (await list<Payable>(COLLECTIONS.payables)).filter((p) => full || (p.creditorId && scopeAllows(scope, p.creditorId)));
  const today = dateKey(new Date());
  const month = today.slice(0, 7);
  const toRow = (p: Payable): PayableRow => ({
    id: p.id,
    code: p.code ?? p.id,
    creditorName: p.creditorName,
    creditorId: p.creditorId,
    category: p.category,
    origin: p.origin,
    description: p.description,
    amount: p.amount,
    competence: p.competence,
    dueDate: p.dueDate,
    status: p.status,
    overdue: isOverduePayable(p, today),
    paidAt: p.paidAt,
  });
  const rowsAll = all.map(toRow);
  const kpis = { previsto: z(), aprovado: z(), a_pagar: z(), vencidos: z(), pagosMes: z() };
  const add = (k: keyof typeof kpis, r: PayableRow) => {
    kpis[k].count++;
    kpis[k].amount = round2(kpis[k].amount + r.amount);
  };
  for (const r of rowsAll) {
    if (r.status === "previsto") add("previsto", r);
    if (r.status === "aprovado") add("aprovado", r);
    if (r.status === "a_pagar") add("a_pagar", r);
    if (r.overdue) add("vencidos", r);
    if (r.status === "pago" && r.paidAt && dateKey(r.paidAt).slice(0, 7) === month) add("pagosMes", r);
  }
  const in7 = new Date(Date.parse(`${today}T12:00:00Z`) + 7 * 86_400_000).toISOString().slice(0, 10);
  const rows = rowsAll
    .filter((r) => !filters.status || r.status === filters.status)
    .filter((r) => !filters.categoria || r.category === filters.categoria)
    .filter((r) => !filters.credor || r.creditorId === filters.credor || r.creditorName === filters.credor)
    .filter((r) => !filters.competencia || r.competence === filters.competencia)
    .filter((r) => {
      if (!filters.vencimento) return true;
      const due = dateKey(r.dueDate);
      if (filters.vencimento === "vencidos") return r.overdue;
      if (r.status === "pago" || r.status === "cancelado") return false;
      if (filters.vencimento === "7dias") return due >= today && due <= in7;
      if (filters.vencimento === "mes") return due.slice(0, 7) === month;
      return due.slice(0, 7) === addMonthsKey(month, 1);
    })
    .sort((a, b) => Number(b.overdue) - Number(a.overdue) || a.dueDate.localeCompare(b.dueDate) || a.code.localeCompare(b.code));

  const creditors = Array.from(new Map(rowsAll.map((r) => [r.creditorId ?? r.creditorName, r.creditorName])).entries())
    .map(([value, label]) => ({ value, label }))
    .sort((a, b) => a.label.localeCompare(b.label, "pt-BR"));
  const competences = Array.from(new Set(rowsAll.map((r) => r.competence)))
    .sort()
    .reverse()
    .map((c) => ({ value: c, label: competenceLabel(c) }));

  const chosen = selectedId ? all.find((p) => p.id === selectedId) : undefined;
  const selected = chosen ? await payableDetail(chosen, toRow(chosen)) : null;
  const operate = canOperatePayables(viewer);
  const users = operate ? (await list<User>(COLLECTIONS.users)).filter((u) => u.active !== false).map((u) => ({ value: u.id, label: u.name })).sort((a, b) => a.label.localeCompare(b.label, "pt-BR")) : [];
  return {
    kpis,
    rows,
    total: rowsAll.length,
    facets: { creditors, competences },
    selected,
    can: { approve: canApprovePayables(viewer), pay: canPayPayables(viewer), operate, readOnly: !operate },
    users,
  };
}

async function payableDetail(p: Payable, row: PayableRow): Promise<PayableDetail> {
  const commissionId = p.sourceIds.commissionIds?.[0];
  const [commission, contract, billing, events, approver] = await Promise.all([
    commissionId ? getById<Commission>(COLLECTIONS.commissions, commissionId) : Promise.resolve(null),
    p.sourceIds.contractId ? getById<Contract>(COLLECTIONS.contracts, p.sourceIds.contractId) : Promise.resolve(null),
    p.sourceIds.billingId ? getById<Billing>(COLLECTIONS.billing, p.sourceIds.billingId) : Promise.resolve(null),
    list<DomainEvent>(COLLECTIONS.events, { where: [["entityId", "==", p.id]] }),
    p.approvedBy ? getById<User>(COLLECTIONS.users, p.approvedBy) : Promise.resolve(null),
  ]);
  const trace: TraceLink[] = [];
  if (p.sourceIds.saleNumber || p.sourceIds.opportunityId) trace.push({ key: "venda", label: "Venda", value: p.sourceIds.saleNumber ?? "Oportunidade", href: p.sourceIds.opportunityId ? `/vendas/oportunidades?oportunidade=${p.sourceIds.opportunityId}` : undefined });
  if (contract) trace.push({ key: "contrato", label: "Contrato", value: contract.number, href: `/financeiro/contratos/${contract.id}` });
  if (billing) {
    const kind = { setup: "Adesão", mensalidade: "Mensalidade", hardware: "Hardware", servico: "Serviço" }[billing.type];
    trace.push({ key: "cobranca", label: "Recebimento", value: `${kind}${billing.installment ? ` ${billing.installment}` : ""} · ${billing.status === "paga" ? `paga em ${dateKey(billing.paidAt ?? billing.dueDate).split("-").reverse().join("/")}` : billing.status}`, href: `/financeiro/cobrancas?cliente=${billing.clientId}&competencia=${billing.competence}&tipo=${billing.type}` });
  }
  if (commission?.ruleSnapshot) trace.push({ key: "regra", label: "Regra", value: commission.ruleSnapshot.name, href: commission.ruleSnapshot.source === "regra" ? `/financeiro/comissoes/regras?regra=${commission.ruleSnapshot.id}` : undefined });
  if (commission) trace.push({ key: "comissao", label: "Comissão", value: commission.code ?? commission.id, href: `/financeiro/comissoes?comissao=${commission.id}` });
  if (p.sourceIds.reversalOf) trace.push({ key: "original", label: "Título estornado", value: p.sourceIds.reversalOf, href: `/financeiro/contas-a-pagar?titulo=${p.sourceIds.reversalOf}` });
  trace.push({ key: "titulo", label: "Título", value: row.code });

  const history: HistoryItem[] = (p.history ?? []).map((h: PayableHistoryEntry, i) => ({ id: `h${i}`, at: h.at, title: h.action, subtitle: [h.reason, h.changes ? Object.entries(h.changes).map(([k, v]) => `${k}: ${String(v.from ?? "—")} → ${String(v.to ?? "—")}`).join(" · ") : null].filter(Boolean).join(" · ") || undefined, by: h.byName, tone: h.to === "pago" ? "success" : h.to === "cancelado" ? "danger" : "info" }));
  for (const e of events) history.push({ id: e.id, at: e.occurredAt, title: e.title, subtitle: e.description, by: e.actorName, tone: e.type === "payable.paid" ? "success" : e.type === "payable.cancelled" ? "danger" : "info" });
  history.sort((a, b) => b.at.localeCompare(a.at));

  return {
    ...row,
    trace,
    history,
    commission: commission ? { id: commission.id, code: commission.code ?? commission.id, status: commission.status, steps: commission.calc?.steps ?? legacySteps(commission), ruleText: commission.ruleSnapshot ? describeSnapshot(commission.ruleSnapshot) : undefined } : undefined,
    paymentMethod: p.paymentMethod,
    receiptUrl: p.receiptUrl,
    notes: p.notes,
    cancelReason: p.cancelReason,
    approvedBy: approver?.name,
    approvedAt: p.approvedAt,
    scheduledAt: p.scheduledAt,
  };
}
