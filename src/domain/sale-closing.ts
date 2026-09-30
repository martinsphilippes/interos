/**
 * Circuito Venda → Contrato: regras puras do fechamento estruturado e dos itens efetivos do contrato.
 * Sem Firestore e sem React: importado pelos serviços (Vendas, Financeiro, Implantação), pelos componentes
 * (WonDialog, Resumo do contratado) e pelo seed, para que o número exibido seja o mesmo gravado.
 */
import type { Contract, OpportunityClosing, ProposalItem, SalePaymentMethod } from "./types";

export const SALE_PAYMENT_METHOD_LABELS: Record<SalePaymentMethod, string> = {
  boleto: "Boleto",
  pix: "PIX",
  cartao: "Cartão",
  transferencia: "Transferência",
  dinheiro: "Dinheiro",
};

export const SALE_RECURRENCE_LABELS: Record<OpportunityClosing["recurrence"], string> = { mensal: "Mensal", anual: "Anual", unico: "Pagamento único" };

/** Padrões usados quando a venda não trouxe condições (vendas antigas) — os mesmos que o Financeiro já usava. */
export const DEFAULT_CLOSING = {
  paymentMethod: "boleto",
  billingDay: 10,
  termMonths: 12,
  recurrence: "mensal",
  setupInstallments: 1,
  implementationRequired: true,
} as const satisfies Partial<OpportunityClosing>;

export const MAX_SETUP_INSTALLMENTS = 12;

const round2 = (n: number) => Math.round(n * 100) / 100;

function brl(n: number): string {
  return n.toLocaleString("pt-BR", { style: "currency", currency: "BRL" });
}

/** "15/10/2026" a partir de ISO ou AAAA-MM-DD (sem conversão de fuso). */
function dayMonthYear(value: string): string {
  const [y, m, d] = value.slice(0, 10).split("-");
  return `${d}/${m}/${y}`;
}

/**
 * Texto da condição de pagamento gerado a partir do fechamento (usado quando o vendedor não digita um texto
 * livre). Ex.: "Boleto · adesão em 3x de R$ 400,00 · mensalidade todo dia 10 · 12 meses · 1º vencimento 15/10/2026".
 */
export function closingPaymentConditionText(
  closing: Pick<OpportunityClosing, "paymentMethod" | "billingDay" | "firstDueDate" | "termMonths" | "recurrence" | "setupInstallments">,
  totals?: { setupTotal: number; monthlyTotal: number },
): string {
  const parts: string[] = [SALE_PAYMENT_METHOD_LABELS[closing.paymentMethod] ?? closing.paymentMethod];
  const setup = totals?.setupTotal ?? 0;
  if (!totals || setup > 0) {
    parts.push(closing.setupInstallments > 1 ? `adesão em ${closing.setupInstallments}x${setup > 0 ? ` de ${brl(round2(setup / closing.setupInstallments))}` : ""}` : "adesão à vista");
  }
  if (closing.recurrence === "unico") parts.push("pagamento único");
  else if (!totals || totals.monthlyTotal > 0) parts.push(`${closing.recurrence === "anual" ? "anuidade" : "mensalidade"} todo dia ${closing.billingDay}`);
  parts.push(`${closing.termMonths} meses`);
  if (closing.firstDueDate) parts.push(`1º vencimento ${dayMonthYear(closing.firstDueDate)}`);
  return parts.join(" · ");
}

/**
 * Divide a adesão em N parcelas com centavos exatos: as N-1 primeiras arredondadas para baixo, a última
 * recebe o resto (a soma é sempre igual ao total).
 */
export function splitInstallments(total: number, count: number): number[] {
  const n = Math.max(1, Math.min(MAX_SETUP_INSTALLMENTS, Math.floor(count) || 1));
  const cents = Math.round(total * 100);
  const base = Math.floor(cents / n);
  return Array.from({ length: n }, (_, i) => (i === n - 1 ? cents - base * (n - 1) : base) / 100);
}

// ---------------------------------------------------------------------------
// Itens efetivos do contrato (fonte única para client_products e, na etapa 2, comissões)
// ---------------------------------------------------------------------------

/** Item do contrato com o desconto já aplicado (valores da linha, líquidos). */
export interface EffectiveContractItem {
  productId: string;
  productName: string;
  quantity: number;
  /** Valores líquidos de desconto (totais da linha, como em OpportunityProduct). */
  setupValue: number;
  monthlyValue: number;
  hardwareValue: number;
  /** Valores de tabela/negociados antes do desconto. */
  grossSetupValue: number;
  grossMonthlyValue: number;
  grossHardwareValue: number;
  discountPct: number;
}

/** Aplica o desconto de um item de contrato/proposta (mesma regra de netItem em components/sales/model). */
export function netContractItem(item: ProposalItem): EffectiveContractItem {
  const pct = Math.min(Math.max(Number(item.discountPct) || 0, 0), 100);
  const factor = 1 - pct / 100;
  return {
    productId: item.productId,
    productName: item.productName,
    quantity: item.quantity,
    setupValue: round2((Number(item.setupValue) || 0) * factor),
    monthlyValue: round2((Number(item.monthlyValue) || 0) * factor),
    hardwareValue: round2((Number(item.hardwareValue) || 0) * factor),
    grossSetupValue: Number(item.setupValue) || 0,
    grossMonthlyValue: Number(item.monthlyValue) || 0,
    grossHardwareValue: Number(item.hardwareValue) || 0,
    discountPct: pct,
  };
}

/**
 * Itens EFETIVOS do contrato: depois que o contrato existe, `contract.items` é a verdade (D4). Devolve cada
 * item líquido de desconto. Ponto de entrada para quem deriva valores do contrato: client_products (hoje) e o
 * motor de comissões (etapa 2).
 */
export function contractEffectiveItems(contract: Pick<Contract, "items">): EffectiveContractItem[] {
  return (contract.items ?? []).map(netContractItem);
}

/** Totais líquidos dos itens efetivos. */
export function effectiveTotals(items: EffectiveContractItem[]): { setupTotal: number; monthlyTotal: number; hardwareTotal: number } {
  return {
    setupTotal: round2(items.reduce((s, i) => s + i.setupValue, 0)),
    monthlyTotal: round2(items.reduce((s, i) => s + i.monthlyValue, 0)),
    hardwareTotal: round2(items.reduce((s, i) => s + i.hardwareValue, 0)),
  };
}
