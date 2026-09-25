"use client";

import * as React from "react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { ArrowDownAZ, ArrowUpZA, SlidersHorizontal, X } from "lucide-react";
import { CLIENT_STATUS, CLIENT_STATUS_LABELS, HEALTH_LEVELS, JOURNEY_STAGES } from "@/domain/constants";
import type { ClientFacets, ClientListFilters } from "@/server/clients/queries";
import { segmentLabel } from "@/server/clients/schemas";
import { SearchInput } from "@/components/ui/search-input";
import { Select } from "@/components/ui/select";
import { Button } from "@/components/ui/button";
import { Spinner } from "@/components/ui/spinner";
import { cn } from "@/lib/utils";
import { HEALTH_LABELS, JOURNEY_STAGE_LABELS } from "./client-badges";

export interface ClientsFiltersProps {
  filters: ClientListFilters;
  facets: ClientFacets;
  total: number;
  className?: string;
}

const SORT_OPTIONS = [
  { value: "nome", label: "Nome" },
  { value: "mrr", label: "MRR" },
  { value: "interacao", label: "Última interação" },
  { value: "saude", label: "Saúde" },
];

/** Filtros da lista de clientes. Todo estado vive na URL (?q=, ?status=, ?etapa=…), então é compartilhável. */
export function ClientsFilters({ filters, facets, total, className }: ClientsFiltersProps) {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const [pending, startTransition] = React.useTransition();
  const [showAll, setShowAll] = React.useState(Boolean(filters.stage || filters.ownerSalesId || filters.ownerCsId || filters.segment || filters.city));

  const setParams = (patch: Record<string, string | undefined>) => {
    const params = new URLSearchParams(searchParams.toString());
    for (const [key, value] of Object.entries(patch)) {
      if (value) params.set(key, value);
      else params.delete(key);
    }
    const query = params.toString();
    startTransition(() => {
      router.replace(query ? `${pathname}?${query}` : pathname, { scroll: false });
    });
  };

  const activeCount = [filters.q, filters.status?.length, filters.stage, filters.ownerSalesId, filters.ownerCsId, filters.health, filters.segment, filters.city].filter(Boolean).length;
  const sort = filters.sort ?? "nome";
  const defaultDir = sort === "nome" ? "asc" : sort === "saude" ? "asc" : "desc";
  const dir = filters.dir ?? defaultDir;

  return (
    <div className={cn("flex flex-col gap-3", className)}>
      <div className="flex flex-col gap-2 md:flex-row md:items-center">
        <SearchInput
          value={filters.q ?? ""}
          onChange={(value) => setParams({ q: value || undefined })}
          debounceMs={350}
          placeholder="Buscar por nome, CNPJ, cidade ou contato…"
          className="md:max-w-md"
          aria-label="Buscar clientes"
        />
        <div className="flex flex-wrap items-center gap-2">
          <Select
            size="sm"
            aria-label="Status"
            value={filters.status?.length === 1 ? filters.status[0] : filters.status?.length ? filters.status.join(",") : ""}
            onChange={(e) => setParams({ status: e.target.value || undefined })}
            className="w-auto min-w-[150px]"
          >
            <option value="">Todos os status</option>
            {CLIENT_STATUS.map((s) => (
              <option key={s} value={s}>
                {CLIENT_STATUS_LABELS[s]}
              </option>
            ))}
            <option value="prospect,lead">Prospects e leads</option>
          </Select>
          <Select size="sm" aria-label="Saúde" value={filters.health ?? ""} onChange={(e) => setParams({ saude: e.target.value || undefined })} className="w-auto min-w-[130px]">
            <option value="">Toda saúde</option>
            {HEALTH_LEVELS.map((h) => (
              <option key={h} value={h}>
                {HEALTH_LABELS[h]}
              </option>
            ))}
          </Select>
          <Select size="sm" aria-label="Ordenar por" value={sort} onChange={(e) => setParams({ ordenar: e.target.value === "nome" ? undefined : e.target.value, dir: undefined })} className="w-auto min-w-[150px]">
            {SORT_OPTIONS.map((o) => (
              <option key={o.value} value={o.value}>
                Ordenar: {o.label}
              </option>
            ))}
          </Select>
          <Button
            variant="outline"
            size="icon"
            className="size-8"
            aria-label={dir === "asc" ? "Ordem crescente (clique para decrescente)" : "Ordem decrescente (clique para crescente)"}
            title={dir === "asc" ? "Crescente" : "Decrescente"}
            onClick={() => setParams({ dir: dir === "asc" ? "desc" : "asc" })}
          >
            {dir === "asc" ? <ArrowDownAZ /> : <ArrowUpZA />}
          </Button>
          <Button variant={showAll ? "secondary" : "outline"} size="sm" onClick={() => setShowAll((v) => !v)} aria-expanded={showAll}>
            <SlidersHorizontal /> Mais filtros
          </Button>
        </div>
      </div>

      {showAll ? (
        <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-5">
          <Select size="sm" aria-label="Etapa da jornada" value={filters.stage ?? ""} onChange={(e) => setParams({ etapa: e.target.value || undefined })}>
            <option value="">Todas as etapas</option>
            {JOURNEY_STAGES.map((s) => (
              <option key={s} value={s}>
                {JOURNEY_STAGE_LABELS[s]}
              </option>
            ))}
          </Select>
          <Select size="sm" aria-label="Responsável comercial" value={filters.ownerSalesId ?? ""} onChange={(e) => setParams({ vendedor: e.target.value || undefined })}>
            <option value="">Todo comercial</option>
            {facets.sellers.map((u) => (
              <option key={u.id} value={u.id}>
                {u.name}
              </option>
            ))}
          </Select>
          <Select size="sm" aria-label="Responsável de CS" value={filters.ownerCsId ?? ""} onChange={(e) => setParams({ cs: e.target.value || undefined })}>
            <option value="">Todo CS</option>
            {facets.csOwners.map((u) => (
              <option key={u.id} value={u.id}>
                {u.name}
              </option>
            ))}
          </Select>
          <Select size="sm" aria-label="Segmento" value={filters.segment ?? ""} onChange={(e) => setParams({ segmento: e.target.value || undefined })}>
            <option value="">Todos os segmentos</option>
            {facets.segments.map((s) => (
              <option key={s} value={s}>
                {segmentLabel(s)}
              </option>
            ))}
          </Select>
          <Select size="sm" aria-label="Cidade" value={filters.city ?? ""} onChange={(e) => setParams({ cidade: e.target.value || undefined })}>
            <option value="">Todas as cidades</option>
            {facets.cities.map((c) => (
              <option key={c} value={c}>
                {c}
              </option>
            ))}
          </Select>
        </div>
      ) : null}

      <div className="flex items-center gap-3 text-xs text-muted">
        <span className="tabular-nums" aria-live="polite">
          {pending ? <Spinner size="sm" label="Atualizando…" /> : `${total} cliente${total === 1 ? "" : "s"}${activeCount > 0 ? " encontrados" : ""}`}
        </span>
        {activeCount > 0 ? (
          <Button variant="link" size="sm" className="h-auto text-xs" onClick={() => startTransition(() => router.replace(pathname, { scroll: false }))}>
            <X /> Limpar filtros ({activeCount})
          </Button>
        ) : null}
      </div>
    </div>
  );
}
