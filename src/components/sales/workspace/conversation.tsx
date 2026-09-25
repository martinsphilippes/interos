"use client";

import * as React from "react";
import { useRouter } from "next/navigation";
import { ExternalLink, Info, Mail, MessageCircle, Paperclip, Phone, Send, StickyNote, X } from "lucide-react";
import { ConversationThread as Thread, type ThreadItem } from "@/components/ui/conversation-thread";
import { Button } from "@/components/ui/button";
import { FormField } from "@/components/ui/form-field";
import { Input } from "@/components/ui/input";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { SegmentedControl } from "@/components/ui/segmented-control";
import { Select } from "@/components/ui/select";
import { Switch } from "@/components/ui/switch";
import { Textarea } from "@/components/ui/textarea";
import { toast } from "@/components/ui/toast";
import { EventIcon } from "@/components/timeline/timeline";
import { telHref, whatsappHref } from "@/components/clients/contact-links";
import { cn } from "@/lib/utils";
import { attachOpportunityDocumentAction, registerCallAction, registerInternalNoteAction, registerWorkspaceMessageAction } from "@/server/sales/actions";
import type { ConversationItem, WorkspaceDetail } from "@/server/sales/workspace-queries";

// ---------------------------------------------------------------------------
// Linha do tempo em formato de conversa (componente único: @/components/ui/conversation-thread)
// ---------------------------------------------------------------------------

const CHANNEL_LABEL = { whatsapp: "WhatsApp", email: "E-mail", interno: "Interno" } as const;

function toThreadItem(item: ConversationItem, currentUserName: string, contactLabel: string): ThreadItem {
  switch (item.kind) {
    case "system":
      return { kind: "system", id: item.id, at: item.at, title: item.title, description: item.description, actorName: item.actorName, icon: <EventIcon type={item.type} size="sm" /> };
    case "note":
      return { kind: "note", id: item.id, at: item.at, authorName: item.authorName, body: item.body };
    case "call":
      return { kind: "call", id: item.id, at: item.at, direction: item.direction, answered: item.answered, durationSeconds: item.durationSeconds, body: item.body, authorName: item.authorName, manual: item.manual };
    default: {
      const outgoing = item.direction === "saida";
      return {
        kind: "message",
        id: item.id,
        at: item.at,
        direction: item.direction,
        authorName: item.authorName,
        authorRole: outgoing ? (item.authorName === currentUserName ? "Você" : undefined) : contactLabel,
        body: item.body,
        channel: item.channel,
        channelLabel: item.channel === "interno" ? undefined : CHANNEL_LABEL[item.channel],
        manual: item.manual,
        delivered: outgoing && !item.manual && (item.status === "enviada" || item.status === "entregue" || item.status === "lida"),
      };
    }
  }
}

/** Conversa da oportunidade: mensagens em balões, ligações em linha, notas internas em âmbar e eventos do sistema discretos. */
export function ConversationThread({ items, currentUserName, contactLabel, className }: { items: ConversationItem[]; currentUserName: string; contactLabel: string; className?: string }) {
  return (
    <Thread
      autoScroll
      aria-label="Conversa da oportunidade"
      data-testid="conversa"
      className={cn("px-3 py-4 md:px-5", className)}
      items={items.map((item) => toThreadItem(item, currentUserName, contactLabel))}
      emptyText="Nenhuma interação registrada ainda. Registre a primeira mensagem, ligação ou nota abaixo."
      noRecordingText="sem gravação"
    />
  );
}

// ---------------------------------------------------------------------------
// Composer
// ---------------------------------------------------------------------------

type ComposerChannel = "whatsapp" | "email" | "ligacao";

/** Texto de rodapé honesto sobre o canal escolhido. */
function channelHint(channels: WorkspaceDetail["channels"], channel: ComposerChannel | null): string {
  if (channel === null) return "Nota interna: fica só na linha do tempo, não vai para o cliente.";
  if (channel === "ligacao") return channels.voip ? "VoIP conectado." : "Sem VoIP conectado: registre a ligação feita pelo telefone (registro manual).";
  const connected = channel === "whatsapp" ? channels.whatsapp : channels.email;
  const name = channel === "whatsapp" ? "WhatsApp" : "E-mail";
  return connected ? `${name} conectado: “Enviar” manda a mensagem pelo provedor.` : `${name} não conectado: “Enviar” registra a mensagem (registro manual) e abre o app com o texto.`;
}

function mailtoHref(email: string | undefined, subject: string, body: string): string | null {
  if (!email) return null;
  return `mailto:${email}?subject=${encodeURIComponent(subject)}&body=${encodeURIComponent(body)}`;
}

/**
 * Composer do workspace. Sem integração conectada, "Enviar" grava a mensagem como REGISTRO MANUAL e
 * oferece abrir o WhatsApp (wa.me) ou o e-mail (mailto:) com o texto já preenchido. "Ligação" registra
 * duração e resumo (call.completed). "Nota interna" não sai para o cliente.
 */
export function Composer({ detail }: { detail: WorkspaceDetail }) {
  const router = useRouter();
  const id = React.useId();
  const opp = detail.opportunity;
  const [channel, setChannel] = React.useState<ComposerChannel>("whatsapp");
  const [internal, setInternal] = React.useState(false);
  const [text, setText] = React.useState("");
  const [outcome, setOutcome] = React.useState<"atendeu" | "nao_atendeu">("atendeu");
  const [minutes, setMinutes] = React.useState("");
  const [seconds, setSeconds] = React.useState("");
  const [sent, setSent] = React.useState<{ channel: "whatsapp" | "email"; href: string | null; failed?: boolean } | null>(null);
  const [pending, startTransition] = React.useTransition();
  const contact = detail.primaryContact;
  const wa = whatsappHref(contact.whatsapp ?? contact.phone);
  const tel = telHref(contact.phone ?? contact.whatsapp);
  const disabled = !detail.canEdit;
  const isCall = !internal && channel === "ligacao";
  const durationSeconds = (Number(minutes) || 0) * 60 + (Number(seconds) || 0);
  const canSubmit = !disabled && (isCall ? outcome === "nao_atendeu" || (durationSeconds > 0 && text.trim().length >= 3) : text.trim().length >= (internal ? 2 : 1));

  const done = (message: string) => {
    toast.success(message);
    setText("");
    setMinutes("");
    setSeconds("");
    router.refresh();
  };

  const submit = () => {
    const body = text.trim();
    startTransition(async () => {
      if (internal) {
        const result = await registerInternalNoteAction({ opportunityId: opp.id, body });
        if (!result.ok) return void toast.error(result.error);
        setSent(null);
        return done("Nota interna salva");
      }
      if (channel === "ligacao") {
        const result = await registerCallAction({ opportunityId: opp.id, outcome, durationSeconds, summary: body });
        if (!result.ok) return void toast.error(result.error);
        setSent(null);
        return done("Ligação registrada na linha do tempo");
      }
      const result = await registerWorkspaceMessageAction({ opportunityId: opp.id, channel, body });
      if (!result.ok) return void toast.error(result.error);
      const label = channel === "whatsapp" ? "WhatsApp" : "e-mail";
      if (result.data.delivery === "enviada") {
        setSent(null);
        return done(`Mensagem enviada por ${label}`);
      }
      // Canal não conectado (ou falha no provedor): oferece o app do usuário com o texto pronto.
      const href = channel === "whatsapp" ? (wa ? `${wa}?text=${encodeURIComponent(body)}` : null) : mailtoHref(contact.email, `${opp.title} — ${detail.client.tradeName}`, body);
      setSent({ channel, href, failed: result.data.delivery === "falha" });
      if (result.data.delivery === "falha") {
        toast.error(`Falha ao enviar por ${label}${result.data.error ? `: ${result.data.error}` : ""}. Registrada como falha na linha do tempo.`);
        setText("");
        router.refresh();
        return;
      }
      done("Mensagem registrada (registro manual)");
    });
  };

  const placeholder = internal ? "Escreva uma nota interna (não vai para o cliente)…" : isCall ? "Resumo da ligação: o que foi conversado e combinado…" : "Digite sua mensagem…";

  return (
    <div className="border-t border-border p-3">
      {sent ? (
        <div className="mb-3 flex items-start gap-2 rounded-lg border border-info/30 bg-info-soft px-3 py-2 text-sm">
          <Info className="mt-0.5 size-4 shrink-0 text-info-fg" aria-hidden />
          <p className="min-w-0 flex-1 text-foreground">
            {sent.failed
              ? "O provedor recusou o envio. Envie pelo app:"
              : `Mensagem registrada na linha do tempo. ${sent.channel === "whatsapp" ? "WhatsApp" : "E-mail"} não está conectado: envie pelo app.`}{" "}
            {sent.href ? (
              <a href={sent.href} target={sent.channel === "whatsapp" ? "_blank" : undefined} rel="noreferrer" className="inline-flex items-center gap-1 font-medium text-info-fg underline-offset-2 hover:underline">
                {sent.channel === "whatsapp" ? "Abrir no WhatsApp" : "Abrir no e-mail"} com o texto <ExternalLink className="size-3.5" />
              </a>
            ) : (
              <span className="text-muted">Sem {sent.channel === "whatsapp" ? "telefone" : "e-mail"} cadastrado para o contato.</span>
            )}
          </p>
          <button type="button" onClick={() => setSent(null)} className="rounded p-0.5 text-muted hover:text-foreground" aria-label="Fechar aviso">
            <X className="size-4" />
          </button>
        </div>
      ) : null}

      <div className={cn("rounded-xl border bg-surface-muted p-2 transition-colors focus-within:border-brand", internal ? "border-warning/40" : "border-border-strong")}>
        <Textarea
          id={`${id}-t`}
          value={text}
          onChange={(e) => setText(e.target.value)}
          placeholder={placeholder}
          aria-label={internal ? "Nota interna" : isCall ? "Resumo da ligação" : "Mensagem"}
          disabled={disabled || pending}
          className="min-h-[56px] resize-none border-0 bg-transparent focus:ring-0"
          onKeyDown={(e) => {
            if (e.key === "Enter" && (e.ctrlKey || e.metaKey) && canSubmit && !pending) {
              e.preventDefault();
              submit();
            }
          }}
        />
        {isCall ? (
          <div className="grid grid-cols-[1fr_auto] gap-2 px-1 pb-2 sm:grid-cols-[180px_auto_1fr]">
            <FormField label="Resultado" htmlFor={`${id}-o`}>
              <Select id={`${id}-o`} size="sm" value={outcome} onChange={(e) => setOutcome(e.target.value as typeof outcome)} options={[{ value: "atendeu", label: "Atendeu" }, { value: "nao_atendeu", label: "Não atendeu" }]} />
            </FormField>
            {outcome === "atendeu" ? (
              <FormField label="Duração" htmlFor={`${id}-m`}>
                <span className="flex items-center gap-1">
                  <Input id={`${id}-m`} inputMode="numeric" value={minutes} onChange={(e) => setMinutes(e.target.value.replace(/\D/g, "").slice(0, 3))} placeholder="min" className="h-8 w-16 text-center" aria-label="Minutos" />
                  <span className="text-muted">:</span>
                  <Input inputMode="numeric" value={seconds} onChange={(e) => setSeconds(e.target.value.replace(/\D/g, "").slice(0, 2))} placeholder="seg" className="h-8 w-16 text-center" aria-label="Segundos" />
                </span>
              </FormField>
            ) : null}
            {tel ? (
              <a href={tel} className="self-end pb-1.5 text-xs text-info-fg hover:underline max-sm:col-span-2">
                <Phone className="mr-1 inline size-3.5" aria-hidden />
                Ligar pelo telefone
              </a>
            ) : null}
          </div>
        ) : null}
        <div className="flex flex-wrap items-center gap-2 px-1">
          <AttachButton opportunityId={opp.id} disabled={disabled} />
          <SegmentedControl<ComposerChannel>
            size="sm"
            aria-label="Canal"
            value={channel}
            onChange={setChannel}
            options={[
              { value: "whatsapp", label: "WhatsApp", icon: <MessageCircle />, disabled: internal },
              { value: "email", label: "E-mail", icon: <Mail />, disabled: internal },
              { value: "ligacao", label: "Ligação", icon: <Phone />, disabled: internal },
            ]}
          />
          <div className="ml-auto flex items-center gap-3">
            <Switch size="sm" checked={internal} onCheckedChange={setInternal} label={<span className="text-[13px] font-normal text-muted">Adicionar nota interna</span>} disabled={disabled} className="gap-2" />
            <Button size="sm" onClick={submit} loading={pending} disabled={!canSubmit} className="min-h-[40px] md:min-h-0" variant={internal ? "secondary" : "primary"}>
              {internal ? (
                <>
                  <StickyNote /> Salvar nota
                </>
              ) : isCall ? (
                <>
                  <Phone /> Registrar ligação
                </>
              ) : (
                <>
                  Enviar <Send />
                </>
              )}
            </Button>
          </div>
        </div>
      </div>
      <p className="mt-1.5 text-[11px] text-muted-light max-md:hidden">
        {disabled
          ? "Somente o vendedor responsável, quem originou ou gestores registram interações."
          : `${channelHint(detail.channels, internal ? null : channel)} Ctrl+Enter envia.`}
      </p>
    </div>
  );
}

function AttachButton({ opportunityId, disabled }: { opportunityId: string; disabled: boolean }) {
  const router = useRouter();
  const id = React.useId();
  const [open, setOpen] = React.useState(false);
  const [name, setName] = React.useState("");
  const [url, setUrl] = React.useState("");
  const [pending, startTransition] = React.useTransition();

  const submit = () =>
    startTransition(async () => {
      const result = await attachOpportunityDocumentAction({ opportunityId, name, url });
      if (!result.ok) return void toast.error(result.error);
      toast.success("Documento anexado aos documentos do cliente");
      setOpen(false);
      setName("");
      setUrl("");
      router.refresh();
    });

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <Button variant="ghost" size="icon" className="size-10 md:size-8" aria-label="Anexar documento" disabled={disabled}>
          <Paperclip />
        </Button>
      </PopoverTrigger>
      <PopoverContent align="start" className="w-80">
        <p className="mb-1 text-sm font-semibold">Anexar documento</p>
        <p className="mb-3 text-xs text-muted">Informe o link (Drive, OneDrive, site). Ele entra nos documentos do cliente vinculado a esta oportunidade.</p>
        <div className="flex flex-col gap-3">
          <FormField label="Nome" htmlFor={`${id}-n`} required>
            <Input id={`${id}-n`} value={name} onChange={(e) => setName(e.target.value)} placeholder="Ex.: Planilha de levantamento" />
          </FormField>
          <FormField label="Link" htmlFor={`${id}-u`} required>
            <Input id={`${id}-u`} type="url" value={url} onChange={(e) => setUrl(e.target.value)} placeholder="https://…" />
          </FormField>
          <div className="flex justify-end gap-2">
            <Button variant="outline" size="sm" onClick={() => setOpen(false)} disabled={pending}>
              Cancelar
            </Button>
            <Button size="sm" onClick={submit} loading={pending} disabled={name.trim().length < 2 || !url.trim()}>
              <Paperclip /> Anexar
            </Button>
          </div>
        </div>
      </PopoverContent>
    </Popover>
  );
}
