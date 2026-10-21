import "server-only";
/**
 * Supervisão de ligações (fase 4): o gerente ouve, sussurra ao atendente ou entra na ligação.
 *
 * Como funciona (Twilio): a ligação começa como uma ponte simples (<Dial>). Quando o gerente pede para acompanhar, a
 * perna filha é redirecionada para uma conferência; a principal sai do <Dial>, cai no retorno (dial-result) e entra
 * na mesma conferência. O gerente entra pelo softphone, mudo; mudar o modo é mudar o participante (mudo, «coaching»
 * só para o atendente, ou fala com todos). O atendente vê no softphone quem está na ligação e em que modo.
 * Cliente e atendente encerram a conferência ao sair; o gerente sai sem derrubar a ligação.
 */
import { create, getById, getManyByIds, list, nowIso, update } from "@/server/db";
import { resolveDataScope } from "@/server/auth/scope";
import { BusinessError } from "@/server/auth/error-classes";
import { COLLECTIONS, type CallMonitor, type CallMonitorMode, type Client, type Communication, type Contact, type CurrentUser, type SupervisionLog, type User } from "@/domain/types";
import { CALL_MONITOR_AGENT_NOTICE, conferenceName, conferenceTwiml, monitorParticipantState, monitoredDuration } from "@/domain/telephony";
import { displayPhone } from "@/domain/phone";
import { activeChildCalls, endCall, findConference, redirectCall, twilioConfigured, updateParticipant } from "@/server/integrations/twilio";
import { getRecordingPolicy } from "@/server/conversations/ops-settings";
import { listQueues } from "@/server/conversations/queues";
import { patchFields } from "@/server/conversations/store";
import { applyCallResult, callId } from "./service";

/** Grava a supervisão da ligação substituindo o campo inteiro (update com merge mesclaria o objeto). */
async function setMonitor(id: string, m: CallMonitor | undefined): Promise<void> {
  const clean = m ? (Object.fromEntries(Object.entries(m).filter(([, v]) => v !== undefined)) as unknown as CallMonitor) : undefined;
  await patchFields<Communication>(COLLECTIONS.communications, id, { monitor: clean });
}

const LOG_ACTION: Record<CallMonitorMode, SupervisionLog["action"]> = { ouvir: "ligacao_ouvir", sussurrar: "ligacao_sussurrar", intervir: "ligacao_intervir" };

/** Ligação em andamento, atendida, pelo provedor, de alguém no escopo da Central de Comando. */
async function supervisedCall(user: CurrentUser, id: string): Promise<Communication> {
  const c = await getById<Communication>(COLLECTIONS.communications, id);
  if (!c || c.channel !== "voip" || c.provider !== "twilio" || !c.callSid) throw new BusinessError("Ligação não encontrada");
  if (c.callStatus !== "em_andamento" || !c.userId) throw new BusinessError("A ligação não está em andamento");
  const scope = await resolveDataScope(user, "comunicacao.supervisao");
  if (scope.userIds && !scope.userIds.has(c.userId)) throw new BusinessError("Ligação fora da sua equipe");
  return c;
}

// ---------------------------------------------------------------------------
// Painel: ligações em andamento
// ---------------------------------------------------------------------------

export interface LiveCallRow {
  id: string;
  direction: "entrada" | "saida";
  agentId: string;
  agentName: string;
  who: string;
  queueName?: string;
  startedAt: string;
  /** Gerente que está na ligação agora (e em que modo). */
  monitoredBy?: string;
  monitorMode?: CallMonitorMode;
  mine: boolean;
}

/** Ligações em andamento da equipe (para o gerente ouvir). Ligações de mais de 4 h são ignoradas (registro preso). */
export async function liveCalls(user: CurrentUser, now: number = Date.now()): Promise<LiveCallRow[]> {
  if (!twilioConfigured()) return [];
  const since = new Date(now - 4 * 3600_000).toISOString();
  const [scope, calls, queues] = await Promise.all([
    resolveDataScope(user, "comunicacao.supervisao"),
    list<Communication>(COLLECTIONS.communications, { where: [["channel", "==", "voip"], ["callStatus", "==", "em_andamento"]] }),
    listQueues(),
  ]);
  const live = calls.filter((c) => c.provider === "twilio" && c.userId && c.createdAt >= since && (!scope.userIds || scope.userIds.has(c.userId)));
  const [users, contacts, clients] = await Promise.all([
    getManyByIds<User>(COLLECTIONS.users, live.map((c) => c.userId!)),
    getManyByIds<Contact>(COLLECTIONS.contacts, live.map((c) => c.contactId ?? "").filter(Boolean)),
    getManyByIds<Client>(COLLECTIONS.clients, live.map((c) => c.clientId ?? "").filter(Boolean)),
  ]);
  const qName = new Map(queues.map((q) => [q.id, q.name]));
  return live
    .sort((a, b) => (a.createdAt < b.createdAt ? -1 : 1))
    .map((c) => {
      const active = c.monitor && c.monitor.state !== "encerrada" && c.monitor.supervisorCallSid ? c.monitor : undefined;
      return {
        id: c.id,
        direction: c.direction,
        agentId: c.userId!,
        agentName: users.get(c.userId!)?.name ?? "—",
        who: (c.contactId ? contacts.get(c.contactId)?.name : undefined) ?? (c.clientId ? clients.get(c.clientId)?.tradeName : undefined) ?? (displayPhone(c.direction === "entrada" ? c.fromNumber : c.toNumber) || "Número oculto"),
        queueName: c.queueId ? qName.get(c.queueId) : undefined,
        startedAt: c.createdAt,
        monitoredBy: active?.supervisorName,
        monitorMode: active?.mode,
        mine: active?.supervisorId === user.id,
      };
    });
}

// ---------------------------------------------------------------------------
// Gerente: começar, mudar o modo, sair
// ---------------------------------------------------------------------------

/**
 * Prepara a ligação para o gerente entrar: move as pernas para a conferência (se ainda não estiverem) e marca quem vai
 * entrar. Em seguida o softphone do gerente liga com o parâmetro `monitor` (rota outgoing → joinMonitorTwiml).
 */
export async function startCallMonitor(user: CurrentUser, id: string, base: string): Promise<{ id: string }> {
  const c = await supervisedCall(user, id);
  const m = c.monitor;
  if (m && m.state !== "encerrada" && m.supervisorCallSid && m.supervisorId !== user.id) throw new BusinessError(`${m.supervisorName} já está nesta ligação`);
  const since = nowIso();
  if (m && m.state !== "encerrada") {
    // Já em conferência (ou entrando): só troca quem vai entrar.
    await setMonitor(c.id, { ...m, supervisorId: user.id, supervisorName: user.name, mode: "ouvir", since, supervisorCallSid: undefined });
    return { id: c.id };
  }
  const children = await activeChildCalls(c.callSid!);
  const child = children[0];
  if (!child) throw new BusinessError("Não foi possível localizar a ligação no provedor (já terminou?)");
  const name = conferenceName(c.id);
  const agentLegSid = c.direction === "entrada" ? child : c.callSid!;
  const policy = await getRecordingPolicy();
  // Marca antes de redirecionar: o retorno da perna principal (dial-result) precisa ver o estado «movendo».
  await setMonitor(c.id, { conference: name, state: "movendo", supervisorId: user.id, supervisorName: user.name, mode: "ouvir", since, agentLegSid });
  const r = await redirectCall(
    child,
    conferenceTwiml({ name, endOnExit: true, recordingCallback: policy.enabled ? `${base}/api/voice/recording?call=${encodeURIComponent(c.callSid!)}&parte=1` : undefined }),
  );
  if (!r.ok) {
    await setMonitor(c.id, undefined);
    throw new BusinessError(`Não foi possível abrir a ligação para supervisão: ${r.error}`);
  }
  return { id: c.id };
}

/** Rota outgoing: a perna do gerente entra na conferência, muda. Null = não autorizado (a rota desliga). */
export async function joinMonitorTwiml(userId: string, id: string, supervisorCallSid: string, base: string): Promise<string | null> {
  const c = await getById<Communication>(COLLECTIONS.communications, id);
  const m = c?.monitor;
  if (!c || !m || m.state === "encerrada" || m.supervisorId !== userId) return null;
  await setMonitor(c.id, { ...m, supervisorCallSid, mode: "ouvir" });
  await create<SupervisionLog>(COLLECTIONS.supervisionLogs, { supervisorId: userId, operatorId: c.userId, communicationId: c.id, action: "ligacao_ouvir", startedAt: nowIso() });
  return conferenceTwiml({ name: m.conference, endOnExit: false, muted: true, action: `${base}/api/voice/monitor-end?call=${encodeURIComponent(c.id)}` });
}

async function closeOpenLogs(communicationId: string, supervisorId?: string): Promise<void> {
  const at = nowIso();
  const open = (await list<SupervisionLog>(COLLECTIONS.supervisionLogs, { where: [["communicationId", "==", communicationId]] })).filter((l) => !l.endedAt && (!supervisorId || l.supervisorId === supervisorId));
  for (const l of open) await update<SupervisionLog>(COLLECTIONS.supervisionLogs, l.id, { endedAt: at });
}

export async function setCallMonitorMode(user: CurrentUser, id: string, mode: CallMonitorMode): Promise<void> {
  const c = await supervisedCall(user, id);
  const m = c.monitor;
  if (!m || m.state === "encerrada" || m.supervisorId !== user.id || !m.supervisorCallSid) throw new BusinessError("Você não está nesta ligação");
  if (m.mode === mode) return;
  const conf = await findConference(m.conference);
  if (!conf) throw new BusinessError("A conferência ainda não começou; tente em alguns segundos");
  const r = await updateParticipant(conf, m.supervisorCallSid, monitorParticipantState(mode, m.agentLegSid));
  if (!r.ok) throw new BusinessError(`Não foi possível mudar o modo: ${r.error}`);
  await setMonitor(c.id, { ...m, mode });
  await closeOpenLogs(c.id, user.id);
  await create<SupervisionLog>(COLLECTIONS.supervisionLogs, { supervisorId: user.id, operatorId: c.userId, communicationId: c.id, action: LOG_ACTION[mode], startedAt: nowIso() });
}

/** O gerente sai (a ligação continua entre cliente e atendente). */
export async function stopCallMonitor(user: CurrentUser, id: string): Promise<void> {
  const c = await getById<Communication>(COLLECTIONS.communications, id);
  const m = c?.monitor;
  if (!c || !m || m.supervisorId !== user.id) return;
  if (m.supervisorCallSid) await endCall(m.supervisorCallSid);
  await supervisorLeft(c.id);
}

/** Retorno da perna do gerente (saiu da conferência, por desligar ou por a ligação acabar). */
export async function supervisorLeft(id: string): Promise<void> {
  const c = await getById<Communication>(COLLECTIONS.communications, id);
  if (!c?.monitor) return;
  await setMonitor(c.id, { ...c.monitor, supervisorCallSid: undefined });
  await closeOpenLogs(c.id);
}

// ---------------------------------------------------------------------------
// Retorno da perna principal (dial-result)
// ---------------------------------------------------------------------------

/**
 * Chamado pelo dial-result antes do resultado normal. Devolve TwiML quando a ligação está sob supervisão:
 * - «movendo»: a perna principal saiu do <Dial> porque a filha foi para a conferência → entra também;
 * - fase «conf»: a conferência acabou → grava o resultado (duração antes + depois) e encerra.
 */
export async function handleMonitoredDialResult(callSid: string, params: { DialCallStatus?: string; DialCallDuration?: string }, phase: string | null, base: string): Promise<{ twiml?: string; finished?: boolean } | null> {
  const c = await getById<Communication>(COLLECTIONS.communications, callId(callSid));
  const m = c?.monitor;
  if (!c || !m) return null;
  if (phase === "conf") {
    const duration = monitoredDuration(m);
    await setMonitor(c.id, { ...m, state: "encerrada", supervisorCallSid: undefined });
    await closeOpenLogs(c.id);
    await applyCallResult(callSid, "completed", duration);
    return { finished: true };
  }
  if (m.state !== "movendo") return null;
  const status = (params.DialCallStatus ?? "").toLowerCase();
  if (status !== "completed" && status !== "answered") {
    // A filha não estava mais na ligação: segue o fluxo normal.
    await setMonitor(c.id, undefined);
    return null;
  }
  await setMonitor(c.id, { ...m, state: "ativa", movedAt: nowIso(), partialSeconds: Number(params.DialCallDuration ?? 0) || 0 });
  return { twiml: conferenceTwiml({ name: m.conference, endOnExit: true, action: `${base}/api/voice/dial-result?fase=conf` }) };
}

// ---------------------------------------------------------------------------
// Atendente: quem está na ligação
// ---------------------------------------------------------------------------

export interface MonitorNotice {
  supervisorName: string;
  mode: CallMonitorMode;
  text: string;
}

/** O softphone do atendente pergunta durante a ligação: há gerente nela? (só o próprio atendente recebe a resposta) */
export async function monitorNoticeFor(userId: string, callSid: string): Promise<MonitorNotice | null> {
  const c = await getById<Communication>(COLLECTIONS.communications, callId(callSid));
  const m = c?.monitor;
  if (!c || c.userId !== userId || !m || m.state === "encerrada" || !m.supervisorCallSid) return null;
  return { supervisorName: m.supervisorName, mode: m.mode, text: `${m.supervisorName} ${CALL_MONITOR_AGENT_NOTICE[m.mode]}` };
}
