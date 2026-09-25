import Link from "next/link";
import { Check, Circle, CircleDot } from "lucide-react";
import { DEPARTMENT_LABELS } from "@/domain/constants";
import { cn } from "@/lib/utils";
import type { InstanceDetail } from "./workflow-model";

export interface JourneyStepperProps {
  detail: InstanceDetail;
  selectedStepId?: string;
  className?: string;
}

/**
 * Stepper das etapas da jornada (concluída / atual / futura) com datas, responsável e duração.
 * Cada etapa instanciada é um link que seleciona o detalhe na página (?etapa=<stepId>).
 */
export function JourneyStepper({ detail, selectedStepId, className }: JourneyStepperProps) {
  const instantiated = new Map(detail.steps.map((s) => [s.step.stageKey, s]));
  const keys = detail.stages.length > 0 ? detail.stages.map((s) => ({ key: s.key, name: s.name, department: s.department })) : detail.steps.map((s) => ({ key: s.step.stageKey, name: s.step.stageName, department: s.step.department }));
  // Etapas de versões antigas que não estão mais no template ainda aparecem.
  for (const s of detail.steps) if (!keys.some((k) => k.key === s.step.stageKey)) keys.push({ key: s.step.stageKey, name: s.step.stageName, department: s.step.department });

  return (
    <ol className={cn("grid gap-2 md:grid-cols-3 xl:grid-cols-6", className)} aria-label="Etapas da jornada">
      {keys.map((stage, index) => {
        const view = instantiated.get(stage.key);
        const state = view?.state ?? "pending";
        const selected = view?.step.id === selectedStepId;
        const Icon = state === "done" ? Check : state === "current" ? CircleDot : Circle;
        const body = (
          <>
            <div className="flex items-center gap-2">
              <span
                className={cn(
                  "flex size-6 shrink-0 items-center justify-center rounded-full text-[11px] font-semibold [&_svg]:size-3.5",
                  state === "done" && "bg-success text-white",
                  state === "current" && "bg-brand text-white",
                  state === "pending" && "bg-surface-hover text-muted",
                )}
                aria-hidden
              >
                {state === "pending" ? index + 1 : <Icon />}
              </span>
              <span className={cn("truncate text-sm font-medium", state === "pending" ? "text-muted" : "text-foreground")}>{stage.name}</span>
            </div>
            <p className="mt-1 truncate text-[11px] text-muted">{DEPARTMENT_LABELS[stage.department]}</p>
            {view ? (
              <div className="mt-1.5 flex flex-col gap-0.5 text-[11px] text-muted">
                <span className="truncate">{view.step.assigneeName ?? "Sem responsável"}</span>
                <span className="truncate tabular-nums">
                  {view.startedAtLabel ?? "—"}
                  {view.completedAtLabel ? ` → ${view.completedAtLabel}` : ""}
                </span>
                {view.durationLabel ? <span className="truncate">{state === "current" ? "Há" : "Durou"} {view.durationLabel}{view.step.exceptionReason ? " · exceção" : ""}</span> : null}
              </div>
            ) : (
              <p className="mt-1.5 text-[11px] text-muted-light">Ainda não iniciada</p>
            )}
          </>
        );
        const cls = cn(
          "block min-w-0 rounded-lg border p-3 text-left transition-colors",
          state === "current" && "border-brand/50 bg-brand-soft/30",
          state === "done" && "border-border bg-surface",
          state === "pending" && "border-dashed border-border bg-surface-muted",
          selected && "ring-2 ring-brand/40",
          view && "hover:border-border-strong",
        );
        return (
          <li key={stage.key} aria-current={state === "current" ? "step" : undefined}>
            {view ? (
              <Link href={`/workflow/${detail.instance.id}?etapa=${view.step.id}`} scroll={false} className={cls}>
                {body}
              </Link>
            ) : (
              <div className={cls}>{body}</div>
            )}
          </li>
        );
      })}
    </ol>
  );
}
