/**
 * Regra da sequência em dias (setting "gamificacao.sequencia"). Módulo puro: usado pelo cálculo
 * (streak.ts), pelo schema do editor de configurações e pelo formulário em /admin/configuracoes.
 */
export const STREAK_SETTING = "gamificacao.sequencia";
export const STREAK_CRITERIA = ["pontos_sem_atraso", "pontos", "sem_atraso"] as const;
export type StreakCriterion = (typeof STREAK_CRITERIA)[number];

export interface StreakSettings {
  criterio: StreakCriterion;
  /** Limite de dias úteis olhados para trás (o cálculo para no primeiro dia que falha). */
  maxDias: number;
}

export const DEFAULT_STREAK: StreakSettings = { criterio: "pontos_sem_atraso", maxDias: 120 };

export const STREAK_CRITERION_LABELS: Record<StreakCriterion, string> = {
  pontos_sem_atraso: "Pontos no dia e nenhuma entrega atrasada",
  pontos: "Pontos no dia",
  sem_atraso: "Tarefas concluídas no dia, nenhuma atrasada",
};

export const STREAK_RULE_TEXT: Record<StreakCriterion, string> = {
  pontos_sem_atraso: "Dias úteis seguidos em que você ganhou pontos e não entregou nenhuma tarefa fora do prazo.",
  pontos: "Dias úteis seguidos em que você ganhou pontos.",
  sem_atraso: "Dias úteis seguidos em que você concluiu tarefas e nenhuma fora do prazo.",
};
