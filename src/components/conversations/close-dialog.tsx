"use client";

import * as React from "react";
import { useRouter } from "next/navigation";
import { CheckCircle2 } from "lucide-react";
import { closeConversationAction } from "@/server/conversations/actions";
import type { ConversationDetail } from "@/server/conversations/queries";
import { CONVERSATION_CLOSE_REASONS, type ConversationCloseReason } from "@/domain/types";
import { CLOSE_REASON_LABELS } from "@/domain/conversations";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Dialog, DialogBody, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { FormField } from "@/components/ui/form-field";
import { Select } from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import { toast } from "@/components/ui/toast";

type TicketChoice = "nenhum" | "vincular" | "novo";

/** Encerrar: motivo, resumo (vai para o Cliente 360) e, se for o caso, vincular ou abrir chamado. */
export function CloseDialog({ detail, open, onOpenChange }: { detail: ConversationDetail; open: boolean; onOpenChange: (v: boolean) => void }) {
  const router = useRouter();
  const c = detail.conversation;
  const linkable = detail.context.openTickets;
  const [reason, setReason] = React.useState<ConversationCloseReason>("resolvida");
  const [summary, setSummary] = React.useState("");
  const [ticket, setTicket] = React.useState<TicketChoice>(c.ticketId ? "nenhum" : "nenhum");
  const [ticketId, setTicketId] = React.useState(linkable[0]?.id ?? "");
  const [sendClosing, setSendClosing] = React.useState(true);
  const [pending, startTransition] = React.useTransition();
  const canCreateTicket = detail.capabilities.createTicket && Boolean(c.clientId);
  const ready = ticket !== "novo" || summary.trim().length >= 3;

  const submit = () =>
    startTransition(async () => {
      const r = await closeConversationAction({ conversationId: c.id, reason, summary: summary.trim() || undefined, ticket, ticketId: ticket === "vincular" ? ticketId : undefined, sendClosingMessage: sendClosing });
      if (!r.ok) return void toast.error(r.error);
      toast.success(r.data.ticketId && ticket === "novo" ? "Atendimento encerrado e chamado aberto" : "Atendimento encerrado");
      onOpenChange(false);
      router.refresh();
    });

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent size="md">
        <DialogHeader>
          <DialogTitle>Encerrar atendimento</DialogTitle>
          <DialogDescription>{c.number}</DialogDescription>
        </DialogHeader>
        <DialogBody className="flex flex-col gap-4">
          {c.awaitingReply ? (
            <p className="rounded-lg border border-danger/35 bg-danger-soft px-3 py-2 text-sm text-danger-fg" role="alert">
              O cliente mandou uma mensagem que ainda não foi respondida.
            </p>
          ) : null}
          <FormField label="Motivo" htmlFor="close-reason" required>
            <Select
              id="close-reason"
              value={reason}
              onChange={(e) => setReason(e.target.value as ConversationCloseReason)}
              options={CONVERSATION_CLOSE_REASONS.filter((r) => r !== "virou_chamado").map((r) => ({ value: r, label: CLOSE_REASON_LABELS[r] }))}
            />
          </FormField>
          {c.clientId && !c.ticketId ? (
            <fieldset className="flex flex-col gap-1.5 rounded-lg border border-border p-3 text-sm">
              <legend className="px-1 text-xs text-muted">Chamado</legend>
              <label className="flex items-center gap-2">
                <input type="radio" name="close-ticket" checked={ticket === "nenhum"} onChange={() => setTicket("nenhum")} /> Não precisa
              </label>
              {linkable.length > 0 ? (
                <label className="flex items-center gap-2">
                  <input type="radio" name="close-ticket" checked={ticket === "vincular"} onChange={() => setTicket("vincular")} /> Vincular ao chamado aberto
                </label>
              ) : null}
              {ticket === "vincular" ? (
                <Select aria-label="Chamado" size="sm" value={ticketId} onChange={(e) => setTicketId(e.target.value)} options={linkable.map((t) => ({ value: t.id, label: `#${t.number} · ${t.subject}` }))} />
              ) : null}
              {canCreateTicket ? (
                <label className="flex items-center gap-2">
                  <input type="radio" name="close-ticket" checked={ticket === "novo"} onChange={() => setTicket("novo")} /> Abrir chamado novo com o resumo desta conversa
                </label>
              ) : null}
            </fieldset>
          ) : null}
          <FormField label="Resumo" htmlFor="close-summary" required={ticket === "novo"} hint={c.clientId ? "Fica na linha do tempo do Cliente 360." : undefined}>
            <Textarea id="close-summary" rows={3} value={summary} onChange={(e) => setSummary(e.target.value)} placeholder="O que foi resolvido ou combinado." />
          </FormField>
          {detail.closingMessage ? (
            <label className="flex items-start gap-2 rounded-lg border border-border p-3 text-sm">
              <Checkbox checked={sendClosing} onCheckedChange={(v) => setSendClosing(v === true)} className="mt-0.5" />
              <span>
                Enviar a mensagem de encerramento
                <span className="mt-0.5 block text-xs text-muted">«{detail.closingMessage}»</span>
              </span>
            </label>
          ) : null}
        </DialogBody>
        <DialogFooter>
          <Button variant="ghost" onClick={() => onOpenChange(false)} disabled={pending}>
            Voltar
          </Button>
          <Button onClick={submit} loading={pending} disabled={!ready}>
            <CheckCircle2 /> Encerrar
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
