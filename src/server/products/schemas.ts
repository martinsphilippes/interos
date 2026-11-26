/**
 * Schemas (zod) das actions da Gestão de Produtos. A forma é validada aqui; as regras de negócio (faixas, vigência,
 * unidades do catálogo) ficam no domínio (`src/domain/products/*`) e no serviço.
 */
import { z } from "zod";
import {
  COMMERCIAL_SEGMENTS,
  COMMERCIAL_STATUSES,
  MONEY_MAX,
  NAME_MAX,
  NAME_MIN,
  NOTES_MAX,
  PACKAGE_STATUSES,
  PRICE_MODELS,
  QUANTITY_MAX,
  REASON_MAX,
  REASON_MIN,
  SUMMARY_MAX,
  TIERS_MAX,
  isDateKey,
} from "@/domain/products/commercial";

export const unitCodeSchema = z.string().trim().regex(/^\d{2}\.\d{2}$/, "Código de módulo inválido.");
const money = z.coerce.number({ message: "Valor inválido." }).finite("Valor inválido.").min(0, "O valor não pode ser negativo.").max(MONEY_MAX, "Valor alto demais: confira os zeros.");
const optionalText = (max: number) =>
  z
    .string()
    .trim()
    .max(max, `Texto muito longo (máximo de ${max} caracteres).`)
    .nullish()
    .transform((v) => (v ? v : null));
const reason = z.string().trim().min(REASON_MIN, "Informe o motivo (mínimo de 3 caracteres).").max(REASON_MAX, "Motivo muito longo.");
const dateKey = z.string().refine(isDateKey, "Data inválida.");
const name = z.string().trim().min(NAME_MIN, "Informe o nome (mínimo de 2 caracteres).").max(NAME_MAX, "Nome muito longo.");

export const saveModuleSchema = z.object({
  code: unitCodeSchema,
  name,
  summary: optionalText(SUMMARY_MAX),
  status: z.enum(COMMERCIAL_STATUSES, { message: "Situação inválida." }),
  segments: z.array(z.enum(COMMERCIAL_SEGMENTS)).max(COMMERCIAL_SEGMENTS.length).default([]),
  requiresCommercial: z.array(unitCodeSchema).max(30, "Dependências demais.").default([]),
  notes: optionalText(NOTES_MAX),
});
export type SaveModuleInput = z.input<typeof saveModuleSchema>;

export const priceSchema = z.object({
  code: unitCodeSchema,
  model: z.enum(PRICE_MODELS, { message: "Modelo de preço inválido." }),
  monthly: money.default(0),
  unitPrice: money.default(0),
  includedQuantity: z.coerce.number().int("Quantidade incluída inválida.").min(0).max(QUANTITY_MAX).default(0),
  unitLabel: optionalText(40),
  tiers: z
    .array(z.object({ upTo: z.coerce.number().int().min(1).max(QUANTITY_MAX).nullable(), monthly: money }))
    .max(TIERS_MAX)
    .default([]),
  setup: money.default(0),
  validFrom: dateKey,
  reason,
});
export type PriceInput = z.input<typeof priceSchema>;

export const cancelVersionSchema = z.object({
  version: z.coerce.number().int().min(1),
  reason,
});

export const cancelPriceSchema = cancelVersionSchema.extend({ code: unitCodeSchema });
export type CancelPriceInput = z.input<typeof cancelPriceSchema>;

const packageInfo = {
  name,
  segment: z.enum(COMMERCIAL_SEGMENTS, { message: "Segmento inválido." }),
  description: optionalText(SUMMARY_MAX),
};

const packageVersion = {
  units: z.array(unitCodeSchema).min(1, "Escolha pelo menos um módulo para o pacote.").max(300),
  monthly: money,
  setup: money.default(0),
  validFrom: dateKey,
  reason,
};

export const createPackageSchema = z.object({
  ...packageInfo,
  basedOn: z.string().trim().max(60).nullish().transform((v) => v || null),
  ...packageVersion,
});
export type CreatePackageInput = z.input<typeof createPackageSchema>;

export const updatePackageSchema = z.object({
  id: z.string().min(1).max(64),
  ...packageInfo,
  status: z.enum(PACKAGE_STATUSES, { message: "Situação inválida." }),
});
export type UpdatePackageInput = z.input<typeof updatePackageSchema>;

export const packageVersionSchema = z.object({ id: z.string().min(1).max(64), ...packageVersion });
export type PackageVersionInput = z.input<typeof packageVersionSchema>;

export const cancelPackageVersionSchema = cancelVersionSchema.extend({ id: z.string().min(1).max(64) });
export type CancelPackageVersionInput = z.input<typeof cancelPackageVersionSchema>;

export const unitDetailSchema = z.object({ code: unitCodeSchema });
