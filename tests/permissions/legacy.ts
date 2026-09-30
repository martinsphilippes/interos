/**
 * Oráculo da equivalência T0: cópia CONGELADA dos predicados de acesso como estavam antes do catálogo (commit
 * 7a885f5). Não importe estas funções no código da aplicação — elas existem só para provar que as regras padrão do
 * catálogo reproduzem o comportamento anterior.
 */
import type { DepartmentKey, RoleKey } from "@/domain/constants";
import { LEGACY_MOBILE_NAV as MOBILE_NAV, LEGACY_NAVIGATION as NAVIGATION, LEGACY_QUICK_ACTIONS as QUICK_ACTIONS } from "./legacy-navigation";
import { REPORT_DEFINITIONS, type ReportKey } from "@/server/reports/definitions";

export interface LegacyUser {
  id: string;
  role: RoleKey;
  departmentId: DepartmentKey;
  isAdmin: boolean;
  isManager: boolean;
  isDirector: boolean;
}

export function legacyUser(u: { id: string; role: RoleKey; departmentId: DepartmentKey }): LegacyUser {
  return {
    ...u,
    isAdmin: u.role === "admin",
    isManager: u.role === "gestor" || u.role === "admin" || u.role === "diretoria",
    isDirector: u.role === "diretoria" || u.role === "admin",
  };
}

/** constants.ts:57-69 (antes do catálogo). */
export const LEGACY_MODULE_ACCESS: Record<string, readonly RoleKey[] | "all"> = {
  inicio: "all",
  operacao: "all",
  marketing: ["diretoria", "gestor", "marketing", "vendas"],
  vendas: ["diretoria", "gestor", "vendas", "marketing", "cs", "suporte"],
  financeiro: ["diretoria", "gestor", "financeiro", "vendas"],
  implantacao: ["diretoria", "gestor", "implantacao", "suporte", "cs"],
  cs: ["diretoria", "gestor", "cs", "vendas", "suporte"],
  suporte: ["diretoria", "gestor", "suporte", "implantacao", "cs"],
  performance: "all",
  gestao: ["diretoria", "gestor"],
  admin: ["admin"],
};

/** session.ts:79-85. */
export function legacyCanAccessModule(user: LegacyUser, moduleKey: string): boolean {
  if (user.isAdmin) return true;
  const allowed = LEGACY_MODULE_ACCESS[moduleKey];
  if (!allowed) return false;
  if (allowed === "all") return true;
  return allowed.includes(user.role);
}

/** session.ts:73-77 (requireRole). */
export function legacyRequireRole(user: LegacyUser, ...roles: RoleKey[]): boolean {
  return user.isAdmin || roles.includes(user.role);
}

// commissions/permissions.ts:18-58
export const legacyIsFinanceTeam = (u: LegacyUser) => u.isAdmin || u.isDirector || u.role === "diretoria" || u.role === "financeiro" || u.departmentId === "financeiro";
export const legacyIsFinanceManager = (u: LegacyUser) => u.isAdmin || u.isDirector || u.role === "diretoria" || (u.isManager && (u.role === "financeiro" || u.departmentId === "financeiro"));
export const legacyCanViewCommissionRules = (u: LegacyUser) => legacyIsFinanceTeam(u) || u.isManager;
export const legacyCanViewPayables = (u: LegacyUser) => legacyIsFinanceTeam(u) || u.isManager;
export const legacyCanOperatePayables = (u: LegacyUser) => legacyIsFinanceTeam(u);

// finance/schemas.ts:45-47; implementation/schemas.ts:47-49; support/schemas.ts:82-88
export const legacyCanOperateFinance = (u: LegacyUser) => u.isAdmin || u.isManager || u.role === "financeiro" || u.departmentId === "financeiro";
export const legacyCanOperateImplementation = (u: LegacyUser) => u.isAdmin || u.isManager || u.role === "implantacao" || u.departmentId === "implantacao";
export const legacyCanOperateSupport = (u: LegacyUser) => u.isAdmin || u.isManager || u.role === "suporte" || u.departmentId === "suporte" || u.role === "implantacao";
export const legacyCanEditArticles = (u: LegacyUser) => u.isAdmin || u.isManager || u.role === "suporte" || u.departmentId === "suporte";

/** reports/build.ts:59-81. */
const OPERATIONAL_OWNER: Partial<Record<ReportKey, DepartmentKey>> = { oportunidades: "vendas", comissoes: "vendas", contratos: "financeiro", chamados: "suporte", clientes: "cs", contas_a_pagar: "financeiro" };
export function legacyCanAccessReport(user: LegacyUser, key: ReportKey): boolean {
  if (user.isManager) return true;
  const def = REPORT_DEFINITIONS[key];
  if (key === "tarefas") return true;
  if (key === "comissoes" && (user.role === "financeiro" || user.departmentId === "financeiro")) return true;
  if (key === "contas_a_pagar" && (user.role === "financeiro" || user.departmentId === "financeiro")) return true;
  if (key === "diretoria") return false;
  const owner = def.department ?? OPERATIONAL_OWNER[key];
  return owner === user.departmentId;
}

/** Guarda de cada página ANTES do catálogo (catalogo-acessos: viewCurrentGuard). */
export function legacyScreenAccess(user: LegacyUser, screen: string): boolean {
  const M = (m: string) => legacyCanAccessModule(user, m);
  const [module] = screen.split(".");
  switch (screen) {
    case "financeiro.comissoes":
      return M("financeiro") || M("vendas");
    case "financeiro.contas-a-pagar":
      return M("financeiro") && legacyCanViewPayables(user);
    case "financeiro.valores":
      return true; // capacidade nova, padrão = todos que veem hoje
    case "financeiro.configuracoes":
      return legacyRequireRole(user, "admin");
    case "gestao.dashboard":
      return legacyRequireRole(user, "gestor", "diretoria");
    case "gestao.cockpit":
      return legacyRequireRole(user, "diretoria");
    case "gestao.relatorios":
      return true; // requireUser (relatorios/page.tsx:25)
    case "admin.usuarios":
    case "admin.departamentos":
      return legacyRequireRole(user, "admin", "gestor", "diretoria");
  }
  if (module === "admin") return legacyRequireRole(user, "admin");
  if (module === "marketing") return true; // só requireUser (A14: passa a exigir o módulo)
  if (["inicio", "operacao", "performance"].includes(module)) return true;
  return M(module);
}

/** (app)/layout.tsx:11-17 e menu/page.tsx:16-19 (antes do catálogo). */
export function legacyMenu(user: LegacyUser): { section: string; hrefs: string[] }[] {
  return NAVIGATION.filter((section) => legacyCanAccessModule(user, section.key))
    .map((section) => ({ section: section.key, hrefs: section.items.filter((item) => user.isAdmin || !item.roles || item.roles.includes(user.role)).map((i) => i.href) }))
    .filter((s) => s.hrefs.length > 0);
}

export function legacyQuickActions(user: LegacyUser): string[] {
  return QUICK_ACTIONS.filter((a) => legacyCanAccessModule(user, a.module) && (user.isAdmin || !a.roles || a.roles.includes(user.role))).map((a) => a.key);
}

/** MOBILE_NAV sem filtro (mobile-nav.tsx:42-44). */
export function legacyMobileNav(): string[] {
  return MOBILE_NAV.map((i) => i.href);
}
