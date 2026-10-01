/**
 * Portal do Cliente (D31, etapa 6B) — regras puras do link (formato do token, validade, revogação, um evento de
 * acesso por dia). Sem dependências de servidor: usado pelo serviço, pela página pública, pelo seed e pelos testes.
 *
 * Desenho: o token são 32 bytes aleatórios em base64url (43 caracteres), exibido UMA vez; o documento em
 * `portal_links` tem id = sha256(token) em hex e nunca guarda o token (nem em claro, nem cifrado).
 */
import type { PortalLink } from "./types";

/** Validade padrão de um link gerado pela tela (dias; configurável no diálogo). */
export const PORTAL_DEFAULT_DAYS = 90;
/** Validade de um link gerado automaticamente no envio de uma mensagem com `{linkPortal}` (dias). */
export const PORTAL_MESSAGE_DAYS = 30;
export const PORTAL_MIN_DAYS = 1;
export const PORTAL_MAX_DAYS = 365;

/** Mensagem ÚNICA para link inexistente, revogado, expirado ou malformado (não revela se o link existiu). */
export const PORTAL_INVALID_MESSAGE = "Link inválido ou expirado";

/** 32 bytes em base64url sem padding = 43 caracteres. */
export const PORTAL_TOKEN_PATTERN = /^[A-Za-z0-9_-]{43}$/;
/** Id do documento: sha256 do token em hex. */
export const PORTAL_LINK_ID_PATTERN = /^[0-9a-f]{64}$/;

export type PortalLinkOrigin = PortalLink["origin"];
export const PORTAL_ORIGIN_LABELS: Record<PortalLinkOrigin, string> = { manual: "Gerado na tela", mensagem: "Enviado em mensagem" };

export type PortalLinkState = "ativo" | "revogado" | "expirado";
export const PORTAL_LINK_STATE_LABELS: Record<PortalLinkState, string> = { ativo: "Ativo", revogado: "Revogado", expirado: "Expirado" };

const DAY_MS = 24 * 60 * 60 * 1000;

/** O texto tem o formato de um token do portal (descarta lixo antes de qualquer leitura no banco). */
export function isPortalTokenFormat(token: string | undefined | null): token is string {
  return typeof token === "string" && PORTAL_TOKEN_PATTERN.test(token);
}

export function isPortalLinkId(id: string | undefined | null): id is string {
  return typeof id === "string" && PORTAL_LINK_ID_PATTERN.test(id);
}

/** Validade em dias limitada ao intervalo aceito (inteiro). */
export function clampPortalDays(days: number | undefined, fallback = PORTAL_DEFAULT_DAYS): number {
  const n = Number.isFinite(days) ? Math.round(days as number) : fallback;
  return Math.min(PORTAL_MAX_DAYS, Math.max(PORTAL_MIN_DAYS, n));
}

/** Data de expiração (ISO) a partir de agora. */
export function portalExpiresAt(days: number, now: Date = new Date()): string {
  return new Date(now.getTime() + clampPortalDays(days) * DAY_MS).toISOString();
}

/** Situação do link: revogado vence expirado (a revogação é uma decisão registrada). */
export function portalLinkState(link: Pick<PortalLink, "expiresAt" | "revokedAt">, now: Date = new Date()): PortalLinkState {
  if (link.revokedAt) return "revogado";
  if (!link.expiresAt || link.expiresAt <= now.toISOString()) return "expirado";
  return "ativo";
}

export function isPortalLinkUsable(link: Pick<PortalLink, "expiresAt" | "revokedAt"> | null | undefined, now: Date = new Date()): boolean {
  return Boolean(link) && portalLinkState(link!, now) === "ativo";
}

/**
 * O acesso de agora deve gerar o evento `portal.accessed`? No máximo um por dia (chave AAAA-MM-DD de São Paulo) por
 * link; `lastAccessEventDay` é gravado na mesma transação que conta o acesso.
 */
export function shouldEmitPortalAccess(link: Pick<PortalLink, "lastAccessEventDay">, todayKey: string): boolean {
  return link.lastAccessEventDay !== todayKey;
}

/** O texto de uma mensagem pede o link do portal (gera-se um link novo SÓ nesse caso). */
export function templateUsesPortalLink(text: string | undefined | null): boolean {
  return typeof text === "string" && text.includes("{linkPortal}");
}

/** Caminho público do portal para um token. */
export function portalPath(token: string): string {
  return `/portal/${token}`;
}

/** Linha do link do portal numa mensagem ("" quando não há link). Mesmo formato de {linkBoleto}. */
export function portalLinkLine(url: string | null | undefined): string {
  return url ? `Portal do cliente: ${url}\n` : "";
}

/** Troca `{linkPortal}` pela linha do link (ou remove, sem link) e arruma espaços/quebras como a régua. */
export function fillPortalLink(text: string, url: string | null | undefined): string {
  return text
    .split("{linkPortal}")
    .join(portalLinkLine(url))
    .replace(/[ \t]+\n/g, "\n")
    .trim();
}

/** Marcador gravado no lugar do link do portal (o link contém o token, que nunca é gravado). */
export const PORTAL_URL_MASK = "[link do portal do cliente — não fica registrado]";

/** Texto gravável: o link do portal sai mascarado de comunicações, eventos e tarefas. */
export function redactPortalUrl(text: string, url: string | null | undefined): string {
  if (!url) return text;
  return text.split(url).join(PORTAL_URL_MASK);
}
