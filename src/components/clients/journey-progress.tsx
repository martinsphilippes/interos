import Link from "next/link";
import { Check } from "lucide-react";
import type { WorkflowStep } from "@/domain/types";
import { JOURNEY_STAGES, WORKFLOW_STEP_STATUS_LABELS, type JourneyStage } from "@/domain/constants";
import { formatRelative } from "@/lib/format";
import { cn } from "@/lib/utils";
import { JOURNEY_STAGE_LABELS } from "./client-badges";

export interface JourneyProgressProps {
  currentStage?: JourneyStage;
  /** Instância da jornada: cada etapa vira link para /workflow/<instanceId>. */
  instanceId?: string;
  steps?: WorkflowStep[];
  compact?: boolean;
  className?: string;
}

type StageState = "done" | "current" | "pending";

/** Barra com as 6 etapas da jornada do cliente, destacando a atual. */
export function JourneyProgress({ currentStage, instanceId, steps = [], compact, className }: JourneyProgressProps) {
  const currentIdx = currentStage ? JOURNEY_STAGES.indexOf(currentStage) : -1;
  const href = instanceId ? `/workflow/${instanceId}` : null;

  return (
    <ol className={cn("grid grid-cols-6 gap-1", className)} aria-label="Etapas da jornada do cliente">
      {JOURNEY_STAGES.map((stage, idx) => {
        const step = steps.find((s) => s.stageKey === stage);
        const state: StageState = stage === currentStage ? "current" : step?.status === "concluida" || step?.status === "pulada" || idx < currentIdx ? "done" : "pending";
        const caption =
          state === "current" && step
            ? WORKFLOW_STEP_STATUS_LABELS[step.status]
            : state === "done" && step?.completedAt
              ? `Concluída ${formatRelative(step.completedAt)}`
              : state === "pending"
                ? "Pendente"
                : undefined;
        const title = [JOURNEY_STAGE_LABELS[stage], caption, step?.assigneeName ? `Responsável: ${step.assigneeName}` : null].filter(Boolean).join(" · ");

        const inner = (
          <>
            <span
              className={cn(
                "block h-1.5 w-full rounded-full transition-colors",
                state === "done" && "bg-success",
                state === "current" && "bg-brand",
                state === "pending" && "bg-border",
                href && "group-hover/stage:opacity-80",
              )}
            />
            <span className={cn("mt-1.5 flex items-center gap-1 truncate text-[11px] font-medium leading-none md:text-xs", state === "current" ? "text-brand-fg" : state === "done" ? "text-foreground" : "text-muted")}>
              {state === "done" ? <Check className="size-3 shrink-0 text-success" aria-hidden /> : null}
              <span className="truncate">{JOURNEY_STAGE_LABELS[stage]}</span>
            </span>
            {!compact && caption ? <span className="mt-0.5 hidden truncate text-[11px] text-muted md:block">{caption}</span> : null}
          </>
        );

        return (
          <li key={stage} className="min-w-0" aria-current={state === "current" ? "step" : undefined}>
            {href ? (
              <Link href={href} title={title} className="group/stage block min-w-0 rounded-md py-1 focus-visible:outline-brand">
                {inner}
              </Link>
            ) : (
              <span title={title} className="block min-w-0 py-1">
                {inner}
              </span>
            )}
          </li>
        );
      })}
    </ol>
  );
}
