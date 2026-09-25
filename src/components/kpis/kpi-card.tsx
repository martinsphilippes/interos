import Link from "next/link";
import { ArrowDownRight, ArrowUpRight, ChevronRight, Minus } from "lucide-react";
import { cn } from "@/lib/utils";
import type { KpiResult } from "@/server/kpis/engine";
import { departmentLabel, formatKpiDelta, formatKpiValue } from "@/server/kpis/schemas";
import { AttainmentBar } from "./attainment-bar";
import { KpiStatusBadge } from "./kpi-status-badge";

export interface KpiCardProps {
  result: KpiResult;
  /** Destino do clique (padrão: drill-down do resultado). `null` desativa o link. */
  href?: string | null;
  /** Rótulo acima do nome (padrão: departamento do indicador). */
  eyebrow?: string;
  compact?: boolean;
  className?: string;
}

/** Texto curto de tendência com seta e cor pelo sentido do indicador (verde = melhorou). */
export function KpiTrendText({ result, className }: { result: Pick<KpiResult, "trend" | "kpi">; className?: string }) {
  const trend = result.trend;
  if (!trend || trend.delta === null) return <span className={cn("text-xs text-muted", className)}>Sem comparação com o período anterior</span>;
  const Icon = trend.direction === "up" ? ArrowUpRight : trend.direction === "down" ? ArrowDownRight : Minus;
  const tone = trend.favorable === null ? "text-muted" : trend.favorable ? "text-success-fg" : "text-danger-fg";
  return (
    <span className={cn("inline-flex min-w-0 items-center gap-1 text-xs", className)}>
      <span className={cn("inline-flex items-center gap-0.5 font-medium tabular-nums", tone)}>
        <Icon className="size-3.5" aria-hidden />
        {formatKpiDelta(trend.delta, result.kpi.unit, result.kpi.formulaMeta?.suffix)}
      </span>
      <span className="truncate text-muted">vs {trend.period.label.toLowerCase()}</span>
    </span>
  );
}

/** Cartão de indicador: valor, status, meta, atingimento, tendência e link para o drill-down. */
export function KpiCard({ result, href, eyebrow, compact, className }: KpiCardProps) {
  const suffix = result.kpi.formulaMeta?.suffix;
  const link = href === null ? null : (href ?? result.href);
  const content = (
    <>
      <div>
        <div className="flex items-center justify-between gap-2">
          <p className="label-caps min-w-0 truncate">{eyebrow ?? departmentLabel(result.kpi.department)}</p>
          <div className="flex shrink-0 items-center gap-1">
            <KpiStatusBadge status={result.status} noData={result.value === null && result.target !== null} />
            {link ? <ChevronRight className="size-4 text-muted-light" aria-hidden /> : null}
          </div>
        </div>
        <h3 className="mt-1 line-clamp-2 text-sm font-semibold leading-tight text-foreground">{result.kpi.name}</h3>
      </div>
      <p className={cn("font-semibold tabular-nums tracking-tight text-foreground", compact ? "text-xl" : "text-2xl md:text-[28px] md:leading-9")} title={result.note}>
        {formatKpiValue(result.value, result.kpi.unit, suffix)}
      </p>
      {result.value === null && result.note ? <p className="-mt-2 text-xs text-muted">{result.note}</p> : null}
      <AttainmentBar attainment={result.attainment} status={result.status} size="sm" noData={result.value === null && result.target !== null} />
      <div className="flex flex-wrap items-center justify-between gap-x-3 gap-y-1 text-xs">
        <span className="text-muted">
          Meta <span className="font-medium tabular-nums text-foreground">{result.target !== null ? formatKpiValue(result.target, result.kpi.unit, suffix) : result.targetMin !== undefined && result.targetMax !== undefined ? `${formatKpiValue(result.targetMin, result.kpi.unit, suffix)} a ${formatKpiValue(result.targetMax, result.kpi.unit, suffix)}` : "—"}</span>
        </span>
        {result.trend ? <KpiTrendText result={result} /> : null}
      </div>
    </>
  );
  const base = cn("flex flex-col gap-3 rounded-lg border border-border bg-surface shadow-card", compact ? "p-3.5" : "p-4", className);
  if (!link) return <div data-kpi-card={result.key} className={base}>{content}</div>;
  return (
    <Link href={link} data-kpi-card={result.key} className={cn(base, "transition-colors hover:border-border-strong hover:bg-surface-muted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand/25")}>
      {content}
    </Link>
  );
}
