/**
 * Predicados de autorização do Suporte (fachadas do catálogo de acessos). Só no servidor: páginas, queries e
 * Server Actions. Os Client Components recebem o resultado por props (nunca decidem operação).
 */
import "server-only";
import type { EffectivePermissions } from "@/domain/permissions";
import { can, type PermissionHolder } from "@/server/auth/permissions";

type SupportUser = { isAdmin: boolean; isManager: boolean; role: string; departmentId: string; permissions?: EffectivePermissions };

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
