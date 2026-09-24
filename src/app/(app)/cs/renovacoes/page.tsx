import type { Metadata } from "next";
import Link from "next/link";
import { redirect } from "next/navigation";
import { CalendarClock, CircleDollarSign, Handshake, RefreshCw, TrendingDown } from "lucide-react";
import { canAccessModule, requireUser } from "@/server/auth/session";
import { listRenewals, type RenewalRow } from "@/server/cs/queries";
import { maybeRunRenewalSweep } from "@/server/cs/service";
import { RENEWAL_STATUS_LABELS, RENEWAL_STATUS_VARIANT } from "@/server/cs/schemas";
import { formatCurrency, formatDate, formatNumber, formatRelative } from "@/lib/format";
import { PageContainer } from "@/components/layout/page-container";
import { Badge } from "@/components/ui/badge";
import { Card } from "@/components/ui/card";
import { EmptyState } from "@/components/ui/empty-state";
import { PageHeader } from "@/components/ui/page-header";
import { SectionTitle } from "@/components/ui/section-title";
import { StatCard } from "@/components/ui/stat-card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { DaysLeftBadge, HealthIndicator, OwnerCell } from "@/components/cs/cs-bits";
import { CreateRenewalButton, RenewalActions } from "@/components/cs/renewal-actions";

export const metadata: Metadata = { title: "Renovações" };

function StatusBadge({ status }: { status: RenewalRow["status"] }) {
  return (
    <Badge variant={RENEWAL_STATUS_VARIANT[status]} size="sm">
      {RENEWAL_STATUS_LABELS[status]}
    </Badge>
  );
}

/** Renovações: abertas (com ações), contratos vencendo sem renovação e encerradas nos últimos 90 dias. */
export default async function RenewalsPage() {
  const user = await requireUser();
  if (!canAccessModule(user, "cs")) redirect("/meu-dia?erro=sem-permissao");
  // Cria renovações da janela de 90 dias e emite renewal.due, no máximo 1x por dia.
  try {
    await maybeRunRenewalSweep();
  } catch (error) {
    console.error("[cs] falha na varredura diária de renovações", error);
  }
  const data = await listRenewals();
  const { totals } = data;

  return (
    <PageContainer>
      <PageHeader
        title="Renovações"
        description="Contratos liberados vencendo nos próximos meses. A renovação é criada automaticamente 90 dias antes do vencimento."
        breadcrumbs={[{ label: "Customer Success", href: "/cs" }, { label: "Renovações" }]}
      />

      <div className="mb-6 grid grid-cols-2 gap-3 md:grid-cols-5">
        <StatCard label="Renovações abertas" value={formatNumber(totals.openCount)} icon={<RefreshCw />} tone="info" hint={`${formatCurrency(totals.openMrr)}/mês em jogo`} compact />
        <StatCard label="Vencendo em 60 dias" value={formatNumber(totals.in60)} icon={<CalendarClock />} tone={totals.in60 > 0 ? "warning" : "neutral"} compact />
        <StatCard label="Em negociação" value={formatNumber(totals.negotiating)} icon={<Handshake />} tone="info" compact />
        <StatCard label="MRR renovado (90 dias)" value={formatCurrency(totals.renewedMrr90)} icon={<CircleDollarSign />} tone="success" compact />
        <StatCard label="MRR perdido (90 dias)" value={formatCurrency(totals.lostMrr90)} icon={<TrendingDown />} tone={totals.lostMrr90 > 0 ? "danger" : "success"} href="/cs/churn" compact />
      </div>

      <section className="mb-8">
        <SectionTitle title="Renovações abertas" count={data.open.length} />
        {data.open.length === 0 ? (
          <Card>
            <EmptyState icon={<RefreshCw />} title="Nenhuma renovação aberta" description="Contratos entram aqui 90 dias antes do vencimento." />
          </Card>
        ) : (
          <>
            <Card className="hidden overflow-hidden md:block">
              <Table className="min-w-[1200px]">
                <TableHeader>
                  <TableRow>
                    <TableHead>Cliente</TableHead>
                    <TableHead>Contrato</TableHead>
                    <TableHead className="text-right">MRR</TableHead>
                    <TableHead>Vencimento</TableHead>
                    <TableHead>Restam</TableHead>
                    <TableHead>Risco</TableHead>
                    <TableHead>Responsável</TableHead>
                    <TableHead>Status</TableHead>
                    <TableHead>Negociação</TableHead>
                    <TableHead className="text-right">Ações</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {data.open.map((r) => (
                    <TableRow key={r.id}>
                      <TableCell className="font-medium">
                        <Link href={`/clientes/${r.clientId}?aba=cs`} className="hover:text-brand hover:underline">
                          {r.tradeName}
                        </Link>
                      </TableCell>
                      <TableCell>
                        <Link href={`/financeiro/contratos?contrato=${r.contractId}`} className="text-sm text-muted hover:underline">
                          {r.contractNumber}
                        </Link>
                      </TableCell>
                      <TableCell className="text-right tabular-nums">{formatCurrency(r.mrr)}</TableCell>
                      <TableCell className="whitespace-nowrap">{formatDate(r.dueDate)}</TableCell>
                      <TableCell>
                        <DaysLeftBadge days={r.daysLeft} />
                      </TableCell>
                      <TableCell>
                        <HealthIndicator score={r.healthScore} level={r.healthLevel} showLabel />
                      </TableCell>
                      <TableCell>
                        <OwnerCell owner={r.owner} />
                      </TableCell>
                      <TableCell>
                        <StatusBadge status={r.status} />
                      </TableCell>
                      <TableCell className="max-w-[240px] text-sm text-muted">{r.notes ?? (r.windowOpen ? "Janela de negociação aberta" : "Janela ainda não aberta")}</TableCell>
                      <TableCell>
                        <RenewalActions renewalId={r.id} status={r.status} tradeName={r.tradeName} contractNumber={r.contractNumber} dueDate={r.dueDate} mrr={r.mrr} />
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </Card>
            <ul className="flex flex-col gap-3 md:hidden">
              {data.open.map((r) => (
                <li key={r.id}>
                  <Card className="flex flex-col gap-2 p-4">
                    <div className="flex items-start justify-between gap-2">
                      <Link href={`/clientes/${r.clientId}?aba=cs`} className="font-medium hover:underline">
                        {r.tradeName}
                      </Link>
                      <StatusBadge status={r.status} />
                    </div>
                    <p className="text-sm text-muted">
                      {r.contractNumber} · {formatCurrency(r.mrr)}/mês · vence {formatDate(r.dueDate)}
                    </p>
                    <div className="flex flex-wrap items-center gap-2">
                      <DaysLeftBadge days={r.daysLeft} />
                      <HealthIndicator score={r.healthScore} level={r.healthLevel} showLabel />
                    </div>
                    {r.notes ? <p className="text-sm">{r.notes}</p> : null}
                    <RenewalActions renewalId={r.id} status={r.status} tradeName={r.tradeName} contractNumber={r.contractNumber} dueDate={r.dueDate} mrr={r.mrr} />
                  </Card>
                </li>
              ))}
            </ul>
          </>
        )}
      </section>

      <div className="grid gap-6 xl:grid-cols-2">
        <section>
          <SectionTitle title="Vencendo sem renovação" count={data.unscheduled.length} description="Contratos liberados que vencem nos próximos 120 dias e ainda não têm renovação." />
          <Card className="overflow-hidden">
            {data.unscheduled.length === 0 ? (
              <EmptyState size="sm" icon={<CalendarClock />} title="Nenhum contrato pendente" />
            ) : (
              <ul className="divide-y divide-border">
                {data.unscheduled.map((c) => (
                  <li key={c.contractId} className="flex flex-col gap-2 px-4 py-3 sm:flex-row sm:items-center sm:justify-between">
                    <div className="min-w-0">
                      <Link href={`/clientes/${c.clientId}?aba=cs`} className="text-sm font-medium hover:underline">
                        {c.tradeName}
                      </Link>
                      <p className="text-xs text-muted">
                        {c.contractNumber} · {formatCurrency(c.mrr)}/mês · vence {formatDate(c.endDate)}
                      </p>
                    </div>
                    <div className="flex items-center gap-2">
                      <DaysLeftBadge days={c.daysLeft} />
                      <CreateRenewalButton contractId={c.contractId} />
                    </div>
                  </li>
                ))}
              </ul>
            )}
          </Card>
        </section>
        <section>
          <SectionTitle title="Encerradas nos últimos 90 dias" count={data.closed.length} />
          <Card className="overflow-hidden">
            {data.closed.length === 0 ? (
              <EmptyState size="sm" icon={<RefreshCw />} title="Nenhuma renovação encerrada no período" />
            ) : (
              <ul className="divide-y divide-border">
                {data.closed.map((r) => (
                  <li key={r.id} className="px-4 py-3">
                    <div className="flex items-center justify-between gap-2">
                      <Link href={`/clientes/${r.clientId}?aba=cs`} className="text-sm font-medium hover:underline">
                        {r.tradeName}
                      </Link>
                      <StatusBadge status={r.status} />
                    </div>
                    <p className="text-xs text-muted">
                      {r.contractNumber} · {formatCurrency(r.mrr)}/mês · {formatRelative(r.updatedAt)}
                    </p>
                    {r.result ? <p className="mt-0.5 text-sm">{r.result}</p> : null}
                  </li>
                ))}
              </ul>
            )}
          </Card>
        </section>
      </div>
    </PageContainer>
  );
}
