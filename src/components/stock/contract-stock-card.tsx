import Link from "next/link";
import { Package } from "lucide-react";
import type { StockReservationRow } from "@/server/stock/queries";
import { RESERVATION_STATE_LABELS, type ReservationState } from "@/domain/stock";
import { Badge, type BadgeProps } from "@/components/ui/badge";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";

const VARIANT: Record<ReservationState, NonNullable<BadgeProps["variant"]>> = {
  devolucao_pendente: "danger",
  aguardando: "warning",
  parcial: "warning",
  separada: "info",
  atendida: "success",
  cancelada: "muted",
};

/** Equipamentos do contrato no estoque (reservas): separado, entregue, o que falta e devolução pendente. */
export function ContractStockCard({ rows }: { rows: StockReservationRow[] }) {
  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <Package className="size-4 text-muted" /> Equipamentos
        </CardTitle>
        <CardDescription>Reservas do estoque para este contrato.</CardDescription>
      </CardHeader>
      <CardContent className="pt-0">
        <ul className="flex flex-col gap-2 text-sm">
          {rows.map((r) => (
            <li key={r.id} className="flex flex-col gap-0.5">
              <span className="flex flex-wrap items-center gap-2 font-medium">
                {r.itemName}
                <Badge variant={VARIANT[r.state]} size="sm">
                  {RESERVATION_STATE_LABELS[r.state]}
                </Badge>
              </span>
              <span className="text-xs text-muted tabular-nums">
                pedido {r.quantity} · separado {r.reserved} · entregue {r.delivered}
                {r.missing > 0 ? ` · falta ${r.missing}` : ""}
                {r.pendingReturn > 0 ? ` · a devolver ${r.pendingReturn}` : ""}
              </span>
            </li>
          ))}
        </ul>
        <Link href="/estoque?aba=reservas" className="mt-3 inline-block text-xs font-medium text-brand-fg hover:underline">
          Abrir no Estoque
        </Link>
      </CardContent>
    </Card>
  );
}
