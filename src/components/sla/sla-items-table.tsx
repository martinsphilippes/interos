"use client";

import Link from "next/link";
import { ChevronRight } from "lucide-react";
import type { SlaItem } from "@/server/sla-report/queries";
import { SLA_STATE_LABELS } from "@/domain/constants";
import { formatDateTime } from "@/lib/format";
import { cn } from "@/lib/utils";
import { Avatar } from "@/components/ui/avatar";
import { Badge, type BadgeProps } from "@/components/ui/badge";
import { EmptyState } from "@/components/ui/empty-state";
import { PriorityBadge } from "@/components/ui/priority-badge";
import { formatRemainingMs } from "@/components/ui/sla-badge";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { slaStateAt, useMinuteClock } from "@/components/support/sla-live";

const STATE_VARIANT: Record<string, NonNullable<BadgeProps["variant"]>> = {
  dentro_do_prazo: "success",
  em_atencao: "warning",
  em_risco: "warning",
  violado: "danger",
  pausado: "muted",
  concluido: "success",
};

const REMAINING_TONE: Record<string, string> = {
  violado: "text-danger-fg",
  em_risco: "text-warning-fg",
  em_atencao: "text-warning-fg",
  dentro_do_prazo: "text-success-fg",
  pausado: "text-muted",
  concluido: "text-muted",
};

function liveView(item: SlaItem, now: number | null) {
  return now === null ? item.live.view : slaStateAt(item.live, now);
}

function Remaining({ item, now }: { item: SlaItem; now: number | null }) {
  const view = liveView(item, now);
  if (!item.active) return <span className="text-xs text-muted">Concluído {formatDateTime(item.completedAt)}</span>;
  if (view.state === "pausado") return <span className="text-sm text-muted">Pausado</span>;
  return <span className={cn("font-semibold tabular-nums", REMAINING_TONE[view.state])}>{formatRemainingMs(view.remainingMs)}</span>;
}

function StateBadge({ item, now }: { item: SlaItem; now: number | null }) {
  const view = liveView(item, now);
  return (
    <Badge variant={STATE_VARIANT[view.state]} size="sm">
      {SLA_STATE_LABELS[view.state]}
    </Badge>
  );
}

/**
 * Tabela de SLAs (críticos, todos ou vencendo na próxima hora) com prazo restante ao vivo (relógio de 1 min,
 * mesma regra do motor). Cada linha abre a entidade de origem. No celular vira lista de cards.
 */
export function SlaItemsTable({ items, emptyTitle, emptyDescription }: { items: SlaItem[]; emptyTitle: string; emptyDescription?: string }) {
  const now = useMinuteClock();
  if (items.length === 0) return <EmptyState size="sm" title={emptyTitle} description={emptyDescription} />;
  return (
    <>
      <div className="hidden md:block">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Cliente</TableHead>
              <TableHead>Protocolo / item</TableHead>
              <TableHead className="hidden 2xl:table-cell">Departamento</TableHead>
              <TableHead>Responsável</TableHead>
              <TableHead>Prioridade</TableHead>
              <TableHead className="text-right">Prazo restante</TableHead>
              <TableHead>Status</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {items.map((item) => (
              <TableRow key={item.id}>
                <TableCell className="max-w-[150px]">
                  {item.clientId ? (
                    <Link href={`/clientes/${item.clientId}`} className="block truncate font-medium text-foreground hover:underline">
                      {item.clientName ?? "Cliente"}
                    </Link>
                  ) : (
                    <span className="text-muted">—</span>
                  )}
                </TableCell>
                <TableCell className="max-w-[220px]">
                  <Link href={item.href} className="block min-w-0 hover:underline">
                    <span className="block truncate text-sm text-foreground">
                      {item.reference === "Tarefa" || item.reference === "Etapa" || item.reference === "Projeto" || item.reference === "Oportunidade"
                        ? item.title
                        : `${item.reference} · ${item.title}`}
                    </span>
                    <span className="block truncate text-xs text-muted">
                      {item.typeLabel}
                      <span className="2xl:hidden">{item.departmentLabel ? ` · ${item.departmentLabel}` : ""}</span>
                    </span>
                  </Link>
                </TableCell>
                <TableCell className="hidden text-sm 2xl:table-cell">{item.departmentLabel ?? "—"}</TableCell>
                <TableCell>
                  {item.ownerName ? (
                    <span className="flex items-center gap-2">
                      <Avatar name={item.ownerName} src={item.ownerAvatarUrl} size="xs" />
                      <span className="max-w-[110px] truncate text-sm" title={item.ownerName}>
                        {item.ownerName.split(" ")[0]} {item.ownerName.split(" ").slice(-1)[0]?.[0] ? `${item.ownerName.split(" ").slice(-1)[0][0]}.` : ""}
                      </span>
                    </span>
                  ) : (
                    <span className="text-sm text-muted">Sem responsável</span>
                  )}
                </TableCell>
                <TableCell>{item.priority ? <PriorityBadge priority={item.priority} /> : <span className="text-xs text-muted">—</span>}</TableCell>
                <TableCell className="text-right">
                  <Remaining item={item} now={now} />
                </TableCell>
                <TableCell>
                  <StateBadge item={item} now={now} />
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </div>
      <ul className="flex flex-col divide-y divide-border md:hidden">
        {items.map((item) => (
          <li key={item.id}>
            <Link href={item.href} className="flex min-h-[64px] items-center gap-3 px-4 py-3 hover:bg-surface-hover">
              <div className="min-w-0 flex-1">
                <p className="truncate text-sm font-medium">{item.clientName ?? item.title}</p>
                <p className="truncate text-xs text-muted">
                  {item.reference === "Tarefa" || item.reference === "Etapa" ? item.title : item.reference} · {item.departmentLabel ?? item.typeLabel}
                  {item.ownerName ? ` · ${item.ownerName.split(" ")[0]}` : ""}
                </p>
                <div className="mt-1.5 flex flex-wrap items-center gap-1.5">
                  {item.priority ? <PriorityBadge priority={item.priority} /> : null}
                  <StateBadge item={item} now={now} />
                </div>
              </div>
              <div className="flex shrink-0 items-center gap-1 text-right">
                <Remaining item={item} now={now} />
                <ChevronRight className="size-4 text-muted-light" aria-hidden />
              </div>
            </Link>
          </li>
        ))}
      </ul>
    </>
  );
}
