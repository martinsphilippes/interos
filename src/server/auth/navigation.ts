/**
 * Navegação pelas permissões efetivas (A11) — ponto único usado pelo layout, pela página /menu, pela barra do
 * celular, pelos atalhos "+" e pelas listas fixas do shell (busca, ajuda, menu do usuário).
 *
 * - item de menu visível = can(`<tela>.ver`) ∧ regra do item (`nav.rule`);
 * - item da barra do celular visível = can(`<tela>.ver`);
 * - atalho "+" visível = can(ação de criação `via`) ∧ regra do atalho;
 * - link fixo visível = visibilidade do atalho "+" correspondente ou canSeeHref(href).
 *
 * Devolve os mesmos objetos de NAVIGATION/MOBILE_NAV/QUICK_ACTIONS (derivados do catálogo), só filtrados. O mapa de
 * rotas (hrefAccessMap) vai ao cliente apenas para OCULTAR links (useCanSee/ScreenLink); nenhuma operação é
 * autorizada por ele.
 */
import type { NavItem, NavSection, QuickAction, ShellLink } from "@/domain/constants";
import { MOBILE_NAV, NAVIGATION, QUICK_ACTIONS } from "@/domain/navigation";
import { SCREENS, deriveMobileNav, deriveNavigation, deriveQuickActions, deriveSubject, type PermissionKey, type ScreenKey } from "@/domain/permissions";
import type { HrefAccessEntry, HrefAccessMap } from "@/domain/permissions/href";
import type { CurrentUser } from "@/domain/types";
import { canAny, canSeeHref, permissionsOf, routeTableEntries, sectionKeysForTab, tabsForKeys } from "./permissions";

type NavUser = Pick<CurrentUser, "id" | "role" | "departmentId"> & { permissions?: CurrentUser["permissions"] };

/** Seções e itens do menu lateral (e de /menu) visíveis ao usuário, na ordem do catálogo. */
export function filterNavigation(user: NavUser): NavSection[] {
  const perms = permissionsOf(user);
  const derived = deriveNavigation(deriveSubject(user), perms.has);
  const visible = new Set(derived.flatMap((s) => s.items.map((i) => i.href)));
  return NAVIGATION.map((section) => ({ ...section, items: section.items.filter((item) => visible.has(item.href)) })).filter((section) => section.items.length > 0);
}

/** Itens da barra inferior do celular visíveis ao usuário, na ordem. */
export function filterMobileNav(user: NavUser): NavItem[] {
  const perms = permissionsOf(user);
  const visible = new Set(deriveMobileNav(perms.has).map((i) => i.href));
  return MOBILE_NAV.filter((item) => visible.has(item.href));
}

/** Atalhos "+" visíveis ao usuário, na ordem. */
export function filterQuickActions(user: NavUser): QuickAction[] {
  const perms = permissionsOf(user);
  const keys = new Set(deriveQuickActions(deriveSubject(user), perms.has).map((q) => q.key));
  return QUICK_ACTIONS.filter((q) => keys.has(q.key));
}

/** Telas do catálogo que o usuário vê (`<tela>.ver` efetivo). */
export function visibleScreens(user: NavUser): Set<ScreenKey> {
  const perms = permissionsOf(user);
  return new Set(SCREENS.filter((s) => perms.has(`${s.key}.ver` as PermissionKey)).map((s) => s.key as ScreenKey));
}

/** Links fixos do shell visíveis: atalho "+" correspondente (quando indicado) ou canSeeHref(href). */
export function filterShellLinks(user: NavUser, links: readonly ShellLink[], quickActions: readonly QuickAction[] = filterQuickActions(user)): ShellLink[] {
  const quick = new Set(quickActions.map((q) => q.key));
  return links.filter((link) => (link.quickAction ? quick.has(link.quickAction) : canSeeHref(user, link.href)));
}

/**
 * Visibilidade de cada rota do catálogo para o usuário (entregue ao AccessProvider do shell). canSeeHrefIn(mapa, href)
 * dá o mesmo resultado de canSeeHref(user, href) — verificado nos testes.
 */
export function hrefAccessMap(user: NavUser): HrefAccessMap {
  const routes: HrefAccessEntry[] = routeTableEntries().map((entry) => {
    const visible = canAny(user, entry.keys);
    const tabs = visible ? tabsForKeys(entry.keys) : [];
    if (!tabs.length) return { p: entry.pattern, v: visible };
    const t: Record<string, boolean> = {};
    for (const tab of tabs) t[tab] = canAny(user, sectionKeysForTab(entry.keys, tab));
    return { p: entry.pattern, v: visible, t };
  });
  return { routes };
}

/** @deprecated Use filterNavigation (mesmo resultado; nome mantido para os importadores existentes). */
export const visibleNavigation = filterNavigation;
/** @deprecated Use filterQuickActions (mesmo resultado; nome mantido para os importadores existentes). */
export const visibleQuickActions = filterQuickActions;
