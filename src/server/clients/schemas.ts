import { z } from "zod";
import { CLIENT_STATUS } from "@/domain/constants";

/**
 * Esquemas de validação (zod) do módulo Clientes 360º. Mensagens em português porque
 * são exibidas diretamente na interface quando a validação falha.
 */

/** Segmentos de mercado oferecidos no cadastro (a lista real pode crescer via banco). */
export const SEGMENT_OPTIONS: { value: string; label: string }[] = [
  { value: "varejo", label: "Varejo" },
  { value: "supermercado", label: "Supermercado" },
  { value: "farmacia", label: "Farmácia" },
  { value: "restaurante", label: "Restaurante / food service" },
  { value: "atacado", label: "Atacado / distribuidora" },
  { value: "loja_de_roupas", label: "Loja de roupas / moda" },
  { value: "autopecas", label: "Autopeças" },
  { value: "material_de_construcao", label: "Material de construção" },
  { value: "otica", label: "Ótica" },
  { value: "pet_shop", label: "Pet shop / agropecuária" },
  { value: "servicos", label: "Serviços" },
  { value: "industria", label: "Indústria" },
  { value: "outro", label: "Outro" },
];

export function segmentLabel(value: string | undefined | null): string {
  if (!value) return "—";
  return SEGMENT_OPTIONS.find((s) => s.value === value)?.label ?? value;
}

export const BR_STATES = ["AC", "AL", "AP", "AM", "BA", "CE", "DF", "ES", "GO", "MA", "MT", "MS", "MG", "PA", "PB", "PR", "PE", "PI", "RJ", "RN", "RS", "RO", "RR", "SC", "SP", "SE", "TO"] as const;

/** Texto opcional: string vazia vira undefined. */
const optionalText = (max = 200) =>
  z
    .string()
    .trim()
    .max(max, `Máximo de ${max} caracteres`)
    .optional()
    .transform((v) => (v ? v : undefined));

const optionalDigits = (label: string, lengths: number[]) =>
  z
    .string()
    .optional()
    .transform((v) => (v ? v.replace(/\D/g, "") : undefined))
    .refine((v) => !v || lengths.includes(v.length), `${label} inválido`);

const optionalEmail = z
  .string()
  .trim()
  .optional()
  .transform((v) => (v ? v.toLowerCase() : undefined))
  .refine((v) => !v || /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(v), "E-mail inválido");

const optionalUrl = z
  .string()
  .trim()
  .optional()
  .transform((v) => (v ? (/^https?:\/\//i.test(v) ? v : `https://${v}`) : undefined))
  .refine((v) => !v || /^https?:\/\/[^\s]+\.[^\s]+$/.test(v), "Site inválido");

export const addressSchema = z.object({
  street: optionalText(160),
  number: optionalText(20),
  complement: optionalText(80),
  district: optionalText(80),
  city: optionalText(80),
  state: z
    .string()
    .trim()
    .toUpperCase()
    .optional()
    .transform((v) => (v ? v : undefined))
    .refine((v) => !v || (BR_STATES as readonly string[]).includes(v), "UF inválida"),
  zip: optionalDigits("CEP", [8]),
});

const tagsSchema = z
  .array(z.string().trim().min(1).max(40))
  .max(20, "Máximo de 20 tags")
  .optional()
  .transform((v) => Array.from(new Set((v ?? []).map((t) => t.toLowerCase()))));

/** Campos comuns de cadastro/edição de cliente. */
const clientFieldsSchema = z.object({
  legalName: z.string().trim().min(2, "Informe a razão social").max(160, "Razão social muito longa"),
  tradeName: z.string().trim().min(2, "Informe o nome fantasia").max(120, "Nome fantasia muito longo"),
  document: optionalDigits("CNPJ/CPF", [11, 14]),
  segment: optionalText(60),
  origin: optionalText(40),
  campaignId: optionalText(60),
  phone: optionalDigits("Telefone", [10, 11]),
  whatsapp: optionalDigits("WhatsApp", [10, 11]),
  email: optionalEmail,
  website: optionalUrl,
  address: addressSchema.optional().transform((v) => v ?? {}),
  ownerSalesId: optionalText(60),
  ownerCsId: optionalText(60),
  tags: tagsSchema,
  notes: optionalText(2000),
});

export const createClientSchema = clientFieldsSchema.extend({
  status: z.enum(["prospect", "lead"], { message: "Status inicial inválido" }).default("prospect"),
});
export type CreateClientInput = z.input<typeof createClientSchema>;

export const updateClientSchema = clientFieldsSchema.extend({
  id: z.string().min(1, "Cliente inválido"),
});
export type UpdateClientInput = z.input<typeof updateClientSchema>;

export const findDuplicatesSchema = z.object({
  document: optionalDigits("CNPJ/CPF", [11, 14]),
  phone: optionalDigits("Telefone", [10, 11]),
  whatsapp: optionalDigits("WhatsApp", [10, 11]),
  email: optionalEmail,
  excludeId: z.string().optional(),
});
export type FindDuplicatesInput = z.input<typeof findDuplicatesSchema>;

export const contactSchema = z.object({
  clientId: z.string().min(1, "Cliente inválido"),
  name: z.string().trim().min(2, "Informe o nome do contato").max(120),
  role: optionalText(80),
  phone: optionalDigits("Telefone", [10, 11]),
  whatsapp: optionalDigits("WhatsApp", [10, 11]),
  email: optionalEmail,
  isPrimary: z.boolean().default(false),
  isDecisionMaker: z.boolean().default(false),
});
export type ContactInput = z.input<typeof contactSchema>;

export const updateContactSchema = contactSchema.extend({ id: z.string().min(1, "Contato inválido") });
export type UpdateContactInput = z.input<typeof updateContactSchema>;

export const removeContactSchema = z.object({ id: z.string().min(1, "Contato inválido"), clientId: z.string().min(1, "Cliente inválido") });

export const noteSchema = z.object({
  clientId: z.string().min(1, "Cliente inválido"),
  body: z.string().trim().min(2, "Escreva a nota antes de registrar").max(4000, "Nota muito longa"),
});
export type NoteInput = z.input<typeof noteSchema>;

export const documentSchema = z.object({
  clientId: z.string().min(1, "Cliente inválido"),
  name: z.string().trim().min(2, "Informe o nome do documento").max(160),
  url: z
    .string()
    .trim()
    .min(1, "Informe o link do documento")
    .refine((v) => /^https?:\/\/[^\s]+$/i.test(v), "Link inválido: use um endereço iniciado por http(s)://"),
  category: optionalText(60),
  entityType: optionalText(40),
  entityId: optionalText(60),
});
export type DocumentInput = z.input<typeof documentSchema>;

export const upsellSchema = z.object({
  clientId: z.string().min(1, "Cliente inválido"),
  productId: z.string().min(1, "Escolha o produto"),
  kind: z.enum(["upsell", "cross_sell"], { message: "Tipo inválido" }).default("upsell"),
  quantity: z.coerce.number().int().min(1, "Quantidade mínima é 1").max(999).default(1),
  need: z.string().trim().min(3, "Descreva a necessidade do cliente").max(1000),
  notes: optionalText(2000),
});
export type UpsellInput = z.input<typeof upsellSchema>;

export const contactEventSchema = z.object({
  clientId: z.string().min(1, "Cliente inválido"),
  channel: z.enum(["ligacao", "whatsapp"], { message: "Canal inválido" }),
  contactId: optionalText(60),
  phone: optionalDigits("Telefone", [10, 11, 12, 13]),
  outcome: z.enum(["atendeu", "nao_atendeu", "mensagem_enviada"]).default("atendeu"),
  notes: optionalText(2000),
  durationMinutes: z.coerce.number().int().min(0).max(600).optional(),
});
export type ContactEventInput = z.input<typeof contactEventSchema>;

export const changeStatusSchema = z.object({
  clientId: z.string().min(1, "Cliente inválido"),
  status: z.enum(CLIENT_STATUS, { message: "Status inválido" }),
  reason: z.string().trim().min(3, "Informe o motivo da mudança").max(1000),
});
export type ChangeStatusInput = z.input<typeof changeStatusSchema>;

/** Rótulos dos campos para compor mensagens de erro legíveis. */
const FIELD_LABELS: Record<string, string> = {
  legalName: "Razão social",
  tradeName: "Nome fantasia",
  document: "CNPJ/CPF",
  segment: "Segmento",
  origin: "Origem",
  phone: "Telefone",
  whatsapp: "WhatsApp",
  email: "E-mail",
  website: "Site",
  "address.street": "Endereço",
  "address.city": "Cidade",
  "address.state": "UF",
  "address.zip": "CEP",
  ownerSalesId: "Responsável comercial",
  tags: "Tags",
  notes: "Observações",
  status: "Status",
  name: "Nome",
  role: "Cargo",
  body: "Nota",
  url: "Link",
  category: "Categoria",
  productId: "Produto",
  need: "Necessidade",
  reason: "Motivo",
  channel: "Canal",
  quantity: "Quantidade",
};

/** Transforma o primeiro problema de um ZodError em uma frase para o usuário. */
export function zodMessage(error: z.ZodError): string {
  const issue = error.issues[0];
  if (!issue) return "Dados inválidos";
  const path = issue.path.map(String).join(".");
  const label = FIELD_LABELS[path];
  // Mensagens já escritas em português não precisam de prefixo quando falam do campo.
  return label && !issue.message.toLowerCase().includes(label.toLowerCase()) ? `${label}: ${issue.message}` : issue.message;
}

/** Erros por campo (para destacar inputs no formulário). */
export function zodFieldErrors(error: z.ZodError): Record<string, string> {
  const out: Record<string, string> = {};
  for (const issue of error.issues) {
    const key = issue.path.map(String).join(".");
    if (!out[key]) out[key] = issue.message;
  }
  return out;
}
