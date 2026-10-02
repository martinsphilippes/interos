/**
 * Datas relativas do seed (scripts/seed/lib.ts) no fuso da operação. O produto calcula "hoje" e a competência em
 * São Paulo (todayKey/dateKey); o seed usava a data UTC, que entre 21h e 24h em Brasília já é o dia seguinte — e, no
 * último dia do mês, o mês seguinte. Um seed rodado em 30/09 às 21h56 gerava cobranças, janela de mensalidades e
 * vendedores como se fosse 01/10, enquanto as telas ainda estavam em 30/09.
 */
import { afterEach, describe, expect, it, vi } from "vitest";
import { dateKey } from "@/lib/format";

// lib.ts importa o acesso ao banco só para o gravador em lote; aqui interessam apenas as datas.
vi.mock("../../src/server/db", () => ({ batchSet: vi.fn(), ORG_ID: "org_test" }));

async function seedLibAt(instant: string) {
  vi.useFakeTimers();
  vi.setSystemTime(new Date(instant));
  vi.resetModules();
  return import("../../scripts/seed/lib");
}

afterEach(() => {
  vi.useRealTimers();
});

describe("seed: hoje e competência no fuso de São Paulo", () => {
  it("às 21h56 de 30/09 em Brasília (00h56 UTC de 01/10) o seed ainda está em 30/09 e na competência 2026-09", async () => {
    const lib = await seedLibAt("2026-10-01T00:56:00Z");
    expect(dateKey(lib.at(0))).toBe("2026-09-30");
    expect(lib.daysAgo(0).slice(0, 10)).toBe("2026-09-30");
    expect(lib.competence()).toBe("2026-09");
    expect(lib.competence(-5)).toBe("2026-04");
    expect(lib.competence(2)).toBe("2026-11");
  });

  it("à 00h de 01/10 em Brasília já é 01/10 e competência 2026-10", async () => {
    const lib = await seedLibAt("2026-10-01T03:00:00Z");
    expect(dateKey(lib.at(0))).toBe("2026-10-01");
    expect(lib.competence()).toBe("2026-10");
  });

  it("virada do ano: 31/12 às 22h em Brasília continua em 2026", async () => {
    const lib = await seedLibAt("2027-01-01T01:00:00Z");
    expect(dateKey(lib.at(0))).toBe("2026-12-31");
    expect(lib.competence()).toBe("2026-12");
    expect(lib.NOW_LOCAL.getUTCFullYear()).toBe(2026);
  });

  it("competência de uma data de início (12h UTC) não muda", async () => {
    const lib = await seedLibAt("2026-10-01T00:56:00Z");
    expect(lib.competence(0, new Date("2026-04-17T12:00:00.000Z"))).toBe("2026-04");
    expect(lib.competence(1, new Date("2026-04-30T12:00:00.000Z"))).toBe("2026-05");
  });

  it("em qualquer hora do dia, at(0) cai no mesmo dia que o produto considera hoje (dateKey)", async () => {
    for (let h = 0; h < 24; h++) {
      const instant = new Date(Date.UTC(2026, 8, 30, h, 30)).toISOString();
      const lib = await seedLibAt(instant);
      expect(dateKey(lib.at(0)), instant).toBe(dateKey(new Date(instant)));
      expect(lib.competence(), instant).toBe(dateKey(new Date(instant)).slice(0, 7));
    }
  });
});
