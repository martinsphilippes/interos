"use client";

import * as React from "react";
import { Bar, CartesianGrid, Cell, ComposedChart, Line, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import type { HistoryPoint } from "@/server/kpis/engine";
import { STATUS_LABELS, formatKpiValue, type KpiStatus, type KpiUnit } from "@/server/kpis/schemas";
import { formatPercent } from "@/lib/format";

/**
 * Histórico mensal do indicador: barras com o valor (cor pelo status do mês) e linha tracejada da meta.
 * Inclui a tabela equivalente (details) para leitura sem gráfico.
 */

const AXIS = { fontSize: 11, fill: "var(--color-muted)" } as const;
const STATUS_COLOR: Record<KpiStatus, string> = { atingida: "var(--color-success)", atencao: "var(--color-warning)", critico: "var(--color-danger)" };
const NEUTRAL = "var(--color-secondary)";
const TARGET = "var(--color-navy-500)";

export interface KpiTrendChartProps {
  points: HistoryPoint[];
  unit: KpiUnit;
  suffix?: string;
  height?: number;
}

function compactValue(value: number, unit: KpiUnit): string {
  if (unit === "percentual") return `${Math.round(value * 100)}%`;
  if (unit === "moeda") return Math.abs(value) >= 1000 ? `R$ ${Math.round(value / 100) / 10}k` : `R$ ${Math.round(value)}`;
  return Math.abs(value) >= 1000 ? `${Math.round(value / 100) / 10}k` : String(Math.round(value * 10) / 10);
}

export function KpiTrendChart({ points, unit, suffix, height = 240 }: KpiTrendChartProps) {
  if (points.every((p) => p.value === null)) return <p className="py-10 text-center text-sm text-muted">Sem histórico para este indicador.</p>;
  const data = points.map((p) => ({ ...p, bar: p.value ?? 0, hasValue: p.value !== null }));
  const hasTarget = points.some((p) => p.target !== null);
  return (
    <div>
      <div className="mb-2 flex flex-wrap items-center gap-4 text-xs text-muted" aria-hidden>
        <span className="inline-flex items-center gap-1.5">
          <span className="size-2.5 rounded-sm bg-success" /> Atingida
        </span>
        <span className="inline-flex items-center gap-1.5">
          <span className="size-2.5 rounded-sm bg-warning" /> Atenção
        </span>
        <span className="inline-flex items-center gap-1.5">
          <span className="size-2.5 rounded-sm bg-danger" /> Crítico
        </span>
        {hasTarget ? (
          <span className="inline-flex items-center gap-1.5">
            <span className="h-0.5 w-4 border-t-2 border-dashed" style={{ borderColor: TARGET }} /> Meta
          </span>
        ) : null}
      </div>
      <div style={{ height }} role="img" aria-label="Histórico mensal do indicador">
        <ResponsiveContainer width="100%" height="100%">
          <ComposedChart data={data} margin={{ top: 8, right: 8, bottom: 0, left: 0 }}>
            <CartesianGrid vertical={false} stroke="var(--color-border)" />
            <XAxis dataKey="label" tick={AXIS} tickLine={false} axisLine={false} />
            <YAxis tick={AXIS} tickLine={false} axisLine={false} width={56} tickFormatter={(v: number) => compactValue(v, unit)} />
            <Tooltip
              cursor={{ fill: "var(--color-surface-hover)" }}
              content={({ active, payload }) => {
                const p = payload?.[0]?.payload as (HistoryPoint & { hasValue: boolean }) | undefined;
                if (!active || !p) return null;
                return (
                  <div className="rounded-md border border-border bg-surface px-3 py-2 text-xs shadow-pop">
                    <p className="mb-1 font-semibold capitalize text-foreground">{p.label}</p>
                    <p className="flex justify-between gap-4 text-muted">
                      Valor <span className="font-medium tabular-nums text-foreground">{formatKpiValue(p.value, unit, suffix)}</span>
                    </p>
                    <p className="flex justify-between gap-4 text-muted">
                      Meta <span className="font-medium tabular-nums text-foreground">{formatKpiValue(p.target, unit, suffix)}</span>
                    </p>
                    {p.attainment !== null ? (
                      <p className="flex justify-between gap-4 text-muted">
                        Atingimento <span className="font-medium tabular-nums text-foreground">{formatPercent(p.attainment)}</span>
                      </p>
                    ) : null}
                    <p className="mt-1 text-[11px] text-muted-light">{p.source === "snapshot" ? "Snapshot gravado" : "Cálculo ao vivo"}</p>
                  </div>
                );
              }}
            />
            <Bar dataKey="bar" radius={[4, 4, 0, 0]} maxBarSize={36} isAnimationActive={false}>
              {data.map((p) => (
                <Cell key={p.period} fill={p.status ? STATUS_COLOR[p.status] : NEUTRAL} fillOpacity={p.hasValue ? (p.source === "ao_vivo" ? 0.85 : 1) : 0} />
              ))}
            </Bar>
            {hasTarget ? <Line type="stepAfter" dataKey="target" stroke={TARGET} strokeWidth={2} strokeDasharray="5 4" dot={false} connectNulls isAnimationActive={false} /> : null}
          </ComposedChart>
        </ResponsiveContainer>
      </div>
      <details className="mt-2 text-xs">
        <summary className="cursor-pointer py-1 text-muted hover:text-foreground">Ver dados do gráfico</summary>
        <table className="mt-2 w-full tabular-nums">
          <thead>
            <tr className="text-left text-muted">
              <th className="py-1 font-medium">Mês</th>
              <th className="py-1 text-right font-medium">Valor</th>
              <th className="py-1 text-right font-medium">Meta</th>
              <th className="py-1 text-right font-medium">Status</th>
            </tr>
          </thead>
          <tbody>
            {points.map((p) => (
              <tr key={p.period} className="border-t border-border">
                <td className="py-1 capitalize">{p.label}</td>
                <td className="py-1 text-right">{formatKpiValue(p.value, unit, suffix)}</td>
                <td className="py-1 text-right">{formatKpiValue(p.target, unit, suffix)}</td>
                <td className="py-1 text-right">{p.status ? STATUS_LABELS[p.status] : "—"}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </details>
    </div>
  );
}
