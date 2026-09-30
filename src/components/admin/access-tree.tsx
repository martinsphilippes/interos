"use client";

import * as React from "react";
import { AlertTriangle, ChevronDown, ChevronRight, ChevronsDownUp, ChevronsUpDown, Lock, PowerOff } from "lucide-react";
import type { PermissionOrigin, ScopeKind } from "@/domain/permissions";
import type { AccessScreenScope, AccessTreeNode, DefaultValue } from "@/server/auth/access-admin";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { SearchInput } from "@/components/ui/search-input";
import { SegmentedControl } from "@/components/ui/segmented-control";
import { Select } from "@/components/ui/select";
import { Tooltip } from "@/components/ui/tooltip";
import { cn } from "@/lib/utils";
import { normalizeText } from "./admin-model";
import { KIND_TEXT, ORIGIN_TEXT, SCOPE_TEXT, treeIndex } from "./access-model";

type TriState = "padrao" | "permitir" | "negar";

export interface AccessEffectiveData {
  values: Record<string, boolean>;
  origins: Record<string, PermissionOrigin>;
  scopes: Record<string, ScopeKind>;
}

export interface AccessTreeProps {
  tree: AccessTreeNode[];
  scopes: AccessScreenScope[];
  /** Módulos desativados na empresa (aviso em cada nó do módulo). */
  inactiveModules: string[];
  /** "edit": seletor Padrão/Permitir/Negar + escopo; "effective": somente leitura com a origem de cada decisão. */
  mode: "edit" | "effective";
  /** Nome do nível mais geral ("Padrão" no perfil; "Padrão do perfil" nas exceções). */
  baseLabel?: string;
  /** Valor do nível mais geral por chave (s = permitido, n = negado, d = depende do departamento). */
  baseline?: Record<string, DefaultValue>;
  baselineScopes?: Record<string, ScopeKind | null>;
  /** Mostrar o texto da regra padrão do catálogo em cada nó. */
  showRuleText?: boolean;
  grants?: Record<string, boolean>;
  scopeValues?: Record<string, ScopeKind>;
  onGrantChange?: (key: string, value: boolean | undefined) => void;
  onScopeChange?: (screen: string, value: ScopeKind | undefined) => void;
  readOnly?: boolean;
  /** Chaves em que "Negar" não é aceito (protegidas; o servidor também recusa). */
  denyLocked?: string[];
  effective?: AccessEffectiveData;
  /** Prefixo dos ids (várias árvores na mesma página). */
  idPrefix: string;
}

function baselineWord(value: DefaultValue | undefined): string {
  return value === "s" ? "permitido" : value === "n" ? "negado" : value === "d" ? "depende do departamento" : "—";
}

/**
 * Árvore Módulo › Tela › Seção › Ação com rótulos de negócio, busca por texto, expandir/recolher, seletor tri-estado
 * por nó e escopo de dados por tela. A chave técnica só aparece em tooltip. O cliente só exibe e edita o rascunho:
 * a decisão e as regras de segurança ficam no servidor (actions + invariantes).
 */
export function AccessTree(props: AccessTreeProps) {
  const { tree, scopes, inactiveModules, mode, grants = {}, scopeValues = {}, baseline = {}, baselineScopes = {} } = props;
  const index = React.useMemo(() => treeIndex(tree), [tree]);
  const scopeByView = React.useMemo(() => new Map(scopes.map((s) => [s.viewKey, s])), [scopes]);
  const [expanded, setExpanded] = React.useState<Set<string>>(() => new Set());
  const [query, setQuery] = React.useState("");
  const [onlyAdjusted, setOnlyAdjusted] = React.useState(false);
  const inactive = React.useMemo(() => new Set(inactiveModules), [inactiveModules]);

  const term = normalizeText(query);
  const filtering = Boolean(term) || onlyAdjusted;
  const visible = React.useMemo(() => {
    if (!filtering) return null;
    const set = new Set<string>();
    for (const n of tree) {
      const textHit = !term || normalizeText(`${n.label} ${n.ruleText} ${n.key}`).includes(term);
      const adjusted = Object.hasOwn(grants, n.key) || (n.kind === "tela" && Object.hasOwn(scopeValues, n.key.replace(/\.ver$/, "")));
      if (textHit && (!onlyAdjusted || adjusted)) {
        set.add(n.key);
        for (const a of index.ancestors(n.key)) set.add(a);
      }
    }
    return set;
  }, [filtering, term, onlyAdjusted, tree, grants, scopeValues, index]);

  const rows = tree.filter((n) => {
    if (visible) return visible.has(n.key);
    return index.ancestors(n.key).every((a) => expanded.has(a));
  });

  const toggle = (key: string) =>
    setExpanded((prev) => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
  const expandAll = () => setExpanded(new Set(tree.filter((n) => (index.children.get(n.key)?.length ?? 0) > 0).map((n) => n.key)));
  const collapseAll = () => setExpanded(new Set());

  /** Valor decidido (aproximação do rascunho): exceção/ajuste ?? nível mais geral. */
  const decided = (key: string): boolean | undefined => {
    if (Object.hasOwn(grants, key)) return grants[key];
    const b = baseline[key];
    return b === "s" ? true : b === "n" ? false : undefined;
  };

  return (
    <div className="flex min-w-0 flex-col gap-2">
      <div className="flex flex-col gap-2 sm:flex-row sm:items-center">
        <SearchInput value={query} onChange={setQuery} debounceMs={150} placeholder="Buscar tela, seção ou ação…" aria-label="Buscar na árvore de acessos" className="sm:max-w-xs" size="sm" onKeyDown={(e) => e.key === "Enter" && e.preventDefault()} />
        <div className="flex flex-wrap items-center gap-1">
          <Button type="button" variant="ghost" size="sm" onClick={expandAll} disabled={filtering}>
            <ChevronsUpDown /> Expandir tudo
          </Button>
          <Button type="button" variant="ghost" size="sm" onClick={collapseAll} disabled={filtering}>
            <ChevronsDownUp /> Recolher
          </Button>
          {mode === "edit" ? (
            <Button type="button" variant={onlyAdjusted ? "secondary" : "ghost"} size="sm" onClick={() => setOnlyAdjusted((v) => !v)} aria-pressed={onlyAdjusted}>
              Só ajustados
            </Button>
          ) : null}
        </div>
      </div>

      {rows.length === 0 ? (
        <p className="rounded-md border border-dashed border-border px-3 py-6 text-center text-sm text-muted">{onlyAdjusted && !term ? "Nenhum ajuste: tudo segue o padrão." : "Nada encontrado com essa busca."}</p>
      ) : (
        <ul className="flex min-w-0 flex-col divide-y divide-border rounded-lg border border-border" role="tree" aria-label="Acessos por módulo, tela, seção e ação">
          {rows.map((n) => {
            const kids = index.children.get(n.key)?.length ?? 0;
            const open = visible ? true : expanded.has(n.key);
            const ancestorDenied = index.ancestors(n.key).some((a) => Object.hasOwn(grants, a) && grants[a] === false);
            const ancestorBlocked = index.ancestors(n.key).some((a) => decided(a) === false);
            return (
              <AccessRow
                key={n.key}
                node={n}
                props={props}
                hasChildren={kids > 0}
                open={open}
                onToggle={() => toggle(n.key)}
                descendants={index.descendants.get(n.key) ?? 0}
                moduleInactive={inactive.has(n.module)}
                ancestorDenied={ancestorDenied}
                ancestorBlocked={ancestorBlocked}
                scope={n.kind === "tela" ? scopeByView.get(n.key) : undefined}
                baselineScope={n.kind === "tela" ? (baselineScopes[n.key.replace(/\.ver$/, "")] ?? null) : null}
              />
            );
          })}
        </ul>
      )}
    </div>
  );
}

interface AccessRowProps {
  node: AccessTreeNode;
  props: AccessTreeProps;
  hasChildren: boolean;
  open: boolean;
  onToggle: () => void;
  descendants: number;
  moduleInactive: boolean;
  ancestorDenied: boolean;
  ancestorBlocked: boolean;
  scope?: AccessScreenScope;
  baselineScope: ScopeKind | null;
}

function AccessRow({ node, props, hasChildren, open, onToggle, descendants, moduleInactive, ancestorDenied, ancestorBlocked, scope, baselineScope }: AccessRowProps) {
  const { mode, grants = {}, scopeValues = {}, baseline = {}, baseLabel = "Padrão", readOnly, onGrantChange, onScopeChange, denyLocked = [], effective, showRuleText, idPrefix } = props;
  const own = Object.hasOwn(grants, node.key) ? grants[node.key] : undefined;
  const state: TriState = own === true ? "permitir" : own === false ? "negar" : "padrao";
  const screenKey = node.key.replace(/\.ver$/, "");
  const ownScope = scope && Object.hasOwn(scopeValues, screenKey) ? scopeValues[screenKey] : undefined;
  const adjusted = own !== undefined || ownScope !== undefined;
  const indent = Math.min(node.depth, 3);
  const denyDisabled = denyLocked.includes(node.key);

  const setState = (next: TriState) => onGrantChange?.(node.key, next === "padrao" ? undefined : next === "permitir");

  return (
    <li role="treeitem" aria-selected={false} aria-expanded={hasChildren ? open : undefined} aria-level={node.depth + 1} className={cn("min-w-0 px-3 py-2.5", node.kind === "modulo" && "bg-surface-muted/60", ancestorDenied && "opacity-60")}>
      <div className="flex min-w-0 flex-col gap-2 md:flex-row md:items-start md:justify-between" style={{ paddingLeft: `${indent * 14}px` }}>
        <div className="flex min-w-0 flex-1 items-start gap-1.5">
          {hasChildren ? (
            <button type="button" onClick={onToggle} className="mt-0.5 inline-flex size-6 shrink-0 items-center justify-center rounded-sm text-muted hover:bg-surface-hover hover:text-foreground" aria-label={open ? `Recolher ${node.label}` : `Expandir ${node.label}`}>
              {open ? <ChevronDown className="size-4" /> : <ChevronRight className="size-4" />}
            </button>
          ) : (
            <span className="size-6 shrink-0" aria-hidden />
          )}
          <div className="min-w-0 flex-1">
            <div className="flex min-w-0 flex-wrap items-center gap-1.5">
              <Tooltip content={<span className="font-mono">{node.key}</span>}>
                <span className={cn("min-w-0 break-words text-sm", node.kind === "modulo" ? "font-semibold" : node.kind === "tela" ? "font-medium" : "")} tabIndex={0}>
                  {node.label}
                </span>
              </Tooltip>
              <span className="text-[11px] uppercase tracking-wide text-muted-light">{KIND_TEXT[node.kind]}</span>
              {adjusted && mode === "edit" ? (
                <Badge variant="brand" size="sm">
                  Ajustado
                </Badge>
              ) : null}
              {node.protected ? (
                <Badge variant="outline" size="sm">
                  <Lock /> Protegido
                </Badge>
              ) : null}
              {node.sensitive ? (
                <Badge variant="warning" size="sm">
                  Sensível
                </Badge>
              ) : null}
              {moduleInactive && node.kind === "modulo" ? (
                <Badge variant="danger" size="sm">
                  <PowerOff /> Desativado na empresa
                </Badge>
              ) : null}
            </div>
            {mode === "edit" ? (
              <p className="mt-0.5 text-xs text-muted">
                {baseLabel}: {baselineWord(baseline[node.key])}
                {showRuleText ? <span className="text-muted-light"> · {node.ruleText}</span> : null}
              </p>
            ) : effective ? (
              <p className="mt-0.5 text-xs text-muted">
                {effective.values[node.key] ? "Pode" : "Não pode"} · origem: {ORIGIN_TEXT[effective.origins[node.key] ?? "padrao"]}
                {scope && effective.values[node.key] && effective.scopes[screenKey] ? <span> · dados: {SCOPE_TEXT[effective.scopes[screenKey]]}</span> : null}
              </p>
            ) : null}
            {node.note ? <p className="mt-0.5 text-xs text-muted-light">{node.note}</p> : null}
            {mode === "edit" && own === false && descendants > 0 ? (
              <p className="mt-1 flex items-start gap-1 text-xs text-warning-fg">
                <AlertTriangle className="mt-px size-3.5 shrink-0" /> Negar aqui esconde também {descendants} item(ns) abaixo.
              </p>
            ) : null}
            {mode === "edit" && own === true && ancestorBlocked ? (
              <p className="mt-1 flex items-start gap-1 text-xs text-warning-fg">
                <AlertTriangle className="mt-px size-3.5 shrink-0" /> O nível acima está negado: sem liberá-lo, a pessoa continua sem este acesso.
              </p>
            ) : null}
          </div>
        </div>

        {mode === "edit" ? (
          <div className="flex min-w-0 flex-col gap-1.5 pl-7 md:items-end md:pl-0">
            <SegmentedControl<TriState>
              size="sm"
              aria-label={`Acesso: ${node.label}`}
              value={state}
              onChange={(v) => !readOnly && setState(v)}
              options={[
                { value: "padrao", label: baseLabel, disabled: readOnly },
                { value: "permitir", label: "Permitir", disabled: readOnly },
                { value: "negar", label: "Negar", disabled: readOnly || denyDisabled },
              ]}
              className="max-w-full flex-wrap"
            />
            {scope ? (
              <ScopeSelect id={`${idPrefix}-scope-${screenKey}`} scope={scope} value={ownScope} baseLabel={baseLabel} baseline={baselineScope} disabled={readOnly} onChange={(v) => onScopeChange?.(screenKey, v)} />
            ) : null}
          </div>
        ) : effective ? (
          <div className="flex shrink-0 items-center gap-1.5 pl-7 md:pl-0">
            <Badge variant={effective.values[node.key] ? "success" : "muted"} size="sm">
              {effective.values[node.key] ? "Permitido" : "Negado"}
            </Badge>
          </div>
        ) : null}
      </div>
    </li>
  );
}

function ScopeSelect({ id, scope, value, baseLabel, baseline, disabled, onChange }: { id: string; scope: AccessScreenScope; value: ScopeKind | undefined; baseLabel: string; baseline: ScopeKind | null; disabled?: boolean; onChange: (v: ScopeKind | undefined) => void }) {
  const current = value ?? baseline ?? undefined;
  const description = scope.options.find((o) => o.value === current)?.description;
  return (
    <div className="flex w-full min-w-0 flex-col gap-0.5 md:w-64">
      <label htmlFor={id} className="text-[11px] font-medium text-muted">
        Dados que a pessoa vê nesta tela
      </label>
      <Select id={id} size="sm" value={value ?? ""} disabled={disabled} onChange={(e) => onChange(e.target.value ? (e.target.value as ScopeKind) : undefined)}>
        <option value="">
          {baseLabel} ({baseline ? SCOPE_TEXT[baseline] : "varia por departamento"})
        </option>
        {scope.options.map((o) => (
          <option key={o.value} value={o.value}>
            {o.label}
          </option>
        ))}
      </Select>
      {description ? <p className="text-[11px] leading-snug text-muted-light">{description}</p> : null}
    </div>
  );
}
