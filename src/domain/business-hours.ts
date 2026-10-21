/**
 * Expediente da empresa (setting horario_comercial + feriados) para as mensagens automáticas da Central: «estamos
 * fora do horário» e «respondemos a partir de …». Fuso America/Sao_Paulo aproximado por UTC-3 (o mesmo do SLA).
 * Puro: sem servidor.
 */
export interface BusinessHours {
  /** Hora de abertura (0–23). */
  inicio: number;
  /** Hora de fechamento (1–24). */
  fim: number;
  /** Dias da semana abertos (0 = domingo … 6 = sábado). */
  dias: number[];
}

export const DEFAULT_BUSINESS_HOURS: BusinessHours = { inicio: 8, fim: 18, dias: [1, 2, 3, 4, 5] };

const OFFSET_MS = -3 * 3600_000;
const WEEKDAYS = ["domingo", "segunda", "terça", "quarta", "quinta", "sexta", "sábado"];

function local(date: Date): Date {
  return new Date(date.getTime() + OFFSET_MS);
}

function dayKey(l: Date): string {
  return l.toISOString().slice(0, 10);
}

function openDay(l: Date, hours: BusinessHours, holidays: ReadonlySet<string>): boolean {
  return hours.dias.includes(l.getUTCDay()) && !holidays.has(dayKey(l));
}

/** A empresa está atendendo agora? */
export function isBusinessOpen(at: Date, hours: BusinessHours = DEFAULT_BUSINESS_HOURS, holidays: ReadonlySet<string> = new Set()): boolean {
  const l = local(at);
  const h = l.getUTCHours() + l.getUTCMinutes() / 60;
  return openDay(l, hours, holidays) && h >= hours.inicio && h < hours.fim;
}

/** Próxima abertura em texto ("hoje às 8h", "amanhã às 8h", "segunda às 8h", "12/11 às 8h"). */
export function nextOpeningLabel(at: Date, hours: BusinessHours = DEFAULT_BUSINESS_HOURS, holidays: ReadonlySet<string> = new Set()): string {
  const l = local(at);
  const today = dayKey(l);
  const h = l.getUTCHours() + l.getUTCMinutes() / 60;
  for (let i = 0; i < 15; i++) {
    const d = new Date(Date.UTC(l.getUTCFullYear(), l.getUTCMonth(), l.getUTCDate() + i));
    if (!openDay(d, hours, holidays)) continue;
    if (i === 0 && h >= hours.inicio) continue;
    const time = `${hours.inicio}h`;
    if (dayKey(d) === today) return `hoje às ${time}`;
    if (i === 1) return `amanhã às ${time}`;
    if (i < 7) return `${WEEKDAYS[d.getUTCDay()]} às ${time}`;
    return `${String(d.getUTCDate()).padStart(2, "0")}/${String(d.getUTCMonth() + 1).padStart(2, "0")} às ${time}`;
  }
  return "o próximo dia útil";
}
