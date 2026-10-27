"use client";

import * as React from "react";
import { CheckCircle2, ChevronDown, PackageCheck, Pencil, Send, ShoppingCart, Undo2, XCircle } from "lucide-react";
import type { PurchaseOrder } from "@/domain/types";
import { approvePurchaseOrderAction, cancelPurchaseOrderAction, receivePurchaseOrderAction, rejectPurchaseOrderAction, submitPurchaseOrderAction } from "@/server/purchases/actions";
import { PURCHASE_STATUS_LABELS, lineRemaining, type PurchaseStatus } from "@/domain/purchases";
import { parseSerials } from "@/domain/stock";
import { formatCurrency, formatDate, formatDateTime } from "@/lib/format";
import { cn } from "@/lib/utils";
import { Badge, type BadgeProps } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Dialog, DialogBody, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { EmptyState } from "@/components/ui/empty-state";
import { FormField } from "@/components/ui/form-field";
import { Input } from "@/components/ui/input";
import { Switch } from "@/components/ui/switch";
import { Textarea } from "@/components/ui/textarea";
import { ReasonDialog } from "@/components/commissions/commission-ui";
import { useFinanceAction } from "@/components/finance/use-finance-action";
import { OrderDialog, type OrderDraft } from "./order-dialog";
import type { PurchasableItem, PurchaseCan, SupplierOption } from "./model";

const VARIANT: Record<PurchaseStatus, NonNullable<BadgeProps["variant"]>> = {
  rascunho: "muted",
  aguardando_aprovacao: "warning",
  aprovado: "info",
  parcial: "warning",
  recebido: "success",
  cancelado: "muted",
};
const OPEN: PurchaseStatus[] = ["rascunho", "aguardando_aprovacao", "aprovado", "parcial"];

/** Pedidos de compra: enviar, aprovar/devolver, receber e cancelar; detalhes com as linhas e o histórico. */
export function OrderList({ orders, items, suppliers, can, focusId }: { orders: PurchaseOrder[]; items: PurchasableItem[]; suppliers: SupplierOption[]; can: PurchaseCan; focusId?: string }) {
  const { pending, run } = useFinanceAction();
  const [showClosed, setShowClosed] = React.useState(false);
  const [open, setOpen] = React.useState<string | null>(focusId ?? null);
  const [editing, setEditing] = React.useState<OrderDraft | null>(null);
  const [receiving, setReceiving] = React.useState<PurchaseOrder | null>(null);
  const [rejecting, setRejecting] = React.useState<PurchaseOrder | null>(null);
  const [cancelling, setCancelling] = React.useState<PurchaseOrder | null>(null);
  const shown = orders.filter((o) => showClosed || OPEN.includes(o.status) || o.id === focusId);
  const closed = orders.length - orders.filter((o) => OPEN.includes(o.status)).length;

  return (
    <>
      <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
        {closed > 0 ? <Switch label={`Mostrar recebidos e cancelados (${closed})`} checked={showClosed} onCheckedChange={setShowClosed} size="sm" /> : <span />}
      </div>
      {shown.length === 0 ? (
        <Card>
          <EmptyState icon={<ShoppingCart />} title="Nenhum pedido em aberto" description="Gere pedidos pela aba Necessidades (falta dos contratos e estoque mínimo) ou um pedido avulso." />
        </Card>
      ) : (
        <Card className="min-w-0 overflow-hidden">
          <ul className="flex flex-col divide-y divide-border" data-testid="purchase-orders">
            {shown.map((o) => {
              const expanded = open === o.id;
              const toReceive = o.lines.reduce((s, l) => s + lineRemaining(l), 0);
              return (
                <li key={o.id} className={cn("px-4 py-3", o.id === focusId && "bg-brand-soft/40")}>
                  <div className="flex flex-col gap-2 lg:flex-row lg:items-center lg:gap-4">
                    <button type="button" className="min-w-0 flex-1 text-left" onClick={() => setOpen(expanded ? null : o.id)} aria-expanded={expanded}>
                      <p className="flex flex-wrap items-center gap-2 font-medium">
                        <ChevronDown className={cn("size-4 text-muted transition-transform", expanded && "rotate-180")} />
                        {o.number}
                        <Badge variant={VARIANT[o.status]} size="sm">
                          {PURCHASE_STATUS_LABELS[o.status]}
                        </Badge>
                        {o.rejectedReason && o.status === "rascunho" ? (
                          <Badge variant="danger" size="sm" title={o.rejectedReason}>
                            Devolvido
                          </Badge>
                        ) : null}
                      </p>
                      <p className="mt-0.5 break-words text-xs text-muted">
                        {o.supplierName} · {o.lines.map((l) => `${l.quantity} × ${l.itemName}`).join(", ")}
                        {o.expectedAt ? ` · chega ${formatDate(o.expectedAt)}` : ""}
                        {o.status === "parcial" ? ` · faltam ${toReceive}` : ""}
                      </p>
                    </button>
                    <p className="font-semibold tabular-nums lg:w-[130px] lg:text-right">{formatCurrency(o.total)}</p>
                    <div className="flex flex-wrap gap-2 lg:w-[330px] lg:shrink-0 lg:justify-end">
                      {o.status === "rascunho" && can.edit ? (
                        <>
                          <Button size="sm" className="h-10 md:h-8" disabled={pending} onClick={() => void run(() => submitPurchaseOrderAction({ orderId: o.id }), (d) => (d.status === "aprovado" ? "Pedido aprovado: pode fazer a compra" : "Pedido enviado para aprovação"))}>
                            <Send /> Enviar
                          </Button>
                          <Button
                            size="sm"
                            variant="ghost"
                            className="h-10 md:h-8"
                            onClick={() =>
                              setEditing({
                                orderId: o.id,
                                number: o.number,
                                supplierId: o.supplierId,
                                supplierName: o.supplierName,
                                lines: o.lines.map((l) => ({ itemId: l.itemId, quantity: l.quantity, unitCost: l.unitCost })),
                                expectedAt: o.expectedAt,
                                paymentDays: o.paymentDays,
                                installments: o.installments,
                                notes: o.notes,
                              })
                            }
                          >
                            <Pencil /> Editar
                          </Button>
                        </>
                      ) : null}
                      {o.status === "aguardando_aprovacao" && can.approve ? (
                        <>
                          <Button size="sm" className="h-10 md:h-8" disabled={pending} onClick={() => void run(() => approvePurchaseOrderAction({ orderId: o.id }), `Pedido ${o.number} aprovado`)}>
                            <CheckCircle2 /> Aprovar
                          </Button>
                          <Button size="sm" variant="ghost" className="h-10 md:h-8" onClick={() => setRejecting(o)}>
                            <Undo2 /> Devolver
                          </Button>
                        </>
                      ) : null}
                      {(o.status === "aprovado" || o.status === "parcial") && can.receive ? (
                        <Button size="sm" className="h-10 md:h-8" onClick={() => setReceiving(o)}>
                          <PackageCheck /> Receber
                        </Button>
                      ) : null}
                      {OPEN.includes(o.status) && can.edit ? (
                        <Button size="sm" variant="ghost" className="h-10 text-danger md:h-8" onClick={() => setCancelling(o)}>
                          <XCircle /> Cancelar
                        </Button>
                      ) : null}
                    </div>
                  </div>
                  {expanded ? (
                    <div className="mt-3 grid gap-3 rounded-lg border border-border bg-surface-muted/50 p-3 text-sm md:grid-cols-2">
                      <div>
                        <p className="label-caps mb-1">Itens</p>
                        <ul className="grid gap-1">
                          {o.lines.map((l) => (
                            <li key={l.itemId} className="flex justify-between gap-2 tabular-nums">
                              <span>{l.itemName}</span>
                              <span className="text-muted">
                                {l.received}/{l.quantity} recebido · {formatCurrency(l.unitCost)}
                              </span>
                            </li>
                          ))}
                        </ul>
                        <p className="mt-2 text-xs text-muted">
                          Pagamento {o.paymentDays} dias após o recebimento{o.installments > 1 ? ` em ${o.installments} parcelas` : ""}
                          {o.approvedByName ? ` · aprovado por ${o.approvedByName}` : ""}
                        </p>
                        {o.rejectedReason ? <p className="mt-1 text-xs text-danger-fg">Devolvido: {o.rejectedReason}</p> : null}
                        {o.cancelReason ? <p className="mt-1 text-xs text-muted">Cancelado: {o.cancelReason}</p> : null}
                        {o.notes ? <p className="mt-1 text-xs text-muted">{o.notes}</p> : null}
                      </div>
                      <div>
                        <p className="label-caps mb-1">Histórico</p>
                        <ul className="grid gap-1 text-xs text-muted">
                          {[...o.history].reverse().map((h, i) => (
                            <li key={i}>
                              {formatDateTime(h.at)} · {h.byName ?? "Sistema"}: {h.action}
                              {h.reason ? ` (${h.reason})` : ""}
                            </li>
                          ))}
                        </ul>
                      </div>
                    </div>
                  ) : null}
                </li>
              );
            })}
          </ul>
        </Card>
      )}

      {editing ? <OrderDialog draft={editing} items={items} suppliers={suppliers} onClose={() => setEditing(null)} /> : null}
      {receiving ? <ReceiveDialog order={receiving} items={items} onClose={() => setReceiving(null)} /> : null}
      <ReasonDialog
        open={rejecting !== null}
        onOpenChange={(o) => !o && setRejecting(null)}
        title="Devolver o pedido sem aprovar?"
        description={rejecting ? `${rejecting.number} · ${formatCurrency(rejecting.total)}. Volta para rascunho com o motivo para quem pediu ajustar.` : undefined}
        placeholder="Ex.: negociar preço, comprar menos unidades, outro fornecedor…"
        confirmLabel="Devolver"
        pending={pending}
        onConfirm={async (reason) => {
          if (!rejecting) return false;
          const ok = await run(() => rejectPurchaseOrderAction({ orderId: rejecting.id, reason }), "Pedido devolvido para ajuste");
          if (ok) setRejecting(null);
          return ok;
        }}
      />
      <ReasonDialog
        open={cancelling !== null}
        onOpenChange={(o) => !o && setCancelling(null)}
        title="Cancelar o pedido?"
        description={cancelling ? `${cancelling.number}. O que já chegou fica no estoque; o restante deixa de ser esperado.` : undefined}
        placeholder="Ex.: fornecedor sem estoque, compra feita em outro pedido…"
        confirmLabel="Cancelar pedido"
        destructive
        pending={pending}
        onConfirm={async (reason) => {
          if (!cancelling) return false;
          const ok = await run(() => cancelPurchaseOrderAction({ orderId: cancelling.id, reason }), "Pedido cancelado");
          if (ok) setCancelling(null);
          return ok;
        }}
      />
    </>
  );
}

const today = () => new Date().toLocaleDateString("sv-SE", { timeZone: "America/Sao_Paulo" });

function ReceiveDialog({ order, items, onClose }: { order: PurchaseOrder; items: PurchasableItem[]; onClose: () => void }) {
  const id = React.useId();
  const { pending, run } = useFinanceAction();
  const byId = new Map(items.map((i) => [i.id, i]));
  const pendingLines = order.lines.filter((l) => lineRemaining(l) > 0);
  const [receivedAt, setReceivedAt] = React.useState(today());
  const [document, setDocument] = React.useState("");
  const [rows, setRows] = React.useState(() => pendingLines.map((l) => ({ itemId: l.itemId, quantity: String(lineRemaining(l)), unitCost: String(l.unitCost.toFixed(2)).replace(".", ","), serials: "" })));
  const set = (i: number, patch: Partial<(typeof rows)[number]>) => setRows((cur) => cur.map((r, j) => (j === i ? { ...r, ...patch } : r)));

  const problems = rows.flatMap((r) => {
    const item = byId.get(r.itemId);
    const q = Number(r.quantity) || 0;
    if (!item?.serialControlled || q === 0) return [];
    const { serials, duplicates } = parseSerials(r.serials);
    if (duplicates.length) return [`${item.name}: série repetida`];
    return serials.length === q ? [] : [`${item.name}: informe ${q} número(s) de série (há ${serials.length})`];
  });

  return (
    <Dialog open onOpenChange={(o) => !o && !pending && onClose()}>
      <DialogContent size="lg">
        <DialogHeader>
          <DialogTitle>Receber {order.number}</DialogTitle>
          <DialogDescription>{order.supplierName}. Entra no estoque (separando para os contratos que esperavam) e cria o título em Contas a Pagar.</DialogDescription>
        </DialogHeader>
        <form
          className="contents"
          onSubmit={(e) => {
            e.preventDefault();
            void run(
              () =>
                receivePurchaseOrderAction({
                  orderId: order.id,
                  receivedAt,
                  document,
                  lines: rows.map((r) => ({ itemId: r.itemId, quantity: r.quantity || "0", unitCost: r.unitCost || "0", serials: byId.get(r.itemId)?.serialControlled ? parseSerials(r.serials).serials : undefined })),
                }),
              (d) =>
                d.failed.length
                  ? `Recebido em parte: ${d.failed.map((f) => `${f.itemName} (${f.error})`).join("; ")}`
                  : d.payableError
                    ? `Entrou no estoque, mas o título não foi criado: ${d.payableError}`
                    : `Recebido: entrada no estoque${d.payableCode ? ` e título ${d.payableCode} criado` : ""}`,
              () => onClose(),
            );
          }}
        >
          <DialogBody className="grid gap-4 py-2">
            <div className="grid gap-3 sm:grid-cols-2">
              <FormField label="Data do recebimento" htmlFor={`${id}-d`}>
                <Input id={`${id}-d`} type="date" value={receivedAt} max={today()} onChange={(e) => setReceivedAt(e.target.value)} className="h-11 md:h-9" />
              </FormField>
              <FormField label="NF do fornecedor" htmlFor={`${id}-nf`}>
                <Input id={`${id}-nf`} value={document} onChange={(e) => setDocument(e.target.value)} className="h-11 md:h-9" maxLength={80} />
              </FormField>
            </div>
            {rows.map((r, i) => {
              const line = pendingLines[i];
              const item = byId.get(r.itemId);
              return (
                <fieldset key={r.itemId} className="grid gap-2 rounded-lg border border-border p-3">
                  <legend className="px-1 text-sm font-medium">
                    {line.itemName} · faltam {lineRemaining(line)}
                  </legend>
                  <div className="grid gap-3 sm:grid-cols-2">
                    <FormField label="Quantidade recebida" htmlFor={`${id}-q${i}`} hint="0 = não chegou">
                      <Input id={`${id}-q${i}`} inputMode="numeric" value={r.quantity} onChange={(e) => set(i, { quantity: e.target.value.replace(/\D/g, "") })} className="h-11 tabular-nums md:h-9" />
                    </FormField>
                    <FormField label="Custo unitário (R$)" htmlFor={`${id}-c${i}`}>
                      <Input id={`${id}-c${i}`} inputMode="decimal" value={r.unitCost} onChange={(e) => set(i, { unitCost: e.target.value })} className="h-11 tabular-nums md:h-9" />
                    </FormField>
                  </div>
                  {item?.serialControlled && Number(r.quantity) > 0 ? (
                    <FormField label="Números de série" htmlFor={`${id}-s${i}`} hint="Um por linha (ou separados por vírgula)">
                      <Textarea id={`${id}-s${i}`} value={r.serials} onChange={(e) => set(i, { serials: e.target.value })} className="min-h-[80px] font-mono" />
                    </FormField>
                  ) : null}
                </fieldset>
              );
            })}
            {problems.length ? <p className="text-sm text-danger-fg">{problems.join(" · ")}</p> : null}
          </DialogBody>
          <DialogFooter>
            <Button type="button" variant="outline" onClick={onClose} disabled={pending} className="h-11 md:h-9">
              Cancelar
            </Button>
            <Button type="submit" loading={pending} disabled={problems.length > 0 || !rows.some((r) => Number(r.quantity) > 0)} className="h-11 md:h-9">
              <PackageCheck /> Registrar recebimento
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
