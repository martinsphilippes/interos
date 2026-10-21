/**
 * Regras puras do Histórico de atendimentos: período, busca no texto, tempo da 1ª resposta, resultado do SLA e CSV.
 * Puro: sem servidor.
 */

export const HISTORY_PERIODS = [
  { days: 7, label: "Últimos 7 dias" },
  { days: 30, label: "Últimos 30 dias" },
  { days: 90, label: "Últimos 90 dias" },
  { days: 365, label: "Últimos 12 meses" },
] as const;

export const DEFAULT_HISTORY_DAYS = 30;

/** Período válido (dias) a partir do parâmetro da URL; qualquer outro valor = 30 dias. */
export function historyDays(value: unknown): number {
  const n = Number(value);
  return HISTORY_PERIODS.some((p) => p.days === n) ? n : DEFAULT_HISTORY_DAYS;
}

/** Texto normalizado para busca: minúsculas, sem acento, espaços simples. */
export function normalizeSearch(value: string): string {
  return value
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/\s+/g, " ")
    .trim();
}

/** Algum dos textos contém o termo (sem acento e sem diferenciar maiúsculas)? Dígitos do termo também casam com telefones formatados. */
export function textMatches(term: string, values: readonly (string | undefined | null)[]): boolean {
  const t = normalizeSearch(term);
  if (!t) return true;
  const digits = term.replace(/\D/g, "");
  return values.some((v) => {
    if (!v) return false;
    if (normalizeSearch(v).includes(t)) return true;
    return digits.length >= 4 && v.replace(/\D/g, "").includes(digits);
  });
}

/** Tempo até a primeira resposta humana (ms), ou undefined. */
export function firstResponseMs(c: { openedAt: string; firstResponseAt?: string }): number | undefined {
  if (!c.firstResponseAt) return undefined;
  const ms = new Date(c.firstResponseAt).getTime() - new Date(c.openedAt).getTime();
  return Number.isFinite(ms) && ms >= 0 ? ms : undefined;
}

/** "3 min", "2 h 10", "1 d 4 h". */
export function formatDurationShort(ms: number | undefined): string {
  if (ms === undefined) return "—";
  const min = Math.round(ms / 60_000);
  if (min < 1) return "< 1 min";
  if (min < 60) return `${min} min`;
  const h = Math.floor(min / 60);
  if (h < 24) return min % 60 ? `${h} h ${String(min % 60).padStart(2, "0")}` : `${h} h`;
  const d = Math.floor(h / 24);
  return h % 24 ? `${d} d ${h % 24} h` : `${d} d`;
}

/** Trecho do texto em volta do termo (prévia da busca). */
export function snippetAround(text: string, term: string, radius = 60): string {
  const t = normalizeSearch(term);
  const plain = text.replace(/\s+/g, " ").trim();
  if (!t) return plain.slice(0, radius * 2);
  const i = normalizeSearch(plain).indexOf(t);
  if (i < 0) return plain.slice(0, radius * 2);
  const start = Math.max(0, i - radius);
  const end = Math.min(plain.length, i + t.length + radius);
  return `${start > 0 ? "…" : ""}${plain.slice(start, end)}${end < plain.length ? "…" : ""}`;
}

/** Partes do texto com o termo marcado (para <mark>), sem acento e sem diferenciar maiúsculas. */
export function highlightParts(text: string, term: string): { text: string; match: boolean }[] {
  const t = normalizeSearch(term);
  if (!t) return [{ text, match: false }];
  // normalizeSearch encolhe espaços; aqui comparamos caractere a caractere sem acento, mantendo o tamanho do original.
  const folded = text.normalize("NFD").replace(/[̀-ͯ]/g, "");
  const sameLength = folded.length === text.length;
  const hay = (sameLength ? folded : text).toLowerCase();
  const needle = sameLength ? t : term.toLowerCase().trim();
  const parts: { text: string; match: boolean }[] = [];
  let from = 0;
  for (let i = hay.indexOf(needle); i >= 0 && needle; i = hay.indexOf(needle, i + needle.length)) {
    if (i > from) parts.push({ text: text.slice(from, i), match: false });
    parts.push({ text: text.slice(i, i + needle.length), match: true });
    from = i + needle.length;
  }
  if (from < text.length) parts.push({ text: text.slice(from), match: false });
  return parts.length ? parts : [{ text, match: false }];
}

/** Célula de CSV (separador ;, padrão do Excel em português): aspas quando preciso; neutraliza fórmulas. */
export function csvCell(value: string | number | undefined | null): string {
  if (value === undefined || value === null) return "";
  let v = String(value);
  // Proteção contra injeção de fórmula ao abrir no Excel/Sheets.
  if (/^[=+\-@\t\r]/.test(v)) v = `'${v}`;
  return /[";\n\r]/.test(v) ? `"${v.replace(/"/g, '""')}"` : v;
}

export function toCsv(header: readonly string[], rows: readonly (readonly (string | number | undefined | null)[])[]): string {
  // BOM: o Excel abre o UTF-8 com acentos corretos.
  return "﻿" + [header, ...rows].map((r) => r.map(csvCell).join(";")).join("\r\n");
}
