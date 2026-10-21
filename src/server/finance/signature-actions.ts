"use server";
/**
 * Server Actions da assinatura eletrônica (Financeiro › Assinaturas): configuração, modelos de contrato, caixa de
 * entrada da Clicksign e as opções de assinatura de cada contrato. O envio do arquivo Word é pela rota
 * /api/financeiro/modelos (arquivo maior que o limite das Server Actions).
 */
import { revalidatePath } from "next/cache";
import { z } from "zod";
import { failAction, requirePermission } from "@/server/auth/session";
import { BusinessError } from "@/server/auth/error-classes";
import { getById, update } from "@/server/db";
import { SIGNATURE_AUTH_METHODS, COLLECTIONS, type ActionResult, type Contract, type CurrentUser, type UserRef } from "@/domain/types";
import { CONTRACT_FIELDS } from "@/domain/contract-templates";
import { emitEvent } from "@/server/events";
import { assertContractAccess } from "./access";
import { saveInterosTemplate, saveSignatureSettings, saveTemplateVariables, setTemplateState } from "./contract-templates";
import { assignInboxItem, ignoreInboxItem, reopenInboxItem } from "./signature-inbox";

const actorOf = (user: CurrentUser): UserRef => ({ id: user.id, name: user.name });
const FIELD_KEYS = CONTRACT_FIELDS.map((f) => f.key) as [string, ...string[]];

function revalidate(contractId?: string) {
  revalidatePath("/financeiro/assinaturas");
  if (contractId) revalidatePath(`/financeiro/contratos/${contractId}`);
}

const settingsSchema = z.object({
  companySigner: z.object({
    enabled: z.boolean(),
    userId: z.string().max(80).optional(),
    name: z.string().max(120),
    email: z.string().max(160),
    role: z.string().max(120),
  }),
  defaultAuth: z.enum(SIGNATURE_AUTH_METHODS),
});

export async function saveSignatureSettingsAction(input: unknown): Promise<ActionResult> {
  try {
    const user = await requirePermission("financeiro.assinaturas.configuracao.editar");
    const data = settingsSchema.parse(input);
    await saveSignatureSettings({ ...data, companySigner: { ...data.companySigner, userId: data.companySigner.userId || undefined } }, actorOf(user));
    revalidate();
    return { ok: true, data: undefined };
  } catch (error) {
    return failAction(error, "Não foi possível salvar a configuração", "assinatura");
  }
}

const variableSchema = z.object({ name: z.string().min(1).max(80), field: z.enum(FIELD_KEYS).optional(), fixed: z.string().max(500).optional() });

const interosTemplateSchema = z.object({
  id: z.string().max(80).optional(),
  name: z.string().trim().min(3, "Dê um nome ao modelo").max(120),
  description: z.string().max(300).optional(),
  title: z.string().max(160).optional(),
  clauses: z.string().trim().min(20, "Escreva as cláusulas do contrato").max(60_000, "Texto grande demais (máx. 60 mil caracteres)"),
  variables: z.array(variableSchema).max(200).optional(),
});

export async function saveInterosTemplateAction(input: unknown): Promise<ActionResult<{ id: string; version: number }>> {
  try {
    const user = await requirePermission("financeiro.assinaturas.modelos.editar");
    const data = interosTemplateSchema.parse(input);
    const t = await saveInterosTemplate(data, actorOf(user));
    revalidate();
    return { ok: true, data: { id: t.id, version: t.version } };
  } catch (error) {
    return failAction(error, "Não foi possível salvar o modelo", "assinatura");
  }
}

export async function saveTemplateVariablesAction(input: unknown): Promise<ActionResult> {
  try {
    const user = await requirePermission("financeiro.assinaturas.modelos.editar");
    const data = z.object({ templateId: z.string().min(1).max(80), variables: z.array(variableSchema).max(200) }).parse(input);
    await saveTemplateVariables(data.templateId, data.variables, actorOf(user));
    revalidate();
    return { ok: true, data: undefined };
  } catch (error) {
    return failAction(error, "Não foi possível salvar as variáveis", "assinatura");
  }
}

export async function setTemplateStateAction(input: unknown): Promise<ActionResult> {
  try {
    const user = await requirePermission("financeiro.assinaturas.modelos.editar");
    const data = z.object({ templateId: z.string().min(1).max(80), active: z.boolean().optional(), isDefault: z.boolean().optional() }).parse(input);
    await setTemplateState(data.templateId, data, actorOf(user));
    revalidate();
    return { ok: true, data: undefined };
  } catch (error) {
    return failAction(error, "Não foi possível alterar o modelo", "assinatura");
  }
}

export async function assignInboxItemAction(input: unknown): Promise<ActionResult> {
  try {
    const user = await requirePermission("financeiro.assinaturas.entrada.vincular");
    const data = z.object({ id: z.string().min(1).max(120), clientId: z.string().min(1, "Escolha o cliente").max(80), contractId: z.string().max(80).optional() }).parse(input);
    if (data.contractId) await assertContractAccess(user, data.contractId);
    const item = await assignInboxItem({ ...data, contractId: data.contractId || undefined }, actorOf(user));
    revalidate(item.contractId);
    revalidatePath(`/clientes/${item.clientId}`);
    return { ok: true, data: undefined };
  } catch (error) {
    return failAction(error, "Não foi possível vincular o documento", "assinatura");
  }
}

export async function ignoreInboxItemAction(input: unknown): Promise<ActionResult> {
  try {
    const user = await requirePermission("financeiro.assinaturas.entrada.vincular");
    const data = z.object({ id: z.string().min(1).max(120), reason: z.string().trim().min(3, "Informe o motivo").max(300) }).parse(input);
    await ignoreInboxItem(data, actorOf(user));
    revalidate();
    return { ok: true, data: undefined };
  } catch (error) {
    return failAction(error, "Não foi possível ignorar o documento", "assinatura");
  }
}

export async function reopenInboxItemAction(input: unknown): Promise<ActionResult> {
  try {
    const user = await requirePermission("financeiro.assinaturas.entrada.vincular");
    const { id } = z.object({ id: z.string().min(1).max(120) }).parse(input);
    await reopenInboxItem(id, actorOf(user));
    revalidate();
    return { ok: true, data: undefined };
  } catch (error) {
    return failAction(error, "Não foi possível reabrir o documento", "assinatura");
  }
}

/**
 * Modelo do documento e autenticação dos signatários de um contrato. Vale para a próxima geração do documento: um
 * documento já gerado continua com o modelo fixado (gere de novo para usar o novo).
 */
export async function setContractSignatureOptionsAction(input: unknown): Promise<ActionResult> {
  try {
    const user = await requirePermission("financeiro.contratos.assinatura.editar");
    const data = z.object({ contractId: z.string().min(1).max(80), templateId: z.string().max(80).optional(), signatureAuth: z.enum(SIGNATURE_AUTH_METHODS).optional() }).parse(input);
    await assertContractAccess(user, data.contractId);
    const contract = await getById<Contract>(COLLECTIONS.contracts, data.contractId);
    if (!contract) throw new BusinessError("Contrato não encontrado");
    if (contract.status === "liberado" || contract.status === "cancelado" || contract.signedAt) throw new BusinessError("Contrato já assinado ou encerrado");
    // "" = voltar ao padrão (modelo padrão / autenticação da configuração).
    await update<Contract>(COLLECTIONS.contracts, contract.id, { templateId: data.templateId ?? contract.templateId ?? "", ...(data.signatureAuth ? { signatureAuth: data.signatureAuth } : {}) });
    await emitEvent({
      type: "contract.updated",
      actor: actorOf(user),
      clientId: contract.clientId,
      entity: { type: "contract", id: contract.id },
      title: `Opções de assinatura do contrato ${contract.number} alteradas`,
      department: "financeiro",
      payload: { contractId: contract.id, kind: "assinatura", templateId: data.templateId, signatureAuth: data.signatureAuth },
      timeline: false,
    });
    revalidate(contract.id);
    return { ok: true, data: undefined };
  } catch (error) {
    return failAction(error, "Não foi possível salvar as opções de assinatura", "assinatura");
  }
}
