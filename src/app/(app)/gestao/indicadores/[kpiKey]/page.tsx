import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { Building2, Calculator, Database, Info, Network, User as UserIcon, Users } from "lucide-react";
import { requireUser } from "@/server/auth/session";
import { getKpiDrilldown, listKpiDefinitions, parsePeriod, periodOptions } from "@/server/kpis/queries";
import { isDepartmentKey } from "@/server/kpis/engine";
import { DIRECTION_LABELS, SCOPE_LABELS, UNIT_LABELS, departmentLabel, formatKpiValue, kpiHref, type KpiScope } from "@/server/kpis/schemas";
import { formatPercent } from "@/lib/format";
import { PageContainer } from "@/components/layout/page-container";
import { PageHeader } from "@/components/ui/page-header";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { AttainmentBar } from "@/components/kpis/attainment-bar";
import { KpiStatusBadge } from "@/components/kpis/kpi-status-badge";
import { KpiTrendText } from "@/components/kpis/kpi-card";
import { KpiTrendChart } from "@/components/kpis/kpi-trend-chart";
import { KpiSourceTable } from "@/components/kpis/kpi-source-table";
import { KpiBreakdownTable } from "@/components/kpis/kpi-breakdown-table";
import { PeriodSelect } from "@/components/kpis/period-select";

type Params = Promise<{ kpiKey: string }>;
type SearchParams = Promise<Record<string, string | string[] | undefined>>;

const one = (v: string | string[] | undefined) => (Array.isArray(v) ? v[0] : v);

export async function generateMetadata({ params }: { params: Params }): Promise<Metadata> {
  const { kpiKey } = await params;
  const defs = await listKpiDefinitions({ includeVirtual: true });
  return { title: defs.find((d) => d.key === decodeURIComponent(kpiKey))?.name ?? "Indicador" };
}

const TARGET_SOURCE_LABELS = { meta: "Meta do período", meta_colaborador: "Meta padrão do colaborador", indicador: "Meta do indicador" } as const;

/** Drill-down de um indicador: número, meta, tendência, fórmula e os registros que o compõem. */
export default async function KpiDrilldownPage({ params, searchParams }: { params: Params; searchParams: SearchParams }) {
  const [{ kpiKey: rawKey }, query, user] = await Promise.all([params, searchParams, requireUser()]);
  const kpiKey = decodeURIComponent(rawKey);
  const period = parsePeriod(query);

  // Gestor, diretoria e admin veem qualquer escopo; os demais, apenas o próprio.
  const requestedScope = one(query.escopo);
  let scope: KpiScope = requestedScope === "departamento" || requestedScope === "usuario" ? requestedScope : "empresa";
  let scopeId = one(query.id);
  let restricted = false;
  if (!user.isManager) {
    restricted = scope !== "usuario" || (scopeId !== undefined && scopeId !== user.id);
    scope = "usuario";
    scopeId = user.id;
  }
  if (scope === "usuario" && !scopeId) scopeId = user.id;
  if (scope === "departamento" && !isDepartmentKey(scopeId)) {
    scope = "empresa";
    scopeId = undefined;
  }
  if (scope === "empresa") scopeId = undefined;

  const data = await getKpiDrilldown(kpiKey, period, scope, scopeId, { withBreakdown: user.isManager });
  if (!data) notFound();
  const { result, history, byUser, byDepartment, subjectName, userNames } = data;
  const { kpi } = result;
  const meta = kpi.formulaMeta;
  const suffix = meta?.suffix;
  const fmt = (v: number | null | undefined) => formatKpiValue(v, kpi.unit, suffix);

  const scopeIcon = scope === "empresa" ? <Building2 /> : scope === "departamento" ? <Network /> : <UserIcon />;

  return (
    <PageContainer>
      <PageHeader
        title={kpi.name}
        badge={<KpiStatusBadge status={result.status} size="md" noData={result.value === null && result.target !== null} />}
        description={`${departmentLabel(kpi.department)} · ${period.label}`}
        breadcrumbs={[{ label: "Gestão", href: user.isManager ? "/gestao" : undefined }, { label: "Indicadores" }, { label: kpi.name }]}
        actions={<PeriodSelect options={periodOptions()} value={period.key} />}
      >
        <div className="flex flex-wrap items-center gap-2 text-sm">
          <Badge variant="outline" size="md" className="[&_svg]:size-3.5">
            {scopeIcon} {SCOPE_LABELS[scope]}: {subjectName}
          </Badge>
          {scope !== "empresa" && user.isManager ? (
            <Link href={kpiHref(kpiKey, period, "empresa")} className="inline-flex min-h-[44px] items-center text-sm text-brand hover:underline md:min-h-0">
              Ver empresa
            </Link>
          ) : null}
          {restricted ? <span className="text-xs text-muted">Você vê apenas os seus próprios números.</span> : null}
        </div>
      </PageHeader>

      <div className="mb-5 grid grid-cols-1 gap-3 sm:grid-cols-2 xl:grid-cols-4">
        <Card className="p-4 md:p-5">
          <p className="label-caps">Valor</p>
          <p className="mt-1 text-2xl font-semibold tabular-nums tracking-tight md:text-[28px] md:leading-9">{fmt(result.value)}</p>
          {result.note ? <p className="mt-1 text-xs text-muted">{result.note}</p> : null}
        </Card>
        <Card className="p-4 md:p-5">
          <p className="label-caps">Meta</p>
          <p className="mt-1 text-2xl font-semibold tabular-nums tracking-tight md:text-[28px] md:leading-9">
            {result.target !== null ? fmt(result.target) : result.targetMin !== undefined && result.targetMax !== undefined ? `${fmt(result.targetMin)} a ${fmt(result.targetMax)}` : "—"}
          </p>
          <p className="mt-1 text-xs text-muted">{result.targetSource ? TARGET_SOURCE_LABELS[result.targetSource] : "Sem meta definida para este escopo"}</p>
        </Card>
        <Card className="p-4 md:p-5">
          <p className="label-caps">Atingimento</p>
          <p className="mt-1 text-2xl font-semibold tabular-nums tracking-tight md:text-[28px] md:leading-9">{formatPercent(result.attainment)}</p>
          <AttainmentBar attainment={result.attainment} status={result.status} size="sm" showValue={false} noData={result.value === null && result.target !== null} className="mt-2" />
        </Card>
        <Card className="p-4 md:p-5">
          <p className="label-caps">Período anterior</p>
          <p className="mt-1 text-2xl font-semibold tabular-nums tracking-tight md:text-[28px] md:leading-9">{fmt(result.trend?.value)}</p>
          <div className="mt-1">
            <KpiTrendText result={result} />
          </div>
        </Card>
      </div>

      <div className="mb-5 grid grid-cols-1 gap-5 xl:grid-cols-[minmax(0,2fr)_minmax(0,1fr)]">
        <Card>
          <CardHeader>
            <CardTitle>Histórico</CardTitle>
            <CardDescription>Últimos 8 meses: meses fechados vêm dos snapshots gravados; o mês atual é calculado ao vivo.</CardDescription>
          </CardHeader>
          <CardContent>
            <KpiTrendChart points={history} unit={kpi.unit} suffix={suffix} />
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <Calculator className="size-4 text-muted" aria-hidden /> Como é calculado
            </CardTitle>
          </CardHeader>
          <CardContent className="flex flex-col gap-4 text-sm">
            <p className="text-foreground">{meta?.description ?? kpi.description ?? "Fórmula não encontrada no registro."}</p>
            {result.numerator !== undefined && result.denominator !== undefined && meta?.numeratorLabel ? (
              <dl className="grid grid-cols-[1fr_auto] gap-x-4 gap-y-1.5 rounded-lg bg-surface-muted p-3">
                <dt className="text-muted">{meta.numeratorLabel}</dt>
                <dd className="text-right font-medium tabular-nums">{formatKpiValue(result.numerator, meta.numeratorUnit ?? "numero")}</dd>
                <dt className="text-muted">{meta.denominatorLabel}</dt>
                <dd className="text-right font-medium tabular-nums">{formatKpiValue(result.denominator, meta.denominatorUnit ?? "numero")}</dd>
                <dt className="border-t border-border pt-1.5 font-medium text-foreground">Resultado</dt>
                <dd className="border-t border-border pt-1.5 text-right font-semibold tabular-nums">{fmt(result.value)}</dd>
              </dl>
            ) : null}
            <dl className="grid grid-cols-[auto_1fr] gap-x-3 gap-y-2 text-xs">
              <dt className="text-muted">Atribuição</dt>
              <dd className="text-foreground">{meta?.attribution ?? "—"}</dd>
              <dt className="text-muted">Unidade</dt>
              <dd className="text-foreground">{UNIT_LABELS[kpi.unit]}</dd>
              <dt className="text-muted">Sentido</dt>
              <dd className="text-foreground">{DIRECTION_LABELS[kpi.direction]}</dd>
              <dt className="text-muted">Atenção a partir de</dt>
              <dd className="text-foreground">{kpi.attentionPct}% da meta</dd>
              <dt className="text-muted">Fórmula</dt>
              <dd className="font-mono text-foreground">{kpi.formula}</dd>
            </dl>
            {kpi.virtual ? (
              <p className="flex items-start gap-2 rounded-md bg-info-soft p-2.5 text-xs text-info-fg">
                <Info className="mt-0.5 size-3.5 shrink-0" aria-hidden /> Indicador do registro ainda sem cadastro em Administração → Indicadores (sem meta própria).
              </p>
            ) : null}
          </CardContent>
        </Card>
      </div>

      <Card className="mb-5">
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Database className="size-4 text-muted" aria-hidden /> Registros de origem
            <span className="rounded-full bg-surface-hover px-2 py-0.5 text-xs font-medium tabular-nums text-muted">{result.sourceIds.length}</span>
          </CardTitle>
          <CardDescription>De onde veio o número: cada linha leva ao registro original.</CardDescription>
        </CardHeader>
        <CardContent>
          <KpiSourceTable sources={result.sourceIds} valueColumn={meta?.sourceValue} users={userNames} okLabels={kpi.unit === "percentual" ? { ok: "Conta a favor", notOk: "Conta contra" } : undefined} />
        </CardContent>
      </Card>

      {user.isManager ? (
        <div className="grid grid-cols-1 gap-5 lg:grid-cols-2">
          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <Users className="size-4 text-muted" aria-hidden /> Por colaborador
              </CardTitle>
              <CardDescription>{meta?.attribution ?? "Atribuição por responsável."}</CardDescription>
            </CardHeader>
            <CardContent className="pt-0">
              <KpiBreakdownTable rows={byUser} unit={kpi.unit} suffix={suffix} people emptyText="Nenhum colaborador tem registros atribuídos neste período." />
            </CardContent>
          </Card>
          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <Network className="size-4 text-muted" aria-hidden /> Por departamento
              </CardTitle>
              <CardDescription>
                {departmentLabel(meta?.department ?? kpi.department)} é o dono do indicador{meta?.department && meta.department !== "empresa" ? ` e enxerga todos os registros; os demais departamentos veem os registros dos seus colaboradores.` : "."}
              </CardDescription>
            </CardHeader>
            <CardContent className="pt-0">
              <KpiBreakdownTable rows={byDepartment} unit={kpi.unit} suffix={suffix} emptyText="Nenhum departamento tem registros atribuídos neste período." />
            </CardContent>
          </Card>
        </div>
      ) : null}
    </PageContainer>
  );
}
