/**
 * Período da Visão Geral de Marketing no fuso de São Paulo. Com "Mês atual" como padrão, todo dia 1 a tela abria
 * com 01/MM a 01/MM: sem leads, gráficos vazios e "-100%" contra um único dia — o padrão passou a ser a janela móvel
 * de 30 dias, que nunca encolhe a um dia na virada do mês.
 */
import { describe, expect, it } from "vitest";
import { DEFAULT_OVERVIEW_PERIOD, parsePeriod, periodRange } from "@/components/marketing/marketing-model";

describe("marketing: período padrão da Visão Geral", () => {
  it("sem ?periodo= (ou inválido) a Visão Geral usa os últimos 30 dias; valores explícitos são respeitados", () => {
    expect(DEFAULT_OVERVIEW_PERIOD).toBe("30d");
    expect(parsePeriod(undefined, DEFAULT_OVERVIEW_PERIOD)).toBe("30d");
    expect(parsePeriod("xyz", DEFAULT_OVERVIEW_PERIOD)).toBe("30d");
    expect(parsePeriod("mes", DEFAULT_OVERVIEW_PERIOD)).toBe("mes");
    expect(parsePeriod("90d", DEFAULT_OVERVIEW_PERIOD)).toBe("90d");
  });

  it("chamadores antigos (filtro de leads) continuam com 'mes' como fallback", () => {
    expect(parsePeriod(undefined)).toBe("mes");
    expect(parsePeriod("ano")).toBe("ano");
  });

  it("dia 1 às 00h25 em Brasília: 'mes' encolhe a um dia; o padrão cobre os 30 dias anteriores", () => {
    const now = new Date("2026-10-01T03:25:00Z");
    expect(periodRange("mes", now)).toMatchObject({ startKey: "2026-10-01", endKey: "2026-10-01" });
    expect(periodRange(DEFAULT_OVERVIEW_PERIOD, now)).toMatchObject({ startKey: "2026-09-02", endKey: "2026-10-01", bucket: "dia" });
  });

  it("30/09 às 23h em Brasília (02h UTC de 01/10) ainda é setembro", () => {
    const now = new Date("2026-10-01T02:00:00Z");
    expect(periodRange("mes", now)).toMatchObject({ startKey: "2026-09-01", endKey: "2026-09-30" });
    expect(periodRange("30d", now)).toMatchObject({ startKey: "2026-09-01", endKey: "2026-09-30" });
  });

  it("a janela de 30 dias atravessa a virada do ano", () => {
    expect(periodRange("30d", new Date("2027-01-01T12:00:00Z"))).toMatchObject({ startKey: "2026-12-03", endKey: "2027-01-01" });
  });
});
