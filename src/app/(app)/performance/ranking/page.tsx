import type { Metadata } from "next";
import { requireUser } from "@/server/auth/session";
import { getPerformanceAccess, getRanking } from "@/server/performance/queries";
import { RANKING_SCOPES, type RankingScope } from "@/server/performance/schemas";
import type { RankingRow } from "@/server/performance/ranking";
import { parsePeriod, periodOptions } from "@/server/kpis/queries";
import { DEPARTMENT_KEYS, type DepartmentKey } from "@/domain/constants";
import { PageContainer } from "@/components/layout/page-container";
import { PageHeader } from "@/components/ui/page-header";
import { PeriodSelect } from "@/components/kpis/period-select";
import { RankingBoard } from "@/components/performance/ranking-board";
import { RankingFilters } from "@/components/performance/ranking-filters";

export const metadata: Metadata = { title: "Ranking" };

type SearchParams = Promise<Record<string, string | string[] | undefined>>;
const one = (v: string | string[] | undefined) => (Array.isArray(v) ? v[0] : v);

const RANKED_DEPARTMENTS = DEPARTMENT_KEYS.filter((d) => d !== "diretoria");

/**
 * Ranking e gamificação: pódio e classificação por período (mês, trimestre, ano) nos escopos individual
 * (mesmo departamento por padrão, ou todos normalizados), equipe (por gestor) e departamento.
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

  const [ranking, access] = await Promise.all([getRanking(period, scope, { department }), getPerformanceAccess(viewer)]);
  const options = periodOptions(12).filter((o) => o.group !== "Janela móvel");
  const periodParam = `periodo=${encodeURIComponent(period.key)}`;

  const hrefFor = (row: RankingRow): string | null => {
    if (row.kind === "departamento") return `/performance/ranking?${periodParam}&escopo=individual&departamento=${row.id}`;
    if (row.kind === "equipe") return row.department ? `/performance/ranking?${periodParam}&escopo=individual&departamento=${row.department}` : null;
    if (row.id === viewer.id) return `/performance?${periodParam}`;
    if (viewer.isManager && access.userIds.includes(row.id)) return `/performance?${periodParam}&usuario=${row.id}`;
    return null;
  };

  return (
    <PageContainer>
      <PageHeader
        title="Ranking"
        description={`Pontos, níveis e medalhas · ${period.label}`}
        breadcrumbs={[{ label: "Performance", href: "/performance" }, { label: "Ranking" }]}
        actions={<PeriodSelect options={options} value={period.key} />}
      >
        <RankingFilters scope={scope} department={department} departments={RANKED_DEPARTMENTS} />
      </PageHeader>
      <RankingBoard ranking={ranking} hrefFor={hrefFor} />
    </PageContainer>
  );
}
