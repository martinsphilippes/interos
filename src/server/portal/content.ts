/**
 * Montagem do conteúdo do Portal do Cliente (D31) — PURO (sem banco nem requisição) para ser testado isoladamente.
 *
 * Recebe os registros do cliente dono do link e devolve SÓ o que o cliente pode ver: contratos vigentes (resumo
 * essencial, sem vendedor, venda, comissão, observações internas, responsável ou ids), documento do contrato
 * assinado e cobranças (tipo, parcela, competência, valor, vencimento, situação, pago em) com linha digitável, PDF /
 * link de pagamento e PIX copia-e-cola SOMENTE quando existirem de fato na cobrança. Nenhum id interno sai daqui
 * (as cobranças levam uma chave posicional opaca).
 */
import { dateKey } from "@/lib/format";
import type { Address, Billing, Client, Contract, ContractAmendment, ContractSignerEntry } from "@/domain/types";
import { buildContractSummary, type ContractSummaryData } from "@/components/finance/contract-summary";

export const PORTAL_BILLING_TYPE_LABELS: Record<Billing["type"], string> = { setup: "Adesão", mensalidade: "Mensalidade", hardware: "Hardware", servico: "Serviço" };

/** Cobranças pagas exibidas (as mais recentes); as em aberto/vencidas aparecem todas. */
export const PORTAL_PAID_LIMIT = 12;

export type PortalBillingStatus = "aberta" | "vencida" | "paga";

export interface PortalBillingView {
  /** Chave posicional (b1, b2…) — nunca o id da cobrança. */
  key: string;
  contractNumber: string;
  typeLabel: string;
  installment?: number;
  competence: string;
  amount: number;
  dueDate: string;
  status: PortalBillingStatus;
  paidAt?: string;
  paidAmount?: number;
  linhaDigitavel?: string;
  /** PDF do boleto (quando registrado). */
  pdfUrl?: string;
  /** Link de pagamento do provedor (quando existe e não há PDF). */
  paymentUrl?: string;
  pixCopiaECola?: string;
}

/** Dados do documento do contrato assinado, sem campos internos (ids, vendedor, observações, evidências, e-mails). */
export interface PortalDocumentData {
  contract: Contract;
  client: Pick<Client, "legalName" | "tradeName">;
  billingData: { legalName?: string; document?: string; email?: string; address: Address };
  sentAt?: string;
  amendments: ContractAmendment[];
  summary: ContractSummaryData;
}

export interface PortalContractView {
  /** Chave posicional (c1, c2…). */
  key: string;
  number: string;
  version: number;
  status: Contract["status"];
  signed: boolean;
  startDate?: string;
  endDate?: string;
  summary: ContractSummaryData;
  /** Só para contrato assinado por todos (documento gerado). */
  document: PortalDocumentData | null;
}

export interface PortalContent {
  clientName: string;
  contracts: PortalContractView[];
  billings: PortalBillingView[];
  openCount: number;
  overdueCount: number;
}

export interface PortalContentInput {
  client: Client;
  contracts: Contract[];
  billings: Billing[];
  /** Aditivos dos contratos do cliente (só os aplicados entram no documento). */
  amendments?: ContractAmendment[];
  /** Dados de faturamento mesclados (cliente + venda) por contrato. */
  billingDataByContract?: Record<string, PortalDocumentData["billingData"]>;
  /** Data de geração do documento para assinatura, por contrato. */
  sentAtByContract?: Record<string, string | undefined>;
  /** Hoje (AAAA-MM-DD, São Paulo). */
  today: string;
}

/** Documento gerado e assinado por todos os signatários. */
export function isContractSignedForPortal(contract: Pick<Contract, "signatureEnvelopeId" | "signers">): boolean {
  return Boolean(contract.signatureEnvelopeId) && contract.signers.length > 0 && contract.signers.every((s) => s.status === "assinado");
}

/**
 * Contrato que o cliente vê: não cancelado, não vencido (vigência terminada sem renovação) e com o documento já
 * gerado para assinatura (ou liberado). Rascunho interno (antes de gerar o documento) não aparece.
 */
export function isContractVisibleInPortal(contract: Pick<Contract, "status" | "endDate" | "signatureEnvelopeId">, today: string): boolean {
  if (contract.status === "cancelado") return false;
  if (contract.status === "liberado" && contract.endDate && dateKey(contract.endDate) < today) return false;
  return Boolean(contract.signatureEnvelopeId) || contract.status === "liberado";
}

/** Situação exibida da cobrança (aberta com vencimento passado = vencida, sem gravar nada). */
export function portalBillingStatus(billing: Pick<Billing, "status" | "dueDate">, today: string): PortalBillingStatus | null {
  if (billing.status === "cancelada") return null;
  if (billing.status === "paga") return "paga";
  if (billing.status === "vencida" || dateKey(billing.dueDate) < today) return "vencida";
  return "aberta";
}

/** Resumo do contratado só com o que é do cliente (sem vendedor, venda, observações internas, contato, id). */
export function clientSafeSummary(summary: ContractSummaryData): ContractSummaryData {
  return {
    id: "",
    number: summary.number,
    version: summary.version,
    status: summary.status,
    financialStatus: summary.financialStatus,
    items: summary.items.map((i) => ({ ...i, productId: "" })),
    monthlyTotal: summary.monthlyTotal,
    setupTotal: summary.setupTotal,
    hardwareTotal: summary.hardwareTotal,
    setupInstallments: summary.setupInstallments,
    billingDay: summary.billingDay,
    firstDueDate: summary.firstDueDate,
    nextDueDate: summary.nextDueDate,
    recurrence: summary.recurrence,
    termMonths: summary.termMonths,
    paymentMethod: summary.paymentMethod,
    paymentCondition: summary.paymentCondition,
    implementationRequired: summary.implementationRequired,
    signature: summary.signature,
    billingState: summary.billingState,
    overdueCount: summary.overdueCount,
    startDate: summary.startDate,
    endDate: summary.endDate,
  };
}

function safeSigner(s: ContractSignerEntry): ContractSignerEntry {
  // Sem e-mail (pode ser de um usuário interno, ex.: a Contratada), evidência, link nem quem registrou.
  return { name: s.name, email: "", role: s.role, status: s.status, signedAt: s.signedAt, method: s.method };
}

/** Contrato para o documento do portal: só as cláusulas; ids, vendedor, observações e evidências saem. */
export function clientSafeContract(contract: Contract): Contract {
  return {
    id: "",
    organizationId: "",
    createdAt: contract.createdAt,
    updatedAt: contract.updatedAt,
    clientId: "",
    number: contract.number,
    version: contract.version,
    status: contract.status,
    items: contract.items.map((i) => ({ productId: "", productName: i.productName, quantity: i.quantity, setupValue: i.setupValue, monthlyValue: i.monthlyValue, hardwareValue: i.hardwareValue, discountPct: i.discountPct })),
    setupTotal: contract.setupTotal,
    monthlyTotal: contract.monthlyTotal,
    hardwareTotal: contract.hardwareTotal,
    billingDay: contract.billingDay,
    firstDueDate: contract.firstDueDate,
    recurrence: contract.recurrence,
    termMonths: contract.termMonths,
    startDate: contract.startDate,
    endDate: contract.endDate,
    signers: contract.signers.map(safeSigner),
    // Só o fato de o documento ter sido gerado (o id do envelope é interno).
    signatureEnvelopeId: contract.signatureEnvelopeId ? "gerado" : undefined,
    signedAt: contract.signedAt,
    documentHash: contract.documentHash,
    paymentCondition: contract.paymentCondition,
    financialStatus: contract.financialStatus,
    documentIds: [],
    paymentMethod: contract.paymentMethod,
    setupInstallments: contract.setupInstallments,
    autoRenew: contract.autoRenew,
    renewalTermMonths: contract.renewalTermMonths,
    readjustment: contract.readjustment ? { type: contract.readjustment.type, percent: contract.readjustment.percent, index: contract.readjustment.index } : undefined,
    noticeDays: contract.noticeDays,
  };
}

/** Aditivo aplicado para a lista do documento (número, tipo, vigência, aplicação) — sem motivo interno nem ids. */
function clientSafeAmendment(a: ContractAmendment): ContractAmendment {
  // Só o que a lista "Aditivos aplicados" do documento mostra; antes/depois, signatários e motivo ficam de fora.
  return { number: a.number, kind: a.kind, status: a.status, effectiveFrom: a.effectiveFrom, appliedAt: a.appliedAt, appliedVersion: a.appliedVersion } as ContractAmendment;
}

function billingView(b: Billing, status: PortalBillingStatus, contractNumber: string, key: string): PortalBillingView {
  const open = status !== "paga";
  const linha = open ? b.boleto?.linhaDigitavel?.trim() || undefined : undefined;
  const pdf = open ? b.boleto?.pdfUrl?.trim() || undefined : undefined;
  return {
    key,
    contractNumber,
    typeLabel: PORTAL_BILLING_TYPE_LABELS[b.type],
    installment: b.installment,
    competence: b.competence,
    amount: b.amount,
    dueDate: b.dueDate,
    status,
    paidAt: status === "paga" ? b.paidAt : undefined,
    paidAmount: status === "paga" ? b.paidAmount : undefined,
    // Meios de pagamento só para o que está em aberto/vencido e só quando existem de fato (nada simulado).
    linhaDigitavel: linha,
    pdfUrl: pdf,
    paymentUrl: open && !pdf ? b.paymentUrl?.trim() || undefined : undefined,
    pixCopiaECola: open ? b.pix?.copiaECola?.trim() || undefined : undefined,
  };
}

/** Conteúdo do portal (somente leitura) do cliente dono do link. */
export function buildPortalContent(input: PortalContentInput): PortalContent {
  const { client, today } = input;
  const contracts = input.contracts
    .filter((c) => c.clientId === client.id && isContractVisibleInPortal(c, today))
    .sort((a, b) => (b.startDate ?? b.createdAt).localeCompare(a.startDate ?? a.createdAt) || a.number.localeCompare(b.number));
  const numberOf = new Map(input.contracts.map((c) => [c.id, c.number]));

  const contractViews: PortalContractView[] = contracts.map((c, i) => {
    const own = input.billings.filter((b) => b.contractId === c.id);
    const summary = clientSafeSummary(buildContractSummary(c, { billings: own }));
    const signed = isContractSignedForPortal(c);
    const amendments = (input.amendments ?? []).filter((a) => a.contractId === c.id && a.status === "aplicado").map(clientSafeAmendment);
    return {
      key: `c${i + 1}`,
      number: c.number,
      version: c.version,
      status: c.status,
      signed,
      startDate: c.startDate,
      endDate: c.endDate,
      summary,
      document: signed
        ? {
            contract: clientSafeContract(c),
            client: { legalName: client.legalName, tradeName: client.tradeName },
            billingData: input.billingDataByContract?.[c.id] ?? { legalName: client.legalName, document: client.document, email: client.email, address: client.address ?? {} },
            sentAt: input.sentAtByContract?.[c.id],
            amendments,
            summary,
          }
        : null,
    };
  });

  // Cobranças do cliente (de qualquer contrato não cancelado), sem as canceladas: em aberto/vencidas todas,
  // pagas só as mais recentes.
  const live = input.billings
    .filter((b) => b.clientId === client.id)
    .map((b) => ({ b, status: portalBillingStatus(b, today) }))
    .filter((x): x is { b: Billing; status: PortalBillingStatus } => x.status !== null);
  const pending = live.filter((x) => x.status !== "paga").sort((a, b) => a.b.dueDate.localeCompare(b.b.dueDate) || (a.b.installment ?? 0) - (b.b.installment ?? 0));
  const paid = live
    .filter((x) => x.status === "paga")
    .sort((a, b) => (b.b.paidAt ?? b.b.dueDate).localeCompare(a.b.paidAt ?? a.b.dueDate))
    .slice(0, PORTAL_PAID_LIMIT);
  const billings = [...pending, ...paid].map((x, i) => billingView(x.b, x.status, numberOf.get(x.b.contractId) ?? "", `b${i + 1}`));

  return {
    clientName: client.tradeName,
    contracts: contractViews,
    billings,
    openCount: billings.filter((b) => b.status === "aberta").length,
    overdueCount: billings.filter((b) => b.status === "vencida").length,
  };
}
