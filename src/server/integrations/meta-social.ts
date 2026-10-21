import "server-only";
/**
 * Instagram e Messenger (Meta), fase 5. A empresa conecta pela tela com o login da Meta (Facebook Login): o INTEROS
 * recebe as páginas que a pessoa administra, ela escolhe a página (e a conta do Instagram ligada) e o token da página
 * fica cifrado em channel_connections. Os avisos chegam em /api/webhooks/meta com a assinatura conferida pelo App Secret.
 *
 * Variáveis: META_APP_ID e META_APP_SECRET (o app da Meta; sem META_APP_SECRET vale o WHATSAPP_APP_SECRET, quando é o
 * mesmo app) e META_VERIFY_TOKEN (verificação do webhook; sem ele vale o WHATSAPP_VERIFY_TOKEN).
 */
import { createHmac, timingSafeEqual } from "node:crypto";
import { connectionToken, getConnection } from "./channel-connections";

const GRAPH = "https://graph.facebook.com/v21.0";
const DIALOG = "https://www.facebook.com/v21.0/dialog/oauth";
const TIMEOUT_MS = 10_000;
/** Permissões pedidas no login: páginas, mensagens do Messenger e do Instagram e assinatura dos avisos. */
export const META_SCOPES = ["pages_show_list", "pages_messaging", "pages_manage_metadata", "instagram_basic", "instagram_manage_messages", "business_management"];

const env = (name: string) => process.env[name]?.trim() || undefined;

export function metaAppSecret(): string | undefined {
  return env("META_APP_SECRET") ?? env("WHATSAPP_APP_SECRET");
}

export function metaVerifyToken(): string | undefined {
  return env("META_VERIFY_TOKEN") ?? env("WHATSAPP_VERIFY_TOKEN");
}

/** O app da Meta está configurado (dá para mostrar o botão de login). */
export function metaAppConfigured(): boolean {
  return Boolean(env("META_APP_ID") && metaAppSecret());
}

async function graph(path: string, init?: { method?: "GET" | "POST" | "DELETE"; body?: unknown; token?: string }): Promise<{ ok: true; data: Record<string, unknown> } | { ok: false; error: string; code?: number }> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);
  try {
    const url = new URL(`${GRAPH}${path}`);
    if (init?.token) url.searchParams.set("access_token", init.token);
    const res = await fetch(url, {
      method: init?.method ?? (init?.body ? "POST" : "GET"),
      headers: init?.body ? { "content-type": "application/json" } : undefined,
      body: init?.body ? JSON.stringify(init.body) : undefined,
      signal: controller.signal,
    });
    const json = (await res.json().catch(() => null)) as { error?: { message?: string; code?: number } } & Record<string, unknown> | null;
    if (!res.ok || json?.error) return { ok: false, error: json?.error?.message ?? `HTTP ${res.status}`, code: json?.error?.code };
    return { ok: true, data: json ?? {} };
  } catch (error) {
    console.error("[meta] falha na chamada à Graph API", path, error);
    return { ok: false, error: "Falha de rede ao chamar a Meta" };
  } finally {
    clearTimeout(timer);
  }
}

// ---------------------------------------------------------------------------
// Login da Meta (conectar a página)
// ---------------------------------------------------------------------------

export function metaLoginUrl(redirectUri: string, state: string): string {
  const u = new URL(DIALOG);
  u.searchParams.set("client_id", env("META_APP_ID") ?? "");
  u.searchParams.set("redirect_uri", redirectUri);
  u.searchParams.set("state", state);
  u.searchParams.set("response_type", "code");
  u.searchParams.set("scope", META_SCOPES.join(","));
  return u.toString();
}

/** Código do login → token de usuário de longa duração (as páginas obtidas com ele não expiram). */
export async function exchangeMetaCode(code: string, redirectUri: string): Promise<{ ok: true; token: string } | { ok: false; error: string }> {
  const id = env("META_APP_ID");
  const secret = metaAppSecret();
  if (!id || !secret) return { ok: false, error: "App da Meta não configurado (META_APP_ID e META_APP_SECRET)" };
  const short = await graph(`/oauth/access_token?client_id=${encodeURIComponent(id)}&redirect_uri=${encodeURIComponent(redirectUri)}&client_secret=${encodeURIComponent(secret)}&code=${encodeURIComponent(code)}`);
  if (!short.ok || typeof short.data.access_token !== "string") return { ok: false, error: short.ok ? "A Meta não devolveu o token" : short.error };
  const long = await graph(`/oauth/access_token?grant_type=fb_exchange_token&client_id=${encodeURIComponent(id)}&client_secret=${encodeURIComponent(secret)}&fb_exchange_token=${encodeURIComponent(short.data.access_token)}`);
  return { ok: true, token: long.ok && typeof long.data.access_token === "string" ? long.data.access_token : short.data.access_token };
}

export interface MetaPage {
  id: string;
  name: string;
  token: string;
  instagram?: { id: string; username?: string };
}

/** Páginas que a pessoa administra, com o token de cada uma e a conta do Instagram ligada. */
export async function listMetaPages(userToken: string): Promise<{ ok: true; pages: MetaPage[] } | { ok: false; error: string }> {
  const r = await graph(`/me/accounts?fields=id,name,access_token,instagram_business_account{id,username}&limit=50`, { token: userToken });
  if (!r.ok) return { ok: false, error: r.error };
  const data = (r.data.data ?? []) as { id: string; name: string; access_token: string; instagram_business_account?: { id: string; username?: string } }[];
  return { ok: true, pages: data.filter((p) => p.id && p.access_token).map((p) => ({ id: p.id, name: p.name, token: p.access_token, instagram: p.instagram_business_account ? { id: p.instagram_business_account.id, username: p.instagram_business_account.username } : undefined })) };
}

/** Assina os avisos de mensagens da página (Messenger; o Instagram ligado vem junto pelo app). */
export async function subscribeMetaPage(pageId: string, pageToken: string): Promise<{ ok: boolean; error?: string }> {
  const r = await graph(`/${encodeURIComponent(pageId)}/subscribed_apps?subscribed_fields=messages,messaging_postbacks`, { method: "POST", token: pageToken, body: {} });
  return r.ok ? { ok: true } : { ok: false, error: r.error };
}

export async function unsubscribeMetaPage(pageId: string, pageToken: string): Promise<void> {
  await graph(`/${encodeURIComponent(pageId)}/subscribed_apps`, { method: "DELETE", token: pageToken });
}

// ---------------------------------------------------------------------------
// Mensagens
// ---------------------------------------------------------------------------

export async function metaConnected(channel: "instagram" | "messenger"): Promise<boolean> {
  const c = await getConnection("meta");
  if (!c) return false;
  return channel === "messenger" ? Boolean(c.pageId) : Boolean(c.instagramId);
}

/**
 * Envia texto pela página. Dentro de 24 h da última mensagem do cliente: resposta normal; de 24 h a 7 dias: etiqueta
 * HUMAN_AGENT (exige a permissão «Human Agent» aprovada no app da Meta).
 */
export async function sendMetaMessage(channel: "instagram" | "messenger", recipientId: string, text: string, humanAgentTag: boolean): Promise<{ ok: true; externalId?: string } | { ok: false; error: string }> {
  const conn = await connectionToken("meta");
  if (!conn?.connection.pageId) return { ok: false, error: "Instagram/Messenger não conectado" };
  const body: Record<string, unknown> = { recipient: { id: recipientId }, message: { text: text.slice(0, 2000) }, messaging_type: humanAgentTag ? "MESSAGE_TAG" : "RESPONSE" };
  if (humanAgentTag) body.tag = "HUMAN_AGENT";
  const r = await graph(`/${encodeURIComponent(conn.connection.pageId)}/messages`, { token: conn.token, body });
  if (!r.ok) return { ok: false, error: metaSendError(r.code, r.error) };
  return { ok: true, externalId: typeof r.data.message_id === "string" ? r.data.message_id : undefined };
}

function metaSendError(code: number | undefined, message: string): string {
  if (code === 10 || code === 551) return "Recusado pela Meta: fora da janela de resposta (o cliente não escreveu nos últimos 7 dias) ou a pessoa não aceita mensagens.";
  if (code === 190) return "Token da página expirado ou revogado: conecte a página de novo em Canais e filas.";
  return `Falha informada pela Meta${code ? ` (${code})` : ""}: ${message}`;
}

/** Nome de quem escreveu (melhor esforço; sem permissão, fica sem nome). */
export async function metaProfileName(channel: "instagram" | "messenger", id: string): Promise<string | undefined> {
  const conn = await connectionToken("meta");
  if (!conn) return undefined;
  const r = await graph(`/${encodeURIComponent(id)}?fields=${channel === "instagram" ? "name,username" : "first_name,last_name"}`, { token: conn.token });
  if (!r.ok) return undefined;
  const d = r.data as { name?: string; username?: string; first_name?: string; last_name?: string };
  return (channel === "instagram" ? (d.name || (d.username ? `@${d.username}` : undefined)) : [d.first_name, d.last_name].filter(Boolean).join(" ")) || undefined;
}

// ---------------------------------------------------------------------------
// Avisos (webhook)
// ---------------------------------------------------------------------------

/** Assinatura X-Hub-Signature-256: HMAC-SHA256 do corpo bruto com o App Secret. */
export function metaSignatureValid(rawBody: string, header: string | null, appSecret: string | undefined = metaAppSecret()): boolean {
  if (!header || !appSecret) return false;
  const received = (header.startsWith("sha256=") ? header.slice(7) : header).toLowerCase();
  const expected = createHmac("sha256", appSecret).update(rawBody, "utf8").digest("hex");
  const a = Buffer.from(received);
  const b = Buffer.from(expected);
  return a.length === b.length && timingSafeEqual(a, b);
}

export interface MetaInboundMessage {
  channel: "instagram" | "messenger";
  from: string;
  body: string;
  externalId: string;
  at?: string;
}

/**
 * Mensagens do aviso: object "page" = Messenger, "instagram" = Instagram. Ignora ecos (o que a própria página
 * enviou), leituras e entregas. Anexo sem texto vira «[anexo]» para a conversa registrar que chegou algo.
 */
export function extractMetaMessages(payload: unknown): MetaInboundMessage[] {
  const p = payload as { object?: string; entry?: { messaging?: { sender?: { id?: string }; timestamp?: number; message?: { mid?: string; text?: string; is_echo?: boolean; attachments?: { type?: string }[] } }[] }[] } | null;
  if (!p || (p.object !== "page" && p.object !== "instagram")) return [];
  const channel = p.object === "instagram" ? "instagram" : "messenger";
  const out: MetaInboundMessage[] = [];
  for (const e of p.entry ?? []) {
    for (const m of e.messaging ?? []) {
      const msg = m.message;
      if (!msg?.mid || msg.is_echo || !m.sender?.id) continue;
      const body = msg.text?.trim() || (msg.attachments?.length ? `[${msg.attachments.map((a) => a.type ?? "anexo").join(", ")}]` : "");
      if (!body) continue;
      out.push({ channel, from: m.sender.id, body, externalId: msg.mid, at: m.timestamp ? new Date(m.timestamp).toISOString() : undefined });
    }
  }
  return out;
}
