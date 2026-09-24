"use client";

import * as React from "react";
import Link from "next/link";
import { ArrowRightLeft } from "lucide-react";
import type { MemberRow, ReassignTask } from "@/server/management/queries";
import { OVERLOAD_RATIO } from "@/server/management/schemas";
import { cn } from "@/lib/utils";
import { Avatar } from "@/components/ui/avatar";
import { Button } from "@/components/ui/button";
import { EmptyState } from "@/components/ui/empty-state";
import { RedistributeDialog } from "./redistribute-dialog";

export interface WorkloadCardProps {
  members: Pick<MemberRow, "id" | "name" | "avatarUrl" | "load" | "openTasks">[];
  teamAverageOpen: number;
  tasksByUser: Record<string, ReassignTask[]>;
  targets: { id: string; name: string; subtitle: string }[];
  limit?: number;
}

function loadTone(load: number | null): { bar: string; text: string } {
  if (load === null) return { bar: "bg-muted-light", text: "text-muted" };
  if (load > OVERLOAD_RATIO) return { bar: "bg-danger", text: "text-danger-fg" };
  if (load >= 0.9) return { bar: "bg-warning", text: "text-warning-fg" };
  return { bar: "bg-info", text: "text-foreground" };
}

/**
 * "Carga de trabalho": tarefas abertas de cada colaborador em relação à média da equipe (100% = na média;
 * acima de 110% fica vermelho) e o atalho para redistribuir tarefas do mais sobrecarregado.
 */
export function WorkloadCard({ members, teamAverageOpen, tasksByUser, targets, limit = 6 }: WorkloadCardProps) {
  const sorted = [...members].sort((a, b) => (b.load ?? -1) - (a.load ?? -1));
  const [fromId, setFromId] = React.useState<string>(sorted.find((m) => (tasksByUser[m.id] ?? []).length > 0)?.id ?? "");
  const [open, setOpen] = React.useState(false);
  const from = sorted.find((m) => m.id === fromId);

  if (members.length === 0) return <EmptyState size="sm" title="Sem colaboradores" description="Nenhum colaborador ativo neste escopo." />;

  return (
    <div className="flex flex-col gap-3">
      <ul className="flex flex-col gap-2.5">
        {sorted.slice(0, limit).map((m) => {
          const tone = loadTone(m.load);
          const width = m.load === null ? 0 : Math.min(100, (m.load / 1.5) * 100);
          return (
            <li key={m.id}>
              <Link href={`/gestao/equipe/${m.id}`} className="-mx-2 grid grid-cols-[minmax(0,7.5rem)_1fr_3.25rem] items-center gap-3 rounded-lg px-2 py-1 transition-colors hover:bg-surface-hover" title={`${m.openTasks} tarefa(s) abertas · média da equipe ${teamAverageOpen.toFixed(1).replace(".", ",")}`}>
                <span className="flex min-w-0 items-center gap-2">
                  <Avatar name={m.name} src={m.avatarUrl} size="xs" />
                  <span className="truncate text-sm">{m.name.split(" ")[0]}</span>
                </span>
                <span className="h-2 overflow-hidden rounded-full bg-track" aria-hidden>
                  <span className={cn("block h-full rounded-full", tone.bar)} style={{ width: `${width}%` }} />
                </span>
                <span className={cn("text-right text-sm font-semibold tabular-nums", tone.text)}>{m.load === null ? "—" : `${Math.round(m.load * 100)}%`}</span>
              </Link>
            </li>
          );
        })}
      </ul>
      {sorted.length > limit ? <p className="text-xs text-muted">+{sorted.length - limit} colaborador(es) na tabela abaixo</p> : null}
      <div className="flex flex-col gap-2 sm:flex-row sm:items-center">
        <label className="sr-only" htmlFor="workload-from">
          Redistribuir tarefas de
        </label>
        <select
          id="workload-from"
          value={fromId}
          onChange={(e) => setFromId(e.target.value)}
          className="h-11 min-w-0 flex-1 rounded-lg border border-border-strong bg-surface-muted px-3 text-sm text-foreground focus:border-brand focus:outline-none focus:ring-2 focus:ring-brand/25 md:h-9"
        >
          {sorted.map((m) => (
            <option key={m.id} value={m.id} disabled={(tasksByUser[m.id] ?? []).length === 0}>
              {m.name} · {(tasksByUser[m.id] ?? []).length} aberta(s)
            </option>
          ))}
        </select>
        <Button className="h-11 md:h-9" onClick={() => setOpen(true)} disabled={!from || (tasksByUser[from.id] ?? []).length === 0}>
          <ArrowRightLeft /> Redistribuir tarefas
        </Button>
      </div>
      {open && from ? <RedistributeDialog open={open} onOpenChange={setOpen} from={{ id: from.id, name: from.name }} tasks={tasksByUser[from.id] ?? []} targets={targets} /> : null}
    </div>
  );
}
