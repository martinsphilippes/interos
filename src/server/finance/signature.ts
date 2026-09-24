import "server-only";
import { createHash, randomUUID } from "node:crypto";
import type { Contract } from "@/domain/types";

/**
 * Adaptador de assinatura digital. A interface é a mesma que um provedor real (Clicksign, D4Sign,
 * DocuSign…) implementaria; hoje só existe a implementação MOCK, que gera envelope e hash localmente
 * e não envia nada para fora. Trocar de provedor = implementar `SignatureProvider` e mudar `signatureProvider`.
 */

export interface EnvelopeResult {
  provider: string;
  envelopeId: string;
  /** "sha256:<hex>" do JSON canônico do contrato no momento do envio (evidência de integridade). */
  documentHash: string;
  sentAt: string;
}

export interface ReminderResult {
  provider: string;
  envelopeId: string;
  email: string;
  sentAt: string;
  /** Mensagem registrada na comunicação (mock). */
  message: string;
}

export interface EnvelopeStatus {
  envelopeId: string;
  status: "enviado" | "parcial" | "concluido";
  signers: { email: string; status: Contract["signers"][number]["status"]; signedAt?: string }[];
}

export interface SignatureProvider {
  readonly name: string;
  createEnvelope(contract: Contract, clientName: string): Promise<EnvelopeResult>;
  sendReminder(contract: Contract, signerEmail: string): Promise<ReminderResult>;
  getStatus(contract: Contract): Promise<EnvelopeStatus>;
}

/** Conteúdo que identifica o documento assinado: mudar qualquer campo muda o hash. */
export function contractDocumentHash(contract: Pick<Contract, "number" | "version" | "clientId" | "items" | "setupTotal" | "monthlyTotal" | "hardwareTotal" | "billingDay" | "firstDueDate" | "recurrence" | "termMonths" | "paymentCondition" | "signers">): string {
  const canonical = {
    number: contract.number,
    version: contract.version,
    clientId: contract.clientId,
    items: contract.items.map((i) => ({ productId: i.productId, productName: i.productName, quantity: i.quantity, setupValue: i.setupValue, monthlyValue: i.monthlyValue, hardwareValue: i.hardwareValue, discountPct: i.discountPct })),
    totals: { setup: contract.setupTotal, monthly: contract.monthlyTotal, hardware: contract.hardwareTotal },
    conditions: { billingDay: contract.billingDay, firstDueDate: contract.firstDueDate ?? null, recurrence: contract.recurrence, termMonths: contract.termMonths, paymentCondition: contract.paymentCondition ?? null },
    signers: contract.signers.map((s) => ({ name: s.name, email: s.email, role: s.role })),
  };
  return `sha256:${createHash("sha256").update(JSON.stringify(canonical)).digest("hex")}`;
}

export const mockSignatureProvider: SignatureProvider = {
  name: "mock",
  async createEnvelope(contract) {
    return {
      provider: "mock",
      envelopeId: `env_mock_${randomUUID().slice(0, 8)}`,
      documentHash: contractDocumentHash(contract),
      sentAt: new Date().toISOString(),
    };
  },
  async sendReminder(contract, signerEmail) {
    const signer = contract.signers.find((s) => s.email === signerEmail);
    return {
      provider: "mock",
      envelopeId: contract.signatureEnvelopeId ?? "",
      email: signerEmail,
      sentAt: new Date().toISOString(),
      message: `Lembrete de assinatura do contrato ${contract.number} v${contract.version} enviado para ${signer?.name ?? signerEmail} (${signerEmail}).`,
    };
  },
  async getStatus(contract) {
    const signed = contract.signers.filter((s) => s.status === "assinado").length;
    return {
      envelopeId: contract.signatureEnvelopeId ?? "",
      status: signed === 0 ? "enviado" : signed === contract.signers.length ? "concluido" : "parcial",
      signers: contract.signers.map((s) => ({ email: s.email, status: s.status, signedAt: s.signedAt })),
    };
  },
};

/** Provedor em uso. Único ponto a trocar quando houver integração real. */
export function getSignatureProvider(): SignatureProvider {
  return mockSignatureProvider;
}
