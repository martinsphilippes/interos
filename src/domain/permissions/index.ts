/**
 * Catálogo de acessos do INTEROS (A2/A24) — ponto de entrada.
 *
 * Hierarquia: MÓDULO (`<m>.acessar`) → TELA (`<m>.<tela>.ver`) → SEÇÃO (`<m>.<tela>.<secao>.ver`) → AÇÃO
 * (`<m>.<tela>[.<secao>].<verbo>`) → ESCOPO por tela. Cada nó tem uma regra padrão (DSL em `types.ts`) que reproduz
 * o comportamento anterior ao catálogo; a resolução (perfil, exceção, módulos ativos) fica em
 * `src/server/auth/permissions.ts`.
 *
 * Para adicionar uma tela ou ação: declare-a no arquivo do módulo (chave estável em pt-kebab, rótulo de negócio,
 * regra padrão e `guards`), proteja a página com `requireScreen` e a action com `requirePermission`, e rode `npm test`
 * (a integridade do catálogo é verificada).
 */
export * from "./types";
export {
  MODULES,
  SCREENS,
  MODULE_BY_KEY,
  SCREEN_BY_KEY,
  PROTECTED_KEYS,
  SETTING_PERMISSION,
  PERMISSION_NODES,
  NODE_BY_KEY,
  PERMISSION_KEYS,
  moduleAccessKey,
  screenViewKey,
  isPermissionKey,
  isScreenKey,
  nodeViewKey,
  type ScreenKey,
  type SectionKey,
  type ActionKey,
  type ModuleAccessKey,
  type ScreenViewKey,
  type PermissionKey,
  type ScreenNodeKey,
  type NodeKind,
  type PermissionNode,
} from "./catalog";
export { evaluateRule, describeRule, deriveSubject, isValidRule, ruleReferences, type RuleSubject, type RuleContext } from "./rules";
export { deriveNavigation, deriveMobileNav, deriveQuickActions, type DerivedNavItem, type DerivedNavSection } from "./navigation";
export { EXEMPTIONS, DELIBERATE_CORRECTIONS } from "./exemptions";
export type { EffectivePermissions, PermissionOrigin } from "./effective";
