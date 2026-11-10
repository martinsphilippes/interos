/**
 * Comprovantes do consentimento LGPD no banco (npm run test:db): envio em partes de 2 MB com conferência do SHA-256,
 * leitura parte a parte e por fluxo, recusas (tamanho da parte, outra pessoa, depois de concluir, hash diferente,
 * arquivo repetido, limite por lead), remoção com registro (quem anexou só na primeira hora; gestor sempre) e a
 * limpeza diária (envio parado há mais de 24 h, partes que sobraram de uma remoção).
 *
 * Isolamento: leads, arquivos, partes e eventos com prefixo próprio, apagados no fim.
 */
import { createHash, randomBytes } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { docdb } from "@/server/docdb";
import { create, getById, list } from "@/server/db";
import { COLLECTIONS, type DomainEvent, type Lead, type StoredFile } from "@/domain/types";
import { CONSENT_EVIDENCE_MAX_FILES, CONSENT_EVIDENCE_UNDO_MS } from "@/domain/consent-evidence";
import { STORED_FILE_CHUNK_BYTES, STORED_FILE_PENDING_TTL_MS, sha256Tag } from "@/domain/stored-files";
import { chunkDocId, readChunk, streamFile, sweepStoredFiles } from "@/server/files/store";
import {
  completeConsentEvidenceUpload,
  getActiveConsentEvidence,
  listConsentEvidence,
  putConsentEvidenceChunk,
  removeConsentEvidence,
  startConsentEvidenceUpload,
  type EvidenceViewer,
} from "@/server/marketing/consent-evidence";

const RUN = `ce${Date.now().toString(36)}`;
const LEAD = `${RUN}_lead`;
const LEAD_LIMIT = `${RUN}_lead2`;
const UPLOADER = { id: `${RUN}_ana`, name: "Ana Comprovantes" };
const OTHER = { id: `${RUN}_bia`, name: "Bia Outra" };
const MANAGER = { id: `${RUN}_ger`, name: "Gestor Teste" };
const viewer = (id: string, canRemoveAny = false, canRemoveOwn = true): EvidenceViewer => ({ id, canRemoveAny, canRemoveOwn });
const sha = (bytes: Uint8Array) => sha256Tag(createHash("sha256").update(bytes).digest("hex"));

/** Envia o arquivo inteiro (abre, partes, conclui) e devolve o id. */
async function sendWhole(leadId: string, name: string, bytes: Buffer, actor = UPLOADER): Promise<StoredFile> {
  const started = await startConsentEvidenceUpload(leadId, { name, size: bytes.byteLength, sha256: sha(bytes) }, actor);
  for (let i = 0; i < started.chunkCount; i++) await putConsentEvidenceChunk(leadId, started.id, i, bytes.subarray(i * started.chunkSize, (i + 1) * started.chunkSize), actor);
  return completeConsentEvidenceUpload(leadId, started.id, actor);
}

async function storedFile(id: string): Promise<StoredFile> {
  const f = await getById<StoredFile>(COLLECTIONS.storedFiles, id);
  if (!f) throw new Error("arquivo sumiu");
  return f;
}

async function chunkCountInDb(fileId: string): Promise<number> {
  const sql = docdb.sql();
  const [row] = (await sql`select count(*)::int as n from interos.stored_file_chunks where data->>'fileId' = ${fileId}`) as unknown as { n: number }[];
  return row.n;
}

beforeAll(async () => {
  if (!process.env.DATABASE_URL) throw new Error("Defina DATABASE_URL (veja scripts/db-local.sh)");
  for (const id of [LEAD, LEAD_LIMIT]) {
    await create<Lead>(COLLECTIONS.leads, { name: `Lead ${id}`, origin: "manual", productInterestIds: [], score: 0, temperature: "frio", status: "novo", consent: true } as never, id);
  }
});

afterAll(async () => {
  const sql = docdb.sql();
  const leads = [LEAD, LEAD_LIMIT];
  const files = (await sql`select id from interos.stored_files where data->>'ownerId' = any(${leads})`) as unknown as { id: string }[];
  const ids = files.map((f) => f.id);
  if (ids.length) await sql`delete from interos.stored_file_chunks where data->>'fileId' = any(${ids})`;
  await sql`delete from interos.stored_files where data->>'ownerId' = any(${leads})`;
  await sql`delete from interos.events where data->>'entityId' = any(${leads})`;
  await sql`delete from interos.leads where id = any(${leads})`;
});

describe("comprovantes do consentimento — envio em partes", () => {
  const original = randomBytes(2 * STORED_FILE_CHUNK_BYTES + 12_345);
  let fileId = "";

  it("abre, recebe 3 partes, confere o SHA-256 e ativa; o histórico do lead registra uma vez", async () => {
    const started = await startConsentEvidenceUpload(LEAD, { name: "../print da conversa.PNG", size: original.byteLength, sha256: sha(original) }, UPLOADER);
    expect(started).toMatchObject({ status: "enviando", chunkCount: 3, chunkSize: STORED_FILE_CHUNK_BYTES, name: "print da conversa.PNG", mimeType: "image/png", ownerKind: "lead_consent", ownerId: LEAD });
    fileId = started.id;
    for (let i = 0; i < 3; i++) await putConsentEvidenceChunk(LEAD, fileId, i, original.subarray(i * STORED_FILE_CHUNK_BYTES, (i + 1) * STORED_FILE_CHUNK_BYTES), UPLOADER);
    // Reenviar uma parte (nova tentativa) sobrescreve sem duplicar.
    await putConsentEvidenceChunk(LEAD, fileId, 1, original.subarray(STORED_FILE_CHUNK_BYTES, 2 * STORED_FILE_CHUNK_BYTES), UPLOADER);
    expect(await chunkCountInDb(fileId)).toBe(3);
    const done = await completeConsentEvidenceUpload(LEAD, fileId, UPLOADER);
    expect(done).toMatchObject({ status: "ativo", size: original.byteLength });
    expect(done.completedAt).toBeTruthy();
    // Concluir de novo devolve o mesmo arquivo, sem outro evento.
    await completeConsentEvidenceUpload(LEAD, fileId, UPLOADER);
    const events = (await list<DomainEvent>(COLLECTIONS.events, { where: [["entityId", "==", LEAD]] })).filter((e) => e.type === "lead.consent_evidence_added");
    expect(events).toHaveLength(1);
    expect(events[0].payload).toMatchObject({ fileId, sha256: sha(original), size: original.byteLength });
  });

  it("lê de volta parte a parte e por fluxo: o mesmo conteúdo", async () => {
    const file = await getActiveConsentEvidence(LEAD, fileId);
    expect(file).not.toBeNull();
    const parts = [await readChunk(file!, 0), await readChunk(file!, 1), await readChunk(file!, 2)];
    expect(Buffer.concat(parts).equals(original)).toBe(true);
    await expect(readChunk(file!, 3)).rejects.toThrow(/inválida/);
    const streamed = Buffer.from(await new Response(streamFile(file!)).arrayBuffer());
    expect(streamed.equals(original)).toBe(true);
    // Outro lead não enxerga o arquivo.
    expect(await getActiveConsentEvidence(LEAD_LIMIT, fileId)).toBeNull();
  });

  it("recusa parte com tamanho errado, de outra pessoa e depois de concluir", async () => {
    const bytes = randomBytes(STORED_FILE_CHUNK_BYTES + 10);
    const started = await startConsentEvidenceUpload(LEAD, { name: "termo.pdf", size: bytes.byteLength, sha256: sha(bytes) }, UPLOADER);
    await expect(putConsentEvidenceChunk(LEAD, started.id, 0, bytes.subarray(0, 100), UPLOADER)).rejects.toThrow(/incompleta/);
    await expect(putConsentEvidenceChunk(LEAD, started.id, 2, bytes.subarray(0, 10), UPLOADER)).rejects.toThrow(/inválida/);
    await expect(putConsentEvidenceChunk(LEAD, started.id, 0, bytes.subarray(0, STORED_FILE_CHUNK_BYTES), OTHER)).rejects.toThrow(/Só quem começou/);
    await expect(putConsentEvidenceChunk(LEAD_LIMIT, started.id, 0, bytes.subarray(0, STORED_FILE_CHUNK_BYTES), UPLOADER)).rejects.toThrow(/não encontrado/);
    await expect(completeConsentEvidenceUpload(LEAD, started.id, UPLOADER)).rejects.toThrow(/Falta a parte 1 de 2/);
    await putConsentEvidenceChunk(LEAD, started.id, 0, bytes.subarray(0, STORED_FILE_CHUNK_BYTES), UPLOADER);
    await putConsentEvidenceChunk(LEAD, started.id, 1, bytes.subarray(STORED_FILE_CHUNK_BYTES), UPLOADER);
    await completeConsentEvidenceUpload(LEAD, started.id, UPLOADER);
    await expect(putConsentEvidenceChunk(LEAD, started.id, 0, bytes.subarray(0, STORED_FILE_CHUNK_BYTES), UPLOADER)).rejects.toThrow(/já foi encerrado/);
  });

  it("SHA-256 que não confere não ativa o arquivo", async () => {
    const bytes = randomBytes(5000);
    const fake = sha(randomBytes(10));
    const started = await startConsentEvidenceUpload(LEAD, { name: "audio.ogg", size: bytes.byteLength, sha256: fake }, UPLOADER);
    await putConsentEvidenceChunk(LEAD, started.id, 0, bytes, UPLOADER);
    await expect(completeConsentEvidenceUpload(LEAD, started.id, UPLOADER)).rejects.toThrow(/SHA-256 não confere/);
    expect((await storedFile(started.id)).status).toBe("enviando");
  });

  it("tipo não aceito, arquivo repetido e nova tentativa do mesmo arquivo", async () => {
    await expect(startConsentEvidenceUpload(LEAD, { name: "pagina.html", size: 10, sha256: sha(randomBytes(4)) }, UPLOADER)).rejects.toThrow(/não são aceitos/);
    await expect(startConsentEvidenceUpload(LEAD, { name: "copia.png", size: original.byteLength, sha256: sha(original) }, OTHER)).rejects.toThrow(/já está anexado/);
    const bytes = randomBytes(300);
    const first = await startConsentEvidenceUpload(LEAD, { name: "email.eml", size: bytes.byteLength, sha256: sha(bytes) }, UPLOADER);
    const second = await startConsentEvidenceUpload(LEAD, { name: "email.eml", size: bytes.byteLength, sha256: sha(bytes) }, UPLOADER);
    expect(second.id).not.toBe(first.id);
    expect((await storedFile(first.id)).status).toBe("removido");
  });

  it("limite de comprovantes por lead (ativos + envios em andamento)", async () => {
    for (let i = 0; i < CONSENT_EVIDENCE_MAX_FILES; i++) {
      const bytes = Buffer.from(`arquivo ${i} ${RUN}`);
      await startConsentEvidenceUpload(LEAD_LIMIT, { name: `print-${i}.png`, size: bytes.byteLength, sha256: sha(bytes) }, UPLOADER);
    }
    const extra = Buffer.from(`extra ${RUN}`);
    await expect(startConsentEvidenceUpload(LEAD_LIMIT, { name: "extra.png", size: extra.byteLength, sha256: sha(extra) }, UPLOADER)).rejects.toThrow(/limite/);
  });
});

describe("comprovantes do consentimento — remoção e limpeza", () => {
  it("quem anexou remove na primeira hora; outra pessoa não; depois da hora só quem tem a chave", async () => {
    const bytes = randomBytes(3000);
    const file = await sendWhole(LEAD, "whatsapp.jpg", bytes);
    const completed = Date.parse(file.completedAt!);
    const late = new Date(completed + CONSENT_EVIDENCE_UNDO_MS + 60_000);
    await expect(removeConsentEvidence(LEAD, file.id, "anexado por engano", OTHER, viewer(OTHER.id), new Date(completed + 1000))).rejects.toThrow(/Só quem anexou/);
    await expect(removeConsentEvidence(LEAD, file.id, "anexado por engano", UPLOADER, viewer(UPLOADER.id), late)).rejects.toThrow(/Só quem anexou/);
    await expect(removeConsentEvidence(LEAD, file.id, "curt", MANAGER, viewer(MANAGER.id, true), late)).rejects.toThrow(/motivo/);
    expect((await storedFile(file.id)).status).toBe("ativo");

    const own = await sendWhole(LEAD, "termo-assinado.pdf", randomBytes(4000));
    await removeConsentEvidence(LEAD, own.id, "PDF de outro contato", UPLOADER, viewer(UPLOADER.id), new Date(Date.parse(own.completedAt!) + 1000));
    expect(await storedFile(own.id)).toMatchObject({ status: "removido", removedById: UPLOADER.id, removedReason: "PDF de outro contato" });
    expect(await chunkCountInDb(own.id)).toBe(0);

    await removeConsentEvidence(LEAD, file.id, "Comprovante substituído pelo termo", MANAGER, viewer(MANAGER.id, true, false), late);
    const removed = await storedFile(file.id);
    expect(removed).toMatchObject({ status: "removido", removedByName: MANAGER.name, removedReason: "Comprovante substituído pelo termo" });
    expect(removed.thumbnail).toBeUndefined();
    expect(removed.purgedAt).toBeTruthy();
    expect(await chunkCountInDb(file.id)).toBe(0);
    expect(await getActiveConsentEvidence(LEAD, file.id)).toBeNull();
    await expect(removeConsentEvidence(LEAD, file.id, "de novo, por engano", MANAGER, viewer(MANAGER.id, true), late)).rejects.toThrow(/já foi removido/);

    const events = (await list<DomainEvent>(COLLECTIONS.events, { where: [["entityId", "==", LEAD]] })).filter((e) => e.type === "lead.consent_evidence_removed");
    expect(events.map((e) => e.payload?.fileId).sort()).toEqual([file.id, own.id].sort());
  });

  it("a ficha lista ativos primeiro e removidos com o registro; envios não concluídos ficam de fora", async () => {
    const rows = await listConsentEvidence(LEAD, viewer(UPLOADER.id));
    const statuses = rows.map((r) => r.status);
    expect(statuses.indexOf("removido")).toBeGreaterThan(statuses.lastIndexOf("ativo"));
    expect(rows.every((r) => r.status === "ativo" || r.removedReason)).toBe(true);
    const pending = (await list<StoredFile>(COLLECTIONS.storedFiles, { where: [["ownerId", "==", LEAD]] })).filter((f) => f.status === "enviando");
    expect(pending.length).toBeGreaterThan(0);
    expect(rows.some((r) => pending.some((p) => p.id === r.id))).toBe(false);
    const png = rows.find((r) => r.name === "print da conversa.PNG");
    expect(png).toMatchObject({ inline: true, status: "ativo" });
  });

  it("limpeza diária: envio parado há mais de 24 h é descartado; partes que sobraram de remoção são apagadas", async () => {
    const sql = docdb.sql();
    const bytes = randomBytes(STORED_FILE_CHUNK_BYTES + 1);
    const stale = await startConsentEvidenceUpload(LEAD, { name: "parado.mp4", size: bytes.byteLength, sha256: sha(bytes) }, OTHER);
    await putConsentEvidenceChunk(LEAD, stale.id, 0, bytes.subarray(0, STORED_FILE_CHUNK_BYTES), OTHER);
    const old = new Date(Date.now() - STORED_FILE_PENDING_TTL_MS - 60_000).toISOString();
    await sql`update interos.stored_files set data = jsonb_set(data, '{createdAt}', to_jsonb(${old}::text)) where id = ${stale.id}`;

    const fresh = await startConsentEvidenceUpload(LEAD, { name: "recente.mp3", size: 10, sha256: sha(randomBytes(3)) }, OTHER);

    const leftover = await sendWhole(LEAD, "sobra.txt", Buffer.from(`sobra ${RUN}`));
    await removeConsentEvidence(LEAD, leftover.id, "teste de sobra", MANAGER, viewer(MANAGER.id, true));
    // Simula a remoção interrompida: a parte voltou e purgedAt sumiu.
    await sql`update interos.stored_files set data = data - 'purgedAt' where id = ${leftover.id}`;
    await create(COLLECTIONS.storedFileChunks, { fileId: leftover.id, index: 0, size: 1, contentBase64: "QQ==" } as never, chunkDocId(leftover.id, 0));

    const result = await sweepStoredFiles(new Date());
    expect(result.discarded).toBeGreaterThanOrEqual(1);
    expect(result.purged).toBeGreaterThanOrEqual(1);
    expect(await storedFile(stale.id)).toMatchObject({ status: "removido", removedReason: "Envio não concluído" });
    expect(await chunkCountInDb(stale.id)).toBe(0);
    expect((await storedFile(fresh.id)).status).toBe("enviando");
    expect(await chunkCountInDb(leftover.id)).toBe(0);
    expect((await storedFile(leftover.id)).purgedAt).toBeTruthy();
  });
});
