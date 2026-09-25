import "server-only";
/**
 * Provedor de IA: API Messages da Anthropic via fetch (sem SDK, para não adicionar dependência).
 * Sem ANTHROPIC_API_KEY devolve null e o sistema usa só as regras determinísticas.
 *
 * Modelo: process.env.INTEROS_AI_MODEL (padrão "claude-sonnet-5").
 */

const API_URL = "https://api.anthropic.com/v1/messages";
const API_VERSION = "2023-06-01";
const DEFAULT_MODEL = "claude-sonnet-5";
const TIMEOUT_MS = 30_000;

export function isLlmAvailable(): boolean {
  return Boolean(process.env.ANTHROPIC_API_KEY);
}

export function llmModel(): string {
  return process.env.INTEROS_AI_MODEL || DEFAULT_MODEL;
}

export interface LlmRequest {
  system: string;
  prompt: string;
  maxTokens?: number;
}

export interface LlmResponse {
  text: string;
  model: string;
}

interface MessagesResponse {
  model?: string;
  stop_reason?: string;
  content?: { type: string; text?: string }[];
}

/** Uma chamada à API Messages; null quando indisponível, recusada ou com erro (o chamador segue sem IA). */
export async function completeWithLlm(request: LlmRequest): Promise<LlmResponse | null> {
  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) return null;
  const model = llmModel();
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);
  try {
    const res = await fetch(API_URL, {
      method: "POST",
      headers: { "content-type": "application/json", "x-api-key": apiKey, "anthropic-version": API_VERSION },
      body: JSON.stringify({
        model,
        max_tokens: request.maxTokens ?? 4000,
        system: request.system,
        messages: [{ role: "user", content: request.prompt }],
      }),
      signal: controller.signal,
    });
    if (!res.ok) {
      console.error(`[ia] API Messages respondeu HTTP ${res.status}: ${(await res.text()).slice(0, 300)}`);
      return null;
    }
    const data = (await res.json()) as MessagesResponse;
    if (data.stop_reason === "refusal") return null;
    const text = (data.content ?? [])
      .filter((b) => b.type === "text" && typeof b.text === "string")
      .map((b) => b.text)
      .join("\n")
      .trim();
    return text ? { text, model: data.model ?? model } : null;
  } catch (error) {
    console.error("[ia] falha ao chamar a API Messages", error instanceof Error ? error.message : error);
    return null;
  } finally {
    clearTimeout(timer);
  }
}
