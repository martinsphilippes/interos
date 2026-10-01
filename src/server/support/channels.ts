import "server-only";
/**
 * Canais do Suporte (WhatsApp, e-mail, portal e telefonia/VoIP).
 *
 * O adaptador consulta o registro de integrações (src/server/integrations/status.ts):
 * - WhatsApp conectado (Meta Cloud API: WHATSAPP_ACCESS_TOKEN + WHATSAPP_PHONE_NUMBER_ID) → envio real,
 *   provider "meta"; o status (entregue/lida) chega pelo webhook /api/webhooks/whatsapp.
 * - E-mail conectado (Resend: RESEND_API_KEY + EMAIL_FROM) → envio real, provider "resend".
 * - VoIP: nenhum adaptador implementado. `registerCall` só registra a ligação feita no discador
 *   (status "manual", sem gravação). Com um provedor (Twilio, Zenvia Voice, PABX IP), o webhook de fim de
 *   chamada chamaria `registerCall` com duração real, `externalId` e `recordingUrl` do provedor.
 * - Sem integração (situação padrão): nada sai do sistema; a mensagem é um REGISTRO MANUAL do que o
 *   atendente enviou pelo próprio app (wa.me / mailto).
 * Respostas de e-mail do cliente entram por um webhook de inbound parse que chama `receiveMessage`
 * (a implementar junto com o provedor).
 */
import { MANUAL, recordCommunication, sendOrRecord } from "@/server/integrations/communications";
import { isConnected } from "@/server/integrations/status";
import type { Communication, UserRef } from "@/domain/types";

export type SupportMessageChannel = "whatsapp" | "email" | "portal";

export interface SupportOutgoingMessage {
  channel: SupportMessageChannel;
  /** Telefone (WhatsApp) ou e-mail do destinatário. */
  to?: string;
  body: string;
  clientId?: string;
  contactId?: string;
  entity?: { type: string; id: string };
  sender: UserRef;
  templateKey?: string;
}

export interface SupportCall {
  direction: "entrada" | "saida";
  durationSeconds: number;
  summary: string;
  clientId?: string;
  contactId?: string;
  entity?: { type: string; id: string };
  user: UserRef;
  /** Chave da ligação (o provedor VoIP real devolve a gravação; sem provedor não há gravação). */
  recordingKey: string;
}

export interface SupportIncomingMessage {
  channel: "whatsapp" | "email";
  from?: string;
  body: string;
  clientId?: string;
  contactId?: string;
  entity?: { type: string; id: string };
  externalId?: string;
}

export interface SupportChannelAdapter {
  readonly provider: Communication["provider"];
  sendMessage(message: SupportOutgoingMessage): Promise<Communication>;
  registerCall(call: SupportCall): Promise<Communication>;
  receiveMessage(message: SupportIncomingMessage): Promise<Communication>;
}

const COMM_CHANNEL: Record<SupportMessageChannel, Communication["channel"]> = { whatsapp: "whatsapp", email: "email", portal: "interno" };

const adapter: SupportChannelAdapter = {
  // Tipo público mantido; o provider real de cada envio fica gravado na comunicação.
  provider: "outro",

  async sendMessage(message) {
    // Portal é interno (a resposta fica no chamado); WhatsApp/e-mail passam pelo helper único
    // (src/server/integrations/communications.ts): envio real se conectado, senão registro manual.
    if (message.channel === "portal") {
      return recordCommunication({
        clientId: message.clientId,
        contactId: message.contactId,
        channel: COMM_CHANNEL.portal,
        direction: "saida",
        userId: message.sender.id,
        entityType: message.entity?.type,
        entityId: message.entity?.id,
        body: message.body,
        templateKey: message.templateKey,
        status: "enviada",
        provider: "outro",
        createdBy: message.sender.id,
      });
    }
    const sent = await sendOrRecord({
      channel: message.channel,
      to: message.to,
      subject: "Intercert — Suporte",
      text: message.body,
      clientId: message.clientId,
      contactId: message.contactId,
      entity: message.entity,
      templateKey: message.templateKey,
      actor: message.sender,
    });
    return sent.communication;
  },

  async registerCall(call) {
    // Sem provedor VoIP: ligação feita no discador, registrada à mão e sem gravação.
    return recordCommunication({
      clientId: call.clientId,
      contactId: call.contactId,
      channel: "voip",
      direction: call.direction,
      userId: call.user.id,
      entityType: call.entity?.type,
      entityId: call.entity?.id,
      body: call.summary,
      ...MANUAL,
      durationSeconds: call.durationSeconds,
      createdBy: call.user.id,
    });
  },

  async receiveMessage(message) {
    return recordCommunication({
      clientId: message.clientId,
      contactId: message.contactId,
      channel: message.channel,
      direction: "entrada",
      entityType: message.entity?.type,
      entityId: message.entity?.id,
      // Sem cliente identificado, o número vai no corpo para a Caixa de Entrada do Marketing mostrar a origem.
      body: !message.clientId && message.from ? `[${message.from}] ${message.body}` : message.body,
      status: "recebida",
      externalId: message.externalId,
      provider: message.channel === "whatsapp" && isConnected("whatsapp") ? "meta" : "outro",
    });
  },
};

export function getSupportChannels(): SupportChannelAdapter {
  return adapter;
}
