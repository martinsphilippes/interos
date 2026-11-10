/**
 * Comprovantes do consentimento LGPD no navegador: preparar o arquivo (nome, miniatura, SHA-256), enviar em partes,
 * remontar para abrir/baixar e conferir o SHA-256. Servidor: src/app/api/marketing/leads/[id]/consentimento.
 * O envio e a remontagem em partes são genéricos (src/components/files/stored-file-transfer.ts).
 */
import { CONSENT_EVIDENCE_THUMB_MAX_CHARS, consentEvidenceMimeType, extensionForMimeType } from "@/domain/consent-evidence";
import { STORED_FILE_DIRECT_MAX_BYTES } from "@/domain/stored-files";
import { fetchPartsBlob, imageThumbnail, normalizePickedFile, sha256OfBlob, uploadInParts, type TransferProgress, type UploadOptions } from "@/components/files/stored-file-transfer";
import type { ConsentEvidenceRow } from "@/server/marketing/consent-evidence";

export type { ConsentEvidenceRow };
export { TransferError, saveBlob, sha256OfBlob, type TransferProgress, type UploadOptions } from "@/components/files/stored-file-transfer";

function apiBase(leadId: string): string {
  return `/api/marketing/leads/${encodeURIComponent(leadId)}/consentimento`;
}

/** Endereço do comprovante (arquivo inteiro). `download` força baixar. */
export function evidenceUrl(leadId: string, fileId: string, download = false): string {
  return `${apiBase(leadId)}/${encodeURIComponent(fileId)}${download ? "?download=1" : ""}`;
}

/**
 * Nome final do arquivo: print colado ("image.png") vira "print-AAAA-MM-DD-HHhMMmSSs.png"; sem extensão ganha a do
 * tipo informado pelo navegador (quando é um tipo aceito).
 */
export function normalizeEvidenceFile(file: File, now = new Date()): File {
  return normalizePickedFile(file, consentEvidenceMimeType, extensionForMimeType, now);
}

/** Miniatura do arquivo, gerada uma vez só (a lista e o envio usam a mesma). */
export function thumbnailOf(file: File): Promise<string | undefined> {
  return imageThumbnail(file, consentEvidenceMimeType(file.name) ?? "", CONSENT_EVIDENCE_THUMB_MAX_CHARS);
}

/**
 * Envia um comprovante: SHA-256 → abre o envio → partes de 2 MB (cada uma com até 3 tentativas e tempo-limite) →
 * conclui (o servidor confere tamanho e SHA-256). Devolve o comprovante como a ficha mostra.
 */
export async function uploadConsentEvidence(leadId: string, file: File, options: UploadOptions = {}): Promise<ConsentEvidenceRow> {
  const [sha256, thumbnail] = await Promise.all([sha256OfBlob(file), thumbnailOf(file)]);
  return uploadInParts<ConsentEvidenceRow>(apiBase(leadId), file, { name: file.name, size: file.size, sha256, thumbnail }, options);
}

type EvidenceFile = Pick<ConsentEvidenceRow, "id" | "name" | "mimeType" | "size" | "chunkCount" | "sha256">;

/** Arquivo pequeno abre/baixa por link direto; o grande é remontado parte a parte no navegador. */
export function isDirectEvidence(file: Pick<ConsentEvidenceRow, "size">): boolean {
  return file.size <= STORED_FILE_DIRECT_MAX_BYTES;
}

/** Remonta o arquivo parte a parte e confere tamanho e SHA-256. */
export async function fetchEvidenceBlob(leadId: string, file: EvidenceFile, onProgress?: (progress: TransferProgress) => void): Promise<Blob> {
  return fetchPartsBlob(evidenceUrl(leadId, file.id), file, onProgress);
}
