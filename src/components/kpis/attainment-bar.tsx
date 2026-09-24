import { Progress, type ProgressTone } from "@/components/ui/progress";
import { formatPercent } from "@/lib/format";
import { cn } from "@/lib/utils";
import type { KpiStatus } from "@/server/kpis/schemas";

const TONE: Record<KpiStatus, ProgressTone> = { atingida: "success", atencao: "warning", critico: "danger" };

export interface AttainmentBarProps {
  /** Fração (1 = 100%). A barra satura em 100%; o rótulo mostra o valor real. */
  attainment: number | null;
  status: KpiStatus | null;
  size?: "sm" | "md";
  /** Mostra o percentual à direita (padrão: true). */
  showValue?: boolean;
  className?: string;
}

/** Barra de atingimento da meta com a cor do status (verde atingida, âmbar atenção, vermelho crítico). */
export function AttainmentBar({ attainment, status, size = "md", showValue = true, className }: AttainmentBarProps) {
  if (attainment === null) {
    return <p className={cn("text-xs text-muted", className)}>Sem meta para calcular atingimento</p>;
  }
  const pct = Math.max(0, Math.min(100, attainment * 100));
  return (
    <div className={cn("flex items-center gap-2", className)}>
      <Progress value={pct} tone={status ? TONE[status] : "info"} size={size} className="flex-1" aria-label={`Atingimento ${formatPercent(attainment)}`} />
      {showValue ? <span className="w-12 shrink-0 text-right text-xs font-medium tabular-nums text-foreground">{formatPercent(attainment)}</span> : null}
    </div>
  );
}
