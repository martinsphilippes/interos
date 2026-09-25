import "server-only";
/**
 * Interface de cobrança externa (Asaas, Iugu...). Hoje só existe a implementação "manual": as cobranças
 * são controladas no INTEROS (coleção `billing`), o boleto/PIX é emitido fora e o pagamento é registrado
 * à mão com comprovante. Para ligar um provedor real:
 *   1. implementar `BillingProvider` (createCharge → POST do provedor; getChargeStatus → GET; handleWebhook
 *      → validar o evento e chamar `registerPayment` do serviço financeiro para dar baixa);
 *   2. marcar a opção como implementada no catálogo de ./status.ts (requirements[].implemented);
 *   3. devolver a implementação em `getBillingProvider()` quando `isConnected("cobranca")`.
 * A rota POST /api/webhooks/cobranca já valida o token e delega a `handleWebhook`.
 */
import { getById } from "@/server/db";
import { COLLECTIONS, type Billing, type Client } from "@/domain/types";
import { isConnected } from "./status";

export type ChargeStatus = "aguardando_emissao_manual" | "pendente" | "pago" | "vencido" | "cancelado" | "desconhecido";

export interface ChargeResult {
  provider: string;
  /** Id da cobrança no provedor (vazio no modo manual). */
  externalId?: string;
  status: ChargeStatus;
  /** Link do boleto/PIX quando o provedor devolve. */
  paymentUrl?: string;
  /** Orientação ao usuário no modo manual. */
  instructions?: string;
}

export interface WebhookResult {
  handled: boolean;
  /** Cobranças do INTEROS afetadas. */
  billingIds: string[];
  message: string;
}

export interface BillingProvider {
  readonly name: string;
  createCharge(billing: Billing, client: Client): Promise<ChargeResult>;
  getChargeStatus(billing: Billing): Promise<ChargeStatus>;
  handleWebhook(payload: unknown): Promise<WebhookResult>;
}

const STATUS_FROM_BILLING: Record<Billing["status"], ChargeStatus> = { aberta: "pendente", paga: "pago", vencida: "vencido", cancelada: "cancelado" };

/** Modo manual: nada sai do sistema; o estado é o da própria cobrança no INTEROS. */
export const manualBillingProvider: BillingProvider = {
  name: "manual",
  async createCharge(billing, client) {
    return {
      provider: "manual",
      status: "aguardando_emissao_manual",
      instructions: `Emita o boleto/PIX de ${client.tradeName} no banco ou ERP e registre o pagamento no INTEROS com o comprovante (cobrança ${billing.id}).`,
    };
  },
  async getChargeStatus(billing) {
    const current = await getById<Billing>(COLLECTIONS.billing, billing.id);
    return current ? STATUS_FROM_BILLING[current.status] : "desconhecido";
  },
  async handleWebhook() {
    return { handled: false, billingIds: [], message: "Nenhum provedor de cobrança conectado: webhooks não são processados." };
  },
};

/**
 * Provedor em uso. Nenhum adaptador real existe ainda, então `isConnected("cobranca")` é sempre false
 * (o catálogo marca a opção como não implementada) e o modo manual é devolvido.
 */
export function getBillingProvider(): BillingProvider {
  // Ponto de extensão: `if (isConnected("cobranca")) return asaasProvider;`
  return manualBillingProvider;
}

/** A rota de webhook só processa eventos quando há provedor conectado. */
export function billingProviderConnected(): boolean {
  return isConnected("cobranca");
}
