"use client";

import * as React from "react";
import { registerWaitingClient } from "@/server/implementation/actions";
import { Button } from "@/components/ui/button";
import { DateInput, dateValueToIso, isoToDateTimeLocal } from "@/components/ui/date-input";
import { Dialog, DialogBody, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { FormField } from "@/components/ui/form-field";
import { Input } from "@/components/ui/input";
import { Select } from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import { useImplementationAction } from "./use-implementation-action";

export interface WaitingClientDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  projectId: string;
  clientName: string;
  users: { id: string; name: string }[];
  defaultResponsibleId: string;
}

/** Registra a pendência do cliente: status AGUARDANDO CLIENTE, SLA do projeto e etapa de workflow pausados. */
export function WaitingClientDialog({ open, onOpenChange, projectId, clientName, users, defaultResponsibleId }: WaitingClientDialogProps) {
  const { pending, run } = useImplementationAction();
  const [reason, setReason] = React.useState("");
  const [since, setSince] = React.useState(() => isoToDateTimeLocal(new Date().toISOString()));
  const [responsibleId, setResponsibleId] = React.useState(defaultResponsibleId);
  const [evidence, setEvidence] = React.useState("");

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    const ok = await run(
      () => registerWaitingClient({ projectId, reason, since: dateValueToIso(since), responsibleId, evidence }),
      "Pendência registrada: SLA pausado até o cliente responder",
    );
    if (ok) {
      setReason("");
      setEvidence("");
      onOpenChange(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={(v) => !pending && onOpenChange(v)}>
      <DialogContent>
        <form onSubmit={submit} className="flex min-h-0 flex-col">
          <DialogHeader>
            <DialogTitle>Aguardando o cliente</DialogTitle>
            <DialogDescription>{clientName}: o SLA do projeto e a etapa da jornada ficam pausados; o tempo parado conta como atraso externo.</DialogDescription>
          </DialogHeader>
          <DialogBody className="flex flex-col gap-4">
            <FormField label="Motivo" htmlFor="wc-reason" required>
              <Textarea id="wc-reason" value={reason} onChange={(e) => setReason(e.target.value)} placeholder="Ex.: cliente não enviou o certificado digital A1" required maxLength={500} />
            </FormField>
            <div className="grid gap-4 sm:grid-cols-2">
              <FormField label="Desde" htmlFor="wc-since" required>
                <DateInput id="wc-since" mode="datetime-local" value={since} onChange={(e) => setSince(e.target.value)} required />
              </FormField>
              <FormField label="Responsável pelo acompanhamento" htmlFor="wc-resp" required>
                <Select id="wc-resp" value={responsibleId} onChange={(e) => setResponsibleId(e.target.value)} required>
                  {users.map((u) => (
                    <option key={u.id} value={u.id}>
                      {u.name}
                    </option>
                  ))}
                </Select>
              </FormField>
            </div>
            <FormField label="Evidência" htmlFor="wc-evidence" hint="Ex.: print do WhatsApp, e-mail enviado, link do registro">
              <Input id="wc-evidence" value={evidence} onChange={(e) => setEvidence(e.target.value)} maxLength={1000} />
            </FormField>
          </DialogBody>
          <DialogFooter>
            <Button variant="outline" onClick={() => onOpenChange(false)} disabled={pending}>
              Cancelar
            </Button>
            <Button type="submit" loading={pending}>
              Registrar pendência
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
