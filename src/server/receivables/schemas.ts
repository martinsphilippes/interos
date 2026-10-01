/**
 * Esquemas (zod) dos títulos a receber AVULSOS (etapa CP/CR 3). Sem dependências de servidor: importado pelas Server
 * Actions e pelos formulários (mesmas mensagens em português).
 */
import { z } from "zod";
import { PAYMENT_METHODS } from "@/server/finance/schemas";
import { titleRepeatSchema } from "@/server/commissions/schemas";

const isoDay = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Data inválida");
const month = z.string().regex(/^\d{4}-(0[1-9]|1[0-2])$/, "Competência inválida (AAAA-MM)");
const optionalText = (max: number) => z.string().trim().max(max, `Máximo de ${max} caracteres`).optional().or(z.literal("").transform(() => undefined));
const optionalId = optionalText(80);
const id = z.string().trim().min(1, "Título inválido").max(120);
const money = (msg: string) => z.number(msg).positive("O valor deve ser maior que zero").max(10_000_000, "Valor muito alto");
const reason = z.string().trim().min(5, "Descreva o motivo (mín. 5 caracteres)").max(500, "Máximo de 500 caracteres");
const url = z.string().trim().url("Link inválido").max(500);

/** Formas de recebimento (as mesmas da baixa de cobrança). */
export const RECEIPT_METHODS = PAYMENT_METHODS;

export const receivableCreateSchema = z.object({
  description: z.string().trim().min(3, "Descreva o título (mín. 3 caracteres)").max(200, "Máximo de 200 caracteres"),
  amount: money("Informe o valor"),
  dueDate: isoDay,
  /** Vazia = mês do vencimento (cada parcela: o mês do próprio vencimento). */
  competence: month.optional().or(z.literal("").transform(() => undefined)),
  clientId: optionalId,
  payerName: optionalText(160),
  categoryId: optionalId,
  costCenterId: optionalId,
  accountId: optionalId,
  documentNumber: optionalText(60),
  notes: optionalText(1000),
  /** Único (1) ou parcelado mensal (2–48; sobra de centavos na última parcela) — formato da etapa 3, mantido. */
  installments: z.number("Parcelas inválidas").int("Parcelas inválidas").min(1).max(48, "Máximo de 48 parcelas").optional(),
  /** Repetição do formulário (etapa CP/CR 4): Único / Fixo / Parcelado, a cada N dias, semanas ou meses. */
  repeat: titleRepeatSchema.optional(),
  attachmentUrl: url.optional().or(z.literal("").transform(() => undefined)),
  attachmentName: optionalText(160),
});
export type ReceivableCreateInput = z.infer<typeof receivableCreateSchema>;

/** Campo que pode ser LIMPO na edição: "" = remover; ausente = manter. */
const clearable = (max: number) => z.string().trim().max(max, `Máximo de ${max} caracteres`).optional();

export const receivableUpdateSchema = z.object({
  receivableId: id,
  description: optionalText(200),
  amount: money("Valor inválido").optional(),
  dueDate: isoDay.optional().or(z.literal("").transform(() => undefined)),
  competence: month.optional().or(z.literal("").transform(() => undefined)),
  clientId: optionalId,
  payerName: optionalText(160),
  categoryId: clearable(80),
  costCenterId: clearable(80),
  accountId: clearable(80),
  documentNumber: clearable(60),
  notes: clearable(1000),
  reason,
});
export type ReceivableUpdateInput = z.infer<typeof receivableUpdateSchema>;

const receiveBase = z.object({
  receivableId: id,
  paidAt: isoDay,
  method: z.enum(RECEIPT_METHODS, { message: "Selecione a forma de recebimento" }),
  /** Conta financeira onde o dinheiro entrou: obrigatória (mensagem própria quando falta). */
  accountId: optionalId,
  receiptUrl: url.optional().or(z.literal("").transform(() => undefined)),
  notes: optionalText(500),
  reason: optionalText(500),
});
/** Receber (quitar): valor opcional (padrão = em aberto; diferente ajusta o valor do título). */
export const receiveSchema = receiveBase.extend({ amount: money("Valor inválido").optional() });
/** Receber parcialmente / com resíduo: valor obrigatório. */
export const partialReceiveSchema = receiveBase.extend({ amount: money("Informe o valor recebido") });
export const settleReceivableSchema = z.object({ receivableId: id, reason: optionalText(500) });
export const undoReceivablePaymentSchema = z.object({ receivableId: id, paymentId: optionalId, reason });
export const cancelReceivableSchema = z.object({ receivableId: id, reason });
export const receivableAttachmentSchema = z.object({ receivableId: id, name: z.string().trim().min(2, "Dê um nome ao anexo").max(160), url });

/** Primeira mensagem do zod (como nas demais actions do Financeiro). */
export function zodMessage(error: z.ZodError): string {
  return error.issues[0]?.message ?? "Dados inválidos";
}
