/**
 * Cadastros financeiros (etapa CP/CR 1) — regras PURAS (sem Firestore, sem React): contas financeiras, centros de
 * custo e categorias de receita/despesa com subcategoria. Usadas pelo serviço (`src/server/finance-registry`), pela
 * tela "Cadastros financeiros", pelo `verify.ts` do seed e pelos testes.
 *
 * Hierarquia centro → categoria → subcategoria:
 * - categoria (parentId null): tipo receita|despesa e centro de custo OBRIGATÓRIO;
 * - subcategoria (parentId = mãe): mãe ativa de nível 1 obrigatória; herda tipo e centro e NÃO grava centro próprio;
 * - centro EFETIVO de um título/lançamento: o próprio → o da categoria → o da mãe (subcategoria) → "Sem centro de custo".
 */
import { PAYABLE_CATEGORIES, payableCategoryLabel } from "./commissions";
import type { CostCenter, FinanceCategory, FinanceCategoryType, FinancialAccountType } from "./types";

export const FINANCIAL_ACCOUNT_TYPES: readonly FinancialAccountType[] = ["corrente", "poupanca", "cartao", "dinheiro", "investimento", "outro"];
export const FINANCIAL_ACCOUNT_TYPE_LABELS: Record<FinancialAccountType, string> = {
  corrente: "Conta corrente",
  poupanca: "Poupança",
  cartao: "Cartão de crédito",
  dinheiro: "Dinheiro (caixa)",
  investimento: "Investimento",
  outro: "Outro",
};

export const FINANCE_CATEGORY_TYPES: readonly FinanceCategoryType[] = ["despesa", "receita"];
export const FINANCE_CATEGORY_TYPE_LABELS: Record<FinanceCategoryType, string> = { receita: "Receita", despesa: "Despesa" };

/** Rótulo do centro efetivo quando nada na cadeia tem centro. */
export const NO_COST_CENTER_LABEL = "Sem centro de custo";

/** Resultado de uma validação pura: o serviço transforma `error` em BusinessError (mensagem para o usuário). */
export type Check<T> = { ok: true; value: T } | { ok: false; error: string };
const fail = (error: string): { ok: false; error: string } => ({ ok: false, error });

/** Comparação de nomes sem maiúsculas, acentos nem espaços extras. */
export function nameKey(name: string): string {
  return name
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .trim()
    .replace(/\s+/g, " ")
    .toLowerCase();
}

/** Arredonda em centavos. */
export function roundCents(value: number): number {
  return Math.round(value * 100) / 100;
}

// ---------------------------------------------------------------------------
// Conta financeira: saldo
// ---------------------------------------------------------------------------

/** Movimento de uma conta (lançamento de caixa — etapa 2). Entrada soma, saída subtrai; valor sempre positivo. */
export interface AccountMovement {
  accountId: string;
  direction: "entrada" | "saida";
  amount: number;
}

/**
 * Saldo de uma conta = saldo inicial + entradas − saídas dos movimentos DESTA conta. Sem lançamentos (hoje), é o
 * saldo inicial: nenhum número é inventado.
 */
export function accountBalance(account: { id: string; initialBalance: number }, movements: readonly AccountMovement[] = []): number {
  let cents = Math.round((Number.isFinite(account.initialBalance) ? account.initialBalance : 0) * 100);
  for (const m of movements) {
    if (m.accountId !== account.id || !Number.isFinite(m.amount)) continue;
    const value = Math.round(Math.abs(m.amount) * 100);
    cents += m.direction === "entrada" ? value : -value;
  }
  return cents / 100;
}

// ---------------------------------------------------------------------------
// Unicidade de nomes (só entre registros ATIVOS; arquivados não bloqueiam)
// ---------------------------------------------------------------------------

export function findActiveDuplicate<T extends { id: string; name: string; archived: boolean }>(items: readonly T[], name: string, exceptId?: string, sameGroup: (item: T) => boolean = () => true): T | undefined {
  const key = nameKey(name);
  return items.find((i) => i.id !== exceptId && !i.archived && sameGroup(i) && nameKey(i.name) === key);
}

// ---------------------------------------------------------------------------
// Categorias: hierarquia e herança
// ---------------------------------------------------------------------------

export interface CategoryDraft {
  id?: string;
  name: string;
  type?: FinanceCategoryType;
  parentId?: string | null;
  costCenterId?: string | null;
}

export interface NormalizedCategory {
  name: string;
  type: FinanceCategoryType;
  parentId: string | null;
  /** Ausente na subcategoria. */
  costCenterId?: string;
}

export interface CategoryContext {
  categories: readonly FinanceCategory[];
  centers: readonly CostCenter[];
  /** Uso (títulos/lançamentos) por categoria; muda o que pode ser editado (tipo). */
  usage?: ReadonlyMap<string, number>;
}

export const isSubcategory = (c: Pick<FinanceCategory, "parentId">): boolean => Boolean(c.parentId);

/**
 * Valida criação/edição de categoria ou subcategoria e devolve o que deve ser gravado.
 * - Categoria: tipo e centro ativo obrigatórios ("Toda categoria precisa estar atrelada a um centro de custo").
 * - Subcategoria: mãe existente, ativa e de nível 1; herda o tipo; centro próprio é recusado.
 * - Nome único entre as irmãs ativas (mesmo nível; categorias: mesmo tipo).
 * - Edição: a categoria com subcategorias não vira subcategoria (seria nível 3); o tipo não muda se ela tiver
 *   subcategorias ou uso; subcategoria só troca de mãe para outra do mesmo tipo.
 */
export function validateCategory(draft: CategoryDraft, ctx: CategoryContext): Check<NormalizedCategory> {
  const name = draft.name.trim().replace(/\s+/g, " ");
  if (name.length < 2) return fail("Informe o nome (mín. 2 letras)");
  if (name.length > 80) return fail("Nome muito longo (máx. 80)");
  const byId = new Map(ctx.categories.map((c) => [c.id, c]));
  const current = draft.id ? byId.get(draft.id) : undefined;
  if (draft.id && !current) return fail("Categoria não encontrada");
  const parentId = draft.parentId || null;
  const children = current ? ctx.categories.filter((c) => c.parentId === current.id) : [];

  if (parentId) {
    const parent = byId.get(parentId);
    if (!parent) return fail("Categoria-mãe não encontrada");
    if (parent.id === draft.id) return fail("A categoria não pode ser mãe de si mesma");
    if (parent.parentId) return fail("A categoria-mãe precisa ser de nível 1 (subcategoria não tem subcategoria)");
    if (parent.archived) return fail(`A categoria-mãe "${parent.name}" está arquivada`);
    if (draft.costCenterId) return fail("Subcategoria não tem centro de custo próprio: herda o da categoria-mãe");
    if (current && children.length > 0) return fail(`"${current.name}" tem ${children.length} subcategoria(s) e não pode virar subcategoria`);
    if (current && current.parentId && current.parentId !== parentId && current.type !== parent.type) return fail(`A nova mãe precisa ser de ${FINANCE_CATEGORY_TYPE_LABELS[current.type].toLowerCase()}`);
    if (current && !current.parentId && current.type !== parent.type) return fail(`A categoria-mãe precisa ser de ${FINANCE_CATEGORY_TYPE_LABELS[current.type].toLowerCase()}`);
    const dup = findActiveDuplicate(ctx.categories, name, draft.id, (c) => c.parentId === parentId);
    if (dup) return fail(`Já existe a subcategoria "${dup.name}" em "${parent.name}"`);
    return { ok: true, value: { name, type: parent.type, parentId } };
  }

  const type = draft.type ?? current?.type;
  if (!type || !FINANCE_CATEGORY_TYPES.includes(type)) return fail("Escolha o tipo: receita ou despesa");
  if (!draft.costCenterId) return fail("Toda categoria precisa estar atrelada a um centro de custo");
  const center = ctx.centers.find((c) => c.id === draft.costCenterId);
  if (!center) return fail("Centro de custo não encontrado");
  if (center.archived && center.id !== current?.costCenterId) return fail(`O centro de custo "${center.name}" está arquivado`);
  if (current && current.type !== type) {
    if (children.length > 0) return fail(`O tipo não muda: "${current.name}" tem ${children.length} subcategoria(s)`);
    const used = ctx.usage?.get(current.id) ?? 0;
    if (used > 0) return fail(`O tipo não muda: "${current.name}" é usada em ${used} título(s)/lançamento(s)`);
  }
  const dup = findActiveDuplicate(ctx.categories, name, draft.id, (c) => !c.parentId && c.type === type);
  if (dup) return fail(`Já existe a categoria de ${FINANCE_CATEGORY_TYPE_LABELS[type].toLowerCase()} "${dup.name}"`);
  return { ok: true, value: { name, type, parentId: null, costCenterId: center.id } };
}

/** Centro gravado que vale para a categoria: o dela (nível 1) ou o da mãe (subcategoria). */
export function categoryCostCenterId(categoryId: string | undefined | null, categories: ReadonlyMap<string, FinanceCategory> | readonly FinanceCategory[]): string | null {
  if (!categoryId) return null;
  const byId = categories instanceof Map ? categories : new Map((categories as readonly FinanceCategory[]).map((c) => [c.id, c]));
  const category = byId.get(categoryId);
  if (!category) return null;
  if (category.parentId) return byId.get(category.parentId)?.costCenterId ?? null;
  return category.costCenterId ?? null;
}

export type EffectiveCostCenterSource = "proprio" | "categoria" | "categoria-mae" | "nenhum";

export interface EffectiveCostCenter {
  id: string | null;
  name: string;
  source: EffectiveCostCenterSource;
}

/**
 * Centro de custo EFETIVO de um título/lançamento: o próprio; se vazio, o da categoria; se a categoria é subcategoria,
 * o da mãe; sem nenhum, "Sem centro de custo". Id desconhecido no próprio campo continua valendo como "próprio" (o
 * nome vira o id, para não esconder dado gravado).
 */
export function resolveEffectiveCostCenter(record: { costCenterId?: string | null; categoryId?: string | null }, categories: readonly FinanceCategory[], centers: readonly CostCenter[]): EffectiveCostCenter {
  const centerName = (id: string) => centers.find((c) => c.id === id)?.name ?? id;
  if (record.costCenterId) return { id: record.costCenterId, name: centerName(record.costCenterId), source: "proprio" };
  const byId = new Map(categories.map((c) => [c.id, c]));
  const category = record.categoryId ? byId.get(record.categoryId) : undefined;
  if (category) {
    const id = categoryCostCenterId(category.id, byId);
    if (id) return { id, name: centerName(id), source: category.parentId ? "categoria-mae" : "categoria" };
  }
  return { id: null, name: NO_COST_CENTER_LABEL, source: "nenhum" };
}

// ---------------------------------------------------------------------------
// Uso (títulos e lançamentos) e arquivamento
// ---------------------------------------------------------------------------

/** Registro que referencia uma categoria/centro (título a pagar, lançamento de caixa…). */
export interface CategoryReference {
  categoryId?: string | null;
  costCenterId?: string | null;
}

/** Uso DIRETO por categoria (quantos registros apontam para ela). */
export function countCategoryUsage(records: readonly CategoryReference[]): Map<string, number> {
  const out = new Map<string, number>();
  for (const r of records) if (r.categoryId) out.set(r.categoryId, (out.get(r.categoryId) ?? 0) + 1);
  return out;
}

/** Uso da categoria somado ao das suas subcategorias (nível 1) ou só o direto (subcategoria). */
export function categoryUsageTotal(category: FinanceCategory, categories: readonly FinanceCategory[], usage: ReadonlyMap<string, number>): number {
  const own = usage.get(category.id) ?? 0;
  if (category.parentId) return own;
  return categories.filter((c) => c.parentId === category.id).reduce((sum, c) => sum + (usage.get(c.id) ?? 0), own);
}

export interface ArchiveCategoryPlan {
  /** Subcategorias ATIVAS que serão arquivadas junto. */
  subcategories: FinanceCategory[];
  /** Registros que usam a categoria (e as subcategorias, no nível 1): continuam gravados como estão. */
  usage: number;
}

/** O que arquivar a categoria leva junto (aviso antes de confirmar). */
export function planArchiveCategory(category: FinanceCategory, categories: readonly FinanceCategory[], usage: ReadonlyMap<string, number>): ArchiveCategoryPlan {
  const subcategories = category.parentId ? [] : categories.filter((c) => c.parentId === category.id && !c.archived);
  return { subcategories, usage: categoryUsageTotal(category, categories, usage) };
}

/** Reativar subcategoria exige a mãe ativa; nome continua único entre as ativas. */
export function validateReactivateCategory(category: FinanceCategory, categories: readonly FinanceCategory[], centers: readonly CostCenter[]): Check<null> {
  if (!category.archived) return { ok: true, value: null };
  if (category.mergedIntoId) return fail("Categoria mesclada em outra não pode ser reativada");
  if (category.parentId) {
    const parent = categories.find((c) => c.id === category.parentId);
    if (!parent || parent.archived) return fail("Reative antes a categoria-mãe");
  } else {
    const center = centers.find((c) => c.id === category.costCenterId);
    if (!center) return fail("Toda categoria precisa estar atrelada a um centro de custo");
    if (center.archived) return fail(`O centro de custo "${center.name}" está arquivado: reative-o ou aplique outro centro antes`);
  }
  const dup = findActiveDuplicate(categories, category.name, category.id, (c) => c.parentId === category.parentId && (category.parentId ? true : c.type === category.type));
  if (dup) return fail(`Já existe uma categoria ativa com o nome "${dup.name}"`);
  return { ok: true, value: null };
}

/** Categorias de nível 1 ATIVAS sem centro (dado antigo/inconsistente): o número aparece na tela. */
export function categoriesWithoutCenter(categories: readonly FinanceCategory[], centers: readonly CostCenter[]): FinanceCategory[] {
  const ids = new Set(centers.map((c) => c.id));
  return categories.filter((c) => !c.parentId && !c.archived && (!c.costCenterId || !ids.has(c.costCenterId)));
}

/** Categorias de nível 1 ativas por centro (bloqueia arquivar o centro em uso). */
export function activeCategoriesByCenter(categories: readonly FinanceCategory[]): Map<string, number> {
  const out = new Map<string, number>();
  for (const c of categories) if (!c.parentId && !c.archived && c.costCenterId) out.set(c.costCenterId, (out.get(c.costCenterId) ?? 0) + 1);
  return out;
}

// ---------------------------------------------------------------------------
// Manutenção em massa (planos puros: o serviço só grava o que o plano devolve)
// ---------------------------------------------------------------------------

export interface FieldMove {
  id: string;
  name: string;
  from: string | null;
  to: string;
}

/** Aplicar um centro a várias categorias de nível 1 (as que já estão nele ficam de fora). */
export function planApplyCostCenter(categoryIds: readonly string[], centerId: string, categories: readonly FinanceCategory[], centers: readonly CostCenter[]): Check<FieldMove[]> {
  const center = centers.find((c) => c.id === centerId);
  if (!center) return fail("Centro de custo não encontrado");
  if (center.archived) return fail(`O centro de custo "${center.name}" está arquivado`);
  const ids = Array.from(new Set(categoryIds));
  if (ids.length === 0) return fail("Selecione ao menos uma categoria");
  const out: FieldMove[] = [];
  for (const id of ids) {
    const c = categories.find((x) => x.id === id);
    if (!c) return fail("Categoria não encontrada");
    if (c.parentId) return fail(`"${c.name}" é subcategoria: o centro vem da categoria-mãe`);
    if (c.costCenterId === centerId) continue;
    out.push({ id: c.id, name: c.name, from: c.costCenterId ?? null, to: centerId });
  }
  return { ok: true, value: out };
}

/** Mover várias subcategorias para outra mãe (ativa, de nível 1, do mesmo tipo; sem nome repetido na destino). */
export function planMoveSubcategories(subcategoryIds: readonly string[], targetParentId: string, categories: readonly FinanceCategory[]): Check<FieldMove[]> {
  const target = categories.find((c) => c.id === targetParentId);
  if (!target) return fail("Categoria-mãe de destino não encontrada");
  if (target.parentId) return fail("O destino precisa ser uma categoria de nível 1");
  if (target.archived) return fail(`A categoria "${target.name}" está arquivada`);
  const ids = Array.from(new Set(subcategoryIds));
  if (ids.length === 0) return fail("Selecione ao menos uma subcategoria");
  const out: FieldMove[] = [];
  const incoming = new Map<string, string>();
  for (const id of ids) {
    const s = categories.find((x) => x.id === id);
    if (!s) return fail("Subcategoria não encontrada");
    if (!s.parentId) return fail(`"${s.name}" é categoria de nível 1, não subcategoria`);
    if (s.parentId === targetParentId) continue;
    if (s.type !== target.type) return fail(`"${s.name}" é de ${FINANCE_CATEGORY_TYPE_LABELS[s.type].toLowerCase()} e "${target.name}" é de ${FINANCE_CATEGORY_TYPE_LABELS[target.type].toLowerCase()}`);
    if (!s.archived) {
      const key = nameKey(s.name);
      const clash = categories.find((c) => c.parentId === targetParentId && !c.archived && nameKey(c.name) === key);
      if (clash || incoming.has(key)) return fail(`"${target.name}" já tem a subcategoria "${s.name}": mescle as duas antes de mover`);
      incoming.set(key, s.id);
    }
    out.push({ id: s.id, name: s.name, from: s.parentId, to: targetParentId });
  }
  return { ok: true, value: out };
}

export interface MergePlan {
  source: FinanceCategory;
  target: FinanceCategory;
  /** Subcategorias da origem que passam para a destino (ativas e arquivadas). */
  movedSubcategories: FieldMove[];
  /** Índices dos registros (na lista recebida) que passam a apontar para a destino. */
  reassignedRecords: number[];
}

/**
 * Mesclar a categoria `sourceId` em `targetId`: mesmo tipo; subcategorias da origem passam para a destino (que então
 * precisa ser de nível 1 e não ter subcategoria ativa com o mesmo nome); títulos/lançamentos da origem passam para a
 * destino; a origem é arquivada (com `mergedIntoId`).
 */
export function planMergeCategories(sourceId: string, targetId: string, categories: readonly FinanceCategory[], records: readonly CategoryReference[]): Check<MergePlan> {
  if (sourceId === targetId) return fail("Escolha duas categorias diferentes");
  const source = categories.find((c) => c.id === sourceId);
  const target = categories.find((c) => c.id === targetId);
  if (!source || !target) return fail("Categoria não encontrada");
  if (source.archived) return fail(`A origem "${source.name}" já está arquivada`);
  if (target.archived) return fail(`A destino "${target.name}" está arquivada`);
  if (source.type !== target.type) return fail("Só é possível mesclar categorias do mesmo tipo (receita com receita, despesa com despesa)");
  if (target.parentId === source.id) return fail(`"${target.name}" é subcategoria de "${source.name}": mova-a antes ou mescle no sentido inverso`);
  const children = categories.filter((c) => c.parentId === source.id);
  if (children.length > 0 && target.parentId) return fail(`"${source.name}" tem subcategorias: a destino precisa ser uma categoria de nível 1`);
  const targetChildren = new Set(categories.filter((c) => c.parentId === target.id && !c.archived).map((c) => nameKey(c.name)));
  const clash = children.find((c) => !c.archived && targetChildren.has(nameKey(c.name)));
  if (clash) return fail(`"${target.name}" já tem a subcategoria "${clash.name}": mescle as duas antes`);
  const movedSubcategories = children.map((c) => ({ id: c.id, name: c.name, from: source.id, to: target.id }));
  const reassignedRecords = records.flatMap((r, i) => (r.categoryId === source.id ? [i] : []));
  return { ok: true, value: { source, target, movedSubcategories, reassignedRecords } };
}

// ---------------------------------------------------------------------------
// Importar da configuração atual (setting contas_a_pagar) — só CRIA, idempotente
// ---------------------------------------------------------------------------

export interface LegacyImportInput {
  /** `contas_a_pagar.categorias` (chaves) e `.centrosDeCusto` (nomes). */
  setting: { categorias?: readonly string[]; centrosDeCusto?: readonly string[] };
  centers: readonly CostCenter[];
  categories: readonly FinanceCategory[];
  /** Títulos existentes (só leitura): inferem o centro mais usado em cada categoria antiga. */
  payables: readonly { category?: string; costCenter?: string }[];
  /** Nome do centro para as categorias sem histórico (um dos centros existentes ou a criar). */
  defaultCenterName?: string;
}

export interface LegacyImportPlan {
  centers: { name: string; legacyKey: string }[];
  categories: { name: string; legacyKey: string; centerName: string | null; centerSource: "historico" | "padrao" | null }[];
  skippedCenters: string[];
  skippedCategories: string[];
  /** Há categoria sem histórico de centro: o centro padrão é obrigatório. */
  needsDefaultCenter: boolean;
  /** Nomes de centros disponíveis (ativos existentes + a criar) para o centro padrão. */
  centerOptions: string[];
}

/**
 * Plano da importação manual: centros de `centrosDeCusto` e categorias de DESPESA de `categorias` + as fixas do
 * circuito, com a chave antiga em `legacyKey`. Já cadastrado (mesma chave antiga ou mesmo nome) fica de fora — rodar
 * duas vezes não duplica. Nada existente é alterado.
 */
export function planLegacyImport(input: LegacyImportInput): LegacyImportPlan {
  const centerNames: string[] = [];
  const seenCenter = new Set<string>();
  for (const raw of input.setting.centrosDeCusto ?? []) {
    if (typeof raw !== "string") continue;
    const name = raw.trim().replace(/\s+/g, " ");
    if (name.length < 2 || seenCenter.has(nameKey(name))) continue;
    seenCenter.add(nameKey(name));
    centerNames.push(name);
  }
  const existingCenter = (name: string) => input.centers.find((c) => (c.legacyKey && nameKey(c.legacyKey) === nameKey(name)) || nameKey(c.name) === nameKey(name));
  const centers = centerNames.filter((n) => !existingCenter(n)).map((n) => ({ name: n, legacyKey: n }));
  const skippedCenters = centerNames.filter((n) => existingCenter(n));
  const centerOptions = Array.from(new Map([...input.centers.filter((c) => !c.archived).map((c) => c.name), ...centers.map((c) => c.name)].map((n) => [nameKey(n), n])).values()).sort((a, b) => a.localeCompare(b, "pt-BR"));
  const optionByKey = new Map(centerOptions.map((n) => [nameKey(n), n]));

  const keys = Array.from(new Set([...(input.setting.categorias ?? []), ...PAYABLE_CATEGORIES].filter((k): k is string => typeof k === "string" && k.trim().length > 0).map((k) => k.trim())));
  const existingCategory = (key: string) =>
    input.categories.find((c) => !c.parentId && c.type === "despesa" && (c.legacyKey === key || nameKey(c.name) === nameKey(payableCategoryLabel(key))));
  const defaultCenter = input.defaultCenterName ? optionByKey.get(nameKey(input.defaultCenterName)) : undefined;
  const categories: LegacyImportPlan["categories"] = [];
  const skippedCategories: string[] = [];
  for (const key of keys) {
    if (existingCategory(key)) {
      skippedCategories.push(payableCategoryLabel(key));
      continue;
    }
    const counts = new Map<string, number>();
    for (const p of input.payables) {
      if (p.category !== key || !p.costCenter) continue;
      const option = optionByKey.get(nameKey(p.costCenter));
      if (option) counts.set(option, (counts.get(option) ?? 0) + 1);
    }
    const inferred = [...counts.entries()].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0], "pt-BR"))[0]?.[0];
    categories.push({ name: payableCategoryLabel(key), legacyKey: key, centerName: inferred ?? defaultCenter ?? null, centerSource: inferred ? "historico" : defaultCenter ? "padrao" : null });
  }
  return { centers, categories, skippedCenters, skippedCategories, needsDefaultCenter: categories.some((c) => c.centerSource !== "historico"), centerOptions };
}

// ---------------------------------------------------------------------------
// Invariantes (verify.ts do seed e testes)
// ---------------------------------------------------------------------------

/** Problemas de consistência da hierarquia (lista vazia = ok). */
export function registryProblems(categories: readonly FinanceCategory[], centers: readonly CostCenter[]): string[] {
  const problems: string[] = [];
  const byId = new Map(categories.map((c) => [c.id, c]));
  const centerIds = new Set(centers.map((c) => c.id));
  for (const c of categories) {
    if (!c.parentId) {
      if (!c.costCenterId) problems.push(`categoria ${c.id} (${c.name}) sem centro de custo`);
      else if (!centerIds.has(c.costCenterId)) problems.push(`categoria ${c.id} (${c.name}) aponta para centro inexistente ${c.costCenterId}`);
      continue;
    }
    if (c.costCenterId) problems.push(`subcategoria ${c.id} (${c.name}) grava centro próprio ${c.costCenterId}`);
    const parent = byId.get(c.parentId);
    if (!parent) problems.push(`subcategoria ${c.id} (${c.name}) aponta para mãe inexistente ${c.parentId}`);
    else if (parent.parentId) problems.push(`subcategoria ${c.id} (${c.name}) tem mãe de nível 2 (${parent.id})`);
    else if (parent.type !== c.type) problems.push(`subcategoria ${c.id} (${c.name}) é de ${c.type} e a mãe ${parent.id} de ${parent.type}`);
  }
  return problems;
}
