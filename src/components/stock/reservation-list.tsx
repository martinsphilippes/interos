"use client";

import * as React from "react";
import Link from "next/link";
import { ArrowUpFromLine, ClipboardList, PackageCheck, PackagePlus, Undo2, XCircle } from "lucide-react";
import type { StockReservationRow } from "@/server/stock/queries";
import { fillReservationAction, releaseReservationAction, reserveContractAction } from "@/server/stock/actions";
import { RESERVATION_STATE_LABELS, STOCK_ORIGIN_LABELS, type ReservationState } from "@/domain/stock";
import { formatDate } from "@/lib/format";
import { cn } from "@/lib/utils";
import { Badge, type BadgeProps } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { EmptyState } from "@/components/ui/empty-state";
import { Input } from "@/components/ui/input";
import { Switch } from "@/components/ui/switch";
import { ReasonDialog } from "@/components/commissions/commission-ui";
import { useFinanceAction } from "@/components/finance/use-finance-action";
import { MovementDialog, type MovementTarget } from "./movement-dialog";
import type { StockCan } from "./model";

const STATE_VARIANT: Record<ReservationState, NonNullable<BadgeProps["variant"]>> = {
  devolucao_pendente: "danger",
  aguardando: "warning",
  parcial: "warning",
  separada: "info",
  atendida: "success",
  cancelada: "muted",
};

const OPEN: ReservationState[] = ["devolucao_pendente", "aguardando", "parcial", "separada"];

/**
 * Reservas por contrato: o que cada contrato assinado pediu, o que já está separado, o que falta (comprar/repor), a
 * saída para a entrega e a devolução do que voltou (inclusive de contrato cancelado).
 */
export function StockReservationList({ rows, can }: { rows: StockReservationRow[]; can: StockCan }) {
  const { pending, run } = useFinanceAction();
  const [showClosed, setShowClosed] = React.useState(false);
  const [contractNumber, setContractNumber] = React.useState("");
  const [releasing, setReleasing] = React.useState<StockReservationRow | null>(null);
  const [moving, setMoving] = React.useState<MovementTarget | null>(null);
  const shown = rows.filter((r) => showClosed || OPEN.includes(r.state));
  const closed = rows.length - rows.filter((r) => OPEN.includes(r.state)).length;

  const move = (mode: "saida" | "devolucao", r: StockReservationRow) =>
    setMoving({
      mode,
      item: { id: r.itemId, name: r.itemName, unit: r.unit, serialControlled: r.serialControlled, onHand: r.itemOnHand, reserved: r.itemReserved, available: r.itemAvailable },
      reservation: {
        id: r.id,
        contractNumber: r.contractNumber,
        clientName: r.clientName,
        toDeliver: Math.max(1, Math.min(r.quantity - r.delivered, r.reserved || r.quantity - r.delivered)),
        outstanding: Math.max(1, r.delivered - r.returned),
      },
    });

  return (
    <>
      <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
        {closed > 0 ? <Switch label={`Mostrar entregues e canceladas (${closed})`} checked={showClosed} onCheckedChange={setShowClosed} size="sm" /> : <span />}
        {can.reservations ? (
          <form
            className="flex flex-wrap items-center gap-2"
            onSubmit={(e) => {
              e.preventDefault();
              void run(
                () => reserveContractAction({ contractNumber }),
                (d) => `Reservado: ${d.created.map((c) => `${c.itemName} ${c.reserved}/${c.quantity}`).join(", ")}`,
                () => setContractNumber(""),
              );
            }}
          >
            <Input
              value={contractNumber}
              onChange={(e) => setContractNumber(e.target.value)}
              placeholder="Nº do contrato"
              aria-label="Número do contrato para reservar"
              className="h-11 w-[180px] md:h-9"
              maxLength={40}
            />
            <Button type="submit" variant="outline" loading={pending} disabled={contractNumber.trim().length < 3} className="h-11 md:h-9" title="Reserva os equipamentos de um contrato já assinado">
              <PackagePlus /> Reservar pelo contrato
            </Button>
          </form>
        ) : null}
      </div>

      {shown.length === 0 ? (
        <Card>
          <EmptyState
            icon={<ClipboardList />}
            title="Nenhuma reserva em aberto"
            description="Quando um contrato com equipamento é assinado, os itens vinculados aos produtos do contrato aparecem aqui: separados do estoque ou aguardando compra."
          />
        </Card>
      ) : (
        <Card className="min-w-0 overflow-hidden">
          <ul className="flex flex-col divide-y divide-border" data-testid="stock-reservations">
            {shown.map((r) => {
              const open = r.state !== "cancelada" && r.state !== "atendida" && r.state !== "devolucao_pendente";
              return (
                <li key={r.id} className={cn("flex flex-col gap-2 px-4 py-3 lg:flex-row lg:items-center lg:gap-4", (r.state === "cancelada" || r.state === "atendida") && "opacity-70")}>
                  <div className="min-w-0 flex-1">
                    <p className="flex flex-wrap items-center gap-2 font-medium">
                      {r.itemName}
                      <Badge variant={STATE_VARIANT[r.state]} size="sm">
                        {RESERVATION_STATE_LABELS[r.state]}
                      </Badge>
                      {r.missing > 0 ? (
                        <Badge variant={r.origin === "estoque" ? "warning" : "info"} size="sm" title={STOCK_ORIGIN_LABELS[r.origin]}>
                          {r.origin === "estoque" ? `Falta ${r.missing}` : `Comprar ${r.missing}`}
                        </Badge>
                      ) : null}
                    </p>
                    <p className="mt-0.5 break-words text-xs text-muted">
                      <Link href={`/clientes/${r.clientId}`} className="hover:underline">
                        {r.clientName}
                      </Link>{" "}
                      ·{" "}
                      <Link href={`/financeiro/contratos/${r.contractId}`} className="hover:underline">
                        contrato {r.contractNumber}
                      </Link>{" "}
                      · {r.source === "manual" ? "reserva manual" : "reservado na assinatura"} em {formatDate(r.createdAt)}
                      {r.cancelReason ? <span className="block">{r.cancelReason}</span> : null}
                    </p>
                  </div>
                  <dl className="grid grid-cols-4 gap-3 text-center text-sm lg:w-[320px] lg:shrink-0">
                    <div>
                      <dt className="text-xs text-muted">Pedido</dt>
                      <dd className="tabular-nums">{r.quantity}</dd>
                    </div>
                    <div>
                      <dt className="text-xs text-muted">Separado</dt>
                      <dd className="font-medium tabular-nums">{r.reserved}</dd>
                    </div>
                    <div>
                      <dt className="text-xs text-muted">Entregue</dt>
                      <dd className="tabular-nums">{r.delivered}</dd>
                    </div>
                    <div>
                      <dt className="text-xs text-muted">{r.pendingReturn > 0 ? "A devolver" : "Devolvido"}</dt>
                      <dd className={cn("tabular-nums", r.pendingReturn > 0 && "font-semibold text-danger-fg")}>{r.pendingReturn > 0 ? r.pendingReturn : r.returned}</dd>
                    </div>
                  </dl>
                  <div className="flex flex-wrap gap-2 lg:w-[300px] lg:shrink-0 lg:justify-end">
                    {open && can.reservations && r.missing > 0 && r.itemAvailable > 0 ? (
                      <Button
                        size="sm"
                        variant="outline"
                        className="h-10 md:h-8"
                        disabled={pending}
                        onClick={() => void run(() => fillReservationAction({ reservationId: r.id }), (d) => `${d.added} unidade(s) separada(s)`)}
                        title={`${r.itemAvailable} disponível(is)`}
                      >
                        <PackageCheck /> Separar
                      </Button>
                    ) : null}
                    {open && can.exit && (r.reserved > 0 || r.itemAvailable > 0) ? (
                      <Button size="sm" variant={r.reserved > 0 ? "primary" : "outline"} className="h-10 md:h-8" onClick={() => move("saida", r)}>
                        <ArrowUpFromLine /> Dar saída
                      </Button>
                    ) : null}
                    {can.exit && r.delivered - r.returned > 0 ? (
                      <Button size="sm" variant={r.pendingReturn > 0 ? "primary" : "ghost"} className="h-10 md:h-8" onClick={() => move("devolucao", r)}>
                        <Undo2 /> Devolução
                      </Button>
                    ) : null}
                    {open && can.reservations ? (
                      <Button size="sm" variant="ghost" className="h-10 text-danger md:h-8" onClick={() => setReleasing(r)}>
                        <XCircle /> Liberar
                      </Button>
                    ) : null}
                  </div>
                </li>
              );
            })}
          </ul>
        </Card>
      )}

      <ReasonDialog
        open={releasing !== null}
        onOpenChange={(o) => !o && setReleasing(null)}
        title="Liberar esta reserva?"
        description={releasing ? `${releasing.itemName} · contrato ${releasing.contractNumber}. O separado volta ao disponível; o que já foi entregue fica com o cliente. Dá para reservar de novo pelo número do contrato.` : undefined}
        placeholder="Ex.: cliente desistiu do equipamento, item trocado por outro modelo…"
        confirmLabel="Liberar reserva"
        destructive
        pending={pending}
        onConfirm={async (reason) => {
          if (!releasing) return false;
          const ok = await run(() => releaseReservationAction({ reservationId: releasing.id, reason }), "Reserva liberada");
          if (ok) setReleasing(null);
          return ok;
        }}
      />
      {moving ? <MovementDialog target={moving} showCost={can.costs} onClose={() => setMoving(null)} /> : null}
    </>
  );
}
