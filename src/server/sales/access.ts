import "server-only";
/**
 * Autorização do módulo de Vendas (A5/A7/A28/A29): capacidades para a interface, escopo de dados por tela e
 * asserções por registro para as Server Actions.
 *
 * Escopo (catálogo src/domain/permissions/vendas.ts; o padrão reproduz o comportamento anterior):
 *  - Oportunidades (vendas.oportunidades; Pipeline usa o mesmo — sameAs): donos = `ownerId` e `originUserId`.
 *    Padrão: gestor/diretoria/admin = empresa; demais = "meus" (dono ou quem originou) — o antigo canSeeOpportunity.
 *  - Propostas (vendas.propostas): donos = `proposal.ownerId`, dono e originador da oportunidade.
 *  - Visitas (vendas.visitas): donos = `sellerId` e `createdBy`.
 *  - Central e Agenda (vendas.central / vendas.agenda): visão inicial "Minha"; o botão "Equipe" aparece quando o
 *    escopo efetivo é maior que "meus" (padrão: gestor = ele + liderados diretos; diretoria/admin = time de Vendas).
 * Detalhe por id fora do escopo: a página mostra o aviso de acesso negado; action sobre registro fora do escopo =
 * PermissionError (a mesma mensagem de antes: "Você não tem permissão para alterar …").
 */
import { can } from "@/server/auth/permissions";
import { BusinessError, PermissionError } from "@/server/auth/error-classes";
import { canSeeRecord, resolveDataScope, scopeAllows, type DataScope } from "@/server/auth/scope";
import { getById } from "@/server/db";
import { COLLECTIONS, type CollectionName, type CurrentUser, type Opportunity, type Proposal, type Visit } from "@/domain/types";
import type { ScreenKey } from "@/domain/permissions";
import type { SalesCapabilities } from "@/components/sales/access-model";

export const SALES_SCREENS = {
  central: "vendas.central",
  pipeline: "vendas.pipeline",
  opportunities: "vendas.oportunidades",
  agenda: "vendas.agenda",
  visits: "vendas.visitas",
  proposals: "vendas.propostas",
} as const satisfies Record<string, ScreenKey>;

/** Telas cujo escopo recorta oportunidades (Pipeline segue Oportunidades). */
export type OpportunityScreen = typeof SALES_SCREENS.opportunities | typeof SALES_SCREENS.pipeline;

/** Recorte já resolvido (as funções de filtro são puras). */
export type ScopeCut = Pick<DataScope, "userIds" | "departmentKeys" | "poolUnassigned">;

/** Escopo "empresa" (sem recorte). */
export const FULL_SCOPE: ScopeCut = { poolUnassigned: false };

export const OPPORTUNITY_DENIED = "Você não tem permissão para alterar esta oportunidade";
export const VISIT_DENIED = "Você não tem permissão para alterar esta visita";
export const PROPOSAL_DENIED = "Você não tem permissão para alterar esta proposta";

// ---------------------------------------------------------------------------
// Capacidades (interface)
// ---------------------------------------------------------------------------

export function salesCapabilities(user: CurrentUser): SalesCapabilities {
  return {
    opportunities: {
      view: can(user, "vendas.oportunidades.ver"),
      create: can(user, "vendas.oportunidades.criar"),
      edit: can(user, "vendas.oportunidades.editar"),
      register: can(user, "vendas.oportunidades.registrar"),
      send: can(user, "vendas.oportunidades.enviar"),
      attach: can(user, "vendas.oportunidades.anexar"),
      createTask: can(user, "vendas.oportunidades.criar-tarefa"),
      win: can(user, "vendas.oportunidades.ganhar"),
      lose: can(user, "vendas.oportunidades.perder"),
      reopen: can(user, "vendas.oportunidades.reabrir"),
      assign: can(user, "vendas.oportunidades.atribuir"),
    },
    proposals: {
      view: can(user, "vendas.propostas.ver"),
      create: can(user, "vendas.propostas.criar"),
      edit: can(user, "vendas.propostas.editar"),
      send: can(user, "vendas.propostas.enviar"),
      approve: can(user, "vendas.propostas.aprovar"),
    },
    visits: {
      view: can(user, "vendas.visitas.ver"),
      create: can(user, "vendas.visitas.criar"),
      assign: can(user, "vendas.visitas.atribuir"),
      complete: can(user, "vendas.visitas.concluir"),
      cancel: can(user, "vendas.visitas.cancelar"),
      edit: can(user, "vendas.visitas.editar"),
    },
    sweep: can(user, "vendas.central.executar-varredura"),
  };
}

// ---------------------------------------------------------------------------
// Predicados puros de escopo
// ---------------------------------------------------------------------------

export function isFullScope(scope: ScopeCut): boolean {
  return !scope.userIds && !scope.departmentKeys;
}

/** Oportunidade visível: dono ou quem originou dentro do escopo. */
export function opportunityInScope(scope: ScopeCut, opp: Pick<Opportunity, "ownerId" | "originUserId">): boolean {
  return scopeAllows(scope, [opp.ownerId, opp.originUserId]);
}

/** Proposta visível: dono da proposta, dono ou originador da oportunidade dentro do escopo. */
export function proposalInScope(scope: ScopeCut, proposal: Pick<Proposal, "ownerId">, opp: Pick<Opportunity, "ownerId" | "originUserId"> | null | undefined): boolean {
  return scopeAllows(scope, [proposal.ownerId, opp?.ownerId, opp?.originUserId]);
}

/** Visita visível: vendedor ou quem agendou dentro do escopo. */
export function visitInScope(scope: ScopeCut, visit: Pick<Visit, "sellerId" | "createdBy">): boolean {
  return scopeAllows(scope, [visit.sellerId, visit.createdBy]);
}

// ---------------------------------------------------------------------------
// Escopo resolvido por requisição
// ---------------------------------------------------------------------------

export const opportunityScope = (user: CurrentUser, screen: OpportunityScreen = SALES_SCREENS.opportunities) => resolveDataScope(user, screen);
export const proposalScope = (user: CurrentUser) => resolveDataScope(user, SALES_SCREENS.proposals);
export const visitScope = (user: CurrentUser) => resolveDataScope(user, SALES_SCREENS.visits);

/** O registro existe? (distingue "fora do escopo" de "inexistente" nas páginas) */
export async function recordExists(collection: CollectionName, id: string): Promise<boolean> {
  return Boolean(await getById(collection, id));
}

// ---------------------------------------------------------------------------
// Asserções por registro (Server Actions)
// ---------------------------------------------------------------------------

/** Oportunidade no escopo da tela dona (vendas.oportunidades); inexistente = erro de negócio como antes. */
export async function assertOpportunityAccess(user: CurrentUser, opportunityId: string): Promise<Opportunity> {
  const opp = await getById<Opportunity>(COLLECTIONS.opportunities, opportunityId);
  if (!opp) throw new BusinessError("Oportunidade não encontrada");
  if (!(await canSeeRecord(user, SALES_SCREENS.opportunities, [opp.ownerId, opp.originUserId]))) throw new PermissionError(OPPORTUNITY_DENIED);
  return opp;
}

/**
 * Proposta: exige a oportunidade no escopo (regra de antes: quem altera a proposta é quem pode alterar a
 * oportunidade) E a proposta no escopo da tela Propostas.
 */
export async function assertProposalAccess(user: CurrentUser, proposalId: string): Promise<{ proposal: Proposal; opportunity: Opportunity }> {
  const proposal = await getById<Proposal>(COLLECTIONS.proposals, proposalId);
  if (!proposal) throw new BusinessError("Proposta não encontrada");
  const opportunity = await assertOpportunityAccess(user, proposal.opportunityId);
  if (!(await canSeeRecord(user, SALES_SCREENS.proposals, [proposal.ownerId, opportunity.ownerId, opportunity.originUserId]))) throw new PermissionError(PROPOSAL_DENIED);
  return { proposal, opportunity };
}

/** Visita no escopo da tela Visitas. */
export async function assertVisitAccess(user: CurrentUser, visitId: string): Promise<Visit> {
  const visit = await getById<Visit>(COLLECTIONS.visits, visitId);
  if (!visit) throw new BusinessError("Visita não encontrada");
  if (!(await canSeeRecord(user, SALES_SCREENS.visits, [visit.sellerId, visit.createdBy]))) throw new PermissionError(VISIT_DENIED);
  return visit;
}
