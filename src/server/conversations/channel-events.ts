import "server-only";
/**
 * Registros técnicos dos canais (coleção channel_events): cada aviso do provedor e o que o INTEROS fez com ele —
 * processado, repetido ignorado, recusado por assinatura, falha. Contato sempre mascarado; nunca o texto da mensagem.
 * Gravar o registro nunca derruba o webhook (falha vai só para o log).
 */
import { create, nowIso } from "@/server/db";
import { COLLECTIONS, type ChannelEvent } from "@/domain/types";
import { maskEmail, maskPhone } from "@/domain/phone";

/** Quanto tempo os registros ficam guardados. */
export const CHANNEL_EVENT_RETENTION_DAYS = 30;

export type ChannelEventInput = Omit<ChannelEvent, "id" | "organizationId" | "createdAt" | "updatedAt" | "occurredAt" | "contactMasked"> & {
  occurredAt?: string;
  /** Telefone/e-mail em claro: é mascarado antes de gravar. */
  contact?: string;
};

export async function logChannelEvent(input: ChannelEventInput): Promise<void> {
  const { contact, ...rest } = input;
  try {
    await create<ChannelEvent>(COLLECTIONS.channelEvents, {
      ...rest,
      contactMasked: contact ? (input.channel === "email" ? maskEmail(contact) : maskPhone(contact)) : undefined,
      occurredAt: input.occurredAt ?? nowIso(),
    });
  } catch (error) {
    console.error("[canais] falha ao gravar registro técnico", error);
  }
}
