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
import { recordCommunication, sendOrRecord } from "@/server/integrations/communications";
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

const adapter: ChannelAdapter = {
  // Tipo público mantido; o provider real de cada envio fica gravado na comunicação.
  provider: "outro",

  async sendMessage(message) {
    // Helper único (src/server/integrations/communications.ts): envia se conectado, senão registro manual.
    const sent = await sendOrRecord({
      channel: message.channel,
      to: message.to,
      subject: "Intercert",
      text: message.body,
      clientId: message.clientId,
      contactId: message.contactId,
      entity: message.entity,
      actor: message.sender,
    });
    const { communication } = sent;
    if (message.channel === "whatsapp") {
      const manual = sent.delivery === "manual";
      const how = manual ? " (registro manual)" : sent.delivery === "enviada" ? "" : sent.delivery === "nao_enviada" ? " (não enviado: opt-out)" : " (falha no envio)";
      await emitEvent({
        type: "whatsapp.message.sent",
        actor: message.sender,
        clientId: message.clientId,
        entity: message.entity ?? { type: "communication", id: communication.id },
        title: `WhatsApp ${manual ? "registrado" : "enviado"}${message.to ? ` para ${message.to}` : ""}${how}`,
        description: message.body,
        department: "marketing",
        payload: { communicationId: communication.id, to: message.to, provider: sent.provider, manual, delivered: sent.delivery === "enviada", delivery: sent.delivery },
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
