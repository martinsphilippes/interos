import "server-only";
/**
 * Arquivos guardados em partes no banco (stored_files + stored_file_chunks). Genérico: cada dono (`ownerKind`) tem as
 * próprias rotas e regras de acesso; aqui ficam o envio em partes, a conferência (tamanho + SHA-256), a leitura, a
 * remoção e a limpeza. Regras puras em src/domain/stored-files.ts.
 *
 * Concorrência: gravar uma parte, concluir e remover travam o documento do arquivo (transação). Assim nenhuma parte
 * muda depois da conferência do SHA-256 e nenhuma parte entra depois da remoção.
 */
import { createHash } from "node:crypto";
import { col, create, getById, list, nowIso, ORG_ID, txGetOwn } from "@/server/db";
import { docdb, FieldValue, type Transaction } from "@/server/docdb";
import { BusinessError } from "@/server/auth/error-classes";
import { SHA256_TAG, STORED_FILE_CHUNK_BYTES, STORED_FILE_PENDING_TTL_MS, chunkBytesAt, chunkCountFor, sha256Tag } from "@/domain/stored-files";
import { COLLECTIONS, type StoredFile, type StoredFileChunk, type StoredFileOwnerKind, type UserRef } from "@/domain/types";

/** Erro de regra do envio/leitura (mensagem mostrada ao usuário). */
export class StoredFileError extends BusinessError {}

/** Arquivo de um dono: tipo do dono + id do dono + id do arquivo. */
export interface StoredFileRef {
  ownerKind: StoredFileOwnerKind;
  ownerId: string;
  fileId: string;
}

const NOT_FOUND = "Arquivo não encontrado.";

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

/** Abre o envio: o arquivo nasce "enviando", com a quantidade de partes calculada aqui. */
export async function createPendingFile(input: NewStoredFile): Promise<StoredFile> {
  if (!SHA256_TAG.test(input.sha256)) throw new StoredFileError("Identificador (SHA-256) do arquivo inválido.");
  if (!Number.isInteger(input.size) || input.size <= 0) throw new StoredFileError("O arquivo está vazio.");
  return create<StoredFile>(COLLECTIONS.storedFiles, {
    ownerKind: input.ownerKind,
    ownerId: input.ownerId,
    name: input.name,
    mimeType: input.mimeType,
    size: input.size,
    sha256: input.sha256,
    chunkSize: STORED_FILE_CHUNK_BYTES,
    chunkCount: chunkCountFor(input.size, STORED_FILE_CHUNK_BYTES),
    status: "enviando",
    thumbnail: input.thumbnail,
    uploadedById: input.uploadedBy.id,
    uploadedByName: input.uploadedBy.name,
    createdBy: input.uploadedBy.id,
  });
}

/**
 * Grava a parte `index` (reenviar a mesma parte sobrescreve). Só quem abriu o envio, só enquanto "enviando" e só com o
 * tamanho exato da parte.
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
  });
}

/**
 * Conclui o envio: confere que todas as partes chegaram com o tamanho certo e que o SHA-256 do conteúdo é o informado
 * no início; só então o arquivo fica "ativo". `completed` = esta chamada concluiu (repetir devolve o mesmo arquivo).
 */
export async function completeFile(ref: StoredFileRef, uploaderId: string): Promise<{ file: StoredFile; completed: boolean }> {
  return docdb.runTransaction(async (tx) => {
    const file = await lockOwned(tx, ref);
    if (!file) throw new StoredFileError(NOT_FOUND);
    if (file.status === "ativo") return { file, completed: false };
    if (file.status !== "enviando") throw new StoredFileError("Este arquivo foi removido.");
    if (file.uploadedById !== uploaderId) throw new StoredFileError("Só quem começou o envio pode concluí-lo.");
    const hash = createHash("sha256");
    let total = 0;
    for (let index = 0; index < file.chunkCount; index++) {
      const snap = await txGetOwn(tx, chunkRef(file.id, index));
      if (!snap) throw new StoredFileError(`Falta a parte ${index + 1} de ${file.chunkCount} do arquivo. Envie o arquivo de novo.`);
      const bytes = Buffer.from(String(snap.get("contentBase64") ?? ""), "base64");
      if (bytes.byteLength !== chunkBytesAt(file.size, index, file.chunkSize)) throw new StoredFileError(`A parte ${index + 1} de ${file.chunkCount} está incompleta. Envie o arquivo de novo.`);
      hash.update(bytes);
      total += bytes.byteLength;
    }
    if (total !== file.size || sha256Tag(hash.digest("hex")) !== file.sha256) throw new StoredFileError("O arquivo chegou diferente do original (o SHA-256 não confere). Envie o arquivo de novo.");
    const completedAt = nowIso();
    tx.update(fileRef(file.id), { status: "ativo", completedAt, updatedAt: completedAt });
    return { file: { ...file, status: "ativo", completedAt, updatedAt: completedAt }, completed: true };
  });
}

// ---------------------------------------------------------------------------
// Remoção e limpeza
// ---------------------------------------------------------------------------

/** Apaga as partes e marca `purgedAt` (a limpeza diária refaz o que ficar para trás). */
async function purgeChunks(file: Pick<StoredFile, "id" | "chunkCount">): Promise<void> {
  const refs = Array.from({ length: file.chunkCount }, (_, index) => chunkRef(file.id, index));
  for (let i = 0; i < refs.length; i += 50) {
    const batch = docdb.batch();
    for (const r of refs.slice(i, i + 50)) batch.delete(r);
    await batch.commit();
  }
  await fileRef(file.id).set({ purgedAt: nowIso() }, { merge: true });
}

/**
 * Remove um arquivo ativo: marca quem, quando e por quê, apaga a miniatura e depois as partes. `allow` decide com o
 * arquivo travado (ex.: quem anexou só na primeira hora); recusado → `denied`. Devolve o arquivo antes da remoção.
 */
export async function removeFile(ref: StoredFileRef, by: UserRef, reason: string, allow: (file: StoredFile) => boolean, denied: () => Error): Promise<StoredFile> {
  const removed = await docdb.runTransaction(async (tx) => {
    const file = await lockOwned(tx, ref);
    if (!file) throw new StoredFileError(NOT_FOUND);
    if (file.status === "removido") throw new StoredFileError("Este arquivo já foi removido.");
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
      updatedAt: now,
    });
    return file;
  });
  await purgeChunks(removed);
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
    tx.update(fileRef(file.id), { status: "removido", removedAt: now, removedReason: "Envio não concluído", thumbnail: FieldValue.delete(), updatedAt: now });
    return true;
  });
  if (done) await purgeChunks(file);
  return done;
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
  /** Envios parados há mais de 24 h descartados. */
  discarded: number;
  /** Remoções cujas partes ficaram para trás e foram apagadas agora. */
  purged: number;
}

/** Limpeza diária (varredura `arquivos_pendentes`): envios parados e partes que sobraram de remoções. */
export async function sweepStoredFiles(now: Date, deadline?: number): Promise<StoredFilesSweepResult> {
  const cutoffIso = new Date(now.getTime() - STORED_FILE_PENDING_TTL_MS).toISOString();
  const [pending, removed] = await Promise.all([
    list<StoredFile>(COLLECTIONS.storedFiles, { where: [["status", "==", "enviando"]] }),
    list<StoredFile>(COLLECTIONS.storedFiles, { where: [["status", "==", "removido"]] }),
  ]);
  const result: StoredFilesSweepResult = { discarded: 0, purged: 0 };
  const late = () => deadline !== undefined && Date.now() > deadline;
  for (const file of pending) {
    if (late()) break;
    if (file.createdAt <= cutoffIso && (await discardStalePending(file, cutoffIso))) result.discarded += 1;
  }
  for (const file of removed) {
    if (late()) break;
    if (file.purgedAt) continue;
    await purgeChunks(file);
    result.purged += 1;
  }
  return result;
}
