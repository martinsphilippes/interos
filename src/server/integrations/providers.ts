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
