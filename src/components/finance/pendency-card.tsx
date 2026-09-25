"use client";

import * as React from "react";
import { CheckCircle2, FileWarning } from "lucide-react";
import { registerPendencyAction, resolvePendencyAction } from "@/server/finance/actions";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { FormField } from "@/components/ui/form-field";
import { Textarea } from "@/components/ui/textarea";
import { useFinanceAction } from "./use-finance-action";

export interface PendencyCardProps {
  contractId: string;
  pendingReason?: string;
  isPending: boolean;
  closed: boolean;
  canOperate: boolean;
}

/** Pendência financeira: registrar (avisa o vendedor) e resolver. */
export function PendencyCard({ contractId, pendingReason, isPending, closed, canOperate }: PendencyCardProps) {
  const id = React.useId();
  const [open, setOpen] = React.useState(false);
  const [text, setText] = React.useState("");
  const { pending, run } = useFinanceAction();

  if (closed && !isPending) return null;

  const register = async () => {
    const ok = await run(() => registerPendencyAction({ contractId, reason: text }), "Pendência registrada; o vendedor foi avisado");
    if (ok) {
      setText("");
      setOpen(false);
    }
  };
  const resolve = async () => {
    const ok = await run(() => resolvePendencyAction({ contractId, resolution: text }), "Pendência resolvida");
    if (ok) {
      setText("");
      setOpen(false);
    }
  };

  return (
    <Card className={isPending ? "border-danger/40" : undefined}>
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <FileWarning className={isPending ? "size-4 text-danger" : "size-4 text-muted"} /> Pendências
        </CardTitle>
        <CardDescription>{isPending ? "O contrato está bloqueado até a pendência ser resolvida." : "Nenhuma pendência aberta."}</CardDescription>
      </CardHeader>
      <CardContent className="flex flex-col gap-3 pt-0">
        {isPending && pendingReason ? <p className="rounded-md bg-danger-soft px-3 py-2 text-sm text-danger-fg">{pendingReason}</p> : null}
        {canOperate && !closed ? (
          open ? (
            <>
              <FormField label={isPending ? "Como foi resolvida (opcional)" : "Motivo da pendência"} htmlFor={`${id}-t`} required={!isPending}>
                <Textarea id={`${id}-t`} value={text} onChange={(e) => setText(e.target.value)} placeholder={isPending ? "Ex.: cliente enviou o comprovante correto" : "Ex.: CNPJ do contrato diverge do cadastro fiscal"} />
              </FormField>
              <div className="flex justify-end gap-2">
                <Button variant="outline" onClick={() => setOpen(false)} disabled={pending} className="h-11 md:h-9">
                  Cancelar
                </Button>
                {isPending ? (
                  <Button onClick={resolve} loading={pending} className="h-11 md:h-9">
                    <CheckCircle2 /> Resolver pendência
                  </Button>
                ) : (
                  <Button variant="destructive" onClick={register} loading={pending} disabled={text.trim().length < 5} className="h-11 md:h-9">
                    Registrar pendência
                  </Button>
                )}
              </div>
            </>
          ) : (
            <Button variant={isPending ? "primary" : "outline"} onClick={() => setOpen(true)} className="h-11 md:h-9">
              {isPending ? (
                <>
                  <CheckCircle2 /> Resolver pendência
                </>
              ) : (
                "Registrar pendência"
              )}
            </Button>
          )
        ) : null}
      </CardContent>
    </Card>
  );
}
