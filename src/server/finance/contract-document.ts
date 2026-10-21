import "server-only";
/**
 * Documento do contrato para assinatura: PDF gerado pelo INTEROS (pdfkit) e Word preenchido (modelo .docx).
 *
 * O conteúdo é o mesmo da página imprimível (/financeiro/contratos/[id]/documento): partes, objeto, valores, condições,
 * cláusulas do modelo e assinaturas, com o código de integridade no rodapé. Depois de gerado para assinatura, o
 * documento usa o modelo fixado no contrato (documentTemplate); antes disso, o modelo atual (prévia).
 */
import PDFDocument from "pdfkit";
import { getById, ORG_ID } from "@/server/db";
import { HEADQUARTERS, formatAddressLine } from "@/server/sales/maps";
import { RECURRENCE_LABELS, paymentMethodLabel } from "./schemas";
import { getContract } from "./queries";
import { contractDocumentHash } from "./signature";
import { documentTemplateSnapshot, getTemplateFile, templateForContract } from "./contract-templates";
import { fillDocx } from "./docx";
import { pdfSafe } from "@/server/reports/export-pdf";
import { BLANK, isCompanySigner, contractFieldValues, contractFirstYear, extractVariables, fillTemplateText, variableValues } from "@/domain/contract-templates";
import { COLLECTIONS, type Client, type Contract, type ContractDocumentTemplate, type Organization } from "@/domain/types";
import { formatDocument } from "@/lib/format";
import { netItem } from "@/components/sales/model";

export interface ContractDocumentData {
  contract: Contract;
  client: Pick<Client, "legalName" | "tradeName">;
  billingData: { legalName?: string; document?: string; email?: string; address: Client["address"] };
  companyName: string;
  companyAddress: string;
  /** Data da geração para assinatura (ou agora, na prévia). */
  issuedAt: string;
  /** Modelo do documento: o fixado no contrato ou, antes de gerar, o atual. */
  template: ContractDocumentTemplate | null;
  /** O modelo ainda não foi fixado (documento não gerado para assinatura). */
  preview: boolean;
  /** Valor de cada {{variável}} do modelo. */
  values: Record<string, string>;
  /** Cláusulas do modelo INTEROS já preenchidas. */
  clauses?: { title?: string; text: string };
  hash: string;
}

/**
 * `sending`: o contrato como está sendo enviado agora para assinatura (signatários e modelo já fixados, ainda não
 * gravados): o documento sai exatamente com eles.
 */
export async function contractDocumentData(contractId: string, sending?: Contract): Promise<ContractDocumentData | null> {
  const [detail, organization] = await Promise.all([getContract(contractId), getById<Organization>(COLLECTIONS.organizations, ORG_ID)]);
  if (!detail) return null;
  const { client, billingData } = detail;
  const contract = sending ?? detail.contract;
  // Documento já gerado (ou sendo enviado): vale o modelo fixado nele (contrato gerado antes dos modelos fica sem
  // cláusulas, como foi gerado). Antes de gerar: prévia com o modelo atual.
  const generated = Boolean(sending) || Boolean(contract.signatureEnvelopeId);
  let template: ContractDocumentTemplate | null = contract.documentTemplate ?? null;
  if (!generated) {
    const current = await templateForContract(contract);
    template = current ? await documentTemplateSnapshot(current).catch(() => null) : null;
  }
  const companyName = organization?.name ?? "Intercert";
  const companyAddress = HEADQUARTERS.label.replace("Sede Intercert — ", "");
  const issuedAt = sending ? new Date().toISOString() : (detail.sentAt ?? new Date().toISOString());
  const fields = contractFieldValues({
    contract,
    client,
    billingData: { ...billingData, address: billingData.address ?? {} },
    companyName,
    companyAddress,
    issuedAt,
    labels: { recurrence: RECURRENCE_LABELS[contract.recurrence], paymentMethod: contract.paymentMethod ? paymentMethodLabel(contract.paymentMethod) : undefined },
  });
  const names = template?.kind === "interos" ? extractVariables(`${template.title ?? ""}\n${template.clauses ?? ""}`) : [];
  const values = variableValues(template?.variables ?? [], fields, names);
  const clauses = template?.kind === "interos" && template.clauses?.trim() ? { title: template.title ? fillTemplateText(template.title, values) : undefined, text: fillTemplateText(template.clauses, values) } : undefined;
  return {
    contract,
    client,
    billingData: { ...billingData, address: billingData.address ?? {} },
    companyName,
    companyAddress,
    issuedAt,
    template,
    preview: !generated,
    values,
    clauses,
    hash: sending ? contractDocumentHash(sending) : (contract.documentHash ?? contractDocumentHash(contract)),
  };
}

function fileSlug(contract: Contract): string {
  return `contrato-${contract.number}-v${contract.version}`.replace(/[^A-Za-z0-9._-]+/g, "-");
}

// ---------------------------------------------------------------------------
// Word preenchido
// ---------------------------------------------------------------------------

/** Word do modelo com as variáveis do contrato (null quando o modelo do contrato não é Word). */
export async function contractDocx(data: ContractDocumentData): Promise<{ buffer: Buffer; fileName: string } | null> {
  if (data.template?.kind !== "word") return null;
  const file = await getTemplateFile(data.template.id, data.template.version);
  if (!file) return null;
  const buffer = fillDocx(Buffer.from(file.contentBase64, "base64"), data.values, BLANK);
  return { buffer, fileName: `${fileSlug(data.contract)}.docx` };
}

// ---------------------------------------------------------------------------
// PDF
// ---------------------------------------------------------------------------

const MARGIN = 50;
const NAVY = "#0B1F3A";
const BRAND = "#1D4ED8";
const MUTED = "#475569";
const BORDER = "#CBD5E1";
const brl = new Intl.NumberFormat("pt-BR", { style: "currency", currency: "BRL" });
const money = (v: number) => brl.format(v).replace(/ /g, " ");

function br(iso?: string): string {
  if (!iso) return "—";
  const [y, m, d] = iso.slice(0, 10).split("-");
  return `${d}/${m}/${y}`;
}

export function contractPdf(data: ContractDocumentData): Promise<{ buffer: Buffer; fileName: string }> {
  const { contract: c, billingData: b } = data;
  return new Promise((resolve, reject) => {
    const doc = new PDFDocument({ size: "A4", margin: MARGIN, bufferPages: true, info: { Title: `Contrato ${c.number} v${c.version}`, Author: data.companyName, Subject: "Contrato de licenciamento e serviços" } });
    const chunks: Buffer[] = [];
    doc.on("data", (chunk: Buffer) => chunks.push(chunk));
    doc.on("end", () => resolve({ buffer: Buffer.concat(chunks), fileName: `${fileSlug(c)}.pdf` }));
    doc.on("error", reject);

    const width = doc.page.width - MARGIN * 2;
    const bottom = () => doc.page.height - MARGIN - 30;
    const ensure = (h: number) => {
      if (doc.y + h > bottom()) doc.addPage();
    };
    const heading = (text: string) => {
      ensure(40);
      doc.moveDown(0.8);
      doc.font("Helvetica-Bold").fontSize(9).fillColor(MUTED).text(pdfSafe(text.toUpperCase()), MARGIN, doc.y, { width, characterSpacing: 0.6 });
      doc.moveDown(0.3);
      doc.fillColor(NAVY).font("Helvetica").fontSize(10);
    };
    const line = (text: string, opts: { bold?: boolean } = {}) => {
      doc.font(opts.bold ? "Helvetica-Bold" : "Helvetica").fontSize(10).fillColor(NAVY).text(pdfSafe(text), MARGIN, doc.y, { width });
    };

    // Cabeçalho
    doc.font("Helvetica-Bold").fontSize(18).fillColor(NAVY).text(pdfSafe(data.companyName), MARGIN, MARGIN, { width: width / 2 });
    doc.font("Helvetica").fontSize(9).fillColor(MUTED).text(pdfSafe(data.companyAddress), { width: width / 2 });
    const top = MARGIN;
    doc.font("Helvetica-Bold").fontSize(12).fillColor(NAVY).text(pdfSafe(data.clauses?.title || "Contrato de licenciamento e serviços"), MARGIN + width / 2, top, { width: width / 2, align: "right" });
    doc.font("Helvetica").fontSize(9).fillColor(MUTED).text(`${c.number} · versão ${c.version}`, { width: width / 2, align: "right" });
    doc.text(`Emitido em ${br(data.issuedAt)}${data.preview ? " (prévia)" : ""}`, { width: width / 2, align: "right" });
    doc.y = Math.max(doc.y, top + 46);
    doc.moveTo(MARGIN, doc.y + 4).lineTo(MARGIN + width, doc.y + 4).lineWidth(2).strokeColor(BRAND).stroke();
    doc.y += 12;

    // Partes
    heading("Partes");
    const partsTop = doc.y;
    const colW = width / 2 - 10;
    doc.font("Helvetica-Bold").fontSize(9).fillColor(MUTED).text("CONTRATANTE", MARGIN, partsTop, { width: colW });
    doc.font("Helvetica-Bold").fontSize(10).fillColor(NAVY).text(pdfSafe(b.legalName ?? data.client.legalName), { width: colW });
    doc.font("Helvetica").fontSize(9.5);
    if (data.client.tradeName && data.client.tradeName !== (b.legalName ?? data.client.legalName)) doc.text(pdfSafe(data.client.tradeName), { width: colW });
    doc.text(`CNPJ/CPF: ${formatDocument(b.document)}`, { width: colW });
    doc.text(pdfSafe(formatAddressLine(b.address) || "Endereço não informado"), { width: colW });
    if (b.email) doc.text(pdfSafe(b.email), { width: colW });
    const leftEnd = doc.y;
    doc.font("Helvetica-Bold").fontSize(9).fillColor(MUTED).text("CONTRATADA", MARGIN + colW + 20, partsTop, { width: colW });
    doc.font("Helvetica-Bold").fontSize(10).fillColor(NAVY).text(pdfSafe(data.companyName), { width: colW });
    doc.font("Helvetica").fontSize(9.5).text(pdfSafe(data.companyAddress), { width: colW });
    doc.y = Math.max(leftEnd, doc.y);
    doc.x = MARGIN;

    // Objeto
    heading("Objeto: produtos e serviços contratados");
    const cols = [
      { label: "Produto / serviço", w: 0.4, align: "left" as const },
      { label: "Qtd.", w: 0.08, align: "right" as const },
      { label: "Adesão", w: 0.17, align: "right" as const },
      { label: "Mensal", w: 0.17, align: "right" as const },
      { label: "Hardware", w: 0.18, align: "right" as const },
    ];
    const row = (cells: string[], bold = false) => {
      const heights = cells.map((t, i) => doc.font(bold ? "Helvetica-Bold" : "Helvetica").fontSize(9).heightOfString(pdfSafe(t), { width: cols[i].w * width - 8 }));
      const h = Math.max(...heights) + 8;
      ensure(h);
      const y = doc.y;
      let x = MARGIN;
      cells.forEach((t, i) => {
        doc.font(bold ? "Helvetica-Bold" : "Helvetica").fontSize(9).fillColor(NAVY).text(pdfSafe(t), x + 4, y + 4, { width: cols[i].w * width - 8, align: cols[i].align });
        x += cols[i].w * width;
      });
      doc.moveTo(MARGIN, y + h).lineTo(MARGIN + width, y + h).lineWidth(0.5).strokeColor(BORDER).stroke();
      doc.y = y + h;
      doc.x = MARGIN;
    };
    row(cols.map((x) => x.label), true);
    for (const i of c.items) {
      const n = netItem(i);
      row([`${i.productName}${i.discountPct ? ` (desconto ${i.discountPct}%)` : ""}`, String(i.quantity), money(n.setupTotal), money(n.monthlyTotal), money(n.hardwareTotal)]);
    }
    if (c.items.length === 0) row(["Nenhum item", "", "", "", ""]);
    doc.moveDown(0.5);
    const totals: [string, string][] = [
      ["Adesão / setup", money(c.setupTotal)],
      ["Mensalidade", money(c.monthlyTotal)],
      ["Hardware", money(c.hardwareTotal)],
      ["Valor no 1º ano", money(contractFirstYear(c))],
    ];
    for (const [label, value] of totals) {
      ensure(14);
      const y = doc.y;
      const strong = label.startsWith("Valor");
      doc.font(strong ? "Helvetica-Bold" : "Helvetica").fontSize(9.5).fillColor(strong ? NAVY : MUTED).text(label, MARGIN + width * 0.55, y, { width: width * 0.25 });
      doc.font("Helvetica-Bold").fillColor(NAVY).text(value, MARGIN + width * 0.8, y, { width: width * 0.2, align: "right" });
      doc.x = MARGIN;
    }

    // Condições
    heading("Condições");
    line(`Recorrência: ${RECURRENCE_LABELS[c.recurrence]} · prazo de ${c.termMonths} meses · vencimento todo dia ${c.billingDay}`);
    if (c.firstDueDate) line(`Primeiro vencimento: ${br(c.firstDueDate)}`);
    if (c.startDate) line(`Vigência: ${br(c.startDate)} a ${br(c.endDate)}`);
    if (c.paymentMethod) line(`Forma de pagamento: ${paymentMethodLabel(c.paymentMethod)}${c.setupInstallments && c.setupInstallments > 1 ? ` · adesão em ${c.setupInstallments} parcelas` : ""}`);
    if (c.autoRenew !== undefined) line(`Renovação: ${c.autoRenew ? `automática por ${c.renewalTermMonths ?? c.termMonths} meses` : "mediante negociação"}`);
    if (c.paymentCondition?.trim()) {
      heading("Condição de pagamento");
      line(c.paymentCondition.trim());
    }

    // Cláusulas do modelo
    if (data.clauses) {
      heading("Cláusulas");
      for (const paragraph of data.clauses.text.split(/\n{2,}/)) {
        const text = pdfSafe(paragraph.trim());
        if (!text) continue;
        const title = /^(cl[aá]usula|par[aá]grafo)\b/i.test(text) && text.length < 120 && !text.includes("\n");
        doc.font(title ? "Helvetica-Bold" : "Helvetica").fontSize(10);
        ensure(Math.min(doc.heightOfString(text, { width }), 80) + 6);
        doc.fillColor(NAVY).text(text, MARGIN, doc.y, { width, align: title ? "left" : "justify" });
        doc.moveDown(0.5);
      }
    }

    // Assinaturas
    heading("Assinaturas");
    const signers = c.signers.length ? c.signers : [];
    const hasCompany = signers.some((s) => isCompanySigner(s));
    const blocks = [...signers.map((s) => ({ name: s.name, role: s.role, email: s.email })), ...(hasCompany ? [] : [{ name: data.companyName, role: "Contratada", email: "" }])];
    const blockW = width / 2 - 15;
    for (let i = 0; i < blocks.length; i += 2) {
      ensure(70);
      const y = doc.y + 30;
      blocks.slice(i, i + 2).forEach((s, k) => {
        const x = MARGIN + k * (blockW + 30);
        doc.moveTo(x, y).lineTo(x + blockW, y).lineWidth(0.7).strokeColor(MUTED).stroke();
        doc.font("Helvetica-Bold").fontSize(9.5).fillColor(NAVY).text(pdfSafe(s.name), x, y + 4, { width: blockW, align: "center" });
        doc.font("Helvetica").fontSize(8.5).fillColor(MUTED).text(pdfSafe([s.role, s.email].filter(Boolean).join(" · ")), x, doc.y, { width: blockW, align: "center" });
      });
      doc.y = y + 36;
      doc.x = MARGIN;
    }

    // Rodapé: integridade e páginas
    const range = doc.bufferedPageRange();
    for (let p = range.start; p < range.start + range.count; p++) {
      doc.switchToPage(p);
      const y = doc.page.height - MARGIN + 6;
      doc.font("Helvetica").fontSize(7).fillColor(MUTED);
      doc.text(pdfSafe(`Código de integridade: ${data.hash}${data.template ? ` · modelo ${data.template.name} v${data.template.version}` : ""}`), MARGIN, y, { width: width - 60, lineBreak: false, height: 10 });
      doc.text(`${p - range.start + 1}/${range.count}`, MARGIN + width - 50, y, { width: 50, align: "right", lineBreak: false, height: 10 });
    }
    doc.end();
  });
}
