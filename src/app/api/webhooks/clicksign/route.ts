import { NextResponse, type NextRequest } from "next/server";
import { revalidatePath } from "next/cache";
import { clicksignSignatureValid, clicksignWebhookSecret, parseClicksignWebhook } from "@/server/integrations/clicksign";
import { processClicksignWebhook } from "@/server/finance/signature-webhook";

/**
 * Aviso da Clicksign (webhook cadastrado em Configurações › API da conta Clicksign).
 *
 * POST /api/webhooks/clicksign
 * Header Content-Hmac: sha256=<hex> = HMAC-SHA256 do corpo com o segredo do webhook (CLICKSIGN_WEBHOOK_SECRET).
 * Respostas: 503 sem o segredo configurado (nada é processado) · 401 assinatura ausente ou inválida ·
 *            400 corpo inválido · 200 { handled, contractId?, inboxId?, message } (inclusive aviso ignorado: a Clicksign
 *            só reenvia quando não recebe 200). Erro inesperado responde 500 e a Clicksign tenta de novo.
 */
export async function POST(request: NextRequest) {
  // Mesma leitura do «Testar conexão» (sem espaço/quebra de linha nas pontas, comum ao colar na Vercel).
  const secret = clicksignWebhookSecret();
  if (!secret) return NextResponse.json({ error: "Webhook da Clicksign não configurado (CLICKSIGN_WEBHOOK_SECRET)." }, { status: 503 });

  const raw = await request.text();
  if (!clicksignSignatureValid(raw, request.headers.get("content-hmac"), secret)) {
    return NextResponse.json({ error: "Assinatura do aviso inválida" }, { status: 401 });
  }

  let body: unknown;
  try {
    body = JSON.parse(raw);
  } catch {
    return NextResponse.json({ error: "Corpo JSON inválido" }, { status: 400 });
  }
  const hook = parseClicksignWebhook(body, request.headers.get("event"));
  if (!hook) return NextResponse.json({ error: "Aviso sem evento" }, { status: 400 });

  try {
    const outcome = await processClicksignWebhook(hook);
    if (outcome.handled !== "ignored") {
      try {
        revalidatePath("/financeiro", "layout");
      } catch (error) {
        console.error("[webhook:clicksign] falha ao revalidar", error);
      }
    }
    return NextResponse.json({ event: hook.event, ...outcome }, { status: 200 });
  } catch (error) {
    console.error("[webhook:clicksign] falha ao processar", hook.event, error);
    return NextResponse.json({ error: "Falha ao processar o aviso" }, { status: 500 });
  }
}
