import Link from "next/link";
import { eventTypeLabel } from "@/domain/event-labels";
import { History } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { EmptyState } from "@/components/ui/empty-state";
import { RelativeTime } from "@/components/ui/relative-time";
import type { AutomationRunRecord } from "@/server/automations/schemas";
import { ACTION_TYPE_LABELS } from "@/server/automations/schemas";
import { RUN_STATUS_LABELS, RUN_STATUS_VARIANT, TRIGGER_KIND_LABELS } from "./model";

/** Histórico de automation_runs de uma regra (mais recentes primeiro). */
export function RunsHistory({ runs, total }: { runs: AutomationRunRecord[]; total: number }) {
  if (runs.length === 0) {
    return <EmptyState size="sm" icon={<History />} title="Nenhuma execução ainda" description="As execuções (inclusive as ignoradas por condição) aparecem aqui." />;
  }
  return (
    <div className="flex flex-col gap-2">
      <ul className="flex flex-col divide-y divide-border rounded-lg border border-border bg-surface shadow-card">
        {runs.map((run) => (
          <li key={run.id} className="flex flex-col gap-1.5 p-3">
            <div className="flex flex-wrap items-center gap-2 text-xs">
              <Badge variant={RUN_STATUS_VARIANT[run.status]} size="sm">
                {RUN_STATUS_LABELS[run.status]}
              </Badge>
              <span className="text-muted">
                <RelativeTime value={run.ranAt} />
              </span>
              {run.trigger ? <span className="text-muted">· {TRIGGER_KIND_LABELS[run.trigger] ?? run.trigger}</span> : null}
              {run.eventType ? <span className="text-muted" title={run.eventType}>{eventTypeLabel(run.eventType)}</span> : null}
              {run.depth && run.depth > 1 ? <Badge variant="outline" size="sm">encadeada nível {run.depth}</Badge> : null}
              {run.clientId ? (
                <Link href={`/clientes/${run.clientId}`} className="text-brand hover:underline">
                  ver cliente
                </Link>
              ) : null}
            </div>
            <p className="text-sm">{run.detail}</p>
            {run.actions && run.actions.length > 0 ? (
              <ul className="flex flex-wrap gap-1.5">
                {run.actions.map((a, i) =>
                  a.href ? (
                    <li key={i}>
                      <Link href={a.href}>
                        <Badge variant={RUN_STATUS_VARIANT[a.status]} size="sm" className="hover:opacity-80">
                          {ACTION_TYPE_LABELS[a.type]}
                        </Badge>
                      </Link>
                    </li>
                  ) : (
                    <li key={i}>
                      <Badge variant={RUN_STATUS_VARIANT[a.status]} size="sm" title={a.detail}>
                        {ACTION_TYPE_LABELS[a.type]}
                      </Badge>
                    </li>
                  ),
                )}
              </ul>
            ) : null}
          </li>
        ))}
      </ul>
      {total > runs.length ? <p className="text-xs text-muted">Mostrando as {runs.length} execuções mais recentes de {total}.</p> : null}
    </div>
  );
}
