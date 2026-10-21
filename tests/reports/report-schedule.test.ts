/**
 * Envio agendado de relatórios (fase 4): próxima execução no horário de Brasília e período de cada envio.
 */
import { describe, expect, it } from "vitest";
import { describeSchedule, nextRunAt, periodFilters, periodFiltersFor, periodsFor } from "@/domain/report-schedule";

// 2026-10-21 (quarta) 10:00 em Brasília = 13:00 UTC.
const WED_10H = Date.UTC(2026, 9, 21, 13, 0, 0);

describe("próxima execução", () => {
  it("diária: hoje se a hora ainda não passou, senão amanhã", () => {
    expect(nextRunAt({ frequency: "diaria", hour: 18 }, WED_10H)).toBe("2026-10-21T21:00:00.000Z");
    expect(nextRunAt({ frequency: "diaria", hour: 8 }, WED_10H)).toBe("2026-10-22T11:00:00.000Z");
    expect(nextRunAt({ frequency: "diaria", hour: 10 }, WED_10H)).toBe("2026-10-22T13:00:00.000Z"); // exatamente agora: próximo dia
  });
  it("semanal: no dia da semana escolhido", () => {
    expect(nextRunAt({ frequency: "semanal", weekday: 1, hour: 8 }, WED_10H)).toBe("2026-10-26T11:00:00.000Z"); // segunda
    expect(nextRunAt({ frequency: "semanal", weekday: 3, hour: 18 }, WED_10H)).toBe("2026-10-21T21:00:00.000Z"); // hoje à tarde
    expect(nextRunAt({ frequency: "semanal", weekday: 3, hour: 9 }, WED_10H)).toBe("2026-10-28T12:00:00.000Z"); // semana que vem
  });
  it("mensal: no dia do mês (até 28), virando o ano", () => {
    expect(nextRunAt({ frequency: "mensal", monthDay: 25, hour: 7 }, WED_10H)).toBe("2026-10-25T10:00:00.000Z");
    expect(nextRunAt({ frequency: "mensal", monthDay: 1, hour: 7 }, WED_10H)).toBe("2026-11-01T10:00:00.000Z");
    expect(nextRunAt({ frequency: "mensal", monthDay: 5, hour: 7 }, Date.UTC(2026, 11, 20, 12))).toBe("2027-01-05T10:00:00.000Z");
  });
});

describe("período do envio", () => {
  it("por data", () => {
    expect(periodFilters("ontem", WED_10H)).toEqual({ de: "2026-10-20", ate: "2026-10-20" });
    expect(periodFilters("ultimos_7", WED_10H)).toEqual({ de: "2026-10-14", ate: "2026-10-20" });
    expect(periodFilters("semana_anterior", WED_10H)).toEqual({ de: "2026-10-12", ate: "2026-10-18" });
    expect(periodFilters("mes_atual", WED_10H)).toEqual({ de: "2026-10-01", ate: "2026-10-20" });
    expect(periodFilters("mes_anterior", WED_10H)).toEqual({ de: "2026-09-01", ate: "2026-09-30" });
    // Dia 1: «mês atual até ontem» manda o mês anterior inteiro.
    expect(periodFilters("mes_atual", Date.UTC(2026, 10, 1, 12))).toEqual({ de: "2026-10-01", ate: "2026-10-31" });
  });
  it("por competência e fotografia", () => {
    expect(periodFiltersFor("mes", "mes_anterior", WED_10H)).toEqual({ de: "2026-09", ate: "2026-09" });
    expect(periodFiltersFor("mes", "ultimos_3_meses", Date.UTC(2026, 0, 10, 12))).toEqual({ de: "2025-10", ate: "2025-12" });
    expect(periodFiltersFor("nenhum", "atual", WED_10H)).toEqual({});
    expect(periodsFor("nenhum")).toEqual(["atual"]);
  });
  it("descrição em português", () => {
    expect(describeSchedule({ frequency: "semanal", weekday: 1, hour: 8, period: "semana_anterior" })).toBe("Toda segunda às 8h · semana anterior (seg. a dom.)");
    expect(describeSchedule({ frequency: "semanal", weekday: 6, hour: 9, period: "ontem" })).toBe("Todo sábado às 9h · ontem");
    expect(describeSchedule({ frequency: "mensal", monthDay: 1, hour: 7, period: "mes_anterior" })).toBe("Todo dia 1 às 7h · mês anterior");
  });
});
