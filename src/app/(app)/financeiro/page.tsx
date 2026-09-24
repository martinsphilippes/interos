import type { Metadata } from "next";
import Link from "next/link";
import { redirect } from "next/navigation";
import { ArrowRight, FileSignature, PenLine, Receipt, Repeat, Wallet } from "lucide-react";
import { canAccessModule, requireUser } from "@/server/auth/session";
import { getFinanceOverview, listContracts } from "@/server/finance/queries";
import { canOperateFinance } from "@/server/finance/schemas";
import { formatCurrency } from "@/lib/format";
import { PageContainer } from "@/components/layout/page-container";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { PageHeader } from "@/components/ui/page-header";
import { ContractsTable } from "@/components/finance/contracts-table";
import { FinanceStats } from "@/components/finance/finance-stats";
import { WonWithoutContractList } from "@/components/finance/won-without-contract";

export const metadata: Metadata = { title: "Financeiro" };

/**
 * Visão geral do Financeiro: indicadores com drill-down, vendas ganhas sem contrato, a fila de contratos
 * em aberto (ordenada por pendência e SLA) e atalhos para as demais telas do módulo.
 */
export default async function FinanceOverviewPage() {
  const user = await requireUser();
  if (!canAccessModule(user, "financeiro")) redirect("/meu-dia?erro=sem-permissao");
  const [overview, queue] = await Promise.all([getFinanceOverview(), listContracts({ status: "abertos" })]);
  const canOperate = canOperateFinance(user);

  const shortcuts = [
    { href: "/financeiro/contratos", label: "Contratos", icon: <FileSignature />, text: `${queue.rows.length} em aberto · ${overview.activeContracts} liberados` },
    { href: "/financeiro/assinaturas", label: "Assinaturas", icon: <PenLine />, text: `${overview.counts.assinatura} aguardando assinatura` },
    { href: "/financeiro/cobrancas", label: "Cobranças", icon: <Receipt />, text: `${formatCurrency(overview.receivedMonth)} recebido no mês` },
    { href: "/financeiro/contas-a-receber", label: "Contas a Receber", icon: <Wallet />, text: `${formatCurrency(overview.overdue.amount)} vencido` },
    { href: "/financeiro/recorrencia", label: "Recorrência", icon: <Repeat />, text: `MRR ${formatCurrency(overview.mrrActive)}` },
  ];

  return (
    <PageContainer>
      <PageHeader title="Financeiro" description="Portão de qualidade da jornada: contrato, assinatura, cobrança e liberação para a implantação." breadcrumbs={[{ label: "Financeiro" }]} />

      <div className="mb-6">
        <FinanceStats overview={overview} />
      </div>

      {overview.wonWithoutContract.length > 0 ? (
        <Card className="mb-6 border-warning/40">
          <CardHeader>
            <CardTitle>Vendas ganhas sem contrato</CardTitle>
            <CardDescription>Negócios fechados em Vendas que ainda não chegaram ao Financeiro.</CardDescription>
          </CardHeader>
          <CardContent className="pt-0">
            <WonWithoutContractList items={overview.wonWithoutContract} canOperate={canOperate} />
          </CardContent>
        </Card>
      ) : null}

      <div className="grid gap-4 lg:grid-cols-3">
        <Card className="overflow-hidden lg:col-span-2">
          <CardHeader className="flex-row items-start justify-between gap-3">
            <div>
              <CardTitle>Fila do Financeiro</CardTitle>
              <CardDescription>Contratos em aberto: pendências e SLA mais apertado primeiro.</CardDescription>
            </div>
            <Button asChild variant="outline" size="sm" className="h-10 md:h-8">
              <Link href="/financeiro/contratos">
                Ver todos <ArrowRight />
              </Link>
            </Button>
          </CardHeader>
          <CardContent className="px-0 pb-0 pt-0">
            <ContractsTable rows={queue.rows} emptyDescription="Nenhum contrato aguardando o Financeiro. Novas vendas ganhas aparecem aqui." />
          </CardContent>
        </Card>

        <nav aria-label="Telas do Financeiro" className="flex flex-col gap-3">
          {shortcuts.map((s) => (
            <Link key={s.href} href={s.href} className="flex min-h-[64px] items-center gap-3 rounded-lg border border-border bg-surface p-4 shadow-card transition-colors hover:border-border-strong hover:bg-surface-muted">
              <span className="flex size-9 shrink-0 items-center justify-center rounded-md bg-secondary-soft text-secondary-fg [&_svg]:size-4">{s.icon}</span>
              <span className="min-w-0 flex-1">
                <span className="block text-sm font-medium">{s.label}</span>
                <span className="block truncate text-xs text-muted">{s.text}</span>
              </span>
              <ArrowRight className="size-4 text-muted-light" aria-hidden />
            </Link>
          ))}
        </nav>
      </div>
    </PageContainer>
  );
}
