"use client";

import * as React from "react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { CalendarRange, ChevronDown } from "lucide-react";
import { cn } from "@/lib/utils";

export interface PeriodOption {
  value: string;
  label: string;
  group?: string;
}

export interface PeriodSelectProps {
  /** Opções já calculadas no servidor (evita divergência de "hoje" na hidratação). */
  options: PeriodOption[];
  value: string;
  /** Parâmetro da URL (padrão: "periodo"). */
  param?: string;
  className?: string;
  label?: string;
}

/** Seletor de período que atualiza ?periodo= preservando os demais parâmetros da URL. */
export function PeriodSelect({ options, value, param = "periodo", className, label = "Período" }: PeriodSelectProps) {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const [pending, startTransition] = React.useTransition();

  const groups = React.useMemo(() => {
    const map = new Map<string, PeriodOption[]>();
    for (const o of options) map.set(o.group ?? "", [...(map.get(o.group ?? "") ?? []), o]);
    return Array.from(map.entries());
  }, [options]);
  const known = options.some((o) => o.value === value);

  const onChange = (next: string) => {
    const params = new URLSearchParams(searchParams.toString());
    params.set(param, next);
    params.delete("de");
    params.delete("ate");
    startTransition(() => router.push(`${pathname}?${params.toString()}`));
  };

  return (
    <label className={cn("relative inline-flex min-w-[200px] items-center", className)}>
      <span className="sr-only">{label}</span>
      <CalendarRange className="pointer-events-none absolute left-3 size-4 text-muted" aria-hidden />
      <select
        value={value}
        onChange={(e) => onChange(e.target.value)}
        aria-busy={pending || undefined}
        className="h-11 w-full appearance-none rounded-lg border border-border bg-surface pl-9 pr-8 text-sm text-foreground shadow-xs transition-colors hover:border-border-strong focus:border-brand focus:outline-none focus:ring-2 focus:ring-brand/25 md:h-9"
      >
        {!known ? <option value={value}>Período personalizado</option> : null}
        {groups.map(([group, items]) =>
          group ? (
            <optgroup key={group} label={group}>
              {items.map((o) => (
                <option key={o.value} value={o.value}>
                  {o.label}
                </option>
              ))}
            </optgroup>
          ) : (
            items.map((o) => (
              <option key={o.value} value={o.value}>
                {o.label}
              </option>
            ))
          ),
        )}
      </select>
      <ChevronDown className="pointer-events-none absolute right-2.5 size-4 text-muted" aria-hidden />
    </label>
  );
}
