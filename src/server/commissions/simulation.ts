import "server-only";
/**
 * Simulador de comissões no servidor: lê regras (na versão vigente na data simulada), versões, produtos e planos e
 * roda o simulador puro (./simulate.ts). O rascunho da regra em edição entra no lugar da versão salva (ou como regra
 * nova), sempre ativo, para o administrador ver o efeito ANTES de salvar.
 */
import { list } from "@/server/db";
import { COLLECTIONS, type CommercialPlan, type CommissionRule, type CommissionRuleVersion, type Product } from "@/domain/types";
import { ruleFromInput, rulesAsOf } from "./rules";
import type { RuleInput } from "./schemas";
import { simulateCommission, type SimulationInput, type SimulationResult } from "./simulate";

export const DRAFT_RULE_ID = "rascunho";

export async function runCommissionSimulation(input: SimulationInput, draft?: RuleInput): Promise<SimulationResult & { draftRuleId?: string }> {
  const [rules, versions, products, plans] = await Promise.all([
    list<CommissionRule>(COLLECTIONS.commissionRules),
    list<CommissionRuleVersion>(COLLECTIONS.commissionRuleVersions),
    list<Product>(COLLECTIONS.products),
    list<CommercialPlan>(COLLECTIONS.commercialPlans),
  ]);
  const saleDay = input.saleDate?.slice(0, 10) || new Date().toISOString().slice(0, 10);
  let effective = rulesAsOf(rules, versions, `${saleDay}T12:00:00.000Z`);
  let draftRuleId: string | undefined;
  if (draft) {
    draftRuleId = draft.id ?? DRAFT_RULE_ID;
    const original = rules.find((r) => r.id === draftRuleId);
    const now = new Date().toISOString();
    const rule: CommissionRule = { ...ruleFromInput(draft), id: draftRuleId, organizationId: original?.organizationId ?? "", createdAt: original?.createdAt ?? now, updatedAt: now, active: true, version: (original?.version ?? 0) + 1 };
    effective = [...effective.filter((r) => r.id !== draftRuleId), rule];
  }
  const plan = plans.find((p) => p.id === input.planId);
  return { ...simulateCommission(effective, products, { ...input, planName: plan?.name }), draftRuleId };
}
