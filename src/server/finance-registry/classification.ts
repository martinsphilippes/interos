import "server-only";
/**
 * Classificação dos títulos pelos cadastros financeiros (etapa CP/CR 4): leitura dos cadastros para os três selects do
 * formulário (Centro → Categoria → Subcategoria), validação no servidor e conta prevista. Regras puras em
 * `src/domain/title-classification.ts`; aqui só a leitura (Firestore) e as mensagens de erro de negócio.
 */
import { getById, list } from "@/server/db";
import { BusinessError } from "@/server/auth/error-classes";
import { classificationOptions, legacyPayableFields, resolveClassification, type ClassificationOptions, type ResolvedClassification } from "@/domain/title-classification";
import { COLLECTIONS, type CostCenter, type FinanceCategory, type FinanceCategoryType, type FinancialAccount } from "@/domain/types";

export interface ClassificationContext {
  categories: FinanceCategory[];
  centers: CostCenter[];
}

export async function loadClassificationContext(): Promise<ClassificationContext> {
  const [categories, centers] = await Promise.all([list<FinanceCategory>(COLLECTIONS.financeCategories), list<CostCenter>(COLLECTIONS.costCenters)]);
  return { categories: categories.map((c) => ({ ...c, parentId: c.parentId ?? null })), centers };
}

/**
 * Listas dos selects: a pagar (despesa, sem as categorias que só o motor de comissões usa) ou a receber (receita).
 * Sem nenhuma categoria ativa do tipo, o formulário volta ao comportamento anterior (aviso + link para os cadastros).
 */
export function optionsFor(ctx: ClassificationContext, type: FinanceCategoryType): ClassificationOptions {
  return classificationOptions(ctx.categories, ctx.centers, type, { excludeEngineOnly: type === "despesa" });
}

/** Valida a classificação (BusinessError com a mensagem para o usuário) e devolve ids e nomes. */
export function resolveOrThrow(input: { categoryId?: string; costCenterId?: string }, type: FinanceCategoryType, ctx: ClassificationContext): ResolvedClassification {
  const r = resolveClassification(input, type, ctx.categories, ctx.centers, { excludeEngineOnly: type === "despesa" });
  if (!r.ok) throw new BusinessError(r.error);
  return r.value;
}

/** Campos antigos do título a pagar (`category` chave, `costCenter` nome) derivados do cadastro. */
export function legacyFieldsFor(resolved: ResolvedClassification, ctx: ClassificationContext): { category?: string; costCenter?: string } {
  return legacyPayableFields(resolved, ctx.categories, ctx.centers);
}

/** Conta financeira prevista: existe e está ativa (BusinessError caso contrário). */
export async function readPlannedAccount(accountId: string | undefined): Promise<FinancialAccount | undefined> {
  if (!accountId) return undefined;
  const account = await getById<FinancialAccount>(COLLECTIONS.financialAccounts, accountId);
  if (!account || account.archived) throw new BusinessError("Conta financeira prevista não encontrada ou arquivada");
  return account;
}
