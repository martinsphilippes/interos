import "server-only";
/**
 * Cadastro de planos comerciais (COM.07): criar, editar e ativar/desativar, com auditoria (evento
 * commercial_plan.changed, de → para). Desativar não apaga: contratos e comissões que já citam o plano continuam com ele.
 */
import { create, getById, list, nowIso, update } from "@/server/db";
import { emitEvent } from "@/server/events";
import { auditChanges, describeChanges, hasChanges } from "@/server/audit";
import { BusinessError } from "@/server/auth/error-classes";
import { COLLECTIONS, type CommercialPlan, type Product, type UserRef } from "@/domain/types";
import type { PlanInput } from "./schemas";

const FIELDS = ["code", "name", "productId", "description", "setupPrice", "monthlyPrice", "active"] as const satisfies readonly (keyof CommercialPlan)[];
const LABELS: Record<string, string> = { code: "Código", name: "Nome", productId: "Produto", description: "Descrição", setupPrice: "Preço de adesão", monthlyPrice: "Preço da mensalidade", active: "Ativo" };

async function emitPlan(action: "criado" | "alterado" | "ativado" | "desativado", plan: CommercialPlan, audit: ReturnType<typeof auditChanges>, actor: UserRef): Promise<void> {
  await emitEvent({
    type: "commercial_plan.changed",
    actor,
    entity: { type: "commercial_plan", id: plan.id },
    title: `Plano ${action}: ${plan.name} (${plan.code})`,
    description: action === "criado" ? undefined : describeChanges(audit, LABELS),
    department: "vendas",
    payload: { planId: plan.id, action, labels: LABELS, ...audit },
    timeline: false,
  });
}

export async function savePlan(input: PlanInput, actor: UserRef): Promise<{ plan: CommercialPlan; created: boolean }> {
  const [plans, product] = await Promise.all([list<CommercialPlan>(COLLECTIONS.commercialPlans), input.productId ? getById<Product>(COLLECTIONS.products, input.productId) : Promise.resolve(null)]);
  if (input.productId && !product) throw new BusinessError("Produto do plano não encontrado");
  const others = plans.filter((p) => p.id !== input.id);
  if (others.some((p) => p.code === input.code)) throw new BusinessError(`Já existe um plano com o código ${input.code}`);
  if (others.some((p) => p.name.toLowerCase() === input.name.toLowerCase() && (p.productId ?? "") === (input.productId ?? ""))) throw new BusinessError(`Já existe o plano "${input.name}" para este produto`);
  const data = {
    code: input.code,
    name: input.name,
    productId: input.productId,
    description: input.description,
    setupPrice: input.setupPrice ?? undefined,
    monthlyPrice: input.monthlyPrice ?? undefined,
    active: input.active,
  };
  if (input.id) {
    const before = plans.find((p) => p.id === input.id);
    if (!before) throw new BusinessError("Plano não encontrado");
    const next = { ...before, ...data, updatedBy: actor.id };
    const audit = auditChanges<CommercialPlan>(before, next, FIELDS);
    if (!hasChanges(audit)) return { plan: before, created: false };
    await update<CommercialPlan>(COLLECTIONS.commercialPlans, before.id, { ...data, updatedBy: actor.id, updatedAt: nowIso() });
    await emitPlan("alterado", next, audit, actor);
    return { plan: next, created: false };
  }
  const plan = await create<CommercialPlan>(COLLECTIONS.commercialPlans, { ...data, order: Math.max(0, ...plans.map((p) => p.order)) + 1, createdBy: actor.id });
  await emitPlan("criado", plan, auditChanges<CommercialPlan>(null, plan, FIELDS), actor);
  return { plan, created: true };
}

export async function setPlanActive(id: string, active: boolean, actor: UserRef): Promise<CommercialPlan> {
  const before = await getById<CommercialPlan>(COLLECTIONS.commercialPlans, id);
  if (!before) throw new BusinessError("Plano não encontrado");
  if (before.active === active) return before;
  await update<CommercialPlan>(COLLECTIONS.commercialPlans, id, { active, updatedBy: actor.id });
  const next = { ...before, active };
  await emitPlan(active ? "ativado" : "desativado", next, auditChanges<CommercialPlan>(before, next, ["active"]), actor);
  return next;
}
