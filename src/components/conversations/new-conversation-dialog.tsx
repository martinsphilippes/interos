"use client";

import * as React from "react";
import { useRouter } from "next/navigation";
import { ExternalLink, MessageCirclePlus, Search } from "lucide-react";
import { searchConversationTargetsAction, startConversationAction } from "@/server/conversations/actions";
import type { ConversationTarget } from "@/server/conversations/schemas";
import { formatPhone } from "@/lib/format";
import { Button } from "@/components/ui/button";
import { Dialog, DialogBody, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { FormField } from "@/components/ui/form-field";
import { Input } from "@/components/ui/input";
import { Select } from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import { toast } from "@/components/ui/toast";
import { cn } from "@/lib/utils";
import { manualHref } from "./model";

const KIND_LABEL: Record<ConversationTarget["kind"], string> = { contato: "Contato", cliente: "Cliente", lead: "Lead" };

/**
 * Novo atendimento: a equipe escreve primeiro. Busca contato/cliente/lead (ou digita o número/e-mail), escolhe canal e
 * fila. WhatsApp: quem não escreveu nas últimas 24 h só recebe modelo aprovado — até os modelos chegarem, o envio é
 * pelo WhatsApp do aparelho (registro manual).
 */
export function NewConversationDialog({ queues, whatsappConnected }: { queues: { id: string; name: string }[]; whatsappConnected: boolean }) {
  const router = useRouter();
  const [open, setOpen] = React.useState(false);
  const [term, setTerm] = React.useState("");
  const [results, setResults] = React.useState<ConversationTarget[]>([]);
  const [target, setTarget] = React.useState<ConversationTarget | null>(null);
  const [channel, setChannel] = React.useState<"whatsapp" | "email">("whatsapp");
  const [address, setAddress] = React.useState("");
  const [queueId, setQueueId] = React.useState("");
  const [body, setBody] = React.useState("");
  const [manualLink, setManualLink] = React.useState<string | null>(null);
  const [searching, startSearch] = React.useTransition();
  const [pending, startTransition] = React.useTransition();

  React.useEffect(() => {
    const q = term.trim();
    if (q.length < 2 || target) return;
    const t = setTimeout(() => {
      startSearch(async () => {
        const r = await searchConversationTargetsAction({ q });
        setResults(r.ok ? r.data : []);
      });
    }, 300);
    return () => clearTimeout(t);
  }, [term, target]);

  const pick = (t: ConversationTarget) => {
    setTarget(t);
    setResults([]);
    const ch = t.whatsapp ? "whatsapp" : t.email ? "email" : "whatsapp";
    setChannel(ch);
    setAddress(ch === "whatsapp" ? (t.whatsapp ?? "") : (t.email ?? ""));
  };

  const reset = () => {
    setTerm("");
    setResults([]);
    setTarget(null);
    setAddress("");
    setBody("");
    setManualLink(null);
  };

  const onChannel = (ch: "whatsapp" | "email") => {
    setChannel(ch);
    if (target) setAddress(ch === "whatsapp" ? (target.whatsapp ?? "") : (target.email ?? ""));
  };

  const finalAddress = target ? address : address || term;
  const ready = finalAddress.trim().length >= 5 && body.trim().length > 0;
  // O servidor decide: com o WhatsApp conectado e a janela de 24 h fechada, o envio vai pelo aparelho (registro manual).
  const manual = channel === "whatsapp" && whatsappConnected;

  const submit = () =>
    startTransition(async () => {
      const r = await startConversationAction({
        channel,
        address: finalAddress.trim(),
        clientId: target?.kind === "cliente" ? target.id : undefined,
        contactId: target?.kind === "contato" ? target.id : undefined,
        leadId: target?.kind === "lead" ? target.id : undefined,
        queueId: queueId || undefined,
        body: body.trim(),
      });
      if (!r.ok) return void toast.error(r.error);
      if (r.data.delivery === "manual") {
        setManualLink(r.data.manualUrl ?? manualHref(channel, finalAddress, body.trim()));
        toast.success("Atendimento aberto. Envie pelo aparelho.");
      } else {
        toast.success("Atendimento aberto e mensagem enviada");
        setOpen(false);
        reset();
      }
      router.push(`/comunicacao?conversa=${r.data.id}`, { scroll: false });
    });

  return (
    <Dialog
      open={open}
      onOpenChange={(v) => {
        setOpen(v);
        if (!v) reset();
      }}
    >
      <DialogTrigger asChild>
        <Button className="min-h-[44px] md:min-h-0">
          <MessageCirclePlus /> Novo atendimento
        </Button>
      </DialogTrigger>
      <DialogContent size="md">
        <DialogHeader>
          <DialogTitle>Novo atendimento</DialogTitle>
          <DialogDescription>Escreva primeiro para um cliente, contato ou lead.</DialogDescription>
        </DialogHeader>
        <DialogBody className="flex flex-col gap-4">
          {manualLink ? (
            <div className="flex flex-col gap-3 rounded-lg border border-info/35 bg-info-soft p-3 text-sm" role="status">
              <p>A conversa foi aberta e a mensagem ficou registrada. Agora envie pelo aparelho:</p>
              <Button asChild variant="success">
                <a href={manualLink} target="_blank" rel="noreferrer">
                  Abrir no {channel === "whatsapp" ? "WhatsApp" : "e-mail"} <ExternalLink />
                </a>
              </Button>
            </div>
          ) : (
            <>
              <FormField label="Para quem" htmlFor="new-target" hint={target ? undefined : "Busque por nome, telefone ou e-mail — ou digite o número/e-mail de alguém sem cadastro."}>
                {target ? (
                  <div className="flex items-center justify-between gap-2 rounded-lg border border-border-strong px-3 py-2 text-sm">
                    <span className="min-w-0 truncate">
                      <span className="font-medium">{target.name}</span>
                      <span className="text-muted">
                        {" "}
                        · {KIND_LABEL[target.kind]}
                        {target.company ? ` · ${target.company}` : ""}
                      </span>
                    </span>
                    <Button size="sm" variant="ghost" onClick={() => setTarget(null)}>
                      Trocar
                    </Button>
                  </div>
                ) : (
                  <Input id="new-target" leadingIcon={<Search />} value={term} onChange={(e) => setTerm(e.target.value)} placeholder="Ex.: Joana, (88) 99612-7659 ou nome@empresa.com" autoFocus />
                )}
              </FormField>
              {!target && (results.length > 0 || searching) ? (
                <ul className="-mt-2 flex max-h-48 flex-col gap-1 overflow-y-auto rounded-lg border border-border p-1" aria-label="Resultados">
                  {searching && results.length === 0 ? <li className="px-2 py-1.5 text-xs text-muted">Buscando…</li> : null}
                  {results.map((r) => (
                    <li key={`${r.kind}_${r.id}`}>
                      <button type="button" onClick={() => pick(r)} className="w-full rounded-md px-2 py-1.5 text-left text-sm hover:bg-surface-hover">
                        <span className="font-medium">{r.name}</span>
                        <span className="text-muted">
                          {" "}
                          · {KIND_LABEL[r.kind]}
                          {r.company ? ` · ${r.company}` : ""}
                        </span>
                        <span className="block text-xs text-muted">{[r.whatsapp ? formatPhone(r.whatsapp) : null, r.email].filter(Boolean).join(" · ") || "sem telefone ou e-mail"}</span>
                      </button>
                    </li>
                  ))}
                </ul>
              ) : null}
              <div className="grid gap-3 sm:grid-cols-2">
                <FormField label="Canal" htmlFor="new-channel">
                  <Select
                    id="new-channel"
                    value={channel}
                    onChange={(e) => onChannel(e.target.value as "whatsapp" | "email")}
                    options={[
                      { value: "whatsapp", label: "WhatsApp" },
                      { value: "email", label: "E-mail" },
                    ]}
                  />
                </FormField>
                <FormField label="Fila" htmlFor="new-queue">
                  <Select id="new-queue" value={queueId} onChange={(e) => setQueueId(e.target.value)} options={[{ value: "", label: "Automática" }, ...queues.map((q) => ({ value: q.id, label: q.name }))]} />
                </FormField>
              </div>
              {target ? (
                <FormField label={channel === "whatsapp" ? "Telefone" : "E-mail"} htmlFor="new-address">
                  <Input id="new-address" value={address} onChange={(e) => setAddress(e.target.value)} placeholder={channel === "whatsapp" ? "DDD + número" : "nome@empresa.com"} />
                </FormField>
              ) : null}
              <FormField label="Mensagem" htmlFor="new-body" required>
                <Textarea id="new-body" rows={4} value={body} onChange={(e) => setBody(e.target.value)} placeholder="Olá! Aqui é da Intercert…" />
              </FormField>
              {manual ? (
                <p className={cn("rounded-lg border border-warning/40 bg-warning-soft px-3 py-2 text-xs text-warning-fg")}>
                  No WhatsApp, quem não escreveu nas últimas 24 h só recebe modelo aprovado pela Meta. Até os modelos chegarem, nesse caso a mensagem vai pelo WhatsApp do aparelho e fica registrada na conversa.
                </p>
              ) : null}
            </>
          )}
        </DialogBody>
        <DialogFooter>
          {manualLink ? (
            <Button
              onClick={() => {
                setOpen(false);
                reset();
              }}
            >
              Concluir
            </Button>
          ) : (
            <>
              <Button variant="ghost" onClick={() => setOpen(false)} disabled={pending}>
                Cancelar
              </Button>
              <Button onClick={submit} loading={pending} disabled={!ready}>
                <MessageCirclePlus /> Abrir atendimento
              </Button>
            </>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
