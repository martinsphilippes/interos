"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { requireUser } from "@/server/auth/session";
import { adminAuth } from "@/server/firebase-admin";
import { batchSet, create, getById, list, remove, update, nowIso, type CreateInput } from "@/server/db";
import { emitEvent } from "@/server/events";
import { DEPARTMENT_LABELS, ROLE_LABELS } from "@/domain/constants";
import { COLLECTIONS, type ActionResult, type BaseEntity, type CollectionName, type CurrentUser, type Department, type Product, type Settings, type SlaRule, type User, type UserRef } from "@/domain/types";
import { countOpenTasksForUser } from "./queries";
import {
  createProductSchema,
  createUserSchema,
  moveProductSchema,
  resetPasswordSchema,
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
 * Padrão: requireAdmin() → validação zod (ZodError vira { ok: false, error }) → mutação via db.ts
 * (e Firebase Auth para usuários) → emitEvent quando há tipo de evento → revalidatePath.
 * Só administradores escrevem; gestor/diretoria apenas leem usuários e departamentos.
 */

const actor = (user: CurrentUser): UserRef => ({ id: user.id, name: user.name });

class ActionError extends Error {}

/** Exige sessão de administrador. Lança ActionError (vira { ok: false }) para os demais papéis. */
async function requireAdmin(): Promise<CurrentUser> {
  const user = await requireUser();
  if (!user.isAdmin) throw new ActionError("Apenas administradores podem alterar dados da administração");
  return user;
}

function fail(error: unknown, fallback: string): { ok: false; error: string } {
  if (error instanceof z.ZodError) return { ok: false, error: zodMessage(error) };
  if (error instanceof ActionError) return { ok: false, error: error.message };
  const authMessage = authErrorMessage(error);
  if (authMessage) return { ok: false, error: authMessage };
  console.error(`[admin] ${fallback}`, error);
  return { ok: false, error: error instanceof Error && error.message ? `${fallback}: ${error.message}` : fallback };
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

async function loadUser(id: string): Promise<User> {
  const user = await getById<User>(COLLECTIONS.users, id);
  if (!user) throw new ActionError("Usuário não encontrado");
  return user;
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

// ---------------------------------------------------------------------------
// Usuários
// ---------------------------------------------------------------------------

export async function createUser(input: unknown): Promise<ActionResult<{ id: string }>> {
  try {
    const user = await requireAdmin();
    const data = createUserSchema.parse(input);

    const existing = await list<User>(COLLECTIONS.users, { where: [["email", "==", data.email]] });
    if (existing.length > 0) throw new ActionError(`Já existe um usuário cadastrado com o e-mail ${data.email}`);
    if (data.managerId) await loadUser(data.managerId);

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

const USER_TRACKED_FIELDS: { key: keyof User; label: string }[] = [
  { key: "name", label: "nome" },
  { key: "role", label: "papel" },
  { key: "departmentId", label: "departamento" },
  { key: "managerId", label: "gestor" },
  { key: "jobTitle", label: "cargo" },
  { key: "phone", label: "telefone" },
  { key: "active", label: "ativo" },
  { key: "baseSalary", label: "salário base" },
];

export async function updateUser(input: unknown): Promise<ActionResult<{ id: string }>> {
  try {
    const user = await requireAdmin();
    const data = updateUserSchema.parse(input);
    const current = await loadUser(data.id);

    if (data.id === user.id && !data.active) throw new ActionError("Você não pode desativar o seu próprio usuário");
    if (data.id === user.id && data.role !== "admin") throw new ActionError("Você não pode remover o seu próprio papel de administrador");
    if (data.managerId === data.id) throw new ActionError("Um usuário não pode ser gestor de si mesmo");
    if (data.managerId) await loadUser(data.managerId);

    const patch: Partial<User> = {
      name: data.name,
      role: data.role,
      departmentId: data.departmentId,
      managerId: data.managerId,
      jobTitle: data.jobTitle,
      phone: data.phone,
      active: data.active,
      monthlyGoals: Object.keys(data.monthlyGoals).length > 0 ? data.monthlyGoals : undefined,
      baseSalary: data.baseSalary,
    };
    const changed = USER_TRACKED_FIELDS.filter(({ key }) => (current[key] ?? "") !== (patch[key] ?? "")).map((f) => f.label);
    if (JSON.stringify(current.monthlyGoals ?? {}) !== JSON.stringify(patch.monthlyGoals ?? {})) changed.push("metas mensais");

    await replaceDoc<User>(COLLECTIONS.users, current, patch);
    if (current.active !== data.active) await syncAuthDisabled(data.id, data.active);
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
      description: changed.length > 0 ? `Campos alterados: ${changed.join(", ")}` : "Sem alterações relevantes",
      department: data.departmentId,
      payload: { changed, role: data.role, departmentId: data.departmentId, active: data.active },
    });

    revalidateUsers();
    return { ok: true, data: { id: data.id } };
  } catch (error) {
    return fail(error, "Não foi possível salvar o usuário");
  }
}

/** Desativar/reativar: bloqueia o login no Firebase Auth e marca `active` no documento. */
export async function setUserActive(input: unknown): Promise<ActionResult<{ active: boolean }>> {
  try {
    const user = await requireAdmin();
    const data = setUserActiveSchema.parse(input);
    if (data.id === user.id && !data.active) throw new ActionError("Você não pode desativar o seu próprio usuário");
    const current = await loadUser(data.id);
    if (current.active === data.active) return { ok: true, data: { active: data.active } };

    await syncAuthDisabled(data.id, data.active);
    await update<User>(COLLECTIONS.users, data.id, { active: data.active });

    await emitEvent({
      type: "user.updated",
      actor: actor(user),
      entity: { type: "user", id: data.id },
      title: data.active ? `Usuário ${current.name} reativado` : `Usuário ${current.name} desativado`,
      department: current.departmentId,
      payload: { changed: ["ativo"], active: data.active },
    });

    revalidateUsers();
    return { ok: true, data: { active: data.active } };
  } catch (error) {
    return fail(error, "Não foi possível alterar a situação do usuário");
  }
}

export async function resetUserPassword(input: unknown): Promise<ActionResult<{ id: string }>> {
  try {
    const user = await requireAdmin();
    const data = resetPasswordSchema.parse(input);
    const current = await loadUser(data.id);

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

/** Exclui login e documento. Bloqueado se o usuário ainda tem tarefas abertas. */
export async function deleteUser(input: unknown): Promise<ActionResult<{ id: string }>> {
  try {
    const user = await requireAdmin();
    const data = userIdSchema.parse(input);
    if (data.id === user.id) throw new ActionError("Você não pode excluir o seu próprio usuário");
    const current = await loadUser(data.id);

    const openTasks = await countOpenTasksForUser(data.id);
    if (openTasks > 0) {
      throw new ActionError(`${current.name} ainda tem ${openTasks} tarefa${openTasks === 1 ? "" : "s"} aberta${openTasks === 1 ? "" : "s"}. Reatribua ou conclua as tarefas antes de excluir (ou apenas desative o usuário).`);
    }
    const reports = await list<User>(COLLECTIONS.users, { where: [["managerId", "==", data.id]] });
    if (reports.length > 0) {
      throw new ActionError(`${current.name} é gestor de ${reports.length} usuário${reports.length === 1 ? "" : "s"}. Troque o gestor dessas pessoas antes de excluir.`);
    }

    await adminAuth.deleteUser(data.id).catch((error: unknown) => {
      if (!isAuthNotFound(error)) throw error;
    });
    await remove(COLLECTIONS.users, data.id);

    await emitEvent({
      type: "user.updated",
      actor: actor(user),
      entity: { type: "user", id: data.id },
      title: `Usuário ${current.name} excluído`,
      description: current.email,
      department: current.departmentId,
      payload: { changed: ["excluído"], email: current.email, role: current.role },
    });

    revalidateUsers();
    return { ok: true, data: { id: data.id } };
  } catch (error) {
    return fail(error, "Não foi possível excluir o usuário");
  }
}

// ---------------------------------------------------------------------------
// Departamentos (conjunto de chaves fixo em DEPARTMENT_KEYS; só edição)
// ---------------------------------------------------------------------------

export async function updateDepartment(input: unknown): Promise<ActionResult<{ id: string }>> {
  try {
    await requireAdmin();
    const data = updateDepartmentSchema.parse(input);
    const current = await getById<Department>(COLLECTIONS.departments, data.id);
    if (!current) throw new ActionError("Departamento não encontrado");
    if (data.managerId) {
      const manager = await loadUser(data.managerId);
      if (manager.active === false) throw new ActionError(`${manager.name} está inativo e não pode ser gestor`);
    }

    await replaceDoc<Department>(COLLECTIONS.departments, current, {
      name: data.name,
      managerId: data.managerId,
      color: data.color,
      description: data.description,
      order: data.order,
    });

    revalidatePath("/admin");
    revalidatePath("/admin/departamentos");
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
  if (!product) throw new ActionError("Produto não encontrado");
  return product;
}

export async function createProduct(input: unknown): Promise<ActionResult<{ id: string }>> {
  try {
    const user = await requireAdmin();
    const data = createProductSchema.parse(input);
    const products = await list<Product>(COLLECTIONS.products);
    if (products.some((p) => p.name.trim().toLowerCase() === data.name.toLowerCase())) throw new ActionError(`Já existe um produto chamado "${data.name}"`);
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
    await requireAdmin();
    const data = updateProductSchema.parse(input);
    const current = await loadProduct(data.id);
    const others = (await list<Product>(COLLECTIONS.products)).filter((p) => p.id !== data.id);
    if (others.some((p) => p.name.trim().toLowerCase() === data.name.toLowerCase())) throw new ActionError(`Já existe outro produto chamado "${data.name}"`);

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
    await requireAdmin();
    const data = moveProductSchema.parse(input);
    const products = (await list<Product>(COLLECTIONS.products)).sort((a, b) => (a.order === b.order ? a.name.localeCompare(b.name, "pt-BR") : a.order - b.order));
    const index = products.findIndex((p) => p.id === data.id);
    if (index < 0) throw new ActionError("Produto não encontrado");
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
    await requireAdmin();
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
}

/** Cria ou atualiza o documento `settings` da chave, validando o valor com o esquema da chave. */
export async function upsertSetting(input: unknown): Promise<ActionResult<{ key: string }>> {
  try {
    const user = await requireAdmin();
    const { key, value: raw } = upsertSettingSchema.parse(input);
    const value = SETTING_SCHEMAS[key].parse(raw) as Record<string, unknown>;

    const existing = await list<Settings>(COLLECTIONS.settings, { where: [["key", "==", key]] });
    if (existing.length > 0) {
      // `create` sem merge substitui o valor inteiro (chaves removidas pelo usuário somem de fato).
      await replaceDoc<Settings>(COLLECTIONS.settings, existing[0], { value, description: existing[0].description ?? SETTING_DESCRIPTIONS[key] });
    } else {
      await create<Settings>(COLLECTIONS.settings, { key, value, description: SETTING_DESCRIPTIONS[key], createdBy: user.id }, `setting_${key}`);
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
    const user = await requireAdmin();
    const data = slaRuleSchema.parse(input);
    const rules = await list<SlaRule>(COLLECTIONS.slaRules);
    const duplicate = rules.find((r) => r.key === data.key && r.id !== data.id);
    if (duplicate) throw new ActionError(`Já existe uma regra com a chave "${data.key}" (${duplicate.name})`);

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
      if (!current) throw new ActionError("Regra de SLA não encontrada");
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
    await requireAdmin();
    const data = slaRuleIdSchema.parse(input);
    const current = await getById<SlaRule>(COLLECTIONS.slaRules, data.id);
    if (!current) throw new ActionError("Regra de SLA não encontrada");
    await remove(COLLECTIONS.slaRules, data.id);
    revalidateSettings();
    return { ok: true, data: { id: data.id } };
  } catch (error) {
    return fail(error, "Não foi possível excluir a regra de SLA");
  }
}
