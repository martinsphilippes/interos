import { CalendarDays, Calculator, Camera, Globe, Handshake, List, Megaphone, MessageCircle, Music2, PenLine, Search, Send, Users, type LucideIcon } from "lucide-react";
import type { LeadSource } from "@/domain/types";
import { IconTile } from "@/components/ui/icon-tile";
import type { Tone } from "@/components/ui/tone";

/** Ícone e tom por canal de origem de lead (sem logos de marca: ícones genéricos do lucide). */
export const CHANNEL_VISUAL: Record<LeadSource["channel"], { icon: LucideIcon; tone: Tone }> = {
  instagram: { icon: Camera, tone: "purple" },
  tiktok: { icon: Music2, tone: "neutral" },
  site: { icon: Globe, tone: "info" },
  whatsapp: { icon: MessageCircle, tone: "success" },
  telegram: { icon: Send, tone: "secondary" },
  anuncio: { icon: Megaphone, tone: "warning" },
  google_ads: { icon: Search, tone: "info" },
  indicacao: { icon: Users, tone: "brand" },
  parceiro: { icon: Handshake, tone: "success" },
  contador: { icon: Calculator, tone: "secondary" },
  evento: { icon: CalendarDays, tone: "purple" },
  lista: { icon: List, tone: "info" },
  manual: { icon: PenLine, tone: "neutral" },
};

export function ChannelIcon({ channel, size = "sm" }: { channel: LeadSource["channel"]; size?: "xs" | "sm" | "md" }) {
  const visual = CHANNEL_VISUAL[channel] ?? CHANNEL_VISUAL.manual;
  const Icon = visual.icon;
  return <IconTile icon={<Icon />} tone={visual.tone} size={size} />;
}
