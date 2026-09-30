/**
 * Menu e atalhos pelas permissões efetivas (A11): item visível = can(tela.ver) ∧ regra do item (nav.rule); atalho
 * "+" visível = can(ação de criação) ∧ regra do atalho. Usado pelo layout e pela página /menu. Devolve os mesmos
 * objetos de NAVIGATION/QUICK_ACTIONS (ícone, onda, descrição), só filtrados.
 */
import { NAVIGATION, QUICK_ACTIONS, type NavSection, type QuickAction } from "@/domain/constants";
import { deriveNavigation, deriveQuickActions, deriveSubject } from "@/domain/permissions";
import type { CurrentUser } from "@/domain/types";
import { permissionsOf } from "./permissions";

type NavUser = Pick<CurrentUser, "id" | "role" | "departmentId"> & { permissions?: CurrentUser["permissions"] };

export function visibleNavigation(user: NavUser): NavSection[] {
  const perms = permissionsOf(user);
  const derived = deriveNavigation(deriveSubject(user), perms.has);
  const visible = new Set(derived.flatMap((s) => s.items.map((i) => i.href)));
  return NAVIGATION.map((section) => ({ ...section, items: section.items.filter((item) => visible.has(item.href)) })).filter((section) => section.items.length > 0);
}

export function visibleQuickActions(user: NavUser): QuickAction[] {
  const perms = permissionsOf(user);
  const keys = new Set(deriveQuickActions(deriveSubject(user), perms.has).map((q) => q.key));
  return QUICK_ACTIONS.filter((q) => keys.has(q.key));
}
