/**
 * Autorização do Financeiro — contratos e cobranças (catálogo: src/domain/permissions/financeiro.ts). Só no servidor:
 * páginas, queries e Server Actions. Os Client Components recebem o resultado por props/contexto (nunca decidem
 * operação).
 *
 * - Capacidades (`financeCapabilities`): o que a interface mostra (botões, seções, valores).
 * - Valores (A13): `canSeeFinanceValues` (`financeiro.valores.ver`, transversal — vale no Cliente 360, na implantação
 *   etc.) e `canSeeContractValues` (∧ `financeiro.contratos.valores.ver`, dentro do módulo).
 * - Escopo (A7/A29): dono do contrato = vendedor (`sellerId`, na falta o dono da oportunidade e, por fim, o vendedor
 *   do cliente) OU responsável financeiro (`ownerId`); a cobrança herda os donos do contrato. Padrão "empresa" para
 *   todos (comportamento anterior); a restrição configurada pelo CEO/CTO vale em listas, detalhes e actions.
 */
import "server-only";
import { COLLECTIONS, type Billing, type Client, type Contract, type ContractAmendment, type CurrentUser, type Opportunity, type User } from "@/domain/types";
import type { EffectivePermissions } from "@/domain/permissions";
import { getById, getManyByIds, list } from "@/server/db";
import { can, type PermissionHolder } from "@/server/auth/permissions";
import { BusinessError, PermissionError } from "@/server/auth/error-classes";
import { resolveDataScope, scopeAllows, type DataScope } from "@/server/auth/scope";
import type { FinanceCapabilities } from "@/components/finance/access-model";

/**
 * Quem opera o Financeiro (altera contratos e cobranças): equipe financeira, gestores, diretoria e admin — COM o
 * módulo Financeiro. Fachada de `financeiro.contratos.editar` (as operações de contrato e cobrança têm a mesma regra
 * padrão). Mantida para compatibilidade; as telas usam `financeCapabilities` (uma chave por ação).
 */
export function canOperateFinance(user: { isAdmin: boolean; isManager: boolean; role: string; departmentId: string; permissions?: EffectivePermissions }): boolean {
  return can(user as PermissionHolder, "financeiro.contratos.editar");
}

// ---------------------------------------------------------------------------
// Valores (A13)
// ---------------------------------------------------------------------------

/** "Visualizar valores" (capacidade transversal): números de contrato/cobrança/receita em qualquer tela. */
export function canSeeFinanceValues(user: PermissionHolder): boolean {
  return can(user, "financeiro.valores.ver");
}

/** Valores do contrato (página, painel, documento, lista): exige também a seção "Valores do contrato". */
export function canSeeContractValues(user: PermissionHolder): boolean {
  return can(user, "financeiro.valores.ver") && can(user, "financeiro.contratos.valores.ver");
}

// ---------------------------------------------------------------------------
// Capacidades da interface
// ---------------------------------------------------------------------------

/** Capacidades do usuário nas telas de contratos e cobranças (só escondem controles; as actions revalidam). */
export function financeCapabilities(user: PermissionHolder): FinanceCapabilities {
  const k = (key: Parameters<typeof can>[1]) => can(user, key);
  const values = k("financeiro.valores.ver");
  const contractValues = values && k("financeiro.contratos.valores.ver");
  return {
    values,
    contractValues,
    contracts: {
      view: k("financeiro.contratos.ver"),
      create: k("financeiro.contratos.criar"),
      edit: k("financeiro.contratos.editar"),
      signatureView: k("financeiro.contratos.assinatura.ver"),
      amendmentsView: k("financeiro.contratos.aditivos.ver"),
      pendenciesView: k("financeiro.contratos.pendencias.ver"),
      documentsView: k("financeiro.contratos.documentos.ver"),
      historyView: k("financeiro.contratos.historico.ver"),
      signersEdit: k("financeiro.contratos.assinatura.editar"),
      signatureSend: k("financeiro.contratos.assinatura.enviar"),
      sign: k("financeiro.contratos.assinatura.assinar"),
      // Gerar aditivo mexe em itens e valores: sem ver os valores do contrato, não há como compor o aditivo.
      amendmentCreate: k("financeiro.contratos.aditivos.criar") && contractValues,
      amendmentSend: k("financeiro.contratos.aditivos.enviar"),
      amendmentSign: k("financeiro.contratos.aditivos.assinar"),
      amendmentApply: k("financeiro.contratos.aditivos.aplicar"),
      amendmentCancel: k("financeiro.contratos.aditivos.cancelar"),
      pendencyCreate: k("financeiro.contratos.pendencias.criar"),
      pendencyResolve: k("financeiro.contratos.pendencias.concluir"),
      documentAttach: k("financeiro.contratos.documentos.anexar"),
      release: k("financeiro.contratos.liberar"),
      releaseWithPendency: k("financeiro.contratos.liberar") && k("financeiro.contratos.liberar-com-pendencia"),
      cancel: k("financeiro.contratos.cancelar"),
    },
    billings: {
      view: k("financeiro.cobrancas.ver"),
      boletoView: k("financeiro.cobrancas.boleto.ver"),
      generate: k("financeiro.cobrancas.gerar"),
      // Registrar boleto e dar baixa pedem o valor (linha digitável/valor pago): exigem "Visualizar valores".
      boletoCreate: k("financeiro.cobrancas.boleto.criar") && values,
      boletoSend: k("financeiro.cobrancas.boleto.enviar") && k("financeiro.cobrancas.cobrar"),
      collect: k("financeiro.cobrancas.cobrar"),
      pay: k("financeiro.cobrancas.baixar") && values,
      reverse: k("financeiro.cobrancas.estornar"),
      cancel: k("financeiro.cobrancas.cancelar"),
    },
  };
}

// ---------------------------------------------------------------------------
// Escopo de contratos e cobranças (A7/A29)
// ---------------------------------------------------------------------------

/** Telas do Financeiro com escopo por dono do contrato. */
export type ContractScopeScreen = "financeiro.dashboard" | "financeiro.contratos" | "financeiro.assinaturas" | "financeiro.cobrancas" | "financeiro.contas-a-receber" | "financeiro.recorrencia";

/** Mensagem de registro fora do escopo (sem revelar o que existe do outro lado). */
export const OUT_OF_SCOPE_MESSAGE = "Acesso negado: este contrato está fora do seu escopo de acesso.";

type OwnerRef = Pick<Contract, "id" | "clientId" | "sellerId" | "ownerId" | "opportunityId">;

/** Donos do contrato: vendedor (com o vendedor de fallback já resolvido) e responsável financeiro. */
export function contractOwnerIds(contract: Pick<Contract, "sellerId" | "ownerId">, fallbackSellerId?: string): string[] {
  return [contract.sellerId ?? fallbackSellerId, contract.ownerId].filter((id): id is string => Boolean(id));
}

/**
 * Donos de cada contrato, resolvendo o vendedor dos contratos antigos (sem `sellerId`): dono da oportunidade e, na
 * falta, o vendedor do cliente. Só lê oportunidades/clientes dos contratos que precisam.
 */
export async function contractOwnersMap(contracts: readonly OwnerRef[]): Promise<Map<string, string[]>> {
  const needOpp = contracts.filter((c) => !c.sellerId && c.opportunityId);
  const opps = needOpp.length ? await getManyByIds<Opportunity>(COLLECTIONS.opportunities, needOpp.map((c) => c.opportunityId!)) : new Map<string, Opportunity>();
  const sellerOf = (c: OwnerRef) => c.sellerId ?? (c.opportunityId ? opps.get(c.opportunityId)?.ownerId : undefined);
  const needClient = contracts.filter((c) => !sellerOf(c));
  const clients = needClient.length ? await getManyByIds<Client>(COLLECTIONS.clients, needClient.map((c) => c.clientId)) : new Map<string, Client>();
  return new Map(contracts.map((c) => [c.id, contractOwnerIds(c, sellerOf(c) ?? clients.get(c.clientId)?.ownerSalesId)]));
}

/** Escopo sem recorte (empresa): nada a filtrar nem a ler. */
export function isCompanyScope(scope: Pick<DataScope, "userIds" | "departmentKeys">): boolean {
  return !scope.userIds && !scope.departmentKeys;
}

/**
 * Predicado de escopo por donos. "departamento" recortado pelo registro (padrão do catálogo) vale pelo departamento
 * dos donos: contrato não tem departamento próprio, então entra quando o vendedor ou o responsável é do departamento.
 */
export async function ownersPredicate(scope: DataScope): Promise<(owners: readonly string[]) => boolean> {
  if (isCompanyScope(scope)) return () => true;
  let departmentOf: Map<string, string> | null = null;
  if (scope.departmentKeys) {
    const users = await list<User>(COLLECTIONS.users);
    departmentOf = new Map(users.map((u) => [u.id, u.departmentId]));
  }
  return (owners) => scopeAllows(scope, owners) || Boolean(departmentOf && scope.departmentKeys && owners.some((o) => scope.departmentKeys!.has(departmentOf!.get(o) as never)));
}

/** Filtra contratos pelo escopo (empresa = sem leitura extra). */
export async function filterContractsByScope<T extends OwnerRef>(contracts: readonly T[], scope: DataScope): Promise<T[]> {
  if (isCompanyScope(scope)) return [...contracts];
  const [owners, allows] = await Promise.all([contractOwnersMap(contracts), ownersPredicate(scope)]);
  return contracts.filter((c) => allows(owners.get(c.id) ?? []));
}

/**
 * Ids dos contratos visíveis no escopo (para recortar cobranças pelo contrato). `null` = empresa (sem recorte).
 * Lê os contratos só quando há recorte.
 */
export async function visibleContractIds(scope: DataScope, preloaded?: readonly Contract[]): Promise<Set<string> | null> {
  if (isCompanyScope(scope)) return null;
  const contracts = preloaded ?? (await list<Contract>(COLLECTIONS.contracts));
  return new Set((await filterContractsByScope(contracts, scope)).map((c) => c.id));
}

/** Recorta cobranças pelos contratos visíveis. */
export function filterBillingsByContracts<T extends Pick<Billing, "contractId">>(billings: readonly T[], visible: Set<string> | null): T[] {
  return visible ? billings.filter((b) => visible.has(b.contractId)) : [...billings];
}

/** O usuário vê este contrato na tela? (tela + escopo) */
export async function contractInScope(user: CurrentUser, contract: OwnerRef, screen: ContractScopeScreen = "financeiro.contratos"): Promise<boolean> {
  if (!can(user, `${screen}.ver`)) return false;
  const scope = await resolveDataScope(user, screen);
  if (isCompanyScope(scope)) return true;
  const [owners, allows] = await Promise.all([contractOwnersMap([contract]), ownersPredicate(scope)]);
  return allows(owners.get(contract.id) ?? []);
}

/** Contrato para uma action: inexistente → BusinessError; fora da tela/escopo → PermissionError. */
export async function assertContractAccess(user: CurrentUser, contractId: string, screen: ContractScopeScreen = "financeiro.contratos"): Promise<Contract> {
  const contract = await getById<Contract>(COLLECTIONS.contracts, contractId);
  if (!contract) throw new BusinessError("Contrato não encontrado");
  if (!(await contractInScope(user, contract, screen))) throw new PermissionError(OUT_OF_SCOPE_MESSAGE, `${screen}.ver`);
  return contract;
}

/** Cobrança para uma action: escopo pelo contrato dela na tela Cobranças. */
export async function assertBillingAccess(user: CurrentUser, billingId: string): Promise<Billing> {
  const billing = await getById<Billing>(COLLECTIONS.billing, billingId);
  if (!billing) throw new BusinessError("Cobrança não encontrada");
  const contract = await getById<Contract>(COLLECTIONS.contracts, billing.contractId);
  if (contract && !(await contractInScope(user, contract, "financeiro.cobrancas"))) throw new PermissionError(OUT_OF_SCOPE_MESSAGE, "financeiro.cobrancas.ver");
  return billing;
}

/** Aditivo para uma action: escopo pelo contrato. */
export async function assertAmendmentAccess(user: CurrentUser, amendmentId: string): Promise<ContractAmendment> {
  const amendment = await getById<ContractAmendment>(COLLECTIONS.contractAmendments, amendmentId);
  if (!amendment) throw new BusinessError("Aditivo não encontrado");
  await assertContractAccess(user, amendment.contractId);
  return amendment;
}

/** Gerar contrato da venda ganha: a venda (dono = vendedor, na falta o vendedor do cliente) no escopo de Contratos. */
export async function assertOpportunityContractAccess(user: CurrentUser, opportunityId: string): Promise<void> {
  const opp = await getById<Opportunity>(COLLECTIONS.opportunities, opportunityId);
  if (!opp) return; // o serviço responde "oportunidade não encontrada"
  const ref: OwnerRef = { id: `opp:${opp.id}`, clientId: opp.clientId, sellerId: opp.ownerId };
  if (!(await contractInScope(user, ref))) throw new PermissionError(OUT_OF_SCOPE_MESSAGE, "financeiro.contratos.ver");
}

/**
 * Pode abrir o contrato por id (página, documento, generateMetadata — A29/A30)? Confere a tela e o escopo lendo só o
 * documento do contrato, ANTES de carregar o detalhe. "missing" = não existe (a página responde 404).
 */
export async function contractAccessById(user: CurrentUser, contractId: string, screen: ContractScopeScreen = "financeiro.contratos"): Promise<"ok" | "missing" | "denied"> {
  if (!can(user, `${screen}.ver`)) return "denied";
  const contract = await getById<Contract>(COLLECTIONS.contracts, contractId);
  if (!contract) return "missing";
  return (await contractInScope(user, contract, screen)) ? "ok" : "denied";
}
