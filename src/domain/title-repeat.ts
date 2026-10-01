/**
 * Repetição dos títulos no formulário "Novo título" (etapa CP/CR 4) — regras PURAS (sem Firestore, sem React), usadas
 * pelos serviços de Contas a Pagar (`createManualPayable`) e dos títulos a receber avulsos (`createReceivables`), pela
 * prévia ao vivo dos formulários e pelos testes (`tests/finance/title-repeat.test.ts`).
 *
 * Três modos:
 *  - Único: um título;
 *  - Fixo: o MESMO valor repetido N vezes, descrição como digitada (sem parcela gravada);
 *  - Parcelado: total ÷ N com centavos exatos e a SOBRA NA ÚLTIMA parcela (decisão 5 do dono), sufixo " (i/N)" e
 *    parcela {n, total} gravada.
 * Intervalo "a cada N dias, semanas ou meses" (padrão 1 mês; N ≥ 1; 2 a 120 ocorrências). Meses: sempre a partir do
 * dia ORIGINAL, limitado ao fim do mês (31/01 → 28/02 → 31/03); dias/semanas: soma de calendário. Vencimento e
 * competência andam juntos (a competência anda o mesmo número de meses que o vencimento; vazia = mês do vencimento).
 */
import { shiftDueMonths, splitInstallments } from "./settlements";
import type { Check } from "./finance-registry";

export type RepeatMode = "unico" | "fixo" | "parcelado";
export type RepeatUnit = "dias" | "semanas" | "meses";

export const REPEAT_MODES: readonly RepeatMode[] = ["unico", "fixo", "parcelado"];
export const REPEAT_UNITS: readonly RepeatUnit[] = ["dias", "semanas", "meses"];
export const REPEAT_MODE_LABELS: Record<RepeatMode, string> = { unico: "Único", fixo: "Fixo (mesmo valor repetido)", parcelado: "Parcelado (total dividido)" };
export const REPEAT_UNIT_LABELS: Record<RepeatUnit, string> = { dias: "dia(s)", semanas: "semana(s)", meses: "mês(es)" };

/** Mínimo e máximo de ocorrências de uma repetição (fixo/parcelado). */
export const REPEAT_MIN_OCCURRENCES = 2;
export const REPEAT_MAX_OCCURRENCES = 120;
/** Maior intervalo aceito ("a cada 365 dias", "a cada 52 semanas", "a cada 60 meses"…). */
export const REPEAT_MAX_EVERY = 365;

export interface RepeatInput {
  mode: RepeatMode;
  /** Número de ocorrências (fixo/parcelado: 2–120). */
  count?: number;
  /** Intervalo: a cada `every` `unit` (padrão 1 mês). */
  every?: number;
  unit?: RepeatUnit;
}

export interface TitleDraft {
  description: string;
  /** Valor do título (fixo: de CADA ocorrência; parcelado: o TOTAL). */
  amount: number;
  /** Vencimento da 1ª ocorrência (AAAA-MM-DD ou ISO). */
  dueDate: string;
  /** AAAA-MM; vazia = mês do vencimento de cada ocorrência. */
  competence?: string;
  repeat?: RepeatInput;
}

export interface Occurrence {
  /** 1..N */
  index: number;
  total: number;
  description: string;
  amount: number;
  /** AAAA-MM-DD */
  dueDate: string;
  /** AAAA-MM */
  competence: string;
  /** Só no parcelado (parcela n de N). */
  installment?: { n: number; total: number };
}

const DAY = /^\d{4}-\d{2}-\d{2}/;
const MONTH = /^\d{4}-(0[1-9]|1[0-2])$/;

/** Sufixo de parcela do modo parcelado: " (3/12)". */
export function installmentSuffix(n: number, total: number): string {
  return ` (${n}/${total})`;
}

/**
 * Descrição sem o sufixo de parcela (clonar): remove " (3/12)" e o formato antigo " (parcela 3/12)" do fim. Não mexe
 * em outros parênteses nem no sufixo "— Resíduo".
 */
export function stripInstallmentSuffix(description: string): string {
  return description.replace(/\s*\((?:parcela\s+)?\d{1,3}\s*\/\s*\d{1,3}\)\s*$/i, "").trim();
}

/** Soma `amount` unidades ao dia AAAA-MM-DD (meses: a partir do dia original, limitado ao fim do mês). */
export function addInterval(day: string, amount: number, unit: RepeatUnit): string {
  const key = day.slice(0, 10);
  if (unit === "meses") return shiftDueMonths(key, amount).slice(0, 10);
  const [y, m, d] = key.split("-").map(Number);
  const days = unit === "semanas" ? amount * 7 : amount;
  return new Date(Date.UTC(y, m - 1, d + days, 12)).toISOString().slice(0, 10);
}

/** Meses de calendário entre dois dias (pelo mês, ignorando o dia). */
export function monthsBetween(from: string, to: string): number {
  const [y1, m1] = from.slice(0, 7).split("-").map(Number);
  const [y2, m2] = to.slice(0, 7).split("-").map(Number);
  return (y2 - y1) * 12 + (m2 - m1);
}

/** AAAA-MM somado de `n` meses. */
export function addMonthsToCompetence(competence: string, n: number): string {
  const [y, m] = competence.split("-").map(Number);
  return new Date(Date.UTC(y, m - 1 + n, 1)).toISOString().slice(0, 7);
}

/** Repetição normalizada (padrões aplicados) ou erro com a mensagem para o usuário. */
export function normalizeRepeat(repeat: RepeatInput | undefined): Check<Required<RepeatInput>> {
  const mode = repeat?.mode ?? "unico";
  if (!REPEAT_MODES.includes(mode)) return { ok: false, error: "Repetição inválida" };
  if (mode === "unico") return { ok: true, value: { mode, count: 1, every: 1, unit: "meses" } };
  const count = Number(repeat?.count);
  const every = repeat?.every === undefined ? 1 : Number(repeat.every);
  const unit = repeat?.unit ?? "meses";
  if (!Number.isInteger(count) || count < REPEAT_MIN_OCCURRENCES) return { ok: false, error: `Repetição: informe ao menos ${REPEAT_MIN_OCCURRENCES} ocorrências` };
  if (count > REPEAT_MAX_OCCURRENCES) return { ok: false, error: `Repetição: máximo de ${REPEAT_MAX_OCCURRENCES} ocorrências` };
  if (!Number.isInteger(every) || every < 1) return { ok: false, error: "Intervalo: a cada 1 ou mais dias, semanas ou meses" };
  if (every > REPEAT_MAX_EVERY) return { ok: false, error: `Intervalo: no máximo a cada ${REPEAT_MAX_EVERY}` };
  if (!REPEAT_UNITS.includes(unit)) return { ok: false, error: "Intervalo inválido (dias, semanas ou meses)" };
  return { ok: true, value: { mode, count, every, unit } };
}

/**
 * Ocorrências do título (prévia e gravação usam a MESMA função): datas, competências, valores e descrições. Erros com
 * a mensagem para o usuário (valor, vencimento, competência, repetição, parcela menor que R$ 0,01).
 */
export function planOccurrences(draft: TitleDraft): Check<Occurrence[]> {
  const description = draft.description.trim();
  if (!DAY.test(draft.dueDate ?? "")) return { ok: false, error: "Informe o vencimento" };
  if (!Number.isFinite(draft.amount) || draft.amount <= 0) return { ok: false, error: "Informe o valor (maior que zero)" };
  if (draft.competence && !MONTH.test(draft.competence)) return { ok: false, error: "Competência inválida (AAAA-MM)" };
  const repeat = normalizeRepeat(draft.repeat);
  if (!repeat.ok) return repeat;
  const { mode, count, every, unit } = repeat.value;
  const first = draft.dueDate.slice(0, 10);
  const totalCents = Math.round(draft.amount * 100);
  if (mode === "parcelado" && totalCents < count) return { ok: false, error: "Valor total menor que R$ 0,01 por parcela" };
  const amounts = mode === "parcelado" ? splitInstallments(totalCents / 100, count) : Array.from({ length: count }, () => totalCents / 100);
  const out: Occurrence[] = [];
  for (let i = 0; i < count; i++) {
    // Sempre a partir do vencimento ORIGINAL (31/01 → 28/02 → 31/03), nunca da ocorrência anterior.
    const dueDate = i === 0 ? first : addInterval(first, i * every, unit);
    const competence = draft.competence ? addMonthsToCompetence(draft.competence, monthsBetween(first, dueDate)) : dueDate.slice(0, 7);
    out.push({
      index: i + 1,
      total: count,
      description: mode === "parcelado" ? `${description}${installmentSuffix(i + 1, count)}` : description,
      amount: amounts[i],
      dueDate,
      competence,
      ...(mode === "parcelado" ? { installment: { n: i + 1, total: count } } : {}),
    });
  }
  return { ok: true, value: out };
}

/** Resumo da repetição para histórico/evento: "Parcelado em 3 · a cada 1 mês(es)". */
export function describeRepeat(repeat: RepeatInput | undefined): string {
  const r = normalizeRepeat(repeat);
  if (!r.ok || r.value.mode === "unico") return "Único";
  const { mode, count, every, unit } = r.value;
  return `${mode === "parcelado" ? `Parcelado em ${count}` : `Fixo ${count}×`} · a cada ${every} ${REPEAT_UNIT_LABELS[unit]}`;
}
