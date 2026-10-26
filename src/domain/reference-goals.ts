/**
 * Metas de referência da empresa ligadas aos indicadores (KPIs). Cada meta pertence a um departamento e corresponde a
 * um KPI do motor: a meta mensal do KPI é a fonte única (editar aqui ou em Administração › Indicadores é a mesma coisa).
 * Sem o KPI cadastrado, vale o valor guardado na configuração `metas_referencia`.
 */
import type { DepartmentKey } from "./constants";

export type ReferenceGoalField = "csat" | "churnMax" | "reincidenciaMax" | "slaSuporte" | "implantacaoPrazo" | "ativacao7dias" | "mrrCrescimento" | "ticketMedio";

export interface ReferenceGoalDef {
  field: ReferenceGoalField;
  /** Chave do KPI (Administração › Indicadores) que guarda esta meta. */
  kpiKey: string;
  department: DepartmentKey;
  label: string;
  hint: string;
  /** percent: gravado como fração (0,03 = 3%). */
  kind: "percent" | "score" | "currency";
}

export const REFERENCE_GOALS: readonly ReferenceGoalDef[] = [
  { field: "csat", kpiKey: "csat", department: "suporte", label: "CSAT mínimo (0–10)", hint: "Nota média de satisfação no suporte.", kind: "score" },
  { field: "slaSuporte", kpiKey: "sla_solucao", department: "suporte", label: "Cumprimento de SLA no suporte (%)", hint: "Chamados resolvidos dentro do prazo.", kind: "percent" },
  { field: "reincidenciaMax", kpiKey: "reincidencia", department: "suporte", label: "Reincidência máxima de chamados (%)", hint: "Chamados reabertos ou repetidos.", kind: "percent" },
  { field: "churnMax", kpiKey: "churn", department: "cs", label: "Churn máximo mensal (%)", hint: "Cancelamentos sobre a base ativa.", kind: "percent" },
  { field: "implantacaoPrazo", kpiKey: "entregas_prazo", department: "implantacao", label: "Implantações no prazo (%)", hint: "Go-live até a data prevista.", kind: "percent" },
  { field: "ativacao7dias", kpiKey: "ativacao_7_dias", department: "implantacao", label: "Ativação em até 7 dias (%)", hint: "Clientes ativados na primeira semana.", kind: "percent" },
  { field: "mrrCrescimento", kpiKey: "crescimento_mrr", department: "financeiro", label: "Crescimento mensal de MRR (%)", hint: "Meta de expansão da receita recorrente.", kind: "percent" },
  { field: "ticketMedio", kpiKey: "ticket_medio", department: "vendas", label: "Ticket médio de venda (R$)", hint: "Valor mensal médio por nova venda.", kind: "currency" },
];

export interface ReferenceGoalRow extends ReferenceGoalDef {
  value: number;
  /** De onde veio o valor: a meta do KPI ou a configuração (KPI não cadastrado ou sem meta). */
  source: "indicador" | "configuracao";
  kpiName?: string;
  kpiActive?: boolean;
}

/** Valor efetivo de cada meta: a meta do KPI, se o KPI existe e tem meta; senão o da configuração. */
export function resolveReferenceGoals(
  setting: Record<ReferenceGoalField, number>,
  kpis: { key: string; name: string; target?: number; active: boolean }[],
): ReferenceGoalRow[] {
  return REFERENCE_GOALS.map((def) => {
    const kpi = kpis.find((k) => k.key === def.kpiKey);
    const fromKpi = kpi && typeof kpi.target === "number" && Number.isFinite(kpi.target);
    return { ...def, value: fromKpi ? kpi.target! : setting[def.field], source: fromKpi ? "indicador" : "configuracao", kpiName: kpi?.name, kpiActive: kpi?.active };
  });
}
