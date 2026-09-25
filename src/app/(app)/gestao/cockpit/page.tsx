import type { Metadata } from "next";
import Link from "next/link";
import { Building2, CircleDollarSign, Goal, LayoutDashboard, Search, ShoppingCart, Users, Wallet, BarChart3 } from "lucide-react";
import { requireRole } from "@/server/auth/session";
import { getCockpit } from "@/server/management/queries";
import { currentMonthKey, listFormulas, parsePeriod, periodOptions, type KpiResult } from "@/server/kpis/queries";
import { getOperationHealthConfig } from "@/server/kpis/operation-health";
import { formatKpiDelta, formatKpiValue } from "@/server/kpis/schemas";
import { formatCurrency, formatNumber, formatPercent } from "@/lib/format";
import { PageContainer } from "@/components/layout/page-container";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardLink, CardTitle } from "@/components/ui/card";
import { FilterField } from "@/components/ui/filter-bar";
import { KpiStrip } from "@/components/ui/kpi-strip";
import { PageHeader } from "@/components/ui/page-header";
import { SectionTitle } from "@/components/ui/section-title";
import { StatCard } from "@/components/ui/stat-card";
import { PeriodSelect } from "@/components/kpis/period-select";
import { UrlSelect } from "@/components/ui/url-select";
import { OperationHealthCard } from "@/components/kpis/operation-health-card";
import { InsightList } from "@/components/insights/insight-list";
import { AgentSuggestions } from "@/components/automations/agent-suggestions";
import { CockpitChain, CockpitFunnel } from "@/components/management/cockpit-chain";
import { DepartmentPerformanceTable, OperationSummary, SalesFunnel, StrategicAlerts } from "@/components/management/cockpit-panels";
import { RevenueChart } from "@/components/management/revenue-chart";

export const metadata: Metadata = { title: "Cockpit da Diretoria" };

type SearchParams = Promise<Record<string, string | string[] | undefined>>;

/** Variação do indicador vs. período anterior no formato do StatCard (verde = melhorou, pelo sentido do indicador). */
function deltaOf(r: KpiResult | null, relative = true): { value: string; direction: "up" | "down" | "flat"; tone?: "success" | "danger" | "neutral"; label: string } | undefined {
  const t = r?.trend;
  if (!r || !t || t.delta === null || !t.direction) return undefined;
  const value = relative && t.deltaPct !== null ? formatPercent(Math.abs(t.deltaPct)) : formatKpiDelta(Math.abs(t.delta), r.kpi.unit, r.kpi.formulaMeta?.suffix).replace(/^[+−]/, "");
  return { value, direction: t.direction, tone: t.favorable === null ? "neutral" : t.favorable ? "success" : "danger", label: `vs. ${t.period.label.toLowerCase()}` };
}

/**
 * Cockpit da Diretoria: "onde está o problema da empresa?". Faixa de indicadores da empresa com variação,
 * evolução da receita, Saúde da operação explicável, desempenho por departamento, funil comercial, operação,
 * alertas estratégicos e, abaixo, a cadeia da operação Marketing → Suporte para achar o gargalo.
 */
export default async function CockpitPage({ searchParams }: { searchParams: SearchParams }) {
  const [user, query] = await Promise.all([requireRole("diretoria"), searchParams]);
  const period = parsePeriod(query);
  const [cockpit, healthConfig] = await Promise.all([getCockpit(period), user.isDirector ? getOperationHealthConfig() : Promise.resolve(null)]);
  const { strip } = cockpit;
  const goal = strip.globalGoal;
  const goalDelta = goal.attainment !== null && goal.previous !== null ? goal.attainment - goal.previous : null;
  const kpiOptions = listFormulas()
    .map((f) => ({ key: f.key, name: f.label }))
    .sort((a, b) => a.name.localeCompare(b.name, "pt-BR"));

  return (
    <PageContainer size="full">
      <PageHeader
        title="Cockpit da Diretoria"
        description={`Visão estratégica e consolidada da operação da Intercert · ${period.label} comparado com ${cockpit.previous.label.toLowerCase()}`}
        breadcrumbs={[{ label: "Gestão", href: "/gestao" }, { label: "Cockpit da Diretoria" }]}
        badge={cockpit.current ? <Badge variant="info">Ao vivo</Badge> : <Badge variant="muted">Período fechado</Badge>}
        actions={
          <div className="flex w-full flex-wrap items-end gap-2 md:w-auto">
            <FilterField label="Empresa" className="w-full sm:w-60">
              <UrlSelect param="empresa" label="Empresa" value="intercert" options={[{ value: "intercert", label: "Intercert — Consolidado" }]} icon={<Building2 />} disabled />
            </FilterField>
            <FilterField label="Período" className="w-full sm:w-56">
              <PeriodSelect options={periodOptions()} value={period.key} className="w-full min-w-0" />
            </FilterField>
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
          </div>
        }
      />

      <KpiStrip columns={5} mobileColumns={2}>
        <StatCard
          label="Receita recorrente"
          value={formatKpiValue(strip.mrr?.value ?? null, "moeda")}
          icon={<CircleDollarSign />}
          tone="brand"
          delta={deltaOf(strip.mrr)}
          href={strip.mrr?.href}
          compact
        />
        <StatCard
          label="Novas vendas"
          value={formatNumber(strip.newSales?.value ?? null)}
          icon={<ShoppingCart />}
          tone="info"
          delta={deltaOf(strip.newSales, false)}
          hint={strip.soldRevenue ? `${formatCurrency(strip.soldRevenue.value)} vendidos` : undefined}
          href={strip.newSales?.href}
          compact
        />
        <StatCard label="Clientes ativos" value={formatNumber(strip.activeClients?.value ?? null)} icon={<Users />} tone="secondary" delta={deltaOf(strip.activeClients, false)} href={strip.activeClients?.href} compact />
        <StatCard
          label="Receita recebida"
          value={formatKpiValue(strip.received?.value ?? null, "moeda")}
          icon={<Wallet />}
          tone="purple"
          delta={deltaOf(strip.received)}
          hint="Resultado operacional exige custos, ainda não registrados"
          href={strip.received?.href}
          compact
        />
        <StatCard
          label="Meta global"
          value={formatPercent(goal.attainment)}
          icon={<Goal />}
          tone="brand"
          valueTone
          progress={goal.attainment === null ? undefined : Math.min(100, goal.attainment * 100)}
          delta={goalDelta === null ? undefined : { value: `${formatNumber(Math.round(Math.abs(goalDelta) * 1000) / 10)} p.p.`, direction: goalDelta > 0 ? "up" : goalDelta < 0 ? "down" : "flat", label: `vs. ${cockpit.previous.label.toLowerCase()}` }}
          hint={goal.count === 0 ? "Sem metas da empresa no período" : `${goal.count} meta(s) da empresa`}
          href={goal.href}
          compact
        />
      </KpiStrip>

      <div className="mb-4 grid grid-cols-1 gap-4 lg:grid-cols-2 2xl:grid-cols-[minmax(0,1.15fr)_minmax(0,0.85fr)_minmax(0,1.2fr)]">
        <Card>
          <CardHeader className="flex-row items-center justify-between gap-3">
            <CardTitle>Evolução da receita</CardTitle>
            {strip.mrr ? <CardLink href={strip.mrr.href} /> : null}
          </CardHeader>
          <CardContent className="pt-0">
            <RevenueChart mrr={cockpit.mrrHistory} revenue={cockpit.revenueHistory} />
          </CardContent>
        </Card>
        <Card className="p-5">
          <OperationHealthCard health={cockpit.health} config={healthConfig ? { value: healthConfig, kpis: kpiOptions } : undefined} />
        </Card>
        <Card className="lg:col-span-2 2xl:col-span-1">
          <CardHeader className="flex-row items-center justify-between gap-3">
            <CardTitle>Desempenho por departamento</CardTitle>
            <CardLink href={`/gestao?periodo=${encodeURIComponent(period.key)}`} />
          </CardHeader>
          <CardContent className="pt-0">
            <DepartmentPerformanceTable rows={cockpit.departments} />
          </CardContent>
        </Card>
      </div>

      <div className="mb-6 grid grid-cols-1 gap-4 lg:grid-cols-2 2xl:grid-cols-[minmax(0,0.9fr)_minmax(0,1.1fr)_minmax(0,1.1fr)]">
        <Card>
          <CardHeader className="flex-row items-center justify-between gap-3">
            <CardTitle>Funil comercial</CardTitle>
            <CardLink href="/vendas/pipeline" />
          </CardHeader>
          <CardContent className="pt-0">
            <SalesFunnel funnel={cockpit.salesFunnel} />
          </CardContent>
        </Card>
        <Card>
          <CardHeader className="flex-row items-center justify-between gap-3">
            <CardTitle>Operação</CardTitle>
            <CardLink href={`/sla?periodo=${encodeURIComponent(period.key)}`}>Ver SLA</CardLink>
          </CardHeader>
          <CardContent className="pt-0">
            <OperationSummary operation={cockpit.operation} />
          </CardContent>
        </Card>
        <Card className="lg:col-span-2 2xl:col-span-1">
          <CardHeader className="flex-row items-center justify-between gap-3">
            <CardTitle>Alertas estratégicos</CardTitle>
            <CardLink href="#gargalos">Ver todos</CardLink>
          </CardHeader>
          <CardContent className="pt-0">
            <StrategicAlerts insights={cockpit.bottlenecks} />
          </CardContent>
        </Card>
      </div>

      <section className="mb-6" aria-label="Cadeia da operação">
        <SectionTitle
          title="Cadeia da operação"
          description="Marketing → Vendas → Financeiro → Implantação → CS → Suporte: saúde de cada estágio pelos status dos seus indicadores; entre eles, a taxa de passagem e o volume parado no handoff (etapas com SLA violado)."
        />
        <CockpitChain stages={cockpit.stages} handoffs={cockpit.handoffs} />
      </section>

      <div className="mb-6 grid grid-cols-1 gap-5 xl:grid-cols-[minmax(0,1fr)_minmax(0,1fr)]">
        <Card id="gargalos" className="scroll-mt-20">
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <Search className="size-4 text-muted" aria-hidden /> Onde está o gargalo
            </CardTitle>
            <CardDescription>Regras determinísticas sobre os indicadores do período versus o anterior, com evidências e ação sugerida.</CardDescription>
          </CardHeader>
          <CardContent className="pt-0">
            <InsightList insights={cockpit.bottlenecks} />
          </CardContent>
        </Card>
        <Card>
          <CardHeader>
            <CardTitle>Funil da jornada</CardTitle>
            <CardDescription>Volume em cada passagem da jornada no período; à direita, a fração da etapa anterior.</CardDescription>
          </CardHeader>
          <CardContent className="pt-0">
            <CockpitFunnel steps={cockpit.funnel} />
          </CardContent>
        </Card>
      </div>

      <AgentSuggestions kind="executivo" subjectId={/^\d{4}-\d{2}$/.test(period.key) ? period.key : currentMonthKey()} title="Sugestões do assistente executivo" className="mb-6" />
    </PageContainer>
  );
}
