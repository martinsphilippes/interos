import "server-only";
/**
 * Telefonia da Central (fase 3). Uma ligação = uma comunicação do canal "voip" (o mesmo registro que as ligações
 * registradas à mão já usam), com id determinístico `call_<CallSid>` para que avisos repetidos do provedor não
 * dupliquem. O roteamento usa as filas da Central: quem tem ramal, está online e atende na Central recebe.
 */
import { createHash } from "node:crypto";
import { create, createIfAbsent, getById, getManyByIds, list, nowIso, update } from "@/server/db";
import { emitEvent } from "@/server/events";
import { notify } from "@/server/notifications";
import { BusinessError } from "@/server/auth/error-classes";
import { COLLECTIONS, type Communication, type DomainEvent, type Settings, type User, type UserRef } from "@/domain/types";
import { CALL_STATUS_LABELS, DEFAULT_PABX, DEFAULT_RATES, callStatusFromProvider, needsCallback, toE164, type PabxConfig } from "@/domain/telephony";
import { displayPhone } from "@/domain/phone";
import { formatCallDuration } from "@/lib/format";
import { listQueues } from "@/server/conversations/queues";
import { resolveIdentity } from "@/server/conversations/identity";
import { patchFields } from "@/server/conversations/store";

export const PABX_SETTING = "pabx";

export function callId(callSid: string): string {
  return `call_${createHash("sha256").update(callSid).digest("hex").slice(0, 32)}`;
}

// ---------------------------------------------------------------------------
// Configuração do PABX
// ---------------------------------------------------------------------------

export async function getPabx(): Promise<PabxConfig & { stored: boolean }> {
  const doc = (await list<Settings>(COLLECTIONS.settings, { where: [["key", "==", PABX_SETTING]] }))[0];
  const v = (doc?.value ?? {}) as Partial<PabxConfig>;
  return { ...DEFAULT_PABX, ...v, rates: { ...DEFAULT_RATES, ...(v.rates ?? {}) }, stored: Boolean(doc) };
}

/** Grava a configuração e o histórico de mudanças (evento settings.updated com o que mudou). */
export async function savePabx(next: PabxConfig, actor: UserRef): Promise<void> {
  const numbers = next.numbers.map((n) => {
    const e164 = toE164(n.number);
    if (!e164) throw new BusinessError(`Número inválido: ${n.number}`);
    return { ...n, number: e164 };
  });
  if (new Set(numbers.map((n) => n.number)).size !== numbers.length) throw new BusinessError("Número repetido");
  const value = { ...next, numbers };
  const current = await getPabx();
  const doc = (await list<Settings>(COLLECTIONS.settings, { where: [["key", "==", PABX_SETTING]] }))[0];
  if (doc) await update<Settings>(COLLECTIONS.settings, doc.id, { value: value as unknown as Record<string, unknown> });
  else await create<Settings>(COLLECTIONS.settings, { key: PABX_SETTING, value: value as unknown as Record<string, unknown>, description: "PABX da Central: números, toque, boas-vindas e correio de voz." });
  const changed = (Object.keys(value) as (keyof PabxConfig)[]).filter((k) => JSON.stringify(value[k]) !== JSON.stringify(current[k]));
  if (changed.length) {
    await emitEvent({ type: "settings.updated", actor, entity: { type: "setting", id: PABX_SETTING }, title: `${actor.name} alterou o PABX`, description: changed.map((k) => PABX_FIELD_LABELS[k]).join(", "), payload: { key: PABX_SETTING, changed, before: pick(current, changed), after: pick(value, changed) }, timeline: false });
  }
}

const PABX_FIELD_LABELS: Record<keyof PabxConfig, string> = { numbers: "números", ringSeconds: "tempo de toque", welcome: "boas-vindas", voicemail: "correio de voz", closedMessage: "mensagem fora do horário", noAgentMessage: "mensagem sem atendente", rates: "tarifas" };

function pick<T extends object>(obj: T, keys: (keyof T)[]): Partial<T> {
  return Object.fromEntries(keys.map((k) => [k, obj[k]])) as Partial<T>;
}

/** Histórico de mudanças do PABX e dos ramais (eventos settings.updated). */
export async function pabxHistory(limit = 50): Promise<DomainEvent[]> {
  const events = await list<DomainEvent>(COLLECTIONS.events, { where: [["type", "==", "settings.updated"]] });
  return events.filter((e) => e.payload?.key === PABX_SETTING || e.payload?.key === "ramais").sort((a, b) => (a.occurredAt < b.occurredAt ? 1 : -1)).slice(0, limit);
}

// ---------------------------------------------------------------------------
// Roteamento
// ---------------------------------------------------------------------------

/** Fila do número chamado (ou a padrão). */
export async function queueForNumber(to: string | undefined): Promise<string | undefined> {
  const pabx = await getPabx();
  const e164 = toE164(to);
  const number = pabx.numbers.find((n) => n.active && n.number === e164);
  if (number?.queueId) return number.queueId;
  return (await listQueues()).find((q) => q.active && q.isDefault)?.id;
}

/** Quem toca: membros da fila com ramal, ativos, online e atendendo na Central. */
export async function availableAgents(queueId: string | undefined): Promise<User[]> {
  const queues = await listQueues();
  const queue = queues.find((q) => q.id === queueId && q.active);
  const memberIds = queue ? queue.memberIds : Array.from(new Set(queues.filter((q) => q.active).flatMap((q) => q.memberIds)));
  const users = await getManyByIds<User>(COLLECTIONS.users, memberIds);
  return memberIds.map((id) => users.get(id)).filter((u): u is User => Boolean(u && u.active !== false && u.presence === "online" && u.central?.attends !== false && u.central?.extension));
}

// ---------------------------------------------------------------------------
// Registro das ligações (avisos do provedor)
// ---------------------------------------------------------------------------

async function identityFor(number: string | undefined) {
  if (!number) return { clientId: undefined, contactId: undefined, leadId: undefined, name: undefined };
  const id = await resolveIdentity("whatsapp", number);
  return { clientId: id.clientId, contactId: id.contactId, leadId: id.leadId, name: id.name };
}

/** Ligação recebida (antes de tocar). Idempotente pelo CallSid. */
export async function recordIncomingCall(input: { callSid: string; from: string; to: string; queueId?: string }): Promise<Communication> {
  const who = await identityFor(input.from);
  const { doc } = await createIfAbsent<Communication>(COLLECTIONS.communications, callId(input.callSid), {
    channel: "voip",
    direction: "entrada",
    clientId: who.clientId,
    contactId: who.contactId,
    entityType: who.leadId && !who.clientId ? "lead" : "call",
    entityId: who.leadId && !who.clientId ? who.leadId : callId(input.callSid),
    status: "recebida",
    provider: "twilio",
    callSid: input.callSid,
    callStatus: "em_andamento",
    fromNumber: input.from,
    toNumber: input.to,
    address: input.from,
    queueId: input.queueId,
  });
  return doc;
}

/** Ligação feita pelo softphone. Idempotente pelo CallSid. */
export async function recordOutgoingCall(input: { callSid: string; userId: string; to: string; from?: string }): Promise<Communication> {
  const who = await identityFor(input.to);
  const { doc } = await createIfAbsent<Communication>(COLLECTIONS.communications, callId(input.callSid), {
    channel: "voip",
    direction: "saida",
    userId: input.userId,
    createdBy: input.userId,
    clientId: who.clientId,
    contactId: who.contactId,
    entityType: who.leadId && !who.clientId ? "lead" : "call",
    entityId: who.leadId && !who.clientId ? who.leadId : callId(input.callSid),
    status: "enviada",
    provider: "twilio",
    callSid: input.callSid,
    callStatus: "em_andamento",
    fromNumber: input.from,
    toNumber: input.to,
    address: input.to,
  });
  // Retorno de uma perdida: a perdida mais recente desse número passa a «retornada».
  if (who.clientId || who.contactId || who.leadId || input.to) await markReturnedByNumber(input.to, input.userId);
  return doc;
}

/** Resultado da ligação (fim do toque nos ramais / da ligação discada). Devolve o registro atualizado. */
export async function applyCallResult(callSid: string, providerStatus: string | undefined, durationSeconds: number): Promise<Communication | null> {
  const c = await getById<Communication>(COLLECTIONS.communications, callId(callSid));
  if (!c) return null;
  const callStatus = callStatusFromProvider(providerStatus, c.direction, durationSeconds);
  if (c.callStatus === callStatus && (c.durationSeconds ?? 0) === durationSeconds) return c;
  const patch: Partial<Communication> = { callStatus, durationSeconds, statusUpdatedAt: nowIso() };
  await update<Communication>(COLLECTIONS.communications, c.id, patch);
  const next = { ...c, ...patch };
  if (callStatus !== "em_andamento") await announceCall(next);
  return next;
}

/** Quem atendeu (o softphone avisa ao aceitar). */
export async function claimCall(callSid: string, user: UserRef): Promise<void> {
  const c = await getById<Communication>(COLLECTIONS.communications, callId(callSid));
  if (!c || c.direction !== "entrada") return;
  if (c.userId && c.userId !== user.id) return;
  await update<Communication>(COLLECTIONS.communications, c.id, { userId: user.id, callStatus: "em_andamento" });
}

/** Gravação pronta (ligação gravada ou recado do correio de voz). */
export async function applyRecording(callSid: string, recordingSid: string, durationSeconds: number | undefined, voicemail: boolean, part = false): Promise<void> {
  const c = await getById<Communication>(COLLECTIONS.communications, callId(callSid));
  if (!c) return;
  if (part) {
    // Parte gravada na conferência da supervisão (a primeira parte é a gravação normal da ligação).
    if (c.recordingSid === recordingSid || c.recordingParts?.includes(recordingSid)) return;
    await update<Communication>(COLLECTIONS.communications, c.id, { recordingParts: [...(c.recordingParts ?? []), recordingSid] });
    return;
  }
  const patch: Partial<Communication> = { recordingSid };
  if (voicemail) {
    patch.voicemail = true;
    patch.callStatus = "perdida";
    if (durationSeconds !== undefined) patch.durationSeconds = durationSeconds;
  }
  await update<Communication>(COLLECTIONS.communications, c.id, patch);
  if (voicemail) await notifyVoicemail({ ...c, ...patch });
}

async function notifyVoicemail(c: Communication): Promise<void> {
  const queues = await listQueues();
  const queue = queues.find((q) => q.id === c.queueId);
  const ids = (queue?.memberIds ?? []).slice(0, 20);
  if (!ids.length) return;
  const who = await displayCaller(c);
  await notify({ userIds: ids, kind: "acao", title: `Recado de ${who}`, body: "Novo recado no correio de voz.", href: "/comunicacao/correio-de-voz", entity: { type: "communication", id: c.id } });
}

async function displayCaller(c: Communication): Promise<string> {
  if (c.contactId) {
    const contact = await getById<{ id: string; name: string; organizationId: string; createdAt: string; updatedAt: string }>(COLLECTIONS.contacts, c.contactId);
    if (contact) return contact.name;
  }
  if (c.clientId) {
    const client = await getById<{ id: string; tradeName: string; organizationId: string; createdAt: string; updatedAt: string }>(COLLECTIONS.clients, c.clientId);
    if (client) return client.tradeName;
  }
  return displayPhone(c.direction === "entrada" ? c.fromNumber : c.toNumber) || "número desconhecido";
}

/** Linha do tempo do cliente e aviso de perdida (uma vez, quando a ligação termina). */
async function announceCall(c: Communication): Promise<void> {
  const who = await displayCaller(c);
  const status = c.callStatus ?? "atendida";
  const duration = status === "atendida" && c.durationSeconds ? ` — ${formatCallDuration(c.durationSeconds)}` : "";
  await emitEvent({
    type: "call.completed",
    actor: c.userId ? { id: c.userId, name: "Central de Atendimento" } : { id: "sistema", name: "Central de Atendimento" },
    clientId: c.clientId,
    entity: { type: "communication", id: c.id },
    title: `${c.direction === "entrada" ? "Ligação recebida de" : "Ligação para"} ${who} (${CALL_STATUS_LABELS[status].toLowerCase()})${duration}`,
    department: "suporte",
    payload: { communicationId: c.id, outcome: status, durationSeconds: c.durationSeconds ?? 0, contactId: c.contactId, manual: false },
  });
}

// ---------------------------------------------------------------------------
// Ações do operador
// ---------------------------------------------------------------------------

/** Perdidas desse número ainda sem retorno passam a «retornada» (ao ligar de volta). */
export async function markReturnedByNumber(number: string | undefined, userId: string): Promise<number> {
  const e164 = toE164(number);
  if (!e164) return 0;
  const recent = (await list<Communication>(COLLECTIONS.communications, { where: [["channel", "==", "voip"], ["direction", "==", "entrada"]] })).filter((c) => toE164(c.fromNumber ?? c.address) === e164 && needsCallback(c));
  const at = nowIso();
  for (const c of recent) await update<Communication>(COLLECTIONS.communications, c.id, { returnedAt: at, returnedById: userId });
  return recent.length;
}

export async function markReturned(id: string, user: UserRef): Promise<void> {
  const c = await getById<Communication>(COLLECTIONS.communications, id);
  if (!c || c.channel !== "voip") throw new BusinessError("Ligação não encontrada");
  if (c.returnedAt) return;
  await update<Communication>(COLLECTIONS.communications, c.id, { returnedAt: nowIso(), returnedById: user.id });
}

export async function markVoicemailHandled(id: string, user: UserRef): Promise<void> {
  const c = await getById<Communication>(COLLECTIONS.communications, id);
  if (!c || !c.voicemail) throw new BusinessError("Recado não encontrado");
  await patchFields<Communication>(COLLECTIONS.communications, c.id, { handledAt: c.handledAt ? undefined : nowIso(), handledById: c.handledAt ? undefined : user.id });
}
