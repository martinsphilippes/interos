import "server-only";
/**
 * Modelos de contrato e configuração da assinatura eletrônica.
 *
 * - Configuração (settings `assinatura_eletronica`): quem assina pela Intercert e a autenticação padrão. Sem nada salvo,
 *   o signatário é o usuário ativo chamado Hércules (pedido da diretoria), trocável na tela.
 * - Modelos: "interos" (o INTEROS gera o PDF com os dados do contrato + as cláusulas do modelo) e "word" (o .docx usado
 *   na Clicksign, guardado aqui por versão; o INTEROS gera o Word preenchido e, com a integração, registra o modelo lá).
 * - Ao gerar o documento do contrato, o modelo é fixado no contrato (documentTemplate) e entra no código de integridade.
 */
import { createHash } from "node:crypto";
import { BusinessError } from "@/server/auth/error-classes";
import { create, getById, list, nowIso, update } from "@/server/db";
import { emitEvent } from "@/server/events";
import { writeSetting } from "@/server/conversations/ops-settings";
import {
  COLLECTIONS,
  type Contract,
  type ContractDocumentTemplate,
  type ContractSignerEntry,
  type ContractTemplate,
  type ContractTemplateFile,
  type ContractTemplateVariable,
  type Settings,
  type User,
  type UserRef,
} from "@/domain/types";
import {
  DEFAULT_COMPANY_SIGNER_ROLE,
  DEFAULT_SIGNATURE_SETTINGS,
  SIGNATURE_SETTING,
  companySignerReady,
  extractVariables,
  isContractField,
  isCompanySigner,
  isDefaultCompanySignerName,
  mergeVariables,
  type SignatureSettings,
} from "@/domain/contract-templates";
import { inspectDocx } from "./docx";
import type { SignatureDocumentInfo } from "@/components/finance/signature-document-options";

// ---------------------------------------------------------------------------
// Configuração
// ---------------------------------------------------------------------------

export interface ResolvedSignatureSettings extends SignatureSettings {
  stored: boolean;
  /** O signatário veio do cadastro de usuários (nome/e-mail sempre atuais). */
  fromUser: boolean;
}

export async function getSignatureSettings(): Promise<ResolvedSignatureSettings> {
  const doc = (await list<Settings>(COLLECTIONS.settings, { where: [["key", "==", SIGNATURE_SETTING]] }))[0];
  const v = (doc?.value ?? {}) as Partial<SignatureSettings>;
  const signer = { ...DEFAULT_SIGNATURE_SETTINGS.companySigner, ...v.companySigner };
  let fromUser = false;
  let user: User | null = null;
  if (signer.userId) user = await getById<User>(COLLECTIONS.users, signer.userId);
  else if (!doc) {
    // Padrão: o Hércules (primeiro usuário ativo com esse nome).
    const users = await list<User>(COLLECTIONS.users, { where: [["active", "==", true]] });
    user = users.find((u) => isDefaultCompanySignerName(u.name)) ?? null;
  }
  if (user) {
    fromUser = true;
    signer.userId = user.id;
    signer.name = user.name;
    signer.email = user.email;
  }
  return { companySigner: { ...signer, role: signer.role?.trim() || DEFAULT_COMPANY_SIGNER_ROLE }, defaultAuth: v.defaultAuth ?? DEFAULT_SIGNATURE_SETTINGS.defaultAuth, stored: Boolean(doc), fromUser };
}

export async function saveSignatureSettings(input: SignatureSettings, actor: UserRef): Promise<void> {
  const before = await getSignatureSettings();
  const signer = { ...input.companySigner, name: input.companySigner.name.trim(), email: input.companySigner.email.trim().toLowerCase(), role: input.companySigner.role.trim() || DEFAULT_COMPANY_SIGNER_ROLE };
  if (signer.userId) {
    const user = await getById<User>(COLLECTIONS.users, signer.userId);
    if (!user) throw new BusinessError("Usuário não encontrado");
    signer.name = user.name;
    signer.email = user.email;
  }
  if (signer.enabled && !companySignerReady(signer)) throw new BusinessError("Informe o nome e um e-mail válido de quem assina pela Intercert");
  await writeSetting(SIGNATURE_SETTING, { companySigner: signer, defaultAuth: input.defaultAuth }, "Assinatura eletrônica: quem assina pela Intercert e a autenticação padrão");
  await emitEvent({
    type: "settings.updated",
    actor,
    title: "Configuração da assinatura eletrônica alterada",
    description: `${signer.enabled ? `Assina pela Intercert: ${signer.name} (${signer.email})` : "Sem signatário da Intercert automático"} · autenticação padrão: ${input.defaultAuth}`,
    department: "financeiro",
    payload: { key: SIGNATURE_SETTING, changes: { signatario: { from: before.companySigner.enabled ? before.companySigner.email : "—", to: signer.enabled ? signer.email : "—" }, autenticacao: { from: before.defaultAuth, to: input.defaultAuth } } },
    timeline: false,
  });
}

/** Entrada do signatário da Intercert para a lista do contrato (null quando desligado ou incompleto). */
export function companySignerEntry(settings: SignatureSettings): ContractSignerEntry | null {
  const s = settings.companySigner;
  if (!companySignerReady(s)) return null;
  return { name: s.name.trim(), email: s.email.trim().toLowerCase(), role: s.role.trim() || DEFAULT_COMPANY_SIGNER_ROLE, status: "pendente", party: "contratada" };
}

/** Lista de signatários com o da Intercert no fim (se ainda não estiver). */
export function withCompanySigner(signers: ContractSignerEntry[], entry: ContractSignerEntry | null): ContractSignerEntry[] {
  if (!entry || signers.some((s) => isCompanySigner(s) || s.email.toLowerCase() === entry.email)) return signers;
  return [...signers, entry];
}

// ---------------------------------------------------------------------------
// Modelos
// ---------------------------------------------------------------------------

export async function listContractTemplates(): Promise<ContractTemplate[]> {
  const all = await list<ContractTemplate>(COLLECTIONS.contractTemplates);
  return all.sort((a, b) => Number(b.isDefault ?? false) - Number(a.isDefault ?? false) || Number(b.active) - Number(a.active) || a.name.localeCompare(b.name, "pt-BR"));
}

async function loadTemplate(id: string): Promise<ContractTemplate> {
  const t = await getById<ContractTemplate>(COLLECTIONS.contractTemplates, id);
  if (!t) throw new BusinessError("Modelo não encontrado");
  return t;
}

function fileId(templateId: string, version: number): string {
  return `${templateId}_v${version}`;
}

export async function getTemplateFile(templateId: string, version: number): Promise<ContractTemplateFile | null> {
  return getById<ContractTemplateFile>(COLLECTIONS.contractTemplateFiles, fileId(templateId, version));
}

function cleanVariables(variables: ContractTemplateVariable[], allowed: string[]): ContractTemplateVariable[] {
  return allowed.map((name) => {
    const v = variables.find((x) => x.name === name);
    const field = v?.field && isContractField(v.field) ? v.field : undefined;
    const fixed = v?.fixed?.trim().slice(0, 500) || undefined;
    return { name, ...(field ? { field } : {}), ...(!field && fixed ? { fixed } : {}) };
  });
}

/** Hash do conteúdo do modelo (cláusulas ou arquivo + ligações): muda quando o documento gerado mudaria. */
export function templateContentHash(t: Pick<ContractTemplate, "kind" | "title" | "clauses" | "variables">, fileSha?: string): string {
  const canonical = { kind: t.kind, title: t.title ?? null, clauses: t.clauses ?? null, file: fileSha ?? null, variables: t.variables.map((v) => [v.name, v.field ?? null, v.fixed ?? null]) };
  return `sha256:${createHash("sha256").update(JSON.stringify(canonical)).digest("hex")}`;
}

async function ensureSingleDefault(id: string): Promise<void> {
  const all = await list<ContractTemplate>(COLLECTIONS.contractTemplates, { where: [["isDefault", "==", true]] });
  for (const t of all) if (t.id !== id) await update<ContractTemplate>(COLLECTIONS.contractTemplates, t.id, { isDefault: false });
}

export interface InterosTemplateInput {
  id?: string;
  name: string;
  description?: string;
  title?: string;
  clauses: string;
  variables?: ContractTemplateVariable[];
}

/** Cria ou altera um modelo gerado pelo INTEROS. Mudar o conteúdo sobe a versão. */
export async function saveInterosTemplate(input: InterosTemplateInput, actor: UserRef): Promise<ContractTemplate> {
  const names = extractVariables(`${input.title ?? ""}\n${input.clauses}`);
  const now = nowIso();
  if (input.id) {
    const t = await loadTemplate(input.id);
    if (t.kind !== "interos") throw new BusinessError("Este modelo é um arquivo Word: troque o arquivo para mudar o texto");
    const variables = cleanVariables(input.variables ?? mergeVariables(names, t.variables), names);
    const next = { kind: t.kind, title: input.title?.trim() || undefined, clauses: input.clauses, variables };
    const changed = templateContentHash(next) !== templateContentHash(t);
    const patch: Partial<ContractTemplate> = { name: input.name.trim(), description: input.description?.trim() || undefined, ...next, version: changed ? t.version + 1 : t.version, updatedBy: actor.id, updatedByName: actor.name };
    await update<ContractTemplate>(COLLECTIONS.contractTemplates, t.id, patch);
    await logTemplate(t.id, `Modelo de contrato "${input.name}" alterado${changed ? ` (versão ${t.version + 1})` : ""}`, actor);
    return { ...t, ...patch, updatedAt: now };
  }
  const first = (await list<ContractTemplate>(COLLECTIONS.contractTemplates)).length === 0;
  const variables = cleanVariables(input.variables ?? mergeVariables(names), names);
  const t = await create<ContractTemplate>(COLLECTIONS.contractTemplates, {
    name: input.name.trim(),
    kind: "interos",
    description: input.description?.trim() || undefined,
    active: true,
    isDefault: first,
    version: 1,
    title: input.title?.trim() || undefined,
    clauses: input.clauses,
    variables,
    createdBy: actor.id,
    createdByName: actor.name,
  });
  await logTemplate(t.id, `Modelo de contrato "${t.name}" criado`, actor);
  return t;
}

export interface WordUploadInput {
  /** Trocar o arquivo de um modelo existente (nova versão). */
  templateId?: string;
  name?: string;
  description?: string;
  fileName: string;
  content: Buffer;
}

/** Sobe um Word: confere o arquivo, acha as variáveis e sugere os campos. Trocar o arquivo cria uma versão nova. */
export async function uploadWordTemplate(input: WordUploadInput, actor: UserRef): Promise<{ template: ContractTemplate; variables: ContractTemplateVariable[] }> {
  if (!/\.docx$/i.test(input.fileName)) throw new BusinessError("Envie o modelo em Word (.docx)");
  const info = inspectDocx(input.content);
  const fileName = input.fileName.replace(/[\\/]/g, "_").slice(0, 120);
  let template: ContractTemplate;
  if (input.templateId) {
    const t = await loadTemplate(input.templateId);
    if (t.kind !== "word") throw new BusinessError("Este modelo é gerado pelo INTEROS: não recebe arquivo Word");
    const version = t.version + 1;
    const variables = mergeVariables(info.variables, t.variables);
    // A chave da Clicksign era do arquivo anterior: o modelo precisa ser registrado de novo lá ("" = sem registro).
    const patch: Partial<ContractTemplate> = { version, fileName, fileSize: input.content.length, variables, updatedBy: actor.id, updatedByName: actor.name, ...(input.name?.trim() ? { name: input.name.trim() } : {}), ...(t.providerTemplateKey ? { providerTemplateKey: "" } : {}) };
    await saveFile(t.id, version, fileName, input.content, info.sha256);
    await update<ContractTemplate>(COLLECTIONS.contractTemplates, t.id, patch);
    template = { ...t, ...patch };
    await logTemplate(t.id, `Arquivo do modelo "${template.name}" trocado (versão ${version}, ${info.variables.length} variável(is))`, actor);
  } else {
    const name = input.name?.trim() || fileName.replace(/\.docx$/i, "");
    const first = (await list<ContractTemplate>(COLLECTIONS.contractTemplates)).length === 0;
    template = await create<ContractTemplate>(COLLECTIONS.contractTemplates, {
      name,
      kind: "word",
      description: input.description?.trim() || undefined,
      active: true,
      isDefault: first,
      version: 1,
      fileName,
      fileSize: input.content.length,
      variables: mergeVariables(info.variables),
      createdBy: actor.id,
      createdByName: actor.name,
    });
    await saveFile(template.id, 1, fileName, input.content, info.sha256);
    await logTemplate(template.id, `Modelo Word "${name}" enviado (${info.variables.length} variável(is))`, actor);
  }
  return { template, variables: template.variables };
}

async function saveFile(templateId: string, version: number, fileName: string, content: Buffer, sha256: string): Promise<void> {
  await create<ContractTemplateFile>(COLLECTIONS.contractTemplateFiles, { templateId, version, fileName, size: content.length, sha256, contentBase64: content.toString("base64") }, fileId(templateId, version));
}

/** Liga as variáveis do modelo aos campos do contrato (ou a um texto fixo). Muda o documento: sobe a versão. */
export async function saveTemplateVariables(templateId: string, variables: ContractTemplateVariable[], actor: UserRef): Promise<void> {
  const t = await loadTemplate(templateId);
  const clean = cleanVariables(variables, t.variables.map((v) => v.name));
  if (templateContentHash({ ...t, variables: clean }) === templateContentHash(t)) return;
  const version = t.version + 1;
  if (t.kind === "word") {
    // O arquivo não muda: a versão nova aponta para uma cópia (cada versão tem o seu arquivo).
    const file = await getTemplateFile(t.id, t.version);
    if (!file) throw new BusinessError("Arquivo do modelo não encontrado");
    await create<ContractTemplateFile>(COLLECTIONS.contractTemplateFiles, { templateId: t.id, version, fileName: file.fileName, size: file.size, sha256: file.sha256, contentBase64: file.contentBase64 }, fileId(t.id, version));
  }
  await update<ContractTemplate>(COLLECTIONS.contractTemplates, t.id, { variables: clean, version, updatedBy: actor.id, updatedByName: actor.name });
  await logTemplate(t.id, `Variáveis do modelo "${t.name}" ligadas aos campos do contrato (versão ${version})`, actor);
}

export async function setTemplateState(templateId: string, change: { active?: boolean; isDefault?: boolean }, actor: UserRef): Promise<void> {
  const t = await loadTemplate(templateId);
  const patch: Partial<ContractTemplate> = {};
  if (change.isDefault) {
    if (!(change.active ?? t.active)) throw new BusinessError("Ative o modelo antes de torná-lo padrão");
    patch.isDefault = true;
    patch.active = true;
  }
  if (change.active !== undefined) {
    patch.active = change.active;
    if (!change.active) patch.isDefault = false;
  }
  await update<ContractTemplate>(COLLECTIONS.contractTemplates, t.id, patch);
  if (patch.isDefault) await ensureSingleDefault(t.id);
  await logTemplate(t.id, patch.isDefault ? `Modelo "${t.name}" virou o padrão` : patch.active === false ? `Modelo "${t.name}" desativado` : `Modelo "${t.name}" ativado`, actor);
}

async function logTemplate(templateId: string, title: string, actor: UserRef): Promise<void> {
  await emitEvent({ type: "settings.updated", actor, entity: { type: "contract_template", id: templateId }, title, department: "financeiro", payload: { templateId }, timeline: false });
}

// ---------------------------------------------------------------------------
// Modelo do contrato
// ---------------------------------------------------------------------------

/** Modelo que o contrato usa hoje: o escolhido (se ativo) ou o padrão. */
export async function templateForContract(contract: Pick<Contract, "templateId">): Promise<ContractTemplate | null> {
  if (contract.templateId) {
    const t = await getById<ContractTemplate>(COLLECTIONS.contractTemplates, contract.templateId);
    if (t?.active) return t;
  }
  return (await list<ContractTemplate>(COLLECTIONS.contractTemplates, { where: [["isDefault", "==", true]] })).find((t) => t.active) ?? null;
}

/** Fotografia do modelo para fixar no contrato ao gerar o documento. */
export async function documentTemplateSnapshot(template: ContractTemplate): Promise<ContractDocumentTemplate> {
  let fileSha: string | undefined;
  if (template.kind === "word") {
    const file = await getTemplateFile(template.id, template.version);
    if (!file) throw new BusinessError(`O arquivo do modelo "${template.name}" não foi encontrado: envie o Word de novo`);
    fileSha = file.sha256;
  }
  return {
    id: template.id,
    name: template.name,
    kind: template.kind,
    version: template.version,
    contentHash: templateContentHash(template, fileSha),
    ...(template.kind === "interos" ? { title: template.title, clauses: template.clauses } : {}),
    variables: template.variables,
  };
}

/** Dados do cartão de Assinatura do contrato: modelos disponíveis, o modelo efetivo e a autenticação. */
export async function signatureDocumentInfo(contract: Pick<Contract, "templateId" | "signatureAuth" | "signatureEnvelopeId" | "documentTemplate">, canDownload: boolean): Promise<SignatureDocumentInfo> {
  const [templates, settings] = await Promise.all([listContractTemplates(), getSignatureSettings()]);
  const active = templates.filter((t) => t.active);
  const defaultTemplate = active.find((t) => t.isDefault);
  const chosen = contract.templateId ? (active.find((t) => t.id === contract.templateId) ?? defaultTemplate) : defaultTemplate;
  const generated = Boolean(contract.signatureEnvelopeId);
  const fixed = generated ? contract.documentTemplate : undefined;
  // Documento gerado sem modelo (antes dos modelos existirem): o modelo atual só entra gerando de novo.
  const effective = fixed
    ? { name: fixed.name, kind: fixed.kind, version: fixed.version, fixed: true, stale: !chosen || chosen.id !== fixed.id || chosen.version !== fixed.version }
    : chosen
      ? { name: chosen.name, kind: chosen.kind, version: chosen.version, fixed: false, stale: generated }
      : undefined;
  return {
    templates: active.map((t) => ({ id: t.id, name: t.name, kind: t.kind })),
    templateId: contract.templateId || undefined,
    defaultTemplateName: defaultTemplate?.name,
    effective,
    signatureAuth: contract.signatureAuth,
    defaultAuth: settings.defaultAuth,
    canDownload,
  };
}
