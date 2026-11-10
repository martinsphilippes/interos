import "server-only";
/**
 * Documentos do cliente enviados ao INTEROS (aba Documentos do Cliente 360º). Regras em
 * src/domain/client-documents.ts; arquivos em partes em src/server/files/store.ts (dono "client_document" = cliente).
 *
 * Fluxo: o navegador calcula o SHA-256, abre o envio (startClientDocumentUpload), manda as partes de 2 MB
 * (putClientDocumentChunk) e conclui (completeClientDocumentUpload: o servidor confere tamanho e SHA-256, cria o
 * Document — com o mesmo id do arquivo, então repetir a conclusão não duplica — com nome, categoria e versão, e
 * registra no histórico do cliente). Remover exige motivo; para arquivo, apaga o conteúdo e fica o registro.
 * Autorização (chave + escopo do cliente) fica nas rotas e na action; aqui só as regras.
 */
import { create, getById, list, update } from "@/server/db";
import { emitEvent } from "@/server/events";
import { can } from "@/server/auth/permissions";
import { BusinessError, PermissionError } from "@/server/auth/error-classes";
import { isUserFacingError } from "@/server/auth/errors";
import { StoredFileError, completeFile, createPendingFile, discardRetriedPending, getOwnedFile, listOwnerFiles, markHistoryLogged, removeFile, writeChunk, type StoredFileRef } from "@/server/files/store";
import { canSeeClientId } from "./access";
import {
  CLIENT_DOCUMENT_CATEGORY_MAX,
  CLIENT_DOCUMENT_MAX_FILES,
  CLIENT_DOCUMENT_REASON_MIN,
  CLIENT_DOCUMENT_TITLE_MAX,
  CLIENT_DOCUMENT_TITLE_MIN,
  canRemoveClientDocument,
  clientDocumentFileUrl,
  clientDocumentMimeType,
  clientDocumentProblem,
  isInlineClientDocumentType,
  sameDocumentTitle,
  suggestDocumentCategory,
  suggestDocumentTitle,
} from "@/domain/client-documents";
import { SHA256_TAG, STORED_FILE_PENDING_TTL_MS, formatBytes, safeFileName } from "@/domain/stored-files";
import type { DepartmentKey } from "@/domain/constants";
import { COLLECTIONS, type CurrentUser, type Document, type StoredFile, type UserRef } from "@/domain/types";

const OWNER = "client_document" as const;

/** Regra de negócio dos documentos (mensagem mostrada ao usuário). */
export class ClientDocumentError extends BusinessError {}

/** Quem age: nome para o registro e departamento para o histórico. */
export type DocumentActor = UserRef & { departmentId?: DepartmentKey | string };

/** Documento como a aba Documentos mostra. */
export interface ClientDocumentRow {
  id: string;
  name: string;
  category?: string;
  version: number;
  /** Arquivo guardado no INTEROS ou link externo. */
  kind: "arquivo" | "link";
  /** Link externo, ou a rota do arquivo (abre no navegador quando dá). */
  url: string;
  /** Arquivo: rota que força baixar. */
  downloadUrl?: string;
  fileName?: string;
  mimeType?: string;
  size?: number;
  sha256?: string;
  /** O navegador mostra o arquivo (PDF, imagem, texto); os demais só baixam. */
  inline: boolean;
  /** Vinculado a outro registro (contrato, cobrança, chamado…): é daquela tela e não sai por aqui. */
  linkedTo?: string;
  uploadedBy: string;
  createdAt: string;
  status: "ativo" | "removido";
  removedAt?: string;
  removedByName?: string;
  removedReason?: string;
  /** Quem está vendo pode remover agora (o servidor confere de novo). */
  removable: boolean;
}

/** Permissões de quem está vendo/agindo, avaliadas uma vez. */
export interface DocumentViewer {
  id: string;
  canRemoveAny: boolean;
  canRemoveOwn: boolean;
}

export function documentViewer(user: CurrentUser): DocumentViewer {
  return {
    id: user.id,
    canRemoveAny: can(user, "operacao.clientes.documentos.remover"),
    canRemoveOwn: can(user, "operacao.clientes.documentos.anexar"),
  };
}

const LINKED_LABELS: Record<string, string> = {
  contract: "Contrato",
  billing: "Cobrança",
  opportunity: "Oportunidade",
  project: "Implantação",
  projeto: "Implantação",
  ticket: "Chamado",
  chamado: "Chamado",
  payable: "Conta a pagar",
};

/** Documento da própria aba (vínculo "client")? Os de contrato, cobrança, chamado… pertencem àquelas telas. */
function ownedByTab(doc: Document): boolean {
  return (doc.entityType ?? "client") === "client";
}

function removableBy(viewer: DocumentViewer, doc: Document, now: Date): boolean {
  return ownedByTab(doc) && canRemoveClientDocument({ ...viewer, viewerId: viewer.id, uploadedById: doc.uploadedBy, completedAt: doc.createdAt, now });
}

export function toClientDocumentRow(doc: Document, viewer: DocumentViewer, now = new Date()): ClientDocumentRow {
  const active = doc.status !== "removido";
  const isFile = Boolean(doc.fileId && doc.clientId);
  return {
    id: doc.id,
    name: doc.name,
    category: doc.category,
    version: doc.version,
    kind: isFile ? "arquivo" : "link",
    url: isFile ? clientDocumentFileUrl(doc.clientId!, doc.fileId!) : doc.url,
    downloadUrl: isFile ? clientDocumentFileUrl(doc.clientId!, doc.fileId!, true) : undefined,
    fileName: doc.fileName,
    mimeType: doc.mimeType,
    size: doc.size,
    sha256: doc.sha256,
    inline: isFile ? isInlineClientDocumentType(doc.mimeType ?? "") : true,
    linkedTo: ownedByTab(doc) ? undefined : (LINKED_LABELS[doc.entityType ?? ""] ?? doc.entityType),
    uploadedBy: doc.uploadedBy,
    createdAt: doc.createdAt,
    status: active ? "ativo" : "removido",
    removedAt: doc.removedAt,
    removedByName: doc.removedByName,
    removedReason: doc.removedReason,
    removable: active && removableBy(viewer, doc, now),
  };
}

/** Documentos do cliente para a aba: os mais recentes primeiro; removidos no fim, com o registro da remoção. */
export function clientDocumentRows(docs: readonly Document[], viewer: DocumentViewer, now = new Date()): ClientDocumentRow[] {
  return docs
    .map((d) => toClientDocumentRow(d, viewer, now))
    .sort((a, b) => Number(a.status === "removido") - Number(b.status === "removido") || b.createdAt.localeCompare(a.createdAt));
}

function ref(clientId: string, fileId: string): StoredFileRef {
  return { ownerKind: OWNER, ownerId: clientId, fileId };
}

/** Cliente no escopo de quem pede (tela Clientes 360º + escopo de registros). Sem acesso = 403 (não revela se existe). */
export async function assertClientInScope(user: CurrentUser, clientId: string): Promise<void> {
  if (!(await canSeeClientId(user, clientId))) throw new PermissionError();
}

/** Arquivo ativo do cliente (abrir/baixar). null = não existe, é de outro cliente ou foi removido. */
export async function getActiveClientDocumentFile(clientId: string, fileId: string): Promise<StoredFile | null> {
  const file = await getOwnedFile(ref(clientId, fileId));
  return file && file.status === "ativo" ? file : null;
}

function cleanTitle(raw: string | undefined): string | undefined {
  const title = raw?.replace(/\s+/g, " ").trim();
  if (!title) return undefined;
  if (title.length < CLIENT_DOCUMENT_TITLE_MIN) throw new ClientDocumentError("Informe o nome do documento (mínimo de 2 caracteres).");
  return title.slice(0, CLIENT_DOCUMENT_TITLE_MAX);
}

function cleanCategory(raw: string | undefined): string | undefined {
  const category = raw?.replace(/\s+/g, " ").trim();
  return category ? category.slice(0, CLIENT_DOCUMENT_CATEGORY_MAX) : undefined;
}

/** Próxima versão para o nome: o mesmo nome (sem diferença de maiúsculas e acentos) vira v2, v3… */
export async function nextDocumentVersion(clientId: string, title: string): Promise<number> {
  const docs = await list<Document>(COLLECTIONS.documents, { where: [["clientId", "==", clientId]] });
  return docs.filter((d) => sameDocumentTitle(d.name, title)).reduce((max, d) => Math.max(max, d.version), 0) + 1;
}

/**
 * Document do arquivo (mesmo id): criado na conclusão do envio; se já existe (nova tentativa), é o mesmo. Sem nome ou
 * categoria informados, vale a sugestão pelo nome do arquivo.
 */
async function ensureFileDocument(clientId: string, file: StoredFile, meta: ClientDocumentMeta): Promise<Document> {
  const existing = await getById<Document>(COLLECTIONS.documents, file.id);
  if (existing) return existing;
  const title = cleanTitle(meta.title) ?? suggestDocumentTitle(file.name);
  const category = cleanCategory(meta.category) ?? suggestDocumentCategory(file.name);
  const version = await nextDocumentVersion(clientId, title);
  return create<Document>(
    COLLECTIONS.documents,
    {
      clientId,
      entityType: "client",
      entityId: clientId,
      name: title,
      url: clientDocumentFileUrl(clientId, file.id),
      mimeType: file.mimeType,
      size: file.size,
      version,
      uploadedBy: file.uploadedById,
      category,
      createdBy: file.uploadedById,
      fileId: file.id,
      fileName: file.name,
      sha256: file.sha256,
    },
    file.id,
  );
}

/** Registra o envio no histórico do cliente uma vez só (marcador `historyLoggedAt` no arquivo). */
async function logAdded(clientId: string, file: StoredFile, doc: Document, actor: DocumentActor): Promise<void> {
  if (file.historyLoggedAt) return;
  await emitEvent({
    type: "document.added",
    actor: { id: actor.id, name: actor.name },
    clientId,
    entity: { type: "document", id: doc.id },
    title: `Documento enviado: ${doc.name}${doc.version > 1 ? ` (v${doc.version})` : ""}`,
    description: [doc.category, file.name, formatBytes(file.size)].filter(Boolean).join(" · "),
    department: actor.departmentId as DepartmentKey | undefined,
    payload: { fileId: file.id, fileName: file.name, mimeType: file.mimeType, size: file.size, sha256: file.sha256, category: doc.category, version: doc.version },
  });
  await markHistoryLogged(file.id);
}

export interface StartClientDocumentInput {
  /** Nome do arquivo escolhido. */
  name: string;
  size: number;
  sha256: string;
}

/**
 * Abre o envio de um documento: tipo e tamanho aceitos e, com a trava de abertura de envios (sem corrida entre pedidos
 * simultâneos), sem repetir um arquivo que já está nos documentos do cliente ou sendo enviado por outra pessoa (mesmo
 * SHA-256) e dentro do limite de arquivos do cliente (ativos + envios em andamento). Uma nova tentativa do mesmo
 * arquivo pela mesma pessoa descarta a anterior. O espaço total da organização e os envios abertos por pessoa ficam no
 * store. Arquivo já concluído sem documento (a conclusão caiu no meio) ganha o documento aqui.
 */
export async function startClientDocumentUpload(
  clientId: string,
  input: StartClientDocumentInput,
  actor: DocumentActor,
  now = new Date(),
  limits: { orgMaxBytes?: number } = {},
): Promise<StoredFile> {
  const name = safeFileName(input.name);
  const problem = clientDocumentProblem({ name, size: input.size });
  if (problem) throw new ClientDocumentError(problem);
  const mimeType = clientDocumentMimeType(name);
  if (!mimeType) throw new ClientDocumentError("Tipo de arquivo não aceito.");
  if (!SHA256_TAG.test(input.sha256)) throw new ClientDocumentError("Não foi possível identificar o arquivo (SHA-256). Tente de novo.");
  let orphan: StoredFile | null = null;
  const check = async () => {
    await discardRetriedPending(OWNER, clientId, actor.id, input.sha256);
    const abandonedBefore = new Date(now.getTime() - STORED_FILE_PENDING_TTL_MS).toISOString();
    const files = (await listOwnerFiles(OWNER, clientId)).filter((f) => f.status === "ativo" || (f.status === "enviando" && f.createdAt > abandonedBefore));
    const same = files.find((f) => f.sha256 === input.sha256);
    if (same?.status === "ativo") {
      const doc = await getById<Document>(COLLECTIONS.documents, same.id);
      if (doc) throw new ClientDocumentError(`Este arquivo já está nos documentos do cliente ("${doc.name}").`);
      orphan = same;
      throw new ClientDocumentError("Este arquivo já tinha sido enviado e agora está na lista de documentos do cliente.");
    }
    if (same) throw new ClientDocumentError(`Este arquivo já está sendo enviado para este cliente por ${same.uploadedByName}.`);
    if (files.length >= CLIENT_DOCUMENT_MAX_FILES) {
      const uploading = files.filter((f) => f.status === "enviando").length;
      throw new ClientDocumentError(
        `Este cliente já tem ${CLIENT_DOCUMENT_MAX_FILES} arquivos${uploading ? `, contando ${uploading} envio(s) em andamento` : ""} (o limite). Remova um para enviar outro.`,
      );
    }
  };
  try {
    return await createPendingFile({ ownerKind: OWNER, ownerId: clientId, name, mimeType, size: input.size, sha256: input.sha256, uploadedBy: actor }, { orgMaxBytes: limits.orgMaxBytes, check, now });
  } catch (error) {
    // Fora da trava: o arquivo concluído sem documento ganha o documento (nome e categoria sugeridos) e o registro.
    const found = orphan as StoredFile | null;
    if (found) {
      const doc = await ensureFileDocument(clientId, found, {});
      await logAdded(clientId, found, doc, actor);
    }
    throw error;
  }
}

export async function putClientDocumentChunk(clientId: string, fileId: string, index: number, bytes: Uint8Array, actor: UserRef): Promise<void> {
  await writeChunk(ref(clientId, fileId), index, bytes, actor.id);
}

/** Nome e categoria escolhidos na tela (sem eles, vale a sugestão pelo nome do arquivo). */
export interface ClientDocumentMeta {
  title?: string;
  category?: string;
}

/**
 * Conclui o envio (servidor confere tamanho e SHA-256), cria o documento e registra no histórico do cliente. Repetir
 * (a resposta se perdeu) devolve o mesmo documento e registra só o que faltou.
 */
export async function completeClientDocumentUpload(clientId: string, fileId: string, meta: ClientDocumentMeta, actor: DocumentActor): Promise<Document> {
  const { file } = await completeFile(ref(clientId, fileId), actor.id);
  const doc = await ensureFileDocument(clientId, file, meta);
  await logAdded(clientId, file, doc, actor);
  return doc;
}

/**
 * Remove um documento da aba: motivo obrigatório; quem tem a chave de remover pode sempre, quem enviou só na primeira
 * hora. Arquivo: o conteúdo é apagado (ficam nome, tamanho, SHA-256 e quem enviou). Link: sai da lista. Em ambos fica
 * o registro (quem removeu, quando e por quê) no documento e no histórico do cliente. Documento de contrato, cobrança
 * ou chamado pertence àquela tela e não sai por aqui.
 */
export async function removeClientDocument(clientId: string, documentId: string, reason: string, actor: DocumentActor, viewer: DocumentViewer, now = new Date()): Promise<Document> {
  const why = reason.replace(/\s+/g, " ").trim();
  if (why.length < CLIENT_DOCUMENT_REASON_MIN) throw new ClientDocumentError(`Informe o motivo da remoção (mínimo de ${CLIENT_DOCUMENT_REASON_MIN} caracteres).`);
  const doc = await getById<Document>(COLLECTIONS.documents, documentId);
  if (!doc || doc.clientId !== clientId) throw new ClientDocumentError("Documento não encontrado.");
  if (!ownedByTab(doc)) throw new ClientDocumentError("Este documento pertence a outro registro (contrato, cobrança, chamado…) e não é removido por aqui.");
  if (doc.status === "removido") throw new ClientDocumentError("Este documento já foi removido.");
  if (!removableBy(viewer, doc, now)) throw new PermissionError("Só quem enviou (na primeira hora) ou quem tem permissão para remover documentos pode remover este documento.");
  if (doc.fileId) {
    try {
      await removeFile(
        ref(clientId, doc.fileId),
        actor,
        why,
        () => true,
        () => new PermissionError(),
      );
    } catch (error) {
      // Conteúdo já apagado numa tentativa anterior que não chegou a marcar o documento: segue para marcar.
      if (!(error instanceof StoredFileError) || error.code !== "ja_removido") throw error;
    }
  }
  const removedAt = now.toISOString();
  const patch: Partial<Document> = { status: "removido", removedAt, removedById: actor.id, removedByName: actor.name, removedReason: why };
  await update<Document>(COLLECTIONS.documents, doc.id, patch);
  try {
    await emitEvent({
      type: "document.removed",
      actor: { id: actor.id, name: actor.name },
      clientId,
      entity: { type: "document", id: doc.id },
      title: `Documento removido: ${doc.name}${doc.version > 1 ? ` (v${doc.version})` : ""}`,
      description: `Motivo: ${why}`,
      department: actor.departmentId as DepartmentKey | undefined,
      payload: { fileId: doc.fileId, fileName: doc.fileName, size: doc.size, sha256: doc.sha256, url: doc.fileId ? undefined : doc.url, category: doc.category, version: doc.version, reason: why },
    });
  } catch (error) {
    // O registro principal já está no documento (quem, quando e por quê); o histórico é complemento.
    console.error("[documentos do cliente] remoção sem registro no histórico", error);
  }
  return { ...doc, ...patch };
}

/** Erro das rotas de documento: permissão → 403; regra de negócio → 400 com a mensagem; o resto vai para o log. */
export function documentErrorResponse(error: unknown, fallback: string): Response {
  if (error instanceof PermissionError) return Response.json({ ok: false, error: error.message }, { status: 403 });
  if (isUserFacingError(error)) return Response.json({ ok: false, error: error.message }, { status: 400 });
  console.error(`[documentos do cliente] ${fallback}`, error);
  return Response.json({ ok: false, error: fallback }, { status: 500 });
}
