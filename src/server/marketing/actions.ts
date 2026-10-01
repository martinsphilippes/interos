"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { failAction, requirePermission } from "@/server/auth/session";
import type { ActionResult, CurrentUser, Lead, UserRef } from "@/domain/types";
import {
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
import {
  MARKETING_SCREENS,
  assertCampaignInScope,
  assertInboxMessageInScope,
  assertLeadInScope,
  assertProspectInScope,
  assertProspectListInScope,
  assertProspectsInScope,
} from "./access";
import { maskDuplicatesOutOfScope } from "./duplicates";
import { campaignSaveKey } from "./permission-keys";

/**
 * Server Actions do módulo de Marketing e Prospecção.
 *
 * Padrão: requirePermission(chave do catálogo, src/domain/permissions/marketing.ts) → validação zod → registro dentro
 * do escopo da tela (./access.ts; fora dele = PermissionError) → serviço (mutação + emitEvent) → revalidatePath das
 * rotas afetadas. Falhas por failAction (mensagens de negócio via MarketingError, que é um BusinessError). Regras de
 * negócio ficam em ./service.ts.
 */

const actor = (user: CurrentUser): UserRef => ({ id: user.id, name: user.name });

/** Mensagem da negação de campanhas (a mesma de antes do catálogo). */
const CAMPAIGN_DENIED = "Só o Marketing e gestores podem editar campanhas";

/** Validação: a primeira mensagem do zod (como antes); o resto pelo tratamento único (failAction). */
function fail(error: unknown, fallback: string): { ok: false; error: string } {
  if (error instanceof z.ZodError) return { ok: false, error: zodMessage(error) };
  return failAction(error, fallback, "marketing");
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
    const user = await requirePermission("marketing.leads.criar");
    const data = leadDuplicatesSchema.parse(input);
    const [leads, client] = await Promise.all([findLeadDuplicates(data), findMatchingClient(data)]);
    // A deduplicação varre a empresa inteira; o que está fora do escopo do usuário volta só com o mínimo.
    return { ok: true, data: await maskDuplicatesOutOfScope(user, leads, client) };
  } catch (error) {
    return fail(error, "Não foi possível verificar duplicidade");
  }
}

export async function createLeadAction(input: unknown): Promise<ActionResult<{ id: string; temperature: Lead["temperature"]; score: number }>> {
  try {
    const user = await requirePermission("marketing.leads.criar");
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
    const user = await requirePermission("marketing.leads.editar");
    const data = updateLeadSchema.parse(input);
    await assertLeadInScope(user, data.id);
    const lead = await updateLeadData(data, actor(user));
    revalidateMarketing(lead.clientId);
    return { ok: true, data: { id: lead.id, score: lead.score } };
  } catch (error) {
    return fail(error, "Não foi possível salvar o lead");
  }
}

export async function assignLeadAction(input: unknown): Promise<ActionResult<{ id: string }>> {
  try {
    const user = await requirePermission("marketing.leads.atribuir");
    const data = assignLeadSchema.parse(input);
    await assertLeadInScope(user, data.leadId);
    const lead = await assignLead(data.leadId, data.ownerId, actor(user));
    revalidateMarketing(lead.clientId);
    return { ok: true, data: { id: lead.id } };
  } catch (error) {
    return fail(error, "Não foi possível atribuir o lead");
  }
}

export async function setLeadConsent(input: unknown): Promise<ActionResult<{ id: string }>> {
  try {
    const user = await requirePermission("marketing.leads.editar");
    const data = leadConsentSchema.parse(input);
    await assertLeadInScope(user, data.leadId);
    const lead = await setLeadConsentService(data.leadId, data.consent, actor(user));
    revalidateMarketing(lead.clientId);
    return { ok: true, data: { id: lead.id } };
  } catch (error) {
    return fail(error, "Não foi possível registrar o consentimento");
  }
}

export async function setLeadNextAction(input: unknown): Promise<ActionResult<{ id: string }>> {
  try {
    const user = await requirePermission("marketing.leads.editar");
    const data = leadNextActionSchema.parse(input);
    await assertLeadInScope(user, data.leadId);
    const lead = await setLeadNextActionService(data.leadId, data.nextAction, data.nextActionAt, actor(user));
    revalidateMarketing(lead.clientId);
    return { ok: true, data: { id: lead.id } };
  } catch (error) {
    return fail(error, "Não foi possível salvar a próxima ação");
  }
}

export async function changeLeadStatusAction(input: unknown): Promise<ActionResult<{ id: string }>> {
  try {
    const user = await requirePermission("marketing.leads.editar");
    const data = leadStatusSchema.parse(input);
    await assertLeadInScope(user, data.leadId);
    const lead = await changeLeadStatus(data.leadId, data.status, actor(user));
    revalidateMarketing(lead.clientId);
    return { ok: true, data: { id: lead.id } };
  } catch (error) {
    return fail(error, "Não foi possível mudar o status");
  }
}

export async function registerLeadContact(input: unknown): Promise<ActionResult<{ id: string }>> {
  try {
    const user = await requirePermission("marketing.leads.registrar");
    const data = registerLeadContactSchema.parse(input);
    await assertLeadInScope(user, data.leadId);
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
    const user = await requirePermission("marketing.leads.qualificar");
    const data = qualifyLeadSchema.parse(input);
    await assertLeadInScope(user, data.leadId);
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
    const user = await requirePermission("marketing.leads.desqualificar");
    const data = disqualifyLeadSchema.parse(input);
    await assertLeadInScope(user, data.leadId);
    const lead = await disqualifyLead(data.leadId, data.reason, actor(user));
    revalidateMarketing(lead.clientId);
    return { ok: true, data: { id: lead.id } };
  } catch (error) {
    return fail(error, "Não foi possível desqualificar o lead");
  }
}

export async function markLeadDuplicateAction(input: unknown): Promise<ActionResult<{ id: string }>> {
  try {
    const user = await requirePermission("marketing.leads.desqualificar");
    const data = markDuplicateSchema.parse(input);
    // O lead e o original precisam estar no escopo (catálogo: markLeadDuplicate).
    await Promise.all([assertLeadInScope(user, data.leadId), assertLeadInScope(user, data.originalId)]);
    const lead = await markLeadDuplicate(data.leadId, data.originalId, actor(user));
    revalidateMarketing(lead.clientId);
    return { ok: true, data: { id: lead.id } };
  } catch (error) {
    return fail(error, "Não foi possível marcar como duplicado");
  }
}

export async function importLeads(input: unknown): Promise<ActionResult<ImportReport>> {
  try {
    const user = await requirePermission("marketing.leads.importar");
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
    const user = await requirePermission("marketing.caixa-de-entrada.assumir");
    const data = assumeSchema.parse(input);
    if (data.kind === "lead") await assertLeadInScope(user, data.id, MARKETING_SCREENS.inbox);
    else await assertInboxMessageInScope(user, data.id);
    await assumeInboxItem(data.kind, data.id, actor(user));
    revalidateMarketing();
    return { ok: true, data: { id: data.id } };
  } catch (error) {
    return fail(error, "Não foi possível assumir o atendimento");
  }
}

export async function replyInboxAction(input: unknown): Promise<ActionResult<{ id: string; delivery: string }>> {
  try {
    const user = await requirePermission("marketing.caixa-de-entrada.enviar");
    const data = replySchema.parse(input);
    if (data.communicationId) await assertInboxMessageInScope(user, data.communicationId);
    if (data.leadId) await assertLeadInScope(user, data.leadId, MARKETING_SCREENS.inbox);
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
    // Despacho pelo argumento (catálogo: saveCampaign?sem id → criar; ?com id → editar).
    const user =
      campaignSaveKey(input) === "marketing.campanhas.editar"
        ? await requirePermission("marketing.campanhas.editar", CAMPAIGN_DENIED)
        : await requirePermission("marketing.campanhas.criar", CAMPAIGN_DENIED);
    const data = campaignSchema.parse(input);
    if (data.id) await assertCampaignInScope(user, data.id);
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
    const user = await requirePermission("marketing.prospeccao.criar");
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
    const user = await requirePermission("marketing.prospeccao.editar");
    const data = updateProspectListSchema.parse(input);
    await assertProspectListInScope(user, data.listId);
    const saved = await updateProspectList(data, actor(user));
    revalidateMarketing();
    return { ok: true, data: { id: saved.id } };
  } catch (error) {
    return fail(error, "Não foi possível atualizar a lista");
  }
}

export async function setProspectListStatus(input: unknown): Promise<ActionResult<{ id: string }>> {
  try {
    const user = await requirePermission("marketing.prospeccao.editar");
    const data = prospectListStatusSchema.parse(input);
    await assertProspectListInScope(user, data.listId);
    await setProspectListStatusService(data.listId, data.status);
    revalidateMarketing();
    return { ok: true, data: { id: data.listId } };
  } catch (error) {
    return fail(error, "Não foi possível mudar o status da lista");
  }
}

export async function importProspects(input: unknown): Promise<ActionResult<ImportReport>> {
  try {
    const user = await requirePermission("marketing.prospeccao.importar");
    const data = importProspectsSchema.parse(input);
    await assertProspectListInScope(user, data.listId);
    const report = await importProspectsService(data.listId, data.rows, actor(user));
    revalidateMarketing();
    return { ok: true, data: report };
  } catch (error) {
    return fail(error, "Não foi possível importar os contatos");
  }
}

export async function assignProspectsAction(input: unknown): Promise<ActionResult<{ count: number }>> {
  try {
    const user = await requirePermission("marketing.prospeccao.atribuir");
    const data = assignProspectsSchema.parse(input);
    await assertProspectListInScope(user, data.listId);
    await assertProspectsInScope(user, data.listId, data.prospectIds);
    const count = await assignProspects(data.listId, data.prospectIds, data.ownerId, actor(user));
    revalidateMarketing();
    return { ok: true, data: { count } };
  } catch (error) {
    return fail(error, "Não foi possível atribuir os contatos");
  }
}

export async function recordProspectAttempt(input: unknown): Promise<ActionResult<{ id: string }>> {
  try {
    const user = await requirePermission("marketing.prospeccao.registrar");
    const data = prospectAttemptSchema.parse(input);
    await assertProspectInScope(user, data.prospectId);
    const prospect = await recordProspectAttemptService(data, actor(user));
    revalidateMarketing();
    return { ok: true, data: { id: prospect.id } };
  } catch (error) {
    return fail(error, "Não foi possível registrar a tentativa");
  }
}

export async function scheduleProspectAction(input: unknown): Promise<ActionResult<{ id: string }>> {
  try {
    const user = await requirePermission("marketing.prospeccao.registrar");
    const data = scheduleProspectSchema.parse(input);
    await assertProspectInScope(user, data.prospectId);
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
    const user = await requirePermission("marketing.prospeccao.converter");
    const data = convertProspectSchema.parse(input);
    await assertProspectInScope(user, data.prospectId);
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
