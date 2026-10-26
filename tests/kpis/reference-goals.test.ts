/**
 * Metas de referência por departamento (a meta do KPI é a fonte única) e pontos da gamificação por departamento.
 */
import { describe, expect, it } from "vitest";
import { REFERENCE_GOALS, resolveReferenceGoals } from "@/domain/reference-goals";
import { DEFAULT_GAMIFICATION, pointsForRule } from "@/server/performance/schemas";

const setting = { csat: 8.5, churnMax: 0.03, reincidenciaMax: 0.1, slaSuporte: 0.9, implantacaoPrazo: 0.9, ativacao7dias: 0.8, mrrCrescimento: 0.08, ticketMedio: 350 };

describe("metas de referência por departamento", () => {
  it("cada meta tem departamento e KPI; sem KPI vale a configuração", () => {
    const rows = resolveReferenceGoals(setting, []);
    expect(rows).toHaveLength(REFERENCE_GOALS.length);
    expect(rows.every((r) => r.source === "configuracao")).toBe(true);
    expect(rows.find((r) => r.field === "churnMax")).toMatchObject({ department: "cs", value: 0.03 });
    expect(new Set(rows.map((r) => r.department))).toEqual(new Set(["suporte", "cs", "implantacao", "financeiro", "vendas"]));
  });

  it("KPI com meta é a fonte; KPI sem meta cai na configuração", () => {
    const rows = resolveReferenceGoals(setting, [
      { key: "sla_solucao", name: "SLA de solução", target: 0.95, active: true },
      { key: "churn", name: "Churn", active: true },
    ]);
    expect(rows.find((r) => r.field === "slaSuporte")).toMatchObject({ value: 0.95, source: "indicador", kpiName: "SLA de solução" });
    expect(rows.find((r) => r.field === "churnMax")).toMatchObject({ value: 0.03, source: "configuracao", kpiName: "Churn" });
  });
});

describe("pontos da gamificação por departamento", () => {
  const settings = { ...DEFAULT_GAMIFICATION, pontosPorDepartamento: { financeiro: { tarefa_no_prazo: 8 } } };

  it("o departamento com pontos próprios usa os dele; os outros, o padrão da empresa", () => {
    expect(pointsForRule(settings, "tarefa_no_prazo", "financeiro")).toBe(8);
    expect(pointsForRule(settings, "tarefa_no_prazo", "suporte")).toBe(DEFAULT_GAMIFICATION.pontos.tarefa_no_prazo);
    expect(pointsForRule(settings, "tarefa_no_prazo", null)).toBe(DEFAULT_GAMIFICATION.pontos.tarefa_no_prazo);
    expect(pointsForRule(settings, "venda_ganha", "financeiro")).toBe(DEFAULT_GAMIFICATION.pontos.venda_ganha);
  });

  it("zero próprio vale (desliga a regra só para o departamento)", () => {
    expect(pointsForRule({ ...settings, pontosPorDepartamento: { vendas: { tarefa_atrasada: 0 } } }, "tarefa_atrasada", "vendas")).toBe(0);
  });
});
