import { NextResponse, type NextRequest } from "next/server";
import { revalidatePath } from "next/cache";
import { timingSafeEqual } from "node:crypto";
import { receiveInboundMessage } from "@/server/conversations/inbound";
import { logChannelEvent } from "@/server/conversations/channel-events";
import { extractMetaMessages, metaAppSecret, metaProfileName, metaSignatureValid, metaVerifyToken } from "@/server/integrations/meta-social";

/**
 * Webhook do Instagram e do Messenger (Meta). GET: verificação (hub.verify_token = META_VERIFY_TOKEN). POST: assinatura
 * X-Hub-Signature-256 conferida com o App Secret (em produção, sem ele, 503); cada mensagem entra na Central como as
 * do WhatsApp (aviso repetido é ignorado). Responde 200 mesmo se uma mensagem falhar (a Meta reenviaria tudo).
 */
export async function GET(request: NextRequest) {
  const sp = request.nextUrl.searchParams;
  const expected = metaVerifyToken();
  const received = sp.get("hub.verify_token") ?? "";
  const ok = Boolean(expected) && received.length === expected!.length && timingSafeEqual(Buffer.from(received), Buffer.from(expected!));
  if (sp.get("hub.mode") === "subscribe" && ok) return new NextResponse(sp.get("hub.challenge") ?? "", { status: 200 });
  return NextResponse.json({ error: "Verificação inválida" }, { status: 403 });
}

export async function POST(request: NextRequest) {
  const raw = await request.text();
  const secret = metaAppSecret();
  if (!secret) {
    if (process.env.NODE_ENV === "production") return NextResponse.json({ error: "Webhook da Meta não configurado (META_APP_SECRET ausente)" }, { status: 503 });
  } else if (!metaSignatureValid(raw, request.headers.get("x-hub-signature-256"), secret)) {
    await logChannelEvent({ channel: "messenger", kind: "autenticacao", result: "recusado", detail: "Assinatura da Meta inválida: aviso do Instagram/Messenger recusado sem processar." });
    return NextResponse.json({ error: "Assinatura inválida" }, { status: 401 });
  }
  let payload: unknown;
  try {
    payload = JSON.parse(raw);
  } catch {
    return NextResponse.json({ error: "Corpo JSON inválido" }, { status: 400 });
  }
  const messages = extractMetaMessages(payload);
  let processed = 0;
  for (const m of messages) {
    try {
      const displayName = await metaProfileName(m.channel, m.from);
      await receiveInboundMessage({ channel: m.channel, from: m.from, body: m.body, externalId: m.externalId, displayName, at: m.at });
      processed += 1;
    } catch (error) {
      console.error("[webhook:meta] falha ao processar mensagem", error);
      await logChannelEvent({ channel: m.channel, kind: "mensagem_recebida", result: "falha", detail: "Falha ao processar a mensagem (detalhes no log do servidor).", externalId: m.externalId, contact: m.from });
    }
  }
  if (processed) {
    try {
      revalidatePath("/comunicacao");
    } catch {
      // revalidação é melhor esforço
    }
  }
  return NextResponse.json({ processed, received: messages.length }, { status: 200 });
}
