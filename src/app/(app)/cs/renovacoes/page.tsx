import type { Metadata } from "next";
import Link from "next/link";
import { CalendarClock, CircleDollarSign, Handshake, RefreshCw, TrendingDown } from "lucide-react";
import { requireScreen } from "@/server/auth/session";
import { csCapabilities, csLinks } from "@/server/cs/access";
import { listRenewals, type RenewalRow } from "@/server/cs/queries";
import { runDueSweeps } from "@/server/automations/lazy";
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

/** Nome do cliente com link para a aba CS da ficha 360º (quando o usuário a vê). */
function ClientLink({ clientId, tradeName, show, className }: { clientId: string; tradeName: string; show: boolean; className: string }) {
  if (!show) return <span className="text-sm font-medium">{tradeName}</span>;
  return (
    <Link href={`/clientes/${clientId}?aba=cs`} className={className}>
      {tradeName}
    </Link>
  );
}

function StatusBadge({ status }: { status: RenewalRow["status"] }) {
  return (
    <Badge variant={RENEWAL_STATUS_VARIANT[status]} size="sm">
      {RENEWAL_STATUS_LABELS[status]}
    </Badge>
  );
}

/**
 * Renovações: abertas (com ações), contratos vencendo sem renovação e encerradas nos últimos 90 dias. Tela
 * cs.renovacoes; as listas respeitam o escopo efetivo e cada ação (negociar, renovar, perder, criar) segue a
 * capacidade do usuário.
 */
export default async function RenewalsPage() {
  const user = await requireScreen("cs.renovacoes");
  const caps = csCapabilities(user);
  const links = csLinks(user);
  // Cria renovações da janela de 90 dias e emite renewal.due pela varredura central (padrão: 1x por dia).
  await runDueSweeps(["renovacoes"]);
  const data = await listRenewals(user);
  const actionCaps = { negotiate: caps.negotiate, renew: caps.renew, lose: caps.loseRenewal, registerChurn: caps.churn && links.churn };
  const hasActions = actionCaps.negotiate || actionCaps.renew || actionCaps.lose;
  const { totals } = data;

  return (
    <PageContainer>
      <PageHeader
        title="Renovações"
        description="Contratos liberados vencendo nos próximos meses. A renovação é criada automaticamente 90 dias antes do vencimento."
        breadcrumbs={[{ label: "Customer Success", href: links.portfolio ? "/cs" : undefined }, { label: "Renovações" }]}
      />

      <div className="mb-6 grid grid-cols-2 gap-3 md:grid-cols-5">
        <StatCard label="Renovações abertas" value={formatNumber(totals.openCount)} icon={<RefreshCw />} tone="info" hint={`${formatCurrency(totals.openMrr)}/mês em jogo`} compact />
        <StatCard label="Vencendo em 60 dias" value={formatNumber(totals.in60)} icon={<CalendarClock />} tone={totals.in60 > 0 ? "warning" : "neutral"} compact />
        <StatCard label="Em negociação" value={formatNumber(totals.negotiating)} icon={<Handshake />} tone="info" compact />
        <StatCard label="MRR renovado (90 dias)" value={formatCurrency(totals.renewedMrr90)} icon={<CircleDollarSign />} tone="success" compact />
        <StatCard label="MRR perdido (90 dias)" value={formatCurrency(totals.lostMrr90)} icon={<TrendingDown />} tone={totals.lostMrr90 > 0 ? "danger" : "success"} href={links.churn ? "/cs/churn" : undefined} compact />
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
                    {hasActions ? <TableHead className="text-right">Ações</TableHead> : null}
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {data.open.map((r) => (
                    <TableRow key={r.id}>
                      <TableCell className="font-medium">
                        <ClientLink clientId={r.clientId} tradeName={r.tradeName} show={links.client} className="hover:text-brand hover:underline" />
                      </TableCell>
                      <TableCell>
                        {links.contracts ? (
                          <Link href={`/financeiro/contratos?contrato=${r.contractId}`} className="text-sm text-muted hover:underline">
                            {r.contractNumber}
                          </Link>
                        ) : (
                          <span className="text-sm text-muted">{r.contractNumber}</span>
                        )}
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
                      {hasActions ? (
                        <TableCell>
                          <RenewalActions renewalId={r.id} status={r.status} tradeName={r.tradeName} contractNumber={r.contractNumber} dueDate={r.dueDate} mrr={r.mrr} capabilities={actionCaps} />
                        </TableCell>
                      ) : null}
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
                      <ClientLink clientId={r.clientId} tradeName={r.tradeName} show={links.client} className="font-medium hover:underline" />
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
                    {hasActions ? <RenewalActions renewalId={r.id} status={r.status} tradeName={r.tradeName} contractNumber={r.contractNumber} dueDate={r.dueDate} mrr={r.mrr} capabilities={actionCaps} /> : null}
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
                      <ClientLink clientId={c.clientId} tradeName={c.tradeName} show={links.client} className="text-sm font-medium hover:underline" />
                      <p className="text-xs text-muted">
                        {c.contractNumber} · {formatCurrency(c.mrr)}/mês · vence {formatDate(c.endDate)}
                      </p>
                    </div>
                    <div className="flex items-center gap-2">
                      <DaysLeftBadge days={c.daysLeft} />
                      {caps.createRenewal ? <CreateRenewalButton contractId={c.contractId} /> : null}
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
                      <ClientLink clientId={r.clientId} tradeName={r.tradeName} show={links.client} className="text-sm font-medium hover:underline" />
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
