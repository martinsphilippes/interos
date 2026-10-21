import { createHmac, timingSafeEqual } from "node:crypto";
import { NextResponse, type NextRequest } from "next/server";
import { revalidatePath } from "next/cache";
import { receiveInboundMessage } from "@/server/conversations/inbound";
import { logChannelEvent } from "@/server/conversations/channel-events";
import { applyWhatsappStatuses, type WhatsappStatusUpdate } from "@/server/integrations/communications";

/**
 * Webhook de entrada do WhatsApp (ver src/server/support/channels.ts e src/server/integrations/communications.ts).
 *
 * GET  /api/webhooks/whatsapp?hub.mode=subscribe&hub.verify_token=...&hub.challenge=...  → handshake da Meta
 *      (compara com WHATSAPP_VERIFY_TOKEN).
 * POST /api/webhooks/whatsapp
 *      - Formato Meta Cloud API: { entry: [{ changes: [{ value: { messages: [...], statuses: [...] } }] }] }
 *      - Formato simplificado (testes/integradores): { from, body, id? }
 *      Autenticação (uma das duas):
 *        1. `X-Hub-Signature-256: sha256=<HMAC-SHA256 do corpo bruto com WHATSAPP_APP_SECRET>` — a assinatura
 *           que a Meta envia em toda chamada. Validada sempre que WHATSAPP_APP_SECRET existir.
 *        2. Header `x-interos-token: <WHATSAPP_WEBHOOK_TOKEN>` (integradores próprios/testes).
 *      Em produção, sem nenhuma das variáveis o webhook responde 503.
 *      Mensagens: entram na Central de Atendimento (src/server/conversations/inbound.ts) — conversa do contato, fila e
 *      responsável; com chamado aberto do cliente, também no chamado. Aviso repetido (mesmo id da Meta) é ignorado.
 *      Statuses (sent/delivered/read/failed): atualizam `communications.status` pela id da mensagem (externalId).
 * Respostas: 200 { processed, results, statuses } · 400 JSON inválido · 401 assinatura/token inválido · 503 não configurado.
 */

function safeEqual(received: string, expected: string): boolean {
  const a = Buffer.from(received);
  const b = Buffer.from(expected);
  return a.length === b.length && timingSafeEqual(a, b);
}

/** Valida a assinatura da Meta (HMAC-SHA256 do corpo bruto com o App Secret). */
function metaSignatureValid(rawBody: string, header: string | null, appSecret: string): boolean {
  if (!header) return false;
  const received = header.startsWith("sha256=") ? header.slice(7) : header;
  const expected = createHmac("sha256", appSecret).update(rawBody, "utf8").digest("hex");
  return safeEqual(received.toLowerCase(), expected);
}

export async function GET(request: NextRequest) {
  const url = request.nextUrl;
  const expected = process.env.WHATSAPP_VERIFY_TOKEN;
  if (url.searchParams.get("hub.mode") === "subscribe" && expected && safeEqual(url.searchParams.get("hub.verify_token") ?? "", expected)) {
    return new NextResponse(url.searchParams.get("hub.challenge") ?? "", { status: 200 });
  }
  return NextResponse.json({ error: "Verificação inválida" }, { status: 403 });
}

interface IncomingItem {
  from: string;
  body: string;
  externalId?: string;
  displayName?: string;
  at?: string;
}

type MetaPayload = {
  from?: unknown;
  body?: unknown;
  id?: unknown;
  entry?: { changes?: { value?: { contacts?: { wa_id?: string; profile?: { name?: string } }[]; messages?: { from?: string; id?: string; timestamp?: string; type?: string; text?: { body?: string } }[]; statuses?: { id?: string; status?: string; timestamp?: string; errors?: { code?: number; title?: string; message?: string }[] }[] } }[] }[];
};

const MEDIA_LABEL: Record<string, string> = { image: "Imagem", audio: "Áudio", video: "Vídeo", document: "Documento", sticker: "Figurinha", location: "Localização", contacts: "Contato" };

function extractMessages(payload: unknown): IncomingItem[] {
  const out: IncomingItem[] = [];
  const p = payload as MetaPayload;
  if (typeof p?.from === "string" && typeof p?.body === "string") out.push({ from: p.from, body: p.body, externalId: typeof p.id === "string" ? p.id : undefined });
  for (const entry of p?.entry ?? []) {
    for (const change of entry.changes ?? []) {
      const names = new Map((change.value?.contacts ?? []).map((c) => [c.wa_id ?? "", c.profile?.name]));
      for (const m of change.value?.messages ?? []) {
        if (!m.from) continue;
        const at = m.timestamp && /^\d+$/.test(m.timestamp) ? new Date(Number(m.timestamp) * 1000).toISOString() : undefined;
        // Só texto nesta fase: mídia (foto, áudio, documento) entra como aviso para o operador pedir por outro meio.
        const body = m.text?.body ?? (m.type ? `[${MEDIA_LABEL[m.type] ?? "Conteúdo"} recebido — ainda não exibido na Central]` : "");
        if (body) out.push({ from: m.from, body, externalId: m.id, displayName: names.get(m.from) || undefined, at });
      }
    }
  }
  return out;
}

function extractStatuses(payload: unknown): WhatsappStatusUpdate[] {
  const out: WhatsappStatusUpdate[] = [];
  const p = payload as MetaPayload;
  for (const entry of p?.entry ?? []) {
    for (const change of entry.changes ?? []) {
      for (const s of change.value?.statuses ?? []) {
        if (s.id && s.status) out.push({ id: s.id, status: s.status, timestamp: s.timestamp, errors: s.errors });
      }
    }
  }
  return out;
}

/** Erros mais comuns da Meta em português (o registro técnico mostra isso ao administrador). */
function whatsappErrorText(code: number | undefined, title: string | undefined): string {
  switch (code) {
    case 131047:
      return "Recusado: fora da janela de 24 h (o cliente não escreveu nas últimas 24 h; só modelo aprovado).";
    case 131026:
      return "Recusado: o número não recebe mensagens (sem WhatsApp ou bloqueou).";
    case 131049:
      return "Recusado pela Meta para preservar a qualidade (muitas mensagens de marketing para este número).";
    case 131056:
      return "Recusado: muitas mensagens para o mesmo número em pouco tempo.";
    case 132001:
      return "Recusado: modelo inexistente ou não aprovado.";
    default:
      return `Falha informada pela Meta${code ? ` (${code})` : ""}${title ? `: ${title}` : ""}.`;
  }
}

export async function POST(request: NextRequest) {
  const appSecret = process.env.WHATSAPP_APP_SECRET;
  const token = process.env.WHATSAPP_WEBHOOK_TOKEN;
  const rawBody = await request.text();

  // Autenticação: assinatura da Meta (quando há App Secret) ou token próprio; em produção, um dos dois é obrigatório.
  const signature = request.headers.get("x-hub-signature-256");
  const receivedToken = request.headers.get("x-interos-token") ?? "";
  let authenticated = false;
  if (appSecret && signature) authenticated = metaSignatureValid(rawBody, signature, appSecret);
  else if (token && receivedToken) authenticated = safeEqual(receivedToken, token);
  if (!appSecret && !token) {
    if (process.env.NODE_ENV === "production") return NextResponse.json({ error: "Webhook de WhatsApp não configurado (WHATSAPP_APP_SECRET ou WHATSAPP_WEBHOOK_TOKEN ausente)" }, { status: 503 });
    authenticated = true;
  }
  if (!authenticated) {
    await logChannelEvent({ channel: "whatsapp", kind: "autenticacao", result: "recusado", detail: signature ? "Assinatura da Meta inválida: aviso recusado sem processar." : "Token inválido: aviso recusado sem processar." });
    return NextResponse.json({ error: signature ? "Assinatura inválida" : "Token inválido" }, { status: 401 });
  }

  let payload: unknown;
  try {
    payload = JSON.parse(rawBody);
  } catch {
    return NextResponse.json({ error: "Corpo JSON inválido" }, { status: 400 });
  }
  const messages = extractMessages(payload);
  const results = [];
  for (const m of messages) {
    try {
      results.push(await receiveInboundMessage({ channel: "whatsapp", from: m.from, body: m.body, externalId: m.externalId, displayName: m.displayName, at: m.at }));
    } catch (error) {
      console.error("[webhook:whatsapp] falha ao processar mensagem", error);
      await logChannelEvent({ channel: "whatsapp", kind: "mensagem_recebida", result: "falha", detail: "Falha ao processar a mensagem (detalhes no log do servidor).", externalId: m.externalId, contact: m.from });
      results.push({ error: "falha ao processar" });
    }
  }
  let statuses: Awaited<ReturnType<typeof applyWhatsappStatuses>> = { matched: 0, updated: 0, ignored: 0 };
  const updates = extractStatuses(payload);
  if (updates.length > 0) {
    try {
      statuses = await applyWhatsappStatuses(updates);
      for (const u of updates.filter((x) => x.status === "failed")) {
        const e = u.errors?.[0];
        await logChannelEvent({ channel: "whatsapp", kind: "envio", result: "falha", detail: whatsappErrorText(e?.code, e?.title ?? e?.message), externalId: u.id, providerCode: e?.code !== undefined ? String(e.code) : undefined });
      }
    } catch (error) {
      console.error("[webhook:whatsapp] falha ao aplicar statuses", error);
    }
  }
  try {
    revalidatePath("/suporte", "layout");
    revalidatePath("/marketing/caixa-de-entrada");
    revalidatePath("/comunicacao");
    if (updates.length > 0) revalidatePath("/financeiro", "layout");
  } catch (error) {
    console.error("[webhook:whatsapp] falha ao revalidar", error);
  }
  // A Meta reenvia em caso de erro HTTP: responde 200 mesmo quando uma mensagem individual falha.
  return NextResponse.json({ processed: messages.length, results, statuses: { received: updates.length, ...statuses } }, { status: 200 });
}
