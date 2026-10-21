"use client";

import * as React from "react";
import { useRouter } from "next/navigation";
import { ArrowRightLeft } from "lucide-react";
import { transferConversationAction } from "@/server/conversations/actions";
import type { ConversationDetail } from "@/server/conversations/queries";
import { USER_PRESENCE_LABELS } from "@/domain/types";
import { Button } from "@/components/ui/button";
import { Dialog, DialogBody, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { FormField } from "@/components/ui/form-field";
import { SegmentedControl } from "@/components/ui/segmented-control";
import { Textarea } from "@/components/ui/textarea";
import { toast } from "@/components/ui/toast";
import { cn } from "@/lib/utils";

export interface TransferOptions {
  users: { id: string; name: string; presence?: "online" | "ausente" | "ocupado"; load: number; queueNames: string[] }[];
  queues: { id: string; name: string; channels: ("whatsapp" | "email")[] }[];
}

/** Transferir para uma pessoa (com presença e carga) ou para uma fila. Nota obrigatória; o SLA continua. */
export function TransferDialog({ detail, options, open, onOpenChange, currentUserId }: { detail: ConversationDetail; options: TransferOptions; open: boolean; onOpenChange: (v: boolean) => void; currentUserId: string }) {
  const router = useRouter();
  const [target, setTarget] = React.useState<"pessoa" | "fila">("pessoa");
  const [userId, setUserId] = React.useState("");
  const [queueId, setQueueId] = React.useState("");
  const [note, setNote] = React.useState("");
  const [pending, startTransition] = React.useTransition();
  const c = detail.conversation;
  const people = options.users.filter((u) => u.id !== c.assigneeId);
  const queues = options.queues.filter((q) => q.channels.includes(c.channel));
  const ready = note.trim().length >= 3 && (target === "pessoa" ? Boolean(userId) : Boolean(queueId));

  const submit = () =>
    startTransition(async () => {
      const r = await transferConversationAction({ conversationId: c.id, toUserId: target === "pessoa" ? userId : undefined, toQueueId: target === "fila" ? queueId : undefined, note });
      if (!r.ok) return void toast.error(r.error);
      toast.success("Conversa transferida");
      onOpenChange(false);
      setNote("");
      router.refresh();
    });

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent size="md">
        <DialogHeader>
          <DialogTitle>Transferir conversa</DialogTitle>
          <DialogDescription>
            {c.number} · o prazo de SLA continua de onde estava.
          </DialogDescription>
        </DialogHeader>
        <DialogBody className="flex flex-col gap-4">
          <SegmentedControl
            aria-label="Destino"
            value={target}
            onChange={(v) => setTarget(v)}
            options={[
              { value: "pessoa", label: "Para uma pessoa" },
              { value: "fila", label: "Para uma fila" },
            ]}
          />
          {target === "pessoa" ? (
            <fieldset className="flex max-h-64 flex-col gap-1.5 overflow-y-auto" aria-label="Pessoa">
              {people.length === 0 ? <p className="text-sm text-muted">Nenhum operador nas filas além do responsável atual.</p> : null}
              {people.map((u) => {
                const away = u.presence !== "online";
                return (
                  <label
                    key={u.id}
                    className={cn("flex cursor-pointer items-center justify-between gap-2 rounded-lg border px-3 py-2 text-sm", userId === u.id ? "border-brand bg-brand-soft" : "border-border hover:bg-surface-hover")}
                  >
                    <span className="flex min-w-0 items-center gap-2">
                      <input type="radio" name="transfer-user" value={u.id} checked={userId === u.id} onChange={() => setUserId(u.id)} />
                      <span className="min-w-0">
                        <span className="block truncate font-medium">
                          {u.name}
                          {u.id === currentUserId ? " (você)" : ""}
                        </span>
                        <span className="block truncate text-xs text-muted">{u.queueNames.join(", ")}</span>
                      </span>
                    </span>
                    <span className={cn("shrink-0 text-xs", away ? "text-muted" : "text-success-fg")}>
                      {u.presence ? USER_PRESENCE_LABELS[u.presence] : "Sem presença"} · {u.load} em atendimento
                    </span>
                  </label>
                );
              })}
            </fieldset>
          ) : (
            <fieldset className="flex flex-col gap-1.5" aria-label="Fila">
              {queues.map((q) => (
                <label key={q.id} className={cn("flex cursor-pointer items-center gap-2 rounded-lg border px-3 py-2 text-sm", queueId === q.id ? "border-brand bg-brand-soft" : "border-border hover:bg-surface-hover")}>
                  <input type="radio" name="transfer-queue" value={q.id} checked={queueId === q.id} onChange={() => setQueueId(q.id)} />
                  {q.name}
                  {q.id === c.queueId ? <span className="text-xs text-muted">(fila atual)</span> : null}
                </label>
              ))}
            </fieldset>
          )}
          <FormField label="Nota para quem recebe" htmlFor="transfer-note" required hint="O cliente não vê. Fica registrada na conversa.">
            <Textarea id="transfer-note" rows={3} value={note} onChange={(e) => setNote(e.target.value)} placeholder="O que já foi feito e o que falta." />
          </FormField>
        </DialogBody>
        <DialogFooter>
          <Button variant="ghost" onClick={() => onOpenChange(false)} disabled={pending}>
            Cancelar
          </Button>
          <Button onClick={submit} loading={pending} disabled={!ready}>
            <ArrowRightLeft /> Transferir
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
