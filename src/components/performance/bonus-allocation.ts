import type { BonusComputation } from "@/server/performance/bonus";

export interface BonusAllocationLine {
  key: string;
  block: "individual" | "coletivo" | "extra";
  name: string;
  /** Pontos que o critério soma ao atingimento geral (fração). */
  points: number | null;
  /** Parte do valor da faixa atribuída ao critério (rateio proporcional aos pontos), ou o valor do extra. */
  amount: number | null;
  /** Fração do total (para o gráfico). */
  share: number | null;
}

/**
 * Composição do bônus por critério: o valor da faixa é rateado entre os indicadores proporcionalmente aos pontos
 * que cada um soma ao atingimento geral (peso do bloco × peso relativo × atingimento limitado a 100%); os extras
 * entram com o próprio valor. Bloqueado: tudo zero. Módulo puro (servidor e navegador).
 */
export function bonusAllocation(c: BonusComputation): BonusAllocationLine[] {
  const overall = c.overallAttainment;
  const tierAmount = c.blocked ? 0 : c.tierAmount;
  const lines: BonusAllocationLine[] = [];
  const add = (block: "individual" | "coletivo", weight: number, items: BonusComputation["individual"]["lines"]) => {
    for (const l of items) {
      const points = l.contribution === null ? null : l.contribution * weight;
      const amount = tierAmount === null || points === null ? null : overall && overall > 0 ? (tierAmount * points) / overall : 0;
      lines.push({ key: `${block}-${l.kpiKey}`, block, name: l.name, points, amount, share: null });
    }
  };
  add("individual", c.weights.individual, c.individual.lines);
  add("coletivo", c.weights.collective, c.collective.lines);
  for (const e of c.extras) lines.push({ key: `extra-${e.key}`, block: "extra", name: e.label, points: null, amount: c.blocked ? 0 : e.total, share: null });
  const total = lines.reduce((s, l) => s + (l.amount ?? 0), 0);
  for (const l of lines) l.share = total > 0 && l.amount !== null ? l.amount / total : null;
  return lines;
}
