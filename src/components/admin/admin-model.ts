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

export const SETTINGS_TABS = ["horario", "feriados", "metas", "lead-scoring", "health-score", "oportunidades", "sla"] as const;
export type SettingsTab = (typeof SETTINGS_TABS)[number];

export function parseSettingsTab(value: string | undefined | null): SettingsTab {
  return value && (SETTINGS_TABS as readonly string[]).includes(value) ? (value as SettingsTab) : "horario";
}
