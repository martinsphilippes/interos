"use client";

import { Area, CartesianGrid, ComposedChart, Line, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import type { TeamWeek } from "@/server/management/queries";
import { formatPercent } from "@/lib/format";
import { CHART_COLORS, chartActiveDot, chartAxisTick, chartDot, chartGridProps, chartLineCursor, chartTooltipClassName } from "@/lib/chart-theme";

/**
 * "Desempenho da equipe": por dia útil da semana atual, a fração das tarefas com prazo no dia entregues até o
 * prazo (realizado) contra a meta do indicador Tarefas no prazo (linha tracejada).
 */
export function TeamWeekChart({ week, height = 240 }: { week: TeamWeek; height?: number }) {
  const data = week.days.map((d) => ({ ...d, pct: d.rate === null ? null : Math.round(d.rate * 1000) / 10, meta: week.target === null ? null : Math.round(week.target * 1000) / 10 }));
  const empty = data.every((d) => d.pct === null);
  return (
    <div>
      <div className="mb-2 flex flex-wrap items-center gap-4 text-xs text-muted" aria-hidden>
        <span className="inline-flex items-center gap-1.5">
          <span className="h-0.5 w-4 rounded bg-brand" /> Realizado
        </span>
        {week.target !== null ? (
          <span className="inline-flex items-center gap-1.5">
            <span className="h-0 w-4 border-t-2 border-dashed border-info" /> Meta
          </span>
        ) : null}
      </div>
      {empty ? (
        <p className="flex items-center justify-center text-center text-sm text-muted" style={{ height }}>
          Nenhuma tarefa da equipe com prazo nesta semana até agora.
        </p>
      ) : (
        <div style={{ height }} role="img" aria-label="Entregas no prazo por dia da semana">
          <ResponsiveContainer width="100%" height="100%">
            <ComposedChart data={data} margin={{ top: 16, right: 12, bottom: 0, left: 0 }}>
              <defs>
                <linearGradient id="teamWeekFill" x1="0" y1="0" x2="0" y2="1">
                  <stop offset="0%" stopColor="var(--color-brand)" stopOpacity={0.35} />
                  <stop offset="100%" stopColor="var(--color-brand)" stopOpacity={0} />
                </linearGradient>
              </defs>
              <CartesianGrid vertical={false} {...chartGridProps} />
              <XAxis dataKey="label" tick={chartAxisTick} axisLine={false} tickLine={false} tickFormatter={(v: string) => v.split(" ")[0]} />
              <YAxis domain={[0, 100]} ticks={[0, 25, 50, 75, 100]} tick={chartAxisTick} axisLine={false} tickLine={false} tickFormatter={(v: number) => `${v}%`} width={44} />
              <Tooltip
                cursor={chartLineCursor}
                content={({ active, payload }) => {
                  const p = payload?.[0]?.payload as (typeof data)[number] | undefined;
                  if (!active || !p) return null;
                  return (
                    <div className={chartTooltipClassName}>
                      <p className="mb-1 font-semibold">{p.label}</p>
                      <p className="text-muted">
                        No prazo <span className="font-medium text-foreground tabular-nums">{p.rate === null ? "—" : formatPercent(p.rate)}</span>
                      </p>
                      <p className="text-muted">
                        {p.onTime} de {p.due} tarefa(s) com prazo no dia
                      </p>
                      {p.future ? <p className="text-muted-light">Dia ainda não avaliado</p> : null}
                    </div>
                  );
                }}
              />
              <Area type="monotone" dataKey="pct" stroke="none" fill="url(#teamWeekFill)" connectNulls isAnimationActive={false} />
              {week.target !== null ? <Line type="monotone" dataKey="meta" stroke={CHART_COLORS.secondary} strokeWidth={2} strokeDasharray="6 5" dot={false} isAnimationActive={false} /> : null}
              <Line
                type="monotone"
                dataKey="pct"
                stroke={CHART_COLORS.primary}
                strokeWidth={2.5}
                connectNulls
                dot={chartDot(CHART_COLORS.primary)}
                activeDot={chartActiveDot(CHART_COLORS.primary)}
                isAnimationActive={false}
                label={{ position: "top", fill: "var(--color-foreground)", fontSize: 11, formatter: (v: unknown) => (typeof v === "number" ? `${Math.round(v)}%` : "") }}
              />
            </ComposedChart>
          </ResponsiveContainer>
        </div>
      )}
    </div>
  );
}
