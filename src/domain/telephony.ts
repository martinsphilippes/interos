/**
 * Telefonia da Central (fase 3): número no formato internacional, resultado da ligação, configuração do PABX e TwiML
 * (as instruções que o provedor executa). Puro: sem servidor.
 */
import type { CallStatus, Communication } from "./types";
import { digitsOnly, nationalNumber, withNinthDigit } from "./phone";

// ---------------------------------------------------------------------------
// Números
// ---------------------------------------------------------------------------

/** Número brasileiro em E.164 (+55DDNNNNNNNNN), ou null. Celular ganha o 9 quando falta. Outros países (+XX): mantém. */
export function toE164(raw: string | undefined | null): string | null {
  if (!raw) return null;
  const trimmed = raw.trim();
  if (trimmed.startsWith("+") && !trimmed.startsWith("+55")) {
    const d = digitsOnly(trimmed);
    return d.length >= 8 && d.length <= 15 ? `+${d}` : null;
  }
  const national = nationalNumber(trimmed);
  if (national.length !== 10 && national.length !== 11) return null;
  const full = digitsOnly(withNinthDigit(national));
  return full.length === 10 || full.length === 11 ? `+55${full}` : null;
}

/** Ramal: 2 a 6 dígitos. */
export function isExtension(value: string): boolean {
  return /^\d{2,6}$/.test(value.trim());
}

// ---------------------------------------------------------------------------
// Resultado da ligação
// ---------------------------------------------------------------------------

export const CALL_STATUS_LABELS: Record<CallStatus, string> = {
  em_andamento: "Em andamento",
  atendida: "Atendida",
  perdida: "Perdida",
  sem_resposta: "Não atendeu",
  ocupado: "Ocupado",
  falha: "Falha",
};

/** Resultado de um registro de ligação (os antigos, registrados à mão, não têm o campo). */
export function callStatusOf(c: Pick<Communication, "callStatus" | "durationSeconds" | "direction">): CallStatus {
  if (c.callStatus) return c.callStatus;
  if ((c.durationSeconds ?? 0) > 0) return "atendida";
  return c.direction === "entrada" ? "perdida" : "sem_resposta";
}

/** Status final do provedor (Twilio CallStatus / DialCallStatus) → resultado. */
export function callStatusFromProvider(status: string | undefined, direction: "entrada" | "saida", durationSeconds = 0): CallStatus {
  switch ((status ?? "").toLowerCase()) {
    case "completed":
    case "answered":
      return durationSeconds > 0 || direction === "saida" ? "atendida" : "perdida";
    case "busy":
      return direction === "entrada" ? "perdida" : "ocupado";
    case "no-answer":
    case "canceled":
      return direction === "entrada" ? "perdida" : "sem_resposta";
    case "failed":
      return "falha";
    case "in-progress":
    case "ringing":
    case "queued":
    case "initiated":
      return "em_andamento";
    default:
      return direction === "entrada" ? "perdida" : "sem_resposta";
  }
}

/** Perdida ainda sem retorno (nem ligação de volta registrada nem recado tratado). */
export function needsCallback(c: Pick<Communication, "callStatus" | "durationSeconds" | "direction" | "returnedAt" | "handledAt">): boolean {
  return c.direction === "entrada" && callStatusOf(c) === "perdida" && !c.returnedAt && !c.handledAt;
}

// ---------------------------------------------------------------------------
// PABX
// ---------------------------------------------------------------------------

export interface PabxNumber {
  /** E.164. */
  number: string;
  label: string;
  /** Fila que atende quem liga para este número; ausente = fila padrão. */
  queueId?: string;
  active: boolean;
}

export interface PabxConfig {
  numbers: PabxNumber[];
  /** Quanto tempo tocar nos ramais antes do correio de voz (s). */
  ringSeconds: number;
  /** Mensagem de boas-vindas (antes do aviso de gravação). Vazia = nenhuma. */
  welcome: string;
  /** Fora do horário ou sem ninguém disponível: deixar recado ou só a mensagem. */
  voicemail: boolean;
  closedMessage: string;
  noAgentMessage: string;
}

export const DEFAULT_PABX: PabxConfig = {
  numbers: [],
  ringSeconds: 25,
  welcome: "Olá! Você ligou para a Intercert.",
  voicemail: true,
  closedMessage: "Nosso horário é de segunda a sexta, das 8h às 18h. Deixe seu recado após o sinal que retornamos.",
  noAgentMessage: "No momento todos estão ocupados. Deixe seu recado após o sinal que retornamos assim que possível.",
};

// ---------------------------------------------------------------------------
// TwiML
// ---------------------------------------------------------------------------

export function xmlEscape(value: string): string {
  return value.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;").replace(/'/g, "&apos;");
}

const VOICE = 'language="pt-BR" voice="Polly.Camila"';
const say = (text: string) => (text.trim() ? `<Say ${VOICE}>${xmlEscape(text.trim())}</Say>` : "");
const wrap = (body: string) => `<?xml version="1.0" encoding="UTF-8"?><Response>${body}</Response>`;

export interface IncomingTwimlInput {
  welcome: string;
  /** Aviso de gravação (vazio = não grava). */
  recordingNotice: string;
  record: boolean;
  /** Identidades dos softphones (id do usuário) que tocam juntos. */
  clients: string[];
  /** Ligação principal (o softphone usa para registrar quem atendeu e transferir) e quem liga. */
  parentCallSid: string;
  from: string;
  ringSeconds: number;
  callerId?: string;
  /** URLs absolutas dos retornos. */
  dialAction: string;
  recordingCallback: string;
}

/** Ligação recebida: boas-vindas, aviso de gravação e toca em todos os disponíveis; o resultado vai para dialAction. */
export function incomingTwiml(i: IncomingTwimlInput): string {
  const params = `<Parameter name="parentCallSid" value="${xmlEscape(i.parentCallSid)}"/><Parameter name="from" value="${xmlEscape(i.from)}"/>`;
  const clients = i.clients
    .slice(0, 10)
    .map((c) => `<Client><Identity>${xmlEscape(c)}</Identity>${params}</Client>`)
    .join("");
  const rec = i.record ? ` record="record-from-answer-dual" recordingStatusCallback="${xmlEscape(i.recordingCallback)}" recordingStatusCallbackEvent="completed"` : "";
  return wrap(`${say(i.welcome)}${i.record ? say(i.recordingNotice) : ""}<Dial timeout="${Math.max(5, Math.min(60, i.ringSeconds))}" action="${xmlEscape(i.dialAction)}"${rec}${i.callerId ? ` callerId="${xmlEscape(i.callerId)}"` : ""}>${clients}</Dial>`);
}

/** Ninguém atendeu, ou fora do horário: recado no correio de voz (ou só a mensagem). */
export function voicemailTwiml(message: string, voicemail: boolean, recordAction: string, recordingCallback: string): string {
  if (!voicemail) return wrap(`${say(message)}<Hangup/>`);
  return wrap(`${say(message)}<Record maxLength="120" playBeep="true" timeout="5" action="${xmlEscape(recordAction)}" recordingStatusCallback="${xmlEscape(recordingCallback)}" recordingStatusCallbackEvent="completed"/>${say("Não recebemos seu recado. Até logo.")}`);
}

/** Ligação feita pelo softphone: liga para o número com a bina do PABX (e grava, pela política). */
export function outgoingTwiml(i: { to: string; callerId: string; record: boolean; dialAction: string; recordingCallback: string }): string {
  const rec = i.record ? ` record="record-from-answer-dual" recordingStatusCallback="${xmlEscape(i.recordingCallback)}" recordingStatusCallbackEvent="completed"` : "";
  return wrap(`<Dial callerId="${xmlEscape(i.callerId)}" action="${xmlEscape(i.dialAction)}"${rec}><Number>${xmlEscape(i.to)}</Number></Dial>`);
}

/** Transferência: a ligação passa a tocar no destino (ramal ou número). */
export function transferTwiml(target: { client?: string; number?: string }, callerId?: string): string {
  const dest = target.client ? `<Client>${xmlEscape(target.client)}</Client>` : `<Number>${xmlEscape(target.number ?? "")}</Number>`;
  return wrap(`${say("Transferindo sua ligação.")}<Dial${callerId ? ` callerId="${xmlEscape(callerId)}"` : ""}>${dest}</Dial>`);
}

export function hangupTwiml(message?: string): string {
  return wrap(`${message ? say(message) : ""}<Hangup/>`);
}
