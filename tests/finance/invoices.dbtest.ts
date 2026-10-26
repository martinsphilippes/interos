/**
 * Faturamento no banco (npm run test:db): configuração fiscal, fila "A faturar", registrar nota (com PDF/XML, XML da
 * NF-e preenchendo número e chave), duplicidade, concorrência (duas notas na mesma cobrança: só uma entra), cancelar
 * (cobrança volta à fila), dispensar/desfazer, envio ao cliente e o PDF no Portal do Cliente pela chave posicional.
 *
 * Isolamento: a configuração `fiscal` é guardada e devolvida no fim; cliente, contrato, cobranças, produto, notas,
 * arquivos e links do portal têm prefixo próprio e são apagados.
 */
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { docdb } from "@/server/docdb";
import { create, getById, list } from "@/server/db";
import { COLLECTIONS, type Billing, type Client, type Contract, type Invoice, type Product } from "@/domain/types";
import { FISCAL_SETTING_KEY, normalizeFiscalSettings } from "@/domain/fiscal";
import {
  cancelInvoice,
  getFiscalSettings,
  getInvoiceIssueData,
  getInvoiceQueue,
  registerInvoice,
  restoreBillingInvoice,
  saveFiscalSettings,
  saveProductFiscal,
  sendInvoice,
  waiveBillingInvoice,
} from "@/server/finance/invoices";
import { createPortalLink, portalInvoiceFile } from "@/server/portal/service";
import { todayKey } from "@/server/finance/billing";

const RUN = `f${Date.now().toString(36)}`;
const ACTOR = { id: `${RUN}_fin`, name: "Financeiro Teste" };
const CLIENT_ID = `${RUN}_cli`;
const CONTRACT_ID = `${RUN}_ct`;
const PRODUCT_ID = `${RUN}_prod`;
let settingsBackup: unknown = undefined;

const PDF = Buffer.from("%PDF-1.4\n1 0 obj<<>>endobj\ntrailer<<>>\n%%EOF");

function nfeKey(prefix: string): string {
  const body = prefix.padEnd(43, "0").slice(0, 43);
  let sum = 0;
  let w = 2;
  for (let i = body.length - 1; i >= 0; i--) {
    sum += Number(body[i]) * w;
    w = w === 9 ? 2 : w + 1;
  }
  return `${body}${sum % 11 < 2 ? 0 : 11 - (sum % 11)}`;
}

function addDays(day: string, n: number): string {
  const d = new Date(`${day}T12:00:00Z`);
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
}

async function billing(id: string, patch: Partial<Billing>): Promise<Billing> {
  return create<Billing>(COLLECTIONS.billing, { clientId: CLIENT_ID, contractId: CONTRACT_ID, type: "mensalidade", competence: todayKey().slice(0, 7), amount: 290, dueDate: todayKey(), status: "aberta", ...patch } as never, `${RUN}_${id}`);
}

beforeAll(async () => {
  if (!process.env.DATABASE_URL) throw new Error("Defina DATABASE_URL (veja scripts/db-local.sh)");
  const [row] = (await docdb.sql()`select data from interos.settings where data->>'key' = ${FISCAL_SETTING_KEY}`) as unknown as { data: unknown }[];
  settingsBackup = row ? row.data : null;
  await docdb.sql()`delete from interos.settings where data->>'key' = ${FISCAL_SETTING_KEY}`;
  await create<Client>(COLLECTIONS.clients, { legalName: `Quantso ${RUN} LTDA`, tradeName: `Quantso ${RUN}`, document: "35176948000187", status: "ativo", email: `${RUN}@quantso-teste.com.br`, address: { street: "Rua A", number: "1", city: "Salvador", state: "BA", zip: "40000000" }, mrr: 0, tags: [] } as never, CLIENT_ID);
  await create<Product>(COLLECTIONS.products, { name: `ERP ${RUN}`, category: "software", setupPrice: 1200, monthlyPrice: 290, hardwarePrice: 900, billingType: "ambos", commission: { setupPct: 0, recurringPct: 0, hardwarePct: 0, recurringReleaseInstallment: 1 }, active: true, order: 99 } as never, PRODUCT_ID);
  await create<Contract>(
    COLLECTIONS.contracts,
    {
      clientId: CLIENT_ID,
      number: `CT-${RUN}`,
      version: 1,
      status: "liberado",
      items: [{ productId: PRODUCT_ID, productName: `ERP ${RUN}`, quantity: 1, setupValue: 1200, monthlyValue: 290, hardwareValue: 900, discountPct: 0 }],
      setupTotal: 1200,
      monthlyTotal: 290,
      hardwareTotal: 900,
      billingDay: 10,
      recurrence: "mensal",
      termMonths: 12,
      signers: [],
      financialStatus: "aprovado",
      documentIds: [],
      createdBy: ACTOR.id,
    } as never,
    CONTRACT_ID,
  );
});

afterAll(async () => {
  const sql = docdb.sql();
  await sql`delete from interos.invoice_files where data->>'invoiceId' in (select id from interos.invoices where data->>'clientId' = ${CLIENT_ID})`;
  await sql`delete from interos.invoices where data->>'clientId' = ${CLIENT_ID}`;
  await sql`delete from interos.billing where data->>'clientId' = ${CLIENT_ID}`;
  await sql`delete from interos.portal_links where data->>'clientId' = ${CLIENT_ID}`;
  await sql`delete from interos.communications where data->>'clientId' = ${CLIENT_ID}`;
  await sql`delete from interos.events where data->>'clientId' = ${CLIENT_ID}`;
  await sql`delete from interos.contracts where id = ${CONTRACT_ID}`;
  await sql`delete from interos.products where id = ${PRODUCT_ID}`;
  await sql`delete from interos.clients where id = ${CLIENT_ID}`;
  if (settingsBackup === null) await sql`delete from interos.settings where data->>'key' = ${FISCAL_SETTING_KEY}`;
  else if (settingsBackup) await sql`update interos.settings set data = ${sql.json(settingsBackup as never)} where data->>'key' = ${FISCAL_SETTING_KEY}`;
});

describe("faturamento", () => {
  it("configuração: padrões sem nada gravado; salvar grava e normaliza; perfil fiscal do produto", async () => {
    const before = await getFiscalSettings();
    expect(before.stored).toBe(false);
    const since = addDays(todayKey(), -40);
    const saved = await saveFiscalSettings({ ...normalizeFiscalSettings(null, todayKey()), since, leadDays: 5, regime: "simples", defaultServiceCode: "1.07" }, ACTOR);
    expect(saved).toMatchObject({ stored: true, since, regime: "simples" });
    expect(await getFiscalSettings()).toMatchObject({ stored: true, since, defaultServiceCode: "1.07" });
    await saveProductFiscal(PRODUCT_ID, { nature: "software", serviceCode: "1.05", ncm: "8470.50.00", cfop: "5102" }, ACTOR);
    expect((await getById<Product>(COLLECTIONS.products, PRODUCT_ID))?.fiscal).toMatchObject({ nature: "software", serviceCode: "1.05", ncm: "84705000", cfop: "5102" });
    // Apagar um campo na tela tira do cadastro (o perfil é substituído inteiro).
    await saveProductFiscal(PRODUCT_ID, { nature: "software", serviceCode: "1.05" }, ACTOR);
    const fiscal = (await getById<Product>(COLLECTIONS.products, PRODUCT_ID))?.fiscal;
    expect(fiscal?.ncm).toBeUndefined();
    expect(fiscal?.cfop).toBeUndefined();
  });

  it("fila: a faturar, aguardando, fora do controle; dados para emitir com tomador e itens", async () => {
    const today = todayKey();
    await billing("m1", { dueDate: addDays(today, 2) });
    await billing("m2", { dueDate: addDays(today, 30) });
    await billing("old", { dueDate: addDays(today, -60) });
    await billing("hw", { type: "hardware", amount: 900, dueDate: today });
    const queue = await getInvoiceQueue();
    const mine = queue.rows.filter((r) => r.clientId === CLIENT_ID);
    const state = (id: string) => mine.find((r) => r.billingId === `${RUN}_${id}`)?.state;
    expect(state("m1")).toBe("a_faturar");
    expect(state("m2")).toBe("aguardando");
    expect(state("old")).toBeUndefined();
    expect(mine.find((r) => r.billingId === `${RUN}_hw`)).toMatchObject({ state: "a_faturar", kind: "nfe" });

    const data = await getInvoiceIssueData(`${RUN}_m1`);
    expect(data.kind).toBe("nfse");
    expect(data.taker).toMatchObject({ legalName: `Quantso ${RUN} LTDA`, document: "35176948000187" });
    expect(data.items).toEqual([expect.objectContaining({ productId: PRODUCT_ID, total: 290, serviceCode: "1.05" })]);
    const hw = await getInvoiceIssueData(`${RUN}_hw`);
    expect(hw.items).toEqual([expect.objectContaining({ total: 900 })]);
    expect(hw.gaps.some((g) => g.includes("NCM/CFOP"))).toBe(true);
  });

  it("registrar: NFS-e com PDF; NF-e pelo XML (número e chave); duplicidade e cobrança já com nota recusadas", async () => {
    const nfse = await registerInvoice({ billingId: `${RUN}_m1`, kind: "nfse", number: "000123", issuedAt: todayKey(), verificationCode: "ABC-1", amount: 290, pdf: { fileName: "nota", content: PDF } }, ACTOR);
    expect(nfse).toMatchObject({ status: "emitida", number: "000123", pdfFileName: "nota.pdf" });
    const b = await getById<Billing>(COLLECTIONS.billing, `${RUN}_m1`);
    expect(b).toMatchObject({ invoiceId: nfse.id, invoiceNumber: "000123", invoiceKind: "nfse" });
    await expect(registerInvoice({ billingId: `${RUN}_m1`, kind: "nfse", number: "999", issuedAt: todayKey(), amount: 290 }, ACTOR)).rejects.toThrow(/já tem nota/);
    await expect(registerInvoice({ billingId: `${RUN}_m2`, kind: "nfse", number: "123", issuedAt: todayKey(), amount: 290 }, ACTOR)).rejects.toThrow(/já está registrada/);
    await expect(registerInvoice({ billingId: `${RUN}_m2`, kind: "nfse", number: "5", issuedAt: "2099-01-01", amount: 290 }, ACTOR)).rejects.toThrow(/futuro/);
    await expect(registerInvoice({ billingId: `${RUN}_m2`, kind: "nfse", number: "5", issuedAt: todayKey(), amount: 290, pdf: { fileName: "x.pdf", content: Buffer.from("não é pdf") } }, ACTOR)).rejects.toThrow(/não é um PDF/);

    const key = nfeKey(`2926${RUN.replace(/\D/g, "")}`);
    const xml = `<?xml version="1.0"?><nfeProc><NFe><infNFe Id="NFe${key}"><ide><serie>1</serie><nNF>4567</nNF></ide><total><ICMSTot><vNF>900.00</vNF></ICMSTot></total></infNFe></NFe></nfeProc>`;
    const nfe = await registerInvoice({ billingId: `${RUN}_hw`, kind: "nfe", number: "", issuedAt: todayKey(), amount: 900, xml: { fileName: "nfe.xml", content: Buffer.from(xml) } }, ACTOR);
    expect(nfe).toMatchObject({ number: "4567", series: "1", accessKey: key, xmlFileName: "nfe.xml" });
    await expect(registerInvoice({ billingId: `${RUN}_m2`, kind: "nfe", number: "1", issuedAt: todayKey(), accessKey: key.slice(0, 43) + ((Number(key[43]) + 1) % 10), amount: 1 }, ACTOR)).rejects.toThrow(/Chave de acesso inválida/);
    // Valor diferente do XML é recusado.
    const key2 = nfeKey(`3126${RUN.replace(/\D/g, "")}9`);
    const xml2 = `<nfeProc><infNFe Id="NFe${key2}"><nNF>8888</nNF><vNF>500.00</vNF></infNFe></nfeProc>`;
    await expect(registerInvoice({ billingId: `${RUN}_m2`, kind: "nfe", number: "", issuedAt: todayKey(), amount: 50000, xml: { fileName: "x.xml", content: Buffer.from(xml2) } }, ACTOR)).rejects.toThrow(/diferente do XML/);
  });

  it("concorrência: duas notas ao mesmo tempo na mesma cobrança → só uma entra (arquivos da outra apagados)", async () => {
    await billing("race", { dueDate: todayKey() });
    const results = await Promise.allSettled([
      registerInvoice({ billingId: `${RUN}_race`, kind: "nfse", number: "7001", issuedAt: todayKey(), amount: 290, pdf: { fileName: "a.pdf", content: PDF } }, ACTOR),
      registerInvoice({ billingId: `${RUN}_race`, kind: "nfse", number: "7002", issuedAt: todayKey(), amount: 290, pdf: { fileName: "b.pdf", content: PDF } }, ACTOR),
    ]);
    expect(results.filter((r) => r.status === "fulfilled")).toHaveLength(1);
    const invoices = (await list<Invoice>(COLLECTIONS.invoices, { where: [["billingId", "==", `${RUN}_race`]] })).filter((i) => i.status === "emitida");
    expect(invoices).toHaveLength(1);
    const [{ n }] = (await docdb.sql()`select count(*)::int as n from interos.invoice_files where data->>'invoiceId' like ${`%`} and id like ${`%_pdf`} and data->>'fileName' in ('a.pdf','b.pdf')`) as unknown as { n: number }[];
    expect(n).toBe(1);
  });

  it("cancelar: nota fica cancelada no histórico e a cobrança volta para «A faturar»; dá para registrar outra", async () => {
    const inv = (await list<Invoice>(COLLECTIONS.invoices, { where: [["billingId", "==", `${RUN}_m1`]] }))[0];
    await expect(cancelInvoice(inv.id, "abc", ACTOR)).rejects.toThrow(/motivo/);
    await cancelInvoice(inv.id, "Valor errado na nota", ACTOR);
    expect(await getById<Invoice>(COLLECTIONS.invoices, inv.id)).toMatchObject({ status: "cancelada", cancelReason: "Valor errado na nota" });
    const b = await getById<Billing>(COLLECTIONS.billing, `${RUN}_m1`);
    expect(b?.invoiceId).toBeUndefined();
    expect((await getInvoiceQueue()).rows.find((r) => r.billingId === `${RUN}_m1`)?.state).toBe("a_faturar");
    await expect(cancelInvoice(inv.id, "de novo cancelada", ACTOR)).rejects.toThrow(/já está cancelada/);
    // O mesmo número volta a ser aceito (a anterior está cancelada).
    const again = await registerInvoice({ billingId: `${RUN}_m1`, kind: "nfse", number: "123", issuedAt: todayKey(), amount: 290, pdf: { fileName: "nota.pdf", content: PDF } }, ACTOR);
    expect(again.status).toBe("emitida");
  });

  it("cobrança cancelada sai do faturamento mesmo com nota", async () => {
    await billing("cx", { dueDate: todayKey() });
    await registerInvoice({ billingId: `${RUN}_cx`, kind: "nfse", number: "9901", issuedAt: todayKey(), amount: 290 }, ACTOR);
    await docdb.sql()`update interos.billing set data = jsonb_set(data, '{status}', '"cancelada"') where id = ${`${RUN}_cx`}`;
    expect((await getInvoiceQueue()).rows.find((r) => r.billingId === `${RUN}_cx`)).toBeUndefined();
    const inv = (await list<Invoice>(COLLECTIONS.invoices, { where: [["billingId", "==", `${RUN}_cx`]] }))[0];
    await expect(sendInvoice(inv.id, { channel: "email" }, ACTOR)).rejects.toThrow(/cobrança desta nota foi cancelada/);
  });

  it("dispensar e desfazer", async () => {
    await expect(waiveBillingInvoice(`${RUN}_m2`, "x", ACTOR)).rejects.toThrow(/Explique/);
    await waiveBillingInvoice(`${RUN}_m2`, "Nota emitida fora antes do controle", ACTOR);
    expect((await getInvoiceQueue()).rows.find((r) => r.billingId === `${RUN}_m2`)).toMatchObject({ state: "dispensada", waivedReason: "Nota emitida fora antes do controle" });
    await expect(waiveBillingInvoice(`${RUN}_m1`, "Já tem nota registrada", ACTOR)).rejects.toThrow(/já tem nota/);
    await restoreBillingInvoice(`${RUN}_m2`, ACTOR);
    expect((await getInvoiceQueue()).rows.find((r) => r.billingId === `${RUN}_m2`)?.state).toBe("aguardando");
  });

  it("enviar: sem e-mail conectado vira envio manual registrado; a nota e a cobrança ficam como enviadas", async () => {
    const inv = (await list<Invoice>(COLLECTIONS.invoices, { where: [["billingId", "==", `${RUN}_m1`]] })).find((i) => i.status === "emitida")!;
    const r = await sendInvoice(inv.id, { channel: "email", text: "Segue a nota" }, ACTOR);
    expect(r.results[0]).toMatchObject({ channel: "email", to: `${RUN}@quantso-teste.com.br` });
    expect(r.results[0].delivered || r.results[0].manual).toBe(true);
    expect((await getById<Invoice>(COLLECTIONS.invoices, inv.id))?.sentAt).toBeTruthy();
    expect((await getById<Billing>(COLLECTIONS.billing, `${RUN}_m1`))?.invoiceSentAt).toBeTruthy();
    expect((await getInvoiceQueue()).rows.find((r2) => r2.billingId === `${RUN}_m1`)?.state).toBe("enviada");
  });

  it("portal: o PDF da nota sai pela chave posicional da cobrança; nota cancelada e chave errada não", async () => {
    const { token } = await createPortalLink({ clientId: CLIENT_ID, label: "teste" }, ACTOR, { emit: false });
    let found = false;
    for (let i = 1; i <= 10 && !found; i++) {
      const f = await portalInvoiceFile(token, `b${i}`, "pdf");
      if (f) {
        found = true;
        expect(f.contentBase64).toBe(PDF.toString("base64"));
      }
    }
    expect(found).toBe(true);
    expect(await portalInvoiceFile(token, "b999", "pdf")).toBeNull();
    expect(await portalInvoiceFile("token-invalido", "b1", "pdf")).toBeNull();
    // O XML da NF-e do hardware também sai; o PDF dela não existe.
    let xml = false;
    for (let i = 1; i <= 10; i++) if (await portalInvoiceFile(token, `b${i}`, "xml")) xml = true;
    expect(xml).toBe(true);
  });
});
