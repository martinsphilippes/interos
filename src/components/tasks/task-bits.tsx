"use client";

import Link from "next/link";
import { CalendarClock, ListChecks, Repeat, Tag } from "lucide-react";
import { TASK_STATUS_LABELS, type TaskStatus } from "@/domain/constants";
import { Badge, type BadgeProps } from "@/components/ui/badge";
import { cn } from "@/lib/utils";
import { clientHref, describeRecurrence, type TaskListItem } from "./task-model";

/** Peças pequenas compartilhadas entre lista, kanban, calendário e drawer. */

const STATUS_VARIANT: Record<TaskStatus, NonNullable<BadgeProps["variant"]>> = {
  aberta: "info",
  em_andamento: "brand",
  aguardando: "warning",
  concluida: "success",
  cancelada: "muted",
};

export function TaskStatusBadge({ status, size = "sm", className }: { status: TaskStatus; size?: BadgeProps["size"]; className?: string }) {
  return (
    <Badge variant={STATUS_VARIANT[status]} size={size} className={className}>
      {TASK_STATUS_LABELS[status]}
    </Badge>
  );
}

const DUE_TONE_CLASS = {
  overdue: "text-danger-fg font-medium",
  today: "text-warning-fg font-medium",
  upcoming: "text-muted",
  none: "text-muted",
} as const;

/** Prazo com cor semântica: atrasada em vermelho, hoje em âmbar. */
export function DueLabel({ task, className, iconless }: { task: Pick<TaskListItem, "dueLabel" | "dueTone" | "dueAt">; className?: string; iconless?: boolean }) {
  if (!task.dueAt || !task.dueLabel) return <span className={cn("text-xs text-muted-light", className)}>Sem prazo</span>;
  return (
    <span className={cn("inline-flex items-center gap-1 whitespace-nowrap text-xs tabular-nums", DUE_TONE_CLASS[task.dueTone], className)} title={task.dueTone === "overdue" ? "Atrasada" : task.dueTone === "today" ? "Vence hoje" : undefined}>
      {!iconless ? <CalendarClock className="size-3.5" aria-hidden /> : null}
      {task.dueLabel}
    </span>
  );
}

export function ChecklistIndicator({ done, total, className }: { done: number; total: number; className?: string }) {
  if (total === 0) return null;
  const complete = done === total;
  return (
    <span className={cn("inline-flex items-center gap-1 whitespace-nowrap text-xs tabular-nums", complete ? "text-success-fg" : "text-muted", className)} title="Checklist">
      <ListChecks className="size-3.5" aria-hidden />
      {done}/{total}
    </span>
  );
}

export function TagList({ tags, max = 3, className }: { tags: string[]; max?: number; className?: string }) {
  if (tags.length === 0) return null;
  const shown = tags.slice(0, max);
  const rest = tags.length - shown.length;
  return (
    <span className={cn("inline-flex flex-wrap items-center gap-1", className)}>
      {shown.map((tag) => (
        <Badge key={tag} variant="outline" size="sm" className="gap-1 font-normal text-muted">
          <Tag className="size-3" aria-hidden />
          {tag}
        </Badge>
      ))}
      {rest > 0 ? (
        <Badge variant="muted" size="sm" title={tags.slice(max).join(", ")}>
          +{rest}
        </Badge>
      ) : null}
    </span>
  );
}

export function RecurrenceHint({ task, className }: { task: Pick<TaskListItem, "recurrence">; className?: string }) {
  const text = describeRecurrence(task.recurrence);
  if (!text) return null;
  return (
    <span className={cn("inline-flex items-center gap-1 text-xs text-muted", className)} title={`Recorrente: ${text}`}>
      <Repeat className="size-3.5" aria-hidden />
      {text}
    </span>
  );
}

/** Link para o Cliente 360º; interrompe a propagação para não abrir o drawer da linha. */
export function ClientLink({ clientId, clientName, className }: { clientId?: string; clientName?: string; className?: string }) {
  if (!clientId || !clientName) return null;
  return (
    <Link href={clientHref(clientId)} onClick={(e) => e.stopPropagation()} className={cn("truncate text-xs text-secondary hover:underline", className)}>
      {clientName}
    </Link>
  );
}
