import Link from "next/link";
import { PackageCheck } from "lucide-react";
import type { PurchaseReceipt } from "@/domain/types";
import { formatCurrency, formatDate } from "@/lib/format";
import { Badge } from "@/components/ui/badge";
import { Card } from "@/components/ui/card";
import { EmptyState } from "@/components/ui/empty-state";
import { RetryPayableButton } from "./retry-payable-button";

/** Recebimentos: o que entrou no estoque e o título criado em Contas a Pagar. */
export function ReceiptList({ rows, canRetry }: { rows: PurchaseReceipt[]; canRetry: boolean }) {
  if (!rows.length) {
    return (
      <Card>
        <EmptyState icon={<PackageCheck />} title="Nenhum recebimento" description="Cada recebimento de pedido aparece aqui com a entrada no estoque e o título gerado em Contas a Pagar." />
      </Card>
    );
  }
  return (
    <Card className="min-w-0 overflow-hidden">
      <ul className="flex flex-col divide-y divide-border" data-testid="purchase-receipts">
        {rows.map((r) => (
          <li key={r.id} className="flex flex-col gap-1 px-4 py-3 md:flex-row md:items-center md:gap-4">
            <div className="min-w-0 flex-1">
              <p className="flex flex-wrap items-center gap-2 font-medium">
                <Link href={`/compras?aba=pedidos&pedido=${r.orderId}`} className="hover:underline">
                  {r.orderNumber}
                </Link>
                {r.status === "com_erro" ? (
                  <Badge variant="danger" size="sm">
                    Com erro
                  </Badge>
                ) : r.status === "processando" ? (
                  <Badge variant="warning" size="sm">
                    Processando
                  </Badge>
                ) : (
                  <Badge variant="success" size="sm">
                    Concluído
                  </Badge>
                )}
              </p>
              <p className="mt-0.5 break-words text-xs text-muted">
                {formatDate(r.receivedAt)} · {r.supplierName}
                {r.document ? ` · NF ${r.document}` : ""} · {r.createdByName ?? "—"}
                <span className="block">
                  {r.lines.map((l) => `${l.quantity} × ${l.itemName}${l.error ? ` (não entrou: ${l.error})` : ""}`).join(" · ")}
                </span>
                {r.payableError ? <span className="block text-danger-fg">Título não criado: {r.payableError}</span> : null}
              </p>
            </div>
            <div className="text-sm md:w-[200px] md:shrink-0 md:text-right">
              <p className="font-medium tabular-nums">{formatCurrency(r.amount)}</p>
              {r.payableCode ? (
                <Link href="/financeiro/contas-a-pagar" className="text-xs text-brand-fg hover:underline">
                  Título {r.payableCode}
                </Link>
              ) : r.payableError && canRetry && r.lines.some((l) => l.movementId) ? (
                <RetryPayableButton receiptId={r.id} />
              ) : null}
            </div>
          </li>
        ))}
      </ul>
    </Card>
  );
}
