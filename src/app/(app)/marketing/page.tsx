import type { Metadata } from "next";
import Link from "next/link";
import { CircleDollarSign, Megaphone, TrendingUp, UserCheck, Users } from "lucide-react";
import { requireUser } from "@/server/auth/session";
import { getMarketingOptions, getMarketingOverview } from "@/server/marketing/queries";
import { getMarketingWorkspace } from "@/server/marketing/workspace";
import { formatCurrency, formatDateKey, formatNumber, formatPercent } from "@/lib/format";
import { PageContainer } from "@/components/layout/page-container";
import { PageHeader } from "@/components/ui/page-header";
import { KpiStrip } from "@/components/ui/kpi-strip";
import { StatCard, type StatCardProps } from "@/components/ui/stat-card";
import { Button } from "@/components/ui/button";
import { PeriodSelect } from "@/components/marketing/period-select";
import { getCommunicationChannelStatus } from "@/server/integrations/status";
import { EvolutionChart, LeadsByCampaignChart } from "@/components/marketing/overview-charts";
import { parsePeriod } from "@/components/marketing/marketing-model";
import { NewLeadDialog } from "@/components/marketing/new-lead-dialog";
import { ImportLeadsDialog } from "@/components/marketing/import-leads-dialog";
import { LeadCapture } from "@/components/marketing/lead-capture";
import { CaptureAutomations, ChannelPerformance, ProspectHighlightCard } from "@/components/marketing/capture-panels";
import type { WorkspaceMetric } from "@/components/marketing/workspace-model";

export const metadata: Metadata = { title: "Marketing e Captação" };

type SearchParams = Promise<Record<string, string | string[] | undefined>>;

/** Variação relativa (%) entre períodos; `lowerIsBetter` inverte a cor (ex.: custo por lead). */
function relativeDelta(m: WorkspaceMetric, label: string, lowerIsBetter = false): StatCardProps["delta"] {
  if (m.value === null || m.previous === null || m.previous === 0) return undefined;
  const change = (m.value - m.previous) / m.previous;
  const direction = Math.abs(change) < 0.0005 ? "flat" : change > 0 ? "up" : "down";
  const good = lowerIsBetter ? change < 0 : change > 0;
  return { value: `${change > 0 ? "+" : ""}${(change * 100).toFixed(1).replace(".", ",")}%`, direction, tone: direction === "flat" ? "neutral" : good ? "success" : "danger", label };
}

/** Variação em pontos percentuais para taxas (0–1). */
function pointsDelta(m: WorkspaceMetric, label: string): StatCardProps["delta"] {
  if (m.value === null || m.previous === null) return undefined;
  const pp = (m.value - m.previous) * 100;
  const direction = Math.abs(pp) < 0.05 ? "flat" : pp > 0 ? "up" : "down";
  return { value: `${pp > 0 ? "+" : ""}${pp.toFixed(1).replace(".", ",")} p.p.`, direction, tone: direction === "flat" ? "neutral" : pp > 0 ? "success" : "danger", label };
}

/** Marketing e Captação (padrão 01): indicadores, origem, caixa de entrada, canais, automações e prospecção. */
export default async function MarketingOverviewPage({ searchParams }: { searchParams: SearchParams }) {
  const user = await requireUser();
  const sp = await searchParams;
  const period = parsePeriod(Array.isArray(sp.periodo) ? sp.periodo[0] : sp.periodo);
  const [data, overview, options] = await Promise.all([getMarketingWorkspace(user, period), getMarketingOverview(period), getMarketingOptions()]);
  const rangeLabel = `${formatDateKey(data.range.startKey)} a ${formatDateKey(data.range.endKey)}`;
  const vsLabel = `vs. ${data.previousLabel}`;
  const qualifiedPct = data.captured.value ? (data.qualified.value ?? 0) / data.captured.value : null;
  const canEditCampaigns = user.isManager || user.role === "marketing";

  const kpis = (compact: boolean) => (
    <>
        <StatCard compact={compact} label="Leads captados" value={formatNumber(data.captured.value)} icon={<Users />} tone="brand" href={data.hrefs.captured} delta={relativeDelta(data.captured, vsLabel)} hint="Nenhum no período anterior" />
        <StatCard
          compact={compact}
          label="Leads qualificados"
          value={
            <span className="inline-flex items-baseline gap-2">
              {formatNumber(data.qualified.value)}
              {qualifiedPct !== null ? <span className="text-sm font-medium text-muted">{formatPercent(qualifiedPct)}</span> : null}
            </span>
          }
          icon={<UserCheck />}
          tone="success"
          href={data.hrefs.qualified}
          delta={relativeDelta(data.qualified, vsLabel)}
          hint="dos captados no período"
        />
        <StatCard
          compact={compact}
          label="Custo por lead"
          value={data.cpl.value === null ? "—" : formatCurrency(data.cpl.value)}
          icon={<CircleDollarSign />}
          tone="warning"
          href="/marketing/campanhas"
          delta={relativeDelta(data.cpl, vsLabel, true)}
          hint={data.cpl.value === null ? "Sem investimento no período" : `Investimento ${formatCurrency(overview.investment)}`}
        />
        <StatCard
          compact={compact}
          label="Conversão para vendas"
          value={data.conversion.value === null ? "—" : formatPercent(data.conversion.value)}
          icon={<TrendingUp />}
          tone="info"
          href={data.hrefs.conversion}
          delta={pointsDelta(data.conversion, vsLabel)}
          hint="Leads do período que viraram oportunidade"
        />
    </>
  );

  return (
    <PageContainer size="full">
      <PageHeader
        title="Marketing e Captação de Leads"
        description={`Capture, qualifique e distribua oportunidades de todos os canais · ${rangeLabel}`}
        breadcrumbs={[{ label: "Marketing" }, { label: "Visão Geral" }]}
        actions={
          <>
            <NewLeadDialog options={options} currentUserId={user.id} />
            <ImportLeadsDialog options={options} />
            {canEditCampaigns ? (
              <Button asChild variant="outline">
                <Link href="/marketing/campanhas?campanha=nova">
                  <Megaphone /> Criar campanha
                </Link>
              </Button>
            ) : null}
          </>
        }
      >
        <PeriodSelect value={period} />
      </PageHeader>

      {/* Celular: cards compactos em 2 colunas; a partir de md, cards completos. */}
      <KpiStrip columns={4} mobileColumns={2} className="md:hidden">
        {kpis(true)}
      </KpiStrip>
      <KpiStrip columns={4} className="hidden md:grid">
        {kpis(false)}
      </KpiStrip>

      <div className="grid gap-4 xl:grid-cols-[minmax(0,1fr)_380px] 2xl:grid-cols-[minmax(0,1fr)_420px]">
        <LeadCapture sources={data.sources} leads={data.inbox} sellers={data.sellers} channels={getCommunicationChannelStatus()} />
        <div className="flex min-w-0 flex-col gap-4">
          <ChannelPerformance sources={data.sources} reportHref="/gestao/relatorios" />
          <CaptureAutomations rules={data.automations} canToggle={data.canToggleAutomations} />
          <ProspectHighlightCard list={data.prospect} otherActiveLists={data.otherActiveLists} />
        </div>
      </div>

      <div className="mt-4 grid gap-4 lg:grid-cols-2">
        <EvolutionChart data={overview.evolution} bucket={overview.range.bucket} />
        <LeadsByCampaignChart data={overview.byCampaign} />
      </div>
    </PageContainer>
  );
}
