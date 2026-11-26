/**
 * Gestão de Produtos no banco (npm run test:db): ficha comercial (padrões, gravação sem mudança não registra, à venda só
 * se o ERP vende, dependências), versões de preço (a primeira cria a ficha, agendada fecha a anterior, cancelada devolve
 * a vigência, número nunca reaproveitado, duas ao mesmo tempo para a mesma data: uma vale) e pacotes (nome único sem
 * acento/caixa, unidades do catálogo, à venda com versão, nova versão com diferença registrada, cancelamento).
 *
 * Isolamento: códigos 98.xx que não existem no catálogo (o mapa de unidades é do próprio teste) e pacotes criados aqui,
 * apagados no fim junto com os eventos.
 */
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { docdb } from "@/server/docdb";
import { list } from "@/server/db";
import { COLLECTIONS, type DomainEvent } from "@/domain/types";
import type { QuoteUnit } from "@/domain/products/quote";
import { versionAt } from "@/domain/products/commercial";
import { dateKey } from "@/lib/format";
import {
  addModulePrice,
  addProductPackageVersion,
  cancelModulePrice,
  cancelProductPackageVersion,
  createProductPackage,
  listCommercialModules,
  listProductPackages,
  saveCommercialModule,
  updateProductPackage,
} from "@/server/products/service";

const RUN = Date.now().toString(36);
const A = "98.01";
const B = "98.02";
const C = "98.03";
const OFF = "98.09";
const CODES = [A, B, C, OFF];
const actor = { id: `pd_${RUN}`, name: "Ana Produtos", departmentId: "administrativo" };
const units = new Map<string, QuoteUnit>(
  [
    { code: A, name: "PDV de teste", requires: [B] },
    { code: B, name: "Caixa de teste", requires: [] },
    { code: C, name: "Loja de teste", requires: [] },
    { code: OFF, name: "Não homologado", requires: [], sellable: false },
  ].map((u) => [u.code, { module: "98", moduleName: "Testes", sellable: true, ...u }]),
);
const packageIds: string[] = [];

function day(offset: number): string {
  return dateKey(new Date(Date.now() + offset * 86_400_000));
}
const today = day(0);

async function events(entityId: string, type: string): Promise<DomainEvent[]> {
  return (await list<DomainEvent>(COLLECTIONS.events, { where: [["entityId", "==", entityId]] })).filter((e) => e.type === type);
}

async function moduleOf(code: string) {
  return (await listCommercialModules()).find((m) => m.code === code);
}

const fixo = (monthly: number, validFrom: string, reason = "Tabela") => ({ code: A, model: "fixo" as const, monthly, unitPrice: 0, includedQuantity: 0, unitLabel: null, tiers: [], setup: 0, validFrom, reason });

beforeAll(async () => {
  if (!process.env.DATABASE_URL) throw new Error("Defina DATABASE_URL (veja scripts/db-local.sh)");
  const sql = docdb.sql();
  await sql`delete from interos.product_modules where id = any(${CODES})`;
});

afterAll(async () => {
  const sql = docdb.sql();
  await sql`delete from interos.product_modules where id = any(${CODES})`;
  if (packageIds.length) await sql`delete from interos.product_packages where id = any(${packageIds})`;
  await sql`delete from interos.events where data->>'entityId' = any(${[...CODES, ...packageIds]})`;
});

describe("ficha comercial", () => {
  it("cria com o que foi informado; gravar igual não registra de novo", async () => {
    const input = { code: C, name: "Loja virtual", summary: "Venda on-line integrada ao estoque.", status: "a_venda" as const, segments: ["varejo" as const], requiresCommercial: [], notes: null };
    const saved = await saveCommercialModule(input, actor, units);
    expect(saved).toMatchObject({ code: C, name: "Loja virtual", status: "a_venda", segments: ["varejo"], prices: [] });
    await saveCommercialModule(input, actor, units);
    expect(await events(C, "product_module.updated")).toHaveLength(1);
  });

  it("à venda só se o ERP vende; dependência fora do catálogo ou dele mesmo é recusada", async () => {
    await expect(saveCommercialModule({ code: OFF, name: "X", summary: null, status: "a_venda", segments: [], requiresCommercial: [], notes: null }, actor, units)).rejects.toThrow(/ainda não vende/);
    await expect(saveCommercialModule({ code: C, name: "Loja", summary: null, status: "rascunho", segments: [], requiresCommercial: ["97.01"], notes: null }, actor, units)).rejects.toThrow(/fora do catálogo: 97\.01/);
    await expect(saveCommercialModule({ code: C, name: "Loja", summary: null, status: "rascunho", segments: [], requiresCommercial: [C], notes: null }, actor, units)).rejects.toThrow(/dele mesmo/);
    await expect(saveCommercialModule({ code: "97.01", name: "Fora", summary: null, status: "rascunho", segments: [], requiresCommercial: [], notes: null }, actor, units)).rejects.toThrow(/não é uma unidade comercial/);
  });
});

describe("versões de preço", () => {
  it("a primeira versão cria a ficha em definição; agendar fecha a anterior na véspera", async () => {
    const v1 = await addModulePrice(fixo(100, today, "Lançamento"), actor, units);
    expect(v1.version).toBe(1);
    expect(await moduleOf(A)).toMatchObject({ name: "PDV de teste", status: "rascunho" });
    const v2 = await addModulePrice(fixo(120, day(10), "Reajuste"), actor, units);
    expect(v2.version).toBe(2);
    const m = await moduleOf(A);
    expect(m?.prices.map((p) => [p.version, p.validFrom, p.validTo])).toEqual([
      [1, today, day(9)],
      [2, day(10), null],
    ]);
    expect(versionAt(m!.prices, day(9))?.monthly).toBe(100);
    expect(versionAt(m!.prices, day(10))?.monthly).toBe(120);
    expect((await events(A, "product_price.created")).map((e) => e.payload?.version).sort()).toEqual([1, 2]);
  });

  it("não volta no tempo nem intercala: data passada ou antes da agendada é recusada", async () => {
    await expect(addModulePrice(fixo(90, day(-1)), actor, units)).rejects.toThrow(/dia que já passou/);
    await expect(addModulePrice(fixo(110, day(5)), actor, units)).rejects.toThrow(/agendada/);
  });

  it("cancelar a agendada devolve a vigência; o número não é reaproveitado", async () => {
    await cancelModulePrice({ code: A, version: 2, reason: "Reajuste adiado" }, actor);
    let m = await moduleOf(A);
    expect(m?.prices.find((p) => p.version === 1)?.validTo).toBeNull();
    expect(m?.prices.find((p) => p.version === 2)?.cancelReason).toBe("Reajuste adiado");
    const v3 = await addModulePrice(fixo(115, day(15)), actor, units);
    expect(v3.version).toBe(3);
    m = await moduleOf(A);
    expect(versionAt(m!.prices, day(20))?.monthly).toBe(115);
    expect(await events(A, "product_price.cancelled")).toHaveLength(1);
  });

  it("duas versões para a mesma data ao mesmo tempo: uma vale, a outra é recusada", async () => {
    const results = await Promise.allSettled([addModulePrice({ ...fixo(130, day(30)), code: B }, actor, units), addModulePrice({ ...fixo(140, day(30)), code: B }, actor, units)]);
    expect(results.filter((r) => r.status === "fulfilled")).toHaveLength(1);
    const m = await moduleOf(B);
    expect(m?.prices).toHaveLength(1);
  });

  it("código fora do catálogo em uso não recebe preço novo", async () => {
    await expect(addModulePrice({ ...fixo(10, today), code: "97.01" }, actor, units)).rejects.toThrow(/não recebe preço novo/);
  });

  it("modelo por faixa com faixas fora de ordem é recusado com a explicação", async () => {
    await expect(
      addModulePrice({ code: C, model: "por_faixa", monthly: 0, unitPrice: 0, includedQuantity: 0, unitLabel: "usuário", tiers: [{ upTo: 5, monthly: 10 }, { upTo: 3, monthly: 20 }, { upTo: null, monthly: 30 }], setup: 0, validFrom: today, reason: "Faixas" }, actor, units),
    ).rejects.toThrow(/Faixa 2/);
  });
});

describe("pacotes", () => {
  it("cria em definição com a primeira versão; nome repetido (sem acento/caixa) e unidade fora do catálogo são recusados", async () => {
    const modules = new Map((await listCommercialModules()).map((m) => [m.code, m]));
    const r = await createProductPackage({ name: `Varejo Básico ${RUN}`, segment: "varejo", description: null, basedOn: "varejo_essencial", units: [B, A], monthly: 150, setup: 300, validFrom: today, reason: "Lançamento" }, actor, units, modules);
    packageIds.push(r.id);
    expect(r.warnings).toEqual([]);
    const pkg = (await listProductPackages()).find((p) => p.id === r.id);
    expect(pkg).toMatchObject({ status: "rascunho", basedOn: "varejo_essencial" });
    expect(pkg?.versions[0]).toMatchObject({ version: 1, units: [A, B], monthly: 150, setup: 300, validTo: null });
    await expect(createProductPackage({ name: `VAREJO basico ${RUN}`, segment: "varejo", description: null, basedOn: null, units: [A, B], monthly: 1, setup: 0, validFrom: today, reason: "Outro" }, actor, units, modules)).rejects.toThrow(/Já existe o pacote/);
    await expect(createProductPackage({ name: `Outro ${RUN}`, segment: "varejo", description: null, basedOn: null, units: ["97.01"], monthly: 1, setup: 0, validFrom: today, reason: "Outro" }, actor, units, modules)).rejects.toThrow(/97\.01 não é uma unidade comercial/);
  });

  it("dependência fora do pacote e unidade não homologada viram aviso, não bloqueio", async () => {
    const modules = new Map((await listCommercialModules()).map((m) => [m.code, m]));
    const r = await createProductPackage({ name: `Só PDV ${RUN}`, segment: "varejo", description: null, basedOn: null, units: [A, OFF], monthly: 90, setup: 0, validFrom: today, reason: "Teste" }, actor, units, modules);
    packageIds.push(r.id);
    expect(r.warnings.join(" | ")).toMatch(/exige 98\.02/);
    expect(r.warnings.join(" | ")).toMatch(/98\.09 Não homologado: o ERP ainda não vende/);
  });

  it("à venda, nova versão com a diferença registrada e cancelamento da agendada", async () => {
    const id = packageIds[0];
    await updateProductPackage({ id, name: `Varejo Básico ${RUN}`, segment: "varejo", description: "Para começar", status: "a_venda" }, actor, units);
    const modules = new Map((await listCommercialModules()).map((m) => [m.code, m]));
    const v2 = await addProductPackageVersion({ id, units: [A, B, C], monthly: 180, setup: 300, validFrom: day(7), reason: "Inclui a loja" }, actor, units, modules);
    expect(v2.version).toBe(2);
    const [created] = await events(id, "product_package.version_created");
    expect(created.payload?.changes).toMatchObject({ Módulos: { from: "2 módulos", to: `3 módulos (+${C})` } });
    await cancelProductPackageVersion({ id, version: 2, reason: "Loja fica avulsa" }, actor);
    const pkg = (await listProductPackages()).find((p) => p.id === id);
    expect(pkg?.status).toBe("a_venda");
    expect(versionAt(pkg!.versions, day(8))?.version).toBe(1);
    expect(await events(id, "product_package.updated")).toHaveLength(1);
    expect(await events(id, "product_package.version_cancelled")).toHaveLength(1);
    // À venda: a única versão ativa (a de hoje) não pode ser cancelada.
    await expect(cancelProductPackageVersion({ id, version: 1, reason: "Teste" }, actor)).rejects.toThrow(/única versão/);
  });
});
