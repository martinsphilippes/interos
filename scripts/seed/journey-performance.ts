/**
 * Performance: fotografias dos indicadores de estado (meses anteriores), metas do mês atual e do anterior
 * (por colaborador conforme a função, por departamento e da empresa), comissões das vendas ganhas,
 * bloqueios de bônus de exemplo, campanhas de gamificação, pontos derivados dos eventos do seed e medalhas.
 *
 * Os snapshots dos indicadores de fluxo/taxa e o fechamento do bônus da competência anterior são calculados
 * pelo próprio motor depois da gravação (scripts/seed/derived.ts), para ficarem coerentes com os dados.
 */
import {
  COLLECTIONS,
  type Achievement,
  type BonusBlock,
  type Commission,
  type DomainEvent,
  type GamificationCampaign,
  type GamificationPoints,
  type Goal,
  type KpiSnapshot,
  type Lead,
} from "../../src/domain/types";
import type { DepartmentKey } from "../../src/domain/constants";
import { ACHIEVEMENT_DEFS, DEFAULT_GAMIFICATION, POINT_RULES, type AchievementKey } from "../../src/server/performance/schemas";
import { goalDocId } from "../../src/server/kpis/schemas";
import { addDays, competence, dayInCompetence, daysAgo, id, rng, type SeedDoc } from "./lib";
import type { SeedContext, UserKey } from "./context";
import { KPI_TARGETS } from "./kpis";

/** Dia local (America/Sao_Paulo, UTC-3) de um instante ISO. */
function localDay(iso: string): string {
  return new Date(Date.parse(iso) - 3 * 3600_000).toISOString().slice(0, 10);
}

/** Primeiro instante (meia-noite de SP) de uma competência AAAA-MM. */
function monthStart(comp: string): string {
  return `${comp}-01T03:00:00.000Z`;
}

function snapshotId(kpiKey: string, period: string, scope: KpiSnapshot["scope"], scopeId?: string): string {
  return `snap_${kpiKey}_${period}_${scope}_${scopeId ?? "org"}`;
}

/**
 * Indicadores de estado que o motor não reconstrói no passado (fotografia do momento): o seed grava a
 * fotografia dos meses anteriores na escala da operação atual. Os demais indicadores são gravados pelo
 * motor a partir dos dados (derived.ts).
 */
const STATE_SERIES: Record<string, { department: DepartmentKey; from: number; to: number; decimals: number }> = {
  saude_cliente: { department: "cs", from: 79, to: 76, decimals: 1 },
  clientes_risco: { department: "cs", from: 1, to: 3, decimals: 0 },
  adocao_media: { department: "cs", from: 0.64, to: 0.7, decimals: 3 },
  csat_cs: { department: "cs", from: 8.6, to: 8.3, decimals: 2 },
  followups_atrasados: { department: "vendas", from: 2, to: 4, decimals: 0 },
  oportunidades_paradas: { department: "vendas", from: 1, to: 2, decimals: 0 },
};

function seedStateSnapshots(ctx: SeedContext): void {
  const { store } = ctx;
  for (const [key, spec] of Object.entries(STATE_SERIES)) {
    const goal = KPI_TARGETS[key]?.target;
    const lowerIsBetter = ["clientes_risco", "followups_atrasados", "oportunidades_paradas"].includes(key);
    for (let m = -7; m <= -1; m++) {
      const t = (m + 7) / 6;
      const noise = Math.abs(spec.to - spec.from || 1) * rng.float(-0.15, 0.15, 4);
      const value = Math.max(0, Number((spec.from + (spec.to - spec.from) * t + noise).toFixed(spec.decimals)));
      const attainment = goal ? Number((lowerIsBetter ? (value === 0 ? 2 : Math.min(2, goal / value)) : value / goal).toFixed(3)) : undefined;
      const status = attainment === undefined ? undefined : attainment >= 1 ? "atingida" : attainment >= 0.85 ? "atencao" : "critico";
      const period = competence(m);
      const at = dayInCompetence(competence(m + 1), 1, 6);
      for (const [scope, scopeId] of [["empresa", undefined], ["departamento", spec.department]] as const) {
        store.add(COLLECTIONS.kpiSnapshots, snapshotId(key, period, scope, scopeId), {
          kpiKey: key,
          period,
          scope,
          scopeId,
          value,
          target: goal,
          attainment,
          status,
          computedAt: at,
          createdAt: at,
        } satisfies SeedDoc<KpiSnapshot>);
      }
    }
  }
}

type GoalSpec = { kpiKey: string; target: number; weight: number };

/** Metas por função (escopo usuário). */
const ROLE_GOALS: Partial<Record<DepartmentKey, GoalSpec[]>> = {
  vendas: [
    { kpiKey: "novas_vendas", target: 3, weight: 3 },
    { kpiKey: "setup_vendido", target: 5000, weight: 2 },
    { kpiKey: "recorrencia_vendida", target: 1200, weight: 2 },
    { kpiKey: "hardware_vendido", target: 1500, weight: 1 },
    { kpiKey: "ticket_medio", target: 350, weight: 1 },
  ],
  suporte: [
    { kpiKey: "sla_resposta", target: 0.95, weight: 3 },
    { kpiKey: "sla_solucao", target: 0.9, weight: 3 },
    { kpiKey: "csat", target: 8.5, weight: 3 },
    { kpiKey: "chamados_resolvidos", target: 12, weight: 1 },
    { kpiKey: "oportunidades_suporte", target: 1, weight: 1 },
  ],
  implantacao: [
    { kpiKey: "entregas_prazo", target: 0.9, weight: 3 },
    { kpiKey: "ativacao_7_dias", target: 0.8, weight: 3 },
    { kpiKey: "chamados_30_dias", target: 2, weight: 2 },
  ],
  cs: [
    { kpiKey: "saude_cliente", target: 80, weight: 3 },
    { kpiKey: "taxa_renovacao", target: 0.9, weight: 2 },
  ],
  marketing: [
    { kpiKey: "leads_captados", target: 15, weight: 2 },
    { kpiKey: "mqls", target: 4, weight: 3 },
  ],
  financeiro: [
    { kpiKey: "inadimplencia", target: 0.04, weight: 3 },
    { kpiKey: "tempo_liberacao_dias", target: 2, weight: 1 },
  ],
};

/** Colaboradores com metas pessoais (gestores de área mista, como Lando, ficam com as metas do departamento). */
const GOAL_USERS: UserKey[] = ["vinicius", "igor", "rafael", "larissa", "marcos", "bruno", "camila", "felipe", "luciano", "mateus", "anapaula", "karem"];

const DEPARTMENT_GOALS: { scope: Goal["scope"]; scopeId?: string; goals: GoalSpec[] }[] = [
  { scope: "departamento", scopeId: "marketing", goals: [{ kpiKey: "leads_captados", target: 30, weight: 2 }, { kpiKey: "mqls", target: 8, weight: 3 }] },
  { scope: "departamento", scopeId: "vendas", goals: [{ kpiKey: "novas_vendas", target: 6, weight: 3 }, { kpiKey: "receita_vendida", target: 12000, weight: 3 }, { kpiKey: "conversao_funil", target: 0.2, weight: 2 }] },
  { scope: "departamento", scopeId: "financeiro", goals: [{ kpiKey: "inadimplencia", target: 0.04, weight: 3 }, { kpiKey: "faturamento", target: 35000, weight: 2 }] },
  { scope: "departamento", scopeId: "implantacao", goals: [{ kpiKey: "entregas_prazo", target: 0.9, weight: 3 }, { kpiKey: "ativacao_7_dias", target: 0.8, weight: 3 }] },
  { scope: "departamento", scopeId: "cs", goals: [{ kpiKey: "saude_cliente", target: 80, weight: 3 }, { kpiKey: "taxa_renovacao", target: 0.9, weight: 2 }] },
  { scope: "departamento", scopeId: "suporte", goals: [{ kpiKey: "sla_resposta", target: 0.95, weight: 2 }, { kpiKey: "sla_solucao", target: 0.9, weight: 3 }, { kpiKey: "csat", target: 8.5, weight: 3 }] },
  { scope: "empresa", goals: [{ kpiKey: "mrr", target: 18000, weight: 3 }, { kpiKey: "churn", target: 0.03, weight: 3 }, { kpiKey: "receita_vendida", target: 12000, weight: 2 }] },
];

function seedGoals(ctx: SeedContext): void {
  const { store, users } = ctx;
  for (const offset of [-1, 0]) {
    const period = competence(offset);
    const createdAt = dayInCompetence(period, 1);
    const add = (scope: Goal["scope"], scopeId: string | undefined, g: GoalSpec) =>
      store.add(COLLECTIONS.goals, goalDocId(g.kpiKey, period, scope, scopeId), { kpiKey: g.kpiKey, scope, scopeId, period, target: g.target, weight: g.weight, createdAt } satisfies SeedDoc<Goal>);
    for (const key of GOAL_USERS) {
      const user = users[key];
      for (const g of ROLE_GOALS[user.departmentId] ?? []) add("usuario", user.id, g);
    }
    for (const d of DEPARTMENT_GOALS) for (const g of d.goals) add(d.scope, d.scopeId, g);
  }
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

function seedBonusBlocks(ctx: SeedContext): void {
  const { store, users } = ctx;
  const period = competence(0);
  const blocks: (SeedDoc<BonusBlock> & { id: string })[] = [
    {
      id: "bonus_block_001",
      userId: users.bruno.id,
      period,
      blockerKey: "escopo_divergente",
      reason: "Implantação entregue com módulo de estoque fora do escopo contratado; cliente abriu reclamação.",
      responsibleId: users.lando.id,
      evidence: "Ata de aceite x proposta comercial",
      notes: "Aguardando reunião com o cliente para confirmar a divergência.",
      status: "aberto",
      createdAt: daysAgo(3, 11),
    },
    {
      id: "bonus_block_002",
      userId: users.marcos.id,
      period,
      blockerKey: "descumprimento_manual",
      reason: "Configuração fiscal feita fora do manual técnico.",
      responsibleId: users.lando.id,
      evidence: "Checklist de configuração",
      notes: "Revogado: o manual estava desatualizado e foi corrigido.",
      status: "revogado",
      createdAt: daysAgo(9, 15),
      updatedAt: daysAgo(6, 10),
    },
  ];
  for (const { id: docId, ...b } of blocks) store.add(COLLECTIONS.bonusBlocks, docId, b);
}

function seedCampaigns(ctx: SeedContext): void {
  const { store, users } = ctx;
  const period = competence(0);
  const next = competence(1);
  const lastDay = new Date(Date.parse(`${next}-01T12:00:00Z`) - 86400_000).toISOString().slice(0, 10);
  const campaigns: (SeedDoc<GamificationCampaign> & { id: string })[] = [
    {
      id: "gcamp_001",
      name: "Maratona de propostas",
      description: "Quem enviar 5 propostas no mês ganha um vale-jantar para dois.",
      startDate: monthStart(period),
      endDate: `${lastDay}T03:00:00.000Z`,
      departments: ["vendas"],
      metric: { kind: "evento", eventType: "proposal.sent" },
      target: 5,
      prize: "Vale-jantar para dois",
      participantIds: [],
      status: "ativa",
      ownerId: users.igor.id,
    },
    {
      id: "gcamp_002",
      name: "Desafio SLA",
      description: "SLA de solução acima de 90% no mês garante folga no dia seguinte ao fechamento.",
      startDate: monthStart(period),
      endDate: `${lastDay}T03:00:00.000Z`,
      departments: ["suporte"],
      metric: { kind: "kpi", kpiKey: "sla_solucao" },
      target: 0.9,
      prize: "Folga no primeiro dia útil do mês seguinte",
      participantIds: [],
      status: "ativa",
      ownerId: users.lando.id,
    },
  ];
  for (const { id: docId, ...c } of campaigns) store.add(COLLECTIONS.gamificationCampaigns, docId, { ...c, createdAt: dayInCompetence(period, 1, 8) });
}

/**
 * Pontos derivados dos eventos do seed com as mesmas regras do módulo de gamificação (valores do setting
 * "gamificacao" padrão) e o mesmo ID idempotente gp_<eventId>_<userId>; medalhas conquistadas pelos dados.
 */
function seedGamification(ctx: SeedContext): void {
  const { store } = ctx;
  const events = store.all<DomainEvent>(COLLECTIONS.events).sort((a, b) => (a.occurredAt < b.occurredAt ? -1 : 1));
  const tasks = new Map(ctx.tasks.map((t) => [t.id, t]));
  const projects = new Map(ctx.projects.map((p) => [p.id, p]));
  const leads = new Map(store.all<Lead>(COLLECTIONS.leads).map((l) => [l.id, l]));
  const userIds = new Set(Object.values(ctx.users).map((u) => u.id));
  const str = (v: unknown) => (typeof v === "string" && v.length > 0 ? v : undefined);
  const ruleFor = (e: DomainEvent): { userId?: string; ruleKey: string } | null => {
    const p = e.payload ?? {};
    switch (e.type) {
      case "task.completed": {
        const task = e.entityId ? tasks.get(e.entityId) : undefined;
        const late = Boolean(task?.dueAt && task.completedAt && task.completedAt > task.dueAt);
        return { userId: str(p.assigneeId) ?? task?.assigneeId ?? e.actorId, ruleKey: late ? "tarefa_atrasada" : "tarefa_no_prazo" };
      }
      case "support.ticket.resolved":
        return p.withinSla === true ? { userId: str(p.assigneeId) ?? e.actorId, ruleKey: "chamado_no_sla" } : null;
      case "support.csat.received":
        return Number(p.score) === 10 ? { userId: str(p.attendantId), ruleKey: "csat_10" } : null;
      case "opportunity.won":
        return { userId: str(p.ownerId) ?? e.actorId, ruleKey: "venda_ganha" };
      case "proposal.sent":
        return { userId: str(p.ownerId) ?? e.actorId, ruleKey: "proposta_enviada" };
      case "lead.qualified": {
        const lead = e.entityId ? leads.get(e.entityId) : undefined;
        return { userId: lead?.ownerId ?? e.actorId, ruleKey: "lead_qualificado" };
      }
      case "implementation.go_live": {
        if (p.onTime !== true) return null;
        const project = e.entityId ? projects.get(e.entityId) : undefined;
        return { userId: project?.ownerId, ruleKey: "go_live_no_prazo" };
      }
      case "customer.checkpoint.completed":
        return { userId: e.actorId, ruleKey: "checkpoint_cs" };
      case "upsell.created":
        return { userId: str(p.originUserId) ?? e.actorId, ruleKey: "upsell_gerado" };
      default:
        return null;
    }
  };

  const slaCount = new Map<string, number>();
  const unlocked = new Map<string, Omit<SeedDoc<Achievement>, "unlockedAt"> & { unlockedAt: string }>();
  const unlock = (userId: string, key: AchievementKey, at: string) => {
    const docId = `ach_${key}_${userId}`;
    if (unlocked.has(docId)) return;
    const def = ACHIEVEMENT_DEFS[key];
    unlocked.set(docId, { userId, key, name: def.name, description: def.description, icon: def.icon, unlockedAt: at, createdAt: at });
  };

  for (const e of events) {
    const match = ruleFor(e);
    if (!match?.userId || !userIds.has(match.userId)) continue;
    const points = DEFAULT_GAMIFICATION.pontos[match.ruleKey] ?? 0;
    if (points <= 0) continue;
    const label = POINT_RULES.find((r) => r.key === match.ruleKey)?.label ?? match.ruleKey;
    const title = e.title.length > 140 ? `${e.title.slice(0, 137)}…` : e.title;
    store.add(COLLECTIONS.gamificationPoints, `gp_${e.id}_${match.userId}`, {
      userId: match.userId,
      points,
      reason: `${label} · ${title}`,
      sourceType: e.type,
      sourceId: e.entityId ?? e.id,
      period: localDay(e.occurredAt).slice(0, 7),
      createdAt: e.occurredAt,
    } satisfies SeedDoc<GamificationPoints>);
    // Medalhas que os próprios dados conquistam.
    if (match.ruleKey === "venda_ganha") unlock(match.userId, "primeira_venda", e.occurredAt);
    if (match.ruleKey === "csat_10") unlock(match.userId, "csat_perfeito", e.occurredAt);
    if (match.ruleKey === "chamado_no_sla") {
      const n = (slaCount.get(match.userId) ?? 0) + 1;
      slaCount.set(match.userId, n);
      if (n === 10) unlock(match.userId, "chamados_sla_10", e.occurredAt);
    }
    if (e.type === "implementation.go_live") {
      const start = str(e.payload?.startDate);
      if (start && Date.parse(e.occurredAt) - Date.parse(start) <= 7 * 86400_000) unlock(match.userId, "golive_relampago", e.occurredAt);
    }
  }
  for (const [docId, a] of unlocked) store.add(COLLECTIONS.achievements, docId, a);
}

export async function seedPerformance(ctx: SeedContext): Promise<void> {
  seedStateSnapshots(ctx);
  seedGoals(ctx);
  seedCommissions(ctx);
  seedBonusBlocks(ctx);
  seedCampaigns(ctx);
  seedGamification(ctx);
}
