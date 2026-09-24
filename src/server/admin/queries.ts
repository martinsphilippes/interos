import "server-only";
import { getManyByIds, list } from "@/server/db";
import { COLLECTIONS, type Department, type ImplementationTemplate, type LeadSource, type Product, type Settings, type SlaRule, type Task, type User, type WorkflowTemplate } from "@/domain/types";
import { SETTING_DEFAULTS, SETTING_KEYS, type SettingKey, type SettingValues } from "./schemas";

/**
 * Leituras do módulo de Administração. `listUsers`, `listDepartments`, `listProducts`, `getSetting`
 * e `listSlaRules` são reutilizadas por outros módulos; as demais alimentam as telas de admin.
 * Todas filtram por organização via `list()` (igualdade apenas) e ordenam em memória.
 */

const byName = <T extends { name: string }>(a: T, b: T) => a.name.localeCompare(b.name, "pt-BR");
const byOrder = <T extends { order: number; name: string }>(a: T, b: T) => (a.order === b.order ? byName(a, b) : a.order - b.order);

/** Status de tarefa que ainda exigem ação (para contagem de "tarefas abertas"). */
const OPEN_TASK_STATUS = new Set<Task["status"]>(["aberta", "em_andamento", "aguardando"]);

// ---------------------------------------------------------------------------
// Consultas reutilizáveis
// ---------------------------------------------------------------------------

export async function listUsers(options: { activeOnly?: boolean } = {}): Promise<User[]> {
  const users = await list<User>(COLLECTIONS.users);
  const items = options.activeOnly ? users.filter((u) => u.active !== false) : users;
  return items.sort(byName);
}

export async function listDepartments(): Promise<Department[]> {
  const departments = await list<Department>(COLLECTIONS.departments);
  return departments.sort(byOrder);
}

export async function listProducts(options: { activeOnly?: boolean } = {}): Promise<Product[]> {
  const products = await list<Product>(COLLECTIONS.products);
  const items = options.activeOnly ? products.filter((p) => p.active) : products;
  return items.sort(byOrder);
}

/**
 * Lê uma configuração de `settings` pela chave. Quando o documento não existe devolve o fallback;
 * quando existe e o fallback é um objeto, as chaves do fallback preenchem campos ausentes
 * (documentos antigos continuam válidos quando a configuração ganha campos novos).
 */
export async function getSetting<T>(key: string, fallback: T): Promise<T> {
  const docs = await list<Settings>(COLLECTIONS.settings, { where: [["key", "==", key]] });
  const value = docs[0]?.value;
  if (!value) return fallback;
  if (fallback && typeof fallback === "object" && !Array.isArray(fallback)) return { ...(fallback as object), ...value } as T;
  return value as T;
}

export async function listSlaRules(): Promise<SlaRule[]> {
  const rules = await list<SlaRule>(COLLECTIONS.slaRules);
  return rules.sort((a, b) => (a.appliesTo === b.appliesTo ? a.key.localeCompare(b.key, "pt-BR") : a.appliesTo.localeCompare(b.appliesTo, "pt-BR")));
}

export interface TemplateOption {
  id: string;
  name: string;
  active: boolean;
  totalDays: number;
}

export async function listImplementationTemplateOptions(): Promise<TemplateOption[]> {
  const templates = await list<ImplementationTemplate>(COLLECTIONS.implementationTemplates);
  return templates.map((t) => ({ id: t.id, name: t.name, active: t.active, totalDays: t.totalDays })).sort(byName);
}

// ---------------------------------------------------------------------------
// Usuários (tela de admin)
// ---------------------------------------------------------------------------

export interface UserRow extends User {
  departmentName: string;
  managerName?: string;
  /** Quantidade de usuários que têm este usuário como gestor. */
  reportsCount: number;
}

export async function listUsersForAdmin(): Promise<{ users: UserRow[]; departments: Department[] }> {
  const [users, departments] = await Promise.all([listUsers(), listDepartments()]);
  const departmentNames = new Map(departments.map((d) => [d.key, d.name]));
  const userNames = new Map(users.map((u) => [u.id, u.name]));
  const reports = new Map<string, number>();
  for (const u of users) if (u.managerId) reports.set(u.managerId, (reports.get(u.managerId) ?? 0) + 1);
  const rows: UserRow[] = users.map((u) => ({
    ...u,
    departmentName: departmentNames.get(u.departmentId) ?? u.departmentId,
    managerName: u.managerId ? userNames.get(u.managerId) : undefined,
    reportsCount: reports.get(u.id) ?? 0,
  }));
  return { users: rows, departments };
}

/** Tarefas ainda abertas atribuídas ao usuário (bloqueiam a exclusão). */
export async function countOpenTasksForUser(userId: string): Promise<number> {
  const tasks = await list<Task>(COLLECTIONS.tasks, { where: [["assigneeId", "==", userId]] });
  return tasks.filter((t) => OPEN_TASK_STATUS.has(t.status)).length;
}

// ---------------------------------------------------------------------------
// Departamentos (tela de admin)
// ---------------------------------------------------------------------------

export interface DepartmentRow extends Department {
  managerName?: string;
  activeUsers: number;
  openTasks: number;
}

export async function listDepartmentsForAdmin(): Promise<{ departments: DepartmentRow[]; users: User[] }> {
  const [departments, users, tasks] = await Promise.all([listDepartments(), listUsers(), list<Task>(COLLECTIONS.tasks)]);
  const managerIds = departments.map((d) => d.managerId).filter((id): id is string => Boolean(id));
  const managers = await getManyByIds<User>(COLLECTIONS.users, managerIds);
  const rows: DepartmentRow[] = departments.map((d) => ({
    ...d,
    managerName: d.managerId ? managers.get(d.managerId)?.name : undefined,
    activeUsers: users.filter((u) => u.departmentId === d.key && u.active !== false).length,
    openTasks: tasks.filter((t) => t.departmentId === d.key && OPEN_TASK_STATUS.has(t.status)).length,
  }));
  return { departments: rows, users };
}

// ---------------------------------------------------------------------------
// Produtos (tela de admin)
// ---------------------------------------------------------------------------

export interface ProductRow extends Product {
  templateName?: string;
}

export async function listProductsForAdmin(): Promise<{ products: ProductRow[]; templates: TemplateOption[] }> {
  const [products, templates] = await Promise.all([listProducts(), listImplementationTemplateOptions()]);
  const templateNames = new Map(templates.map((t) => [t.id, t.name]));
  const rows: ProductRow[] = products.map((p) => ({ ...p, templateName: p.implementationTemplateId ? templateNames.get(p.implementationTemplateId) : undefined }));
  return { products: rows, templates };
}

// ---------------------------------------------------------------------------
// Configurações (tela de admin)
// ---------------------------------------------------------------------------

export interface AdminSettings {
  values: SettingValues;
  /** Chaves que já têm documento gravado (as demais mostram o padrão). */
  stored: SettingKey[];
  slaRules: SlaRule[];
}

/** Chaves reais das origens de lead (sugestões na tabela de lead scoring). */
export async function listLeadSourceKeys(): Promise<string[]> {
  const sources = await list<LeadSource>(COLLECTIONS.leadSources);
  return sources.map((s) => s.key).sort();
}

export async function loadSettingsForAdmin(): Promise<AdminSettings> {
  const [docs, slaRules] = await Promise.all([list<Settings>(COLLECTIONS.settings), listSlaRules()]);
  const byKey = new Map(docs.map((d) => [d.key, d]));
  const values = { ...SETTING_DEFAULTS };
  const stored: SettingKey[] = [];
  for (const key of SETTING_KEYS) {
    const doc = byKey.get(key);
    if (!doc) continue;
    stored.push(key);
    // Mescla com o padrão para que campos novos apareçam preenchidos mesmo em documentos antigos.
    (values as Record<SettingKey, unknown>)[key] = { ...SETTING_DEFAULTS[key], ...doc.value };
  }
  return { values, stored, slaRules };
}

// ---------------------------------------------------------------------------
// Índice da administração
// ---------------------------------------------------------------------------

export interface AdminOverview {
  users: { total: number; active: number; inactive: number; admins: number };
  departments: { total: number; withManager: number };
  products: { total: number; active: number };
  settings: { stored: number; expected: number };
  slaRules: { total: number; active: number };
  workflows: { templates: number; published: number };
}

export async function getAdminOverview(): Promise<AdminOverview> {
  const [users, departments, products, settings, slaRules, workflows] = await Promise.all([
    list<User>(COLLECTIONS.users),
    list<Department>(COLLECTIONS.departments),
    list<Product>(COLLECTIONS.products),
    list<Settings>(COLLECTIONS.settings),
    list<SlaRule>(COLLECTIONS.slaRules),
    list<WorkflowTemplate>(COLLECTIONS.workflowTemplates),
  ]);
  const storedKeys = new Set(settings.map((s) => s.key));
  return {
    users: {
      total: users.length,
      active: users.filter((u) => u.active !== false).length,
      inactive: users.filter((u) => u.active === false).length,
      admins: users.filter((u) => u.role === "admin" && u.active !== false).length,
    },
    departments: { total: departments.length, withManager: departments.filter((d) => Boolean(d.managerId)).length },
    products: { total: products.length, active: products.filter((p) => p.active).length },
    settings: { stored: SETTING_KEYS.filter((k) => storedKeys.has(k)).length, expected: SETTING_KEYS.length },
    slaRules: { total: slaRules.length, active: slaRules.filter((r) => r.active).length },
    workflows: { templates: workflows.length, published: workflows.filter((w) => w.published).length },
  };
}
