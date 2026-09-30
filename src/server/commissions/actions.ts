"use server";
/**
 * Server Actions de Comissões e Contas a Pagar. Padrão: requireUser → permissão (predicados de permissions.ts,
 * sempre no servidor) → zod → serviço (regras, eventos com auditoria) → revalidatePath → ActionResult.
 */
import { revalidatePath } from "next/cache";
import { z } from "zod";
import { requireUser } from "@/server/auth/session";
import type { ActionResult, CurrentUser, UserRef } from "@/domain/types";
import { approvePayable, cancelPayable, createManualPayable, payPayable, schedulePayable, updatePayable } from "./payables";
import { canApprovePayables, canManageCommissionRules, canOperatePayables, canPayPayables, canReverseCommission } from "./permissions";
import {
  cancelPayableSchema,
  commissionIdSchema,
  commissionReasonSchema,
  manualPayableSchema,
  payableIdSchema,
  payPayableSchema,
  paymentDaySchema,
  ruleActiveSchema,
  ruleInputSchema,
  schedulePayableSchema,
  updatePayableSchema,
  zodMessage,
} from "./schemas";
import { blockCommission, regenerateCommissionPayable, reverseCommission, saveCommissionPaymentDay, saveCommissionRule, setCommissionRuleActive, unblockCommission } from "./service";

type Failure = { ok: false; error: string };

class PermissionError extends Error {}

function fail(error: unknown, fallback: string): Failure {
  if (error instanceof z.ZodError) return { ok: false, error: zodMessage(error) };
  if (error instanceof PermissionError) return { ok: false, error: error.message };
  if (error instanceof Error && error.message && !/firestore|firebase|ECONN|deadline|undefined|null/i.test(error.message)) return { ok: false, error: error.message };
  console.error(`[comissoes] ${fallback}`, error);
  return { ok: false, error: fallback };
}

const actorOf = (user: CurrentUser): UserRef => ({ id: user.id, name: user.name });

async function requireWith(check: (u: CurrentUser) => boolean, message: string): Promise<CurrentUser> {
  const user = await requireUser();
  if (!check(user)) throw new PermissionError(message);
  return user;
}

function revalidateCommissions() {
  revalidatePath("/financeiro", "layout");
  revalidatePath("/vendas", "layout");
  revalidatePath("/performance", "layout");
  revalidatePath("/meu-dia");
}

// ---------------------------------------------------------------------------
// Regras
// ---------------------------------------------------------------------------

const RULES_DENIED = "Somente admin, diretoria ou gestor do Financeiro configuram regras de comissão";

export async function saveCommissionRuleAction(input: unknown): Promise<ActionResult<{ id: string; created: boolean }>> {
  try {
    const user = await requireWith(canManageCommissionRules, RULES_DENIED);
    const data = ruleInputSchema.parse(input);
    const { rule, created } = await saveCommissionRule(data, actorOf(user));
    revalidateCommissions();
    return { ok: true, data: { id: rule.id, created } };
  } catch (error) {
    return fail(error, "Não foi possível salvar a regra");
  }
}

export async function setCommissionRuleActiveAction(input: unknown): Promise<ActionResult<{ active: boolean }>> {
  try {
    const user = await requireWith(canManageCommissionRules, RULES_DENIED);
    const data = ruleActiveSchema.parse(input);
    const rule = await setCommissionRuleActive(data.id, data.active, data.reason, actorOf(user));
    revalidateCommissions();
    return { ok: true, data: { active: rule.active } };
  } catch (error) {
    return fail(error, "Não foi possível alterar a regra");
  }
}

export async function saveCommissionPaymentDayAction(input: unknown): Promise<ActionResult<{ diaPagamento: number }>> {
  try {
    const user = await requireWith(canManageCommissionRules, RULES_DENIED);
    const data = paymentDaySchema.parse(input);
    await saveCommissionPaymentDay(data.diaPagamento, actorOf(user));
    revalidateCommissions();
    return { ok: true, data };
  } catch (error) {
    return fail(error, "Não foi possível salvar o dia de pagamento");
  }
}

// ---------------------------------------------------------------------------
// Comissão (estorno, bloqueio, novo título)
// ---------------------------------------------------------------------------

const REVERSE_DENIED = "Somente admin, diretoria ou gestor do Financeiro estornam, bloqueiam ou regeram títulos de comissão";

export async function reverseCommissionAction(input: unknown): Promise<ActionResult<{ status: string }>> {
  try {
    const user = await requireWith(canReverseCommission, REVERSE_DENIED);
    const data = commissionReasonSchema.parse(input);
    const r = await reverseCommission(data.commissionId, data.reason, actorOf(user));
    revalidateCommissions();
    return { ok: true, data: { status: r.status } };
  } catch (error) {
    return fail(error, "Não foi possível estornar a comissão");
  }
}

export async function blockCommissionAction(input: unknown): Promise<ActionResult<undefined>> {
  try {
    const user = await requireWith(canReverseCommission, REVERSE_DENIED);
    const data = commissionReasonSchema.parse(input);
    await blockCommission(data.commissionId, data.reason, actorOf(user));
    revalidateCommissions();
    return { ok: true, data: undefined };
  } catch (error) {
    return fail(error, "Não foi possível bloquear a comissão");
  }
}

export async function unblockCommissionAction(input: unknown): Promise<ActionResult<undefined>> {
  try {
    const user = await requireWith(canReverseCommission, REVERSE_DENIED);
    const data = commissionReasonSchema.parse(input);
    await unblockCommission(data.commissionId, data.reason, actorOf(user));
    revalidateCommissions();
    return { ok: true, data: undefined };
  } catch (error) {
    return fail(error, "Não foi possível desbloquear a comissão");
  }
}

export async function regenerateCommissionPayableAction(input: unknown): Promise<ActionResult<{ payableId: string; code?: string }>> {
  try {
    const user = await requireWith(canReverseCommission, REVERSE_DENIED);
    const data = commissionIdSchema.parse(input);
    const payable = await regenerateCommissionPayable(data.commissionId, actorOf(user));
    revalidateCommissions();
    return { ok: true, data: { payableId: payable.id, code: payable.code } };
  } catch (error) {
    return fail(error, "Não foi possível gerar o título");
  }
}

// ---------------------------------------------------------------------------
// Contas a pagar
// ---------------------------------------------------------------------------

export async function approvePayableAction(input: unknown): Promise<ActionResult<undefined>> {
  try {
    const user = await requireWith(canApprovePayables, "Somente admin, diretoria ou gestor do Financeiro aprovam títulos");
    const data = payableIdSchema.parse(input);
    await approvePayable(data.payableId, actorOf(user), data.note);
    revalidateCommissions();
    return { ok: true, data: undefined };
  } catch (error) {
    return fail(error, "Não foi possível aprovar o título");
  }
}

export async function schedulePayableAction(input: unknown): Promise<ActionResult<undefined>> {
  try {
    const user = await requireWith(canOperatePayables, "Somente a equipe financeira programa pagamentos");
    const data = schedulePayableSchema.parse(input);
    await schedulePayable(data.payableId, { dueDate: data.dueDate, note: data.note }, actorOf(user));
    revalidateCommissions();
    return { ok: true, data: undefined };
  } catch (error) {
    return fail(error, "Não foi possível programar o título");
  }
}

export async function payPayableAction(input: unknown): Promise<ActionResult<{ commissions: number }>> {
  try {
    const user = await requireWith(canPayPayables, "Somente admin, diretoria ou gestor do Financeiro registram pagamentos de títulos");
    const data = payPayableSchema.parse(input);
    const r = await payPayable(data.payableId, { paidAt: data.paidAt, paymentMethod: data.paymentMethod, receiptUrl: data.receiptUrl, notes: data.notes }, actorOf(user));
    revalidateCommissions();
    return { ok: true, data: { commissions: r.commissionIds.length } };
  } catch (error) {
    return fail(error, "Não foi possível registrar o pagamento");
  }
}

export async function cancelPayableAction(input: unknown): Promise<ActionResult<{ commissions: number }>> {
  try {
    const user = await requireWith(canOperatePayables, "Somente a equipe financeira cancela títulos");
    const data = cancelPayableSchema.parse(input);
    const r = await cancelPayable(data.payableId, data.reason, actorOf(user));
    revalidateCommissions();
    return { ok: true, data: { commissions: r.commissionIds.length } };
  } catch (error) {
    return fail(error, "Não foi possível cancelar o título");
  }
}

export async function updatePayableAction(input: unknown): Promise<ActionResult<undefined>> {
  try {
    const user = await requireWith(canOperatePayables, "Somente a equipe financeira altera títulos");
    const data = updatePayableSchema.parse(input);
    await updatePayable(data.payableId, data, actorOf(user));
    revalidateCommissions();
    return { ok: true, data: undefined };
  } catch (error) {
    return fail(error, "Não foi possível alterar o título");
  }
}

export async function createManualPayableAction(input: unknown): Promise<ActionResult<{ id: string; code?: string }>> {
  try {
    const user = await requireWith(canOperatePayables, "Somente a equipe financeira lança títulos");
    const data = manualPayableSchema.parse(input);
    const p = await createManualPayable(data, actorOf(user));
    revalidateCommissions();
    return { ok: true, data: { id: p.id, code: p.code } };
  } catch (error) {
    return fail(error, "Não foi possível lançar o título");
  }
}
