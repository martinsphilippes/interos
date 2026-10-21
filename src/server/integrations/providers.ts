import "server-only";
/**
 * Chamadas HTTP aos provedores implementados (só usadas quando `isConnected` confirma as credenciais):
 * - WhatsApp: Meta Cloud API (mensagem de texto; fora da janela de 24 h a Meta exige template aprovado).
 * - E-mail: Resend.
 * Sem SDK: fetch com timeout. Erros viram { ok: false } e o chamador registra a comunicação como "falha".
 */
import { toInternationalDigits } from "@/components/clients/contact-links";

const TIMEOUT_MS = 15_000;

export type ProviderResult = { ok: true; externalId: string } | { ok: false; error: string };

async function post(url: string, headers: Record<string, string>, body: unknown): Promise<{ status: number; json: unknown }> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);
  try {
    const res = await fetch(url, { method: "POST", headers: { "content-type": "application/json", ...headers }, body: JSON.stringify(body), signal: controller.signal });
    const json = await res.json().catch(() => null);
    return { status: res.status, json };
  } finally {
    clearTimeout(timer);
  }
}

export async function sendWhatsappText(to: string, body: string): Promise<ProviderResult> {
  const token = process.env.WHATSAPP_ACCESS_TOKEN;
  const phoneId = process.env.WHATSAPP_PHONE_NUMBER_ID;
  const digits = toInternationalDigits(to);
  if (!token || !phoneId) return { ok: false, error: "WhatsApp não configurado" };
  if (!digits) return { ok: false, error: "Telefone do destinatário ausente" };
  try {
    const { status, json } = await post(
      `https://graph.facebook.com/v20.0/${encodeURIComponent(phoneId)}/messages`,
      { authorization: `Bearer ${token}` },
      { messaging_product: "whatsapp", to: digits, type: "text", text: { body } },
    );
    const id = (json as { messages?: { id?: string }[] } | null)?.messages?.[0]?.id;
    if (status >= 200 && status < 300 && id) return { ok: true, externalId: id };
    const message = (json as { error?: { message?: string } } | null)?.error?.message;
    console.error(`[whatsapp] Meta respondeu HTTP ${status}: ${message ?? "sem detalhe"}`);
    return { ok: false, error: message ?? `HTTP ${status}` };
  } catch (error) {
    console.error("[whatsapp] falha no envio", error);
    return { ok: false, error: "Falha de rede ao chamar a Meta" };
  }
}

// ---------------------------------------------------------------------------
// WhatsApp: modelos aprovados (templates)
// ---------------------------------------------------------------------------

const GRAPH = "https://graph.facebook.com/v20.0";

async function getJson(url: string, headers: Record<string, string>): Promise<{ status: number; json: unknown }> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);
  try {
    const res = await fetch(url, { headers, signal: controller.signal });
    const json = await res.json().catch(() => null);
    return { status: res.status, json };
  } finally {
    clearTimeout(timer);
  }
}

function metaError(json: unknown, status: number): string {
  const e = (json as { error?: { message?: string; code?: number; error_subcode?: number } } | null)?.error;
  return e?.message ? `${e.message}${e.code ? ` (${e.code})` : ""}` : `HTTP ${status}`;
}

/**
 * Envia um modelo aprovado (única forma de escrever fora da janela de 24 h). `params` preenche {{1}}, {{2}}… do corpo,
 * na ordem.
 */
export async function sendWhatsappTemplate(to: string, template: { name: string; language: string; params: string[] }): Promise<ProviderResult> {
  const token = process.env.WHATSAPP_ACCESS_TOKEN;
  const phoneId = process.env.WHATSAPP_PHONE_NUMBER_ID;
  const digits = toInternationalDigits(to);
  if (!token || !phoneId) return { ok: false, error: "WhatsApp não configurado" };
  if (!digits) return { ok: false, error: "Telefone do destinatário ausente" };
  const components = template.params.length > 0 ? [{ type: "body", parameters: template.params.map((text) => ({ type: "text", text: text || "-" })) }] : [];
  try {
    const { status, json } = await post(`${GRAPH}/${encodeURIComponent(phoneId)}/messages`, { authorization: `Bearer ${token}` }, {
      messaging_product: "whatsapp",
      to: digits,
      type: "template",
      template: { name: template.name, language: { code: template.language }, components },
    });
    const id = (json as { messages?: { id?: string }[] } | null)?.messages?.[0]?.id;
    if (status >= 200 && status < 300 && id) return { ok: true, externalId: id };
    console.error(`[whatsapp] modelo recusado HTTP ${status}: ${metaError(json, status)}`);
    return { ok: false, error: metaError(json, status) };
  } catch (error) {
    console.error("[whatsapp] falha no envio do modelo", error);
    return { ok: false, error: "Falha de rede ao chamar a Meta" };
  }
}

/** Modelo como a Meta devolve (campos que o INTEROS usa). */
export interface MetaTemplate {
  id: string;
  name: string;
  language: string;
  status: string;
  category: string;
  rejected_reason?: string;
  quality_score?: { score?: string };
  components?: { type: string; text?: string; format?: string; buttons?: { type: string; text: string; url?: string }[] }[];
}

/** Lista os modelos da conta do WhatsApp Business (WHATSAPP_BUSINESS_ACCOUNT_ID). */
export async function listWhatsappTemplates(): Promise<{ ok: true; templates: MetaTemplate[] } | { ok: false; error: string }> {
  const token = process.env.WHATSAPP_ACCESS_TOKEN;
  const waba = process.env.WHATSAPP_BUSINESS_ACCOUNT_ID;
  if (!token || !waba) return { ok: false, error: "Falta WHATSAPP_BUSINESS_ACCOUNT_ID (ou o token) para ler os modelos da Meta" };
  const out: MetaTemplate[] = [];
  let url: string | null = `${GRAPH}/${encodeURIComponent(waba)}/message_templates?fields=id,name,language,status,category,rejected_reason,quality_score,components&limit=100`;
  try {
    for (let page = 0; url && page < 10; page++) {
      const { status, json }: { status: number; json: unknown } = await getJson(url, { authorization: `Bearer ${token}` });
      if (status < 200 || status >= 300) return { ok: false, error: metaError(json, status) };
      const body = json as { data?: MetaTemplate[]; paging?: { next?: string } } | null;
      out.push(...(body?.data ?? []));
      url = body?.paging?.next ?? null;
    }
    return { ok: true, templates: out };
  } catch (error) {
    console.error("[whatsapp] falha ao listar modelos", error);
    return { ok: false, error: "Falha de rede ao chamar a Meta" };
  }
}

/** Envia um modelo novo para análise da Meta. */
export async function createWhatsappTemplate(input: { name: string; language: string; category: "UTILITY" | "MARKETING"; body: string; examples: string[]; footer?: string }): Promise<{ ok: true; id: string; status: string } | { ok: false; error: string }> {
  const token = process.env.WHATSAPP_ACCESS_TOKEN;
  const waba = process.env.WHATSAPP_BUSINESS_ACCOUNT_ID;
  if (!token || !waba) return { ok: false, error: "Falta WHATSAPP_BUSINESS_ACCOUNT_ID (ou o token) para enviar o modelo à Meta" };
  const components: unknown[] = [{ type: "BODY", text: input.body, ...(input.examples.length ? { example: { body_text: [input.examples] } } : {}) }];
  if (input.footer) components.push({ type: "FOOTER", text: input.footer });
  try {
    const { status, json } = await post(`${GRAPH}/${encodeURIComponent(waba)}/message_templates`, { authorization: `Bearer ${token}` }, { name: input.name, language: input.language, category: input.category, components });
    const body = json as { id?: string; status?: string } | null;
    if (status >= 200 && status < 300 && body?.id) return { ok: true, id: body.id, status: body.status ?? "PENDING" };
    return { ok: false, error: metaError(json, status) };
  } catch (error) {
    console.error("[whatsapp] falha ao criar modelo", error);
    return { ok: false, error: "Falha de rede ao chamar a Meta" };
  }
}

export async function sendEmail(input: { to: string; subject: string; text: string }): Promise<ProviderResult> {
  const key = process.env.RESEND_API_KEY;
  const from = process.env.EMAIL_FROM;
  if (!key || !from) return { ok: false, error: "E-mail não configurado" };
  try {
    const { status, json } = await post("https://api.resend.com/emails", { authorization: `Bearer ${key}` }, { from, to: [input.to], subject: input.subject, text: input.text });
    const id = (json as { id?: string } | null)?.id;
    if (status >= 200 && status < 300 && id) return { ok: true, externalId: id };
    const message = (json as { message?: string } | null)?.message;
    console.error(`[email] Resend respondeu HTTP ${status}: ${message ?? "sem detalhe"}`);
    return { ok: false, error: message ?? `HTTP ${status}` };
  } catch (error) {
    console.error("[email] falha no envio", error);
    return { ok: false, error: "Falha de rede ao chamar o provedor de e-mail" };
  }
}
