/**
 * Arquivos guardados em partes no navegador (genérico): preparar o arquivo (nome, miniatura, SHA-256), enviar em
 * partes de 2 MB com novas tentativas e tempo-limite, remontar parte a parte conferindo o SHA-256 e baixar.
 * Quem usa: comprovantes do consentimento LGPD (src/components/marketing/consent-evidence-transfer.ts) e documentos do
 * cliente (src/components/clients/client-document-upload.tsx). Servidor: src/server/files/store.ts.
 * Por que em partes: limite de ~4,5 MB por requisição na Vercel (src/domain/stored-files.ts).
 */
import { sha256Tag } from "@/domain/stored-files";

/**
 * Falha de envio/leitura com a mensagem para o usuário. `retryable`: vale tentar de novo (rede, conexão parada, 5xx,
 * 429, cancelado pelo usuário); regra de negócio (tipo, limite, já anexado, permissão) não.
 */
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
/** Sem resposta neste tempo (incluindo receber o corpo), a requisição é dada como parada e tentada de novo. */
const REQUEST_TIMEOUT_MS = 120_000;
const CANCELLED = "Envio cancelado.";

function wait(ms: number, signal?: AbortSignal): Promise<void> {
  return new Promise((resolve, reject) => {
    if (signal?.aborted) {
      reject(new TransferError(CANCELLED, true));
      return;
    }
    const timer = setTimeout(resolve, ms);
    signal?.addEventListener("abort", () => {
      clearTimeout(timer);
      reject(new TransferError(CANCELLED, true));
    });
  });
}

async function failure(response: Response): Promise<TransferError> {
  let message: string | undefined;
  try {
    const body = (await response.json()) as { error?: string };
    message = body.error;
  } catch {
    message = undefined;
  }
  if (response.status === 401) return new TransferError("Sua sessão expirou. Entre novamente no INTEROS.");
  const retryable = response.status >= 500 || response.status === 429 || response.status === 408;
  return new TransferError(message ?? `Falha na comunicação com o servidor (${response.status}).`, retryable);
}

/**
 * Uma requisição com tempo-limite (resposta e corpo): conexão parada vira erro que vale repetir; cancelar pelo usuário
 * (`signal`) não repete nesta rodada, mas pode ser reenviado depois.
 */
async function request<T>(url: string, init: RequestInit, read: (response: Response) => Promise<T>, signal?: AbortSignal): Promise<T> {
  if (signal?.aborted) throw new TransferError(CANCELLED, true);
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
  const onAbort = () => controller.abort();
  signal?.addEventListener("abort", onAbort);
  try {
    const response = await fetch(url, { ...init, signal: controller.signal });
    if (!response.ok) throw await failure(response);
    return await read(response);
  } catch (error) {
    if (error instanceof TransferError) throw error;
    if (signal?.aborted) throw new TransferError(CANCELLED, true);
    if (controller.signal.aborted) throw new TransferError("A conexão parou de responder. Verifique a internet e tente de novo.", true);
    throw new TransferError("Falha de conexão com o servidor. Verifique a internet e tente de novo.", true);
  } finally {
    clearTimeout(timer);
    signal?.removeEventListener("abort", onAbort);
  }
}

async function readJson<T>(response: Response): Promise<T> {
  const body = (await response.json()) as { ok?: boolean; data?: T; error?: string };
  if (!body.ok) throw new TransferError(body.error ?? "O servidor recusou a operação.");
  return body.data as T;
}

/** Repete em falhas que valem nova tentativa (1 s, 2 s); cancelado pelo usuário ou regra de negócio param na hora. */
async function withRetry<T>(run: () => Promise<T>, signal?: AbortSignal): Promise<T> {
  let last: unknown;
  for (let attempt = 1; attempt <= ATTEMPTS; attempt++) {
    try {
      return await run();
    } catch (error) {
      last = error;
      const retryable = error instanceof TransferError && error.retryable;
      if (!retryable || attempt === ATTEMPTS || signal?.aborted) break;
      await wait(1000 * attempt, signal);
    }
  }
  if (last instanceof TransferError) throw last;
  throw new TransferError("Falha de conexão com o servidor. Verifique a internet e tente de novo.", true);
}

// ---------------------------------------------------------------------------
// Preparar o arquivo
// ---------------------------------------------------------------------------

function pad(n: number): string {
  return String(n).padStart(2, "0");
}

/**
 * Nome final do arquivo escolhido: print colado ("image.png") vira "print-AAAA-MM-DD-HHhMMmSSs.png"; sem extensão
 * ganha a do tipo informado pelo navegador, quando é um tipo aceito (`mimeTypeOf` diz se o nome é aceito e
 * `extensionFor` traduz o tipo do navegador).
 */
export function normalizePickedFile(file: File, mimeTypeOf: (name: string) => string | null, extensionFor: (mimeType: string) => string | null, now = new Date()): File {
  let name = file.name.trim() || "arquivo";
  if (!mimeTypeOf(name) && !/\.[a-z0-9]{1,8}$/i.test(name)) {
    const ext = extensionFor(file.type);
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

/** Imagens que viram miniatura no navegador. */
export function isThumbnailableImage(mimeType: string): boolean {
  return mimeType === "image/png" || mimeType === "image/jpeg" || mimeType === "image/webp" || mimeType === "image/gif";
}

/** Imagem já reduzida na decodificação (quando o navegador permite): não ocupa a memória da foto inteira. */
async function decodeSmall(file: Blob): Promise<ImageBitmap> {
  try {
    return await createImageBitmap(file, { resizeWidth: 640, resizeQuality: "medium" });
  } catch {
    return createImageBitmap(file);
  }
}

/** Miniatura JPEG (até 320 px) das imagens, só para a lista. Sem miniatura quando o navegador não consegue gerar. */
async function makeThumbnail(file: Blob, mimeType: string, maxChars: number): Promise<string | undefined> {
  if (!isThumbnailableImage(mimeType) || typeof createImageBitmap !== "function" || typeof document === "undefined") return undefined;
  try {
    const bitmap = await decodeSmall(file);
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
      if (url.length <= maxChars) return url;
    }
    return undefined;
  } catch {
    return undefined;
  }
}

const thumbnails = new WeakMap<Blob, Promise<string | undefined>>();

/** Miniatura do arquivo, gerada uma vez só (a lista e o envio usam a mesma). */
export function imageThumbnail(file: Blob, mimeType: string, maxChars: number): Promise<string | undefined> {
  let pending = thumbnails.get(file);
  if (!pending) {
    pending = makeThumbnail(file, mimeType, maxChars);
    thumbnails.set(file, pending);
  }
  return pending;
}

// ---------------------------------------------------------------------------
// Enviar
// ---------------------------------------------------------------------------

export interface UploadOptions {
  onProgress?: (progress: TransferProgress) => void;
  /** Cancelar o envio (botão "Cancelar envio"). */
  signal?: AbortSignal;
}

/**
 * Envia um arquivo em partes para a rota `base` do dono: abre o envio (POST `base` com `start`) → partes de 2 MB
 * (PUT `base/<id>?parte=N`, cada uma com até 3 tentativas e tempo-limite) → conclui (POST `base/<id>` com `complete`;
 * o servidor confere tamanho e SHA-256). Devolve o que a conclusão responder.
 */
export async function uploadInParts<T>(base: string, file: Blob, start: Record<string, unknown>, options: UploadOptions & { complete?: Record<string, unknown> } = {}): Promise<T> {
  const { onProgress, signal, complete } = options;
  const started = await withRetry(
    () => request(base, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(start) }, (r) => readJson<{ id: string; chunkSize: number; chunkCount: number }>(r), signal),
    signal,
  );
  onProgress?.({ done: 0, total: file.size });
  const target = `${base}/${encodeURIComponent(started.id)}`;
  for (let index = 0; index < started.chunkCount; index++) {
    const end = Math.min(file.size, (index + 1) * started.chunkSize);
    const part = file.slice(index * started.chunkSize, end);
    await withRetry(() => request(`${target}?parte=${index}`, { method: "PUT", headers: { "content-type": "application/octet-stream" }, body: part }, (r) => readJson(r), signal), signal);
    onProgress?.({ done: end, total: file.size });
  }
  const finish: RequestInit = complete ? { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(complete) } : { method: "POST" };
  return withRetry(() => request(target, finish, (r) => readJson<T>(r), signal), signal);
}

// ---------------------------------------------------------------------------
// Remontar e baixar
// ---------------------------------------------------------------------------

/** Remonta o arquivo de `fileUrl` parte a parte (`?parte=N`) e confere tamanho e SHA-256. */
export async function fetchPartsBlob(fileUrl: string, file: { mimeType: string; size: number; chunkCount: number; sha256: string }, onProgress?: (progress: TransferProgress) => void): Promise<Blob> {
  const parts: ArrayBuffer[] = [];
  let received = 0;
  for (let index = 0; index < file.chunkCount; index++) {
    const buffer = await withRetry(() => request(`${fileUrl}?parte=${index}`, {}, (r) => r.arrayBuffer()));
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
