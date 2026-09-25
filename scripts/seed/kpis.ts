/**
 * Definições de KPIs (coleção `kpis`) alinhadas ao registro de fórmulas do motor de indicadores
 * (src/server/kpis/formulas.ts): toda fórmula do registro ganha um documento com `formula = key`,
 * a unidade, o sentido e o departamento dono vindos do próprio registro. As metas estão na escala
 * dos dados do seed (mês corrente parcial), para que o status reflita a operação e não um número
 * inalcançável.
 *
 * Requer o seed rodando com `--conditions=react-server` (o registro é server-only).
 */
import { COLLECTIONS, type Kpi } from "../../src/domain/types";
import type { DepartmentKey } from "../../src/domain/constants";
import { listFormulas } from "../../src/server/kpis/formulas";
import type { SeedDoc } from "./lib";
import type { SeedContext } from "./context";

/** Meta, faixa e peso de cada indicador (ausente = sem meta; o peso padrão é 1). */
export const KPI_TARGETS: Record<string, { target?: number; targetMin?: number; targetMax?: number; weight?: number }> = {
  // Marketing
  leads_captados: { target: 30, weight: 2 },
  mqls: { target: 8, weight: 3 },
  desqualificados: { target: 5 },
  cpl: { target: 120 },
  conversao_mql: { target: 0.35, weight: 2 },
  conversao_mql_oportunidade: { target: 0.5, weight: 2 },
  // Vendas
  novas_vendas: { target: 6, weight: 3 },
  receita_vendida: { target: 12000, weight: 3 },
  mrr_vendido: { target: 2500, weight: 2 },
  setup_vendido: { target: 10000, weight: 2 },
  recorrencia_vendida: { target: 2500, weight: 2 },
  hardware_vendido: { target: 3000 },
  conversao_funil: { target: 0.2, weight: 2 },
  ticket_medio: { target: 350 },
  ciclo_vendas_dias: { target: 21 },
  followups_atrasados: { target: 2 },
  oportunidades_paradas: { target: 2 },
  // Financeiro
  faturamento: { target: 35000, weight: 2 },
  recebido: { target: 30000, weight: 2 },
  inadimplencia: { target: 0.04, weight: 3 },
  contas_receber: { target: 30000, targetMin: 20000, targetMax: 45000 },
  mrr: { target: 18000, weight: 3 },
  crescimento_mrr: { target: 0.08, weight: 2 },
  contratos_assinados: { target: 8 },
  tempo_liberacao_dias: { target: 2 },
  // Implantação
  implantacoes_concluidas: { target: 4, weight: 2 },
  entregas_prazo: { target: 0.9, weight: 3 },
  tempo_medio_implantacao: { target: 15 },
  ativacao_7_dias: { target: 0.8, weight: 3 },
  backlog_implantacao: { target: 5 },
  chamados_30_dias: { target: 2, weight: 2 },
  chamados_pos_implantacao: { target: 2, weight: 2 },
  qualidade_implantacao: { target: 0.95, weight: 2 },
  produtividade: { target: 10 },
  // CS
  clientes_ativos: { target: 30, weight: 2 },
  saude_cliente: { target: 80, weight: 3 },
  clientes_risco: { target: 2, weight: 2 },
  adocao_media: { target: 0.75, weight: 2 },
  csat_cs: { target: 8.5 },
  taxa_renovacao: { target: 0.9, weight: 2 },
  churn: { target: 0.03, weight: 3 },
  churn_receita: { target: 0.03, weight: 2 },
  churn_inicial_90_dias: { target: 0.03, weight: 2 },
  upsell_gerado: { target: 2000 },
  // Suporte
  chamados_abertos: { target: 40 },
  chamados_resolvidos: { target: 30 },
  sla_resposta: { target: 0.95, weight: 2 },
  sla_solucao: { target: 0.9, weight: 3 },
  tempo_medio_resposta_min: { target: 240 },
  tempo_medio_solucao_h: { target: 48 },
  reincidencia: { target: 0.1 },
  csat: { target: 8.5, weight: 3 },
  backlog_suporte: { target: 15 },
  oportunidades_suporte: { target: 3 },
  auditoria_qualidade: { target: 0.95 },
  // Empresa
  tarefas_concluidas: { target: 40 },
  tarefas_atrasadas: { target: 10 },
  tarefas_no_prazo_pct: { target: 0.85 },
  sla_workflow_cumprido: { target: 0.9 },
};

export const DEPT_MANAGER: Record<DepartmentKey, string> = {
  marketing: "mateus",
  vendas: "igor",
  financeiro: "karem",
  implantacao: "lando",
  cs: "felipe",
  suporte: "lando",
  administrativo: "karem",
  diretoria: "hercules",
};

export function seedKpiDefinitions(ctx: SeedContext, createdAt: string): void {
  for (const f of listFormulas()) {
    const spec = KPI_TARGETS[f.key] ?? {};
    ctx.store.add(COLLECTIONS.kpis, `kpi_${f.key}`, {
      key: f.key,
      name: f.label,
      department: f.department,
      description: f.description,
      formula: f.key,
      source: f.source,
      period: "mensal",
      unit: f.unit,
      direction: f.direction,
      target: spec.target,
      targetMin: spec.targetMin,
      targetMax: spec.targetMax,
      attentionPct: 85,
      weight: spec.weight ?? 1,
      ownerId: f.department === "empresa" ? "user_hercules" : `user_${DEPT_MANAGER[f.department]}`,
      active: true,
      createdAt,
    } satisfies SeedDoc<Kpi>);
  }
}
