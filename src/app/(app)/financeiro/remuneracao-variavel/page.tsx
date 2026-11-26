import type { Metadata } from "next";
import { Award, BadgePercent, Gift, Wallet } from "lucide-react";
import { requireScreen } from "@/server/auth/session";
import { getVariablePayData } from "@/server/variable-pay/queries";
import { formatCurrency, formatNumber } from "@/lib/format";
import { PageContainer } from "@/components/layout/page-container";
import { PageHeader } from "@/components/ui/page-header";
import { StatCard } from "@/components/ui/stat-card";
import { VariablePayView } from "@/components/commissions/variable-pay-view";

export const metadata: Metadata = { title: "Remuneração variável" };

type SearchParams = Promise<Record<string, string | string[] | undefined>>;

/**
 * Financeiro › Remuneração variável: por colaborador e competência, comissões + bônus + prêmios de vendas, com
 * fechamento (valores congelados) para conferir antes do pagamento. Escopo = o de Comissões (o próprio, a equipe ou
 * todos). Cada valor continua calculado no seu módulo; aqui só se consolida.
 */
export default async function VariablePayPage({ searchParams }: { searchParams: SearchParams }) {
  const user = await requireScreen("financeiro.remuneracao-variavel");
  const sp = await searchParams;
  const comp = Array.isArray(sp.competencia) ? sp.competencia[0] : sp.competencia;
  const data = await getVariablePayData(user, comp);
  return (
    <PageContainer size="full" className="max-w-[1680px]">
      <PageHeader
        title="Remuneração variável"
        description={`Comissões, bônus e prêmios por colaborador · ${data.label}${data.kind === "own" ? " · só a sua" : data.kind === "team" ? " · sua equipe" : ""}`}
        breadcrumbs={[{ label: "Financeiro", href: "/financeiro" }, { label: "Remuneração variável" }]}
      />
      <div className="mb-5 grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
        <StatCard label="Total a pagar" value={formatCurrency(data.totals.total)} icon={<Wallet />} tone="brand" hint={`${formatNumber(data.totals.people)} colaborador(es)`} compact />
        <StatCard label="Comissões adquiridas" value={formatCurrency(data.totals.commissions)} icon={<BadgePercent />} tone="success" hint={`+ ${formatCurrency(data.totals.potential)} pendentes`} href="/financeiro/comissoes" compact />
        <StatCard label="Bônus" value={formatCurrency(data.totals.bonus)} icon={<Award />} tone="info" href="/performance/bonus" compact />
        <StatCard label="Prêmios de vendas" value={formatCurrency(data.totals.prizes)} icon={<Gift />} tone="neutral" hint="metas do mês batidas" compact />
      </div>
      <VariablePayView data={data} />
    </PageContainer>
  );
}
