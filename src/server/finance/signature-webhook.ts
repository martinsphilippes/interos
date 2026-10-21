import "server-only";
/**
 * Avisos da Clicksign (webhook) aplicados no INTEROS.
 *
 * Contrato enviado pelo INTEROS (achado pelo id gravado nos metadados do documento, ou pelo id do documento):
 * - sign: o signatário fica "assinado" (método provedor); com todos assinados, o contrato fica assinado;
 * - refusal: o signatário fica "recusado" e o dono do contrato e o gestor do Financeiro são avisados;
 * - auto_close / close / document_closed: o documento foi finalizado: todos contam como assinados e o PDF assinado é
 *   guardado no INTEROS (os links da Clicksign expiram);
 * - cancel / deadline: nota na timeline e aviso ao dono (o contrato continua aguardando assinatura).
 * Documento de versão antiga (o contrato foi gerado de novo) ou de contrato encerrado é ignorado.
 *
 * Documento criado direto na Clicksign (sem contrato): cai na caixa de entrada, com o andamento atualizado a cada aviso.
 *
 * Tudo é idempotente: a Clicksign reenvia o aviso quando não recebe 200, e o mesmo aviso não muda nada duas vezes.
 * A marcação dos signatários é feita em transação (avisos simultâneos de dois signatários não se sobrescrevem).
 */
import { createHash } from "node:crypto";
import { docdb } from "@/server/docdb";
import { col, createIfAbsent, getById, list, nowIso, txGetOwn, update } from "@/server/db";
import { emitEvent } from "@/server/events";
import { notify } from "@/server/notifications";
import { getDepartmentManager } from "@/server/workflow/service";
import { clicksignConfigured, getDocument, type ClicksignWebhook } from "@/server/integrations/clicksign";
import { formatDate } from "@/lib/format";
import { COLLECTIONS, type Contract, type ContractSignerEntry, type SignatureInboxItem, type SignedFile } from "@/domain/types";
import { contractDocumentHash } from "./signature";
import { SYSTEM_ACTOR } from "./billing";
import { announceContractSigned } from "./service";
import { recordExternalEnvelope } from "./signature-inbox";

export interface ClicksignWebhookOutcome {
  handled: "contract" | "inbox" | "ignored";
  contractId?: string;
  inboxId?: string;
  message: string;
}

const CLOSE_EVENTS = new Set(["auto_close", "close", "document_closed"]);
const ACTOR = { ...SYSTEM_ACTOR, name: "Clicksign (assinatura eletrônica)" };
/** Tamanho máximo do PDF assinado guardado (o documento original já passou pelo limite de envio). */
const MAX_SIGNED_FILE_BYTES = 20 * 1024 * 1024;

export async function processClicksignWebhook(hook: ClicksignWebhook): Promise<ClicksignWebhookOutcome> {
  const found = await findContract(hook);
  if (found === "foreign") return { handled: "ignored", message: "Documento com id de contrato que não existe neste INTEROS" };
  if (found) return applyToContract(found, hook);
  return applyToInbox(hook);
}

/** Contrato do aviso: pelos metadados (interos_contract_id) ou pelo id do documento gravado no envio. */
async function findContract(hook: ClicksignWebhook): Promise<Contract | "foreign" | null> {
  const id = hook.metadata.interos_contract_id;
  if (id) return (await getById<Contract>(COLLECTIONS.contracts, id)) ?? "foreign";
  if (!hook.documentKey) return null;
  const [contract] = await list<Contract>(COLLECTIONS.contracts, { where: [["signatureDocumentId", "==", hook.documentKey]] });
  return contract ?? null;
}

function sameSigner(entry: ContractSignerEntry, who: { key?: string; email: string }): boolean {
  return (Boolean(who.key) && entry.providerSignerId === who.key) || entry.email.trim().toLowerCase() === who.email.toLowerCase();
}

async function applyToContract(contract: Contract, hook: ClicksignWebhook): Promise<ClicksignWebhookOutcome> {
  const base = { handled: "contract" as const, contractId: contract.id };
  const version = Number(hook.metadata.interos_version);
  if (hook.metadata.interos_version && version !== contract.version) return { ...base, message: `Aviso da versão ${version} (o contrato está na versão ${contract.version}): ignorado` };
  if (contract.status === "cancelado" || contract.status === "liberado") return { ...base, message: "Contrato encerrado: aviso ignorado" };

  if (hook.event === "sign") {
    if (!hook.signer) return { ...base, message: "Aviso de assinatura sem signatário" };
    const result = await markSigners(contract.id, (s) => sameSigner(s, hook.signer!), "assinado", hook.occurredAt);
    if (!result.changed.length) return { ...base, message: result.unknown ? `Signatário ${hook.signer.email} não está no contrato` : "Assinatura já registrada" };
    const s = result.changed[0];
    await emitEvent({
      type: "note.added",
      actor: ACTOR,
      clientId: contract.clientId,
      entity: { type: "contract", id: contract.id },
      title: `${s.name} assinou o contrato ${contract.number} (Clicksign)`,
      description: `${s.role} · ${s.email} · assinado em ${formatDate(s.signedAt ?? nowIso())}`,
      department: "financeiro",
      payload: { contractId: contract.id, email: s.email, method: "provedor", provider: "clicksign", signedAt: s.signedAt, envelopeId: contract.signatureEnvelopeId, changes: { signer: { from: `${s.name}: pendente`, to: `${s.name}: assinado em ${formatDate(s.signedAt ?? nowIso())}` } } },
    });
    if (result.completed) await finishContract(result.contract, result.patch, hook);
    return { ...base, message: result.completed ? "Assinatura registrada; contrato assinado por todos" : "Assinatura registrada" };
  }

  if (hook.event === "refusal") {
    if (!hook.signer) return { ...base, message: "Aviso de recusa sem signatário" };
    const result = await markSigners(contract.id, (s) => sameSigner(s, hook.signer!), "recusado", hook.occurredAt);
    if (!result.changed.length) return { ...base, message: result.unknown ? `Signatário ${hook.signer.email} não está no contrato` : "Recusa já registrada" };
    const s = result.changed[0];
    const reasons = [...(hook.refusal?.reasons ?? []), hook.refusal?.comment].filter(Boolean).join(" · ") || "sem motivo informado";
    const title = `${s.name} recusou o contrato ${contract.number} na Clicksign`;
    await emitEvent({
      type: "note.added",
      actor: ACTOR,
      clientId: contract.clientId,
      entity: { type: "contract", id: contract.id },
      title,
      description: `Motivo: ${reasons}. Corrija o contrato e gere o documento de novo para reenviar.`,
      department: "financeiro",
      payload: { contractId: contract.id, email: s.email, provider: "clicksign", reasons: hook.refusal?.reasons, comment: hook.refusal?.comment, changes: { signer: { from: `${s.name}: pendente`, to: `${s.name}: recusado` } } },
    });
    await warn(contract, title, `Motivo: ${reasons}`, "atencao");
    return { ...base, message: "Recusa registrada" };
  }

  if (CLOSE_EVENTS.has(hook.event)) {
    const result = await markSigners(contract.id, (s) => s.status !== "assinado", "assinado", hook.finishedAt ?? hook.occurredAt);
    const stored = await storeContractSignedFile(result.contract, hook);
    if (result.completed) await finishContract(result.contract, result.patch, hook);
    return { ...base, message: `${result.completed ? "Contrato assinado por todos" : "Documento finalizado (já registrado)"}${stored ? " · PDF assinado guardado" : ""}` };
  }

  if (hook.event === "cancel" || hook.event === "deadline") {
    if (contract.signedAt) return { ...base, message: "Contrato já assinado: aviso ignorado" };
    const title = hook.event === "cancel" ? `Documento do contrato ${contract.number} cancelado na Clicksign` : `Prazo de assinatura do contrato ${contract.number} venceu na Clicksign`;
    const body = "Gere o documento de novo para reenviar aos signatários.";
    await emitEvent({ type: "note.added", actor: ACTOR, clientId: contract.clientId, entity: { type: "contract", id: contract.id }, title, description: body, department: "financeiro", payload: { contractId: contract.id, provider: "clicksign", event: hook.event } });
    await warn(contract, title, body, "atencao");
    return { ...base, message: hook.event === "cancel" ? "Cancelamento registrado" : "Prazo vencido registrado" };
  }

  return { ...base, message: `Evento ${hook.event}: nada a fazer` };
}

interface MarkResult {
  contract: Contract;
  patch: Partial<Contract>;
  changed: ContractSignerEntry[];
  /** Este aviso fechou o contrato (antes não estava assinado por todos). */
  completed: boolean;
  /** Nenhum signatário do contrato bateu com o aviso. */
  unknown: boolean;
}

/** Marca os signatários escolhidos (em transação) e, com todos assinados, o contrato. */
async function markSigners(contractId: string, pick: (s: ContractSignerEntry) => boolean, status: "assinado" | "recusado", at: string | undefined): Promise<MarkResult> {
  const ref = col(COLLECTIONS.contracts).doc(contractId);
  const when = validIso(at) ?? nowIso();
  return docdb.runTransaction(async (tx) => {
    const snap = await txGetOwn(tx, ref);
    if (!snap) throw new Error("Contrato não encontrado");
    const current = { ...(snap.data() as Omit<Contract, "id">), id: contractId } as Contract;
    const now = nowIso();
    const changed: ContractSignerEntry[] = [];
    let matched = false;
    const signers = current.signers.map((s) => {
      if (!pick(s)) return s;
      matched = true;
      if (s.status === status || (status === "recusado" && s.status === "assinado")) return s;
      const next: ContractSignerEntry =
        status === "assinado"
          ? { ...s, status, signedAt: when, method: "provedor", evidence: "Assinatura eletrônica na Clicksign", registeredBy: ACTOR.id, registeredAt: now }
          : { ...s, status, registeredBy: ACTOR.id, registeredAt: now };
      changed.push(next);
      return next;
    });
    const patch: Partial<Contract> = {};
    const done = signers.length > 0 && signers.every((s) => s.status === "assinado");
    const completed = done && !current.signedAt;
    if (changed.length) {
      patch.signers = signers;
      patch.documentHash = current.documentHash ?? contractDocumentHash(current);
      if (completed) {
        patch.signedAt = signers.map((s) => s.signedAt ?? "").sort().pop() || when;
        if (current.status !== "pendencia") patch.status = "assinado";
      }
      tx.update(ref, { ...patch, updatedAt: now });
    }
    return { contract: current, patch, changed, completed, unknown: !matched };
  });
}

async function finishContract(contract: Contract, patch: Partial<Contract>, hook: ClicksignWebhook): Promise<void> {
  const signers = patch.signers ?? contract.signers;
  await announceContractSigned(contract, patch, { method: "provedor", signerCount: signers.length, documentHash: patch.documentHash ?? contract.documentHash ?? contractDocumentHash(contract) }, ACTOR);
  // O aviso de finalização pode chegar antes do PDF ficar pronto: tenta guardar de novo (sem custo se já guardado).
  if (!CLOSE_EVENTS.has(hook.event)) await storeContractSignedFile(contract, hook);
}

/** Avisa o dono do contrato e o gestor do Financeiro. */
async function warn(contract: Contract, title: string, body: string, kind: "atencao" | "informativa"): Promise<void> {
  const manager = await getDepartmentManager("financeiro").catch(() => null);
  await notify({ userIds: [contract.ownerId ?? "", manager?.id ?? ""], kind, title, body, href: `/financeiro/contratos/${contract.id}`, entity: { type: "contract", id: contract.id } });
}

// ---------------------------------------------------------------------------
// PDF assinado guardado no INTEROS
// ---------------------------------------------------------------------------

export function contractSignedFileId(contract: Pick<Contract, "id" | "version">): string {
  return `contract_${contract.id}_v${contract.version}`;
}

export function inboxSignedFileId(inboxId: string): string {
  return `inbox_${inboxId}`;
}

/** Link do PDF assinado do contrato: pela API (id do envelope e do documento) ou o que veio completo no aviso. */
async function contractSignedFileUrl(contract: Contract, hookUrl?: string): Promise<string | undefined> {
  if (contract.signatureProvider === "clicksign" && contract.signatureEnvelopeId && contract.signatureDocumentId && clicksignConfigured()) {
    try {
      const doc = await getDocument(contract.signatureEnvelopeId, contract.signatureDocumentId);
      if (doc.files.signed) return doc.files.signed;
    } catch (error) {
      console.error("[clicksign] não leu o documento para baixar o PDF assinado", error);
    }
  }
  return hookUrl;
}

/** Guarda o PDF assinado do contrato (uma vez por versão). true quando o arquivo está guardado. */
export async function storeContractSignedFile(contract: Contract, hook?: Pick<ClicksignWebhook, "signedFileUrl" | "filename">): Promise<boolean> {
  const id = contractSignedFileId(contract);
  if (await getById<SignedFile>(COLLECTIONS.signedFiles, id)) return true;
  const url = await contractSignedFileUrl(contract, hook?.signedFileUrl);
  if (!url) return false;
  const fileName = `Contrato ${contract.number} v${contract.version} assinado.pdf`;
  return storeSignedFile(id, { ownerType: "contract", ownerId: contract.id, version: contract.version, fileName }, url);
}

async function storeSignedFile(id: string, owner: Pick<SignedFile, "ownerType" | "ownerId" | "version" | "fileName">, url: string): Promise<boolean> {
  try {
    const file = await downloadSignedFile(url);
    await createIfAbsent<SignedFile>(COLLECTIONS.signedFiles, id, {
      ...owner,
      mimeType: file.mimeType,
      size: file.buffer.length,
      sha256: `sha256:${createHash("sha256").update(file.buffer).digest("hex")}`,
      contentBase64: file.buffer.toString("base64"),
      provider: "clicksign",
      receivedAt: nowIso(),
    });
    return true;
  } catch (error) {
    // Sem o arquivo agora, o download pela tela tenta de novo pela API.
    console.error("[clicksign] não guardou o PDF assinado", error);
    return false;
  }
}

/** Baixa o arquivo do link da Clicksign (https, até 20 MB, 20 s). */
export async function downloadSignedFile(url: string): Promise<{ buffer: Buffer; mimeType: string }> {
  if (!/^https:\/\//i.test(url)) throw new Error("Link do arquivo assinado inválido");
  const response = await fetch(url, { signal: AbortSignal.timeout(20_000), redirect: "follow" });
  if (!response.ok) throw new Error(`Download do arquivo assinado falhou (${response.status})`);
  const declared = Number(response.headers.get("content-length") ?? 0);
  if (declared > MAX_SIGNED_FILE_BYTES) throw new Error("Arquivo assinado grande demais");
  const buffer = Buffer.from(await response.arrayBuffer());
  if (buffer.length > MAX_SIGNED_FILE_BYTES) throw new Error("Arquivo assinado grande demais");
  const mimeType = (response.headers.get("content-type") ?? "application/pdf").split(";")[0].trim() || "application/pdf";
  return { buffer, mimeType };
}

/** Arquivo guardado pelo id. */
export async function getSignedFile(id: string): Promise<SignedFile | null> {
  return getById<SignedFile>(COLLECTIONS.signedFiles, id);
}

// ---------------------------------------------------------------------------
// Caixa de entrada (documento criado direto na Clicksign)
// ---------------------------------------------------------------------------

function inboxStatus(hook: ClicksignWebhook, previous?: SignatureInboxItem["providerStatus"]): SignatureInboxItem["providerStatus"] {
  if (CLOSE_EVENTS.has(hook.event) || hook.documentStatus === "closed") return "finalizado";
  if (hook.event === "cancel" || hook.documentStatus === "canceled") return "cancelado";
  if (hook.event === "refusal") return "recusado";
  // Status final não volta para "em andamento" (avisos podem chegar fora de ordem).
  return previous && previous !== "em_andamento" ? previous : "em_andamento";
}

async function applyToInbox(hook: ClicksignWebhook): Promise<ClicksignWebhookOutcome> {
  if (!hook.documentKey) return { handled: "ignored", message: "Aviso sem identificação do documento" };
  const inboxId = `clicksign_${hook.documentKey.replace(/[^A-Za-z0-9_-]/g, "")}`;
  const previous = await getById<SignatureInboxItem>(COLLECTIONS.signatureInbox, inboxId);
  const when = validIso(hook.finishedAt ?? hook.occurredAt) ?? nowIso();
  const signedAt = new Map((previous?.signers ?? []).filter((s) => s.signedAt).map((s) => [s.email.toLowerCase(), s.signedAt!]));
  if (hook.event === "sign" && hook.signer) signedAt.set(hook.signer.email.toLowerCase(), validIso(hook.occurredAt) ?? nowIso());
  const providerStatus = inboxStatus(hook, previous?.providerStatus);
  const source = hook.signers.length ? hook.signers : (previous?.signers ?? []).map((s) => ({ name: s.name, email: s.email, documentation: s.document }));
  const signers = source.map((s) => {
    const email = s.email.toLowerCase();
    const at = signedAt.get(email) ?? (providerStatus === "finalizado" ? when : undefined);
    return { name: s.name, email, ...(s.documentation ? { document: s.documentation } : {}), ...(at ? { signedAt: at } : {}) };
  });
  const name = (hook.filename ?? previous?.name ?? "").replace(/^.*\//, "") || "Documento da Clicksign";
  const { item } = await recordExternalEnvelope({
    envelopeId: hook.documentKey,
    documentKey: hook.documentKey,
    name,
    providerStatus,
    signers,
    finishedAt: providerStatus === "finalizado" ? (validIso(hook.finishedAt) ?? previous?.finishedAt ?? when) : previous?.finishedAt,
  });
  let stored = false;
  if (providerStatus === "finalizado" && hook.signedFileUrl && !item.signedFileId) {
    const fileId = inboxSignedFileId(item.id);
    stored = await storeSignedFile(fileId, { ownerType: "inbox", ownerId: item.id, fileName: name.toLowerCase().endsWith(".pdf") ? name : `${name}.pdf` }, hook.signedFileUrl);
    if (stored) await update<SignatureInboxItem>(COLLECTIONS.signatureInbox, item.id, { signedFileId: fileId });
  }
  return { handled: "inbox", inboxId: item.id, message: `Caixa de entrada: ${providerStatus}${stored ? " · PDF assinado guardado" : ""}` };
}

function validIso(v: string | undefined): string | undefined {
  if (!v) return undefined;
  const d = new Date(v);
  return Number.isNaN(d.getTime()) ? undefined : d.toISOString();
}
