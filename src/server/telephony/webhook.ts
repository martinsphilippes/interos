import "server-only";
/**
 * Avisos da Twilio (/api/voice/*): lê o formulário, confere a assinatura (X-Twilio-Signature com TWILIO_AUTH_TOKEN) e
 * responde TwiML. Em produção, sem TWILIO_AUTH_TOKEN, responde 503; fora de produção aceita sem assinatura (testes).
 */
import type { NextRequest } from "next/server";
import { twilioSignatureValid } from "@/server/integrations/twilio";
import { logChannelEvent } from "@/server/conversations/channel-events";

/** URL pública exatamente como a Twilio chamou (atrás do proxy da Vercel). */
export function publicUrl(request: NextRequest): string {
  const proto = request.headers.get("x-forwarded-proto") ?? request.nextUrl.protocol.replace(":", "");
  const host = request.headers.get("x-forwarded-host") ?? request.headers.get("host") ?? request.nextUrl.host;
  return `${proto}://${host}${request.nextUrl.pathname}${request.nextUrl.search}`;
}

export function publicBase(request: NextRequest): string {
  const url = new URL(publicUrl(request));
  return `${url.protocol}//${url.host}`;
}

export type VoiceRequest = { ok: true; params: Record<string, string>; base: string } | { ok: false; response: Response };

export async function readVoiceRequest(request: NextRequest): Promise<VoiceRequest> {
  const form = await request.formData().catch(() => null);
  const params: Record<string, string> = {};
  form?.forEach((v, k) => {
    if (typeof v === "string") params[k] = v;
  });
  const token = process.env.TWILIO_AUTH_TOKEN?.trim();
  if (!token) {
    if (process.env.NODE_ENV === "production") return { ok: false, response: new Response("Telefonia não configurada (TWILIO_AUTH_TOKEN ausente)", { status: 503 }) };
    return { ok: true, params, base: publicBase(request) };
  }
  if (!twilioSignatureValid(publicUrl(request), params, request.headers.get("x-twilio-signature"), token)) {
    await logChannelEvent({ channel: "voz", kind: "autenticacao", result: "recusado", detail: "Telefonia: assinatura da Twilio inválida, aviso recusado sem processar." }).catch(() => undefined);
    return { ok: false, response: new Response("Assinatura inválida", { status: 401 }) };
  }
  return { ok: true, params, base: publicBase(request) };
}

export function twiml(xml: string): Response {
  return new Response(xml, { status: 200, headers: { "content-type": "text/xml; charset=utf-8" } });
}
