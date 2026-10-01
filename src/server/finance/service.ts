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
import { firestore } from "@/server/firebase-admin";
import { batchSet, col, create, createIfAbsent, getById, list, newId, nextNumber, nowIso, remove, stripUndefined, update } from "@/server/db";
import { emitEvent } from "@/server/events";
import { getSetting } from "@/server/admin/queries";
import { SETTING_DEFAULTS, type CobrancaCanaisConfig, type FinanceiroBaixaConfig } from "@/server/admin/schemas";
import { registerHandler } from "@/server/events/emit";
import { registerFinanceHandlers } from "@/server/events/handlers/finance";
import { notify } from "@/server/notifications";
import { addBusinessHours, getHolidays } from "@/server/sla";
import { cancelTaskInternal, completeTaskInternal, createTaskInternal } from "@/server/tasks/service";
import { completeGate, getDepartmentManager } from "@/server/workflow/service";
import { createProjectFromContract } from "@/server/implementation/service";
import { proposalTotals } from "@/components/sales/model";
import { auditChanges, describeChanges } from "@/server/audit";
import { DEFAULT_CLOSING, SALE_PAYMENT_METHOD_LABELS, contractEffectiveItems } from "@/domain/sale-closing";
import { contractSnapshot, describeReadjustment } from "@/domain/contract-snapshot";
import { dateKey, formatCurrency, formatDate } from "@/lib/format";
import {
  COLLECTIONS,
  type Address,
  type Billing,
  type BillingBoleto,
  type BillingReversedPayment,
  type Client,
  type ClientProduct,
  type Contact,
  type Contract,
  type ContractReadjustment,
  type ContractVersionEntry,
  type Document,
  type DomainEvent,
  type Opportunity,
  type PaymentEvent,
  type PaymentSource,
  type Proposal,
  type ProposalItem,
  type Settings,
  type Task,
  type UserRef,
  type WorkflowInstance,
  type ContractSignerEntry,
} from "@/domain/types";
import type { RoleKey } from "@/domain/constants";
import { allSigned, billingDocId, buildBillingPlan, defaultFirstDueDate, deriveContractStatus, dueIso, evaluateReleaseGate, extendBillingPlan, lastRecurringBilling, listBillingsSwept, nextRecurringDueDate, pendingRecurringInstallments, round2, SYSTEM_ACTOR, todayKey, type BillingDraft } from "./billing";
import { getFinanceAlertSettings } from "./alerts";
import { contractDocumentHash, getSignatureProvider } from "./signature";
import { MANUAL, manualSendUrl, recordCommunication, sendOrRecord, type SendChannel, type SendDelivery } from "@/server/integrations/communications";
import { sendEmail } from "@/server/integrations/providers";
import { isConnected } from "@/server/integrations/status";
import { billingProviderConnected, getBillingProvider } from "@/server/integrations/billing-provider";
import { telHref, whatsappHref } from "@/components/clients/contact-links";
import { billingEmailSubject, boletoLines, defaultBillingMessage, hasBoletoData, loadBillingMessageContext } from "./billing-message";
import { DEFAULT_GATE_SETTINGS, GATE_SETTING_KEY, PAYMENT_REQUIREMENTS, type BillingDataInput, type BillingMessageChannel, type ContractItemInput, type FinanceGateSettings, type ManualSignatureInput, type RegisterBoletoInput, type RegisterPaymentInput, type UpdateConditionsInput } from "./schemas";

// Registro idempotente dos handlers do Financeiro (ver src/server/events/handlers/finance.ts).
registerFinanceHandlers(registerHandler);

export { SYSTEM_ACTOR };

/**
 * Ator com papel (para exceções do gate). `canReleaseWithPendency` = chave `financeiro.contratos.liberar-com-pendencia`
 * resolvida pela action; sem ela (chamadores antigos), vale `isManager` (regra padrão da chave).
 */
export type FinanceActor = UserRef & { role?: RoleKey; isManager?: boolean; canReleaseWithPendency?: boolean };

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

/** Próximo número "CT-AAAA-NNNN" no ano corrente: contador transacional (parte do maior número já gravado). */
function nextContractNumber(): Promise<string> {
  return nextNumber("CT", { pad: 4, initFrom: { collection: COLLECTIONS.contracts } });
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
  // Fechamento estruturado (D5): o contato responsável da venda vira o signatário principal.
  const closing = opp.closing;
  const chosen = closing?.contactId ? contacts.find((c) => c.id === closing.contactId) : undefined;
  const primary = chosen ?? contacts.find((c) => c.isPrimary) ?? contacts[0];
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
    // Condições herdadas do fechamento; vendas antigas (sem closing) mantêm os padrões de antes (dia 10, mensal, 12 meses).
    billingDay: closing?.billingDay ?? DEFAULT_CLOSING.billingDay,
    firstDueDate: closing?.firstDueDate,
    recurrence: closing?.recurrence ?? DEFAULT_CLOSING.recurrence,
    termMonths: closing?.termMonths ?? DEFAULT_CLOSING.termMonths,
    signers: signerEmail ? [{ name: primary?.name ?? opp.billingData?.legalName ?? client.legalName, email: signerEmail, role: "Contratante", status: "pendente" }] : [],
    paymentCondition: opp.billingData?.paymentCondition,
    financialStatus: "pendente",
    ownerId: financeManager?.id,
    documentIds: [],
    paymentMethod: closing?.paymentMethod,
    setupInstallments: closing?.setupInstallments,
    implementationRequired: closing?.implementationRequired,
    commercialNotes: closing?.commercialNotes,
    implementationNotes: closing?.implementationNotes,
    saleNumber: opp.saleNumber,
    sellerId: opp.ownerId,
    contactId: primary?.id,
    // Renovação (D26): condições combinadas no fechamento (opcionais).
    autoRenew: closing?.autoRenew,
    renewalTermMonths: closing?.renewalTermMonths,
    readjustment: closing?.readjustment,
    noticeDays: closing?.noticeDays,
    createdBy: actor.id,
  });
  await update<Opportunity>(COLLECTIONS.opportunities, opp.id, { contractId: contract.id });
  await emitEvent({
    type: "contract.created",
    actor,
    clientId: client.id,
    entity: { type: "contract", id: contract.id },
    title: `Contrato ${contract.number} criado (aguardando contrato)${opp.saleNumber ? ` · venda ${opp.saleNumber}` : ""}`,
    description: [
      contract.monthlyTotal > 0 ? `${formatCurrency(contract.monthlyTotal)}/mês` : null,
      contract.setupTotal > 0 ? `adesão ${formatCurrency(contract.setupTotal)}${(contract.setupInstallments ?? 1) > 1 ? ` em ${contract.setupInstallments}x` : ""}` : null,
      `${contract.termMonths} meses`,
      closing ? `vencimento dia ${contract.billingDay}` : null,
      contract.paymentMethod ? SALE_PAYMENT_METHOD_LABELS[contract.paymentMethod] : null,
      closing ? "condições herdadas da venda" : null,
    ]
      .filter(Boolean)
      .join(" · "),
    department: "financeiro",
    payload: {
      opportunityId: opp.id,
      ownerId: contract.ownerId,
      number: contract.number,
      monthlyTotal: contract.monthlyTotal,
      setupTotal: contract.setupTotal,
      hardwareTotal: contract.hardwareTotal,
      source: "financeiro",
      saleNumber: opp.saleNumber,
      inheritedClosing: Boolean(closing),
      paymentMethod: contract.paymentMethod,
      setupInstallments: contract.setupInstallments,
      billingDay: contract.billingDay,
      termMonths: contract.termMonths,
    },
  });
  return contract;
}

export interface SyncClientProductsOptions {
  /** Aditivo aplicado (D25): produtos ATIVOS também acompanham (valores atualizados; item removido → cancelado com motivo; item novo → criado). */
  amendment?: { number: string; reason: string; effectiveFrom: string };
}

/**
 * Produtos do cliente a partir dos itens EFETIVOS do contrato (D4: depois que o contrato existe, os itens dele
 * são a verdade; valores líquidos de desconto). Idempotente: cria os que faltam (em implantação), atualiza valores
 * dos ainda não ativos e remove os não ativos que saíram do contrato. Produtos ativos, suspensos ou cancelados
 * nunca são tocados (a partir daí quem muda é o CS: churn/upsell) — EXCETO por aditivo aplicado (`options.amendment`):
 * ativos têm os valores atualizados, item removido vira "cancelado" (com motivo) e item novo nasce ativo em contrato
 * liberado (sem projeto de implantação automático); o MRR do cliente é recalculado.
 */
export async function syncClientProductsFromContract(contract: Contract, actor: UserRef, options: SyncClientProductsOptions = {}): Promise<{ products: ClientProduct[]; created: number; updated: number; removed: number; cancelled: number }> {
  const existing = await list<ClientProduct>(COLLECTIONS.clientProducts, { where: [["contractId", "==", contract.id]] });
  const items = contractEffectiveItems(contract);
  const amendment = options.amendment;
  const pendingStatus = new Set<ClientProduct["status"]>(["em_implantacao"]);
  const touchable = (p: ClientProduct) => pendingStatus.has(p.status) || (Boolean(amendment) && p.status === "ativo");
  const used = new Set<string>();
  const products: ClientProduct[] = [];
  let created = 0;
  let updated = 0;
  let removed = 0;
  let cancelled = 0;
  for (const item of items) {
    const match = existing.find((p) => p.productId === item.productId && !used.has(p.id) && p.status !== "cancelado");
    if (match) {
      used.add(match.id);
      const values = { productName: item.productName, quantity: item.quantity, setupValue: item.setupValue, monthlyValue: item.monthlyValue, hardwareValue: item.hardwareValue };
      const differs = (Object.keys(values) as (keyof typeof values)[]).some((k) => match[k] !== values[k]);
      if (touchable(match) && differs) {
        await update<ClientProduct>(COLLECTIONS.clientProducts, match.id, values);
        products.push({ ...match, ...values });
        updated += 1;
      } else products.push(match);
      continue;
    }
    // Item novo por aditivo em contrato liberado: já ativo desde a vigência (nenhum projeto é criado automaticamente).
    const activeNow = Boolean(amendment) && contract.status === "liberado";
    products.push(
      await create<ClientProduct>(COLLECTIONS.clientProducts, {
        clientId: contract.clientId,
        productId: item.productId,
        productName: item.productName,
        quantity: item.quantity,
        setupValue: item.setupValue,
        monthlyValue: item.monthlyValue,
        hardwareValue: item.hardwareValue,
        status: activeNow ? "ativo" : "em_implantacao",
        startedAt: activeNow ? dueIso(amendment!.effectiveFrom) : undefined,
        contractId: contract.id,
        createdBy: actor.id,
      }),
    );
    created += 1;
  }
  for (const stale of existing.filter((p) => !used.has(p.id) && p.status !== "cancelado")) {
    if (pendingStatus.has(stale.status)) {
      await remove(COLLECTIONS.clientProducts, stale.id);
      removed += 1;
    } else if (amendment && stale.status === "ativo") {
      await update<ClientProduct>(COLLECTIONS.clientProducts, stale.id, { status: "cancelado", cancelledAt: dueIso(amendment.effectiveFrom), cancelReason: `Aditivo ${amendment.number}: ${amendment.reason}` });
      cancelled += 1;
    }
  }
  // MRR do cliente = soma dos produtos ativos (mesma regra do CS/churn); só recalculado quando um aditivo mexeu em ativos.
  if (amendment && (updated > 0 || cancelled > 0 || created > 0)) {
    const all = await list<ClientProduct>(COLLECTIONS.clientProducts, { where: [["clientId", "==", contract.clientId]] });
    const mrr = round2(all.filter((p) => p.status === "ativo").reduce((s, p) => s + p.monthlyValue, 0));
    await update<Client>(COLLECTIONS.clients, contract.clientId, { mrr });
  }
  return { products, created, updated, removed, cancelled };
}

/**
 * Contrato manual para um cliente existente (venda registrada fora do CRM ou contrato novo de outro objeto). Nasce
 * em "aguardando contrato", com o contato principal como signatário; itens e condições são preenchidos na página do
 * contrato. Para venda ganha no CRM use `ensureContractForOpportunity` (caminho único). Para ALTERAR ou RENOVAR um
 * contrato existente use o aditivo (`src/server/finance/amendments.ts`), nunca um contrato novo.
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
  // Snapshot COMPLETO da versão anterior (itens, totais, condições, signatários, hash): o documento ?versao=N
  // renderiza como o contrato estava antes da revisão.
  const entry: ContractVersionEntry = stripUndefined({ version: contract.version, kind: "revisao" as const, at: nowIso(), by: actor.id, reason, envelopeId: contract.signatureEnvelopeId, snapshot: contractSnapshot(contract) });
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
      previousVersions: [...(contract.previousVersions ?? []), entry],
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
  const next: Contract = { ...contract, ...patch };
  const audit = auditChanges<Contract>(contract, next, ["items", "setupTotal", "monthlyTotal", "hardwareTotal"]);
  // D4: produtos do cliente acompanham os itens do contrato de venda enquanto não estão ativos.
  const synced = contract.opportunityId || (await list<ClientProduct>(COLLECTIONS.clientProducts, { where: [["contractId", "==", contract.id]] })).length > 0 ? await syncClientProductsFromContract(next, actor) : null;
  // D4: comissões ainda não adquiridas acompanham os itens do contrato (motor v2, idempotente).
  if (contract.sellerId || contract.opportunityId) {
    try {
      const { reconcileContractCommissions } = await import("@/server/commissions/engine");
      await reconcileContractCommissions(contract.id, actor);
    } catch (error) {
      console.error(`[financeiro] falha ao recalcular as comissões do contrato ${contract.id}`, error);
    }
  }
  if (!version.versioned) {
    await emitEvent({
      type: "client.updated",
      actor,
      clientId: contract.clientId,
      entity: { type: "contract", id: contract.id },
      title: `Itens do contrato ${contract.number} atualizados`,
      description: `${normalized.length} item(ns) · ${formatCurrency(totals.monthlyTotal)}/mês · adesão ${formatCurrency(totals.setupTotal)} · hardware ${formatCurrency(totals.hardwareTotal)}`,
      department: "financeiro",
      payload: { contractId: contract.id, totals, ...audit, clientProducts: synced ? { created: synced.created, updated: synced.updated, removed: synced.removed } : null },
    });
  }
  return { contract: next, versioned: version.versioned };
}

const CONDITION_LABELS: Record<string, string> = {
  billingDay: "Dia de vencimento",
  recurrence: "Recorrência",
  termMonths: "Prazo (meses)",
  paymentCondition: "Condição de pagamento",
  firstDueDate: "1º vencimento",
  paymentMethod: "Forma de pagamento",
  setupInstallments: "Parcelas da adesão",
  autoRenew: "Renovação automática",
  renewalTermMonths: "Prazo da renovação",
  readjustment: "Reajuste",
  noticeDays: "Antecedência da renovação",
};

/** Campos de renovação (D26) informados: só entram no patch quando vieram na entrada (contratos antigos continuam sem eles). */
function renewalPatch(input: Pick<UpdateConditionsInput, "autoRenew" | "renewalTermMonths" | "readjustment" | "noticeDays">): Partial<Contract> {
  const patch: Partial<Contract> = {};
  if (input.autoRenew !== undefined) patch.autoRenew = input.autoRenew;
  if (input.renewalTermMonths !== undefined) patch.renewalTermMonths = input.renewalTermMonths;
  if (input.readjustment !== undefined) patch.readjustment = stripUndefined({ type: input.readjustment.type, percent: input.readjustment.type === "percentual" ? input.readjustment.percent : undefined, index: input.readjustment.type === "indice" ? input.readjustment.index : undefined });
  if (input.noticeDays !== undefined) patch.noticeDays = input.noticeDays;
  return patch;
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
    // Campos do fechamento: só mudam quando informados (contratos antigos continuam sem eles).
    ...(input.paymentMethod ? { paymentMethod: input.paymentMethod } : {}),
    ...(input.setupInstallments ? { setupInstallments: input.setupInstallments } : {}),
    ...renewalPatch(input),
  };
  await update<Contract>(COLLECTIONS.contracts, contract.id, patch);
  const clear = [...version.clear];
  if (!input.firstDueDate && contract.firstDueDate) clear.push("firstDueDate");
  if (!input.paymentCondition && contract.paymentCondition) clear.push("paymentCondition");
  await clearFields(COLLECTIONS.contracts, contract.id, clear);
  const audit = auditChanges<Contract>(contract, { ...contract, ...patch, firstDueDate: patch.firstDueDate, paymentCondition: patch.paymentCondition }, ["billingDay", "recurrence", "termMonths", "paymentCondition", "firstDueDate", "paymentMethod", "setupInstallments", "autoRenew", "renewalTermMonths", "readjustment", "noticeDays"]);
  if (!version.versioned) {
    await emitEvent({
      type: "client.updated",
      actor,
      clientId: contract.clientId,
      entity: { type: "contract", id: contract.id },
      title: `Condições do contrato ${contract.number} atualizadas`,
      description: describeChanges(audit, CONDITION_LABELS, (field, value) => (value === null ? "—" : field === "firstDueDate" ? formatDate(String(value)) : field === "paymentMethod" ? (SALE_PAYMENT_METHOD_LABELS[value as keyof typeof SALE_PAYMENT_METHOD_LABELS] ?? String(value)) : field === "readjustment" ? describeReadjustment(value as ContractReadjustment) : field === "autoRenew" ? (value ? "sim" : "não") : String(value))) || `Vencimento dia ${input.billingDay} · ${input.termMonths} meses · ${input.recurrence}`,
      department: "financeiro",
      payload: { contractId: contract.id, billingDay: input.billingDay, termMonths: input.termMonths, recurrence: input.recurrence, firstDueDate: input.firstDueDate, paymentMethod: input.paymentMethod, setupInstallments: input.setupInstallments, ...audit },
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
  const writes = drafts.map((d) => ({ id: newId(COLLECTIONS.billing), data: { ...d, organizationId: contract.organizationId, createdAt: now, updatedAt: now, createdBy: actor.id } as Record<string, unknown> }));
  // D20: emissão no provedor SOMENTE quando conectado (adaptador real + credenciais). Sem provedor, a cobrança
  // fica "aguardando emissão manual": o boleto é emitido no banco/ERP e registrado com "Registrar boleto".
  const providerErrors: string[] = [];
  if (billingProviderConnected()) {
    const provider = getBillingProvider();
    const client = await loadClient(contract.clientId);
    for (const w of writes) {
      try {
        const charge = await provider.createCharge({ ...(w.data as unknown as Billing), id: w.id }, client);
        Object.assign(w.data, stripUndefined({ provider: charge.provider, externalId: charge.externalId, chargeStatus: charge.status, paymentUrl: charge.paymentUrl, boleto: charge.boleto, pix: charge.pix }));
      } catch (error) {
        providerErrors.push(`${w.id}: ${error instanceof Error ? error.message : String(error)}`);
        w.data.chargeStatus = "aguardando_emissao_manual";
      }
    }
  } else {
    for (const w of writes) w.data.chargeStatus = "aguardando_emissao_manual";
  }
  await batchSet(writes.map((w) => ({ collection: COLLECTIONS.billing, id: w.id, data: w.data })));
  const created = writes.map((w) => ({ ...w.data, id: w.id }) as Billing);
  if (providerErrors.length > 0) {
    await emitEvent({
      type: "note.added",
      actor,
      clientId: contract.clientId,
      entity: { type: "contract", id: contract.id },
      title: `Falha ao emitir ${providerErrors.length} cobrança(s) no provedor de cobrança`,
      description: `${providerErrors.join(" · ")} · as cobranças ficaram aguardando emissão manual`,
      department: "financeiro",
      payload: { contractId: contract.id, providerErrors },
      timeline: false,
    });
  }

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

// ---------------------------------------------------------------------------
// Cobrança recorrente (D24b): próximas mensalidades com ids determinísticos (idempotente)
// ---------------------------------------------------------------------------

/**
 * Campos do provedor de cobrança para uma cobrança nova: `createCharge` SOMENTE quando conectado (mesmo padrão de
 * `generateBillings`); sem provedor (ou com falha), "aguardando emissão manual". Nunca simula emissão.
 */
export async function providerChargeFields(draft: Record<string, unknown>, id: string, client: Client, errors: string[]): Promise<Record<string, unknown>> {
  if (!billingProviderConnected()) return { chargeStatus: "aguardando_emissao_manual" };
  try {
    const charge = await getBillingProvider().createCharge({ ...(draft as unknown as Billing), id }, client);
    return stripUndefined({ provider: charge.provider, externalId: charge.externalId, chargeStatus: charge.status, paymentUrl: charge.paymentUrl, boleto: charge.boleto, pix: charge.pix });
  } catch (error) {
    errors.push(`${id}: ${error instanceof Error ? error.message : String(error)}`);
    return { chargeStatus: "aguardando_emissao_manual" };
  }
}

/** Cria a cobrança com id determinístico; se o id já existe (cobrança anterior cancelada com o mesmo número), usa o sufixo _r2, _r3… */
export async function createBillingWithDeterministicId(contractId: string, draft: BillingDraft, extra: Record<string, unknown>): Promise<{ billing: Billing; created: boolean }> {
  for (let attempt = 1; attempt <= 20; attempt++) {
    const id = billingDocId(contractId, draft.type, draft.installment ?? 1, attempt);
    const r = await createIfAbsent<Billing>(COLLECTIONS.billing, id, { ...(draft as Omit<Billing, "id" | "organizationId" | "createdAt" | "updatedAt">), ...(extra as Partial<Billing>) });
    if (r.created) return { billing: r.doc, created: true };
    // Já existe uma cobrança viva com este id e a mesma parcela: nada a criar (execução repetida).
    if (r.doc.status !== "cancelada" && r.doc.type === draft.type && (r.doc.installment ?? 1) === (draft.installment ?? 1)) return { billing: r.doc, created: false };
  }
  throw new Error(`Não foi possível reservar um id para a cobrança ${draft.type} ${draft.installment ?? 1} do contrato ${contractId}`);
}

export interface GenerateNextBillingsOptions {
  /** Quantidade fixa de meses a gerar (renovação); sem ela, vale o horizonte rolante (setting financeiro_alertas) ou o prazo do contrato. */
  months?: number;
  horizonMonths?: number;
  reason?: string;
  emit?: boolean;
  source?: "manual" | "horizonte" | "renovacao";
}

export interface GenerateNextBillingsResult {
  created: Billing[];
  /** Parcelas já existentes que a execução encontrou (idempotência). */
  skipped: number;
  fromInstallment?: number;
  toInstallment?: number;
}

/**
 * Próximas mensalidades do contrato (D24b), idempotente: ids determinísticos `bill_<contractId>_m<n>` via createIfAbsent;
 * cobranças antigas com id aleatório continuam valendo — a maior parcela existente define o próximo número.
 * Provedor de cobrança só é chamado quando conectado. Emite `billing.created` quando cria algo.
 */
export async function generateNextBillings(contractId: string, actor: UserRef, options: GenerateNextBillingsOptions = {}): Promise<GenerateNextBillingsResult> {
  const contract = await loadContract(contractId);
  if (contract.status === "cancelado") throw new Error("Contrato cancelado não recebe novas cobranças");
  if (contract.recurrence === "unico" || contract.monthlyTotal <= 0) throw new Error("O contrato não tem mensalidade recorrente");
  const billings = await list<Billing>(COLLECTIONS.billing, { where: [["contractId", "==", contract.id]] });
  const { billing: last, installment: max } = lastRecurringBilling(billings);
  if (!last || max <= 0) throw new Error("Gere as cobranças do contrato (adesão e mensalidades do prazo) antes de estender o plano");
  const horizonMonths = options.horizonMonths ?? (await getFinanceAlertSettings()).horizonteCobrancasMeses;
  const pending = pendingRecurringInstallments(contract, billings, { horizonMonths, months: options.months });
  if (pending.length === 0) return { created: [], skipped: 0 };
  const drafts = extendBillingPlan(contract, { fromInstallment: pending[0], months: pending.length * (contract.recurrence === "anual" ? 12 : 1), firstDueDate: nextRecurringDueDate(contract, last, pending[0]) });
  const client = await loadClient(contract.clientId);
  const now = nowIso();
  const providerErrors: string[] = [];
  const created: Billing[] = [];
  let skipped = 0;
  for (const draft of drafts) {
    const id = billingDocId(contract.id, draft.type, draft.installment ?? 1);
    const fields = await providerChargeFields({ ...draft, organizationId: contract.organizationId, createdAt: now, updatedAt: now }, id, client, providerErrors);
    const r = await createBillingWithDeterministicId(contract.id, draft, { ...fields, createdBy: actor.id });
    if (r.created) created.push(r.billing);
    else skipped += 1;
  }
  if (providerErrors.length > 0) {
    await emitEvent({
      type: "note.added",
      actor,
      clientId: contract.clientId,
      entity: { type: "contract", id: contract.id },
      title: `Falha ao emitir ${providerErrors.length} cobrança(s) no provedor de cobrança`,
      description: `${providerErrors.join(" · ")} · as cobranças ficaram aguardando emissão manual`,
      department: "financeiro",
      payload: { contractId: contract.id, providerErrors },
      timeline: false,
    });
  }
  if (created.length > 0 && options.emit !== false) {
    const total = created.reduce((s, b) => s + b.amount, 0);
    const first = created[0];
    const lastCreated = created[created.length - 1];
    await emitEvent({
      type: "billing.created",
      actor,
      clientId: contract.clientId,
      entity: { type: "contract", id: contract.id },
      title: `${created.length} mensalidade(s) gerada(s) para o contrato ${contract.number}${options.source === "horizonte" ? " (cobrança recorrente)" : options.source === "renovacao" ? " (renovação)" : ""}`,
      description: [`mensalidades ${first.installment} a ${lastCreated.installment}`, `${formatDate(first.dueDate)} a ${formatDate(lastCreated.dueDate)}`, `total ${formatCurrency(total)}`, options.reason].filter(Boolean).join(" · "),
      department: "financeiro",
      payload: { contractId: contract.id, billingIds: created.map((b) => b.id), total, fromInstallment: first.installment, toInstallment: lastCreated.installment, source: options.source ?? "manual", reason: options.reason ?? null },
    });
  }
  return { created, skipped, fromInstallment: pending[0], toInstallment: pending[pending.length - 1] };
}

// ---------------------------------------------------------------------------
// Boleto (D20): registro manual do boleto emitido no banco/ERP enquanto não há provedor
// ---------------------------------------------------------------------------

const BOLETO_LABELS: Record<string, string> = { boleto: "Boleto", pix: "PIX", chargeStatus: "Situação da cobrança", provider: "Provedor", paymentUrl: "Link de pagamento" };

/**
 * Registra o boleto/PIX emitido fora do INTEROS na cobrança: linha digitável, nosso número, código de barras,
 * PDF (vira documento "Boleto" em `documents`), banco, PIX copia e cola. Grava `provider: "manual"`,
 * `chargeStatus: "pendente"` e emite `billing.updated` com as mudanças (de → para).
 */
export async function registerBoleto(input: RegisterBoletoInput, actor: UserRef, options: { emit?: boolean } = {}): Promise<Billing> {
  const billing = await loadBilling(input.billingId);
  if (billing.status === "paga") throw new Error("Cobrança paga não recebe boleto novo");
  if (billing.status === "cancelada") throw new Error("Cobrança cancelada não recebe boleto");
  if (billing.externalId && billing.provider && billing.provider !== "manual") throw new Error("Esta cobrança foi emitida pelo provedor de cobrança: o boleto vem de lá");
  const contract = await loadContract(billing.contractId);
  const clean = (v: string | undefined) => (v?.trim() ? v.trim() : undefined);
  const emitidoEm = input.emitidoEm ? dueIso(input.emitidoEm) : nowIso();
  const pdfUrl = clean(input.pdfUrl);
  const boleto: BillingBoleto = stripUndefined({
    ...(billing.boleto ?? {}),
    linhaDigitavel: clean(input.linhaDigitavel) ?? billing.boleto?.linhaDigitavel,
    nossoNumero: clean(input.nossoNumero) ?? billing.boleto?.nossoNumero,
    codigoBarras: clean(input.codigoBarras) ?? billing.boleto?.codigoBarras,
    pdfUrl: pdfUrl ?? billing.boleto?.pdfUrl,
    banco: clean(input.banco) ?? billing.boleto?.banco,
    emitidoEm,
  });
  if (pdfUrl && pdfUrl !== billing.boleto?.pdfUrl) {
    const doc = await create<Document>(COLLECTIONS.documents, {
      clientId: billing.clientId,
      entityType: "billing",
      entityId: billing.id,
      name: `Boleto ${TYPE_LABEL[billing.type]}${billing.installment ? ` ${billing.installment}` : ""} — ${contract.number} · vence ${formatDate(billing.dueDate)}`,
      url: pdfUrl,
      version: 1,
      uploadedBy: actor.id,
      category: "Boleto",
      createdBy: actor.id,
    });
    boleto.documentId = doc.id;
    await update<Contract>(COLLECTIONS.contracts, contract.id, { documentIds: [...contract.documentIds, doc.id] });
  }
  const pixCopiaECola = clean(input.pixCopiaECola) ?? billing.pix?.copiaECola;
  const pixQrCodeUrl = clean(input.pixQrCodeUrl) ?? billing.pix?.qrCodeUrl;
  const pix = pixCopiaECola || pixQrCodeUrl ? stripUndefined({ copiaECola: pixCopiaECola, qrCodeUrl: pixQrCodeUrl }) : undefined;
  const patch: Partial<Billing> = {
    provider: "manual",
    chargeStatus: billing.status === "vencida" ? "vencido" : "pendente",
    boleto,
    pix,
    paymentUrl: clean(input.paymentUrl) ?? billing.paymentUrl,
  };
  await update<Billing>(COLLECTIONS.billing, billing.id, patch);
  const next: Billing = { ...billing, ...stripUndefined(patch) };
  const audit = auditChanges<Billing>(billing, next, ["boleto", "pix", "chargeStatus", "provider", "paymentUrl"]);
  if (options.emit !== false) {
    await emitEvent({
      type: "billing.updated",
      actor,
      clientId: billing.clientId,
      entity: { type: "billing", id: billing.id },
      title: `Boleto registrado: ${TYPE_LABEL[billing.type]}${billing.installment ? ` ${billing.installment}` : ""} de ${formatCurrency(billing.amount)}`,
      description: [boleto.banco ? `banco ${boleto.banco}` : null, boleto.nossoNumero ? `nosso número ${boleto.nossoNumero}` : null, boleto.linhaDigitavel ? "linha digitável" : null, boleto.pdfUrl ? "PDF" : null, pix?.copiaECola ? "PIX" : null, `contrato ${contract.number}`, `vence ${formatDate(billing.dueDate)}`, `emitido fora do INTEROS (sem provedor conectado)`]
        .filter(Boolean)
        .join(" · "),
      department: "financeiro",
      payload: { billingId: billing.id, contractId: contract.id, clientId: billing.clientId, kind: "boleto", documentId: boleto.documentId, ...audit, labels: BOLETO_LABELS },
    });
  }
  return next;
}

// ---------------------------------------------------------------------------
// Baixa (D21): transacional, com origem, deduplicação de evento externo e tolerância na baixa automática
// ---------------------------------------------------------------------------

/** Lê o setting "financeiro_baixa" (tolerância e política de pagamento parcial da baixa automática). */
export async function getPaymentSettings(): Promise<FinanceiroBaixaConfig> {
  const value = await getSetting<FinanceiroBaixaConfig>("financeiro_baixa", SETTING_DEFAULTS.financeiro_baixa);
  const tol = Number(value.toleranciaValor);
  return {
    toleranciaValor: Number.isFinite(tol) && tol >= 0 ? tol : SETTING_DEFAULTS.financeiro_baixa.toleranciaValor,
    pagamentoParcialAutomatico: value.pagamentoParcialAutomatico === "baixar" ? "baixar" : "pendencia",
  };
}

/** Resultado da baixa: a cobrança (paga) mais os marcadores da baixa automática. */
export type PaidBillingResult = Billing & {
  /** Evento externo já processado antes (mesmo eventId/externalPaymentId): nada mudou. */
  alreadyProcessed?: boolean;
  /** Pagamento parcial automático abaixo da tolerância: NÃO baixou; pendência/aviso registrados. */
  partial?: boolean;
};

function paymentEventDocId(provider: string, eventId: string): string {
  return `${provider}_${eventId}`.replace(/[^A-Za-z0-9_.-]/g, "_").slice(0, 300);
}

/**
 * Caminho ÚNICO de recebimento. Transacional: lê a cobrança dentro da transação e recusa se já estiver paga ou
 * cancelada (duas baixas concorrentes → só uma vence). Origem (`source`): "manual" (tela, com o valor que o
 * humano informou), "provedor" (webhook) ou "conciliacao" (varredura). Para origem externa:
 * - `providerEventId` é reservado em `payment_events` (`<provedor>_<eventId>`, createIfAbsent) ANTES da baixa:
 *   o reenvio do mesmo evento devolve `alreadyProcessed: true` sem erro;
 * - cobrança já paga com o mesmo `externalPaymentId` também devolve `alreadyProcessed`;
 * - valor recebido abaixo de (valor da cobrança − tolerância do setting `financeiro_baixa`) NÃO baixa: grava
 *   `partialPaidAmount/partialPaidAt`, registra pendência no contrato (ou avisa o Financeiro quando o contrato já
 *   foi liberado) e devolve `partial: true` — salvo se o setting mandar "baixar".
 */
export async function registerPayment(input: RegisterPaymentInput, actor: UserRef): Promise<PaidBillingResult> {
  const source: PaymentSource = input.source ?? "manual";
  const automatic = source !== "manual";
  const providerName = input.provider?.trim() || (automatic ? "provedor" : "manual");
  const amount = round2(input.amount);
  const paidAt = dueIso(input.paidAt);
  if (!(amount > 0)) throw new Error("Valor pago deve ser maior que zero");

  // 1. Deduplicação do evento externo (webhook/conciliação): reserva atômica do id do evento.
  let eventDocId: string | undefined;
  if (automatic && input.providerEventId) {
    eventDocId = paymentEventDocId(providerName, input.providerEventId);
    const claim = await createIfAbsent<PaymentEvent>(COLLECTIONS.paymentEvents, eventDocId, {
      provider: providerName,
      eventId: input.providerEventId,
      source,
      billingId: input.billingId,
      externalPaymentId: input.externalPaymentId,
      paidAmount: amount,
      paidAt,
      receivedAt: nowIso(),
      createdBy: actor.id,
    });
    if (!claim.created) {
      const current = await loadBilling(input.billingId);
      return { ...current, alreadyProcessed: true };
    }
  }
  const finishEvent = async (result: PaymentEvent["result"], message?: string, billingId?: string) => {
    if (eventDocId) await update<PaymentEvent>(COLLECTIONS.paymentEvents, eventDocId, stripUndefined({ result, message, billingId }));
  };

  const billing = await loadBilling(input.billingId);
  const contract = await loadContract(billing.contractId);

  // 2. Tolerância (só baixa automática): abaixo dela não baixa — pendência + aviso.
  if (automatic && billing.status !== "paga" && billing.status !== "cancelada") {
    const settings = await getPaymentSettings();
    if (amount < round2(billing.amount - settings.toleranciaValor) && settings.pagamentoParcialAutomatico === "pendencia") {
      const partial = await registerPartialAutomaticPayment(billing, contract, { amount, paidAt, source, externalPaymentId: input.externalPaymentId, tolerance: settings.toleranciaValor }, actor);
      await finishEvent("parcial", `Recebido ${formatCurrency(amount)} de ${formatCurrency(billing.amount)}: pendência registrada`, billing.id);
      return partial;
    }
  }

  // 3. Baixa em transação: o status é conferido dentro dela.
  const ref = col(COLLECTIONS.billing).doc(billing.id);
  let outcome: { already: true; current: Billing } | { already: false; before: Billing; after: Billing };
  try {
    outcome = await firestore.runTransaction(async (tx) => {
      const snap = await tx.get(ref);
      if (!snap.exists) throw new Error("Cobrança não encontrada");
      const current = { ...(snap.data() as Omit<Billing, "id">), id: billing.id } as Billing;
      if (current.status === "paga") {
        if (automatic && input.externalPaymentId && current.externalPaymentId === input.externalPaymentId) return { already: true as const, current };
        throw new Error("Esta cobrança já está paga");
      }
      if (current.status === "cancelada") throw new Error("Cobrança cancelada não recebe pagamento");
      const patch: Record<string, unknown> = stripUndefined({
        status: "paga",
        paidAt,
        paidAmount: amount,
        method: input.method,
        paymentSource: source,
        externalPaymentId: automatic ? input.externalPaymentId : undefined,
        chargeStatus: current.chargeStatus ? "pago" : undefined,
        updatedAt: nowIso(),
      });
      if (current.partialPaidAmount !== undefined) {
        patch.partialPaidAmount = FieldValue.delete();
        patch.partialPaidAt = FieldValue.delete();
      }
      tx.update(ref, patch);
      const after = { ...current } as Record<string, unknown>;
      for (const [k, v] of Object.entries(patch)) {
        if (v instanceof FieldValue) delete after[k];
        else after[k] = v;
      }
      return { already: false as const, before: current, after: after as unknown as Billing };
    });
  } catch (error) {
    await finishEvent("erro", error instanceof Error ? error.message : String(error), billing.id);
    throw error;
  }
  if (outcome.already) {
    await finishEvent("ja_processado", "Cobrança já paga com o mesmo pagamento do provedor", billing.id);
    return { ...outcome.current, alreadyProcessed: true };
  }
  const { before, after } = outcome;

  // 4. Comprovante (fora da transação: nunca fica órfão de uma baixa que falhou).
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
    await update<Billing>(COLLECTIONS.billing, billing.id, { receiptDocumentId });
    await update<Contract>(COLLECTIONS.contracts, contract.id, { documentIds: [...contract.documentIds, doc.id] });
  }
  const paid: Billing = { ...after, receiptDocumentId: receiptDocumentId ?? after.receiptDocumentId };
  const audit = auditChanges<Billing>(before, paid, ["status", "paidAmount", "paidAt"]);
  const sourceLabel = source === "manual" ? "registro manual" : source === "provedor" ? "baixa automática (provedor)" : "conciliação bancária";

  await emitEvent({
    type: "payment.approved",
    actor,
    clientId: billing.clientId,
    entity: { type: "billing", id: billing.id },
    title: `Pagamento registrado: ${TYPE_LABEL[billing.type]}${billing.installment ? ` ${billing.installment}` : ""} de ${formatCurrency(amount)}`,
    description: `Contrato ${contract.number} · ${input.method.toUpperCase()} · pago em ${formatDate(paidAt)}${amount !== billing.amount ? ` (valor da cobrança ${formatCurrency(billing.amount)})` : ""} · ${sourceLabel}`,
    department: "financeiro",
    payload: { billingId: billing.id, contractId: contract.id, clientId: billing.clientId, type: billing.type, installment: billing.installment ?? null, amount, source, externalPaymentId: input.externalPaymentId ?? null, providerEventId: input.providerEventId ?? null, ...audit },
  });
  await finishEvent("processado", undefined, billing.id);

  // Atualiza o status do contrato (ex.: aguardando pagamento → pago).
  if (contract.status !== "liberado" && contract.status !== "cancelado" && contract.status !== "pendencia") {
    const [billings, settings] = await Promise.all([contractBillings(contract.id), getGateSettings()]);
    const next = deriveContractStatus(contract, billings.map((b) => (b.id === paid.id ? paid : b)), settings);
    if (next !== contract.status) await update<Contract>(COLLECTIONS.contracts, contract.id, { status: next });
  }
  return paid;
}

/** Pagamento parcial automático abaixo da tolerância: não baixa; pendência (contrato aberto) ou aviso (liberado). */
async function registerPartialAutomaticPayment(
  billing: Billing,
  contract: Contract,
  input: { amount: number; paidAt: string; source: PaymentSource; externalPaymentId?: string; tolerance: number },
  actor: UserRef,
): Promise<PaidBillingResult> {
  const patch: Partial<Billing> = { partialPaidAmount: input.amount, partialPaidAt: input.paidAt };
  await update<Billing>(COLLECTIONS.billing, billing.id, patch);
  const label = `${TYPE_LABEL[billing.type]}${billing.installment ? ` ${billing.installment}` : ""}`;
  const difference = round2(billing.amount - input.amount);
  const reason = `Pagamento parcial recebido por ${input.source === "provedor" ? "provedor de cobrança" : "conciliação bancária"}: ${formatCurrency(input.amount)} de ${formatCurrency(billing.amount)} (${label}, diferença ${formatCurrency(difference)}, tolerância ${formatCurrency(input.tolerance)}). A cobrança NÃO foi baixada: confira e registre a baixa manual ou negocie a diferença.`;
  const client = await loadClient(contract.clientId);
  const event = await emitEvent({
    type: "note.added",
    actor,
    clientId: billing.clientId,
    entity: { type: "billing", id: billing.id },
    title: `Pagamento parcial de ${formatCurrency(input.amount)} recebido (${label}) — cobrança não baixada`,
    description: reason,
    department: "financeiro",
    payload: { billingId: billing.id, contractId: contract.id, partial: true, amount: input.amount, expected: billing.amount, difference, tolerance: input.tolerance, source: input.source, externalPaymentId: input.externalPaymentId ?? null },
  });
  let pendencyRegistered = false;
  if (contract.status !== "liberado" && contract.status !== "cancelado" && contract.status !== "pendencia") {
    try {
      await registerPendency(contract.id, reason, actor);
      pendencyRegistered = true;
    } catch (error) {
      console.error(`[financeiro] pagamento parcial: falha ao registrar pendência no contrato ${contract.id}`, error);
    }
  }
  if (!pendencyRegistered) {
    const financeManager = await getDepartmentManager("financeiro");
    await notify({
      userIds: [contract.ownerId, financeManager?.id].filter((id, i, arr): id is string => Boolean(id) && arr.indexOf(id) === i),
      kind: "atencao",
      title: `Pagamento parcial: ${client.tradeName}`,
      body: reason,
      href: `/financeiro/cobrancas?cliente=${contract.clientId}`,
      entity: { type: "billing", id: billing.id },
      eventId: event.id,
    });
  }
  return { ...billing, ...patch, partial: true };
}

// ---------------------------------------------------------------------------
// Estorno de pagamento (D22)
// ---------------------------------------------------------------------------

/**
 * Estorna o pagamento de uma cobrança paga: volta para "aberta" ou "vencida" (pela data de vencimento), limpa
 * paidAt/paidAmount guardando o pagamento em `reversedPayments[]` e emite `payment.reversed` (com changes).
 * Efeitos em comissões/títulos: handler em src/server/commissions/reversal.ts. Contrato: "pago" (não liberado)
 * volta a "aguardando pagamento"; liberado NÃO regride (a implantação já andou) — o Financeiro é avisado.
 */
export async function reversePayment(input: { billingId: string; reason: string }, actor: UserRef): Promise<Billing> {
  const reason = input.reason.trim();
  if (reason.length < 5) throw new Error("Descreva o motivo do estorno");
  const billing = await loadBilling(input.billingId);
  const contract = await loadContract(billing.contractId);
  const ref = col(COLLECTIONS.billing).doc(billing.id);
  const today = todayKey();
  const reversedAt = nowIso();
  const { before, after } = await firestore.runTransaction(async (tx) => {
    const snap = await tx.get(ref);
    if (!snap.exists) throw new Error("Cobrança não encontrada");
    const current = { ...(snap.data() as Omit<Billing, "id">), id: billing.id } as Billing;
    if (current.status !== "paga") throw new Error("Só cobrança paga pode ter o pagamento estornado");
    const status: Billing["status"] = dateKey(current.dueDate) < today ? "vencida" : "aberta";
    const entry: BillingReversedPayment = stripUndefined({
      paidAt: current.paidAt ?? reversedAt,
      paidAmount: current.paidAmount ?? current.amount,
      method: current.method,
      source: current.paymentSource,
      externalPaymentId: current.externalPaymentId,
      receiptDocumentId: current.receiptDocumentId,
      reversedAt,
      reversedBy: actor.id,
      reason,
    });
    const patch: Record<string, unknown> = {
      status,
      reversedPayments: [...(current.reversedPayments ?? []), entry],
      paidAt: FieldValue.delete(),
      paidAmount: FieldValue.delete(),
      receiptDocumentId: FieldValue.delete(),
      paymentSource: FieldValue.delete(),
      externalPaymentId: FieldValue.delete(),
      updatedAt: reversedAt,
    };
    if (current.chargeStatus === "pago") patch.chargeStatus = status === "vencida" ? "vencido" : "pendente";
    tx.update(ref, patch);
    const next = { ...current } as Record<string, unknown>;
    for (const [k, v] of Object.entries(patch)) {
      if (v instanceof FieldValue) delete next[k];
      else next[k] = v;
    }
    return { before: current, after: next as unknown as Billing };
  });
  const label = `${TYPE_LABEL[billing.type]}${billing.installment ? ` ${billing.installment}` : ""}`;
  const audit = auditChanges<Billing>(before, after, ["status", "paidAt", "paidAmount"], reason);
  const event = await emitEvent({
    type: "payment.reversed",
    actor,
    clientId: billing.clientId,
    entity: { type: "billing", id: billing.id },
    title: `Pagamento estornado: ${label} de ${formatCurrency(before.paidAmount ?? before.amount)}`,
    description: `${reason} · contrato ${contract.number} · cobrança volta a ${after.status === "vencida" ? "vencida" : "em aberto"} (pago em ${formatDate(before.paidAt)})`,
    department: "financeiro",
    payload: { billingId: billing.id, contractId: contract.id, clientId: billing.clientId, type: billing.type, installment: billing.installment ?? null, amount: before.paidAmount ?? before.amount, previousPaidAt: before.paidAt ?? null, source: before.paymentSource ?? "manual", contractStatus: contract.status, ...audit },
  });

  if (contract.status === "liberado") {
    const [client, financeManager] = await Promise.all([loadClient(contract.clientId), getDepartmentManager("financeiro")]);
    await notify({
      userIds: [contract.ownerId, financeManager?.id].filter((id, i, arr): id is string => Boolean(id) && id !== actor.id && arr.indexOf(id) === i),
      kind: "atencao",
      title: `Pagamento estornado em contrato liberado: ${client.tradeName}`,
      body: `${label} de ${formatCurrency(before.paidAmount ?? before.amount)} (${contract.number}) voltou a ${after.status === "vencida" ? "vencida" : "em aberto"}. Motivo: ${reason}. A liberação não regride: acompanhe a cobrança.`,
      href: `/financeiro/cobrancas?cliente=${contract.clientId}`,
      entity: { type: "billing", id: billing.id },
      eventId: event.id,
    });
  } else if (contract.status !== "cancelado" && contract.status !== "pendencia") {
    const [billings, settings] = await Promise.all([contractBillings(contract.id), getGateSettings()]);
    const next = deriveContractStatus(contract, billings.map((b) => (b.id === after.id ? after : b)), settings);
    if (next !== contract.status) await update<Contract>(COLLECTIONS.contracts, contract.id, { status: next });
  }
  return after;
}

export async function cancelBilling(billingId: string, reason: string, actor: UserRef): Promise<void> {
  const billing = await loadBilling(billingId);
  if (billing.status === "paga") throw new Error("Cobrança paga não pode ser cancelada");
  if (billing.status === "cancelada") throw new Error("Esta cobrança já está cancelada");
  const providerNote = await cancelChargeAtProvider(billing);
  await update<Billing>(COLLECTIONS.billing, billing.id, { status: "cancelada", ...(billing.chargeStatus ? { chargeStatus: "cancelado" } : {}) });
  await emitEvent({
    type: "note.added",
    actor,
    clientId: billing.clientId,
    entity: { type: "billing", id: billing.id },
    title: `Cobrança cancelada: ${TYPE_LABEL[billing.type]}${billing.installment ? ` ${billing.installment}` : ""} de ${formatCurrency(billing.amount)}`,
    description: providerNote ? `${reason} · ${providerNote}` : reason,
    department: "financeiro",
    payload: { billingId: billing.id, contractId: billing.contractId, reason, previousStatus: billing.status, providerNote },
  });
}

/**
 * Cancela a cobrança no provedor quando ele está conectado e a cobrança foi emitida lá (`externalId`). Falha do
 * provedor NÃO impede o cancelamento local: devolve a nota do erro para ficar registrada no evento.
 */
export async function cancelChargeAtProvider(billing: Billing): Promise<string | undefined> {
  if (!billing.externalId || !billingProviderConnected()) return undefined;
  try {
    const r = await getBillingProvider().cancelCharge(billing);
    return r.ok ? `cancelada também no provedor (${r.message ?? billing.provider ?? "provedor"})` : `falha ao cancelar no provedor: ${r.message ?? "sem detalhe"} — cancele manualmente no provedor`;
  } catch (error) {
    return `falha ao cancelar no provedor: ${error instanceof Error ? error.message : String(error)} — cancele manualmente no provedor`;
  }
}

// ---------------------------------------------------------------------------
// Mensagens de cobrança (D23): WhatsApp principal, e-mail complementar, boleto/2ª via
// ---------------------------------------------------------------------------

export async function getBillingChannelSettings(): Promise<CobrancaCanaisConfig> {
  const value = await getSetting<CobrancaCanaisConfig>("cobranca_canais", SETTING_DEFAULTS.cobranca_canais);
  return { ...SETTING_DEFAULTS.cobranca_canais, ...value, enviarEmailJuntoAoWhatsapp: Boolean(value.enviarEmailJuntoAoWhatsapp) };
}

export interface BillingContactInfo {
  /** Telefone usado no WhatsApp/ligação (contato do contrato, principal ou cliente). */
  phone?: string;
  /** E-mail de cobrança (contato do contrato → e-mail de faturamento da venda → contato principal → cliente). */
  email?: string;
  contactName: string;
  message: string;
  /** Texto com os dados do boleto (vazio quando não há boleto registrado). */
  messageWithBoleto: string;
  emailSubject: string;
  whatsappUrl: string | null;
  telUrl: string | null;
  emailUrl: string | null;
  whatsappConnected: boolean;
  emailConnected: boolean;
  voipConnected: boolean;
  hasBoleto: boolean;
  boletoSummary: string | null;
  optOut: { whatsapp: boolean; email: boolean };
  /** Setting cobranca_canais: ao cobrar por WhatsApp o e-mail complementar vai junto. */
  emailWithWhatsapp: boolean;
}

/** Destinatário, textos e estado dos canais da cobrança, para a tela abrir wa.me/mailto/tel: com tudo pronto. */
export async function getBillingContactInfo(billingId: string): Promise<BillingContactInfo> {
  const ctx = await loadBillingMessageContext(billingId);
  const channels = await getBillingChannelSettings();
  const message = defaultBillingMessage(ctx);
  const boleto = hasBoletoData(ctx.billing);
  const messageWithBoleto = boleto ? defaultBillingMessage(ctx, { includeBoleto: true }) : "";
  const emailSubject = billingEmailSubject(ctx);
  return {
    phone: ctx.phone,
    email: ctx.email,
    contactName: ctx.contactName,
    message,
    messageWithBoleto,
    emailSubject,
    whatsappUrl: whatsappHref(ctx.phone),
    telUrl: telHref(ctx.contact?.phone ?? ctx.contact?.whatsapp ?? ctx.primary?.phone ?? ctx.primary?.whatsapp ?? ctx.client.phone ?? ctx.client.whatsapp),
    emailUrl: ctx.email ? manualSendUrl("email", ctx.email, emailSubject, message) : null,
    whatsappConnected: isConnected("whatsapp"),
    emailConnected: isConnected("email"),
    voipConnected: isConnected("voip"),
    hasBoleto: boleto,
    boletoSummary: boleto ? boletoLines(ctx.billing).join(" · ") : null,
    optOut: { whatsapp: Boolean(ctx.client.communicationOptOut?.whatsapp), email: Boolean(ctx.client.communicationOptOut?.email) },
    emailWithWhatsapp: channels.enviarEmailJuntoAoWhatsapp && channels.complementar === "email",
  };
}

export interface BillingChannelResult {
  channel: SendChannel;
  delivery: SendDelivery;
  /** Canal não conectado: o usuário envia pelo próprio aparelho (wa.me/mailto) e o registro fica manual. */
  manual: boolean;
  delivered: boolean;
  communicationId: string;
  /** Link de envio manual (wa.me com texto / mailto), quando faz sentido. */
  url: string | null;
  to?: string;
  error?: string;
  /** false quando o id determinístico já existia (régua: execução repetida não envia de novo). */
  created: boolean;
}

export interface SendBillingMessageOptions {
  /** Emitir eventos (padrão true; a régua emite o próprio evento). */
  emit?: boolean;
  /** Id determinístico base (régua): `<id>_<canal>`; execução repetida não envia de novo. */
  id?: string;
  /** Automação: canal não conectado vira "nao_enviada" (nunca "manual", que significa "alguém enviou"). */
  whenNotConnected?: "manual" | "nao_enviada";
  templateKey?: string;
  /** Rótulo da origem no título do evento (ex.: "régua · 7 dias antes"). */
  originLabel?: string;
}

/**
 * Mensagem de cobrança por WhatsApp (principal), e-mail (complementar) ou ambos, com ou sem os dados do boleto
 * (envio/2ª via). Destinatário pela ordem de preferência (billing-message.ts). Com `includeBoleto`, exige boleto
 * registrado (nada de "boleto" fictício). Quando o setting `cobranca_canais.enviarEmailJuntoAoWhatsapp` está
 * ligado, cobrar por WhatsApp também dispara o e-mail complementar. Registra communications (templateKey
 * "cobranca") e emite whatsapp.message.sent / email.sent.
 */
export async function sendBillingMessage(
  billingId: string,
  input: { channel: BillingMessageChannel; text?: string; includeBoleto?: boolean; secondCopy?: boolean },
  actor: UserRef,
  options: SendBillingMessageOptions = {},
): Promise<{ results: BillingChannelResult[]; contactName: string }> {
  const ctx = await loadBillingMessageContext(billingId);
  const { billing, client, contract } = ctx;
  if (billing.status === "cancelada") throw new Error("Cobrança cancelada não é enviada ao cliente");
  const includeBoleto = Boolean(input.includeBoleto);
  if (includeBoleto && !hasBoletoData(billing)) throw new Error("Nenhum boleto ou PIX registrado nesta cobrança. Registre o boleto emitido no banco/ERP antes de enviá-lo.");
  const settings = await getBillingChannelSettings();
  const channels: SendChannel[] = input.channel === "ambos" ? ["whatsapp", "email"] : [input.channel];
  if (input.channel === "whatsapp" && settings.enviarEmailJuntoAoWhatsapp && settings.complementar === "email" && ctx.email) channels.push("email");
  const text = input.text?.trim() || defaultBillingMessage(ctx, { includeBoleto, secondCopy: input.secondCopy });
  const body = includeBoleto && input.text?.trim() && !boletoLines(billing).some((l) => text.includes(l)) ? `${text}\n${boletoLines(billing).join("\n")}` : text;
  const subject = billingEmailSubject(ctx, { includeBoleto });
  const results: BillingChannelResult[] = [];
  for (const channel of channels) {
    const to = channel === "whatsapp" ? ctx.phone : ctx.email;
    const sent = await sendOrRecord({
      channel,
      to,
      subject,
      text: body,
      clientId: client.id,
      contactId: ctx.contact?.id ?? ctx.primary?.id,
      templateKey: options.templateKey ?? "cobranca",
      entity: { type: "billing", id: billing.id },
      actor,
      id: options.id ? `${options.id}_${channel}` : undefined,
      whenNotConnected: options.whenNotConnected ?? "manual",
    });
    const manual = sent.delivery === "manual";
    const delivered = sent.delivery === "enviada";
    results.push({ channel, delivery: sent.delivery, manual, delivered, communicationId: sent.communication.id, url: sent.manualUrl, to, error: sent.error, created: sent.created });
    if (options.emit === false || !sent.created) continue;
    const what = includeBoleto ? (input.secondCopy ? "2ª via do boleto" : "Boleto") : "Cobrança";
    const via = channel === "whatsapp" ? "WhatsApp" : "e-mail";
    const origin = options.originLabel ? ` (${options.originLabel})` : "";
    const title =
      sent.delivery === "manual"
        ? `${what} enviad${includeBoleto ? "a" : "a"} manualmente por ${via} para ${ctx.contactName}${origin}`
        : sent.delivery === "enviada"
          ? `${what} enviad${includeBoleto ? "a" : "a"} por ${via} para ${ctx.contactName}${origin}`
          : sent.delivery === "falha"
            ? `${what} por ${via} para ${ctx.contactName}: falha no envio${origin}`
            : `${what} por ${via} para ${ctx.contactName} não enviad${includeBoleto ? "a" : "a"} (${sent.optedOut ? "opt-out do cliente" : sent.error ?? "canal não conectado"})${origin}`;
    await emitEvent({
      type: channel === "whatsapp" ? "whatsapp.message.sent" : "email.sent",
      actor,
      clientId: client.id,
      entity: { type: "billing", id: billing.id },
      title: title.replace("Cobrança enviada", "Cobrança enviada").replace("Boleto enviada", "Boleto enviado").replace("2ª via do boleto enviada", "2ª via do boleto enviada"),
      description: body,
      department: "financeiro",
      payload: { billingId: billing.id, contractId: contract.id, to, channel, communicationId: sent.communication.id, manual, delivered, delivery: sent.delivery, includeBoleto, secondCopy: Boolean(input.secondCopy), optedOut: sent.optedOut, templateKey: options.templateKey ?? "cobranca", marco: options.originLabel ?? null },
    });
  }
  return { results, contactName: ctx.contactName };
}

/**
 * Cobrança por WhatsApp (compatibilidade: mesma assinatura de antes). Com a Meta conectada envia pela API; sem
 * integração o usuário abriu o wa.me com o texto e aqui só se registra "cobrança enviada manualmente".
 */
export async function sendBillingWhatsapp(billingId: string, notes: string | undefined, actor: UserRef): Promise<{ manual: boolean; delivered: boolean }> {
  const { results } = await sendBillingMessage(billingId, { channel: "whatsapp", text: notes }, actor);
  const wa = results.find((r) => r.channel === "whatsapp") ?? results[0];
  return { manual: wa?.manual ?? true, delivered: wa?.delivered ?? false };
}

/** Ligação de cobrança feita no discador (sem VoIP conectado): registro manual do resultado. */
export async function registerBillingCall(billingId: string, notes: string | undefined, actor: UserRef): Promise<void> {
  const ctx = await loadBillingMessageContext(billingId);
  const { billing, client } = ctx;
  const contact = ctx.contact ?? ctx.primary;
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
// Cancelamento do contrato (D6)
// ---------------------------------------------------------------------------

export interface CancelContractOptions {
  /** "financeiro": ação na página do contrato; "churn": chamado pelo registro de cancelamento do CS. */
  source?: "financeiro" | "churn";
  /** Data do cancelamento (padrão: agora). */
  cancelledAt?: string;
}

export interface CancelContractResult {
  contract: Contract;
  cancelledBillingIds: string[];
  cancelledProductIds: string[];
}

/**
 * Cancela o contrato: status "cancelado" com data, motivo e autor; cobranças em aberto/vencidas passam a
 * "cancelada"; tarefas abertas do processo do contrato são canceladas; emite `contract.cancelled`
 * ({ contractId, reason, cancelledBillingIds }) — ponto de entrada para os efeitos em comissões (etapa 2).
 *
 * Pelo Financeiro só antes da liberação (a venda não se concretizou): produtos do cliente ainda em implantação
 * ligados ao contrato são cancelados. Contrato liberado é cancelado pelo CS (churn), que encerra produtos,
 * MRR e jornada e chama este mesmo serviço com `source: "churn"`.
 */
export async function cancelContract(input: { contractId: string; reason: string }, actor: UserRef, options: CancelContractOptions = {}): Promise<CancelContractResult> {
  const source = options.source ?? "financeiro";
  const reason = input.reason.trim();
  if (reason.length < 5) throw new Error("Descreva o motivo do cancelamento");
  const contract = await loadContract(input.contractId);
  if (contract.status === "cancelado") throw new Error("Este contrato já está cancelado");
  if (source === "financeiro" && contract.status === "liberado") {
    throw new Error("Contrato já liberado: registre o cancelamento no Customer Success (churn), que encerra produtos, receita e jornada do cliente");
  }
  const cancelledAt = options.cancelledAt ?? nowIso();
  const [billings, products, tasks] = await Promise.all([
    list<Billing>(COLLECTIONS.billing, { where: [["contractId", "==", contract.id]] }),
    list<ClientProduct>(COLLECTIONS.clientProducts, { where: [["contractId", "==", contract.id]] }),
    list<Task>(COLLECTIONS.tasks, { where: [["processId", "==", contract.id]] }),
  ]);

  const patch: Partial<Contract> = { status: "cancelado", cancelledAt, cancelReason: reason, cancelledBy: actor.id };
  await update<Contract>(COLLECTIONS.contracts, contract.id, patch);

  // Cobranças em aberto/vencidas deixam de ser devidas (pagas ficam como estão). Emitidas no provedor conectado
  // são canceladas lá também (falha do provedor não impede o cancelamento local: fica na nota do evento).
  const open = billings.filter((b) => b.status === "aberta" || b.status === "vencida");
  const stamp = nowIso();
  const providerNotes: string[] = [];
  for (const b of open) {
    const note = await cancelChargeAtProvider(b);
    if (note) providerNotes.push(`${TYPE_LABEL[b.type]}${b.installment ? ` ${b.installment}` : ""}: ${note}`);
  }
  await batchSet(open.map((b) => ({ collection: COLLECTIONS.billing, id: b.id, data: { status: "cancelada", updatedAt: stamp, ...(b.chargeStatus ? { chargeStatus: "cancelado" } : {}) }, merge: true })));
  const cancelledBillingIds = open.map((b) => b.id);
  if (providerNotes.length > 0) {
    await emitEvent({
      type: "note.added",
      actor,
      clientId: contract.clientId,
      entity: { type: "contract", id: contract.id },
      title: `Cobranças do contrato ${contract.number} no provedor de cobrança`,
      description: providerNotes.join(" · "),
      department: "financeiro",
      payload: { contractId: contract.id, providerNotes },
      timeline: false,
    });
  }

  // Antes da liberação, os produtos ainda em implantação não serão entregues.
  const cancelledProductIds: string[] = [];
  if (source === "financeiro") {
    for (const p of products.filter((x) => x.status === "em_implantacao")) {
      await update<ClientProduct>(COLLECTIONS.clientProducts, p.id, { status: "cancelado", cancelledAt });
      cancelledProductIds.push(p.id);
    }
  }

  for (const task of tasks.filter((t) => t.processType === "contract" && OPEN_TASK.has(t.status))) {
    try {
      await cancelTaskInternal(task, actor, `Contrato ${contract.number} cancelado: ${reason}`);
    } catch (error) {
      console.error(`[financeiro] falha ao cancelar a tarefa ${task.id}`, error);
    }
  }

  const openAmount = open.reduce((s, b) => s + b.amount, 0);
  const opp = contract.opportunityId ? await getById<Opportunity>(COLLECTIONS.opportunities, contract.opportunityId) : null;
  const sellerId = contract.sellerId ?? opp?.ownerId;
  const event = await emitEvent({
    type: "contract.cancelled",
    actor,
    clientId: contract.clientId,
    entity: { type: "contract", id: contract.id },
    title: `Contrato ${contract.number} cancelado`,
    description: [reason, cancelledBillingIds.length > 0 ? `${cancelledBillingIds.length} cobrança(s) em aberto cancelada(s) (${formatCurrency(openAmount)})` : "sem cobranças em aberto", source === "churn" ? "cancelamento do cliente registrado pelo CS" : null].filter(Boolean).join(" · "),
    department: "financeiro",
    payload: {
      contractId: contract.id,
      reason,
      cancelledBillingIds,
      cancelledProductIds,
      previousStatus: contract.status,
      source,
      cancelledAt,
      opportunityId: contract.opportunityId,
      saleNumber: contract.saleNumber ?? opp?.saleNumber,
      sellerId,
      ...auditChanges<Contract>(contract, { ...contract, ...patch }, ["status", "cancelReason"], reason),
    },
  });

  const financeManager = await getDepartmentManager("financeiro");
  const client = await getById<Client>(COLLECTIONS.clients, contract.clientId);
  await notify({
    userIds: [sellerId, contract.ownerId, financeManager?.id].filter((id, i, arr): id is string => Boolean(id) && id !== actor.id && arr.indexOf(id) === i),
    kind: "atencao",
    title: `Contrato cancelado: ${client?.tradeName ?? contract.number}`,
    body: `${contract.number} · ${reason}`,
    href: `/financeiro/contratos/${contract.id}`,
    entity: { type: "contract", id: contract.id },
    eventId: event.id,
  });
  return { contract: { ...contract, ...patch }, cancelledBillingIds, cancelledProductIds };
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
    if (!(actor.canReleaseWithPendency ?? actor.isManager)) throw new Error("Seu perfil não permite liberar com pendência");
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

  // Ordem dos marcos na linha do tempo: "liberado para implantação" antes de "projeto de implantação criado".
  // O handler do workflow avança Financeiro → Implantação aqui; a criação do projeto (abaixo) grava o projectId no
  // contexto da jornada. Nenhum handler depende de payload.projectId neste evento.
  await emitEvent({
    type: "financial.released",
    actor,
    clientId: contract.clientId,
    entity: { type: "contract", id: contract.id },
    title: `Contrato ${contract.number} liberado para implantação${exception ? " (exceção)" : ""}`,
    description: exception ? `Liberado com pendência por ${actor.name}: ${reason}` : `Critérios atendidos: ${gate.checks.map((c) => c.label.toLowerCase()).join(", ")}`,
    department: "financeiro",
    payload: { contractId: contract.id, exceptionReason: exception ? reason : undefined, monthlyTotal: contract.monthlyTotal, setupTotal: contract.setupTotal, checks: gate.checks },
  });

  // Criação do projeto: caminho único no módulo de Implantação (combina templates, SLA, evento implementation.created).
  const project = await createProjectFromContract(released, actor, client);

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

/**
 * contract.signed → tarefa "Gerar cobrança e liberar" para o responsável financeiro.
 *
 * Uma tarefa financeira por etapa do contrato: a tarefa da venda ("Emitir contrato e cobrança", criada no ganho)
 * cobre gerar o contrato e conseguir a assinatura; assinado por todos, ela é concluída aqui e a etapa seguinte
 * (gerar cobranças, confirmar o pagamento exigido e liberar) passa a ser a única tarefa aberta do contrato.
 */
export async function onContractSigned(event: DomainEvent): Promise<void> {
  const contract = await getById<Contract>(COLLECTIONS.contracts, event.entityId ?? "");
  if (!contract) return;
  const client = await getById<Client>(COLLECTIONS.clients, contract.clientId);
  const assigneeId = contract.ownerId ?? (await getDepartmentManager("financeiro"))?.id;
  const title = `Gerar cobrança e liberar: ${client?.tradeName ?? contract.number}`;
  const existing = await list<Task>(COLLECTIONS.tasks, { where: [["processId", "==", contract.id]] });
  const actor = { id: event.actorId, name: event.actorName };
  for (const task of existing.filter((t) => t.processType === "contract" && t.origin === "evento" && t.title.startsWith("Emitir contrato e cobrança") && OPEN_TASK.has(t.status))) {
    try {
      await completeTaskInternal(task, actor);
    } catch (error) {
      console.error(`[financeiro] falha ao concluir a tarefa ${task.id} após a assinatura`, error);
    }
  }
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
    actor,
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
