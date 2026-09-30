/**
 * Tipos do catálogo de acessos (A2/A24): módulo → tela → seção → ação → escopo.
 * Módulo puro (sem imports de servidor): usado pelo servidor, pelos testes e, no futuro, pela UI de perfis.
 */
import type { DepartmentKey, RoleKey } from "../constants";

/** Módulos do sistema (as mesmas chaves de MODULE_ACCESS). */
export const MODULE_KEYS = ["inicio", "operacao", "marketing", "vendas", "financeiro", "implantacao", "cs", "suporte", "performance", "gestao", "admin"] as const;
export type ModuleKey = (typeof MODULE_KEYS)[number];

/**
 * Escopo de dados de uma tela (A7), do mais restrito ao mais amplo. "unidades" ainda não existe no modelo (não há
 * `User.unitIds`): resolve como "empresa" e não é oferecido na interface.
 */
export const SCOPE_KINDS = ["meus", "equipe", "departamento", "unidades", "empresa"] as const;
export type ScopeKind = (typeof SCOPE_KINDS)[number];

/**
 * Regra declarativa de acesso (mini-DSL, A3/A24). Sem funções: serializável, descritível (describeRule) e avaliada
 * por uma única função pura (evaluateRule).
 * - "all": todos que passam no nível de cima;
 * - any/all: OU/E de regras;
 * - role/department: papel ou departamento do usuário;
 * - manager: gestor, diretoria ou administrador (isManager); director: diretoria ou administrador (isDirector);
 * - managerOf: isManager ∧ (papel ou departamento = d) — a semântica de isFinanceManager, NÃO departments.managerId;
 * - can: a permissão EFETIVA de outra chave (acompanha ajustes de perfil; o grafo de `can` é acíclico).
 */
export type AccessRule =
  | "all"
  | { readonly any: readonly AccessRule[] }
  | { readonly all: readonly AccessRule[] }
  | { readonly role: RoleKey | readonly RoleKey[] }
  | { readonly department: DepartmentKey | readonly DepartmentKey[] }
  | { readonly manager: true }
  | { readonly director: true }
  | { readonly managerOf: DepartmentKey }
  | { readonly can: string };

/** Parâmetros de "equipe"/"departamento" de uma tela (A23: cada tela mantém a semântica atual do seu módulo). */
export interface TeamVariant {
  /** Níveis de liderados por `users.managerId` (1 = diretos; 2 = diretos e os liderados deles). */
  readonly reportLevels?: 1 | 2;
  /** Inclui os colaboradores do próprio departamento. */
  readonly ownDepartment?: boolean;
  /** Inclui os colaboradores dos departamentos que o usuário lidera (`departments.managerId`). */
  readonly managedDepartments?: boolean;
  /** Departamento fixo (ex.: o "time de Vendas" inteiro da diretoria). */
  readonly fixedDepartment?: DepartmentKey;
  /**
   * Como os departamentos recortam: "people" = entram os registros das PESSOAS lotadas neles (comissões, metas,
   * time de vendas); "record" = entram os registros cujo campo de departamento é um deles (tarefas, SLA). Padrão:
   * "record".
   */
  readonly departmentBy?: "people" | "record";
  /** Inclui o próprio usuário. */
  readonly includeSelf?: boolean;
  /** Texto exibido na interface ao lado da opção. */
  readonly description: string;
}

export interface ScopeDef {
  /** Entidade(s) recortada(s) pelo escopo. */
  readonly entity?: string;
  /** Campos de "dono" usados no recorte. */
  readonly ownerFields?: readonly string[];
  /** Escopos que o CEO/CTO pode escolher para a tela. */
  readonly allowed?: readonly ScopeKind[];
  /** Escopo padrão por papel (= comportamento anterior ao catálogo). */
  readonly defaultByRole?: Readonly<Partial<Record<RoleKey, ScopeKind>>>;
  /** Padrões por regra (ex.: qualquer papel do departamento financeiro vê a empresa). */
  readonly overrides?: readonly { readonly when: AccessRule; readonly scope: ScopeKind }[];
  /** Visão inicial da tela (≠ limite): fixa ou condicionada a uma regra. */
  readonly initialView?: ScopeKind | { readonly when: AccessRule; readonly view: ScopeKind; readonly otherwise: ScopeKind };
  /** Semântica de "equipe" e "departamento" desta tela. */
  readonly variants?: Readonly<Partial<Record<"equipe" | "departamento", TeamVariant>>>;
  /** O gestor gere a equipe, mas não a si mesmo (bônus). */
  readonly manageExcludesSelf?: true;
  /** A tela lê o escopo de outra tela da mesma entidade. */
  readonly sameAs?: string;
  /** Com "meus", a fila de itens sem responsável continua visível. */
  readonly poolUnassigned?: true;
  /** Escopo não configurável. */
  readonly fixed?: true;
  /** Onde o recorte é aplicado (consultas, actions e relatórios). */
  readonly applyAt?: readonly string[];
}

/** Leitura chamada pelo cliente (server action) protegida pela própria chave de visualização do nó. */
export interface ViewGuard {
  readonly guard: string;
  readonly label: string;
  readonly recordCondition?: string;
}

export interface SectionDef {
  /** Chave da seção (`<modulo>.<tela>.<secao>.ver`). */
  readonly key: string;
  readonly label: string;
  readonly rule: AccessRule;
  /** Páginas próprias da seção (ex.: /financeiro/comissoes/regras). */
  readonly routes?: readonly string[];
  /**
   * Aba da página da tela (`?aba=<tab>`) que esta seção controla. canSeeHref de um href com `?aba=` exige, além da
   * tela, uma das seções daquela aba (várias seções podem dividir a mesma aba). Aba sem seção = só a tela.
   */
  readonly tab?: string;
  /** Destino da negação quando diferente do padrão. */
  readonly redirectTo?: string;
  readonly viewGuards?: readonly ViewGuard[];
  readonly scope?: ScopeDef;
}

export interface ActionDef {
  /** Chave da ação (`<modulo>.<tela>[.<secao>].<verbo>`). */
  readonly key: string;
  readonly label: string;
  readonly verb: string;
  readonly rule: AccessRule;
  /** Funções/rotas protegidas por esta chave (`arquivo#função[?condição]`), base do verificador de cobertura. */
  readonly guards: readonly string[];
  /** Checada ALÉM da chave dona da função quando a condição ocorre (E lógico). */
  readonly checkedIn?: readonly string[];
  /** Condição de registro que continua no código após requirePermission. */
  readonly recordCondition?: string;
  /** Funções ainda não existentes que usarão a chave. */
  readonly futureGuards?: readonly string[];
  readonly sensitive?: true;
  readonly protected?: true;
}

export interface QuickActionDef {
  readonly key: string;
  readonly label: string;
  readonly description: string;
  readonly href: string;
  readonly icon: string;
  readonly order: number;
  /** Chave da ação de criação exigida. */
  readonly via: string;
  /** Regra adicional do atalho (pode ser mais estrita que a da ação). */
  readonly rule: AccessRule;
}

export interface NavDef {
  /** Seção do menu (módulo) ou null quando o href só serve para canSeeHref. */
  readonly menu: ModuleKey | null;
  readonly href: string;
  readonly order?: number;
  readonly label?: string;
  readonly icon?: string;
  /** Posição no MOBILE_NAV. */
  readonly mobile?: number;
  /** Regra do ITEM de menu quando a rota é mais aberta que o item. */
  readonly rule?: AccessRule;
  readonly quickAction?: QuickActionDef;
}

export interface ScreenDef {
  /** Chave da tela (`<modulo>.<tela>`); a chave de visualização é `<tela>.ver`. */
  readonly key: string;
  readonly module: ModuleKey;
  readonly label: string;
  readonly description: string;
  /** Padrões de rota das páginas da tela (segmentos dinâmicos entre colchetes). */
  readonly routes: readonly string[];
  /** Tela sem página própria (renderizada dentro de outra ou transversal). */
  readonly virtual?: true;
  readonly hostRoutes?: readonly string[];
  /** "ativo": a tela exige só o módulo ATIVO na empresa, não a chave `<modulo>.acessar` do usuário. */
  readonly moduleGate?: "ativo";
  /** A tela abre por qualquer um destes módulos (o primeiro é o primário para ativação). */
  readonly modules?: readonly ModuleKey[];
  /** A página compartilhada aceita qualquer uma destas telas. */
  readonly requireScreenAny?: readonly string[];
  readonly redirectTo?: string;
  readonly protected?: true;
  readonly sensitive?: true;
  readonly rule: AccessRule;
  readonly viewGuards?: readonly ViewGuard[];
  readonly nav?: NavDef;
  readonly sections: readonly SectionDef[];
  readonly actions: readonly ActionDef[];
  readonly scope: ScopeDef | null;
}

export interface ModuleDef {
  readonly key: ModuleKey;
  readonly label: string;
  readonly rule: AccessRule;
  /** Pode ser desativado por empresa (inicio e admin nunca). */
  readonly deactivatable: boolean;
  readonly protected?: true;
  readonly screens: readonly ScreenDef[];
}

export interface Exemption {
  readonly target: string;
  readonly kind: "page" | "action" | "api";
  readonly reason: string;
}
