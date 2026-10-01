import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { AlertTriangle, CalendarClock, CircleDollarSign, HandCoins, UserX, Wallet } from "lucide-react";
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
import { KpiStrip } from "@/components/ui/kpi-strip";
import { SidePanelShell } from "@/components/ui/side-panel-shell";
import { FinanceFilters } from "@/components/finance/finance-filters";
import { ReceivablesTabs } from "@/components/receivables/receivables-tabs";
import { ReceivablesTable } from "@/components/receivables/receivables-table";
import { NewReceivableButton, ReceivablePanel } from "@/components/receivables/receivable-panel";
import { getReceivablesWorkspace, parseReceivableFilters, RECEIVABLE_SITUATIONS } from "@/server/receivables/queries";
import type { CurrentUser } from "@/domain/types";

export const metadata: Metadata = { title: "Contas a Receber" };

type SearchParams = Promise<Record<string, string | string[] | undefined>>;
const first = (v: string | string[] | undefined) => (Array.isArray(v) ? v[0] : v)?.trim() || undefined;

/**
 * Contas a receber: aging por faixa, por cliente, inadimplentes e faturado x recebido.
 * Acesso (catálogo): tela financeiro.contas-a-receber; seções Aging e totais / Faturado × recebido / Inadimplentes /
 * Por cliente (seção negada não é renderizada nem enviada); escopo pelos donos do contrato; valores sob
 * financeiro.valores.ver ("Restrito"); ações de cobrança pelas chaves financeiro.cobrancas.*.
 */
export default async function ReceivablesPage({ searchParams }: { searchParams: SearchParams }) {
  const user = await requireScreen("financeiro.contas-a-receber");
  const sp = await searchParams;
  // Etapa CP/CR 3: aba "Títulos avulsos" (seção própria; URL direta sem a seção → sem permissão).
  const showTabs = can(user, "financeiro.contas-a-receber.avulsos.ver");
  if (first(sp.aba) === "avulsos") {
    // Seção negada: mesma negação padrão das telas (aviso no Meu Dia); nada é lido.
    if (!showTabs) redirect("/meu-dia?erro=sem-permissao");
    return <AvulsosView user={user} sp={sp} />;
  }
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
        {showTabs ? <ReceivablesTabs current="cobrancas" /> : null}

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

/**
 * Aba "Títulos avulsos" (etapa CP/CR 3): receitas fora de contrato — lista simples, "Novo título a receber" e painel
 * lateral com recebimentos (total, parcial, com resíduo, quitar pelo já recebido), desfazer, anexos e histórico. Os
 * totais do aging (aba Cobranças de contrato) NÃO incluem os avulsos.
 */
async function AvulsosView({ user, sp }: { user: CurrentUser; sp: Record<string, string | string[] | undefined> }) {
  const requested = first(sp.titulo);
  const ws = await getReceivablesWorkspace(user, parseReceivableFilters(sp), requested);
  const hidden = ws ? !ws.can.values : true;
  return (
    <PageContainer size="full" className="max-w-[1680px]">
      <PageHeader
        title="Contas a Receber"
        description="Títulos a receber avulsos: receitas fora de contrato, com recebimento parcial, resíduo e lançamento de caixa"
        breadcrumbs={[{ label: "Financeiro", href: "/financeiro" }, { label: "Contas a Receber", href: "/financeiro/contas-a-receber" }, { label: "Títulos avulsos" }]}
        actions={ws?.can.create ? <NewReceivableButton options={ws.options} /> : undefined}
      />
      <ReceivablesTabs current="avulsos" />
      {!ws ? (
        <Card>
          <EmptyState icon={<HandCoins />} title="Títulos avulsos fora do seu escopo" description="Os títulos a receber avulsos não têm dono (contrato ou vendedor): aparecem só com o escopo Empresa em Contas a Receber." />
        </Card>
      ) : (
        <>
          <KpiStrip columns={3} mobileColumns={2}>
            <StatCard label="Em aberto" value={money(ws.summary.open ?? 0, hidden)} icon={<Wallet />} tone="info" hint={`${ws.summary.openCount} título(s)`} href="/financeiro/contas-a-receber?aba=avulsos&situacao=em_aberto" compact />
            <StatCard label="Vencido" value={money(ws.summary.overdue ?? 0, hidden)} icon={<AlertTriangle />} tone={ws.summary.overdueCount > 0 && !hidden ? "danger" : "success"} hint={`${ws.summary.overdueCount} título(s)`} href="/financeiro/contas-a-receber?aba=avulsos&situacao=vencido" compact />
            <StatCard label="Recebido no mês" value={money(ws.summary.receivedMonth ?? 0, hidden)} icon={<CircleDollarSign />} tone="success" hint={hidden ? RESTRICTED_HINT : "Recebimentos dos avulsos"} compact />
          </KpiStrip>
          <FinanceFilters className="mb-4" fields={[{ param: "situacao", label: "Situação", allLabel: "Todas as situações", options: RECEIVABLE_SITUATIONS }]} />
          <div className="grid grid-cols-[minmax(0,1fr)] gap-4 xl:grid-cols-[minmax(0,1fr)_400px]">
            <Card className="min-w-0 overflow-hidden">
              <CardHeader className="flex-row items-center justify-between gap-3">
                <CardTitle>Títulos avulsos</CardTitle>
                <span className="text-sm text-muted">
                  {ws.rows.length} de {ws.total}
                </span>
              </CardHeader>
              <ReceivablesTable key={first(sp.situacao) ?? "todos"} rows={ws.rows} selectedId={ws.selected?.id} />
            </Card>
            {ws.selected ? (
              <SidePanelShell explicit={Boolean(requested)} param="titulo" ariaLabel="Título a receber selecionado" title={`${ws.selected.code} · ${ws.selected.payerName}`}>
                <ReceivablePanel key={ws.selected.id} r={ws.selected} can={ws.can} options={ws.options} />
              </SidePanelShell>
            ) : (
              <aside className="hidden xl:block">
                <Card className="p-5 text-sm text-muted">Selecione um título para ver os recebimentos, registrar baixa (total, parcial ou com resíduo), anexos e histórico.</Card>
              </aside>
            )}
          </div>
        </>
      )}
    </PageContainer>
  );
}
