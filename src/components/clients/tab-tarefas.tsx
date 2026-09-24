import Link from "next/link";
import { CheckSquare, ChevronRight, Plus } from "lucide-react";
import type { Client360 } from "@/server/clients/queries";
import { TASK_STATUS_LABELS, type TaskStatus } from "@/domain/constants";
import { formatDate, formatRelative } from "@/lib/format";
import { Badge, type BadgeProps } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { EmptyState } from "@/components/ui/empty-state";
import { PriorityBadge } from "@/components/ui/priority-badge";
import { SectionTitle } from "@/components/ui/section-title";
import { cn } from "@/lib/utils";
import { UserCell } from "./client-badges";

const STATUS_VARIANT: Record<TaskStatus, NonNullable<BadgeProps["variant"]>> = { aberta: "info", em_andamento: "brand", aguardando: "warning", concluida: "success", cancelada: "muted" };
const OPEN = new Set<TaskStatus>(["aberta", "em_andamento", "aguardando"]);

/** Aba Tarefas: tarefas do cliente (abertas primeiro), cada uma abrindo no drawer da Central de Tarefas. */
export function TabTarefas({ data }: { data: Client360 }) {
  const { client, tasks, users } = data;
  const now = new Date().toISOString();
  const open = tasks.filter((t) => OPEN.has(t.status));
  const closed = tasks.filter((t) => !OPEN.has(t.status));

  const renderList = (items: typeof tasks) => (
    <ul className="divide-y divide-border">
      {items.map((t) => {
        const overdue = Boolean(t.dueAt && OPEN.has(t.status) && t.dueAt < now);
        const done = t.checklist.filter((c) => c.done).length;
        return (
          <li key={t.id}>
            <Link href={`/tarefas?tarefa=${t.id}`} className="flex min-h-[52px] items-center gap-3 px-4 py-2.5 transition-colors hover:bg-surface-muted">
              <div className="min-w-0 flex-1">
                <p className={cn("truncate text-sm font-medium", t.status === "concluida" && "text-muted")}>{t.title}</p>
                <div className="mt-1 flex flex-wrap items-center gap-x-2 gap-y-1 text-xs text-muted">
                  <Badge variant={STATUS_VARIANT[t.status]} size="sm">
                    {TASK_STATUS_LABELS[t.status]}
                  </Badge>
                  <PriorityBadge priority={t.priority} />
                  {t.dueAt ? (
                    <span className={cn(overdue && "font-medium text-danger-fg")}>
                      {overdue ? "Atrasada · " : "Prazo "}
                      {formatRelative(t.dueAt)}
                    </span>
                  ) : null}
                  {t.completedAt ? <span>Concluída em {formatDate(t.completedAt)}</span> : null}
                  {t.checklist.length > 0 ? (
                    <span className="tabular-nums">
                      {done}/{t.checklist.length} itens
                    </span>
                  ) : null}
                  {t.origin !== "manual" ? <span className="capitalize">origem: {t.origin}</span> : null}
                </div>
              </div>
              <UserCell users={users} id={t.assigneeId} />
              <ChevronRight className="size-4 shrink-0 text-muted-light" aria-hidden />
            </Link>
          </li>
        );
      })}
    </ul>
  );

  return (
    <div className="flex flex-col gap-5">
      <section>
        <SectionTitle
          title="Tarefas abertas"
          count={open.length}
          actions={
            <Button asChild size="sm">
              <Link href={`/tarefas?novo=1&cliente=${client.id}`}>
                <Plus /> Nova tarefa
              </Link>
            </Button>
          }
        />
        <Card className="overflow-hidden">
          {open.length === 0 ? <EmptyState size="sm" icon={<CheckSquare />} title="Nenhuma tarefa aberta" description="Crie uma tarefa para registrar o próximo passo com este cliente." /> : renderList(open)}
        </Card>
      </section>
      {closed.length > 0 ? (
        <section>
          <SectionTitle title="Encerradas" count={closed.length} />
          <Card className="overflow-hidden">{renderList(closed)}</Card>
        </section>
      ) : null}
    </div>
  );
}
