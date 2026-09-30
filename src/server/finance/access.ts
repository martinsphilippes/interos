/**
 * Predicados de autorização do Financeiro (fachadas do catálogo de acessos). Só no servidor: páginas, queries e
 * Server Actions. Os Client Components recebem o resultado por props (nunca decidem operação).
 */
import "server-only";
import type { EffectivePermissions } from "@/domain/permissions";
import { can, type PermissionHolder } from "@/server/auth/permissions";

/**
 * Quem opera o Financeiro (altera contratos e cobranças): equipe financeira, gestores, diretoria e admin — COM o
 * módulo Financeiro. Fachada de `financeiro.contratos.editar` (as operações de contrato e cobrança têm a mesma regra
 * padrão). Semântica ampliada em relação ao predicado antigo (finance/schemas.ts antes do catálogo), que não incluía
 * o módulo: papéis sem o módulo lotados no departamento financeiro (cs, marketing, suporte, implantação,
 * colaborador) passam a false. Nenhum chamador sente a diferença: todos exigem o módulo antes (requireFinanceOperator
 * e as páginas do Financeiro) — provado em tests/permissions/equivalence.test.ts.
 */
export function canOperateFinance(user: { isAdmin: boolean; isManager: boolean; role: string; departmentId: string; permissions?: EffectivePermissions }): boolean {
  return can(user as PermissionHolder, "financeiro.contratos.editar");
}
