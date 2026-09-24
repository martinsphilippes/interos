"use client";

import * as React from "react";
import { FileCheck2 } from "lucide-react";
import { registerManualSignatureAction } from "@/server/finance/actions";
import { dateKey } from "@/lib/format";
import { Button, type ButtonProps } from "@/components/ui/button";
import { DateInput } from "@/components/ui/date-input";
import { Dialog, DialogBody, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { FormField } from "@/components/ui/form-field";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { useFinanceAction } from "./use-finance-action";

export interface ManualSignatureButtonProps {
  contractId: string;
  contractNumber: string;
  signer: { name: string; email: string; role: string };
  label?: string;
  variant?: ButtonProps["variant"];
  size?: ButtonProps["size"];
  className?: string;
}

/**
 * "Registrar assinatura manual": a assinatura aconteceu fora do sistema (papel, e-mail de aceite, outro
 * provedor). Exige evidência — link do documento assinado ou descrição — e a data.
 */
export function ManualSignatureButton({ contractId, contractNumber, signer, label, variant = "outline", size = "sm", className }: ManualSignatureButtonProps) {
  const id = React.useId();
  const [open, setOpen] = React.useState(false);
  const [form, setForm] = React.useState(() => ({ signedAt: dateKey(new Date()), evidenceUrl: "", description: "" }));
  const { pending, run } = useFinanceAction();
  const hasEvidence = form.evidenceUrl.trim().length > 0 || form.description.trim().length >= 10;

  const submit = async () => {
    const ok = await run(
      () => registerManualSignatureAction({ contractId, email: signer.email, signedAt: form.signedAt, evidenceUrl: form.evidenceUrl.trim(), description: form.description.trim() }),
      (d) => (d.allSigned ? `Contrato ${contractNumber} assinado por todos` : `Assinatura de ${signer.name} registrada`),
    );
    if (ok) {
      setOpen(false);
      setForm({ signedAt: dateKey(new Date()), evidenceUrl: "", description: "" });
    }
  };

  return (
    <>
      <Button variant={variant} size={size} className={className} onClick={() => setOpen(true)}>
        <FileCheck2 /> {label ?? `Registrar assinatura de ${signer.name.split(" ")[0]}`}
      </Button>
      <Dialog open={open} onOpenChange={(next) => !pending && setOpen(next)}>
        <DialogContent size="md">
          <DialogHeader>
            <DialogTitle>Registrar assinatura manual</DialogTitle>
            <DialogDescription>
              {signer.name} ({signer.role}) · {signer.email} · contrato {contractNumber}. Use quando a assinatura foi feita fora do INTEROS: informe a evidência.
            </DialogDescription>
          </DialogHeader>
          <DialogBody className="grid gap-4">
            <FormField label="Data da assinatura" htmlFor={`${id}-d`} required>
              <DateInput id={`${id}-d`} value={form.signedAt} max={dateKey(new Date())} onChange={(e) => setForm({ ...form, signedAt: e.target.value })} className="h-11 md:h-9" />
            </FormField>
            <FormField label="Link do documento assinado" htmlFor={`${id}-u`} hint="URL do PDF assinado (Drive, provedor externo…). Entra nos documentos do contrato.">
              <Input id={`${id}-u`} type="url" placeholder="https://" value={form.evidenceUrl} onChange={(e) => setForm({ ...form, evidenceUrl: e.target.value })} className="h-11 md:h-9" />
            </FormField>
            <FormField label="Descrição da evidência" htmlFor={`${id}-t`} hint="Obrigatória sem link (mín. 10 caracteres). Ex.: via física assinada arquivada na pasta do cliente.">
              <Textarea id={`${id}-t`} value={form.description} onChange={(e) => setForm({ ...form, description: e.target.value })} placeholder="Como e onde a assinatura foi obtida" />
            </FormField>
            {!hasEvidence ? <p className="text-xs text-warning-fg">Informe o link do documento assinado ou uma descrição da evidência.</p> : null}
          </DialogBody>
          <DialogFooter>
            <Button variant="outline" onClick={() => setOpen(false)} disabled={pending} className="h-11 md:h-9">
              Cancelar
            </Button>
            <Button onClick={submit} loading={pending} disabled={!hasEvidence || !form.signedAt} className="h-11 md:h-9">
              Registrar assinatura
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}
