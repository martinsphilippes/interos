import "server-only";
/**
 * Cadastro de contato do cliente (regra compartilhada): a action de Clientes e o "cadastrar e adicionar como
 * signatário" do contrato gravam o contato pelo mesmo caminho, com o mesmo evento `contact.created`.
 * Quem chama já conferiu permissão e escopo do cliente.
 */
import { create } from "@/server/db";
import { emitEvent } from "@/server/events";
import { formatPhone } from "@/lib/format";
import type { DepartmentKey } from "@/domain/constants";
import { COLLECTIONS, type Contact, type UserRef } from "@/domain/types";

export interface NewContactInput {
  clientId: string;
  name: string;
  role?: string;
  phone?: string;
  whatsapp?: string;
  email?: string;
  isPrimary?: boolean;
  isDecisionMaker?: boolean;
}

export async function createContact(input: NewContactInput, actor: UserRef, department?: DepartmentKey): Promise<Contact> {
  const contact = await create<Contact>(COLLECTIONS.contacts, {
    clientId: input.clientId,
    name: input.name.trim(),
    role: input.role?.trim() || undefined,
    phone: input.phone || undefined,
    whatsapp: input.whatsapp || undefined,
    email: input.email?.trim().toLowerCase() || undefined,
    isPrimary: Boolean(input.isPrimary),
    isDecisionMaker: Boolean(input.isDecisionMaker),
    createdBy: actor.id,
  });
  await emitEvent({
    type: "contact.created",
    actor,
    clientId: input.clientId,
    entity: { type: "contact", id: contact.id },
    title: `Contato adicionado: ${contact.name}${contact.role ? ` (${contact.role})` : ""}`,
    description: [contact.phone ? formatPhone(contact.phone) : null, contact.email].filter(Boolean).join(" · ") || undefined,
    department,
    payload: { isPrimary: contact.isPrimary, isDecisionMaker: contact.isDecisionMaker },
  });
  return contact;
}
