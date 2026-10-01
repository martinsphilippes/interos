/**
 * Tabelas estáticas de navegação DERIVADAS do catálogo (A2/A11): NAVIGATION (menu lateral e /menu), MOBILE_NAV
 * (barra inferior do celular) e QUICK_ACTIONS (atalhos "+"). O href continua sendo a chave de lookup; o que cada
 * usuário vê é decidido no servidor (src/server/auth/navigation.ts) pelas permissões efetivas.
 *
 * Depende só do catálogo (sem regras nem constantes em tempo de execução), para `constants.ts` poder reexportar as
 * tabelas sem ciclo de importação.
 */
import type { NavItem, NavSection, QuickAction, RoleKey } from "../constants";
import { MODULES } from "./catalog";
import type { AccessRule, ScreenDef } from "./types";

function screensOf(m: (typeof MODULES)[number]): readonly ScreenDef[] {
  return m.screens as readonly ScreenDef[];
}

/** Itens de menu por módulo, na ordem do catálogo (`nav.menu` = módulo e `nav.order` definido). */
export function buildNavigationTable(): NavSection[] {
  const sections: NavSection[] = [];
  for (const m of MODULES) {
    const items = screensOf(m)
      .filter((s) => s.nav && s.nav.menu === m.key && s.nav.order !== undefined)
      .sort((a, b) => (a.nav!.order ?? 0) - (b.nav!.order ?? 0))
      .map((s): NavItem => {
        const nav = s.nav!;
        return { label: nav.label ?? s.label, href: nav.href, icon: nav.icon ?? "Circle", wave: nav.wave, screen: s.key };
      });
    if (items.length) sections.push({ key: m.key, label: m.label, items });
  }
  return sections;
}

/** Barra inferior do celular: telas com `nav.mobile`, na posição declarada. */
export function buildMobileNavTable(): NavItem[] {
  return MODULES.flatMap((m) => screensOf(m))
    .filter((s) => s.nav?.mobile !== undefined)
    .sort((a, b) => a.nav!.mobile! - b.nav!.mobile!)
    .map((s): NavItem => {
      const nav = s.nav!;
      return { label: nav.mobileLabel ?? nav.label ?? s.label, href: nav.href, icon: nav.mobileIcon ?? nav.icon ?? "Circle", screen: s.key };
    });
}

/** Papéis listados numa regra `{ role }` (sem o admin, que o tipo QuickAction já pressupõe). Outras regras: undefined. */
function rolesOf(rule: AccessRule): readonly RoleKey[] | undefined {
  if (typeof rule !== "object" || !("role" in rule)) return undefined;
  const roles = (Array.isArray(rule.role) ? rule.role : [rule.role]) as RoleKey[];
  return roles.filter((r) => r !== "admin");
}

/** Atalhos "+": `nav.quickAction` das telas donas, na ordem declarada. */
export function buildQuickActionsTable(): QuickAction[] {
  return MODULES.flatMap((m) => screensOf(m))
    .filter((s) => s.nav?.quickAction)
    .map((s) => ({ screen: s, qa: s.nav!.quickAction! }))
    .sort((a, b) => a.qa.order - b.qa.order)
    .map(({ screen, qa }): QuickAction => {
      const roles = rolesOf(qa.rule);
      return {
        key: qa.key,
        label: qa.label,
        description: qa.description,
        href: qa.href,
        icon: qa.icon,
        module: screen.module,
        ...(roles ? { roles } : {}),
        screen: screen.key,
        via: qa.via,
      };
    });
}
