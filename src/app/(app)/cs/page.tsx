import type { Metadata } from "next";
import Link from "next/link";
import { redirect } from "next/navigation";
import { AlertTriangle, BadgeCheck, Briefcase, CalendarClock, CircleDollarSign, HeartPulse, MessageSquareOff, RefreshCw, ShieldAlert, TrendingUp } from "lucide-react";
import { canAccessModule, requireUser } from "@/server/auth/session";
import { getPortfolio } from "@/server/cs/queries";
import { formatCurrency, formatNumber, formatPercent } from "@/lib/format";
import { PageContainer } from "@/components/layout/page-container";
import { Button } from "@/components/ui/button";
import { PageHeader } from "@/components/ui/page-header";
import { StatCard } from "@/components/ui/stat-card";
import { PortfolioFilters, PortfolioTable } from "@/components/cs/portfolio-view";

export const metadata: Metadata = { title: "Carteira de CS" };

type SearchParams = Promise<Record<string, string | string[] | undefined>>;

/** Carteira de Customer Success: indicadores com drill-down, filtros e a tabela de clientes com ações. */
export default async function CsPortfolioPage({ searchParams }: { searchParams: SearchParams }) {
  const user = await requireUser();
  if (!canAccessModule(user, "cs")) redirect("/meu-dia?erro=sem-permissao");
  const data = await getPortfolio(user, await searchParams);
  const { stats, scope } = data;
  const q = (extra: Record<string, string>) => `/cs?${new URLSearchParams({ responsavel: scope.param, ...extra }).toString()}`;
  const pct = (n: number) => (stats.clients > 0 ? formatPercent(n / stats.clients) : "—");
  const scopeLabel = scope.ownerId ? `Carteira de ${data.owners.find((o) => o.id === scope.ownerId)?.name ?? "responsável"}` : "Carteira de toda a equipe";

  return (
    <PageContainer>
      <PageHeader
        title="Carteira"
        description={`${scopeLabel} · clientes ativos e recém-implantados acompanhados pelo Customer Success`}
        breadcrumbs={[{ label: "Customer Success" }, { label: "Carteira" }]}
        actions={
          <>
            <Button asChild variant="outline" size="sm">
              <Link href="/cs/riscos">
                <ShieldAlert /> Riscos
              </Link>
            </Button>
            <Button asChild variant="outline" size="sm">
              <Link href="/cs/churn">Churn</Link>
            </Button>
          </>
        }
      />

      <div className="mb-3 grid grid-cols-2 gap-3 md:grid-cols-3 xl:grid-cols-5">
        <StatCard label="Clientes na carteira" value={formatNumber(stats.clients)} icon={<Briefcase />} tone="info" href={q({})} hint={stats.activationPending > 0 ? `${stats.activationPending} aguardando ativação` : undefined} compact />
        <StatCard label="MRR da carteira" value={formatCurrency(stats.mrr)} icon={<CircleDollarSign />} tone="success" hint={`ARR ${formatCurrency(stats.mrr * 12, true)}`} compact />
        <StatCard label="Saudáveis" value={`${stats.byLevel.saudavel} · ${pct(stats.byLevel.saudavel)}`} icon={<HeartPulse />} tone="success" href={q({ saude: "saudavel" })} compact />
        <StatCard label="Atenção" value={`${stats.byLevel.atencao} · ${pct(stats.byLevel.atencao)}`} icon={<HeartPulse />} tone="warning" href={q({ saude: "atencao" })} compact />
        <StatCard label="Risco" value={`${stats.byLevel.risco} · ${pct(stats.byLevel.risco)}`} icon={<AlertTriangle />} tone="danger" href={q({ saude: "risco" })} hint={stats.unscored > 0 ? `${stats.unscored} sem cálculo` : undefined} compact />
      </div>
      <div className="mb-6 grid grid-cols-2 gap-3 md:grid-cols-4">
        <StatCard label="Sem interação há 30+ dias" value={formatNumber(stats.noInteraction30)} icon={<MessageSquareOff />} tone={stats.noInteraction30 > 0 ? "warning" : "success"} href={q({ sem_interacao: "1" })} compact />
        <StatCard label="Próximas interações vencidas" value={formatNumber(stats.overdueNext)} icon={<CalendarClock />} tone={stats.overdueNext > 0 ? "danger" : "success"} href={`/cs/checkpoints?responsavel=${scope.param}`} compact />
        <StatCard label="Renovações em 60 dias" value={formatNumber(stats.renewals60)} icon={<RefreshCw />} tone={stats.renewals60 > 0 ? "warning" : "neutral"} href="/cs/renovacoes" compact />
        <StatCard label="Upsell em aberto" value={formatNumber(stats.openUpsell)} icon={<TrendingUp />} tone="info" href={`/cs/upsell?responsavel=${scope.param}`} compact />
      </div>

      <div className="mb-4 flex flex-col gap-3 md:flex-row md:items-center md:justify-between">
        <PortfolioFilters data={data} />
        {stats.activationPending > 0 ? (
          <p className="inline-flex items-center gap-1.5 text-sm text-muted">
            <BadgeCheck className="size-4 text-secondary" /> {stats.activationPending} cliente(s) na etapa de ativação
          </p>
        ) : null}
      </div>
      <p className="mb-2 text-xs text-muted">{data.rows.length} de {stats.clients} cliente(s)</p>
      <PortfolioTable rows={data.rows} />
    </PageContainer>
  );
}
