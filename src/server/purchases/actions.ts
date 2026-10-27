"use server";
/**
 * Server Actions de Compras: requirePermission(chave operacao.compras.*) → zod → serviço (service.ts) → revalidatePath.
 */
import { revalidatePath } from "next/cache";
import { z } from "zod";
import { can, failAction, requirePermission } from "@/server/auth/session";
import type { ActionResult, CurrentUser, UserRef } from "@/domain/types";
import type { PurchaseStatus } from "@/domain/purchases";
import { parseMoneyInput } from "@/domain/stock";
import {
  approvePurchaseOrder,
  cancelPurchaseOrder,
  createPurchaseOrder,
  receivePurchaseOrder,
  rejectPurchaseOrder,
  retryReceiptPayable,
  savePurchaseSettings,
  submitPurchaseOrder,
  updatePurchaseOrder,
  type ReceiveResult,
} from "./service";

const actorOf = (user: CurrentUser): UserRef => ({ id: user.id, name: user.name });
const fail = (error: unknown, fallback: string) => failAction(error, fallback, "compras");

function revalidatePurchases() {
  revalidatePath("/compras");
  revalidatePath("/estoque");
  revalidatePath("/financeiro/contas-a-pagar");
}

const id = (label: string) => z.string().trim().min(1, `${label} inválido(a)`).max(160);
const reason = z.string().trim().min(5, "Explique o motivo (mínimo 5 caracteres)").max(500, "Motivo muito longo");
const money = (label: string) =>
  z.union([z.number(), z.string()]).transform((v, ctx) => {
    const n = parseMoneyInput(v);
    if (!Number.isFinite(n) || n < 0) {
      ctx.addIssue({ code: "custom", message: `${label} inválido` });
      return z.NEVER;
    }
    return Math.round(n * 100) / 100;
  });
const optDate = z
  .string()
  .trim()
  .optional()
  .transform((v) => v || undefined)
  .refine((v) => !v || /^\d{4}-\d{2}-\d{2}$/.test(v), "Data inválida");

const orderSchema = z.object({
  supplierId: z
    .string()
    .trim()
    .max(80)
    .optional()
    .transform((v) => v || undefined),
  supplierName: z.string().trim().max(120, "Nome muito longo").optional(),
  lines: z
    .array(z.object({ itemId: id("Item"), quantity: z.coerce.number({ message: "Quantidade inválida" }).int("Quantidade: número inteiro").min(1, "Quantidade maior que zero").max(1_000_000), unitCost: money("Custo unitário") }))
    .min(1, "Inclua ao menos um item")
    .max(100, "No máximo 100 itens por pedido"),
  expectedAt: optDate,
  paymentDays: z.coerce.number({ message: "Prazo inválido" }).int().min(0, "Prazo: de 0 a 365 dias").max(365, "Prazo: de 0 a 365 dias"),
  installments: z.coerce.number({ message: "Parcelas inválidas" }).int().min(1, "Parcelas: de 1 a 24").max(24, "Parcelas: de 1 a 24"),
  notes: z.string().trim().max(1000, "Observação muito longa").optional(),
});

export async function createPurchaseOrderAction(input: unknown): Promise<ActionResult<{ id: string; number: string }>> {
  try {
    const user = await requirePermission("operacao.compras.pedidos.editar");
    const order = await createPurchaseOrder(orderSchema.parse(input), actorOf(user));
    revalidatePurchases();
    return { ok: true, data: { id: order.id, number: order.number } };
  } catch (error) {
    return fail(error, "Não foi possível criar o pedido");
  }
}

export async function updatePurchaseOrderAction(input: unknown): Promise<ActionResult> {
  try {
    const user = await requirePermission("operacao.compras.pedidos.editar");
    const data = orderSchema.extend({ orderId: id("Pedido") }).parse(input);
    const { orderId, ...rest } = data;
    await updatePurchaseOrder(orderId, rest, actorOf(user));
    revalidatePurchases();
    return { ok: true, data: undefined };
  } catch (error) {
    return fail(error, "Não foi possível salvar o pedido");
  }
}

export async function submitPurchaseOrderAction(input: unknown): Promise<ActionResult<{ status: PurchaseStatus }>> {
  try {
    const user = await requirePermission("operacao.compras.pedidos.editar");
    const { orderId } = z.object({ orderId: id("Pedido") }).parse(input);
    const status = await submitPurchaseOrder(orderId, actorOf(user));
    revalidatePurchases();
    return { ok: true, data: { status } };
  } catch (error) {
    return fail(error, "Não foi possível enviar o pedido");
  }
}

export async function cancelPurchaseOrderAction(input: unknown): Promise<ActionResult> {
  try {
    const user = await requirePermission("operacao.compras.pedidos.editar");
    const data = z.object({ orderId: id("Pedido"), reason }).parse(input);
    await cancelPurchaseOrder(data.orderId, data.reason, actorOf(user));
    revalidatePurchases();
    return { ok: true, data: undefined };
  } catch (error) {
    return fail(error, "Não foi possível cancelar o pedido");
  }
}

export async function approvePurchaseOrderAction(input: unknown): Promise<ActionResult> {
  try {
    const user = await requirePermission("operacao.compras.aprovar");
    const { orderId } = z.object({ orderId: id("Pedido") }).parse(input);
    await approvePurchaseOrder(orderId, actorOf(user));
    revalidatePurchases();
    return { ok: true, data: undefined };
  } catch (error) {
    return fail(error, "Não foi possível aprovar o pedido");
  }
}

export async function rejectPurchaseOrderAction(input: unknown): Promise<ActionResult> {
  try {
    const user = await requirePermission("operacao.compras.aprovar");
    const data = z.object({ orderId: id("Pedido"), reason }).parse(input);
    await rejectPurchaseOrder(data.orderId, data.reason, actorOf(user));
    revalidatePurchases();
    return { ok: true, data: undefined };
  } catch (error) {
    return fail(error, "Não foi possível devolver o pedido");
  }
}

export async function receivePurchaseOrderAction(input: unknown): Promise<ActionResult<ReceiveResult>> {
  try {
    const user = await requirePermission("operacao.compras.receber");
    const data = z
      .object({
        orderId: id("Pedido"),
        receivedAt: optDate,
        document: z.string().trim().max(80, "Documento muito longo").optional(),
        lines: z
          .array(
            z.object({
              itemId: id("Item"),
              quantity: z.coerce.number({ message: "Quantidade inválida" }).int("Quantidade: número inteiro").min(0).max(1_000_000),
              unitCost: money("Custo unitário").optional(),
              serials: z.array(z.string().trim().max(120)).max(500).optional(),
            }),
          )
          .min(1)
          .max(100),
      })
      .parse(input);
    const { orderId, ...rest } = data;
    // Custo acima do aprovado no pedido só por quem aprova compras.
    const result = await receivePurchaseOrder(orderId, rest, actorOf(user), { canRaiseCost: can(user, "operacao.compras.aprovar") });
    revalidatePurchases();
    return { ok: true, data: result };
  } catch (error) {
    return fail(error, "Não foi possível registrar o recebimento");
  }
}

export async function savePurchaseSettingsAction(input: unknown): Promise<ActionResult> {
  try {
    const user = await requirePermission("operacao.compras.configuracao.editar");
    const data = z
      .object({
        approvalEnabled: z.boolean(),
        approvalThreshold: money("Valor de aprovação"),
        payableCategory: z.string().trim().min(1, "Escolha a categoria").max(60),
        paymentDays: z.coerce.number({ message: "Prazo inválido" }).int().min(0, "Prazo: de 0 a 365 dias").max(365, "Prazo: de 0 a 365 dias"),
      })
      .parse(input);
    await savePurchaseSettings(data, actorOf(user));
    revalidatePurchases();
    return { ok: true, data: undefined };
  } catch (error) {
    return fail(error, "Não foi possível salvar a configuração de compras");
  }
}

export async function retryReceiptPayableAction(input: unknown): Promise<ActionResult<{ payableCode: string }>> {
  try {
    const user = await requirePermission("operacao.compras.receber");
    const { receiptId } = z.object({ receiptId: id("Recebimento") }).parse(input);
    const payableCode = await retryReceiptPayable(receiptId, actorOf(user));
    revalidatePurchases();
    return { ok: true, data: { payableCode } };
  } catch (error) {
    return fail(error, "Não foi possível criar o título");
  }
}
