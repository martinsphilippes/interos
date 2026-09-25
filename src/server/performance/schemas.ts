/**
 * Performance (Meu Desempenho, Bônus, Ranking, Gamificação): validação (zod), rótulos, padrões de
 * configuração e a matemática pura do bônus (faixas, média ponderada, simulação).
 *
 * Módulo puro (sem Firestore): usado pelas Server Actions, pelo motor de bônus no servidor e pelos
 * Client Components (simulador, editor de regras), para que o número simulado seja o mesmo do cálculo real.
 */
import { z } from "zod";
import { DEPARTMENT_KEYS, EVENT_TYPES, type DepartmentKey, type EventType } from "@/domain/constants";
import type { BonusBlock, BonusRule, GamificationCampaign, KpiDirection } from "@/domain/types";
import { computeAttainment } from "@/server/kpis/attainment";

export { zodMessage } from "@/server/kpis/schemas";

// ---------------------------------------------------------------------------
// Bônus: matemática pura
// ---------------------------------------------------------------------------

export type BonusTier = BonusRule["tiers"][number];

/**
 * Atingimento de um indicador contra a meta da regra de bônus: delega a `computeAttainment` do motor
 * de indicadores (src/server/kpis/attainment.ts): maior_melhor = valor/meta; menor_melhor = meta/valor (limitado
 * a 2; valor ≤ 0 conta 2); faixa = 1 dentro de meta ± 10%, proporcional fora. Usada pelo simulador no navegador.
 */
export function attainmentAgainst(value: number | null, direction: KpiDirection, target: number): number | null {
  if (value === null || !Number.isFinite(value)) return null;
  return computeAttainment(value, direction, target);
}

/** Média ponderada com cada atingimento limitado a 100%. Itens sem dado (null) não entram. null se nada contou. */
export function weightedAttainment(items: { weight: number; attainment: number | null }[]): number | null {
  const scored = items.filter((i) => i.attainment !== null && i.weight > 0);
  const weight = scored.reduce((s, i) => s + i.weight, 0);
  if (weight <= 0) return null;
  return scored.reduce((s, i) => s + i.weight * Math.min(1, i.attainment as number), 0) / weight;
}

/**
 * Atingimento geral: individual × peso individual + coletivo × peso coletivo, com os pesos normalizados
 * (60/40 → 0,6/0,4). Bloco null só é ignorado quando o seu peso é zero; o motor de bônus trata antes o caso
 * de um bloco com peso sem nenhum dado (apuração incompleta).
 */
export function combineAttainment(individual: number | null, collective: number | null, individualWeight: number, collectiveWeight: number): { overall: number | null; wInd: number; wCol: number } {
  const wi = individual === null ? 0 : Math.max(0, individualWeight);
  const wc = collective === null ? 0 : Math.max(0, collectiveWeight);
  const total = wi + wc;
  if (total <= 0) return { overall: null, wInd: 0, wCol: 0 };
  return { overall: ((individual ?? 0) * wi + (collective ?? 0) * wc) / total, wInd: wi / total, wCol: wc / total };
}

/** Faixas ordenadas da maior para a menor exigência. */
export function sortTiers(tiers: BonusTier[]): BonusTier[] {
  return [...tiers].sort((a, b) => b.minAttainment - a.minAttainment);
}

/** Arredonda para 4 casas antes de comparar com as faixas (evita 0,8999999 cair na faixa de baixo). */
function round4(value: number): number {
  return Math.round(value * 10_000) / 10_000;
}

/** Faixa alcançada pelo atingimento geral e a próxima faixa acima (com quanto falta, em pontos de fração). */
export function resolveTier(tiers: BonusTier[], overall: number | null): { current: BonusTier | null; next: (BonusTier & { gap: number }) | null } {
  const sorted = sortTiers(tiers);
  if (overall === null) return { current: null, next: null };
  const value = round4(overall);
  const index = sorted.findIndex((t) => value >= t.minAttainment);
  const current = index >= 0 ? sorted[index] : null;
  const nextTier = index === -1 ? sorted[sorted.length - 1] : index > 0 ? sorted[index - 1] : null;
  return { current, next: nextTier ? { ...nextTier, gap: Math.max(0, nextTier.minAttainment - value) } : null };
}

/** Valor do bônus: salário × % máx. do salário × % de pagamento da faixa. */
export function bonusAmount(salary: number | null, maxPctOfSalary: number, payoutPct: number): number | null {
  if (salary === null) return null;
  return Math.round(salary * (maxPctOfSalary / 100) * (payoutPct / 100) * 100) / 100;
}

// ---------------------------------------------------------------------------
// Bônus: validação
// ---------------------------------------------------------------------------

export const periodKeySchema = z.string().regex(/^\d{4}-(0[1-9]|1[0-2])$/, "Informe a competência no formato AAAA-MM");

export const BLOCK_STATUS_LABELS: Record<BonusBlock["status"], string> = { aberto: "Aberto (em análise)", confirmado: "Confirmado", revogado: "Revogado" };
export const BLOCK_STATUS_TONES: Record<BonusBlock["status"], "warning" | "danger" | "muted"> = { aberto: "warning", confirmado: "danger", revogado: "muted" };

export const bonusBlockInputSchema = z.object({
  userId: z.string().trim().min(1, "Escolha o colaborador"),
  period: periodKeySchema,
  blockerKey: z.string().trim().min(1, "Escolha o bloqueador"),
  reason: z.string().trim().min(10, "Descreva o motivo (mín. 10 caracteres)").max(1000, "Motivo muito longo (máx. 1000)"),
  evidence: z.string().trim().max(1000, "Evidência muito longa (máx. 1000)").optional(),
  notes: z.string().trim().max(1000, "Observação muito longa (máx. 1000)").optional(),
});
export type BonusBlockInput = z.input<typeof bonusBlockInputSchema>;

export const bonusBlockDecisionSchema = z.object({
  id: z.string().trim().min(1, "Bloqueio inválido"),
  note: z.string().trim().max(500, "Justificativa muito longa (máx. 500)").optional(),
});

export const closePeriodSchema = z.object({ period: periodKeySchema });

const kpiLineSchema = z.object({
  kpiKey: z.string().trim().min(1, "Escolha o indicador"),
  weight: z.number("Informe o peso").positive("O peso deve ser maior que zero").max(100, "Peso máximo é 100"),
  target: z.number("Informe a meta"),
});

const keySchema = z
  .string()
  .trim()
  .min(2, "Chave muito curta")
  .max(60, "Chave muito longa (máx. 60)")
  .regex(/^[a-z0-9_]+$/, "Use apenas letras minúsculas, números e _ na chave");

export const bonusRuleInputSchema = z
  .object({
    /** Regra da qual esta é uma nova versão (opcional). */
    baseRuleId: z.string().trim().optional(),
    name: z.string().trim().min(3, "Nome muito curto").max(120, "Nome muito longo (máx. 120)"),
    department: z.enum(DEPARTMENT_KEYS, { message: "Departamento inválido" }),
    maxPctOfSalary: z.number("Informe o % do salário").min(0, "Percentual inválido").max(100, "Máximo de 100% do salário"),
    individualWeight: z.number("Informe o peso individual").min(0, "Peso inválido").max(100, "Peso máximo é 100"),
    collectiveWeight: z.number("Informe o peso coletivo").min(0, "Peso inválido").max(100, "Peso máximo é 100"),
    individualKpis: z.array(kpiLineSchema).max(12, "Máximo de 12 indicadores"),
    collectiveKpis: z.array(kpiLineSchema).max(12, "Máximo de 12 indicadores"),
    tiers: z
      .array(
        z.object({
          minAttainment: z.number("Informe o atingimento mínimo").min(0, "Atingimento inválido").max(3, "Atingimento máximo é 300%"),
          payoutPct: z.number("Informe o pagamento").min(0, "Pagamento inválido").max(200, "Pagamento máximo é 200%"),
          label: z.string().trim().min(1, "Informe o rótulo da faixa").max(60, "Rótulo muito longo"),
        }),
      )
      .min(1, "Cadastre ao menos uma faixa")
      .max(10, "Máximo de 10 faixas"),
    blockers: z.array(z.object({ key: keySchema, label: z.string().trim().min(3, "Rótulo do bloqueador muito curto").max(200, "Rótulo muito longo") })).max(12, "Máximo de 12 bloqueadores"),
    extras: z
      .array(
        z.object({
          key: keySchema,
          label: z.string().trim().min(3, "Rótulo do extra muito curto").max(200, "Rótulo muito longo"),
          amount: z.number("Informe o valor do extra").min(0, "Valor inválido"),
          unit: z.string().trim().min(1, "Informe a unidade").max(60, "Unidade muito longa"),
        }),
      )
      .max(8, "Máximo de 8 extras"),
  })
  .superRefine((data, ctx) => {
    if (data.individualKpis.length + data.collectiveKpis.length === 0) ctx.addIssue({ code: "custom", message: "Inclua ao menos um indicador", path: ["individualKpis"] });
    if (data.individualWeight + data.collectiveWeight <= 0) ctx.addIssue({ code: "custom", message: "A soma dos pesos individual e coletivo deve ser maior que zero", path: ["individualWeight"] });
    if (data.individualKpis.length === 0 && data.individualWeight > 0) ctx.addIssue({ code: "custom", message: "Há peso individual sem indicadores individuais", path: ["individualKpis"] });
    if (data.collectiveKpis.length === 0 && data.collectiveWeight > 0) ctx.addIssue({ code: "custom", message: "Há peso coletivo sem indicadores coletivos", path: ["collectiveKpis"] });
    const dup = (list: { kpiKey: string }[]) => list.find((k, i) => list.findIndex((x) => x.kpiKey === k.kpiKey) !== i);
    if (dup(data.individualKpis)) ctx.addIssue({ code: "custom", message: "Indicador individual repetido", path: ["individualKpis"] });
    if (dup(data.collectiveKpis)) ctx.addIssue({ code: "custom", message: "Indicador coletivo repetido", path: ["collectiveKpis"] });
    const mins = data.tiers.map((t) => t.minAttainment);
    if (new Set(mins).size !== mins.length) ctx.addIssue({ code: "custom", message: "Duas faixas com o mesmo atingimento mínimo", path: ["tiers"] });
    const keys = [...data.blockers.map((b) => b.key)];
    if (new Set(keys).size !== keys.length) ctx.addIssue({ code: "custom", message: "Chave de bloqueador repetida", path: ["blockers"] });
    const extraKeys = data.extras.map((e) => e.key);
    if (new Set(extraKeys).size !== extraKeys.length) ctx.addIssue({ code: "custom", message: "Chave de extra repetida", path: ["extras"] });
  });
export type BonusRuleInput = z.input<typeof bonusRuleInputSchema>;

/**
 * Extras com apuração automática. `upsell_suporte`: R$ X por oportunidade VÁLIDA originada pelo colaborador
 * (originUserId) e criada na competência. Válida = ganha, ou não descartada (perdida) em até 7 dias da criação.
 * Oportunidade aberta há menos de 7 dias conta como provisória (ainda pode ser descartada).
 */
export const AUTOMATIC_EXTRAS: Record<string, string> = {
  upsell_suporte: "Oportunidades válidas originadas por você na competência (ganhas, ou não descartadas em até 7 dias da criação).",
};
export const UPSELL_DISCARD_WINDOW_DAYS = 7;

// ---------------------------------------------------------------------------
// Prêmios de Vendas (setting "premios_vendas")
// ---------------------------------------------------------------------------

export interface SalesPrizeSettings {
  salarioMinimo: number;
  /** "1_salario" (N salários mínimos: "2_salarios") ou valor fixo em R$. */
  adesao: string | number;
  recorrencia: string | number;
  hardware: string | number;
}

export const DEFAULT_SALES_PRIZES: SalesPrizeSettings = { salarioMinimo: 1518, adesao: "1_salario", recorrencia: "1_salario", hardware: 500 };

/** Valor em R$ de um prêmio configurado ("1_salario" → 1 salário mínimo; número → valor fixo). */
export function prizeValue(spec: string | number, minimumWage: number): number {
  if (typeof spec === "number") return spec;
  const match = /^(\d+(?:[.,]\d+)?)_salari/.exec(spec);
  if (match) return Number(match[1].replace(",", ".")) * minimumWage;
  const n = Number(spec);
  return Number.isFinite(n) ? n : 0;
}

export function describePrize(spec: string | number): string {
  if (typeof spec === "string" && /_salari/.test(spec)) {
    const n = Number(spec.split("_")[0].replace(",", "."));
    return `${n} salário${n === 1 ? "" : "s"} mínimo${n === 1 ? "" : "s"}`;
  }
  return "valor fixo";
}

// ---------------------------------------------------------------------------
// Gamificação (setting "gamificacao")
// ---------------------------------------------------------------------------

export interface GamificationLevel {
  nome: string;
  minimo: number;
}

export interface GamificationSettings {
  /** Pontos por regra (chaves de POINT_RULES). */
  pontos: Record<string, number>;
  /** Multiplicador por departamento para comparar pessoas de funções diferentes ("todos normalizado"). */
  multiplicadores: Record<DepartmentKey, number>;
  niveis: GamificationLevel[];
}

export interface PointRule {
  key: string;
  event: EventType;
  label: string;
  /** Quem recebe os pontos. */
  who: string;
}

/** Regras de pontuação (os valores vêm do setting; aqui ficam o evento, a condição e quem recebe). */
export const POINT_RULES: PointRule[] = [
  { key: "tarefa_no_prazo", event: "task.completed", label: "Tarefa concluída no prazo (ou sem prazo)", who: "Responsável da tarefa" },
  { key: "tarefa_atrasada", event: "task.completed", label: "Tarefa concluída fora do prazo", who: "Responsável da tarefa" },
  { key: "chamado_no_sla", event: "support.ticket.resolved", label: "Chamado resolvido dentro do SLA", who: "Atendente do chamado" },
  { key: "csat_10", event: "support.csat.received", label: "Avaliação CSAT nota 10", who: "Atendente avaliado" },
  { key: "venda_ganha", event: "opportunity.won", label: "Negócio ganho", who: "Vendedor dono da oportunidade" },
  { key: "proposta_enviada", event: "proposal.sent", label: "Proposta enviada", who: "Dono da proposta" },
  { key: "lead_qualificado", event: "lead.qualified", label: "Lead qualificado (MQL)", who: "Dono do lead (ou quem qualificou)" },
  { key: "go_live_no_prazo", event: "implementation.go_live", label: "Go-live no prazo", who: "Responsável do projeto" },
  { key: "checkpoint_cs", event: "customer.checkpoint.completed", label: "Checkpoint de CS registrado", who: "Quem registrou o checkpoint" },
  { key: "upsell_gerado", event: "upsell.created", label: "Oportunidade de upsell/cross-sell gerada", who: "Quem originou a oportunidade" },
];

export const DEFAULT_GAMIFICATION: GamificationSettings = {
  pontos: {
    tarefa_no_prazo: 5,
    tarefa_atrasada: 1,
    chamado_no_sla: 10,
    csat_10: 5,
    venda_ganha: 50,
    proposta_enviada: 5,
    lead_qualificado: 10,
    go_live_no_prazo: 30,
    checkpoint_cs: 5,
    upsell_gerado: 15,
  },
  // Equivalência entre funções: quem pontua em eventos grandes e raros (venda +50) ou em alto volume
  // (chamados +10) tem o total reduzido; funções com poucos eventos pontuáveis, ampliado. Ajustável no setting.
  multiplicadores: { marketing: 1, vendas: 0.6, financeiro: 1.5, implantacao: 1, cs: 1.2, suporte: 0.8, administrativo: 1.5, diretoria: 1 },
  niveis: [
    { nome: "Bronze", minimo: 0 },
    { nome: "Prata", minimo: 500 },
    { nome: "Ouro", minimo: 1500 },
    { nome: "Platina", minimo: 3000 },
    { nome: "Diamante", minimo: 6000 },
  ],
};

/** Nível pelo total acumulado e o próximo nível (com quantos pontos faltam). */
export function levelFor(total: number, levels: GamificationLevel[]): { current: GamificationLevel; next: (GamificationLevel & { missing: number }) | null; progress: number } {
  const sorted = [...levels].sort((a, b) => a.minimo - b.minimo);
  let index = 0;
  sorted.forEach((l, i) => {
    if (total >= l.minimo) index = i;
  });
  const current = sorted[index] ?? { nome: "—", minimo: 0 };
  const next = sorted[index + 1];
  const progress = next ? Math.min(1, Math.max(0, (total - current.minimo) / (next.minimo - current.minimo))) : 1;
  return { current, next: next ? { ...next, missing: Math.max(0, next.minimo - total) } : null, progress };
}

/** Medalhas desbloqueadas automaticamente (achievements). */
export const ACHIEVEMENT_DEFS = {
  primeira_venda: { name: "Primeira venda", description: "Ganhou o primeiro negócio registrado no INTEROS.", icon: "Handshake" },
  chamados_sla_10: { name: "10 chamados no SLA", description: "Resolveu 10 chamados dentro do SLA.", icon: "Timer" },
  csat_perfeito: { name: "CSAT perfeito", description: "Recebeu uma avaliação nota 10 do cliente.", icon: "Star" },
  golive_relampago: { name: "Go-live relâmpago", description: "Levou uma implantação do início ao go-live em até 7 dias.", icon: "Rocket" },
  mes_100: { name: "Mês 100%", description: "Atingiu todas as metas do mês.", icon: "Trophy" },
  sequencia_5_dias: { name: "Sequência de 5 dias sem atraso", description: "Concluiu tarefas em 5 dias úteis seguidos sem nenhuma entrega fora do prazo.", icon: "Flame" },
} as const;
export type AchievementKey = keyof typeof ACHIEVEMENT_DEFS;

// ---------------------------------------------------------------------------
// Ranking
// ---------------------------------------------------------------------------

export const RANKING_SCOPES = ["individual", "equipe", "departamento"] as const;
export type RankingScope = (typeof RANKING_SCOPES)[number];
export const RANKING_SCOPE_LABELS: Record<RankingScope, string> = { individual: "Individual", equipe: "Equipes", departamento: "Departamentos" };

// ---------------------------------------------------------------------------
// Campanhas de gamificação
// ---------------------------------------------------------------------------

export const CAMPAIGN_STATUS_LABELS: Record<GamificationCampaign["status"], string> = { planejada: "Planejada", ativa: "Ativa", encerrada: "Encerrada" };
export const CAMPAIGN_STATUS_TONES: Record<GamificationCampaign["status"], "info" | "success" | "muted"> = { planejada: "info", ativa: "success", encerrada: "muted" };

const dayKeySchema = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Data inválida");

export const campaignInputSchema = z
  .object({
    id: z.string().trim().optional(),
    name: z.string().trim().min(3, "Nome muito curto").max(120, "Nome muito longo (máx. 120)"),
    description: z.string().trim().max(1000, "Descrição muito longa (máx. 1000)").optional(),
    startDate: dayKeySchema,
    endDate: dayKeySchema,
    departments: z.array(z.enum(DEPARTMENT_KEYS)).min(1, "Escolha ao menos um departamento"),
    metricKind: z.enum(["kpi", "evento"], { message: "Escolha o tipo de métrica" }),
    kpiKey: z.string().trim().optional(),
    eventType: z.string().trim().optional(),
    target: z.number("Informe a meta").positive("A meta deve ser maior que zero"),
    prize: z.string().trim().max(300, "Prêmio muito longo (máx. 300)").optional(),
    participantIds: z.array(z.string().trim().min(1)).max(200),
    status: z.enum(["planejada", "ativa", "encerrada"], { message: "Status inválido" }),
  })
  .superRefine((data, ctx) => {
    if (data.endDate < data.startDate) ctx.addIssue({ code: "custom", message: "O fim deve ser depois do início", path: ["endDate"] });
    if (data.metricKind === "kpi" && !data.kpiKey) ctx.addIssue({ code: "custom", message: "Escolha o indicador", path: ["kpiKey"] });
    if (data.metricKind === "evento" && !(EVENT_TYPES as readonly string[]).includes(data.eventType ?? "")) ctx.addIssue({ code: "custom", message: "Escolha o tipo de evento", path: ["eventType"] });
  });
export type CampaignInput = z.input<typeof campaignInputSchema>;

export const campaignIdSchema = z.object({ id: z.string().trim().min(1, "Campanha inválida") });

/** Eventos oferecidos como métrica de campanha (contagem no período, atribuída ao colaborador do evento). */
export const CAMPAIGN_EVENT_OPTIONS: { value: EventType; label: string }[] = [
  { value: "opportunity.won", label: "Negócios ganhos" },
  { value: "proposal.sent", label: "Propostas enviadas" },
  { value: "lead.qualified", label: "Leads qualificados" },
  { value: "task.completed", label: "Tarefas concluídas" },
  { value: "support.ticket.resolved", label: "Chamados resolvidos" },
  { value: "support.csat.received", label: "Avaliações CSAT recebidas" },
  { value: "implementation.go_live", label: "Go-lives" },
  { value: "customer.checkpoint.completed", label: "Checkpoints de CS" },
  { value: "upsell.created", label: "Oportunidades de upsell geradas" },
  { value: "visit.completed", label: "Visitas realizadas" },
  { value: "call.completed", label: "Ligações realizadas" },
];
