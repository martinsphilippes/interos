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
import { COLLECTIONS, type Commission, type CommercialPlan, type CommissionRule, type CommissionRuleVersion, type Contract, type Payable, type Product, type Settings, type User, type UserRef } from "@/domain/types";
import { SETTING_DESCRIPTIONS } from "@/server/admin/schemas";
import { reconcileCommissions } from "./engine";
import { cancelPayable, commissionPayableSchedule, ensurePayableForCommission, getCommissionPaymentSettings } from "./payables";
import { ruleFromInput } from "./rules";
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
  "code",
  "description",
  "planId",
  "priority",
  "baseKind",
  "deductions",
  "referenceValue",
  "baseCap",
  "amountCap",
  "installments",
  "reverseOnCancel",
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
  code: "Código",
  description: "Descrição",
  planId: "Plano",
  priority: "Prioridade",
  baseKind: "Base de cálculo",
  deductions: "Deduções",
  referenceValue: "Valor de referência",
  baseCap: "Teto da base",
  amountCap: "Teto da comissão",
  installments: "Mensalidades comissionáveis",
  reverseOnCancel: "Estorna no cancelamento",
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

/** Grava a versão `n` da regra (histórico completo; o motor aplica a vigente na data da venda). Idempotente pelo id. */
async function writeRuleVersion(rule: CommissionRule, n: number, opts: { effectiveFrom: string; retroactive: boolean; reason?: string; summary?: string; actor: UserRef }): Promise<void> {
  const { id: _id, organizationId: _org, createdAt: _c, updatedAt: _u, ...snapshot } = rule;
  void _id;
  void _org;
  void _c;
  void _u;
  await createIfAbsent<CommissionRuleVersion>(COLLECTIONS.commissionRuleVersions, `crv_${rule.id}_${n}`, {
    ruleId: rule.id,
    version: n,
    rule: { ...snapshot, version: n },
    effectiveFrom: opts.effectiveFrom,
    retroactive: opts.retroactive,
    reason: opts.reason,
    summary: opts.summary,
    changedBy: opts.actor.id,
    changedByName: opts.actor.name,
    createdBy: opts.actor.id,
  } as Omit<CommissionRuleVersion, "id" | "organizationId" | "createdAt" | "updatedAt">);
}

/**
 * Regra anterior ao versionamento: antes da 1ª alteração registra a versão 1 como ela estava, valendo para todas as
 * vendas anteriores (era o comportamento dela) — assim a alteração não alcança essas vendas.
 */
async function ensureBaselineVersion(before: CommissionRule, actor: UserRef): Promise<number> {
  if (before.version) return before.version;
  await writeRuleVersion(before, 1, { effectiveFrom: before.createdAt, retroactive: true, reason: "Versão inicial (regra anterior ao histórico de versões)", actor });
  return 1;
}

export interface SaveRuleOptions {
  /** Aplicar a nova versão também às comissões pendentes de vendas anteriores (permissão própria, checada na action). */
  applyToPending?: boolean;
}

export async function saveCommissionRule(input: RuleInput, actor: UserRef, options: SaveRuleOptions = {}): Promise<{ rule: CommissionRule; created: boolean }> {
  const [contract, seller, product, plan, sameCode] = await Promise.all([
    input.scope === "contrato" && input.contractId ? getById<Contract>(COLLECTIONS.contracts, input.contractId) : Promise.resolve(null),
    input.scope === "vendedor" && input.userId ? getById<User>(COLLECTIONS.users, input.userId) : Promise.resolve(null),
    input.productId ? getById<Product>(COLLECTIONS.products, input.productId) : Promise.resolve(null),
    input.planId ? getById<CommercialPlan>(COLLECTIONS.commercialPlans, input.planId) : Promise.resolve(null),
    input.code ? list<CommissionRule>(COLLECTIONS.commissionRules, { where: [["code", "==", input.code]] }) : Promise.resolve([]),
  ]);
  if (input.scope === "contrato") {
    if (!contract) throw new Error("Contrato da exceção não encontrado");
    if (contract.status === "cancelado") throw new Error("Contrato cancelado não recebe exceção de comissão");
    if (!contract.sellerId && !contract.opportunityId) throw new Error("Este contrato não veio de uma venda (sem vendedor): não gera comissão");
  }
  if (input.scope === "vendedor" && !seller) throw new Error("Vendedor não encontrado");
  if (input.productId && !product) throw new Error("Produto não encontrado");
  if (input.planId && !plan) throw new Error("Plano não encontrado");
  if (plan?.productId && input.productId && plan.productId !== input.productId) throw new Error(`O plano ${plan.name} pertence a outro produto`);
  if (sameCode.some((r) => r.id !== input.id)) throw new Error(`Já existe uma regra com o código ${input.code}`);

  const data = ruleFromInput(input, { clientId: contract?.clientId });
  const now = nowIso();
  const retroactive = Boolean(options.applyToPending);

  if (input.id) {
    const before = await loadRule(input.id);
    const draft = { ...before, ...data, updatedBy: actor.id, approvedBy: input.scope === "contrato" ? actor.id : before.approvedBy };
    const audit = auditChanges<CommissionRule>(before, draft, RULE_FIELDS, input.reason);
    if (!hasChanges(audit) && !retroactive) return { rule: before, created: false };
    const current = await ensureBaselineVersion(before, actor);
    const next: CommissionRule = { ...draft, version: current + 1 };
    // Campos que deixaram de existir (ex.: produto removido) precisam sumir do documento.
    const cleared: Record<string, unknown> = {};
    for (const f of RULE_FIELDS) if (next[f] === undefined && before[f] !== undefined) cleared[f] = deleteField();
    const { id: _omit, ...fields } = next;
    void _omit;
    await col(COLLECTIONS.commissionRules).doc(before.id).update(cleanPatch({ ...fields, ...cleared, updatedAt: now }));
    const summary = describeChanges(audit, RULE_FIELD_LABELS);
    await writeRuleVersion({ ...next, updatedAt: now }, current + 1, { effectiveFrom: now, retroactive, reason: input.reason, summary, actor });
    await emitRuleEvent("updated", next, audit, actor, retroactive);
    await recalcAfterRuleChange(before.scope === "contrato" || next.scope === "contrato" ? { scope: "contrato", contractId: next.contractId ?? before.contractId } : next, actor);
    return { rule: next, created: false };
  }
  const rule = await create<CommissionRule>(COLLECTIONS.commissionRules, { ...data, version: 1, createdBy: actor.id, approvedBy: input.scope === "contrato" ? actor.id : undefined });
  await writeRuleVersion(rule, 1, { effectiveFrom: rule.createdAt, retroactive, reason: input.reason, summary: "Regra criada", actor });
  await emitRuleEvent("created", rule, auditChanges<CommissionRule>(null, rule, RULE_FIELDS, input.reason), actor, retroactive);
  await recalcAfterRuleChange(rule, actor);
  return { rule, created: true };
}

export async function setCommissionRuleActive(id: string, active: boolean, reason: string, actor: UserRef, options: SaveRuleOptions = {}): Promise<CommissionRule> {
  const before = await loadRule(id);
  if (before.active === active) return before;
  const now = nowIso();
  const current = await ensureBaselineVersion(before, actor);
  const next = { ...before, active, updatedBy: actor.id, version: current + 1 };
  await update<CommissionRule>(COLLECTIONS.commissionRules, id, { active, updatedBy: actor.id, version: current + 1 });
  const audit = auditChanges<CommissionRule>(before, next, ["active"], reason);
  await writeRuleVersion({ ...next, updatedAt: now }, current + 1, { effectiveFrom: now, retroactive: Boolean(options.applyToPending), reason, summary: active ? "Regra reativada" : "Regra desativada", actor });
  await emitRuleEvent(active ? "activated" : "deactivated", next, audit, actor, Boolean(options.applyToPending));
  await recalcAfterRuleChange(next, actor);
  return next;
}

async function emitRuleEvent(action: "created" | "updated" | "activated" | "deactivated", rule: CommissionRule, audit: ReturnType<typeof auditChanges>, actor: UserRef, retroactive = false): Promise<void> {
  const verb = { created: "criada", updated: "alterada", activated: "reativada", deactivated: "desativada" }[action];
  const kind = rule.scope === "contrato" ? "Exceção de comissão" : "Regra de comissão";
  await emitEvent({
    type: "commission_rule.changed",
    actor,
    clientId: rule.clientId,
    entity: { type: "commission_rule", id: rule.id },
    title: `${kind} ${verb}: ${rule.name}`,
    description: [action === "created" ? audit.reason : describeChanges(audit, RULE_FIELD_LABELS), action !== "created" && audit.reason ? `motivo: ${audit.reason}` : null, `versão ${rule.version ?? 1}`, retroactive ? "reaplicada às comissões pendentes de vendas anteriores" : "vale para vendas a partir de agora"].filter(Boolean).join(" · "),
    department: "financeiro",
    payload: { ruleId: rule.id, action, scope: rule.scope ?? "padrao", contractId: rule.contractId, userId: rule.userId, version: rule.version ?? 1, retroactive, ...audit },
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
/**
 * Contrato cancelado (COM: estorno conforme configuração): comissões ADQUIRIDAS (elegível, título gerado ou paga) cuja
 * regra congelada tem `reverseOnCancel` são estornadas pelo mesmo caminho do estorno manual (título não pago é
 * cancelado; paga vira título negativo a recuperar). Idempotente: estornadas/canceladas são ignoradas.
 */
export async function reverseCommissionsOnContractCancel(contractId: string, reason: string, actor: UserRef): Promise<string[]> {
  const list_ = await list<Commission>(COLLECTIONS.commissions, { where: [["contractId", "==", contractId]] });
  const targets = list_.filter((c) => c.ruleSnapshot?.reverseOnCancel && (c.status === "liberada" || c.status === "titulo_gerado" || c.status === "paga"));
  const done: string[] = [];
  for (const c of targets) {
    try {
      await reverseCommission(c.id, `Contrato cancelado (regra "${c.ruleSnapshot?.name ?? ""}" estorna no cancelamento): ${reason}`, actor);
      done.push(c.id);
    } catch (error) {
      console.error(`[comissoes] estorno no cancelamento falhou para ${c.id}`, error);
    }
  }
  return done;
}

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
