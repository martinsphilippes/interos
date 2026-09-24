"use client";

import * as React from "react";
import { BadgeCheck } from "lucide-react";
import { activateCustomer } from "@/server/cs/actions";
import { Button } from "@/components/ui/button";
import { ConfirmDialog } from "@/components/ui/confirm-dialog";
import { useCsAction } from "./use-cs";

export interface ActivateButtonProps {
  clientId: string;
  clientName: string;
  /** Pendências do gate já conhecidas (ficha do cliente); a action revalida de qualquer forma. */
  missing?: string[];
  size?: "sm" | "md";
  variant?: "primary" | "outline";
}

/**
 * Gate de CS: ativa o cliente (adoção mínima + responsável + plano de sucesso ativo). Ao passar, a
 * jornada avança de Customer Success para Suporte.
 */
export function ActivateButton({ clientId, clientName, missing, size = "sm", variant = "primary" }: ActivateButtonProps) {
  const [open, setOpen] = React.useState(false);
  const { run } = useCsAction();
  return (
    <>
      <Button size={size} variant={variant} onClick={() => setOpen(true)} className="min-h-[44px] md:min-h-0">
        <BadgeCheck /> Ativar cliente
      </Button>
      <ConfirmDialog
        open={open}
        onOpenChange={setOpen}
        title={`Ativar ${clientName}?`}
        description="O gate de Customer Success exige adoção mínima, responsável de CS definido e plano de sucesso ativo. Ao ativar, a jornada avança para Suporte."
        confirmLabel="Ativar cliente"
        onConfirm={async () => {
          await run(() => activateCustomer({ clientId }), "Cliente ativado; jornada avançou para Suporte");
        }}
      >
        {missing && missing.length > 0 ? (
          <div className="rounded-md bg-warning-soft p-3 text-sm text-warning-fg">
            <p className="font-medium">Pendências do gate:</p>
            <ul className="mt-1 list-disc pl-5">
              {missing.map((m) => (
                <li key={m}>{m}</li>
              ))}
            </ul>
          </div>
        ) : null}
      </ConfirmDialog>
    </>
  );
}
