"use client";

import * as React from "react";
import { CheckCircle2, Clock, Hourglass, ListChecks, ShieldCheck, UserRound } from "lucide-react";
import { DEPARTMENT_LABELS, WORKFLOW_STEP_STATUS_LABELS, type DepartmentKey, type SlaState, type WorkflowStepStatus } from "@/domain/constants";
import { Badge, type BadgeProps } from "@/components/ui/badge";
import { SlaBadge, formatRemainingMs } from "@/components/ui/sla-badge";
import { cn } from "@/lib/utils";

/** Peças pequenas compartilhadas entre kanban, lista, drawer e página da jornada. */

const STATUS_VARIANT: Record<WorkflowStepStatus, NonNullable<BadgeProps["variant"]>> = {
  pendente: "muted",
  em_andamento: "brand",
  aguardando_cliente: "warning",
  aguardando_aprovacao: "info",
  concluida: "success",
  pulada: "muted",
};

const STATUS_ICON: Partial<Record<WorkflowStepStatus, React.ComponentType<{ className?: string }>>> = {
  aguardando_cliente: Hourglass,
  aguardando_aprovacao: ShieldCheck,
  concluida: CheckCircle2,
};

export function StepStatusBadge({ status, size = "sm", className }: { status: WorkflowStepStatus; size?: BadgeProps["size"]; className?: string }) {
  const Icon = STATUS_ICON[status];
  return (
    <Badge variant={STATUS_VARIANT[status]} size={size} className={className}>
      {Icon ? <Icon /> : null}
      {WORKFLOW_STEP_STATUS_LABELS[status]}
    </Badge>
  );
}

export function DepartmentBadge({ department, size = "sm", className }: { department: DepartmentKey; size?: BadgeProps["size"]; className?: string }) {
  return (
    <Badge variant="outline" size={size} className={className}>
      {DEPARTMENT_LABELS[department]}
    </Badge>
  );
}

export function ChecklistIndicator({ done, total, className }: { done: number; total: number; className?: string }) {
  if (total === 0) return null;
  const complete = done === total;
  return (
    <span className={cn("inline-flex items-center gap-1 whitespace-nowrap text-xs tabular-nums", complete ? "text-success-fg" : "text-muted", className)} title="Checklist do gate">
      <ListChecks className="size-3.5" aria-hidden />
      {done}/{total}
    </span>
  );
}

export function DaysInStage({ days, className }: { days: number; className?: string }) {
  return (
    <span className={cn("inline-flex items-center gap-1 whitespace-nowrap text-xs tabular-nums text-muted", className)} title="Dias na etapa">
      <Clock className="size-3.5" aria-hidden />
      {days === 0 ? "hoje" : `${days} dia${days === 1 ? "" : "s"}`}
    </span>
  );
}

export function AssigneeLabel({ name, className }: { name?: string; className?: string }) {
  return (
    <span className={cn("inline-flex min-w-0 items-center gap-1 text-xs", name ? "text-foreground" : "text-danger-fg", className)}>
      <UserRound className="size-3.5 shrink-0 text-muted" aria-hidden />
      <span className="truncate">{name ?? "Sem responsável"}</span>
    </span>
  );
}

/**
 * Contagem regressiva do SLA calculada no cliente a partir de `dueAt`. O primeiro render usa o valor
 * vindo do servidor (sem divergência na hidratação); depois atualiza a cada 30s.
 */
export function SlaCountdown({ state, dueAt, remainingMs, size = "sm", timeOnly, className }: { state: SlaState; dueAt?: string; remainingMs: number; size?: BadgeProps["size"]; timeOnly?: boolean; className?: string }) {
  const [remaining, setRemaining] = React.useState(remainingMs);
  React.useEffect(() => {
    if (!dueAt || state === "pausado" || state === "concluido") return;
    const tick = () => setRemaining(new Date(dueAt).getTime() - Date.now());
    tick();
    const id = window.setInterval(tick, 30_000);
    return () => window.clearInterval(id);
  }, [dueAt, state]);
  const liveState: SlaState = state === "pausado" || state === "concluido" ? state : remaining < 0 ? "violado" : state;
  return <SlaBadge state={liveState} remainingMs={remaining} size={size} timeOnly={timeOnly} className={className} />;
}

export { formatRemainingMs };
