import type { Metadata } from "next";
import { AlertTriangle, CalendarCheck, CheckCircle2, Loader } from "lucide-react";
import { requireUser } from "@/server/auth/session";
import { countTaskSummary, currentMonthKey, getTaskDetail, listAssignableUsers, listClientsForSelect, listTasksForUser, todayKey } from "@/server/tasks/queries";
import { PageContainer } from "@/components/layout/page-container";
import { PageHeader } from "@/components/ui/page-header";
import { StatCard } from "@/components/ui/stat-card";
import { NewTaskDialog } from "@/components/tasks/new-task-dialog";
import { TaskDrawer } from "@/components/tasks/task-drawer";
import { TaskViewSwitcher } from "@/components/tasks/task-view-switcher";
import { TasksWorkspace } from "@/components/tasks/tasks-workspace";
import { parseTaskView } from "@/components/tasks/task-model";

export const metadata: Metadata = { title: "Tarefas" };

type SearchParams = Promise<Record<string, string | string[] | undefined>>;

function first(value: string | string[] | undefined): string | undefined {
  return Array.isArray(value) ? value[0] : value;
}

function parseMonth(value: string | undefined): string | undefined {
  return value && /^\d{4}-(0[1-9]|1[0-2])$/.test(value) ? value : undefined;
}

/**
 * Central de Tarefas. A view e o mês vêm da URL e definem o recorte carregado no servidor;
 * os demais filtros são aplicados no cliente sobre esses dados. ?tarefa=<id> abre o drawer.
 */
export default async function TarefasPage({ searchParams }: { searchParams: SearchParams }) {
  const user = await requireUser();
  const sp = await searchParams;
  const view = parseTaskView(first(sp.view));
  const month = parseMonth(first(sp.mes)) ?? currentMonthKey();
  const taskId = first(sp.tarefa);

  const [items, summary, users, clients, detail] = await Promise.all([
    listTasksForUser(user, view, { month }),
    countTaskSummary(user),
    listAssignableUsers(),
    listClientsForSelect(),
    taskId ? getTaskDetail(taskId) : Promise.resolve(null),
  ]);

  const canDelete = detail ? user.isManager || detail.task.creatorId === user.id : false;

  return (
    <PageContainer size={view === "kanban" ? "full" : "default"}>
      <PageHeader title="Tarefas" description="Tudo o que precisa ser feito, por pessoa, equipe, prazo e status." actions={<NewTaskDialog users={users} clients={clients} currentUser={{ id: user.id, departmentId: user.departmentId }} />}>
        <TaskViewSwitcher view={view} />
      </PageHeader>

      <div className="mb-5 grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
        <StatCard label="Hoje" value={summary.today} icon={<CalendarCheck />} tone={summary.today > 0 ? "info" : "neutral"} href="/tarefas?view=minha&prazo=hoje" hint="Suas tarefas com prazo hoje" compact />
        <StatCard label="Atrasadas" value={summary.overdue} icon={<AlertTriangle />} tone={summary.overdue > 0 ? "danger" : "success"} href="/tarefas?view=atrasadas&mine=1" hint="Suas tarefas com prazo vencido" compact />
        <StatCard label="Em andamento" value={summary.inProgress} icon={<Loader />} tone="warning" href="/tarefas?view=minha&status=em_andamento" hint="Suas tarefas em execução" compact />
        <StatCard label="Concluídas na semana" value={summary.completedThisWeek} icon={<CheckCircle2 />} tone="success" href="/tarefas?view=concluidas&mine=1" hint="Desde segunda-feira" compact />
      </div>

      <TasksWorkspace view={view} items={items} users={users} clients={clients} currentUserId={user.id} todayKey={todayKey()} month={month} />

      <TaskDrawer detail={detail} users={users} clients={clients} currentUserId={user.id} canDelete={canDelete} />
    </PageContainer>
  );
}
