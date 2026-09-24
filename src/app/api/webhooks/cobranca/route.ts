import { timingSafeEqual } from "node:crypto";
import { NextResponse, type NextRequest } from "next/server";
import { revalidatePath } from "next/cache";
import { billingProviderConnected, getBillingProvider } from "@/server/integrations/billing-provider";

/**
 * Webhook do provedor de cobrança (Asaas/Iugu) — preparado para quando houver adaptador real
 * (ver src/server/integrations/billing-provider.ts).
 *
 * POST /api/webhooks/cobranca
 * Header: x-interos-token: <BILLING_WEBHOOK_TOKEN> (ou Authorization: Bearer <token>)
 * Respostas: 401 sem token ou token inválido · 503 provedor de cobrança não configurado ·
 *            400 JSON inválido · 200 { handled, billingIds, message }.
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
    return NextResponse.json({ error: "Provedor de cobrança não configurado. Pagamentos são registrados manualmente no INTEROS." }, { status: 503 });
  }
  if (!tokenMatches(received, expected)) return NextResponse.json({ error: "Token inválido" }, { status: 401 });

  let payload: unknown;
  try {
    payload = await request.json();
  } catch {
    return NextResponse.json({ error: "Corpo JSON inválido" }, { status: 400 });
  }

  const result = await getBillingProvider().handleWebhook(payload);
  if (result.billingIds.length > 0) {
    try {
      revalidatePath("/financeiro", "layout");
    } catch (error) {
      console.error("[webhook:cobranca] falha ao revalidar", error);
    }
  }
  return NextResponse.json(result, { status: 200 });
}
