import { CheckCircle2, CircleDollarSign, Gift, Target } from "lucide-react";
import type { SalesPerformance } from "@/server/performance/queries";
import { formatCompetence, formatCurrency, formatPercent } from "@/lib/format";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Progress } from "@/components/ui/progress";
import { CommissionSimulator } from "@/components/sales/commission-simulator";
import { REVENUE_TYPE_LABELS, REVENUE_TYPES } from "@/components/sales/model";

function tone(att: number | null): "success" | "warning" | "danger" | "secondary" {
  if (att === null) return "secondary";
  if (att >= 1) return "success";
  if (att >= 0.85) return "warning";
  return "danger";
}

/** Bloco do vendedor: vendido por tipo × meta, comissões, histórico, simulador e prêmios de meta batida. */
export function SalesPerformanceBlock({ data, monthLabel }: { data: SalesPerformance; monthLabel: string }) {
  const { summary } = data;
  const maxHistory = Math.max(1, ...summary.history.map((h) => h.prevista + h.liberada + h.futura));
  return (
    <div className="grid gap-4 lg:grid-cols-2">
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Target className="size-4 text-muted" aria-hidden /> Vendido × meta
          </CardTitle>
          <CardDescription>{monthLabel} · metas do cadastro ou da tela de Metas</CardDescription>
        </CardHeader>
        <CardContent className="flex flex-col gap-4 pt-0">
          {REVENUE_TYPES.map((type) => (
            <div key={type}>
              <div className="mb-1 flex items-baseline justify-between gap-2 text-sm">
                <span className="font-medium">{REVENUE_TYPE_LABELS[type]}</span>
                <span className="tabular-nums text-muted">
                  <span className="font-semibold text-foreground">{formatCurrency(summary.sold[type])}</span> / {summary.goals[type] > 0 ? formatCurrency(summary.goals[type]) : "sem meta"}
                </span>
              </div>
              <Progress value={(summary.attainment[type] ?? 0) * 100} tone={tone(summary.attainment[type])} showValue={summary.attainment[type] !== null} />
            </div>
          ))}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Gift className="size-4 text-muted" aria-hidden /> Prêmios de meta batida
          </CardTitle>
          <CardDescription>Plano de comissionamento 2026 · salário mínimo de referência {formatCurrency(data.minimumWage)}</CardDescription>
        </CardHeader>
        <CardContent className="flex flex-col gap-2 pt-0">
          <ul className="divide-y divide-border rounded-lg border border-border">
            {data.prizes.map((p) => (
              <li key={p.type} className="flex items-center justify-between gap-3 px-3 py-2.5">
                <span className="min-w-0">
                  <span className="block text-sm font-medium">{REVENUE_TYPE_LABELS[p.type]}</span>
                  <span className="block text-xs text-muted">
                    {p.goal === 0 ? "Sem meta no mês: prêmio não se aplica" : p.earned ? `Meta batida (${formatPercent(p.attainment)})` : `Faltam ${formatCurrency(p.missing)} para a meta`} · {p.prizeText}
                  </span>
                </span>
                <span className="flex shrink-0 items-center gap-2">
                  <span className="text-sm font-semibold tabular-nums">{formatCurrency(p.prize)}</span>
                  {p.earned ? (
                    <Badge variant="success" size="sm">
                      <CheckCircle2 aria-hidden /> Garantido
                    </Badge>
                  ) : null}
                </span>
              </li>
            ))}
          </ul>
          <p className="text-sm">
            Prêmios garantidos no mês: <span className="font-semibold tabular-nums">{formatCurrency(data.prizeTotal)}</span>
          </p>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <CircleDollarSign className="size-4 text-muted" aria-hidden /> Comissões de {monthLabel.toLowerCase()}
          </CardTitle>
          <CardDescription>Adesão e hardware liberam no pagamento; recorrência na parcela configurada (3ª mensalidade).</CardDescription>
        </CardHeader>
        <CardContent className="flex flex-col gap-4 pt-0">
          <div className="grid grid-cols-3 gap-3">
            <div>
              <p className="label-caps">Prevista</p>
              <p className="mt-1 text-lg font-semibold tabular-nums">{formatCurrency(summary.commission.prevista)}</p>
            </div>
            <div>
              <p className="label-caps">Liberada</p>
              <p className="mt-1 text-lg font-semibold tabular-nums text-success-fg">{formatCurrency(summary.commission.liberada)}</p>
            </div>
            <div>
              <p className="label-caps">Futura</p>
              <p className="mt-1 text-lg font-semibold tabular-nums">{formatCurrency(summary.commission.futura)}</p>
            </div>
          </div>
          <div>
            <p className="mb-2 text-sm font-semibold">Histórico (6 meses)</p>
            <ul className="flex flex-col gap-2">
              {summary.history.map((h) => {
                const total = h.prevista + h.liberada + h.futura;
                return (
                  <li key={h.competence} className="grid grid-cols-[64px_1fr_96px] items-center gap-2 text-xs">
                    <span className="capitalize text-muted">{formatCompetence(h.competence)}</span>
                    <span className="flex h-2.5 overflow-hidden rounded-full bg-surface-hover" aria-hidden>
                      <span className="bg-success" style={{ width: `${(h.liberada / maxHistory) * 100}%` }} />
                      <span className="bg-warning" style={{ width: `${(h.prevista / maxHistory) * 100}%` }} />
                      <span className="bg-info" style={{ width: `${(h.futura / maxHistory) * 100}%` }} />
                    </span>
                    <span className="text-right font-medium tabular-nums">{formatCurrency(total)}</span>
                  </li>
                );
              })}
            </ul>
            <p className="mt-2 flex flex-wrap gap-3 text-xs text-muted" aria-hidden>
              <span className="inline-flex items-center gap-1">
                <span className="size-2.5 rounded-sm bg-success" /> Liberada
              </span>
              <span className="inline-flex items-center gap-1">
                <span className="size-2.5 rounded-sm bg-warning" /> Prevista
              </span>
              <span className="inline-flex items-center gap-1">
                <span className="size-2.5 rounded-sm bg-info" /> Futura
              </span>
            </p>
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Se eu vender X, quanto recebo?</CardTitle>
          <CardDescription>Simulação com as regras de comissão ativas no banco (as mesmas do cálculo real).</CardDescription>
        </CardHeader>
        <CardContent className="pt-0">
          <CommissionSimulator rules={data.rules} />
        </CardContent>
      </Card>
    </div>
  );
}
