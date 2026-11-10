/**
 * Comprovantes do consentimento LGPD no banco (npm run test:db): envio em partes de 2 MB com conferência do SHA-256,
 * leitura parte a parte e por fluxo, recusas (tamanho da parte, outra pessoa, depois de concluir, hash diferente,
 * arquivo repetido, limite por lead, envios abertos por pessoa, espaço total), registro no histórico que não se perde
 * numa nova tentativa, remoção com registro (quem anexou só na primeira hora; gestor sempre) e a limpeza (envio
 * abandonado, partes que sobraram de uma remoção).
 *
 * Isolamento: leads, arquivos, partes e eventos com prefixo próprio, apagados no fim. As asserções da limpeza olham a
 * situação dos próprios arquivos (outra execução no mesmo banco pode varrer antes).
 */
import { createHash, randomBytes } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { docdb } from "@/server/docdb";
import { create, getById, list } from "@/server/db";
import { COLLECTIONS, type DomainEvent, type Lead, type StoredFile } from "@/domain/types";
import { CONSENT_EVIDENCE_MAX_FILES, CONSENT_EVIDENCE_UNDO_MS } from "@/domain/consent-evidence";
import { STORED_FILE_CHUNK_BYTES, STORED_FILE_MAX_OPEN_UPLOADS_PER_USER, STORED_FILE_PENDING_TTL_MS, sha256Tag } from "@/domain/stored-files";
import { chunkDocId, readChunk, storedFilesUsage, streamFile, sweepStoredFiles } from "@/server/files/store";
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
const LEAD_CAP = `${RUN}_lead3`;
const LEADS = [LEAD, LEAD_LIMIT, LEAD_CAP];
const UPLOADER = { id: `${RUN}_ana`, name: "Ana Comprovantes" };
const OTHER = { id: `${RUN}_bia`, name: "Bia Outra" };
const MANAGER = { id: `${RUN}_ger`, name: "Gestor Teste" };
const BUSY = { id: `${RUN}_caio`, name: "Caio Ocupado" };
const viewer = (id: string, canRemoveAny = false, canRemoveOwn = true): EvidenceViewer => ({ id, canRemoveAny, canRemoveOwn });
const sha = (bytes: Uint8Array) => sha256Tag(createHash("sha256").update(bytes).digest("hex"));

/** Envia o arquivo inteiro (abre, partes, conclui). */
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

async function leadEvents(leadId: string, type: string): Promise<DomainEvent[]> {
  return (await list<DomainEvent>(COLLECTIONS.events, { where: [["entityId", "==", leadId]] })).filter((e) => e.type === type);
}

beforeAll(async () => {
  if (!process.env.DATABASE_URL) throw new Error("Defina DATABASE_URL (veja scripts/db-local.sh)");
  for (const id of LEADS) {
    await create<Lead>(COLLECTIONS.leads, { name: `Lead ${id}`, origin: "manual", productInterestIds: [], score: 0, temperature: "frio", status: "novo", consent: true } as never, id);
  }
});

afterAll(async () => {
  const sql = docdb.sql();
  const files = (await sql`select id from interos.stored_files where data->>'ownerId' = any(${LEADS})`) as unknown as { id: string }[];
  const ids = files.map((f) => f.id);
  if (ids.length) await sql`delete from interos.stored_file_chunks where data->>'fileId' = any(${ids})`;
  await sql`delete from interos.stored_files where data->>'ownerId' = any(${LEADS})`;
  await sql`delete from interos.events where data->>'entityId' = any(${LEADS})`;
  await sql`delete from interos.leads where id = any(${LEADS})`;
});

describe("comprovantes do consentimento — envio em partes", () => {
  const original = randomBytes(2 * STORED_FILE_CHUNK_BYTES + 12_345);
  let fileId = "";

  it("abre, recebe 3 partes, confere o SHA-256 e ativa; o histórico do lead registra uma vez", async () => {
    const started = await startConsentEvidenceUpload(LEAD, { name: "../print da conversa.PNG", size: original.byteLength, sha256: sha(original) }, UPLOADER);
    expect(started).toMatchObject({ status: "enviando", chunkCount: 3, chunkSize: STORED_FILE_CHUNK_BYTES, name: "print da conversa.PNG", mimeType: "image/png", ownerKind: "lead_consent", ownerId: LEAD, received: [] });
    fileId = started.id;
    for (let i = 0; i < 3; i++) await putConsentEvidenceChunk(LEAD, fileId, i, original.subarray(i * STORED_FILE_CHUNK_BYTES, (i + 1) * STORED_FILE_CHUNK_BYTES), UPLOADER);
    // Reenviar uma parte (nova tentativa) sobrescreve sem duplicar.
    await putConsentEvidenceChunk(LEAD, fileId, 1, original.subarray(STORED_FILE_CHUNK_BYTES, 2 * STORED_FILE_CHUNK_BYTES), UPLOADER);
    expect(await chunkCountInDb(fileId)).toBe(3);
    expect((await storedFile(fileId)).received).toEqual([0, 1, 2]);
    const done = await completeConsentEvidenceUpload(LEAD, fileId, UPLOADER);
    expect(done).toMatchObject({ status: "ativo", size: original.byteLength });
    expect(done.completedAt).toBeTruthy();
    // Concluir de novo devolve o mesmo arquivo, sem outro evento.
    await completeConsentEvidenceUpload(LEAD, fileId, UPLOADER);
    const events = await leadEvents(LEAD, "lead.consent_evidence_added");
    expect(events).toHaveLength(1);
    expect(events[0].payload).toMatchObject({ fileId, sha256: sha(original), size: original.byteLength });
    expect((await storedFile(fileId)).historyLoggedAt).toBeTruthy();
  });

  it("registro no histórico que falhou depois da conclusão é feito na nova tentativa (uma vez só)", async () => {
    const sql = docdb.sql();
    const bytes = randomBytes(700);
    const file = await sendWhole(LEAD, "retentativa.txt", bytes);
    // Simula: a conclusão gravou, mas o evento não chegou a ser registrado.
    await sql`update interos.stored_files set data = data - 'historyLoggedAt' where id = ${file.id}`;
    await sql`delete from interos.events where data->>'entityId' = ${LEAD} and data->'payload'->>'fileId' = ${file.id}`;
    await completeConsentEvidenceUpload(LEAD, file.id, UPLOADER);
    await completeConsentEvidenceUpload(LEAD, file.id, UPLOADER);
    expect((await leadEvents(LEAD, "lead.consent_evidence_added")).filter((e) => e.payload?.fileId === file.id)).toHaveLength(1);
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

  it("recusa parte com tamanho errado, de outra pessoa, faltando partes e depois de concluir", async () => {
    const bytes = randomBytes(STORED_FILE_CHUNK_BYTES + 10);
    const started = await startConsentEvidenceUpload(LEAD, { name: "termo.pdf", size: bytes.byteLength, sha256: sha(bytes) }, UPLOADER);
    await expect(putConsentEvidenceChunk(LEAD, started.id, 0, bytes.subarray(0, 100), UPLOADER)).rejects.toThrow(/incompleta/);
    await expect(putConsentEvidenceChunk(LEAD, started.id, 2, bytes.subarray(0, 10), UPLOADER)).rejects.toThrow(/inválida/);
    await expect(putConsentEvidenceChunk(LEAD, started.id, 0, bytes.subarray(0, STORED_FILE_CHUNK_BYTES), OTHER)).rejects.toThrow(/Só quem começou/);
    await expect(putConsentEvidenceChunk(LEAD_LIMIT, started.id, 0, bytes.subarray(0, STORED_FILE_CHUNK_BYTES), UPLOADER)).rejects.toThrow(/não encontrado/);
    await expect(completeConsentEvidenceUpload(LEAD, started.id, UPLOADER)).rejects.toThrow(/Falta a parte 1 de 2/);
    await putConsentEvidenceChunk(LEAD, started.id, 1, bytes.subarray(STORED_FILE_CHUNK_BYTES), UPLOADER);
    await expect(completeConsentEvidenceUpload(LEAD, started.id, UPLOADER)).rejects.toThrow(/Falta a parte 1 de 2/);
    await putConsentEvidenceChunk(LEAD, started.id, 0, bytes.subarray(0, STORED_FILE_CHUNK_BYTES), UPLOADER);
    await completeConsentEvidenceUpload(LEAD, started.id, UPLOADER);
    await expect(putConsentEvidenceChunk(LEAD, started.id, 0, bytes.subarray(0, STORED_FILE_CHUNK_BYTES), UPLOADER)).rejects.toThrow(/já foi encerrado/);
  });

  it("conteúdo diferente do SHA-256 informado encerra o envio e apaga as partes", async () => {
    const bytes = randomBytes(5000);
    const fake = sha(randomBytes(10));
    const started = await startConsentEvidenceUpload(LEAD, { name: "audio.ogg", size: bytes.byteLength, sha256: fake }, UPLOADER);
    await putConsentEvidenceChunk(LEAD, started.id, 0, bytes, UPLOADER);
    await expect(completeConsentEvidenceUpload(LEAD, started.id, UPLOADER)).rejects.toThrow(/SHA-256 não confere/);
    expect(await storedFile(started.id)).toMatchObject({ status: "removido", removedReason: "Conteúdo diferente do informado (SHA-256)" });
    expect(await chunkCountInDb(started.id)).toBe(0);
    await expect(completeConsentEvidenceUpload(LEAD, started.id, UPLOADER)).rejects.toThrow(/foi removido/);
  });

  it("tipo não aceito, arquivo repetido (anexado ou sendo anexado) e nova tentativa do mesmo arquivo", async () => {
    await expect(startConsentEvidenceUpload(LEAD, { name: "pagina.html", size: 10, sha256: sha(randomBytes(4)) }, UPLOADER)).rejects.toThrow(/não são aceitos/);
    await expect(startConsentEvidenceUpload(LEAD, { name: "copia.png", size: original.byteLength, sha256: sha(original) }, OTHER)).rejects.toThrow(/já está anexado/);
    const bytes = randomBytes(300);
    const first = await startConsentEvidenceUpload(LEAD, { name: "email.eml", size: bytes.byteLength, sha256: sha(bytes) }, UPLOADER);
    await expect(startConsentEvidenceUpload(LEAD, { name: "email.eml", size: bytes.byteLength, sha256: sha(bytes) }, OTHER)).rejects.toThrow(/sendo anexado .* por Ana/);
    const second = await startConsentEvidenceUpload(LEAD, { name: "email.eml", size: bytes.byteLength, sha256: sha(bytes) }, UPLOADER);
    expect(second.id).not.toBe(first.id);
    expect((await storedFile(first.id)).status).toBe("removido");
  });

  it("limite de comprovantes por lead (ativos + envios em andamento)", async () => {
    for (let i = 0; i < CONSENT_EVIDENCE_MAX_FILES; i++) await sendWhole(LEAD_LIMIT, `print-${i}.png`, Buffer.from(`arquivo ${i} ${RUN}`));
    const extra = Buffer.from(`extra ${RUN}`);
    await expect(startConsentEvidenceUpload(LEAD_LIMIT, { name: "extra.png", size: extra.byteLength, sha256: sha(extra) }, UPLOADER)).rejects.toThrow(/limite/);
  });

  it("envios abertos por pessoa: no máximo 10 ao mesmo tempo", async () => {
    for (let i = 0; i < STORED_FILE_MAX_OPEN_UPLOADS_PER_USER; i++) {
      const bytes = Buffer.from(`aberto ${i} ${RUN}`);
      await startConsentEvidenceUpload(LEAD_CAP, { name: `aberto-${i}.txt`, size: bytes.byteLength, sha256: sha(bytes) }, BUSY);
    }
    const more = Buffer.from(`mais um ${RUN}`);
    await expect(startConsentEvidenceUpload(LEAD_CAP, { name: "mais.txt", size: more.byteLength, sha256: sha(more) }, BUSY)).rejects.toThrow(/10 envios de arquivo em andamento/);
    // Outra pessoa continua podendo anexar.
    await expect(startConsentEvidenceUpload(LEAD_CAP, { name: "mais.txt", size: more.byteLength, sha256: sha(more) }, OTHER)).resolves.toMatchObject({ status: "enviando" });
  });

  it("espaço total da organização: recusa o que não cabe", async () => {
    const used = await storedFilesUsage();
    const bytes = Buffer.from(`cabe ${RUN}`);
    await expect(startConsentEvidenceUpload(LEAD_CAP, { name: "nao-cabe.txt", size: 500, sha256: sha(randomBytes(8)) }, OTHER, new Date(), { orgMaxBytes: used + 100 })).rejects.toThrow(/espaço para arquivos .* está cheio/);
    await expect(startConsentEvidenceUpload(LEAD_CAP, { name: "cabe.txt", size: bytes.byteLength, sha256: sha(bytes) }, OTHER, new Date(), { orgMaxBytes: used + 100 })).resolves.toMatchObject({ status: "enviando" });
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
    expect(removed.purgePending).toBeUndefined();
    expect(removed.removalLoggedAt).toBeTruthy();
    expect(await chunkCountInDb(file.id)).toBe(0);
    expect(await getActiveConsentEvidence(LEAD, file.id)).toBeNull();
    await expect(removeConsentEvidence(LEAD, file.id, "de novo, por engano", MANAGER, viewer(MANAGER.id, true), late)).rejects.toThrow(/já foi removido/);

    const events = await leadEvents(LEAD, "lead.consent_evidence_removed");
    expect(events.map((e) => e.payload?.fileId).sort()).toEqual([file.id, own.id].sort());
  });

  it("remoção gravada sem o registro no histórico: a nova tentativa de quem removeu registra (outra pessoa não)", async () => {
    const sql = docdb.sql();
    const file = await sendWhole(LEAD, "registro.txt", randomBytes(600));
    await removeConsentEvidence(LEAD, file.id, "Teste do registro", MANAGER, viewer(MANAGER.id, true));
    await sql`update interos.stored_files set data = data - 'removalLoggedAt' where id = ${file.id}`;
    await sql`delete from interos.events where data->>'entityId' = ${LEAD} and data->>'type' = 'lead.consent_evidence_removed' and data->'payload'->>'fileId' = ${file.id}`;
    await expect(removeConsentEvidence(LEAD, file.id, "Outra pessoa tentando", UPLOADER, viewer(UPLOADER.id, true))).rejects.toThrow(/já foi removido/);
    await removeConsentEvidence(LEAD, file.id, "Teste do registro", MANAGER, viewer(MANAGER.id, true));
    const events = (await leadEvents(LEAD, "lead.consent_evidence_removed")).filter((e) => e.payload?.fileId === file.id);
    expect(events).toHaveLength(1);
    expect(events[0].description).toBe("Motivo: Teste do registro");
  });

  it("a ficha lista ativos primeiro e removidos com o registro; envios não concluídos ficam de fora", async () => {
    const rows = await listConsentEvidence(LEAD, viewer(UPLOADER.id));
    const statuses = rows.map((r) => r.status);
    expect(statuses.indexOf("removido")).toBeGreaterThan(statuses.lastIndexOf("ativo"));
    expect(rows.every((r) => r.status === "ativo" || r.removedReason)).toBe(true);
    const all = await list<StoredFile>(COLLECTIONS.storedFiles, { where: [["ownerId", "==", LEAD]] });
    const hidden = all.filter((f) => f.status === "enviando" || (f.status === "removido" && !f.completedAt));
    expect(hidden.length).toBeGreaterThan(0);
    expect(rows.some((r) => hidden.some((p) => p.id === r.id))).toBe(false);
    expect(rows.find((r) => r.name === "print da conversa.PNG")).toMatchObject({ inline: true, status: "ativo" });
  });

  it("limpeza: envio abandonado (mais de 2 h) é descartado; partes que sobraram de remoção são apagadas", async () => {
    const sql = docdb.sql();
    const bytes = randomBytes(STORED_FILE_CHUNK_BYTES + 1);
    const stale = await startConsentEvidenceUpload(LEAD, { name: "parado.mp4", size: bytes.byteLength, sha256: sha(bytes) }, OTHER);
    await putConsentEvidenceChunk(LEAD, stale.id, 0, bytes.subarray(0, STORED_FILE_CHUNK_BYTES), OTHER);
    const old = new Date(Date.now() - STORED_FILE_PENDING_TTL_MS - 60_000).toISOString();
    await sql`update interos.stored_files set data = jsonb_set(data, '{createdAt}', to_jsonb(${old}::text)) where id = ${stale.id}`;

    const leftover = await sendWhole(LEAD, "sobra.txt", Buffer.from(`sobra ${RUN}`));
    await removeConsentEvidence(LEAD, leftover.id, "teste de sobra", MANAGER, viewer(MANAGER.id, true));
    // Simula a remoção interrompida: a parte voltou e a marca de pendência também.
    await sql`update interos.stored_files set data = (data - 'purgedAt') || '{"purgePending": true}'::jsonb where id = ${leftover.id}`;
    await create(COLLECTIONS.storedFileChunks, { fileId: leftover.id, index: 0, size: 1, contentBase64: "QQ==" } as never, chunkDocId(leftover.id, 0));

    const fresh = await startConsentEvidenceUpload(LEAD, { name: "recente.mp3", size: 10, sha256: sha(randomBytes(3)) }, OTHER);
    await sweepStoredFiles(new Date());
    // (A abertura do "recente" já pode ter descartado o abandonado; a varredura completa o resto.)
    expect(await storedFile(stale.id)).toMatchObject({ status: "removido", removedReason: "Envio não concluído" });
    expect(await chunkCountInDb(stale.id)).toBe(0);
    expect((await storedFile(fresh.id)).status).toBe("enviando");
    expect(await chunkCountInDb(leftover.id)).toBe(0);
    const purged = await storedFile(leftover.id);
    expect(purged.purgedAt).toBeTruthy();
    expect(purged.purgePending).toBeUndefined();
  });
});
