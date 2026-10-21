import "server-only";
/**
 * Chat do site (fase 5): o visitante conversa por uma janela no site da empresa; a conversa entra na Central como
 * qualquer outra (canal «chat»), e as respostas da equipe aparecem na janela (ela pergunta a cada poucos segundos).
 *
 * Segurança: o visitante só tem um token assinado (HMAC) com o próprio id; ele só lê as mensagens das conversas dele
 * e NUNCA as notas internas nem os sussurros (só mensagens do canal «chat»). Limites por IP (novas conversas) e por
 * visitante (mensagens por minuto). O IP não é gravado, só um hash.
 */
import { createHmac, hkdfSync, randomBytes, timingSafeEqual } from "node:crypto";
import { create, getById, list, update } from "@/server/db";
import { BusinessError } from "@/server/auth/error-classes";
import { emitEvent } from "@/server/events";
import { COLLECTIONS, type ChatVisitor, type Communication, type Conversation, type Settings, type User, type UserRef } from "@/domain/types";
import { DEFAULT_SITE_CHAT, SITE_CHAT_LIMITS, isHexColor, normalizeDomain, type SiteChatConfig } from "@/domain/site-chat";
import { contactKeyOf, emailIdentity } from "@/domain/phone";
import { toE164 } from "@/domain/telephony";
import { isOpenConversation } from "@/domain/conversations";
import { receiveInboundMessage } from "./inbound";
import { businessStatus } from "./auto-messages";

export const SITE_CHAT_SETTING = "chat_site";
const TOKEN_TTL_MS = 30 * 86_400_000;
const HOUR = 3_600_000;

// ---------------------------------------------------------------------------
// Configuração
// ---------------------------------------------------------------------------

export async function getSiteChat(): Promise<SiteChatConfig & { stored: boolean }> {
  const doc = (await list<Settings>(COLLECTIONS.settings, { where: [["key", "==", SITE_CHAT_SETTING]] }))[0];
  return { ...DEFAULT_SITE_CHAT, ...((doc?.value ?? {}) as Partial<SiteChatConfig>), stored: Boolean(doc) };
}

export async function saveSiteChat(input: Omit<SiteChatConfig, "publicKey">, actor: UserRef): Promise<SiteChatConfig> {
  if (!isHexColor(input.color)) throw new BusinessError("Cor inválida (use o formato #rrggbb)");
  const domains = Array.from(new Set(input.allowedDomains.map(normalizeDomain)));
  if (domains.some((d) => !d)) throw new BusinessError("Site inválido na lista de sites permitidos (ex.: intercert.com.br)");
  const current = await getSiteChat();
  const value: SiteChatConfig = { ...input, allowedDomains: domains, color: input.color.toLowerCase(), publicKey: current.publicKey || randomBytes(12).toString("base64url") };
  const doc = (await list<Settings>(COLLECTIONS.settings, { where: [["key", "==", SITE_CHAT_SETTING]] }))[0];
  if (doc) await update<Settings>(COLLECTIONS.settings, doc.id, { value: value as unknown as Record<string, unknown> });
  else await create<Settings>(COLLECTIONS.settings, { key: SITE_CHAT_SETTING, value: value as unknown as Record<string, unknown>, description: "Chat do site da Central de Atendimento." });
  await emitEvent({ type: "settings.updated", actor, entity: { type: "setting", id: SITE_CHAT_SETTING }, title: `${actor.name} alterou o chat do site`, payload: { key: SITE_CHAT_SETTING, enabled: value.enabled, domains }, timeline: false });
  return value;
}

/** Configuração ativa para a chave pública (null: chave errada ou chat desligado). */
export async function activeSiteChat(key: string | null | undefined): Promise<SiteChatConfig | null> {
  if (!key) return null;
  const c = await getSiteChat();
  if (!c.enabled || !c.publicKey) return null;
  const a = Buffer.from(key);
  const b = Buffer.from(c.publicKey);
  return a.length === b.length && timingSafeEqual(a, b) ? c : null;
}

// ---------------------------------------------------------------------------
// Token do visitante
// ---------------------------------------------------------------------------

function secret(): Buffer {
  const base = process.env.SESSION_COOKIE_SECRET?.trim();
  if (!base && process.env.NODE_ENV === "production") throw new Error("SESSION_COOKIE_SECRET não configurado");
  return Buffer.from(hkdfSync("sha256", base ?? "dev-only-chat", "interos", "site-chat", 32));
}

function mac(data: string): string {
  return createHmac("sha256", secret()).update(data).digest("base64url");
}

export function signVisitor(visitorId: string, now: number = Date.now()): string {
  const payload = `${visitorId}.${now.toString(36)}`;
  return `${payload}.${mac(payload)}`;
}

/** Id do visitante do token (null: adulterado ou vencido). */
export function verifyVisitor(token: string | null | undefined, now: number = Date.now()): string | null {
  const parts = (token ?? "").split(".");
  if (parts.length !== 3) return null;
  const [id, issued, sig] = parts;
  const expected = mac(`${id}.${issued}`);
  const a = Buffer.from(sig);
  const b = Buffer.from(expected);
  if (a.length !== b.length || !timingSafeEqual(a, b)) return null;
  const at = parseInt(issued, 36);
  if (!Number.isFinite(at) || now - at > TOKEN_TTL_MS) return null;
  return /^[A-Za-z0-9_-]{8,40}$/.test(id) ? id : null;
}

export function hashIp(ip: string | null | undefined): string {
  return mac(`ip:${(ip ?? "").split(",")[0].trim() || "desconhecido"}`).slice(0, 32);
}

// ---------------------------------------------------------------------------
// Conversa do visitante
// ---------------------------------------------------------------------------

export interface StartChatInput {
  name: string;
  email?: string;
  phone?: string;
  message: string;
  pageUrl?: string;
  ip?: string | null;
}

function cleanText(value: string, max: number): string {
  return value.replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F]/g, "").trim().slice(0, max);
}

/** Primeira mensagem: confere o formulário e o limite por IP, cria o visitante e abre a conversa na Central. */
export async function startSiteChat(config: SiteChatConfig, input: StartChatInput, now: number = Date.now()): Promise<{ token: string; visitorId: string }> {
  const name = cleanText(input.name, SITE_CHAT_LIMITS.nameMaxLength);
  const message = cleanText(input.message, SITE_CHAT_LIMITS.messageMaxLength);
  if (name.length < 2) throw new BusinessError("Digite seu nome");
  if (!message) throw new BusinessError("Escreva sua mensagem");
  const email = input.email ? emailIdentity(input.email) : "";
  if (input.email?.trim() && !email) throw new BusinessError("E-mail inválido");
  const phone = input.phone?.trim() ? (toE164(input.phone) ?? "") : "";
  if (input.phone?.trim() && !phone) throw new BusinessError("Telefone inválido (com DDD)");
  if (config.requireContact && !email && !phone) throw new BusinessError("Informe um e-mail ou telefone para retornarmos");
  const ipHash = hashIp(input.ip);
  const since = new Date(now - HOUR).toISOString();
  const recent = (await list<ChatVisitor>(COLLECTIONS.chatVisitors, { where: [["ipHash", "==", ipHash]] })).filter((v) => v.createdAt >= since);
  if (recent.length >= SITE_CHAT_LIMITS.visitorsPerIpPerHour) throw new BusinessError("Muitas conversas abertas daqui. Tente de novo mais tarde.");
  const visitorId = randomBytes(12).toString("base64url");
  await create<ChatVisitor>(COLLECTIONS.chatVisitors, { name, email: email || undefined, phone: phone || undefined, ipHash, pageUrl: input.pageUrl?.slice(0, 300), lastMessageAt: new Date(now).toISOString(), windowStart: new Date(now).toISOString(), windowCount: 1 }, visitorId);
  await receiveInboundMessage({
    channel: "chat",
    from: visitorId,
    body: message,
    externalId: `${visitorId}:inicio`,
    displayName: name,
    hints: { email: email || undefined, phone: phone || undefined },
  });
  return { token: signVisitor(visitorId, now), visitorId };
}

/** Mensagem seguinte (id da mensagem do navegador = repetição ignorada). Limite por minuto. */
export async function sendSiteChatMessage(visitorId: string, body: string, clientId: string, now: number = Date.now()): Promise<void> {
  const text = cleanText(body, SITE_CHAT_LIMITS.messageMaxLength);
  if (!text) throw new BusinessError("Mensagem vazia");
  if (!/^[A-Za-z0-9_-]{6,40}$/.test(clientId)) throw new BusinessError("Mensagem inválida");
  const v = await getById<ChatVisitor>(COLLECTIONS.chatVisitors, visitorId);
  if (!v) throw new BusinessError("Conversa não encontrada: recarregue a página");
  const windowStart = v.windowStart ? new Date(v.windowStart).getTime() : 0;
  const inWindow = now - windowStart < 60_000;
  const count = inWindow ? (v.windowCount ?? 0) + 1 : 1;
  if (inWindow && count > SITE_CHAT_LIMITS.messagesPerMinute) throw new BusinessError("Muitas mensagens seguidas. Aguarde um pouco.");
  await update<ChatVisitor>(COLLECTIONS.chatVisitors, v.id, { lastMessageAt: new Date(now).toISOString(), windowStart: inWindow ? v.windowStart : new Date(now).toISOString(), windowCount: count });
  await receiveInboundMessage({ channel: "chat", from: visitorId, body: text, externalId: `${visitorId}:${clientId}`, displayName: v.name, hints: { email: v.email, phone: v.phone } });
}

export interface VisitorMessage {
  id: string;
  at: string;
  from: "visitante" | "equipe";
  /** Primeiro nome de quem respondeu (equipe) ou «Você». */
  author: string;
  body: string;
}

export interface VisitorThread {
  messages: VisitorMessage[];
  /** A conversa mais recente foi encerrada (a próxima mensagem abre outra). */
  closed: boolean;
  /** Fora do horário agora. */
  offline: boolean;
}

/**
 * Mensagens do visitante: só as do canal «chat» das conversas DELE (nota interna e sussurro são canal «interno» e
 * nunca saem daqui), na ordem, das últimas 3 conversas.
 */
export async function visitorThread(visitorId: string, after?: string): Promise<VisitorThread> {
  const key = contactKeyOf("chat", visitorId);
  const convs = (await list<Conversation>(COLLECTIONS.conversations, { where: [["channel", "==", "chat"], ["contactKey", "==", key]] })).sort((a, b) => (a.openedAt < b.openedAt ? 1 : -1)).slice(0, 3);
  const comms = (await Promise.all(convs.map((c) => list<Communication>(COLLECTIONS.communications, { where: [["conversationId", "==", c.id]] })))).flat();
  const visible = comms
    .filter((m) => m.channel === "chat" && (m.direction === "entrada" || m.status === "enviada" || m.status === "entregue" || m.status === "lida"))
    .filter((m) => !after || m.createdAt > after)
    .sort((a, b) => (a.createdAt < b.createdAt ? -1 : 1));
  const authorIds = Array.from(new Set(visible.filter((m) => m.direction === "saida" && m.userId).map((m) => m.userId!)));
  const authors = new Map((await Promise.all(authorIds.map((id) => getById<User>(COLLECTIONS.users, id)))).filter(Boolean).map((u) => [u!.id, u!.name.split(" ")[0]]));
  const status = await businessStatus(new Date());
  return {
    messages: visible.map((m) => ({ id: m.id, at: m.createdAt, from: m.direction === "entrada" ? "visitante" : "equipe", author: m.direction === "entrada" ? "Você" : (m.userId && authors.get(m.userId)) || "Equipe", body: m.body ?? "" })),
    closed: convs.length > 0 && !isOpenConversation(convs[0]),
    offline: !status.open,
  };
}

