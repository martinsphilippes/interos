/**
 * Classificação do título no formulário (etapa CP/CR 4): Centro de custo → Categoria → Subcategoria, a partir dos
 * cadastros financeiros (etapa 1). Regras PURAS usadas pelos serviços (validação e campos antigos), pelas telas (listas
 * dos três selects) e pelos testes (`tests/finance/title-classification.test.ts`).
 *
 *  - A pagar lista só categorias de DESPESA; a receber, só de RECEITA. Só cadastros ATIVOS.
 *  - Escolher o centro limita as categorias às daquele centro; escolher a categoria preenche o centro (editável);
 *    subcategoria lista só as filhas ativas da categoria escolhida.
 *  - Grava `categoryId` = subcategoria quando escolhida, senão a categoria; ao editar, separa de volta (`splitCategoryId`).
 *  - COMPATIBILIDADE (Contas a Pagar): os campos antigos `Payable.category` (chave do setting) e `Payable.costCenter`
 *    (nome) continuam gravados para listas, filtros, relatório e KPIs existentes — derivados do cadastro
 *    (`legacyPayableFields`): categoria = `legacyKey` da (sub)categoria ou da mãe, senão "outros"; centro = `legacyKey`
 *    do centro efetivo, senão o NOME do centro.
 */
import type { CostCenter, FinanceCategory, FinanceCategoryType } from "./types";
import type { Check } from "./finance-registry";

/** Categoria antiga usada quando o cadastro não tem chave antiga (`legacyKey`). */
export const LEGACY_FALLBACK_CATEGORY = "outros";
/** Chaves antigas que só o motor de comissões cria (nunca em lançamento manual). */
export const ENGINE_ONLY_CATEGORY_KEYS: readonly string[] = ["comissao_comercial", "estorno_comissao"];

export interface ClassificationCenterOption {
  value: string;
  label: string;
}
export interface ClassificationCategoryOption {
  value: string;
  label: string;
  /** Centro gravado na categoria (preenche o centro ao escolher). */
  costCenterId: string | null;
}
export interface ClassificationSubcategoryOption {
  value: string;
  label: string;
  parentId: string;
}

/** Listas dos três selects (só cadastros ativos do tipo pedido). */
export interface ClassificationOptions {
  type: FinanceCategoryType;
  centers: ClassificationCenterOption[];
  categories: ClassificationCategoryOption[];
  subcategories: ClassificationSubcategoryOption[];
}

type Cat = Pick<FinanceCategory, "id" | "name" | "type" | "parentId" | "costCenterId" | "archived" | "legacyKey">;
type Center = Pick<CostCenter, "id" | "name" | "archived" | "legacyKey">;

const byLabel = (a: { label: string }, b: { label: string }) => a.label.localeCompare(b.label, "pt-BR");

/** Chave antiga efetiva da categoria (própria ou da mãe). */
function legacyKeyOf(category: Cat | undefined, byId: ReadonlyMap<string, Cat>): string | undefined {
  if (!category) return undefined;
  if (category.legacyKey) return category.legacyKey;
  return category.parentId ? byId.get(category.parentId)?.legacyKey : undefined;
}

/**
 * Opções dos selects para um tipo (despesa = a pagar; receita = a receber). Contas a Pagar também tira as categorias
 * que só o motor de comissões usa (`excludeEngineOnly`).
 */
export function classificationOptions(categories: readonly Cat[], centers: readonly Center[], type: FinanceCategoryType, options: { excludeEngineOnly?: boolean } = {}): ClassificationOptions {
  const activeCenters = centers.filter((c) => !c.archived);
  const centerIds = new Set(activeCenters.map((c) => c.id));
  const byId = new Map(categories.map((c) => [c.id, c]));
  const blocked = (c: Cat) => Boolean(options.excludeEngineOnly && ENGINE_ONLY_CATEGORY_KEYS.includes(legacyKeyOf(c, byId) ?? ""));
  const parents = categories.filter((c) => !c.parentId && !c.archived && c.type === type && !blocked(c));
  const parentIds = new Set(parents.map((c) => c.id));
  return {
    type,
    centers: activeCenters.map((c) => ({ value: c.id, label: c.name })).sort(byLabel),
    categories: parents.map((c) => ({ value: c.id, label: c.name, costCenterId: c.costCenterId && centerIds.has(c.costCenterId) ? c.costCenterId : null })).sort(byLabel),
    subcategories: categories
      .filter((c) => c.parentId && !c.archived && parentIds.has(c.parentId))
      .map((c) => ({ value: c.id, label: c.name, parentId: c.parentId! }))
      .sort(byLabel),
  };
}

/** Há cadastros suficientes para o formulário novo (ao menos uma categoria ativa do tipo)? */
export function hasClassification(options: ClassificationOptions | null | undefined): boolean {
  return Boolean(options && options.categories.length > 0);
}

/**
 * Categorias do select conforme o centro escolhido: as daquele centro; sem centro, todas. A categoria já escolhida
 * continua na lista (o centro é editável depois de escolher a categoria).
 */
export function categoriesForCenter(options: ClassificationOptions, centerId: string, selectedCategoryId?: string): ClassificationCategoryOption[] {
  if (!centerId) return options.categories;
  return options.categories.filter((c) => c.costCenterId === centerId || c.value === selectedCategoryId);
}

/** Subcategorias (filhas ativas) da categoria escolhida. */
export function subcategoriesOf(options: ClassificationOptions, categoryId: string): ClassificationSubcategoryOption[] {
  if (!categoryId) return [];
  return options.subcategories.filter((s) => s.parentId === categoryId);
}

/** Valor gravado: a subcategoria quando escolhida, senão a categoria (vazio = sem categoria). */
export function titleCategoryId(selection: { categoryId?: string; subcategoryId?: string }): string | undefined {
  return selection.subcategoryId || selection.categoryId || undefined;
}

/** Separa o `categoryId` gravado nos dois campos do formulário (categoria-mãe + subcategoria). */
export function splitCategoryId(categoryId: string | undefined | null, categories: readonly Pick<FinanceCategory, "id" | "parentId">[]): { categoryId: string; subcategoryId: string } {
  if (!categoryId) return { categoryId: "", subcategoryId: "" };
  const c = categories.find((x) => x.id === categoryId);
  if (c?.parentId) return { categoryId: c.parentId, subcategoryId: c.id };
  return { categoryId, subcategoryId: "" };
}

/** Mesma separação a partir das opções do formulário (cliente: só tem as listas, não os cadastros). */
export function splitCategoryOption(categoryId: string | undefined | null, options: ClassificationOptions): { categoryId: string; subcategoryId: string } {
  if (!categoryId) return { categoryId: "", subcategoryId: "" };
  const sub = options.subcategories.find((s) => s.value === categoryId);
  return sub ? { categoryId: sub.parentId, subcategoryId: sub.value } : { categoryId, subcategoryId: "" };
}

export interface ResolvedClassification {
  categoryId?: string;
  costCenterId?: string;
  /** Centro efetivo (próprio ou da categoria/mãe), para os campos antigos e a exibição. */
  effectiveCostCenterId?: string;
  names: { category?: string; subcategory?: string; center?: string };
}

/**
 * Valida a classificação de um título contra os cadastros: categoria/subcategoria ATIVA do tipo certo (a pagar =
 * despesa, a receber = receita; Contas a Pagar recusa as chaves do motor de comissões), mãe ativa, centro ativo.
 */
export function resolveClassification(input: { categoryId?: string; costCenterId?: string }, type: FinanceCategoryType, categories: readonly Cat[], centers: readonly Center[], options: { excludeEngineOnly?: boolean } = {}): Check<ResolvedClassification> {
  const byId = new Map(categories.map((c) => [c.id, c]));
  const names: ResolvedClassification["names"] = {};
  let categoryId: string | undefined;
  if (input.categoryId) {
    const c = byId.get(input.categoryId);
    if (!c || c.archived) return { ok: false, error: "Categoria não encontrada ou arquivada" };
    const parent = c.parentId ? byId.get(c.parentId) : undefined;
    if (c.parentId && (!parent || parent.archived)) return { ok: false, error: "A categoria-mãe desta subcategoria está arquivada" };
    const kind = parent?.type ?? c.type;
    if (kind !== type) return { ok: false, error: type === "despesa" ? `A categoria "${c.name}" é de receita: título a pagar usa só categorias de DESPESA` : `A categoria "${c.name}" é de despesa: título a receber usa só categorias de RECEITA` };
    if (options.excludeEngineOnly && ENGINE_ONLY_CATEGORY_KEYS.includes(legacyKeyOf(c, byId) ?? "")) return { ok: false, error: "Comissões e estornos nascem do motor de comissões, não de lançamento manual" };
    categoryId = c.id;
    if (parent) {
      names.category = parent.name;
      names.subcategory = c.name;
    } else names.category = c.name;
  }
  let costCenterId: string | undefined;
  if (input.costCenterId) {
    const center = centers.find((x) => x.id === input.costCenterId);
    if (!center || center.archived) return { ok: false, error: "Centro de custo não encontrado ou arquivado" };
    costCenterId = center.id;
  }
  // Centro efetivo: o próprio; senão o da categoria (subcategoria: o da mãe) — mesma regra de categoryCostCenterId.
  const chosen = categoryId ? byId.get(categoryId) : undefined;
  const effective = costCenterId ?? (chosen ? (chosen.parentId ? byId.get(chosen.parentId)?.costCenterId : chosen.costCenterId) : undefined) ?? undefined;
  if (effective) names.center = centers.find((x) => x.id === effective)?.name;
  return { ok: true, value: { categoryId, costCenterId, effectiveCostCenterId: effective, names } };
}

/**
 * Campos ANTIGOS do título a pagar derivados do cadastro (compatibilidade com listas, filtros, relatório e KPIs):
 * `category` = chave antiga da (sub)categoria ou da mãe, senão "outros" (só quando há categoria; sem categoria = undefined,
 * o chamador mantém o que tinha); `costCenter` = chave antiga do centro efetivo, senão o nome dele.
 */
export function legacyPayableFields(resolved: Pick<ResolvedClassification, "categoryId" | "effectiveCostCenterId">, categories: readonly Cat[], centers: readonly Center[]): { category?: string; costCenter?: string } {
  const byId = new Map(categories.map((c) => [c.id, c]));
  const category = resolved.categoryId ? (legacyKeyOf(byId.get(resolved.categoryId), byId) ?? LEGACY_FALLBACK_CATEGORY) : undefined;
  const center = resolved.effectiveCostCenterId ? centers.find((c) => c.id === resolved.effectiveCostCenterId) : undefined;
  return { category, costCenter: center ? center.legacyKey || center.name : undefined };
}

/** "Mãe › Filha" para exibição (ou só o nome da categoria). */
export function classificationLabel(names: { category?: string; subcategory?: string }): string | undefined {
  if (!names.category) return undefined;
  return names.subcategory ? `${names.category} › ${names.subcategory}` : names.category;
}
