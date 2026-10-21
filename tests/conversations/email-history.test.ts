/**
 * Regras puras da parte 3 da Central: e-mail de entrada (remetente, corte da citação, assunto, resposta automática,
 * formatos dos provedores), assinatura Svix do webhook do Resend, histórico (busca, destaque, CSV) e distribuição com
 * limite e canais por pessoa.
 */
import { createHmac } from "node:crypto";
import { describe, expect, it } from "vitest";
import { cleanMessageId, htmlToText, inboundEmailBody, isAutomaticEmail, normalizeInboundEmail, parseAddress, replySubject, stripQuotedReply } from "@/domain/email-inbound";
import { csvCell, firstResponseMs, formatDurationShort, highlightParts, historyDays, snippetAround, textMatches, toCsv } from "@/domain/conversation-history";
import { pickAssignee } from "@/domain/conversations";
import { svixSignatureValid } from "@/server/integrations/svix";

describe("e-mail de entrada", () => {
  it("lê o remetente com e sem nome", () => {
    expect(parseAddress('"Joana Alves" <Joana@Mercado.com.br>')).toEqual({ email: "joana@mercado.com.br", name: "Joana Alves" });
    expect(parseAddress("mateus@agropet.com")).toEqual({ email: "mateus@agropet.com" });
    expect(parseAddress("sem e-mail")).toBeNull();
  });

  it("corta a parte citada (Gmail em português, inglês, Outlook e linhas com >)", () => {
    expect(stripQuotedReply("Recebi, obrigada!\n\nEm qua., 21 de out. de 2026 às 10:41, Intercert <atendimento@intercert.com.br> escreveu:\n> Segue a segunda via")).toBe("Recebi, obrigada!");
    expect(stripQuotedReply("Thanks!\n\nOn Wed, Oct 21, 2026 at 10:41 AM Intercert wrote:\n> old")).toBe("Thanks!");
    expect(stripQuotedReply("Ok, pode ser amanhã.\n\n________________________________\nDe: Intercert\nEnviado: quarta")).toBe("Ok, pode ser amanhã.");
    expect(stripQuotedReply("Resposta\n> citação 1\n> citação 2\n")).toBe("Resposta");
    // Tudo citado: mantém o texto (não grava mensagem vazia).
    expect(stripQuotedReply("> só citação")).toBe("> só citação");
  });

  it("assunto da resposta sem acumular Re:", () => {
    expect(replySubject("Boleto de outubro")).toBe("Re: Boleto de outubro");
    expect(replySubject("RES: Re: Boleto")).toBe("Re: Boleto");
    expect(replySubject(undefined)).toBe("Intercert — Atendimento");
  });

  it("reconhece resposta automática", () => {
    expect(isAutomaticEmail("joana@x.com", "Boleto", { "Auto-Submitted": "auto-replied" })).toBe(true);
    expect(isAutomaticEmail("mailer-daemon@x.com", "Erro")).toBe(true);
    expect(isAutomaticEmail("joana@x.com", "Resposta automática: estou de férias")).toBe(true);
    expect(isAutomaticEmail("joana@x.com", "Boleto de outubro", { "Auto-Submitted": "no" })).toBe(false);
  });

  it("normaliza o formato do INTEROS, o do Postmark e o do Resend", () => {
    const own = normalizeInboundEmail({ from: "Joana <joana@x.com>", subject: "Boleto", text: "Não recebi o boleto.\n\nOn Mon, X wrote:\n> antigo", messageId: "<abc@x.com>" });
    expect(own).toMatchObject({ from: "joana@x.com", fromName: "Joana", subject: "Boleto", text: "Não recebi o boleto.", messageId: "abc@x.com", automatic: false });

    const postmark = normalizeInboundEmail({ From: "mateus@agropet.com", FromName: "Mateus", Subject: "Emissor", TextBody: "Não abre.", MessageID: "pm-1", Headers: [{ Name: "Message-ID", Value: "<real@agropet.com>" }, { Name: "In-Reply-To", Value: "<prev@intercert>" }] });
    expect(postmark).toMatchObject({ from: "mateus@agropet.com", fromName: "Mateus", messageId: "real@agropet.com", inReplyTo: "prev@intercert" });

    const resend = normalizeInboundEmail({ from: "Ana <ana@y.com>", to: ["atendimento@intercert.com.br"], subject: "Preço", html: "<p>Qual o <b>preço</b>?</p><blockquote>antigo</blockquote>", message_id: "<r1@y.com>" });
    expect(resend).toMatchObject({ from: "ana@y.com", to: "atendimento@intercert.com.br", text: "Qual o preço?", messageId: "r1@y.com" });

    expect(normalizeInboundEmail({ subject: "sem remetente" })).toBeNull();
  });

  it("assunto só na mensagem que abre a conversa; HTML vira texto; Message-ID sem < >", () => {
    expect(inboundEmailBody({ subject: "Boleto", text: "Oi" }, true)).toBe("Assunto: Boleto\n\nOi");
    expect(inboundEmailBody({ subject: "Boleto", text: "Oi" }, false)).toBe("Oi");
    expect(htmlToText("Linha 1<br>Linha&nbsp;2 &amp; 3")).toBe("Linha 1\nLinha 2 & 3");
    expect(cleanMessageId(" <a@b> ")).toBe("a@b");
  });
});

describe("assinatura Svix (webhook do Resend)", () => {
  const key = Buffer.from("segredo-de-teste-123").toString("base64");
  const secret = `whsec_${key}`;
  const body = '{"type":"email.received","data":{"email_id":"e1"}}';
  const now = Date.UTC(2026, 9, 21, 12, 0, 0);
  const ts = String(Math.floor(now / 1000));
  const sign = (b: string) => createHmac("sha256", Buffer.from(key, "base64")).update(`msg_1.${ts}.${b}`).digest("base64");

  it("aceita a assinatura certa (entre várias) e recusa corpo alterado, segredo errado ou aviso velho", () => {
    expect(svixSignatureValid({ secret, id: "msg_1", timestamp: ts, signature: `v1,${"x".repeat(44)} v1,${sign(body)}`, body, now })).toBe(true);
    expect(svixSignatureValid({ secret, id: "msg_1", timestamp: ts, signature: `v1,${sign(body)}`, body: body.replace("e1", "e2"), now })).toBe(false);
    expect(svixSignatureValid({ secret: `whsec_${Buffer.from("outro").toString("base64")}`, id: "msg_1", timestamp: ts, signature: `v1,${sign(body)}`, body, now })).toBe(false);
    expect(svixSignatureValid({ secret, id: "msg_1", timestamp: ts, signature: `v1,${sign(body)}`, body, now: now + 10 * 60_000 })).toBe(false);
    expect(svixSignatureValid({ secret, id: null, timestamp: ts, signature: `v1,${sign(body)}`, body, now })).toBe(false);
  });
});

describe("histórico de atendimentos", () => {
  it("busca sem acento e sem diferenciar maiúsculas; dígitos casam com telefone formatado", () => {
    expect(textMatches("joao", ["João da Silva"])).toBe(true);
    expect(textMatches("BOLETO", ["não recebi o boleto"])).toBe(true);
    expect(textMatches("99811", ["(88) 9 9811-2040"])).toBe(true);
    expect(textMatches("pix", ["boleto", undefined])).toBe(false);
  });

  it("destaca o termo mantendo o texto original", () => {
    expect(highlightParts("Não recebi o Boleto", "boleto")).toEqual([
      { text: "Não recebi o ", match: false },
      { text: "Boleto", match: true },
    ]);
    expect(highlightParts("ação e acao", "acao").filter((p) => p.match).map((p) => p.text)).toEqual(["ação", "acao"]);
  });

  it("trecho em volta do termo", () => {
    const text = `${"a ".repeat(80)}o boleto venceu ontem${" b".repeat(80)}`;
    const s = snippetAround(text, "boleto", 20);
    expect(s.startsWith("…")).toBe(true);
    expect(s.endsWith("…")).toBe(true);
    expect(s).toContain("boleto");
  });

  it("1ª resposta e duração curta", () => {
    expect(firstResponseMs({ openedAt: "2026-10-21T10:00:00Z", firstResponseAt: "2026-10-21T10:03:00Z" })).toBe(180_000);
    expect(firstResponseMs({ openedAt: "2026-10-21T10:00:00Z" })).toBeUndefined();
    expect(formatDurationShort(180_000)).toBe("3 min");
    expect(formatDurationShort(130 * 60_000)).toBe("2 h 10");
    expect(formatDurationShort(28 * 3600_000)).toBe("1 d 4 h");
    expect(formatDurationShort(undefined)).toBe("—");
  });

  it("período só aceita os valores da tela", () => {
    expect(historyDays("90")).toBe(90);
    expect(historyDays("1000")).toBe(30);
    expect(historyDays(undefined)).toBe(30);
  });

  it("CSV com ; aspas quando preciso e sem fórmula do Excel", () => {
    expect(csvCell('Disse "oi"; tchau')).toBe('"Disse ""oi""; tchau"');
    expect(csvCell("=HYPERLINK(1)")).toBe("'=HYPERLINK(1)");
    expect(csvCell(undefined)).toBe("");
    expect(toCsv(["A", "B"], [["1", "x;y"]])).toBe('﻿A;B\r\n1;"x;y"');
  });
});

describe("distribuição com limite próprio", () => {
  it("o limite da pessoa vale no lugar do da fila", () => {
    const candidates = [
      { id: "a", available: true, load: 4, limit: 6 },
      { id: "b", available: true, load: 3, limit: 3 },
    ];
    expect(pickAssignee({ strategy: "menor_carga", candidates, maxConcurrent: 4 })).toBe("a");
    expect(pickAssignee({ strategy: "menor_carga", candidates: [{ id: "a", available: true, load: 4 }], maxConcurrent: 4 })).toBeUndefined();
  });
});
