/**
 * Permissões de Comissões e Contas a Pagar — fachadas SÍNCRONAS do catálogo de acessos (chaves financeiro.comissoes.*
 * e financeiro.contas-a-pagar.*, src/domain/permissions/financeiro.ts), avaliadas sempre no servidor. Mantêm nome e
 * assinatura dos predicados antigos (D15) e delegam para `can`; com um CurrentUser valem perfil, exceções e módulos
 * ativos; com outro objeto, a matriz padrão do papel/departamento — o mesmo resultado de antes do catálogo.
 *
 * Visibilidade por registro (seções Minhas/Todas e escopo da tela) e asserções das actions: ./access.ts.
 */
import type { CurrentUser } from "@/domain/types";
import { can, permissionsOf } from "@/server/auth/permissions";

export type PermissionUser = Pick<CurrentUser, "id" | "role" | "departmentId" | "isAdmin" | "isManager" | "isDirector"> & Partial<Pick<CurrentUser, "permissions">>;

/**
 * Vê as comissões de TODOS (sem recorte): seção "Todas as comissões" com escopo empresa na tela. Padrão = equipe
 * financeira, admin e diretoria (o antigo isFinanceTeam).
 */
export function canViewAllCommissions(user: PermissionUser): boolean {
  return can(user, "financeiro.comissoes.todas.ver") && permissionsOf(user).scopes["financeiro.comissoes"] === "empresa";
}

export function canManageCommissionRules(user: PermissionUser): boolean {
  return can(user, "financeiro.comissoes.regras.editar");
}

/** Ver as regras (inclui o acesso ao módulo Financeiro, como a página exige). */
export function canViewCommissionRules(user: PermissionUser): boolean {
  return can(user, "financeiro.comissoes.regras.ver");
}

export function canApprovePayables(user: PermissionUser): boolean {
  return can(user, "financeiro.contas-a-pagar.aprovar");
}

export function canPayPayables(user: PermissionUser): boolean {
  return can(user, "financeiro.contas-a-pagar.pagar");
}

/** Operar títulos (lançar, alterar, programar, cancelar, anexar, fornecedores). Exige o módulo Financeiro (A14). */
export function canOperatePayables(user: PermissionUser): boolean {
  return can(user, "financeiro.contas-a-pagar.editar");
}

/** Ver Contas a Pagar (inclui o acesso ao módulo Financeiro, como a página exige). */
export function canViewPayables(user: PermissionUser): boolean {
  return can(user, "financeiro.contas-a-pagar.ver");
}

/** Estornar, cancelar manualmente, bloquear/desbloquear ou regerar o título de uma comissão. */
export function canReverseCommission(user: PermissionUser): boolean {
  return can(user, "financeiro.comissoes.estornar");
}

/** Visão de comissões do usuário (fachada usada por relatórios): todas, equipe (lista de donos) ou próprias. */
export type CommissionScope = { kind: "all" } | { kind: "team"; userIds: string[] } | { kind: "own"; userIds: string[] };
