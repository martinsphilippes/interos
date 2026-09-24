"use client";

import * as React from "react";
import { useRouter } from "next/navigation";
import { DndContext, DragOverlay, KeyboardSensor, PointerSensor, TouchSensor, closestCorners, useDraggable, useDroppable, useSensor, useSensors, type DragEndEvent } from "@dnd-kit/core";
import { AlertTriangle, GripVertical, Kanban } from "lucide-react";
import type { LeadStatus } from "@/domain/types";
import { Avatar } from "@/components/ui/avatar";
import { EmptyState } from "@/components/ui/empty-state";
import { toast } from "@/components/ui/toast";
import { cn } from "@/lib/utils";
import { changeLeadStatusAction } from "@/server/marketing/actions";
import { ScorePill, TemperatureBadge } from "./lead-badges";
import { DisqualifyDialog, QualifyDialog } from "./lead-dialogs";
import { LEAD_FUNNEL, LEAD_STATUSES, LEAD_STATUS_LABELS, type LeadListItem, type UserOption } from "./marketing-model";
import { useMarketingUrl } from "./use-marketing-url";
import { RelativeTime } from "@/components/ui/relative-time";

const COLUMN_TONE: Record<LeadStatus, string> = {
  novo: "border-t-info",
  em_contato: "border-t-brand",
  qualificado: "border-t-success",
  convertido: "border-t-secondary",
  desqualificado: "border-t-border-strong",
};

type Pending = { kind: "qualify" | "disqualify"; lead: LeadListItem } | null;

/**
 * Kanban por status com arrastar-e-soltar. Novo ↔ Em contato e Qualificado → Convertido mudam o
 * status direto; soltar em Qualificado abre o gate de MQL e em Desqualificado pede o motivo.
 */
export function LeadsKanban({ items, sellers }: { items: LeadListItem[]; sellers: UserOption[] }) {
  const router = useRouter();
  const { navigate } = useMarketingUrl();
  const dndId = React.useId();
  const [overrides, setOverrides] = React.useState<Record<string, LeadStatus>>({});
  const [prevItems, setPrevItems] = React.useState(items);
  const [activeId, setActiveId] = React.useState<string | null>(null);
  const [pendingDialog, setPendingDialog] = React.useState<Pending>(null);
  const [, startTransition] = React.useTransition();

  if (items !== prevItems) {
    setPrevItems(items);
    setOverrides({});
  }

  const sensors = useSensors(useSensor(PointerSensor, { activationConstraint: { distance: 8 } }), useSensor(TouchSensor, { activationConstraint: { delay: 150, tolerance: 8 } }), useSensor(KeyboardSensor));

  const statusOf = (lead: LeadListItem) => overrides[lead.id] ?? lead.status;
  const columns = LEAD_STATUSES.map((status) => ({ status, leads: items.filter((l) => statusOf(l) === status) }));
  const active = activeId ? items.find((l) => l.id === activeId) : null;

  const onDragEnd = (event: DragEndEvent) => {
    setActiveId(null);
    const lead = items.find((l) => l.id === String(event.active.id));
    const to = event.over ? (String(event.over.id).replace("col:", "") as LeadStatus) : null;
    if (!lead || !to || to === statusOf(lead)) return;
    if (to === "qualificado") {
      setPendingDialog({ kind: "qualify", lead });
      return;
    }
    if (to === "desqualificado") {
      setPendingDialog({ kind: "disqualify", lead });
      return;
    }
    setOverrides((o) => ({ ...o, [lead.id]: to }));
    startTransition(async () => {
      const result = await changeLeadStatusAction({ leadId: lead.id, status: to });
      if (!result.ok) {
        toast.error(result.error);
        setOverrides((o) => {
          const next = { ...o };
          delete next[lead.id];
          return next;
        });
        return;
      }
      toast.success(`${lead.name}: ${LEAD_STATUS_LABELS[to]}`);
      router.refresh();
    });
  };

  if (items.length === 0) {
    return (
      <div className="rounded-lg border border-border bg-surface">
        <EmptyState icon={<Kanban />} title="Nenhum lead no quadro" description="Ajuste os filtros ou cadastre um lead." />
      </div>
    );
  }

  return (
    <>
      <DndContext id={dndId} sensors={sensors} collisionDetection={closestCorners} onDragStart={(e) => setActiveId(String(e.active.id))} onDragEnd={onDragEnd} onDragCancel={() => setActiveId(null)}>
        <div className="relative -mx-4 flex snap-x gap-3 overflow-x-auto px-4 pb-3 scrollbar-thin md:mx-0 md:grid md:grid-cols-5 md:overflow-visible md:px-0">
          {columns.map((col) => (
            <Column key={col.status} status={col.status} leads={col.leads} onOpen={(id) => navigate({ lead: id })} />
          ))}
        </div>
        <DragOverlay dropAnimation={null}>{active ? <LeadCard lead={active} overlay /> : null}</DragOverlay>
      </DndContext>
      {pendingDialog ? (
        pendingDialog.kind === "qualify" ? (
          <QualifyDialog open onOpenChange={(v) => !v && setPendingDialog(null)} leadId={pendingDialog.lead.id} leadName={pendingDialog.lead.name} sellers={sellers} />
        ) : (
          <DisqualifyDialog open onOpenChange={(v) => !v && setPendingDialog(null)} leadId={pendingDialog.lead.id} leadName={pendingDialog.lead.name} />
        )
      ) : null}
    </>
  );
}

function Column({ status, leads, onOpen }: { status: LeadStatus; leads: LeadListItem[]; onOpen: (id: string) => void }) {
  const { setNodeRef, isOver } = useDroppable({ id: `col:${status}` });
  const separated = !LEAD_FUNNEL.includes(status);
  return (
    <section
      ref={setNodeRef}
      aria-label={LEAD_STATUS_LABELS[status]}
      className={cn("flex w-[80vw] shrink-0 snap-start flex-col rounded-lg border border-border border-t-[3px] md:w-auto", separated ? "bg-surface-hover/60" : "bg-surface-muted", COLUMN_TONE[status], isOver && "ring-2 ring-brand/30")}
    >
      <header className="flex items-center justify-between px-3 py-2.5">
        <h3 className="text-sm font-semibold">{LEAD_STATUS_LABELS[status]}</h3>
        <span className="rounded-full bg-surface px-2 py-0.5 text-xs font-medium tabular-nums text-muted">{leads.length}</span>
      </header>
      <div className="flex min-h-[120px] flex-1 flex-col gap-2 px-2 pb-2 md:max-h-[calc(100dvh-360px)] md:overflow-y-auto md:scrollbar-thin">
        {leads.map((lead) => (
          <DraggableCard key={lead.id} lead={lead} onOpen={onOpen} />
        ))}
        {leads.length === 0 ? <p className="rounded-md border border-dashed border-border-strong px-3 py-6 text-center text-xs text-muted">Solte aqui</p> : null}
      </div>
    </section>
  );
}

function DraggableCard({ lead, onOpen }: { lead: LeadListItem; onOpen: (id: string) => void }) {
  const { attributes, listeners, setNodeRef, setActivatorNodeRef, isDragging } = useDraggable({ id: lead.id });
  return (
    <div ref={setNodeRef} className={cn(isDragging && "opacity-40")}>
      <LeadCard lead={lead} onOpen={onOpen} handleRef={setActivatorNodeRef} handleProps={{ ...attributes, ...listeners }} />
    </div>
  );
}

function LeadCard({ lead, onOpen, handleRef, handleProps, overlay }: { lead: LeadListItem; onOpen?: (id: string) => void; handleRef?: (el: HTMLElement | null) => void; handleProps?: React.HTMLAttributes<HTMLButtonElement>; overlay?: boolean }) {
  return (
    <article className={cn("flex gap-1 rounded-lg border border-border bg-surface p-2.5 shadow-card", overlay ? "rotate-1 shadow-pop" : "hover:border-border-strong")}>
      <button
        type="button"
        ref={handleRef}
        {...handleProps}
        className="-ml-1 flex w-6 shrink-0 cursor-grab touch-none items-start justify-center pt-0.5 text-muted-light hover:text-muted active:cursor-grabbing"
        aria-label={`Arrastar ${lead.name}`}
      >
        <GripVertical className="size-4" />
      </button>
      <button type="button" className="flex min-w-0 flex-1 flex-col gap-1.5 text-left" onClick={() => onOpen?.(lead.id)}>
        <span className="flex items-start justify-between gap-2">
          <span className="min-w-0">
            <span className="block truncate text-sm font-medium">{lead.name}</span>
            <span className="block truncate text-xs text-muted">{lead.company ?? lead.originName}</span>
          </span>
          <ScorePill score={lead.score} temperature={lead.temperature} />
        </span>
        <span className="flex flex-wrap items-center gap-1.5">
          <TemperatureBadge temperature={lead.temperature} />
          {lead.noContact ? (
            <span className="inline-flex items-center gap-1 text-[11px] font-medium text-danger-fg">
              <AlertTriangle className="size-3" /> sem contato
            </span>
          ) : null}
        </span>
        <span className="flex items-center justify-between gap-2 text-[11px] text-muted">
          <span><RelativeTime value={lead.createdAt} /></span>
          {lead.ownerName ? <Avatar name={lead.ownerName} size="xs" /> : <span className="text-warning-fg">sem responsável</span>}
        </span>
      </button>
    </article>
  );
}
