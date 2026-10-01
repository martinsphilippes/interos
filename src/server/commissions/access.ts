import "server-only";
/**
 * Autorização de Comissões e Contas a Pagar (A5/A7/A29): visibilidade por seção e escopo, capacidades para a
 * interface e asserções por registro para as Server Actions. Catálogo: src/domain/permissions/financeiro.ts.
 *
 * Comissões (tela financeiro.comissoes; dono do registro = `commission.userId`):
 *  - seção "Minhas comissões" (financeiro.comissoes.minhas.ver) libera as PRÓPRIAS;
 *  - seção "Todas as comissões" (financeiro.comissoes.todas.ver) libera as de terceiros DENTRO do escopo da tela
 *    (resolveDataScope): padrão empresa para admin/diretoria/equipe financeira, equipe para gestor de outra área
 *    (departamento próprio ∪ departamentos que lidera ∪ liderados diretos), "meus" para os demais — o mesmo resultado
 *    do antigo commissionScopeFor/resolveCommissionScope (conferido em tests/permissions/scope.test.ts);
 *  - sem as duas seções, nada é lido (quem não tem a tela vê só as próprias nos outros contextos — Meu Desempenho,
 *    relatório —, como antes; ver commissionVisibility).
 * Contas a Pagar (tela financeiro.contas-a-pagar; dono = `payable.creditorId`): escopo empresa vê todos os títulos
 * (inclusive de fornecedor, sem creditorId); escopo menor vê só os títulos cujo credor está no escopo.
 * Registro fora do escopo: a página não abre o painel; a action lança PermissionError.
 */
import { cache } from "react";
import { can } from "@/server/auth/permissions";
import { BusinessError, PermissionError } from "@/server/auth/error-classes";
import { resolveDataScope, type DataScope } from "@/server/auth/scope";
import { getById, list } from "@/server/db";
import { COLLECTIONS, type Commission, type CurrentUser, type Payable, type User } from "@/domain/types";
import type { ScreenKey } from "@/domain/permissions";

export const COMMISSIONS_SCREEN = "financeiro.comissoes" as const satisfies ScreenKey;
export const PAYABLES_SCREEN = "financeiro.contas-a-pagar" as const satisfies ScreenKey;

export const COMMISSION_DENIED = "Esta comissão está fora do seu escopo de acesso";
export const PAYABLE_DENIED = "Este título está fora do seu escopo de acesso";

type ScopeCut = Pick<DataScope, "kind" | "userIds" | "departmentKeys">;
type Person = Pick<User, "id" | "departmentId" | "active">;

// ---------------------------------------------------------------------------
// Visibilidade (puro)
// ---------------------------------------------------------------------------

/** Pessoas de um recorte; null = sem recorte (empresa). Departamentos viram as pessoas ativas lotadas neles. */
export function scopePeople(scope: ScopeCut, people: readonly Person[]): Set<string> | null {
  if (!scope.userIds && !scope.departmentKeys) return null;
  const ids = new Set(scope.userIds ?? []);
  if (scope.departmentKeys) for (const p of people) if (p.active !== false && scope.departmentKeys.has(p.departmentId)) ids.add(p.id);
  return ids;
}

export interface CommissionVisibility {
  viewerId: string;
  /** Seção "Minhas comissões". */
  own: boolean;
  /** Seção "Todas as comissões" com escopo maior que "meus". */
  others: boolean;
  /** Donos visíveis; null = todos (empresa). */
  ownerIds: ReadonlySet<string> | null;
  /** Com `ownerIds` null: as próprias ficam fora (Todas sem Minhas). */
  excludeSelf: boolean;
  /** Rótulo da visão: todas, equipe, próprias ou nenhuma. */
  kind: "all" | "team" | "own" | "none";
}

/** Visibilidade de comissões a partir das seções e do escopo já resolvido (puro). */
export function buildCommissionVisibility(viewerId: string, flags: { own: boolean; all: boolean }, scope: ScopeCut | null, people: readonly Person[] = []): CommissionVisibility {
  const others = flags.all && scope !== null && scope.kind !== "meus";
  let ownerIds: Set<string> | null;
  if (others) ownerIds = scopePeople(scope!, people);
  else ownerIds = new Set(flags.own ? [viewerId] : []);
  if (ownerIds) {
    if (flags.own) ownerIds.add(viewerId);
    else ownerIds.delete(viewerId);
  }
  const excludeSelf = ownerIds === null && !flags.own;
  const kind: CommissionVisibility["kind"] = ownerIds === null ? "all" : ownerIds.size === 0 ? "none" : others ? "team" : "own";
  return { viewerId, own: flags.own, others, ownerIds, excludeSelf, kind };
}

/** A visibilidade permite a comissão deste dono? */
export function commissionAllowed(vis: CommissionVisibility, ownerId: string | undefined | null): boolean {
  if (!ownerId) return false;
  if (vis.ownerIds === null) return !(vis.excludeSelf && ownerId === vis.viewerId);
  return vis.ownerIds.has(ownerId);
}

export interface PayableVisibility {
  /** Credores visíveis; null = todos os títulos (inclusive os sem credor colaborador). */
  creditorIds: ReadonlySet<string> | null;
}

/** O escopo de Contas a Pagar permite o título? Sem creditorId, só com escopo empresa. */
export function payableAllowed(vis: PayableVisibility, payable: Pick<Payable, "creditorId">): boolean {
  if (vis.creditorIds === null) return true;
  return Boolean(payable.creditorId) && vis.creditorIds.has(payable.creditorId!);
}

// ---------------------------------------------------------------------------
// Resolução (servidor, memo por requisição)
// ---------------------------------------------------------------------------

const loadPeople = cache(async (): Promise<Person[]> => list<User>(COLLECTIONS.users));

async function peopleFor(scope: ScopeCut): Promise<Person[]> {
  return scope.departmentKeys ? loadPeople() : [];
}

/**
 * Visibilidade de comissões do usuário (seções Minhas/Todas + escopo da tela). Fora da tela Comissões (card do Meu
 * Desempenho, relatório), quem não tem a tela — ex.: papel sem os módulos Financeiro/Vendas — continua vendo as
 * PRÓPRIAS, como antes; com a tela, a seção "Minhas comissões" decide.
 */
export const commissionVisibility = cache(async (viewer: CurrentUser): Promise<CommissionVisibility> => {
  const own = can(viewer, "financeiro.comissoes.minhas.ver") || !can(viewer, "financeiro.comissoes.ver");
  const all = can(viewer, "financeiro.comissoes.todas.ver");
  if (!all) return buildCommissionVisibility(viewer.id, { own, all }, null);
  const scope = await resolveDataScope(viewer, COMMISSIONS_SCREEN);
  return buildCommissionVisibility(viewer.id, { own, all }, scope, await peopleFor(scope));
});

/** Visibilidade de títulos do usuário (escopo de Contas a Pagar). Sem a tela, nenhum título. */
export const payableVisibility = cache(async (viewer: CurrentUser): Promise<PayableVisibility> => {
  if (!can(viewer, "financeiro.contas-a-pagar.ver")) return { creditorIds: new Set() };
  const scope = await resolveDataScope(viewer, PAYABLES_SCREEN);
  return { creditorIds: scopePeople(scope, await peopleFor(scope)) };
});

// ---------------------------------------------------------------------------
// Asserções por registro (Server Actions)
// ---------------------------------------------------------------------------

/** Comissão existente e visível para o usuário; fora do escopo = PermissionError. */
export async function assertCommissionAccess(user: CurrentUser, commissionId: string): Promise<Commission> {
  const commission = await getById<Commission>(COLLECTIONS.commissions, commissionId);
  if (!commission) throw new BusinessError("Comissão não encontrada");
  if (!commissionAllowed(await commissionVisibility(user), commission.userId)) throw new PermissionError(COMMISSION_DENIED);
  return commission;
}

/** Título existente e visível para o usuário; fora do escopo = PermissionError. */
export async function assertPayableAccess(user: CurrentUser, payableId: string): Promise<Payable> {
  const payable = await getById<Payable>(COLLECTIONS.payables, payableId);
  if (!payable) throw new BusinessError("Título não encontrado");
  if (!payableAllowed(await payableVisibility(user), payable)) throw new PermissionError(PAYABLE_DENIED);
  return payable;
}

/** Lançamento manual: com escopo menor que empresa, só para colaborador dentro do escopo (fornecedor exige empresa). */
export async function assertCreditorInScope(user: CurrentUser, creditor: { creditorType: "colaborador" | "fornecedor"; creditorId?: string }): Promise<void> {
  const vis = await payableVisibility(user);
  if (vis.creditorIds === null) return;
  const creditorId = creditor.creditorType === "colaborador" ? creditor.creditorId : undefined;
  if (!payableAllowed(vis, { creditorId })) throw new PermissionError("O credor está fora do seu escopo em Contas a Pagar");
}

// ---------------------------------------------------------------------------
// Capacidades (interface: só esconde; as actions revalidam)
// ---------------------------------------------------------------------------

export interface CommissionCapabilities {
  reverse: boolean;
  block: boolean;
  unblock: boolean;
  regenerate: boolean;
}

export function commissionCapabilities(user: CurrentUser): CommissionCapabilities {
  return {
    reverse: can(user, "financeiro.comissoes.estornar"),
    block: can(user, "financeiro.comissoes.bloquear"),
    unblock: can(user, "financeiro.comissoes.desbloquear"),
    regenerate: can(user, "financeiro.comissoes.gerar-titulo"),
  };
}

export interface PayableCapabilities {
  approve: boolean;
  /** Aprovar título de comissão/estorno exige também "Aprovar comissão". */
  approveCommission: boolean;
  schedule: boolean;
  pay: boolean;
  /** Desfazer pagamento (etapa CP/CR 2): título volta a "A pagar" e o lançamento de caixa é apagado. */
  undoPayment: boolean;
  edit: boolean;
  attach: boolean;
  cancel: boolean;
  create: boolean;
  /** Seção Fornecedores (link do cabeçalho). */
  suppliers: boolean;
  /** Seção Fluxo de caixa. */
  cashFlow: boolean;
  /** Alguma operação de título (lançar, alterar, programar, anexar, cancelar). */
  operate: boolean;
  readOnly: boolean;
}

export function payableCapabilities(user: CurrentUser): PayableCapabilities {
  const edit = can(user, "financeiro.contas-a-pagar.editar");
  const schedule = can(user, "financeiro.contas-a-pagar.programar");
  const attach = can(user, "financeiro.contas-a-pagar.anexar");
  const cancel = can(user, "financeiro.contas-a-pagar.cancelar");
  const create = can(user, "financeiro.contas-a-pagar.criar");
  const operate = edit || schedule || attach || cancel || create;
  return {
    approve: can(user, "financeiro.contas-a-pagar.aprovar"),
    approveCommission: can(user, "financeiro.comissoes.aprovar"),
    schedule,
    pay: can(user, "financeiro.contas-a-pagar.pagar"),
    undoPayment: can(user, "financeiro.contas-a-pagar.desfazer-pagamento"),
    edit,
    attach,
    cancel,
    create,
    suppliers: can(user, "financeiro.contas-a-pagar.fornecedores.ver"),
    cashFlow: can(user, "financeiro.contas-a-pagar.fluxo-caixa.ver"),
    operate,
    readOnly: !operate,
  };
}

/** Origem de título que é aprovação de comissão (exige financeiro.comissoes.aprovar além de aprovar o título). */
export function isCommissionPayable(payable: Pick<Payable, "origin">): boolean {
  return payable.origin === "comissao_automatica" || payable.origin === "estorno";
}
