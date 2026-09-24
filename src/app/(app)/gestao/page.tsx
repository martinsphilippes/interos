import type { Metadata } from "next";
import { AlertTriangle, BarChart3, Building2, ClipboardX, Radar, Target, Timer, Workflow } from "lucide-react";
import Link from "next/link";
import { requireRole } from "@/server/auth/session";
import { getManagerDashboard } from "@/server/management/queries";
import { parseFocus, type FocusKey } from "@/server/management/schemas";
import { parsePeriod, periodOptions } from "@/server/kpis/queries";
import { DEPARTMENT_KEYS, DEPARTMENT_LABELS } from "@/domain/constants";
import { PageContainer } from "@/components/layout/page-container";
import { PageHeader } from "@/components/ui/page-header";
import { SectionTitle } from "@/components/ui/section-title";
import { StatCard, type StatTone } from "@/components/ui/stat-card";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { PeriodSelect } from "@/components/kpis/period-select";
import { InsightList } from "@/components/insights/insight-list";
import { ScopeSelect } from "@/components/management/scope-select";
import { TeamTable } from "@/components/management/team-table";
import { FocusPanel } from "@/components/management/focus-panel";
import { DepartmentKpis } from "@/components/management/department-kpis";

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

const tone = (value: number, danger = true): StatTone => (value === 0 ? "success" : danger ? "danger" : "warning");

/**
 * Dashboard do Gestor: a equipe do gestor (ou departamento/empresa para admin e diretoria), com cadeia de
 * drill-down card → colaboradores → itens → tarefa/cliente/processo, indicadores do departamento e alertas.
 */
export default async function ManagerDashboardPage({ searchParams }: { searchParams: SearchParams }) {
  const [user, query] = await Promise.all([requireRole("gestor", "diretoria"), searchParams]);
  const period = parsePeriod(query);
  const focus = parseFocus(query.foco);
  const departamento = one(query.departamento);
  const data = await getManagerDashboard(user, { departamento, period });
  const { scope, stats } = data;
  const linkParams = { departamento: scope.kind === "departamento" ? scope.department : undefined, periodo: one(query.periodo) };

  const cards: { key: FocusKey; label: string; icon: React.ReactNode; hint: string; danger?: boolean }[] = [
    { key: "atrasadas", label: "Tarefas atrasadas", icon: <ClipboardX />, hint: "Da equipe, com prazo vencido" },
    { key: "sla", label: "SLAs em risco/violados", icon: <Timer />, hint: "Tarefas, etapas, chamados e projetos" },
    { key: "etapas", label: "Etapas paradas", icon: <Workflow />, hint: "Sem movimento, SLA violado ou aguardando aprovação", danger: false },
    { key: "clientes", label: "Clientes críticos", icon: <Building2 />, hint: "Saúde em risco, chamado crítico ou inadimplente" },
    { key: "metas", label: "Metas em risco", icon: <Target />, hint: "Indicadores do departamento em crítico" },
  ];

  const scopeOptions = [{ value: "empresa", label: "Empresa inteira" }, ...DEPARTMENT_KEYS.filter((d) => d !== "diretoria").map((d) => ({ value: d, label: DEPARTMENT_LABELS[d] }))];

  return (
    <PageContainer>
      <PageHeader
        title="Dashboard do Gestor"
        description={`${scope.label} · ${scope.description} · ${period.label}`}
        breadcrumbs={[{ label: "Gestão" }, { label: "Dashboard do Gestor" }]}
        actions={
          <>
            {scope.canChoose ? <ScopeSelect value={scope.selected} options={scopeOptions} /> : null}
            <PeriodSelect options={periodOptions()} value={period.key} />
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
          </>
        }
      />

      <div className="mb-5 grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-5">
        {cards.map((c) => (
          <StatCard
            key={c.key}
            label={c.label}
            value={stats[c.key]}
            icon={c.icon}
            tone={tone(stats[c.key], c.danger !== false)}
            href={hrefWith(linkParams, focus === c.key ? undefined : c.key)}
            hint={c.hint}
            compact
            className={focus === c.key ? "border-brand ring-2 ring-brand/20" : undefined}
          />
        ))}
      </div>

      {focus ? (
        <div className="mb-5">
          <FocusPanel focus={focus} members={data.members} criticalClients={data.criticalClients} criticalKpis={data.criticalKpis} clearHref={hrefWith(linkParams)} />
        </div>
      ) : null}

      <section className="mb-6">
        <SectionTitle title="Colaboradores" count={data.members.length} description="Carga = tarefas abertas ÷ média da equipe; acima de 110% fica vermelho. Clique no número para ver os itens." />
        <Card className="overflow-hidden p-0 md:p-0">
          <div className="p-3 md:p-0">
            <TeamTable members={data.members} teamAverageOpen={data.teamAverageOpen} tasksByUser={data.reassign.tasksByUser} targets={data.reassign.targets} focus={focus} />
          </div>
        </Card>
      </section>

      <div className="grid grid-cols-1 gap-5 xl:grid-cols-[minmax(0,2fr)_minmax(0,1fr)]">
        <section>
          <SectionTitle title="Indicadores do departamento" description="Cada indicador abre o drill-down até os registros de origem." />
          <DepartmentKpis scorecards={data.scorecards} />
        </section>
        <section>
          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <AlertTriangle className="size-4 text-warning-fg" aria-hidden /> Alertas do gestor
              </CardTitle>
              <CardDescription>Gargalos detectados por regras sobre os indicadores do período versus o anterior.</CardDescription>
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
