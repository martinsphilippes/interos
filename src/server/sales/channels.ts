import "server-only";
import { getCommunicationChannelStatus, type CommunicationChannelStatus } from "@/server/integrations/status";

/**
 * Estado real dos canais de comunicação usados pela Central de Vendas, lido do registro de integrações
 * (src/server/integrations/status.ts: credencial no servidor + adaptador implementado). Canal não conectado
 * = REGISTRO MANUAL na interface (links wa.me, tel:, mailto: e Google Maps por URL, que não exigem chave).
 */
export type SalesChannelStatus = CommunicationChannelStatus;

export async function getSalesChannelStatus(): Promise<SalesChannelStatus> {
  return getCommunicationChannelStatus();
}
