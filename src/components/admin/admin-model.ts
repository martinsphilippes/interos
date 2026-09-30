/**
 * Rótulos e utilitários compartilhados pelas telas de administração (seguros para o cliente).
 */
import type { Product, SlaRule } from "@/domain/types";

export const BILLING_TYPE_LABELS: Record<Product["billingType"], string> = {
  recorrente: "Recorrente",
  unico: "Único",
  ambos: "Setup + recorrente",
};

export const SLA_APPLIES_TO_LABELS: Record<SlaRule["appliesTo"], string> = {
  tarefa: "Tarefa",
  workflow: "Etapa de workflow",
  chamado: "Chamado de suporte",
  implantacao: "Projeto de implantação",
  cs: "Customer Success",
  oportunidade: "Oportunidade",
};

/** Dias da semana na ordem do JavaScript (0 = domingo). */
export const WEEKDAYS: { value: number; label: string; short: string }[] = [
  { value: 1, label: "Segunda-feira", short: "Seg" },
  { value: 2, label: "Terça-feira", short: "Ter" },
  { value: 3, label: "Quarta-feira", short: "Qua" },
  { value: 4, label: "Quinta-feira", short: "Qui" },
  { value: 5, label: "Sexta-feira", short: "Sex" },
  { value: 6, label: "Sábado", short: "Sáb" },
  { value: 0, label: "Domingo", short: "Dom" },
];

/** Converte texto de input em número (aceita vírgula decimal). Vazio ou inválido => NaN. */
export function parseNumber(value: string): number {
  const text = value.trim().replace(",", ".");
  if (!text) return Number.NaN;
  return Number(text);
}

/** Número para o input: evita "undefined"/NaN e mantém até 4 casas. */
export function numberToInput(value: number | undefined | null): string {
  if (value === undefined || value === null || Number.isNaN(value)) return "";
  return String(Math.round(value * 10_000) / 10_000);
}

/** Fração (0.85) para percentual de input ("85"). */
export function fractionToPercentInput(value: number | undefined | null): string {
  if (value === undefined || value === null || Number.isNaN(value)) return "";
  return numberToInput(value * 100);
}

/** Percentual de input ("85") para fração (0.85). */
export function percentInputToFraction(value: string): number {
  const n = parseNumber(value);
  return Number.isNaN(n) ? Number.NaN : Math.round(n * 100) / 10_000;
}

/** Normaliza texto para busca: minúsculas e sem acentos. */
export function normalizeText(value: string | undefined | null): string {
  return (value ?? "")
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .trim();
}

// ---------------------------------------------------------------------------
// Abas de /admin/configuracoes (puro: usado pelo Server Component e pelo componente de abas)
// ---------------------------------------------------------------------------

export const SETTINGS_TABS = ["horario", "feriados", "metas", "lead-scoring", "health-score", "oportunidades", "gate-financeiro", "cobranca", "contas-a-pagar", "entrega", "performance", "saude-indice", "sla"] as const;
export type SettingsTab = (typeof SETTINGS_TABS)[number];

export function parseSettingsTab(value: string | undefined | null): SettingsTab {
  return value && (SETTINGS_TABS as readonly string[]).includes(value) ? (value as SettingsTab) : "horario";
}

/**
 * Configurações gravadas por aba (A12). "saude-indice" e "sla" não gravam `settings` (motor de KPIs e coleção
 * sla_rules). Uma aba aparece quando ao menos uma das suas configurações é visível para o perfil.
 */
export const SETTINGS_TAB_KEYS: Record<SettingsTab, readonly string[]> = {
  horario: ["horario_comercial"],
  feriados: ["feriados"],
  metas: ["metas_referencia"],
  "lead-scoring": ["lead_scoring"],
  "health-score": ["health_score"],
  oportunidades: ["oportunidade"],
  "gate-financeiro": ["gate_financeiro", "financeiro_alertas"],
  cobranca: ["regua_cobranca", "cobranca_canais", "financeiro_baixa"],
  "contas-a-pagar": ["contas_a_pagar"],
  entrega: ["go_live", "cs_ativacao"],
  performance: ["gamificacao", "premios_vendas", "gamificacao.sequencia"],
  "saude-indice": [],
  sla: [],
};

/** O que o perfil vê e edita em /admin/configuracoes (calculado no servidor pelas chaves do catálogo). */
export interface SettingsAccess {
  /** Configurações visíveis (seção `.ver` da aba). */
  visible: string[];
  /** Configurações editáveis (chave de SETTING_PERMISSION). */
  editable: string[];
  saudeIndice: { visible: boolean; operationHealthEditable: boolean; performanceIndexEditable: boolean };
  sla: { visible: boolean; edit: boolean; delete: boolean };
}

/** Abas visíveis, na ordem de SETTINGS_TABS. */
export function visibleSettingsTabs(access: SettingsAccess): SettingsTab[] {
  return SETTINGS_TABS.filter((tab) => {
    if (tab === "saude-indice") return access.saudeIndice.visible;
    if (tab === "sla") return access.sla.visible;
    return SETTINGS_TAB_KEYS[tab].some((k) => access.visible.includes(k));
  });
}
