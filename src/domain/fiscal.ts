/**
 * Faturamento: regras puras (sem banco) da nota fiscal das cobranças.
 *
 * - Configuração fiscal (setting `fiscal`): dados fiscais da empresa, que nota cada tipo de cobrança pede (NFS-e,
 *   NF-e ou nenhuma), quando a cobrança entra na fila "A faturar" (dias antes do vencimento ou depois do pagamento) e a
 *   data a partir da qual o INTEROS controla as notas (o passado não inunda a fila).
 * - Situação da cobrança no faturamento (`invoiceQueueState`) e itens da nota a partir dos itens do contrato e do perfil
 *   fiscal de cada produto (`invoiceItems`), para quem emite no emissor da prefeitura/SEFAZ copiar sem redigitar.
 */
import type { Billing, InvoiceKind, Product, ProductFiscalNature, ProductFiscalProfile, ProposalItem } from "./types";
import { netContractItem } from "./sale-closing";

export const FISCAL_SETTING_KEY = "fiscal";

export const FISCAL_REGIMES = ["simples", "mei", "presumido", "real"] as const;
export type FiscalRegime = (typeof FISCAL_REGIMES)[number];
export const FISCAL_REGIME_LABELS: Record<FiscalRegime, string> = {
  simples: "Simples Nacional",
  mei: "MEI",
  presumido: "Lucro Presumido",
  real: "Lucro Real",
};

export type InvoiceRule = InvoiceKind | "nenhuma";
export const INVOICE_RULES: InvoiceRule[] = ["nfse", "nfe", "nenhuma"];
export const INVOICE_KIND_LABELS: Record<InvoiceKind, string> = {
  nfse: "NFS-e (serviço)",
  nfe: "NF-e (produto)",
};
export const INVOICE_KIND_SHORT: Record<InvoiceKind, string> = {
  nfse: "NFS-e",
  nfe: "NF-e",
};
export const INVOICE_RULE_LABELS: Record<InvoiceRule, string> = {
  ...INVOICE_KIND_LABELS,
  nenhuma: "Sem nota",
};

export type InvoiceMoment = "vencimento" | "pagamento";
export const INVOICE_MOMENT_LABELS: Record<InvoiceMoment, string> = {
  vencimento: "Antes do vencimento",
  pagamento: "Depois do pagamento",
};

export const PRODUCT_FISCAL_NATURES: ProductFiscalNature[] = ["software", "equipamento", "servico"];
export const PRODUCT_FISCAL_NATURE_LABELS: Record<ProductFiscalNature, string> = {
  software: "Software",
  equipamento: "Equipamento (hardware)",
  servico: "Serviço",
};

export type BillingType = Billing["type"];
export const BILLING_TYPES_FISCAL: BillingType[] = ["setup", "mensalidade", "hardware", "servico"];
export const BILLING_TYPE_FISCAL_LABELS: Record<BillingType, string> = {
  setup: "Adesão",
  mensalidade: "Mensalidade",
  hardware: "Hardware",
  servico: "Serviço avulso",
};

export interface FiscalSettings {
  /** Controle de notas ligado: sem ele a fila fica vazia e nada pede nota. */
  enabled: boolean;
  regime?: FiscalRegime;
  municipalRegistration?: string;
  stateRegistration?: string;
  cnae?: string;
  /** Padrões usados quando o produto não tem o próprio código. */
  defaultServiceCode?: string;
  defaultIssRate?: number;
  defaultNcm?: string;
  defaultCfop?: string;
  /** Que nota cada tipo de cobrança pede. */
  rules: Record<BillingType, InvoiceRule>;
  /** Quando a cobrança entra na fila "A faturar". */
  moment: InvoiceMoment;
  /** Com `vencimento`: quantos dias antes do vencimento (0 a 60). */
  leadDays: number;
  /** Controle a partir desta data (AAAA-MM-DD): cobranças com vencimento anterior não entram na fila. */
  since: string;
  /** Texto padrão do envio da nota ao cliente (variáveis: {cliente}, {nota}, {valor}, {linkPortal}). */
  messageTemplate?: string;
  /** Já foi salva alguma vez (a tela avisa enquanto não for). */
  stored: boolean;
}

export const DEFAULT_INVOICE_RULES: Record<BillingType, InvoiceRule> = {
  setup: "nfse",
  mensalidade: "nfse",
  hardware: "nfe",
  servico: "nfse",
};
export const DEFAULT_INVOICE_MESSAGE = "Olá, {cliente}! Segue a nota fiscal {nota} referente a {cobranca}, no valor de {valor}.\nVocê pode baixar a nota (PDF e XML) no portal: {linkPortal}";

/** Primeiro dia do mês de `today` (AAAA-MM-01). */
function monthStart(today: string): string {
  return `${today.slice(0, 7)}-01`;
}

function str(v: unknown, max = 60): string | undefined {
  if (typeof v !== "string") return undefined;
  const t = v.trim().slice(0, max);
  return t || undefined;
}

function rate(v: unknown): number | undefined {
  const n = typeof v === "number" ? v : typeof v === "string" && v.trim() ? Number(v.replace(",", ".")) : NaN;
  return Number.isFinite(n) && n >= 0 && n <= 100 ? Math.round(n * 100) / 100 : undefined;
}

/** Configuração gravada → configuração válida (campos estranhos, faltando ou inválidos caem no padrão). */
export function normalizeFiscalSettings(raw: unknown, today: string): FiscalSettings {
  const v = (raw && typeof raw === "object" ? raw : {}) as Record<string, unknown>;
  const rulesRaw = (v.rules && typeof v.rules === "object" ? v.rules : {}) as Record<string, unknown>;
  const rules = Object.fromEntries(BILLING_TYPES_FISCAL.map((t) => [t, INVOICE_RULES.includes(rulesRaw[t] as InvoiceRule) ? (rulesRaw[t] as InvoiceRule) : DEFAULT_INVOICE_RULES[t]])) as Record<
    BillingType,
    InvoiceRule
  >;
  const lead = Number(v.leadDays);
  const since = typeof v.since === "string" && /^\d{4}-\d{2}-\d{2}$/.test(v.since) ? v.since : monthStart(today);
  return {
    enabled: typeof v.enabled === "boolean" ? v.enabled : true,
    regime: FISCAL_REGIMES.includes(v.regime as FiscalRegime) ? (v.regime as FiscalRegime) : undefined,
    municipalRegistration: str(v.municipalRegistration, 30),
    stateRegistration: str(v.stateRegistration, 30),
    cnae: str(v.cnae, 20),
    defaultServiceCode: str(v.defaultServiceCode, 20),
    defaultIssRate: rate(v.defaultIssRate),
    defaultNcm: str(v.defaultNcm, 10),
    defaultCfop: str(v.defaultCfop, 6),
    rules,
    moment: v.moment === "pagamento" ? "pagamento" : "vencimento",
    leadDays: Number.isInteger(lead) && lead >= 0 && lead <= 60 ? lead : 5,
    since,
    messageTemplate: str(v.messageTemplate, 1000),
    stored: Boolean(raw && typeof raw === "object"),
  };
}

/** Que nota a cobrança pede pela configuração (null = nenhuma). */
export function invoiceKindFor(billing: Pick<Billing, "type">, settings: Pick<FiscalSettings, "enabled" | "rules">): InvoiceKind | null {
  if (!settings.enabled) return null;
  const rule = settings.rules[billing.type];
  return rule === "nenhuma" ? null : rule;
}

/**
 * Situação da cobrança no faturamento:
 * - `emitida` / `enviada`: tem nota vigente (enviada ao cliente ou não);
 * - `a_faturar`: precisa de nota e chegou o momento (N dias antes do vencimento, ou paga);
 * - `aguardando`: precisa de nota, mas o momento ainda não chegou;
 * - `dispensada`: alguém dispensou a nota desta cobrança (com motivo);
 * - `sem_nota`: o tipo de cobrança não pede nota (ou o controle está desligado);
 * - `fora`: cancelada, ou vencimento antes do início do controle.
 */
export type InvoiceQueueState = "a_faturar" | "aguardando" | "emitida" | "enviada" | "dispensada" | "sem_nota" | "fora";

export const INVOICE_QUEUE_STATE_LABELS: Record<InvoiceQueueState, string> = {
  a_faturar: "A faturar",
  aguardando: "Aguardando o momento",
  emitida: "Nota emitida",
  enviada: "Nota enviada",
  dispensada: "Dispensada",
  sem_nota: "Sem nota",
  fora: "Fora do controle",
};

function addDays(day: string, n: number): string {
  const d = new Date(`${day}T12:00:00Z`);
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
}

export function invoiceQueueState(
  billing: Pick<Billing, "type" | "status" | "dueDate" | "invoiceId" | "invoiceSentAt" | "invoiceWaived">,
  settings: Pick<FiscalSettings, "enabled" | "rules" | "moment" | "leadDays" | "since">,
  today: string,
): InvoiceQueueState {
  if (billing.invoiceId) return billing.invoiceSentAt ? "enviada" : "emitida";
  if (billing.status === "cancelada") return "fora";
  if (billing.invoiceWaived) return "dispensada";
  if (!invoiceKindFor(billing, settings)) return "sem_nota";
  const due = billing.dueDate.slice(0, 10);
  if (due < settings.since) return "fora";
  if (settings.moment === "pagamento") return billing.status === "paga" ? "a_faturar" : "aguardando";
  return due <= addDays(today, settings.leadDays) ? "a_faturar" : "aguardando";
}

export interface InvoiceItem {
  productId: string;
  description: string;
  quantity: number;
  unitValue: number;
  total: number;
  nature?: ProductFiscalNature;
  serviceCode?: string;
  issRate?: number;
  ncm?: string;
  cfop?: string;
}

const round2 = (n: number) => Math.round(n * 100) / 100;

/**
 * Itens da nota de uma cobrança: o valor de cada produto no tipo da cobrança (adesão, mensalidade ou hardware, já com
 * desconto), com os códigos fiscais do produto ou os padrões da configuração. Serviço avulso não tem itens do contrato.
 * `scale`: quando a cobrança não bate com a soma (reajuste, parcela da adesão), os valores são proporcionais a ela.
 */
export function invoiceItems(
  billing: Pick<Billing, "type" | "amount">,
  items: ProposalItem[],
  products: Map<string, Pick<Product, "name" | "fiscal">>,
  settings: Pick<FiscalSettings, "defaultServiceCode" | "defaultIssRate" | "defaultNcm" | "defaultCfop">,
): { items: InvoiceItem[]; sum: number; scaled: boolean } {
  if (billing.type === "servico") return { items: [], sum: 0, scaled: false };
  const field = billing.type === "setup" ? "setupValue" : billing.type === "mensalidade" ? "monthlyValue" : "hardwareValue";
  const base = items
    .map(netContractItem)
    .map((i) => ({ item: i, value: i[field] }))
    .filter((x) => x.value > 0);
  const sum = round2(base.reduce((s, x) => s + x.value, 0));
  const factor = sum > 0 && Math.abs(sum - billing.amount) >= 0.01 ? billing.amount / sum : 1;
  const product = (id: string) => products.get(id);
  const out = base.map(({ item, value }) => {
    const p = product(item.productId);
    const fiscal: Partial<ProductFiscalProfile> = p?.fiscal ?? {};
    const goods = billing.type === "hardware";
    const total = round2(value * factor);
    const quantity = item.quantity > 0 ? item.quantity : 1;
    return {
      productId: item.productId,
      description: fiscal.invoiceDescription?.trim() || p?.name || item.productName,
      quantity,
      unitValue: round2(total / quantity),
      total,
      nature: fiscal.nature,
      ...(goods
        ? {
            ncm: fiscal.ncm || settings.defaultNcm,
            cfop: fiscal.cfop || settings.defaultCfop,
          }
        : {
            serviceCode: fiscal.serviceCode || settings.defaultServiceCode,
            issRate: fiscal.issRate ?? settings.defaultIssRate,
          }),
    };
  });
  // Arredondamento: a diferença de centavos vai para o último item (a soma bate com a cobrança).
  if (factor !== 1 && out.length > 0) {
    const diff = round2(billing.amount - out.reduce((s, i) => s + i.total, 0));
    if (diff !== 0) {
      const last = out[out.length - 1];
      last.total = round2(last.total + diff);
      last.unitValue = round2(last.total / last.quantity);
    }
  }
  return { items: out, sum, scaled: factor !== 1 };
}

/** Chave de acesso da NF-e: 44 dígitos (aceita com espaços/pontos). */
export function normalizeAccessKey(value: string | undefined): string | undefined {
  const digits = (value ?? "").replace(/\D/g, "");
  return digits || undefined;
}

export function isValidAccessKey(digits: string): boolean {
  if (!/^\d{44}$/.test(digits)) return false;
  // Dígito verificador (módulo 11, pesos 2..9 da direita para a esquerda).
  const body = digits.slice(0, 43);
  let sum = 0;
  let weight = 2;
  for (let i = body.length - 1; i >= 0; i--) {
    sum += Number(body[i]) * weight;
    weight = weight === 9 ? 2 : weight + 1;
  }
  const rest = sum % 11;
  const dv = rest < 2 ? 0 : 11 - rest;
  return dv === Number(digits[43]);
}

/** Número da nota só com dígitos e sem zeros à esquerda (para comparar "000123" com "123"). */
export function invoiceNumberKey(number: string): string {
  const digits = number.replace(/\D/g, "").replace(/^0+/, "");
  return digits || number.trim().toUpperCase();
}

/** Texto do envio da nota, com as variáveis preenchidas ({linkPortal} fica para o envio preencher). */
export function fillInvoiceMessage(template: string, values: { cliente: string; nota: string; valor: string; cobranca: string }): string {
  return template.replaceAll("{cliente}", values.cliente).replaceAll("{nota}", values.nota).replaceAll("{valor}", values.valor).replaceAll("{cobranca}", values.cobranca);
}
