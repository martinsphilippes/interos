/**
 * Escopo de dados por tela (A7/A23/A29): "meus" | "equipe" | "departamento" | "unidades" | "empresa".
 *
 * O escopo efetivo de cada tela vem de `user.permissions.scopes` (exceção ?? perfil ?? padrão do papel, sempre dentro
 * de `scope.allowed`). Aqui ele vira um conjunto de pessoas/departamentos, com a semântica de "equipe" e
 * "departamento" de CADA tela (`scope.variants` do catálogo), reproduzindo os resolvedores atuais dos módulos:
 *   - Meu Dia, Central de Vendas, Agenda, Implantação: equipe = o usuário + liderados diretos (users.managerId), 1 nível;
 *     diretoria/admin na Central/Agenda = o departamento de Vendas inteiro (departamento fixo);
 *   - Comissões, Contas a Pagar, Performance: departamento próprio ∪ departamentos liderados (departments.managerId)
 *     ∪ liderados diretos ∪ o próprio (getGoalPermissions);
 *   - Dashboard do Gestor: liderados diretos e os liderados deles (2 níveis), sem o próprio (teamOf);
 *   - CS: limite empresa para todos, visão inicial "meus" para analista de CS não gestor;
 *   - Suporte: limite empresa, visão inicial "meus" (com a fila sem atendente) para quem não é gestor;
 *   - Tarefas e SLA: departamento próprio (+ as próprias tarefas); gestores veem a empresa.
 * "unidades" resolve como "empresa" (não há unidade no modelo) e não é oferecido na interface.
 *
 * Todos os módulos consultam `resolveDataScope` (Meu Dia, Tarefas, Clientes 360º, Workflow, SLA, busca global, Vendas,
 * Financeiro, Comissões/Contas a Pagar, Implantação, CS, Suporte, Marketing, Performance/Gestão e Relatórios); os
 * resolvedores antigos que ainda existem são fachadas sobre ele. Os testes de equivalência provam que o padrão produz o
 * mesmo conjunto de usuários de antes para todos os usuários do seed e os sintéticos.
 */
import { cache } from "react";
import { COLLECTIONS, type CurrentUser, type Department, type User } from "@/domain/types";
import type { DepartmentKey } from "@/domain/constants";
import {
  SCREEN_BY_KEY,
  deriveSubject,
  evaluateRule,
  type ScopeDef,
  type ScopeKind,
  type ScreenKey,
  type TeamVariant,
} from "@/domain/permissions";
import { list } from "../db";
import { clampScope, defaultScopeFor, permissionsOf } from "./permissions";

export type { ScopeKind } from "@/domain/permissions";

export interface DataScope {
  screen: ScreenKey;
  /** Limite efetivo (após o recorte por `allowed`; "unidades" = "empresa"). */
  kind: ScopeKind;
  /** Pessoas cujos registros entram (dono ∈ userIds). Ausente = sem recorte por pessoa (empresa). */
  userIds?: ReadonlySet<string>;
  /** Departamentos cujos registros entram (ex.: tarefas do departamento). Ausente = sem recorte por departamento. */
  departmentKeys?: ReadonlySet<DepartmentKey>;
  /** Visão inicial da tela (pode ser mais estreita que o limite). */
  initialKind: ScopeKind;
  /** Com "meus", registros sem responsável continuam visíveis (fila do Suporte). */
  poolUnassigned: boolean;
}

/** Recorte mínimo da organização usado no cálculo (usuários e departamentos). */
export interface OrgSnapshot {
  users: readonly Pick<User, "id" | "departmentId" | "managerId" | "active">[];
  departments: readonly Pick<Department, "key" | "managerId">[];
}

type ScopeSubject = Pick<User, "id" | "role" | "departmentId">;

/** Política única de equipe (A7) para telas sem variante própria. */
const DEFAULT_TEAM: TeamVariant = { reportLevels: 2, managedDepartments: true, departmentBy: "people", includeSelf: true, description: "Seus liderados e os departamentos que você lidera" };
const DEFAULT_DEPARTMENT: TeamVariant = { ownDepartment: true, departmentBy: "record", includeSelf: true, description: "Seu departamento" };

/** Definição de escopo da tela (seguindo `sameAs`). */
export function scopeDefOf(screenKey: string): ScopeDef | null {
  let def = SCREEN_BY_KEY.get(screenKey)?.scope ?? null;
  for (let i = 0; i < 3 && def?.sameAs && !def.allowed; i++) def = SCREEN_BY_KEY.get(def.sameAs)?.scope ?? null;
  if (def?.sameAs) {
    const target = SCREEN_BY_KEY.get(def.sameAs)?.scope;
    if (target?.allowed) return { ...target, ...def, variants: def.variants ?? target.variants, overrides: def.overrides ?? target.overrides };
  }
  return def;
}

function variantFor(def: ScopeDef | null, kind: "equipe" | "departamento"): TeamVariant {
  return def?.variants?.[kind] ?? (kind === "equipe" ? DEFAULT_TEAM : DEFAULT_DEPARTMENT);
}

/** Conjunto de pessoas e departamentos de uma variante (puro). */
export function membersOf(user: ScopeSubject, variant: TeamVariant, org: OrgSnapshot): { userIds: Set<string>; departmentKeys: Set<DepartmentKey> } {
  const active = org.users.filter((u) => u.active !== false);
  const ids = new Set<string>();
  const departments = new Set<DepartmentKey>();
  if (variant.includeSelf) ids.add(user.id);
  if (variant.reportLevels) {
    const direct = active.filter((u) => u.managerId === user.id && u.id !== user.id);
    const directIds = new Set(direct.map((u) => u.id));
    for (const id of directIds) ids.add(id);
    if (variant.reportLevels >= 2) {
      for (const u of active) if (u.managerId && directIds.has(u.managerId) && u.id !== user.id) ids.add(u.id);
    }
  }
  if (variant.ownDepartment) departments.add(user.departmentId);
  if (variant.managedDepartments) for (const d of org.departments) if (d.managerId === user.id) departments.add(d.key);
  if (variant.fixedDepartment) departments.add(variant.fixedDepartment);
  // Recorte por pessoas: quem está lotado nos departamentos entra no conjunto de donos.
  if (variant.departmentBy === "people") for (const u of active) if (departments.has(u.departmentId)) ids.add(u.id);
  return { userIds: ids, departmentKeys: departments };
}

/** Escopo de uma tela para um tipo de recorte (puro; usado por resolveDataScope e pelos testes). */
export function computeDataScope(user: ScopeSubject, screenKey: ScreenKey, kind: ScopeKind, org: OrgSnapshot): DataScope {
  const def = scopeDefOf(screenKey);
  const subject = deriveSubject(user);
  const effective: ScopeKind = kind === "unidades" ? "empresa" : kind;
  const initialKind = initialKindFor(def, subject, effective);
  const base = { screen: screenKey, kind: effective, initialKind, poolUnassigned: Boolean(def?.poolUnassigned) };
  if (effective === "empresa") return base;
  if (effective === "meus") return { ...base, userIds: new Set([user.id]) };
  const variant = variantFor(def, effective);
  const { userIds, departmentKeys } = membersOf(user, variant, org);
  // Com recorte por pessoas os departamentos já viraram donos; só o recorte por registro usa departmentKeys.
  return { ...base, userIds, departmentKeys: variant.departmentBy !== "people" && departmentKeys.size ? departmentKeys : undefined };
}

const SCOPE_RANK: Record<ScopeKind, number> = { meus: 0, equipe: 1, departamento: 2, unidades: 3, empresa: 4 };

function initialKindFor(def: ScopeDef | null, subject: ReturnType<typeof deriveSubject>, limit: ScopeKind): ScopeKind {
  const iv = def?.initialView;
  const wanted: ScopeKind = !iv ? limit : typeof iv === "string" ? iv : evaluateRule(iv.when, subject) ? iv.view : iv.otherwise;
  // A visão inicial nunca é mais ampla que o limite.
  return SCOPE_RANK[wanted] <= SCOPE_RANK[limit] ? wanted : limit;
}

/** Escopo padrão (sem ajustes) da tela para o usuário — o comportamento anterior ao catálogo. */
export function defaultScopeKind(user: ScopeSubject, screenKey: ScreenKey): ScopeKind {
  const def = scopeDefOf(screenKey);
  if (!def?.allowed) return "empresa";
  return defaultScopeFor(def, deriveSubject(user));
}

const loadOrgSnapshot = cache(async (): Promise<OrgSnapshot> => {
  const [users, departments] = await Promise.all([list<User>(COLLECTIONS.users), list<Department>(COLLECTIONS.departments)]);
  return { users, departments };
});

/**
 * Escopo efetivo do usuário numa tela, memoizado por requisição. Tela sem escopo = empresa. Falha ao ler a
 * organização → "meus" (falha fechada) com log.
 */
export const resolveDataScope = cache(async (user: CurrentUser, screenKey: ScreenKey): Promise<DataScope> => {
  const def = scopeDefOf(screenKey);
  if (!def?.allowed) return { screen: screenKey, kind: "empresa", initialKind: "empresa", poolUnassigned: false };
  const kind = clampScope(permissionsOf(user).scopes[screenKey] ?? defaultScopeFor(def, deriveSubject(user)), def.allowed);
  if (kind === "empresa" || kind === "unidades" || kind === "meus") return computeDataScope(user, screenKey, kind, { users: [], departments: [] });
  try {
    return computeDataScope(user, screenKey, kind, await loadOrgSnapshot());
  } catch (error) {
    console.error(`[escopo] falha ao ler a organização para ${screenKey}; aplicando "meus"`, error);
    return computeDataScope(user, screenKey, "meus", { users: [], departments: [] });
  }
});

/** O escopo permite ver um registro destes donos? (qualquer dono dentro do escopo basta) */
export function scopeAllows(scope: Pick<DataScope, "userIds" | "departmentKeys" | "poolUnassigned">, ownerIds: readonly (string | undefined | null)[], departmentId?: string | null): boolean {
  if (!scope.userIds && !scope.departmentKeys) return true;
  const owners = ownerIds.filter((id): id is string => Boolean(id));
  if (scope.userIds && owners.some((id) => scope.userIds!.has(id))) return true;
  if (scope.departmentKeys && departmentId && scope.departmentKeys.has(departmentId as DepartmentKey)) return true;
  if (scope.poolUnassigned && owners.length === 0) return true;
  return false;
}

/** Filtra itens pelo escopo; `ownerOf` devolve os donos do item (e, opcionalmente, o departamento). */
export function filterByScope<T>(items: readonly T[], ownerOf: (item: T) => { owners: readonly (string | undefined | null)[]; departmentId?: string | null }, scope: DataScope): T[] {
  if (!scope.userIds && !scope.departmentKeys) return [...items];
  return items.filter((item) => {
    const { owners, departmentId } = ownerOf(item);
    return scopeAllows(scope, owners, departmentId);
  });
}

/** O usuário pode ver um registro destes donos na tela? (detalhes por id e abas do Cliente 360, A29) */
export async function canSeeRecord(user: CurrentUser, screenKey: ScreenKey, ownerIds: readonly (string | undefined | null)[], departmentId?: string | null): Promise<boolean> {
  if (!permissionsOf(user).has(`${screenKey}.ver` as `${ScreenKey}.ver`)) return false;
  return scopeAllows(await resolveDataScope(user, screenKey), ownerIds, departmentId);
}
