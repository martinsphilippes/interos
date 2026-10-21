import "server-only";
/**
 * Word (.docx) sem dependência externa: o .docx é um zip com XML. Aqui só o necessário para os modelos de contrato:
 * ler o zip, achar as {{variáveis}} no texto (corpo, cabeçalhos e rodapés) e gerar o Word preenchido.
 *
 * O Word costuma partir o texto de uma variável em vários pedaços (<w:t>) quando há correção ortográfica ou
 * formatação no meio: a troca junta os pedaços de cada variável no primeiro, mantendo o resto da formatação.
 */
import { createHash } from "node:crypto";
import { deflateRawSync, inflateRawSync } from "node:zlib";
import { extractVariables } from "@/domain/contract-templates";

/** Limite do arquivo enviado (a Vercel aceita até ~4,5 MB por requisição). */
export const DOCX_MAX_BYTES = 4 * 1024 * 1024;
/** Limite de cada parte descompactada (evita zip-bomba). */
const MAX_PART_BYTES = 30 * 1024 * 1024;

interface ZipEntry {
  name: string;
  method: number;
  crc: number;
  compressedSize: number;
  size: number;
  /** Bytes compactados como estão no arquivo. */
  raw: Buffer;
}

const SIG_EOCD = 0x06054b50;
const SIG_CENTRAL = 0x02014b50;
const SIG_LOCAL = 0x04034b50;

export function readZip(buf: Buffer): ZipEntry[] {
  let eocd = -1;
  for (let i = buf.length - 22; i >= Math.max(0, buf.length - 22 - 0xffff); i--) {
    if (buf.readUInt32LE(i) === SIG_EOCD) {
      eocd = i;
      break;
    }
  }
  if (eocd < 0) throw new Error("O arquivo não é um Word (.docx) válido");
  const count = buf.readUInt16LE(eocd + 10);
  let p = buf.readUInt32LE(eocd + 16);
  if (count === 0xffff || p === 0xffffffff) throw new Error("Arquivo grande demais (ZIP64 não suportado)");
  const entries: ZipEntry[] = [];
  for (let n = 0; n < count; n++) {
    if (p + 46 > buf.length || buf.readUInt32LE(p) !== SIG_CENTRAL) throw new Error("O arquivo Word está corrompido");
    const method = buf.readUInt16LE(p + 10);
    const crc = buf.readUInt32LE(p + 16);
    const compressedSize = buf.readUInt32LE(p + 20);
    const size = buf.readUInt32LE(p + 24);
    const nameLen = buf.readUInt16LE(p + 28);
    const extraLen = buf.readUInt16LE(p + 30);
    const commentLen = buf.readUInt16LE(p + 32);
    const local = buf.readUInt32LE(p + 42);
    const name = buf.toString("utf8", p + 46, p + 46 + nameLen);
    if (local + 30 > buf.length || buf.readUInt32LE(local) !== SIG_LOCAL) throw new Error("O arquivo Word está corrompido");
    const start = local + 30 + buf.readUInt16LE(local + 26) + buf.readUInt16LE(local + 28);
    if (start + compressedSize > buf.length) throw new Error("O arquivo Word está corrompido");
    entries.push({ name, method, crc, compressedSize, size, raw: buf.subarray(start, start + compressedSize) });
    p += 46 + nameLen + extraLen + commentLen;
  }
  return entries;
}

function inflate(entry: ZipEntry): Buffer {
  if (entry.size > MAX_PART_BYTES) throw new Error("Parte do Word grande demais");
  if (entry.method === 0) return Buffer.from(entry.raw);
  if (entry.method === 8) return inflateRawSync(entry.raw, { maxOutputLength: MAX_PART_BYTES });
  throw new Error("Compactação do Word não suportada");
}

let CRC_TABLE: Uint32Array | null = null;
function crc32(data: Buffer): number {
  if (!CRC_TABLE) {
    CRC_TABLE = new Uint32Array(256);
    for (let n = 0; n < 256; n++) {
      let c = n;
      for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
      CRC_TABLE[n] = c >>> 0;
    }
  }
  let crc = 0xffffffff;
  for (let i = 0; i < data.length; i++) crc = CRC_TABLE[(crc ^ data[i]) & 0xff] ^ (crc >>> 8);
  return (crc ^ 0xffffffff) >>> 0;
}

/** Monta o zip (mesma ordem); `replaced` traz o conteúdo novo (descompactado) de algumas partes. */
export function writeZip(entries: ZipEntry[], replaced: Map<string, Buffer> = new Map()): Buffer {
  const locals: Buffer[] = [];
  const centrals: Buffer[] = [];
  let offset = 0;
  for (const e of entries) {
    const content = replaced.get(e.name);
    const out = content
      ? { method: 8, crc: crc32(content), size: content.length, raw: deflateRawSync(content) }
      : { method: e.method, crc: e.crc, size: e.size, raw: e.raw };
    const name = Buffer.from(e.name, "utf8");
    const local = Buffer.alloc(30);
    local.writeUInt32LE(SIG_LOCAL, 0);
    local.writeUInt16LE(20, 4);
    local.writeUInt16LE(0x0800, 6); // nomes em UTF-8
    local.writeUInt16LE(out.method, 8);
    local.writeUInt32LE(0x00210000, 10); // data/hora fixas (1980-01-01): o mesmo conteúdo gera o mesmo arquivo
    local.writeUInt32LE(out.crc, 14);
    local.writeUInt32LE(out.raw.length, 18);
    local.writeUInt32LE(out.size, 22);
    local.writeUInt16LE(name.length, 26);
    local.writeUInt16LE(0, 28);
    const central = Buffer.alloc(46);
    central.writeUInt32LE(SIG_CENTRAL, 0);
    central.writeUInt16LE(20, 4);
    central.writeUInt16LE(20, 6);
    central.writeUInt16LE(0x0800, 8);
    central.writeUInt16LE(out.method, 10);
    central.writeUInt32LE(0x00210000, 12);
    central.writeUInt32LE(out.crc, 16);
    central.writeUInt32LE(out.raw.length, 20);
    central.writeUInt32LE(out.size, 24);
    central.writeUInt16LE(name.length, 28);
    central.writeUInt32LE(offset, 42);
    locals.push(local, name, out.raw);
    centrals.push(central, name);
    offset += 30 + name.length + out.raw.length;
  }
  const cd = Buffer.concat(centrals);
  const eocd = Buffer.alloc(22);
  eocd.writeUInt32LE(SIG_EOCD, 0);
  eocd.writeUInt16LE(entries.length, 8);
  eocd.writeUInt16LE(entries.length, 10);
  eocd.writeUInt32LE(cd.length, 12);
  eocd.writeUInt32LE(offset, 16);
  return Buffer.concat([...locals, cd, eocd]);
}

/** Partes do Word com texto do documento: corpo, cabeçalhos e rodapés. */
function isTextPart(name: string): boolean {
  return name === "word/document.xml" || /^word\/(header|footer)\d*\.xml$/.test(name);
}

const T_RE = /(<w:t(?:\s[^>]*)?>)([^<]*)(<\/w:t>)|<w:t\s*\/>|(<\/w:p>)/g;

function unescapeXml(s: string): string {
  return s.replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&quot;/g, '"').replace(/&apos;/g, "'").replace(/&#(\d+);/g, (_, d: string) => String.fromCodePoint(Number(d))).replace(/&amp;/g, "&");
}

function escapeXml(s: string): string {
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

/** Texto de uma parte, um parágrafo por linha. */
function partText(xml: string): string {
  let out = "";
  for (const m of xml.matchAll(T_RE)) {
    if (m[4]) out += "\n";
    else if (m[2] !== undefined) out += unescapeXml(m[2]);
  }
  return out;
}

export interface DocxInfo {
  variables: string[];
  sha256: string;
  /** Primeiras linhas do texto (prévia na tela). */
  preview: string;
}

/** Confere que é um Word e extrai as variáveis {{...}}. */
export function inspectDocx(buf: Buffer): DocxInfo {
  if (buf.length > DOCX_MAX_BYTES) throw new Error("Arquivo maior que 4 MB");
  const entries = readZip(buf);
  if (!entries.some((e) => e.name === "word/document.xml")) throw new Error("O arquivo não é um Word (.docx) válido");
  const parts = entries.filter((e) => isTextPart(e.name)).sort((a, b) => (a.name === "word/document.xml" ? -1 : b.name === "word/document.xml" ? 1 : a.name.localeCompare(b.name)));
  const texts = parts.map((e) => partText(inflate(e).toString("utf8")));
  const body = texts[0] ?? "";
  return {
    variables: extractVariables(texts.join("\n")),
    sha256: `sha256:${createHash("sha256").update(buf).digest("hex")}`,
    preview: body.split("\n").map((l) => l.trim()).filter(Boolean).slice(0, 12).join("\n").slice(0, 1200),
  };
}

/**
 * Troca as {{variáveis}} de uma parte XML pelos valores. A variável pode estar partida em vários <w:t> do mesmo
 * parágrafo: o valor entra no primeiro pedaço e os seguintes perdem o trecho da variável.
 */
export function fillXml(xml: string, values: Record<string, string>, fallback: string): string {
  type Node = { start: number; end: number; open: string; text: string; paragraph: number };
  const nodes: Node[] = [];
  let paragraph = 0;
  for (const m of xml.matchAll(T_RE)) {
    if (m[4]) {
      paragraph++;
      continue;
    }
    if (m[2] === undefined) continue;
    nodes.push({ start: m.index, end: m.index + m[0].length, open: m[1], text: unescapeXml(m[2]), paragraph });
  }
  if (nodes.length === 0) return xml;
  const starts: number[] = [];
  let full = "";
  for (const n of nodes) {
    starts.push(full.length);
    full += n.text;
  }
  const texts = nodes.map((n) => n.text);
  const changed = new Set<number>();
  const nodeAt = (pos: number) => {
    let lo = 0;
    let hi = nodes.length - 1;
    while (lo < hi) {
      const mid = (lo + hi + 1) >> 1;
      if (starts[mid] <= pos) lo = mid;
      else hi = mid - 1;
    }
    return lo;
  };
  const matches = [...full.matchAll(/\{\{\s*([^{}]+?)\s*\}\}/g)];
  // Do fim para o começo: as posições dos trechos anteriores continuam válidas.
  for (const m of matches.reverse()) {
    const s = m.index;
    const e = s + m[0].length;
    const i = nodeAt(s);
    const j = nodeAt(e - 1);
    if (nodes[i].paragraph !== nodes[j].paragraph) continue;
    const value = values[m[1].trim()] ?? fallback;
    if (i === j) {
      texts[i] = texts[i].slice(0, s - starts[i]) + value + texts[i].slice(e - starts[i]);
    } else {
      texts[i] = texts[i].slice(0, s - starts[i]) + value;
      for (let k = i + 1; k < j; k++) texts[k] = "";
      texts[j] = texts[j].slice(e - starts[j]);
      for (let k = i + 1; k <= j; k++) changed.add(k);
    }
    changed.add(i);
  }
  if (changed.size === 0) return xml;
  let out = "";
  let last = 0;
  nodes.forEach((n, idx) => {
    if (!changed.has(idx)) return;
    const open = n.open.includes("xml:space") ? n.open : n.open.replace(/^<w:t/, '<w:t xml:space="preserve"');
    // Quebra de linha do valor vira <w:br/> dentro do mesmo trecho.
    const body = texts[idx]
      .split("\n")
      .map(escapeXml)
      .join(`</w:t><w:br/>${open}`);
    out += xml.slice(last, n.start) + open + body + "</w:t>";
    last = n.end;
  });
  return out + xml.slice(last);
}

/** Word preenchido: mesmas partes, com as variáveis do corpo, cabeçalhos e rodapés trocadas. */
export function fillDocx(buf: Buffer, values: Record<string, string>, fallback: string): Buffer {
  const entries = readZip(buf);
  const replaced = new Map<string, Buffer>();
  for (const e of entries) {
    if (!isTextPart(e.name)) continue;
    const xml = inflate(e).toString("utf8");
    const filled = fillXml(xml, values, fallback);
    if (filled !== xml) replaced.set(e.name, Buffer.from(filled, "utf8"));
  }
  return writeZip(entries, replaced);
}

/** Lê o texto do Word (testes e prévia). */
export function docxText(buf: Buffer): string {
  const doc = readZip(buf).find((e) => e.name === "word/document.xml");
  return doc ? partText(inflate(doc).toString("utf8")) : "";
}
