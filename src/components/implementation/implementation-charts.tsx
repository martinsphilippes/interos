"use client";

import * as React from "react";
import { Bar, BarChart, CartesianGrid, Cell, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import type { ImplementationStatus } from "@/domain/types";
import { formatCompetence } from "@/lib/format";
import { IMPLEMENTATION_STATUS_LABELS } from "@/components/clients/labels";

const AXIS = { fontSize: 11, fill: "var(--color-muted)" } as const;

/** Cor por status: semântica (verde concluído/pronto, âmbar aguardando, vermelho bloqueado, azul em processo). */
const STATUS_COLOR: Record<ImplementationStatus, string> = {
  aguardando_inicio: "var(--color-muted-light)",
  em_implantacao: "var(--color-info)",
  aguardando_cliente: "var(--color-warning)",
  bloqueada: "var(--color-danger)",
  pronta_para_go_live: "var(--color-secondary)",
  concluida: "var(--color-success)",
  cancelada: "var(--color-muted)",
};

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

/** Projetos por status (barras horizontais, uma cor por status). */
export function ProjectsByStatusChart({ data }: { data: { status: ImplementationStatus; count: number }[] }) {
  const rows = data.map((d) => ({ ...d, label: IMPLEMENTATION_STATUS_LABELS[d.status] }));
  if (rows.every((d) => d.count === 0)) return <p className="py-10 text-center text-sm text-muted">Nenhum projeto no escopo.</p>;
  return (
    <div>
      <div className="h-[240px] w-full" role="img" aria-label="Projetos de implantação por status">
        <ResponsiveContainer width="100%" height="100%">
          <BarChart data={rows} layout="vertical" margin={{ top: 4, right: 16, bottom: 4, left: 4 }} barCategoryGap="25%">
            <CartesianGrid horizontal={false} stroke="var(--color-border)" />
            <XAxis type="number" allowDecimals={false} tick={AXIS} axisLine={false} tickLine={false} />
            <YAxis type="category" dataKey="label" tick={AXIS} axisLine={false} tickLine={false} width={128} />
            <Tooltip
              cursor={{ fill: "var(--color-surface-hover)" }}
              content={({ active, payload }) => {
                const d = payload?.[0]?.payload as (typeof rows)[number] | undefined;
                return <ChartTooltip active={active} title={d?.label} rows={d ? [{ label: "Projetos", value: String(d.count), color: STATUS_COLOR[d.status] }] : []} />;
              }}
            />
            <Bar dataKey="count" radius={[0, 4, 4, 0]} maxBarSize={22}>
              {rows.map((d) => (
                <Cell key={d.status} fill={STATUS_COLOR[d.status]} />
              ))}
            </Bar>
          </BarChart>
        </ResponsiveContainer>
      </div>
      <DataTable caption="Ver tabela por status" headers={["Status", "Projetos"]} rows={rows.map((d) => [d.label, String(d.count)])} />
    </div>
  );
}

const ON_TIME = "var(--color-success)";
const LATE = "var(--color-warning)";

/** Go-lives por mês (últimos 6 meses), separando no prazo e fora do prazo. */
export function GoLivesByMonthChart({ data }: { data: { month: string; total: number; onTime: number }[] }) {
  const rows = data.map((d) => ({ ...d, label: formatCompetence(d.month), late: d.total - d.onTime }));
  if (rows.every((d) => d.total === 0)) return <p className="py-10 text-center text-sm text-muted">Nenhum go-live nos últimos 6 meses.</p>;
  return (
    <div>
      <div className="mb-2 flex items-center gap-4 text-xs text-muted" aria-hidden>
        <span className="inline-flex items-center gap-1.5">
          <span className="size-2.5 rounded-sm" style={{ backgroundColor: ON_TIME }} /> No prazo
        </span>
        <span className="inline-flex items-center gap-1.5">
          <span className="size-2.5 rounded-sm" style={{ backgroundColor: LATE }} /> Fora do prazo
        </span>
      </div>
      <div className="h-[216px] w-full" role="img" aria-label="Go-lives por mês nos últimos 6 meses">
        <ResponsiveContainer width="100%" height="100%">
          <BarChart data={rows} margin={{ top: 8, right: 8, bottom: 4, left: 4 }} barCategoryGap="30%">
            <CartesianGrid vertical={false} stroke="var(--color-border)" />
            <XAxis dataKey="label" tick={AXIS} axisLine={false} tickLine={false} />
            <YAxis allowDecimals={false} tick={AXIS} axisLine={false} tickLine={false} width={28} />
            <Tooltip
              cursor={{ fill: "var(--color-surface-hover)" }}
              content={({ active, payload }) => {
                const d = payload?.[0]?.payload as (typeof rows)[number] | undefined;
                return (
                  <ChartTooltip
                    active={active}
                    title={d?.label}
                    rows={d ? [{ label: "No prazo", value: String(d.onTime), color: ON_TIME }, { label: "Fora do prazo", value: String(d.late), color: LATE }, { label: "Total", value: String(d.total) }] : []}
                  />
                );
              }}
            />
            <Bar dataKey="onTime" stackId="g" fill={ON_TIME} maxBarSize={36} />
            <Bar dataKey="late" stackId="g" fill={LATE} radius={[4, 4, 0, 0]} maxBarSize={36} />
          </BarChart>
        </ResponsiveContainer>
      </div>
      <DataTable caption="Ver tabela de go-lives" headers={["Mês", "No prazo", "Fora do prazo", "Total"]} rows={rows.map((d) => [d.label, String(d.onTime), String(d.late), String(d.total)])} />
    </div>
  );
}
