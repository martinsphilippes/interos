"use client";

import * as React from "react";
import { CheckCheck, Lock, Mail, MessageCircle, Monitor, Paperclip, Phone, PhoneIncoming, PhoneMissed, PlayCircle } from "lucide-react";
import { Avatar } from "@/components/ui/avatar";
import { formatCallDuration, formatDateTime, formatDay, formatTime } from "@/lib/format";
import { cn } from "@/lib/utils";

/**
 * Conversa omnichannel única do sistema (Central de Vendas e Central de Suporte): mensagens em balões,
 * ligações em linha, notas internas em âmbar, anexos e eventos do sistema como linhas discretas, com
 * separador por dia. Cada módulo converte os próprios registros em `ThreadItem` (sem regra de negócio aqui).
 *
 * Honestidade de integração: `manual` = canal não conectado, o contato foi feito fora do sistema e registrado
 * à mão ("registro manual"); `recordingUrl` só deve vir de um provedor VoIP real.
 */

export type ThreadChannel = "whatsapp" | "email" | "portal" | "interno";

export type ThreadItem =
  | {
      kind: "message";
      id: string;
      at: string;
      /** "entrada" = do cliente (esquerda); "saida" = da equipe (direita). */
      direction: "entrada" | "saida";
      authorName: string;
      /** Papel exibido ao lado do nome ("Cliente", "Atendente", "Você"). */
      authorRole?: string;
      avatarUrl?: string;
      body: string;
      channel?: ThreadChannel;
      /** Rótulo do canal ("WhatsApp", "E-mail", "Portal"). */
      channelLabel?: string;
      manual?: boolean;
      /** Envio confirmado pelo provedor (mostra ✓✓). */
      delivered?: boolean;
      attachments?: string[];
    }
  | { kind: "note"; id: string; at: string; authorName: string; body: string; attachments?: string[] }
  | {
      kind: "call";
      id: string;
      at: string;
      direction: "entrada" | "saida";
      /** false = ligação sem resposta. */
      answered?: boolean;
      durationSeconds?: number;
      body?: string;
      authorName?: string;
      manual?: boolean;
      recordingUrl?: string;
    }
  | { kind: "system"; id: string; at: string; title: string; description?: string; actorName?: string; icon?: React.ReactNode };

export interface ConversationThreadProps {
  items: ThreadItem[];
  /** Linha fixa no topo (ex.: canal e início da conversa do chamado). */
  header?: React.ReactNode;
  emptyText?: string;
  /** Rola até a última interação ao abrir e quando chega uma nova (chat). O próprio componente vira a área rolável. */
  autoScroll?: boolean;
  /** Texto do "sem gravação" quando a ligação não tem gravação. */
  noRecordingText?: string;
  className?: string;
  "aria-label"?: string;
  "data-testid"?: string;
}

function Time({ at }: { at: string }) {
  return (
    <time dateTime={at} title={formatDateTime(at)} className="shrink-0 text-[11px] tabular-nums text-muted-light">
      {formatTime(at)}
    </time>
  );
}

function ManualTag() {
  return (
    <span
      className="rounded-sm border border-border-strong px-1 text-[10px] font-medium uppercase tracking-wide text-muted"
      title="A integração do canal não está conectada: o contato foi feito pelo app/discador e registrado à mão."
    >
      registro manual
    </span>
  );
}

function fileName(url: string): string {
  try {
    const last = new URL(url).pathname.split("/").filter(Boolean).pop();
    return last ? decodeURIComponent(last) : url;
  } catch {
    return url;
  }
}

function Attachments({ urls }: { urls?: string[] }) {
  if (!urls?.length) return null;
  return (
    <ul className="mt-2 flex flex-col gap-1.5">
      {urls.map((url) => (
        <li key={url}>
          <a href={url} target="_blank" rel="noreferrer" className="inline-flex max-w-full items-center gap-2 rounded-lg border border-border-strong bg-surface-muted px-3 py-2 text-xs text-foreground hover:border-brand/40">
            <Paperclip className="size-4 shrink-0 text-muted" aria-hidden />
            <span className="truncate">{fileName(url)}</span>
          </a>
        </li>
      ))}
    </ul>
  );
}

const CHANNEL_ICON: Record<ThreadChannel, React.ComponentType<{ className?: string }>> = { whatsapp: MessageCircle, email: Mail, portal: Monitor, interno: Monitor };

function Item({ item, noRecordingText }: { item: ThreadItem; noRecordingText: string }) {
  if (item.kind === "system") {
    return (
      <li className="flex items-start justify-center gap-2 px-2 text-center">
        {item.icon ? <span className="mt-0.5 shrink-0">{item.icon}</span> : null}
        <span className="min-w-0 text-xs text-muted">
          <span className="text-foreground/85">{item.title}</span>
          {item.description ? <span className="block truncate">{item.description}</span> : null}
          <span className="block text-[11px] text-muted-light">
            {item.actorName ? `${item.actorName} · ` : ""}
            {formatTime(item.at)}
          </span>
        </span>
      </li>
    );
  }
  if (item.kind === "note") {
    return (
      <li className="mx-auto w-full max-w-[620px]">
        <div className="rounded-lg border border-warning/35 bg-warning-soft px-3 py-2">
          <p className="flex flex-wrap items-center gap-1.5 text-xs font-semibold text-warning-fg">
            <Lock className="size-3.5" aria-hidden /> Nota interna · {item.authorName}
            <span className="font-normal text-muted">· não visível ao cliente</span>
            <span className="ml-auto font-normal">
              <Time at={item.at} />
            </span>
          </p>
          <p className="mt-1 whitespace-pre-line break-words text-sm text-foreground">{item.body}</p>
          <Attachments urls={item.attachments} />
        </div>
      </li>
    );
  }
  if (item.kind === "call") {
    const answered = item.answered !== false;
    const duration = formatCallDuration(item.durationSeconds);
    const Icon = !answered ? PhoneMissed : item.direction === "entrada" ? PhoneIncoming : Phone;
    return (
      <li className="mx-auto w-full max-w-[620px]">
        <div className="flex items-start gap-3 rounded-lg border border-border-strong bg-surface-muted px-3 py-2.5">
          <span className={cn("mt-0.5 flex size-8 shrink-0 items-center justify-center rounded-full [&_svg]:size-4", answered ? "bg-info-soft text-info-fg" : "bg-danger-soft text-danger-fg")} aria-hidden>
            <Icon />
          </span>
          <div className="min-w-0 flex-1">
            <p className="flex flex-wrap items-center gap-x-2 gap-y-1 text-sm">
              <span className="font-medium">
                {item.direction === "entrada" ? "Ligação recebida" : answered ? "Ligação realizada" : "Ligação sem resposta"}
                {duration ? ` — ${duration}` : ""}
              </span>
              {item.manual ? <ManualTag /> : null}
              {item.recordingUrl ? (
                <a href={item.recordingUrl} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1 text-xs font-medium text-info-fg hover:underline">
                  <PlayCircle className="size-3.5" /> Ouvir gravação
                </a>
              ) : answered ? (
                <span className="text-xs text-muted">{noRecordingText}</span>
              ) : null}
            </p>
            {item.body ? <p className="mt-0.5 whitespace-pre-line break-words text-sm text-muted">{item.body}</p> : null}
            {item.authorName ? <p className="text-[11px] text-muted-light">{item.authorName}</p> : null}
          </div>
          <Time at={item.at} />
        </div>
      </li>
    );
  }
  const outgoing = item.direction === "saida";
  const channel = item.channel ?? "whatsapp";
  const ChannelIcon = CHANNEL_ICON[channel];
  return (
    <li className={cn("flex items-end gap-2", outgoing ? "flex-row-reverse" : "justify-start")}>
      <Avatar name={item.authorName} src={item.avatarUrl} size="md" className="mb-4 hidden sm:flex" />
      <div
        className={cn(
          "min-w-0 max-w-[88%] rounded-xl border px-3 py-2 sm:max-w-[70%]",
          outgoing
            ? channel === "email"
              ? "rounded-br-sm border-secondary/30 bg-secondary-soft"
              : "rounded-br-sm border-success/30 bg-success-soft"
            : "rounded-bl-sm border-border-strong bg-surface-hover",
        )}
      >
        <p className="flex flex-wrap items-center gap-1.5 text-xs text-muted">
          <ChannelIcon className={cn("size-3.5", channel === "email" ? "text-secondary-fg" : channel === "whatsapp" ? "text-success-fg" : "text-info-fg")} aria-hidden />
          <span className="font-medium text-foreground/90">{item.authorName}</span>
          {item.authorRole ? <span>({item.authorRole})</span> : null}
        </p>
        <p className="mt-1 whitespace-pre-line break-words text-sm text-foreground">{item.body || <span className="italic text-muted">Sem texto</span>}</p>
        <Attachments urls={item.attachments} />
        <p className="mt-1 flex flex-wrap items-center justify-end gap-x-2 gap-y-1 text-[11px] text-muted">
          {item.channelLabel ? <span>via {item.channelLabel}</span> : null}
          {item.manual ? <ManualTag /> : null}
          <Time at={item.at} />
          {outgoing && item.delivered ? <CheckCheck className="size-3.5 text-success-fg" aria-label="enviada" /> : null}
        </p>
      </div>
    </li>
  );
}

export function ConversationThread({
  items,
  header,
  emptyText = "Nenhuma interação registrada ainda.",
  autoScroll = false,
  noRecordingText = "sem gravação (VoIP não conectado)",
  className,
  "aria-label": ariaLabel = "Conversa",
  "data-testid": testId,
}: ConversationThreadProps) {
  const ref = React.useRef<HTMLDivElement>(null);
  const lastId = items[items.length - 1]?.id;
  // Abre (e atualiza) no fim da conversa, como um chat.
  React.useEffect(() => {
    const el = ref.current;
    if (autoScroll && el) el.scrollTop = el.scrollHeight;
  }, [autoScroll, lastId]);
  // No celular a conversa pode começar oculta (pilha/drawer): ao ficar visível, desce para a última interação.
  React.useEffect(() => {
    const el = ref.current;
    if (!autoScroll || !el || typeof ResizeObserver === "undefined") return;
    let lastHeight = el.clientHeight;
    const observer = new ResizeObserver(() => {
      if (lastHeight === 0 && el.clientHeight > 0) el.scrollTop = el.scrollHeight;
      lastHeight = el.clientHeight;
    });
    observer.observe(el);
    return () => observer.disconnect();
  }, [autoScroll]);

  const days = items.map((item) => formatDay(item.at));
  return (
    <div ref={ref} className={cn(autoScroll && "min-h-0 flex-1 overflow-y-auto scrollbar-thin", className)} data-testid={testId}>
      <ol className="flex flex-col gap-3" aria-label={ariaLabel}>
        {header ? <li className="flex flex-wrap items-center gap-x-3 gap-y-1 border-b border-border pb-3 text-xs text-muted">{header}</li> : null}
        {items.length === 0 ? <li className="py-10 text-center text-sm text-muted">{emptyText}</li> : null}
        {items.map((item, i) => {
          const day = days[i];
          const separator = i === 0 || day !== days[i - 1];
          return (
            <React.Fragment key={item.id}>
              {separator ? (
                <li className="flex items-center gap-3 py-1" aria-hidden>
                  <span className="h-px flex-1 bg-border" />
                  <span className="text-[11px] font-medium uppercase tracking-wide text-muted-light">{day}</span>
                  <span className="h-px flex-1 bg-border" />
                </li>
              ) : null}
              <Item item={item} noRecordingText={noRecordingText} />
            </React.Fragment>
          );
        })}
      </ol>
    </div>
  );
}
