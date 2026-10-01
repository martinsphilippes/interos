import "server-only";
/**
 * Portal do Cliente (D31, etapa 6B): links de acesso somente leitura, sem login, aos contratos e cobranças de UM
 * cliente.
 *
 * - Token: 32 bytes aleatórios em base64url, devolvido UMA vez por `createPortalLink`; o documento em `portal_links`
 *   tem id = sha256(token) e nunca guarda o token (nem em claro, nem cifrado). Textos gravados (comunicação, evento,
 *   tarefa) levam o link MASCARADO (`redactPortalUrl`).
 * - Links "manual" (tela, 90 dias por padrão) e "mensagem" (gerado no envio de uma mensagem com `{linkPortal}`, 30
 *   dias, um link NOVO por envio): todos listados por cliente com a origem e revogáveis.
 * - Página pública: `loadPortalForToken` valida formato → hash → link ativo, conta o acesso em transação
 *   (`lastAccessAt`, `accessCount` e o dia do último evento) e emite `portal.accessed` no máximo 1×/dia por link.
 *   Inexistente, revogado e expirado têm a MESMA resposta (null → "Link inválido ou expirado").
 * - Eventos: `portal.link_created`, `portal.link_revoked` (com `changes` e motivo — entram na auditoria) e
 *   `portal.accessed`.
 */
import { firestore } from "@/server/firebase-admin";
import { col, createIfAbsent, getById, getManyByIds, list, nowIso, ORG_ID, txGetOwn, update } from "@/server/db";
import { emitEvent } from "@/server/events";
import { BusinessError } from "@/server/auth/error-classes";
import { isConnected } from "@/server/integrations/status";
import { sendOrRecord, type SendChannel, type SendDelivery } from "@/server/integrations/communications";
import { whatsappHref } from "@/components/clients/contact-links";
import { dateKey, formatDate } from "@/lib/format";
import {
  clampPortalDays,
  isPortalLinkId,
  isPortalLinkUsable,
  PORTAL_DEFAULT_DAYS,
  PORTAL_MESSAGE_DAYS,
  PORTAL_ORIGIN_LABELS,
  portalExpiresAt,
  portalLinkState,
  portalPath,
  redactPortalUrl,
  shouldEmitPortalAccess,
  type PortalLinkState,
} from "@/domain/portal";
import { COLLECTIONS, type Billing, type Client, type Contact, type Contract, type ContractAmendment, type DomainEvent, type Opportunity, type Organization, type PortalLink, type User, type UserRef } from "@/domain/types";
import { generatePortalToken, hashPortalToken, portalLinkIdFor } from "./token";
import { buildPortalContent, isContractVisibleInPortal, type PortalContent } from "./content";

/** Quem "age" no acesso público (não é usuário do sistema). */
export const PORTAL_VISITOR: UserRef = { id: "cliente", name: "Cliente (portal)" };
const SYSTEM: UserRef = { id: "system", name: "INTEROS (automação)" };

// ---------------------------------------------------------------------------
// URL pública
// ---------------------------------------------------------------------------

/**
 * Endereço base do sistema para montar o link absoluto: NEXT_PUBLIC_APP_URL (configure em produção) → domínio de
 * produção da Vercel → cabeçalhos da requisição atual (ação, página, cron) → null (fora de requisição e sem env:
 * nenhum link é gerado, porque um caminho relativo não serve numa mensagem).
 */
export async function resolvePortalBaseUrl(): Promise<string | null> {
  const env = process.env.NEXT_PUBLIC_APP_URL?.trim() || (process.env.VERCEL_PROJECT_PRODUCTION_URL ? `https://${process.env.VERCEL_PROJECT_PRODUCTION_URL}` : "");
  if (env) return env.replace(/\/$/, "");
  try {
    const { headers } = await import("next/headers");
    const h = await headers();
    const host = h.get("x-forwarded-host") ?? h.get("host");
    if (!host) return null;
    const proto = h.get("x-forwarded-proto") ?? (/^(localhost|127\.0\.0\.1)(:\d+)?$/.test(host) ? "http" : "https");
    return `${proto}://${host}`;
  } catch {
    return null;
  }
}

export function portalUrl(base: string, token: string): string {
  return `${base.replace(/\/$/, "")}${portalPath(token)}`;
}

export { redactPortalUrl } from "@/domain/portal";

// ---------------------------------------------------------------------------
// Criar, revogar, listar
// ---------------------------------------------------------------------------

export interface CreatePortalLinkInput {
  clientId: string;
  contractId?: string | null;
  /** Validade em dias (padrão 90 na tela, 30 nas mensagens). */
  days?: number;
  label?: string;
  origin?: PortalLink["origin"];
  communicationId?: string;
}

export interface CreatedPortalLink {
  link: PortalLink;
  /** Mostrado UMA vez: não é gravado em lugar nenhum. */
  token: string;
}

/** Cria um link do portal para o cliente. Devolve o token (só aqui) e o documento gravado (id = hash). */
export async function createPortalLink(input: CreatePortalLinkInput, actor: UserRef, options: { emit?: boolean; now?: Date } = {}): Promise<CreatedPortalLink> {
  const client = await getById<Client>(COLLECTIONS.clients, input.clientId);
  if (!client) throw new BusinessError("Cliente não encontrado");
  const contract = input.contractId ? await getById<Contract>(COLLECTIONS.contracts, input.contractId) : null;
  if (input.contractId && (!contract || contract.clientId !== client.id)) throw new BusinessError("Contrato não pertence a este cliente");
  const origin = input.origin ?? "manual";
  const days = clampPortalDays(input.days, origin === "mensagem" ? PORTAL_MESSAGE_DAYS : PORTAL_DEFAULT_DAYS);
  const now = options.now ?? new Date();
  const token = generatePortalToken();
  const id = hashPortalToken(token);
  const at = now.toISOString();
  const data: Omit<PortalLink, "id"> = {
    organizationId: ORG_ID,
    createdAt: at,
    updatedAt: at,
    clientId: client.id,
    contractId: contract?.id ?? null,
    label: input.label?.trim() || undefined,
    origin,
    communicationId: input.communicationId,
    expiresAt: portalExpiresAt(days, now),
    createdBy: actor.id,
    createdByName: actor.name,
    accessCount: 0,
  };
  // Nunca sobrescreve um link (colisão de 256 bits: impossível na prática, mas o create é atômico).
  const created = await createIfAbsent<PortalLink>(COLLECTIONS.portalLinks, id, data);
  if (!created.created) throw new BusinessError("Não foi possível gerar o link. Tente novamente.");
  const link: PortalLink = { ...data, id };
  if (options.emit !== false) {
    await emitEvent({
      type: "portal.link_created",
      actor,
      clientId: client.id,
      entity: { type: "portal_link", id },
      title: `Link do portal do cliente gerado (${PORTAL_ORIGIN_LABELS[origin].toLowerCase()}) · válido até ${formatDate(link.expiresAt)}`,
      description: link.label,
      department: "financeiro",
      payload: {
        portalLinkId: id,
        contractId: contract?.id ?? null,
        origin,
        days,
        label: link.label ?? null,
        communicationId: input.communicationId ?? null,
        changes: { status: { from: null, to: "ativo" }, expiresAt: { from: null, to: link.expiresAt } },
      },
    });
  }
  return { link, token };
}

/** Revoga um link ativo (motivo opcional). Revogar de novo é erro de negócio (nada muda). */
export async function revokePortalLink(linkId: string, reason: string | undefined, actor: UserRef, options: { emit?: boolean } = {}): Promise<PortalLink> {
  if (!isPortalLinkId(linkId)) throw new BusinessError("Link do portal não encontrado");
  const ref = col(COLLECTIONS.portalLinks).doc(linkId);
  const at = nowIso();
  const why = reason?.trim() || undefined;
  const before = await firestore.runTransaction(async (tx) => {
    const snap = await txGetOwn(tx, ref);
    if (!snap) throw new BusinessError("Link do portal não encontrado");
    const link = { ...(snap.data() as Omit<PortalLink, "id">), id: linkId } as PortalLink;
    if (link.revokedAt) throw new BusinessError("Este link já foi revogado");
    tx.update(ref, { revokedAt: at, revokedBy: actor.id, ...(why ? { revokeReason: why } : {}), updatedAt: at });
    return link;
  });
  const after: PortalLink = { ...before, revokedAt: at, revokedBy: actor.id, revokeReason: why, updatedAt: at };
  if (options.emit !== false) {
    const previous = portalLinkState(before);
    await emitEvent({
      type: "portal.link_revoked",
      actor,
      clientId: before.clientId,
      entity: { type: "portal_link", id: linkId },
      title: `Link do portal do cliente revogado${before.label ? ` (${before.label})` : ""}`,
      description: why,
      department: "financeiro",
      payload: { portalLinkId: linkId, contractId: before.contractId ?? null, origin: before.origin, changes: { status: { from: previous, to: "revogado" } }, ...(why ? { reason: why } : {}) },
    });
  }
  return after;
}

export interface PortalLinkRow {
  id: string;
  label?: string;
  origin: PortalLink["origin"];
  originLabel: string;
  state: PortalLinkState;
  contractNumber?: string;
  createdAt: string;
  createdByName: string;
  expiresAt: string;
  lastAccessAt?: string;
  accessCount: number;
}

export interface PortalLinksOverview {
  active: PortalLinkRow[];
  /** Revogados/expirados (não aparecem na lista; só a contagem). */
  inactiveCount: number;
}

/** Links do cliente: ativos (mais recentes primeiro) e a contagem dos inativos. */
export async function listPortalLinks(clientId: string, now: Date = new Date()): Promise<PortalLinksOverview> {
  const links = await list<PortalLink>(COLLECTIONS.portalLinks, { where: [["clientId", "==", clientId]] });
  const contracts = await getManyByIds<Contract>(COLLECTIONS.contracts, links.map((l) => l.contractId ?? ""));
  const users = await getManyByIds<User>(COLLECTIONS.users, links.map((l) => l.createdBy));
  const rows = links
    .map<PortalLinkRow>((l) => ({
      id: l.id,
      label: l.label,
      origin: l.origin,
      originLabel: PORTAL_ORIGIN_LABELS[l.origin] ?? l.origin,
      state: portalLinkState(l, now),
      contractNumber: l.contractId ? contracts.get(l.contractId)?.number : undefined,
      createdAt: l.createdAt,
      createdByName: users.get(l.createdBy)?.name ?? l.createdByName ?? (l.createdBy === "system" ? SYSTEM.name : "—"),
      expiresAt: l.expiresAt,
      lastAccessAt: l.lastAccessAt,
      accessCount: l.accessCount ?? 0,
    }))
    .sort((a, b) => b.createdAt.localeCompare(a.createdAt));
  return { active: rows.filter((r) => r.state === "ativo"), inactiveCount: rows.filter((r) => r.state !== "ativo").length };
}

export async function getPortalLink(linkId: string): Promise<PortalLink | null> {
  return isPortalLinkId(linkId) ? getById<PortalLink>(COLLECTIONS.portalLinks, linkId) : null;
}

/** Associa a comunicação que levou o link (origem "mensagem"). */
export async function attachPortalLinkCommunication(linkId: string, communicationId: string): Promise<void> {
  await update<PortalLink>(COLLECTIONS.portalLinks, linkId, { communicationId });
}

// ---------------------------------------------------------------------------
// Envio do link ao cliente (templateKey "portal_link")
// ---------------------------------------------------------------------------

export interface PortalRecipient {
  contactId?: string;
  contactName: string;
  phone?: string;
  email?: string;
  whatsappConnected: boolean;
  emailConnected: boolean;
  optOut: { whatsapp: boolean; email: boolean };
}

/** Destinatário: contato do contrato → contato principal → primeiro contato → cadastro do cliente (como a cobrança). */
export async function getPortalRecipient(clientId: string, contractId?: string | null): Promise<PortalRecipient> {
  const [client, contacts, contract] = await Promise.all([
    getById<Client>(COLLECTIONS.clients, clientId),
    list<Contact>(COLLECTIONS.contacts, { where: [["clientId", "==", clientId]] }),
    contractId ? getById<Contract>(COLLECTIONS.contracts, contractId) : Promise.resolve(null),
  ]);
  if (!client) throw new BusinessError("Cliente não encontrado");
  const own = contract?.contactId ? contacts.find((c) => c.id === contract.contactId) : undefined;
  const who = own ?? contacts.find((c) => c.isPrimary) ?? contacts[0];
  return {
    contactId: who?.id,
    contactName: who?.name ?? client.tradeName,
    phone: who?.whatsapp ?? who?.phone ?? client.whatsapp ?? client.phone,
    email: who?.email ?? client.email,
    whatsappConnected: isConnected("whatsapp"),
    emailConnected: isConnected("email"),
    optOut: { whatsapp: Boolean(client.communicationOptOut?.whatsapp), email: Boolean(client.communicationOptOut?.email) },
  };
}

/** Texto padrão do envio do link (o mesmo na tela e no servidor). */
export function portalLinkMessage(contactName: string, url: string, expiresAt: string): string {
  const first = contactName.split(" ")[0];
  return [`Olá${first ? `, ${first}` : ""}! Este é o seu acesso ao Portal do Cliente Intercert, com seus contratos, boletos e cobranças:`, url, `O link é pessoal e vale até ${formatDate(expiresAt)}. Qualquer dúvida, é só responder esta mensagem.`].join("\n");
}

export interface PortalSendResult {
  channel: SendChannel;
  delivery: SendDelivery;
  manual: boolean;
  delivered: boolean;
  communicationId: string;
  /** wa.me/mailto com o texto (envio manual) — devolvido à tela, nunca gravado. */
  url: string | null;
  to?: string;
  error?: string;
}

/**
 * Envia o link recém-gerado por WhatsApp (principal) ou e-mail: o token vem da tela (que o recebeu ao gerar) e é
 * conferido contra o id do link. A comunicação e o evento guardam o texto com o link MASCARADO.
 */
export async function sendPortalLink(input: { linkId: string; token: string; channel: SendChannel; text?: string }, actor: UserRef): Promise<{ result: PortalSendResult; contactName: string }> {
  const link = await getPortalLink(input.linkId);
  if (!link || portalLinkIdFor(input.token) !== link.id) throw new BusinessError("Link do portal não encontrado. Gere um novo link.");
  if (!isPortalLinkUsable(link)) throw new BusinessError("Este link foi revogado ou expirou. Gere um novo link.");
  const base = await resolvePortalBaseUrl();
  if (!base) throw new BusinessError("Endereço do sistema não configurado (NEXT_PUBLIC_APP_URL)");
  const url = portalUrl(base, input.token);
  const recipient = await getPortalRecipient(link.clientId, link.contractId);
  const text = input.text?.trim() || portalLinkMessage(recipient.contactName, url, link.expiresAt);
  if (!text.includes(url)) throw new BusinessError("A mensagem precisa conter o link do portal");
  const to = input.channel === "whatsapp" ? recipient.phone : recipient.email;
  const recorded = redactPortalUrl(text, url);
  const sent = await sendOrRecord({
    channel: input.channel,
    to,
    subject: "Portal do Cliente — Intercert",
    text,
    recordText: recorded,
    clientId: link.clientId,
    contactId: recipient.contactId,
    templateKey: "portal_link",
    entity: { type: "portal_link", id: link.id },
    actor,
  });
  const via = input.channel === "whatsapp" ? "WhatsApp" : "e-mail";
  const title =
    sent.delivery === "manual"
      ? `Link do portal enviado manualmente por ${via} para ${recipient.contactName}`
      : sent.delivery === "enviada"
        ? `Link do portal enviado por ${via} para ${recipient.contactName}`
        : sent.delivery === "falha"
          ? `Link do portal por ${via} para ${recipient.contactName}: falha no envio`
          : `Link do portal por ${via} para ${recipient.contactName} não enviado (${sent.optedOut ? "opt-out do cliente" : (sent.error ?? "canal não conectado")})`;
  await emitEvent({
    type: input.channel === "whatsapp" ? "whatsapp.message.sent" : "email.sent",
    actor,
    clientId: link.clientId,
    entity: { type: "portal_link", id: link.id },
    title,
    description: recorded,
    department: "financeiro",
    payload: { portalLinkId: link.id, contractId: link.contractId ?? null, to, channel: input.channel, communicationId: sent.communication.id, manual: sent.delivery === "manual", delivered: sent.delivery === "enviada", delivery: sent.delivery, optedOut: sent.optedOut, templateKey: "portal_link" },
  });
  return {
    contactName: recipient.contactName,
    result: { channel: input.channel, delivery: sent.delivery, manual: sent.delivery === "manual", delivered: sent.delivery === "enviada", communicationId: sent.communication.id, url: sent.manualUrl, to, error: sent.error },
  };
}

// ---------------------------------------------------------------------------
// Link gerado no envio de uma mensagem com {linkPortal}
// ---------------------------------------------------------------------------

/**
 * Link NOVO (origem "mensagem", 30 dias) para uma mensagem que pede `{linkPortal}`. Falha (sem endereço do sistema,
 * erro de banco) → null: a mensagem segue sem o link, como antes, sem quebrar o envio.
 */
export async function createMessagePortalLink(input: { clientId: string; contractId?: string | null; label: string; communicationId?: string }, actor: UserRef): Promise<{ url: string; linkId: string } | null> {
  try {
    const base = await resolvePortalBaseUrl();
    if (!base) return null;
    const { link, token } = await createPortalLink({ clientId: input.clientId, contractId: input.contractId ?? null, origin: "mensagem", days: PORTAL_MESSAGE_DAYS, label: input.label, communicationId: input.communicationId }, actor);
    return { url: portalUrl(base, token), linkId: link.id };
  } catch (error) {
    console.error("[portal] não foi possível gerar o link da mensagem", error);
    return null;
  }
}

// ---------------------------------------------------------------------------
// Página pública
// ---------------------------------------------------------------------------

export interface PortalPageData {
  content: PortalContent;
  companyName: string;
  expiresAt: string;
  /** wa.me da empresa (setting cobranca_canais.whatsappCobranca) — sem número, o botão de 2ª via não aparece. */
  secondCopyWhatsapp: string | null;
}

/**
 * Valida o token e registra o acesso (transação: lastAccessAt, accessCount e o dia do último evento). Devolve o link
 * ativo e se este acesso gera o evento do dia; null para qualquer link inválido (mesma resposta para todos os casos).
 */
async function registerAccess(token: string, now: Date): Promise<{ link: PortalLink; emit: boolean; previousAccessAt?: string } | null> {
  const id = portalLinkIdFor(token);
  if (!id) return null;
  const ref = col(COLLECTIONS.portalLinks).doc(id);
  const at = now.toISOString();
  const day = dateKey(now);
  return firestore.runTransaction(async (tx) => {
    const snap = await txGetOwn(tx, ref);
    if (!snap) return null;
    const link = { ...(snap.data() as Omit<PortalLink, "id">), id } as PortalLink;
    if (!isPortalLinkUsable(link, now)) return null;
    const emit = shouldEmitPortalAccess(link, day);
    // Única escrita do portal: o acesso (sem updatedAt — o link em si não mudou).
    tx.update(ref, { lastAccessAt: at, accessCount: (link.accessCount ?? 0) + 1, ...(emit ? { lastAccessEventDay: day } : {}) });
    return { link: { ...link, lastAccessAt: at, accessCount: (link.accessCount ?? 0) + 1 }, emit, previousAccessAt: link.lastAccessAt };
  });
}

/** Lê (sem gravar) os dados do cliente dono do link e monta o conteúdo do portal. */
async function readPortalContent(link: PortalLink, now: Date): Promise<PortalContent | null> {
  const client = await getById<Client>(COLLECTIONS.clients, link.clientId);
  if (!client) return null;
  const [contracts, billings, amendments] = await Promise.all([
    list<Contract>(COLLECTIONS.contracts, { where: [["clientId", "==", client.id]] }),
    list<Billing>(COLLECTIONS.billing, { where: [["clientId", "==", client.id]] }),
    list<ContractAmendment>(COLLECTIONS.contractAmendments, { where: [["clientId", "==", client.id]] }),
  ]);
  const today = dateKey(now);
  const visible = contracts.filter((c) => isContractVisibleInPortal(c, today));
  const opportunities = await getManyByIds<Opportunity>(COLLECTIONS.opportunities, visible.map((c) => c.opportunityId ?? ""));
  const { mergedBillingData } = await import("@/server/finance/service");
  const billingDataByContract: Record<string, { legalName?: string; document?: string; email?: string; address: NonNullable<Client["address"]> }> = {};
  const sentAtByContract: Record<string, string | undefined> = {};
  await Promise.all(
    visible.map(async (c) => {
      const merged = mergedBillingData(client, c.opportunityId ? (opportunities.get(c.opportunityId) ?? null) : null);
      billingDataByContract[c.id] = { legalName: merged.legalName, document: merged.document, email: merged.email, address: merged.address };
      if (c.signatureEnvelopeId) {
        const events = await list<DomainEvent>(COLLECTIONS.events, { where: [["entityId", "==", c.id]] });
        sentAtByContract[c.id] = events
          .filter((e) => e.type === "contract.sent_for_signature")
          .map((e) => e.occurredAt)
          .sort()
          .pop();
      }
    }),
  );
  return buildPortalContent({ client, contracts, billings, amendments, billingDataByContract, sentAtByContract, today });
}

/**
 * Tudo que a página pública precisa, a partir do token da URL. null = "Link inválido ou expirado" (inexistente,
 * revogado, expirado, malformado ou cliente removido — mesma resposta).
 */
export async function loadPortalForToken(token: string, now: Date = new Date()): Promise<PortalPageData | null> {
  const access = await registerAccess(token, now);
  if (!access) return null;
  const { link } = access;
  const content = await readPortalContent(link, now);
  if (!content) return null;
  if (access.emit) {
    try {
      await emitEvent({
        type: "portal.accessed",
        actor: PORTAL_VISITOR,
        clientId: link.clientId,
        entity: { type: "portal_link", id: link.id },
        title: `Portal do cliente acessado${link.label ? ` (${link.label})` : ""}`,
        description: `${PORTAL_ORIGIN_LABELS[link.origin]} · ${link.accessCount} acesso(s) no total`,
        department: "financeiro",
        payload: { portalLinkId: link.id, origin: link.origin, accessCount: link.accessCount, changes: { lastAccessAt: { from: access.previousAccessAt ?? null, to: link.lastAccessAt } } },
      });
    } catch (error) {
      // O evento é registro; a página do cliente não depende dele.
      console.error("[portal] falha ao registrar o evento de acesso", error);
    }
  }
  const [organization, channels] = await Promise.all([getById<Organization>(COLLECTIONS.organizations, ORG_ID), import("@/server/finance/service").then((m) => m.getBillingChannelSettings())]);
  return {
    content,
    companyName: organization?.name ?? "Intercert",
    expiresAt: link.expiresAt,
    secondCopyWhatsapp: channels.whatsappCobranca ? whatsappHref(channels.whatsappCobranca) : null,
  };
}
