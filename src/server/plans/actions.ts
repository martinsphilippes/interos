"use server";
/** Server Actions do cadastro de planos comerciais (Admin › Produtos › Planos). */
import { revalidatePath } from "next/cache";
import { failAction, requirePermission } from "@/server/auth/session";
import type { ActionResult } from "@/domain/types";
import { planActiveSchema, planSchema } from "./schemas";
import { savePlan, setPlanActive } from "./service";

function rawId(input: unknown): boolean {
  const id = input && typeof input === "object" ? (input as { id?: unknown }).id : undefined;
  return typeof id === "string" && id.trim().length > 0;
}

function revalidatePlans() {
  revalidatePath("/admin/produtos");
  revalidatePath("/vendas", "layout");
  revalidatePath("/financeiro/comissoes", "layout");
}

export async function savePlanAction(input: unknown): Promise<ActionResult<{ id: string; created: boolean }>> {
  try {
    const user = rawId(input) ? await requirePermission("admin.produtos.planos.editar") : await requirePermission("admin.produtos.planos.criar");
    const data = planSchema.parse(input);
    const { plan, created } = await savePlan(data, { id: user.id, name: user.name });
    revalidatePlans();
    return { ok: true, data: { id: plan.id, created } };
  } catch (error) {
    return failAction(error, "Não foi possível salvar o plano");
  }
}

export async function setPlanActiveAction(input: unknown): Promise<ActionResult<{ active: boolean }>> {
  try {
    const user = await requirePermission("admin.produtos.planos.ativar");
    const data = planActiveSchema.parse(input);
    const plan = await setPlanActive(data.id, data.active, { id: user.id, name: user.name });
    revalidatePlans();
    return { ok: true, data: { active: plan.active } };
  } catch (error) {
    return failAction(error, "Não foi possível alterar o plano");
  }
}
