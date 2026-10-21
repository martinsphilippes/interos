import "server-only";
/**
 * Telegram (fase 5): a empresa cola o token do bot (do @BotFather) em Canais e filas › Telegram. O INTEROS confere o
 * token, registra o webhook com um segredo próprio (o Telegram devolve esse segredo em todo aviso, no cabeçalho
 * X-Telegram-Bot-Api-Secret-Token) e guarda token e segredo cifrados. Nada em variável de ambiente.
 */
import { randomBytes, timingSafeEqual } from "node:crypto";
import { connectionSecret, connectionToken, getConnection } from "./channel-connections";

const API = "https://api.telegram.org";
const TIMEOUT_MS = 10_000;

/** Formato do token do BotFather: <id numérico>:<35+ caracteres>. */
export function looksLikeBotToken(token: string): boolean {
  return /^\d{5,15}:[A-Za-z0-9_-]{30,64}$/.test(token.trim());
}

async function call(token: string, method: string, body?: Record<string, unknown>): Promise<{ ok: true; result: unknown } | { ok: false; error: string; code?: number }> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);
  try {
    const res = await fetch(`${API}/bot${token}/${method}`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(body ?? {}),
      signal: controller.signal,
    });
    const json = (await res.json().catch(() => null)) as { ok?: boolean; result?: unknown; description?: string; error_code?: number } | null;
    if (!json?.ok) return { ok: false, error: json?.description ?? `HTTP ${res.status}`, code: json?.error_code };
    return { ok: true, result: json.result };
  } catch (error) {
    console.error(`[telegram] falha em ${method}`, error instanceof Error ? error.message : "erro");
    return { ok: false, error: "Falha de rede ao chamar o Telegram" };
  } finally {
    clearTimeout(timer);
  }
}

/** Confere o token e registra o webhook com segredo. Devolve o bot e o segredo para guardar. */
export async function setupTelegramBot(token: string, webhookUrl: string): Promise<{ ok: true; botId: string; botUsername: string; secret: string } | { ok: false; error: string }> {
  if (!looksLikeBotToken(token)) return { ok: false, error: "Token inválido: copie o token inteiro que o @BotFather mostrou (números:letras)." };
  const me = await call(token, "getMe");
  if (!me.ok) return { ok: false, error: me.code === 401 ? "O Telegram recusou o token (revogado ou digitado errado)." : me.error };
  const bot = me.result as { id: number; username?: string; is_bot?: boolean };
  if (!bot?.is_bot) return { ok: false, error: "Esse token não é de um bot." };
  const secret = randomBytes(32).toString("base64url");
  const hook = await call(token, "setWebhook", { url: webhookUrl, secret_token: secret, allowed_updates: ["message", "edited_message"], drop_pending_updates: true });
  if (!hook.ok) return { ok: false, error: `O Telegram não aceitou o endereço do webhook: ${hook.error}` };
  return { ok: true, botId: String(bot.id), botUsername: bot.username ?? "", secret };
}

export async function removeTelegramWebhook(token: string): Promise<void> {
  await call(token, "deleteWebhook", { drop_pending_updates: false });
}

export async function telegramConnected(): Promise<boolean> {
  return Boolean(await getConnection("telegram"));
}

export async function sendTelegramMessage(chatId: string, text: string): Promise<{ ok: true; externalId?: string } | { ok: false; error: string }> {
  const conn = await connectionToken("telegram");
  if (!conn) return { ok: false, error: "Telegram não conectado" };
  const r = await call(conn.token, "sendMessage", { chat_id: chatId, text: text.slice(0, 4096) });
  if (!r.ok) return { ok: false, error: r.code === 403 ? "A pessoa bloqueou o bot ou nunca iniciou a conversa." : `Falha informada pelo Telegram: ${r.error}` };
  const m = r.result as { message_id?: number };
  return { ok: true, externalId: m?.message_id ? `${chatId}:${m.message_id}` : undefined };
}

/** Confere o segredo do aviso (cabeçalho X-Telegram-Bot-Api-Secret-Token) contra o guardado. */
export async function telegramSecretValid(received: string | null): Promise<boolean> {
  if (!received) return false;
  const expected = connectionSecret(await getConnection("telegram"));
  if (!expected) return false;
  const a = Buffer.from(received);
  const b = Buffer.from(expected);
  return a.length === b.length && timingSafeEqual(a, b);
}

export interface TelegramInboundMessage {
  chatId: string;
  body: string;
  externalId: string;
  displayName?: string;
  at?: string;
}

/** Mensagem do aviso (só conversas privadas com o bot; grupos são ignorados). */
export function extractTelegramMessage(update: unknown): TelegramInboundMessage | null {
  const u = update as { message?: TgMessage; edited_message?: TgMessage } | null;
  const m = u?.message ?? u?.edited_message;
  if (!m?.chat || m.chat.type !== "private" || !m.message_id) return null;
  const body = m.text?.trim() || m.caption?.trim() || (m.photo ? "[foto]" : m.document ? "[arquivo]" : m.voice ? "[áudio]" : m.sticker ? "[figurinha]" : "");
  if (!body) return null;
  const name = [m.from?.first_name, m.from?.last_name].filter(Boolean).join(" ") || (m.from?.username ? `@${m.from.username}` : undefined);
  return { chatId: String(m.chat.id), body, externalId: `${m.chat.id}:${m.message_id}${u?.edited_message ? ":edit" : ""}`, displayName: name, at: m.date ? new Date(m.date * 1000).toISOString() : undefined };
}

interface TgMessage {
  message_id?: number;
  date?: number;
  text?: string;
  caption?: string;
  photo?: unknown;
  document?: unknown;
  voice?: unknown;
  sticker?: unknown;
  chat?: { id: number; type?: string };
  from?: { first_name?: string; last_name?: string; username?: string };
}
