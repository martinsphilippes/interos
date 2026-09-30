/**
 * Resolução das permissões efetivas (A4) e helpers de consulta (can, canSeeHref).
 *
 * Precedência (determinística, documentada em docs/arquitetura.md › Autorização):
 *   1. Módulo inativo na empresa → nega tudo do módulo, para todos (inicio e admin não são desativáveis).
 *   2. Hierarquia por E lógico: efetivo(ação) = própria(ação) ∧ efetivo(seção) ∧ efetivo(tela) ∧ efetivo(módulo);
 *      tela com `moduleGate: "ativo"` exige só o módulo ativo; tela com `modules` exige QUALQUER um dos módulos.
 *   3. Valor próprio de cada nó = exceção individual ?? ajuste do perfil ?? regra padrão do catálogo.
 *   4. Escopo por tela = exceção ?? perfil ?? padrão da tela para o papel, sempre dentro de `scope.allowed`.
 *   5. Sem curto-circuito de administrador: o admin tem tudo porque as regras padrão o incluem.
 *
 * Módulo sem dependências de servidor (testável isoladamente). A leitura dos perfis fica em permission-store.ts e a
 * anexação ao usuário em session.ts.
 */
import {
  NODE_BY_KEY,
  PERMISSION_NODES,
  SCOPE_KINDS,
  SCREENS,
  SCREEN_BY_KEY,
  MODULE_KEYS,
  MODULE_BY_KEY,
  deriveSubject,
  evaluateRule,
  type EffectivePermissions,
  type ModuleKey,
  type PermissionKey,
  type PermissionOrigin,
  type RuleSubject,
  type ScopeDef,
  type ScopeKind,
  type ScreenDef,
  type ScreenKey,
} from "@/domain/permissions";
import { DEPARTMENT_KEYS, type DepartmentKey, type RoleKey } from "@/domain/constants";
import { compileRoute, findRoute, hrefTab, sortRoutes, type RoutePattern } from "@/domain/permissions/href";

/** Ajustes de acesso (perfil do papel ou exceções do usuário) como gravados em permission_profiles. */
export interface PermissionAdjustments {
  grants?: Readonly<Partial<Record<string, boolean>>>;
  scopes?: Readonly<Partial<Record<string, ScopeKind>>>;
}

export interface ResolveOptions {
  /** Documento `role_<papel>` (ajustes do perfil). */
  roleProfile?: PermissionAdjustments | null;
  /** Documento `user_<uid>` (exceções individuais). */
  userOverride?: PermissionAdjustments | null;
  /** Organização (módulos ativos). Ausente = todos os módulos ativos. */
  organization?: { activeModules?: readonly string[] } | null;
  /** Marca que a leitura dos ajustes falhou e a matriz padrão está em uso (A4.6). */
  degraded?: boolean;
}

export interface PermissionSubjectInput {
  id?: string;
  role: RoleKey;
  departmentId?: DepartmentKey | string;
  managedDepartments?: readonly DepartmentKey[];
}

const ALWAYS_ACTIVE: readonly ModuleKey[] = MODULE_KEYS.filter((m) => !MODULE_BY_KEY.get(m)?.deactivatable);

function asDepartment(value: string | undefined): DepartmentKey | undefined {
  return value && (DEPARTMENT_KEYS as readonly string[]).includes(value) ? (value as DepartmentKey) : undefined;
}

/** Módulos ativos: ausente = todos; chaves desconhecidas ignoradas; inicio e admin sempre ativos. */
export function normalizeActiveModules(activeModules: readonly string[] | undefined): Set<ModuleKey> {
  if (!activeModules) return new Set(MODULE_KEYS);
  const set = new Set<ModuleKey>(activeModules.filter((m): m is ModuleKey => (MODULE_KEYS as readonly string[]).includes(m)));
  for (const m of ALWAYS_ACTIVE) set.add(m);
  return set;
}

const SCOPE_ORDER: Record<ScopeKind, number> = { meus: 0, equipe: 1, departamento: 2, unidades: 3, empresa: 4 };

/** Mantém o escopo dentro dos permitidos: "unidades" vale "empresa"; fora da lista, o maior permitido abaixo dele. */
export function clampScope(kind: ScopeKind, allowed: readonly ScopeKind[] | undefined): ScopeKind {
  const wanted: ScopeKind = kind === "unidades" ? "empresa" : kind;
  const list = (allowed?.length ? allowed : SCOPE_KINDS).filter((k) => k !== "unidades");
  if (list.includes(wanted)) return wanted;
  const below = list.filter((k) => SCOPE_ORDER[k] < SCOPE_ORDER[wanted]).sort((a, b) => SCOPE_ORDER[b] - SCOPE_ORDER[a]);
  if (below.length) return below[0];
  return [...list].sort((a, b) => SCOPE_ORDER[a] - SCOPE_ORDER[b])[0] ?? "meus";
}

function isScopeKind(value: unknown): value is ScopeKind {
  return typeof value === "string" && (SCOPE_KINDS as readonly string[]).includes(value);
}

/** Escopo padrão da tela para o sujeito: regras de `overrides` primeiro, depois o padrão do papel. */
export function defaultScopeFor(scope: ScopeDef, subject: RuleSubject): ScopeKind {
  for (const o of scope.overrides ?? []) if (evaluateRule(o.when, subject)) return clampScope(o.scope, scope.allowed);
  const byRole = scope.defaultByRole?.[subject.role];
  if (byRole) return clampScope(byRole, scope.allowed);
  const allowed = (scope.allowed ?? ["meus"]).filter((k) => k !== "unidades");
  return [...allowed].sort((a, b) => SCOPE_ORDER[a] - SCOPE_ORDER[b])[0] ?? "meus";
}

/**
 * Ajustes saneados: só chaves PRÓPRIAS do documento (Object.keys ignora a cadeia de protótipos — um mapa gravado com
 * a chave "__proto__" vira protótipo no SDK do Firestore e não pode conceder nada), só chaves do catálogo com valor
 * booleano e só escopos válidos de telas existentes. Devolve objetos sem protótipo.
 */
export function sanitizeAdjustments(adjustments: PermissionAdjustments | null | undefined): { grants: Record<string, boolean>; scopes: Record<string, ScopeKind> } {
  const grants = Object.create(null) as Record<string, boolean>;
  const scopes = Object.create(null) as Record<string, ScopeKind>;
  const rawGrants = adjustments?.grants;
  if (rawGrants && typeof rawGrants === "object") {
    for (const key of Object.keys(rawGrants)) {
      const value = rawGrants[key];
      if (NODE_BY_KEY.has(key) && typeof value === "boolean") grants[key] = value;
    }
  }
  const rawScopes = adjustments?.scopes;
  if (rawScopes && typeof rawScopes === "object") {
    for (const key of Object.keys(rawScopes)) {
      const value = rawScopes[key];
      if (SCREEN_BY_KEY.has(key) && isScopeKind(value)) scopes[key] = value;
    }
  }
  return { grants, scopes };
}

/** Resolve as permissões efetivas de um usuário (puro). */
export function resolvePermissions(user: PermissionSubjectInput, options: ResolveOptions = {}): EffectivePermissions {
  const subject = deriveSubject({ id: user.id, role: user.role, departmentId: asDepartment(user.departmentId), managedDepartments: user.managedDepartments });
  const active = normalizeActiveModules(options.organization?.activeModules);
  const exception = sanitizeAdjustments(options.userOverride);
  const profile = sanitizeAdjustments(options.roleProfile);
  const exceptionGrants = exception.grants;
  const profileGrants = profile.grants;

  const values = new Map<string, boolean>();
  const origins = new Map<string, PermissionOrigin>();
  const visiting = new Set<string>();

  const own = (key: string): { value: boolean; origin: PermissionOrigin } => {
    if (Object.hasOwn(exceptionGrants, key)) return { value: exceptionGrants[key], origin: "excecao" };
    if (Object.hasOwn(profileGrants, key)) return { value: profileGrants[key], origin: "perfil" };
    const node = NODE_BY_KEY.get(key);
    return { value: node ? evaluateRule(node.rule, subject, { can: effective }) : false, origin: "padrao" };
  };

  function effective(key: string): boolean {
    const cached = values.get(key);
    if (cached !== undefined) return cached;
    const node = NODE_BY_KEY.get(key);
    if (!node) return false;
    if (visiting.has(key)) {
      // Ciclo em regras `{ can }` (o teste de integridade impede): falha fechada.
      console.error(`[permissoes] ciclo ao resolver ${key}`);
      return false;
    }
    visiting.add(key);
    let value: boolean;
    let origin: PermissionOrigin;
    if (!active.has(node.module)) {
      value = false;
      origin = "modulo-inativo";
    } else {
      const mine = own(key);
      if (!mine.value) {
        value = false;
        origin = mine.origin;
      } else {
        const { mode, keys } = node.requires;
        const parentsOk = keys.length === 0 || (mode === "all" ? keys.every(effective) : keys.some(effective));
        value = parentsOk;
        origin = parentsOk ? mine.origin : "hierarquia";
      }
    }
    visiting.delete(key);
    values.set(key, value);
    origins.set(key, origin);
    return value;
  }

  const keys = new Set<PermissionKey>();
  const origin = {} as Record<PermissionKey, PermissionOrigin>;
  for (const node of PERMISSION_NODES) {
    if (effective(node.key)) keys.add(node.key);
    origin[node.key] = origins.get(node.key) ?? "padrao";
  }

  const scopes: Partial<Record<ScreenKey, ScopeKind>> = {};
  const screenScope = (screen: ScreenDef, depth = 0): ScopeKind | undefined => {
    const def = screen.scope;
    if (!def) return undefined;
    if (def.sameAs && depth < 3) {
      const target = SCREENS.find((s) => s.key === def.sameAs);
      if (target) return screenScope(target, depth + 1);
    }
    if (!def.allowed) return undefined;
    const fallback = defaultScopeFor(def, subject);
    if (def.fixed) return fallback;
    const fromException = Object.hasOwn(exception.scopes, screen.key) ? exception.scopes[screen.key] : undefined;
    const fromProfile = Object.hasOwn(profile.scopes, screen.key) ? profile.scopes[screen.key] : undefined;
    const chosen = fromException ?? fromProfile ?? fallback;
    return clampScope(chosen, def.allowed);
  };
  for (const screen of SCREENS) {
    const kind = screenScope(screen);
    if (kind) scopes[screen.key as ScreenKey] = kind;
  }

  return {
    has: (key: PermissionKey) => keys.has(key),
    keys,
    scopes,
    origin,
    activeModules: active,
    degraded: Boolean(options.degraded),
  };
}

// ---------------------------------------------------------------------------
// Consulta
// ---------------------------------------------------------------------------

/** Qualquer objeto com papel (e departamento); quando traz `permissions` (CurrentUser), elas valem. */
export interface PermissionHolder {
  role: RoleKey;
  departmentId?: DepartmentKey | string;
  permissions?: EffectivePermissions;
}

const defaultsCache = new Map<string, EffectivePermissions>();

/**
 * Matriz padrão (sem perfil, sem exceção, todos os módulos ativos) para um papel/departamento. Usada quando o
 * objeto recebido não é um CurrentUser (predicados antigos que recebem `Pick<…>`): o resultado é o mesmo de antes.
 */
export function defaultPermissionsFor(role: RoleKey, departmentId?: DepartmentKey | string): EffectivePermissions {
  const cacheKey = `${role}|${departmentId ?? ""}`;
  let perms = defaultsCache.get(cacheKey);
  if (!perms) {
    perms = resolvePermissions({ role, departmentId });
    defaultsCache.set(cacheKey, perms);
  }
  return perms;
}

export function permissionsOf(user: PermissionHolder): EffectivePermissions {
  return user.permissions ?? defaultPermissionsFor(user.role, user.departmentId);
}

/** O usuário tem a permissão efetiva? Único ponto de decisão (sem atalho para administrador). */
export function can(user: PermissionHolder, key: PermissionKey): boolean {
  return permissionsOf(user).has(key);
}

/** Tem ao menos uma das permissões. */
export function canAny(user: PermissionHolder, keys: readonly PermissionKey[]): boolean {
  const perms = permissionsOf(user);
  return keys.some((k) => perms.has(k));
}

// ---------------------------------------------------------------------------
// Rotas → nó do catálogo (canSeeHref)
// ---------------------------------------------------------------------------

export interface RouteEntry extends RoutePattern {
  /** Chaves aceitas (qualquer uma). */
  keys: PermissionKey[];
}

function buildRouteTable(): RouteEntry[] {
  const entries: RouteEntry[] = [];
  const add = (pattern: string, keys: PermissionKey[]) => {
    // Catch-all não é tela: href sem página própria não é "visível".
    const route = compileRoute(pattern);
    if (route) entries.push({ ...route, keys });
  };
  for (const screen of SCREENS) {
    const view = `${screen.key}.ver` as PermissionKey;
    const keys = screen.requireScreenAny ? screen.requireScreenAny.map((k) => `${k}.ver` as PermissionKey) : [view];
    for (const r of screen.routes) add(r, keys);
    if (screen.nav?.href && !screen.routes.length && !screen.virtual) add(screen.nav.href.split("?")[0], keys);
    for (const section of screen.sections) for (const r of section.routes ?? []) add(r, [section.key as PermissionKey]);
  }
  return sortRoutes(entries);
}

let routeTable: RouteEntry[] | null = null;

/** Tabela de rotas do catálogo, da mais específica à mais genérica. */
export function routeTableEntries(): readonly RouteEntry[] {
  routeTable ??= buildRouteTable();
  return routeTable;
}

/** Nó do catálogo dono de um href interno (a query e o hash não entram no casamento), ou null. */
export function screenForHref(href: string): { pattern: string; keys: readonly PermissionKey[] } | null {
  const entry = findRoute(routeTableEntries(), href);
  return entry ? { pattern: entry.pattern, keys: entry.keys } : null;
}

/** Seções (das telas aceitas pela rota) que controlam a aba informada. */
export function sectionKeysForTab(keys: readonly PermissionKey[], tab: string): PermissionKey[] {
  const out: PermissionKey[] = [];
  for (const key of keys) {
    const screen = key.endsWith(".ver") ? SCREEN_BY_KEY.get(key.slice(0, -".ver".length)) : undefined;
    for (const section of screen?.sections ?? []) if (section.tab === tab) out.push(section.key as PermissionKey);
  }
  return out;
}

/** Abas (`?aba=`) com seções no catálogo entre as telas aceitas pela rota. */
export function tabsForKeys(keys: readonly PermissionKey[]): string[] {
  const tabs = new Set<string>();
  for (const key of keys) {
    const screen = key.endsWith(".ver") ? SCREEN_BY_KEY.get(key.slice(0, -".ver".length)) : undefined;
    for (const section of screen?.sections ?? []) if (section.tab) tabs.add(section.tab);
  }
  return [...tabs];
}

/**
 * O usuário pode abrir este href interno? Href sem tela no catálogo = não visível. Com `?aba=<x>`, quando a tela tem
 * seção dessa aba (SectionDef.tab), exige também uma das seções; aba sem seção no catálogo vale como a própria tela.
 */
export function canSeeHref(user: PermissionHolder, href: string): boolean {
  const found = screenForHref(href);
  if (!found || !canAny(user, found.keys)) return false;
  const tab = hrefTab(href);
  if (!tab) return true;
  const sections = sectionKeysForTab(found.keys, tab);
  return sections.length === 0 || canAny(user, sections);
}
