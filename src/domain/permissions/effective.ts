/**
 * Forma das permissões efetivas de um usuário (A4/A5), anexadas ao CurrentUser por getCurrentUser.
 * Só tipos: a resolução fica em src/server/auth/permissions.ts.
 */
import type { PermissionKey, ScreenKey } from "./catalog";
import type { ModuleKey, ScopeKind } from "./types";

/**
 * Origem de cada decisão (para a visão "acesso efetivo"): regra padrão, ajuste do perfil, exceção individual,
 * módulo desativado na empresa ou negado por um nível de cima (tela/seção/módulo) — "hierarquia".
 */
export type PermissionOrigin = "padrao" | "perfil" | "excecao" | "modulo-inativo" | "hierarquia";

export interface EffectivePermissions {
  /** A chave está concedida (efetiva, já com a hierarquia e os módulos ativos). */
  has(key: PermissionKey): boolean;
  /** Conjunto das chaves concedidas. */
  readonly keys: ReadonlySet<PermissionKey>;
  /** Escopo de dados efetivo por tela (só telas com escopo). */
  readonly scopes: Readonly<Partial<Record<ScreenKey, ScopeKind>>>;
  /** Origem da decisão de cada chave do catálogo. */
  readonly origin: Readonly<Record<PermissionKey, PermissionOrigin>>;
  /** Módulos ativos na empresa (inicio e admin sempre). */
  readonly activeModules: ReadonlySet<ModuleKey>;
  /** true quando a leitura de perfis/organização falhou e a matriz padrão está em uso (A4.6). */
  readonly degraded: boolean;
}
