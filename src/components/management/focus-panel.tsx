import Link from "next/link";
import { ChevronRight, X } from "lucide-react";
import type { CriticalClient, MemberRow } from "@/server/management/queries";
import { FOCUS_LABELS, type FocusKey } from "@/server/management/schemas";
import type { KpiResult } from "@/server/kpis/engine";
import { Avatar } from "@/components/ui/avatar";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { EmptyState } from "@/components/ui/empty-state";
import { KpiCard } from "@/components/kpis/kpi-card";
import { formatCurrency } from "@/lib/format";

const COUNT: Record<FocusKey, (m: MemberRow) => number> = {
  atrasadas: (m) => m.overdueTasks,
  sla: (m) => m.slaAtRisk,
  etapas: (m) => m.stalledSteps,
  clientes: (m) => m.criticalClients,
  metas: (m) => m.criticalGoals,
};

export interface FocusPanelProps {
  focus: FocusKey;
  members: MemberRow[];
  criticalClients: CriticalClient[];
  criticalKpis: KpiResult[];
  /** Link para sair do foco (preserva o escopo). */
  clearHref: string;
}

/**
 * Segundo elo da cadeia de drill-down: o número do card do topo aberto por colaborador. Cada colaborador
 * leva à sua visão (/gestao/equipe/<id>?foco=...), onde estão os itens que abrem tarefa, cliente e processo.
 */
export function FocusPanel({ focus, members, criticalClients, criticalKpis, clearHref }: FocusPanelProps) {
  const label = FOCUS_LABELS[focus];
  const rows = members
    .map((m) => ({ m, count: COUNT[focus](m) }))
    .filter((r) => r.count > 0)
    .sort((a, b) => b.count - a.count);

  return (
    <Card className="border-brand/30">
      <CardHeader className="flex-row items-start justify-between gap-3">
        <div>
          <CardTitle>{label.title} por colaborador</CardTitle>
          <CardDescription>Abra o colaborador para ver cada item e ir direto à tarefa, ao cliente ou ao processo.</CardDescription>
        </div>
        <Button asChild variant="ghost" size="sm" className="h-11 md:h-8">
          <Link href={clearHref}>
            <X /> Fechar foco
          </Link>
        </Button>
      </CardHeader>
      <CardContent className="flex flex-col gap-5 pt-0">
        {focus === "metas" && criticalKpis.length > 0 ? (
          <div>
            <p className="label-caps mb-2">Indicadores do departamento em crítico</p>
            <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
              {criticalKpis.map((r) => (
                <KpiCard key={`${r.key}-${r.scopeId ?? ""}`} result={r} compact />
              ))}
            </div>
          </div>
        ) : null}

        {rows.length === 0 ? (
          <EmptyState size="sm" title="Nada por aqui" description={label.empty} />
        ) : (
          <ul className="divide-y divide-border rounded-lg border border-border">
            {rows.map(({ m, count }) => (
              <li key={m.id}>
                <Link href={`/gestao/equipe/${m.id}?foco=${focus}`} className="flex min-h-[56px] items-center gap-3 px-3 py-2 transition-colors hover:bg-surface-muted">
                  <Avatar name={m.name} src={m.avatarUrl} size="sm" />
                  <span className="flex min-w-0 flex-1 flex-col leading-tight">
                    <span className="truncate text-sm font-medium text-foreground">{m.name}</span>
                    <span className="truncate text-xs text-muted">{m.jobTitle ?? m.roleLabel}</span>
                  </span>
                  <Badge variant={focus === "etapas" ? "warning" : "danger"} size="md" className="tabular-nums">
                    {count} {label.memberColumn.toLowerCase()}
                  </Badge>
                  <ChevronRight className="size-4 shrink-0 text-muted-light" aria-hidden />
                </Link>
              </li>
            ))}
          </ul>
        )}

        {focus === "clientes" && criticalClients.length > 0 ? (
          <div>
            <p className="label-caps mb-2">Clientes críticos ({criticalClients.length})</p>
            <ul className="divide-y divide-border rounded-lg border border-border">
              {criticalClients.map((c) => (
                <li key={c.id}>
                  <Link href={c.href} className="flex min-h-[56px] flex-col gap-1 px-3 py-2 transition-colors hover:bg-surface-muted sm:flex-row sm:items-center sm:justify-between">
                    <span className="min-w-0">
                      <span className="block truncate text-sm font-medium text-foreground">{c.name}</span>
                      <span className="block text-xs text-muted">MRR {formatCurrency(c.mrr)}</span>
                    </span>
                    <span className="flex flex-wrap gap-1">
                      {c.reasons.map((r) => (
                        <Badge key={r} variant="danger" size="sm">
                          {r}
                        </Badge>
                      ))}
                    </span>
                  </Link>
                </li>
              ))}
            </ul>
          </div>
        ) : null}
      </CardContent>
    </Card>
  );
}
