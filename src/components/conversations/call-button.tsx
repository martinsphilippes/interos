"use client";

import * as React from "react";
import { useRouter } from "next/navigation";
import { Phone, PhoneOutgoing } from "lucide-react";
import type { ConversationDetail } from "@/server/conversations/queries";
import { registerConversationCallAction } from "@/server/conversations/actions";
import { MANUAL_CALL_OUTCOMES, MANUAL_CALL_OUTCOME_LABELS, type ManualCallOutcome } from "@/domain/conversation-call";
import { displayPhone, nationalNumber } from "@/domain/phone";
import { Button } from "@/components/ui/button";
import { Dialog, DialogBody, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { FormField } from "@/components/ui/form-field";
import { Input } from "@/components/ui/input";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Textarea } from "@/components/ui/textarea";
import { toast } from "@/components/ui/toast";
import { requestSoftphoneCall, useSoftphoneReady } from "@/components/telephony/softphone-bridge";
import { cn } from "@/lib/utils";

/**
 * «Ligar» na conversa: escolhe um dos números conhecidos (ou digita outro) e liga. Com o softphone do INTEROS pronto, a
 * ligação sai por ele e fica registrada na conversa (gravação e duração pelo provedor). Sem ele, abre o telefone do
 * aparelho e, na volta, o atendente registra como foi (atendeu, não atendeu, ocupado) com uma anotação.
 */
export function ConversationCallButton({ detail, className }: { detail: ConversationDetail; className?: string }) {
  const ready = useSoftphoneReady();
  const [open, setOpen] = React.useState(false);
  const [other, setOther] = React.useState("");
  const [log, setLog] = React.useState<string | null>(null);
  const numbers = detail.call?.numbers ?? [];
  if (!detail.call) return null;

  const dial = (number: string) => {
    const digits = nationalNumber(number);
    if (digits.length < 10 || digits.length > 11) return void toast.error("Digite o número com DDD");
    setOpen(false);
    setOther("");
    if (ready) {
      requestSoftphoneCall({ number: digits, conversationId: detail.conversation.id });
      return;
    }
    // Sem a telefonia do INTEROS: o aparelho liga (celular, FaceTime/iPhone no iPad) e o resultado é registrado aqui.
    window.location.assign(`tel:+55${digits}`);
    setLog(digits);
  };

  return (
    <>
      <Popover open={open} onOpenChange={setOpen}>
        <PopoverTrigger asChild>
          <Button size="sm" variant="outline" className={cn("min-h-[40px] md:min-h-8", className)}>
            <Phone /> Ligar
          </Button>
        </PopoverTrigger>
        <PopoverContent align="start" className="w-80 p-3">
          <p className="mb-2 text-sm font-semibold">Ligar para {detail.row.name}</p>
          {numbers.length ? (
            <ul className="mb-3 flex flex-col gap-1">
              {numbers.map((n) => (
                <li key={n.number}>
                  <button type="button" onClick={() => dial(n.number)} className="flex w-full items-center gap-3 rounded-lg border border-border px-3 py-2 text-left text-sm hover:border-brand hover:bg-brand-soft">
                    <PhoneOutgoing className="size-4 shrink-0 text-brand-fg" />
                    <span className="min-w-0">
                      <span className="block font-medium tabular-nums">{displayPhone(n.number)}</span>
                      <span className="block truncate text-xs text-muted">{n.label}</span>
                    </span>
                  </button>
                </li>
              ))}
            </ul>
          ) : (
            <p className="mb-3 text-xs text-muted">Nenhum telefone conhecido para este contato. Digite o número (e use «Quem é?» para guardar no cadastro).</p>
          )}
          <form
            className="flex gap-2"
            onSubmit={(e) => {
              e.preventDefault();
              dial(other);
            }}
          >
            <Input value={other} onChange={(e) => setOther(e.target.value)} inputMode="tel" placeholder="Outro número com DDD" aria-label="Outro número" className="h-9" />
            <Button type="submit" size="sm" disabled={other.replace(/\D/g, "").length < 10}>
              Ligar
            </Button>
          </form>
          <p className="mt-2 text-[11px] text-muted">{ready ? "Pelo telefone do INTEROS: a ligação fica registrada nesta conversa." : "A telefonia do INTEROS não está ligada: a ligação sai pelo seu aparelho e depois você registra como foi."}</p>
        </PopoverContent>
      </Popover>
      {log ? <RegisterCallDialog conversationId={detail.conversation.id} number={log} name={detail.row.name} onClose={() => setLog(null)} /> : null}
    </>
  );
}

function RegisterCallDialog({ conversationId, number, name, onClose }: { conversationId: string; number: string; name: string; onClose: () => void }) {
  const id = React.useId();
  const router = useRouter();
  const [outcome, setOutcome] = React.useState<ManualCallOutcome | null>(null);
  const [note, setNote] = React.useState("");
  const [pending, startTransition] = React.useTransition();
  const save = () =>
    startTransition(async () => {
      if (!outcome) return;
      const r = await registerConversationCallAction({ conversationId, number, outcome, note: note.trim() || undefined });
      if (!r.ok) return void toast.error(r.error);
      toast.success("Ligação registrada na conversa");
      router.refresh();
      onClose();
    });
  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent size="sm">
        <DialogHeader>
          <DialogTitle>Como foi a ligação?</DialogTitle>
          <DialogDescription>
            Para {name} · {displayPhone(number)}. Fica registrada nesta conversa e no histórico do cliente.
          </DialogDescription>
        </DialogHeader>
        <DialogBody className="grid gap-3">
          <div role="radiogroup" aria-label="Resultado" className="grid gap-2">
            {MANUAL_CALL_OUTCOMES.map((o) => (
              <button
                key={o}
                type="button"
                role="radio"
                aria-checked={outcome === o}
                onClick={() => setOutcome(o)}
                className={cn("min-h-[44px] rounded-lg border px-3 text-left text-sm font-medium", outcome === o ? "border-brand bg-brand-soft text-brand-fg" : "border-border hover:bg-surface-hover")}
              >
                {MANUAL_CALL_OUTCOME_LABELS[o]}
              </button>
            ))}
          </div>
          <FormField label="Anotação (opcional)" htmlFor={`${id}-n`}>
            <Textarea id={`${id}-n`} value={note} onChange={(e) => setNote(e.target.value)} rows={3} placeholder="O que foi combinado" />
          </FormField>
        </DialogBody>
        <DialogFooter>
          <Button variant="outline" onClick={onClose} disabled={pending}>
            Não liguei
          </Button>
          <Button onClick={save} loading={pending} disabled={!outcome}>
            Registrar
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
