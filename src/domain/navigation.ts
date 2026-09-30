/**
 * Tabelas de navegação derivadas do catálogo de acessos (antes escritas à mão em `constants.ts`, que mantém os tipos):
 * - NAVIGATION: menu lateral, drawer e /menu (seção = módulo, na ordem do catálogo);
 * - MOBILE_NAV: barra inferior do celular (Início · Tarefas · [+] · Clientes · Mais);
 * - QUICK_ACTIONS: atalhos do botão "+".
 * O href continua sendo a chave de lookup. O que cada usuário vê é filtrado no servidor (src/server/auth/navigation.ts).
 * Ficam fora de `constants.ts` porque dependem do catálogo inteiro: Client Components que importam rótulos de lá não
 * devem carregar o catálogo no navegador. Só código de servidor (e testes) importa daqui.
 */
import type { NavItem, NavSection, QuickAction } from "./constants";
import { buildMobileNavTable, buildNavigationTable, buildQuickActionsTable } from "./permissions/nav-table";

export const NAVIGATION: NavSection[] = buildNavigationTable();
export const MOBILE_NAV: NavItem[] = buildMobileNavTable();
export const QUICK_ACTIONS: QuickAction[] = buildQuickActionsTable();
