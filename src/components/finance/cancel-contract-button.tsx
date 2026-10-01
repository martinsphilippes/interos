"use client";

import * as React from "react";
import { Ban } from "lucide-react";
import { cancelContractAction } from "@/server/finance/actions";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Dialog, DialogBody, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { FormField } from "@/components/ui/form-field";
import { Textarea } from "@/components/ui/textarea";
import { useFinanceAction } from "./use-finance-action";

export interface CancelContractButtonProps {
  contractId: string;
  number: string;
  /** Cobranças em aberto/vencidas que serão canceladas junto. */
  openBillings: number;
  className?: string;
}

/** "Cancelar contrato": confirmação com motivo obrigatório; cancela as cobranças em aberto e registra na timeline. */
export function CancelContractButton({ contractId, number, openBillings, className }: CancelContractButtonProps) {
  const id = React.useId();
  const [open, setOpen] = React.useState(false);
  const [reason, setReason] = React.useState("");
  const { pending, run } = useFinanceAction();

  const confirm = async () => {
    const ok = await run(() => cancelContractAction({ contractId, reason }), (d) => (d.cancelledBillings > 0 ? `Contrato cancelado · ${d.cancelledBillings} cobrança(s) em aberto cancelada(s)` : "Contrato cancelado"));
    if (ok) {
      setOpen(false);
      setReason("");
    }
  };

  return (
    <>
      <Button variant="outline" onClick={() => setOpen(true)} className={className ?? "h-11 text-danger-fg md:h-9"}>
        <Ban /> Cancelar contrato
      </Button>
      <Dialog open={open} onOpenChange={(next) => !pending && setOpen(next)}>
        <DialogContent size="sm">
          <DialogHeader>
            <DialogTitle>Cancelar o contrato {number}?</DialogTitle>
            <DialogDescription>
              O contrato fica cancelado e não pode ser reaberto.{" "}
              {openBillings > 0 ? `${openBillings} cobrança(s) em aberto ou vencida(s) serão canceladas.` : "Não há cobranças em aberto."} Cobranças pagas continuam registradas. O vendedor e o
              Financeiro são avisados.
            </DialogDescription>
          </DialogHeader>
          <DialogBody>
            <FormField label="Motivo do cancelamento" htmlFor={`${id}-r`} required hint="Mínimo de 5 caracteres; fica na timeline do cliente">
              <Textarea id={`${id}-r`} value={reason} onChange={(e) => setReason(e.target.value)} placeholder="Ex.: cliente desistiu antes do pagamento da adesão" />
            </FormField>
          </DialogBody>
          <DialogFooter>
            <Button variant="outline" onClick={() => setOpen(false)} disabled={pending}>
              Voltar
            </Button>
            <Button variant="destructive" onClick={confirm} loading={pending} disabled={reason.trim().length < 5}>
              <Ban /> Confirmar cancelamento
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}

/** Card da página do contrato com a ação de cancelar (fica fora do cabeçalho para não espremer o título). */
export function CancelContractCard(props: CancelContractButtonProps) {
  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <Ban className="size-4 text-muted" /> Cancelamento
        </CardTitle>
        <CardDescription>A venda não vai adiante? Cancele o contrato com o motivo; as cobranças em aberto são canceladas junto.</CardDescription>
      </CardHeader>
      <CardContent className="pt-0">
        <CancelContractButton {...props} className="h-11 w-full text-danger-fg md:h-9" />
      </CardContent>
    </Card>
  );
}
