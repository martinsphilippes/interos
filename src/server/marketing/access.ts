import "server-only";
/**
 * Autorização do módulo de Marketing (A5/A7/A29): capacidades para a interface e escopo de dados por tela.
 *
 * Escopo (catálogo src/domain/permissions/marketing.ts; padrão "empresa" para todos = comportamento anterior):
 *  - Leads (marketing.leads, e também os agregados da Visão Geral e os leads novos da Caixa de Entrada): dono =
 *    `lead.ownerId`. Leads SEM dono continuam visíveis com escopo restrito para quem pode distribuí-los
 *    (marketing.leads.atribuir ou marketing.caixa-de-entrada.assumir) — a fila de captação não some.
 *  - Campanhas: dono = `campaign.ownerId`.
 *  - Prospecção: a lista entra quando o dono da lista está no escopo ou quando algum contato dela é de alguém do
 *    escopo; o contato entra quando o dono dele OU o dono da lista está no escopo.
 *  - Caixa de Entrada: mensagem entra quando o atendente, o dono do lead ou o dono comercial/CS do cliente está no
 *    escopo; mensagem sem nenhum dono é fila (visível a quem pode assumir).
 * Detalhe por id e actions sobre um registro fora do escopo: página trata como inexistente; action = PermissionError.
 */
import { can } from "@/server/auth/permissions";
import { PermissionError } from "@/server/auth/error-classes";
import { resolveDataScope, scopeAllows, type DataScope } from "@/server/auth/scope";
import { getById, list } from "@/server/db";
import { COLLECTIONS, type Campaign, type Client, type Communication, type CurrentUser, type Lead, type Prospect, type ProspectList } from "@/domain/types";
import type { MarketingCapabilities } from "@/components/marketing/access-model";

export const MARKETING_SCREENS = {
  overview: "marketing.visao-geral",
  leads: "marketing.leads",
  campaigns: "marketing.campanhas",
  inbox: "marketing.caixa-de-entrada",
  prospect: "marketing.prospeccao",
} as const;

type MarketingScreen = (typeof MARKETING_SCREENS)[keyof typeof MARKETING_SCREENS];

/** Recorte já resolvido (puro nas funções de filtro). */
export type ScopeCut = Pick<DataScope, "userIds" | "departmentKeys" | "poolUnassigned">;

export interface LeadAccess {
  scope: ScopeCut;
  /** Vê os leads sem dono mesmo com escopo restrito (quem distribui a fila). */
  pool: boolean;
}

/** Escopo "empresa" (sem recorte). */
export const FULL_SCOPE: ScopeCut = { poolUnassigned: false };

// ---------------------------------------------------------------------------
// Capacidades (interface)
// ---------------------------------------------------------------------------

export function marketingCapabilities(user: CurrentUser): MarketingCapabilities {
  return {
    leads: {
      create: can(user, "marketing.leads.criar"),
      import: can(user, "marketing.leads.importar"),
      edit: can(user, "marketing.leads.editar"),
      register: can(user, "marketing.leads.registrar"),
      assign: can(user, "marketing.leads.atribuir"),
      qualify: can(user, "marketing.leads.qualificar"),
      disqualify: can(user, "marketing.leads.desqualificar"),
    },
    campaigns: {
      create: can(user, "marketing.campanhas.criar"),
      edit: can(user, "marketing.campanhas.editar"),
    },
    inbox: {
      assume: can(user, "marketing.caixa-de-entrada.assumir"),
      reply: can(user, "marketing.caixa-de-entrada.enviar"),
    },
    prospect: {
      create: can(user, "marketing.prospeccao.criar"),
      edit: can(user, "marketing.prospeccao.editar"),
      import: can(user, "marketing.prospeccao.importar"),
      assign: can(user, "marketing.prospeccao.atribuir"),
      register: can(user, "marketing.prospeccao.registrar"),
      convert: can(user, "marketing.prospeccao.converter"),
    },
    createTask: can(user, "operacao.tarefas.criar"),
  };
}

// ---------------------------------------------------------------------------
// Predicados puros de escopo
// ---------------------------------------------------------------------------

export function isFullScope(scope: ScopeCut): boolean {
  return !scope.userIds && !scope.departmentKeys;
}

export function leadInScope(access: LeadAccess, lead: Pick<Lead, "ownerId">): boolean {
  if (scopeAllows(access.scope, [lead.ownerId])) return true;
  return access.pool && !lead.ownerId;
}

export function campaignInScope(scope: ScopeCut, campaign: Pick<Campaign, "ownerId">): boolean {
  return scopeAllows(scope, [campaign.ownerId]);
}

/** Contato visível: dono do contato ou dono da lista no escopo. */
export function prospectInScope(scope: ScopeCut, prospect: Pick<Prospect, "ownerId">, plist: Pick<ProspectList, "ownerId"> | null | undefined): boolean {
  if (isFullScope(scope)) return true;
  return scopeAllows(scope, [prospect.ownerId]) || Boolean(plist && scopeAllows(scope, [plist.ownerId]));
}

/** Lista visível: dono da lista no escopo ou algum contato dela visível. */
export function prospectListInScope(scope: ScopeCut, plist: Pick<ProspectList, "ownerId">, prospects: readonly Pick<Prospect, "ownerId">[]): boolean {
  if (isFullScope(scope) || scopeAllows(scope, [plist.ownerId])) return true;
  return prospects.some((p) => scopeAllows(scope, [p.ownerId]));
}

/** Mensagem da caixa de entrada: algum dono no escopo; sem dono nenhum = fila (pool). */
export function inboxItemInScope(access: LeadAccess, owners: readonly (string | undefined | null)[]): boolean {
  if (isFullScope(access.scope)) return true;
  const present = owners.filter((o): o is string => Boolean(o));
  if (present.length === 0) return access.pool;
  return scopeAllows(access.scope, present);
}

export function clientOwners(client: Pick<Client, "ownerSalesId" | "ownerCsId"> | null | undefined): (string | undefined)[] {
  return client ? [client.ownerSalesId, client.ownerCsId] : [];
}

// ---------------------------------------------------------------------------
// Escopo efetivo do usuário (memoizado por requisição em resolveDataScope)
// ---------------------------------------------------------------------------

export async function screenScope(user: CurrentUser, screen: MarketingScreen): Promise<ScopeCut> {
  return resolveDataScope(user, screen);
}

/** Quem distribui a fila de leads (atribuir ou assumir) continua vendo os leads sem dono. */
export function canPoolLeads(user: CurrentUser): boolean {
  return can(user, "marketing.leads.atribuir") || can(user, "marketing.caixa-de-entrada.assumir");
}

export async function leadAccess(user: CurrentUser, screen: MarketingScreen = MARKETING_SCREENS.leads): Promise<LeadAccess> {
  return { scope: await screenScope(user, screen), pool: canPoolLeads(user) };
}

// ---------------------------------------------------------------------------
// Registros por id (páginas e actions)
// ---------------------------------------------------------------------------

async function prospectsOfList(listId: string): Promise<Prospect[]> {
  return list<Prospect>(COLLECTIONS.prospects, { where: [["listId", "==", listId]] });
}

export async function leadExists(leadId: string): Promise<boolean> {
  return Boolean(await getById<Lead>(COLLECTIONS.leads, leadId));
}

export async function prospectListExists(listId: string): Promise<boolean> {
  return Boolean(await getById<ProspectList>(COLLECTIONS.prospectLists, listId));
}

/** A lista de prospecção existe e está no escopo do usuário (com a tela liberada)? */
export async function canSeeProspectListId(user: CurrentUser, listId: string): Promise<boolean> {
  if (!can(user, "marketing.prospeccao.ver")) return false;
  const scope = await screenScope(user, MARKETING_SCREENS.prospect);
  const plist = await getById<ProspectList>(COLLECTIONS.prospectLists, listId);
  if (!plist) return false;
  if (isFullScope(scope) || scopeAllows(scope, [plist.ownerId])) return true;
  return prospectListInScope(scope, plist, await prospectsOfList(listId));
}

/**
 * Asserções das actions: registro fora do escopo → PermissionError. Registro inexistente passa (o serviço devolve a
 * mensagem de "não encontrado" de sempre).
 */
export async function assertLeadInScope(user: CurrentUser, leadId: string, screen: MarketingScreen = MARKETING_SCREENS.leads): Promise<void> {
  const lead = await getById<Lead>(COLLECTIONS.leads, leadId);
  if (lead && !leadInScope(await leadAccess(user, screen), lead)) throw new PermissionError();
}

export async function assertCampaignInScope(user: CurrentUser, campaignId: string): Promise<void> {
  const campaign = await getById<Campaign>(COLLECTIONS.campaigns, campaignId);
  if (campaign && !campaignInScope(await screenScope(user, MARKETING_SCREENS.campaigns), campaign)) throw new PermissionError();
}

export async function assertProspectListInScope(user: CurrentUser, listId: string): Promise<void> {
  const scope = await screenScope(user, MARKETING_SCREENS.prospect);
  if (isFullScope(scope)) return;
  const plist = await getById<ProspectList>(COLLECTIONS.prospectLists, listId);
  if (plist && !prospectListInScope(scope, plist, await prospectsOfList(listId))) throw new PermissionError();
}

/** Contatos informados (atribuição em lote) todos visíveis. */
export async function assertProspectsInScope(user: CurrentUser, listId: string, prospectIds: readonly string[]): Promise<void> {
  const scope = await screenScope(user, MARKETING_SCREENS.prospect);
  if (isFullScope(scope)) return;
  const [plist, prospects] = await Promise.all([getById<ProspectList>(COLLECTIONS.prospectLists, listId), prospectsOfList(listId)]);
  if (!plist) return;
  const ids = new Set(prospectIds);
  if (prospects.some((p) => ids.has(p.id) && !prospectInScope(scope, p, plist))) throw new PermissionError();
}

export async function assertProspectInScope(user: CurrentUser, prospectId: string): Promise<void> {
  const scope = await screenScope(user, MARKETING_SCREENS.prospect);
  if (isFullScope(scope)) return;
  const prospect = await getById<Prospect>(COLLECTIONS.prospects, prospectId);
  if (!prospect) return;
  const plist = await getById<ProspectList>(COLLECTIONS.prospectLists, prospect.listId);
  if (!prospectInScope(scope, prospect, plist)) throw new PermissionError();
}

export async function assertInboxMessageInScope(user: CurrentUser, communicationId: string): Promise<void> {
  const access = await leadAccess(user, MARKETING_SCREENS.inbox);
  if (isFullScope(access.scope)) return;
  const message = await getById<Communication>(COLLECTIONS.communications, communicationId);
  if (!message) return;
  const [lead, client] = await Promise.all([
    message.entityType === "lead" && message.entityId ? getById<Lead>(COLLECTIONS.leads, message.entityId) : Promise.resolve(null),
    message.clientId ? getById<Client>(COLLECTIONS.clients, message.clientId) : Promise.resolve(null),
  ]);
  if (!inboxItemInScope(access, [message.userId, lead?.ownerId, ...clientOwners(client)])) throw new PermissionError();
}
