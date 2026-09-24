import Link from "next/link";
import { Award, CheckCircle2, Target, TrendingUp, Zap } from "lucide-react";
import type { KpiResult } from "@/server/kpis/engine";
import type { PerformanceIndex } from "@/server/kpis/operation-health";
import { formatKpiValue } from "@/server/kpis/schemas";
import { formatNumber, formatPercent } from "@/lib/format";
import { cn } from "@/lib/utils";
import { Badge } from "@/components/ui/badge";
import { EmptyState } from "@/components/ui/empty-state";
import { IconTile } from "@/components/ui/icon-tile";
import { MetricDelta } from "@/components/ui/metric-delta";
import { ScoreRing } from "@/components/ui/score-ring";
import { toneText, type Tone } from "@/components/ui/tone";

const DIMENSION_ICON: Record<string, { icon: React.ReactNode; tone: Tone }> = {
  eficiencia: { icon: <Zap />, tone: "success" },
  entrega: { icon: <Target />, tone: "info" },
  qualidade: { icon: <Award />, tone: "purple" },
};

/** "Índice de desempenho": anel 0–100 com a faixa e as dimensões Eficiência, Entrega e Qualidade (com variação). */
export function PerformanceIndexCard({ index, previous, size = 150 }: { index: PerformanceIndex | null; previous: PerformanceIndex | null; size?: number }) {
  if (!index) return <EmptyState size="sm" title="Índice indisponível" description="Sem scorecard para calcular o índice." />;
  return (
    <div className="flex flex-col items-center gap-5 sm:flex-row sm:items-center">
      <ScoreRing value={index.score} label={index.band?.label ?? "Sem dados"} tone={index.tone} size={size} thickness={12} />
      <ul className="flex w-full min-w-0 flex-1 flex-col divide-y divide-border">
        {index.dimensions.map((d) => {
          const prev = previous?.dimensions.find((x) => x.key === d.key)?.score ?? null;
          const delta = d.score !== null && prev !== null ? d.score - prev : null;
          const meta = DIMENSION_ICON[d.key];
          return (
            <li key={d.key} className="flex items-center gap-3 py-2.5" title={d.items.map((i) => `${i.name}: ${i.score === null ? "sem dado" : Math.round(i.score)}`).join(" · ") || "Sem indicadores com dado"}>
              <IconTile icon={meta.icon} tone={meta.tone} size="sm" shape="circle" />
              <div className="min-w-0 flex-1">
                <p className="text-sm text-muted">{d.label}</p>
                <p className="text-xl font-semibold tabular-nums">{d.score === null ? "—" : `${Math.round(d.score)}%`}</p>
              </div>
              {delta !== null ? <MetricDelta value={`${formatNumber(Math.round(Math.abs(delta) * 10) / 10)} p.p.`} direction={delta > 0.05 ? "up" : delta < -0.05 ? "down" : "flat"} /> : <span className="text-xs text-muted">—</span>}
            </li>
          );
        })}
      </ul>
    </div>
  );
}

function goalStatus(r: KpiResult): { label: string; variant: "success" | "info" | "warning" | "muted" } {
  if (r.attainment === null) return { label: "Sem dados", variant: "muted" };
  if (r.status === "atingida") return { label: "Acima da meta", variant: "success" };
  if (r.status === "atencao") return { label: "No caminho", variant: "info" };
  return { label: "Atenção", variant: "warning" };
}

/** "Minhas metas": indicadores da função com meta (realizado ÷ meta, progresso e status), cada linha com drill-down. */
export function MyGoalsTable({ items, limit = 8 }: { items: KpiResult[]; limit?: number }) {
  const goals = items.filter((r) => r.target !== null).sort((a, b) => (b.weight || 0) - (a.weight || 0));
  if (goals.length === 0) return <EmptyState size="sm" icon={<Target />} title="Sem metas no período" description="Quando houver metas para seus indicadores, o progresso aparece aqui." />;
  return (
    <div className="-mx-5 overflow-x-auto">
      <table className="w-full min-w-[460px] text-sm">
        <thead>
          <tr className="border-y border-border bg-surface-muted text-left text-xs text-muted">
            <th className="px-5 py-2 font-medium">Indicador</th>
            <th className="px-3 py-2 text-right font-medium">Realizado</th>
            <th className="px-3 py-2 font-medium">Progresso</th>
            <th className="px-5 py-2 font-medium">Status</th>
          </tr>
        </thead>
        <tbody className="divide-y divide-border">
          {goals.slice(0, limit).map((r) => {
            const s = goalStatus(r);
            const pct = r.attainment === null ? 0 : Math.min(100, r.attainment * 100);
            return (
              <tr key={r.key} className="hover:bg-surface-hover">
                <td className="px-5 py-2.5">
                  <Link href={r.href} className="flex items-center gap-2 font-medium hover:text-brand-fg hover:underline">
                    <CheckCircle2 className={cn("size-4 shrink-0", r.status === "atingida" ? "text-success-fg" : "text-muted-light")} aria-hidden />
                    <span className="truncate">{r.kpi.name}</span>
                  </Link>
                </td>
                <td className="whitespace-nowrap px-3 py-2 text-right tabular-nums">
                  <span className="block">{formatKpiValue(r.value, r.kpi.unit, r.kpi.formulaMeta?.suffix)}</span>
                  <span className="block text-xs text-muted">meta {formatKpiValue(r.target, r.kpi.unit, r.kpi.formulaMeta?.suffix)}</span>
                </td>
                <td className="px-3 py-2.5">
                  <span className="flex min-w-[96px] items-center gap-2">
                    <span className="w-11 shrink-0 text-right text-xs tabular-nums">{formatPercent(r.attainment)}</span>
                    <span className="h-1.5 flex-1 overflow-hidden rounded-full bg-track" aria-hidden>
                      <span className="block h-full rounded-full bg-brand" style={{ width: `${pct}%` }} />
                    </span>
                  </span>
                </td>
                <td className="px-5 py-2.5">
                  <Badge variant={s.variant} size="sm">
                    {s.label}
                  </Badge>
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

/** "Comparativo com o mês anterior": variação do Índice de desempenho em pontos. */
export function IndexComparison({ index, previous, previousLabel }: { index: PerformanceIndex | null; previous: PerformanceIndex | null; previousLabel: string }) {
  const delta = index?.score !== null && index?.score !== undefined && previous?.score !== null && previous?.score !== undefined ? index.score - previous.score : null;
  const tone: Tone = delta === null ? "neutral" : delta >= 0 ? "success" : "danger";
  return (
    <div className="flex items-center gap-3">
      <IconTile icon={<TrendingUp className={delta !== null && delta < 0 ? "rotate-180" : undefined} />} tone={tone} size="md" />
      <div>
        <p className={cn("text-3xl font-semibold tabular-nums", toneText[tone])}>{delta === null ? "—" : `${delta > 0 ? "+" : delta < 0 ? "−" : ""}${formatNumber(Math.abs(delta))} pts`}</p>
        <p className="text-xs text-muted">Evolução do índice de desempenho vs. {previousLabel.toLowerCase()}</p>
      </div>
    </div>
  );
}
