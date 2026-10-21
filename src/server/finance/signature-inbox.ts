import "server-only";
/**
 * Caixa de entrada da assinatura eletrônica: documentos criados direto na Clicksign (sem contrato no INTEROS) chegam
 * aqui pelo aviso da Clicksign e alguém do Financeiro escolhe o cliente (e, se houver, o contrato) certo.
 *
 * O INTEROS sugere o cliente quando o e-mail ou o CNPJ/CPF de um signatário bate com o cadastro (ignorando quem assina
 * pela Intercert). Vincular grava o documento na ficha do cliente; ignorar pede o motivo. Nada é apagado.
 */
import { BusinessError } from "@/server/auth/error-classes";
import { create, createIfAbsent, getById, list, nowIso, update } from "@/server/db";
import { emitEvent } from "@/server/events";
import { COLLECTIONS, type Client, type Contact, type Contract, type Document, type SignatureInboxItem, type UserRef } from "@/domain/types";
import { getSignatureSettings } from "./contract-templates";

export interface ExternalEnvelopeInput {
  envelopeId: string;
  documentKey?: string;
  name: string;
  providerStatus: SignatureInboxItem["providerStatus"];
  signers: SignatureInboxItem["signers"];
  finishedAt?: string;
}

function digits(v: string | undefined): string {
  return (v ?? "").replace(/\D/g, "");
}

/** Cliente provável pelos signatários: e-mail (cliente ou contato) ou CNPJ/CPF. */
export function suggestClient(
  signers: SignatureInboxItem["signers"],
  clients: Pick<Client, "id" | "tradeName" | "email" | "document">[],
  contacts: Pick<Contact, "clientId" | "email" | "name">[],
  ignoreEmails: string[] = [],
): { clientId: string; reason: string } | null {
  const skip = new Set(ignoreEmails.map((e) => e.toLowerCase()));
  for (const s of signers) {
    const email = s.email.trim().toLowerCase();
    if (!email || skip.has(email)) continue;
    const doc = digits(s.document);
    if (doc.length >= 11) {
      const byDoc = clients.find((c) => digits(c.document) === doc);
      if (byDoc) return { clientId: byDoc.id, reason: `CNPJ/CPF de ${s.name} igual ao do cadastro` };
    }
    const direct = clients.find((c) => c.email?.trim().toLowerCase() === email);
    if (direct) return { clientId: direct.id, reason: `e-mail de ${s.name} é o do cliente` };
    const contact = contacts.find((c) => c.email?.trim().toLowerCase() === email);
    if (contact) return { clientId: contact.clientId, reason: `${s.name} é contato do cliente` };
  }
  // Domínio corporativo do e-mail (não vale para provedores gratuitos).
  const FREE = /@(gmail|hotmail|outlook|yahoo|live|icloud|uol|bol|terra|ig)\./i;
  for (const s of signers) {
    const email = s.email.trim().toLowerCase();
    if (!email || skip.has(email) || FREE.test(email)) continue;
    const domain = email.split("@")[1];
    if (!domain) continue;
    const owners = new Set([...clients.filter((c) => c.email?.toLowerCase().endsWith(`@${domain}`)).map((c) => c.id), ...contacts.filter((c) => c.email?.toLowerCase().endsWith(`@${domain}`)).map((c) => c.clientId)]);
    if (owners.size === 1) return { clientId: [...owners][0], reason: `mesmo domínio de e-mail (@${domain})` };
  }
  return null;
}

/** Recebe (ou atualiza) um documento da Clicksign. Idempotente pelo id do envelope. */
export async function recordExternalEnvelope(input: ExternalEnvelopeInput): Promise<{ item: SignatureInboxItem; created: boolean }> {
  const id = `clicksign_${input.envelopeId.replace(/[^A-Za-z0-9_-]/g, "")}`;
  const [clients, contacts, settings] = await Promise.all([list<Client>(COLLECTIONS.clients), list<Contact>(COLLECTIONS.contacts), getSignatureSettings()]);
  const suggestion = suggestClient(input.signers, clients, contacts, settings.companySigner.email ? [settings.companySigner.email] : []);
  const data = {
    provider: "clicksign" as const,
    envelopeId: input.envelopeId,
    documentKey: input.documentKey,
    name: input.name.trim().slice(0, 200) || "Documento sem nome",
    providerStatus: input.providerStatus,
    signers: input.signers.slice(0, 30),
    receivedAt: nowIso(),
    finishedAt: input.finishedAt,
    state: "pendente" as const,
    ...(suggestion ? { suggestedClientId: suggestion.clientId, suggestionReason: suggestion.reason } : {}),
  };
  const { created, doc } = await createIfAbsent<SignatureInboxItem>(COLLECTIONS.signatureInbox, id, data);
  if (created) return { item: doc, created };
  // Já recebido: atualiza só o andamento (o destino escolhido não muda).
  const patch: Partial<SignatureInboxItem> = { providerStatus: input.providerStatus, signers: data.signers, ...(input.finishedAt ? { finishedAt: input.finishedAt } : {}) };
  await update<SignatureInboxItem>(COLLECTIONS.signatureInbox, id, patch);
  return { item: { ...doc, ...patch }, created: false };
}

export async function listSignatureInbox(): Promise<SignatureInboxItem[]> {
  const all = await list<SignatureInboxItem>(COLLECTIONS.signatureInbox);
  const order = { pendente: 0, vinculado: 1, ignorado: 2 } as const;
  return all.sort((a, b) => order[a.state] - order[b.state] || b.receivedAt.localeCompare(a.receivedAt));
}

async function loadItem(id: string): Promise<SignatureInboxItem> {
  const item = await getById<SignatureInboxItem>(COLLECTIONS.signatureInbox, id);
  if (!item) throw new BusinessError("Documento não encontrado na caixa de entrada");
  return item;
}

const STATUS_TEXT: Record<SignatureInboxItem["providerStatus"], string> = { em_andamento: "em assinatura", finalizado: "assinado por todos", cancelado: "cancelado", recusado: "recusado" };

/** Destina o documento ao cliente (e opcionalmente a um contrato dele): entra nos documentos do cliente. */
export async function assignInboxItem(input: { id: string; clientId: string; contractId?: string }, actor: UserRef): Promise<SignatureInboxItem> {
  const item = await loadItem(input.id);
  if (item.state === "vinculado") throw new BusinessError("Este documento já foi vinculado");
  const client = await getById<Client>(COLLECTIONS.clients, input.clientId);
  if (!client) throw new BusinessError("Cliente não encontrado");
  let contract: Contract | null = null;
  if (input.contractId) {
    contract = await getById<Contract>(COLLECTIONS.contracts, input.contractId);
    if (!contract || contract.clientId !== client.id) throw new BusinessError("O contrato escolhido não é deste cliente");
  }
  const document = await create<Document>(COLLECTIONS.documents, {
    clientId: client.id,
    entityType: contract ? "contract" : "client",
    entityId: contract?.id ?? client.id,
    name: `${item.name} (Clicksign · ${STATUS_TEXT[item.providerStatus]})`,
    url: `/financeiro/assinaturas?aba=entrada&item=${item.id}`,
    mimeType: "application/pdf",
    version: 1,
    uploadedBy: actor.id,
    category: item.providerStatus === "finalizado" ? "Contrato assinado" : "Contrato",
  });
  if (contract) await update<Contract>(COLLECTIONS.contracts, contract.id, { documentIds: [...contract.documentIds, document.id] });
  const now = nowIso();
  const patch: Partial<SignatureInboxItem> = { state: "vinculado", clientId: client.id, contractId: contract?.id, documentId: document.id, resolvedBy: actor.id, resolvedByName: actor.name, resolvedAt: now };
  await update<SignatureInboxItem>(COLLECTIONS.signatureInbox, item.id, patch);
  await emitEvent({
    type: "note.added",
    actor,
    clientId: client.id,
    entity: contract ? { type: "contract", id: contract.id } : { type: "client", id: client.id },
    title: `Documento da Clicksign vinculado: ${item.name}`,
    description: `${STATUS_TEXT[item.providerStatus]} · ${item.signers.map((s) => s.name).join(", ")}${contract ? ` · contrato ${contract.number}` : ""}${item.suggestedClientId === client.id ? " · sugestão do INTEROS aceita" : ""}`,
    department: "financeiro",
    payload: { inboxId: item.id, envelopeId: item.envelopeId, contractId: contract?.id, documentId: document.id, suggested: item.suggestedClientId === client.id },
  });
  return { ...item, ...patch };
}

export async function ignoreInboxItem(input: { id: string; reason: string }, actor: UserRef): Promise<void> {
  const item = await loadItem(input.id);
  if (item.state !== "pendente") throw new BusinessError("Só documentos pendentes podem ser ignorados");
  const reason = input.reason.trim();
  if (reason.length < 3) throw new BusinessError("Informe o motivo");
  await update<SignatureInboxItem>(COLLECTIONS.signatureInbox, item.id, { state: "ignorado", ignoreReason: reason, resolvedBy: actor.id, resolvedByName: actor.name, resolvedAt: nowIso() });
  await emitEvent({ type: "note.added", actor, entity: { type: "signature_inbox", id: item.id }, title: `Documento da Clicksign ignorado: ${item.name}`, description: reason, department: "financeiro", payload: { inboxId: item.id, envelopeId: item.envelopeId }, timeline: false });
}

/** Volta um documento ignorado para a fila. */
export async function reopenInboxItem(id: string, actor: UserRef): Promise<void> {
  const item = await loadItem(id);
  if (item.state !== "ignorado") throw new BusinessError("Só documentos ignorados voltam para a fila");
  await update<SignatureInboxItem>(COLLECTIONS.signatureInbox, item.id, { state: "pendente", ignoreReason: "", resolvedBy: "", resolvedByName: "", resolvedAt: "" });
  await emitEvent({ type: "note.added", actor, entity: { type: "signature_inbox", id: item.id }, title: `Documento da Clicksign voltou para a caixa de entrada: ${item.name}`, department: "financeiro", payload: { inboxId: item.id }, timeline: false });
}
