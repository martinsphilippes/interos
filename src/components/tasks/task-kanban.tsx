"use client";

import * as React from "react";
import { useRouter } from "next/navigation";
import {
  DndContext,
  DragOverlay,
  KeyboardSensor,
  PointerSensor,
  TouchSensor,
  closestCorners,
  useDroppable,
  useSensor,
  useSensors,
  type DragEndEvent,
  type DragStartEvent,
  type UniqueIdentifier,
} from "@dnd-kit/core";
import { SortableContext, sortableKeyboardCoordinates, useSortable, verticalListSortingStrategy } from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import { GripVertical, Kanban } from "lucide-react";
import { TASK_STATUS_LABELS, type TaskStatus } from "@/domain/constants";
import { Avatar } from "@/components/ui/avatar";
import { EmptyState } from "@/components/ui/empty-state";
import { PriorityBadge } from "@/components/ui/priority-badge";
import { SlaBadge } from "@/components/ui/sla-badge";
import { toast } from "@/components/ui/toast";
import { cn } from "@/lib/utils";
import { changeTaskStatus, reorderTask } from "@/server/tasks/actions";
import { ChecklistIndicator, DueLabel } from "./task-bits";
import { KANBAN_COLUMNS, sortForKanban, type TaskListItem } from "./task-model";

type Columns = Record<TaskStatus, TaskListItem[]>;

const COLUMN_TONE: Record<TaskStatus, string> = {
  aberta: "border-t-info",
  em_andamento: "border-t-brand",
  aguardando: "border-t-warning",
  concluida: "border-t-success",
  cancelada: "border-t-border-strong",
};

function columnId(status: TaskStatus): string {
  return `col:${status}`;
}

function buildColumns(items: TaskListItem[]): Columns {
  const cols = { aberta: [], em_andamento: [], aguardando: [], concluida: [], cancelada: [] } as Columns;
  for (const t of sortForKanban(items)) cols[t.status].push(t);
  return cols;
}

function findColumn(cols: Columns, id: UniqueIdentifier): TaskStatus | null {
  const raw = String(id);
  if (raw.startsWith("col:")) return raw.slice(4) as TaskStatus;
  for (const status of KANBAN_COLUMNS) if (cols[status].some((t) => t.id === raw)) return status;
  return null;
}

export interface TaskKanbanProps {
  items: TaskListItem[];
  onOpen: (taskId: string) => void;
}

/**
 * Quadro por status com arrastar-e-soltar (dnd-kit). Soltar em outra coluna chama changeTaskStatus
 * (concluir/reabrir passam pelas regras do serviço); soltar na mesma coluna reordena (reorderTask).
 * A alça de arraste tem touch-action none; o resto do card abre o drawer no toque.
 */
export function TaskKanban({ items, onOpen }: TaskKanbanProps) {
  const router = useRouter();
  // Id estável para os atributos aria do @dnd-kit (evita divergência de hidratação "DndDescribedBy-N").
  const dndId = React.useId();
  const [columns, setColumns] = React.useState<Columns>(() => buildColumns(items));
  const [prevItems, setPrevItems] = React.useState(items);
  const [activeId, setActiveId] = React.useState<string | null>(null);
  const [, startTransition] = React.useTransition();

  // Sincroniza com os dados do servidor (ajuste de estado durante a renderização).
  if (items !== prevItems) {
    setPrevItems(items);
    setColumns(buildColumns(items));
  }

  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 8 } }),
    useSensor(TouchSensor, { activationConstraint: { distance: 8 } }),
    useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates }),
  );

  const activeTask = activeId ? (Object.values(columns).flat().find((t) => t.id === activeId) ?? null) : null;

  const onDragStart = (event: DragStartEvent) => setActiveId(String(event.active.id));

  const onDragEnd = (event: DragEndEvent) => {
    const { active, over } = event;
    setActiveId(null);
    if (!over) return;
    const taskId = String(active.id);
    const from = findColumn(columns, active.id);
    const to = findColumn(columns, over.id);
    if (!from || !to) return;

    const source = [...columns[from]];
    const fromIndex = source.findIndex((t) => t.id === taskId);
    if (fromIndex < 0) return;
    const [moved] = source.splice(fromIndex, 1);
    const target = from === to ? source : [...columns[to]];
    const overIndex = String(over.id).startsWith("col:") ? target.length : target.findIndex((t) => t.id === String(over.id));
    const insertAt = overIndex < 0 ? target.length : overIndex;
    if (from === to && insertAt === fromIndex) return;
    target.splice(insertAt, 0, { ...moved, status: to });

    setColumns({ ...columns, [from]: from === to ? target : source, [to]: target });

    startTransition(async () => {
      if (from !== to) {
        const result = await changeTaskStatus({ id: taskId, status: to });
        if (!result.ok) {
          toast.error(result.error);
          setColumns(buildColumns(items));
          return;
        }
        if (to === "concluida") toast.success(result.data.nextTaskId ? "Tarefa concluída; próxima ocorrência criada" : "Tarefa concluída");
        else toast.success(`Status: ${TASK_STATUS_LABELS[to]}`);
      }
      const order = await reorderTask({ status: to, orderedIds: target.map((t) => t.id) });
      if (!order.ok) toast.error(order.error);
      router.refresh();
    });
  };

  if (items.length === 0) {
    return (
      <div className="rounded-lg border border-border bg-surface">
        <EmptyState icon={<Kanban />} title="Nenhuma tarefa no quadro" description="Ajuste os filtros ou crie uma nova tarefa." />
      </div>
    );
  }

  return (
    <DndContext id={dndId} sensors={sensors} collisionDetection={closestCorners} onDragStart={onDragStart} onDragEnd={onDragEnd} onDragCancel={() => setActiveId(null)}>
      <div className="relative -mx-4 flex snap-x gap-3 overflow-x-auto px-4 pb-3 scrollbar-thin md:mx-0 md:grid md:grid-cols-4 md:overflow-visible md:px-0">
        {KANBAN_COLUMNS.map((status) => (
          <KanbanColumn key={status} status={status} tasks={columns[status]} onOpen={onOpen} />
        ))}
      </div>
      <DragOverlay dropAnimation={null}>{activeTask ? <KanbanCard task={activeTask} onOpen={() => undefined} overlay /> : null}</DragOverlay>
    </DndContext>
  );
}

function KanbanColumn({ status, tasks, onOpen }: { status: TaskStatus; tasks: TaskListItem[]; onOpen: (id: string) => void }) {
  const { setNodeRef, isOver } = useDroppable({ id: columnId(status) });
  return (
    <section
      ref={setNodeRef}
      aria-label={TASK_STATUS_LABELS[status]}
      className={cn("flex w-[82vw] shrink-0 snap-start flex-col rounded-lg border border-border border-t-[3px] bg-surface-muted md:w-auto", COLUMN_TONE[status], isOver && "ring-2 ring-brand/30")}
    >
      <header className="flex items-center justify-between px-3 py-2.5">
        <h3 className="text-sm font-semibold">{TASK_STATUS_LABELS[status]}</h3>
        <span className="rounded-full bg-surface px-2 py-0.5 text-xs font-medium tabular-nums text-muted">{tasks.length}</span>
      </header>
      <SortableContext items={tasks.map((t) => t.id)} strategy={verticalListSortingStrategy}>
        <div className="flex min-h-[120px] flex-1 flex-col gap-2 px-2 pb-2 md:max-h-[calc(100dvh-380px)] md:overflow-y-auto md:scrollbar-thin">
          {tasks.map((task) => (
            <SortableCard key={task.id} task={task} onOpen={onOpen} />
          ))}
          {tasks.length === 0 ? <p className="rounded-md border border-dashed border-border-strong px-3 py-6 text-center text-xs text-muted">Solte aqui</p> : null}
          {status === "concluida" && tasks.length > 0 ? <p className="px-1 pt-1 text-center text-[11px] text-muted-light">Concluídas nos últimos 7 dias</p> : null}
        </div>
      </SortableContext>
    </section>
  );
}

function SortableCard({ task, onOpen }: { task: TaskListItem; onOpen: (id: string) => void }) {
  const { attributes, listeners, setNodeRef, setActivatorNodeRef, transform, transition, isDragging } = useSortable({ id: task.id });
  const style: React.CSSProperties = { transform: CSS.Translate.toString(transform), transition };
  return (
    <div ref={setNodeRef} style={style} className={cn(isDragging && "opacity-40")}>
      <KanbanCard task={task} onOpen={onOpen} handleRef={setActivatorNodeRef} handleProps={{ ...attributes, ...listeners }} />
    </div>
  );
}

interface KanbanCardProps {
  task: TaskListItem;
  onOpen: (id: string) => void;
  handleRef?: (el: HTMLElement | null) => void;
  handleProps?: React.HTMLAttributes<HTMLButtonElement>;
  overlay?: boolean;
}

function KanbanCard({ task, onOpen, handleRef, handleProps, overlay }: KanbanCardProps) {
  return (
    <article
      className={cn("flex gap-1 rounded-lg border border-border bg-surface p-2.5 shadow-card transition-colors", overlay ? "rotate-1 shadow-pop" : "hover:border-border-strong")}
      onClick={() => onOpen(task.id)}
    >
      <button
        ref={handleRef}
        type="button"
        aria-label={`Arrastar ${task.title}`}
        className="-ml-1 flex w-7 shrink-0 cursor-grab touch-none items-center justify-center self-stretch rounded-md text-muted-light hover:bg-surface-hover hover:text-muted active:cursor-grabbing"
        onClick={(e) => e.stopPropagation()}
        {...handleProps}
      >
        <GripVertical className="size-4" />
      </button>
      <div className="min-w-0 flex-1">
        <p className={cn("text-sm font-medium leading-snug", task.status === "concluida" && "text-muted line-through")}>{task.title}</p>
        {task.clientName ? <p className="mt-0.5 truncate text-xs text-secondary">{task.clientName}</p> : null}
        <div className="mt-2 flex flex-wrap items-center gap-x-2 gap-y-1">
          <PriorityBadge priority={task.priority} />
          {task.status === "concluida" && task.completedLabel ? <span className="text-xs text-success-fg">{task.completedLabel}</span> : <DueLabel task={task} />}
          {task.sla ? <SlaBadge state={task.sla.state} remainingMs={task.sla.remainingMs} timeOnly /> : null}
          <ChecklistIndicator done={task.checklistDone} total={task.checklistTotal} />
          {task.assigneeName ? <Avatar name={task.assigneeName} src={task.assigneeAvatarUrl} size="xs" className="ml-auto" /> : null}
        </div>
      </div>
    </article>
  );
}
