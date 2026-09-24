import "server-only";
import { createHash, randomUUID } from "node:crypto";
import type { Contract } from "@/domain/types";
import { isConnected } from "@/server/integrations/status";

/**
 * Adaptador de assinatura digital. A interface é a mesma que um provedor real (Clicksign, D4Sign,
 * DocuSign…) implementaria. Hoje só existe a implementação MANUAL: o INTEROS gera o documento do contrato
 * (versão imprimível em /financeiro/contratos/[id]/documento) com o hash SHA-256 do conteúdo, o Financeiro
 * envia ao cliente por conta própria (e-mail/WhatsApp) e registra cada assinatura com evidência.
 * Nada é enviado para fora. Para ligar um provedor: implementar `SignatureProvider`, marcar a opção como
 * implementada no catálogo (src/server/integrations/status.ts) e devolvê-lo em `getSignatureProvider()`
 * quando `isConnected("assinatura")`.
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
  /** Texto do lembrete (no modo manual, o usuário envia pelo próprio e-mail). */
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

/** Identificador do documento gerado para assinatura manual (no lugar do envelope do provedor). */
function manualDocumentId(contract: Contract): string {
  return `DOC-${contract.number}-v${contract.version}-${randomUUID().slice(0, 6)}`;
}

export const manualSignatureProvider: SignatureProvider = {
  name: "manual",
  async createEnvelope(contract) {
    return {
      provider: "manual",
      envelopeId: manualDocumentId(contract),
      documentHash: contractDocumentHash(contract),
      sentAt: new Date().toISOString(),
    };
  },
  async sendReminder(contract, signerEmail) {
    const signer = contract.signers.find((s) => s.email === signerEmail);
    return {
      provider: "manual",
      envelopeId: contract.signatureEnvelopeId ?? "",
      email: signerEmail,
      sentAt: new Date().toISOString(),
      message: `Lembrete de assinatura do contrato ${contract.number} v${contract.version} para ${signer?.name ?? signerEmail} (${signerEmail}).`,
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

/** @deprecated Nome antigo da implementação local; hoje é o modo manual (nada é simulado). */
export const mockSignatureProvider = manualSignatureProvider;

/** Provedor em uso. Sem adaptador real implementado, sempre o manual. */
export function getSignatureProvider(): SignatureProvider {
  // Ponto de extensão: `if (isConnected("assinatura")) return clicksignProvider;`
  return manualSignatureProvider;
}

/** true quando um provedor real envia o envelope (hoje nunca: não há adaptador implementado). */
export function signatureProviderConnected(): boolean {
  return isConnected("assinatura") && getSignatureProvider().name !== "manual";
}
