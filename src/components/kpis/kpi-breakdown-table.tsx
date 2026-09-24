import Link from "next/link";
import { ChevronRight } from "lucide-react";
import type { BreakdownRow } from "@/server/kpis/queries";
import { formatKpiValue, type KpiUnit } from "@/server/kpis/schemas";
import { Avatar } from "@/components/ui/avatar";
import { EmptyState } from "@/components/ui/empty-state";
import { AttainmentBar } from "./attainment-bar";
import { KpiStatusBadge } from "./kpi-status-badge";

export interface KpiBreakdownTableProps {
  rows: BreakdownRow[];
  unit: KpiUnit;
  suffix?: string;
  /** Mostra avatar (quebra por colaborador). */
  people?: boolean;
  emptyText: string;
}

/** Quebra do indicador por colaborador ou departamento; cada linha abre o drill-down naquele escopo. */
export function KpiBreakdownTable({ rows, unit, suffix, people, emptyText }: KpiBreakdownTableProps) {
  if (rows.length === 0) return <EmptyState size="sm" title="Sem dados para comparar" description={emptyText} />;
  return (
    <ul className="divide-y divide-border">
      {rows.map((r) => (
        <li key={r.id}>
          <Link href={r.href} className="flex min-h-[56px] items-center gap-3 px-1 py-2.5 transition-colors hover:bg-surface-muted">
            {people ? <Avatar name={r.name} src={r.avatarUrl} size="sm" /> : null}
            <div className="min-w-0 flex-1">
              <div className="flex items-center justify-between gap-2">
                <span className="truncate text-sm font-medium text-foreground">{r.name}</span>
                <span className="shrink-0 text-sm font-semibold tabular-nums text-foreground">{formatKpiValue(r.value, unit, suffix)}</span>
              </div>
              <div className="mt-1 flex items-center gap-3">
                <span className="w-28 shrink-0 truncate text-xs text-muted">{r.target !== null ? `Meta ${formatKpiValue(r.target, unit, suffix)}` : (r.subtitle ?? "Sem meta")}</span>
                {r.attainment !== null ? <AttainmentBar attainment={r.attainment} status={r.status} size="sm" className="flex-1" /> : <span className="flex-1" />}
                <KpiStatusBadge status={r.status} className="hidden sm:inline-flex" />
              </div>
            </div>
            <ChevronRight className="size-4 shrink-0 text-muted-light" aria-hidden />
          </Link>
        </li>
      ))}
    </ul>
  );
}
