import "server-only";
/** Leituras do cadastro de planos comerciais (commercial_plans). */
import { list } from "@/server/db";
import { COLLECTIONS, type CommercialPlan } from "@/domain/types";

/** Plano como opção de formulário (proposta, regra de comissão, simulador). */
export interface PlanOption {
  id: string;
  code: string;
  name: string;
  productId?: string;
  setupPrice?: number;
  monthlyPrice?: number;
  active: boolean;
}

const byOrder = (a: CommercialPlan, b: CommercialPlan) => a.order - b.order || a.name.localeCompare(b.name, "pt-BR");

export async function listPlans(): Promise<CommercialPlan[]> {
  return (await list<CommercialPlan>(COLLECTIONS.commercialPlans)).sort(byOrder);
}

/** Todos os planos (ativos e inativos) como opções; quem vende filtra os ativos com `plansForProduct`. */
export async function listPlanOptions(): Promise<PlanOption[]> {
  return (await listPlans()).map((p) => ({ id: p.id, code: p.code, name: p.name, productId: p.productId, setupPrice: p.setupPrice, monthlyPrice: p.monthlyPrice, active: p.active }));
}

/** Planos ativos vendáveis num produto: os do produto e os que valem para qualquer produto. */
export function plansForProduct(plans: PlanOption[], productId: string): PlanOption[] {
  return plans.filter((p) => p.active && (!p.productId || p.productId === productId));
}
