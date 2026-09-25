"use client";

import * as React from "react";
import { useRouter } from "next/navigation";
import { CalendarPlus, Handshake, RefreshCw, XCircle } from "lucide-react";
import { createRenewal, markRenewalLost, renewContract, startNegotiation } from "@/server/cs/actions";
import type { Renewal } from "@/domain/types";
import { formatCurrency, formatDate } from "@/lib/format";
import { Button } from "@/components/ui/button";
import { Dialog, DialogBody, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { FormField } from "@/components/ui/form-field";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { useCsAction } from "./use-cs";

export interface RenewalActionsProps {
  renewalId: string;
  status: Renewal["status"];
  tradeName: string;
  contractNumber: string;
  dueDate: string;
  mrr: number;
}

/** Ações de uma renovação aberta: iniciar negociação, renovar (novo prazo no contrato) ou perder (abre o churn). */
export function RenewalActions({ renewalId, status, tradeName, contractNumber, dueDate, mrr }: RenewalActionsProps) {
  const router = useRouter();
  const { pending, run } = useCsAction();
  const [dialog, setDialog] = React.useState<"renovar" | "perder" | null>(null);
  const [term, setTerm] = React.useState("12");
  const [notes, setNotes] = React.useState("");
  const [reason, setReason] = React.useState("");
  const id = React.useId();

  const renew = async (e: React.FormEvent) => {
    e.preventDefault();
    const ok = await run(() => renewContract({ renewalId, termMonths: Number(term), notes }), (d) => `Contrato renovado até ${formatDate(d.newEndDate)}`);
    if (ok) setDialog(null);
  };
  const lose = async (e: React.FormEvent) => {
    e.preventDefault();
    const ok = await run(
      () => markRenewalLost({ renewalId, reason }),
      "Renovação perdida · registre o cancelamento",
      (d) => router.push(`/cs/churn?registrar=${d.clientId}`),
    );
    if (ok) setDialog(null);
  };

  return (
    <div className="flex flex-wrap items-center justify-end gap-1">
      {status === "aguardando" ? (
        <Button size="sm" variant="outline" loading={pending && dialog === null} onClick={() => run(() => startNegotiation({ renewalId }), "Negociação iniciada · tarefa criada")} className="min-h-[44px] md:min-h-0">
          <Handshake /> Negociar
        </Button>
      ) : null}
      <Button size="sm" variant="primary" onClick={() => setDialog("renovar")} className="min-h-[44px] md:min-h-0">
        <RefreshCw /> Renovar
      </Button>
      <Button size="sm" variant="ghost" onClick={() => setDialog("perder")} className="min-h-[44px] text-danger-fg md:min-h-0">
        <XCircle /> Perder
      </Button>

      <Dialog open={dialog === "renovar"} onOpenChange={(o) => !pending && setDialog(o ? "renovar" : null)}>
        <DialogContent size="sm">
          <form onSubmit={renew} className="contents">
            <DialogHeader>
              <DialogTitle>Renovar contrato {contractNumber}</DialogTitle>
              <DialogDescription>
                {tradeName} · vence {formatDate(dueDate)} · {formatCurrency(mrr)}/mês. O novo término é somado a partir do vencimento atual.
              </DialogDescription>
            </DialogHeader>
            <DialogBody className="flex flex-col gap-4">
              <FormField label="Prazo da renovação (meses)" htmlFor={`${id}-term`} required>
                <Input id={`${id}-term`} type="number" min={1} max={60} inputMode="numeric" value={term} onChange={(e) => setTerm(e.target.value)} required />
              </FormField>
              <FormField label="Condições negociadas" htmlFor={`${id}-notes`}>
                <Textarea id={`${id}-notes`} value={notes} onChange={(e) => setNotes(e.target.value)} className="min-h-[72px]" placeholder="Reajuste, desconto, novos produtos…" />
              </FormField>
            </DialogBody>
            <DialogFooter>
              <Button variant="outline" onClick={() => setDialog(null)} disabled={pending}>
                Cancelar
              </Button>
              <Button type="submit" loading={pending}>
                Confirmar renovação
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>

      <Dialog open={dialog === "perder"} onOpenChange={(o) => !pending && setDialog(o ? "perder" : null)}>
        <DialogContent size="sm">
          <form onSubmit={lose} className="contents">
            <DialogHeader>
              <DialogTitle>Renovação perdida</DialogTitle>
              <DialogDescription>{tradeName} não vai renovar o contrato {contractNumber}. Em seguida, registre o cancelamento no fluxo de churn.</DialogDescription>
            </DialogHeader>
            <DialogBody>
              <FormField label="Motivo" htmlFor={`${id}-reason`} required>
                <Textarea id={`${id}-reason`} value={reason} onChange={(e) => setReason(e.target.value)} required minLength={5} placeholder="Por que o cliente não renovou?" />
              </FormField>
            </DialogBody>
            <DialogFooter>
              <Button variant="outline" onClick={() => setDialog(null)} disabled={pending}>
                Cancelar
              </Button>
              <Button type="submit" variant="destructive" loading={pending}>
                Registrar perda
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>
    </div>
  );
}

export function CreateRenewalButton({ contractId }: { contractId: string }) {
  const { pending, run } = useCsAction();
  return (
    <Button size="sm" variant="outline" loading={pending} onClick={() => run(() => createRenewal({ contractId }), "Renovação criada · tarefa de preparação gerada")} className="min-h-[44px] md:min-h-0">
      {!pending ? <CalendarPlus /> : null} Criar renovação
    </Button>
  );
}
