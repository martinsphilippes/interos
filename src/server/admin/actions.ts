"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { ACCESS_DENIED_MESSAGE, BusinessError, PermissionError, can, failAction, requirePermission, resolvePermissionsForUser } from "@/server/auth/session";
import { canSeeRecord } from "@/server/auth/scope";
import { adminAuth } from "@/server/firebase-admin";
import { batchSet, create, getById, list, remove, update, nowIso, ORG_ID, type CreateInput } from "@/server/db";
import { emitEvent } from "@/server/events";
import { auditChanges, describeChanges, hasChanges } from "@/server/audit";
import { DEPARTMENT_LABELS, ROLE_LABELS, type RoleKey } from "@/domain/constants";
import { MODULE_BY_KEY, SETTING_PERMISSION, type PermissionKey } from "@/domain/permissions";
import { COLLECTIONS, type ActionResult, type BaseEntity, type CollectionName, type CurrentUser, type Department, type Organization, type PermissionProfile, type Product, type Settings, type SlaRule, type User, type UserRef } from "@/domain/types";
import {
  SCOPE_LABELS,
  activeModulesFrom,
  defaultValueText,
  describeDiff,
  diffAdjustments,
  inactiveModulesFrom,
  roleDefaultScopes,
  roleDefaults,
  validateAdjustments,
  validateInactiveModules,
  type AdjustmentDiff,
} from "@/server/auth/access-admin";
import {
  checkAccessInvariants,
  violationMessage,
  withActiveModules,
  withRoleProfile,
  withUser,
  withUserOverride,
  withoutUser,
  type AccessChange,
  type AccessState,
  type AccessUser,
} from "@/server/auth/invariants";
import { resolvePermissions } from "@/server/auth/permissions";
import { loadAccessState, roleProfileDocId, userOverrideDocId, type LoadedAccessState } from "./access";
import { countOpenTasksForUser } from "./queries";
import {
  createProductSchema,
  createUserSchema,
  moveProductSchema,
  resetPasswordSchema,
  saveActiveModulesSchema,
  savePermissionProfileSchema,
  saveUserOverridesSchema,
  SETTING_DESCRIPTIONS,
  SETTING_SCHEMAS,
  setProductActiveSchema,
  setUserActiveSchema,
  slaRuleIdSchema,
  slaRuleSchema,
  updateDepartmentSchema,
  updateProductSchema,
  updateUserSchema,
  upsertSettingSchema,
  userIdSchema,
  zodMessage,
} from "./schemas";

/**
 * Server Actions do módulo de Administração.
 *
 * Padrão (A5): requirePermission("<chave do catálogo>") → validação zod → escopo do registro (canSeeRecord) →
 * invariantes de acesso (A9, no estado resultante) → mutação via db.ts (e Firebase Auth para usuários) → evento com
 * auditoria de → para (A16) → revalidatePath. Falhas viram `{ ok: false, error }` por failAction.
 * Perfis, exceções individuais e módulos da empresa (A6/A8) exigem `admin.acessos.gerir`.
 */

const actor = (user: CurrentUser): UserRef => ({ id: user.id, name: user.name });

/** Chave adicional exigida quando a condição ocorre (checkedIn do catálogo). */
function requireAlso(user: CurrentUser, key: PermissionKey): void {
  if (!can(user, key)) throw new PermissionError(ACCESS_DENIED_MESSAGE, key);
}

function fail(error: unknown, fallback: string): { ok: false; error: string } {
  const authMessage = authErrorMessage(error);
  if (authMessage) return { ok: false, error: authMessage };
  if (error instanceof z.ZodError) return { ok: false, error: zodMessage(error) };
  return failAction(error, fallback, "admin");
}

/** Traduz os códigos de erro mais comuns do Firebase Auth. */
function authErrorMessage(error: unknown): string | null {
  const code = (error as { code?: string } | null)?.code;
  switch (code) {
    case "auth/email-already-exists":
      return "Já existe um login com este e-mail no Firebase Auth";
    case "auth/invalid-email":
      return "E-mail inválido para o Firebase Auth";
    case "auth/invalid-password":
      return "Senha inválida: use pelo menos 8 caracteres";
    case "auth/user-not-found":
      return "Login não encontrado no Firebase Auth";
    case "auth/uid-already-exists":
      return "Já existe um login com este identificador";
    default:
      return null;
  }
}

function isAuthNotFound(error: unknown): boolean {
  return (error as { code?: string } | null)?.code === "auth/user-not-found";
}

/**
 * Regrava o documento inteiro (set sem merge): campos opcionais que ficaram `undefined` no patch
 * são removidos do Firestore em vez de mantidos (ex.: limpar o gestor de um usuário).
 */
async function replaceDoc<T extends BaseEntity>(name: CollectionName, current: T, patch: Partial<T>): Promise<void> {
  const { id, updatedAt: _previousUpdatedAt, ...rest } = current;
  void _previousUpdatedAt;
  await create<T>(name, { ...rest, ...patch, updatedAt: nowIso() } as CreateInput<T>, id);
}

function revalidateUsers() {
  revalidatePath("/admin");
  revalidatePath("/admin/usuarios");
  revalidatePath("/admin/departamentos");
  revalidatePath("/tarefas");
}

/** Permissões mudaram: menu, atalhos e telas de todos passam a refletir o novo acesso (T9). */
function revalidateAccess() {
  revalidatePath("/", "layout");
}

async function loadUser(id: string): Promise<User> {
  const user = await getById<User>(COLLECTIONS.users, id);
  if (!user) throw new BusinessError("Usuário não encontrado");
  return user;
}

/** O usuário-alvo precisa estar no escopo de dados do ator na tela Usuários (A7/A29). */
async function requireUserInScope(user: CurrentUser, target: Pick<User, "id" | "managerId" | "departmentId">): Promise<void> {
  if (!(await canSeeRecord(user, "admin.usuarios", [target.id, target.managerId], target.departmentId))) {
    throw new PermissionError("Acesso negado: este usuário está fora do seu escopo de dados.", "admin.usuarios.ver");
  }
}

/** Ativa/desativa o login no Firebase Auth. Usuário sem login (só documento) não bloqueia a operação. */
async function syncAuthDisabled(uid: string, active: boolean): Promise<void> {
  try {
    await adminAuth.updateUser(uid, { disabled: !active });
  } catch (error) {
    if (!isAuthNotFound(error)) throw error;
    console.warn(`[admin] usuário ${uid} sem login no Firebase Auth; só o documento foi atualizado`);
  }
}

/**
 * Revoga os refresh tokens do usuário no Firebase Auth: sessões abertas deixam de valer na próxima requisição
 * (`verifySessionCookie(token, true)` confere a revogação) e ele precisa entrar de novo com o papel/situação atuais.
 * Usuário sem login (só documento) não bloqueia a operação.
 */
async function revokeSessions(uid: string): Promise<void> {
  try {
    await adminAuth.revokeRefreshTokens(uid);
  } catch (error) {
    if (!isAuthNotFound(error)) throw error;
    console.warn(`[admin] usuário ${uid} sem login no Firebase Auth; nada a revogar`);
  }
}

// ---------------------------------------------------------------------------
// Invariantes (A9) e bloqueio auditado
// ---------------------------------------------------------------------------

interface AccessTarget {
  entity: { type: string; id: string };
  label: string;
  kind: "usuario" | "perfil" | "organizacao";
}

/**
 * Avalia os invariantes no estado resultante. Violação → evento `permissions.blocked` (quem, alvo, o que tentou e
 * por quê) e BusinessError com a mensagem para o usuário.
 */
async function enforceInvariants(user: CurrentUser, loaded: LoadedAccessState, after: AccessState, change: AccessChange, target: AccessTarget, attempted: Record<string, unknown> = {}): Promise<void> {
  const violations = checkAccessInvariants({ actorId: user.id, before: loaded.state, after, change });
  if (!violations.length) return;
  const message = violationMessage(violations);
  try {
    await emitEvent({
      type: "permissions.blocked",
      actor: actor(user),
      entity: target.entity,
      title: `Alteração de acesso bloqueada: ${target.label}`,
      description: message,
      payload: { target: { kind: target.kind, id: target.entity.id, label: target.label }, change: change.kind, violations: violations.map((v) => ({ code: v.code, message: v.message, key: v.key ?? null })), ...attempted },
      timeline: false,
    });
  } catch (error) {
    console.error("[admin] falha ao registrar o bloqueio de acesso", error);
  }
  throw new BusinessError(message);
}

function accessUserOf(u: Pick<User, "id" | "name" | "role" | "departmentId" | "active" | "managerId">): AccessUser {
  return { id: u.id, name: u.name, role: u.role, departmentId: u.departmentId, active: u.active, managerId: u.managerId };
}

// ---------------------------------------------------------------------------
// Auditoria de usuários
// ---------------------------------------------------------------------------

const USER_FIELD_LABELS: Record<string, string> = {
  name: "nome",
  role: "papel",
  departmentId: "departamento",
  managerId: "gestor",
  jobTitle: "cargo",
  phone: "telefone",
  active: "situação",
  baseSalary: "salário base",
  monthlyGoals: "metas mensais",
};
const USER_FIELDS = Object.keys(USER_FIELD_LABELS);

/** Visão de negócio dos campos do usuário (salário nunca vai em claro para o evento). */
function userAuditView(u: Partial<User>, names: Map<string, string>): Record<string, unknown> {
  const goals = Object.keys(u.monthlyGoals ?? {}).length;
  return {
    name: u.name,
    role: u.role ? ROLE_LABELS[u.role] : undefined,
    departmentId: u.departmentId ? (DEPARTMENT_LABELS[u.departmentId] ?? u.departmentId) : undefined,
    managerId: u.managerId ? (names.get(u.managerId) ?? u.managerId) : undefined,
    jobTitle: u.jobTitle,
    phone: u.phone,
    active: u.active === false ? "Inativo" : u.active === true ? "Ativo" : undefined,
    // Só para detectar a mudança: redactSalary troca o valor por texto antes de gravar o evento.
    baseSalary: u.baseSalary === undefined || u.baseSalary === null ? undefined : String(u.baseSalary),
    monthlyGoals: goals ? `${goals} meta(s): ${JSON.stringify(u.monthlyGoals)}` : undefined,
  };
}

/** Remove o marcador interno do salário (usado só para detectar a mudança) antes de gravar o evento. */
function redactSalary(audit: ReturnType<typeof auditChanges>): ReturnType<typeof auditChanges> {
  const c = audit.changes.baseSalary;
  if (c) {
    audit.changes.baseSalary = { from: c.from === null ? null : "valor anterior", to: c.to === null ? null : c.from === null ? "informado" : "novo valor" };
  }
  const g = audit.changes.monthlyGoals;
  if (g) {
    const strip = (v: unknown) => (typeof v === "string" ? v.replace(/:.*$/, "") : v);
    audit.changes.monthlyGoals = { from: strip(g.from), to: strip(g.to) };
  }
  return audit;
}

// ---------------------------------------------------------------------------
// Usuários
// ---------------------------------------------------------------------------

export async function createUser(input: unknown): Promise<ActionResult<{ id: string }>> {
  try {
    const user = await requirePermission("admin.usuarios.criar");
    const data = createUserSchema.parse(input);
    // Papel diferente do padrão (colaborador) e salário informado exigem as chaves próprias (checkedIn).
    if (data.role !== "colaborador") requireAlso(user, "admin.usuarios.alterar-papel");
    if (data.baseSalary !== undefined) requireAlso(user, "admin.usuarios.remuneracao.editar");

    const existing = await list<User>(COLLECTIONS.users, { where: [["email", "==", data.email]] });
    if (existing.length > 0) throw new BusinessError(`Já existe um usuário cadastrado com o e-mail ${data.email}`);
    if (data.managerId) await loadUser(data.managerId);

    // I6: atribuir o papel admin exige gerir acessos (o novo usuário entra no estado resultante).
    const loaded = await loadAccessState();
    const draftId = "__novo__";
    const draft: AccessUser = { id: draftId, name: data.name, role: data.role, departmentId: data.departmentId, active: true, managerId: data.managerId };
    await enforceInvariants(user, loaded, withUser(loaded.state, draft), { kind: "user.create", userId: draftId }, { entity: { type: "user", id: data.email }, label: data.name, kind: "usuario" }, { role: data.role });

    // O documento em `users` usa o uid do Firebase Auth como id.
    const authUser = await adminAuth.createUser({ email: data.email, password: data.password, displayName: data.name, emailVerified: true });
    let created: User;
    try {
      created = await create<User>(
        COLLECTIONS.users,
        {
          name: data.name,
          email: data.email,
          role: data.role,
          departmentId: data.departmentId,
          managerId: data.managerId,
          jobTitle: data.jobTitle,
          phone: data.phone,
          active: true,
          monthlyGoals: Object.keys(data.monthlyGoals).length > 0 ? data.monthlyGoals : undefined,
          baseSalary: data.baseSalary,
          createdBy: user.id,
        },
        authUser.uid,
      );
    } catch (error) {
      // Sem documento o login não serve para nada: desfaz a criação no Auth.
      await adminAuth.deleteUser(authUser.uid).catch(() => undefined);
      throw error;
    }

    await emitEvent({
      type: "user.created",
      actor: actor(user),
      entity: { type: "user", id: created.id },
      title: `Usuário ${created.name} criado`,
      description: `${ROLE_LABELS[created.role]} · ${DEPARTMENT_LABELS[created.departmentId]}${created.jobTitle ? ` · ${created.jobTitle}` : ""}`,
      department: created.departmentId,
      payload: { email: created.email, role: created.role, departmentId: created.departmentId, managerId: created.managerId },
    });

    revalidateUsers();
    return { ok: true, data: { id: created.id } };
  } catch (error) {
    return fail(error, "Não foi possível criar o usuário");
  }
}

export async function updateUser(input: unknown): Promise<ActionResult<{ id: string }>> {
  try {
    const user = await requirePermission("admin.usuarios.editar");
    const data = updateUserSchema.parse(input);
    const current = await loadUser(data.id);
    await requireUserInScope(user, current);

    if (data.managerId === data.id) throw new BusinessError("Um usuário não pode ser gestor de si mesmo");
    if (data.managerId) await loadUser(data.managerId);

    // Quem não vê o salário não o recebe no formulário: o valor atual é mantido.
    const baseSalary = can(user, "admin.usuarios.remuneracao.ver") ? data.baseSalary : current.baseSalary;
    const patch: Partial<User> = {
      name: data.name,
      role: data.role,
      departmentId: data.departmentId,
      managerId: data.managerId,
      jobTitle: data.jobTitle,
      phone: data.phone,
      active: data.active,
      monthlyGoals: Object.keys(data.monthlyGoals).length > 0 ? data.monthlyGoals : undefined,
      baseSalary,
    };
    // Chaves adicionais conforme o que mudou (checkedIn do catálogo).
    if (current.role !== data.role) requireAlso(user, "admin.usuarios.alterar-papel");
    if ((current.active !== false) !== data.active) requireAlso(user, "admin.usuarios.ativar");
    if ((current.baseSalary ?? null) !== (baseSalary ?? null)) requireAlso(user, "admin.usuarios.remuneracao.editar");

    // Invariantes no estado resultante (papel/situação/departamento do alvo mudam as permissões efetivas).
    const loaded = await loadAccessState();
    const next = accessUserOf({ ...current, ...patch, id: current.id } as User);
    await enforceInvariants(user, loaded, withUser(loaded.state, next), { kind: "user.update", userId: current.id }, { entity: { type: "user", id: current.id }, label: current.name, kind: "usuario" }, { role: data.role, active: data.active });

    const names = new Map([...loaded.usersById.values()].map((u) => [u.id, u.name]));
    const audit = redactSalary(auditChanges<Record<string, unknown>>(userAuditView(current, names), userAuditView({ ...current, ...patch }, names), USER_FIELDS));
    const changed = Object.keys(audit.changes).map((k) => USER_FIELD_LABELS[k] ?? k);

    await replaceDoc<User>(COLLECTIONS.users, current, patch);
    if ((current.active !== false) !== data.active) await syncAuthDisabled(data.id, data.active);
    // Desativado ou com papel alterado: derruba as sessões abertas para valer o novo acesso.
    if ((!data.active && current.active !== data.active) || current.role !== data.role) await revokeSessions(data.id);
    if (current.name !== data.name) {
      await adminAuth.updateUser(data.id, { displayName: data.name }).catch((error: unknown) => {
        if (!isAuthNotFound(error)) throw error;
      });
    }

    await emitEvent({
      type: "user.updated",
      actor: actor(user),
      entity: { type: "user", id: data.id },
      title: `Usuário ${data.name} atualizado`,
      description: hasChanges(audit) ? describeChanges(audit, USER_FIELD_LABELS) : "Sem alterações relevantes",
      department: data.departmentId,
      payload: { changed, ...audit, labels: USER_FIELD_LABELS, role: data.role, departmentId: data.departmentId, active: data.active },
    });

    revalidateUsers();
    if (current.role !== data.role || current.departmentId !== data.departmentId || (current.active !== false) !== data.active) revalidateAccess();
    return { ok: true, data: { id: data.id } };
  } catch (error) {
    return fail(error, "Não foi possível salvar o usuário");
  }
}

/** Desativar/reativar: bloqueia o login no Firebase Auth e marca `active` no documento. */
export async function setUserActive(input: unknown): Promise<ActionResult<{ active: boolean }>> {
  try {
    const user = await requirePermission("admin.usuarios.ativar");
    const data = setUserActiveSchema.parse(input);
    const current = await loadUser(data.id);
    await requireUserInScope(user, current);
    if (current.active === data.active) return { ok: true, data: { active: data.active } };

    const loaded = await loadAccessState();
    await enforceInvariants(
      user,
      loaded,
      withUser(loaded.state, accessUserOf({ ...current, active: data.active })),
      { kind: "user.update", userId: current.id },
      { entity: { type: "user", id: current.id }, label: current.name, kind: "usuario" },
      { active: data.active },
    );

    await syncAuthDisabled(data.id, data.active);
    await update<User>(COLLECTIONS.users, data.id, { active: data.active });
    if (!data.active) await revokeSessions(data.id);

    const audit = auditChanges<Record<string, unknown>>({ active: current.active === false ? "Inativo" : "Ativo" }, { active: data.active ? "Ativo" : "Inativo" }, ["active"]);
    await emitEvent({
      type: "user.updated",
      actor: actor(user),
      entity: { type: "user", id: data.id },
      title: data.active ? `Usuário ${current.name} reativado` : `Usuário ${current.name} desativado`,
      description: describeChanges(audit, USER_FIELD_LABELS),
      department: current.departmentId,
      payload: { changed: ["situação"], ...audit, labels: USER_FIELD_LABELS, active: data.active },
    });

    revalidateUsers();
    return { ok: true, data: { active: data.active } };
  } catch (error) {
    return fail(error, "Não foi possível alterar a situação do usuário");
  }
}

export async function resetUserPassword(input: unknown): Promise<ActionResult<{ id: string }>> {
  try {
    const user = await requirePermission("admin.usuarios.redefinir-senha");
    const data = resetPasswordSchema.parse(input);
    const current = await loadUser(data.id);
    await requireUserInScope(user, current);
    // Anti-escalada (I6): entrar como alguém com acessos que o ator não tem exige gerir acessos.
    if (!can(user, "admin.acessos.gerir")) {
      const target = await resolvePermissionsForUser(current);
      const mine = user.permissions;
      if (target && [...target.keys].some((k) => !mine.has(k))) {
        throw new PermissionError("Acesso negado: esta pessoa tem acessos que você não tem. Só quem gere acessos pode redefinir a senha dela.", "admin.acessos.gerir");
      }
    }

    try {
      await adminAuth.updateUser(data.id, { password: data.password });
    } catch (error) {
      // Documento sem login (ex.: importado): cria o login com o mesmo uid para a senha valer.
      if (!isAuthNotFound(error)) throw error;
      await adminAuth.createUser({ uid: data.id, email: current.email, password: data.password, displayName: current.name, emailVerified: true, disabled: current.active === false });
    }

    await emitEvent({
      type: "user.updated",
      actor: actor(user),
      entity: { type: "user", id: data.id },
      title: `Senha de ${current.name} redefinida`,
      department: current.departmentId,
      payload: { changed: ["senha"] },
    });

    revalidateUsers();
    return { ok: true, data: { id: data.id } };
  } catch (error) {
    return fail(error, "Não foi possível redefinir a senha");
  }
}

/** Exclui login e documento. Bloqueado se o usuário ainda tem tarefas abertas, liderados ou lidera departamento. */
export async function deleteUser(input: unknown): Promise<ActionResult<{ id: string }>> {
  try {
    const user = await requirePermission("admin.usuarios.excluir");
    const data = userIdSchema.parse(input);
    const current = await loadUser(data.id);
    await requireUserInScope(user, current);
    // I1/I2 (a si mesmo)/I5 (gestor de departamento) no estado resultante, antes das checagens de pendências.
    const loaded = await loadAccessState();
    await enforceInvariants(user, loaded, withoutUser(loaded.state, current.id), { kind: "user.delete", userId: current.id }, { entity: { type: "user", id: current.id }, label: current.name, kind: "usuario" });

    const openTasks = await countOpenTasksForUser(data.id);
    if (openTasks > 0) {
      throw new BusinessError(`${current.name} ainda tem ${openTasks} tarefa${openTasks === 1 ? "" : "s"} aberta${openTasks === 1 ? "" : "s"}. Reatribua ou conclua as tarefas antes de excluir (ou apenas desative o usuário).`);
    }
    const reports = await list<User>(COLLECTIONS.users, { where: [["managerId", "==", data.id]] });
    if (reports.length > 0) {
      throw new BusinessError(`${current.name} é gestor de ${reports.length} usuário${reports.length === 1 ? "" : "s"}. Troque o gestor dessas pessoas antes de excluir.`);
    }
    await adminAuth.deleteUser(data.id).catch((error: unknown) => {
      if (!isAuthNotFound(error)) throw error;
    });
    await remove(COLLECTIONS.users, data.id);
    // Exceções individuais do usuário excluído não têm mais a quem se aplicar.
    if (loaded.profiles.has(userOverrideDocId(data.id))) await remove(COLLECTIONS.permissionProfiles, userOverrideDocId(data.id));

    await emitEvent({
      type: "user.deleted",
      actor: actor(user),
      entity: { type: "user", id: data.id },
      title: `Usuário ${current.name} excluído`,
      description: `${current.email} · ${ROLE_LABELS[current.role]} · ${DEPARTMENT_LABELS[current.departmentId] ?? current.departmentId}`,
      department: current.departmentId,
      payload: { changed: ["excluído"], email: current.email, role: current.role, changes: { excluido: { from: "Cadastrado", to: "Excluído" } }, labels: { excluido: "cadastro" } },
    });

    revalidateUsers();
    return { ok: true, data: { id: data.id } };
  } catch (error) {
    return fail(error, "Não foi possível excluir o usuário");
  }
}

// ---------------------------------------------------------------------------
// Perfis, exceções individuais e módulos da empresa (A6/A8/A9/A16)
// ---------------------------------------------------------------------------

function isEmptyAdjustments(adj: { grants: Record<string, boolean>; scopes: Record<string, unknown> }): boolean {
  return Object.keys(adj.grants).length === 0 && Object.keys(adj.scopes).length === 0;
}

function adjustmentsOrThrow(input: { grants?: unknown; scopes?: unknown }) {
  const result = validateAdjustments(input);
  if (!result.ok) throw new BusinessError(`Não foi possível salvar: ${result.errors.slice(0, 3).join(" · ")}${result.errors.length > 3 ? ` (e mais ${result.errors.length - 3})` : ""}`);
  return result.value;
}

async function emitAccessUpdated(user: CurrentUser, target: AccessTarget, diff: AdjustmentDiff, reason: string | undefined, extra: Record<string, unknown> = {}): Promise<void> {
  await emitEvent({
    type: "permissions.updated",
    actor: actor(user),
    entity: target.entity,
    title: `Acessos alterados: ${target.label}`,
    description: describeDiff(diff),
    payload: { target: { kind: target.kind, id: target.entity.id, label: target.label }, changes: diff.changes, labels: diff.labels, ...(reason ? { reason } : {}), ...extra },
    timeline: false,
  });
}

/** Grava os ajustes de um perfil (papel): conceder/negar chaves e fixar escopos. Chave ausente = regra padrão. */
export async function savePermissionProfile(input: unknown): Promise<ActionResult<{ role: RoleKey; changes: number }>> {
  try {
    const user = await requirePermission("admin.acessos.gerir");
    const data = savePermissionProfileSchema.parse(input);
    const adjustments = adjustmentsOrThrow(data);
    const loaded = await loadAccessState();
    const role = data.role;
    const target: AccessTarget = { entity: { type: "permission_profile", id: roleProfileDocId(role) }, label: `perfil ${ROLE_LABELS[role]}`, kind: "perfil" };

    const defaults = roleDefaults(role);
    const defaultScopes = roleDefaultScopes(role);
    const diff = diffAdjustments(
      loaded.state.roleProfiles[role],
      adjustments,
      (key) => defaultValueText(defaults[key]),
      (screen) => (defaultScopes[screen] ? `Padrão (${SCOPE_LABELS[defaultScopes[screen]!]})` : "Padrão (varia por departamento)"),
    );
    if (!Object.keys(diff.changes).length) return { ok: true, data: { role, changes: 0 } };

    await enforceInvariants(user, loaded, withRoleProfile(loaded.state, role, adjustments), { kind: "profile", role }, target, { changes: diff.changes, labels: diff.labels });

    const existing = loaded.profiles.get(roleProfileDocId(role));
    await create<PermissionProfile>(
      COLLECTIONS.permissionProfiles,
      { kind: "role", role, grants: adjustments.grants, scopes: adjustments.scopes, reason: data.reason, updatedBy: actor(user), createdAt: existing?.createdAt, createdBy: existing?.createdBy ?? user.id },
      roleProfileDocId(role),
    );
    await emitAccessUpdated(user, target, diff, data.reason, { role });

    revalidateUsers();
    revalidateAccess();
    return { ok: true, data: { role, changes: Object.keys(diff.changes).length } };
  } catch (error) {
    return fail(error, "Não foi possível salvar o perfil");
  }
}

/** Grava as exceções individuais de um usuário (motivo obrigatório). Sem nenhuma exceção, o documento é removido. */
export async function saveUserPermissionOverrides(input: unknown): Promise<ActionResult<{ userId: string; changes: number }>> {
  try {
    const user = await requirePermission("admin.acessos.gerir");
    const data = saveUserOverridesSchema.parse(input);
    const adjustments = adjustmentsOrThrow(data);
    const targetUser = await loadUser(data.userId);
    await requireUserInScope(user, targetUser);
    const loaded = await loadAccessState();
    const target: AccessTarget = { entity: { type: "user", id: targetUser.id }, label: targetUser.name, kind: "usuario" };

    // Base do "Padrão do perfil": o que o perfil (sem exceções) dá a esta pessoa hoje.
    const profilePerms = resolvePermissions(targetUser, { roleProfile: loaded.state.roleProfiles[targetUser.role] ?? null, organization: { activeModules: loaded.state.activeModules } });
    const diff = diffAdjustments(
      loaded.state.userOverrides[targetUser.id],
      adjustments,
      (key) => defaultValueText(profilePerms.has(key as PermissionKey), "Padrão do perfil"),
      (screen) => {
        const kind = profilePerms.scopes[screen as keyof typeof profilePerms.scopes];
        return kind ? `Padrão do perfil (${SCOPE_LABELS[kind]})` : "Padrão do perfil";
      },
    );
    if (!Object.keys(diff.changes).length) return { ok: true, data: { userId: targetUser.id, changes: 0 } };

    const empty = isEmptyAdjustments(adjustments);
    await enforceInvariants(user, loaded, withUserOverride(loaded.state, targetUser.id, empty ? null : adjustments), { kind: "override", userId: targetUser.id }, target, { changes: diff.changes, labels: diff.labels, reason: data.reason });

    const docId = userOverrideDocId(targetUser.id);
    if (empty) {
      await remove(COLLECTIONS.permissionProfiles, docId);
    } else {
      const existing = loaded.profiles.get(docId);
      await create<PermissionProfile>(
        COLLECTIONS.permissionProfiles,
        { kind: "user", userId: targetUser.id, grants: adjustments.grants, scopes: adjustments.scopes, reason: data.reason, updatedBy: actor(user), createdAt: existing?.createdAt, createdBy: existing?.createdBy ?? user.id },
        docId,
      );
    }
    await emitAccessUpdated(user, target, diff, data.reason, { userId: targetUser.id, cleared: empty });

    revalidateUsers();
    revalidateAccess();
    return { ok: true, data: { userId: targetUser.id, changes: Object.keys(diff.changes).length } };
  } catch (error) {
    return fail(error, "Não foi possível salvar as exceções de acesso");
  }
}

/**
 * Liga/desliga módulos da empresa. Recebe os módulos INATIVOS (vazio = todos ativos). Grava `activeModules` com a
 * lista completa (é o que o núcleo lê hoje) e `inactiveModules` (forma que deixa módulo novo nascer ligado; ver
 * pedido de leitura no núcleo); sem nenhum inativo, os dois campos são removidos. Dados dos módulos ficam intactos.
 */
export async function saveActiveModules(input: unknown): Promise<ActionResult<{ inactive: string[] }>> {
  try {
    const user = await requirePermission("admin.acessos.gerir");
    const data = saveActiveModulesSchema.parse(input);
    const valid = validateInactiveModules(data.inactive ?? []);
    if (!valid.ok) throw new BusinessError(valid.errors.join(" · "));
    const inactive = valid.value;
    const loaded = await loadAccessState();
    const target: AccessTarget = { entity: { type: "organization", id: ORG_ID }, label: "módulos da empresa", kind: "organizacao" };

    const before = new Set(inactiveModulesFrom(loaded.state.activeModules));
    const changes: AdjustmentDiff["changes"] = {};
    const labels: AdjustmentDiff["labels"] = {};
    for (const [key, def] of MODULE_BY_KEY) {
      const was = before.has(key);
      const now = inactive.includes(key);
      if (was === now) continue;
      changes[`modulo:${key}`] = { from: was ? "Desativado" : "Ativo", to: now ? "Desativado" : "Ativo" };
      labels[`modulo:${key}`] = `${def.label} › Módulo na empresa`;
    }
    const diff: AdjustmentDiff = { changes, labels };
    if (!Object.keys(changes).length) return { ok: true, data: { inactive } };

    const activeModules = activeModulesFrom(inactive);
    await enforceInvariants(user, loaded, withActiveModules(loaded.state, activeModules), { kind: "modules" }, target, { changes, labels });

    // Regrava o documento inteiro (sem merge): sem módulo inativo, os dois campos deixam de existir (= todos ativos).
    const org = (loaded.organization ?? { name: ORG_ID, slug: ORG_ID, timezone: "America/Sao_Paulo" }) as Partial<Organization> & { inactiveModules?: unknown };
    const { id: _id, updatedAt: _updatedAt, activeModules: _active, inactiveModules: _inactive, ...rest } = org;
    void [_id, _updatedAt, _active, _inactive];
    await create<Organization>(COLLECTIONS.organizations, { ...rest, activeModules, ...(inactive.length ? { inactiveModules: inactive } : {}), updatedAt: nowIso() } as CreateInput<Organization>, ORG_ID);
    await emitAccessUpdated(user, target, diff, data.reason, { inactiveModules: inactive });

    revalidateUsers();
    revalidateAccess();
    return { ok: true, data: { inactive } };
  } catch (error) {
    return fail(error, "Não foi possível salvar os módulos da empresa");
  }
}

// ---------------------------------------------------------------------------
// Departamentos (conjunto de chaves fixo em DEPARTMENT_KEYS; só edição)
// ---------------------------------------------------------------------------

const DEPARTMENT_FIELD_LABELS: Record<string, string> = { name: "nome", managerId: "gestor", color: "cor", description: "descrição", order: "ordem" };

export async function updateDepartment(input: unknown): Promise<ActionResult<{ id: string }>> {
  try {
    const user = await requirePermission("admin.departamentos.editar");
    const data = updateDepartmentSchema.parse(input);
    const current = await getById<Department>(COLLECTIONS.departments, data.id);
    if (!current) throw new BusinessError("Departamento não encontrado");
    let managerName: string | undefined;
    if (data.managerId) {
      const manager = await loadUser(data.managerId);
      if (manager.active === false) throw new BusinessError(`${manager.name} está inativo e não pode ser gestor`);
      managerName = manager.name;
    }
    const previousManager = current.managerId && current.managerId !== data.managerId ? (await getById<User>(COLLECTIONS.users, current.managerId))?.name : managerName;

    const patch = { name: data.name, managerId: data.managerId, color: data.color, description: data.description, order: data.order };
    const audit = auditChanges<Record<string, unknown>>(
      { name: current.name, managerId: current.managerId ? (previousManager ?? current.managerId) : undefined, color: current.color, description: current.description, order: current.order },
      { ...patch, managerId: data.managerId ? (managerName ?? data.managerId) : undefined },
      Object.keys(DEPARTMENT_FIELD_LABELS),
    );
    await replaceDoc<Department>(COLLECTIONS.departments, current, patch);

    if (hasChanges(audit)) {
      await emitEvent({
        type: "department.updated",
        actor: actor(user),
        entity: { type: "department", id: current.id },
        title: `Departamento ${data.name} atualizado`,
        description: describeChanges(audit, DEPARTMENT_FIELD_LABELS),
        department: current.key,
        payload: { ...audit, labels: DEPARTMENT_FIELD_LABELS, key: current.key },
        timeline: false,
      });
    }

    revalidatePath("/admin");
    revalidatePath("/admin/departamentos");
    // O gestor do departamento define a "equipe" de várias telas (escopo de dados).
    if (audit.changes.managerId) revalidateAccess();
    return { ok: true, data: { id: data.id } };
  } catch (error) {
    return fail(error, "Não foi possível salvar o departamento");
  }
}

// ---------------------------------------------------------------------------
// Produtos
// ---------------------------------------------------------------------------

function revalidateProducts() {
  revalidatePath("/admin");
  revalidatePath("/admin/produtos");
}

async function loadProduct(id: string): Promise<Product> {
  const product = await getById<Product>(COLLECTIONS.products, id);
  if (!product) throw new BusinessError("Produto não encontrado");
  return product;
}

export async function createProduct(input: unknown): Promise<ActionResult<{ id: string }>> {
  try {
    const user = await requirePermission("admin.produtos.criar");
    const data = createProductSchema.parse(input);
    const products = await list<Product>(COLLECTIONS.products);
    if (products.some((p) => p.name.trim().toLowerCase() === data.name.toLowerCase())) throw new BusinessError(`Já existe um produto chamado "${data.name}"`);
    const order = data.order ?? Math.max(0, ...products.map((p) => p.order)) + 1;

    const product = await create<Product>(COLLECTIONS.products, {
      name: data.name,
      category: data.category,
      description: data.description,
      setupPrice: data.setupPrice,
      monthlyPrice: data.monthlyPrice,
      hardwarePrice: data.hardwarePrice,
      billingType: data.billingType,
      commission: data.commission,
      implementationTemplateId: data.implementationTemplateId,
      implementationDays: data.implementationDays,
      active: data.active,
      order,
      createdBy: user.id,
    });

    revalidateProducts();
    return { ok: true, data: { id: product.id } };
  } catch (error) {
    return fail(error, "Não foi possível criar o produto");
  }
}

export async function updateProduct(input: unknown): Promise<ActionResult<{ id: string }>> {
  try {
    await requirePermission("admin.produtos.editar");
    const data = updateProductSchema.parse(input);
    const current = await loadProduct(data.id);
    const others = (await list<Product>(COLLECTIONS.products)).filter((p) => p.id !== data.id);
    if (others.some((p) => p.name.trim().toLowerCase() === data.name.toLowerCase())) throw new BusinessError(`Já existe outro produto chamado "${data.name}"`);

    await replaceDoc<Product>(COLLECTIONS.products, current, {
      name: data.name,
      category: data.category,
      description: data.description,
      setupPrice: data.setupPrice,
      monthlyPrice: data.monthlyPrice,
      hardwarePrice: data.hardwarePrice,
      billingType: data.billingType,
      commission: data.commission,
      implementationTemplateId: data.implementationTemplateId,
      implementationDays: data.implementationDays,
      active: data.active,
      order: data.order ?? current.order,
    });

    revalidateProducts();
    return { ok: true, data: { id: data.id } };
  } catch (error) {
    return fail(error, "Não foi possível salvar o produto");
  }
}

/** Sobe/desce uma posição no catálogo e normaliza a ordem de todos (1..n). */
export async function moveProduct(input: unknown): Promise<ActionResult<{ order: number }>> {
  try {
    await requirePermission("admin.produtos.editar");
    const data = moveProductSchema.parse(input);
    const products = (await list<Product>(COLLECTIONS.products)).sort((a, b) => (a.order === b.order ? a.name.localeCompare(b.name, "pt-BR") : a.order - b.order));
    const index = products.findIndex((p) => p.id === data.id);
    if (index < 0) throw new BusinessError("Produto não encontrado");
    const target = data.direction === "up" ? index - 1 : index + 1;
    if (target < 0 || target >= products.length) return { ok: true, data: { order: products[index].order } };
    [products[index], products[target]] = [products[target], products[index]];

    const now = nowIso();
    await batchSet(
      products.map((p, i) => ({ collection: COLLECTIONS.products, id: p.id, data: { order: i + 1, updatedAt: now }, merge: true })),
    );

    revalidateProducts();
    return { ok: true, data: { order: target + 1 } };
  } catch (error) {
    return fail(error, "Não foi possível reordenar o produto");
  }
}

export async function setProductActive(input: unknown): Promise<ActionResult<{ active: boolean }>> {
  try {
    await requirePermission("admin.produtos.ativar");
    const data = setProductActiveSchema.parse(input);
    await loadProduct(data.id);
    await update<Product>(COLLECTIONS.products, data.id, { active: data.active });
    revalidateProducts();
    return { ok: true, data: { active: data.active } };
  } catch (error) {
    return fail(error, "Não foi possível alterar o produto");
  }
}

// ---------------------------------------------------------------------------
// Configurações (settings) e regras de SLA
// ---------------------------------------------------------------------------

function revalidateSettings() {
  revalidatePath("/admin");
  revalidatePath("/admin/configuracoes");
  // Gamificação, prêmios e sequência aparecem em Meu Desempenho, Ranking e Bônus.
  revalidatePath("/performance", "layout");
}

/**
 * Cria ou atualiza o documento `settings` da chave, validando o valor com o esquema da chave. A chave de edição
 * exigida depende da configuração gravada (SETTING_PERMISSION, A12): abas financeiras pertencem à tela
 * Configurações Financeiras.
 */
export async function upsertSetting(input: unknown): Promise<ActionResult<{ key: string }>> {
  try {
    const { key, value: raw } = upsertSettingSchema.parse(input);
    const user = await requirePermission(SETTING_PERMISSION[key]);
    const value = SETTING_SCHEMAS[key].parse(raw) as Record<string, unknown>;

    const existing = await list<Settings>(COLLECTIONS.settings, { where: [["key", "==", key]] });
    const before = existing[0]?.value ?? null;
    if (existing.length > 0) {
      // `create` sem merge substitui o valor inteiro (chaves removidas pelo usuário somem de fato).
      await replaceDoc<Settings>(COLLECTIONS.settings, existing[0], { value, description: existing[0].description ?? SETTING_DESCRIPTIONS[key] });
    } else {
      await create<Settings>(COLLECTIONS.settings, { key, value, description: SETTING_DESCRIPTIONS[key], createdBy: user.id }, `setting_${key.replace(/\./g, "_")}`);
    }

    // Auditoria (D16): valor anterior → novo de cada campo alterado.
    const fields = Array.from(new Set([...Object.keys(before ?? {}), ...Object.keys(value)]));
    const audit = auditChanges<Record<string, unknown>>(before, value, fields);
    if (hasChanges(audit)) {
      await emitEvent({
        type: "settings.updated",
        actor: actor(user),
        entity: { type: "setting", id: key },
        title: `Configuração "${SETTING_DESCRIPTIONS[key]?.replace(/\.$/, "") ?? key}" alterada`,
        description: describeChanges(audit),
        payload: { kind: "setting", setting: key, created: !before, ...audit },
        timeline: false,
      });
    }

    revalidateSettings();
    return { ok: true, data: { key } };
  } catch (error) {
    return fail(error, "Não foi possível salvar a configuração");
  }
}

/** Cria (sem id) ou atualiza (com id) uma regra de SLA. A chave é única. */
export async function upsertSlaRule(input: unknown): Promise<ActionResult<{ id: string }>> {
  try {
    const user = await requirePermission("admin.configuracoes.sla.editar");
    const data = slaRuleSchema.parse(input);
    const rules = await list<SlaRule>(COLLECTIONS.slaRules);
    const duplicate = rules.find((r) => r.key === data.key && r.id !== data.id);
    if (duplicate) throw new BusinessError(`Já existe uma regra com a chave "${data.key}" (${duplicate.name})`);

    const fields: Omit<SlaRule, keyof BaseEntity> = {
      key: data.key,
      name: data.name,
      appliesTo: data.appliesTo,
      department: data.department,
      responseHours: data.responseHours,
      resolutionHours: data.resolutionHours,
      businessHoursOnly: data.businessHoursOnly,
      attentionPct: data.attentionPct,
      riskPct: data.riskPct,
      active: data.active,
    };

    let id: string;
    if (data.id) {
      const current = rules.find((r) => r.id === data.id);
      if (!current) throw new BusinessError("Regra de SLA não encontrada");
      await replaceDoc<SlaRule>(COLLECTIONS.slaRules, current, fields);
      id = current.id;
    } else {
      const preferredId = `sla_${data.key.replace(/\./g, "_")}`;
      const created = await create<SlaRule>(COLLECTIONS.slaRules, { ...fields, createdBy: user.id }, rules.some((r) => r.id === preferredId) ? undefined : preferredId);
      id = created.id;
    }

    revalidateSettings();
    return { ok: true, data: { id } };
  } catch (error) {
    return fail(error, "Não foi possível salvar a regra de SLA");
  }
}

export async function deleteSlaRule(input: unknown): Promise<ActionResult<{ id: string }>> {
  try {
    await requirePermission("admin.configuracoes.sla.excluir");
    const data = slaRuleIdSchema.parse(input);
    const current = await getById<SlaRule>(COLLECTIONS.slaRules, data.id);
    if (!current) throw new BusinessError("Regra de SLA não encontrada");
    await remove(COLLECTIONS.slaRules, data.id);
    revalidateSettings();
    return { ok: true, data: { id: data.id } };
  } catch (error) {
    return fail(error, "Não foi possível excluir a regra de SLA");
  }
}
