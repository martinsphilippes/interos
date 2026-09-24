"use client";

import * as React from "react";
import { Bar, BarChart, CartesianGrid, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import { formatCurrency, formatNumber } from "@/lib/format";
import { chartAxisTick, chartCursor, chartTooltipClassName } from "@/lib/chart-theme";

/**
 * Gráficos da Central de Vendas. Uma série por gráfico (sem legenda: o título nomeia a série),
 * uma cor sóbria do tema, barras finas com ponta arredondada, grade recessiva e tooltip por barra.
 * Cada gráfico tem uma tabela equivalente (details) para leitura sem cor/sem mouse.
 */

const AXIS = chartAxisTick;

interface TooltipRow {
  label: string;
  value: string;
}

function ChartTooltip({ active, title, rows }: { active?: boolean; title?: string; rows: TooltipRow[] }) {
  if (!active || !title) return null;
  return (
    <div className={chartTooltipClassName}>
      <p className="mb-1 font-semibold text-foreground">{title}</p>
      {rows.map((r) => (
        <p key={r.label} className="flex justify-between gap-4 text-muted">
          <span>{r.label}</span>
          <span className="font-medium tabular-nums text-foreground">{r.value}</span>
        </p>
      ))}
    </div>
  );
}

export interface FunnelDatum {
  stage: string;
  label: string;
  count: number;
  monthly: number;
  setup: number;
}

/** Funil por etapa: quantidade de oportunidades (barra) com valor no tooltip. */
export function FunnelChart({ data }: { data: FunnelDatum[] }) {
  const total = data.reduce((s, d) => s + d.count, 0);
  if (total === 0) return <p className="py-10 text-center text-sm text-muted">Nenhuma oportunidade aberta no escopo.</p>;
  return (
    <div>
      <div className="h-[220px] w-full" role="img" aria-label="Funil de oportunidades abertas por etapa">
        <ResponsiveContainer width="100%" height="100%">
          <BarChart data={data} layout="vertical" margin={{ top: 4, right: 16, bottom: 4, left: 4 }} barCategoryGap={6}>
            <CartesianGrid horizontal={false} stroke="var(--color-chart-grid)" strokeDasharray="0" />
            <XAxis type="number" allowDecimals={false} tick={AXIS} axisLine={false} tickLine={false} />
            <YAxis type="category" dataKey="label" width={96} tick={AXIS} axisLine={false} tickLine={false} />
            <Tooltip
              cursor={chartCursor}
              content={({ active, payload }) => {
                const d = payload?.[0]?.payload as FunnelDatum | undefined;
                return (
                  <ChartTooltip
                    active={active}
                    title={d?.label}
                    rows={d ? [{ label: "Oportunidades", value: formatNumber(d.count) }, { label: "Mensal", value: formatCurrency(d.monthly) }, { label: "Adesão", value: formatCurrency(d.setup) }] : []}
                  />
                );
              }}
            />
            <Bar dataKey="count" fill="var(--color-secondary)" radius={[0, 4, 4, 0]} maxBarSize={22} />
          </BarChart>
        </ResponsiveContainer>
      </div>
      <DataTable
        caption="Ver tabela do funil"
        headers={["Etapa", "Qtd.", "Mensal", "Adesão"]}
        rows={data.map((d) => [d.label, formatNumber(d.count), formatCurrency(d.monthly), formatCurrency(d.setup)])}
      />
    </div>
  );
}

export interface WonDatum {
  competence: string;
  label: string;
  count: number;
  monthly: number;
  setup: number;
}

/** Vendas ganhas nos últimos 6 meses: mensalidade vendida (barra) com quantidade e adesão no tooltip. */
export function WonHistoryChart({ data }: { data: WonDatum[] }) {
  if (data.every((d) => d.count === 0)) return <p className="py-10 text-center text-sm text-muted">Nenhuma venda ganha nos últimos 6 meses.</p>;
  return (
    <div>
      <div className="h-[220px] w-full" role="img" aria-label="Mensalidade vendida por mês nos últimos 6 meses">
        <ResponsiveContainer width="100%" height="100%">
          <BarChart data={data} margin={{ top: 8, right: 8, bottom: 4, left: 4 }} barCategoryGap="30%">
            <CartesianGrid vertical={false} stroke="var(--color-chart-grid)" />
            <XAxis dataKey="label" tick={AXIS} axisLine={false} tickLine={false} />
            <YAxis tick={AXIS} axisLine={false} tickLine={false} width={64} tickFormatter={(v: number) => formatCurrency(v, true)} />
            <Tooltip
              cursor={chartCursor}
              content={({ active, payload }) => {
                const d = payload?.[0]?.payload as WonDatum | undefined;
                return (
                  <ChartTooltip
                    active={active}
                    title={d?.label}
                    rows={d ? [{ label: "Mensal vendido", value: formatCurrency(d.monthly) }, { label: "Adesão", value: formatCurrency(d.setup) }, { label: "Vendas", value: formatNumber(d.count) }] : []}
                  />
                );
              }}
            />
            <Bar dataKey="monthly" fill="var(--color-brand)" radius={[4, 4, 0, 0]} maxBarSize={36} />
          </BarChart>
        </ResponsiveContainer>
      </div>
      <DataTable
        caption="Ver tabela de vendas ganhas"
        headers={["Mês", "Vendas", "Mensal", "Adesão"]}
        rows={data.map((d) => [d.label, formatNumber(d.count), formatCurrency(d.monthly), formatCurrency(d.setup)])}
      />
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
