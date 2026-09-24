"use client";

import Link from "next/link";
import { format } from "date-fns";
import { ptBR } from "date-fns/locale";
import { CalendarDays, ChevronLeft, ChevronRight } from "lucide-react";
import { Button } from "@/components/ui/button";
import { EmptyState } from "@/components/ui/empty-state";
import { PriorityBadge } from "@/components/ui/priority-badge";
import { UserChip } from "@/components/ui/user-chip";
import { cn } from "@/lib/utils";
import { ClientLink, DueLabel } from "./task-bits";
import { addDaysToKey, type TaskListItem } from "./task-model";
import { useTaskUrl } from "./use-task-url";

const WEEKDAYS = ["Dom", "Seg", "Ter", "Qua", "Qui", "Sex", "Sáb"];
const MAX_PER_CELL = 3;

const PRIORITY_DOT = {
  baixa: "bg-muted-light",
  media: "bg-info",
  alta: "bg-warning",
  critica: "bg-danger",
} as const;

function shiftMonth(month: string, delta: number): string {
  const [y, m] = month.split("-").map(Number);
  return new Date(Date.UTC(y, m - 1 + delta, 1)).toISOString().slice(0, 7);
}

/** Dias da grade (domingo a sábado) cobrindo o mês; chaves AAAA-MM-DD. */
function gridDays(month: string): string[] {
  const [y, m] = month.split("-").map(Number);
  const first = `${month}-01`;
  const firstDow = new Date(Date.UTC(y, m - 1, 1)).getUTCDay();
  const daysInMonth = new Date(Date.UTC(y, m, 0)).getUTCDate();
  const start = addDaysToKey(first, -firstDow);
  const total = Math.ceil((firstDow + daysInMonth) / 7) * 7;
  return Array.from({ length: total }, (_, i) => addDaysToKey(start, i));
}

export interface TaskCalendarProps {
  items: TaskListItem[];
  /** AAAA-MM. */
  month: string;
  todayKey: string;
  onOpen: (taskId: string) => void;
}

/** Mês com tarefas por dia de prazo: grade no desktop, lista por dia no celular. Navegação via ?mes=. */
export function TaskCalendar({ items, month, todayKey, onOpen }: TaskCalendarProps) {
  const { href } = useTaskUrl();
  const [y, m] = month.split("-").map(Number);
  const title = format(new Date(y, m - 1, 1), "MMMM 'de' yyyy", { locale: ptBR });
  const byDay = new Map<string, TaskListItem[]>();
  for (const t of items) {
    if (!t.dueDayKey) continue;
    const list = byDay.get(t.dueDayKey) ?? [];
    list.push(t);
    byDay.set(t.dueDayKey, list);
  }
  for (const list of byDay.values()) list.sort((a, b) => (a.dueAt! < b.dueAt! ? -1 : 1));
  const days = gridDays(month);
  const daysWithTasks = Array.from(byDay.keys()).sort();

  return (
    <div className="flex flex-col gap-3">
      <div className="flex items-center justify-between gap-2">
        <h2 className="text-base font-semibold capitalize">{title}</h2>
        <div className="flex items-center gap-1">
          <Button asChild variant="outline" size="sm">
            <Link href={href({ mes: todayKey.slice(0, 7) })} scroll={false}>
              Hoje
            </Link>
          </Button>
          <Button asChild variant="outline" size="icon" className="size-9" aria-label="Mês anterior">
            <Link href={href({ mes: shiftMonth(month, -1) })} scroll={false}>
              <ChevronLeft />
            </Link>
          </Button>
          <Button asChild variant="outline" size="icon" className="size-9" aria-label="Próximo mês">
            <Link href={href({ mes: shiftMonth(month, 1) })} scroll={false}>
              <ChevronRight />
            </Link>
          </Button>
        </div>
      </div>

      {/* Grade (md+) */}
      <div className="hidden overflow-hidden rounded-lg border border-border bg-surface md:block">
        <div className="grid grid-cols-7 border-b border-border bg-surface-muted">
          {WEEKDAYS.map((d) => (
            <div key={d} className="px-2 py-1.5 text-center text-xs font-semibold uppercase tracking-wide text-muted">
              {d}
            </div>
          ))}
        </div>
        <div className="grid grid-cols-7">
          {days.map((key, i) => {
            const inMonth = key.startsWith(month);
            const tasks = byDay.get(key) ?? [];
            const isToday = key === todayKey;
            return (
              <div key={key} className={cn("min-h-[112px] border-b border-r border-border p-1.5", i % 7 === 6 && "border-r-0", !inMonth && "bg-surface-muted/60", i >= days.length - 7 && "border-b-0")}>
                <div className="mb-1 flex items-center justify-between">
                  <span className={cn("inline-flex size-6 items-center justify-center rounded-full text-xs tabular-nums", isToday ? "bg-brand font-semibold text-white" : inMonth ? "text-foreground" : "text-muted-light")}>
                    {Number(key.slice(8))}
                  </span>
                  {tasks.length > 0 ? <span className="text-[11px] tabular-nums text-muted">{tasks.length}</span> : null}
                </div>
                <ul className="flex flex-col gap-0.5">
                  {tasks.slice(0, MAX_PER_CELL).map((t) => (
                    <li key={t.id}>
                      <button
                        type="button"
                        onClick={() => onOpen(t.id)}
                        title={t.title}
                        className={cn(
                          "flex w-full items-center gap-1.5 rounded-sm px-1.5 py-0.5 text-left text-xs hover:bg-surface-hover",
                          t.dueTone === "overdue" && "text-danger-fg",
                          t.status === "concluida" && "text-muted line-through",
                        )}
                      >
                        <span className={cn("size-1.5 shrink-0 rounded-full", PRIORITY_DOT[t.priority])} aria-hidden />
                        <span className="truncate">{t.title}</span>
                      </button>
                    </li>
                  ))}
                  {tasks.length > MAX_PER_CELL ? <li className="px-1.5 text-[11px] text-muted">+{tasks.length - MAX_PER_CELL} mais</li> : null}
                </ul>
              </div>
            );
          })}
        </div>
      </div>

      {/* Lista por dia (celular) */}
      <div className="flex flex-col gap-3 md:hidden">
        {daysWithTasks.length === 0 ? (
          <div className="rounded-lg border border-border bg-surface">
            <EmptyState size="sm" icon={<CalendarDays />} title="Nenhuma tarefa com prazo neste mês" />
          </div>
        ) : (
          daysWithTasks.map((key) => {
            const tasks = byDay.get(key)!;
            const [, , d] = key.split("-").map(Number);
            const dow = WEEKDAYS[new Date(Date.UTC(y, m - 1, d)).getUTCDay()];
            return (
              <section key={key} className="overflow-hidden rounded-lg border border-border bg-surface">
                <header className={cn("flex items-center gap-2 border-b border-border px-3 py-2 text-sm font-semibold", key === todayKey && "bg-brand-soft text-brand-fg")}>
                  <span className="tabular-nums">{d}</span>
                  <span className="text-xs font-medium uppercase text-muted">{dow}</span>
                  {key === todayKey ? <span className="ml-auto text-xs font-medium">Hoje</span> : null}
                </header>
                <ul className="divide-y divide-border">
                  {tasks.map((t) => (
                    <li key={t.id}>
                      <button type="button" onClick={() => onOpen(t.id)} className="flex min-h-[44px] w-full flex-col gap-1 px-3 py-2 text-left hover:bg-surface-hover">
                        <span className={cn("text-sm font-medium", t.status === "concluida" && "text-muted line-through")}>{t.title}</span>
                        <span className="flex flex-wrap items-center gap-x-3 gap-y-1">
                          <DueLabel task={t} />
                          <PriorityBadge priority={t.priority} />
                          <ClientLink clientId={t.clientId} clientName={t.clientName} />
                          {t.assigneeName ? <UserChip name={t.assigneeName} avatarUrl={t.assigneeAvatarUrl} size="sm" /> : null}
                        </span>
                      </button>
                    </li>
                  ))}
                </ul>
              </section>
            );
          })
        )}
      </div>
      {items.length === 0 ? <p className="hidden text-center text-sm text-muted md:block">Nenhuma tarefa com prazo neste mês.</p> : null}
    </div>
  );
}
