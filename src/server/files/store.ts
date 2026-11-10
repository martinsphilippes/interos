import "server-only";
/**
 * Arquivos guardados em partes no banco (stored_files + stored_file_chunks). Genérico: cada dono (`ownerKind`) tem as
 * próprias rotas e regras de acesso; aqui ficam o envio em partes, a conferência (tamanho + SHA-256), a leitura, a
 * remoção e a limpeza. Regras puras em src/domain/stored-files.ts.
 *
 * Concorrência:
 * - Abrir envio passa por uma trava única da organização (transação): o limite por dono, os envios abertos por pessoa
 *   e o espaço total não são furados por pedidos simultâneos.
 * - Gravar uma parte, concluir e remover travam o documento do arquivo: nenhuma parte muda depois da conferência do
 *   SHA-256 e nenhuma parte entra depois da remoção.
 */
import { createHash } from "node:crypto";
import { col, getById, list, nowIso, ORG_ID, sumField, txGetOwn } from "@/server/db";
import { docdb, FieldValue, type Transaction } from "@/server/docdb";
import { BusinessError } from "@/server/auth/error-classes";
import {
  SHA256_TAG,
  STORED_FILES_ORG_MAX_BYTES,
  STORED_FILE_CHUNK_BYTES,
  STORED_FILE_MAX_OPEN_UPLOADS_PER_USER,
  STORED_FILE_PENDING_TTL_MS,
  chunkBytesAt,
  chunkCountFor,
  formatBytes,
  sha256Tag,
} from "@/domain/stored-files";
import { COLLECTIONS, type StoredFile, type StoredFileChunk, type StoredFileOwnerKind, type UserRef } from "@/domain/types";

/** Erro de regra do envio/leitura (mensagem mostrada ao usuário). `code` identifica casos tratados por quem chama. */
export class StoredFileError extends BusinessError {
  constructor(
    message: string,
    readonly code?: "ja_removido",
  ) {
    super(message);
  }
}

/** Arquivo de um dono: tipo do dono + id do dono + id do arquivo. */
export interface StoredFileRef {
  ownerKind: StoredFileOwnerKind;
  ownerId: string;
  fileId: string;
}

const NOT_FOUND = "Arquivo não encontrado.";

/** Trava (sem documento) que enfileira as aberturas de envio da organização. */
const START_LOCK_ID = "__abertura_de_envio__";

/** Envios abandonados descartados a cada abertura de envio (o resto fica para a limpeza diária). */
const DISCARD_ON_START_MAX = 20;

/** Id do documento da parte: `<arquivo>__00000`. */
export function chunkDocId(fileId: string, index: number): string {
  return `${fileId}__${String(index).padStart(5, "0")}`;
}

function fileRef(fileId: string) {
  return col(COLLECTIONS.storedFiles).doc(fileId);
}

function chunkRef(fileId: string, index: number) {
  return col(COLLECTIONS.storedFileChunks).doc(chunkDocId(fileId, index));
}

/** Lê e trava o arquivo do dono na transação (null = não existe, outra organização ou outro dono). */
async function lockOwned(tx: Transaction, ref: StoredFileRef): Promise<StoredFile | null> {
  const snap = await txGetOwn(tx, fileRef(ref.fileId));
  if (!snap) return null;
  const file = { ...(snap.data() as Omit<StoredFile, "id">), id: snap.id } as StoredFile;
  return file.ownerKind === ref.ownerKind && file.ownerId === ref.ownerId ? file : null;
}

function pendingCutoff(now: Date): string {
  return new Date(now.getTime() - STORED_FILE_PENDING_TTL_MS).toISOString();
}

// ---------------------------------------------------------------------------
// Leitura
// ---------------------------------------------------------------------------

/** Arquivo do dono (null = não existe, outra organização ou outro dono). */
export async function getOwnedFile(ref: StoredFileRef): Promise<StoredFile | null> {
  const file = await getById<StoredFile>(COLLECTIONS.storedFiles, ref.fileId);
  return file && file.ownerKind === ref.ownerKind && file.ownerId === ref.ownerId ? file : null;
}

/** Todos os arquivos de um dono (qualquer situação). */
export async function listOwnerFiles(ownerKind: StoredFileOwnerKind, ownerId: string): Promise<StoredFile[]> {
  return list<StoredFile>(COLLECTIONS.storedFiles, {
    where: [
      ["ownerKind", "==", ownerKind],
      ["ownerId", "==", ownerId],
    ],
  });
}

/** Conteúdo de uma parte de um arquivo ativo. */
export async function readChunk(file: StoredFile, index: number): Promise<Buffer> {
  if (!chunkBytesAt(file.size, index, file.chunkSize)) throw new StoredFileError("Parte do arquivo inválida.");
  const part = await getById<StoredFileChunk>(COLLECTIONS.storedFileChunks, chunkDocId(file.id, index));
  if (!part || part.fileId !== file.id) throw new StoredFileError("Parte do arquivo não encontrada.");
  return Buffer.from(part.contentBase64, "base64");
}

/** O arquivo inteiro como fluxo, uma parte por vez (memória de uma parte só). */
export function streamFile(file: StoredFile): ReadableStream<Uint8Array> {
  let index = 0;
  return new ReadableStream<Uint8Array>({
    async pull(controller) {
      if (index >= file.chunkCount) {
        controller.close();
        return;
      }
      try {
        controller.enqueue(new Uint8Array(await readChunk(file, index)));
        index += 1;
      } catch (error) {
        controller.error(error);
      }
    },
  });
}

/** Espaço ocupado na organização: arquivos ativos + envios abertos (soma dos tamanhos, calculada no banco). */
export async function storedFilesUsage(): Promise<number> {
  return sumField(COLLECTIONS.storedFiles, "size", [["status", "in", ["ativo", "enviando"]]]);
}

// ---------------------------------------------------------------------------
// Envio
// ---------------------------------------------------------------------------

export interface NewStoredFile {
  ownerKind: StoredFileOwnerKind;
  ownerId: string;
  name: string;
  mimeType: string;
  size: number;
  sha256: string;
  thumbnail?: string;
  uploadedBy: UserRef;
}

export interface CreatePendingOptions {
  /** Espaço total da organização para arquivos (os testes usam um limite menor). */
  orgMaxBytes?: number;
  /** Regras do dono (limite por dono, arquivo repetido…), conferidas com a trava; recusa lançando o erro. */
  check?: () => Promise<void>;
  now?: Date;
}

/**
 * Abre o envio: o arquivo nasce "enviando", com a quantidade de partes calculada aqui. Com a trava da organização:
 * descarta envios abandonados (mais de 2 h), confere as regras do dono, o máximo de envios abertos por pessoa e o
 * espaço total da organização.
 */
export async function createPendingFile(input: NewStoredFile, options: CreatePendingOptions = {}): Promise<StoredFile> {
  if (!SHA256_TAG.test(input.sha256)) throw new StoredFileError("Identificador (SHA-256) do arquivo inválido.");
  if (!Number.isInteger(input.size) || input.size <= 0) throw new StoredFileError("O arquivo está vazio.");
  const now = options.now ?? new Date();
  const orgMaxBytes = options.orgMaxBytes ?? STORED_FILES_ORG_MAX_BYTES;
  return docdb.runTransaction(async (tx) => {
    await tx.get(fileRef(START_LOCK_ID));
    await discardAbandoned(now, DISCARD_ON_START_MAX);
    await options.check?.();
    const open = await list<StoredFile>(COLLECTIONS.storedFiles, {
      where: [
        ["uploadedById", "==", input.uploadedBy.id],
        ["status", "==", "enviando"],
      ],
    });
    if (open.length >= STORED_FILE_MAX_OPEN_UPLOADS_PER_USER) {
      throw new StoredFileError(`Você já tem ${open.length} envios de arquivo em andamento. Espere terminarem para começar outro.`);
    }
    const used = await storedFilesUsage();
    if (used + input.size > orgMaxBytes) {
      throw new StoredFileError(`O espaço para arquivos do INTEROS está cheio (${formatBytes(used)} de ${formatBytes(orgMaxBytes)} usados). Fale com o administrador do sistema.`);
    }
    const ref = col(COLLECTIONS.storedFiles).doc();
    const at = nowIso();
    const doc: Omit<StoredFile, "id"> = {
      ownerKind: input.ownerKind,
      ownerId: input.ownerId,
      name: input.name,
      mimeType: input.mimeType,
      size: input.size,
      sha256: input.sha256,
      chunkSize: STORED_FILE_CHUNK_BYTES,
      chunkCount: chunkCountFor(input.size, STORED_FILE_CHUNK_BYTES),
      status: "enviando",
      ...(input.thumbnail ? { thumbnail: input.thumbnail } : {}),
      uploadedById: input.uploadedBy.id,
      uploadedByName: input.uploadedBy.name,
      received: [],
      organizationId: ORG_ID,
      createdAt: at,
      updatedAt: at,
      createdBy: input.uploadedBy.id,
    };
    tx.set(ref, doc);
    return { ...doc, id: ref.id };
  });
}

/**
 * Grava a parte `index` (reenviar a mesma parte sobrescreve). Só quem abriu o envio, só enquanto "enviando" e só com o
 * tamanho exato da parte. Registra a parte em `received`.
 */
export async function writeChunk(ref: StoredFileRef, index: number, bytes: Uint8Array, uploaderId: string): Promise<void> {
  await docdb.runTransaction(async (tx) => {
    const file = await lockOwned(tx, ref);
    if (!file) throw new StoredFileError(NOT_FOUND);
    if (file.status !== "enviando") throw new StoredFileError("O envio deste arquivo já foi encerrado.");
    if (file.uploadedById !== uploaderId) throw new StoredFileError("Só quem começou o envio pode mandar as partes do arquivo.");
    const expected = chunkBytesAt(file.size, index, file.chunkSize);
    if (!expected) throw new StoredFileError("Parte do arquivo inválida.");
    if (bytes.byteLength !== expected) throw new StoredFileError(`A parte ${index + 1} de ${file.chunkCount} chegou incompleta. Tente de novo.`);
    const now = nowIso();
    const part: Omit<StoredFileChunk, "id"> = {
      fileId: file.id,
      index,
      size: bytes.byteLength,
      contentBase64: Buffer.from(bytes.buffer, bytes.byteOffset, bytes.byteLength).toString("base64"),
      organizationId: ORG_ID,
      createdAt: now,
      updatedAt: now,
    };
    tx.set(chunkRef(file.id, index), part);
    const received = file.received ?? [];
    if (!received.includes(index)) tx.update(fileRef(file.id), { received: [...received, index].sort((a, b) => a - b), updatedAt: now });
  });
}

type CompleteOutcome = { kind: "ok"; file: StoredFile; completed: boolean } | { kind: "diferente"; file: StoredFile };

/**
 * Conclui o envio: todas as partes recebidas (conferido sem ler o conteúdo), tamanho de cada uma e SHA-256 do conteúdo
 * igual ao informado no início; só então o arquivo fica "ativo". Conteúdo diferente encerra o envio (nova tentativa =
 * novo envio) e apaga as partes. `completed` = esta chamada concluiu (repetir devolve o mesmo arquivo).
 */
export async function completeFile(ref: StoredFileRef, uploaderId: string): Promise<{ file: StoredFile; completed: boolean }> {
  const outcome = await docdb.runTransaction<CompleteOutcome>(async (tx) => {
    const file = await lockOwned(tx, ref);
    if (!file) throw new StoredFileError(NOT_FOUND);
    if (file.status === "ativo") return { kind: "ok", file, completed: false };
    if (file.status !== "enviando") throw new StoredFileError("Este arquivo foi removido.");
    if (file.uploadedById !== uploaderId) throw new StoredFileError("Só quem começou o envio pode concluí-lo.");
    const received = new Set(file.received ?? []);
    for (let index = 0; index < file.chunkCount; index++) {
      if (!received.has(index)) throw new StoredFileError(`Falta a parte ${index + 1} de ${file.chunkCount} do arquivo. Envie o arquivo de novo.`);
    }
    const hash = createHash("sha256");
    let total = 0;
    let intact = true;
    for (let index = 0; index < file.chunkCount; index++) {
      const snap = await txGetOwn(tx, chunkRef(file.id, index));
      const bytes = snap ? Buffer.from(String(snap.get("contentBase64") ?? ""), "base64") : null;
      if (!bytes || bytes.byteLength !== chunkBytesAt(file.size, index, file.chunkSize)) {
        intact = false;
        break;
      }
      hash.update(bytes);
      total += bytes.byteLength;
    }
    const now = nowIso();
    if (!intact || total !== file.size || sha256Tag(hash.digest("hex")) !== file.sha256) {
      tx.update(fileRef(file.id), { status: "removido", removedAt: now, removedReason: "Conteúdo diferente do informado (SHA-256)", thumbnail: FieldValue.delete(), purgePending: true, updatedAt: now });
      return { kind: "diferente", file };
    }
    tx.update(fileRef(file.id), { status: "ativo", completedAt: now, updatedAt: now });
    return { kind: "ok", file: { ...file, status: "ativo", completedAt: now, updatedAt: now }, completed: true };
  });
  if (outcome.kind === "diferente") {
    await purgeChunksLater(outcome.file);
    throw new StoredFileError("O arquivo chegou diferente do original (o SHA-256 não confere). Envie o arquivo de novo.");
  }
  return { file: outcome.file, completed: outcome.completed };
}

// ---------------------------------------------------------------------------
// Registro no histórico
// ---------------------------------------------------------------------------

/** Marca que a conclusão já entrou no histórico do dono (ver `historyLoggedAt`). */
export async function markHistoryLogged(fileId: string): Promise<void> {
  const now = nowIso();
  await fileRef(fileId).update({ historyLoggedAt: now, updatedAt: now });
}

/** Marca que a remoção já entrou no histórico do dono (ver `removalLoggedAt`). */
export async function markRemovalLogged(fileId: string): Promise<void> {
  const now = nowIso();
  await fileRef(fileId).update({ removalLoggedAt: now, updatedAt: now });
}

// ---------------------------------------------------------------------------
// Remoção e limpeza
// ---------------------------------------------------------------------------

/** Apaga as partes e marca `purgedAt` (só atualiza: um arquivo que já não existe não é recriado). */
async function purgeChunks(file: Pick<StoredFile, "id" | "chunkCount">): Promise<void> {
  const refs = Array.from({ length: file.chunkCount }, (_, index) => chunkRef(file.id, index));
  for (let i = 0; i < refs.length; i += 50) {
    const batch = docdb.batch();
    for (const r of refs.slice(i, i + 50)) batch.delete(r);
    await batch.commit();
  }
  const now = nowIso();
  try {
    await fileRef(file.id).update({ purgedAt: now, purgePending: FieldValue.delete(), updatedAt: now });
  } catch (error) {
    if ((error as { code?: number }).code !== 5) throw error;
  }
}

/** Apaga as partes sem derrubar quem chamou: a mudança de situação já está gravada e a limpeza diária termina o resto. */
async function purgeChunksLater(file: Pick<StoredFile, "id" | "chunkCount">): Promise<void> {
  try {
    await purgeChunks(file);
  } catch (error) {
    console.error(`[arquivos] partes do arquivo ${file.id} ficaram para a limpeza diária`, error);
  }
}

/**
 * Remove um arquivo ativo: marca quem, quando e por quê, apaga a miniatura e depois as partes. `allow` decide com o
 * arquivo travado (ex.: quem anexou só na primeira hora); recusado → `denied`. Devolve o arquivo antes da remoção.
 * Gravada a remoção, apagar as partes nunca derruba a chamada (o que falhar fica para a limpeza diária).
 */
export async function removeFile(ref: StoredFileRef, by: UserRef, reason: string, allow: (file: StoredFile) => boolean, denied: () => Error): Promise<StoredFile> {
  const removed = await docdb.runTransaction(async (tx) => {
    const file = await lockOwned(tx, ref);
    if (!file) throw new StoredFileError(NOT_FOUND);
    if (file.status === "removido") throw new StoredFileError("Este arquivo já foi removido.", "ja_removido");
    if (file.status !== "ativo") throw new StoredFileError("O envio deste arquivo ainda não terminou.");
    if (!allow(file)) throw denied();
    const now = nowIso();
    tx.update(fileRef(file.id), {
      status: "removido",
      removedAt: now,
      removedById: by.id,
      removedByName: by.name,
      removedReason: reason,
      thumbnail: FieldValue.delete(),
      purgePending: true,
      updatedAt: now,
    });
    return file;
  });
  await purgeChunksLater(removed);
  return removed;
}

/**
 * Descarta um envio parado (status "enviando" desde antes de `cutoffIso`): vira "removido" sem `completedAt` (não
 * aparece como comprovante) e as partes são apagadas. false = mudou de situação no meio (concluiu ou já saiu).
 */
async function discardStalePending(file: StoredFile, cutoffIso: string): Promise<boolean> {
  const done = await docdb.runTransaction(async (tx) => {
    const current = await lockOwned(tx, { ownerKind: file.ownerKind, ownerId: file.ownerId, fileId: file.id });
    if (!current || current.status !== "enviando" || current.createdAt > cutoffIso) return false;
    const now = nowIso();
    tx.update(fileRef(file.id), { status: "removido", removedAt: now, removedReason: "Envio não concluído", thumbnail: FieldValue.delete(), purgePending: true, updatedAt: now });
    return true;
  });
  if (done) await purgeChunksLater(file);
  return done;
}

/** Descarta até `max` envios abandonados (abertos há mais de 2 h). Falha num item não para os outros. */
async function discardAbandoned(now: Date, max: number): Promise<number> {
  const cutoffIso = pendingCutoff(now);
  const pending = await list<StoredFile>(COLLECTIONS.storedFiles, { where: [["status", "==", "enviando"]] });
  let discarded = 0;
  for (const file of pending.filter((f) => f.createdAt <= cutoffIso).slice(0, max)) {
    try {
      if (await discardStalePending(file, cutoffIso)) discarded += 1;
    } catch (error) {
      console.error(`[arquivos] envio abandonado ${file.id} não foi descartado agora`, error);
    }
  }
  return discarded;
}

/** Envios abertos de um dono por quem começou, com o mesmo conteúdo (nova tentativa): descartados antes do novo. */
export async function discardRetriedPending(ownerKind: StoredFileOwnerKind, ownerId: string, uploaderId: string, sha256: string): Promise<number> {
  const files = await listOwnerFiles(ownerKind, ownerId);
  let discarded = 0;
  for (const f of files) {
    if (f.status !== "enviando" || f.uploadedById !== uploaderId || f.sha256 !== sha256) continue;
    if (await discardStalePending(f, nowIso())) discarded += 1;
  }
  return discarded;
}

export interface StoredFilesSweepResult {
  /** Envios abandonados (abertos há mais de 2 h) descartados. */
  discarded: number;
  /** Remoções cujas partes ficaram para trás e foram apagadas agora. */
  purged: number;
  /** Itens que falharam (ficam para a próxima limpeza). */
  failed: number;
  /** Itens deixados para a próxima limpeza (limite por execução ou prazo da varredura). */
  deferred: number;
}

/** Itens tratados por execução (cada um é uma transação curta + exclusão em lote). */
const SWEEP_MAX_ITEMS = 200;
/** Mesmo atrasada (prazo da varredura estourado), a limpeza trata ao menos estes itens: nunca passa um dia parada. */
const SWEEP_MIN_ITEMS = 20;

/**
 * Limpeza diária (varredura `arquivos_pendentes`): envios abandonados e remoções com partes por apagar
 * (`purgePending`). Cada item é independente: uma falha não interrompe os outros.
 */
export async function sweepStoredFiles(now: Date, deadline?: number): Promise<StoredFilesSweepResult> {
  const cutoffIso = pendingCutoff(now);
  const [pending, leftovers] = await Promise.all([
    list<StoredFile>(COLLECTIONS.storedFiles, { where: [["status", "==", "enviando"]] }),
    list<StoredFile>(COLLECTIONS.storedFiles, { where: [["purgePending", "==", true]] }),
  ]);
  const work: (() => Promise<"discarded" | "purged" | null>)[] = [
    ...pending.filter((f) => f.createdAt <= cutoffIso).map((f) => async () => ((await discardStalePending(f, cutoffIso)) ? ("discarded" as const) : null)),
    ...leftovers.map((f) => async () => {
      await purgeChunks(f);
      return "purged" as const;
    }),
  ];
  const result: StoredFilesSweepResult = { discarded: 0, purged: 0, failed: 0, deferred: 0 };
  let done = 0;
  for (const item of work) {
    const late = deadline !== undefined && Date.now() > deadline && done >= SWEEP_MIN_ITEMS;
    if (done >= SWEEP_MAX_ITEMS || late) {
      result.deferred += 1;
      continue;
    }
    done += 1;
    try {
      const outcome = await item();
      if (outcome) result[outcome] += 1;
    } catch (error) {
      result.failed += 1;
      console.error("[arquivos] limpeza: item falhou (fica para a próxima)", error);
    }
  }
  return result;
}
