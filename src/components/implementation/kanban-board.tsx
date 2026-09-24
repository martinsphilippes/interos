"use client";

import * as React from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import {
  DndContext,
  DragOverlay,
  KeyboardSensor,
  PointerSensor,
  TouchSensor,
  closestCorners,
  useDraggable,
  useDroppable,
  useSensor,
  useSensors,
  type DragEndEvent,
  type DragStartEvent,
} from "@dnd-kit/core";
import { GripVertical, Kanban, PauseCircle, Play } from "lucide-react";
import { IMPLEMENTATION_PHASES, type ImplementationPhase } from "@/domain/types";
import type { ProjectRow, UserLite } from "@/server/implementation/queries";
import { changeProjectPhase, resumeWaitingProject } from "@/server/implementation/actions";
import { formatDate } from "@/lib/format";
import { cn } from "@/lib/utils";
import { Avatar } from "@/components/ui/avatar";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { EmptyState } from "@/components/ui/empty-state";
import { Progress } from "@/components/ui/progress";
import { SlaBadge } from "@/components/ui/sla-badge";
import { toast } from "@/components/ui/toast";
import { IMPLEMENTATION_PHASE_LABELS, IMPLEMENTATION_STATUS_LABELS, IMPLEMENTATION_STATUS_VARIANT } from "@/components/clients/labels";
import { ProductChips, progressTone } from "./projects-table";
import { useImplementationAction } from "./use-implementation-action";
import { WaitingClientDialog } from "./waiting-client-dialog";

const WAITING_ZONE = "zona:aguardando";

export interface KanbanBoardProps {
  rows: ProjectRow[];
  users: UserLite[];
  canOperate: boolean;
}

/**
 * Kanban das fases de implantação. Arrastar para outra fase chama changeProjectPhase (avanço só com as
 * tarefas obrigatórias concluídas; o erro lista o que falta). A zona lateral "Aguardando cliente"
 * concentra os projetos pausados: soltar um card nela abre o registro da pendência.
 */
export function KanbanBoard({ rows, users, canOperate }: KanbanBoardProps) {
  const router = useRouter();
  const dndId = React.useId();
  const [overrides, setOverrides] = React.useState<Record<string, ImplementationPhase>>({});
  const [prevRows, setPrevRows] = React.useState(rows);
  if (rows !== prevRows) {
    setPrevRows(rows);
    setOverrides({});
  }
  const [activeId, setActiveId] = React.useState<string | null>(null);
  const [waitingFor, setWaitingFor] = React.useState<ProjectRow | null>(null);
  const [, startTransition] = React.useTransition();
  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 8 } }),
    useSensor(TouchSensor, { activationConstraint: { delay: 150, tolerance: 8 } }),
    useSensor(KeyboardSensor),
  );

  const waiting = rows.filter((r) => r.status === "aguardando_cliente");
  const onBoard = rows.filter((r) => r.status !== "aguardando_cliente");
  const phaseOf = (r: ProjectRow) => overrides[r.id] ?? r.currentPhase;
  const active = activeId ? onBoard.find((r) => r.id === activeId) : undefined;

  const onDragStart = (e: DragStartEvent) => setActiveId(String(e.active.id));
  const onDragEnd = (e: DragEndEvent) => {
    setActiveId(null);
    const row = onBoard.find((r) => r.id === String(e.active.id));
    const target = e.over ? String(e.over.id) : null;
    if (!row || !target) return;
    if (target === WAITING_ZONE) {
      if (row.status === "bloqueada") return void toast.error("Resolva o bloqueio interno antes de registrar pendência do cliente");
      return setWaitingFor(row);
    }
    const phase = target.replace("col:", "") as ImplementationPhase;
    if (phase === phaseOf(row)) return;
    setOverrides((o) => ({ ...o, [row.id]: phase }));
    startTransition(async () => {
      const result = await changeProjectPhase({ projectId: row.id, phase });
      if (!result.ok) {
        toast.error(result.error, { duration: 9000 });
        setOverrides((o) => {
          const next = { ...o };
          delete next[row.id];
          return next;
        });
        return;
      }
      toast.success(`${row.clientName} → ${IMPLEMENTATION_PHASE_LABELS[phase]}`);
      router.refresh();
    });
  };

  if (rows.length === 0) {
    return (
      <div className="rounded-lg border border-border bg-surface">
        <EmptyState icon={<Kanban />} title="Nenhum projeto ativo" description="Projetos entram aqui quando o Financeiro libera o contrato." />
      </div>
    );
  }

  return (
    <>
      <DndContext id={dndId} sensors={sensors} collisionDetection={closestCorners} onDragStart={onDragStart} onDragEnd={onDragEnd} onDragCancel={() => setActiveId(null)}>
        <div className="flex flex-col gap-3 lg:flex-row">
          <div className="relative -mx-4 flex min-w-0 flex-1 snap-x gap-3 overflow-x-auto px-4 pb-3 scrollbar-thin md:mx-0 md:px-0">
            {IMPLEMENTATION_PHASES.map((phase) => (
              <Column key={phase} id={`col:${phase}`} label={IMPLEMENTATION_PHASE_LABELS[phase]} rows={onBoard.filter((r) => phaseOf(r) === phase)} canOperate={canOperate} />
            ))}
          </div>
          <WaitingZone rows={waiting} canOperate={canOperate} />
        </div>
        <DragOverlay dropAnimation={null}>{active ? <ProjectCard row={active} overlay /> : null}</DragOverlay>
      </DndContext>
      {waitingFor ? (
        <WaitingClientDialog
          open
          onOpenChange={(v) => !v && setWaitingFor(null)}
          projectId={waitingFor.id}
          clientName={waitingFor.clientName}
          users={users}
          defaultResponsibleId={waitingFor.ownerId}
        />
      ) : null}
    </>
  );
}

function Column({ id, label, rows, canOperate }: { id: string; label: string; rows: ProjectRow[]; canOperate: boolean }) {
  const { setNodeRef, isOver } = useDroppable({ id, disabled: !canOperate });
  const late = rows.filter((r) => r.overdue).length;
  return (
    <section ref={setNodeRef} aria-label={label} className={cn("flex w-[82vw] shrink-0 snap-start flex-col rounded-lg border border-border border-t-[3px] border-t-secondary bg-surface-muted sm:w-64", isOver && "ring-2 ring-brand/30")}>
      <header className="px-3 py-2.5">
        <div className="flex items-center justify-between">
          <h3 className="text-sm font-semibold">{label}</h3>
          <span className="rounded-full bg-surface px-2 py-0.5 text-xs font-medium tabular-nums text-muted">{rows.length}</span>
        </div>
        {late > 0 ? <p className="mt-0.5 text-xs font-medium text-danger-fg">{late} atrasado(s)</p> : <p className="mt-0.5 text-xs text-muted">Sem atrasos</p>}
      </header>
      <div className="flex min-h-[140px] flex-1 flex-col gap-2 px-2 pb-2 md:max-h-[calc(100dvh-300px)] md:overflow-y-auto md:scrollbar-thin">
        {rows.map((r) => (canOperate ? <DraggableCard key={r.id} row={r} /> : <ProjectCard key={r.id} row={r} />))}
        {rows.length === 0 ? <p className="rounded-md border border-dashed border-border-strong px-3 py-6 text-center text-xs text-muted">{canOperate ? "Solte aqui" : "Vazio"}</p> : null}
      </div>
    </section>
  );
}

function WaitingZone({ rows, canOperate }: { rows: ProjectRow[]; canOperate: boolean }) {
  const { setNodeRef, isOver } = useDroppable({ id: WAITING_ZONE, disabled: !canOperate });
  return (
    <aside
      ref={setNodeRef}
      aria-label="Aguardando cliente"
      className={cn("flex shrink-0 flex-col rounded-lg border-2 border-dashed border-warning/50 bg-warning-soft/40 lg:w-72", isOver && "bg-warning-soft")}
    >
      <header className="flex items-center gap-2 px-3 py-2.5 text-warning-fg">
        <PauseCircle className="size-4" aria-hidden />
        <h3 className="text-sm font-semibold">Aguardando cliente</h3>
        <span className="ml-auto rounded-full bg-surface px-2 py-0.5 text-xs font-medium tabular-nums text-muted">{rows.length}</span>
      </header>
      <p className="px-3 text-xs text-muted">{canOperate ? "Solte um card aqui para registrar a pendência do cliente (pausa o SLA)." : "Projetos com SLA pausado por pendência do cliente."}</p>
      <div className="flex flex-col gap-2 p-2">
        {rows.map((r) => (
          <div key={r.id} className="rounded-lg border border-border bg-surface p-2.5 shadow-card">
            <Link href={`/implantacao/${r.id}?aba=pendencias`} className="text-sm font-semibold hover:underline">
              {r.clientName}
            </Link>
            <p className="mt-0.5 line-clamp-2 text-xs text-muted">{r.waitingReason}</p>
            <div className="mt-2 flex items-center justify-between gap-2">
              <span className="text-xs text-muted">{IMPLEMENTATION_PHASE_LABELS[r.currentPhase]}</span>
              {canOperate ? <ResumeButton projectId={r.id} clientName={r.clientName} /> : null}
            </div>
          </div>
        ))}
        {rows.length === 0 ? <p className="rounded-md border border-dashed border-border-strong px-3 py-5 text-center text-xs text-muted">Nenhum projeto parado pelo cliente</p> : null}
      </div>
    </aside>
  );
}

function ResumeButton({ projectId, clientName }: { projectId: string; clientName: string }) {
  const { pending, run } = useImplementationAction();
  return (
    <Button size="sm" variant="outline" className="h-9 md:h-7" loading={pending} onClick={() => run(() => resumeWaitingProject({ projectId }), `${clientName}: implantação retomada`)}>
      <Play /> Retomar
    </Button>
  );
}

function DraggableCard({ row }: { row: ProjectRow }) {
  const { attributes, listeners, setNodeRef, setActivatorNodeRef, isDragging } = useDraggable({ id: row.id });
  return (
    <div ref={setNodeRef} className={cn(isDragging && "opacity-40")}>
      <ProjectCard row={row} handleRef={setActivatorNodeRef} handleProps={{ ...attributes, ...listeners }} />
    </div>
  );
}

function ProjectCard({ row, handleRef, handleProps, overlay }: { row: ProjectRow; handleRef?: (el: HTMLElement | null) => void; handleProps?: React.HTMLAttributes<HTMLButtonElement>; overlay?: boolean }) {
  return (
    <article className={cn("flex gap-1 rounded-lg border bg-surface p-2.5 shadow-card", row.overdue || row.status === "bloqueada" ? "border-danger/40" : "border-border", overlay ? "rotate-1 shadow-pop" : "hover:border-border-strong")}>
      {handleProps ? (
        <button
          ref={handleRef}
          type="button"
          aria-label={`Arrastar ${row.clientName}`}
          className="-ml-1 flex w-7 shrink-0 cursor-grab touch-none items-center justify-center self-stretch rounded-md text-muted-light hover:bg-surface-hover hover:text-muted active:cursor-grabbing"
          {...handleProps}
        >
          <GripVertical className="size-4" />
        </button>
      ) : null}
      <div className="min-w-0 flex-1">
        <div className="flex items-start justify-between gap-2">
          <Link href={`/implantacao/${row.id}`} className="truncate text-sm font-semibold leading-snug hover:underline">
            {row.clientName}
          </Link>
          {row.status !== "em_implantacao" ? (
            <Badge variant={IMPLEMENTATION_STATUS_VARIANT[row.status]} size="sm">
              {IMPLEMENTATION_STATUS_LABELS[row.status]}
            </Badge>
          ) : null}
        </div>
        <div className="mt-1.5">
          <ProductChips products={row.products} max={2} />
        </div>
        <Progress value={row.progress} showValue size="sm" tone={progressTone(row)} className="mt-2" />
        {row.pendingInPhase.length > 0 ? (
          <p className="mt-1.5 text-xs text-muted" title={row.pendingInPhase.join("\n")}>
            Falta{row.pendingInPhase.length > 1 ? "m" : ""} {row.pendingInPhase.length} obrigatória(s) nesta fase
          </p>
        ) : null}
        {row.blockedReason ? <p className="mt-1 line-clamp-2 text-xs text-danger-fg">{row.blockedReason}</p> : null}
        <div className="mt-2 flex flex-wrap items-center gap-2 text-xs text-muted">
          <Avatar name={row.ownerName} src={row.ownerAvatarUrl} size="xs" />
          <span className={cn("tabular-nums", row.overdue && "font-medium text-danger-fg")}>Prazo {formatDate(row.dueDate, "dd/MM")}</span>
          {row.sla ? <SlaBadge state={row.sla.state} remainingMs={row.sla.remainingMs} timeOnly className="ml-auto" /> : null}
        </div>
      </div>
    </article>
  );
}
