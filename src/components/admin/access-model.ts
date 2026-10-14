/**
 * Rótulos e utilitários da interface de acessos (seguros para o cliente: NÃO importam o catálogo — a árvore chega
 * pronta do servidor). Tipos vêm de src/server/auth/access-admin.ts só como `import type`.
 */
import type { PermissionOrigin, ScopeKind } from "@/domain/permissions";
import type { AccessTreeNode } from "@/server/auth/access-admin";

export const SCOPE_TEXT: Record<ScopeKind, string> = {
  meus: "Somente os próprios",
  equipe: "Equipe",
  departamento: "Departamento",
  unidades: "Unidades autorizadas",
  empresa: "Toda a empresa",
};

export const ORIGIN_TEXT: Record<PermissionOrigin, string> = {
  padrao: "Regra padrão",
  perfil: "Ajuste do perfil",
  excecao: "Exceção individual",
  "modulo-inativo": "Módulo desativado na empresa",
  hierarquia: "Nível acima negado",
  caminho: "Caminho até um item liberado",
  restrito: "Não marcado (modo restrito)",
};

/** Origem em texto; com o papel, deixa claro quando a decisão vem dele ("papel Gestor · regra padrão"). */
export function originText(origin: PermissionOrigin, roleLabel?: string): string {
  if (roleLabel && (origin === "padrao" || origin === "perfil")) return `papel ${roleLabel} · ${ORIGIN_TEXT[origin].toLowerCase()}`;
  return ORIGIN_TEXT[origin];
}

export const KIND_TEXT: Record<AccessTreeNode["kind"], string> = {
  modulo: "Módulo",
  tela: "Tela",
  secao: "Seção",
  acao: "Ação",
};

/** Ancestrais e, em telas abertas por mais de um módulo (e abaixo delas), também esses módulos. */
export function enclosingIndex(tree: readonly AccessTreeNode[], ancestors: (key: string) => string[]): (key: string) => readonly string[] {
  const openedBy = new Map(tree.filter((n) => n.openedBy?.length).map((n) => [n.key, n.openedBy!]));
  const cache = new Map<string, readonly string[]>();
  return (key) => {
    let out = cache.get(key);
    if (!out) {
      const list = ancestors(key);
      const all = [...list];
      for (const k of [key, ...list]) for (const m of openedBy.get(k) ?? []) if (!all.includes(m)) all.push(m);
      out = all;
      cache.set(key, out);
    }
    return out;
  };
}

/** Filhos diretos e quantidade de descendentes de cada nó. */
export function treeIndex(tree: readonly AccessTreeNode[]) {
  const children = new Map<string, string[]>();
  const parent = new Map<string, string | null>();
  for (const n of tree) {
    parent.set(n.key, n.parent);
    if (n.parent) {
      const list = children.get(n.parent) ?? [];
      list.push(n.key);
      children.set(n.parent, list);
    }
  }
  const descendants = new Map<string, number>();
  const count = (key: string): number => {
    const cached = descendants.get(key);
    if (cached !== undefined) return cached;
    const total = (children.get(key) ?? []).reduce((sum, c) => sum + 1 + count(c), 0);
    descendants.set(key, total);
    return total;
  };
  for (const n of tree) count(n.key);
  const ancestors = (key: string): string[] => {
    const out: string[] = [];
    let p = parent.get(key) ?? null;
    while (p) {
      out.push(p);
      p = parent.get(p) ?? null;
    }
    return out;
  };
  return { children, parent, descendants, ancestors };
}

/** Ajustes iguais (mesmas chaves e valores)? */
export function sameAdjustments(a: Record<string, unknown>, b: Record<string, unknown>): boolean {
  const ka = Object.keys(a);
  const kb = Object.keys(b);
  return ka.length === kb.length && ka.every((k) => Object.hasOwn(b, k) && b[k] === a[k]);
}

/** Módulos que seguem sempre o papel no modo restrito (= RESTRICTED_EXEMPT_MODULES do servidor; teste garante). */
export const RESTRICTED_EXEMPT_MODULE_KEYS: readonly string[] = ["inicio"];

// ---------------------------------------------------------------------------
// Rascunho das exceções: de onde vem cada decisão (mesma regra do servidor, em permissions.ts › modo restrito)
// ---------------------------------------------------------------------------

/**
 * marcado = Permitir/Negar marcado na pessoa; papel = segue o papel; caminho = liberado por estar no caminho até um
 * item marcado como Permitir; dentro = segue o papel por estar dentro de um item marcado como Permitir; restrito =
 * bloqueado por não ter sido marcado.
 */
export type DraftSource = "marcado" | "papel" | "caminho" | "dentro" | "restrito";

export interface DraftContext {
  grants: Record<string, boolean>;
  restricted: boolean;
  /** Valor que o papel (sem exceções) dá à chave; undefined = depende do departamento. */
  roleValue: (key: string) => boolean | undefined;
  /** Itens que contêm a chave: ancestrais e, em tela aberta por mais de um módulo, também esses módulos. */
  enclosing: (key: string) => readonly string[];
  /** Chaves no caminho até algum item marcado como Permitir. */
  pathKeys: ReadonlySet<string>;
  /** Chave de módulo que segue sempre o papel (Início). */
  exempt: (key: string) => boolean;
}

/** Chaves no caminho até os itens marcados como Permitir. */
export function pathKeysOf(grants: Record<string, boolean>, ancestors: (key: string) => string[]): Set<string> {
  const out = new Set<string>();
  for (const [key, value] of Object.entries(grants)) if (value === true) for (const a of ancestors(key)) out.add(a);
  return out;
}

/** Valor do próprio nó no rascunho e de onde ele vem (aproximação do servidor; a prévia antes de salvar é exata). */
export function draftDecision(key: string, ctx: DraftContext): { value: boolean | undefined; source: DraftSource } {
  if (Object.hasOwn(ctx.grants, key)) return { value: ctx.grants[key], source: "marcado" };
  if (ctx.restricted && !ctx.exempt(key)) {
    if (ctx.pathKeys.has(key)) return { value: true, source: "caminho" };
    if (ctx.enclosing(key).some((a) => ctx.grants[a] === true)) return { value: ctx.roleValue(key), source: "dentro" };
    return { value: false, source: "restrito" };
  }
  return { value: ctx.roleValue(key), source: "papel" };
}
