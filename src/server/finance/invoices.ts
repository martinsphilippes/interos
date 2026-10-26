import "server-only";
/**
 * Faturamento — notas fiscais das cobranças (Fase 1: emissão fora, registro e envio no INTEROS).
 *
 * - Configuração fiscal (setting `fiscal`, `src/domain/fiscal.ts`): que nota cada tipo de cobrança pede, quando entra na
 *   fila "A faturar" e os dados fiscais da empresa. Perfil fiscal de cada produto (`Product.fiscal`).
 * - Registrar nota (`registerInvoice`): número, série, emissão, chave/código, valor e os arquivos PDF/XML. A cobrança
 *   guarda a nota vigente (`invoiceId`) numa transação: duas pessoas registrando ao mesmo tempo → só uma entra.
 * - Cancelar (`cancelInvoice`): a nota fica no histórico como cancelada e a cobrança volta para "A faturar".
 * - Dispensar (`waiveBillingInvoice`): cobrança que não terá nota (com motivo) sai da fila; desfazer volta.
 * - Enviar (`sendInvoice`): e-mail/WhatsApp pelo mesmo caminho das cobranças (`sendOrRecord`); `{linkPortal}` gera
 *   link do Portal do Cliente, onde o PDF/XML ficam para baixar.
 * Quem chama confere permissão e escopo (actions/rotas).
 */
import { BusinessError } from "@/server/auth/error-classes";
import { docdb, FieldValue } from "@/server/docdb";
import { col, create, getById, getManyByIds, list, newId, nowIso, remove, txGetOwn, update } from "@/server/db";
import { emitEvent } from "@/server/events";
import { writeSetting } from "@/server/conversations/ops-settings";
import { cleanPatch } from "@/server/commissions/store";
import { sendOrRecord, type SendChannel } from "@/server/integrations/communications";
import { createMessagePortalLink } from "@/server/portal/service";
import { fillPortalLink, templateUsesPortalLink } from "@/domain/portal";
import {
  BILLING_TYPE_FISCAL_LABELS,
  DEFAULT_INVOICE_MESSAGE,
  FISCAL_SETTING_KEY,
  INVOICE_KIND_SHORT,
  fillInvoiceMessage,
  invoiceItems,
  invoiceKindFor,
  invoiceNumberKey,
  invoiceQueueState,
  isValidAccessKey,
  normalizeAccessKey,
  normalizeFiscalSettings,
  type FiscalSettings,
  type InvoiceItem,
  type InvoiceQueueState,
} from "@/domain/fiscal";
import {
  COLLECTIONS,
  type Address,
  type Billing,
  type Client,
  type Contract,
  type Invoice,
  type InvoiceFile,
  type InvoiceKind,
  type Opportunity,
  type Product,
  type ProductFiscalProfile,
  type Settings,
  type UserRef,
} from "@/domain/types";
import { formatCurrency, formatCompetence, formatDate } from "@/lib/format";
import { listBillingsSwept, todayKey } from "./billing";
import { filterBillingsByContracts, visibleContractIds } from "./access";
import { loadBillingMessageContext } from "./billing-message";
import type { DataScope } from "@/server/auth/scope";

export const INVOICE_PDF_MAX_BYTES = 3 * 1024 * 1024;
export const INVOICE_XML_MAX_BYTES = 1024 * 1024;
/** Horizonte da aba "Próximas" (dias). */
export const UPCOMING_DAYS = 60;

// ---------------------------------------------------------------------------
// Configuração fiscal
// ---------------------------------------------------------------------------

async function readFiscalSetting(): Promise<Settings | null> {
  return (
    (
      await list<Settings>(COLLECTIONS.settings, {
        where: [["key", "==", FISCAL_SETTING_KEY]],
      })
    )[0] ?? null
  );
}

export async function getFiscalSettings(today: string = todayKey()): Promise<FiscalSettings> {
  const doc = await readFiscalSetting();
  return normalizeFiscalSettings(doc?.value ?? null, today);
}

export type FiscalSettingsInput = Omit<FiscalSettings, "stored">;

export async function saveFiscalSettings(input: FiscalSettingsInput, actor: UserRef): Promise<FiscalSettings> {
  const today = todayKey();
  const before = await getFiscalSettings(today);
  const next = normalizeFiscalSettings({ ...input }, today);
  const { stored: _s, ...value } = next;
  void _s;
  await writeSetting(FISCAL_SETTING_KEY, value, "Faturamento: dados fiscais da empresa, nota por tipo de cobrança e quando a cobrança entra na fila");
  const changed = (Object.keys(value) as (keyof typeof value)[]).filter((k) => JSON.stringify(before[k] ?? null) !== JSON.stringify(value[k] ?? null));
  if (changed.length > 0 || !before.stored) {
    await emitEvent({
      type: "fiscal.settings_updated",
      actor,
      entity: { type: "setting", id: FISCAL_SETTING_KEY },
      title: "Configuração fiscal alterada",
      description: changed.length ? `Campos: ${changed.join(", ")}` : "Configuração salva pela primeira vez",
      department: "financeiro",
      payload: {
        changes: Object.fromEntries(changed.map((k) => [k, { from: before[k] ?? null, to: value[k] ?? null }])),
      },
      timeline: false,
    });
  }
  return { ...next, stored: true };
}

export interface FiscalProductRow {
  id: string;
  name: string;
  active: boolean;
  hasSetup: boolean;
  hasMonthly: boolean;
  hasHardware: boolean;
  fiscal?: ProductFiscalProfile;
}

export async function listFiscalProducts(): Promise<FiscalProductRow[]> {
  const products = await list<Product>(COLLECTIONS.products);
  return products
    .map((p) => ({
      id: p.id,
      name: p.name,
      active: p.active,
      hasSetup: p.setupPrice > 0,
      hasMonthly: p.monthlyPrice > 0,
      hasHardware: p.hardwarePrice > 0,
      fiscal: p.fiscal,
    }))
    .sort((a, b) => Number(b.active) - Number(a.active) || a.name.localeCompare(b.name, "pt-BR"));
}

export async function saveProductFiscal(productId: string, profile: Omit<ProductFiscalProfile, "updatedAt" | "updatedBy">, actor: UserRef): Promise<void> {
  const product = await getById<Product>(COLLECTIONS.products, productId);
  if (!product) throw new BusinessError("Produto não encontrado");
  const clean: ProductFiscalProfile = {
    nature: profile.nature,
    serviceCode: profile.serviceCode?.trim() || undefined,
    issRate: profile.issRate,
    ncm: profile.ncm?.replace(/\D/g, "") || undefined,
    cfop: profile.cfop?.replace(/\D/g, "") || undefined,
    invoiceDescription: profile.invoiceDescription?.trim() || undefined,
    updatedAt: nowIso(),
    updatedBy: actor.id,
  };
  // update (não merge): substitui o perfil inteiro — campo apagado na tela some do cadastro.
  await col(COLLECTIONS.products)
    .doc(product.id)
    .update(cleanPatch({ fiscal: clean, updatedAt: nowIso() }));
  await emitEvent({
    type: "fiscal.product_updated",
    actor,
    entity: { type: "product", id: product.id },
    title: `Perfil fiscal de ${product.name} alterado`,
    description: [clean.nature, clean.serviceCode && `serviço ${clean.serviceCode}`, clean.ncm && `NCM ${clean.ncm}`, clean.cfop && `CFOP ${clean.cfop}`].filter(Boolean).join(" · "),
    department: "financeiro",
    payload: {
      productId: product.id,
      changes: { fiscal: { from: product.fiscal ?? null, to: clean } },
    },
    timeline: false,
  });
}

// ---------------------------------------------------------------------------
// Fila do faturamento
// ---------------------------------------------------------------------------

export interface InvoiceQueueRow {
  billingId: string;
  clientId: string;
  clientName: string;
  contractId: string;
  contractNumber: string;
  type: Billing["type"];
  typeLabel: string;
  installment?: number;
  competence: string;
  dueDate: string;
  amount: number;
  billingStatus: Billing["status"];
  state: InvoiceQueueState;
  /** Nota que a configuração pede (a da nota registrada, quando há). */
  kind: InvoiceKind | null;
  invoiceId?: string;
  invoiceNumber?: string;
  invoiceSentAt?: string;
  waivedReason?: string;
}

export interface InvoiceQueue {
  settings: FiscalSettings;
  rows: InvoiceQueueRow[];
  counts: Record<"a_faturar" | "aguardando" | "emitida" | "enviada" | "dispensada", number>;
}

/** Cobranças no faturamento (sem as fora do controle e as que não pedem nota), no escopo de quem vê. */
export async function getInvoiceQueue(options: { scope?: DataScope; hideValues?: boolean } = {}): Promise<InvoiceQueue> {
  const today = todayKey();
  const settings = await getFiscalSettings(today);
  const swept = await listBillingsSwept();
  const billings = options.scope ? filterBillingsByContracts(swept, await visibleContractIds(options.scope)) : swept;
  // "Próximas" só até 60 dias à frente: as mensalidades do contrato inteiro já existem e encheriam a lista.
  const horizon = new Date(`${today}T12:00:00Z`);
  horizon.setUTCDate(horizon.getUTCDate() + UPCOMING_DAYS);
  const until = horizon.toISOString().slice(0, 10);
  const relevant = billings
    .map((b) => ({ b, state: invoiceQueueState(b, settings, today) }))
    .filter((x) => x.state !== "fora" && x.state !== "sem_nota" && !(x.state === "aguardando" && x.b.dueDate.slice(0, 10) > until));
  const [clients, contracts] = await Promise.all([
    getManyByIds<Client>(
      COLLECTIONS.clients,
      relevant.map((x) => x.b.clientId),
    ),
    getManyByIds<Contract>(
      COLLECTIONS.contracts,
      relevant.map((x) => x.b.contractId),
    ),
  ]);
  const rows: InvoiceQueueRow[] = relevant
    .map(({ b, state }) => ({
      billingId: b.id,
      clientId: b.clientId,
      clientName: clients.get(b.clientId)?.tradeName ?? b.clientId,
      contractId: b.contractId,
      contractNumber: contracts.get(b.contractId)?.number ?? "—",
      type: b.type,
      typeLabel: BILLING_TYPE_FISCAL_LABELS[b.type],
      installment: b.installment,
      competence: b.competence,
      dueDate: b.dueDate,
      amount: options.hideValues ? 0 : b.amount,
      billingStatus: b.status,
      state,
      kind: b.invoiceKind ?? invoiceKindFor(b, settings),
      invoiceId: b.invoiceId,
      invoiceNumber: b.invoiceNumber,
      invoiceSentAt: b.invoiceSentAt,
      waivedReason: b.invoiceWaived?.reason,
    }))
    .sort((a, b) => a.dueDate.localeCompare(b.dueDate) || a.clientName.localeCompare(b.clientName, "pt-BR"));
  const counts = {
    a_faturar: 0,
    aguardando: 0,
    emitida: 0,
    enviada: 0,
    dispensada: 0,
  };
  for (const r of rows) if (r.state in counts) counts[r.state as keyof typeof counts]++;
  return { settings, rows, counts };
}

/** Quantas cobranças estão "A faturar" (atalho do painel do Financeiro). */
export async function countToInvoice(scope?: DataScope): Promise<number> {
  return (await getInvoiceQueue({ scope, hideValues: true })).counts.a_faturar;
}

// ---------------------------------------------------------------------------
// Dados para emitir (o que copiar para o emissor)
// ---------------------------------------------------------------------------

export interface InvoiceIssueData {
  billingId: string;
  kind: InvoiceKind | null;
  billing: {
    typeLabel: string;
    competence: string;
    dueDate: string;
    amount: number;
    installment?: number;
    status: Billing["status"];
  };
  contractNumber: string;
  taker: {
    legalName?: string;
    document?: string;
    email?: string;
    address: Address;
    municipalRegistration?: string;
    stateRegistration?: string;
  };
  items: InvoiceItem[];
  /** Os itens foram ajustados à cobrança (reajuste, parcela, desconto). */
  scaled: boolean;
  /** Pendências que travam a emissão (ex.: produto sem código, cliente sem CNPJ). */
  gaps: string[];
  description: string;
}

export async function getInvoiceIssueData(billingId: string): Promise<InvoiceIssueData> {
  const billing = await getById<Billing>(COLLECTIONS.billing, billingId);
  if (!billing) throw new BusinessError("Cobrança não encontrada");
  const [contract, client, settings] = await Promise.all([getById<Contract>(COLLECTIONS.contracts, billing.contractId), getById<Client>(COLLECTIONS.clients, billing.clientId), getFiscalSettings()]);
  if (!contract || !client) throw new BusinessError("Contrato ou cliente da cobrança não encontrado");
  const opportunity = contract.opportunityId ? await getById<Opportunity>(COLLECTIONS.opportunities, contract.opportunityId) : null;
  const { mergedBillingData } = await import("./service");
  const merged = mergedBillingData(client, opportunity);
  const products = await getManyByIds<Product>(
    COLLECTIONS.products,
    contract.items.map((i) => i.productId),
  );
  const kind = billing.invoiceKind ?? invoiceKindFor(billing, settings);
  const { items, scaled } = invoiceItems(billing, contract.items, products, settings);
  const gaps: string[] = [];
  if (!merged.legalName) gaps.push("Cliente sem razão social");
  if (!merged.document) gaps.push("Cliente sem CNPJ/CPF");
  if (!merged.address.street || !merged.address.city) gaps.push("Endereço do cliente incompleto");
  if (kind === "nfse") for (const i of items) if (!i.serviceCode) gaps.push(`${i.description}: sem código de serviço (perfil fiscal do produto ou padrão)`);
  if (kind === "nfe") for (const i of items) if (!i.ncm || !i.cfop) gaps.push(`${i.description}: sem NCM/CFOP (perfil fiscal do produto ou padrão)`);
  if (!settings.regime) gaps.push("Regime tributário da empresa não configurado");
  const typeLabel = BILLING_TYPE_FISCAL_LABELS[billing.type];
  const what = `${typeLabel}${billing.installment && billing.type !== "mensalidade" ? ` (parcela ${billing.installment})` : ""} · competência ${formatCompetence(billing.competence)} · contrato ${contract.number}`;
  return {
    billingId: billing.id,
    kind,
    billing: {
      typeLabel,
      competence: billing.competence,
      dueDate: billing.dueDate,
      amount: billing.amount,
      installment: billing.installment,
      status: billing.status,
    },
    contractNumber: contract.number,
    taker: {
      legalName: merged.legalName,
      document: merged.document,
      email: merged.email,
      address: merged.address,
    },
    items,
    scaled,
    gaps,
    description: billing.type === "servico" ? what : `${items.map((i) => `${i.quantity}x ${i.description}`).join("; ")} — ${what}`,
  };
}

// ---------------------------------------------------------------------------
// Registrar, cancelar, dispensar
// ---------------------------------------------------------------------------

export interface InvoiceFileInput {
  fileName: string;
  content: Buffer;
  mimeType?: string;
}

export interface RegisterInvoiceInput {
  billingId: string;
  kind: InvoiceKind;
  number: string;
  series?: string;
  issuedAt: string;
  accessKey?: string;
  verificationCode?: string;
  amount: number;
  notes?: string;
  pdf?: InvoiceFileInput;
  xml?: InvoiceFileInput;
}

/** Lê do XML da NF-e a chave (Id="NFe…") e o número (nNF), quando o arquivo é de NF-e. */
export function readNfeXml(xml: string): {
  accessKey?: string;
  number?: string;
  series?: string;
  amount?: number;
} {
  const key = /Id\s*=\s*"NFe(\d{44})"/.exec(xml)?.[1];
  const number = /<nNF>\s*(\d+)\s*<\/nNF>/.exec(xml)?.[1];
  const series = /<serie>\s*(\d+)\s*<\/serie>/.exec(xml)?.[1];
  const vnf = /<vNF>\s*([\d.]+)\s*<\/vNF>/.exec(xml)?.[1];
  return {
    accessKey: key,
    number,
    series,
    amount: vnf ? Number(vnf) : undefined,
  };
}

function checkPdf(f: InvoiceFileInput): void {
  if (f.content.length === 0) throw new BusinessError("O PDF da nota está vazio");
  if (f.content.length > INVOICE_PDF_MAX_BYTES) throw new BusinessError("PDF da nota maior que 3 MB");
  if (f.content.subarray(0, 5).toString("latin1") !== "%PDF-") throw new BusinessError("O arquivo da nota não é um PDF");
}

function checkXml(f: InvoiceFileInput): string {
  if (f.content.length === 0) throw new BusinessError("O XML da nota está vazio");
  if (f.content.length > INVOICE_XML_MAX_BYTES) throw new BusinessError("XML da nota maior que 1 MB");
  const text = f.content.toString("utf8").replace(/^﻿/, "");
  if (!text.trimStart().startsWith("<")) throw new BusinessError("O arquivo XML da nota não é um XML");
  return text;
}

function safeName(name: string, ext: string): string {
  const base =
    name
      .replace(/[\\/:*?"<>|\u0000-\u001f]+/g, "_")
      .trim()
      .slice(0, 120) || `nota.${ext}`;
  return base.toLowerCase().endsWith(`.${ext}`) ? base : `${base}.${ext}`;
}

export async function registerInvoice(input: RegisterInvoiceInput, actor: UserRef): Promise<Invoice> {
  const billing = await getById<Billing>(COLLECTIONS.billing, input.billingId);
  if (!billing) throw new BusinessError("Cobrança não encontrada");
  if (billing.status === "cancelada") throw new BusinessError("Cobrança cancelada não recebe nota fiscal");
  if (billing.invoiceId) throw new BusinessError("Esta cobrança já tem nota registrada: cancele a nota atual antes de registrar outra");
  const issuedAt = input.issuedAt.slice(0, 10);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(issuedAt) || Number.isNaN(Date.parse(`${issuedAt}T12:00:00Z`))) throw new BusinessError("Data de emissão inválida");
  if (issuedAt > todayKey()) throw new BusinessError("A data de emissão não pode ser no futuro");
  const xmlText = input.xml ? checkXml(input.xml) : undefined;
  if (input.pdf) checkPdf(input.pdf);
  const fromXml = xmlText && input.kind === "nfe" ? readNfeXml(xmlText) : {};
  const number = (input.number?.trim() || fromXml.number || "").slice(0, 20);
  if (!number) throw new BusinessError("Informe o número da nota");
  const series = (input.series?.trim() || fromXml.series || "").slice(0, 10) || undefined;
  const accessKey = normalizeAccessKey(input.accessKey) ?? fromXml.accessKey;
  if (input.kind === "nfe" && accessKey && !isValidAccessKey(accessKey)) throw new BusinessError("Chave de acesso inválida: confira os 44 dígitos");
  if (input.kind === "nfse" && accessKey) throw new BusinessError("Chave de acesso é da NF-e: na NFS-e informe o código de verificação");
  if (fromXml.accessKey && accessKey !== fromXml.accessKey) throw new BusinessError("A chave informada é diferente da chave do XML");
  if (fromXml.number && invoiceNumberKey(fromXml.number) !== invoiceNumberKey(number)) throw new BusinessError(`O número informado é diferente do XML (nota ${fromXml.number})`);
  const amount = Math.round(Number(input.amount) * 100) / 100;
  if (!Number.isFinite(amount) || amount <= 0) throw new BusinessError("Informe o valor da nota");
  if (fromXml.amount !== undefined && Math.abs(fromXml.amount - amount) >= 0.01) throw new BusinessError(`O valor informado é diferente do XML (${formatCurrency(fromXml.amount)})`);

  // Mesma nota não pode ser registrada duas vezes (mesmo tipo, série e número, ou mesma chave), salvo cancelada.
  const existing = await list<Invoice>(COLLECTIONS.invoices, {
    where: [["kind", "==", input.kind]],
  });
  const dup = existing.find(
    (i) => i.status !== "cancelada" && ((invoiceNumberKey(i.number) === invoiceNumberKey(number) && (i.series ?? "") === (series ?? "")) || (accessKey && i.accessKey === accessKey)),
  );
  if (dup) throw new BusinessError(`${INVOICE_KIND_SHORT[input.kind]} ${dup.number}${dup.series ? `/${dup.series}` : ""} já está registrada em outra cobrança`);

  const id = newId(COLLECTIONS.invoices);
  const files: { kind: "pdf" | "xml"; id: string; name: string }[] = [];
  const saveFile = async (kind: "pdf" | "xml", f: InvoiceFileInput) => {
    const fileId = `${id}_${kind}`;
    const name = safeName(f.fileName, kind);
    await create<InvoiceFile>(
      COLLECTIONS.invoiceFiles,
      {
        invoiceId: id,
        kind,
        fileName: name,
        mimeType: kind === "pdf" ? "application/pdf" : "application/xml",
        size: f.content.length,
        contentBase64: f.content.toString("base64"),
      },
      fileId,
    );
    files.push({ kind, id: fileId, name });
  };
  if (input.pdf) await saveFile("pdf", input.pdf);
  if (input.xml) await saveFile("xml", input.xml);
  const pdf = files.find((f) => f.kind === "pdf");
  const xml = files.find((f) => f.kind === "xml");
  const now = nowIso();
  const invoice: Omit<Invoice, "id"> = {
    organizationId: billing.organizationId,
    clientId: billing.clientId,
    contractId: billing.contractId,
    billingId: billing.id,
    kind: input.kind,
    number,
    series,
    issuedAt,
    accessKey: input.kind === "nfe" ? accessKey : undefined,
    verificationCode: input.kind === "nfse" ? input.verificationCode?.trim().slice(0, 60) || undefined : undefined,
    amount,
    status: "emitida",
    pdfFileId: pdf?.id,
    pdfFileName: pdf?.name,
    xmlFileId: xml?.id,
    xmlFileName: xml?.name,
    notes: input.notes?.trim().slice(0, 500) || undefined,
    createdBy: actor.id,
    createdByName: actor.name,
    createdAt: now,
    updatedAt: now,
  };
  try {
    await docdb.runTransaction(async (tx) => {
      const ref = col(COLLECTIONS.billing).doc(billing.id);
      const snap = await txGetOwn(tx, ref);
      if (!snap) throw new BusinessError("Cobrança não encontrada");
      const current = snap.data() as unknown as Billing;
      if (current.status === "cancelada") throw new BusinessError("Cobrança cancelada não recebe nota fiscal");
      if (current.invoiceId) throw new BusinessError("Esta cobrança acabou de receber outra nota: recarregue a página");
      tx.create(col(COLLECTIONS.invoices).doc(id), cleanPatch(invoice as unknown as Record<string, unknown>));
      tx.update(
        ref,
        cleanPatch({
          invoiceId: id,
          invoiceNumber: series ? `${number}/${series}` : number,
          invoiceKind: input.kind,
          invoiceSentAt: FieldValue.delete(),
          invoiceWaived: FieldValue.delete(),
          updatedAt: now,
        }),
      );
    });
  } catch (error) {
    await Promise.all(files.map((f) => remove(COLLECTIONS.invoiceFiles, f.id).catch(() => undefined)));
    throw error;
  }
  const label = `${INVOICE_KIND_SHORT[input.kind]} ${number}${series ? `/${series}` : ""}`;
  await emitEvent({
    type: "invoice.issued",
    actor,
    clientId: billing.clientId,
    entity: { type: "invoice", id },
    title: `${label} registrada`,
    description: `${BILLING_TYPE_FISCAL_LABELS[billing.type]} · competência ${formatCompetence(billing.competence)} · ${formatCurrency(amount)}${files.length ? ` · ${files.map((f) => f.kind.toUpperCase()).join(" e ")} anexado(s)` : ""}`,
    department: "financeiro",
    payload: {
      invoiceId: id,
      billingId: billing.id,
      contractId: billing.contractId,
      kind: input.kind,
      number,
      series: series ?? null,
      amount,
      hasPdf: Boolean(pdf),
      hasXml: Boolean(xml),
    },
  });
  return { ...invoice, id } as Invoice;
}

export async function cancelInvoice(invoiceId: string, reason: string, actor: UserRef): Promise<Invoice> {
  const text = reason.trim();
  if (text.length < 5) throw new BusinessError("Explique o motivo do cancelamento");
  const now = nowIso();
  const before = await docdb.runTransaction(async (tx) => {
    const ref = col(COLLECTIONS.invoices).doc(invoiceId);
    const snap = await txGetOwn(tx, ref);
    if (!snap) throw new BusinessError("Nota não encontrada");
    const inv = {
      ...(snap.data() as Omit<Invoice, "id">),
      id: invoiceId,
    } as Invoice;
    if (inv.status === "cancelada") throw new BusinessError("Esta nota já está cancelada");
    const billingRef = col(COLLECTIONS.billing).doc(inv.billingId);
    const billingSnap = await txGetOwn(tx, billingRef);
    tx.update(
      ref,
      cleanPatch({
        status: "cancelada",
        cancelledAt: now,
        cancelledBy: actor.id,
        cancelReason: text.slice(0, 500),
        updatedAt: now,
      }),
    );
    if (billingSnap && (billingSnap.data() as unknown as Billing).invoiceId === invoiceId) {
      tx.update(
        billingRef,
        cleanPatch({
          invoiceId: FieldValue.delete(),
          invoiceNumber: FieldValue.delete(),
          invoiceKind: FieldValue.delete(),
          invoiceSentAt: FieldValue.delete(),
          updatedAt: now,
        }),
      );
    }
    return inv;
  });
  await emitEvent({
    type: "invoice.cancelled",
    actor,
    clientId: before.clientId,
    entity: { type: "invoice", id: invoiceId },
    title: `${INVOICE_KIND_SHORT[before.kind]} ${before.number}${before.series ? `/${before.series}` : ""} cancelada`,
    description: `${text} · a cobrança volta para "A faturar"`,
    department: "financeiro",
    payload: {
      invoiceId,
      billingId: before.billingId,
      contractId: before.contractId,
      reason: text,
      changes: { status: { from: "emitida", to: "cancelada" } },
    },
  });
  return {
    ...before,
    status: "cancelada",
    cancelledAt: now,
    cancelledBy: actor.id,
    cancelReason: text,
  };
}

export async function waiveBillingInvoice(billingId: string, reason: string, actor: UserRef): Promise<void> {
  const text = reason.trim();
  if (text.length < 5) throw new BusinessError("Explique por que esta cobrança não terá nota");
  const billing = await getById<Billing>(COLLECTIONS.billing, billingId);
  if (!billing) throw new BusinessError("Cobrança não encontrada");
  if (billing.invoiceId) throw new BusinessError("Esta cobrança já tem nota registrada");
  if (billing.invoiceWaived) throw new BusinessError("Esta cobrança já está dispensada de nota");
  await update<Billing>(COLLECTIONS.billing, billing.id, {
    invoiceWaived: {
      reason: text.slice(0, 300),
      at: nowIso(),
      by: actor.id,
      byName: actor.name,
    },
  });
  await emitEvent({
    type: "invoice.waived",
    actor,
    clientId: billing.clientId,
    entity: { type: "billing", id: billing.id },
    title: `Cobrança dispensada de nota fiscal (${BILLING_TYPE_FISCAL_LABELS[billing.type]} · ${formatCompetence(billing.competence)})`,
    description: text,
    department: "financeiro",
    payload: {
      billingId: billing.id,
      contractId: billing.contractId,
      reason: text,
    },
    timeline: false,
  });
}

export async function restoreBillingInvoice(billingId: string, actor: UserRef): Promise<void> {
  const billing = await getById<Billing>(COLLECTIONS.billing, billingId);
  if (!billing) throw new BusinessError("Cobrança não encontrada");
  if (!billing.invoiceWaived) throw new BusinessError("Esta cobrança não está dispensada de nota");
  await col(COLLECTIONS.billing)
    .doc(billing.id)
    .update(cleanPatch({ invoiceWaived: FieldValue.delete(), updatedAt: nowIso() }));
  await emitEvent({
    type: "invoice.waiver_removed",
    actor,
    clientId: billing.clientId,
    entity: { type: "billing", id: billing.id },
    title: `Cobrança volta a exigir nota fiscal (${BILLING_TYPE_FISCAL_LABELS[billing.type]} · ${formatCompetence(billing.competence)})`,
    description: `Dispensa anterior: ${billing.invoiceWaived.reason}`,
    department: "financeiro",
    payload: { billingId: billing.id, contractId: billing.contractId },
    timeline: false,
  });
}

// ---------------------------------------------------------------------------
// Envio ao cliente
// ---------------------------------------------------------------------------

export interface InvoiceSendResult {
  channel: SendChannel;
  delivery: string;
  delivered: boolean;
  manual: boolean;
  url: string | null;
  to?: string;
  error?: string;
}

export async function getInvoice(invoiceId: string): Promise<Invoice | null> {
  return getById<Invoice>(COLLECTIONS.invoices, invoiceId);
}

/** Texto sugerido do envio (a tela mostra e deixa editar). */
export async function invoiceMessageDraft(invoiceId: string): Promise<{
  text: string;
  contactName: string;
  email?: string;
  phone?: string;
}> {
  const invoice = await getInvoice(invoiceId);
  if (!invoice) throw new BusinessError("Nota não encontrada");
  const [ctx, settings] = await Promise.all([loadBillingMessageContext(invoice.billingId), getFiscalSettings()]);
  const b = ctx.billing;
  const text = fillInvoiceMessage(settings.messageTemplate || DEFAULT_INVOICE_MESSAGE, {
    cliente: ctx.contactName,
    nota: `${INVOICE_KIND_SHORT[invoice.kind]} nº ${invoice.number}${invoice.series ? `/${invoice.series}` : ""}`,
    valor: formatCurrency(invoice.amount),
    cobranca: `${BILLING_TYPE_FISCAL_LABELS[b.type].toLowerCase()} de ${formatCompetence(b.competence)}`,
  });
  return {
    text,
    contactName: ctx.contactName,
    email: ctx.email,
    phone: ctx.phone,
  };
}

export async function sendInvoice(
  invoiceId: string,
  input: { channel: "email" | "whatsapp" | "ambos"; text?: string },
  actor: UserRef,
): Promise<{ results: InvoiceSendResult[]; contactName: string }> {
  const invoice = await getInvoice(invoiceId);
  if (!invoice) throw new BusinessError("Nota não encontrada");
  if (invoice.status === "cancelada") throw new BusinessError("Nota cancelada não é enviada ao cliente");
  const billingNow = await getById<Billing>(COLLECTIONS.billing, invoice.billingId);
  if (billingNow?.status === "cancelada") throw new BusinessError("A cobrança desta nota foi cancelada: cancele também a nota em vez de enviá-la");
  const draft = await invoiceMessageDraft(invoiceId);
  const ctx = await loadBillingMessageContext(invoice.billingId);
  const channels: ("email" | "whatsapp")[] = input.channel === "ambos" ? ["email", "whatsapp"] : [input.channel];
  let text = input.text?.trim() || draft.text;
  let portalUrl: string | undefined;
  if (templateUsesPortalLink(text)) {
    const canDeliver = channels.some((ch) => Boolean(ch === "whatsapp" ? ctx.phone : ctx.email) && !ctx.client.communicationOptOut?.[ch]);
    const portal = canDeliver
      ? await createMessagePortalLink(
          {
            clientId: invoice.clientId,
            contractId: invoice.contractId,
            label: `Nota fiscal ${invoice.number}`,
          },
          actor,
        )
      : null;
    portalUrl = portal?.url;
    text = fillPortalLink(text, portalUrl);
  }
  const recorded = portalUrl ? text.replaceAll(portalUrl, "[link do portal]") : text;
  const subject = `Nota fiscal ${INVOICE_KIND_SHORT[invoice.kind]} nº ${invoice.number} — ${ctx.client.tradeName}`;
  const results: InvoiceSendResult[] = [];
  for (const channel of channels) {
    const to = channel === "whatsapp" ? ctx.phone : ctx.email;
    const sent = await sendOrRecord({
      channel,
      to,
      subject,
      text,
      recordText: recorded,
      clientId: invoice.clientId,
      contactId: ctx.contact?.id ?? ctx.primary?.id,
      templateKey: "nota_fiscal",
      entity: { type: "invoice", id: invoice.id },
      actor,
      whenNotConnected: "manual",
    });
    results.push({
      channel,
      delivery: sent.delivery,
      delivered: sent.delivery === "enviada",
      manual: sent.delivery === "manual",
      url: sent.manualUrl,
      to,
      error: sent.error,
    });
  }
  const ok = results.filter((r) => r.delivered || r.manual);
  if (ok.length === 0) {
    const why = results.map((r) => `${r.channel === "email" ? "e-mail" : "WhatsApp"}: ${r.error ?? (r.to ? "não enviado" : "cliente sem contato")}`).join("; ");
    throw new BusinessError(`Nota não enviada (${why})`);
  }
  if (ok.length > 0) {
    const now = nowIso();
    await update<Invoice>(COLLECTIONS.invoices, invoice.id, {
      sentAt: now,
      sentBy: actor.id,
      sentChannels: Array.from(new Set([...(invoice.sentChannels ?? []), ...ok.map((r) => r.channel as "email" | "whatsapp")])),
    });
    const billing = await getById<Billing>(COLLECTIONS.billing, invoice.billingId);
    if (billing?.invoiceId === invoice.id)
      await update<Billing>(COLLECTIONS.billing, billing.id, {
        invoiceSentAt: now,
      });
    await emitEvent({
      type: "invoice.sent",
      actor,
      clientId: invoice.clientId,
      entity: { type: "invoice", id: invoice.id },
      title: `${INVOICE_KIND_SHORT[invoice.kind]} ${invoice.number} enviada ao cliente`,
      description: ok.map((r) => `${r.channel === "email" ? "e-mail" : "WhatsApp"}${r.manual ? " (pelo seu aplicativo)" : ""}${r.to ? ` · ${r.to}` : ""}`).join("; "),
      department: "financeiro",
      payload: {
        invoiceId: invoice.id,
        billingId: invoice.billingId,
        channels: ok.map((r) => r.channel),
        manual: ok.some((r) => r.manual),
      },
    });
  }
  return { results, contactName: draft.contactName };
}

// ---------------------------------------------------------------------------
// Arquivos e listagem
// ---------------------------------------------------------------------------

export async function getInvoiceFile(invoice: Pick<Invoice, "pdfFileId" | "xmlFileId">, kind: "pdf" | "xml"): Promise<InvoiceFile | null> {
  const id = kind === "pdf" ? invoice.pdfFileId : invoice.xmlFileId;
  return id ? getById<InvoiceFile>(COLLECTIONS.invoiceFiles, id) : null;
}

export interface InvoiceListRow extends Omit<Invoice, "organizationId"> {
  clientName: string;
  contractNumber: string;
  billingLabel: string;
}

/** Notas registradas (mais recentes primeiro), no escopo de quem vê. */
export async function listInvoices(options: { scope?: DataScope; hideValues?: boolean; limit?: number } = {}): Promise<InvoiceListRow[]> {
  const all = await list<Invoice>(COLLECTIONS.invoices);
  const visible = options.scope ? await visibleContractIds(options.scope) : null;
  const scoped = visible ? all.filter((i) => visible.has(i.contractId)) : all;
  const sorted = scoped.sort((a, b) => b.issuedAt.localeCompare(a.issuedAt) || b.createdAt.localeCompare(a.createdAt)).slice(0, options.limit ?? 300);
  const [clients, contracts, billings] = await Promise.all([
    getManyByIds<Client>(
      COLLECTIONS.clients,
      sorted.map((i) => i.clientId),
    ),
    getManyByIds<Contract>(
      COLLECTIONS.contracts,
      sorted.map((i) => i.contractId),
    ),
    getManyByIds<Billing>(
      COLLECTIONS.billing,
      sorted.map((i) => i.billingId),
    ),
  ]);
  return sorted.map((i) => {
    const b = billings.get(i.billingId);
    const { organizationId: _o, ...rest } = i;
    void _o;
    return {
      ...rest,
      amount: options.hideValues ? 0 : i.amount,
      clientName: clients.get(i.clientId)?.tradeName ?? i.clientId,
      contractNumber: contracts.get(i.contractId)?.number ?? "—",
      billingLabel: b ? `${BILLING_TYPE_FISCAL_LABELS[b.type]} · ${formatCompetence(b.competence)} · venc. ${formatDate(b.dueDate)}` : "—",
    };
  });
}
