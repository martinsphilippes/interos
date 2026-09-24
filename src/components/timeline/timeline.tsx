"use client";

import * as React from "react";
import Link from "next/link";
import { ExternalLink, History } from "lucide-react";
import type { TimelineEvent } from "@/domain/types";
import { DEPARTMENT_LABELS, type DepartmentKey } from "@/domain/constants";
import { dateKey, formatDateKey, formatDateTime, formatTime } from "@/lib/format";
import { Select } from "@/components/ui/select";
import { EmptyState } from "@/components/ui/empty-state";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { EVENT_CATEGORY_LABELS, EventIcon, eventCategory, type EventCategory } from "./event-icon";

export { EventIcon, eventCategory, EVENT_CATEGORY_LABELS } from "./event-icon";

/** Rota de detalhe de uma entidade referenciada no evento (contratos de URL entre módulos). */
export function entityHref(entityType: string | undefined, entityId: string | undefined): string | null {
  if (!entityType || !entityId) return null;
  switch (entityType) {
    case "task":
      return `/tarefas?tarefa=${entityId}`;
    case "workflow_step":
      return `/workflow?etapa=${entityId}`;
    case "workflow_instance":
      return `/workflow/${entityId}`;
    case "ticket":
      return `/suporte/chamados?chamado=${entityId}`;
    case "opportunity":
      return `/vendas/oportunidades?oportunidade=${entityId}`;
    case "proposal":
      return `/vendas/propostas?proposta=${entityId}`;
    case "contract":
      return `/financeiro/contratos?contrato=${entityId}`;
    case "project":
      return `/implantacao?projeto=${entityId}`;
    case "lead":
      return `/marketing/leads?lead=${entityId}`;
    default:
      return null;
  }
}

/** Dia (AAAA-MM-DD) em America/Sao_Paulo — igual no servidor e no navegador. */
function dayKey(iso: string): string {
  return dateKey(iso);
}

function dayLabel(key: string): string {
  const today = dayKey(new Date().toISOString());
  const yesterday = dayKey(new Date(Date.now() - 86_400_000).toISOString());
  if (key === today) return "Hoje";
  if (key === yesterday) return "Ontem";
  return formatDateKey(key, "EEEE, dd 'de' MMMM 'de' yyyy");
}

export interface TimelineProps {
  events: TimelineEvent[];
  /** Mostra filtros por departamento e tipo (padrão: true quando há eventos). */
  showFilters?: boolean;
  /** Quantidade inicial de eventos exibidos; o restante aparece com "Mostrar mais". */
  pageSize?: number;
  emptyTitle?: string;
  emptyDescription?: string;
  className?: string;
}

/**
 * Linha do tempo única do cliente: eventos mais recentes primeiro, agrupados por dia, com ícone por
 * tipo, ator, departamento e descrição. Reutilizável em qualquer lugar que tenha TimelineEvent[].
 */
export function Timeline({ events, showFilters, pageSize = 40, emptyTitle = "Nenhum evento registrado", emptyDescription, className }: TimelineProps) {
  const [department, setDepartment] = React.useState<string>("");
  const [category, setCategory] = React.useState<string>("");
  const [limit, setLimit] = React.useState(pageSize);

  const departments = React.useMemo(() => {
    const keys = Array.from(new Set(events.map((e) => e.department).filter((d): d is DepartmentKey => Boolean(d))));
    return keys.sort((a, b) => DEPARTMENT_LABELS[a].localeCompare(DEPARTMENT_LABELS[b], "pt-BR"));
  }, [events]);
  const categories = React.useMemo(() => {
    const keys = Array.from(new Set(events.map((e) => eventCategory(e.type))));
    return keys.sort((a, b) => EVENT_CATEGORY_LABELS[a].localeCompare(EVENT_CATEGORY_LABELS[b], "pt-BR"));
  }, [events]);

  const filtered = React.useMemo(() => {
    const sorted = [...events].sort((a, b) => (a.occurredAt < b.occurredAt ? 1 : -1));
    return sorted.filter((e) => (!department || e.department === department) && (!category || eventCategory(e.type) === category));
  }, [events, department, category]);

  const visible = filtered.slice(0, limit);
  const groups: { key: string; items: TimelineEvent[] }[] = [];
  for (const event of visible) {
    const key = dayKey(event.occurredAt);
    const last = groups[groups.length - 1];
    if (last && last.key === key) last.items.push(event);
    else groups.push({ key, items: [event] });
  }

  const filtersVisible = showFilters ?? events.length > 0;

  return (
    <div className={cn("flex flex-col gap-4", className)}>
      {filtersVisible ? (
        <div className="flex flex-col gap-2 sm:flex-row sm:items-center">
          <Select
            size="sm"
            aria-label="Filtrar por departamento"
            value={department}
            onChange={(e) => {
              setDepartment(e.target.value);
              setLimit(pageSize);
            }}
            className="sm:max-w-[220px]"
          >
            <option value="">Todos os departamentos</option>
            {departments.map((d) => (
              <option key={d} value={d}>
                {DEPARTMENT_LABELS[d]}
              </option>
            ))}
          </Select>
          <Select
            size="sm"
            aria-label="Filtrar por tipo de evento"
            value={category}
            onChange={(e) => {
              setCategory(e.target.value);
              setLimit(pageSize);
            }}
            className="sm:max-w-[220px]"
          >
            <option value="">Todos os tipos</option>
            {categories.map((c) => (
              <option key={c} value={c}>
                {EVENT_CATEGORY_LABELS[c as EventCategory]}
              </option>
            ))}
          </Select>
          <span className="text-xs text-muted sm:ml-auto">
            {filtered.length === events.length ? `${events.length} evento${events.length === 1 ? "" : "s"}` : `${filtered.length} de ${events.length} eventos`}
          </span>
        </div>
      ) : null}

      {filtered.length === 0 ? (
        <EmptyState
          size="sm"
          icon={<History />}
          title={events.length === 0 ? emptyTitle : "Nenhum evento com esses filtros"}
          description={events.length === 0 ? emptyDescription : "Limpe os filtros para ver toda a linha do tempo."}
          action={
            events.length > 0 ? (
              <Button
                variant="outline"
                size="sm"
                onClick={() => {
                  setDepartment("");
                  setCategory("");
                }}
              >
                Limpar filtros
              </Button>
            ) : undefined
          }
        />
      ) : (
        <ol className="flex flex-col gap-6" aria-label="Linha do tempo">
          {groups.map((group) => (
            <li key={group.key}>
              <p className="label-caps mb-3 first-letter:uppercase">{dayLabel(group.key)}</p>
              <ol className="relative flex flex-col gap-4 border-l border-border pl-6 md:pl-7">
                {group.items.map((event) => {
                  const href = entityHref(event.entityType, event.entityId);
                  return (
                    <li key={event.id} className="relative">
                      <EventIcon type={event.type} className="absolute -left-[42px] top-0 ring-4 ring-surface md:-left-[46px]" />
                      <div className="flex min-w-0 flex-col gap-1">
                        <div className="flex flex-wrap items-start justify-between gap-x-3 gap-y-1">
                          <p className="min-w-0 flex-1 text-sm font-medium leading-snug text-foreground">{event.title}</p>
                          <time dateTime={event.occurredAt} title={formatDateTime(event.occurredAt)} className="shrink-0 text-xs tabular-nums text-muted">
                            {formatTime(event.occurredAt)}
                          </time>
                        </div>
                        {event.description ? <p className="whitespace-pre-line text-sm text-muted">{event.description}</p> : null}
                        <p className="flex flex-wrap items-center gap-x-2 gap-y-0.5 text-xs text-muted-light">
                          <span className="text-muted">{event.actorName}</span>
                          {event.department ? (
                            <>
                              <span aria-hidden>·</span>
                              <span>{DEPARTMENT_LABELS[event.department]}</span>
                            </>
                          ) : null}
                          {href ? (
                            <>
                              <span aria-hidden>·</span>
                              <Link href={href} className="inline-flex items-center gap-1 text-secondary hover:underline">
                                Abrir <ExternalLink className="size-3" aria-hidden />
                              </Link>
                            </>
                          ) : null}
                        </p>
                      </div>
                    </li>
                  );
                })}
              </ol>
            </li>
          ))}
        </ol>
      )}

      {filtered.length > limit ? (
        <div className="flex justify-center">
          <Button variant="outline" size="sm" onClick={() => setLimit((l) => l + pageSize)}>
            Mostrar mais ({filtered.length - limit} restantes)
          </Button>
        </div>
      ) : null}
    </div>
  );
}
