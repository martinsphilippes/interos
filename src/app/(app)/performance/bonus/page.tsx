import type { Metadata } from "next";
import Link from "next/link";
import { Award, CircleDollarSign, Coins, FileText, Gem, Settings2, Target } from "lucide-react";
import { requireUser } from "@/server/auth/session";
import { getBonusPageData, getPerformanceAccess, resolveSubjectId } from "@/server/performance/queries";
import { currentMonthKey, listRecentMonths, monthPeriod, periodFromKey } from "@/server/kpis/queries";
import { DEPARTMENT_LABELS } from "@/domain/constants";
import { formatCurrency, formatPercent } from "@/lib/format";
import { PageContainer } from "@/components/layout/page-container";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { EmptyState } from "@/components/ui/empty-state";
import { PageHeader } from "@/components/ui/page-header";
import { StatCard } from "@/components/ui/stat-card";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { PeriodSelect } from "@/components/kpis/period-select";
import { BonusAlerts, BonusBreakdown, bonusTotalText } from "@/components/performance/bonus-summary";
import { BonusHistory, BonusRegulation, type KpiNames } from "@/components/performance/bonus-regulation";
import { type SimulatorLine } from "@/components/performance/bonus-simulator";
import { BonusCompositionDonut, BonusGoalsTable, BonusHistoryChart, BonusTierCard, BonusTiersList } from "@/components/performance/bonus-dashboard";
import { KpiStrip } from "@/components/ui/kpi-strip";
import { BonusBlocksList, BonusTeamPanel, type TeamBonusRow } from "@/components/performance/bonus-team";
import { UserSelect } from "@/components/performance/user-select";
import { formatGap } from "@/components/performance/bonus-status";

export const metadata: Metadata = { title: "Bônus e Premiação" };

type SearchParams = Promise<Record<string, string | string[] | undefined>>;
const one = (v: string | string[] | undefined) => (Array.isArray(v) ? v[0] : v);

/**
 * Bônus e Premiação: projeção do mês com o cálculo explicado linha a linha, simulador, histórico e
 * regulamento gerado da regra. Gestor/admin: equipe, bloqueios (registrar/confirmar/revogar com auditoria)
 * e fechamento da competência. Bônus é mensal: ?periodo=AAAA-MM (padrão: mês atual).
 */
export default async function BonusPage({ searchParams }: { searchParams: SearchParams }) {
  const [viewer, query] = await Promise.all([requireUser(), searchParams]);
  const requested = periodFromKey(one(query.periodo));
  const month = requested?.kind === "mes" ? requested : monthPeriod(currentMonthKey());
  const access = await getPerformanceAccess(viewer);
  const subjectId = resolveSubjectId(viewer, access, one(query.usuario));
  const data = await getBonusPageData(viewer, access, subjectId, month);
  const c = data.subject;
  const self = subjectId === viewer.id;
  const tab = one(query.aba);
  const tabQuery = `periodo=${month.key}${self ? "" : `&usuario=${subjectId}`}`;
  const year = month.key.slice(0, 4);
  const yearResults = data.history.filter((r) => r.period.startsWith(year) && r.period <= month.key);
  const yearTotal = yearResults.reduce((s, r) => s + (r.blocked ? 0 : r.projectedAmount + r.extrasAmount), 0);
  const yearClosed = yearResults.length;
  const monthOptions = listRecentMonths(12)
    .reverse()
    .map((p) => ({ value: p.key, label: p.label }));

  const names: KpiNames = {};
  if (c) for (const l of [...c.individual.lines, ...c.collective.lines]) names[l.kpiKey] = { name: l.name, unit: l.unit, suffix: l.suffix, direction: l.direction };
  const simulatorLines: SimulatorLine[] = c
    ? [
        ...c.individual.lines.map((l) => ({ block: "individual" as const, kpiKey: l.kpiKey, name: l.name, scopeLabel: l.scopeLabel, unit: l.unit, suffix: l.suffix, direction: l.direction, weight: l.weight, target: l.target, value: l.value })),
        ...c.collective.lines.map((l) => ({ block: "coletivo" as const, kpiKey: l.kpiKey, name: l.name, scopeLabel: l.scopeLabel, unit: l.unit, suffix: l.suffix, direction: l.direction, weight: l.weight, target: l.target, value: l.value })),
      ]
    : [];
  const teamRows: TeamBonusRow[] = data.team.map((t) => ({
    userId: t.userId,
    userName: t.userName,
    department: t.department,
    overall: t.overallAttainment,
    tierLabel: t.tier?.label ?? null,
    payoutPct: t.payoutPct,
    total: t.totalAmount,
    blocked: t.blocked,
    pending: t.pendingBlocks.length,
    incomplete: Boolean(t.incompleteReason),
    hasSalary: t.salary !== null,
  }));

  return (
    <PageContainer size="full">
      <PageHeader
        title="Bônus e Premiação"
        description={c ? `Acompanhe seus resultados e veja quanto falta para aumentar sua premiação · ${self ? "Seu bônus" : `Bônus de ${c.userName}`} · ${DEPARTMENT_LABELS[c.department]} · ${month.label}` : month.label}
        breadcrumbs={[{ label: "Performance", href: "/performance" }, { label: "Bônus" }]}
        actions={
          <>
            {access.canViewOthers ? <UserSelect people={access.people} value={subjectId} /> : null}
            <PeriodSelect options={monthOptions} value={month.key} label="Competência" />
            {viewer.isAdmin ? (
              <Button variant="outline" asChild className="min-h-[44px] md:min-h-0">
                <Link href="/performance/bonus/regras">
                  <Settings2 /> Regras
                </Link>
              </Button>
            ) : null}
          </>
        }
      />

      <Tabs key={tab ?? "padrao"} defaultValue={tab && ["mes", "regulamento", "equipe"].includes(tab) ? tab : c?.rule ? "mes" : data.canManage ? "equipe" : "mes"}>
        <TabsList>
          <TabsTrigger value="mes">Bônus do mês</TabsTrigger>
          {c?.rule ? <TabsTrigger value="regulamento">Regulamento</TabsTrigger> : null}
          {data.canManage ? <TabsTrigger value="equipe">Equipe e bloqueios</TabsTrigger> : null}
        </TabsList>

        <TabsContent value="mes">
          {!c || !c.rule ? (
            <Card>
              <EmptyState
                icon={<Award />}
                title={`Sem regra de bônus para ${c ? DEPARTMENT_LABELS[c.department] : "este colaborador"}`}
                description={c?.department === "vendas" ? "Vendas é remunerada por comissão e prêmios de meta: veja o bloco de comissões no Meu Desempenho." : "Quando o administrador publicar uma regra para o departamento, a projeção aparece aqui."}
                action={
                  <Button variant="outline" asChild>
                    <Link href={`/performance${self ? "" : `?usuario=${subjectId}`}`}>Ir para Meu Desempenho</Link>
                  </Button>
                }
              />
            </Card>
          ) : (
            <div className="flex flex-col gap-4">
              <KpiStrip columns={4} mobileColumns={2} className="mb-1">
                <StatCard label="Bônus acumulado" value={formatCurrency(yearTotal)} icon={<Coins />} tone="success" hint={yearClosed > 0 ? `${yearClosed} competência(s) fechada(s) em ${year}` : `Nenhuma competência fechada em ${year}`} compact />
                <StatCard label="Projeção do mês" value={bonusTotalText(c)} icon={<CircleDollarSign />} tone={c.blocked ? "danger" : "info"} hint={c.maxAmount !== null ? `Máximo da faixa ${formatCurrency(c.maxAmount)} + extras` : "Salário base não cadastrado"} compact />
                <StatCard label="Meta atingida" value={formatPercent(c.overallAttainment)} icon={<Target />} tone="brand" progress={c.overallAttainment === null ? undefined : Math.min(100, c.overallAttainment * 100)} hint={`Individual ${formatPercent(c.individual.attainment)} · coletivo ${formatPercent(c.collective.attainment)}`} compact />
                <StatCard label="Próxima faixa" value={c.nextTier ? `faltam ${formatGap(c.nextTier.gap)}` : c.tier ? "Faixa máxima" : "—"} icon={<Gem />} tone="purple" progress={c.nextTier && c.overallAttainment !== null ? Math.min(100, (c.overallAttainment / c.nextTier.minAttainment) * 100) : undefined} hint={c.nextTier ? `para a faixa ${c.nextTier.label}` : c.tier?.label} compact />
              </KpiStrip>
              <BonusAlerts c={c} />

              <div className="grid grid-cols-1 gap-4 lg:grid-cols-2 2xl:grid-cols-[minmax(0,1.25fr)_minmax(0,1fr)_minmax(0,0.9fr)]">
                <Card>
                  <CardHeader>
                    <CardTitle>Composição do bônus</CardTitle>
                    <CardDescription>Valor da faixa rateado pela contribuição de cada critério ao atingimento geral, mais os extras.</CardDescription>
                  </CardHeader>
                  <CardContent className="pt-0">
                    <BonusCompositionDonut c={c} />
                  </CardContent>
                </Card>
                <Card className="p-5">
                  <BonusTierCard c={c} simulatorLines={simulatorLines} />
                </Card>
                <Card className="lg:col-span-2 2xl:col-span-1">
                  <CardHeader className="pb-2">
                    <CardTitle>Faixas de premiação</CardTitle>
                  </CardHeader>
                  <CardContent className="pt-1">
                    <BonusTiersList c={c} />
                  </CardContent>
                </Card>
              </div>

              <div className="grid grid-cols-1 gap-4 xl:grid-cols-[minmax(0,2fr)_minmax(0,1fr)]">
                <Card>
                  <CardHeader>
                    <CardTitle>Minhas metas</CardTitle>
                    <CardDescription>Cada indicador vem do motor de indicadores; clique para ver os registros de origem.</CardDescription>
                  </CardHeader>
                  <CardContent className="pb-2 pt-0">
                    <BonusGoalsTable c={c} />
                  </CardContent>
                </Card>
                <Card className="flex flex-col">
                  <CardHeader className="pb-2">
                    <CardTitle>Histórico de premiações</CardTitle>
                  </CardHeader>
                  <CardContent className="flex flex-1 flex-col pt-1">
                    <BonusHistoryChart items={data.history} />
                    <Link href={`/performance/bonus?${tabQuery}&aba=regulamento`} className="mt-auto inline-flex min-h-[44px] items-center justify-center gap-1 border-t border-border pt-3 text-sm font-medium text-brand-fg hover:text-brand-hover">
                      <FileText className="size-4" aria-hidden /> Ver regulamento
                    </Link>
                  </CardContent>
                </Card>
              </div>

              <Card>
                <CardHeader>
                  <CardTitle>Como o bônus foi calculado</CardTitle>
                  <CardDescription>Cada número vem do motor de indicadores; clique no indicador para ver os registros de origem.</CardDescription>
                </CardHeader>
                <CardContent className="pt-0">
                  <BonusBreakdown c={c} />
                </CardContent>
              </Card>

              <Card>
                <CardHeader>
                  <CardTitle>Competências fechadas</CardTitle>
                  <CardDescription>Resultados gravados no fechamento, com a versão da regra usada.</CardDescription>
                </CardHeader>
                <CardContent className="pt-0">
                  <BonusHistory items={data.history} />
                </CardContent>
              </Card>
            </div>
          )}
        </TabsContent>

        {c?.rule ? (
          <TabsContent value="regulamento">
            <Card>
              <CardContent className="py-5">
                <BonusRegulation rule={c.rule} names={names} />
              </CardContent>
            </Card>
          </TabsContent>
        ) : null}

        {data.canManage ? (
          <TabsContent value="equipe">
            <div className="flex flex-col gap-6">
              <Card>
                <CardHeader>
                  <CardTitle>Equipe · {month.label}</CardTitle>
                  <CardDescription>Bônus projetado, faixa e bloqueios de quem você gerencia.</CardDescription>
                </CardHeader>
                <CardContent className="pt-0">
                  <BonusTeamPanel rows={teamRows} month={month.key} monthLabel={month.label} options={data.blockOptions} periodOptions={monthOptions} canClose={viewer.isManager} />
                </CardContent>
              </Card>
              <Card>
                <CardHeader>
                  <CardTitle>Bloqueios (linhas vermelhas)</CardTitle>
                  <CardDescription>Registro com evidência, confirmação ou revogação por gestor/admin, com trilha de auditoria.</CardDescription>
                </CardHeader>
                <CardContent className="pt-0">
                  <BonusBlocksList blocks={data.blocks} audit={data.audit} manageableIds={access.manageableIds} />
                </CardContent>
              </Card>
            </div>
          </TabsContent>
        ) : null}
      </Tabs>
    </PageContainer>
  );
}
