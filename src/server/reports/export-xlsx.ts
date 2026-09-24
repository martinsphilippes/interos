import "server-only";
/**
 * Exportação XLSX (exceljs): cabeçalho em negrito, larguras, formatos de moeda/percentual/data, primeira
 * linha congelada, linha de totais e uma aba "Filtros" com os filtros aplicados e a data de geração.
 */
import ExcelJS from "exceljs";
import type { ReportData } from "./build";
import { formatReportDate, type ColumnType, type ReportValue } from "./definitions";

const NUM_FMT: Partial<Record<ColumnType, string>> = {
  moeda: '"R$" #,##0.00',
  percentual: "0.0%",
  numero: "#,##0.##",
  dias: "#,##0.0",
  horas: "#,##0.0",
  minutos: "#,##0.0",
  nota: "0.0",
  data: "dd/mm/yyyy",
};

const HEADER_FILL: ExcelJS.Fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FF0B1F3A" } };
const TOTAL_FILL: ExcelJS.Fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FFF1F5F9" } };

/** ISO → Date na meia-noite UTC do dia local (o Excel não tem fuso: mostra o dia certo). */
function excelDate(iso: string): Date | string {
  const [d, m, y] = formatReportDate(iso).split("/").map(Number);
  return y && m && d ? new Date(Date.UTC(y, m - 1, d)) : iso;
}

function value(v: ReportValue | undefined, type: ColumnType): ExcelJS.CellValue {
  if (v === null || v === undefined || v === "") return null;
  if (typeof v === "string") return type === "data" ? excelDate(v) : v;
  return Number.isNaN(v) ? null : v;
}

/** Nome de aba válido (máx. 31 caracteres, sem []:*?/\). */
function sheetName(text: string): string {
  return text.replace(/[[\]:*?/\\]/g, " ").slice(0, 31);
}

export async function reportToXlsx(data: ReportData): Promise<Buffer> {
  const workbook = new ExcelJS.Workbook();
  workbook.creator = "INTEROS";
  workbook.created = new Date(data.generatedAt);
  const { columns } = data.definition;

  const sheet = workbook.addWorksheet(sheetName(data.definition.title), { views: [{ state: "frozen", ySplit: 1 }] });
  sheet.columns = columns.map((c) => ({
    header: c.label,
    key: c.key,
    width: Math.max(c.width ?? (c.type === "moeda" ? 14 : c.type === "data" ? 12 : 11), Math.min(c.label.length + 2, 28)),
    style: NUM_FMT[c.type] ? { numFmt: NUM_FMT[c.type] } : {},
  }));
  const header = sheet.getRow(1);
  header.font = { bold: true, color: { argb: "FFFFFFFF" } };
  header.fill = HEADER_FILL;
  header.alignment = { vertical: "middle", wrapText: true };
  header.height = 30;

  for (const row of data.rows) sheet.addRow(Object.fromEntries(columns.map((c) => [c.key, value(row.cells[c.key], c.type)])));
  if (data.totals) {
    const totalRow = sheet.addRow(Object.fromEntries(columns.map((c) => [c.key, value(data.totals![c.key], c.type)])));
    totalRow.font = { bold: true };
    totalRow.fill = TOTAL_FILL;
  }
  if (data.rows.length > 0) sheet.autoFilter = { from: { row: 1, column: 1 }, to: { row: 1, column: columns.length } };

  const info = workbook.addWorksheet("Filtros");
  info.columns = [
    { header: "Campo", key: "campo", width: 22 },
    { header: "Valor", key: "valor", width: 90 },
  ];
  info.getRow(1).font = { bold: true };
  info.addRow({ campo: "Relatório", valor: data.definition.title });
  for (const f of data.filters) info.addRow({ campo: f.label, valor: f.value });
  info.addRow({ campo: "Linhas", valor: data.rows.length });
  info.addRow({ campo: "Gerado em", valor: `${formatReportDate(data.generatedAt)} ${new Date(Date.parse(data.generatedAt) - 3 * 3_600_000).toISOString().slice(11, 16)}` });
  if (data.definition.statusRule) info.addRow({ campo: "Regra do status", valor: data.definition.statusRule });
  for (const note of data.notes) info.addRow({ campo: "Observação", valor: note });
  info.getColumn("valor").alignment = { wrapText: true, vertical: "top" };

  const buffer = await workbook.xlsx.writeBuffer();
  return Buffer.from(buffer as ArrayBuffer);
}
