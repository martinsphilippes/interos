import "server-only";
/**
 * Adaptadores de canal (WhatsApp, e-mail) da Caixa de Entrada.
 *
 * O envio consulta o registro de integrações (src/server/integrations/status.ts):
 * - WhatsApp conectado (Meta Cloud API) → envia de verdade e grava provider "meta" (status "enviada" ou "falha");
 * - e-mail conectado (Resend) → envia de verdade e grava provider "resend";
 * - sem integração (situação padrão) → nada sai do sistema: a mensagem é gravada como REGISTRO MANUAL
 *   (status/provider "manual") do que o usuário enviou pelo próprio app (wa.me / mailto) e aparece na timeline.
 * O recebimento grava a mensagem de entrada (webhook /api/webhooks/whatsapp).
 */
import { emitEvent } from "@/server/events";
import { MANUAL, recordCommunication } from "@/server/integrations/communications";
import { sendEmail, sendWhatsappText } from "@/server/integrations/providers";
import { isConnected } from "@/server/integrations/status";
import type { Communication, UserRef } from "@/domain/types";

export type MessageChannel = "whatsapp" | "email";

export interface OutgoingMessage {
  channel: MessageChannel;
  /** Telefone (WhatsApp) ou e-mail do destinatário. */
  to?: string;
  body: string;
  clientId?: string;
  contactId?: string;
  entity?: { type: string; id: string };
  sender: UserRef;
}

export interface IncomingMessage {
  channel: MessageChannel;
  from?: string;
  body: string;
  clientId?: string;
  contactId?: string;
  entity?: { type: string; id: string };
  externalId?: string;
}

export interface ChannelAdapter {
  readonly provider: Communication["provider"];
  sendMessage(message: OutgoingMessage): Promise<Communication>;
  receiveMessage(message: IncomingMessage): Promise<Communication>;
}

const SYSTEM_ACTOR: UserRef = { id: "sistema", name: "INTEROS" };

/** Envia pelo provedor quando o canal está conectado; senão devolve null (registro manual). */
async function deliver(message: OutgoingMessage): Promise<{ provider: "meta" | "resend"; ok: boolean; externalId?: string } | null> {
  if (!message.to) return null;
  if (message.channel === "whatsapp" && isConnected("whatsapp")) {
    const r = await sendWhatsappText(message.to, message.body);
    return { provider: "meta", ok: r.ok, externalId: r.ok ? r.externalId : undefined };
  }
  if (message.channel === "email" && isConnected("email")) {
    const r = await sendEmail({ to: message.to, subject: "Intercert", text: message.body });
    return { provider: "resend", ok: r.ok, externalId: r.ok ? r.externalId : undefined };
  }
  return null;
}

const adapter: ChannelAdapter = {
  // Tipo público mantido; o provider real de cada envio fica gravado na comunicação.
  provider: "outro",

  async sendMessage(message) {
    const sent = await deliver(message);
    const communication = await recordCommunication({
      clientId: message.clientId,
      contactId: message.contactId,
      channel: message.channel,
      direction: "saida",
      userId: message.sender.id,
      entityType: message.entity?.type,
      entityId: message.entity?.id,
      body: message.body,
      ...(sent ? { status: sent.ok ? "enviada" : "falha", provider: sent.provider, externalId: sent.externalId } : MANUAL),
      createdBy: message.sender.id,
    });
    if (message.channel === "whatsapp") {
      const how = !sent ? " (registro manual)" : sent.ok ? "" : " (falha no envio)";
      await emitEvent({
        type: "whatsapp.message.sent",
        actor: message.sender,
        clientId: message.clientId,
        entity: message.entity ?? { type: "communication", id: communication.id },
        title: `WhatsApp ${sent ? "enviado" : "registrado"}${message.to ? ` para ${message.to}` : ""}${how}`,
        description: message.body,
        department: "marketing",
        payload: { communicationId: communication.id, to: message.to, provider: sent?.provider ?? "manual", manual: !sent, delivered: sent?.ok ?? false },
      });
    }
    return communication;
  },

  async receiveMessage(message) {
    const communication = await recordCommunication({
      clientId: message.clientId,
      contactId: message.contactId,
      channel: message.channel,
      direction: "entrada",
      entityType: message.entity?.type,
      entityId: message.entity?.id,
      body: message.body,
      status: "recebida",
      externalId: message.externalId,
      provider: message.channel === "whatsapp" && isConnected("whatsapp") ? "meta" : "outro",
    });
    if (message.channel === "whatsapp") {
      await emitEvent({
        type: "whatsapp.message.received",
        actor: SYSTEM_ACTOR,
        clientId: message.clientId,
        entity: message.entity ?? { type: "communication", id: communication.id },
        title: `WhatsApp recebido${message.from ? ` de ${message.from}` : ""}`,
        description: message.body,
        department: "marketing",
        payload: { communicationId: communication.id, from: message.from, provider: communication.provider, entityType: message.entity?.type, entityId: message.entity?.id },
      });
    }
    return communication;
  },
};

export function getChannelAdapter(): ChannelAdapter {
  return adapter;
}
