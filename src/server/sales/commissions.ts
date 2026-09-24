import "server-only";
/**
 * Motor de comissionamento de vendas.
 *
 * - `calculateCommissionsForOpportunity`: gera as comissões previstas de uma venda ganha, por produto
 *   e tipo de receita (adesão/setup, recorrência, hardware), usando as `commission_rules` ativas:
 *   a regra do produto quando existir, senão a regra padrão do tipo de receita; sem regra no banco,
 *   usa o percentual padrão do cadastro do produto.
 * - `releaseCommissionsForBilling`: libera comissões quando o Financeiro aprova um pagamento
 *   (recorrência só a partir da parcela configurada, ex.: 3ª mensalidade).
 * - `getCommissionSummary`: vendido por tipo, meta, atingimento e comissão prevista/liberada/futura.
 */
import { create, getManyByIds, list, nowIso, update } from "@/server/db";
import { emitEvent } from "@/server/events";
import { dateKey, formatCurrency } from "@/lib/format";
import { COLLECTIONS, type Billing, type Commission, type CommissionRule, type Contract, type Goal, type Opportunity, type Product, type User, type UserRef } from "@/domain/types";
import { commissionAmount, pickCommissionRule, REVENUE_TYPE_LABELS, REVENUE_TYPES } from "@/components/sales/model";

type RevenueType = Commission["revenueType"];

export const SYSTEM_ACTOR: UserRef = { id: "system", name: "INTEROS (automação)" };

export async function listActiveCommissionRules(): Promise<CommissionRule[]> {
  const rules = await list<CommissionRule>(COLLECTIONS.commissionRules);
  return rules.filter((r) => r.active).sort((a, b) => a.name.localeCompare(b.name, "pt-BR"));
}

/** Competência AAAA-MM no fuso da operação. */
export function competenceOf(iso: string): string {
  return dateKey(iso).slice(0, 7);
}

/** Dia `day` do mês `offset` meses após a competência da data (horário 12:00 UTC). */
function dayInMonthsAfter(iso: string, offset: number, day: number): string {
  const [y, m] = competenceOf(iso).split("-").map(Number);
  return new Date(Date.UTC(y, m - 1 + offset, day, 12)).toISOString();
}

const EMPTY_BY_TYPE = (): Record<RevenueType, number> => ({ setup: 0, recorrencia: 0, hardware: 0 });

/** Regra efetiva (do banco ou derivada do produto) para uma linha. */
function resolveRule(rules: CommissionRule[], type: RevenueType, product: Product | undefined): { rule?: CommissionRule; mode: CommissionRule["mode"]; value: number; releaseCondition: CommissionRule["releaseCondition"]; releaseInstallment?: number } | null {
  const rule = pickCommissionRule(rules, type, product?.id);
  if (rule) return { rule, mode: rule.mode, value: rule.value, releaseCondition: rule.releaseCondition, releaseInstallment: rule.releaseInstallment ?? product?.commission.recurringReleaseInstallment };
  if (!product) return null;
  const pct = type === "setup" ? product.commission.setupPct : type === "recorrencia" ? product.commission.recurringPct : product.commission.hardwarePct;
  if (!pct) return null;
  return { mode: "percentual", value: pct, releaseCondition: type === "recorrencia" ? "parcela" : "pagamento", releaseInstallment: product.commission.recurringReleaseInstallment };
}

/**
 * Gera as comissões previstas de uma oportunidade ganha. Idempotente: se já existem comissões
 * não canceladas para a oportunidade, devolve-as sem criar novas.
 */
export async function calculateCommissionsForOpportunity(opp: Opportunity, contract?: Contract | null, actor: UserRef = SYSTEM_ACTOR): Promise<Commission[]> {
  const existing = (await list<Commission>(COLLECTIONS.commissions, { where: [["opportunityId", "==", opp.id]] })).filter((c) => c.status !== "cancelada");
  if (existing.length > 0) return existing;

  const [rules, products] = await Promise.all([listActiveCommissionRules(), getManyByIds<Product>(COLLECTIONS.products, opp.products.map((p) => p.productId))]);
  const soldAt = opp.wonAt ?? nowIso();
  const comp = competenceOf(soldAt);
  const created: Commission[] = [];

  for (const line of opp.products) {
    const product = products.get(line.productId);
    const bases: Record<RevenueType, number> = { setup: line.setupValue, recorrencia: line.monthlyValue, hardware: line.hardwareValue };
    for (const type of REVENUE_TYPES) {
      const base = bases[type];
      if (!base || base <= 0) continue;
      const effective = resolveRule(rules, type, product);
      if (!effective) continue;
      const amount = commissionAmount(effective, base, line.quantity);
      if (amount <= 0) continue;
      const installment = effective.releaseInstallment ?? 3;
      const releasedNow = effective.releaseCondition === "venda";
      const releaseAt =
        type === "recorrencia" || effective.releaseCondition === "parcela"
          ? dayInMonthsAfter(soldAt, installment, contract?.billingDay ?? 10) // estimativa: vencimento da parcela N
          : releasedNow
            ? soldAt
            : undefined;
      created.push(
        await create<Commission>(COLLECTIONS.commissions, {
          userId: opp.ownerId,
          clientId: opp.clientId,
          contractId: contract?.id ?? opp.contractId,
          opportunityId: opp.id,
          productId: line.productId,
          revenueType: type,
          baseAmount: base,
          amount,
          competence: comp,
          status: releasedNow ? "liberada" : "prevista",
          releaseAt,
          ruleId: effective.rule?.id,
          createdBy: actor.id,
        }),
      );
    }
  }

  if (created.length > 0) {
    const byType = EMPTY_BY_TYPE();
    for (const c of created) byType[c.revenueType] += c.amount;
    const total = created.reduce((s, c) => s + c.amount, 0);
    await emitEvent({
      type: "commission.calculated",
      actor,
      clientId: opp.clientId,
      entity: { type: "opportunity", id: opp.id },
      title: `Comissão prevista calculada: ${formatCurrency(total)}`,
      description: REVENUE_TYPES.filter((t) => byType[t] > 0)
        .map((t) => `${REVENUE_TYPE_LABELS[t]} ${formatCurrency(byType[t])}`)
        .join(" · "),
      department: "vendas",
      payload: { userId: opp.ownerId, opportunityId: opp.id, contractId: contract?.id, total, byType, commissionIds: created.map((c) => c.id), competence: comp },
      timeline: false,
    });
  }
  return created;
}

/**
 * Libera comissões ligadas a uma cobrança paga: adesão/setup e hardware quando a cobrança é desse
 * tipo; recorrência quando a mensalidade paga é a parcela configurada na regra (ou posterior).
 */
export async function releaseCommissionsForBilling(billing: Billing, actor: UserRef = SYSTEM_ACTOR): Promise<Commission[]> {
  const type: RevenueType | null = billing.type === "mensalidade" ? "recorrencia" : billing.type === "setup" ? "setup" : billing.type === "hardware" ? "hardware" : null;
  if (!type || !billing.contractId) return [];
  const pending = (await list<Commission>(COLLECTIONS.commissions, { where: [["contractId", "==", billing.contractId]] })).filter((c) => c.status === "prevista" && c.revenueType === type);
  if (pending.length === 0) return [];

  const [rules, products] = await Promise.all([
    list<CommissionRule>(COLLECTIONS.commissionRules),
    getManyByIds<Product>(COLLECTIONS.products, pending.map((c) => c.productId ?? "")),
  ]);
  const ruleById = new Map(rules.map((r) => [r.id, r]));
  const releasedAt = nowIso();
  const released: Commission[] = [];
  for (const c of pending) {
    if (type === "recorrencia") {
      const threshold = (c.ruleId ? ruleById.get(c.ruleId)?.releaseInstallment : undefined) ?? (c.productId ? products.get(c.productId)?.commission.recurringReleaseInstallment : undefined) ?? 3;
      if ((billing.installment ?? 0) < threshold) continue;
    }
    await update<Commission>(COLLECTIONS.commissions, c.id, { status: "liberada", releaseAt: releasedAt });
    released.push({ ...c, status: "liberada", releaseAt: releasedAt });
  }
  if (released.length > 0) {
    const total = released.reduce((s, c) => s + c.amount, 0);
    await emitEvent({
      type: "commission.calculated",
      actor,
      clientId: billing.clientId,
      entity: { type: "contract", id: billing.contractId },
      title: `Comissão de ${REVENUE_TYPE_LABELS[type].toLowerCase()} liberada: ${formatCurrency(total)}`,
      description: type === "recorrencia" ? `Mensalidade ${billing.installment ?? "?"}ª paga (${billing.competence})` : `Cobrança de ${REVENUE_TYPE_LABELS[type].toLowerCase()} paga`,
      department: "vendas",
      payload: { released: true, billingId: billing.id, commissionIds: released.map((c) => c.id), userIds: Array.from(new Set(released.map((c) => c.userId))), total },
      timeline: false,
    });
  }
  return released;
}

// ---------------------------------------------------------------------------
// Resumo
// ---------------------------------------------------------------------------

export interface CommissionSummary {
  competence: string;
  sold: Record<RevenueType, number>;
  /** Meta do mês por tipo de receita (0 = sem meta cadastrada). */
  goals: Record<RevenueType, number>;
  /** Atingimento (fração) por tipo; null quando não há meta. */
  attainment: Record<RevenueType, number | null>;
  /** Comissão da competência: prevista (adesão/hardware a liberar), liberada/paga e futura (recorrência a liberar). */
  commission: { prevista: number; liberada: number; futura: number; total: number };
  byType: Record<RevenueType, { prevista: number; liberada: number; futura: number }>;
  history: { competence: string; prevista: number; liberada: number; futura: number }[];
  items: Commission[];
}

/** Chaves de meta aceitas em `goals.kpiKey` para cada tipo de receita. */
const GOAL_KEYS: Record<RevenueType, string[]> = {
  setup: ["setup_vendido", "setup", "vendas_setup", "meta_setup"],
  recorrencia: ["recorrencia_vendida", "recorrencia", "vendas_recorrencia", "meta_recorrencia"],
  hardware: ["hardware_vendido", "hardware", "vendas_hardware", "meta_hardware"],
};

function previousCompetences(comp: string, count: number): string[] {
  const [y, m] = comp.split("-").map(Number);
  const out: string[] = [];
  for (let i = count - 1; i >= 0; i--) {
    const d = new Date(Date.UTC(y, m - 1 - i, 1));
    out.push(d.toISOString().slice(0, 7));
  }
  return out;
}

/** Metas mensais por tipo de receita: `goals` (escopo usuário, competência) com fallback em `user.monthlyGoals`. */
export async function getRevenueGoals(userIds: string[], comp: string): Promise<Record<RevenueType, number>> {
  const [goals, users] = await Promise.all([
    list<Goal>(COLLECTIONS.goals, { where: [["period", "==", comp]] }),
    getManyByIds<User>(COLLECTIONS.users, userIds),
  ]);
  const out = EMPTY_BY_TYPE();
  for (const userId of userIds) {
    const mine = goals.filter((g) => g.scope === "usuario" && g.scopeId === userId);
    for (const type of REVENUE_TYPES) {
      const goal = mine.find((g) => GOAL_KEYS[type].includes(g.kpiKey));
      const fallback = users.get(userId)?.monthlyGoals?.[type];
      out[type] += goal?.target ?? fallback ?? 0;
    }
  }
  return out;
}

export async function getCommissionSummary(userIds: string | string[], comp: string, preloaded?: { opportunities?: Opportunity[] }): Promise<CommissionSummary> {
  const ids = Array.isArray(userIds) ? userIds : [userIds];
  const [commissions, opportunities, goals] = await Promise.all([
    ids.length > 0 ? list<Commission>(COLLECTIONS.commissions, { where: [["userId", "in", ids]] }) : Promise.resolve([] as Commission[]),
    preloaded?.opportunities ?? (ids.length > 0 ? list<Opportunity>(COLLECTIONS.opportunities, { where: [["ownerId", "in", ids]] }) : Promise.resolve([] as Opportunity[])),
    getRevenueGoals(ids, comp),
  ]);

  const sold = EMPTY_BY_TYPE();
  for (const o of opportunities) {
    if (o.stage !== "ganho" || !o.wonAt || !ids.includes(o.ownerId) || competenceOf(o.wonAt) !== comp) continue;
    sold.setup += o.setupTotal;
    sold.recorrencia += o.monthlyTotal;
    sold.hardware += o.hardwareTotal;
  }
  const attainment = {} as Record<RevenueType, number | null>;
  for (const type of REVENUE_TYPES) attainment[type] = goals[type] > 0 ? sold[type] / goals[type] : null;

  const bucket = (c: Commission): "prevista" | "liberada" | "futura" | null => {
    if (c.status === "cancelada") return null;
    if (c.status === "liberada" || c.status === "paga") return "liberada";
    return c.revenueType === "recorrencia" ? "futura" : "prevista";
  };

  const items = commissions.filter((c) => c.competence === comp && c.status !== "cancelada");
  const byType = { setup: { prevista: 0, liberada: 0, futura: 0 }, recorrencia: { prevista: 0, liberada: 0, futura: 0 }, hardware: { prevista: 0, liberada: 0, futura: 0 } };
  const commission = { prevista: 0, liberada: 0, futura: 0, total: 0 };
  for (const c of items) {
    const b = bucket(c);
    if (!b) continue;
    byType[c.revenueType][b] += c.amount;
    commission[b] += c.amount;
    commission.total += c.amount;
  }

  const history = previousCompetences(comp, 6).map((k) => {
    const row = { competence: k, prevista: 0, liberada: 0, futura: 0 };
    for (const c of commissions) {
      if (c.competence !== k) continue;
      const b = bucket(c);
      if (b) row[b] += c.amount;
    }
    return row;
  });

  items.sort((a, b) => (a.createdAt < b.createdAt ? 1 : -1));
  return { competence: comp, sold, goals, attainment, commission, byType, history, items };
}
