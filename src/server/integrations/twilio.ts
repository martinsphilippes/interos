import "server-only";
/**
 * Adaptador de telefonia: Twilio Programmable Voice (provedor sugerido; a escolha final é da empresa). Tudo que é
 * específico do provedor fica aqui — trocar de provedor = outro adaptador com as mesmas funções.
 *
 * Variáveis (nunca no repositório): TWILIO_ACCOUNT_SID, TWILIO_AUTH_TOKEN (assinatura dos avisos e API REST),
 * TWILIO_API_KEY_SID + TWILIO_API_KEY_SECRET (token do softphone no navegador), TWILIO_TWIML_APP_SID (aplicativo de voz
 * que aponta para /api/voice/outgoing) e TWILIO_CALLER_ID (bina das ligações feitas, quando o PABX não tem número).
 */
import { createHmac, timingSafeEqual } from "node:crypto";

const API = "https://api.twilio.com/2010-04-01";
const TOKEN_TTL_S = 3600;

function env(name: string): string | undefined {
  return process.env[name]?.trim() || undefined;
}

export function twilioConfigured(): boolean {
  return Boolean(env("TWILIO_ACCOUNT_SID") && env("TWILIO_AUTH_TOKEN") && env("TWILIO_API_KEY_SID") && env("TWILIO_API_KEY_SECRET") && env("TWILIO_TWIML_APP_SID"));
}

export function defaultCallerId(): string | undefined {
  return env("TWILIO_CALLER_ID");
}

function b64url(input: Buffer | string): string {
  return Buffer.from(input).toString("base64").replace(/=+$/, "").replace(/\+/g, "-").replace(/\//g, "_");
}

/**
 * Token de acesso do softphone (JWT HS256 assinado com a API Key): identidade = id do usuário, recebe ligações
 * («incoming») e liga pelo aplicativo de voz («outgoing»). Vale 1 h; o softphone renova antes de expirar.
 */
export function voiceAccessToken(identity: string, now: number = Date.now()): { token: string; expiresAt: string } | null {
  const accountSid = env("TWILIO_ACCOUNT_SID");
  const keySid = env("TWILIO_API_KEY_SID");
  const keySecret = env("TWILIO_API_KEY_SECRET");
  const appSid = env("TWILIO_TWIML_APP_SID");
  if (!accountSid || !keySid || !keySecret || !appSid) return null;
  const iat = Math.floor(now / 1000);
  const header = { typ: "JWT", alg: "HS256", cty: "twilio-fpa;v=1" };
  const payload = {
    jti: `${keySid}-${iat}`,
    iss: keySid,
    sub: accountSid,
    iat,
    nbf: iat,
    exp: iat + TOKEN_TTL_S,
    grants: { identity, voice: { incoming: { allow: true }, outgoing: { application_sid: appSid } } },
  };
  const unsigned = `${b64url(JSON.stringify(header))}.${b64url(JSON.stringify(payload))}`;
  const signature = b64url(createHmac("sha256", keySecret).update(unsigned).digest());
  return { token: `${unsigned}.${signature}`, expiresAt: new Date((iat + TOKEN_TTL_S) * 1000).toISOString() };
}

/**
 * Assinatura do aviso da Twilio (X-Twilio-Signature): HMAC-SHA1, com o Auth Token, da URL completa seguida dos
 * parâmetros do formulário em ordem alfabética (nome+valor), em base64.
 */
export function twilioSignatureValid(url: string, params: Record<string, string>, signature: string | null, authToken: string | undefined = env("TWILIO_AUTH_TOKEN")): boolean {
  if (!signature || !authToken) return false;
  const data = url + Object.keys(params).sort().map((k) => `${k}${params[k]}`).join("");
  const expected = createHmac("sha1", authToken).update(data, "utf8").digest("base64");
  const a = Buffer.from(signature);
  const b = Buffer.from(expected);
  return a.length === b.length && timingSafeEqual(a, b);
}

function basicAuth(): string | null {
  const sid = env("TWILIO_ACCOUNT_SID");
  const token = env("TWILIO_AUTH_TOKEN");
  return sid && token ? `Basic ${Buffer.from(`${sid}:${token}`).toString("base64")}` : null;
}

/** Redireciona uma ligação em andamento para novas instruções (transferência). */
export async function redirectCall(callSid: string, twiml: string): Promise<{ ok: boolean; error?: string }> {
  const auth = basicAuth();
  const sid = env("TWILIO_ACCOUNT_SID");
  if (!auth || !sid) return { ok: false, error: "Telefonia não configurada" };
  try {
    const res = await fetch(`${API}/Accounts/${sid}/Calls/${encodeURIComponent(callSid)}.json`, {
      method: "POST",
      headers: { authorization: auth, "content-type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({ Twiml: twiml }).toString(),
    });
    if (res.ok) return { ok: true };
    const body = (await res.json().catch(() => null)) as { message?: string } | null;
    return { ok: false, error: body?.message ?? `HTTP ${res.status}` };
  } catch (error) {
    console.error("[twilio] falha ao redirecionar ligação", error);
    return { ok: false, error: "Falha de rede ao chamar a Twilio" };
  }
}

/** Áudio da gravação (mp3), para o INTEROS servir com controle de acesso. */
export async function fetchRecording(recordingSid: string): Promise<Response | null> {
  const auth = basicAuth();
  const sid = env("TWILIO_ACCOUNT_SID");
  if (!auth || !sid) return null;
  const res = await fetch(`${API}/Accounts/${sid}/Recordings/${encodeURIComponent(recordingSid)}.mp3`, { headers: { authorization: auth } });
  return res.ok ? res : null;
}

/** Apaga a gravação no provedor (prazo da política de gravação). */
export async function deleteRecording(recordingSid: string): Promise<boolean> {
  const auth = basicAuth();
  const sid = env("TWILIO_ACCOUNT_SID");
  if (!auth || !sid) return false;
  const res = await fetch(`${API}/Accounts/${sid}/Recordings/${encodeURIComponent(recordingSid)}.json`, { method: "DELETE", headers: { authorization: auth } });
  return res.ok || res.status === 404;
}

// ---------------------------------------------------------------------------
// Supervisão de ligações (fase 4): conferência sob demanda
// ---------------------------------------------------------------------------

async function api<T>(path: string, init?: { method?: string; form?: Record<string, string> }): Promise<{ ok: true; data: T } | { ok: false; error: string }> {
  const auth = basicAuth();
  const sid = env("TWILIO_ACCOUNT_SID");
  if (!auth || !sid) return { ok: false, error: "Telefonia não configurada" };
  try {
    const res = await fetch(`${API}/Accounts/${sid}${path}`, {
      method: init?.method ?? (init?.form ? "POST" : "GET"),
      headers: { authorization: auth, ...(init?.form ? { "content-type": "application/x-www-form-urlencoded" } : {}) },
      body: init?.form ? new URLSearchParams(init.form).toString() : undefined,
    });
    const body = (await res.json().catch(() => null)) as (T & { message?: string }) | null;
    if (!res.ok) return { ok: false, error: body?.message ?? `HTTP ${res.status}` };
    return { ok: true, data: body as T };
  } catch (error) {
    console.error("[twilio] falha na chamada à API", path, error);
    return { ok: false, error: "Falha de rede ao chamar a Twilio" };
  }
}

/** Pernas em andamento de uma ligação (o atendente, numa recebida; o cliente, numa feita pelo softphone). */
export async function activeChildCalls(parentCallSid: string): Promise<string[]> {
  const r = await api<{ calls?: { sid: string }[] }>(`/Calls.json?ParentCallSid=${encodeURIComponent(parentCallSid)}&Status=in-progress`);
  return r.ok ? (r.data.calls ?? []).map((c) => c.sid) : [];
}

/** Id da conferência em andamento com esse nome. */
export async function findConference(name: string): Promise<string | null> {
  const r = await api<{ conferences?: { sid: string }[] }>(`/Conferences.json?FriendlyName=${encodeURIComponent(name)}&Status=in-progress`);
  return r.ok ? (r.data.conferences?.[0]?.sid ?? null) : null;
}

/** Muda o gerente na conferência: mudo (ouvir), sussurro só ao atendente (coaching) ou fala com todos (intervir). */
export async function updateParticipant(conferenceSid: string, callSid: string, state: { muted: boolean; coaching: boolean; callSidToCoach?: string }): Promise<{ ok: boolean; error?: string }> {
  const form: Record<string, string> = { Muted: String(state.muted), Coaching: String(state.coaching) };
  if (state.coaching && state.callSidToCoach) form.CallSidToCoach = state.callSidToCoach;
  const r = await api(`/Conferences/${encodeURIComponent(conferenceSid)}/Participants/${encodeURIComponent(callSid)}.json`, { form });
  return r.ok ? { ok: true } : { ok: false, error: r.error };
}

/** Encerra uma perna (o gerente sai da ligação; cliente e atendente continuam). */
export async function endCall(callSid: string): Promise<boolean> {
  const r = await api(`/Calls/${encodeURIComponent(callSid)}.json`, { form: { Status: "completed" } });
  return r.ok;
}
