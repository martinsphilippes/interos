"use client";

import * as React from "react";
import { usePathname, useRouter } from "next/navigation";
import { Filter, RotateCcw } from "lucide-react";
import type { FilterKey, ReportFilters } from "@/server/reports/definitions";
import { Button } from "@/components/ui/button";
import { DateInput } from "@/components/ui/date-input";
import { FormField } from "@/components/ui/form-field";
import { Select } from "@/components/ui/select";

type Option = { value: string; label: string };

export interface ReportFiltersFormProps {
  reportKey: string;
  filters: FilterKey[];
  /** Filtros efetivos (já com os padrões de período aplicados pelo servidor). */
  values: ReportFilters;
  options: { users: Option[]; clients: Option[]; products: Option[]; departments: Option[]; status: Option[] };
  /** Filtros travados pelo perfil do usuário (não editáveis). */
  locked: (keyof ReportFilters)[];
}

/** Filtros do relatório: atualizam a URL (?tipo=&de=&ate=&...) e a prévia é recalculada no servidor. */
export function ReportFiltersForm({ reportKey, filters, values, options, locked }: ReportFiltersFormProps) {
  const router = useRouter();
  const pathname = usePathname();
  const [pending, startTransition] = React.useTransition();
  const [state, setState] = React.useState<ReportFilters>(values);
  const monthly = filters.includes("periodo_mes");
  const daily = filters.includes("periodo_data");

  const set = (key: keyof ReportFilters) => (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement>) => setState((s) => ({ ...s, [key]: e.target.value || undefined }));

  const apply = (next: ReportFilters) => {
    const params = new URLSearchParams({ tipo: reportKey });
    for (const [k, v] of Object.entries(next)) if (v) params.set(k, v);
    startTransition(() => router.push(`${pathname}?${params.toString()}`));
  };

  const select = (key: keyof ReportFilters, label: string, opts: Option[], placeholder: string) => (
    <FormField label={label} htmlFor={`f-${key}`}>
      <Select id={`f-${key}`} value={state[key] ?? ""} onChange={set(key)} disabled={locked.includes(key)} className="[&_select]:h-11 md:[&_select]:h-9">
        <option value="">{placeholder}</option>
        {opts.map((o) => (
          <option key={o.value} value={o.value}>
            {o.label}
          </option>
        ))}
      </Select>
    </FormField>
  );

  return (
    <form
      className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4"
      onSubmit={(e) => {
        e.preventDefault();
        apply(state);
      }}
    >
      {monthly ? (
        <>
          <FormField label="De (competência)" htmlFor="f-de">
            <input id="f-de" type="month" value={state.de?.slice(0, 7) ?? ""} onChange={set("de")} className="h-11 w-full rounded-lg border border-border bg-surface px-3 text-sm shadow-xs focus:border-brand focus:outline-none focus:ring-2 focus:ring-brand/25 md:h-9" />
          </FormField>
          <FormField label="Até (competência)" htmlFor="f-ate">
            <input id="f-ate" type="month" value={state.ate?.slice(0, 7) ?? ""} onChange={set("ate")} className="h-11 w-full rounded-lg border border-border bg-surface px-3 text-sm shadow-xs focus:border-brand focus:outline-none focus:ring-2 focus:ring-brand/25 md:h-9" />
          </FormField>
        </>
      ) : null}
      {daily ? (
        <>
          <FormField label="De" htmlFor="f-de">
            <DateInput id="f-de" value={state.de ?? ""} onChange={set("de")} className="h-11 md:h-9" />
          </FormField>
          <FormField label="Até" htmlFor="f-ate">
            <DateInput id="f-ate" value={state.ate ?? ""} onChange={set("ate")} className="h-11 md:h-9" />
          </FormField>
        </>
      ) : null}
      {filters.includes("departamento") ? select("departamento", "Departamento", options.departments, "Todos os departamentos") : null}
      {filters.includes("colaborador") ? select("colaborador", "Colaborador", options.users, "Todos os colaboradores") : null}
      {filters.includes("cliente") ? select("cliente", "Cliente", options.clients, "Todos os clientes") : null}
      {filters.includes("produto") ? select("produto", "Produto", options.products, "Todos os produtos") : null}
      {filters.includes("status") ? select("status", "Status", options.status, "Todos") : null}
      <div className="flex items-end gap-2 sm:col-span-2 lg:col-span-4">
        <Button type="submit" loading={pending} className="h-11 md:h-9">
          <Filter /> Aplicar filtros
        </Button>
        <Button
          type="button"
          variant="ghost"
          className="h-11 md:h-9"
          disabled={pending}
          onClick={() => {
            const reset = Object.fromEntries(locked.map((k) => [k, values[k]])) as ReportFilters;
            setState(reset);
            apply(reset);
          }}
        >
          <RotateCcw /> Limpar
        </Button>
      </div>
    </form>
  );
}
