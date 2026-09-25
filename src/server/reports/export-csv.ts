import "server-only";
/**
 * Exportação CSV para o Excel em português: BOM UTF-8, separador ";" e números com vírgula decimal.
 * Moeda sai como número (sem "R$") para o Excel somar; percentuais saem como "12,5%".
 */
import type { ReportData } from "./build";
import { formatReportDate, type ColumnType, type ReportValue } from "./definitions";

const SEPARATOR = ";";

function escape(text: string): string {
  return /[";\n\r]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
}

function decimal(value: number, digits: number): string {
  return value.toFixed(digits).replace(".", ",");
}

function cell(value: ReportValue | undefined, type: ColumnType): string {
  if (value === null || value === undefined || value === "") return "";
  if (typeof value === "string") return escape(type === "data" ? formatReportDate(value) : value);
  if (Number.isNaN(value)) return "";
  switch (type) {
    case "moeda":
      return decimal(value, 2);
    case "percentual":
      return `${decimal(value * 100, 1)}%`;
    case "numero":
      return Number.isInteger(value) ? String(value) : decimal(value, 2);
    default:
      return decimal(value, 1);
  }
}

export function reportToCsv(data: ReportData): Buffer {
  const { columns } = data.definition;
  const lines = [columns.map((c) => escape(c.label)).join(SEPARATOR)];
  for (const row of data.rows) lines.push(columns.map((c) => cell(row.cells[c.key], c.type)).join(SEPARATOR));
  if (data.totals) lines.push(columns.map((c) => cell(data.totals![c.key], c.type)).join(SEPARATOR));
  return Buffer.from("﻿" + lines.join("\r\n") + "\r\n", "utf8");
}
