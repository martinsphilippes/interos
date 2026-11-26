import "server-only";
/**
 * Provisionamento e vínculo de empresas no ERP (contrato v1 de provisionamento), sempre pela interface do ERP.
 *
 * - Criar: uma alteração `provisionamento` por tentativa de criação; o id é a `Idempotency-Key`. Falha temporária
 *   (rede, 5xx) só se repete com a MESMA chave e o MESMO corpo — o ERP reaplicaria a criação inteira com chave nova.
 *   Recusa definitiva (dados inválidos, CNPJ em uso) libera nova criação corrigida (chave nova).
 * - Se o ERP diz que a conta já tem empresa (`conta_ja_vinculada`), o INTEROS perdeu a resposta anterior: consulta a
 *   empresa e grava o vínculo, sem criar de novo.
 * - Em seguida, a licença detalhada (unidades escolhidas) vai pela API de licenças, como alteração própria.
 * - O link do convite aparece uma única vez para quem criou e nunca é gravado.
 */
import { COLLECTIONS, type Client, type UserRef } from "@/domain/types";
import type { ErpChangeRequest, ErpLink } from "@/domain/erp/types";
import { isValidCnpj } from "@/domain/documents";
import { findPackage } from "@/domain/erp/packages";
import { create, getById, list, newId, nowIso, update } from "@/server/db";
import { getErpConfig } from "./config";
import { ErpError, erpErrorSummary } from "./errors";
import { getErpLink, linkClientToErp } from "./links";
import { createCompany, getCompany, linkCompany, provisioningModulesFor, resumeImplementation, type CreateCompanyBody, type ErpConvite, type ErpEmpresa } from "./api-provisionamento";
import { listLicenseCompanies } from "./api-licencas";
import { ErpChangeBlocked, submitLicenseChange } from "./changes";

export interface ProvisionInput {
  clientId: string;
  company: CreateCompanyBody["empresa"];
  initialUnit?: CreateCompanyBody["unidadeInicial"];
  units: string[];
  packageKey?: string | null;
  admin: CreateCompanyBody["administrador"];
  entregaConvite: "interos" | "erp";
  contractReference?: string | null;
  plan?: string | null;
  reason: string;
  actor: UserRef;
}

export interface InviteOnce {
  link: string | null;
  delivered: boolean | null;
  channel: string | null;
  detail: string | null;
  expiresAt: string | null;
}

export interface ProvisionResult {
  change: ErpChangeRequest;
  link: ErpLink | null;
  invite: InviteOnce | null;
  licenseChange: ErpChangeRequest | null;
  licenseError: string | null;
  implantacao: string | null;
}

const digits = (v: string | null | undefined) => (v ?? "").replace(/\D/g, "");

function inviteOf(convite: ErpConvite | null | undefined): InviteOnce | null {
  if (!convite) return null;
  return { link: convite.link ?? null, delivered: convite.entregue ?? null, channel: convite.canal ?? null, detail: convite.detalhe ?? convite.aviso ?? null, expiresAt: convite.expiraEm ?? null };
}

async function openProvisioning(clientId: string, environment: string): Promise<ErpChangeRequest | null> {
  const all = await list<ErpChangeRequest>(COLLECTIONS.erpChangeRequests, { where: [["clientId", "==", clientId], ["kind", "==", "provisionamento"], ["environment", "==", environment]] });
  return all.filter((c) => c.status === "enviando" || (c.status === "falhou" && c.lastError?.retryable)).sort((a, b) => (a.createdAt < b.createdAt ? 1 : -1))[0] ?? null;
}

/** Criação de empresa mais recente do cliente no ambiente (qualquer situação), para a tela acompanhar. */
export async function latestProvisioning(clientId: string, environment: string): Promise<ErpChangeRequest | null> {
  const all = await list<ErpChangeRequest>(COLLECTIONS.erpChangeRequests, { where: [["clientId", "==", clientId], ["kind", "==", "provisionamento"], ["environment", "==", environment]] });
  return all.sort((a, b) => (a.createdAt < b.createdAt ? 1 : -1))[0] ?? null;
}

async function loadClient(clientId: string): Promise<Client> {
  const client = await getById<Client>(COLLECTIONS.clients, clientId);
  if (!client) throw new ErpChangeBlocked("Cliente não encontrado.", "nao_encontrada");
  return client;
}

function buildBody(input: ProvisionInput): CreateCompanyBody {
  const tipo = input.company.tipo === "escritorio_contabil" ? "escritorio_contabil" : "varejo";
  return {
    contaInterosId: input.clientId,
    empresa: { ...input.company, tipo, cnpj: digits(input.company.cnpj) },
    unidadeInicial: input.initialUnit ?? null,
    modulos: provisioningModulesFor(input.units),
    administrador: { nome: input.admin.nome.trim(), email: input.admin.email.trim().toLowerCase(), telefone: input.admin.telefone ?? null },
    entregaConvite: input.entregaConvite,
    contrato: input.contractReference || input.plan ? { referencia: input.contractReference ?? null, plano: input.plan ?? null } : null,
  };
}

/** Cria a empresa no ERP (ou retoma a criação interrompida com a mesma chave), vincula e envia a licença inicial. */
export async function provisionCompany(input: ProvisionInput): Promise<ProvisionResult> {
  const config = getErpConfig();
  if (!config?.provisioningCredential) throw new ErpChangeBlocked("A API de provisionamento do ERP não está configurada neste ambiente.", "nao_configurado");
  const client = await loadClient(input.clientId);
  if (await getErpLink(client.id, config.environment)) throw new ErpChangeBlocked("Este cliente já está vinculado a uma empresa no ERP.", "estado_invalido");
  if (!isValidCnpj(input.company.cnpj)) throw new ErpChangeBlocked("CNPJ inválido (confira os dígitos).", "lote_invalido");
  if (input.reason.trim().length < 3) throw new ErpChangeBlocked("Informe o motivo (ex.: contrato assinado, número do contrato).", "lote_invalido");
  if (!input.units.length) throw new ErpChangeBlocked("Escolha ao menos um módulo para a empresa.", "lote_invalido");

  const pending = await openProvisioning(client.id, config.environment);
  if (pending) throw new ErpChangeBlocked("Há uma criação desta empresa aguardando confirmação do ERP. Use \"Tentar de novo\" nela (mesma chave) em vez de criar outra.", "alteracao_aberta");

  const body = buildBody(input);
  const now = nowIso();
  const id = newId(COLLECTIONS.erpChangeRequests);
  const change: ErpChangeRequest = await create<ErpChangeRequest>(
    COLLECTIONS.erpChangeRequests,
    {
      kind: "provisionamento",
      clientId: client.id,
      linkId: null,
      environment: config.environment,
      erpCompanyId: null,
      status: "enviando",
      draft: input.units.map((code) => ({ code, state: "active" as const })),
      plan: [],
      controlMode: "enforced",
      initial: true,
      baseVersion: 0,
      licenseVersion: null,
      snapshot: null,
      before: [],
      after: input.units.map((code) => ({ code, state: "active" as const })),
      simulation: null,
      requiresApproval: false,
      approvalReasons: [],
      approval: null,
      reason: input.reason.trim(),
      contractReference: input.contractReference ?? null,
      requestedBy: input.actor,
      requestedAt: now,
      attempts: 0,
      lastAttemptAt: null,
      nextAttemptAt: null,
      lastError: null,
      result: null,
      requestIds: [],
      catalogVersionId: null,
      cancelled: null,
      provisioning: {
        contaInterosId: client.id,
        razaoSocial: body.empresa.razaoSocial,
        cnpj: body.empresa.cnpj,
        modulos: body.modulos,
        units: input.units,
        packageKey: findPackage(input.packageKey)?.key ?? null,
        adminEmail: body.administrador.email,
        entregaConvite: body.entregaConvite ?? "interos",
        implantacao: null,
        inviteShownAt: null,
      },
      requestBody: body as unknown as Record<string, unknown>,
      licenseChangeId: null,
    },
    id,
  );
  return runProvisioning(change, input.actor);
}

/** "Tentar de novo" de uma criação interrompida: mesma chave e mesmo corpo. */
export async function retryProvisioning(changeId: string, actor: UserRef): Promise<ProvisionResult> {
  const change = await getById<ErpChangeRequest>(COLLECTIONS.erpChangeRequests, changeId);
  if (!change || change.kind !== "provisionamento") throw new ErpChangeBlocked("Criação não encontrada.", "nao_encontrada");
  if (change.status !== "falhou" && change.status !== "enviando") throw new ErpChangeBlocked("Esta criação não está aguardando nova tentativa.", "estado_invalido");
  return runProvisioning(change, actor);
}

async function runProvisioning(change: ErpChangeRequest, actor: UserRef): Promise<ProvisionResult> {
  const body = change.requestBody as unknown as CreateCompanyBody;
  const at = nowIso();
  await update<ErpChangeRequest>(COLLECTIONS.erpChangeRequests, change.id, { status: "enviando", lastAttemptAt: at, attempts: change.attempts + 1 });
  let empresa: ErpEmpresa | null = null;
  let invite: InviteOnce | null = null;
  let requestId: string | null = null;
  try {
    const res = await createCompany(body, change.id);
    empresa = res.data.empresa;
    invite = inviteOf(res.data.convite);
    requestId = res.requestId;
  } catch (error) {
    if (error instanceof ErpError && error.code === "conta_ja_vinculada") {
      // A conta já tem empresa no ERP (resposta anterior perdida): consulta e vincula, sem criar outra.
      const existingId = (error.details as { idEmpresa?: string } | null)?.idEmpresa;
      if (existingId) {
        const res = await getCompany(existingId);
        empresa = res.data.empresa;
        requestId = res.requestId;
      }
    }
    if (!empresa) {
      const failure = error instanceof ErpError ? error : new ErpError({ api: "provisionamento", status: 0, code: "interno", message: String((error as Error)?.message ?? error) });
      const fields = failure.fields.length ? ` ${failure.fields.map((f) => `${f.field}: ${f.message}`).join("; ")}` : "";
      const message = failure.code === "cnpj_em_uso" ? "Este CNPJ já é de uma empresa que usa o ERP. Peça ao administrador dela o código de vínculo e use \"Vincular empresa existente\"." : `${erpErrorSummary(failure)}${failure.kind === "rejected" ? ` ${failure.message}` : ""}${fields}`;
      const updated: Partial<ErpChangeRequest> = {
        status: failure.retryable ? "falhou" : "recusada",
        lastError: { code: failure.code, message: message.trim(), kind: failure.kind, retryable: failure.retryable, requestId: failure.requestId, at: nowIso() },
        requestIds: failure.requestId ? [...change.requestIds, failure.requestId] : change.requestIds,
      };
      await update<ErpChangeRequest>(COLLECTIONS.erpChangeRequests, change.id, updated);
      return { change: { ...change, ...updated } as ErpChangeRequest, link: null, invite: null, licenseChange: null, licenseError: null, implantacao: null };
    }
  }

  const { link } = await linkClientToErp({
    clientId: change.clientId,
    environment: change.environment,
    erpCompanyId: empresa.idEmpresa,
    erpCompanyName: empresa.nomeFantasia || empresa.razaoSocial,
    cnpj: empresa.cnpj,
    erpKind: empresa.tipo,
    method: "provisionamento",
    actor,
    provisioningChangeId: change.id,
  });
  const implantacao = empresa.implantacao?.estado ?? null;
  const done: Partial<ErpChangeRequest> = {
    status: implantacao === "falhou" ? "falhou" : "aplicada",
    linkId: link.id,
    erpCompanyId: empresa.idEmpresa,
    lastError:
      implantacao === "falhou"
        ? { code: "implantacao_falhou", message: `A empresa foi criada, mas a implantação parou: ${empresa.implantacao.ultimoErro ?? "etapa pendente"}. Use "Retomar implantação".`, kind: "unavailable", retryable: false, requestId, at: nowIso() }
        : null,
    result: { status: implantacao ?? "concluida", appliedVersion: null, runtimeVersion: null, rejectedItems: [], warnings: [], requestId, at: nowIso() },
    requestIds: requestId ? [...change.requestIds, requestId] : change.requestIds,
    provisioning: { ...(change.provisioning as NonNullable<ErpChangeRequest["provisioning"]>), implantacao, inviteShownAt: invite?.link ? nowIso() : null },
  };
  await update<ErpChangeRequest>(COLLECTIONS.erpChangeRequests, change.id, done);

  // Licença detalhada (unidades escolhidas, contrato aplicado) pela API de licenças, quando configurada.
  let licenseChange: ErpChangeRequest | null = null;
  let licenseError: string | null = null;
  if (getErpConfig()?.licenseSigningSecret && change.provisioning?.units.length) {
    try {
      licenseChange = await submitLicenseChange({
        clientId: change.clientId,
        draft: change.provisioning.units.map((code) => ({ code, state: "active" as const })),
        controlMode: "enforced",
        baseVersion: 0,
        reason: `Licença inicial da implantação — ${change.reason}`,
        contractReference: change.contractReference,
        actor,
        canApprove: true,
        startEmpty: true,
      });
      await update<ErpChangeRequest>(COLLECTIONS.erpChangeRequests, change.id, { licenseChangeId: licenseChange.id });
    } catch (error) {
      licenseError = error instanceof Error ? error.message : "Não foi possível enviar a licença inicial.";
    }
  }
  return { change: { ...change, ...done } as ErpChangeRequest, link, invite, licenseChange, licenseError, implantacao };
}

/** Retoma a implantação parada no ERP (etapas que faltam; convite que não saiu é gerado agora). */
export async function resumeProvisioning(changeId: string, actor: UserRef): Promise<{ change: ErpChangeRequest; invite: InviteOnce | null; implantacao: string | null }> {
  const change = await getById<ErpChangeRequest>(COLLECTIONS.erpChangeRequests, changeId);
  if (!change || change.kind !== "provisionamento" || !change.erpCompanyId) throw new ErpChangeBlocked("Criação não encontrada.", "nao_encontrada");
  const key = `${change.id}__retomar__${change.attempts + 1}`;
  try {
    const res = await resumeImplementation(change.erpCompanyId, key);
    const implantacao = res.data.empresa.implantacao?.estado ?? null;
    const patch: Partial<ErpChangeRequest> = {
      status: implantacao === "falhou" ? "falhou" : "aplicada",
      attempts: change.attempts + 1,
      lastAttemptAt: nowIso(),
      lastError: implantacao === "falhou" ? { code: "implantacao_falhou", message: res.data.empresa.implantacao.ultimoErro ?? "A implantação continua parada.", kind: "unavailable", retryable: false, requestId: res.requestId, at: nowIso() } : null,
      requestIds: [...change.requestIds, res.requestId],
      provisioning: { ...(change.provisioning as NonNullable<ErpChangeRequest["provisioning"]>), implantacao },
    };
    await update<ErpChangeRequest>(COLLECTIONS.erpChangeRequests, change.id, patch);
    void actor;
    return { change: { ...change, ...patch } as ErpChangeRequest, invite: inviteOf(res.data.convite), implantacao };
  } catch (error) {
    const failure = error instanceof ErpError ? error : null;
    throw new ErpChangeBlocked(failure ? erpErrorSummary(failure) : "Não foi possível retomar a implantação.", "estado_invalido");
  }
}

/** Vincula empresa que já usa o ERP com o código de consentimento gerado pelo administrador dela. */
export async function linkWithCode(input: { clientId: string; erpCompanyId: string; cnpj: string; code: string; actor: UserRef }): Promise<ErpLink> {
  const config = getErpConfig();
  if (!config?.provisioningCredential) throw new ErpChangeBlocked("A API de provisionamento do ERP não está configurada neste ambiente.", "nao_configurado");
  const client = await loadClient(input.clientId);
  if (await getErpLink(client.id, config.environment)) throw new ErpChangeBlocked("Este cliente já está vinculado a uma empresa no ERP.", "estado_invalido");
  if (!isValidCnpj(input.cnpj)) throw new ErpChangeBlocked("CNPJ inválido (confira os dígitos).", "lote_invalido");
  const key = `vinc_${client.id}_${digits(input.code).slice(0, 4) || "x"}_${Date.now().toString(36)}`;
  try {
    const res = await linkCompany({ contaInterosId: client.id, idEmpresa: input.erpCompanyId.trim(), cnpj: digits(input.cnpj), codigoVinculo: input.code.trim() }, key);
    const empresa = res.data.empresa;
    const { link } = await linkClientToErp({ clientId: client.id, environment: config.environment, erpCompanyId: empresa.idEmpresa, erpCompanyName: empresa.nomeFantasia || empresa.razaoSocial, cnpj: empresa.cnpj, erpKind: empresa.tipo, method: "codigo", actor: input.actor });
    return link;
  } catch (error) {
    if (error instanceof ErpError) {
      const message =
        error.code === "identidade_nao_confere"
          ? "O ERP não confirmou a empresa: confira o id ERP, o CNPJ e o código (vale 72 h e uma vez só). Se preciso, peça um código novo ao administrador da empresa."
          : error.code === "empresa_ja_vinculada"
            ? "Esta empresa do ERP já está vinculada a outro cliente do INTEROS."
            : erpErrorSummary(error);
      throw new ErpChangeBlocked(message, "lote_invalido");
    }
    throw error;
  }
}

/**
 * Empresas do ERP com o CNPJ do cliente (API de licenças, que mostra as empresas visíveis à credencial): para vincular
 * por identificação conferida, quando o ERP ainda não tem o fluxo de código. Exige CNPJ igual.
 */
export async function findErpCompaniesByCnpj(clientId: string): Promise<{ companyId: string; name: string; cnpj: string | null; kind: string; status: string; isDemo: boolean }[]> {
  const client = await loadClient(clientId);
  const cnpj = digits(client.document);
  if (cnpj.length !== 14) throw new ErpChangeBlocked("Cadastre o CNPJ do cliente antes de procurar a empresa no ERP.", "lote_invalido");
  const companies = await listLicenseCompanies();
  return companies.filter((c) => digits(c.cnpj) === cnpj).map((c) => ({ companyId: c.companyId, name: c.name, cnpj: c.cnpj, kind: c.kind, status: c.status, isDemo: c.isDemo }));
}

/** Vincula por identificação: id ERP + CNPJ do cliente iguais na API do ERP (conferido de novo aqui). */
export async function linkByIdentification(input: { clientId: string; erpCompanyId: string; actor: UserRef }): Promise<ErpLink> {
  const config = getErpConfig();
  if (!config?.licenseToken) throw new ErpChangeBlocked("A API de licenças do ERP não está configurada neste ambiente.", "nao_configurado");
  const matches = await findErpCompaniesByCnpj(input.clientId);
  const company = matches.find((c) => c.companyId === input.erpCompanyId);
  if (!company) throw new ErpChangeBlocked("O ERP não tem empresa com este id e o CNPJ do cliente.", "lote_invalido");
  const { link } = await linkClientToErp({ clientId: input.clientId, environment: config.environment, erpCompanyId: company.companyId, erpCompanyName: company.name, cnpj: company.cnpj, erpKind: company.kind, method: "identificacao", actor: input.actor });
  return link;
}
