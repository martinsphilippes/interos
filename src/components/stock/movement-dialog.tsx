"use client";

import * as React from "react";
import { adjustStockAction, itemSerialsAction, registerEntryAction, registerExitAction, registerReturnAction } from "@/server/stock/actions";
import { parseSerials } from "@/domain/stock";
import { formatCurrency } from "@/lib/format";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Dialog, DialogBody, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { FormField } from "@/components/ui/form-field";
import { Input } from "@/components/ui/input";
import { Select } from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import { useFinanceAction } from "@/components/finance/use-finance-action";

export type MovementMode = "entrada" | "saida" | "devolucao" | "ajuste";

export interface MovementTarget {
  mode: MovementMode;
  item: { id: string; name: string; unit: string; serialControlled: boolean; onHand: number; reserved: number; available: number };
  /** Saída/devolução de uma reserva (contrato). */
  reservation?: { id: string; contractNumber: string; clientName: string; toDeliver: number; outstanding: number };
}

const TITLES: Record<MovementMode, string> = {
  entrada: "Registrar entrada",
  saida: "Registrar saída",
  devolucao: "Registrar devolução",
  ajuste: "Ajustar estoque",
};

/**
 * Entrada (com custo), saída, devolução e ajuste de um item. Itens com número de série: na entrada (e ajuste para
 * mais) as séries são digitadas, uma por linha, e a quantidade é a contagem; na saída, devolução e baixa as séries são
 * escolhidas entre as que estão no lugar certo (em estoque ou com o cliente).
 */
export function MovementDialog({ target, showCost, onClose }: { target: MovementTarget; showCost: boolean; onClose: () => void }) {
  const id = React.useId();
  const { pending, run } = useFinanceAction();
  const { mode, item, reservation } = target;
  const [quantity, setQuantity] = React.useState(() => (reservation ? String(mode === "saida" ? reservation.toDeliver : reservation.outstanding) : "1"));
  const [direction, setDirection] = React.useState<"mais" | "menos">("menos");
  const [unitCost, setUnitCost] = React.useState("");
  const [document, setDocument] = React.useState("");
  const [supplier, setSupplier] = React.useState("");
  const [reason, setReason] = React.useState("");
  const [typedSerials, setTypedSerials] = React.useState("");
  const [loaded, setLoaded] = React.useState<{ key: string; list: string[] } | null>(null);
  const [picked, setPicked] = React.useState<Set<string>>(new Set());

  // Séries digitadas (entrada, ajuste para mais) x escolhidas (saída, devolução, baixa).
  const typing = item.serialControlled && (mode === "entrada" || (mode === "ajuste" && direction === "mais"));
  const picking = item.serialControlled && !typing;
  const pickStatus = mode === "devolucao" ? "entregue" : "em_estoque";
  const pickReservation = mode === "devolucao" ? reservation?.id : undefined;
  const loadKey = picking ? `${item.id}|${pickStatus}|${pickReservation ?? ""}` : "";
  const options = loaded && loaded.key === loadKey ? loaded.list : null;

  React.useEffect(() => {
    if (!loadKey) return;
    let alive = true;
    void itemSerialsAction({ itemId: item.id, status: pickStatus, reservationId: pickReservation }).then((r) => {
      if (alive) setLoaded({ key: loadKey, list: r.ok ? r.data : [] });
    });
    return () => {
      alive = false;
    };
  }, [loadKey, item.id, pickStatus, pickReservation]);

  const parsed = typing ? parseSerials(typedSerials) : null;
  const serials = typing ? (parsed?.serials ?? []) : picking ? (options ?? []).filter((x) => picked.has(x)) : [];
  const qty = item.serialControlled ? serials.length : Math.floor(Number(quantity) || 0);

  const submit = async () => {
    const after = () => onClose();
    if (mode === "entrada") {
      await run(
        () => registerEntryAction({ itemId: item.id, quantity: qty, unitCost, serials, document, supplier, notes: reason }),
        (d) => (d.filled.length ? `Entrada registrada; separado para ${d.filled.map((f) => `${f.contractNumber} (${f.add})`).join(", ")}` : "Entrada registrada"),
        after,
      );
    } else if (mode === "saida") {
      await run(() => registerExitAction({ itemId: item.id, quantity: qty, reservationId: reservation?.id, serials, reason, document }), "Saída registrada", after);
    } else if (mode === "devolucao") {
      await run(() => registerReturnAction({ itemId: item.id, quantity: qty, reservationId: reservation?.id, serials, reason }), "Devolução registrada", after);
    } else {
      await run(() => adjustStockAction({ itemId: item.id, delta: direction === "mais" ? qty : -qty, reason, serials }), "Estoque ajustado", after);
    }
  };

  const needsReason = mode === "devolucao" || mode === "ajuste" || (mode === "saida" && !reservation);
  const invalid = qty <= 0 || (mode === "entrada" && unitCost.trim() === "") || (needsReason && reason.trim().length < 5) || Boolean(parsed?.duplicates.length);

  return (
    <Dialog open onOpenChange={(o) => !o && !pending && onClose()}>
      <DialogContent size="md">
        <DialogHeader>
          <DialogTitle>{TITLES[mode]}</DialogTitle>
          <DialogDescription>
            {item.name} · em estoque {item.onHand} · reservado {item.reserved} · disponível {item.available}
            {reservation ? ` · contrato ${reservation.contractNumber} (${reservation.clientName})` : ""}
          </DialogDescription>
        </DialogHeader>
        <form
          className="contents"
          onSubmit={(e) => {
            e.preventDefault();
            if (!invalid) void submit();
          }}
        >
          <DialogBody className="grid gap-3 py-2">
            {mode === "ajuste" ? (
              <FormField label="Tipo de ajuste" htmlFor={`${id}-dir`}>
                <Select id={`${id}-dir`} value={direction} onChange={(e) => setDirection(e.target.value as "mais" | "menos")} className="h-11 md:h-9">
                  <option value="menos">Baixa (perda, avaria, furto, inventário a menos)</option>
                  <option value="mais">Acréscimo (inventário a mais)</option>
                </Select>
              </FormField>
            ) : null}

            {!item.serialControlled ? (
              <FormField label={`Quantidade (${item.unit})`} htmlFor={`${id}-q`} required>
                <Input id={`${id}-q`} inputMode="numeric" value={quantity} onChange={(e) => setQuantity(e.target.value.replace(/\D/g, ""))} className="h-11 tabular-nums md:h-9" required />
              </FormField>
            ) : null}

            {typing ? (
              <FormField
                label="Números de série"
                htmlFor={`${id}-s`}
                required
                hint={parsed?.duplicates.length ? `Repetido(s): ${parsed.duplicates.join(", ")}` : `Um por linha (ou separados por vírgula) · ${serials.length} unidade(s)`}
              >
                <Textarea id={`${id}-s`} value={typedSerials} onChange={(e) => setTypedSerials(e.target.value)} className="min-h-[110px] font-mono" placeholder={"SN0001\nSN0002"} />
              </FormField>
            ) : null}

            {picking ? (
              <fieldset className="grid gap-2">
                <legend className="mb-1 text-sm font-medium">
                  Números de série {mode === "devolucao" ? "com o cliente" : "em estoque"} · {serials.length} escolhido(s)
                </legend>
                {options === null ? (
                  <p className="text-sm text-muted">Carregando…</p>
                ) : options.length === 0 ? (
                  <p className="text-sm text-muted">Nenhum número de série {mode === "devolucao" ? "com o cliente" : "em estoque"} para este item.</p>
                ) : (
                  <div className="grid max-h-[220px] gap-1 overflow-y-auto rounded-md border border-border p-2 sm:grid-cols-2">
                    {options.map((s) => (
                      <label key={s} className="flex min-h-[40px] cursor-pointer items-center gap-2 rounded px-2 font-mono text-sm hover:bg-surface-hover md:min-h-[32px]">
                        <Checkbox
                          checked={picked.has(s)}
                          onCheckedChange={(v) =>
                            setPicked((cur) => {
                              const next = new Set(cur);
                              if (v) next.add(s);
                              else next.delete(s);
                              return next;
                            })
                          }
                        />
                        {s}
                      </label>
                    ))}
                  </div>
                )}
              </fieldset>
            ) : null}

            {mode === "entrada" ? (
              <>
                <FormField label="Custo unitário (R$)" htmlFor={`${id}-c`} required hint={showCost ? "Recalcula o custo médio do item" : "Entra no custo médio do item"}>
                  <Input id={`${id}-c`} inputMode="decimal" value={unitCost} onChange={(e) => setUnitCost(e.target.value)} placeholder="0,00" className="h-11 tabular-nums md:h-9" required />
                </FormField>
                <div className="grid gap-3 sm:grid-cols-2">
                  <FormField label="Documento (NF de compra, pedido)" htmlFor={`${id}-d`}>
                    <Input id={`${id}-d`} value={document} onChange={(e) => setDocument(e.target.value)} className="h-11 md:h-9" maxLength={80} />
                  </FormField>
                  <FormField label="Fornecedor" htmlFor={`${id}-f`}>
                    <Input id={`${id}-f`} value={supplier} onChange={(e) => setSupplier(e.target.value)} className="h-11 md:h-9" maxLength={120} />
                  </FormField>
                </div>
                {qty > 0 && Number(unitCost.replace(",", ".")) > 0 ? (
                  <p className="text-xs text-muted">Total da entrada: {formatCurrency(qty * Number(unitCost.trim().includes(",") ? unitCost.replace(/\./g, "").replace(",", ".") : unitCost))}</p>
                ) : null}
              </>
            ) : null}

            {mode === "saida" ? (
              <FormField label="Documento (romaneio, NF de remessa)" htmlFor={`${id}-d`}>
                <Input id={`${id}-d`} value={document} onChange={(e) => setDocument(e.target.value)} className="h-11 md:h-9" maxLength={80} />
              </FormField>
            ) : null}

            <FormField
              label={mode === "entrada" ? "Observação" : "Motivo"}
              htmlFor={`${id}-r`}
              required={needsReason}
              hint={mode === "saida" && !reservation ? "Saída sem contrato: uso interno, troca em garantia, demonstração…" : undefined}
            >
              <Textarea id={`${id}-r`} value={reason} onChange={(e) => setReason(e.target.value)} className="min-h-[70px]" maxLength={500} />
            </FormField>
          </DialogBody>
          <DialogFooter>
            <Button type="button" variant="outline" onClick={onClose} disabled={pending} className="h-11 md:h-9">
              Cancelar
            </Button>
            <Button type="submit" loading={pending} disabled={invalid} className="h-11 md:h-9">
              {TITLES[mode]}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
