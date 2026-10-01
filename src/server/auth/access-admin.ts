/**
 * Administração de acessos (A6/A10/A16) — funções PURAS usadas pelas actions de perfis/exceções/módulos, pela tela
 * "Perfis e acessos" e pelos testes: árvore do catálogo para a interface, validação dos ajustes gravados, rótulos de
 * negócio de cada chave e diferença "de → para" para a auditoria.
 *
 * Sem dependências de servidor (nada de Firestore/sessão): o catálogo continua fora do bundle do navegador porque a
 * árvore é montada no servidor e entregue pronta (objetos simples) aos Client Components.
 */
import { DEPARTMENT_KEYS, type DepartmentKey, type RoleKey } from "@/domain/constants";
import {
  MODULES,
  MODULE_BY_KEY,
  NODE_BY_KEY,
  PERMISSION_NODES,
  PROTECTED_KEYS,
  SCOPE_KINDS,
  SCREEN_BY_KEY,
  deriveSubject,
  describeRule,
  isPermissionKey,
  type EffectivePermissions,
  type ModuleKey,
  type NodeKind,
  type PermissionKey,
  type PermissionOrigin,
  type ScopeDef,
  type ScopeKind,
} from "@/domain/permissions";
import { defaultScopeFor, resolvePermissions, type PermissionAdjustments } from "./permissions";

// ---------------------------------------------------------------------------
// Rótulos
// ---------------------------------------------------------------------------

/** Rótulos dos escopos na interface ("unidades" não é oferecido: não há unidade no modelo). */
export const SCOPE_LABELS: Record<ScopeKind, string> = {
  meus: "Somente os próprios",
  equipe: "Equipe",
  departamento: "Departamento",
  unidades: "Unidades autorizadas",
  empresa: "Toda a empresa",
};

const SCOPE_DEFAULT_DESCRIPTIONS: Record<ScopeKind, string> = {
  meus: "Só os registros em que a pessoa é a responsável.",
  equipe: "Seus liderados e os departamentos que você lidera.",
  departamento: "Seu departamento.",
  unidades: "Equivale a toda a empresa (não há unidades cadastradas).",
  empresa: "Todos os registros da empresa.",
};

export const ORIGIN_LABELS: Record<PermissionOrigin, string> = {
  padrao: "Regra padrão",
  perfil: "Perfil",
  excecao: "Exceção individual",
  "modulo-inativo": "Módulo desativado",
  hierarquia: "Nível acima negado",
};

const SCOPE_ORDER: Record<ScopeKind, number> = { meus: 0, equipe: 1, departamento: 2, unidades: 3, empresa: 4 };

/** Escopo `a` é mais amplo que `b`? ("unidades" vale "empresa") */
export function scopeWider(a: ScopeKind, b: ScopeKind): boolean {
  const norm = (k: ScopeKind) => (k === "unidades" ? SCOPE_ORDER.empresa : SCOPE_ORDER[k]);
  return norm(a) > norm(b);
}

function screenOf(key: string) {
  const node = NODE_BY_KEY.get(key);
  return node?.screen ? SCREEN_BY_KEY.get(node.screen) : undefined;
}

/**
 * Caminho de negócio de uma chave para mensagens e auditoria:
 * módulo "Financeiro › Acesso ao módulo"; tela "Contas a Pagar › Visualizar"; seção "Comissões › Todas as
 * comissões"; ação "Contas a Pagar › Aprovar pagamento". Chave desconhecida → a própria chave.
 */
export function permissionPath(key: string): string {
  const node = NODE_BY_KEY.get(key);
  if (!node) return key;
  if (node.kind === "modulo") return `${node.label} › Acesso ao módulo`;
  const screen = screenOf(key);
  const screenLabel = screen?.label ?? node.label;
  if (node.kind === "tela") return `${screenLabel} › Visualizar`;
  return `${screenLabel} › ${node.label}`;
}

/** Rótulo do escopo de uma tela na auditoria ("Oportunidades › Escopo de dados"). */
export function scopePath(screenKey: string): string {
  return `${SCREEN_BY_KEY.get(screenKey)?.label ?? screenKey} › Escopo de dados`;
}

// ---------------------------------------------------------------------------
// Árvore para a interface
// ---------------------------------------------------------------------------

export interface AccessTreeNode {
  key: string;
  kind: NodeKind;
  label: string;
  /** Pai na árvore exibida (módulo → tela → seção → ação). */
  parent: string | null;
  depth: number;
  /** Texto da regra padrão (describeRule). */
  ruleText: string;
  protected: boolean;
  sensitive: boolean;
  module: ModuleKey;
  /** Observação de negócio exibida abaixo do nó (ex.: efeito de negar uma aprovação "de qualquer um"). */
  note?: string;
}

export interface AccessScopeOption {
  value: ScopeKind;
  label: string;
  description: string;
}

/** Escopo de dados configurável de uma tela. */
export interface AccessScreenScope {
  screen: string;
  /** Chave de visualização da tela (o escopo aparece junto do nó da tela). */
  viewKey: string;
  label: string;
  options: AccessScopeOption[];
}

export interface AccessModuleInfo {
  key: ModuleKey;
  label: string;
  deactivatable: boolean;
  screens: number;
}

const NODE_NOTES: Partial<Record<string, string>> = {
  "operacao.workflow.aprovar-qualquer": "Negar faz a pessoa aprovar só as etapas atribuídas a ela na jornada do cliente.",
  "implantacao.go-live.aprovar-qualquer": "Negar faz a pessoa aprovar só o go-live dos projetos em que é responsável.",
  "inicio.meu-dia.ver": "Protegido: é para o Meu Dia que todo acesso negado volta.",
  "admin.acessos.gerir": "Protegido: sempre precisa existir ao menos um usuário ativo com este acesso.",
  "admin.usuarios.editar": "Protegido: sempre precisa existir ao menos um usuário ativo com este acesso.",
};

function displayParent(key: PermissionKey): string | null {
  const node = NODE_BY_KEY.get(key);
  if (!node || node.kind === "modulo") return null;
  if (node.kind === "tela") return `${node.module}.acessar`;
  return node.requires.keys[0] ?? `${node.module}.acessar`;
}

let treeCache: AccessTreeNode[] | null = null;

/** Árvore completa do catálogo, em ordem (módulo, telas, seções, ações). */
export function buildAccessTree(): AccessTreeNode[] {
  if (treeCache) return treeCache;
  const depthOf = new Map<string, number>();
  const nodes: AccessTreeNode[] = [];
  for (const n of PERMISSION_NODES) {
    const parent = displayParent(n.key);
    const depth = parent ? (depthOf.get(parent) ?? 0) + 1 : 0;
    depthOf.set(n.key, depth);
    nodes.push({
      key: n.key,
      kind: n.kind,
      label: n.label,
      parent,
      depth,
      ruleText: describeRule(n.rule),
      protected: n.protected,
      sensitive: n.sensitive,
      module: n.module,
      note: NODE_NOTES[n.key],
    });
  }
  treeCache = nodes;
  return nodes;
}

function configurableScope(def: ScopeDef | null | undefined): def is ScopeDef & { allowed: readonly ScopeKind[] } {
  if (!def || def.fixed || def.sameAs || !def.allowed) return false;
  return def.allowed.filter((k) => k !== "unidades").length > 1;
}

/** Telas cujo escopo de dados o CEO/CTO pode escolher (sem "unidades"; "Equipe" com a semântica da tela). */
export function buildScopeOptions(): AccessScreenScope[] {
  const out: AccessScreenScope[] = [];
  for (const m of MODULES) {
    for (const s of m.screens) {
      const def = s.scope as ScopeDef | null;
      if (!configurableScope(def)) continue;
      const options = def.allowed
        .filter((k) => k !== "unidades")
        .map((k): AccessScopeOption => ({
          value: k,
          label: SCOPE_LABELS[k],
          description: (k === "equipe" || k === "departamento" ? def.variants?.[k]?.description : undefined) ?? SCOPE_DEFAULT_DESCRIPTIONS[k],
        }));
      out.push({ screen: s.key, viewKey: `${s.key}.ver`, label: s.label, options });
    }
  }
  return out;
}

export function buildModuleInfo(): AccessModuleInfo[] {
  return MODULES.map((m) => ({ key: m.key, label: m.label, deactivatable: m.deactivatable, screens: m.screens.length }));
}

/** Escopo configurável da tela (para validar a gravação). */
export function allowedScopesFor(screenKey: string): ScopeKind[] | null {
  const def = SCREEN_BY_KEY.get(screenKey)?.scope as ScopeDef | null | undefined;
  if (!configurableScope(def)) return null;
  return def.allowed.filter((k) => k !== "unidades");
}

// ---------------------------------------------------------------------------
// Padrão por papel (texto "Padrão (permitido)")
// ---------------------------------------------------------------------------

/** "s" = permitido, "n" = negado, "d" = depende do departamento da pessoa. */
export type DefaultValue = "s" | "n" | "d";

/** Valor efetivo padrão (sem perfil nem exceção, todos os módulos ativos) de cada chave para um papel. */
export function roleDefaults(role: RoleKey): Record<string, DefaultValue> {
  const perms = DEPARTMENT_KEYS.map((d) => resolvePermissions({ role, departmentId: d }));
  const out: Record<string, DefaultValue> = {};
  for (const n of PERMISSION_NODES) {
    const values = perms.map((p) => p.has(n.key));
    out[n.key] = values.every(Boolean) ? "s" : values.some(Boolean) ? "d" : "n";
  }
  return out;
}

/** Escopo padrão de cada tela configurável para um papel (null = varia com o departamento). */
export function roleDefaultScopes(role: RoleKey): Record<string, ScopeKind | null> {
  const out: Record<string, ScopeKind | null> = {};
  for (const opt of buildScopeOptions()) {
    const def = SCREEN_BY_KEY.get(opt.screen)?.scope as ScopeDef;
    const kinds = new Set(DEPARTMENT_KEYS.map((d: DepartmentKey) => defaultScopeFor(def, deriveSubject({ role, departmentId: d }))));
    out[opt.screen] = kinds.size === 1 ? [...kinds][0] : null;
  }
  return out;
}

/** Valor efetivo (sim/não) de cada chave em um conjunto de permissões. */
export function effectiveValues(perms: EffectivePermissions): Record<string, boolean> {
  const out: Record<string, boolean> = {};
  for (const n of PERMISSION_NODES) out[n.key] = perms.has(n.key);
  return out;
}

// ---------------------------------------------------------------------------
// Validação dos ajustes recebidos (actions)
// ---------------------------------------------------------------------------

export interface CleanAdjustments {
  grants: Record<string, boolean>;
  scopes: Record<string, ScopeKind>;
}

/** Objeto simples (não array, não null, protótipo padrão ou nulo). */
function isPlainRecord(value: unknown): value is Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const proto = Object.getPrototypeOf(value);
  return proto === Object.prototype || proto === null;
}

/**
 * Valida os ajustes vindos do cliente: só chaves PRÓPRIAS (Object.keys), todas do catálogo, valores booleanos;
 * escopos só em telas configuráveis e dentro dos permitidos (sem "unidades"). Qualquer problema → lista de erros
 * (nada é silenciosamente descartado: a gravação é recusada).
 */
export function validateAdjustments(input: { grants?: unknown; scopes?: unknown }): { ok: true; value: CleanAdjustments } | { ok: false; errors: string[] } {
  const errors: string[] = [];
  const grants: Record<string, boolean> = {};
  const scopes: Record<string, ScopeKind> = {};
  const rawGrants = input.grants ?? {};
  const rawScopes = input.scopes ?? {};
  if (!isPlainRecord(rawGrants)) errors.push("Lista de acessos inválida");
  else {
    for (const key of Object.keys(rawGrants)) {
      const value = rawGrants[key];
      if (key === "__proto__" || key === "constructor" || key === "prototype" || !isPermissionKey(key)) {
        errors.push(`Acesso desconhecido: ${key}`);
        continue;
      }
      if (typeof value !== "boolean") {
        errors.push(`Valor inválido para ${permissionPath(key)} (use permitir ou negar)`);
        continue;
      }
      grants[key] = value;
    }
  }
  if (!isPlainRecord(rawScopes)) errors.push("Lista de escopos inválida");
  else {
    for (const key of Object.keys(rawScopes)) {
      const value = rawScopes[key];
      const allowed = key === "__proto__" ? null : allowedScopesFor(key);
      if (!allowed) {
        errors.push(`Tela sem escopo configurável: ${key}`);
        continue;
      }
      if (typeof value !== "string" || !(SCOPE_KINDS as readonly string[]).includes(value) || !allowed.includes(value as ScopeKind)) {
        errors.push(`Escopo não permitido em ${SCREEN_BY_KEY.get(key)?.label ?? key}: ${String(value)}`);
        continue;
      }
      scopes[key] = value as ScopeKind;
    }
  }
  return errors.length ? { ok: false, errors } : { ok: true, value: { grants, scopes } };
}

/** Módulos inativos válidos: só módulos existentes e desativáveis. */
export function validateInactiveModules(input: unknown): { ok: true; value: ModuleKey[] } | { ok: false; errors: string[] } {
  if (!Array.isArray(input)) return { ok: false, errors: ["Lista de módulos inválida"] };
  const errors: string[] = [];
  const out = new Set<ModuleKey>();
  for (const m of input) {
    const def = typeof m === "string" ? MODULE_BY_KEY.get(m as ModuleKey) : undefined;
    if (!def) {
      errors.push(`Módulo desconhecido: ${String(m)}`);
      continue;
    }
    if (!def.deactivatable) {
      errors.push(`O módulo ${def.label} não pode ser desativado`);
      continue;
    }
    out.add(def.key);
  }
  return errors.length ? { ok: false, errors } : { ok: true, value: [...out] };
}

/** Lista completa de módulos ativos a partir dos inativos (undefined = todos ativos). */
export function activeModulesFrom(inactive: readonly ModuleKey[]): ModuleKey[] | undefined {
  if (!inactive.length) return undefined;
  return MODULES.map((m) => m.key).filter((k) => !inactive.includes(k));
}

/** Módulos inativos a partir da lista de ativos gravada (ausente = nenhum). */
export function inactiveModulesFrom(activeModules: readonly string[] | undefined): ModuleKey[] {
  if (!activeModules) return [];
  return MODULES.filter((m) => m.deactivatable && !activeModules.includes(m.key)).map((m) => m.key);
}

// ---------------------------------------------------------------------------
// Auditoria "de → para"
// ---------------------------------------------------------------------------

const VALUE_TEXT = { true: "Permitido", false: "Negado" } as const;

export function defaultValueText(value: DefaultValue | boolean | undefined, base = "Padrão"): string {
  if (value === undefined) return base;
  const v = value === true || value === "s" ? "permitido" : value === false || value === "n" ? "negado" : "depende do departamento";
  return `${base} (${v})`;
}

export interface AdjustmentDiff {
  /** Chave → { from, to } em texto de negócio (grants por chave de permissão; escopos como `escopo:<tela>`). */
  changes: Record<string, { from: string; to: string }>;
  /** Chave → caminho de negócio ("Contas a Pagar › Visualizar"). */
  labels: Record<string, string>;
}

/**
 * Diferença entre dois conjuntos de ajustes. `baseline(key)` devolve o texto do nível mais geral quando a chave não
 * está ajustada (ex.: "Padrão (permitido)", "Padrão do perfil (negado)"); `scopeBaseline(tela)` idem para escopos.
 */
export function diffAdjustments(
  before: PermissionAdjustments | null | undefined,
  after: CleanAdjustments,
  baseline: (key: string) => string,
  scopeBaseline: (screen: string) => string,
): AdjustmentDiff {
  const changes: AdjustmentDiff["changes"] = {};
  const labels: AdjustmentDiff["labels"] = {};
  const bg = before?.grants ?? {};
  const bs = before?.scopes ?? {};
  const grantKeys = new Set([...Object.keys(bg), ...Object.keys(after.grants)]);
  for (const node of PERMISSION_NODES) {
    const key = node.key;
    if (!grantKeys.has(key)) continue;
    const from = Object.hasOwn(bg, key) ? bg[key] : undefined;
    const to = Object.hasOwn(after.grants, key) ? after.grants[key] : undefined;
    if (from === to) continue;
    changes[key] = {
      from: typeof from === "boolean" ? VALUE_TEXT[String(from) as "true" | "false"] : baseline(key),
      to: typeof to === "boolean" ? VALUE_TEXT[String(to) as "true" | "false"] : baseline(key),
    };
    labels[key] = permissionPath(key);
  }
  const scopeKeys = new Set([...Object.keys(bs), ...Object.keys(after.scopes)]);
  for (const screen of [...scopeKeys].sort()) {
    const from = Object.hasOwn(bs, screen) ? bs[screen] : undefined;
    const to = Object.hasOwn(after.scopes, screen) ? after.scopes[screen] : undefined;
    if (from === to) continue;
    const id = `escopo:${screen}`;
    changes[id] = { from: from ? SCOPE_LABELS[from] : scopeBaseline(screen), to: to ? SCOPE_LABELS[to] : scopeBaseline(screen) };
    labels[id] = scopePath(screen);
  }
  return { changes, labels };
}

/** Resumo legível, limitado (o payload guarda tudo). */
export function describeDiff(diff: AdjustmentDiff, max = 12): string {
  const entries = Object.entries(diff.changes);
  const parts = entries.slice(0, max).map(([k, c]) => `${diff.labels[k] ?? k}: ${c.from} → ${c.to}`);
  if (entries.length > max) parts.push(`e mais ${entries.length - max} alteração(ões)`);
  return parts.join(" · ");
}

/** Chaves protegidas (A9), como lista de strings (para o cliente e as mensagens). */
export const PROTECTED_KEY_LIST: readonly string[] = PROTECTED_KEYS;
