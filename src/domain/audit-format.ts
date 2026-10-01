/**
 * Auditoria (D29) — formatação PURA das alterações "campo: de → para" gravadas nos eventos (`payload.changes`).
 *
 * Usada pela timeline (cliente, contrato, implantação…), pelo relatório "Auditoria" (prévia e exportação) e pelos
 * testes. Sem Firestore e sem React: pode ir para Client Components.
 *
 * - Rótulos amigáveis por campo (mapa pequeno; o evento pode trazer os seus em `payload.labels`; fallback = nome do
 *   campo).
 * - Valores sensíveis SEMPRE mascarados (salário, senhas, tokens); quantias mascaradas quando quem vê não tem
 *   "Visualizar valores" (A13) — a redação acontece no servidor (`redactChanges`) antes de ir para a tela.
 * - Eventos antigos com o formato próprio `payload.from/to` (`*.status_changed`, `*.stage_changed`) são lidos como
 *   `changes.status`/`changes.stage`, sem reescrever o que foi gravado.
 */
import { CLIENT_STATUS_LABELS, DEPARTMENT_LABELS, ROLE_LABELS, TASK_STATUS_LABELS } from "./constants";
import { AMENDMENT_FIELD_LABELS, describeSnapshotValue } from "./contract-snapshot";
import { COMMISSION_STATUS_LABELS, PAYABLE_STATUS_LABELS } from "./commissions";

export interface ChangeEntry {
  from: unknown;
  to: unknown;
}

export type ChangeMap = Record<string, ChangeEntry>;

/** Linha pronta para exibir: "Rótulo: antes → depois". */
export interface ChangeLine {
  field: string;
  label: string;
  from: string;
  to: string;
}

export interface FormatChangesOptions {
  /** Rótulos próprios do evento (`payload.labels`), que têm precedência. */
  labels?: Record<string, string>;
  /** Quem vê não tem "Visualizar valores": quantias saem como "Restrito". */
  hideValues?: boolean;
}

export const MASKED_VALUE = "•••• (oculto)";
export const RESTRICTED_VALUE = "Restrito";

/** Rótulos de negócio por campo (o mesmo nome de campo significa a mesma coisa em todas as entidades). */
export const CHANGE_FIELD_LABELS: Record<string, string> = {
  ...AMENDMENT_FIELD_LABELS,
  status: "Situação",
  stage: "Etapa",
  financialStatus: "Situação financeira",
  pendingReason: "Pendência",
  cancelReason: "Motivo do cancelamento",
  cancelledAt: "Cancelado em",
  amount: "Valor",
  paidAmount: "Valor pago",
  paidAt: "Pago em",
  dueDate: "Vencimento",
  signers: "Signatários",
  signer: "Assinatura",
  version: "Versão",
  documentHash: "Hash do documento",
  approvedBy: "Aprovado por",
  legalName: "Razão social",
  tradeName: "Nome fantasia",
  document: "CPF/CNPJ",
  email: "E-mail",
  phone: "Telefone",
  whatsapp: "WhatsApp",
  website: "Site",
  segment: "Segmento",
  origin: "Origem",
  address: "Endereço",
  street: "Logradouro",
  number: "Número",
  district: "Bairro",
  city: "Cidade",
  state: "UF",
  zip: "CEP",
  ownerId: "Responsável",
  ownerSalesId: "Responsável comercial",
  ownerCsId: "Responsável de CS",
  tags: "Tags",
  notes: "Observações",
  communicationOptOut: "Opt-out de comunicação",
  name: "Nome",
  role: "Papel",
  departmentId: "Departamento",
  managerId: "Gestor",
  jobTitle: "Cargo",
  active: "Ativo",
  baseSalary: "Salário base",
  monthlyGoals: "Metas mensais",
  category: "Categoria",
  description: "Descrição",
  setupPrice: "Preço de adesão",
  monthlyPrice: "Preço da mensalidade",
  hardwarePrice: "Preço do hardware",
  billingType: "Tipo de cobrança",
  commission: "Comissão do produto",
  implementationDays: "Prazo de implantação (dias)",
  implementationTemplateId: "Modelo de implantação",
  target: "Meta",
  weight: "Peso",
  key: "Chave",
  appliesTo: "Aplica-se a",
  responseHours: "1ª resposta (h)",
  resolutionHours: "Solução (h)",
  businessHoursOnly: "Só horário comercial",
  attentionPct: "Atenção (%)",
  riskPct: "Risco (%)",
  trigger: "Gatilho",
  conditions: "Condições",
  actions: "Ações",
  exigeAprovacaoGestor: "Go-live exige aprovação do gestor",
  maxPctOfSalary: "Teto (% do salário)",
  individualWeight: "Peso individual",
  collectiveWeight: "Peso coletivo",
  individualKpis: "Indicadores individuais",
  collectiveKpis: "Indicadores coletivos",
  tiers: "Faixas",
  blockers: "Bloqueios",
  extras: "Extras",
  expiresAt: "Expira em",
  lastAccessAt: "Último acesso",
};

/** Campos que NUNCA aparecem em claro (defesa em profundidade: o serviço já grava mascarado). */
export const SENSITIVE_CHANGE_FIELDS = new Set(["baseSalary", "salary", "salario", "password", "senha", "token", "secret", "apiKey"]);

/** Campos com quantias (saem como "Restrito" sem "Visualizar valores"). */
export const MONEY_CHANGE_FIELDS = new Set([
  "amount",
  "paidAmount",
  "partialPaidAmount",
  "setupTotal",
  "monthlyTotal",
  "hardwareTotal",
  "setupPrice",
  "monthlyPrice",
  "hardwarePrice",
  "items",
  "value",
  "baseAmount",
]);

/** Rótulos dos valores de situação conhecidos (contrato, cobrança, financeiro, cliente, tarefa, comissão, título). */
const STATUS_VALUE_LABELS: Record<string, string> = {
  ...CLIENT_STATUS_LABELS,
  ...TASK_STATUS_LABELS,
  ...COMMISSION_STATUS_LABELS,
  ...PAYABLE_STATUS_LABELS,
  // Contrato e cobrança por último: são os que mais aparecem na auditoria.
  aguardando_contrato: "Aguardando contrato",
  aguardando_assinatura: "Aguardando assinatura",
  assinado: "Assinado",
  aguardando_pagamento: "Aguardando pagamento",
  pago: "Pago",
  pendencia: "Pendência",
  pendente: "Pendente",
  liberado: "Liberado",
  cancelado: "Cancelado",
  aprovado: "Aprovado",
  aberta: "Em aberto",
  vencida: "Vencida",
  paga: "Paga",
  cancelada: "Cancelada",
  // Link do portal do cliente (D31).
  revogado: "Revogado",
  expirado: "Expirado",
};

const ISO_DATE = /^\d{4}-\d{2}-\d{2}(T[\d:.]+Z?)?$/;

function dmy(value: string): string {
  const [y, m, d] = value.slice(0, 10).split("-");
  return `${d}/${m}/${y}`;
}

function brl(n: number): string {
  return n.toLocaleString("pt-BR", { style: "currency", currency: "BRL" });
}

/** Rótulo de um campo (rótulos do evento → mapa → nome do campo). */
export function changeFieldLabel(field: string, labels?: Record<string, string>): string {
  const own = labels?.[field];
  if (own) return own.charAt(0).toUpperCase() + own.slice(1);
  return CHANGE_FIELD_LABELS[field] ?? field;
}

/** Valor legível de um campo alterado (com máscara de sensível e de quantia). */
export function formatChangeValue(field: string, value: unknown, options: FormatChangesOptions = {}): string {
  if (value === undefined || value === null || value === "") return "—";
  if (SENSITIVE_CHANGE_FIELDS.has(field)) {
    // O serviço grava só "valor anterior/novo valor/informado"; qualquer número que escape é ocultado.
    return typeof value === "string" && !/\d/.test(value) ? value : MASKED_VALUE;
  }
  if (options.hideValues && MONEY_CHANGE_FIELDS.has(field)) return RESTRICTED_VALUE;
  if (field in AMENDMENT_FIELD_LABELS) return describeSnapshotValue(field, value);
  if (typeof value === "boolean") return value ? "sim" : "não";
  if (typeof value === "number") return MONEY_CHANGE_FIELDS.has(field) ? brl(value) : value.toLocaleString("pt-BR");
  if (typeof value === "string") {
    if (field === "role") return ROLE_LABELS[value as keyof typeof ROLE_LABELS] ?? value;
    if (field === "departmentId" || field === "department") return DEPARTMENT_LABELS[value as keyof typeof DEPARTMENT_LABELS] ?? value;
    if (field === "status" || field === "financialStatus" || field === "stage" || field === "signer") return STATUS_VALUE_LABELS[value] ?? value.replace(/_/g, " ");
    if (ISO_DATE.test(value)) return dmy(value);
    return value;
  }
  if (Array.isArray(value)) {
    if (value.length === 0) return "nenhum";
    // Signatários e listas de pessoas: os nomes.
    const names = value.map((v) => {
      if (!v || typeof v !== "object") return String(v);
      const o = v as Record<string, unknown>;
      const named = o.name ?? o.productName ?? o.email ?? o.label;
      if (named !== undefined && named !== null) return String(named);
      // Estruturas sem nome (condições, ações, faixas): forma compacta, limitada.
      const compact = JSON.stringify(o);
      return compact.length > 80 ? `${compact.slice(0, 77)}…` : compact;
    });
    return names.join(", ");
  }
  if (typeof value === "object") {
    const entries = Object.entries(value as Record<string, unknown>).filter(([, v]) => v !== undefined && v !== null && v !== "");
    if (entries.length === 0) return "—";
    return entries
      .slice(0, 6)
      .map(([k, v]) => `${changeFieldLabel(k)}: ${formatChangeValue(k, v, options)}`)
      .join("; ");
  }
  return String(value);
}

/** Alterações de um payload de evento (changes válidos, ou o formato antigo from/to de status/etapa). */
export function eventChanges(type: string, payload: Record<string, unknown> | undefined | null): ChangeMap | null {
  if (!payload) return null;
  const raw = payload.changes;
  if (raw && typeof raw === "object" && !Array.isArray(raw)) {
    const out: ChangeMap = {};
    for (const [field, c] of Object.entries(raw as Record<string, unknown>)) {
      if (c && typeof c === "object" && ("from" in (c as object) || "to" in (c as object))) out[field] = { from: (c as ChangeEntry).from ?? null, to: (c as ChangeEntry).to ?? null };
    }
    return Object.keys(out).length > 0 ? out : null;
  }
  const primitive = (v: unknown) => v === null || ["string", "number", "boolean"].includes(typeof v);
  if ((type.endsWith(".status_changed") || type.endsWith(".stage_changed")) && "from" in payload && "to" in payload && primitive(payload.from) && primitive(payload.to)) {
    return { [type.endsWith(".stage_changed") ? "stage" : "status"]: { from: payload.from ?? null, to: payload.to ?? null } };
  }
  return null;
}

/** Linhas "campo: de → para" prontas para exibir. */
export function changeLines(changes: ChangeMap | null | undefined, options: FormatChangesOptions = {}): ChangeLine[] {
  if (!changes) return [];
  return Object.entries(changes).map(([field, c]) => ({
    field,
    label: changeFieldLabel(field, options.labels),
    from: formatChangeValue(field, c.from, options),
    to: formatChangeValue(field, c.to, options),
  }));
}

/** Resumo em uma linha ("Situação: Em aberto → Cancelada · Valor: R$ 10,00 → —"), para relatório/CSV. */
export function summarizeChanges(changes: ChangeMap | null | undefined, options: FormatChangesOptions & { max?: number } = {}): string {
  const lines = changeLines(changes, options);
  const max = options.max ?? 12;
  const text = lines
    .slice(0, max)
    .map((l) => `${l.label}: ${l.from} → ${l.to}`)
    .join(" · ");
  return lines.length > max ? `${text} · (+${lines.length - max})` : text;
}

/**
 * Cópia das alterações para quem NÃO tem "Visualizar valores" (A13): quantias saem do objeto (o número nunca vai ao
 * navegador) e sensíveis são substituídos pelo marcador. Feita no SERVIDOR antes de enviar à tela.
 */
export function redactChanges(changes: ChangeMap | null | undefined, options: { hideValues: boolean }): ChangeMap | undefined {
  if (!changes) return undefined;
  const out: ChangeMap = {};
  for (const [field, c] of Object.entries(changes)) {
    if (SENSITIVE_CHANGE_FIELDS.has(field)) out[field] = { from: c.from === null ? null : formatChangeValue(field, c.from), to: c.to === null ? null : formatChangeValue(field, c.to) };
    else if (options.hideValues && MONEY_CHANGE_FIELDS.has(field)) out[field] = { from: c.from === null ? null : RESTRICTED_VALUE, to: c.to === null ? null : RESTRICTED_VALUE };
    else out[field] = c;
  }
  return out;
}

// ---------------------------------------------------------------------------
// Histórico do contrato (D29): só eventos DESTE contrato
// ---------------------------------------------------------------------------

/** Eventos que pertencem a outras telas com acesso próprio (comissões, títulos, indicadores) e não entram no histórico. */
const CONTRACT_HISTORY_EXCLUDED_PREFIXES = ["commission.", "commission_rule.", "payable.", "kpi.", "goal.", "gamification.", "bonus.", "achievement."];

export interface ContractHistoryCandidate {
  type: string;
  entityId?: string;
  payload?: Record<string, unknown> | null;
}

/**
 * Filtro do histórico do contrato: entra o evento cujo `payload.contractId` é ESTE contrato, ou — sem contractId no
 * payload — cujo `entityId` é o contrato ou um registro dele (cobranças, aditivos, projeto, oportunidade de origem).
 * Evento com `payload.contractId` de OUTRO contrato do mesmo cliente nunca entra (não mistura contratos).
 */
export function belongsToContractHistory(event: ContractHistoryCandidate, contractId: string, relatedIds: ReadonlySet<string>): boolean {
  if (CONTRACT_HISTORY_EXCLUDED_PREFIXES.some((p) => event.type.startsWith(p))) return false;
  const payloadContract = event.payload?.contractId;
  if (typeof payloadContract === "string" && payloadContract) return payloadContract === contractId;
  return Boolean(event.entityId && (event.entityId === contractId || relatedIds.has(event.entityId)));
}
