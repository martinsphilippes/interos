import "server-only";
/**
 * Leitura da tela Cadastros financeiros (etapa CP/CR 1): contas com saldo, centros com uso, árvore de categorias com
 * uso em títulos (campo novo `categoryId`) e na configuração antiga (`Payable.category`/`costCenter` = `legacyKey`),
 * plano da importação manual e histórico (eventos). Valores sob "Visualizar valores" (A13): sem a chave, o saldo não
 * sai do servidor. Contagens de títulos respeitam o escopo de Contas a Pagar do usuário.
 */
import { can } from "@/server/auth/session";
import { list } from "@/server/db";
import { payableAllowed, payableVisibility } from "@/server/commissions/access";
import { canSeeFinanceValues } from "@/server/finance/access";
import { redactChanges } from "@/domain/audit-format";
import { accountBalance, activeCategoriesByCenter, categoriesWithoutCenter, categoryUsageTotal, countCategoryUsage, nameKey, planLegacyImport, type LegacyImportPlan } from "@/domain/finance-registry";
import type { EventType } from "@/domain/constants";
import { COLLECTIONS, type CostCenter, type CurrentUser, type DomainEvent, type FinanceCategory, type FinancialAccount, type Payable, type TimelineEvent } from "@/domain/types";
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

export interface RegistryWorkspace {
  tab: RegistryTab;
  visibleTabs: RegistryTab[];
  accounts: AccountRow[];
  centers: CenterRow[];
  categories: CategoryRow[];
  counts: { accounts: number; centers: number; categories: number; subcategories: number; withoutCenter: number };
  importPlan: LegacyImportPlan | null;
  history: TimelineEvent[];
  can: {
    values: boolean;
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

export async function getRegistryWorkspace(user: CurrentUser, requested: { tab?: string; item?: string }): Promise<RegistryWorkspace> {
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

  const [accounts, centers, categories, allPayables, visibility, setting, events] = await Promise.all([
    sees.contas ? listFinancialAccounts() : Promise.resolve([] as FinancialAccount[]),
    needsCategories ? listCostCenters() : Promise.resolve([] as CostCenter[]),
    needsCategories ? listFinanceCategories() : Promise.resolve([] as FinanceCategory[]),
    needsCategories ? list<Payable>(COLLECTIONS.payables) : Promise.resolve([] as Payable[]),
    payableVisibility(user),
    canImport ? getSetting<ContasAPagarConfig>("contas_a_pagar", SETTING_DEFAULTS.contas_a_pagar) : Promise.resolve(null),
    visibleTabs.length ? list<DomainEvent>(COLLECTIONS.events, { where: [["type", "in", REGISTRY_EVENTS_BY_TAB[tab]]] }) : Promise.resolve([] as DomainEvent[]),
  ]);
  // Contagens de uso só com os títulos que o usuário vê em Contas a Pagar.
  const payables = allPayables.filter((p) => payableAllowed(visibility, p));
  const usage = countCategoryUsage(payables);
  const centerUsage = new Map<string, number>();
  for (const p of payables) if (p.costCenterId) centerUsage.set(p.costCenterId, (centerUsage.get(p.costCenterId) ?? 0) + 1);
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
      // Lançamentos de caixa chegam na etapa 2: hoje o saldo é o inicial (accountBalance já soma movimentos).
      balance: values ? accountBalance(a, []) : null,
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
    can: {
      values,
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
