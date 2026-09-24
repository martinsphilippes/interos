import { History } from "lucide-react";
import { displayGateValue } from "@/server/workflow/gates";
import { EmptyState } from "@/components/ui/empty-state";
import { cn } from "@/lib/utils";
import type { InstanceDetail, StepEventView } from "./workflow-model";

/** Dados de gate preenchidos (gateData) das etapas concluídas, com rótulos vindos do template. */
export function GateDataPanel({ detail, className }: { detail: InstanceDetail; className?: string }) {
  const entries = Object.entries(detail.instance.gateData ?? {});
  const done = detail.steps.filter((s) => s.state === "done");
  if (done.length === 0) return <p className="text-sm text-muted">Nenhuma etapa concluída ainda.</p>;
  return (
    <div className={cn("flex flex-col gap-4", className)}>
      {done.map((view) => {
        const stage = view.stage;
        const data = entries.find(([key]) => key === view.step.stageKey)?.[1] ?? view.step.fields ?? {};
        const fields = stage?.gate.requiredFields ?? [];
        const extra = Object.keys(data).filter((k) => !fields.some((f) => f.path === k));
        return (
          <section key={view.step.id} className="rounded-lg border border-border bg-surface p-3">
            <div className="flex flex-wrap items-baseline justify-between gap-2">
              <h3 className="text-sm font-semibold">
                {view.step.stageName} · {stage?.gate.name ?? "Gate"}
              </h3>
              <span className="text-xs text-muted">
                Concluída por {view.step.assigneeName ?? "—"} {view.completedAtLabel ? `em ${view.completedAtLabel}` : ""}
              </span>
            </div>
            {view.step.exceptionReason ? <p className="mt-1 text-xs text-warning-fg">Concluída por exceção: {view.step.exceptionReason}</p> : null}
            {fields.length === 0 && extra.length === 0 ? (
              <p className="mt-2 text-xs text-muted">Sem campos de gate nesta etapa.</p>
            ) : (
              <dl className="mt-2 grid gap-x-4 gap-y-1.5 text-sm sm:grid-cols-2">
                {fields.map((f) => (
                  <div key={f.path} className="flex flex-col">
                    <dt className="text-xs text-muted">{f.label}</dt>
                    <dd className="truncate text-foreground" title={displayGateValue(data[f.path], f.type)}>
                      {displayGateValue(data[f.path], f.type)}
                    </dd>
                  </div>
                ))}
                {extra.map((k) => (
                  <div key={k} className="flex flex-col">
                    <dt className="text-xs text-muted">{k}</dt>
                    <dd className="truncate text-foreground">{displayGateValue(data[k], "texto")}</dd>
                  </div>
                ))}
              </dl>
            )}
          </section>
        );
      })}
    </div>
  );
}

/** Linha do tempo dos eventos de workflow/SLA do cliente (mais recentes primeiro). */
export function WorkflowTimeline({ events, className }: { events: StepEventView[]; className?: string }) {
  if (events.length === 0) return <EmptyState size="sm" icon={<History />} title="Nenhum evento de workflow" description="Os eventos aparecem aqui conforme a jornada avança." />;
  return (
    <ol className={cn("relative flex flex-col gap-3 border-l border-border pl-4", className)} aria-label="Linha do tempo do workflow">
      {events.map((e) => (
        <li key={e.id} className="relative">
          <span className={cn("absolute -left-[21px] top-1.5 size-2 rounded-full", e.type.includes("completed") ? "bg-success" : e.type.includes("blocked") || e.type.includes("rejected") || e.type.includes("breached") ? "bg-danger" : e.type.includes("paused") ? "bg-warning" : "bg-border-strong")} aria-hidden />
          <p className="text-sm">{e.title}</p>
          {e.description ? <p className="text-xs text-muted">{e.description}</p> : null}
          <p className="text-[11px] text-muted-light">
            {e.occurredAtLabel} · {e.actorName}
          </p>
        </li>
      ))}
    </ol>
  );
}
