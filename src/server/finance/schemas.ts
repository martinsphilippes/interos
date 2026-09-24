import { z } from "zod";
import type { Billing, Contract } from "@/domain/types";

/**
 * Esquemas (zod) e constantes puras do módulo Financeiro. Sem dependências de servidor: é importado
 * pelas Server Actions e pelos Client Components (mensagens em português exibidas na interface).
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

/** Quem opera o Financeiro (altera contratos e cobranças): equipe financeira, gestores, diretoria e admin. */
export function canOperateFinance(user: { isAdmin: boolean; isManager: boolean; role: string; departmentId: string }): boolean {
  return user.isAdmin || user.isManager || user.role === "financeiro" || user.departmentId === "financeiro";
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

export const updateConditionsSchema = z.object({
  contractId: id("Contrato"),
  billingDay: z.number("Dia de vencimento inválido").int("Dia de vencimento deve ser inteiro").min(1, "Dia de vencimento mínimo é 1").max(28, "Dia de vencimento máximo é 28"),
  firstDueDate: dateKey("Primeira data de vencimento").optional(),
  recurrence: z.enum(["mensal", "anual", "unico"], { message: "Recorrência inválida" }),
  termMonths: z.number("Prazo inválido").int("Prazo deve ser inteiro").min(1, "Prazo mínimo é 1 mês").max(120, "Prazo máximo é 120 meses"),
  paymentCondition: z.string().trim().max(300, "Condição de pagamento muito longa").optional(),
});
export type UpdateConditionsInput = z.input<typeof updateConditionsSchema>;

export const signerSchema = z.object({
  contractId: id("Contrato"),
  name: z.string().trim().min(2, "Informe o nome do signatário").max(120, "Nome muito longo"),
  email: z.email("E-mail do signatário inválido"),
  role: z.string().trim().min(2, "Informe o papel do signatário").max(60, "Papel muito longo"),
});
export type SignerInput = z.input<typeof signerSchema>;

export const signerRefSchema = z.object({ contractId: id("Contrato"), email: z.email("E-mail do signatário inválido") });

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
export type RegisterPaymentInput = z.input<typeof registerPaymentSchema>;

export const cancelBillingSchema = z.object({ billingId: id("Cobrança"), reason: z.string().trim().min(3, "Informe o motivo do cancelamento").max(300, "Motivo muito longo") });

export const pendencySchema = z.object({ contractId: id("Contrato"), reason: z.string().trim().min(5, "Descreva o motivo da pendência").max(500, "Motivo muito longo") });

export const resolvePendencySchema = z.object({ contractId: id("Contrato"), resolution: z.string().trim().max(500, "Texto muito longo").optional() });

export const contractDocumentSchema = z.object({
  contractId: id("Contrato"),
  name: z.string().trim().min(2, "Informe o nome do documento").max(160, "Nome muito longo"),
  url,
  category: z.string().trim().max(60).optional(),
});

export const releaseSchema = z.object({ contractId: id("Contrato"), exceptionReason: z.string().trim().max(500, "Motivo muito longo").optional() });

export const billingContactSchema = z.object({ billingId: id("Cobrança"), notes: z.string().trim().max(500, "Texto muito longo").optional() });

/** Primeiro problema de um ZodError em uma frase para o usuário. */
export function zodMessage(error: z.ZodError): string {
  return error.issues[0]?.message ?? "Dados inválidos";
}
