"use server";
/**
 * Server Actions da integração com o ERP Intercert (aba Módulos ERP da ficha e Administração › Integrações). Cada
 * action exige a permissão do catálogo como primeira linha e confere o escopo do cliente no servidor; a interface só
 * esconde botões.
 */
import { revalidatePath } from "next/cache";
import { z } from "zod";
import { PermissionError, can, failAction, requirePermission } from "@/server/auth/session";
import { canSeeClientId } from "@/server/clients/access";
import { ERP_LICENSE_ITEM_STATES, type ErpChangeRequest } from "@/domain/erp/types";
import type { CurrentUser, UserRef } from "@/domain/types";
import { ErpChangeBlocked, approveLicenseChange, cancelLicenseChange, getChange, processPendingErpChanges, reviewLicenseChange, sendLicenseChange, submitLicenseChange } from "./changes";
import { findErpCompaniesByCnpj, linkByIdentification, linkWithCode, provisionCompany, resumeProvisioning, retryProvisioning } from "./provisioning";
import { getErpTowerView, getErpUsageView, type ErpTowerView, type ErpUsageView } from "./tower-view";
import { importErpCatalog } from "./catalog-store";
import { getCurrentCatalog } from "./catalog-store";

type Result<T> = { ok: true; data: T } | { ok: false; error: string; code?: string };

const actorOf = (user: CurrentUser): UserRef => ({ id: user.id, name: user.name });

function fail(error: unknown, fallback: string): { ok: false; error: string; code?: string } {
  if (error instanceof ErpChangeBlocked) return { ok: false, error: error.message, code: error.code };
  return failAction(error, fallback, "erp");
}

async function assertClient(user: CurrentUser, clientId: string): Promise<void> {
  if (!(await canSeeClientId(user, clientId))) throw new PermissionError();
}

async function changeInScope(user: CurrentUser, changeId: string): Promise<ErpChangeRequest> {
  const change = await getChange(changeId);
  if (!change) throw new ErpChangeBlocked("Alteração não encontrada.", "nao_encontrada");
  await assertClient(user, change.clientId);
  return change;
}

function revalidateClient(clientId: string) {
  revalidatePath(`/clientes/${clientId}`);
}

const clientIdSchema = z.string().min(1).max(64);
const draftSchema = z
  .array(
    z.object({
      code: z.string().regex(/^\d{2}\.\d{2}(\.\d{2})?$/),
      state: z.enum(ERP_LICENSE_ITEM_STATES),
      until: z.string().datetime({ offset: true }).nullish(),
      effectiveAt: z.string().datetime({ offset: true }).nullish(),
    }),
  )
  .max(200);
const modeSchema = z.enum(["legacy", "shadow", "enforced"]).nullish();

/** Recarrega a aba (nova leitura do ERP na próxima renderização). */
export async function refreshErpStateAction(input: unknown): Promise<Result<null>> {
  try {
    const user = await requirePermission("operacao.clientes.erp.ver");
    const { clientId } = z.object({ clientId: clientIdSchema }).parse(input);
    await assertClient(user, clientId);
    revalidateClient(clientId);
    return { ok: true, data: null };
  } catch (error) {
    return fail(error, "Não foi possível recarregar o estado do ERP");
  }
}

export interface ReviewSummary {
  baseVersion: number;
  initial: boolean;
  plan: { code: string; name: string; from: string | null; to: string; origin: string; relatedTo: string | null; relatedName: string | null; until: string | null; effectiveAt: string | null }[];
  errors: { code: string; message: string }[];
  warnings: { code: string; message: string }[];
  modeFrom: string | null;
  controlMode: string | null;
  simulation: ErpChangeRequest["simulation"];
  simulationError: string | null;
  requiresApproval: boolean;
  approvalReasons: string[];
  canApprove: boolean;
  openChangeId: string | null;
}

/** Revisão do lote preparado na tela (plano completo + simulação do ERP). Não grava nada. */
export async function reviewErpChangesAction(input: unknown): Promise<Result<ReviewSummary>> {
  try {
    const user = await requirePermission("operacao.clientes.erp.alterar");
    const data = z.object({ clientId: clientIdSchema, draft: draftSchema, controlMode: modeSchema }).parse(input);
    await assertClient(user, data.clientId);
    const review = await reviewLicenseChange({ clientId: data.clientId, draft: data.draft, controlMode: data.controlMode ?? null });
    const loaded = await getCurrentCatalog(review.link.environment);
    const nameOf = (code: string | null | undefined) => (code ? (loaded?.index.byCode.get(code)?.name ?? code) : null);
    return {
      ok: true,
      data: {
        baseVersion: review.baseVersion,
        initial: review.initial,
        plan: review.plan.changes.map((c) => ({ code: c.code, name: nameOf(c.code) ?? c.code, from: c.from, to: c.to, origin: c.origin, relatedTo: c.relatedTo ?? null, relatedName: nameOf(c.relatedTo), until: c.until ?? null, effectiveAt: c.effectiveAt ?? null })),
        errors: review.plan.errors.map((e) => ({ code: e.code, message: e.message })),
        warnings: review.plan.warnings.map((w) => ({ code: w.code, message: w.message })),
        modeFrom: review.modeFrom,
        controlMode: review.controlMode,
        simulation: review.simulation,
        simulationError: review.simulationError,
        requiresApproval: review.requiresApproval,
        approvalReasons: review.approvalReasons,
        canApprove: can(user, "operacao.clientes.erp.aprovar"),
        openChangeId: review.openChange?.id ?? null,
      },
    };
  } catch (error) {
    return fail(error, "Não foi possível revisar as alterações");
  }
}

export interface ChangeOutcome {
  id: string;
  status: ErpChangeRequest["status"];
  licenseVersion: number | null;
  result: ErpChangeRequest["result"];
  lastError: ErpChangeRequest["lastError"];
  nextAttemptAt: string | null;
  requiresApproval: boolean;
}

const outcome = (c: ErpChangeRequest): ChangeOutcome => ({ id: c.id, status: c.status, licenseVersion: c.licenseVersion, result: c.result, lastError: c.lastError, nextAttemptAt: c.nextAttemptAt, requiresApproval: c.requiresApproval });

/** Confirma e envia (ou deixa aguardando aprovação). */
export async function submitErpChangesAction(input: unknown): Promise<Result<ChangeOutcome>> {
  try {
    const user = await requirePermission("operacao.clientes.erp.alterar");
    const data = z
      .object({ clientId: clientIdSchema, draft: draftSchema, controlMode: modeSchema, baseVersion: z.number().int().min(0), reason: z.string().trim().min(3).max(300), contractReference: z.string().trim().max(100).nullish() })
      .parse(input);
    await assertClient(user, data.clientId);
    const change = await submitLicenseChange({ ...data, controlMode: data.controlMode ?? null, actor: actorOf(user), canApprove: can(user, "operacao.clientes.erp.aprovar") });
    revalidateClient(data.clientId);
    return { ok: true, data: outcome(change) };
  } catch (error) {
    return fail(error, "Não foi possível enviar as alterações ao ERP");
  }
}

/** Tenta de novo (mesma chave e mesmo retrato; o ERP não duplica). Também para criação de empresa interrompida. */
export async function retryErpChangeAction(input: unknown): Promise<Result<ChangeOutcome>> {
  try {
    const user = await requirePermission("operacao.clientes.erp.alterar");
    const { changeId } = z.object({ changeId: z.string().min(1).max(64) }).parse(input);
    const change = await changeInScope(user, changeId);
    if (change.kind === "provisionamento") {
      if (!can(user, "operacao.clientes.erp.provisionar")) throw new PermissionError();
      const res = await retryProvisioning(change.id, actorOf(user));
      revalidateClient(change.clientId);
      return { ok: true, data: outcome(res.change) };
    }
    const out = await sendLicenseChange(change.id);
    revalidateClient(change.clientId);
    return { ok: true, data: outcome(out) };
  } catch (error) {
    return fail(error, "Não foi possível tentar de novo");
  }
}

/** Cancela alteração ainda não aplicada (aguardando aprovação ou sincronização), com motivo. */
export async function cancelErpChangeAction(input: unknown): Promise<Result<ChangeOutcome>> {
  try {
    const user = await requirePermission("operacao.clientes.erp.alterar");
    const { changeId, reason } = z.object({ changeId: z.string().min(1).max(64), reason: z.string().trim().min(3).max(300) }).parse(input);
    const change = await changeInScope(user, changeId);
    const out = await cancelLicenseChange(change.id, actorOf(user), reason);
    revalidateClient(change.clientId);
    return { ok: true, data: outcome(out) };
  } catch (error) {
    return fail(error, "Não foi possível cancelar a alteração");
  }
}

/** Aprova um desligamento que exigia aprovação (outra pessoa, com a permissão) e envia ao ERP. */
export async function approveErpChangeAction(input: unknown): Promise<Result<ChangeOutcome>> {
  try {
    const user = await requirePermission("operacao.clientes.erp.aprovar");
    const { changeId } = z.object({ changeId: z.string().min(1).max(64) }).parse(input);
    const change = await changeInScope(user, changeId);
    const out = await approveLicenseChange(change.id, actorOf(user));
    revalidateClient(change.clientId);
    return { ok: true, data: outcome(out) };
  } catch (error) {
    return fail(error, "Não foi possível aprovar a alteração");
  }
}

/** Empresas do ERP com o CNPJ do cliente (para vincular por identificação conferida). */
export async function findErpCompanyAction(input: unknown): Promise<Result<Awaited<ReturnType<typeof findErpCompaniesByCnpj>>>> {
  try {
    const user = await requirePermission("operacao.clientes.erp.provisionar");
    const { clientId } = z.object({ clientId: clientIdSchema }).parse(input);
    await assertClient(user, clientId);
    return { ok: true, data: await findErpCompaniesByCnpj(clientId) };
  } catch (error) {
    return fail(error, "Não foi possível procurar a empresa no ERP");
  }
}

/** Vincula empresa existente: com o código do administrador dela, ou por identificação conferida (id + CNPJ). */
export async function linkErpCompanyAction(input: unknown): Promise<Result<{ linkId: string }>> {
  try {
    const user = await requirePermission("operacao.clientes.erp.provisionar");
    const data = z
      .discriminatedUnion("method", [
        z.object({ method: z.literal("codigo"), clientId: clientIdSchema, erpCompanyId: z.string().trim().min(8).max(64), cnpj: z.string().trim().min(14).max(18), code: z.string().trim().min(6).max(20) }),
        z.object({ method: z.literal("identificacao"), clientId: clientIdSchema, erpCompanyId: z.string().trim().min(8).max(64) }),
      ])
      .parse(input);
    await assertClient(user, data.clientId);
    const link = data.method === "codigo" ? await linkWithCode({ clientId: data.clientId, erpCompanyId: data.erpCompanyId, cnpj: data.cnpj, code: data.code, actor: actorOf(user) }) : await linkByIdentification({ clientId: data.clientId, erpCompanyId: data.erpCompanyId, actor: actorOf(user) });
    revalidateClient(data.clientId);
    return { ok: true, data: { linkId: link.id } };
  } catch (error) {
    return fail(error, "Não foi possível vincular a empresa");
  }
}

const addressSchema = z
  .object({
    cep: z.string().trim().max(9).nullish(),
    logradouro: z.string().trim().max(200).nullish(),
    numero: z.string().trim().max(20).nullish(),
    complemento: z.string().trim().max(100).nullish(),
    bairro: z.string().trim().max(100).nullish(),
    municipio: z.string().trim().max(100).nullish(),
    codigoMunicipioIbge: z.string().trim().max(7).nullish(),
    uf: z.string().trim().length(2).nullish(),
  })
  .nullish();

export interface ProvisionOutcome {
  change: ChangeOutcome;
  linked: boolean;
  invite: { link: string | null; delivered: boolean | null; channel: string | null; detail: string | null; expiresAt: string | null } | null;
  license: ChangeOutcome | null;
  licenseError: string | null;
  implantacao: string | null;
}

/** Cria a empresa no ERP (empresa, unidade inicial, módulos, administrador e convite) e envia a licença inicial. */
export async function provisionErpCompanyAction(input: unknown): Promise<Result<ProvisionOutcome>> {
  try {
    const user = await requirePermission("operacao.clientes.erp.provisionar");
    const data = z
      .object({
        clientId: clientIdSchema,
        company: z.object({
          tipo: z.enum(["varejo", "escritorio_contabil"]).optional(),
          razaoSocial: z.string().trim().min(2).max(200),
          nomeFantasia: z.string().trim().max(200).nullish(),
          cnpj: z.string().trim().min(14).max(18),
          inscricaoEstadual: z.string().trim().max(30).nullish(),
          inscricaoMunicipal: z.string().trim().max(30).nullish(),
          regimeTributario: z.enum(["simples", "simples_excesso", "presumido", "real", "mei"]).nullish(),
          email: z.string().trim().email().max(200).nullish().or(z.literal("")),
          telefone: z.string().trim().max(20).nullish(),
          endereco: addressSchema,
        }),
        initialUnit: z.object({ nome: z.string().trim().max(100).nullish(), codigo: z.string().trim().max(20).nullish() }).nullish(),
        units: z.array(z.string().regex(/^\d{2}\.\d{2}$/)).min(1).max(200),
        packageKey: z.string().max(60).nullish(),
        admin: z.object({ nome: z.string().trim().min(2).max(120), email: z.string().trim().email().max(200), telefone: z.string().trim().max(20).nullish() }),
        entregaConvite: z.enum(["interos", "erp"]),
        contractReference: z.string().trim().max(100).nullish(),
        plan: z.string().trim().max(60).nullish(),
        reason: z.string().trim().min(3).max(300),
      })
      .parse(input);
    await assertClient(user, data.clientId);
    const res = await provisionCompany({
      clientId: data.clientId,
      company: { ...data.company, email: data.company.email || null },
      initialUnit: data.initialUnit ?? null,
      units: data.units,
      packageKey: data.packageKey ?? null,
      admin: data.admin,
      entregaConvite: data.entregaConvite,
      contractReference: data.contractReference ?? null,
      plan: data.plan ?? null,
      reason: data.reason,
      actor: actorOf(user),
    });
    // Sem revalidar aqui: a aba trocaria de painel na hora e o resultado (com o link do convite, mostrado uma única
    // vez) sumiria. A tela recarrega quando a pessoa fecha o resultado.
    return { ok: true, data: { change: outcome(res.change), linked: Boolean(res.link), invite: res.invite, license: res.licenseChange ? outcome(res.licenseChange) : null, licenseError: res.licenseError, implantacao: res.implantacao } };
  } catch (error) {
    return fail(error, "Não foi possível criar a empresa no ERP");
  }
}

/** Retoma a implantação parada no ERP. */
export async function resumeErpProvisioningAction(input: unknown): Promise<Result<{ implantacao: string | null; invite: ProvisionOutcome["invite"] }>> {
  try {
    const user = await requirePermission("operacao.clientes.erp.provisionar");
    const { changeId } = z.object({ changeId: z.string().min(1).max(64) }).parse(input);
    const change = await changeInScope(user, changeId);
    const res = await resumeProvisioning(change.id, actorOf(user));
    revalidateClient(change.clientId);
    return { ok: true, data: { implantacao: res.implantacao, invite: res.invite } };
  } catch (error) {
    return fail(error, "Não foi possível retomar a implantação");
  }
}

/** Indicadores da Torre de Controle do ERP para o período (cruzados com os módulos da empresa). */
export async function loadErpTowerAction(input: unknown): Promise<Result<ErpTowerView>> {
  try {
    const user = await requirePermission("operacao.clientes.erp-torre.ver");
    const data = z.object({ clientId: clientIdSchema, de: z.string().nullish(), ate: z.string().nullish() }).parse(input);
    await assertClient(user, data.clientId);
    return { ok: true, data: await getErpTowerView(data.clientId, { de: data.de, ate: data.ate }) };
  } catch (error) {
    return fail(error, "Não foi possível ler a Torre de Controle");
  }
}

/** Uso da empresa no ERP (últimos 30 dias, por unidade, limites contratados × usados). Sob demanda. */
export async function loadErpUsageAction(input: unknown): Promise<Result<ErpUsageView>> {
  try {
    const user = await requirePermission("operacao.clientes.erp.ver");
    const { clientId } = z.object({ clientId: clientIdSchema }).parse(input);
    await assertClient(user, clientId);
    return { ok: true, data: await getErpUsageView(clientId) };
  } catch (error) {
    return fail(error, "Não foi possível ler o uso no ERP");
  }
}

/** Importa agora o catálogo de módulos do ERP. */
export async function importErpCatalogAction(): Promise<Result<{ status: string; version: string; added: number; removed: number; changed: number }>> {
  try {
    const user = await requirePermission("admin.integracoes.erp-catalogo");
    const res = await importErpCatalog(actorOf(user));
    revalidatePath("/admin/integracoes");
    return { ok: true, data: { status: res.status, version: res.record.catalogVersion, added: res.record.diff.added.length, removed: res.record.diff.removed.length, changed: res.record.diff.changed.length } };
  } catch (error) {
    return fail(error, "Não foi possível importar o catálogo do ERP");
  }
}

/** Reenvia agora as alterações aguardando sincronização (mesma chave; o ERP não duplica). */
export async function reprocessErpChangesAction(): Promise<Result<{ attempted: number; applied: number; failed: number }>> {
  try {
    await requirePermission("admin.integracoes.erp-reprocessar");
    // Agora, sem esperar a próxima tentativa agendada (mesma chave: o ERP não duplica).
    const res = await processPendingErpChanges(new Date(), 50, { includeUnscheduled: true });
    revalidatePath("/admin/integracoes");
    return { ok: true, data: res };
  } catch (error) {
    return fail(error, "Não foi possível reprocessar as alterações");
  }
}
