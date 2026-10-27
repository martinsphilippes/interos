"use client";

import * as React from "react";
import Link from "next/link";
import { ClipboardCheck, ShoppingCart } from "lucide-react";
import type { PurchaseNeedRow } from "@/server/purchases/service";
import { formatCurrency } from "@/lib/format";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Checkbox } from "@/components/ui/checkbox";
import { EmptyState } from "@/components/ui/empty-state";
import { Input } from "@/components/ui/input";
import { OrderDialog, type OrderDraft } from "./order-dialog";
import type { PurchasableItem, PurchaseCan, SupplierOption } from "./model";

/**
 * Necessidades de compra: por item, a falta dos contratos + o mínimo, menos o disponível e o já pedido. Marque os
 * itens, ajuste as quantidades e gere o pedido (um fornecedor por pedido).
 */
export function NeedsList({ rows, items, suppliers, can, paymentDays }: { rows: PurchaseNeedRow[]; items: PurchasableItem[]; suppliers: SupplierOption[]; can: PurchaseCan; paymentDays: number }) {
  const needed = rows.filter((r) => r.suggested > 0);
  const [picked, setPicked] = React.useState<Record<string, string>>(() => Object.fromEntries(needed.map((r) => [r.itemId, String(r.suggested)])));
  const [draft, setDraft] = React.useState<OrderDraft | null>(null);
  const chosen = needed.filter((r) => picked[r.itemId] !== undefined && Number(picked[r.itemId]) > 0);

  if (!needed.length) {
    return (
      <Card>
        <EmptyState
          icon={<ClipboardCheck />}
          title="Nada a comprar agora"
          description="Nenhum contrato está com equipamento em falta e nenhum item está abaixo do mínimo (contando o que já foi pedido)."
          action={
            can.edit ? (
              <Button onClick={() => setDraft({ lines: [{ itemId: "", quantity: 1, unitCost: 0 }], paymentDays, installments: 1 })} className="h-11 md:h-9">
                <ShoppingCart /> Pedido avulso
              </Button>
            ) : undefined
          }
        />
        {draft ? <OrderDialog draft={draft} items={items} suppliers={suppliers} onClose={() => setDraft(null)} /> : null}
      </Card>
    );
  }

  return (
    <>
      <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
        <p className="text-sm text-muted">
          {needed.length} item(ns) a comprar · marque, ajuste a quantidade e gere o pedido para um fornecedor.
        </p>
        {can.edit ? (
          <div className="flex flex-wrap gap-2">
            <Button variant="outline" onClick={() => setDraft({ lines: [{ itemId: "", quantity: 1, unitCost: 0 }], paymentDays, installments: 1 })} className="h-11 md:h-9">
              Pedido avulso
            </Button>
            <Button
              disabled={!chosen.length}
              onClick={() =>
                setDraft({
                  lines: chosen.map((r) => ({ itemId: r.itemId, quantity: Number(picked[r.itemId]), unitCost: r.avgCost })),
                  paymentDays,
                  installments: 1,
                })
              }
              className="h-11 md:h-9"
            >
              <ShoppingCart /> Gerar pedido ({chosen.length})
            </Button>
          </div>
        ) : null}
      </div>
      <Card className="min-w-0 overflow-hidden">
        <ul className="flex flex-col divide-y divide-border" data-testid="purchase-needs">
          {needed.map((r) => {
            const on = picked[r.itemId] !== undefined;
            return (
              <li key={r.itemId} className="flex flex-col gap-2 px-4 py-3 md:flex-row md:items-center md:gap-4">
                {can.edit ? (
                  <Checkbox
                    checked={on}
                    aria-label={`Incluir ${r.name}`}
                    onCheckedChange={(v) =>
                      setPicked((cur) => {
                        const next = { ...cur };
                        if (v) next[r.itemId] = String(r.suggested);
                        else delete next[r.itemId];
                        return next;
                      })
                    }
                  />
                ) : null}
                <div className="min-w-0 flex-1">
                  <p className="flex flex-wrap items-center gap-2 font-medium">
                    <Link href={`/estoque?item=${r.itemId}`} className="hover:underline">
                      {r.name}
                    </Link>
                    {r.reasons.includes("contratos") ? (
                      <Badge variant="danger" size="sm">
                        Contratos esperando
                      </Badge>
                    ) : null}
                    {r.reasons.includes("minimo") ? (
                      <Badge variant="warning" size="sm">
                        Abaixo do mínimo
                      </Badge>
                    ) : null}
                  </p>
                  <p className="mt-0.5 break-words text-xs text-muted">
                    disponível {r.available} · mínimo {r.minQuantity} · já pedido {r.ordered}
                    {r.contracts.length ? <span className="block">Falta para: {r.contracts.map((c) => `${c.contractNumber} (${c.clientName}) ${c.missing}`).join(" · ")}</span> : null}
                  </p>
                </div>
                <div className="flex items-center gap-3 text-sm md:w-[260px] md:shrink-0 md:justify-end">
                  <span className="text-xs text-muted tabular-nums">custo médio {formatCurrency(r.avgCost)}</span>
                  {can.edit ? (
                    <Input
                      aria-label={`Quantidade de ${r.name}`}
                      inputMode="numeric"
                      value={picked[r.itemId] ?? String(r.suggested)}
                      disabled={!on}
                      onChange={(e) => setPicked((cur) => ({ ...cur, [r.itemId]: e.target.value.replace(/\D/g, "") }))}
                      className="h-11 w-[90px] tabular-nums md:h-9"
                    />
                  ) : (
                    <span className="font-semibold tabular-nums">
                      {r.suggested} {r.unit}
                    </span>
                  )}
                </div>
              </li>
            );
          })}
        </ul>
      </Card>
      {draft ? <OrderDialog draft={draft} items={items} suppliers={suppliers} onClose={() => setDraft(null)} /> : null}
    </>
  );
}
