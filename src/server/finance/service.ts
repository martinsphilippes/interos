import "server-only";
/**
 * Serviço Financeiro: regras de negócio SEM validação de sessão. Usado pelas Server Actions (que validam
 * sessão, permissão e entrada) e pelos handlers de evento (opportunity.won, contract.signed, payment.overdue).
 *
 * Fluxo do contrato: aguardando_contrato → (enviar para assinatura) aguardando_assinatura → (todos assinam)
 * assinado → (gerar cobranças) aguardando_pagamento → (pagamento exigido) pago → (gate) liberado.
 * Pendência pode ser registrada em qualquer ponto antes da liberação.
 *
 * Toda mutação relevante emite evento (timeline do cliente, notificações, KPIs). Erros de regra são lançados
 * como Error com mensagem em português (as actions devolvem a mensagem ao usuário).
 */
import { FieldValue } from "firebase-admin/firestore";
import { batchSet, col, create, getById, list, newId, nowIso, update } from "@/server/db";
import { emitEvent } from "@/server/events";
import { registerHandler } from "@/server/events/emit";
import { registerFinanceHandlers } from "@/server/events/handlers/finance";
import { notify } from "@/server/notifications";
import { addBusinessHours, getHolidays } from "@/server/sla";
import { completeTaskInternal, createTaskInternal } from "@/server/tasks/service";
import { completeGate, getDepartmentManager } from "@/server/workflow/service";
import { createProjectFromContract } from "@/server/implementation/service";
import { proposalTotals } from "@/components/sales/model";
import { dateKey, formatCurrency, formatDate } from "@/lib/format";
import {
  COLLECTIONS,
  type Address,
  type Billing,
  type Client,
  type Contact,
  type Contract,
  type Document,
  type DomainEvent,
  type Opportunity,
  type Proposal,
  type ProposalItem,
  type Settings,
  type Task,
  type UserRef,
  type WorkflowInstance,
  type ContractSignerEntry,
} from "@/domain/types";
import type { RoleKey } from "@/domain/constants";
import { allSigned, buildBillingPlan, defaultFirstDueDate, deriveContractStatus, dueIso, evaluateReleaseGate, listBillingsSwept, round2, SYSTEM_ACTOR } from "./billing";
import { contractDocumentHash, getSignatureProvider } from "./signature";
import { MANUAL, recordCommunication } from "@/server/integrations/communications";
import { sendEmail, sendWhatsappText } from "@/server/integrations/providers";
import { isConnected } from "@/server/integrations/status";
import { telHref, whatsappHref } from "@/components/clients/contact-links";
import { DEFAULT_GATE_SETTINGS, GATE_SETTING_KEY, PAYMENT_REQUIREMENTS, type BillingDataInput, type ContractItemInput, type FinanceGateSettings, type ManualSignatureInput, type RegisterPaymentInput, type UpdateConditionsInput } from "./schemas";

// Registro idempotente dos handlers do Financeiro (ver src/server/events/handlers/finance.ts).
registerFinanceHandlers(registerHandler);

export { SYSTEM_ACTOR };

/** Ator com papel (para exceções do gate, que só gestores/admin podem usar). */
export type FinanceActor = UserRef & { role?: RoleKey; isManager?: boolean };

const TYPE_LABEL: Record<Billing["type"], string> = { setup: "Adesão", mensalidade: "Mensalidade", hardware: "Hardware", servico: "Serviço" };
const OPEN_TASK = new Set<Task["status"]>(["aberta", "em_andamento", "aguardando"]);

// ---------------------------------------------------------------------------
// Utilitários
// ---------------------------------------------------------------------------

export async function loadContract(id: string): Promise<Contract> {
  const contract = await getById<Contract>(COLLECTIONS.contracts, id);
  if (!contract) throw new Error("Contrato não encontrado");
  return contract;
}

async function loadBilling(id: string): Promise<Billing> {
  const billing = await getById<Billing>(COLLECTIONS.billing, id);
  if (!billing) throw new Error("Cobrança não encontrada");
  return billing;
}

async function loadClient(id: string): Promise<Client> {
  const client = await getById<Client>(COLLECTIONS.clients, id);
  if (!client) throw new Error("Cliente do contrato não encontrado");
  return client;
}

/** Remove campos do documento (o `update` de db.ts ignora `undefined`). */
async function clearFields(name: typeof COLLECTIONS.contracts | typeof COLLECTIONS.billing, id: string, fields: string[]): Promise<void> {
  if (fields.length === 0) return;
  const patch: Record<string, unknown> = { updatedAt: nowIso() };
  for (const f of fields) patch[f] = FieldValue.delete();
  await col(name).doc(id).update(patch);
}

/** Próximo número "CT-AAAA-NNNN" no ano corrente (mesmo formato do módulo de Vendas). */
async function nextContractNumber(): Promise<string> {
  const year = dateKey(new Date()).slice(0, 4);
  const docs = await list<Contract>(COLLECTIONS.contracts);
  const head = `CT-${year}-`;
  let max = 0;
  for (const d of docs) {
    if (!d.number?.startsWith(head)) continue;
    const seq = Number(d.number.slice(head.length));
    if (Number.isFinite(seq) && seq > max) max = seq;
  }
  return `${head}${String(max + 1).padStart(4, "0")}`;
}

async function contractBillings(contractId: string): Promise<Billing[]> {
  return listBillingsSwept({ where: [["contractId", "==", contractId]] });
}

function isSignedContract(contract: Contract): boolean {
  return Boolean(contract.signatureEnvelopeId) && allSigned(contract);
}

/** Itens e condições só mudam enquanto o contrato não foi assinado por todos nem liberado. */
function assertEditable(contract: Contract): void {
  if (contract.status === "liberado") throw new Error("Contrato já liberado não pode ser alterado");
  if (contract.status === "cancelado") throw new Error("Contrato cancelado não pode ser alterado");
  if (isSignedContract(contract)) throw new Error("Contrato já assinado não pode ser alterado. Registre uma pendência se algo precisar mudar.");
}

// ---------------------------------------------------------------------------
// Configuração do gate
// ---------------------------------------------------------------------------

/** Lê o setting "gate_financeiro", criando-o com o padrão na primeira leitura. */
export async function getGateSettings(): Promise<FinanceGateSettings> {
  const docs = await list<Settings>(COLLECTIONS.settings, { where: [["key", "==", GATE_SETTING_KEY]] });
  const value = docs[0]?.value as Partial<FinanceGateSettings> | undefined;
  if (!value) {
    await create<Settings>(
      COLLECTIONS.settings,
      { key: GATE_SETTING_KEY, value: { ...DEFAULT_GATE_SETTINGS }, description: "Critérios do gate financeiro para liberar a implantação." },
      `setting_${GATE_SETTING_KEY}`,
    );
    return { ...DEFAULT_GATE_SETTINGS };
  }
  return {
    exigeContratoAssinado: typeof value.exigeContratoAssinado === "boolean" ? value.exigeContratoAssinado : DEFAULT_GATE_SETTINGS.exigeContratoAssinado,
    exigePagamento: PAYMENT_REQUIREMENTS.includes(value.exigePagamento as FinanceGateSettings["exigePagamento"]) ? (value.exigePagamento as FinanceGateSettings["exigePagamento"]) : DEFAULT_GATE_SETTINGS.exigePagamento,
    permiteExcecaoGestor: typeof value.permiteExcecaoGestor === "boolean" ? value.permiteExcecaoGestor : DEFAULT_GATE_SETTINGS.permiteExcecaoGestor,
  };
}

// ---------------------------------------------------------------------------
// Contrato inicial a partir da oportunidade ganha
// ---------------------------------------------------------------------------

/**
 * Garante um contrato (não cancelado) para a oportunidade ganha. Idempotente: se o módulo de Vendas já
 * criou o contrato, devolve o existente sem emitir nada.
 */
export async function ensureContractForOpportunity(opportunityId: string, actor: UserRef): Promise<Contract | null> {
  const opp = await getById<Opportunity>(COLLECTIONS.opportunities, opportunityId);
  if (!opp || opp.stage !== "ganho") return null;
  const existing = (await list<Contract>(COLLECTIONS.contracts, { where: [["opportunityId", "==", opp.id]] })).find((c) => c.status !== "cancelado");
  if (existing) return existing;

  const client = await loadClient(opp.clientId);
  const [contacts, financeManager, proposal] = await Promise.all([
    list<Contact>(COLLECTIONS.contacts, { where: [["clientId", "==", client.id]] }),
    getDepartmentManager("financeiro"),
    opp.proposalId ? getById<Proposal>(COLLECTIONS.proposals, opp.proposalId) : Promise.resolve(null),
  ]);
  const primary = contacts.find((c) => c.isPrimary) ?? contacts[0];
  // Proposta aceita traz itens com desconto; sem ela, os produtos da oportunidade.
  const items: ProposalItem[] = proposal?.status === "aceita" && proposal.items.length > 0 ? proposal.items : opp.products.map((p) => ({ ...p, discountPct: 0 }));
  const totals = proposalTotals(items);
  const signerEmail = primary?.email ?? opp.billingData?.email ?? client.email;
  const contract = await create<Contract>(COLLECTIONS.contracts, {
    clientId: client.id,
    opportunityId: opp.id,
    proposalId: proposal?.status === "aceita" ? proposal.id : undefined,
    number: await nextContractNumber(),
    version: 1,
    status: "aguardando_contrato",
    items,
    setupTotal: totals.setupTotal,
    monthlyTotal: totals.monthlyTotal,
    hardwareTotal: totals.hardwareTotal,
    billingDay: 10,
    recurrence: "mensal",
    termMonths: 12,
    signers: signerEmail ? [{ name: primary?.name ?? opp.billingData?.legalName ?? client.legalName, email: signerEmail, role: "Contratante", status: "pendente" }] : [],
    paymentCondition: opp.billingData?.paymentCondition,
    financialStatus: "pendente",
    ownerId: financeManager?.id,
    documentIds: [],
    createdBy: actor.id,
  });
  await update<Opportunity>(COLLECTIONS.opportunities, opp.id, { contractId: contract.id });
  await emitEvent({
    type: "contract.created",
    actor,
    clientId: client.id,
    entity: { type: "contract", id: contract.id },
    title: `Contrato ${contract.number} criado (aguardando contrato)`,
    description: [contract.monthlyTotal > 0 ? `${formatCurrency(contract.monthlyTotal)}/mês` : null, contract.setupTotal > 0 ? `adesão ${formatCurrency(contract.setupTotal)}` : null, `${contract.termMonths} meses`].filter(Boolean).join(" · "),
    department: "financeiro",
    payload: { opportunityId: opp.id, ownerId: contract.ownerId, number: contract.number, monthlyTotal: contract.monthlyTotal, setupTotal: contract.setupTotal, hardwareTotal: contract.hardwareTotal, source: "financeiro" },
  });
  return contract;
}

/**
 * Contrato manual para um cliente existente (renovação, aditivo, venda registrada fora do CRM). Nasce em
 * "aguardando contrato", com o contato principal como signatário; itens e condições são preenchidos na
 * página do contrato. Para venda ganha no CRM use `ensureContractForOpportunity` (caminho único).
 */
export async function createManualContract(input: { clientId: string; recurrence: Contract["recurrence"]; termMonths: number; billingDay: number }, actor: UserRef): Promise<Contract> {
  const client = await loadClient(input.clientId);
  const [contacts, financeManager] = await Promise.all([list<Contact>(COLLECTIONS.contacts, { where: [["clientId", "==", client.id]] }), getDepartmentManager("financeiro")]);
  const primary = contacts.find((c) => c.isPrimary) ?? contacts[0];
  const signerEmail = primary?.email ?? client.email;
  const contract = await create<Contract>(COLLECTIONS.contracts, {
    clientId: client.id,
    number: await nextContractNumber(),
    version: 1,
    status: "aguardando_contrato",
    items: [],
    setupTotal: 0,
    monthlyTotal: 0,
    hardwareTotal: 0,
    billingDay: input.billingDay,
    recurrence: input.recurrence,
    termMonths: input.termMonths,
    signers: signerEmail ? [{ name: primary?.name ?? client.legalName, email: signerEmail, role: "Contratante", status: "pendente" }] : [],
    financialStatus: "pendente",
    ownerId: financeManager?.id ?? actor.id,
    documentIds: [],
    createdBy: actor.id,
  });
  await emitEvent({
    type: "contract.created",
    actor,
    clientId: client.id,
    entity: { type: "contract", id: contract.id },
    title: `Contrato ${contract.number} criado manualmente (aguardando contrato)`,
    description: `${input.termMonths} meses · vencimento dia ${input.billingDay} · itens a preencher`,
    department: "financeiro",
    payload: { ownerId: contract.ownerId, number: contract.number, monthlyTotal: 0, setupTotal: 0, hardwareTotal: 0, source: "manual" },
  });
  return contract;
}

// ---------------------------------------------------------------------------
// Edição: itens, condições, dados de faturamento, signatários
// ---------------------------------------------------------------------------

/**
 * Após o envio para assinatura, qualquer alteração gera nova versão: assinaturas são zeradas e o
 * contrato volta para "aguardando contrato" (precisa ser reenviado). Devolve o patch a aplicar.
 */
async function versionPatchIfSent(contract: Contract, actor: UserRef, reason: string): Promise<{ patch: Partial<Contract>; clear: string[]; versioned: boolean }> {
  if (!contract.signatureEnvelopeId) return { patch: {}, clear: [], versioned: false };
  const version = contract.version + 1;
  await emitEvent({
    type: "contract.version_created",
    actor,
    clientId: contract.clientId,
    entity: { type: "contract", id: contract.id },
    title: `Contrato ${contract.number} v${version} criado`,
    description: `${reason}. Assinaturas anteriores (v${contract.version}) descartadas; reenvie para assinatura.`,
    department: "financeiro",
    payload: {
      contractId: contract.id,
      fromVersion: contract.version,
      toVersion: version,
      previous: { items: contract.items, setupTotal: contract.setupTotal, monthlyTotal: contract.monthlyTotal, hardwareTotal: contract.hardwareTotal, documentHash: contract.documentHash, envelopeId: contract.signatureEnvelopeId },
    },
  });
  return {
    patch: {
      version,
      status: contract.status === "pendencia" ? "pendencia" : "aguardando_contrato",
      signers: contract.signers.map((s) => ({ name: s.name, email: s.email, role: s.role, status: "pendente" as const })),
    },
    clear: ["signatureEnvelopeId", "documentHash", "signedAt"],
    versioned: true,
  };
}

export async function updateContractItems(contractId: string, items: ContractItemInput[], actor: UserRef): Promise<{ contract: Contract; versioned: boolean }> {
  const contract = await loadContract(contractId);
  assertEditable(contract);
  const normalized: ProposalItem[] = items.map((i) => ({
    productId: i.productId,
    productName: i.productName,
    quantity: i.quantity,
    setupValue: round2(i.setupValue),
    monthlyValue: round2(i.monthlyValue),
    hardwareValue: round2(i.hardwareValue),
    discountPct: i.discountPct,
  }));
  const totals = proposalTotals(normalized);
  const version = await versionPatchIfSent(contract, actor, "Itens alterados");
  const patch: Partial<Contract> = { ...version.patch, items: normalized, setupTotal: totals.setupTotal, monthlyTotal: totals.monthlyTotal, hardwareTotal: totals.hardwareTotal };
  await update<Contract>(COLLECTIONS.contracts, contract.id, patch);
  await clearFields(COLLECTIONS.contracts, contract.id, version.clear);
  if (!version.versioned) {
    await emitEvent({
      type: "client.updated",
      actor,
      clientId: contract.clientId,
      entity: { type: "contract", id: contract.id },
      title: `Itens do contrato ${contract.number} atualizados`,
      description: `${normalized.length} item(ns) · ${formatCurrency(totals.monthlyTotal)}/mês · adesão ${formatCurrency(totals.setupTotal)} · hardware ${formatCurrency(totals.hardwareTotal)}`,
      department: "financeiro",
      payload: { contractId: contract.id, totals },
    });
  }
  return { contract: { ...contract, ...patch }, versioned: version.versioned };
}

export async function updateContractConditions(input: UpdateConditionsInput, actor: UserRef): Promise<{ versioned: boolean }> {
  const contract = await loadContract(input.contractId);
  assertEditable(contract);
  const version = await versionPatchIfSent(contract, actor, "Condições alteradas");
  const patch: Partial<Contract> = {
    ...version.patch,
    billingDay: input.billingDay,
    recurrence: input.recurrence,
    termMonths: input.termMonths,
    paymentCondition: input.paymentCondition || undefined,
    firstDueDate: input.firstDueDate ? dueIso(input.firstDueDate) : undefined,
  };
  await update<Contract>(COLLECTIONS.contracts, contract.id, patch);
  const clear = [...version.clear];
  if (!input.firstDueDate && contract.firstDueDate) clear.push("firstDueDate");
  if (!input.paymentCondition && contract.paymentCondition) clear.push("paymentCondition");
  await clearFields(COLLECTIONS.contracts, contract.id, clear);
  if (!version.versioned) {
    await emitEvent({
      type: "client.updated",
      actor,
      clientId: contract.clientId,
      entity: { type: "contract", id: contract.id },
      title: `Condições do contrato ${contract.number} atualizadas`,
      description: `Vencimento dia ${input.billingDay} · ${input.termMonths} meses · ${input.recurrence}${input.firstDueDate ? ` · 1º vencimento ${formatDate(dueIso(input.firstDueDate))}` : ""}`,
      department: "financeiro",
      payload: { contractId: contract.id, billingDay: input.billingDay, termMonths: input.termMonths, recurrence: input.recurrence, firstDueDate: input.firstDueDate },
    });
  }
  return { versioned: version.versioned };
}

/** Dados de faturamento herdados: oportunidade (billingData) com fallback para o cadastro do cliente. */
export function mergedBillingData(client: Client, opp: Opportunity | null): { legalName?: string; document?: string; email?: string; address: Address; paymentCondition?: string } {
  const b = opp?.billingData;
  const address: Address = { ...(client.address ?? {}), ...Object.fromEntries(Object.entries(b?.address ?? {}).filter(([, v]) => v !== undefined && v !== "")) };
  return { legalName: b?.legalName || client.legalName, document: b?.document || client.document, email: b?.email || client.email, address, paymentCondition: b?.paymentCondition };
}

/**
 * Completa SOMENTE os dados de faturamento que faltam (nada que já veio da venda é sobrescrito).
 * Grava no cliente e em `opportunity.billingData`.
 */
export async function completeBillingData(input: BillingDataInput & { document?: string }, actor: UserRef): Promise<{ filled: string[] }> {
  const contract = await loadContract(input.contractId);
  const client = await loadClient(contract.clientId);
  const opp = contract.opportunityId ? await getById<Opportunity>(COLLECTIONS.opportunities, contract.opportunityId) : null;
  const current = mergedBillingData(client, opp);
  const filled: string[] = [];
  const clientPatch: Partial<Client> = {};
  const billingPatch: NonNullable<Opportunity["billingData"]> = { ...(opp?.billingData ?? {}) };
  const take = (key: "legalName" | "document" | "email", value: string | undefined, label: string) => {
    if (!value || current[key]) return;
    billingPatch[key] = value;
    if (!client[key]) clientPatch[key] = value;
    filled.push(label);
  };
  take("legalName", input.legalName, "razão social");
  take("document", input.document, "CPF/CNPJ");
  take("email", input.email, "e-mail");
  const addressPatch: Address = {};
  for (const [key, label] of [["street", "logradouro"], ["number", "número"], ["district", "bairro"], ["city", "cidade"], ["state", "UF"], ["zip", "CEP"]] as const) {
    const value = input[key]?.trim();
    if (!value || current.address[key]) continue;
    addressPatch[key] = key === "state" ? value.toUpperCase() : value;
    filled.push(label);
  }
  if (filled.length === 0) throw new Error("Nenhum dado novo: os campos já preenchidos vêm da venda e não são alterados aqui");
  if (Object.keys(addressPatch).length > 0) {
    clientPatch.address = { ...(client.address ?? {}), ...addressPatch };
    billingPatch.address = { ...(billingPatch.address ?? {}), ...addressPatch };
  }
  if (Object.keys(clientPatch).length > 0) await update<Client>(COLLECTIONS.clients, client.id, clientPatch);
  if (opp) await update<Opportunity>(COLLECTIONS.opportunities, opp.id, { billingData: billingPatch });
  await emitEvent({
    type: "client.updated",
    actor,
    clientId: client.id,
    entity: { type: "contract", id: contract.id },
    title: "Dados de faturamento completados pelo Financeiro",
    description: `Preenchido: ${filled.join(", ")}`,
    department: "financeiro",
    payload: { contractId: contract.id, fields: filled },
  });
  return { filled };
}

export async function addSigner(input: { contractId: string; name: string; email: string; role: string }, actor: UserRef): Promise<void> {
  const contract = await loadContract(input.contractId);
  assertEditable(contract);
  const email = input.email.trim().toLowerCase();
  if (contract.signers.some((s) => s.email.toLowerCase() === email)) throw new Error("Este e-mail já é signatário do contrato");
  const signers = [...contract.signers, { name: input.name.trim(), email, role: input.role.trim(), status: "pendente" as const }];
  await update<Contract>(COLLECTIONS.contracts, contract.id, { signers });
  await emitEvent({
    type: "client.updated",
    actor,
    clientId: contract.clientId,
    entity: { type: "contract", id: contract.id },
    title: `Signatário adicionado ao contrato ${contract.number}`,
    description: `${input.name} (${input.role}) · ${email}`,
    department: "financeiro",
    payload: { contractId: contract.id, email },
    timeline: false,
  });
}

export async function removeSigner(input: { contractId: string; email: string }, actor: UserRef): Promise<void> {
  const contract = await loadContract(input.contractId);
  assertEditable(contract);
  const signer = contract.signers.find((s) => s.email.toLowerCase() === input.email.toLowerCase());
  if (!signer) throw new Error("Signatário não encontrado");
  if (signer.status === "assinado") throw new Error("Não é possível remover quem já assinou");
  const signers = contract.signers.filter((s) => s !== signer);
  await update<Contract>(COLLECTIONS.contracts, contract.id, { signers });
  await emitEvent({
    type: "client.updated",
    actor,
    clientId: contract.clientId,
    entity: { type: "contract", id: contract.id },
    title: `Signatário removido do contrato ${contract.number}`,
    description: `${signer.name} · ${signer.email}`,
    department: "financeiro",
    payload: { contractId: contract.id, email: signer.email },
    timeline: false,
  });
}

// ---------------------------------------------------------------------------
// Assinatura: documento gerado no INTEROS + assinatura registrada com evidência
// ---------------------------------------------------------------------------

/**
 * Gera o documento do contrato para assinatura: hash SHA-256 do conteúdo, identificador do documento e
 * status "aguardando assinatura". Sem provedor de assinatura conectado (situação atual) o envio ao cliente é
 * MANUAL (e-mail/WhatsApp do usuário, com o PDF salvo de /financeiro/contratos/[id]/documento).
 */
export async function sendForSignature(contractId: string, actor: UserRef): Promise<Contract> {
  const contract = await loadContract(contractId);
  assertEditable(contract);
  if (contract.items.length === 0) throw new Error("Adicione pelo menos um item antes de gerar o documento do contrato");
  if (contract.signers.length === 0) throw new Error("Adicione pelo menos um signatário antes de gerar o documento do contrato");
  const client = await loadClient(contract.clientId);
  const provider = getSignatureProvider();
  const envelope = await provider.createEnvelope(contract, client.tradeName);
  const manual = envelope.provider === "manual";
  const signers = contract.signers.map((s) => ({ name: s.name, email: s.email, role: s.role, status: "pendente" as const }));
  const patch: Partial<Contract> = {
    status: contract.status === "pendencia" ? "pendencia" : "aguardando_assinatura",
    signatureProvider: envelope.provider,
    signatureEnvelopeId: envelope.envelopeId,
    documentHash: envelope.documentHash,
    signers,
  };
  await update<Contract>(COLLECTIONS.contracts, contract.id, patch);
  await clearFields(COLLECTIONS.contracts, contract.id, contract.signedAt ? ["signedAt"] : []);
  await emitEvent({
    type: "contract.sent_for_signature",
    actor,
    clientId: contract.clientId,
    entity: { type: "contract", id: contract.id },
    title: manual
      ? `Documento do contrato ${contract.number} v${contract.version} gerado para assinatura`
      : `Contrato ${contract.number} v${contract.version} enviado para assinatura`,
    description: manual
      ? `Aguardando assinatura — envio manual ao cliente. ${signers.length} signatário(s): ${signers.map((s) => s.name).join(", ")} · documento ${envelope.envelopeId}`
      : `${signers.length} signatário(s): ${signers.map((s) => s.name).join(", ")} · envelope ${envelope.envelopeId}`,
    department: "financeiro",
    payload: { contractId: contract.id, envelopeId: envelope.envelopeId, provider: envelope.provider, method: manual ? "manual" : "provedor", documentHash: envelope.documentHash, signers: signers.map((s) => s.email), version: contract.version },
  });
  return { ...contract, ...patch };
}

/**
 * Registra a assinatura de um signatário feita fora do sistema (papel, provedor externo, aceite por e-mail).
 * Exige evidência: URL do documento assinado ou descrição, e a data. Grava signedAt, evidence e method
 * "manual" no signatário; quando todos assinaram, o contrato fica assinado (o hash é o do conteúdo gerado).
 */
export async function registerManualSignature(input: ManualSignatureInput, actor: UserRef): Promise<{ allSigned: boolean }> {
  const contract = await loadContract(input.contractId);
  if (!contract.signatureEnvelopeId) throw new Error("Gere o documento do contrato para assinatura antes de registrar assinaturas");
  if (contract.status === "liberado" || contract.status === "cancelado") throw new Error("Contrato encerrado");
  const signer = contract.signers.find((s) => s.email.toLowerCase() === input.email.toLowerCase());
  if (!signer) throw new Error("Signatário não encontrado");
  if (signer.status === "assinado") throw new Error(`${signer.name} já assinou`);
  const evidenceUrl = input.evidenceUrl?.trim() || undefined;
  const description = input.description?.trim() || undefined;
  if (!evidenceUrl && !description) throw new Error("Informe a evidência: link do documento assinado ou uma descrição");
  const signedAt = dueIso(input.signedAt);
  if (dateKey(signedAt) > dateKey(new Date())) throw new Error("A data da assinatura não pode ser futura");
  const now = nowIso();
  const evidence = [description, evidenceUrl].filter(Boolean).join(" · ");
  const signers: ContractSignerEntry[] = contract.signers.map((s) =>
    s === signer ? { ...s, status: "assinado" as const, signedAt, method: "manual" as const, evidence, evidenceUrl, registeredBy: actor.id, registeredAt: now } : s,
  );
  const done = signers.every((s) => s.status === "assinado");
  // O hash identifica o conteúdo assinado: recalculado do contrato (o mesmo gerado no documento).
  const documentHash = contract.documentHash ?? contractDocumentHash(contract);
  const patch: Partial<Contract> = { signers, documentHash };
  if (done) {
    patch.signedAt = signers.map((s) => s.signedAt ?? "").sort().pop() || signedAt;
    if (contract.status !== "pendencia") patch.status = "assinado";
  }
  await update<Contract>(COLLECTIONS.contracts, contract.id, patch);
  if (evidenceUrl) {
    await addContractDocument({ contractId: contract.id, name: `Evidência de assinatura — ${signer.name} (${contract.number} v${contract.version})`, url: evidenceUrl, category: "Contrato assinado" }, actor);
  }
  await emitEvent({
    type: "note.added",
    actor,
    clientId: contract.clientId,
    entity: { type: "contract", id: contract.id },
    title: `${signer.name} assinou o contrato ${contract.number} (registro manual)`,
    description: `${signer.role} · ${signer.email} · assinado em ${formatDate(signedAt)} · evidência: ${evidence}`,
    department: "financeiro",
    payload: { contractId: contract.id, email: signer.email, method: "manual", evidence, evidenceUrl, signedAt, documentHash, envelopeId: contract.signatureEnvelopeId },
  });
  if (done) {
    const version = contract.version;
    // Contrato assinado entra nos documentos do cliente (conta para o gate da jornada).
    await addContractDocument(
      {
        contractId: contract.id,
        name: `Contrato ${contract.number} v${version} assinado · ${contract.signatureEnvelopeId} · ${documentHash.slice(0, 19)}`,
        url: `/financeiro/contratos/${contract.id}/documento`,
        category: "Contrato assinado",
      },
      actor,
    );
    await emitEvent({
      type: "contract.signed",
      actor,
      clientId: contract.clientId,
      entity: { type: "contract", id: contract.id },
      title: `Contrato ${contract.number} assinado por todos`,
      description: `${signers.length} assinatura(s) registrada(s) com evidência · hash ${documentHash.slice(0, 19)}…`,
      department: "financeiro",
      payload: { contractId: contract.id, signedAt: patch.signedAt, envelopeId: contract.signatureEnvelopeId, documentHash, ownerId: contract.ownerId, method: "manual" },
    });
  }
  return { allSigned: done };
}

/**
 * Lembrete de assinatura. Com e-mail conectado (Resend) envia de fato; senão registra o lembrete que o
 * usuário enviou pelo próprio e-mail (link mailto na tela).
 */
export async function sendSignatureReminder(contractId: string, email: string, actor: UserRef): Promise<{ delivered: boolean; manual: boolean }> {
  const contract = await loadContract(contractId);
  if (!contract.signatureEnvelopeId) throw new Error("O documento do contrato ainda não foi gerado para assinatura");
  const signer = contract.signers.find((s) => s.email.toLowerCase() === email.toLowerCase());
  if (!signer) throw new Error("Signatário não encontrado");
  if (signer.status === "assinado") throw new Error(`${signer.name} já assinou`);
  const reminder = await getSignatureProvider().sendReminder(contract, signer.email);
  let sent: Awaited<ReturnType<typeof sendEmail>> | null = null;
  if (isConnected("email")) {
    sent = await sendEmail({
      to: signer.email,
      subject: `Contrato ${contract.number} aguardando sua assinatura`,
      text: `Olá, ${signer.name.split(" ")[0]}!\n\nO contrato ${contract.number} (versão ${contract.version}) da Intercert aguarda a sua assinatura. Código de integridade do documento: ${contract.documentHash ?? "—"}.\n\nQualquer dúvida, responda este e-mail.`,
    });
  }
  const manual = sent === null;
  await recordCommunication({
    clientId: contract.clientId,
    channel: "email",
    direction: "saida",
    userId: actor.id,
    entityType: "contract",
    entityId: contract.id,
    body: reminder.message,
    templateKey: "lembrete_assinatura",
    ...(sent ? { status: sent.ok ? "enviada" : "falha", provider: "resend", externalId: sent.ok ? sent.externalId : undefined } : MANUAL),
    createdBy: actor.id,
  });
  await emitEvent({
    type: "notification.sent",
    actor,
    clientId: contract.clientId,
    entity: { type: "contract", id: contract.id },
    title: manual ? `Lembrete de assinatura enviado manualmente para ${signer.name}` : `Lembrete de assinatura enviado para ${signer.name}`,
    description: `Contrato ${contract.number} · ${signer.email}${manual ? " · enviado pelo e-mail do usuário (registro manual)" : sent?.ok ? "" : " · falha no envio"}`,
    department: "financeiro",
    payload: { contractId: contract.id, email: signer.email, channel: "email", manual, delivered: sent?.ok ?? false },
  });
  return { delivered: sent?.ok ?? false, manual };
}

// ---------------------------------------------------------------------------
// Cobranças e pagamentos
// ---------------------------------------------------------------------------

export async function generateBillings(contractId: string, actor: UserRef): Promise<Billing[]> {
  const contract = await loadContract(contractId);
  if (contract.status === "cancelado") throw new Error("Contrato cancelado");
  if (!isSignedContract(contract)) throw new Error("Gere as cobranças depois que todos assinarem o contrato");
  const existing = (await list<Billing>(COLLECTIONS.billing, { where: [["contractId", "==", contract.id]] })).filter((b) => b.status !== "cancelada");
  if (existing.length > 0) throw new Error("As cobranças deste contrato já foram geradas");
  const firstDueDate = contract.firstDueDate ?? defaultFirstDueDate(contract.billingDay);
  const drafts = buildBillingPlan(contract, firstDueDate);
  if (drafts.length === 0) throw new Error("O contrato não tem valores a cobrar");

  const now = nowIso();
  const writes = drafts.map((d) => ({ id: newId(COLLECTIONS.billing), data: { ...d, organizationId: contract.organizationId, createdAt: now, updatedAt: now, createdBy: actor.id } }));
  await batchSet(writes.map((w) => ({ collection: COLLECTIONS.billing, id: w.id, data: w.data })));
  const created = writes.map((w) => ({ ...w.data, id: w.id }) as Billing);

  const settings = await getGateSettings();
  const status = contract.status === "pendencia" ? "pendencia" : deriveContractStatus(contract, created, settings);
  await update<Contract>(COLLECTIONS.contracts, contract.id, { status, firstDueDate });

  const total = created.reduce((s, b) => s + b.amount, 0);
  const count = (type: Billing["type"]) => created.filter((b) => b.type === type).length;
  await emitEvent({
    type: "billing.created",
    actor,
    clientId: contract.clientId,
    entity: { type: "contract", id: contract.id },
    title: `${created.length} cobrança(s) geradas para o contrato ${contract.number}`,
    description: [
      count("setup") ? `adesão ${formatCurrency(contract.setupTotal)}` : null,
      count("hardware") ? `hardware ${formatCurrency(contract.hardwareTotal)}` : null,
      count("mensalidade") ? `${count("mensalidade")} mensalidade(s)` : null,
      `1º vencimento ${formatDate(firstDueDate)}`,
      `total ${formatCurrency(total)}`,
    ]
      .filter(Boolean)
      .join(" · "),
    department: "financeiro",
    payload: { contractId: contract.id, billingIds: created.map((b) => b.id), total, firstDueDate },
  });
  return created;
}

export async function registerPayment(input: RegisterPaymentInput, actor: UserRef): Promise<Billing> {
  const billing = await loadBilling(input.billingId);
  if (billing.status === "paga") throw new Error("Esta cobrança já está paga");
  if (billing.status === "cancelada") throw new Error("Cobrança cancelada não recebe pagamento");
  const contract = await loadContract(billing.contractId);
  let receiptDocumentId: string | undefined;
  if (input.receiptUrl) {
    const doc = await create<Document>(COLLECTIONS.documents, {
      clientId: billing.clientId,
      entityType: "billing",
      entityId: billing.id,
      name: `Comprovante ${TYPE_LABEL[billing.type]}${billing.installment ? ` ${billing.installment}` : ""} — ${contract.number}`,
      url: input.receiptUrl,
      version: 1,
      uploadedBy: actor.id,
      category: "Comprovante de pagamento",
      createdBy: actor.id,
    });
    receiptDocumentId = doc.id;
    await update<Contract>(COLLECTIONS.contracts, contract.id, { documentIds: [...contract.documentIds, doc.id] });
  }
  const paidAt = dueIso(input.paidAt);
  const patch: Partial<Billing> = { status: "paga", paidAt, paidAmount: round2(input.amount), method: input.method, receiptDocumentId };
  await update<Billing>(COLLECTIONS.billing, billing.id, patch);
  const paid: Billing = { ...billing, ...patch };

  await emitEvent({
    type: "payment.approved",
    actor,
    clientId: billing.clientId,
    entity: { type: "billing", id: billing.id },
    title: `Pagamento registrado: ${TYPE_LABEL[billing.type]}${billing.installment ? ` ${billing.installment}` : ""} de ${formatCurrency(input.amount)}`,
    description: `Contrato ${contract.number} · ${input.method.toUpperCase()} · pago em ${formatDate(paidAt)}${input.amount !== billing.amount ? ` (valor da cobrança ${formatCurrency(billing.amount)})` : ""}`,
    department: "financeiro",
    payload: { billingId: billing.id, contractId: contract.id, clientId: billing.clientId, type: billing.type, installment: billing.installment ?? null, amount: input.amount },
  });

  // Atualiza o status do contrato (ex.: aguardando pagamento → pago).
  if (contract.status !== "liberado" && contract.status !== "cancelado" && contract.status !== "pendencia") {
    const [billings, settings] = await Promise.all([contractBillings(contract.id), getGateSettings()]);
    const next = deriveContractStatus(contract, billings.map((b) => (b.id === paid.id ? paid : b)), settings);
    if (next !== contract.status) await update<Contract>(COLLECTIONS.contracts, contract.id, { status: next });
  }
  return paid;
}

export async function cancelBilling(billingId: string, reason: string, actor: UserRef): Promise<void> {
  const billing = await loadBilling(billingId);
  if (billing.status === "paga") throw new Error("Cobrança paga não pode ser cancelada");
  if (billing.status === "cancelada") throw new Error("Esta cobrança já está cancelada");
  await update<Billing>(COLLECTIONS.billing, billing.id, { status: "cancelada" });
  await emitEvent({
    type: "note.added",
    actor,
    clientId: billing.clientId,
    entity: { type: "billing", id: billing.id },
    title: `Cobrança cancelada: ${TYPE_LABEL[billing.type]}${billing.installment ? ` ${billing.installment}` : ""} de ${formatCurrency(billing.amount)}`,
    description: reason,
    department: "financeiro",
    payload: { billingId: billing.id, contractId: billing.contractId, reason, previousStatus: billing.status },
  });
}

async function billingContext(billingId: string): Promise<{ billing: Billing; client: Client; contact?: Contact }> {
  const billing = await loadBilling(billingId);
  const [client, contacts] = await Promise.all([loadClient(billing.clientId), list<Contact>(COLLECTIONS.contacts, { where: [["clientId", "==", billing.clientId]] })]);
  return { billing, client, contact: contacts.find((c) => c.isPrimary) ?? contacts[0] };
}

function defaultBillingMessage(billing: Billing, contact?: Contact): string {
  return `Olá${contact ? `, ${contact.name.split(" ")[0]}` : ""}! Lembrete da Intercert: ${TYPE_LABEL[billing.type].toLowerCase()}${billing.installment ? ` ${billing.installment}` : ""} de ${formatCurrency(billing.amount)} com vencimento em ${formatDate(billing.dueDate)}. Precisa da 2ª via do boleto ou da chave PIX?`;
}

export interface BillingContactInfo {
  /** Telefone usado no WhatsApp/ligação (contato principal ou cliente). */
  phone?: string;
  contactName: string;
  message: string;
  whatsappUrl: string | null;
  telUrl: string | null;
  whatsappConnected: boolean;
  voipConnected: boolean;
}

/** Destinatário e texto padrão da cobrança, para a tela abrir wa.me/tel: com tudo pronto. */
export async function getBillingContactInfo(billingId: string): Promise<BillingContactInfo> {
  const { billing, client, contact } = await billingContext(billingId);
  const phone = contact?.whatsapp ?? contact?.phone ?? client.whatsapp ?? client.phone;
  return {
    phone,
    contactName: contact?.name ?? client.tradeName,
    message: defaultBillingMessage(billing, contact),
    whatsappUrl: whatsappHref(phone),
    telUrl: telHref(contact?.phone ?? contact?.whatsapp ?? client.phone ?? client.whatsapp),
    whatsappConnected: isConnected("whatsapp"),
    voipConnected: isConnected("voip"),
  };
}

/**
 * Cobrança por WhatsApp. Com a Meta conectada envia pela API; sem integração (situação atual) o usuário
 * abriu o wa.me com o texto e aqui só se registra "cobrança enviada manualmente".
 */
export async function sendBillingWhatsapp(billingId: string, notes: string | undefined, actor: UserRef): Promise<{ manual: boolean; delivered: boolean }> {
  const { billing, client, contact } = await billingContext(billingId);
  const to = contact?.whatsapp ?? contact?.phone ?? client.whatsapp ?? client.phone;
  const body = notes?.trim() || defaultBillingMessage(billing, contact);
  const sent = isConnected("whatsapp") && to ? await sendWhatsappText(to, body) : null;
  const manual = sent === null;
  const communication = await recordCommunication({
    clientId: client.id,
    contactId: contact?.id,
    channel: "whatsapp",
    direction: "saida",
    userId: actor.id,
    entityType: "billing",
    entityId: billing.id,
    body,
    templateKey: "cobranca",
    ...(sent ? { status: sent.ok ? "enviada" : "falha", provider: "meta", externalId: sent.ok ? sent.externalId : undefined } : MANUAL),
    createdBy: actor.id,
  });
  await emitEvent({
    type: "whatsapp.message.sent",
    actor,
    clientId: client.id,
    entity: { type: "billing", id: billing.id },
    title: manual ? `Cobrança enviada manualmente por WhatsApp para ${contact?.name ?? client.tradeName}` : `Cobrança enviada por WhatsApp para ${contact?.name ?? client.tradeName}${sent?.ok ? "" : " (falha no envio)"}`,
    description: body,
    department: "financeiro",
    payload: { billingId: billing.id, contractId: billing.contractId, to, communicationId: communication.id, manual, delivered: sent?.ok ?? false },
  });
  return { manual, delivered: sent?.ok ?? false };
}

/** Ligação de cobrança feita no discador (sem VoIP conectado): registro manual do resultado. */
export async function registerBillingCall(billingId: string, notes: string | undefined, actor: UserRef): Promise<void> {
  const { billing, client, contact } = await billingContext(billingId);
  const communication = await recordCommunication({
    clientId: client.id,
    contactId: contact?.id,
    channel: "voip",
    direction: "saida",
    userId: actor.id,
    entityType: "billing",
    entityId: billing.id,
    body: notes?.trim() || undefined,
    templateKey: "cobranca",
    ...MANUAL,
    createdBy: actor.id,
  });
  await emitEvent({
    type: "call.completed",
    actor,
    clientId: client.id,
    entity: { type: "billing", id: billing.id },
    title: `Ligação de cobrança para ${contact?.name ?? client.tradeName} (registro manual)`,
    description: notes?.trim() || `${TYPE_LABEL[billing.type]}${billing.installment ? ` ${billing.installment}` : ""} de ${formatCurrency(billing.amount)} · vencimento ${formatDate(billing.dueDate)}`,
    department: "financeiro",
    payload: { billingId: billing.id, contractId: billing.contractId, communicationId: communication.id, manual: true },
  });
}

// ---------------------------------------------------------------------------
// Pendências e documentos
// ---------------------------------------------------------------------------

export async function registerPendency(contractId: string, reason: string, actor: UserRef): Promise<void> {
  const contract = await loadContract(contractId);
  if (contract.status === "liberado" || contract.status === "cancelado") throw new Error("Contrato encerrado não recebe pendência");
  if (contract.status === "pendencia") throw new Error("O contrato já está com pendência. Resolva a atual antes de registrar outra.");
  await update<Contract>(COLLECTIONS.contracts, contract.id, { status: "pendencia", financialStatus: "pendencia", pendingReason: reason });
  const client = await loadClient(contract.clientId);
  const opp = contract.opportunityId ? await getById<Opportunity>(COLLECTIONS.opportunities, contract.opportunityId) : null;
  const sellerId = opp?.ownerId ?? client.ownerSalesId;
  const event = await emitEvent({
    type: "payment.pending",
    actor,
    clientId: contract.clientId,
    entity: { type: "contract", id: contract.id },
    title: `Pendência financeira no contrato ${contract.number}`,
    description: reason,
    department: "financeiro",
    payload: { contractId: contract.id, reason, sellerId, previousStatus: contract.status },
  });
  await notify({
    userIds: [sellerId, contract.ownerId].filter((id): id is string => Boolean(id) && id !== actor.id),
    kind: "atencao",
    title: `Pendência financeira: ${client.tradeName}`,
    body: reason,
    href: `/financeiro/contratos/${contract.id}`,
    entity: { type: "contract", id: contract.id },
    eventId: event.id,
  });
}

export async function resolvePendency(contractId: string, resolution: string | undefined, actor: UserRef): Promise<Contract["status"]> {
  const contract = await loadContract(contractId);
  if (contract.status !== "pendencia") throw new Error("O contrato não está com pendência");
  const [billings, settings] = await Promise.all([contractBillings(contract.id), getGateSettings()]);
  const status = deriveContractStatus({ ...contract, status: "aguardando_contrato" }, billings, settings);
  await update<Contract>(COLLECTIONS.contracts, contract.id, { status, financialStatus: "pendente" });
  await clearFields(COLLECTIONS.contracts, contract.id, ["pendingReason"]);
  await emitEvent({
    type: "note.added",
    actor,
    clientId: contract.clientId,
    entity: { type: "contract", id: contract.id },
    title: `Pendência resolvida no contrato ${contract.number}`,
    description: [contract.pendingReason ? `Pendência: ${contract.pendingReason}` : null, resolution ? `Solução: ${resolution}` : null].filter(Boolean).join(" · ") || undefined,
    department: "financeiro",
    payload: { contractId: contract.id, reason: contract.pendingReason, resolution, status },
  });
  return status;
}

export async function addContractDocument(input: { contractId: string; name: string; url: string; category?: string }, actor: UserRef): Promise<string> {
  const contract = await loadContract(input.contractId);
  const doc = await create<Document>(COLLECTIONS.documents, {
    clientId: contract.clientId,
    entityType: "contract",
    entityId: contract.id,
    name: input.name,
    url: input.url,
    version: contract.version,
    uploadedBy: actor.id,
    category: input.category || "Contrato",
    createdBy: actor.id,
  });
  await update<Contract>(COLLECTIONS.contracts, contract.id, { documentIds: [...contract.documentIds, doc.id] });
  await emitEvent({
    type: "document.added",
    actor,
    clientId: contract.clientId,
    entity: { type: "contract", id: contract.id },
    title: `Documento anexado ao contrato ${contract.number}: ${input.name}`,
    department: "financeiro",
    payload: { contractId: contract.id, documentId: doc.id, url: input.url, category: doc.category },
  });
  return doc.id;
}

// ---------------------------------------------------------------------------
// Gate financeiro e liberação para implantação
// ---------------------------------------------------------------------------

export interface ReleaseResult {
  contract: Contract;
  projectId: string | null;
  exception: boolean;
}

/**
 * Libera o contrato para implantação. Sem exceção, exige os critérios do gate (setting "gate_financeiro").
 * Com exceção (gestor/admin, se permitido), grava o motivo no step de workflow via completeGate.
 * Em seguida cria o projeto de implantação e emite financial.released (o handler do workflow avança
 * a etapa Financeiro → Implantação quando ela ainda estiver aberta).
 */
export async function releaseContract(contractId: string, actor: FinanceActor, exceptionReason?: string): Promise<ReleaseResult> {
  const contract = await loadContract(contractId);
  if (contract.status === "liberado") throw new Error("Este contrato já foi liberado");
  if (contract.status === "cancelado") throw new Error("Contrato cancelado não pode ser liberado");
  const [billings, settings, client] = await Promise.all([contractBillings(contract.id), getGateSettings(), loadClient(contract.clientId)]);
  const gate = evaluateReleaseGate(contract, billings, settings);
  const reason = exceptionReason?.trim();
  let exception = false;
  if (!gate.ok) {
    const missing = gate.checks.filter((c) => !c.ok).map((c) => c.label.toLowerCase());
    if (!reason) throw new Error(`Critérios do gate financeiro não cumpridos: ${missing.join(", ")}`);
    if (!settings.permiteExcecaoGestor) throw new Error("A configuração atual não permite liberar com pendência");
    if (!actor.isManager) throw new Error("Só gestores ou administradores podem liberar com pendência");
    exception = true;
  }

  const now = nowIso();
  const startDate = contract.startDate ?? dueIso(dateKey(now));
  const endDate = contract.endDate ?? addMonthsIso(startDate, contract.termMonths);
  await update<Contract>(COLLECTIONS.contracts, contract.id, { status: "liberado", financialStatus: "aprovado", releasedAt: now, releasedBy: actor.id, startDate, endDate });
  await clearFields(COLLECTIONS.contracts, contract.id, contract.pendingReason ? ["pendingReason"] : []);
  const released: Contract = { ...contract, status: "liberado", financialStatus: "aprovado", releasedAt: now, releasedBy: actor.id, startDate, endDate, pendingReason: undefined };

  // Exceção: conclui a etapa Financeiro com o motivo informado (antes do evento, para ficar registrado no step).
  if (exception) await completeFinanceStepWithException(client, contract, actor, reason!, gate.checks.filter((c) => !c.ok).map((c) => c.label));

  // Criação do projeto: caminho único no módulo de Implantação (combina templates, SLA, evento implementation.created).
  const project = await createProjectFromContract(released, actor, client);

  await emitEvent({
    type: "financial.released",
    actor,
    clientId: contract.clientId,
    entity: { type: "contract", id: contract.id },
    title: `Contrato ${contract.number} liberado para implantação${exception ? " (exceção)" : ""}`,
    description: exception ? `Liberado com pendência por ${actor.name}: ${reason}` : `Critérios atendidos: ${gate.checks.map((c) => c.label.toLowerCase()).join(", ")}`,
    department: "financeiro",
    payload: { contractId: contract.id, projectId: project?.id, exceptionReason: exception ? reason : undefined, monthlyTotal: contract.monthlyTotal, setupTotal: contract.setupTotal, checks: gate.checks },
  });

  // Tarefas do processo do contrato (emitir contrato, gerar cobrança e liberar) ficam concluídas.
  const tasks = await list<Task>(COLLECTIONS.tasks, { where: [["processId", "==", contract.id]] });
  for (const task of tasks.filter((t) => t.processType === "contract" && OPEN_TASK.has(t.status))) {
    try {
      await completeTaskInternal(task, actor);
    } catch (error) {
      console.error(`[financeiro] falha ao concluir a tarefa ${task.id}`, error);
    }
  }

  return { contract: released, projectId: project?.id ?? null, exception };
}

function addMonthsIso(iso: string, months: number): string {
  const d = new Date(iso);
  return new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth() + months, d.getUTCDate(), 12)).toISOString();
}

async function completeFinanceStepWithException(client: Client, contract: Contract, actor: FinanceActor, reason: string, missing: string[]): Promise<void> {
  if (!client.workflowInstanceId) return;
  const instance = await getById<WorkflowInstance>(COLLECTIONS.workflowInstances, client.workflowInstanceId);
  if (!instance || instance.status !== "ativo" || instance.currentStageKey !== "financeiro" || !instance.currentStepId) return;
  if (instance.context.contractId !== contract.id) {
    await update<WorkflowInstance>(COLLECTIONS.workflowInstances, instance.id, { context: { ...instance.context, contractId: contract.id } });
  }
  const result = await completeGate({
    stepId: instance.currentStepId,
    actor: { id: actor.id, name: actor.name, role: actor.role },
    exceptionReason: `Liberação financeira com pendência: ${reason} (pendente: ${missing.join(", ") || "—"})`,
    notes: `Contrato ${contract.number} liberado por exceção.`,
  });
  if (result.status !== "completed") console.warn(`[financeiro] etapa financeiro do cliente ${client.id} não concluída por exceção: ${result.status}`);
}

// ---------------------------------------------------------------------------
// Handlers (chamados por src/server/events/handlers/finance.ts)
// ---------------------------------------------------------------------------

/** contract.signed → tarefa "Gerar cobrança e liberar" para o responsável financeiro. */
export async function onContractSigned(event: DomainEvent): Promise<void> {
  const contract = await getById<Contract>(COLLECTIONS.contracts, event.entityId ?? "");
  if (!contract) return;
  const client = await getById<Client>(COLLECTIONS.clients, contract.clientId);
  const assigneeId = contract.ownerId ?? (await getDepartmentManager("financeiro"))?.id;
  const title = `Gerar cobrança e liberar: ${client?.tradeName ?? contract.number}`;
  const existing = await list<Task>(COLLECTIONS.tasks, { where: [["processId", "==", contract.id]] });
  if (existing.some((t) => t.title === title && t.status !== "cancelada")) return;
  const holidays = await getHolidays();
  await createTaskInternal(
    {
      title,
      description: `Contrato ${contract.number} v${contract.version} assinado por todos. Gere as cobranças, confirme o pagamento exigido e libere para a implantação.`,
      clientId: contract.clientId,
      assigneeId,
      departmentId: "financeiro",
      priority: "alta",
      dueAt: addBusinessHours(new Date(event.occurredAt), 8, holidays).toISOString(),
      processType: "contract",
      processId: contract.id,
      origin: "evento",
      sourceEventId: event.id,
      checklist: ["Gerar cobranças", "Confirmar pagamento exigido", "Liberar para implantação"],
      tags: ["financeiro", "contrato"],
    },
    { id: event.actorId, name: event.actorName },
  );
  if (assigneeId) {
    await notify({
      userIds: [assigneeId],
      kind: "acao",
      title: `Contrato assinado: ${client?.tradeName ?? contract.number}`,
      body: `Contrato ${contract.number} assinado por todos. Próximo passo: gerar cobrança e liberar.`,
      href: `/financeiro/contratos/${contract.id}`,
      entity: { type: "contract", id: contract.id },
      eventId: event.id,
    });
  }
}

/** payment.overdue → avisa o financeiro (responsável e gestor) e o vendedor do cliente. */
export async function onPaymentOverdue(event: DomainEvent): Promise<void> {
  const billingId = event.entityType === "billing" && event.entityId ? event.entityId : String(event.payload.billingId ?? "");
  const billing = billingId ? await getById<Billing>(COLLECTIONS.billing, billingId) : null;
  if (!billing) return;
  const [contract, client, financeManager] = await Promise.all([getById<Contract>(COLLECTIONS.contracts, billing.contractId), getById<Client>(COLLECTIONS.clients, billing.clientId), getDepartmentManager("financeiro")]);
  const targets = [contract?.ownerId, financeManager?.id, client?.ownerSalesId].filter((id): id is string => Boolean(id));
  await notify({
    userIds: targets,
    kind: "atencao",
    title: `Cobrança vencida: ${client?.tradeName ?? "cliente"}`,
    body: `${TYPE_LABEL[billing.type]}${billing.installment ? ` ${billing.installment}` : ""} de ${formatCurrency(billing.amount)} venceu em ${formatDate(billing.dueDate)}.`,
    href: contract ? `/financeiro/contratos/${contract.id}` : `/financeiro/cobrancas?status=vencida`,
    entity: { type: "billing", id: billing.id },
    eventId: event.id,
  });
}
