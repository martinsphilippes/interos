import "server-only";
/**
 * Canais do Suporte (WhatsApp, e-mail, portal e telefonia/VoIP).
 *
 * Hoje só existe a implementação `mock`: nada sai do sistema. Cada envio/ligação é registrado em
 * `communications` com provider "mock" (status "simulada") para aparecer no histórico do cliente e
 * nos relatórios. O restante do módulo só conhece a interface `SupportChannelAdapter`; para ligar um
 * provedor real basta implementá-la e trocar o retorno de `getSupportChannels()`.
 *
 * ONDE PLUGAR OS PROVEDORES REAIS
 *
 * 1) WhatsApp — Meta WhatsApp Business (Cloud API):
 *    - Envio: `sendMessage` com channel "whatsapp" deve fazer
 *      POST https://graph.facebook.com/v20.0/{WHATSAPP_PHONE_NUMBER_ID}/messages
 *      (Authorization: Bearer {WHATSAPP_ACCESS_TOKEN}; corpo { messaging_product: "whatsapp", to, type: "text", text: { body } }).
 *      Fora da janela de 24 h a Meta só aceita mensagens de template aprovadas (use `templateKey`).
 *      Grave `externalId` = messages[0].id e provider "meta"; o status (entregue/lida) chega pelo webhook.
 *    - Recebimento: a rota POST /api/webhooks/whatsapp recebe o webhook da Meta. Ela já trata o formato
 *      `entry[].changes[].value.messages[]` e o formato simplificado { from, body, id } e chama
 *      `receiveWhatsappMessage`. Configure WHATSAPP_VERIFY_TOKEN (handshake GET) e valide a assinatura
 *      `X-Hub-Signature-256` com WHATSAPP_APP_SECRET antes de ir para produção.
 *
 * 2) VoIP / PABX (click-to-call e gravação):
 *    - `registerCall` hoje só registra a ligação feita fora do sistema. Com um provedor (ex.: Twilio,
 *      Zenvia Voice, PABX IP próprio), `startCall` pediria a chamada ao provedor e o webhook de fim de
 *      chamada chamaria `registerCall` com duração real, `externalId` e `recordingUrl` do provedor.
 *
 * 3) E-mail: `sendMessage` com channel "email" pode usar qualquer provedor transacional (SES, SendGrid,
 *    Resend). Respostas do cliente entram por um webhook de inbound parse que chama `receiveEmailMessage`
 *    (a implementar junto com o provedor).
 */
import { create } from "@/server/db";
import { COLLECTIONS, type Communication, type UserRef } from "@/domain/types";

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
  /** Usado para montar a URL (simulada) da gravação. */
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

const mockId = () => `mock_${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`;

const mockAdapter: SupportChannelAdapter = {
  provider: "mock",

  async sendMessage(message) {
    return create<Communication>(COLLECTIONS.communications, {
      clientId: message.clientId,
      contactId: message.contactId,
      channel: COMM_CHANNEL[message.channel],
      direction: "saida",
      userId: message.sender.id,
      entityType: message.entity?.type,
      entityId: message.entity?.id,
      body: message.body,
      templateKey: message.templateKey,
      status: "simulada",
      externalId: mockId(),
      provider: "mock",
      createdBy: message.sender.id,
    });
  },

  async registerCall(call) {
    return create<Communication>(COLLECTIONS.communications, {
      clientId: call.clientId,
      contactId: call.contactId,
      channel: "voip",
      direction: call.direction,
      userId: call.user.id,
      entityType: call.entity?.type,
      entityId: call.entity?.id,
      body: call.summary,
      status: "simulada",
      durationSeconds: call.durationSeconds,
      recordingUrl: mockRecordingUrl(call.recordingKey),
      externalId: mockId(),
      provider: "mock",
      createdBy: call.user.id,
    });
  },

  async receiveMessage(message) {
    return create<Communication>(COLLECTIONS.communications, {
      clientId: message.clientId,
      contactId: message.contactId,
      channel: message.channel,
      direction: "entrada",
      entityType: message.entity?.type,
      entityId: message.entity?.id,
      // Sem cliente identificado, o número vai no corpo para a Caixa de Entrada do Marketing mostrar a origem.
      body: !message.clientId && message.from ? `[${message.from}] ${message.body}` : message.body,
      status: "recebida",
      externalId: message.externalId ?? mockId(),
      provider: "mock",
    });
  },
};

/** URL simulada da gravação (o provedor VoIP real devolve a URL do arquivo). */
export function mockRecordingUrl(key: string): string {
  return `https://mock.intercert.com.br/gravacoes/${encodeURIComponent(key)}.mp3`;
}

export function getSupportChannels(): SupportChannelAdapter {
  return mockAdapter;
}
