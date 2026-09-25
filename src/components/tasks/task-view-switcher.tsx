"use client";

import { AlertTriangle, CalendarDays, CheckCircle2, Kanban, ListChecks, Users } from "lucide-react";
import { SegmentedControl } from "@/components/ui/segmented-control";
import { TASK_VIEWS, TASK_VIEW_LABELS, type TaskView } from "./task-model";
import { useTaskUrl } from "./use-task-url";

const ICONS: Record<TaskView, React.ReactNode> = {
  minha: <ListChecks />,
  equipe: <Users />,
  kanban: <Kanban />,
  calendario: <CalendarDays />,
  atrasadas: <AlertTriangle />,
  concluidas: <CheckCircle2 />,
};

/** Alternador de views; a view vai para ?view=... (compartilhável). Fecha o drawer ao trocar. */
export function TaskViewSwitcher({ view }: { view: TaskView }) {
  const { navigate } = useTaskUrl();
  return (
    <div className="-mx-4 overflow-x-auto px-4 pb-1 scrollbar-none md:mx-0 md:px-0">
      <SegmentedControl
        aria-label="Visualização das tarefas"
        value={view}
        onChange={(next) => navigate({ view: next, tarefa: null, mes: null })}
        options={TASK_VIEWS.map((v) => ({ value: v, label: TASK_VIEW_LABELS[v], icon: ICONS[v] }))}
        className="[&>button]:min-h-[40px] md:[&>button]:min-h-0"
      />
    </div>
  );
}
