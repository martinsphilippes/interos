import "server-only";
/**
 * Avaliação dos insights (regras em `rules.ts`). Monta o contexto uma vez por período: indicadores com
 * tendência pelo motor de KPIs (nunca recalculados aqui) e números operacionais lidos do mesmo DataBundle
 * que alimenta os indicadores (carga única e cache de 60s por período).
 *
 * Os insights não são gravados nem emitem evento: são calculados na leitura e apenas exibidos.
 */
import { list } from "@/server/db";
import { getSetting } from "@/server/admin/queries";
import { computeSlaState } from "@/server/sla";
import { computeKpis } from "@/server/kpis/engine";
import { loadDataBundle } from "@/server/kpis/formulas";
import { currentMonthKey, inPeriod, isCurrentPeriod, monthPeriod, type Period } from "@/server/kpis/period";
import { COLLECTIONS, type CurrentUser, type Department } from "@/domain/types";
import type { DepartmentKey } from "@/domain/constants";
import { INSIGHT_KPI_KEYS, runInsightRules, sortInsights, type Insight, type InsightContext, type StuckStage } from "./rules";

export type { Insight, InsightSeverity, InsightEvidence } from "./rules";

const DAY_MS = 86_400_000;
const OPEN_STEP = new Set(["pendente", "em_andamento", "aguardando_cliente", "aguardando_aprovacao"]);
const OPEN_OPPORTUNITY = (stage: string) => stage !== "ganho" && stage !== "perdido";

export interface EvaluateInsightsInput {
  period: Period;
  scope: "empresa" | "departamento";
  department?: DepartmentKey;
}

async function buildContext(period: Period): Promise<InsightContext> {
  const [results, bundle, goals] = await Promise.all([
    computeKpis(INSIGHT_KPI_KEYS, period, "empresa", undefined, { withSources: false }),
    loadDataBundle(period),
    getSetting<{ reincidenciaMax?: number }>("metas_referencia", { reincidenciaMax: 0.1 }),
  ]);
  const now = new Date(bundle.now);

  // Chamados ligados a treinamento abertos nos 30 dias após os go-lives do período.
  const trainingTickets: InsightContext["trainingTickets"] = [];
  for (const p of bundle.projects.filter((x) => x.goLiveAt && inPeriod(x.goLiveAt, period))) {
    const end = new Date(Date.parse(p.goLiveAt!) + 30 * DAY_MS).toISOString();
    for (const t of bundle.tickets) {
      if (t.clientId === p.clientId && t.trainingRelated && t.openedAt >= p.goLiveAt! && t.openedAt <= end) trainingTickets.push({ id: t.id, label: `${t.number} · ${t.subject}` });
    }
  }

  // Etapas abertas com SLA violado, agrupadas pela etapa do template.
  const stuck = new Map<string, StuckStage>();
  for (const step of bundle.workflowSteps) {
    if (!OPEN_STEP.has(step.status) || !step.slaInstanceId) continue;
    const sla = bundle.stepSla.get(step.slaInstanceId);
    if (!sla || computeSlaState(sla, now).state !== "violado") continue;
    const entry = stuck.get(step.stageKey) ?? { stageKey: step.stageKey, stageName: step.stageName, department: step.department, count: 0, examples: [] };
    entry.count += 1;
    entry.examples.push({ stepId: step.id, clientName: step.clientName });
    stuck.set(step.stageKey, entry);
  }

  return {
    period,
    current: isCurrentPeriod(period, now),
    kpis: new Map(results.map((r) => [r.key, r])),
    reincidenciaMax: typeof goals.reincidenciaMax === "number" ? goals.reincidenciaMax : 0.1,
    openOpportunities: bundle.opportunities.filter((o) => OPEN_OPPORTUNITY(o.stage)).length,
    riskClients: bundle.clients.filter((c) => c.status === "ativo" && c.healthLevel === "risco").map((c) => ({ id: c.id, name: c.tradeName })),
    trainingTickets,
    stuckStages: Array.from(stuck.values()).sort((a, b) => b.count - a.count),
  };
}

/**
 * Insights do período (atual vs. anterior). Escopo "empresa" devolve todos; "departamento" devolve os
 * insights daquele departamento. Ordenados por severidade (crítico → atenção → informativo).
 */
export async function evaluateInsights(input: EvaluateInsightsInput): Promise<Insight[]> {
  const ctx = await buildContext(input.period);
  const all = runInsightRules(ctx);
  if (input.scope === "departamento" && input.department) return all.filter((i) => i.department === input.department);
  return all;
}

/** Insights de vários departamentos com uma única avaliação. */
export async function evaluateInsightsForDepartments(period: Period, departments: DepartmentKey[]): Promise<Insight[]> {
  const all = await evaluateInsights({ period, scope: "empresa" });
  const wanted = new Set(departments);
  return all.filter((i) => wanted.has(i.department));
}

/**
 * Principais insights para o Meu Dia de gestores: diretoria/admin recebem os da empresa; gestores, os dos
 * departamentos que lideram (e o próprio). Colaboradores sem gestão recebem lista vazia.
 */
export async function getTopInsightsForUser(user: Pick<CurrentUser, "id" | "departmentId" | "isManager" | "isDirector">, limit = 3): Promise<Insight[]> {
  if (!user.isManager) return [];
  const period = monthPeriod(currentMonthKey());
  if (user.isDirector) return (await evaluateInsights({ period, scope: "empresa" })).slice(0, limit);
  const departments = await list<Department>(COLLECTIONS.departments, { where: [["managerId", "==", user.id]] });
  const keys = Array.from(new Set<DepartmentKey>([user.departmentId, ...departments.map((d) => d.key)]));
  return sortInsights(await evaluateInsightsForDepartments(period, keys)).slice(0, limit);
}
