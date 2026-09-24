"use client";

import * as React from "react";
import { useRouter } from "next/navigation";
import { Bar, BarChart, CartesianGrid, Cell, LabelList, Legend, Line, LineChart, Pie, PieChart, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import { BarChart3 } from "lucide-react";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { EmptyState } from "@/components/ui/empty-state";
import { formatNumber } from "@/lib/format";
import { CHART_COLORS, chartActiveDot, chartAxisTick, chartCategoryTick, chartCursor, chartLegendStyle, chartTooltipItemStyle, chartTooltipLabelStyle, chartTooltipStyle } from "@/lib/chart-theme";
import { TEMPERATURE_COLORS, type MarketingOverview } from "./marketing-model";

/* Séries e tinta de eixos/grade do tema escuro (src/lib/chart-theme.ts). */
const SERIES_1 = CHART_COLORS.secondary;
const SERIES_2 = CHART_COLORS.primary;
const GRID = CHART_COLORS.grid;

/** Recharts entrega o item clicado com os campos do dado e/ou em `payload`, conforme o tipo de gráfico. */
function goTo(router: ReturnType<typeof useRouter>, entry: unknown) {
  const item = entry as { href?: string; payload?: { href?: string } };
  const href = item.payload?.href ?? item.href;
  if (href) router.push(href);
}

function ChartCard({ title, description, empty, children }: { title: string; description?: string; empty: boolean; children: React.ReactNode }) {
  return (
    <Card className="flex flex-col">
      <CardHeader className="pb-1">
        <CardTitle className="text-sm">{title}</CardTitle>
        {description ? <CardDescription className="text-xs">{description}</CardDescription> : null}
      </CardHeader>
      <CardContent className="flex-1 pt-2">{empty ? <EmptyState size="sm" icon={<BarChart3 />} title="Sem leads no período" /> : children}</CardContent>
    </Card>
  );
}

/** Barras horizontais de uma série; cada barra leva à lista de leads filtrada. */
function RankingBars({ data, height }: { data: { name: string; leads: number; href: string }[]; height: number }) {
  const router = useRouter();
  return (
    <div style={{ height }} className="w-full">
      <ResponsiveContainer width="100%" height="100%">
        <BarChart data={data} layout="vertical" margin={{ top: 0, right: 36, bottom: 0, left: 0 }} barCategoryGap={6}>
          <CartesianGrid horizontal={false} stroke={GRID} />
          <XAxis type="number" allowDecimals={false} tick={chartAxisTick} axisLine={false} tickLine={false} />
          <YAxis type="category" dataKey="name" width={150} tick={chartCategoryTick} axisLine={false} tickLine={false} interval={0} />
          <Tooltip cursor={chartCursor} contentStyle={chartTooltipStyle} labelStyle={chartTooltipLabelStyle} itemStyle={chartTooltipItemStyle} formatter={(value) => [formatNumber(Number(value)), "Leads"]} />
          <Bar dataKey="leads" name="Leads" fill={SERIES_1} radius={[0, 4, 4, 0]} maxBarSize={22} className="cursor-pointer" onClick={(entry) => goTo(router, entry)}>
            <LabelList dataKey="leads" position="right" style={{ fontSize: 12, fill: "var(--color-foreground)" }} />
          </Bar>
        </BarChart>
      </ResponsiveContainer>
    </div>
  );
}

export function LeadsByOriginChart({ data }: { data: MarketingOverview["byOrigin"] }) {
  return (
    <ChartCard title="Leads por origem" description="Clique em uma barra para ver os leads" empty={data.length === 0}>
      <RankingBars data={data} height={Math.max(160, data.length * 32)} />
    </ChartCard>
  );
}

export function LeadsByCampaignChart({ data }: { data: MarketingOverview["byCampaign"] }) {
  return (
    <ChartCard title="Leads por campanha" description="Somente leads vinculados a campanhas" empty={data.length === 0}>
      <RankingBars data={data} height={Math.max(160, data.length * 36)} />
    </ChartCard>
  );
}

export function TemperatureDonut({ data }: { data: MarketingOverview["byTemperature"] }) {
  const router = useRouter();
  const total = data.reduce((s, d) => s + d.leads, 0);
  return (
    <ChartCard title="Temperatura dos leads" description="Distribuição dos leads captados" empty={total === 0}>
      <div className="flex flex-col items-center gap-4 sm:flex-row">
        <div className="relative h-[180px] w-[180px] shrink-0">
          <ResponsiveContainer width="100%" height="100%">
            <PieChart>
              <Pie data={data} dataKey="leads" nameKey="name" innerRadius={56} outerRadius={84} paddingAngle={2} stroke="var(--color-surface)" strokeWidth={2} className="cursor-pointer" onClick={(entry) => goTo(router, entry)}>
                {data.map((d) => (
                  <Cell key={d.key} fill={TEMPERATURE_COLORS[d.key]} />
                ))}
              </Pie>
              <Tooltip contentStyle={chartTooltipStyle} labelStyle={chartTooltipLabelStyle} itemStyle={chartTooltipItemStyle} formatter={(value, name) => [formatNumber(Number(value)), String(name)]} />
            </PieChart>
          </ResponsiveContainer>
          <div className="pointer-events-none absolute inset-0 flex flex-col items-center justify-center">
            <span className="text-2xl font-semibold tabular-nums">{formatNumber(total)}</span>
            <span className="text-xs text-muted">leads</span>
          </div>
        </div>
        <ul className="flex w-full flex-col gap-1.5">
          {data.map((d) => (
            <li key={d.key}>
              <button type="button" onClick={() => router.push(d.href)} className="flex min-h-[40px] w-full items-center gap-2 rounded-md px-2 text-sm hover:bg-surface-hover md:min-h-8">
                <span className="size-2.5 shrink-0 rounded-full" style={{ backgroundColor: TEMPERATURE_COLORS[d.key] }} aria-hidden />
                <span className="flex-1 text-left">{d.name}</span>
                <span className="font-medium tabular-nums">{formatNumber(d.leads)}</span>
                <span className="w-12 text-right text-xs tabular-nums text-muted">{total ? Math.round((d.leads / total) * 100) : 0}%</span>
              </button>
            </li>
          ))}
        </ul>
      </div>
    </ChartCard>
  );
}

export function EvolutionChart({ data, bucket }: { data: MarketingOverview["evolution"]; bucket: "dia" | "semana" }) {
  const empty = data.every((d) => d.leads === 0 && d.mqls === 0);
  return (
    <ChartCard title={`Evolução ${bucket === "dia" ? "diária" : "semanal"}`} description="Leads captados e MQLs qualificados" empty={empty}>
      <div className="h-[240px] w-full">
        <ResponsiveContainer width="100%" height="100%">
          <LineChart data={data} margin={{ top: 8, right: 12, bottom: 0, left: -16 }}>
            <CartesianGrid vertical={false} stroke={GRID} />
            <XAxis dataKey="label" tick={chartAxisTick} axisLine={{ stroke: GRID }} tickLine={false} minTickGap={16} />
            <YAxis allowDecimals={false} tick={chartAxisTick} axisLine={false} tickLine={false} />
            <Tooltip contentStyle={chartTooltipStyle} labelStyle={chartTooltipLabelStyle} itemStyle={chartTooltipItemStyle} formatter={(value, name) => [formatNumber(Number(value)), String(name)]} />
            <Legend iconType="circle" iconSize={8} wrapperStyle={chartLegendStyle} />
            <Line type="monotone" dataKey="leads" name="Leads" stroke={SERIES_1} strokeWidth={2} dot={false} activeDot={chartActiveDot(SERIES_1)} />
            <Line type="monotone" dataKey="mqls" name="MQLs" stroke={SERIES_2} strokeWidth={2} dot={false} activeDot={chartActiveDot(SERIES_2)} />
          </LineChart>
        </ResponsiveContainer>
      </div>
    </ChartCard>
  );
}
