"use client";

import * as React from "react";
import { Megaphone } from "lucide-react";
import { escalateToManager } from "@/server/cs/actions";
import { Button } from "@/components/ui/button";
import { Dialog, DialogBody, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { FormField } from "@/components/ui/form-field";
import { Textarea } from "@/components/ui/textarea";
import { useCsAction } from "./use-cs";

/** Escala o risco do cliente ao gestor de CS (notificação crítica + registro na timeline). */
export function EscalateDialog({ clientId, clientName, reasons }: { clientId: string; clientName: string; reasons: string[] }) {
  const [open, setOpen] = React.useState(false);
  const [note, setNote] = React.useState("");
  const { pending, run } = useCsAction();
  const id = React.useId();
  return (
    <>
      <Button size="sm" variant="ghost" onClick={() => setOpen(true)} className="min-h-[44px] md:min-h-0">
        <Megaphone /> Escalar
      </Button>
      <Dialog open={open} onOpenChange={(o) => !pending && setOpen(o)}>
        <DialogContent size="sm">
          <form
            className="contents"
            onSubmit={async (e) => {
              e.preventDefault();
              const ok = await run(() => escalateToManager({ clientId, note }), (d) => `Risco escalado · ${d.notified} gestor(es) notificado(s)`);
              if (ok) {
                setNote("");
                setOpen(false);
              }
            }}
          >
            <DialogHeader>
              <DialogTitle>Escalar risco ao gestor</DialogTitle>
              <DialogDescription>{clientName}: o gestor de CS recebe uma notificação crítica e o registro entra na timeline.</DialogDescription>
            </DialogHeader>
            <DialogBody className="flex flex-col gap-3">
              {reasons.length > 0 ? (
                <ul className="list-disc rounded-md bg-surface-muted p-3 pl-7 text-xs text-muted">
                  {reasons.slice(0, 4).map((r) => (
                    <li key={r}>{r}</li>
                  ))}
                </ul>
              ) : null}
              <FormField label="O que o gestor precisa saber" htmlFor={`${id}-note`} required>
                <Textarea id={`${id}-note`} value={note} onChange={(e) => setNote(e.target.value)} required minLength={5} placeholder="Contexto, o que já foi tentado e a ajuda necessária" />
              </FormField>
            </DialogBody>
            <DialogFooter>
              <Button variant="outline" onClick={() => setOpen(false)} disabled={pending}>
                Cancelar
              </Button>
              <Button type="submit" variant="destructive" loading={pending}>
                Escalar
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>
    </>
  );
}
