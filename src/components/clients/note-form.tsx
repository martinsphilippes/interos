"use client";

import * as React from "react";
import { useRouter } from "next/navigation";
import { StickyNote } from "lucide-react";
import { addNote } from "@/server/clients/actions";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { Dialog, DialogBody, DialogContent, DialogDescription, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { toast } from "@/components/ui/toast";
import { cn } from "@/lib/utils";

export interface NoteFormProps {
  clientId: string;
  /** Chamado após registrar com sucesso. */
  onSaved?: () => void;
  autoFocus?: boolean;
  className?: string;
}

/** Campo de nota rápida: registra `note.added` na timeline do cliente. */
export function NoteForm({ clientId, onSaved, autoFocus, className }: NoteFormProps) {
  const router = useRouter();
  const [body, setBody] = React.useState("");
  const [pending, startTransition] = React.useTransition();

  const submit = () => {
    if (body.trim().length < 2) {
      toast.error("Escreva a nota antes de registrar");
      return;
    }
    startTransition(async () => {
      const result = await addNote({ clientId, body });
      if (!result.ok) {
        toast.error(result.error);
        return;
      }
      toast.success("Nota registrada na timeline");
      setBody("");
      router.refresh();
      onSaved?.();
    });
  };

  return (
    <form
      className={cn("flex flex-col gap-2", className)}
      onSubmit={(e) => {
        e.preventDefault();
        submit();
      }}
    >
      <label htmlFor={`note-${clientId}`} className="sr-only">
        Nova nota
      </label>
      <Textarea
        id={`note-${clientId}`}
        value={body}
        onChange={(e) => setBody(e.target.value)}
        placeholder="Registrar uma nota sobre o cliente (ligação, reunião, combinado, observação)…"
        className="min-h-[72px]"
        autoFocus={autoFocus}
        onKeyDown={(e) => {
          if ((e.ctrlKey || e.metaKey) && e.key === "Enter") submit();
        }}
      />
      <div className="flex items-center justify-between gap-2">
        <span className="hidden text-xs text-muted sm:inline">Ctrl+Enter para registrar</span>
        <Button type="submit" size="sm" loading={pending} className="ml-auto">
          <StickyNote /> Registrar nota
        </Button>
      </div>
    </form>
  );
}

export interface NoteDialogProps {
  clientId: string;
  clientName: string;
  /** Sem trigger, o diálogo é controlado por `open`/`onOpenChange` (ex.: item de menu). */
  trigger?: React.ReactNode;
  open?: boolean;
  onOpenChange?: (open: boolean) => void;
}

export function NoteDialog({ clientId, clientName, trigger, open: openProp, onOpenChange }: NoteDialogProps) {
  const [innerOpen, setInnerOpen] = React.useState(false);
  const open = openProp ?? innerOpen;
  const setOpen = onOpenChange ?? setInnerOpen;
  return (
    <Dialog open={open} onOpenChange={setOpen}>
      {trigger ? <DialogTrigger asChild>{trigger}</DialogTrigger> : null}
      <DialogContent size="md">
        <DialogHeader>
          <DialogTitle>Registrar nota</DialogTitle>
          <DialogDescription>A nota entra na linha do tempo de {clientName} com seu nome e a hora.</DialogDescription>
        </DialogHeader>
        <DialogBody className="pb-5">
          <NoteForm clientId={clientId} autoFocus onSaved={() => setOpen(false)} />
        </DialogBody>
      </DialogContent>
    </Dialog>
  );
}
