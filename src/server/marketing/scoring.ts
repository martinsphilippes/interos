/**
 * Lead scoring. Módulo PURO (sem firebase, sem React): usado pelo serviço no servidor e pelos
 * componentes para explicar a pontuação.
 *
 * As regras vêm do setting `lead_scoring` (editável em Administração → Configurações):
 * pontos por origem, por interesse (categoria de produto) e por cidade, mais os limiares de
 * temperatura. O score mínimo do gate de MQL é o limiar de lead morno.
 */
import type { Lead, LeadTemperature } from "@/domain/types";

export interface LeadScoringRules {
  origem: Record<string, number>;
  interesse: Record<string, number>;
  cidade: Record<string, number>;
  limiares: { quente: number; morno: number };
}

export const DEFAULT_SCORING_RULES: LeadScoringRules = {
  origem: {},
  interesse: {},
  cidade: {},
  limiares: { quente: 70, morno: 40 },
};

export interface ScoreFactor {
  key: "origem" | "interesse" | "cidade";
  label: string;
  /** Regra que pontuou (ex.: "indicacao") ou null quando nenhuma regra casou. */
  rule: string | null;
  points: number;
}

export interface LeadScoreResult {
  score: number;
  temperature: LeadTemperature;
  factors: ScoreFactor[];
}

export interface ScoreInput extends Pick<Lead, "origin" | "interest" | "city"> {
  /** Categorias dos produtos de interesse (ex.: ["erp", "tef"]). */
  productCategories?: string[];
}

/** Minúsculas, sem acentos e sem espaços nas pontas. */
export function normalize(value: string | undefined | null): string {
  return (value ?? "")
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .trim();
}

function lookup(table: Record<string, number>, value: string | undefined): { rule: string | null; points: number } {
  const target = normalize(value);
  if (!target) return { rule: null, points: 0 };
  for (const [key, points] of Object.entries(table)) {
    if (normalize(key) === target) return { rule: key, points };
  }
  return { rule: null, points: 0 };
}

/**
 * Interesse: vale a regra de maior pontuação entre as categorias dos produtos de interesse e as
 * palavras do texto livre (ex.: "Sistema de gestão (ERP)" casa com a regra "erp").
 */
function interestPoints(table: Record<string, number>, interest: string | undefined, categories: string[]): { rule: string | null; points: number } {
  const text = ` ${normalize(interest).replace(/[^a-z0-9]+/g, " ")} `;
  const cats = new Set(categories.map(normalize));
  let best: { rule: string | null; points: number } = { rule: null, points: 0 };
  for (const [key, points] of Object.entries(table)) {
    const k = normalize(key);
    if (!k) continue;
    const matches = cats.has(k) || text.includes(` ${k} `);
    if (matches && (best.rule === null || points > best.points)) best = { rule: key, points };
  }
  return best;
}

export function temperatureFor(score: number, rules: Pick<LeadScoringRules, "limiares">): LeadTemperature {
  if (score >= rules.limiares.quente) return "quente";
  if (score >= rules.limiares.morno) return "morno";
  return "frio";
}

/** Calcula score, temperatura e a explicação (quais regras pontuaram). */
export function computeLeadScore(lead: ScoreInput, rules: LeadScoringRules): LeadScoreResult {
  const origin = lookup(rules.origem ?? {}, lead.origin);
  const interest = interestPoints(rules.interesse ?? {}, lead.interest, lead.productCategories ?? []);
  const city = lookup(rules.cidade ?? {}, lead.city);
  const factors: ScoreFactor[] = [
    { key: "origem", label: "Origem", ...origin },
    { key: "interesse", label: "Interesse", ...interest },
    { key: "cidade", label: "Cidade", ...city },
  ];
  const score = Math.max(0, factors.reduce((sum, f) => sum + f.points, 0));
  return { score, temperature: temperatureFor(score, rules), factors };
}

/** Score mínimo para o gate de MQL. */
export function mqlMinimumScore(rules: Pick<LeadScoringRules, "limiares">): number {
  return rules.limiares.morno;
}

export interface MqlGateResult {
  ok: boolean;
  /** O que falta, em português, para exibir ao usuário. */
  missing: string[];
  /** Situação de cada exigência do gate (para o painel do lead). */
  checks: { label: string; ok: boolean }[];
  minScore: number;
}

/** Gate de MQL: contato válido (telefone ou e-mail), interesse, consentimento LGPD e score mínimo. */
export function evaluateMqlGate(lead: Pick<Lead, "phone" | "email" | "interest" | "productInterestIds" | "consent" | "score">, rules: Pick<LeadScoringRules, "limiares">): MqlGateResult {
  const minScore = mqlMinimumScore(rules);
  const phoneDigits = (lead.phone ?? "").replace(/\D/g, "");
  const validPhone = phoneDigits.length >= 10 && phoneDigits.length <= 13;
  const validEmail = /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(lead.email ?? "");
  const checks = [
    { label: "Contato válido (telefone com DDD ou e-mail)", ok: validPhone || validEmail },
    { label: "Interesse declarado (texto ou produto de interesse)", ok: Boolean(lead.interest?.trim()) || (lead.productInterestIds ?? []).length > 0 },
    { label: "Consentimento LGPD registrado", ok: Boolean(lead.consent) },
    { label: `Score mínimo de ${minScore} pontos (atual: ${lead.score ?? 0})`, ok: (lead.score ?? 0) >= minScore },
  ];
  const missing = checks.filter((c) => !c.ok).map((c) => c.label);
  return { ok: missing.length === 0, missing, checks, minScore };
}
