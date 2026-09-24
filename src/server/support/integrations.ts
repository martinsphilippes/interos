import "server-only";
/**
 * Estado real das integrações de comunicação usadas pelo Suporte.
 *
 * Nenhum provedor (WhatsApp Business API, VoIP/PABX com gravação, e-mail transacional) está conectado hoje:
 * todas as respostas e ligações são REGISTROS MANUAIS do que o atendente fez fora do sistema (wa.me, discador,
 * cliente de e-mail). Quando um adapter real for ligado em `channels.ts`, este módulo passa a devolver `true`
 * para o canal e o serviço envia de fato (ver `replyToTicket`, `registerCall` e `resolveTicket`).
 *
 * INTEGRAÇÃO: o estado central fica em `src/server/integrations/status.ts` (`isConnected(key)`), mas o adapter do
 * Suporte (`channels.ts`) ainda é só o mock. Credencial presente sem adapter real NÃO pode virar "conectado"
 * aqui; quando `channels.ts` enviar de verdade, troque os `false` por `isConnected("whatsapp" | "voip" | "email")`.
 */

export interface SupportChannelStatus {
  whatsapp: boolean;
  voip: boolean;
  email: boolean;
}

export async function getSupportChannelStatus(): Promise<SupportChannelStatus> {
  return { whatsapp: false, voip: false, email: false };
}
