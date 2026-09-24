/** Formatação específica do Suporte (segura para cliente e servidor). */

/** Prazo de uma regra de SLA: "15 min", "2 h úteis", "1 dia útil" (10 h úteis = 1 dia útil). */
export function formatSlaHours(hours: number | undefined, businessHoursOnly: boolean): string {
  if (hours === undefined) return "—";
  if (hours < 1) return `${Math.round(hours * 60)} min`;
  if (businessHoursOnly && hours >= 10 && hours % 10 === 0) {
    const days = hours / 10;
    return `${days} ${days === 1 ? "dia útil" : "dias úteis"}`;
  }
  return `${Number.isInteger(hours) ? hours : hours.toFixed(1).replace(".", ",")} h${businessHoursOnly ? " úteis" : ""}`;
}

/** Minutos como "45 min", "3h 20min" ou "2d 3h". */
export function formatMinutes(minutes: number | undefined): string {
  if (minutes === undefined || Number.isNaN(minutes)) return "—";
  const m = Math.round(minutes);
  if (m < 60) return `${m} min`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h}h ${String(m % 60).padStart(2, "0")}min`;
  return `${Math.floor(h / 24)}d ${h % 24}h`;
}

/** Horas como "5,2 h" ou "2d 3h". */
export function formatHoursShort(hours: number | undefined): string {
  if (hours === undefined || Number.isNaN(hours)) return "—";
  if (hours < 24) return `${hours.toFixed(1).replace(".", ",")} h`;
  return `${Math.floor(hours / 24)}d ${Math.round(hours % 24)}h`;
}

/** Duração de ligação em segundos: "6 min 20 s". */
export function formatCallDuration(seconds: number | undefined): string {
  if (!seconds) return "—";
  const m = Math.floor(seconds / 60);
  const s = seconds % 60;
  return m > 0 ? `${m} min${s ? ` ${s} s` : ""}` : `${s} s`;
}

/** Tom semântico de um percentual de cumprimento frente à meta (≥ meta verde; ≥ 90% da meta âmbar). */
export function complianceTone(value: number | undefined, target: number): "success" | "warning" | "danger" | "neutral" {
  if (value === undefined) return "neutral";
  if (value >= target) return "success";
  if (value >= target * 0.9) return "warning";
  return "danger";
}

/** Tom do CSAT frente à meta (0–10). */
export function csatTone(value: number | undefined, target: number): "success" | "warning" | "danger" | "neutral" {
  if (value === undefined) return "neutral";
  if (value >= target) return "success";
  if (value >= target - 1) return "warning";
  return "danger";
}
