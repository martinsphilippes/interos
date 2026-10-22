/**
 * Modelos de contrato e assinatura eletrônica (regras puras, sem banco).
 *
 * - Configuração da assinatura: quem assina pela Intercert (padrão: Hércules) e como os signatários provam quem são
 *   (padrão: código por e-mail).
 * - Campos do contrato que as {{variáveis}} dos modelos podem usar, com a sugestão automática pelo nome da variável
 *   (o modelo Word da Clicksign usa nomes livres: {{razao_social}}, {{valor_mensal}}…).
 * - Preenchimento do texto e valor por extenso (contratos brasileiros pedem "R$ 1.500,00 (mil e quinhentos reais)").
 */
import { z } from "zod";
import type { Address, Contract, ContractTemplateVariable, SignatureAuthMethod } from "./types";

export const SIGNATURE_SETTING = "assinatura_eletronica";

export const SIGNATURE_AUTH_LABELS: Record<SignatureAuthMethod, string> = {
  email: "Código por e-mail",
  whatsapp: "Código por WhatsApp",
  sms: "Código por SMS",
  icp_brasil: "Certificado digital ICP-Brasil (e-CPF/e-CNPJ)",
};

export const SIGNATURE_AUTH_HINTS: Record<SignatureAuthMethod, string> = {
  email: "O signatário recebe um código no e-mail e digita na hora de assinar. Sem custo extra.",
  whatsapp: "O código chega pelo WhatsApp do signatário (precisa do celular dele).",
  sms: "O código chega por SMS (precisa do celular do signatário).",
  icp_brasil: "Assinatura qualificada com certificado digital. Mais forte juridicamente; o signatário precisa ter o certificado.",
};

export interface CompanySignerSetting {
  /** Incluir automaticamente nos contratos novos e ao gerar o documento. */
  enabled: boolean;
  /** Usuário do INTEROS (nome e e-mail vêm do cadastro); sem usuário, vale o nome/e-mail digitados. */
  userId?: string;
  name: string;
  email: string;
  role: string;
}

export interface SignatureSettings {
  companySigner: CompanySignerSetting;
  defaultAuth: SignatureAuthMethod;
}

export const DEFAULT_COMPANY_SIGNER_ROLE = "Representante legal da Contratada";

export const DEFAULT_SIGNATURE_SETTINGS: SignatureSettings = {
  companySigner: { enabled: true, name: "", email: "", role: DEFAULT_COMPANY_SIGNER_ROLE },
  defaultAuth: "email",
};

/** Usuário padrão de quem assina pela Intercert enquanto ninguém configurou: o Hércules. */
export function isDefaultCompanySignerName(name: string): boolean {
  return /^h[eé]rcules\b/i.test(name.trim());
}

/** Quem assina pela Intercert: marcado pela configuração ou cadastrado à mão com o papel "Contratada". */
export function isCompanySigner(s: { party?: string; role?: string }): boolean {
  return s.party === "contratada" || /\bcontratada\b/i.test(s.role ?? "");
}

/** O signatário da Intercert está completo (nome e e-mail válidos)? */
export function companySignerReady(signer: CompanySignerSetting): boolean {
  return signer.enabled && signer.name.trim().length > 1 && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(signer.email.trim());
}

// ---------------------------------------------------------------------------
// Campos do contrato disponíveis para as variáveis
// ---------------------------------------------------------------------------

export interface ContractField {
  key: string;
  label: string;
  group: "Contratante" | "Contratada" | "Contrato" | "Valores";
  /** Nomes que costumam aparecer nos modelos Word (já normalizados). */
  aliases?: string[];
  /** De onde vem o dado (e onde corrigir quando falta). */
  source: FieldSource;
  /** Como sai quando falta: lacuna (________) para preencher à mão, ou vazio (partes do endereço). Padrão: lacuna. */
  empty?: "lacuna" | "vazio";
  /** Vazio é aceitável (complemento, vigência antes da assinatura): não entra nas pendências do documento. */
  optional?: boolean;
}

/** Origem de cada dado do contrato: diz à tela onde o usuário completa o que falta. */
export type FieldSource = "cliente" | "contato" | "signatario" | "contrato" | "intercert";

export const FIELD_SOURCE_LABELS: Record<FieldSource, string> = {
  cliente: "Cadastro do cliente (ou dados de cobrança do contrato)",
  contato: "Contato do cliente",
  signatario: "Signatários do contrato",
  contrato: "Dados do contrato",
  intercert: "Configuração da assinatura",
};

export const CONTRACT_FIELDS: readonly ContractField[] = [
  { key: "contratante.razao_social", label: "Razão social do cliente", group: "Contratante", source: "cliente", aliases: ["razao_social", "nome_cliente", "cliente", "nome_empresa", "empresa", "contratante", "nome_contratante", "razao_social_cliente", "nome"] },
  { key: "contratante.nome_fantasia", label: "Nome fantasia do cliente", group: "Contratante", source: "cliente", aliases: ["nome_fantasia", "fantasia"] },
  { key: "contratante.cnpj_cpf", label: "CNPJ/CPF do cliente", group: "Contratante", source: "cliente", aliases: ["cnpj", "cpf", "cnpj_cpf", "cpf_cnpj", "documento", "cnpj_cliente", "cnpj_contratante", "inscricao"] },
  { key: "contratante.endereco", label: "Endereço completo do cliente", group: "Contratante", source: "cliente", aliases: ["endereco", "endereco_completo", "endereco_cliente", "endereco_contratante"] },
  { key: "contratante.logradouro", label: "Logradouro do cliente (rua/avenida)", group: "Contratante", source: "cliente", aliases: ["logradouro", "rua", "avenida", "endereco_logradouro"] },
  { key: "contratante.numero", label: "Número do endereço do cliente", group: "Contratante", source: "cliente", empty: "vazio", aliases: ["numero_endereco", "numero_do_endereco", "endereco_numero", "n_endereco", "n_do_endereco", "numero_imovel"] },
  { key: "contratante.complemento", label: "Complemento do endereço do cliente", group: "Contratante", source: "cliente", empty: "vazio", optional: true, aliases: ["complemento", "endereco_complemento"] },
  { key: "contratante.bairro", label: "Bairro do cliente", group: "Contratante", source: "cliente", empty: "vazio", aliases: ["bairro", "endereco_bairro"] },
  { key: "contratante.cidade", label: "Cidade do cliente", group: "Contratante", source: "cliente", aliases: ["cidade", "municipio"] },
  { key: "contratante.cidade_uf", label: "Cidade/UF do cliente", group: "Contratante", source: "cliente", aliases: ["cidade_uf", "cidade_estado", "municipio_uf"] },
  { key: "contratante.uf", label: "UF do cliente", group: "Contratante", source: "cliente", aliases: ["uf", "estado"] },
  { key: "contratante.cep", label: "CEP do cliente", group: "Contratante", source: "cliente", aliases: ["cep"] },
  { key: "contratante.email", label: "E-mail de cobrança do cliente", group: "Contratante", source: "cliente", aliases: ["email", "email_cliente", "email_contratante", "e_mail"] },
  { key: "contratante.representante", label: "Representante do cliente (1º signatário)", group: "Contratante", source: "signatario", aliases: ["representante", "representante_legal", "nome_representante", "responsavel", "signatario", "nome_signatario"] },
  { key: "contratante.representante_email", label: "E-mail do representante do cliente", group: "Contratante", source: "signatario", aliases: ["email_representante", "email_signatario"] },
  { key: "contratante.representante_cpf", label: "CPF do representante do cliente", group: "Contratante", source: "contato", aliases: ["cpf_representante", "cpf_do_representante", "cpf_representante_legal", "cpf_do_representante_legal", "documento_representante", "cpf_signatario", "cpf_do_signatario"] },
  { key: "contratada.razao_social", label: "Razão social da Intercert", group: "Contratada", source: "intercert", aliases: ["contratada", "razao_social_contratada", "nome_contratada"] },
  { key: "contratada.endereco", label: "Endereço da Intercert", group: "Contratada", source: "intercert", aliases: ["endereco_contratada"] },
  { key: "contratada.representante", label: "Quem assina pela Intercert", group: "Contratada", source: "intercert", aliases: ["representante_contratada", "diretor", "assinante_contratada"] },
  { key: "contratada.representante_email", label: "E-mail de quem assina pela Intercert", group: "Contratada", source: "intercert", aliases: ["email_contratada"] },
  { key: "contrato.numero", label: "Número do contrato", group: "Contrato", source: "contrato", aliases: ["numero_contrato", "numero", "contrato", "n_contrato"] },
  { key: "contrato.versao", label: "Versão do contrato", group: "Contrato", source: "contrato", aliases: ["versao"] },
  { key: "contrato.data_emissao", label: "Data de emissão (por extenso)", group: "Contrato", source: "contrato", aliases: ["data", "data_contrato", "data_emissao", "data_assinatura", "data_extenso"] },
  { key: "contrato.prazo_meses", label: "Prazo em meses", group: "Contrato", source: "contrato", aliases: ["prazo", "prazo_meses", "vigencia_meses", "prazo_contrato", "meses"] },
  { key: "contrato.recorrencia", label: "Recorrência", group: "Contrato", source: "contrato", aliases: ["recorrencia", "periodicidade"] },
  { key: "contrato.dia_vencimento", label: "Dia do vencimento", group: "Contrato", source: "contrato", aliases: ["dia_vencimento", "vencimento"] },
  { key: "contrato.primeiro_vencimento", label: "Primeiro vencimento", group: "Contrato", source: "contrato", optional: true, aliases: ["primeiro_vencimento", "data_primeiro_vencimento"] },
  { key: "contrato.inicio_vigencia", label: "Início da vigência", group: "Contrato", source: "contrato", optional: true, aliases: ["inicio_vigencia", "data_inicio", "inicio"] },
  { key: "contrato.fim_vigencia", label: "Fim da vigência", group: "Contrato", source: "contrato", optional: true, aliases: ["fim_vigencia", "data_fim", "termino", "fim"] },
  { key: "contrato.forma_pagamento", label: "Forma de pagamento", group: "Contrato", source: "contrato", aliases: ["forma_pagamento", "meio_pagamento"] },
  { key: "contrato.parcelas_adesao", label: "Parcelas da adesão", group: "Contrato", source: "contrato", aliases: ["parcelas", "parcelas_adesao", "parcelas_setup"] },
  { key: "contrato.condicao_pagamento", label: "Condição de pagamento (texto)", group: "Contrato", source: "contrato", optional: true, aliases: ["condicao_pagamento", "condicoes_pagamento", "pagamento"] },
  { key: "contrato.itens", label: "Produtos e serviços (lista)", group: "Contrato", source: "contrato", aliases: ["itens", "produtos", "servicos", "objeto", "lista_produtos"] },
  { key: "valores.adesao", label: "Valor da adesão/setup", group: "Valores", source: "contrato", aliases: ["adesao", "setup", "valor_adesao", "taxa_adesao", "implantacao", "valor_implantacao", "valor_setup"] },
  { key: "valores.adesao_extenso", label: "Adesão por extenso", group: "Valores", source: "contrato", aliases: ["adesao_extenso", "valor_adesao_extenso", "setup_extenso"] },
  { key: "valores.mensalidade", label: "Mensalidade", group: "Valores", source: "contrato", aliases: ["mensalidade", "valor_mensal", "valor_mensalidade", "valor_de_mensalidade", "valor_da_mensalidade", "mensal"] },
  { key: "valores.mensalidade_extenso", label: "Mensalidade por extenso", group: "Valores", source: "contrato", aliases: ["mensalidade_extenso", "valor_mensal_extenso", "valor_mensalidade_extenso", "valor_de_mensalidade_extenso", "valor_da_mensalidade_extenso"] },
  { key: "valores.hardware", label: "Valor do hardware", group: "Valores", source: "contrato", aliases: ["hardware", "valor_hardware", "equipamentos"] },
  { key: "valores.primeiro_ano", label: "Valor no 1º ano", group: "Valores", source: "contrato", aliases: ["valor_primeiro_ano", "primeiro_ano", "valor_anual"] },
  { key: "valores.total", label: "Valor total do contrato (prazo inteiro)", group: "Valores", source: "contrato", aliases: ["valor_total", "total", "valor_contrato", "valor_global"] },
  { key: "valores.total_extenso", label: "Valor total por extenso", group: "Valores", source: "contrato", aliases: ["valor_total_extenso", "total_extenso"] },
];

const FIELD_KEYS = new Set(CONTRACT_FIELDS.map((f) => f.key));

export function isContractField(key: string | undefined): boolean {
  return Boolean(key && FIELD_KEYS.has(key));
}

export function fieldLabel(key: string): string {
  return CONTRACT_FIELDS.find((f) => f.key === key)?.label ?? key;
}

/** "Razão Social" / "razão-social" / "RAZAO_SOCIAL" → "razao_social". */
export function normalizeVariableName(name: string): string {
  return name
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "");
}

/** Campo sugerido para uma variável do modelo (ou undefined quando não há um claro). */
/** Nomes de variável que mostram o endereço em partes: ao lado deles, "numero" é o número do endereço, não o do contrato. */
const STREET_VARIABLE_NAMES = new Set(["logradouro", "rua", "avenida", "endereco_logradouro"]);

/** Campo cujo nome é exatamente a variável ({{contratante.razao_social}} ou {{contratante_razao_social}}), sem apelidos. */
function exactField(variable: string): string | undefined {
  const n = normalizeVariableName(variable);
  if (!n) return undefined;
  return CONTRACT_FIELDS.find((f) => normalizeVariableName(f.key) === n || f.key === variable.trim())?.key;
}

/**
 * Sugere o campo pelo nome da variável: nome exato do campo, depois apelidos. `siblings` são as outras variáveis do
 * mesmo modelo: com um logradouro separado, "numero" vira o número do endereço (sozinho, é o número do contrato).
 */
export function suggestField(variable: string, siblings: string[] = []): string | undefined {
  const direct = exactField(variable);
  if (direct) return direct;
  const n = normalizeVariableName(variable);
  if (!n) return undefined;
  if (n === "numero") {
    const others = siblings.map(normalizeVariableName).filter((s) => s !== n);
    const hasStreet = others.some((s) => STREET_VARIABLE_NAMES.has(s));
    // Se outra variável já é o número do endereço (numero_endereco…), "numero" volta a ser o do contrato.
    const addressNumberTaken = others.some((s) => aliasOf("contratante.numero").includes(s) || s === "contratante_numero");
    if (hasStreet && !addressNumberTaken) return "contratante.numero";
  }
  return CONTRACT_FIELDS.find((f) => f.aliases?.includes(n))?.key;
}

function aliasOf(key: string): string[] {
  return CONTRACT_FIELDS.find((f) => f.key === key)?.aliases ?? [];
}

/** O que sai quando o dado do campo falta: vazio (partes do endereço) ou a lacuna de preencher à mão. */
function emptyValueOf(key: string): string {
  return CONTRACT_FIELDS.find((f) => f.key === key)?.empty === "vazio" ? "" : BLANK;
}

const VARIABLE_RE = /\{\{\s*([^{}]+?)\s*\}\}/g;

/** Variáveis {{nome}} na ordem em que aparecem, sem repetir. */
export function extractVariables(text: string): string[] {
  const out: string[] = [];
  for (const m of text.matchAll(VARIABLE_RE)) {
    const name = m[1].trim();
    if (name && name.length <= 80 && !out.includes(name)) out.push(name);
  }
  return out;
}

/** Junta a lista de variáveis encontrada com as ligações já salvas (mantém a escolha anterior, sugere as novas). */
export function mergeVariables(found: string[], previous: ContractTemplateVariable[] = []): ContractTemplateVariable[] {
  return found.map((name) => {
    const old = previous.find((v) => v.name === name);
    if (old) return old;
    const field = suggestField(name, found);
    return field ? { name, field } : { name };
  });
}

/** Variáveis ainda sem ligação nem texto fixo recebem a sugestão pelo nome (para a tela mostrar antes de salvar). */
export function suggestUnbound(variables: ContractTemplateVariable[]): ContractTemplateVariable[] {
  const names = variables.map((v) => v.name);
  return variables.map((v) => {
    if (isContractField(v.field) || v.fixed?.trim()) return v;
    const field = suggestField(v.name, names);
    return field ? { ...v, field } : v;
  });
}

/** Variáveis do modelo sem campo nem texto fixo (o documento sairia com lacuna). */
export function unmappedVariables(variables: ContractTemplateVariable[]): string[] {
  return variables.filter((v) => !isContractField(v.field) && !v.fixed?.trim()).map((v) => v.name);
}

/** Uma variável do modelo que não sairia preenchida: sem campo ligado (ajuste no modelo) ou sem o dado (cadastro). */
export interface TemplateDataGap {
  variable: string;
  reason: "sem_ligacao" | "sem_dado";
  field?: string;
  /** Rótulo do campo (ou aviso de variável sem ligação). */
  label: string;
  source?: FieldSource;
}

/**
 * Pendências para gerar o documento com o modelo: toda variável precisa de texto fixo ou de um campo com dado
 * (campos opcionais, como complemento, podem estar vazios). O contrato só é gerado/enviado sem pendências: o documento
 * sai completo e único para o cliente, sem lacunas. `names` são as variáveis do texto do modelo INTEROS.
 */
export function templateDataGaps(variables: ContractTemplateVariable[], fields: Record<string, string>, names: string[] = []): TemplateDataGap[] {
  const gaps: TemplateDataGap[] = [];
  const all = new Set([...variables.map((v) => v.name), ...names]);
  for (const name of all) {
    const v = variables.find((x) => x.name === name);
    if (v?.fixed?.trim()) continue;
    const field = v ? v.field : exactField(name);
    const def = field ? CONTRACT_FIELDS.find((f) => f.key === field) : undefined;
    if (!def) {
      gaps.push({ variable: name, reason: "sem_ligacao", label: "Sem campo ligado nem texto fixo no modelo" });
      continue;
    }
    if (def.optional) continue;
    if (!(fields[def.key] ?? "").trim()) gaps.push({ variable: name, reason: "sem_dado", field: def.key, label: def.label, source: def.source });
  }
  return gaps;
}

/** O que o modelo exige do cadastro (campos ligados, não opcionais), agrupado pela origem, e as variáveis sem ligação. */
export function templateRequirements(variables: ContractTemplateVariable[]): { bySource: { source: FieldSource; labels: string[] }[]; unbound: string[] } {
  const seen = new Set<string>();
  const bySource = new Map<FieldSource, string[]>();
  for (const v of variables) {
    const def = v.field && !v.fixed?.trim() ? CONTRACT_FIELDS.find((f) => f.key === v.field) : undefined;
    if (!def || def.optional || seen.has(def.key)) continue;
    seen.add(def.key);
    bySource.set(def.source, [...(bySource.get(def.source) ?? []), def.label]);
  }
  const order: FieldSource[] = ["cliente", "contato", "signatario", "contrato", "intercert"];
  return { bySource: order.filter((o) => bySource.has(o)).map((source) => ({ source, labels: bySource.get(source)! })), unbound: unmappedVariables(variables) };
}

export const BLANK = "________________";

/** Valor de cada variável para um contrato: campo ligado, texto fixo ou o próprio nome (campo conhecido) ou lacuna. */
export function variableValues(variables: ContractTemplateVariable[], fields: Record<string, string>, names: string[] = []): Record<string, string> {
  const out: Record<string, string> = {};
  const all = new Set([...variables.map((v) => v.name), ...names]);
  for (const name of all) {
    const v = variables.find((x) => x.name === name);
    // Variável que não está na lista gravada (modelo antigo, texto editado): só vale o nome exato de um campo
    // ({{contratante.razao_social}}). Gravada sem ligação é escolha ("sem campo" = lacuna); apelidos não são
    // adivinhados ao gerar, para o documento bater com a tela.
    const field = v ? v.field : exactField(name);
    const value = v?.fixed?.trim() ? v.fixed.trim() : field && fields[field] !== undefined ? fields[field] : "";
    out[name] = value || (field ? emptyValueOf(field) : BLANK);
  }
  return out;
}

/** Troca cada {{variável}} do texto pelo valor (variável desconhecida vira lacuna para preencher à mão). */
export function fillTemplateText(text: string, values: Record<string, string>): string {
  return text.replace(VARIABLE_RE, (_, raw: string) => values[raw.trim()] ?? BLANK);
}

// ---------------------------------------------------------------------------
// Valores dos campos para um contrato
// ---------------------------------------------------------------------------

export interface FieldValuesInput {
  contract: Contract;
  client: { legalName: string; tradeName: string };
  billingData: { legalName?: string; document?: string; email?: string; address: Address };
  companyName: string;
  companyAddress: string;
  /** Data de emissão (ISO). */
  issuedAt: string;
  /** Rótulos já resolvidos (as listas ficam no servidor/financeiro). */
  labels: { recurrence: string; paymentMethod?: string };
  /** CPF do contato do cliente que assina em 1º lugar (vem do cadastro de contatos). */
  representativeDocument?: string;
}

const brl = new Intl.NumberFormat("pt-BR", { style: "currency", currency: "BRL" });
const MONTHS = ["janeiro", "fevereiro", "março", "abril", "maio", "junho", "julho", "agosto", "setembro", "outubro", "novembro", "dezembro"];

function docFormat(value: string | undefined): string {
  const d = (value ?? "").replace(/\D/g, "");
  if (d.length === 14) return `${d.slice(0, 2)}.${d.slice(2, 5)}.${d.slice(5, 8)}/${d.slice(8, 12)}-${d.slice(12)}`;
  if (d.length === 11) return `${d.slice(0, 3)}.${d.slice(3, 6)}.${d.slice(6, 9)}-${d.slice(9)}`;
  return value ?? "";
}

/** "2026-10-21..." → "21/10/2026" (sem fuso: a data do contrato é um dia, não um instante). */
function dayBr(iso: string | undefined): string {
  if (!iso) return "";
  const [y, m, d] = iso.slice(0, 10).split("-");
  return y && m && d ? `${d}/${m}/${y}` : "";
}

/** Data por extenso no fuso de Brasília: "21 de outubro de 2026". */
export function longDateBr(iso: string): string {
  const local = new Date(Date.parse(iso) - 3 * 3_600_000);
  return `${local.getUTCDate()} de ${MONTHS[local.getUTCMonth()]} de ${local.getUTCFullYear()}`;
}

function cep(zip: string | undefined): string {
  const d = (zip ?? "").replace(/\D/g, "");
  return d.length === 8 ? `${d.slice(0, 5)}-${d.slice(5)}` : (zip ?? "");
}

function addressLine(a: Address): string {
  const street = [a.street, a.number].filter(Boolean).join(", ");
  const parts = [street, a.complement, a.district, [a.city, a.state].filter(Boolean).join("/"), a.zip ? `CEP ${cep(a.zip)}` : ""].filter(Boolean);
  return parts.join(" - ");
}

export function contractFirstYear(c: Pick<Contract, "setupTotal" | "hardwareTotal" | "monthlyTotal" | "recurrence" | "termMonths">): number {
  return c.setupTotal + c.hardwareTotal + (c.recurrence === "unico" ? 0 : c.monthlyTotal * Math.min(12, c.termMonths));
}

export function contractTotal(c: Pick<Contract, "setupTotal" | "hardwareTotal" | "monthlyTotal" | "recurrence" | "termMonths">): number {
  return c.setupTotal + c.hardwareTotal + (c.recurrence === "unico" ? 0 : c.recurrence === "anual" ? c.monthlyTotal * Math.max(1, Math.ceil(c.termMonths / 12)) : c.monthlyTotal * c.termMonths);
}

function money(v: number): string {
  return brl.format(v).replace(/ /g, " ");
}

function moneyWithWords(v: number): string {
  return `${money(v)} (${currencyInWords(v)})`;
}

export function contractFieldValues(input: FieldValuesInput): Record<string, string> {
  const { contract: c, client, billingData: b } = input;
  const customer = c.signers.find((s) => !isCompanySigner(s));
  const company = c.signers.find((s) => isCompanySigner(s));
  const items = c.items.map((i) => `${i.quantity}x ${i.productName}`).join("; ");
  return {
    "contratante.razao_social": b.legalName ?? client.legalName,
    "contratante.nome_fantasia": client.tradeName,
    "contratante.cnpj_cpf": docFormat(b.document),
    "contratante.endereco": addressLine(b.address),
    "contratante.logradouro": b.address.street ?? "",
    "contratante.numero": b.address.number ?? "",
    "contratante.complemento": b.address.complement ?? "",
    "contratante.bairro": b.address.district ?? "",
    "contratante.cidade": b.address.city ?? "",
    "contratante.cidade_uf": [b.address.city, b.address.state].filter(Boolean).join("/"),
    "contratante.uf": b.address.state ?? "",
    "contratante.cep": cep(b.address.zip),
    "contratante.email": b.email ?? "",
    "contratante.representante": customer?.name ?? "",
    "contratante.representante_email": customer?.email ?? "",
    "contratante.representante_cpf": docFormat(input.representativeDocument),
    "contratada.razao_social": input.companyName,
    "contratada.endereco": input.companyAddress,
    "contratada.representante": company?.name ?? "",
    "contratada.representante_email": company?.email ?? "",
    "contrato.numero": c.number,
    "contrato.versao": String(c.version),
    "contrato.data_emissao": longDateBr(input.issuedAt),
    "contrato.prazo_meses": `${c.termMonths} (${integerInWords(c.termMonths)}) meses`,
    "contrato.recorrencia": input.labels.recurrence,
    "contrato.dia_vencimento": String(c.billingDay),
    "contrato.primeiro_vencimento": dayBr(c.firstDueDate),
    "contrato.inicio_vigencia": dayBr(c.startDate),
    "contrato.fim_vigencia": dayBr(c.endDate),
    "contrato.forma_pagamento": input.labels.paymentMethod ?? "",
    "contrato.parcelas_adesao": c.setupInstallments && c.setupInstallments > 1 ? `${c.setupInstallments} parcelas` : "à vista",
    "contrato.condicao_pagamento": c.paymentCondition ?? "",
    "contrato.itens": items,
    "valores.adesao": money(c.setupTotal),
    "valores.adesao_extenso": moneyWithWords(c.setupTotal),
    "valores.mensalidade": money(c.monthlyTotal),
    "valores.mensalidade_extenso": moneyWithWords(c.monthlyTotal),
    "valores.hardware": money(c.hardwareTotal),
    "valores.primeiro_ano": money(contractFirstYear(c)),
    "valores.total": money(contractTotal(c)),
    "valores.total_extenso": moneyWithWords(contractTotal(c)),
  };
}

// ---------------------------------------------------------------------------
// Número por extenso (pt-BR)
// ---------------------------------------------------------------------------

const UNITS = ["zero", "um", "dois", "três", "quatro", "cinco", "seis", "sete", "oito", "nove", "dez", "onze", "doze", "treze", "quatorze", "quinze", "dezesseis", "dezessete", "dezoito", "dezenove"];
const TENS = ["", "", "vinte", "trinta", "quarenta", "cinquenta", "sessenta", "setenta", "oitenta", "noventa"];
const HUNDREDS = ["", "cento", "duzentos", "trezentos", "quatrocentos", "quinhentos", "seiscentos", "setecentos", "oitocentos", "novecentos"];

function below1000(n: number): string {
  if (n === 100) return "cem";
  const parts: string[] = [];
  const h = Math.floor(n / 100);
  const rest = n % 100;
  if (h) parts.push(HUNDREDS[h]);
  if (rest) parts.push(rest < 20 ? UNITS[rest] : [TENS[Math.floor(rest / 10)], rest % 10 ? UNITS[rest % 10] : ""].filter(Boolean).join(" e "));
  return parts.join(" e ");
}

const SCALES: [number, string, string][] = [
  [1e9, "bilhão", "bilhões"],
  [1e6, "milhão", "milhões"],
  [1e3, "mil", "mil"],
];

/** 1500 → "mil e quinhentos"; 2_345_000 → "dois milhões e trezentos e quarenta e cinco mil". */
export function integerInWords(value: number): string {
  let n = Math.floor(Math.abs(value));
  if (n === 0) return "zero";
  const groups: { n: number; text: string }[] = [];
  for (const [size, one, many] of SCALES) {
    const q = Math.floor(n / size);
    if (q) {
      groups.push({ n: q * size, text: size === 1e3 && q === 1 ? "mil" : `${below1000(q)} ${q === 1 ? one : many}` });
      n %= size;
    }
  }
  if (n) groups.push({ n, text: below1000(n) });
  // "e" antes do último grupo quando ele é menor que 100 ou centena redonda (regra usual de extenso).
  return groups
    .map((g, i) => {
      if (i === 0) return g.text;
      const last = i === groups.length - 1;
      const small = g.n < 100 || g.n % 100 === 0;
      return last && small && g.n < 1000 ? `e ${g.text}` : g.text;
    })
    .join(" ");
}

/** 1500.5 → "mil e quinhentos reais e cinquenta centavos". */
export function currencyInWords(value: number): string {
  const cents = Math.round(Math.abs(value) * 100);
  const reais = Math.floor(cents / 100);
  const c = cents % 100;
  const parts: string[] = [];
  if (reais) {
    const words = integerInWords(reais);
    const de = reais % 1e6 === 0 ? " de" : "";
    parts.push(`${words}${de} ${reais === 1 ? "real" : "reais"}`);
  }
  if (c) parts.push(`${integerInWords(c)} ${c === 1 ? "centavo" : "centavos"}`);
  return parts.length ? parts.join(" e ") : "zero real";
}

// ---------------------------------------------------------------------------
// Clicksign: papel do signatário e nome aceito
// ---------------------------------------------------------------------------

/** Papel (qualificação) na Clicksign: contratada, testemunha, avalista/fiador ou contratante. */
export function clicksignRole(s: { party?: string; role?: string }): string {
  if (isCompanySigner(s)) return "contractee";
  const role = (s.role ?? "").normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase();
  if (/testemunha/.test(role)) return "witness";
  if (/avalista|fiador/.test(role)) return "guarantor";
  if (/procurador/.test(role)) return "attorney";
  if (/representante/.test(role)) return "legal_representative";
  return "contractor";
}

/** E-mail aceito para assinatura: a regra do zod, a mesma dos schemas do servidor (o cadastro de contatos é mais frouxo). */
export function isSignerEmail(email: string): boolean {
  return z.email().safeParse(email.trim()).success;
}

/** A Clicksign exige nome e sobrenome, sem números. Devolve o problema (ou null quando está ok). */
export function clicksignSignerNameProblem(name: string): string | null {
  const n = name.trim();
  if (/\d/.test(n)) return "o nome não pode ter números (exigência da Clicksign)";
  if (n.split(/\s+/).filter((p) => p.length > 0).length < 2) return "informe nome e sobrenome (exigência da Clicksign)";
  return null;
}
