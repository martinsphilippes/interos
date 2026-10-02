/**
 * Leads do seed x período padrão da Visão Geral de Marketing. Os leads do seed nascem de 1 h a 30 dias antes do
 * momento do seed (os dois de Google Ads, 18 dias antes). Com "Mês atual" como padrão, do dia 1 ao dia 18 de qualquer
 * mês a Visão Geral não mostrava Google Ads entre as origens (o e2e 50-consolidacao passou em 30/09 e falhou em 01/10
 * às 01h em Brasília). Com a janela móvel de 30 dias, toda origem que o seed gera aparece em qualquer dia do mês.
 */
import { afterEach, describe, expect, it, vi } from "vitest";
import { dateKey } from "@/lib/format";
import { DEFAULT_OVERVIEW_PERIOD, periodRange } from "@/components/marketing/marketing-model";

// A geração é em memória; o acesso ao banco/Auth só é usado na gravação (fora deste teste).
vi.mock("../../src/server/db", () => ({
  batchSet: vi.fn(),
  ORG_ID: "org_test",
  counterId: (prefix: string, year: string | null) => `counter_org_test_${prefix}${year ? `_${year}` : ""}`,
}));
vi.mock("../../src/server/auth/auth-admin", () => ({ authAdmin: vi.fn() }));

interface SeedLead {
  id: string;
  origin: string;
  createdAt: string;
  duplicateOfId?: string;
}

/** Roda o seed até leads/vendas (em memória) com o relógio em `instant`. */
async function seedLeadsAt(instant: string): Promise<SeedLead[]> {
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(new Date(instant));
  vi.resetModules();
  vi.stubEnv("INTEROS_SEED_PASSWORD", "teste-seed");
  const { Store } = await import("../../scripts/seed/lib");
  const { seedOrg } = await import("../../scripts/seed/org");
  const { seedCatalog } = await import("../../scripts/seed/catalog");
  const { seedClients } = await import("../../scripts/seed/clients");
  const { seedSales } = await import("../../scripts/seed/journey-sales");
  const ctx = { store: new Store(), holidays: new Set<string>() } as unknown as Parameters<typeof seedOrg>[0];
  for (const step of [seedOrg, seedCatalog, seedClients, seedSales]) await step(ctx);
  return ctx.store.all<SeedLead>("leads").filter((l) => !l.duplicateOfId);
}

function originsIn(leads: SeedLead[], range: { startKey: string; endKey: string }): Set<string> {
  return new Set(leads.filter((l) => dateKey(l.createdAt) >= range.startKey && dateKey(l.createdAt) <= range.endKey).map((l) => l.origin));
}

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllEnvs();
});

describe("seed: origens dos leads no período padrão da Visão Geral", () => {
  it("dia 1 às 01h em Brasília: 'Mês atual' fica sem leads; o padrão mostra todas as origens, inclusive Google Ads", async () => {
    const instant = "2026-10-01T04:00:00Z";
    const leads = await seedLeadsAt(instant);
    const now = new Date(instant);
    expect(leads.some((l) => l.origin === "google_ads")).toBe(true);
    expect(originsIn(leads, periodRange("mes", now)).size).toBe(0);
    const shown = originsIn(leads, periodRange(DEFAULT_OVERVIEW_PERIOD, now));
    expect(shown.has("google_ads")).toBe(true);
    expect([...new Set(leads.map((l) => l.origin))].filter((o) => !shown.has(o))).toEqual([]);
  }, 60_000);

  it("em qualquer dia do mês (e na virada do ano) o padrão mostra Google Ads entre as origens", async () => {
    for (const instant of ["2026-09-30T15:00:00Z", "2026-10-01T02:00:00Z", "2026-10-10T15:00:00Z", "2026-10-18T15:00:00Z", "2026-10-31T15:00:00Z", "2027-01-01T12:00:00Z"]) {
      const leads = await seedLeadsAt(instant);
      expect(originsIn(leads, periodRange(DEFAULT_OVERVIEW_PERIOD, new Date(instant))).has("google_ads"), instant).toBe(true);
    }
  }, 120_000);
});
