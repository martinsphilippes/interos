import type { Scorecard } from "@/server/kpis/queries";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { EmptyState } from "@/components/ui/empty-state";
import { KpiCard } from "@/components/kpis/kpi-card";
import { formatPercent } from "@/lib/format";

/** "Indicadores do departamento": scorecard de cada departamento do escopo, com drill-down em cada KPI. */
export function DepartmentKpis({ scorecards, limitPerDepartment }: { scorecards: Scorecard[]; limitPerDepartment?: number }) {
  if (scorecards.length === 0) return <EmptyState size="sm" title="Sem indicadores" description="Nenhum departamento associado a este escopo." />;
  return (
    <div className="flex flex-col gap-4">
      {scorecards.map((card) => {
        const items = limitPerDepartment ? card.items.slice(0, limitPerDepartment) : card.items;
        return (
          <Card key={card.subject.id ?? card.subject.name}>
            <CardHeader className="flex-row flex-wrap items-end justify-between gap-2">
              <div>
                <CardTitle>{card.subject.name}</CardTitle>
                <CardDescription>
                  {card.achieved} de {card.withTarget} metas atingidas · {card.period.label}
                </CardDescription>
              </div>
              <span className="text-sm text-muted">
                Atingimento médio <span className="font-semibold tabular-nums text-foreground">{formatPercent(card.overallAttainment)}</span>
              </span>
            </CardHeader>
            <CardContent className="pt-0">
              {items.length === 0 ? (
                <EmptyState size="sm" title="Sem indicadores" description="Este departamento ainda não tem indicadores definidos." />
              ) : (
                <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
                  {items.map((r) => (
                    <KpiCard key={r.key} result={r} compact eyebrow={card.subject.name} />
                  ))}
                </div>
              )}
            </CardContent>
          </Card>
        );
      })}
    </div>
  );
}
