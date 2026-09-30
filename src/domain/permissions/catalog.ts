/**
 * Catálogo consolidado (A2/A24): junta os módulos, deriva os tipos das chaves e indexa cada nó da árvore
 * módulo → tela → seção → ação. Puro (sem imports de servidor).
 */
import { ADMIN } from "./admin";
import { CS } from "./cs";
import { FINANCEIRO } from "./financeiro";
import { GESTAO } from "./gestao";
import { IMPLANTACAO } from "./implantacao";
import { INICIO } from "./inicio";
import { MARKETING } from "./marketing";
import { OPERACAO } from "./operacao";
import { PERFORMANCE } from "./performance";
import { SUPORTE } from "./suporte";
import { VENDAS } from "./vendas";
import type { AccessRule, ModuleDef, ModuleKey, ScreenDef, SectionDef } from "./types";

/** Módulos na ordem do menu. */
export const MODULES = [INICIO, OPERACAO, MARKETING, VENDAS, FINANCEIRO, IMPLANTACAO, CS, SUPORTE, PERFORMANCE, GESTAO, ADMIN] as const;

type AnyScreen = (typeof MODULES)[number]["screens"][number];
export type ScreenKey = AnyScreen["key"];
export type SectionKey = AnyScreen["sections"][number]["key"];
export type ActionKey = AnyScreen["actions"][number]["key"];
export type ModuleAccessKey = `${ModuleKey}.acessar`;
export type ScreenViewKey = `${ScreenKey}.ver`;
/** Toda chave de permissão do catálogo (união literal). */
export type PermissionKey = ModuleAccessKey | ScreenViewKey | SectionKey | ActionKey;
/** Nó que pode ser exigido por uma página: a tela ou uma seção com página própria. */
export type ScreenNodeKey = ScreenKey | SectionKey;

/** Tabela única de telas. */
export const SCREENS: readonly ScreenDef[] = MODULES.flatMap((m) => m.screens as readonly ScreenDef[]);

export const MODULE_BY_KEY: ReadonlyMap<ModuleKey, ModuleDef> = new Map(MODULES.map((m) => [m.key, m as ModuleDef]));
export const SCREEN_BY_KEY: ReadonlyMap<string, ScreenDef> = new Map(SCREENS.map((s) => [s.key, s]));

export const moduleAccessKey = (m: ModuleKey): ModuleAccessKey => `${m}.acessar`;
export const screenViewKey = (s: ScreenKey): ScreenViewKey => `${s}.ver`;

/**
 * Chaves protegidas (A9): não podem ser negadas ao perfil admin nem retiradas de si mesmo; `inicio.meu-dia.ver`
 * evita o laço de redirecionamento (todo acesso negado volta para o Meu Dia).
 */
export const PROTECTED_KEYS = [
  "inicio.acessar",
  "inicio.meu-dia.ver",
  "admin.acessar",
  "admin.usuarios.ver",
  "admin.usuarios.editar",
  "admin.acessos.ver",
  "admin.acessos.gerir",
] as const satisfies readonly PermissionKey[];

/**
 * Chave de edição exigida por `upsertSetting` para cada configuração (A12/A21). As abas financeiras de
 * /admin/configuracoes pertencem à tela Configurações Financeiras.
 */
export const SETTING_PERMISSION = {
  horario_comercial: "admin.configuracoes.horario.editar",
  feriados: "admin.configuracoes.feriados.editar",
  metas_referencia: "admin.configuracoes.metas.editar",
  lead_scoring: "admin.configuracoes.lead-scoring.editar",
  health_score: "admin.configuracoes.health-score.editar",
  oportunidade: "admin.configuracoes.oportunidades.editar",
  go_live: "admin.configuracoes.entrega.editar",
  cs_ativacao: "admin.configuracoes.entrega.editar",
  gamificacao: "admin.configuracoes.performance.editar",
  premios_vendas: "admin.configuracoes.performance.editar",
  "gamificacao.sequencia": "admin.configuracoes.performance.editar",
  gate_financeiro: "financeiro.configuracoes.gate.editar",
  financeiro_alertas: "financeiro.configuracoes.alertas.editar",
  regua_cobranca: "financeiro.configuracoes.regua.editar",
  cobranca_canais: "financeiro.configuracoes.canais.editar",
  financeiro_baixa: "financeiro.configuracoes.integracao-bancaria.editar",
  contas_a_pagar: "financeiro.configuracoes.contas-a-pagar.editar",
  comissoes_pagamento: "financeiro.configuracoes.comissoes-pagamento.editar",
} as const satisfies Record<string, PermissionKey>;

// ---------------------------------------------------------------------------
// Índice de nós
// ---------------------------------------------------------------------------

export type NodeKind = "modulo" | "tela" | "secao" | "acao";

/** Nó da árvore de permissões com o que ele exige do nível de cima (A4.2). */
export interface PermissionNode {
  readonly key: PermissionKey;
  readonly kind: NodeKind;
  readonly label: string;
  /** Módulo cuja ativação na empresa governa o nó (o primário, nas telas com `modules`). */
  readonly module: ModuleKey;
  readonly screen?: ScreenKey;
  /** Regra padrão do próprio nó. */
  readonly rule: AccessRule;
  /**
   * Nível de cima exigido: "all" = todas as chaves (E lógico); "any" = qualquer uma (telas abertas por mais de
   * um módulo). Lista vazia = só o módulo ativo (moduleGate "ativo") ou o próprio módulo.
   */
  readonly requires: { readonly mode: "all" | "any"; readonly keys: readonly PermissionKey[] };
  readonly protected: boolean;
  readonly sensitive: boolean;
}

function sectionPrefix(section: SectionDef): string {
  return section.key.replace(/\.ver$/, "");
}

function buildNodes(): PermissionNode[] {
  const protectedSet = new Set<string>(PROTECTED_KEYS);
  const nodes: PermissionNode[] = [];
  for (const m of MODULES as readonly ModuleDef[]) {
    const mKey = moduleAccessKey(m.key);
    nodes.push({ key: mKey, kind: "modulo", label: m.label, module: m.key, rule: m.rule, requires: { mode: "all", keys: [] }, protected: protectedSet.has(mKey), sensitive: false });
    for (const s of m.screens) {
      const sKey = `${s.key}.ver` as PermissionKey;
      const requires =
        s.moduleGate === "ativo"
          ? { mode: "all" as const, keys: [] }
          : s.modules
            ? { mode: "any" as const, keys: s.modules.map((x) => moduleAccessKey(x)) }
            : { mode: "all" as const, keys: [mKey] };
      nodes.push({ key: sKey, kind: "tela", label: s.label, module: s.module, screen: s.key as ScreenKey, rule: s.rule, requires, protected: protectedSet.has(sKey), sensitive: Boolean(s.sensitive) });
      for (const x of s.sections) {
        nodes.push({ key: x.key as PermissionKey, kind: "secao", label: x.label, module: s.module, screen: s.key as ScreenKey, rule: x.rule, requires: { mode: "all", keys: [sKey] }, protected: protectedSet.has(x.key), sensitive: false });
      }
      // Seções ordenadas do prefixo mais longo ao mais curto: a ação pertence à seção mais específica.
      const prefixes = [...s.sections].map((x) => ({ key: x.key, prefix: sectionPrefix(x) })).sort((a, b) => b.prefix.length - a.prefix.length);
      for (const a of s.actions) {
        const parent = prefixes.find((p) => a.key.startsWith(`${p.prefix}.`))?.key ?? sKey;
        nodes.push({ key: a.key as PermissionKey, kind: "acao", label: a.label, module: s.module, screen: s.key as ScreenKey, rule: a.rule, requires: { mode: "all", keys: [parent as PermissionKey] }, protected: protectedSet.has(a.key), sensitive: Boolean(a.sensitive) });
      }
    }
  }
  return nodes;
}

/** Todos os nós, em ordem de árvore (módulo, tela, seções, ações). */
export const PERMISSION_NODES: readonly PermissionNode[] = buildNodes();
export const NODE_BY_KEY: ReadonlyMap<string, PermissionNode> = new Map(PERMISSION_NODES.map((n) => [n.key, n]));
export const PERMISSION_KEYS: readonly PermissionKey[] = PERMISSION_NODES.map((n) => n.key);

export function isPermissionKey(key: string): key is PermissionKey {
  return NODE_BY_KEY.has(key);
}

export function isScreenKey(key: string): key is ScreenKey {
  return SCREEN_BY_KEY.has(key);
}

/** Chave de permissão de uma página: `<tela>.ver` para telas; a própria chave para seções com página. */
export function nodeViewKey(node: ScreenNodeKey): PermissionKey {
  return (isScreenKey(node) ? `${node}.ver` : node) as PermissionKey;
}
