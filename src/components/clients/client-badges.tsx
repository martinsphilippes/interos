import { Badge, type BadgeProps } from "@/components/ui/badge";
import { StatusDot, type StatusTone } from "@/components/ui/status-dot";
import { UserChip } from "@/components/ui/user-chip";
import type { UserSummary } from "@/server/clients/queries";
import { CLIENT_STATUS_LABELS, type ClientStatus, type HealthLevel, type JourneyStage } from "@/domain/constants";
import { cn } from "@/lib/utils";

/** Rótulos curtos das etapas da jornada (barra de progresso, filtros, tabela). */
export const JOURNEY_STAGE_LABELS: Record<JourneyStage, string> = {
  marketing: "Marketing",
  vendas: "Vendas",
  financeiro: "Financeiro",
  implantacao: "Implantação",
  cs: "CS",
  suporte: "Suporte",
};

export const HEALTH_LABELS: Record<HealthLevel, string> = {
  saudavel: "Saudável",
  atencao: "Atenção",
  risco: "Risco",
};

const STATUS_VARIANT: Record<ClientStatus, NonNullable<BadgeProps["variant"]>> = {
  lead: "muted",
  prospect: "info",
  em_implantacao: "warning",
  ativo: "success",
  inativo: "outline",
  cancelado: "danger",
};

export function ClientStatusBadge({ status, size = "sm", className }: { status: ClientStatus; size?: BadgeProps["size"]; className?: string }) {
  return (
    <Badge variant={STATUS_VARIANT[status]} size={size} className={className}>
      {CLIENT_STATUS_LABELS[status]}
    </Badge>
  );
}

export function healthTone(level: HealthLevel | undefined): StatusTone {
  if (level === "saudavel") return "success";
  if (level === "atencao") return "warning";
  if (level === "risco") return "danger";
  return "muted";
}

export interface HealthIndicatorProps {
  score?: number;
  level?: HealthLevel;
  /** Mostra o rótulo ("Saudável") além do score. */
  showLabel?: boolean;
  className?: string;
}

/** Ponto colorido + score (0–100). Sem score (cliente não ativo) mostra "—". */
export function HealthIndicator({ score, level, showLabel, className }: HealthIndicatorProps) {
  if (score === undefined && !level) return <span className={cn("text-sm text-muted-light", className)}>—</span>;
  return (
    <StatusDot
      tone={healthTone(level)}
      pulse={level === "risco"}
      className={className}
      label={
        <span className="tabular-nums">
          {score !== undefined ? score : "—"}
          {showLabel && level ? <span className="ml-1 text-muted">{HEALTH_LABELS[level]}</span> : null}
        </span>
      }
    />
  );
}

export interface UserCellProps {
  users: Record<string, UserSummary>;
  id?: string;
  size?: "sm" | "md";
  /** Linha secundária (cargo) quando size="md". */
  withSubtitle?: boolean;
  className?: string;
}

/** Nome + avatar de um usuário a partir do mapa resolvido em lote; "—" quando não há responsável. */
export function UserCell({ users, id, size = "sm", withSubtitle, className }: UserCellProps) {
  if (!id) return <span className={cn("text-sm text-muted-light", className)}>—</span>;
  const user = users[id];
  if (!user) return <span className={cn("text-sm text-muted", className)}>{id}</span>;
  return <UserChip name={user.name} avatarUrl={user.avatarUrl} subtitle={withSubtitle ? user.jobTitle : undefined} size={size} className={className} />;
}

export function StageBadge({ stage, className }: { stage?: JourneyStage; className?: string }) {
  if (!stage) return <span className={cn("text-sm text-muted-light", className)}>—</span>;
  return (
    <Badge variant="outline" size="sm" className={className}>
      {JOURNEY_STAGE_LABELS[stage]}
    </Badge>
  );
}
