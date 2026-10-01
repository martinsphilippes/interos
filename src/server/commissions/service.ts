import "server-only";
/**
 * Operações manuais de Comissões (Financeiro): regras (criar, editar, ativar/desativar, exceção por contrato), dia de
 * pagamento das comissões, estorno/cancelamento, bloqueio e novo título. Toda alteração emite evento com
 * auditChanges (from → to) e motivo (D16); regras e comissões pendentes são recalculadas pelo motor em seguida.
 */
import { col, create, createIfAbsent, getById, list, nowIso, update } from "@/server/db";
import { emitEvent } from "@/server/events";
import { auditChanges, describeChanges, hasChanges } from "@/server/audit";
import { formatCurrency, formatDate } from "@/lib/format";
import { COMMISSION_PENDING_STATUSES, COMMISSION_STATUS_LABELS } from "@/domain/commissions";
import { COLLECTIONS, type Commission, type CommissionRule, type Contract, type Payable, type Product, type Settings, type User, type UserRef } from "@/domain/types";
import { SETTING_DESCRIPTIONS } from "@/server/admin/schemas";
import { reconcileCommissions } from "./engine";
import { cancelPayable, commissionPayableSchedule, ensurePayableForCommission, getCommissionPaymentSettings } from "./payables";
import { legacyReleaseCondition } from "./rules";
import type { RuleInput } from "./schemas";
import { assignPayableCode, cleanPatch, deleteField, historyEntry, transitionCommission } from "./store";

const RULE_FIELDS = [
  "name",
  "scope",
  "userId",
  "contractId",
  "revenueType",
  "productId",
  "productCategory",
  "mode",
  "value",
  "trigger",
  "baseSource",
  "minTenureDays",
  "recurringCompetences",
  "releaseInstallment",
  "validFrom",
  "validTo",
  "overridesDefault",
  "reason",
  "active",
] as const satisfies readonly (keyof CommissionRule)[];

export const RULE_FIELD_LABELS: Record<string, string> = {
  name: "Nome",
  scope: "Abrangência",
  userId: "Vendedor",
  contractId: "Contrato",
  revenueType: "Tipo de receita",
  productId: "Produto",
  productCategory: "Categoria",
  mode: "Forma de cálculo",
  value: "Valor",
  trigger: "Gatilho",
  baseSource: "Base",
  minTenureDays: "Carência (dias)",
  recurringCompetences: "Competências",
  releaseInstallment: "Mensalidade inicial",
  validFrom: "Vigência (início)",
  validTo: "Vigência (fim)",
  overridesDefault: "Substitui a padrão",
  reason: "Motivo",
  active: "Ativa",
};

async function loadRule(id: string): Promise<CommissionRule> {
  const r = await getById<CommissionRule>(COLLECTIONS.commissionRules, id);
  if (!r) throw new Error("Regra não encontrada");
  return r;
}

/** Contratos a recalcular depois de mudar uma regra: o da exceção, ou todos os de venda. */
async function recalcAfterRuleChange(rule: Pick<CommissionRule, "contractId" | "scope">, actor: UserRef): Promise<void> {
  try {
    await reconcileCommissions({ contractIds: rule.scope === "contrato" && rule.contractId ? [rule.contractId] : undefined, actor });
  } catch (error) {
    console.error("[comissoes] falha ao recalcular depois de alterar regra", error);
  }
}

export async function saveCommissionRule(input: RuleInput, actor: UserRef): Promise<{ rule: CommissionRule; created: boolean }> {
  const [contract, seller, product] = await Promise.all([
    input.scope === "contrato" && input.contractId ? getById<Contract>(COLLECTIONS.contracts, input.contractId) : Promise.resolve(null),
    input.scope === "vendedor" && input.userId ? getById<User>(COLLECTIONS.users, input.userId) : Promise.resolve(null),
    input.productId ? getById<Product>(COLLECTIONS.products, input.productId) : Promise.resolve(null),
  ]);
  if (input.scope === "contrato") {
    if (!contract) throw new Error("Contrato da exceção não encontrado");
    if (contract.status === "cancelado") throw new Error("Contrato cancelado não recebe exceção de comissão");
    if (!contract.sellerId && !contract.opportunityId) throw new Error("Este contrato não veio de uma venda (sem vendedor): não gera comissão");
  }
  if (input.scope === "vendedor" && !seller) throw new Error("Vendedor não encontrado");
  if (input.productId && !product) throw new Error("Produto não encontrado");

  const data: Omit<CommissionRule, "id" | "organizationId" | "createdAt" | "updatedAt"> = {
    name: input.name,
    scope: input.scope,
    userId: input.scope === "vendedor" ? input.userId : undefined,
    contractId: input.scope === "contrato" ? input.contractId : undefined,
    clientId: contract?.clientId,
    revenueType: input.revenueType,
    productId: input.productId,
    productCategory: input.productCategory,
    mode: input.mode,
    value: input.value,
    releaseCondition: legacyReleaseCondition(input.revenueType, input.trigger),
    trigger: input.trigger,
    baseSource: input.baseSource,
    minTenureDays: input.minTenureDays,
    recurringCompetences: input.revenueType === "recorrencia" ? input.recurringCompetences : null,
    releaseInstallment: input.revenueType === "recorrencia" ? input.releaseInstallment : undefined,
    validFrom: input.scope === "contrato" ? undefined : input.validFrom,
    validTo: input.scope === "contrato" ? undefined : input.validTo,
    overridesDefault: input.overridesDefault,
    reason: input.reason,
    active: input.active,
  };

  if (input.id) {
    const before = await loadRule(input.id);
    const next = { ...before, ...data, updatedBy: actor.id, approvedBy: input.scope === "contrato" ? actor.id : before.approvedBy };
    const audit = auditChanges<CommissionRule>(before, next, RULE_FIELDS, input.reason);
    if (!hasChanges(audit)) return { rule: before, created: false };
    // Campos que deixaram de existir (ex.: produto removido) precisam sumir do documento.
    const cleared: Record<string, unknown> = {};
    for (const f of RULE_FIELDS) if (next[f] === undefined && before[f] !== undefined) cleared[f] = deleteField();
    const { id: _omit, ...fields } = next;
    void _omit;
    await col(COLLECTIONS.commissionRules).doc(before.id).update(cleanPatch({ ...fields, ...cleared, updatedAt: nowIso() }));
    await emitRuleEvent("updated", next, audit, actor);
    await recalcAfterRuleChange(before.scope === "contrato" || next.scope === "contrato" ? { scope: "contrato", contractId: next.contractId ?? before.contractId } : next, actor);
    return { rule: next, created: false };
  }
  const rule = await create<CommissionRule>(COLLECTIONS.commissionRules, { ...data, createdBy: actor.id, approvedBy: input.scope === "contrato" ? actor.id : undefined });
  await emitRuleEvent("created", rule, auditChanges<CommissionRule>(null, rule, RULE_FIELDS, input.reason), actor);
  await recalcAfterRuleChange(rule, actor);
  return { rule, created: true };
}

export async function setCommissionRuleActive(id: string, active: boolean, reason: string, actor: UserRef): Promise<CommissionRule> {
  const before = await loadRule(id);
  if (before.active === active) return before;
  const next = { ...before, active, updatedBy: actor.id };
  await update<CommissionRule>(COLLECTIONS.commissionRules, id, { active, updatedBy: actor.id });
  await emitRuleEvent(active ? "activated" : "deactivated", next, auditChanges<CommissionRule>(before, next, ["active"], reason), actor);
  await recalcAfterRuleChange(next, actor);
  return next;
}

async function emitRuleEvent(action: "created" | "updated" | "activated" | "deactivated", rule: CommissionRule, audit: ReturnType<typeof auditChanges>, actor: UserRef): Promise<void> {
  const verb = { created: "criada", updated: "alterada", activated: "reativada", deactivated: "desativada" }[action];
  const kind = rule.scope === "contrato" ? "Exceção de comissão" : "Regra de comissão";
  await emitEvent({
    type: "commission_rule.changed",
    actor,
    clientId: rule.clientId,
    entity: { type: "commission_rule", id: rule.id },
    title: `${kind} ${verb}: ${rule.name}`,
    description: action === "created" ? audit.reason : [describeChanges(audit, RULE_FIELD_LABELS), audit.reason ? `motivo: ${audit.reason}` : null].filter(Boolean).join(" · "),
    department: "financeiro",
    payload: { ruleId: rule.id, action, scope: rule.scope ?? "padrao", contractId: rule.contractId, userId: rule.userId, ...audit },
    timeline: false,
  });
}

// ---------------------------------------------------------------------------
// Dia de pagamento das comissões (setting comissoes_pagamento)
// ---------------------------------------------------------------------------

export async function saveCommissionPaymentDay(diaPagamento: number, actor: UserRef): Promise<void> {
  const existing = await list<Settings>(COLLECTIONS.settings, { where: [["key", "==", "comissoes_pagamento"]] });
  const before = (existing[0]?.value as { diaPagamento?: number } | undefined) ?? null;
  const value = { diaPagamento };
  if (existing[0]) await update<Settings>(COLLECTIONS.settings, existing[0].id, { value });
  else await create<Settings>(COLLECTIONS.settings, { key: "comissoes_pagamento", value, description: SETTING_DESCRIPTIONS.comissoes_pagamento, createdBy: actor.id }, "setting_comissoes_pagamento");
  const audit = auditChanges<{ diaPagamento?: number }>(before, value, ["diaPagamento"]);
  if (!hasChanges(audit)) return;
  await emitEvent({
    type: "settings.updated",
    actor,
    entity: { type: "setting", id: "comissoes_pagamento" },
    title: `Dia de pagamento das comissões: ${diaPagamento}`,
    description: describeChanges(audit, { diaPagamento: "Dia de pagamento" }),
    department: "financeiro",
    payload: { kind: "setting", setting: "comissoes_pagamento", created: !before, ...audit },
  });
}

// ---------------------------------------------------------------------------
// Operações manuais na comissão
// ---------------------------------------------------------------------------

async function loadCommission(id: string): Promise<Commission> {
  const c = await getById<Commission>(COLLECTIONS.commissions, id);
  if (!c) throw new Error("Comissão não encontrada");
  return c;
}

const label = (c: Commission) => c.code ?? c.id;

async function emitCommission(type: "commission.reversed" | "commission.cancelled" | "commission.updated", actor: UserRef, c: Commission, title: string, payload: Record<string, unknown>, description?: string): Promise<void> {
  await emitEvent({
    type,
    actor,
    clientId: c.clientId,
    entity: { type: "commission", id: c.id },
    title,
    description,
    department: "financeiro",
    payload: { commissionId: c.id, userId: c.userId, contractId: c.contractId, amount: c.amount, ...payload },
    timeline: false,
  });
}

/**
 * Estorno/cancelamento manual (com motivo e permissão):
 * - paga → "estornada" + título NEGATIVO de estorno (categoria estorno_comissao) vinculado ao título pago, para o
 *   Financeiro descontar/recuperar — nada é apagado;
 * - elegível/título gerado → título em aberto cancelado e comissão "estornada";
 * - ainda não adquirida (prevista, carência, aguardando, bloqueada) → "cancelada".
 */
export async function reverseCommission(id: string, reason: string, actor: UserRef): Promise<{ status: Commission["status"]; reversalPayableId?: string }> {
  const trimmed = reason.trim();
  const c = await loadCommission(id);
  const now = nowIso();
  if (c.status === "estornada" || c.status === "cancelada") throw new Error(`Comissão já ${COMMISSION_STATUS_LABELS[c.status].toLowerCase()}`);

  if ([...COMMISSION_PENDING_STATUSES, "bloqueada"].includes(c.status)) {
    const changed = await transitionCommission(id, [...COMMISSION_PENDING_STATUSES, "bloqueada"], { status: "cancelada", cancelledAt: now, cancelReason: trimmed }, historyEntry(actor, "cancelada", c.status, `Cancelada manualmente: ${trimmed}`));
    if (!changed) throw new Error("A comissão mudou de situação; atualize a tela");
    await emitCommission("commission.cancelled", actor, changed.after, `Comissão ${label(c)} cancelada manualmente`, { changes: { status: { from: c.status, to: "cancelada" } }, reason: trimmed }, trimmed);
    return { status: "cancelada" };
  }

  if (c.status === "titulo_gerado" && c.payableId) {
    const payable = await getById<Payable>(COLLECTIONS.payables, c.payableId);
    if (payable && payable.status !== "cancelado" && payable.status !== "pago") await cancelPayable(payable.id, `Estorno da comissão ${label(c)}: ${trimmed}`, actor);
  }

  const fresh = await loadCommission(id);
  if (fresh.status === "liberada") {
    const changed = await transitionCommission(id, ["liberada"], { status: "estornada", reversedAt: now, reversedBy: actor.id, reverseReason: trimmed }, historyEntry(actor, "estornada", "liberada", `Estornada antes do pagamento: ${trimmed}`));
    if (!changed) throw new Error("A comissão mudou de situação; atualize a tela");
    await emitCommission("commission.reversed", actor, changed.after, `Comissão ${label(c)} estornada (não paga)`, { changes: { status: { from: c.status, to: "estornada" } }, reason: trimmed, paid: false }, trimmed);
    return { status: "estornada" };
  }

  if (fresh.status !== "paga") throw new Error(`Comissão ${COMMISSION_STATUS_LABELS[fresh.status].toLowerCase()} não pode ser estornada`);
  const changed = await transitionCommission(id, ["paga"], { status: "estornada", reversedAt: now, reversedBy: actor.id, reverseReason: trimmed }, historyEntry(actor, "estornada", "paga", `Estornada após o pagamento: ${trimmed}`));
  if (!changed) throw new Error("A comissão mudou de situação; atualize a tela");
  // Título negativo (valor a recuperar), vinculado ao título pago. Idempotente por id.
  const settings = await getCommissionPaymentSettings();
  const { competence, dueDate } = commissionPayableSchedule(now, settings.diaPagamento);
  const seller = await getById<User>(COLLECTIONS.users, c.userId);
  const reversalId = `pag_est_${c.id}`;
  const { created, doc } = await createIfAbsent<Payable>(COLLECTIONS.payables, reversalId, {
    creditorType: "colaborador",
    creditorId: c.userId,
    creditorName: seller?.name ?? "Colaborador",
    category: "estorno_comissao",
    description: `Estorno da comissão ${label(c)} (valor a recuperar) · ${trimmed}`,
    amount: -Math.abs(c.amount),
    competence,
    dueDate,
    status: "previsto",
    origin: "estorno",
    sourceIds: { commissionIds: [c.id], contractId: c.contractId, opportunityId: c.opportunityId, saleNumber: c.saleNumber, billingId: c.billingId, clientId: c.clientId, reversalOf: c.payableId },
    history: [{ at: now, by: actor.id, byName: actor.name, action: "Estorno de comissão paga", to: "previsto", reason: trimmed }],
    createdBy: actor.id,
  });
  const code = created ? await assignPayableCode(reversalId, now) : doc.code;
  await update<Commission>(COLLECTIONS.commissions, id, { reversalPayableId: reversalId });
  await emitCommission("commission.reversed", actor, changed.after, `Comissão ${label(c)} estornada (paga): ${formatCurrency(c.amount)} a recuperar`, { changes: { status: { from: "paga", to: "estornada" } }, reason: trimmed, paid: true, reversalPayableId: reversalId }, trimmed);
  if (created) {
    await emitEvent({
      type: "payable.created",
      actor,
      clientId: c.clientId,
      entity: { type: "payable", id: reversalId },
      title: `Título ${code} de estorno: ${formatCurrency(-Math.abs(c.amount))} (${seller?.name ?? "colaborador"})`,
      description: `Vinculado ao título pago ${c.payableId ?? "—"} · vence ${formatDate(dueDate)}`,
      department: "financeiro",
      payload: { payableId: reversalId, code, amount: -Math.abs(c.amount), commissionIds: [c.id], reversalOf: c.payableId, origin: "estorno", reason: trimmed },
      timeline: false,
    });
  }
  return { status: "estornada", reversalPayableId: reversalId };
}

/** Retém a comissão (não evolui nem gera título) até o desbloqueio. */
export async function blockCommission(id: string, reason: string, actor: UserRef): Promise<void> {
  const c = await loadCommission(id);
  const changed = await transitionCommission(id, [...COMMISSION_PENDING_STATUSES, "liberada"], (cur) => (cur.payableId ? null : { status: "bloqueada", blockedReason: reason.trim() }), historyEntry(actor, "bloqueada", c.status, `Bloqueada: ${reason.trim()}`));
  if (!changed) throw new Error("Só comissões pendentes ou elegíveis sem título podem ser bloqueadas");
  await emitCommission("commission.updated", actor, changed.after, `Comissão ${label(c)} bloqueada`, { changes: { status: { from: c.status, to: "bloqueada" } }, reason: reason.trim() }, reason.trim());
}

/** Libera a retenção: volta a "prevista" e o motor reavalia na hora (pode ficar elegível e gerar título). */
export async function unblockCommission(id: string, reason: string, actor: UserRef): Promise<void> {
  const c = await loadCommission(id);
  const changed = await transitionCommission(id, ["bloqueada"], { status: "prevista", blockedReason: deleteField() }, historyEntry(actor, "prevista", "bloqueada", `Desbloqueada: ${reason.trim()}`));
  if (!changed) throw new Error("A comissão não está bloqueada");
  await emitCommission("commission.updated", actor, changed.after, `Comissão ${label(c)} desbloqueada`, { changes: { status: { from: "bloqueada", to: "prevista" } }, reason: reason.trim() }, reason.trim());
  if (c.contractId) await reconcileCommissions({ contractIds: [c.contractId], actor });
}

/** Novo título para a comissão elegível cujo título anterior foi cancelado. */
export async function regenerateCommissionPayable(id: string, actor: UserRef): Promise<Payable> {
  const c = await loadCommission(id);
  if (c.status !== "liberada" || c.payableId) throw new Error("Só comissões elegíveis sem título recebem um novo título");
  const r = await ensurePayableForCommission(c, { actor });
  if (!r) throw new Error("Não foi possível gerar o título");
  return r.payable;
}
