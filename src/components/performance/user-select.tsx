"use client";

import * as React from "react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { ChevronDown, UserRound } from "lucide-react";
import { DEPARTMENT_LABELS, type DepartmentKey } from "@/domain/constants";
import { cn } from "@/lib/utils";

export interface UserSelectProps {
  people: { id: string; name: string; department: DepartmentKey; jobTitle?: string }[];
  value: string;
  /** Parâmetro da URL (padrão: "usuario"). */
  param?: string;
  className?: string;
}

/** Seletor de colaborador (gestor/diretoria/admin) que atualiza ?usuario= preservando os demais parâmetros. */
export function UserSelect({ people, value, param = "usuario", className }: UserSelectProps) {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const [pending, startTransition] = React.useTransition();

  const groups = React.useMemo(() => {
    const map = new Map<DepartmentKey, UserSelectProps["people"]>();
    for (const p of people) map.set(p.department, [...(map.get(p.department) ?? []), p]);
    return Array.from(map.entries()).sort((a, b) => DEPARTMENT_LABELS[a[0]].localeCompare(DEPARTMENT_LABELS[b[0]], "pt-BR"));
  }, [people]);

  const onChange = (next: string) => {
    const params = new URLSearchParams(searchParams.toString());
    params.set(param, next);
    startTransition(() => router.push(`${pathname}?${params.toString()}`));
  };

  return (
    <label className={cn("relative inline-flex min-w-[220px] items-center", className)}>
      <span className="sr-only">Colaborador</span>
      <UserRound className="pointer-events-none absolute left-3 size-4 text-muted" aria-hidden />
      <select
        value={value}
        onChange={(e) => onChange(e.target.value)}
        aria-busy={pending || undefined}
        className="h-11 w-full appearance-none rounded-lg border border-border bg-surface pl-9 pr-8 text-sm text-foreground shadow-xs transition-colors hover:border-border-strong focus:border-brand focus:outline-none focus:ring-2 focus:ring-brand/25 md:h-9"
      >
        {groups.map(([dep, items]) => (
          <optgroup key={dep} label={DEPARTMENT_LABELS[dep]}>
            {items.map((p) => (
              <option key={p.id} value={p.id}>
                {p.name}
              </option>
            ))}
          </optgroup>
        ))}
      </select>
      <ChevronDown className="pointer-events-none absolute right-2.5 size-4 text-muted" aria-hidden />
    </label>
  );
}
