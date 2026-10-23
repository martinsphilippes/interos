/**
 * Reajuste anual — regras puras (src/domain/readjustment.ts): competências, acumulado composto de 12 meses, datas-base
 * (aniversário da vigência), o que já foi decidido e o cálculo do reajuste de uma data-base.
 */
import { describe, expect, it } from "vitest";
import {
  accumulatedPct,
  addCompetence,
  addMonthsClamped,
  competenceDiff,
  competenceLabel,
  coveredAnniversaries,
  describeQuote,
  hasReadjustmentRule,
  indexSelectOptions,
  quoteReadjustment,
  readjustmentSchedule,
  summarizeIndex,
} from "@/domain/readjustment";
import { describeReadjustment } from "@/domain/contract-snapshot";
import type { ContractAmendment, ReadjustmentIndex, ReadjustmentIndexMonth } from "@/domain/types";

/** IPCA de out/2025 a set/2026 (série 433 do Banco Central, conferida em 23/10/2026): acumulado 4,58%. */
const IPCA_MONTHS: Record<string, number> = {
  "2025-09": 0.48,
  "2025-10": 0.09,
  "2025-11": 0.18,
  "2025-12": 0.33,
  "2026-01": 0.33,
  "2026-02": 0.7,
  "2026-03": 0.88,
  "2026-04": 0.67,
  "2026-05": 0.58,
  "2026-06": 0.16,
  "2026-07": 0.07,
  "2026-08": -0.32,
  "2026-09": 0.82,
};

const months = (m: Record<string, number>): Record<string, ReadjustmentIndexMonth> => Object.fromEntries(Object.entries(m).map(([k, pct]) => [k, { pct, source: "bcb_sgs" as const, at: "2026-10-23T09:00:00.000Z" }]));

function index(values: Record<string, number>, extra: Partial<ReadjustmentIndex> = {}): Pick<ReadjustmentIndex, "id" | "name" | "values" | "negativePolicy"> {
  return { id: "ipca", name: "IPCA", values: months(values), negativePolicy: "manter", ...extra };
}

describe("competências", () => {
  it("soma meses atravessando o ano e mede a distância", () => {
    expect(addCompetence("2026-01", -1)).toBe("2025-12");
    expect(addCompetence("2025-12", 1)).toBe("2026-01");
    expect(addCompetence("2026-09", -11)).toBe("2025-10");
    expect(addCompetence("2026-03", -27)).toBe("2023-12");
    expect(competenceDiff("2026-11", "2026-08")).toBe(3);
    expect(competenceDiff("2026-01", "2025-12")).toBe(1);
    expect(competenceLabel("2026-09")).toBe("set/2026");
  });

  it("data + meses limita o dia ao fim do mês (31/01 + 1 → 28/02; 29/02 + 12 → 28/02)", () => {
    expect(addMonthsClamped("2026-01-31", 1)).toBe("2026-02-28");
    expect(addMonthsClamped("2028-02-29", 12)).toBe("2029-02-28");
    expect(addMonthsClamped("2025-11-15", 12)).toBe("2026-11-15");
  });
});

describe("acumulado de 12 meses", () => {
  it("é composto (não soma) e confere com o IPCA publicado: 4,58% de out/2025 a set/2026", () => {
    const acc = accumulatedPct(months(IPCA_MONTHS), "2026-09");
    expect(acc).not.toBeNull();
    expect(Math.round(acc! * 100) / 100).toBe(4.58);
    const sum = Object.entries(IPCA_MONTHS)
      .filter(([k]) => k >= "2025-10")
      .reduce((s, [, v]) => s + v, 0);
    expect(Math.abs(acc! - sum)).toBeGreaterThan(0.01);
  });

  it("falta um mês → sem acumulado", () => {
    const { ["2026-03"]: _gap, ...rest } = IPCA_MONTHS;
    void _gap;
    expect(accumulatedPct(months(rest), "2026-09")).toBeNull();
  });

  it("resumo: último mês e acumulado até ele", () => {
    const s = summarizeIndex(months(IPCA_MONTHS));
    expect(s.latest).toEqual({ competence: "2026-09", pct: 0.82 });
    expect(s.accumulated12m).toEqual({ pct: 4.58, from: "2025-10", to: "2026-09" });
    expect(summarizeIndex({})).toEqual({ latest: null, accumulated12m: null });
  });
});

describe("datas-base", () => {
  it("a data-base é o aniversário do início; só a mais recente que chegou fica pendente", () => {
    const s = readjustmentSchedule({ startDate: "2023-03-10", covered: [], today: "2026-10-23" });
    expect(s.due).toEqual({ anniversary: "2026-03-10", overdueDays: 227 });
    expect(s.next).toEqual({ anniversary: "2027-03-10", daysUntil: 138 });
  });

  it("decidida (por mês) sai da lista; tudo antes da última decidida fica para trás", () => {
    expect(readjustmentSchedule({ startDate: "2023-03-10", covered: ["2026-03-01"], today: "2026-10-23" }).due).toBeNull();
    // Renovação aplicada 30 dias antes cobre a data-base futura: a próxima pula um ano.
    const ahead = readjustmentSchedule({ startDate: "2025-11-20", covered: ["2026-11-20"], today: "2026-10-23" });
    expect(ahead.due).toBeNull();
    expect(ahead.next?.anniversary).toBe("2027-11-20");
  });

  it("antes do primeiro aniversário não há data-base vencida", () => {
    const s = readjustmentSchedule({ startDate: "2026-05-02", covered: [], today: "2026-10-23" });
    expect(s.due).toBeNull();
    expect(s.next?.anniversary).toBe("2027-05-02");
  });

  it("decididas: registro do contrato, aditivos não cancelados e renovações antigas com percentual", () => {
    const amendments = [
      { status: "aplicado", kind: "reajuste", readjust: { anniversary: "2025-03-10" }, effectiveFrom: "2025-03-10" },
      { status: "cancelado", kind: "reajuste", readjust: { anniversary: "2024-03-10" }, effectiveFrom: "2024-03-10" },
      { status: "aplicado", kind: "renovacao", readjustment: { type: "percentual", percent: 5 }, effectiveFrom: "2024-03-10" },
      { status: "aplicado", kind: "renovacao", readjustment: { type: "indice", index: "ipca", pending: true }, effectiveFrom: "2023-03-10" },
      { status: "rascunho", kind: "reajuste", readjust: { anniversary: "2026-03-10" }, effectiveFrom: "2026-03-10" },
    ] as unknown as ContractAmendment[];
    const covered = coveredAnniversaries({ readjustmentLog: [{ anniversary: "2022-03-10", outcome: "dispensado", at: "", by: "x" }] }, amendments);
    expect(covered.sort()).toEqual(["2022-03-10", "2024-03-10", "2025-03-10", "2026-03-10"]);
  });

  it("regra que o motor aplica: percentual > 0 ou índice escolhido, cobrança recorrente", () => {
    expect(hasReadjustmentRule({ readjustment: { type: "indice", index: "ipca" }, recurrence: "mensal" })).toBe(true);
    expect(hasReadjustmentRule({ readjustment: { type: "indice" }, recurrence: "mensal" })).toBe(false);
    expect(hasReadjustmentRule({ readjustment: { type: "percentual", percent: 0 }, recurrence: "mensal" })).toBe(false);
    expect(hasReadjustmentRule({ readjustment: { type: "percentual", percent: 5 }, recurrence: "unico" })).toBe(false);
    expect(hasReadjustmentRule({ readjustment: { type: "nenhum" }, recurrence: "mensal" })).toBe(false);
  });
});

describe("cálculo do reajuste de uma data-base", () => {
  it("índice: 12 meses até o mês anterior à data-base", () => {
    const q = quoteReadjustment({ type: "indice", index: "ipca" }, index(IPCA_MONTHS), "2026-10-15");
    expect(q).toEqual({ ok: true, quote: { type: "indice", percent: 4.58, rawPercent: 4.58, indexId: "ipca", indexName: "IPCA", from: "2025-10", to: "2026-09" } });
    expect(describeQuote((q as { ok: true; quote: Parameters<typeof describeQuote>[0] }).quote)).toBe("IPCA acumulado de out/2025 a set/2026: 4,58%");
  });

  it("mês anterior ainda não publicado: usa o último publicado (até 3 meses de atraso)", () => {
    const q = quoteReadjustment({ type: "indice", index: "ipca" }, index(IPCA_MONTHS), "2026-12-01");
    expect(q.ok && q.quote.to).toBe("2026-09");
    const late = quoteReadjustment({ type: "indice", index: "ipca" }, index(IPCA_MONTHS), "2027-01-10");
    expect(late).toMatchObject({ ok: false, waiting: true });
  });

  it("mês da própria data-base ou posterior não entra (aplicação atrasada é estável)", () => {
    const withLater = { ...IPCA_MONTHS, "2026-10": 0.5, "2026-11": 0.4 };
    const q = quoteReadjustment({ type: "indice", index: "ipca" }, index(withLater), "2026-10-15");
    expect(q.ok && q.quote.to).toBe("2026-09");
  });

  it("acumulado negativo: mantém o valor (padrão) ou reduz, conforme o índice", () => {
    const deflation = Object.fromEntries(Array.from({ length: 12 }, (_, i) => [addCompetence("2026-09", -i), -0.3]));
    const keep = quoteReadjustment({ type: "indice", index: "igpm" }, index(deflation, { id: "igpm", name: "IGP-M" }), "2026-10-01");
    expect(keep).toMatchObject({ ok: true, quote: { percent: 0, held: true } });
    expect((keep as { ok: true; quote: { rawPercent: number } }).quote.rawPercent).toBeLessThan(0);
    const reduce = quoteReadjustment({ type: "indice", index: "igpm" }, index(deflation, { id: "igpm", name: "IGP-M", negativePolicy: "reduzir" }), "2026-10-01");
    expect(reduce.ok && reduce.quote.percent).toBeLessThan(0);
  });

  it("percentual fixo, índice fora do cadastro e sem regra", () => {
    expect(quoteReadjustment({ type: "percentual", percent: 5 }, undefined, "2026-10-01")).toEqual({ ok: true, quote: { type: "percentual", percent: 5, rawPercent: 5 } });
    expect(quoteReadjustment({ type: "indice", index: "xyz" }, undefined, "2026-10-01")).toMatchObject({ ok: false });
    expect(quoteReadjustment({ type: "indice", index: "xyz" }, undefined, "2026-10-01")).not.toHaveProperty("waiting");
    expect(quoteReadjustment({ type: "nenhum" }, undefined, "2026-10-01")).toMatchObject({ ok: false });
    expect(quoteReadjustment({ type: "indice", index: "ipca" }, index({}), "2026-10-01")).toMatchObject({ ok: false, waiting: true });
  });
});

describe("telas", () => {
  it("lista de índices: ativos + o desativado que o registro já usa; id desconhecido continua visível", () => {
    const options = [
      { id: "ipca", name: "IPCA", hint: "set/2026 · 12 meses: 4,58%" },
      { id: "igpm", name: "IGP-M", archived: true },
    ];
    expect(indexSelectOptions(options).map((o) => o.value)).toEqual(["ipca"]);
    expect(indexSelectOptions(options, "igpm").map((o) => o.label)).toEqual(["IPCA · set/2026 · 12 meses: 4,58%", "IGP-M (desativado)"]);
    expect(indexSelectOptions(options, "velho").pop()).toEqual({ value: "velho", label: "VELHO (fora do cadastro)" });
  });

  it("texto do reajuste usa o nome do cadastro (padrões sem cadastro à mão)", () => {
    expect(describeReadjustment({ type: "indice", index: "icti" })).toBe("ICTI");
    expect(describeReadjustment({ type: "indice", index: "ipc-fipe" }, { "ipc-fipe": "IPC-Fipe" })).toBe("IPC-Fipe");
    expect(describeReadjustment({ type: "indice", index: "ipca", pending: true })).toBe("IPCA (aguardando o índice)");
    expect(describeReadjustment({ type: "percentual", percent: 2.5 })).toBe("2,5%");
  });
});
