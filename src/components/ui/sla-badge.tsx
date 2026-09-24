import { Timer } from "lucide-react";
import { SLA_STATE_LABELS, type SlaState } from "@/domain/constants";
import { Badge, type BadgeProps } from "./badge";
import { cn } from "@/lib/utils";

const stateVariant: Record<SlaState, NonNullable<BadgeProps["variant"]>> = {
  dentro_do_prazo: "success",
  em_atencao: "warning",
  em_risco: "danger",
  violado: "danger",
  pausado: "muted",
  concluido: "success",
};

/**
 * Formata tempo restante como "2h 15m", "3d 4h" ou "-1h 20m".
 * Espelha formatRemaining de src/server/sla.ts (que não pode ser importado no cliente por depender do firebase-admin).
 */
export function formatRemainingMs(ms: number): string {
  const sign = ms < 0 ? "-" : "";
  const abs = Math.abs(ms);
  const days = Math.floor(abs / 86_400_000);
  const hours = Math.floor((abs % 86_400_000) / 3_600_000);
  const minutes = Math.floor((abs % 3_600_000) / 60_000);
  if (days > 0) return `${sign}${days}d ${hours}h`;
  if (hours > 0) return `${sign}${hours}h ${minutes}m`;
  return `${sign}${minutes}m`;
}

export interface SlaBadgeProps {
  state: SlaState;
  remainingMs?: number;
  size?: BadgeProps["size"];
  /** Só o tempo, sem o rótulo do estado. */
  timeOnly?: boolean;
  className?: string;
}

export function SlaBadge({ state, remainingMs, size = "sm", timeOnly, className }: SlaBadgeProps) {
  const showTime = remainingMs !== undefined && state !== "concluido";
  const time = showTime ? formatRemainingMs(remainingMs) : null;
  const title = time ? `${SLA_STATE_LABELS[state]} · ${(remainingMs ?? 0) < 0 ? "atrasado" : "restam"} ${time}` : SLA_STATE_LABELS[state];
  return (
    <Badge variant={stateVariant[state]} size={size} className={cn("gap-1 tabular-nums", className)} title={title}>
      <Timer aria-hidden />
      {timeOnly && time ? time : SLA_STATE_LABELS[state]}
      {!timeOnly && time ? <span className="opacity-80">· {time}</span> : null}
    </Badge>
  );
}
