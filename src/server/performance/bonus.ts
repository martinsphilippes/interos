import "server-only";
/**
 * Motor de bônus (Suporte, Implantação, Financeiro e qualquer departamento com `bonus_rules` ativa).
 *
 * Cálculo de `computeBonus(userId, competência)`, na ordem em que a tela explica:
 * 1. Regra: a `bonus_rule` ativa de maior versão do departamento do colaborador.
 * 2. Indicadores individuais: valor pelo motor de KPIs (computeKpi/computeKpiBatch) no escopo "usuario";
 *    atingimento contra a META DA REGRA (mesma função de atingimento do motor). Coletivos: escopo
 *    "departamento" do departamento da regra; indicadores de outra área (ex.: churn da base) são apurados
 *    na empresa toda. Indicador sem dado (valor null) não entra no cálculo e aparece como "sem dados".
 * 3. Atingimento do bloco = Σ(peso × min(atingimento, 100%)) ÷ Σ(pesos com dado).
 * 4. Geral = individual × peso individual + coletivo × peso coletivo (pesos normalizados). Se um bloco com
 *    peso não tem NENHUM indicador com dado, a apuração fica incompleta (sem faixa): nunca se paga um bônus
 *    inteiro a partir de uma fração dos indicadores.
 * 5. Faixa pelos tiers da regra (padrão: 100% → 100%, 90–99% → 70%, 80–89% → 40%, < 80% → 0).
 * 6. Valor = salário base × % máx. do salário × % de pagamento da faixa. Salário: User.baseSalary; senão
 *    user.monthlyGoals.salarioBase; senão setting "salarios" { [userId]: valor }. Sem salário, o valor fica
 *    indisponível (nunca inventado).
 * 7. Extras (ex.: R$ 50 por oportunidade de upsell válida gerada pelo suporte).
 * 8. Bloqueio confirmado na competência (bonus_blocks) zera o mês inteiro, inclusive extras.
 */
import { batchSet, create, getById, getManyByIds, list, nowIso, ORG_ID, update } from "@/server/db";
import { emitEvent } from "@/server/events";
import { notify } from "@/server/notifications";
import { COLLECTIONS, type BonusBlock, type BonusResult, type BonusRule, type Opportunity, type Settings, type User, type UserRef } from "@/domain/types";
import { DEPARTMENT_LABELS, type DepartmentKey } from "@/domain/constants";
import { formatCurrency } from "@/lib/format";
import { computeAttainment, computeKpiBatch, kpiHref, listFormulas, monthPeriod, type KpiBatchRequest, type KpiResult, type KpiScope, type Period } from "@/server/kpis/queries";
import type { KpiUnit } from "@/server/kpis/schemas";
import {
  AUTOMATIC_EXTRAS,
  UPSELL_DISCARD_WINDOW_DAYS,
  bonusAmount,
  combineAttainment,
  resolveTier,
  weightedAttainment,
  type BonusBlockInput,
  type BonusTier,
} from "./schemas";

// ---------------------------------------------------------------------------
// Tipos
// ---------------------------------------------------------------------------

export interface BonusKpiLine {
  kpiKey: string;
  name: string;
  unit: KpiUnit;
  suffix?: string;
  direction: KpiResult["kpi"]["direction"];
  /** Peso configurado na regra. */
  weight: number;
  /** Meta da regra de bônus. */
  target: number;
  scope: KpiScope;
  scopeId?: string;
  scopeLabel: string;
  value: number | null;
  note?: string;
  /** Atingimento real (pode passar de 100%). */
  attainment: number | null;
  /** Atingimento considerado (limitado a 100%). */
  capped: number | null;
  /** Peso relativo dentro do bloco, entre os indicadores com dado. */
  share: number | null;
  /** Pontos de atingimento que este indicador soma ao bloco (share × capped). */
  contribution: number | null;
  href: string;
}

export interface BonusExtraItem {
  id: string;
  label: string;
  href: string;
  detail: string;
  status: "valida" | "provisoria" | "invalida";
}

export interface BonusExtraLine {
  key: string;
  label: string;
  amount: number;
  unit: string;
  automatic: boolean;
  /** Quantidade apurada (null = extra sem apuração automática). */
  quantity: number | null;
  /** Quantas ainda podem ser descartadas (entram no valor, mas podem sair). */
  provisional: number;
  total: number;
  items: BonusExtraItem[];
}

export interface BonusBlockView extends BonusBlock {
  userName: string;
  blockerLabel: string;
  responsibleName: string;
}

export interface BonusComputation {
  userId: string;
  userName: string;
  department: DepartmentKey;
  period: Period;
  rule: BonusRule | null;
  salary: number | null;
  salarySource: "cadastro" | "metas" | "configuracao" | null;
  individual: { attainment: number | null; lines: BonusKpiLine[] };
  collective: { attainment: number | null; lines: BonusKpiLine[] };
  /** Pesos efetivos (normalizados) de cada bloco no atingimento geral. */
  weights: { individual: number; collective: number };
  overallAttainment: number | null;
  tier: BonusTier | null;
  nextTier: (BonusTier & { gap: number }) | null;
  payoutPct: number;
  /** Salário × % máx. do salário (bônus com 100% de pagamento). */
  maxAmount: number | null;
  /** Valor da faixa antes de bloqueios. */
  tierAmount: number | null;
  extras: BonusExtraLine[];
  extrasAmount: number;
  blocked: boolean;
  blocks: BonusBlockView[];
  pendingBlocks: BonusBlockView[];
  /** Valor da faixa considerando bloqueio (0 quando bloqueado). */
  projectedAmount: number | null;
  /** Faixa + extras (0 quando bloqueado; null sem salário e sem extras). */
  totalAmount: number | null;
  /** Motivo quando o atingimento geral não pôde ser apurado. */
  incompleteReason?: string;
}

// ---------------------------------------------------------------------------
// Leitura de regras, salários e bloqueios
// ---------------------------------------------------------------------------

export async function listBonusRules(): Promise<BonusRule[]> {
  const rules = await list<BonusRule>(COLLECTIONS.bonusRules);
  return rules.sort((a, b) => a.department.localeCompare(b.department) || b.version - a.version);
}

/** Regra vigente do departamento: a ativa de maior versão. */
export function activeRuleFor(rules: BonusRule[], department: DepartmentKey): BonusRule | null {
  return rules.filter((r) => r.department === department && r.active).sort((a, b) => b.version - a.version)[0] ?? null;
}

export async function getActiveBonusRule(department: DepartmentKey): Promise<BonusRule | null> {
  return activeRuleFor(await list<BonusRule>(COLLECTIONS.bonusRules, { where: [["department", "==", department]] }), department);
}

async function loadSalarySetting(): Promise<Record<string, number>> {
  const docs = await list<Settings>(COLLECTIONS.settings, { where: [["key", "==", "salarios"]] });
  const value = (docs[0]?.value ?? {}) as Record<string, unknown>;
  return Object.fromEntries(Object.entries(value).filter(([, v]) => typeof v === "number" && v > 0)) as Record<string, number>;
}

function salaryOf(user: User, setting: Record<string, number>): { salary: number | null; source: BonusComputation["salarySource"] } {
  if (typeof user.baseSalary === "number" && user.baseSalary > 0) return { salary: user.baseSalary, source: "cadastro" };
  const fromGoals = user.monthlyGoals?.salarioBase;
  if (typeof fromGoals === "number" && fromGoals > 0) return { salary: fromGoals, source: "metas" };
  if (setting[user.id]) return { salary: setting[user.id], source: "configuracao" };
  return { salary: null, source: null };
}

function blockerLabel(rules: BonusRule[], key: string): string {
  for (const r of rules) {
    const found = r.blockers.find((b) => b.key === key);
    if (found) return found.label;
  }
  return key;
}

function toBlockView(block: BonusBlock, users: Map<string, User>, rules: BonusRule[]): BonusBlockView {
  return {
    ...block,
    userName: users.get(block.userId)?.name ?? "Colaborador removido",
    blockerLabel: blockerLabel(rules, block.blockerKey),
    responsibleName: users.get(block.responsibleId)?.name ?? "—",
  };
}

/** Bloqueios (mais recentes primeiro), filtrados por competência e/ou colaboradores. */
export async function listBonusBlocks(filter: { period?: string; userIds?: string[] } = {}): Promise<BonusBlockView[]> {
  const [blocks, users, rules] = await Promise.all([
    list<BonusBlock>(COLLECTIONS.bonusBlocks, filter.period ? { where: [["period", "==", filter.period]] } : {}),
    list<User>(COLLECTIONS.users),
    list<BonusRule>(COLLECTIONS.bonusRules),
  ]);
  const byId = new Map(users.map((u) => [u.id, u]));
  return blocks
    .filter((b) => !filter.userIds || filter.userIds.includes(b.userId))
    .sort((a, b) => (a.createdAt < b.createdAt ? 1 : -1))
    .map((b) => toBlockView(b, byId, rules));
}

// ---------------------------------------------------------------------------
// Extras
// ---------------------------------------------------------------------------

const DAY_MS = 86_400_000;

/** Classificação da oportunidade originada pelo colaborador para o extra de upsell (regra em AUTOMATIC_EXTRAS). */
function upsellStatus(o: Opportunity, nowMs: number): BonusExtraItem["status"] {
  if (o.stage === "ganho") return "valida";
  const created = Date.parse(o.createdAt);
  if (o.stage === "perdido") {
    const lost = Date.parse(o.lostAt ?? o.stageChangedAt ?? o.updatedAt);
    return lost - created <= UPSELL_DISCARD_WINDOW_DAYS * DAY_MS ? "invalida" : "valida";
  }
  return nowMs - created < UPSELL_DISCARD_WINDOW_DAYS * DAY_MS ? "provisoria" : "valida";
}

const STAGE_TEXT: Record<Opportunity["stage"], string> = {
  qualificacao: "em qualificação",
  diagnostico: "em diagnóstico",
  proposta: "em proposta",
  negociacao: "em negociação",
  fechamento: "em fechamento",
  ganho: "ganha",
  perdido: "perdida",
};

function computeExtras(rule: BonusRule, userId: string, period: Period, opportunities: Opportunity[]): BonusExtraLine[] {
  const nowMs = Date.now();
  return rule.extras.map((extra) => {
    if (!AUTOMATIC_EXTRAS[extra.key]) {
      return { key: extra.key, label: extra.label, amount: extra.amount, unit: extra.unit, automatic: false, quantity: null, provisional: 0, total: 0, items: [] };
    }
    const mine = opportunities
      .filter((o) => o.originUserId === userId && o.createdAt >= period.start && o.createdAt < period.end)
      .sort((a, b) => (a.createdAt < b.createdAt ? -1 : 1));
    const items: BonusExtraItem[] = mine.map((o) => {
      const status = upsellStatus(o, nowMs);
      const lostText = o.stage === "perdido" && status === "invalida" ? ` em até ${UPSELL_DISCARD_WINDOW_DAYS} dias${o.lossReason ? ` (${o.lossReason})` : ""}` : "";
      return { id: o.id, label: o.title, href: `/vendas/oportunidades?oportunidade=${o.id}`, detail: `${STAGE_TEXT[o.stage]}${lostText}`, status };
    });
    const counted = items.filter((i) => i.status !== "invalida");
    return {
      key: extra.key,
      label: extra.label,
      amount: extra.amount,
      unit: extra.unit,
      automatic: true,
      quantity: counted.length,
      provisional: items.filter((i) => i.status === "provisoria").length,
      total: counted.length * extra.amount,
      items,
    };
  });
}

// ---------------------------------------------------------------------------
// Cálculo
// ---------------------------------------------------------------------------

function round2(n: number): number {
  return Math.round(n * 100) / 100;
}

function buildLines(defs: BonusRule["individualKpis"], results: Map<string, KpiResult>, scopeFor: (key: string) => { scope: KpiScope; scopeId?: string; label: string }, period: Period, names: Map<string, { name: string; unit: KpiUnit; suffix?: string; direction: KpiResult["kpi"]["direction"] }>): { attainment: number | null; lines: BonusKpiLine[] } {
  const raw = defs.map((d) => {
    const s = scopeFor(d.kpiKey);
    const r = results.get(`${s.scope}|${s.scopeId ?? ""}|${d.kpiKey}`);
    const meta = names.get(d.kpiKey);
    const direction = r?.kpi.direction ?? meta?.direction ?? "maior_melhor";
    const value = r?.value ?? null;
    const attainment = computeAttainment(value, direction, d.target);
    return {
      kpiKey: d.kpiKey,
      name: r?.kpi.name ?? meta?.name ?? d.kpiKey,
      unit: r?.kpi.unit ?? meta?.unit ?? "numero",
      suffix: r?.kpi.formulaMeta?.suffix ?? meta?.suffix,
      direction,
      weight: d.weight,
      target: d.target,
      scope: s.scope,
      scopeId: s.scopeId,
      scopeLabel: s.label,
      value,
      note: r ? r.note : "Indicador inexistente no registro de fórmulas.",
      attainment,
      capped: attainment === null ? null : Math.min(1, attainment),
      href: kpiHref(d.kpiKey, period, s.scope, s.scopeId),
    };
  });
  const totalWeight = raw.filter((l) => l.capped !== null).reduce((s, l) => s + l.weight, 0);
  const lines: BonusKpiLine[] = raw.map((l) => {
    const share = l.capped !== null && totalWeight > 0 ? l.weight / totalWeight : null;
    return { ...l, share, contribution: share !== null && l.capped !== null ? share * l.capped : null };
  });
  return { attainment: weightedAttainment(lines.map((l) => ({ weight: l.weight, attainment: l.attainment }))), lines };
}

/**
 * Bônus de vários colaboradores na mesma competência, com UMA carga do motor de indicadores
 * (computeKpiBatch) e uma leitura de regras, bloqueios, salários e oportunidades.
 */
export async function computeBonusForUsers(userIds: string[], periodOrKey: Period | string): Promise<BonusComputation[]> {
  const period = typeof periodOrKey === "string" ? monthPeriod(periodOrKey) : periodOrKey;
  const ids = Array.from(new Set(userIds.filter(Boolean)));
  if (ids.length === 0) return [];
  const [usersMap, rules, blocks, salarySetting, opportunities, allUsers] = await Promise.all([
    getManyByIds<User>(COLLECTIONS.users, ids),
    list<BonusRule>(COLLECTIONS.bonusRules),
    list<BonusBlock>(COLLECTIONS.bonusBlocks, { where: [["period", "==", period.key]] }),
    loadSalarySetting(),
    list<Opportunity>(COLLECTIONS.opportunities, { where: [["originUserId", "in", ids]] }),
    list<User>(COLLECTIONS.users),
  ]);
  const users = ids.map((id) => usersMap.get(id)).filter((u): u is User => Boolean(u));
  const formulaMeta = new Map(listFormulas().map((f) => [f.key, f]));
  const names = new Map(listFormulas().map((f) => [f.key, { name: f.label, unit: f.unit, suffix: f.suffix, direction: f.direction }]));
  const allById = new Map(allUsers.map((u) => [u.id, u]));

  // Coletivo: indicador da própria área no escopo do departamento; de outra área (ou da empresa), na empresa.
  const collectiveScope = (rule: BonusRule) => (key: string) => {
    const own = formulaMeta.get(key)?.department;
    return own === rule.department ? { scope: "departamento" as const, scopeId: rule.department, label: DEPARTMENT_LABELS[rule.department] } : { scope: "empresa" as const, label: "Empresa" };
  };

  // Monta as requisições do lote: individuais por usuário + coletivas por regra (sem repetir escopos).
  const requests: KpiBatchRequest[] = [];
  const requestKeys = new Set<string>();
  const addRequest = (scope: KpiScope, scopeId: string | undefined, keys: string[]) => {
    if (keys.length === 0) return;
    const k = `${scope}|${scopeId ?? ""}|${keys.join(",")}`;
    if (requestKeys.has(k)) return;
    requestKeys.add(k);
    requests.push({ keys, scope, scopeId });
  };
  const ruleByUser = new Map<string, BonusRule | null>();
  for (const u of users) {
    const rule = activeRuleFor(rules, u.departmentId);
    ruleByUser.set(u.id, rule);
    if (!rule) continue;
    addRequest("usuario", u.id, rule.individualKpis.map((k) => k.kpiKey));
    const scopeOf = collectiveScope(rule);
    const deptKeys = rule.collectiveKpis.filter((k) => scopeOf(k.kpiKey).scope === "departamento").map((k) => k.kpiKey);
    const orgKeys = rule.collectiveKpis.filter((k) => scopeOf(k.kpiKey).scope === "empresa").map((k) => k.kpiKey);
    addRequest("departamento", rule.department, deptKeys);
    addRequest("empresa", undefined, orgKeys);
  }
  const batch = requests.length > 0 ? await computeKpiBatch(requests, period, { withTrend: false, withSources: false }) : [];
  const results = new Map<string, KpiResult>();
  requests.forEach((req, i) => {
    for (const r of batch[i]) results.set(`${req.scope}|${req.scopeId ?? ""}|${r.key}`, r);
  });

  return users.map((user) => {
    const rule = ruleByUser.get(user.id) ?? null;
    const { salary, source } = salaryOf(user, salarySetting);
    const myBlocks = blocks.filter((b) => b.userId === user.id).map((b) => toBlockView(b, allById, rules));
    const confirmed = myBlocks.filter((b) => b.status === "confirmado");
    const pending = myBlocks.filter((b) => b.status === "aberto");
    const base: BonusComputation = {
      userId: user.id,
      userName: user.name,
      department: user.departmentId,
      period,
      rule,
      salary,
      salarySource: source,
      individual: { attainment: null, lines: [] },
      collective: { attainment: null, lines: [] },
      weights: { individual: 0, collective: 0 },
      overallAttainment: null,
      tier: null,
      nextTier: null,
      payoutPct: 0,
      maxAmount: null,
      tierAmount: null,
      extras: [],
      extrasAmount: 0,
      blocked: confirmed.length > 0,
      blocks: confirmed,
      pendingBlocks: pending,
      projectedAmount: null,
      totalAmount: null,
    };
    if (!rule) return base;

    const individual = buildLines(rule.individualKpis, results, () => ({ scope: "usuario", scopeId: user.id, label: user.name }), period, names);
    const collective = buildLines(rule.collectiveKpis, results, collectiveScope(rule), period, names);
    const emptyBlocks = [
      rule.individualWeight > 0 && rule.individualKpis.length > 0 && individual.attainment === null ? "individual" : null,
      rule.collectiveWeight > 0 && rule.collectiveKpis.length > 0 && collective.attainment === null ? "coletivo" : null,
    ].filter((b): b is string => b !== null);
    const incompleteReason = emptyBlocks.length > 0 ? `Nenhum indicador do bloco ${emptyBlocks.join(" e ")} tem dado na competência: não há base para apurar a faixa.` : undefined;
    const combined = incompleteReason ? { overall: null, wInd: 0, wCol: 0 } : combineAttainment(individual.attainment, collective.attainment, rule.individualWeight, rule.collectiveWeight);
    const { current, next } = resolveTier(rule.tiers, combined.overall);
    const payoutPct = current?.payoutPct ?? 0;
    const maxAmount = bonusAmount(salary, rule.maxPctOfSalary, 100);
    const tierAmount = combined.overall === null ? (salary === null ? null : 0) : bonusAmount(salary, rule.maxPctOfSalary, payoutPct);
    const extras = computeExtras(rule, user.id, period, opportunities);
    const extrasAmount = round2(extras.reduce((s, e) => s + e.total, 0));
    const blocked = confirmed.length > 0;
    const projectedAmount = blocked ? 0 : tierAmount;
    const totalAmount = blocked ? 0 : tierAmount === null && extrasAmount === 0 ? null : round2((tierAmount ?? 0) + extrasAmount);
    return {
      ...base,
      individual,
      collective,
      weights: { individual: combined.wInd, collective: combined.wCol },
      overallAttainment: combined.overall,
      tier: current,
      nextTier: next,
      payoutPct,
      maxAmount,
      tierAmount,
      extras,
      extrasAmount: blocked ? 0 : extrasAmount,
      projectedAmount,
      totalAmount,
      incompleteReason,
    };
  });
}

/** Bônus projetado de um colaborador na competência (AAAA-MM ou Period mensal). null se o usuário não existe. */
export async function computeBonus(userId: string, period: Period | string): Promise<BonusComputation | null> {
  const [result] = await computeBonusForUsers([userId], period);
  return result ?? null;
}

// ---------------------------------------------------------------------------
// Fechamento da competência
// ---------------------------------------------------------------------------

export function bonusResultId(userId: string, periodKey: string): string {
  return `bonus_${userId}_${periodKey}`;
}

/**
 * Grava `bonus_results` da competência para os colaboradores ativos com regra vigente (todos, ou só `onlyUserIds`; id determinístico
 * bonus_<userId>_<AAAA-MM>, regravável). Guarda ruleId e a versão da regra: mudanças posteriores não retroagem.
 */
export async function storeBonusResults(periodOrKey: Period | string, onlyUserIds?: string[]): Promise<{ written: number; blocked: number; total: number; results: BonusComputation[] }> {
  const period = typeof periodOrKey === "string" ? monthPeriod(periodOrKey) : periodOrKey;
  const [users, rules] = await Promise.all([list<User>(COLLECTIONS.users), list<BonusRule>(COLLECTIONS.bonusRules)]);
  const eligible = users.filter((u) => u.active !== false && activeRuleFor(rules, u.departmentId) && (!onlyUserIds || onlyUserIds.includes(u.id)));
  const computations = await computeBonusForUsers(
    eligible.map((u) => u.id),
    period,
  );
  const now = nowIso();
  const writes = computations
    .filter((c) => c.rule)
    .map((c) => {
      const data: Omit<BonusResult, "id"> & Record<string, unknown> = {
        organizationId: ORG_ID,
        createdAt: now,
        updatedAt: now,
        userId: c.userId,
        ruleId: c.rule!.id,
        period: period.key,
        individualAttainment: c.individual.attainment ?? 0,
        collectiveAttainment: c.collective.attainment ?? 0,
        overallAttainment: c.overallAttainment ?? 0,
        tierLabel: c.overallAttainment === null ? "Sem dados suficientes" : (c.tier?.label ?? "Abaixo da faixa mínima"),
        payoutPct: c.payoutPct,
        projectedAmount: c.projectedAmount ?? 0,
        blocked: c.blocked,
        blockReason: c.blocked ? c.blocks.map((b) => `${b.blockerLabel}: ${b.reason}`).join(" | ") : undefined,
        extrasAmount: c.extrasAmount,
        // Contexto do fechamento (transparência do histórico, mesmo se a regra mudar depois).
        ruleVersion: c.rule!.version,
        salary: c.salary ?? undefined,
        lines: [...c.individual.lines.map((l) => ({ ...l, block: "individual" })), ...c.collective.lines.map((l) => ({ ...l, block: "coletivo" }))].map((l) => ({
          block: l.block,
          kpiKey: l.kpiKey,
          name: l.name,
          weight: l.weight,
          target: l.target,
          value: l.value,
          attainment: l.attainment,
        })),
      };
      return { collection: COLLECTIONS.bonusResults, id: bonusResultId(c.userId, period.key), data };
    });
  await batchSet(writes);
  return {
    written: writes.length,
    blocked: computations.filter((c) => c.blocked).length,
    total: round2(computations.reduce((s, c) => s + (c.totalAmount ?? 0), 0)),
    results: computations,
  };
}

/** Resultados gravados (competências fechadas) de um colaborador, do mais recente ao mais antigo. */
export async function listBonusHistory(userId: string): Promise<(BonusResult & { ruleVersion?: number; salary?: number })[]> {
  const items = await list<BonusResult & { ruleVersion?: number; salary?: number }>(COLLECTIONS.bonusResults, { where: [["userId", "==", userId]] });
  return items.sort((a, b) => (a.period < b.period ? 1 : -1));
}

// ---------------------------------------------------------------------------
// Bloqueios
// ---------------------------------------------------------------------------

export class BonusError extends Error {}

/** Registra um bloqueio (status "aberto") para análise. Valida o bloqueador contra a regra vigente do colaborador. */
export async function registerBonusBlock(data: Required<Pick<BonusBlockInput, "userId" | "period" | "blockerKey" | "reason">> & Pick<BonusBlockInput, "evidence" | "notes">, actor: UserRef): Promise<BonusBlock> {
  const target = await getById<User>(COLLECTIONS.users, data.userId);
  if (!target) throw new BonusError("Colaborador não encontrado");
  const rule = await getActiveBonusRule(target.departmentId);
  if (!rule) throw new BonusError(`Não há regra de bônus vigente para ${DEPARTMENT_LABELS[target.departmentId]}`);
  const blocker = rule.blockers.find((b) => b.key === data.blockerKey);
  if (!blocker) throw new BonusError("Bloqueador não previsto na regra de bônus do colaborador");

  const block = await create<BonusBlock>(COLLECTIONS.bonusBlocks, {
    userId: target.id,
    period: data.period,
    blockerKey: blocker.key,
    reason: data.reason,
    responsibleId: actor.id,
    evidence: data.evidence || undefined,
    notes: data.notes || undefined,
    status: "aberto",
    createdBy: actor.id,
  });
  await emitEvent({
    type: "bonus.block_registered",
    actor,
    entity: { type: "bonus_block", id: block.id },
    title: `Bloqueio de bônus registrado: ${target.name}`,
    description: `${blocker.label} · competência ${data.period} · ${data.reason}`,
    department: target.departmentId,
    payload: { userId: target.id, period: data.period, blockerKey: blocker.key, ruleId: rule.id, status: "aberto" },
    timeline: false,
  });
  return block;
}

/**
 * Decide um bloqueio: aberto → confirmado (zera o bônus do mês, emite bonus.blocked e notifica o colaborador)
 * ou aberto/confirmado → revogado (emite bonus.block_revoked). A trilha de auditoria são os eventos da entidade.
 */
export async function decideBonusBlock(id: string, decision: "confirmado" | "revogado", actor: UserRef, note?: string): Promise<BonusBlock> {
  const block = await getById<BonusBlock>(COLLECTIONS.bonusBlocks, id);
  if (!block) throw new BonusError("Bloqueio não encontrado");
  if (block.status === "revogado") throw new BonusError("Este bloqueio já foi revogado");
  if (decision === "confirmado" && block.status === "confirmado") throw new BonusError("Este bloqueio já está confirmado");
  const [target, rules] = await Promise.all([getById<User>(COLLECTIONS.users, block.userId), list<BonusRule>(COLLECTIONS.bonusRules)]);
  const label = blockerLabel(rules, block.blockerKey);
  const stamp = `${decision === "confirmado" ? "Confirmado" : "Revogado"} por ${actor.name} em ${new Date().toLocaleDateString("pt-BR", { timeZone: "America/Sao_Paulo" })}${note ? `: ${note}` : ""}`;
  const notes = [block.notes, stamp].filter(Boolean).join("\n");
  await update<BonusBlock>(COLLECTIONS.bonusBlocks, id, { status: decision, notes });
  const updated: BonusBlock = { ...block, status: decision, notes };

  const name = target?.name ?? "colaborador";
  if (decision === "confirmado") {
    const event = await emitEvent({
      type: "bonus.blocked",
      actor,
      entity: { type: "bonus_block", id },
      title: `Bônus bloqueado: ${name} (${block.period})`,
      description: `${label} · ${block.reason}${note ? ` · ${note}` : ""}`,
      department: target?.departmentId,
      payload: { userId: block.userId, period: block.period, blockerKey: block.blockerKey, previousStatus: block.status, status: decision, note },
      timeline: false,
    });
    await notify({
      userIds: [block.userId],
      kind: "critica",
      title: `Seu bônus de ${block.period} foi bloqueado`,
      body: `${label}: ${block.reason}. Fale com seu gestor se precisar de esclarecimentos.`,
      href: `/performance/bonus?periodo=${block.period}`,
      entity: { type: "bonus_block", id },
      eventId: event.id,
    });
  } else {
    const event = await emitEvent({
      type: "bonus.block_revoked",
      actor,
      entity: { type: "bonus_block", id },
      title: `Bloqueio de bônus revogado: ${name} (${block.period})`,
      description: `${label}${note ? ` · ${note}` : ""}`,
      department: target?.departmentId,
      payload: { userId: block.userId, period: block.period, blockerKey: block.blockerKey, previousStatus: block.status, status: decision, note },
      timeline: false,
    });
    if (block.status === "confirmado") {
      await notify({
        userIds: [block.userId],
        kind: "informativa",
        title: `Bloqueio do bônus de ${block.period} revogado`,
        body: `O bloqueio "${label}" foi revogado por ${actor.name}.`,
        href: `/performance/bonus?periodo=${block.period}`,
        entity: { type: "bonus_block", id },
        eventId: event.id,
      });
    }
  }
  return updated;
}

/** Resumo textual para eventos/notificações do fechamento. */
export function describeClosing(result: { written: number; blocked: number; total: number }): string {
  return `${result.written} colaborador(es) · ${result.blocked} bloqueado(s) · total projetado ${formatCurrency(result.total)}`;
}

