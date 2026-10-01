/**
 * Navegação derivada do catálogo (A2/A11): itens de menu, barra inferior do celular e atalhos "+".
 * Puro: recebe a função de permissão efetiva (`has`) e devolve o que o usuário vê. A aplicação no layout e no
 * /menu é da fase de navegação; por ora serve à equivalência T0 com o filtro atual.
 */
import { MODULES, type PermissionKey } from "./catalog";
import { evaluateRule, type RuleContext, type RuleSubject } from "./rules";
import type { ModuleKey, NavDef, QuickActionDef, ScreenDef } from "./types";

export interface DerivedNavItem {
  screen: string;
  label: string;
  href: string;
  icon: string;
  order: number;
}

export interface DerivedNavSection {
  key: ModuleKey;
  label: string;
  items: DerivedNavItem[];
}

type Has = (key: PermissionKey) => boolean;

function itemVisible(screen: ScreenDef, nav: NavDef, subject: RuleSubject, has: Has): boolean {
  if (!has(`${screen.key}.ver` as PermissionKey)) return false;
  if (!nav.rule) return true;
  const ctx: RuleContext = { can: (k) => has(k as PermissionKey) };
  return evaluateRule(nav.rule, subject, ctx);
}

/** Seções e itens do menu lateral visíveis; a seção aparece se tiver ao menos um item. */
export function deriveNavigation(subject: RuleSubject, has: Has): DerivedNavSection[] {
  const sections: DerivedNavSection[] = [];
  for (const m of MODULES) {
    const items: DerivedNavItem[] = [];
    for (const screen of m.screens as readonly ScreenDef[]) {
      const nav = screen.nav;
      if (!nav || nav.menu !== m.key || nav.order === undefined) continue;
      if (!itemVisible(screen, nav, subject, has)) continue;
      items.push({ screen: screen.key, label: nav.label ?? screen.label, href: nav.href, icon: nav.icon ?? "Circle", order: nav.order });
    }
    if (items.length) sections.push({ key: m.key, label: m.label, items: items.sort((a, b) => a.order - b.order) });
  }
  return sections;
}

/** Itens da barra inferior do celular (MOBILE_NAV) visíveis, na ordem. */
export function deriveMobileNav(has: Has): { screen: string; href: string; position: number }[] {
  const out: { screen: string; href: string; position: number }[] = [];
  for (const m of MODULES) {
    for (const screen of m.screens as readonly ScreenDef[]) {
      const nav = screen.nav;
      if (!nav || nav.mobile === undefined) continue;
      if (!has(`${screen.key}.ver` as PermissionKey)) continue;
      out.push({ screen: screen.key, href: nav.href, position: nav.mobile });
    }
  }
  return out.sort((a, b) => a.position - b.position);
}

/** Atalhos "+" visíveis: can(via) ∧ regra do atalho. */
export function deriveQuickActions(subject: RuleSubject, has: Has): QuickActionDef[] {
  const out: QuickActionDef[] = [];
  const ctx: RuleContext = { can: (k) => has(k as PermissionKey) };
  for (const m of MODULES) {
    for (const screen of m.screens as readonly ScreenDef[]) {
      const qa = screen.nav?.quickAction;
      if (!qa) continue;
      if (!has(qa.via as PermissionKey)) continue;
      if (!evaluateRule(qa.rule, subject, ctx)) continue;
      out.push(qa);
    }
  }
  return out.sort((a, b) => a.order - b.order);
}
