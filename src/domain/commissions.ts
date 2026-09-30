/**
 * Comissões v2 e Contas a Pagar: rótulos, tons e grupos de status. Puro (sem Firestore e sem React): usado pelos
 * serviços, pelas telas do Financeiro e pelos relatórios, para que o texto exibido seja o mesmo em todo lugar.
 */
import type {
  CommissionBaseSource,
  CommissionRevenueType,
  CommissionRuleScope,
  CommissionStatus,
  CommissionTrigger,
  PayableCategory,
  PayableOrigin,
  PayableStatus,
} from "./types";

type Variant = "default" | "success" | "warning" | "danger" | "info" | "brand" | "purple" | "secondary" | "muted";

export const COMMISSION_REVENUE_LABELS: Record<CommissionRevenueType, string> = { setup: "Adesão/setup", recorrencia: "Recorrência", hardware: "Hardware" };
export const COMMISSION_REVENUE_TYPES: CommissionRevenueType[] = ["setup", "recorrencia", "hardware"];

export const COMMISSION_STATUSES: CommissionStatus[] = ["prevista", "em_carencia", "aguardando_recebimento", "liberada", "titulo_gerado", "paga", "bloqueada", "cancelada", "estornada"];

/** "liberada" é exibida como "Elegível" (o valor gravado continua "liberada" por compatibilidade). */
export const COMMISSION_STATUS_LABELS: Record<CommissionStatus, string> = {
  prevista: "Prevista",
  em_carencia: "Em carência",
  aguardando_recebimento: "Aguardando recebimento",
  liberada: "Elegível",
  titulo_gerado: "Título gerado",
  paga: "Paga",
  bloqueada: "Bloqueada",
  cancelada: "Cancelada",
  estornada: "Estornada",
};

export const COMMISSION_STATUS_VARIANT: Record<CommissionStatus, Variant> = {
  prevista: "muted",
  em_carencia: "info",
  aguardando_recebimento: "warning",
  liberada: "brand",
  titulo_gerado: "secondary",
  paga: "success",
  bloqueada: "danger",
  cancelada: "muted",
  estornada: "danger",
};

/** Ainda não adquiridas (o motor reavalia; cancelamento do contrato as cancela). */
export const COMMISSION_PENDING_STATUSES: readonly CommissionStatus[] = ["prevista", "em_carencia", "aguardando_recebimento"];
/** Já elegíveis (entram em contas a pagar). */
export const COMMISSION_EARNED_STATUSES: readonly CommissionStatus[] = ["liberada", "titulo_gerado", "paga"];
/** Não contam em nenhum total. */
export const COMMISSION_VOID_STATUSES: readonly CommissionStatus[] = ["cancelada", "estornada"];

export const COMMISSION_TRIGGER_LABELS: Record<CommissionTrigger, string> = {
  venda: "Na venda",
  contrato_assinado: "Na assinatura do contrato",
  primeiro_pagamento: "No primeiro pagamento do contrato",
  pagamento: "No recebimento da cobrança",
  permanencia: "Após a carência (permanência)",
  pagamento_e_permanencia: "Recebimento + carência",
  mensalidade_n: "Na N-ésima mensalidade paga",
};

/** Gatilho por extenso com o número da mensalidade ("Na 3ª mensalidade paga"). */
export function commissionTriggerText(trigger: CommissionTrigger, releaseInstallment?: number): string {
  return trigger === "mensalidade_n" ? `Na ${releaseInstallment ?? 3}ª mensalidade paga` : COMMISSION_TRIGGER_LABELS[trigger];
}

export const COMMISSION_BASE_LABELS: Record<CommissionBaseSource, string> = { contratado: "Valor contratado", recebido: "Valor recebido" };

export const COMMISSION_SCOPE_LABELS: Record<CommissionRuleScope | "produto", string> = { padrao: "Padrão", vendedor: "Por vendedor", contrato: "Exceção por contrato", produto: "Padrão do produto" };

export const PAYABLE_STATUSES: PayableStatus[] = ["previsto", "aprovado", "a_pagar", "pago", "cancelado"];
export const PAYABLE_STATUS_LABELS: Record<PayableStatus, string> = { previsto: "Previsto", aprovado: "Aprovado", a_pagar: "A pagar", pago: "Pago", cancelado: "Cancelado" };
export const PAYABLE_STATUS_VARIANT: Record<PayableStatus, Variant> = { previsto: "muted", aprovado: "info", a_pagar: "warning", pago: "success", cancelado: "muted" };

export const PAYABLE_CATEGORIES: PayableCategory[] = ["comissao_comercial", "bonus", "outros", "estorno_comissao"];
export const PAYABLE_CATEGORY_LABELS: Record<PayableCategory, string> = { comissao_comercial: "Comissão comercial", bonus: "Bônus", outros: "Outros", estorno_comissao: "Estorno de comissão" };
export const PAYABLE_ORIGIN_LABELS: Record<PayableOrigin, string> = { comissao_automatica: "Comissão (automática)", bonus: "Bônus", manual: "Lançamento manual", estorno: "Estorno" };

/** "s1" → "Adesão 1/3" etc. (rótulo da parcela da chave). */
export function commissionSlotLabel(slot: string | undefined, revenueType: CommissionRevenueType, installments?: number): string {
  if (!slot) return COMMISSION_REVENUE_LABELS[revenueType];
  if (slot === "hw") return "Hardware";
  if (slot === "total") return "Adesão (total)";
  const n = Number(slot.slice(1));
  if (slot.startsWith("s")) return installments && installments > 1 ? `Adesão ${n}/${installments}` : "Adesão";
  if (slot.startsWith("m")) return `Mensalidade ${n}`;
  return slot;
}
