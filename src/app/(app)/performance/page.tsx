import type { Metadata } from "next";
import { Gauge, ListChecks, Sparkles, Target, Trophy } from "lucide-react";
import { requireUser } from "@/server/auth/session";
import { getMyPerformance, getPerformanceAccess, resolveSubjectId } from "@/server/performance/queries";
import { parsePeriod, periodOptions } from "@/server/kpis/queries";
import { DEPARTMENT_LABELS } from "@/domain/constants";
import { formatNumber, formatPercent } from "@/lib/format";
import { PageContainer } from "@/components/layout/page-container";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { EmptyState } from "@/components/ui/empty-state";
import { PageHeader } from "@/components/ui/page-header";
import { SectionTitle } from "@/components/ui/section-title";
import { StatCard } from "@/components/ui/stat-card";
import { KpiCard } from "@/components/kpis/kpi-card";
import { KpiTrendChart } from "@/components/kpis/kpi-trend-chart";
import { PeriodSelect } from "@/components/kpis/period-select";
import { BonusSummaryCard } from "@/components/performance/bonus-summary";
import { GamificationCard } from "@/components/performance/gamification-card";
import { SalesPerformanceBlock } from "@/components/performance/sales-performance";
import { UserSelect } from "@/components/performance/user-select";

export const metadata: Metadata = { title: "Meu Desempenho" };

type SearchParams = Promise<Record<string, string | string[] | undefined>>;
const one = (v: string | string[] | undefined) => (Array.isArray(v) ? v[0] : v);

/**
 * Meu Desempenho: indicadores da função do colaborador (scorecard do motor de KPIs) com meta, atingimento,
 * status e tendência; evolução dos 3 principais; bloco da função (vendas ou bônus); ranking, pontos e
 * medalhas; tarefas. Gestor/diretoria/admin escolhem o colaborador (?usuario=).
 */
export default async function MeuDesempenhoPage({ searchParams }: { searchParams: SearchParams }) {
  const [viewer, query] = await Promise.all([requireUser(), searchParams]);
  const period = parsePeriod(query);
  const access = await getPerformanceAccess(viewer);
  const subjectId = resolveSubjectId(viewer, access, one(query.usuario));
  const data = await getMyPerformance(subjectId, period);
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

  const { scorecard, user } = data;
  const periodQuery = `periodo=${encodeURIComponent(period.key)}${self ? "" : `&usuario=${user.id}`}`;
  const withData = scorecard.items.filter((i) => i.value !== null).length;

  return (
    <PageContainer>
      <PageHeader
        title={self ? "Meu Desempenho" : `Desempenho de ${user.name}`}
        description={`${user.jobTitle ?? DEPARTMENT_LABELS[user.departmentId]} · ${DEPARTMENT_LABELS[user.departmentId]} · ${period.label}`}
        breadcrumbs={[{ label: "Performance" }, { label: "Meu Desempenho" }]}
        actions={
          <>
            {access.canViewOthers ? <UserSelect people={access.people} value={user.id} /> : null}
            <PeriodSelect options={periodOptions(12)} value={period.key} />
          </>
        }
      />

      <div className="mb-6 grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
        <StatCard label="Atingimento geral" value={formatPercent(scorecard.overallAttainment)} icon={<Gauge />} tone={scorecard.overallAttainment === null ? "neutral" : scorecard.overallAttainment >= 1 ? "success" : scorecard.overallAttainment >= 0.85 ? "warning" : "danger"} hint="Média ponderada, cada meta limitada a 100%" compact />
        <StatCard label="Metas atingidas" value={`${formatNumber(scorecard.achieved)} de ${formatNumber(scorecard.withTarget)}`} icon={<Target />} tone="info" hint={`${formatNumber(withData)} de ${formatNumber(scorecard.items.length)} indicadores com dado`} compact />
        <StatCard
          label="Posição no ranking"
          value={data.gamification?.position ? `${data.gamification.position}º de ${data.gamification.of}` : "—"}
          icon={<Trophy />}
          tone="info"
          hint={data.gamification?.of ? `Entre colegas de ${DEPARTMENT_LABELS[user.departmentId]}` : "Diretoria fora do ranking"}
          href={`/performance/ranking?periodo=${encodeURIComponent(period.key)}`}
          compact
        />
        <StatCard label="Pontos no período" value={formatNumber(data.gamification?.points ?? 0)} icon={<Sparkles />} tone="success" hint={data.gamification ? `Nível ${data.gamification.level.nome}` : undefined} compact />
      </div>

      <section className="mb-8">
        <SectionTitle title={`Indicadores de ${user.departmentId === "diretoria" ? "empresa" : DEPARTMENT_LABELS[user.departmentId]}`} description="Somente os indicadores da função. Clique para ver de onde vem cada número." count={scorecard.items.length} />
        {scorecard.items.length === 0 ? (
          <Card>
            <EmptyState icon={<Target />} title="Sem indicadores para esta função" description="Peça ao administrador para associar indicadores ao departamento em Administração › Indicadores." />
          </Card>
        ) : (
          <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3 2xl:grid-cols-4">
            {scorecard.items.map((r) => (
              <KpiCard key={r.key} result={r} />
            ))}
          </div>
        )}
      </section>

      {data.highlights.length > 0 ? (
        <section className="mb-8">
          <SectionTitle title="Evolução dos principais indicadores" description="Últimos 6 meses: meses fechados vêm do snapshot gravado; o mês atual, do cálculo ao vivo." />
          <div className="grid gap-4 lg:grid-cols-3">
            {data.highlights.map((h) => (
              <Card key={h.result.key}>
                <CardHeader className="pb-1">
                  <CardTitle className="text-sm">{h.result.kpi.name}</CardTitle>
                </CardHeader>
                <CardContent className="pt-0">
                  <KpiTrendChart points={h.history} unit={h.result.kpi.unit} suffix={h.result.kpi.formulaMeta?.suffix} height={200} />
                </CardContent>
              </Card>
            ))}
          </div>
        </section>
      ) : null}

      {data.sales ? (
        <section className="mb-8">
          <SectionTitle title="Vendas e comissões" description="Vendido por tipo de receita, comissões e prêmios de meta batida da competência." />
          <SalesPerformanceBlock data={data.sales} monthLabel={data.month.label} />
        </section>
      ) : null}

      {data.bonus ? (
        <section className="mb-8">
          <BonusSummaryCard c={data.bonus} href={`/performance/bonus?periodo=${data.month.key}${self ? "" : `&usuario=${user.id}`}`} />
        </section>
      ) : null}

      <div className="grid gap-4 lg:grid-cols-[minmax(0,1.3fr)_minmax(0,1fr)]">
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
