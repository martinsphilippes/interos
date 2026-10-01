/**
 * Avaliador ÚNICO da DSL de regras de acesso (A3/A24) e descrição em português para a interface.
 * Puro: não lê banco nem sessão. As extensões estruturais (moduleGate, modules, requireScreenAny, nav.rule,
 * quickAction.rule, checkedIn) são aplicadas pelo resolvedor sobre esta mesma função.
 */
import { DEPARTMENT_LABELS, ROLE_KEYS, ROLE_LABELS, type DepartmentKey, type RoleKey } from "../constants";
import { NODE_BY_KEY } from "./catalog";
import type { AccessRule } from "./types";

/**
 * Sujeito avaliado. As capacidades derivam só do papel, exatamente como `decorate` em session.ts
 * (isAdmin = admin; isManager = gestor|admin|diretoria; isDirector = diretoria|admin).
 */
export interface RuleSubject {
  readonly id?: string;
  readonly role: RoleKey;
  readonly departmentId?: DepartmentKey;
  readonly isAdmin: boolean;
  readonly isManager: boolean;
  readonly isDirector: boolean;
  /** Departamentos que o usuário lidera (`departments.managerId`) — usado no escopo, não nas regras. */
  readonly managedDepartments?: readonly DepartmentKey[];
}

export interface RuleContext {
  /** Permissão efetiva de outra chave (regra `{ can }`). Sem resolvedor, `{ can }` nega. */
  readonly can?: (key: string) => boolean;
}

/** Deriva o sujeito a partir do papel e do departamento (mesma derivação de `decorate`). */
export function deriveSubject(user: { id?: string; role: RoleKey; departmentId?: DepartmentKey; managedDepartments?: readonly DepartmentKey[] }): RuleSubject {
  const role = user.role;
  return {
    id: user.id,
    role,
    departmentId: user.departmentId,
    isAdmin: role === "admin",
    isManager: role === "gestor" || role === "admin" || role === "diretoria",
    isDirector: role === "diretoria" || role === "admin",
    managedDepartments: user.managedDepartments,
  };
}

function asList<T>(value: T | readonly T[]): readonly T[] {
  return Array.isArray(value) ? (value as readonly T[]) : [value as T];
}

/** Avalia uma regra para o sujeito. Regra desconhecida nega (falha fechada). */
export function evaluateRule(rule: AccessRule, subject: RuleSubject, ctx: RuleContext = {}): boolean {
  if (rule === "all") return true;
  if (typeof rule !== "object" || rule === null) return false;
  if ("any" in rule) return rule.any.some((r) => evaluateRule(r, subject, ctx));
  if ("all" in rule) return rule.all.every((r) => evaluateRule(r, subject, ctx));
  if ("role" in rule) return asList(rule.role).includes(subject.role);
  if ("department" in rule) return subject.departmentId !== undefined && asList(rule.department).includes(subject.departmentId);
  if ("manager" in rule) return rule.manager === true && subject.isManager;
  if ("director" in rule) return rule.director === true && subject.isDirector;
  if ("managerOf" in rule) return subject.isManager && (subject.role === rule.managerOf || subject.departmentId === rule.managerOf);
  if ("can" in rule) return ctx.can ? ctx.can(rule.can) : false;
  return false;
}

/** Valida a forma de uma regra (usado nos testes de integridade e ao gravar perfis). */
export function isValidRule(rule: unknown): rule is AccessRule {
  if (rule === "all") return true;
  if (!rule || typeof rule !== "object" || Array.isArray(rule)) return false;
  const entries = Object.entries(rule);
  if (entries.length !== 1) return false;
  const [op, value] = entries[0];
  switch (op) {
    case "any":
    case "all":
      return Array.isArray(value) && value.length > 0 && value.every(isValidRule);
    case "role":
      return asList(value as string).length > 0 && asList(value as string).every((r) => (ROLE_KEYS as readonly string[]).includes(r));
    case "department":
      return asList(value as string).length > 0 && asList(value as string).every((d) => d in DEPARTMENT_LABELS);
    case "manager":
    case "director":
      return value === true;
    case "managerOf":
      return typeof value === "string" && value in DEPARTMENT_LABELS;
    case "can":
      return typeof value === "string" && NODE_BY_KEY.has(value);
    default:
      return false;
  }
}

/** Chaves referenciadas por `{ can }` (para checar ciclos e existência). */
export function ruleReferences(rule: AccessRule): string[] {
  if (rule === "all" || typeof rule !== "object") return [];
  if ("any" in rule) return rule.any.flatMap(ruleReferences);
  if ("all" in rule) return rule.all.flatMap(ruleReferences);
  if ("can" in rule) return [rule.can];
  return [];
}

// ---------------------------------------------------------------------------
// Descrição para a interface
// ---------------------------------------------------------------------------

function roleList(roles: readonly RoleKey[]): string {
  const labels = roles.map((r) => ROLE_LABELS[r]);
  return `${labels.length > 1 ? "papéis" : "papel"} ${joinPt(labels)}`;
}

function departmentList(departments: readonly DepartmentKey[]): string {
  const labels = departments.map((d) => DEPARTMENT_LABELS[d]);
  return `${labels.length > 1 ? "departamentos" : "departamento"} ${joinPt(labels)}`;
}

function joinPt(items: readonly string[], last = "e"): string {
  if (items.length <= 1) return items.join("");
  return `${items.slice(0, -1).join(", ")} ${last} ${items[items.length - 1]}`;
}

function describeInner(rule: AccessRule, nested: boolean): string {
  if (rule === "all") return "Todos (que acessam o nível acima)";
  if ("any" in rule) {
    const text = joinPt(rule.any.map((r) => describeInner(r, true)), "ou");
    return nested && rule.any.length > 1 ? `(${text})` : text;
  }
  if ("all" in rule) {
    const text = rule.all.map((r) => describeInner(r, true)).join(" e ");
    return nested && rule.all.length > 1 ? `(${text})` : text;
  }
  if ("role" in rule) return roleList(asList(rule.role));
  if ("department" in rule) return departmentList(asList(rule.department));
  if ("manager" in rule) return "gestores (gestor, diretoria e administrador)";
  if ("director" in rule) return "diretoria e administrador";
  if ("managerOf" in rule) return `gestores de ${DEPARTMENT_LABELS[rule.managerOf]} (gestor, diretoria ou administrador com papel ou departamento ${DEPARTMENT_LABELS[rule.managerOf]})`;
  if ("can" in rule) {
    const node = NODE_BY_KEY.get(rule.can);
    return node ? `quem tem «${node.kind === "modulo" ? `acesso ao módulo ${node.label}` : node.label}»` : `quem tem a permissão ${rule.can}`;
  }
  return "regra desconhecida (nega)";
}

/** Texto amigável da regra padrão (ex.: "papéis Administrador, Diretoria e Financeiro ou departamento Financeiro"). */
export function describeRule(rule: AccessRule): string {
  const text = describeInner(rule, false);
  return text.charAt(0).toUpperCase() + text.slice(1);
}
