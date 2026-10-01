import type { Metadata } from "next";
import { Lock } from "lucide-react";
import { can, canSeeHref, requireScreen } from "@/server/auth/session";
import { buildReport, canAccessReport, getReportFilterOptions, listReportsForUser, reportAllowedUserIds, reportExportKey } from "@/server/reports/build";
import { isReportKey, readReportFilters, type ReportKey } from "@/server/reports/definitions";
import { PageContainer } from "@/components/layout/page-container";
import { PageHeader } from "@/components/ui/page-header";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { EmptyState } from "@/components/ui/empty-state";
import { ReportCatalog } from "@/components/reports/report-catalog";
import { ReportFiltersForm } from "@/components/reports/report-filters";
import { ExportButtons, ReportPreview } from "@/components/reports/report-preview";

export const metadata: Metadata = { title: "Relatórios" };

type SearchParams = Promise<Record<string, string | string[] | undefined>>;

const one = (v: string | string[] | undefined) => (Array.isArray(v) ? v[0] : v);

/**
 * Central de Relatórios: catálogo (departamentais da planilha + operacionais), filtros, prévia com totais e
 * exportação CSV/XLSX/PDF. Tela gestao.relatorios (aberta a todos enquanto o módulo Gestão estiver ativo); cada
 * relatório é uma seção (gestao.relatorios.<tipo>.ver — padrão: gestores, diretoria e admin veem todos;
 * colaboradores, os do seu departamento). O conteúdo e os colaboradores oferecidos no filtro seguem o escopo da tela
 * (buildReport/allowedUserIds); os botões de exportação só aparecem com gestao.relatorios.exportar e a chave de
 * exportação do tipo (a API revalida e devolve 401/403).
 */
export default async function ReportsPage({ searchParams }: { searchParams: SearchParams }) {
  const [user, query] = await Promise.all([requireScreen("gestao.relatorios"), searchParams]);
  const reports = listReportsForUser(user);
  if (reports.length === 0) {
    return (
      <PageContainer size="narrow">
        <PageHeader title="Relatórios" breadcrumbs={[{ label: "Gestão" }, { label: "Relatórios" }]} />
        <EmptyState icon={<Lock />} title="Sem relatórios disponíveis" description="Seu perfil não tem relatórios liberados." />
      </PageContainer>
    );
  }

  const requested = one(query.tipo);
  const fallback: ReportKey = user.isDirector && reports.some((r) => r.key === "diretoria") ? "diretoria" : (reports.find((r) => r.department === user.departmentId)?.key ?? reports[0].key);
  const selected: ReportKey = isReportKey(requested) && canAccessReport(user, requested) ? requested : fallback;
  const [data, options] = await Promise.all([buildReport(selected, readReportFilters(query), user), reportAllowedUserIds(user).then((ids) => getReportFilterOptions(ids))]);
  const def = data.definition;

  // Filtros travados pelo escopo (Tarefas: o próprio departamento; Comissões: as próprias), calculados em buildReport.
  const locked = data.locked;
  const canExport = can(user, "gestao.relatorios.exportar") && can(user, reportExportKey(selected));
  const users = def.group === "departamental" && def.department ? options.users.filter((u) => u.departmentId === def.department) : options.users;

  return (
    <PageContainer size="full" className="max-w-[1600px]">
      <PageHeader title="Relatórios" description="Os mesmos números dos dashboards, prontos para exportar." breadcrumbs={[{ label: "Gestão", href: canSeeHref(user, "/gestao") ? "/gestao" : undefined }, { label: "Relatórios" }]} />

      <div className="grid grid-cols-1 gap-5 lg:grid-cols-[260px_minmax(0,1fr)]">
        <aside className="min-w-0">
          <ReportCatalog reports={reports} selected={selected} />
        </aside>

        <div className="flex min-w-0 flex-col gap-5">
          <Card>
            <CardHeader className="gap-3 md:flex-row md:items-start md:justify-between">
              <div>
                <CardTitle>Relatório de {def.title}</CardTitle>
                <CardDescription>
                  {def.description} {data.filters.map((f) => `${f.label}: ${f.value}`).join(" · ")}
                </CardDescription>
              </div>
              {canExport ? <ExportButtons data={data} /> : null}
            </CardHeader>
            <CardContent className="border-t border-border pt-4">
              <ReportFiltersForm
                key={`${selected}-${JSON.stringify(data.effective)}`}
                reportKey={selected}
                filters={def.filters}
                values={data.effective}
                locked={locked}
                options={{ users, clients: options.clients, products: options.products, departments: options.departments, status: def.statusOptions ?? [] }}
              />
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                Prévia <span className="rounded-full bg-surface-hover px-2 py-0.5 text-xs font-medium tabular-nums text-muted">{data.rows.length}</span>
              </CardTitle>
              <CardDescription>{data.periodLabel}</CardDescription>
            </CardHeader>
            <CardContent className="pt-0">
              <ReportPreview data={data} />
            </CardContent>
          </Card>
        </div>
      </div>
    </PageContainer>
  );
}
