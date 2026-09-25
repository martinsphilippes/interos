"use client";

import * as React from "react";
import { useRouter } from "next/navigation";
import { Copy, ExternalLink, Info, Mail, MessageCircle, Mic, Paperclip, Phone, Send, StickyNote, X } from "lucide-react";
import type { TicketDetail } from "@/server/support/queries";
import { addAttachmentAction, addNoteAction, registerCallAction, replyTicketAction } from "@/server/support/actions";
import type { ReplyChannel } from "@/server/support/schemas";
import { Button } from "@/components/ui/button";
import { FormField } from "@/components/ui/form-field";
import { Input } from "@/components/ui/input";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Select } from "@/components/ui/select";
import { StatusDot } from "@/components/ui/status-dot";
import { Switch } from "@/components/ui/switch";
import { Textarea } from "@/components/ui/textarea";
import { toast } from "@/components/ui/toast";
import { cn } from "@/lib/utils";
import { contactTarget, mailtoHref, whatsappTextHref } from "./workspace-model";

/** Estado real das integrações (vem do servidor; nunca presuma conectado). */
export interface ChannelStatus {
  whatsapp: boolean;
  voip: boolean;
  email: boolean;
}

type ComposerChannel = ReplyChannel | "ligacao";

const CHANNEL_OPTIONS: { value: ComposerChannel; label: string }[] = [
  { value: "whatsapp", label: "WhatsApp" },
  { value: "email", label: "E-mail" },
  { value: "portal", label: "Portal (interno)" },
  { value: "ligacao", label: "Ligação" },
];

interface ManualSend {
  channel: "whatsapp" | "email";
  href: string | null;
  text: string;
}

/**
 * Composer do chamado: resposta ao cliente (WhatsApp, e-mail, portal), ligação, nota interna (switch) e anexo por
 * URL. Sem integração conectada a resposta vira REGISTRO MANUAL e o atendente recebe o atalho wa.me/mailto
 * com o texto para enviar pelo app.
 */
export function TicketComposer({ detail, channels, className, onSent }: { detail: TicketDetail; channels: ChannelStatus; className?: string; onSent?: () => void }) {
  const router = useRouter();
  const { ticket } = detail;
  const target = contactTarget(detail);
  const defaultChannel: ComposerChannel = ticket.channel === "email" ? "email" : ticket.channel === "portal" || ticket.channel === "interno" ? "portal" : ticket.channel === "telefone" ? "ligacao" : "whatsapp";
  const [channel, setChannel] = React.useState<ComposerChannel>(defaultChannel);
  const [internal, setInternal] = React.useState(false);
  const [text, setText] = React.useState("");
  const [minutes, setMinutes] = React.useState("5");
  const [direction, setDirection] = React.useState<"saida" | "entrada">("saida");
  const [manual, setManual] = React.useState<ManualSend | null>(null);
  const [pending, startTransition] = React.useTransition();
  const id = React.useId();

  const connected = channel === "portal" || (channel === "ligacao" ? channels.voip : channel === "whatsapp" ? channels.whatsapp : channels.email);
  const canSend = text.trim().length > 0 && (internal || channel !== "ligacao" || Number(minutes) >= 1);

  const finish = (message: string) => {
    toast.success(message);
    setText("");
    router.refresh();
    setTimeout(() => onSent?.(), 250);
  };

  const submit = () =>
    startTransition(async () => {
      const body = text.trim();
      setManual(null);
      if (internal) {
        const result = await addNoteAction({ ticketId: ticket.id, body });
        if (!result.ok) return void toast.error(result.error);
        return finish("Nota interna registrada");
      }
      if (channel === "ligacao") {
        const result = await registerCallAction({ ticketId: ticket.id, direction, durationMinutes: Number(minutes), summary: body });
        if (!result.ok) return void toast.error(result.error);
        return finish(channels.voip ? "Ligação registrada" : "Ligação registrada manualmente (sem gravação)");
      }
      const result = await replyTicketAction({ ticketId: ticket.id, channel, body });
      if (!result.ok) return void toast.error(result.error);
      if (result.data.manual && (channel === "whatsapp" || channel === "email")) {
        const href = channel === "whatsapp" ? whatsappTextHref(result.data.to ?? target.whatsapp, body) : mailtoHref(result.data.to ?? target.email, `Chamado ${ticket.number} — ${ticket.subject}`, body);
        setManual({ channel, href, text: body });
        return finish("Resposta registrada no chamado (registro manual)");
      }
      setManual(null);
      finish(channel === "portal" ? "Resposta publicada no portal" : "Resposta enviada");
    });

  const copy = async (value: string) => {
    try {
      await navigator.clipboard.writeText(value);
      toast.success("Texto copiado");
    } catch {
      toast.error("Não foi possível copiar");
    }
  };

  if (ticket.status === "fechado") {
    return (
      <p className={cn("rounded-lg border border-dashed border-border px-4 py-3 text-center text-sm text-muted", className)}>
        Chamado fechado. Para continuar o atendimento, reabra o chamado (a reabertura conta como reincidência).
      </p>
    );
  }

  return (
    <div className={cn("flex flex-col gap-2", className)}>
      {manual ? (
        <div className="flex flex-wrap items-center gap-2 rounded-lg border border-info/35 bg-info-soft px-3 py-2 text-xs text-foreground" role="status">
          <Info className="size-4 shrink-0 text-info-fg" aria-hidden />
          <span className="min-w-0 flex-1 basis-40">
            Registrado no chamado ({manual.channel === "whatsapp" ? "WhatsApp" : "e-mail"} não conectado). Envie pelo app:
          </span>
          {manual.href ? (
            <Button asChild size="sm" variant={manual.channel === "whatsapp" ? "success" : "secondary"} className="min-h-[36px] md:min-h-8">
              <a href={manual.href} target={manual.channel === "whatsapp" ? "_blank" : undefined} rel="noreferrer">
                {manual.channel === "whatsapp" ? <MessageCircle /> : <Mail />}
                {manual.channel === "whatsapp" ? "Abrir no WhatsApp" : "Abrir e-mail"} <ExternalLink />
              </a>
            </Button>
          ) : (
            <span className="text-muted">Cliente sem {manual.channel === "whatsapp" ? "telefone" : "e-mail"} cadastrado.</span>
          )}
          <Button size="sm" variant="ghost" onClick={() => copy(manual.text)} className="min-h-[36px] md:min-h-8">
            <Copy /> Copiar
          </Button>
          <Button size="icon" variant="ghost" onClick={() => setManual(null)} aria-label="Fechar aviso" className="size-8">
            <X />
          </Button>
        </div>
      ) : null}

      <form
        className={cn("flex flex-col gap-2 rounded-xl border bg-surface-muted p-2.5 transition-colors", internal ? "border-warning/50 bg-warning-soft/40" : "border-border-strong focus-within:border-brand/50")}
        onSubmit={(e) => {
          e.preventDefault();
          if (canSend) submit();
        }}
      >
        <div className="flex items-start gap-2">
          <Textarea
            aria-label={internal ? "Texto da nota interna" : channel === "ligacao" ? "Resumo da ligação" : "Mensagem ao cliente"}
            value={text}
            onChange={(e) => setText(e.target.value)}
            placeholder={internal ? "Nota interna — visível só para a equipe (diagnóstico, acessos, próximos passos)…" : channel === "ligacao" ? "Resumo da ligação: o que foi tratado, testes, combinados…" : "Digite sua mensagem…"}
            className="min-h-[44px] flex-1 resize-none border-0 bg-transparent px-1.5 py-1.5 shadow-none focus-visible:ring-0 md:min-h-[52px]"
            rows={2}
            onKeyDown={(e) => {
              if (e.key === "Enter" && (e.metaKey || e.ctrlKey) && canSend) submit();
            }}
          />
          {/* Áudio depende do canal conectado: fica visível, mas desabilitado. */}
          <Button type="button" size="icon" variant="ghost" disabled className="size-11 shrink-0 md:hidden" aria-label="Enviar áudio (indisponível: integração não conectada)" title="Áudio indisponível: integração não conectada">
            <Mic />
          </Button>
        </div>

        {channel === "ligacao" && !internal ? (
          <div className="grid grid-cols-[minmax(0,1fr)_110px] gap-2 px-1">
            <FormField label="Tipo" htmlFor={`${id}-dir`}>
              <Select id={`${id}-dir`} size="sm" value={direction} onChange={(e) => setDirection(e.target.value as "saida" | "entrada")} options={[{ value: "saida", label: "Feita para o cliente" }, { value: "entrada", label: "Recebida do cliente" }]} />
            </FormField>
            <FormField label="Duração (min)" htmlFor={`${id}-min`}>
              <Input id={`${id}-min`} type="number" inputMode="numeric" min={1} max={600} value={minutes} onChange={(e) => setMinutes(e.target.value)} className="h-9" />
            </FormField>
          </div>
        ) : null}

        <div className="flex flex-wrap items-center gap-2 px-1">
          <AttachButton ticketId={ticket.id} onDone={() => router.refresh()} />
          <Select
            aria-label="Canal da resposta"
            size="sm"
            value={channel}
            onChange={(e) => setChannel(e.target.value as ComposerChannel)}
            disabled={internal}
            options={CHANNEL_OPTIONS}
            className="w-[140px]"
          />
          <Switch size="sm" label={<span className="text-xs font-medium text-muted">Nota interna</span>} checked={internal} onCheckedChange={setInternal} className="min-h-[40px] gap-2 md:min-h-0" />
          <div className="ml-auto flex items-center gap-2">
            <span className="hidden text-[11px] text-muted 2xl:inline">Ctrl + Enter</span>
            <Button type="submit" size="sm" variant={internal ? "secondary" : "primary"} loading={pending} disabled={!canSend} className="min-h-[40px] md:min-h-8">
              {internal ? <StickyNote /> : channel === "ligacao" ? <Phone /> : <Send />}
              {internal ? "Salvar nota" : channel === "ligacao" || !connected ? "Registrar" : "Enviar"}
            </Button>
          </div>
        </div>
        {!internal ? (
          <p className="flex items-center gap-1.5 px-1 text-[11px] leading-4 text-muted">
            <StatusDot tone={connected ? "success" : "muted"} size="sm" />
            {channel === "portal"
              ? "Resposta publicada no chamado (portal)."
              : connected
                ? "Integração conectada: a mensagem é enviada ao cliente."
                : channel === "ligacao"
                  ? "VoIP não conectado: registre a ligação feita pelo discador (sem gravação)."
                  : `${channel === "whatsapp" ? "WhatsApp" : "E-mail"} não conectado: registro manual (você envia pelo app).`}
            {!ticket.firstResponseAt ? <span className="font-medium text-warning-fg"> · primeira resposta (conta para o SLA)</span> : null}
          </p>
        ) : null}
      </form>
    </div>
  );
}

/** Anexo por URL (documento já hospedado): vira documento do chamado e aparece na conversa. */
function AttachButton({ ticketId, onDone }: { ticketId: string; onDone: () => void }) {
  const [open, setOpen] = React.useState(false);
  const [name, setName] = React.useState("");
  const [url, setUrl] = React.useState("");
  const [pending, startTransition] = React.useTransition();
  const id = React.useId();
  const submit = () =>
    startTransition(async () => {
      const result = await addAttachmentAction({ ticketId, name, url });
      if (!result.ok) return void toast.error(result.error);
      toast.success("Anexo adicionado ao chamado");
      setName("");
      setUrl("");
      setOpen(false);
      onDone();
    });
  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <Button type="button" size="sm" variant="outline" className="min-h-[40px] md:min-h-8" title="Anexar arquivo (link)">
          <Paperclip />
          <span className="sr-only 2xl:not-sr-only">Anexar arquivo</span>
        </Button>
      </PopoverTrigger>
      <PopoverContent align="start" className="w-80">
        <div className="flex flex-col gap-3">
          <p className="text-sm font-medium">Anexar por link</p>
          <p className="text-xs text-muted">Informe o link do arquivo (print, log, vídeo) já salvo em um drive ou no portal.</p>
          <FormField label="Nome" htmlFor={`${id}-name`}>
            <Input id={`${id}-name`} value={name} onChange={(e) => setName(e.target.value)} placeholder="Ex.: erro_tef.jpg" />
          </FormField>
          <FormField label="URL" htmlFor={`${id}-url`}>
            <Input id={`${id}-url`} type="url" value={url} onChange={(e) => setUrl(e.target.value)} placeholder="https://" />
          </FormField>
          <div className="flex justify-end gap-2">
            <Button type="button" size="sm" variant="ghost" onClick={() => setOpen(false)} disabled={pending}>
              Cancelar
            </Button>
            <Button type="button" size="sm" loading={pending} disabled={name.trim().length < 2 || !url.trim()} onClick={submit}>
              Anexar
            </Button>
          </div>
        </div>
      </PopoverContent>
    </Popover>
  );
}
