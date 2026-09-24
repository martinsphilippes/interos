"use client";

import { AlertTriangle, Hourglass, ShieldCheck } from "lucide-react";
import { Avatar } from "@/components/ui/avatar";
import { cn } from "@/lib/utils";
import type { StepCardItem } from "./workflow-model";
import { AssigneeLabel, ChecklistIndicator, DaysInStage, SlaCountdown } from "./step-bits";

export interface StepCardProps {
  item: StepCardItem;
  currentUserId: string;
  onOpen: (stepId: string) => void;
  className?: string;
}

/** Card de uma jornada na coluna da etapa. Clique abre o drawer da etapa (?etapa=<id>). */
export function StepCard({ item, currentUserId, onOpen, className }: StepCardProps) {
  const mine = item.assigneeId === currentUserId;
  const risky = item.sla?.state === "em_risco" || item.sla?.state === "violado";
  return (
    <button
      type="button"
      onClick={() => onOpen(item.id)}
      aria-label={`Abrir etapa ${item.stageName} de ${item.clientName}`}
      className={cn(
        "group flex w-full min-h-[44px] flex-col gap-2 rounded-lg border bg-surface p-3 text-left shadow-card transition-colors hover:border-border-strong hover:bg-surface-muted focus-visible:outline-brand",
        risky ? "border-danger/40" : "border-border",
        mine && "ring-1 ring-brand/20",
        className,
      )}
    >
      <div className="flex items-start justify-between gap-2">
        <p className="min-w-0 flex-1 truncate text-sm font-medium leading-tight text-foreground">{item.clientName}</p>
        <span className="flex shrink-0 items-center gap-1 text-muted">
          {item.status === "aguardando_cliente" ? <Hourglass className="size-4 text-warning-fg" aria-label="Aguardando cliente" /> : null}
          {item.status === "aguardando_aprovacao" ? <ShieldCheck className="size-4 text-info-fg" aria-label="Aguardando aprovação" /> : null}
          {item.exceptionReason ? <AlertTriangle className="size-4 text-warning-fg" aria-label="Concluída por exceção" /> : null}
        </span>
      </div>
      <div className="flex items-center gap-2">
        {item.assigneeName ? <Avatar name={item.assigneeName} src={item.assigneeAvatarUrl} size="xs" /> : null}
        <AssigneeLabel name={item.assigneeName} className="min-w-0 flex-1" />
      </div>
      <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
        {item.sla ? <SlaCountdown state={item.sla.state} dueAt={item.dueAt} remainingMs={item.sla.remainingMs} timeOnly /> : <span className="text-xs text-muted-light">Sem SLA</span>}
        <DaysInStage days={item.daysInStage} />
        <ChecklistIndicator done={item.checklistDone} total={item.checklistTotal} />
      </div>
      {item.waitingClientReason ? <p className="line-clamp-2 text-xs text-warning-fg">{item.waitingClientReason}</p> : null}
    </button>
  );
}
