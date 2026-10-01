/**
 * Organização, departamentos e usuários (banco + Supabase Auth).
 */
import { COLLECTIONS, type Department, type Organization, type PermissionProfile, type User } from "../../src/domain/types";
import { ROLE_KEYS } from "../../src/domain/constants";
import { authAdmin } from "../../src/server/auth/auth-admin";
import { ORG_ID } from "../../src/server/db";
import { NOW, daysAgo, type SeedDoc } from "./lib";
import type { SeedContext, UserKey } from "./context";
import { DEPARTMENTS, USER_SPECS } from "./org-data";

export { USER_SPECS } from "./org-data";

/**
 * Senha dos usuários de demonstração. Com banco local (DATABASE_URL em localhost) vale a padrão "interos123".
 * Fora dele é obrigatório informar INTEROS_SEED_PASSWORD: o repositório é público e uma senha
 * conhecida daria acesso de administrador à produção.
 */
export const SEED_PASSWORD = resolveSeedPassword();

function resolveSeedPassword(): string {
  const fromEnv = process.env.INTEROS_SEED_PASSWORD?.trim();
  if (fromEnv) {
    if (fromEnv.length < 10) throw new Error("INTEROS_SEED_PASSWORD precisa ter pelo menos 10 caracteres.");
    return fromEnv;
  }
  if (/@(localhost|127\.0\.0\.1)[:/]/.test(process.env.DATABASE_URL ?? "")) return "interos123";
  throw new Error("Defina INTEROS_SEED_PASSWORD para rodar o seed fora do banco local.");
}

/** Presença inicial dos usuários operacionais (Online/Ausente/Ocupado da top bar). */
const PRESENCE: Partial<Record<UserKey, User["presence"]>> = {
  vinicius: "online",
  igor: "online",
  rafael: "online",
  larissa: "ocupado",
  marcos: "online",
  bruno: "ausente",
  camila: "online",
  anapaula: "ausente",
  karem: "online",
};

export async function seedOrg(ctx: SeedContext): Promise<void> {
  const { store } = ctx;
  const createdAt = daysAgo(1100);

  store.add(COLLECTIONS.organizations, ORG_ID, {
    name: "Intercert",
    slug: "intercert",
    timezone: "America/Sao_Paulo",
    // Sem `activeModules`: ausente = todos os módulos ativos (A8), inclusive os que o catálogo ganhar no futuro.
    // Gravar a lista explícita desligaria em silêncio todo módulo novo até alguém ligá-lo.
    createdAt,
  } satisfies SeedDoc<Organization>);

  // Perfis de acesso (A6/A17): um documento vazio por papel = regra padrão do catálogo (nenhuma restrição ativa).
  for (const role of ROLE_KEYS) {
    store.add(COLLECTIONS.permissionProfiles, `role_${role}`, {
      kind: "role",
      role,
      grants: {},
      scopes: {},
      createdAt,
    } satisfies SeedDoc<PermissionProfile>);
  }

  const userId = (key: UserKey) => `user_${key}`;

  DEPARTMENTS.forEach((d, i) => {
    store.add(COLLECTIONS.departments, `dept_${d.key}`, {
      key: d.key,
      name: d.name,
      managerId: userId(d.manager),
      color: d.color,
      order: i + 1,
      description: d.description,
      createdAt,
    } satisfies SeedDoc<Department>);
  });

  const users = {} as Record<UserKey, User>;
  for (const spec of USER_SPECS) {
    const doc = store.add(COLLECTIONS.users, userId(spec.key), {
      name: spec.name,
      email: spec.email,
      role: spec.role,
      departmentId: spec.department,
      managerId: spec.manager ? userId(spec.manager) : undefined,
      jobTitle: spec.jobTitle,
      phone: `8899${String(100000 + USER_SPECS.indexOf(spec) * 7351).slice(0, 6)}`,
      active: true,
      monthlyGoals: spec.goals,
      baseSalary: spec.baseSalary,
      // Presença informada na top bar (telas operacionais).
      presence: PRESENCE[spec.key],
      presenceUpdatedAt: PRESENCE[spec.key] ? NOW.toISOString() : undefined,
      createdAt,
    } satisfies SeedDoc<User>);
    users[spec.key] = doc;
  }
  ctx.users = users;
}

/** Remove os logins do seed no Supabase Auth e recria com interos_uid = id do documento em users. */
export async function seedAuthUsers(): Promise<number> {
  const emails = new Set(USER_SPECS.map((u) => u.email.toLowerCase()));
  const uids = new Set(USER_SPECS.map((u) => `user_${u.key}`));

  const existing = await authAdmin.listUsers();
  const stale = existing.filter((u) => (u.email && emails.has(u.email.toLowerCase())) || (u.uid && uids.has(u.uid)));
  for (const u of stale) {
    if (u.uid) await authAdmin.deleteUser(u.uid);
    else throw new Error(`Login ${u.email} existe no Supabase Auth sem interos_uid; remova-o no painel antes do seed.`);
  }

  for (const spec of USER_SPECS) {
    await authAdmin.createUser({
      uid: `user_${spec.key}`,
      email: spec.email,
      password: SEED_PASSWORD,
      displayName: spec.name,
    });
  }
  return USER_SPECS.length;
}
