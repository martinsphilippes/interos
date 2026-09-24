"use client";

import * as React from "react";
import { useRouter } from "next/navigation";
import { FileText } from "lucide-react";
import type { Opportunity, Proposal } from "@/domain/types";
import { Button } from "@/components/ui/button";
import { DateInput, dateValueToIso, isoToDateValue } from "@/components/ui/date-input";
import { Dialog, DialogBody, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { FormField } from "@/components/ui/form-field";
import { Select } from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import { toast } from "@/components/ui/toast";
import { saveProposalAction } from "@/server/sales/actions";
import type { ProductOption } from "@/server/sales/queries";
import { ProductsEditor, toEditableLines, toPayloadLines, type EditableLine } from "./products-editor";

export interface ProposalEditorDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** Oportunidade fixa (drawer) ou lista para escolher (página de propostas). */
  opportunity?: Pick<Opportunity, "id" | "title" | "products">;
  opportunityOptions?: { id: string; title: string; clientName: string; products: Opportunity["products"] }[];
  /** Rascunho em edição. */
  proposal?: Pick<Proposal, "id" | "items" | "conditions" | "validUntil" | "notes" | "number" | "version">;
  products: ProductOption[];
  onSaved?: (proposalId: string) => void;
}

const DEFAULT_CONDITIONS = "Adesão à vista ou em até 3x no cartão. Mensalidade com vencimento todo dia 10. Implantação iniciada após assinatura do contrato e confirmação do pagamento da adesão.";

function plusDays(days: number): string {
  return isoToDateValue(new Date(Date.now() + days * 86_400_000).toISOString());
}

/**
 * Criar/editar proposta: itens pré-carregados dos produtos da oportunidade, catálogo, quantidade,
 * valores, desconto %, condições, validade (padrão +15 dias) e observações. Totais recalculados.
 */
export function ProposalEditorDialog({ open, onOpenChange, opportunity, opportunityOptions, proposal, products, onSaved }: ProposalEditorDialogProps) {
  const router = useRouter();
  const id = React.useId();
  const [oppId, setOppId] = React.useState(opportunity?.id ?? "");
  const initialProducts = opportunity?.products ?? [];
  const [lines, setLines] = React.useState<EditableLine[]>(() => toEditableLines(proposal?.items ?? initialProducts.map((p) => ({ ...p, discountPct: 0 }))));
  const [conditions, setConditions] = React.useState(proposal ? (proposal.conditions ?? "") : DEFAULT_CONDITIONS);
  const [validUntil, setValidUntil] = React.useState(proposal ? isoToDateValue(proposal.validUntil) : plusDays(15));
  const [notes, setNotes] = React.useState(proposal?.notes ?? "");
  const [pending, startTransition] = React.useTransition();

  const chooseOpportunity = (value: string) => {
    setOppId(value);
    const opp = opportunityOptions?.find((o) => o.id === value);
    if (opp) setLines(toEditableLines(opp.products.map((p) => ({ ...p, discountPct: 0 }))));
  };

  const submit = () => {
    const iso = dateValueToIso(validUntil);
    if (!iso) {
      toast.error("Informe a validade");
      return;
    }
    // Validade vale até o fim do dia escolhido.
    const endOfDay = new Date(new Date(iso).getTime() + 86_399_000).toISOString();
    startTransition(async () => {
      const result = await saveProposalAction({ proposalId: proposal?.id, opportunityId: oppId, items: toPayloadLines(lines, true), conditions, validUntil: endOfDay, notes });
      if (!result.ok) {
        toast.error(result.error);
        return;
      }
      toast.success(proposal ? "Proposta atualizada" : "Proposta criada como rascunho");
      onOpenChange(false);
      onSaved?.(result.data.id);
      router.refresh();
    });
  };

  return (
    <Dialog open={open} onOpenChange={(next) => !pending && onOpenChange(next)}>
      <DialogContent size="xl">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <FileText className="size-5 text-secondary" />
            {proposal ? `Editar proposta ${proposal.number} v${proposal.version}` : "Nova proposta"}
          </DialogTitle>
          <DialogDescription>{opportunity ? opportunity.title : "Escolha a oportunidade; os produtos dela entram como itens iniciais."}</DialogDescription>
        </DialogHeader>
        <DialogBody className="flex flex-col gap-5">
          {!opportunity && opportunityOptions ? (
            <FormField label="Oportunidade" htmlFor={`${id}-o`} required>
              <Select id={`${id}-o`} value={oppId} onChange={(e) => chooseOpportunity(e.target.value)} placeholder="Selecione a oportunidade" options={opportunityOptions.map((o) => ({ value: o.id, label: `${o.clientName} — ${o.title}` }))} />
            </FormField>
          ) : null}
          <section>
            <h4 className="mb-2 text-sm font-semibold">Itens</h4>
            <ProductsEditor lines={lines} onChange={setLines} products={products} withDiscount />
          </section>
          <div className="grid gap-3 sm:grid-cols-[1fr_200px]">
            <FormField label="Condições comerciais" htmlFor={`${id}-c`}>
              <Textarea id={`${id}-c`} value={conditions} onChange={(e) => setConditions(e.target.value)} />
            </FormField>
            <FormField label="Validade" htmlFor={`${id}-v`} required hint="Padrão: 15 dias">
              <DateInput id={`${id}-v`} value={validUntil} onChange={(e) => setValidUntil(e.target.value)} />
            </FormField>
          </div>
          <FormField label="Observações" htmlFor={`${id}-n`}>
            <Textarea id={`${id}-n`} value={notes} onChange={(e) => setNotes(e.target.value)} className="min-h-[64px]" />
          </FormField>
        </DialogBody>
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)} disabled={pending}>
            Cancelar
          </Button>
          <Button onClick={submit} loading={pending} disabled={!oppId || lines.length === 0}>
            {proposal ? "Salvar rascunho" : "Criar rascunho"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
