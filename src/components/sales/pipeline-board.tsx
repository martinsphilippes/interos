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
  useDraggable,
  useDroppable,
  useSensor,
  useSensors,
  type DragEndEvent,
  type DragStartEvent,
} from "@dnd-kit/core";
import { GripVertical, Kanban, Trophy, XCircle } from "lucide-react";
import { Avatar } from "@/components/ui/avatar";
import { EmptyState } from "@/components/ui/empty-state";
import { toast } from "@/components/ui/toast";
import { formatCurrency } from "@/lib/format";
import { cn } from "@/lib/utils";
import { changeOpportunityStage } from "@/server/sales/actions";
import type { OpportunityRow, PipelineStage, ProductOption, UserLite } from "@/server/sales/queries";
import type { OpenStage } from "@/server/sales/schemas";
import { LostDialog } from "./lost-dialog";
import { NextActionLabel, ProposalIcon, TemperatureDot } from "./opportunity-bits";
import { OpportunityFilterBar, applyFilters, readFilters } from "./opportunity-filters";
import { useSalesUrl } from "./use-sales-url";
import { WonDialog } from "./won-dialog";

export interface PipelineBoardProps {
  rows: OpportunityRow[];
  stages: PipelineStage[];
  sellers: UserLite[];
  products: ProductOption[];
  currentUserId: string;
  competence: string;
}

const WON_ZONE = "zona:ganho";
const LOST_ZONE = "zona:perdido";

/**
 * Kanban do funil: colunas do setting "pipeline_stages" + zonas fixas Ganho/Perdido no fim.
 * Soltar em outra coluna chama changeOpportunityStage (opportunity.stage_changed); soltar em
 * Ganho/Perdido abre o diálogo correspondente. Clique no card abre o drawer (?oportunidade=).
 */
export function PipelineBoard({ rows, stages, sellers, products, currentUserId, competence }: PipelineBoardProps) {
  const router = useRouter();
  const { searchParams, navigate } = useSalesUrl();
  const dndId = React.useId();
  const filters = React.useMemo(() => readFilters((k) => searchParams.get(k)), [searchParams]);
  const openRows = React.useMemo(() => rows.filter((r) => r.stage !== "ganho" && r.stage !== "perdido"), [rows]);
  const filtered = React.useMemo(() => applyFilters(openRows, filters, { userId: currentUserId, competence, ignoreSituation: true }), [openRows, filters, currentUserId, competence]);

  // Etapa exibida por card (atualização otimista ao arrastar).
  const [overrides, setOverrides] = React.useState<Record<string, string>>({});
  const [prevRows, setPrevRows] = React.useState(rows);
  if (rows !== prevRows) {
    setPrevRows(rows);
    setOverrides({});
  }
  const [activeId, setActiveId] = React.useState<string | null>(null);
  const [dialog, setDialog] = React.useState<{ kind: "ganho" | "perdido"; row: OpportunityRow } | null>(null);
  const [, startTransition] = React.useTransition();

  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 8 } }),
    useSensor(TouchSensor, { activationConstraint: { delay: 150, tolerance: 8 } }),
    useSensor(KeyboardSensor),
  );

  const stageOf = (r: OpportunityRow) => overrides[r.id] ?? r.stage;
  // Oportunidades em etapas fora das colunas configuradas caem na primeira coluna.
  const columnKeys = new Set(stages.map((s) => s.key as string));
  const columnOf = (r: OpportunityRow) => (columnKeys.has(stageOf(r)) ? stageOf(r) : stages[0]?.key);
  const active = activeId ? filtered.find((r) => r.id === activeId) : undefined;

  const onDragStart = (e: DragStartEvent) => setActiveId(String(e.active.id));
  const onDragEnd = (e: DragEndEvent) => {
    setActiveId(null);
    const row = filtered.find((r) => r.id === String(e.active.id));
    const target = e.over ? String(e.over.id) : null;
    if (!row || !target) return;
    if (target === WON_ZONE) return setDialog({ kind: "ganho", row });
    if (target === LOST_ZONE) return setDialog({ kind: "perdido", row });
    const stage = target.replace("col:", "");
    if (stage === columnOf(row)) return;
    const label = stages.find((s) => s.key === stage)?.label ?? stage;
    setOverrides((o) => ({ ...o, [row.id]: stage }));
    startTransition(async () => {
      const result = await changeOpportunityStage({ opportunityId: row.id, stage: stage as OpenStage });
      if (!result.ok) {
        toast.error(result.error);
        setOverrides((o) => {
          const next = { ...o };
          delete next[row.id];
          return next;
        });
        return;
      }
      toast.success(`${row.clientName} → ${label}`);
      router.refresh();
    });
  };

  return (
    <div>
      <OpportunityFilterBar filters={filters} sellers={sellers} products={products} variant="pipeline" count={filtered.length} total={openRows.length} />
      {openRows.length === 0 ? (
        <div className="rounded-lg border border-border bg-surface">
          <EmptyState icon={<Kanban />} title="Funil vazio" description="Nenhuma oportunidade aberta. Crie uma nova oportunidade ou converta leads do Marketing." />
        </div>
      ) : (
        <DndContext id={dndId} sensors={sensors} collisionDetection={closestCorners} onDragStart={onDragStart} onDragEnd={onDragEnd} onDragCancel={() => setActiveId(null)}>
          <div className="relative -mx-4 flex snap-x gap-3 overflow-x-auto px-4 pb-3 scrollbar-thin md:mx-0 md:px-0">
            {stages.map((s) => {
              const cards = filtered.filter((r) => columnOf(r) === s.key);
              return <Column key={s.key} id={`col:${s.key}`} label={s.label} rows={cards} onOpen={(id) => navigate({ oportunidade: id })} />;
            })}
            <div className="flex w-[70vw] shrink-0 snap-start flex-col gap-3 sm:w-56">
              <OutcomeZone id={WON_ZONE} label="Ganho" icon={<Trophy />} tone="success" />
              <OutcomeZone id={LOST_ZONE} label="Perdido" icon={<XCircle />} tone="danger" />
            </div>
          </div>
          <DragOverlay dropAnimation={null}>{active ? <Card row={active} overlay /> : null}</DragOverlay>
        </DndContext>
      )}
      {dialog?.kind === "ganho" ? (
        <WonDialog
          open
          onOpenChange={(v) => !v && setDialog(null)}
          opportunity={dialog.row}
          clientDefaults={{ legalName: dialog.row.clientLegalName, document: dialog.row.clientDocument, email: dialog.row.clientEmail }}
          products={products}
        />
      ) : null}
      {dialog?.kind === "perdido" ? <LostDialog open onOpenChange={(v) => !v && setDialog(null)} opportunity={dialog.row} /> : null}
    </div>
  );
}

function Column({ id, label, rows, onOpen }: { id: string; label: string; rows: OpportunityRow[]; onOpen: (id: string) => void }) {
  const { setNodeRef, isOver } = useDroppable({ id });
  const monthly = rows.reduce((s, r) => s + r.monthlyTotal, 0);
  const setup = rows.reduce((s, r) => s + r.setupTotal, 0);
  return (
    <section ref={setNodeRef} aria-label={label} className={cn("flex w-[82vw] shrink-0 snap-start flex-col rounded-lg border border-border border-t-[3px] border-t-secondary bg-surface-muted sm:w-72", isOver && "ring-2 ring-brand/30")}>
      <header className="px-3 py-2.5">
        <div className="flex items-center justify-between">
          <h3 className="text-sm font-semibold">{label}</h3>
          <span className="rounded-full bg-surface px-2 py-0.5 text-xs font-medium tabular-nums text-muted">{rows.length}</span>
        </div>
        <p className="mt-0.5 text-xs tabular-nums text-muted">
          {formatCurrency(monthly)}/mês · {formatCurrency(setup)} adesão
        </p>
      </header>
      <div className="flex min-h-[140px] flex-1 flex-col gap-2 px-2 pb-2 md:max-h-[calc(100dvh-330px)] md:overflow-y-auto md:scrollbar-thin">
        {rows.map((r) => (
          <DraggableCard key={r.id} row={r} onOpen={onOpen} />
        ))}
        {rows.length === 0 ? <p className="rounded-md border border-dashed border-border-strong px-3 py-6 text-center text-xs text-muted">Solte aqui</p> : null}
      </div>
    </section>
  );
}

function OutcomeZone({ id, label, icon, tone }: { id: string; label: string; icon: React.ReactNode; tone: "success" | "danger" }) {
  const { setNodeRef, isOver } = useDroppable({ id });
  return (
    <div
      ref={setNodeRef}
      className={cn(
        "flex min-h-[120px] flex-1 flex-col items-center justify-center gap-1 rounded-lg border-2 border-dashed text-sm font-semibold [&_svg]:size-6",
        tone === "success" ? "border-success/50 text-success-fg" : "border-danger/50 text-danger-fg",
        isOver && (tone === "success" ? "bg-success-soft" : "bg-danger-soft"),
      )}
    >
      {icon}
      {label}
      <span className="text-xs font-normal text-muted">Arraste um card aqui</span>
    </div>
  );
}

function DraggableCard({ row, onOpen }: { row: OpportunityRow; onOpen: (id: string) => void }) {
  const { attributes, listeners, setNodeRef, setActivatorNodeRef, isDragging } = useDraggable({ id: row.id });
  return (
    <div ref={setNodeRef} className={cn(isDragging && "opacity-40")}>
      <Card row={row} onOpen={onOpen} handleRef={setActivatorNodeRef} handleProps={{ ...attributes, ...listeners }} />
    </div>
  );
}

function Card({ row, onOpen, handleRef, handleProps, overlay }: { row: OpportunityRow; onOpen?: (id: string) => void; handleRef?: (el: HTMLElement | null) => void; handleProps?: React.HTMLAttributes<HTMLButtonElement>; overlay?: boolean }) {
  return (
    <article
      className={cn("flex cursor-pointer gap-1 rounded-lg border bg-surface p-2.5 shadow-card transition-colors", row.overdue || row.noNextAction ? "border-danger/40" : "border-border", overlay ? "rotate-1 shadow-pop" : "hover:border-border-strong")}
      onClick={() => onOpen?.(row.id)}
      role={onOpen ? "button" : undefined}
      tabIndex={onOpen ? 0 : undefined}
      aria-label={onOpen ? `Abrir oportunidade ${row.clientName}` : undefined}
      onKeyDown={(e) => {
        if (onOpen && (e.key === "Enter" || e.key === " ") && e.target === e.currentTarget) {
          e.preventDefault();
          onOpen(row.id);
        }
      }}
    >
      <button
        ref={handleRef}
        type="button"
        aria-label={`Arrastar ${row.clientName}`}
        className="-ml-1 flex w-7 shrink-0 cursor-grab touch-none items-center justify-center self-stretch rounded-md text-muted-light hover:bg-surface-hover hover:text-muted active:cursor-grabbing"
        onClick={(e) => e.stopPropagation()}
        {...handleProps}
      >
        <GripVertical className="size-4" />
      </button>
      <div className="min-w-0 flex-1">
        <div className="flex items-start justify-between gap-2">
          <p className="truncate text-sm font-semibold leading-snug">{row.clientName}</p>
          <TemperatureDot temperature={row.temperature} withLabel={false} className="mt-1.5" />
        </div>
        {row.contactName ? <p className="truncate text-xs text-muted">{row.contactName}</p> : null}
        {row.products.length > 0 ? (
          <div className="mt-1.5 flex flex-wrap gap-1">
            {row.products.slice(0, 3).map((p) => (
              <span key={p.productId} className="rounded-sm bg-secondary-soft px-1.5 py-0.5 text-[11px] text-secondary-fg">
                {p.productName}
              </span>
            ))}
            {row.products.length > 3 ? <span className="text-[11px] text-muted">+{row.products.length - 3}</span> : null}
          </div>
        ) : null}
        <p className="mt-1.5 text-xs font-medium tabular-nums">
          {formatCurrency(row.monthlyTotal)}/mês
          {row.setupTotal > 0 ? <span className="font-normal text-muted"> + {formatCurrency(row.setupTotal)}</span> : null}
        </p>
        <div className="mt-1.5">
          <NextActionLabel opp={row} compact />
        </div>
        <div className="mt-2 flex items-center gap-2 text-xs text-muted">
          <Avatar name={row.ownerName} src={row.ownerAvatarUrl} size="xs" />
          <span className="tabular-nums" title="Dias na etapa">
            {row.daysInStage}d na etapa
          </span>
          {row.stalled ? <span className="font-medium text-warning-fg">parada</span> : null}
          <span className="ml-auto">
            <ProposalIcon status={row.proposalStatus} />
          </span>
        </div>
      </div>
    </article>
  );
}
