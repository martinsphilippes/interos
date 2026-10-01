import "server-only";
/**
 * Cadastros financeiros (etapa CP/CR 1): contas financeiras, centros de custo e categorias (receita/despesa) com
 * subcategoria. Regras puras em `src/domain/finance-registry.ts`; aqui leitura/gravação no Firestore e eventos de
 * auditoria (`payload.changes` "de → para" + motivo). Nada é excluído: arquivar/reativar.
 *
 * Só ACRESCENTA: não altera títulos, cobranças nem o setting `contas_a_pagar`. A única escrita em títulos é a
 * reatribuição da categoria NOVA (`Payable.categoryId`) na mesclagem — campo que só a etapa 4 passa a gravar.
 */
import { batchSet, create, list, nowIso, update } from "@/server/db";
import { emitEvent } from "@/server/events";
import { auditChanges, describeChanges, type AuditPayload } from "@/server/audit";
import { BusinessError } from "@/server/auth/error-classes";
import { getSetting } from "@/server/admin/queries";
import { SETTING_DEFAULTS, type ContasAPagarConfig } from "@/server/admin/schemas";
import {
  FINANCE_CATEGORY_TYPE_LABELS,
  FINANCIAL_ACCOUNT_TYPE_LABELS,
  activeCategoriesByCenter,
  countCategoryUsage,
  findActiveDuplicate,
  planApplyCostCenter,
  planArchiveCategory,
  planLegacyImport,
  planMergeCategories,
  planMoveSubcategories,
  validateCategory,
  validateReactivateCategory,
  type CategoryReference,
  type Check,
  type LegacyImportPlan,
} from "@/domain/finance-registry";
import { COLLECTIONS, type CashEntry, type CostCenter, type FinanceCategory, type FinancialAccount, type Payable, type PayableHistoryEntry, type Receivable, type ReceivableHistoryEntry, type UserRef } from "@/domain/types";
import type { CostCenterInput, FinanceCategoryInput, FinancialAccountInput } from "./schemas";

type EmitOptions = { emit?: boolean };

function must<T>(check: Check<T>): T {
  if (!check.ok) throw new BusinessError(check.error);
  return check.value;
}

const byName = <T extends { name: string }>(a: T, b: T) => a.name.localeCompare(b.name, "pt-BR");

// ---------------------------------------------------------------------------
// Leituras
// ---------------------------------------------------------------------------

export async function listFinancialAccounts(): Promise<FinancialAccount[]> {
  return (await list<FinancialAccount>(COLLECTIONS.financialAccounts)).sort(byName);
}

export async function listCostCenters(): Promise<CostCenter[]> {
  return (await list<CostCenter>(COLLECTIONS.costCenters)).sort(byName);
}

export async function listFinanceCategories(): Promise<FinanceCategory[]> {
  return (await list<FinanceCategory>(COLLECTIONS.financeCategories)).map((c) => ({ ...c, parentId: c.parentId ?? null })).sort(byName);
}

/**
 * Registros que usam categorias/centros pelos campos NOVOS: títulos a pagar com `categoryId`/`costCenterId` (gravados
 * a partir da etapa 4) e lançamentos de caixa (etapa 2, herdam a classificação do título na baixa).
 */
export async function listCategoryReferences(): Promise<(CategoryReference & { kind: "payable" | "cash_entry" | "receivable"; id: string })[]> {
  const [payables, entries, receivables] = await Promise.all([list<Payable>(COLLECTIONS.payables), list<CashEntry>(COLLECTIONS.cashEntries), list<Receivable>(COLLECTIONS.receivables)]);
  return [
    ...payables.filter((p) => p.categoryId || p.costCenterId).map((p) => ({ kind: "payable" as const, id: p.id, categoryId: p.categoryId, costCenterId: p.costCenterId })),
    // Títulos a receber avulsos (etapa CP/CR 3): usam categorias de receita e centros.
    ...receivables.filter((r) => r.categoryId || r.costCenterId).map((r) => ({ kind: "receivable" as const, id: r.id, categoryId: r.categoryId, costCenterId: r.costCenterId })),
    ...entries.filter((e) => e.categoryId || e.costCenterId).map((e) => ({ kind: "cash_entry" as const, id: e.id, categoryId: e.categoryId, costCenterId: e.costCenterId })),
  ];
}

// ---------------------------------------------------------------------------
// Visões de auditoria (nomes legíveis, nunca ids soltos)
// ---------------------------------------------------------------------------

function accountView(a: Partial<FinancialAccount>) {
  return {
    name: a.name,
    accountType: a.type ? FINANCIAL_ACCOUNT_TYPE_LABELS[a.type] : undefined,
    initialBalance: a.initialBalance,
    currency: a.currency,
    bankName: a.bankName,
    agency: a.agency,
    accountNumber: a.accountNumber,
    notes: a.notes,
    archived: a.archived,
  };
}
const ACCOUNT_FIELDS = ["name", "accountType", "initialBalance", "currency", "bankName", "agency", "accountNumber", "notes", "archived"] as const;

function centerView(c: Partial<CostCenter>) {
  return { name: c.name, description: c.description, archived: c.archived, legacyKey: c.legacyKey };
}
const CENTER_FIELDS = ["name", "description", "archived", "legacyKey"] as const;

function categoryView(c: Partial<FinanceCategory>, categories: readonly FinanceCategory[], centers: readonly CostCenter[]) {
  const parent = c.parentId ? categories.find((x) => x.id === c.parentId) : undefined;
  const center = c.costCenterId ? centers.find((x) => x.id === c.costCenterId) : undefined;
  return {
    name: c.name,
    categoryType: c.type ? FINANCE_CATEGORY_TYPE_LABELS[c.type] : undefined,
    parentName: parent?.name ?? (c.parentId || undefined),
    costCenterName: center?.name ?? (c.costCenterId || undefined),
    archived: c.archived,
    legacyKey: c.legacyKey,
  };
}
const CATEGORY_FIELDS = ["name", "categoryType", "parentName", "costCenterName", "archived", "legacyKey"] as const;

const describe = (audit: AuditPayload) => describeChanges(audit, {}, (field, v) => (v === null ? "—" : field === "initialBalance" ? "valor alterado" : typeof v === "boolean" ? (v ? "sim" : "não") : String(v))) || undefined;

// ---------------------------------------------------------------------------
// Contas financeiras
// ---------------------------------------------------------------------------

export async function saveFinancialAccount(input: FinancialAccountInput, actor: UserRef, options: EmitOptions = {}): Promise<{ account: FinancialAccount; created: boolean }> {
  const all = await listFinancialAccounts();
  const dup = findActiveDuplicate(all, input.name, input.id);
  if (dup) throw new BusinessError(`Já existe a conta financeira "${dup.name}"`);
  const data = {
    name: input.name.trim().replace(/\s+/g, " "),
    type: input.type,
    initialBalance: input.initialBalance,
    currency: "BRL" as const,
    bankName: input.bankName,
    agency: input.agency,
    accountNumber: input.accountNumber,
    notes: input.notes,
    updatedBy: actor.id,
  };
  if (input.id) {
    const current = all.find((a) => a.id === input.id);
    if (!current) throw new BusinessError("Conta financeira não encontrada");
    const next: FinancialAccount = { ...current, ...data };
    const audit = auditChanges(accountView(current), accountView(next), ACCOUNT_FIELDS);
    if (Object.keys(audit.changes).length === 0) return { account: current, created: false };
    // Campos opcionais apagados: null remove o texto antigo (merge não apaga com undefined).
    await update<FinancialAccount>(COLLECTIONS.financialAccounts, current.id, { ...data, bankName: data.bankName ?? null, agency: data.agency ?? null, accountNumber: data.accountNumber ?? null, notes: data.notes ?? null } as unknown as Partial<FinancialAccount>);
    if (options.emit !== false) {
      await emitEvent({ type: "financial_account.updated", actor, entity: { type: "financial_account", id: current.id }, title: `Conta financeira ${next.name} alterada`, description: describe(audit), department: "financeiro", payload: { accountId: current.id, ...audit }, timeline: false });
    }
    return { account: next, created: false };
  }
  const account = await create<FinancialAccount>(COLLECTIONS.financialAccounts, { ...data, archived: false, createdBy: actor.id });
  if (options.emit !== false) {
    await emitEvent({ type: "financial_account.created", actor, entity: { type: "financial_account", id: account.id }, title: `Conta financeira ${account.name} cadastrada`, description: FINANCIAL_ACCOUNT_TYPE_LABELS[account.type], department: "financeiro", payload: { accountId: account.id, ...auditChanges(null, accountView(account), ACCOUNT_FIELDS) }, timeline: false });
  }
  return { account, created: true };
}

export async function setFinancialAccountArchived(id: string, archived: boolean, reason: string | undefined, actor: UserRef): Promise<FinancialAccount> {
  const all = await listFinancialAccounts();
  const current = all.find((a) => a.id === id);
  if (!current) throw new BusinessError("Conta financeira não encontrada");
  if (Boolean(current.archived) === archived) return current;
  if (!archived) {
    const dup = findActiveDuplicate(all, current.name, current.id);
    if (dup) throw new BusinessError(`Já existe uma conta ativa com o nome "${dup.name}"`);
  }
  const patch = archived ? { archived: true, archivedAt: nowIso(), archivedBy: actor.id, archiveReason: reason?.trim(), updatedBy: actor.id } : { archived: false, updatedBy: actor.id };
  await update<FinancialAccount>(COLLECTIONS.financialAccounts, id, patch);
  const next = { ...current, ...patch };
  await emitEvent({
    type: archived ? "financial_account.archived" : "financial_account.reactivated",
    actor,
    entity: { type: "financial_account", id },
    title: `Conta financeira ${current.name} ${archived ? "arquivada" : "reativada"}`,
    description: reason?.trim() || undefined,
    department: "financeiro",
    payload: { accountId: id, ...auditChanges(accountView(current), accountView(next), ["archived"], reason) },
    timeline: false,
  });
  return next;
}

// ---------------------------------------------------------------------------
// Centros de custo
// ---------------------------------------------------------------------------

export async function saveCostCenter(input: CostCenterInput & { legacyKey?: string }, actor: UserRef, options: EmitOptions & { reason?: string } = {}): Promise<{ center: CostCenter; created: boolean }> {
  const all = await listCostCenters();
  const dup = findActiveDuplicate(all, input.name, input.id);
  if (dup) throw new BusinessError(`Já existe o centro de custo "${dup.name}"`);
  const data = { name: input.name.trim().replace(/\s+/g, " "), description: input.description, updatedBy: actor.id };
  if (input.id) {
    const current = all.find((c) => c.id === input.id);
    if (!current) throw new BusinessError("Centro de custo não encontrado");
    const next: CostCenter = { ...current, ...data };
    const audit = auditChanges(centerView(current), centerView(next), CENTER_FIELDS);
    if (Object.keys(audit.changes).length === 0) return { center: current, created: false };
    await update<CostCenter>(COLLECTIONS.costCenters, current.id, { ...data, description: data.description ?? null } as unknown as Partial<CostCenter>);
    if (options.emit !== false) {
      await emitEvent({ type: "cost_center.updated", actor, entity: { type: "cost_center", id: current.id }, title: `Centro de custo ${next.name} alterado`, description: describe(audit), department: "financeiro", payload: { costCenterId: current.id, ...audit }, timeline: false });
    }
    return { center: next, created: false };
  }
  const center = await create<CostCenter>(COLLECTIONS.costCenters, { ...data, legacyKey: input.legacyKey, archived: false, createdBy: actor.id });
  if (options.emit !== false) {
    await emitEvent({ type: "cost_center.created", actor, entity: { type: "cost_center", id: center.id }, title: `Centro de custo ${center.name} cadastrado`, description: options.reason, department: "financeiro", payload: { costCenterId: center.id, ...auditChanges(null, centerView(center), CENTER_FIELDS, options.reason) }, timeline: false });
  }
  return { center, created: true };
}

export async function setCostCenterArchived(id: string, archived: boolean, reason: string | undefined, actor: UserRef): Promise<CostCenter> {
  const [all, categories] = await Promise.all([listCostCenters(), listFinanceCategories()]);
  const current = all.find((c) => c.id === id);
  if (!current) throw new BusinessError("Centro de custo não encontrado");
  if (Boolean(current.archived) === archived) return current;
  if (archived) {
    const inUse = activeCategoriesByCenter(categories).get(id) ?? 0;
    if (inUse > 0) throw new BusinessError(`${inUse} categoria(s) ativa(s) usam o centro "${current.name}": aplique outro centro a elas (manutenção em massa) antes de arquivar`);
  } else {
    const dup = findActiveDuplicate(all, current.name, current.id);
    if (dup) throw new BusinessError(`Já existe um centro ativo com o nome "${dup.name}"`);
  }
  const patch = archived ? { archived: true, archivedAt: nowIso(), archivedBy: actor.id, archiveReason: reason?.trim(), updatedBy: actor.id } : { archived: false, updatedBy: actor.id };
  await update<CostCenter>(COLLECTIONS.costCenters, id, patch);
  const next = { ...current, ...patch };
  await emitEvent({
    type: archived ? "cost_center.archived" : "cost_center.reactivated",
    actor,
    entity: { type: "cost_center", id },
    title: `Centro de custo ${current.name} ${archived ? "arquivado" : "reativado"}`,
    description: reason?.trim() || undefined,
    department: "financeiro",
    payload: { costCenterId: id, ...auditChanges(centerView(current), centerView(next), ["archived"], reason) },
    timeline: false,
  });
  return next;
}

// ---------------------------------------------------------------------------
// Categorias e subcategorias
// ---------------------------------------------------------------------------

export async function saveFinanceCategory(input: FinanceCategoryInput & { legacyKey?: string }, actor: UserRef, options: EmitOptions & { reason?: string } = {}): Promise<{ category: FinanceCategory; created: boolean }> {
  const [categories, centers, refs] = await Promise.all([listFinanceCategories(), listCostCenters(), input.id ? listCategoryReferences() : Promise.resolve([])]);
  const normalized = must(validateCategory({ id: input.id, name: input.name, type: input.type, parentId: input.parentId, costCenterId: input.costCenterId }, { categories, centers, usage: countCategoryUsage(refs) }));
  if (input.id) {
    const current = categories.find((c) => c.id === input.id)!;
    const next: FinanceCategory = { ...current, ...normalized, costCenterId: normalized.costCenterId, updatedBy: actor.id };
    const audit = auditChanges(categoryView(current, categories, centers), categoryView(next, categories, centers), CATEGORY_FIELDS);
    if (Object.keys(audit.changes).length === 0) return { category: current, created: false };
    // Subcategoria nunca grava centro próprio: null apaga o que houver.
    await update<FinanceCategory>(COLLECTIONS.financeCategories, current.id, { name: normalized.name, type: normalized.type, parentId: normalized.parentId, costCenterId: normalized.costCenterId ?? null, updatedBy: actor.id } as unknown as Partial<FinanceCategory>);
    if (options.emit !== false) {
      await emitEvent({ type: "finance_category.updated", actor, entity: { type: "finance_category", id: current.id }, title: `${current.parentId || next.parentId ? "Subcategoria" : "Categoria"} ${next.name} alterada`, description: describe(audit), department: "financeiro", payload: { categoryId: current.id, ...audit }, timeline: false });
    }
    return { category: next, created: false };
  }
  const category = await create<FinanceCategory>(COLLECTIONS.financeCategories, { ...normalized, legacyKey: input.legacyKey, archived: false, updatedBy: actor.id, createdBy: actor.id });
  if (options.emit !== false) {
    await emitEvent({
      type: "finance_category.created",
      actor,
      entity: { type: "finance_category", id: category.id },
      title: `${category.parentId ? "Subcategoria" : "Categoria"} ${category.name} cadastrada`,
      description: options.reason,
      department: "financeiro",
      payload: { categoryId: category.id, ...auditChanges(null, categoryView(category, categories, centers), CATEGORY_FIELDS, options.reason) },
      timeline: false,
    });
  }
  return { category, created: true };
}

/**
 * Arquivar categoria arquiva junto as subcategorias ativas (títulos e lançamentos continuam com o que têm gravado).
 * Reativar volta só ela; subcategoria exige a mãe ativa.
 */
export async function setFinanceCategoryArchived(id: string, archived: boolean, reason: string | undefined, actor: UserRef): Promise<{ category: FinanceCategory; subcategories: number; usage: number }> {
  const [categories, centers, refs] = await Promise.all([listFinanceCategories(), listCostCenters(), listCategoryReferences()]);
  const current = categories.find((c) => c.id === id);
  if (!current) throw new BusinessError("Categoria não encontrada");
  if (Boolean(current.archived) === archived) return { category: current, subcategories: 0, usage: 0 };
  const at = nowIso();
  const label = current.parentId ? "Subcategoria" : "Categoria";
  if (!archived) {
    must(validateReactivateCategory(current, categories, centers));
    const patch = { archived: false, updatedBy: actor.id };
    await update<FinanceCategory>(COLLECTIONS.financeCategories, id, patch);
    const next = { ...current, ...patch };
    await emitEvent({ type: "finance_category.reactivated", actor, entity: { type: "finance_category", id }, title: `${label} ${current.name} reativada`, description: reason?.trim() || undefined, department: "financeiro", payload: { categoryId: id, ...auditChanges(categoryView(current, categories, centers), categoryView(next, categories, centers), ["archived"], reason) }, timeline: false });
    return { category: next, subcategories: 0, usage: 0 };
  }
  const plan = planArchiveCategory(current, categories, countCategoryUsage(refs));
  const trimmed = reason?.trim();
  const patch = { archived: true, archivedAt: at, archivedBy: actor.id, archiveReason: trimmed, updatedBy: actor.id, updatedAt: at };
  const childReason = `Arquivada junto com a categoria ${current.name}${trimmed ? `: ${trimmed}` : ""}`;
  await batchSet([
    { collection: COLLECTIONS.financeCategories, id, data: patch, merge: true },
    ...plan.subcategories.map((s) => ({ collection: COLLECTIONS.financeCategories, id: s.id, data: { archived: true, archivedAt: at, archivedBy: actor.id, archiveReason: childReason, updatedBy: actor.id, updatedAt: at }, merge: true })),
  ]);
  const next = { ...current, ...patch };
  const audit = auditChanges(categoryView(current, categories, centers), categoryView(next, categories, centers), ["archived"], reason);
  if (plan.subcategories.length > 0) audit.changes.subcategoriesArchived = { from: null, to: plan.subcategories.map((s) => s.name).join(", ") };
  await emitEvent({
    type: "finance_category.archived",
    actor,
    entity: { type: "finance_category", id },
    title: `${label} ${current.name} arquivada${plan.subcategories.length ? ` com ${plan.subcategories.length} subcategoria(s)` : ""}`,
    description: [trimmed, plan.usage ? `${plan.usage} título(s)/lançamento(s) continuam com a classificação gravada` : null].filter(Boolean).join(" · ") || undefined,
    department: "financeiro",
    payload: { categoryId: id, subcategoryIds: plan.subcategories.map((s) => s.id), usage: plan.usage, ...audit },
    timeline: false,
  });
  for (const s of plan.subcategories) {
    await emitEvent({ type: "finance_category.archived", actor, entity: { type: "finance_category", id: s.id }, title: `Subcategoria ${s.name} arquivada`, description: childReason, department: "financeiro", payload: { categoryId: s.id, parentArchived: id, changes: { archived: { from: false, to: true } }, reason: childReason }, timeline: false });
  }
  return { category: next, subcategories: plan.subcategories.length, usage: plan.usage };
}

/** Aplicar um centro a várias categorias de nível 1 de uma vez. */
export async function applyCostCenterToCategories(categoryIds: readonly string[], costCenterId: string, reason: string | undefined, actor: UserRef): Promise<{ changed: number }> {
  const [categories, centers] = await Promise.all([listFinanceCategories(), listCostCenters()]);
  const moves = must(planApplyCostCenter(categoryIds, costCenterId, categories, centers));
  if (moves.length === 0) return { changed: 0 };
  const at = nowIso();
  await batchSet(moves.map((m) => ({ collection: COLLECTIONS.financeCategories, id: m.id, data: { costCenterId, updatedBy: actor.id, updatedAt: at }, merge: true })));
  const centerName = (cid: string | null) => (cid ? (centers.find((c) => c.id === cid)?.name ?? cid) : null);
  const target = centerName(costCenterId)!;
  const changes = Object.fromEntries(moves.map((m) => [m.name, { from: centerName(m.from), to: target }]));
  await emitEvent({
    type: "finance_category.bulk_updated",
    actor,
    entity: { type: "cost_center", id: costCenterId },
    title: `Centro ${target} aplicado a ${moves.length} categoria(s)`,
    description: moves.map((m) => m.name).join(", "),
    department: "financeiro",
    payload: { kind: "aplicar_centro", costCenterId, categoryIds: moves.map((m) => m.id), changes, ...(reason?.trim() ? { reason: reason.trim() } : {}) },
    timeline: false,
  });
  return { changed: moves.length };
}

/** Mover várias subcategorias para outra categoria-mãe (mesmo tipo). */
export async function moveSubcategories(subcategoryIds: readonly string[], targetParentId: string, reason: string | undefined, actor: UserRef): Promise<{ moved: number }> {
  const categories = await listFinanceCategories();
  const moves = must(planMoveSubcategories(subcategoryIds, targetParentId, categories));
  if (moves.length === 0) return { moved: 0 };
  const at = nowIso();
  await batchSet(moves.map((m) => ({ collection: COLLECTIONS.financeCategories, id: m.id, data: { parentId: targetParentId, updatedBy: actor.id, updatedAt: at }, merge: true })));
  const nameOf = (cid: string | null) => (cid ? (categories.find((c) => c.id === cid)?.name ?? cid) : null);
  const target = nameOf(targetParentId)!;
  const changes = Object.fromEntries(moves.map((m) => [m.name, { from: nameOf(m.from), to: target }]));
  await emitEvent({
    type: "finance_category.bulk_updated",
    actor,
    entity: { type: "finance_category", id: targetParentId },
    title: `${moves.length} subcategoria(s) movida(s) para ${target}`,
    description: moves.map((m) => m.name).join(", "),
    department: "financeiro",
    payload: { kind: "mover_subcategorias", targetParentId, subcategoryIds: moves.map((m) => m.id), changes, ...(reason?.trim() ? { reason: reason.trim() } : {}) },
    timeline: false,
  });
  return { moved: moves.length };
}

/**
 * Mesclar `sourceId` em `targetId`: subcategorias da origem passam para a destino; títulos e lançamentos de caixa com
 * `categoryId` da origem passam para a destino (com linha no histórico do título); a origem é arquivada com `mergedIntoId`.
 */
export async function mergeFinanceCategories(sourceId: string, targetId: string, reason: string, actor: UserRef): Promise<{ subcategories: number; records: number }> {
  const [categories, payables, entries, receivables] = await Promise.all([listFinanceCategories(), list<Payable>(COLLECTIONS.payables), list<CashEntry>(COLLECTIONS.cashEntries), list<Receivable>(COLLECTIONS.receivables)]);
  // Índices < payables.length = títulos; depois os lançamentos de caixa; por último os títulos a receber avulsos (etapa CP/CR 3).
  const refs = [...payables.map((p) => ({ categoryId: p.categoryId, costCenterId: p.costCenterId })), ...entries.map((e) => ({ categoryId: e.categoryId, costCenterId: e.costCenterId })), ...receivables.map((r) => ({ categoryId: r.categoryId, costCenterId: r.costCenterId }))];
  const entriesEnd = payables.length + entries.length;
  const recordId = (i: number) => (i < payables.length ? payables[i].id : i < entriesEnd ? entries[i - payables.length].id : receivables[i - entriesEnd].id);
  const plan = must(planMergeCategories(sourceId, targetId, categories, refs));
  const at = nowIso();
  const trimmed = reason.trim();
  const history = (p: Payable): PayableHistoryEntry[] => [...(p.history ?? []), { at, by: actor.id, byName: actor.name, action: "Categoria mesclada", reason: trimmed, changes: { Categoria: { from: plan.source.name, to: plan.target.name } } }];
  const receivableHistory = (r: Receivable): ReceivableHistoryEntry[] => [...(r.history ?? []), { at, by: actor.id, byName: actor.name, action: "Categoria mesclada", reason: trimmed, changes: { Categoria: { from: plan.source.name, to: plan.target.name } } }];
  await batchSet([
    { collection: COLLECTIONS.financeCategories, id: plan.source.id, data: { archived: true, archivedAt: at, archivedBy: actor.id, archiveReason: `Mesclada em ${plan.target.name}: ${trimmed}`, mergedIntoId: plan.target.id, updatedBy: actor.id, updatedAt: at }, merge: true },
    ...plan.movedSubcategories.map((m) => ({ collection: COLLECTIONS.financeCategories, id: m.id, data: { parentId: plan.target.id, updatedBy: actor.id, updatedAt: at }, merge: true })),
    ...plan.reassignedRecords.map((i) =>
      i < payables.length
        ? { collection: COLLECTIONS.payables, id: payables[i].id, data: { categoryId: plan.target.id, history: history(payables[i]), updatedAt: at }, merge: true }
        : i < entriesEnd
          ? { collection: COLLECTIONS.cashEntries, id: entries[i - payables.length].id, data: { categoryId: plan.target.id, updatedAt: at }, merge: true }
          : { collection: COLLECTIONS.receivables, id: receivables[i - entriesEnd].id, data: { categoryId: plan.target.id, history: receivableHistory(receivables[i - entriesEnd]), updatedAt: at }, merge: true },
    ),
  ]);
  const changes: AuditPayload["changes"] = { mergedInto: { from: null, to: plan.target.name }, archived: { from: false, to: true } };
  if (plan.movedSubcategories.length) changes.subcategoriesMoved = { from: null, to: plan.movedSubcategories.map((m) => m.name).join(", ") };
  if (plan.reassignedRecords.length) changes.recordsReassigned = { from: null, to: plan.reassignedRecords.length };
  await emitEvent({
    type: "finance_category.merged",
    actor,
    entity: { type: "finance_category", id: plan.source.id },
    title: `Categoria ${plan.source.name} mesclada em ${plan.target.name}`,
    description: [`${plan.movedSubcategories.length} subcategoria(s) e ${plan.reassignedRecords.length} título(s)/lançamento(s) transferidos`, trimmed].join(" · "),
    department: "financeiro",
    payload: { sourceId: plan.source.id, targetId: plan.target.id, subcategoryIds: plan.movedSubcategories.map((m) => m.id), recordIds: plan.reassignedRecords.map(recordId), changes, reason: trimmed },
    timeline: false,
  });
  return { subcategories: plan.movedSubcategories.length, records: plan.reassignedRecords.length };
}

// ---------------------------------------------------------------------------
// Importar da configuração atual (manual, idempotente, só cria)
// ---------------------------------------------------------------------------

export async function previewLegacyImport(defaultCenterName?: string): Promise<LegacyImportPlan> {
  const [setting, centers, categories, payables] = await Promise.all([getSetting<ContasAPagarConfig>("contas_a_pagar", SETTING_DEFAULTS.contas_a_pagar), listCostCenters(), listFinanceCategories(), list<Payable>(COLLECTIONS.payables)]);
  return planLegacyImport({ setting, centers, categories, payables: payables.map((p) => ({ category: p.category, costCenter: p.costCenter })), defaultCenterName });
}

/**
 * Cria centros (de `contas_a_pagar.centrosDeCusto`) e categorias de despesa (de `contas_a_pagar.categorias` + fixas do
 * circuito) que ainda não existem, guardando a chave antiga em `legacyKey`. Não altera títulos nem o setting.
 */
export async function importFinanceRegistryFromSettings(defaultCenterName: string | undefined, actor: UserRef, options: EmitOptions = {}): Promise<{ centers: number; categories: number; skipped: number }> {
  const plan = await previewLegacyImport(defaultCenterName);
  if (plan.categories.some((c) => !c.centerName)) throw new BusinessError("Escolha o centro de custo padrão para as categorias sem histórico de centro nos títulos");
  const reason = "Importado da configuração de Contas a Pagar";
  const createdCenters: CostCenter[] = [];
  for (const c of plan.centers) createdCenters.push((await saveCostCenter({ name: c.name, legacyKey: c.legacyKey }, actor, { emit: options.emit, reason })).center);
  const centers = await listCostCenters();
  const centerId = (name: string) => centers.find((c) => !c.archived && c.name.localeCompare(name, "pt-BR", { sensitivity: "base" }) === 0)?.id;
  let createdCategories = 0;
  for (const c of plan.categories) {
    const cid = centerId(c.centerName!);
    if (!cid) throw new BusinessError(`Centro de custo "${c.centerName}" não encontrado`);
    await saveFinanceCategory({ name: c.name, type: "despesa", parentId: null, costCenterId: cid, legacyKey: c.legacyKey }, actor, { emit: options.emit, reason });
    createdCategories++;
  }
  const skipped = plan.skippedCenters.length + plan.skippedCategories.length;
  if (options.emit !== false) {
    const changes: AuditPayload["changes"] = {};
    if (createdCenters.length) changes.centersCreated = { from: null, to: createdCenters.map((c) => c.name).join(", ") };
    if (createdCategories) changes.categoriesCreated = { from: null, to: plan.categories.map((c) => `${c.name} (${c.centerName})`).join(", ") };
    await emitEvent({
      type: "finance_registry.imported",
      actor,
      entity: { type: "finance_registry", id: "contas_a_pagar" },
      title: createdCenters.length || createdCategories ? `Importação da configuração: ${createdCenters.length} centro(s) e ${createdCategories} categoria(s) criados` : "Importação da configuração: nada novo a criar",
      description: skipped ? `${skipped} item(ns) já cadastrado(s) ficaram como estavam` : undefined,
      department: "financeiro",
      payload: { centers: createdCenters.map((c) => c.id), categories: createdCategories, skipped, defaultCenterName: defaultCenterName ?? null, changes, reason },
      timeline: false,
    });
  }
  return { centers: createdCenters.length, categories: createdCategories, skipped };
}

