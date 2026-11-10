import "server-only";
/**
 * Comprovantes do consentimento LGPD do lead (prints, PDFs, áudios, e-mails…). Regras em
 * src/domain/consent-evidence.ts; arquivos em partes em src/server/files/store.ts.
 *
 * Fluxo: o navegador calcula o SHA-256, abre o envio (startConsentEvidenceUpload), manda as partes de 2 MB
 * (putConsentEvidenceChunk) e conclui (completeConsentEvidenceUpload: o servidor confere tamanho e SHA-256 e registra
 * o evento no histórico do lead). Remover exige motivo, apaga o conteúdo e a miniatura e deixa o registro.
 * Autorização (chave + escopo do lead) fica nas rotas e na action; aqui só as regras.
 */
import { getById } from "@/server/db";
import { emitEvent } from "@/server/events";
import { can } from "@/server/auth/permissions";
import { PermissionError } from "@/server/auth/error-classes";
import { isUserFacingError } from "@/server/auth/errors";
import { completeFile, createPendingFile, discardRetriedPending, getOwnedFile, listOwnerFiles, removeFile, writeChunk, type StoredFileRef } from "@/server/files/store";
import {
  CONSENT_EVIDENCE_MAX_FILES,
  CONSENT_EVIDENCE_REASON_MIN,
  canRemoveConsentEvidence,
  consentEvidenceMimeType,
  consentEvidenceProblem,
  isInlineEvidenceType,
  isValidEvidenceThumbnail,
} from "@/domain/consent-evidence";
import { SHA256_TAG, STORED_FILE_PENDING_TTL_MS, formatBytes, safeFileName } from "@/domain/stored-files";
import { COLLECTIONS, type CurrentUser, type Lead, type StoredFile, type UserRef } from "@/domain/types";
import { MarketingError } from "./service";

const OWNER = "lead_consent" as const;

/** Comprovante como a ficha do lead mostra (ativos e removidos; envios não concluídos ficam de fora). */
export interface ConsentEvidenceRow {
  id: string;
  name: string;
  mimeType: string;
  size: number;
  sha256: string;
  chunkCount: number;
  thumbnail?: string;
  uploadedByName: string;
  completedAt: string;
  status: "ativo" | "removido";
  removedAt?: string;
  removedByName?: string;
  removedReason?: string;
  /** O navegador mostra o arquivo (imagem, PDF, áudio, vídeo, texto); os demais só baixam. */
  inline: boolean;
  /** Quem está vendo pode remover agora (servidor confere de novo). */
  removable: boolean;
}

/** Permissões de quem está vendo/agindo, avaliadas uma vez. */
export interface EvidenceViewer {
  id: string;
  canRemoveAny: boolean;
  canRemoveOwn: boolean;
}

export function evidenceViewer(user: CurrentUser): EvidenceViewer {
  return {
    id: user.id,
    canRemoveAny: can(user, "marketing.leads.consentimento.remover"),
    canRemoveOwn: can(user, "marketing.leads.consentimento.anexar"),
  };
}

function ref(leadId: string, fileId: string): StoredFileRef {
  return { ownerKind: OWNER, ownerId: leadId, fileId };
}

function removableBy(viewer: EvidenceViewer, file: StoredFile, now: Date): boolean {
  return canRemoveConsentEvidence({ ...viewer, viewerId: viewer.id, uploadedById: file.uploadedById, completedAt: file.completedAt, now });
}

export function toEvidenceRow(file: StoredFile, viewer: EvidenceViewer, now = new Date()): ConsentEvidenceRow {
  const active = file.status === "ativo";
  return {
    id: file.id,
    name: file.name,
    mimeType: file.mimeType,
    size: file.size,
    sha256: file.sha256,
    chunkCount: file.chunkCount,
    thumbnail: active ? file.thumbnail : undefined,
    uploadedByName: file.uploadedByName,
    completedAt: file.completedAt ?? file.createdAt,
    status: active ? "ativo" : "removido",
    removedAt: file.removedAt,
    removedByName: file.removedByName,
    removedReason: file.removedReason,
    inline: isInlineEvidenceType(file.mimeType),
    removable: active && removableBy(viewer, file, now),
  };
}

/** Comprovantes do lead para a ficha: os mais recentes primeiro; removidos depois, com o registro da remoção. */
export async function listConsentEvidence(leadId: string, viewer: EvidenceViewer, now = new Date()): Promise<ConsentEvidenceRow[]> {
  const files = await listOwnerFiles(OWNER, leadId);
  return files
    .filter((f) => f.status === "ativo" || (f.status === "removido" && f.completedAt))
    .map((f) => toEvidenceRow(f, viewer, now))
    .sort((a, b) => Number(a.status === "removido") - Number(b.status === "removido") || b.completedAt.localeCompare(a.completedAt));
}

/** Comprovante ativo do lead (download). null = não existe, é de outro lead ou foi removido. */
export async function getActiveConsentEvidence(leadId: string, fileId: string): Promise<StoredFile | null> {
  const file = await getOwnedFile(ref(leadId, fileId));
  return file && file.status === "ativo" ? file : null;
}

async function loadLead(leadId: string): Promise<Lead> {
  const lead = await getById<Lead>(COLLECTIONS.leads, leadId);
  if (!lead) throw new MarketingError("Lead não encontrado");
  return lead;
}

export interface StartConsentEvidenceInput {
  name: string;
  size: number;
  sha256: string;
  thumbnail?: string;
}

/**
 * Abre o envio de um comprovante: tipo e tamanho aceitos, sem repetir um arquivo já anexado (mesmo SHA-256) e dentro
 * do limite de comprovantes do lead. Uma nova tentativa do mesmo arquivo pela mesma pessoa descarta a anterior.
 */
export async function startConsentEvidenceUpload(leadId: string, input: StartConsentEvidenceInput, actor: UserRef, now = new Date()): Promise<StoredFile> {
  await loadLead(leadId);
  const name = safeFileName(input.name);
  const problem = consentEvidenceProblem({ name, size: input.size });
  if (problem) throw new MarketingError(problem);
  const mimeType = consentEvidenceMimeType(name);
  if (!mimeType) throw new MarketingError("Tipo de arquivo não aceito.");
  if (!SHA256_TAG.test(input.sha256)) throw new MarketingError("Não foi possível identificar o arquivo (SHA-256). Tente de novo.");
  await discardRetriedPending(OWNER, leadId, actor.id, input.sha256);
  const files = await listOwnerFiles(OWNER, leadId);
  const same = files.find((f) => f.status === "ativo" && f.sha256 === input.sha256);
  if (same) throw new MarketingError(`Este arquivo já está anexado a este lead (${same.name}).`);
  const staleBefore = new Date(now.getTime() - STORED_FILE_PENDING_TTL_MS).toISOString();
  const open = files.filter((f) => f.status === "ativo" || (f.status === "enviando" && f.createdAt > staleBefore));
  if (open.length >= CONSENT_EVIDENCE_MAX_FILES) throw new MarketingError(`Este lead já tem ${CONSENT_EVIDENCE_MAX_FILES} comprovantes (o limite). Remova um para anexar outro.`);
  return createPendingFile({
    ownerKind: OWNER,
    ownerId: leadId,
    name,
    mimeType,
    size: input.size,
    sha256: input.sha256,
    // Miniatura fora do formato é só ignorada (é um enfeite da lista, não o comprovante).
    thumbnail: input.thumbnail && isValidEvidenceThumbnail(input.thumbnail) ? input.thumbnail : undefined,
    uploadedBy: actor,
  });
}

export async function putConsentEvidenceChunk(leadId: string, fileId: string, index: number, bytes: Uint8Array, actor: UserRef): Promise<void> {
  await writeChunk(ref(leadId, fileId), index, bytes, actor.id);
}

/** Conclui o envio (servidor confere tamanho e SHA-256) e registra no histórico do lead na primeira conclusão. */
export async function completeConsentEvidenceUpload(leadId: string, fileId: string, actor: UserRef): Promise<StoredFile> {
  const { file, completed } = await completeFile(ref(leadId, fileId), actor.id);
  if (completed) {
    const lead = await getById<Lead>(COLLECTIONS.leads, leadId);
    await emitEvent({
      type: "lead.consent_evidence_added",
      actor,
      clientId: lead?.clientId,
      entity: { type: "lead", id: leadId },
      title: `Comprovante do consentimento LGPD anexado: ${file.name}`,
      description: `${formatBytes(file.size)} · ${file.sha256}`,
      department: "marketing",
      payload: { fileId: file.id, name: file.name, mimeType: file.mimeType, size: file.size, sha256: file.sha256 },
    });
  }
  return file;
}

/**
 * Remove um comprovante: motivo obrigatório; quem tem a chave de remover pode sempre, quem anexou só na primeira hora.
 * O conteúdo e a miniatura são apagados; ficam nome, tamanho, SHA-256, quem anexou e quem removeu, quando e por quê.
 */
export async function removeConsentEvidence(leadId: string, fileId: string, reason: string, actor: UserRef, viewer: EvidenceViewer, now = new Date()): Promise<StoredFile> {
  const why = reason.trim();
  if (why.length < CONSENT_EVIDENCE_REASON_MIN) throw new MarketingError(`Informe o motivo da remoção (mínimo de ${CONSENT_EVIDENCE_REASON_MIN} caracteres).`);
  const lead = await loadLead(leadId);
  const file = await removeFile(
    ref(leadId, fileId),
    actor,
    why,
    (f) => removableBy(viewer, f, now),
    () => new PermissionError("Só quem anexou (na primeira hora) ou quem tem permissão para remover comprovantes pode remover este arquivo."),
  );
  await emitEvent({
    type: "lead.consent_evidence_removed",
    actor,
    clientId: lead.clientId,
    entity: { type: "lead", id: leadId },
    title: `Comprovante do consentimento LGPD removido: ${file.name}`,
    description: `Motivo: ${why}`,
    department: "marketing",
    payload: { fileId: file.id, name: file.name, size: file.size, sha256: file.sha256, reason: why, uploadedByName: file.uploadedByName },
  });
  return file;
}

/** Erro das rotas de comprovante: permissão → 403; regra de negócio → 400 com a mensagem; o resto vai para o log. */
export function evidenceErrorResponse(error: unknown, fallback: string): Response {
  if (error instanceof PermissionError) return Response.json({ ok: false, error: error.message }, { status: 403 });
  if (isUserFacingError(error)) return Response.json({ ok: false, error: error.message }, { status: 400 });
  console.error(`[comprovantes LGPD] ${fallback}`, error);
  return Response.json({ ok: false, error: fallback }, { status: 500 });
}
