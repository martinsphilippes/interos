import { Camera, Mail, MessageCircle, MessageSquareText, MessagesSquare, Send } from "lucide-react";
import type { ConversationChannel } from "@/domain/types";
import { cn } from "@/lib/utils";

const ICON: Record<ConversationChannel, typeof Mail> = { whatsapp: MessageCircle, email: Mail, instagram: Camera, messenger: MessagesSquare, telegram: Send, chat: MessageSquareText };

/** Tom do ícone do canal (IconTile). */
export const CHANNEL_TONE: Record<ConversationChannel, "success" | "secondary" | "info" | "warning" | "neutral"> = { whatsapp: "success", email: "secondary", instagram: "warning", messenger: "info", telegram: "info", chat: "neutral" };

const COLOR: Record<ConversationChannel, string> = { whatsapp: "text-success-fg", email: "text-info-fg", instagram: "text-warning-fg", messenger: "text-info-fg", telegram: "text-info-fg", chat: "text-muted" };

/** Ícone do canal da conversa (decorativo: o nome do canal vem no texto ao lado). */
export function ChannelGlyph({ channel, className, colored }: { channel: ConversationChannel; className?: string; colored?: boolean }) {
  const Icon = ICON[channel] ?? MessageCircle;
  return <Icon className={cn(colored && COLOR[channel], className)} aria-hidden />;
}
