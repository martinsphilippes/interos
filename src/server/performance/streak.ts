import "server-only";
/**
 * Sequência em dias (Ranking e Gamificação): dias úteis consecutivos, até hoje, que cumprem a regra do setting
 * "gamificacao.sequencia" (documento próprio, criado com o padrão na primeira leitura, para não ser apagado pelo
 * editor do setting "gamificacao").
 *
 * Critérios:
 * - "pontos_sem_atraso" (padrão): o colaborador ganhou pontos no dia E não concluiu nenhuma tarefa após o prazo;
 * - "pontos": ganhou pontos no dia;
 * - "sem_atraso": concluiu ao menos uma tarefa no dia e nenhuma após o prazo.
 * Dias úteis = segunda a sexta, sem os feriados de settings/feriados. O dia de hoje só entra quando já cumpre
 * a regra (enquanto está em andamento, não quebra a sequência).
 */
import { create, list } from "@/server/db";
import { getHolidays } from "@/server/sla";
import { COLLECTIONS, type GamificationPoints, type Settings, type Task } from "@/domain/types";
import { localDayKey } from "@/server/kpis/period";

import { DEFAULT_STREAK, STREAK_CRITERIA, STREAK_RULE_TEXT, STREAK_SETTING, type StreakCriterion, type StreakSettings } from "./streak-rules";

export { DEFAULT_STREAK, STREAK_CRITERIA, STREAK_RULE_TEXT, STREAK_SETTING, type StreakCriterion, type StreakSettings };

export async function getStreakSettings(): Promise<StreakSettings> {
  const docs = await list<Settings>(COLLECTIONS.settings, { where: [["key", "==", STREAK_SETTING]] });
  if (!docs[0]) {
    await create<Settings>(
      COLLECTIONS.settings,
      { key: STREAK_SETTING, value: { ...DEFAULT_STREAK }, description: "Regra da sequência em dias da gamificação (critério e janela máxima em dias úteis)." },
      "setting_gamificacao_sequencia",
    );
    return { ...DEFAULT_STREAK };
  }
  const v = docs[0].value as Partial<StreakSettings>;
  return {
    criterio: STREAK_CRITERIA.includes(v.criterio as StreakCriterion) ? (v.criterio as StreakCriterion) : DEFAULT_STREAK.criterio,
    maxDias: typeof v.maxDias === "number" && v.maxDias > 0 ? Math.min(365, v.maxDias) : DEFAULT_STREAK.maxDias,
  };
}

export interface Streak {
  days: number;
  criterion: StreakCriterion;
  rule: string;
  /** Hoje já conta na sequência. */
  todayCounts: boolean;
}

const DAY_MS = 86_400_000;

/** Sequência atual de um colaborador (ver regras no topo do arquivo). */
export async function computeStreak(userId: string, now: Date = new Date()): Promise<Streak> {
  const [settings, holidays, points, tasks] = await Promise.all([
    getStreakSettings(),
    getHolidays(),
    list<GamificationPoints>(COLLECTIONS.gamificationPoints, { where: [["userId", "==", userId]] }),
    list<Task>(COLLECTIONS.tasks, { where: [["assigneeId", "==", userId]] }),
  ]);
  const pointDays = new Set(points.filter((p) => (Number(p.points) || 0) > 0).map((p) => localDayKey(p.createdAt)));
  const doneDays = new Set<string>();
  const lateDays = new Set<string>();
  for (const t of tasks) {
    if (t.status !== "concluida" || !t.completedAt) continue;
    const day = localDayKey(t.completedAt);
    doneDays.add(day);
    if (t.dueAt && t.completedAt > t.dueAt) lateDays.add(day);
  }
  const counts = (day: string): boolean => {
    if (settings.criterio === "pontos") return pointDays.has(day);
    if (settings.criterio === "sem_atraso") return doneDays.has(day) && !lateDays.has(day);
    return pointDays.has(day) && !lateDays.has(day);
  };

  const today = localDayKey(now);
  let cursor = Date.parse(`${today}T12:00:00Z`);
  let days = 0;
  let todayCounts = false;
  let checked = 0;
  while (checked < settings.maxDias) {
    const key = new Date(cursor).toISOString().slice(0, 10);
    const weekday = new Date(cursor).getUTCDay();
    cursor -= DAY_MS;
    if (weekday === 0 || weekday === 6 || holidays.has(key)) continue;
    checked += 1;
    if (counts(key)) {
      days += 1;
      if (key === today) todayCounts = true;
      continue;
    }
    if (key === today) continue; // dia em andamento não quebra a sequência
    break;
  }
  return { days, criterion: settings.criterio, rule: STREAK_RULE_TEXT[settings.criterio], todayCounts };
}
