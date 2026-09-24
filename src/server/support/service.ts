import "server-only";
/**
 * Serviço do Suporte: regras de negócio SEM validação de sessão. Usado pelas Server Actions (que
 * validam sessão, permissão e entrada), pela rota pública de CSAT, pelo webhook de WhatsApp e pelos
 * handlers de evento.
 *
 * Ciclo do chamado:
 *   aberto/reaberto → em_atendimento (assumir ou primeira resposta) ⇄ aguardando_cliente (SLA pausado)
 *   → resolvido (SLA concluído, pedido de CSAT) → fechado (após CSAT ou manualmente).
 *   Reabrir cria um NOVO chamado (reopenedFromId = original) com SLA novo e incrementa reopenCount do original.
 *
 * SLA: uma instância `sla_instances` por chamado (regra `suporte.<criticidade>`), referenciada em
 * `ticket.slaInstanceId`. Mudar a criticidade encerra a instância atual (marcada `supersededBy`) e inicia
 * outra com a nova regra mantendo o início original; relatórios sempre usam a instância vigente do chamado.
 *
 * Toda mutação relevante emite evento (timeline do cliente, notificações, KPIs). Erros de regra são
 * lançados como `SupportError` com mensagem em português.
 */
import { createHmac, timingSafeEqual } from "node:crypto";
import { FieldValue } from "firebase-admin/firestore";
import { col, create, getById, getManyByIds, list, nowIso, update } from "@/server/db";
import { emitEvent } from "@/server/events";
import { registerHandler } from "@/server/events/emit";
import { registerSupportHandlers } from "@/server/events/handlers/support";
import { notify } from "@/server/notifications";
import { addBusinessHours, completeSla, computeSlaState, getHolidays, markSlaResponded, pauseSla, resumeSla, startSla } from "@/server/sla";
import { createTaskInternal } from "@/server/tasks/service";
import { getDepartmentManager } from "@/server/workflow/service";
import { createOpportunity } from "@/server/sales/service";
import { dateKey, formatCurrency } from "@/lib/format";
import {
  COLLECTIONS,
  type Client,
  type ClientProduct,
  type Contact,
  type CsatResponse,
  type Document,
  type DomainEvent,
  type ImplementationProject,
  type Opportunity,
  type Product,
  type Settings,
  type SlaInstance,
  type SupportTicket,
  type Task,
  type TicketInteraction,
  type User,
  type UserRef,
  type KnowledgeArticle,
} from "@/domain/types";
import { getSupportChannels, type SupportMessageChannel } from "./channels";
import { getSupportChannelStatus } from "./integrations";
import {
  OPEN_TICKET_STATUSES,
  ROOT_CAUSE_LABELS,
  TICKET_CHANNEL_LABELS,
  TICKET_PRIORITY_LABELS,
  TICKET_QUEUE_LABELS,
  TICKET_STATUS_LABELS,
  type ArticleData,
  type CreateTicketData,
  type ReplyChannel,
  type ResolveData,
  type TicketPriority,
  type TicketQueue,
} from "./schemas";

// Registro idempotente dos handlers do Suporte (ver src/server/events/handlers/support.ts).
registerSupportHandlers(registerHandler);

export class SupportError extends Error {}

export const SUPPORT_SYSTEM_ACTOR: UserRef = { id: "system", name: "INTEROS (automação)" };
const CUSTOMER_ACTOR: UserRef = { id: "cliente", name: "Cliente (avaliação)" };

/** Campos opcionais gravados além do tipo `SupportTicket` (ver "needs" do relatório). */
export type SupportTicketExtra = SupportTicket & { customerConfirmation?: "sim" | "pendente"; csatRequestedAt?: string };
/**
 * Campos além do tipo `TicketInteraction`: canal da resposta e `manual` = registro manual (a mensagem/ligação
 * aconteceu fora do sistema porque a integração do canal não está conectada).
 */
export type TicketInteractionExtra = TicketInteraction & { channel?: ReplyChannel; manual?: boolean };
/** Marcas de alerta e substituição gravadas na instância de SLA (campos além do tipo `SlaInstance`). */
export type SlaInstanceExtra = SlaInstance & { alertedRisk?: boolean; alertedBreach?: boolean; supersededBy?: string };

const OPEN = new Set<string>(OPEN_TICKET_STATUSES);
const OPEN_OPPORTUNITY = new Set<Opportunity["stage"]>(["qualificacao", "diagnostico", "proposta", "negociacao", "fechamento"]);
const SLA_SWEEP_INTERVAL_MS = 10 * 60_000;
export const LOW_CSAT_THRESHOLD = 6;

export function isOpenTicket(ticket: Pick<SupportTicket, "status">): boolean {
  return OPEN.has(ticket.status);
}

/** Link do chamado: abre o workspace da Central de Suporte com o chamado selecionado. */
export function ticketHref(ticketId: string): string {
  return `/suporte?chamado=${ticketId}`;
}

// ---------------------------------------------------------------------------
// Utilitários
// ---------------------------------------------------------------------------

export async function loadTicket(id: string): Promise<SupportTicketExtra> {
  const ticket = await getById<SupportTicketExtra>(COLLECTIONS.supportTickets, id);
  if (!ticket) throw new SupportError("Chamado não encontrado");
  return ticket;
}

async function loadClient(id: string): Promise<Client> {
  const client = await getById<Client>(COLLECTIONS.clients, id);
  if (!client) throw new SupportError("Cliente não encontrado");
  return client;
}

/** Remove campos do documento (o `update` de db.ts ignora `undefined`). */
async function clearFields(id: string, fields: string[]): Promise<void> {
  const patch: Record<string, unknown> = { updatedAt: nowIso() };
  for (const f of fields) patch[f] = FieldValue.delete();
  await col(COLLECTIONS.supportTickets).doc(id).update(patch);
}

async function readSettingDoc(key: string): Promise<Settings | null> {
  const docs = await list<Settings>(COLLECTIONS.settings, { where: [["key", "==", key]] });
  return docs[0] ?? null;
}

/** Mescla campos em `settings/<key>.value` (merge do Firestore), criando o documento se preciso. */
async function mergeSetting(key: string, patch: Record<string, unknown>, description: string): Promise<void> {
  const doc = await readSettingDoc(key);
  if (doc) await update<Settings>(COLLECTIONS.settings, doc.id, { value: patch });
  else await create<Settings>(COLLECTIONS.settings, { key, value: patch, description }, `setting_${key}`);
}

/** Próximo número "CH-AAAA-NNNN" do ano corrente (fuso da operação). */
async function nextTicketNumber(): Promise<string> {
  const year = dateKey(new Date()).slice(0, 4);
  const tickets = await list<SupportTicket>(COLLECTIONS.supportTickets);
  const head = `CH-${year}-`;
  let max = 0;
  for (const t of tickets) {
    if (!t.number?.startsWith(head)) continue;
    const seq = Number(t.number.slice(head.length));
    if (Number.isFinite(seq) && seq > max) max = seq;
  }
  return `${head}${String(max + 1).padStart(4, "0")}`;
}

async function addInteraction(
  ticket: Pick<SupportTicket, "id" | "clientId">,
  data: { kind: TicketInteraction["kind"]; body: string; authorId?: string; durationSeconds?: number; recordingUrl?: string; attachments?: string[]; channel?: ReplyChannel; manual?: boolean; createdAt?: string },
): Promise<TicketInteractionExtra> {
  return create<TicketInteractionExtra>(COLLECTIONS.ticketInteractions, {
    ticketId: ticket.id,
    clientId: ticket.clientId,
    authorId: data.authorId,
    kind: data.kind,
    body: data.body,
    durationSeconds: data.durationSeconds,
    recordingUrl: data.recordingUrl,
    attachments: data.attachments,
    channel: data.channel,
    manual: data.manual,
    createdBy: data.authorId,
    ...(data.createdAt ? { createdAt: data.createdAt } : {}),
  });
}

async function setSlaOwner(ticket: Pick<SupportTicket, "slaInstanceId">, ownerId: string): Promise<void> {
  if (ticket.slaInstanceId) await update<SlaInstance>(COLLECTIONS.slaInstances, ticket.slaInstanceId, { ownerId });
}

/** Equipe de suporte: usuários ativos do departamento Suporte, papel "suporte" e o gestor do departamento. */
export async function getSupportTeam(): Promise<User[]> {
  const [byDept, byRole, manager] = await Promise.all([
    list<User>(COLLECTIONS.users, { where: [["departmentId", "==", "suporte"]] }),
    list<User>(COLLECTIONS.users, { where: [["role", "==", "suporte"]] }),
    getDepartmentManager("suporte"),
  ]);
  const map = new Map<string, User>();
  for (const u of [...byDept, ...byRole, ...(manager ? [manager] : [])]) if (u.active !== false) map.set(u.id, u);
  return Array.from(map.values()).sort((a, b) => a.name.localeCompare(b.name, "pt-BR"));
}

export async function getSupportManager(): Promise<User | null> {
  return getDepartmentManager("suporte");
}

// ---------------------------------------------------------------------------
// Token do CSAT (link público)
// ---------------------------------------------------------------------------

/** Primeiros 8 caracteres do HMAC-SHA256 do id do chamado (segredo da sessão). */
export function csatToken(ticketId: string): string {
  const secret = process.env.SESSION_COOKIE_SECRET ?? "dev-only-secret";
  return createHmac("sha256", secret).update(ticketId).digest("hex").slice(0, 8);
}

export function isValidCsatToken(ticketId: string, token: string | undefined | null): boolean {
  if (!token) return false;
  const expected = Buffer.from(csatToken(ticketId));
  const received = Buffer.from(token);
  return expected.length === received.length && timingSafeEqual(expected, received);
}

/** Caminho relativo do formulário público; `absolute` prefixa NEXT_PUBLIC_APP_URL quando configurada. */
export function csatPath(ticketId: string, absolute = false): string {
  const path = `/csat/${ticketId}?t=${csatToken(ticketId)}`;
  const base = absolute ? (process.env.NEXT_PUBLIC_APP_URL ?? "").replace(/\/$/, "") : "";
  return `${base}${path}`;
}

// ---------------------------------------------------------------------------
// Abertura
// ---------------------------------------------------------------------------

const OPENING_KIND: Record<SupportTicket["channel"], TicketInteraction["kind"]> = {
  whatsapp: "whatsapp",
  telefone: "ligacao",
  email: "email",
  portal: "mensagem",
  interno: "mensagem",
};

export async function createTicket(data: CreateTicketData, actor: UserRef): Promise<SupportTicket> {
  const client = await loadClient(data.clientId);
  const [contact, product, assignee] = await Promise.all([
    data.contactId ? getById<Contact>(COLLECTIONS.contacts, data.contactId) : null,
    data.productId ? getById<Product>(COLLECTIONS.products, data.productId) : null,
    data.assigneeId ? getById<User>(COLLECTIONS.users, data.assigneeId) : null,
  ]);
  if (data.contactId && (!contact || contact.clientId !== client.id)) throw new SupportError("Contato não pertence ao cliente");
  if (data.productId && !product) throw new SupportError("Produto não encontrado");
  if (data.assigneeId && (!assignee || assignee.active === false)) throw new SupportError("Atendente não encontrado ou inativo");

  const openedAt = nowIso();
  const ticket = await create<SupportTicket>(COLLECTIONS.supportTickets, {
    number: await nextTicketNumber(),
    clientId: client.id,
    contactId: contact?.id,
    productId: product?.id,
    subject: data.subject,
    description: data.description,
    channel: data.channel,
    priority: data.priority,
    category: data.category,
    assigneeId: assignee?.id,
    queue: data.queue,
    status: "aberto",
    openedAt,
    reopenCount: 0,
    createdBy: actor.id,
  });

  const sla = await startSla({
    ruleKey: `suporte.${ticket.priority}`,
    entityType: "chamado",
    entityId: ticket.id,
    clientId: client.id,
    ownerId: assignee?.id,
    department: "suporte",
    startedAt: openedAt,
  });
  await update<SupportTicket>(COLLECTIONS.supportTickets, ticket.id, { slaInstanceId: sla.id });
  ticket.slaInstanceId = sla.id;

  // A mensagem de abertura é do cliente (sem autor), exceto chamados internos.
  await addInteraction(ticket, {
    kind: OPENING_KIND[ticket.channel],
    body: ticket.description,
    authorId: ticket.channel === "interno" ? actor.id : undefined,
    createdAt: openedAt,
  });

  await emitEvent({
    type: "support.ticket.created",
    actor,
    clientId: client.id,
    entity: { type: "ticket", id: ticket.id },
    title: `Chamado ${ticket.number} aberto: ${ticket.subject}`,
    description: [`Criticidade ${TICKET_PRIORITY_LABELS[ticket.priority]}`, TICKET_CHANNEL_LABELS[ticket.channel], product?.name, contact ? `contato: ${contact.name}` : null].filter(Boolean).join(" · "),
    department: "suporte",
    payload: { number: ticket.number, priority: ticket.priority, queue: ticket.queue, channel: ticket.channel, productId: ticket.productId, assigneeId: ticket.assigneeId, slaInstanceId: sla.id },
  });
  return ticket;
}

// ---------------------------------------------------------------------------
// Atribuição e primeira resposta
// ---------------------------------------------------------------------------

async function changeStatus(ticket: SupportTicketExtra, to: SupportTicket["status"], actor: UserRef, note?: string, extraPatch: Partial<SupportTicketExtra> = {}): Promise<void> {
  const from = ticket.status;
  await update<SupportTicketExtra>(COLLECTIONS.supportTickets, ticket.id, { ...extraPatch, status: to });
  await addInteraction(ticket, { kind: "status", body: `Status alterado de ${TICKET_STATUS_LABELS[from]} para ${TICKET_STATUS_LABELS[to]}${note ? `: ${note}` : ""}`, authorId: actor.id });
  await emitEvent({
    type: "support.ticket.status_changed",
    actor,
    clientId: ticket.clientId,
    entity: { type: "ticket", id: ticket.id },
    title: `Chamado ${ticket.number}: ${TICKET_STATUS_LABELS[from]} → ${TICKET_STATUS_LABELS[to]}`,
    description: note,
    department: "suporte",
    payload: { from, to, number: ticket.number, assigneeId: extraPatch.assigneeId ?? ticket.assigneeId },
  });
  ticket.status = to;
  Object.assign(ticket, extraPatch);
}

/** Atribui o chamado. Assumir (atribuir a si mesmo) coloca o chamado em atendimento. */
export async function assignTicket(ticketId: string, assigneeId: string, actor: UserRef): Promise<SupportTicket> {
  const ticket = await loadTicket(ticketId);
  if (!isOpenTicket(ticket)) throw new SupportError("Só é possível atribuir chamados em aberto");
  const assignee = await getById<User>(COLLECTIONS.users, assigneeId);
  if (!assignee || assignee.active === false) throw new SupportError("Atendente não encontrado ou inativo");
  const selfAssign = assignee.id === actor.id;
  if (ticket.assigneeId === assignee.id && !(selfAssign && (ticket.status === "aberto" || ticket.status === "reaberto"))) {
    throw new SupportError(`${assignee.name} já é o atendente deste chamado`);
  }

  await setSlaOwner(ticket, assignee.id);
  if (selfAssign && (ticket.status === "aberto" || ticket.status === "reaberto")) {
    await changeStatus(ticket, "em_atendimento", actor, `assumido por ${assignee.name}`, { assigneeId: assignee.id });
  } else {
    await update<SupportTicket>(COLLECTIONS.supportTickets, ticket.id, { assigneeId: assignee.id });
    await addInteraction(ticket, { kind: "status", body: `Chamado transferido para ${assignee.name}`, authorId: actor.id });
    await emitEvent({
      type: "support.ticket.status_changed",
      actor,
      clientId: ticket.clientId,
      entity: { type: "ticket", id: ticket.id },
      title: `Chamado ${ticket.number} atribuído a ${assignee.name}`,
      department: "suporte",
      payload: { from: ticket.status, to: ticket.status, number: ticket.number, assigneeId: assignee.id },
      timeline: false,
    });
    await notify({
      userIds: selfAssign ? [] : [assignee.id],
      kind: ticket.priority === "critico" || ticket.priority === "alto" ? "acao" : "informativa",
      title: `Chamado ${ticket.number} atribuído a você`,
      body: `${ticket.subject} · ${TICKET_PRIORITY_LABELS[ticket.priority]}`,
      href: ticketHref(ticket.id),
      entity: { type: "ticket", id: ticket.id },
    });
    ticket.assigneeId = assignee.id;
  }
  return ticket;
}

/**
 * Transferência para outro atendente e/ou outra fila, com nota obrigatória. Vira interação de status na
 * conversa, evento `support.ticket.transferred` (payload.kind "transferencia") na timeline do cliente e notificação
 * para quem recebe. Transferir só de fila, sem atendente, devolve o chamado à fila (sem atendente) e avisa a equipe.
 */
export async function transferTicket(ticketId: string, data: { assigneeId?: string; queue: TicketQueue; note: string }, actor: UserRef): Promise<SupportTicket> {
  const ticket = await loadTicket(ticketId);
  if (!isOpenTicket(ticket)) throw new SupportError("Só é possível transferir chamados em aberto");
  const assignee = data.assigneeId ? await getById<User>(COLLECTIONS.users, data.assigneeId) : null;
  if (data.assigneeId && (!assignee || assignee.active === false)) throw new SupportError("Atendente não encontrado ou inativo");
  const assigneeChanged = Boolean(assignee) && assignee!.id !== ticket.assigneeId;
  const queueChanged = data.queue !== ticket.queue;
  if (!assigneeChanged && !queueChanged) throw new SupportError("Escolha outro atendente ou outra fila para transferir");

  const previous = ticket.assigneeId ? await getById<User>(COLLECTIONS.users, ticket.assigneeId) : null;
  // Mudou só a fila: o chamado volta para a fila de destino sem atendente.
  const nextAssigneeId = assignee?.id ?? (queueChanged ? undefined : ticket.assigneeId);
  await update<SupportTicket>(COLLECTIONS.supportTickets, ticket.id, { queue: data.queue, ...(nextAssigneeId ? { assigneeId: nextAssigneeId } : {}) });
  if (!nextAssigneeId && ticket.assigneeId) await clearFields(ticket.id, ["assigneeId"]);
  if (nextAssigneeId && nextAssigneeId !== ticket.assigneeId) await setSlaOwner(ticket, nextAssigneeId);

  const queueLabel = TICKET_QUEUE_LABELS[data.queue].split(" ")[0];
  const target = [assignee && assigneeChanged ? assignee.name : null, queueChanged ? `fila ${queueLabel}` : null].filter(Boolean).join(" · ");
  const from = [previous?.name ?? "sem atendente", `fila ${(TICKET_QUEUE_LABELS[ticket.queue as TicketQueue] ?? ticket.queue).split(" ")[0]}`].join(" · ");
  await addInteraction(ticket, { kind: "status", body: `Transferido de ${from} para ${target}: ${data.note}`, authorId: actor.id });
  const event = await emitEvent({
    type: "support.ticket.transferred",
    actor,
    clientId: ticket.clientId,
    entity: { type: "ticket", id: ticket.id },
    title: `Chamado ${ticket.number} transferido para ${target}`,
    description: data.note,
    department: "suporte",
    payload: { kind: "transferencia", from: ticket.status, to: ticket.status, number: ticket.number, assigneeId: nextAssigneeId, previousAssigneeId: ticket.assigneeId, queue: data.queue, previousQueue: ticket.queue },
  });

  const urgent = ticket.priority === "critico" || ticket.priority === "alto";
  const recipients = assignee ? [assignee.id] : (await getSupportTeam()).map((u) => u.id);
  await notify({
    userIds: recipients.filter((id) => id !== actor.id),
    kind: urgent ? "acao" : "informativa",
    title: assignee ? `Chamado ${ticket.number} transferido para você` : `Chamado ${ticket.number} na fila ${queueLabel} sem atendente`,
    body: `${ticket.subject} · ${TICKET_PRIORITY_LABELS[ticket.priority]} · por ${actor.name}: ${data.note}`,
    href: ticketHref(ticket.id),
    entity: { type: "ticket", id: ticket.id },
    eventId: event.id,
  });
  return { ...ticket, queue: data.queue, assigneeId: nextAssigneeId };
}

/**
 * Primeira resposta do atendente: marca firstResponseAt, a resposta no SLA e emite
 * support.ticket.first_response. Chamado sem atendente passa a ser de quem respondeu; aberto vira em atendimento.
 */
async function registerAgentResponse(ticket: SupportTicketExtra, actor: UserRef, via: string): Promise<void> {
  if (!ticket.assigneeId) {
    await update<SupportTicket>(COLLECTIONS.supportTickets, ticket.id, { assigneeId: actor.id });
    await setSlaOwner(ticket, actor.id);
    ticket.assigneeId = actor.id;
  }
  if (ticket.status === "aberto" || ticket.status === "reaberto") await changeStatus(ticket, "em_atendimento", actor, `primeira resposta por ${via}`);
  if (ticket.firstResponseAt) return;

  const at = nowIso();
  await update<SupportTicket>(COLLECTIONS.supportTickets, ticket.id, { firstResponseAt: at });
  ticket.firstResponseAt = at;
  let withinSla: boolean | undefined;
  if (ticket.slaInstanceId) {
    await markSlaResponded(ticket.slaInstanceId);
    const sla = await getById<SlaInstance>(COLLECTIONS.slaInstances, ticket.slaInstanceId);
    withinSla = sla?.responseDueAt ? at <= sla.responseDueAt : undefined;
  }
  const minutes = Math.max(0, Math.round((new Date(at).getTime() - new Date(ticket.openedAt).getTime()) / 60_000));
  await emitEvent({
    type: "support.ticket.first_response",
    actor,
    clientId: ticket.clientId,
    entity: { type: "ticket", id: ticket.id },
    title: `Primeira resposta no chamado ${ticket.number}`,
    description: `${via} · ${minutes} min após a abertura${withinSla === false ? " · fora do SLA de resposta" : withinSla ? " · dentro do SLA de resposta" : ""}`,
    department: "suporte",
    payload: { number: ticket.number, minutes, withinSla, via },
  });
}

// ---------------------------------------------------------------------------
// Conversa: resposta, nota interna, ligação, anexos
// ---------------------------------------------------------------------------

const CHANNEL_KIND: Record<ReplyChannel, TicketInteraction["kind"]> = { whatsapp: "mensagem", email: "mensagem", portal: "mensagem" };

export interface ReplyResult {
  interaction: TicketInteraction;
  /** true quando a integração do canal não está conectada: a resposta foi só registrada no chamado. */
  manual: boolean;
  /** Telefone (WhatsApp) ou e-mail do destinatário, para o atendente abrir wa.me/mailto com o texto. */
  to?: string;
}

/**
 * Resposta do atendente. Com a integração do canal conectada, envia pelo adapter; sem integração (situação
 * atual) grava um REGISTRO MANUAL com o texto digitado e devolve o destinatário para o atendente enviar pelo
 * app (wa.me / mailto). Portal é interno: a resposta fica visível no chamado.
 */
export async function replyToTicket(ticketId: string, channel: ReplyChannel, body: string, actor: UserRef): Promise<ReplyResult> {
  const ticket = await loadTicket(ticketId);
  if (!isOpenTicket(ticket) && ticket.status !== "resolvido") throw new SupportError("Chamado fechado: reabra para continuar a conversa");
  const [contact, client, status] = await Promise.all([
    ticket.contactId ? getById<Contact>(COLLECTIONS.contacts, ticket.contactId) : null,
    loadClient(ticket.clientId),
    getSupportChannelStatus(),
  ]);
  const to = channel === "whatsapp" ? (contact?.whatsapp ?? contact?.phone ?? client.whatsapp ?? client.phone) : channel === "email" ? (contact?.email ?? client.email) : undefined;
  const connected = channel === "portal" || (channel === "whatsapp" ? status.whatsapp : status.email);
  const manual = !connected;

  const interaction = await addInteraction(ticket, { kind: CHANNEL_KIND[channel], body, authorId: actor.id, channel, manual });
  let communicationId: string | undefined;
  if (connected && channel !== "portal") {
    const communication = await getSupportChannels().sendMessage({
      channel: channel as SupportMessageChannel,
      to,
      body,
      clientId: ticket.clientId,
      contactId: contact?.id,
      entity: { type: "ticket", id: ticket.id },
      sender: actor,
    });
    communicationId = communication.id;
  }
  if (channel === "whatsapp") {
    await emitEvent({
      type: "whatsapp.message.sent",
      actor,
      clientId: ticket.clientId,
      entity: { type: "ticket", id: ticket.id },
      title: manual
        ? `WhatsApp registrado manualmente no chamado ${ticket.number}${contact ? ` (${contact.name})` : ""}`
        : `WhatsApp enviado no chamado ${ticket.number}${contact ? ` para ${contact.name}` : ""}`,
      description: body.length > 280 ? `${body.slice(0, 277)}…` : body,
      department: "suporte",
      payload: { communicationId, to, manual, ticketId: ticket.id },
    });
  }
  await registerAgentResponse(ticket, actor, `${TICKET_CHANNEL_LABELS[channel]}${manual ? " (registro manual)" : ""}`);
  return { interaction, manual, to };
}

export async function addInternalNote(ticketId: string, body: string, actor: UserRef): Promise<TicketInteraction> {
  const ticket = await loadTicket(ticketId);
  const interaction = await addInteraction(ticket, { kind: "nota_interna", body, authorId: actor.id });
  // Nota interna não vai para a timeline do cliente.
  await emitEvent({
    type: "note.added",
    actor,
    clientId: ticket.clientId,
    entity: { type: "ticket", id: ticket.id },
    title: `Nota interna no chamado ${ticket.number}`,
    description: body,
    department: "suporte",
    payload: { ticketId: ticket.id, internal: true },
    timeline: false,
  });
  return interaction;
}

export async function registerCall(ticketId: string, data: { direction: "entrada" | "saida"; durationMinutes: number; summary: string }, actor: UserRef): Promise<TicketInteraction> {
  const ticket = await loadTicket(ticketId);
  const [contact, status] = await Promise.all([ticket.contactId ? getById<Contact>(COLLECTIONS.contacts, ticket.contactId) : null, getSupportChannelStatus()]);
  const durationSeconds = Math.round(data.durationMinutes * 60);
  // Sem VoIP conectado a ligação aconteceu no discador: registro manual, sem gravação.
  const manual = !status.voip;
  const communication = manual
    ? null
    : await getSupportChannels().registerCall({
        direction: data.direction,
        durationSeconds,
        summary: data.summary,
        clientId: ticket.clientId,
        contactId: contact?.id,
        entity: { type: "ticket", id: ticket.id },
        user: actor,
        recordingKey: `${ticket.number}-${Date.now().toString(36)}`,
      });
  const interaction = await addInteraction(ticket, {
    kind: "ligacao",
    body: data.summary,
    authorId: actor.id,
    durationSeconds,
    recordingUrl: communication?.recordingUrl,
    manual,
  });
  await emitEvent({
    type: "call.completed",
    actor,
    clientId: ticket.clientId,
    entity: { type: "ticket", id: ticket.id },
    title: `Ligação ${data.direction === "saida" ? "para" : "de"} ${contact?.name ?? "cliente"} no chamado ${ticket.number}${manual ? " (registro manual)" : ""}`,
    description: `${data.durationMinutes} min · ${data.summary}`,
    department: "suporte",
    payload: { communicationId: communication?.id, durationSeconds, direction: data.direction, ticketId: ticket.id, manual },
  });
  // Ligação feita pelo atendente conta como resposta ao cliente.
  if (data.direction === "saida" && isOpenTicket(ticket)) await registerAgentResponse(ticket, actor, "ligação");
  return interaction;
}

export async function addTicketAttachment(ticketId: string, data: { name: string; url: string }, actor: UserRef): Promise<string> {
  const ticket = await loadTicket(ticketId);
  const doc = await create<Document>(COLLECTIONS.documents, {
    clientId: ticket.clientId,
    entityType: "ticket",
    entityId: ticket.id,
    name: data.name,
    url: data.url,
    version: 1,
    uploadedBy: actor.id,
    category: "Anexo de chamado",
    createdBy: actor.id,
  });
  await addInteraction(ticket, { kind: "nota_interna", body: `Anexo adicionado: ${data.name}`, authorId: actor.id, attachments: [data.url] });
  await emitEvent({
    type: "document.added",
    actor,
    clientId: ticket.clientId,
    entity: { type: "document", id: doc.id },
    title: `Anexo no chamado ${ticket.number}: ${data.name}`,
    department: "suporte",
    payload: { url: data.url, ticketId: ticket.id },
  });
  return doc.id;
}

// ---------------------------------------------------------------------------
// Classificação (produto, categoria, criticidade, fila)
// ---------------------------------------------------------------------------

/** Nova instância de SLA para a nova criticidade, mantendo o início, a resposta e o tempo pausado. */
async function restartSlaForPriority(ticket: SupportTicketExtra, priority: TicketPriority): Promise<SlaInstance> {
  const old = ticket.slaInstanceId ? await getById<SlaInstanceExtra>(COLLECTIONS.slaInstances, ticket.slaInstanceId) : null;
  const next = await startSla({
    ruleKey: `suporte.${priority}`,
    entityType: "chamado",
    entityId: ticket.id,
    clientId: ticket.clientId,
    ownerId: ticket.assigneeId,
    department: "suporte",
    startedAt: old?.startedAt ?? ticket.openedAt,
  });
  // O tempo já pausado desloca os prazos; uma pausa em curso é descontada por resumeSla ao retomar.
  const pausedTotalMs = old?.pausedTotalMs ?? 0;
  const shift = (iso?: string) => (iso ? new Date(new Date(iso).getTime() + pausedTotalMs).toISOString() : undefined);
  const patch: Partial<SlaInstance> = {
    pausedTotalMs,
    dueAt: shift(next.dueAt),
    responseDueAt: shift(next.responseDueAt),
    respondedAt: old?.respondedAt ?? ticket.firstResponseAt,
  };
  if (old?.status === "pausado") Object.assign(patch, { status: "pausado", pausedAt: old.pausedAt, pauseReason: old.pauseReason });
  await update<SlaInstance>(COLLECTIONS.slaInstances, next.id, patch);
  if (old && old.status !== "concluido") {
    await update<SlaInstanceExtra>(COLLECTIONS.slaInstances, old.id, { status: "concluido", completedAt: nowIso(), supersededBy: next.id });
  }
  return { ...next, ...patch } as SlaInstance;
}

export async function updateClassification(
  ticketId: string,
  data: { productId?: string; category?: string; priority: TicketPriority; queue: TicketQueue },
  actor: UserRef,
): Promise<{ slaRestarted: boolean }> {
  const ticket = await loadTicket(ticketId);
  if (data.productId && !(await getById<Product>(COLLECTIONS.products, data.productId))) throw new SupportError("Produto não encontrado");
  const changes: string[] = [];
  if ((ticket.productId ?? "") !== (data.productId ?? "")) changes.push("produto");
  if ((ticket.category ?? "") !== (data.category ?? "")) changes.push(`categoria${data.category ? ` → ${data.category}` : ""}`);
  if (ticket.queue !== data.queue) changes.push(`fila → ${TICKET_QUEUE_LABELS[data.queue].split(" ")[0]}`);
  const priorityChanged = ticket.priority !== data.priority;
  if (priorityChanged) changes.push(`criticidade ${TICKET_PRIORITY_LABELS[ticket.priority]} → ${TICKET_PRIORITY_LABELS[data.priority]}`);
  if (changes.length === 0) throw new SupportError("Nenhuma alteração na classificação");

  await update<SupportTicket>(COLLECTIONS.supportTickets, ticket.id, { productId: data.productId, category: data.category, queue: data.queue, priority: data.priority });
  const cleared = [!data.productId && ticket.productId ? "productId" : null, !data.category && ticket.category ? "category" : null].filter((f): f is string => Boolean(f));
  if (cleared.length) await clearFields(ticket.id, cleared);

  // Recalcula o SLA só enquanto o chamado está aberto; resolvidos mantêm o SLA já apurado.
  let slaRestarted = false;
  if (priorityChanged && isOpenTicket(ticket)) {
    const sla = await restartSlaForPriority(ticket, data.priority);
    await update<SupportTicket>(COLLECTIONS.supportTickets, ticket.id, { slaInstanceId: sla.id });
    slaRestarted = true;
  }

  await addInteraction(ticket, { kind: "status", body: `Classificação alterada: ${changes.join("; ")}${slaRestarted ? " (SLA recalculado pela nova criticidade)" : ""}`, authorId: actor.id });
  await emitEvent({
    type: "support.ticket.status_changed",
    actor,
    clientId: ticket.clientId,
    entity: { type: "ticket", id: ticket.id },
    title: `Chamado ${ticket.number} reclassificado`,
    description: changes.join("; "),
    department: "suporte",
    payload: { kind: "classificacao", from: ticket.status, to: ticket.status, priority: data.priority, previousPriority: ticket.priority, queue: data.queue, slaRestarted },
    // Só a mudança de criticidade interessa à timeline do cliente.
    timeline: priorityChanged,
  });
  return { slaRestarted };
}

// ---------------------------------------------------------------------------
// Aguardando cliente, resolução, fechamento, reabertura
// ---------------------------------------------------------------------------

export async function setWaitingClient(ticketId: string, reason: string, actor: UserRef): Promise<void> {
  const ticket = await loadTicket(ticketId);
  if (ticket.status !== "em_atendimento" && ticket.status !== "aberto" && ticket.status !== "reaberto") throw new SupportError("Só chamados em atendimento podem aguardar o cliente");
  if (ticket.slaInstanceId) await pauseSla(ticket.slaInstanceId, reason);
  await changeStatus(ticket, "aguardando_cliente", actor, `SLA pausado · ${reason}`, ticket.assigneeId ? {} : { assigneeId: actor.id });
  if (!ticket.assigneeId) await setSlaOwner(ticket, actor.id);
}

export async function resumeTicket(ticketId: string, actor: UserRef): Promise<void> {
  const ticket = await loadTicket(ticketId);
  if (ticket.status !== "aguardando_cliente") throw new SupportError("O chamado não está aguardando o cliente");
  if (ticket.slaInstanceId) await resumeSla(ticket.slaInstanceId);
  await changeStatus(ticket, "em_atendimento", actor, "SLA retomado");
}

export interface ResolveResult {
  /** Caminho relativo do formulário público de CSAT. */
  csatLink: string;
  /** true só quando o pedido saiu por uma integração conectada. */
  csatSent: boolean;
  csatChannel: "whatsapp" | "email";
  csatTo?: string;
  /** Texto do pedido (sem o link) para o envio manual. */
  csatMessage: string;
}

export async function resolveTicket(ticketId: string, data: Omit<ResolveData, "ticketId">, actor: UserRef): Promise<ResolveResult> {
  const ticket = await loadTicket(ticketId);
  if (!isOpenTicket(ticket)) throw new SupportError("O chamado já está resolvido ou fechado");
  // Pausado: retoma antes de concluir para o prazo refletir o tempo de pausa.
  if (ticket.status === "aguardando_cliente" && ticket.slaInstanceId) await resumeSla(ticket.slaInstanceId);
  // A mensagem de solução é uma resposta ao cliente.
  if (!ticket.firstResponseAt || !ticket.assigneeId) await registerAgentResponse(ticket, actor, "solução");

  const resolvedAt = nowIso();
  const sla = ticket.slaInstanceId ? await completeSla(ticket.slaInstanceId) : null;
  const withinSla = sla ? resolvedAt <= sla.dueAt : undefined;

  await addInteraction(ticket, { kind: "mensagem", body: data.solution, authorId: actor.id });
  await changeStatus(ticket, "resolvido", actor, `causa raiz: ${ROOT_CAUSE_LABELS[data.rootCause] ?? data.rootCause}`, {
    resolvedAt,
    solution: data.solution,
    rootCause: data.rootCause,
    trainingRelated: data.trainingRelated,
    customerConfirmation: data.customerConfirmation,
  });

  await emitEvent({
    type: "support.ticket.resolved",
    actor,
    clientId: ticket.clientId,
    entity: { type: "ticket", id: ticket.id },
    title: `Chamado ${ticket.number} resolvido por ${actor.name.split(" ")[0]}`,
    description: `${ROOT_CAUSE_LABELS[data.rootCause] ?? data.rootCause}${withinSla === false ? " · fora do SLA" : withinSla ? " · dentro do SLA" : ""} · ${data.solution.length > 200 ? `${data.solution.slice(0, 197)}…` : data.solution}`,
    department: "suporte",
    payload: { number: ticket.number, rootCause: data.rootCause, trainingRelated: data.trainingRelated, customerConfirmation: data.customerConfirmation, withinSla, assigneeId: ticket.assigneeId },
  });

  // Pedido de CSAT: WhatsApp quando o chamado veio por WhatsApp, senão e-mail. Sem integração conectada o pedido
  // NÃO é enviado: o atendente recebe o texto e o destinatário para enviar pelo app (wa.me / mailto).
  const [contact, client, status] = await Promise.all([
    ticket.contactId ? getById<Contact>(COLLECTIONS.contacts, ticket.contactId) : null,
    getById<Client>(COLLECTIONS.clients, ticket.clientId),
    getSupportChannelStatus(),
  ]);
  const channel: SupportMessageChannel = ticket.channel === "whatsapp" ? "whatsapp" : "email";
  const to = channel === "whatsapp" ? (contact?.whatsapp ?? contact?.phone ?? client?.whatsapp ?? client?.phone) : (contact?.email ?? client?.email);
  const greeting = `Olá${contact ? `, ${contact.name.split(" ")[0]}` : ""}! Seu chamado ${ticket.number} (${ticket.subject}) foi resolvido. Como foi o atendimento? Dê uma nota de 0 a 10:`;
  const sent = channel === "whatsapp" ? status.whatsapp : status.email;
  if (sent) {
    await getSupportChannels().sendMessage({
      channel,
      to,
      body: `${greeting} ${csatPath(ticket.id, true)}`,
      clientId: ticket.clientId,
      contactId: contact?.id,
      entity: { type: "ticket", id: ticket.id },
      sender: actor,
      templateKey: "csat_pedido",
    });
    await update<SupportTicketExtra>(COLLECTIONS.supportTickets, ticket.id, { csatRequestedAt: nowIso() });
  }
  return { csatLink: csatPath(ticket.id), csatSent: sent, csatChannel: channel, csatTo: to, csatMessage: greeting };
}

export async function closeTicket(ticketId: string, actor: UserRef, note?: string): Promise<void> {
  const ticket = await loadTicket(ticketId);
  if (ticket.status !== "resolvido") throw new SupportError("Só chamados resolvidos podem ser fechados");
  await changeStatus(ticket, "fechado", actor, note ?? "fechado manualmente", { closedAt: nowIso() });
}

/** Reabre como NOVO chamado (reincidência), com SLA novo; o original ganha reopenCount + 1. */
export async function reopenTicket(ticketId: string, reason: string, actor: UserRef): Promise<SupportTicket> {
  const original = await loadTicket(ticketId);
  if (original.status !== "resolvido" && original.status !== "fechado") throw new SupportError("Só chamados resolvidos ou fechados podem ser reabertos");

  const openedAt = nowIso();
  const subject = original.subject.startsWith("[Reaberto]") ? original.subject : `[Reaberto] ${original.subject}`;
  const ticket = await create<SupportTicket>(COLLECTIONS.supportTickets, {
    number: await nextTicketNumber(),
    clientId: original.clientId,
    contactId: original.contactId,
    productId: original.productId,
    subject,
    description: reason,
    channel: original.channel,
    priority: original.priority,
    category: original.category,
    assigneeId: original.assigneeId,
    queue: original.queue,
    status: "reaberto",
    openedAt,
    reopenedFromId: original.id,
    reopenCount: 0,
    createdBy: actor.id,
  });
  const sla = await startSla({
    ruleKey: `suporte.${ticket.priority}`,
    entityType: "chamado",
    entityId: ticket.id,
    clientId: ticket.clientId,
    ownerId: ticket.assigneeId,
    department: "suporte",
    startedAt: openedAt,
  });
  await update<SupportTicket>(COLLECTIONS.supportTickets, ticket.id, { slaInstanceId: sla.id });
  ticket.slaInstanceId = sla.id;
  await update<SupportTicket>(COLLECTIONS.supportTickets, original.id, { reopenCount: (original.reopenCount ?? 0) + 1 });

  await addInteraction(ticket, { kind: "status", body: `Reabertura do chamado ${original.number}: ${reason}`, authorId: actor.id, createdAt: openedAt });
  await addInteraction(original, { kind: "status", body: `Reaberto como ${ticket.number}: ${reason}`, authorId: actor.id });

  await emitEvent({
    type: "support.ticket.reopened",
    actor,
    clientId: ticket.clientId,
    entity: { type: "ticket", id: ticket.id },
    title: `Chamado ${original.number} reaberto como ${ticket.number}`,
    description: reason,
    department: "suporte",
    payload: { number: ticket.number, originalId: original.id, originalNumber: original.number, reopenCount: (original.reopenCount ?? 0) + 1, priority: ticket.priority, assigneeId: ticket.assigneeId, slaInstanceId: sla.id },
  });
  return ticket;
}

// ---------------------------------------------------------------------------
// CSAT
// ---------------------------------------------------------------------------

export interface CsatTicketInfo {
  number: string;
  subject: string;
  clientName: string;
  attendantName?: string;
  resolvedAt?: string;
  alreadyAnswered: boolean;
  score?: number;
  available: boolean;
}

/** Dados mínimos para a página pública (sem expor o chamado inteiro). */
export async function getCsatTicketInfo(ticketId: string): Promise<CsatTicketInfo | null> {
  const ticket = await getById<SupportTicket>(COLLECTIONS.supportTickets, ticketId);
  if (!ticket) return null;
  const [client, attendant, responses] = await Promise.all([
    getById<Client>(COLLECTIONS.clients, ticket.clientId),
    ticket.assigneeId ? getById<User>(COLLECTIONS.users, ticket.assigneeId) : null,
    list<CsatResponse>(COLLECTIONS.csatResponses, { where: [["ticketId", "==", ticket.id]] }),
  ]);
  return {
    number: ticket.number,
    subject: ticket.subject,
    clientName: client?.tradeName ?? "Cliente",
    attendantName: attendant?.name.split(" ")[0],
    resolvedAt: ticket.resolvedAt,
    alreadyAnswered: responses.length > 0 || ticket.csatScore !== undefined,
    score: responses[0]?.score ?? ticket.csatScore,
    available: ticket.status === "resolvido" || ticket.status === "fechado",
  };
}

/** Grava a avaliação (0–10), atualiza o chamado (nota e fechamento) e emite support.csat.received. */
export async function submitCsat(ticketId: string, data: { score: number; comment?: string }): Promise<CsatResponse> {
  const ticket = await loadTicket(ticketId);
  if (ticket.status !== "resolvido" && ticket.status !== "fechado") throw new SupportError("Este chamado ainda não foi resolvido");
  const existing = await list<CsatResponse>(COLLECTIONS.csatResponses, { where: [["ticketId", "==", ticket.id]] });
  if (existing.length > 0 || ticket.csatScore !== undefined) throw new SupportError("Este atendimento já foi avaliado. Obrigado!");

  const respondedAt = nowIso();
  const response = await create<CsatResponse>(COLLECTIONS.csatResponses, {
    ticketId: ticket.id,
    clientId: ticket.clientId,
    attendantId: ticket.assigneeId,
    productId: ticket.productId,
    score: data.score,
    comment: data.comment,
    respondedAt,
  });
  const contact = ticket.contactId ? await getById<Contact>(COLLECTIONS.contacts, ticket.contactId) : null;
  const actor: UserRef = contact ? { id: CUSTOMER_ACTOR.id, name: contact.name } : CUSTOMER_ACTOR;
  const patch: Partial<SupportTicket> = { csatScore: data.score };
  if (ticket.status === "resolvido") {
    patch.status = "fechado";
    patch.closedAt = respondedAt;
  }
  await update<SupportTicket>(COLLECTIONS.supportTickets, ticket.id, patch);
  await addInteraction(ticket, {
    kind: "status",
    body: `Cliente avaliou o atendimento com nota ${data.score}${data.comment ? `: "${data.comment}"` : ""}${patch.status === "fechado" ? " · chamado fechado" : ""}`,
  });
  await emitEvent({
    type: "support.csat.received",
    actor,
    clientId: ticket.clientId,
    entity: { type: "ticket", id: ticket.id },
    title: `CSAT ${data.score} recebido no chamado ${ticket.number}`,
    description: data.comment,
    department: "suporte",
    payload: { number: ticket.number, score: data.score, csatResponseId: response.id, attendantId: ticket.assigneeId, productId: ticket.productId, closed: patch.status === "fechado" },
  });
  return response;
}

// ---------------------------------------------------------------------------
// Oportunidade gerada pelo suporte
// ---------------------------------------------------------------------------

export async function createOpportunityFromTicket(ticketId: string, data: { productId: string; need: string; notes?: string }, actor: UserRef): Promise<Opportunity> {
  const ticket = await loadTicket(ticketId);
  if (ticket.originatedOpportunityId) throw new SupportError("Este chamado já gerou uma oportunidade");
  const client = await loadClient(ticket.clientId);
  if (client.status === "cancelado") throw new SupportError("Cliente cancelado: registre a oportunidade como nova venda em Vendas");
  const [product, owned, opportunities, catalog] = await Promise.all([
    getById<Product>(COLLECTIONS.products, data.productId),
    list<ClientProduct>(COLLECTIONS.clientProducts, { where: [["clientId", "==", client.id]] }),
    list<Opportunity>(COLLECTIONS.opportunities, { where: [["clientId", "==", client.id]] }),
    list<Product>(COLLECTIONS.products),
  ]);
  if (!product || product.active === false) throw new SupportError("Produto não encontrado no catálogo");
  const ownedActive = owned.filter((p) => p.status !== "cancelado");
  if (ownedActive.some((p) => p.productId === product.id)) throw new SupportError(`O cliente já tem ${product.name} contratado`);
  if (opportunities.some((o) => OPEN_OPPORTUNITY.has(o.stage) && o.products.some((p) => p.productId === product.id))) {
    throw new SupportError(`Já existe oportunidade aberta de ${product.name} para este cliente`);
  }

  // Mesma categoria de algo contratado = upsell; categoria nova = cross-sell.
  const categoryOf = new Map(catalog.map((p) => [p.id, p.category]));
  const kind: Opportunity["kind"] = ownedActive.some((p) => categoryOf.get(p.productId) === product.category) ? "upsell" : "cross_sell";
  const ownerId = client.ownerSalesId ?? (await getDepartmentManager("vendas"))?.id ?? actor.id;
  // A origem (recompensa por oportunidade válida) é o atendente do chamado, mesmo quando o gestor registra.
  const attendantId = ticket.assigneeId ?? actor.id;
  const attendant = attendantId === actor.id ? actor : ((await getById<User>(COLLECTIONS.users, attendantId)) ?? actor);

  const opp = await createOpportunity(
    {
      clientId: client.id,
      title: `${kind === "upsell" ? "Upsell" : "Cross-sell"} ${product.name} — ${client.tradeName}`,
      kind,
      ownerId,
      temperature: "morno",
      products: [{ productId: product.id, productName: product.name, quantity: 1, setupValue: product.setupPrice, monthlyValue: product.monthlyPrice, hardwareValue: product.hardwarePrice }],
      need: data.need,
      nextAction: "Qualificar a oportunidade indicada pelo suporte",
      nextActionAt: new Date(Date.now() + 48 * 3600_000).toISOString(),
    },
    { ...actor, departmentId: "suporte" },
  );
  const diagnosis = `Identificada pelo suporte no chamado ${ticket.number} (${ticket.subject}).${data.notes ? ` ${data.notes}` : ""}`;
  await update<Opportunity>(COLLECTIONS.opportunities, opp.id, { originDepartment: "suporte", originUserId: attendant.id, diagnosis });
  await update<SupportTicket>(COLLECTIONS.supportTickets, ticket.id, { originatedOpportunityId: opp.id });
  await addInteraction(ticket, { kind: "nota_interna", body: `Oportunidade de ${kind === "upsell" ? "upsell" : "cross-sell"} gerada: ${product.name} · ${data.need}`, authorId: actor.id });

  const event = await emitEvent({
    type: "upsell.created",
    actor,
    clientId: client.id,
    entity: { type: "opportunity", id: opp.id },
    title: `Oportunidade de ${kind === "upsell" ? "upsell" : "cross-sell"} gerada pelo suporte: ${product.name}`,
    description: [data.need, opp.monthlyTotal > 0 ? `${formatCurrency(opp.monthlyTotal)}/mês` : null, `chamado ${ticket.number}`].filter(Boolean).join(" · "),
    department: "suporte",
    payload: { productId: product.id, kind, monthlyTotal: opp.monthlyTotal, setupTotal: opp.setupTotal, ownerId, originDepartment: "suporte", originUserId: attendant.id, ticketId: ticket.id },
  });
  if (ownerId !== actor.id) {
    await notify({
      userIds: [ownerId],
      kind: "acao",
      title: `Nova oportunidade do suporte: ${product.name}`,
      body: `${client.tradeName} · indicada por ${attendant.name} no chamado ${ticket.number}`,
      href: `/vendas/oportunidades?oportunidade=${opp.id}`,
      entity: { type: "opportunity", id: opp.id },
      eventId: event.id,
    });
  }
  return { ...opp, originDepartment: "suporte", originUserId: attendant.id, diagnosis };
}

// ---------------------------------------------------------------------------
// Base de conhecimento
// ---------------------------------------------------------------------------

export async function saveArticle(data: ArticleData, actor: UserRef): Promise<KnowledgeArticle> {
  const keywords = Array.from(new Set(data.keywords.map((k) => k.trim().toLowerCase()).filter(Boolean)));
  const payload = {
    title: data.title,
    productId: data.productId,
    module: data.module,
    category: data.category,
    problem: data.problem,
    keywords,
    body: data.body,
    tags: Array.from(new Set(data.tags)),
    published: data.published,
  };
  if (data.id) {
    const current = await getById<KnowledgeArticle>(COLLECTIONS.knowledgeArticles, data.id);
    if (!current) throw new SupportError("Artigo não encontrado");
    await update<KnowledgeArticle>(COLLECTIONS.knowledgeArticles, current.id, payload);
    // Campos opcionais esvaziados no formulário são removidos do documento (o update ignora undefined).
    const optional = ["productId", "module", "category", "problem"] as const;
    const cleared = optional.filter((f) => !data[f] && current[f]);
    if (cleared.length) {
      const patch: Record<string, unknown> = {};
      for (const f of cleared) patch[f] = FieldValue.delete();
      await col(COLLECTIONS.knowledgeArticles).doc(current.id).update(patch);
    }
    return { ...current, ...payload };
  }
  const source = data.sourceTicketId ? await getById<SupportTicket>(COLLECTIONS.supportTickets, data.sourceTicketId) : null;
  const article = await create<KnowledgeArticle>(COLLECTIONS.knowledgeArticles, {
    ...payload,
    authorId: actor.id,
    views: 0,
    helpful: 0,
    notHelpful: 0,
    sourceTicketId: source?.id,
    createdBy: actor.id,
  });
  if (source) {
    await addInteraction(source, { kind: "nota_interna", body: `Artigo da base de conhecimento criado a partir deste chamado: ${article.title}`, authorId: actor.id });
  }
  // Fica no histórico do cliente (quando nasce de um chamado) sem ir para a timeline pública.
  await emitEvent({
    type: "knowledge.article.created",
    actor,
    clientId: source?.clientId,
    entity: { type: "knowledge_article", id: article.id },
    title: source ? `Artigo da base criado a partir do chamado ${source.number}: ${article.title}` : `Artigo da base criado: ${article.title}`,
    department: "suporte",
    payload: { ticketId: source?.id, articleId: article.id, internal: true },
    timeline: false,
  });
  return article;
}

export async function incrementArticleViews(id: string): Promise<void> {
  await col(COLLECTIONS.knowledgeArticles).doc(id).update({ views: FieldValue.increment(1) });
}

/** "Este artigo foi útil?": incrementa helpful ou notHelpful. */
export async function voteArticle(id: string, helpful: boolean, actor?: UserRef): Promise<void> {
  const article = await getById<KnowledgeArticle>(COLLECTIONS.knowledgeArticles, id);
  if (!article) throw new SupportError("Artigo não encontrado");
  await col(COLLECTIONS.knowledgeArticles)
    .doc(id)
    .update({ [helpful ? "helpful" : "notHelpful"]: FieldValue.increment(1) });
  if (actor) {
    await emitEvent({
      type: "knowledge.article.voted",
      actor,
      entity: { type: "knowledge_article", id },
      title: `${helpful ? "Artigo útil" : "Artigo não resolveu"}: ${article.title}`,
      department: "suporte",
      payload: { articleId: id, helpful },
      timeline: false,
    });
  }
}

// ---------------------------------------------------------------------------
// WhatsApp de entrada (webhook)
// ---------------------------------------------------------------------------

const digitsOnly = (v: string | undefined | null) => (v ?? "").replace(/\D/g, "");

/** Compara telefones pelos últimos 10 dígitos (ignora DDI e o 9º dígito opcional fica coberto pelo DDD + número). */
function samePhone(a: string | undefined | null, b: string | undefined | null): boolean {
  const da = digitsOnly(a);
  const db = digitsOnly(b);
  if (da.length < 8 || db.length < 8) return false;
  return da.slice(-10) === db.slice(-10) || da.slice(-8) === db.slice(-8);
}

export interface IncomingWhatsappResult {
  matched: "chamado" | "caixa_de_entrada";
  ticketId?: string;
  clientId?: string;
  communicationId: string;
}

/**
 * Mensagem de WhatsApp recebida: se o telefone for de um contato (ou do próprio cliente) com chamado
 * aberto, vira interação do chamado mais recente; senão fica na Caixa de Entrada do Marketing.
 */
export async function receiveWhatsappMessage(input: { from: string; body: string; externalId?: string }): Promise<IncomingWhatsappResult> {
  const [contacts, clients] = await Promise.all([list<Contact>(COLLECTIONS.contacts), list<Client>(COLLECTIONS.clients)]);
  const contact = contacts.find((c) => samePhone(c.whatsapp, input.from) || samePhone(c.phone, input.from));
  const clientId = contact?.clientId ?? clients.find((c) => samePhone(c.whatsapp, input.from) || samePhone(c.phone, input.from))?.id;

  let ticket: SupportTicket | undefined;
  if (clientId) {
    const tickets = await list<SupportTicket>(COLLECTIONS.supportTickets, { where: [["clientId", "==", clientId]] });
    ticket = tickets.filter(isOpenTicket).sort((a, b) => (a.openedAt < b.openedAt ? 1 : -1))[0];
  }
  const communication = await getSupportChannels().receiveMessage({
    channel: "whatsapp",
    from: input.from,
    body: input.body,
    clientId,
    contactId: contact?.id,
    entity: ticket ? { type: "ticket", id: ticket.id } : undefined,
    externalId: input.externalId,
  });
  const who = contact?.name ?? input.from;
  if (ticket) {
    await addInteraction(ticket, { kind: "whatsapp", body: input.body });
    await emitEvent({
      type: "whatsapp.message.received",
      actor: { id: CUSTOMER_ACTOR.id, name: who },
      clientId: ticket.clientId,
      entity: { type: "ticket", id: ticket.id },
      title: `WhatsApp recebido de ${who} no chamado ${ticket.number}`,
      description: input.body,
      department: "suporte",
      payload: { communicationId: communication.id, from: input.from, ticketId: ticket.id },
    });
    if (ticket.assigneeId) {
      await notify({
        userIds: [ticket.assigneeId],
        kind: ticket.status === "aguardando_cliente" ? "acao" : "informativa",
        title: `Cliente respondeu no chamado ${ticket.number}`,
        body: input.body.length > 140 ? `${input.body.slice(0, 137)}…` : input.body,
        href: ticketHref(ticket.id),
        entity: { type: "ticket", id: ticket.id },
      });
    }
    return { matched: "chamado", ticketId: ticket.id, clientId, communicationId: communication.id };
  }
  await emitEvent({
    type: "whatsapp.message.received",
    actor: { id: CUSTOMER_ACTOR.id, name: who },
    clientId,
    entity: { type: "communication", id: communication.id },
    title: `WhatsApp recebido de ${who}`,
    description: input.body,
    department: "marketing",
    payload: { communicationId: communication.id, from: input.from },
  });
  return { matched: "caixa_de_entrada", clientId, communicationId: communication.id };
}

// ---------------------------------------------------------------------------
// Alertas de SLA (varredura)
// ---------------------------------------------------------------------------

export interface SlaAlertResult {
  ranAt: string;
  scanned: number;
  atRisk: number;
  breached: number;
}

/**
 * Varre os SLAs em andamento dos chamados e emite sla.at_risk (uma vez) e sla.breached (uma vez),
 * marcando `alertedRisk`/`alertedBreach` na instância. Instâncias substituídas ou de chamados já
 * encerrados são ignoradas.
 */
export async function checkSlaAlerts(now: Date = new Date()): Promise<SlaAlertResult> {
  const ranAt = now.toISOString();
  const running = await list<SlaInstanceExtra>(COLLECTIONS.slaInstances, { where: [["entityType", "==", "chamado"], ["status", "==", "em_andamento"]] });
  const tickets = await getManyByIds<SupportTicket>(COLLECTIONS.supportTickets, running.map((s) => s.entityId));
  const clients = await getManyByIds<Client>(COLLECTIONS.clients, Array.from(tickets.values()).map((t) => t.clientId));
  let atRisk = 0;
  let breached = 0;
  for (const sla of running) {
    const ticket = tickets.get(sla.entityId);
    if (!ticket || ticket.slaInstanceId !== sla.id || !isOpenTicket(ticket) || sla.supersededBy) continue;
    const view = computeSlaState(sla, now);
    const clientName = clients.get(ticket.clientId)?.tradeName ?? "cliente";
    const payload = { ownerId: sla.ownerId ?? ticket.assigneeId, href: ticketHref(ticket.id), entityType: "chamado", ticketId: ticket.id, slaInstanceId: sla.id, dueAt: sla.dueAt, priority: ticket.priority, number: ticket.number };
    if (view.state === "violado" && !sla.alertedBreach) {
      await update<SlaInstanceExtra>(COLLECTIONS.slaInstances, sla.id, { alertedBreach: true, alertedRisk: true, breachedAt: sla.breachedAt ?? sla.dueAt });
      await emitEvent({
        type: "sla.breached",
        actor: SUPPORT_SYSTEM_ACTOR,
        clientId: ticket.clientId,
        entity: { type: "ticket", id: ticket.id },
        title: `SLA violado: chamado ${ticket.number} — ${clientName}`,
        description: `${TICKET_PRIORITY_LABELS[ticket.priority]} · ${ticket.subject}`,
        department: "suporte",
        payload,
      });
      breached++;
    } else if (view.state === "em_risco" && !sla.alertedRisk) {
      await update<SlaInstanceExtra>(COLLECTIONS.slaInstances, sla.id, { alertedRisk: true });
      await emitEvent({
        type: "sla.at_risk",
        actor: SUPPORT_SYSTEM_ACTOR,
        clientId: ticket.clientId,
        entity: { type: "ticket", id: ticket.id },
        title: `SLA em risco: chamado ${ticket.number} — ${clientName}`,
        description: `${TICKET_PRIORITY_LABELS[ticket.priority]} · ${Math.round(view.consumedPct)}% do prazo consumido`,
        department: "suporte",
        payload,
        timeline: false,
      });
      atRisk++;
    }
  }
  return { ranAt, scanned: running.length, atRisk, breached };
}

/** Roda `checkSlaAlerts` no máximo a cada 10 minutos (chamado ao abrir a Central de Suporte). */
export async function maybeRunSlaAlerts(): Promise<SlaAlertResult | null> {
  const doc = await readSettingDoc("sweeps");
  const last = doc?.value?.supportSlaLastRunAt;
  if (typeof last === "string" && Date.now() - new Date(last).getTime() < SLA_SWEEP_INTERVAL_MS) return null;
  // Marca antes de rodar para que acessos simultâneos não disparem a mesma varredura.
  await mergeSetting("sweeps", { supportSlaLastRunAt: nowIso() }, "Última execução das varreduras automáticas.");
  const result = await checkSlaAlerts();
  await mergeSetting("sweeps", { supportSlaLastResult: result }, "Última execução das varreduras automáticas.");
  return result;
}

// ---------------------------------------------------------------------------
// Handlers (chamados por src/server/events/handlers/support.ts)
// ---------------------------------------------------------------------------

/** support.ticket.created: avisa a fila e anota no evento se o cliente está nos 30 dias pós go-live. */
export async function onTicketCreated(event: DomainEvent): Promise<void> {
  if (event.entityType !== "ticket" || !event.entityId) return;
  const ticket = await getById<SupportTicket>(COLLECTIONS.supportTickets, event.entityId);
  if (!ticket) return;
  const [team, client, projects] = await Promise.all([
    getSupportTeam(),
    getById<Client>(COLLECTIONS.clients, ticket.clientId),
    list<ImplementationProject>(COLLECTIONS.implementationProjects, { where: [["clientId", "==", ticket.clientId]] }),
  ]);
  const urgent = ticket.priority === "critico" || ticket.priority === "alto";
  // A fila inteira é avisada (ação para crítico/alto); o atendente já definido também.
  const targets = [...team.map((u) => u.id), ticket.assigneeId].filter((id): id is string => Boolean(id) && id !== event.actorId);
  await notify({
    userIds: targets,
    kind: urgent ? "acao" : "informativa",
    title: `Novo chamado ${ticket.number}: ${ticket.subject}`,
    body: `${client?.tradeName ?? "Cliente"} · ${TICKET_PRIORITY_LABELS[ticket.priority]} · fila ${ticket.queue.toUpperCase()}${ticket.assigneeId ? " · já atribuído" : " · sem atendente"}`,
    href: ticketHref(ticket.id),
    entity: { type: "ticket", id: ticket.id },
    eventId: event.id,
  });

  // Chamado nos 30 dias após o go-live: sugere relação com treinamento (só anota no evento).
  const goLives = projects.map((p) => p.goLiveAt).filter((d): d is string => Boolean(d));
  const reference = goLives.sort().pop() ?? client?.activatedAt;
  if (reference) {
    const days = (new Date(ticket.openedAt).getTime() - new Date(reference).getTime()) / 86_400_000;
    if (days >= 0 && days <= 30) {
      await update<DomainEvent>(COLLECTIONS.events, event.id, { payload: { ...event.payload, postGoLive: true, goLiveAt: reference, daysSinceGoLive: Math.floor(days), suggestTrainingRelated: true } });
    }
  }
}

/** SLA de chamado em risco/violado: além do responsável (handler genérico), avisa gestor e fila. */
export async function onTicketSlaAlert(event: DomainEvent): Promise<void> {
  if (event.payload.entityType !== "chamado") return;
  const ticketId = String(event.payload.ticketId ?? "");
  const ownerId = String(event.payload.ownerId ?? "");
  const manager = await getSupportManager();
  const breached = event.type === "sla.breached";
  const targets = new Set<string>();
  if (breached && manager) targets.add(manager.id);
  if (!ownerId) for (const u of await getSupportTeam()) targets.add(u.id);
  targets.delete(ownerId);
  if (targets.size === 0) return;
  await notify({
    userIds: Array.from(targets),
    kind: breached ? "critica" : "atencao",
    title: breached ? "SLA de chamado violado" : "SLA de chamado em risco",
    body: event.title,
    href: ticketId ? ticketHref(ticketId) : "/suporte",
    entity: ticketId ? { type: "ticket", id: ticketId } : undefined,
    eventId: event.id,
  });
}

/** CSAT baixo (≤ 6): tarefa para o gestor de suporte investigar e aviso ao atendente. Idempotente. */
export async function onCsatReceived(event: DomainEvent): Promise<void> {
  const score = Number(event.payload.score);
  if (!Number.isFinite(score) || score > LOW_CSAT_THRESHOLD || !event.entityId) return;
  const ticket = await getById<SupportTicket>(COLLECTIONS.supportTickets, event.entityId);
  if (!ticket) return;
  const existing = await list<Task>(COLLECTIONS.tasks, { where: [["processId", "==", ticket.id]] });
  if (existing.some((t) => t.sourceEventId === event.id)) return;
  const manager = await getSupportManager();
  const assigneeId = manager?.id ?? ticket.assigneeId;
  if (!assigneeId) return;
  const holidays = await getHolidays();
  await createTaskInternal(
    {
      title: `Investigar avaliação baixa (${score}) — chamado ${ticket.number}`,
      description: `O cliente avaliou o atendimento do chamado ${ticket.number} (${ticket.subject}) com nota ${score}.${event.description ? ` Comentário: "${event.description}".` : ""} Entre em contato, entenda o motivo e registre a ação corretiva.`,
      clientId: ticket.clientId,
      assigneeId,
      departmentId: "suporte",
      priority: score <= 4 ? "critica" : "alta",
      dueAt: addBusinessHours(new Date(), 10, holidays).toISOString(),
      processType: "ticket",
      processId: ticket.id,
      origin: "evento",
      sourceEventId: event.id,
      checklist: ["Contatar o cliente", "Identificar a causa da insatisfação", "Registrar ação corretiva"],
      tags: ["csat"],
    },
    SUPPORT_SYSTEM_ACTOR,
  );
  if (ticket.assigneeId && ticket.assigneeId !== assigneeId) {
    await notify({
      userIds: [ticket.assigneeId],
      kind: "atencao",
      title: `Avaliação baixa no chamado ${ticket.number}: nota ${score}`,
      body: event.description ?? ticket.subject,
      href: ticketHref(ticket.id),
      entity: { type: "ticket", id: ticket.id },
      eventId: event.id,
    });
  }
}

/** Reabertura: avisa o atendente e o gestor de suporte (reincidência afeta o bônus da equipe). */
export async function onTicketReopened(event: DomainEvent): Promise<void> {
  if (event.entityType !== "ticket" || !event.entityId) return;
  const manager = await getSupportManager();
  const assigneeId = typeof event.payload.assigneeId === "string" ? event.payload.assigneeId : undefined;
  await notify({
    userIds: [assigneeId, manager?.id].filter((id): id is string => Boolean(id) && id !== event.actorId),
    kind: "atencao",
    title: `Chamado reaberto: ${String(event.payload.originalNumber ?? "")} → ${String(event.payload.number ?? "")}`,
    body: event.description,
    href: ticketHref(event.entityId),
    entity: { type: "ticket", id: event.entityId },
    eventId: event.id,
  });
}
