"use client";

import * as React from "react";
import { useRouter } from "next/navigation";
import { CalendarPlus } from "lucide-react";
import type { Address } from "@/domain/types";
import { VISIT_KINDS, VISIT_KIND_LABELS, type VisitKind } from "@/domain/sales-extra";
import { Button } from "@/components/ui/button";
import { DateInput, dateValueToIso, isoToDateTimeLocal } from "@/components/ui/date-input";
import { Dialog, DialogBody, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { FormField } from "@/components/ui/form-field";
import { Input } from "@/components/ui/input";
import { Select } from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import { toast } from "@/components/ui/toast";
import { ClientCombobox } from "@/components/tasks/client-combobox";
import { createVisitAction } from "@/server/sales/actions";
import type { ClientOptionLite, UserLite } from "@/server/sales/queries";
import { useSalesUrl } from "./use-sales-url";

export interface VisitFormOptions {
  clients: ClientOptionLite[];
  sellers: UserLite[];
  addresses: Record<string, Address>;
  opportunitiesByClient: Record<string, { id: string; title: string }[]>;
}

export interface VisitFormDialogProps {
  options: VisitFormOptions;
  currentUserId: string;
  canChooseSeller: boolean;
  /** Pré-seleção (ex.: vindo do drawer da oportunidade). */
  defaults?: { clientId?: string; opportunityId?: string; scheduledAt?: string };
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** Depois de agendar: sem esta prop, abre o drawer da visita (?visita=) na página atual. */
  onCreated?: (visitId: string) => void;
}

const emptyAddress = { street: "", number: "", district: "", city: "", state: "", zip: "" };

function addressDraft(a: Address | undefined) {
  return { street: a?.street ?? "", number: a?.number ?? "", district: a?.district ?? "", city: a?.city ?? "", state: a?.state ?? "", zip: a?.zip ?? "" };
}

/** Agendar visita: endereço pré-preenchido do cadastro do cliente (editável). */
export function VisitFormDialog({ options, currentUserId, canChooseSeller, defaults, open, onOpenChange, onCreated }: VisitFormDialogProps) {
  const router = useRouter();
  const { navigate } = useSalesUrl();
  const id = React.useId();
  const [clientId, setClientId] = React.useState<string | undefined>(defaults?.clientId);
  const [opportunityId, setOpportunityId] = React.useState(defaults?.opportunityId ?? "");
  const [sellerId, setSellerId] = React.useState(currentUserId);
  const [when, setWhen] = React.useState(() => {
    if (defaults?.scheduledAt) return isoToDateTimeLocal(defaults.scheduledAt);
    const d = new Date();
    d.setDate(d.getDate() + 1);
    d.setHours(10, 0, 0, 0);
    return isoToDateTimeLocal(d.toISOString());
  });
  const [duration, setDuration] = React.useState("60");
  const [kind, setKind] = React.useState<VisitKind>("comercial");
  const [objective, setObjective] = React.useState("");
  const [notes, setNotes] = React.useState("");
  const [address, setAddress] = React.useState(defaults?.clientId ? addressDraft(options.addresses[defaults.clientId]) : emptyAddress);
  const [pending, startTransition] = React.useTransition();

  const opps = clientId ? (options.opportunitiesByClient[clientId] ?? []) : [];
  const sellers = options.sellers.some((s) => s.id === currentUserId) ? options.sellers : [{ id: currentUserId, name: "Eu" }, ...options.sellers];

  const chooseClient = (next: string | undefined) => {
    setClientId(next);
    setOpportunityId("");
    setAddress(next ? addressDraft(options.addresses[next]) : emptyAddress);
  };

  const submit = () => {
    const iso = dateValueToIso(when);
    if (!iso) {
      toast.error("Informe data e hora");
      return;
    }
    startTransition(async () => {
      const result = await createVisitAction({ clientId, opportunityId, sellerId, scheduledAt: iso, durationMinutes: Number(duration), objective, notes, address, kind });
      if (!result.ok) {
        toast.error(result.error);
        return;
      }
      toast.success("Visita agendada");
      onOpenChange(false);
      if (onCreated) onCreated(result.data.id);
      else navigate({ visita: result.data.id, nova: null, cliente: null, oportunidade: null }, { replace: true });
      router.refresh();
    });
  };

  const field = (key: keyof typeof address, label: string, className?: string) => (
    <FormField label={label} htmlFor={`${id}-${key}`} className={className}>
      <Input id={`${id}-${key}`} value={address[key]} onChange={(e) => setAddress((a) => ({ ...a, [key]: e.target.value }))} maxLength={key === "state" ? 2 : undefined} />
    </FormField>
  );

  return (
    <Dialog open={open} onOpenChange={(v) => !pending && onOpenChange(v)}>
      <DialogContent size="lg">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <CalendarPlus className="size-5 text-secondary" /> Agendar visita
          </DialogTitle>
          <DialogDescription>O endereço vem do cadastro do cliente; ajuste se a visita for em outro local.</DialogDescription>
        </DialogHeader>
        <DialogBody className="flex flex-col gap-4">
          <div className="grid gap-3 sm:grid-cols-2">
            <FormField label="Cliente" htmlFor={`${id}-c`} required>
              <ClientCombobox id={`${id}-c`} clients={options.clients} value={clientId} onChange={chooseClient} placeholder="Escolha o cliente" />
            </FormField>
            <FormField label="Oportunidade" htmlFor={`${id}-o`}>
              <Select id={`${id}-o`} value={opportunityId} onChange={(e) => setOpportunityId(e.target.value)} disabled={opps.length === 0} options={[{ value: "", label: opps.length ? "Sem vínculo" : "Nenhuma aberta" }, ...opps.map((o) => ({ value: o.id, label: o.title }))]} />
            </FormField>
          </div>
          <div className="grid gap-3 sm:grid-cols-3">
            <FormField label="Vendedor" htmlFor={`${id}-s`} required>
              <Select id={`${id}-s`} value={sellerId} onChange={(e) => setSellerId(e.target.value)} disabled={!canChooseSeller} options={sellers.map((s) => ({ value: s.id, label: s.name }))} />
            </FormField>
            <FormField label="Data e hora" htmlFor={`${id}-w`} required>
              <DateInput id={`${id}-w`} mode="datetime-local" value={when} onChange={(e) => setWhen(e.target.value)} />
            </FormField>
            <FormField label="Duração" htmlFor={`${id}-d`}>
              <Select id={`${id}-d`} value={duration} onChange={(e) => setDuration(e.target.value)} options={["30", "45", "60", "90", "120", "180"].map((m) => ({ value: m, label: `${m} min` }))} />
            </FormField>
          </div>
          <div className="grid gap-3 sm:grid-cols-[180px_1fr]">
            <FormField label="Tipo" htmlFor={`${id}-k`} required>
              <Select id={`${id}-k`} value={kind} onChange={(e) => setKind(e.target.value as VisitKind)} options={VISIT_KINDS.map((k) => ({ value: k, label: VISIT_KIND_LABELS[k] }))} />
            </FormField>
            <FormField label="Motivo / objetivo" htmlFor={`${id}-ob`} required>
              <Input id={`${id}-ob`} value={objective} onChange={(e) => setObjective(e.target.value)} placeholder="Ex.: Diagnóstico no ponto de venda" />
            </FormField>
          </div>
          <fieldset className="grid gap-3 sm:grid-cols-6">
            <legend className="mb-1 text-[13px] font-medium">Endereço</legend>
            {field("street", "Logradouro", "sm:col-span-4")}
            {field("number", "Número", "sm:col-span-2")}
            {field("district", "Bairro", "sm:col-span-2")}
            {field("city", "Cidade", "sm:col-span-2")}
            {field("state", "UF", "sm:col-span-1")}
            {field("zip", "CEP", "sm:col-span-1")}
          </fieldset>
          <FormField label="Observações" htmlFor={`${id}-n`}>
            <Textarea id={`${id}-n`} value={notes} onChange={(e) => setNotes(e.target.value)} className="min-h-[64px]" />
          </FormField>
        </DialogBody>
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)} disabled={pending}>
            Cancelar
          </Button>
          <Button onClick={submit} loading={pending} disabled={!clientId || objective.trim().length < 3 || !when}>
            Agendar
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

/** Botão que abre o formulário (também aberto por ?nova=1&cliente=&oportunidade= na URL). */
export function NewVisitButton(props: Omit<VisitFormDialogProps, "open" | "onOpenChange"> & { initiallyOpen?: boolean; label?: string }) {
  const { navigate } = useSalesUrl();
  const [open, setOpen] = React.useState(Boolean(props.initiallyOpen));
  const change = (v: boolean) => {
    setOpen(v);
    if (!v && props.initiallyOpen) navigate({ nova: null, cliente: null, oportunidade: null }, { replace: true });
  };
  return (
    <>
      <Button onClick={() => setOpen(true)} className="min-h-[44px] md:min-h-0">
        <CalendarPlus /> {props.label ?? "Agendar visita"}
      </Button>
      {open ? <VisitFormDialog {...props} open onOpenChange={change} /> : null}
    </>
  );
}
