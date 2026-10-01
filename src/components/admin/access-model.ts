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
};

export const KIND_TEXT: Record<AccessTreeNode["kind"], string> = {
  modulo: "Módulo",
  tela: "Tela",
  secao: "Seção",
  acao: "Ação",
};

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
