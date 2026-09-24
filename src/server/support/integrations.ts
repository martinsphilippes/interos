import "server-only";
/**
 * Estado real das integrações de comunicação usadas pelo Suporte, lido do registro central
 * (src/server/integrations/status.ts: credencial no servidor + adaptador implementado).
 *
 * Com o canal conectado, o adapter do Suporte (`channels.ts`) envia de fato pelos provedores de
 * src/server/integrations/providers.ts (Meta Cloud API, Resend). Sem integração (situação padrão), respostas e
 * ligações são REGISTROS MANUAIS do que o atendente fez fora do sistema (wa.me, discador, cliente de e-mail).
 * VoIP não tem adaptador implementado: `voip` só fica true quando houver um.
 */
import { getCommunicationChannelStatus } from "@/server/integrations/status";

export interface SupportChannelStatus {
  whatsapp: boolean;
  voip: boolean;
  email: boolean;
}

export async function getSupportChannelStatus(): Promise<SupportChannelStatus> {
  const { whatsapp, voip, email } = getCommunicationChannelStatus();
  return { whatsapp, voip, email };
}
