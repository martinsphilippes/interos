import type { Metadata } from "next";
import Link from "next/link";
import { AlertTriangle, BadgeCheck, CircleDollarSign, Percent, Target, UserPlus, UserX } from "lucide-react";
import { requireUser } from "@/server/auth/session";
import { getMarketingOverview } from "@/server/marketing/queries";
import { formatCurrency, formatDateKey, formatNumber, formatPercent } from "@/lib/format";
import { PageContainer } from "@/components/layout/page-container";
import { PageHeader } from "@/components/ui/page-header";
import { StatCard } from "@/components/ui/stat-card";
import { Button } from "@/components/ui/button";
import { PeriodSelect } from "@/components/marketing/period-select";
import { EvolutionChart, LeadsByCampaignChart, LeadsByOriginChart, TemperatureDonut } from "@/components/marketing/overview-charts";
import { NeedsActionList } from "@/components/marketing/needs-action-list";
import { parsePeriod } from "@/components/marketing/marketing-model";

export const metadata: Metadata = { title: "Marketing — Visão Geral" };

type SearchParams = Promise<Record<string, string | string[] | undefined>>;

/** Visão Geral do Marketing: indicadores do período com drill-down para a lista de leads. */
export default async function MarketingOverviewPage({ searchParams }: { searchParams: SearchParams }) {
  await requireUser();
  const sp = await searchParams;
  const period = parsePeriod(Array.isArray(sp.periodo) ? sp.periodo[0] : sp.periodo);
  const data = await getMarketingOverview(period);
  const rangeLabel = `${formatDateKey(data.range.startKey)} a ${formatDateKey(data.range.endKey)}`;

  return (
    <PageContainer>
      <PageHeader
        title="Marketing"
        description={`Captação e qualificação de leads · ${rangeLabel}`}
        breadcrumbs={[{ label: "Marketing" }, { label: "Visão Geral" }]}
        actions={
          <Button asChild variant="outline">
            <Link href="/marketing/leads">
              <UserPlus /> Ver leads
            </Link>
          </Button>
        }
      >
        <PeriodSelect value={period} />
      </PageHeader>

      <div className="mb-5 grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <StatCard label="Leads captados" value={formatNumber(data.leads.value)} icon={<UserPlus />} tone="info" href={data.leads.href} hint={data.range.label} compact />
        <StatCard label="MQLs (qualificados)" value={formatNumber(data.mqls.value)} icon={<BadgeCheck />} tone="success" href={data.mqls.href} hint="Qualificados no período" compact />
        <StatCard label="Desqualificados" value={formatNumber(data.disqualified.value)} icon={<UserX />} tone="neutral" href={data.disqualified.href} hint="Dos leads captados no período" compact />
        <StatCard
          label="Sem contato há +24h"
          value={formatNumber(data.noContact24h.value)}
          icon={<AlertTriangle />}
          tone={data.noContact24h.value > 0 ? "danger" : "success"}
          href={data.noContact24h.href}
          hint="Leads abertos nunca contatados"
          compact
        />
        <StatCard label="Conversão lead → MQL" value={formatPercent(data.leadToMql)} icon={<Percent />} tone="info" href={data.leadToMqlHref} hint="Leads do período que viraram MQL" compact />
        <StatCard label="Conversão MQL → oportunidade" value={formatPercent(data.mqlToOpportunity)} icon={<Target />} tone="info" href={data.mqlToOpportunityHref} hint="MQLs com oportunidade em Vendas" compact />
        <StatCard
          label="CPL (custo por lead)"
          value={data.cpl === null ? "—" : formatCurrency(data.cpl)}
          icon={<CircleDollarSign />}
          tone="neutral"
          href="/marketing/campanhas"
          hint={`Investimento no período: ${formatCurrency(data.investment)}`}
          compact
        />
        <StatCard label="Investimento no período" value={formatCurrency(data.investment)} icon={<CircleDollarSign />} tone="neutral" href="/marketing/campanhas" hint="Gasto das campanhas, proporcional aos dias" compact />
      </div>

      <div className="mb-5 grid gap-4 lg:grid-cols-2">
        <EvolutionChart data={data.evolution} bucket={data.range.bucket} />
        <TemperatureDonut data={data.byTemperature} />
        <LeadsByOriginChart data={data.byOrigin} />
        <LeadsByCampaignChart data={data.byCampaign} />
      </div>

      <NeedsActionList items={data.needsAction} />
    </PageContainer>
  );
}
