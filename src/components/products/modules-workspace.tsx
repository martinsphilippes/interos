"use client";

/**
 * Aba Módulos da Gestão de Produtos: as unidades comerciais do catálogo do ERP agrupadas por módulo, com a situação
 * comercial, o preço vigente e o agendado. Clicar abre a ficha (ficha comercial, preços, catálogo, pacotes).
 */
import * as React from "react";
import { BadgeDollarSign, CircleAlert, FilePen, PackageCheck } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { EmptyState } from "@/components/ui/empty-state";
import { SearchInput } from "@/components/ui/search-input";
import { Select } from "@/components/ui/select";
import { StatCard } from "@/components/ui/stat-card";
import { normalizeSearch } from "@/domain/erp/catalog";
import { COMMERCIAL_STATUSES, COMMERCIAL_STATUS_LABELS, describePrice, versionAt, versionState, type CommercialModule } from "@/domain/products/commercial";
import type { ProductManagementView } from "@/server/products/queries";
import { formatCurrency, formatDateKey, formatNumber } from "@/lib/format";
import { cn } from "@/lib/utils";
import { CatalogSourceNotice } from "./catalog-source";
import { ModuleDrawer, type ModulePermissions } from "./module-drawer";
import { CommercialStatusBadge, NotSellableBadge } from "./shared";

type StatusFilter = "todos" | "sem_ficha" | "sem_preco" | (typeof COMMERCIAL_STATUSES)[number];

export function ModulesWorkspace({ view, permissions }: { view: ProductManagementView; permissions: ModulePermissions }) {
  const [query, setQuery] = React.useState("");
  const [status, setStatus] = React.useState<StatusFilter>("todos");
  const [open, setOpen] = React.useState<string | null>(null);
  const records = React.useMemo(() => new Map(view.records.map((r) => [r.code, r])), [view.records]);
  const priced = (r: CommercialModule | undefined) => Boolean(r && versionAt(r.prices, view.today));
  const q = normalizeSearch(query);

  const rows = view.units.filter((u) => {
    const r = records.get(u.code);
    if (q && !normalizeSearch(`${u.code} ${u.name} ${r?.name ?? ""} ${u.moduleName}`).includes(q)) return false;
    if (status === "todos") return true;
    if (status === "sem_ficha") return !r;
    if (status === "sem_preco") return r?.status === "a_venda" && !priced(r);
    return r?.status === status;
  });
  const byModule = new Map<string, typeof rows>();
  for (const u of rows) byModule.set(u.module, [...(byModule.get(u.module) ?? []), u]);

  const onSale = view.records.filter((r) => r.status === "a_venda").length;
  const withPrice = view.records.filter((r) => priced(r)).length;
  const missingPrice = view.records.filter((r) => r.status === "a_venda" && !priced(r)).length;
  const openUnit = open ? (view.units.find((u) => u.code === open) ?? null) : null;

  return (
    <div className="flex flex-col gap-4">
      <CatalogSourceNotice catalog={view.catalog} />
      <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
        <StatCard label="Unidades no catálogo" value={formatNumber(view.units.length)} icon={<PackageCheck />} tone="neutral" hint={`${formatNumber(view.catalog.sellable)} o ERP já vende`} compact />
        <StatCard label="À venda" value={formatNumber(onSale)} icon={<BadgeDollarSign />} tone="success" hint={`${formatNumber(view.records.length)} com ficha comercial`} compact />
        <StatCard label="Com preço vigente" value={formatNumber(withPrice)} icon={<FilePen />} tone="info" hint="hoje" compact />
        <StatCard label="À venda sem preço" value={formatNumber(missingPrice)} icon={<CircleAlert />} tone={missingPrice ? "warning" : "success"} hint="vendidos só em pacote ou a definir" compact />
      </div>
      {view.orphanCodes.length ? (
        <p className="rounded-md bg-warning-soft px-3 py-2 text-sm text-warning-fg">
          {view.orphanCodes.length === 1 ? "Uma ficha comercial tem código" : `${view.orphanCodes.length} fichas comerciais têm código`} fora do catálogo em uso: {view.orphanCodes.join(", ")}. Revise quando o catálogo do ERP for atualizado.
        </p>
      ) : null}
      <div className="flex flex-wrap items-center gap-3">
        <SearchInput value={query} onChange={setQuery} placeholder="Buscar por código ou nome" className="min-w-[240px] flex-1" />
        <Select
          aria-label="Situação comercial"
          value={status}
          onChange={(e) => setStatus(e.target.value as StatusFilter)}
          className="w-56"
          options={[
            { value: "todos", label: "Todas as situações" },
            { value: "sem_ficha", label: "Sem ficha comercial" },
            ...COMMERCIAL_STATUSES.map((s) => ({ value: s, label: COMMERCIAL_STATUS_LABELS[s] })),
            { value: "sem_preco", label: "À venda sem preço vigente" },
          ]}
        />
      </div>
      {rows.length === 0 ? (
        <EmptyState title="Nenhum módulo com esse filtro" description="Mude a busca ou a situação." size="sm" />
      ) : (
        <div className="flex flex-col gap-4">
          {view.erpModules
            .filter((m) => byModule.has(m.code))
            .map((m) => (
              <section key={m.code} aria-labelledby={`mod-${m.code}`} className="overflow-hidden rounded-lg border border-border">
                <h3 id={`mod-${m.code}`} className="bg-surface-muted px-3 py-2 text-sm font-semibold">
                  <span className="tabular-nums text-muted">{m.code}</span> {m.name}
                </h3>
                <ul className="divide-y divide-border">
                  {(byModule.get(m.code) ?? []).map((u) => {
                    const r = records.get(u.code);
                    const current = r ? versionAt(r.prices, view.today) : null;
                    const next = r?.prices.find((p) => versionState(p, view.today) === "agendada") ?? null;
                    return (
                      <li key={u.code}>
                        <button type="button" onClick={() => setOpen(u.code)} className={cn("flex w-full flex-wrap items-center gap-x-3 gap-y-1 px-3 py-2.5 text-left hover:bg-surface-hover focus-visible:bg-surface-hover focus-visible:outline-none")}>
                          <span className="w-12 shrink-0 tabular-nums text-sm text-muted">{u.code}</span>
                          <span className="min-w-[180px] flex-1 text-sm font-medium">
                            {r?.name ?? u.name}
                            {r && r.name !== u.name ? <span className="block text-xs font-normal text-muted">No ERP: {u.name}</span> : null}
                          </span>
                          <span className="flex flex-wrap items-center gap-1.5">
                            {!u.sellable ? <NotSellableBadge /> : null}
                            <CommercialStatusBadge status={r?.status ?? null} />
                          </span>
                          <span className="w-full text-sm tabular-nums sm:w-72 sm:text-right">
                            {current ? describePrice(current, formatCurrency) : <span className="text-muted">sem preço</span>}
                            {next ? (
                              <Badge variant="info" size="sm" className="ml-1.5">
                                novo em {formatDateKey(next.validFrom)}
                              </Badge>
                            ) : null}
                          </span>
                        </button>
                      </li>
                    );
                  })}
                </ul>
              </section>
            ))}
        </div>
      )}
      <ModuleDrawer code={open} unit={openUnit} record={open ? (records.get(open) ?? null) : null} units={view.units} packages={view.packages} today={view.today} permissions={permissions} onClose={() => setOpen(null)} />
    </div>
  );
}
