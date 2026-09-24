"use client";

import { CartesianGrid, ComposedChart, Line, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import { formatPercent } from "@/lib/format";
import { CHART_COLORS, chartActiveDot, chartAxisTick, chartDot, chartGridProps, chartLineCursor, chartTooltipClassName } from "@/lib/chart-theme";

export interface EvolutionPoint {
  period: string;
  label: string;
  index: number | null;
  attainment: number | null;
}

/**
 * "Evolução mensal": Índice de desempenho (0–100) dos últimos meses contra a meta do índice (setting
 * "indice_desempenho".meta, linha tracejada). O tooltip mostra também o atingimento geral das metas.
 */
export function PerformanceEvolutionChart({ points, meta, height = 240 }: { points: EvolutionPoint[]; meta: number; height?: number }) {
  if (points.every((p) => p.index === null)) return <p className="py-12 text-center text-sm text-muted">Sem histórico de desempenho para os últimos meses.</p>;
  const data = points.map((p) => ({ ...p, short: p.label.split("/")[0], meta }));
  return (
    <div>
      <div className="mb-2 flex flex-wrap items-center gap-4 text-xs text-muted" aria-hidden>
        <span className="inline-flex items-center gap-1.5">
          <span className="h-0.5 w-4 rounded bg-brand" /> Desempenho (índice)
        </span>
        <span className="inline-flex items-center gap-1.5">
          <span className="h-0 w-4 border-t-2 border-dashed border-muted" /> Meta ({meta})
        </span>
      </div>
      <div style={{ height }} role="img" aria-label="Evolução mensal do índice de desempenho">
        <ResponsiveContainer width="100%" height="100%">
          <ComposedChart data={data} margin={{ top: 18, right: 16, bottom: 0, left: -6 }}>
            <CartesianGrid vertical={false} {...chartGridProps} />
            <XAxis dataKey="short" tick={chartAxisTick} axisLine={false} tickLine={false} />
            <YAxis domain={[0, 100]} ticks={[0, 25, 50, 75, 100]} tick={chartAxisTick} axisLine={false} tickLine={false} width={40} />
            <Tooltip
              cursor={chartLineCursor}
              content={({ active, payload }) => {
                const p = payload?.[0]?.payload as (typeof data)[number] | undefined;
                if (!active || !p) return null;
                return (
                  <div className={chartTooltipClassName}>
                    <p className="mb-1 font-semibold capitalize">{p.label}</p>
                    <p className="flex justify-between gap-4 text-muted">
                      Índice <span className="font-medium tabular-nums text-foreground">{p.index ?? "—"}</span>
                    </p>
                    <p className="flex justify-between gap-4 text-muted">
                      Metas atingidas <span className="font-medium tabular-nums text-foreground">{formatPercent(p.attainment)}</span>
                    </p>
                  </div>
                );
              }}
            />
            <Line type="monotone" dataKey="meta" stroke={CHART_COLORS.goal} strokeWidth={1.5} strokeDasharray="6 5" dot={false} isAnimationActive={false} />
            <Line
              type="monotone"
              dataKey="index"
              stroke={CHART_COLORS.primary}
              strokeWidth={2.5}
              connectNulls
              dot={chartDot(CHART_COLORS.primary)}
              activeDot={chartActiveDot(CHART_COLORS.primary)}
              isAnimationActive={false}
              label={{ position: "top", fill: "var(--color-foreground)", fontSize: 11, formatter: (v: unknown) => (typeof v === "number" ? String(v) : "") }}
            />
          </ComposedChart>
        </ResponsiveContainer>
      </div>
    </div>
  );
}
