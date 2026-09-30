import { z } from "zod";
import type { Billing, Contract } from "@/domain/types";

/**
 * Esquemas (zod) e constantes puras do módulo Financeiro. Sem dependências de servidor: é importado
 * pelas Server Actions e pelos Client Components (mensagens em português exibidas na interface).
 * Predicados de autorização ficam em ./access.ts (server-only), fora do bundle do cliente.
 */

// ---------------------------------------------------------------------------
// Gate financeiro (setting "gate_financeiro")
// ---------------------------------------------------------------------------

export const PAYMENT_REQUIREMENTS = ["setup", "primeira_mensalidade", "nenhum"] as const;
export type PaymentRequirement = (typeof PAYMENT_REQUIREMENTS)[number];
export const PAYMENT_REQUIREMENT_LABELS: Record<PaymentRequirement, string> = {
  setup: "Pagamento da adesão (setup)",
  primeira_mensalidade: "Pagamento da primeira mensalidade",
  nenhum: "Sem exigência de pagamento",
};

export interface FinanceGateSettings {
  exigeContratoAssinado: boolean;
  exigePagamento: PaymentRequirement;
  permiteExcecaoGestor: boolean;
}

export const GATE_SETTING_KEY = "gate_financeiro";
export const DEFAULT_GATE_SETTINGS: FinanceGateSettings = { exigeContratoAssinado: true, exigePagamento: "setup", permiteExcecaoGestor: true };

/** Um critério do gate de liberação, já avaliado. */
export interface ReleaseCheck {
  key: "cobrancas" | "assinatura" | "pagamento" | "pendencia";
  label: string;
  ok: boolean;
  detail?: string;
}

export interface ReleaseGate {
  ok: boolean;
  checks: ReleaseCheck[];
  settings: FinanceGateSettings;
}

// ---------------------------------------------------------------------------
// Rótulos e filtros
// ---------------------------------------------------------------------------

export const RECURRENCE_LABELS: Record<Contract["recurrence"], string> = { mensal: "Mensal", anual: "Anual", unico: "Pagamento único" };

export const SIGNER_STATUS_LABELS: Record<Contract["signers"][number]["status"], string> = { pendente: "Pendente", assinado: "Assinado", recusado: "Recusado" };

export const FINANCIAL_STATUS_LABELS: Record<Contract["financialStatus"], string> = { pendente: "Pendente", aprovado: "Aprovado", pendencia: "Com pendência" };
export const FINANCIAL_STATUS_VARIANT: Record<Contract["financialStatus"], "muted" | "success" | "danger"> = { pendente: "muted", aprovado: "success", pendencia: "danger" };

export const PAYMENT_METHODS = ["pix", "boleto", "cartao", "transferencia", "dinheiro"] as const;
export const PAYMENT_METHOD_LABELS: Record<(typeof PAYMENT_METHODS)[number], string> = {
  pix: "PIX",
  boleto: "Boleto",
  cartao: "Cartão",
  transferencia: "Transferência",
  dinheiro: "Dinheiro",
};
export function paymentMethodLabel(value: string | undefined): string {
  if (!value) return "—";
  return (PAYMENT_METHOD_LABELS as Record<string, string>)[value] ?? value;
}

/** Grupos de status usados nos cards de drill-down e no filtro da fila. */
export const CONTRACT_QUEUE_GROUPS = {
  contrato: ["aguardando_contrato"],
  assinatura: ["aguardando_assinatura"],
  pagamento: ["assinado", "aguardando_pagamento", "pago"],
  pendencia: ["pendencia"],
  abertos: ["aguardando_contrato", "aguardando_assinatura", "assinado", "aguardando_pagamento", "pago", "pendencia"],
  liberados: ["liberado"],
} as const satisfies Record<string, readonly Contract["status"][]>;
export type ContractQueueGroup = keyof typeof CONTRACT_QUEUE_GROUPS;

export const PERIOD_OPTIONS = [
  { value: "mes", label: "Mês atual" },
  { value: "30d", label: "Últimos 30 dias" },
  { value: "90d", label: "Últimos 90 dias" },
  { value: "12m", label: "Últimos 12 meses" },
] as const;
export type PeriodKey = (typeof PERIOD_OPTIONS)[number]["value"];

export const BILLING_TYPES = ["setup", "mensalidade", "hardware", "servico"] as const satisfies readonly Billing["type"][];
export const BILLING_STATUSES = ["aberta", "vencida", "paga", "cancelada"] as const satisfies readonly Billing["status"][];

// ---------------------------------------------------------------------------
// Esquemas das actions
// ---------------------------------------------------------------------------

const id = (label: string) => z.string().trim().min(1, `${label} inválido`);
const money = (label: string) => z.number(`${label} inválido`).min(0, `${label} não pode ser negativo`).max(10_000_000, `${label} muito alto`);
const dateKey = (label: string) => z.string().regex(/^\d{4}-\d{2}-\d{2}/, `${label} inválida`);
const url = z.url("Informe um link válido (https://…)");

export const contractIdSchema = z.object({ contractId: id("Contrato") });
export const billingIdSchema = z.object({ billingId: id("Cobrança") });
export const opportunityIdSchema = z.object({ opportunityId: id("Oportunidade") });

export const contractItemSchema = z.object({
  productId: id("Produto"),
  productName: z.string().trim().min(1, "Informe o nome do produto").max(120, "Nome do produto muito longo"),
  quantity: z.number("Quantidade inválida").int("Quantidade deve ser inteira").min(1, "Quantidade mínima é 1").max(10_000, "Quantidade muito alta"),
  setupValue: money("Adesão"),
  monthlyValue: money("Mensalidade"),
  hardwareValue: money("Hardware"),
  discountPct: z.number("Desconto inválido").min(0, "Desconto não pode ser negativo").max(100, "Desconto máximo é 100%"),
});
export type ContractItemInput = z.input<typeof contractItemSchema>;

export const updateItemsSchema = z.object({
  contractId: id("Contrato"),
  items: z.array(contractItemSchema).min(1, "O contrato precisa de pelo menos um item").max(50, "No máximo 50 itens"),
});

/** Reajuste da renovação (D26): nenhum, percentual informado ou índice (informado pelo CS a cada renovação). */
export const readjustmentSchema = z
  .object({
    type: z.enum(["nenhum", "percentual", "indice"], { message: "Tipo de reajuste inválido" }),
    percent: z.number("Percentual de reajuste inválido").min(0, "Percentual não pode ser negativo").max(100, "Percentual máximo é 100%").optional(),
    index: z.enum(["ipca", "igpm", "inpc"], { message: "Índice inválido" }).optional(),
  })
  .refine((v) => v.type !== "percentual" || (v.percent !== undefined && v.percent > 0), { message: "Informe o percentual do reajuste", path: ["percent"] })
  .refine((v) => v.type !== "indice" || Boolean(v.index), { message: "Escolha o índice do reajuste", path: ["index"] });

/** Condições de renovação (D26), todas opcionais: contratos antigos seguem o fluxo humano do CS. */
export const renewalFieldsSchema = z.object({
  autoRenew: z.boolean().optional(),
  renewalTermMonths: z.number("Prazo da renovação inválido").int("Prazo deve ser inteiro").min(1, "Prazo mínimo é 1 mês").max(120, "Prazo máximo é 120 meses").optional(),
  readjustment: readjustmentSchema.optional(),
  noticeDays: z.number("Antecedência inválida").int("Use dias inteiros").min(1, "Mínimo de 1 dia").max(180, "Máximo de 180 dias").optional(),
});
export type RenewalFieldsInput = z.input<typeof renewalFieldsSchema>;

export const conditionsFieldsSchema = z.object({
  billingDay: z.number("Dia de vencimento inválido").int("Dia de vencimento deve ser inteiro").min(1, "Dia de vencimento mínimo é 1").max(28, "Dia de vencimento máximo é 28"),
  firstDueDate: dateKey("Primeira data de vencimento").optional(),
  recurrence: z.enum(["mensal", "anual", "unico"], { message: "Recorrência inválida" }),
  termMonths: z.number("Prazo inválido").int("Prazo deve ser inteiro").min(1, "Prazo mínimo é 1 mês").max(120, "Prazo máximo é 120 meses"),
  paymentCondition: z.string().trim().max(300, "Condição de pagamento muito longa").optional(),
  /** Campos do fechamento estruturado (opcionais: contratos antigos não têm). */
  paymentMethod: z.enum(PAYMENT_METHODS, { message: "Forma de pagamento inválida" }).optional(),
  setupInstallments: z.number("Parcelas da adesão inválidas").int("Parcelas devem ser inteiras").min(1, "Mínimo 1 parcela").max(12, "Máximo 12 parcelas").optional(),
});

export const updateConditionsSchema = conditionsFieldsSchema.extend({ contractId: id("Contrato") }).extend(renewalFieldsSchema.shape);
export type UpdateConditionsInput = z.input<typeof updateConditionsSchema>;

// ---------------------------------------------------------------------------
// Aditivos (D25)
// ---------------------------------------------------------------------------

export const AMENDMENT_KINDS = ["itens", "condicoes", "renovacao", "reajuste", "misto"] as const;

/**
 * Criação de aditivo: itens novos e/ou condições novas (o servidor calcula antes/depois e as mudanças). Renovação
 * (`renewal`) é usada pelo CS e pela varredura; a página do contrato usa itens/condições.
 */
export const amendmentInputSchema = z
  .object({
    contractId: id("Contrato"),
    effectiveFrom: dateKey("Vigência do aditivo"),
    reason: z.string().trim().min(5, "Descreva o motivo do aditivo (mín. 5 caracteres)").max(500, "Motivo muito longo"),
    requiresSignature: z.boolean().optional(),
    items: z.array(contractItemSchema).min(1, "O contrato precisa de pelo menos um item").max(50, "No máximo 50 itens").optional(),
    conditions: conditionsFieldsSchema.extend(renewalFieldsSchema.shape).partial().optional(),
    renewal: z
      .object({
        months: z.number("Prazo da renovação inválido").int("Prazo deve ser inteiro").min(1, "Prazo mínimo é 1 mês").max(120, "Prazo máximo é 120 meses"),
        readjustment: readjustmentSchema.optional(),
      })
      .optional(),
  })
  .refine((v) => Boolean(v.items || v.conditions || v.renewal), { message: "Informe o que muda: itens, condições ou renovação", path: ["items"] });
export type AmendmentInput = z.input<typeof amendmentInputSchema>;

export const amendmentIdSchema = z.object({ amendmentId: id("Aditivo") });
export const cancelAmendmentSchema = z.object({ amendmentId: id("Aditivo"), reason: z.string().trim().min(5, "Descreva o motivo (mín. 5 caracteres)").max(500, "Motivo muito longo") });
/** Assinatura manual do aditivo: mesma evidência exigida no contrato. */
export const amendmentSignatureSchema = z
  .object({
    amendmentId: id("Aditivo"),
    email: z.email("E-mail do signatário inválido"),
    signedAt: dateKey("Data da assinatura"),
    evidenceUrl: z.union([z.literal(""), url]).optional(),
    description: z.string().trim().max(500, "Descrição muito longa").optional(),
  })
  .refine((v) => Boolean(v.evidenceUrl?.trim()) || (v.description?.trim().length ?? 0) >= 10, {
    message: "Informe a evidência: link do documento assinado ou uma descrição (mín. 10 caracteres)",
    path: ["description"],
  });
export type AmendmentSignatureInput = z.input<typeof amendmentSignatureSchema>;

export const signerSchema = z.object({
  contractId: id("Contrato"),
  name: z.string().trim().min(2, "Informe o nome do signatário").max(120, "Nome muito longo"),
  email: z.email("E-mail do signatário inválido"),
  role: z.string().trim().min(2, "Informe o papel do signatário").max(60, "Papel muito longo"),
});
export type SignerInput = z.input<typeof signerSchema>;

export const signerRefSchema = z.object({ contractId: id("Contrato"), email: z.email("E-mail do signatário inválido") });

/** Assinatura registrada manualmente: exige evidência (link do documento assinado ou descrição) e a data. */
export const manualSignatureSchema = z
  .object({
    contractId: id("Contrato"),
    email: z.email("E-mail do signatário inválido"),
    signedAt: dateKey("Data da assinatura"),
    evidenceUrl: z.union([z.literal(""), url]).optional(),
    description: z.string().trim().max(500, "Descrição muito longa").optional(),
  })
  .refine((v) => Boolean(v.evidenceUrl?.trim()) || (v.description?.trim().length ?? 0) >= 10, {
    message: "Informe a evidência: link do documento assinado ou uma descrição (mín. 10 caracteres)",
    path: ["description"],
  });
export type ManualSignatureInput = z.input<typeof manualSignatureSchema>;

export const manualContractSchema = z.object({
  clientId: id("Cliente"),
  recurrence: z.enum(["mensal", "anual", "unico"], { message: "Recorrência inválida" }),
  termMonths: z.number("Prazo inválido").int("Prazo deve ser inteiro").min(1, "Prazo mínimo é 1 mês").max(120, "Prazo máximo é 120 meses"),
  billingDay: z.number("Dia de vencimento inválido").int().min(1, "Dia de vencimento mínimo é 1").max(28, "Dia de vencimento máximo é 28"),
});

export const billingDataSchema = z.object({
  contractId: id("Contrato"),
  legalName: z.string().trim().max(160, "Razão social muito longa").optional(),
  document: z
    .string()
    .trim()
    .transform((v) => v.replace(/\D/g, ""))
    .refine((v) => v === "" || v.length === 11 || v.length === 14, "CPF/CNPJ deve ter 11 ou 14 dígitos")
    .optional(),
  email: z.union([z.literal(""), z.email("E-mail de faturamento inválido")]).optional(),
  street: z.string().trim().max(160).optional(),
  number: z.string().trim().max(20).optional(),
  district: z.string().trim().max(80).optional(),
  city: z.string().trim().max(80).optional(),
  state: z.string().trim().max(2, "UF com 2 letras").optional(),
  zip: z.string().trim().max(10).optional(),
});
export type BillingDataInput = z.input<typeof billingDataSchema>;

export const registerPaymentSchema = z.object({
  billingId: id("Cobrança"),
  paidAt: dateKey("Data do pagamento"),
  amount: z.number("Valor pago inválido").positive("Valor pago deve ser maior que zero").max(10_000_000, "Valor muito alto"),
  method: z.enum(PAYMENT_METHODS, { message: "Selecione a forma de pagamento" }),
  receiptUrl: z.union([z.literal(""), url]).optional(),
});
/**
 * Entrada da baixa. `source`/`externalPaymentId`/`providerEventId`/`provider` NÃO vêm da tela (a action força
 * "manual"): são usados pelo webhook do provedor e pela conciliação (deduplicação em `payment_events`).
 */
export type RegisterPaymentInput = z.input<typeof registerPaymentSchema> & {
  source?: "manual" | "provedor" | "conciliacao";
  externalPaymentId?: string;
  providerEventId?: string;
  provider?: string;
};

/** Boleto emitido no banco/ERP e registrado à mão: pelo menos linha digitável, nosso número, PDF ou PIX. */
export const registerBoletoSchema = z
  .object({
    billingId: id("Cobrança"),
    linhaDigitavel: z.string().trim().max(80, "Linha digitável muito longa").optional(),
    nossoNumero: z.string().trim().max(40, "Nosso número muito longo").optional(),
    codigoBarras: z.string().trim().max(60, "Código de barras muito longo").optional(),
    pdfUrl: z.union([z.literal(""), url]).optional(),
    banco: z.string().trim().max(60, "Banco muito longo").optional(),
    emitidoEm: dateKey("Data de emissão").optional(),
    pixCopiaECola: z.string().trim().max(500, "PIX copia e cola muito longo").optional(),
    pixQrCodeUrl: z.union([z.literal(""), url]).optional(),
    paymentUrl: z.union([z.literal(""), url]).optional(),
  })
  .refine((v) => Boolean(v.linhaDigitavel?.trim() || v.nossoNumero?.trim() || v.pdfUrl?.trim() || v.pixCopiaECola?.trim() || v.paymentUrl?.trim()), {
    message: "Informe pelo menos a linha digitável, o nosso número, o PDF do boleto, o PIX ou o link de pagamento",
    path: ["linhaDigitavel"],
  });
export type RegisterBoletoInput = z.input<typeof registerBoletoSchema>;

export const BILLING_MESSAGE_CHANNELS = ["whatsapp", "email", "ambos"] as const;
export type BillingMessageChannel = (typeof BILLING_MESSAGE_CHANNELS)[number];

/** Mensagem de cobrança (WhatsApp principal, e-mail complementar) com ou sem os dados do boleto (2ª via). */
export const sendBillingMessageSchema = z.object({
  billingId: id("Cobrança"),
  channel: z.enum(BILLING_MESSAGE_CHANNELS, { message: "Canal inválido" }),
  text: z.string().trim().max(2000, "Texto muito longo").optional(),
  includeBoleto: z.boolean().optional(),
});
export type SendBillingMessageInput = z.input<typeof sendBillingMessageSchema>;

export const reversePaymentSchema = z.object({ billingId: id("Cobrança"), reason: z.string().trim().min(5, "Descreva o motivo do estorno (mín. 5 caracteres)").max(500, "Motivo muito longo") });

/** Filtro "Boleto" das listas de cobranças. */
export const BOLETO_FILTERS = ["sem_boleto", "emitido", "pago"] as const;
export type BoletoFilter = (typeof BOLETO_FILTERS)[number];
export const BOLETO_FILTER_LABELS: Record<BoletoFilter, string> = { sem_boleto: "Sem boleto", emitido: "Boleto emitido", pago: "Boleto pago" };

/** Situação do boleto de uma cobrança para badge/filtro: sem boleto · emitido · pago. */
export function boletoState(b: Pick<Billing, "status" | "boleto" | "pix" | "paymentUrl" | "externalId">): BoletoFilter {
  const issued = Boolean(b.boleto?.linhaDigitavel || b.boleto?.nossoNumero || b.boleto?.pdfUrl || b.boleto?.codigoBarras || b.pix?.copiaECola || b.paymentUrl || b.externalId);
  if (!issued) return "sem_boleto";
  return b.status === "paga" ? "pago" : "emitido";
}

export const cancelBillingSchema = z.object({ billingId: id("Cobrança"), reason: z.string().trim().min(3, "Informe o motivo do cancelamento").max(300, "Motivo muito longo") });

export const pendencySchema = z.object({ contractId: id("Contrato"), reason: z.string().trim().min(5, "Descreva o motivo da pendência").max(500, "Motivo muito longo") });

export const resolvePendencySchema = z.object({ contractId: id("Contrato"), resolution: z.string().trim().max(500, "Texto muito longo").optional() });

export const contractDocumentSchema = z.object({
  contractId: id("Contrato"),
  name: z.string().trim().min(2, "Informe o nome do documento").max(160, "Nome muito longo"),
  url,
  category: z.string().trim().max(60).optional(),
});

export const cancelContractSchema = z.object({ contractId: id("Contrato"), reason: z.string().trim().min(5, "Descreva o motivo do cancelamento (mín. 5 caracteres)").max(500, "Motivo muito longo") });

export const releaseSchema = z.object({ contractId: id("Contrato"), exceptionReason: z.string().trim().max(500, "Motivo muito longo").optional() });

export const billingContactSchema = z.object({ billingId: id("Cobrança"), notes: z.string().trim().max(500, "Texto muito longo").optional() });

/** Primeiro problema de um ZodError em uma frase para o usuário. */
export function zodMessage(error: z.ZodError): string {
  return error.issues[0]?.message ?? "Dados inválidos";
}
