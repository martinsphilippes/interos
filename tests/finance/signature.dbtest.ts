/**
 * Assinatura eletrônica no banco (npm run test:db): configuração (signatário da Intercert), modelo do INTEROS fixado
 * no documento e no código de integridade, Word com variáveis em versões, PDF/Word do contrato e a caixa de entrada da
 * Clicksign (sugestão, vínculo idempotente, ignorar e reabrir).
 *
 * Isolamento: a configuração `assinatura_eletronica` é guardada e devolvida no fim; o modelo padrão anterior volta a
 * ser o padrão; cliente, contratos, modelos e itens da caixa têm prefixo próprio e são apagados.
 */
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { docdb } from "@/server/docdb";
import { create, getById, list } from "@/server/db";
import { COLLECTIONS, type Client, type Contract, type User, type ContractTemplate, type ContractTemplateFile, type Document, type SignatureInboxItem } from "@/domain/types";
import { getSignatureSettings, saveInterosTemplate, saveSignatureSettings, saveTemplateVariables, setTemplateState, signatureDocumentInfo, uploadWordTemplate } from "@/server/finance/contract-templates";
import { contractDocumentData, contractDocx, contractPdf } from "@/server/finance/contract-document";
import { createManualContract, sendForSignature, updateContractItems } from "@/server/finance/service";
import { contractDocumentHash } from "@/server/finance/signature";
import { assignInboxItem, ignoreInboxItem, recordExternalEnvelope, reopenInboxItem } from "@/server/finance/signature-inbox";
import { docxText, writeZip } from "@/server/finance/docx";
import { SIGNATURE_SETTING } from "@/domain/contract-templates";

const RUN = `t${Date.now().toString(36)}`;
const ACTOR = { id: `${RUN}_fin`, name: "Financeiro Teste" };
const CLIENT_ID = `${RUN}_cli`;
const CLIENT_EMAIL = `${RUN}@acme-teste.com.br`;
/** O padrão de quem assina pela Intercert é o usuário ativo chamado Hércules: o teste cria o seu (banco limpo não tem). */
const HERCULES_ID = `${RUN}_hercules`;
let settingsBackup: unknown = undefined;
let previousDefault: string | undefined;
const contractIds: string[] = [];
const templateIds: string[] = [];
const envelopeIds: string[] = [];

function docx(xml: string): Buffer {
  const parts: [string, string][] = [
    ["[Content_Types].xml", "<Types/>"],
    ["word/document.xml", `<w:document xmlns:w="w"><w:body>${xml}</w:body></w:document>`],
  ];
  return writeZip(
    parts.map(([name]) => ({ name, method: 0, crc: 0, compressedSize: 0, size: 0, raw: Buffer.alloc(0) })),
    new Map(parts.map(([n, x]) => [n, Buffer.from(x, "utf8")])),
  );
}

beforeAll(async () => {
  if (!process.env.DATABASE_URL) throw new Error("Defina DATABASE_URL (veja scripts/db-local.sh)");
  const [row] = (await docdb.sql()`select data from interos.settings where data->>'key' = ${SIGNATURE_SETTING}`) as unknown as { data: unknown }[];
  settingsBackup = row ? row.data : null;
  await docdb.sql()`delete from interos.settings where data->>'key' = ${SIGNATURE_SETTING}`;
  previousDefault = (await list<ContractTemplate>(COLLECTIONS.contractTemplates, { where: [["isDefault", "==", true]] }))[0]?.id;
  await create<User>(COLLECTIONS.users, { name: `Hércules ${RUN}`, email: `${RUN}.hercules@intercert.com.br`, role: "admin", departmentId: "administrativo", active: true } as Omit<User, "id" | "organizationId" | "createdAt" | "updatedAt">, HERCULES_ID);
  await create<Client>(COLLECTIONS.clients, { legalName: `ACME ${RUN} LTDA`, tradeName: `ACME ${RUN}`, document: "12345678000190", status: "ativo", email: CLIENT_EMAIL, address: { city: "Crato", state: "CE" }, mrr: 0, tags: [] } as never, CLIENT_ID);
});

afterAll(async () => {
  const sql = docdb.sql();
  if (settingsBackup === null) await sql`delete from interos.settings where data->>'key' = ${SIGNATURE_SETTING}`;
  else if (settingsBackup) await sql`update interos.settings set data = ${sql.json(settingsBackup as never)} where data->>'key' = ${SIGNATURE_SETTING}`;
  if (templateIds.length) {
    await sql`delete from interos.contract_template_files where data->>'templateId' = any(${templateIds})`;
    await sql`delete from interos.contract_templates where id = any(${templateIds})`;
  }
  if (previousDefault) await sql`update interos.contract_templates set data = jsonb_set(data, '{isDefault}', 'true') where id = ${previousDefault}`;
  if (contractIds.length) await sql`delete from interos.contracts where id = any(${contractIds})`;
  await sql`delete from interos.documents where data->>'clientId' = ${CLIENT_ID}`;
  await sql`delete from interos.signature_inbox where data->>'envelopeId' = any(${envelopeIds})`;
  await sql`delete from interos.clients where id = ${CLIENT_ID}`;
  await sql`delete from interos.users where id = ${HERCULES_ID}`;
});

describe("assinatura eletrônica", () => {
  it("sem configuração salva, quem assina pela Intercert é o Hércules (usuário ativo)", async () => {
    const s = await getSignatureSettings();
    expect(s.stored).toBe(false);
    expect(s.defaultAuth).toBe("email");
    // O primeiro usuário ativo chamado Hércules (o do teste ou o da carga de demonstração).
    expect(s.companySigner.name).toMatch(/^H[eé]rcules/);
    expect(s.fromUser).toBe(true);
  });

  it("contrato novo já traz o signatário da Intercert; o documento fixa o modelo e entra no código de integridade", async () => {
    await saveSignatureSettings({ companySigner: { enabled: true, name: "Diretor Teste", email: `${RUN}.diretor@intercert.com.br`, role: "Diretor" }, defaultAuth: "email" }, ACTOR);
    const t = await saveInterosTemplate({ name: `${RUN} Modelo`, title: "Contrato {{contrato.numero}}", clauses: "CLÁUSULA PRIMEIRA\n\nA {{contratante.razao_social}} paga {{valores.mensalidade_extenso}}. Cor: {{cor}}." }, ACTOR);
    templateIds.push(t.id);
    expect(t.variables).toEqual([{ name: "contrato.numero", field: "contrato.numero" }, { name: "contratante.razao_social", field: "contratante.razao_social" }, { name: "valores.mensalidade_extenso", field: "valores.mensalidade_extenso" }, { name: "cor" }]);
    await setTemplateState(t.id, { isDefault: true }, ACTOR);
    expect((await list<ContractTemplate>(COLLECTIONS.contractTemplates, { where: [["isDefault", "==", true]] })).map((x) => x.id)).toEqual([t.id]);

    const c = await createManualContract({ clientId: CLIENT_ID, recurrence: "mensal", termMonths: 12, billingDay: 10 }, ACTOR);
    contractIds.push(c.id);
    expect(c.signers.map((s) => [s.email, s.party ?? "contratante"])).toEqual([
      [CLIENT_EMAIL, "contratante"],
      [`${RUN}.diretor@intercert.com.br`, "contratada"],
    ]);
    await updateContractItems(c.id, [{ productId: "p1", productName: "INTEROS Gestão", quantity: 1, setupValue: 1000, monthlyValue: 200, hardwareValue: 0, discountPct: 0 }] as never, ACTOR);

    // Prévia: modelo atual, ainda não fixado.
    const preview = await contractDocumentData(c.id);
    expect(preview?.preview).toBe(true);
    expect(preview?.clauses?.text).toContain(`A ACME ${RUN} LTDA paga R$ 200,00 (duzentos reais)`);
    expect(preview?.clauses?.text).toContain("Cor: ________________.");

    const sent = await sendForSignature(c.id, ACTOR);
    const stored = (await getById<Contract>(COLLECTIONS.contracts, c.id))!;
    expect(stored.documentTemplate).toMatchObject({ id: t.id, version: 1, kind: "interos" });
    expect(stored.documentHash).toBe(contractDocumentHash(stored));
    expect(sent.documentHash).toBe(stored.documentHash);

    // O modelo muda depois: o documento gerado continua com a versão fixada; a tela avisa para gerar de novo.
    await saveInterosTemplate({ id: t.id, name: t.name, title: "Contrato {{contrato.numero}}", clauses: "CLÁUSULA ÚNICA\n\nTexto novo para {{contratante.razao_social}}." }, ACTOR);
    const after = await contractDocumentData(c.id);
    expect(after?.preview).toBe(false);
    expect(after?.clauses?.text).toContain("CLÁUSULA PRIMEIRA");
    const info = await signatureDocumentInfo(stored, true);
    expect(info.effective).toMatchObject({ fixed: true, version: 1, stale: true });
    const pdf = await contractPdf(after!);
    expect(pdf.buffer.subarray(0, 5).toString()).toBe("%PDF-");
  });

  it("Word: variáveis sugeridas, versões com arquivo próprio e o Word preenchido do contrato", async () => {
    const { template, variables } = await uploadWordTemplate({ fileName: `${RUN}-modelo.docx`, content: docx(`<w:p><w:r><w:t>Contratante: {{Razão </w:t></w:r><w:r><w:t>Social}} · {{valor_mensal}} · {{brinde}}</w:t></w:r></w:p>`) }, ACTOR);
    templateIds.push(template.id);
    expect(variables).toEqual([{ name: "Razão Social", field: "contratante.razao_social" }, { name: "valor_mensal", field: "valores.mensalidade" }, { name: "brinde" }]);
    expect(await getById<ContractTemplateFile>(COLLECTIONS.contractTemplateFiles, `${template.id}_v1`)).toMatchObject({ version: 1, fileName: `${RUN}-modelo.docx` });

    await saveTemplateVariables(template.id, [...variables.slice(0, 2), { name: "brinde", fixed: "Caneca" }], ACTOR);
    const v2 = (await getById<ContractTemplate>(COLLECTIONS.contractTemplates, template.id))!;
    expect(v2.version).toBe(2);
    expect(await getById<ContractTemplateFile>(COLLECTIONS.contractTemplateFiles, `${template.id}_v2`)).not.toBeNull();
    // Sem mudança: não sobe a versão.
    await saveTemplateVariables(template.id, v2.variables, ACTOR);
    expect((await getById<ContractTemplate>(COLLECTIONS.contractTemplates, template.id))!.version).toBe(2);

    const c = await createManualContract({ clientId: CLIENT_ID, recurrence: "mensal", termMonths: 6, billingDay: 5 }, ACTOR);
    contractIds.push(c.id);
    await updateContractItems(c.id, [{ productId: "p1", productName: "INTEROS", quantity: 1, setupValue: 0, monthlyValue: 99.9, hardwareValue: 0, discountPct: 0 }] as never, ACTOR);
    await docdb.sql()`update interos.contracts set data = jsonb_set(data, '{templateId}', to_jsonb(${template.id}::text)) where id = ${c.id}`;
    const data = await contractDocumentData(c.id);
    expect(data?.template).toMatchObject({ id: template.id, kind: "word", version: 2 });
    const file = await contractDocx(data!);
    expect(docxText(file!.buffer)).toContain(`Contratante: ACME ${RUN} LTDA · R$ 99,90 · Caneca`);

    // Trocar o arquivo: versão 3, ligações mantidas.
    const swapped = await uploadWordTemplate({ templateId: template.id, fileName: "novo.docx", content: docx(`<w:p><w:r><w:t>{{brinde}} e {{cnpj}}</w:t></w:r></w:p>`) }, ACTOR);
    expect(swapped.template.version).toBe(3);
    expect(swapped.variables).toEqual([{ name: "brinde", fixed: "Caneca" }, { name: "cnpj", field: "contratante.cnpj_cpf" }]);
    await expect(uploadWordTemplate({ fileName: "x.pdf", content: Buffer.from("x") }, ACTOR)).rejects.toThrow(/Word/);
  });

  it("caixa de entrada: sugestão pelo e-mail, recebimento idempotente, vincular, ignorar e reabrir", async () => {
    const env1 = `${RUN}-env1`;
    const env2 = `${RUN}-env2`;
    envelopeIds.push(env1, env2);
    const signers = [
      { name: "Diretor Teste", email: `${RUN}.diretor@intercert.com.br` },
      { name: "Cliente", email: CLIENT_EMAIL.toUpperCase() },
    ];
    const r1 = await recordExternalEnvelope({ envelopeId: env1, name: "Contrato ACME (Clicksign)", providerStatus: "em_andamento", signers });
    expect(r1.created).toBe(true);
    expect(r1.item).toMatchObject({ state: "pendente", suggestedClientId: CLIENT_ID });
    const r2 = await recordExternalEnvelope({ envelopeId: env1, name: "Contrato ACME (Clicksign)", providerStatus: "finalizado", signers, finishedAt: "2026-10-21T15:00:00.000Z" });
    expect(r2.created).toBe(false);
    expect(r2.item.providerStatus).toBe("finalizado");

    const linked = await assignInboxItem({ id: r1.item.id, clientId: CLIENT_ID, contractId: contractIds[0] }, ACTOR);
    expect(linked.state).toBe("vinculado");
    const doc = await getById<Document>(COLLECTIONS.documents, linked.documentId!);
    expect(doc).toMatchObject({ clientId: CLIENT_ID, entityType: "contract", entityId: contractIds[0], category: "Contrato assinado" });
    expect((await getById<Contract>(COLLECTIONS.contracts, contractIds[0]))!.documentIds).toContain(doc!.id);
    await expect(assignInboxItem({ id: r1.item.id, clientId: CLIENT_ID }, ACTOR)).rejects.toThrow(/já foi vinculado/);
    // Recebido de novo depois de vinculado: continua vinculado.
    expect((await recordExternalEnvelope({ envelopeId: env1, name: "x", providerStatus: "finalizado", signers })).item.state).toBe("vinculado");

    const other = await recordExternalEnvelope({ envelopeId: env2, name: "Teste interno", providerStatus: "cancelado", signers: [{ name: "Fulano", email: "fulano@gmail.com" }] });
    expect(other.item.suggestedClientId).toBeUndefined();
    await expect(ignoreInboxItem({ id: other.item.id, reason: "x" }, ACTOR)).rejects.toThrow(/motivo/);
    await ignoreInboxItem({ id: other.item.id, reason: "Documento de teste" }, ACTOR);
    expect((await getById<SignatureInboxItem>(COLLECTIONS.signatureInbox, other.item.id))!.state).toBe("ignorado");
    await reopenInboxItem(other.item.id, ACTOR);
    expect((await getById<SignatureInboxItem>(COLLECTIONS.signatureInbox, other.item.id))!.state).toBe("pendente");
  });
});
