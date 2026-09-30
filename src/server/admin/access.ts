import "server-only";
import { cache } from "react";
import { ROLE_KEYS, ROLE_LABELS, type RoleKey } from "@/domain/constants";
import { COLLECTIONS, type CurrentUser, type Department, type DomainEvent, type Organization, type PermissionProfile, type User } from "@/domain/types";
import { MODULES, PERMISSION_NODES, type ModuleKey, type PermissionOrigin, type ScopeKind } from "@/domain/permissions";
import { getById, list, ORG_ID } from "@/server/db";
import { can } from "@/server/auth/session";
import { resolvePermissions, sanitizeAdjustments, type PermissionAdjustments } from "@/server/auth/permissions";
import {
  activeModulesFrom,
  buildAccessTree,
  buildModuleInfo,
  buildScopeOptions,
  inactiveModulesFrom,
  roleDefaultScopes,
  roleDefaults,
  type AccessModuleInfo,
  type AccessScreenScope,
  type AccessTreeNode,
  type DefaultValue,
} from "@/server/auth/access-admin";
import { permissionsInState, withActiveModules, type AccessState } from "@/server/auth/invariants";

/**
 * Leituras da administração de acessos (A10): estado de acesso da organização (usuários, departamentos, perfis,
 * exceções e módulos), dados da aba "Perfis e acessos", da aba "Módulos da empresa" e das seções de acesso do
 * drawer do usuário. Só objetos simples saem daqui para os Client Components (o catálogo fica no servidor).
 */

export const roleProfileDocId = (role: string) => `role_${role}`;
export const userOverrideDocId = (uid: string) => `user_${uid}`;

export interface LoadedAccessState {
  state: AccessState;
  profiles: Map<string, PermissionProfile>;
  organization: Organization | null;
  usersById: Map<string, User>;
  departments: Department[];
}

/** Estado de acesso completo da organização (base dos invariantes). Sem cache: cada gravação lê o estado atual. */
export async function loadAccessState(): Promise<LoadedAccessState> {
  const [users, departments, profiles, organization] = await Promise.all([
    list<User>(COLLECTIONS.users),
    list<Department>(COLLECTIONS.departments),
    list<PermissionProfile>(COLLECTIONS.permissionProfiles),
    getById<Organization>(COLLECTIONS.organizations, ORG_ID),
  ]);
  const roleProfiles: Record<string, PermissionAdjustments> = {};
  const userOverrides: Record<string, PermissionAdjustments> = {};
  const byId = new Map<string, PermissionProfile>();
  for (const p of profiles) {
    byId.set(p.id, p);
    const clean = sanitizeAdjustments(p);
    if (p.kind === "role" && p.role && p.id === roleProfileDocId(p.role)) roleProfiles[p.role] = clean;
    if (p.kind === "user" && p.userId && p.id === userOverrideDocId(p.userId)) userOverrides[p.userId] = clean;
  }
  const state: AccessState = {
    users: users.map((u) => ({ id: u.id, name: u.name, role: u.role, departmentId: u.departmentId, active: u.active, managerId: u.managerId })),
    departments: departments.map((d) => ({ key: d.key, name: d.name, managerId: d.managerId })),
    roleProfiles,
    userOverrides,
    activeModules: Array.isArray(organization?.activeModules) ? organization.activeModules : undefined,
  };
  return { state, profiles: byId, organization, usersById: new Map(users.map((u) => [u.id, u])), departments };
}

// ---------------------------------------------------------------------------
// Histórico
// ---------------------------------------------------------------------------

export interface AccessHistoryItem {
  id: string;
  type: string;
  title: string;
  description?: string;
  actorName: string;
  occurredAt: string;
  reason?: string;
  changes: { label: string; from: string; to: string }[];
}

function formatValue(value: unknown): string {
  if (value === null || value === undefined || value === "") return "—";
  if (typeof value === "boolean") return value ? "sim" : "não";
  if (typeof value === "object") return Array.isArray(value) ? value.join(", ") : "alterado";
  return String(value);
}

function toHistoryItem(e: DomainEvent): AccessHistoryItem {
  const payload = e.payload ?? {};
  const rawChanges = (payload.changes ?? {}) as Record<string, { from?: unknown; to?: unknown }>;
  const labels = (payload.labels ?? {}) as Record<string, string>;
  const changes = Object.entries(rawChanges)
    .slice(0, 40)
    .map(([k, c]) => ({ label: labels[k] ?? k, from: formatValue(c?.from), to: formatValue(c?.to) }));
  return {
    id: e.id,
    type: e.type,
    title: e.title,
    description: e.description,
    actorName: e.actorName,
    occurredAt: e.occurredAt,
    reason: typeof payload.reason === "string" ? payload.reason : undefined,
    changes,
  };
}

const ACCESS_EVENT_TYPES = new Set(["user.created", "user.updated", "user.deleted", "permissions.updated", "permissions.blocked"]);

/** Eventos de acesso de um usuário (cadastro, papel, exceções, bloqueios), do mais recente ao mais antigo. */
export async function listUserAccessHistory(userId: string, limit = 30): Promise<AccessHistoryItem[]> {
  const events = await list<DomainEvent>(COLLECTIONS.events, { where: [["entityId", "==", userId]] });
  return events
    .filter((e) => e.entityType === "user" && ACCESS_EVENT_TYPES.has(e.type))
    .sort((a, b) => b.occurredAt.localeCompare(a.occurredAt))
    .slice(0, limit)
    .map(toHistoryItem);
}

/** Últimas alterações e bloqueios de acesso da organização (aba Perfis). */
export async function listRecentAccessEvents(limit = 15): Promise<AccessHistoryItem[]> {
  const events = await list<DomainEvent>(COLLECTIONS.events, { where: [["type", "in", ["permissions.updated", "permissions.blocked"]]] });
  return events
    .sort((a, b) => b.occurredAt.localeCompare(a.occurredAt))
    .slice(0, limit)
    .map(toHistoryItem);
}

// ---------------------------------------------------------------------------
// Aba "Perfis e acessos"
// ---------------------------------------------------------------------------

export interface RoleProfileView {
  role: RoleKey;
  label: string;
  /** Usuários ativos com este papel. */
  users: number;
  grants: Record<string, boolean>;
  scopes: Record<string, ScopeKind>;
  /** Padrão efetivo de cada chave para o papel (sem ajustes, todos os módulos ativos). */
  defaults: Record<string, DefaultValue>;
  /** Escopo padrão por tela (null = varia com o departamento). */
  defaultScopes: Record<string, ScopeKind | null>;
  updatedAt?: string;
  updatedByName?: string;
  reason?: string;
}

export interface AccessCatalogView {
  tree: AccessTreeNode[];
  scopes: AccessScreenScope[];
  modules: AccessModuleInfo[];
  /** Módulos desativados na empresa hoje. */
  inactiveModules: ModuleKey[];
}

const catalogView = cache((): Omit<AccessCatalogView, "inactiveModules"> => ({ tree: buildAccessTree(), scopes: buildScopeOptions(), modules: buildModuleInfo() }));

const defaultsByRole = new Map<RoleKey, { defaults: Record<string, DefaultValue>; defaultScopes: Record<string, ScopeKind | null> }>();
function defaultsFor(role: RoleKey) {
  let entry = defaultsByRole.get(role);
  if (!entry) {
    entry = { defaults: roleDefaults(role), defaultScopes: roleDefaultScopes(role) };
    defaultsByRole.set(role, entry);
  }
  return entry;
}

export interface ProfilesTabData {
  catalog: AccessCatalogView;
  profiles: RoleProfileView[];
  recent: AccessHistoryItem[];
}

export async function getProfilesTabData(loaded?: LoadedAccessState): Promise<ProfilesTabData> {
  const data = loaded ?? (await loadAccessState());
  const recent = await listRecentAccessEvents();
  const profiles = ROLE_KEYS.map((role): RoleProfileView => {
    const doc = data.profiles.get(roleProfileDocId(role));
    const adj = data.state.roleProfiles[role];
    return {
      role,
      label: ROLE_LABELS[role],
      users: data.state.users.filter((u) => u.role === role && u.active === true).length,
      grants: { ...(adj?.grants ?? {}) } as Record<string, boolean>,
      scopes: { ...(adj?.scopes ?? {}) } as Record<string, ScopeKind>,
      ...defaultsFor(role),
      updatedAt: doc && (Object.keys(adj?.grants ?? {}).length || Object.keys(adj?.scopes ?? {}).length) ? doc.updatedAt : undefined,
      updatedByName: doc?.updatedBy?.name,
      reason: doc?.reason,
    };
  });
  return { catalog: { ...catalogView(), inactiveModules: inactiveModulesFrom(data.state.activeModules) }, profiles, recent };
}

// ---------------------------------------------------------------------------
// Aba "Módulos da empresa"
// ---------------------------------------------------------------------------

export interface ModuleImpact {
  key: ModuleKey;
  label: string;
  deactivatable: boolean;
  active: boolean;
  screens: number;
  /** Ativo: quem perde ao desligar. Inativo: quem ganha ao ligar. */
  affectedUsers: { id: string; name: string; screens: number }[];
}

export async function getModulesTabData(loaded?: LoadedAccessState): Promise<ModuleImpact[]> {
  const data = loaded ?? (await loadAccessState());
  const inactive = inactiveModulesFrom(data.state.activeModules);
  const activeUsers = data.state.users.filter((u) => u.active === true);
  return MODULES.map((m): ModuleImpact => {
    const isActive = !inactive.includes(m.key);
    // Estado com o módulo ligado: quem tem acesso a ele (e quantas telas) — o que se perde ao desligar ou se ganha ao ligar.
    const on = withActiveModules(data.state, activeModulesFrom(inactive.filter((k) => k !== m.key)));
    const screenKeys = m.screens.map((s) => `${s.key}.ver`);
    const affectedUsers = m.deactivatable
      ? activeUsers
          .map((u) => {
            const perms = permissionsInState(on, u);
            if (!perms.has(`${m.key}.acessar` as never)) return null;
            return { id: u.id, name: u.name ?? u.id, screens: screenKeys.filter((k) => perms.has(k as never)).length };
          })
          .filter((x): x is { id: string; name: string; screens: number } => Boolean(x))
          .sort((a, b) => a.name.localeCompare(b.name, "pt-BR"))
      : [];
    return { key: m.key, label: m.label, deactivatable: m.deactivatable, active: isActive, screens: m.screens.length, affectedUsers };
  });
}

// ---------------------------------------------------------------------------
// Drawer do usuário: exceções, acesso efetivo e histórico
// ---------------------------------------------------------------------------

export interface UserAccessView {
  userId: string;
  isSelf: boolean;
  /** Exceções gravadas. */
  grants: Record<string, boolean>;
  scopes: Record<string, ScopeKind>;
  reason?: string;
  updatedAt?: string;
  updatedByName?: string;
  /** O que o perfil (sem exceções) dá a esta pessoa: base do "Padrão do perfil". */
  profileValues: Record<string, boolean>;
  profileScopes: Record<string, ScopeKind>;
  /** Acesso efetivo e origem de cada decisão (somente leitura). */
  effective?: { values: Record<string, boolean>; origins: Record<string, PermissionOrigin>; scopes: Record<string, ScopeKind> };
  history?: AccessHistoryItem[];
}

export interface UserAccessCapabilities {
  exceptions: boolean;
  effective: boolean;
  history: boolean;
  manage: boolean;
}

export function userAccessCapabilities(actor: CurrentUser): UserAccessCapabilities {
  return {
    exceptions: can(actor, "admin.acessos.excecoes.ver"),
    effective: can(actor, "admin.acessos.efetivo.ver"),
    history: can(actor, "admin.acessos.historico.ver"),
    manage: can(actor, "admin.acessos.gerir"),
  };
}

/** Dados de acesso do usuário do drawer; cada bloco só é lido/enviado quando o ator pode vê-lo. */
export async function getUserAccessView(actor: CurrentUser, target: User, caps: UserAccessCapabilities, loaded?: LoadedAccessState): Promise<UserAccessView | null> {
  if (!caps.exceptions && !caps.effective && !caps.history) return null;
  const data = loaded ?? (await loadAccessState());
  const override = data.state.userOverrides[target.id];
  const doc = data.profiles.get(userOverrideDocId(target.id));
  const options = { roleProfile: data.state.roleProfiles[target.role] ?? null, organization: { activeModules: data.state.activeModules } };
  const profilePerms = resolvePermissions(target, options);
  const values: Record<string, boolean> = {};
  for (const n of PERMISSION_NODES) values[n.key] = profilePerms.has(n.key);
  const view: UserAccessView = {
    userId: target.id,
    isSelf: target.id === actor.id,
    grants: caps.exceptions ? ({ ...(override?.grants ?? {}) } as Record<string, boolean>) : {},
    scopes: caps.exceptions ? ({ ...(override?.scopes ?? {}) } as Record<string, ScopeKind>) : {},
    reason: caps.exceptions ? doc?.reason : undefined,
    updatedAt: caps.exceptions && override ? doc?.updatedAt : undefined,
    updatedByName: caps.exceptions ? doc?.updatedBy?.name : undefined,
    profileValues: caps.exceptions ? values : {},
    profileScopes: caps.exceptions ? ({ ...profilePerms.scopes } as Record<string, ScopeKind>) : {},
  };
  if (caps.effective) {
    const perms = resolvePermissions(target, { ...options, userOverride: override ?? null });
    const eff: Record<string, boolean> = {};
    const origins: Record<string, PermissionOrigin> = {};
    for (const n of PERMISSION_NODES) {
      eff[n.key] = perms.has(n.key);
      origins[n.key] = perms.origin[n.key];
    }
    view.effective = { values: eff, origins, scopes: { ...perms.scopes } as Record<string, ScopeKind> };
  }
  if (caps.history) view.history = await listUserAccessHistory(target.id);
  return view;
}
