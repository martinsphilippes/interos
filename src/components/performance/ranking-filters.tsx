"use client";

import * as React from "react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { ChevronDown, Network } from "lucide-react";
import { RANKING_SCOPE_LABELS, RANKING_SCOPES, type RankingScope } from "@/server/performance/schemas";
import { DEPARTMENT_LABELS, type DepartmentKey } from "@/domain/constants";
import { SegmentedControl } from "@/components/ui/segmented-control";

/** Escopo do ranking (individual/equipes/departamentos) e, no individual, o departamento comparado. */
export function RankingFilters({ scope, department, departments }: { scope: RankingScope; department: DepartmentKey | "todos"; departments: DepartmentKey[] }) {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const [pending, startTransition] = React.useTransition();

  const push = (patch: Record<string, string>) => {
    const params = new URLSearchParams(searchParams.toString());
    for (const [k, v] of Object.entries(patch)) params.set(k, v);
    startTransition(() => router.push(`${pathname}?${params.toString()}`));
  };

  return (
    <div className="flex flex-wrap items-center gap-2" aria-busy={pending || undefined}>
      <SegmentedControl<RankingScope> aria-label="Escopo do ranking" value={scope} onChange={(v) => push({ escopo: v })} options={RANKING_SCOPES.map((s) => ({ value: s, label: RANKING_SCOPE_LABELS[s] }))} />
      {scope === "individual" ? (
        <label className="relative inline-flex min-w-[220px] items-center">
          <span className="sr-only">Comparar dentro de</span>
          <Network className="pointer-events-none absolute left-3 size-4 text-muted" aria-hidden />
          <select
            value={department}
            onChange={(e) => push({ departamento: e.target.value })}
            className="h-11 w-full appearance-none rounded-lg border border-border bg-surface pl-9 pr-8 text-sm text-foreground shadow-xs transition-colors hover:border-border-strong focus:border-brand focus:outline-none focus:ring-2 focus:ring-brand/25 md:h-9"
          >
            {departments.map((d) => (
              <option key={d} value={d}>
                {DEPARTMENT_LABELS[d]}
              </option>
            ))}
            <option value="todos">Todos (pontos normalizados)</option>
          </select>
          <ChevronDown className="pointer-events-none absolute right-2.5 size-4 text-muted" aria-hidden />
        </label>
      ) : null}
    </div>
  );
}
