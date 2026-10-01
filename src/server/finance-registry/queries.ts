import "server-only";
/**
 * Leitura da tela Cadastros financeiros (etapa CP/CR 1): contas com saldo, centros com uso, árvore de categorias com
 * uso em títulos (campo novo `categoryId`) e na configuração antiga (`Payable.category`/`costCenter` = `legacyKey`),
 * plano da importação manual e histórico (eventos). Valores sob "Visualizar valores" (A13): sem a chave, o saldo não
 * sai do servidor. Contagens de títulos respeitam o escopo de Contas a Pagar do usuário.
 * Etapa CP/CR 2: saldo atual = saldo inicial + lançamentos de caixa; extrato somente leitura por conta (?conta=<id>,
 * período ?de=&ate=) sob a ação `financeiro.cadastros.contas.extrato`.
 */
import { can, canSeeHref } from "@/server/auth/session";
import { getManyByIds, list } from "@/server/db";
import { buildStatement, CASH_ENTRY_TYPE_LABELS, cashEntryMovements } from "@/domain/cash-entries";
import { payableAllowed, payableVisibility } from "@/server/commissions/access";
import { canSeeFinanceValues } from "@/server/finance/access";
import { redactChanges } from "@/domain/audit-format";
import { accountBalance, activeCategoriesByCenter, categoriesWithoutCenter, categoryUsageTotal, countCategoryUsage, nameKey, planLegacyImport, type LegacyImportPlan } from "@/domain/finance-registry";
import type { EventType } from "@/domain/constants";
import { COLLECTIONS, type Billing, type CashEntry, type CashEntryType, type Contract, type CostCenter, type CurrentUser, type DomainEvent, type FinanceCategory, type FinancialAccount, type Payable, type Receivable, type TimelineEvent } from "@/domain/types";
import { dateKey } from "@/lib/format";
import { getSetting } from "@/server/admin/queries";
import { SETTING_DEFAULTS, type ContasAPagarConfig } from "@/server/admin/schemas";
import { listCostCenters, listFinanceCategories, listFinancialAccounts } from "./service";

export type RegistryTab = "contas" | "centros" | "categorias";

/** Eventos do histórico de cada aba (aplicar centro em massa aparece em Centros e em Categorias). */
export const REGISTRY_EVENTS_BY_TAB: Record<RegistryTab, EventType[]> = {
  contas: ["financial_account.created", "financial_account.updated", "financial_account.archived", "financial_account.reactivated"],
  centros: ["cost_center.created", "cost_center.updated", "cost_center.archived", "cost_center.reactivated", "finance_category.bulk_updated", "finance_registry.imported"],
  categorias: ["finance_category.created", "finance_category.updated", "finance_category.archived", "finance_category.reactivated", "finance_category.merged", "finance_category.bulk_updated", "finance_registry.imported"],
};

/** O evento envolve o registro `id` (entidade do evento ou ids da operação em massa/mesclagem)? */
function eventTouches(e: DomainEvent, id: string): boolean {
  if (e.entityId === id) return true;
  const p = e.payload ?? {};
  const ids = [p.categoryId, p.costCenterId, p.accountId, p.sourceId, p.targetId, p.targetParentId, ...(Array.isArray(p.categoryIds) ? p.categoryIds : []), ...(Array.isArray(p.subcategoryIds) ? p.subcategoryIds : [])];
  return ids.includes(id);
}

export interface AccountRow {
  id: string;
  name: string;
  type: FinancialAccount["type"];
  /** null = sem "Visualizar valores" (Restrito). */
  initialBalance: number | null;
  balance: number | null;
  currency: "BRL";
  bankName?: string;
  agency?: string;
  accountNumber?: string;
  notes?: string;
  archived: boolean;
  archiveReason?: string;
}

export interface CenterRow {
  id: string;
  name: string;
  description?: string;
  archived: boolean;
  archiveReason?: string;
  legacyKey?: string;
  /** Categorias de nível 1 ativas neste centro. */
  activeCategories: number;
  /** Títulos com este centro próprio (campo novo). */
  usage: number;
  /** Títulos antigos cujo `costCenter` é a chave antiga deste centro. */
  legacyUsage: number;
}

export interface CategoryRow {
  id: string;
  name: string;
  type: FinanceCategory["type"];
  parentId: string | null;
  costCenterId?: string;
  /** Centro que vale (próprio na categoria; da mãe na subcategoria). */
  centerName: string | null;
  centerArchived: boolean;
  archived: boolean;
  archiveReason?: string;
  legacyKey?: string;
  mergedIntoName?: string;
  /** Uso direto (títulos/lançamentos pelo campo novo). */
  usage: number;
  /** Uso somado às subcategorias (nível 1). */
  usageTotal: number;
  /** Títulos antigos pela chave da configuração (`Payable.category` = legacyKey). */
  legacyUsage: number;
  /** Subcategorias ativas (nível 1). */
  activeSubcategories: string[];
}

/** Linha do extrato (somente leitura). Quantias null = sem "Visualizar valores" (Restrito). */
export interface StatementRow {
  id: string;
  date: string;
  description: string;
  type: CashEntryType;
  typeLabel: string;
  /** + entrada, − saída. */
  amount: number | null;
  /** Saldo depois do lançamento. */
  balance: number | null;
  contactName?: string;
  notes?: string;
  reconciled: boolean;
  origin?: { label: string; href?: string };
}

export interface AccountStatement {
  accountId: string;
  accountName: string;
  archived: boolean;
  /** Período aplicado (AAAA-MM-DD, inclusivo). */
  from: string;
  to: string;
  opening: number | null;
  closing: number | null;
  inflow: number | null;
  outflow: number | null;
  rows: StatementRow[];
}

const DAY = /^\d{4}-\d{2}-\d{2}$/;

/** Período do extrato: ?de=&ate= válidos; padrão = últimos 90 dias até hoje (São Paulo). */
export function statementPeriod(requested: { de?: string; ate?: string }, today: string = dateKey(new Date())): { from: string; to: string } {
  const to = requested.ate && DAY.test(requested.ate) ? requested.ate : today;
  const fallbackFrom = new Date(Date.parse(`${to}T12:00:00Z`) - 89 * 86_400_000).toISOString().slice(0, 10);
  const from = requested.de && DAY.test(requested.de) ? requested.de : fallbackFrom;
  return from <= to ? { from, to } : { from: to, to: from };
}

export interface RegistryWorkspace {
  tab: RegistryTab;
  visibleTabs: RegistryTab[];
  accounts: AccountRow[];
  centers: CenterRow[];
  categories: CategoryRow[];
  counts: { accounts: number; centers: number; categories: number; subcategories: number; withoutCenter: number };
  importPlan: LegacyImportPlan | null;
  history: TimelineEvent[];
  /** Extrato da conta pedida (?conta=), quando o usuário pode ver. */
  statement: AccountStatement | null;
  can: {
    values: boolean;
    /** Ver extrato das contas (etapa CP/CR 2). */
    statement: boolean;
    accounts: { create: boolean; edit: boolean; archive: boolean };
    centers: { create: boolean; edit: boolean; archive: boolean };
    categories: { create: boolean; edit: boolean; archive: boolean; reorganize: boolean; merge: boolean };
    import: boolean;
  };
}

function toTimeline(e: DomainEvent, hideValues: boolean): TimelineEvent {
  const raw = e.payload?.changes;
  const changes = raw && typeof raw === "object" ? redactChanges(raw as Record<string, { from: unknown; to: unknown }>, { hideValues }) : undefined;
  const reason = typeof e.payload?.reason === "string" && e.payload.reason.trim() ? e.payload.reason.trim() : undefined;
  return {
    id: e.id,
    organizationId: e.organizationId,
    createdAt: e.createdAt,
    updatedAt: e.updatedAt,
    clientId: "",
    eventId: e.id,
    type: e.type,
    occurredAt: e.occurredAt,
    actorId: e.actorId,
    actorName: e.actorName,
    title: e.title,
    description: e.description,
    entityType: e.entityType,
    entityId: e.entityId,
    department: e.department,
    ...(changes && Object.keys(changes).length ? { changes } : {}),
    ...(reason ? { reason } : {}),
  };
}

export async function getRegistryWorkspace(user: CurrentUser, requested: { tab?: string; item?: string; conta?: string; de?: string; ate?: string }): Promise<RegistryWorkspace> {
  const sees = {
    contas: can(user, "financeiro.cadastros.contas.ver"),
    centros: can(user, "financeiro.cadastros.centros.ver"),
    categorias: can(user, "financeiro.cadastros.categorias.ver"),
  };
  const visibleTabs = (["contas", "centros", "categorias"] as const).filter((t) => sees[t]);
  const tab: RegistryTab = visibleTabs.includes(requested.tab as RegistryTab) ? (requested.tab as RegistryTab) : (visibleTabs[0] ?? "contas");
  const values = canSeeFinanceValues(user);
  const canImport = can(user, "financeiro.cadastros.importar") && (sees.categorias || sees.centros);
  const needsCategories = sees.categorias || sees.centros;
  const canStatement = sees.contas && can(user, "financeiro.cadastros.contas.extrato");

  const [accounts, centers, categories, allPayables, visibility, setting, events, entries, receivables] = await Promise.all([
    sees.contas ? listFinancialAccounts() : Promise.resolve([] as FinancialAccount[]),
    needsCategories ? listCostCenters() : Promise.resolve([] as CostCenter[]),
    needsCategories ? listFinanceCategories() : Promise.resolve([] as FinanceCategory[]),
    needsCategories ? list<Payable>(COLLECTIONS.payables) : Promise.resolve([] as Payable[]),
    payableVisibility(user),
    canImport ? getSetting<ContasAPagarConfig>("contas_a_pagar", SETTING_DEFAULTS.contas_a_pagar) : Promise.resolve(null),
    visibleTabs.length ? list<DomainEvent>(COLLECTIONS.events, { where: [["type", "in", REGISTRY_EVENTS_BY_TAB[tab]]] }) : Promise.resolve([] as DomainEvent[]),
    sees.contas || needsCategories ? list<CashEntry>(COLLECTIONS.cashEntries) : Promise.resolve([] as CashEntry[]),
    // Títulos a receber avulsos (etapa CP/CR 3) também usam categorias de receita e centros.
    needsCategories ? list<Receivable>(COLLECTIONS.receivables) : Promise.resolve([] as Receivable[]),
  ]);
  // Contagens de uso só com os títulos que o usuário vê em Contas a Pagar.
  const payables = allPayables.filter((p) => payableAllowed(visibility, p));
  // Uso pelos campos novos: títulos visíveis + lançamentos de caixa (etapa CP/CR 2).
  const usage = countCategoryUsage([...payables, ...entries, ...receivables]);
  const centerUsage = new Map<string, number>();
  for (const p of [...payables, ...entries, ...receivables]) if (p.costCenterId) centerUsage.set(p.costCenterId, (centerUsage.get(p.costCenterId) ?? 0) + 1);
  const movements = cashEntryMovements(entries);
  const legacyCategoryUsage = new Map<string, number>();
  const legacyCenterUsage = new Map<string, number>();
  for (const p of payables) {
    if (p.category) legacyCategoryUsage.set(p.category, (legacyCategoryUsage.get(p.category) ?? 0) + 1);
    if (p.costCenter) legacyCenterUsage.set(nameKey(p.costCenter), (legacyCenterUsage.get(nameKey(p.costCenter)) ?? 0) + 1);
  }
  const centerById = new Map(centers.map((c) => [c.id, c]));
  const categoryById = new Map(categories.map((c) => [c.id, c]));
  const byCenter = activeCategoriesByCenter(categories);

  const accountRows: AccountRow[] = accounts
    .map((a) => ({
      id: a.id,
      name: a.name,
      type: a.type,
      initialBalance: values ? a.initialBalance : null,
      // Saldo atual = saldo inicial + lançamentos de caixa (receitas entram, despesas saem).
      balance: values ? accountBalance(a, movements) : null,
      currency: "BRL" as const,
      bankName: a.bankName || undefined,
      agency: a.agency || undefined,
      accountNumber: a.accountNumber || undefined,
      notes: a.notes || undefined,
      archived: Boolean(a.archived),
      archiveReason: a.archiveReason || undefined,
    }))
    .sort((a, b) => Number(a.archived) - Number(b.archived) || a.name.localeCompare(b.name, "pt-BR"));

  const centerRows: CenterRow[] = centers
    .map((c) => ({
      id: c.id,
      name: c.name,
      description: c.description || undefined,
      archived: Boolean(c.archived),
      archiveReason: c.archiveReason || undefined,
      legacyKey: c.legacyKey || undefined,
      activeCategories: byCenter.get(c.id) ?? 0,
      usage: centerUsage.get(c.id) ?? 0,
      legacyUsage: legacyCenterUsage.get(nameKey(c.legacyKey ?? c.name)) ?? 0,
    }))
    .sort((a, b) => Number(a.archived) - Number(b.archived) || a.name.localeCompare(b.name, "pt-BR"));

  const categoryRows: CategoryRow[] = categories.map((c) => {
    const centerId = c.parentId ? categoryById.get(c.parentId)?.costCenterId : c.costCenterId;
    const center = centerId ? centerById.get(centerId) : undefined;
    return {
      id: c.id,
      name: c.name,
      type: c.type,
      parentId: c.parentId,
      costCenterId: c.parentId ? undefined : c.costCenterId,
      centerName: center?.name ?? null,
      centerArchived: Boolean(center?.archived),
      archived: Boolean(c.archived),
      archiveReason: c.archiveReason || undefined,
      legacyKey: c.legacyKey || undefined,
      mergedIntoName: c.mergedIntoId ? categoryById.get(c.mergedIntoId)?.name : undefined,
      usage: usage.get(c.id) ?? 0,
      usageTotal: categoryUsageTotal(c, categories, usage),
      legacyUsage: c.legacyKey ? (legacyCategoryUsage.get(c.legacyKey) ?? 0) : 0,
      activeSubcategories: c.parentId ? [] : categories.filter((s) => s.parentId === c.id && !s.archived).map((s) => s.name),
    };
  });

  const importPlan = setting ? planLegacyImport({ setting, centers, categories, payables: allPayables.map((p) => ({ category: p.category, costCenter: p.costCenter })) }) : null;
  const itemEvents = requested.item ? events.filter((e) => eventTouches(e, requested.item!)) : events;
  const history = itemEvents
    .sort((a, b) => b.occurredAt.localeCompare(a.occurredAt))
    .slice(0, 40)
    .map((e) => toTimeline(e, !values));

  const statementAccount = canStatement && requested.conta ? accounts.find((a) => a.id === requested.conta) : undefined;
  const statement = statementAccount ? await buildAccountStatement(user, statementAccount, entries, statementPeriod(requested), values) : null;

  const active = categories.filter((c) => !c.archived);
  return {
    tab,
    visibleTabs,
    accounts: accountRows,
    centers: centerRows,
    categories: categoryRows,
    counts: {
      accounts: accounts.filter((a) => !a.archived).length,
      centers: centers.filter((c) => !c.archived).length,
      categories: active.filter((c) => !c.parentId).length,
      subcategories: active.filter((c) => c.parentId).length,
      withoutCenter: categoriesWithoutCenter(categories, centers).length,
    },
    importPlan,
    history,
    statement,
    can: {
      values,
      statement: canStatement,
      accounts: { create: can(user, "financeiro.cadastros.contas.criar"), edit: can(user, "financeiro.cadastros.contas.editar"), archive: can(user, "financeiro.cadastros.contas.arquivar") },
      centers: { create: can(user, "financeiro.cadastros.centros.criar"), edit: can(user, "financeiro.cadastros.centros.editar"), archive: can(user, "financeiro.cadastros.centros.arquivar") },
      categories: {
        create: can(user, "financeiro.cadastros.categorias.criar"),
        edit: can(user, "financeiro.cadastros.categorias.editar"),
        archive: can(user, "financeiro.cadastros.categorias.arquivar"),
        reorganize: can(user, "financeiro.cadastros.categorias.reorganizar"),
        merge: can(user, "financeiro.cadastros.categorias.mesclar"),
      },
      import: Boolean(setting),
    },
  };
}

const BILLING_TYPE_LABEL: Record<Billing["type"], string> = { setup: "Adesão", mensalidade: "Mensalidade", hardware: "Hardware", servico: "Serviço" };

/**
 * Extrato de uma conta no período: saldo de abertura, lançamentos (data, descrição, tipo, valor ±, origem com link para
 * o título/cobrança, conciliado) e saldo de fechamento. Links só para telas que o usuário abre; quantias só com
 * "Visualizar valores".
 */
async function buildAccountStatement(user: CurrentUser, account: FinancialAccount, entries: CashEntry[], period: { from: string; to: string }, values: boolean): Promise<AccountStatement> {
  const st = buildStatement(account, entries, period);
  const lines = [...st.lines].reverse(); // mais recentes primeiro na tela
  const payableIds = lines.filter((l) => l.entry.origin?.kind === "payable").map((l) => l.entry.origin!.id);
  const receivableIds = lines.filter((l) => l.entry.origin?.kind === "receivable").map((l) => l.entry.origin!.id);
  const billingIds = lines.filter((l) => l.entry.origin?.kind === "billing").map((l) => l.entry.origin!.id);
  const [payables, billings, receivables] = await Promise.all([getManyByIds<Payable>(COLLECTIONS.payables, payableIds), getManyByIds<Billing>(COLLECTIONS.billing, billingIds), getManyByIds<Receivable>(COLLECTIONS.receivables, receivableIds)]);
  const contracts = await getManyByIds<Contract>(COLLECTIONS.contracts, Array.from(billings.values()).map((b) => b.contractId));
  const canPayables = canSeeHref(user, "/financeiro/contas-a-pagar");
  const canBillings = canSeeHref(user, "/financeiro/cobrancas");
  const canReceivables = canSeeHref(user, "/financeiro/contas-a-receber?aba=avulsos");
  const origin = (e: CashEntry): StatementRow["origin"] => {
    if (!e.origin) return undefined;
    if (e.origin.kind === "payable") {
      const p = payables.get(e.origin.id);
      return { label: `Título ${p?.code ?? e.origin.id}`, href: canPayables ? `/financeiro/contas-a-pagar?titulo=${e.origin.id}` : undefined };
    }
    if (e.origin.kind === "receivable") {
      const r = receivables.get(e.origin.id);
      return { label: `Título a receber ${r?.code ?? e.origin.id}`, href: canReceivables ? `/financeiro/contas-a-receber?aba=avulsos&titulo=${e.origin.id}` : undefined };
    }
    const b = billings.get(e.origin.id);
    const c = b ? contracts.get(b.contractId) : undefined;
    const label = b ? `Cobrança ${BILLING_TYPE_LABEL[b.type]}${b.installment ? ` ${b.installment}` : ""}${c ? ` · ${c.number}` : ""}` : "Cobrança";
    return { label, href: b && canBillings ? `/financeiro/cobrancas?cliente=${b.clientId}&competencia=${b.competence}&tipo=${b.type}` : undefined };
  };
  return {
    accountId: account.id,
    accountName: account.name,
    archived: Boolean(account.archived),
    from: period.from,
    to: period.to,
    opening: values ? st.opening : null,
    closing: values ? st.closing : null,
    inflow: values ? st.inflow : null,
    outflow: values ? st.outflow : null,
    rows: lines.map((l) => ({
      id: l.entry.id,
      date: l.entry.date,
      description: l.entry.description,
      type: l.entry.type,
      typeLabel: CASH_ENTRY_TYPE_LABELS[l.entry.type],
      amount: values ? l.signed : null,
      balance: values ? l.balance : null,
      contactName: l.entry.contact?.name,
      notes: l.entry.notes,
      reconciled: Boolean(l.entry.reconciled),
      origin: origin(l.entry),
    })),
  };
}
