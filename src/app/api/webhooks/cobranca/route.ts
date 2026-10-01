import { timingSafeEqual } from "node:crypto";
import { NextResponse, type NextRequest } from "next/server";
import { revalidatePath } from "next/cache";
import { billingProviderConnected, getBillingProvider } from "@/server/integrations/billing-provider";
import { applyWebhookPayments } from "@/server/finance/webhook";

/**
 * Webhook do provedor de cobrança (Asaas/Iugu/banco) — preparado para quando houver adaptador real
 * (contrato em src/server/integrations/billing-provider.ts; encaixe da baixa em src/server/finance/webhook.ts).
 *
 * POST /api/webhooks/cobranca
 * Header: x-interos-token: <BILLING_WEBHOOK_TOKEN> (ou Authorization: Bearer <token>). O adaptador ainda valida a
 * assinatura/token PRÓPRIOS do provedor dentro de `handleWebhook`.
 * Respostas: 401 sem token ou token inválido · 503 provedor de cobrança não conectado (nada é processado) ·
 *            400 JSON inválido · 200 { handled, billingIds, message, payments: { applied, alreadyProcessed, ... } }.
 * Cada pagamento devolvido pelo adaptador vira `registerPayment(source: "provedor")` com deduplicação em
 * `payment_events` — reenvio do mesmo evento = "já processado".
 */

function tokenMatches(received: string, expected: string): boolean {
  const a = Buffer.from(received);
  const b = Buffer.from(expected);
  return a.length === b.length && timingSafeEqual(a, b);
}

function receivedToken(request: NextRequest): string {
  const header = request.headers.get("x-interos-token");
  if (header) return header;
  const auth = request.headers.get("authorization") ?? "";
  return auth.toLowerCase().startsWith("bearer ") ? auth.slice(7).trim() : "";
}

export async function POST(request: NextRequest) {
  const received = receivedToken(request);
  if (!received) return NextResponse.json({ error: "Token ausente" }, { status: 401 });

  const expected = process.env.BILLING_WEBHOOK_TOKEN;
  if (!expected || !billingProviderConnected()) {
    return NextResponse.json({ error: "Provedor de cobrança não conectado. Pagamentos são registrados manualmente no INTEROS." }, { status: 503 });
  }
  if (!tokenMatches(received, expected)) return NextResponse.json({ error: "Token inválido" }, { status: 401 });

  let payload: unknown;
  try {
    payload = await request.json();
  } catch {
    return NextResponse.json({ error: "Corpo JSON inválido" }, { status: 400 });
  }

  const provider = getBillingProvider();
  const result = await provider.handleWebhook(payload);
  const payments = await applyWebhookPayments(result, provider.name);
  const billingIds = Array.from(new Set([...result.billingIds, ...payments.applied, ...payments.partial]));
  if (billingIds.length > 0) {
    try {
      revalidatePath("/financeiro", "layout");
    } catch (error) {
      console.error("[webhook:cobranca] falha ao revalidar", error);
    }
  }
  return NextResponse.json({ ...result, billingIds, payments }, { status: 200 });
}
