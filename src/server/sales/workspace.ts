import "server-only";
/**
 * Serviço do workspace da Central de Vendas: mensagens (WhatsApp/e-mail), nota interna, ligação, anexos e
 * transferência de vendedor. Sem validação de sessão (feita nas Server Actions).
 *
 * Canais: consultados no registro de integrações (./channels.ts). Com o canal conectado e destino
 * cadastrado, a mensagem sai pelo provedor (status "enviada" ou "falha"). Sem conexão, é gravada como
 * REGISTRO MANUAL (status/provider "manual") com o texto que o usuário digitou, e a tela oferece abrir o
 * wa.me/mailto: com o texto. Ligações são sempre registro manual (não há adaptador VoIP). Cada registro
 * emite o evento correspondente (timeline do cliente, CS, automações).
 */
import { canAccessModule } from "@/server/auth/session";
import { create, getById, list, nowIso, update } from "@/server/db";
import { emitEvent } from "@/server/events";
import { MANUAL, recordCommunication } from "@/server/integrations/communications";
import { sendEmail, sendWhatsappText } from "@/server/integrations/providers";
import { notify } from "@/server/notifications";
import { assignTaskInternal } from "@/server/tasks/service";
import { COLLECTIONS, type Client, type Contact, type DomainEvent, type Document, type Opportunity, type Task, type User, type UserRef, type Visit } from "@/domain/types";
import { formatCallDuration } from "@/components/sales/model";
import { getSalesChannelStatus } from "./channels";
import { isClosed, loadOpportunity } from "./service";
import type { WorkspaceMessageChannel } from "./schemas";

const OPEN_TASK = new Set<Task["status"]>(["aberta", "em_andamento", "aguardando"]);
const PENDING_VISIT = new Set<Visit["status"]>(["agendada", "remarcada"]);

async function contextOf(opportunityId: string) {
  const opp = await loadOpportunity(opportunityId);
  const [client, contacts] = await Promise.all([
    getById<Client>(COLLECTIONS.clients, opp.clientId),
    list<Contact>(COLLECTIONS.contacts, { where: [["clientId", "==", opp.clientId]] }),
  ]);
  if (!client) throw new Error("Cliente da oportunidade não encontrado");
  const contact = contacts.find((c) => c.isPrimary) ?? contacts[0] ?? null;
  return { opp, client, contact, who: contact?.name ?? client.tradeName };
}

async function touch(opp: Opportunity, at: string): Promise<void> {
  await update<Opportunity>(COLLECTIONS.opportunities, opp.id, { lastActivityAt: at });
}

export interface MessageResult {
  communicationId: string;
  eventId: string;
  /** "enviada" pelo provedor, "falha" no provedor ou "manual" (canal não conectado). */
  delivery: "enviada" | "falha" | "manual";
  error?: string;
}

/**
 * Mensagem de WhatsApp ou e-mail escrita no composer. Envia pelo provedor quando o canal está conectado;
 * senão registra manualmente (o usuário envia pelo próprio app).
 */
export async function sendOrRegisterMessage(input: { opportunityId: string; channel: WorkspaceMessageChannel; body: string }, actor: UserRef): Promise<MessageResult> {
  const { opp, client, contact, who } = await contextOf(input.opportunityId);
  const channels = await getSalesChannelStatus();
  const whatsapp = input.channel === "whatsapp";
  const to = whatsapp ? (contact?.whatsapp ?? client.whatsapp ?? contact?.phone ?? client.phone) : (contact?.email ?? client.email);
  const connected = whatsapp ? channels.whatsapp : channels.email;

  let delivery: MessageResult["delivery"] = "manual";
  let externalId: string | undefined;
  let error: string | undefined;
  if (connected && to) {
    const result = whatsapp ? await sendWhatsappText(to, input.body) : await sendEmail({ to, subject: `${opp.title} — ${client.tradeName}`, text: input.body });
    delivery = result.ok ? "enviada" : "falha";
    if (result.ok) externalId = result.externalId;
    else error = result.error;
  }
  const base = {
    clientId: opp.clientId,
    contactId: contact?.id,
    channel: input.channel,
    direction: "saida" as const,
    userId: actor.id,
    entityType: "opportunity",
    entityId: opp.id,
    body: input.body,
    externalId,
    createdBy: actor.id,
  };
  const communication = await recordCommunication(
    delivery === "manual" ? { ...base, ...MANUAL } : { ...base, status: delivery, provider: whatsapp ? "meta" : "resend" },
  );
  const suffix = delivery === "manual" ? " (registro manual)" : delivery === "falha" ? " (falha no envio)" : "";
  // Não há tipo "email.sent": o e-mail entra na timeline como nota (payload.channel = "email").
  const event = await emitEvent({
    type: whatsapp ? "whatsapp.message.sent" : "note.added",
    actor,
    clientId: opp.clientId,
    entity: { type: "opportunity", id: opp.id },
    title: `${whatsapp ? "WhatsApp" : "E-mail"} para ${who}${suffix}`,
    description: input.body,
    department: "vendas",
    payload: { opportunityId: opp.id, communicationId: communication.id, channel: input.channel, contactId: contact?.id, manual: delivery === "manual", delivery, ownerId: opp.ownerId },
  });
  await touch(opp, event.occurredAt);
  return { communicationId: communication.id, eventId: event.id, delivery, error };
}

/** Nota interna (não vai ao cliente): destaque na conversa e na timeline. */
export async function registerInternalNote(input: { opportunityId: string; body: string }, actor: UserRef): Promise<DomainEvent> {
  const opp = await loadOpportunity(input.opportunityId);
  const event = await emitEvent({
    type: "note.added",
    actor,
    clientId: opp.clientId,
    entity: { type: "opportunity", id: opp.id },
    title: `Nota interna: ${opp.title}`,
    description: input.body,
    department: "vendas",
    payload: { opportunityId: opp.id, internal: true, ownerId: opp.ownerId },
  });
  await touch(opp, event.occurredAt);
  return event;
}

/** Ligação feita pelo telefone do usuário: communication voip (duração 0 = sem resposta) + call.completed. */
export async function registerCall(
  input: { opportunityId: string; outcome: "atendeu" | "nao_atendeu"; durationSeconds: number; summary?: string },
  actor: UserRef,
): Promise<{ communicationId: string; eventId: string }> {
  const { opp, contact, who } = await contextOf(input.opportunityId);
  const answered = input.outcome === "atendeu";
  // Sem adaptador VoIP: a ligação feita pelo telefone do usuário é sempre registro manual.
  const communication = await recordCommunication({
    clientId: opp.clientId,
    contactId: contact?.id,
    channel: "voip",
    direction: "saida",
    userId: actor.id,
    entityType: "opportunity",
    entityId: opp.id,
    body: input.summary,
    durationSeconds: answered ? input.durationSeconds : 0,
    createdBy: actor.id,
    ...MANUAL,
  });
  const duration = answered ? formatCallDuration(input.durationSeconds) : "";
  const event = await emitEvent({
    type: "call.completed",
    actor,
    clientId: opp.clientId,
    entity: { type: "opportunity", id: opp.id },
    title: `Ligação para ${who} (${answered ? "atendeu" : "não atendeu"})${duration ? ` — ${duration}` : ""}`,
    description: input.summary,
    department: "vendas",
    payload: { opportunityId: opp.id, communicationId: communication.id, outcome: input.outcome, durationSeconds: answered ? input.durationSeconds : 0, contactId: contact?.id, manual: true, ownerId: opp.ownerId },
  });
  await touch(opp, event.occurredAt);
  return { communicationId: communication.id, eventId: event.id };
}

/** Anexo por link: vira documento do cliente vinculado à oportunidade (versão incrementada por nome). */
export async function attachOpportunityDocument(input: { opportunityId: string; name: string; url: string; category?: string }, actor: UserRef): Promise<Document> {
  const opp = await loadOpportunity(input.opportunityId);
  const existing = await list<Document>(COLLECTIONS.documents, { where: [["clientId", "==", opp.clientId]] });
  const version = existing.filter((d) => d.name.trim().toLowerCase() === input.name.trim().toLowerCase()).reduce((max, d) => Math.max(max, d.version), 0) + 1;
  const doc = await create<Document>(COLLECTIONS.documents, {
    clientId: opp.clientId,
    entityType: "opportunity",
    entityId: opp.id,
    name: input.name,
    url: input.url,
    version,
    uploadedBy: actor.id,
    category: input.category ?? "comercial",
    createdBy: actor.id,
  });
  const event = await emitEvent({
    type: "document.added",
    actor,
    clientId: opp.clientId,
    entity: { type: "document", id: doc.id },
    title: `Documento anexado: ${doc.name}${version > 1 ? ` (v${version})` : ""}`,
    description: opp.title,
    department: "vendas",
    payload: { opportunityId: opp.id, url: doc.url, category: doc.category, version },
  });
  await touch(opp, event.occurredAt);
  return doc;
}

/**
 * Transfere a oportunidade para outro vendedor: troca o dono, repassa as tarefas abertas e as visitas
 * pendentes que eram do dono anterior, atualiza o vendedor do cliente quando ainda é lead/prospect e
 * notifica o novo responsável (e o anterior, quando não foi ele quem transferiu).
 */
export async function transferOpportunity(input: { opportunityId: string; ownerId: string; reason?: string }, actor: UserRef): Promise<Opportunity> {
  const opp = await loadOpportunity(input.opportunityId);
  if (isClosed(opp)) throw new Error("Oportunidade encerrada não pode ser transferida");
  if (opp.ownerId === input.ownerId) throw new Error("Este vendedor já é o responsável");
  const [newOwner, previous, client] = await Promise.all([
    getById<User>(COLLECTIONS.users, input.ownerId),
    getById<User>(COLLECTIONS.users, opp.ownerId),
    getById<Client>(COLLECTIONS.clients, opp.clientId),
  ]);
  if (!newOwner || newOwner.active === false) throw new Error("Vendedor não encontrado ou inativo");
  if (!canAccessModule({ role: newOwner.role, isAdmin: newOwner.role === "admin" }, "vendas")) throw new Error(`${newOwner.name} não tem acesso ao módulo de Vendas`);

  const now = nowIso();
  await update<Opportunity>(COLLECTIONS.opportunities, opp.id, { ownerId: newOwner.id, lastActivityAt: now });

  const [tasks, visits] = await Promise.all([
    list<Task>(COLLECTIONS.tasks, { where: [["processId", "==", opp.id]] }),
    list<Visit>(COLLECTIONS.visits, { where: [["opportunityId", "==", opp.id]] }),
  ]);
  const movedTasks = tasks.filter((t) => t.processType === "opportunity" && OPEN_TASK.has(t.status) && t.assigneeId === opp.ownerId);
  for (const task of movedTasks) await assignTaskInternal(task, newOwner.id, actor);
  const movedVisits = visits.filter((v) => PENDING_VISIT.has(v.status) && v.sellerId === opp.ownerId);
  for (const visit of movedVisits) await update<Visit>(COLLECTIONS.visits, visit.id, { sellerId: newOwner.id });
  if (client && client.ownerSalesId === opp.ownerId && (client.status === "lead" || client.status === "prospect")) {
    await update<Client>(COLLECTIONS.clients, client.id, { ownerSalesId: newOwner.id });
  }

  const moved = [movedTasks.length > 0 ? `${movedTasks.length} tarefa(s)` : null, movedVisits.length > 0 ? `${movedVisits.length} visita(s)` : null].filter(Boolean).join(" e ");
  // Não há tipo "opportunity.reassigned": a transferência entra na timeline como nota (payload.transfer).
  const event = await emitEvent({
    type: "note.added",
    actor,
    clientId: opp.clientId,
    entity: { type: "opportunity", id: opp.id },
    title: `Oportunidade transferida: ${previous?.name ?? "—"} → ${newOwner.name}`,
    description: [input.reason, moved ? `Repassadas ${moved}` : null].filter(Boolean).join(" · ") || undefined,
    department: "vendas",
    payload: { opportunityId: opp.id, transfer: true, from: opp.ownerId, to: newOwner.id, ownerId: newOwner.id, reason: input.reason, taskIds: movedTasks.map((t) => t.id), visitIds: movedVisits.map((v) => v.id) },
  });

  const clientName = client?.tradeName ?? opp.title;
  await notify({
    userIds: newOwner.id === actor.id ? [] : [newOwner.id],
    kind: "acao",
    title: `Oportunidade transferida para você: ${clientName}`,
    body: `${opp.title} · por ${actor.name}${input.reason ? ` · ${input.reason}` : ""}`,
    href: `/vendas?oportunidade=${opp.id}`,
    entity: { type: "opportunity", id: opp.id },
    eventId: event.id,
  });
  if (previous && previous.id !== actor.id) {
    await notify({
      userIds: [previous.id],
      kind: "informativa",
      title: `Oportunidade transferida para ${newOwner.name}: ${clientName}`,
      body: `${opp.title} · por ${actor.name}`,
      href: `/vendas/oportunidades?oportunidade=${opp.id}`,
      entity: { type: "opportunity", id: opp.id },
      eventId: event.id,
    });
  }
  return { ...opp, ownerId: newOwner.id, lastActivityAt: now };
}
