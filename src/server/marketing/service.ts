import "server-only";
/**
 * Serviço de Marketing e Prospecção SEM validação de sessão. Usado pelas Server Actions (que validam
 * sessão e entrada), pelo webhook de entrada de leads e por scripts.
 *
 * Fluxo central: lead → (contato) → gate de MQL → cliente (novo ou reaproveitado) + oportunidade +
 * jornada na etapa de Vendas + tarefa de primeiro contato para o vendedor. Toda mutação emite evento.
 */
import { create, getById, getManyByIds, list, nowIso, update, type CreateInput } from "@/server/db";
import { emitEvent } from "@/server/events";
import { registerHandler } from "@/server/events/emit";
import { recomputeProspectListTotals, registerMarketingHandlers } from "@/server/events/handlers/marketing";
import { notify } from "@/server/notifications";
import { getSetting } from "@/server/admin/queries";
import { addBusinessHours, getHolidays } from "@/server/sla";
import { createTaskInternal } from "@/server/tasks/service";
import { completeGate, createWorkflowInstanceForClient } from "@/server/workflow/service";
import { formatDateTime } from "@/lib/format";
import {
  COLLECTIONS,
  type BaseEntity,
  type Campaign,
  type CollectionName,
  type Client,
  type Communication,
  type Contact,
  type DomainEvent,
  type Lead,
  type LeadSource,
  type Opportunity,
  type OpportunityProduct,
  type Product,
  type Prospect,
  type ProspectList,
  type Task,
  type TimelineEvent,
  type User,
  type UserRef,
  type WorkflowInstance,
  type WorkflowStep,
} from "@/domain/types";
import type { ProspectListExtended, ProspectListPlanning } from "@/domain/marketing-extra";
import { getChannelAdapter } from "./channels";
import { DEFAULT_SCORING_RULES, computeLeadScore, evaluateMqlGate, normalize, type LeadScoreResult, type LeadScoringRules } from "./scoring";
import {
  createLeadSchema,
  type CreateLeadInput,
  type ImportRow,
  type LeadContactChannel,
  type ProspectAttemptResult,
  type ProspectRow,
  type UpdateLeadInput,
  type WebhookLeadInput,
} from "./schemas";

// Registro idempotente dos handlers (o integrador também deve ligá-los em handlers/index.ts).
registerMarketingHandlers(registerHandler);

export type MarketingActor = UserRef;

/** Erro de regra de negócio: a mensagem vai direto para a interface. */
export class MarketingError extends Error {}

const CHANNEL_LABELS: Record<LeadContactChannel, string> = { ligacao: "Ligação", whatsapp: "WhatsApp", email: "E-mail" };
const COMMUNICATION_CHANNEL: Record<LeadContactChannel, Communication["channel"]> = { ligacao: "voip", whatsapp: "whatsapp", email: "email" };

/**
 * Regrava o documento inteiro (set sem merge) com o patch aplicado. Diferente de `update`, chaves do
 * patch com `undefined` são REMOVIDAS do Firestore (limpar próxima ação, responsável, motivo...).
 */
async function patchDoc<T extends BaseEntity>(name: CollectionName, current: T, patch: Partial<T>): Promise<T> {
  const { id, updatedAt: _previous, ...rest } = current;
  void _previous;
  await create<T>(name, { ...rest, ...patch } as unknown as CreateInput<T>, id);
  return { ...current, ...patch };
}

// ---------------------------------------------------------------------------
// Scoring
// ---------------------------------------------------------------------------

export async function getScoringRules(): Promise<LeadScoringRules> {
  const value = await getSetting<LeadScoringRules>("lead_scoring", DEFAULT_SCORING_RULES);
  return {
    origem: value.origem ?? {},
    interesse: value.interesse ?? {},
    cidade: value.cidade ?? {},
    limiares: { ...DEFAULT_SCORING_RULES.limiares, ...(value.limiares ?? {}) },
  };
}

async function productCategories(productIds: string[]): Promise<string[]> {
  if (productIds.length === 0) return [];
  const products = await getManyByIds<Product>(COLLECTIONS.products, productIds);
  return Array.from(products.values()).map((p) => p.category);
}

/** Score + temperatura + explicação para os dados de um lead. */
export async function scoreLead(lead: Pick<Lead, "origin" | "interest" | "city" | "productInterestIds">, rules?: LeadScoringRules): Promise<LeadScoreResult> {
  return computeLeadScore({ ...lead, productCategories: await productCategories(lead.productInterestIds ?? []) }, rules ?? (await getScoringRules()));
}

// ---------------------------------------------------------------------------
// Duplicidade
// ---------------------------------------------------------------------------

/** Telefone comparável: só dígitos, sem DDI 55. */
export function phoneKey(value: string | undefined | null): string {
  const digits = (value ?? "").replace(/\D/g, "");
  return digits.length > 11 && digits.startsWith("55") ? digits.slice(2) : digits;
}

function companyKey(value: string | undefined | null): string {
  const key = normalize(value).replace(/[^a-z0-9]+/g, " ").trim();
  return key.length >= 4 ? key : "";
}

export interface LeadDuplicate {
  id: string;
  name: string;
  company?: string;
  phone?: string;
  email?: string;
  status: Lead["status"];
  createdAt: string;
  reasons: string[];
}

/** Compara um lead (ou dados de formulário) com uma lista de leads. Puro. */
export function matchLeadDuplicates(target: { phone?: string; email?: string; company?: string; excludeId?: string }, leads: Lead[]): LeadDuplicate[] {
  const phone = phoneKey(target.phone);
  const email = normalize(target.email);
  const company = companyKey(target.company);
  if (!phone && !email && !company) return [];
  const out: LeadDuplicate[] = [];
  for (const lead of leads) {
    if (lead.id === target.excludeId) continue;
    const reasons: string[] = [];
    if (phone.length >= 10 && phoneKey(lead.phone) === phone) reasons.push("mesmo telefone");
    if (email && normalize(lead.email) === email) reasons.push("mesmo e-mail");
    if (company && companyKey(lead.company) === company) reasons.push("mesma empresa");
    if (reasons.length > 0) {
      out.push({ id: lead.id, name: lead.name, company: lead.company, phone: lead.phone, email: lead.email, status: lead.status, createdAt: lead.createdAt, reasons });
    }
  }
  return out.sort((a, b) => (a.createdAt < b.createdAt ? -1 : 1));
}

export async function findLeadDuplicates(target: { phone?: string; email?: string; company?: string; excludeId?: string }): Promise<LeadDuplicate[]> {
  if (!target.phone && !target.email && !target.company) return [];
  return matchLeadDuplicates(target, await list<Lead>(COLLECTIONS.leads));
}

/** Cliente existente com o mesmo telefone/WhatsApp, e-mail ou nome da empresa (cancelados por último). */
export async function findMatchingClient(target: { phone?: string; email?: string; company?: string }): Promise<{ client: Client; reasons: string[] } | null> {
  const phone = phoneKey(target.phone);
  const email = normalize(target.email);
  const company = companyKey(target.company);
  if (!phone && !email && !company) return null;
  const [clients, contacts] = await Promise.all([list<Client>(COLLECTIONS.clients), phone || email ? list<Contact>(COLLECTIONS.contacts) : Promise.resolve([] as Contact[])]);
  const contactClientIds = new Set(
    contacts.filter((c) => (phone.length >= 10 && [phoneKey(c.phone), phoneKey(c.whatsapp)].includes(phone)) || (email && normalize(c.email) === email)).map((c) => c.clientId),
  );
  const matches: { client: Client; reasons: string[] }[] = [];
  for (const client of clients) {
    const reasons: string[] = [];
    if (phone.length >= 10 && [phoneKey(client.phone), phoneKey(client.whatsapp)].includes(phone)) reasons.push("mesmo telefone");
    if (email && normalize(client.email) === email) reasons.push("mesmo e-mail");
    if (company && (companyKey(client.tradeName) === company || companyKey(client.legalName) === company)) reasons.push("mesma empresa");
    if (contactClientIds.has(client.id)) reasons.push("contato cadastrado no cliente");
    if (reasons.length > 0) matches.push({ client, reasons });
  }
  matches.sort((a, b) => {
    const ac = a.client.status === "cancelado" ? 1 : 0;
    const bc = b.client.status === "cancelado" ? 1 : 0;
    return ac - bc || b.reasons.length - a.reasons.length;
  });
  return matches[0] ?? null;
}

// ---------------------------------------------------------------------------
// Origens e campanhas
// ---------------------------------------------------------------------------

/** Converte texto livre ("Instagram", "indicação") na chave da origem cadastrada; senão devolve o fallback. */
export async function resolveOriginKey(value: string | undefined, fallback: string): Promise<string> {
  if (!value) return fallback;
  const target = normalize(value);
  const sources = await list<LeadSource>(COLLECTIONS.leadSources);
  const found = sources.find((s) => normalize(s.key) === target || normalize(s.name) === target);
  return found?.key ?? (/^[a-z0-9_-]{2,40}$/.test(target) ? target : fallback);
}

/** Campanha pelo id ou pelo nome (sem acentos/maiúsculas). */
export async function resolveCampaignId(value: string | undefined): Promise<string | undefined> {
  if (!value) return undefined;
  const byId = await getById<Campaign>(COLLECTIONS.campaigns, value);
  if (byId) return byId.id;
  const campaigns = await list<Campaign>(COLLECTIONS.campaigns);
  return campaigns.find((c) => normalize(c.name) === normalize(value))?.id;
}

/** Produtos cujo nome ou categoria aparece no texto de interesse. */
async function productsFromInterest(interest: string | undefined, catalog?: Product[]): Promise<string[]> {
  const text = ` ${normalize(interest).replace(/[^a-z0-9]+/g, " ")} `;
  if (!text.trim()) return [];
  const products = catalog ?? (await list<Product>(COLLECTIONS.products));
  const found = products.filter((p) => p.active !== false && (text.includes(` ${normalize(p.category)} `) || text.includes(` ${normalize(p.name).replace(/[^a-z0-9]+/g, " ").trim()} `)));
  // Um produto por categoria (ex.: dois ERPs no catálogo → o primeiro na ordem do catálogo).
  const byCategory = new Map<string, Product>();
  for (const p of found.sort((a, b) => a.order - b.order)) if (!byCategory.has(p.category)) byCategory.set(p.category, p);
  return Array.from(byCategory.values()).map((p) => p.id);
}

// ---------------------------------------------------------------------------
// Leads: criação e edição
// ---------------------------------------------------------------------------

async function loadLead(id: string): Promise<Lead> {
  const lead = await getById<Lead>(COLLECTIONS.leads, id);
  if (!lead) throw new MarketingError("Lead não encontrado");
  return lead;
}

async function loadActiveUser(id: string, label = "Responsável"): Promise<User> {
  const user = await getById<User>(COLLECTIONS.users, id);
  if (!user || user.active === false) throw new MarketingError(`${label} não encontrado ou inativo`);
  return user;
}

export type LeadCaptureSource = "manual" | "importacao" | "webhook" | "prospeccao";

const SOURCE_LABELS: Record<LeadCaptureSource, string> = { manual: "cadastro manual", importacao: "importação CSV", webhook: "webhook", prospeccao: "prospecção ativa" };

/** Cria o lead (score e temperatura pelo setting lead_scoring) e emite lead.created. */
export async function createLead(input: CreateLeadInput, actor: MarketingActor, options: { source?: LeadCaptureSource; rules?: LeadScoringRules } = {}): Promise<Lead> {
  if (input.ownerId) await loadActiveUser(input.ownerId);
  const source = options.source ?? "manual";
  const score = await scoreLead(input, options.rules);
  const now = nowIso();
  const lead = await create<Lead>(COLLECTIONS.leads, {
    name: input.name,
    company: input.company,
    phone: input.phone,
    email: input.email,
    city: input.city,
    state: input.state,
    origin: input.origin,
    campaignId: input.campaignId,
    interest: input.interest,
    productInterestIds: input.productInterestIds ?? [],
    ownerId: input.ownerId,
    score: score.score,
    temperature: score.temperature,
    status: "novo",
    consent: input.consent,
    consentAt: input.consent ? now : undefined,
    notes: input.notes,
    nextAction: input.nextAction,
    nextActionAt: input.nextActionAt,
    createdBy: actor.id,
  });
  await emitEvent({
    type: "lead.created",
    actor,
    entity: { type: "lead", id: lead.id },
    title: `Lead captado: ${lead.name}${lead.company ? ` (${lead.company})` : ""}`,
    description: `Origem ${lead.origin} · score ${lead.score} (${lead.temperature}) · ${SOURCE_LABELS[source]}`,
    department: "marketing",
    payload: { origin: lead.origin, campaignId: lead.campaignId, score: lead.score, temperature: lead.temperature, ownerId: lead.ownerId, source },
  });
  return lead;
}

/** Edição completa dos dados do lead; recalcula score e temperatura. */
export async function updateLeadData(input: UpdateLeadInput, actor: MarketingActor): Promise<Lead> {
  const lead = await loadLead(input.id);
  if (input.ownerId && input.ownerId !== lead.ownerId) await loadActiveUser(input.ownerId);
  const score = await scoreLead(input);
  const consent = input.consent ?? lead.consent;
  const patch: Partial<Lead> = {
    name: input.name,
    company: input.company,
    phone: input.phone,
    email: input.email,
    city: input.city,
    state: input.state,
    origin: input.origin,
    campaignId: input.campaignId,
    interest: input.interest,
    productInterestIds: input.productInterestIds,
    ownerId: input.ownerId,
    notes: input.notes,
    consent,
    consentAt: consent ? (lead.consent ? lead.consentAt : nowIso()) : undefined,
    score: score.score,
    temperature: score.temperature,
  };
  await patchDoc<Lead>(COLLECTIONS.leads, lead, patch);
  const changedScore = score.score !== lead.score;
  await emitEvent({
    type: "lead.updated",
    actor,
    clientId: lead.clientId,
    entity: { type: "lead", id: lead.id },
    title: `Lead atualizado: ${input.name}`,
    description: changedScore ? `Score ${lead.score} → ${score.score} (${score.temperature})` : undefined,
    department: "marketing",
    payload: { score: score.score, temperature: score.temperature },
  });
  if (input.ownerId && input.ownerId !== lead.ownerId && input.ownerId !== actor.id) await notifyLeadAssigned(lead, input.ownerId, actor);
  return { ...lead, ...patch };
}

async function notifyLeadAssigned(lead: Lead, ownerId: string, actor: MarketingActor): Promise<void> {
  await notify({
    userIds: [ownerId],
    kind: "acao",
    title: `Lead atribuído a você: ${lead.name}`,
    body: `${actor.name} passou o lead${lead.company ? ` da ${lead.company}` : ""} para você (${lead.temperature}, score ${lead.score}).`,
    href: `/marketing/leads?lead=${lead.id}`,
    entity: { type: "lead", id: lead.id },
  });
}

export async function assignLead(leadId: string, ownerId: string | undefined, actor: MarketingActor): Promise<Lead> {
  const lead = await loadLead(leadId);
  const owner = ownerId ? await loadActiveUser(ownerId) : null;
  await patchDoc<Lead>(COLLECTIONS.leads, lead, { ownerId: owner?.id });
  await emitEvent({
    type: "lead.updated",
    actor,
    clientId: lead.clientId,
    entity: { type: "lead", id: lead.id },
    title: owner ? `Lead ${lead.name} atribuído a ${owner.name}` : `Lead ${lead.name} sem responsável`,
    department: "marketing",
    payload: { ownerId: owner?.id, previousOwnerId: lead.ownerId },
  });
  if (owner && owner.id !== actor.id && owner.id !== lead.ownerId) await notifyLeadAssigned(lead, owner.id, actor);
  return { ...lead, ownerId: owner?.id };
}

export async function setLeadConsent(leadId: string, consent: boolean, actor: MarketingActor): Promise<Lead> {
  const lead = await loadLead(leadId);
  const consentAt = consent ? nowIso() : undefined;
  await patchDoc<Lead>(COLLECTIONS.leads, lead, { consent, consentAt });
  await emitEvent({
    type: "lead.updated",
    actor,
    clientId: lead.clientId,
    entity: { type: "lead", id: lead.id },
    title: consent ? `Consentimento LGPD registrado para ${lead.name}` : `Consentimento LGPD revogado para ${lead.name}`,
    department: "marketing",
    payload: { consent, consentAt },
  });
  return { ...lead, consent, consentAt };
}

export async function setLeadNextAction(leadId: string, nextAction: string | undefined, nextActionAt: string | undefined, actor: MarketingActor): Promise<Lead> {
  const lead = await loadLead(leadId);
  await patchDoc<Lead>(COLLECTIONS.leads, lead, { nextAction, nextActionAt });
  await emitEvent({
    type: "lead.updated",
    actor,
    clientId: lead.clientId,
    entity: { type: "lead", id: lead.id },
    title: nextAction || nextActionAt ? `Próxima ação do lead ${lead.name}: ${nextAction ?? "sem descrição"}${nextActionAt ? ` em ${formatDateTime(nextActionAt)}` : ""}` : `Próxima ação do lead ${lead.name} removida`,
    department: "marketing",
    payload: { nextAction, nextActionAt },
  });
  return { ...lead, nextAction, nextActionAt };
}

/** Mudanças simples de status (kanban). Qualificar/desqualificar passam pelas funções próprias. */
export async function changeLeadStatus(leadId: string, status: "novo" | "em_contato" | "convertido", actor: MarketingActor): Promise<Lead> {
  const lead = await loadLead(leadId);
  if (lead.status === status) return lead;
  if (status === "convertido" && !lead.opportunityId) throw new MarketingError("Só leads qualificados (com oportunidade criada) podem ser marcados como convertidos");
  if ((lead.status === "qualificado" || lead.status === "convertido") && status !== "convertido") throw new MarketingError("Lead já qualificado: o acompanhamento segue na oportunidade de Vendas");
  if (lead.status === "desqualificado" && lead.duplicateOfId) throw new MarketingError("Lead marcado como duplicado não pode voltar ao funil");
  const patch: Partial<Lead> = { status };
  if (lead.status === "desqualificado") patch.disqualificationReason = undefined;
  await patchDoc<Lead>(COLLECTIONS.leads, lead, patch);
  await emitEvent({
    type: "lead.updated",
    actor,
    clientId: lead.clientId,
    entity: { type: "lead", id: lead.id },
    title: `Lead ${lead.name}: ${LEAD_STATUS_TEXT[lead.status]} → ${LEAD_STATUS_TEXT[status]}`,
    department: "marketing",
    payload: { from: lead.status, to: status },
  });
  return { ...lead, ...patch };
}

const LEAD_STATUS_TEXT: Record<Lead["status"], string> = { novo: "novo", em_contato: "em contato", qualificado: "qualificado", desqualificado: "desqualificado", convertido: "convertido" };

// ---------------------------------------------------------------------------
// Contato, desqualificação e duplicidade
// ---------------------------------------------------------------------------

export async function registerLeadContact(
  input: { leadId: string; channel: LeadContactChannel; note: string; nextAction?: string; nextActionAt?: string },
  actor: MarketingActor,
): Promise<Lead> {
  const lead = await loadLead(input.leadId);
  const now = nowIso();
  await create<Communication>(COLLECTIONS.communications, {
    clientId: lead.clientId,
    channel: COMMUNICATION_CHANNEL[input.channel],
    direction: "saida",
    userId: actor.id,
    entityType: "lead",
    entityId: lead.id,
    body: input.note,
    status: "simulada",
    provider: "mock",
    createdBy: actor.id,
  });
  const patch: Partial<Lead> = { lastContactAt: now };
  if (lead.status === "novo") patch.status = "em_contato";
  if (input.nextAction !== undefined || input.nextActionAt !== undefined) {
    patch.nextAction = input.nextAction;
    patch.nextActionAt = input.nextActionAt;
  }
  await patchDoc<Lead>(COLLECTIONS.leads, lead, patch);
  await emitEvent({
    type: "lead.contacted",
    actor,
    clientId: lead.clientId,
    entity: { type: "lead", id: lead.id },
    title: `${CHANNEL_LABELS[input.channel]} com o lead ${lead.name}`,
    description: input.note,
    department: "marketing",
    payload: { channel: input.channel, leadId: lead.id, statusFrom: lead.status, statusTo: patch.status ?? lead.status },
  });
  return { ...lead, ...patch };
}

export async function disqualifyLead(leadId: string, reason: string, actor: MarketingActor): Promise<Lead> {
  const lead = await loadLead(leadId);
  if (lead.opportunityId || lead.status === "convertido") throw new MarketingError("Este lead já tem oportunidade em Vendas; trate a perda na oportunidade");
  await patchDoc<Lead>(COLLECTIONS.leads, lead, { status: "desqualificado", disqualificationReason: reason, nextAction: undefined, nextActionAt: undefined });
  await emitEvent({
    type: "lead.disqualified",
    actor,
    clientId: lead.clientId,
    entity: { type: "lead", id: lead.id },
    title: `Lead desqualificado: ${lead.name}`,
    description: `Motivo: ${reason}`,
    department: "marketing",
    payload: { reason, from: lead.status },
  });
  return { ...lead, status: "desqualificado", disqualificationReason: reason };
}

/** Marca o lead como duplicado de outro (sai do funil como desqualificado). */
export async function markLeadDuplicate(leadId: string, originalId: string, actor: MarketingActor): Promise<Lead> {
  if (leadId === originalId) throw new MarketingError("Escolha outro lead como original");
  const [lead, original] = await Promise.all([loadLead(leadId), loadLead(originalId)]);
  if (original.duplicateOfId === lead.id) throw new MarketingError("O lead escolhido já está marcado como duplicado deste");
  if (lead.opportunityId) throw new MarketingError("Este lead já tem oportunidade em Vendas; marque o outro como duplicado");
  const reason = `Duplicado de ${original.name}${original.company ? ` (${original.company})` : ""}`;
  await patchDoc<Lead>(COLLECTIONS.leads, lead, { duplicateOfId: original.id, status: "desqualificado", disqualificationReason: reason, nextAction: undefined, nextActionAt: undefined });
  await emitEvent({
    type: "lead.disqualified",
    actor,
    clientId: lead.clientId,
    entity: { type: "lead", id: lead.id },
    title: `Lead ${lead.name} marcado como duplicado`,
    description: reason,
    department: "marketing",
    payload: { reason, duplicateOfId: original.id, from: lead.status },
  });
  return { ...lead, duplicateOfId: original.id, status: "desqualificado", disqualificationReason: reason };
}

// ---------------------------------------------------------------------------
// Passagem para Vendas (MQL → cliente + oportunidade + jornada + tarefa)
// ---------------------------------------------------------------------------

/**
 * Vendedor da vez (round-robin): entre os usuários ativos de Vendas, quem recebeu oportunidade vinda
 * do Marketing há mais tempo (ou nunca recebeu).
 */
export async function pickSeller(): Promise<User | null> {
  const [users, opportunities] = await Promise.all([
    list<User>(COLLECTIONS.users, { where: [["departmentId", "==", "vendas"]] }),
    list<Opportunity>(COLLECTIONS.opportunities, { where: [["originDepartment", "==", "marketing"]] }),
  ]);
  const sellers = users.filter((u) => u.active !== false);
  if (sellers.length === 0) return null;
  const lastReceived = new Map<string, string>();
  for (const o of opportunities) if ((lastReceived.get(o.ownerId) ?? "") < o.createdAt) lastReceived.set(o.ownerId, o.createdAt);
  sellers.sort((a, b) => (lastReceived.get(a.id) ?? "").localeCompare(lastReceived.get(b.id) ?? "") || a.name.localeCompare(b.name, "pt-BR"));
  return sellers[0];
}

export interface HandoffContact {
  name: string;
  company?: string;
  phone?: string;
  email?: string;
  city?: string;
  state?: string;
  origin: string;
  campaignId?: string;
  interest?: string;
  productInterestIds: string[];
  temperature: Lead["temperature"];
  leadId?: string;
  score?: number;
  consent?: boolean;
}

export interface HandoffResult {
  client: Client;
  reusedClient: boolean;
  opportunity: Opportunity;
  task: Task | null;
  workflowInstanceId?: string;
  workflowStepId?: string;
  /** Problemas não fatais (ex.: jornada não avançou), para exibir ao usuário. */
  warnings: string[];
}

/**
 * Cria (ou reaproveita) o cliente, a oportunidade, a jornada em Vendas e a tarefa de primeiro contato.
 * Usado pelo Qualificar (gate de MQL) e pela conversão direta de prospects.
 */
export async function handoffToSales(contact: HandoffContact, seller: User, actor: MarketingActor, options: { exceptionReason: string }): Promise<HandoffResult> {
  const warnings: string[] = [];
  const now = nowIso();

  // 1) Cliente: reaproveita por telefone/e-mail/empresa; senão cria como prospect.
  const match = await findMatchingClient(contact);
  let client: Client;
  if (match) {
    client = match.client;
    const patch: Partial<Client> = {};
    if (!client.leadId && contact.leadId) patch.leadId = contact.leadId;
    if (!client.ownerSalesId) patch.ownerSalesId = seller.id;
    if (client.status === "lead") patch.status = "prospect";
    if (Object.keys(patch).length > 0) {
      await update<Client>(COLLECTIONS.clients, client.id, patch);
      client = { ...client, ...patch };
    }
    if (patch.status) {
      await emitEvent({
        type: "client.status_changed",
        actor,
        clientId: client.id,
        entity: { type: "client", id: client.id },
        title: "Status do cliente: lead → prospect",
        description: "Lead qualificado pelo Marketing (MQL)",
        department: "marketing",
        payload: { from: "lead", to: "prospect" },
      });
    }
  } else {
    const displayName = contact.company ?? contact.name;
    client = await create<Client>(COLLECTIONS.clients, {
      legalName: displayName,
      tradeName: displayName,
      status: "prospect",
      origin: contact.origin,
      campaignId: contact.campaignId,
      leadId: contact.leadId,
      phone: contact.phone,
      whatsapp: contact.phone,
      email: contact.email,
      address: { city: contact.city, state: contact.state },
      ownerSalesId: seller.id,
      mrr: 0,
      tags: ["marketing"],
      currentStage: "vendas",
      createdBy: actor.id,
    });
    await emitEvent({
      type: "client.created",
      actor,
      clientId: client.id,
      entity: { type: "client", id: client.id },
      title: `Cliente ${client.tradeName} cadastrado a partir do Marketing`,
      description: `Status inicial: Prospect · origem: ${contact.origin}`,
      department: "marketing",
      payload: { status: client.status, origin: client.origin, leadId: contact.leadId },
    });
    if (contact.company) {
      const person = await create<Contact>(COLLECTIONS.contacts, {
        clientId: client.id,
        name: contact.name,
        phone: contact.phone,
        whatsapp: contact.phone,
        email: contact.email,
        isPrimary: true,
        createdBy: actor.id,
      });
      await emitEvent({
        type: "contact.created",
        actor,
        clientId: client.id,
        entity: { type: "contact", id: person.id },
        title: `Contato adicionado: ${person.name}`,
        department: "marketing",
        payload: { isPrimary: true },
      });
    }
  }

  // 2) Oportunidade com os produtos de interesse e valores do catálogo.
  const products = await getManyByIds<Product>(COLLECTIONS.products, contact.productInterestIds);
  const lines: OpportunityProduct[] = contact.productInterestIds
    .map((id) => products.get(id))
    .filter((p): p is Product => Boolean(p))
    .map((p) => ({ productId: p.id, productName: p.name, quantity: 1, setupValue: p.setupPrice, monthlyValue: p.monthlyPrice, hardwareValue: p.hardwarePrice }));
  const holidays = await getHolidays();
  const nextActionAt = addBusinessHours(new Date(now), 10, holidays).toISOString(); // +1 dia útil
  const existingCustomer = match !== null && ["ativo", "em_implantacao", "inativo"].includes(client.status);
  const opportunity = await create<Opportunity>(COLLECTIONS.opportunities, {
    clientId: client.id,
    leadId: contact.leadId,
    title: `${existingCustomer ? "Cross-sell" : "Nova venda"} — ${client.tradeName}`,
    stage: "qualificacao",
    stageChangedAt: now,
    ownerId: seller.id,
    temperature: contact.temperature,
    probability: 10,
    products: lines,
    setupTotal: lines.reduce((s, l) => s + l.setupValue, 0),
    monthlyTotal: lines.reduce((s, l) => s + l.monthlyValue, 0),
    hardwareTotal: lines.reduce((s, l) => s + l.hardwareValue, 0),
    need: contact.interest,
    nextAction: "Primeiro contato",
    nextActionAt,
    lastActivityAt: now,
    originDepartment: "marketing",
    originUserId: actor.id,
    kind: existingCustomer ? "cross_sell" : "nova_venda",
    createdBy: actor.id,
  });
  await emitEvent({
    type: "opportunity.created",
    actor,
    clientId: client.id,
    entity: { type: "opportunity", id: opportunity.id },
    title: `Oportunidade criada para ${seller.name}: ${opportunity.title}`,
    description: lines.length ? `Produtos: ${lines.map((l) => l.productName).join(", ")}` : contact.interest,
    department: "marketing",
    payload: { source: "marketing", ownerId: seller.id, leadId: contact.leadId, kind: opportunity.kind, monthlyTotal: opportunity.monthlyTotal, setupTotal: opportunity.setupTotal, nextActionLabel: formatDateTime(nextActionAt) },
  });

  // 3) Jornada: nova em Vendas, ou conclui o gate de Marketing de uma jornada existente.
  let workflowInstanceId: string | undefined;
  let workflowStepId: string | undefined;
  try {
    let instance = client.workflowInstanceId ? await getById<WorkflowInstance>(COLLECTIONS.workflowInstances, client.workflowInstanceId) : null;
    if (!instance) {
      // Lead do Marketing: a jornada nasce em Marketing e o gate de MQL é concluído logo abaixo, para a
      // jornada registrar as 6 etapas. Contato de prospecção (sem lead) começa direto em Vendas.
      const created = await createWorkflowInstanceForClient({
        clientId: client.id,
        clientName: client.tradeName,
        startStageKey: contact.leadId ? "marketing" : "vendas",
        skipInitialAutoTasks: Boolean(contact.leadId),
        actor,
        context: { leadId: contact.leadId, opportunityId: opportunity.id },
      });
      workflowInstanceId = created.instance.id;
      workflowStepId = created.step.id;
      instance = created.instance.currentStageKey === "marketing" ? { ...created.instance, currentStepId: created.step.id } : null;
    }
    if (instance && instance.status === "ativo") {
      workflowInstanceId = instance.id;
      await update<WorkflowInstance>(COLLECTIONS.workflowInstances, instance.id, { context: { ...instance.context, leadId: contact.leadId ?? instance.context.leadId, opportunityId: opportunity.id } });
      workflowStepId = instance.currentStepId;
      if (instance.currentStageKey === "marketing" && instance.currentStepId) {
        const step = await getById<WorkflowStep>(COLLECTIONS.workflowSteps, instance.currentStepId);
        if (step && step.status !== "concluida" && step.status !== "pulada") {
          const input = {
            stepId: step.id,
            actor,
            fields: {
              "lead.phone": contact.phone ?? contact.email,
              "lead.interest": contact.interest ?? lines.map((l) => l.productName).join(", "),
              "lead.consent": contact.consent === true ? true : undefined,
              "lead.score": contact.score,
            },
            checklist: step.checklist.map((c) => ({ id: c.id, done: true })),
            notes: `Gate de MQL validado no Marketing por ${actor.name}.`,
          };
          let result = await completeGate(input);
          if (result.status === "blocked") result = await completeGate({ ...input, system: true, exceptionReason: options.exceptionReason });
          if (result.status === "completed") workflowStepId = result.nextStep?.id;
          else warnings.push("A etapa de Marketing da jornada não pôde ser concluída automaticamente.");
        }
      }
    } else if (instance) {
      workflowInstanceId = instance.id;
    }
  } catch (error) {
    console.error("[marketing] falha ao iniciar/avançar a jornada", error);
    warnings.push(`Jornada do cliente não atualizada: ${error instanceof Error ? error.message : "erro desconhecido"}`);
  }

  // 4) Tarefa de primeiro contato para o vendedor.
  let task: Task | null = null;
  try {
    task = await createTaskInternal(
      {
        title: `Primeiro contato: ${client.tradeName}`,
        description: `${contact.leadId ? "MQL recebido do Marketing" : "Contato convertido da prospecção ativa"}. ${contact.name}${contact.phone ? ` · ${contact.phone}` : ""}${contact.email ? ` · ${contact.email}` : ""}${contact.interest ? `. Interesse: ${contact.interest}` : ""}`,
        clientId: client.id,
        assigneeId: seller.id,
        departmentId: "vendas",
        priority: contact.temperature === "quente" ? "alta" : "media",
        dueAt: nextActionAt,
        processType: "opportunity",
        processId: opportunity.id,
        origin: "evento",
        tags: ["marketing", "primeiro-contato"],
      },
      actor,
    );
  } catch (error) {
    console.error("[marketing] falha ao criar tarefa do vendedor", error);
    warnings.push("Tarefa de primeiro contato não criada.");
  }

  return { client, reusedClient: match !== null, opportunity, task, workflowInstanceId, workflowStepId, warnings };
}

export type QualifyResult = { ok: true; lead: Lead; handoff: HandoffResult; seller: User } | { ok: false; missing: string[]; minScore: number };

/** Executa o gate de MQL e, se passar, faz a passagem para Vendas. */
export async function qualifyLead(leadId: string, sellerId: string | undefined, actor: MarketingActor): Promise<QualifyResult> {
  const lead = await loadLead(leadId);
  if (lead.status === "qualificado" || lead.status === "convertido" || lead.opportunityId) throw new MarketingError("Este lead já foi qualificado e passado para Vendas");
  if (lead.status === "desqualificado") throw new MarketingError("Lead desqualificado: volte-o para o funil antes de qualificar");

  const rules = await getScoringRules();
  const gate = evaluateMqlGate(lead, rules);
  if (!gate.ok) return { ok: false, missing: gate.missing, minScore: gate.minScore };

  const seller = sellerId ? await loadActiveUser(sellerId, "Vendedor") : await pickSeller();
  if (!seller) throw new MarketingError("Nenhum vendedor ativo para receber a oportunidade");

  const handoff = await handoffToSales(
    {
      name: lead.name,
      company: lead.company,
      phone: lead.phone,
      email: lead.email,
      city: lead.city,
      state: lead.state,
      origin: lead.origin,
      campaignId: lead.campaignId,
      interest: lead.interest,
      productInterestIds: lead.productInterestIds ?? [],
      temperature: lead.temperature,
      leadId: lead.id,
      score: lead.score,
      consent: lead.consent,
    },
    seller,
    actor,
    { exceptionReason: "Gate de MQL validado no módulo de Marketing" },
  );

  await attachLeadHistoryToClient(lead.id, handoff.client.id);

  const qualifiedAt = nowIso();
  const patch: Partial<Lead> = { status: "qualificado", qualifiedAt, clientId: handoff.client.id, opportunityId: handoff.opportunity.id, nextAction: undefined, nextActionAt: undefined };
  await patchDoc<Lead>(COLLECTIONS.leads, lead, patch);
  await emitEvent({
    type: "lead.qualified",
    actor,
    clientId: handoff.client.id,
    entity: { type: "lead", id: lead.id },
    title: `Lead qualificado (MQL): ${lead.name}`,
    description: `Score ${lead.score} (${lead.temperature}) · oportunidade com ${seller.name}${handoff.reusedClient ? " · cliente existente vinculado" : ""}`,
    department: "marketing",
    payload: { score: lead.score, temperature: lead.temperature, sellerId: seller.id, opportunityId: handoff.opportunity.id, reusedClient: handoff.reusedClient, leadOwnerId: lead.ownerId },
  });

  return { ok: true, lead: { ...lead, ...patch }, handoff, seller };
}

/**
 * Leva para a timeline do cliente o histórico do lead anterior à qualificação (lead criado, contatos,
 * mudanças), que foi emitido sem clientId. Os eventos originais não mudam; só a projeção na timeline.
 * Idempotente: ignora eventos que já estão na timeline do cliente.
 */
async function attachLeadHistoryToClient(leadId: string, clientId: string): Promise<void> {
  const [events, existing] = await Promise.all([
    list<DomainEvent>(COLLECTIONS.events, { where: [["entityId", "==", leadId]] }),
    list<TimelineEvent>(COLLECTIONS.timelineEvents, { where: [["clientId", "==", clientId]] }),
  ]);
  const known = new Set(existing.map((t) => t.eventId));
  for (const e of events) {
    if (e.entityType !== "lead" || e.clientId || known.has(e.id)) continue;
    await create<TimelineEvent>(COLLECTIONS.timelineEvents, {
      clientId,
      eventId: e.id,
      type: e.type,
      occurredAt: e.occurredAt,
      actorId: e.actorId,
      actorName: e.actorName,
      title: e.title,
      description: e.description,
      entityType: e.entityType,
      entityId: e.entityId,
      department: e.department,
    });
  }
}

// ---------------------------------------------------------------------------
// Importação e webhook
// ---------------------------------------------------------------------------

export interface ImportReport {
  created: { line: number; id: string; name: string }[];
  duplicates: { line: number; name: string; reason: string }[];
  invalid: { line: number; error: string }[];
}

export async function importLeads(
  input: { rows: ImportRow[]; defaultOrigin: string; campaignId?: string; ownerId?: string; consent: boolean },
  actor: MarketingActor,
): Promise<ImportReport> {
  if (input.ownerId) await loadActiveUser(input.ownerId);
  const [rules, existing, sources, catalog] = await Promise.all([getScoringRules(), list<Lead>(COLLECTIONS.leads), list<LeadSource>(COLLECTIONS.leadSources), list<Product>(COLLECTIONS.products)]);
  const originKey = (value: string | undefined) => {
    const target = normalize(value);
    if (!target) return input.defaultOrigin;
    return sources.find((s) => normalize(s.key) === target || normalize(s.name) === target)?.key ?? input.defaultOrigin;
  };
  const known = [...existing];
  const report: ImportReport = { created: [], duplicates: [], invalid: [] };

  for (const [index, row] of input.rows.entries()) {
    const line = index + 2; // linha 1 = cabeçalho
    if (!Object.values(row).some((v) => v && v.trim())) continue;
    const parsed = createLeadSchema.safeParse({
      name: row.nome ?? "",
      company: row.empresa,
      phone: row.telefone,
      email: row.email,
      city: row.cidade,
      origin: originKey(row.origem),
      interest: row.interesse,
      productInterestIds: await productsFromInterest(row.interesse, catalog),
      campaignId: input.campaignId,
      ownerId: input.ownerId,
      consent: input.consent,
    });
    if (!parsed.success) {
      report.invalid.push({ line, error: parsed.error.issues[0]?.message ?? "Linha inválida" });
      continue;
    }
    const dup = matchLeadDuplicates({ phone: parsed.data.phone, email: parsed.data.email }, known)[0];
    if (dup) {
      report.duplicates.push({ line, name: parsed.data.name, reason: `${dup.reasons.join(" e ")} de ${dup.name}` });
      continue;
    }
    const lead = await createLead(parsed.data, actor, { source: "importacao", rules });
    known.push(lead);
    report.created.push({ line, id: lead.id, name: lead.name });
  }
  return report;
}

const WEBHOOK_ACTOR: MarketingActor = { id: "webhook", name: "Webhook de leads" };

/** Lead recebido pelo webhook (site, formulários, Meta Lead Ads via integrador). */
export async function createLeadFromWebhook(payload: WebhookLeadInput): Promise<{ lead: Lead; duplicates: LeadDuplicate[] }> {
  if (!payload.telefone && !payload.email) throw new MarketingError("Informe telefone ou email");
  const [origin, campaignId, productInterestIds] = await Promise.all([resolveOriginKey(payload.origem, "site"), resolveCampaignId(payload.campanha), productsFromInterest(payload.interesse)]);
  const duplicates = await findLeadDuplicates({ phone: payload.telefone, email: payload.email });
  const lead = await createLead(
    {
      name: payload.nome,
      company: payload.empresa,
      phone: payload.telefone,
      email: payload.email,
      city: payload.cidade,
      origin,
      campaignId,
      interest: payload.interesse,
      productInterestIds,
      consent: payload.consentimento,
      notes: duplicates.length ? `Possível duplicidade com: ${duplicates.map((d) => d.name).join(", ")}` : undefined,
    } as CreateLeadInput,
    WEBHOOK_ACTOR,
    { source: "webhook" },
  );
  return { lead, duplicates };
}

// ---------------------------------------------------------------------------
// Caixa de entrada
// ---------------------------------------------------------------------------

export async function assumeInboxItem(kind: "lead" | "message", id: string, actor: MarketingActor): Promise<void> {
  if (kind === "lead") {
    const lead = await loadLead(id);
    if (lead.ownerId && lead.ownerId !== actor.id) {
      const owner = await getById<User>(COLLECTIONS.users, lead.ownerId);
      throw new MarketingError(`Este lead já está com ${owner?.name ?? "outra pessoa"}`);
    }
    await assignLead(lead.id, actor.id, actor);
    return;
  }
  const message = await getById<Communication>(COLLECTIONS.communications, id);
  if (!message || message.direction !== "entrada") throw new MarketingError("Mensagem não encontrada");
  if (message.userId && message.userId !== actor.id) {
    const owner = await getById<User>(COLLECTIONS.users, message.userId);
    throw new MarketingError(`Esta conversa já está com ${owner?.name ?? "outra pessoa"}`);
  }
  await update<Communication>(COLLECTIONS.communications, message.id, { userId: actor.id });
  if (message.entityType === "lead" && message.entityId) {
    const lead = await getById<Lead>(COLLECTIONS.leads, message.entityId);
    if (lead && !lead.ownerId) await assignLead(lead.id, actor.id, actor);
  }
}

/** Resposta simulada pelo adaptador de canal (provider mock). */
export async function replyToInbox(input: { communicationId?: string; leadId?: string; channel: "whatsapp" | "email"; body: string }, actor: MarketingActor): Promise<Communication> {
  const original = input.communicationId ? await getById<Communication>(COLLECTIONS.communications, input.communicationId) : null;
  if (input.communicationId && !original) throw new MarketingError("Mensagem não encontrada");
  const leadId = input.leadId ?? (original?.entityType === "lead" ? original.entityId : undefined);
  const lead = leadId ? await loadLead(leadId) : null;
  const clientId = original?.clientId ?? lead?.clientId;
  const client = clientId ? await getById<Client>(COLLECTIONS.clients, clientId) : null;
  const to = input.channel === "whatsapp" ? (lead?.phone ?? client?.whatsapp ?? client?.phone) : (lead?.email ?? client?.email);
  if (!to && !original) throw new MarketingError(input.channel === "whatsapp" ? "O lead não tem telefone cadastrado" : "O lead não tem e-mail cadastrado");

  const sent = await getChannelAdapter().sendMessage({
    channel: input.channel,
    to,
    body: input.body,
    clientId: client?.id,
    contactId: original?.contactId,
    entity: lead ? { type: "lead", id: lead.id } : original?.entityType && original.entityId ? { type: original.entityType, id: original.entityId } : undefined,
    sender: actor,
  });
  if (original) await update<Communication>(COLLECTIONS.communications, original.id, { status: "lida", userId: original.userId ?? actor.id });

  if (lead) {
    const patch: Partial<Lead> = { lastContactAt: nowIso() };
    if (lead.status === "novo") patch.status = "em_contato";
    if (!lead.ownerId) patch.ownerId = actor.id;
    await patchDoc<Lead>(COLLECTIONS.leads, lead, patch);
    await emitEvent({
      type: "lead.contacted",
      actor,
      clientId: lead.clientId,
      entity: { type: "lead", id: lead.id },
      title: `${input.channel === "whatsapp" ? "WhatsApp" : "E-mail"} respondido para o lead ${lead.name} (simulado)`,
      description: input.body,
      department: "marketing",
      payload: { channel: input.channel, communicationId: sent.id, simulated: true },
      // O WhatsApp já entra na timeline pelo evento do adaptador.
      timeline: input.channel !== "whatsapp",
    });
  } else if (input.channel === "email" && client) {
    await emitEvent({
      type: "note.added",
      actor,
      clientId: client.id,
      entity: { type: "communication", id: sent.id },
      title: `E-mail enviado para ${client.tradeName} (simulado)`,
      description: input.body,
      department: "marketing",
      payload: { channel: "email", communicationId: sent.id, simulated: true },
    });
  }
  return sent;
}

// ---------------------------------------------------------------------------
// Campanhas
// ---------------------------------------------------------------------------

export async function saveCampaign(
  input: { id?: string; name: string; channel: string; startDate: string; endDate?: string; budget: number; spent: number; status: Campaign["status"]; ownerId?: string },
  actor: MarketingActor,
): Promise<Campaign> {
  if (input.ownerId) await loadActiveUser(input.ownerId);
  const data = {
    name: input.name,
    channel: input.channel,
    startDate: input.startDate,
    endDate: input.endDate,
    budget: input.budget,
    spent: input.spent,
    status: input.status,
    ownerId: input.ownerId,
  };
  if (input.id) {
    const current = await getById<Campaign>(COLLECTIONS.campaigns, input.id);
    if (!current) throw new MarketingError("Campanha não encontrada");
    await patchDoc<Campaign>(COLLECTIONS.campaigns, current, data);
    return { ...current, ...data };
  }
  return create<Campaign>(COLLECTIONS.campaigns, { ...data, endDate: input.endDate, ownerId: input.ownerId ?? actor.id, createdBy: actor.id });
}

// ---------------------------------------------------------------------------
// Prospecção ativa
// ---------------------------------------------------------------------------

async function loadProspectList(id: string): Promise<ProspectList> {
  const item = await getById<ProspectList>(COLLECTIONS.prospectLists, id);
  if (!item) throw new MarketingError("Lista de prospecção não encontrada");
  return item;
}

async function loadProspect(id: string): Promise<Prospect> {
  const item = await getById<Prospect>(COLLECTIONS.prospects, id);
  if (!item) throw new MarketingError("Contato não encontrado");
  return item;
}

export async function createProspectList(
  input: { name: string; description?: string; segment?: string; ownerId?: string; campaignId?: string } & ProspectListPlanning,
  actor: MarketingActor,
): Promise<ProspectList> {
  if (input.ownerId) await loadActiveUser(input.ownerId);
  return create<ProspectListExtended>(COLLECTIONS.prospectLists, {
    name: input.name,
    description: input.description,
    segment: input.segment,
    ownerId: input.ownerId ?? actor.id,
    campaignId: input.campaignId,
    status: "ativa",
    totals: { contacts: 0, attempts: 0, responses: 0, opportunities: 0 },
    objective: input.objective,
    startDate: input.startDate,
    endDate: input.endDate,
    optOut: input.optOut,
    createdBy: actor.id,
  });
}

/** Atualiza nome, segmento e o planejamento da lista (objetivo, período, opt-out). Campos vazios são limpos. */
export async function updateProspectList(
  input: { listId: string; name?: string; description?: string; segment?: string } & ProspectListPlanning,
  actor: MarketingActor,
): Promise<ProspectList> {
  const current = (await loadProspectList(input.listId)) as ProspectListExtended;
  const patch: Partial<ProspectListExtended> = {
    name: input.name ?? current.name,
    description: input.description,
    segment: input.segment,
    objective: input.objective,
    startDate: input.startDate,
    endDate: input.endDate,
    optOut: input.optOut ?? current.optOut,
  };
  const saved = await patchDoc<ProspectListExtended>(COLLECTIONS.prospectLists, current, patch);
  await emitEvent({
    type: "prospect_list.updated",
    actor,
    entity: { type: "prospect_list", id: current.id },
    title: `Lista de prospecção "${saved.name}" atualizada`,
    description: [saved.objective ? `Objetivo: ${saved.objective}` : null, saved.startDate || saved.endDate ? `Período: ${saved.startDate ?? "—"} a ${saved.endDate ?? "—"}` : null].filter(Boolean).join(" · ") || undefined,
    department: "marketing",
    payload: { listId: current.id, objective: saved.objective, startDate: saved.startDate, endDate: saved.endDate, optOut: saved.optOut },
  });
  return saved;
}

export async function setProspectListStatus(listId: string, status: ProspectList["status"]): Promise<void> {
  await loadProspectList(listId);
  await update<ProspectList>(COLLECTIONS.prospectLists, listId, { status });
}

export async function importProspects(listId: string, rows: ProspectRow[], actor: MarketingActor): Promise<ImportReport> {
  const target = await loadProspectList(listId);
  const existing = await list<Prospect>(COLLECTIONS.prospects, { where: [["listId", "==", listId]] });
  const phones = new Set(existing.map((p) => phoneKey(p.phone)).filter(Boolean));
  const emails = new Set(existing.map((p) => normalize(p.email)).filter(Boolean));
  const report: ImportReport = { created: [], duplicates: [], invalid: [] };

  for (const [index, row] of rows.entries()) {
    const line = index + 2;
    if (!Object.values(row).some((v) => v && v.trim())) continue;
    const name = (row.nome ?? "").trim() || (row.empresa ?? "").trim();
    const phone = phoneKey(row.telefone);
    const email = normalize(row.email);
    if (!name) {
      report.invalid.push({ line, error: "Informe nome ou empresa" });
      continue;
    }
    if (phone && (phone.length < 10 || phone.length > 11)) {
      report.invalid.push({ line, error: "Telefone inválido (use DDD + número)" });
      continue;
    }
    if (email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
      report.invalid.push({ line, error: "E-mail inválido" });
      continue;
    }
    if (!phone && !email) {
      report.invalid.push({ line, error: "Informe telefone ou e-mail" });
      continue;
    }
    if ((phone && phones.has(phone)) || (email && emails.has(email))) {
      report.duplicates.push({ line, name, reason: phone && phones.has(phone) ? "telefone já está na lista" : "e-mail já está na lista" });
      continue;
    }
    const prospect = await create<Prospect>(COLLECTIONS.prospects, {
      listId,
      name,
      company: row.empresa?.trim() || undefined,
      phone: phone || undefined,
      email: email || undefined,
      city: row.cidade?.trim() || undefined,
      ownerId: target.ownerId,
      status: "novo",
      attempts: 0,
      createdBy: actor.id,
    });
    if (phone) phones.add(phone);
    if (email) emails.add(email);
    report.created.push({ line, id: prospect.id, name });
  }
  await recomputeProspectListTotals(listId);
  return report;
}

export async function assignProspects(listId: string, prospectIds: string[], ownerId: string, actor: MarketingActor): Promise<number> {
  const [owner, prospects] = await Promise.all([loadActiveUser(ownerId), list<Prospect>(COLLECTIONS.prospects, { where: [["listId", "==", listId]] })]);
  const ids = new Set(prospectIds);
  const targets = prospects.filter((p) => ids.has(p.id));
  await Promise.all(targets.map((p) => update<Prospect>(COLLECTIONS.prospects, p.id, { ownerId: owner.id })));
  if (targets.length > 0 && owner.id !== actor.id) {
    const plist = await loadProspectList(listId);
    await notify({
      userIds: [owner.id],
      kind: "acao",
      title: `${targets.length} contato(s) de prospecção atribuídos a você`,
      body: `Lista "${plist.name}" · por ${actor.name}`,
      href: `/marketing/prospeccao/${listId}`,
      entity: { type: "prospect_list", id: listId },
    });
  }
  return targets.length;
}

const ATTEMPT_STATUS: Record<ProspectAttemptResult, Prospect["status"]> = { sem_resposta: "tentativa", respondeu: "contatado", interessado: "respondeu", descartado: "descartado" };
export const ATTEMPT_RESULT_LABELS: Record<ProspectAttemptResult, string> = { sem_resposta: "Sem resposta", respondeu: "Respondeu", interessado: "Interessado", descartado: "Descartado" };

export async function recordProspectAttempt(
  input: { prospectId: string; channel: LeadContactChannel; result: ProspectAttemptResult; note?: string; nextActionAt?: string },
  actor: MarketingActor,
): Promise<Prospect> {
  const prospect = await loadProspect(input.prospectId);
  if (prospect.status === "convertido") throw new MarketingError("Contato já convertido");
  const now = nowIso();
  const patch: Partial<Prospect> = {
    attempts: (prospect.attempts ?? 0) + 1,
    lastAttemptAt: now,
    status: ATTEMPT_STATUS[input.result],
    result: `${CHANNEL_LABELS[input.channel]}: ${ATTEMPT_RESULT_LABELS[input.result]}${input.note ? ` — ${input.note}` : ""}`,
    nextActionAt: input.result === "descartado" ? undefined : input.nextActionAt,
  };
  if (!prospect.ownerId) patch.ownerId = actor.id;
  await patchDoc<Prospect>(COLLECTIONS.prospects, prospect, patch);
  await emitEvent({
    type: "prospect.contacted",
    actor,
    entity: { type: "prospect", id: prospect.id },
    title: `Tentativa de contato com ${prospect.name}${prospect.company && prospect.company !== prospect.name ? ` (${prospect.company})` : ""}: ${ATTEMPT_RESULT_LABELS[input.result]}`,
    description: input.note,
    department: "marketing",
    payload: { listId: prospect.listId, channel: input.channel, result: input.result, attempts: patch.attempts },
  });
  return { ...prospect, ...patch };
}

export async function scheduleProspectAction(prospectId: string, nextActionAt: string, note: string | undefined): Promise<Prospect> {
  const prospect = await loadProspect(prospectId);
  const patch: Partial<Prospect> = { nextActionAt };
  if (note) patch.result = note;
  await patchDoc<Prospect>(COLLECTIONS.prospects, prospect, patch);
  return { ...prospect, ...patch };
}

export type ProspectConversion = { target: "lead"; lead: Lead } | { target: "oportunidade"; handoff: HandoffResult; seller: User };

export async function convertProspect(
  input: { prospectId: string; target: "lead" | "oportunidade"; sellerId?: string; interest?: string; productInterestIds: string[]; consent: boolean },
  actor: MarketingActor,
): Promise<ProspectConversion> {
  const prospect = await loadProspect(input.prospectId);
  if (prospect.leadId || prospect.opportunityId) throw new MarketingError("Este contato já foi convertido");
  const plist = await loadProspectList(prospect.listId);
  const productInterestIds = input.productInterestIds.length ? input.productInterestIds : await productsFromInterest(input.interest);

  if (input.target === "lead") {
    const lead = await createLead(
      {
        name: prospect.name,
        company: prospect.company,
        phone: prospect.phone,
        email: prospect.email,
        city: prospect.city,
        origin: "lista",
        campaignId: plist.campaignId,
        interest: input.interest,
        productInterestIds,
        ownerId: prospect.ownerId,
        consent: input.consent,
        notes: `Convertido da lista de prospecção "${plist.name}".${prospect.result ? ` Último resultado: ${prospect.result}` : ""}`,
      } as CreateLeadInput,
      actor,
      { source: "prospeccao" },
    );
    await patchDoc<Prospect>(COLLECTIONS.prospects, prospect, { leadId: lead.id, status: "convertido", nextActionAt: undefined });
    await recomputeProspectListTotals(prospect.listId);
    return { target: "lead", lead };
  }

  const seller = input.sellerId ? await loadActiveUser(input.sellerId, "Vendedor") : await pickSeller();
  if (!seller) throw new MarketingError("Nenhum vendedor ativo para receber a oportunidade");
  const handoff = await handoffToSales(
    {
      name: prospect.name,
      company: prospect.company,
      phone: prospect.phone,
      email: prospect.email,
      city: prospect.city,
      origin: "lista",
      campaignId: plist.campaignId,
      interest: input.interest,
      productInterestIds,
      temperature: "morno",
      consent: input.consent,
    },
    seller,
    actor,
    { exceptionReason: `Convertido diretamente da prospecção ativa (lista "${plist.name}")` },
  );
  await patchDoc<Prospect>(COLLECTIONS.prospects, prospect, { opportunityId: handoff.opportunity.id, status: "convertido", nextActionAt: undefined });
  await recomputeProspectListTotals(prospect.listId);
  return { target: "oportunidade", handoff, seller };
}
