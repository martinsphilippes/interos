"use client";

import Link from "next/link";
import { Trophy } from "lucide-react";
import type { MemberRow, ReassignTask } from "@/server/management/queries";
import { OVERLOAD_RATIO, type FocusKey } from "@/server/management/schemas";
import { Avatar } from "@/components/ui/avatar";
import { EmptyState } from "@/components/ui/empty-state";
import { Progress } from "@/components/ui/progress";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { AttainmentBar } from "@/components/kpis/attainment-bar";
import { formatPercent } from "@/lib/format";
import { cn } from "@/lib/utils";
import { RedistributeButton } from "./redistribute-dialog";

export interface TeamTableProps {
  members: MemberRow[];
  teamAverageOpen: number;
  tasksByUser: Record<string, ReassignTask[]>;
  targets: { id: string; name: string; subtitle: string }[];
  /** Coluna destacada quando o dashboard está em um foco de drill-down. */
  focus?: FocusKey;
}

function memberHref(id: string, focus?: FocusKey): string {
  return `/gestao/equipe/${id}${focus ? `?foco=${focus}` : ""}`;
}

function LoadBar({ load }: { load: number | null }) {
  if (load === null) return <span className="text-xs text-muted">—</span>;
  const over = load > OVERLOAD_RATIO;
  return (
    <div className="flex min-w-[110px] items-center gap-2" title={`${formatPercent(load)} da média da equipe`}>
      <Progress value={Math.min(100, (load / 2) * 100)} tone={over ? "danger" : load >= 0.9 ? "warning" : "secondary"} size="sm" className="flex-1" aria-label={`Carga ${formatPercent(load)} da média`} />
      <span className={cn("w-10 text-right text-xs font-medium tabular-nums", over ? "text-danger-fg" : "text-foreground")}>{formatPercent(load)}</span>
    </div>
  );
}

function CountLink({ value, href, danger }: { value: number; href: string; danger?: boolean }) {
  if (value === 0) return <span className="tabular-nums text-muted">0</span>;
  return (
    <Link href={href} className={cn("inline-flex min-h-8 min-w-8 items-center justify-center rounded-md px-1.5 font-semibold tabular-nums underline-offset-2 hover:underline", danger ? "text-danger-fg" : "text-foreground")}>
      {value}
    </Link>
  );
}

function Rank({ points, rank }: { points: number; rank: number | null }) {
  return (
    <span className="inline-flex items-center gap-1 text-xs tabular-nums">
      <span className="font-medium text-foreground">{points} pts</span>
      {rank ? (
        <span className={cn("inline-flex items-center gap-0.5 text-muted", rank <= 3 && "text-brand-fg")}>
          {rank <= 3 ? <Trophy className="size-3" aria-hidden /> : null}#{rank}
        </span>
      ) : null}
    </span>
  );
}

/**
 * Tabela de colaboradores do dashboard: carga, atrasos, SLAs, metas e pontos, com drill-down para a visão
 * do colaborador e ação de redistribuir tarefas. Em telas pequenas vira cards.
 */
export function TeamTable({ members, teamAverageOpen, tasksByUser, targets, focus }: TeamTableProps) {
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
              <TableHead className="text-right">Abertas</TableHead>
              <TableHead className={cn("text-right", hl("atrasadas"))}>Atrasadas</TableHead>
              <TableHead className="text-right">Concluídas</TableHead>
              <TableHead title={`Abertas ÷ média da equipe (${teamAverageOpen.toFixed(1).replace(".", ",")})`}>Carga</TableHead>
              <TableHead className={cn("text-right", hl("sla"))}>SLAs em risco</TableHead>
              <TableHead className={cn("text-right", hl("etapas"))}>Etapas paradas</TableHead>
              <TableHead className={cn("min-w-[150px]", hl("metas"))}>Metas</TableHead>
              <TableHead>Pontos</TableHead>
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
                      <span className="truncate text-xs text-muted">{m.jobTitle ?? m.roleLabel} · {m.departmentLabel}</span>
                    </span>
                  </Link>
                </TableCell>
                <TableCell className="text-right tabular-nums">{m.openTasks}</TableCell>
                <TableCell className={cn("text-right", hl("atrasadas"))}>
                  <CountLink value={m.overdueTasks} href={memberHref(m.id, "atrasadas")} danger />
                </TableCell>
                <TableCell className="text-right tabular-nums">{m.completedInPeriod}</TableCell>
                <TableCell>
                  <LoadBar load={m.load} />
                </TableCell>
                <TableCell className={cn("text-right", hl("sla"))}>
                  <CountLink value={m.slaAtRisk} href={memberHref(m.id, "sla")} danger />
                </TableCell>
                <TableCell className={cn("text-right", hl("etapas"))}>
                  <CountLink value={m.stalledSteps} href={memberHref(m.id, "etapas")} />
                </TableCell>
                <TableCell className={hl("metas")}>
                  <Link href={memberHref(m.id, "metas")} className="block min-w-[140px]" title={`${m.achieved} de ${m.withTarget} metas atingidas · ${m.criticalGoals} crítica(s)`}>
                    <AttainmentBar attainment={m.attainment} status={m.attainmentStatus} size="sm" />
                  </Link>
                </TableCell>
                <TableCell>
                  <Rank points={m.points} rank={m.rank} />
                </TableCell>
                <TableCell className="text-right">
                  <RedistributeButton label="Redistribuir" from={{ id: m.id, name: m.name }} tasks={tasksByUser[m.id] ?? []} targets={targets} />
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </div>

      <ul className="flex flex-col gap-3 md:hidden">
        {members.map((m) => (
          <li key={m.id} className="rounded-lg border border-border bg-surface p-3.5 shadow-card">
            <Link href={memberHref(m.id, focus)} className="flex min-h-[44px] items-center gap-2.5">
              <Avatar name={m.name} src={m.avatarUrl} size="md" />
              <span className="flex min-w-0 flex-1 flex-col leading-tight">
                <span className="truncate font-medium text-foreground">{m.name}</span>
                <span className="truncate text-xs text-muted">{m.jobTitle ?? m.roleLabel}</span>
              </span>
              <Rank points={m.points} rank={m.rank} />
            </Link>
            <dl className="mt-3 grid grid-cols-3 gap-2 text-center text-xs">
              <div className="rounded-md bg-surface-muted p-2">
                <dt className="text-muted">Abertas</dt>
                <dd className="text-base font-semibold tabular-nums">{m.openTasks}</dd>
              </div>
              <Link href={memberHref(m.id, "atrasadas")} className="rounded-md bg-surface-muted p-2">
                <dt className="text-muted">Atrasadas</dt>
                <dd className={cn("text-base font-semibold tabular-nums", m.overdueTasks > 0 && "text-danger-fg")}>{m.overdueTasks}</dd>
              </Link>
              <Link href={memberHref(m.id, "sla")} className="rounded-md bg-surface-muted p-2">
                <dt className="text-muted">SLAs</dt>
                <dd className={cn("text-base font-semibold tabular-nums", m.slaAtRisk > 0 && "text-danger-fg")}>{m.slaAtRisk}</dd>
              </Link>
            </dl>
            <div className="mt-3 flex flex-col gap-2">
              <div className="flex items-center gap-2 text-xs">
                <span className="w-14 shrink-0 text-muted">Carga</span>
                <div className="flex-1">
                  <LoadBar load={m.load} />
                </div>
              </div>
              <div className="flex items-center gap-2 text-xs">
                <span className="w-14 shrink-0 text-muted">Metas</span>
                <AttainmentBar attainment={m.attainment} status={m.attainmentStatus} size="sm" className="flex-1" />
              </div>
            </div>
            <div className="mt-3 flex justify-end">
              <RedistributeButton from={{ id: m.id, name: m.name }} tasks={tasksByUser[m.id] ?? []} targets={targets} />
            </div>
          </li>
        ))}
      </ul>
    </>
  );
}
