"use client";

import * as React from "react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { FilterX } from "lucide-react";
import { Button } from "@/components/ui/button";
import { SearchInput } from "@/components/ui/search-input";
import { Select } from "@/components/ui/select";
import { cn } from "@/lib/utils";

export interface FilterField {
  /** Nome do parâmetro na URL (em português, ex.: "status", "cliente"). */
  param: string;
  label: string;
  options: { value: string; label: string }[];
  /** Rótulo da opção vazia (ex.: "Todos os status"). */
  allLabel: string;
}

export interface FinanceFiltersProps {
  fields: FilterField[];
  /** Parâmetro de busca livre (omitido = sem campo de busca). */
  searchParam?: string;
  searchPlaceholder?: string;
  className?: string;
}

/**
 * Barra de filtros das telas do Financeiro. O estado vive na URL: cada mudança navega (replace) e o
 * servidor recalcula a lista, então links com filtros (drill-down dos cards) funcionam direto.
 */
export function FinanceFilters({ fields, searchParam, searchPlaceholder = "Buscar…", className }: FinanceFiltersProps) {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const [pending, startTransition] = React.useTransition();

  const apply = (patch: Record<string, string>) => {
    const next = new URLSearchParams(searchParams.toString());
    for (const [key, value] of Object.entries(patch)) {
      if (value) next.set(key, value);
      else next.delete(key);
    }
    const qs = next.toString();
    startTransition(() => router.replace(qs ? `${pathname}?${qs}` : pathname, { scroll: false }));
  };

  const active = fields.some((f) => searchParams.get(f.param)) || (searchParam ? Boolean(searchParams.get(searchParam)) : false);

  return (
    <div className={cn("flex flex-col gap-2 md:flex-row md:flex-wrap md:items-center", pending && "opacity-70", className)} aria-busy={pending || undefined}>
      {searchParam ? (
        <SearchInput
          value={searchParams.get(searchParam) ?? ""}
          onChange={(value) => apply({ [searchParam]: value })}
          debounceMs={350}
          placeholder={searchPlaceholder}
          className="md:max-w-[260px]"
          aria-label={searchPlaceholder}
        />
      ) : null}
      {fields.map((f) => (
        <Select
          key={f.param}
          aria-label={f.label}
          value={searchParams.get(f.param) ?? ""}
          onChange={(e) => apply({ [f.param]: e.target.value })}
          className="h-11 md:h-auto md:max-w-[220px] [&_select]:h-11 md:[&_select]:h-9"
        >
          <option value="">{f.allLabel}</option>
          {f.options.map((o) => (
            <option key={o.value} value={o.value}>
              {o.label}
            </option>
          ))}
        </Select>
      ))}
      {active ? (
        <Button variant="ghost" size="sm" className="h-11 md:h-8" onClick={() => apply(Object.fromEntries([...fields.map((f) => [f.param, ""]), ...(searchParam ? [[searchParam, ""]] : [])]))}>
          <FilterX /> Limpar filtros
        </Button>
      ) : null}
    </div>
  );
}
