/**
 * Aditivos e versões do contrato (D25) — regras PURAS (sem Firestore e sem React): snapshot das cláusulas que o
 * documento cobre, rótulos dos tipos/situações do aditivo e descrição das mudanças "de → para". Usado pelo serviço
 * (src/server/finance/amendments.ts), pelas telas (página do contrato e documento) e pelo seed/verify.
 */
import type { Contract, ContractAmendmentKind, ContractAmendmentStatus, ContractReadjustment, ContractSnapshot } from "./types";
import { SALE_PAYMENT_METHOD_LABELS, SALE_RECURRENCE_LABELS } from "./sale-closing";

type Variant = "default" | "success" | "warning" | "danger" | "info" | "brand" | "purple" | "secondary" | "muted";

export const AMENDMENT_KIND_LABELS: Record<ContractAmendmentKind, string> = {
  itens: "Itens",
  condicoes: "Condições",
  renovacao: "Renovação",
  reajuste: "Reajuste",
  misto: "Itens e condições",
};

export const AMENDMENT_STATUS_LABELS: Record<ContractAmendmentStatus, string> = {
  rascunho: "Rascunho",
  aguardando_assinatura: "Aguardando assinatura",
  assinado: "Assinado",
  aplicado: "Aplicado",
  cancelado: "Cancelado",
};

export const AMENDMENT_STATUS_VARIANT: Record<ContractAmendmentStatus, Variant> = {
  rascunho: "muted",
  aguardando_assinatura: "warning",
  assinado: "info",
  aplicado: "success",
  cancelado: "danger",
};

/** Aditivos ainda em andamento (bloqueiam a criação de outro no mesmo contrato). */
export const AMENDMENT_OPEN_STATUSES: readonly ContractAmendmentStatus[] = ["rascunho", "aguardando_assinatura", "assinado"];

export const READJUSTMENT_TYPE_LABELS: Record<ContractReadjustment["type"], string> = { nenhum: "Sem reajuste", percentual: "Percentual", indice: "Índice" };
export const READJUSTMENT_INDEX_LABELS: Record<NonNullable<ContractReadjustment["index"]>, string> = { ipca: "IPCA", igpm: "IGP-M", inpc: "INPC" };

/** Texto curto do reajuste ("2,5%", "IPCA (índice a informar)", "Sem reajuste"). */
export function describeReadjustment(r: ContractReadjustment | undefined): string {
  if (!r || r.type === "nenhum") return "Sem reajuste";
  if (r.type === "percentual") return `${String(r.percent ?? 0).replace(".", ",")}%`;
  return `${r.index ? READJUSTMENT_INDEX_LABELS[r.index] : "Índice"}${r.pending ? " (índice a informar)" : ""}`;
}

/** Campos do contrato que o snapshot (e o hash do documento) cobrem. */
export const SNAPSHOT_FIELDS = ["items", "setupTotal", "monthlyTotal", "hardwareTotal", "billingDay", "recurrence", "termMonths", "firstDueDate", "startDate", "endDate", "paymentMethod", "setupInstallments", "paymentCondition", "autoRenew", "renewalTermMonths", "readjustment", "noticeDays"] as const;
export type SnapshotField = (typeof SNAPSHOT_FIELDS)[number];

export function contractSnapshot(contract: Contract): ContractSnapshot {
  const snap: ContractSnapshot = {
    version: contract.version,
    items: contract.items.map((i) => ({ productId: i.productId, productName: i.productName, quantity: i.quantity, setupValue: i.setupValue, monthlyValue: i.monthlyValue, hardwareValue: i.hardwareValue, discountPct: i.discountPct })),
    setupTotal: contract.setupTotal,
    monthlyTotal: contract.monthlyTotal,
    hardwareTotal: contract.hardwareTotal,
    billingDay: contract.billingDay,
    recurrence: contract.recurrence,
    termMonths: contract.termMonths,
    signers: contract.signers.map((s) => ({ name: s.name, email: s.email, role: s.role })),
  };
  if (contract.firstDueDate) snap.firstDueDate = contract.firstDueDate;
  if (contract.startDate) snap.startDate = contract.startDate;
  if (contract.endDate) snap.endDate = contract.endDate;
  if (contract.paymentMethod) snap.paymentMethod = contract.paymentMethod;
  if (contract.setupInstallments) snap.setupInstallments = contract.setupInstallments;
  if (contract.paymentCondition) snap.paymentCondition = contract.paymentCondition;
  if (contract.documentHash) snap.documentHash = contract.documentHash;
  if (contract.autoRenew !== undefined) snap.autoRenew = contract.autoRenew;
  if (contract.renewalTermMonths) snap.renewalTermMonths = contract.renewalTermMonths;
  if (contract.readjustment) snap.readjustment = contract.readjustment;
  if (contract.noticeDays) snap.noticeDays = contract.noticeDays;
  return snap;
}

/** Contrato "como estava" numa versão: o documento atual com as cláusulas do snapshot (somente leitura). */
export function contractAtSnapshot(contract: Contract, snapshot: ContractSnapshot): Contract {
  const out: Contract = { ...contract, version: snapshot.version, items: snapshot.items, setupTotal: snapshot.setupTotal, monthlyTotal: snapshot.monthlyTotal, hardwareTotal: snapshot.hardwareTotal, billingDay: snapshot.billingDay, recurrence: snapshot.recurrence, termMonths: snapshot.termMonths };
  const bag = out as unknown as Record<string, unknown>;
  for (const f of ["firstDueDate", "startDate", "endDate", "paymentMethod", "setupInstallments", "paymentCondition", "documentHash", "autoRenew", "renewalTermMonths", "readjustment", "noticeDays"] as const) {
    const v = snapshot[f];
    if (v === undefined) delete bag[f];
    else bag[f] = v;
  }
  if (snapshot.signers) out.signers = snapshot.signers.map((s) => ({ ...s, status: "pendente" as const }));
  return out;
}

export const AMENDMENT_FIELD_LABELS: Record<string, string> = {
  items: "Itens",
  setupTotal: "Adesão (total)",
  monthlyTotal: "Mensalidade (total)",
  hardwareTotal: "Hardware (total)",
  billingDay: "Dia de vencimento",
  recurrence: "Recorrência",
  termMonths: "Prazo (meses)",
  firstDueDate: "1º vencimento",
  startDate: "Início da vigência",
  endDate: "Fim da vigência",
  paymentMethod: "Forma de pagamento",
  setupInstallments: "Parcelas da adesão",
  paymentCondition: "Condição de pagamento",
  autoRenew: "Renovação automática",
  renewalTermMonths: "Prazo da renovação (meses)",
  readjustment: "Reajuste",
  noticeDays: "Antecedência da renovação (dias)",
};

function brl(n: number): string {
  return n.toLocaleString("pt-BR", { style: "currency", currency: "BRL" });
}

function dmy(value: string): string {
  const [y, m, d] = value.slice(0, 10).split("-");
  return `${d}/${m}/${y}`;
}

/** Valor legível de um campo do snapshot (itens viram uma lista "2× Produto R$ x/mês"). */
export function describeSnapshotValue(field: string, value: unknown): string {
  if (value === undefined || value === null || value === "") return "—";
  switch (field) {
    case "items": {
      const items = value as ContractSnapshot["items"];
      if (!Array.isArray(items) || items.length === 0) return "sem itens";
      return items
        .map((i) => {
          const factor = 1 - Math.min(Math.max(Number(i.discountPct) || 0, 0), 100) / 100;
          const parts = [i.monthlyValue > 0 ? `${brl(Math.round(i.monthlyValue * factor * 100) / 100)}/mês` : null, i.setupValue > 0 ? `adesão ${brl(Math.round(i.setupValue * factor * 100) / 100)}` : null, i.hardwareValue > 0 ? `hardware ${brl(Math.round(i.hardwareValue * factor * 100) / 100)}` : null].filter(Boolean);
          return `${i.quantity > 1 ? `${i.quantity}× ` : ""}${i.productName}${parts.length ? ` (${parts.join(", ")})` : ""}`;
        })
        .join("; ");
    }
    case "setupTotal":
    case "monthlyTotal":
    case "hardwareTotal":
      return brl(Number(value));
    case "billingDay":
      return `dia ${value}`;
    case "recurrence":
      return SALE_RECURRENCE_LABELS[value as keyof typeof SALE_RECURRENCE_LABELS] ?? String(value);
    case "termMonths":
    case "renewalTermMonths":
      return `${value} meses`;
    case "noticeDays":
      return `${value} dias`;
    case "firstDueDate":
    case "startDate":
    case "endDate":
      return dmy(String(value));
    case "paymentMethod":
      return SALE_PAYMENT_METHOD_LABELS[value as keyof typeof SALE_PAYMENT_METHOD_LABELS] ?? String(value);
    case "setupInstallments":
      return Number(value) > 1 ? `${value}x` : "à vista";
    case "autoRenew":
      return value ? "sim" : "não";
    case "readjustment":
      return describeReadjustment(value as ContractReadjustment);
    default:
      return typeof value === "object" ? JSON.stringify(value) : String(value);
  }
}

/** Tipo do aditivo a partir dos campos alterados. */
export function amendmentKindFor(changedFields: string[], options: { renewal?: boolean; readjustmentOnly?: boolean } = {}): ContractAmendmentKind {
  if (options.renewal) return "renovacao";
  if (options.readjustmentOnly) return "reajuste";
  const items = changedFields.some((f) => f === "items" || f === "setupTotal" || f === "monthlyTotal" || f === "hardwareTotal");
  const conditions = changedFields.some((f) => !["items", "setupTotal", "monthlyTotal", "hardwareTotal"].includes(f));
  if (items && conditions) return "misto";
  return items ? "itens" : "condicoes";
}

/** Assinatura do cliente exigida por padrão quando muda valor/item/prazo/recorrência/vigência. */
export function amendmentRequiresSignatureByDefault(changedFields: string[]): boolean {
  return changedFields.some((f) => ["items", "setupTotal", "monthlyTotal", "hardwareTotal", "termMonths", "recurrence", "endDate", "billingDay", "paymentMethod", "setupInstallments"].includes(f));
}
