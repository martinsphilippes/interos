"use client";

import * as React from "react";
import { useRouter } from "next/navigation";
import { CalendarPlus, Handshake, RefreshCw, XCircle } from "lucide-react";
import { createRenewal, markRenewalLost, renewContract, startNegotiation } from "@/server/cs/actions";
import type { ContractReadjustment, Renewal } from "@/domain/types";
import { READJUSTMENT_INDEX_LABELS, READJUSTMENT_TYPE_LABELS } from "@/domain/contract-snapshot";
import { formatCurrency, formatDate } from "@/lib/format";
import { Button } from "@/components/ui/button";
import { Dialog, DialogBody, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { FormField } from "@/components/ui/form-field";
import { Input } from "@/components/ui/input";
import { Select } from "@/components/ui/select";
import { Switch } from "@/components/ui/switch";
import { Textarea } from "@/components/ui/textarea";
import { useCsAction } from "./use-cs";

/** Ações permitidas (calculadas no servidor; padrão: todas, como antes). As actions revalidam. */
export interface RenewalActionCapabilities {
  negotiate: boolean;
  renew: boolean;
  lose: boolean;
  /** Após a perda, abrir o registro de churn (/cs/churn?registrar=) — exige cs.churn.registrar. */
  registerChurn: boolean;
}

const ALL_RENEWAL_ACTIONS: RenewalActionCapabilities = { negotiate: true, renew: true, lose: true, registerChurn: true };

export interface RenewalActionsProps {
  capabilities?: RenewalActionCapabilities;
  renewalId: string;
  status: Renewal["status"];
  tradeName: string;
  contractNumber: string;
  dueDate: string;
  mrr: number;
}

/** Ações de uma renovação aberta: iniciar negociação, renovar (novo prazo no contrato) ou perder (abre o churn). */
export function RenewalActions({ renewalId, status, tradeName, contractNumber, dueDate, mrr, capabilities = ALL_RENEWAL_ACTIONS }: RenewalActionsProps) {
  const router = useRouter();
  const { pending, run } = useCsAction();
  const [dialog, setDialog] = React.useState<"renovar" | "perder" | null>(null);
  const [term, setTerm] = React.useState("12");
  const [notes, setNotes] = React.useState("");
  const [reason, setReason] = React.useState("");
  const [readjustmentType, setReadjustmentType] = React.useState<ContractReadjustment["type"]>("nenhum");
  const [readjustmentPercent, setReadjustmentPercent] = React.useState("");
  const [readjustmentIndex, setReadjustmentIndex] = React.useState<NonNullable<ContractReadjustment["index"]> | "">("");
  const [requiresSignature, setRequiresSignature] = React.useState(false);
  const id = React.useId();
  const readjustmentValid = readjustmentType === "nenhum" || (readjustmentType === "percentual" ? Number(readjustmentPercent.replace(",", ".")) > 0 : Boolean(readjustmentIndex));

  const renew = async (e: React.FormEvent) => {
    e.preventDefault();
    const readjustment: ContractReadjustment = readjustmentType === "percentual" ? { type: "percentual", percent: Number(readjustmentPercent.replace(",", ".")) } : readjustmentType === "indice" ? { type: "indice", index: readjustmentIndex || undefined } : { type: "nenhum" };
    const ok = await run(
      () => renewContract({ renewalId, termMonths: Number(term), notes, readjustment, requiresSignature }),
      (d) => (d.applied ? `Contrato renovado até ${formatDate(d.newEndDate)} (aditivo ${d.amendmentNumber}; mensalidades geradas)` : `Aditivo ${d.amendmentNumber} criado: aguardando assinatura do cliente no Financeiro`),
    );
    if (ok) setDialog(null);
  };
  const lose = async (e: React.FormEvent) => {
    e.preventDefault();
    const ok = await run(
      () => markRenewalLost({ renewalId, reason }),
      capabilities.registerChurn ? "Renovação perdida · registre o cancelamento" : "Renovação perdida",
      (d) => (capabilities.registerChurn ? router.push(`/cs/churn?registrar=${d.clientId}`) : undefined),
    );
    if (ok) setDialog(null);
  };

  return (
    <div className="flex flex-wrap items-center justify-end gap-1">
      {status === "aguardando" && capabilities.negotiate ? (
        <Button size="sm" variant="outline" loading={pending && dialog === null} onClick={() => run(() => startNegotiation({ renewalId }), "Negociação iniciada · tarefa criada")} className="min-h-[44px] md:min-h-0">
          <Handshake /> Negociar
        </Button>
      ) : null}
      {capabilities.renew ? (
        <Button size="sm" variant="primary" onClick={() => setDialog("renovar")} className="min-h-[44px] md:min-h-0">
          <RefreshCw /> Renovar
        </Button>
      ) : null}
      {capabilities.lose ? (
        <Button size="sm" variant="ghost" onClick={() => setDialog("perder")} className="min-h-[44px] text-danger-fg md:min-h-0">
          <XCircle /> Perder
        </Button>
      ) : null}

      <Dialog open={dialog === "renovar"} onOpenChange={(o) => !pending && setDialog(o ? "renovar" : null)}>
        <DialogContent size="sm">
          <form onSubmit={renew} className="contents">
            <DialogHeader>
              <DialogTitle>Renovar contrato {contractNumber}</DialogTitle>
              <DialogDescription>
                {tradeName} · vence {formatDate(dueDate)} · {formatCurrency(mrr)}/mês. A renovação é um aditivo no mesmo contrato: o novo término é somado ao vencimento atual, o prazo original fica preservado e as mensalidades do novo período são geradas.
              </DialogDescription>
            </DialogHeader>
            <DialogBody className="flex flex-col gap-4">
              <FormField label="Prazo da renovação (meses)" htmlFor={`${id}-term`} required>
                <Input id={`${id}-term`} type="number" min={1} max={60} inputMode="numeric" value={term} onChange={(e) => setTerm(e.target.value)} required />
              </FormField>
              <div className="grid gap-3 sm:grid-cols-2" data-testid="renewal-readjustment">
                <FormField label="Reajuste" htmlFor={`${id}-rj`} hint={readjustmentType === "indice" ? "O índice oficial não é buscado: informe o percentual depois (tarefa)" : undefined}>
                  <Select id={`${id}-rj`} value={readjustmentType} onChange={(e) => setReadjustmentType(e.target.value as ContractReadjustment["type"])} options={(Object.keys(READJUSTMENT_TYPE_LABELS) as ContractReadjustment["type"][]).map((t) => ({ value: t, label: READJUSTMENT_TYPE_LABELS[t] }))} />
                </FormField>
                {readjustmentType === "percentual" ? (
                  <FormField label="Percentual (%)" htmlFor={`${id}-rp`} required>
                    <Input id={`${id}-rp`} inputMode="decimal" value={readjustmentPercent} onChange={(e) => setReadjustmentPercent(e.target.value)} placeholder="Ex.: 5" />
                  </FormField>
                ) : readjustmentType === "indice" ? (
                  <FormField label="Índice" htmlFor={`${id}-ri`} required>
                    <Select id={`${id}-ri`} value={readjustmentIndex} onChange={(e) => setReadjustmentIndex(e.target.value as NonNullable<ContractReadjustment["index"]> | "")} placeholder="Escolha" options={(Object.keys(READJUSTMENT_INDEX_LABELS) as NonNullable<ContractReadjustment["index"]>[]).map((i) => ({ value: i, label: READJUSTMENT_INDEX_LABELS[i] }))} />
                  </FormField>
                ) : null}
              </div>
              <Switch label="Exige assinatura do cliente" description={requiresSignature ? "O termo aditivo fica aguardando assinatura no Financeiro; a renovação conclui na aplicação." : "Aplicada na hora (aditivo de renovação sem assinatura)."} checked={requiresSignature} onCheckedChange={setRequiresSignature} className="w-full rounded-lg border border-border px-3 py-2" />
              <FormField label="Condições negociadas" htmlFor={`${id}-notes`}>
                <Textarea id={`${id}-notes`} value={notes} onChange={(e) => setNotes(e.target.value)} className="min-h-[72px]" placeholder="Reajuste, desconto, novos produtos…" />
              </FormField>
            </DialogBody>
            <DialogFooter>
              <Button variant="outline" onClick={() => setDialog(null)} disabled={pending}>
                Cancelar
              </Button>
              <Button type="submit" loading={pending} disabled={!readjustmentValid}>
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
              <DialogDescription>
                {tradeName} não vai renovar o contrato {contractNumber}.{capabilities.registerChurn ? " Em seguida, registre o cancelamento no fluxo de churn." : " O registro do cancelamento fica com quem tem acesso ao Churn."}
              </DialogDescription>
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
