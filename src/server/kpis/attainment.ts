/**
 * Regra ÚNICA de atingimento de meta do motor de indicadores. Módulo puro (sem servidor): usado pelo motor
 * (Meu Desempenho, Gestor, Cockpit, Ranking) e pelo bônus/simulador no navegador, para que o número seja o
 * mesmo em todas as telas.
 */
import type { KpiDirection } from "@/domain/types";

/**
 * Atingimento considerando o sentido: maior_melhor = valor/meta; menor_melhor = meta/valor (limitado a 2);
 * faixa = 1 dentro de [mín, máx], proporcional fora (sem faixa definida, usa meta ± 10%).
 */
export function computeAttainment(value: number | null, direction: KpiDirection, target: number | null, targetMin?: number, targetMax?: number): number | null {
  if (value === null) return null;
  if (direction === "faixa") {
    const min = targetMin ?? (target !== null ? target * 0.9 : undefined);
    const max = targetMax ?? (target !== null ? target * 1.1 : undefined);
    if (min === undefined || max === undefined) return null;
    if (value >= min && value <= max) return 1;
    if (value < min) return min > 0 ? Math.max(0, value / min) : 0;
    return value > 0 ? max / value : 0;
  }
  if (target === null) return null;
  if (direction === "menor_melhor") {
    if (value <= 0) return 2;
    return Math.min(2, target / value);
  }
  if (target <= 0) return value >= target ? 1 : 0;
  return Math.max(0, value / target);
}

