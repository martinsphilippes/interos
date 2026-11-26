/**
 * Motor de comissões v2 — regras PURAS (sem Firestore): normalização das regras (inclusive as antigas), regra
 * efetiva por precedência, parcelas ("slots") de cada item do contrato e avaliação de cada parcela na data de
 * referência. O motor (engine.ts) só lê/grava; toda decisão de valor e de status está aqui, com a memória de
 * cálculo que vai para o documento da comissão.
 *
 * Precedência (por tipo de receita, D10 + motor v3): cada regra tem uma PRIORIDADE (menor = avaliada antes). Sem
 * prioridade explícita vale o padrão pela especificidade (`defaultPriority`): exceção do contrato (0) > vendedor +
 * produto/serviço/plano (10) > vendedor (15) > plano (20) > produto/serviço (30) > categoria (35) > geral (40) > padrão
 * do cadastro do produto (Product.commission, só quando nada se aplica). A primeira regra EXCLUSIVA encontrada encerra a
 * busca; regras CUMULATIVAS (`overridesDefault: false`) somam-se às seguintes. Tipos de receita diferentes resolvem
 * independentemente (ex.: exceção só para adesão + padrão na recorrência). Uma mesma regra nunca gera duas comissões
 * para a mesma parcela (chave idempotente com o id da regra).
 *
 * Versões (motor v3): a regra aplicada a uma venda é a versão vigente na DATA DA VENDA (`rulesAsOf`); alterar uma
 * regra não muda as vendas anteriores, salvo reaplicação autorizada (versão `retroactive`). Exceção por contrato usa
 * sempre a versão atual (é a autorização expressa para aquele contrato).
 *
 * Base (motor v3): valor contratado/recebido → natureza (bruto, líquido com deduções, referência fixa) → teto da base
 * → percentual/valor → teto do valor final. Os dois tetos são independentes.
 *
 * Parcelas (chave de idempotência contractId|revenueType|productId|slot|ruleId):
 * - adesão: "s1" (base contratada: adesão total do item, liberada com o recebimento da 1ª parcela) ou "s1".."sN"
 *   (base recebida com adesão parcelada: proporcional a cada parcela paga);
 * - hardware: "hw";
 * - recorrência: "m<N>" = N-ésima mensalidade (a competência só é conhecida quando as cobranças existem; o número
 *   da mensalidade é o equivalente determinístico e fica estável mesmo se as cobranças forem regeradas). Gera de
 *   `releaseInstallment` até `releaseInstallment + recurringCompetences - 1` (null = enquanto o contrato estiver
 *   ativo); a projeção (previstas) vai até o prazo do contrato e mensalidades além dele geram a comissão ao serem pagas.
 */
import { dateKey, formatCurrency, formatDate } from "@/lib/format";
import { splitInstallments, type EffectiveContractItem } from "@/domain/sale-closing";
import { COMMISSION_BASE_LABELS, COMMISSION_REVENUE_LABELS, COMMISSION_SCOPE_LABELS, commissionTriggerText } from "@/domain/commissions";
import type {
  Billing,
  CommissionCalcStep,
  CommissionRevenueType,
  CommissionRule,
  CommissionRuleScope,
  CommissionRuleSnapshot,
  CommissionRuleVersion,
  CommissionTrigger,
  Contract,
  Product,
} from "@/domain/types";
import type { RuleInput } from "./schemas";

const DAY_MS = 86_400_000;
export const round2 = (n: number) => Math.round(n * 100) / 100;

// ---------------------------------------------------------------------------
// Normalização
// ---------------------------------------------------------------------------

/** Regra sem campos v2 (cadastrada antes do motor v2). */
export function isLegacyRule(rule: Pick<CommissionRule, "trigger" | "scope" | "baseSource" | "recurringCompetences">): boolean {
  return rule.trigger === undefined && rule.scope === undefined && rule.baseSource === undefined && rule.recurringCompetences === undefined;
}

export function ruleScope(rule: Pick<CommissionRule, "scope" | "contractId" | "userId">): CommissionRuleScope {
  return rule.scope ?? (rule.contractId ? "contrato" : rule.userId ? "vendedor" : "padrao");
}

/** Gatilho da regra; regras antigas: venda → venda, contrato_assinado → contrato_assinado, pagamento/parcela → pagamento. */
export function ruleTrigger(rule: Pick<CommissionRule, "trigger" | "releaseCondition">): CommissionTrigger {
  if (rule.trigger) return rule.trigger;
  if (rule.releaseCondition === "venda" || rule.releaseCondition === "contrato_assinado") return rule.releaseCondition;
  return "pagamento";
}

/** releaseCondition (campo antigo, obrigatório) coerente com o gatilho de uma regra nova. */
export function legacyReleaseCondition(revenueType: CommissionRevenueType, trigger: CommissionTrigger): CommissionRule["releaseCondition"] {
  if (revenueType === "recorrencia" || trigger === "mensalidade_n") return "parcela";
  if (trigger === "venda" || trigger === "contrato_assinado") return trigger;
  return "pagamento";
}

/** Mensalidades exatas da regra (únicas, ordenadas, ≥ 1). */
export function ruleInstallments(rule: Pick<CommissionRule, "installments">): number[] {
  return Array.from(new Set((rule.installments ?? []).map((n) => Math.floor(n)).filter((n) => Number.isFinite(n) && n >= 1))).sort((a, b) => a - b);
}

/** Prioridade padrão pela especificidade (menor = antes). Ver cabeçalho. */
export function defaultPriority(rule: Pick<CommissionRule, "scope" | "contractId" | "userId" | "productId" | "productCategory" | "planId">): number {
  const scope = ruleScope(rule);
  if (scope === "contrato") return 0;
  const item = Boolean(rule.productId || rule.productCategory || rule.planId);
  if (scope === "vendedor") return item ? 10 : 15;
  if (rule.planId) return 20;
  if (rule.productId) return 30;
  if (rule.productCategory) return 35;
  return 40;
}

export function effectivePriority(rule: Pick<CommissionRule, "priority" | "scope" | "contractId" | "userId" | "productId" | "productCategory" | "planId">): number {
  return typeof rule.priority === "number" && Number.isFinite(rule.priority) ? rule.priority : defaultPriority(rule);
}

/** Regra efetiva congelada (vai para o documento da comissão). */
export function snapshotRule(rule: CommissionRule): CommissionRuleSnapshot {
  const legacy = isLegacyRule(rule);
  const recurring = rule.revenueType === "recorrencia";
  const exact = recurring ? ruleInstallments(rule) : [];
  const positive = (n: number | undefined) => (typeof n === "number" && n > 0 ? n : undefined);
  return {
    id: rule.id,
    name: rule.name,
    scope: ruleScope(rule),
    revenueType: rule.revenueType,
    mode: rule.mode,
    value: rule.value,
    trigger: ruleTrigger(rule),
    baseSource: rule.baseSource ?? "contratado",
    minTenureDays: Math.max(0, Math.floor(rule.minTenureDays ?? 0)),
    // Regra antiga de recorrência: uma única comissão na N-ésima mensalidade paga (comportamento do motor v1).
    recurringCompetences: recurring ? (exact.length ? null : legacy ? 1 : (rule.recurringCompetences ?? null)) : null,
    // Recorrência: 1ª mensalidade que gera comissão. Gatilho "mensalidade_n": a mensalidade paga que adquire a comissão.
    releaseInstallment: exact.length && ruleTrigger(rule) !== "mensalidade_n" ? exact[0] : recurring || ruleTrigger(rule) === "mensalidade_n" ? Math.max(1, Math.floor(rule.releaseInstallment ?? (legacy || !recurring ? 3 : 1))) : 1,
    overridesDefault: rule.overridesDefault !== false,
    userId: rule.userId,
    contractId: rule.contractId,
    productId: rule.productId,
    productCategory: rule.productCategory,
    reason: rule.reason,
    source: "regra",
    ...(rule.code ? { code: rule.code } : {}),
    ...(rule.version ? { version: rule.version } : {}),
    priority: effectivePriority(rule),
    ...(rule.planId ? { planId: rule.planId } : {}),
    ...(rule.baseKind && rule.baseKind !== "liquido" ? { baseKind: rule.baseKind } : {}),
    ...(rule.baseKind === "liquido" || !rule.baseKind ? (rule.deductions?.length ? { baseKind: "liquido" as const, deductions: rule.deductions.map((d) => ({ ...d })) } : {}) : {}),
    ...(rule.baseKind === "referencia" && positive(rule.referenceValue) ? { referenceValue: rule.referenceValue } : {}),
    ...(positive(rule.baseCap) ? { baseCap: rule.baseCap } : {}),
    ...(positive(rule.amountCap) ? { amountCap: rule.amountCap } : {}),
    ...(exact.length ? { installments: exact } : {}),
    ...(rule.reverseOnCancel ? { reverseOnCancel: true } : {}),
  };
}

/**
 * Regras como estavam na data da venda (ISO): cada regra vira a última versão com `effectiveFrom` ≤ venda, ou a última
 * versão retroativa (reaplicação autorizada) se for posterior. Regra sem versões (anterior ao versionamento) vale como
 * está. Regra cuja 1ª versão é posterior à venda (e não retroativa) não se aplica. Exceção por contrato: versão atual.
 */
export function rulesAsOf(rules: CommissionRule[], versions: CommissionRuleVersion[], saleDate: string): CommissionRule[] {
  const byRule = new Map<string, CommissionRuleVersion[]>();
  for (const v of versions) byRule.set(v.ruleId, [...(byRule.get(v.ruleId) ?? []), v]);
  const out: CommissionRule[] = [];
  for (const rule of rules) {
    const list = (byRule.get(rule.id) ?? []).sort((a, b) => a.version - b.version);
    if (list.length === 0 || ruleScope(rule) === "contrato") {
      out.push(rule);
      continue;
    }
    const applicable = list.filter((v) => v.retroactive || v.effectiveFrom <= saleDate);
    const chosen = applicable[applicable.length - 1];
    if (!chosen) continue;
    out.push({ ...rule, ...chosen.rule, id: rule.id, organizationId: rule.organizationId, createdAt: rule.createdAt, updatedAt: rule.updatedAt, version: chosen.version } as CommissionRule);
  }
  return out;
}

/** Campos da regra a partir da entrada validada do formulário (mesmo caminho para salvar e para simular o rascunho). */
export function ruleFromInput(input: RuleInput, extra: { clientId?: string } = {}): Omit<CommissionRule, "id" | "organizationId" | "createdAt" | "updatedAt"> {
  const recurring = input.revenueType === "recorrencia";
  const exact = recurring ? ruleInstallments({ installments: input.installments }) : [];
  return {
    name: input.name,
    code: input.code,
    description: input.description,
    scope: input.scope,
    userId: input.scope === "vendedor" ? input.userId : undefined,
    contractId: input.scope === "contrato" ? input.contractId : undefined,
    clientId: extra.clientId,
    revenueType: input.revenueType,
    productId: input.productId,
    productCategory: input.productCategory,
    planId: input.planId,
    mode: input.mode,
    value: input.value,
    releaseCondition: legacyReleaseCondition(input.revenueType, input.trigger),
    trigger: input.trigger,
    baseSource: input.baseSource,
    baseKind: input.baseKind === "liquido" ? undefined : input.baseKind,
    deductions: input.baseKind === "liquido" && input.deductions.length ? input.deductions : undefined,
    referenceValue: input.baseKind === "referencia" ? (input.referenceValue ?? undefined) : undefined,
    baseCap: input.mode === "percentual" ? (input.baseCap ?? undefined) : undefined,
    amountCap: input.amountCap ?? undefined,
    minTenureDays: input.minTenureDays,
    recurringCompetences: recurring && !exact.length ? input.recurringCompetences : null,
    releaseInstallment: recurring || input.trigger === "mensalidade_n" ? (exact.length && input.trigger !== "mensalidade_n" ? exact[0] : input.releaseInstallment) : undefined,
    installments: exact.length ? exact : undefined,
    priority: input.priority ?? undefined,
    validFrom: input.scope === "contrato" ? undefined : input.validFrom,
    validTo: input.scope === "contrato" ? undefined : input.validTo,
    overridesDefault: input.overridesDefault,
    reverseOnCancel: input.reverseOnCancel || undefined,
    reason: input.reason,
    active: input.active,
  };
}

/** Padrão do cadastro do produto (Product.commission) quando nenhuma regra do banco se aplica. */
export function productDefaultSnapshot(product: Product, revenueType: CommissionRevenueType): CommissionRuleSnapshot | null {
  const c = product.commission;
  if (!c) return null;
  const pct = revenueType === "setup" ? c.setupPct : revenueType === "recorrencia" ? c.recurringPct : c.hardwarePct;
  if (!pct || pct <= 0) return null;
  const recurring = revenueType === "recorrencia";
  return {
    id: `produto:${product.id}`,
    name: `Padrão do produto ${product.name}`,
    scope: "produto",
    revenueType,
    mode: "percentual",
    value: pct,
    trigger: "pagamento",
    baseSource: "contratado",
    minTenureDays: 0,
    recurringCompetences: recurring ? 1 : null,
    releaseInstallment: recurring ? Math.max(1, c.recurringReleaseInstallment || 3) : 1,
    overridesDefault: true,
    productId: product.id,
    source: "produto",
  };
}

// ---------------------------------------------------------------------------
// Regra efetiva (precedência + composição)
// ---------------------------------------------------------------------------

export interface RuleContext {
  contractId: string;
  sellerId?: string;
  productId: string;
  productCategory?: string;
  /** Plano comercial do item. */
  planId?: string;
  revenueType: CommissionRevenueType;
  /** Data da venda (AAAA-MM-DD), comparada com a vigência das regras padrão/vendedor. */
  saleDate: string;
}

export function ruleMatches(rule: CommissionRule, ctx: RuleContext): boolean {
  if (!rule.active || rule.revenueType !== ctx.revenueType) return false;
  const scope = ruleScope(rule);
  if (scope === "contrato") {
    if (rule.contractId !== ctx.contractId) return false;
  } else {
    if (rule.validFrom && ctx.saleDate < rule.validFrom.slice(0, 10)) return false;
    if (rule.validTo && ctx.saleDate > rule.validTo.slice(0, 10)) return false;
  }
  if (scope === "vendedor" && (!ctx.sellerId || rule.userId !== ctx.sellerId)) return false;
  if (rule.productId && rule.productId !== ctx.productId) return false;
  if (rule.productCategory && rule.productCategory !== ctx.productCategory) return false;
  if (rule.planId && rule.planId !== ctx.planId) return false;
  return true;
}

/** Desempate dentro da mesma prioridade: produto + plano > produto > plano > categoria > geral. */
const specificity = (r: CommissionRule) => (r.productId ? 4 : r.productCategory ? 1 : 0) + (r.planId ? 2 : 0);

/** Regras aplicáveis a um item × tipo de receita, na ordem de precedência (ver cabeçalho). */
export function resolveRules(rules: CommissionRule[], ctx: RuleContext, product: Product | undefined): CommissionRuleSnapshot[] {
  const out: CommissionRuleSnapshot[] = [];
  const seen = new Set<string>();
  const candidates = rules.filter((r) => ruleMatches(r, ctx) && !seen.has(r.id) && Boolean(seen.add(r.id)));
  const levels = Array.from(new Set(candidates.map(effectivePriority))).sort((a, b) => a - b);
  for (const level of levels) {
    const atLevel = candidates.filter((r) => effectivePriority(r) === level).sort((a, b) => specificity(b) - specificity(a) || (b.updatedAt ?? "").localeCompare(a.updatedAt ?? ""));
    if (atLevel.length === 0) continue;
    for (const r of atLevel.filter((x) => x.overridesDefault === false)) out.push(snapshotRule(r));
    const overriding = atLevel.find((x) => x.overridesDefault !== false);
    if (overriding) {
      out.push(snapshotRule(overriding));
      return out;
    }
  }
  const fallback = product ? productDefaultSnapshot(product, ctx.revenueType) : null;
  if (fallback) out.push(fallback);
  return out;
}

// ---------------------------------------------------------------------------
// Parcelas (slots)
// ---------------------------------------------------------------------------

export interface SlotSpec {
  slot: string;
  revenueType: CommissionRevenueType;
  billingType: Billing["type"];
  /** Parcela da cobrança que libera/serve de base (1 para adesão à vista e hardware). */
  billingInstallment: number;
  /** Base esperada (valor contratado da parcela para este item). */
  expectedBase: number;
  /** Valor cheio do item para o tipo (proporção do valor fixo). */
  fullBase: number;
  /** Participação do item no total do tipo (recebido → paidAmount × participação). */
  share: number;
  /** Competência estimada (AAAA-MM) antes de existir a cobrança. */
  estimatedCompetence: string;
  /** Nº da mensalidade (recorrência) ou da parcela da adesão. */
  installment?: number;
  /** Quantidade de parcelas da adesão (rótulo "Adesão 2/3"). */
  of?: number;
}

function addMonths(comp: string, months: number): string {
  const [y, m] = comp.split("-").map(Number);
  return new Date(Date.UTC(y, m - 1 + months, 1)).toISOString().slice(0, 7);
}

/** Competência do 1º vencimento (estimada quando o contrato ainda não tem data). */
export function firstCompetence(contract: Pick<Contract, "firstDueDate" | "createdAt">, billings: Billing[]): string {
  const first = billings.filter((b) => b.status !== "cancelada").sort((a, b) => a.dueDate.localeCompare(b.dueDate))[0];
  if (first) return first.competence;
  if (contract.firstDueDate) return dateKey(contract.firstDueDate).slice(0, 7);
  return addMonths(dateKey(contract.createdAt).slice(0, 7), 1);
}

/** Quantidade de mensalidades do prazo (anual = 1 por ano). */
export function termInstallments(contract: Pick<Contract, "recurrence" | "termMonths">): number {
  if (contract.recurrence === "unico") return 0;
  return contract.recurrence === "anual" ? Math.max(1, Math.ceil(contract.termMonths / 12)) : Math.max(1, contract.termMonths);
}

/** Maior mensalidade PAGA — mensalidades pagas além do prazo (renovação) geram comissão "enquanto ativo". */
function lastPaidRecurringInstallment(billings: Billing[]): number {
  return billings.filter((b) => b.type === "mensalidade" && b.status === "paga").reduce((max, b) => Math.max(max, b.installment ?? 0), 0);
}

function monthsBetween(a: string, b: string): number {
  const [ay, am] = a.split("-").map(Number);
  const [by, bm] = b.split("-").map(Number);
  return (by - ay) * 12 + (bm - am);
}

/**
 * Horizonte das previstas de recorrência (D26): até o fim da vigência do contrato (`endDate`) — a renovação, ao
 * estender a vigência, faz o mesmo recálculo criar as novas. Sem vigência conhecida, o prazo do contrato.
 */
export function recurringHorizon(contract: Pick<Contract, "recurrence" | "termMonths" | "endDate">, firstComp: string): number {
  const step = contract.recurrence === "anual" ? 12 : 1;
  if (!contract.endDate) return termInstallments(contract);
  const endComp = dateKey(contract.endDate).slice(0, 7);
  const months = monthsBetween(firstComp, endComp);
  // O mês do fim da vigência não é cobrado (a 1ª mensalidade vence no início); no mínimo 1.
  return Math.max(1, Math.floor(months / step));
}

export function planSlots(rule: CommissionRuleSnapshot, item: EffectiveContractItem, contract: Contract, totals: { setupTotal: number; monthlyTotal: number; hardwareTotal: number }, billings: Billing[]): SlotSpec[] {
  const firstComp = firstCompetence(contract, billings);
  // Item incluído por aditivo (D25): adesão/hardware só pela cobrança avulsa gerada pelo aditivo; recorrência a partir
  // da 1ª mensalidade que já o inclui (mensalidades pagas antes do item não geram comissão sobre ele).
  const since = item.since;
  if (rule.revenueType === "setup") {
    if (item.setupValue <= 0 || totals.setupTotal <= 0) return [];
    if (since) {
      const n = since.setupInstallment;
      if (!n) return [];
      const b = slotBilling({ billingType: "setup", billingInstallment: n }, billings);
      const share = b && b.amount > 0 ? Math.min(1, item.setupValue / b.amount) : 1;
      return [{ slot: `s${n}`, revenueType: "setup", billingType: "setup", billingInstallment: n, expectedBase: item.setupValue, fullBase: item.setupValue, share, estimatedCompetence: b?.competence ?? firstComp, installment: n, of: 1 }];
    }
    const share = item.setupValue / totals.setupTotal;
    const n = Math.max(1, contract.setupInstallments ?? 1);
    if (rule.baseSource === "recebido" && n > 1) {
      const parts = splitInstallments(round2(totals.setupTotal), n);
      return parts.map((part, i) => ({
        slot: `s${i + 1}`,
        revenueType: "setup",
        billingType: "setup",
        billingInstallment: i + 1,
        expectedBase: round2(part * share),
        fullBase: item.setupValue,
        share,
        estimatedCompetence: addMonths(firstComp, i),
        installment: i + 1,
        of: n,
      }));
    }
    return [{ slot: "s1", revenueType: "setup", billingType: "setup", billingInstallment: 1, expectedBase: item.setupValue, fullBase: item.setupValue, share, estimatedCompetence: firstComp, installment: 1, of: n }];
  }
  if (rule.revenueType === "hardware") {
    if (item.hardwareValue <= 0 || totals.hardwareTotal <= 0) return [];
    if (since) {
      const n = since.hardwareInstallment;
      if (!n) return [];
      const b = slotBilling({ billingType: "hardware", billingInstallment: n }, billings);
      const share = b && b.amount > 0 ? Math.min(1, item.hardwareValue / b.amount) : 1;
      return [{ slot: n === 1 ? "hw" : `hw${n}`, revenueType: "hardware", billingType: "hardware", billingInstallment: n, expectedBase: item.hardwareValue, fullBase: item.hardwareValue, share, estimatedCompetence: b?.competence ?? firstComp }];
    }
    return [{ slot: "hw", revenueType: "hardware", billingType: "hardware", billingInstallment: 1, expectedBase: item.hardwareValue, fullBase: item.hardwareValue, share: item.hardwareValue / totals.hardwareTotal, estimatedCompetence: firstComp }];
  }
  // Recorrência.
  if (item.monthlyValue <= 0 || totals.monthlyTotal <= 0 || contract.recurrence === "unico") return [];
  const step = contract.recurrence === "anual" ? 12 : 1;
  const share = item.monthlyValue / totals.monthlyTotal;
  const perCompetence = round2(item.monthlyValue * step);
  // Projeção até o fim da vigência (ou o prazo do contrato); além disso, só mensalidades já PAGAS (renovação
  // aplicada estende a vigência e o recálculo cria as novas previstas).
  const reach = Math.max(recurringHorizon(contract, firstComp), lastPaidRecurringInstallment(billings));
  const slotFor = (n: number): SlotSpec => ({ slot: `m${n}`, revenueType: "recorrencia", billingType: "mensalidade", billingInstallment: n, expectedBase: perCompetence, fullBase: perCompetence, share, estimatedCompetence: addMonths(firstComp, (n - 1) * step), installment: n });
  // Mensalidades exatas (COM.03): só as listadas — nunca "todas" por padrão.
  if (rule.installments?.length) return rule.installments.filter((n) => n <= reach && (!since || n >= since.installment)).map(slotFor);
  // Item de aditivo: as N competências da regra contam a partir da 1ª mensalidade que inclui o item.
  const from = since ? Math.max(rule.releaseInstallment, since.installment) : rule.releaseInstallment;
  const limit = rule.recurringCompetences === null ? Infinity : from + rule.recurringCompetences - 1;
  const horizon = Math.min(limit, reach);
  const out: SlotSpec[] = [];
  for (let n = from; n <= horizon; n++) out.push(slotFor(n));
  return out;
}

// ---------------------------------------------------------------------------
// Valor
// ---------------------------------------------------------------------------

/** Percentual sobre a base; valor fixo por unidade do item, proporcional quando a base é uma fração (parcela/pagamento parcial). */
export function commissionValue(rule: Pick<CommissionRuleSnapshot, "mode" | "value">, base: number, fullBase: number, quantity: number): number {
  if (base <= 0) return 0;
  if (rule.mode === "percentual") return round2((base * rule.value) / 100);
  const fraction = fullBase > 0 ? Math.min(1, base / fullBase) : 1;
  return round2(rule.value * Math.max(1, quantity) * fraction);
}

// ---------------------------------------------------------------------------
// Avaliação de uma parcela na data de referência
// ---------------------------------------------------------------------------

export type EvaluatedStatus = "prevista" | "em_carencia" | "aguardando_recebimento" | "liberada";

export interface SlotEvaluation {
  status: EvaluatedStatus;
  base: number;
  amount: number;
  competence: string;
  /** Data em que ficou/fica elegível (ausente enquanto o gatilho não aconteceu). */
  eligibleAt?: string;
  /** Data em que o gatilho aconteceu (pagamento, assinatura…). */
  triggeredAt?: string;
  billing?: Billing;
  /** Gatilho "N-ésima mensalidade paga" (D27): cobrança que adquire a comissão e o vencimento dela (previsão). */
  gateBillingId?: string;
  expectedAt?: string;
  steps: CommissionCalcStep[];
  formula: string;
  /** O que falta (texto curto). */
  waiting?: string;
  /** Números intermediários (simulador e testes). */
  detail: SlotDetail;
}

export interface SlotDetail {
  /** Base depois da natureza (bruto/líquido/referência) e antes do teto. */
  eligibleBase: number;
  /** Base usada no cálculo (depois do teto). */
  base: number;
  /** Total das deduções da base líquida. */
  deductions: number;
  baseCapApplied: boolean;
  amountBeforeCap: number;
  amountCapApplied: boolean;
}

/**
 * Natureza da base + teto da base (COM.02/COM.04). Recebe a base contratada/recebida (já líquida do desconto do item)
 * e devolve a base do cálculo, registrando cada passo na memória de cálculo.
 */
export function shapeBase(
  rule: Pick<CommissionRuleSnapshot, "baseKind" | "deductions" | "referenceValue" | "baseCap">,
  base: number,
  item: Pick<EffectiveContractItem, "quantity" | "discountPct">,
  steps: CommissionCalcStep[],
): { eligible: number; base: number; deductions: number; capped: boolean } {
  let eligible = base;
  let deductions = 0;
  if (rule.baseKind === "bruto") {
    const d = Math.min(Math.max(item.discountPct || 0, 0), 99.99);
    if (d > 0) {
      eligible = round2(base / (1 - d / 100));
      steps.push({ label: "Base bruta", value: `${formatCurrency(base)} líquidos ÷ (1 − ${pct(d)} de desconto) = ${formatCurrency(eligible)} antes do desconto` });
    } else steps.push({ label: "Base bruta", value: `Sem desconto no item: bruto = ${formatCurrency(base)}` });
  } else if (rule.baseKind === "referencia") {
    const ref = rule.referenceValue ?? 0;
    eligible = round2(ref * Math.max(1, item.quantity));
    steps.push({ label: "Base de referência", value: `${formatCurrency(ref)} de referência × ${Math.max(1, item.quantity)} un. = ${formatCurrency(eligible)} (o valor vendido não altera a base)` });
  } else if (rule.deductions?.length) {
    const parts: string[] = [];
    for (const d of rule.deductions) {
      const v = d.mode === "percentual" ? round2((base * d.value) / 100) : round2(d.value);
      deductions = round2(deductions + v);
      parts.push(`${d.label} ${d.mode === "percentual" ? `${pct(d.value)} = ${formatCurrency(v)}` : formatCurrency(v)}`);
    }
    eligible = Math.max(0, round2(base - deductions));
    steps.push({ label: "Base líquida", value: `${formatCurrency(base)} − deduções (${parts.join(" · ")}) = ${formatCurrency(eligible)}` });
  }
  const cap = rule.baseCap && rule.baseCap > 0 ? rule.baseCap : undefined;
  const capped = cap !== undefined && eligible > cap;
  const final = capped ? round2(cap!) : eligible;
  if (cap !== undefined) {
    steps.push({ label: "Teto da base", value: capped ? `mín(${formatCurrency(eligible)}; teto ${formatCurrency(cap)}) = ${formatCurrency(final)}` : `${formatCurrency(eligible)} dentro do teto de ${formatCurrency(cap)}` });
  }
  return { eligible, base: final, deductions, capped };
}

const pct = (n: number) => `${String(round2(n)).replace(".", ",")}%`;
const isoDay = (iso: string) => `${dateKey(iso)}T12:00:00.000Z`;
const later = (a?: string, b?: string) => (!a ? b : !b ? a : a > b ? a : b);

function slotLabel(spec: SlotSpec): string {
  if (spec.revenueType === "hardware") return "hardware";
  if (spec.revenueType === "recorrencia") return `${spec.installment}ª mensalidade`;
  return spec.of && spec.of > 1 ? (spec.slot === "s1" && spec.expectedBase === spec.fullBase ? "1ª parcela da adesão" : `${spec.installment}ª parcela da adesão`) : "adesão";
}

/** Cobrança da parcela (a paga tem prioridade; canceladas não contam). */
export function slotBilling(spec: Pick<SlotSpec, "billingType" | "billingInstallment">, billings: Billing[]): Billing | undefined {
  const matches = billings.filter((b) => b.type === spec.billingType && b.status !== "cancelada" && (b.installment ?? 1) === spec.billingInstallment);
  return matches.find((b) => b.status === "paga") ?? matches[0];
}

/** Vencimento estimado da N-ésima mensalidade quando a cobrança ainda não existe (dia de vencimento nos meses seguintes ao 1º). */
function estimatedDueDate(contract: Pick<Contract, "firstDueDate" | "createdAt" | "billingDay" | "recurrence">, billings: Billing[], n: number): string {
  const step = contract.recurrence === "anual" ? 12 : 1;
  const comp = addMonths(firstCompetence(contract, billings), (n - 1) * step);
  const [y, m] = comp.split("-").map(Number);
  const last = new Date(Date.UTC(y, m, 0)).getUTCDate();
  return new Date(Date.UTC(y, m - 1, Math.min(contract.billingDay, last), 12)).toISOString();
}

function isOverdue(b: Billing | undefined, today: string): boolean {
  return Boolean(b && (b.status === "vencida" || (b.status === "aberta" && dateKey(b.dueDate) < today)));
}

export interface EvaluateInput {
  rule: CommissionRuleSnapshot;
  spec: SlotSpec;
  item: Pick<EffectiveContractItem, "productName" | "quantity" | "discountPct">;
  contract: Contract;
  billings: Billing[];
  /** Data da venda (ISO). */
  saleDate: string;
  now: Date;
}

export function evaluateSlot(input: EvaluateInput): SlotEvaluation {
  const { rule, spec, item, contract, billings, saleDate, now } = input;
  const today = dateKey(now);
  const nowIso = now.toISOString();
  const steps: CommissionCalcStep[] = [];
  const billing = slotBilling(spec, billings);
  const paid = billing?.status === "paga" ? billing : undefined;

  // 1. Regra
  const ruleText = `${rule.name} · ${COMMISSION_SCOPE_LABELS[rule.scope]}${rule.reason ? ` · motivo: ${rule.reason}` : ""}`;
  steps.push({ label: "Regra aplicada", value: ruleText });

  // 2. Base
  const received = rule.baseSource === "recebido";
  let base = spec.expectedBase;
  let baseText: string;
  if (received && paid) {
    const paidAmount = paid.paidAmount ?? paid.amount;
    base = round2(paidAmount * spec.share);
    baseText = `${formatCurrency(paidAmount)} recebidos (${slotLabel(spec)})${spec.share < 0.9999 ? ` × ${pct(spec.share * 100)} de participação de ${item.productName}` : ""} = ${formatCurrency(base)}`;
  } else if (received) {
    baseText = `${formatCurrency(spec.expectedBase)} previstos (${slotLabel(spec)} de ${item.productName}); a base definitiva é o valor efetivamente recebido`;
  } else {
    baseText = `${formatCurrency(spec.expectedBase)} contratados (${spec.revenueType === "recorrencia" ? `${COMMISSION_REVENUE_LABELS.recorrencia.toLowerCase()} de ${item.productName} por competência` : `${COMMISSION_REVENUE_LABELS[spec.revenueType].toLowerCase()} de ${item.productName}`}, líquido${item.discountPct > 0 ? ` de ${pct(item.discountPct)} de desconto` : ""})`;
    if (spec.revenueType === "setup" && (spec.of ?? 1) > 1) baseText += ` · adesão parcelada em ${spec.of}x: comissão sobre o total, com o recebimento da 1ª parcela`;
  }
  steps.push({ label: `Base (${COMMISSION_BASE_LABELS[rule.baseSource].toLowerCase()})`, value: baseText, date: paid?.paidAt });

  // 2b. Natureza da base (motor v3): bruto, líquido com deduções ou referência fixa; depois o teto da base.
  const shaped = shapeBase(rule, base, item, steps);
  const calcBase = shaped.base;

  // 3. Cálculo
  const rawAmount = rule.mode === "percentual" ? (calcBase > 0 ? round2((calcBase * rule.value) / 100) : 0) : commissionValue(rule, base, spec.fullBase, item.quantity);
  const calcText =
    rule.mode === "percentual"
      ? `${pct(rule.value)} × ${formatCurrency(calcBase)} = ${formatCurrency(rawAmount)}`
      : `${formatCurrency(rule.value)} × ${Math.max(1, item.quantity)} un.${spec.fullBase > 0 && base < spec.fullBase ? ` × ${pct((base / spec.fullBase) * 100)} (proporção recebida)` : ""} = ${formatCurrency(rawAmount)}`;
  steps.push({ label: "Cálculo", value: calcText });
  // 3b. Teto do valor final (independente do teto da base).
  const amountCapApplied = Boolean(rule.amountCap && rule.amountCap > 0 && rawAmount > rule.amountCap);
  const amount = amountCapApplied ? round2(rule.amountCap!) : rawAmount;
  if (rule.amountCap && rule.amountCap > 0) {
    steps.push({ label: "Teto da comissão", value: amountCapApplied ? `${formatCurrency(rawAmount)} acima do teto de ${formatCurrency(rule.amountCap)}: comissão limitada a ${formatCurrency(amount)}` : `${formatCurrency(rawAmount)} dentro do teto de ${formatCurrency(rule.amountCap)}` });
  }
  const formula =
    (rule.mode === "percentual"
      ? `${rule.baseCap ? `mín(base elegível; ${formatCurrency(rule.baseCap)})` : "base"} × ${pct(rule.value)}`
      : `${formatCurrency(rule.value)} × quantidade${rule.baseSource === "recebido" ? " × proporção recebida" : ""}`) + (rule.amountCap ? ` (máx. ${formatCurrency(rule.amountCap)})` : "");
  const detail: SlotDetail = { eligibleBase: shaped.eligible, base: calcBase, deductions: shaped.deductions, baseCapApplied: shaped.capped, amountBeforeCap: rawAmount, amountCapApplied };

  // 4. Gatilho
  const trigger = rule.trigger;
  const triggerText = commissionTriggerText(trigger, rule.releaseInstallment);
  const needsSlotPayment = trigger === "pagamento" || trigger === "pagamento_e_permanencia" || (spec.revenueType === "recorrencia" && trigger !== "faturamento") || received;
  let triggeredAt: string | undefined;
  let waiting: string | undefined;
  let awaitingPayment = false;
  let gateBillingId: string | undefined;
  let expectedAt: string | undefined;
  if (trigger === "venda" || trigger === "permanencia") triggeredAt = saleDate;
  else if (trigger === "faturamento") {
    // COM.03: gerada quando a cobrança da parcela é emitida (sem esperar o pagamento).
    if (billing) triggeredAt = billing.createdAt;
    else {
      waiting = `faturamento da ${slotLabel(spec)} (cobrança ainda não gerada)`;
      expectedAt = spec.revenueType === "recorrencia" && contract.recurrence !== "unico" ? estimatedDueDate(contract, billings, spec.billingInstallment) : undefined;
    }
  } else if (trigger === "contrato_assinado") {
    if (contract.signedAt) triggeredAt = contract.signedAt;
    else waiting = "assinatura do contrato";
  } else if (trigger === "mensalidade_n") {
    // Aquisição só com a N-ésima mensalidade paga (política anticancelamento parametrizada por regra).
    const nth = rule.releaseInstallment;
    const gate = slotBilling({ billingType: "mensalidade", billingInstallment: nth }, billings);
    gateBillingId = gate?.id;
    // Previsão (D27): vencimento da N-ésima mensalidade — real quando a cobrança existe, estimada pelo dia de vencimento.
    expectedAt = gate?.dueDate ?? (contract.recurrence === "unico" ? undefined : estimatedDueDate(contract, billings, nth));
    if (contract.recurrence === "unico") waiting = `${nth}ª mensalidade paga (contrato sem mensalidades)`;
    else if (gate?.status === "paga") triggeredAt = gate.paidAt ?? nowIso;
    else {
      waiting = gate ? `pagamento da ${nth}ª mensalidade (vence ${formatDate(gate.dueDate)})` : `pagamento da ${nth}ª mensalidade (cobrança ainda não gerada${expectedAt ? `; previsão ${formatDate(expectedAt)}` : ""})`;
      awaitingPayment = isOverdue(gate, today);
    }
  } else if (trigger === "primeiro_pagamento") {
    const firstPaid = billings.filter((b) => b.status === "paga" && b.paidAt).sort((a, b) => a.paidAt!.localeCompare(b.paidAt!))[0];
    if (firstPaid) triggeredAt = firstPaid.paidAt;
    else {
      waiting = "primeiro pagamento do contrato";
      awaitingPayment = billings.some((b) => isOverdue(b, today));
    }
  }
  if (needsSlotPayment && !waiting) {
    if (paid) triggeredAt = later(triggeredAt, paid.paidAt ?? nowIso);
    else {
      triggeredAt = undefined;
      waiting = billing ? `recebimento da ${slotLabel(spec)} (vence ${formatDate(billing.dueDate)})` : `recebimento da ${slotLabel(spec)} (cobrança ainda não gerada)`;
      awaitingPayment = isOverdue(billing, today);
      if (!expectedAt) expectedAt = billing?.dueDate ?? (spec.revenueType === "recorrencia" && contract.recurrence !== "unico" ? estimatedDueDate(contract, billings, spec.billingInstallment) : undefined);
    }
  }
  if (spec.revenueType === "recorrencia" && rule.installments?.length) {
    steps.push({ label: "Mensalidades comissionáveis", value: `Só ${rule.installments.map((n) => `${n}ª`).join(", ")} mensalidade(s) geram comissão (${trigger === "faturamento" ? "no faturamento" : "após o pagamento"}); as demais não` });
  } else if (spec.revenueType === "recorrencia" && rule.releaseInstallment > 1) {
    steps.push({ label: "Início da recorrência", value: `Comissão a partir da ${rule.releaseInstallment}ª mensalidade paga: mensalidades anteriores não geram comissão${rule.recurringCompetences === null ? "" : ` · ${rule.recurringCompetences} competência(s) no total`}` });
  }
  if (trigger === "mensalidade_n" && spec.revenueType !== "recorrencia") {
    steps.push({ label: "Aquisição", value: `Regra do ${rule.scope === "contrato" ? "contrato" : rule.scope === "vendedor" ? "vendedor" : "padrão"}: a comissão só é adquirida quando a ${rule.releaseInstallment}ª mensalidade é paga (antes disso fica prevista e é cancelada se o contrato for cancelado)` });
  }
  steps.push({
    label: "Gatilho",
    value: triggeredAt ? `${triggerText}: cumprido em ${formatDate(triggeredAt)}` : `${triggerText}: aguardando ${waiting}${awaitingPayment ? " — cobrança vencida" : ""}`,
    date: triggeredAt,
  });

  const competence = billing?.competence ?? spec.estimatedCompetence;
  const result = (status: EvaluatedStatus, extra: Partial<SlotEvaluation> = {}): SlotEvaluation => ({ status, base: calcBase, amount, competence, billing, steps, formula, triggeredAt, waiting, gateBillingId, expectedAt, detail, ...extra });
  if (!triggeredAt) return result(awaitingPayment ? "aguardando_recebimento" : "prevista");

  // 5. Carência
  if (rule.minTenureDays > 0) {
    const start = contract.startDate ?? contract.releasedAt;
    if (!start) {
      steps.push({ label: "Carência", value: `${rule.minTenureDays} dias a partir do início do contrato: aguardando o início (liberação para implantação)` });
      return result("em_carencia", { waiting: "início do contrato para contar a carência" });
    }
    const tenureAt = isoDay(new Date(Date.parse(isoDay(start)) + rule.minTenureDays * DAY_MS).toISOString());
    const eligibleAt = later(isoDay(triggeredAt), tenureAt)!;
    steps.push({ label: "Carência", value: `${rule.minTenureDays} dias a partir de ${formatDate(start)} (início do contrato) → ${formatDate(tenureAt)}`, date: tenureAt });
    if (dateKey(eligibleAt) > today) return result("em_carencia", { eligibleAt, waiting: `fim da carência em ${formatDate(eligibleAt)}` });
    steps.push({ label: "Elegível", value: `Condições cumpridas em ${formatDate(eligibleAt)}`, date: eligibleAt });
    return result("liberada", { eligibleAt, waiting: undefined });
  }
  const eligibleAt = triggeredAt > nowIso ? nowIso : triggeredAt;
  steps.push({ label: "Elegível", value: `Condições cumpridas em ${formatDate(eligibleAt)}`, date: eligibleAt });
  return result("liberada", { eligibleAt, waiting: undefined });
}

/** Descrição curta da regra para listas ("10% sobre o recebido · no recebimento · 12 competências · carência 30 dias"). */
export function describeSnapshot(
  rule: Pick<CommissionRuleSnapshot, "mode" | "value" | "trigger" | "baseSource" | "minTenureDays" | "recurringCompetences" | "releaseInstallment" | "revenueType"> &
    Partial<Pick<CommissionRuleSnapshot, "baseKind" | "deductions" | "referenceValue" | "baseCap" | "amountCap" | "installments">>,
): string {
  const kind = rule.baseKind === "bruto" ? " bruto" : rule.baseKind === "referencia" ? ` de referência (${formatCurrency(rule.referenceValue ?? 0)})` : rule.deductions?.length ? " líquido" : "";
  const value = rule.mode === "percentual" ? `${pct(rule.value)} sobre o ${rule.baseSource === "recebido" ? "recebido" : "contratado"}${kind}` : `${formatCurrency(rule.value)} fixo por unidade`;
  const parts = [value, commissionTriggerText(rule.trigger, rule.releaseInstallment).toLowerCase()];
  if (rule.baseCap) parts.push(`teto da base ${formatCurrency(rule.baseCap)}`);
  if (rule.amountCap) parts.push(`teto da comissão ${formatCurrency(rule.amountCap)}`);
  if (rule.revenueType === "recorrencia" && rule.installments?.length) {
    parts.push(`${rule.installments.length === 1 ? "mensalidade" : "mensalidades"} ${rule.installments.map((n) => `${n}ª`).join(", ")}`);
  } else if (rule.revenueType === "recorrencia") {
    const from = rule.releaseInstallment > 1 ? ` a partir da ${rule.releaseInstallment}ª` : "";
    parts.push(rule.recurringCompetences === null ? `enquanto ativo${from}` : rule.recurringCompetences === 1 ? `1 competência (${rule.releaseInstallment}ª mensalidade)` : `${rule.recurringCompetences} competências${from}`);
  }
  if (rule.minTenureDays > 0) parts.push(`carência de ${rule.minTenureDays} dias`);
  return parts.join(" · ");
}
