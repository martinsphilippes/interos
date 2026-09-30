import "server-only";
/**
 * Comissões de vendas — ponto de compatibilidade do motor v1.
 *
 * O cálculo, a liberação e o ciclo de vida das comissões ficam no motor v2 (src/server/commissions/*): regras por
 * precedência (contrato > vendedor > produto > padrão), base nos itens EFETIVOS do contrato (líquidos) ou no valor
 * recebido, carência, recorrência por competência, títulos em Contas a Pagar e idempotência por chave determinística.
 * As funções abaixo mantêm os nomes usados pelo painel de vendas, pelo simulador, por /performance e pelo relatório:
 *
 * - `calculateCommissionsForOpportunity`: previstas da venda ganha → reconcilia o contrato no motor v2;
 * - `releaseCommissionsForBilling`: pagamento aprovado → reconcilia o contrato da cobrança no motor v2;
 * - `getCommissionSummary`: vendido por tipo, meta, atingimento e comissão prevista/liberada/futura.
 */
import { getManyByIds, list } from "@/server/db";
import { dateKey } from "@/lib/format";
import { COMMISSION_VOID_STATUSES } from "@/domain/commissions";
import { COLLECTIONS, type Billing, type Commission, type CommissionRule, type Contract, type Goal, type Opportunity, type User, type UserRef } from "@/domain/types";
import { REVENUE_TYPES } from "@/components/sales/model";
import { reconcileCommissions, SYSTEM_ACTOR } from "@/server/commissions/engine";
import { ruleScope } from "@/server/commissions/rules";

type RevenueType = Commission["revenueType"];

export { SYSTEM_ACTOR };

/**
 * Regras ativas usadas pelo simulador e pelos painéis: as padrão (sem vendedor e sem contrato) e, quando `userId`
 * é informado, as regras do próprio vendedor. Exceções por contrato e regras de outros vendedores nunca saem daqui.
 */
export async function listActiveCommissionRules(userId?: string): Promise<CommissionRule[]> {
  const rules = await list<CommissionRule>(COLLECTIONS.commissionRules);
  const today = dateKey(new Date());
  return rules
    .filter((r) => r.active)
    .filter((r) => (!r.validFrom || today >= r.validFrom.slice(0, 10)) && (!r.validTo || today <= r.validTo.slice(0, 10)))
    .filter((r) => {
      const scope = ruleScope(r);
      return scope === "padrao" || (scope === "vendedor" && Boolean(userId) && r.userId === userId);
    })
    .sort((a, b) => a.name.localeCompare(b.name, "pt-BR"));
}

/** Competência AAAA-MM no fuso da operação. */
export function competenceOf(iso: string): string {
  return dateKey(iso).slice(0, 7);
}

const EMPTY_BY_TYPE = (): Record<RevenueType, number> => ({ setup: 0, recorrencia: 0, hardware: 0 });

/**
 * Previstas de uma oportunidade ganha (idempotente): reconcilia o contrato da venda no motor v2 e devolve as
 * comissões não canceladas do contrato.
 */
export async function calculateCommissionsForOpportunity(opp: Opportunity, contract?: Contract | null, actor: UserRef = SYSTEM_ACTOR): Promise<Commission[]> {
  const contractId = contract?.id ?? opp.contractId;
  if (!contractId) return [];
  await reconcileCommissions({ contractIds: [contractId], actor });
  const all = await list<Commission>(COLLECTIONS.commissions, { where: [["contractId", "==", contractId]] });
  return all.filter((c) => !COMMISSION_VOID_STATUSES.includes(c.status));
}

/** Pagamento aprovado: reconcilia o contrato da cobrança; devolve as comissões que ficaram elegíveis nesta execução. */
export async function releaseCommissionsForBilling(billing: Billing, actor: UserRef = SYSTEM_ACTOR): Promise<Commission[]> {
  if (!billing.contractId) return [];
  const result = await reconcileCommissions({ contractIds: [billing.contractId], actor });
  if (result.commissionIds.length === 0) return [];
  const docs = await getManyByIds<Commission>(COLLECTIONS.commissions, result.commissionIds);
  return Array.from(docs.values()).filter((c) => c.status === "liberada" || c.status === "titulo_gerado");
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

  // Elegível/título gerado/paga = "liberada"; canceladas, estornadas e bloqueadas ficam fora dos totais.
  const bucket = (c: Commission): "prevista" | "liberada" | "futura" | null => {
    if (COMMISSION_VOID_STATUSES.includes(c.status) || c.status === "bloqueada") return null;
    if (c.status === "liberada" || c.status === "titulo_gerado" || c.status === "paga") return "liberada";
    return c.revenueType === "recorrencia" ? "futura" : "prevista";
  };

  const items = commissions.filter((c) => c.competence === comp && bucket(c) !== null);
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
