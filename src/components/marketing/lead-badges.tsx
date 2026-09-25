import { Flame, Snowflake, ThermometerSun } from "lucide-react";
import type { Campaign, LeadStatus, LeadTemperature, Prospect } from "@/domain/types";
import { Badge, type BadgeProps } from "@/components/ui/badge";
import { cn } from "@/lib/utils";
import { CAMPAIGN_STATUS_LABELS, LEAD_STATUS_LABELS, PROSPECT_STATUS_LABELS, TEMPERATURE_LABELS } from "./marketing-model";

type Variant = NonNullable<BadgeProps["variant"]>;

const TEMPERATURE_VARIANT: Record<LeadTemperature, Variant> = { quente: "danger", morno: "warning", frio: "info" };
const TEMPERATURE_ICON = { quente: Flame, morno: ThermometerSun, frio: Snowflake } as const;

export function TemperatureBadge({ temperature, size = "sm", className }: { temperature: LeadTemperature; size?: BadgeProps["size"]; className?: string }) {
  const Icon = TEMPERATURE_ICON[temperature];
  return (
    <Badge variant={TEMPERATURE_VARIANT[temperature]} size={size} className={className}>
      <Icon aria-hidden />
      {TEMPERATURE_LABELS[temperature]}
    </Badge>
  );
}

const STATUS_VARIANT: Record<LeadStatus, Variant> = { novo: "info", em_contato: "brand", qualificado: "success", convertido: "success", desqualificado: "muted" };

export function LeadStatusBadge({ status, size = "sm" }: { status: LeadStatus; size?: BadgeProps["size"] }) {
  return (
    <Badge variant={STATUS_VARIANT[status]} size={size}>
      {LEAD_STATUS_LABELS[status]}
    </Badge>
  );
}

/** Score numérico com cor pela temperatura (a cor nunca é a única pista: o número está sempre visível). */
export function ScorePill({ score, temperature, className }: { score: number; temperature: LeadTemperature; className?: string }) {
  return (
    <span
      className={cn(
        "inline-flex h-6 min-w-9 items-center justify-center rounded-md px-1.5 text-xs font-semibold tabular-nums",
        temperature === "quente" ? "bg-danger-soft text-danger-fg" : temperature === "morno" ? "bg-warning-soft text-warning-fg" : "bg-info-soft text-info-fg",
        className,
      )}
      title={`Score ${score} (${TEMPERATURE_LABELS[temperature].toLowerCase()})`}
    >
      {score}
    </span>
  );
}

const CAMPAIGN_VARIANT: Record<Campaign["status"], Variant> = { ativa: "success", planejada: "info", pausada: "warning", encerrada: "muted" };

export function CampaignStatusBadge({ status }: { status: Campaign["status"] }) {
  return (
    <Badge variant={CAMPAIGN_VARIANT[status]} size="sm">
      {CAMPAIGN_STATUS_LABELS[status]}
    </Badge>
  );
}

const PROSPECT_VARIANT: Record<Prospect["status"], Variant> = { novo: "info", tentativa: "warning", contatado: "brand", respondeu: "success", convertido: "success", descartado: "muted" };

export function ProspectStatusBadge({ status }: { status: Prospect["status"] }) {
  return (
    <Badge variant={PROSPECT_VARIANT[status]} size="sm">
      {PROSPECT_STATUS_LABELS[status]}
    </Badge>
  );
}
