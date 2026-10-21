import "server-only";
/**
 * Conectar os canais da fase 5 pela tela (Canais e filas): Instagram/Messenger (login da Meta + escolha da página) e
 * Telegram (token do bot). Tokens só no servidor, cifrados; a tela vê apenas o que está conectado.
 */
import { nowIso } from "@/server/db";
import { BusinessError } from "@/server/auth/error-classes";
import { emitEvent } from "@/server/events";
import type { ChannelConnection, UserRef } from "@/domain/types";
import { connectionToken, getConnection, removeConnection, saveConnection } from "@/server/integrations/channel-connections";
import { unseal } from "@/server/integrations/vault";
import { exchangeMetaCode, listMetaPages, metaAppConfigured, subscribeMetaPage, unsubscribeMetaPage, type MetaPage } from "@/server/integrations/meta-social";
import { removeTelegramWebhook, setupTelegramBot } from "@/server/integrations/telegram";

const PENDING_TTL_MS = 15 * 60_000;
/** Cookie do «state» do login da Meta (contra falsificação do retorno). */
export const META_STATE_COOKIE = "interos_meta_state";

export interface SocialStatus {
  appConfigured: boolean;
  connected: boolean;
  pageName?: string;
  instagramUsername?: string;
  messenger: boolean;
  instagram: boolean;
  connectedAt?: string;
  connectedByName?: string;
  /** Páginas para escolher depois do login (sem tokens). */
  pending: { id: string; name: string; instagram?: string }[];
}

export async function getSocialStatus(): Promise<SocialStatus> {
  const [c, pendingDoc] = await Promise.all([getConnection("meta"), getConnection("meta_pendente")]);
  const pending = pendingPages(pendingDoc);
  return {
    appConfigured: metaAppConfigured(),
    connected: Boolean(c),
    pageName: c?.pageName,
    instagramUsername: c?.instagramUsername,
    messenger: Boolean(c?.pageId),
    instagram: Boolean(c?.instagramId),
    connectedAt: c?.connectedAt,
    connectedByName: c?.connectedByName,
    pending: pending.map((p) => ({ id: p.id, name: p.name, instagram: p.instagram?.username ?? (p.instagram ? "conta ligada" : undefined) })),
  };
}

function pendingPages(doc: ChannelConnection | null): MetaPage[] {
  if (!doc || (doc.expiresAt && doc.expiresAt < nowIso())) return [];
  try {
    return JSON.parse(unseal(doc.tokenSealed) ?? "[]") as MetaPage[];
  } catch {
    return [];
  }
}

/** Retorno do login da Meta: troca o código, lista as páginas e conecta (uma página) ou deixa para escolher. */
export async function completeMetaLogin(code: string, redirectUri: string, actor: UserRef): Promise<{ connected: boolean; choose: boolean }> {
  const t = await exchangeMetaCode(code, redirectUri);
  if (!t.ok) throw new BusinessError(`A Meta não concluiu o login: ${t.error}`);
  const pages = await listMetaPages(t.token);
  if (!pages.ok) throw new BusinessError(`Não foi possível listar as páginas: ${pages.error}`);
  if (!pages.pages.length) throw new BusinessError("Nenhuma página do Facebook encontrada para esta conta (o Instagram precisa estar ligado a uma página).");
  if (pages.pages.length === 1) {
    await connectPage(pages.pages[0], actor);
    return { connected: true, choose: false };
  }
  await saveConnection("meta_pendente", { token: JSON.stringify(pages.pages), expiresAt: new Date(Date.now() + PENDING_TTL_MS).toISOString() }, actor);
  return { connected: false, choose: true };
}

export async function chooseMetaPage(pageId: string, actor: UserRef): Promise<void> {
  const page = pendingPages(await getConnection("meta_pendente")).find((p) => p.id === pageId);
  if (!page) throw new BusinessError("Escolha expirada: faça o login da Meta de novo.");
  await connectPage(page, actor);
}

async function connectPage(page: MetaPage, actor: UserRef): Promise<void> {
  const sub = await subscribeMetaPage(page.id, page.token);
  if (!sub.ok) throw new BusinessError(`A Meta não aceitou assinar os avisos da página: ${sub.error}`);
  await saveConnection("meta", { token: page.token, pageId: page.id, pageName: page.name, instagramId: page.instagram?.id, instagramUsername: page.instagram?.username }, actor);
  await removeConnection("meta_pendente");
  await emitEvent({ type: "settings.updated", actor, entity: { type: "setting", id: "canal_meta" }, title: `${actor.name} conectou o Instagram/Messenger (${page.name})`, payload: { key: "canal_meta", pageId: page.id, instagram: Boolean(page.instagram) }, timeline: false });
}

export async function disconnectMeta(actor: UserRef): Promise<void> {
  const conn = await connectionToken("meta");
  if (conn?.connection.pageId) await unsubscribeMetaPage(conn.connection.pageId, conn.token).catch(() => undefined);
  await removeConnection("meta");
  await removeConnection("meta_pendente");
  await emitEvent({ type: "settings.updated", actor, entity: { type: "setting", id: "canal_meta" }, title: `${actor.name} desconectou o Instagram/Messenger`, payload: { key: "canal_meta", connected: false }, timeline: false });
}

// ---------------------------------------------------------------------------
// Telegram
// ---------------------------------------------------------------------------

export interface TelegramStatus {
  connected: boolean;
  botUsername?: string;
  connectedAt?: string;
  connectedByName?: string;
}

export async function getTelegramStatus(): Promise<TelegramStatus> {
  const c = await getConnection("telegram");
  return { connected: Boolean(c), botUsername: c?.botUsername, connectedAt: c?.connectedAt, connectedByName: c?.connectedByName };
}

export async function connectTelegram(token: string, base: string, actor: UserRef): Promise<{ botUsername: string }> {
  if (!base.startsWith("https://")) throw new BusinessError("O Telegram só envia avisos para endereço https (use o domínio publicado do INTEROS).");
  const r = await setupTelegramBot(token.trim(), `${base}/api/webhooks/telegram`);
  if (!r.ok) throw new BusinessError(r.error);
  // Outro bot conectado antes: desliga o webhook dele.
  const previous = await connectionToken("telegram");
  if (previous && previous.connection.botId !== r.botId) await removeTelegramWebhook(previous.token).catch(() => undefined);
  await saveConnection("telegram", { token: token.trim(), secret: r.secret, botId: r.botId, botUsername: r.botUsername }, actor);
  await emitEvent({ type: "settings.updated", actor, entity: { type: "setting", id: "canal_telegram" }, title: `${actor.name} conectou o Telegram (@${r.botUsername})`, payload: { key: "canal_telegram", bot: r.botUsername }, timeline: false });
  return { botUsername: r.botUsername };
}

export async function disconnectTelegram(actor: UserRef): Promise<void> {
  const conn = await connectionToken("telegram");
  if (conn) await removeTelegramWebhook(conn.token).catch(() => undefined);
  await removeConnection("telegram");
  await emitEvent({ type: "settings.updated", actor, entity: { type: "setting", id: "canal_telegram" }, title: `${actor.name} desconectou o Telegram`, payload: { key: "canal_telegram", connected: false }, timeline: false });
}

