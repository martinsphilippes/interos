/**
 * Performance: histórico mensal de KPIs (8 meses), metas do mês, comissões das vendas ganhas,
 * resultados de bônus da competência anterior, pontos de gamificação e conquistas.
 */
import { COLLECTIONS, type Achievement, type BonusResult, type Commission, type GamificationPoints, type Goal, type Kpi, type KpiSnapshot } from "../../src/domain/types";
import { addDays, competence, dayInCompetence, daysAgo, id, rng, type SeedDoc } from "./lib";
import type { SeedContext, UserKey } from "./context";

/** Faixas plausíveis por KPI (inspiradas na planilha de relatórios); `down` = série decrescente. */
const RANGES: Record<string, { min: number; max: number; down?: boolean; decimals?: number }> = {
  leads_captados: { min: 110, max: 258, decimals: 0 },
  mqls: { min: 34, max: 90, decimals: 0 },
  cpl: { min: 32, max: 18, down: true },
  conversao_mql: { min: 0.28, max: 0.38, decimals: 3 },
  novas_vendas: { min: 7, max: 16, decimals: 0 },
  conversao_funil: { min: 0.15, max: 0.25, decimals: 3 },
  ticket_medio: { min: 290, max: 380 },
  mrr: { min: 340000, max: 428500 },
  inadimplencia: { min: 0.06, max: 0.03, down: true, decimals: 3 },
  contas_receber: { min: 45000, max: 70000 },
  entregas_prazo: { min: 0.8, max: 0.95, decimals: 3 },
  produtividade: { min: 6, max: 12, decimals: 0 },
  qualidade_implantacao: { min: 0.9, max: 0.97, decimals: 3 },
  chamados_resolvidos: { min: 220, max: 286, decimals: 0 },
  sla_solucao: { min: 0.84, max: 0.92, decimals: 3 },
  sla_resposta: { min: 0.9, max: 0.97, decimals: 3 },
  csat: { min: 8.4, max: 9.4, decimals: 1 },
  reincidencia: { min: 0.12, max: 0.06, down: true, decimals: 3 },
  taxa_renovacao: { min: 0.82, max: 0.95, decimals: 3 },
  saude_cliente: { min: 72, max: 86, decimals: 0 },
  churn: { min: 0.008, max: 0.004, down: true, decimals: 4 },
};

function seedSnapshots(ctx: SeedContext): void {
  const { store } = ctx;
  const kpis = store.all<Kpi>(COLLECTIONS.kpis);
  let seq = 0;
  for (const kpi of kpis) {
    const range = RANGES[kpi.key];
    if (!range) continue;
    for (let m = -7; m <= 0; m++) {
      const t = (m + 7) / 7;
      const base = range.min + (range.max - range.min) * t;
      const noise = (range.max - range.min) * rng.float(-0.12, 0.12, 4);
      let value = base + noise;
      // Mês corrente ainda incompleto para contagens.
      if (m === 0 && kpi.unit === "numero" && !["csat", "saude_cliente"].includes(kpi.key)) value *= 0.75;
      value = Number(value.toFixed(range.decimals ?? 2));
      const target = kpi.target;
      const attainment = target ? Number((kpi.direction === "menor_melhor" ? target / value : value / target).toFixed(3)) : undefined;
      const status = attainment === undefined ? undefined : attainment >= 1 ? "atingida" : attainment >= 0.85 ? "atencao" : "critico";
      seq += 1;
      const period = competence(m);
      store.add(COLLECTIONS.kpiSnapshots, id("snap", seq, 4), {
        kpiKey: kpi.key,
        period,
        scope: kpi.department === "empresa" ? "empresa" : "departamento",
        scopeId: kpi.department === "empresa" ? undefined : kpi.department,
        value,
        target,
        attainment,
        status,
        computedAt: m === 0 ? daysAgo(0, 6) : dayInCompetence(competence(m + 1), 1, 6),
        createdAt: m === 0 ? daysAgo(0, 6) : dayInCompetence(competence(m + 1), 1, 6),
      } satisfies SeedDoc<KpiSnapshot>);
    }
  }
}

function seedGoals(ctx: SeedContext): void {
  const { store, users } = ctx;
  const period = competence(0);
  const goals: (Omit<SeedDoc<Goal>, "period"> & { period?: string })[] = [
    { kpiKey: "novas_vendas", scope: "usuario", scopeId: users.igor.id, target: 6, weight: 3 },
    { kpiKey: "novas_vendas", scope: "usuario", scopeId: users.vinicius.id, target: 5, weight: 3 },
    { kpiKey: "ticket_medio", scope: "usuario", scopeId: users.igor.id, target: 350, weight: 1 },
    { kpiKey: "ticket_medio", scope: "usuario", scopeId: users.vinicius.id, target: 350, weight: 1 },
    { kpiKey: "novas_vendas", scope: "departamento", scopeId: "vendas", target: 12, weight: 3 },
    { kpiKey: "conversao_funil", scope: "departamento", scopeId: "vendas", target: 0.2, weight: 2 },
    { kpiKey: "leads_captados", scope: "departamento", scopeId: "marketing", target: 220, weight: 2 },
    { kpiKey: "mqls", scope: "departamento", scopeId: "marketing", target: 80, weight: 3 },
    { kpiKey: "inadimplencia", scope: "departamento", scopeId: "financeiro", target: 0.04, weight: 3 },
    { kpiKey: "entregas_prazo", scope: "departamento", scopeId: "implantacao", target: 0.9, weight: 3 },
    { kpiKey: "sla_solucao", scope: "departamento", scopeId: "suporte", target: 0.9, weight: 3 },
    { kpiKey: "csat", scope: "departamento", scopeId: "suporte", target: 8.5, weight: 3 },
    { kpiKey: "saude_cliente", scope: "departamento", scopeId: "cs", target: 85, weight: 3 },
    { kpiKey: "taxa_renovacao", scope: "departamento", scopeId: "cs", target: 0.9, weight: 2 },
    { kpiKey: "mrr", scope: "empresa", target: 450000, weight: 3 },
    { kpiKey: "churn", scope: "empresa", target: 0.03, weight: 3 },
  ];
  goals.forEach((g, i) => store.add(COLLECTIONS.goals, id("goal", i + 1), { ...g, period, createdAt: dayInCompetence(period, 1) } satisfies SeedDoc<Goal>));
}

function seedCommissions(ctx: SeedContext): void {
  const { store } = ctx;
  let seq = 0;
  const RULES = { setup: { id: "comm_rule_setup", pct: 25 }, recorrencia: { id: "comm_rule_recorrencia", pct: 100 }, hardware: { id: "comm_rule_hardware", pct: 2.5 } } as const;
  for (const opp of ctx.opportunities.filter((o) => o.stage === "ganho")) {
    const contract = ctx.contracts.find((c) => c.id === opp.contractId);
    const released = contract?.status === "liberado";
    const comp = competence(0, new Date(opp.wonAt!));
    for (const p of opp.products) {
      const lines: { type: Commission["revenueType"]; base: number }[] = [
        { type: "setup", base: p.setupValue },
        { type: "recorrencia", base: p.monthlyValue },
        { type: "hardware", base: p.hardwareValue },
      ];
      for (const line of lines) {
        if (line.base <= 0) continue;
        seq += 1;
        const rule = RULES[line.type];
        const releaseAt = line.type === "recorrencia" ? addDays(contract?.startDate ?? opp.wonAt!, 90) : released ? contract!.releasedAt : undefined;
        const status: Commission["status"] = line.type === "recorrencia" ? "prevista" : released ? "liberada" : "prevista";
        store.add(COLLECTIONS.commissions, id("commission", seq), {
          userId: opp.ownerId,
          clientId: opp.clientId,
          contractId: opp.contractId,
          opportunityId: opp.id,
          productId: p.productId,
          revenueType: line.type,
          baseAmount: line.base,
          amount: Number(((line.base * rule.pct) / 100).toFixed(2)),
          competence: comp,
          status,
          releaseAt,
          ruleId: rule.id,
          createdAt: opp.wonAt!,
        } satisfies SeedDoc<Commission>);
      }
    }
  }
}

function tierFor(att: number): { label: string; payoutPct: number } {
  if (att >= 1) return { label: "Meta batida", payoutPct: 100 };
  if (att >= 0.9) return { label: "90–99%", payoutPct: 70 };
  if (att >= 0.8) return { label: "80–89%", payoutPct: 40 };
  return { label: "Abaixo de 80%", payoutPct: 0 };
}

function seedBonus(ctx: SeedContext): void {
  const { store, users } = ctx;
  const period = competence(-1);
  const plan: { user: UserKey; rule: string; individual: number; collective: number; extras: number; salary: number }[] = [
    { user: "rafael", rule: "bonus_rule_suporte", individual: 1.02, collective: 0.94, extras: 100, salary: 2800 },
    { user: "larissa", rule: "bonus_rule_suporte", individual: 0.93, collective: 0.94, extras: 0, salary: 3400 },
    { user: "marcos", rule: "bonus_rule_implantacao", individual: 0.87, collective: 0.91, extras: 0, salary: 3200 },
    { user: "bruno", rule: "bonus_rule_implantacao", individual: 0.96, collective: 0.91, extras: 0, salary: 3200 },
  ];
  plan.forEach((b, i) => {
    const overall = Number((b.individual * 0.6 + b.collective * 0.4).toFixed(3));
    const tier = tierFor(overall);
    store.add(COLLECTIONS.bonusResults, id("bonus", i + 1), {
      userId: users[b.user].id,
      ruleId: b.rule,
      period,
      individualAttainment: b.individual,
      collectiveAttainment: b.collective,
      overallAttainment: overall,
      tierLabel: tier.label,
      payoutPct: tier.payoutPct,
      projectedAmount: Number(((b.salary * 0.2 * tier.payoutPct) / 100).toFixed(2)),
      blocked: false,
      extrasAmount: b.extras,
      createdAt: dayInCompetence(competence(0), 2, 8),
    } satisfies SeedDoc<BonusResult>);
  });
}

function seedGamification(ctx: SeedContext): void {
  const { store, users } = ctx;
  const period = competence(0);
  const REASONS: Record<string, string[]> = {
    vendas: ["Proposta enviada dentro do prazo", "Negócio ganho", "Follow-up em dia a semana toda"],
    marketing: ["Lead qualificado em menos de 24h", "Campanha publicada no prazo"],
    financeiro: ["Contrato liberado em menos de 1 dia útil", "Cobranças do mês emitidas no prazo"],
    implantacao: ["Go-live no prazo", "Treinamento com avaliação 10", "Checklist concluído sem pendências"],
    cs: ["Checkpoint realizado no prazo", "Plano de sucesso concluído", "Renovação fechada"],
    suporte: ["Chamado resolvido dentro do SLA", "CSAT 10 recebido", "Artigo publicado na base de conhecimento"],
    diretoria: ["Revisão semanal concluída"],
    administrativo: ["Rotina concluída no prazo"],
  };
  let seq = 0;
  for (const u of Object.values(users)) {
    const reasons = REASONS[u.departmentId] ?? REASONS.administrativo;
    const count = rng.int(2, 4);
    for (let i = 0; i < count; i++) {
      seq += 1;
      store.add(COLLECTIONS.gamificationPoints, id("gp", seq), {
        userId: u.id,
        points: rng.pick([10, 15, 20, 25, 50]),
        reason: rng.pick(reasons),
        sourceType: u.departmentId === "suporte" ? "ticket" : u.departmentId === "vendas" ? "opportunity" : "task",
        period,
        createdAt: daysAgo(rng.int(0, 20), rng.int(9, 17)),
      } satisfies SeedDoc<GamificationPoints>);
    }
  }
  const achievements: { user: UserKey; key: string; name: string; description: string; icon: string }[] = [
    { user: "igor", key: "meta_setup_mes", name: "Meta de adesão batida", description: "Bateu a meta mensal de adesão/setup.", icon: "Trophy" },
    { user: "vinicius", key: "primeira_venda_pacote", name: "Vendedor de pacote", description: "Fechou ERP + TEF + maquininha em uma única venda.", icon: "Package" },
    { user: "rafael", key: "sla_100", name: "SLA 100%", description: "Uma semana inteira com todos os chamados dentro do SLA.", icon: "Timer" },
    { user: "rafael", key: "caçador_upsell", name: "Caçador de upsell", description: "Gerou 2 oportunidades válidas para vendas.", icon: "TrendingUp" },
    { user: "larissa", key: "csat_10", name: "Nota 10", description: "Recebeu 5 avaliações 10 no mês.", icon: "Star" },
    { user: "bruno", key: "golive_prazo", name: "Go-live no prazo", description: "3 implantações seguidas entregues no prazo.", icon: "Rocket" },
    { user: "marcos", key: "treinador", name: "Treinador", description: "10 treinamentos realizados.", icon: "GraduationCap" },
    { user: "camila", key: "carteira_saudavel", name: "Carteira saudável", description: "Saúde média da carteira acima de 85.", icon: "HeartPulse" },
    { user: "felipe", key: "renovacao_100", name: "Renovação 100%", description: "Todas as renovações do trimestre fechadas.", icon: "RefreshCw" },
    { user: "anapaula", key: "inadimplencia_zero", name: "Inadimplência controlada", description: "Inadimplência abaixo de 4% no mês.", icon: "Wallet" },
    { user: "luciano", key: "lead_relampago", name: "Lead relâmpago", description: "Qualificou um lead em menos de 1 hora.", icon: "Zap" },
  ];
  achievements.forEach((a, i) => {
    const unlockedAt = daysAgo(rng.int(1, 60), rng.int(9, 17));
    store.add(COLLECTIONS.achievements, id("ach", i + 1), { userId: users[a.user].id, key: a.key, name: a.name, description: a.description, icon: a.icon, unlockedAt, createdAt: unlockedAt } satisfies SeedDoc<Achievement>);
  });
}

export async function seedPerformance(ctx: SeedContext): Promise<void> {
  seedSnapshots(ctx);
  seedGoals(ctx);
  seedCommissions(ctx);
  seedBonus(ctx);
  seedGamification(ctx);
}
