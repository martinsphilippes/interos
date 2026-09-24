import "server-only";
/**
 * Registro de comunicações (WhatsApp, ligação, e-mail) com o status honesto de cada envio:
 * - "manual": o contato foi feito fora do sistema (wa.me, tel:, mailto:) e registrado pelo usuário;
 * - "enviada"/"falha": o INTEROS chamou o provedor real.
 *
 * `Communication.status` e `provider` ainda não aceitam "manual"/"resend" em src/domain/types.ts; a extensão
 * está em ./types.ts e o integrador deve incluí-la no tipo (ver relatório). Leitores atuais não dependem de
 * um mapa fechado de status, então o valor novo não quebra nenhuma tela.
 */
import { create } from "@/server/db";
import { COLLECTIONS, type Communication } from "@/domain/types";

export type CommunicationInput = Omit<Communication, "id" | "organizationId" | "createdAt" | "updatedAt" | "status" | "provider"> & {
  status: Communication["status"];
  provider: Communication["provider"];
};

export async function recordCommunication(input: CommunicationInput): Promise<Communication> {
  return create<Communication>(COLLECTIONS.communications, input as unknown as Omit<Communication, "id" | "organizationId" | "createdAt" | "updatedAt">);
}

/** Status/provider de uma comunicação feita fora do sistema. */
export const MANUAL = { status: "manual", provider: "manual" } as const satisfies { status: Communication["status"]; provider: Communication["provider"] };

/** Rótulo de exibição do status (inclui os valores estendidos). */
export function communicationStatusLabel(status: string | undefined): string {
  switch (status) {
    case "manual":
      return "Registro manual";
    case "simulada":
      return "Registro manual (legado)";
    case "enviada":
      return "Enviada";
    case "entregue":
      return "Entregue";
    case "lida":
      return "Lida";
    case "falha":
      return "Falha no envio";
    case "recebida":
      return "Recebida";
    default:
      return status ?? "—";
  }
}
