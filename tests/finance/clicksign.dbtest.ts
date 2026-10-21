/**
 * Clicksign de ponta a ponta no banco (npm run test:db), com a API simulada (fetch falso que responde como a v3):
 * envio do contrato (envelope, documento com metadados, signatários, requisitos, ativação e e-mail), lembrete pela
 * Clicksign, avisos de assinatura (inclusive simultâneos), recusa, finalização com o PDF assinado guardado, aviso de
 * contrato de outro INTEROS e documento criado direto na Clicksign (caixa de entrada com o PDF).
 *
 * Isolamento: configuração `assinatura_eletronica` guardada e devolvida; tudo criado tem prefixo próprio e é apagado;
 * variáveis CLICKSIGN_* e fetch voltam ao normal no fim.
 */
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { docdb } from "@/server/docdb";
import { create, getById, list, update } from "@/server/db";
import { COLLECTIONS, type Client, type Contract, type DomainEvent, type Document, type Notification, type SignatureInboxItem, type User } from "@/domain/types";
import { SIGNATURE_SETTING } from "@/domain/contract-templates";
import { saveSignatureSettings } from "@/server/finance/contract-templates";
import { addSigner, createManualContract, sendForSignature, sendSignatureReminder, updateContractItems } from "@/server/finance/service";
import { contractSignedFileId, getSignedFile, inboxSignedFileId, processClicksignWebhook } from "@/server/finance/signature-webhook";
import { parseClicksignWebhook } from "@/server/integrations/clicksign";

const RUN = `t${Date.now().toString(36)}`;
const ACTOR = { id: `${RUN}_fin`, name: "Financeiro Teste" };
const OWNER_ID = `${RUN}_owner`;
const CLIENT_ID = `${RUN}_cli`;
/** A Clicksign não aceita números no nome do signatário: o nome do cliente de teste usa só letras. */
const LETTERS = RUN.replace(/\d/g, (d) => "abcdefghij"[Number(d)]);
const PDF = Buffer.from("%PDF-1.4 assinado pela Clicksign");
const savedEnv = { ...process.env };
let settingsBackup: unknown = undefined;
const contractIds: string[] = [];
const inboxKeys: string[] = [];

/** API v3 falsa: guarda as chamadas e devolve ids previsíveis. */
const calls: { method: string; path: string; body?: Record<string, unknown> }[] = [];
let seq = 0;
function fakeFetch(url: string, init: RequestInit = {}): Promise<Response> {
  if (url.startsWith("https://files.clicksign.test/")) return Promise.resolve(new Response(new Uint8Array(PDF), { status: 200, headers: { "content-type": "application/pdf" } }));
  const path = url.replace("https://sandbox.clicksign.com/api/v3", "");
  const method = init.method ?? "GET";
  calls.push({ method, path, body: init.body ? (JSON.parse(String(init.body)) as Record<string, unknown>) : undefined });
  const json = (data: unknown, status = 201) => Promise.resolve(new Response(JSON.stringify({ data }), { status }));
  if (method === "POST" && path === "/envelopes") return json({ id: `${RUN}-env-${++seq}`, type: "envelopes" });
  if (method === "POST" && /\/documents$/.test(path)) return json({ id: `${RUN}-doc-${++seq}`, type: "documents" });
  if (method === "POST" && /\/signers$/.test(path)) return json({ id: `${RUN}-sig-${++seq}`, type: "signers" });
  const doc = path.match(/^\/envelopes\/[^/]+\/documents\/([^/]+)$/);
  if (method === "GET" && doc) return json({ id: doc[1], type: "documents", attributes: { status: "closed" }, links: { files: { signed: `https://files.clicksign.test/${doc[1]}.pdf` } } }, 200);
  return json({ id: "ok", type: "x" }, 200);
}

function hook(body: Record<string, unknown>) {
  const parsed = parseClicksignWebhook(body);
  if (!parsed) throw new Error("aviso inválido");
  return parsed;
}

async function newContract(): Promise<Contract> {
  const c = await createManualContract({ clientId: CLIENT_ID, recurrence: "mensal", termMonths: 12, billingDay: 10 }, ACTOR);
  contractIds.push(c.id);
  await update<Contract>(COLLECTIONS.contracts, c.id, { ownerId: OWNER_ID });
  await updateContractItems(c.id, [{ productId: "p1", productName: "INTEROS Gestão", quantity: 1, setupValue: 0, monthlyValue: 200, hardwareValue: 0, discountPct: 0 }] as never, ACTOR);
  await addSigner({ contractId: c.id, name: "Maria Silva", email: `maria.${RUN}@acme-teste.com.br`, role: "Sócia-administradora" }, ACTOR);
  return (await getById<Contract>(COLLECTIONS.contracts, c.id))!;
}

async function eventsOf(contractId: string, type: string): Promise<DomainEvent[]> {
  return (await list<DomainEvent>(COLLECTIONS.events, { where: [["entityId", "==", contractId]] })).filter((e) => e.type === type);
}

beforeAll(async () => {
  if (!process.env.DATABASE_URL) throw new Error("Defina DATABASE_URL (veja scripts/db-local.sh)");
  process.env.CLICKSIGN_API_TOKEN = "tok-teste";
  process.env.CLICKSIGN_ENV = "sandbox";
  vi.stubGlobal("fetch", vi.fn(fakeFetch));
  const [row] = (await docdb.sql()`select data from interos.settings where data->>'key' = ${SIGNATURE_SETTING}`) as unknown as { data: unknown }[];
  settingsBackup = row ? row.data : null;
  await create<User>(COLLECTIONS.users, { name: "Dono Teste", email: `${RUN}.dono@intercert.com.br`, role: "financeiro", departmentId: "financeiro", active: true } as Omit<User, "id" | "organizationId" | "createdAt" | "updatedAt">, OWNER_ID);
  await create<Client>(COLLECTIONS.clients, { legalName: `ACME ${LETTERS} LTDA`, tradeName: `ACME ${LETTERS}`, document: "12345678000190", status: "ativo", email: `${RUN}@acme-teste.com.br`, address: { city: "Crato", state: "CE" }, mrr: 0, tags: [] } as never, CLIENT_ID);
  // Quem assina pela Intercert: nome sem números (a Clicksign exige nome e sobrenome).
  await saveSignatureSettings({ companySigner: { enabled: true, name: "Diretor Teste", email: `${RUN}.diretor@intercert.com.br`, role: "Diretor" }, defaultAuth: "email" }, ACTOR);
});

afterAll(async () => {
  vi.unstubAllGlobals();
  process.env = { ...savedEnv };
  const sql = docdb.sql();
  if (settingsBackup === null) await sql`delete from interos.settings where data->>'key' = ${SIGNATURE_SETTING}`;
  else if (settingsBackup) await sql`update interos.settings set data = ${sql.json(settingsBackup as never)} where data->>'key' = ${SIGNATURE_SETTING}`;
  if (contractIds.length) {
    await sql`delete from interos.signed_files where data->>'ownerId' = any(${contractIds})`;
    await sql`delete from interos.billing where data->>'contractId' = any(${contractIds})`;
    await sql`delete from interos.contracts where id = any(${contractIds})`;
  }
  const inboxIds = inboxKeys.map((k) => `clicksign_${k}`);
  if (inboxIds.length) {
    await sql`delete from interos.signed_files where data->>'ownerId' = any(${inboxIds})`;
    await sql`delete from interos.signature_inbox where id = any(${inboxIds})`;
  }
  await sql`delete from interos.documents where data->>'clientId' = ${CLIENT_ID}`;
  await sql`delete from interos.notifications where data->>'userId' = ${OWNER_ID} or data->>'entityId' = any(${contractIds})`;
  await sql`delete from interos.clients where id = ${CLIENT_ID}`;
  await sql`delete from interos.users where id = ${OWNER_ID}`;
});

describe("Clicksign: envio e avisos", () => {
  let contract: Contract;

  it("enviar para assinatura cria o envelope completo na Clicksign e guarda os ids", async () => {
    contract = await newContract();
    calls.length = 0;
    const sent = await sendForSignature(contract.id, ACTOR);
    contract = sent;
    expect(sent.signers.length).toBeGreaterThanOrEqual(2);
    expect(sent.signatureProvider).toBe("clicksign");
    expect(sent.signatureEnvelopeId).toMatch(/-env-/);
    expect(sent.signatureDocumentId).toMatch(/-doc-/);
    expect(sent.signers.every((s) => s.providerSignerId)).toBe(true);
    const env = sent.signatureEnvelopeId!;
    expect(calls.map((c) => `${c.method} ${c.path.replace(env, "E")}`)).toEqual([
      "POST /envelopes",
      "POST /envelopes/E/documents",
      // Um por signatário (cliente, contato e quem assina pela Intercert): papel + autenticação.
      ...Array.from({ length: sent.signers.length }, () => ["POST /envelopes/E/signers", "POST /envelopes/E/requirements", "POST /envelopes/E/requirements"]).flat(),
      "PATCH /envelopes/E",
      "POST /envelopes/E/notifications",
    ]);
    const docAttrs = (calls[1].body!.data as { attributes: Record<string, unknown> }).attributes;
    expect(docAttrs.metadata).toEqual({ interos_contract_id: contract.id, interos_number: contract.number, interos_version: String(sent.version) });
    expect(String(docAttrs.content_base64)).toMatch(/^data:application\/pdf;base64,JVBERi/);
    const reqs = calls.filter((c) => c.path.endsWith("/requirements")).map((c) => (c.body!.data as { attributes: Record<string, string> }).attributes);
    expect(reqs).toEqual(expect.arrayContaining([{ action: "agree", role: "contractee" }, { action: "agree", role: "contractor" }, { action: "provide_evidence", auth: "email" }]));
  });

  it("lembrete sai pela Clicksign para o signatário certo", async () => {
    calls.length = 0;
    const maria = contract.signers.find((s) => s.email.startsWith("maria."))!;
    expect(await sendSignatureReminder(contract.id, maria.email, ACTOR)).toEqual({ delivered: true, manual: false });
    expect(calls.map((c) => `${c.method} ${c.path}`)).toEqual([`POST /envelopes/${contract.signatureEnvelopeId}/signers/${maria.providerSignerId}/notifications`]);
  });

  it("aviso de assinatura marca o signatário (idempotente) e não fecha o contrato antes de todos", async () => {
    const maria = contract.signers.find((s) => s.email.startsWith("maria."))!;
    const body = { event: { name: "sign", occurred_at: "2026-10-21T13:00:00.000Z", data: { signer: { key: maria.providerSignerId, email: maria.email, name: maria.name } } }, document: { key: contract.signatureDocumentId, metadata: { interos_contract_id: contract.id, interos_version: contract.version } } };
    expect((await processClicksignWebhook(hook(body))).message).toBe("Assinatura registrada");
    expect((await processClicksignWebhook(hook(body))).message).toBe("Assinatura já registrada");
    const after = (await getById<Contract>(COLLECTIONS.contracts, contract.id))!;
    expect(after.signers.find((s) => s.email === maria.email)).toMatchObject({ status: "assinado", method: "provedor", signedAt: "2026-10-21T13:00:00.000Z" });
    expect(after.signedAt).toBeUndefined();
    expect(after.status).toBe("aguardando_assinatura");
  });

  it("assinatura e finalização chegando juntas: contrato assinado uma vez só, com o PDF assinado guardado", async () => {
    const diretor = contract.signers.find((s) => s.party === "contratada")!;
    const doc = { key: contract.signatureDocumentId, metadata: { interos_contract_id: contract.id, interos_version: contract.version } };
    const results = await Promise.all([
      processClicksignWebhook(hook({ event: { name: "sign", occurred_at: "2026-10-21T14:00:00.000Z", data: { signer: { email: diretor.email, name: diretor.name } } }, document: doc })),
      processClicksignWebhook(hook({ event: { name: "auto_close", occurred_at: "2026-10-21T14:00:01.000Z" }, document: { ...doc, finished_at: "2026-10-21T14:00:01.000Z" } })),
      processClicksignWebhook(hook({ event: { name: "document_closed", occurred_at: "2026-10-21T14:00:05.000Z" }, document: doc })),
    ]);
    expect(results.every((r) => r.handled === "contract")).toBe(true);
    const after = (await getById<Contract>(COLLECTIONS.contracts, contract.id))!;
    expect(after.status).toBe("assinado");
    expect(after.signedAt).toBeTruthy();
    expect(after.signers.every((s) => s.status === "assinado" && s.method === "provedor")).toBe(true);
    expect(await eventsOf(contract.id, "contract.signed")).toHaveLength(1);
    const signedDocs = (await list<Document>(COLLECTIONS.documents, { where: [["entityId", "==", contract.id]] })).filter((d) => d.category === "Contrato assinado");
    expect(signedDocs.map((d) => d.url)).toEqual([`/api/financeiro/contratos/${contract.id}/assinado`]);
    const file = await getSignedFile(contractSignedFileId(after));
    expect(file).toMatchObject({ ownerType: "contract", ownerId: contract.id, mimeType: "application/pdf", size: PDF.length });
    expect(Buffer.from(file!.contentBase64, "base64").equals(PDF)).toBe(true);
    // Reenvio da finalização: nada muda.
    await processClicksignWebhook(hook({ event: { name: "close" }, document: doc }));
    expect(await eventsOf(contract.id, "contract.signed")).toHaveLength(1);
  });

  it("recusa marca o signatário e avisa o dono do contrato; aviso de outra versão é ignorado", async () => {
    const c = await sendForSignature((await newContract()).id, ACTOR);
    const maria = c.signers.find((s) => s.email.startsWith("maria."))!;
    const doc = { key: c.signatureDocumentId, metadata: { interos_contract_id: c.id, interos_version: c.version } };
    const old = await processClicksignWebhook(hook({ event: { name: "sign", data: { signer: { email: maria.email } } }, document: { ...doc, metadata: { interos_contract_id: c.id, interos_version: c.version + 5 } } }));
    expect(old.message).toMatch(/ignorado/);
    const r = await processClicksignWebhook(hook({ event: { name: "refusal", data: { signer: { email: maria.email, name: maria.name }, refusal: { reasons: ["Conteúdo do documento"], comment: "Valor errado" } } }, document: doc }));
    expect(r.message).toBe("Recusa registrada");
    const after = (await getById<Contract>(COLLECTIONS.contracts, c.id))!;
    expect(after.signers.find((s) => s.email === maria.email)?.status).toBe("recusado");
    const notes = await list<Notification>(COLLECTIONS.notifications, { where: [["userId", "==", OWNER_ID]] });
    expect(notes.some((n) => n.title.includes("recusou") && n.body?.includes("Valor errado"))).toBe(true);
  });

  it("contrato de outro INTEROS (id que não existe aqui) é ignorado e não vai para a caixa de entrada", async () => {
    const key = `${RUN}-foreign`;
    const r = await processClicksignWebhook(hook({ event: { name: "sign" }, document: { key, metadata: { interos_contract_id: `${RUN}_nao_existe` } } }));
    expect(r.handled).toBe("ignored");
    expect(await getById<SignatureInboxItem>(COLLECTIONS.signatureInbox, `clicksign_${key}`)).toBeNull();
  });

  it("documento criado direto na Clicksign cai na caixa de entrada e recebe o PDF assinado ao finalizar", async () => {
    const key = `${RUN}-ext`;
    inboxKeys.push(key);
    const signers = [{ key: "a", name: "Maria Silva", email: `${RUN}@acme-teste.com.br` }, { key: "b", name: "Diretor Teste", email: `${RUN}.diretor@intercert.com.br` }];
    const document = { key, filename: "/Aditivo ACME.pdf", status: "running", signers };
    expect((await processClicksignWebhook(hook({ event: { name: "upload" }, document }))).handled).toBe("inbox");
    await processClicksignWebhook(hook({ event: { name: "sign", occurred_at: "2026-10-21T10:00:00.000Z", data: { signer: signers[0] } }, document }));
    let item = (await getById<SignatureInboxItem>(COLLECTIONS.signatureInbox, `clicksign_${key}`))!;
    expect(item).toMatchObject({ name: "Aditivo ACME.pdf", providerStatus: "em_andamento", state: "pendente", suggestedClientId: CLIENT_ID });
    expect(item.signers.find((s) => s.email === signers[0].email)?.signedAt).toBe("2026-10-21T10:00:00.000Z");

    const r = await processClicksignWebhook(hook({ event: { name: "auto_close" }, document: { ...document, status: "closed", finished_at: "2026-10-21T11:00:00.000Z", downloads: { signed_file_url: `https://files.clicksign.test/${key}.pdf` } } }));
    expect(r.message).toMatch(/PDF assinado guardado/);
    item = (await getById<SignatureInboxItem>(COLLECTIONS.signatureInbox, `clicksign_${key}`))!;
    expect(item.providerStatus).toBe("finalizado");
    expect(item.signers.every((s) => s.signedAt)).toBe(true);
    expect(item.signedFileId).toBe(inboxSignedFileId(item.id));
    expect((await getSignedFile(item.signedFileId!))?.size).toBe(PDF.length);
  });
});
