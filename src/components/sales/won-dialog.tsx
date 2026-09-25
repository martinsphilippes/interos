"use client";

import * as React from "react";
import { useRouter } from "next/navigation";
import { Trophy } from "lucide-react";
import type { Opportunity } from "@/domain/types";
import { Button } from "@/components/ui/button";
import { Dialog, DialogBody, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { FormField } from "@/components/ui/form-field";
import { Input } from "@/components/ui/input";
import { toast } from "@/components/ui/toast";
import { markOpportunityWonAction } from "@/server/sales/actions";
import type { ProductOption } from "@/server/sales/queries";
import { ProductsEditor, toEditableLines, toPayloadLines, type EditableLine } from "./products-editor";
import { productTotals } from "./model";

export interface WonDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  opportunity: Pick<Opportunity, "id" | "title" | "products" | "billingData">;
  /** Padrões de faturamento vindos do cadastro do cliente. */
  clientDefaults: { legalName?: string; document?: string; email?: string };
  products: ProductOption[];
  onWon?: () => void;
}

/**
 * "Marcar como ganho": exige produtos com valores e dados de faturamento completos. Ao confirmar,
 * o servidor emite opportunity.won → jornada avança para o Financeiro, contrato e comissões são criados.
 */
export function WonDialog({ open, onOpenChange, opportunity, clientDefaults, products, onWon }: WonDialogProps) {
  const router = useRouter();
  const id = React.useId();
  const [lines, setLines] = React.useState<EditableLine[]>(() => toEditableLines(opportunity.products));
  const [legalName, setLegalName] = React.useState(opportunity.billingData?.legalName ?? clientDefaults.legalName ?? "");
  const [document, setDocument] = React.useState(opportunity.billingData?.document ?? clientDefaults.document ?? "");
  const [email, setEmail] = React.useState(opportunity.billingData?.email ?? clientDefaults.email ?? "");
  const [payment, setPayment] = React.useState(opportunity.billingData?.paymentCondition ?? "");
  const [pending, startTransition] = React.useTransition();

  const totals = productTotals(lines);
  const hasValue = lines.length > 0 && totals.setupTotal + totals.monthlyTotal + totals.hardwareTotal > 0;
  const docDigits = document.replace(/\D/g, "");
  const complete = hasValue && legalName.trim().length >= 3 && (docDigits.length === 11 || docDigits.length === 14) && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email.trim()) && payment.trim().length >= 3;

  const submit = () => {
    startTransition(async () => {
      const result = await markOpportunityWonAction({
        opportunityId: opportunity.id,
        products: toPayloadLines(lines),
        billingData: { legalName, document: docDigits, email, paymentCondition: payment },
      });
      if (!result.ok) {
        toast.error(result.error);
        return;
      }
      toast.success("Negócio ganho! Contrato criado e financeiro acionado.");
      onOpenChange(false);
      onWon?.();
      router.refresh();
    });
  };

  return (
    <Dialog open={open} onOpenChange={(next) => !pending && onOpenChange(next)}>
      <DialogContent size="lg">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Trophy className="size-5 text-success" /> Marcar como ganho
          </DialogTitle>
          <DialogDescription>{opportunity.title}. Confira produtos, valores e dados de faturamento: eles vão para o contrato e para o financeiro.</DialogDescription>
        </DialogHeader>
        <DialogBody className="flex flex-col gap-5">
          <section>
            <h4 className="mb-2 text-sm font-semibold">Produtos e valores</h4>
            <ProductsEditor lines={lines} onChange={setLines} products={products} />
            {!hasValue ? <p className="mt-2 text-xs text-danger">Inclua ao menos um produto com valor.</p> : null}
          </section>
          <section className="grid gap-3 sm:grid-cols-2">
            <h4 className="text-sm font-semibold sm:col-span-2">Dados de faturamento</h4>
            <FormField label="Razão social" htmlFor={`${id}-ln`} required className="sm:col-span-2">
              <Input id={`${id}-ln`} value={legalName} onChange={(e) => setLegalName(e.target.value)} />
            </FormField>
            <FormField label="CNPJ/CPF" htmlFor={`${id}-doc`} required error={document && docDigits.length !== 11 && docDigits.length !== 14 ? "CNPJ (14 dígitos) ou CPF (11)" : undefined}>
              <Input id={`${id}-doc`} inputMode="numeric" value={document} onChange={(e) => setDocument(e.target.value)} />
            </FormField>
            <FormField label="E-mail de faturamento" htmlFor={`${id}-em`} required>
              <Input id={`${id}-em`} type="email" value={email} onChange={(e) => setEmail(e.target.value)} />
            </FormField>
            <FormField label="Condição de pagamento" htmlFor={`${id}-pc`} required className="sm:col-span-2" hint="Ex.: adesão à vista via PIX; mensalidade por boleto todo dia 10">
              <Input id={`${id}-pc`} value={payment} onChange={(e) => setPayment(e.target.value)} />
            </FormField>
          </section>
        </DialogBody>
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)} disabled={pending}>
            Cancelar
          </Button>
          <Button onClick={submit} loading={pending} disabled={!complete} className="bg-success-strong hover:bg-success-hover">
            <Trophy /> Confirmar ganho
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
