"use client";

import * as React from "react";
import Link from "next/link";
import { ArrowRightLeft, Gauge, MoreHorizontal, Trophy, UserRound } from "lucide-react";
import type { MemberRow, ReassignTask } from "@/server/management/queries";
import { OVERLOAD_RATIO, type FocusKey } from "@/server/management/schemas";
import { Avatar } from "@/components/ui/avatar";
import { Badge, type BadgeProps } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import { EmptyState } from "@/components/ui/empty-state";
import { Progress } from "@/components/ui/progress";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { formatPercent } from "@/lib/format";
import { cn } from "@/lib/utils";
import { RedistributeDialog } from "./redistribute-dialog";

export interface TeamTableProps {
  members: MemberRow[];
  teamAverageOpen: number;
  tasksByUser: Record<string, ReassignTask[]>;
  targets: { id: string; name: string; subtitle: string }[];
  /** Coluna destacada quando o dashboard está em um foco de drill-down. */
  focus?: FocusKey;
  /** Período atual (links para o Meu Desempenho do colaborador). */
  periodKey?: string;
}

const RESULT_VARIANT: Record<MemberRow["result"]["tone"], NonNullable<BadgeProps["variant"]>> = { success: "success", info: "info", warning: "warning", danger: "danger", neutral: "muted" };

function memberHref(id: string, focus?: FocusKey): string {
  return `/gestao/equipe/${id}${focus ? `?foco=${focus}` : ""}`;
}

function pctTone(value: number | null, ok = 0.9, warn = 0.75): string {
  if (value === null) return "text-muted";
  if (value >= ok) return "text-success-fg";
  if (value >= warn) return "text-warning-fg";
  return "text-danger-fg";
}

function TasksCell({ m }: { m: MemberRow }) {
  const ratio = m.tasksTotal > 0 ? m.tasksDone / m.tasksTotal : null;
  return (
    <div className="flex min-w-[130px] items-center gap-2" title={`${m.tasksDone} concluídas de ${m.tasksTotal} no período · ${m.overdueTasks} atrasada(s)`}>
      <span className="w-12 shrink-0 text-sm tabular-nums">
        {m.tasksDone}/{m.tasksTotal}
      </span>
      <Progress value={ratio === null ? 0 : ratio * 100} tone={m.overdueTasks > 0 && ratio !== null && ratio < 0.75 ? "danger" : "info"} size="sm" className="flex-1" aria-label="Tarefas concluídas no período" />
    </div>
  );
}

function LoadText({ load }: { load: number | null }) {
  if (load === null) return <span className="text-xs text-muted">—</span>;
  const over = load > OVERLOAD_RATIO;
  return <span className={cn("text-sm font-medium tabular-nums", over ? "text-danger-fg" : load >= 0.9 ? "text-warning-fg" : "text-foreground")}>{formatPercent(load)}</span>;
}

function Rank({ points, rank }: { points: number; rank: number | null }) {
  return (
    <span className="inline-flex items-center gap-1 text-xs tabular-nums text-muted">
      {points} pts
      {rank ? (
        <span className={cn("inline-flex items-center gap-0.5", rank <= 3 && "text-brand-fg")}>
          {rank <= 3 ? <Trophy className="size-3" aria-hidden /> : null}#{rank}
        </span>
      ) : null}
    </span>
  );
}

function Actions({ m, tasks, targets, onRedistribute, periodKey }: { m: MemberRow; tasks: ReassignTask[]; targets: TeamTableProps["targets"]; onRedistribute: () => void; periodKey?: string }) {
  void targets;
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button variant="ghost" size="icon" className="size-11 md:size-8" aria-label={`Ações de ${m.name}`}>
          <MoreHorizontal />
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end">
        <DropdownMenuItem asChild>
          <Link href={memberHref(m.id)}>
            <UserRound /> Ver colaborador
          </Link>
        </DropdownMenuItem>
        <DropdownMenuItem asChild>
          <Link href={`/performance?usuario=${m.id}${periodKey ? `&periodo=${encodeURIComponent(periodKey)}` : ""}`}>
            <Gauge /> Ver desempenho
          </Link>
        </DropdownMenuItem>
        <DropdownMenuItem disabled={tasks.length === 0} onSelect={() => onRedistribute()}>
          <ArrowRightLeft /> Redistribuir tarefas
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

/**
 * "Desempenho individual": tarefas do período (concluídas/total), atrasadas, carga, SLA, qualidade (Índice de
 * desempenho) e resultado das metas de cada colaborador, com drill-down e redistribuição. No celular vira cards.
 */
export function TeamTable({ members, teamAverageOpen, tasksByUser, targets, focus, periodKey }: TeamTableProps) {
  const [redistribute, setRedistribute] = React.useState<MemberRow | null>(null);
  if (members.length === 0) {
    return <EmptyState title="Nenhum colaborador neste escopo" description="Não há colaboradores ativos vinculados a esta equipe ou departamento." />;
  }
  const hl = (key: FocusKey) => (focus === key ? "bg-brand-soft/40" : undefined);

  return (
    <>
      <div className="hidden md:block">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Colaborador</TableHead>
              <TableHead className="hidden xl:table-cell">Função</TableHead>
              <TableHead>Tarefas</TableHead>
              <TableHead className={cn("text-right", hl("atrasadas"))}>Atrasadas</TableHead>
              <TableHead className="text-right" title={`Abertas ÷ média da equipe (${teamAverageOpen.toFixed(1).replace(".", ",")})`}>
                Carga
              </TableHead>
              <TableHead className={cn("text-right", hl("sla"))}>SLA</TableHead>
              <TableHead className="text-right">Qualidade</TableHead>
              <TableHead className={cn("text-center", hl("metas"))}>Resultado</TableHead>
              <TableHead className="text-right">Ações</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {members.map((m) => (
              <TableRow key={m.id}>
                <TableCell>
                  <Link href={memberHref(m.id, focus)} className="flex min-h-[44px] items-center gap-2.5 hover:underline">
                    <Avatar name={m.name} src={m.avatarUrl} size="sm" />
                    <span className="flex min-w-0 flex-col leading-tight">
                      <span className="truncate text-sm font-medium text-foreground">{m.name}</span>
                      <Rank points={m.points} rank={m.rank} />
                    </span>
                  </Link>
                </TableCell>
                <TableCell className="hidden max-w-[200px] truncate text-sm text-muted xl:table-cell">{m.jobTitle ?? m.roleLabel}</TableCell>
                <TableCell>
                  <TasksCell m={m} />
                </TableCell>
                <TableCell className={cn("text-right", hl("atrasadas"))}>
                  {m.overdueTasks > 0 ? (
                    <Link href={memberHref(m.id, "atrasadas")} className="inline-flex min-h-8 min-w-8 items-center justify-center rounded-md px-1.5 font-semibold tabular-nums text-danger-fg underline-offset-2 hover:underline">
                      {m.overdueTasks}
                    </Link>
                  ) : (
                    <span className="tabular-nums text-muted">0</span>
                  )}
                </TableCell>
                <TableCell className="text-right">
                  <LoadText load={m.load} />
                </TableCell>
                <TableCell className={cn("text-right", hl("sla"))}>
                  <Link href={memberHref(m.id, "sla")} className={cn("text-sm font-medium tabular-nums hover:underline", pctTone(m.slaRate))} title={m.slaAtRisk > 0 ? `${m.slaAtRisk} SLA(s) em risco agora` : undefined}>
                    {m.slaRate === null ? "—" : formatPercent(m.slaRate)}
                  </Link>
                </TableCell>
                <TableCell className={cn("text-right text-sm font-medium tabular-nums", pctTone(m.quality === null ? null : m.quality / 100, 0.85, 0.7))}>{m.quality === null ? "—" : `${Math.round(m.quality)}/100`}</TableCell>
                <TableCell className={cn("text-center", hl("metas"))}>
                  <Link href={memberHref(m.id, "metas")} title={`${m.achieved} de ${m.withTarget} metas atingidas · atingimento ${formatPercent(m.attainment)}`}>
                    <Badge variant={RESULT_VARIANT[m.result.tone]} size="sm">
                      {m.result.label}
                    </Badge>
                  </Link>
                </TableCell>
                <TableCell className="text-right">
                  <Actions m={m} tasks={tasksByUser[m.id] ?? []} targets={targets} onRedistribute={() => setRedistribute(m)} periodKey={periodKey} />
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </div>

      <ul className="flex flex-col gap-3 md:hidden">
        {members.map((m) => (
          <li key={m.id} className="rounded-lg border border-border bg-surface-muted/40 p-3.5">
            <div className="flex items-center gap-2.5">
              <Link href={memberHref(m.id, focus)} className="flex min-h-[44px] min-w-0 flex-1 items-center gap-2.5">
                <Avatar name={m.name} src={m.avatarUrl} size="md" />
                <span className="flex min-w-0 flex-1 flex-col leading-tight">
                  <span className="truncate font-medium text-foreground">{m.name}</span>
                  <span className="truncate text-xs text-muted">{m.jobTitle ?? m.roleLabel}</span>
                </span>
              </Link>
              <Badge variant={RESULT_VARIANT[m.result.tone]} size="sm">
                {m.result.label}
              </Badge>
              <Actions m={m} tasks={tasksByUser[m.id] ?? []} targets={targets} onRedistribute={() => setRedistribute(m)} periodKey={periodKey} />
            </div>
            <div className="mt-3">
              <TasksCell m={m} />
            </div>
            <dl className="mt-3 grid grid-cols-4 gap-2 text-center text-xs">
              <Link href={memberHref(m.id, "atrasadas")} className="rounded-md bg-surface p-2">
                <dt className="text-muted">Atrasadas</dt>
                <dd className={cn("text-base font-semibold tabular-nums", m.overdueTasks > 0 && "text-danger-fg")}>{m.overdueTasks}</dd>
              </Link>
              <div className="rounded-md bg-surface p-2">
                <dt className="text-muted">Carga</dt>
                <dd className="text-base">
                  <LoadText load={m.load} />
                </dd>
              </div>
              <Link href={memberHref(m.id, "sla")} className="rounded-md bg-surface p-2">
                <dt className="text-muted">SLA</dt>
                <dd className={cn("text-base font-semibold tabular-nums", pctTone(m.slaRate))}>{m.slaRate === null ? "—" : formatPercent(m.slaRate)}</dd>
              </Link>
              <div className="rounded-md bg-surface p-2">
                <dt className="text-muted">Qualid.</dt>
                <dd className="text-base font-semibold tabular-nums">{m.quality === null ? "—" : Math.round(m.quality)}</dd>
              </div>
            </dl>
          </li>
        ))}
      </ul>
      {redistribute ? (
        <RedistributeDialog open onOpenChange={(o) => !o && setRedistribute(null)} from={{ id: redistribute.id, name: redistribute.name }} tasks={tasksByUser[redistribute.id] ?? []} targets={targets} />
      ) : null}
    </>
  );
}
