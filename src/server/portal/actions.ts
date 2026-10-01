"use server";
/**
 * Server Actions do Portal do Cliente (D31) — gerar link (mostrado uma vez), enviar por WhatsApp/e-mail e revogar.
 * Padrão: requirePermission(chave do catálogo, financeiro.contratos.portal.*) → zod → escopo (contrato informado:
 * assertContractAccess; senão o cliente precisa ter um contrato no escopo de Contratos) → serviço (eventos) →
 * revalidatePath → ActionResult.
 */
import { revalidatePath } from "next/cache";
import { failAction, requirePermission } from "@/server/auth/session";
import { BusinessError } from "@/server/auth/error-classes";
import type { ActionResult, CurrentUser, UserRef } from "@/domain/types";
import { assertClientContractsAccess, assertContractAccess } from "@/server/finance/access";
import { createPortalLink, getPortalLink, getPortalRecipient, portalLinkMessage, portalUrl, resolvePortalBaseUrl, revokePortalLink, sendPortalLink, type PortalRecipient, type PortalSendResult } from "./service";
import { createPortalLinkSchema, revokePortalLinkSchema, sendPortalLinkSchema } from "./schemas";

const actorOf = (user: CurrentUser): UserRef => ({ id: user.id, name: user.name });

function revalidatePortal(clientId: string, contractId?: string | null) {
  revalidatePath(`/clientes/${clientId}`);
  if (contractId) revalidatePath(`/financeiro/contratos/${contractId}`);
  revalidatePath("/financeiro/contratos");
}

export interface CreatedPortalLinkView {
  linkId: string;
  /** Link completo com o token: exibido UMA vez (não é gravado). */
  url: string;
  token: string;
  expiresAt: string;
  recipient: PortalRecipient;
  /** Texto padrão do envio (com o link). */
  message: string;
}

/** Gera um link do portal para o cliente (validade em dias, rótulo opcional). */
export async function createPortalLinkAction(input: unknown): Promise<ActionResult<CreatedPortalLinkView>> {
  try {
    const user = await requirePermission("financeiro.contratos.portal.gerar");
    const data = createPortalLinkSchema.parse(input);
    if (data.contractId) {
      const contract = await assertContractAccess(user, data.contractId);
      if (contract.clientId !== data.clientId) throw new BusinessError("Contrato não pertence a este cliente");
    } else {
      await assertClientContractsAccess(user, data.clientId);
    }
    const base = await resolvePortalBaseUrl();
    if (!base) throw new BusinessError("Endereço do sistema não configurado (NEXT_PUBLIC_APP_URL)");
    const { link, token } = await createPortalLink({ clientId: data.clientId, contractId: data.contractId ?? null, days: data.days, label: data.label, origin: "manual" }, actorOf(user));
    const url = portalUrl(base, token);
    const recipient = await getPortalRecipient(link.clientId, link.contractId);
    revalidatePortal(link.clientId, link.contractId);
    return { ok: true, data: { linkId: link.id, url, token, expiresAt: link.expiresAt, recipient, message: portalLinkMessage(recipient.contactName, url, link.expiresAt) } };
  } catch (error) {
    return failAction(error, "Não foi possível gerar o link do portal", "portal");
  }
}

/** Envia o link recém-gerado (o token vem da tela que o gerou) por WhatsApp ou e-mail — templateKey "portal_link". */
export async function sendPortalLinkAction(input: unknown): Promise<ActionResult<{ result: PortalSendResult; contactName: string }>> {
  try {
    const user = await requirePermission("financeiro.contratos.portal.gerar");
    const data = sendPortalLinkSchema.parse(input);
    const link = await getPortalLink(data.linkId);
    if (!link) throw new BusinessError("Link do portal não encontrado. Gere um novo link.");
    if (link.contractId) await assertContractAccess(user, link.contractId);
    else await assertClientContractsAccess(user, link.clientId);
    const sent = await sendPortalLink({ linkId: data.linkId, token: data.token, channel: data.channel, text: data.text }, actorOf(user));
    revalidatePortal(link.clientId, link.contractId);
    return { ok: true, data: sent };
  } catch (error) {
    return failAction(error, "Não foi possível enviar o link do portal", "portal");
  }
}

/** Revoga um link do portal (motivo opcional): o acesso deixa de funcionar na hora. */
export async function revokePortalLinkAction(input: unknown): Promise<ActionResult<{ revokedAt: string }>> {
  try {
    const user = await requirePermission("financeiro.contratos.portal.revogar");
    const data = revokePortalLinkSchema.parse(input);
    const link = await getPortalLink(data.linkId);
    if (!link) throw new BusinessError("Link do portal não encontrado");
    await assertClientContractsAccess(user, link.clientId);
    const revoked = await revokePortalLink(link.id, data.reason, actorOf(user));
    revalidatePortal(link.clientId, link.contractId);
    return { ok: true, data: { revokedAt: revoked.revokedAt ?? "" } };
  } catch (error) {
    return failAction(error, "Não foi possível revogar o link do portal", "portal");
  }
}
