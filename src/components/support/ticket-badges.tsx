import { Globe, Mail, MessageCircle, Phone, Wrench } from "lucide-react";
import type { SupportTicket } from "@/domain/types";
import { Badge, type BadgeProps } from "@/components/ui/badge";
import { cn } from "@/lib/utils";
import { TICKET_CHANNEL_LABELS, TICKET_PRIORITY_LABELS, TICKET_STATUS_LABELS } from "@/server/support/schemas";

type Variant = NonNullable<BadgeProps["variant"]>;

export const TICKET_PRIORITY_VARIANT: Record<SupportTicket["priority"], Variant> = { critico: "danger", alto: "warning", medio: "info", baixo: "muted" };
export const TICKET_STATUS_VARIANT: Record<SupportTicket["status"], Variant> = {
  aberto: "info",
  em_atendimento: "brand",
  aguardando_cliente: "warning",
  resolvido: "success",
  fechado: "muted",
  reaberto: "danger",
};

export function TicketPriorityBadge({ priority, size = "sm", className }: { priority: SupportTicket["priority"]; size?: BadgeProps["size"]; className?: string }) {
  return (
    <Badge variant={TICKET_PRIORITY_VARIANT[priority]} size={size} className={cn("gap-1.5", className)}>
      {priority === "critico" ? <span className="size-1.5 rounded-full bg-danger" aria-hidden /> : null}
      {TICKET_PRIORITY_LABELS[priority]}
    </Badge>
  );
}

export function TicketStatusBadge({ status, size = "sm", className }: { status: SupportTicket["status"]; size?: BadgeProps["size"]; className?: string }) {
  return (
    <Badge variant={TICKET_STATUS_VARIANT[status]} size={size} className={className}>
      {TICKET_STATUS_LABELS[status]}
    </Badge>
  );
}

const CHANNEL_ICON: Record<SupportTicket["channel"], typeof Phone> = { whatsapp: MessageCircle, telefone: Phone, email: Mail, portal: Globe, interno: Wrench };

/** Ícone do canal com rótulo acessível (texto visível opcional). */
export function ChannelIcon({ channel, showLabel, className }: { channel: SupportTicket["channel"]; showLabel?: boolean; className?: string }) {
  const Icon = CHANNEL_ICON[channel] ?? Globe;
  return (
    <span className={cn("inline-flex items-center gap-1.5 text-muted", className)} title={TICKET_CHANNEL_LABELS[channel]}>
      <Icon className={cn("size-4 shrink-0", channel === "whatsapp" && "text-success-fg")} aria-hidden />
      {showLabel ? <span className="text-sm text-foreground">{TICKET_CHANNEL_LABELS[channel]}</span> : <span className="sr-only">{TICKET_CHANNEL_LABELS[channel]}</span>}
    </span>
  );
}

export function QueueBadge({ queue }: { queue: string }) {
  return (
    <Badge variant="outline" size="sm" className="font-mono uppercase">
      {queue}
    </Badge>
  );
}
