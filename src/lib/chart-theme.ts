import type * as React from "react";

/**
 * Tema dos gráficos (recharts) no design system escuro: linhas finas sobre grade escura, eixos em tinta
 * recessiva, tooltip escuro com borda fina. Todas as cores são variáveis CSS de src/app/globals.css.
 *
 * Uso típico:
 *   <CartesianGrid vertical={false} {...chartGridProps} />
 *   <XAxis dataKey="label" tick={chartAxisTick} axisLine={false} tickLine={false} />
 *   <Tooltip contentStyle={chartTooltipStyle} labelStyle={chartTooltipLabelStyle} itemStyle={chartTooltipItemStyle} cursor={chartCursor} />
 *   <Line stroke={CHART_SERIES[0]} strokeWidth={2} dot={chartDot(CHART_SERIES[0])} activeDot={chartActiveDot(CHART_SERIES[0])} />
 */

/** Paleta categórica em ordem de uso (laranja, azul, verde, roxo, âmbar, petróleo, rosa). */
export const CHART_SERIES = [
  "var(--color-brand)",
  "var(--color-info)",
  "var(--color-success)",
  "var(--color-accent-purple)",
  "var(--color-warning)",
  "var(--color-secondary)",
  "#f472b6",
] as const;

/** Cores com função (não use para categorias arbitrárias). */
export const CHART_COLORS = {
  primary: "var(--color-brand)",
  secondary: "var(--color-info)",
  positive: "var(--color-success)",
  attention: "var(--color-warning)",
  negative: "var(--color-danger)",
  goal: "var(--color-muted)",
  neutral: "var(--color-muted-light)",
  grid: "var(--color-chart-grid)",
  axis: "var(--color-chart-axis)",
  surface: "var(--color-surface)",
  foreground: "var(--color-foreground)",
} as const;

/** Tick dos eixos (11px, tinta recessiva). */
export const chartAxisTick = { fontSize: 11, fill: "var(--color-chart-axis)" } as const;

/** Tick de categoria com texto mais legível (ex.: eixo Y de barras horizontais). */
export const chartCategoryTick = { fontSize: 12, fill: "var(--color-foreground)" } as const;

/** Props da grade (<CartesianGrid {...chartGridProps} />). */
export const chartGridProps = { stroke: "var(--color-chart-grid)", strokeDasharray: "3 4" } as const;

/** Cursor do Tooltip: faixa translúcida em barras, linha fina em séries. */
export const chartCursor = { fill: "rgb(148 163 186 / 0.08)" } as const;
export const chartLineCursor = { stroke: "var(--color-border-strong)", strokeWidth: 1 } as const;

/** Tooltip padrão do recharts (contentStyle) no escuro. */
export const chartTooltipStyle: React.CSSProperties = {
  background: "var(--color-card-elevated)",
  border: "1px solid var(--color-border-strong)",
  borderRadius: 8,
  color: "var(--color-foreground)",
  fontSize: 12,
  boxShadow: "0 16px 40px -12px rgb(0 0 0 / 0.7)",
  padding: "8px 12px",
};
export const chartTooltipLabelStyle: React.CSSProperties = { color: "var(--color-foreground)", fontWeight: 600, marginBottom: 4 };
export const chartTooltipItemStyle: React.CSSProperties = { color: "var(--color-foreground)", padding: 0 };

/** Legenda do recharts. */
export const chartLegendStyle: React.CSSProperties = { fontSize: 12, color: "var(--color-muted)" };

/** Classe para tooltips customizados (content={...}) em JSX. */
export const chartTooltipClassName = "rounded-md border border-border-strong bg-card-elevated px-3 py-2 text-xs text-foreground shadow-pop";

/** Ponto das séries: preenchido com a superfície e contornado pela cor da série. */
export function chartDot(color: string, r = 3.5) {
  return { r, strokeWidth: 2, stroke: color, fill: "var(--color-surface)" };
}
export function chartActiveDot(color: string, r = 5) {
  return { r, strokeWidth: 2, stroke: "var(--color-surface)", fill: color };
}
