import { format, formatDistanceToNowStrict, isToday, isTomorrow, isYesterday, parseISO } from "date-fns";
import { ptBR } from "date-fns/locale";

const currency = new Intl.NumberFormat("pt-BR", { style: "currency", currency: "BRL" });
const compactCurrency = new Intl.NumberFormat("pt-BR", { style: "currency", currency: "BRL", notation: "compact", maximumFractionDigits: 1 });
const number = new Intl.NumberFormat("pt-BR");
const percent = new Intl.NumberFormat("pt-BR", { style: "percent", maximumFractionDigits: 1 });

export function formatCurrency(value: number | undefined | null, compact = false): string {
  if (value === undefined || value === null || Number.isNaN(value)) return "—";
  return compact ? compactCurrency.format(value) : currency.format(value);
}

export function formatNumber(value: number | undefined | null): string {
  if (value === undefined || value === null || Number.isNaN(value)) return "—";
  return number.format(value);
}

/** Recebe fração (0.85) e devolve "85%". */
export function formatPercent(value: number | undefined | null): string {
  if (value === undefined || value === null || Number.isNaN(value)) return "—";
  return percent.format(value);
}

function toDate(value: string | Date | undefined | null): Date | null {
  if (!value) return null;
  const d = typeof value === "string" ? parseISO(value) : value;
  return Number.isNaN(d.getTime()) ? null : d;
}

export function formatDate(value: string | Date | undefined | null, pattern = "dd/MM/yyyy"): string {
  const d = toDate(value);
  return d ? format(d, pattern, { locale: ptBR }) : "—";
}

export function formatDateTime(value: string | Date | undefined | null): string {
  return formatDate(value, "dd/MM/yyyy HH:mm");
}

export function formatTime(value: string | Date | undefined | null): string {
  return formatDate(value, "HH:mm");
}

/** "hoje", "amanhã", "ontem" ou data curta. */
export function formatDay(value: string | Date | undefined | null): string {
  const d = toDate(value);
  if (!d) return "—";
  if (isToday(d)) return "Hoje";
  if (isTomorrow(d)) return "Amanhã";
  if (isYesterday(d)) return "Ontem";
  return format(d, "dd MMM", { locale: ptBR });
}

/** "há 3 horas", "em 2 dias". */
export function formatRelative(value: string | Date | undefined | null): string {
  const d = toDate(value);
  if (!d) return "—";
  return formatDistanceToNowStrict(d, { addSuffix: true, locale: ptBR });
}

export function initials(name: string | undefined | null): string {
  if (!name) return "?";
  const parts = name.trim().split(/\s+/);
  return ((parts[0]?.[0] ?? "") + (parts.length > 1 ? parts[parts.length - 1][0] : "")).toUpperCase();
}

export function formatDocument(value: string | undefined | null): string {
  if (!value) return "—";
  const digits = value.replace(/\D/g, "");
  if (digits.length === 14) return digits.replace(/(\d{2})(\d{3})(\d{3})(\d{4})(\d{2})/, "$1.$2.$3/$4-$5");
  if (digits.length === 11) return digits.replace(/(\d{3})(\d{3})(\d{3})(\d{2})/, "$1.$2.$3-$4");
  return value;
}

export function formatPhone(value: string | undefined | null): string {
  if (!value) return "—";
  const digits = value.replace(/\D/g, "");
  if (digits.length === 11) return digits.replace(/(\d{2})(\d{5})(\d{4})/, "($1) $2-$3");
  if (digits.length === 10) return digits.replace(/(\d{2})(\d{4})(\d{4})/, "($1) $2-$3");
  return value;
}

/** Competência AAAA-MM da data (padrão: hoje). */
export function competence(value?: string | Date): string {
  const d = toDate(value ?? new Date()) ?? new Date();
  return format(d, "yyyy-MM");
}

export function formatCompetence(value: string): string {
  const [y, m] = value.split("-");
  const d = new Date(Number(y), Number(m) - 1, 1);
  return format(d, "MMM/yyyy", { locale: ptBR });
}

/** Formata tempo restante em ms como "2h 15m", "3d 4h" ou "-1h 20m" (negativo = vencido). Seguro para o cliente. */
export function formatRemaining(ms: number): string {
  const sign = ms < 0 ? "-" : "";
  const abs = Math.abs(ms);
  const days = Math.floor(abs / 86_400_000);
  const hours = Math.floor((abs % 86_400_000) / 3_600_000);
  const minutes = Math.floor((abs % 3_600_000) / 60_000);
  if (days > 0) return `${sign}${days}d ${hours}h`;
  if (hours > 0) return `${sign}${hours}h ${minutes}m`;
  return `${sign}${minutes}m`;
}
