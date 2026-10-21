import { randomBytes } from "node:crypto";
import type { NextRequest } from "next/server";
import { activeSiteChat } from "@/server/conversations/site-chat";
import { chatEmbedHtml } from "@/server/conversations/site-chat-page";
import { publicBase } from "@/server/telephony/webhook";
import { domainAllowed, frameAncestors, normalizeDomain } from "@/domain/site-chat";

export const dynamic = "force-dynamic";

/**
 * Janela do chat do site (pública, dentro de iframe no site da empresa). CSP própria: scripts e estilos só com nonce,
 * conexões só com o INTEROS e iframe só nos sites permitidos (frame-ancestors). Site fora da lista: aviso, sem chat.
 */
export async function GET(request: NextRequest) {
  const sp = request.nextUrl.searchParams;
  const key = sp.get("k") ?? "";
  const config = await activeSiteChat(key);
  if (!config) return new Response("Chat indisponível", { status: 404, headers: { "content-type": "text/plain; charset=utf-8", "cache-control": "no-store" } });
  const pageUrl = (sp.get("u") ?? request.headers.get("referer") ?? "").slice(0, 1000);
  // O próprio INTEROS (link «abrir para testar») sempre pode.
  const blocked = !domainAllowed(pageUrl, config.allowedDomains) && normalizeDomain(pageUrl) !== normalizeDomain(publicBase(request));
  const nonce = randomBytes(16).toString("base64");
  const csp = [
    "default-src 'none'",
    `script-src 'nonce-${nonce}'`,
    `style-src 'nonce-${nonce}'`,
    "connect-src 'self'",
    "img-src 'self' data:",
    "base-uri 'none'",
    "form-action 'none'",
    `frame-ancestors ${frameAncestors(config.allowedDomains, publicBase(request))}`,
  ].join("; ");
  return new Response(chatEmbedHtml(config, { key, nonce, pageUrl, blocked }), {
    status: 200,
    headers: { "content-type": "text/html; charset=utf-8", "content-security-policy": csp, "cache-control": "no-store", "x-robots-tag": "noindex", "referrer-policy": "no-referrer" },
  });
}
