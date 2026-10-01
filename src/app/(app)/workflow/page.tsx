import type { Metadata } from "next";
import { GitBranch, Hourglass, ShieldCheck, Timer, UserRound } from "lucide-react";
import { can, requireScreen } from "@/server/auth/session";
import { EmptyState } from "@/components/ui/empty-state";
import { getStepDetail, getWorkflowBoard, listAssignableUsers } from "@/server/workflow/queries";
import { PageContainer } from "@/components/layout/page-container";
import { PageHeader } from "@/components/ui/page-header";
import { StatCard } from "@/components/ui/stat-card";
import { StepDrawer } from "@/components/workflow/step-drawer";
import { WorkflowBoard } from "@/components/workflow/workflow-board";

export const metadata: Metadata = { title: "Workflow" };

type SearchParams = Promise<Record<string, string | string[] | undefined>>;

function first(value: string | string[] | undefined): string | undefined {
  return Array.isArray(value) ? value[0] : value;
}

/**
 * Workflow operacional: jornadas ativas em kanban (uma coluna por etapa) ou lista.
 * Filtros e view vivem na URL e são aplicados no cliente; ?etapa=<stepId> abre o drawer da etapa.
 */
export default async function WorkflowPage({ searchParams }: { searchParams: SearchParams }) {
  const user = await requireScreen("operacao.workflow");
  const sp = await searchParams;
  const stepId = first(sp.etapa);
  // Seção "Quadro de jornadas": sem ela o quadro (e os indicadores) não é carregado; o drawer da etapa segue a seção
  // própria e o escopo (getStepDetail devolve null fora dele).
  const showBoard = can(user, "operacao.workflow.quadro.ver");

  const [board, users, detail] = await Promise.all([showBoard ? getWorkflowBoard(user) : Promise.resolve(null), listAssignableUsers(), stepId ? getStepDetail(stepId, user) : Promise.resolve(null)]);

  return (
    <PageContainer size="full">
      <PageHeader title="Workflow" description="Jornada de cada cliente, etapa por etapa. A passagem entre etapas só acontece pelo gate." />

      {board ? (
        <>
          <div className="mb-5 grid gap-3 sm:grid-cols-2 xl:grid-cols-5">
            <StatCard label="Processos ativos" value={board.summary.active} icon={<GitBranch />} tone="info" href="/workflow" hint="Jornadas em andamento" compact />
            <StatCard label="Etapas comigo" value={board.summary.mine} icon={<UserRound />} tone={board.summary.mine > 0 ? "info" : "neutral"} href="/workflow?mine=1" hint="Sob minha responsabilidade" compact />
            <StatCard label="SLA em risco ou violado" value={board.summary.slaRisk} icon={<Timer />} tone={board.summary.slaRisk > 0 ? "danger" : "success"} href="/workflow?sla=risco" hint="Precisam de ação agora" compact />
            <StatCard label="Aguardando aprovação" value={board.summary.awaitingApproval} icon={<ShieldCheck />} tone={board.summary.awaitingApproval > 0 ? "warning" : "neutral"} href="/workflow?status=aguardando_aprovacao" hint="Gates pendentes de aprovador" compact />
            <StatCard label="Aguardando cliente" value={board.summary.waitingClient} icon={<Hourglass />} tone={board.summary.waitingClient > 0 ? "warning" : "neutral"} href="/workflow?status=aguardando_cliente" hint="SLA pausado por dependência" compact />
          </div>

          <WorkflowBoard board={board} users={users} currentUserId={user.id} />
        </>
      ) : (
        <EmptyState title="Quadro indisponível para o seu perfil" description="Você pode abrir etapas pelos links do Meu Dia, das tarefas e da ficha do cliente." />
      )}

      <StepDrawer detail={detail} users={users} currentUserId={user.id} />
    </PageContainer>
  );
}
