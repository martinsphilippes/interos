"use client";

import * as React from "react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { ChevronDown, Network } from "lucide-react";

export interface ScopeSelectProps {
  value: string;
  options: { value: string; label: string }[];
}

/** Seletor de escopo do dashboard (admin/diretoria): empresa ou um departamento, via ?departamento=. */
export function ScopeSelect({ value, options }: ScopeSelectProps) {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const [pending, startTransition] = React.useTransition();

  const onChange = (next: string) => {
    const params = new URLSearchParams(searchParams.toString());
    if (next === "empresa") params.delete("departamento");
    else params.set("departamento", next);
    params.delete("foco");
    const query = params.toString();
    startTransition(() => router.push(query ? `${pathname}?${query}` : pathname));
  };

  return (
    <label className="relative inline-flex min-w-[200px] items-center">
      <span className="sr-only">Escopo</span>
      <Network className="pointer-events-none absolute left-3 size-4 text-muted" aria-hidden />
      <select
        value={value}
        onChange={(e) => onChange(e.target.value)}
        aria-busy={pending || undefined}
        className="h-11 w-full appearance-none rounded-lg border border-border bg-surface pl-9 pr-8 text-sm text-foreground shadow-xs transition-colors hover:border-border-strong focus:border-brand focus:outline-none focus:ring-2 focus:ring-brand/25 md:h-9"
      >
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
