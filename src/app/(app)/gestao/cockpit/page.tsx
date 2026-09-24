import type { Metadata } from "next";
import Link from "next/link";
import { BarChart3, LayoutDashboard, Search } from "lucide-react";
import { requireRole } from "@/server/auth/session";
import { getCockpit } from "@/server/management/queries";
import { currentMonthKey, parsePeriod, periodOptions } from "@/server/kpis/queries";
import { PageContainer } from "@/components/layout/page-container";
import { PageHeader } from "@/components/ui/page-header";
import { SectionTitle } from "@/components/ui/section-title";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { KpiCard } from "@/components/kpis/kpi-card";
import { KpiTrendChart } from "@/components/kpis/kpi-trend-chart";
import { PeriodSelect } from "@/components/kpis/period-select";
import { InsightList } from "@/components/insights/insight-list";
import { AgentSuggestions } from "@/components/automations/agent-suggestions";
import { CockpitChain, CockpitFunnel } from "@/components/management/cockpit-chain";

export const metadata: Metadata = { title: "Cockpit da Diretoria" };

type SearchParams = Promise<Record<string, string | string[] | undefined>>;

/**
 * Cockpit da Diretoria: uma CADEIA, não uma coleção de gráficos. Faixa da empresa, a jornada
 * Marketing → Vendas → Financeiro → Implantação → CS → Suporte com saúde por estágio e handoffs,
 * onde está o gargalo, evolução de MRR/receita e o funil do período. Todo número abre o drill-down.
 */
export default async function CockpitPage({ searchParams }: { searchParams: SearchParams }) {
  const [, query] = await Promise.all([requireRole("diretoria"), searchParams]);
  const period = parsePeriod(query);
  const cockpit = await getCockpit(period);
  const mrr = cockpit.company.find((r) => r.key === "mrr");
  const revenue = cockpit.company.find((r) => r.key === "faturamento");

  return (
    <PageContainer>
      <PageHeader
        title="Cockpit da Diretoria"
        description={`${period.label} · comparado com ${cockpit.previous.label.toLowerCase()}`}
        breadcrumbs={[{ label: "Gestão", href: "/gestao" }, { label: "Cockpit da Diretoria" }]}
        badge={cockpit.current ? <Badge variant="info">Ao vivo</Badge> : <Badge variant="muted">Período fechado</Badge>}
        actions={
          <>
            <PeriodSelect options={periodOptions()} value={period.key} />
            <Button asChild variant="outline" className="h-11 md:h-9">
              <Link href="/gestao">
                <LayoutDashboard /> Gestor
              </Link>
            </Button>
            <Button asChild variant="outline" className="h-11 md:h-9">
              <Link href="/gestao/relatorios?tipo=diretoria">
                <BarChart3 /> Relatório
              </Link>
            </Button>
          </>
        }
      />

      <section className="mb-6" aria-label="Empresa">
        <SectionTitle title="Empresa" description="Cada cartão abre o drill-down do indicador até os registros de origem." />
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-6">
          {cockpit.company.map((r) => (
            <KpiCard key={r.key} result={r} compact eyebrow="Empresa" />
          ))}
        </div>
      </section>

      <section className="mb-6" aria-label="Cadeia da jornada">
        <SectionTitle
          title="Cadeia da jornada"
          description="Saúde de cada estágio pelos status dos seus indicadores; entre eles, a taxa de passagem e o volume parado no handoff (etapas com SLA violado)."
        />
        <CockpitChain stages={cockpit.stages} handoffs={cockpit.handoffs} />
      </section>

      <div className="mb-6 grid gap-5 xl:grid-cols-[minmax(0,1fr)_minmax(0,1fr)]">
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <Search className="size-4 text-muted" aria-hidden /> Onde está o gargalo
            </CardTitle>
            <CardDescription>Regras determinísticas sobre os indicadores do período versus o anterior, ordenadas por severidade.</CardDescription>
          </CardHeader>
          <CardContent className="pt-0">
            <InsightList insights={cockpit.bottlenecks} />
          </CardContent>
        </Card>
        <Card>
          <CardHeader>
            <CardTitle>Funil do período</CardTitle>
            <CardDescription>Volume em cada passagem da jornada no período; à direita, a fração da etapa anterior.</CardDescription>
          </CardHeader>
          <CardContent className="pt-0">
            <CockpitFunnel steps={cockpit.funnel} />
          </CardContent>
        </Card>
      </div>

      <AgentSuggestions kind="executivo" subjectId={/^\d{4}-\d{2}$/.test(period.key) ? period.key : currentMonthKey()} title="Sugestões do assistente executivo" className="mb-6" />

      <div className="grid gap-5 xl:grid-cols-2">
        <Card>
          <CardHeader>
            <CardTitle>Evolução do MRR</CardTitle>
            <CardDescription>Últimos 8 meses. Meses fechados vêm dos snapshots gravados; o mês atual é calculado ao vivo.</CardDescription>
          </CardHeader>
          <CardContent>
            <KpiTrendChart points={cockpit.mrrHistory} unit="moeda" />
            {mrr ? (
              <Link href={mrr.href} className="mt-2 inline-flex min-h-[44px] items-center text-sm text-brand hover:underline">
                Abrir drill-down do MRR
              </Link>
            ) : null}
          </CardContent>
        </Card>
        <Card>
          <CardHeader>
            <CardTitle>Evolução da receita (faturamento)</CardTitle>
            <CardDescription>Cobranças com vencimento em cada mês, últimos 8 meses.</CardDescription>
          </CardHeader>
          <CardContent>
            <KpiTrendChart points={cockpit.revenueHistory} unit="moeda" />
            {revenue ? (
              <Link href={revenue.href} className="mt-2 inline-flex min-h-[44px] items-center text-sm text-brand hover:underline">
                Abrir drill-down do faturamento
              </Link>
            ) : null}
          </CardContent>
        </Card>
      </div>
    </PageContainer>
  );
}
