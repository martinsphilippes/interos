import { Badge } from "@/components/ui/badge";

/** Selo "Arquivado(a)" com o motivo no title (cadastros não são excluídos). */
export function ArchivedBadge({ reason, label = "Arquivado" }: { reason?: string; label?: string }) {
  return (
    <Badge variant="muted" size="sm" title={reason ? `Motivo: ${reason}` : undefined}>
      {label}
    </Badge>
  );
}
