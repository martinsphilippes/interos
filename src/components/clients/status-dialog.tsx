"use client";

import * as React from "react";
import { useRouter } from "next/navigation";
import { CLIENT_STATUS, CLIENT_STATUS_LABELS, type ClientStatus } from "@/domain/constants";
import { changeClientStatus } from "@/server/clients/actions";
import { Button } from "@/components/ui/button";
import { Dialog, DialogBody, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { FormField } from "@/components/ui/form-field";
import { Select } from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import { toast } from "@/components/ui/toast";
import { ClientStatusBadge } from "./client-badges";

export interface StatusDialogProps {
  clientId: string;
  currentStatus: ClientStatus;
  /** Controlado (para abrir a partir de um menu) ou com `trigger`. */
  open?: boolean;
  onOpenChange?: (open: boolean) => void;
  trigger?: React.ReactNode;
}

/** Muda o status do cliente com motivo obrigatório; emite `client.status_changed` na timeline. */
export function StatusDialog({ clientId, currentStatus, open, onOpenChange, trigger }: StatusDialogProps) {
  const router = useRouter();
  const [innerOpen, setInnerOpen] = React.useState(false);
  const isOpen = open ?? innerOpen;
  const setOpen = (next: boolean) => {
    setInnerOpen(next);
    onOpenChange?.(next);
  };
  const [status, setStatus] = React.useState<ClientStatus | "">("");
  const [reason, setReason] = React.useState("");
  const [pending, startTransition] = React.useTransition();
  const id = React.useId();

  const submit = () => {
    if (!status) {
      toast.error("Escolha o novo status");
      return;
    }
    startTransition(async () => {
      const result = await changeClientStatus({ clientId, status, reason });
      if (!result.ok) {
        toast.error(result.error);
        return;
      }
      toast.success(`Status alterado para ${CLIENT_STATUS_LABELS[result.data.status]}`);
      setOpen(false);
      setStatus("");
      setReason("");
      router.refresh();
    });
  };

  return (
    <Dialog open={isOpen} onOpenChange={setOpen}>
      {trigger ? <DialogTrigger asChild>{trigger}</DialogTrigger> : null}
      <DialogContent size="sm">
        <DialogHeader>
          <DialogTitle>Alterar status do cliente</DialogTitle>
          <DialogDescription className="flex items-center gap-2">
            Status atual: <ClientStatusBadge status={currentStatus} />
          </DialogDescription>
        </DialogHeader>
        <form
          className="contents"
          onSubmit={(e) => {
            e.preventDefault();
            submit();
          }}
        >
          <DialogBody className="flex flex-col gap-4 py-2">
            <FormField label="Novo status" htmlFor={`${id}-status`} required>
              <Select id={`${id}-status`} value={status} onChange={(e) => setStatus(e.target.value as ClientStatus)} placeholder="Selecione…" required>
                {CLIENT_STATUS.filter((s) => s !== currentStatus).map((s) => (
                  <option key={s} value={s}>
                    {CLIENT_STATUS_LABELS[s]}
                  </option>
                ))}
              </Select>
            </FormField>
            <FormField label="Motivo" htmlFor={`${id}-reason`} required hint="Fica registrado na timeline e na auditoria.">
              <Textarea id={`${id}-reason`} value={reason} onChange={(e) => setReason(e.target.value)} required minLength={3} className="min-h-[72px]" placeholder="Ex.: cliente fechou a loja; contrato encerrado em comum acordo." />
            </FormField>
            {status === "cancelado" || status === "inativo" ? (
              <p className="rounded-md bg-warning-soft p-3 text-xs text-warning-fg">Esta mudança não cancela contratos nem produtos automaticamente: trate-os no módulo Financeiro/CS.</p>
            ) : null}
          </DialogBody>
          <DialogFooter>
            <Button type="button" variant="outline" onClick={() => setOpen(false)} disabled={pending}>
              Cancelar
            </Button>
            <Button type="submit" variant={status === "cancelado" ? "destructive" : "primary"} loading={pending}>
              Confirmar mudança
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
