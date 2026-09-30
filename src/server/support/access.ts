/**
 * Autorização do Suporte (catálogo src/domain/permissions/suporte.ts). Só no servidor: páginas, queries e Server
 * Actions. Os Client Components recebem o resultado por props (capacidades) e só escondem controles; as actions
 * revalidam sempre (requirePermission + escopo do chamado).
 *
 * Escopo (A7/A23/A29): dono de um chamado = atendente (`assigneeId`). Chamado sem atendente fica visível para quem
 * tem acesso à tela (fila, `poolUnassigned`). Padrão "empresa" para todos (comportamento anterior); a restrição
 * configurada pelo CEO/CTO vale nas listas, na Central, nos detalhes (?chamado=, /suporte/chamados/[id]) e nas actions
 * sobre um chamado.
 */
import "server-only";
import type { EffectivePermissions, PermissionKey, ScreenKey } from "@/domain/permissions";
import { COLLECTIONS, type CurrentUser, type SupportTicket } from "@/domain/types";
import { getById } from "@/server/db";
import { can, type PermissionHolder } from "@/server/auth/permissions";
import { PermissionError } from "@/server/auth/errors";
import { resolveDataScope, scopeAllows } from "@/server/auth/scope";
import type { SupportCapabilities } from "@/components/support/access-model";

type SupportUser = { isAdmin: boolean; isManager: boolean; role: string; departmentId: string; permissions?: EffectivePermissions };

/** Telas do Suporte com escopo de dados (a Central segue o escopo de Chamados — `sameAs`). */
export type SupportScreen = "suporte.central" | "suporte.chamados";

/**
 * Operar chamados: fachada de `suporte.chamados.assumir` (as operações de chamado têm a mesma regra padrão). Inclui o
 * módulo Suporte — correção deliberada A14 (requireOperator do Suporte não checava o módulo).
 */
export function canOperateSupport(user: SupportUser): boolean {
  return can(user as PermissionHolder, "suporte.chamados.assumir");
}

/** Criar/editar artigos da base de conhecimento: `suporte.base-de-conhecimento.editar` (inclui o módulo — A14). */
export function canEditArticles(user: SupportUser): boolean {
  return can(user as PermissionHolder, "suporte.base-de-conhecimento.editar");
}

// ---------------------------------------------------------------------------
// Capacidades (botões e controles) — calculadas no servidor
// ---------------------------------------------------------------------------

/** Chave do catálogo de cada capacidade da interface. */
export const SUPPORT_CAPABILITY_KEYS = {
  createTicket: "suporte.chamados.criar",
  assume: "suporte.chamados.assumir",
  assign: "suporte.chamados.atribuir",
  reply: "suporte.chamados.enviar",
  register: "suporte.chamados.registrar",
  attach: "suporte.chamados.anexar",
  classify: "suporte.chamados.classificar",
  pause: "suporte.chamados.pausar",
  resolve: "suporte.chamados.concluir",
  close: "suporte.chamados.fechar",
  reopen: "suporte.chamados.reabrir",
  createOpportunity: "suporte.chamados.criar-oportunidade",
  createArticle: "suporte.base-de-conhecimento.criar",
  editArticle: "suporte.base-de-conhecimento.editar",
  voteArticle: "suporte.base-de-conhecimento.avaliar",
} as const satisfies Record<keyof SupportCapabilities, PermissionKey>;

/** O que o usuário pode fazer no Suporte (padrão: operações = canOperateSupport; artigos = canEditArticles). */
export function supportCapabilities(user: PermissionHolder): SupportCapabilities {
  const out = {} as SupportCapabilities;
  for (const [cap, key] of Object.entries(SUPPORT_CAPABILITY_KEYS) as [keyof SupportCapabilities, PermissionKey][]) out[cap] = can(user, key);
  return out;
}

// ---------------------------------------------------------------------------
// Escopo por chamado
// ---------------------------------------------------------------------------

/** Donos de um chamado para o recorte de escopo (atendente; vazio = fila sem atendente). */
export function ticketOwners(ticket: Pick<SupportTicket, "assigneeId">): (string | undefined)[] {
  return [ticket.assigneeId];
}

/** O usuário vê este chamado na tela? (tela + escopo; sem a tela = não) */
export async function canSeeTicket(user: CurrentUser, ticket: Pick<SupportTicket, "assigneeId">, screen: SupportScreen = "suporte.chamados"): Promise<boolean> {
  if (!can(user, `${screen}.ver` as PermissionKey)) return false;
  return scopeAllows(await resolveDataScope(user, screen as ScreenKey), ticketOwners(ticket));
}

export type TicketAccess = "ok" | "missing" | "denied";

/** Situação de acesso a um chamado por id: inexistente, negado (tela/escopo) ou liberado. */
export async function checkTicketAccess(user: CurrentUser, ticketId: string, screen: SupportScreen = "suporte.chamados"): Promise<TicketAccess> {
  if (!can(user, `${screen}.ver` as PermissionKey)) return "denied";
  const ticket = await getById<SupportTicket>(COLLECTIONS.supportTickets, ticketId);
  if (!ticket) return "missing";
  return (await canSeeTicket(user, ticket, screen)) ? "ok" : "denied";
}

/**
 * Action sobre um chamado: fora do escopo → PermissionError (T8). Chamado inexistente segue para o serviço, que
 * responde "Chamado não encontrado" como antes.
 */
export async function assertTicketAccess(user: CurrentUser, ticketId: string): Promise<void> {
  if ((await checkTicketAccess(user, ticketId)) === "denied") throw new PermissionError();
}
