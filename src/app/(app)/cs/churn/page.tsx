import type { Metadata } from "next";
import Link from "next/link";
import { redirect } from "next/navigation";
import { CircleDollarSign, Percent, UserMinus, Users } from "lucide-react";
import { canAccessModule, requireUser } from "@/server/auth/session";
import { getChurnFormOptions, getChurnMetrics } from "@/server/cs/queries";
import { CHURN_REASON_LABELS } from "@/server/cs/schemas";
import { formatCompetence, formatCurrency, formatDate, formatPercent } from "@/lib/format";
import { PageContainer } from "@/components/layout/page-container";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { EmptyState } from "@/components/ui/empty-state";
import { PageHeader } from "@/components/ui/page-header";
import { SectionTitle } from "@/components/ui/section-title";
import { StatCard, type StatTone } from "@/components/ui/stat-card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { ChipList, OwnerCell } from "@/components/cs/cs-bits";
import { ChurnDialog } from "@/components/cs/churn-dialog";
import { ChurnReasonsDonut, ChurnTrendChart } from "@/components/cs/churn-charts";

export const metadata: Metadata = { title: "Churn" };

type SearchParams = Promise<Record<string, string | string[] | undefined>>;
const STATUS: Record<"atingida" | "atencao" | "critico", { label: string; tone: StatTone }> = {
  atingida: { label: "Dentro da meta", tone: "success" },
  atencao: { label: "Atenção: acima da meta", tone: "warning" },
  critico: { label: "Crítico: bem acima da meta", tone: "danger" },
};

function BarList({ items }: { items: { key: string; label: string; value: number; detail: string }[] }) {
  if (items.length === 0) return <p className="py-6 text-center text-sm text-muted">Sem cancelamentos no período.</p>;
  const max = Math.max(1, ...items.map((i) => i.value));
  return (
    <ul className="flex flex-col gap-2.5">
      {items.map((i) => (
        <li key={i.key}>
          <div className="mb-1 flex items-baseline justify-between gap-2 text-sm">
            <span className="truncate">{i.label}</span>
            <span className="shrink-0 tabular-nums text-muted">{i.detail}</span>
          </div>
          <div className="h-1.5 overflow-hidden rounded-full bg-surface-hover">
            <div className="h-full rounded-full bg-danger/70" style={{ width: `${(i.value / max) * 100}%` }} />
          </div>
        </li>
      ))}
    </ul>
  );
}

/** Churn: registro de cancelamentos e painel (taxa mensal × meta, receita perdida, motivos, produtos, origem). */
export default async function ChurnPage({ searchParams }: { searchParams: SearchParams }) {
  const user = await requireUser();
  if (!canAccessModule(user, "cs")) redirect("/meu-dia?erro=sem-permissao");
  const params = await searchParams;
  const [m, form] = await Promise.all([getChurnMetrics(), getChurnFormOptions()]);
  const status = STATUS[m.status];
  const initialClientId = typeof params.registrar === "string" ? params.registrar : undefined;

  return (
    <PageContainer>
      <PageHeader
        title="Churn"
        description={`Cancelamentos da base · meta de churn mensal até ${formatPercent(m.target)}`}
        breadcrumbs={[{ label: "Customer Success", href: "/cs" }, { label: "Riscos", href: "/cs/riscos" }, { label: "Churn" }]}
        actions={<ChurnDialog key={initialClientId ?? "novo"} clients={form.clients} users={form.users} currentUserId={user.id} initialClientId={initialClientId} />}
      />

      <div className="mb-6 grid grid-cols-2 gap-3 md:grid-cols-4">
        <StatCard
          label={`Churn em ${formatCompetence(m.current.month)}`}
          value={m.current.rate === null ? "—" : formatPercent(m.current.rate)}
          icon={<Percent />}
          tone={status.tone}
          hint={`${status.label} · ${m.current.cancelledClients} de ${m.current.activeAtStart} cliente(s)`}
          compact
        />
        <StatCard
          label={m.previous ? `Churn em ${formatCompetence(m.previous.month)}` : "Mês anterior"}
          value={m.previous?.rate == null ? "—" : formatPercent(m.previous.rate)}
          icon={<Percent />}
          tone={m.previous?.rate == null ? "neutral" : m.previous.rate <= m.target ? "success" : "danger"}
          hint={m.previous ? `${m.previous.cancelledClients} cancelamento(s) total(is)` : undefined}
          compact
        />
        <StatCard label="Receita perdida no mês" value={formatCurrency(m.current.lostMrr)} icon={<CircleDollarSign />} tone={m.current.lostMrr > 0 ? "danger" : "success"} hint={`${m.current.records} registro(s) · inclui parciais`} compact />
        <StatCard label="Últimos 8 meses" value={formatCurrency(m.totals.lostMrr8m)} icon={<Users />} tone="neutral" hint={`${m.totals.cancelled8m} cliente(s) cancelado(s)`} compact />
      </div>

      <div className="mb-6 grid gap-4 lg:grid-cols-3">
        <Card className="lg:col-span-2">
          <CardHeader>
            <CardTitle>Tendência: churn mensal e receita perdida</CardTitle>
            <CardDescription>Churn = clientes cancelados no mês ÷ clientes ativos no início do mês. Linha tracejada: meta.</CardDescription>
          </CardHeader>
          <CardContent className="pt-0">
            <ChurnTrendChart months={m.months} target={m.target} />
          </CardContent>
        </Card>
        <Card>
          <CardHeader>
            <CardTitle>Motivos</CardTitle>
            <CardDescription>Cancelamentos dos últimos 8 meses por categoria.</CardDescription>
          </CardHeader>
          <CardContent className="pt-0">
            <ChurnReasonsDonut reasons={m.byReason} />
          </CardContent>
        </Card>
      </div>

      <div className="mb-8 grid gap-4 md:grid-cols-2">
        <Card>
          <CardHeader>
            <CardTitle>Por produto</CardTitle>
            <CardDescription>Quantas vezes cada produto foi cancelado.</CardDescription>
          </CardHeader>
          <CardContent className="pt-0">
            <BarList items={m.byProduct.map((p) => ({ key: p.productId, label: p.name, value: p.count, detail: `${p.count}` }))} />
          </CardContent>
        </Card>
        <Card>
          <CardHeader>
            <CardTitle>Por origem do cliente</CardTitle>
            <CardDescription>Canal de aquisição dos clientes que cancelaram.</CardDescription>
          </CardHeader>
          <CardContent className="pt-0">
            <BarList items={m.byOrigin.map((o) => ({ key: o.key, label: o.name, value: o.count, detail: `${o.count} · ${formatCurrency(o.lostMrr)}` }))} />
          </CardContent>
        </Card>
      </div>

      <section>
        <SectionTitle title="Cancelamentos registrados" count={m.records.length} />
        {m.records.length === 0 ? (
          <Card>
            <EmptyState icon={<UserMinus />} title="Nenhum cancelamento registrado" />
          </Card>
        ) : (
          <Card className="overflow-hidden">
            <Table className="min-w-[960px]">
              <TableHeader>
                <TableRow>
                  <TableHead>Data</TableHead>
                  <TableHead>Cliente</TableHead>
                  <TableHead>Tipo</TableHead>
                  <TableHead>Produtos</TableHead>
                  <TableHead className="text-right">MRR perdido</TableHead>
                  <TableHead>Motivo</TableHead>
                  <TableHead>Responsável</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {m.records.map((r) => (
                  <TableRow key={r.id}>
                    <TableCell className="whitespace-nowrap">{formatDate(r.date)}</TableCell>
                    <TableCell>
                      <Link href={`/clientes/${r.clientId}?aba=timeline`} className="font-medium hover:underline">
                        {r.tradeName}
                      </Link>
                    </TableCell>
                    <TableCell>
                      <Badge variant={r.full ? "danger" : "warning"} size="sm">
                        {r.full ? "Total" : "Parcial"}
                      </Badge>
                    </TableCell>
                    <TableCell className="max-w-[220px]">
                      <ChipList items={r.products} max={2} />
                    </TableCell>
                    <TableCell className="text-right tabular-nums">{formatCurrency(r.lostMrr)}</TableCell>
                    <TableCell className="max-w-[320px] text-sm">
                      <span className="font-medium">{CHURN_REASON_LABELS[r.reasonCategory]}</span>
                      <span className="text-muted"> · {r.reason}</span>
                    </TableCell>
                    <TableCell>
                      <OwnerCell owner={r.responsible} />
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </Card>
        )}
      </section>
    </PageContainer>
  );
}
