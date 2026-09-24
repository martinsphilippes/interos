"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { requireUser } from "@/server/auth/session";
import { create, getById, list, remove, update, nowIso, type CreateInput } from "@/server/db";
import { emitEvent } from "@/server/events";
import { formatCurrency, formatPhone } from "@/lib/format";
import { CLIENT_STATUS_LABELS } from "@/domain/constants";
import {
  COLLECTIONS,
  type ActionResult,
  type BaseEntity,
  type Client,
  type CollectionName,
  type ClientProduct,
  type Communication,
  type Contact,
  type CurrentUser,
  type Document,
  type Opportunity,
  type Product,
  type UserRef,
} from "@/domain/types";
import {
  changeStatusSchema,
  contactEventSchema,
  contactSchema,
  createClientSchema,
  documentSchema,
  findDuplicatesSchema,
  noteSchema,
  removeContactSchema,
  updateClientSchema,
  updateContactSchema,
  upsellSchema,
  zodMessage,
} from "./schemas";
import { createWorkflowInstanceForClient } from "@/server/workflow/service";

/**
 * Server Actions do módulo Clientes 360º.
 *
 * Padrão: requireUser() → validação zod (ZodError vira { ok: false, error }) → mutação via db.ts →
 * emitEvent (alimenta a timeline do cliente) → revalidatePath das rotas afetadas.
 */

const actor = (user: CurrentUser): UserRef => ({ id: user.id, name: user.name });

function fail(error: unknown, fallback: string): { ok: false; error: string } {
  if (error instanceof z.ZodError) return { ok: false, error: zodMessage(error) };
  console.error(`[clients] ${fallback}`, error);
  return { ok: false, error: error instanceof Error && error.message ? `${fallback}: ${error.message}` : fallback };
}

function revalidateClient(id?: string) {
  revalidatePath("/clientes");
  if (id) revalidatePath(`/clientes/${id}`);
}

async function loadClient(id: string): Promise<Client> {
  const client = await getById<Client>(COLLECTIONS.clients, id);
  if (!client) throw new Error("Cliente não encontrado");
  return client;
}

/**
 * Regrava o documento inteiro (set sem merge). Diferente de `update`, campos opcionais que ficaram
 * `undefined` no patch são removidos do Firestore em vez de mantidos.
 */
async function replaceDoc<T extends BaseEntity>(name: CollectionName, current: T, patch: Partial<T>): Promise<void> {
  const { id, updatedAt: _previousUpdatedAt, ...rest } = current;
  void _previousUpdatedAt;
  await create<T>(name, { ...rest, ...patch } as CreateInput<T>, id);
}

// ---------------------------------------------------------------------------
// Duplicidade
// ---------------------------------------------------------------------------

export interface DuplicateMatch {
  id: string;
  tradeName: string;
  legalName: string;
  status: Client["status"];
  document?: string;
  phone?: string;
  email?: string;
  /** Motivos em português (ex.: "mesmo CNPJ"). */
  reasons: string[];
}

/** Procura clientes com o mesmo CNPJ/CPF, telefone, WhatsApp ou e-mail. */
export async function findDuplicates(input: unknown): Promise<ActionResult<{ matches: DuplicateMatch[] }>> {
  try {
    await requireUser();
    const data = findDuplicatesSchema.parse(input);
    if (!data.document && !data.phone && !data.whatsapp && !data.email) return { ok: true, data: { matches: [] } };
    const clients = await list<Client>(COLLECTIONS.clients);
    const digits = (v?: string) => (v ?? "").replace(/\D/g, "");
    const phones = [data.phone, data.whatsapp].filter((p): p is string => Boolean(p));
    const matches: DuplicateMatch[] = [];
    for (const c of clients) {
      if (c.id === data.excludeId) continue;
      const reasons: string[] = [];
      if (data.document && digits(c.document) === data.document) reasons.push("mesmo CNPJ/CPF");
      const clientPhones = [digits(c.phone), digits(c.whatsapp)].filter(Boolean);
      if (phones.some((p) => clientPhones.includes(p))) reasons.push("mesmo telefone/WhatsApp");
      if (data.email && c.email?.toLowerCase() === data.email) reasons.push("mesmo e-mail");
      if (reasons.length > 0) {
        matches.push({ id: c.id, tradeName: c.tradeName, legalName: c.legalName, status: c.status, document: c.document, phone: c.phone ?? c.whatsapp, email: c.email, reasons });
      }
    }
    return { ok: true, data: { matches } };
  } catch (error) {
    return fail(error, "Não foi possível verificar duplicidade");
  }
}

// ---------------------------------------------------------------------------
// Cadastro e edição
// ---------------------------------------------------------------------------

export async function createClient(input: unknown): Promise<ActionResult<{ id: string }>> {
  try {
    const user = await requireUser();
    const data = createClientSchema.parse(input);
    const client = await create<Client>(COLLECTIONS.clients, {
      legalName: data.legalName,
      tradeName: data.tradeName,
      document: data.document,
      segment: data.segment,
      status: data.status,
      origin: data.origin,
      campaignId: data.campaignId,
      phone: data.phone,
      whatsapp: data.whatsapp,
      email: data.email,
      website: data.website,
      address: data.address,
      ownerSalesId: data.ownerSalesId ?? (user.departmentId === "vendas" ? user.id : undefined),
      ownerCsId: data.ownerCsId,
      mrr: 0,
      tags: data.tags,
      notes: data.notes,
      currentStage: data.status === "lead" ? "marketing" : "vendas",
      createdBy: user.id,
    });

    await emitEvent({
      type: "client.created",
      actor: actor(user),
      clientId: client.id,
      entity: { type: "client", id: client.id },
      title: `Cliente ${client.tradeName} cadastrado`,
      description: `Status inicial: ${CLIENT_STATUS_LABELS[client.status]}${client.origin ? ` · origem: ${client.origin}` : ""}`,
      department: user.departmentId,
      payload: { status: client.status, origin: client.origin, segment: client.segment },
    });

    // Jornada do cliente (template "jornada-cliente"). O serviço grava workflowInstanceId/currentStage
    // no cliente. Falha aqui não impede o cadastro.
    try {
      await createWorkflowInstanceForClient({ clientId: client.id, clientName: client.tradeName, actor: { ...actor(user), role: user.role } });
    } catch (error) {
      console.error("[clients] falha ao iniciar a jornada do cliente", error);
    }

    revalidateClient(client.id);
    return { ok: true, data: { id: client.id } };
  } catch (error) {
    return fail(error, "Não foi possível cadastrar o cliente");
  }
}

const TRACKED_FIELDS: { key: keyof Client; label: string }[] = [
  { key: "legalName", label: "razão social" },
  { key: "tradeName", label: "nome fantasia" },
  { key: "document", label: "CNPJ/CPF" },
  { key: "segment", label: "segmento" },
  { key: "origin", label: "origem" },
  { key: "phone", label: "telefone" },
  { key: "whatsapp", label: "WhatsApp" },
  { key: "email", label: "e-mail" },
  { key: "website", label: "site" },
  { key: "ownerSalesId", label: "responsável comercial" },
  { key: "ownerCsId", label: "responsável de CS" },
  { key: "notes", label: "observações" },
];

export async function updateClient(input: unknown): Promise<ActionResult<{ id: string }>> {
  try {
    const user = await requireUser();
    const data = updateClientSchema.parse(input);
    const current = await loadClient(data.id);
    const patch: Partial<Client> = {
      legalName: data.legalName,
      tradeName: data.tradeName,
      document: data.document,
      segment: data.segment,
      origin: data.origin,
      campaignId: data.campaignId,
      phone: data.phone,
      whatsapp: data.whatsapp,
      email: data.email,
      website: data.website,
      address: data.address,
      ownerSalesId: data.ownerSalesId,
      ownerCsId: data.ownerCsId,
      tags: data.tags,
      notes: data.notes,
    };
    const changed = TRACKED_FIELDS.filter(({ key }) => (current[key] ?? "") !== (patch[key] ?? "")).map((f) => f.label);
    const addressChanged = JSON.stringify(current.address ?? {}) !== JSON.stringify(data.address ?? {});
    if (addressChanged) changed.push("endereço");
    const tagsChanged = JSON.stringify([...(current.tags ?? [])].sort()) !== JSON.stringify([...data.tags].sort());
    if (tagsChanged) changed.push("tags");

    await replaceDoc<Client>(COLLECTIONS.clients, current, patch);

    await emitEvent({
      type: "client.updated",
      actor: actor(user),
      clientId: data.id,
      entity: { type: "client", id: data.id },
      title: "Cadastro do cliente atualizado",
      description: changed.length > 0 ? `Campos alterados: ${changed.join(", ")}` : "Sem alterações relevantes",
      department: user.departmentId,
      payload: { changed },
    });

    revalidateClient(data.id);
    return { ok: true, data: { id: data.id } };
  } catch (error) {
    return fail(error, "Não foi possível salvar o cliente");
  }
}

export async function changeClientStatus(input: unknown): Promise<ActionResult<{ status: Client["status"] }>> {
  try {
    const user = await requireUser();
    const data = changeStatusSchema.parse(input);
    const client = await loadClient(data.clientId);
    if (client.status === data.status) return { ok: false, error: `O cliente já está com status ${CLIENT_STATUS_LABELS[data.status]}` };
    const now = nowIso();
    const patch: Partial<Client> = { status: data.status };
    if (data.status === "ativo" && !client.activatedAt) patch.activatedAt = now;
    await update<Client>(COLLECTIONS.clients, client.id, patch);

    await emitEvent({
      type: "client.status_changed",
      actor: actor(user),
      clientId: client.id,
      entity: { type: "client", id: client.id },
      title: `Status alterado de ${CLIENT_STATUS_LABELS[client.status]} para ${CLIENT_STATUS_LABELS[data.status]}`,
      description: `Motivo: ${data.reason}`,
      department: user.departmentId,
      payload: { from: client.status, to: data.status, reason: data.reason },
    });

    revalidateClient(client.id);
    return { ok: true, data: { status: data.status } };
  } catch (error) {
    return fail(error, "Não foi possível alterar o status");
  }
}

// ---------------------------------------------------------------------------
// Contatos
// ---------------------------------------------------------------------------

async function clearPrimaryContact(clientId: string, exceptId?: string) {
  const contacts = await list<Contact>(COLLECTIONS.contacts, { where: [["clientId", "==", clientId]] });
  await Promise.all(contacts.filter((c) => c.isPrimary && c.id !== exceptId).map((c) => update<Contact>(COLLECTIONS.contacts, c.id, { isPrimary: false })));
}

export async function addContact(input: unknown): Promise<ActionResult<{ id: string }>> {
  try {
    const user = await requireUser();
    const data = contactSchema.parse(input);
    const client = await loadClient(data.clientId);
    if (data.isPrimary) await clearPrimaryContact(client.id);
    const contact = await create<Contact>(COLLECTIONS.contacts, {
      clientId: client.id,
      name: data.name,
      role: data.role,
      phone: data.phone,
      whatsapp: data.whatsapp,
      email: data.email,
      isPrimary: data.isPrimary,
      isDecisionMaker: data.isDecisionMaker,
      createdBy: user.id,
    });
    await emitEvent({
      type: "contact.created",
      actor: actor(user),
      clientId: client.id,
      entity: { type: "contact", id: contact.id },
      title: `Contato adicionado: ${contact.name}${contact.role ? ` (${contact.role})` : ""}`,
      description: [contact.phone ? formatPhone(contact.phone) : null, contact.email].filter(Boolean).join(" · ") || undefined,
      department: user.departmentId,
      payload: { isPrimary: contact.isPrimary, isDecisionMaker: contact.isDecisionMaker },
    });
    revalidateClient(client.id);
    return { ok: true, data: { id: contact.id } };
  } catch (error) {
    return fail(error, "Não foi possível adicionar o contato");
  }
}

export async function updateContact(input: unknown): Promise<ActionResult<{ id: string }>> {
  try {
    const user = await requireUser();
    const data = updateContactSchema.parse(input);
    const contact = await getById<Contact>(COLLECTIONS.contacts, data.id);
    if (!contact || contact.clientId !== data.clientId) return { ok: false, error: "Contato não encontrado" };
    if (data.isPrimary) await clearPrimaryContact(data.clientId, data.id);
    await replaceDoc<Contact>(COLLECTIONS.contacts, contact, {
      name: data.name,
      role: data.role,
      phone: data.phone,
      whatsapp: data.whatsapp,
      email: data.email,
      isPrimary: data.isPrimary,
      isDecisionMaker: data.isDecisionMaker,
    });
    await emitEvent({
      type: "client.updated",
      actor: actor(user),
      clientId: data.clientId,
      entity: { type: "contact", id: data.id },
      title: `Contato atualizado: ${data.name}`,
      department: user.departmentId,
      payload: { contactId: data.id },
    });
    revalidateClient(data.clientId);
    return { ok: true, data: { id: data.id } };
  } catch (error) {
    return fail(error, "Não foi possível salvar o contato");
  }
}

export async function removeContact(input: unknown): Promise<ActionResult<{ id: string }>> {
  try {
    const user = await requireUser();
    const data = removeContactSchema.parse(input);
    const contact = await getById<Contact>(COLLECTIONS.contacts, data.id);
    if (!contact || contact.clientId !== data.clientId) return { ok: false, error: "Contato não encontrado" };
    await remove(COLLECTIONS.contacts, data.id);
    await emitEvent({
      type: "client.updated",
      actor: actor(user),
      clientId: data.clientId,
      entity: { type: "contact", id: data.id },
      title: `Contato removido: ${contact.name}`,
      department: user.departmentId,
      payload: { contactId: data.id, removed: true },
    });
    revalidateClient(data.clientId);
    return { ok: true, data: { id: data.id } };
  } catch (error) {
    return fail(error, "Não foi possível remover o contato");
  }
}

// ---------------------------------------------------------------------------
// Notas, documentos e contatos registrados manualmente
// ---------------------------------------------------------------------------

export async function addNote(input: unknown): Promise<ActionResult<{ eventId: string }>> {
  try {
    const user = await requireUser();
    const data = noteSchema.parse(input);
    const client = await loadClient(data.clientId);
    const event = await emitEvent({
      type: "note.added",
      actor: actor(user),
      clientId: client.id,
      entity: { type: "client", id: client.id },
      title: `Nota registrada por ${user.name.split(" ")[0]}`,
      description: data.body,
      department: user.departmentId,
    });
    revalidateClient(client.id);
    return { ok: true, data: { eventId: event.id } };
  } catch (error) {
    return fail(error, "Não foi possível registrar a nota");
  }
}

export async function addDocument(input: unknown): Promise<ActionResult<{ id: string }>> {
  try {
    const user = await requireUser();
    const data = documentSchema.parse(input);
    const client = await loadClient(data.clientId);
    // Versão: incrementa quando já existe documento com o mesmo nome para o cliente.
    const existing = await list<Document>(COLLECTIONS.documents, { where: [["clientId", "==", client.id]] });
    const sameName = existing.filter((d) => d.name.trim().toLowerCase() === data.name.toLowerCase());
    const version = sameName.reduce((max, d) => Math.max(max, d.version), 0) + 1;
    const doc = await create<Document>(COLLECTIONS.documents, {
      clientId: client.id,
      entityType: data.entityType ?? "client",
      entityId: data.entityId ?? client.id,
      name: data.name,
      url: data.url,
      version,
      uploadedBy: user.id,
      category: data.category,
      createdBy: user.id,
    });
    await emitEvent({
      type: "document.added",
      actor: actor(user),
      clientId: client.id,
      entity: { type: "document", id: doc.id },
      title: `Documento registrado: ${doc.name}${version > 1 ? ` (v${version})` : ""}`,
      description: doc.category ? `Categoria: ${doc.category}` : undefined,
      department: user.departmentId,
      payload: { url: doc.url, category: doc.category, version },
    });
    revalidateClient(client.id);
    return { ok: true, data: { id: doc.id } };
  } catch (error) {
    return fail(error, "Não foi possível registrar o documento");
  }
}

/** Ligação ou mensagem de WhatsApp registrada manualmente (integração real fica para depois). */
export async function registerContactEvent(input: unknown): Promise<ActionResult<{ eventId: string }>> {
  try {
    const user = await requireUser();
    const data = contactEventSchema.parse(input);
    const client = await loadClient(data.clientId);
    const contact = data.contactId ? await getById<Contact>(COLLECTIONS.contacts, data.contactId) : null;
    const who = contact?.name ?? client.tradeName;
    const isCall = data.channel === "ligacao";
    const outcomeLabel = data.outcome === "nao_atendeu" ? "não atendeu" : data.outcome === "mensagem_enviada" ? "mensagem enviada" : "atendeu";

    await create<Communication>(COLLECTIONS.communications, {
      clientId: client.id,
      contactId: contact?.id,
      channel: isCall ? "voip" : "whatsapp",
      direction: "saida",
      userId: user.id,
      entityType: "client",
      entityId: client.id,
      body: data.notes,
      // Registro manual: a ligação/mensagem aconteceu no discador ou no app do usuário.
      status: "manual",
      durationSeconds: data.durationMinutes !== undefined ? data.durationMinutes * 60 : undefined,
      provider: "manual",
      createdBy: user.id,
    });

    const event = await emitEvent({
      type: isCall ? "call.completed" : "whatsapp.message.sent",
      actor: actor(user),
      clientId: client.id,
      entity: contact ? { type: "contact", id: contact.id } : { type: "client", id: client.id },
      title: isCall ? `Ligação para ${who} (${outcomeLabel})` : `WhatsApp enviado para ${who}`,
      description: [data.phone ? formatPhone(data.phone) : null, data.durationMinutes ? `${data.durationMinutes} min` : null, data.notes].filter(Boolean).join(" · ") || undefined,
      department: user.departmentId,
      payload: { channel: data.channel, outcome: data.outcome, phone: data.phone, contactId: contact?.id, durationMinutes: data.durationMinutes, simulated: true },
    });
    revalidateClient(client.id);
    return { ok: true, data: { eventId: event.id } };
  } catch (error) {
    return fail(error, "Não foi possível registrar o contato");
  }
}

// ---------------------------------------------------------------------------
// Oportunidade de upsell / cross-sell
// ---------------------------------------------------------------------------

export async function createUpsellOpportunity(input: unknown): Promise<ActionResult<{ id: string }>> {
  try {
    const user = await requireUser();
    const data = upsellSchema.parse(input);
    const client = await loadClient(data.clientId);
    const product = await getById<Product>(COLLECTIONS.products, data.productId);
    if (!product || product.active === false) return { ok: false, error: "Produto não encontrado no catálogo" };
    const owned = await list<ClientProduct>(COLLECTIONS.clientProducts, { where: [["clientId", "==", client.id]] });
    if (owned.some((p) => p.productId === product.id && p.status !== "cancelado")) return { ok: false, error: `O cliente já tem ${product.name} contratado` };

    const line = {
      productId: product.id,
      productName: product.name,
      quantity: data.quantity,
      setupValue: product.setupPrice * data.quantity,
      monthlyValue: product.monthlyPrice * data.quantity,
      hardwareValue: product.hardwarePrice * data.quantity,
    };
    const now = nowIso();
    const opportunity = await create<Opportunity>(COLLECTIONS.opportunities, {
      clientId: client.id,
      title: `${data.kind === "upsell" ? "Upsell" : "Cross-sell"} ${product.name} — ${client.tradeName}`,
      stage: "qualificacao",
      stageChangedAt: now,
      ownerId: client.ownerSalesId ?? user.id,
      temperature: "morno",
      probability: 10,
      products: [line],
      setupTotal: line.setupValue,
      monthlyTotal: line.monthlyValue,
      hardwareTotal: line.hardwareValue,
      need: data.need,
      diagnosis: data.notes,
      nextAction: "Qualificar a oportunidade com o cliente",
      nextActionAt: new Date(Date.now() + 48 * 3600_000).toISOString(),
      lastActivityAt: now,
      originDepartment: user.departmentId,
      originUserId: user.id,
      kind: data.kind,
      createdBy: user.id,
    });

    await emitEvent({
      type: "upsell.created",
      actor: actor(user),
      clientId: client.id,
      entity: { type: "opportunity", id: opportunity.id },
      title: `Oportunidade de ${data.kind === "upsell" ? "upsell" : "cross-sell"} criada: ${product.name}`,
      description: `${data.need}${line.monthlyValue > 0 ? ` · ${formatCurrency(line.monthlyValue)}/mês` : ""}${line.setupValue > 0 ? ` · adesão ${formatCurrency(line.setupValue)}` : ""}`,
      department: user.departmentId,
      payload: { productId: product.id, kind: data.kind, monthlyTotal: line.monthlyValue, setupTotal: line.setupValue, ownerId: opportunity.ownerId },
    });

    revalidateClient(client.id);
    revalidatePath("/vendas/oportunidades");
    return { ok: true, data: { id: opportunity.id } };
  } catch (error) {
    return fail(error, "Não foi possível criar a oportunidade");
  }
}
