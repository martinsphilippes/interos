import type { KpiStatus } from "@/server/kpis/schemas";
import { formatNumber } from "@/lib/format";

/** Status visual de um atingimento (mesmos limites padrão do motor: ≥ 100% atingida, ≥ 85% atenção). Puro. */
export function statusFor(attainment: number | null, attentionPct = 85): KpiStatus | null {
  if (attainment === null) return null;
  if (attainment >= 1) return "atingida";
  if (attainment >= attentionPct / 100) return "atencao";
  return "critico";
}

/** Diferença de atingimento em pontos percentuais (0,09 → "9 p.p."). */
export function formatGap(gap: number): string {
  return `${formatNumber(Math.round(gap * 1000) / 10)} p.p.`;
}
