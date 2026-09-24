import "server-only";
/**
 * Leituras do workspace da Central de Vendas (/vendas): fila "Meu funil" com KPIs e a oportunidade
 * selecionada com conversa (timeline do cliente + communications), contexto do cliente, localização,
 * próximas ações e interesses. Só igualdades via `list()`; agregação e ordenação em memória.
 */
import { getById, getManyByIds, list } from "@/server/db";
import { runDueSweeps } from "@/server/automations/lazy";
import { dateKey } from "@/lib/format";
import {
  COLLECTIONS,
  type Client,
  type CurrentUser,
  type DomainEvent,
  type Lead,
  type Opportunity,
  type Product,
  type Proposal,
  type Task,
  type Visit,
} from "@/domain/types";
import type { EventType } from "@/domain/constants";
import type { CommunicationRecord } from "@/domain/sales-extra";
import { effectiveProposalStatus, isOpenStage, opportunityCode } from "@/components/sales/model";
import { getSalesChannelStatus, type SalesChannelStatus } from "./channels";
import { HEADQUARTERS, formatAddressLine, geocode, googleMapsDirectionsUrl, googleMapsEmbedUrl, googleMapsSearchUrl, route } from "./maps";
import { canSeeOpportunity, getOpportunityDetail, listSalesUsers, resolveScope, toLite, toVisitRows, todayKey, type OpportunityDetail, type SalesScope, type UserLite, type VisitRow } from "./queries";
import { getPipelineStages, type PipelineStage } from "./service";

// ---------------------------------------------------------------------------
// Fila "Meu funil"
// ---------------------------------------------------------------------------

export const WORKSPACE_QUEUES = ["todos", "novos", "contato", "proposta", "negociacao", "visita", "followup", "ganhos", "perdidos"] as const;
export type WorkspaceQueue = (typeof WORKSPACE_QUEUES)[number];

export type LastChannel = "whatsapp" | "voip" | "email" | "visita";

export interface WorkspaceQueueItem {
  id: string;
  code: string;
  title: string;
  clientId: string;
  clientName: string;
  clientCity?: string;
  productsLabel: string;
  monthlyTotal: number;
  setupTotal: number;
  hardwareTotal: number;
  stage: Opportunity["stage"];
  temperature: Opportunity["temperature"];
  nextAction?: string;
  nextActionAt?: string;
  /** Próxima ação vencida ou para hoje. */
  followupDue: boolean;
  overdue: boolean;
  pendingVisitAt?: string;
  lastChannel?: LastChannel;
  lastActivityAt: string;
  ownerId: string;
  ownerName: string;
  queues: WorkspaceQueue[];
}

export interface WorkspaceKpis {
  /** Oportunidades abertas em qualificação (ainda não trabalhadas). */
  newLeads: number;
  /** Negociação + fechamento. */
  negotiating: number;
  /** Propostas (versão vigente) enviadas, visualizadas ou em negociação e dentro da validade. */
  proposalsSent: number;
  /** Visitas agendadas/remarcadas de hoje em diante. */
  visitsScheduled: number;
  wonMonth: number;
  createdMonth: number;
  /** Ganhas no mês / criadas no mês (mesma fórmula do Painel). */
  conversion: number | null;
}

export interface SalesWorkspaceData {
  scope: SalesScope;
  stages: PipelineStage[];
  kpis: WorkspaceKpis;
  items: WorkspaceQueueItem[];
}

const PENDING_VISIT = new Set<Visit["status"]>(["agendada", "remarcada"]);
const OPEN_TASK = new Set<Task["status"]>(["aberta", "em_andamento", "aguardando"]);
const SENT_PROPOSAL = new Set<Proposal["status"]>(["enviada", "visualizada", "negociacao"]);
/** Comunicações com o cliente sem vínculo a outro processo (ticket, projeto, contrato...). */
const COMM_ENTITY_OK = new Set(["client", "contact"]);

/** Abas da fila em que a oportunidade aparece. */
function queuesOf(opp: Opportunity, followupDue: boolean, hasPendingVisit: boolean): WorkspaceQueue[] {
  const out: WorkspaceQueue[] = ["todos"];
  if (opp.stage === "qualificacao") out.push("novos");
  if (opp.stage === "diagnostico") out.push("contato");
  if (opp.stage === "proposta") out.push("proposta");
  if (opp.stage === "negociacao" || opp.stage === "fechamento") out.push("negociacao");
  if (opp.stage === "ganho") out.push("ganhos");
  if (opp.stage === "perdido") out.push("perdidos");
  if (isOpenStage(opp.stage) && hasPendingVisit) out.push("visita");
  if (followupDue) out.push("followup");
  return out;
}

function productsLabel(opp: Opportunity): string {
  const names = opp.products.map((p) => p.productName);
  if (names.length === 0) return "Sem produtos";
  return names.length > 2 ? `${names.slice(0, 2).join(" + ")} +${names.length - 2}` : names.join(" + ");
}

/** Canal da última interação: comunicação mais recente da oportunidade/cliente, ou visita pendente. */
function lastChannelOf(comms: CommunicationRecord[] | undefined, hasPendingVisit: boolean): LastChannel | undefined {
  if (hasPendingVisit) return "visita";
  const last = comms?.[0];
  if (!last) return undefined;
  if (last.channel === "whatsapp" || last.channel === "voip" || last.channel === "email") return last.channel;
  return undefined;
}

/**
 * Fila do workspace no escopo pedido ("meu": dono ou quem originou; "equipe": gestor e liderados, ou o
 * time de vendas para diretoria/admin) e KPIs do topo, com os mesmos dados da fila.
 */
export async function getSalesWorkspace(user: CurrentUser, escopo?: string): Promise<SalesWorkspaceData> {
  // Mesma varredura central de follow-up disparada pela Central (automações, no máximo na frequência configurada).
  await runDueSweeps(["followup_vendas"]);
  const scope = await resolveScope(user, escopo);
  const ids = new Set(scope.userIds);
  const [all, stages, visits, comms, proposals] = await Promise.all([
    list<Opportunity>(COLLECTIONS.opportunities),
    getPipelineStages(),
    list<Visit>(COLLECTIONS.visits),
    list<CommunicationRecord>(COLLECTIONS.communications),
    list<Proposal>(COLLECTIONS.proposals),
  ]);
  const mine = all.filter((o) => ids.has(o.ownerId) || (scope.kind === "meu" && o.originUserId === user.id));
  const [clients, owners] = await Promise.all([
    getManyByIds<Client>(COLLECTIONS.clients, mine.map((o) => o.clientId)),
    getManyByIds<{ id: string; organizationId: string; createdAt: string; updatedAt: string; name: string }>(COLLECTIONS.users, mine.map((o) => o.ownerId)),
  ]);

  const nowIso = new Date().toISOString();
  const today = todayKey();

  // Visita pendente mais próxima por oportunidade.
  const nextVisit = new Map<string, string>();
  for (const v of visits) {
    if (!v.opportunityId || !PENDING_VISIT.has(v.status)) continue;
    const current = nextVisit.get(v.opportunityId);
    if (!current || v.scheduledAt < current) nextVisit.set(v.opportunityId, v.scheduledAt);
  }
  // Comunicações por oportunidade e por cliente (sem entidade específica), mais recentes primeiro.
  comms.sort((a, b) => (a.createdAt < b.createdAt ? 1 : -1));
  const commsByOpp = new Map<string, CommunicationRecord[]>();
  const commsByClient = new Map<string, CommunicationRecord[]>();
  const push = (map: Map<string, CommunicationRecord[]>, key: string, c: CommunicationRecord) => {
    const current = map.get(key);
    if (current) current.push(c);
    else map.set(key, [c]);
  };
  for (const c of comms) {
    if (c.entityType === "opportunity" && c.entityId) push(commsByOpp, c.entityId, c);
    else if (c.clientId && (!c.entityType || COMM_ENTITY_OK.has(c.entityType))) push(commsByClient, c.clientId, c);
  }

  const items: WorkspaceQueueItem[] = mine.map((o) => {
    const client = clients.get(o.clientId);
    const open = isOpenStage(o.stage);
    const followupDue = open && Boolean(o.nextActionAt && dateKey(o.nextActionAt) <= today);
    const pendingVisitAt = nextVisit.get(o.id);
    const oppComms = [...(commsByOpp.get(o.id) ?? []), ...(commsByClient.get(o.clientId) ?? [])].sort((a, b) => (a.createdAt < b.createdAt ? 1 : -1));
    return {
      id: o.id,
      code: opportunityCode(o),
      title: o.title,
      clientId: o.clientId,
      clientName: client?.tradeName ?? "Cliente removido",
      clientCity: client?.address?.city,
      productsLabel: productsLabel(o),
      monthlyTotal: o.monthlyTotal,
      setupTotal: o.setupTotal,
      hardwareTotal: o.hardwareTotal,
      stage: o.stage,
      temperature: o.temperature,
      nextAction: o.nextAction,
      nextActionAt: o.nextActionAt,
      followupDue,
      overdue: open && Boolean(o.nextActionAt && o.nextActionAt < nowIso),
      pendingVisitAt: open ? pendingVisitAt : undefined,
      lastChannel: lastChannelOf(oppComms, open && Boolean(pendingVisitAt)),
      lastActivityAt: o.lastActivityAt,
      ownerId: o.ownerId,
      ownerName: owners.get(o.ownerId)?.name ?? "Sem vendedor",
      queues: queuesOf(o, followupDue, Boolean(pendingVisitAt)),
    };
  });

  // Ordem da fila: follow-ups vencidos/de hoje primeiro (mais antigos antes), depois abertas por última
  // atividade, e por fim as encerradas (mais recentes antes).
  const rank = (i: WorkspaceQueueItem) => (!isOpenStage(i.stage) ? 2 : i.followupDue ? 0 : 1);
  items.sort((a, b) => {
    const r = rank(a) - rank(b);
    if (r !== 0) return r;
    if (rank(a) === 0) return (a.nextActionAt ?? "").localeCompare(b.nextActionAt ?? "");
    return a.lastActivityAt < b.lastActivityAt ? 1 : -1;
  });

  // KPIs no mesmo escopo.
  const comp = today.slice(0, 7);
  const oppIds = new Set(mine.map((o) => o.id));
  const latestByNumber = new Map<string, Proposal>();
  for (const p of proposals) {
    if (!oppIds.has(p.opportunityId)) continue;
    const current = latestByNumber.get(p.number);
    if (!current || p.version > current.version) latestByNumber.set(p.number, p);
  }
  const open = mine.filter((o) => isOpenStage(o.stage));
  const wonMonth = mine.filter((o) => o.stage === "ganho" && o.wonAt && dateKey(o.wonAt).slice(0, 7) === comp).length;
  const createdMonth = mine.filter((o) => dateKey(o.createdAt).slice(0, 7) === comp).length;
  const kpis: WorkspaceKpis = {
    newLeads: open.filter((o) => o.stage === "qualificacao").length,
    negotiating: open.filter((o) => o.stage === "negociacao" || o.stage === "fechamento").length,
    proposalsSent: Array.from(latestByNumber.values()).filter((p) => SENT_PROPOSAL.has(effectiveProposalStatus(p, today))).length,
    visitsScheduled: visits.filter((v) => ids.has(v.sellerId) && PENDING_VISIT.has(v.status) && dateKey(v.scheduledAt) >= today).length,
    wonMonth,
    createdMonth,
    conversion: createdMonth > 0 ? wonMonth / createdMonth : null,
  };

  return { scope, stages, kpis, items };
}

// ---------------------------------------------------------------------------
// Oportunidade selecionada
// ---------------------------------------------------------------------------

export type ConversationItem =
  | {
      kind: "message";
      id: string;
      at: string;
      direction: "entrada" | "saida";
      channel: "whatsapp" | "email" | "interno";
      body: string;
      authorName: string;
      /** Registro manual (nenhuma integração conectada). */
      manual: boolean;
      status: CommunicationRecord["status"];
    }
  | { kind: "call"; id: string; at: string; direction: "entrada" | "saida"; durationSeconds?: number; answered: boolean; body?: string; authorName: string; manual: boolean }
  | { kind: "note"; id: string; at: string; body: string; authorName: string }
  | { kind: "system"; id: string; at: string; type: EventType; title: string; description?: string; actorName: string; entityType?: string; entityId?: string };

export interface WorkspaceNextAction {
  id: string;
  kind: "followup" | "visita" | "tarefa" | "proposta";
  title: string;
  at?: string;
  overdue: boolean;
  href?: string;
  /** Visita: para abrir o drawer de visita no próprio workspace. */
  visitId?: string;
}

export interface WorkspaceInterest {
  id: string;
  name: string;
  category?: Product["category"];
  source: "oportunidade" | "lead";
  monthlyValue?: number;
}

export interface WorkspaceLocation {
  addressLine: string;
  /** "cliente" = endereço do cadastro; "visita" = endereço da próxima visita pendente. */
  source: "cliente" | "visita";
  mapsUrl: string | null;
  embedUrl: string | null;
  directionsUrl: string | null;
  distanceKm?: number;
  travelMinutes?: number;
  /** "estimativa" enquanto não houver Google Maps Platform: distância estimada, não rota real. */
  provider?: "estimativa" | "google";
  origin: string;
}

export interface WorkspaceDetail extends OpportunityDetail {
  lead: Pick<Lead, "id" | "name" | "interest" | "origin" | "score" | "temperature" | "status"> | null;
  conversation: ConversationItem[];
  channels: SalesChannelStatus;
  lastCall: { at: string; durationSeconds?: number; answered: boolean; authorName: string } | null;
  location: WorkspaceLocation | null;
  nextActions: WorkspaceNextAction[];
  interests: WorkspaceInterest[];
  /** Visitas do cliente (da oportunidade e sem oportunidade), mais recentes primeiro. */
  clientVisits: VisitRow[];
  /** Destinos possíveis de transferência (time de vendas ativo, sem o dono atual). */
  transferTargets: UserLite[];
  /** Contato principal (para os botões WhatsApp/Ligar/E-mail). */
  primaryContact: { name?: string; role?: string; phone?: string; whatsapp?: string; email?: string };
  canEdit: boolean;
}

const CONTACT_EVENT_TYPES = new Set<EventType>(["whatsapp.message.sent", "whatsapp.message.received", "call.completed", "email.sent"]);

function isRelevantEvent(e: DomainEvent, ctx: { oppId: string; leadId?: string; proposalIds: Set<string>; visitIds: Set<string> }): boolean {
  const payloadOpp = typeof e.payload?.opportunityId === "string" ? e.payload.opportunityId : undefined;
  if (payloadOpp) return payloadOpp === ctx.oppId;
  if (e.entityId === ctx.oppId) return true;
  if (e.entityType === "proposal" && e.entityId && ctx.proposalIds.has(e.entityId)) return true;
  if (e.entityType === "visit" && e.entityId && ctx.visitIds.has(e.entityId)) return true;
  if (e.entityType === "lead" && ctx.leadId && e.entityId === ctx.leadId) return true;
  // Contatos com o cliente registrados fora da oportunidade (ficha do cliente) também entram na conversa.
  if (CONTACT_EVENT_TYPES.has(e.type) && (!e.entityType || COMM_ENTITY_OK.has(e.entityType))) return true;
  return false;
}

function isRelevantComm(c: CommunicationRecord, ctx: { oppId: string; leadId?: string; proposalIds: Set<string> }): boolean {
  if (!c.entityType) return true;
  if (COMM_ENTITY_OK.has(c.entityType)) return true;
  if (c.entityType === "opportunity") return c.entityId === ctx.oppId;
  if (c.entityType === "lead") return Boolean(ctx.leadId) && c.entityId === ctx.leadId;
  if (c.entityType === "proposal") return Boolean(c.entityId && ctx.proposalIds.has(c.entityId));
  return false;
}

/** Conversa em ordem cronológica: communications viram balões/ligações; eventos viram notas ou linhas do sistema. */
function buildConversation(events: DomainEvent[], comms: CommunicationRecord[], names: Map<string, string>, contactName: string): ConversationItem[] {
  const items: ConversationItem[] = [];
  const commIds = new Set(comms.map((c) => c.id));
  for (const c of comms) {
    const authorName = c.direction === "entrada" ? contactName : (c.userId ? names.get(c.userId) : undefined) ?? "Equipe";
    // Tudo que não passou por um provedor real (manual, mock do seed, "outro") é registro manual.
    const manual = c.registration === "manual" || c.status === "manual" || c.provider === "manual" || c.provider === "mock" || c.provider === "outro";
    if (c.channel === "voip") {
      items.push({ kind: "call", id: `c:${c.id}`, at: c.createdAt, direction: c.direction, durationSeconds: c.durationSeconds, answered: c.status !== "falha" && (c.durationSeconds ?? 1) > 0, body: c.body, authorName, manual });
    } else {
      items.push({ kind: "message", id: `c:${c.id}`, at: c.createdAt, direction: c.direction, channel: c.channel, body: c.body ?? "", authorName, manual, status: c.status });
    }
  }
  const commTimes = comms.map((c) => ({ channel: c.channel, at: new Date(c.createdAt).getTime() }));
  for (const e of events) {
    const commId = typeof e.payload?.communicationId === "string" ? e.payload.communicationId : undefined;
    if (commId && commIds.has(commId)) continue;
    if (CONTACT_EVENT_TYPES.has(e.type)) {
      // Registros antigos sem communicationId: descarta o evento se houver a comunicação equivalente (±10s).
      const channel = e.type === "call.completed" ? "voip" : e.type === "email.sent" ? "email" : "whatsapp";
      const t = new Date(e.occurredAt).getTime();
      if (commTimes.some((c) => c.channel === channel && Math.abs(c.at - t) < 10_000)) continue;
    }
    if (e.type === "note.added" && e.entityType === "opportunity" && (e.payload?.internal === true || e.payload?.channel === "nota")) {
      items.push({ kind: "note", id: `e:${e.id}`, at: e.occurredAt, body: e.description ?? e.title, authorName: e.actorName });
      continue;
    }
    items.push({ kind: "system", id: `e:${e.id}`, at: e.occurredAt, type: e.type, title: e.title, description: e.description, actorName: e.actorName, entityType: e.entityType, entityId: e.entityId });
  }
  items.sort((a, b) => (a.at < b.at ? -1 : a.at > b.at ? 1 : 0));
  // Conversa longa: mantém as 200 interações mais recentes.
  return items.slice(-200);
}

export async function getWorkspaceOpportunity(user: CurrentUser, id: string): Promise<WorkspaceDetail | null> {
  const detail = await getOpportunityDetail(user, id);
  if (!detail) return null;
  const { opportunity: opp, client } = detail;
  const [events, comms, lead, visitDocs, channels, sellers, fullClient] = await Promise.all([
    list<DomainEvent>(COLLECTIONS.events, { where: [["clientId", "==", client.id]] }),
    list<CommunicationRecord>(COLLECTIONS.communications, { where: [["clientId", "==", client.id]] }),
    opp.leadId ? getById<Lead>(COLLECTIONS.leads, opp.leadId) : Promise.resolve(null),
    list<Visit>(COLLECTIONS.visits, { where: [["clientId", "==", client.id]] }),
    getSalesChannelStatus(),
    listSalesUsers(),
    getById<Client>(COLLECTIONS.clients, client.id),
  ]);

  const proposalIds = new Set(detail.proposals.map((p) => p.id));
  // Visitas desta oportunidade e visitas do cliente sem oportunidade.
  const relevantVisits = visitDocs.filter((v) => v.opportunityId === opp.id || !v.opportunityId);
  const visitIds = new Set(relevantVisits.map((v) => v.id));
  const ctx = { oppId: opp.id, leadId: opp.leadId, proposalIds, visitIds };
  const relevantComms = comms.filter((c) => isRelevantComm(c, ctx));
  const relevantEvents = events.filter((e) => isRelevantEvent(e, ctx));

  const primary = detail.contacts.find((c) => c.isPrimary) ?? detail.contacts[0];
  const contactName = primary?.name ?? client.tradeName;
  const userIds = new Set<string>();
  for (const c of relevantComms) if (c.userId) userIds.add(c.userId);
  const users = await getManyByIds<{ id: string; organizationId: string; createdAt: string; updatedAt: string; name: string }>(COLLECTIONS.users, Array.from(userIds));
  const names = new Map(Array.from(users.values()).map((u) => [u.id, u.name]));
  const conversation = buildConversation(relevantEvents, relevantComms, names, contactName);

  // Última ligação registrada (qualquer entidade do cliente).
  const lastVoip = comms.filter((c) => c.channel === "voip").sort((a, b) => (a.createdAt < b.createdAt ? 1 : -1))[0];
  const lastCallAuthor = lastVoip?.userId ? (names.get(lastVoip.userId) ?? (await getById<{ id: string; organizationId: string; createdAt: string; updatedAt: string; name: string }>(COLLECTIONS.users, lastVoip.userId))?.name) : undefined;
  const lastCall = lastVoip
    ? { at: lastVoip.createdAt, durationSeconds: lastVoip.durationSeconds, answered: lastVoip.status !== "falha" && (lastVoip.durationSeconds ?? 1) > 0, authorName: lastVoip.direction === "entrada" ? contactName : (lastCallAuthor ?? "Equipe") }
    : null;

  const clientVisits = (await toVisitRows(relevantVisits)).sort((a, b) => (a.scheduledAt < b.scheduledAt ? 1 : -1));
  const pendingVisits = clientVisits.filter((v) => PENDING_VISIT.has(v.status)).sort((a, b) => a.scheduledAt.localeCompare(b.scheduledAt));

  // Localização: endereço da próxima visita pendente; senão o do cadastro.
  const nextVisit = pendingVisits.find((v) => v.opportunityId === opp.id) ?? pendingVisits[0];
  const address = nextVisit?.address && formatAddressLine(nextVisit.address) ? nextVisit.address : client.address;
  let location: WorkspaceLocation | null = null;
  const addressLine = formatAddressLine(address);
  if (addressLine) {
    const position = await geocode(address);
    const estimate = position ? await route(HEADQUARTERS.position, position) : null;
    location = {
      addressLine,
      source: address === client.address ? "cliente" : "visita",
      mapsUrl: googleMapsSearchUrl(address),
      embedUrl: googleMapsEmbedUrl(address),
      directionsUrl: googleMapsDirectionsUrl(address),
      distanceKm: estimate?.distanceKm,
      travelMinutes: estimate?.durationMinutes,
      provider: estimate?.provider,
      origin: HEADQUARTERS.label,
    };
  }

  // Próximas ações: próxima ação da oportunidade, visitas pendentes, tarefas abertas e propostas aguardando o cliente.
  const nowIso = new Date().toISOString();
  const today = todayKey();
  const nextActions: WorkspaceNextAction[] = [];
  if (isOpenStage(opp.stage) && opp.nextActionAt) {
    nextActions.push({ id: "followup", kind: "followup", title: opp.nextAction ?? "Próxima ação", at: opp.nextActionAt, overdue: opp.nextActionAt < nowIso });
  }
  for (const v of pendingVisits) {
    nextActions.push({ id: `visita:${v.id}`, kind: "visita", title: `Visita${v.kind === "tecnica" ? " técnica" : " comercial"} · ${v.objective}`, at: v.scheduledAt, overdue: v.scheduledAt < nowIso, visitId: v.id });
  }
  for (const t of detail.tasks) {
    if (!OPEN_TASK.has(t.status)) continue;
    nextActions.push({ id: `tarefa:${t.id}`, kind: "tarefa", title: t.title, at: t.dueAt, overdue: Boolean(t.dueAt && t.dueAt < nowIso), href: `/tarefas?tarefa=${t.id}` });
  }
  for (const p of detail.proposals) {
    if (p.effectiveStatus !== "enviada" && p.effectiveStatus !== "visualizada" && p.effectiveStatus !== "negociacao") continue;
    nextActions.push({ id: `proposta:${p.id}`, kind: "proposta", title: `Proposta ${p.number} v${p.version} aguardando o cliente`, at: p.validUntil, overdue: p.validUntil.slice(0, 10) < today, href: `/vendas/propostas?proposta=${p.id}` });
  }
  nextActions.sort((a, b) => (a.at ?? "9").localeCompare(b.at ?? "9"));

  // Interesses: produtos da oportunidade + produtos de interesse do lead.
  const productById = new Map(detail.products.map((p) => [p.id, p]));
  const interests: WorkspaceInterest[] = [];
  const seen = new Set<string>();
  for (const p of opp.products) {
    if (seen.has(p.productId)) continue;
    seen.add(p.productId);
    interests.push({ id: p.productId, name: p.productName, category: productById.get(p.productId)?.category, source: "oportunidade", monthlyValue: p.monthlyValue });
  }
  for (const pid of lead?.productInterestIds ?? []) {
    if (seen.has(pid)) continue;
    const product = productById.get(pid);
    if (!product) continue;
    seen.add(pid);
    interests.push({ id: pid, name: product.name, category: product.category, source: "lead" });
  }

  return {
    ...detail,
    lead: lead ? { id: lead.id, name: lead.name, interest: lead.interest, origin: lead.origin, score: lead.score, temperature: lead.temperature, status: lead.status } : null,
    conversation,
    channels,
    lastCall,
    location,
    nextActions,
    interests,
    clientVisits,
    transferTargets: sellers.filter((s) => s.id !== opp.ownerId).map(toLite),
    primaryContact: {
      name: primary?.name,
      role: primary?.role,
      phone: primary?.phone ?? fullClient?.phone,
      whatsapp: primary?.whatsapp ?? fullClient?.whatsapp ?? primary?.phone ?? fullClient?.phone,
      email: primary?.email ?? fullClient?.email,
    },
    canEdit: user.isManager || opp.ownerId === user.id || opp.originUserId === user.id,
  };
}

// ---------------------------------------------------------------------------
// Visitas do cliente (Cliente 360)
// ---------------------------------------------------------------------------

/**
 * Visitas de um cliente (todas as oportunidades), pendentes primeiro, para a ficha do Cliente 360.
 * INTEGRAÇÃO: o agente do Cliente 360 liga esta leitura na aba Comercial.
 */
/**
 * Visitas (comerciais e técnicas) de um cliente: a ÚNICA leitura de visitas por cliente, usada pelo workspace de
 * Vendas (com `user`, filtrada pela carteira do vendedor) e pelo Cliente 360º (`user` null: quem vê o cliente vê
 * todas as visitas). Pendentes primeiro (mais próxima antes), depois as encerradas (mais recente antes).
 */
export async function getClientVisits(user: Pick<CurrentUser, "id" | "isManager"> | null, clientId: string): Promise<VisitRow[]> {
  const [visits, opps] = await Promise.all([
    list<Visit>(COLLECTIONS.visits, { where: [["clientId", "==", clientId]] }),
    list<Opportunity>(COLLECTIONS.opportunities, { where: [["clientId", "==", clientId]] }),
  ]);
  const oppById = new Map(opps.map((o) => [o.id, o]));
  const visible = !user || user.isManager
    ? visits
    : visits.filter((v) => {
        const opp = v.opportunityId ? oppById.get(v.opportunityId) : undefined;
        return v.sellerId === user.id || v.createdBy === user.id || (opp ? canSeeOpportunity(user, opp) : false);
      });
  const rows = await toVisitRows(visible);
  const pending = (v: Visit) => PENDING_VISIT.has(v.status);
  return rows.sort((a, b) => {
    if (pending(a) !== pending(b)) return pending(a) ? -1 : 1;
    return pending(a) ? a.scheduledAt.localeCompare(b.scheduledAt) : b.scheduledAt.localeCompare(a.scheduledAt);
  });
}
