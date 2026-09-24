import { CheckCircle2, AlertTriangle, XCircle, MinusCircle } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { STATUS_LABELS, type KpiStatus } from "@/server/kpis/schemas";

const VARIANT: Record<KpiStatus, "success" | "warning" | "danger"> = { atingida: "success", atencao: "warning", critico: "danger" };
const ICON: Record<KpiStatus, React.ReactNode> = { atingida: <CheckCircle2 aria-hidden />, atencao: <AlertTriangle aria-hidden />, critico: <XCircle aria-hidden /> };

/** Status semântico do indicador (Atingida / Atenção / Crítico); sem meta mostra "Sem meta". */
export function KpiStatusBadge({ status, size = "sm", noData, className }: { status: KpiStatus | null; size?: "sm" | "md"; noData?: boolean; className?: string }) {
  if (!status) {
    return (
      <Badge variant="muted" size={size} className={className}>
        <MinusCircle aria-hidden /> {noData ? "Sem dados" : "Sem meta"}
      </Badge>
    );
  }
  return (
    <Badge variant={VARIANT[status]} size={size} className={className}>
      {ICON[status]} {STATUS_LABELS[status]}
    </Badge>
  );
}
