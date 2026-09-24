import { Headset } from "lucide-react";
import type { SupportTicket, TimelineEvent } from "@/domain/types";
import { formatDateTime } from "@/lib/format";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Timeline } from "@/components/timeline/timeline";
import { TICKET_PRIORITY_LABELS, TICKET_PRIORITY_VARIANT, TICKET_STATUS_LABELS } from "@/components/clients/labels";

/**
 * Histórico do projeto: linha do tempo do cliente desde a criação do projeto e, após o go-live, os
 * chamados abertos nos 30 dias seguintes (indicador de qualidade da implantação).
 */
export function HistoryTab({ events, goLiveAt, tickets }: { events: TimelineEvent[]; goLiveAt?: string; tickets: SupportTicket[] }) {
  return (
    <div className="flex flex-col gap-4">
      {goLiveAt ? (
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <Headset className="size-4 text-muted" aria-hidden /> Chamados nos 30 dias após o go-live
              <span className="rounded-full bg-surface-hover px-2 py-0.5 text-xs font-medium tabular-nums text-muted">{tickets.length}</span>
            </CardTitle>
            <CardDescription>Qualidade da implantação: quanto menos chamados na janela de estabilização (dias 8–30), melhor.</CardDescription>
          </CardHeader>
          <CardContent className="pt-0">
            {tickets.length === 0 ? (
              <p className="text-sm text-muted">Nenhum chamado aberto no período.</p>
            ) : (
              <ul className="flex flex-col divide-y divide-border">
                {tickets.map((t) => (
                  <li key={t.id} className="flex flex-wrap items-center gap-2 py-2 text-sm">
                    <span className="font-medium tabular-nums">#{t.number}</span>
                    <span className="min-w-0 flex-1 truncate">{t.subject}</span>
                    <Badge variant={TICKET_PRIORITY_VARIANT[t.priority]} size="sm">
                      {TICKET_PRIORITY_LABELS[t.priority]}
                    </Badge>
                    <Badge variant="outline" size="sm">
                      {TICKET_STATUS_LABELS[t.status]}
                    </Badge>
                    <span className="text-xs text-muted">{formatDateTime(t.openedAt)}</span>
                  </li>
                ))}
              </ul>
            )}
          </CardContent>
        </Card>
      ) : null}
      <Card>
        <CardContent className="py-4">
          <Timeline events={events} emptyTitle="Sem eventos desde o início do projeto" />
        </CardContent>
      </Card>
    </div>
  );
}
