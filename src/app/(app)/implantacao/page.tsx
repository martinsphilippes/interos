import type { Metadata } from "next";
import Link from "next/link";
import { redirect } from "next/navigation";
import { Flag, Kanban } from "lucide-react";
import { canSeeHref, requireScreen } from "@/server/auth/session";
import { getImplementationOverview, listFilterOptions, listProjects } from "@/server/implementation/queries";
import { projectSections } from "@/server/implementation/access";
import { cn } from "@/lib/utils";
import { PROJECT_STATUS_FILTERS, readProjectFilters } from "@/server/implementation/schemas";
import { PageContainer } from "@/components/layout/page-container";
import { buttonVariants } from "@/components/ui/button-variants";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { PageHeader } from "@/components/ui/page-header";
import { GoLivesByMonthChart, ProjectsByStatusChart } from "@/components/implementation/implementation-charts";
import { ImplementationStats } from "@/components/implementation/implementation-stats";
import { ProjectFilterBar } from "@/components/implementation/project-filters";
import { ProjectsTable } from "@/components/implementation/projects-table";

export const metadata: Metadata = { title: "Implantação" };

type SearchParams = Promise<Record<string, string | string[] | undefined>>;

/**
 * Projetos de implantação: indicadores com drill-down, gráficos (status e go-lives por mês) e a lista
 * filtrável. Links antigos (/implantacao?projeto=<id>) redirecionam para a página do projeto (que confere tela e
 * escopo). Indicadores e gráficos só com a seção "Indicadores e gráficos" (sem ela, nem são calculados).
 */
export default async function ImplementationPage({ searchParams }: { searchParams: SearchParams }) {
  const user = await requireScreen("implantacao.projetos");
  const params = await searchParams;
  const get = (key: string) => {
    const v = params[key];
    return Array.isArray(v) ? v[0] : v;
  };
  const projectId = get("projeto");
  if (projectId) redirect(`/implantacao/${encodeURIComponent(projectId)}`);

  const filters = readProjectFilters(get);
  const sections = projectSections(user);
  const [overview, list, options] = await Promise.all([sections.indicators ? getImplementationOverview(user, filters.scope) : Promise.resolve(null), listProjects(user, filters), listFilterOptions(user)]);
  const scopeParam = get("escopo") ?? "";
  const showKanban = canSeeHref(user, "/implantacao/kanban");
  const showGoLive = canSeeHref(user, "/implantacao/go-live");

  return (
    <PageContainer>
      <PageHeader
        title="Implantação"
        description="Do kickoff ao go-live: fases, checklists, treinamentos, pendências do cliente e handoff para o CS."
        breadcrumbs={[{ label: "Implantação" }, { label: "Projetos" }]}
        actions={
          showKanban || showGoLive ? (
            <>
              {showKanban ? (
                <Link href="/implantacao/kanban" className={cn(buttonVariants({ variant: "outline" }), "h-11 md:h-9")}>
                  <Kanban /> Kanban
                </Link>
              ) : null}
              {showGoLive ? (
                <Link href="/implantacao/go-live" className={cn(buttonVariants(), "h-11 md:h-9")}>
                  <Flag /> Go-live
                </Link>
              ) : null}
            </>
          ) : undefined
        }
      />

      <p className="mb-3 text-sm text-muted">
        Escopo: <span className="font-medium text-foreground">{list.scope.label}</span>
      </p>
      {overview ? (
        <>
          <div className="mb-6">
            <ImplementationStats overview={overview} scopeParam={scopeParam} />
          </div>

          <div className="mb-6 grid gap-4 lg:grid-cols-2">
            <Card>
              <CardHeader>
                <CardTitle>Projetos por status</CardTitle>
                <CardDescription>Todos os projetos do escopo.</CardDescription>
              </CardHeader>
              <CardContent className="pt-0">
                <ProjectsByStatusChart data={overview.byStatus} />
              </CardContent>
            </Card>
            <Card>
              <CardHeader>
                <CardTitle>Go-lives por mês</CardTitle>
                <CardDescription>Últimos 6 meses, no prazo x fora do prazo.</CardDescription>
              </CardHeader>
              <CardContent className="pt-0">
                <GoLivesByMonthChart data={overview.goLivesByMonth} />
              </CardContent>
            </Card>
          </div>
        </>
      ) : null}

      <Card id="projetos" className="scroll-mt-20 overflow-hidden">
        <CardHeader className="gap-3">
          <div>
            <CardTitle>Projetos</CardTitle>
            <CardDescription>
              {list.rows.length} de {list.total} projeto(s) · bloqueados e aguardando cliente primeiro, depois pelo prazo.
            </CardDescription>
          </div>
          <ProjectFilterBar owners={options.owners} products={options.products} statuses={PROJECT_STATUS_FILTERS} scope={list.scope.kind} canTeam={list.scope.canTeam} />
        </CardHeader>
        <CardContent className="px-0 pb-0 pt-0">
          <ProjectsTable rows={list.rows} />
        </CardContent>
      </Card>
    </PageContainer>
  );
}
