import "server-only";
/**
 * Leituras das telas do Financeiro › Comissões, Regras e Contas a Pagar. A visibilidade é resolvida AQUI, no servidor,
 * pelo núcleo de autorização (./access.ts: seções Minhas/Todas + resolveDataScope da tela) — padrão: financeiro/admin/
 * diretoria veem tudo; gestor, a equipe; vendedor, só o que é dele. Seção negada = dado não lido nem enviado. Todo
 * número exibido sai dos documentos do motor (nada calculado só na tela).
 */
import { getById, getManyByIds, list } from "@/server/db";
import { dateKey } from "@/lib/format";
import { PRODUCT_CATEGORY_LABELS } from "@/domain/constants";
import {
  COMMISSION_REVENUE_LABELS,
  COMMISSION_STATUS_LABELS,
  COMMISSION_STATUSES,
  PAYABLE_STATUSES,
  commissionSlotLabel,
  payableCategoryLabel,
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
import { getCommissionPaymentSettings, getPayablesSettings, listPayableAttachments } from "./payables";
import { listSuppliers } from "./suppliers";
import { can } from "@/server/auth/permissions";
import type { CommissionScope } from "./permissions";
import {
  commissionAllowed,
  commissionCapabilities,
  commissionVisibility,
  payableAllowed,
  payableCapabilities,
  payableVisibility,
  type CommissionCapabilities,
  type CommissionVisibility,
  type PayableCapabilities,
} from "./access";
import { describeSnapshot, isLegacyRule, ruleScope, snapshotRule } from "./rules";

type SearchParams = Record<string, string | string[] | undefined>;
const first = (v: string | string[] | undefined) => (Array.isArray(v) ? v[0] : v)?.trim() || undefined;
const MONTH = /^\d{4}-(0[1-9]|1[0-2])$/;

/**
 * Visão de comissões do usuário no formato antigo (relatórios): "all" (sem recorte), "team" (lista de donos) ou "own".
 * Sai da mesma visibilidade das telas (seções + escopo da tela); sem as seções, "own" com lista vazia.
 */
export async function resolveCommissionScope(viewer: CurrentUser): Promise<CommissionScope> {
  const vis = await commissionVisibility(viewer);
  if (vis.ownerIds === null && !vis.excludeSelf) return { kind: "all" };
  const ids = vis.ownerIds ? Array.from(vis.ownerIds) : (await list<User>(COLLECTIONS.users)).filter((u) => u.active !== false && u.id !== viewer.id).map((u) => u.id);
  return vis.kind === "own" || vis.kind === "none" ? { kind: "own", userIds: ids } : { kind: "team", userIds: ids };
}

/** Comissões visíveis (só as dos donos permitidos são lidas). */
async function commissionsVisible(vis: CommissionVisibility): Promise<Commission[]> {
  if (vis.ownerIds === null) return (await list<Commission>(COLLECTIONS.commissions)).filter((c) => commissionAllowed(vis, c.userId));
  if (vis.ownerIds.size === 0) return [];
  return list<Commission>(COLLECTIONS.commissions, { where: [["userId", "in", Array.from(vis.ownerIds)]] });
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
  /** Visão: todas, equipe, próprias ou nenhuma (sem as seções Minhas/Todas). */
  scope: CommissionVisibility["kind"];
  kpis: Record<"prevista" | "em_carencia" | "aguardando_recebimento" | "liberada" | "titulo_gerado" | "paga" | "bloqueada" | "void", CountAmount>;
  rows: CommissionRow[];
  total: number;
  facets: { sellers: Opt[]; clients: Opt[]; contracts: Opt[]; competences: Opt[] };
  selected: CommissionDetail | null;
  can: CommissionCapabilities & { viewPayables: boolean; viewRules: boolean };
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
  const vis = await commissionVisibility(viewer);
  const all = await commissionsVisible(vis);
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
    sellers: vis.kind === "own" || vis.kind === "none" ? [] : opt(rowsAll.map((r) => [r.userId, r.userName])),
    clients: opt(rowsAll.map((r) => [r.clientId, r.clientName])),
    contracts: opt(rowsAll.filter((r) => r.contractId).map((r) => [r.contractId!, `${r.contractNumber ?? r.contractId} · ${r.clientName}`])),
    competences: Array.from(new Set(rowsAll.map((r) => r.competence)))
      .sort()
      .reverse()
      .map((c) => ({ value: c, label: competenceLabel(c) })),
  };

  const caps = { ...commissionCapabilities(viewer), viewPayables: can(viewer, "financeiro.contas-a-pagar.ver"), viewRules: can(viewer, "financeiro.comissoes.regras.ver") };
  const chosen = selectedId ? all.find((c) => c.id === selectedId) : undefined;
  const selected = chosen && commissionAllowed(vis, chosen.userId) ? await commissionDetail(chosen, toRow(chosen, users, clients, contracts, payables), contracts, payables, caps) : null;
  return { scope: vis.kind, kpis, rows, total: rowsAll.length, facets, selected, can: caps };
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
  /** Link para a tela de comissões com o filtro do vendedor (ou "Minhas comissões"); ausente sem acesso à tela. */
  href?: string;
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
 * Comissões de um colaborador para o Meu Desempenho. A visibilidade da tela Comissões vale aqui também (seções
 * Minhas/Todas + escopo): devolve null quando o visitante não pode ver as comissões desse usuário (padrão: vendedor só
 * as próprias; gestor, a equipe; financeiro, todas). Links para Financeiro › Comissões só com acesso à tela.
 */
export async function getUserCommissionsDigest(viewer: CurrentUser, userId: string, options: { canOpenFinance: boolean; limit?: number } = { canOpenFinance: false }): Promise<UserCommissionsDigest | null> {
  const vis = await commissionVisibility(viewer);
  if (!commissionAllowed(vis, userId)) return null;
  const canOpen = options.canOpenFinance && can(viewer, "financeiro.comissoes.ver");
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
    rows.push({ ...row, whenAt, whenLabel, href: canOpen ? `/financeiro/comissoes?comissao=${c.id}` : undefined });
  }
  const order: Record<CommissionStatus, number> = { liberada: 0, titulo_gerado: 1, aguardando_recebimento: 2, em_carencia: 3, prevista: 4, paga: 5, bloqueada: 6, cancelada: 7, estornada: 8 };
  rows.sort((a, b) => order[a.status] - order[b.status] || (b.whenAt ?? "").localeCompare(a.whenAt ?? "") || b.competence.localeCompare(a.competence));
  const limit = options.limit ?? 12;
  return {
    userId,
    rows: rows.slice(0, limit),
    total: rows.length,
    totals,
    href: !canOpen ? undefined : vis.kind === "own" ? "/financeiro/comissoes" : `/financeiro/comissoes?vendedor=${userId}`,
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
  /** Alterar regras (financeiro.comissoes.regras.editar). */
  canManage: boolean;
  can: { edit: boolean; toggle: boolean; exception: boolean; configure: boolean };
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
    canManage: can(viewer, "financeiro.comissoes.regras.editar"),
    can: {
      edit: can(viewer, "financeiro.comissoes.regras.editar"),
      toggle: can(viewer, "financeiro.comissoes.regras.ativar"),
      exception: can(viewer, "financeiro.comissoes.regras.criar-excecao"),
      configure: can(viewer, "financeiro.comissoes.regras.configurar"),
    },
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
  centro?: string;
  origem?: Payable["origin"];
  serie?: string;
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
    centro: first(sp.centro),
    origem: (["comissao_automatica", "bonus", "manual", "estorno", "recorrencia"] as const).find((o) => o === first(sp.origem)),
    serie: first(sp.serie),
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
  // Contas a Pagar geral (D28)
  supplierId?: string;
  costCenter?: string;
  installment?: number;
  installments?: number;
  seriesId?: string;
  recurring: boolean;
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
  attachments: { id: string; name: string; url: string; createdAt: string }[];
  recurrence?: Payable["recurrence"];
  /** Outros títulos da mesma série/parcelamento. */
  siblings: { id: string; code: string; competence: string; dueDate: string; status: PayableStatus; amount: number }[];
}

/** Fluxo de caixa simplificado (D28): a receber (cobranças abertas/vencidas) × a pagar (títulos abertos) por mês. */
export interface CashFlowMonth {
  key: string;
  label: string;
  receivable: number;
  receivableCount: number;
  payable: number;
  payableCount: number;
  net: number;
}

export interface PayablesWorkspace {
  kpis: { previsto: CountAmount; aprovado: CountAmount; a_pagar: CountAmount; vencidos: CountAmount; pagosMes: CountAmount };
  rows: PayableRow[];
  total: number;
  facets: { creditors: Opt[]; competences: Opt[]; categories: Opt[]; costCenters: Opt[] };
  selected: PayableDetail | null;
  can: PayableCapabilities;
  users: Opt[];
  suppliers: Opt[];
  settings: { categorias: Opt[]; centrosDeCusto: string[] };
  cashFlow: { overdue: CashFlowMonth; months: CashFlowMonth[] };
}

function isOverduePayable(p: Pick<Payable, "status" | "dueDate">, today: string): boolean {
  return (p.status === "previsto" || p.status === "aprovado" || p.status === "a_pagar") && dateKey(p.dueDate) < today;
}

function addMonthsKey(comp: string, n: number): string {
  const [y, m] = comp.split("-").map(Number);
  return new Date(Date.UTC(y, m - 1 + n, 1)).toISOString().slice(0, 7);
}

export async function getPayablesWorkspace(viewer: CurrentUser, filters: PayableFilters, selectedId?: string): Promise<PayablesWorkspace> {
  const vis = await payableVisibility(viewer);
  const full = vis.creditorIds === null;
  const caps = payableCapabilities(viewer);
  const all = (await list<Payable>(COLLECTIONS.payables)).filter((p) => payableAllowed(vis, p));
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
    supplierId: p.supplierId,
    costCenter: p.costCenter,
    installment: p.installment,
    installments: p.installments,
    seriesId: p.seriesId,
    recurring: Boolean(p.recurrence) || p.origin === "recorrencia",
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
    .filter((r) => !filters.centro || r.costCenter === filters.centro)
    .filter((r) => !filters.origem || r.origin === filters.origem)
    .filter((r) => !filters.serie || r.seriesId === filters.serie)
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
  const links: TraceAccess = { suppliers: caps.suppliers, rules: can(viewer, "financeiro.comissoes.regras.ver"), commissions: can(viewer, "financeiro.comissoes.ver") };
  const selected = chosen ? await payableDetail(chosen, toRow(chosen), all, links) : null;
  // Lançamento manual: credores colaboradores dentro do escopo (empresa = todos os ativos).
  const [users, suppliers, settings, cashFlow] = await Promise.all([
    caps.create ? list<User>(COLLECTIONS.users).then((us) => us.filter((u) => u.active !== false && (full || vis.creditorIds!.has(u.id))).map((u) => ({ value: u.id, label: u.name })).sort((a, b) => a.label.localeCompare(b.label, "pt-BR"))) : Promise.resolve([] as Opt[]),
    caps.create && full ? listSuppliers({ activeOnly: true }).then((ss) => ss.map((s) => ({ value: s.id, label: s.name }))) : Promise.resolve([] as Opt[]),
    getPayablesSettings(),
    // Fluxo de caixa: seção própria e só com escopo empresa (soma cobranças e títulos da empresa inteira).
    caps.cashFlow && full ? buildCashFlow(all, today) : Promise.resolve({ overdue: emptyCashMonth("atraso", "Em atraso"), months: [] }),
  ]);
  const categories = Array.from(new Set([...settings.categorias, ...rowsAll.map((r) => r.category)])).map((c) => ({ value: c, label: payableCategoryLabel(c) })).sort((a, b) => a.label.localeCompare(b.label, "pt-BR"));
  const costCenters = Array.from(new Set([...settings.centrosDeCusto, ...rowsAll.map((r) => r.costCenter).filter((c): c is string => Boolean(c))])).map((c) => ({ value: c, label: c })).sort((a, b) => a.label.localeCompare(b.label, "pt-BR"));
  return {
    kpis,
    rows,
    total: rowsAll.length,
    facets: { creditors, competences, categories, costCenters },
    selected,
    can: { ...caps, cashFlow: caps.cashFlow && full },
    users,
    suppliers,
    settings: { categorias: settings.categoriasComRotulo.filter((c) => c.value !== "comissao_comercial" && c.value !== "estorno_comissao"), centrosDeCusto: settings.centrosDeCusto },
    cashFlow,
  };
}

const emptyCashMonth = (key: string, label: string): CashFlowMonth => ({ key, label, receivable: 0, receivableCount: 0, payable: 0, payableCount: 0, net: 0 });

/** Próximos 3 meses (mês atual + 2) por mês de vencimento, mais o que já está em atraso; números reais das coleções. */
async function buildCashFlow(payables: Payable[], today: string): Promise<PayablesWorkspace["cashFlow"]> {
  const { listBillingsSwept } = await import("@/server/finance/billing");
  const billings = await listBillingsSwept({ where: [["status", "in", ["aberta", "vencida"]]] });
  const openPayables = payables.filter((p) => p.status === "previsto" || p.status === "aprovado" || p.status === "a_pagar");
  const month = today.slice(0, 7);
  const months = [0, 1, 2].map((i) => emptyCashMonth(addMonthsKey(month, i), competenceLabel(addMonthsKey(month, i))));
  const overdue = emptyCashMonth("atraso", "Em atraso");
  const byKey = new Map(months.map((m) => [m.key, m]));
  for (const b of billings) {
    const due = dateKey(b.dueDate);
    const bucket = due < today ? overdue : byKey.get(due.slice(0, 7));
    if (!bucket) continue;
    bucket.receivable = round2(bucket.receivable + b.amount);
    bucket.receivableCount += 1;
  }
  for (const p of openPayables) {
    const due = dateKey(p.dueDate);
    const bucket = due < today ? overdue : byKey.get(due.slice(0, 7));
    if (!bucket) continue;
    bucket.payable = round2(bucket.payable + p.amount);
    bucket.payableCount += 1;
  }
  for (const m of [overdue, ...months]) m.net = round2(m.receivable - m.payable);
  return { overdue, months };
}

/** Links da origem só para telas/seções que o usuário abre (a interface só esconde; as páginas revalidam). */
interface TraceAccess {
  suppliers: boolean;
  rules: boolean;
  commissions: boolean;
}

async function payableDetail(p: Payable, row: PayableRow, all: Payable[], links: TraceAccess): Promise<PayableDetail> {
  const commissionId = p.sourceIds.commissionIds?.[0];
  const [commission, contract, billing, events, approver, attachments] = await Promise.all([
    commissionId ? getById<Commission>(COLLECTIONS.commissions, commissionId) : Promise.resolve(null),
    p.sourceIds.contractId ? getById<Contract>(COLLECTIONS.contracts, p.sourceIds.contractId) : Promise.resolve(null),
    p.sourceIds.billingId ? getById<Billing>(COLLECTIONS.billing, p.sourceIds.billingId) : Promise.resolve(null),
    list<DomainEvent>(COLLECTIONS.events, { where: [["entityId", "==", p.id]] }),
    p.approvedBy ? getById<User>(COLLECTIONS.users, p.approvedBy) : Promise.resolve(null),
    listPayableAttachments(p),
  ]);
  const trace: TraceLink[] = [];
  if (p.supplierId) trace.push({ key: "fornecedor", label: "Fornecedor", value: p.creditorName, href: links.suppliers ? `/financeiro/contas-a-pagar/fornecedores?fornecedor=${p.supplierId}` : undefined });
  if (p.seriesId && p.seriesId !== p.id) trace.push({ key: "serie", label: p.installments ? "Parcelamento" : "Série", value: p.installments ? `parcela ${p.installment}/${p.installments}` : `ocorrência da série ${all.find((x) => x.id === p.seriesId)?.code ?? p.seriesId}`, href: `/financeiro/contas-a-pagar?serie=${p.seriesId}` });
  if (p.sourceIds.saleNumber || p.sourceIds.opportunityId) trace.push({ key: "venda", label: "Venda", value: p.sourceIds.saleNumber ?? "Oportunidade", href: p.sourceIds.opportunityId ? `/vendas/oportunidades?oportunidade=${p.sourceIds.opportunityId}` : undefined });
  if (contract) trace.push({ key: "contrato", label: "Contrato", value: contract.number, href: `/financeiro/contratos/${contract.id}` });
  if (billing) {
    const kind = { setup: "Adesão", mensalidade: "Mensalidade", hardware: "Hardware", servico: "Serviço" }[billing.type];
    trace.push({ key: "cobranca", label: "Recebimento", value: `${kind}${billing.installment ? ` ${billing.installment}` : ""} · ${billing.status === "paga" ? `paga em ${dateKey(billing.paidAt ?? billing.dueDate).split("-").reverse().join("/")}` : billing.status}`, href: `/financeiro/cobrancas?cliente=${billing.clientId}&competencia=${billing.competence}&tipo=${billing.type}` });
  }
  if (commission?.ruleSnapshot) trace.push({ key: "regra", label: "Regra", value: commission.ruleSnapshot.name, href: links.rules && commission.ruleSnapshot.source === "regra" ? `/financeiro/comissoes/regras?regra=${commission.ruleSnapshot.id}` : undefined });
  if (commission) trace.push({ key: "comissao", label: "Comissão", value: commission.code ?? commission.id, href: links.commissions ? `/financeiro/comissoes?comissao=${commission.id}` : undefined });
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
    attachments: attachments.map((d) => ({ id: d.id, name: d.name, url: d.url, createdAt: d.createdAt })),
    recurrence: p.recurrence,
    siblings: p.seriesId
      ? all
          .filter((x) => x.seriesId === p.seriesId && x.id !== p.id)
          .sort((a, b) => a.dueDate.localeCompare(b.dueDate))
          .map((x) => ({ id: x.id, code: x.code ?? x.id, competence: x.competence, dueDate: x.dueDate, status: x.status, amount: x.amount }))
      : [],
  };
}
