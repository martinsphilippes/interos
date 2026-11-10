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

/**
 * Envio aberto há mais que isto foi abandonado (a pessoa fechou a tela no meio): é descartado na próxima abertura de
 * envio ou na limpeza diária (varredura `arquivos_pendentes`) e deixa de contar nos limites.
 */
export const STORED_FILE_PENDING_TTL_MS = 2 * 60 * 60 * 1000;

/** Envios abertos ao mesmo tempo por pessoa (nenhum usuário enche o espaço com envios inacabados). */
export const STORED_FILE_MAX_OPEN_UPLOADS_PER_USER = 10;

/**
 * Espaço total para arquivos guardados em partes na organização (soma dos tamanhos dos ativos e dos envios abertos).
 * No banco o conteúdo ocupa ~1,33× (base64): 3 GB de arquivos ≈ 4 GB dos 8 GB do plano atual do Supabase.
 */
export const STORED_FILES_ORG_MAX_BYTES = 3 * 1024 * 1024 * 1024;

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

/** Caracteres invisíveis de direção/formatação (ex.: U+202E inverte o texto: "termo-\u202Efdp.mp4" aparece como "termo-4pm.pdf"). */
function isInvisibleFormatChar(code: number): boolean {
  return code === 0x061c || (code >= 0x200b && code <= 0x200f) || (code >= 0x202a && code <= 0x202e) || (code >= 0x2060 && code <= 0x2069) || code === 0xfeff;
}

/**
 * Nome seguro para exibir e para o Content-Disposition: sem caminho, sem caracteres de controle, de direção invisíveis
 * nem reservados do Windows, espaços normalizados e no máximo 120 caracteres (a extensão é mantida ao cortar).
 */
export function safeFileName(raw: string, fallback = "arquivo"): string {
  const base = raw.split(/[\\/]/).pop() ?? "";
  const clean = Array.from(base)
    .filter((ch) => {
      const code = ch.codePointAt(0) ?? 0;
      return code >= 32 && code !== 127 && !isInvisibleFormatChar(code) && !FORBIDDEN_NAME_CHARS.has(ch);
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

/** "850 KB", "12,5 MB", "3 GB" (sem depender do Intl: igual no servidor e no navegador). */
export function formatBytes(bytes: number): string {
  if (!Number.isFinite(bytes) || bytes < 0) return "—";
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${Math.max(1, Math.round(bytes / 1024))} KB`;
  const decimal = (n: number) => (n >= 100 ? String(Math.round(n)) : n.toFixed(1).replace(/\.0$/, "")).replace(".", ",");
  if (bytes < 1024 * 1024 * 1024) return `${decimal(bytes / (1024 * 1024))} MB`;
  return `${decimal(bytes / (1024 * 1024 * 1024))} GB`;
}
