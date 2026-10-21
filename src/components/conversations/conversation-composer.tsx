"use client";

import * as React from "react";
import { useRouter } from "next/navigation";
import { Copy, ExternalLink, Info, Lock, Mail, MessageCircle, Send, StickyNote, X } from "lucide-react";
import { addConversationNoteAction, sendConversationMessageAction } from "@/server/conversations/actions";
import type { ConversationDetail } from "@/server/conversations/queries";
import { Button } from "@/components/ui/button";
import { StatusDot } from "@/components/ui/status-dot";
import { Textarea } from "@/components/ui/textarea";
import { toast } from "@/components/ui/toast";
import { cn } from "@/lib/utils";
import { CHANNEL_LABELS, manualHref } from "./model";

type Mode = "cliente" | "nota";

interface ManualNotice {
  href: string | null;
  text: string;
}

/**
 * Campo de resposta da conversa: «Responder ao cliente» ou «Nota interna (privada)». No WhatsApp, fora da janela de
 * 24 h e com o canal conectado, a Meta recusa texto livre: o envio vira «pelo WhatsApp do aparelho» (registro manual).
 */
export function ConversationComposer({ detail, className }: { detail: ConversationDetail; className?: string }) {
  const router = useRouter();
  const { conversation, capabilities, window: win, channelConnected } = detail;
  const [mode, setMode] = React.useState<Mode>(capabilities.reply ? "cliente" : "nota");
  const [text, setText] = React.useState("");
  const [manual, setManual] = React.useState<ManualNotice | null>(null);
  const [pending, startTransition] = React.useTransition();
  const channelLabel = CHANNEL_LABELS[conversation.channel];
  /** Só dá para mandar pelo aparelho (WhatsApp conectado, janela fechada). */
  const onlyManual = conversation.channel === "whatsapp" && channelConnected && !win.open;
  const note = mode === "nota";
  const canSend = text.trim().length > 0 && !pending;

  const submit = (forceManual = false) =>
    startTransition(async () => {
      const body = text.trim();
      if (!body) return;
      if (note) {
        const r = await addConversationNoteAction({
          conversationId: conversation.id,
          body,
        });
        if (!r.ok) return void toast.error(r.error);
        toast.success("Nota interna salva (o cliente não vê)");
        setText("");
        return router.refresh();
      }
      const r = await sendConversationMessageAction({
        conversationId: conversation.id,
        body,
        manual: forceManual || onlyManual,
      });
      if (!r.ok) return void toast.error(r.error);
      if (r.data.delivery === "manual") {
        setManual({
          href: r.data.manualUrl ?? manualHref(conversation.channel, conversation.address, body),
          text: body,
        });
        toast.success("Registrado na conversa. Envie pelo aparelho.");
      } else {
        setManual(null);
        toast.success("Mensagem enviada");
      }
      setText("");
      router.refresh();
    });

  const copy = async (value: string) => {
    try {
      await navigator.clipboard.writeText(value);
      toast.success("Texto copiado");
    } catch {
      toast.error("Não foi possível copiar");
    }
  };

  if (conversation.status === "encerrada") {
    return (
      <p className={cn("rounded-lg border border-dashed border-border px-4 py-3 text-center text-sm text-muted", className)}>
        Atendimento encerrado. Se o cliente escrever de novo, uma nova conversa é aberta.
      </p>
    );
  }

  return (
    <div className={cn("flex flex-col gap-2", className)}>
      {manual ? (
        <div className="flex flex-wrap items-center gap-2 rounded-lg border border-info/35 bg-info-soft px-3 py-2 text-xs text-foreground" role="status">
          <Info className="size-4 shrink-0 text-info-fg" aria-hidden />
          <span className="min-w-0 flex-1 basis-40">Registrado na conversa. Envie pelo {conversation.channel === "whatsapp" ? "WhatsApp do aparelho" : "seu e-mail"}:</span>
          {manual.href ? (
            <Button asChild size="sm" variant={conversation.channel === "whatsapp" ? "success" : "secondary"} className="min-h-[36px] md:min-h-8">
              <a href={manual.href} target="_blank" rel="noreferrer">
                {conversation.channel === "whatsapp" ? <MessageCircle /> : <Mail />}
                {conversation.channel === "whatsapp" ? "Abrir no WhatsApp" : "Abrir e-mail"} <ExternalLink />
              </a>
            </Button>
          ) : null}
          <Button size="sm" variant="ghost" onClick={() => copy(manual.text)} className="min-h-[36px] md:min-h-8">
            <Copy /> Copiar
          </Button>
          <Button size="icon" variant="ghost" onClick={() => setManual(null)} aria-label="Fechar aviso" className="size-8">
            <X />
          </Button>
        </div>
      ) : null}

      <div role="tablist" aria-label="Tipo de mensagem" className="flex gap-1">
        {capabilities.reply ? (
          <button
            type="button"
            role="tab"
            aria-selected={!note}
            onClick={() => setMode("cliente")}
            className={cn(
              "inline-flex min-h-[36px] items-center gap-1.5 rounded-lg px-3 text-xs font-medium transition-colors",
              !note ? "bg-brand-soft text-brand-fg" : "text-muted hover:bg-surface-hover hover:text-foreground",
            )}
          >
            <Send className="size-3.5" aria-hidden /> Responder ao cliente
          </button>
        ) : null}
        {capabilities.note ? (
          <button
            type="button"
            role="tab"
            aria-selected={note}
            onClick={() => setMode("nota")}
            className={cn(
              "inline-flex min-h-[36px] items-center gap-1.5 rounded-lg px-3 text-xs font-medium transition-colors",
              note ? "bg-warning-soft text-warning-fg" : "text-muted hover:bg-surface-hover hover:text-foreground",
            )}
          >
            <Lock className="size-3.5" aria-hidden /> Nota interna (privada)
          </button>
        ) : null}
      </div>

      <form
        className={cn(
          "flex flex-col gap-2 rounded-xl border bg-surface-muted p-2.5 transition-colors",
          note ? "border-warning/50 bg-warning-soft/40" : "border-border-strong focus-within:border-brand/50",
        )}
        onSubmit={(e) => {
          e.preventDefault();
          if (canSend) submit();
        }}
      >
        <Textarea
          aria-label={note ? "Texto da nota interna" : "Mensagem ao cliente"}
          value={text}
          onChange={(e) => setText(e.target.value)}
          placeholder={
            note ? "Só a equipe vê: diagnóstico, combinados, próximos passos…" : onlyManual ? "Fora da janela de 24 h: escreva e envie pelo WhatsApp do aparelho…" : `Mensagem por ${channelLabel}…`
          }
          className="min-h-[52px] resize-none border-0 bg-transparent px-1.5 py-1.5 shadow-none focus-visible:ring-0"
          rows={2}
          onKeyDown={(e) => {
            if (e.key === "Enter" && (e.metaKey || e.ctrlKey) && canSend) submit();
          }}
        />
        <div className="flex flex-col gap-2 px-1">
          <p className="flex flex-wrap items-center gap-x-1.5 gap-y-0.5 text-[11px] leading-4 text-muted">
            {note ? (
              <>
                <Lock className="size-3 shrink-0" aria-hidden /> Nota interna: nunca é enviada ao cliente.
              </>
            ) : onlyManual ? (
              <>
                <StatusDot tone="warning" size="sm" /> Janela de 24 h fechada: a Meta só aceita modelo aprovado. O envio fica como registro manual.
              </>
            ) : channelConnected ? (
              <>
                <StatusDot tone="success" size="sm" /> {channelLabel} conectado: a mensagem vai para o cliente.
                {conversation.channel === "whatsapp" && win.closesAt ? (
                  <span suppressHydrationWarning>
                    {" "}
                    · janela aberta até{" "}
                    {new Date(win.closesAt).toLocaleTimeString("pt-BR", {
                      hour: "2-digit",
                      minute: "2-digit",
                    })}
                  </span>
                ) : null}
              </>
            ) : (
              <>
                <StatusDot tone="muted" size="sm" /> {channelLabel} não conectado: registro manual (você envia pelo aparelho).
              </>
            )}
            {!note && !conversation.firstResponseAt ? <span className="font-medium text-warning-fg"> · primeira resposta (conta no SLA)</span> : null}
          </p>
          <div className="flex items-center justify-end gap-2">
            <span className="hidden text-[11px] text-muted 2xl:inline">Ctrl + Enter</span>
            <Button type="submit" size="sm" variant={note ? "secondary" : "primary"} loading={pending} disabled={!canSend} className="min-h-[40px] md:min-h-8">
              {note ? <StickyNote /> : onlyManual || !channelConnected ? <MessageCircle /> : <Send />}
              {note ? "Salvar nota" : onlyManual || !channelConnected ? "Registrar e enviar pelo aparelho" : "Enviar"}
            </Button>
          </div>
        </div>
      </form>
    </div>
  );
}
