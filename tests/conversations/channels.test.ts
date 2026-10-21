/**
 * Novos canais (fase 5): chave de contato por id, janela da Meta, avisos da Meta e do Telegram, cofre de tokens, chat
 * do site (sites permitidos, token do visitante e a página do chat).
 */
import { createHmac } from "node:crypto";
import { describe, expect, it } from "vitest";
import { contactKeyOf } from "@/domain/phone";
import { metaReplyWindow } from "@/domain/channels";
import { domainAllowed, frameAncestors, normalizeDomain, DEFAULT_SITE_CHAT } from "@/domain/site-chat";
import { extractMetaMessages, metaSignatureValid } from "@/server/integrations/meta-social";
import { extractTelegramMessage, looksLikeBotToken } from "@/server/integrations/telegram";
import { seal, unseal } from "@/server/integrations/vault";
import { signVisitor, verifyVisitor } from "@/server/conversations/site-chat";
import { chatEmbedHtml, chatWidgetJs } from "@/server/conversations/site-chat-page";

describe("chave de contato e janela", () => {
  it("canais por id têm prefixo próprio e não aceitam lixo", () => {
    expect(contactKeyOf("instagram", "17841400000000001")).toBe("ig:17841400000000001");
    expect(contactKeyOf("messenger", "6000000000000001")).toBe("fb:6000000000000001");
    expect(contactKeyOf("telegram", "123456789")).toBe("tg:123456789");
    expect(contactKeyOf("chat", "AbC_123-xyz")).toBe("ch:AbC_123-xyz");
    expect(contactKeyOf("chat", "x y")).toBe("");
    expect(contactKeyOf("whatsapp", "+55 88 99811-2040")).toMatch(/^p:/);
  });
  it("Meta: 24 h normal, até 7 dias com atendimento humano, depois fechado", () => {
    const now = Date.UTC(2026, 9, 21, 12);
    const h = (n: number) => new Date(now - n * 3_600_000).toISOString();
    expect(metaReplyWindow(h(2), now)).toEqual({ open: true, humanAgentTag: false });
    expect(metaReplyWindow(h(30), now)).toEqual({ open: true, humanAgentTag: true });
    expect(metaReplyWindow(h(24 * 8), now)).toEqual({ open: false, humanAgentTag: false });
    expect(metaReplyWindow(undefined, now).open).toBe(false);
  });
});

describe("avisos da Meta", () => {
  const payload = {
    object: "instagram",
    entry: [
      {
        messaging: [
          { sender: { id: "IG1" }, timestamp: 1761048000000, message: { mid: "m1", text: " Oi! " } },
          { sender: { id: "PAGE" }, message: { mid: "m2", text: "eco", is_echo: true } },
          { sender: { id: "IG2" }, message: { mid: "m3", attachments: [{ type: "image" }] } },
          { sender: { id: "IG3" }, read: { watermark: 1 } },
        ],
      },
    ],
  };
  it("extrai as mensagens (sem eco e sem leitura); anexo vira texto", () => {
    const m = extractMetaMessages(payload);
    expect(m).toEqual([
      { channel: "instagram", from: "IG1", body: "Oi!", externalId: "m1", at: new Date(1761048000000).toISOString() },
      { channel: "instagram", from: "IG2", body: "[image]", externalId: "m3", at: undefined },
    ]);
    expect(extractMetaMessages({ ...payload, object: "page" })[0].channel).toBe("messenger");
    expect(extractMetaMessages({ object: "whatsapp_business_account" })).toEqual([]);
  });
  it("assinatura: HMAC-SHA256 do corpo bruto com o App Secret", () => {
    const raw = JSON.stringify(payload);
    const sig = `sha256=${createHmac("sha256", "segredo").update(raw).digest("hex")}`;
    expect(metaSignatureValid(raw, sig, "segredo")).toBe(true);
    expect(metaSignatureValid(raw + " ", sig, "segredo")).toBe(false);
    expect(metaSignatureValid(raw, null, "segredo")).toBe(false);
    expect(metaSignatureValid(raw, sig, undefined)).toBe(false);
  });
});

describe("Telegram", () => {
  it("token do BotFather", () => {
    expect(looksLikeBotToken("1234567890:AAH9k3n2Ff_abcdefghijklmnopqrstuvwxyz")).toBe(true);
    expect(looksLikeBotToken("abc")).toBe(false);
  });
  it("só conversa privada; legenda e foto viram texto; edição tem id próprio", () => {
    const base = { message_id: 7, date: 1761048000, chat: { id: 555, type: "private" }, from: { first_name: "Ana", last_name: "Lima" } };
    expect(extractTelegramMessage({ message: { ...base, text: "Olá" } })).toEqual({ chatId: "555", body: "Olá", externalId: "555:7", displayName: "Ana Lima", at: new Date(1761048000 * 1000).toISOString() });
    expect(extractTelegramMessage({ message: { ...base, photo: [{}], caption: "" } })?.body).toBe("[foto]");
    expect(extractTelegramMessage({ edited_message: { ...base, text: "Olá!" } })?.externalId).toBe("555:7:edit");
    expect(extractTelegramMessage({ message: { ...base, chat: { id: -1, type: "group" }, text: "oi" } })).toBeNull();
  });
});

describe("cofre de tokens", () => {
  it("cifra e abre; adulterado não abre", () => {
    const s = seal("EAAG-token-da-pagina");
    expect(s.startsWith("v1.")).toBe(true);
    expect(s).not.toContain("EAAG");
    expect(unseal(s)).toBe("EAAG-token-da-pagina");
    const parts = s.split(".");
    parts[3] = parts[3].slice(0, -2) + (parts[3].endsWith("A") ? "BB" : "AA");
    expect(unseal(parts.join("."))).toBeNull();
    expect(unseal("lixo")).toBeNull();
  });
});

describe("chat do site", () => {
  it("sites permitidos (domínio e subdomínios)", () => {
    expect(normalizeDomain("https://www.Intercert.com.br/contato")).toBe("intercert.com.br");
    expect(normalizeDomain("não é site")).toBe("");
    expect(domainAllowed("https://loja.intercert.com.br/p", ["intercert.com.br"])).toBe(true);
    expect(domainAllowed("https://intercert.com.br.golpe.com", ["intercert.com.br"])).toBe(false);
    expect(domainAllowed("https://outro.com", [])).toBe(true);
    expect(domainAllowed("", ["intercert.com.br"])).toBe(false);
    expect(frameAncestors(["intercert.com.br"], "https://app")).toBe("'self' https://intercert.com.br https://*.intercert.com.br https://app");
    expect(frameAncestors([], "https://app")).toBe("*");
  });
  it("token do visitante: assinado e com validade", () => {
    const now = Date.UTC(2026, 9, 21);
    const t = signVisitor("visitante_123", now);
    expect(verifyVisitor(t, now)).toBe("visitante_123");
    expect(verifyVisitor(t.replace("visitante_123", "visitante_999"), now)).toBeNull();
    expect(verifyVisitor(t, now + 31 * 86_400_000)).toBeNull();
    expect(verifyVisitor("x.y.z", now)).toBeNull();
  });
  it("página do chat: texto da configuração não vira código; script do site com a chave", () => {
    const html = chatEmbedHtml({ ...DEFAULT_SITE_CHAT, enabled: true, publicKey: "chave123456", title: "</script><b>x" }, { key: "chave123456", nonce: "abc", pageUrl: "https://intercert.com.br", blocked: false });
    expect(html).not.toContain("</script><b>");
    expect(html).toContain('nonce="abc"');
    expect(chatEmbedHtml(DEFAULT_SITE_CHAT, { key: "k", nonce: "n", pageUrl: "", blocked: true })).toContain("Chat indisponível neste site");
    const js = chatWidgetJs({ ...DEFAULT_SITE_CHAT, position: "esquerda" }, "https://app.interos", "chave123456");
    expect(js).toContain('"side":"left"');
    expect(js).toContain("/chat/embed?k=");
  });
});
