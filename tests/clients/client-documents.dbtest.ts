/**
 * Documentos do cliente no banco (npm run test:db): envio em partes com conferência do SHA-256, criação do documento
 * (mesmo id do arquivo, nome/categoria escolhidos ou sugeridos, versão pelo nome), conclusão repetida (também ao mesmo
 * tempo) sem duplicar, arquivo repetido recusado, cliente inexistente recusado, download íntegro, remoção com registro
 * (quem enviou só na primeira hora; gestor sempre; link também; documento de contrato não; duas ao mesmo tempo
 * registram uma vez), arquivo concluído sem documento recuperado no próximo envio (com o autor certo), limites de
 * arquivos e de espaço por cliente e aberturas de envio simultâneas sem travar o pool de conexões.
 *
 * Isolamento: clientes, arquivos, partes, documentos e eventos com prefixo próprio, apagados no fim. Os clientes são
 * criados de verdade: o histórico grava a última interação no cliente (sem ele, ficaria um registro incompleto).
 */
import { createHash, randomBytes } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { docdb } from "@/server/docdb";
import { create, getById, list } from "@/server/db";
import { COLLECTIONS, type Client, type Document, type DomainEvent, type StoredFile } from "@/domain/types";
import { CLIENT_DOCUMENT_MAX_FILES, CLIENT_DOCUMENT_UNDO_MS } from "@/domain/client-documents";
import { sha256Tag } from "@/domain/stored-files";
import { completeFile, streamFile } from "@/server/files/store";
import {
  clientDocumentRows,
  completeClientDocumentUpload,
  getActiveClientDocumentFile,
  nextDocumentVersion,
  putClientDocumentChunk,
  removeClientDocument,
  startClientDocumentUpload,
  type DocumentViewer,
} from "@/server/clients/documents";

const RUN = `cd${Date.now().toString(36)}`;
const CLIENT = `${RUN}_cli`;
const CLIENT_ORPHAN = `${RUN}_cli2`;
const CLIENT_CAP = `${RUN}_cli3`;
const CLIENT_POOL = `${RUN}_cli4`;
const CLIENTS = [CLIENT, CLIENT_ORPHAN, CLIENT_CAP, CLIENT_POOL];
const UPLOADER = { id: `${RUN}_ana`, name: "Ana Documentos", departmentId: "cs" };
const OTHER = { id: `${RUN}_bia`, name: "Bia Outra" };
const MANAGER = { id: `${RUN}_ger`, name: "Gestor Teste" };
const viewer = (id: string, canRemoveAny = false, canRemoveOwn = true): DocumentViewer => ({ id, canRemoveAny, canRemoveOwn });
const sha = (bytes: Uint8Array) => sha256Tag(createHash("sha256").update(bytes).digest("hex"));

/** Envia o arquivo inteiro (abre, partes, conclui). */
async function sendWhole(clientId: string, name: string, bytes: Buffer, meta: { title?: string; category?: string } = {}, actor = UPLOADER): Promise<Document> {
  const started = await startClientDocumentUpload(clientId, { name, size: bytes.byteLength, sha256: sha(bytes) }, actor);
  for (let i = 0; i < started.chunkCount; i++) await putClientDocumentChunk(clientId, started.id, i, bytes.subarray(i * started.chunkSize, (i + 1) * started.chunkSize), actor);
  return completeClientDocumentUpload(clientId, started.id, meta, actor);
}

async function doc(id: string): Promise<Document> {
  const d = await getById<Document>(COLLECTIONS.documents, id);
  if (!d) throw new Error("documento sumiu");
  return d;
}

async function events(clientId: string, type: string): Promise<DomainEvent[]> {
  return (await list<DomainEvent>(COLLECTIONS.events, { where: [["clientId", "==", clientId]] })).filter((e) => e.type === type);
}

async function readAll(file: StoredFile): Promise<Buffer> {
  const reader = streamFile(file).getReader();
  const parts: Uint8Array[] = [];
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    parts.push(value);
  }
  return Buffer.concat(parts);
}

beforeAll(async () => {
  if (!process.env.DATABASE_URL) throw new Error("Defina DATABASE_URL (veja scripts/db-local.sh)");
  for (const id of CLIENTS) {
    await create<Client>(COLLECTIONS.clients, { tradeName: `Cliente ${id}`, legalName: `Cliente ${id} LTDA`, status: "ativo", tags: [] } as never, id);
  }
});

afterAll(async () => {
  const sql = docdb.sql();
  const files = (await sql`select id from interos.stored_files where data->>'ownerId' = any(${CLIENTS})`) as unknown as { id: string }[];
  const ids = files.map((f) => f.id);
  if (ids.length) await sql`delete from interos.stored_file_chunks where data->>'fileId' = any(${ids})`;
  await sql`delete from interos.stored_files where data->>'ownerId' = any(${CLIENTS})`;
  await sql`delete from interos.documents where data->>'clientId' = any(${CLIENTS})`;
  await sql`delete from interos.events where data->>'clientId' = any(${CLIENTS})`;
  await sql`delete from interos.clients where id = any(${CLIENTS})`;
});

describe("enviar", () => {
  it("arquivo em partes vira documento (mesmo id), com nome, categoria, versão e registro no histórico", async () => {
    const bytes = randomBytes(5 * 1024 * 1024 + 123);
    const d = await sendWhole(CLIENT, "contrato_social_2024.pdf", bytes, { title: "  Contrato social  da empresa ", category: "Contrato social" });
    expect(d).toMatchObject({
      clientId: CLIENT,
      entityType: "client",
      entityId: CLIENT,
      name: "Contrato social da empresa",
      category: "Contrato social",
      version: 1,
      fileId: d.id,
      fileName: "contrato_social_2024.pdf",
      mimeType: "application/pdf",
      size: bytes.byteLength,
      sha256: sha(bytes),
      uploadedBy: UPLOADER.id,
      url: `/api/clientes/${CLIENT}/documentos/${d.id}`,
    });
    const file = await getActiveClientDocumentFile(CLIENT, d.id);
    expect(file?.chunkCount).toBe(3);
    expect((await readAll(file!)).equals(bytes)).toBe(true);
    const added = (await events(CLIENT, "document.added")).filter((e) => e.entityId === d.id);
    expect(added).toHaveLength(1);
    expect(added[0].title).toBe("Documento enviado: Contrato social da empresa");
  });

  it("concluir de novo devolve o mesmo documento e não duplica o registro", async () => {
    const bytes = randomBytes(1000);
    const started = await startClientDocumentUpload(CLIENT, { name: "termo.pdf", size: bytes.byteLength, sha256: sha(bytes) }, UPLOADER);
    await putClientDocumentChunk(CLIENT, started.id, 0, bytes, UPLOADER);
    const first = await completeClientDocumentUpload(CLIENT, started.id, { title: "Termo", category: "Contrato" }, UPLOADER);
    const again = await completeClientDocumentUpload(CLIENT, started.id, { title: "Outro nome", category: "Outro" }, UPLOADER);
    expect(again.id).toBe(first.id);
    expect(again.name).toBe("Termo");
    expect((await events(CLIENT, "document.added")).filter((e) => e.entityId === first.id)).toHaveLength(1);
  });

  it("sem nome e categoria, vale a sugestão pelo nome do arquivo", async () => {
    const d = await sendWhole(CLIENT, "Cartão CNPJ.pdf", randomBytes(2048));
    expect(d).toMatchObject({ name: "Cartão CNPJ", category: "Cartão CNPJ", version: 1 });
  });

  it("mesmo nome (sem diferença de maiúsculas e acentos) vira nova versão, inclusive entre link e arquivo", async () => {
    const v2 = await sendWhole(CLIENT, "cnpj-atualizado.pdf", randomBytes(3000), { title: "cartao cnpj" });
    expect(v2.version).toBe(2);
    await create<Document>(COLLECTIONS.documents, { clientId: CLIENT, entityType: "client", entityId: CLIENT, name: "Cartão CNPJ", url: "https://drive.example/cnpj", version: 3, uploadedBy: UPLOADER.id, createdBy: UPLOADER.id });
    expect(await nextDocumentVersion(CLIENT, "CARTÃO  CNPJ")).toBe(4);
  });

  it("arquivo repetido no mesmo cliente é recusado; em outro cliente, pode", async () => {
    const bytes = randomBytes(4096);
    await sendWhole(CLIENT, "alvara.pdf", bytes);
    await expect(startClientDocumentUpload(CLIENT, { name: "alvara-copia.pdf", size: bytes.byteLength, sha256: sha(bytes) }, OTHER)).rejects.toThrow(/já está nos documentos do cliente/);
    const elsewhere = await sendWhole(CLIENT_ORPHAN, "alvara.pdf", bytes);
    expect(elsewhere.clientId).toBe(CLIENT_ORPHAN);
  });

  it("recusa tipo não aceito e arquivo vazio antes de abrir o envio", async () => {
    await expect(startClientDocumentUpload(CLIENT, { name: "pagina.html", size: 10, sha256: sha(Buffer.from("x")) }, UPLOADER)).rejects.toThrow(/não são aceitos/);
    await expect(startClientDocumentUpload(CLIENT, { name: "vazio.pdf", size: 0, sha256: sha(Buffer.alloc(0)) }, UPLOADER)).rejects.toThrow(/vazio/);
  });

  it("arquivo concluído sem documento (a conclusão caiu no meio) ganha o documento no próximo envio do mesmo arquivo, com o autor certo", async () => {
    const bytes = randomBytes(1500);
    const started = await startClientDocumentUpload(CLIENT_ORPHAN, { name: "procuracao.pdf", size: bytes.byteLength, sha256: sha(bytes) }, UPLOADER);
    await putClientDocumentChunk(CLIENT_ORPHAN, started.id, 0, bytes, UPLOADER);
    // Só o arquivo é concluído (sem criar o documento), como se a função tivesse caído logo depois.
    const { file } = await completeFile({ ownerKind: "client_document", ownerId: CLIENT_ORPHAN, fileId: started.id }, UPLOADER.id);
    expect(await getById<Document>(COLLECTIONS.documents, started.id)).toBeNull();
    // Outra pessoa envia o mesmo arquivo: o documento é recuperado, mas o autor continua sendo quem enviou.
    await expect(startClientDocumentUpload(CLIENT_ORPHAN, { name: "procuracao.pdf", size: bytes.byteLength, sha256: sha(bytes) }, OTHER)).rejects.toThrow(/agora está na lista/);
    expect(await doc(started.id)).toMatchObject({ name: "Procuração", category: "Procuração", fileId: started.id, version: 1, uploadedBy: UPLOADER.id, createdAt: file.completedAt });
    const added = (await events(CLIENT_ORPHAN, "document.added")).filter((e) => e.entityId === started.id);
    expect(added).toHaveLength(1);
    expect(added[0].actorId).toBe(UPLOADER.id);
  });

  it("cliente que não existe: não abre envio (ninguém ocupa espaço com arquivo invisível)", async () => {
    await expect(startClientDocumentUpload(`${RUN}_nao_existe`, { name: "x.pdf", size: 10, sha256: sha(Buffer.from("fantasma")) }, UPLOADER)).rejects.toThrow(/Cliente não encontrado/);
  });

  it("limite de espaço por cliente (ativos + envios em andamento)", async () => {
    const small = randomBytes(3000);
    await expect(startClientDocumentUpload(CLIENT_ORPHAN, { name: "grande.pdf", size: small.byteLength, sha256: sha(small) }, UPLOADER, new Date(), { clientMaxBytes: 4000 })).rejects.toThrow(/limite de 4 KB por cliente/);
  });

  it("aberturas de envio ao mesmo tempo (mais que as conexões do pool) não travam o processo", async () => {
    const starts = Array.from({ length: 8 }, (_, i) => {
      const bytes = Buffer.from(`concorrente-${RUN}-${i}`);
      return startClientDocumentUpload(CLIENT_POOL, { name: `doc-${i}.pdf`, size: bytes.byteLength, sha256: sha(bytes) }, { id: `${RUN}_u${i}`, name: `Pessoa ${i}` });
    });
    const outcome = await Promise.race([Promise.all(starts).then((files) => files.length), new Promise<string>((resolve) => setTimeout(() => resolve("travou"), 20_000))]);
    expect(outcome).toBe(8);
  });

  it("nova tentativa que chega junto com a anterior (mesma pessoa, mesmo arquivo): a anterior é descartada e a nova abre", async () => {
    const sql = docdb.sql();
    // Segura a trava de abertura para que as duas tentativas passem do descarte antes de qualquer uma abrir o envio.
    let release!: () => void;
    const held = new Promise<void>((resolve) => (release = resolve));
    let ready!: () => void;
    const locked = new Promise<void>((resolve) => (ready = resolve));
    const holder = sql.begin(async (tx) => {
      await tx`select pg_advisory_xact_lock(hashtextextended(${`${COLLECTIONS.storedFiles}/__abertura_de_envio__`}, 0))`;
      ready();
      await held;
    });
    const waiting = async (n: number) => {
      for (let i = 0; i < 200; i++) {
        const [row] = (await sql`select count(*)::int as n from pg_locks where locktype = 'advisory' and not granted`) as unknown as { n: number }[];
        if (row.n >= n) return;
        await new Promise((resolve) => setTimeout(resolve, 25));
      }
    };
    await locked;
    const bytes = Buffer.from(`sobreposta-${RUN}`);
    const start = () => startClientDocumentUpload(CLIENT_POOL, { name: "sobreposta.pdf", size: bytes.byteLength, sha256: sha(bytes) }, UPLOADER);
    const first = start();
    await waiting(1);
    const second = start();
    await waiting(2);
    release();
    await holder;
    const [a, b] = await Promise.allSettled([first, second]);
    expect([a.status, b.status]).toEqual(["fulfilled", "fulfilled"]);
    const files = (await list<StoredFile>(COLLECTIONS.storedFiles, { where: [["ownerId", "==", CLIENT_POOL]] })).filter((f) => f.sha256 === sha(bytes));
    expect(files.map((f) => f.status).sort()).toEqual(["enviando", "removido"]);
  });

  it("duas conclusões ao mesmo tempo (nova tentativa do navegador): um documento v1 e um registro só", async () => {
    const bytes = randomBytes(3 * 1024 * 1024);
    const started = await startClientDocumentUpload(CLIENT_POOL, { name: "alvara-2026.pdf", size: bytes.byteLength, sha256: sha(bytes) }, UPLOADER);
    for (let i = 0; i < started.chunkCount; i++) await putClientDocumentChunk(CLIENT_POOL, started.id, i, bytes.subarray(i * started.chunkSize, (i + 1) * started.chunkSize), UPLOADER);
    const [a, b] = await Promise.all([
      completeClientDocumentUpload(CLIENT_POOL, started.id, { title: "Alvará 2026" }, UPLOADER),
      completeClientDocumentUpload(CLIENT_POOL, started.id, { title: "Alvará 2026" }, UPLOADER),
    ]);
    expect(a.id).toBe(started.id);
    expect(b.id).toBe(started.id);
    expect(await doc(started.id)).toMatchObject({ version: 1, name: "Alvará 2026" });
    expect((await events(CLIENT_POOL, "document.added")).filter((e) => e.entityId === started.id)).toHaveLength(1);
  });

  it("limite de arquivos por cliente (ativos + envios em andamento)", async () => {
    for (let i = 0; i < CLIENT_DOCUMENT_MAX_FILES; i++) {
      await create<StoredFile>(COLLECTIONS.storedFiles, {
        ownerKind: "client_document",
        ownerId: CLIENT_CAP,
        name: `f${i}.pdf`,
        mimeType: "application/pdf",
        size: 1,
        sha256: sha(Buffer.from(`cap-${RUN}-${i}`)),
        chunkSize: 2 * 1024 * 1024,
        chunkCount: 1,
        status: "ativo",
        uploadedById: UPLOADER.id,
        uploadedByName: UPLOADER.name,
        completedAt: new Date().toISOString(),
      } as never);
    }
    await expect(sendWhole(CLIENT_CAP, "mais-um.pdf", randomBytes(100))).rejects.toThrow(new RegExp(`já tem ${CLIENT_DOCUMENT_MAX_FILES} arquivos`));
  });
});

describe("remover", () => {
  it("outra pessoa não remove; quem enviou remove na primeira hora: conteúdo apagado e registro no documento e no histórico", async () => {
    const d = await sendWhole(CLIENT, "comprovante-endereco.pdf", randomBytes(6000));
    await expect(removeClientDocument(CLIENT, d.id, "não é meu", OTHER, viewer(OTHER.id))).rejects.toThrow(/Só quem enviou/);
    await expect(removeClientDocument(CLIENT, d.id, "curto", UPLOADER, viewer(UPLOADER.id), new Date(Date.now() + CLIENT_DOCUMENT_UNDO_MS + 60_000))).rejects.toThrow(/Só quem enviou/);
    await expect(removeClientDocument(CLIENT, d.id, "abc", UPLOADER, viewer(UPLOADER.id))).rejects.toThrow(/mínimo de 5/);
    const removed = await removeClientDocument(CLIENT, d.id, "Arquivo de outro cliente", UPLOADER, viewer(UPLOADER.id));
    expect(removed).toMatchObject({ status: "removido", removedById: UPLOADER.id, removedByName: UPLOADER.name, removedReason: "Arquivo de outro cliente" });
    expect(await doc(d.id)).toMatchObject({ status: "removido", removedReason: "Arquivo de outro cliente" });
    expect(await getActiveClientDocumentFile(CLIENT, d.id)).toBeNull();
    const file = await getById<StoredFile>(COLLECTIONS.storedFiles, d.id);
    expect(file?.status).toBe("removido");
    const logged = (await events(CLIENT, "document.removed")).filter((e) => e.entityId === d.id);
    expect(logged).toHaveLength(1);
    expect(logged[0].description).toBe("Motivo: Arquivo de outro cliente");
    await expect(removeClientDocument(CLIENT, d.id, "de novo, por favor", MANAGER, viewer(MANAGER.id, true))).rejects.toThrow(/já foi removido/);
  });

  it("duas remoções ao mesmo tempo: uma vale, a outra recebe \"já foi removido\" e o histórico registra uma vez", async () => {
    const d = await sendWhole(CLIENT, "certidao-negativa.pdf", randomBytes(900));
    const results = await Promise.allSettled([
      removeClientDocument(CLIENT, d.id, "Certidão vencida", MANAGER, viewer(MANAGER.id, true)),
      removeClientDocument(CLIENT, d.id, "Outro motivo qualquer", { id: `${RUN}_ger2`, name: "Outro gestor" }, viewer(`${RUN}_ger2`, true)),
    ]);
    expect(results.filter((r) => r.status === "fulfilled")).toHaveLength(1);
    const rejected = results.find((r) => r.status === "rejected") as PromiseRejectedResult;
    expect(String(rejected.reason)).toMatch(/já foi removido/);
    expect((await events(CLIENT, "document.removed")).filter((e) => e.entityId === d.id)).toHaveLength(1);
  });

  it("gestor remove depois da primeira hora, inclusive link; documento de contrato não sai por aqui", async () => {
    const d = await sendWhole(CLIENT, "certidao.pdf", randomBytes(700));
    const later = new Date(Date.now() + 3 * CLIENT_DOCUMENT_UNDO_MS);
    await expect(removeClientDocument(CLIENT, d.id, "Certidão vencida", UPLOADER, viewer(UPLOADER.id), later)).rejects.toThrow(/Só quem enviou/);
    expect((await removeClientDocument(CLIENT, d.id, "Certidão vencida", MANAGER, viewer(MANAGER.id, true), later)).status).toBe("removido");

    const link = await create<Document>(COLLECTIONS.documents, { clientId: CLIENT, entityType: "client", entityId: CLIENT, name: "Pasta no Drive", url: "https://drive.example/pasta", version: 1, uploadedBy: OTHER.id, createdBy: OTHER.id });
    expect((await removeClientDocument(CLIENT, link.id, "Pasta antiga", MANAGER, viewer(MANAGER.id, true))).status).toBe("removido");

    const contractDoc = await create<Document>(COLLECTIONS.documents, { clientId: CLIENT, entityType: "contract", entityId: "ct1", name: "Contrato assinado", url: "https://assinatura.example/ct1", version: 1, uploadedBy: MANAGER.id, createdBy: MANAGER.id });
    await expect(removeClientDocument(CLIENT, contractDoc.id, "Não deveria sair", MANAGER, viewer(MANAGER.id, true))).rejects.toThrow(/pertence a outro registro/);
    await expect(removeClientDocument(CLIENT_ORPHAN, d.id, "Cliente errado", MANAGER, viewer(MANAGER.id, true))).rejects.toThrow(/não encontrado/);
  });
});

it("lista da aba: ativos primeiro (mais recentes antes), removidos no fim; remover só o que a pessoa pode", async () => {
  const docs = await list<Document>(COLLECTIONS.documents, { where: [["clientId", "==", CLIENT]] });
  const rows = clientDocumentRows(docs, viewer(UPLOADER.id));
  const firstRemoved = rows.findIndex((r) => r.status === "removido");
  expect(firstRemoved).toBeGreaterThan(0);
  expect(rows.slice(firstRemoved).every((r) => r.status === "removido")).toBe(true);
  const activeRows = rows.slice(0, firstRemoved);
  expect(activeRows.map((r) => r.createdAt)).toEqual([...activeRows.map((r) => r.createdAt)].sort().reverse());
  const contract = rows.find((r) => r.name === "Contrato assinado");
  expect(contract).toMatchObject({ linkedTo: "Contrato", removable: false, kind: "link" });
  const mine = rows.find((r) => r.name === "Cartão CNPJ" && r.kind === "arquivo");
  expect(mine).toMatchObject({ removable: true, inline: true, downloadUrl: `${mine?.url}?download=1` });
  expect(rows.find((r) => r.name === "Cartão CNPJ" && r.kind === "link")?.removable).toBe(true);
  const strangers = clientDocumentRows(docs, viewer(OTHER.id));
  expect(strangers.filter((r) => r.removable).every((r) => r.uploadedBy === OTHER.id)).toBe(true);
});
