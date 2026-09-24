"use client";

import * as React from "react";
import Link from "next/link";
import { Globe, Inbox, Mail, MessageCircle, Phone, Repeat, SlidersHorizontal, Wrench } from "lucide-react";
import type { SupportTicket } from "@/domain/types";
import type { TicketRow } from "@/server/support/queries";
import { TICKET_CHANNEL_LABELS } from "@/server/support/schemas";
import { dateKey, formatDate, formatTime } from "@/lib/format";
import { EmptyState } from "@/components/ui/empty-state";
import { IconTile } from "@/components/ui/icon-tile";
import type { Tone } from "@/components/ui/tone";
import { cn } from "@/lib/utils";
import { slaStateAt, useMinuteClock } from "./sla-live";
import { TicketPriorityBadge } from "./ticket-badges";
import { QUEUE_TABS, formatSlaClock, type QueueTab } from "./workspace-model";

const CHANNEL_ICON: Record<SupportTicket["channel"], { icon: React.ReactNode; tone: Tone }> = {
  whatsapp: { icon: <MessageCircle />, tone: "success" },
  telefone: { icon: <Phone />, tone: "info" },
  email: { icon: <Mail />, tone: "secondary" },
  portal: { icon: <Globe />, tone: "neutral" },
  interno: { icon: <Wrench />, tone: "neutral" },
};

/** Filtro de cada aba da fila (estado do SLA recalculado no relógio do navegador). */
function inTab(row: TicketRow, tab: QueueTab, now: number | null): boolean {
  const state = row.sla ? (now === null ? row.sla.view.state : slaStateAt(row.sla, now).state) : undefined;
  switch (tab) {
    case "novos":
      return row.status === "aberto" || row.status === "reaberto";
    case "atendimento":
      return row.status === "em_atendimento";
    case "aguardando":
      return row.status === "aguardando_cliente";
    case "risco":
      return state === "em_risco" || state === "violado";
    case "criticos":
      return row.priority === "critico";
    default:
      return true;
  }
}

function SlaClock({ row, now }: { row: TicketRow; now: number | null }) {
  if (!row.sla) return <span className="text-xs text-muted">Sem SLA</span>;
  const view = now === null ? row.sla.view : slaStateAt(row.sla, now);
  if (view.state === "pausado") return <span className="text-xs tabular-nums text-muted">SLA pausado</span>;
  const tone = view.state === "violado" || view.state === "em_risco" ? "text-danger-fg" : view.state === "em_atencao" ? "text-warning-fg" : "text-success-fg";
  return (
    <span className="text-xs tabular-nums text-foreground" title={view.state === "violado" ? "SLA de solução vencido" : "Tempo restante para a solução"}>
      SLA{" "}
      <span className={cn("font-semibold", tone)} suppressHydrationWarning>
        {view.state === "violado" ? `vencido há ${formatSlaClock(-view.remainingMs)}` : formatSlaClock(view.remainingMs)}
      </span>
    </span>
  );
}

export interface TicketQueueProps {
  rows: TicketRow[];
  selectedId?: string;
  initialTab: QueueTab;
  /** Monta o link de seleção preservando escopo e aba. */
  baseQuery: Record<string, string>;
  title: string;
  className?: string;
}

/**
 * Fila do atendente: abas (Todos, Novos, Em atendimento, Aguardando cliente, Em risco, Críticos) e cards com
 * protocolo, cliente, assunto, canal, criticidade e SLA restante ao vivo. Selecionar abre ?chamado=<id>.
 */
export function TicketQueue({ rows, selectedId, initialTab, baseQuery, title, className }: TicketQueueProps) {
  const now = useMinuteClock();
  const [tab, setTab] = React.useState<QueueTab>(initialTab);
  const counts = React.useMemo(() => Object.fromEntries(QUEUE_TABS.map((t) => [t.key, rows.filter((r) => inTab(r, t.key, now)).length])) as Record<QueueTab, number>, [rows, now]);
  const visible = rows.filter((r) => inTab(r, tab, now));
  const today = dateKey(new Date().toISOString());
  const tabsRef = React.useRef<HTMLDivElement>(null);
  // Aba vinda do drill-down (?fila=) pode estar fora da área visível da lista rolável de abas.
  React.useEffect(() => {
    const active = tabsRef.current?.querySelector<HTMLElement>('[aria-selected="true"]');
    if (active && tabsRef.current) tabsRef.current.scrollLeft = Math.max(0, active.offsetLeft - 12);
  }, [tab]);

  const hrefFor = (id: string) => {
    const params = new URLSearchParams({ ...baseQuery, chamado: id });
    if (tab !== "todos") params.set("fila", tab);
    else params.delete("fila");
    return `/suporte?${params.toString()}`;
  };

  return (
    <section className={cn("flex min-h-0 flex-col overflow-hidden rounded-xl border border-border bg-surface shadow-card", className)} aria-label={title}>
      <header className="flex items-center justify-between gap-2 px-4 pb-2 pt-3.5">
        <h2 className="text-[15px] font-semibold">{title}</h2>
        <Link href="/suporte/chamados" className="inline-flex size-9 items-center justify-center rounded-lg text-muted hover:bg-surface-hover hover:text-foreground" title="Todos os chamados com filtros avançados" aria-label="Todos os chamados com filtros avançados">
          <SlidersHorizontal className="size-4" />
        </Link>
      </header>
      <div ref={tabsRef} role="tablist" aria-label="Filtrar fila" className="scrollbar-none flex shrink-0 gap-1 overflow-x-auto border-b border-border px-3">
        {QUEUE_TABS.map((t) => (
          <button
            key={t.key}
            type="button"
            role="tab"
            aria-selected={tab === t.key}
            onClick={() => setTab(t.key)}
            className={cn(
              "-mb-px inline-flex min-h-[40px] shrink-0 items-center gap-1 whitespace-nowrap border-b-2 px-2 text-xs font-medium transition-colors",
              tab === t.key ? "border-brand text-brand-fg" : "border-transparent text-muted hover:text-foreground",
            )}
          >
            {t.label}
            <span className={cn("rounded px-1 text-[10px] tabular-nums", tab === t.key ? "bg-brand-soft text-brand-fg" : "bg-surface-hover text-muted")} suppressHydrationWarning>
              {counts[t.key]}
            </span>
          </button>
        ))}
      </div>
      <div className="scrollbar-thin min-h-0 flex-1 overflow-y-auto p-3">
        {visible.length === 0 ? (
          <EmptyState icon={<Inbox />} title="Nenhum chamado nesta aba" description={rows.length === 0 ? "A fila está vazia. Bom trabalho!" : "Escolha outra aba para ver os demais chamados."} size="sm" />
        ) : (
          <ul className="flex flex-col gap-2.5">
            {visible.map((row) => {
              const selected = row.id === selectedId;
              const channel = CHANNEL_ICON[row.channel];
              return (
                <li key={row.id}>
                  <Link
                    href={hrefFor(row.id)}
                    scroll={false}
                    aria-current={selected ? "true" : undefined}
                    className={cn(
                      "flex flex-col gap-1.5 rounded-xl border p-3 transition-colors",
                      selected ? "border-brand bg-brand-soft" : "border-border bg-surface-muted hover:border-border-strong hover:bg-surface-hover",
                    )}
                  >
                    <div className="flex items-center justify-between gap-2">
                      <span className={cn("inline-flex items-center gap-1 font-mono text-[13px] font-semibold", selected ? "text-brand-fg" : "text-secondary-fg")}>
                        #{row.number}
                        {row.reopenedFromId ? <Repeat className="size-3 text-danger-fg" aria-label="reaberto" /> : null}
                      </span>
                      <span className="text-[11px] tabular-nums text-muted" title={`Aberto em ${formatDate(row.openedAt, "dd/MM/yyyy HH:mm")}`}>
                        {dateKey(row.openedAt) === today ? formatTime(row.openedAt) : formatDate(row.openedAt, "dd/MM HH:mm")}
                      </span>
                    </div>
                    <div className="flex items-start justify-between gap-2">
                      <div className="min-w-0">
                        <p className="truncate text-sm font-semibold text-foreground">{row.clientName}</p>
                        <p className="line-clamp-2 text-[13px] text-muted">{row.subject}</p>
                      </div>
                      <span title={TICKET_CHANNEL_LABELS[row.channel]}>
                        <IconTile icon={channel.icon} tone={channel.tone} size="sm" />
                        <span className="sr-only">{TICKET_CHANNEL_LABELS[row.channel]}</span>
                      </span>
                    </div>
                    <div className="flex flex-wrap items-center gap-x-2.5 gap-y-1">
                      <TicketPriorityBadge priority={row.priority} />
                      <span className="h-3.5 w-px bg-border-strong" aria-hidden />
                      <SlaClock row={row} now={now} />
                      {!row.assigneeId ? <span className="ml-auto text-[11px] text-warning-fg">sem atendente</span> : null}
                    </div>
                  </Link>
                </li>
              );
            })}
          </ul>
        )}
      </div>
      <footer className="border-t border-border px-4 py-2.5 text-xs text-muted" suppressHydrationWarning>
        Exibindo {visible.length} de {rows.length} chamado{rows.length === 1 ? "" : "s"} em aberto
      </footer>
    </section>
  );
}
