/**
 * Fixtures em memória para os testes de permissões (T0/A31): os 15 usuários do seed, usuários sintéticos para os
 * papéis sem exemplar e os casos de borda, e todas as combinações papel × departamento.
 */
import { DEPARTMENT_KEYS, ROLE_KEYS, type DepartmentKey, type RoleKey } from "@/domain/constants";
import type { CurrentUser, Department, User } from "@/domain/types";
import { resolvePermissions, type ResolveOptions } from "@/server/auth/permissions";
import { DEPARTMENTS, USER_SPECS } from "../../scripts/seed/org-data";

export interface FixtureUser {
  id: string;
  name: string;
  role: RoleKey;
  departmentId: DepartmentKey;
  managerId?: string;
  active: boolean;
  /** Origem: seed, sintético (A31) ou combinação exaustiva. */
  kind: "seed" | "sintetico" | "combinacao";
}

const iso = "2026-01-01T00:00:00.000Z";

export const SEED_USERS: FixtureUser[] = USER_SPECS.map((u) => ({
  id: `user_${u.key}`,
  name: u.name,
  role: u.role,
  departmentId: u.department,
  managerId: u.manager ? `user_${u.manager}` : undefined,
  active: true,
  kind: "seed",
}));

export const SEED_DEPARTMENTS: Pick<Department, "key" | "managerId">[] = DEPARTMENTS.map((d) => ({ key: d.key, managerId: `user_${d.manager}` }));

/** Usuários sintéticos (A31): não entram no seed para não mexer no acesso rápido nem nos e2e. */
export const SYNTHETIC_USERS: FixtureUser[] = [
  { id: "syn_diretoria", name: "Diretora (não admin)", role: "diretoria", departmentId: "diretoria", managerId: "user_hercules", active: true, kind: "sintetico" },
  { id: "syn_colaborador", name: "Colaborador", role: "colaborador", departmentId: "administrativo", managerId: "user_karem", active: true, kind: "sintetico" },
  { id: "syn_vendas_fin", name: "Vendas no Financeiro", role: "vendas", departmentId: "financeiro", managerId: "user_karem", active: true, kind: "sintetico" },
  { id: "syn_cs_fin", name: "CS no Financeiro", role: "cs", departmentId: "financeiro", managerId: "user_karem", active: true, kind: "sintetico" },
  ...DEPARTMENT_KEYS.map(
    (d): FixtureUser => ({ id: `syn_gestor_${d}`, name: `Gestor de ${d}`, role: "gestor", departmentId: d, managerId: "user_hercules", active: true, kind: "sintetico" }),
  ),
  // Lando com lotação em Suporte e liderança de Implantação e Suporte (multi-departamento).
  { id: "syn_lando_multi", name: "Lando (multi)", role: "gestor", departmentId: "suporte", managerId: "user_hercules", active: true, kind: "sintetico" },
];

/** Todas as combinações papel × departamento (10 × 8 = 80). */
export const COMBINATIONS: FixtureUser[] = ROLE_KEYS.flatMap((role) =>
  DEPARTMENT_KEYS.map((d): FixtureUser => ({ id: `combo_${role}_${d}`, name: `${role}/${d}`, role, departmentId: d, active: true, kind: "combinacao" })),
);

export const ALL_USERS: FixtureUser[] = [...SEED_USERS, ...SYNTHETIC_USERS, ...COMBINATIONS];

/** CurrentUser em memória (mesma derivação de decorate) com permissões resolvidas pelo núcleo. */
export function asCurrentUser(u: Pick<FixtureUser, "id" | "name" | "role" | "departmentId" | "managerId" | "active">, options: ResolveOptions = {}): CurrentUser {
  const user: User = {
    id: u.id,
    organizationId: "intercert",
    createdAt: iso,
    updatedAt: iso,
    name: u.name,
    email: `${u.id}@teste.local`,
    role: u.role,
    departmentId: u.departmentId,
    managerId: u.managerId,
    active: u.active,
  } as User;
  return {
    ...user,
    isAdmin: user.role === "admin",
    isManager: user.role === "gestor" || user.role === "admin" || user.role === "diretoria",
    isDirector: user.role === "diretoria" || user.role === "admin",
    permissions: resolvePermissions(user, options),
  };
}

export const label = (u: Pick<FixtureUser, "id" | "role" | "departmentId">) => `${u.id} (${u.role}/${u.departmentId})`;
