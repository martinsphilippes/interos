import Link from "next/link";
import { CheckCircle2, ChevronRight } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Card } from "@/components/ui/card";
import { EmptyState } from "@/components/ui/empty-state";
import { SectionTitle } from "@/components/ui/section-title";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { formatDateTime, formatRelative } from "@/lib/format";
import { LeadStatusBadge, ScorePill, TemperatureBadge } from "./lead-badges";
import type { MarketingOverview } from "./marketing-model";

const LIMIT = 12;

/** Tabela "Leads que precisam de ação": novos sem responsável e próxima ação vencida. */
export function NeedsActionList({ items }: { items: MarketingOverview["needsAction"] }) {
  const shown = items.slice(0, LIMIT);
  return (
    <section>
      <SectionTitle
        title="Leads que precisam de ação"
        count={items.length}
        description="Sem responsável ou com a próxima ação vencida"
        actions={
          items.length > LIMIT ? (
            <Link href="/marketing/leads?acao=1" className="text-sm font-medium text-brand hover:underline">
              Ver todos
            </Link>
          ) : undefined
        }
      />
      {items.length === 0 ? (
        <Card>
          <EmptyState size="sm" icon={<CheckCircle2 />} title="Nada pendente" description="Todo lead aberto tem responsável e a próxima ação em dia." />
        </Card>
      ) : (
        <>
          <Card className="hidden overflow-hidden md:block">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Lead</TableHead>
                  <TableHead>Score</TableHead>
                  <TableHead>Status</TableHead>
                  <TableHead>Responsável</TableHead>
                  <TableHead>Próxima ação</TableHead>
                  <TableHead>Motivo</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {shown.map((lead) => (
                  <TableRow key={lead.id} clickable>
                    <TableCell>
                      <Link href={`/marketing/leads?lead=${lead.id}`} className="flex flex-col">
                        <span className="font-medium text-foreground">{lead.name}</span>
                        <span className="text-xs text-muted">
                          {lead.company ?? "—"} · captado {formatRelative(lead.createdAt)}
                        </span>
                      </Link>
                    </TableCell>
                    <TableCell>
                      <span className="flex items-center gap-2">
                        <ScorePill score={lead.score} temperature={lead.temperature} />
                        <TemperatureBadge temperature={lead.temperature} />
                      </span>
                    </TableCell>
                    <TableCell>
                      <LeadStatusBadge status={lead.status} />
                    </TableCell>
                    <TableCell className="text-sm">{lead.ownerName ?? <span className="text-muted-light">—</span>}</TableCell>
                    <TableCell className="text-sm">
                      {lead.nextActionAt ? <span className={lead.overdue ? "font-medium text-danger-fg" : undefined}>{formatDateTime(lead.nextActionAt)}</span> : <span className="text-muted-light">—</span>}
                      {lead.nextAction ? <span className="block text-xs text-muted">{lead.nextAction}</span> : null}
                    </TableCell>
                    <TableCell>
                      <span className="flex flex-wrap gap-1">
                        {lead.reasons.map((r) => (
                          <Badge key={r} variant={r === "Sem responsável" ? "warning" : "danger"} size="sm">
                            {r}
                          </Badge>
                        ))}
                      </span>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </Card>
          <ul className="flex flex-col gap-2 md:hidden">
            {shown.map((lead) => (
              <li key={lead.id}>
                <Link href={`/marketing/leads?lead=${lead.id}`} className="flex min-h-[56px] items-center gap-3 rounded-lg border border-border bg-surface p-3 shadow-card">
                  <ScorePill score={lead.score} temperature={lead.temperature} />
                  <span className="flex min-w-0 flex-1 flex-col">
                    <span className="truncate font-medium">{lead.name}</span>
                    <span className="truncate text-xs text-muted">{lead.reasons.join(" · ")}</span>
                  </span>
                  <ChevronRight className="size-4 text-muted-light" />
                </Link>
              </li>
            ))}
          </ul>
        </>
      )}
    </section>
  );
}
