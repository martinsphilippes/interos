/**
 * Modelo puro do módulo de Vendas: rótulos, tons, cálculo de totais e de comissão.
 *
 * Sem React e sem firebase: é importado pelo servidor (queries, serviço, comissões) e pelos
 * Client Components (simulador, editor de proposta), para que o número exibido seja o mesmo
 * calculado no servidor.
 */
import type { CommissionRule, LeadTemperature, Opportunity, OpportunityProduct, Proposal, ProposalItem, Visit } from "@/domain/types";
import type { StatusTone } from "@/components/ui/status-dot";
import type { BadgeProps } from "@/components/ui/badge";

export {
  OPPORTUNITY_STAGE_LABELS,
  OPPORTUNITY_STAGE_VARIANT,
  OPPORTUNITY_KIND_LABELS,
  TEMPERATURE_LABELS,
  PROPOSAL_STATUS_LABELS,
  PROPOSAL_STATUS_VARIANT,
} from "@/components/clients/labels";

type Variant = NonNullable<BadgeProps["variant"]>;

export const TEMPERATURE_TONE: Record<LeadTemperature, StatusTone> = { quente: "danger", morno: "warning", frio: "info" };

export const VISIT_STATUS_LABELS: Record<Visit["status"], string> = { agendada: "Agendada", realizada: "Realizada", cancelada: "Cancelada", remarcada: "Remarcada" };
export const VISIT_STATUS_VARIANT: Record<Visit["status"], Variant> = { agendada: "info", realizada: "success", cancelada: "muted", remarcada: "warning" };

export const REVENUE_TYPE_LABELS: Record<CommissionRule["revenueType"], string> = { setup: "Adesão/setup", recorrencia: "Recorrência", hardware: "Hardware" };
export const REVENUE_TYPES: CommissionRule["revenueType"][] = ["setup", "recorrencia", "hardware"];

export const COMMISSION_STATUS_LABELS = { prevista: "Prevista", liberada: "Liberada", paga: "Paga", cancelada: "Cancelada" } as const;

export function isOpenStage(stage: Opportunity["stage"]): boolean {
  return stage !== "ganho" && stage !== "perdido";
}

/**
 * Código curto e estável da oportunidade para exibição: "OP-<ano de criação>-<4 dígitos>".
 * Ids determinísticos do seed (opp_001) viram 0001; ids automáticos do Firestore usam os 4 últimos caracteres
 * alfanuméricos do id automático do Firestore, em maiúsculas. Não é gravado: é derivado do id.
 */
export function opportunityCode(opp: Pick<Opportunity, "id" | "createdAt">): string {
  const year = (opp.createdAt ?? "").slice(0, 4) || "0000";
  const digits = opp.id.match(/^[a-z]+_(\d+)$/)?.[1];
  const tail = digits ? digits.slice(-4).padStart(4, "0") : opp.id.replace(/[^a-zA-Z0-9]/g, "").slice(-4).toUpperCase();
  return `OP-${year}-${tail}`;
}

/** Duração legível de uma ligação: "6min 18s", "45s" (vazio sem duração). */
export function formatCallDuration(seconds: number | undefined): string {
  if (!seconds || seconds <= 0) return "";
  const m = Math.floor(seconds / 60);
  const s = seconds % 60;
  return m > 0 ? `${m}min ${String(s).padStart(2, "0")}s` : `${s}s`;
}

// ---------------------------------------------------------------------------
// Totais
// ---------------------------------------------------------------------------

export interface Totals {
  setupTotal: number;
  monthlyTotal: number;
  hardwareTotal: number;
}

const round2 = (n: number) => Math.round(n * 100) / 100;

export function productTotals(products: Pick<OpportunityProduct, "setupValue" | "monthlyValue" | "hardwareValue">[]): Totals {
  return {
    setupTotal: round2(products.reduce((s, p) => s + (Number(p.setupValue) || 0), 0)),
    monthlyTotal: round2(products.reduce((s, p) => s + (Number(p.monthlyValue) || 0), 0)),
    hardwareTotal: round2(products.reduce((s, p) => s + (Number(p.hardwareValue) || 0), 0)),
  };
}

/** Item com o desconto aplicado a adesão, mensalidade e hardware. */
export function netItem(item: Pick<ProposalItem, "setupValue" | "monthlyValue" | "hardwareValue" | "discountPct">): Totals & { discount: number } {
  const factor = 1 - Math.min(Math.max(Number(item.discountPct) || 0, 0), 100) / 100;
  const setup = round2((Number(item.setupValue) || 0) * factor);
  const monthly = round2((Number(item.monthlyValue) || 0) * factor);
  const hardware = round2((Number(item.hardwareValue) || 0) * factor);
  const gross = (Number(item.setupValue) || 0) + (Number(item.monthlyValue) || 0) + (Number(item.hardwareValue) || 0);
  return { setupTotal: setup, monthlyTotal: monthly, hardwareTotal: hardware, discount: round2(gross - setup - monthly - hardware) };
}

export function proposalTotals(items: Pick<ProposalItem, "setupValue" | "monthlyValue" | "hardwareValue" | "discountPct">[]): Totals & { discountTotal: number } {
  const nets = items.map(netItem);
  return {
    setupTotal: round2(nets.reduce((s, n) => s + n.setupTotal, 0)),
    monthlyTotal: round2(nets.reduce((s, n) => s + n.monthlyTotal, 0)),
    hardwareTotal: round2(nets.reduce((s, n) => s + n.hardwareTotal, 0)),
    discountTotal: round2(nets.reduce((s, n) => s + n.discount, 0)),
  };
}

/**
 * Status efetivo: propostas enviadas/visualizadas/em negociação com validade vencida aparecem
 * como "vencida" (calculado na leitura, sem gravar).
 */
export function effectiveProposalStatus(p: Pick<Proposal, "status" | "validUntil">, todayKey: string): Proposal["status"] {
  if ((p.status === "enviada" || p.status === "visualizada" || p.status === "negociacao") && p.validUntil.slice(0, 10) < todayKey) return "vencida";
  return p.status;
}

// ---------------------------------------------------------------------------
// Comissão
// ---------------------------------------------------------------------------

/** Campos da regra que o cliente precisa (serializável). */
export type CommissionRuleView = Pick<CommissionRule, "id" | "name" | "productId" | "revenueType" | "mode" | "value" | "releaseCondition" | "releaseInstallment">;

/** Regra aplicável: a específica do produto quando houver; senão a padrão (sem produto) do tipo de receita. */
export function pickCommissionRule<T extends CommissionRuleView>(rules: T[], revenueType: CommissionRule["revenueType"], productId?: string): T | undefined {
  const ofType = rules.filter((r) => r.revenueType === revenueType);
  return (productId ? ofType.find((r) => r.productId === productId) : undefined) ?? ofType.find((r) => !r.productId);
}

/** Valor da comissão: percentual sobre a base ou valor fixo por unidade. */
export function commissionAmount(rule: Pick<CommissionRuleView, "mode" | "value">, base: number, quantity = 1): number {
  if (base <= 0) return 0;
  const amount = rule.mode === "percentual" ? (base * rule.value) / 100 : rule.value * Math.max(quantity, 1);
  return round2(amount);
}

export interface CommissionEstimate {
  setup: number;
  recorrencia: number;
  hardware: number;
  total: number;
  rules: Partial<Record<CommissionRule["revenueType"], CommissionRuleView>>;
}

/** Simulação com as regras padrão de cada tipo de receita (a mesma usada no cálculo real sem produto específico). */
export function estimateCommission(rules: CommissionRuleView[], input: { setup: number; recorrencia: number; hardware: number }): CommissionEstimate {
  const out: CommissionEstimate = { setup: 0, recorrencia: 0, hardware: 0, total: 0, rules: {} };
  for (const type of REVENUE_TYPES) {
    const rule = pickCommissionRule(rules, type);
    if (!rule) continue;
    out.rules[type] = rule;
    out[type] = commissionAmount(rule, Number(input[type]) || 0);
  }
  out.total = round2(out.setup + out.recorrencia + out.hardware);
  return out;
}

/** Descrição curta da regra ("25% na venda", "100% na 3ª parcela"). */
export function describeRule(rule: CommissionRuleView): string {
  const value = rule.mode === "percentual" ? `${String(rule.value).replace(".", ",")}%` : `R$ ${String(rule.value).replace(".", ",")} por unidade`;
  const when =
    rule.releaseCondition === "parcela"
      ? `liberada na ${rule.releaseInstallment ?? 3}ª mensalidade paga`
      : rule.releaseCondition === "pagamento"
        ? "liberada no pagamento"
        : rule.releaseCondition === "contrato_assinado"
          ? "liberada na assinatura"
          : "liberada na venda";
  return `${value} · ${when}`;
}

// ---------------------------------------------------------------------------
// Links
// ---------------------------------------------------------------------------

export const opportunityHref = (id: string, base = "/vendas/oportunidades") => `${base}?oportunidade=${id}`;
/** Oportunidade selecionada no workspace da Central de Vendas. */
export const workspaceHref = (id: string) => `/vendas?oportunidade=${id}`;
export const proposalHref = (id: string) => `/vendas/propostas?proposta=${id}`;
export const visitHref = (id: string) => `/vendas/visitas?visita=${id}`;
