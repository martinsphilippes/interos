import "server-only";
/**
 * Autorização da tela Clientes 360º (operacao.clientes): seções da ficha, ações e escopo de registros (A7/A29).
 *
 * Escopo padrão = empresa para todos (comportamento anterior); a consulta SEMPRE passa por resolveDataScope para que
 * a restrição configurada pelo CEO/CTO (meus / equipe / departamento) valha na lista, na ficha, nas actions, na
 * busca global e nas listas auxiliares (seleção de cliente em tarefas).
 */
import { can, canSeeHref } from "@/server/auth/permissions";
import { filterByScope, resolveDataScope, scopeAllows, type DataScope } from "@/server/auth/scope";
import { getById } from "@/server/db";
import { COLLECTIONS, type Client, type CurrentUser } from "@/domain/types";
import type { PermissionKey } from "@/domain/permissions";
import type { ClientCapabilities, ClientSection, ClientSectionAccess } from "@/components/clients/access-model";

export const CLIENTS_SCREEN = "operacao.clientes" as const;

/** Chave de visualização de cada seção da ficha (catálogo: operacao.clientes.<secao>.ver). */
export const CLIENT_SECTION_KEYS: Record<ClientSection, PermissionKey> = {
  visao: "operacao.clientes.visao.ver",
  contatos: "operacao.clientes.contatos.ver",
  produtos: "operacao.clientes.produtos.ver",
  financeiro: "operacao.clientes.financeiro.ver",
  suporte: "operacao.clientes.suporte.ver",
  tarefas: "operacao.clientes.tarefas.ver",
  timeline: "operacao.clientes.timeline.ver",
  documentos: "operacao.clientes.documentos.ver",
  comercial: "operacao.clientes.comercial.ver",
  implantacao: "operacao.clientes.implantacao.ver",
  cs: "operacao.clientes.cs.ver",
};

type Owned = Pick<Client, "ownerSalesId" | "ownerCsId" | "ownerImplementationId">;

/** Donos de um cliente para o escopo (responsável comercial, de CS e de implantação). */
export function clientOwners(client: Owned): (string | undefined)[] {
  return [client.ownerSalesId, client.ownerCsId, client.ownerImplementationId];
}

export function clientSectionAccess(user: CurrentUser): ClientSectionAccess {
  const out = {} as ClientSectionAccess;
  for (const [section, key] of Object.entries(CLIENT_SECTION_KEYS) as [ClientSection, PermissionKey][]) out[section] = can(user, key);
  return out;
}

export function clientCapabilities(user: CurrentUser): ClientCapabilities {
  return {
    create: can(user, "operacao.clientes.criar"),
    edit: can(user, "operacao.clientes.editar"),
    changeStatus: can(user, "operacao.clientes.alterar-status"),
    contactsEdit: can(user, "operacao.clientes.contatos.editar"),
    contactsRemove: can(user, "operacao.clientes.contatos.excluir"),
    register: can(user, "operacao.clientes.registrar"),
    attachDocument: can(user, "operacao.clientes.documentos.anexar"),
    createOpportunity: can(user, "operacao.clientes.criar-oportunidade"),
    createTask: can(user, "operacao.tarefas.criar"),
    openWorkflow: canSeeHref(user, "/workflow/jornada"),
  };
}

/** Escopo de clientes do usuário (memoizado por requisição em resolveDataScope). */
export function clientScope(user: CurrentUser): Promise<DataScope> {
  return resolveDataScope(user, CLIENTS_SCREEN);
}

/** Recorta uma lista de clientes pelo escopo. */
export function scopeClients<T extends Owned>(items: readonly T[], scope: DataScope): T[] {
  return filterByScope(items, (c) => ({ owners: clientOwners(c) }), scope);
}

/** O usuário vê este cliente? (tela + escopo) */
export async function canSeeClient(user: CurrentUser, client: Owned): Promise<boolean> {
  if (!can(user, "operacao.clientes.ver")) return false;
  return scopeAllows(await clientScope(user), clientOwners(client));
}

/** Como canSeeClient, pelo id (só lê o documento quando o escopo recorta). Cliente inexistente = false. */
export async function canSeeClientId(user: CurrentUser, clientId: string): Promise<boolean> {
  if (!can(user, "operacao.clientes.ver")) return false;
  const scope = await clientScope(user);
  if (!scope.userIds && !scope.departmentKeys) return true;
  const client = await getById<Client>(COLLECTIONS.clients, clientId);
  return client ? scopeAllows(scope, clientOwners(client)) : false;
}
