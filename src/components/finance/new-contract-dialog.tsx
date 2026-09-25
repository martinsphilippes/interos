"use client";

import * as React from "react";
import { useRouter } from "next/navigation";
import { Plus } from "lucide-react";
import { createContractFromOpportunityAction, createManualContractAction } from "@/server/finance/actions";
import { Button } from "@/components/ui/button";
import { Dialog, DialogBody, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { FormField } from "@/components/ui/form-field";
import { Input } from "@/components/ui/input";
import { SegmentedControl } from "@/components/ui/segmented-control";
import { Select } from "@/components/ui/select";
import { toast } from "@/components/ui/toast";

type Mode = "venda" | "manual";

export interface NewContractDialogProps {
  /** Vendas ganhas ainda sem contrato. */
  opportunities: { id: string; label: string }[];
  clients: { value: string; label: string }[];
}

/**
 * "Novo contrato": a partir de uma venda ganha sem contrato (mesmo caminho idempotente do módulo de Vendas)
 * ou manual para um cliente existente. Em seguida abre o contrato completo para itens e condições.
 */
export function NewContractButton({ opportunities, clients }: NewContractDialogProps) {
  const id = React.useId();
  const router = useRouter();
  const [open, setOpen] = React.useState(false);
  const [mode, setMode] = React.useState<Mode>(opportunities.length > 0 ? "venda" : "manual");
  const [opportunityId, setOpportunityId] = React.useState("");
  const [form, setForm] = React.useState({ clientId: "", recurrence: "mensal", termMonths: "12", billingDay: "10" });
  const [pending, startTransition] = React.useTransition();

  const submit = () =>
    startTransition(async () => {
      const result =
        mode === "venda"
          ? await createContractFromOpportunityAction({ opportunityId })
          : await createManualContractAction({ clientId: form.clientId, recurrence: form.recurrence, termMonths: Number(form.termMonths), billingDay: Number(form.billingDay) });
      if (!result.ok) {
        toast.error(result.error);
        return;
      }
      toast.success(mode === "venda" ? "Contrato gerado a partir da venda" : "Contrato criado: preencha itens e condições");
      setOpen(false);
      router.push(`/financeiro/contratos/${result.data.contractId}`);
    });

  const valid = mode === "venda" ? Boolean(opportunityId) : Boolean(form.clientId) && Number(form.termMonths) >= 1 && Number(form.billingDay) >= 1 && Number(form.billingDay) <= 28;

  return (
    <>
      <Button onClick={() => setOpen(true)} className="h-11 md:h-9">
        <Plus /> Novo contrato
      </Button>
      <Dialog open={open} onOpenChange={(next) => !pending && setOpen(next)}>
        <DialogContent size="md">
          <DialogHeader>
            <DialogTitle>Novo contrato</DialogTitle>
            <DialogDescription>Gere a partir de uma venda ganha ou crie manualmente para um cliente existente.</DialogDescription>
          </DialogHeader>
          <DialogBody className="grid gap-4">
            <SegmentedControl<Mode>
              value={mode}
              onChange={setMode}
              options={[
                { value: "venda", label: `Venda ganha (${opportunities.length})` },
                { value: "manual", label: "Manual" },
              ]}
              aria-label="Origem do contrato"
            />
            {mode === "venda" ? (
              opportunities.length === 0 ? (
                <p className="rounded-lg border border-border bg-surface-muted px-3 py-3 text-sm text-muted">Todas as vendas ganhas já têm contrato.</p>
              ) : (
                <FormField label="Venda ganha sem contrato" htmlFor={`${id}-o`} required hint="Itens, valores e signatário vêm da proposta aceita / oportunidade.">
                  <Select id={`${id}-o`} value={opportunityId} onChange={(e) => setOpportunityId(e.target.value)} placeholder="Selecione a venda" options={opportunities.map((o) => ({ value: o.id, label: o.label }))} />
                </FormField>
              )
            ) : (
              <>
                <FormField label="Cliente" htmlFor={`${id}-c`} required>
                  <Select id={`${id}-c`} value={form.clientId} onChange={(e) => setForm({ ...form, clientId: e.target.value })} placeholder="Selecione o cliente" options={clients} />
                </FormField>
                <div className="grid gap-4 sm:grid-cols-3">
                  <FormField label="Recorrência" htmlFor={`${id}-r`} required>
                    <Select
                      id={`${id}-r`}
                      value={form.recurrence}
                      onChange={(e) => setForm({ ...form, recurrence: e.target.value })}
                      options={[
                        { value: "mensal", label: "Mensal" },
                        { value: "anual", label: "Anual" },
                        { value: "unico", label: "Pagamento único" },
                      ]}
                    />
                  </FormField>
                  <FormField label="Prazo (meses)" htmlFor={`${id}-p`} required>
                    <Input id={`${id}-p`} inputMode="numeric" value={form.termMonths} onChange={(e) => setForm({ ...form, termMonths: e.target.value.replace(/\D/g, "") })} className="h-11 md:h-9" />
                  </FormField>
                  <FormField label="Dia de vencimento" htmlFor={`${id}-d`} required hint="1 a 28">
                    <Input id={`${id}-d`} inputMode="numeric" value={form.billingDay} onChange={(e) => setForm({ ...form, billingDay: e.target.value.replace(/\D/g, "") })} className="h-11 md:h-9" />
                  </FormField>
                </div>
                <p className="text-xs text-muted">O contrato nasce em &quot;aguardando contrato&quot; com o contato principal como signatário. Itens e condições são preenchidos em seguida.</p>
              </>
            )}
          </DialogBody>
          <DialogFooter>
            <Button variant="outline" onClick={() => setOpen(false)} disabled={pending} className="h-11 md:h-9">
              Cancelar
            </Button>
            <Button onClick={submit} loading={pending} disabled={!valid} className="h-11 md:h-9">
              {mode === "venda" ? "Gerar contrato" : "Criar contrato"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}
