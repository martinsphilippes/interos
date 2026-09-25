"use client";

import * as React from "react";
import { useRouter } from "next/navigation";
import { toast } from "@/components/ui/toast";
import { completeTask, reopenTask } from "@/server/tasks/actions";
import { OpenNewTaskButton } from "./new-task-dialog";
import { TaskCalendar } from "./task-calendar";
import { TaskFilters } from "./task-filters";
import { TaskKanban } from "./task-kanban";
import { TaskList } from "./task-list";
import { applyTaskFilters, filtersFromParams, type AssignableUser, type ClientOption, type StatusFilter, type TaskListItem, type TaskSort, type TaskView } from "./task-model";
import { useTaskUrl } from "./use-task-url";

export interface TasksWorkspaceProps {
  view: TaskView;
  items: TaskListItem[];
  users: AssignableUser[];
  clients: ClientOption[];
  currentUserId: string;
  todayKey: string;
  /** AAAA-MM (só na view de calendário). */
  month: string;
}

const EMPTY_COPY: Record<TaskView, { title: string; description: string }> = {
  minha: { title: "Sua lista está limpa", description: "Nenhuma tarefa aberta atribuída a você. Crie uma nova ou confira a equipe." },
  equipe: { title: "Nenhuma tarefa da equipe", description: "Não há tarefas abertas no seu escopo com os filtros atuais." },
  kanban: { title: "Quadro vazio", description: "Nenhuma tarefa para exibir." },
  calendario: { title: "Sem prazos neste mês", description: "Nenhuma tarefa com prazo no período." },
  atrasadas: { title: "Nada atrasado", description: "Todas as tarefas do escopo estão dentro do prazo." },
  concluidas: { title: "Nenhuma tarefa concluída", description: "As tarefas concluídas aparecem aqui com a data de conclusão." },
};

/** Orquestra filtros (URL) + view atual sobre os dados carregados pelo servidor. */
export function TasksWorkspace({ view, items, users, clients, currentUserId, todayKey, month }: TasksWorkspaceProps) {
  const router = useRouter();
  const { searchParams, navigate } = useTaskUrl();
  const [pendingIds, setPendingIds] = React.useState<ReadonlySet<string>>(new Set());
  const [, startTransition] = React.useTransition();

  const filters = React.useMemo(() => filtersFromParams((k) => searchParams.get(k)), [searchParams]);
  const defaultStatus: StatusFilter = view === "kanban" || view === "calendario" || view === "concluidas" ? "todas" : "abertas";
  const defaultSort: TaskSort = view === "concluidas" ? "atualizacao" : "prazo";
  const filtered = React.useMemo(
    () => applyTaskFilters(items, filters, { userId: currentUserId, todayKey, defaultStatus, defaultSort }),
    [items, filters, currentUserId, todayKey, defaultStatus, defaultSort],
  );

  const open = (taskId: string) => navigate({ tarefa: taskId });

  const toggleComplete = (task: TaskListItem, done: boolean) => {
    setPendingIds((s) => new Set(s).add(task.id));
    startTransition(async () => {
      const result = done ? await completeTask({ id: task.id }) : await reopenTask({ id: task.id });
      setPendingIds((s) => {
        const next = new Set(s);
        next.delete(task.id);
        return next;
      });
      if (!result.ok) {
        toast.error(result.error);
        return;
      }
      if (done) toast.success("nextTaskId" in result.data && result.data.nextTaskId ? "Tarefa concluída; próxima ocorrência criada" : "Tarefa concluída");
      else toast.success("Tarefa reaberta");
      router.refresh();
    });
  };

  const empty = EMPTY_COPY[view];

  return (
    <div>
      <TaskFilters view={view} filters={filters} users={users} clients={clients} count={filtered.length} total={items.length} defaultStatus={defaultStatus} defaultSort={defaultSort} />
      {view === "kanban" ? (
        <TaskKanban items={filtered} onOpen={open} />
      ) : view === "calendario" ? (
        <TaskCalendar items={filtered} month={month} todayKey={todayKey} onOpen={open} />
      ) : (
        <TaskList
          items={filtered}
          onOpen={open}
          onToggleComplete={toggleComplete}
          pendingIds={pendingIds}
          showStatus={view === "equipe" || view === "atrasadas" || (filters.status !== undefined && filters.status !== "abertas")}
          showCompleted={view === "concluidas"}
          emptyTitle={empty.title}
          emptyDescription={empty.description}
          emptyAction={view === "minha" || view === "equipe" ? <OpenNewTaskButton /> : undefined}
        />
      )}
    </div>
  );
}
