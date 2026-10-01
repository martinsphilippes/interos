/**
 * Modelo do "Resumo do contratado" (D7): o que a venda contratou, em linguagem de negócio, montado a partir
 * do contrato (itens efetivos, líquidos de desconto) e das cobranças. Puro e serializável: montado no servidor
 * (página do contrato, painel lateral, documento, implantação) e exibido por ContractSummaryCard.
 *
 * Contratos antigos (sem os campos do fechamento) viram "Não informado" — nada quebra.
 */
import type { Billing, Contract } from "@/domain/types";
import { contractEffectiveItems } from "@/domain/sale-closing";

export type SummaryBillingState = "pago" | "em_aberto" | "vencido" | "sem_cobranca";

export interface ContractSummaryData {
  id: string;
  number: string;
  version: number;
  status: Contract["status"];
  financialStatus: Contract["financialStatus"];
  items: { productId: string; productName: string; quantity: number; setupValue: number; monthlyValue: number; hardwareValue: number; discountPct: number }[];
  monthlyTotal: number;
  setupTotal: number;
  hardwareTotal: number;
  setupInstallments?: number;
  billingDay: number;
  firstDueDate?: string;
  nextDueDate?: string;
  recurrence: Contract["recurrence"];
  termMonths: number;
  paymentMethod?: Contract["paymentMethod"];
  paymentCondition?: string;
  implementationRequired?: boolean;
  implementationNotes?: string;
  commercialNotes?: string;
  signature: { generated: boolean; signed: number; total: number; signedAt?: string };
  billingState: SummaryBillingState;
  overdueCount: number;
  saleNumber?: string;
  opportunityId?: string;
  sellerName?: string;
  contactName?: string;
  contactPhone?: string;
  contactEmail?: string;
  startDate?: string;
  endDate?: string;
  cancelledAt?: string;
  cancelReason?: string;
  /** Valores ocultos ("Visualizar valores", A13): os números chegam zerados e o card mostra "Restrito". */
  valuesHidden?: boolean;
}

export interface SummaryContext {
  billings?: Billing[];
  sellerName?: string;
  contact?: { name?: string; phone?: string; whatsapp?: string; email?: string } | null;
}

function billingStateOf(billings: Billing[]): SummaryBillingState {
  const active = billings.filter((b) => b.status !== "cancelada");
  if (active.length === 0) return "sem_cobranca";
  if (active.some((b) => b.status === "vencida")) return "vencido";
  if (active.some((b) => b.status === "aberta")) return "em_aberto";
  return "pago";
}

export function buildContractSummary(contract: Contract, ctx: SummaryContext = {}): ContractSummaryData {
  const billings = ctx.billings ?? [];
  const pending = billings.filter((b) => b.status === "aberta" || b.status === "vencida").sort((a, b) => a.dueDate.localeCompare(b.dueDate));
  const signed = contract.signers.filter((s) => s.status === "assinado").length;
  // Contato: o responsável da venda; contratos antigos caem no signatário principal (o contratante).
  const signer = contract.signers.find((s) => s.role === "Contratante") ?? contract.signers[0];
  return {
    id: contract.id,
    number: contract.number,
    version: contract.version,
    status: contract.status,
    financialStatus: contract.financialStatus,
    items: contractEffectiveItems(contract).map((i) => ({ productId: i.productId, productName: i.productName, quantity: i.quantity, setupValue: i.setupValue, monthlyValue: i.monthlyValue, hardwareValue: i.hardwareValue, discountPct: i.discountPct })),
    monthlyTotal: contract.monthlyTotal,
    setupTotal: contract.setupTotal,
    hardwareTotal: contract.hardwareTotal,
    setupInstallments: contract.setupInstallments,
    billingDay: contract.billingDay,
    firstDueDate: contract.firstDueDate,
    nextDueDate: pending[0]?.dueDate,
    recurrence: contract.recurrence,
    termMonths: contract.termMonths,
    paymentMethod: contract.paymentMethod,
    paymentCondition: contract.paymentCondition,
    implementationRequired: contract.implementationRequired,
    implementationNotes: contract.implementationNotes,
    commercialNotes: contract.commercialNotes,
    signature: { generated: Boolean(contract.signatureEnvelopeId), signed, total: contract.signers.length, signedAt: contract.signedAt },
    billingState: billingStateOf(billings),
    overdueCount: billings.filter((b) => b.status === "vencida").length,
    saleNumber: contract.saleNumber,
    opportunityId: contract.opportunityId,
    sellerName: ctx.sellerName,
    contactName: ctx.contact?.name ?? signer?.name,
    contactPhone: ctx.contact?.phone ?? ctx.contact?.whatsapp,
    contactEmail: ctx.contact?.email ?? signer?.email,
    startDate: contract.startDate,
    endDate: contract.endDate,
    cancelledAt: contract.cancelledAt,
    cancelReason: contract.cancelReason,
  };
}

/**
 * Resumo sem valores (A13): quem monta o resumo no servidor chama isto quando o usuário não tem "Visualizar valores"
 * — os números não saem do servidor e o card mostra "Restrito". A condição de pagamento (texto livre) é omitida.
 */
export function redactContractSummary(summary: ContractSummaryData): ContractSummaryData {
  return {
    ...summary,
    items: summary.items.map((i) => ({ ...i, setupValue: 0, monthlyValue: 0, hardwareValue: 0 })),
    monthlyTotal: 0,
    setupTotal: 0,
    hardwareTotal: 0,
    paymentCondition: summary.paymentCondition ? "Restrito" : undefined,
    valuesHidden: true,
  };
}
