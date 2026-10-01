import "server-only";
/**
 * Registro de comunicações (WhatsApp, ligação, e-mail) com o status honesto de cada envio:
 * - "manual": o contato foi feito fora do sistema (wa.me, tel:, mailto:) e registrado pelo usuário;
 * - "enviada"/"falha": o INTEROS chamou o provedor real;
 * - "nao_enviada": nada saiu e ninguém enviou (opt-out do cliente ou canal não conectado em uma automação).
 *
 * `sendOrRecord` é o helper ÚNICO de "envia pelo provedor ou registra manualmente": Financeiro (cobrança e
 * régua), Central de Vendas, Caixa de Entrada do Marketing e Suporte passam por aqui. Ele respeita o opt-out
 * do cliente (`Client.communicationOptOut`) e aceita um id determinístico para idempotência (régua).
 */
import { create, createIfAbsent, getById, list, nowIso, update } from "@/server/db";
import { COLLECTIONS, type Client, type Communication, type UserRef } from "@/domain/types";
import { mailtoHref, whatsappHref } from "@/components/clients/contact-links";
import { sendEmail, sendWhatsappText } from "./providers";
import { isConnected } from "./status";

export type CommunicationInput = Omit<Communication, "id" | "organizationId" | "createdAt" | "updatedAt" | "status" | "provider"> & {
  status: Communication["status"];
  provider: Communication["provider"];
};

export async function recordCommunication(input: CommunicationInput): Promise<Communication> {
  return create<Communication>(COLLECTIONS.communications, input as unknown as Omit<Communication, "id" | "organizationId" | "createdAt" | "updatedAt">);
}

/** Status/provider de uma comunicação feita fora do sistema. */
export const MANUAL = { status: "manual", provider: "manual" } as const satisfies { status: Communication["status"]; provider: Communication["provider"] };

/** Rótulo de exibição do status (inclui os valores estendidos). */
export function communicationStatusLabel(status: string | undefined): string {
  switch (status) {
    case "manual":
      return "Registro manual";
    case "simulada":
      return "Registro manual (legado)";
    case "enviada":
      return "Enviada";
    case "entregue":
      return "Entregue";
    case "lida":
      return "Lida";
    case "falha":
      return "Falha no envio";
    case "recebida":
      return "Recebida";
    case "nao_enviada":
      return "Não enviada";
    default:
      return status ?? "—";
  }
}

// ---------------------------------------------------------------------------
// sendOrRecord: envia pelo provedor quando o canal está conectado; senão registra
// ---------------------------------------------------------------------------

export type SendChannel = "whatsapp" | "email";
export type SendDelivery = "enviada" | "falha" | "manual" | "nao_enviada";

export interface SendOrRecordInput {
  channel: SendChannel;
  /** Telefone (WhatsApp) ou e-mail do destinatário. */
  to?: string;
  /** Assunto do e-mail (padrão "Intercert"). */
  subject?: string;
  text: string;
  clientId?: string;
  contactId?: string;
  templateKey?: string;
  entity?: { type: string; id: string };
  actor: UserRef;
  /** Id determinístico da comunicação: se já existir, nada é enviado nem regravado (idempotência da régua). */
  id?: string;
  /**
   * Canal não conectado (ou destinatário ausente): "manual" (padrão — o usuário envia pelo wa.me/mailto e o
   * registro fica manual) ou "nao_enviada" (automação: fica registrado que nada saiu, para o Financeiro tratar).
   */
  whenNotConnected?: "manual" | "nao_enviada";
  /** Respeitar `Client.communicationOptOut` (padrão true). */
  respectOptOut?: boolean;
  /** Campos extras da comunicação (ex.: durationSeconds). */
  extra?: Partial<Pick<Communication, "durationSeconds" | "recordingUrl">>;
}

export interface SendOrRecordResult {
  communication: Communication;
  /** false quando o `id` já existia (nada foi enviado nem gravado). */
  created: boolean;
  delivery: SendDelivery;
  provider: "meta" | "resend" | "manual";
  externalId?: string;
  error?: string;
  /** Link para o usuário enviar pelo próprio aparelho (wa.me com texto / mailto), quando faz sentido. */
  manualUrl: string | null;
  /** O canal está conectado no servidor. */
  connected: boolean;
  optedOut: boolean;
}

const CHANNEL_LABEL: Record<SendChannel, string> = { whatsapp: "WhatsApp", email: "e-mail" };

/** URL de envio manual: wa.me com o texto pronto ou mailto com assunto e corpo. */
export function manualSendUrl(channel: SendChannel, to: string | undefined, subject: string, text: string): string | null {
  if (!to) return null;
  if (channel === "whatsapp") {
    const base = whatsappHref(to);
    return base ? `${base}?text=${encodeURIComponent(text)}` : null;
  }
  return mailtoHref([to], subject, text);
}

export async function sendOrRecord(input: SendOrRecordInput): Promise<SendOrRecordResult> {
  const channel = input.channel;
  const subject = input.subject?.trim() || "Intercert";
  const connected = isConnected(channel === "whatsapp" ? "whatsapp" : "email");
  const client = input.respectOptOut !== false && input.clientId ? await getById<Client>(COLLECTIONS.clients, input.clientId) : null;
  const optedOut = Boolean(client?.communicationOptOut?.[channel]);
  const manualUrl = optedOut ? null : manualSendUrl(channel, input.to, subject, input.text);

  const base: Omit<CommunicationInput, "status" | "provider"> = {
    clientId: input.clientId,
    contactId: input.contactId,
    channel,
    direction: "saida",
    userId: input.actor.id,
    entityType: input.entity?.type,
    entityId: input.entity?.id,
    body: input.text,
    templateKey: input.templateKey,
    createdBy: input.actor.id,
    ...(input.extra ?? {}),
  };

  // Idempotência: reserva o id antes de enviar (duas execuções concorrentes: só uma envia).
  let placeholder: Communication | null = null;
  if (input.id) {
    const claim = await createIfAbsent<Communication>(COLLECTIONS.communications, input.id, { ...base, status: "nao_enviada", provider: "manual", error: "Em processamento" } as CommunicationInput);
    if (!claim.created) {
      const existing = claim.doc;
      return { communication: existing, created: false, delivery: deliveryOf(existing), provider: (existing.provider as SendOrRecordResult["provider"]) ?? "manual", externalId: existing.externalId, error: existing.error, manualUrl, connected, optedOut };
    }
    placeholder = claim.doc;
  }

  let outcome: { status: Communication["status"]; provider: SendOrRecordResult["provider"]; externalId?: string; error?: string; delivery: SendDelivery };
  if (optedOut) {
    outcome = { status: "nao_enviada", provider: "manual", error: `Cliente optou por não receber ${CHANNEL_LABEL[channel]}`, delivery: "nao_enviada" };
  } else if (connected && input.to) {
    const r = channel === "whatsapp" ? await sendWhatsappText(input.to, input.text) : await sendEmail({ to: input.to, subject, text: input.text });
    outcome = r.ok ? { status: "enviada", provider: channel === "whatsapp" ? "meta" : "resend", externalId: r.externalId, delivery: "enviada" } : { status: "falha", provider: channel === "whatsapp" ? "meta" : "resend", error: r.error, delivery: "falha" };
  } else if (input.whenNotConnected === "nao_enviada") {
    outcome = { status: "nao_enviada", provider: "manual", error: !input.to ? `Destinatário sem ${channel === "whatsapp" ? "telefone" : "e-mail"} cadastrado` : `${CHANNEL_LABEL[channel]} não conectado`, delivery: "nao_enviada" };
  } else {
    outcome = { ...MANUAL, delivery: "manual" };
  }

  const data: Partial<Communication> = { status: outcome.status, provider: outcome.provider, externalId: outcome.externalId, error: outcome.error };
  let communication: Communication;
  if (placeholder) {
    await update<Communication>(COLLECTIONS.communications, placeholder.id, { ...data, error: outcome.error ?? undefined });
    if (!outcome.error) await clearCommunicationError(placeholder.id);
    communication = { ...placeholder, ...data, error: outcome.error };
  } else {
    communication = await recordCommunication({ ...base, ...data } as CommunicationInput);
  }
  return { communication, created: true, delivery: outcome.delivery, provider: outcome.provider, externalId: outcome.externalId, error: outcome.error, manualUrl, connected, optedOut };
}

async function clearCommunicationError(id: string): Promise<void> {
  const { FieldValue } = await import("firebase-admin/firestore");
  const { col } = await import("@/server/db");
  await col(COLLECTIONS.communications).doc(id).update({ error: FieldValue.delete() });
}

function deliveryOf(c: Communication): SendDelivery {
  if (c.status === "enviada" || c.status === "entregue" || c.status === "lida") return "enviada";
  if (c.status === "falha") return "falha";
  if (c.status === "nao_enviada") return "nao_enviada";
  return "manual";
}

// ---------------------------------------------------------------------------
// Status de entrega vindos do webhook da Meta (statuses[])
// ---------------------------------------------------------------------------

export interface WhatsappStatusUpdate {
  /** Id da mensagem na Meta (o mesmo gravado em Communication.externalId). */
  id: string;
  status: string;
  timestamp?: string;
  errors?: { code?: number; title?: string; message?: string }[];
}

const META_STATUS: Record<string, Communication["status"]> = { sent: "enviada", delivered: "entregue", read: "lida", failed: "falha" };
const STATUS_RANK: Partial<Record<Communication["status"], number>> = { enviada: 1, entregue: 2, lida: 3, falha: 4 };

/**
 * Atualiza `communications.status` pelo id da mensagem no provedor (sent → enviada, delivered → entregue,
 * read → lida, failed → falha). Idempotente: um status mais antigo nunca sobrescreve um mais novo.
 */
export async function applyWhatsappStatuses(updates: WhatsappStatusUpdate[]): Promise<{ matched: number; updated: number; ignored: number }> {
  let matched = 0;
  let updated = 0;
  let ignored = 0;
  for (const u of updates) {
    const next = META_STATUS[u.status];
    if (!u.id || !next) {
      ignored += 1;
      continue;
    }
    const docs = await list<Communication>(COLLECTIONS.communications, { where: [["externalId", "==", u.id]] });
    if (docs.length === 0) {
      ignored += 1;
      continue;
    }
    matched += docs.length;
    const at = u.timestamp && /^\d+$/.test(u.timestamp) ? new Date(Number(u.timestamp) * 1000).toISOString() : nowIso();
    for (const c of docs) {
      if ((STATUS_RANK[c.status] ?? 0) >= (STATUS_RANK[next] ?? 0) && c.status !== "falha") continue;
      const error = next === "falha" ? (u.errors?.map((e) => e.message ?? e.title ?? String(e.code ?? "")).filter(Boolean).join("; ") || "Falha reportada pela Meta") : undefined;
      await update<Communication>(COLLECTIONS.communications, c.id, { status: next, statusUpdatedAt: at, error });
      updated += 1;
    }
  }
  return { matched, updated, ignored };
}
