import type { Metadata } from "next";
import Link from "next/link";
import { AlarmClock, BellRing, Building2, ChevronRight, CircleCheck, CircleX, Clock, Filter, Layers, Network, Target, Timer, TriangleAlert, UserRound } from "lucide-react";
import { canAccessModule, requireUser } from "@/server/auth/session";
import { getSlaOverview } from "@/server/sla-report/queries";
import { SLA_ENTITY_TYPES, SLA_PRIORITIES, SLA_PRIORITY_LABELS, SLA_TYPE_LABELS, parseSlaFilters, slaHref, type SlaFilters } from "@/server/sla-report/schemas";
import { parsePeriod, periodOptions } from "@/server/kpis/queries";
import { formatNumber, formatPercent } from "@/lib/format";
import { cn } from "@/lib/utils";
import { PageContainer } from "@/components/layout/page-container";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { FilterBar, FilterField } from "@/components/ui/filter-bar";
import { KpiStrip } from "@/components/ui/kpi-strip";
import { PageHeader } from "@/components/ui/page-header";
import { ProgressList } from "@/components/ui/progress-list";
import { ScoreRing } from "@/components/ui/score-ring";
import { StatCard } from "@/components/ui/stat-card";
import { toneForPercent } from "@/components/ui/tone";
import { PeriodSelect } from "@/components/kpis/period-select";
import { UrlSelect } from "@/components/kpis/url-select";
import { SlaItemsTable } from "@/components/sla/sla-items-table";
import { SlaSearch } from "@/components/sla/sla-search";
import { SupportSlaSection } from "@/components/sla/support-sla-section";

export const metadata: Metadata = { title: "Gestão de SLA" };

type SearchParams = Promise<Record<string, string | string[] | undefined>>;

function pctOfTotal(n: number, total: number): string {
  return total > 0 ? `${formatPercent(n / total)} do total` : "Sem itens no período";
}

function minutesText(value: number | null): string {
  if (value === null) return "—";
  if (value < 90) return `${formatNumber(Math.round(value))} min`;
  return `${formatNumber(Math.round((value / 60) * 10) / 10)} h`;
}

function hoursText(value: number | null): string {
  if (value === null) return "—";
  if (value < 48) return `${formatNumber(Math.round(value * 10) / 10)} h`;
  return `${formatNumber(Math.round((value / 24) * 10) / 10)} dias`;
}

/**
 * Gestão de SLA (global): todas as instâncias de SLA da operação (chamados, tarefas, etapas de workflow,
 * implantação, CS e oportunidades) com estado calculado pelo motor, filtros, críticos com prazo restante ao vivo,
 * cumprimento por departamento e alerta dos que vencem na próxima hora. Com ?tipo=chamado inclui a qualidade
 * do suporte (matriz, atendentes, CSAT), antes em /suporte/sla.
 */
export default async function SlaPage({ searchParams }: { searchParams: SearchParams }) {
  const [user, query] = await Promise.all([requireUser(), searchParams]);
  const period = parsePeriod(query);
  const requested = parseSlaFilters(query);
  // Quem não é gestor enxerga o SLA do próprio departamento.
  const filters: SlaFilters = user.isManager ? requested : { ...requested, departamento: user.departmentId };
  const data = await getSlaOverview(period, filters);
  const { counts, compliance, targets } = data;
  const base = {
    periodo: typeof query.periodo === "string" ? query.periodo : undefined,
    departamento: filters.departamento,
    responsavel: filters.responsavel,
    cliente: filters.cliente,
    prioridade: filters.prioridade,
    tipo: filters.tipo,
    q: filters.q,
  };
  const complianceTone = compliance.rate === null ? "neutral" : compliance.rate >= targets.compliance ? "success" : compliance.rate >= targets.compliance - 0.1 ? "warning" : "danger";
  const listMode = filters.janela === "1h" ? "1h" : filters.lista === "todos" ? "todos" : "criticos";
  const hasFilters = Boolean(filters.departamento || filters.responsavel || filters.cliente || filters.prioridade || filters.tipo || filters.q);
  const supportMonth = period.kind === "mes" ? period.key : undefined;

  const listTabs = [
    {
      key: "criticos",
      label: `Críticos (${data.critical.length})`,
      href: slaHref({ ...base }),
    },
    {
      key: "1h",
      label: `Vencem em 1h (${data.dueNextHour.length})`,
      href: slaHref({ ...base, janela: "1h" }),
    },
    {
      key: "todos",
      label: `Todos (${counts.total})`,
      href: slaHref({ ...base, lista: "todos" }),
    },
  ];

  return (
    <PageContainer>
      <PageHeader
        title="Gestão de SLA"
        description={`Monitore prazos, riscos e violações em tempo real · ${period.label}${data.current ? "" : " (período fechado)"}`}
        breadcrumbs={[{ label: "Operação" }, { label: "SLA" }]}
        actions={
          user.isAdmin ? (
            <Button asChild variant="outline" className="h-11 md:h-9">
              <Link href="/admin/configuracoes?aba=sla">
                <Timer /> Regras de SLA
              </Link>
            </Button>
          ) : null
        }
      />

      <FilterBar
        actions={
          hasFilters ? (
            <Button asChild variant="ghost" className="h-11 md:h-9">
              <Link href={slaHref({ periodo: base.periodo })}>Limpar filtros</Link>
            </Button>
          ) : null
        }
      >
        <FilterField label="Período" className="w-[calc(50%-0.375rem)] min-w-0 sm:w-auto sm:min-w-[160px]">
          <PeriodSelect options={periodOptions(12)} value={period.key} className="w-full min-w-0 sm:min-w-[190px]" />
        </FilterField>
        <FilterField label="Departamento" className="w-[calc(50%-0.375rem)] min-w-0 sm:w-auto sm:min-w-[160px]">
          <UrlSelect
            param="departamento"
            label="Departamento"
            value={filters.departamento ?? ""}
            allLabel="Todos os departamentos"
            options={data.options.departments}
            icon={<Building2 />}
            clear={["lista", "janela"]}
            disabled={!user.isManager}
          />
        </FilterField>
        <FilterField label="Responsável" className="w-[calc(50%-0.375rem)] min-w-0 sm:w-auto sm:min-w-[160px]">
          <UrlSelect param="responsavel" label="Responsável" value={filters.responsavel ?? ""} allLabel="Todos" options={data.options.owners} icon={<UserRound />} />
        </FilterField>
        <FilterField label="Cliente" className="w-[calc(50%-0.375rem)] min-w-0 sm:w-auto sm:min-w-[160px]">
          <UrlSelect param="cliente" label="Cliente" value={filters.cliente ?? ""} allLabel="Todos os clientes" options={data.options.clients} icon={<Network />} />
        </FilterField>
        <FilterField label="Prioridade" className="w-[calc(50%-0.375rem)] min-w-0 sm:w-auto sm:min-w-[160px]">
          <UrlSelect
            param="prioridade"
            label="Prioridade"
            value={filters.prioridade ?? ""}
            allLabel="Todas"
            options={SLA_PRIORITIES.map((p) => ({
              value: p,
              label: SLA_PRIORITY_LABELS[p],
            }))}
            icon={<Filter />}
          />
        </FilterField>
        <FilterField label="Tipo de processo" className="w-[calc(50%-0.375rem)] min-w-0 sm:w-auto sm:min-w-[160px]">
          <UrlSelect
            param="tipo"
            label="Tipo de processo"
            value={filters.tipo ?? ""}
            allLabel="Todos os tipos"
            options={SLA_ENTITY_TYPES.map((t) => ({
              value: t,
              label: SLA_TYPE_LABELS[t],
            }))}
            icon={<Layers />}
          />
        </FilterField>
        <FilterField label="Busca" className="w-full sm:w-64">
          <SlaSearch value={filters.q ?? ""} />
        </FilterField>
      </FilterBar>

      <KpiStrip columns={6} mobileColumns={2} className="lg:grid-cols-3 xl:grid-cols-6">
        <StatCard
          compact
          label="Dentro do prazo"
          value={formatNumber(counts.onTime)}
          icon={<CircleCheck />}
          tone="success"
          valueTone
          hint={pctOfTotal(counts.onTime, counts.total)}
          href={slaHref({ ...base, lista: "todos" })}
        />
        <StatCard
          compact
          label="Em risco"
          value={formatNumber(counts.atRisk)}
          icon={<TriangleAlert />}
          tone="warning"
          valueTone
          hint={pctOfTotal(counts.atRisk, counts.total)}
          href={slaHref({ ...base })}
        />
        <StatCard
          compact
          label="Violados"
          value={formatNumber(counts.violated)}
          icon={<CircleX />}
          tone="danger"
          valueTone
          hint={pctOfTotal(counts.violated, counts.total)}
          href={slaHref({ ...base })}
        />
        <StatCard
          compact
          label="Taxa de cumprimento"
          value={formatPercent(compliance.rate)}
          icon={<Target />}
          tone={complianceTone}
          valueTone
          hint={`${compliance.met}/${compliance.evaluated} · meta ${formatPercent(targets.compliance)}`}
        />
        <StatCard
          compact
          label="1ª resposta (média)"
          value={minutesText(data.response.avgMinutes)}
          icon={<Clock />}
          tone="purple"
          hint={targets.responseMinutes !== null ? `Meta: ${minutesText(targets.responseMinutes)}` : `${data.response.count} resposta(s) no período`}
        />
        <StatCard
          compact
          label="Resolução (média)"
          value={hoursText(data.resolution.avgHours)}
          icon={<AlarmClock />}
          tone="info"
          hint={targets.resolutionHours !== null ? `Meta: ${hoursText(targets.resolutionHours)}` : `${data.resolution.count} concluído(s), horas corridas`}
        />
      </KpiStrip>

      <div className="mb-6 grid grid-cols-1 gap-4 xl:grid-cols-[minmax(0,1fr)_340px]">
        <div className="flex min-w-0 flex-col gap-4">
          <Card className="overflow-hidden">
            <CardHeader className="flex-row flex-wrap items-center justify-between gap-3 pb-3">
              <CardTitle>{listMode === "1h" ? "SLAs que vencem na próxima hora" : listMode === "todos" ? "Todos os SLAs do período" : "SLAs críticos"}</CardTitle>
              <nav aria-label="Lista de SLAs" className="flex flex-wrap gap-1">
                {listTabs.map((t) => (
                  <Link
                    key={t.key}
                    href={t.href}
                    aria-current={listMode === t.key ? "page" : undefined}
                    className={cn(
                      "inline-flex min-h-9 items-center rounded-lg px-3 text-[13px] font-medium transition-colors",
                      listMode === t.key ? "bg-brand text-white" : "text-muted hover:bg-surface-hover hover:text-foreground",
                    )}
                  >
                    {t.label}
                  </Link>
                ))}
              </nav>
            </CardHeader>
            <CardContent className="px-0 pb-0 pt-0">
              <SlaItemsTable
                items={listMode === "criticos" ? data.listed.slice(0, 12) : data.listed.slice(0, 200)}
                emptyTitle={listMode === "1h" ? "Nenhum SLA vence na próxima hora" : listMode === "todos" ? "Nenhum SLA no período com estes filtros" : "Nenhum SLA em risco ou violado"}
                emptyDescription={listMode === "criticos" ? "Tudo dentro do prazo com os filtros atuais." : undefined}
              />
            </CardContent>
            {listMode === "criticos" && data.critical.length > 12 ? (
              <div className="flex justify-center border-t border-border py-3">
                <Link href={slaHref({ ...base, lista: "todos" })} className="inline-flex min-h-[44px] items-center gap-1 text-sm font-medium text-brand-fg hover:text-brand-hover md:min-h-0">
                  Ver todos <ChevronRight className="size-4" aria-hidden />
                </Link>
              </div>
            ) : listMode === "criticos" ? (
              <div className="flex justify-center border-t border-border py-3">
                <Link href={slaHref({ ...base, lista: "todos" })} className="inline-flex min-h-[44px] items-center gap-1 text-sm font-medium text-brand-fg hover:text-brand-hover md:min-h-0">
                  Ver todos os {formatNumber(counts.total)} SLAs do período <ChevronRight className="size-4" aria-hidden />
                </Link>
              </div>
            ) : null}
          </Card>
          <Card>
            <CardHeader className="pb-2">
              <CardTitle>Por responsável</CardTitle>
            </CardHeader>
            <CardContent className="pt-1">
              <ProgressList
                layout="stacked"
                className="[&>ul]:grid [&>ul]:gap-x-8 md:[&>ul]:grid-cols-2"
                emptyText="Nenhum SLA avaliado no período."
                items={data.byOwner.slice(0, 8).map((d) => ({
                  key: d.key,
                  label: d.label,
                  value: d.rate === null ? 0 : d.rate * 100,
                  display: d.rate === null ? "sem avaliação" : formatPercent(d.rate),
                  tone: toneForPercent(d.rate === null ? null : d.rate * 100, targets.compliance * 100, targets.compliance * 100 - 10),
                  hint: `${d.total} SLA(s) · ${d.violated} violado(s) · ${d.atRisk} em risco`,
                  href: slaHref({ ...base, responsavel: d.key }),
                }))}
              />
            </CardContent>
          </Card>
        </div>

        <div className="flex flex-col gap-4">
          <Card>
            <CardHeader className="pb-2">
              <CardTitle>Desempenho por departamento</CardTitle>
            </CardHeader>
            <CardContent className="pt-1">
              <ProgressList
                layout="stacked"
                emptyText="Nenhum SLA avaliado no período."
                items={data.byDepartment.map((d) => ({
                  key: d.key,
                  label: d.label,
                  value: d.rate === null ? 0 : d.rate * 100,
                  display: d.rate === null ? "sem avaliação" : formatPercent(d.rate),
                  tone: toneForPercent(d.rate === null ? null : d.rate * 100, targets.compliance * 100, targets.compliance * 100 - 10),
                  hint: `${d.met}/${d.evaluated} no prazo · ${d.violated} violado(s) · ${d.atRisk} em risco`,
                  href: slaHref({ ...base, departamento: d.key }),
                }))}
              />
            </CardContent>
          </Card>
          <div className="grid grid-cols-2 gap-4 xl:grid-cols-2">
            <Card className="flex flex-col items-center p-4 text-center">
              <p className="mb-3 self-start text-sm font-semibold">Cumprimento geral</p>
              <ScoreRing
                value={compliance.rate === null ? null : compliance.rate * 100}
                display={compliance.rate === null ? "—" : formatPercent(compliance.rate)}
                size={120}
                thickness={10}
                tone={complianceTone}
              />
              <p className="mt-3 text-xs text-muted">Meta: {formatPercent(targets.compliance)}</p>
            </Card>
            <Link
              href={slaHref({ ...base, janela: "1h" })}
              className={cn(
                "flex flex-col items-center justify-center gap-2 rounded-xl border p-4 text-center shadow-card transition-colors",
                data.dueNextHour.length > 0 ? "border-danger/35 bg-danger-soft hover:bg-danger-soft/80" : "border-border bg-surface hover:bg-surface-hover",
              )}
            >
              <span className={cn("inline-flex size-11 items-center justify-center rounded-full", data.dueNextHour.length > 0 ? "bg-danger/20 text-danger-fg" : "bg-surface-hover text-muted")}>
                <BellRing className="size-5" aria-hidden />
              </span>
              <span className={cn("text-3xl font-semibold tabular-nums", data.dueNextHour.length > 0 ? "text-danger-fg" : "text-foreground")}>{formatNumber(data.dueNextHour.length)}</span>
              <span className="text-sm text-foreground">SLAs vencem na próxima hora</span>
              <span className="inline-flex items-center gap-0.5 text-[13px] font-medium text-brand-fg">
                Ver todos <ChevronRight className="size-4" aria-hidden />
              </span>
            </Link>
          </div>
        </div>
      </div>

      <p className="mb-6 text-xs text-muted">
        Dentro do prazo inclui itens em atenção e pausados (aguardando cliente). Taxa de cumprimento = concluídos no prazo ÷ (concluídos no período + em aberto com prazo vencido no período). Tempos
        médios em horas corridas desde o início do SLA.
      </p>

      {filters.tipo === "chamado" && canAccessModule(user, "suporte") ? <SupportSlaSection month={supportMonth} isAdmin={user.isAdmin} /> : null}
    </PageContainer>
  );
}
