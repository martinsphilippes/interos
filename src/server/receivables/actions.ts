"use server";
/**
 * Server Actions dos títulos a receber AVULSOS (etapa CP/CR 3). Padrão (A5): requirePermission("<chave do catálogo>",
 * src/domain/permissions/financeiro.ts › financeiro.contas-a-receber.avulsos.*) → validação zod → escopo do registro
 * (./access.ts) → serviço (regras, eventos com auditoria) → revalidatePath → ActionResult. Recebimento exige a conta
 * financeira (vira o lançamento de receita na mesma transação).
 */
import { revalidatePath } from "next/cache";
import { z } from "zod";
import { failAction, requirePermission } from "@/server/auth/session";
import type { ActionResult, CurrentUser, UserRef } from "@/domain/types";
import { requireManualPaymentAccount } from "@/server/finance-registry/cash-entries";
import { assertCanCreateReceivable, assertReceivableAccess } from "./access";
import { cancelReceivableSchema, partialReceiveSchema, receivableAttachmentSchema, receivableCreateSchema, receivableUpdateSchema, receiveSchema, settleReceivableSchema, undoReceivablePaymentSchema, zodMessage } from "./schemas";
import { addReceivableAttachment, cancelReceivable, cancelReceivableSeries, createReceivables, receiveReceivable, settleReceivableByPaid, undoReceivablePayment, updateReceivable, updateReceivableSeries } from "./service";

type Failure = { ok: false; error: string };

function fail(error: unknown, fallback: string): Failure {
  if (error instanceof z.ZodError) return { ok: false, error: zodMessage(error) };
  return failAction(error, fallback, "contas-a-receber");
}

const actorOf = (user: CurrentUser): UserRef => ({ id: user.id, name: user.name });

/** Edição/cancelamento em série (etapa CP/CR 5) exige também a chave do título. */
const SERIES_EDIT_DENIED = "Seu perfil não altera este título";
/** Edição/cancelamento em série (etapa CP/CR 5) exige também a chave do título. */
const SERIES_CANCEL_DENIED = "Seu perfil não cancela este título";

function revalidateReceivables() {
  revalidatePath("/financeiro/contas-a-receber");
  revalidatePath("/financeiro/cadastros");
}

export async function createReceivableAction(input: unknown): Promise<ActionResult<{ id: string; code?: string; parcels: number }>> {
  try {
    const user = await requirePermission("financeiro.contas-a-receber.avulsos.criar");
    const data = receivableCreateSchema.parse(input);
    await assertCanCreateReceivable(user);
    const created = await createReceivables(data, actorOf(user));
    revalidateReceivables();
    return { ok: true, data: { id: created[0].id, code: created[0].code, parcels: created.length } };
  } catch (error) {
    return fail(error, "Não foi possível lançar o título a receber");
  }
}

export async function updateReceivableAction(input: unknown): Promise<ActionResult<undefined>> {
  try {
    const user = await requirePermission("financeiro.contas-a-receber.avulsos.editar");
    const data = receivableUpdateSchema.parse(input);
    await assertReceivableAccess(user, data.receivableId);
    const { receivableId, ...rest } = data;
    await updateReceivable(receivableId, rest, actorOf(user));
    revalidateReceivables();
    return { ok: true, data: undefined };
  } catch (error) {
    return fail(error, "Não foi possível alterar o título a receber");
  }
}

/** "Salvar este + N futuros" (etapa CP/CR 5): exige "Editar título a receber avulso" E "Editar em série". */
export async function updateReceivableSeriesAction(input: unknown): Promise<ActionResult<{ updated: number; skipped: { code: string; reason: string }[] }>> {
  try {
    const user = await requirePermission("financeiro.contas-a-receber.avulsos.editar-serie");
    await requirePermission("financeiro.contas-a-receber.avulsos.editar", SERIES_EDIT_DENIED);
    const data = receivableUpdateSchema.parse(input);
    await assertReceivableAccess(user, data.receivableId);
    const { receivableId, ...rest } = data;
    const r = await updateReceivableSeries(receivableId, rest, actorOf(user));
    revalidateReceivables();
    return { ok: true, data: { updated: r.updated, skipped: r.skipped.map((s) => ({ code: s.code, reason: s.reason })) } };
  } catch (error) {
    return fail(error, "Não foi possível alterar os títulos a receber em série");
  }
}

/** "Cancelar este + N futuros" (etapa CP/CR 5): exige "Cancelar título a receber avulso" E "Cancelar em série". */
export async function cancelReceivableSeriesAction(input: unknown): Promise<ActionResult<{ cancelled: number; skipped: { code: string; reason: string }[] }>> {
  try {
    const user = await requirePermission("financeiro.contas-a-receber.avulsos.cancelar-serie");
    await requirePermission("financeiro.contas-a-receber.avulsos.cancelar", SERIES_CANCEL_DENIED);
    const data = cancelReceivableSchema.parse(input);
    await assertReceivableAccess(user, data.receivableId);
    const r = await cancelReceivableSeries(data.receivableId, data.reason, actorOf(user));
    revalidateReceivables();
    return { ok: true, data: { cancelled: r.updated, skipped: r.skipped.map((s) => ({ code: s.code, reason: s.reason })) } };
  } catch (error) {
    return fail(error, "Não foi possível cancelar os títulos a receber em série");
  }
}

export async function addReceivableAttachmentAction(input: unknown): Promise<ActionResult<{ id: string }>> {
  try {
    const user = await requirePermission("financeiro.contas-a-receber.avulsos.editar");
    const data = receivableAttachmentSchema.parse(input);
    await assertReceivableAccess(user, data.receivableId);
    const doc = await addReceivableAttachment(data.receivableId, { name: data.name, url: data.url }, actorOf(user));
    revalidateReceivables();
    return { ok: true, data: { id: doc.id } };
  } catch (error) {
    return fail(error, "Não foi possível anexar o documento");
  }
}

/** Receber (quitar): valor padrão = em aberto; valor diferente ajusta o valor do título (desconto/juros). */
export async function receiveReceivableAction(input: unknown): Promise<ActionResult<{ settled: boolean }>> {
  try {
    const user = await requirePermission("financeiro.contas-a-receber.avulsos.receber");
    const data = receiveSchema.parse(input);
    await assertReceivableAccess(user, data.receivableId);
    const accountId = await requireManualPaymentAccount(data.accountId);
    const r = await receiveReceivable("total", data.receivableId, { paidAt: data.paidAt, method: data.method, accountId, amount: data.amount, receiptUrl: data.receiptUrl, notes: data.notes, reason: data.reason }, actorOf(user));
    revalidateReceivables();
    return { ok: true, data: { settled: r.settled } };
  } catch (error) {
    return fail(error, "Não foi possível registrar o recebimento");
  }
}

/** Receber parcialmente: mantém o valor; quita sozinho quando cobre o restante. */
export async function partialReceiveReceivableAction(input: unknown): Promise<ActionResult<{ settled: boolean }>> {
  try {
    const user = await requirePermission("financeiro.contas-a-receber.avulsos.receber");
    const data = partialReceiveSchema.parse(input);
    await assertReceivableAccess(user, data.receivableId);
    const accountId = await requireManualPaymentAccount(data.accountId);
    const r = await receiveReceivable("parcial", data.receivableId, { paidAt: data.paidAt, method: data.method, accountId, amount: data.amount, receiptUrl: data.receiptUrl, notes: data.notes, reason: data.reason }, actorOf(user));
    revalidateReceivables();
    return { ok: true, data: { settled: r.settled } };
  } catch (error) {
    return fail(error, "Não foi possível registrar o recebimento parcial");
  }
}

/** Receber com resíduo: original quitado pelo total recebido + título "— Resíduo" com o restante. */
export async function receiveWithResidualAction(input: unknown): Promise<ActionResult<{ residualId: string; residualCode?: string }>> {
  try {
    const user = await requirePermission("financeiro.contas-a-receber.avulsos.receber");
    const data = partialReceiveSchema.parse(input);
    await assertReceivableAccess(user, data.receivableId);
    const accountId = await requireManualPaymentAccount(data.accountId);
    const r = await receiveReceivable("residuo", data.receivableId, { paidAt: data.paidAt, method: data.method, accountId, amount: data.amount, receiptUrl: data.receiptUrl, notes: data.notes, reason: data.reason }, actorOf(user));
    revalidateReceivables();
    return { ok: true, data: { residualId: r.residual?.id ?? "", residualCode: r.residual?.code } };
  } catch (error) {
    return fail(error, "Não foi possível registrar o recebimento com resíduo");
  }
}

/** Quitar pelo já recebido: valor := já recebido, sem nova baixa nem lançamento. */
export async function settleReceivableByPaidAction(input: unknown): Promise<ActionResult<{ amount: number }>> {
  try {
    const user = await requirePermission("financeiro.contas-a-receber.avulsos.receber");
    const data = settleReceivableSchema.parse(input);
    await assertReceivableAccess(user, data.receivableId);
    const r = await settleReceivableByPaid(data.receivableId, { reason: data.reason }, actorOf(user));
    revalidateReceivables();
    return { ok: true, data: { amount: r.amount } };
  } catch (error) {
    return fail(error, "Não foi possível quitar pelo já recebido");
  }
}

/** Desfazer UM recebimento (o lançamento de caixa é apagado junto). */
export async function undoReceivablePaymentAction(input: unknown): Promise<ActionResult<{ cashEntryRemoved: boolean }>> {
  try {
    const user = await requirePermission("financeiro.contas-a-receber.avulsos.desfazer-recebimento");
    const data = undoReceivablePaymentSchema.parse(input);
    await assertReceivableAccess(user, data.receivableId);
    const r = await undoReceivablePayment(data.receivableId, { reason: data.reason, paymentId: data.paymentId }, actorOf(user));
    revalidateReceivables();
    return { ok: true, data: { cashEntryRemoved: Boolean(r.cashEntryId) } };
  } catch (error) {
    return fail(error, "Não foi possível desfazer o recebimento");
  }
}

/** Cancelar (em vez de excluir): título aberto sem recebimento; motivo obrigatório. */
export async function cancelReceivableAction(input: unknown): Promise<ActionResult<undefined>> {
  try {
    const user = await requirePermission("financeiro.contas-a-receber.avulsos.cancelar");
    const data = cancelReceivableSchema.parse(input);
    await assertReceivableAccess(user, data.receivableId);
    await cancelReceivable(data.receivableId, data.reason, actorOf(user));
    revalidateReceivables();
    return { ok: true, data: undefined };
  } catch (error) {
    return fail(error, "Não foi possível cancelar o título a receber");
  }
}
