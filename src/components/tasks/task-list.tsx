"use client";

import * as React from "react";
import { CheckSquare } from "lucide-react";
import { Checkbox } from "@/components/ui/checkbox";
import { EmptyState } from "@/components/ui/empty-state";
import { PriorityBadge } from "@/components/ui/priority-badge";
import { SlaBadge } from "@/components/ui/sla-badge";
import { UserChip } from "@/components/ui/user-chip";
import { cn } from "@/lib/utils";
import { ChecklistIndicator, ClientLink, DueLabel, RecurrenceHint, TagList, TaskStatusBadge } from "./task-bits";
import type { TaskListItem } from "./task-model";

export interface TaskListProps {
  items: TaskListItem[];
  onOpen: (taskId: string) => void;
  /** Checkbox de conclusão rápida: marca conclui, desmarca reabre. */
  onToggleComplete: (task: TaskListItem, done: boolean) => void;
  pendingIds: ReadonlySet<string>;
  /** Mostra a coluna de status (views que misturam status). */
  showStatus?: boolean;
  /** Mostra "concluída em" no lugar do prazo. */
  showCompleted?: boolean;
  emptyTitle?: string;
  emptyDescription?: React.ReactNode;
  emptyAction?: React.ReactNode;
}

/** Lista densa: linhas no desktop, cards empilhados no celular. Clique abre o drawer (?tarefa=id). */
export function TaskList({ items, onOpen, onToggleComplete, pendingIds, showStatus, showCompleted, emptyTitle = "Nenhuma tarefa por aqui", emptyDescription, emptyAction }: TaskListProps) {
  if (items.length === 0) {
    return (
      <div className="rounded-lg border border-border bg-surface">
        <EmptyState icon={<CheckSquare />} title={emptyTitle} description={emptyDescription} action={emptyAction} />
      </div>
    );
  }

  return (
    <ul className="divide-y divide-border overflow-hidden rounded-lg border border-border bg-surface" aria-label="Lista de tarefas">
      {items.map((task) => {
        const done = task.status === "concluida";
        const pending = pendingIds.has(task.id);
        return (
          <li
            key={task.id}
            className={cn("group relative flex cursor-pointer items-start gap-3 px-3 py-2.5 transition-colors hover:bg-surface-hover md:items-center md:px-4", pending && "opacity-60")}
            onClick={() => onOpen(task.id)}
            onKeyDown={(e) => {
              if (e.target === e.currentTarget && (e.key === "Enter" || e.key === " ")) {
                e.preventDefault();
                onOpen(task.id);
              }
            }}
            tabIndex={0}
            role="button"
            aria-label={`Abrir tarefa ${task.title}`}
          >
            <span className="flex min-h-[28px] items-center md:min-h-0" onClick={(e) => e.stopPropagation()}>
              <Checkbox
                checked={done}
                disabled={pending || task.status === "cancelada"}
                onCheckedChange={(v) => onToggleComplete(task, v === true)}
                aria-label={done ? `Reabrir ${task.title}` : `Concluir ${task.title}`}
                className="size-[18px] md:size-4"
              />
            </span>

            <div className="flex min-w-0 flex-1 flex-col gap-1 md:flex-row md:items-center md:gap-4">
              {/* Título + cliente + tags */}
              <div className="min-w-0 flex-1">
                <p className={cn("truncate text-sm font-medium text-foreground", done && "text-muted line-through")}>{task.title}</p>
                <div className="mt-0.5 flex min-w-0 flex-wrap items-center gap-x-2 gap-y-1">
                  <ClientLink clientId={task.clientId} clientName={task.clientName} />
                  {task.tags.length > 0 ? <TagList tags={task.tags} max={2} /> : null}
                  <RecurrenceHint task={task} className="hidden lg:inline-flex" />
                </div>
              </div>

              {/* Meta: responsável, prioridade, prazo, SLA, checklist */}
              <div className="flex flex-wrap items-center gap-x-3 gap-y-1 md:shrink-0 md:justify-end">
                {showStatus ? <TaskStatusBadge status={task.status} /> : null}
                {task.assigneeName ? <UserChip name={task.assigneeName} avatarUrl={task.assigneeAvatarUrl} size="sm" className="max-w-[160px]" /> : <span className="text-xs text-muted-light">Sem responsável</span>}
                <PriorityBadge priority={task.priority} />
                {showCompleted && task.completedLabel ? (
                  <span className="text-xs text-success-fg tabular-nums">Concluída {task.completedLabel}</span>
                ) : (
                  <DueLabel task={task} />
                )}
                {task.sla ? <SlaBadge state={task.sla.state} remainingMs={task.sla.remainingMs} timeOnly /> : null}
                <ChecklistIndicator done={task.checklistDone} total={task.checklistTotal} />
              </div>
            </div>
          </li>
        );
      })}
    </ul>
  );
}
