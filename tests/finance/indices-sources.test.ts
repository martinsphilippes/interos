/**
 * Fontes dos índices (src/server/integrations/indices.ts): resposta do SGS do Banco Central, links da Carta de
 * Conjuntura do IPEA e a planilha do ICTI (formato conferido na planilha real de 15/10/2026: aba "Dados", mês em data
 * serial do Excel e o número-índice dez/2012 = 100). Rede simulada.
 */
import { afterEach, describe, expect, it, vi } from "vitest";
import { writeZip } from "@/server/finance/docx";
import { fetchSgsMonthly, ictiPostLinks, ictiSpreadsheetLink, IndexSourceError, parseIctiSpreadsheet, parseSgsResponse } from "@/server/integrations/indices";
import { indexNeedsFetch } from "@/server/finance-registry/indices";

afterEach(() => vi.unstubAllGlobals());

function xlsx(parts: Record<string, string>): Buffer {
  const names = Object.keys(parts);
  return writeZip(
    names.map((name) => ({ name, method: 0, crc: 0, compressedSize: 0, size: 0, raw: Buffer.alloc(0) })),
    new Map(names.map((n) => [n, Buffer.from(parts[n], "utf8")])),
  );
}

/** Serial do Excel do 1º dia do mês. */
const serial = (y: number, m: number) => Math.round((Date.UTC(y, m - 1, 1) - Date.UTC(1899, 11, 30)) / 86_400_000);

/** Planilha no formato do IPEA: cabeçalho em texto compartilhado, linhas com data serial, nível, variação e 12 meses. */
function ictiFile(levels: [number, number, number][], options: { sheetName?: string } = {}): Buffer {
  const shared = ["Mês", "ICTI (dez/2012=100)", "Var. no mês (%)", "Var. em 12 meses (%)", "-"];
  const header = `<row r="1"><c r="A1" t="s"><v>0</v></c><c r="B1" t="s"><v>1</v></c><c r="C1" t="s"><v>2</v></c><c r="D1" t="s"><v>3</v></c></row>`;
  const rows = levels.map(([y, m, level], i) => `<row r="${i + 2}"><c r="A${i + 2}" s="1"><v>${serial(y, m)}</v></c><c r="B${i + 2}"><v>${level}</v></c><c r="C${i + 2}"><v>0</v></c><c r="D${i + 2}" t="s"><v>4</v></c></row>`).join("");
  return xlsx({
    "[Content_Types].xml": "<Types/>",
    "xl/workbook.xml": `<workbook xmlns:r="r"><sheets><sheet name="${options.sheetName ?? "Dados"}" sheetId="16" r:id="rId1"/></sheets></workbook>`,
    "xl/_rels/workbook.xml.rels": `<Relationships><Relationship Id="rId3" Type="x" Target="externalLinks/externalLink2.xml"/><Relationship Id="rId1" Type="y" Target="worksheets/sheet1.xml"/></Relationships>`,
    "xl/sharedStrings.xml": `<sst>${shared.map((s) => `<si><t>${s}</t></si>`).join("")}</sst>`,
    "xl/worksheets/sheet1.xml": `<worksheet><sheetData>${header}${rows}</sheetData></worksheet>`,
  });
}

describe("Banco Central (SGS)", () => {
  it("lê [{ data, valor }] em % por competência (ignora linha sem valor)", () => {
    expect(parseSgsResponse([{ data: "01/08/2026", valor: "-0.32" }, { data: "01/09/2026", valor: "0.82" }, { data: "01/10/2026", valor: "" }])).toEqual({ "2026-08": -0.32, "2026-09": 0.82 });
  });

  it("resposta que não é lista vira erro legível", () => {
    expect(() => parseSgsResponse({ error: "Série não encontrada" })).toThrow(IndexSourceError);
    expect(() => parseSgsResponse({ error: "Série não encontrada" })).toThrow(/Série não encontrada/);
  });

  it("pede o período certo e trata 404 «sem valores» como nada novo", async () => {
    const urls: string[] = [];
    vi.stubGlobal(
      "fetch",
      vi.fn(async (url: string) => {
        urls.push(url);
        if (url.includes("dataInicial=01/10/2026")) return new Response(JSON.stringify({ error: "Valor(es) não encontrado(s)" }), { status: 404 });
        return new Response(JSON.stringify([{ data: "01/09/2026", valor: "0.82" }]), { status: 200 });
      }),
    );
    expect(await fetchSgsMonthly(433, "2024-10", "2026-10")).toEqual({ "2026-09": 0.82 });
    expect(urls[0]).toBe("https://api.bcb.gov.br/dados/serie/bcdata.sgs.433/dados?formato=json&dataInicial=01/10/2024&dataFinal=31/10/2026");
    expect(await fetchSgsMonthly(433, "2026-10", "2026-10")).toEqual({});
  });

  it("falha de rede repete uma vez e vira IndexSourceError", async () => {
    const fetchMock = vi.fn(async () => {
      throw new TypeError("fetch failed");
    });
    vi.stubGlobal("fetch", fetchMock);
    await expect(fetchSgsMonthly(433, "2026-01", "2026-10")).rejects.toThrow(IndexSourceError);
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });
});

describe("ICTI (IPEA)", () => {
  it("acha os posts do ICTI na busca, do mais novo para o mais antigo, e só no site do IPEA", () => {
    const html = `
      <a href="https://www.ipea.gov.br/cartadeconjuntura/index.php/2026/08/indice-de-custo-da-tecnologia-da-informacao-icti-junho-de-2026/">jun</a>
      <a href="https://www.ipea.gov.br/cartadeconjuntura/index.php/2026/10/indice-de-custo-da-tecnologia-da-informacao-icti-agosto-de-2026/">ago</a>
      <a href="https://evil.example.com/cartadeconjuntura/index.php/2026/11/indice-de-custo-da-tecnologia-da-informacao-icti-x/">x</a>`;
    expect(ictiPostLinks(html)).toEqual([
      "https://www.ipea.gov.br/cartadeconjuntura/index.php/2026/10/indice-de-custo-da-tecnologia-da-informacao-icti-agosto-de-2026/",
      "https://www.ipea.gov.br/cartadeconjuntura/index.php/2026/08/indice-de-custo-da-tecnologia-da-informacao-icti-junho-de-2026/",
    ]);
  });

  it("prefere a planilha .xlsx com ICTI no nome", () => {
    const html = `<a href="https://www.ipea.gov.br/cartadeconjuntura/wp-content/uploads/2026/10/outro.xlsx">a</a> <a href="https://www.ipea.gov.br/cartadeconjuntura/wp-content/uploads/2026/10/261015_ICTI_serie_completa_agosto_26.xlsx">b</a>`;
    expect(ictiSpreadsheetLink(html)).toBe("https://www.ipea.gov.br/cartadeconjuntura/wp-content/uploads/2026/10/261015_ICTI_serie_completa_agosto_26.xlsx");
    expect(ictiSpreadsheetLink("<p>sem anexo</p>")).toBeNull();
  });

  it("calcula a variação de cada mês pelo número-índice (o 1º mês fica sem)", () => {
    const levels: [number, number, number][] = Array.from({ length: 14 }, (_, i) => [2025 + Math.floor(i / 12), (i % 12) + 1, 100 * 1.005 ** (i + 1)]);
    const out = parseIctiSpreadsheet(ictiFile(levels));
    expect(Object.keys(out).sort()).toEqual(levels.slice(1).map(([y, m]) => `${y}-${String(m).padStart(2, "0")}`));
    for (const v of Object.values(out)) expect(v).toBeCloseTo(0.5, 6);
  });

  it("confere com a coluna «Var. no mês» da planilha real (níveis de jul/2025 a jul/2026)", () => {
    // Trecho real (jul/2025 em diante) — a coluna C da planilha traz 0,2205885 para ago/2025 e 0,3554142 para set/2025.
    const real: [number, number, number][] = [
      [2025, 7, 201.01435375204551],
      [2025, 8, 201.45776829253185],
      [2025, 9, 202.173777823699],
      [2025, 10, 201.74736481147937],
      [2025, 11, 202.90162247010301],
      [2025, 12, 203.34481591716727],
      [2026, 1, 203.64768737875704],
      [2026, 2, 204.18197366095711],
      [2026, 3, 205.11977],
      [2026, 4, 207.07134],
      [2026, 5, 207.59071],
      [2026, 6, 208.89399],
      [2026, 7, 208.86668],
    ];
    const out = parseIctiSpreadsheet(ictiFile(real));
    expect(out["2025-08"]).toBeCloseTo(0.220588, 5);
    expect(out["2025-09"]).toBeCloseTo(0.355414, 5);
  });

  it("planilha fora do formato vira erro legível", () => {
    expect(() => parseIctiSpreadsheet(Buffer.from("não é zip"))).toThrow(/não é um \.xlsx válido/);
    const noLevel = xlsx({
      "xl/workbook.xml": `<workbook><sheets><sheet name="Dados" sheetId="1" r:id="rId1"/></sheets></workbook>`,
      "xl/_rels/workbook.xml.rels": `<Relationships><Relationship Id="rId1" Target="worksheets/sheet1.xml"/></Relationships>`,
      "xl/worksheets/sheet1.xml": `<worksheet><sheetData><row r="1"><c r="A1" t="inlineStr"><is><t>Mês</t></is></c><c r="B1" t="inlineStr"><is><t>Outra</t></is></c></row></sheetData></worksheet>`,
    });
    expect(() => parseIctiSpreadsheet(noLevel)).toThrow(/número-índice/);
    expect(() => parseIctiSpreadsheet(ictiFile([[2026, 1, 100], [2026, 2, 101]]))).toThrow(/menos de 12 meses/);
  });
});

describe("quando buscar", () => {
  const now = new Date("2026-10-23T12:00:00.000Z");
  const recent = "2026-10-22T09:00:00.000Z";
  const values = (latest: string) => ({ [latest]: { pct: 0.5, source: "bcb_sgs" as const, at: recent } });

  it("Banco Central: busca até ter o mês anterior; depois só a cada 7 dias", () => {
    expect(indexNeedsFetch({ source: { kind: "bcb_sgs", seriesCode: 433 }, values: values("2026-08"), lastFetchAt: recent, lastFetchOk: true }, now)).toBe(true);
    expect(indexNeedsFetch({ source: { kind: "bcb_sgs", seriesCode: 433 }, values: values("2026-09"), lastFetchAt: recent, lastFetchOk: true }, now)).toBe(false);
    expect(indexNeedsFetch({ source: { kind: "bcb_sgs", seriesCode: 433 }, values: values("2026-09"), lastFetchAt: "2026-10-10T09:00:00.000Z", lastFetchOk: true }, now)).toBe(true);
  });

  it("ICTI sai com 2 meses de defasagem; manual nunca busca; falha anterior busca de novo", () => {
    expect(indexNeedsFetch({ source: { kind: "ipea_icti" }, values: values("2026-08"), lastFetchAt: recent, lastFetchOk: true }, now)).toBe(false);
    expect(indexNeedsFetch({ source: { kind: "ipea_icti" }, values: values("2026-07"), lastFetchAt: recent, lastFetchOk: true }, now)).toBe(true);
    expect(indexNeedsFetch({ source: { kind: "manual" }, values: {}, lastFetchAt: undefined }, now)).toBe(false);
    expect(indexNeedsFetch({ source: { kind: "bcb_sgs", seriesCode: 433 }, values: values("2026-09"), lastFetchAt: recent, lastFetchOk: false }, now)).toBe(true);
  });

  it("mês lançado à mão não conta como «em dia» (a fonte oficial ainda precisa trazer)", () => {
    const manual = { "2026-09": { pct: 0.8, source: "manual" as const, at: recent }, "2026-08": { pct: 0.5, source: "bcb_sgs" as const, at: recent } };
    expect(indexNeedsFetch({ source: { kind: "bcb_sgs", seriesCode: 433 }, values: manual, lastFetchAt: recent, lastFetchOk: true }, now)).toBe(true);
  });
});
