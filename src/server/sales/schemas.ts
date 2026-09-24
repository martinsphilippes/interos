import { z } from "zod";

/**
 * Esquemas (zod) e constantes puras do módulo de Vendas. Sem dependências de servidor: é importado
 * pelas Server Actions e pelos Client Components (mensagens em português exibidas na interface).
 */

/** Etapas abertas do funil (ganho/perdido são terminais e têm diálogos próprios). */
export const OPEN_STAGES = ["qualificacao", "diagnostico", "proposta", "negociacao", "fechamento"] as const;
export type OpenStage = (typeof OPEN_STAGES)[number];

/** Probabilidade padrão ao entrar em cada etapa. */
export const STAGE_PROBABILITY: Record<OpenStage | "ganho" | "perdido", number> = {
  qualificacao: 10,
  diagnostico: 25,
  proposta: 50,
  negociacao: 70,
  fechamento: 85,
  ganho: 100,
  perdido: 0,
};

export const LOSS_REASONS = ["preco", "concorrente", "timing", "sem_orcamento", "sem_resposta", "outro"] as const;
export type LossReason = (typeof LOSS_REASONS)[number];
export const LOSS_REASON_LABELS: Record<LossReason, string> = {
  preco: "Preço",
  concorrente: "Concorrente",
  timing: "Momento (timing)",
  sem_orcamento: "Sem orçamento",
  sem_resposta: "Sem resposta",
  outro: "Outro",
};

export function lossReasonLabel(value: string | undefined | null): string {
  if (!value) return "—";
  return (LOSS_REASON_LABELS as Record<string, string>)[value] ?? value;
}

const id = (label: string) => z.string().trim().min(1, `${label} inválido`);

const optionalText = (max = 2000) =>
  z
    .string()
    .trim()
    .max(max, `Máximo de ${max} caracteres`)
    .optional()
    .transform((v) => (v ? v : undefined));

const isoDate = (message: string) =>
  z
    .string()
    .trim()
    .min(1, message)
    .refine((v) => !Number.isNaN(new Date(v).getTime()), "Data inválida");

const money = (label: string) => z.coerce.number({ message: `${label} inválido` }).min(0, `${label} não pode ser negativo`).max(10_000_000, `${label} muito alto`);

// ---------------------------------------------------------------------------
// Oportunidades
// ---------------------------------------------------------------------------

export const productLineSchema = z.object({
  productId: id("Produto"),
  productName: z.string().trim().min(1, "Produto sem nome"),
  quantity: z.coerce.number().int("Quantidade deve ser inteira").min(1, "Quantidade mínima é 1").max(999, "Quantidade muito alta"),
  setupValue: money("Valor de adesão"),
  monthlyValue: money("Mensalidade"),
  hardwareValue: money("Valor de hardware"),
});
export type ProductLineInput = z.input<typeof productLineSchema>;

export const billingDataSchema = z.object({
  legalName: optionalText(200),
  document: z
    .string()
    .optional()
    .transform((v) => (v ? v.replace(/\D/g, "") : undefined))
    .refine((v) => !v || v.length === 11 || v.length === 14, "CNPJ/CPF de faturamento inválido"),
  email: z
    .string()
    .trim()
    .optional()
    .transform((v) => (v ? v.toLowerCase() : undefined))
    .refine((v) => !v || /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(v), "E-mail de faturamento inválido"),
  paymentCondition: optionalText(300),
});

export const changeStageSchema = z.object({
  opportunityId: id("Oportunidade"),
  stage: z.enum(OPEN_STAGES, { message: "Etapa inválida" }),
});

export const updateOpportunitySchema = z
  .object({
    opportunityId: id("Oportunidade"),
    diagnosis: optionalText(4000),
    need: optionalText(2000),
    objections: optionalText(2000),
    temperature: z.enum(["quente", "morno", "frio"], { message: "Temperatura inválida" }),
    probability: z.coerce.number().int().min(0, "Probabilidade mínima é 0").max(100, "Probabilidade máxima é 100"),
    products: z.array(productLineSchema).max(50, "Produtos demais"),
    billingData: billingDataSchema,
    nextAction: optionalText(300),
    nextActionAt: z.string().optional().transform((v) => (v ? v : undefined)),
    /** Marcado conscientemente: salvar sem próxima ação. */
    noNextAction: z.boolean().default(false),
  })
  .superRefine((data, ctx) => {
    if (data.noNextAction) return;
    if (!data.nextAction) ctx.addIssue({ code: "custom", path: ["nextAction"], message: "Informe a próxima ação ou marque \"sem próxima ação\"" });
    if (!data.nextActionAt || Number.isNaN(new Date(data.nextActionAt).getTime())) ctx.addIssue({ code: "custom", path: ["nextActionAt"], message: "Informe a data da próxima ação" });
  });
export type UpdateOpportunityInput = z.input<typeof updateOpportunitySchema>;

export const scheduleNextActionSchema = z.object({
  opportunityId: id("Oportunidade"),
  nextAction: z.string().trim().min(3, "Descreva a próxima ação").max(300),
  nextActionAt: isoDate("Informe a data da próxima ação"),
});

export const registerContactSchema = z.object({
  opportunityId: id("Oportunidade"),
  channel: z.enum(["whatsapp", "ligacao", "nota"], { message: "Canal inválido" }),
  outcome: z.enum(["atendeu", "nao_atendeu", "mensagem_enviada"]).optional(),
  notes: optionalText(2000),
});

export const markWonSchema = z.object({
  opportunityId: id("Oportunidade"),
  products: z.array(productLineSchema).min(1, "Inclua ao menos um produto"),
  billingData: z.object({
    legalName: z.string().trim().min(3, "Informe a razão social de faturamento").max(200),
    document: z
      .string()
      .transform((v) => v.replace(/\D/g, ""))
      .refine((v) => v.length === 11 || v.length === 14, "CNPJ/CPF de faturamento inválido"),
    email: z
      .string()
      .trim()
      .toLowerCase()
      .refine((v) => /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(v), "E-mail de faturamento inválido"),
    paymentCondition: z.string().trim().min(3, "Informe a condição de pagamento").max(300),
  }),
});
export type MarkWonInput = z.input<typeof markWonSchema>;

export const markLostSchema = z
  .object({
    opportunityId: id("Oportunidade"),
    reason: z.enum(LOSS_REASONS, { message: "Escolha o motivo da perda" }),
    competitor: optionalText(120),
    notes: optionalText(2000),
  })
  .refine((d) => d.reason !== "concorrente" || Boolean(d.competitor), { path: ["competitor"], message: "Informe o concorrente" });
export type MarkLostInput = z.input<typeof markLostSchema>;

export const opportunityIdSchema = z.object({ opportunityId: id("Oportunidade") });

export const createOpportunityTaskSchema = z.object({
  opportunityId: id("Oportunidade"),
  title: z.string().trim().min(3, "Descreva a tarefa").max(200),
  dueAt: isoDate("Informe o prazo"),
  priority: z.enum(["baixa", "media", "alta", "critica"]).default("media"),
});

// ---------------------------------------------------------------------------
// Propostas
// ---------------------------------------------------------------------------

export const proposalItemSchema = productLineSchema.extend({
  discountPct: z.coerce.number().min(0, "Desconto não pode ser negativo").max(100, "Desconto máximo é 100%"),
});
export type ProposalItemInput = z.input<typeof proposalItemSchema>;

export const saveProposalSchema = z.object({
  /** Ausente = nova proposta. */
  proposalId: z.string().optional().transform((v) => (v ? v : undefined)),
  opportunityId: id("Oportunidade"),
  items: z.array(proposalItemSchema).min(1, "Inclua ao menos um item"),
  conditions: optionalText(2000),
  validUntil: isoDate("Informe a validade"),
  notes: optionalText(2000),
});
export type SaveProposalInput = z.input<typeof saveProposalSchema>;

export const PROPOSAL_TRANSITIONS = ["enviar", "visualizada", "negociacao", "aceitar", "recusar"] as const;
export type ProposalTransition = (typeof PROPOSAL_TRANSITIONS)[number];

export const proposalTransitionSchema = z
  .object({
    proposalId: id("Proposta"),
    transition: z.enum(PROPOSAL_TRANSITIONS, { message: "Transição inválida" }),
    reason: optionalText(1000),
  })
  .refine((d) => d.transition !== "recusar" || Boolean(d.reason), { path: ["reason"], message: "Informe o motivo da recusa" });

export const proposalIdSchema = z.object({ proposalId: id("Proposta") });

// ---------------------------------------------------------------------------
// Visitas
// ---------------------------------------------------------------------------

export const visitAddressSchema = z.object({
  street: optionalText(200),
  number: optionalText(20),
  district: optionalText(120),
  city: optionalText(120),
  state: optionalText(2),
  zip: optionalText(12),
});

export const createVisitSchema = z.object({
  clientId: id("Cliente"),
  opportunityId: z.string().optional().transform((v) => (v ? v : undefined)),
  sellerId: id("Vendedor"),
  scheduledAt: isoDate("Informe data e hora"),
  durationMinutes: z.coerce.number().int().min(15, "Duração mínima de 15 minutos").max(600, "Duração máxima de 10 horas"),
  objective: z.string().trim().min(3, "Descreva o objetivo da visita").max(300),
  notes: optionalText(2000),
  address: visitAddressSchema,
});
export type CreateVisitInput = z.input<typeof createVisitSchema>;

export const completeVisitSchema = z.object({
  visitId: id("Visita"),
  result: z.string().trim().min(3, "Descreva o resultado da visita").max(2000),
  notes: optionalText(2000),
});

export const cancelVisitSchema = z.object({
  visitId: id("Visita"),
  reason: z.string().trim().min(3, "Informe o motivo do cancelamento").max(1000),
});

export const rescheduleVisitSchema = z.object({
  visitId: id("Visita"),
  scheduledAt: isoDate("Informe a nova data e hora"),
  reason: optionalText(1000),
});

/** Primeira mensagem de erro de um ZodError, legível. */
export function zodMessage(error: z.ZodError): string {
  return error.issues[0]?.message ?? "Dados inválidos";
}
