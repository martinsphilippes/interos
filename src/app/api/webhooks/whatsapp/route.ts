import { timingSafeEqual } from "node:crypto";
import { NextResponse, type NextRequest } from "next/server";
import { revalidatePath } from "next/cache";
import { receiveWhatsappMessage } from "@/server/support/service";

/**
 * Webhook de entrada do WhatsApp (ver src/server/support/channels.ts).
 *
 * GET  /api/webhooks/whatsapp?hub.mode=subscribe&hub.verify_token=...&hub.challenge=...  → handshake da Meta
 *      (compara com WHATSAPP_VERIFY_TOKEN).
 * POST /api/webhooks/whatsapp
 *      - Formato Meta Cloud API: { entry: [{ changes: [{ value: { messages: [{ from, id, text: { body } }] } }] }] }
 *      - Formato simplificado (testes/integradores): { from, body, id? }
 *      Header x-interos-token: <WHATSAPP_WEBHOOK_TOKEN> quando configurado (obrigatório em produção).
 *      Para cada mensagem: telefone de contato/cliente com chamado aberto → interação do chamado;
 *      senão → comunicação de entrada na Caixa de Entrada do Marketing.
 * Respostas: 200 { processed, results } · 400 JSON inválido · 401 token inválido · 503 sem token em produção.
 */

function tokenMatches(received: string, expected: string): boolean {
  const a = Buffer.from(received);
  const b = Buffer.from(expected);
  return a.length === b.length && timingSafeEqual(a, b);
}

export async function GET(request: NextRequest) {
  const url = request.nextUrl;
  const expected = process.env.WHATSAPP_VERIFY_TOKEN;
  if (url.searchParams.get("hub.mode") === "subscribe" && expected && tokenMatches(url.searchParams.get("hub.verify_token") ?? "", expected)) {
    return new NextResponse(url.searchParams.get("hub.challenge") ?? "", { status: 200 });
  }
  return NextResponse.json({ error: "Verificação inválida" }, { status: 403 });
}

interface IncomingItem {
  from: string;
  body: string;
  externalId?: string;
}

function extractMessages(payload: unknown): IncomingItem[] {
  const out: IncomingItem[] = [];
  const p = payload as { from?: unknown; body?: unknown; id?: unknown; entry?: { changes?: { value?: { messages?: { from?: string; id?: string; text?: { body?: string } }[] } }[] }[] };
  if (typeof p?.from === "string" && typeof p?.body === "string") out.push({ from: p.from, body: p.body, externalId: typeof p.id === "string" ? p.id : undefined });
  for (const entry of p?.entry ?? []) {
    for (const change of entry.changes ?? []) {
      for (const m of change.value?.messages ?? []) {
        if (m.from && m.text?.body) out.push({ from: m.from, body: m.text.body, externalId: m.id });
      }
    }
  }
  return out;
}

export async function POST(request: NextRequest) {
  const expected = process.env.WHATSAPP_WEBHOOK_TOKEN;
  if (!expected) {
    if (process.env.NODE_ENV === "production") return NextResponse.json({ error: "Webhook de WhatsApp não configurado (WHATSAPP_WEBHOOK_TOKEN ausente)" }, { status: 503 });
  } else if (!tokenMatches(request.headers.get("x-interos-token") ?? "", expected)) {
    return NextResponse.json({ error: "Token inválido" }, { status: 401 });
  }

  let payload: unknown;
  try {
    payload = await request.json();
  } catch {
    return NextResponse.json({ error: "Corpo JSON inválido" }, { status: 400 });
  }
  const messages = extractMessages(payload);
  const results = [];
  for (const m of messages) {
    try {
      results.push(await receiveWhatsappMessage(m));
    } catch (error) {
      console.error("[webhook:whatsapp] falha ao processar mensagem", error);
      results.push({ error: "falha ao processar" });
    }
  }
  try {
    revalidatePath("/suporte", "layout");
    revalidatePath("/marketing/caixa-de-entrada");
  } catch (error) {
    console.error("[webhook:whatsapp] falha ao revalidar", error);
  }
  // A Meta reenvia em caso de erro HTTP: responde 200 mesmo quando uma mensagem individual falha.
  return NextResponse.json({ processed: messages.length, results }, { status: 200 });
}
