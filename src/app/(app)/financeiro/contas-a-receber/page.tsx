import type { Metadata } from "next";
import Link from "next/link";
import { redirect } from "next/navigation";
import { AlertTriangle, CalendarClock, UserX, Wallet } from "lucide-react";
import { canAccessModule, requireUser } from "@/server/auth/session";
import { getReceivablesAging } from "@/server/finance/queries";
import { canOperateFinance } from "@/server/finance/schemas";
import { formatCurrency, formatDate, formatNumber } from "@/lib/format";
import { PageContainer } from "@/components/layout/page-container";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { EmptyState } from "@/components/ui/empty-state";
import { PageHeader } from "@/components/ui/page-header";
import { StatCard } from "@/components/ui/stat-card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { BillingActions } from "@/components/finance/billing-actions";
import { ReceivedBilledChart } from "@/components/finance/finance-charts";
import { cn } from "@/lib/utils";

export const metadata: Metadata = { title: "Contas a Receber" };

/** Contas a receber: aging por faixa, por cliente, inadimplentes e faturado x recebido. */
export default async function ReceivablesPage() {
  const user = await requireUser();
  if (!canAccessModule(user, "financeiro")) redirect("/meu-dia?erro=sem-permissao");
  const aging = await getReceivablesAging();
  const canOperate = canOperateFinance(user);
  const max = Math.max(1, ...aging.buckets.map((b) => b.amount));

  return (
    <PageContainer>
      <PageHeader title="Contas a Receber" description="Cobranças em aberto e vencidas, por faixa de vencimento e por cliente." breadcrumbs={[{ label: "Financeiro", href: "/financeiro" }, { label: "Contas a Receber" }]} />

      <div className="mb-6 grid grid-cols-2 gap-3 md:grid-cols-4">
        <StatCard label="Total a receber" value={formatCurrency(aging.totalToReceive)} icon={<Wallet />} tone="info" compact />
        <StatCard label="A vencer" value={formatCurrency(aging.totalOpen)} icon={<CalendarClock />} href="/financeiro/cobrancas?status=aberta" compact />
        <StatCard label="Vencido" value={formatCurrency(aging.totalOverdue)} icon={<AlertTriangle />} tone={aging.totalOverdue > 0 ? "danger" : "success"} href="/financeiro/cobrancas?status=vencida" compact />
        <StatCard label="Inadimplentes" value={formatNumber(aging.delinquents.length)} icon={<UserX />} tone={aging.delinquents.length > 0 ? "danger" : "success"} hint="Clientes com cobrança vencida" compact />
      </div>

      <div className="mb-6 grid gap-4 lg:grid-cols-2">
        <Card>
          <CardHeader>
            <CardTitle>Aging</CardTitle>
            <CardDescription>Valor em aberto por faixa de dias até (ou desde) o vencimento.</CardDescription>
          </CardHeader>
          <CardContent className="pt-0">
            <ul className="flex flex-col gap-3">
              {aging.buckets.map((b) => (
                <li key={b.key}>
                  <div className="mb-1 flex items-baseline justify-between gap-2 text-sm">
                    <span className={b.overdue ? "text-danger-fg" : undefined}>{b.label}</span>
                    <span className="tabular-nums text-muted">
                      <span className="font-semibold text-foreground">{formatCurrency(b.amount)}</span> · {b.count}
                    </span>
                  </div>
                  <div className="h-2 w-full overflow-hidden rounded-full bg-surface-hover" aria-hidden>
                    <div className={cn("h-full rounded-full", b.overdue ? "bg-danger" : "bg-secondary")} style={{ width: `${(b.amount / max) * 100}%` }} />
                  </div>
                </li>
              ))}
            </ul>
          </CardContent>
        </Card>
        <Card>
          <CardHeader>
            <CardTitle>Faturado x recebido</CardTitle>
            <CardDescription>Últimos 6 meses: faturado pela competência, recebido pela data do pagamento.</CardDescription>
          </CardHeader>
          <CardContent className="pt-0">
            <ReceivedBilledChart data={aging.monthly} />
          </CardContent>
        </Card>
      </div>

      <Card className="mb-6 overflow-hidden">
        <CardHeader>
          <CardTitle>Inadimplentes</CardTitle>
          <CardDescription>Clientes com alguma cobrança vencida, do maior valor vencido para o menor.</CardDescription>
        </CardHeader>
        <CardContent className="px-0 pb-0 pt-0">
          {aging.delinquents.length === 0 ? (
            <EmptyState size="sm" icon={<UserX />} title="Nenhum cliente inadimplente" description="Nenhuma cobrança vencida no momento." />
          ) : (
            <ul className="flex flex-col divide-y divide-border">
              {aging.delinquents.map((c) => (
                <li key={c.clientId} className="flex flex-col gap-2 px-5 py-3 sm:flex-row sm:items-center sm:justify-between">
                  <div className="min-w-0">
                    <Link href={`/clientes/${c.clientId}?aba=financeiro`} className="font-medium hover:text-brand">
                      {c.clientName}
                    </Link>
                    <p className="text-xs text-muted">
                      <span className="font-medium text-danger-fg">{formatCurrency(c.overdue)}</span> vencido em {c.overdueCount} cobrança(s) · atraso de até {c.oldestOverdueDays} dia(s)
                      {c.open > 0 ? ` · ${formatCurrency(c.open)} a vencer` : ""}
                    </p>
                  </div>
                  <div className="flex items-center gap-2">
                    <Button asChild variant="outline" size="sm" className="h-10 sm:h-8">
                      <Link href={`/financeiro/cobrancas?cliente=${c.clientId}&status=vencida`}>Ver cobranças</Link>
                    </Button>
                    {canOperate && c.oldestOverdue ? <BillingActions billing={{ ...c.oldestOverdue, clientName: c.clientName }} compact /> : null}
                  </div>
                </li>
              ))}
            </ul>
          )}
        </CardContent>
      </Card>

      <Card className="overflow-hidden">
        <CardHeader>
          <CardTitle>Por cliente</CardTitle>
          <CardDescription>Todos os clientes com valores em aberto.</CardDescription>
        </CardHeader>
        <CardContent className="px-0 pb-0 pt-0">
          {aging.byClient.length === 0 ? (
            <EmptyState size="sm" icon={<Wallet />} title="Nada a receber" description="Não há cobranças em aberto." />
          ) : (
            <Table className="min-w-[720px]">
              <TableHeader>
                <TableRow>
                  <TableHead>Cliente</TableHead>
                  <TableHead className="text-right">A vencer</TableHead>
                  <TableHead className="text-right">Vencido</TableHead>
                  <TableHead className="text-right">Total</TableHead>
                  <TableHead>Próximo vencimento</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {aging.byClient.map((c) => (
                  <TableRow key={c.clientId}>
                    <TableCell className="max-w-[260px] truncate font-medium">
                      <Link href={`/financeiro/cobrancas?cliente=${c.clientId}`} className="hover:text-brand">
                        {c.clientName}
                      </Link>
                    </TableCell>
                    <TableCell className="text-right tabular-nums">{formatCurrency(c.open)}</TableCell>
                    <TableCell className={cn("text-right tabular-nums", c.overdue > 0 && "font-medium text-danger-fg")}>{formatCurrency(c.overdue)}</TableCell>
                    <TableCell className="text-right tabular-nums">{formatCurrency(c.open + c.overdue)}</TableCell>
                    <TableCell className="whitespace-nowrap text-muted">{c.nextDueDate ? formatDate(c.nextDueDate) : "—"}</TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}
        </CardContent>
      </Card>
    </PageContainer>
  );
}
