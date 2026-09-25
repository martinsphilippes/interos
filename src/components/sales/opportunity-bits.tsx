import { AlertTriangle, CalendarClock, FileText } from "lucide-react";
import type { Opportunity, Proposal } from "@/domain/types";
import { Badge } from "@/components/ui/badge";
import { StatusDot } from "@/components/ui/status-dot";
import { formatCurrency, formatDay, formatTime } from "@/lib/format";
import { cn } from "@/lib/utils";
import { OPPORTUNITY_STAGE_LABELS, OPPORTUNITY_STAGE_VARIANT, PROPOSAL_STATUS_LABELS, PROPOSAL_STATUS_VARIANT, TEMPERATURE_LABELS, TEMPERATURE_TONE } from "./model";

/** Peças pequenas compartilhadas por pipeline, tabela, Central e drawer (sem estado). */

export function TemperatureDot({ temperature, withLabel = true, className }: { temperature: Opportunity["temperature"]; withLabel?: boolean; className?: string }) {
  return <StatusDot tone={TEMPERATURE_TONE[temperature]} label={withLabel ? TEMPERATURE_LABELS[temperature] : undefined} pulse={temperature === "quente" && !withLabel} className={className} />;
}

export function StageBadge({ stage, label, size = "sm" }: { stage: Opportunity["stage"]; label?: string; size?: "sm" | "md" }) {
  return (
    <Badge variant={OPPORTUNITY_STAGE_VARIANT[stage]} size={size}>
      {label ?? OPPORTUNITY_STAGE_LABELS[stage]}
    </Badge>
  );
}

export function ProposalStatusBadge({ status, size = "sm" }: { status: Proposal["status"]; size?: "sm" | "md" }) {
  return (
    <Badge variant={PROPOSAL_STATUS_VARIANT[status]} size={size}>
      {PROPOSAL_STATUS_LABELS[status]}
    </Badge>
  );
}

/** Próxima ação com data: vermelho quando vencida; destaque "SEM PRÓXIMA AÇÃO" quando ausente. */
export function NextActionLabel({ opp, className, compact }: { opp: Pick<Opportunity, "nextAction" | "nextActionAt" | "stage">; className?: string; compact?: boolean }) {
  if (opp.stage === "ganho" || opp.stage === "perdido") return null;
  if (!opp.nextActionAt) {
    return (
      <span className={cn("inline-flex items-center gap-1 rounded-sm bg-danger-soft px-1.5 py-0.5 text-[11px] font-bold uppercase tracking-wide text-danger-fg", className)}>
        <AlertTriangle className="size-3" aria-hidden />
        Sem próxima ação
      </span>
    );
  }
  const overdue = opp.nextActionAt < new Date().toISOString();
  return (
    <span className={cn("inline-flex min-w-0 items-center gap-1 text-xs", overdue ? "font-medium text-danger-fg" : "text-muted", className)} title={overdue ? "Próxima ação vencida" : undefined}>
      <CalendarClock className="size-3.5 shrink-0" aria-hidden />
      <span className="shrink-0 tabular-nums">
        {formatDay(opp.nextActionAt)} {formatTime(opp.nextActionAt)}
      </span>
      {!compact && opp.nextAction ? <span className="truncate">· {opp.nextAction}</span> : null}
    </span>
  );
}

/** "R$ 350/mês + R$ 1.500 adesão (+ hardware)". */
export function ValueLine({ opp, className }: { opp: Pick<Opportunity, "monthlyTotal" | "setupTotal" | "hardwareTotal">; className?: string }) {
  const parts = [
    opp.monthlyTotal > 0 ? `${formatCurrency(opp.monthlyTotal)}/mês` : null,
    opp.setupTotal > 0 ? `${formatCurrency(opp.setupTotal)} adesão` : null,
    opp.hardwareTotal > 0 ? `${formatCurrency(opp.hardwareTotal)} hardware` : null,
  ].filter(Boolean);
  return <span className={cn("tabular-nums", className)}>{parts.length > 0 ? parts.join(" + ") : "Sem valor"}</span>;
}

export function ProposalIcon({ status }: { status?: Proposal["status"] }) {
  if (!status) return null;
  return (
    <span className="inline-flex items-center gap-0.5 text-xs text-secondary" title={`Proposta: ${PROPOSAL_STATUS_LABELS[status]}`}>
      <FileText className="size-3.5" aria-hidden />
      <span className="sr-only">Proposta {PROPOSAL_STATUS_LABELS[status]}</span>
    </span>
  );
}
