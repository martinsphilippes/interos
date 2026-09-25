import "server-only";
/**
 * Exportação PDF (pdfkit, fonte padrão Helvetica): A4 paisagem com título, filtros aplicados, data de
 * geração, tabela paginada com cabeçalho repetido em cada página, linha de totais e numeração de páginas.
 */
import PDFDocument from "pdfkit";
import type { ReportData } from "./build";
import { formatReportDate, formatReportValue, type ColumnType, type ReportColumn } from "./definitions";

const MARGIN = 32;
const FONT_SIZE = 7.5;
const CELL_PAD = 3;
const NAVY = "#0B1F3A";
const MUTED = "#64748B";
const BORDER = "#E2E8F0";
const ZEBRA = "#F8FAFC";

const NUMERIC: ColumnType[] = ["numero", "moeda", "percentual", "dias", "horas", "minutos", "nota"];

function columnWidths(columns: ReportColumn[], available: number): number[] {
  const base = columns.map((c) => c.width ?? (c.type === "moeda" ? 13 : c.type === "data" ? 10 : 10));
  const total = base.reduce((s, w) => s + w, 0);
  return base.map((w) => (w / total) * available);
}

function generatedLabel(iso: string): string {
  const local = new Date(Date.parse(iso) - 3 * 3_600_000).toISOString();
  return `${formatReportDate(iso)} às ${local.slice(11, 16)}`;
}

export function reportToPdf(data: ReportData): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    const doc = new PDFDocument({ size: "A4", layout: "landscape", margin: MARGIN, bufferPages: true, info: { Title: `INTEROS · ${data.definition.title}`, Author: "INTEROS" } });
    const chunks: Buffer[] = [];
    doc.on("data", (chunk: Buffer) => chunks.push(chunk));
    doc.on("end", () => resolve(Buffer.concat(chunks)));
    doc.on("error", reject);

    const { columns } = data.definition;
    const pageWidth = doc.page.width - MARGIN * 2;
    const widths = columnWidths(columns, pageWidth);
    const bottom = () => doc.page.height - MARGIN - 14;

    // Cabeçalho do documento.
    doc.font("Helvetica-Bold").fontSize(15).fillColor(NAVY).text(`Relatório de ${data.definition.title}`, MARGIN, MARGIN);
    doc.font("Helvetica").fontSize(8.5).fillColor(MUTED).text(data.definition.description, { width: pageWidth });
    doc.moveDown(0.3);
    const filterText = data.filters.map((f) => `${f.label}: ${f.value}`).join("   ·   ");
    doc.fillColor("#0F172A").text(filterText || "Sem filtros", { width: pageWidth });
    doc.fillColor(MUTED).text(`Gerado em ${generatedLabel(data.generatedAt)} · ${data.rows.length} linha(s)`, { width: pageWidth });
    doc.moveDown(0.6);

    const rowHeight = (texts: string[], bold: boolean) => {
      doc.font(bold ? "Helvetica-Bold" : "Helvetica").fontSize(FONT_SIZE);
      return Math.max(...texts.map((t, i) => doc.heightOfString(t, { width: widths[i] - CELL_PAD * 2 }))) + CELL_PAD * 2;
    };

    const drawRow = (texts: string[], y: number, opts: { header?: boolean; bold?: boolean; fill?: string }) => {
      const h = rowHeight(texts, Boolean(opts.header || opts.bold));
      if (opts.fill) doc.rect(MARGIN, y, pageWidth, h).fill(opts.fill);
      let x = MARGIN;
      doc.font(opts.header || opts.bold ? "Helvetica-Bold" : "Helvetica").fontSize(FONT_SIZE).fillColor(opts.header ? "#FFFFFF" : "#0F172A");
      texts.forEach((t, i) => {
        const align = !opts.header && NUMERIC.includes(columns[i].type) ? "right" : "left";
        doc.text(t, x + CELL_PAD, y + CELL_PAD, { width: widths[i] - CELL_PAD * 2, align });
        x += widths[i];
      });
      doc.moveTo(MARGIN, y + h).lineTo(MARGIN + pageWidth, y + h).lineWidth(0.5).strokeColor(BORDER).stroke();
      return h;
    };

    const headerTexts = columns.map((c) => c.label);
    const drawHeader = (y: number) => drawRow(headerTexts, y, { header: true, fill: NAVY });

    let y = doc.y;
    y += drawHeader(y);

    const body = data.rows.map((r) => columns.map((c) => formatReportValue(r.cells[c.key] ?? null, c.type)));
    if (body.length === 0) {
      doc.font("Helvetica").fontSize(9).fillColor(MUTED).text("Nenhum registro para os filtros aplicados.", MARGIN, y + 8);
    }
    body.forEach((texts, index) => {
      const h = rowHeight(texts, false);
      if (y + h > bottom()) {
        doc.addPage();
        y = MARGIN;
        y += drawHeader(y);
      }
      y += drawRow(texts, y, { fill: index % 2 === 1 ? ZEBRA : undefined });
    });
    if (data.totals) {
      const texts = columns.map((c) => (data.totals![c.key] === undefined ? "" : formatReportValue(data.totals![c.key] ?? null, c.type).replace(/^—$/, "")));
      const h = rowHeight(texts, true);
      if (y + h > bottom()) {
        doc.addPage();
        y = MARGIN;
        y += drawHeader(y);
      }
      drawRow(texts, y, { bold: true, fill: "#F1F5F9" });
    }

    // Rodapé com numeração em todas as páginas.
    const range = doc.bufferedPageRange();
    for (let i = range.start; i < range.start + range.count; i++) {
      doc.switchToPage(i);
      // Sem margem inferior durante o rodapé: evita que o pdfkit abra uma página nova.
      const bottomMargin = doc.page.margins.bottom;
      doc.page.margins.bottom = 0;
      doc.font("Helvetica").fontSize(7).fillColor(MUTED);
      doc.text(`INTEROS · ${data.definition.title} · ${data.periodLabel}`, MARGIN, doc.page.height - MARGIN - 4, { width: pageWidth / 2, lineBreak: false });
      doc.text(`Página ${i - range.start + 1} de ${range.count}`, MARGIN + pageWidth / 2, doc.page.height - MARGIN - 4, { width: pageWidth / 2, align: "right", lineBreak: false });
      doc.page.margins.bottom = bottomMargin;
    }
    doc.end();
  });
}
