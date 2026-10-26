import Link from "next/link";
import { History, ScanBarcode } from "lucide-react";
import type { StockMovementRow, StockSerialRow } from "@/server/stock/queries";
import { STOCK_MOVEMENT_LABELS, STOCK_SERIAL_STATUS_LABELS, type StockMovementType, type StockSerialStatus } from "@/domain/stock";
import { formatCurrency, formatDate, formatDateTime } from "@/lib/format";
import { Badge, type BadgeProps } from "@/components/ui/badge";
import { Card } from "@/components/ui/card";
import { EmptyState } from "@/components/ui/empty-state";

const MOVE_VARIANT: Record<StockMovementType, NonNullable<BadgeProps["variant"]>> = {
  entrada: "success",
  reserva: "info",
  liberacao: "muted",
  saida: "brand",
  devolucao: "secondary",
  ajuste: "warning",
};

/** Histórico de movimentações (a trilha de auditoria do estoque): quem, quando, quanto e o saldo depois. */
export function StockMovementList({ rows, limit }: { rows: StockMovementRow[]; limit: number }) {
  if (rows.length === 0) {
    return (
      <Card>
        <EmptyState icon={<History />} title="Nenhuma movimentação" description="Entradas, reservas, saídas, devoluções e ajustes aparecem aqui, com o saldo depois de cada uma." />
      </Card>
    );
  }
  return (
    <Card className="min-w-0 overflow-hidden">
      <ul className="flex flex-col divide-y divide-border" data-testid="stock-movements">
        {rows.map((m) => {
          const signed = m.type === "ajuste" ? (m.delta ?? 0) : m.type === "entrada" || m.type === "devolucao" ? m.quantity : m.type === "saida" ? -m.quantity : m.quantity;
          return (
            <li key={m.id} className="flex flex-col gap-1 px-4 py-3 md:flex-row md:items-center md:gap-4">
              <div className="min-w-0 flex-1">
                <p className="flex flex-wrap items-center gap-2 text-sm font-medium">
                  <Badge variant={MOVE_VARIANT[m.type]} size="sm">
                    {STOCK_MOVEMENT_LABELS[m.type]}
                  </Badge>
                  <Link href={`/estoque?item=${m.itemId}`} className="hover:underline">
                    {m.itemName}
                  </Link>
                  {m.automatic ? (
                    <Badge variant="muted" size="sm">
                      automático
                    </Badge>
                  ) : null}
                </p>
                <p className="mt-0.5 break-words text-xs text-muted">
                  {formatDateTime(m.createdAt)} · {m.createdByName ?? "Sistema"}
                  {m.contractNumber ? (
                    <>
                      {" · "}
                      <Link href={`/financeiro/contratos/${m.contractId}`} className="hover:underline">
                        contrato {m.contractNumber}
                      </Link>
                      {m.clientName ? ` (${m.clientName})` : ""}
                    </>
                  ) : null}
                  {m.document ? ` · doc. ${m.document}` : ""}
                  {m.supplier ? ` · ${m.supplier}` : ""}
                  {m.reason ? <span className="block">{m.reason}</span> : null}
                  {m.serials?.length ? <span className="block font-mono">séries: {m.serials.join(", ")}</span> : null}
                </p>
              </div>
              <div className="text-sm md:w-[220px] md:shrink-0 md:text-right">
                <p className="font-medium tabular-nums">
                  {m.type === "reserva" || m.type === "liberacao" ? `${m.type === "reserva" ? "" : "−"}${m.quantity} reservado` : `${signed > 0 ? "+" : ""}${signed}`}
                  {m.unitCost !== null && (m.type === "entrada" || m.type === "saida") ? <span className="text-xs font-normal text-muted"> · {formatCurrency(m.unitCost)} cada</span> : null}
                </p>
                <p className="text-xs text-muted tabular-nums">
                  depois: {m.onHandAfter} em estoque · {m.reservedAfter} reservado
                </p>
              </div>
            </li>
          );
        })}
      </ul>
      {rows.length >= limit ? <p className="border-t border-border px-4 py-2 text-xs text-muted">Mostrando as {limit} mais recentes. Filtre por item para ver o histórico completo dele.</p> : null}
    </Card>
  );
}

const SERIAL_VARIANT: Record<StockSerialStatus, NonNullable<BadgeProps["variant"]>> = {
  em_estoque: "success",
  entregue: "brand",
  baixado: "muted",
};

/** Números de série: onde cada unidade está e com que cliente/contrato. */
export function StockSerialList({ rows }: { rows: StockSerialRow[] }) {
  if (rows.length === 0) {
    return (
      <Card>
        <EmptyState icon={<ScanBarcode />} title="Nenhum número de série" description="Itens que exigem número de série registram cada unidade na entrada; aqui você vê onde cada uma está." />
      </Card>
    );
  }
  return (
    <Card className="min-w-0 overflow-hidden">
      <ul className="flex flex-col divide-y divide-border" data-testid="stock-serials">
        {rows.map((s) => (
          <li key={s.id} className="flex flex-col gap-1 px-4 py-2.5 sm:flex-row sm:items-center sm:gap-4">
            <p className="font-mono text-sm sm:w-[200px] sm:shrink-0">{s.serial}</p>
            <p className="min-w-0 flex-1 text-sm">
              {s.itemName}
              <span className="block text-xs text-muted">
                entrou {formatDate(s.enteredAt)}
                {s.status === "entregue" && s.clientName ? (
                  <>
                    {" · com "}
                    {s.clientId ? (
                      <Link href={`/clientes/${s.clientId}`} className="hover:underline">
                        {s.clientName}
                      </Link>
                    ) : (
                      s.clientName
                    )}
                    {s.contractNumber ? ` (contrato ${s.contractNumber})` : ""}
                    {s.deliveredAt ? ` desde ${formatDate(s.deliveredAt)}` : ""}
                  </>
                ) : null}
                {s.status === "baixado" && s.writeOffReason ? ` · baixado: ${s.writeOffReason}` : ""}
              </span>
            </p>
            <Badge variant={SERIAL_VARIANT[s.status]} size="sm" className="self-start sm:self-center">
              {STOCK_SERIAL_STATUS_LABELS[s.status]}
            </Badge>
          </li>
        ))}
      </ul>
    </Card>
  );
}
