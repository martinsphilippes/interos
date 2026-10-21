/**
 * Envio agendado de relatórios: próxima execução (horário de Brasília, UTC−3 fixo) e o período de cada envio.
 * Puro: sem servidor.
 */
import type { ReportSchedule, ReportScheduleFrequency, ReportSchedulePeriod } from "./types";

const BRT_MS = 3 * 3_600_000;
const DAY_MS = 86_400_000;

export const FREQUENCY_LABELS: Record<ReportScheduleFrequency, string> = { diaria: "Todo dia", semanal: "Toda semana", mensal: "Todo mês" };
export const WEEKDAY_LABELS = ["domingo", "segunda", "terça", "quarta", "quinta", "sexta", "sábado"] as const;

export const PERIOD_LABELS: Record<ReportSchedulePeriod, string> = {
  ontem: "Ontem",
  ultimos_7: "Últimos 7 dias (até ontem)",
  semana_anterior: "Semana anterior (seg. a dom.)",
  mes_atual: "Mês atual até ontem",
  mes_anterior: "Mês anterior",
  ultimos_3_meses: "Últimos 3 meses fechados",
  ultimos_6_meses: "Últimos 6 meses fechados",
  atual: "Fotografia do momento",
};

/** Períodos possíveis pelo tipo de filtro do relatório (dia, competência ou sem período). */
export function periodsFor(kind: "dia" | "mes" | "nenhum"): ReportSchedulePeriod[] {
  if (kind === "dia") return ["ontem", "ultimos_7", "semana_anterior", "mes_atual", "mes_anterior"];
  if (kind === "mes") return ["mes_anterior", "ultimos_3_meses", "ultimos_6_meses"];
  return ["atual"];
}

const pad = (n: number) => String(n).padStart(2, "0");
/** Dia local (BRT) aaaa-mm-dd de um instante. */
function dayKey(ms: number): string {
  const d = new Date(ms - BRT_MS);
  return `${d.getUTCFullYear()}-${pad(d.getUTCMonth() + 1)}-${pad(d.getUTCDate())}`;
}
function monthKey(year: number, month0: number): string {
  const d = new Date(Date.UTC(year, month0, 1));
  return `${d.getUTCFullYear()}-${pad(d.getUTCMonth() + 1)}`;
}

/** Filtros de período (de/ate) do envio, a partir do instante do envio. */
export function periodFilters(period: ReportSchedulePeriod, now: number = Date.now()): { de?: string; ate?: string } {
  const local = new Date(now - BRT_MS);
  const y = local.getUTCFullYear();
  const m = local.getUTCMonth();
  const yesterday = dayKey(now - DAY_MS);
  switch (period) {
    case "ontem":
      return { de: yesterday, ate: yesterday };
    case "ultimos_7":
      return { de: dayKey(now - 7 * DAY_MS), ate: yesterday };
    case "semana_anterior": {
      // Segunda a domingo da semana passada.
      const dow = local.getUTCDay();
      const sinceMonday = (dow + 6) % 7;
      const lastMonday = now - (sinceMonday + 7) * DAY_MS;
      return { de: dayKey(lastMonday), ate: dayKey(lastMonday + 6 * DAY_MS) };
    }
    case "mes_atual": {
      const first = `${y}-${pad(m + 1)}-01`;
      // No dia 1, «até ontem» seria o mês anterior: manda o mês anterior inteiro.
      return local.getUTCDate() === 1 ? periodFilters("mes_anterior", now) : { de: first, ate: yesterday };
    }
    case "mes_anterior": {
      const start = new Date(Date.UTC(y, m - 1, 1));
      const end = new Date(Date.UTC(y, m, 0));
      return { de: `${start.getUTCFullYear()}-${pad(start.getUTCMonth() + 1)}-01`, ate: `${end.getUTCFullYear()}-${pad(end.getUTCMonth() + 1)}-${pad(end.getUTCDate())}` };
    }
    case "ultimos_3_meses":
      return { de: monthKey(y, m - 3), ate: monthKey(y, m - 1) };
    case "ultimos_6_meses":
      return { de: monthKey(y, m - 6), ate: monthKey(y, m - 1) };
    default:
      return {};
  }
}

/** Relatório por competência recebe aaaa-mm; por data, aaaa-mm-dd. «Mês anterior» serve aos dois. */
export function periodFiltersFor(kind: "dia" | "mes" | "nenhum", period: ReportSchedulePeriod, now: number = Date.now()): { de?: string; ate?: string } {
  if (kind === "nenhum") return {};
  const f = periodFilters(period, now);
  if (kind === "mes") return { de: f.de?.slice(0, 7), ate: f.ate?.slice(0, 7) };
  return f;
}

/** Próximo envio estritamente depois de `after` (hora cheia, horário de Brasília). */
export function nextRunAt(s: Pick<ReportSchedule, "frequency" | "weekday" | "monthDay" | "hour">, after: number = Date.now()): string {
  const local = new Date(after - BRT_MS);
  const hour = Math.max(0, Math.min(23, Math.floor(s.hour)));
  const at = (y: number, mo: number, d: number) => Date.UTC(y, mo, d, hour) + BRT_MS;
  const y = local.getUTCFullYear();
  const mo = local.getUTCMonth();
  const d = local.getUTCDate();
  if (s.frequency === "mensal") {
    const day = Math.max(1, Math.min(28, s.monthDay ?? 1));
    let t = at(y, mo, day);
    if (t <= after) t = at(y, mo + 1, day);
    return new Date(t).toISOString();
  }
  for (let i = 0; i < 8; i += 1) {
    const t = at(y, mo, d + i);
    if (t <= after) continue;
    if (s.frequency === "semanal" && new Date(t - BRT_MS).getUTCDay() !== (s.weekday ?? 1)) continue;
    return new Date(t).toISOString();
  }
  return new Date(at(y, mo, d + 1)).toISOString();
}

/** «Toda segunda às 8h · últimos 7 dias». */
export function describeSchedule(s: Pick<ReportSchedule, "frequency" | "weekday" | "monthDay" | "hour" | "period">): string {
  const wd = s.weekday ?? 1;
  const when = s.frequency === "diaria" ? "Todo dia" : s.frequency === "semanal" ? `${wd === 0 || wd === 6 ? "Todo" : "Toda"} ${WEEKDAY_LABELS[wd]}` : `Todo dia ${s.monthDay ?? 1}`;
  return `${when} às ${s.hour}h · ${PERIOD_LABELS[s.period].toLowerCase()}`;
}
