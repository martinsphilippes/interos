"use client";

import * as React from "react";
import { Bar, BarChart, CartesianGrid, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import { formatCurrency, formatPercent } from "@/lib/format";
import { chartAxisTick, chartCursor, chartTooltipClassName } from "@/lib/chart-theme";

/**
 * Gráficos do Financeiro, no mesmo padrão da Central de Vendas: cores do tema, grade recessiva, barras
 * com ponta arredondada, tooltip por categoria e tabela equivalente (details) para leitura sem mouse.
 */

const AXIS = chartAxisTick;

function ChartTooltip({ active, title, rows }: { active?: boolean; title?: string; rows: { label: string; value: string; color?: string }[] }) {
  if (!active || !title) return null;
  return (
    <div className={chartTooltipClassName}>
      <p className="mb-1 font-semibold capitalize text-foreground">{title}</p>
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
                <td key={i} className={i > 0 ? "py-1 text-right" : "py-1 capitalize"}>
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

const BILLED = "var(--color-secondary)";
const RECEIVED = "var(--color-success)";

export interface FlowDatum {
  competence: string;
  label: string;
  billed: number;
  received: number;
}

/** Faturado (competência) x recebido (data do pagamento), últimos 6 meses. */
export function ReceivedBilledChart({ data }: { data: FlowDatum[] }) {
  if (data.every((d) => d.billed === 0 && d.received === 0)) return <p className="py-10 text-center text-sm text-muted">Sem faturamento nos últimos 6 meses.</p>;
  return (
    <div>
      <div className="mb-2 flex items-center gap-4 text-xs text-muted" aria-hidden>
        <span className="inline-flex items-center gap-1.5">
          <span className="size-2.5 rounded-sm" style={{ backgroundColor: BILLED }} /> Faturado
        </span>
        <span className="inline-flex items-center gap-1.5">
          <span className="size-2.5 rounded-sm" style={{ backgroundColor: RECEIVED }} /> Recebido
        </span>
      </div>
      <div className="h-[240px] w-full" role="img" aria-label="Faturado e recebido por mês nos últimos 6 meses">
        <ResponsiveContainer width="100%" height="100%">
          <BarChart data={data} margin={{ top: 8, right: 8, bottom: 4, left: 4 }} barCategoryGap="24%" barGap={3}>
            <CartesianGrid vertical={false} stroke="var(--color-chart-grid)" />
            <XAxis dataKey="label" tick={AXIS} axisLine={false} tickLine={false} />
            <YAxis tick={AXIS} axisLine={false} tickLine={false} width={64} tickFormatter={(v: number) => formatCurrency(v, true)} />
            <Tooltip
              cursor={chartCursor}
              content={({ active, payload }) => {
                const d = payload?.[0]?.payload as FlowDatum | undefined;
                return (
                  <ChartTooltip
                    active={active}
                    title={d?.label}
                    rows={
                      d
                        ? [
                            { label: "Faturado", value: formatCurrency(d.billed), color: BILLED },
                            { label: "Recebido", value: formatCurrency(d.received), color: RECEIVED },
                            { label: "Recebido / faturado", value: d.billed > 0 ? formatPercent(d.received / d.billed) : "—" },
                          ]
                        : []
                    }
                  />
                );
              }}
            />
            <Bar dataKey="billed" name="Faturado" fill={BILLED} radius={[4, 4, 0, 0]} maxBarSize={28} />
            <Bar dataKey="received" name="Recebido" fill={RECEIVED} radius={[4, 4, 0, 0]} maxBarSize={28} />
          </BarChart>
        </ResponsiveContainer>
      </div>
      <DataTable caption="Ver tabela faturado x recebido" headers={["Mês", "Faturado", "Recebido"]} rows={data.map((d) => [d.label, formatCurrency(d.billed), formatCurrency(d.received)])} />
    </div>
  );
}

export interface MrrDatum {
  month: string;
  label: string;
  mrr: number;
  growth: number | null;
}

/** MRR no fim de cada mês (mês corrente = hoje), com a variação mês a mês no tooltip. */
export function MrrHistoryChart({ data }: { data: MrrDatum[] }) {
  if (data.every((d) => d.mrr === 0)) return <p className="py-10 text-center text-sm text-muted">Sem contratos liberados no período.</p>;
  return (
    <div>
      <div className="h-[240px] w-full" role="img" aria-label="MRR por mês nos últimos 8 meses">
        <ResponsiveContainer width="100%" height="100%">
          <BarChart data={data} margin={{ top: 8, right: 8, bottom: 4, left: 4 }} barCategoryGap="30%">
            <CartesianGrid vertical={false} stroke="var(--color-chart-grid)" />
            <XAxis dataKey="label" tick={AXIS} axisLine={false} tickLine={false} />
            <YAxis tick={AXIS} axisLine={false} tickLine={false} width={64} tickFormatter={(v: number) => formatCurrency(v, true)} />
            <Tooltip
              cursor={chartCursor}
              content={({ active, payload }) => {
                const d = payload?.[0]?.payload as MrrDatum | undefined;
                return (
                  <ChartTooltip
                    active={active}
                    title={d?.label}
                    rows={d ? [{ label: "MRR", value: formatCurrency(d.mrr) }, { label: "Variação no mês", value: d.growth === null ? "—" : `${d.growth >= 0 ? "+" : ""}${formatPercent(d.growth)}` }] : []}
                  />
                );
              }}
            />
            <Bar dataKey="mrr" fill="var(--color-brand)" radius={[4, 4, 0, 0]} maxBarSize={36} />
          </BarChart>
        </ResponsiveContainer>
      </div>
      <DataTable
        caption="Ver tabela de MRR"
        headers={["Mês", "MRR", "Variação"]}
        rows={data.map((d) => [d.label, formatCurrency(d.mrr), d.growth === null ? "—" : `${d.growth >= 0 ? "+" : ""}${formatPercent(d.growth)}`])}
      />
    </div>
  );
}
