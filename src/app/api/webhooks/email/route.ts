import { timingSafeEqual } from "node:crypto";
import { NextResponse, type NextRequest } from "next/server";
import { revalidatePath } from "next/cache";
import { receiveInboundMessage } from "@/server/conversations/inbound";
import { logChannelEvent } from "@/server/conversations/channel-events";
import { getResendReceivedEmail } from "@/server/integrations/providers";
import { svixSignatureValid } from "@/server/integrations/svix";
import { normalizeInboundEmail, parseAddress, type InboundEmail } from "@/domain/email-inbound";

/**
 * Webhook de e-mail RECEBIDO: o e-mail do cliente entra na Central de Atendimento como conversa de e-mail (o mesmo
 * caminho do WhatsApp: identificação, conversa, fila, chamado aberto e registro técnico).
 *
 * POST /api/webhooks/email — formatos aceitos:
 *   1. Resend (recebimento de e-mails): evento { type: "email.received", data: { email_id, … } }. O conteúdo é lido
 *      na API do Resend (RESEND_API_KEY). Assinatura Svix validada com RESEND_WEBHOOK_SECRET (whsec_…).
 *   2. Formato do INTEROS (integradores/encaminhadores): { from, subject, text, html?, messageId?, inReplyTo?, headers? }
 *      ou o «inbound» do Postmark ({ From, Subject, TextBody, … }). Autenticação: header x-interos-token com
 *      EMAIL_INBOUND_TOKEN.
 * Em produção, sem RESEND_WEBHOOK_SECRET nem EMAIL_INBOUND_TOKEN o webhook responde 503.
 * Ignorados (200, com registro técnico): respostas automáticas (férias, devoluções) e e-mails do próprio remetente do
 * INTEROS (EMAIL_FROM), que criariam laço.
 * Respostas: 200 { processed, result } · 400 JSON inválido · 401 assinatura/token inválido · 503 não configurado.
 */

function safeEqual(received: string, expected: string): boolean {
  const a = Buffer.from(received);
  const b = Buffer.from(expected);
  return a.length === b.length && timingSafeEqual(a, b);
}

type ResendEvent = { type?: string; data?: { email_id?: string; id?: string; from?: string; subject?: string } };

export async function POST(request: NextRequest) {
  const svixSecret = process.env.RESEND_WEBHOOK_SECRET;
  const token = process.env.EMAIL_INBOUND_TOKEN;
  const rawBody = await request.text();

  const svixSignature = request.headers.get("svix-signature");
  const receivedToken = request.headers.get("x-interos-token") ?? "";
  let authenticated = false;
  if (svixSecret && svixSignature) authenticated = svixSignatureValid({ secret: svixSecret, id: request.headers.get("svix-id"), timestamp: request.headers.get("svix-timestamp"), signature: svixSignature, body: rawBody });
  else if (token && receivedToken) authenticated = safeEqual(receivedToken, token);
  if (!svixSecret && !token) {
    if (process.env.NODE_ENV === "production") return NextResponse.json({ error: "Webhook de e-mail não configurado (RESEND_WEBHOOK_SECRET ou EMAIL_INBOUND_TOKEN ausente)" }, { status: 503 });
    authenticated = true;
  }
  if (!authenticated) {
    await logChannelEvent({ channel: "email", kind: "autenticacao", result: "recusado", detail: svixSignature ? "Assinatura do provedor de e-mail inválida: aviso recusado sem processar." : "Token inválido: aviso recusado sem processar." });
    return NextResponse.json({ error: svixSignature ? "Assinatura inválida" : "Token inválido" }, { status: 401 });
  }

  let payload: unknown;
  try {
    payload = JSON.parse(rawBody);
  } catch {
    return NextResponse.json({ error: "Corpo JSON inválido" }, { status: 400 });
  }

  // Resend: o aviso traz só os metadados; o texto vem da API. Outros eventos do Resend (entregue, aberto…) são ignorados.
  let email: InboundEmail | null;
  let externalId: string | undefined;
  const event = payload as ResendEvent;
  if (typeof event?.type === "string" && event.data && typeof event.data === "object") {
    if (event.type !== "email.received") return NextResponse.json({ processed: 0, ignored: event.type });
    const emailId = event.data.email_id ?? event.data.id;
    if (!emailId) return NextResponse.json({ error: "Aviso sem email_id" }, { status: 400 });
    const fetched = await getResendReceivedEmail(emailId);
    if (!fetched.ok) {
      await logChannelEvent({ channel: "email", kind: "mensagem_recebida", result: "falha", detail: `Não foi possível ler o e-mail no Resend: ${fetched.error}. O Resend vai reenviar o aviso.`, externalId: emailId, contact: event.data.from });
      // 5xx: o provedor reenvia depois (o texto ainda não entrou).
      return NextResponse.json({ error: "Falha ao ler o e-mail no provedor" }, { status: 502 });
    }
    email = normalizeInboundEmail(fetched.email);
    externalId = email?.messageId ?? emailId;
  } else {
    email = normalizeInboundEmail(payload);
    externalId = email?.messageId;
  }
  if (!email) return NextResponse.json({ error: "E-mail sem remetente válido" }, { status: 400 });

  const ownAddress = parseAddress(process.env.EMAIL_FROM)?.email;
  if (email.automatic || (ownAddress && email.from === ownAddress)) {
    await logChannelEvent({
      channel: "email",
      kind: "mensagem_recebida",
      result: "ignorado",
      detail: email.automatic ? `Resposta automática ignorada (${email.subject || "sem assunto"}).` : "E-mail enviado pelo próprio INTEROS: ignorado para não criar laço.",
      externalId,
      contact: email.from,
    });
    return NextResponse.json({ processed: 0, ignored: email.automatic ? "automatico" : "proprio" });
  }

  try {
    const result = await receiveInboundMessage({
      channel: "email",
      from: email.from,
      body: email.text.trim() || "(e-mail sem texto)",
      externalId,
      displayName: email.fromName,
      subject: email.subject || undefined,
      messageId: email.messageId,
    });
    try {
      revalidatePath("/comunicacao");
      revalidatePath("/marketing/caixa-de-entrada");
      revalidatePath("/suporte", "layout");
    } catch (error) {
      console.error("[webhook:email] falha ao revalidar", error);
    }
    return NextResponse.json({ processed: result.duplicate ? 0 : 1, result });
  } catch (error) {
    console.error("[webhook:email] falha ao processar", error);
    await logChannelEvent({ channel: "email", kind: "mensagem_recebida", result: "falha", detail: "Falha ao processar o e-mail (detalhes no log do servidor).", externalId, contact: email.from });
    return NextResponse.json({ error: "Falha ao processar" }, { status: 500 });
  }
}
