import { z } from "zod";

/**
 * Esquemas de validação (zod) do módulo de Marketing e Prospecção. Mensagens em português porque
 * são exibidas diretamente na interface quando a validação falha.
 */

/** Texto opcional: string vazia (ou null) vira undefined. */
const optionalText = (max = 200) =>
  z
    .string()
    .trim()
    .max(max, `Máximo de ${max} caracteres`)
    .nullish()
    .transform((v) => (v ? v : undefined));

export const optionalPhone = z
  .string()
  .nullish()
  .transform((v) => (v ? v.replace(/\D/g, "") : undefined))
  .transform((v) => (v ? v : undefined))
  .refine((v) => !v || (v.length >= 10 && v.length <= 13), "Telefone inválido (use DDD + número)");

export const optionalEmail = z
  .string()
  .trim()
  .nullish()
  .transform((v) => (v ? v.toLowerCase() : undefined))
  .refine((v) => !v || /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(v), "E-mail inválido");

/** Data/hora opcional em qualquer formato aceito por Date (ISO, AAAA-MM-DD, datetime-local) → ISO. */
const optionalIso = z
  .string()
  .trim()
  .nullish()
  .refine((v) => !v || !Number.isNaN(new Date(v).getTime()), "Data inválida")
  .transform((v) => (v ? new Date(v.length === 10 ? `${v}T12:00:00` : v).toISOString() : undefined));

const requiredIso = z
  .string("Informe a data")
  .trim()
  .min(1, "Informe a data")
  .refine((v) => !Number.isNaN(new Date(v).getTime()), "Data inválida")
  .transform((v) => new Date(v.length === 10 ? `${v}T12:00:00` : v).toISOString());

const id = (label: string) => z.string(`${label} inválido`).trim().min(1, `${label} inválido`);
const optionalId = z
  .string()
  .trim()
  .nullish()
  .transform((v) => (v ? v : undefined));

// ---------------------------------------------------------------------------
// Leads
// ---------------------------------------------------------------------------

export const LEAD_CONTACT_CHANNELS = ["ligacao", "whatsapp", "email"] as const;
export type LeadContactChannel = (typeof LEAD_CONTACT_CHANNELS)[number];

const leadFields = {
  name: z.string("Informe o nome").trim().min(2, "Informe o nome do contato").max(120, "Nome muito longo"),
  company: optionalText(120),
  phone: optionalPhone,
  email: optionalEmail,
  city: optionalText(80),
  state: z
    .string()
    .trim()
    .toUpperCase()
    .nullish()
    .transform((v) => (v ? v : undefined))
    .refine((v) => !v || /^[A-Z]{2}$/.test(v), "UF inválida"),
  origin: z.string("Informe a origem").trim().min(1, "Informe a origem").max(40, "Origem inválida"),
  campaignId: optionalId,
  interest: optionalText(300),
  productInterestIds: z.array(z.string().trim().min(1)).max(20, "Produtos demais").default([]),
  ownerId: optionalId,
  consent: z.boolean().default(false),
  notes: optionalText(2000),
  nextAction: optionalText(200),
  nextActionAt: optionalIso,
};

export const createLeadSchema = z.object(leadFields).refine((v) => Boolean(v.phone || v.email), { message: "Informe telefone ou e-mail do lead", path: ["phone"] });
export type CreateLeadInput = z.infer<typeof createLeadSchema>;

/** Edição: próxima ação e consentimento têm ações próprias; consentimento ausente = mantém o atual. */
export const updateLeadSchema = z
  .object({ id: id("Lead"), ...leadFields, consent: z.boolean().optional() })
  .omit({ nextAction: true, nextActionAt: true })
  .refine((v) => Boolean(v.phone || v.email), { message: "Informe telefone ou e-mail do lead", path: ["phone"] });
export type UpdateLeadInput = z.infer<typeof updateLeadSchema>;

export const leadDuplicatesSchema = z.object({
  phone: optionalPhone.catch(undefined),
  email: optionalEmail.catch(undefined),
  company: optionalText(120),
  excludeId: optionalId,
});

export const registerLeadContactSchema = z.object({
  leadId: id("Lead"),
  channel: z.enum(LEAD_CONTACT_CHANNELS, "Canal inválido"),
  note: z.string("Descreva o contato").trim().min(2, "Descreva o contato").max(2000, "Nota muito longa"),
  nextAction: optionalText(200),
  nextActionAt: optionalIso,
});

export const qualifyLeadSchema = z.object({ leadId: id("Lead"), sellerId: optionalId });
export const disqualifyLeadSchema = z.object({ leadId: id("Lead"), reason: z.string("Informe o motivo").trim().min(3, "Informe o motivo da desqualificação").max(500, "Motivo muito longo") });
export const markDuplicateSchema = z.object({ leadId: id("Lead"), originalId: id("Lead original") });
export const assignLeadSchema = z.object({ leadId: id("Lead"), ownerId: optionalId });
export const leadConsentSchema = z.object({ leadId: id("Lead"), consent: z.boolean() });
export const leadNextActionSchema = z.object({ leadId: id("Lead"), nextAction: optionalText(200), nextActionAt: optionalIso });
/** Mudanças de status "simples" (kanban). Qualificar e desqualificar têm ações próprias. */
export const leadStatusSchema = z.object({ leadId: id("Lead"), status: z.enum(["novo", "em_contato", "convertido"], "Status inválido") });

// ---------------------------------------------------------------------------
// Importação e webhook
// ---------------------------------------------------------------------------

/** Linha de CSV já mapeada pelas colunas (nome, empresa, telefone, e-mail, cidade, origem, interesse). */
export const importRowSchema = z.object({
  nome: z.string().optional(),
  empresa: z.string().optional(),
  telefone: z.string().optional(),
  email: z.string().optional(),
  cidade: z.string().optional(),
  origem: z.string().optional(),
  interesse: z.string().optional(),
});
export type ImportRow = z.infer<typeof importRowSchema>;

export const importLeadsSchema = z.object({
  rows: z.array(importRowSchema).min(1, "Nenhuma linha para importar").max(2000, "Importe no máximo 2.000 linhas por vez"),
  defaultOrigin: z.string().trim().min(1).max(40).default("manual"),
  campaignId: optionalId,
  ownerId: optionalId,
  consent: z.boolean().default(false),
});

export const webhookLeadSchema = z.object({
  nome: z.string("Campo nome obrigatório").trim().min(2, "Campo nome obrigatório").max(120),
  empresa: optionalText(120),
  telefone: optionalPhone,
  email: optionalEmail,
  cidade: optionalText(80),
  origem: optionalText(40),
  campanha: optionalText(120),
  interesse: optionalText(300),
  consentimento: z
    .union([z.boolean(), z.string(), z.number()])
    .nullish()
    .transform((v) => v === true || v === 1 || (typeof v === "string" && ["true", "sim", "1", "yes"].includes(v.trim().toLowerCase()))),
});
export type WebhookLeadInput = z.infer<typeof webhookLeadSchema>;

// ---------------------------------------------------------------------------
// Campanhas
// ---------------------------------------------------------------------------

export const CAMPAIGN_STATUS = ["planejada", "ativa", "pausada", "encerrada"] as const;

export const campaignSchema = z
  .object({
    id: optionalId,
    name: z.string("Informe o nome").trim().min(3, "Informe o nome da campanha").max(120, "Nome muito longo"),
    channel: z.string("Informe o canal").trim().min(1, "Informe o canal").max(40, "Canal inválido"),
    startDate: requiredIso,
    endDate: optionalIso,
    budget: z.number("Orçamento inválido").min(0, "Orçamento não pode ser negativo").max(10_000_000, "Orçamento muito alto"),
    spent: z.number("Gasto inválido").min(0, "Gasto não pode ser negativo").max(10_000_000, "Gasto muito alto"),
    status: z.enum(CAMPAIGN_STATUS, "Status inválido"),
    ownerId: optionalId,
  })
  .refine((v) => !v.endDate || v.endDate >= v.startDate, { message: "O fim deve ser depois do início", path: ["endDate"] });

// ---------------------------------------------------------------------------
// Prospecção ativa
// ---------------------------------------------------------------------------

export const prospectListSchema = z.object({
  name: z.string("Informe o nome").trim().min(3, "Informe o nome da lista").max(120, "Nome muito longo"),
  description: optionalText(500),
  segment: optionalText(60),
  ownerId: optionalId,
  campaignId: optionalId,
});

export const prospectListStatusSchema = z.object({ listId: id("Lista"), status: z.enum(["ativa", "pausada", "encerrada"], "Status inválido") });

export const prospectRowSchema = z.object({
  nome: z.string().optional(),
  empresa: z.string().optional(),
  telefone: z.string().optional(),
  email: z.string().optional(),
  cidade: z.string().optional(),
});
export type ProspectRow = z.infer<typeof prospectRowSchema>;

export const importProspectsSchema = z.object({
  listId: id("Lista"),
  rows: z.array(prospectRowSchema).min(1, "Nenhuma linha para importar").max(2000, "Importe no máximo 2.000 linhas por vez"),
});

export const assignProspectsSchema = z.object({
  listId: id("Lista"),
  prospectIds: z.array(z.string().trim().min(1)).min(1, "Selecione ao menos um contato").max(2000),
  ownerId: id("Responsável"),
});

export const PROSPECT_RESULTS = ["sem_resposta", "respondeu", "interessado", "descartado"] as const;
export type ProspectAttemptResult = (typeof PROSPECT_RESULTS)[number];

export const prospectAttemptSchema = z.object({
  prospectId: id("Contato"),
  channel: z.enum(LEAD_CONTACT_CHANNELS, "Canal inválido"),
  result: z.enum(PROSPECT_RESULTS, "Resultado inválido"),
  note: optionalText(1000),
  nextActionAt: optionalIso,
});

export const scheduleProspectSchema = z.object({ prospectId: id("Contato"), nextActionAt: requiredIso, note: optionalText(300) });

export const convertProspectSchema = z.object({
  prospectId: id("Contato"),
  target: z.enum(["lead", "oportunidade"], "Destino inválido"),
  sellerId: optionalId,
  interest: optionalText(300),
  productInterestIds: z.array(z.string().trim().min(1)).max(20).default([]),
  consent: z.boolean().default(false),
});

// ---------------------------------------------------------------------------
// Caixa de entrada
// ---------------------------------------------------------------------------

export const assumeSchema = z.object({ kind: z.enum(["lead", "message"]), id: id("Item") });
export const replySchema = z
  .object({
    communicationId: optionalId,
    leadId: optionalId,
    channel: z.enum(["whatsapp", "email"], "Canal inválido"),
    body: z.string("Escreva a resposta").trim().min(1, "Escreva a resposta").max(2000, "Mensagem muito longa"),
  })
  .refine((v) => Boolean(v.communicationId || v.leadId), { message: "Mensagem de origem não informada" });

// ---------------------------------------------------------------------------
// Mensagens de erro
// ---------------------------------------------------------------------------

export function zodMessage(error: z.ZodError): string {
  const issue = error.issues[0];
  return issue?.message ?? "Dados inválidos";
}
