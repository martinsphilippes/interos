"use client";

import * as React from "react";
import { CalendarClock, ChevronLeft, ChevronRight, Inbox, Mail, MapPin, MessageCircle, Phone } from "lucide-react";
import { Button } from "@/components/ui/button";
import { EmptyState } from "@/components/ui/empty-state";
import { IconTile } from "@/components/ui/icon-tile";
import { SearchInput } from "@/components/ui/search-input";
import { formatCurrency, formatDay, formatTime } from "@/lib/format";
import { cn } from "@/lib/utils";
import type { LastChannel, WorkspaceQueue, WorkspaceQueueItem } from "@/server/sales/workspace-queries";
import type { PipelineStage } from "@/server/sales/queries";
import { StageBadge } from "../opportunity-bits";
import { useSalesUrl } from "../use-sales-url";

export const QUEUE_TABS: { key: WorkspaceQueue; label: string; hint: string }[] = [
  { key: "todos", label: "Todos", hint: "Todas as oportunidades do escopo" },
  { key: "novos", label: "Novos", hint: "Em qualificação" },
  { key: "contato", label: "Contato", hint: "Em diagnóstico com o cliente" },
  { key: "proposta", label: "Proposta", hint: "Proposta em elaboração ou enviada" },
  { key: "negociacao", label: "Negociação", hint: "Negociação e fechamento" },
  { key: "visita", label: "Visita", hint: "Com visita agendada" },
  { key: "followup", label: "Follow-up", hint: "Próxima ação vencida ou para hoje" },
  { key: "ganhos", label: "Ganhos", hint: "Negócios ganhos" },
  { key: "perdidos", label: "Perdidos", hint: "Negócios perdidos" },
];

const PAGE_SIZE = 20;

const CHANNEL_ICON: Record<LastChannel, { icon: React.ReactNode; tone: "success" | "info" | "secondary" | "brand"; label: string }> = {
  whatsapp: { icon: <MessageCircle />, tone: "success", label: "Última interação por WhatsApp" },
  voip: { icon: <Phone />, tone: "info", label: "Última interação por ligação" },
  email: { icon: <Mail />, tone: "secondary", label: "Última interação por e-mail" },
  visita: { icon: <MapPin />, tone: "brand", label: "Visita agendada" },
};

function normalize(text: string): string {
  return text
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase();
}

function mainValue(item: WorkspaceQueueItem): string {
  if (item.monthlyTotal > 0) return `${formatCurrency(item.monthlyTotal)}/mês`;
  if (item.setupTotal > 0) return `${formatCurrency(item.setupTotal)} adesão`;
  if (item.hardwareTotal > 0) return `${formatCurrency(item.hardwareTotal)} hardware`;
  return "Sem valor";
}

/** Próxima ação do card: visita pendente, retorno (vermelho quando vencido) ou nada para encerradas. */
function NextLine({ item }: { item: WorkspaceQueueItem }) {
  if (item.pendingVisitAt) {
    return (
      <span className="inline-flex min-w-0 items-center gap-1 text-xs text-brand-fg">
        <MapPin className="size-3.5 shrink-0" aria-hidden />
        <span className="truncate tabular-nums">
          Visita {formatDay(item.pendingVisitAt).toLowerCase()} {formatTime(item.pendingVisitAt)}
        </span>
      </span>
    );
  }
  if (!item.nextActionAt || item.stage === "ganho" || item.stage === "perdido") return null;
  return (
    <span className={cn("inline-flex min-w-0 items-center gap-1 text-xs", item.overdue ? "font-medium text-danger-fg" : "text-muted")} title={item.nextAction}>
      <CalendarClock className="size-3.5 shrink-0" aria-hidden />
      <span className="truncate tabular-nums">
        Retorno {formatDay(item.nextActionAt).toLowerCase()} {formatTime(item.nextActionAt)}
      </span>
    </span>
  );
}

export interface WorkspaceQueueProps {
  items: WorkspaceQueueItem[];
  stages: PipelineStage[];
  selectedId: string | null;
  title: string;
  showOwner: boolean;
  className?: string;
}

/** "Meu funil": abas por situação, busca, cards com código/empresa/produtos/valor/estágio e paginação. */
export function WorkspaceQueue({ items, stages, selectedId, title, showOwner, className }: WorkspaceQueueProps) {
  const { searchParams, setLocal, navigate } = useSalesUrl();
  const tabParam = searchParams.get("fila") as WorkspaceQueue | null;
  const tab: WorkspaceQueue = tabParam && QUEUE_TABS.some((t) => t.key === tabParam) ? tabParam : "todos";
  const [query, setQuery] = React.useState("");
  const [page, setPage] = React.useState(1);
  const [prevKey, setPrevKey] = React.useState(`${tab}|${query}`);
  if (prevKey !== `${tab}|${query}`) {
    setPrevKey(`${tab}|${query}`);
    setPage(1);
  }

  const counts = React.useMemo(() => {
    const out: Partial<Record<WorkspaceQueue, number>> = {};
    for (const item of items) for (const q of item.queues) out[q] = (out[q] ?? 0) + 1;
    return out;
  }, [items]);

  const filtered = React.useMemo(() => {
    const term = normalize(query.trim());
    return items.filter((i) => {
      if (!i.queues.includes(tab)) return false;
      if (!term) return true;
      return normalize(`${i.code} ${i.clientName} ${i.title} ${i.productsLabel} ${i.ownerName}`).includes(term);
    });
  }, [items, tab, query]);

  const pages = Math.max(1, Math.ceil(filtered.length / PAGE_SIZE));
  const current = Math.min(page, pages);
  const visible = filtered.slice((current - 1) * PAGE_SIZE, current * PAGE_SIZE);
  const stageLabel = (key: string) => stages.find((s) => s.key === key)?.label;

  return (
    <section aria-label={title} className={cn("flex min-h-0 min-w-0 flex-col rounded-xl border border-border bg-surface shadow-card", className)}>
      <div className="flex flex-col gap-3 border-b border-border p-3.5 pb-0">
        <div className="flex items-center justify-between gap-2">
          <h2 className="text-base font-semibold">{title}</h2>
          <span className="text-xs tabular-nums text-muted">{items.length} no total</span>
        </div>
        <SearchInput value={query} onChange={setQuery} placeholder="Buscar código, empresa ou produto" size="sm" aria-label="Buscar no funil" />
        <div role="tablist" aria-label="Situação" className="-mx-3.5 flex gap-1 overflow-x-auto px-3.5 scrollbar-none">
          {QUEUE_TABS.map((t) => {
            const active = t.key === tab;
            return (
              <button
                key={t.key}
                type="button"
                role="tab"
                aria-selected={active}
                title={t.hint}
                onClick={() => setLocal({ fila: t.key === "todos" ? null : t.key })}
                className={cn(
                  "-mb-px inline-flex min-h-[44px] shrink-0 items-center gap-1.5 border-b-2 px-2 text-[13px] font-medium transition-colors md:min-h-9",
                  active ? "border-brand text-brand-fg" : "border-transparent text-muted hover:text-foreground",
                )}
              >
                {t.label}
                <span className={cn("rounded-full px-1.5 text-[10px] tabular-nums", active ? "bg-brand-soft text-brand-fg" : "bg-surface-hover text-muted")}>{counts[t.key] ?? 0}</span>
              </button>
            );
          })}
        </div>
      </div>

      <div className="min-h-0 flex-1 overflow-y-auto p-2.5 scrollbar-thin">
        {visible.length === 0 ? (
          <EmptyState size="sm" icon={<Inbox />} title={query ? "Nada encontrado" : "Nenhuma oportunidade aqui"} description={query ? "Tente outro termo de busca." : QUEUE_TABS.find((t) => t.key === tab)?.hint} />
        ) : (
          <ul className="flex flex-col gap-2">
            {visible.map((item) => {
              const selected = item.id === selectedId;
              const channel = item.lastChannel ? CHANNEL_ICON[item.lastChannel] : null;
              return (
                <li key={item.id}>
                  <button
                    type="button"
                    onClick={() => navigate({ oportunidade: item.id, tela: null, visita: null })}
                    aria-current={selected ? "true" : undefined}
                    className={cn(
                      "flex w-full flex-col gap-1 rounded-lg border p-3 text-left transition-colors",
                      selected ? "border-brand bg-brand-soft shadow-brand/40" : "border-border bg-surface-muted hover:border-border-strong hover:bg-surface-hover",
                    )}
                  >
                    <span className="flex items-center justify-between gap-2">
                      <span className="text-xs font-semibold tabular-nums text-brand-fg">#{item.code}</span>
                      <span className="text-[11px] tabular-nums text-muted" title="Última atividade">
                        {formatDay(item.lastActivityAt) === "Hoje" ? formatTime(item.lastActivityAt) : formatDay(item.lastActivityAt)}
                      </span>
                    </span>
                    <span className="flex items-start justify-between gap-2">
                      <span className="min-w-0">
                        <span className="block truncate text-sm font-semibold text-foreground">{item.clientName}</span>
                        <span className="block truncate text-xs text-muted">{item.productsLabel}</span>
                      </span>
                      {channel ? (
                        <span title={channel.label}>
                          <IconTile icon={channel.icon} tone={channel.tone} size="sm" />
                          <span className="sr-only">{channel.label}</span>
                        </span>
                      ) : null}
                    </span>
                    <span className="text-sm font-semibold tabular-nums text-foreground">{mainValue(item)}</span>
                    <span className="flex flex-wrap items-center justify-between gap-x-2 gap-y-1">
                      <StageBadge stage={item.stage} label={stageLabel(item.stage)} />
                      <NextLine item={item} />
                    </span>
                    {showOwner ? <span className="truncate text-[11px] text-muted-light">{item.ownerName}</span> : null}
                  </button>
                </li>
              );
            })}
          </ul>
        )}
      </div>

      <div className="flex items-center justify-between gap-2 border-t border-border px-3.5 py-2.5 text-xs text-muted">
        <span className="tabular-nums">
          {filtered.length === 0 ? "Nenhum resultado" : `Exibindo ${(current - 1) * PAGE_SIZE + 1}–${Math.min(current * PAGE_SIZE, filtered.length)} de ${filtered.length}`}
        </span>
        <span className="flex gap-1">
          <Button variant="outline" size="icon" className="size-9 md:size-8" onClick={() => setPage(current - 1)} disabled={current <= 1} aria-label="Página anterior">
            <ChevronLeft />
          </Button>
          <Button variant="outline" size="icon" className="size-9 md:size-8" onClick={() => setPage(current + 1)} disabled={current >= pages} aria-label="Próxima página">
            <ChevronRight />
          </Button>
        </span>
      </div>
    </section>
  );
}
