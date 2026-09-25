"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { requireUser } from "@/server/auth/session";
import type { ActionResult, CurrentUser, Lead, UserRef } from "@/domain/types";
import {
  MarketingError,
  assignLead,
  assignProspects,
  assumeInboxItem,
  changeLeadStatus,
  convertProspect,
  createLead,
  createProspectList,
  disqualifyLead,
  findLeadDuplicates,
  findMatchingClient,
  importLeads as importLeadsService,
  importProspects as importProspectsService,
  markLeadDuplicate,
  qualifyLead as qualifyLeadService,
  recordProspectAttempt as recordProspectAttemptService,
  registerLeadContact as registerLeadContactService,
  replyToInbox,
  saveCampaign as saveCampaignService,
  scheduleProspectAction as scheduleProspectActionService,
  setLeadConsent as setLeadConsentService,
  setLeadNextAction as setLeadNextActionService,
  setProspectListStatus as setProspectListStatusService,
  updateLeadData,
  updateProspectList,
  type ImportReport,
  type LeadDuplicate,
} from "./service";
import {
  assignLeadSchema,
  assignProspectsSchema,
  assumeSchema,
  campaignSchema,
  convertProspectSchema,
  createLeadSchema,
  disqualifyLeadSchema,
  importLeadsSchema,
  importProspectsSchema,
  leadConsentSchema,
  leadDuplicatesSchema,
  leadNextActionSchema,
  leadStatusSchema,
  markDuplicateSchema,
  prospectAttemptSchema,
  prospectListSchema,
  prospectListStatusSchema,
  qualifyLeadSchema,
  registerLeadContactSchema,
  replySchema,
  scheduleProspectSchema,
  updateLeadSchema,
  updateProspectListSchema,
  zodMessage,
} from "./schemas";

/**
 * Server Actions do módulo de Marketing e Prospecção.
 *
 * Padrão: requireUser() → validação zod (ZodError vira { ok: false, error }) → serviço (mutação +
 * emitEvent) → revalidatePath das rotas afetadas. Regras de negócio ficam em ./service.ts.
 */

const actor = (user: CurrentUser): UserRef => ({ id: user.id, name: user.name });

function fail(error: unknown, fallback: string): { ok: false; error: string } {
  if (error instanceof z.ZodError) return { ok: false, error: zodMessage(error) };
  if (error instanceof MarketingError) return { ok: false, error: error.message };
  console.error(`[marketing] ${fallback}`, error);
  return { ok: false, error: error instanceof Error && error.message ? `${fallback}: ${error.message}` : fallback };
}

function revalidateMarketing(clientId?: string) {
  revalidatePath("/marketing", "layout");
  if (clientId) revalidatePath(`/clientes/${clientId}`);
}

// ---------------------------------------------------------------------------
// Leads
// ---------------------------------------------------------------------------

export async function checkLeadDuplicates(input: unknown): Promise<ActionResult<{ leads: LeadDuplicate[]; client: { id: string; tradeName: string; reasons: string[] } | null }>> {
  try {
    await requireUser();
    const data = leadDuplicatesSchema.parse(input);
    const [leads, client] = await Promise.all([findLeadDuplicates(data), findMatchingClient(data)]);
    return { ok: true, data: { leads, client: client ? { id: client.client.id, tradeName: client.client.tradeName, reasons: client.reasons } : null } };
  } catch (error) {
    return fail(error, "Não foi possível verificar duplicidade");
  }
}

export async function createLeadAction(input: unknown): Promise<ActionResult<{ id: string; temperature: Lead["temperature"]; score: number }>> {
  try {
    const user = await requireUser();
    const data = createLeadSchema.parse(input);
    const lead = await createLead(data, actor(user), { source: "manual" });
    revalidateMarketing();
    revalidatePath("/tarefas");
    return { ok: true, data: { id: lead.id, temperature: lead.temperature, score: lead.score } };
  } catch (error) {
    return fail(error, "Não foi possível cadastrar o lead");
  }
}

export async function updateLeadAction(input: unknown): Promise<ActionResult<{ id: string; score: number }>> {
  try {
    const user = await requireUser();
    const data = updateLeadSchema.parse(input);
    const lead = await updateLeadData(data, actor(user));
    revalidateMarketing(lead.clientId);
    return { ok: true, data: { id: lead.id, score: lead.score } };
  } catch (error) {
    return fail(error, "Não foi possível salvar o lead");
  }
}

export async function assignLeadAction(input: unknown): Promise<ActionResult<{ id: string }>> {
  try {
    const user = await requireUser();
    const data = assignLeadSchema.parse(input);
    const lead = await assignLead(data.leadId, data.ownerId, actor(user));
    revalidateMarketing(lead.clientId);
    return { ok: true, data: { id: lead.id } };
  } catch (error) {
    return fail(error, "Não foi possível atribuir o lead");
  }
}

export async function setLeadConsent(input: unknown): Promise<ActionResult<{ id: string }>> {
  try {
    const user = await requireUser();
    const data = leadConsentSchema.parse(input);
    const lead = await setLeadConsentService(data.leadId, data.consent, actor(user));
    revalidateMarketing(lead.clientId);
    return { ok: true, data: { id: lead.id } };
  } catch (error) {
    return fail(error, "Não foi possível registrar o consentimento");
  }
}

export async function setLeadNextAction(input: unknown): Promise<ActionResult<{ id: string }>> {
  try {
    const user = await requireUser();
    const data = leadNextActionSchema.parse(input);
    const lead = await setLeadNextActionService(data.leadId, data.nextAction, data.nextActionAt, actor(user));
    revalidateMarketing(lead.clientId);
    return { ok: true, data: { id: lead.id } };
  } catch (error) {
    return fail(error, "Não foi possível salvar a próxima ação");
  }
}

export async function changeLeadStatusAction(input: unknown): Promise<ActionResult<{ id: string }>> {
  try {
    const user = await requireUser();
    const data = leadStatusSchema.parse(input);
    const lead = await changeLeadStatus(data.leadId, data.status, actor(user));
    revalidateMarketing(lead.clientId);
    return { ok: true, data: { id: lead.id } };
  } catch (error) {
    return fail(error, "Não foi possível mudar o status");
  }
}

export async function registerLeadContact(input: unknown): Promise<ActionResult<{ id: string }>> {
  try {
    const user = await requireUser();
    const data = registerLeadContactSchema.parse(input);
    const lead = await registerLeadContactService(data, actor(user));
    revalidateMarketing(lead.clientId);
    return { ok: true, data: { id: lead.id } };
  } catch (error) {
    return fail(error, "Não foi possível registrar o contato");
  }
}

export type QualifyActionResult =
  | { qualified: true; clientId: string; clientName: string; reusedClient: boolean; opportunityId: string; sellerName: string; taskId?: string; workflowInstanceId?: string; warnings: string[] }
  | { qualified: false; missing: string[]; minScore: number };

/** Gate de MQL: quando não passa devolve ok:true com a lista do que falta (não é erro de sistema). */
export async function qualifyLead(input: unknown): Promise<ActionResult<QualifyActionResult>> {
  try {
    const user = await requireUser();
    const data = qualifyLeadSchema.parse(input);
    const result = await qualifyLeadService(data.leadId, data.sellerId, actor(user));
    if (!result.ok) return { ok: true, data: { qualified: false, missing: result.missing, minScore: result.minScore } };
    const { handoff } = result;
    revalidateMarketing(handoff.client.id);
    revalidatePath("/clientes");
    revalidatePath("/workflow");
    revalidatePath("/tarefas");
    revalidatePath("/vendas", "layout");
    return {
      ok: true,
      data: {
        qualified: true,
        clientId: handoff.client.id,
        clientName: handoff.client.tradeName,
        reusedClient: handoff.reusedClient,
        opportunityId: handoff.opportunity.id,
        sellerName: result.seller.name,
        taskId: handoff.task?.id,
        workflowInstanceId: handoff.workflowInstanceId,
        warnings: handoff.warnings,
      },
    };
  } catch (error) {
    return fail(error, "Não foi possível qualificar o lead");
  }
}

export async function disqualifyLeadAction(input: unknown): Promise<ActionResult<{ id: string }>> {
  try {
    const user = await requireUser();
    const data = disqualifyLeadSchema.parse(input);
    const lead = await disqualifyLead(data.leadId, data.reason, actor(user));
    revalidateMarketing(lead.clientId);
    return { ok: true, data: { id: lead.id } };
  } catch (error) {
    return fail(error, "Não foi possível desqualificar o lead");
  }
}

export async function markLeadDuplicateAction(input: unknown): Promise<ActionResult<{ id: string }>> {
  try {
    const user = await requireUser();
    const data = markDuplicateSchema.parse(input);
    const lead = await markLeadDuplicate(data.leadId, data.originalId, actor(user));
    revalidateMarketing(lead.clientId);
    return { ok: true, data: { id: lead.id } };
  } catch (error) {
    return fail(error, "Não foi possível marcar como duplicado");
  }
}

export async function importLeads(input: unknown): Promise<ActionResult<ImportReport>> {
  try {
    const user = await requireUser();
    const data = importLeadsSchema.parse(input);
    const report = await importLeadsService(data, actor(user));
    revalidateMarketing();
    return { ok: true, data: report };
  } catch (error) {
    return fail(error, "Não foi possível importar os leads");
  }
}

// ---------------------------------------------------------------------------
// Caixa de entrada
// ---------------------------------------------------------------------------

export async function assumeInboxItemAction(input: unknown): Promise<ActionResult<{ id: string }>> {
  try {
    const user = await requireUser();
    const data = assumeSchema.parse(input);
    await assumeInboxItem(data.kind, data.id, actor(user));
    revalidateMarketing();
    return { ok: true, data: { id: data.id } };
  } catch (error) {
    return fail(error, "Não foi possível assumir o atendimento");
  }
}

export async function replyInboxAction(input: unknown): Promise<ActionResult<{ id: string; delivery: string }>> {
  try {
    const user = await requireUser();
    const data = replySchema.parse(input);
    const sent = await replyToInbox(data, actor(user));
    revalidateMarketing(sent.clientId);
    return { ok: true, data: { id: sent.id, delivery: sent.status } };
  } catch (error) {
    return fail(error, "Não foi possível enviar a resposta");
  }
}

// ---------------------------------------------------------------------------
// Campanhas
// ---------------------------------------------------------------------------

export async function saveCampaign(input: unknown): Promise<ActionResult<{ id: string }>> {
  try {
    const user = await requireUser();
    if (!user.isManager && user.role !== "marketing") return { ok: false, error: "Só o Marketing e gestores podem editar campanhas" };
    const data = campaignSchema.parse(input);
    const campaign = await saveCampaignService(data, actor(user));
    revalidateMarketing();
    return { ok: true, data: { id: campaign.id } };
  } catch (error) {
    return fail(error, "Não foi possível salvar a campanha");
  }
}

// ---------------------------------------------------------------------------
// Prospecção ativa
// ---------------------------------------------------------------------------

export async function createProspectListAction(input: unknown): Promise<ActionResult<{ id: string }>> {
  try {
    const user = await requireUser();
    const data = prospectListSchema.parse(input);
    const created = await createProspectList(data, actor(user));
    revalidateMarketing();
    return { ok: true, data: { id: created.id } };
  } catch (error) {
    return fail(error, "Não foi possível criar a lista");
  }
}

export async function updateProspectListAction(input: unknown): Promise<ActionResult<{ id: string }>> {
  try {
    const user = await requireUser();
    const data = updateProspectListSchema.parse(input);
    const saved = await updateProspectList(data, actor(user));
    revalidateMarketing();
    return { ok: true, data: { id: saved.id } };
  } catch (error) {
    return fail(error, "Não foi possível atualizar a lista");
  }
}

export async function setProspectListStatus(input: unknown): Promise<ActionResult<{ id: string }>> {
  try {
    await requireUser();
    const data = prospectListStatusSchema.parse(input);
    await setProspectListStatusService(data.listId, data.status);
    revalidateMarketing();
    return { ok: true, data: { id: data.listId } };
  } catch (error) {
    return fail(error, "Não foi possível mudar o status da lista");
  }
}

export async function importProspects(input: unknown): Promise<ActionResult<ImportReport>> {
  try {
    const user = await requireUser();
    const data = importProspectsSchema.parse(input);
    const report = await importProspectsService(data.listId, data.rows, actor(user));
    revalidateMarketing();
    return { ok: true, data: report };
  } catch (error) {
    return fail(error, "Não foi possível importar os contatos");
  }
}

export async function assignProspectsAction(input: unknown): Promise<ActionResult<{ count: number }>> {
  try {
    const user = await requireUser();
    const data = assignProspectsSchema.parse(input);
    const count = await assignProspects(data.listId, data.prospectIds, data.ownerId, actor(user));
    revalidateMarketing();
    return { ok: true, data: { count } };
  } catch (error) {
    return fail(error, "Não foi possível atribuir os contatos");
  }
}

export async function recordProspectAttempt(input: unknown): Promise<ActionResult<{ id: string }>> {
  try {
    const user = await requireUser();
    const data = prospectAttemptSchema.parse(input);
    const prospect = await recordProspectAttemptService(data, actor(user));
    revalidateMarketing();
    return { ok: true, data: { id: prospect.id } };
  } catch (error) {
    return fail(error, "Não foi possível registrar a tentativa");
  }
}

export async function scheduleProspectAction(input: unknown): Promise<ActionResult<{ id: string }>> {
  try {
    await requireUser();
    const data = scheduleProspectSchema.parse(input);
    const prospect = await scheduleProspectActionService(data.prospectId, data.nextActionAt, data.note);
    revalidateMarketing();
    return { ok: true, data: { id: prospect.id } };
  } catch (error) {
    return fail(error, "Não foi possível agendar a próxima ação");
  }
}

export async function convertProspectAction(
  input: unknown,
): Promise<ActionResult<{ target: "lead"; leadId: string } | { target: "oportunidade"; opportunityId: string; clientId: string; sellerName: string; warnings: string[] }>> {
  try {
    const user = await requireUser();
    const data = convertProspectSchema.parse(input);
    const result = await convertProspect(data, actor(user));
    revalidateMarketing();
    if (result.target === "lead") return { ok: true, data: { target: "lead", leadId: result.lead.id } };
    revalidatePath("/clientes");
    revalidatePath("/workflow");
    revalidatePath("/tarefas");
    return {
      ok: true,
      data: { target: "oportunidade", opportunityId: result.handoff.opportunity.id, clientId: result.handoff.client.id, sellerName: result.seller.name, warnings: result.handoff.warnings },
    };
  } catch (error) {
    return fail(error, "Não foi possível converter o contato");
  }
}
