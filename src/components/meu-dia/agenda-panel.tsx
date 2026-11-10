"use client";

/**
 * Agenda do Meu Dia: hoje e os 6 dias seguintes, um dia por vez (abas com a quantidade de compromissos). Visitas,
 * tarefas com horário, follow-ups de leads e oportunidades, treinamentos e checkpoints, em ordem de horário — feitos
 * riscados, atrasados de hoje em vermelho. Dados prontos do servidor (getMeuDia → agendaDays); item cuja tela o
 * usuário não vê aparece sem link.
 */
import * as React from "react";
import Link from "next/link";
import { CalendarDays, Check } from "lucide-react";
import { ScreenLink } from "@/components/auth/access-provider";
import { Card } from "@/components/ui/card";
import { cn } from "@/lib/utils";
import { AgendaIcon } from "./kind-icon";
import type { AgendaDay, AgendaItem } from "./model";

function ClientName({ id, name }: { id?: string; name?: string }) {
  if (!name) return null;
  if (!id) return <span className="truncate text-xs text-muted">{name}</span>;
  return (
    <ScreenLink href={`/clientes/${id}`} className="truncate text-xs text-muted hover:text-foreground hover:underline" fallback={<span className="truncate text-xs text-muted">{name}</span>}>
      {name}
    </ScreenLink>
  );
}

function AgendaRow({ item }: { item: AgendaItem }) {
  const titleClass = cn("block truncate text-sm font-medium", item.done ? "text-muted line-through" : "text-foreground");
  return (
    <li className="flex items-start gap-3 py-2.5 first:pt-0 last:pb-0">
      <span className={cn("w-11 shrink-0 pt-0.5 text-sm font-semibold tabular-nums", item.done ? "text-muted line-through" : item.overdue ? "text-danger-fg" : "text-foreground")}>{item.timeLabel}</span>
      <span className={cn("mt-0.5 flex size-7 shrink-0 items-center justify-center rounded-md", item.done ? "bg-success-soft text-success-fg" : item.overdue ? "bg-danger-soft text-danger-fg" : "bg-surface-hover text-muted")}>
        {item.done ? <Check className="size-4" aria-label="Feito" /> : <AgendaIcon kind={item.kind} />}
      </span>
      <div className="min-w-0 flex-1">
        {item.href ? (
          <Link href={item.href} className={cn(titleClass, "hover:text-brand hover:underline")} title={item.title}>
            {item.title}
          </Link>
        ) : (
          <span className={titleClass} title={item.title}>
            {item.title}
          </span>
        )}
        <div className="flex min-w-0 flex-wrap items-center gap-x-2">
          <ClientName id={item.clientId} name={item.clientName} />
          {item.assigneeName ? <span className="text-xs text-muted">· {item.assigneeName}</span> : null}
          {item.overdue ? <span className="text-xs font-medium text-danger-fg">· atrasado</span> : null}
        </div>
      </div>
    </li>
  );
}

export interface AgendaPanelProps {
  days: AgendaDay[];
  /** Visão "Minha equipe": cada compromisso mostra de quem é. */
  team: boolean;
  className?: string;
}

export function AgendaPanel({ days, team, className }: AgendaPanelProps) {
  const [selected, setSelected] = React.useState(0);
  const tabs = React.useRef<(HTMLButtonElement | null)[]>([]);
  const panelId = React.useId();
  if (!days.length) return null;
  const day = days[Math.min(selected, days.length - 1)];
  const next = day.items.length === 0 ? days.findIndex((d, i) => i > selected && d.items.length > 0) : -1;
  const total = days.reduce((n, d) => n + d.items.length, 0);

  const select = (index: number) => {
    const i = (index + days.length) % days.length;
    setSelected(i);
    tabs.current[i]?.focus();
  };

  return (
    <Card className={cn("flex flex-col p-4 md:p-5", className)}>
      <section aria-labelledby={`${panelId}-titulo`}>
        <div className="mb-3 flex items-center justify-between gap-2">
          <h2 id={`${panelId}-titulo`} className="flex items-center gap-2 text-base font-semibold leading-tight tracking-tight text-foreground">
            <CalendarDays className="size-4 text-brand-fg" aria-hidden /> Agenda
            {team ? <span className="text-xs font-normal text-muted">· equipe</span> : null}
            <span className="rounded-full bg-surface-hover px-2 py-0.5 text-xs font-medium tabular-nums text-muted" title="Compromissos nos próximos 7 dias">
              {total}
            </span>
          </h2>
          <ScreenLink
            href="/vendas/agenda"
            className="shrink-0 text-sm font-medium text-brand hover:underline"
            fallback={
              <ScreenLink href="/tarefas?view=calendario" className="shrink-0 text-sm font-medium text-brand hover:underline">
                Calendário
              </ScreenLink>
            }
          >
            Agenda completa
          </ScreenLink>
        </div>

        {/* Os 7 dias cabem sempre (grade de 7 colunas): dia da semana, número e a quantidade num selo. */}
        <div role="tablist" aria-label="Dia da agenda" className="mb-3 grid grid-cols-7 gap-1">
          {days.map((d, i) => {
            const active = i === selected;
            return (
              <button
                key={d.key}
                ref={(el) => {
                  tabs.current[i] = el;
                }}
                type="button"
                role="tab"
                id={`${panelId}-aba-${i}`}
                aria-selected={active}
                aria-controls={`${panelId}-dia`}
                aria-label={`${d.label}: ${d.items.length === 0 ? "nenhum compromisso" : d.items.length === 1 ? "1 compromisso" : `${d.items.length} compromissos`}`}
                tabIndex={active ? 0 : -1}
                onClick={() => setSelected(i)}
                onKeyDown={(e) => {
                  if (e.key === "ArrowRight") {
                    e.preventDefault();
                    select(i + 1);
                  } else if (e.key === "ArrowLeft") {
                    e.preventDefault();
                    select(i - 1);
                  }
                }}
                className={cn(
                  "relative flex min-h-[48px] min-w-0 flex-col items-center justify-center rounded-lg border px-0.5 py-1 leading-tight",
                  active ? "border-brand bg-brand-soft text-foreground" : "border-border text-muted hover:bg-surface-hover hover:text-foreground",
                )}
              >
                <span className="text-[11px] font-medium">{d.tabLabel}</span>
                <span className={cn("text-sm font-semibold tabular-nums", active ? "text-foreground" : d.items.length ? "text-foreground" : "text-muted")}>{d.dayNumber}</span>
                {d.items.length ? (
                  <span aria-hidden className={cn("absolute -right-1 -top-1.5 min-w-[18px] rounded-full px-1 text-center text-[10px] font-semibold leading-[18px] tabular-nums", active ? "bg-brand text-white" : "bg-surface-hover text-foreground ring-1 ring-border")}>
                    {d.items.length}
                  </span>
                ) : null}
              </button>
            );
          })}
        </div>

        <div id={`${panelId}-dia`} role="tabpanel" aria-labelledby={`${panelId}-aba-${selected}`}>
          <p className="mb-2 text-xs text-muted first-letter:uppercase">
            {selected <= 1 ? `${day.label} · ` : ""}
            {day.longLabel}
          </p>
          {day.items.length === 0 ? (
            <div className="text-sm text-muted">
              <p>{selected === 0 ? "Nada agendado para hoje." : "Nada agendado para este dia."}</p>
              {next > 0 ? (
                <button type="button" onClick={() => setSelected(next)} className="mt-1 text-left text-sm font-medium text-brand hover:underline">
                  Próximo compromisso: {days[next].label.toLowerCase() === "amanhã" ? "amanhã" : days[next].label}, {days[next].items[0].timeLabel} · {days[next].items[0].title}
                </button>
              ) : null}
            </div>
          ) : (
            <ul className="flex flex-col divide-y divide-border">
              {day.items.map((item) => (
                <AgendaRow key={item.id} item={item} />
              ))}
            </ul>
          )}
        </div>
      </section>
    </Card>
  );
}
