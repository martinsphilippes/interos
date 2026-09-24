"use client";

import * as React from "react";
import { useRouter } from "next/navigation";
import { TrendingUp } from "lucide-react";
import type { Product } from "@/domain/types";
import { PRODUCT_CATEGORY_LABELS } from "@/domain/constants";
import { createUpsellOpportunity } from "@/server/clients/actions";
import { formatCurrency } from "@/lib/format";
import { Button } from "@/components/ui/button";
import { Dialog, DialogBody, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { FormField } from "@/components/ui/form-field";
import { Input } from "@/components/ui/input";
import { Select } from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import { toast } from "@/components/ui/toast";

export interface UpsellDialogProps {
  clientId: string;
  clientName: string;
  /** Produtos do catálogo que o cliente ainda não tem. */
  products: Product[];
  /** Categorias já contratadas (define o padrão upsell x cross-sell). */
  ownedCategories: string[];
  defaultProductId?: string;
  /** Sem trigger, o diálogo é controlado por `open`/`onOpenChange` (ex.: item de menu). */
  trigger?: React.ReactNode;
  open?: boolean;
  onOpenChange?: (open: boolean) => void;
}

/** Cria uma oportunidade de upsell/cross-sell para o cliente a partir de um produto do catálogo. */
export function UpsellDialog({ clientId, clientName, products, ownedCategories, defaultProductId, trigger, open: openProp, onOpenChange }: UpsellDialogProps) {
  const router = useRouter();
  const [innerOpen, setInnerOpen] = React.useState(false);
  const open = openProp ?? innerOpen;
  const setOpen = onOpenChange ?? setInnerOpen;
  const [productId, setProductId] = React.useState(defaultProductId ?? products[0]?.id ?? "");
  const [kind, setKind] = React.useState<"upsell" | "cross_sell" | "">("");
  const [quantity, setQuantity] = React.useState("1");
  const [need, setNeed] = React.useState("");
  const [notes, setNotes] = React.useState("");
  const [pending, startTransition] = React.useTransition();
  const id = React.useId();

  const product = products.find((p) => p.id === productId);
  // Mesma categoria de algo já contratado = upsell (ampliação); categoria nova = cross-sell.
  const suggestedKind: "upsell" | "cross_sell" = product && ownedCategories.includes(product.category) ? "upsell" : "cross_sell";
  const effectiveKind = kind || suggestedKind;
  const qty = Math.max(1, Number(quantity) || 1);

  const reset = () => {
    setProductId(defaultProductId ?? products[0]?.id ?? "");
    setKind("");
    setQuantity("1");
    setNeed("");
    setNotes("");
  };

  const submit = () => {
    startTransition(async () => {
      const result = await createUpsellOpportunity({ clientId, productId, kind: effectiveKind, quantity: qty, need, notes });
      if (!result.ok) {
        toast.error(result.error);
        return;
      }
      toast.success("Oportunidade criada e registrada na timeline", {
        action: { label: "Abrir", onClick: () => router.push(`/vendas/oportunidades?oportunidade=${result.data.id}`) },
      });
      setOpen(false);
      reset();
      router.refresh();
    });
  };

  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        setOpen(next);
        if (next) setProductId(defaultProductId ?? products[0]?.id ?? "");
      }}
    >
      {trigger ? <DialogTrigger asChild>{trigger}</DialogTrigger> : null}
      <DialogContent size="md">
        <DialogHeader>
          <DialogTitle>Gerar oportunidade</DialogTitle>
          <DialogDescription>Registra uma oportunidade de venda adicional para {clientName}, com você como origem.</DialogDescription>
        </DialogHeader>
        <form
          className="contents"
          onSubmit={(e) => {
            e.preventDefault();
            submit();
          }}
        >
          <DialogBody className="flex flex-col gap-4 py-2">
            {products.length === 0 ? (
              <p className="rounded-md bg-surface-muted p-3 text-sm text-muted">Este cliente já tem todos os produtos ativos do catálogo.</p>
            ) : (
              <>
                <FormField label="Produto" htmlFor={`${id}-product`} required>
                  <Select id={`${id}-product`} value={productId} onChange={(e) => setProductId(e.target.value)} required>
                    {products.map((p) => (
                      <option key={p.id} value={p.id}>
                        {p.name} · {PRODUCT_CATEGORY_LABELS[p.category]}
                      </option>
                    ))}
                  </Select>
                </FormField>
                {product ? (
                  <div className="grid grid-cols-3 gap-2 rounded-md bg-surface-muted p-3 text-sm">
                    <div>
                      <p className="label-caps">Adesão</p>
                      <p className="mt-0.5 tabular-nums">{formatCurrency(product.setupPrice * qty)}</p>
                    </div>
                    <div>
                      <p className="label-caps">Mensal</p>
                      <p className="mt-0.5 tabular-nums">{formatCurrency(product.monthlyPrice * qty)}</p>
                    </div>
                    <div>
                      <p className="label-caps">Hardware</p>
                      <p className="mt-0.5 tabular-nums">{formatCurrency(product.hardwarePrice * qty)}</p>
                    </div>
                  </div>
                ) : null}
                <div className="grid grid-cols-[1fr_120px] gap-3">
                  <FormField label="Tipo" htmlFor={`${id}-kind`} hint={kind ? undefined : `Sugerido: ${suggestedKind === "upsell" ? "upsell (amplia produto da mesma categoria)" : "cross-sell (categoria nova)"}`}>
                    <Select id={`${id}-kind`} value={effectiveKind} onChange={(e) => setKind(e.target.value as "upsell" | "cross_sell")} options={[{ value: "upsell", label: "Upsell" }, { value: "cross_sell", label: "Cross-sell" }]} />
                  </FormField>
                  <FormField label="Quantidade" htmlFor={`${id}-qty`}>
                    <Input id={`${id}-qty`} type="number" min={1} max={999} inputMode="numeric" value={quantity} onChange={(e) => setQuantity(e.target.value)} />
                  </FormField>
                </div>
                <FormField label="Necessidade do cliente" htmlFor={`${id}-need`} required hint="O que o cliente pediu ou o problema identificado.">
                  <Textarea id={`${id}-need`} value={need} onChange={(e) => setNeed(e.target.value)} required minLength={3} placeholder="Ex.: reclamou de filas no WhatsApp; quer vários atendentes no mesmo número." className="min-h-[72px]" />
                </FormField>
                <FormField label="Observação" htmlFor={`${id}-notes`}>
                  <Textarea id={`${id}-notes`} value={notes} onChange={(e) => setNotes(e.target.value)} className="min-h-[60px]" placeholder="Contexto adicional para o vendedor (opcional)" />
                </FormField>
              </>
            )}
          </DialogBody>
          <DialogFooter>
            <Button type="button" variant="outline" onClick={() => setOpen(false)} disabled={pending}>
              Cancelar
            </Button>
            <Button type="submit" loading={pending} disabled={products.length === 0 || !productId}>
              <TrendingUp /> Criar oportunidade
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
