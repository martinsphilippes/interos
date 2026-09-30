import type { Metadata } from "next";
import { AlertTriangle, CalendarClock, UserX, Wallet } from "lucide-react";
import { can, requireScreen } from "@/server/auth/session";
import { resolveDataScope } from "@/server/auth/scope";
import { runDueSweeps } from "@/server/automations/lazy";
import { getReceivablesAging } from "@/server/finance/queries";
import { financeCapabilities } from "@/server/finance/access";
import { stripBoleto } from "@/server/finance/redact";
import { formatDate, formatNumber } from "@/lib/format";
import { PageContainer } from "@/components/layout/page-container";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { EmptyState } from "@/components/ui/empty-state";
import { PageHeader } from "@/components/ui/page-header";
import { StatCard } from "@/components/ui/stat-card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { BillingActions, BoletoBadge } from "@/components/finance/billing-actions";
import { ReceivedBilledChart } from "@/components/finance/finance-charts";
import { FinanceAccessProvider } from "@/components/finance/finance-access";
import { money, RESTRICTED_HINT } from "@/components/finance/values";
import { hasBillingActions } from "@/components/finance/access-model";
import { ScreenLink } from "@/components/auth/access-provider";
import { buttonVariants } from "@/components/ui/button-variants";
import { cn } from "@/lib/utils";

export const metadata: Metadata = { title: "Contas a Receber" };

/**
 * Contas a receber: aging por faixa, por cliente, inadimplentes e faturado x recebido.
 * Acesso (catálogo): tela financeiro.contas-a-receber; seções Aging e totais / Faturado × recebido / Inadimplentes /
 * Por cliente (seção negada não é renderizada nem enviada); escopo pelos donos do contrato; valores sob
 * financeiro.valores.ver ("Restrito"); ações de cobrança pelas chaves financeiro.cobrancas.*.
 */
export default async function ReceivablesPage() {
  const user = await requireScreen("financeiro.contas-a-receber");
  const caps = financeCapabilities(user);
  const hidden = !caps.values;
  const show = {
    aging: can(user, "financeiro.contas-a-receber.aging.ver"),
    flow: can(user, "financeiro.contas-a-receber.faturado-recebido.ver"),
    delinquents: can(user, "financeiro.contas-a-receber.inadimplentes.ver"),
    byClient: can(user, "financeiro.contas-a-receber.por-cliente.ver"),
  };
  await runDueSweeps(["regua_cobranca", "conciliacao_bancaria"]);
  const aging = await getReceivablesAging({ scope: await resolveDataScope(user, "financeiro.contas-a-receber"), hideValues: hidden });
  const canOperate = hasBillingActions(caps);
  const oldest = (c: (typeof aging.delinquents)[number]) => (c.oldestOverdue && !caps.billings.boletoView ? stripBoleto(c.oldestOverdue) : c.oldestOverdue);
  const max = Math.max(1, ...aging.buckets.map((b) => b.amount));

  return (
    <FinanceAccessProvider value={caps}>
      <PageContainer>
        <PageHeader title="Contas a Receber" description="Cobranças em aberto e vencidas, por faixa de vencimento e por cliente." breadcrumbs={[{ label: "Financeiro", href: "/financeiro" }, { label: "Contas a Receber" }]} />

        {show.aging ? (
          <div className="mb-6 grid grid-cols-2 gap-3 md:grid-cols-4">
            <StatCard label="Total a receber" value={money(aging.totalToReceive, hidden)} icon={<Wallet />} tone="info" hint={hidden ? RESTRICTED_HINT : undefined} compact />
            <StatCard label="A vencer" value={money(aging.totalOpen, hidden)} icon={<CalendarClock />} href={caps.billings.view ? "/financeiro/cobrancas?status=aberta" : undefined} compact />
            <StatCard label="Vencido" value={money(aging.totalOverdue, hidden)} icon={<AlertTriangle />} tone={hidden ? "neutral" : aging.totalOverdue > 0 ? "danger" : "success"} href={caps.billings.view ? "/financeiro/cobrancas?status=vencida" : undefined} compact />
            <StatCard label="Inadimplentes" value={formatNumber(aging.delinquents.length)} icon={<UserX />} tone={aging.delinquents.length > 0 ? "danger" : "success"} hint="Clientes com cobrança vencida" compact />
          </div>
        ) : null}

        <div className="mb-6 grid gap-4 lg:grid-cols-2">
          {show.aging ? (
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
                          <span className="font-semibold text-foreground">{money(b.amount, hidden)}</span> · {b.count}
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
          ) : null}
          {show.flow ? (
            <Card>
              <CardHeader>
                <CardTitle>Faturado x recebido</CardTitle>
                <CardDescription>Últimos 6 meses: faturado pela competência, recebido pela data do pagamento.</CardDescription>
              </CardHeader>
              <CardContent className="pt-0">
                {hidden ? <EmptyState size="sm" icon={<Wallet />} title="Valores restritos" description={RESTRICTED_HINT} /> : <ReceivedBilledChart data={aging.monthly} />}
              </CardContent>
            </Card>
          ) : null}
        </div>

        {show.delinquents ? (
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
                        <ScreenLink href={`/clientes/${c.clientId}?aba=financeiro`} className="font-medium hover:text-brand" fallback={<span className="font-medium">{c.clientName}</span>}>
                          {c.clientName}
                        </ScreenLink>
                        <p className="text-xs text-muted">
                          <span className="font-medium text-danger-fg">{money(c.overdue, hidden)}</span> vencido em {c.overdueCount} cobrança(s) · atraso de até {c.oldestOverdueDays} dia(s)
                          {!hidden && c.open > 0 ? ` · ${money(c.open, hidden)} a vencer` : ""}
                        </p>
                      </div>
                      <div className="flex items-center gap-2">
                        {c.oldestOverdue ? <BoletoBadge billing={oldest(c)!} /> : null}
                        <ScreenLink href={`/financeiro/cobrancas?cliente=${c.clientId}&status=vencida`} className={buttonVariants({ variant: "outline", size: "sm", className: "h-10 sm:h-8" })}>
                          Ver cobranças
                        </ScreenLink>
                        {canOperate && c.oldestOverdue ? <BillingActions billing={{ ...oldest(c)!, clientName: c.clientName }} compact /> : null}
                      </div>
                    </li>
                  ))}
                </ul>
              )}
            </CardContent>
          </Card>
        ) : null}

        {show.byClient ? (
          <Card className="overflow-hidden">
            <CardHeader>
              <CardTitle>Por cliente</CardTitle>
              <CardDescription>Todos os clientes com valores em aberto.</CardDescription>
            </CardHeader>
            <CardContent className="px-0 pb-0 pt-0">
              {aging.byClient.length === 0 ? (
                <EmptyState size="sm" icon={<Wallet />} title="Nada a receber" description="Não há cobranças em aberto." />
              ) : (
                <Table className="min-w-[860px]">
                  <TableHeader>
                    <TableRow>
                      <TableHead>Cliente</TableHead>
                      <TableHead className="text-right">A vencer</TableHead>
                      <TableHead className="text-right">Vencido</TableHead>
                      <TableHead className="text-right">Total</TableHead>
                      <TableHead>Próximo vencimento</TableHead>
                      <TableHead>Boleto</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {aging.byClient.map((c) => (
                      <TableRow key={c.clientId}>
                        <TableCell className="max-w-[260px] truncate font-medium">
                          <ScreenLink href={`/financeiro/cobrancas?cliente=${c.clientId}`} className="hover:text-brand" fallback={c.clientName}>
                            {c.clientName}
                          </ScreenLink>
                        </TableCell>
                        <TableCell className="text-right tabular-nums">{money(c.open, hidden)}</TableCell>
                        <TableCell className={cn("text-right tabular-nums", c.overdueCount > 0 && "font-medium text-danger-fg")}>{money(c.overdue, hidden)}</TableCell>
                        <TableCell className="text-right tabular-nums">{money(c.open + c.overdue, hidden)}</TableCell>
                        <TableCell className="whitespace-nowrap text-muted">{c.nextDueDate ? formatDate(c.nextDueDate) : "—"}</TableCell>
                        <TableCell className="whitespace-nowrap">
                          <span className={cn("inline-flex flex-wrap items-center gap-1", !caps.billings.boletoView && "hidden")}>
                            {c.boletoIssued > 0 ? (
                              <Badge variant="info" size="sm">
                                {c.boletoIssued} emitido{c.boletoIssued === 1 ? "" : "s"}
                              </Badge>
                            ) : null}
                            {c.boletoMissing > 0 ? (
                              <Badge variant="muted" size="sm">
                                {c.boletoMissing} sem boleto
                              </Badge>
                            ) : null}
                          </span>
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              )}
            </CardContent>
          </Card>
        ) : null}
      </PageContainer>
    </FinanceAccessProvider>
  );
}
