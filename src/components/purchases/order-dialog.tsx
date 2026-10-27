"use client";

import * as React from "react";
import { Plus, Trash2 } from "lucide-react";
import { createPurchaseOrderAction, updatePurchaseOrderAction } from "@/server/purchases/actions";
import { orderTotal } from "@/domain/purchases";
import { parseMoneyInput } from "@/domain/stock";
import { formatCurrency } from "@/lib/format";
import { Button } from "@/components/ui/button";
import { Dialog, DialogBody, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { FormField } from "@/components/ui/form-field";
import { Input } from "@/components/ui/input";
import { Select } from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import { useFinanceAction } from "@/components/finance/use-finance-action";
import type { PurchasableItem, SupplierOption } from "./model";

export interface OrderDraft {
  orderId?: string;
  number?: string;
  supplierId?: string;
  supplierName?: string;
  lines: { itemId: string; quantity: number; unitCost: number }[];
  expectedAt?: string;
  paymentDays: number;
  installments: number;
  notes?: string;
}

const money = (n: number) => (n ? String(n.toFixed(2)).replace(".", ",") : "");

/** Novo pedido (em branco ou a partir das necessidades) ou edição do rascunho. */
export function OrderDialog({ draft, items, suppliers, onClose }: { draft: OrderDraft; items: PurchasableItem[]; suppliers: SupplierOption[]; onClose: () => void }) {
  const id = React.useId();
  const { pending, run } = useFinanceAction();
  const [supplierId, setSupplierId] = React.useState(draft.supplierId ?? "");
  const [supplierName, setSupplierName] = React.useState(draft.supplierId ? "" : (draft.supplierName ?? ""));
  const [lines, setLines] = React.useState(() => draft.lines.map((l) => ({ itemId: l.itemId, quantity: String(l.quantity), unitCost: money(l.unitCost) })));
  const [expectedAt, setExpectedAt] = React.useState(draft.expectedAt ?? "");
  const [paymentDays, setPaymentDays] = React.useState(String(draft.paymentDays));
  const [installments, setInstallments] = React.useState(String(draft.installments));
  const [notes, setNotes] = React.useState(draft.notes ?? "");
  const used = new Set(lines.map((l) => l.itemId));
  const total = orderTotal(lines.map((l) => ({ quantity: Number(l.quantity) || 0, unitCost: parseMoneyInput(l.unitCost) || 0 })));
  const byId = new Map(items.map((i) => [i.id, i]));

  const save = () => {
    const payload = {
      supplierId: supplierId || undefined,
      supplierName: supplierId ? undefined : supplierName,
      lines: lines.filter((l) => l.itemId).map((l) => ({ itemId: l.itemId, quantity: l.quantity, unitCost: l.unitCost || "0" })),
      expectedAt,
      paymentDays,
      installments,
      notes,
    };
    void run(
      () => (draft.orderId ? updatePurchaseOrderAction({ ...payload, orderId: draft.orderId }) : createPurchaseOrderAction(payload)),
      (d) => (d && typeof d === "object" && "number" in d ? `Pedido ${d.number} criado em rascunho: confira e envie` : "Pedido salvo"),
      () => onClose(),
    );
  };

  return (
    <Dialog open onOpenChange={(o) => !o && !pending && onClose()}>
      <DialogContent size="xl">
        <DialogHeader>
          <DialogTitle>{draft.orderId ? `Editar pedido ${draft.number}` : "Novo pedido de compra"}</DialogTitle>
          <DialogDescription>Fica em rascunho até você enviar. Acima do limite configurado, espera a aprovação da diretoria ou do gestor do Administrativo.</DialogDescription>
        </DialogHeader>
        <form
          className="contents"
          onSubmit={(e) => {
            e.preventDefault();
            save();
          }}
        >
          <DialogBody className="grid gap-4 py-2">
            <div className="grid gap-3 sm:grid-cols-2">
              <FormField label="Fornecedor" htmlFor={`${id}-s`} hint={suppliers.length ? "Cadastro de Contas a Pagar › Fornecedores" : "Sem fornecedores cadastrados: digite o nome ao lado"}>
                <Select id={`${id}-s`} value={supplierId} onChange={(e) => setSupplierId(e.target.value)} className="h-11 md:h-9">
                  <option value="">Outro (digitar o nome)</option>
                  {suppliers.map((s) => (
                    <option key={s.id} value={s.id}>
                      {s.name}
                    </option>
                  ))}
                </Select>
              </FormField>
              {!supplierId ? (
                <FormField label="Nome do fornecedor" htmlFor={`${id}-sn`} required>
                  <Input id={`${id}-sn`} value={supplierName} onChange={(e) => setSupplierName(e.target.value)} className="h-11 md:h-9" maxLength={120} />
                </FormField>
              ) : null}
            </div>

            <fieldset className="grid gap-2">
              <legend className="mb-1 text-sm font-medium">Itens</legend>
              {lines.map((l, i) => {
                const item = byId.get(l.itemId);
                return (
                  <div key={i} className="grid grid-cols-[1fr_auto] items-end gap-2 sm:grid-cols-[1fr_110px_140px_auto]">
                    <FormField label={i === 0 ? "Item de estoque" : undefined} htmlFor={`${id}-i${i}`} className="col-span-2 sm:col-span-1">
                      <Select
                        id={`${id}-i${i}`}
                        value={l.itemId}
                        onChange={(e) => {
                          const next = byId.get(e.target.value);
                          setLines((cur) => cur.map((x, j) => (j === i ? { ...x, itemId: e.target.value, unitCost: x.unitCost || money(next?.avgCost ?? 0) } : x)));
                        }}
                        className="h-11 md:h-9"
                      >
                        <option value="">Escolha o item</option>
                        {items
                          .filter((it) => it.id === l.itemId || !used.has(it.id))
                          .map((it) => (
                            <option key={it.id} value={it.id}>
                              {it.name}
                            </option>
                          ))}
                      </Select>
                    </FormField>
                    <FormField label={i === 0 ? `Qtd.${item ? ` (${item.unit})` : ""}` : undefined} htmlFor={`${id}-q${i}`}>
                      <Input
                        id={`${id}-q${i}`}
                        inputMode="numeric"
                        value={l.quantity}
                        onChange={(e) => setLines((cur) => cur.map((x, j) => (j === i ? { ...x, quantity: e.target.value.replace(/\D/g, "") } : x)))}
                        className="h-11 tabular-nums md:h-9"
                      />
                    </FormField>
                    <FormField label={i === 0 ? "Custo unitário (R$)" : undefined} htmlFor={`${id}-c${i}`}>
                      <Input
                        id={`${id}-c${i}`}
                        inputMode="decimal"
                        value={l.unitCost}
                        onChange={(e) => setLines((cur) => cur.map((x, j) => (j === i ? { ...x, unitCost: e.target.value } : x)))}
                        placeholder="0,00"
                        className="h-11 tabular-nums md:h-9"
                      />
                    </FormField>
                    <Button type="button" variant="ghost" size="sm" className="h-11 md:h-9" onClick={() => setLines((cur) => cur.filter((_, j) => j !== i))} aria-label="Remover item" disabled={lines.length === 1}>
                      <Trash2 />
                    </Button>
                  </div>
                );
              })}
              <div className="flex flex-wrap items-center justify-between gap-2">
                <Button type="button" variant="outline" size="sm" className="h-10 md:h-8" onClick={() => setLines((cur) => [...cur, { itemId: "", quantity: "1", unitCost: "" }])} disabled={used.size >= items.length}>
                  <Plus /> Adicionar item
                </Button>
                <p className="text-sm font-medium tabular-nums">Total {formatCurrency(total)}</p>
              </div>
            </fieldset>

            <div className="grid gap-3 sm:grid-cols-3">
              <FormField label="Previsão de chegada" htmlFor={`${id}-e`}>
                <Input id={`${id}-e`} type="date" value={expectedAt} onChange={(e) => setExpectedAt(e.target.value)} className="h-11 md:h-9" />
              </FormField>
              <FormField label="Prazo de pagamento (dias)" htmlFor={`${id}-p`} hint="Contados do recebimento">
                <Input id={`${id}-p`} inputMode="numeric" value={paymentDays} onChange={(e) => setPaymentDays(e.target.value.replace(/\D/g, ""))} className="h-11 tabular-nums md:h-9" />
              </FormField>
              <FormField label="Parcelas" htmlFor={`${id}-n`}>
                <Input id={`${id}-n`} inputMode="numeric" value={installments} onChange={(e) => setInstallments(e.target.value.replace(/\D/g, ""))} className="h-11 tabular-nums md:h-9" />
              </FormField>
            </div>
            <FormField label="Observações" htmlFor={`${id}-o`}>
              <Textarea id={`${id}-o`} value={notes} onChange={(e) => setNotes(e.target.value)} className="min-h-[60px]" maxLength={1000} />
            </FormField>
          </DialogBody>
          <DialogFooter>
            <Button type="button" variant="outline" onClick={onClose} disabled={pending} className="h-11 md:h-9">
              Cancelar
            </Button>
            <Button type="submit" loading={pending} disabled={!lines.some((l) => l.itemId && Number(l.quantity) > 0) || (!supplierId && supplierName.trim().length < 2)} className="h-11 md:h-9">
              {draft.orderId ? "Salvar" : "Criar pedido"}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
