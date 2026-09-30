/**
 * Autorização do Customer Success (catálogo src/domain/permissions/cs.ts). Só no servidor: páginas, queries e
 * Server Actions. Os Client Components recebem o resultado por props (capacidades e links) e só escondem controles;
 * as actions revalidam sempre (requirePermission + escopo do registro).
 *
 * Escopo (A7/A23/A29): dono de um cliente da carteira = responsável da conta de CS (`csAccounts.ownerId`) ou, sem
 * conta, o responsável de CS do cliente (`clients.ownerCsId`) — a mesma regra do filtro "Carteira de <pessoa>".
 * Plano de sucesso = responsável do plano ou das ações; renovação = responsável da renovação; churn = responsável do
 * registro ou dono do cliente. Padrão "empresa" para todos (comportamento anterior); a restrição configurada pelo
 * CEO/CTO vale nas listas, nos detalhes (?cliente=, ?plano=) e nas actions sobre um registro.
 */
import "server-only";
import type { PermissionKey, ScreenKey } from "@/domain/permissions";
import { COLLECTIONS, type Client, type Contract, type CsAccount, type Renewal, type SuccessPlan, type User } from "@/domain/types";
import { getById, getManyByIds, list } from "@/server/db";
import { can, canSeeHref, type PermissionHolder } from "@/server/auth/permissions";
import { PermissionError } from "@/server/auth/error-classes";
import { resolveDataScope, scopeAllows, type DataScope } from "@/server/auth/scope";
import type { CurrentUser } from "@/domain/types";
import type { CsCapabilities, CsLinks } from "@/components/cs/access-model";

/** Telas do CS com escopo de dados. */
export type CsScreen = Extract<ScreenKey, `cs.${string}`>;

// ---------------------------------------------------------------------------
// Capacidades (botões e controles) e links — calculados no servidor
// ---------------------------------------------------------------------------

/** Chave do catálogo de cada capacidade da interface. */
export const CS_CAPABILITY_KEYS = {
  activate: "cs.carteira.ativar-cliente",
  recalculate: "cs.saude.recalcular",
  recalculateAll: "cs.saude.recalcular-carteira",
  checkpoint: "cs.checkpoints.criar",
  createPlan: "cs.planos.criar",
  editPlan: "cs.planos.editar",
  closePlan: "cs.planos.concluir",
  createRenewal: "cs.renovacoes.criar",
  negotiate: "cs.renovacoes.negociar",
  renew: "cs.renovacoes.renovar",
  loseRenewal: "cs.renovacoes.perder",
  escalate: "cs.riscos.escalar",
  upsell: "cs.upsell.criar-oportunidade",
  churn: "cs.churn.registrar",
  contact: "operacao.clientes.registrar",
  createTask: "operacao.tarefas.criar",
} as const satisfies Record<keyof CsCapabilities, PermissionKey>;

/** O que o usuário pode fazer no CS (padrão = quem tem o módulo; recalcular a carteira = gestores). */
export function csCapabilities(user: PermissionHolder): CsCapabilities {
  const out = {} as CsCapabilities;
  for (const [cap, key] of Object.entries(CS_CAPABILITY_KEYS) as [keyof CsCapabilities, PermissionKey][]) out[cap] = can(user, key);
  return out;
}

/** Href de referência de cada link (o id é indiferente: vale a tela dona da rota). */
export const CS_LINK_HREFS = {
  portfolio: "/cs",
  health: "/cs/saude",
  checkpoints: "/cs/checkpoints",
  plans: "/cs/planos",
  renewals: "/cs/renovacoes",
  risks: "/cs/riscos",
  upsell: "/cs/upsell",
  churn: "/cs/churn",
  client: "/clientes/_",
  contracts: "/financeiro/contratos",
  receivables: "/financeiro/contas-a-receber",
  tasks: "/tarefas",
  opportunities: "/vendas/oportunidades",
} as const satisfies Record<keyof CsLinks, string>;

/** Links internos visíveis ao usuário (mesma regra das rotas: canSeeHref). */
export function csLinks(user: PermissionHolder): CsLinks {
  const out = {} as CsLinks;
  for (const [link, href] of Object.entries(CS_LINK_HREFS) as [keyof CsLinks, string][]) out[link] = canSeeHref(user, href);
  return out;
}

// ---------------------------------------------------------------------------
// Donos dos registros
// ---------------------------------------------------------------------------

/** Dono de um cliente na carteira: responsável da conta de CS ou, sem ela, o responsável de CS do cliente. */
export function clientOwners(client: Pick<Client, "ownerCsId">, account?: Pick<CsAccount, "ownerId"> | null): string[] {
  const owner = account?.ownerId ?? client.ownerCsId;
  return owner ? [owner] : [];
}

/** Responsáveis de um plano (gravado ou em edição). */
export interface PlanOwnership {
  ownerId: SuccessPlan["ownerId"];
  actions?: readonly { responsibleId: string }[];
}

/** Donos de um plano de sucesso: responsável do plano e responsáveis das ações. */
export function planOwners(plan: PlanOwnership): string[] {
  return [plan.ownerId, ...(plan.actions ?? []).map((a) => a.responsibleId)];
}

/** Sem recorte (escopo "empresa" ou "unidades"). */
export const isUnrestricted = (scope: Pick<DataScope, "userIds" | "departmentKeys">) => !scope.userIds && !scope.departmentKeys;

/** Departamento de cada pessoa (para o recorte "departamento": cliente do departamento = dono lotado nele). */
export type DepartmentOf = (userId: string) => string | undefined;

/**
 * Filtro de donos pelo escopo: algum dono dentro do escopo basta. Clientes, planos e renovações não têm
 * departamento próprio; no recorte por departamento vale o departamento do dono.
 */
export function ownerFilter(scope: Pick<DataScope, "userIds" | "departmentKeys" | "poolUnassigned">, departmentOf: DepartmentOf = () => undefined): (owners: readonly (string | undefined | null)[]) => boolean {
  if (isUnrestricted(scope)) return () => true;
  return (owners) => {
    const ids = owners.filter((id): id is string => Boolean(id));
    if (ids.length === 0) return scopeAllows(scope, []);
    return ids.some((id) => scopeAllows(scope, [id], departmentOf(id)));
  };
}

/** Filtro de donos para listas e lotes: lê as pessoas só quando o escopo recorta por departamento. */
export async function loadOwnerFilter(scope: DataScope): Promise<(owners: readonly (string | undefined | null)[]) => boolean> {
  if (!scope.departmentKeys) return ownerFilter(scope);
  const users = await list<User>(COLLECTIONS.users);
  const departments = new Map(users.map((u) => [u.id, u.departmentId as string]));
  return ownerFilter(scope, (id) => departments.get(id));
}

/** Mesmo filtro, lendo o departamento dos donos no banco só quando o escopo recorta por departamento. */
async function allowsOwners(scope: DataScope, owners: readonly (string | undefined | null)[]): Promise<boolean> {
  if (isUnrestricted(scope)) return true;
  if (!scope.departmentKeys) return ownerFilter(scope)(owners);
  const users = await getManyByIds<User>(COLLECTIONS.users, owners.filter((id): id is string => Boolean(id)));
  return ownerFilter(scope, (id) => users.get(id)?.departmentId)(owners);
}

/** Conta de CS mais recente do cliente (a mesma que as telas usam). */
async function latestAccount(clientId: string): Promise<CsAccount | null> {
  const accounts = await list<CsAccount>(COLLECTIONS.csAccounts, { where: [["clientId", "==", clientId]] });
  return accounts.sort((a, b) => (a.updatedAt < b.updatedAt ? 1 : -1))[0] ?? null;
}

/** Donos do cliente lidos do banco (cliente inexistente → null). */
export async function loadClientOwners(clientId: string): Promise<string[] | null> {
  const [client, account] = await Promise.all([getById<Client>(COLLECTIONS.clients, clientId), latestAccount(clientId)]);
  if (!client) return null;
  return clientOwners(client, account);
}

// ---------------------------------------------------------------------------
// Escopo por registro (detalhes e actions)
// ---------------------------------------------------------------------------

/** O usuário vê este cliente na tela? (tela + escopo; cliente inexistente = não) */
export async function canSeeCsClient(user: CurrentUser, clientId: string, screen: CsScreen = "cs.carteira"): Promise<boolean> {
  if (!can(user, `${screen}.ver` as PermissionKey)) return false;
  const scope = await resolveDataScope(user, screen);
  if (isUnrestricted(scope)) return true;
  const owners = await loadClientOwners(clientId);
  return owners !== null && (await allowsOwners(scope, owners));
}

/**
 * Action sobre um cliente: fora do escopo da tela → PermissionError. Com escopo "empresa" (padrão) não lê nada;
 * cliente inexistente segue para o serviço (que responde "não encontrado").
 */
export async function assertCsClientAccess(user: CurrentUser, clientId: string, screen: CsScreen): Promise<void> {
  const scope = await resolveDataScope(user, screen);
  if (isUnrestricted(scope)) return;
  const owners = await loadClientOwners(clientId);
  if (owners && !(await allowsOwners(scope, owners))) throw new PermissionError();
}

/** Action sobre um plano existente: vale o escopo de Planos (responsável do plano ou das ações). */
export async function assertPlanAccess(user: CurrentUser, planId: string): Promise<void> {
  const scope = await resolveDataScope(user, "cs.planos");
  if (isUnrestricted(scope)) return;
  const plan = await getById<SuccessPlan>(COLLECTIONS.successPlans, planId);
  if (plan && !(await allowsOwners(scope, planOwners(plan)))) throw new PermissionError();
}

/** Plano resultante (criação/edição) precisa ficar dentro do escopo de quem grava: não se cria plano "para fora". */
export async function assertPlanDraftAccess(user: CurrentUser, draft: PlanOwnership): Promise<void> {
  const scope = await resolveDataScope(user, "cs.planos");
  if (isUnrestricted(scope)) return;
  if (!(await allowsOwners(scope, planOwners(draft)))) throw new PermissionError("Acesso negado: o plano precisa ter você ou alguém da sua carteira como responsável.");
}

/** Action sobre uma renovação: vale o escopo de Renovações (responsável da renovação). */
export async function assertRenewalAccess(user: CurrentUser, renewalId: string): Promise<void> {
  const scope = await resolveDataScope(user, "cs.renovacoes");
  if (isUnrestricted(scope)) return;
  const renewal = await getById<Renewal>(COLLECTIONS.renewals, renewalId);
  if (renewal && !(await allowsOwners(scope, [renewal.ownerId]))) throw new PermissionError();
}

/** Criar renovação para um contrato: vale o dono de CS do cliente do contrato (linhas "vencendo sem renovação"). */
export async function assertContractRenewalAccess(user: CurrentUser, contractId: string): Promise<void> {
  const scope = await resolveDataScope(user, "cs.renovacoes");
  if (isUnrestricted(scope)) return;
  const contract = await getById<Contract>(COLLECTIONS.contracts, contractId);
  if (!contract) return;
  const client = await getById<Client>(COLLECTIONS.clients, contract.clientId);
  if (client && !(await allowsOwners(scope, [client.ownerCsId]))) throw new PermissionError();
}
