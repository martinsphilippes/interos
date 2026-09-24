import "server-only";
/**
 * Templates de implantação: combinação dos templates dos produtos contratados em um plano único
 * (usado na criação do projeto) e manutenção dos templates (CRUD da tela /implantacao/checklists).
 */
import { FieldValue } from "firebase-admin/firestore";
import { col, create, getById, getManyByIds, list, update } from "@/server/db";
import { addBusinessHours, businessDaysToHours } from "@/server/sla";
import { shortId } from "@/lib/utils";
import { COLLECTIONS, IMPLEMENTATION_PHASES, type ChecklistItem, type ImplementationPhase, type ImplementationTask, type ImplementationTemplate, type Product, type UserRef } from "@/domain/types";
import type { TemplateInput } from "./schemas";

export type TaskDraft = Omit<ImplementationTask, "id" | "organizationId" | "createdAt" | "updatedAt">;

/** Templates ativos dos produtos: vínculo do produto (implementationTemplateId) ou template com o mesmo productId. */
export async function templatesForProducts(productIds: string[]): Promise<{ products: Map<string, Product>; templates: ImplementationTemplate[] }> {
  const products = await getManyByIds<Product>(COLLECTIONS.products, productIds);
  const linkedIds = Array.from(products.values())
    .map((p) => p.implementationTemplateId)
    .filter((id): id is string => Boolean(id));
  const byId = await getManyByIds<ImplementationTemplate>(COLLECTIONS.implementationTemplates, linkedIds);
  if (byId.size < productIds.length && productIds.length > 0) {
    const byProduct = await list<ImplementationTemplate>(COLLECTIONS.implementationTemplates, { where: [["productId", "in", productIds]] });
    for (const t of byProduct) if (t.active && !byId.has(t.id)) byId.set(t.id, t);
  }
  return { products, templates: Array.from(byId.values()).filter((t) => t.active !== false) };
}

export interface CombinedPlan {
  phases: ImplementationPhase[];
  checklist: ChecklistItem[];
  tasks: TaskDraft[];
  /** Prazo total em dias úteis. */
  totalDays: number;
}

/**
 * Combina os templates: fases unidas na ordem padrão (sem duplicar), tarefas de todos os templates
 * (deduplicadas por título dentro da fase; com vários produtos o título leva o nome do template) e
 * checklist combinado sem repetir rótulos. Prazos das tarefas em dias úteis a partir de `start`,
 * acumulando a maior duração de cada fase.
 */
export function combineTemplates(
  templates: ImplementationTemplate[],
  products: Product[],
  input: { projectId: string; clientId: string; ownerId: string; actorId: string; start: Date; holidays: Set<string> },
): CombinedPlan {
  const productDays = products.map((p) => p.implementationDays ?? 0);
  const totalDays = Math.max(1, ...productDays, ...(productDays.some((d) => d > 0) ? [] : templates.map((t) => t.totalDays)));
  const phases = IMPLEMENTATION_PHASES.filter((ph) => templates.some((t) => t.phases.some((p) => p.key === ph)));
  const checklist: ChecklistItem[] = [];
  const seenChecklist = new Set<string>();
  const tasks: TaskDraft[] = [];
  let dayCursor = 0;
  for (const ph of phases) {
    const seenTitles = new Set<string>();
    let phaseSpan = 0;
    for (const tpl of templates) {
      const spec = tpl.phases.find((p) => p.key === ph);
      if (!spec) continue;
      for (const item of spec.checklist) {
        if (seenChecklist.has(item.label)) continue;
        seenChecklist.add(item.label);
        checklist.push({ id: shortId("chk"), label: item.label, required: item.required, done: false });
      }
      for (const t of spec.tasks) {
        phaseSpan = Math.max(phaseSpan, t.dueInDays);
        if (seenTitles.has(t.title)) continue;
        seenTitles.add(t.title);
        const suffix = templates.length > 1 && ph !== "kickoff" && ph !== "go_live" ? ` (${tpl.name.replace(/^(Implantação|Entrega) /, "")})` : "";
        tasks.push({
          projectId: input.projectId,
          clientId: input.clientId,
          phase: ph,
          title: `${t.title}${suffix}`,
          description: t.description,
          assigneeId: input.ownerId,
          dueAt: addBusinessHours(input.start, businessDaysToHours(dayCursor + t.dueInDays), input.holidays).toISOString(),
          status: "aberta",
          required: t.required,
          createdBy: input.actorId,
        });
      }
    }
    dayCursor += phaseSpan;
  }
  return { phases, checklist, tasks, totalDays };
}

// ---------------------------------------------------------------------------
// CRUD
// ---------------------------------------------------------------------------

export async function saveTemplate(input: TemplateInput, actor: UserRef): Promise<ImplementationTemplate> {
  const phases = [...input.phases]
    .sort((a, b) => IMPLEMENTATION_PHASES.indexOf(a.key) - IMPLEMENTATION_PHASES.indexOf(b.key))
    .map((p, i) => ({ ...p, order: i + 1, tasks: p.tasks.map((t) => ({ ...t, role: t.role ?? "implantacao" as const })) }));
  if (input.productId) {
    const product = await getById<Product>(COLLECTIONS.products, input.productId);
    if (!product) throw new Error("Produto não encontrado");
  }
  const data = { name: input.name, productId: input.productId, totalDays: input.totalDays, active: input.active, phases };
  if (input.id) {
    const existing = await getById<ImplementationTemplate>(COLLECTIONS.implementationTemplates, input.id);
    if (!existing) throw new Error("Template não encontrado");
    await update<ImplementationTemplate>(COLLECTIONS.implementationTemplates, input.id, data);
    // Template desvinculado do produto: o merge do update não remove a chave.
    if (!input.productId && existing.productId) await col(COLLECTIONS.implementationTemplates).doc(input.id).update({ productId: FieldValue.delete() });
    return { ...existing, ...data };
  }
  return create<ImplementationTemplate>(COLLECTIONS.implementationTemplates, { ...data, createdBy: actor.id });
}

export async function setTemplateActive(templateId: string, active: boolean): Promise<ImplementationTemplate> {
  const existing = await getById<ImplementationTemplate>(COLLECTIONS.implementationTemplates, templateId);
  if (!existing) throw new Error("Template não encontrado");
  await update<ImplementationTemplate>(COLLECTIONS.implementationTemplates, templateId, { active });
  return { ...existing, active };
}
