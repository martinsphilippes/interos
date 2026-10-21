/**
 * Modelo da tela da Central de Atendimento (cliente): abas, rótulos e a conversão dos itens da conversa para a
 * ConversationThread única do sistema.
 */
import type { ThreadItem } from "@/components/ui/conversation-thread";
import type { CentralTab, ThreadEntry } from "@/server/conversations/queries";
import type { ConversationChannel } from "@/domain/types";
import { CHANNEL_NAMES } from "@/domain/channels";

export const CENTRAL_TAB_LABELS: Record<CentralTab, string> = {
  minhas: "Minhas",
  fila: "Na fila",
  aguardando: "Aguardando cliente",
  todas: "Todas",
};

export const CENTRAL_TAB_ORDER: readonly CentralTab[] = ["minhas", "fila", "aguardando", "todas"];

export const CHANNEL_LABELS: Record<ConversationChannel, string> = CHANNEL_NAMES;

/** Abas da tela Canais e filas (?aba=). */
export const CANAIS_TABS = ["canais", "filas", "modelos", "respostas", "automaticas", "social", "telegram", "chat", "pausas", "alertas", "registros"] as const;
export type CanaisTab = (typeof CANAIS_TABS)[number];

export function toThreadItems(entries: readonly ThreadEntry[]): ThreadItem[] {
  return entries.map((e): ThreadItem => {
    if (e.kind === "note") return { kind: "note", id: e.id, at: e.at, authorName: e.authorName, body: e.body };
    if (e.kind === "system") return { kind: "system", id: e.id, at: e.at, title: e.title, description: e.description };
    return {
      kind: "message",
      id: e.id,
      at: e.at,
      direction: e.direction,
      authorName: e.authorName,
      authorRole: e.authorRole,
      body: e.body,
      channel: e.channel,
      channelLabel: CHANNEL_LABELS[e.channel],
      manual: e.manual,
      delivered: e.delivered,
    };
  });
}

/** "há 6 min", "há 2 h", "há 3 d" — tempo de espera do cliente. */
export function waitingLabel(since: string | undefined, now: number): string | null {
  if (!since) return null;
  const ms = now - new Date(since).getTime();
  if (!Number.isFinite(ms) || ms < 0) return null;
  const min = Math.floor(ms / 60000);
  if (min < 1) return "agora";
  if (min < 60) return `há ${min} min`;
  const h = Math.floor(min / 60);
  if (h < 24) return `há ${h} h`;
  return `há ${Math.floor(h / 24)} d`;
}

/** Link de envio pelo aparelho (WhatsApp Web/app ou e-mail). */
export function manualHref(channel: ConversationChannel, address: string, text: string, subject = "Intercert — Atendimento"): string | null {
  if (channel === "email") return `mailto:${address}?subject=${encodeURIComponent(subject)}&body=${encodeURIComponent(text)}`;
  const digits = address.replace(/\D/g, "");
  if (digits.length < 10) return null;
  const intl = digits.length <= 11 ? `55${digits}` : digits;
  return `https://wa.me/${intl}?text=${encodeURIComponent(text)}`;
}

/** Abas da Central de Comando (?aba=), uma por seção do catálogo comunicacao.supervisao. */
export const SUPERVISAO_TABS = ["painel", "registro"] as const;
