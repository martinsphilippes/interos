import type { registerHandler as RegisterFn } from "../emit";
import { getById, list, update } from "../../db";
import { notify } from "../../notifications";
import { COLLECTIONS, type Department, type DomainEvent, type Lead, type Opportunity, type Prospect, type ProspectList, type User } from "@/domain/types";

/**
 * Handlers do módulo de Marketing e Prospecção:
 *
 * - lead.created              → lead quente: tarefa de contato imediato para o responsável (ou gestor de marketing)
 * - lead.qualified            → avisa o responsável de marketing quando outra pessoa qualificou o lead
 * - opportunity.created       → notifica o vendedor (kind "acao") quando a oportunidade veio do Marketing
 * - opportunity.won           → lead de origem passa a "convertido"
 * - prospect.contacted        → recalcula os totais da lista de prospecção
 * - whatsapp.message.received → notifica o responsável pelo lead da mensagem
 *
 * Serviços com efeitos (tarefas, SLA) são importados dinamicamente para evitar ciclo de módulos
 * (handlers/index.ts → este arquivo → tasks/service → events/index → handlers/index.ts).
 *
 * INTEGRAÇÃO: chamar `registerMarketingHandlers(registerHandler)` em src/server/events/handlers/index.ts.
 * O serviço de marketing também registra sozinho (idempotente) ao ser importado.
 */
let registered = false;

export function registerMarketingHandlers(registerHandler: typeof RegisterFn): void {
  if (registered) return;
  registered = true;
  registerHandler("lead.created", hotLeadTask);
  registerHandler("lead.qualified", notifyLeadOwnerOnQualified);
  registerHandler("opportunity.created", notifySellerOnOpportunity);
  registerHandler("opportunity.won", convertLeadOnWin);
  registerHandler("prospect.contacted", refreshProspectListTotals);
  registerHandler("whatsapp.message.received", notifyOnIncomingMessage);
}

async function marketingManagerId(): Promise<string | undefined> {
  const departments = await list<Department>(COLLECTIONS.departments, { where: [["key", "==", "marketing"]] });
  return departments[0]?.managerId;
}

async function hotLeadTask(event: DomainEvent): Promise<void> {
  if (event.payload.temperature !== "quente" || !event.entityId) return;
  const lead = await getById<Lead>(COLLECTIONS.leads, event.entityId);
  if (!lead || lead.status !== "novo") return;
  const assigneeId = lead.ownerId ?? (await marketingManagerId());
  const assignee = assigneeId ? await getById<User>(COLLECTIONS.users, assigneeId) : null;
  const { createTaskInternal } = await import("@/server/tasks/service");
  const { addBusinessHours, getHolidays } = await import("@/server/sla");
  const dueAt = addBusinessHours(new Date(event.occurredAt), 1, await getHolidays()).toISOString();
  await createTaskInternal(
    {
      title: `Contato imediato: lead quente ${lead.name}${lead.company ? ` (${lead.company})` : ""}`,
      description: `Lead com score ${lead.score} via ${lead.origin}. ${lead.interest ? `Interesse: ${lead.interest}. ` : ""}Faça o primeiro contato em até 1 hora útil.`,
      clientId: lead.clientId,
      assigneeId: assignee && assignee.active !== false ? assignee.id : undefined,
      departmentId: "marketing",
      priority: "alta",
      dueAt,
      processType: "lead",
      processId: lead.id,
      origin: "evento",
      sourceEventId: event.id,
      tags: ["marketing", "lead-quente"],
    },
    { id: event.actorId, name: event.actorName },
  );
}

async function notifyLeadOwnerOnQualified(event: DomainEvent): Promise<void> {
  const ownerId = String(event.payload.leadOwnerId ?? "");
  if (!ownerId || ownerId === event.actorId || !event.entityId) return;
  await notify({
    userIds: [ownerId],
    kind: "informativa",
    title: "Seu lead virou MQL",
    body: event.title,
    href: `/marketing/leads?lead=${event.entityId}`,
    entity: { type: "lead", id: event.entityId },
    eventId: event.id,
  });
}

async function notifySellerOnOpportunity(event: DomainEvent): Promise<void> {
  if (event.payload.source !== "marketing" || !event.entityId) return;
  const ownerId = String(event.payload.ownerId ?? "");
  if (!ownerId || ownerId === event.actorId) return;
  await notify({
    userIds: [ownerId],
    kind: "acao",
    title: "Nova oportunidade para você",
    body: `${event.title}. Faça o primeiro contato até ${event.payload.nextActionLabel ?? "o próximo dia útil"}.`,
    href: `/vendas/oportunidades?oportunidade=${event.entityId}`,
    entity: { type: "opportunity", id: event.entityId },
    eventId: event.id,
  });
}

async function convertLeadOnWin(event: DomainEvent): Promise<void> {
  if (!event.entityId || event.entityType !== "opportunity") return;
  const opportunity = await getById<Opportunity>(COLLECTIONS.opportunities, event.entityId);
  if (!opportunity?.leadId) return;
  const lead = await getById<Lead>(COLLECTIONS.leads, opportunity.leadId);
  if (!lead || lead.status === "convertido") return;
  await update<Lead>(COLLECTIONS.leads, lead.id, { status: "convertido", opportunityId: lead.opportunityId ?? opportunity.id, clientId: lead.clientId ?? opportunity.clientId });
}

/** Contatos que atenderam/responderam em algum momento (convertidos incluídos). */
const RESPONDED = new Set<Prospect["status"]>(["contatado", "respondeu", "convertido"]);

async function refreshProspectListTotals(event: DomainEvent): Promise<void> {
  const listId = String(event.payload.listId ?? "");
  if (listId) await recomputeProspectListTotals(listId);
}

/** Recalcula e grava `totals` da lista a partir dos prospects (fonte da verdade). */
export async function recomputeProspectListTotals(listId: string): Promise<ProspectList["totals"]> {
  const prospects = await list<Prospect>(COLLECTIONS.prospects, { where: [["listId", "==", listId]] });
  const totals: ProspectList["totals"] = {
    contacts: prospects.length,
    attempts: prospects.reduce((sum, p) => sum + (p.attempts ?? 0), 0),
    responses: prospects.filter((p) => RESPONDED.has(p.status)).length,
    opportunities: prospects.filter((p) => Boolean(p.opportunityId)).length,
  };
  await update<ProspectList>(COLLECTIONS.prospectLists, listId, { totals });
  return totals;
}

async function notifyOnIncomingMessage(event: DomainEvent): Promise<void> {
  const entityType = String(event.payload.entityType ?? "");
  const entityId = String(event.payload.entityId ?? "");
  if (entityType !== "lead" || !entityId) return;
  const lead = await getById<Lead>(COLLECTIONS.leads, entityId);
  const target = lead?.ownerId ?? (await marketingManagerId());
  if (!target) return;
  await notify({
    userIds: [target],
    kind: "acao",
    title: `Nova mensagem de ${lead?.name ?? "lead"}`,
    body: event.description,
    href: "/marketing/caixa-de-entrada",
    entity: { type: "lead", id: entityId },
    eventId: event.id,
  });
}
