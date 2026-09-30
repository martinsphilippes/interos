import type { Metadata } from "next";
import { ArrowRight, FileSignature, PenLine, Receipt, Repeat, Wallet } from "lucide-react";
import { can, requireScreen } from "@/server/auth/session";
import { resolveDataScope } from "@/server/auth/scope";
import { getFinanceOverview, listContracts } from "@/server/finance/queries";
import { financeCapabilities } from "@/server/finance/access";
import { formatNumber } from "@/lib/format";
import { PageContainer } from "@/components/layout/page-container";
import { buttonVariants } from "@/components/ui/button-variants";
import { ScreenLink } from "@/components/auth/access-provider";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { PageHeader } from "@/components/ui/page-header";
import { ContractsTable } from "@/components/finance/contracts-table";
import { FinanceAccessProvider } from "@/components/finance/finance-access";
import { FinanceStats } from "@/components/finance/finance-stats";
import { money } from "@/components/finance/values";
import { WonWithoutContractList } from "@/components/finance/won-without-contract";

export const metadata: Metadata = { title: "Financeiro" };

/**
 * Visão geral do Financeiro: indicadores com drill-down, vendas ganhas sem contrato, a fila de contratos
 * em aberto (ordenada por pendência e SLA) e atalhos para as demais telas do módulo.
 * Acesso (catálogo): tela financeiro.dashboard; seções indicadores / vendas-sem-contrato / fila (seção negada não é
 * lida nem enviada); escopo da tela (donos do contrato); valores sob financeiro.valores.ver ("Restrito").
 */
export default async function FinanceOverviewPage() {
  const user = await requireScreen("financeiro.dashboard");
  const caps = financeCapabilities(user);
  const show = {
    indicators: can(user, "financeiro.dashboard.indicadores.ver"),
    wonWithoutContract: can(user, "financeiro.dashboard.vendas-sem-contrato.ver"),
    queue: can(user, "financeiro.dashboard.fila.ver"),
  };
  const hidden = !caps.values;
  const options = { scope: await resolveDataScope(user, "financeiro.dashboard"), hideValues: hidden };
  const [overview, queue] = await Promise.all([getFinanceOverview(options), show.queue ? listContracts({ status: "abertos" }, options) : Promise.resolve(null)]);
  const { counts } = overview;
  const openContracts = queue ? queue.rows.length : counts.contrato + counts.assinatura + counts.pagamento + counts.pendencia;

  const shortcuts = [
    { href: "/financeiro/contratos", label: "Contratos", icon: <FileSignature />, text: `${formatNumber(openContracts)} em aberto · ${overview.activeContracts} liberados` },
    { href: "/financeiro/assinaturas", label: "Assinaturas", icon: <PenLine />, text: `${counts.assinatura} aguardando assinatura` },
    { href: "/financeiro/cobrancas", label: "Cobranças", icon: <Receipt />, text: hidden ? `${formatNumber(overview.overdue.count)} vencida(s)` : `${money(overview.receivedMonth, hidden)} recebido no mês` },
    { href: "/financeiro/contas-a-receber", label: "Contas a Receber", icon: <Wallet />, text: hidden ? "Aging e inadimplência" : `${money(overview.overdue.amount, hidden)} vencido` },
    { href: "/financeiro/recorrencia", label: "Recorrência", icon: <Repeat />, text: hidden ? "MRR, produtos e renovações" : `MRR ${money(overview.mrrActive, hidden)}` },
  ];
  const canOpen = {
    contracts: caps.contracts.view,
    recurrence: can(user, "financeiro.recorrencia.ver"),
    billings: caps.billings.view,
    receivables: can(user, "financeiro.contas-a-receber.ver"),
  };

  return (
    <FinanceAccessProvider value={caps}>
      <PageContainer>
        <PageHeader title="Financeiro" description="Portão de qualidade da jornada: contrato, assinatura, cobrança e liberação para a implantação." breadcrumbs={[{ label: "Financeiro" }]} />

        {show.indicators ? (
          <div className="mb-6">
            <FinanceStats overview={overview} canOpen={canOpen} />
          </div>
        ) : null}

        {show.wonWithoutContract && overview.wonWithoutContract.length > 0 ? (
          <Card className="mb-6 border-warning/40">
            <CardHeader>
              <CardTitle>Vendas ganhas sem contrato</CardTitle>
              <CardDescription>Negócios fechados em Vendas que ainda não chegaram ao Financeiro.</CardDescription>
            </CardHeader>
            <CardContent className="pt-0">
              <WonWithoutContractList items={overview.wonWithoutContract} />
            </CardContent>
          </Card>
        ) : null}

        <div className="grid gap-4 lg:grid-cols-3">
          {queue ? (
            <Card className="overflow-hidden lg:col-span-2">
              <CardHeader className="flex-row items-start justify-between gap-3">
                <div>
                  <CardTitle>Fila do Financeiro</CardTitle>
                  <CardDescription>Contratos em aberto: pendências e SLA mais apertado primeiro.</CardDescription>
                </div>
                <ScreenLink href="/financeiro/contratos" className={buttonVariants({ variant: "outline", size: "sm", className: "h-10 md:h-8" })}>
                  Ver todos <ArrowRight />
                </ScreenLink>
              </CardHeader>
              <CardContent className="px-0 pb-0 pt-0">
                <ContractsTable rows={queue.rows} hideValues={queue.valuesHidden} emptyDescription="Nenhum contrato aguardando o Financeiro. Novas vendas ganhas aparecem aqui." />
              </CardContent>
            </Card>
          ) : null}

          <nav aria-label="Telas do Financeiro" className="flex flex-col gap-3">
            {shortcuts.map((s) => (
              <ScreenLink key={s.href} href={s.href} className="flex min-h-[64px] items-center gap-3 rounded-lg border border-border bg-surface p-4 shadow-card transition-colors hover:border-border-strong hover:bg-surface-muted">
                <span className="flex size-9 shrink-0 items-center justify-center rounded-md bg-secondary-soft text-secondary-fg [&_svg]:size-4">{s.icon}</span>
                <span className="min-w-0 flex-1">
                  <span className="block text-sm font-medium">{s.label}</span>
                  <span className="block truncate text-xs text-muted">{s.text}</span>
                </span>
                <ArrowRight className="size-4 text-muted-light" aria-hidden />
              </ScreenLink>
            ))}
          </nav>
        </div>
      </PageContainer>
    </FinanceAccessProvider>
  );
}
