import * as React from "react";
import { Badge } from "@/components/ui/badge";
import { UserChip } from "@/components/ui/user-chip";
import { HealthIndicator } from "@/components/clients/client-badges";
import type { HealthLevel } from "@/domain/constants";
import { HEALTH_LEVEL_LABELS, HEALTH_LEVEL_VARIANT } from "@/server/cs/schemas";
import { cn } from "@/lib/utils";

/** Componentes pequenos (sem estado) compartilhados pelas telas de Customer Success. */

export { HealthIndicator };

export interface OwnerLite {
  id: string;
  name: string;
  avatarUrl?: string;
  jobTitle?: string;
}

export function OwnerCell({ owner, className }: { owner?: OwnerLite; className?: string }) {
  if (!owner) return <span className={cn("text-sm text-muted-light", className)}>—</span>;
  return <UserChip name={owner.name} avatarUrl={owner.avatarUrl} size="sm" className={className} />;
}

export function LevelBadge({ level, size = "sm" }: { level?: HealthLevel; size?: "sm" | "md" }) {
  if (!level) return <Badge variant="muted" size={size}>Sem cálculo</Badge>;
  return (
    <Badge variant={HEALTH_LEVEL_VARIANT[level]} size={size}>
      {HEALTH_LEVEL_LABELS[level]}
    </Badge>
  );
}

/** Tempo de relacionamento desde a ativação: "3 meses", "1 ano e 2 meses". */
export function relationshipLabel(activatedAt: string | undefined, now: Date = new Date()): string {
  if (!activatedAt) return "—";
  const start = new Date(activatedAt);
  let months = (now.getFullYear() - start.getFullYear()) * 12 + (now.getMonth() - start.getMonth());
  if (now.getDate() < start.getDate()) months -= 1;
  if (months <= 0) {
    const days = Math.max(0, Math.floor((now.getTime() - start.getTime()) / 86_400_000));
    return days === 1 ? "1 dia" : `${days} dias`;
  }
  const years = Math.floor(months / 12);
  const rest = months % 12;
  const y = years === 1 ? "1 ano" : `${years} anos`;
  const m = rest === 1 ? "1 mês" : `${rest} meses`;
  if (years === 0) return m;
  return rest === 0 ? y : `${y} e ${m}`;
}

/** Dias restantes até uma data com cor semântica (vermelho ≤ 30, âmbar ≤ 60). */
export function DaysLeftBadge({ days }: { days: number }) {
  if (days < 0) return <Badge variant="danger" size="sm">Venceu há {-days} dia(s)</Badge>;
  const variant = days <= 30 ? "danger" : days <= 60 ? "warning" : "muted";
  return (
    <Badge variant={variant} size="sm" className="tabular-nums">
      {days === 0 ? "Hoje" : `${days} dia(s)`}
    </Badge>
  );
}

/** Lista compacta de chips (produtos, motivos). Mostra os N primeiros e "+X". */
export function ChipList({ items, max = 3, variant = "outline" }: { items: string[]; max?: number; variant?: "outline" | "muted" | "warning" | "danger" }) {
  if (items.length === 0) return <span className="text-sm text-muted-light">—</span>;
  const shown = items.slice(0, max);
  return (
    <span className="flex flex-wrap gap-1">
      {shown.map((item) => (
        <Badge key={item} variant={variant} size="sm" className="max-w-[180px] truncate" title={item}>
          {item}
        </Badge>
      ))}
      {items.length > max ? (
        <Badge variant="muted" size="sm" title={items.slice(max).join(", ")}>
          +{items.length - max}
        </Badge>
      ) : null}
    </span>
  );
}
