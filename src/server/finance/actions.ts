"use server";
/**
 * Server Actions do módulo Financeiro. Padrão: requireUser() → permissão → validação zod → serviço
 * (regras e eventos) → revalidatePath. Todas devolvem ActionResult com mensagem em português.
 */
import { revalidatePath } from "next/cache";
import { z } from "zod";
import { canAccessModule, requireUser } from "@/server/auth/session";
import { getById } from "@/server/db";
import { COLLECTIONS, type ActionResult, type Billing, type CurrentUser, type UserRef } from "@/domain/types";
import {
  addContractDocument,
  addSigner,
  cancelBilling,
  completeBillingData,
  ensureContractForOpportunity,
  generateBillings,
  registerBillingCall,
  registerPayment,
  registerPendency,
  releaseContract,
  removeSigner,
  resolvePendency,
  sendBillingWhatsapp,
  sendForSignature,
  sendSignatureReminder,
  simulateSignature,
  updateContractConditions,
  updateContractItems,
} from "./service";
import {
  billingContactSchema,
  canOperateFinance,
  billingDataSchema,
  cancelBillingSchema,
  contractDocumentSchema,
  contractIdSchema,
  opportunityIdSchema,
  pendencySchema,
  registerPaymentSchema,
  releaseSchema,
  resolvePendencySchema,
  signerRefSchema,
  signerSchema,
  updateConditionsSchema,
  updateItemsSchema,
  zodMessage,
} from "./schemas";

type Failure = { ok: false; error: string };

function fail(error: unknown, fallback: string): Failure {
  if (error instanceof z.ZodError) return { ok: false, error: zodMessage(error) };
  if (error instanceof Error && error.message) {
    // Erros de regra do serviço já vêm em português; erros técnicos ficam no log.
    if (!/firestore|firebase|ECONN|deadline|permission|undefined|null/i.test(error.message)) return { ok: false, error: error.message };
  }
  console.error(`[financeiro] ${fallback}`, error);
  return { ok: false, error: fallback };
}

const actorOf = (user: CurrentUser): UserRef => ({ id: user.id, name: user.name });

/** Quem opera o Financeiro: equipe financeira, gestores, diretoria e admin (Vendas só consulta). */
async function requireFinanceOperator(): Promise<CurrentUser> {
  const user = await requireUser();
  if (!canAccessModule(user, "financeiro")) throw new Error("Seu perfil não tem acesso ao módulo Financeiro");
  if (!canOperateFinance(user)) {
    throw new Error("Somente a equipe financeira ou gestores podem executar esta ação");
  }
  return user;
}

function revalidateFinance(clientId?: string, contractId?: string) {
  revalidatePath("/financeiro", "layout");
  if (contractId) revalidatePath(`/financeiro/contratos/${contractId}`);
  if (clientId) revalidatePath(`/clientes/${clientId}`);
  revalidatePath("/workflow", "layout");
  revalidatePath("/tarefas");
  revalidatePath("/meu-dia");
}

async function clientOfContract(contractId: string): Promise<string | undefined> {
  const c = await getById<{ id: string; organizationId: string; createdAt: string; updatedAt: string; clientId: string }>(COLLECTIONS.contracts, contractId);
  return c?.clientId;
}

async function billingRef(billingId: string): Promise<Billing | null> {
  return getById<Billing>(COLLECTIONS.billing, billingId);
}

// ---------------------------------------------------------------------------
// Contrato
// ---------------------------------------------------------------------------

export async function createContractFromOpportunityAction(input: unknown): Promise<ActionResult<{ contractId: string }>> {
  try {
    const user = await requireFinanceOperator();
    const { opportunityId } = opportunityIdSchema.parse(input);
    const contract = await ensureContractForOpportunity(opportunityId, actorOf(user));
    if (!contract) return { ok: false, error: "A oportunidade não está marcada como ganha" };
    revalidateFinance(contract.clientId, contract.id);
    return { ok: true, data: { contractId: contract.id } };
  } catch (error) {
    return fail(error, "Não foi possível gerar o contrato");
  }
}

export async function updateContractItemsAction(input: unknown): Promise<ActionResult<{ versioned: boolean }>> {
  try {
    const user = await requireFinanceOperator();
    const data = updateItemsSchema.parse(input);
    const result = await updateContractItems(data.contractId, data.items, actorOf(user));
    revalidateFinance(result.contract.clientId, data.contractId);
    return { ok: true, data: { versioned: result.versioned } };
  } catch (error) {
    return fail(error, "Não foi possível salvar os itens");
  }
}

export async function updateContractConditionsAction(input: unknown): Promise<ActionResult<{ versioned: boolean }>> {
  try {
    const user = await requireFinanceOperator();
    const data = updateConditionsSchema.parse(input);
    const result = await updateContractConditions(data, actorOf(user));
    revalidateFinance(await clientOfContract(data.contractId), data.contractId);
    return { ok: true, data: result };
  } catch (error) {
    return fail(error, "Não foi possível salvar as condições");
  }
}

export async function completeBillingDataAction(input: unknown): Promise<ActionResult<{ filled: string[] }>> {
  try {
    const user = await requireFinanceOperator();
    const data = billingDataSchema.parse(input);
    const result = await completeBillingData(data, actorOf(user));
    revalidateFinance(await clientOfContract(data.contractId), data.contractId);
    return { ok: true, data: result };
  } catch (error) {
    return fail(error, "Não foi possível salvar os dados de faturamento");
  }
}

export async function addSignerAction(input: unknown): Promise<ActionResult> {
  try {
    const user = await requireFinanceOperator();
    const data = signerSchema.parse(input);
    await addSigner(data, actorOf(user));
    revalidateFinance(undefined, data.contractId);
    return { ok: true, data: undefined };
  } catch (error) {
    return fail(error, "Não foi possível adicionar o signatário");
  }
}

export async function removeSignerAction(input: unknown): Promise<ActionResult> {
  try {
    const user = await requireFinanceOperator();
    const data = signerRefSchema.parse(input);
    await removeSigner(data, actorOf(user));
    revalidateFinance(undefined, data.contractId);
    return { ok: true, data: undefined };
  } catch (error) {
    return fail(error, "Não foi possível remover o signatário");
  }
}

export async function sendForSignatureAction(input: unknown): Promise<ActionResult<{ envelopeId: string }>> {
  try {
    const user = await requireFinanceOperator();
    const { contractId } = contractIdSchema.parse(input);
    const contract = await sendForSignature(contractId, actorOf(user));
    revalidateFinance(contract.clientId, contractId);
    return { ok: true, data: { envelopeId: contract.signatureEnvelopeId ?? "" } };
  } catch (error) {
    return fail(error, "Não foi possível enviar para assinatura");
  }
}

export async function simulateSignatureAction(input: unknown): Promise<ActionResult<{ allSigned: boolean }>> {
  try {
    const user = await requireFinanceOperator();
    const data = signerRefSchema.parse(input);
    const result = await simulateSignature(data.contractId, data.email, actorOf(user));
    revalidateFinance(await clientOfContract(data.contractId), data.contractId);
    return { ok: true, data: result };
  } catch (error) {
    return fail(error, "Não foi possível registrar a assinatura");
  }
}

export async function sendSignatureReminderAction(input: unknown): Promise<ActionResult> {
  try {
    const user = await requireFinanceOperator();
    const data = signerRefSchema.parse(input);
    await sendSignatureReminder(data.contractId, data.email, actorOf(user));
    revalidateFinance(await clientOfContract(data.contractId), data.contractId);
    return { ok: true, data: undefined };
  } catch (error) {
    return fail(error, "Não foi possível enviar o lembrete");
  }
}

// ---------------------------------------------------------------------------
// Cobranças
// ---------------------------------------------------------------------------

export async function generateBillingsAction(input: unknown): Promise<ActionResult<{ count: number }>> {
  try {
    const user = await requireFinanceOperator();
    const { contractId } = contractIdSchema.parse(input);
    const created = await generateBillings(contractId, actorOf(user));
    revalidateFinance(created[0]?.clientId, contractId);
    return { ok: true, data: { count: created.length } };
  } catch (error) {
    return fail(error, "Não foi possível gerar as cobranças");
  }
}

export async function registerPaymentAction(input: unknown): Promise<ActionResult> {
  try {
    const user = await requireFinanceOperator();
    const data = registerPaymentSchema.parse(input);
    const paid = await registerPayment(data, actorOf(user));
    revalidateFinance(paid.clientId, paid.contractId);
    revalidatePath("/vendas", "layout");
    return { ok: true, data: undefined };
  } catch (error) {
    return fail(error, "Não foi possível registrar o pagamento");
  }
}

export async function cancelBillingAction(input: unknown): Promise<ActionResult> {
  try {
    const user = await requireFinanceOperator();
    const data = cancelBillingSchema.parse(input);
    const billing = await billingRef(data.billingId);
    await cancelBilling(data.billingId, data.reason, actorOf(user));
    revalidateFinance(billing?.clientId, billing?.contractId);
    return { ok: true, data: undefined };
  } catch (error) {
    return fail(error, "Não foi possível cancelar a cobrança");
  }
}

export async function sendBillingWhatsappAction(input: unknown): Promise<ActionResult> {
  try {
    const user = await requireFinanceOperator();
    const data = billingContactSchema.parse(input);
    const billing = await billingRef(data.billingId);
    await sendBillingWhatsapp(data.billingId, data.notes, actorOf(user));
    revalidateFinance(billing?.clientId, billing?.contractId);
    return { ok: true, data: undefined };
  } catch (error) {
    return fail(error, "Não foi possível enviar a cobrança por WhatsApp");
  }
}

export async function registerBillingCallAction(input: unknown): Promise<ActionResult> {
  try {
    const user = await requireFinanceOperator();
    const data = billingContactSchema.parse(input);
    const billing = await billingRef(data.billingId);
    await registerBillingCall(data.billingId, data.notes, actorOf(user));
    revalidateFinance(billing?.clientId, billing?.contractId);
    return { ok: true, data: undefined };
  } catch (error) {
    return fail(error, "Não foi possível registrar a ligação");
  }
}

// ---------------------------------------------------------------------------
// Pendências, documentos e liberação
// ---------------------------------------------------------------------------

export async function registerPendencyAction(input: unknown): Promise<ActionResult> {
  try {
    const user = await requireFinanceOperator();
    const data = pendencySchema.parse(input);
    await registerPendency(data.contractId, data.reason, actorOf(user));
    revalidateFinance(await clientOfContract(data.contractId), data.contractId);
    return { ok: true, data: undefined };
  } catch (error) {
    return fail(error, "Não foi possível registrar a pendência");
  }
}

export async function resolvePendencyAction(input: unknown): Promise<ActionResult<{ status: string }>> {
  try {
    const user = await requireFinanceOperator();
    const data = resolvePendencySchema.parse(input);
    const status = await resolvePendency(data.contractId, data.resolution, actorOf(user));
    revalidateFinance(await clientOfContract(data.contractId), data.contractId);
    return { ok: true, data: { status } };
  } catch (error) {
    return fail(error, "Não foi possível resolver a pendência");
  }
}

export async function addContractDocumentAction(input: unknown): Promise<ActionResult<{ id: string }>> {
  try {
    const user = await requireFinanceOperator();
    const data = contractDocumentSchema.parse(input);
    const id = await addContractDocument(data, actorOf(user));
    revalidateFinance(await clientOfContract(data.contractId), data.contractId);
    return { ok: true, data: { id } };
  } catch (error) {
    return fail(error, "Não foi possível anexar o documento");
  }
}

export async function releaseContractAction(input: unknown): Promise<ActionResult<{ projectId: string | null; exception: boolean }>> {
  try {
    const user = await requireFinanceOperator();
    const data = releaseSchema.parse(input);
    const result = await releaseContract(data.contractId, { id: user.id, name: user.name, role: user.role, isManager: user.isManager }, data.exceptionReason);
    revalidateFinance(result.contract.clientId, data.contractId);
    revalidatePath("/clientes", "layout");
    revalidatePath("/implantacao", "layout");
    return { ok: true, data: { projectId: result.projectId, exception: result.exception } };
  } catch (error) {
    return fail(error, "Não foi possível liberar o contrato");
  }
}
