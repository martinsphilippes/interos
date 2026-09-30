import "server-only";
/**
 * Encaixe do webhook do provedor de cobrança (D21): o adaptador real devolve `payments[]` em `handleWebhook`
 * ({ externalId, eventId, status, paidAmount, paidAt }); aqui cada pagamento vira uma baixa pelo caminho único
 * `registerPayment(source: "provedor")`, com deduplicação em `payment_events` (`<provedor>_<eventId>`).
 * Com o provedor manual (`handled: false`, sem `payments`) nada acontece — testável sem simular pagamento.
 */
import { list } from "@/server/db";
import { dateKey } from "@/lib/format";
import { COLLECTIONS, type Billing } from "@/domain/types";
import type { WebhookResult } from "@/server/integrations/billing-provider";
import { PAYMENT_METHODS } from "./schemas";
import { registerPayment } from "./service";
import { SYSTEM_ACTOR } from "./billing";

export interface WebhookApplyResult {
  applied: string[];
  alreadyProcessed: string[];
  partial: string[];
  ignored: string[];
  errors: string[];
}

export async function applyWebhookPayments(result: WebhookResult, providerName: string): Promise<WebhookApplyResult> {
  const out: WebhookApplyResult = { applied: [], alreadyProcessed: [], partial: [], ignored: [], errors: [] };
  for (const p of result.payments ?? []) {
    if (p.status !== "pago") {
      out.ignored.push(`${p.externalId}: status ${p.status}`);
      continue;
    }
    const billing = (await list<Billing>(COLLECTIONS.billing, { where: [["externalId", "==", p.externalId]] }))[0];
    if (!billing) {
      out.ignored.push(`${p.externalId}: cobrança não encontrada`);
      continue;
    }
    try {
      const paidAt = p.paidAt ? dateKey(p.paidAt) : dateKey(new Date());
      const method = (PAYMENT_METHODS as readonly string[]).includes(billing.method ?? "") ? (billing.method as (typeof PAYMENT_METHODS)[number]) : "boleto";
      const r = await registerPayment(
        { billingId: billing.id, paidAt, amount: p.paidAmount ?? billing.amount, method, source: "provedor", externalPaymentId: p.externalPaymentId ?? p.eventId, providerEventId: p.eventId, provider: providerName },
        SYSTEM_ACTOR,
      );
      if (r.alreadyProcessed) out.alreadyProcessed.push(billing.id);
      else if (r.partial) out.partial.push(billing.id);
      else out.applied.push(billing.id);
    } catch (error) {
      out.errors.push(`${billing.id}: ${error instanceof Error ? error.message : String(error)}`);
    }
  }
  return out;
}
