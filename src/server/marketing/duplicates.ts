import "server-only";
/**
 * Deduplicação com escopo (catálogo, marketing.leads.criar): a busca de duplicidade continua varrendo a empresa inteira
 * — o aviso "possível duplicidade" não pode depender da carteira de quem cadastra —, mas o que está fora do escopo do
 * usuário volta só com o mínimo (motivos e status), sem nome, empresa, telefone ou e-mail.
 */
import type { CurrentUser, Lead } from "@/domain/types";
import { canSeeClientId } from "@/server/clients/access";
import { getManyByIds } from "@/server/db";
import { COLLECTIONS } from "@/domain/types";
import { isFullScope, leadAccess, leadInScope, type LeadAccess } from "./access";
import type { LeadDuplicate } from "./service";

export const HIDDEN_LEAD_NAME = "Lead de outra carteira";
export const HIDDEN_CLIENT_NAME = "Cliente já cadastrado";

/** Puro: esconde os dados dos duplicados cujo dono está fora do escopo. */
export function maskDuplicates(duplicates: readonly LeadDuplicate[], owners: ReadonlyMap<string, Pick<Lead, "ownerId">>, access: LeadAccess): LeadDuplicate[] {
  if (isFullScope(access.scope)) return [...duplicates];
  return duplicates.map((d, i) => {
    const owner = owners.get(d.id);
    if (owner && leadInScope(access, owner)) return d;
    return { id: `oculto-${i + 1}`, name: HIDDEN_LEAD_NAME, status: d.status, createdAt: d.createdAt, reasons: d.reasons, restricted: true };
  });
}

type ClientMatch = { client: { id: string; tradeName: string }; reasons: string[] } | null;

export async function maskDuplicatesOutOfScope(
  user: CurrentUser,
  leads: LeadDuplicate[],
  client: ClientMatch,
): Promise<{ leads: LeadDuplicate[]; client: { id: string; tradeName: string; reasons: string[] } | null }> {
  const access = await leadAccess(user);
  const owners = isFullScope(access.scope) || leads.length === 0 ? new Map<string, Lead>() : await getManyByIds<Lead>(COLLECTIONS.leads, leads.map((d) => d.id));
  const masked = maskDuplicates(leads, owners, access);
  if (!client) return { leads: masked, client: null };
  const visible = await canSeeClientId(user, client.client.id);
  return { leads: masked, client: visible ? { id: client.client.id, tradeName: client.client.tradeName, reasons: client.reasons } : { id: "", tradeName: HIDDEN_CLIENT_NAME, reasons: client.reasons } };
}
