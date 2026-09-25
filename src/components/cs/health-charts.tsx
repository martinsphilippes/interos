"use client";

import * as React from "react";
import { CartesianGrid, Line, LineChart, PolarAngleAxis, PolarGrid, PolarRadiusAxis, Radar, RadarChart, ReferenceLine, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import type { HealthScore } from "@/domain/types";
import type { HealthLevel } from "@/domain/constants";
import { formatDate } from "@/lib/format";
import { factorLevel, HEALTH_LEVEL_LABELS } from "@/server/cs/schemas";
import { Progress } from "@/components/ui/progress";
import { chartAxisTick, chartTooltipItemStyle, chartTooltipLabelStyle, chartTooltipStyle } from "@/lib/chart-theme";

const AXIS = chartAxisTick;
const LEVEL_COLOR: Record<HealthLevel, string> = { saudavel: "var(--color-success)", atencao: "var(--color-warning)", risco: "var(--color-danger)" };
const LEVEL_TONE: Record<HealthLevel, "success" | "warning" | "danger"> = { saudavel: "success", atencao: "warning", risco: "danger" };

type Factor = HealthScore["factors"][number];

/** Radar dos fatores (0–100) com a cor do nível do cliente. */
export function FactorRadar({ factors, level }: { factors: Factor[]; level: HealthLevel }) {
  const data = factors.map((f) => ({ label: f.label.replace(" / adoção", ""), value: f.value }));
  return (
    <div className="h-64 w-full" role="img" aria-label={`Radar dos fatores: ${factors.map((f) => `${f.label} ${f.value}`).join(", ")}`}>
      <ResponsiveContainer width="100%" height="100%">
        <RadarChart data={data} outerRadius="72%">
          <PolarGrid stroke="var(--color-chart-grid)" />
          <PolarAngleAxis dataKey="label" tick={{ fontSize: 10, fill: "var(--color-chart-axis)" }} />
          <PolarRadiusAxis domain={[0, 100]} tick={false} axisLine={false} />
          <Radar dataKey="value" stroke={LEVEL_COLOR[level]} fill={LEVEL_COLOR[level]} fillOpacity={0.25} strokeWidth={2} isAnimationActive={false} />
          <Tooltip formatter={(v) => [`${v}/100`, "Valor"]} contentStyle={chartTooltipStyle} labelStyle={chartTooltipLabelStyle} itemStyle={chartTooltipItemStyle} />
        </RadarChart>
      </ResponsiveContainer>
    </div>
  );
}

/** Barras dos fatores com peso, contribuição e nota explicativa. */
export function FactorBars({ factors }: { factors: Factor[] }) {
  return (
    <ul className="flex flex-col gap-3">
      {factors.map((f) => {
        const level = factorLevel(f.value);
        return (
          <li key={f.key}>
            <div className="flex items-baseline justify-between gap-2 text-sm">
              <span className="font-medium">{f.label}</span>
              <span className="shrink-0 text-xs tabular-nums text-muted">
                {f.value}/100 · peso {f.weight}% · +{f.contribution.toFixed(1)} pts
              </span>
            </div>
            <Progress value={f.value} size="sm" tone={LEVEL_TONE[level]} className="mt-1" aria-label={`${f.label}: ${f.value} de 100 (${HEALTH_LEVEL_LABELS[level]})`} />
            {f.note ? <p className="mt-0.5 text-xs text-muted">{f.note}</p> : null}
          </li>
        );
      })}
    </ul>
  );
}

/** Evolução do score nos últimos cálculos, com as faixas de atenção e saudável. */
export function ScoreHistoryChart({ history, limiares }: { history: { computedAt: string; score: number; level: HealthLevel }[]; limiares: { saudavel: number; atencao: number } }) {
  if (history.length < 2) return <p className="text-sm text-muted">O histórico aparece a partir do segundo cálculo.</p>;
  const data = history.map((h) => ({ label: formatDate(h.computedAt, "dd/MM HH:mm"), score: h.score }));
  return (
    <div className="h-44 w-full">
      <ResponsiveContainer width="100%" height="100%">
        <LineChart data={data} margin={{ top: 8, right: 8, bottom: 0, left: -20 }}>
          <CartesianGrid vertical={false} stroke="var(--color-chart-grid)" strokeDasharray="3 3" />
          <XAxis dataKey="label" tick={AXIS} tickLine={false} axisLine={false} minTickGap={24} />
          <YAxis domain={[0, 100]} tick={AXIS} tickLine={false} axisLine={false} width={40} />
          <ReferenceLine y={limiares.saudavel} stroke="var(--color-success)" strokeDasharray="4 4" />
          <ReferenceLine y={limiares.atencao} stroke="var(--color-danger)" strokeDasharray="4 4" />
          <Tooltip formatter={(v) => [v, "Score"]} contentStyle={chartTooltipStyle} labelStyle={chartTooltipLabelStyle} itemStyle={chartTooltipItemStyle} />
          <Line type="monotone" dataKey="score" stroke="var(--color-secondary)" strokeWidth={2} dot={{ r: 3 }} isAnimationActive={false} />
        </LineChart>
      </ResponsiveContainer>
    </div>
  );
}
