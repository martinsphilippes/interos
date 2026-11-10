/**
 * Comprovantes do consentimento LGPD do lead (prints, PDFs, áudios, vídeos, e-mails e documentos).
 *
 * A LGPD (art. 8º, § 2º) põe na empresa o ônus de provar que o consentimento foi obtido. Cada comprovante fica
 * guardado no INTEROS (banco no Brasil, sem link público) com quem anexou, quando e o SHA-256 do arquivo; remover
 * deixa registro (quem, quando e por quê) e apaga o conteúdo.
 *
 * Regras puras: valem no navegador (antes de enviar) e no servidor (que confere tudo de novo).
 */
import { canRemoveUpload, fileExtension, formatBytes } from "./stored-files";

/** Tamanho máximo de cada arquivo. */
export const CONSENT_EVIDENCE_MAX_BYTES = 50 * 1024 * 1024;

/** Comprovantes por lead (ativos + envios em andamento). */
export const CONSENT_EVIDENCE_MAX_FILES = 20;

/** Miniatura (data URL gerada no navegador, só para a lista): limite de caracteres. */
export const CONSENT_EVIDENCE_THUMB_MAX_CHARS = 60_000;

/** Quem anexou pode remover o próprio comprovante nesta janela; depois, só quem tem a chave de remover. */
export const CONSENT_EVIDENCE_UNDO_MS = 60 * 60 * 1000;

/** Motivo da remoção: mínimo de caracteres. */
export const CONSENT_EVIDENCE_REASON_MIN = 5;

/**
 * Extensão → tipo do arquivo. O tipo gravado e servido vem SEMPRE daqui (nunca do navegador): sem HTML, SVG ou
 * scripts, nada do que é servido roda como página.
 */
export const CONSENT_EVIDENCE_TYPES: Readonly<Record<string, string>> = {
  png: "image/png",
  jpg: "image/jpeg",
  jpeg: "image/jpeg",
  webp: "image/webp",
  gif: "image/gif",
  heic: "image/heic",
  heif: "image/heif",
  pdf: "application/pdf",
  mp3: "audio/mpeg",
  m4a: "audio/mp4",
  aac: "audio/aac",
  ogg: "audio/ogg",
  oga: "audio/ogg",
  opus: "audio/ogg",
  wav: "audio/wav",
  amr: "audio/amr",
  mp4: "video/mp4",
  mov: "video/quicktime",
  webm: "video/webm",
  "3gp": "video/3gpp",
  eml: "message/rfc822",
  msg: "application/vnd.ms-outlook",
  txt: "text/plain",
  doc: "application/msword",
  docx: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  odt: "application/vnd.oasis.opendocument.text",
};

/** Para o `accept` do seletor de arquivos. */
export const CONSENT_EVIDENCE_ACCEPT = Object.keys(CONSENT_EVIDENCE_TYPES)
  .map((ext) => `.${ext}`)
  .join(",");

/** Tipos que o navegador mostra (Abrir); os demais só baixam. */
const INLINE_TYPES = new Set(["image/png", "image/jpeg", "image/webp", "image/gif", "application/pdf", "audio/mpeg", "audio/mp4", "audio/aac", "audio/ogg", "audio/wav", "video/mp4", "video/webm", "text/plain"]);

export function isInlineEvidenceType(mimeType: string): boolean {
  return INLINE_TYPES.has(mimeType);
}

/** Imagens que viram miniatura no navegador. */
export function isThumbnailableType(mimeType: string): boolean {
  return mimeType === "image/png" || mimeType === "image/jpeg" || mimeType === "image/webp" || mimeType === "image/gif";
}

export type ConsentEvidenceKind = "imagem" | "pdf" | "audio" | "video" | "email" | "documento";

export function consentEvidenceKind(mimeType: string): ConsentEvidenceKind {
  if (mimeType.startsWith("image/")) return "imagem";
  if (mimeType === "application/pdf") return "pdf";
  if (mimeType.startsWith("audio/")) return "audio";
  if (mimeType.startsWith("video/")) return "video";
  if (mimeType === "message/rfc822" || mimeType === "application/vnd.ms-outlook") return "email";
  return "documento";
}

/** Tipo aceito pelo nome do arquivo (null = extensão não aceita). */
export function consentEvidenceMimeType(name: string): string | null {
  return CONSENT_EVIDENCE_TYPES[fileExtension(name)] ?? null;
}

/** Extensão para um arquivo sem extensão, a partir do tipo informado pelo navegador (ex.: print colado). */
export function extensionForMimeType(mimeType: string): string | null {
  const preferred: Record<string, string> = { "image/jpeg": "jpg", "audio/ogg": "ogg", "audio/mp4": "m4a" };
  if (preferred[mimeType]) return preferred[mimeType];
  const found = Object.entries(CONSENT_EVIDENCE_TYPES).find(([, type]) => type === mimeType);
  return found ? found[0] : null;
}

/** O que impede anexar o arquivo (null = pode anexar). */
export function consentEvidenceProblem(file: { name: string; size: number }): string | null {
  if (!consentEvidenceMimeType(file.name)) {
    const ext = fileExtension(file.name);
    return `${ext ? `Arquivos .${ext}` : "Arquivos sem extensão"} não são aceitos. Use imagem, PDF, áudio, vídeo, e-mail ou documento.`;
  }
  if (!Number.isFinite(file.size) || file.size <= 0) return "O arquivo está vazio.";
  if (file.size > CONSENT_EVIDENCE_MAX_BYTES) return `O arquivo tem ${formatBytes(file.size)}; o limite é ${formatBytes(CONSENT_EVIDENCE_MAX_BYTES)} por arquivo.`;
  return null;
}

/** Miniatura aceita: data URL de imagem (JPEG, PNG ou WebP) em base64, dentro do limite. */
export function isValidEvidenceThumbnail(value: string): boolean {
  return value.length <= CONSENT_EVIDENCE_THUMB_MAX_CHARS && /^data:image\/(jpeg|png|webp);base64,[A-Za-z0-9+/]+={0,2}$/.test(value);
}

/**
 * Pode remover o comprovante? Quem tem a chave de remover (`canRemoveAny`), sempre; quem anexou e ainda pode anexar
 * (`canRemoveOwn`), só na primeira hora depois de concluir o envio — para corrigir um anexo errado sem depender do
 * gestor.
 */
export function canRemoveConsentEvidence(input: { canRemoveAny: boolean; canRemoveOwn: boolean; viewerId: string; uploadedById: string; completedAt?: string; now: Date }): boolean {
  return canRemoveUpload({ ...input, undoMs: CONSENT_EVIDENCE_UNDO_MS });
}
