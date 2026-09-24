"use client";

import * as React from "react";
import { Bar, BarChart, CartesianGrid, Line, LineChart, ReferenceLine, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import { formatPercent } from "@/lib/format";

/*
 * Paleta validada (scripts/validate_palette.js do guia de dataviz, modo claro): ciano #0891b2 e laranja
 * #e8590c passam banda de luminosidade, croma, separação para daltonismo (ΔE ≥ 19) e contraste ≥ 3:1.
 * Um único eixo por gráfico; a meta é uma linha de referência tracejada em tinta neutra.
 */
const SERIES = { response: "#0891b2", resolution: "#e8590c" } as const;
const AXIS = { fontSize: 11, fill: "var(--color-muted)" } as const;

function ChartTooltip({ active, title, rows }: { active?: boolean; title?: string; rows: { label: string; value: string; color?: string }[] }) {
  if (!active || !title) return null;
  return (
    <div className="rounded-md border border-border bg-surface px-3 py-2 text-xs shadow-pop">
      <p className="mb-1 font-semibold text-foreground">{title}</p>
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

function DataTable({ caption, headers, rows }: { caption: string; headers: string[]; rows: string[][] }) {
  return (
    <details className="mt-2 text-xs">
      <summary className="cursor-pointer py-1 text-muted hover:text-foreground">{caption}</summary>
      <table className="mt-2 w-full tabular-nums">
        <thead>
          <tr className="text-left text-muted">
            {headers.map((h, i) => (
              <th key={h} className={i > 0 ? "py-1 text-right font-medium" : "py-1 font-medium"}>
                {h}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.map((r) => (
            <tr key={r[0]} className="border-t border-border">
              {r.map((c, i) => (
                <td key={i} className={i > 0 ? "py-1 text-right" : "py-1"}>
                  {c}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </details>
  );
}

function Legend({ items }: { items: { label: string; color: string; dashed?: boolean }[] }) {
  return (
    <div className="mb-2 flex flex-wrap items-center gap-x-4 gap-y-1 text-xs text-muted">
      {items.map((i) => (
        <span key={i.label} className="inline-flex items-center gap-1.5">
          <span className="inline-block h-0.5 w-4" style={i.dashed ? { borderTop: `2px dashed ${i.color}` } : { backgroundColor: i.color }} aria-hidden />
          {i.label}
        </span>
      ))}
    </div>
  );
}

const pct = (v: number | undefined) => (v === undefined ? "—" : formatPercent(v));

export interface SlaTrendPoint {
  label: string;
  responsePct?: number;
  resolutionPct?: number;
  opened: number;
  resolved: number;
}

/** Cumprimento de SLA (1ª resposta e solução) nos últimos meses, com a meta de solução. */
export function SlaTrendChart({ data, target }: { data: SlaTrendPoint[]; target: number }) {
  if (data.every((d) => d.responsePct === undefined && d.resolutionPct === undefined)) return <p className="py-10 text-center text-sm text-muted">Sem chamados avaliados no período.</p>;
  const rows = data.map((d) => ({ ...d, response: d.responsePct === undefined ? null : Math.round(d.responsePct * 1000) / 10, resolution: d.resolutionPct === undefined ? null : Math.round(d.resolutionPct * 1000) / 10 }));
  const last = rows[rows.length - 1];
  return (
    <div>
      <Legend
        items={[
          { label: `1ª resposta${last.response !== null ? ` (${last.response.toLocaleString("pt-BR")}% no mês)` : ""}`, color: SERIES.response },
          { label: `Solução${last.resolution !== null ? ` (${last.resolution.toLocaleString("pt-BR")}% no mês)` : ""}`, color: SERIES.resolution },
          { label: `Meta de solução ${formatPercent(target)}`, color: "var(--color-muted)", dashed: true },
        ]}
      />
      <div className="h-[240px] w-full" role="img" aria-label="Cumprimento de SLA de primeira resposta e de solução por mês">
        <ResponsiveContainer width="100%" height="100%">
          <LineChart data={rows} margin={{ top: 8, right: 12, bottom: 4, left: -8 }}>
            <CartesianGrid vertical={false} stroke="var(--color-border)" />
            <XAxis dataKey="label" tick={AXIS} axisLine={false} tickLine={false} />
            <YAxis domain={[0, 100]} tick={AXIS} axisLine={false} tickLine={false} tickFormatter={(v: number) => `${v}%`} width={44} />
            <ReferenceLine y={target * 100} stroke="var(--color-muted)" strokeDasharray="4 4" />
            <Tooltip
              cursor={{ stroke: "var(--color-border-strong)" }}
              content={({ active, payload }) => {
                const p = payload?.[0]?.payload as (typeof rows)[number] | undefined;
                return (
                  <ChartTooltip
                    active={active}
                    title={p?.label}
                    rows={
                      p
                        ? [
                            { label: "1ª resposta", value: pct(p.responsePct), color: SERIES.response },
                            { label: "Solução", value: pct(p.resolutionPct), color: SERIES.resolution },
                            { label: "Abertos / resolvidos", value: `${p.opened} / ${p.resolved}` },
                          ]
                        : []
                    }
                  />
                );
              }}
            />
            <Line type="monotone" dataKey="response" name="1ª resposta" stroke={SERIES.response} strokeWidth={2} dot={{ r: 4, strokeWidth: 2, fill: "var(--color-surface)" }} activeDot={{ r: 5 }} connectNulls />
            <Line type="monotone" dataKey="resolution" name="Solução" stroke={SERIES.resolution} strokeWidth={2} dot={{ r: 4, strokeWidth: 2, fill: "var(--color-surface)" }} activeDot={{ r: 5 }} connectNulls />
          </LineChart>
        </ResponsiveContainer>
      </div>
      <DataTable caption="Ver dados em tabela" headers={["Mês", "1ª resposta", "Solução", "Abertos", "Resolvidos"]} rows={data.map((d) => [d.label, pct(d.responsePct), pct(d.resolutionPct), String(d.opened), String(d.resolved)])} />
    </div>
  );
}

/** CSAT médio por mês (0–10) com a meta. */
export function CsatTrendChart({ data, target }: { data: { label: string; average?: number; count: number }[]; target: number }) {
  if (data.every((d) => d.count === 0)) return <p className="py-10 text-center text-sm text-muted">Nenhuma avaliação no período.</p>;
  const rows = data.map((d) => ({ ...d, value: d.average === undefined ? null : Math.round(d.average * 10) / 10 }));
  const fmt = (v: number | undefined) => (v === undefined ? "—" : v.toFixed(1).replace(".", ","));
  return (
    <div>
      <Legend
        items={[
          { label: "CSAT médio", color: SERIES.response },
          { label: `Meta ${fmt(target)}`, color: "var(--color-muted)", dashed: true },
        ]}
      />
      <div className="h-[220px] w-full" role="img" aria-label="CSAT médio por mês">
        <ResponsiveContainer width="100%" height="100%">
          <BarChart data={rows} margin={{ top: 8, right: 12, bottom: 4, left: -16 }} barCategoryGap="30%">
            <CartesianGrid vertical={false} stroke="var(--color-border)" />
            <XAxis dataKey="label" tick={AXIS} axisLine={false} tickLine={false} />
            <YAxis domain={[0, 10]} ticks={[0, 2, 4, 6, 8, 10]} tick={AXIS} axisLine={false} tickLine={false} width={36} />
            <ReferenceLine y={target} stroke="var(--color-muted)" strokeDasharray="4 4" />
            <Tooltip
              cursor={{ fill: "var(--color-surface-hover)" }}
              content={({ active, payload }) => {
                const p = payload?.[0]?.payload as (typeof rows)[number] | undefined;
                return <ChartTooltip active={active} title={p?.label} rows={p ? [{ label: "CSAT médio", value: fmt(p.average), color: SERIES.response }, { label: "Avaliações", value: String(p.count) }] : []} />;
              }}
            />
            <Bar dataKey="value" name="CSAT médio" fill={SERIES.response} radius={[4, 4, 0, 0]} maxBarSize={40} />
          </BarChart>
        </ResponsiveContainer>
      </div>
      <DataTable caption="Ver dados em tabela" headers={["Mês", "CSAT médio", "Avaliações"]} rows={data.map((d) => [d.label, fmt(d.average), String(d.count)])} />
    </div>
  );
}
