"use server";
/**
 * Server Actions do Faturamento (notas fiscais). Padrão do Financeiro: requirePermission(chave do catálogo
 * financeiro.faturamento.*) → zod → escopo da cobrança/nota (assertBillingAccess) → serviço (invoices.ts) →
 * revalidatePath. Registrar a nota é rota (/api/financeiro/notas: o PDF/XML passa do limite de 1 MB das actions).
 */
import { revalidatePath } from "next/cache";
import { z } from "zod";
import { can, failAction, PermissionError, requirePermission } from "@/server/auth/session";
import { BusinessError } from "@/server/auth/error-classes";
import type { ActionResult, CurrentUser, UserRef } from "@/domain/types";
import { FISCAL_REGIMES, INVOICE_RULES, PRODUCT_FISCAL_NATURES } from "@/domain/fiscal";
import { assertBillingAccess } from "./access";
import {
  cancelInvoice,
  getInvoice,
  getInvoiceIssueData,
  invoiceMessageDraft,
  restoreBillingInvoice,
  saveFiscalSettings,
  saveProductFiscal,
  sendInvoice,
  waiveBillingInvoice,
  type InvoiceIssueData,
  type InvoiceSendResult,
} from "./invoices";

type Failure = { ok: false; error: string };

function fail(error: unknown, fallback: string): Failure {
  if (error instanceof z.ZodError) return { ok: false, error: error.issues[0]?.message ?? fallback };
  return failAction(error, fallback, "financeiro");
}

const actorOf = (user: CurrentUser): UserRef => ({
  id: user.id,
  name: user.name,
});

function revalidateInvoicing(clientId?: string, contractId?: string) {
  revalidatePath("/financeiro", "layout");
  if (contractId) revalidatePath(`/financeiro/contratos/${contractId}`);
  if (clientId) revalidatePath(`/clientes/${clientId}`);
}

const id = (label: string) => z.string().trim().min(1, `${label} inválido(a)`).max(80);
const reason = z.string().trim().min(5, "Explique o motivo (mínimo 5 caracteres)").max(500, "Motivo muito longo");

/** Nota → cobrança no escopo de quem pede (fora do escopo = PermissionError; inexistente = BusinessError). */
async function assertInvoiceAccess(user: CurrentUser, invoiceId: string) {
  const invoice = await getInvoice(invoiceId);
  if (!invoice) throw new BusinessError("Nota não encontrada");
  await assertBillingAccess(user, invoice.billingId, "financeiro.faturamento");
  return invoice;
}

export async function invoiceIssueDataAction(input: unknown): Promise<ActionResult<InvoiceIssueData>> {
  try {
    const user = await requirePermission("financeiro.faturamento.dados.consultar");
    const { billingId } = z.object({ billingId: id("Cobrança") }).parse(input);
    await assertBillingAccess(user, billingId, "financeiro.faturamento");
    const data = await getInvoiceIssueData(billingId);
    // Valores (itens e cobrança) só para quem vê valores.
    if (!can(user, "financeiro.valores.ver")) {
      return {
        ok: true,
        data: {
          ...data,
          billing: { ...data.billing, amount: 0 },
          items: data.items.map((i) => ({ ...i, unitValue: 0, total: 0 })),
        },
      };
    }
    return { ok: true, data };
  } catch (error) {
    return fail(error, "Não foi possível carregar os dados da nota");
  }
}

export async function cancelInvoiceAction(input: unknown): Promise<ActionResult> {
  try {
    const user = await requirePermission("financeiro.faturamento.cancelar");
    const data = z.object({ invoiceId: id("Nota"), reason }).parse(input);
    const invoice = await assertInvoiceAccess(user, data.invoiceId);
    await cancelInvoice(invoice.id, data.reason, actorOf(user));
    revalidateInvoicing(invoice.clientId, invoice.contractId);
    return { ok: true, data: undefined };
  } catch (error) {
    return fail(error, "Não foi possível cancelar a nota");
  }
}

export async function waiveInvoiceAction(input: unknown): Promise<ActionResult> {
  try {
    const user = await requirePermission("financeiro.faturamento.dispensar");
    const data = z.object({ billingId: id("Cobrança"), reason }).parse(input);
    const billing = await assertBillingAccess(user, data.billingId, "financeiro.faturamento");
    await waiveBillingInvoice(billing.id, data.reason, actorOf(user));
    revalidateInvoicing(billing.clientId, billing.contractId);
    return { ok: true, data: undefined };
  } catch (error) {
    return fail(error, "Não foi possível dispensar a nota");
  }
}

export async function restoreInvoiceAction(input: unknown): Promise<ActionResult> {
  try {
    const user = await requirePermission("financeiro.faturamento.dispensar");
    const data = z.object({ billingId: id("Cobrança") }).parse(input);
    const billing = await assertBillingAccess(user, data.billingId, "financeiro.faturamento");
    await restoreBillingInvoice(billing.id, actorOf(user));
    revalidateInvoicing(billing.clientId, billing.contractId);
    return { ok: true, data: undefined };
  } catch (error) {
    return fail(error, "Não foi possível desfazer a dispensa");
  }
}

export async function invoiceMessageDraftAction(input: unknown): Promise<
  ActionResult<{
    text: string;
    contactName: string;
    email?: string;
    phone?: string;
  }>
> {
  try {
    const user = await requirePermission("financeiro.faturamento.enviar");
    if (!can(user, "financeiro.valores.ver")) throw new PermissionError("Enviar a nota exige ver os valores (a mensagem leva o valor da nota).", "financeiro.valores.ver");
    const data = z.object({ invoiceId: id("Nota") }).parse(input);
    await assertInvoiceAccess(user, data.invoiceId);
    return { ok: true, data: await invoiceMessageDraft(data.invoiceId) };
  } catch (error) {
    return fail(error, "Não foi possível montar a mensagem");
  }
}

export async function sendInvoiceAction(input: unknown): Promise<ActionResult<{ results: InvoiceSendResult[]; contactName: string }>> {
  try {
    const user = await requirePermission("financeiro.faturamento.enviar");
    if (!can(user, "financeiro.valores.ver")) throw new PermissionError("Enviar a nota exige ver os valores (a mensagem leva o valor da nota).", "financeiro.valores.ver");
    const data = z
      .object({
        invoiceId: id("Nota"),
        channel: z.enum(["email", "whatsapp", "ambos"], {
          message: "Canal inválido",
        }),
        text: z.string().trim().max(2000, "Mensagem muito longa").optional(),
      })
      .parse(input);
    const invoice = await assertInvoiceAccess(user, data.invoiceId);
    const result = await sendInvoice(invoice.id, { channel: data.channel, text: data.text }, actorOf(user));
    revalidateInvoicing(invoice.clientId, invoice.contractId);
    return { ok: true, data: result };
  } catch (error) {
    return fail(error, "Não foi possível enviar a nota");
  }
}

const optText = (max: number) =>
  z
    .string()
    .trim()
    .max(max, "Texto muito longo")
    .optional()
    .transform((v) => v || undefined);
const optRate = z
  .union([z.number(), z.string()])
  .optional()
  .transform((v, ctx) => {
    if (v === undefined || v === "") return undefined;
    const n = typeof v === "number" ? v : Number(String(v).replace(",", "."));
    if (!Number.isFinite(n) || n < 0 || n > 100) {
      ctx.addIssue({
        code: "custom",
        message: "Alíquota deve estar entre 0 e 100",
      });
      return z.NEVER;
    }
    return Math.round(n * 100) / 100;
  });

const fiscalSettingsSchema = z.object({
  enabled: z.boolean(),
  regime: z.enum(FISCAL_REGIMES).optional(),
  municipalRegistration: optText(30),
  stateRegistration: optText(30),
  cnae: optText(20),
  defaultServiceCode: optText(20),
  defaultIssRate: optRate,
  defaultNcm: z
    .string()
    .trim()
    .optional()
    .transform((v) => v?.replace(/\D/g, "") || undefined)
    .refine((v) => !v || /^\d{8}$/.test(v), "NCM padrão deve ter 8 dígitos"),
  defaultCfop: z
    .string()
    .trim()
    .optional()
    .transform((v) => v?.replace(/\D/g, "") || undefined)
    .refine((v) => !v || /^\d{4}$/.test(v), "CFOP padrão deve ter 4 dígitos"),
  rules: z.object({
    setup: z.enum(INVOICE_RULES),
    mensalidade: z.enum(INVOICE_RULES),
    hardware: z.enum(INVOICE_RULES),
    servico: z.enum(INVOICE_RULES),
  }),
  moment: z.enum(["vencimento", "pagamento"]),
  leadDays: z
    .union([z.number(), z.string().trim().min(1, "Informe os dias antes do vencimento")])
    .transform((v) => Number(v))
    .pipe(z.number({ message: "Dias inválidos" }).int("Dias inteiros").min(0, "Mínimo 0 dias").max(60, "Máximo 60 dias")),
  since: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Data de início inválida"),
  messageTemplate: optText(1000),
});

export async function saveFiscalSettingsAction(input: unknown): Promise<ActionResult> {
  try {
    const user = await requirePermission("financeiro.faturamento.configuracao.editar");
    const data = fiscalSettingsSchema.parse(input);
    await saveFiscalSettings(data, actorOf(user));
    revalidatePath("/financeiro", "layout");
    return { ok: true, data: undefined };
  } catch (error) {
    return fail(error, "Não foi possível salvar a configuração fiscal");
  }
}

const productFiscalSchema = z.object({
  productId: id("Produto"),
  nature: z.enum(PRODUCT_FISCAL_NATURES, {
    message: "Escolha a natureza do produto",
  }),
  serviceCode: optText(20),
  issRate: optRate,
  ncm: z
    .string()
    .trim()
    .optional()
    .transform((v) => v?.replace(/\D/g, "") || undefined)
    .refine((v) => !v || /^\d{8}$/.test(v), "NCM deve ter 8 dígitos"),
  cfop: z
    .string()
    .trim()
    .optional()
    .transform((v) => v?.replace(/\D/g, "") || undefined)
    .refine((v) => !v || /^\d{4}$/.test(v), "CFOP deve ter 4 dígitos"),
  invoiceDescription: optText(200),
});

export async function saveProductFiscalAction(input: unknown): Promise<ActionResult> {
  try {
    const user = await requirePermission("financeiro.faturamento.configuracao.editar");
    const { productId, ...profile } = productFiscalSchema.parse(input);
    await saveProductFiscal(productId, profile, actorOf(user));
    revalidatePath("/financeiro/faturamento");
    return { ok: true, data: undefined };
  } catch (error) {
    return fail(error, "Não foi possível salvar o perfil fiscal");
  }
}
