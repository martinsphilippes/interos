import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { Award, Building2, ClipboardX, Gauge, History, ListChecks, Target, Timer, Workflow } from "lucide-react";
import { requireRole } from "@/server/auth/session";
import { getMemberName, getTeamMemberView } from "@/server/management/queries";
import { parseFocus, type FocusKey } from "@/server/management/schemas";
import { parsePeriod, periodOptions } from "@/server/kpis/queries";
import { formatPercent } from "@/lib/format";
import { cn } from "@/lib/utils";
import { PageContainer } from "@/components/layout/page-container";
import { PageHeader } from "@/components/ui/page-header";
import { Avatar } from "@/components/ui/avatar";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { StatCard } from "@/components/ui/stat-card";
import { PeriodSelect } from "@/components/kpis/period-select";
import { RedistributeButton } from "@/components/management/redistribute-dialog";
import { BonusSummary, ClientList, EventList, ScorecardGrid, SlaList, StepList, TaskList } from "@/components/management/member-sections";

type Params = Promise<{ userId: string }>;
type SearchParams = Promise<Record<string, string | string[] | undefined>>;

export async function generateMetadata({ params }: { params: Params }): Promise<Metadata> {
  const { userId } = await params;
  const name = await getMemberName(userId);
  return { title: name ? `${name} · Equipe` : "Colaborador" };
}

function FocusCard({ active, id, title, description, icon, children, className }: { active: boolean; id: string; title: string; description?: string; icon: React.ReactNode; children: React.ReactNode; className?: string }) {
  return (
    <Card id={id} className={cn("scroll-mt-20", active && "border-brand ring-2 ring-brand/20", className)}>
      <CardHeader>
        <CardTitle className="flex items-center gap-2 [&_svg]:size-4 [&_svg]:text-muted">
          {icon} {title}
        </CardTitle>
        {description ? <CardDescription>{description}</CardDescription> : null}
      </CardHeader>
      <CardContent className="pt-0">{children}</CardContent>
    </Card>
  );
}

/** Visão do colaborador para o gestor: tarefas, SLAs, etapas, clientes, scorecard, bônus e histórico. */
export default async function TeamMemberPage({ params, searchParams }: { params: Params; searchParams: SearchParams }) {
  const [{ userId }, query, user] = await Promise.all([params, searchParams, requireRole("gestor", "diretoria")]);
  const period = parsePeriod(query);
  const focus = parseFocus(query.foco);
  const view = await getTeamMemberView(user, userId, period);
  if (!view) notFound();
  const { member, tasks } = view;
  const card = view.scorecard;
  const openTasks = [...tasks.overdue, ...tasks.open, ...tasks.waiting].map((t) => ({ id: t.id, title: t.title, dueLabel: t.dueLabel, overdue: t.overdue, clientName: t.clientName, priority: t.priority }));
  const slaRisk = view.slas.filter((s) => s.view.state === "em_risco" || s.view.state === "violado").length;
  const stalled = view.steps.filter((s) => s.stalled).length;
  const critical = view.clients.filter((c) => c.critical.length > 0).length;
  const back = (f?: FocusKey) => `/gestao/equipe/${member.id}${f ? `?foco=${f}` : ""}`;

  return (
    <PageContainer>
      <PageHeader
        title={member.name}
        description={`${member.jobTitle ?? member.roleLabel} · ${member.departmentLabel}${member.managerName ? ` · gestor: ${member.managerName}` : ""} · ${period.label}`}
        breadcrumbs={[{ label: "Gestão", href: "/gestao" }, { label: "Equipe", href: focus ? `/gestao?foco=${focus}` : "/gestao" }, { label: member.name }]}
        badge={<Avatar name={member.name} src={member.avatarUrl} size="sm" className="order-first" />}
        actions={
          <>
            <PeriodSelect options={periodOptions()} value={period.key} />
            <RedistributeButton size="md" from={{ id: member.id, name: member.name }} tasks={openTasks} targets={view.reassignTargets} />
            <Button asChild variant="outline" className="h-11 md:h-9">
              <Link href={`/performance?usuario=${member.id}`}>
                <Gauge /> Desempenho
              </Link>
            </Button>
          </>
        }
      />

      <div className="mb-5 grid gap-3 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-6">
        <StatCard compact label="Tarefas atrasadas" value={tasks.overdue.length} icon={<ClipboardX />} tone={tasks.overdue.length > 0 ? "danger" : "success"} href={`${back("atrasadas")}#tarefas`} />
        <StatCard compact label="Tarefas abertas" value={tasks.overdue.length + tasks.open.length + tasks.waiting.length} icon={<ListChecks />} tone="info" href={`${back()}#tarefas`} />
        <StatCard compact label="SLAs em risco" value={slaRisk} icon={<Timer />} tone={slaRisk > 0 ? "danger" : "success"} href={`${back("sla")}#slas`} />
        <StatCard compact label="Etapas paradas" value={stalled} icon={<Workflow />} tone={stalled > 0 ? "warning" : "success"} href={`${back("etapas")}#etapas`} />
        <StatCard compact label="Clientes críticos" value={critical} icon={<Building2 />} tone={critical > 0 ? "danger" : "success"} href={`${back("clientes")}#clientes`} />
        <StatCard compact label="Atingimento das metas" value={formatPercent(card?.overallAttainment)} icon={<Target />} tone={card?.overallAttainment === null || card?.overallAttainment === undefined ? "neutral" : card.overallAttainment >= 1 ? "success" : "warning"} href={`${back("metas")}#metas`} hint={card ? `${card.achieved} de ${card.withTarget} atingidas` : undefined} />
      </div>

      <div className="grid gap-5 xl:grid-cols-[minmax(0,2fr)_minmax(0,1fr)]">
        <div className="flex flex-col gap-5">
          <FocusCard id="tarefas" active={focus === "atrasadas"} title="Tarefas" icon={<ListChecks />} description="Cada tarefa abre no drawer; cliente e processo levam à origem.">
            <div className="flex flex-col gap-4">
              <div>
                <p className="label-caps text-danger-fg">Atrasadas ({tasks.overdue.length})</p>
                <TaskList tasks={tasks.overdue} empty="Nenhuma tarefa atrasada." />
              </div>
              <div>
                <p className="label-caps">Em aberto ({tasks.open.length})</p>
                <TaskList tasks={tasks.open} empty="Nenhuma tarefa em aberto no prazo." />
              </div>
              <div>
                <p className="label-caps">Aguardando ({tasks.waiting.length})</p>
                <TaskList tasks={tasks.waiting} empty="Nenhuma tarefa aguardando." />
              </div>
              <details>
                <summary className="flex min-h-[44px] cursor-pointer items-center text-sm text-muted hover:text-foreground">Concluídas em {period.label.toLowerCase()} ({tasks.completed.length})</summary>
                <TaskList tasks={tasks.completed} empty="Nenhuma tarefa concluída no período." />
              </details>
            </div>
          </FocusCard>

          <FocusCard id="metas" active={focus === "metas"} title="Scorecard" icon={<Target />} description={card ? `Atingimento médio ${formatPercent(card.overallAttainment)} · ${card.achieved} de ${card.withTarget} metas atingidas` : undefined}>
            <ScorecardGrid scorecard={card} />
          </FocusCard>

          <FocusCard id="etapas" active={focus === "etapas"} title="Etapas de workflow" icon={<Workflow />} description="Etapas abertas sob responsabilidade do colaborador; paradas primeiro.">
            <StepList steps={view.steps} />
          </FocusCard>

          <FocusCard id="clientes" active={focus === "clientes"} title="Clientes" icon={<Building2 />} description="Carteira, chamados e etapas abertas; críticos primeiro.">
            <ClientList clients={view.clients} />
          </FocusCard>
        </div>

        <div className="flex flex-col gap-5">
          <FocusCard id="slas" active={focus === "sla"} title="SLAs ativos" icon={<Timer />} description="Mais urgentes primeiro.">
            <SlaList slas={view.slas} />
          </FocusCard>

          {view.bonus ? (
            <FocusCard id="bonus" active={false} title="Bônus projetado" icon={<Award />} description={period.label}>
              <BonusSummary bonus={view.bonus} />
              <Button asChild variant="link" className="mt-3">
                <Link href="/performance/bonus">Ver detalhamento</Link>
              </Button>
            </FocusCard>
          ) : null}

          <FocusCard id="historico" active={false} title="Histórico recente" icon={<History />}>
            <EventList events={view.events} />
          </FocusCard>
        </div>
      </div>
    </PageContainer>
  );
}
