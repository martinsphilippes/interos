import "server-only";

/**
 * Eventos ERP → INTEROS (webhook `POST /api/webhooks/erp`). O ERP avisa na hora o que antes só a rotina de 5 minutos
 * descobria (ou nem descobria): licença aplicada ou recusada, mudança automática de módulos (fim de teste, ativação ou
 * suspensão agendada), pedido de módulo feito por alguém da empresa, limite do contrato atingido e ERP sem licença nova.
 *
 * Garantias:
 * - Só processa evento assinado (`X-ERP-Signature`, HMAC-SHA256 com `ERP_INTERCERT_SEGREDO_EVENTOS`, ±5 min; o ERP
 *   assina de novo a cada tentativa).
 * - Uma vez só por `eventId`: o registro em `erp_events` é reservado em transação (a leitura trava o documento, mesmo
 *   ausente). Entrega repetida responde 200 sem repetir nada; entrega simultânea à que está em andamento responde 503
 *   (o ERP tenta de novo depois); processamento interrompido há mais de 2 minutos é retomado.
 * - O aviso de licença não muda nada sozinho: só antecipa a mesma conferência da rotina (relê o histórico do ERP), então
 *   a verdade continua sendo o que o ERP registrou.
 * - Tarefas com id fixo por chave (o mesmo pedido, ou o mesmo limite no mês, nunca vira duas tarefas).
 * - "ERP sem licença nova" chega todo dia para cada empresa sem mudança há mais de 3 dias (o INTEROS só envia quando
 *   algo muda): fica UM registro por empresa, atualizado, só informativo.
 * - Respostas: 503 sem configuração ou em processamento · 413 corpo grande · 401 assinatura · 400 corpo inválido ·
 *   200 recebido (inclusive ignorado ou repetido: o ERP não reenvia) · 500 falha (o ERP repete até 12 vezes).
 */
import { createHash } from "node:crypto";
import { COLLECTIONS, type BaseEntity, type Client, type Task, type User, type UserRef } from "@/domain/types";
import type { DepartmentKey } from "@/domain/constants";
import { ERP_CHANGE_STATUS_LABELS, type ErpChangeRequest, type ErpEnvironment, type ErpLink } from "@/domain/erp/types";
import {
  companyStateLabel,
  eventLicenseVersion,
  limitOf,
  moduleRequestOf,
  monthOf,
  parseErpEvent,
  rejectedItemsOf,
  transitionChangeMap,
  transitionChangesOf,
  type ErpEventType,
  type ErpInboundEvent,
  type ErpInboundStatus,
} from "@/domain/erp/events";
import { col, getById, list, nowIso, ORG_ID, orgQuery, stripUndefined, txGetOwn, update } from "@/server/db";
import { docdb, type Transaction } from "@/server/docdb";
import { emitEvent } from "@/server/events";
import { createTaskInternal } from "@/server/tasks/service";
import { getErpConfig } from "./config";
import { verifySignature } from "./signature";
import { getChange, reconcileChange } from "./changes";

export const ERP_EVENTS_MAX_BYTES = 64 * 1024;
/** Processamento parado há mais que isso (queda no meio) pode ser retomado por uma nova entrega. */
export const ERP_EVENT_LEASE_MS = 2 * 60_000;
export const ERP_EVENTS_ACTOR: UserRef = { id: "system", name: "ERP Intercert (eventos)" };

export interface ErpInboundRecord extends BaseEntity {
  environment: ErpEnvironment;
  eventId: string;
  type: string;
  erpCompanyId: string;
  clientId: string | null;
  at: string;
  data: Record<string, unknown>;
  status: ErpInboundStatus;
  attempts: number;
  receivedAt: string;
  claimedAt: string;
  processedAt: string | null;
  outcome: string | null;
  error: string | null;
  /** O registro no histórico do cliente já foi feito (não repete numa retomada). */
  timelineEmitted: boolean;
}

export interface ErpReceiveResult {
  status: number;
  body: Record<string, unknown>;
  /** Cliente afetado (para revalidar a ficha). */
  clientId?: string | null;
}

const ref = (id: string) => col(COLLECTIONS.erpEvents).doc(id);
const sha = (value: string, size: number) => createHash("sha256").update(value, "utf8").digest("hex").slice(0, size);

/** Id do registro: ambiente + hash do eventId do ERP (o eventId tem ":" e "." e pode passar de 64 caracteres). */
export function erpEventDocId(environment: ErpEnvironment, eventId: string): string {
  return `${environment}__${sha(eventId, 40)}`;
}

/** Registro único (atualizado) do aviso "ERP sem licença nova" de uma empresa. */
export function erpStaleDocId(environment: ErpEnvironment, erpCompanyId: string): string {
  return `${environment}__stale__${erpCompanyId}`;
}

/** Id fixo da tarefa de uma chave (o mesmo pedido, ou o mesmo limite no mês, nunca vira duas tarefas). */
export function erpTaskId(key: string): string {
  return `tsk_erp_${sha(key, 32)}`;
}

export async function receiveErpEvent(input: { rawBody: string; signature: string | null; now?: Date }): Promise<ErpReceiveResult> {
  const now = input.now ?? new Date();
  const config = getErpConfig();
  if (!config?.eventsSecret) return { status: 503, body: { error: "Recebimento de eventos do ERP não configurado (ERP_INTERCERT_URL, ERP_INTERCERT_AMBIENTE e ERP_INTERCERT_SEGREDO_EVENTOS)." } };
  if (Buffer.byteLength(input.rawBody, "utf8") > ERP_EVENTS_MAX_BYTES) return { status: 413, body: { error: "Corpo acima de 64 KB." } };
  const check = verifySignature(config.eventsSecret, input.signature, input.rawBody, now.getTime());
  if (check !== "ok") return { status: 401, body: { error: "Assinatura do evento inválida.", reason: check } };

  let raw: unknown;
  try {
    raw = JSON.parse(input.rawBody);
  } catch {
    return { status: 400, body: { error: "Corpo JSON inválido." } };
  }
  const parsed = parseErpEvent(raw);
  if (!parsed.ok) return { status: 400, body: { error: parsed.error } };
  const event = parsed.event;
  const environment = config.environment;

  if (event.type === "sync.stale") {
    try {
      return await recordStale(environment, event, now);
    } catch (error) {
      console.error(`[erp:eventos] falha ao registrar ${event.type} (${event.eventId})`, error);
      return { status: 500, body: { error: "Falha ao registrar o evento; o ERP tenta de novo." } };
    }
  }

  const id = erpEventDocId(environment, event.eventId);
  const claim = await claimEvent(id, environment, event, now);
  if (claim.kind === "duplicado") return { status: 200, body: { received: true, duplicate: true, status: claim.record.status } };
  if (claim.kind === "ocupado") return { status: 503, body: { error: "Este evento está sendo processado; tente de novo em instantes." } };

  try {
    const result = await processEvent(environment, event, claim.record);
    await update<ErpInboundRecord>(COLLECTIONS.erpEvents, id, { status: result.status, outcome: result.outcome, clientId: result.clientId, processedAt: nowIso(), error: null });
    return { status: 200, body: { received: true, status: result.status }, clientId: result.clientId };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    console.error(`[erp:eventos] falha ao processar ${event.type} (${event.eventId})`, error);
    await update<ErpInboundRecord>(COLLECTIONS.erpEvents, id, { status: "falhou", error: message.slice(0, 500) }).catch(() => undefined);
    return { status: 500, body: { error: "Falha ao processar o evento; o ERP tenta de novo." } };
  }
}

type Claim = { kind: "novo" | "retomado"; record: ErpInboundRecord } | { kind: "duplicado"; record: ErpInboundRecord } | { kind: "ocupado" };

/** Reserva o evento para processar (uma entrega por vez; repetida depois de concluída = duplicada). */
async function claimEvent(id: string, environment: ErpEnvironment, event: ErpInboundEvent, now: Date): Promise<Claim> {
  const at = now.toISOString();
  return docdb.runTransaction(async (tx: Transaction): Promise<Claim> => {
    const snap = await txGetOwn(tx, ref(id));
    if (!snap) {
      const record: ErpInboundRecord = {
        id,
        organizationId: ORG_ID,
        createdAt: at,
        updatedAt: at,
        environment,
        eventId: event.eventId,
        type: event.type,
        erpCompanyId: event.erpCompanyId,
        clientId: null,
        at: event.at,
        data: event.data,
        status: "processando",
        attempts: 1,
        receivedAt: at,
        claimedAt: at,
        processedAt: null,
        outcome: null,
        error: null,
        timelineEmitted: false,
      };
      tx.set(ref(id), stripUndefined({ ...record, id: undefined }));
      return { kind: "novo", record };
    }
    const current = { ...(snap.data() as Omit<ErpInboundRecord, "id">), id } as ErpInboundRecord;
    if (current.status === "processado" || current.status === "ignorado") return { kind: "duplicado", record: current };
    if (current.status === "processando" && now.getTime() - Date.parse(current.claimedAt) < ERP_EVENT_LEASE_MS) return { kind: "ocupado" };
    const next: ErpInboundRecord = { ...current, status: "processando", attempts: (current.attempts ?? 1) + 1, claimedAt: at, updatedAt: at, error: null };
    tx.set(ref(id), stripUndefined({ ...next, id: undefined }));
    return { kind: "retomado", record: next };
  });
}

async function findLink(environment: ErpEnvironment, erpCompanyId: string): Promise<ErpLink | null> {
  const links = await list<ErpLink>(COLLECTIONS.erpLinks, { where: [["erpCompanyId", "==", erpCompanyId], ["environment", "==", environment], ["status", "==", "ativo"]] });
  return links.find((l) => Boolean(l.clientId)) ?? null;
}

/** "ERP sem licença nova": sem efeito (o INTEROS só envia quando algo muda); um registro por empresa, atualizado. */
async function recordStale(environment: ErpEnvironment, event: ErpInboundEvent, now: Date): Promise<ErpReceiveResult> {
  const id = erpStaleDocId(environment, event.erpCompanyId);
  const link = await findLink(environment, event.erpCompanyId);
  const age = typeof event.data.ageDays === "number" && Number.isFinite(event.data.ageDays) ? event.data.ageDays : null;
  const at = now.toISOString();
  const previous = await getById<ErpInboundRecord>(COLLECTIONS.erpEvents, id);
  // Nova tentativa atrasada de um aviso mais antigo não apaga o mais recente.
  if (previous && previous.at > event.at) return { status: 200, body: { received: true, status: previous.status } };
  const record: Omit<ErpInboundRecord, "id"> = {
    organizationId: ORG_ID,
    createdAt: previous?.createdAt ?? at,
    updatedAt: at,
    environment,
    eventId: event.eventId,
    type: event.type,
    erpCompanyId: event.erpCompanyId,
    clientId: link?.clientId ?? null,
    at: event.at,
    data: event.data,
    status: link ? "processado" : "ignorado",
    attempts: (previous?.attempts ?? 0) + 1,
    receivedAt: at,
    claimedAt: at,
    processedAt: at,
    outcome: link
      ? `Informativo: o ERP não recebe licença nova desta empresa há ${age ?? "alguns"} dia(s) (normal quando nada mudou no contrato).`
      : "Empresa do ERP sem vínculo ativo com um cliente do INTEROS.",
    error: null,
    timelineEmitted: false,
  };
  await ref(id).set(stripUndefined(record));
  return { status: 200, body: { received: true, status: record.status } };
}

interface Outcome {
  status: "processado" | "ignorado";
  outcome: string;
  clientId: string | null;
}

async function processEvent(environment: ErpEnvironment, event: ErpInboundEvent, record: ErpInboundRecord): Promise<Outcome> {
  if (!event.known) return { status: "ignorado", outcome: `Tipo "${event.type}" ainda não tratado pelo INTEROS.`, clientId: null };
  const link = await findLink(environment, event.erpCompanyId);
  if (!link) return { status: "ignorado", outcome: "Empresa do ERP sem vínculo ativo com um cliente do INTEROS.", clientId: null };
  const clientId = link.clientId;
  /** Linha no histórico do cliente uma vez só por evento (mesmo se o processamento for retomado). */
  const once = async (input: Omit<TimelineInput, "clientId" | "recordId">) => {
    if (record.timelineEmitted) return;
    await emitTimeline({ ...input, clientId, recordId: record.id });
    record.timelineEmitted = true;
    await update<ErpInboundRecord>(COLLECTIONS.erpEvents, record.id, { timelineEmitted: true, clientId });
  };

  switch (event.type as ErpEventType) {
    case "license.applied":
    case "license.rejected":
      return { status: "processado", outcome: await confirmLicense(environment, event, clientId), clientId };
    case "license.transition": {
      const changes = transitionChangesOf(event);
      const companyState = typeof event.data.companyState === "string" ? event.data.companyState : null;
      const summary = changes.slice(0, 8).map((c) => `${c.code}${c.to ? ` ${c.to}` : ""}`);
      await once({
        type: "erp.license_transition",
        title: "Mudança automática de módulos no ERP",
        description: [summary.length ? `${summary.join(", ")}${changes.length > summary.length ? "…" : ""}` : null, companyState ? `situação da empresa: ${companyStateLabel(companyState)}` : null].filter(Boolean).join(" · ") || undefined,
        payload: { erpEventId: event.eventId, licenseVersion: eventLicenseVersion(event), changes: transitionChangeMap(changes), items: changes, companyState },
      });
      return { status: "processado", outcome: `${changes.length} mudança(s) registrada(s) no histórico do cliente.`, clientId };
    }
    case "upsell.requested": {
      const req = moduleRequestOf(event);
      const label = [req.code, req.name ?? req.module].filter(Boolean).join(" ") || "um módulo";
      await once({ type: "erp.module_requested", title: `Pediram ${label} no ERP`, description: "Pedido feito por alguém da empresa na tela de módulo não contratado do ERP.", payload: { erpEventId: event.eventId, ...req } });
      const task = await commercialTask({
        clientId,
        key: `erp-pedido:${environment}:${event.erpCompanyId}:${req.requestId ?? req.code ?? event.eventId}`,
        title: `Pedido de módulo no ERP: ${label}`,
        description: `Alguém da empresa pediu ${label} pelo ERP em ${brDate(event.at)}. Fale com o cliente; se fechar, inclua o módulo pela aba Módulos ERP (com aditivo, se houver).`,
      });
      return { status: "processado", outcome: task.created ? task.outcome : `Pedido já registrado: ${task.outcome}`, clientId };
    }
    case "limit.reached": {
      const l = limitOf(event);
      const usage = l.used !== null && l.limit !== null ? ` (${l.used} de ${l.limit})` : "";
      const month = l.month ?? monthOf(event.at);
      const key = `erp-limite:${environment}:${event.erpCompanyId}:${l.kind}:${month}`;
      // O ERP avisa no máximo uma vez por dia e tipo; o histórico e a tarefa são um por mês e tipo.
      const existing = await getById<Task>(COLLECTIONS.tasks, erpTaskId(key));
      if (existing) return { status: "processado", outcome: `Limite já avisado neste mês (tarefa de ${existing.assigneeName ?? "vendas, sem responsável"}).`, clientId };
      await once({
        type: "erp.limit_reached",
        title: `Limite de ${l.label} atingido no ERP${usage}`,
        description: l.blocking ? "O ERP não deixa passar do limite contratado." : "Aviso: o ERP não bloqueia, mas o contrato prevê este limite.",
        payload: { erpEventId: event.eventId, ...l, month },
      });
      const task = await commercialTask({
        clientId,
        key,
        title: `Cliente no limite de ${l.label} do contrato${usage}`,
        description: `O ERP avisou em ${brDate(event.at)} que a empresa chegou ao limite de ${l.label}${usage}. ${l.blocking ? "O ERP bloqueia novos cadastros acima do limite." : "O ERP não bloqueia."} Oportunidade de ampliar o contrato; confira com o cliente.`,
      });
      return { status: "processado", outcome: task.outcome, clientId };
    }
    default:
      return { status: "ignorado", outcome: `Tipo "${event.type}" ainda não tratado pelo INTEROS.`, clientId };
  }
}

const brDate = (iso: string) => iso.slice(0, 10).split("-").reverse().join("/");

/** Licença aplicada/recusada: conclui a alteração que ficou aguardando a resposta, conferindo no histórico do ERP. */
async function confirmLicense(environment: ErpEnvironment, event: ErpInboundEvent, clientId: string): Promise<string> {
  const version = eventLicenseVersion(event);
  if (!version) return "Aviso sem versão de licença: nada a conferir.";
  const changes = await list<ErpChangeRequest>(COLLECTIONS.erpChangeRequests, { where: [["clientId", "==", clientId], ["environment", "==", environment], ["licenseVersion", "==", version]] });
  const change = changes.find((c) => c.kind === "licenca") ?? null;
  const rejected = event.type === "license.rejected" ? rejectedItemsOf(event).map((r) => `${r.code}: ${r.message}`).join("; ") : "";
  const detail = rejected ? ` Recusados: ${rejected}` : "";
  if (!change) return `Nenhuma alteração do INTEROS com a versão ${version}.${detail}`;
  if (change.status === "enviando" || change.status === "falhou") {
    if (await reconcileChange(change)) {
      const fresh = await getChange(change.id);
      return `Alteração concluída pelo aviso do ERP (${fresh ? ERP_CHANGE_STATUS_LABELS[fresh.status] : "atualizada"}).${detail}`;
    }
    return `O histórico do ERP ainda não mostra a versão ${version}; a rotina confere de novo.${detail}`;
  }
  return `A alteração já estava concluída (${ERP_CHANGE_STATUS_LABELS[change.status]}).`;
}

interface TimelineInput {
  type: "erp.license_transition" | "erp.module_requested" | "erp.limit_reached";
  clientId: string;
  recordId: string;
  title: string;
  description?: string;
  payload: Record<string, unknown>;
}

async function emitTimeline(input: TimelineInput): Promise<void> {
  await emitEvent({ type: input.type, actor: ERP_EVENTS_ACTOR, clientId: input.clientId, entity: { type: "erp_event", id: input.recordId }, title: input.title, description: input.description, payload: input.payload });
}

/**
 * Tarefa comercial (uma por chave, com id fixo: entregas simultâneas não duplicam) para o comercial do cliente, ou o CS
 * se não houver; sem responsável ativo, fica sem responsável no departamento de vendas. O responsável é avisado pela
 * notificação padrão de tarefa atribuída.
 */
async function commercialTask(input: { clientId: string; key: string; title: string; description: string }): Promise<{ created: boolean; outcome: string }> {
  const id = erpTaskId(input.key);
  const existing = await getById<Task>(COLLECTIONS.tasks, id);
  if (existing) return { created: false, outcome: `tarefa de ${existing.assigneeName ?? "vendas, sem responsável"}.` };
  const client = await getById<Client>(COLLECTIONS.clients, input.clientId);
  const candidates: { id: string | undefined; department: DepartmentKey }[] = [
    { id: client?.ownerSalesId, department: "vendas" },
    { id: client?.ownerCsId, department: "cs" },
  ];
  let assignee: User | null = null;
  let department: DepartmentKey = "vendas";
  for (const c of candidates) {
    if (!c.id) continue;
    const user = await getById<User>(COLLECTIONS.users, c.id);
    if (user && user.active !== false) {
      assignee = user;
      department = c.department;
      break;
    }
  }
  const task = await createTaskInternal(
    {
      id,
      title: input.title,
      description: input.description,
      clientId: input.clientId,
      assigneeId: assignee?.id,
      departmentId: department,
      priority: "alta",
      dueAt: new Date(Date.now() + 2 * 86_400_000).toISOString(),
      origin: "evento",
      sourceEventId: input.key,
      tags: ["erp", "oportunidade"],
    },
    ERP_EVENTS_ACTOR,
  );
  return { created: true, outcome: `Tarefa criada para ${task.assigneeName ?? "vendas (cliente sem responsável comercial)"}.` };
}

export interface ErpEventsOverview {
  recent: ErpInboundRecord[];
  /** Empresas com o aviso diário "ERP sem licença nova" (informativo). */
  staleCompanies: number;
  lastReceivedAt: string | null;
}

/** Últimos eventos do ambiente (Administração › Integrações), sem o aviso diário de licença sem novidade. */
export async function getErpEventsOverview(environment: ErpEnvironment, limit = 20): Promise<ErpEventsOverview> {
  const [recentSnap, staleSnap] = await Promise.all([
    orgQuery(COLLECTIONS.erpEvents, [["environment", "==", environment], ["type", "!=", "sync.stale"]]).orderBy("receivedAt", "desc").limit(limit).get(),
    orgQuery(COLLECTIONS.erpEvents, [["environment", "==", environment], ["type", "==", "sync.stale"]]).orderBy("receivedAt", "desc").get(),
  ]);
  const recent = recentSnap.docs.map((d) => ({ ...(d.data() as Omit<ErpInboundRecord, "id">), id: d.id }) as ErpInboundRecord);
  const stale = staleSnap.docs.map((d) => d.data() as Omit<ErpInboundRecord, "id">);
  const latest = [recent[0]?.receivedAt, stale[0]?.receivedAt].filter((v): v is string => Boolean(v)).sort().pop() ?? null;
  return { recent, staleCompanies: stale.filter((s) => s.status === "processado").length, lastReceivedAt: latest };
}
