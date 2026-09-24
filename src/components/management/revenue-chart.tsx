"use client";

import { Area, CartesianGrid, ComposedChart, Line, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import type { HistoryPoint } from "@/server/kpis/engine";
import { formatCurrency } from "@/lib/format";
import { CHART_COLORS, chartActiveDot, chartAxisTick, chartDot, chartGridProps, chartLineCursor, chartTooltipClassName } from "@/lib/chart-theme";

function compact(v: number): string {
  if (Math.abs(v) >= 1000) return `R$ ${Math.round(v / 100) / 10}k`.replace(".", ",");
  return `R$ ${Math.round(v)}`;
}

/**
 * "Evolução da receita": receita recorrente (MRR) e receita total (faturamento do mês) nos últimos meses.
 * Meses fechados vêm dos snapshots; o mês atual, do cálculo ao vivo (HistoryPoint.source).
 */
export function RevenueChart({ mrr, revenue, height = 250 }: { mrr: HistoryPoint[]; revenue: HistoryPoint[]; height?: number }) {
  const data = mrr.map((p, i) => ({ label: p.label.split("/")[0], full: p.label, mrr: p.value, total: revenue[i]?.value ?? null, live: p.source === "ao_vivo" }));
  if (data.every((d) => d.mrr === null && d.total === null)) return <p className="py-12 text-center text-sm text-muted">Sem histórico de receita.</p>;
  const last = data[data.length - 1];
  return (
    <div>
      <div className="mb-2 flex flex-wrap items-center gap-4 text-xs text-muted" aria-hidden>
        <span className="inline-flex items-center gap-1.5">
          <span className="h-0.5 w-4 rounded bg-brand" /> Receita recorrente (MRR)
        </span>
        <span className="inline-flex items-center gap-1.5">
          <span className="h-0.5 w-4 rounded bg-info" /> Receita total (faturamento)
        </span>
      </div>
      <div style={{ height }} role="img" aria-label={`Evolução da receita: MRR ${formatCurrency(last?.mrr)} e faturamento ${formatCurrency(last?.total)} no último mês`}>
        <ResponsiveContainer width="100%" height="100%">
          <ComposedChart data={data} margin={{ top: 12, right: 12, bottom: 0, left: 0 }}>
            <defs>
              <linearGradient id="mrrFill" x1="0" y1="0" x2="0" y2="1">
                <stop offset="0%" stopColor="var(--color-brand)" stopOpacity={0.3} />
                <stop offset="100%" stopColor="var(--color-brand)" stopOpacity={0} />
              </linearGradient>
            </defs>
            <CartesianGrid vertical={false} {...chartGridProps} />
            <XAxis dataKey="label" tick={chartAxisTick} axisLine={false} tickLine={false} />
            <YAxis tick={chartAxisTick} axisLine={false} tickLine={false} width={64} tickFormatter={compact} />
            <Tooltip
              cursor={chartLineCursor}
              content={({ active, payload }) => {
                const p = payload?.[0]?.payload as (typeof data)[number] | undefined;
                if (!active || !p) return null;
                return (
                  <div className={chartTooltipClassName}>
                    <p className="mb-1 font-semibold capitalize">{p.full}</p>
                    <p className="flex justify-between gap-4 text-muted">
                      MRR <span className="font-medium tabular-nums text-foreground">{formatCurrency(p.mrr)}</span>
                    </p>
                    <p className="flex justify-between gap-4 text-muted">
                      Faturamento <span className="font-medium tabular-nums text-foreground">{formatCurrency(p.total)}</span>
                    </p>
                    <p className="mt-1 text-[11px] text-muted-light">{p.live ? "Cálculo ao vivo" : "Snapshot gravado"}</p>
                  </div>
                );
              }}
            />
            <Area type="monotone" dataKey="mrr" stroke="none" fill="url(#mrrFill)" connectNulls isAnimationActive={false} />
            <Line type="monotone" dataKey="total" stroke={CHART_COLORS.secondary} strokeWidth={2} connectNulls dot={chartDot(CHART_COLORS.secondary)} activeDot={chartActiveDot(CHART_COLORS.secondary)} isAnimationActive={false} />
            <Line type="monotone" dataKey="mrr" stroke={CHART_COLORS.primary} strokeWidth={2.5} connectNulls dot={chartDot(CHART_COLORS.primary)} activeDot={chartActiveDot(CHART_COLORS.primary)} isAnimationActive={false} />
          </ComposedChart>
        </ResponsiveContainer>
      </div>
    </div>
  );
}
