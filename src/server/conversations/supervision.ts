import "server-only";
/**
 * Central de Comando (supervisão digital, fase 2): painel ao vivo do gerente, acompanhar conversa (com registro de
 * quanto tempo), sussurro ao operador, escalar, registro de supervisão, painel para TV e alertas do gerente (agendador).
 *
 * Escopo: tela comunicacao.supervisao (gerente: as pessoas que lidera; direção: a empresa). Operadores = membros das
 * filas ativas dentro do escopo; conversas = as desses operadores + as que esperam nas filas deles.
 */
import { col, create, getById, getManyByIds, list, nowIso, ORG_ID, update } from "@/server/db";
import { notify } from "@/server/notifications";
import { emitEvent } from "@/server/events";
import { resolveDataScope } from "@/server/auth/scope";
import { computeSlaState } from "@/server/sla";
import { BusinessError } from "@/server/auth/error-classes";
import { COLLECTIONS, type BaseEntity, type CollectionName, type Communication, type Conversation, type ConversationChannel, type CurrentUser, type Department, type ServiceQueue, type SlaInstance, type SupervisionLog, type User, type UserRef } from "@/domain/types";
import { isOpenConversation } from "@/domain/conversations";
import { evaluateAlerts, minutesInState, operatorState, OPERATOR_STATE_LABELS, type ManagerAlert, type OperatorState } from "@/domain/central-ops";
import { listQueues } from "./queues";
import { buildThread, loadNames, nameOf, type ThreadEntry } from "./queries";
import { addConversationNote, assumeConversation, conversationHref, loadByAssignee, SYSTEM_ACTOR } from "./service";
import { getManagerAlertsConfig, getPauseReasons, writeSetting } from "./ops-settings";
import { patchFields } from "./store";

export const WHISPER_TEMPLATE_KEY = "sussurro";
const MONITOR_SESSION_GAP_MS = 2 * 60_000;

// ---------------------------------------------------------------------------
// Painel
// ---------------------------------------------------------------------------

export interface OperatorRow {
  id: string;
  name: string;
  department: string;
  state: OperatorState;
  stateLabel: string;
  pauseLabel?: string;
  /** Minutos no estado atual. */
  minutes?: number;
  /** Passou do limite do motivo de pausa. */
  pauseOverdue: boolean;
  load: number;
  limit: number;
  queues: string[];
  conversations: { id: string; number: string; name: string; channel: ConversationChannel; awaitingReply: boolean; waitingSince?: string; escalated: boolean }[];
}

export interface QueueNow {
  id: string;
  name: string;
  waiting: number;
  oldestWaitingSince?: string;
  available: number;
  members: number;
}

export interface CommandCenter {
  kpis: {
    operators: Record<OperatorState, number> & { total: number };
    active: number;
    activeByChannel: Record<ConversationChannel, number>;
    waiting: number;
    oldestWaitingSince?: string;
    /** % das conversas abertas hoje (com SLA) respondidas dentro do prazo da 1ª resposta. */
    slaFirstResponsePct?: number;
    /** Tempo médio de espera pela 1ª resposta hoje (ms). */
    avgWaitMs?: number;
    /** Tempo médio de atendimento das encerradas hoje (ms). */
    avgHandleMs?: number;
  };
  operators: OperatorRow[];
  queues: QueueNow[];
  /** Gargalos (fila com espera e ninguém disponível). */
  bottlenecks: string[];
  scopeKind: string;
  generatedAt: string;
}

/** Documentos da organização com `field` >= `since` (consulta por faixa; o `list` só faz igualdade). */
async function listSince<T extends BaseEntity>(name: CollectionName, field: string, since: string): Promise<T[]> {
  const snap = await col(name).where("organizationId", "==", ORG_ID).where(field, ">=", since).get();
  return snap.docs.map((d) => ({ ...(d.data() as Omit<T, "id">), id: d.id }) as T);
}

function startOfTodayBrt(now: number): string {
  const local = new Date(now - 3 * 3600_000);
  return new Date(Date.UTC(local.getUTCFullYear(), local.getUTCMonth(), local.getUTCDate()) + 3 * 3600_000).toISOString();
}

export async function getCommandCenter(user: CurrentUser, filters: { queueId?: string } = {}, now: number = Date.now()): Promise<CommandCenter> {
  const [scope, allQueues, pauseReasons] = await Promise.all([resolveDataScope(user, "comunicacao.supervisao"), listQueues(), getPauseReasons()]);
  const activeQueues = allQueues.filter((q) => q.active && (!filters.queueId || q.id === filters.queueId));
  const inScope = (id: string) => !scope.userIds || scope.userIds.has(id);
  const queueMemberIds = activeQueues.flatMap((q) => q.memberIds);
  const visibleQueues = scope.userIds ? activeQueues.filter((q) => q.memberIds.some(inScope)) : activeQueues;
  const visibleQueueIds = new Set(visibleQueues.map((q) => q.id));

  const [open, loads] = await Promise.all([list<Conversation>(COLLECTIONS.conversations, { where: [["status", "in", ["nova", "na_fila", "em_atendimento", "aguardando_cliente"]]] }), loadByAssignee()]);
  const openConvs = open.filter(isOpenConversation);
  // Operadores = membros das filas + quem está com atendimento aberto sem estar em fila (ex.: o gestor que assumiu).
  const memberIds = Array.from(new Set([...queueMemberIds, ...openConvs.map((c) => c.assigneeId ?? "")].filter(Boolean))).filter(inScope);
  const users = await getManyByIds<User>(COLLECTIONS.users, memberIds);
  const assigned = openConvs.filter((c) => c.assigneeId && inScope(c.assigneeId) && (!filters.queueId || c.queueId === filters.queueId));
  const waiting = openConvs.filter((c) => !c.assigneeId && c.queueId && visibleQueueIds.has(c.queueId));

  // Nomes dos contatos das conversas mostradas.
  const shown = [...assigned];
  const [clients, contacts, leads] = await Promise.all([
    getManyByIds<{ id: string; tradeName: string; organizationId: string; createdAt: string; updatedAt: string }>(COLLECTIONS.clients, shown.map((c) => c.clientId ?? "").filter(Boolean)),
    getManyByIds<{ id: string; name: string; organizationId: string; createdAt: string; updatedAt: string }>(COLLECTIONS.contacts, shown.map((c) => c.contactId ?? "").filter(Boolean)),
    getManyByIds<{ id: string; name: string; organizationId: string; createdAt: string; updatedAt: string }>(COLLECTIONS.leads, shown.map((c) => c.leadId ?? "").filter(Boolean)),
  ]);
  const contactName = (c: Conversation) => (c.contactId ? contacts.get(c.contactId)?.name : undefined) ?? (c.clientId ? clients.get(c.clientId)?.tradeName : undefined) ?? (c.leadId ? leads.get(c.leadId)?.name : undefined) ?? c.displayName ?? c.address;

  const reasonLabel = new Map(pauseReasons.map((r) => [r.key, r]));
  const operators: OperatorRow[] = memberIds
    .map((id): OperatorRow | null => {
      const u = users.get(id);
      if (!u || u.active === false) return null;
      const myQueues = activeQueues.filter((q) => q.memberIds.includes(id));
      const limit = u.central?.maxConcurrent ?? (myQueues.length ? Math.min(...myQueues.map((q) => q.maxConcurrent)) : 4);
      const load = loads.get(id) ?? 0;
      const state = operatorState(u, load, limit, now);
      const reason = u.pauseReasonKey ? reasonLabel.get(u.pauseReasonKey) : undefined;
      const minutes = minutesInState(u.presenceUpdatedAt, now);
      return {
        id,
        name: u.name,
        department: u.departmentId,
        state,
        stateLabel: OPERATOR_STATE_LABELS[state],
        pauseLabel: state === "pausa" ? reason?.label : undefined,
        minutes: state === "offline" ? undefined : minutes,
        pauseOverdue: state === "pausa" && Boolean(reason?.maxMinutes && minutes !== undefined && minutes > reason.maxMinutes),
        load,
        limit,
        queues: myQueues.map((q) => q.name),
        conversations: assigned
          .filter((c) => c.assigneeId === id)
          .sort((a, b) => Number(Boolean(b.escalatedAt)) - Number(Boolean(a.escalatedAt)) || Number(b.awaitingReply) - Number(a.awaitingReply))
          .map((c) => ({ id: c.id, number: c.number, name: contactName(c), channel: c.channel, awaitingReply: c.awaitingReply, waitingSince: c.awaitingReply ? c.lastInboundAt : undefined, escalated: Boolean(c.escalatedAt) })),
      };
    })
    .filter((x): x is OperatorRow => x !== null)
    .sort((a, b) => STATE_ORDER[a.state] - STATE_ORDER[b.state] || a.name.localeCompare(b.name, "pt-BR"));

  const available = (q: ServiceQueue) => operators.filter((o) => o.state === "disponivel" && q.memberIds.includes(o.id)).length;
  const queues: QueueNow[] = visibleQueues
    .map((q) => {
      const w = waiting.filter((c) => c.queueId === q.id);
      const oldest = w.map((c) => c.queuedAt ?? c.openedAt).sort()[0];
      return { id: q.id, name: q.name, waiting: w.length, oldestWaitingSince: oldest, available: available(q), members: q.memberIds.filter(inScope).length };
    })
    .sort((a, b) => b.waiting - a.waiting || a.name.localeCompare(b.name, "pt-BR"));
  const bottlenecks = queues
    .filter((q) => q.waiting > 0 && q.available === 0)
    .map((q) => (q.members === 0 ? `${q.name}: ${q.waiting} esperando e nenhum operador na fila.` : `${q.name}: ${q.waiting} esperando e nenhum operador disponível.`));

  // Indicadores de hoje.
  const today = startOfTodayBrt(now);
  const todays = (await listSince<Conversation>(COLLECTIONS.conversations, "openedAt", today)).filter((c) => !c.assigneeId || inScope(c.assigneeId));
  const responded = todays.filter((c) => c.firstResponseAt);
  const slas = await getManyByIds<SlaInstance>(COLLECTIONS.slaInstances, todays.map((c) => c.slaInstanceId ?? "").filter(Boolean));
  const withSla = todays.map((c) => (c.slaInstanceId ? slas.get(c.slaInstanceId) : undefined)).filter((s): s is SlaInstance => Boolean(s?.responseDueAt));
  const slaOk = withSla.filter((s) => s.respondedAt && s.responseDueAt && s.respondedAt <= s.responseDueAt).length;
  const closedToday = (await listSince<Conversation>(COLLECTIONS.conversations, "closedAt", today)).filter((c) => !c.assigneeId || inScope(c.assigneeId));
  const avg = (xs: number[]) => (xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : undefined);

  const count = (s: OperatorState) => operators.filter((o) => o.state === s).length;
  return {
    kpis: {
      operators: { total: operators.length, disponivel: count("disponivel"), ocupado: count("ocupado"), pausa: count("pausa"), ausente: count("ausente"), offline: count("offline") },
      active: assigned.length,
      activeByChannel: { whatsapp: assigned.filter((c) => c.channel === "whatsapp").length, email: assigned.filter((c) => c.channel === "email").length },
      waiting: waiting.length,
      oldestWaitingSince: waiting.map((c) => c.queuedAt ?? c.openedAt).sort()[0],
      slaFirstResponsePct: withSla.length ? Math.round((slaOk / withSla.length) * 100) : undefined,
      avgWaitMs: avg(responded.map((c) => new Date(c.firstResponseAt!).getTime() - new Date(c.openedAt).getTime()).filter((x) => x >= 0)),
      avgHandleMs: avg(closedToday.map((c) => new Date(c.closedAt!).getTime() - new Date(c.openedAt).getTime()).filter((x) => x >= 0)),
    },
    operators,
    queues,
    bottlenecks,
    scopeKind: scope.kind,
    generatedAt: new Date(now).toISOString(),
  };
}

const STATE_ORDER: Record<OperatorState, number> = { ocupado: 0, disponivel: 1, pausa: 2, ausente: 3, offline: 4 };

// ---------------------------------------------------------------------------
// Conversa supervisionada
// ---------------------------------------------------------------------------

/** A conversa é de um operador (ou fila) dentro do escopo da supervisão? */
export async function supervisedConversation(user: CurrentUser, id: string): Promise<Conversation | null> {
  const c = await getById<Conversation>(COLLECTIONS.conversations, id);
  if (!c) return null;
  const scope = await resolveDataScope(user, "comunicacao.supervisao");
  if (!scope.userIds) return c;
  if (c.assigneeId) return scope.userIds.has(c.assigneeId) ? c : null;
  const queue = c.queueId ? (await listQueues()).find((q) => q.id === c.queueId) : undefined;
  return queue && queue.memberIds.some((m) => scope.userIds!.has(m)) ? c : null;
}

export interface MonitoredConversation {
  id: string;
  number: string;
  channel: ConversationChannel;
  name: string;
  subtitle: string;
  assigneeId?: string;
  assigneeName?: string;
  queueName?: string;
  escalated: boolean;
  open: boolean;
  thread: ThreadEntry[];
}

/** Conversa acompanhada ao vivo (escopo da supervisão, não o da Central). */
export async function getMonitoredConversation(user: CurrentUser, id: string): Promise<MonitoredConversation | null> {
  const c = await supervisedConversation(user, id);
  if (!c) return null;
  const queues = await listQueues();
  const names = await loadNames([c], queues);
  const { name, subtitle } = nameOf(c, names);
  const messages = await list<Communication>(COLLECTIONS.communications, { where: [["conversationId", "==", c.id]] });
  const authors = await getManyByIds<User>(COLLECTIONS.users, [...messages.map((m) => m.userId ?? m.createdBy ?? ""), c.closedById ?? ""].filter(Boolean));
  return {
    id: c.id,
    number: c.number,
    channel: c.channel,
    name,
    subtitle,
    assigneeId: c.assigneeId,
    assigneeName: c.assigneeId ? names.users.get(c.assigneeId)?.name : undefined,
    queueName: c.queueId ? names.queues.get(c.queueId)?.name : undefined,
    escalated: Boolean(c.escalatedAt),
    open: isOpenConversation(c),
    thread: buildThread(c, messages, authors, { viewerId: user.id, customerName: name, customerRole: subtitle }),
  };
}

async function log(input: Omit<SupervisionLog, "id" | "organizationId" | "createdAt" | "updatedAt">): Promise<SupervisionLog> {
  return create<SupervisionLog>(COLLECTIONS.supervisionLogs, input);
}

/**
 * O gerente está com a conversa aberta na Central de Comando: abre (ou continua) a sessão de acompanhamento. A tela
 * chama a cada atualização; intervalo maior que 2 min começa outra sessão.
 */
export async function touchMonitoring(supervisor: UserRef, c: Conversation, now: number = Date.now()): Promise<SupervisionLog> {
  const at = new Date(now).toISOString();
  const mine = (await list<SupervisionLog>(COLLECTIONS.supervisionLogs, { where: [["conversationId", "==", c.id]] }))
    .filter((l) => l.supervisorId === supervisor.id && l.action === "acompanhar")
    .sort((a, b) => ((a.endedAt ?? a.startedAt) < (b.endedAt ?? b.startedAt) ? 1 : -1))[0];
  if (mine && now - new Date(mine.endedAt ?? mine.startedAt).getTime() <= MONITOR_SESSION_GAP_MS) {
    await update<SupervisionLog>(COLLECTIONS.supervisionLogs, mine.id, { endedAt: at });
    return { ...mine, endedAt: at };
  }
  return log({ supervisorId: supervisor.id, operatorId: c.assigneeId, conversationId: c.id, action: "acompanhar", startedAt: at, endedAt: at });
}

/** Sussurro: orientação privada ao operador (nota interna marcada; o cliente não vê) + aviso ao operador. */
export async function whisper(c: Conversation, body: string, supervisor: UserRef): Promise<Communication> {
  if (!isOpenConversation(c)) throw new BusinessError("O atendimento já foi encerrado");
  const note = await create<Communication>(COLLECTIONS.communications, {
    channel: "interno",
    direction: "saida",
    userId: supervisor.id,
    createdBy: supervisor.id,
    entityType: "conversation",
    entityId: c.id,
    body,
    templateKey: WHISPER_TEMPLATE_KEY,
    status: "enviada",
    provider: "manual",
    conversationId: c.id,
  });
  if (c.assigneeId && c.assigneeId !== supervisor.id) {
    await notify({ userIds: [c.assigneeId], kind: "acao", title: `${supervisor.name} sussurrou em ${c.number}`, body: body.length > 140 ? `${body.slice(0, 137)}…` : body, href: conversationHref(c.id), entity: { type: "conversation", id: c.id } });
  }
  await log({ supervisorId: supervisor.id, operatorId: c.assigneeId, conversationId: c.id, action: "sussurro", startedAt: nowIso(), detail: body.slice(0, 280) });
  return note;
}

/** Escalar: prioridade (topo da lista e da fila), nota e aviso a quem atende. */
export async function escalate(c: Conversation, reason: string, supervisor: UserRef): Promise<void> {
  if (!isOpenConversation(c)) throw new BusinessError("O atendimento já foi encerrado");
  if (c.escalatedAt) throw new BusinessError("Este atendimento já está escalado");
  await update<Conversation>(COLLECTIONS.conversations, c.id, { escalatedAt: nowIso(), escalatedById: supervisor.id });
  await addConversationNote(c.id, `Escalado por ${supervisor.name}${reason ? `: ${reason}` : ""}.`, SYSTEM_ACTOR);
  if (c.assigneeId && c.assigneeId !== supervisor.id) {
    await notify({ userIds: [c.assigneeId], kind: "acao", title: `Prioridade: ${c.number}`, body: reason || `${supervisor.name} escalou este atendimento.`, href: conversationHref(c.id), entity: { type: "conversation", id: c.id } });
  }
  await emitEvent({ type: "conversation.assigned", actor: supervisor, clientId: c.clientId, entity: { type: "conversation", id: c.id }, title: `${supervisor.name} escalou o atendimento ${c.number}`, payload: { conversationId: c.id, escalated: true }, timeline: false });
  await log({ supervisorId: supervisor.id, operatorId: c.assigneeId, conversationId: c.id, action: "escalar", startedAt: nowIso(), detail: reason || undefined });
}

/** O gerente assume a conversa do operador (com nota e registro). */
export async function superviseAssume(c: Conversation, supervisor: UserRef): Promise<Conversation> {
  const previous = c.assigneeId;
  const next = await assumeConversation(c.id, supervisor);
  await log({ supervisorId: supervisor.id, operatorId: previous, conversationId: c.id, action: "assumir", startedAt: nowIso() });
  return next;
}

/** Tira a prioridade quando a conversa encerra ou é atendida? Não: fica no histórico; a lista ordena só as abertas. */
export async function clearEscalation(conversationId: string): Promise<void> {
  await patchFields<Conversation>(COLLECTIONS.conversations, conversationId, { escalatedAt: undefined, escalatedById: undefined });
}

// ---------------------------------------------------------------------------
// Registro de supervisão
// ---------------------------------------------------------------------------

export interface SupervisionLogRow {
  id: string;
  at: string;
  durationMs?: number;
  supervisorName: string;
  operatorName?: string;
  /** Link do atendimento: a conversa na Central ou a ligação no histórico. */
  href?: string;
  /** Rótulo do link (número da conversa ou «Ligação»). */
  target?: string;
  action: SupervisionLog["action"];
  detail?: string;
}

export async function getSupervisionLog(user: CurrentUser, filters: { days: number; supervisorId?: string; operatorId?: string }): Promise<{ rows: SupervisionLogRow[]; supervisors: { id: string; name: string }[] }> {
  const since = new Date(Date.now() - filters.days * 86_400_000).toISOString();
  const scope = await resolveDataScope(user, "comunicacao.supervisao");
  let logs = (await listSince<SupervisionLog>(COLLECTIONS.supervisionLogs, "startedAt", since)).filter((l) => !scope.userIds || scope.userIds.has(l.supervisorId) || (l.operatorId && scope.userIds.has(l.operatorId)));
  const users = await getManyByIds<User>(COLLECTIONS.users, logs.flatMap((l) => [l.supervisorId, l.operatorId ?? ""]).filter(Boolean));
  const supervisors = Array.from(new Set(logs.map((l) => l.supervisorId))).map((id) => ({ id, name: users.get(id)?.name ?? "Usuário removido" }));
  if (filters.supervisorId) logs = logs.filter((l) => l.supervisorId === filters.supervisorId);
  if (filters.operatorId) logs = logs.filter((l) => l.operatorId === filters.operatorId);
  logs = logs.sort((a, b) => (a.startedAt < b.startedAt ? 1 : -1)).slice(0, 300);
  const convs = await getManyByIds<Conversation>(COLLECTIONS.conversations, logs.map((l) => l.conversationId ?? "").filter(Boolean));
  const timed = (a: SupervisionLog["action"]) => a === "acompanhar" || a.startsWith("ligacao_");
  return {
    rows: logs.map((l) => ({
      id: l.id,
      at: l.startedAt,
      durationMs: timed(l.action) && l.endedAt ? Math.max(0, new Date(l.endedAt).getTime() - new Date(l.startedAt).getTime()) : undefined,
      supervisorName: users.get(l.supervisorId)?.name ?? "Usuário removido",
      operatorName: l.operatorId ? users.get(l.operatorId)?.name : undefined,
      href: l.conversationId ? `/comunicacao?conversa=${l.conversationId}` : l.communicationId ? "/comunicacao/ligacoes" : undefined,
      target: l.conversationId ? (convs.get(l.conversationId)?.number ?? "abrir") : l.communicationId ? "Ligação" : undefined,
      action: l.action,
      detail: l.detail,
    })),
    supervisors: supervisors.sort((a, b) => a.name.localeCompare(b.name, "pt-BR")),
  };
}

// ---------------------------------------------------------------------------
// Alertas do gerente (agendador)
// ---------------------------------------------------------------------------

const ALERT_STATE_SETTING = "central_alertas_estado";

/** Gestores de quem: o gestor direto do operador e o gestor do departamento da fila (sem eles, os admins). */
async function managersIndex(): Promise<{ ofUser: (id: string | undefined) => string[]; ofDepartment: (key: string) => string[] }> {
  const [users, departments] = await Promise.all([list<User>(COLLECTIONS.users), list<Department>(COLLECTIONS.departments)]);
  const admins = users.filter((u) => u.active !== false && u.role === "admin").map((u) => u.id);
  const byId = new Map(users.map((u) => [u.id, u]));
  const deptManager = new Map(departments.map((d) => [d.key as string, d.managerId]));
  const withFallback = (ids: (string | undefined)[]) => {
    const out = Array.from(new Set(ids.filter((x): x is string => Boolean(x) && byId.get(x!)?.active !== false)));
    return out.length ? out : admins;
  };
  return {
    ofUser: (id) => {
      const u = id ? byId.get(id) : undefined;
      return withFallback([u?.managerId, u ? deptManager.get(u.departmentId) : undefined]);
    },
    ofDepartment: (key) => withFallback([deptManager.get(key)]),
  };
}

/** Avalia e envia os alertas do gerente (cada um no máximo a cada `repeatMinutes`). Devolve quantos saíram. */
export async function runManagerAlerts(now: number = Date.now()): Promise<number> {
  const config = await getManagerAlertsConfig();
  if (!config.queue.active && !config.sla.active && !config.idle.active && !config.pause.active) return 0;
  const [queues, open, pauseReasons, mgr, users] = await Promise.all([
    listQueues(),
    list<Conversation>(COLLECTIONS.conversations, { where: [["status", "in", ["nova", "na_fila", "em_atendimento", "aguardando_cliente"]]] }),
    getPauseReasons(),
    managersIndex(),
    list<User>(COLLECTIONS.users),
  ]);
  const openConvs = open.filter(isOpenConversation);
  const slas = await getManyByIds<SlaInstance>(COLLECTIONS.slaInstances, openConvs.map((c) => c.slaInstanceId ?? "").filter(Boolean));
  const queueDept = new Map(queues.map((q) => [q.id, q.department as string]));
  const memberSet = new Set(queues.filter((q) => q.active).flatMap((q) => q.memberIds));
  const alerts: ManagerAlert[] = evaluateAlerts(
    {
      queues: queues
        .filter((q) => q.active)
        .map((q) => {
          const w = openConvs.filter((c) => !c.assigneeId && c.queueId === q.id);
          return { id: q.id, name: q.name, waiting: w.length, oldestWaitingSince: w.map((c) => c.queuedAt ?? c.openedAt).sort()[0], managerIds: mgr.ofDepartment(q.department) };
        }),
      conversations: openConvs.map((c) => {
        const sla = c.slaInstanceId ? slas.get(c.slaInstanceId) : undefined;
        return {
          id: c.id,
          number: c.number,
          queueId: c.queueId,
          assigneeId: c.assigneeId,
          awaitingReply: c.awaitingReply,
          waitingSince: c.awaitingReply ? c.lastInboundAt : undefined,
          slaState: sla ? computeSlaState(sla, new Date(now)).state : undefined,
          managerIds: c.assigneeId ? mgr.ofUser(c.assigneeId) : c.queueId ? mgr.ofDepartment(queueDept.get(c.queueId) ?? "") : [],
        };
      }),
      operators: users.filter((u) => u.active !== false && memberSet.has(u.id)).map((u) => ({ id: u.id, name: u.name, presence: u.presence, presenceUpdatedAt: u.presenceUpdatedAt, pauseReasonKey: u.pauseReasonKey, managerIds: mgr.ofUser(u.id) })),
      pauseReasons,
    },
    config,
    now,
  );
  if (alerts.length === 0) return 0;

  const stateDoc = (await list<{ id: string; organizationId: string; createdAt: string; updatedAt: string; key: string; value: Record<string, string> }>(COLLECTIONS.settings, { where: [["key", "==", ALERT_STATE_SETTING]] }))[0];
  const sent: Record<string, string> = { ...(stateDoc?.value ?? {}) };
  const repeatMs = Math.max(5, config.repeatMinutes) * 60_000;
  let count = 0;
  for (const a of alerts) {
    const last = sent[a.key];
    if (last && now - new Date(last).getTime() < repeatMs) continue;
    await notify({ userIds: a.userIds, kind: "acao", title: a.title, body: a.body, href: a.href });
    sent[a.key] = new Date(now).toISOString();
    count += 1;
  }
  // Esquece o que não alerta há mais de um dia (o estado não cresce para sempre).
  for (const [k, v] of Object.entries(sent)) if (now - new Date(v).getTime() > 86_400_000) delete sent[k];
  await writeSetting(ALERT_STATE_SETTING, sent, "Controle de repetição dos alertas do gerente (Central de Atendimento).");
  return count;
}
