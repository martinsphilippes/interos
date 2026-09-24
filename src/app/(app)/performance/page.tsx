import type { Metadata } from "next";
import Link from "next/link";
import { ChevronRight, ClipboardCheck, Gauge, ListChecks, ShieldCheck, Star, Target, TrendingUp } from "lucide-react";
import { requireUser } from "@/server/auth/session";
import { getMyPerformance, getPerformanceAccess, resolveSubjectId } from "@/server/performance/queries";
import { parsePeriod, periodOptions } from "@/server/kpis/queries";
import { DEPARTMENT_LABELS } from "@/domain/constants";
import { formatNumber, formatPercent } from "@/lib/format";
import { PageContainer } from "@/components/layout/page-container";
import { Avatar } from "@/components/ui/avatar";
import { Card, CardContent, CardDescription, CardHeader, CardLink, CardTitle } from "@/components/ui/card";
import { EmptyState } from "@/components/ui/empty-state";
import { FilterField } from "@/components/ui/filter-bar";
import { KpiStrip } from "@/components/ui/kpi-strip";
import { PageHeader } from "@/components/ui/page-header";
import { ProgressList } from "@/components/ui/progress-list";
import { SectionTitle } from "@/components/ui/section-title";
import { StatCard } from "@/components/ui/stat-card";
import { toneForPercent, type Tone } from "@/components/ui/tone";
import { KpiCard } from "@/components/kpis/kpi-card";
import { PerformanceIndexSettingsButton } from "@/components/kpis/performance-index-settings";
import { getPerformanceIndexConfig } from "@/server/kpis/operation-health";
import { PeriodSelect } from "@/components/kpis/period-select";
import { BonusSummaryCard } from "@/components/performance/bonus-summary";
import { GamificationCard } from "@/components/performance/gamification-card";
import { IndexComparison, MyGoalsTable, PerformanceIndexCard } from "@/components/performance/performance-panels";
import { PerformanceEvolutionChart } from "@/components/performance/performance-evolution-chart";
import { SalesPerformanceBlock } from "@/components/performance/sales-performance";
import { UserSelect } from "@/components/performance/user-select";

export const metadata: Metadata = { title: "Meu Desempenho" };

type SearchParams = Promise<Record<string, string | string[] | undefined>>;
const one = (v: string | string[] | undefined) => (Array.isArray(v) ? v[0] : v);

type Delta = {
  value: string;
  direction: "up" | "down" | "flat";
  label: string;
};

/** Variação em pontos percentuais entre duas frações (0,86 − 0,80 → "6 p.p."). */
function ppDelta(current: number | null, previous: number | null, label: string): Delta | undefined {
  if (current === null || previous === null) return undefined;
  const d = (current - previous) * 100;
  return {
    value: `${formatNumber(Math.round(Math.abs(d) * 10) / 10)} p.p.`,
    direction: d > 0.05 ? "up" : d < -0.05 ? "down" : "flat",
    label,
  };
}

function statusTone(attainment: number | null): Tone {
  if (attainment === null) return "neutral";
  return attainment >= 1 ? "success" : attainment >= 0.85 ? "warning" : "danger";
}

/**
 * Meu Desempenho: meta geral, produtividade, qualidade, SLA e tarefas do período com variação; evolução mensal e
 * Índice de desempenho (Eficiência, Entrega, Qualidade); minhas metas; indicadores do mês por área; comparativo;
 * indicadores da função com drill-down; blocos da função (vendas: comissão/simulador; suporte/implantação/
 * financeiro: bônus); ranking e tarefas. Gestor/diretoria/admin escolhem o colaborador (?usuario=).
 */
export default async function MeuDesempenhoPage({ searchParams }: { searchParams: SearchParams }) {
  const [viewer, query] = await Promise.all([requireUser(), searchParams]);
  const period = parsePeriod(query);
  const access = await getPerformanceAccess(viewer);
  const subjectId = resolveSubjectId(viewer, access, one(query.usuario));
  const [data, indexConfig] = await Promise.all([getMyPerformance(subjectId, period), viewer.isDirector ? getPerformanceIndexConfig() : Promise.resolve(null)]);
  const self = subjectId === viewer.id;

  if (!data) {
    return (
      <PageContainer>
        <PageHeader title="Meu Desempenho" />
        <Card>
          <EmptyState icon={<Gauge />} title="Colaborador não encontrado" description="O cadastro deste colaborador não existe mais." />
        </Card>
      </PageContainer>
    );
  }

  const { scorecard, user, index, previousIndex } = data;
  const periodQuery = `periodo=${encodeURIComponent(period.key)}${self ? "" : `&usuario=${user.id}`}`;
  const prevLabel = `vs. ${data.previous.label.toLowerCase()}`;
  const onTime = data.tasks.onTime;
  const quality = index?.dimensions.find((d) => d.key === "qualidade")?.score ?? null;
  const prevQuality = previousIndex?.dimensions.find((d) => d.key === "qualidade")?.score ?? null;
  const tasksDelta = data.taskSummary.done - data.taskSummary.previousDone;
  const firstName = user.name.split(" ")[0];
  const role = user.jobTitle ?? DEPARTMENT_LABELS[user.departmentId];

  return (
    <PageContainer size="full">
      <PageHeader
        title={self ? "Meu Desempenho" : `Desempenho de ${user.name}`}
        description="Acompanhe suas metas, produtividade e evolução"
        breadcrumbs={[{ label: "Performance" }, { label: "Meu Desempenho" }]}
        actions={
          <div className="flex w-full flex-wrap items-end gap-2 md:w-auto">
            {access.canViewOthers ? (
              <FilterField label="Colaborador" className="w-full sm:w-60">
                <UserSelect people={access.people} value={user.id} className="w-full" />
              </FilterField>
            ) : null}
            <FilterField label="Período" className="w-full sm:w-56">
              <PeriodSelect options={periodOptions(12)} value={period.key} className="w-full min-w-0" />
            </FilterField>
          </div>
        }
      />

      <div className="mb-5 flex items-center gap-3">
        <Avatar name={user.name} src={user.avatarUrl} size="lg" className="ring-2 ring-brand/60" />
        <div className="min-w-0">
          <p className="truncate text-lg font-semibold">{self ? `Olá, ${firstName}` : user.name}</p>
          <p className="flex items-center gap-1.5 text-sm text-muted">
            {role}
            <span className="size-1 rounded-full bg-brand" aria-hidden />
            {DEPARTMENT_LABELS[user.departmentId]} · {period.label}
          </p>
        </div>
      </div>

      {/* No celular: índice, depois os indicadores e a evolução (padrão da tela "Desempenho" do app). */}
      <div className="flex flex-col max-md:gap-4">
        <KpiStrip columns={5} mobileColumns={2} className="max-md:order-2 max-md:mb-0">
          <StatCard
            label="Meta geral"
            value={formatPercent(scorecard.overallAttainment)}
            icon={<Target />}
            tone={statusTone(scorecard.overallAttainment)}
            delta={ppDelta(scorecard.overallAttainment, data.previousAttainment, prevLabel)}
            hint={`${scorecard.achieved} de ${scorecard.withTarget} metas atingidas`}
            compact
          />
          <StatCard
            label="Produtividade"
            value={formatPercent(onTime?.value ?? null)}
            icon={<TrendingUp />}
            tone="info"
            delta={onTime?.trend ? ppDelta(onTime.value, onTime.trend.value, prevLabel) : undefined}
            hint={onTime?.denominator ? `${onTime.numerator}/${onTime.denominator} tarefas no prazo` : "Sem tarefas com prazo concluídas"}
            href={onTime?.href}
            compact
          />
          <StatCard
            label="Qualidade"
            value={quality === null ? "—" : `${Math.round(quality)}%`}
            icon={<Star />}
            tone="purple"
            delta={quality !== null && prevQuality !== null ? ppDelta(quality / 100, prevQuality / 100, prevLabel) : undefined}
            hint="Dimensão Qualidade do índice"
            compact
          />
          <StatCard
            label="SLA cumprido"
            value={formatPercent(data.sla.rate)}
            icon={<ShieldCheck />}
            tone={toneForPercent(data.sla.rate === null ? null : data.sla.rate * 100)}
            delta={ppDelta(data.sla.rate, data.sla.previousRate, prevLabel)}
            hint={data.sla.evaluated > 0 ? `${data.sla.met}/${data.sla.evaluated} no prazo` : "Nenhum SLA avaliado"}
            href={`/sla?${`periodo=${encodeURIComponent(period.key)}&responsavel=${user.id}`}`}
            compact
          />
          <StatCard
            label="Tarefas concluídas"
            value={
              <span>
                {formatNumber(data.taskSummary.done)}
                <span className="text-base font-medium text-muted">/{formatNumber(data.taskSummary.total)}</span>
              </span>
            }
            icon={<ClipboardCheck />}
            tone="brand"
            delta={{
              value: `${formatNumber(Math.abs(tasksDelta))} tarefa(s)`,
              direction: tasksDelta > 0 ? "up" : tasksDelta < 0 ? "down" : "flat",
              label: prevLabel,
            }}
            href={self ? "/tarefas" : `/gestao/equipe/${user.id}`}
            compact
          />
        </KpiStrip>

        <div className="mb-5 grid grid-cols-1 gap-4 max-md:contents xl:grid-cols-[minmax(0,1.3fr)_minmax(0,1fr)]">
          <Card className="max-md:order-3 max-md:mb-5">
            <CardHeader className="flex-row items-center justify-between gap-3">
              <CardTitle>Evolução mensal</CardTitle>
              <span className="text-xs text-muted">Últimos 6 meses</span>
            </CardHeader>
            <CardContent className="pt-0">
              <PerformanceEvolutionChart points={data.evolution} meta={index?.meta ?? 80} />
            </CardContent>
          </Card>
          <Card className="max-md:order-1">
            <CardHeader className="flex-row items-start justify-between gap-3">
              <div>
                <CardTitle>Índice de desempenho</CardTitle>
                <CardDescription>Eficiência, Entrega e Qualidade a partir dos indicadores da função (pesos por departamento).</CardDescription>
              </div>
              {indexConfig ? <PerformanceIndexSettingsButton value={indexConfig} /> : null}
            </CardHeader>
            <CardContent className="pt-0">
              <PerformanceIndexCard index={index} previous={previousIndex} />
            </CardContent>
          </Card>
        </div>
      </div>

      <div className="mb-6 grid grid-cols-1 gap-4 xl:grid-cols-[minmax(0,1.3fr)_minmax(0,1fr)]">
        <Card>
          <CardHeader className="flex-row items-center justify-between gap-3">
            <CardTitle>Minhas metas</CardTitle>
            <CardLink href={`/performance/metas?periodo=${encodeURIComponent(period.key)}`}>Ver metas</CardLink>
          </CardHeader>
          <CardContent className="pt-0 pb-2">
            <MyGoalsTable items={scorecard.items} />
          </CardContent>
        </Card>
        <div className="flex flex-col gap-4">
          <Card>
            <CardHeader className="pb-2">
              <CardTitle>Indicadores do mês por área</CardTitle>
              <CardDescription>Atingimento médio das metas de cada departamento no período.</CardDescription>
            </CardHeader>
            <CardContent className="pt-1">
              <ProgressList
                showScale
                items={data.areas.map((a) => ({
                  key: a.department,
                  label: a.label,
                  value: a.attainment === null ? 0 : a.attainment * 100,
                  display: formatPercent(a.attainment),
                  tone: a.status === "atingida" ? "success" : a.status === "atencao" ? "warning" : a.status === "critico" ? "danger" : "neutral",
                  href: viewer.isManager ? a.href : undefined,
                }))}
              />
            </CardContent>
          </Card>
          <Card>
            <CardHeader className="pb-2">
              <CardTitle>Comparativo com o mês anterior</CardTitle>
            </CardHeader>
            <CardContent className="flex flex-wrap items-center justify-between gap-3 pt-1">
              <IndexComparison index={index} previous={previousIndex} previousLabel={data.previous.label} />
              <Link href="#indicadores" className="inline-flex min-h-[44px] items-center gap-1 rounded-lg border border-brand/60 px-4 text-sm font-medium text-brand-fg hover:bg-brand-soft md:min-h-9">
                Ver detalhes <ChevronRight className="size-4" aria-hidden />
              </Link>
            </CardContent>
          </Card>
        </div>
      </div>

      {data.bonus ? (
        <section className="mb-6">
          <BonusSummaryCard c={data.bonus} href={`/performance/bonus?periodo=${data.month.key}${self ? "" : `&usuario=${user.id}`}`} />
        </section>
      ) : null}

      {data.sales ? (
        <section className="mb-6">
          <SectionTitle title="Vendas e comissões" description="Vendido por tipo de receita, comissões e prêmios de meta batida da competência." />
          <SalesPerformanceBlock data={data.sales} monthLabel={data.month.label} />
        </section>
      ) : null}

      <section id="indicadores" className="mb-6 scroll-mt-20">
        <SectionTitle
          title={`Indicadores de ${user.departmentId === "diretoria" ? "empresa" : DEPARTMENT_LABELS[user.departmentId]}`}
          description="Indicadores da função com meta, atingimento e tendência. Clique para ver de onde vem cada número."
          count={scorecard.items.length}
        />
        {scorecard.items.length === 0 ? (
          <Card>
            <EmptyState icon={<Target />} title="Sem indicadores para esta função" description="Peça ao administrador para associar indicadores ao departamento em Administração › Indicadores." />
          </Card>
        ) : (
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 xl:grid-cols-3 2xl:grid-cols-4">
            {scorecard.items.map((r) => (
              <KpiCard key={r.key} result={r} />
            ))}
          </div>
        )}
      </section>

      <div className="grid grid-cols-1 gap-4 lg:grid-cols-[minmax(0,1.3fr)_minmax(0,1fr)]">
        {data.gamification ? <GamificationCard data={data.gamification} periodLabel={period.label} rankingHref={`/performance/ranking?${periodQuery}`} /> : null}
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <ListChecks className="size-4 text-muted" aria-hidden /> Tarefas no período
            </CardTitle>
            <CardDescription>Concluídas, entregues no prazo e atrasadas agora.</CardDescription>
          </CardHeader>
          <CardContent className="flex flex-col gap-3 pt-0">
            {[data.tasks.completed, data.tasks.onTime, data.tasks.overdue].map((r) => (r ? <KpiCard key={r.key} result={r} compact eyebrow="Tarefas" /> : null))}
          </CardContent>
        </Card>
      </div>
    </PageContainer>
  );
}
