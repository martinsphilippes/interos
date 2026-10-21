import "server-only";
/**
 * Avisos da Clicksign (webhook) aplicados no INTEROS.
 *
 * Contrato enviado pelo INTEROS (achado pelo id gravado nos metadados do documento, ou pelo id do documento). O aviso
 * só vale para o envio ATUAL: versão diferente, envelope diferente (o contrato foi reenviado) ou contrato encerrado são
 * ignorados.
 * - sign: o signatário fica "assinado" (método provedor); com todos assinados, o contrato fica assinado;
 * - refusal: o signatário fica "recusado" e o dono do contrato e o gestor do Financeiro são avisados;
 * - auto_close: a Clicksign finalizou logo depois da ÚLTIMA assinatura: quem está no envelope conta como assinado
 *   (cobre um aviso de assinatura perdido). Quem foi incluído no contrato depois do envio continua pendente;
 * - close (finalização manual na Clicksign) e document_closed (PDF pronto): não marcam ninguém. Se o contrato não
 *   estiver assinado por todos, vira nota + aviso (finalização com assinatura parcial);
 * - cancel / deadline: nota na timeline e aviso ao dono (o contrato continua aguardando assinatura). O envelope é
 *   criado para CANCELAR, não finalizar, quando o prazo vence com assinatura parcial.
 * O PDF assinado é guardado no INTEROS (os links da Clicksign expiram).
 *
 * "Contrato assinado por todos" (documento na ficha + contract.signed) sai do estado gravado, não do aviso: qualquer
 * aviso confere se o contrato está assinado e ainda não foi anunciado, reserva o anúncio em transação (com prazo, para
 * não travar se a execução cair) e anuncia uma vez só. Assim uma falha depois de gravar a assinatura é refeita na
 * reentrega da Clicksign, e avisos simultâneos não anunciam duas vezes.
 *
 * Documento criado direto na Clicksign (sem contrato): cai na caixa de entrada, com o andamento atualizado a cada aviso.
 */
import { createHash } from "node:crypto";
import { docdb, FieldValue } from "@/server/docdb";
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
/** Reserva do anúncio "assinado por todos": depois desse prazo sem concluir, outro aviso pode anunciar. */
const ANNOUNCE_LEASE_MS = 2 * 60_000;

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

/**
 * O aviso é do envio atual do contrato? Pelo envelope gravado nos metadados (interos_envelope_id) quando vem; senão pelo
 * id do documento. Sem nenhum dos dois para comparar, vale (só a versão confere).
 */
export function hookMatchesCurrentSend(contract: Pick<Contract, "signatureEnvelopeId" | "signatureDocumentId">, hook: Pick<ClicksignWebhook, "metadata" | "documentKey">): boolean {
  const envelope = hook.metadata.interos_envelope_id;
  if (envelope) return envelope === contract.signatureEnvelopeId;
  if (hook.documentKey && contract.signatureDocumentId) return hook.documentKey === contract.signatureDocumentId;
  return true;
}

async function applyToContract(contract: Contract, hook: ClicksignWebhook): Promise<ClicksignWebhookOutcome> {
  const base = { handled: "contract" as const, contractId: contract.id };
  const version = Number(hook.metadata.interos_version);
  if (hook.metadata.interos_version && version !== contract.version) return { ...base, message: `Aviso da versão ${version} (o contrato está na versão ${contract.version}): ignorado` };
  if (!hookMatchesCurrentSend(contract, hook)) return { ...base, message: "Aviso de um envio anterior deste contrato: ignorado" };
  if (contract.status === "cancelado" || contract.status === "liberado") return { ...base, message: "Contrato encerrado: aviso ignorado" };
  const envelopeId = contract.signatureEnvelopeId;

  if (hook.event === "sign") {
    if (!hook.signer) return { ...base, message: "Aviso de assinatura sem signatário" };
    const result = await markSigners(contract.id, envelopeId, (s) => sameSigner(s, hook.signer!), "assinado", hook.occurredAt);
    if (result.stale) return { ...base, message: "Aviso de um envio anterior deste contrato: ignorado" };
    const s = result.changed[0];
    if (s) {
      await emitEvent({
        type: "note.added",
        actor: ACTOR,
        clientId: contract.clientId,
        entity: { type: "contract", id: contract.id },
        title: `${s.name} assinou o contrato ${contract.number} (Clicksign)`,
        description: `${s.role} · ${s.email} · assinado em ${formatDate(s.signedAt ?? nowIso())}`,
        department: "financeiro",
        payload: { contractId: contract.id, email: s.email, method: "provedor", provider: "clicksign", signedAt: s.signedAt, envelopeId, changes: { signer: { from: `${s.name}: pendente`, to: `${s.name}: assinado em ${formatDate(s.signedAt ?? nowIso())}` } } },
      });
    }
    const announced = await ensureSignedAnnounced(contract.id);
    if (!s) return { ...base, message: result.unknown ? `Signatário ${hook.signer.email} não está no contrato` : `Assinatura já registrada${announced ? "; contrato assinado por todos" : ""}` };
    return { ...base, message: announced ? "Assinatura registrada; contrato assinado por todos" : "Assinatura registrada" };
  }

  if (hook.event === "refusal") {
    if (!hook.signer) return { ...base, message: "Aviso de recusa sem signatário" };
    const result = await markSigners(contract.id, envelopeId, (s) => sameSigner(s, hook.signer!), "recusado", hook.occurredAt);
    if (result.stale) return { ...base, message: "Aviso de um envio anterior deste contrato: ignorado" };
    // Os outros podem ter concluído o contrato (ex.: quem recusou já tinha sido removido): anuncia se for o caso.
    await ensureSignedAnnounced(contract.id);
    // A nota/aviso da recusa sai enquanto estiver pendente no signatário: falha depois de gravar é refeita na reentrega.
    const s = result.signers.find((x) => sameSigner(x, hook.signer!) && x.status === "recusado" && x.refusalNoticePending);
    if (!s) return { ...base, message: result.unknown ? `Signatário ${hook.signer.email} não está no contrato` : "Recusa já registrada" };
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
    await clearRefusalNotice(contract.id, s.email);
    return { ...base, message: "Recusa registrada" };
  }

  if (CLOSE_EVENTS.has(hook.event)) {
    let outsiders: ContractSignerEntry[] = [];
    if (hook.event === "auto_close") {
      // Finalizado logo depois da última assinatura: quem está NO ENVELOPE assinou. Quem entrou no contrato depois do
      // envio (sem id na Clicksign) ou não aparece no documento continua pendente.
      const inEnvelope = (s: ContractSignerEntry) => Boolean(s.providerSignerId) && (hook.signers.length === 0 || hook.signers.some((h) => sameSigner(s, h)));
      const result = await markSigners(contract.id, envelopeId, (s) => s.status !== "assinado" && inEnvelope(s), "assinado", hook.finishedAt ?? hook.occurredAt);
      if (result.stale) return { ...base, message: "Aviso de um envio anterior deste contrato: ignorado" };
      outsiders = result.signers.filter((s) => s.status !== "assinado");
    } else {
      // close / document_closed não marcam ninguém; só concluem se todos do contrato já assinaram.
      const result = await markSigners(contract.id, envelopeId, () => false, "assinado", hook.finishedAt ?? hook.occurredAt);
      if (result.stale) return { ...base, message: "Aviso de um envio anterior deste contrato: ignorado" };
    }
    const announced = await ensureSignedAnnounced(contract.id);
    const now = await getById<Contract>(COLLECTIONS.contracts, contract.id);
    if (now?.signedAt) {
      const stored = await storeContractSignedFile(now, hook);
      return { ...base, message: `${announced ? "Contrato assinado por todos" : "Documento finalizado"}${stored ? " · PDF assinado guardado" : ""}` };
    }
    // Finalizado na Clicksign sem todas as assinaturas do contrato: o contrato NÃO fica assinado.
    if (hook.event === "document_closed") return { ...base, message: "Documento finalizado sem todas as assinaturas do contrato" };
    const missing = (outsiders.length ? outsiders : (now?.signers ?? contract.signers).filter((s) => s.status !== "assinado")).map((s) => s.name);
    const title = `Contrato ${contract.number} finalizado na Clicksign sem todas as assinaturas`;
    const body = `Falta${missing.length > 1 ? "m" : ""}: ${missing.join(", ") || "—"}. ${outsiders.length ? "Quem foi incluído depois do envio não recebeu o documento: gere o documento de novo para reenviar." : "Confira na Clicksign e registre a assinatura com evidência ou reenvie."}`;
    await emitEvent({ type: "note.added", actor: ACTOR, clientId: contract.clientId, entity: { type: "contract", id: contract.id }, title, description: body, department: "financeiro", payload: { contractId: contract.id, provider: "clicksign", event: hook.event, missing } });
    await warn(contract, title, body, "atencao");
    return { ...base, message: "Documento finalizado sem todas as assinaturas do contrato" };
  }

  if (hook.event === "cancel" || hook.event === "deadline") {
    // Todos do contrato já assinaram? Conclui e anuncia (pode ter faltado em um aviso anterior).
    const result = await markSigners(contract.id, envelopeId, () => false, "assinado", hook.occurredAt);
    if (result.stale) return { ...base, message: "Aviso de um envio anterior deste contrato: ignorado" };
    await ensureSignedAnnounced(contract.id);
    if (contract.signedAt || (result.signers.length > 0 && result.signers.every((s) => s.status === "assinado"))) return { ...base, message: "Contrato já assinado: aviso ignorado" };
    const title = hook.event === "cancel" ? `Documento do contrato ${contract.number} cancelado na Clicksign` : `Prazo de assinatura do contrato ${contract.number} venceu na Clicksign`;
    const body = "Gere o documento de novo para reenviar aos signatários.";
    await emitEvent({ type: "note.added", actor: ACTOR, clientId: contract.clientId, entity: { type: "contract", id: contract.id }, title, description: body, department: "financeiro", payload: { contractId: contract.id, provider: "clicksign", event: hook.event } });
    await warn(contract, title, body, "atencao");
    return { ...base, message: hook.event === "cancel" ? "Cancelamento registrado" : "Prazo vencido registrado" };
  }

  return { ...base, message: `Evento ${hook.event}: nada a fazer` };
}

interface MarkResult {
  /** O contrato foi reenviado (outro envelope) enquanto o aviso era processado: nada foi gravado. */
  stale: boolean;
  /** Signatários depois da marcação. */
  signers: ContractSignerEntry[];
  changed: ContractSignerEntry[];
  /** Nenhum signatário do contrato bateu com o aviso. */
  unknown: boolean;
}

/**
 * Marca os signatários escolhidos (em transação, conferindo que o envio ainda é o mesmo) e, com todos assinados, grava
 * o contrato como assinado (signedAt + status) — inclusive quando ninguém mudou agora (ex.: alguém pendente foi removido
 * do contrato). O anúncio fica para ensureSignedAnnounced.
 */
async function markSigners(contractId: string, envelopeId: string | undefined, pick: (s: ContractSignerEntry) => boolean, status: "assinado" | "recusado", at: string | undefined): Promise<MarkResult> {
  const ref = col(COLLECTIONS.contracts).doc(contractId);
  const when = validIso(at) ?? nowIso();
  return docdb.runTransaction(async (tx) => {
    const snap = await txGetOwn(tx, ref);
    if (!snap) throw new Error("Contrato não encontrado");
    const current = { ...(snap.data() as Omit<Contract, "id">), id: contractId } as Contract;
    if (current.signatureEnvelopeId !== envelopeId) return { stale: true, signers: current.signers, changed: [], unknown: false };
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
          : { ...s, status, registeredBy: ACTOR.id, registeredAt: now, refusalNoticePending: true };
      changed.push(next);
      return next;
    });
    const done = signers.length > 0 && signers.every((s) => s.status === "assinado");
    const completes = done && !current.signedAt && current.status !== "cancelado" && current.status !== "liberado";
    if (changed.length || completes) {
      const patch: Partial<Contract> = { signers, documentHash: current.documentHash ?? contractDocumentHash(current) };
      if (completes) {
        patch.signedAt = signers.map((s) => s.signedAt ?? "").sort().pop() || when;
        if (current.status !== "pendencia") patch.status = "assinado";
      }
      tx.update(ref, { ...patch, updatedAt: now });
    }
    return { stale: false, signers, changed, unknown: !matched };
  });
}

/**
 * Anuncia "assinado por todos" uma vez por envio, a partir do estado gravado: contrato da Clicksign com signedAt e sem
 * anúncio. A reserva (signedAnnounceClaimAt) é feita em transação; se o anúncio falhar, a reserva é desfeita e o erro
 * sobe (a rota responde 500 e a Clicksign reenvia). true quando este aviso anunciou.
 */
export async function ensureSignedAnnounced(contractId: string): Promise<boolean> {
  const ref = col(COLLECTIONS.contracts).doc(contractId);
  const claimedAt = nowIso();
  const claimed = await docdb.runTransaction(async (tx) => {
    const snap = await txGetOwn(tx, ref);
    if (!snap) return null;
    const c = { ...(snap.data() as Omit<Contract, "id">), id: contractId } as Contract;
    if (!c.signedAt || c.signatureProvider !== "clicksign" || c.signedAnnouncedAt) return null;
    if (c.status === "cancelado" || c.status === "liberado") return null;
    if (c.signedAnnounceClaimAt && Date.parse(claimedAt) - Date.parse(c.signedAnnounceClaimAt) < ANNOUNCE_LEASE_MS) return null;
    tx.update(ref, { signedAnnounceClaimAt: claimedAt });
    return c;
  });
  if (!claimed) return false;
  // "Antes" para a auditoria: aguardando assinatura (ou em pendência), sem data de assinatura.
  const before: Contract = { ...claimed, status: claimed.status === "pendencia" ? "pendencia" : "aguardando_assinatura", signedAt: undefined };
  const patch: Partial<Contract> = { status: claimed.status, signedAt: claimed.signedAt };
  try {
    await announceContractSigned(before, patch, { method: "provedor", signerCount: claimed.signers.length, documentHash: claimed.documentHash ?? contractDocumentHash(claimed) }, ACTOR);
  } catch (error) {
    await ref.update({ signedAnnounceClaimAt: FieldValue.delete() }).catch(() => undefined);
    throw error;
  }
  return true;
}

/** Nota/aviso da recusa registrados: tira a pendência do signatário (em transação, sem sobrescrever outros avisos). */
async function clearRefusalNotice(contractId: string, email: string): Promise<void> {
  const ref = col(COLLECTIONS.contracts).doc(contractId);
  await docdb.runTransaction(async (tx) => {
    const snap = await txGetOwn(tx, ref);
    if (!snap) return;
    const current = snap.data() as unknown as Contract;
    if (!current.signers.some((s) => s.email === email && s.refusalNoticePending)) return;
    tx.update(ref, { signers: current.signers.map((s) => (s.email === email ? { ...s, refusalNoticePending: false } : s)), updatedAt: nowIso() });
  });
}

/** Avisa o dono do contrato e o gestor do Financeiro. Falha no aviso não desfaz o que já foi registrado. */
async function warn(contract: Contract, title: string, body: string, kind: "atencao" | "informativa"): Promise<void> {
  try {
    const manager = await getDepartmentManager("financeiro").catch(() => null);
    await notify({ userIds: [contract.ownerId ?? "", manager?.id ?? ""], kind, title, body, href: `/financeiro/contratos/${contract.id}`, entity: { type: "contract", id: contract.id } });
  } catch (error) {
    console.error("[clicksign] falha ao notificar", error);
  }
}

// ---------------------------------------------------------------------------
// PDF assinado guardado no INTEROS
// ---------------------------------------------------------------------------

/**
 * Um arquivo por envio (o envelope identifica o envio): um reenvio não reaproveita o PDF do envio anterior, e um aditivo
 * (versão nova, mesmo envelope assinado) continua achando o PDF.
 */
export function contractSignedFileId(contract: Pick<Contract, "id" | "signatureEnvelopeId">): string {
  return `contract_${contract.id}_${(contract.signatureEnvelopeId ?? "").replace(/[^A-Za-z0-9_-]/g, "")}`;
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

/** Guarda o PDF assinado do contrato (uma vez por envio). true quando o arquivo está guardado. */
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
    // Só a finalização automática (logo depois da última assinatura) garante que todos assinaram.
    const at = signedAt.get(email) ?? (hook.event === "auto_close" ? when : undefined);
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
