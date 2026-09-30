import "server-only";
/**
 * Interface de cobrança externa (Asaas, Iugu, banco...). Hoje só existe a implementação "manual": as cobranças
 * são controladas no INTEROS (coleção `billing`), o boleto/PIX é emitido fora (banco/ERP) e REGISTRADO à mão
 * (`registerBoleto`: linha digitável, nosso número, PDF) e o pagamento é registrado com comprovante
 * (`registerPayment`, origem "manual"). Nada é simulado: sem provedor conectado, `isConnected("cobranca")` é false,
 * o catálogo mostra "Não conectado" e todos os pontos de chamada abaixo ficam inertes.
 *
 * CONTRATO DO ADAPTADOR REAL (a implementar quando o provedor for definido — ver docs/arquitetura.md):
 *   createCharge(billing, client)  → POST no provedor; devolve { externalId, status, paymentUrl, boleto?, pix? }.
 *                                    Chamado por `generateBillings` (e pela extensão do plano) SÓ quando conectado.
 *   getChargeStatus(billing)       → GET do status; usado pela varredura `conciliacao_bancaria`.
 *   getChargeDetail?(billing)      → opcional: status + valor/data do pagamento (conciliação precisa; sem ele a
 *                                    conciliação usa o valor da cobrança e a data de hoje).
 *   cancelCharge(billing)          → cancela no provedor; chamado por `cancelBilling`/`cancelContract` quando há
 *                                    externalId. Falha do provedor NÃO impede o cancelamento local (fica em nota).
 *   handleWebhook(payload)         → valida o evento (assinatura/token PRÓPRIOS do provedor, além do
 *                                    BILLING_WEBHOOK_TOKEN da rota) e devolve `payments[]`
 *                                    { externalId, eventId, status, paidAmount, paidAt }; a rota
 *                                    /api/webhooks/cobranca chama `applyWebhookPayments`, que dá baixa via
 *                                    `registerPayment(source: "provedor")` com deduplicação em `payment_events`.
 * Depois: marcar `implemented: true` no catálogo (./status.ts) e devolver o adaptador em `getBillingProvider()`.
 */
import { getById } from "@/server/db";
import { COLLECTIONS, type Billing, type BillingBoleto, type Client } from "@/domain/types";
import { isConnected } from "./status";

export type ChargeStatus = "aguardando_emissao_manual" | "pendente" | "pago" | "vencido" | "cancelado" | "desconhecido";

export interface ChargeResult {
  provider: string;
  /** Id da cobrança no provedor (vazio no modo manual). */
  externalId?: string;
  status: ChargeStatus;
  /** Link do boleto/PIX quando o provedor devolve. */
  paymentUrl?: string;
  /** Dados do boleto/PIX devolvidos pelo provedor (linha digitável, PDF, copia-e-cola). */
  boleto?: BillingBoleto;
  pix?: { copiaECola?: string; qrCodeUrl?: string };
  /** Orientação ao usuário no modo manual. */
  instructions?: string;
}

/** Detalhe do pagamento no provedor (conciliação). */
export interface ChargeDetail {
  status: ChargeStatus;
  paidAmount?: number;
  paidAt?: string;
  /** Id do pagamento no provedor (deduplicação); ausente = usa o externalId da cobrança. */
  externalPaymentId?: string;
}

/** Pagamento informado por um evento do provedor (webhook). */
export interface WebhookPayment {
  /** Id da cobrança no provedor (Billing.externalId). */
  externalId: string;
  /** Id único do evento no provedor (deduplicação em `payment_events`). */
  eventId: string;
  status: ChargeStatus;
  paidAmount?: number;
  paidAt?: string;
  /** Id do pagamento no provedor, quando diferente do evento. */
  externalPaymentId?: string;
}

export interface WebhookResult {
  handled: boolean;
  /** Cobranças do INTEROS afetadas. */
  billingIds: string[];
  message: string;
  /** Pagamentos a aplicar (a rota chama `applyWebhookPayments`). */
  payments?: WebhookPayment[];
}

export interface CancelChargeResult {
  ok: boolean;
  message?: string;
}

export interface BillingProvider {
  readonly name: string;
  createCharge(billing: Billing, client: Client): Promise<ChargeResult>;
  getChargeStatus(billing: Billing): Promise<ChargeStatus>;
  getChargeDetail?(billing: Billing): Promise<ChargeDetail>;
  cancelCharge(billing: Billing): Promise<CancelChargeResult>;
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
      instructions: `Emita o boleto/PIX de ${client.tradeName} no banco ou ERP, registre-o na cobrança ("Registrar boleto") e registre o pagamento no INTEROS com o comprovante (cobrança ${billing.id}).`,
    };
  },
  async getChargeStatus(billing) {
    const current = await getById<Billing>(COLLECTIONS.billing, billing.id);
    return current ? STATUS_FROM_BILLING[current.status] : "desconhecido";
  },
  async cancelCharge() {
    // Nada foi emitido por provedor: não há o que cancelar fora do INTEROS.
    return { ok: true, message: "Modo manual: nenhuma cobrança externa a cancelar." };
  },
  async handleWebhook() {
    return { handled: false, billingIds: [], message: "Nenhum provedor de cobrança conectado: webhooks não são processados.", payments: [] };
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

/** true somente quando há adaptador implementado E credenciais: só então o INTEROS fala com o provedor. */
export function billingProviderConnected(): boolean {
  return isConnected("cobranca");
}
