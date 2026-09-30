import { TrendingDown, TrendingUp } from "lucide-react";
import type { CashFlowMonth, PayablesWorkspace } from "@/server/commissions/queries";
import { formatCurrency } from "@/lib/format";
import { cn } from "@/lib/utils";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";

function Cell({ m, overdue }: { m: CashFlowMonth; overdue?: boolean }) {
  const tone = m.net > 0 ? "text-success-fg" : m.net < 0 ? "text-danger-fg" : "text-muted";
  return (
    <div className={cn("min-w-0 rounded-lg border border-border px-3 py-2", overdue && "bg-danger-soft/40")} data-cashflow={m.key}>
      <p className="truncate text-xs font-semibold uppercase tracking-wide text-muted">{m.label}</p>
      <dl className="mt-1 grid grid-cols-[auto_1fr] gap-x-2 text-sm tabular-nums">
        <dt className="text-muted">A receber</dt>
        <dd className="text-right">
          {formatCurrency(m.receivable)} <span className="text-xs text-muted">({m.receivableCount})</span>
        </dd>
        <dt className="text-muted">A pagar</dt>
        <dd className="text-right">
          {formatCurrency(m.payable)} <span className="text-xs text-muted">({m.payableCount})</span>
        </dd>
        <dt className="font-medium">Saldo</dt>
        <dd className={cn("flex items-center justify-end gap-1 text-right font-semibold", tone)}>
          {m.net > 0 ? <TrendingUp className="size-3.5" aria-hidden /> : m.net < 0 ? <TrendingDown className="size-3.5" aria-hidden /> : null}
          {formatCurrency(m.net)}
        </dd>
      </dl>
    </div>
  );
}

/** Fluxo de caixa simplificado (D28): cobranças abertas/vencidas × títulos abertos por mês de vencimento (dados reais). */
export function CashFlowCard({ cashFlow, className }: { cashFlow: PayablesWorkspace["cashFlow"]; className?: string }) {
  const total = cashFlow.months.reduce((s, m) => s + m.net, 0) + cashFlow.overdue.net;
  return (
    <Card className={className} data-testid="cash-flow">
      <CardHeader className="flex-row items-start justify-between gap-3">
        <div>
          <CardTitle>Fluxo de caixa simplificado</CardTitle>
          <CardDescription>Cobranças em aberto (a receber) e títulos em aberto (a pagar) por mês de vencimento, mais o que já está em atraso. Só o que está no sistema: nada é projetado.</CardDescription>
        </div>
        <p className={cn("shrink-0 text-right text-sm font-semibold tabular-nums", total >= 0 ? "text-success-fg" : "text-danger-fg")}>Saldo do período {formatCurrency(total)}</p>
      </CardHeader>
      <CardContent className="grid grid-cols-1 gap-3 pt-0 sm:grid-cols-2 xl:grid-cols-4">
        <Cell m={cashFlow.overdue} overdue />
        {cashFlow.months.map((m) => (
          <Cell key={m.key} m={m} />
        ))}
      </CardContent>
    </Card>
  );
}
