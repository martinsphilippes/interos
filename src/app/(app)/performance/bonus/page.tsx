import type { Metadata } from "next";
import Link from "next/link";
import { Award, Calculator, CircleDollarSign, Gauge, Layers, Settings2 } from "lucide-react";
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
import { BonusSimulator, type SimulatorLine } from "@/components/performance/bonus-simulator";
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
    <PageContainer>
      <PageHeader
        title="Bônus e Premiação"
        description={c ? `${self ? "Seu bônus" : `Bônus de ${c.userName}`} · ${DEPARTMENT_LABELS[c.department]} · ${month.label}` : month.label}
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

      <Tabs defaultValue={c?.rule ? "mes" : data.canManage ? "equipe" : "mes"}>
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
            <div className="flex flex-col gap-6">
              <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
                <StatCard label="Bônus projetado" value={bonusTotalText(c)} icon={<CircleDollarSign />} tone={c.blocked ? "danger" : "success"} hint={c.maxAmount !== null ? `Máximo da faixa ${formatCurrency(c.maxAmount)} + extras` : "Salário base não cadastrado"} compact />
                <StatCard label="Atingimento geral" value={formatPercent(c.overallAttainment)} icon={<Gauge />} tone="info" hint={`Individual ${formatPercent(c.individual.attainment)} · coletivo ${formatPercent(c.collective.attainment)}`} compact />
                <StatCard label="Faixa" value={c.tier?.label ?? "—"} icon={<Layers />} tone="info" hint={c.nextTier ? `Faltam ${formatGap(c.nextTier.gap)} para ${c.nextTier.label}` : c.tier ? "Faixa máxima" : undefined} compact />
                <StatCard label="Extras" value={formatCurrency(c.extrasAmount)} icon={<Award />} tone="neutral" hint={c.extras.map((e) => `${e.quantity ?? "—"} × ${formatCurrency(e.amount)}`).join(" · ") || "Sem extras na regra"} compact />
              </div>
              <BonusAlerts c={c} />

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
                  <CardTitle className="flex items-center gap-2">
                    <Calculator className="size-4 text-muted" aria-hidden /> Simulador
                  </CardTitle>
                  <CardDescription>“Se meu SLA de solução for X% e o CSAT Y…”: ajuste os indicadores e veja a faixa e o valor resultantes.</CardDescription>
                </CardHeader>
                <CardContent className="pt-0">
                  <BonusSimulator rule={c.rule} lines={simulatorLines} salary={c.salary} extrasAmount={c.extrasAmount} blocked={c.blocked} />
                </CardContent>
              </Card>

              <Card>
                <CardHeader>
                  <CardTitle>Histórico de competências fechadas</CardTitle>
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
