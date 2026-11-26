"use client";

/** Peças comuns das abas da Gestão de Produtos: selos de situação, números e o seletor de módulos do ERP. */
import * as React from "react";
import { Badge } from "@/components/ui/badge";
import { Checkbox } from "@/components/ui/checkbox";
import { SearchInput } from "@/components/ui/search-input";
import { normalizeSearch } from "@/domain/erp/catalog";
import {
  COMMERCIAL_STATUS_LABELS,
  PACKAGE_STATUS_LABELS,
  VERSION_STATE_LABELS,
  type CommercialStatus,
  type PackageStatus,
  type VersionState,
} from "@/domain/products/commercial";
import type { CatalogUnitView } from "@/server/products/queries";
import { cn } from "@/lib/utils";

const COMMERCIAL_VARIANT: Record<CommercialStatus, "success" | "muted" | "info" | "danger"> = {
  a_venda: "success",
  rascunho: "muted",
  sob_consulta: "info",
  descontinuado: "danger",
};

export function CommercialStatusBadge({ status }: { status: CommercialStatus | null }) {
  if (!status) return <Badge variant="outline">Sem ficha</Badge>;
  return <Badge variant={COMMERCIAL_VARIANT[status]}>{COMMERCIAL_STATUS_LABELS[status]}</Badge>;
}

export function PackageStatusBadge({ status }: { status: PackageStatus }) {
  return <Badge variant={status === "a_venda" ? "success" : status === "rascunho" ? "muted" : "danger"}>{PACKAGE_STATUS_LABELS[status]}</Badge>;
}

export function VersionStateBadge({ state }: { state: VersionState }) {
  const variant = state === "vigente" ? "success" : state === "agendada" ? "info" : state === "cancelada" ? "danger" : "muted";
  return (
    <Badge variant={variant} size="sm">
      {VERSION_STATE_LABELS[state]}
    </Badge>
  );
}

export function NotSellableBadge() {
  return (
    <Badge variant="warning" size="sm" title="O ERP ainda não vende esta unidade (integração externa pendente, em desenvolvimento ou planejada).">
      Não homologado
    </Badge>
  );
}

/** Número de um campo de valor (vazio = 0; inválido = null). */
export function toNumber(value: string): number | null {
  const v = value.trim();
  if (!v) return 0;
  const n = Number(v.replace(",", "."));
  return Number.isFinite(n) ? n : null;
}

export function numberToInput(value: number | null | undefined): string {
  return value === null || value === undefined ? "" : String(value);
}

/**
 * Seletor das unidades comerciais do catálogo, agrupadas por módulo do ERP, com busca. Unidades que o ERP ainda não
 * vende aparecem marcadas (podem entrar num pacote em definição, com aviso).
 */
export function UnitPicker({
  units,
  erpModules,
  selected,
  onChange,
  disabled,
  idPrefix,
}: {
  units: readonly CatalogUnitView[];
  erpModules: readonly { code: string; name: string }[];
  selected: ReadonlySet<string>;
  onChange: (next: Set<string>) => void;
  disabled?: boolean;
  idPrefix: string;
}) {
  const [query, setQuery] = React.useState("");
  const [onlySelected, setOnlySelected] = React.useState(false);
  const q = normalizeSearch(query);
  const visible = units.filter((u) => (!onlySelected || selected.has(u.code)) && (!q || normalizeSearch(`${u.code} ${u.name} ${u.moduleName}`).includes(q)));
  const byModule = new Map<string, CatalogUnitView[]>();
  for (const u of visible) byModule.set(u.module, [...(byModule.get(u.module) ?? []), u]);
  const toggle = (code: string, on: boolean) => {
    const next = new Set(selected);
    if (on) next.add(code);
    else next.delete(code);
    onChange(next);
  };

  return (
    <div className="flex flex-col gap-2">
      <div className="flex flex-wrap items-center gap-3">
        <SearchInput value={query} onChange={setQuery} placeholder="Buscar módulo por nome ou código" className="min-w-[220px] flex-1" size="sm" />
        <Checkbox id={`${idPrefix}-only`} checked={onlySelected} onCheckedChange={(v) => setOnlySelected(v === true)} label={`Só os escolhidos (${selected.size})`} />
      </div>
      <div className="max-h-[360px] overflow-y-auto rounded-lg border border-border">
        {byModule.size === 0 ? <p className="p-4 text-sm text-muted">Nenhum módulo encontrado.</p> : null}
        {erpModules
          .filter((m) => byModule.has(m.code))
          .map((m) => (
            <fieldset key={m.code} className="border-b border-border last:border-b-0">
              <legend className="sr-only">{`${m.code} ${m.name}`}</legend>
              <p className="sticky top-0 z-[1] bg-surface-muted px-3 py-1.5 text-xs font-medium text-muted">
                {m.code} · {m.name}
              </p>
              <ul>
                {(byModule.get(m.code) ?? []).map((u) => (
                  <li key={u.code} className={cn("flex items-center gap-2 px-3 py-1.5", selected.has(u.code) && "bg-brand-soft/40")}>
                    <Checkbox id={`${idPrefix}-${u.code.replace(/\./g, "-")}`} checked={selected.has(u.code)} onCheckedChange={(v) => toggle(u.code, v === true)} disabled={disabled} label={<span className="text-sm"><span className="tabular-nums text-muted">{u.code}</span> {u.name}</span>} />
                    {!u.sellable ? <NotSellableBadge /> : null}
                  </li>
                ))}
              </ul>
            </fieldset>
          ))}
      </div>
    </div>
  );
}
