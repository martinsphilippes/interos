/**
 * Rótulos e tons da aba Módulos ERP (módulo puro, usado pelos componentes da aba).
 */
import type { BadgeProps } from "@/components/ui/badge";
import type { ErpItemRole } from "@/domain/erp/catalog";
import type { StatusTone } from "@/domain/erp/status";
import type { ErpChangeStatus } from "@/domain/erp/types";

export type BadgeVariant = NonNullable<BadgeProps["variant"]>;

export const TONE_BADGE: Record<StatusTone, BadgeVariant> = {
  success: "success",
  info: "info",
  warning: "warning",
  danger: "danger",
  neutral: "default",
  muted: "muted",
};

export const ROLE_LABELS: Record<ErpItemRole, string> = {
  module: "Módulo",
  unit: "Contratável",
  included: "Incluído",
  core: "Plataforma",
  shared: "Recurso compartilhado",
  integration: "Integração",
  permission: "Permissão de perfil",
  future: "Futuro",
};

export const CHANGE_STATUS_BADGE: Record<ErpChangeStatus, BadgeVariant> = {
  aguardando_aprovacao: "warning",
  enviando: "info",
  falhou: "warning",
  aplicada: "success",
  recusada: "danger",
  conflito: "danger",
  cancelada: "muted",
};

const dateFmt = new Intl.DateTimeFormat("pt-BR", { day: "2-digit", month: "2-digit", year: "numeric", timeZone: "America/Sao_Paulo" });
const dateTimeFmt = new Intl.DateTimeFormat("pt-BR", { day: "2-digit", month: "2-digit", year: "numeric", hour: "2-digit", minute: "2-digit", timeZone: "America/Sao_Paulo" });

export function fmtDate(iso: string | null | undefined): string {
  if (!iso) return "—";
  const t = Date.parse(iso);
  return Number.isNaN(t) ? "—" : dateFmt.format(t);
}

export function fmtDateTime(iso: string | null | undefined): string {
  if (!iso) return "—";
  const t = Date.parse(iso);
  return Number.isNaN(t) ? "—" : dateTimeFmt.format(t);
}

const money = new Intl.NumberFormat("pt-BR", { style: "currency", currency: "BRL" });
const int = new Intl.NumberFormat("pt-BR");

/** Valores da Torre: centavos, quantidade, pontos-base (1% = 100) e milésimos (1 un. = 1000). */
export function fmtTower(value: number | null, unit: "centavos" | "quantidade" | "bps" | "milesimos" | "texto", text?: string | null): string {
  if (unit === "texto") return text ?? "—";
  if (value === null || value === undefined) return "—";
  if (unit === "centavos") return money.format(value / 100);
  if (unit === "bps") return `${(value / 100).toLocaleString("pt-BR", { maximumFractionDigits: 1 })}%`;
  if (unit === "milesimos") return int.format(Math.round(value / 1000));
  return int.format(value);
}

/** Data local (AAAA-MM-DD) para um `<input type="date">` → ISO no fim do dia em São Paulo. */
export function endOfDayIso(date: string): string {
  return `${date}T23:59:59-03:00`;
}

/** Início do dia em São Paulo (agendamentos "a partir de"). */
export function startOfDayIso(date: string): string {
  return `${date}T00:00:00-03:00`;
}
