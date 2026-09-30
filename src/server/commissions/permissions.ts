/**
 * Permissões de Comissões e Contas a Pagar (D15) — predicados PUROS, avaliados sempre no servidor (páginas, queries
 * e Server Actions). A equipe do "gestor" (quem ele enxerga) vem de getPerformanceAccess e é resolvida em queries.ts.
 *
 * - Ver comissões: financeiro/admin/diretoria veem todas; gestor, as da equipe; demais (vendedor), só as próprias.
 * - Configurar regras, criar exceção, aprovar/pagar título, estornar/bloquear comissão: admin, diretoria ou gestor do
 *   Financeiro (isManager + papel/departamento financeiro).
 * - Operar títulos (programar, cancelar, lançar título manual, alterar): equipe financeira, admin e diretoria.
 * - Contas a Pagar (ver): equipe financeira, admin, diretoria e gestores (gestor fora do Financeiro vê só os títulos
 *   da equipe, somente leitura). Vendedor: sem acesso (redirecionado com aviso).
 * - Regras (ver): equipe financeira e gestores; vendedor: sem acesso.
 */
import type { CurrentUser } from "@/domain/types";

export type PermissionUser = Pick<CurrentUser, "id" | "role" | "departmentId" | "isAdmin" | "isManager" | "isDirector">;

/** Equipe financeira, diretoria e admin. */
export function isFinanceTeam(user: PermissionUser): boolean {
  return user.isAdmin || user.isDirector || user.role === "diretoria" || user.role === "financeiro" || user.departmentId === "financeiro";
}

/** Gestor do Financeiro (ou admin/diretoria): aprova, paga, estorna e configura regras. */
export function isFinanceManager(user: PermissionUser): boolean {
  return user.isAdmin || user.isDirector || user.role === "diretoria" || (user.isManager && (user.role === "financeiro" || user.departmentId === "financeiro"));
}

export function canViewAllCommissions(user: PermissionUser): boolean {
  return isFinanceTeam(user);
}

export function canManageCommissionRules(user: PermissionUser): boolean {
  return isFinanceManager(user);
}

export function canViewCommissionRules(user: PermissionUser): boolean {
  return isFinanceTeam(user) || user.isManager;
}

export function canApprovePayables(user: PermissionUser): boolean {
  return isFinanceManager(user);
}

export function canPayPayables(user: PermissionUser): boolean {
  return isFinanceManager(user);
}

export function canOperatePayables(user: PermissionUser): boolean {
  return isFinanceTeam(user);
}

export function canViewPayables(user: PermissionUser): boolean {
  return isFinanceTeam(user) || user.isManager;
}

/** Estornar, cancelar manualmente, bloquear/desbloquear ou regerar o título de uma comissão. */
export function canReverseCommission(user: PermissionUser): boolean {
  return isFinanceManager(user);
}

export type CommissionScope = { kind: "all" } | { kind: "team"; userIds: string[] } | { kind: "own"; userIds: string[] };

/** Escopo de comissões visíveis dado o conjunto de colaboradores que o gestor enxerga (getPerformanceAccess). */
export function commissionScopeFor(user: PermissionUser, teamUserIds: string[]): CommissionScope {
  if (canViewAllCommissions(user)) return { kind: "all" };
  if (user.isManager) return { kind: "team", userIds: Array.from(new Set([user.id, ...teamUserIds])) };
  return { kind: "own", userIds: [user.id] };
}

export function scopeAllows(scope: CommissionScope, userId: string | undefined): boolean {
  if (scope.kind === "all") return true;
  return Boolean(userId) && scope.userIds.includes(userId!);
}
