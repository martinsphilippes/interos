import "server-only";
/**
 * Leitura da telefonia: histórico de ligações e correio de voz, no escopo das telas comunicacao.ligacoes e
 * comunicacao.correio (operador: as suas e as sem responsável das filas em que está; gestor: a equipe; direção: todas).
 */
import { getManyByIds, list } from "@/server/db";
import { resolveDataScope } from "@/server/auth/scope";
import { can } from "@/server/auth/session";
import { COLLECTIONS, type CallStatus, type Client, type Communication, type Contact, type CurrentUser, type Lead, type RecordingAccessLog, type User } from "@/domain/types";
import { CALL_STATUS_LABELS, callStatusOf, needsCallback } from "@/domain/telephony";
import { displayPhone } from "@/domain/phone";
import { listQueues } from "@/server/conversations/queues";
import { getRecordingPolicy } from "@/server/conversations/ops-settings";

export interface CallRow {
  id: string;
  at: string;
  direction: "entrada" | "saida";
  status: CallStatus;
  statusLabel: string;
  durationSeconds: number;
  name: string;
  subtitle: string;
  number: string;
  clientId?: string;
  userName?: string;
  queueName?: string;
  manual: boolean;
  voicemail: boolean;
  needsCallback: boolean;
  returnedByName?: string;
  handled: boolean;
  /** Tem gravação e a pessoa pode ouvir. */
  canListen: boolean;
  recordingDeleted: boolean;
  summary?: string;
}

type Screen = "comunicacao.ligacoes" | "comunicacao.correio";

async function scoped(user: CurrentUser, screen: Screen, days: number) {
  const since = new Date(Date.now() - days * 86_400_000).toISOString();
  const [scope, queues, all] = await Promise.all([resolveDataScope(user, screen), listQueues(), list<Communication>(COLLECTIONS.communications, { where: [["channel", "==", "voip"]] })]);
  const myQueues = new Set(queues.filter((q) => q.memberIds.includes(user.id)).map((q) => q.id));
  const items = all.filter((c) => c.createdAt >= since).filter((c) => {
    if (!scope.userIds) return true;
    if (c.userId) return scope.userIds.has(c.userId);
    // Sem responsável (perdida/recado): as filas da pessoa, ou sem fila.
    return !c.queueId || myQueues.has(c.queueId);
  });
  return { items, queues, scopeKind: scope.kind };
}

async function toRows(user: CurrentUser, items: Communication[], queueName: Map<string, string>): Promise<CallRow[]> {
  const [clients, contacts, leads, users, policy] = await Promise.all([
    getManyByIds<Client>(COLLECTIONS.clients, items.map((c) => c.clientId ?? "").filter(Boolean)),
    getManyByIds<Contact>(COLLECTIONS.contacts, items.map((c) => c.contactId ?? "").filter(Boolean)),
    getManyByIds<Lead>(COLLECTIONS.leads, items.map((c) => (c.entityType === "lead" ? (c.entityId ?? "") : "")).filter(Boolean)),
    getManyByIds<User>(COLLECTIONS.users, items.flatMap((c) => [c.userId ?? "", c.returnedById ?? ""]).filter(Boolean)),
    getRecordingPolicy(),
  ]);
  const listenByRole = can(user, "comunicacao.ligacoes.gravacoes.ouvir") && policy.listenRoles.includes(user.role);
  return items.map((c) => {
    const contact = c.contactId ? contacts.get(c.contactId) : undefined;
    const client = c.clientId ? clients.get(c.clientId) : undefined;
    const lead = c.entityType === "lead" && c.entityId ? leads.get(c.entityId) : undefined;
    const number = (c.direction === "entrada" ? c.fromNumber : c.toNumber) ?? c.address ?? "";
    const status = callStatusOf(c);
    return {
      id: c.id,
      at: c.createdAt,
      direction: c.direction,
      status,
      statusLabel: c.voicemail ? "Recado" : CALL_STATUS_LABELS[status],
      durationSeconds: c.durationSeconds ?? 0,
      name: contact?.name ?? client?.tradeName ?? lead?.name ?? (number ? displayPhone(number) : "Número oculto"),
      subtitle: contact ? (client?.tradeName ?? "Cliente") : client ? "Cliente" : lead ? "Lead" : "Não identificado",
      number,
      clientId: c.clientId,
      userName: c.userId ? users.get(c.userId)?.name : undefined,
      queueName: c.queueId ? queueName.get(c.queueId) : undefined,
      manual: c.provider === "manual" || c.provider === "mock",
      voicemail: Boolean(c.voicemail),
      needsCallback: needsCallback(c),
      returnedByName: c.returnedById ? users.get(c.returnedById)?.name : undefined,
      handled: Boolean(c.handledAt),
      canListen: Boolean(c.recordingSid && !c.recordingDeletedAt && (listenByRole || c.userId === user.id)),
      recordingDeleted: Boolean(c.recordingDeletedAt),
      summary: c.body,
    };
  });
}

export interface CallFilters {
  days: number;
  view: "todas" | "perdidas" | "minhas";
  direction?: "entrada" | "saida";
}

export async function listCalls(user: CurrentUser, f: CallFilters): Promise<{ rows: CallRow[]; pendingCallbacks: number; scopeKind: string }> {
  const { items, queues, scopeKind } = await scoped(user, "comunicacao.ligacoes", f.days);
  let filtered = items;
  if (f.direction) filtered = filtered.filter((c) => c.direction === f.direction);
  if (f.view === "minhas") filtered = filtered.filter((c) => c.userId === user.id);
  if (f.view === "perdidas") filtered = filtered.filter((c) => needsCallback(c));
  filtered = filtered.sort((a, b) => (a.createdAt < b.createdAt ? 1 : -1)).slice(0, 500);
  return { rows: await toRows(user, filtered, new Map(queues.map((q) => [q.id, q.name]))), pendingCallbacks: items.filter((c) => needsCallback(c)).length, scopeKind };
}

export async function listVoicemails(user: CurrentUser, f: { days: number; showHandled: boolean }): Promise<{ rows: CallRow[]; pending: number }> {
  const { items, queues } = await scoped(user, "comunicacao.correio", f.days);
  const vms = items.filter((c) => c.voicemail).sort((a, b) => (a.createdAt < b.createdAt ? 1 : -1));
  const visible = f.showHandled ? vms : vms.filter((c) => !c.handledAt);
  return { rows: await toRows(user, visible.slice(0, 300), new Map(queues.map((q) => [q.id, q.name]))), pending: vms.filter((c) => !c.handledAt).length };
}

/** A ligação está no escopo de uma das telas de telefonia do usuário? */
export async function callInScope(user: CurrentUser, c: Communication): Promise<boolean> {
  for (const screen of ["comunicacao.ligacoes", "comunicacao.correio"] as const) {
    if (!can(user, screen === "comunicacao.ligacoes" ? "comunicacao.ligacoes.ligar" : "comunicacao.correio.tratar")) continue;
    const scope = await resolveDataScope(user, screen);
    if (!scope.userIds) return true;
    if (c.userId ? scope.userIds.has(c.userId) : !c.queueId || (await listQueues()).some((q) => q.id === c.queueId && q.memberIds.includes(user.id))) return true;
  }
  return false;
}

export interface RecordingAccessRow {
  id: string;
  at: string;
  userName: string;
  action: RecordingAccessLog["action"];
  reason?: string;
  communicationId: string;
}

/** Registro de acesso às gravações (fase 4: tela própria; aqui, os últimos de uma ligação ou de todas). */
export async function recordingAccessLog(communicationId?: string, limit = 200): Promise<RecordingAccessRow[]> {
  const logs = await list<RecordingAccessLog>(COLLECTIONS.recordingAccessLogs, communicationId ? { where: [["communicationId", "==", communicationId]] } : {});
  const sorted = logs.sort((a, b) => (a.at < b.at ? 1 : -1)).slice(0, limit);
  const users = await getManyByIds<User>(COLLECTIONS.users, sorted.map((l) => l.userId));
  return sorted.map((l) => ({ id: l.id, at: l.at, userName: users.get(l.userId)?.name ?? "Usuário removido", action: l.action, reason: l.reason, communicationId: l.communicationId }));
}

// ---------------------------------------------------------------------------
// PABX (tela comunicacao.pabx)
// ---------------------------------------------------------------------------

export interface PabxQuality {
  total: number;
  answeredPct?: number;
  missedPct?: number;
  failed: number;
  avgDurationSeconds?: number;
  byNumber: { number: string; total: number; missed: number }[];
}

/** Qualidade das ligações pelo provedor nos últimos 30 dias (as registradas à mão não entram). */
export async function pabxQuality(now: number = Date.now()): Promise<PabxQuality> {
  const since = new Date(now - 30 * 86_400_000).toISOString();
  const calls = (await list<Communication>(COLLECTIONS.communications, { where: [["channel", "==", "voip"]] })).filter((c) => c.provider === "twilio" && c.createdAt >= since && c.callStatus !== "em_andamento");
  const answered = calls.filter((c) => callStatusOf(c) === "atendida");
  const missed = calls.filter((c) => c.direction === "entrada" && callStatusOf(c) === "perdida");
  const incoming = calls.filter((c) => c.direction === "entrada");
  const byNumber = new Map<string, { total: number; missed: number }>();
  for (const c of incoming) {
    const key = c.toNumber ?? "—";
    const v = byNumber.get(key) ?? { total: 0, missed: 0 };
    v.total += 1;
    if (callStatusOf(c) === "perdida") v.missed += 1;
    byNumber.set(key, v);
  }
  return {
    total: calls.length,
    answeredPct: calls.length ? Math.round((answered.length / calls.length) * 100) : undefined,
    missedPct: incoming.length ? Math.round((missed.length / incoming.length) * 100) : undefined,
    failed: calls.filter((c) => callStatusOf(c) === "falha").length,
    avgDurationSeconds: answered.length ? Math.round(answered.reduce((s, c) => s + (c.durationSeconds ?? 0), 0) / answered.length) : undefined,
    byNumber: Array.from(byNumber.entries()).map(([number, v]) => ({ number, ...v })),
  };
}
