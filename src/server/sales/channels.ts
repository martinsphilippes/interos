import "server-only";
import { isConnected } from "@/server/integrations/status";

/**
 * Estado real dos canais de comunicação usados pela Central de Vendas, lido do registro de integrações
 * (src/server/integrations/status.ts: credencial no servidor + adaptador implementado). Canal não conectado
 * = REGISTRO MANUAL na interface (links wa.me, tel:, mailto: e Google Maps por URL, que não exigem chave).
 */
export interface SalesChannelStatus {
  whatsapp: boolean;
  voip: boolean;
  email: boolean;
  maps: boolean;
}

export async function getSalesChannelStatus(): Promise<SalesChannelStatus> {
  return { whatsapp: isConnected("whatsapp"), voip: isConnected("voip"), email: isConnected("email"), maps: isConnected("mapas") };
}
