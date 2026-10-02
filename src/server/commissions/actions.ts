"use server";
/**
 * Server Actions de Comissões e Contas a Pagar. Padrão (A5): requirePermission("<chave do catálogo>",
 * src/domain/permissions/financeiro.ts) → validação zod → chave extra quando a condição do argumento pede (exceção por
 * contrato, título de comissão) → escopo do registro (./access.ts: fora do escopo = PermissionError; inexistente =
 * BusinessError) → serviço (regras, eventos com auditoria) → revalidatePath → ActionResult. Falhas pelo tratamento
 * único (failAction, que relança redirect/notFound).
 */
import { revalidatePath } from "next/cache";
import { z } from "zod";
import { PermissionError, can, failAction, requirePermission } from "@/server/auth/session";
import { getById } from "@/server/db";
import { COLLECTIONS, type ActionResult, type CommissionRule, type CurrentUser, type UserRef } from "@/domain/types";
import { addPayableAttachment, approvePayable, cancelPayable, cancelPayableSeries, createManualPayable, partialPayPayable, payPayable, payPayableWithResidual, schedulePayable, settlePayableByPaid, undoPayablePayment, updatePayable, updatePayableSeries } from "./payables";
import { requireManualPaymentAccount } from "@/server/finance-registry/cash-entries";
import { getSupplier, saveSupplier, setSupplierActive } from "./suppliers";
import { assertCommissionAccess, assertCreditorInScope, assertPayableAccess, isCommissionPayable, payableAllowed, payableVisibility } from "./access";
import { ruleScope } from "./rules";
import {
  cancelPayableSchema,
  commissionIdSchema,
  commissionReasonSchema,
  manualPayableSchema,
  payableAttachmentSchema,
  payableIdSchema,
  supplierActiveSchema,
  supplierSchema,
  partialPayPayableSchema,
  payPayableSchema,
  paymentDaySchema,
  settlePayableByPaidSchema,
  ruleActiveSchema,
  ruleInputSchema,
  schedulePayableSchema,
  undoPayablePaymentSchema,
  updatePayableSchema,
  zodMessage,
} from "./schemas";
import { blockCommission, regenerateCommissionPayable, reverseCommission, saveCommissionPaymentDay, saveCommissionRule, setCommissionRuleActive, unblockCommission } from "./service";

type Failure = { ok: false; error: string };

/** Validação: a primeira mensagem do zod (como antes); o resto pelo tratamento único (failAction). */
function fail(error: unknown, fallback: string): Failure {
  if (error instanceof z.ZodError) return { ok: false, error: zodMessage(error) };
  return failAction(error, fallback, "comissoes");
}

const actorOf = (user: CurrentUser): UserRef => ({ id: user.id, name: user.name });

/** Edição/cancelamento em série (etapa CP/CR 5) exige também a chave do título. */
const SERIES_EDIT_DENIED = "Seu perfil não altera este título";
/** Edição/cancelamento em série (etapa CP/CR 5) exige também a chave do título. */
const SERIES_CANCEL_DENIED = "Seu perfil não cancela este título";

function revalidateCommissions() {
  revalidatePath("/financeiro", "layout");
  revalidatePath("/vendas", "layout");
  revalidatePath("/performance", "layout");
  revalidatePath("/meu-dia");
}

/** Id presente no argumento bruto (decide entre as chaves de criar e editar antes da validação). */
function rawId(input: unknown): boolean {
  const id = input && typeof input === "object" ? (input as { id?: unknown }).id : undefined;
  return typeof id === "string" && id.trim().length > 0;
}

// ---------------------------------------------------------------------------
// Regras
// ---------------------------------------------------------------------------

const EXCEPTION_DENIED = "Seu perfil não cria nem altera exceções de comissão por contrato";

export async function saveCommissionRuleAction(input: unknown): Promise<ActionResult<{ id: string; created: boolean }>> {
  try {
    const user = await requirePermission("financeiro.comissoes.regras.editar");
    const data = ruleInputSchema.parse(input);
    const existing = data.id ? await getById<CommissionRule>(COLLECTIONS.commissionRules, data.id) : null;
    // Exceção por contrato (nova ou existente) exige também "Criar exceção".
    if (data.scope === "contrato" || (existing && ruleScope(existing) === "contrato")) await requirePermission("financeiro.comissoes.regras.criar-excecao", EXCEPTION_DENIED);
    // Ativar/desativar pela edição exige a permissão própria.
    if (existing && existing.active !== data.active && !can(user, "financeiro.comissoes.regras.ativar")) throw new PermissionError("Seu perfil não ativa nem desativa regras de comissão");
    const { rule, created } = await saveCommissionRule(data, actorOf(user));
    revalidateCommissions();
    return { ok: true, data: { id: rule.id, created } };
  } catch (error) {
    return fail(error, "Não foi possível salvar a regra");
  }
}

export async function setCommissionRuleActiveAction(input: unknown): Promise<ActionResult<{ active: boolean }>> {
  try {
    const user = await requirePermission("financeiro.comissoes.regras.ativar");
    const data = ruleActiveSchema.parse(input);
    const existing = await getById<CommissionRule>(COLLECTIONS.commissionRules, data.id);
    if (existing && ruleScope(existing) === "contrato") await requirePermission("financeiro.comissoes.regras.criar-excecao", EXCEPTION_DENIED);
    const rule = await setCommissionRuleActive(data.id, data.active, data.reason, actorOf(user));
    revalidateCommissions();
    return { ok: true, data: { active: rule.active } };
  } catch (error) {
    return fail(error, "Não foi possível alterar a regra");
  }
}

export async function saveCommissionPaymentDayAction(input: unknown): Promise<ActionResult<{ diaPagamento: number }>> {
  try {
    const user = await requirePermission("financeiro.comissoes.regras.configurar");
    const data = paymentDaySchema.parse(input);
    await saveCommissionPaymentDay(data.diaPagamento, actorOf(user));
    revalidateCommissions();
    return { ok: true, data };
  } catch (error) {
    return fail(error, "Não foi possível salvar o dia de pagamento");
  }
}

// ---------------------------------------------------------------------------
// Comissão (estorno, bloqueio, novo título) — sempre sobre comissão visível ao usuário
// ---------------------------------------------------------------------------

export async function reverseCommissionAction(input: unknown): Promise<ActionResult<{ status: string }>> {
  try {
    const user = await requirePermission("financeiro.comissoes.estornar");
    const data = commissionReasonSchema.parse(input);
    await assertCommissionAccess(user, data.commissionId);
    const r = await reverseCommission(data.commissionId, data.reason, actorOf(user));
    revalidateCommissions();
    return { ok: true, data: { status: r.status } };
  } catch (error) {
    return fail(error, "Não foi possível estornar a comissão");
  }
}

export async function blockCommissionAction(input: unknown): Promise<ActionResult<undefined>> {
  try {
    const user = await requirePermission("financeiro.comissoes.bloquear");
    const data = commissionReasonSchema.parse(input);
    await assertCommissionAccess(user, data.commissionId);
    await blockCommission(data.commissionId, data.reason, actorOf(user));
    revalidateCommissions();
    return { ok: true, data: undefined };
  } catch (error) {
    return fail(error, "Não foi possível bloquear a comissão");
  }
}

export async function unblockCommissionAction(input: unknown): Promise<ActionResult<undefined>> {
  try {
    const user = await requirePermission("financeiro.comissoes.desbloquear");
    const data = commissionReasonSchema.parse(input);
    await assertCommissionAccess(user, data.commissionId);
    await unblockCommission(data.commissionId, data.reason, actorOf(user));
    revalidateCommissions();
    return { ok: true, data: undefined };
  } catch (error) {
    return fail(error, "Não foi possível desbloquear a comissão");
  }
}

export async function regenerateCommissionPayableAction(input: unknown): Promise<ActionResult<{ payableId: string; code?: string }>> {
  try {
    const user = await requirePermission("financeiro.comissoes.gerar-titulo");
    const data = commissionIdSchema.parse(input);
    await assertCommissionAccess(user, data.commissionId);
    const payable = await regenerateCommissionPayable(data.commissionId, actorOf(user));
    revalidateCommissions();
    return { ok: true, data: { payableId: payable.id, code: payable.code } };
  } catch (error) {
    return fail(error, "Não foi possível gerar o título");
  }
}

// ---------------------------------------------------------------------------
// Contas a pagar — sempre sobre título visível ao usuário
// ---------------------------------------------------------------------------

const COMMISSION_APPROVAL_DENIED = "Seu perfil não aprova títulos de comissão";

export async function approvePayableAction(input: unknown): Promise<ActionResult<undefined>> {
  try {
    const user = await requirePermission("financeiro.contas-a-pagar.aprovar");
    const data = payableIdSchema.parse(input);
    const payable = await assertPayableAccess(user, data.payableId);
    // Título de comissão (ou estorno de comissão): aprovar o pagamento é aprovar a comissão.
    if (isCommissionPayable(payable)) await requirePermission("financeiro.comissoes.aprovar", COMMISSION_APPROVAL_DENIED);
    await approvePayable(data.payableId, actorOf(user), data.note);
    revalidateCommissions();
    return { ok: true, data: undefined };
  } catch (error) {
    return fail(error, "Não foi possível aprovar o título");
  }
}

export async function schedulePayableAction(input: unknown): Promise<ActionResult<undefined>> {
  try {
    const user = await requirePermission("financeiro.contas-a-pagar.programar");
    const data = schedulePayableSchema.parse(input);
    await assertPayableAccess(user, data.payableId);
    await schedulePayable(data.payableId, { dueDate: data.dueDate, note: data.note }, actorOf(user));
    revalidateCommissions();
    return { ok: true, data: undefined };
  } catch (error) {
    return fail(error, "Não foi possível programar o título");
  }
}

export async function payPayableAction(input: unknown): Promise<ActionResult<{ commissions: number }>> {
  try {
    const user = await requirePermission("financeiro.contas-a-pagar.pagar");
    const data = payPayableSchema.parse(input);
    await assertPayableAccess(user, data.payableId);
    // Baixa manual: a conta financeira é obrigatória (vira o lançamento de despesa na mesma transação).
    const accountId = await requireManualPaymentAccount(data.accountId);
    const r = await payPayable(data.payableId, { paidAt: data.paidAt, paymentMethod: data.paymentMethod, receiptUrl: data.receiptUrl, notes: data.notes, accountId, amount: data.amount, reason: data.reason }, actorOf(user));
    revalidateCommissions();
    revalidatePath("/financeiro/cadastros");
    return { ok: true, data: { commissions: r.commissionIds.length } };
  } catch (error) {
    return fail(error, "Não foi possível registrar o pagamento");
  }
}

/** Baixa parcial (etapa CP/CR 3): grava a baixa e o lançamento; quita sozinho quando cobre o restante. */
export async function partialPayPayableAction(input: unknown): Promise<ActionResult<{ settled: boolean }>> {
  try {
    const user = await requirePermission("financeiro.contas-a-pagar.pagar-parcial");
    const data = partialPayPayableSchema.parse(input);
    await assertPayableAccess(user, data.payableId);
    const accountId = await requireManualPaymentAccount(data.accountId);
    const r = await partialPayPayable(data.payableId, { paidAt: data.paidAt, paymentMethod: data.paymentMethod, receiptUrl: data.receiptUrl, notes: data.notes, accountId, amount: data.amount, reason: data.reason }, actorOf(user));
    revalidateCommissions();
    revalidatePath("/financeiro/cadastros");
    return { ok: true, data: { settled: r.settled } };
  } catch (error) {
    return fail(error, "Não foi possível registrar a baixa parcial");
  }
}

/** Pagar parcialmente com resíduo (etapa CP/CR 3): original quitado pelo total pago + título "— Resíduo" com o restante. */
export async function payPayableWithResidualAction(input: unknown): Promise<ActionResult<{ residualId: string; residualCode?: string }>> {
  try {
    const user = await requirePermission("financeiro.contas-a-pagar.pagar-com-residuo");
    const data = partialPayPayableSchema.parse(input);
    await assertPayableAccess(user, data.payableId);
    const accountId = await requireManualPaymentAccount(data.accountId);
    const r = await payPayableWithResidual(data.payableId, { paidAt: data.paidAt, paymentMethod: data.paymentMethod, receiptUrl: data.receiptUrl, notes: data.notes, accountId, amount: data.amount, reason: data.reason }, actorOf(user));
    revalidateCommissions();
    revalidatePath("/financeiro/cadastros");
    return { ok: true, data: { residualId: r.residual?.id ?? "", residualCode: r.residual?.code } };
  } catch (error) {
    return fail(error, "Não foi possível registrar o pagamento com resíduo");
  }
}

/** Quitar pelo já pago (etapa CP/CR 3): valor := já pago, sem nova baixa nem lançamento. */
export async function settlePayableByPaidAction(input: unknown): Promise<ActionResult<{ amount: number }>> {
  try {
    const user = await requirePermission("financeiro.contas-a-pagar.quitar-pelo-pago");
    const data = settlePayableByPaidSchema.parse(input);
    await assertPayableAccess(user, data.payableId);
    const r = await settlePayableByPaid(data.payableId, { reason: data.reason }, actorOf(user));
    revalidateCommissions();
    return { ok: true, data: { amount: r.payable.amount } };
  } catch (error) {
    return fail(error, "Não foi possível quitar pelo já pago");
  }
}

/** Desfazer pagamento (etapa CP/CR 2): título volta a "A pagar" e o lançamento de caixa é apagado junto. */
export async function undoPayablePaymentAction(input: unknown): Promise<ActionResult<{ cashEntryRemoved: boolean }>> {
  try {
    const user = await requirePermission("financeiro.contas-a-pagar.desfazer-pagamento");
    const data = undoPayablePaymentSchema.parse(input);
    await assertPayableAccess(user, data.payableId);
    const r = await undoPayablePayment(data.payableId, { reason: data.reason, paymentId: data.paymentId }, actorOf(user));
    revalidateCommissions();
    revalidatePath("/financeiro/cadastros");
    return { ok: true, data: { cashEntryRemoved: Boolean(r.cashEntryId) } };
  } catch (error) {
    return fail(error, "Não foi possível desfazer o pagamento");
  }
}

export async function cancelPayableAction(input: unknown): Promise<ActionResult<{ commissions: number }>> {
  try {
    const user = await requirePermission("financeiro.contas-a-pagar.cancelar");
    const data = cancelPayableSchema.parse(input);
    await assertPayableAccess(user, data.payableId);
    const r = await cancelPayable(data.payableId, data.reason, actorOf(user));
    revalidateCommissions();
    return { ok: true, data: { commissions: r.commissionIds.length } };
  } catch (error) {
    return fail(error, "Não foi possível cancelar o título");
  }
}

export async function updatePayableAction(input: unknown): Promise<ActionResult<undefined>> {
  try {
    const user = await requirePermission("financeiro.contas-a-pagar.editar");
    const data = updatePayableSchema.parse(input);
    await assertPayableAccess(user, data.payableId);
    await assertCreditorChange(user, data);
    await updatePayable(data.payableId, data, actorOf(user));
    revalidateCommissions();
    return { ok: true, data: undefined };
  } catch (error) {
    return fail(error, "Não foi possível alterar o título");
  }
}

/** Credor novo (etapa CP/CR 5): com escopo menor que empresa, só colaborador dentro do escopo (como no lançamento). */
async function assertCreditorChange(user: CurrentUser, data: { creditorType?: "colaborador" | "fornecedor"; creditorId?: string }): Promise<void> {
  if (data.creditorType || data.creditorId) await assertCreditorInScope(user, { creditorType: data.creditorType ?? (data.creditorId ? "colaborador" : "fornecedor"), creditorId: data.creditorId });
}

/**
 * "Salvar este + N futuros" (etapa CP/CR 5): exige "Editar título" E "Editar em série". Os futuros fora do escopo do
 * usuário em Contas a Pagar nem entram; os que o fluxo de aprovação não deixa alterar voltam em `skipped` com o motivo.
 */
export async function updatePayableSeriesAction(input: unknown): Promise<ActionResult<{ updated: number; skipped: { code: string; reason: string }[] }>> {
  try {
    const user = await requirePermission("financeiro.contas-a-pagar.editar-serie");
    await requirePermission("financeiro.contas-a-pagar.editar", SERIES_EDIT_DENIED);
    const data = updatePayableSchema.parse(input);
    await assertPayableAccess(user, data.payableId);
    await assertCreditorChange(user, data);
    const vis = await payableVisibility(user);
    const r = await updatePayableSeries(data.payableId, data, actorOf(user), { allow: (p) => payableAllowed(vis, p) });
    revalidateCommissions();
    return { ok: true, data: { updated: r.updated, skipped: r.skipped.map((s) => ({ code: s.code, reason: s.reason })) } };
  } catch (error) {
    return fail(error, "Não foi possível alterar os títulos em série");
  }
}

/** "Cancelar este + N futuros" (etapa CP/CR 5): exige "Cancelar título" E "Cancelar em série"; motivo obrigatório. */
export async function cancelPayableSeriesAction(input: unknown): Promise<ActionResult<{ cancelled: number; skipped: { code: string; reason: string }[] }>> {
  try {
    const user = await requirePermission("financeiro.contas-a-pagar.cancelar-serie");
    await requirePermission("financeiro.contas-a-pagar.cancelar", SERIES_CANCEL_DENIED);
    const data = cancelPayableSchema.parse(input);
    await assertPayableAccess(user, data.payableId);
    const vis = await payableVisibility(user);
    const r = await cancelPayableSeries(data.payableId, data.reason, actorOf(user), { allow: (p) => payableAllowed(vis, p) });
    revalidateCommissions();
    return { ok: true, data: { cancelled: r.updated, skipped: r.skipped.map((s) => ({ code: s.code, reason: s.reason })) } };
  } catch (error) {
    return fail(error, "Não foi possível cancelar os títulos em série");
  }
}

export async function createManualPayableAction(input: unknown): Promise<ActionResult<{ id: string; code?: string; parcels: number }>> {
  try {
    const user = await requirePermission("financeiro.contas-a-pagar.criar");
    const data = manualPayableSchema.parse(input);
    await assertCreditorInScope(user, data);
    const p = await createManualPayable(data, actorOf(user));
    revalidateCommissions();
    return { ok: true, data: { id: p.id, code: p.code, parcels: p.parcels?.length ?? 1 } };
  } catch (error) {
    return fail(error, "Não foi possível lançar o título");
  }
}

export async function addPayableAttachmentAction(input: unknown): Promise<ActionResult<{ id: string }>> {
  try {
    const user = await requirePermission("financeiro.contas-a-pagar.anexar");
    const data = payableAttachmentSchema.parse(input);
    await assertPayableAccess(user, data.payableId);
    const doc = await addPayableAttachment(data.payableId, { name: data.name, url: data.url }, actorOf(user));
    revalidateCommissions();
    return { ok: true, data: { id: doc.id } };
  } catch (error) {
    return fail(error, "Não foi possível anexar o documento");
  }
}

// ---------------------------------------------------------------------------
// Fornecedores (D28)
// ---------------------------------------------------------------------------

export async function saveSupplierAction(input: unknown): Promise<ActionResult<{ id: string; created: boolean }>> {
  try {
    // Com id = editar; sem id = cadastrar.
    const user = rawId(input) ? await requirePermission("financeiro.contas-a-pagar.fornecedores.editar") : await requirePermission("financeiro.contas-a-pagar.fornecedores.criar");
    const data = supplierSchema.parse(input);
    if (data.id) {
      // Ativar/desativar pela edição exige a permissão própria.
      const current = await getSupplier(data.id);
      if (current && (current.active !== false) !== data.active && !can(user, "financeiro.contas-a-pagar.fornecedores.ativar")) throw new PermissionError("Seu perfil não ativa nem desativa fornecedores");
    }
    const r = await saveSupplier(data, actorOf(user));
    revalidatePath("/financeiro", "layout");
    return { ok: true, data: { id: r.supplier.id, created: r.created } };
  } catch (error) {
    return fail(error, "Não foi possível salvar o fornecedor");
  }
}

export async function setSupplierActiveAction(input: unknown): Promise<ActionResult<{ active: boolean }>> {
  try {
    const user = await requirePermission("financeiro.contas-a-pagar.fornecedores.ativar");
    const data = supplierActiveSchema.parse(input);
    const s = await setSupplierActive(data.id, data.active, actorOf(user));
    revalidatePath("/financeiro", "layout");
    return { ok: true, data: { active: s.active } };
  } catch (error) {
    return fail(error, "Não foi possível alterar o fornecedor");
  }
}
