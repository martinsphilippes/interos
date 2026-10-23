"use server";
/**
 * Server Actions dos cadastros financeiros (etapa CP/CR 1). Padrão (A5): requirePermission("<chave do catálogo>",
 * tela financeiro.cadastros em src/domain/permissions/financeiro.ts) → zod → serviço (regras puras + auditoria) →
 * revalidatePath → ActionResult. Falhas pelo tratamento único (failAction).
 */
import { revalidatePath } from "next/cache";
import { PermissionError, can, failAction, requirePermission } from "@/server/auth/session";
import type { ActionResult, CurrentUser, UserRef } from "@/domain/types";
import { applyCostCenterSchema, archiveSchema, costCenterSchema, financeCategorySchema, financialAccountSchema, importSchema, mergeCategoriesSchema, moveSubcategoriesSchema, readjustmentIndexSchema, readjustmentIndexValueSchema, refreshIndicesSchema } from "./schemas";
import { refreshReadjustmentIndices, saveReadjustmentIndex, setReadjustmentIndexArchived, setReadjustmentIndexValue, type IndexRefreshItem } from "./indices";
import {
  applyCostCenterToCategories,
  importFinanceRegistryFromSettings,
  mergeFinanceCategories,
  moveSubcategories,
  saveCostCenter,
  saveFinanceCategory,
  saveFinancialAccount,
  setCostCenterArchived,
  setFinanceCategoryArchived,
  setFinancialAccountArchived,
} from "./service";

const actorOf = (user: CurrentUser): UserRef => ({ id: user.id, name: user.name });

function revalidateRegistry() {
  revalidatePath("/financeiro/cadastros");
}

/** Id presente no argumento bruto (decide entre as chaves de criar e editar antes da validação). */
function rawId(input: unknown): boolean {
  const id = input && typeof input === "object" ? (input as { id?: unknown }).id : undefined;
  return typeof id === "string" && id.trim().length > 0;
}

// ---------------------------------------------------------------------------
// Contas financeiras
// ---------------------------------------------------------------------------

export async function saveFinancialAccountAction(input: unknown): Promise<ActionResult<{ id: string; created: boolean }>> {
  try {
    // Com id = editar; sem id = cadastrar.
    const user = rawId(input) ? await requirePermission("financeiro.cadastros.contas.editar") : await requirePermission("financeiro.cadastros.contas.criar");
    const data = financialAccountSchema.parse(input);
    // Sem "Visualizar valores" (A13) o saldo nem chega à tela: editar a conta regravaria um saldo que a pessoa não vê.
    if (data.id && !can(user, "financeiro.valores.ver")) throw new PermissionError("Editar a conta financeira exige visualizar valores (saldo inicial)");
    const r = await saveFinancialAccount(data, actorOf(user));
    revalidateRegistry();
    return { ok: true, data: { id: r.account.id, created: r.created } };
  } catch (error) {
    return failAction(error, "Não foi possível salvar a conta financeira", "cadastros");
  }
}

export async function setFinancialAccountArchivedAction(input: unknown): Promise<ActionResult<{ archived: boolean }>> {
  try {
    const user = await requirePermission("financeiro.cadastros.contas.arquivar");
    const data = archiveSchema.parse(input);
    const a = await setFinancialAccountArchived(data.id, data.archived, data.reason, actorOf(user));
    revalidateRegistry();
    return { ok: true, data: { archived: Boolean(a.archived) } };
  } catch (error) {
    return failAction(error, "Não foi possível alterar a conta financeira", "cadastros");
  }
}

// ---------------------------------------------------------------------------
// Centros de custo
// ---------------------------------------------------------------------------

export async function saveCostCenterAction(input: unknown): Promise<ActionResult<{ id: string; created: boolean }>> {
  try {
    const user = rawId(input) ? await requirePermission("financeiro.cadastros.centros.editar") : await requirePermission("financeiro.cadastros.centros.criar");
    const data = costCenterSchema.parse(input);
    const r = await saveCostCenter(data, actorOf(user));
    revalidateRegistry();
    return { ok: true, data: { id: r.center.id, created: r.created } };
  } catch (error) {
    return failAction(error, "Não foi possível salvar o centro de custo", "cadastros");
  }
}

export async function setCostCenterArchivedAction(input: unknown): Promise<ActionResult<{ archived: boolean }>> {
  try {
    const user = await requirePermission("financeiro.cadastros.centros.arquivar");
    const data = archiveSchema.parse(input);
    const c = await setCostCenterArchived(data.id, data.archived, data.reason, actorOf(user));
    revalidateRegistry();
    return { ok: true, data: { archived: Boolean(c.archived) } };
  } catch (error) {
    return failAction(error, "Não foi possível alterar o centro de custo", "cadastros");
  }
}

// ---------------------------------------------------------------------------
// Categorias e subcategorias
// ---------------------------------------------------------------------------

export async function saveFinanceCategoryAction(input: unknown): Promise<ActionResult<{ id: string; created: boolean }>> {
  try {
    const user = rawId(input) ? await requirePermission("financeiro.cadastros.categorias.editar") : await requirePermission("financeiro.cadastros.categorias.criar");
    const data = financeCategorySchema.parse(input);
    const r = await saveFinanceCategory(data, actorOf(user));
    revalidateRegistry();
    return { ok: true, data: { id: r.category.id, created: r.created } };
  } catch (error) {
    return failAction(error, "Não foi possível salvar a categoria", "cadastros");
  }
}

export async function setFinanceCategoryArchivedAction(input: unknown): Promise<ActionResult<{ archived: boolean; subcategories: number; usage: number }>> {
  try {
    const user = await requirePermission("financeiro.cadastros.categorias.arquivar");
    const data = archiveSchema.parse(input);
    const r = await setFinanceCategoryArchived(data.id, data.archived, data.reason, actorOf(user));
    revalidateRegistry();
    return { ok: true, data: { archived: Boolean(r.category.archived), subcategories: r.subcategories, usage: r.usage } };
  } catch (error) {
    return failAction(error, "Não foi possível alterar a categoria", "cadastros");
  }
}

export async function applyCostCenterToCategoriesAction(input: unknown): Promise<ActionResult<{ changed: number }>> {
  try {
    const user = await requirePermission("financeiro.cadastros.categorias.reorganizar");
    const data = applyCostCenterSchema.parse(input);
    const r = await applyCostCenterToCategories(data.categoryIds, data.costCenterId, data.reason, actorOf(user));
    revalidateRegistry();
    return { ok: true, data: r };
  } catch (error) {
    return failAction(error, "Não foi possível aplicar o centro de custo", "cadastros");
  }
}

export async function moveSubcategoriesAction(input: unknown): Promise<ActionResult<{ moved: number }>> {
  try {
    const user = await requirePermission("financeiro.cadastros.categorias.reorganizar");
    const data = moveSubcategoriesSchema.parse(input);
    const r = await moveSubcategories(data.subcategoryIds, data.targetParentId, data.reason, actorOf(user));
    revalidateRegistry();
    return { ok: true, data: r };
  } catch (error) {
    return failAction(error, "Não foi possível mover as subcategorias", "cadastros");
  }
}

export async function mergeFinanceCategoriesAction(input: unknown): Promise<ActionResult<{ subcategories: number; records: number }>> {
  try {
    const user = await requirePermission("financeiro.cadastros.categorias.mesclar");
    const data = mergeCategoriesSchema.parse(input);
    const r = await mergeFinanceCategories(data.sourceId, data.targetId, data.reason, actorOf(user));
    revalidateRegistry();
    revalidatePath("/financeiro/contas-a-pagar");
    return { ok: true, data: r };
  } catch (error) {
    return failAction(error, "Não foi possível mesclar as categorias", "cadastros");
  }
}

// ---------------------------------------------------------------------------
// Índices de reajuste
// ---------------------------------------------------------------------------

function revalidateIndices() {
  revalidateRegistry();
  revalidatePath("/financeiro/contratos", "layout");
}

/** Resumo da busca para o aviso da tela. */
function refreshText(items: IndexRefreshItem[]): string {
  return items
    .map((i) => (i.status === "erro" ? `${i.name}: ${i.error}` : i.status === "atualizado" ? `${i.name}: ${i.newMonths.length} mês(es) novo(s)${i.revisedMonths.length ? `, ${i.revisedMonths.length} revisado(s)` : ""}` : i.status === "sem_novidade" ? `${i.name}: nada novo` : i.status === "manual" ? `${i.name}: manual` : `${i.name}: em dia`))
    .join(" · ");
}

export async function saveReadjustmentIndexAction(input: unknown): Promise<ActionResult<{ id: string; created: boolean; refresh?: string; refreshError?: boolean }>> {
  try {
    const user = rawId(input) ? await requirePermission("financeiro.cadastros.indices.editar") : await requirePermission("financeiro.cadastros.indices.criar");
    const data = readjustmentIndexSchema.parse(input);
    const r = await saveReadjustmentIndex(data, actorOf(user));
    revalidateIndices();
    return { ok: true, data: { id: r.index.id, created: r.created, ...(r.refresh ? { refresh: refreshText([r.refresh]), refreshError: r.refresh.status === "erro" } : {}) } };
  } catch (error) {
    return failAction(error, "Não foi possível salvar o índice", "cadastros");
  }
}

export async function setReadjustmentIndexArchivedAction(input: unknown): Promise<ActionResult<{ archived: boolean }>> {
  try {
    const user = await requirePermission("financeiro.cadastros.indices.arquivar");
    const data = archiveSchema.parse(input);
    const r = await setReadjustmentIndexArchived(data.id, data.archived, data.reason, actorOf(user));
    revalidateIndices();
    return { ok: true, data: { archived: Boolean(r.archived) } };
  } catch (error) {
    return failAction(error, "Não foi possível alterar o índice", "cadastros");
  }
}

export async function setReadjustmentIndexValueAction(input: unknown): Promise<ActionResult> {
  try {
    const user = await requirePermission("financeiro.cadastros.indices.editar");
    const data = readjustmentIndexValueSchema.parse(input);
    await setReadjustmentIndexValue(data, actorOf(user));
    revalidateIndices();
    return { ok: true, data: undefined };
  } catch (error) {
    return failAction(error, "Não foi possível lançar o mês", "cadastros");
  }
}

export async function refreshReadjustmentIndicesAction(input: unknown): Promise<ActionResult<{ updated: number; errors: number; summary: string }>> {
  try {
    const user = await requirePermission("financeiro.cadastros.indices.atualizar");
    const data = refreshIndicesSchema.parse(input ?? {});
    const r = await refreshReadjustmentIndices({ force: true, ids: data.ids, actor: actorOf(user) });
    revalidateIndices();
    return { ok: true, data: { updated: r.updated, errors: r.errors, summary: refreshText(r.items) } };
  } catch (error) {
    return failAction(error, "Não foi possível buscar os índices", "cadastros");
  }
}

// ---------------------------------------------------------------------------
// Importar da configuração atual
// ---------------------------------------------------------------------------

export async function importFinanceRegistryAction(input: unknown): Promise<ActionResult<{ centers: number; categories: number; skipped: number }>> {
  try {
    const user = await requirePermission("financeiro.cadastros.importar");
    const data = importSchema.parse(input ?? {});
    const r = await importFinanceRegistryFromSettings(data.defaultCenterName, actorOf(user));
    revalidateRegistry();
    return { ok: true, data: r };
  } catch (error) {
    return failAction(error, "Não foi possível importar da configuração", "cadastros");
  }
}
