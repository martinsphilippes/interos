/**
 * Leitura simples de CSV colado ou lido de arquivo (sem dependências). Aceita separador vírgula,
 * ponto e vírgula ou tab (detectado pela linha de cabeçalho) e campos entre aspas.
 */

function detectDelimiter(headerLine: string): string {
  const counts = [";", ",", "\t"].map((d) => ({ d, n: headerLine.split(d).length }));
  counts.sort((a, b) => b.n - a.n);
  return counts[0].n > 1 ? counts[0].d : ",";
}

export function parseCsv(text: string): string[][] {
  const clean = text.replace(/^﻿/, "").replace(/\r\n?/g, "\n");
  const firstLine = clean.split("\n").find((l) => l.trim()) ?? "";
  const delimiter = detectDelimiter(firstLine);
  const rows: string[][] = [];
  let row: string[] = [];
  let field = "";
  let quoted = false;
  for (let i = 0; i < clean.length; i++) {
    const ch = clean[i];
    if (quoted) {
      if (ch === '"' && clean[i + 1] === '"') {
        field += '"';
        i++;
      } else if (ch === '"') quoted = false;
      else field += ch;
      continue;
    }
    if (ch === '"' && field === "") quoted = true;
    else if (ch === delimiter) {
      row.push(field.trim());
      field = "";
    } else if (ch === "\n") {
      row.push(field.trim());
      rows.push(row);
      row = [];
      field = "";
    } else field += ch;
  }
  if (field || row.length) {
    row.push(field.trim());
    rows.push(row);
  }
  return rows.filter((r) => r.some((c) => c !== ""));
}

const normalizeHeader = (h: string) =>
  h
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/[^a-z]/g, "");

export interface CsvRecords<K extends string> {
  rows: Partial<Record<K, string>>[];
  /** Colunas do cabeçalho reconhecidas. */
  recognized: K[];
  /** Cabeçalhos ignorados. */
  ignored: string[];
}

/**
 * Converte o CSV em objetos usando a 1ª linha como cabeçalho. `fields` mapeia a chave de saída para
 * os nomes aceitos no cabeçalho (sem acentos, minúsculas, só letras): { email: ["email", "e-mail"] }.
 */
export function csvToRecords<K extends string>(text: string, fields: Record<K, string[]>): CsvRecords<K> {
  const [header, ...body] = parseCsv(text);
  if (!header) return { rows: [], recognized: [], ignored: [] };
  const columnKey: (K | null)[] = header.map((h) => {
    const n = normalizeHeader(h);
    const entry = (Object.entries(fields) as [K, string[]][]).find(([, aliases]) => aliases.map(normalizeHeader).includes(n));
    return entry ? entry[0] : null;
  });
  const rows = body.map((cells) => {
    const out: Partial<Record<K, string>> = {};
    columnKey.forEach((key, i) => {
      if (key && cells[i]) out[key] = cells[i];
    });
    return out;
  });
  return {
    rows,
    recognized: columnKey.filter((k): k is K => k !== null),
    ignored: header.filter((_, i) => columnKey[i] === null),
  };
}

export const LEAD_CSV_FIELDS = {
  nome: ["nome", "name", "contato"],
  empresa: ["empresa", "company", "razaosocial", "nomefantasia"],
  telefone: ["telefone", "fone", "celular", "whatsapp", "phone"],
  email: ["email", "e-mail", "mail"],
  cidade: ["cidade", "city", "municipio"],
  origem: ["origem", "fonte", "source"],
  interesse: ["interesse", "produto", "interest"],
};

export const PROSPECT_CSV_FIELDS = {
  nome: LEAD_CSV_FIELDS.nome,
  empresa: LEAD_CSV_FIELDS.empresa,
  telefone: LEAD_CSV_FIELDS.telefone,
  email: LEAD_CSV_FIELDS.email,
  cidade: LEAD_CSV_FIELDS.cidade,
};
