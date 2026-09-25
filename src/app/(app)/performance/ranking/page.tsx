import type { Metadata } from "next";
import { Award, Flame, Medal, Target, TrendingUp, Trophy, UserRound } from "lucide-react";
import { requireUser } from "@/server/auth/session";
import { getPerformanceAccess, getRanking, getRankingOverview } from "@/server/performance/queries";
import { RANKING_SCOPES, type RankingScope } from "@/server/performance/schemas";
import type { RankingRow } from "@/server/performance/ranking";
import { localDayKey } from "@/server/kpis/period";
import { parsePeriod, periodOptions } from "@/server/kpis/queries";
import { DEPARTMENT_KEYS, DEPARTMENT_LABELS, type DepartmentKey } from "@/domain/constants";
import { formatNumber } from "@/lib/format";
import { PageContainer } from "@/components/layout/page-container";
import { Card, CardContent, CardDescription, CardHeader, CardLink, CardTitle } from "@/components/ui/card";
import { FilterField } from "@/components/ui/filter-bar";
import { KpiStrip } from "@/components/ui/kpi-strip";
import { PageHeader } from "@/components/ui/page-header";
import { StatCard } from "@/components/ui/stat-card";
import { PeriodSelect } from "@/components/kpis/period-select";
import { AchievementsGrid, ActiveCampaigns, LevelProgress, PointsRules, RankingPodium, RankingTable, rankingScore } from "@/components/performance/ranking-board";
import { RankingFilters } from "@/components/performance/ranking-filters";

export const metadata: Metadata = { title: "Ranking e Gamificação" };

type SearchParams = Promise<Record<string, string | string[] | undefined>>;
const one = (v: string | string[] | undefined) => (Array.isArray(v) ? v[0] : v);

const RANKED_DEPARTMENTS = DEPARTMENT_KEYS.filter((d) => d !== "diretoria");

/**
 * Ranking e Gamificação: minha posição, pontuação, sequência em dias, conquistas e próximo nível; pódio e
 * classificação por período (mês, trimestre, ano) nos escopos individual (mesmo departamento por padrão, ou
 * todos normalizados), equipe e departamento; campanhas ativas; medalhas desbloqueadas e bloqueadas; nível e
 * "como pontuar". Tudo alimentado pelos eventos reais (gamification_points, achievements, campanhas).
 */
export default async function RankingPage({ searchParams }: { searchParams: SearchParams }) {
  const [viewer, query] = await Promise.all([requireUser(), searchParams]);
  const requested = parsePeriod(query);
  // Ranking por competência: janelas móveis/personalizadas viram o mês corrente.
  const period = requested.kind === "mes" || requested.kind === "trimestre" || requested.kind === "ano" ? requested : parsePeriod({});
  const scopeParam = one(query.escopo);
  const scope: RankingScope = (RANKING_SCOPES as readonly string[]).includes(scopeParam ?? "") ? (scopeParam as RankingScope) : "individual";
  const depParam = one(query.departamento);
  const department: DepartmentKey | "todos" =
    depParam === "todos" ? "todos" : (RANKED_DEPARTMENTS as readonly string[]).includes(depParam ?? "") ? (depParam as DepartmentKey) : viewer.departmentId === "diretoria" ? "todos" : viewer.departmentId;

  const [ranking, access, overview] = await Promise.all([getRanking(period, scope, { department }), getPerformanceAccess(viewer), getRankingOverview(viewer.id, period)]);
  const options = periodOptions(12).filter((o) => o.group !== "Janela móvel");
  const periodParam = `periodo=${encodeURIComponent(period.key)}`;

  const hrefFor = (row: RankingRow): string | null => {
    if (row.kind === "departamento") return `/performance/ranking?${periodParam}&escopo=individual&departamento=${row.id}`;
    if (row.kind === "equipe") return row.department ? `/performance/ranking?${periodParam}&escopo=individual&departamento=${row.department}` : null;
    if (row.id === viewer.id) return `/performance?${periodParam}`;
    if (viewer.isManager && access.userIds.includes(row.id)) return `/performance?${periodParam}&usuario=${row.id}`;
    return null;
  };

  const summary = overview.summary;
  const myRow = ranking.rows.find((r) => r.id === viewer.id);
  const position = myRow?.position ?? summary?.position ?? null;
  const unlocked = overview.achievements.filter((a) => a.unlocked);
  const level = summary?.level;

  return (
    <PageContainer size="full">
      <PageHeader
        title="Ranking e Gamificação"
        description={`Reconheça resultados, acompanhe conquistas e fortaleça o desempenho do time · ${period.label}`}
        breadcrumbs={[{ label: "Performance", href: "/performance" }, { label: "Ranking" }]}
        actions={
          <FilterField label="Período" className="w-full sm:w-56">
            <PeriodSelect options={options} value={period.key} className="w-full min-w-0" />
          </FilterField>
        }
      >
        <RankingFilters scope={scope} department={department} departments={RANKED_DEPARTMENTS} />
      </PageHeader>

      <KpiStrip columns={5} mobileColumns={2}>
        <StatCard
          label="Minha posição"
          value={position ? `${position}º lugar` : "—"}
          icon={<UserRound />}
          tone="info"
          hint={myRow ? `de ${ranking.rows.length} neste ranking` : summary?.of ? `de ${summary.of} em ${DEPARTMENT_LABELS[summary.department]}` : "Diretoria fora do ranking"}
          delta={myRow?.delta ? { value: `${Math.abs(myRow.delta)} posição(ões)`, direction: myRow.delta > 0 ? "up" : "down", label: `vs. ${ranking.previous.label.toLowerCase()}` } : undefined}
          compact
        />
        <StatCard label="Pontuação" value={`${formatNumber(summary?.points ?? 0)} pts`} icon={<Target />} tone="success" hint={myRow && ranking.normalized ? `${rankingScore(myRow, ranking)} normalizados` : `${formatNumber(summary?.totalPoints ?? 0)} acumulados`} compact />
        <StatCard label="Sequência" value={`${formatNumber(overview.streak.days)} dia(s)`} icon={<Flame />} tone="purple" hint={overview.streak.todayCounts ? "Hoje já conta" : "Dias úteis seguidos"} compact />
        <StatCard label="Conquistas" value={formatNumber(unlocked.length)} icon={<Trophy />} tone="warning" hint={`de ${overview.achievements.length} medalhas`} compact />
        <StatCard label="Próximo nível" value={level?.next ? `faltam ${formatNumber(level.next.missing)} pts` : "Nível máximo"} icon={<TrendingUp />} tone="brand" progress={level ? level.progress * 100 : undefined} hint={level?.next ? `para ${level.next.nome}` : level?.nome} compact />
      </KpiStrip>

      <div className="grid grid-cols-1 gap-4 xl:grid-cols-[minmax(0,1.5fr)_minmax(0,1fr)]">
        <div className="flex min-w-0 flex-col gap-4">
          <Card>
            <CardHeader className="pb-2">
              <CardTitle className="flex items-center gap-2">
                <Medal className="size-4 text-warning-fg" aria-hidden /> Pódio {period.kind === "mes" ? "do mês" : "do período"}
              </CardTitle>
            </CardHeader>
            <CardContent className="pt-2">
              <RankingPodium ranking={ranking} hrefFor={hrefFor} />
            </CardContent>
          </Card>
          <Card className="overflow-hidden">
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <Trophy className="size-4 text-muted" aria-hidden /> Classificação
              </CardTitle>
            </CardHeader>
            <CardContent className="px-0 pb-4 pt-0">
              <RankingTable ranking={ranking} hrefFor={hrefFor} viewerId={viewer.id} />
            </CardContent>
          </Card>
        </div>

        <div className="flex min-w-0 flex-col gap-4">
          <Card>
            <CardHeader className="flex-row items-center justify-between gap-3 pb-2">
              <CardTitle>Campanhas ativas</CardTitle>
              <CardLink href="/performance/campanhas">Ver todas</CardLink>
            </CardHeader>
            <CardContent className="pt-2">
              <ActiveCampaigns items={overview.campaigns} today={localDayKey()} />
            </CardContent>
          </Card>
          <Card>
            <CardHeader className="flex-row items-center justify-between gap-3 pb-2">
              <CardTitle className="flex items-center gap-2">
                <Award className="size-4 text-muted" aria-hidden /> Minhas conquistas
              </CardTitle>
              <span className="text-xs text-muted">
                {unlocked.length} de {overview.achievements.length}
              </span>
            </CardHeader>
            <CardContent className="pt-2">
              <AchievementsGrid items={overview.achievements} />
            </CardContent>
          </Card>
          {level ? (
            <Card>
              <CardHeader className="flex-row items-center justify-between gap-3 pb-2">
                <CardTitle>Nível atual</CardTitle>
                <CardLink href="#como-pontuar">Como pontuar</CardLink>
              </CardHeader>
              <CardContent className="pt-2">
                <LevelProgress level={level} totalPoints={summary?.totalPoints ?? 0} levels={overview.levels} />
              </CardContent>
            </Card>
          ) : null}
        </div>
      </div>

      <Card id="como-pontuar" className="mt-4 scroll-mt-20">
        <CardHeader>
          <CardTitle>Como pontuar</CardTitle>
          <CardDescription>Pontos creditados automaticamente pelos eventos do sistema (setting “gamificacao”); a sequência segue o setting “gamificacao.sequencia”.</CardDescription>
        </CardHeader>
        <CardContent className="pt-0">
          <PointsRules ranking={ranking} streakRule={overview.streak.rule} />
        </CardContent>
      </Card>
    </PageContainer>
  );
}
