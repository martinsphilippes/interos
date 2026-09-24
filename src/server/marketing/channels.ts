import "server-only";
/**
 * Adaptadores de canal (WhatsApp, e-mail) da Caixa de Entrada.
 *
 * Hoje só existe a implementação `mock`: o envio é simulado (registrado em `communications` com
 * provider "mock" e status "simulada") e o recebimento grava a mensagem de entrada. Quando a
 * WhatsApp Business API (Meta) for conectada, basta implementar `ChannelAdapter` e trocar o
 * retorno de `getChannelAdapter` — o restante do módulo não muda.
 */
import { create } from "@/server/db";
import { emitEvent } from "@/server/events";
import { COLLECTIONS, type Communication, type UserRef } from "@/domain/types";

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

/** Implementação simulada: nada sai do sistema; tudo fica registrado e aparece na timeline. */
const mockAdapter: ChannelAdapter = {
  provider: "mock",

  async sendMessage(message) {
    const communication = await create<Communication>(COLLECTIONS.communications, {
      clientId: message.clientId,
      contactId: message.contactId,
      channel: message.channel,
      direction: "saida",
      userId: message.sender.id,
      entityType: message.entity?.type,
      entityId: message.entity?.id,
      body: message.body,
      status: "simulada",
      externalId: `mock_${Date.now().toString(36)}`,
      provider: "mock",
      createdBy: message.sender.id,
    });
    if (message.channel === "whatsapp") {
      await emitEvent({
        type: "whatsapp.message.sent",
        actor: message.sender,
        clientId: message.clientId,
        entity: message.entity ?? { type: "communication", id: communication.id },
        title: `WhatsApp enviado${message.to ? ` para ${message.to}` : ""} (simulado)`,
        description: message.body,
        department: "marketing",
        payload: { communicationId: communication.id, to: message.to, provider: "mock", simulated: true },
      });
    }
    return communication;
  },

  async receiveMessage(message) {
    const communication = await create<Communication>(COLLECTIONS.communications, {
      clientId: message.clientId,
      contactId: message.contactId,
      channel: message.channel,
      direction: "entrada",
      entityType: message.entity?.type,
      entityId: message.entity?.id,
      body: message.body,
      status: "recebida",
      externalId: message.externalId ?? `mock_${Date.now().toString(36)}`,
      provider: "mock",
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
        payload: { communicationId: communication.id, from: message.from, provider: "mock", entityType: message.entity?.type, entityId: message.entity?.id },
      });
    }
    return communication;
  },
};

export function getChannelAdapter(): ChannelAdapter {
  return mockAdapter;
}
