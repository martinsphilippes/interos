/**
 * Predicados de autorização da Implantação (fachadas do catálogo de acessos). Só no servidor: páginas, queries e
 * Server Actions. Os Client Components recebem o resultado por props (nunca decidem operação).
 */
import "server-only";
import type { EffectivePermissions } from "@/domain/permissions";
import { can, type PermissionHolder } from "@/server/auth/permissions";

/**
 * Quem opera a implantação (Suporte e CS apenas consultam): equipe de implantação e gestores — COM o módulo.
 * Fachada de `implantacao.projetos.atribuir` (as operações de implantação têm a mesma regra padrão). Semântica
 * ampliada em relação ao predicado antigo, que não incluía o módulo: papéis sem o módulo lotados no departamento
 * implantação (vendas, marketing, financeiro, colaborador) passam a false. Nenhum chamador sente a diferença: todos
 * exigem o módulo antes (requireOperator e as páginas da Implantação) — provado em tests/permissions/equivalence.test.ts.
 */
export function canOperateImplementation(user: { isAdmin: boolean; isManager: boolean; role: string; departmentId: string; permissions?: EffectivePermissions }): boolean {
  return can(user as PermissionHolder, "implantacao.projetos.atribuir");
}
