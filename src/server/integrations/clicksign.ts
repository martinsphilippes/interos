import "server-only";
/**
 * Adaptador da Clicksign (API v3, "API do Envelope"). Tudo que é específico do provedor fica aqui.
 *
 * Documentação: https://developers.clicksign.com (Ambientes, autenticação e formato; Envelope; Documentos; Signatários;
 * Requisitos; Notificações; Webhooks). Pontos que valem para todo o arquivo:
 * - Hosts: sandbox.clicksign.com (testes, sem validade jurídica) e app.clicksign.com (produção). CLICKSIGN_ENV escolhe.
 * - Autenticação: header Authorization com o access token, SEM "Bearer". Formato JSON:API (application/vnd.api+json).
 * - Limite: 20 req/10 s no sandbox, 50 em produção. Resposta 429 ou 5xx → nova tentativa com espera crescente.
 * - Webhook: POST com header Content-Hmac "sha256=<hex>" = HMAC-SHA256(segredo, corpo bruto).
 *
 * Variáveis (nunca no repositório): CLICKSIGN_API_TOKEN, CLICKSIGN_WEBHOOK_SECRET e CLICKSIGN_ENV (sandbox | producao).
 */
import { createHash, createHmac, timingSafeEqual } from "node:crypto";
import { classifyClicksignWebhooks, type ClicksignConnectionCheck, type ClicksignEnv, type ClicksignTokenCheck, type ClicksignWebhookInfo } from "@/domain/clicksign-connection";

function env(name: string): string | undefined {
  return process.env[name]?.trim() || undefined;
}

export type { ClicksignEnv };

export function clicksignEnv(): ClicksignEnv {
  return env("CLICKSIGN_ENV")?.toLowerCase().startsWith("prod") ? "producao" : "sandbox";
}

export function clicksignHost(e: ClicksignEnv = clicksignEnv()): string {
  return e === "producao" ? "https://app.clicksign.com" : "https://sandbox.clicksign.com";
}

export function clicksignConfigured(): boolean {
  return Boolean(env("CLICKSIGN_API_TOKEN"));
}

export class ClicksignError extends Error {
  constructor(
    message: string,
    readonly status: number,
  ) {
    super(message);
    this.name = "ClicksignError";
  }
}

const RETRIES = 3;
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/** Mensagem de erro da Clicksign (JSON:API: errors[].detail/title) em uma linha. */
function errorMessage(body: unknown, status: number): string {
  const errors = (body as { errors?: { detail?: string; title?: string; source?: { pointer?: string } }[] } | null)?.errors;
  const text = errors
    ?.map((e) => [e.title, e.detail].filter(Boolean).join(": ") + (e.source?.pointer ? ` (${e.source.pointer.replace("/data/attributes/", "")})` : ""))
    .filter(Boolean)
    .join(" · ");
  return text ? `Clicksign: ${text}` : `Clicksign respondeu ${status}`;
}

interface JsonApiResource {
  id: string;
  type: string;
  attributes?: Record<string, unknown>;
  links?: { self?: string; files?: { original?: string; signed?: string; ziped?: string } };
}

/**
 * Chamada à API v3. Repete em 429/5xx (até 3 vezes, espera crescente; a Clicksign responde sem gravar nesses casos);
 * tempo-limite/falha de rede repete tudo menos POST (criação/e-mail não são repetidos às cegas). Erro do provedor vira
 * ClicksignError legível.
 */
export async function clicksignApi<T = { data: JsonApiResource }>(
  path: string,
  init: { method?: string; body?: unknown; /** Novas tentativas (padrão 3). */ retries?: number; /** Tempo-limite de cada chamada (padrão 20 s). */ timeoutMs?: number } = {},
): Promise<T> {
  const token = env("CLICKSIGN_API_TOKEN");
  if (!token) throw new ClicksignError("Clicksign não configurada (CLICKSIGN_API_TOKEN)", 0);
  const url = `${clicksignHost()}/api/v3${path}`;
  const method = init.method ?? "GET";
  const retries = init.retries ?? RETRIES;
  let lastError: unknown;
  for (let attempt = 0; attempt <= retries; attempt++) {
    try {
      const res = await fetch(url, {
        method,
        headers: { Authorization: token, Accept: "application/vnd.api+json", "Content-Type": "application/vnd.api+json" },
        body: init.body === undefined ? undefined : JSON.stringify(init.body),
        cache: "no-store",
        signal: AbortSignal.timeout(init.timeoutMs ?? 20_000),
      });
      if (res.status === 429 || res.status >= 500) {
        lastError = new ClicksignError(`Clicksign respondeu ${res.status}`, res.status);
        if (attempt < retries) {
          const reset = Number(res.headers.get("x-rate-limit-reset"));
          const wait = res.status === 429 && reset ? Math.min(10_000, Math.max(500, reset * 1000 - Date.now())) : 500 * 2 ** attempt;
          await sleep(wait + Math.floor(Math.random() * 200));
          continue;
        }
        throw lastError;
      }
      const text = await res.text();
      const body = text ? (JSON.parse(text) as unknown) : null;
      if (!res.ok) throw new ClicksignError(errorMessage(body, res.status), res.status);
      return body as T;
    } catch (error) {
      if (error instanceof ClicksignError) throw error;
      lastError = error;
      // Tempo-limite ou falha de rede: repete só o que pode ser repetido sem efeito duplicado (leitura e mudança de
      // estado: PATCH/DELETE/PUT). POST (criar envelope, documento, signatário, requisito, e-mail) pode ter dado certo
      // do lado da Clicksign mesmo sem resposta; repetir criaria duplicado.
      if (method === "POST") throw new ClicksignError(`Clicksign não respondeu a tempo (${error instanceof Error ? error.message : "falha de rede"}). Confira na Clicksign antes de tentar de novo.`, 0);
      if (attempt < retries) {
        await sleep(500 * 2 ** attempt);
        continue;
      }
    }
  }
  throw lastError instanceof Error ? new ClicksignError(`Clicksign indisponível: ${lastError.message}`, 0) : new ClicksignError("Clicksign indisponível", 0);
}

// ---------------------------------------------------------------------------
// Envelope, documento, signatários, requisitos
// ---------------------------------------------------------------------------

export interface EnvelopeInput {
  name: string;
  /** Lembrete automático por e-mail a cada N dias (1, 2, 3, 7, 14) ou nenhum. */
  remindInterval?: 1 | 2 | 3 | 7 | 14 | null;
  defaultSubject?: string;
  defaultMessage?: string;
  /** Data limite (ISO). Sem ela, vale o padrão da Clicksign. */
  deadlineAt?: string;
}

export async function createEnvelope(input: EnvelopeInput): Promise<string> {
  const r = await clicksignApi("/envelopes", {
    method: "POST",
    body: {
      data: {
        type: "envelopes",
        attributes: {
          name: input.name.slice(0, 255),
          locale: "pt-BR",
          auto_close: true,
          remind_interval: input.remindInterval === null ? "null" : String(input.remindInterval ?? 3),
          block_after_refusal: true,
          // Prazo vencido com assinatura parcial: cancela (o padrão da Clicksign finalizaria sem todas as assinaturas).
          deadline_partial_signature_action: "canceled",
          ...(input.defaultSubject ? { default_subject: input.defaultSubject.slice(0, 255) } : {}),
          ...(input.defaultMessage ? { default_message: input.defaultMessage } : {}),
          ...(input.deadlineAt ? { deadline_at: input.deadlineAt } : {}),
        },
      },
    },
  });
  return r.data.id;
}

/** Documento por upload (PDF ou Word). `metadata` volta nos webhooks: é como o INTEROS reconhece o contrato. */
export async function addDocument(envelopeId: string, input: { filename: string; mimeType: string; content: Buffer; metadata: Record<string, string> }): Promise<string> {
  const r = await clicksignApi(`/envelopes/${envelopeId}/documents`, {
    method: "POST",
    body: {
      data: {
        type: "documents",
        attributes: {
          filename: input.filename,
          content_base64: `data:${input.mimeType};base64,${input.content.toString("base64")}`,
          metadata: input.metadata,
        },
      },
    },
  });
  return r.data.id;
}

export interface SignerInput {
  name: string;
  email: string;
  /** DDD + número, sem DDI (obrigatório para código por SMS/WhatsApp). */
  phone?: string;
  /** Pedir CPF e data de nascimento na assinatura (padrão da Clicksign). */
  hasDocumentation?: boolean;
}

export async function addSigner(envelopeId: string, input: SignerInput): Promise<string> {
  const r = await clicksignApi(`/envelopes/${envelopeId}/signers`, {
    method: "POST",
    body: {
      data: {
        type: "signers",
        attributes: {
          name: input.name,
          email: input.email,
          ...(input.phone ? { phone_number: input.phone } : {}),
          has_documentation: input.hasDocumentation ?? true,
          refusable: true,
          communicate_events: { signature_request: "email", signature_reminder: "email", document_signed: "email" },
        },
      },
    },
  });
  return r.data.id;
}

function relationships(documentId: string, signerId: string) {
  return { document: { data: { type: "documents", id: documentId } }, signer: { data: { type: "signers", id: signerId } } };
}

/** Qualificação: em que papel a pessoa assina (contratante, contratada, testemunha, parte…). */
export async function addQualification(envelopeId: string, documentId: string, signerId: string, role: string): Promise<void> {
  await clicksignApi(`/envelopes/${envelopeId}/requirements`, { method: "POST", body: { data: { type: "requirements", attributes: { action: "agree", role }, relationships: relationships(documentId, signerId) } } });
}

/** Autenticação: como a pessoa prova quem é (código por e-mail, SMS, WhatsApp, certificado ICP-Brasil…). */
export async function addAuthentication(envelopeId: string, documentId: string, signerId: string, auth: string): Promise<void> {
  await clicksignApi(`/envelopes/${envelopeId}/requirements`, { method: "POST", body: { data: { type: "requirements", attributes: { action: "provide_evidence", auth }, relationships: relationships(documentId, signerId) } } });
}

/** Ativa o envelope (de rascunho para em andamento). Cada signatário precisa de pelo menos uma autenticação. */
export async function activateEnvelope(envelopeId: string): Promise<void> {
  await clicksignApi(`/envelopes/${envelopeId}`, { method: "PATCH", body: { data: { id: envelopeId, type: "envelopes", attributes: { status: "running" } } } });
}

/** Envia o pedido de assinatura a todos os signatários do envelope. */
export async function notifyEnvelope(envelopeId: string, message?: string): Promise<void> {
  await clicksignApi(`/envelopes/${envelopeId}/notifications`, { method: "POST", body: { data: { type: "notifications", attributes: message ? { message } : {} } } });
}

/** Lembrete para um signatário. */
export async function notifySigner(envelopeId: string, signerId: string, message?: string): Promise<void> {
  await clicksignApi(`/envelopes/${envelopeId}/signers/${signerId}/notifications`, { method: "POST", body: { data: { type: "notifications", attributes: message ? { message } : {} } } });
}

export interface ClicksignDocument {
  id: string;
  status: string;
  filename?: string;
  /** Links temporários (alguns minutos) do arquivo original e do assinado (quando finalizado). */
  files: { original?: string; signed?: string; ziped?: string };
}

export async function getDocument(envelopeId: string, documentId: string): Promise<ClicksignDocument> {
  const r = await clicksignApi(`/envelopes/${envelopeId}/documents/${documentId}`);
  return { id: r.data.id, status: String(r.data.attributes?.status ?? ""), filename: r.data.attributes?.filename as string | undefined, files: r.data.links?.files ?? {} };
}

/** Cancela um documento em andamento (ex.: o contrato ganhou nova versão e o documento antigo não vale mais). */
export async function cancelDocument(envelopeId: string, documentId: string): Promise<void> {
  await clicksignApi(`/envelopes/${envelopeId}/documents/${documentId}`, { method: "PATCH", body: { data: { id: documentId, type: "documents", attributes: { status: "canceled" } } } });
}

// ---------------------------------------------------------------------------
// Conferência da conexão (botão «Testar conexão»)
// ---------------------------------------------------------------------------

/** Conferência rápida: o usuário espera a resposta na tela, então tenta de novo uma vez só e com prazo menor. */
const CHECK_CALL = { retries: 1, timeoutMs: 10_000 } as const;
const WEBHOOK_PAGES = 5;
const WEBHOOK_PAGE_SIZE = 20;

/** Compara segredos sem vazar o tamanho nem o conteúdo pelo tempo de resposta. */
function sameSecret(a: string, b: string): boolean {
  const ha = createHash("sha256").update(a, "utf8").digest();
  const hb = createHash("sha256").update(b, "utf8").digest();
  return timingSafeEqual(ha, hb);
}

/** Webhooks cadastrados na conta. O segredo de cada um nunca sai daqui: vira só "confere / não confere". */
async function listClicksignWebhooks(): Promise<ClicksignWebhookInfo[]> {
  const ours = env("CLICKSIGN_WEBHOOK_SECRET");
  const hooks: ClicksignWebhookInfo[] = [];
  for (let page = 1; page <= WEBHOOK_PAGES; page++) {
    const r = await clicksignApi<{ data?: JsonApiResource[]; meta?: { record_count?: number } }>(`/webhooks?page%5Bnumber%5D=${page}&page%5Bsize%5D=${WEBHOOK_PAGE_SIZE}`, CHECK_CALL);
    const data = Array.isArray(r?.data) ? r.data : [];
    for (const item of data) {
      const a = item.attributes ?? {};
      const theirs = typeof a.secret === "string" && a.secret ? a.secret : undefined;
      hooks.push({
        endpoint: typeof a.endpoint === "string" ? a.endpoint : "",
        status: typeof a.status === "string" ? a.status : "",
        events: Array.isArray(a.events) ? a.events.filter((e): e is string => typeof e === "string") : [],
        secretMatches: ours && theirs ? sameSecret(ours, theirs) : null,
      });
    }
    const total = r?.meta?.record_count;
    if (data.length < WEBHOOK_PAGE_SIZE || (typeof total === "number" && hooks.length >= total)) break;
  }
  return hooks;
}

function tokenProblem(error: unknown, e: ClicksignEnv): ClicksignTokenCheck {
  const status = error instanceof ClicksignError ? error.status : 0;
  if (status === 401 || status === 403) {
    const other = e === "producao" ? "testes" : "produção";
    return {
      ok: false,
      problem: "recusado",
      message: `A Clicksign recusou a chave da API (${status}). Ela pode ter sido apagada, estar incompleta ou ser do ambiente de ${other}. Crie um token novo na Clicksign (Configurações › API), troque CLICKSIGN_API_TOKEN na Vercel e publique de novo.`,
    };
  }
  return { ok: false, problem: "indisponivel", message: error instanceof Error ? error.message : "Clicksign indisponível" };
}

/**
 * Testa a chave da API (lista 1 envelope, só leitura) e confere os webhooks da conta: o do INTEROS (ativo, eventos,
 * segredo igual ao da Vercel, domínio) e os de outros serviços (ex.: Pluga). `expectedHost` = domínio deste INTEROS.
 */
export async function checkClicksignConnection(expectedHost?: string | null): Promise<ClicksignConnectionCheck> {
  const e = clicksignEnv();
  const checkedAt = new Date().toISOString();
  if (!clicksignConfigured()) {
    return { env: e, checkedAt, token: { ok: false, problem: "sem_token", message: "Sem token da API (CLICKSIGN_API_TOKEN) na Vercel." }, webhooks: null };
  }
  const [envelopes, hooks] = await Promise.allSettled([clicksignApi(`/envelopes?page%5Bsize%5D=1`, CHECK_CALL), listClicksignWebhooks()]);
  if (envelopes.status === "rejected") return { env: e, checkedAt, token: tokenProblem(envelopes.reason, e), webhooks: null };
  const webhooks =
    hooks.status === "fulfilled"
      ? classifyClicksignWebhooks(hooks.value, expectedHost)
      : { error: hooks.reason instanceof Error ? hooks.reason.message : "Não foi possível ler os webhooks da Clicksign" };
  return { env: e, checkedAt, token: { ok: true }, webhooks };
}

// ---------------------------------------------------------------------------
// Webhook
// ---------------------------------------------------------------------------

/** Content-Hmac: "sha256=<hex>" do HMAC-SHA256 do corpo bruto com o segredo do webhook. */
export function clicksignSignatureValid(rawBody: string, header: string | null, secret: string | undefined): boolean {
  if (!secret || !header) return false;
  const given = header.trim().replace(/^sha256=/i, "");
  const expected = createHmac("sha256", secret).update(rawBody, "utf8").digest("hex");
  const a = Buffer.from(given, "utf8");
  const b = Buffer.from(expected, "utf8");
  return a.length === b.length && timingSafeEqual(a, b);
}

export interface ClicksignWebhookSigner {
  key?: string;
  name: string;
  email: string;
  documentation?: string;
}

export interface ClicksignWebhook {
  event: string;
  occurredAt?: string;
  documentKey?: string;
  filename?: string;
  documentStatus?: string;
  finishedAt?: string;
  metadata: Record<string, string>;
  signers: ClicksignWebhookSigner[];
  /** Quem assinou ou recusou (eventos sign e refusal). */
  signer?: ClicksignWebhookSigner;
  refusal?: { reasons: string[]; comment?: string };
  /** Link do arquivo assinado, quando vem completo no aviso. */
  signedFileUrl?: string;
}

function str(v: unknown): string | undefined {
  return typeof v === "string" && v.trim() ? v.trim() : undefined;
}

function signerOf(v: unknown): ClicksignWebhookSigner | undefined {
  if (!v || typeof v !== "object") return undefined;
  const s = v as Record<string, unknown>;
  const email = str(s.email);
  if (!email) return undefined;
  return { key: str(s.key), name: str(s.name) ?? email, email: email.toLowerCase(), documentation: str(s.documentation) };
}

/** Lê o aviso da Clicksign (formato do evento + documento; campos novos podem aparecer e são ignorados). */
export function parseClicksignWebhook(body: unknown, eventHeader?: string | null): ClicksignWebhook | null {
  if (!body || typeof body !== "object") return null;
  const b = body as Record<string, unknown>;
  const ev = (b.event ?? {}) as Record<string, unknown>;
  const name = str(ev.name) ?? str(eventHeader ?? undefined);
  if (!name) return null;
  const data = (ev.data ?? {}) as Record<string, unknown>;
  // "document" às vezes vem como lista com um item.
  const rawDoc = Array.isArray(b.document) ? b.document[0] : b.document;
  const doc = (rawDoc && typeof rawDoc === "object" ? rawDoc : {}) as Record<string, unknown>;
  let metadata: Record<string, string> = {};
  const md = doc.metadata;
  if (md && typeof md === "object") metadata = Object.fromEntries(Object.entries(md as Record<string, unknown>).filter(([, v]) => typeof v === "string" || typeof v === "number").map(([k, v]) => [k, String(v)]));
  else if (typeof md === "string") {
    try {
      const parsed = JSON.parse(md) as Record<string, unknown>;
      metadata = Object.fromEntries(Object.entries(parsed).map(([k, v]) => [k, String(v)]));
    } catch {
      metadata = {};
    }
  }
  const downloads = (doc.downloads ?? {}) as Record<string, unknown>;
  const signedUrl = str(downloads.signed_file_url);
  const refusal = data.refusal as { reasons?: unknown; comment?: unknown } | undefined;
  return {
    event: name,
    occurredAt: str(ev.occurred_at),
    documentKey: str(doc.key) ?? str(doc.id),
    filename: str(doc.filename),
    documentStatus: str(doc.status),
    finishedAt: str(doc.finished_at),
    metadata,
    signers: (Array.isArray(doc.signers) ? doc.signers : []).map(signerOf).filter((s): s is ClicksignWebhookSigner => Boolean(s)),
    signer: signerOf(data.signer),
    refusal: refusal ? { reasons: Array.isArray(refusal.reasons) ? refusal.reasons.map(String) : [], comment: str(refusal.comment) } : undefined,
    signedFileUrl: signedUrl && /^https:\/\//.test(signedUrl) ? signedUrl : undefined,
  };
}
