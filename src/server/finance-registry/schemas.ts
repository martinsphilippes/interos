/**
 * Validação (zod) das Server Actions dos cadastros financeiros (etapa CP/CR 1). As regras de hierarquia ficam em
 * `src/domain/finance-registry.ts` (puras); aqui só o formato da entrada.
 */
import { z } from "zod";
import { FINANCE_CATEGORY_TYPES, FINANCIAL_ACCOUNT_TYPES } from "@/domain/finance-registry";
import type { FinanceCategoryType, FinancialAccountType } from "@/domain/types";

const id = z.string().trim().min(1, "Registro inválido").max(120);
const optionalId = z
  .string()
  .trim()
  .max(120)
  .optional()
  .transform((v) => v || undefined);
const optionalText = (max: number, label: string) =>
  z
    .string()
    .trim()
    .max(max, `${label}: máx. ${max} caracteres`)
    .optional()
    .transform((v) => v || undefined);
const name = z.string().trim().min(2, "Informe o nome (mín. 2 letras)").max(80, "Nome muito longo (máx. 80)");
/** Motivo do arquivamento (obrigatório ao arquivar; opcional ao reativar). */
const reason = z.string().trim().max(500, "Motivo muito longo (máx. 500)").optional();

export const financialAccountSchema = z.object({
  id: optionalId,
  name,
  type: z.enum(FINANCIAL_ACCOUNT_TYPES as unknown as [FinancialAccountType, ...FinancialAccountType[]], { message: "Escolha o tipo da conta" }),
  initialBalance: z.coerce
    .number({ message: "Saldo inicial inválido" })
    .refine((n) => Number.isFinite(n) && Math.abs(n) < 1e12, "Saldo inicial inválido")
    .transform((n) => Math.round(n * 100) / 100),
  bankName: optionalText(80, "Banco"),
  agency: optionalText(20, "Agência"),
  accountNumber: optionalText(30, "Número da conta"),
  notes: optionalText(500, "Observações"),
});
/** Entrada já validada (chaves opcionais podem faltar quando o serviço é chamado pelo seed/scripts). */
export type FinancialAccountInput = Partial<z.infer<typeof financialAccountSchema>> & Pick<z.infer<typeof financialAccountSchema>, "name" | "type" | "initialBalance">;

export const costCenterSchema = z.object({
  id: optionalId,
  name,
  description: optionalText(300, "Descrição"),
});
export type CostCenterInput = Partial<z.infer<typeof costCenterSchema>> & Pick<z.infer<typeof costCenterSchema>, "name">;

export const financeCategorySchema = z.object({
  id: optionalId,
  name,
  type: z.enum(FINANCE_CATEGORY_TYPES as unknown as [FinanceCategoryType, ...FinanceCategoryType[]], { message: "Escolha o tipo: receita ou despesa" }).optional(),
  parentId: z
    .string()
    .trim()
    .max(120)
    .nullish()
    .transform((v) => v || null),
  costCenterId: z
    .string()
    .trim()
    .max(120)
    .nullish()
    .transform((v) => v || null),
});
export type FinanceCategoryInput = Partial<z.infer<typeof financeCategorySchema>> & Pick<z.infer<typeof financeCategorySchema>, "name">;

export const archiveSchema = z
  .object({ id, archived: z.boolean(), reason })
  .refine((v) => !v.archived || (v.reason ?? "").trim().length >= 5, { message: "Informe o motivo do arquivamento (mín. 5 caracteres)", path: ["reason"] });
export type ArchiveInput = z.infer<typeof archiveSchema>;

const ids = z.array(id).min(1, "Selecione ao menos um item").max(300, "Selecione no máximo 300 itens");

export const applyCostCenterSchema = z.object({ categoryIds: ids, costCenterId: id, reason });
export const moveSubcategoriesSchema = z.object({ subcategoryIds: ids, targetParentId: id, reason });
export const mergeCategoriesSchema = z
  .object({ sourceId: id, targetId: id, reason: z.string().trim().min(5, "Informe o motivo da mesclagem (mín. 5 caracteres)").max(500) })
  .refine((v) => v.sourceId !== v.targetId, { message: "Escolha duas categorias diferentes", path: ["targetId"] });
export const importSchema = z.object({ defaultCenterName: optionalText(80, "Centro padrão") });
