"use client";

import * as React from "react";
import Link from "next/link";
import { Check, Clock, Plus, Target } from "lucide-react";
import type { UpsellMatrix as Matrix } from "@/server/cs/queries";
import { generateUpsell } from "@/server/cs/actions";
import { formatCurrency } from "@/lib/format";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { Dialog, DialogBody, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { FormField } from "@/components/ui/form-field";
import { Textarea } from "@/components/ui/textarea";
import { HealthIndicator } from "./cs-bits";
import { useCsAction } from "./use-cs";

const LEGEND = [
  { icon: <Check className="size-3.5 text-success" />, label: "Contratado" },
  { icon: <Clock className="size-3.5 text-warning" />, label: "Em implantação" },
  { icon: <Target className="size-3.5 text-info" />, label: "Oportunidade aberta" },
  { icon: <Plus className="size-3.5 text-muted" />, label: "Disponível: gerar oportunidade" },
];

/** Matriz cliente × produto da carteira; células disponíveis geram oportunidade de upsell/cross-sell. */
export function UpsellMatrixView({ data }: { data: Pick<Matrix, "products" | "rows"> }) {
  const { pending, run } = useCsAction();
  const [selected, setSelected] = React.useState<{ clientId: string; tradeName: string; productId: string; productName: string; monthly: number; setup: number } | null>(null);
  const [need, setNeed] = React.useState("");
  const id = React.useId();

  if (data.rows.length === 0) return <p className="p-6 text-center text-sm text-muted">Nenhum cliente na carteira selecionada.</p>;

  return (
    <>
      <div className="flex flex-wrap gap-x-4 gap-y-1 px-4 pt-3 text-xs text-muted">
        {LEGEND.map((l) => (
          <span key={l.label} className="inline-flex items-center gap-1">
            {l.icon} {l.label}
          </span>
        ))}
      </div>
      <div className="relative mt-2 w-full overflow-x-auto scrollbar-thin">
        <table className="w-full min-w-[900px] border-separate border-spacing-0 text-sm">
          <thead>
            <tr>
              <th scope="col" className="sticky left-0 z-10 min-w-[200px] border-b border-border bg-surface-muted px-4 py-2 text-left text-xs font-semibold uppercase tracking-wide text-muted">
                Cliente
              </th>
              {data.products.map((p) => (
                <th key={p.id} scope="col" className="border-b border-border bg-surface-muted px-2 py-2 text-center text-[11px] font-semibold leading-tight text-muted">
                  <span className="line-clamp-2">{p.name}</span>
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {data.rows.map((r) => (
              <tr key={r.clientId} className="hover:bg-surface-muted/60">
                <th scope="row" className="sticky left-0 z-10 border-b border-border bg-surface px-4 py-1.5 text-left font-normal">
                  <Link href={`/clientes/${r.clientId}?aba=produtos`} className="block truncate font-medium hover:underline">
                    {r.tradeName}
                  </Link>
                  <HealthIndicator score={r.healthScore} level={r.healthLevel} className="text-xs" />
                </th>
                {data.products.map((p) => {
                  const state = r.cells[p.id];
                  return (
                    <td key={p.id} className="border-b border-border px-1 py-1 text-center">
                      {state === "contratado" ? (
                        <Check className="mx-auto size-4 text-success" aria-label="Contratado" />
                      ) : state === "em_implantacao" ? (
                        <Clock className="mx-auto size-4 text-warning" aria-label="Em implantação" />
                      ) : state === "oportunidade" ? (
                        <Target className="mx-auto size-4 text-info" aria-label="Oportunidade aberta" />
                      ) : (
                        <button
                          type="button"
                          className={cn("mx-auto inline-flex size-9 items-center justify-center rounded-md text-muted-light transition-colors hover:bg-brand-soft hover:text-brand-fg md:size-7")}
                          aria-label={`Gerar oportunidade de ${p.name} para ${r.tradeName}`}
                          title={`Gerar oportunidade de ${p.name}`}
                          onClick={() => setSelected({ clientId: r.clientId, tradeName: r.tradeName, productId: p.id, productName: p.name, monthly: p.monthlyPrice, setup: p.setupPrice })}
                        >
                          <Plus className="size-4" />
                        </button>
                      )}
                    </td>
                  );
                })}
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <Dialog open={Boolean(selected)} onOpenChange={(o) => !pending && !o && setSelected(null)}>
        <DialogContent size="sm">
          {selected ? (
            <form
              className="contents"
              onSubmit={async (e) => {
                e.preventDefault();
                const ok = await run(() => generateUpsell({ clientId: selected.clientId, productId: selected.productId, need }), (d) => `Oportunidade de ${d.kind === "upsell" ? "upsell" : "cross-sell"} criada e enviada ao vendedor`);
                if (ok) {
                  setNeed("");
                  setSelected(null);
                }
              }}
            >
              <DialogHeader>
                <DialogTitle>Gerar oportunidade</DialogTitle>
                <DialogDescription>
                  {selected.productName} para {selected.tradeName} · tabela {formatCurrency(selected.monthly)}/mês{selected.setup > 0 ? ` + adesão ${formatCurrency(selected.setup)}` : ""}. O vendedor responsável é notificado.
                </DialogDescription>
              </DialogHeader>
              <DialogBody>
                <FormField label="Necessidade identificada" htmlFor={`${id}-need`} hint="O que o cliente precisa e como o produto ajuda (vai para a oportunidade).">
                  <Textarea id={`${id}-need`} value={need} onChange={(e) => setNeed(e.target.value)} className="min-h-[72px]" />
                </FormField>
              </DialogBody>
              <DialogFooter>
                <Button variant="outline" onClick={() => setSelected(null)} disabled={pending}>
                  Cancelar
                </Button>
                <Button type="submit" loading={pending}>
                  Gerar oportunidade
                </Button>
              </DialogFooter>
            </form>
          ) : null}
        </DialogContent>
      </Dialog>
    </>
  );
}
