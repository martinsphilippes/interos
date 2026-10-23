import "server-only";
/**
 * Fontes oficiais dos índices de reajuste (só leitura, sem chave):
 * - Banco Central, SGS: https://api.bcb.gov.br/dados/serie/bcdata.sgs.{série}/dados?formato=json&dataInicial=…&dataFinal=…
 *   devolve [{ data: "01/09/2026", valor: "0.82" }] (variação mensal em %). IPCA 433, IGP-M 189, INPC 188, IGP-DI 190.
 * - ICTI (IPEA): não está no SGS. Sai todo mês na Carta de Conjuntura, com uma planilha .xlsx da série completa
 *   (aba "Dados": mês e o número-índice dez/2012 = 100). A variação do mês é calculada pelo número-índice.
 *
 * Erros viram `IndexSourceError` com a mensagem pronta para a tela. Só GET (sempre pode repetir).
 */
import { readZip, zipPartText } from "@/server/finance/docx";
import { addCompetence, isCompetence } from "@/domain/readjustment";

export class IndexSourceError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "IndexSourceError";
  }
}

const USER_AGENT = "Mozilla/5.0 (compatible; INTEROS/1.0; reajuste de contratos)";
const MAX_DOWNLOAD_BYTES = 5 * 1024 * 1024;

interface GetOptions {
  timeoutMs?: number;
  retries?: number;
  accept?: string;
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/** GET com tempo-limite e nova tentativa em falha de rede, 429 e 5xx. */
async function get(url: string, options: GetOptions = {}): Promise<Response> {
  const retries = options.retries ?? 1;
  let lastError: unknown = null;
  for (let attempt = 0; attempt <= retries; attempt++) {
    try {
      const res = await fetch(url, { headers: { "user-agent": USER_AGENT, accept: options.accept ?? "*/*" }, signal: AbortSignal.timeout(options.timeoutMs ?? 8000), cache: "no-store" });
      if ((res.status === 429 || res.status >= 500) && attempt < retries) {
        lastError = new IndexSourceError(`HTTP ${res.status}`);
        await sleep(400 * 2 ** attempt);
        continue;
      }
      return res;
    } catch (error) {
      lastError = error;
      if (attempt < retries) await sleep(400 * 2 ** attempt);
    }
  }
  const message = lastError instanceof Error ? lastError.message : String(lastError);
  throw new IndexSourceError(/timeout|abort/i.test(message) ? "a fonte não respondeu a tempo" : `falha de conexão (${message})`);
}

async function readLimited(res: Response): Promise<Buffer> {
  const length = Number(res.headers.get("content-length") ?? 0);
  if (length > MAX_DOWNLOAD_BYTES) throw new IndexSourceError("arquivo grande demais");
  const buf = Buffer.from(await res.arrayBuffer());
  if (buf.length > MAX_DOWNLOAD_BYTES) throw new IndexSourceError("arquivo grande demais");
  return buf;
}

// ---------------------------------------------------------------------------
// Banco Central (SGS)
// ---------------------------------------------------------------------------

const lastDayOf = (competence: string) => new Date(Date.UTC(Number(competence.slice(0, 4)), Number(competence.slice(5, 7)), 0)).getUTCDate();

/**
 * Converte a resposta do SGS em { "AAAA-MM": % }. Só aceita série MENSAL de variação (data no dia 01, um valor por mês,
 * entre −50% e 50%): série diária, acumulada ou de número-índice cadastrada por engano vira erro, nunca reajuste.
 * Exportada para os testes.
 */
export function parseSgsResponse(body: unknown): Record<string, number> {
  if (!Array.isArray(body)) {
    const error = body && typeof body === "object" ? (body as { error?: unknown; message?: unknown }) : null;
    const detail = typeof error?.error === "string" ? error.error : typeof error?.message === "string" ? error.message : null;
    throw new IndexSourceError(detail ? `o Banco Central respondeu: ${detail}` : "resposta inesperada do Banco Central");
  }
  const out: Record<string, number> = {};
  for (const row of body) {
    const data = typeof row?.data === "string" ? row.data : "";
    const m = /^(\d{2})\/(\d{2})\/(\d{4})$/.exec(data);
    const value = Number(String(row?.valor ?? "").trim().replace(",", "."));
    if (!m || String(row?.valor ?? "").trim() === "" || !Number.isFinite(value)) continue;
    const competence = `${m[3]}-${m[2]}`;
    if (!isCompetence(competence)) continue;
    if (m[1] !== "01" || competence in out) throw new IndexSourceError("a série não é mensal (use a série de variação mensal do índice no SGS)");
    if (Math.abs(value) > 50) throw new IndexSourceError(`valor fora do esperado para variação mensal (${value}): confira se a série é a de variação mensal em %`);
    out[competence] = value;
  }
  return out;
}

/** Variação mensal (%) da série SGS entre as competências `from` e `to` (inclusive). */
export async function fetchSgsMonthly(seriesCode: number, from: string, to: string): Promise<Record<string, number>> {
  if (!Number.isInteger(seriesCode) || seriesCode <= 0) throw new IndexSourceError("código de série inválido");
  const ini = `01/${from.slice(5, 7)}/${from.slice(0, 4)}`;
  const fim = `${String(lastDayOf(to)).padStart(2, "0")}/${to.slice(5, 7)}/${to.slice(0, 4)}`;
  const url = `https://api.bcb.gov.br/dados/serie/bcdata.sgs.${seriesCode}/dados?formato=json&dataInicial=${ini}&dataFinal=${fim}`;
  const res = await get(url, { accept: "application/json" });
  const text = (await readLimited(res)).toString("utf8");
  let body: unknown;
  try {
    body = JSON.parse(text);
  } catch {
    throw new IndexSourceError(res.ok ? "resposta inesperada do Banco Central" : `o Banco Central respondeu HTTP ${res.status}${res.status === 404 ? " (série não encontrada?)" : ""}`);
  }
  // Período sem nenhum valor: o SGS responde 404 com mensagem; é "nada novo", não erro.
  if (!res.ok && !Array.isArray(body)) {
    const msg = JSON.stringify(body).toLowerCase();
    if (res.status === 404 && /não encontrad|nao encontrad|not found/.test(msg)) return {};
    return parseSgsResponse(body);
  }
  return parseSgsResponse(body);
}

// ---------------------------------------------------------------------------
// ICTI (IPEA, planilha .xlsx da Carta de Conjuntura)
// ---------------------------------------------------------------------------

const IPEA_HOST = "www.ipea.gov.br";
const ICTI_SEARCH_URL = "https://www.ipea.gov.br/cartadeconjuntura/index.php/?s=ICTI";

/** Só aceita endereços https do site do IPEA (os links vêm de páginas de fora). */
function ipeaUrl(raw: string): string | null {
  try {
    const url = new URL(raw.startsWith("//") ? `https:${raw}` : raw.replace(/^http:/i, "https:"));
    if (url.hostname !== IPEA_HOST || url.protocol !== "https:") return null;
    return url.toString();
  } catch {
    return null;
  }
}

const decodeHtml = (s: string) => s.replace(/&amp;/g, "&").replace(/&#0?38;/g, "&");

/** Posts do ICTI na busca da Carta de Conjuntura, do mais novo para o mais antigo. Exportada para os testes. */
export function ictiPostLinks(html: string): string[] {
  const re = /(?:https?:)?\/\/www\.ipea\.gov\.br\/cartadeconjuntura\/index\.php\/(\d{4})\/(\d{2})\/indice-de-custo-da-tecnologia-da-informacao[^"'\s<>#?]*/gi;
  const found = new Map<string, string>();
  for (const m of html.matchAll(re)) {
    const url = ipeaUrl(decodeHtml(m[0]));
    if (url && !found.has(url)) found.set(url, `${m[1]}-${m[2]}`);
  }
  return [...found.entries()].sort((a, b) => b[1].localeCompare(a[1])).map(([url]) => url);
}

/** Planilha .xlsx do ICTI anexada ao post. Exportada para os testes. */
export function ictiSpreadsheetLink(html: string): string | null {
  const re = /(?:https?:)?\/\/www\.ipea\.gov\.br\/cartadeconjuntura\/wp-content\/uploads\/[^"'\s<>]+?\.xlsx/gi;
  const links = [...html.matchAll(re)].map((m) => ipeaUrl(decodeHtml(m[0]))).filter((u): u is string => Boolean(u));
  return links.find((u) => /icti/i.test(u)) ?? links[0] ?? null;
}

const xmlText = (s: string) =>
  s
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&#(\d+);/g, (_, n) => String.fromCharCode(Number(n)))
    .replace(/&amp;/g, "&");

const normalize = (s: string) =>
  s
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/\s+/g, " ")
    .trim();

/** Letras da coluna ("B12" → 1). */
function columnIndex(ref: string): number {
  const letters = /^[A-Z]+/.exec(ref)?.[0] ?? "";
  let n = 0;
  for (const ch of letters) n = n * 26 + (ch.charCodeAt(0) - 64);
  return n - 1;
}

/** Data serial do Excel (dias desde 30/12/1899) → AAAA-MM. */
function serialToCompetence(serial: number): string | null {
  if (!Number.isFinite(serial) || serial < 1000 || serial > 80000) return null;
  const d = new Date(Date.UTC(1899, 11, 30) + Math.round(serial) * 86_400_000);
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, "0")}`;
}

const MONTHS_PT = ["jan", "fev", "mar", "abr", "mai", "jun", "jul", "ago", "set", "out", "nov", "dez"];

/** Mês da linha: data serial, "jan/2013", "01/2013" ou "2013-01". */
function cellCompetence(value: string): string | null {
  const v = value.trim();
  if (/^\d+(\.\d+)?$/.test(v)) return serialToCompetence(Number(v));
  const iso = /^(\d{4})-(\d{2})/.exec(v);
  if (iso) return isCompetence(`${iso[1]}-${iso[2]}`) ? `${iso[1]}-${iso[2]}` : null;
  const named = /^([a-zç]{3})[a-zç]*[/\s-]+(\d{2,4})$/i.exec(normalize(v));
  if (named) {
    const idx = MONTHS_PT.indexOf(named[1].slice(0, 3));
    const year = named[2].length === 2 ? `20${named[2]}` : named[2];
    return idx >= 0 ? `${year}-${String(idx + 1).padStart(2, "0")}` : null;
  }
  const num = /^(\d{1,2})\/(\d{4})$/.exec(v);
  if (num) return isCompetence(`${num[2]}-${num[1].padStart(2, "0")}`) ? `${num[2]}-${num[1].padStart(2, "0")}` : null;
  return null;
}

/**
 * Lê a planilha do ICTI: aba "Dados" (ou a primeira), coluna do mês e coluna do número-índice. A variação de cada mês
 * = índice do mês ÷ índice do mês anterior − 1 (o 1º mês da série fica sem variação). Exportada para os testes.
 */
export function parseIctiSpreadsheet(buf: Buffer): Record<string, number> {
  let entries: ReturnType<typeof readZip>;
  try {
    entries = readZip(buf);
  } catch {
    throw new IndexSourceError("a planilha do ICTI não é um .xlsx válido");
  }
  const workbook = zipPartText(entries, "xl/workbook.xml");
  const rels = zipPartText(entries, "xl/_rels/workbook.xml.rels") ?? "";
  if (!workbook) throw new IndexSourceError("a planilha do ICTI não é um .xlsx válido");
  const sheets = [...workbook.matchAll(/<sheet\b[^>]*\bname="([^"]*)"[^>]*\br:id="([^"]*)"/g)].map((m) => ({ name: xmlText(m[1]), rid: m[2] }));
  const sheet = sheets.find((s) => normalize(s.name) === "dados") ?? sheets[0];
  if (!sheet) throw new IndexSourceError("a planilha do ICTI não tem abas");
  const target = new RegExp(`<Relationship\\b[^>]*\\bId="${sheet.rid}"[^>]*\\bTarget="([^"]+)"`).exec(rels)?.[1] ?? new RegExp(`<Relationship\\b[^>]*\\bTarget="([^"]+)"[^>]*\\bId="${sheet.rid}"`).exec(rels)?.[1];
  const sheetPath = target ? (target.startsWith("/") ? target.slice(1) : `xl/${target.replace(/^\.\//, "")}`) : "xl/worksheets/sheet1.xml";
  const sheetXml = zipPartText(entries, sheetPath);
  if (!sheetXml) throw new IndexSourceError("a planilha do ICTI não tem a aba de dados");
  const sharedXml = zipPartText(entries, "xl/sharedStrings.xml") ?? "";
  const shared = [...sharedXml.matchAll(/<si>([\s\S]*?)<\/si>/g)].map((m) => xmlText([...m[1].matchAll(/<t\b[^>]*>([\s\S]*?)<\/t>/g)].map((t) => t[1]).join("")));

  const rows: string[][] = [];
  for (const row of sheetXml.matchAll(/<row\b[^>]*>([\s\S]*?)<\/row>/g)) {
    const cells: string[] = [];
    for (const c of row[1].matchAll(/<c\b([^>]*?)(?:\/>|>([\s\S]*?)<\/c>)/g)) {
      const attrs = c[1];
      const ref = /\br="([A-Z]+\d+)"/.exec(attrs)?.[1];
      const type = /\bt="([^"]+)"/.exec(attrs)?.[1];
      const inner = c[2] ?? "";
      let value = /<v>([\s\S]*?)<\/v>/.exec(inner)?.[1] ?? "";
      if (type === "s") value = shared[Number(value)] ?? "";
      else if (type === "inlineStr") value = [...inner.matchAll(/<t\b[^>]*>([\s\S]*?)<\/t>/g)].map((t) => t[1]).join("");
      value = xmlText(value);
      const col = ref ? columnIndex(ref) : cells.length;
      cells[col] = value;
    }
    rows.push(cells);
  }
  const headerAt = rows.findIndex((r) => r.some((v) => normalize(v ?? "") === "mes"));
  if (headerAt < 0) throw new IndexSourceError("a planilha do ICTI mudou de formato (sem a coluna «Mês»)");
  // Array.from preenche os buracos (célula ausente no XML): findIndex com undefined quebraria.
  const header = Array.from(rows[headerAt], (v) => normalize(v ?? ""));
  const monthCol = header.findIndex((h) => h === "mes");
  const levelCol = header.findIndex((h) => h.startsWith("icti"));
  if (levelCol < 0) throw new IndexSourceError("a planilha do ICTI mudou de formato (sem a coluna do número-índice)");
  const levels: [string, number][] = [];
  for (const r of rows.slice(headerAt + 1)) {
    const competence = cellCompetence(r[monthCol] ?? "");
    const level = Number(String(r[levelCol] ?? "").replace(",", "."));
    if (competence && Number.isFinite(level) && level > 0) levels.push([competence, level]);
  }
  levels.sort((a, b) => a[0].localeCompare(b[0]));
  const out: Record<string, number> = {};
  for (let i = 1; i < levels.length; i++) {
    const [competence, level] = levels[i];
    const [prevCompetence, prevLevel] = levels[i - 1];
    if (addCompetence(prevCompetence, 1) !== competence) continue;
    out[competence] = Math.round(((level / prevLevel - 1) * 100 + Number.EPSILON) * 1e6) / 1e6;
  }
  if (Object.keys(out).length < 12) throw new IndexSourceError("a planilha do ICTI veio com menos de 12 meses");
  if (Object.values(out).some((v) => Math.abs(v) > 50)) throw new IndexSourceError("a planilha do ICTI tem variações fora do esperado");
  return out;
}

/** Série do ICTI: acha o post mais recente na Carta de Conjuntura, baixa a planilha e calcula as variações. */
export async function fetchIctiMonthly(): Promise<{ values: Record<string, number>; sourceUrl: string }> {
  const search = await get(ICTI_SEARCH_URL, { accept: "text/html" });
  if (!search.ok) throw new IndexSourceError(`a busca do IPEA respondeu HTTP ${search.status}`);
  const posts = ictiPostLinks((await readLimited(search)).toString("utf8"));
  if (posts.length === 0) throw new IndexSourceError("nenhuma publicação do ICTI encontrada na Carta de Conjuntura");
  let lastError: unknown = null;
  for (const post of posts.slice(0, 2)) {
    try {
      const page = await get(post, { accept: "text/html" });
      if (!page.ok) throw new IndexSourceError(`a página do ICTI respondeu HTTP ${page.status}`);
      const link = ictiSpreadsheetLink((await readLimited(page)).toString("utf8"));
      if (!link) throw new IndexSourceError("a publicação do ICTI não tem a planilha .xlsx");
      const file = await get(link, { timeoutMs: 12000 });
      if (!file.ok) throw new IndexSourceError(`a planilha do ICTI respondeu HTTP ${file.status}`);
      return { values: parseIctiSpreadsheet(await readLimited(file)), sourceUrl: link };
    } catch (error) {
      lastError = error;
    }
  }
  throw lastError instanceof IndexSourceError ? lastError : new IndexSourceError(lastError instanceof Error ? lastError.message : String(lastError));
}
