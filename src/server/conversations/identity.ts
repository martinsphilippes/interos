import "server-only";
/**
 * Identificação única do contato (Central de Atendimento): telefone ou e-mail → cliente/contato, lead ou desconhecido.
 *
 * Substitui as três comparações parecidas que existiam (phoneKey do Marketing, samePhone do Suporte e
 * findMatchingClient) para as mensagens que chegam: a mesma regra de telefone (src/domain/phone.ts) vale para
 * contato, cliente e lead, e o lead passa a ser reconhecido. Cliente vence lead; contato vence o telefone geral do
 * cliente; cliente cancelado só entra se não houver outro.
 */
import { getById, list } from "@/server/db";
import { COLLECTIONS, type Client, type Contact, type Conversation, type ConversationChannel, type ConversationIdentity, type Lead } from "@/domain/types";
import { contactKeyOf, emailIdentity, samePhoneNumber } from "@/domain/phone";
import { CHANNEL_INFO } from "@/domain/channels";

export interface ResolvedIdentity {
  identity: ConversationIdentity;
  clientId?: string;
  contactId?: string;
  leadId?: string;
  /** Nome para exibir (contato, cliente ou lead). */
  name?: string;
  /** Dono natural do contato (responsável pelo lead). */
  ownerId?: string;
}

export interface IdentityCandidate {
  kind: "contato" | "cliente" | "lead";
  id: string;
  clientId?: string;
  name: string;
  /** Empresa (contato/cliente) ou empresa informada pelo lead. */
  company?: string;
  /** Por que apareceu ("mesmo telefone", "mesmo e-mail", "nome parecido"). */
  reason: string;
  /** O telefone cadastrado não está no formato com 9 dígitos (dá para corrigir ao vincular). */
  phoneWithoutNine?: boolean;
}

interface Directory {
  contacts: Contact[];
  clients: Client[];
  leads: Lead[];
}

async function loadDirectory(): Promise<Directory> {
  const [contacts, clients, leads] = await Promise.all([list<Contact>(COLLECTIONS.contacts), list<Client>(COLLECTIONS.clients), list<Lead>(COLLECTIONS.leads)]);
  return { contacts, clients, leads };
}

function matches(channel: ConversationChannel, address: string, values: (string | undefined)[]): boolean {
  // Instagram, Messenger, Telegram e chat: o endereço é um id do provedor, nunca comparado com telefone ou e-mail.
  if (CHANNEL_INFO[channel].addressKind === "id") return false;
  if (channel === "email") {
    const e = emailIdentity(address);
    return Boolean(e) && values.some((v) => emailIdentity(v) === e);
  }
  return values.some((v) => samePhoneNumber(v, address));
}

/** Puro sobre o diretório (testável). */
export function resolveIdentityIn(dir: Directory, channel: ConversationChannel, address: string): ResolvedIdentity {
  const clientById = new Map(dir.clients.map((c) => [c.id, c]));
  const activeFirst = <T extends { clientId?: string; id: string }>(items: T[], clientOf: (x: T) => Client | undefined) =>
    [...items].sort((a, b) => Number(clientOf(a)?.status === "cancelado") - Number(clientOf(b)?.status === "cancelado"));

  const contacts = activeFirst(
    dir.contacts.filter((c) => matches(channel, address, channel === "email" ? [c.email] : [c.whatsapp, c.phone])),
    (c) => clientById.get(c.clientId),
  ).sort((a, b) => Number(b.isPrimary) - Number(a.isPrimary));
  const contact = contacts[0];
  if (contact && clientById.has(contact.clientId)) {
    return { identity: "cliente", clientId: contact.clientId, contactId: contact.id, name: contact.name };
  }
  const clients = activeFirst(
    dir.clients.filter((c) => matches(channel, address, channel === "email" ? [c.email] : [c.whatsapp, c.phone])),
    (c) => c,
  );
  if (clients[0]) return { identity: "cliente", clientId: clients[0].id, name: clients[0].tradeName };

  const leads = dir.leads
    .filter((l) => l.status !== "desqualificado" && !l.duplicateOfId && matches(channel, address, [channel === "email" ? l.email : l.phone]))
    .sort((a, b) => (a.createdAt < b.createdAt ? 1 : -1));
  const lead = leads[0];
  if (lead) {
    // Lead convertido em cliente: a conversa é do cliente.
    if (lead.clientId && clientById.has(lead.clientId)) return { identity: "cliente", clientId: lead.clientId, leadId: lead.id, name: lead.name, ownerId: lead.ownerId };
    return { identity: "lead", leadId: lead.id, name: lead.name, ownerId: lead.ownerId };
  }
  return { identity: "desconhecido" };
}

/** E-mail e telefone que a pessoa informou (formulário do chat do site). */
export interface IdentityHints {
  email?: string;
  phone?: string;
}

/**
 * Canais por id (Instagram, Messenger, Telegram, chat): a pessoa é reconhecida pelo vínculo feito numa conversa
 * anterior do mesmo id (o operador identificou quem era) ou, no chat, pelo e-mail/telefone que ela informou.
 */
export async function resolveIdentity(channel: ConversationChannel, address: string, hints?: IdentityHints): Promise<ResolvedIdentity> {
  if (CHANNEL_INFO[channel].addressKind !== "id") return resolveIdentityIn(await loadDirectory(), channel, address);
  const remembered = await rememberedIdentity(channel, address);
  if (remembered) return remembered;
  if (hints?.email || hints?.phone) {
    const dir = await loadDirectory();
    if (hints.email) {
      const r = resolveIdentityIn(dir, "email", hints.email);
      if (r.identity !== "desconhecido") return r;
    }
    if (hints.phone) {
      const r = resolveIdentityIn(dir, "whatsapp", hints.phone);
      if (r.identity !== "desconhecido") return r;
    }
  }
  return { identity: "desconhecido" };
}

/** A conversa mais recente do mesmo id já identificada (cliente/contato ou lead). */
async function rememberedIdentity(channel: ConversationChannel, address: string): Promise<ResolvedIdentity | null> {
  const key = contactKeyOf(channel, address);
  if (!key) return null;
  const previous = (await list<Conversation>(COLLECTIONS.conversations, { where: [["channel", "==", channel], ["contactKey", "==", key]] }))
    .filter((c) => c.clientId || c.leadId)
    .sort((a, b) => (a.openedAt < b.openedAt ? 1 : -1))[0];
  if (!previous) return null;
  const [contact, client, lead] = await Promise.all([
    previous.contactId ? getById<Contact>(COLLECTIONS.contacts, previous.contactId) : null,
    previous.clientId ? getById<Client>(COLLECTIONS.clients, previous.clientId) : null,
    previous.leadId ? getById<Lead>(COLLECTIONS.leads, previous.leadId) : null,
  ]);
  if (client) return { identity: "cliente", clientId: client.id, contactId: contact?.id, leadId: lead?.id, name: contact?.name ?? client.tradeName, ownerId: lead?.ownerId };
  if (lead) return { identity: "lead", leadId: lead.id, name: lead.name, ownerId: lead.ownerId };
  return null;
}

function nameKey(value: string | undefined): string {
  return (value ?? "")
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9 ]+/g, " ")
    .trim();
}

/** Primeiro nome com 3+ letras em comum ("João AP" ~ "João Lima"). */
function similarName(a: string | undefined, b: string | undefined): boolean {
  const fa = nameKey(a).split(/\s+/)[0];
  const fb = nameKey(b).split(/\s+/)[0];
  return Boolean(fa && fb && fa.length >= 3 && fa === fb);
}

function withoutNine(value: string | undefined): boolean {
  const d = (value ?? "").replace(/\D/g, "").replace(/^55(?=\d{10,11}$)/, "");
  return d.length === 10 && /^[6-9]/.test(d.slice(2));
}

/**
 * Sugestões para «Quem é este número?»: mesmo telefone/e-mail (inclusive sem o 9) e nome parecido com o do perfil.
 * Puro sobre o diretório.
 */
export function identityCandidatesIn(dir: Directory, channel: ConversationChannel, address: string, displayName?: string): IdentityCandidate[] {
  const clientById = new Map(dir.clients.map((c) => [c.id, c]));
  const out: IdentityCandidate[] = [];
  for (const c of dir.contacts) {
    const values = channel === "email" ? [c.email] : [c.whatsapp, c.phone];
    const same = matches(channel, address, values);
    if (!same && !similarName(c.name, displayName)) continue;
    const client = clientById.get(c.clientId);
    if (!client) continue;
    out.push({
      kind: "contato",
      id: c.id,
      clientId: c.clientId,
      name: c.name,
      company: client.tradeName,
      reason: same ? (channel === "email" ? "mesmo e-mail" : "mesmo telefone") : "nome parecido",
      phoneWithoutNine: same && channel === "whatsapp" ? values.some((v) => samePhoneNumber(v, address) && withoutNine(v)) : undefined,
    });
  }
  for (const c of dir.clients) {
    if (!matches(channel, address, channel === "email" ? [c.email] : [c.whatsapp, c.phone])) continue;
    out.push({ kind: "cliente", id: c.id, clientId: c.id, name: c.tradeName, reason: channel === "email" ? "mesmo e-mail" : "mesmo telefone" });
  }
  for (const l of dir.leads) {
    if (l.status === "desqualificado" || l.duplicateOfId) continue;
    const same = matches(channel, address, [channel === "email" ? l.email : l.phone]);
    if (!same && !similarName(l.name, displayName)) continue;
    out.push({ kind: "lead", id: l.id, clientId: l.clientId, name: l.name, company: l.company, reason: same ? (channel === "email" ? "mesmo e-mail" : "mesmo telefone") : "nome parecido" });
  }
  const rank = (c: IdentityCandidate) => (c.reason === "nome parecido" ? 1 : 0);
  return out.sort((a, b) => rank(a) - rank(b)).slice(0, 6);
}

export async function identityCandidates(channel: ConversationChannel, address: string, displayName?: string): Promise<IdentityCandidate[]> {
  return identityCandidatesIn(await loadDirectory(), channel, address, displayName);
}
