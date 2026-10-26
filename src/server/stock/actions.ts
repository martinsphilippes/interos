"use server";
/**
 * Server Actions do Estoque: requirePermission(chave operacao.estoque.*) → zod → serviço (service.ts) → revalidatePath.
 * As regras de saldo (nunca negativo, reservado não é usado por outro contrato) ficam no serviço, em transação.
 */
import { revalidatePath } from "next/cache";
import { z } from "zod";
import { can, failAction, requirePermission } from "@/server/auth/session";
import type { ActionResult, CurrentUser, UserRef } from "@/domain/types";
import { DEPARTMENT_KEYS } from "@/domain/constants";
import { STOCK_ORIGINS, STOCK_SERIAL_STATUSES, parseMoneyInput } from "@/domain/stock";
import {
  adjustStock,
  fillReservation,
  registerEntry,
  registerExit,
  registerReturn,
  releaseReservation,
  reserveByContractNumber,
  saveStockItem,
  saveStockSettings,
  type ContractReservationSummary,
  type EntryResult,
} from "./service";
import { listItemSerials } from "./queries";

const actorOf = (user: CurrentUser): UserRef => ({ id: user.id, name: user.name });

function fail(error: unknown, fallback: string): { ok: false; error: string } {
  return failAction(error, fallback, "estoque");
}

function revalidateStock(contractClient?: { clientId?: string; contractId?: string }) {
  revalidatePath("/estoque");
  if (contractClient?.contractId) revalidatePath(`/financeiro/contratos/${contractClient.contractId}`);
  if (contractClient?.clientId) revalidatePath(`/clientes/${contractClient.clientId}`);
}

const id = (label: string) => z.string().trim().min(1, `${label} inválido(a)`).max(160);
const qty = z.coerce.number({ message: "Quantidade inválida" }).int("Use um número inteiro").min(1, "Quantidade maior que zero").max(1_000_000, "Quantidade muito alta");
const reason = z.string().trim().min(5, "Explique o motivo (mínimo 5 caracteres)").max(500, "Motivo muito longo");
const optText = (max: number) =>
  z
    .string()
    .trim()
    .max(max, "Texto muito longo")
    .optional()
    .transform((v) => v || undefined);
const serials = z.array(z.string().trim().max(120, "Número de série muito longo")).max(500, "No máximo 500 números de série por vez").optional();
const money = z
  .union([z.number(), z.string()])
  .transform((v, ctx) => {
    const n = parseMoneyInput(v);
    if (!Number.isFinite(n) || n < 0) {
      ctx.addIssue({ code: "custom", message: "Custo unitário inválido" });
      return z.NEVER;
    }
    return Math.round(n * 100) / 100;
  });

const itemSchema = z.object({
  id: z.string().trim().max(80).optional(),
  name: z.string().trim().min(2, "Informe o nome do item").max(120, "Nome muito longo"),
  sku: optText(60),
  manufacturer: optText(80),
  model: optText(80),
  unit: optText(10),
  serialControlled: z.boolean(),
  origin: z.enum(STOCK_ORIGINS, { message: "Origem inválida" }),
  minQuantity: z.coerce.number({ message: "Estoque mínimo inválido" }).int("Estoque mínimo: número inteiro").min(0, "Estoque mínimo não pode ser negativo").max(1_000_000),
  products: z
    .array(z.object({ productId: id("Produto"), units: z.coerce.number().int("Unidades por produto: número inteiro").min(1, "Unidades por produto: mínimo 1").max(1000) }))
    .max(50, "No máximo 50 produtos por item"),
  location: optText(80),
  notes: optText(500),
  active: z.boolean(),
});

export async function saveStockItemAction(input: unknown): Promise<ActionResult<{ id: string }>> {
  try {
    const user = await requirePermission("operacao.estoque.itens.editar");
    const data = itemSchema.parse(input);
    const item = await saveStockItem({ ...data, id: data.id || undefined }, actorOf(user));
    revalidateStock();
    return { ok: true, data: { id: item.id } };
  } catch (error) {
    return fail(error, "Não foi possível salvar o item");
  }
}

export async function registerEntryAction(input: unknown): Promise<ActionResult<EntryResult>> {
  try {
    const user = await requirePermission("operacao.estoque.entrada.registrar");
    const data = z
      .object({ itemId: id("Item"), quantity: qty, unitCost: money, serials, document: optText(80), supplier: optText(120), notes: optText(500) })
      .parse(input);
    const result = await registerEntry(data, actorOf(user));
    revalidateStock();
    // O custo volta só para quem vê custos.
    return { ok: true, data: can(user, "operacao.estoque.custos.ver") ? result : { ...result, balance: { ...result.balance, avgCost: 0 } } };
  } catch (error) {
    return fail(error, "Não foi possível registrar a entrada");
  }
}

export async function registerExitAction(input: unknown): Promise<ActionResult> {
  try {
    const user = await requirePermission("operacao.estoque.saida.registrar");
    const data = z
      .object({ itemId: id("Item"), quantity: qty, reservationId: z.string().trim().max(160).optional().transform((v) => v || undefined), serials, reason: optText(500), document: optText(80) })
      .parse(input);
    await registerExit(data, actorOf(user));
    revalidateStock();
    return { ok: true, data: undefined };
  } catch (error) {
    return fail(error, "Não foi possível registrar a saída");
  }
}

export async function registerReturnAction(input: unknown): Promise<ActionResult> {
  try {
    const user = await requirePermission("operacao.estoque.saida.registrar");
    const data = z
      .object({ itemId: id("Item"), quantity: qty, reservationId: z.string().trim().max(160).optional().transform((v) => v || undefined), serials, reason })
      .parse(input);
    await registerReturn(data, actorOf(user));
    revalidateStock();
    return { ok: true, data: undefined };
  } catch (error) {
    return fail(error, "Não foi possível registrar a devolução");
  }
}

/** Séries de um item numa situação (para escolher na saída, devolução e baixa). */
export async function itemSerialsAction(input: unknown): Promise<ActionResult<string[]>> {
  try {
    await requirePermission("operacao.estoque.saida.registrar");
    const data = z.object({ itemId: id("Item"), status: z.enum(STOCK_SERIAL_STATUSES), reservationId: z.string().trim().max(160).optional() }).parse(input);
    return { ok: true, data: await listItemSerials(data.itemId, data.status, data.reservationId || undefined) };
  } catch (error) {
    return fail(error, "Não foi possível carregar os números de série");
  }
}

export async function adjustStockAction(input: unknown): Promise<ActionResult> {
  try {
    const user = await requirePermission("operacao.estoque.ajustar");
    const data = z
      .object({
        itemId: id("Item"),
        delta: z.coerce
          .number({ message: "Quantidade inválida" })
          .int("Use um número inteiro")
          .min(-1_000_000)
          .max(1_000_000)
          .refine((n) => n !== 0, "Informe quantas unidades entram (+) ou saem (−)"),
        reason,
        serials,
      })
      .parse(input);
    await adjustStock(data, actorOf(user));
    revalidateStock();
    return { ok: true, data: undefined };
  } catch (error) {
    return fail(error, "Não foi possível ajustar o estoque");
  }
}

export async function fillReservationAction(input: unknown): Promise<ActionResult<{ added: number }>> {
  try {
    const user = await requirePermission("operacao.estoque.reservas.gerenciar");
    const data = z.object({ reservationId: id("Reserva") }).parse(input);
    const added = await fillReservation(data.reservationId, actorOf(user));
    revalidateStock();
    return { ok: true, data: { added } };
  } catch (error) {
    return fail(error, "Não foi possível separar a reserva");
  }
}

export async function reserveContractAction(input: unknown): Promise<ActionResult<ContractReservationSummary>> {
  try {
    const user = await requirePermission("operacao.estoque.reservas.gerenciar");
    const data = z.object({ contractNumber: z.string().trim().min(3, "Informe o número do contrato").max(40) }).parse(input);
    const summary = await reserveByContractNumber(data.contractNumber, actorOf(user));
    revalidateStock({ contractId: summary.contractId });
    return { ok: true, data: summary };
  } catch (error) {
    return fail(error, "Não foi possível reservar pelo contrato");
  }
}

export async function releaseReservationAction(input: unknown): Promise<ActionResult> {
  try {
    const user = await requirePermission("operacao.estoque.reservas.gerenciar");
    const data = z.object({ reservationId: id("Reserva"), reason }).parse(input);
    await releaseReservation(data.reservationId, data.reason, actorOf(user));
    revalidateStock();
    return { ok: true, data: undefined };
  } catch (error) {
    return fail(error, "Não foi possível liberar a reserva");
  }
}

export async function saveStockSettingsAction(input: unknown): Promise<ActionResult> {
  try {
    const user = await requirePermission("operacao.estoque.configuracao.editar");
    const data = z
      .object({ responsibleDepartment: z.enum(DEPARTMENT_KEYS, { message: "Departamento inválido" }), reserveOnSign: z.boolean(), notifyLowStock: z.boolean() })
      .parse(input);
    await saveStockSettings(data, actorOf(user));
    revalidateStock();
    return { ok: true, data: undefined };
  } catch (error) {
    return fail(error, "Não foi possível salvar a configuração do estoque");
  }
}
