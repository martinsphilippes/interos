"use client";

import * as React from "react";
import { UserMinus } from "lucide-react";
import type { ChurnFormClient, UserLite } from "@/server/cs/queries";
import { registerChurn } from "@/server/cs/actions";
import { CHURN_REASON_KEYS, CHURN_REASON_LABELS } from "@/server/cs/schemas";
import type { ChurnRecord } from "@/domain/types";
import { formatCurrency } from "@/lib/format";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { DateInput, dateValueToIso, isoToDateValue } from "@/components/ui/date-input";
import { Dialog, DialogBody, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { FormField } from "@/components/ui/form-field";
import { Select } from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import { ClientCombobox } from "@/components/tasks/client-combobox";
import { useCsAction, useCsUrl } from "./use-cs";

export interface ChurnDialogProps {
  clients: ChurnFormClient[];
  users: UserLite[];
  currentUserId: string;
  /** Cliente pré-selecionado (?registrar=<id>, vindo de uma renovação perdida). */
  initialClientId?: string;
}

/** Registro de cancelamento (total ou parcial): produtos, receita perdida, motivo e contexto. */
export function ChurnDialog({ clients, users, currentUserId, initialClientId }: ChurnDialogProps) {
  const { navigate } = useCsUrl();
  const initial = initialClientId && clients.some((c) => c.id === initialClientId) ? initialClientId : undefined;
  const [open, setOpen] = React.useState(Boolean(initial));
  const { pending, run } = useCsAction();
  const [clientId, setClientId] = React.useState<string | undefined>(initial);
  const client = clients.find((c) => c.id === clientId);
  const [checked, setChecked] = React.useState<Set<string>>(() => new Set(client?.products.map((p) => p.id) ?? []));
  const [reasonCategory, setReasonCategory] = React.useState<ChurnRecord["reasonCategory"]>("preco");
  const [reason, setReason] = React.useState("");
  const [responsibleId, setResponsibleId] = React.useState(client?.ownerCsId ?? currentUserId);
  const [date, setDate] = React.useState(isoToDateValue(new Date().toISOString()));
  const [context, setContext] = React.useState("");
  const id = React.useId();

  const chooseClient = (next: string | undefined) => {
    setClientId(next);
    const c = clients.find((x) => x.id === next);
    setChecked(new Set(c?.products.map((p) => p.id) ?? []));
    if (c?.ownerCsId) setResponsibleId(c.ownerCsId);
  };
  const toggle = (pid: string, on: boolean) =>
    setChecked((prev) => {
      const next = new Set(prev);
      if (on) next.add(pid);
      else next.delete(pid);
      return next;
    });

  const selected = client?.products.filter((p) => checked.has(p.id)) ?? [];
  const lost = selected.filter((p) => p.status === "ativo" || p.status === "suspenso").reduce((s, p) => s + p.monthlyValue, 0);
  const full = Boolean(client) && selected.length === client!.products.length;

  const close = () => {
    setOpen(false);
    if (initialClientId) navigate({ registrar: null }, { replace: true });
  };

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    const ok = await run(
      () => registerChurn({ clientId: clientId ?? "", clientProductIds: Array.from(checked), reasonCategory, reason, responsibleId, date: dateValueToIso(date ? `${date}T12:00` : "") ?? "", context }),
      (d) => (d.fullChurn ? `Cancelamento registrado · MRR perdido ${formatCurrency(d.lostMrr)}` : `Cancelamento parcial registrado · MRR restante ${formatCurrency(d.newMrr)}`),
    );
    if (ok) {
      setReason("");
      setContext("");
      chooseClient(undefined);
      close();
    }
  };

  return (
    <>
      <Button onClick={() => setOpen(true)} variant="destructive" size="sm">
        <UserMinus /> Registrar cancelamento
      </Button>
      <Dialog
        open={open}
        onOpenChange={(o) => {
          if (pending) return;
          if (o) setOpen(true);
          else close();
        }}
      >
        <DialogContent size="lg">
          <form onSubmit={submit} className="flex min-h-0 flex-1 flex-col">
            <DialogHeader>
              <DialogTitle>Registrar cancelamento</DialogTitle>
              <DialogDescription>Os produtos marcados são cancelados; o contrato é cancelado quando fica sem produto vigente e o cliente, quando cancela tudo.</DialogDescription>
            </DialogHeader>
            <DialogBody className="flex flex-col gap-4">
              <FormField label="Cliente" htmlFor={`${id}-client`} required>
                <ClientCombobox id={`${id}-client`} clients={clients.map((c) => ({ id: c.id, tradeName: c.tradeName, status: "ativo" }))} value={clientId} onChange={chooseClient} placeholder="Selecione o cliente" />
              </FormField>
              {client ? (
                <fieldset className="rounded-md border border-border p-3">
                  <legend className="px-1 text-[13px] font-medium">Produtos cancelados</legend>
                  <div className="flex flex-col gap-1">
                    {client.products.map((p) => (
                      <Checkbox
                        key={p.id}
                        checked={checked.has(p.id)}
                        onCheckedChange={(v) => toggle(p.id, v === true)}
                        label={p.name}
                        description={`${formatCurrency(p.monthlyValue)}/mês${p.status !== "ativo" ? ` · ${p.status.replace("_", " ")}` : ""}`}
                      />
                    ))}
                  </div>
                  <p className="mt-2 text-sm">
                    Receita perdida: <strong className="tabular-nums">{formatCurrency(lost)}/mês</strong>
                    {full ? <span className="text-danger-fg"> · cancelamento total do cliente</span> : selected.length > 0 ? <span className="text-muted"> · cancelamento parcial</span> : null}
                  </p>
                </fieldset>
              ) : null}
              <div className="grid gap-4 sm:grid-cols-2">
                <FormField label="Categoria do motivo" htmlFor={`${id}-cat`} required>
                  <Select id={`${id}-cat`} value={reasonCategory} onChange={(e) => setReasonCategory(e.target.value as ChurnRecord["reasonCategory"])} options={CHURN_REASON_KEYS.map((k) => ({ value: k, label: CHURN_REASON_LABELS[k] }))} />
                </FormField>
                <FormField label="Data do cancelamento" htmlFor={`${id}-date`} required>
                  <DateInput id={`${id}-date`} value={date} onChange={(e) => setDate(e.target.value)} required />
                </FormField>
              </div>
              <FormField label="Motivo" htmlFor={`${id}-reason`} required>
                <Textarea id={`${id}-reason`} value={reason} onChange={(e) => setReason(e.target.value)} className="min-h-[64px]" required minLength={5} placeholder="O que o cliente relatou" />
              </FormField>
              <div className="grid gap-4 sm:grid-cols-2">
                <FormField label="Responsável" htmlFor={`${id}-resp`} required>
                  <Select id={`${id}-resp`} value={responsibleId} onChange={(e) => setResponsibleId(e.target.value)} options={users.map((u) => ({ value: u.id, label: u.name }))} />
                </FormField>
              </div>
              <FormField label="Contexto" htmlFor={`${id}-context`} hint="Tentativas de retenção, concorrente, histórico relevante.">
                <Textarea id={`${id}-context`} value={context} onChange={(e) => setContext(e.target.value)} className="min-h-[64px]" />
              </FormField>
            </DialogBody>
            <DialogFooter>
              <Button variant="outline" onClick={close} disabled={pending}>
                Cancelar
              </Button>
              <Button type="submit" variant="destructive" loading={pending} disabled={!client || selected.length === 0}>
                Registrar cancelamento
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>
    </>
  );
}
