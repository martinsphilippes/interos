"use client";

import * as React from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { Dialog, DialogBody, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { FormField } from "@/components/ui/form-field";
import { Input } from "@/components/ui/input";
import { Select } from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import { toast } from "@/components/ui/toast";
import { markOpportunityLostAction } from "@/server/sales/actions";
import { LOSS_REASONS, LOSS_REASON_LABELS, type LossReason } from "@/server/sales/schemas";

export interface LostDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  opportunity: { id: string; title: string };
  onLost?: () => void;
}

/** "Marcar como perdido": motivo obrigatório, concorrente quando o motivo é concorrente, observação. */
export function LostDialog({ open, onOpenChange, opportunity, onLost }: LostDialogProps) {
  const router = useRouter();
  const id = React.useId();
  const [reason, setReason] = React.useState<LossReason | "">("");
  const [competitor, setCompetitor] = React.useState("");
  const [notes, setNotes] = React.useState("");
  const [pending, startTransition] = React.useTransition();
  const valid = reason !== "" && (reason !== "concorrente" || competitor.trim().length > 0);

  const submit = () => {
    startTransition(async () => {
      const result = await markOpportunityLostAction({ opportunityId: opportunity.id, reason, competitor, notes });
      if (!result.ok) {
        toast.error(result.error);
        return;
      }
      toast.success("Oportunidade marcada como perdida");
      onOpenChange(false);
      onLost?.();
      router.refresh();
    });
  };

  return (
    <Dialog open={open} onOpenChange={(next) => !pending && onOpenChange(next)}>
      <DialogContent size="md">
        <DialogHeader>
          <DialogTitle>Marcar como perdido</DialogTitle>
          <DialogDescription>{opportunity.title}. O motivo alimenta os relatórios de vendas e volta para o Marketing no lead de origem.</DialogDescription>
        </DialogHeader>
        <DialogBody className="flex flex-col gap-4">
          <FormField label="Motivo" htmlFor={`${id}-r`} required>
            <Select id={`${id}-r`} value={reason} onChange={(e) => setReason(e.target.value as LossReason)} placeholder="Selecione o motivo" options={LOSS_REASONS.map((r) => ({ value: r, label: LOSS_REASON_LABELS[r] }))} />
          </FormField>
          {reason === "concorrente" ? (
            <FormField label="Concorrente" htmlFor={`${id}-c`} required>
              <Input id={`${id}-c`} value={competitor} onChange={(e) => setCompetitor(e.target.value)} placeholder="Quem ganhou o negócio?" />
            </FormField>
          ) : null}
          <FormField label="Observação" htmlFor={`${id}-n`}>
            <Textarea id={`${id}-n`} value={notes} onChange={(e) => setNotes(e.target.value)} placeholder="Contexto da perda, o que poderia ter sido diferente…" />
          </FormField>
        </DialogBody>
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)} disabled={pending}>
            Cancelar
          </Button>
          <Button variant="destructive" onClick={submit} loading={pending} disabled={!valid}>
            Marcar como perdido
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
