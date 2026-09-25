import type { Metadata } from "next";
import { AlertTriangle, BarChart3, Bell, Building2, ClipboardCheck, ClipboardX, Radar, ShieldCheck, Target, Timer, TrendingUp, Users, Workflow } from "lucide-react";
import Link from "next/link";
import { requireRole } from "@/server/auth/session";
import { getManagerDashboard } from "@/server/management/queries";
import { FOCUS_LABELS, parseFocus, type FocusKey } from "@/server/management/schemas";
import { parsePeriod, periodOptions } from "@/server/kpis/queries";
import { formatNumber, formatPercent } from "@/lib/format";
import { cn } from "@/lib/utils";
import { PageContainer } from "@/components/layout/page-container";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardLink, CardTitle } from "@/components/ui/card";
import { FilterField } from "@/components/ui/filter-bar";
import { KpiStrip } from "@/components/ui/kpi-strip";
import { PageHeader } from "@/components/ui/page-header";
import { ProgressList } from "@/components/ui/progress-list";
import { SectionTitle } from "@/components/ui/section-title";
import { StatCard } from "@/components/ui/stat-card";
import { PeriodSelect } from "@/components/kpis/period-select";
import { UrlSelect } from "@/components/ui/url-select";
import { InsightList } from "@/components/insights/insight-list";
import { DepartmentKpis } from "@/components/management/department-kpis";
import { FocusPanel } from "@/components/management/focus-panel";
import { ManagerAlerts } from "@/components/management/manager-alerts";
import { TeamTable } from "@/components/management/team-table";
import { TeamWeekChart } from "@/components/management/team-week-chart";
import { WorkloadCard } from "@/components/management/workload-card";

export const metadata: Metadata = { title: "Dashboard do Gestor" };

type SearchParams = Promise<Record<string, string | string[] | undefined>>;

const one = (v: string | string[] | undefined) => (Array.isArray(v) ? v[0] : v);

/** Link preservando escopo e período, trocando o foco. */
function hrefWith(params: { departamento?: string; periodo?: string }, focus?: FocusKey): string {
  const q = new URLSearchParams();
  if (params.departamento) q.set("departamento", params.departamento);
  if (params.periodo) q.set("periodo", params.periodo);
  if (focus) q.set("foco", focus);
  const s = q.toString();
  return s ? `/gestao?${s}` : "/gestao";
}

const FOCUS_ICONS: Record<FocusKey, React.ReactNode> = { atrasadas: <ClipboardX />, sla: <Timer />, etapas: <Workflow />, clientes: <Building2 />, metas: <Target /> };

/**
 * Dashboard do Gestor: visão da equipe (ou de um departamento/empresa) no período — colaboradores, produtividade,
 * SLA, tarefas e pendências críticas; desempenho diário da semana; metas do departamento; carga de trabalho com
 * redistribuição; alertas; desempenho individual. A cadeia de drill-down foco → colaborador → itens continua
 * (?foco=, /gestao/equipe/[userId]). Tudo vem do motor de KPIs, do SLA global e das coleções operacionais.
 */
export default async function ManagerDashboardPage({ searchParams }: { searchParams: SearchParams }) {
  const [user, query] = await Promise.all([requireRole("gestor", "diretoria"), searchParams]);
  const period = parsePeriod(query);
  const focus = parseFocus(query.foco);
  const departamento = one(query.departamento);
  const data = await getManagerDashboard(user, { departamento, period });
  const { scope, stats, summary } = data;
  const linkParams = { departamento: scope.kind === "departamento" ? scope.department : undefined, periodo: one(query.periodo) };
  const prod = summary.productivity;
  const prodTone = prod.status === "atingida" ? "success" : prod.status === "atencao" ? "warning" : prod.status === "critico" ? "danger" : "info";
  const slaTone = summary.sla.rate === null ? "neutral" : summary.sla.rate >= summary.sla.target ? "success" : summary.sla.rate >= summary.sla.target - 0.1 ? "warning" : "danger";
  const taskRatio = summary.tasks.total > 0 ? summary.tasks.done / summary.tasks.total : null;
  const slaHrefScope = `/sla?periodo=${encodeURIComponent(period.key)}${scope.kind === "departamento" ? `&departamento=${scope.department}` : ""}`;

  return (
    <PageContainer size="full">
      <PageHeader
        title="Dashboard do Gestor"
        description={`Acompanhe o desempenho da equipe e tome decisões em tempo real · ${scope.label} · ${period.label}`}
        breadcrumbs={[{ label: "Gestão" }, { label: "Dashboard do Gestor" }]}
        actions={
          <div className="flex w-full flex-wrap items-end gap-2 md:w-auto">
            {scope.canChoose ? (
              <FilterField label="Departamento" className="w-full sm:w-56">
                <UrlSelect param="departamento" label="Departamento" value={scope.selected} options={scope.options} resetValue={user.isDirector ? "empresa" : "equipe"} clear={["foco"]} icon={<Building2 />} />
              </FilterField>
            ) : null}
            <FilterField label="Período" className="w-full sm:w-56">
              <PeriodSelect options={periodOptions()} value={period.key} className="w-full min-w-0" />
            </FilterField>
            {user.isDirector ? (
              <Button asChild variant="outline" className="h-11 md:h-9">
                <Link href="/gestao/cockpit">
                  <Radar /> Cockpit
                </Link>
              </Button>
            ) : null}
            <Button asChild variant="outline" className="h-11 md:h-9">
              <Link href="/gestao/relatorios">
                <BarChart3 /> Relatórios
              </Link>
            </Button>
          </div>
        }
      />

      <KpiStrip columns={5} mobileColumns={2}>
        <StatCard label="Colaboradores" value={formatNumber(summary.members)} icon={<Users />} tone="info" hint={scope.description} compact />
        <StatCard
          label="Produtividade"
          value={formatPercent(prod.rate)}
          icon={<TrendingUp />}
          tone={prodTone}
          valueTone
          hint={prod.rate === null ? "Sem tarefas com prazo concluídas" : `${prod.met}/${prod.total} no prazo${prod.target !== null ? ` · meta ${formatPercent(prod.target)}` : ""}`}
          compact
        />
        <StatCard
          label="SLA cumprido"
          value={formatPercent(summary.sla.rate)}
          icon={<ShieldCheck />}
          tone={slaTone}
          valueTone
          hint={summary.sla.rate === null ? "Nenhum SLA avaliado" : `${summary.sla.met}/${summary.sla.evaluated} no prazo · meta ${formatPercent(summary.sla.target)}`}
          href={slaHrefScope}
          compact
        />
        <StatCard
          label="Tarefas concluídas"
          value={
            <span>
              {formatNumber(summary.tasks.done)}
              <span className="text-base font-medium text-muted">/{formatNumber(summary.tasks.total)}</span>
            </span>
          }
          icon={<ClipboardCheck />}
          tone="purple"
          hint={taskRatio === null ? "Sem tarefas no período" : `${formatPercent(taskRatio)} do total do período`}
          compact
        />
        <StatCard label="Pendências críticas" value={formatNumber(summary.pending)} icon={<AlertTriangle />} tone={summary.pending > 0 ? "danger" : "success"} valueTone hint={summary.pending > 0 ? "Requer atenção" : "Nada pendente"} href={hrefWith(linkParams, focus ? undefined : "atrasadas")} compact />
      </KpiStrip>

      <nav aria-label="Pendências críticas" className="-mt-1 mb-5 flex flex-wrap gap-2">
        {(Object.keys(FOCUS_LABELS) as FocusKey[]).map((key) => (
          <Link
            key={key}
            href={hrefWith(linkParams, focus === key ? undefined : key)}
            aria-current={focus === key ? "true" : undefined}
            className={cn(
              "inline-flex min-h-9 items-center gap-2 rounded-full border px-3 text-[13px] transition-colors [&_svg]:size-3.5",
              focus === key ? "border-brand bg-brand-soft text-brand-fg" : stats[key] > 0 ? "border-border-strong bg-surface text-foreground hover:bg-surface-hover" : "border-border bg-surface text-muted hover:bg-surface-hover",
            )}
          >
            {FOCUS_ICONS[key]}
            {FOCUS_LABELS[key].title}
            <span className={cn("rounded-full px-1.5 text-xs font-semibold tabular-nums", stats[key] > 0 ? "bg-danger-soft text-danger-fg" : "bg-surface-hover text-muted")}>{stats[key]}</span>
          </Link>
        ))}
      </nav>

      {focus ? (
        <div className="mb-5">
          <FocusPanel focus={focus} members={data.members} criticalClients={data.criticalClients} criticalKpis={data.criticalKpis} clearHref={hrefWith(linkParams)} />
        </div>
      ) : null}

      <div className="mb-5 grid grid-cols-1 gap-4 lg:grid-cols-2 2xl:grid-cols-[minmax(0,1.25fr)_minmax(0,1fr)_minmax(0,1fr)]">
        <Card>
          <CardHeader className="flex-row items-start justify-between gap-3">
            <div>
              <CardTitle>Desempenho da equipe</CardTitle>
              <CardDescription>{data.week.label} · tarefas com prazo no dia entregues no prazo</CardDescription>
            </div>
            <div className="text-right">
              <p className={cn("text-2xl font-semibold tabular-nums", data.week.overall === null ? "text-muted" : data.week.target !== null && data.week.overall >= data.week.target ? "text-success-fg" : "text-warning-fg")}>{formatPercent(data.week.overall)}</p>
              <p className="text-xs text-muted">na semana</p>
            </div>
          </CardHeader>
          <CardContent className="pt-0">
            <TeamWeekChart week={data.week} />
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="flex-row items-center justify-between gap-3">
            <CardTitle>Metas do departamento</CardTitle>
            <CardLink href={`/performance/metas?periodo=${encodeURIComponent(period.key)}`}>Ver metas</CardLink>
          </CardHeader>
          <CardContent className="pt-1">
            <ProgressList
              layout="stacked"
              emptyText="Nenhuma meta definida para os departamentos deste escopo no período."
              items={data.goals.slice(0, 7).map((g) => ({
                key: g.key,
                label: g.label,
                value: g.attainment === null ? 0 : g.attainment * 100,
                display: `${g.value} / ${g.target}`,
                tone: g.status === "atingida" ? "success" : g.status === "atencao" ? "warning" : g.status === "critico" ? "danger" : "neutral",
                emphasize: g.status === "critico",
                href: g.href,
              }))}
            />
          </CardContent>
        </Card>

        <div className="flex flex-col gap-4 lg:col-span-2 lg:grid lg:grid-cols-2 2xl:col-span-1 2xl:flex">
          <Card>
            <CardHeader className="pb-2">
              <CardTitle className="flex items-center gap-2">
                <Users className="size-4 text-info-fg" aria-hidden /> Carga de trabalho
              </CardTitle>
              <CardDescription>Tarefas abertas ÷ média da equipe; acima de 110% fica vermelho.</CardDescription>
            </CardHeader>
            <CardContent className="pt-1">
              <WorkloadCard members={data.members} teamAverageOpen={data.teamAverageOpen} tasksByUser={data.reassign.tasksByUser} targets={data.reassign.targets} limit={5} />
            </CardContent>
          </Card>
          <Card>
            <CardHeader className="pb-2">
              <CardTitle className="flex items-center gap-2">
                <Bell className="size-4 text-warning-fg" aria-hidden /> Alertas do gestor
              </CardTitle>
            </CardHeader>
            <CardContent className="pt-1">
              <ManagerAlerts alerts={data.alerts} limit={5} />
            </CardContent>
          </Card>
        </div>
      </div>

      <Card className="mb-6 overflow-hidden">
        <CardHeader className="flex-row flex-wrap items-center justify-between gap-2">
          <div>
            <CardTitle>Desempenho individual</CardTitle>
            <CardDescription>Tarefas do período (concluídas ÷ concluídas + abertas com prazo até o fim do período), carga, SLA, qualidade do Índice de desempenho e resultado das metas.</CardDescription>
          </div>
          <span className="text-sm text-muted">{data.members.length} colaborador(es)</span>
        </CardHeader>
        <CardContent className="px-3 pb-3 pt-0 md:px-0 md:pb-0">
          <TeamTable members={data.members} teamAverageOpen={data.teamAverageOpen} tasksByUser={data.reassign.tasksByUser} targets={data.reassign.targets} focus={focus} periodKey={period.key} />
        </CardContent>
      </Card>

      <div className="grid grid-cols-1 gap-5 xl:grid-cols-[minmax(0,2fr)_minmax(0,1fr)]">
        <section>
          <SectionTitle title="Indicadores do departamento" description="Cada indicador abre o drill-down até os registros de origem." />
          <DepartmentKpis scorecards={data.scorecards} />
        </section>
        <section>
          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <AlertTriangle className="size-4 text-warning-fg" aria-hidden /> Gargalos detectados
              </CardTitle>
              <CardDescription>Regras sobre os indicadores do período versus o anterior.</CardDescription>
            </CardHeader>
            <CardContent className="pt-0">
              <InsightList insights={data.insights} emptyText="Nenhum gargalo detectado para os departamentos deste escopo." />
            </CardContent>
          </Card>
        </section>
      </div>
    </PageContainer>
  );
}
