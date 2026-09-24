/**
 * Modelo de exibição das notificações (compartilhado entre servidor e cliente, sem dependências
 * de servidor). Rótulos de data são calculados no servidor, em America/Sao_Paulo, para não divergir
 * na hidratação.
 */
import type { NotificationKind } from "@/domain/constants";
import type { Notification } from "@/domain/types";

export interface NotificationItem {
  id: string;
  kind: NotificationKind;
  title: string;
  body?: string;
  href?: string;
  createdAt: string;
  readAt?: string;
  /** AAAA-MM-DD em São Paulo (agrupamento por dia). */
  dayKey: string;
  /** "Hoje" · "Ontem" · "22 set" · "22 set 2025". */
  dayLabel: string;
  /** "14:32". */
  timeLabel: string;
  /** "há 5 min" · "há 3 h" · "há 2 dias". */
  relativeLabel: string;
}

export const NOTIFICATION_KIND_LABELS: Record<NotificationKind, string> = {
  informativa: "Informativa",
  acao: "Ação",
  atencao: "Atenção",
  critica: "Crítica",
};

const TZ = "America/Sao_Paulo";
const keyFormat = new Intl.DateTimeFormat("en-CA", { timeZone: TZ, year: "numeric", month: "2-digit", day: "2-digit" });
const timeFormat = new Intl.DateTimeFormat("pt-BR", { timeZone: TZ, hour: "2-digit", minute: "2-digit" });
const MONTHS_SHORT = ["jan", "fev", "mar", "abr", "mai", "jun", "jul", "ago", "set", "out", "nov", "dez"];

function dayKeyOf(iso: string): string {
  return keyFormat.format(new Date(iso));
}

function shiftKey(key: string, days: number): string {
  const [y, m, d] = key.split("-").map(Number);
  return new Date(Date.UTC(y, m - 1, d + days)).toISOString().slice(0, 10);
}

export function dayLabelOf(key: string, today: string): string {
  if (key === today) return "Hoje";
  if (key === shiftKey(today, -1)) return "Ontem";
  const [y, m, d] = key.split("-").map(Number);
  return `${d} ${MONTHS_SHORT[m - 1]}${String(y) !== today.slice(0, 4) ? ` ${y}` : ""}`;
}

export function relativeLabelOf(iso: string, now: Date): string {
  const ms = Math.max(0, now.getTime() - new Date(iso).getTime());
  const minutes = Math.floor(ms / 60_000);
  if (minutes < 1) return "agora";
  if (minutes < 60) return `há ${minutes} min`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `há ${hours} h`;
  const days = Math.floor(hours / 24);
  if (days < 7) return `há ${days} dia${days === 1 ? "" : "s"}`;
  const weeks = Math.floor(days / 7);
  if (weeks < 5) return `há ${weeks} semana${weeks === 1 ? "" : "s"}`;
  const months = Math.floor(days / 30);
  return `há ${months} ${months === 1 ? "mês" : "meses"}`;
}

export function toNotificationItem(n: Notification, now: Date = new Date()): NotificationItem {
  const today = dayKeyOf(now.toISOString());
  const dayKey = dayKeyOf(n.createdAt);
  return {
    id: n.id,
    kind: n.kind,
    title: n.title,
    body: n.body,
    href: n.href,
    createdAt: n.createdAt,
    readAt: n.readAt,
    dayKey,
    dayLabel: dayLabelOf(dayKey, today),
    timeLabel: timeFormat.format(new Date(n.createdAt)),
    relativeLabel: relativeLabelOf(n.createdAt, now),
  };
}

export interface NotificationDayGroup {
  dayKey: string;
  dayLabel: string;
  items: NotificationItem[];
}

/** Agrupa por dia preservando a ordem recebida (mais recentes primeiro). */
export function groupByDay(items: NotificationItem[]): NotificationDayGroup[] {
  const groups: NotificationDayGroup[] = [];
  for (const item of items) {
    const last = groups[groups.length - 1];
    if (last && last.dayKey === item.dayKey) last.items.push(item);
    else groups.push({ dayKey: item.dayKey, dayLabel: item.dayLabel, items: [item] });
  }
  return groups;
}
