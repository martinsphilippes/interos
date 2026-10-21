/**
 * Canais da Central de Atendimento: nomes, o que identifica quem escreve e a janela de resposta de cada canal
 * (fase 5: Instagram, Messenger, Telegram e chat do site). Puro: sem servidor.
 */
import type { ConversationChannel } from "./types";

export interface ChannelInfo {
  label: string;
  /** O que é o «endereço» de quem escreve nesse canal. */
  addressKind: "telefone" | "email" | "id";
  /** Canal da Meta com janela de resposta (24 h; depois, só com a etiqueta de atendimento humano até 7 dias). */
  metaWindow: boolean;
}

export const CHANNEL_INFO: Record<ConversationChannel, ChannelInfo> = {
  whatsapp: { label: "WhatsApp", addressKind: "telefone", metaWindow: false },
  email: { label: "E-mail", addressKind: "email", metaWindow: false },
  instagram: { label: "Instagram", addressKind: "id", metaWindow: true },
  messenger: { label: "Messenger", addressKind: "id", metaWindow: true },
  telegram: { label: "Telegram", addressKind: "id", metaWindow: false },
  chat: { label: "Chat do site", addressKind: "id", metaWindow: false },
};

export const CHANNEL_NAMES: Record<ConversationChannel, string> = Object.fromEntries(Object.entries(CHANNEL_INFO).map(([k, v]) => [k, v.label])) as Record<ConversationChannel, string>;

const HOUR = 3_600_000;

/**
 * Janela do Instagram/Messenger: até 24 h da última mensagem do cliente, resposta normal; de 24 h a 7 dias, só com a
 * etiqueta HUMAN_AGENT (atendimento humano); depois disso a Meta recusa.
 */
export function metaReplyWindow(lastInboundAt: string | undefined, now: number = Date.now()): { open: boolean; humanAgentTag: boolean } {
  if (!lastInboundAt) return { open: false, humanAgentTag: false };
  const age = now - new Date(lastInboundAt).getTime();
  if (age <= 24 * HOUR) return { open: true, humanAgentTag: false };
  if (age <= 7 * 24 * HOUR) return { open: true, humanAgentTag: true };
  return { open: false, humanAgentTag: false };
}
