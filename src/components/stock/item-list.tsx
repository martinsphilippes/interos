"use client";

import * as React from "react";
import { ArrowDownToLine, ArrowUpFromLine, Package, Pencil, Plus, Scale, Trash2, Undo2 } from "lucide-react";
import type { LinkableProduct, StockItemRow } from "@/server/stock/queries";
import { saveStockItemAction } from "@/server/stock/actions";
import { STOCK_ORIGIN_HINTS, STOCK_ORIGIN_LABELS, STOCK_ORIGINS, type StockOrigin } from "@/domain/stock";
import { formatCurrency } from "@/lib/format";
import { cn } from "@/lib/utils";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Dialog, DialogBody, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { EmptyState } from "@/components/ui/empty-state";
import { FormField } from "@/components/ui/form-field";
import { Input } from "@/components/ui/input";
import { Select } from "@/components/ui/select";
import { Switch } from "@/components/ui/switch";
import { Textarea } from "@/components/ui/textarea";
import { useFinanceAction } from "@/components/finance/use-finance-action";
import { MovementDialog, type MovementMode, type MovementTarget } from "./movement-dialog";
import type { StockCan } from "./model";

/** Itens de estoque: saldo (em mãos, reservado, disponível), mínimo, falta nas reservas e os botões de movimentação. */
export function StockItemList({ rows, products, can, focusId }: { rows: StockItemRow[]; products: LinkableProduct[]; can: StockCan; focusId?: string }) {
  const [editing, setEditing] = React.useState<StockItemRow | "new" | null>(null);
  const [moving, setMoving] = React.useState<MovementTarget | null>(null);
  const [showInactive, setShowInactive] = React.useState(false);
  const shown = rows.filter((r) => showInactive || r.active || r.id === focusId);
  const inactive = rows.length - rows.filter((r) => r.active).length;

  const move = (mode: MovementMode, r: StockItemRow) =>
    setMoving({ mode, item: { id: r.id, name: r.name, unit: r.unit, serialControlled: r.serialControlled, onHand: r.onHand, reserved: r.reserved, available: r.available } });

  return (
    <>
      <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
        {inactive > 0 ? (
          <Switch label={`Mostrar desativados (${inactive})`} checked={showInactive} onCheckedChange={setShowInactive} size="sm" />
        ) : (
          <span />
        )}
        {can.editItems ? (
          <Button onClick={() => setEditing("new")} className="h-11 md:h-9">
            <Plus /> Novo item
          </Button>
        ) : null}
      </div>

      {shown.length === 0 ? (
        <Card>
          <EmptyState
            icon={<Package />}
            title="Nenhum item de estoque"
            description="Cadastre os equipamentos que a empresa vende ou entrega (fabricante, modelo, se exige número de série) e vincule aos produtos: a assinatura do contrato passa a reservar automaticamente."
          />
        </Card>
      ) : (
        <Card className="min-w-0 overflow-hidden">
          <ul className="flex flex-col divide-y divide-border" data-testid="stock-items">
            {shown.map((r) => (
              <li key={r.id} id={`item-${r.id}`} className={cn("flex flex-col gap-3 px-4 py-3 lg:flex-row lg:items-center lg:gap-4", !r.active && "opacity-60", r.id === focusId && "bg-brand-soft/40")}>
                <div className="min-w-0 flex-1">
                  <p className="flex flex-wrap items-center gap-2 font-medium">
                    {r.name}
                    {r.sku ? <span className="font-mono text-xs text-muted">{r.sku}</span> : null}
                    {r.belowMinimum ? (
                      <Badge variant="warning" size="sm" title={`Mínimo ${r.minQuantity}`}>
                        Abaixo do mínimo
                      </Badge>
                    ) : null}
                    {r.missing > 0 ? (
                      <Badge variant="danger" size="sm" title="Falta nas reservas de contratos">
                        Falta {r.missing}
                      </Badge>
                    ) : null}
                    {!r.active ? (
                      <Badge variant="muted" size="sm">
                        Desativado
                      </Badge>
                    ) : null}
                  </p>
                  <p className="mt-0.5 break-words text-xs text-muted">
                    {[r.manufacturer, r.model].filter(Boolean).join(" · ") || "Sem fabricante/modelo"} · {STOCK_ORIGIN_LABELS[r.origin]}
                    {r.serialControlled ? " · com número de série" : ""}
                    {r.minQuantity > 0 ? ` · mínimo ${r.minQuantity}` : ""}
                    {r.location ? ` · ${r.location}` : ""}
                    {r.products.length ? <span className="block">Produtos: {r.products.map((p) => `${p.productName ?? "produto"}${p.units > 1 ? ` (×${p.units})` : ""}`).join(", ")}</span> : null}
                  </p>
                </div>
                <dl className="grid grid-cols-3 gap-3 text-center text-sm sm:grid-cols-4 lg:w-[360px] lg:shrink-0">
                  <div>
                    <dt className="text-xs text-muted">Em estoque</dt>
                    <dd className="font-medium tabular-nums">{r.onHand}</dd>
                  </div>
                  <div>
                    <dt className="text-xs text-muted">Reservado</dt>
                    <dd className="font-medium tabular-nums">{r.reserved}</dd>
                  </div>
                  <div>
                    <dt className="text-xs text-muted">Disponível</dt>
                    <dd className={cn("font-semibold tabular-nums", r.belowMinimum && "text-warning-fg")}>{r.available}</dd>
                  </div>
                  {r.avgCost !== null ? (
                    <div className="hidden sm:block">
                      <dt className="text-xs text-muted">Custo médio</dt>
                      <dd className="tabular-nums" title={r.value !== null ? `Valor em estoque ${formatCurrency(r.value)}` : undefined}>
                        {formatCurrency(r.avgCost)}
                      </dd>
                    </div>
                  ) : null}
                </dl>
                <div className="flex flex-wrap gap-2 lg:w-[300px] lg:shrink-0 lg:justify-end">
                  {can.entry && r.active ? (
                    <Button size="sm" variant="outline" className="h-10 md:h-8" onClick={() => move("entrada", r)}>
                      <ArrowDownToLine /> Entrada
                    </Button>
                  ) : null}
                  {can.exit && r.available > 0 ? (
                    <Button size="sm" variant="ghost" className="h-10 md:h-8" onClick={() => move("saida", r)} title="Saída sem contrato (uso interno, troca, demonstração)">
                      <ArrowUpFromLine /> Saída
                    </Button>
                  ) : null}
                  {can.exit ? (
                    <Button size="sm" variant="ghost" className="h-10 md:h-8" onClick={() => move("devolucao", r)}>
                      <Undo2 /> Devolução
                    </Button>
                  ) : null}
                  {can.adjust ? (
                    <Button size="sm" variant="ghost" className="h-10 md:h-8" onClick={() => move("ajuste", r)}>
                      <Scale /> Ajuste
                    </Button>
                  ) : null}
                  {can.editItems ? (
                    <Button size="sm" variant="ghost" className="h-10 md:h-8" onClick={() => setEditing(r)} aria-label={`Editar ${r.name}`}>
                      <Pencil />
                    </Button>
                  ) : null}
                </div>
              </li>
            ))}
          </ul>
        </Card>
      )}

      {editing ? <StockItemDialog item={editing === "new" ? null : editing} products={products} onClose={() => setEditing(null)} /> : null}
      {moving ? <MovementDialog target={moving} showCost={can.costs} onClose={() => setMoving(null)} /> : null}
    </>
  );
}

function StockItemDialog({ item, products, onClose }: { item: StockItemRow | null; products: LinkableProduct[]; onClose: () => void }) {
  const id = React.useId();
  const { pending, run } = useFinanceAction();
  const [form, setForm] = React.useState({
    name: item?.name ?? "",
    sku: item?.sku ?? "",
    manufacturer: item?.manufacturer ?? "",
    model: item?.model ?? "",
    unit: item?.unit ?? "un",
    serialControlled: item?.serialControlled ?? true,
    origin: (item?.origin ?? "estoque_ou_compra") as StockOrigin,
    minQuantity: String(item?.minQuantity ?? 0),
    location: item?.location ?? "",
    notes: item?.notes ?? "",
    active: item?.active ?? true,
  });
  const [links, setLinks] = React.useState<{ productId: string; units: string }[]>(() => (item?.products ?? []).map((p) => ({ productId: p.productId, units: String(p.units) })));
  const set = (k: keyof typeof form) => (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement>) => setForm((f) => ({ ...f, [k]: e.target.value }));
  const lockSerial = Boolean(item && (item.onHand > 0 || item.reserved > 0));
  const used = new Set(links.map((l) => l.productId));

  const save = () =>
    void run(
      () =>
        saveStockItemAction({
          ...form,
          id: item?.id,
          minQuantity: form.minQuantity || "0",
          products: links.filter((l) => l.productId).map((l) => ({ productId: l.productId, units: l.units || "1" })),
        }),
      item ? "Item salvo" : "Item cadastrado",
      () => onClose(),
    );

  return (
    <Dialog open onOpenChange={(o) => !o && !pending && onClose()}>
      <DialogContent size="lg">
        <DialogHeader>
          <DialogTitle>{item ? `Editar ${item.name}` : "Novo item de estoque"}</DialogTitle>
          <DialogDescription>O vínculo com os produtos faz a assinatura do contrato reservar este item automaticamente.</DialogDescription>
        </DialogHeader>
        <form
          className="contents"
          onSubmit={(e) => {
            e.preventDefault();
            save();
          }}
        >
          <DialogBody className="grid gap-4 py-2">
            <div className="grid gap-3 sm:grid-cols-[1fr_160px]">
              <FormField label="Nome" htmlFor={`${id}-n`} required>
                <Input id={`${id}-n`} value={form.name} onChange={set("name")} className="h-11 md:h-9" maxLength={120} required />
              </FormField>
              <FormField label="Código (SKU)" htmlFor={`${id}-sku`}>
                <Input id={`${id}-sku`} value={form.sku} onChange={set("sku")} className="h-11 font-mono md:h-9" maxLength={60} />
              </FormField>
            </div>
            <div className="grid gap-3 sm:grid-cols-[1fr_1fr_100px]">
              <FormField label="Fabricante" htmlFor={`${id}-m`}>
                <Input id={`${id}-m`} value={form.manufacturer} onChange={set("manufacturer")} className="h-11 md:h-9" maxLength={80} />
              </FormField>
              <FormField label="Modelo" htmlFor={`${id}-mo`}>
                <Input id={`${id}-mo`} value={form.model} onChange={set("model")} className="h-11 md:h-9" maxLength={80} />
              </FormField>
              <FormField label="Unidade" htmlFor={`${id}-u`}>
                <Input id={`${id}-u`} value={form.unit} onChange={set("unit")} className="h-11 md:h-9" maxLength={10} />
              </FormField>
            </div>
            <Switch
              label="Exige número de série"
              description={lockSerial ? "Só muda com o item zerado (sem saldo nem reservas)." : "Cada unidade tem série: entrada, saída e devolução pedem as séries e o sistema sabe com que cliente cada uma está."}
              checked={form.serialControlled}
              onCheckedChange={(v) => setForm((f) => ({ ...f, serialControlled: v }))}
              disabled={lockSerial}
            />
            <div className="grid gap-3 sm:grid-cols-[1fr_160px]">
              <FormField label="Origem" htmlFor={`${id}-o`} hint={STOCK_ORIGIN_HINTS[form.origin]}>
                <Select id={`${id}-o`} value={form.origin} onChange={set("origin")} className="h-11 md:h-9">
                  {STOCK_ORIGINS.map((o) => (
                    <option key={o} value={o}>
                      {STOCK_ORIGIN_LABELS[o]}
                    </option>
                  ))}
                </Select>
              </FormField>
              <FormField label="Estoque mínimo" htmlFor={`${id}-min`} hint="0 = sem aviso">
                <Input id={`${id}-min`} inputMode="numeric" value={form.minQuantity} onChange={(e) => setForm((f) => ({ ...f, minQuantity: e.target.value.replace(/\D/g, "") }))} className="h-11 tabular-nums md:h-9" />
              </FormField>
            </div>

            <fieldset className="grid gap-2">
              <legend className="mb-1 text-sm font-medium">Produtos que usam este item</legend>
              {links.length === 0 ? <p className="text-xs text-muted">Sem vínculo: a assinatura não reserva este item (dá para reservar e dar saída manualmente).</p> : null}
              {links.map((l, i) => (
                <div key={i} className="flex flex-wrap items-end gap-2">
                  <FormField label={i === 0 ? "Produto" : undefined} htmlFor={`${id}-p${i}`} className="min-w-[200px] flex-1">
                    <Select
                      id={`${id}-p${i}`}
                      value={l.productId}
                      onChange={(e) => setLinks((cur) => cur.map((x, j) => (j === i ? { ...x, productId: e.target.value } : x)))}
                      className="h-11 md:h-9"
                    >
                      <option value="">Escolha o produto</option>
                      {products
                        .filter((p) => p.id === l.productId || !used.has(p.id))
                        .map((p) => (
                          <option key={p.id} value={p.id}>
                            {p.name}
                            {!p.active ? " (inativo)" : ""}
                            {p.hasHardware ? " · hardware" : ""}
                          </option>
                        ))}
                    </Select>
                  </FormField>
                  <FormField label={i === 0 ? "Unidades por produto" : undefined} htmlFor={`${id}-pu${i}`} className="w-[150px]">
                    <Input
                      id={`${id}-pu${i}`}
                      inputMode="numeric"
                      value={l.units}
                      onChange={(e) => setLinks((cur) => cur.map((x, j) => (j === i ? { ...x, units: e.target.value.replace(/\D/g, "") } : x)))}
                      className="h-11 tabular-nums md:h-9"
                    />
                  </FormField>
                  <Button type="button" variant="ghost" size="sm" className="h-11 md:h-9" onClick={() => setLinks((cur) => cur.filter((_, j) => j !== i))} aria-label="Remover produto">
                    <Trash2 />
                  </Button>
                </div>
              ))}
              <div>
                <Button type="button" variant="outline" size="sm" className="h-10 md:h-8" onClick={() => setLinks((cur) => [...cur, { productId: "", units: "1" }])} disabled={used.size >= products.length}>
                  <Plus /> Vincular produto
                </Button>
              </div>
            </fieldset>

            <div className="grid gap-3 sm:grid-cols-2">
              <FormField label="Local" htmlFor={`${id}-l`} hint="Prateleira, depósito, filial">
                <Input id={`${id}-l`} value={form.location} onChange={set("location")} className="h-11 md:h-9" maxLength={80} />
              </FormField>
              <FormField label="Observações" htmlFor={`${id}-obs`}>
                <Textarea id={`${id}-obs`} value={form.notes} onChange={set("notes")} className="min-h-[44px]" maxLength={500} />
              </FormField>
            </div>
            {item ? <Switch label="Item ativo" description="Desativado não recebe entrada nem reserva." checked={form.active} onCheckedChange={(v) => setForm((f) => ({ ...f, active: v }))} /> : null}
          </DialogBody>
          <DialogFooter>
            <Button type="button" variant="outline" onClick={onClose} disabled={pending} className="h-11 md:h-9">
              Cancelar
            </Button>
            <Button type="submit" loading={pending} disabled={form.name.trim().length < 2} className="h-11 md:h-9">
              Salvar
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
