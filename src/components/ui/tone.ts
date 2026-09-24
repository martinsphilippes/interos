/**
 * Tons semânticos do design system. Um tom nunca é decorativo: comunica estado ou categoria.
 * neutral = sem juízo · brand = destaque/ação · success = positivo/concluído · warning = atenção
 * danger = crítico/atrasado · info = informação/processo · purple = metas/qualidade/conquistas
 * secondary = série secundária/processo (azul-petróleo).
 */
export type Tone = "neutral" | "brand" | "success" | "warning" | "danger" | "info" | "purple" | "secondary";

/** Fundo tingido + cor do ícone (quadrados de ícone, avatares de evento). */
export const toneSoft: Record<Tone, string> = {
  neutral: "bg-surface-hover text-muted",
  brand: "bg-brand-soft text-brand-fg",
  success: "bg-success-soft text-success-fg",
  warning: "bg-warning-soft text-warning-fg",
  danger: "bg-danger-soft text-danger-fg",
  info: "bg-info-soft text-info-fg",
  purple: "bg-accent-purple-soft text-accent-purple-fg",
  secondary: "bg-secondary-soft text-secondary-fg",
};

/** Borda fina tingida (combina com toneSoft). */
export const toneBorder: Record<Tone, string> = {
  neutral: "border-border-strong",
  brand: "border-brand/35",
  success: "border-success/30",
  warning: "border-warning/30",
  danger: "border-danger/35",
  info: "border-info/35",
  purple: "border-accent-purple/35",
  secondary: "border-secondary/35",
};

/** Texto legível sobre fundo escuro. */
export const toneText: Record<Tone, string> = {
  neutral: "text-muted",
  brand: "text-brand-fg",
  success: "text-success-fg",
  warning: "text-warning-fg",
  danger: "text-danger-fg",
  info: "text-info-fg",
  purple: "text-accent-purple-fg",
  secondary: "text-secondary-fg",
};

/** Preenchimento sólido (barras, pontos). */
export const toneSolid: Record<Tone, string> = {
  neutral: "bg-muted-light",
  brand: "bg-brand",
  success: "bg-success",
  warning: "bg-warning",
  danger: "bg-danger",
  info: "bg-info",
  purple: "bg-accent-purple",
  secondary: "bg-secondary",
};

/** Cor CSS (para SVG/recharts). */
export const toneColor: Record<Tone, string> = {
  neutral: "var(--color-muted-light)",
  brand: "var(--color-brand)",
  success: "var(--color-success)",
  warning: "var(--color-warning)",
  danger: "var(--color-danger)",
  info: "var(--color-info)",
  purple: "var(--color-accent-purple)",
  secondary: "var(--color-secondary)",
};

/** Tom por percentual atingido (>= ok: verde; >= warn: âmbar; abaixo: vermelho). */
export function toneForPercent(value: number | null | undefined, ok = 90, warn = 70): Tone {
  if (value === null || value === undefined || Number.isNaN(value)) return "neutral";
  if (value >= ok) return "success";
  if (value >= warn) return "warning";
  return "danger";
}
