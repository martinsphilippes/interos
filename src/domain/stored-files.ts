/**
 * Arquivos guardados em partes no banco (coleções stored_files + stored_file_chunks): regras puras usadas pelo
 * servidor (src/server/files/store.ts) e pelo navegador (envio e remontagem).
 *
 * Por que em partes: cada requisição e cada resposta de função na Vercel tem limite de ~4,5 MB. O arquivo sobe e
 * desce em partes de 2 MB; o servidor confere o tamanho e o SHA-256 ao concluir o envio e o navegador confere de novo
 * ao remontar o arquivo para abrir ou baixar.
 */

/** Tamanho de cada parte (bytes). Cada arquivo grava o próprio `chunkSize`: mudar aqui só vale para arquivos novos. */
export const STORED_FILE_CHUNK_BYTES = 2 * 1024 * 1024;

/** Até este tamanho o arquivo abre por link direto (uma resposta só, abaixo do limite da Vercel). */
export const STORED_FILE_DIRECT_MAX_BYTES = 4 * 1024 * 1024;

/** Envio que não terminou neste prazo é descartado pela limpeza diária (varredura `arquivos_pendentes`). */
export const STORED_FILE_PENDING_TTL_MS = 24 * 60 * 60 * 1000;

/** Quantidade de partes de um arquivo (arquivo vazio não é aceito; o mínimo é 1). */
export function chunkCountFor(size: number, chunkSize = STORED_FILE_CHUNK_BYTES): number {
  return Math.max(1, Math.ceil(size / chunkSize));
}

/** Bytes esperados na parte `index`: todas cheias, menos a última. Fora do intervalo = 0. */
export function chunkBytesAt(size: number, index: number, chunkSize = STORED_FILE_CHUNK_BYTES): number {
  const count = chunkCountFor(size, chunkSize);
  if (!Number.isInteger(index) || index < 0 || index >= count) return 0;
  return index === count - 1 ? size - chunkSize * (count - 1) : chunkSize;
}

/** Formato gravado do hash (o mesmo de SignedFile): "sha256:<64 hex minúsculos>". */
export const SHA256_TAG = /^sha256:[0-9a-f]{64}$/;

export function sha256Tag(hex: string): string {
  return `sha256:${hex.toLowerCase()}`;
}

/** Extensão em minúsculas, sem o ponto ("" quando não há). */
export function fileExtension(name: string): string {
  const dot = name.lastIndexOf(".");
  return dot > 0 && dot < name.length - 1 ? name.slice(dot + 1).toLowerCase() : "";
}

const FORBIDDEN_NAME_CHARS = new Set(['<', '>', ':', '"', "|", "?", "*"]);

/**
 * Nome seguro para exibir e para o Content-Disposition: sem caminho, sem caracteres de controle nem reservados do
 * Windows, espaços normalizados e no máximo 120 caracteres (a extensão é mantida ao cortar).
 */
export function safeFileName(raw: string, fallback = "arquivo"): string {
  const base = raw.split(/[\\/]/).pop() ?? "";
  const clean = Array.from(base)
    .filter((ch) => {
      const code = ch.charCodeAt(0);
      return code >= 32 && code !== 127 && !FORBIDDEN_NAME_CHARS.has(ch);
    })
    .join("")
    .replace(/\s+/g, " ")
    .trim();
  if (!clean || /^\.+$/.test(clean)) return fallback;
  if (clean.length <= 120) return clean;
  const ext = fileExtension(clean);
  const suffix = ext && ext.length <= 8 ? `.${ext}` : "";
  return `${clean.slice(0, 120 - suffix.length).trimEnd()}${suffix}`;
}

/** "850 KB", "12,5 MB" (sem depender do Intl: igual no servidor e no navegador). */
export function formatBytes(bytes: number): string {
  if (!Number.isFinite(bytes) || bytes < 0) return "—";
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${Math.max(1, Math.round(bytes / 1024))} KB`;
  const mb = bytes / (1024 * 1024);
  const text = mb >= 100 ? String(Math.round(mb)) : mb.toFixed(1).replace(/\.0$/, "");
  return `${text.replace(".", ",")} MB`;
}
