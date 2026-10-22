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
import { COLLECTIONS, type Client, type Contact, type Contract, type ContractTemplate, type DomainEvent, type Document, type Notification, type SignatureInboxItem, type User } from "@/domain/types";
import { SIGNATURE_SETTING } from "@/domain/contract-templates";
import { saveSignatureSettings } from "@/server/finance/contract-templates";
import { addContactAsSigner, addSigner, addSignerFrom, createManualContract, sendForSignature, sendSignatureReminder, updateContractItems } from "@/server/finance/service";
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
/** Modelo padrão que existir no banco: sai de cena durante a suíte (as pendências dele bloqueariam o envio). */
let previousDefault: string | undefined;

/** API v3 falsa: guarda as chamadas e devolve ids previsíveis. */
const calls: { method: string; path: string; body?: Record<string, unknown> }[] = [];
let seq = 0;
/** Gancho do teste: roda quando a API recebe uma chamada (ex.: ler o banco no momento do cancelamento). */
let onCall: ((method: string, path: string) => Promise<void>) | null = null;
/** Simula a Clicksign recusando o cancelamento de documento. */
let failPatch = false;
/** Status do documento devolvido pela API simulada (GET do documento). */
let docStatus = "closed";
async function fakeFetch(url: string, init: RequestInit = {}): Promise<Response> {
  if (url.startsWith("https://files.clicksign.test/")) return new Response(new Uint8Array(PDF), { status: 200, headers: { "content-type": "application/pdf" } });
  const path = url.replace("https://sandbox.clicksign.com/api/v3", "");
  const method = init.method ?? "GET";
  calls.push({ method, path, body: init.body ? (JSON.parse(String(init.body)) as Record<string, unknown>) : undefined });
  if (onCall) await onCall(method, path);
  if (failPatch && method === "PATCH" && path.includes("/documents/")) return new Response(JSON.stringify({ errors: [{ title: "Falha simulada" }] }), { status: 422 });
  const json = (data: unknown, status = 201) => Promise.resolve(new Response(JSON.stringify({ data }), { status }));
  if (method === "POST" && path === "/envelopes") return json({ id: `${RUN}-env-${++seq}`, type: "envelopes" });
  if (method === "POST" && /\/documents$/.test(path)) return json({ id: `${RUN}-doc-${++seq}`, type: "documents" });
  if (method === "POST" && /\/signers$/.test(path)) return json({ id: `${RUN}-sig-${++seq}`, type: "signers" });
  const doc = path.match(/^\/envelopes\/[^/]+\/documents\/([^/]+)$/);
  if (method === "GET" && doc) return json({ id: doc[1], type: "documents", attributes: { status: docStatus }, links: { files: { signed: `https://files.clicksign.test/${doc[1]}.pdf` } } }, 200);
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
  previousDefault = (await list<ContractTemplate>(COLLECTIONS.contractTemplates, { where: [["isDefault", "==", true]] }))[0]?.id;
  if (previousDefault) await docdb.sql()`update interos.contract_templates set data = jsonb_set(data, '{isDefault}', 'false') where id = ${previousDefault}`;
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
  if (previousDefault) await docdb.sql()`update interos.contract_templates set data = jsonb_set(data, '{isDefault}', 'true') where id = ${previousDefault}`;
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
  await sql`delete from interos.contacts where data->>'clientId' = ${CLIENT_ID}`;
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
    expect(docAttrs.metadata).toEqual({ interos_contract_id: contract.id, interos_number: contract.number, interos_version: String(sent.version), interos_envelope_id: sent.signatureEnvelopeId });
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

  it("reenvio na mesma versão: avisos do envio anterior (assinatura, finalização, cancelamento) não mexem no contrato", async () => {
    const first = await sendForSignature((await newContract()).id, ACTOR);
    calls.length = 0;
    // No momento do cancelamento do documento anterior, o contrato já precisa estar gravado com o envio novo.
    let envelopeAtCancel: string | undefined = "nao-cancelou";
    onCall = async (method, path) => {
      if (method === "PATCH" && path === `/envelopes/${first.signatureEnvelopeId}/documents/${first.signatureDocumentId}`) envelopeAtCancel = (await getById<Contract>(COLLECTIONS.contracts, first.id))?.signatureEnvelopeId;
    };
    const second = await sendForSignature(first.id, ACTOR).finally(() => {
      onCall = null;
    });
    expect(second.version).toBe(first.version);
    expect(second.signatureEnvelopeId).not.toBe(first.signatureEnvelopeId);
    expect(envelopeAtCancel).toBe(second.signatureEnvelopeId);
    const maria = first.signers.find((s) => s.email.startsWith("maria."))!;
    const oldByEnvelope = { key: first.signatureDocumentId, metadata: { interos_contract_id: first.id, interos_version: first.version, interos_envelope_id: first.signatureEnvelopeId } };
    const oldByKey = { key: first.signatureDocumentId, metadata: { interos_contract_id: first.id, interos_version: first.version } };
    for (const document of [oldByEnvelope, oldByKey]) {
      for (const event of [{ name: "sign", data: { signer: { email: maria.email } } }, { name: "auto_close" }, { name: "cancel" }]) {
        expect((await processClicksignWebhook(hook({ event, document }))).message).toMatch(/envio anterior/);
      }
    }
    const after = (await getById<Contract>(COLLECTIONS.contracts, first.id))!;
    expect(after.signers.every((s) => s.status === "pendente")).toBe(true);
    expect(after.signedAt).toBeUndefined();
    expect(await eventsOf(first.id, "contract.signed")).toHaveLength(0);
  });

  it("finalização manual (close) com assinatura faltando não assina o contrato: vira nota e aviso", async () => {
    const c = await sendForSignature((await newContract()).id, ACTOR);
    const maria = c.signers.find((s) => s.email.startsWith("maria."))!;
    const document = { key: c.signatureDocumentId, metadata: { interos_contract_id: c.id, interos_version: c.version, interos_envelope_id: c.signatureEnvelopeId } };
    await processClicksignWebhook(hook({ event: { name: "sign", data: { signer: { email: maria.email } } }, document }));
    expect((await processClicksignWebhook(hook({ event: { name: "close" }, document }))).message).toMatch(/sem todas as assinaturas/);
    expect((await processClicksignWebhook(hook({ event: { name: "document_closed" }, document }))).message).toMatch(/sem todas as assinaturas/);
    const after = (await getById<Contract>(COLLECTIONS.contracts, c.id))!;
    expect(after.signedAt).toBeUndefined();
    expect(after.signers.filter((s) => s.status === "assinado").map((s) => s.email)).toEqual([maria.email]);
    expect(await eventsOf(c.id, "contract.signed")).toHaveLength(0);
    const notes = await list<Notification>(COLLECTIONS.notifications, { where: [["entityId", "==", c.id]] });
    expect(notes.some((n) => n.title.includes("sem todas as assinaturas"))).toBe(true);
  });

  it("finalização automática não marca quem entrou no contrato depois do envio", async () => {
    const c = await sendForSignature((await newContract()).id, ACTOR);
    await addSigner({ contractId: c.id, name: "Testemunha Tardia", email: `tardia.${RUN}@acme-teste.com.br`, role: "Testemunha" }, ACTOR);
    const document = { key: c.signatureDocumentId, metadata: { interos_contract_id: c.id, interos_version: c.version, interos_envelope_id: c.signatureEnvelopeId }, signers: c.signers.map((s) => ({ key: s.providerSignerId, name: s.name, email: s.email })) };
    expect((await processClicksignWebhook(hook({ event: { name: "auto_close" }, document }))).message).toMatch(/sem todas as assinaturas/);
    const after = (await getById<Contract>(COLLECTIONS.contracts, c.id))!;
    expect(after.signers.find((s) => s.email.startsWith("tardia."))?.status).toBe("pendente");
    expect(after.signers.filter((s) => s.providerSignerId).every((s) => s.status === "assinado")).toBe(true);
    expect(after.signedAt).toBeUndefined();
    expect(await eventsOf(c.id, "contract.signed")).toHaveLength(0);
  });

  it("anúncio sai do estado gravado: falha depois de gravar é refeita na reentrega, e a reserva evita anúncio duplo", async () => {
    const c = await sendForSignature((await newContract()).id, ACTOR);
    const document = { key: c.signatureDocumentId, metadata: { interos_contract_id: c.id, interos_version: c.version, interos_envelope_id: c.signatureEnvelopeId } };
    // Simula uma execução que gravou a assinatura de todos e caiu antes de anunciar, com a reserva ainda valendo.
    const signers = c.signers.map((s) => ({ ...s, status: "assinado" as const, signedAt: "2026-10-21T15:00:00.000Z", method: "provedor" as const }));
    await update<Contract>(COLLECTIONS.contracts, c.id, { signers, signedAt: "2026-10-21T15:00:00.000Z", status: "assinado", signedAnnounceClaimAt: new Date().toISOString() });
    const maria = c.signers.find((s) => s.email.startsWith("maria."))!;
    const redeliver = () => processClicksignWebhook(hook({ event: { name: "sign", data: { signer: { email: maria.email } } }, document }));
    expect((await redeliver()).message).toBe("Assinatura já registrada");
    expect(await eventsOf(c.id, "contract.signed")).toHaveLength(0);
    // Reserva vencida (a execução caiu): a reentrega anuncia uma vez; as seguintes não repetem.
    await update<Contract>(COLLECTIONS.contracts, c.id, { signedAnnounceClaimAt: new Date(Date.now() - 5 * 60_000).toISOString() });
    const [a, b] = await Promise.all([redeliver(), redeliver()]);
    expect([a.message, b.message].filter((m) => m.includes("assinado por todos"))).toHaveLength(1);
    expect(await eventsOf(c.id, "contract.signed")).toHaveLength(1);
    expect((await getById<Contract>(COLLECTIONS.contracts, c.id))?.signedAnnouncedAt).toBeTruthy();
  });

  it("signatário pendente removido: o próximo aviso conclui e grava o contrato como assinado (uma vez)", async () => {
    const c = await sendForSignature((await newContract()).id, ACTOR);
    const document = { key: c.signatureDocumentId, metadata: { interos_contract_id: c.id, interos_version: c.version, interos_envelope_id: c.signatureEnvelopeId } };
    const [keep, ...rest] = c.signers;
    for (const s of rest) await processClicksignWebhook(hook({ event: { name: "sign", data: { signer: { email: s.email } } }, document }));
    // O pendente que sobrou sai do contrato direto no banco (o que a tela faz ao remover o signatário).
    await update<Contract>(COLLECTIONS.contracts, c.id, { signers: (await getById<Contract>(COLLECTIONS.contracts, c.id))!.signers.filter((s) => s.email !== keep.email) });
    expect((await processClicksignWebhook(hook({ event: { name: "document_closed" }, document }))).message).toMatch(/assinado por todos/);
    await processClicksignWebhook(hook({ event: { name: "auto_close" }, document }));
    const after = (await getById<Contract>(COLLECTIONS.contracts, c.id))!;
    expect(after.status).toBe("assinado");
    expect(after.signedAt).toBeTruthy();
    expect(await eventsOf(c.id, "contract.signed")).toHaveLength(1);
  });

  it("recusa: se a nota falhar depois de gravar, a reentrega refaz; depois disso, não repete", async () => {
    const c = await sendForSignature((await newContract()).id, ACTOR);
    const maria = c.signers.find((s) => s.email.startsWith("maria."))!;
    const document = { key: c.signatureDocumentId, metadata: { interos_contract_id: c.id, interos_version: c.version, interos_envelope_id: c.signatureEnvelopeId } };
    // Simula a execução que gravou a recusa e caiu antes da nota.
    const signers = c.signers.map((s) => (s.email === maria.email ? { ...s, status: "recusado" as const, refusalNoticePending: true } : s));
    await update<Contract>(COLLECTIONS.contracts, c.id, { signers });
    const refusal = () => processClicksignWebhook(hook({ event: { name: "refusal", data: { signer: { email: maria.email, name: maria.name }, refusal: { reasons: ["Dados pessoais incorretos"] } } }, document }));
    expect((await refusal()).message).toBe("Recusa registrada");
    expect((await refusal()).message).toBe("Recusa já registrada");
    const notes = (await eventsOf(c.id, "note.added")).filter((e) => e.title.includes("recusou"));
    expect(notes).toHaveLength(1);
    expect((await getById<Contract>(COLLECTIONS.contracts, c.id))?.signers.find((s) => s.email === maria.email)?.refusalNoticePending).toBe(false);
  });

  it("recusa de quem já saiu do contrato: os que ficaram assinaram, então o contrato fecha e é anunciado", async () => {
    const c = await sendForSignature((await newContract()).id, ACTOR);
    const document = { key: c.signatureDocumentId, metadata: { interos_contract_id: c.id, interos_version: c.version, interos_envelope_id: c.signatureEnvelopeId } };
    const [gone, ...rest] = c.signers;
    for (const s of rest) await processClicksignWebhook(hook({ event: { name: "sign", data: { signer: { email: s.email } } }, document }));
    await update<Contract>(COLLECTIONS.contracts, c.id, { signers: (await getById<Contract>(COLLECTIONS.contracts, c.id))!.signers.filter((s) => s.email !== gone.email) });
    await processClicksignWebhook(hook({ event: { name: "refusal", data: { signer: { email: gone.email } } }, document }));
    const after = (await getById<Contract>(COLLECTIONS.contracts, c.id))!;
    expect(after.status).toBe("assinado");
    expect(await eventsOf(c.id, "contract.signed")).toHaveLength(1);
  });

  it("envio que perde a corrida (contrato assinado enquanto o envelope novo era criado) é desfeito, sem sobrescrever", async () => {
    const first = await sendForSignature((await newContract()).id, ACTOR);
    const document = { key: first.signatureDocumentId, metadata: { interos_contract_id: first.id, interos_version: first.version, interos_envelope_id: first.signatureEnvelopeId } };
    // Enquanto o reenvio cria o envelope novo (no POST do documento), todos assinam o envio atual.
    onCall = async (method, path) => {
      if (method === "POST" && path.endsWith("/documents")) {
        onCall = null;
        for (const s of first.signers) await processClicksignWebhook(hook({ event: { name: "sign", data: { signer: { email: s.email } } }, document }));
      }
    };
    calls.length = 0;
    await expect(sendForSignature(first.id, ACTOR)).rejects.toThrow(/mudou durante o envio/);
    onCall = null;
    const after = (await getById<Contract>(COLLECTIONS.contracts, first.id))!;
    expect(after.signatureEnvelopeId).toBe(first.signatureEnvelopeId);
    expect(after.status).toBe("assinado");
    expect(await eventsOf(first.id, "contract.signed")).toHaveLength(1);
    // O envelope novo foi cancelado na Clicksign.
    const newEnvelope = calls.find((c) => c.method === "POST" && c.path === "/envelopes");
    expect(calls.some((c) => c.method === "PATCH" && c.path.includes("/documents/") && !c.path.includes(first.signatureEnvelopeId!))).toBe(true);
    expect(newEnvelope).toBeTruthy();
  });

  it("envio que termina depois de o contrato ser cancelado é desfeito; sem confirmação da Clicksign fica a nota para cancelar lá", async () => {
    const first = await sendForSignature((await newContract()).id, ACTOR);
    onCall = async (method, path) => {
      if (method === "POST" && path.endsWith("/documents")) {
        onCall = null;
        await update<Contract>(COLLECTIONS.contracts, first.id, { status: "cancelado" });
      }
    };
    // A Clicksign recusa o cancelamento e o documento continua em andamento: fica a nota para cancelar lá.
    failPatch = true;
    docStatus = "running";
    calls.length = 0;
    await expect(sendForSignature(first.id, ACTOR)).rejects.toThrow(/mudou durante o envio/);
    onCall = null;
    failPatch = false;
    docStatus = "closed";
    const after = (await getById<Contract>(COLLECTIONS.contracts, first.id))!;
    expect(after.status).toBe("cancelado");
    expect(after.signatureEnvelopeId).toBe(first.signatureEnvelopeId);
    const newEnvelope = calls.find((c) => c.method === "POST" && c.path === "/envelopes");
    expect(newEnvelope).toBeTruthy();
    const notes = (await eventsOf(first.id, "note.added")).filter((e) => e.title.startsWith("Cancele na Clicksign o envelope"));
    expect(notes).toHaveLength(1);
    expect(notes[0].title).not.toContain(first.signatureEnvelopeId!);
  });

  it("documento anterior já fora de andamento na Clicksign (vencido, cancelado ou finalizado): reenvio não deixa nota falsa", async () => {
    const first = await sendForSignature((await newContract()).id, ACTOR);
    failPatch = true;
    docStatus = "canceled";
    try {
      const second = await sendForSignature(first.id, ACTOR);
      expect(second.signatureEnvelopeId).not.toBe(first.signatureEnvelopeId);
    } finally {
      failPatch = false;
      docStatus = "closed";
    }
    expect((await eventsOf(first.id, "note.added")).filter((e) => e.title.startsWith("Cancele na Clicksign"))).toHaveLength(0);
    // Já FINALIZADO lá (todos assinaram ou finalizado manualmente): registra para conferir (os avisos dele são ignorados).
    const before = (await getById<Contract>(COLLECTIONS.contracts, first.id))!;
    failPatch = true;
    docStatus = "closed";
    try {
      await sendForSignature(first.id, ACTOR);
    } finally {
      failPatch = false;
    }
    const finished = (await eventsOf(first.id, "note.added")).filter((e) => e.title.includes("já estava finalizado na Clicksign"));
    expect(finished).toHaveLength(1);
    expect(finished[0].title).toContain(before.signatureEnvelopeId!);
  });

  it("itens alterados enquanto o envelope era criado: o envio é desfeito (o cliente não assina um documento diferente do contrato)", async () => {
    const c = await newContract();
    onCall = async (method, path) => {
      if (method === "POST" && path.endsWith("/documents")) {
        onCall = null;
        await updateContractItems(c.id, [{ productId: "p2", productName: "INTEROS Plus", quantity: 1, setupValue: 0, monthlyValue: 350, hardwareValue: 0, discountPct: 0 }] as never, ACTOR);
      }
    };
    await expect(sendForSignature(c.id, ACTOR)).rejects.toThrow(/mudou durante o envio/);
    onCall = null;
    const after = (await getById<Contract>(COLLECTIONS.contracts, c.id))!;
    expect(after.signatureEnvelopeId).toBeUndefined();
    expect(after.items.map((i) => i.productId)).toEqual(["p2"]);
  });

  it("cancelamento/prazo com o contrato sem signatários: não diz que está assinado, avisa para reenviar", async () => {
    const c = await sendForSignature((await newContract()).id, ACTOR);
    await update<Contract>(COLLECTIONS.contracts, c.id, { signers: [] });
    const document = { key: c.signatureDocumentId, metadata: { interos_contract_id: c.id, interos_version: c.version, interos_envelope_id: c.signatureEnvelopeId } };
    expect((await processClicksignWebhook(hook({ event: { name: "deadline" }, document }))).message).toBe("Prazo vencido registrado");
    expect((await getById<Contract>(COLLECTIONS.contracts, c.id))?.signedAt).toBeUndefined();
  });

  it("com a Clicksign ligada, adicionar signatário sem sobrenome é barrado na hora (não só no envio)", async () => {
    const c = await newContract();
    await expect(addSigner({ contractId: c.id, name: "Fulano", email: `fulano.${RUN}@acme-teste.com.br`, role: "Testemunha" }, ACTOR)).rejects.toThrow(/sobrenome/);
    await expect(addSigner({ contractId: c.id, name: "Fulano 2 Silva", email: `fulano.${RUN}@acme-teste.com.br`, role: "Testemunha" }, ACTOR)).rejects.toThrow(/números/);
    await addSigner({ contractId: c.id, name: "Fulano Silva", email: `fulano.${RUN}@acme-teste.com.br`, role: "Testemunha" }, ACTOR);
    expect((await getById<Contract>(COLLECTIONS.contracts, c.id))?.signers.some((s) => s.name === "Fulano Silva")).toBe(true);
  });

  it("signatário vem do cadastro: contato do cliente (com e-mail) ou usuário ativo; contato de outro cliente é recusado", async () => {
    const c = await newContract();
    const mine = await create<Contact>(COLLECTIONS.contacts, { clientId: CLIENT_ID, name: "Carla Souza", email: `carla.${RUN}@acme-teste.com.br`, isPrimary: false });
    const noEmail = await create<Contact>(COLLECTIONS.contacts, { clientId: CLIENT_ID, name: "Sem Email", isPrimary: false });
    const other = await create<Contact>(COLLECTIONS.contacts, { clientId: `${RUN}_outro_cliente`, name: "Outra Pessoa", email: `outra.${RUN}@x.com.br`, isPrimary: false });
    const badEmail = await create<Contact>(COLLECTIONS.contacts, { clientId: CLIENT_ID, name: "Email Ruim", email: `a..b.${RUN}@acme-teste.com.br`, isPrimary: false });
    await addSignerFrom({ contractId: c.id, source: "contact", id: mine.id, role: "Contratante" }, ACTOR);
    await addSignerFrom({ contractId: c.id, source: "user", id: OWNER_ID, role: "Testemunha" }, ACTOR);
    await expect(addSignerFrom({ contractId: c.id, source: "contact", id: noEmail.id, role: "Contratante" }, ACTOR)).rejects.toThrow(/e-mail/);
    // O cadastro aceita "a..b@": a assinatura não; barra na hora, com o caminho para corrigir.
    await expect(addSignerFrom({ contractId: c.id, source: "contact", id: badEmail.id, role: "Contratante" }, ACTOR)).rejects.toThrow(/e-mail inválido para assinatura.*ficha do cliente/);
    await expect(addSignerFrom({ contractId: c.id, source: "contact", id: other.id, role: "Contratante" }, ACTOR)).rejects.toThrow(/não encontrado neste cliente/);
    await expect(addSignerFrom({ contractId: c.id, source: "user", id: `${RUN}_ninguem`, role: "Testemunha" }, ACTOR)).rejects.toThrow(/inativo/);
    const after = (await getById<Contract>(COLLECTIONS.contracts, c.id))!;
    expect(after.signers.map((s) => [s.email, s.role])).toEqual(expect.arrayContaining([[mine.email, "Contratante"], [`${RUN}.dono@intercert.com.br`, "Testemunha"]]));
    expect(after.signers.some((s) => s.email === badEmail.email)).toBe(false);
    await docdb.sql()`delete from interos.contacts where id = ${other.id}`;
  });

  it("cadastrar contato como signatário é tudo-ou-nada: recusado antes de gravar não deixa contato; aceito cria os dois", async () => {
    const c = await newContract();
    const taken = c.signers[0].email;
    const countBefore = (await list<Contact>(COLLECTIONS.contacts, { where: [["clientId", "==", CLIENT_ID]] })).length;
    await expect(addContactAsSigner({ contractId: c.id, name: "Pessoa Repetida", email: taken, role: "Contratante" }, ACTOR)).rejects.toThrow(/já é signatário/);
    await expect(addContactAsSigner({ contractId: c.id, name: "Semsobrenome", email: `novo.${RUN}@acme-teste.com.br`, role: "Contratante" }, ACTOR)).rejects.toThrow(/sobrenome/);
    expect((await list<Contact>(COLLECTIONS.contacts, { where: [["clientId", "==", CLIENT_ID]] })).length).toBe(countBefore);
    const r = await addContactAsSigner({ contractId: c.id, name: "Nova Pessoa", email: `Nova.${RUN}@acme-teste.com.br`, position: "Financeiro", phone: "88999990000", role: "Contratante" }, ACTOR);
    const contact = await getById<Contact>(COLLECTIONS.contacts, r.contactId);
    expect(contact).toMatchObject({ clientId: CLIENT_ID, name: "Nova Pessoa", email: `nova.${RUN}@acme-teste.com.br`, role: "Financeiro", phone: "88999990000" });
    const after = (await getById<Contract>(COLLECTIONS.contracts, c.id))!;
    expect(after.signers.some((s) => s.email === `nova.${RUN}@acme-teste.com.br` && s.role === "Contratante")).toBe(true);
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
