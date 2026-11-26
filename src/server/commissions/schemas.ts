/**
 * Esquemas (zod) das ações de Comissões e Contas a Pagar. Sem dependências de servidor: importado pelas Server Actions
 * e pelos formulários (mesmas mensagens em português).
 */
import { z } from "zod";
import { PRODUCT_CATEGORIES } from "@/domain/constants";

const isoDay = z.string().regex(/^\d{4}-\d{2}-\d{2}/, "Data inválida");
const optionalText = (max: number) => z.string().trim().max(max, `Máximo de ${max} caracteres`).optional().or(z.literal("").transform(() => undefined));

export const COMMISSION_TRIGGERS = ["venda", "contrato_assinado", "primeiro_pagamento", "pagamento", "permanencia", "pagamento_e_permanencia", "mensalidade_n", "faturamento"] as const;
/** Recorrência: cada competência depende do recebimento (ou do faturamento) da mensalidade correspondente. */
export const RECURRING_TRIGGERS = ["pagamento", "pagamento_e_permanencia", "mensalidade_n", "faturamento"] as const;

const money = (label: string) => z.number(`${label} inválido`).positive(`${label} deve ser maior que zero`).max(10_000_000, `${label} muito alto`);

export const deductionSchema = z.object({
  label: z.string().trim().min(2, "Dê um nome à dedução (ex.: ISS)").max(60, "Nome da dedução muito longo"),
  mode: z.enum(["percentual", "valor"], { message: "Tipo de dedução inválido" }),
  value: z.number("Informe o valor da dedução").positive("A dedução deve ser maior que zero").max(1_000_000, "Dedução muito alta"),
});

export const ruleInputSchema = z
  .object({
    id: z.string().trim().min(1).optional(),
    name: z.string().trim().min(3, "Dê um nome à regra (mín. 3 caracteres)").max(80, "Nome muito longo"),
    scope: z.enum(["padrao", "vendedor", "contrato"], { message: "Abrangência inválida" }),
    userId: optionalText(60),
    contractId: optionalText(60),
    revenueType: z.enum(["setup", "recorrencia", "hardware"], { message: "Tipo de receita inválido" }),
    productId: optionalText(60),
    productCategory: z.enum(PRODUCT_CATEGORIES).optional().or(z.literal("").transform(() => undefined)),
    mode: z.enum(["percentual", "valor"], { message: "Forma de cálculo inválida" }),
    value: z.number("Informe o valor da comissão").positive("O valor da comissão deve ser maior que zero").max(1_000_000, "Valor muito alto"),
    trigger: z.enum(COMMISSION_TRIGGERS, { message: "Gatilho inválido" }),
    baseSource: z.enum(["contratado", "recebido"], { message: "Base inválida" }),
    minTenureDays: z.number("Carência inválida").int("Use dias inteiros").min(0, "Carência não pode ser negativa").max(730, "Carência máxima de 730 dias"),
    /** null = enquanto ativo. */
    recurringCompetences: z.number("Competências inválidas").int("Use um número inteiro").min(1, "Mínimo de 1 competência").max(120, "Máximo de 120 competências").nullable(),
    releaseInstallment: z.number("Mensalidade inicial inválida").int("Use um número inteiro").min(1, "Mínimo: 1ª mensalidade").max(60, "Máximo: 60ª mensalidade"),
    validFrom: isoDay.optional().or(z.literal("").transform(() => undefined)),
    validTo: isoDay.optional().or(z.literal("").transform(() => undefined)),
    overridesDefault: z.boolean("Informe se a regra substitui a padrão"),
    reason: optionalText(500),
    active: z.boolean().default(true),
    // Motor v3
    code: z
      .string()
      .trim()
      .max(40, "Código muito longo (máx. 40)")
      .regex(/^[A-Za-z0-9._-]*$/, "Código: use letras, números, ponto, hífen ou sublinhado")
      .optional()
      .transform((v) => (v ? v.toUpperCase() : undefined)),
    description: optionalText(500),
    planId: optionalText(60),
    /** null/ausente = prioridade automática pela especificidade. */
    priority: z.number("Prioridade inválida").int("Use um número inteiro").min(0, "Prioridade mínima é 0").max(999, "Prioridade máxima é 999").nullable().optional(),
    baseKind: z.enum(["liquido", "bruto", "referencia"], { message: "Base de cálculo inválida" }).default("liquido"),
    deductions: z.array(deductionSchema).max(10, "Máximo de 10 deduções").default([]),
    referenceValue: money("Valor de referência").nullable().optional(),
    baseCap: money("Teto da base").nullable().optional(),
    amountCap: money("Teto da comissão").nullable().optional(),
    installments: z.array(z.number().int("Mensalidade inválida").min(1, "Mensalidade mínima: 1ª").max(120, "Mensalidade máxima: 120ª")).max(60, "Máximo de 60 mensalidades").default([]),
    reverseOnCancel: z.boolean().default(false),
    /** Reaplicar a nova versão às comissões ainda não adquiridas de vendas anteriores (exige permissão própria). */
    applyToPending: z.boolean().default(false),
  })
  .superRefine((v, ctx) => {
    if (v.baseKind === "referencia" && !v.referenceValue) ctx.addIssue({ code: "custom", path: ["referenceValue"], message: "Informe o valor fixo de referência" });
    if (v.baseKind === "referencia" && v.mode !== "percentual") ctx.addIssue({ code: "custom", path: ["mode"], message: "Base de referência só faz sentido com percentual" });
    if (v.baseKind !== "liquido" && v.deductions.length > 0) ctx.addIssue({ code: "custom", path: ["deductions"], message: "Deduções só se aplicam à base líquida" });
    if (v.mode === "valor" && v.baseCap) ctx.addIssue({ code: "custom", path: ["baseCap"], message: "Teto da base só se aplica a comissão percentual" });
    if (v.trigger === "faturamento" && v.baseSource === "recebido") ctx.addIssue({ code: "custom", path: ["trigger"], message: "No faturamento ainda não há valor recebido: use a base contratada" });
    if (v.installments.length > 0 && v.revenueType !== "recorrencia") ctx.addIssue({ code: "custom", path: ["installments"], message: "Mensalidades específicas só valem para recorrência" });
    if (v.installments.length > 0 && v.trigger === "mensalidade_n") ctx.addIssue({ code: "custom", path: ["trigger"], message: "Com mensalidades específicas, escolha gerar no faturamento ou após o pagamento" });
    if (v.scope === "vendedor" && !v.userId) ctx.addIssue({ code: "custom", path: ["userId"], message: "Escolha o vendedor da regra" });
    if (v.scope === "contrato" && !v.contractId) ctx.addIssue({ code: "custom", path: ["contractId"], message: "Escolha o contrato da exceção" });
    if (v.scope === "contrato" && (v.reason?.length ?? 0) < 10) ctx.addIssue({ code: "custom", path: ["reason"], message: "Exceção por contrato exige o motivo (mín. 10 caracteres)" });
    if (v.mode === "percentual" && v.value > 100) ctx.addIssue({ code: "custom", path: ["value"], message: "Percentual máximo de 100%" });
    if (v.productId && v.productCategory) ctx.addIssue({ code: "custom", path: ["productCategory"], message: "Use produto OU categoria, não os dois" });
    if (v.revenueType === "recorrencia" && !(RECURRING_TRIGGERS as readonly string[]).includes(v.trigger)) {
      ctx.addIssue({ code: "custom", path: ["trigger"], message: "Recorrência é liberada pelo recebimento de cada mensalidade (com ou sem carência)" });
    }
    if (v.validFrom && v.validTo && v.validTo.slice(0, 10) < v.validFrom.slice(0, 10)) ctx.addIssue({ code: "custom", path: ["validTo"], message: "Fim da vigência antes do início" });
  });
export type RuleInput = z.infer<typeof ruleInputSchema>;

export const ruleActiveSchema = z.object({
  id: z.string().trim().min(1, "Regra inválida"),
  active: z.boolean(),
  reason: z.string().trim().min(5, "Informe o motivo (mín. 5 caracteres)").max(500, "Motivo muito longo"),
  applyToPending: z.boolean().default(false),
});

const simMoney = (label: string) => z.number(`${label} inválido`).min(0, `${label} não pode ser negativo`).max(100_000_000, `${label} muito alto`).optional();

/** Entrada do simulador de comissões (valores digitados; regras vêm do banco + o rascunho em edição). */
export const simulationSchema = z.object({
  sellerId: optionalText(60),
  productId: optionalText(60),
  planId: optionalText(60),
  saleValue: simMoney("Valor da venda"),
  setupValue: simMoney("Valor da adesão"),
  monthlyValue: simMoney("Valor da mensalidade"),
  receivedValue: simMoney("Valor líquido"),
  installment: z.number("Mensalidade inválida").int("Use um número inteiro").min(1, "Mínimo: 1ª mensalidade").max(120, "Máximo: 120ª mensalidade").default(1),
  quantity: z.number("Quantidade inválida").int("Use um número inteiro").min(1, "Quantidade mínima 1").max(10_000).default(1),
  discountPct: z.number("Desconto inválido").min(0).max(100, "Desconto máximo 100%").default(0),
  saleDate: isoDay.optional().or(z.literal("").transform(() => undefined)),
  event: z.enum(["pago", "faturado"]).default("pago"),
});
export type SimulationFormInput = z.input<typeof simulationSchema>;

export const paymentDaySchema = z.object({ diaPagamento: z.number("Dia inválido").int("Use um dia inteiro").min(1, "Dia mínimo é 1").max(28, "Dia máximo é 28") });

const reason = z.string().trim().min(5, "Informe o motivo (mín. 5 caracteres)").max(500, "Motivo muito longo");

export const commissionReasonSchema = z.object({ commissionId: z.string().trim().min(1, "Comissão inválida"), reason });
export const commissionIdSchema = z.object({ commissionId: z.string().trim().min(1, "Comissão inválida") });

export const payableIdSchema = z.object({ payableId: z.string().trim().min(1, "Título inválido"), note: optionalText(500) });
export const schedulePayableSchema = z.object({ payableId: z.string().trim().min(1, "Título inválido"), dueDate: isoDay.optional().or(z.literal("").transform(() => undefined)), note: optionalText(500) });
export const payPayableSchema = z.object({
  payableId: z.string().trim().min(1, "Título inválido"),
  paidAt: isoDay,
  paymentMethod: z.enum(["pix", "transferencia", "boleto", "dinheiro", "folha"], { message: "Forma de pagamento inválida" }),
  receiptUrl: z.string().trim().url("Link do comprovante inválido").max(500).optional().or(z.literal("").transform(() => undefined)),
  notes: optionalText(500),
});
export const cancelPayableSchema = z.object({ payableId: z.string().trim().min(1, "Título inválido"), reason });
export const updatePayableSchema = z.object({
  payableId: z.string().trim().min(1, "Título inválido"),
  description: optionalText(200),
  dueDate: isoDay.optional().or(z.literal("").transform(() => undefined)),
  amount: z.number("Valor inválido").positive("Valor deve ser maior que zero").max(10_000_000).optional(),
  notes: optionalText(500),
  costCenter: optionalText(60),
  /** Série recorrente: nova data limite (AAAA-MM-DD) para encerrar a série. */
  recurrenceUntil: isoDay.optional().or(z.literal("").transform(() => undefined)),
  reason,
});
const categoryKey = z.string().trim().min(2, "Categoria inválida").max(40, "Categoria muito longa").regex(/^[a-z0-9][a-z0-9_]*$/, "Categoria inválida");
const attachmentUrl = z.string().trim().url("Link do anexo inválido").max(500).optional().or(z.literal("").transform(() => undefined));

/** Recorrência de título manual (D28): a varredura contas_recorrentes cria a próxima ocorrência 30 dias antes do vencimento. */
export const payableRecurrenceSchema = z.object({
  frequency: z.enum(["mensal", "anual"], { message: "Frequência inválida" }),
  dayOfMonth: z.number("Dia inválido").int("Use um dia inteiro").min(1, "Dia mínimo é 1").max(28, "Dia máximo é 28"),
  until: isoDay.optional().or(z.literal("").transform(() => undefined)),
});

/**
 * Título manual (D28): credor colaborador ou fornecedor (cadastrado ou nome livre), categoria do setting `contas_a_pagar`
 * (as fixas continuam válidas), centro de custo, parcelamento (N títulos), recorrência (série) e anexo por link.
 */
export const manualPayableSchema = z
  .object({
    creditorType: z.enum(["colaborador", "fornecedor"], { message: "Tipo de credor inválido" }),
    creditorId: optionalText(60),
    creditorName: optionalText(120),
    supplierId: optionalText(60),
    category: categoryKey,
    costCenter: optionalText(60),
    description: z.string().trim().min(3, "Descreva o título").max(200, "Descrição muito longa"),
    amount: z.number("Informe o valor").positive("Valor deve ser maior que zero").max(10_000_000, "Valor muito alto"),
    competence: z.string().regex(/^\d{4}-(0[1-9]|1[0-2])$/, "Competência inválida (AAAA-MM)"),
    dueDate: isoDay,
    notes: optionalText(500),
    /** Parcelas (1 = à vista; N títulos `pag_<base>_p<n>`, vencimentos mensais). */
    installments: z.number("Parcelas inválidas").int("Parcelas devem ser inteiras").min(1, "Mínimo 1 parcela").max(48, "Máximo 48 parcelas").optional(),
    recurrence: payableRecurrenceSchema.optional(),
    attachmentUrl,
    attachmentName: optionalText(120),
  })
  .superRefine((v, ctx) => {
    if (v.creditorType === "colaborador" && !v.creditorId) ctx.addIssue({ code: "custom", path: ["creditorId"], message: "Escolha o colaborador" });
    if (v.creditorType === "fornecedor" && !v.creditorName && !v.supplierId) ctx.addIssue({ code: "custom", path: ["creditorName"], message: "Informe ou escolha o fornecedor" });
    if ((v.installments ?? 1) > 1 && v.recurrence) ctx.addIssue({ code: "custom", path: ["recurrence"], message: "Use parcelamento OU recorrência, não os dois" });
    if (v.category === "comissao_comercial" || v.category === "estorno_comissao") ctx.addIssue({ code: "custom", path: ["category"], message: "Comissões e estornos nascem do motor de comissões, não de lançamento manual" });
  });
export type ManualPayableSchemaInput = z.input<typeof manualPayableSchema>;

export const payableAttachmentSchema = z.object({
  payableId: z.string().trim().min(1, "Título inválido"),
  name: z.string().trim().min(2, "Informe o nome do anexo").max(120, "Nome muito longo"),
  url: z.string().trim().url("Link do anexo inválido").max(500),
});

/** Fornecedor (D28): cadastro simples de credor — não é cliente. */
export const supplierSchema = z.object({
  id: z.string().trim().min(1).optional(),
  name: z.string().trim().min(2, "Informe o nome do fornecedor").max(120, "Nome muito longo"),
  document: z
    .string()
    .trim()
    .transform((v) => v.replace(/\D/g, ""))
    .refine((v) => v === "" || v.length === 11 || v.length === 14, "CPF/CNPJ deve ter 11 ou 14 dígitos")
    .optional(),
  email: z.string().trim().toLowerCase().email("E-mail inválido").optional().or(z.literal("").transform(() => undefined)),
  phone: optionalText(30),
  pixKey: optionalText(120),
  bank: z.object({ banco: optionalText(60), agencia: optionalText(20), conta: optionalText(30) }).optional(),
  category: optionalText(40),
  notes: optionalText(500),
  active: z.boolean().default(true),
});
export type SupplierInput = z.infer<typeof supplierSchema>;
export const supplierActiveSchema = z.object({ id: z.string().trim().min(1, "Fornecedor inválido"), active: z.boolean() });

export const PAYOUT_METHODS = ["pix", "transferencia", "folha", "boleto", "dinheiro"] as const;
export const PAYOUT_METHOD_LABELS: Record<(typeof PAYOUT_METHODS)[number], string> = { pix: "PIX", transferencia: "Transferência", folha: "Folha de pagamento", boleto: "Boleto", dinheiro: "Dinheiro" };

export function zodMessage(error: z.ZodError): string {
  return error.issues[0]?.message ?? "Dados inválidos";
}
