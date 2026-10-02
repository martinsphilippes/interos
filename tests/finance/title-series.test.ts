/**
 * Etapa CP/CR 5 — edição e cancelamento em série (src/domain/title-series.ts). Checklist do dono: série de 12, editar a
 * 3ª com "este + futuros" muda da 3ª à 12ª e não a 1ª e a 2ª; futuro com baixa não é alterado; vencimento do dia 10 → 5
 * leva cada futuro ao dia 5 do próprio mês (31 → fim do mês); sem série casa por descrição ignorando o sufixo; sufixo de
 * parcela refeito; nº do documento preservado. Mais: fluxo de aprovação (valor só em manual previsto), comissão e série
 * recorrente fora, resíduo fora, acentos/maiúsculas.
 */
import { describe, expect, it } from "vitest";
import {
  applySeriesEdit,
  chunk,
  findFutureTitles,
  findPayableFutures,
  hasSeriesChanges,
  moveToDay,
  normalizeTitleDescription,
  ownInstallmentSuffix,
  PAYABLE_SERIES_FIELDS,
  payableAmountLockedCount,
  payableSeriesSkip,
  payableSeriesUnavailable,
  RECEIVABLE_SERIES_FIELDS,
  SERIES_SKIP_AMOUNT,
  seriesDescriptionFor,
  seriesEditFrom,
  summarizeSkipped,
  type SeriesMember,
} from "@/domain/title-series";
import type { Payable } from "@/domain/types";

type T = SeriesMember & { origin?: string; sourceIds?: { commissionIds: string[] }; documentNumber?: string; notes?: string; categoryId?: string; accountId?: string; supplierId?: string; creditorName?: string; recurrence?: unknown };
/** Os testes de Contas a Pagar usam só os campos da regra; o resto do `Payable` não importa aqui. */
const asPayables = (xs: T[]) => xs as unknown as (SeriesMember & Payable)[];

const pad = (n: number) => String(n).padStart(2, "0");
/** Série parcelada de 12 (dia 10, a partir de jan/2027), mesma série, " (i/12)", nº do documento próprio. */
function series12(day = 10): T[] {
  return Array.from({ length: 12 }, (_, i) => ({
    id: `pag_s_p${i + 1}`,
    description: `Aluguel da sala (${i + 1}/12)`,
    dueDate: `2027-${pad(i + 1)}-${pad(Math.min(day, new Date(Date.UTC(2027, i + 1, 0)).getUTCDate()))}T12:00:00.000Z`,
    competence: `2027-${pad(i + 1)}`,
    status: "previsto",
    amount: 1500,
    seriesId: "s",
    installment: i + 1,
    installments: 12,
    origin: "manual",
    sourceIds: { commissionIds: [] },
    documentNumber: `NF ${100 + i}`,
    notes: "Contrato 2027",
  }));
}

describe("futuros iguais (findFutureTitles)", () => {
  it("série de 12: editar a 3ª encontra da 4ª à 12ª (a 3ª é o próprio título; 1ª e 2ª ficam fora)", () => {
    const all = series12();
    const futures = findFutureTitles(all[2], all);
    expect(futures.map((f) => f.installment)).toEqual([4, 5, 6, 7, 8, 9, 10, 11, 12]);
  });
  it("futuro com baixa (parcial ou paga) e cancelado ficam fora", () => {
    const all = series12();
    all[5] = { ...all[5], payments: [{ id: "b1" }] as unknown[] };
    all[6] = { ...all[6], status: "pago" };
    all[7] = { ...all[7], status: "cancelado" };
    expect(findFutureTitles(all[2], all).map((f) => f.installment)).toEqual([4, 5, 9, 10, 11, 12]);
  });
  it("vencimento ≥ o do editado: título da série com vencimento anterior não entra (mesmo listado depois)", () => {
    const all = series12();
    all[10] = { ...all[10], dueDate: "2027-02-01T12:00:00.000Z" };
    expect(findFutureTitles(all[2], all).map((f) => f.installment)).not.toContain(11);
    // Mesmo vencimento do editado entra.
    all[11] = { ...all[11], dueDate: all[2].dueDate };
    expect(findFutureTitles(all[2], all).map((f) => f.installment)).toContain(12);
  });
  it("outra série com a mesma descrição não entra; resíduo da série não entra", () => {
    const all = [...series12(), { ...series12()[5], id: "outra", seriesId: "x" }, { ...series12()[8], id: "res", residualOf: "pag_s_p9", description: "Aluguel da sala (9/12) — Resíduo", installment: undefined, installments: undefined }];
    const ids = findFutureTitles(all[2], all).map((f) => f.id);
    expect(ids).not.toContain("outra");
    expect(ids).not.toContain("res");
    // Resíduo editado não tem futuros.
    expect(findFutureTitles(all[all.length - 1], all)).toEqual([]);
  });
  it("sem série: casa pela descrição ignorando maiúsculas, acentos e o sufixo de parcela (novo e antigo)", () => {
    const base = { competence: "2027-01", status: "previsto", amount: 100 };
    const all: T[] = [
      { ...base, id: "a", description: "Manutenção do ar", dueDate: "2027-01-10T12:00:00.000Z" },
      { ...base, id: "b", description: "MANUTENCAO DO AR (2/3)", dueDate: "2027-02-10T12:00:00.000Z" },
      { ...base, id: "c", description: "manutenção  do ar (parcela 3/3)", dueDate: "2027-03-10T12:00:00.000Z" },
      { ...base, id: "d", description: "Manutenção do ar condicionado", dueDate: "2027-04-10T12:00:00.000Z" },
      { ...base, id: "e", description: "Manutenção do ar", dueDate: "2027-05-10T12:00:00.000Z", seriesId: "outra" },
      { ...base, id: "f", description: "Manutenção do ar", dueDate: "2026-12-10T12:00:00.000Z" },
    ];
    expect(findFutureTitles(all[0], all).map((t) => t.id)).toEqual(["b", "c"]);
    expect(normalizeTitleDescription("Manutenção do Ar (parcela 3/3)")).toBe("manutencao do ar");
  });
});

describe("aplicação das mudanças (seriesEditFrom + applySeriesEdit)", () => {
  it("checklist: editar a 3ª (valor, descrição, observações) muda da 3ª à 12ª e não a 1ª e 2ª; sufixo refeito; nº do documento e parcela preservados", () => {
    const all = series12();
    const before = all[2];
    const after = { ...before, description: "Aluguel sala 2 (3/12)", amount: 1650, notes: "Reajuste 10%" };
    const edit = seriesEditFrom(before, after, PAYABLE_SERIES_FIELDS);
    expect(edit).toMatchObject({ description: "Aluguel sala 2 (3/12)", amount: 1650, fields: { notes: "Reajuste 10%" } });
    const futures = findFutureTitles(before, all);
    const result = new Map(all.map((t) => [t.id, t]));
    result.set(before.id, after);
    for (const f of futures) result.set(f.id, { ...f, ...applySeriesEdit(f, edit) } as T);
    const out = Array.from(result.values());
    expect(out.slice(0, 2).map((t) => [t.description, t.amount])).toEqual([
      ["Aluguel da sala (1/12)", 1500],
      ["Aluguel da sala (2/12)", 1500],
    ]);
    out.slice(2).forEach((t, i) => {
      expect(t.description).toBe(`Aluguel sala 2 (${i + 3}/12)`);
      expect(t.amount).toBe(1650);
      expect(t.notes).toBe("Reajuste 10%");
      expect(t.documentNumber).toBe(`NF ${102 + i}`);
      expect(t.installment).toBe(i + 3);
      expect(t.competence).toBe(`2027-${pad(i + 3)}`);
    });
  });
  it("futuro com baixa não é alterado (fica fora da lista)", () => {
    const all = series12();
    all[4] = { ...all[4], payments: [{ id: "x" }] as unknown[] };
    const futures = findFutureTitles(all[2], all);
    expect(futures.some((f) => f.id === all[4].id)).toBe(false);
  });
  it("vencimento do dia 10 → 5: cada futuro vai para o dia 5 do PRÓPRIO mês; competência acompanha (mesmo mês)", () => {
    const all = series12();
    const after = { ...all[2], dueDate: "2027-03-05T12:00:00.000Z" };
    const edit = seriesEditFrom(all[2], after, PAYABLE_SERIES_FIELDS);
    expect(edit.day).toBe(5);
    const patches = findFutureTitles(all[2], all).map((f) => ({ f, p: applySeriesEdit(f, edit) }));
    for (const { f, p } of patches) {
      expect(p.dueDate).toBe(`${f.dueDate.slice(0, 7)}-05`);
      expect(p.competence).toBeUndefined();
      expect(p.amount).toBeUndefined();
    }
  });
  it("dia 31 → limitado ao fim do mês (30 em abril, 28 em fevereiro, 29 em ano bissexto)", () => {
    const all = series12(10);
    const after = { ...all[0], dueDate: "2027-01-31T12:00:00.000Z" };
    const edit = seriesEditFrom(all[0], after, PAYABLE_SERIES_FIELDS);
    const byMonth = Object.fromEntries(findFutureTitles(all[0], all).map((f) => [f.dueDate.slice(5, 7), applySeriesEdit(f, edit).dueDate]));
    expect(byMonth["02"]).toBe("2027-02-28");
    expect(byMonth["03"]).toBe("2027-03-31");
    expect(byMonth["04"]).toBe("2027-04-30");
    expect(moveToDay("2028-02-10", 31)).toBe("2028-02-29");
  });
  it("mudar só o MÊS do vencimento (mesmo dia) não move os futuros", () => {
    const all = series12();
    const edit = seriesEditFrom(all[2], { ...all[2], dueDate: "2027-04-10T12:00:00.000Z" }, PAYABLE_SERIES_FIELDS);
    expect(edit.day).toBeUndefined();
    expect(hasSeriesChanges(edit)).toBe(false);
  });
  it("mexer só no sufixo da descrição não vai para os futuros; valor igual em centavos não muda", () => {
    const all = series12();
    const edit = seriesEditFrom(all[2], { ...all[2], description: "Aluguel da sala", amount: 1500.001 }, PAYABLE_SERIES_FIELDS);
    expect(edit.description).toBeUndefined();
    expect(edit.amount).toBeUndefined();
  });
  it("credor e classificação vão como estão (limpar = null); campo igual no futuro não entra no patch", () => {
    const before: T = { id: "a", description: "X", dueDate: "2027-01-10", competence: "2027-01", status: "previsto", amount: 10, supplierId: "s1", creditorName: "Fornecedor A", categoryId: "c1", accountId: "acc" };
    const after = { ...before, supplierId: "s2", creditorName: "Fornecedor B", categoryId: "c2", accountId: undefined };
    const edit = seriesEditFrom(before, after, PAYABLE_SERIES_FIELDS);
    expect(edit.fields).toEqual({ supplierId: "s2", creditorName: "Fornecedor B", categoryId: "c2", accountId: null });
    const future = { ...before, id: "b", dueDate: "2027-02-10", categoryId: "c2" };
    expect(applySeriesEdit(future, edit)).toEqual({ supplierId: "s2", creditorName: "Fornecedor B", accountId: null });
  });
  it("a receber: pagador (cliente ou nome livre) e conta prevista", () => {
    const before: { id: string; description: string; dueDate: string; competence: string; status: string; amount: number; clientId?: string; payerName: string } = { id: "a", description: "Consultoria", dueDate: "2027-01-10", competence: "2027-01", status: "aberto", amount: 10, clientId: "cli1", payerName: "Cliente 1" };
    const after = { ...before, clientId: undefined, payerName: "Pagador avulso" };
    expect(seriesEditFrom(before, after, RECEIVABLE_SERIES_FIELDS).fields).toEqual({ clientId: null, payerName: "Pagador avulso" });
  });
  it("sufixo: refeito pelo nº da parcela gravado no formato que o título usa; sem parcela mantém o que tiver", () => {
    expect(seriesDescriptionFor("Novo nome (3/12)", { description: "Velho (7/12)", installment: 7, installments: 12 })).toBe("Novo nome (7/12)");
    expect(seriesDescriptionFor("Novo nome", { description: "Velho (parcela 2/3)", installment: 2, installments: 3 })).toBe("Novo nome (parcela 2/3)");
    expect(seriesDescriptionFor("Novo nome", { description: "Velho (4/6)" })).toBe("Novo nome (4/6)");
    expect(seriesDescriptionFor("Novo nome (1/2)", { description: "Velho" })).toBe("Novo nome");
    expect(ownInstallmentSuffix({ description: "Sem sufixo", installment: 5, installments: 9 })).toBe(" (5/9)");
  });
});

describe("Contas a Pagar: fluxo de aprovação e exclusões", () => {
  it("valor só vai para futuro manual ainda previsto; aprovado/a pagar fica fora com o motivo; outros campos vão", () => {
    const all = series12();
    all[5] = { ...all[5], status: "aprovado" };
    all[6] = { ...all[6], status: "a_pagar" };
    const futures = findPayableFutures(asPayables(all)[2], asPayables(all));
    const withAmount = seriesEditFrom(all[2], { ...all[2], amount: 1700 }, PAYABLE_SERIES_FIELDS);
    const skipped = futures.map((f) => ({ id: f.id, reason: payableSeriesSkip(f, applySeriesEdit(f, withAmount)) })).filter((s) => s.reason);
    expect(skipped.map((s) => s.id)).toEqual([all[5].id, all[6].id]);
    expect(skipped[0].reason).toBe(SERIES_SKIP_AMOUNT);
    expect(summarizeSkipped(skipped as { reason: string }[])).toEqual([{ reason: SERIES_SKIP_AMOUNT, count: 2 }]);
    const onlyNotes = seriesEditFrom(all[2], { ...all[2], notes: "Nova obs" }, PAYABLE_SERIES_FIELDS);
    expect(futures.every((f) => payableSeriesSkip(f, applySeriesEdit(f, onlyNotes)) === null)).toBe(true);
    expect(payableAmountLockedCount(futures)).toBe(2);
  });
  it("comissão/bônus/estorno nunca entram (nem como editado nem como futuro)", () => {
    const raw = series12();
    raw[4] = { ...raw[4], origin: "bonus" };
    raw[5] = { ...raw[5], sourceIds: { commissionIds: ["com1"] } };
    const all = asPayables(raw);
    expect(findPayableFutures(all[2], all).map((f) => f.installment)).toEqual([4, 7, 8, 9, 10, 11, 12]);
    expect(findPayableFutures(all[4], all)).toEqual([]);
    expect(payableSeriesUnavailable(all[4], all)).toMatch(/comissão/);
  });
  it("série recorrente (título-modelo + varredura) não tem edição em série: mantém o comportamento atual", () => {
    const template = { id: "tpl", description: "Internet", dueDate: "2027-01-10", competence: "2027-01", status: "previsto", amount: 99, seriesId: "tpl", origin: "manual", sourceIds: { commissionIds: [] }, recurrence: { frequency: "mensal", dayOfMonth: 10 } } as T;
    const occ = { ...template, id: "pag_rec_tpl_2027-02", dueDate: "2027-02-10", competence: "2027-02", origin: "recorrencia", recurrence: undefined } as T;
    const all = asPayables([template, occ]);
    expect(findPayableFutures(all[0], all)).toEqual([]);
    expect(payableSeriesUnavailable(all[1], all)).toMatch(/recorrente/);
  });
  it("lotes atômicos de no máximo 400 títulos", () => {
    expect(chunk(Array.from({ length: 401 }, (_, i) => i)).map((c) => c.length)).toEqual([400, 1]);
  });
});
