"use client";

import * as React from "react";
import { Bar, CartesianGrid, Cell, ComposedChart, Line, Pie, PieChart, ReferenceLine, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import type { ChurnMetrics } from "@/server/cs/queries";
import { CHURN_REASON_LABELS } from "@/server/cs/schemas";
import { formatCompetence, formatCurrency, formatPercent } from "@/lib/format";
import { chartAxisTick, chartTooltipClassName } from "@/lib/chart-theme";

const AXIS = chartAxisTick;
const REASON_COLORS = ["var(--color-danger)", "var(--color-brand)", "var(--color-warning)", "var(--color-secondary)", "var(--color-info)", "var(--color-accent-purple)", "var(--color-muted-light)"];

function TooltipBox({ title, rows }: { title: string; rows: { label: string; value: string; color?: string }[] }) {
  return (
    <div className={chartTooltipClassName}>
      <p className="mb-1 font-semibold capitalize">{title}</p>
      {rows.map((r) => (
        <p key={r.label} className="flex items-center justify-between gap-4 text-muted">
          <span className="inline-flex items-center gap-1.5">
            {r.color ? <span className="size-2 rounded-full" style={{ backgroundColor: r.color }} aria-hidden /> : null}
            {r.label}
          </span>
          <span className="font-medium tabular-nums text-foreground">{r.value}</span>
        </p>
      ))}
    </div>
  );
}

/** Churn % mensal (linha) e receita perdida (barras), com a meta de referência. */
export function ChurnTrendChart({ months, target }: { months: ChurnMetrics["months"]; target: number }) {
  const data = months.map((m) => ({ label: formatCompetence(m.month), rate: m.rate === null ? null : m.rate * 100, lost: m.lostMrr, m }));
  return (
    <div>
      <div className="h-64 w-full">
        <ResponsiveContainer width="100%" height="100%">
          <ComposedChart data={data} margin={{ top: 8, right: 4, bottom: 0, left: -8 }}>
            <CartesianGrid vertical={false} stroke="var(--color-chart-grid)" strokeDasharray="3 3" />
            <XAxis dataKey="label" tick={AXIS} tickLine={false} axisLine={false} />
            <YAxis yAxisId="rate" tick={AXIS} tickLine={false} axisLine={false} width={44} tickFormatter={(v) => `${v}%`} />
            <YAxis yAxisId="lost" orientation="right" tick={AXIS} tickLine={false} axisLine={false} width={64} tickFormatter={(v) => formatCurrency(v, true)} />
            <ReferenceLine yAxisId="rate" y={target * 100} stroke="var(--color-danger)" strokeDasharray="4 4" label={{ value: `meta ${formatPercent(target)}`, fontSize: 10, fill: "var(--color-danger)", position: "insideTopLeft" }} />
            <Tooltip
              content={({ active, payload }) => {
                const p = payload?.[0]?.payload as (typeof data)[number] | undefined;
                if (!active || !p) return null;
                return (
                  <TooltipBox
                    title={p.label}
                    rows={[
                      { label: "Churn de clientes", value: p.m.rate === null ? "—" : formatPercent(p.m.rate), color: "var(--color-danger)" },
                      { label: "Cancelados / ativos no início", value: `${p.m.cancelledClients} / ${p.m.activeAtStart}` },
                      { label: "Receita perdida", value: formatCurrency(p.m.lostMrr), color: "var(--color-brand)" },
                    ]}
                  />
                );
              }}
            />
            <Bar yAxisId="lost" dataKey="lost" fill="var(--color-brand)" fillOpacity={0.35} radius={[4, 4, 0, 0]} maxBarSize={36} isAnimationActive={false} />
            <Line yAxisId="rate" dataKey="rate" stroke="var(--color-danger)" strokeWidth={2} dot={{ r: 3 }} connectNulls isAnimationActive={false} />
          </ComposedChart>
        </ResponsiveContainer>
      </div>
      <details className="mt-2 text-xs">
        <summary className="cursor-pointer py-1 text-muted hover:text-foreground">Ver tabela</summary>
        <table className="mt-2 w-full tabular-nums">
          <thead>
            <tr className="text-left text-muted">
              <th className="py-1 font-medium">Mês</th>
              <th className="py-1 text-right font-medium">Churn</th>
              <th className="py-1 text-right font-medium">Cancelados</th>
              <th className="py-1 text-right font-medium">Ativos no início</th>
              <th className="py-1 text-right font-medium">Receita perdida</th>
            </tr>
          </thead>
          <tbody>
            {months.map((m) => (
              <tr key={m.month} className="border-t border-border">
                <td className="py-1 capitalize">{formatCompetence(m.month)}</td>
                <td className="py-1 text-right">{m.rate === null ? "—" : formatPercent(m.rate)}</td>
                <td className="py-1 text-right">{m.cancelledClients}</td>
                <td className="py-1 text-right">{m.activeAtStart}</td>
                <td className="py-1 text-right">{formatCurrency(m.lostMrr)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </details>
    </div>
  );
}

/** Motivos de cancelamento (donut) com legenda por quantidade e receita. */
export function ChurnReasonsDonut({ reasons }: { reasons: ChurnMetrics["byReason"] }) {
  const total = reasons.reduce((s, r) => s + r.count, 0);
  if (total === 0) return <p className="py-8 text-center text-sm text-muted">Nenhum cancelamento no período.</p>;
  const data = reasons.map((r, i) => ({ name: CHURN_REASON_LABELS[r.key], value: r.count, lost: r.lostMrr, color: REASON_COLORS[i % REASON_COLORS.length] }));
  return (
    // Container query: o layout depende da largura do card (não da tela). Card estreito → donut em cima, legenda embaixo.
    <div className="@container">
      <div className="flex flex-col items-center gap-4 @md:flex-row">
        <div className="h-44 w-44 shrink-0">
          <ResponsiveContainer width="100%" height="100%">
            <PieChart>
              <Pie data={data} dataKey="value" nameKey="name" innerRadius="58%" outerRadius="95%" paddingAngle={2} stroke="none" isAnimationActive={false}>
                {data.map((d) => (
                  <Cell key={d.name} fill={d.color} />
                ))}
              </Pie>
              <Tooltip content={({ active, payload }) => (active && payload?.[0] ? <TooltipBox title={String(payload[0].name)} rows={[{ label: "Cancelamentos", value: String(payload[0].value) }]} /> : null)} />
            </PieChart>
          </ResponsiveContainer>
        </div>
        <ul className="flex w-full min-w-0 flex-col gap-2 text-sm">
          {data.map((d) => (
            <li key={d.name} className="flex items-start justify-between gap-3">
              <span className="flex min-w-0 items-start gap-2">
                <span className="mt-1.5 size-2.5 shrink-0 rounded-full" style={{ backgroundColor: d.color }} aria-hidden />
                <span className="min-w-0 break-words">{d.name}</span>
              </span>
              <span className="shrink-0 text-right tabular-nums text-muted">
                <span className="whitespace-nowrap">
                  {d.value} · {formatPercent(d.value / total)}
                </span>
                <span className="block whitespace-nowrap">{formatCurrency(d.lost)}</span>
              </span>
            </li>
          ))}
        </ul>
      </div>
    </div>
  );
}
