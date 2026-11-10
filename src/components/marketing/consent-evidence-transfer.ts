/**
 * Comprovantes do consentimento LGPD no navegador: preparar o arquivo (nome, miniatura, SHA-256), enviar em partes,
 * remontar para abrir/baixar e conferir o SHA-256. Servidor: src/app/api/marketing/leads/[id]/consentimento.
 * Por que em partes: limite de ~4,5 MB por requisição/resposta na Vercel (src/domain/stored-files.ts).
 */
import { CONSENT_EVIDENCE_THUMB_MAX_CHARS, consentEvidenceMimeType, extensionForMimeType, isThumbnailableType } from "@/domain/consent-evidence";
import { STORED_FILE_DIRECT_MAX_BYTES, sha256Tag } from "@/domain/stored-files";
import type { ConsentEvidenceRow } from "@/server/marketing/consent-evidence";

export type { ConsentEvidenceRow };

/** Falha de envio/leitura com a mensagem para o usuário. `retryable`: vale tentar de novo (rede, 5xx, 429). */
export class TransferError extends Error {
  constructor(
    message: string,
    readonly retryable = false,
  ) {
    super(message);
    this.name = "TransferError";
  }
}

export interface TransferProgress {
  done: number;
  total: number;
}

const ATTEMPTS = 3;

function apiBase(leadId: string): string {
  return `/api/marketing/leads/${encodeURIComponent(leadId)}/consentimento`;
}

/** Endereço do comprovante (arquivo inteiro). `download` força baixar. */
export function evidenceUrl(leadId: string, fileId: string, download = false): string {
  return `${apiBase(leadId)}/${encodeURIComponent(fileId)}${download ? "?download=1" : ""}`;
}

function wait(ms: number, signal?: AbortSignal): Promise<void> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(resolve, ms);
    signal?.addEventListener("abort", () => {
      clearTimeout(timer);
      reject(new TransferError("Envio cancelado."));
    });
  });
}

/** Repete a operação em falhas de rede/servidor (1 s, 2 s); regra de negócio (4xx) não repete. */
async function withRetry<T>(run: () => Promise<T>, signal?: AbortSignal): Promise<T> {
  let last: unknown;
  for (let attempt = 1; attempt <= ATTEMPTS; attempt++) {
    try {
      return await run();
    } catch (error) {
      last = error;
      const retryable = error instanceof TransferError ? error.retryable : !(error instanceof DOMException && error.name === "AbortError");
      if (!retryable || attempt === ATTEMPTS || signal?.aborted) break;
      await wait(1000 * attempt, signal);
    }
  }
  if (last instanceof TransferError) throw last;
  if (signal?.aborted || (last instanceof DOMException && last.name === "AbortError")) throw new TransferError("Envio cancelado.");
  throw new TransferError("Falha de conexão com o servidor. Verifique a internet e tente de novo.", true);
}

async function failure(response: Response): Promise<TransferError> {
  let message: string | undefined;
  try {
    const body = (await response.json()) as { error?: string };
    message = body.error;
  } catch {
    message = undefined;
  }
  const retryable = response.status >= 500 || response.status === 429;
  if (response.status === 401) return new TransferError("Sua sessão expirou. Entre novamente e anexe o arquivo de novo.");
  return new TransferError(message ?? `Falha na comunicação com o servidor (${response.status}).`, retryable);
}

async function json<T>(response: Response): Promise<T> {
  if (!response.ok) throw await failure(response);
  const body = (await response.json()) as { ok?: boolean; data?: T; error?: string };
  if (!body.ok) throw new TransferError(body.error ?? "O servidor recusou a operação.");
  return body.data as T;
}

// ---------------------------------------------------------------------------
// Preparar o arquivo
// ---------------------------------------------------------------------------

function pad(n: number): string {
  return String(n).padStart(2, "0");
}

/**
 * Nome final do arquivo: print colado ("image.png") vira "print-AAAA-MM-DD-HHhMMmSSs.png"; sem extensão ganha a do
 * tipo informado pelo navegador (quando é um tipo aceito).
 */
export function normalizeEvidenceFile(file: File, now = new Date()): File {
  let name = file.name.trim() || "arquivo";
  if (!consentEvidenceMimeType(name) && !/\.[a-z0-9]{1,8}$/i.test(name)) {
    const ext = extensionForMimeType(file.type);
    if (ext) name = `${name}.${ext}`;
  }
  const pasted = /^image\.(png|jpe?g|gif|webp)$/i.exec(name);
  if (pasted) name = `print-${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}-${pad(now.getHours())}h${pad(now.getMinutes())}m${pad(now.getSeconds())}s.${pasted[1].toLowerCase()}`;
  return name === file.name ? file : new File([file], name, { type: file.type, lastModified: file.lastModified });
}

/** SHA-256 do conteúdo no formato gravado ("sha256:<hex>"). */
export async function sha256OfBlob(blob: Blob): Promise<string> {
  if (typeof crypto === "undefined" || !crypto.subtle) throw new TransferError("Este navegador não consegue conferir o arquivo nesta conexão. Use o endereço com https.");
  const digest = await crypto.subtle.digest("SHA-256", await blob.arrayBuffer());
  return sha256Tag(Array.from(new Uint8Array(digest), (b) => b.toString(16).padStart(2, "0")).join(""));
}

/** Miniatura JPEG (até 320 px) das imagens, só para a lista. Sem miniatura quando o navegador não consegue gerar. */
export async function makeThumbnail(file: Blob, mimeType: string): Promise<string | undefined> {
  if (!isThumbnailableType(mimeType) || typeof createImageBitmap !== "function" || typeof document === "undefined") return undefined;
  try {
    const bitmap = await createImageBitmap(file);
    const scale = Math.min(1, 320 / Math.max(bitmap.width, bitmap.height, 1));
    const canvas = document.createElement("canvas");
    canvas.width = Math.max(1, Math.round(bitmap.width * scale));
    canvas.height = Math.max(1, Math.round(bitmap.height * scale));
    const ctx = canvas.getContext("2d");
    if (!ctx) return undefined;
    // PNG transparente: fundo branco (o JPEG não tem transparência).
    ctx.fillStyle = "#ffffff";
    ctx.fillRect(0, 0, canvas.width, canvas.height);
    ctx.drawImage(bitmap, 0, 0, canvas.width, canvas.height);
    bitmap.close();
    for (const quality of [0.75, 0.55, 0.4]) {
      const url = canvas.toDataURL("image/jpeg", quality);
      if (url.length <= CONSENT_EVIDENCE_THUMB_MAX_CHARS) return url;
    }
    return undefined;
  } catch {
    return undefined;
  }
}

// ---------------------------------------------------------------------------
// Enviar
// ---------------------------------------------------------------------------

export interface UploadOptions {
  thumbnail?: string;
  onProgress?: (progress: TransferProgress) => void;
  signal?: AbortSignal;
}

/**
 * Envia um comprovante: SHA-256 → abre o envio → partes de 2 MB (cada uma com até 3 tentativas) → conclui (o servidor
 * confere tamanho e SHA-256). Devolve o comprovante como a ficha mostra.
 */
export async function uploadConsentEvidence(leadId: string, file: File, options: UploadOptions = {}): Promise<ConsentEvidenceRow> {
  const { onProgress, signal } = options;
  const mimeType = consentEvidenceMimeType(file.name) ?? "";
  const [sha256, thumbnail] = await Promise.all([sha256OfBlob(file), options.thumbnail ? Promise.resolve(options.thumbnail) : makeThumbnail(file, mimeType)]);
  const started = await withRetry(
    async () =>
      json<{ id: string; chunkSize: number; chunkCount: number }>(
        await fetch(apiBase(leadId), { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ name: file.name, size: file.size, sha256, thumbnail }), signal }),
      ),
    signal,
  );
  onProgress?.({ done: 0, total: file.size });
  const target = `${apiBase(leadId)}/${encodeURIComponent(started.id)}`;
  for (let index = 0; index < started.chunkCount; index++) {
    const end = Math.min(file.size, (index + 1) * started.chunkSize);
    const part = file.slice(index * started.chunkSize, end);
    await withRetry(async () => json(await fetch(`${target}?parte=${index}`, { method: "PUT", headers: { "content-type": "application/octet-stream" }, body: part, signal })), signal);
    onProgress?.({ done: end, total: file.size });
  }
  return withRetry(async () => json<ConsentEvidenceRow>(await fetch(target, { method: "POST", signal })), signal);
}

// ---------------------------------------------------------------------------
// Abrir e baixar
// ---------------------------------------------------------------------------

type EvidenceFile = Pick<ConsentEvidenceRow, "id" | "name" | "mimeType" | "size" | "chunkCount" | "sha256">;

/** Arquivo pequeno abre/baixa por link direto; o grande é remontado parte a parte no navegador. */
export function isDirectEvidence(file: Pick<ConsentEvidenceRow, "size">): boolean {
  return file.size <= STORED_FILE_DIRECT_MAX_BYTES;
}

/** Remonta o arquivo parte a parte e confere tamanho e SHA-256. */
export async function fetchEvidenceBlob(leadId: string, file: EvidenceFile, onProgress?: (progress: TransferProgress) => void): Promise<Blob> {
  const parts: ArrayBuffer[] = [];
  let received = 0;
  for (let index = 0; index < file.chunkCount; index++) {
    const buffer = await withRetry(async () => {
      const response = await fetch(`${evidenceUrl(leadId, file.id)}?parte=${index}`);
      if (!response.ok) throw await failure(response);
      return response.arrayBuffer();
    });
    parts.push(buffer);
    received += buffer.byteLength;
    onProgress?.({ done: received, total: file.size });
  }
  const blob = new Blob(parts, { type: file.mimeType });
  if (blob.size !== file.size || (await sha256OfBlob(blob)) !== file.sha256) throw new TransferError("O arquivo recebido não confere com o original (SHA-256). Tente de novo.");
  return blob;
}

/** Baixa um arquivo já remontado com o nome original. */
export function saveBlob(blob: Blob, name: string): void {
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = name;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 60_000);
}
