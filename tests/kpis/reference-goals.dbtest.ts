/**
 * Metas de referência no banco (npm run test:db): salvar leva o valor para a meta do KPI do departamento e a leitura
 * usa a meta do KPI (fonte única). Isolamento: KPI de teste com chave do mapa criado/restaurado; a configuração volta.
 */
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { docdb } from "@/server/docdb";
import { create, getById, list } from "@/server/db";
import { COLLECTIONS, type Kpi } from "@/domain/types";
import { getReferenceGoalRows, getReferenceGoals, syncReferenceGoalsToKpis } from "@/server/kpis/reference-goals";
import { SETTING_DEFAULTS } from "@/server/admin/schemas";

let existing: Kpi | null = null;
let createdId: string | null = null;

beforeAll(async () => {
  if (!process.env.DATABASE_URL) throw new Error("Defina DATABASE_URL (veja scripts/db-local.sh)");
  existing = (await list<Kpi>(COLLECTIONS.kpis, { where: [["key", "==", "ticket_medio"]] }))[0] ?? null;
  if (!existing) {
    const k = await create<Kpi>(
      COLLECTIONS.kpis,
      { key: "ticket_medio", name: "Ticket médio (teste)", department: "vendas", formula: "ticket_medio", source: "opportunities", period: "mensal", unit: "moeda", direction: "maior_melhor", attentionPct: 0.8, weight: 1, active: true } as never,
      "kpi_ticket_medio_test",
    );
    createdId = k.id;
  }
});

afterAll(async () => {
  const sql = docdb.sql();
  if (createdId) await sql`delete from interos.kpis where id = ${createdId}`;
  else if (existing) await sql`update interos.kpis set data = ${sql.json(existing as never)} where id = ${existing.id}`;
});

describe("metas de referência ↔ KPI", () => {
  it("salvar leva a meta ao KPI do departamento; a leitura usa a meta do KPI", async () => {
    const kpiId = createdId ?? existing!.id;
    const changed = await syncReferenceGoalsToKpis({ ...SETTING_DEFAULTS.metas_referencia, ticketMedio: 777 });
    expect(changed).toContain("ticket_medio");
    expect((await getById<Kpi>(COLLECTIONS.kpis, kpiId))?.target).toBe(777);
    expect((await getReferenceGoals()).ticketMedio).toBe(777);
    expect((await getReferenceGoalRows()).find((r) => r.field === "ticketMedio")).toMatchObject({ department: "vendas", source: "indicador", value: 777 });
  });
});
