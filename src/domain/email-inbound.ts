/**
 * E-mail de entrada da Central: leitura do remetente, texto sem a parte citada (o histórico que o cliente arrasta a
 * cada resposta), assunto da resposta e detecção de resposta automática. Puro: sem servidor.
 */

export interface InboundEmail {
  from: string;
  fromName?: string;
  to?: string;
  subject: string;
  /** Texto já sem a parte citada. */
  text: string;
  messageId?: string;
  inReplyTo?: string;
  /** Resposta automática (férias, «não responda», devolução): não abre conversa. */
  automatic: boolean;
}

/** "Joana Alves <joana@x.com.br>" → { email, name }. */
export function parseAddress(value: string | undefined | null): { email: string; name?: string } | null {
  if (!value) return null;
  const v = value.trim();
  const angle = v.match(/^\s*"?([^"<]*?)"?\s*<\s*([^<>\s]+@[^<>\s]+)\s*>\s*$/);
  if (angle) return { email: angle[2].toLowerCase(), name: angle[1].trim() || undefined };
  const plain = v.match(/([^\s<>,;"]+@[^\s<>,;"]+\.[^\s<>,;"]+)/);
  return plain ? { email: plain[1].toLowerCase() } : null;
}

const QUOTE_MARKERS = [
  /^\s*Em\s.{3,200}\sescreveu:\s*$/im, // Gmail em português
  /^\s*On\s.{3,200}\swrote:\s*$/im,
  /^\s*El\s.{3,200}\sescribió:\s*$/im,
  /^\s*-{2,}\s*(Mensagem original|Original Message|Mensaje original)\s*-{2,}\s*$/im,
  /^\s*_{10,}\s*$/m, // Outlook
  /^\s*(De|From):\s.+\n\s*(Enviad[ao]|Sent|Data|Date)( em)?:\s.+$/im,
];

/** Corta a parte citada (resposta anterior) e as linhas iniciadas por ">" no fim. Mantém o texto se tudo for citação. */
export function stripQuotedReply(text: string): string {
  const normalized = text.replace(/\r\n?/g, "\n");
  let cut = normalized.length;
  for (const re of QUOTE_MARKERS) {
    const m = re.exec(normalized);
    if (m && m.index > 0 && m.index < cut) cut = m.index;
  }
  let out = normalized.slice(0, cut);
  // Linhas finais de citação "> ...".
  const lines = out.split("\n");
  while (lines.length && (/^\s*>/.test(lines[lines.length - 1]) || lines[lines.length - 1].trim() === "")) lines.pop();
  out = lines.join("\n").trim();
  return out || normalized.trim();
}

/** HTML simples → texto (quando o provedor não manda a versão em texto). */
export function htmlToText(html: string): string {
  return html
    .replace(/<(script|style|head)[\s\S]*?<\/\1>/gi, "")
    .replace(/<br\s*\/?>/gi, "\n")
    .replace(/<\/(p|div|li|tr|h\d)>/gi, "\n")
    .replace(/<blockquote[\s\S]*?<\/blockquote>/gi, "")
    .replace(/<[^>]+>/g, "")
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/[ \t]+\n/g, "\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

/** Assunto da resposta: «Re: <assunto>» sem acumular «Re: Re: RES:». */
export function replySubject(subject: string | undefined, fallback = "Intercert — Atendimento"): string {
  const base = (subject ?? "").replace(/^\s*((re|res|fw|fwd|enc|rv)\s*:\s*)+/i, "").trim();
  return base ? `Re: ${base}` : fallback;
}

/** Message-ID sem os sinais < >. */
export function cleanMessageId(value: string | undefined | null): string | undefined {
  const v = value?.trim().replace(/^<|>$/g, "");
  return v || undefined;
}

/** É resposta automática? (cabeçalhos padrão e remetentes típicos de devolução). */
export function isAutomaticEmail(from: string, subject: string, headers: Record<string, string | undefined> = {}): boolean {
  const h = Object.fromEntries(Object.entries(headers).map(([k, v]) => [k.toLowerCase(), (v ?? "").toLowerCase()]));
  if (h["auto-submitted"] && h["auto-submitted"] !== "no") return true;
  if (h["x-autoreply"] || h["x-autorespond"] || h["x-auto-response-suppress"]?.includes("all")) return true;
  if (["bulk", "junk", "list", "auto_reply"].includes(h["precedence"] ?? "")) return true;
  if (/^(mailer-daemon|postmaster|no-?reply|nao-?responda)@/i.test(from)) return true;
  return /^(resposta automática|automatic reply|auto(matic)?[- ]?reply|ausência|fora do escritório|out of office|undeliverable|delivery status notification|mail delivery failed)/i.test(subject.trim());
}

type Headers = Record<string, string | undefined>;

function headersOf(value: unknown): Headers {
  if (Array.isArray(value)) {
    // Postmark: [{ Name, Value }]
    const out: Headers = {};
    for (const h of value as { Name?: string; Value?: string; name?: string; value?: string }[]) {
      const k = h.Name ?? h.name;
      if (k) out[k] = h.Value ?? h.value;
    }
    return out;
  }
  if (value && typeof value === "object") return Object.fromEntries(Object.entries(value as Record<string, unknown>).map(([k, v]) => [k, typeof v === "string" ? v : Array.isArray(v) ? String(v[0] ?? "") : undefined]));
  return {};
}

function str(v: unknown): string | undefined {
  return typeof v === "string" && v.trim() ? v : Array.isArray(v) && typeof v[0] === "string" ? v[0] : undefined;
}

/**
 * Normaliza o e-mail recebido de formatos comuns: o formato do INTEROS ({ from, subject, text, html, messageId,
 * inReplyTo, headers }), o «inbound» do Postmark ({ From, Subject, TextBody, HtmlBody, MessageID, Headers }) e o
 * conteúdo de e-mail recebido do Resend ({ from, subject, text, html, message_id, headers }).
 */
export function normalizeInboundEmail(raw: unknown): InboundEmail | null {
  const p = (raw ?? {}) as Record<string, unknown>;
  const fromRaw = str(p.from) ?? str(p.From) ?? str((p.FromFull as { Email?: string } | undefined)?.Email);
  const from = parseAddress(fromRaw);
  if (!from) return null;
  const headers = headersOf(p.headers ?? p.Headers);
  const subject = (str(p.subject) ?? str(p.Subject) ?? "").trim();
  const text = str(p.text) ?? str(p.TextBody) ?? str(p.StrippedTextReply);
  const html = str(p.html) ?? str(p.HtmlBody);
  const body = stripQuotedReply(text ?? (html ? htmlToText(html) : ""));
  const header = (name: string) => Object.entries(headers).find(([k]) => k.toLowerCase() === name)?.[1];
  return {
    from: from.email,
    fromName: from.name ?? str(p.FromName),
    to: parseAddress(str(p.to) ?? str(p.To))?.email,
    subject,
    text: body,
    // O Message-ID do cabeçalho é o que o cliente de e-mail usa para encadear; o MessageID do Postmark é interno dele.
    messageId: cleanMessageId(header("message-id") ?? str(p.messageId) ?? str(p.message_id) ?? str(p.MessageID)),
    inReplyTo: cleanMessageId(str(p.inReplyTo) ?? str(p.in_reply_to) ?? header("in-reply-to")),
    automatic: isAutomaticEmail(from.email, subject, headers),
  };
}

/** Texto gravado na conversa: o assunto entra na primeira linha quando é a primeira mensagem (dá contexto). */
export function inboundEmailBody(email: Pick<InboundEmail, "subject" | "text">, withSubject: boolean): string {
  const text = email.text.trim() || "(e-mail sem texto)";
  return withSubject && email.subject ? `Assunto: ${email.subject}\n\n${text}` : text;
}
