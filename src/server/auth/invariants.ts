/**
 * Invariantes de segurança das permissões (A9) — anti-auto-bloqueio e anti-escalada, avaliados no ESTADO
 * RESULTANTE de cada gravação (updateUser, setUserActive, deleteUser, createUser, savePermissionProfile,
 * saveUserPermissionOverrides, saveActiveModules). Puro: recebe o estado antes/depois e devolve as violações; quem
 * grava lê o estado, monta o "depois", chama `checkAccessInvariants` e, havendo violação, recusa com BusinessError e
 * registra `permissions.blocked`.
 *
 *   I1 sempre existe ≥ 1 usuário ATIVO com `admin.acessos.gerir` e `admin.usuarios.editar` efetivas;
 *   I2 ninguém edita as próprias exceções, nem perde (por perfil, módulo ou mudança de cadastro) uma chave protegida
 *      que tinha, nem se desativa/exclui, nem muda o próprio papel;
 *   I3 o perfil `admin` não aceita negar chaves protegidas;
 *   I4 `inicio` e `admin` sempre ativos; `inicio.acessar`/`inicio.meu-dia.ver` nunca negados (destino de todo acesso
 *      negado — evita laço de redirecionamento);
 *   I5 não se exclui quem é gestor de departamento (`departments.managerId`);
 *   I6 anti-escalada: só quem tem `admin.acessos.gerir` edita perfis/exceções/módulos; o ator só concede chaves (e
 *      escopos) que ele próprio tem; atribuir ou retirar o papel `admin` exige `admin.acessos.gerir`.
 *
 * Sem bypass: nada aqui trata o papel admin como especial além do que as regras padrão do catálogo já dão.
 */
import { DEPARTMENT_KEYS, ROLE_LABELS, type DepartmentKey, type RoleKey } from "@/domain/constants";
import { MODULE_BY_KEY, PROTECTED_KEYS, SCREEN_BY_KEY, type EffectivePermissions, type PermissionKey, type ScopeKind } from "@/domain/permissions";
import { resolvePermissions, type PermissionAdjustments } from "./permissions";
import { permissionPath, scopeWider } from "./access-admin";

/** Chaves que mantêm alguém capaz de administrar usuários e acessos (I1). */
export const ADMIN_CORE_KEYS = ["admin.acessos.gerir", "admin.usuarios.editar"] as const satisfies readonly PermissionKey[];
/** Nunca negadas a ninguém, em perfil ou exceção (I4). */
export const NEVER_DENIED_KEYS = ["inicio.acessar", "inicio.meu-dia.ver"] as const satisfies readonly PermissionKey[];
/** Módulos que nunca são desativados (I4). */
export const ALWAYS_ACTIVE_MODULES = ["inicio", "admin"] as const;

export interface AccessUser {
  id: string;
  name?: string;
  role: RoleKey;
  departmentId: DepartmentKey | string;
  active?: boolean;
  managerId?: string;
}

/** Estado de acesso da organização (o que decide as permissões efetivas de todos). */
export interface AccessState {
  users: readonly AccessUser[];
  departments: readonly { key: string; name?: string; managerId?: string }[];
  /** Ajustes por papel (`role_<papel>`). */
  roleProfiles: Readonly<Partial<Record<string, PermissionAdjustments>>>;
  /** Exceções por usuário (`user_<uid>`). */
  userOverrides: Readonly<Partial<Record<string, PermissionAdjustments>>>;
  /** Módulos ativos gravados (undefined = todos). */
  activeModules?: readonly string[];
}

export type AccessChange =
  | { kind: "user.create"; userId: string }
  | { kind: "user.update"; userId: string }
  | { kind: "user.delete"; userId: string }
  | { kind: "profile"; role: RoleKey }
  | { kind: "override"; userId: string }
  | { kind: "modules" };

export type InvariantCode = "I1" | "I2" | "I3" | "I4" | "I5" | "I6";

export interface InvariantViolation {
  code: InvariantCode;
  message: string;
  key?: string;
}

// ---------------------------------------------------------------------------
// Estado
// ---------------------------------------------------------------------------

/** Permissões efetivas de um usuário no estado informado. */
export function permissionsInState(state: AccessState, user: AccessUser): EffectivePermissions {
  return resolvePermissions(user, {
    roleProfile: state.roleProfiles[user.role] ?? null,
    userOverride: state.userOverrides[user.id] ?? null,
    organization: { activeModules: state.activeModules },
  });
}

export function withUser(state: AccessState, user: AccessUser): AccessState {
  const exists = state.users.some((u) => u.id === user.id);
  return { ...state, users: exists ? state.users.map((u) => (u.id === user.id ? user : u)) : [...state.users, user] };
}

export function withoutUser(state: AccessState, userId: string): AccessState {
  const userOverrides = { ...state.userOverrides };
  delete userOverrides[userId];
  return { ...state, users: state.users.filter((u) => u.id !== userId), userOverrides };
}

export function withRoleProfile(state: AccessState, role: RoleKey, adjustments: PermissionAdjustments): AccessState {
  return { ...state, roleProfiles: { ...state.roleProfiles, [role]: adjustments } };
}

export function withUserOverride(state: AccessState, userId: string, adjustments: PermissionAdjustments | null): AccessState {
  const userOverrides = { ...state.userOverrides };
  if (adjustments) userOverrides[userId] = adjustments;
  else delete userOverrides[userId];
  return { ...state, userOverrides };
}

export function withActiveModules(state: AccessState, activeModules: readonly string[] | undefined): AccessState {
  return { ...state, activeModules };
}

// ---------------------------------------------------------------------------
// Verificação
// ---------------------------------------------------------------------------

const label = (key: string) => `«${permissionPath(key)}»`;

function ownValue(adj: PermissionAdjustments | null | undefined, key: string): boolean | undefined {
  const grants = adj?.grants;
  return grants && Object.hasOwn(grants, key) ? grants[key] : undefined;
}

function ownScope(adj: PermissionAdjustments | null | undefined, screen: string): ScopeKind | undefined {
  const scopes = adj?.scopes;
  return scopes && Object.hasOwn(scopes, screen) ? scopes[screen] : undefined;
}

/** I1: algum usuário ativo mantém as chaves de administração de acessos. */
export function hasAccessAdministrator(state: AccessState): boolean {
  return state.users.some((u) => u.active === true && ADMIN_CORE_KEYS.every((k) => permissionsInState(state, u).has(k)));
}

export interface InvariantInput {
  actorId: string;
  before: AccessState;
  after: AccessState;
  change: AccessChange;
}

/** Avalia I1–I6 para a mudança. Lista vazia = pode gravar (I1 só acusa quando a mudança QUEBRA a condição). */
export function checkAccessInvariants({ actorId, before, after, change }: InvariantInput): InvariantViolation[] {
  const violations: InvariantViolation[] = [];
  const add = (code: InvariantCode, message: string, key?: string) => {
    if (!violations.some((v) => v.code === code && v.message === message)) violations.push({ code, message, key });
  };

  const actorBefore = before.users.find((u) => u.id === actorId);
  const actorAfter = after.users.find((u) => u.id === actorId);
  const actorPerms = actorBefore ? permissionsInState(before, actorBefore) : null;
  const actorHas = (key: string) => Boolean(actorPerms?.has(key as PermissionKey));

  // ---- I6: autoridade para editar acessos
  if ((change.kind === "profile" || change.kind === "override" || change.kind === "modules") && !actorHas("admin.acessos.gerir")) {
    add("I6", "Somente quem pode gerir acessos altera perfis, exceções individuais e módulos da empresa.");
  }

  // ---- I2: próprio usuário
  if (change.kind === "override" && change.userId === actorId) {
    add("I2", "Você não pode alterar as suas próprias exceções de acesso. Peça a outro administrador.");
  }
  if (change.kind === "user.delete" && change.userId === actorId) {
    add("I2", "Você não pode excluir o seu próprio usuário.");
  }
  if (change.kind === "user.update" && change.userId === actorId && actorBefore && actorAfter) {
    if (actorAfter.role !== actorBefore.role) add("I2", "Você não pode alterar o seu próprio papel.");
    if (actorBefore.active === true && actorAfter.active !== true) add("I2", "Você não pode desativar o seu próprio usuário.");
  }
  // Perder uma chave protegida que tinha (perfil do próprio papel, módulo, departamento…).
  if (actorBefore && actorAfter && actorPerms) {
    const afterPerms = permissionsInState(after, actorAfter);
    for (const key of PROTECTED_KEYS) {
      if (actorPerms.has(key) && !afterPerms.has(key)) add("I2", `A alteração retiraria de você o acesso ${label(key)}. Peça a outro administrador.`, key);
    }
  }

  // ---- I3: perfil admin não nega chaves protegidas
  if (change.kind === "profile" && change.role === "admin") {
    const profile = after.roleProfiles.admin;
    for (const key of PROTECTED_KEYS) {
      if (ownValue(profile, key) === false) add("I3", `O perfil ${ROLE_LABELS.admin} não pode ter negado o acesso protegido ${label(key)}.`, key);
    }
    for (const d of DEPARTMENT_KEYS) {
      const perms = resolvePermissions({ role: "admin", departmentId: d }, { roleProfile: profile ?? null, organization: { activeModules: after.activeModules } });
      for (const key of PROTECTED_KEYS) {
        if (!perms.has(key)) add("I3", `O perfil ${ROLE_LABELS.admin} precisa manter o acesso protegido ${label(key)}.`, key);
      }
    }
  }

  // ---- I4: módulos protegidos ativos; Meu Dia nunca negado
  if (after.activeModules) {
    for (const m of ALWAYS_ACTIVE_MODULES) {
      if (!after.activeModules.includes(m)) add("I4", `O módulo ${MODULE_BY_KEY.get(m)?.label ?? m} não pode ser desativado.`);
    }
  }
  if (change.kind === "profile" || change.kind === "override") {
    const adj = change.kind === "profile" ? after.roleProfiles[change.role] : after.userOverrides[change.userId];
    for (const key of NEVER_DENIED_KEYS) {
      if (ownValue(adj, key) === false) add("I4", `${label(key)} não pode ser negado: é a tela para onde todo acesso negado volta.`, key);
    }
  }

  // ---- I5: gestor de departamento não é excluído
  if (change.kind === "user.delete") {
    const managed = before.departments.filter((d) => d.managerId === change.userId);
    if (managed.length) {
      const names = managed.map((d) => d.name ?? d.key).join(", ");
      add("I5", `Este usuário é gestor do departamento ${names}. Troque o gestor do departamento antes de excluir.`);
    }
  }

  // ---- I6: anti-escalada nas concessões e no papel admin
  if (change.kind === "profile" || change.kind === "override") {
    const beforeAdj = change.kind === "profile" ? before.roleProfiles[change.role] : before.userOverrides[change.userId];
    const afterAdj = change.kind === "profile" ? after.roleProfiles[change.role] : after.userOverrides[change.userId];
    for (const key of Object.keys(afterAdj?.grants ?? {})) {
      const to = ownValue(afterAdj, key);
      if (to === true && ownValue(beforeAdj, key) !== true && !actorHas(key)) add("I6", `Você só pode conceder acessos que você mesmo tem: ${label(key)}.`, key);
    }
    for (const screen of Object.keys(afterAdj?.scopes ?? {})) {
      const to = ownScope(afterAdj, screen);
      if (!to || ownScope(beforeAdj, screen) === to) continue;
      const mine = actorPerms?.scopes[screen as keyof EffectivePermissions["scopes"]];
      if (!mine || scopeWider(to, mine)) add("I6", `Você só pode conceder escopo de dados até o seu em ${SCREEN_BY_KEY.get(screen)?.label ?? screen}.`, `escopo:${screen}`);
    }
  }
  if (change.kind === "user.create" || change.kind === "user.update") {
    const prev = before.users.find((u) => u.id === change.userId);
    const next = after.users.find((u) => u.id === change.userId);
    const touchesAdmin = (next?.role === "admin" && prev?.role !== "admin") || (prev?.role === "admin" && next?.role !== "admin");
    if (touchesAdmin && !actorHas("admin.acessos.gerir")) add("I6", `Atribuir ou retirar o papel ${ROLE_LABELS.admin} exige a permissão de gerir acessos.`);
  }

  // ---- I1: sempre um administrador de acessos ativo. Estado anterior já sem nenhum (dados legados/corrompidos):
  // não trava as gravações — qualquer mudança só pode manter ou corrigir a situação.
  if (hasAccessAdministrator(before) && !hasAccessAdministrator(after)) {
    add("I1", "A alteração deixaria a empresa sem nenhum usuário ativo capaz de gerir acessos e editar usuários. Mantenha pelo menos um administrador ativo com esses acessos.");
  }

  return violations;
}

/** Mensagem única para o usuário (a primeira violação; as demais ficam no evento de bloqueio). */
export function violationMessage(violations: readonly InvariantViolation[]): string {
  if (!violations.length) return "";
  const [first, ...rest] = violations;
  return rest.length ? `${first.message} (e mais ${rest.length} impedimento(s))` : first.message;
}
