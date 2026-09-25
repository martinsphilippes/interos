/**
 * Regras determinísticas de INSIGHTS (detecção de gargalos), sem IA.
 *
 * Cada regra recebe um contexto já calculado (indicadores do período atual com tendência vs. período
 * anterior, vindos do motor de KPIs, e alguns números operacionais) e devolve no máximo um insight por
 * ocorrência. Nada é consultado aqui: o contexto é montado em `engine.ts`. Módulo puro (sem Firestore),
 * para que os tipos possam ser usados por Client Components.
 */
import { DEPARTMENT_LABELS, type DepartmentKey } from "@/domain/constants";
import type { KpiResult } from "@/server/kpis/engine";
import { formatKpiValue, type KpiUnit } from "@/server/kpis/schemas";
import type { Period } from "@/server/kpis/period";
import { formatCurrency, formatNumber, formatPercent } from "@/lib/format";

export type InsightSeverity = "info" | "atencao" | "critico";

export interface InsightEvidence {
  label: string;
  href: string;
}

export interface Insight {
  key: string;
  severity: InsightSeverity;
  department: DepartmentKey;
  title: string;
  /** Frase com os números que dispararam a regra. */
  explanation: string;
  evidence: InsightEvidence[];
  suggestedAction: string;
}

export const SEVERITY_ORDER: Record<InsightSeverity, number> = { critico: 0, atencao: 1, info: 2 };
export const SEVERITY_LABELS: Record<InsightSeverity, string> = { critico: "Crítico", atencao: "Atenção", info: "Informativo" };

/** Etapa de workflow travada (SLA violado), agregada por etapa do template. */
export interface StuckStage {
  stageKey: string;
  stageName: string;
  department: DepartmentKey;
  count: number;
  examples: { stepId: string; clientName: string }[];
}

export interface InsightContext {
  period: Period;
  /** true quando o período avaliado contém "agora" (regras operacionais só valem nele). */
  current: boolean;
  kpis: Map<string, KpiResult>;
  /** Setting metas_referencia.reincidenciaMax (fração). */
  reincidenciaMax: number;
  /** Oportunidades abertas agora (base do pipeline). */
  openOpportunities: number;
  /** Clientes ativos com saúde "risco" agora. */
  riskClients: { id: string; name: string }[];
  /** Chamados abertos nos 30 dias após go-lives do período, marcados como ligados a treinamento. */
  trainingTickets: { id: string; label: string }[];
  stuckStages: StuckStage[];
}

/** Mínimo de etapas com SLA violado na mesma etapa do workflow para caracterizar handoff travado. */
export const STUCK_STAGE_MIN = 2;
/** Limite de inadimplência (planilha, aba Diretoria). */
export const DELINQUENCY_MAX = 0.04;
/** Oportunidades paradas acima desta fração do pipeline disparam alerta de follow-up. */
export const STALLED_PIPELINE_MAX = 0.2;

type Rule = (ctx: InsightContext) => Insight[];

// ---------------------------------------------------------------------------
// Utilitários de texto
// ---------------------------------------------------------------------------

function value(r: KpiResult | undefined): number | null {
  return r?.value ?? null;
}

function deltaPct(r: KpiResult | undefined): number | null {
  return r?.trend?.deltaPct ?? null;
}

function fmt(r: KpiResult | undefined, v: number | null | undefined = r?.value): string {
  if (!r) return "—";
  return formatKpiValue(v ?? null, r.kpi.unit, r.kpi.formulaMeta?.suffix);
}

/** "de 20 para 14 (−30%)" usando o valor anterior da tendência. */
function change(r: KpiResult | undefined): string {
  if (!r?.trend || r.trend.value === null || r.value === null) return fmt(r);
  const pct = r.trend.deltaPct;
  const pctText = pct === null ? "" : ` (${pct > 0 ? "+" : pct < 0 ? "−" : ""}${formatPercent(Math.abs(pct))})`;
  return `de ${fmt(r, r.trend.value)} para ${fmt(r)}${pctText}`;
}

function kpiEvidence(r: KpiResult | undefined, label?: string): InsightEvidence[] {
  return r ? [{ label: label ?? `${r.kpi.name}: ${fmt(r)}`, href: r.href }] : [];
}

function unitOf(r: KpiResult | undefined): KpiUnit {
  return r?.kpi.unit ?? "numero";
}

// ---------------------------------------------------------------------------
// Regras
// ---------------------------------------------------------------------------

/** (1) Leads estáveis (variação > −10%) e vendas caindo (< −15%): gargalo comercial. */
const commercialBottleneck: Rule = (ctx) => {
  const leads = ctx.kpis.get("leads_captados");
  const sales = ctx.kpis.get("novas_vendas");
  const dl = deltaPct(leads);
  const ds = deltaPct(sales);
  if (dl === null || ds === null || dl <= -0.1 || ds >= -0.15) return [];
  return [
    {
      key: "gargalo_comercial",
      severity: ds <= -0.3 ? "critico" : "atencao",
      department: "vendas",
      title: "Possível gargalo comercial",
      explanation: `Os leads se mantiveram (${change(leads)}), mas as novas vendas caíram ${change(sales)}. A demanda chega e não está virando venda.`,
      evidence: [...kpiEvidence(leads), ...kpiEvidence(sales), ...kpiEvidence(ctx.kpis.get("conversao_funil")), { label: "Pipeline de vendas", href: "/vendas/pipeline" }],
      suggestedAction: "Revisar o pipeline com o time comercial: oportunidades sem próxima ação, propostas paradas e objeções recorrentes.",
    },
  ];
};

/** (2) Vendas estáveis e implantação atrasando (entregas no prazo caiu ou backlog subiu > 20%). */
const implementationBottleneck: Rule = (ctx) => {
  const sales = ctx.kpis.get("novas_vendas");
  const onTime = ctx.kpis.get("entregas_prazo");
  const backlog = ctx.kpis.get("backlog_implantacao");
  const ds = deltaPct(sales);
  if (ds === null || ds <= -0.1) return [];
  const onTimeDropped = onTime?.trend?.delta !== null && onTime?.trend?.delta !== undefined && onTime.trend.delta < 0;
  const backlogGrew = (deltaPct(backlog) ?? 0) > 0.2;
  if (!onTimeDropped && !backlogGrew) return [];
  const parts: string[] = [];
  if (onTimeDropped) parts.push(`as entregas no prazo caíram ${change(onTime)}`);
  if (backlogGrew) parts.push(`o backlog de implantação subiu ${change(backlog)}`);
  return [
    {
      key: "gargalo_implantacao",
      severity: onTimeDropped && backlogGrew ? "critico" : "atencao",
      department: "implantacao",
      title: "Gargalo de implantação",
      explanation: `As vendas seguem estáveis (${change(sales)}), mas ${parts.join(" e ")}. A entrega não acompanha o ritmo comercial.`,
      evidence: [...kpiEvidence(onTime), ...kpiEvidence(backlog), { label: "Kanban de implantação", href: "/implantacao/kanban" }],
      suggestedAction: "Rever a capacidade da equipe de implantação, priorizar projetos atrasados e cobrar pendências do cliente.",
    },
  ];
};

/** (3) Go-lives no período e aumento de chamados nos 30 dias pós go-live: investigar implantação/treinamento. */
const postGoLiveTickets: Rule = (ctx) => {
  const goLives = ctx.kpis.get("implantacoes_concluidas");
  const tickets = ctx.kpis.get("chamados_30_dias");
  if (!goLives || (value(goLives) ?? 0) <= 0) return [];
  if (!tickets?.trend || tickets.trend.delta === null || tickets.trend.delta <= 0) return [];
  return [
    {
      key: "chamados_pos_golive",
      severity: ctx.trainingTickets.length > 0 ? "atencao" : "info",
      department: "implantacao",
      title: "Mais chamados depois do go-live",
      explanation: `${formatNumber(value(goLives))} go-live(s) no período e a média de chamados nos 30 dias seguintes subiu ${change(tickets)}${ctx.trainingTickets.length > 0 ? `; ${ctx.trainingTickets.length} chamado(s) foram marcados como ligados a treinamento` : ""}.`,
      evidence: [...kpiEvidence(tickets), ...ctx.trainingTickets.slice(0, 4).map((t) => ({ label: t.label, href: `/suporte/chamados/${t.id}` }))],
      suggestedAction: "Investigar a qualidade da implantação e do treinamento: revisar checklist, material e aceite dos clientes recém-implantados.",
    },
  ];
};

/** (4) Chamados em alta e reincidência acima da meta (settings metas_referencia.reincidenciaMax). */
const resolutionQuality: Rule = (ctx) => {
  const opened = ctx.kpis.get("chamados_abertos");
  const reopen = ctx.kpis.get("reincidencia");
  const rate = value(reopen);
  if (rate === null || rate <= ctx.reincidenciaMax) return [];
  const rising = opened?.trend?.delta !== null && opened?.trend?.delta !== undefined && opened.trend.delta >= 0;
  if (!rising) return [];
  return [
    {
      key: "qualidade_resolucao",
      severity: rate >= ctx.reincidenciaMax * 2 ? "critico" : "atencao",
      department: "suporte",
      title: "Qualidade de resolução em queda",
      explanation: `A reincidência está em ${fmt(reopen)} (máximo ${formatPercent(ctx.reincidenciaMax)}) e os chamados abertos foram ${change(opened)}. Chamados estão voltando depois de resolvidos.`,
      evidence: [...kpiEvidence(reopen), ...kpiEvidence(opened), { label: "Chamados reabertos", href: "/suporte/chamados?reaberto=1" }],
      suggestedAction: "Auditar os chamados reabertos, reforçar a confirmação da solução com o cliente e registrar a causa raiz.",
    },
  ];
};

/** (5) Saúde média caindo e chamados subindo: risco de churn. */
const churnRisk: Rule = (ctx) => {
  const health = ctx.kpis.get("saude_cliente");
  const opened = ctx.kpis.get("chamados_abertos");
  const hd = health?.trend?.delta;
  const od = opened?.trend?.delta;
  if (hd === null || hd === undefined || hd >= 0 || od === null || od === undefined || od <= 0) return [];
  return [
    {
      key: "risco_churn",
      severity: ctx.riskClients.length > 0 ? "critico" : "atencao",
      department: "cs",
      title: "Risco de churn na carteira",
      explanation: `A saúde média caiu ${change(health)} enquanto os chamados subiram ${change(opened)}${ctx.riskClients.length > 0 ? `; ${ctx.riskClients.length} cliente(s) estão em risco agora` : ""}.`,
      evidence: [...kpiEvidence(health), ...ctx.riskClients.slice(0, 5).map((c) => ({ label: c.name, href: `/clientes/${c.id}?aba=cs` })), { label: "Clientes em risco", href: "/cs/riscos" }],
      suggestedAction: "Acionar planos de sucesso para os clientes em risco e alinhar com o Suporte os chamados abertos dessas contas.",
    },
  ];
};

/** (6) Inadimplência acima de 4%: atenção ao caixa. */
const cashRisk: Rule = (ctx) => {
  const delinquency = ctx.kpis.get("inadimplencia");
  const rate = value(delinquency);
  if (rate === null || rate <= DELINQUENCY_MAX) return [];
  const overdue = delinquency?.numerator;
  return [
    {
      key: "inadimplencia_caixa",
      severity: rate > 0.06 ? "critico" : "atencao",
      department: "financeiro",
      title: "Inadimplência acima do limite",
      explanation: `A inadimplência do período está em ${fmt(delinquency)} (limite ${formatPercent(DELINQUENCY_MAX)})${overdue !== undefined ? `, com ${formatCurrency(overdue)} vencidos em aberto` : ""}.`,
      evidence: [...kpiEvidence(delinquency), { label: "Contas a receber", href: "/financeiro/contas-a-receber" }],
      suggestedAction: "Priorizar a régua de cobrança dos títulos vencidos e revisar condições de pagamento dos clientes reincidentes.",
    },
  ];
};

/** (7) SLA de workflow violado em uma etapa com N ou mais processos: handoff travado. */
const stuckHandoff: Rule = (ctx) => {
  if (!ctx.current) return [];
  return ctx.stuckStages
    .filter((s) => s.count >= STUCK_STAGE_MIN)
    .map((s) => ({
      key: `handoff_travado_${s.stageKey}`,
      severity: s.count >= STUCK_STAGE_MIN * 2 ? "critico" : "atencao",
      department: s.department,
      title: `Handoff travado em ${s.stageName}`,
      explanation: `${s.count} processo(s) estão parados na etapa "${s.stageName}" (${DEPARTMENT_LABELS[s.department]}) com o SLA violado.`,
      evidence: [
        { label: `Etapas de ${DEPARTMENT_LABELS[s.department]} com SLA em risco`, href: `/workflow?departamento=${s.department}&dep=${s.department}&sla=risco` },
        ...s.examples.slice(0, 3).map((e) => ({ label: e.clientName, href: `/workflow?etapa=${e.stepId}` })),
      ],
      suggestedAction: `Destravar os gates pendentes de ${s.stageName} com o gestor de ${DEPARTMENT_LABELS[s.department]} e redistribuir as etapas se faltar capacidade.`,
    }));
};

/** (8) Oportunidades paradas acima de 20% do pipeline: disciplina de follow-up. */
const followUpDiscipline: Rule = (ctx) => {
  const stalled = ctx.kpis.get("oportunidades_paradas");
  const count = value(stalled);
  if (count === null || ctx.openOpportunities <= 0) return [];
  const share = count / ctx.openOpportunities;
  if (share <= STALLED_PIPELINE_MAX) return [];
  return [
    {
      key: "disciplina_followup",
      severity: share > 0.4 ? "critico" : "atencao",
      department: "vendas",
      title: "Oportunidades paradas no pipeline",
      explanation: `${formatKpiValue(count, unitOf(stalled))} de ${formatNumber(ctx.openOpportunities)} oportunidades abertas (${formatPercent(share)}) estão sem movimentação acima do limite (máximo ${formatPercent(STALLED_PIPELINE_MAX)}).`,
      evidence: [...kpiEvidence(stalled), ...kpiEvidence(ctx.kpis.get("followups_atrasados")), { label: "Pipeline de vendas", href: "/vendas/pipeline" }],
      suggestedAction: "Fazer mutirão de follow-up: toda oportunidade aberta precisa de próxima ação com data.",
    },
  ];
};

export const INSIGHT_RULES: { key: string; label: string; rule: Rule }[] = [
  { key: "gargalo_comercial", label: "Leads estáveis e vendas caindo", rule: commercialBottleneck },
  { key: "gargalo_implantacao", label: "Vendas estáveis e implantação atrasando", rule: implementationBottleneck },
  { key: "chamados_pos_golive", label: "Chamados após go-live em alta", rule: postGoLiveTickets },
  { key: "qualidade_resolucao", label: "Reincidência acima da meta", rule: resolutionQuality },
  { key: "risco_churn", label: "Saúde caindo e chamados subindo", rule: churnRisk },
  { key: "inadimplencia_caixa", label: "Inadimplência acima de 4%", rule: cashRisk },
  { key: "handoff_travado", label: "Etapa de workflow com SLA violado", rule: stuckHandoff },
  { key: "disciplina_followup", label: "Oportunidades paradas acima de 20% do pipeline", rule: followUpDiscipline },
];

/** Indicadores que as regras leem (o motor calcula todos de uma vez, com tendência). */
export const INSIGHT_KPI_KEYS = [
  "leads_captados",
  "novas_vendas",
  "conversao_funil",
  "entregas_prazo",
  "backlog_implantacao",
  "implantacoes_concluidas",
  "chamados_30_dias",
  "chamados_abertos",
  "reincidencia",
  "saude_cliente",
  "inadimplencia",
  "oportunidades_paradas",
  "followups_atrasados",
];

export function sortInsights(items: Insight[]): Insight[] {
  return [...items].sort((a, b) => SEVERITY_ORDER[a.severity] - SEVERITY_ORDER[b.severity] || a.title.localeCompare(b.title, "pt-BR"));
}

/** Aplica todas as regras; uma regra que falha é ignorada (e registrada no log). */
export function runInsightRules(ctx: InsightContext): Insight[] {
  const out: Insight[] = [];
  for (const { key, rule } of INSIGHT_RULES) {
    try {
      out.push(...rule(ctx));
    } catch (error) {
      console.error(`[insights] regra ${key} falhou`, error);
    }
  }
  return sortInsights(out);
}

