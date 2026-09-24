import Link from "next/link";
import { ArrowDown, ArrowRight, Hourglass } from "lucide-react";
import type { CockpitHandoff, CockpitStage, FunnelStep, StageHealth, StageMetric } from "@/server/management/queries";
import { formatKpiValue } from "@/server/kpis/schemas";
import { KpiTrendText } from "@/components/kpis/kpi-card";
import { KpiStatusBadge } from "@/components/kpis/kpi-status-badge";
import { StatusDot, type StatusTone } from "@/components/ui/status-dot";
import { formatNumber, formatPercent } from "@/lib/format";
import { cn } from "@/lib/utils";

const HEALTH: Record<StageHealth, { tone: StatusTone; label: string; border: string }> = {
  verde: { tone: "success", label: "Saudável", border: "border-t-success" },
  ambar: { tone: "warning", label: "Atenção", border: "border-t-warning" },
  vermelho: { tone: "danger", label: "Crítico", border: "border-t-danger" },
  neutro: { tone: "muted", label: "Sem meta", border: "border-t-border-strong" },
};

function MetricRow({ metric }: { metric: StageMetric }) {
  if (metric.kind === "kpi") {
    const r = metric.result;
    return (
      <Link href={r.href} className="group flex flex-col gap-0.5 rounded-md px-2 py-1.5 transition-colors hover:bg-surface-hover" title={r.note ?? r.kpi.description}>
        <span className="flex items-center justify-between gap-2">
          <span className="truncate text-xs text-muted">{metric.label ?? r.kpi.name}</span>
          {r.status ? <KpiStatusBadge status={r.status} className="shrink-0 scale-90" /> : null}
        </span>
        <span className="text-base font-semibold tabular-nums text-foreground group-hover:underline">{formatKpiValue(r.value, r.kpi.unit, r.kpi.formulaMeta?.suffix)}</span>
        {r.trend ? <KpiTrendText result={r} className="text-[11px]" /> : null}
      </Link>
    );
  }
  const m = metric.metric;
  return (
    <Link href={m.href} className="group flex flex-col gap-0.5 rounded-md px-2 py-1.5 transition-colors hover:bg-surface-hover" title={m.hint}>
      <span className="flex items-center justify-between gap-2">
        <span className="truncate text-xs text-muted">{m.label}</span>
        {m.status ? <KpiStatusBadge status={m.status} className="shrink-0 scale-90" /> : null}
      </span>
      <span className="text-base font-semibold tabular-nums text-foreground group-hover:underline">{formatKpiValue(m.value, m.unit)}</span>
      {m.hint ? <span className="line-clamp-2 text-[11px] text-muted">{m.hint}</span> : null}
    </Link>
  );
}

function StageCard({ stage }: { stage: CockpitStage }) {
  const health = HEALTH[stage.health];
  return (
    <section aria-label={`Estágio ${stage.label}`} className={cn("flex min-w-0 flex-col rounded-lg border border-t-4 border-border bg-surface shadow-card", health.border)}>
      <header className="flex flex-col gap-1 border-b border-border px-3 py-2.5">
        <div className="flex items-center justify-between gap-2">
          <h3 className="truncate text-sm font-semibold text-foreground">{stage.label}</h3>
          <StatusDot tone={health.tone} label={<span className="text-xs">{health.label}</span>} pulse={stage.health === "vermelho"} />
        </div>
        <p className="truncate text-[11px] text-muted" title={stage.healthReason}>
          {stage.manager ? `${stage.manager.name} · ` : ""}
          {stage.healthReason}
        </p>
      </header>
      <div className="grid grid-cols-2 gap-0.5 p-1.5 sm:grid-cols-3 lg:grid-cols-4 2xl:grid-cols-1">
        {stage.metrics.map((m) => (
          <MetricRow key={m.kind === "kpi" ? m.result.key : m.metric.key} metric={m} />
        ))}
      </div>
    </section>
  );
}

function Handoff({ handoff }: { handoff: CockpitHandoff }) {
  const rateText = handoff.rate === null ? "—" : formatPercent(handoff.rate);
  return (
    <div className="flex items-center justify-center py-1 2xl:w-[104px] 2xl:py-0">
      <div className="flex w-full max-w-sm flex-row items-center gap-3 rounded-lg border border-dashed border-border-strong bg-surface-muted px-3 py-2 2xl:flex-col 2xl:gap-1.5 2xl:border-none 2xl:bg-transparent 2xl:p-0">
        <ArrowDown className="size-5 shrink-0 text-muted 2xl:hidden" aria-hidden />
        <ArrowRight className="hidden size-5 shrink-0 text-muted 2xl:block" aria-hidden />
        <div className="flex min-w-0 flex-1 flex-col gap-1 2xl:items-center 2xl:text-center">
          <span className="text-[11px] leading-tight text-muted">{handoff.label}</span>
          <Link href={handoff.rateHref} className="inline-flex min-h-[32px] items-center text-sm font-semibold tabular-nums text-foreground hover:underline 2xl:justify-center" title={handoff.description}>
            {rateText}
            <span className="ml-1 text-[11px] font-normal text-muted">
              ({formatNumber(handoff.numerator)}/{formatNumber(handoff.denominator)})
            </span>
          </Link>
          <Link
            href={handoff.stuckHref}
            className={cn(
              "inline-flex min-h-[32px] items-center gap-1 rounded-full px-2 text-[11px] font-medium transition-colors 2xl:justify-center",
              handoff.stuck > 0 ? "bg-danger-soft text-danger-fg hover:bg-danger-soft/70" : "bg-surface-hover text-muted hover:text-foreground",
            )}
            title="Etapas de workflow abertas deste estágio com SLA violado"
          >
            <Hourglass className="size-3" aria-hidden /> {handoff.stuck} parado(s)
            {handoff.atRisk > 0 ? <span className="font-normal">· +{handoff.atRisk} em risco</span> : null}
          </Link>
        </div>
      </div>
    </div>
  );
}

/**
 * Cadeia da jornada: Marketing → Vendas → Financeiro → Implantação → CS → Suporte. Horizontal em telas
 * largas, vertical no celular. Entre os estágios, a taxa de passagem e o volume parado no handoff.
 */
export function CockpitChain({ stages, handoffs }: { stages: CockpitStage[]; handoffs: CockpitHandoff[] }) {
  return (
    <div className="flex flex-col gap-2 2xl:grid 2xl:grid-cols-[minmax(0,1fr)_auto_minmax(0,1fr)_auto_minmax(0,1fr)_auto_minmax(0,1fr)_auto_minmax(0,1fr)_auto_minmax(0,1fr)] 2xl:items-stretch 2xl:gap-1.5">
      {stages.map((stage, i) => (
        <div key={stage.department} className="contents">
          <StageCard stage={stage} />
          {handoffs[i] ? <Handoff handoff={handoffs[i]} /> : null}
        </div>
      ))}
    </div>
  );
}

/** Funil do período: uma barra por etapa (um só tom; o valor é rótulo direto) com a passagem entre elas. */
export function CockpitFunnel({ steps }: { steps: FunnelStep[] }) {
  const max = Math.max(1, ...steps.map((s) => s.value));
  return (
    <ol className="flex flex-col gap-2">
      {steps.map((s, i) => {
        const prev = i > 0 ? steps[i - 1].value : null;
        const pass = prev ? s.value / prev : null;
        return (
          <li key={s.key}>
            <Link href={s.href} className="group grid min-h-[44px] grid-cols-[120px_minmax(0,1fr)_64px] items-center gap-3 rounded-md px-1 transition-colors hover:bg-surface-muted">
              <span className="truncate text-sm text-foreground">{s.label}</span>
              <span className="relative h-6 rounded bg-surface-hover">
                <span className="absolute inset-y-0 left-0 rounded bg-secondary transition-[width]" style={{ width: `${Math.max(s.value > 0 ? 2 : 0, (s.value / max) * 100)}%` }} />
                <span className="absolute inset-y-0 left-2 flex items-center text-xs font-semibold tabular-nums text-foreground mix-blend-normal">
                  <span className="rounded bg-surface/85 px-1">{formatNumber(s.value)}</span>
                </span>
              </span>
              <span className="text-right text-xs tabular-nums text-muted" title="Passagem em relação à etapa anterior">
                {pass === null ? "" : formatPercent(pass)}
              </span>
            </Link>
          </li>
        );
      })}
    </ol>
  );
}
