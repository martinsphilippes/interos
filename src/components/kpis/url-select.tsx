"use client";

import * as React from "react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { ChevronDown } from "lucide-react";
import { cn } from "@/lib/utils";

export interface UrlSelectProps {
  /** Parâmetro da URL controlado pelo seletor (ex.: "departamento"). */
  param: string;
  value: string;
  options: { value: string; label: string }[];
  /** Rótulo acessível. */
  label: string;
  /** Opção "todos" (valor vazio remove o parâmetro). */
  allLabel?: string;
  /** Valor que também remove o parâmetro (ex.: "empresa" no seletor de escopo). */
  resetValue?: string;
  /** Parâmetros removidos ao trocar (ex.: "foco", "lista"). */
  clear?: string[];
  icon?: React.ReactNode;
  disabled?: boolean;
  className?: string;
}

/**
 * Seletor que grava a escolha na URL (preservando os demais parâmetros): filtros de departamento, responsável,
 * cliente, prioridade e tipo nas telas de gestão. Genérico (candidato ao kit de UI).
 */
export function UrlSelect({ param, value, options, label, allLabel, resetValue, clear = [], icon, disabled, className }: UrlSelectProps) {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const [pending, startTransition] = React.useTransition();

  const onChange = (next: string) => {
    const params = new URLSearchParams(searchParams.toString());
    if (!next || next === resetValue) params.delete(param);
    else params.set(param, next);
    for (const c of clear) params.delete(c);
    const query = params.toString();
    startTransition(() => router.push(query ? `${pathname}?${query}` : pathname));
  };

  return (
    <label className={cn("relative inline-flex w-full min-w-0 items-center sm:min-w-[170px]", className)}>
      <span className="sr-only">{label}</span>
      {icon ? <span className="pointer-events-none absolute left-3 text-muted [&_svg]:size-4">{icon}</span> : null}
      <select
        value={value}
        onChange={(e) => onChange(e.target.value)}
        disabled={disabled}
        aria-busy={pending || undefined}
        className={cn(
          "h-11 w-full appearance-none rounded-lg border border-border-strong bg-surface-muted pr-8 text-sm text-foreground transition-colors hover:border-muted-light/60 focus:border-brand focus:outline-none focus:ring-2 focus:ring-brand/25 disabled:cursor-not-allowed disabled:opacity-70 md:h-9",
          icon ? "pl-9" : "pl-3",
        )}
      >
        {allLabel !== undefined ? <option value="">{allLabel}</option> : null}
        {options.map((o) => (
          <option key={o.value} value={o.value}>
            {o.label}
          </option>
        ))}
      </select>
      <ChevronDown className="pointer-events-none absolute right-2.5 size-4 text-muted" aria-hidden />
    </label>
  );
}
