import type { Metadata } from "next";
import Link from "next/link";
import { redirect } from "next/navigation";
import { CircleDollarSign, TrendingDown, TrendingUp, UserMinus, UserPlus } from "lucide-react";
import { canAccessModule, requireUser } from "@/server/auth/session";
import { getRecurrenceMetrics } from "@/server/finance/queries";
import { formatCompetence, formatCurrency, formatDate, formatNumber, formatPercent } from "@/lib/format";
import { PageContainer } from "@/components/layout/page-container";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { EmptyState } from "@/components/ui/empty-state";
import { PageHeader } from "@/components/ui/page-header";
import { StatCard } from "@/components/ui/stat-card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { MrrHistoryChart } from "@/components/finance/finance-charts";

export const metadata: Metadata = { title: "Recorrência" };

const signed = (v: number | null) => (v === null ? "—" : `${v >= 0 ? "+" : ""}${formatPercent(v)}`);

function renewalBadge(daysLeft: number) {
  if (daysLeft < 0) return <Badge variant="danger" size="sm">Vencido há {-daysLeft} dia(s)</Badge>;
  if (daysLeft <= 30) return <Badge variant="danger" size="sm">{daysLeft} dia(s)</Badge>;
  if (daysLeft <= 90) return <Badge variant="warning" size="sm">{daysLeft} dia(s)</Badge>;
  return <Badge variant="muted" size="sm">{daysLeft} dia(s)</Badge>;
}

/** Recorrência: MRR atual e por produto, novos e perdidos no mês, crescimento e contratos a renovar. */
export default async function RecurrencePage() {
  const user = await requireUser();
  if (!canAccessModule(user, "financeiro")) redirect("/meu-dia?erro=sem-permissao");
  const m = await getRecurrenceMetrics();
  const maxProduct = Math.max(1, ...m.byProduct.map((p) => p.mrr));
  const month = m.history[m.history.length - 1]?.month;
  const growthTone = m.growthMonth === null ? "neutral" : m.targetGrowth !== null && m.growthMonth >= m.targetGrowth ? "success" : m.growthMonth >= 0 ? "warning" : "danger";

  return (
    <PageContainer>
      <PageHeader title="Recorrência" description={`Receita recorrente dos contratos liberados${month ? ` · ${formatCompetence(month)}` : ""}`} breadcrumbs={[{ label: "Financeiro", href: "/financeiro" }, { label: "Recorrência" }]} />

      <div className="mb-6 grid grid-cols-2 gap-3 md:grid-cols-5">
        <StatCard label="MRR atual" value={formatCurrency(m.mrr)} icon={<CircleDollarSign />} tone="success" hint={`${m.activeContracts} contrato(s) · ARR ${formatCurrency(m.mrr * 12, true)}`} compact />
        <StatCard label="Novo MRR no mês" value={formatCurrency(m.newMrrMonth)} icon={<UserPlus />} tone="info" hint={`${m.newContractsMonth} contrato(s) liberado(s)`} href="/financeiro/contratos?status=liberados_mes" compact />
        <StatCard label="MRR perdido no mês" value={formatCurrency(m.lostMrrMonth)} icon={<UserMinus />} tone={m.lostMrrMonth > 0 ? "danger" : "success"} hint={`${m.churnCountMonth} cancelamento(s)`} compact />
        <StatCard label="MRR líquido novo" value={formatCurrency(m.netNewMrr)} icon={m.netNewMrr >= 0 ? <TrendingUp /> : <TrendingDown />} tone={m.netNewMrr >= 0 ? "success" : "danger"} compact />
        <StatCard
          label="Crescimento no mês"
          value={signed(m.growthMonth)}
          icon={<TrendingUp />}
          tone={growthTone}
          hint={m.targetGrowth !== null ? `Meta: +${formatPercent(m.targetGrowth)} ao mês` : undefined}
          compact
        />
      </div>

      <div className="mb-6 grid gap-4 lg:grid-cols-3">
        <Card className="lg:col-span-2">
          <CardHeader>
            <CardTitle>MRR — últimos 8 meses</CardTitle>
            <CardDescription>Contratos liberados até o fim de cada mês, descontados os cancelamentos (churn).</CardDescription>
          </CardHeader>
          <CardContent className="pt-0">
            <MrrHistoryChart data={m.history} />
          </CardContent>
        </Card>
        <Card>
          <CardHeader>
            <CardTitle>MRR por produto</CardTitle>
            <CardDescription>Contratos liberados, com desconto aplicado.</CardDescription>
          </CardHeader>
          <CardContent className="pt-0">
            {m.byProduct.length === 0 ? (
              <EmptyState size="sm" title="Sem MRR" description="Nenhum contrato liberado com mensalidade." />
            ) : (
              <ul className="flex flex-col gap-3">
                {m.byProduct.map((p) => (
                  <li key={p.productId}>
                    <div className="mb-1 flex items-baseline justify-between gap-2 text-sm">
                      <span className="truncate">{p.name}</span>
                      <span className="shrink-0 tabular-nums text-muted">
                        <span className="font-semibold text-foreground">{formatCurrency(p.mrr)}</span> · {p.contracts}
                      </span>
                    </div>
                    <div className="h-2 w-full overflow-hidden rounded-full bg-surface-hover" aria-hidden>
                      <div className="h-full rounded-full bg-secondary" style={{ width: `${(p.mrr / maxProduct) * 100}%` }} />
                    </div>
                  </li>
                ))}
              </ul>
            )}
          </CardContent>
        </Card>
      </div>

      <Card className="overflow-hidden">
        <CardHeader>
          <CardTitle>Contratos por vencimento</CardTitle>
          <CardDescription>Fim da vigência dos contratos liberados, para planejar a renovação ({formatNumber(m.renewals.filter((r) => r.daysLeft <= 90).length)} nos próximos 90 dias ou vencidos).</CardDescription>
        </CardHeader>
        <CardContent className="px-0 pb-0 pt-0">
          {m.renewals.length === 0 ? (
            <EmptyState size="sm" title="Nenhum contrato com vigência definida" />
          ) : (
            <Table className="min-w-[680px]">
              <TableHeader>
                <TableRow>
                  <TableHead>Cliente</TableHead>
                  <TableHead>Contrato</TableHead>
                  <TableHead className="text-right">Mensal</TableHead>
                  <TableHead>Fim da vigência</TableHead>
                  <TableHead>Prazo</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {m.renewals.map((r) => (
                  <TableRow key={r.contractId}>
                    <TableCell className="max-w-[260px] truncate font-medium">
                      <Link href={`/clientes/${r.clientId}?aba=cs`} className="hover:text-brand">
                        {r.clientName}
                      </Link>
                    </TableCell>
                    <TableCell className="whitespace-nowrap">
                      <Link href={`/financeiro/contratos/${r.contractId}`} className="text-muted hover:text-brand">
                        {r.number}
                      </Link>
                    </TableCell>
                    <TableCell className="text-right tabular-nums">{formatCurrency(r.monthlyTotal)}</TableCell>
                    <TableCell className="whitespace-nowrap text-muted">{formatDate(r.endDate)}</TableCell>
                    <TableCell>{renewalBadge(r.daysLeft)}</TableCell>
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
