import "server-only";
/**
 * Cliente HTTP do ERP Intercert (servidor a servidor). Uma função para as três famílias de API: escolhe a credencial,
 * envia `X-Request-Id` (rastreio nos dois lados), `Idempotency-Key`/`If-Match`/assinatura quando pedidos, aplica tempo
 * limite e traduz o envelope de cada família:
 * - licencas: `{ data, meta }` e `{ error: { code, message, details }, meta }`;
 * - provisionamento/torre: corpo direto e `{ erro: { codigo, mensagem, campos }, requestId }`.
 * Falhas viram `ErpError` com o código do contrato. Repetição automática só quando o chamador pede (`retries`) e só
 * em falha temporária: a decisão de repetir escritas fica com quem guarda a chave de idempotência.
 */
import { randomBytes } from "node:crypto";
import { getErpConfig, type ErpApi, type ErpConfig } from "./config";
import { ErpError, type ErpFieldError } from "./errors";
import { signBody } from "./signature";

export type ErpQueryValue = string | number | boolean | readonly string[] | null | undefined;

export interface ErpRequest {
  api: ErpApi;
  method: "GET" | "POST" | "PUT";
  /** Caminho a partir da origem do ERP (ex.: `/api/interos/v1/catalog`). */
  path: string;
  query?: Record<string, ErpQueryValue>;
  body?: unknown;
  idempotencyKey?: string;
  ifMatch?: string | number;
  /** Quem pediu a alteração (e-mail ou id da pessoa no INTEROS). */
  actor?: string;
  /** Evento de escrita assinada (licenças v2). */
  eventId?: string;
  /** Assina o corpo com o segredo das licenças (`X-Interos-Signature`). */
  sign?: boolean;
  timeoutMs?: number;
  requestId?: string;
  /** Repetições em falha temporária (rede, 5xx, 429, operação em andamento). Padrão: 1 em GET, 0 nas escritas. */
  retries?: number;
  /** Configuração explícita (testes e scripts); sem ela, lê as variáveis de ambiente. */
  config?: ErpConfig;
}

export interface ErpResponse<T> {
  status: number;
  data: T;
  meta: Record<string, unknown> | null;
  requestId: string;
  etag: string | null;
  /** `Idempotent-Replayed: true`: resposta guardada de uma solicitação já concluída. */
  replayed: boolean;
  durationMs: number;
}

export type ErpFetch = (url: string, init: RequestInit) => Promise<Response>;

let fetchImpl: ErpFetch = (url, init) => fetch(url, init);

/** Troca o fetch (testes e o servidor falso de homologação). */
export function setErpFetch(next: ErpFetch | null): void {
  fetchImpl = next ?? ((url, init) => fetch(url, init));
}

const DEFAULT_TIMEOUT_MS = 25_000;
const MAX_RETRY_WAIT_MS = 2_000;

export function newRequestId(): string {
  return `itr_${randomBytes(12).toString("hex")}`;
}

function credentialFor(api: ErpApi, config: ErpConfig): string | null {
  if (api === "licencas") return config.licenseToken;
  if (api === "provisionamento") return config.provisioningCredential;
  return config.towerCredential;
}

export function buildErpUrl(baseUrl: string, path: string, query?: Record<string, ErpQueryValue>): string {
  const url = new URL(path, `${baseUrl}/`);
  for (const [key, value] of Object.entries(query ?? {})) {
    if (value === undefined || value === null || value === "") continue;
    if (Array.isArray(value)) for (const v of value) url.searchParams.append(key, String(v));
    else url.searchParams.set(key, String(value));
  }
  return url.toString();
}

interface ParsedBody {
  json: unknown;
  isJson: boolean;
}

async function readBody(response: Response): Promise<ParsedBody> {
  const text = await response.text();
  if (!text) return { json: null, isJson: false };
  try {
    return { json: JSON.parse(text), isJson: true };
  } catch {
    return { json: text.slice(0, 300), isJson: false };
  }
}

const asRecord = (value: unknown): Record<string, unknown> | null => (value && typeof value === "object" && !Array.isArray(value) ? (value as Record<string, unknown>) : null);

function retryAfterMs(response: Response): number | null {
  const raw = response.headers.get("retry-after");
  if (!raw) return null;
  const seconds = Number(raw);
  if (Number.isFinite(seconds)) return Math.max(0, seconds * 1000);
  const at = Date.parse(raw);
  return Number.isFinite(at) ? Math.max(0, at - Date.now()) : null;
}

/** Erro a partir de uma resposta não 2xx, no envelope da família. */
function errorFrom(api: ErpApi, response: Response, parsed: ParsedBody, requestId: string): ErpError {
  const body = asRecord(parsed.json);
  const retryAfter = retryAfterMs(response);
  const envelopeLicense = asRecord(body?.error);
  if (envelopeLicense) {
    return new ErpError({
      api,
      status: response.status,
      code: String(envelopeLicense.code ?? `http_${response.status}`),
      message: String(envelopeLicense.message ?? `O ERP respondeu ${response.status}.`),
      details: envelopeLicense.details ?? null,
      requestId: String(asRecord(body?.meta)?.requestId ?? requestId),
      retryAfterMs: retryAfter,
    });
  }
  const envelopeProvisioning = asRecord(body?.erro);
  if (envelopeProvisioning) {
    const campos = Array.isArray(envelopeProvisioning.campos) ? envelopeProvisioning.campos : [];
    const fields: ErpFieldError[] = campos
      .map((c) => asRecord(c))
      .filter((c): c is Record<string, unknown> => Boolean(c))
      .map((c) => ({ field: String(c.campo ?? ""), message: String(c.mensagem ?? "") }));
    const { codigo, mensagem, campos: _campos, ...rest } = envelopeProvisioning;
    void _campos;
    return new ErpError({
      api,
      status: response.status,
      code: String(codigo ?? `http_${response.status}`),
      message: String(mensagem ?? `O ERP respondeu ${response.status}.`),
      details: Object.keys(rest).length ? rest : null,
      fields,
      requestId: String(body?.requestId ?? requestId),
      retryAfterMs: retryAfter,
    });
  }
  return new ErpError({
    api,
    status: response.status,
    code: `http_${response.status}`,
    message: response.status === 404 ? "O ERP não tem esta rota (versão do contrato diferente?)." : `O ERP respondeu ${response.status} sem o envelope do contrato.`,
    details: parsed.isJson ? parsed.json : null,
    requestId,
    retryAfterMs: retryAfter,
  });
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * Executa uma chamada ao ERP. Lança `ErpError` (inclusive `not_configured` sem URL/credencial, sem chamar a rede).
 */
export async function erpRequest<T>(request: ErpRequest): Promise<ErpResponse<T>> {
  const config = request.config ?? getErpConfig();
  const requestId = request.requestId ?? newRequestId();
  if (!config) throw new ErpError({ api: request.api, status: 0, code: "not_configured", message: "Integração com o ERP não configurada (URL ou ambiente ausentes).", requestId, kind: "not_configured" });
  const credential = credentialFor(request.api, config);
  if (!credential) throw new ErpError({ api: request.api, status: 0, code: "not_configured", message: "Credencial desta API do ERP não configurada.", requestId, kind: "not_configured" });
  if (request.sign && !config.licenseSigningSecret) {
    throw new ErpError({ api: request.api, status: 0, code: "not_configured", message: "Segredo de assinatura das licenças não configurado.", requestId, kind: "not_configured" });
  }

  const url = buildErpUrl(config.baseUrl, request.path, request.query);
  const bodyText = request.body === undefined ? undefined : JSON.stringify(request.body);
  const retries = request.retries ?? (request.method === "GET" ? 1 : 0);

  for (let attempt = 0; ; attempt += 1) {
    const headers: Record<string, string> = {
      authorization: `Bearer ${credential}`,
      accept: "application/json",
      "x-request-id": requestId,
    };
    if (bodyText !== undefined) headers["content-type"] = "application/json";
    if (request.idempotencyKey) headers["idempotency-key"] = request.idempotencyKey;
    if (request.ifMatch !== undefined) headers["if-match"] = `"${String(request.ifMatch).replace(/"/g, "")}"`;
    if (request.actor) headers["x-interos-actor"] = request.actor;
    if (request.eventId) headers["x-interos-event-id"] = request.eventId;
    // Assinatura recalculada a cada tentativa: o ERP aceita só ±5 minutos.
    if (request.sign && config.licenseSigningSecret) headers["x-interos-signature"] = signBody(config.licenseSigningSecret, bodyText ?? "");

    const started = Date.now();
    let response: Response;
    try {
      response = await fetchImpl(url, {
        method: request.method,
        headers,
        body: bodyText,
        cache: "no-store",
        redirect: "error",
        signal: AbortSignal.timeout(request.timeoutMs ?? DEFAULT_TIMEOUT_MS),
      });
    } catch (cause) {
      const timeout = cause instanceof Error && (cause.name === "TimeoutError" || cause.name === "AbortError");
      const error = new ErpError({
        api: request.api,
        status: 0,
        code: timeout ? "timeout" : "network",
        message: timeout ? "O ERP não respondeu no tempo limite." : "Não foi possível falar com o ERP (rede).",
        requestId,
      });
      console.warn(`[erp] ${request.api} ${request.method} ${request.path} ${error.code} ${Date.now() - started}ms req=${requestId}`);
      if (attempt < retries) {
        await sleep(Math.min(MAX_RETRY_WAIT_MS, 300 * 2 ** attempt));
        continue;
      }
      throw error;
    }

    const parsed = await readBody(response);
    const durationMs = Date.now() - started;
    const echoedId = response.headers.get("x-request-id") ?? requestId;
    console.info(`[erp] ${request.api} ${request.method} ${request.path} ${response.status} ${durationMs}ms req=${echoedId}`);

    if (response.ok) {
      const body = asRecord(parsed.json);
      const isLicenseEnvelope = request.api === "licencas" && body !== null && "data" in body;
      return {
        status: response.status,
        data: (isLicenseEnvelope ? body.data : parsed.json) as T,
        meta: isLicenseEnvelope ? asRecord(body.meta) : null,
        requestId: echoedId,
        etag: response.headers.get("etag"),
        replayed: response.headers.get("idempotent-replayed") === "true",
        durationMs,
      };
    }

    const error = errorFrom(request.api, response, parsed, echoedId);
    if (error.retryable && attempt < retries) {
      await sleep(Math.min(MAX_RETRY_WAIT_MS, error.retryAfterMs ?? 300 * 2 ** attempt));
      continue;
    }
    throw error;
  }
}
