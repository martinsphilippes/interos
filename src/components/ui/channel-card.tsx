import * as React from "react";
import Link from "next/link";
import { Mail, MessageCircle, MessagesSquare, Phone } from "lucide-react";
import { cn } from "@/lib/utils";
import { StatusDot } from "./status-dot";

export type ChannelKind = "whatsapp" | "voip" | "email" | "chat";

const CHANNEL: Record<ChannelKind, { label: string; icon: React.ReactNode; on: string; iconOn: string }> = {
  whatsapp: { label: "WhatsApp", icon: <MessageCircle />, on: "border-success/35 bg-success-soft", iconOn: "text-success-fg" },
  voip: { label: "Telefonia VoIP", icon: <Phone />, on: "border-info/35 bg-info-soft", iconOn: "text-info-fg" },
  email: { label: "E-mail", icon: <Mail />, on: "border-secondary/35 bg-secondary-soft", iconOn: "text-secondary-fg" },
  chat: { label: "Chat", icon: <MessagesSquare />, on: "border-accent-purple/35 bg-accent-purple-soft", iconOn: "text-accent-purple-fg" },
};

export interface ChannelCardProps {
  channel: ChannelKind;
  /** Integração realmente ativa. NUNCA passe true sem um adapter funcionando. */
  connected: boolean;
  /** Título (padrão: nome do canal). */
  title?: string;
  /** Rótulo do botão de ação (ex.: "Iniciar conversa", "Registrar ligação"). */
  actionLabel?: string;
  /** Link da ação (ex.: https://wa.me/55..., tel:+55...). */
  href?: string;
  onAction?: () => void;
  /** Conteúdo extra (última mensagem/ligação etc.). */
  children?: React.ReactNode;
  className?: string;
}

/**
 * Card de canal de comunicação (WhatsApp, VoIP...). Quando `connected` é false o card fica neutro e diz
 * "Não conectado · registro manual": a ação abre o app externo/discador e o contato é registrado à mão.
 */
export function ChannelCard({ channel, connected, title, actionLabel, href, onAction, children, className }: ChannelCardProps) {
  const cfg = CHANNEL[channel];
  const actionClass = cn(
    "inline-flex min-h-[44px] w-full items-center justify-center gap-2 rounded-lg px-3 text-sm font-medium transition-colors md:min-h-9 [&_svg]:size-4",
    connected ? "bg-surface/60 text-foreground hover:bg-surface" : "border border-border-strong text-foreground hover:bg-surface-hover",
  );
  const external = href?.startsWith("http");
  return (
    <div className={cn("flex flex-col gap-3 rounded-xl border p-3.5", connected ? cfg.on : "border-border bg-surface-muted", className)}>
      <div className="flex items-center gap-2.5">
        <span className={cn("[&_svg]:size-5", connected ? cfg.iconOn : "text-muted")} aria-hidden>
          {cfg.icon}
        </span>
        <span className="min-w-0 flex-1 truncate text-sm font-semibold text-foreground">{title ?? cfg.label}</span>
      </div>
      {connected ? (
        <StatusDot tone="success" label="Conectado" className="text-xs text-success-fg" size="sm" />
      ) : (
        <span className="inline-flex items-center gap-1.5 text-xs text-muted">
          <StatusDot tone="muted" size="sm" />
          Não conectado · registro manual
        </span>
      )}
      {actionLabel ? (
        href ? (
          external ? (
            <a href={href} target="_blank" rel="noreferrer" className={actionClass}>
              {cfg.icon}
              {actionLabel}
            </a>
          ) : href.startsWith("/") ? (
            <Link href={href} className={actionClass}>
              {cfg.icon}
              {actionLabel}
            </Link>
          ) : (
            <a href={href} className={actionClass}>
              {cfg.icon}
              {actionLabel}
            </a>
          )
        ) : (
          <button type="button" onClick={onAction} className={actionClass}>
            {cfg.icon}
            {actionLabel}
          </button>
        )
      ) : null}
      {children ? <div className="text-xs text-muted">{children}</div> : null}
    </div>
  );
}
