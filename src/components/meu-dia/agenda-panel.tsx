"use client";

/**
 * Agenda do Meu Dia: hoje e os 6 dias seguintes, um dia por vez (abas com a quantidade de compromissos). Visitas,
 * tarefas (pelo prazo), follow-ups de leads e oportunidades, treinamentos e checkpoints, em ordem de horário — feitos
 * riscados, atrasados de hoje em vermelho e escritos. Dados prontos do servidor (getMeuDia → agendaDays): só entra o
 * que o usuário pode abrir.
 */
import * as React from "react";
import Link from "next/link";
import { CalendarDays, Check } from "lucide-react";
import { ScreenLink } from "@/components/auth/access-provider";
import { Card } from "@/components/ui/card";
import { cn } from "@/lib/utils";
import { AgendaIcon } from "./kind-icon";
import type { AgendaDay, AgendaItem, AgendaLink } from "./model";

/** Compromissos do dia visíveis antes de "Ver todos": no celular menos (a agenda vem antes das prioridades). */
const VISIBLE_ITEMS = 8;
const VISIBLE_ITEMS_MOBILE = 4;

function ClientName({ id, name }: { id?: string; name: string }) {
  const plain = <span className="min-w-0 truncate">{name}</span>;
  if (!id) return plain;
  return (
    <ScreenLink href={`/clientes/${id}`} className="min-w-0 truncate hover:text-foreground hover:underline" fallback={plain}>
      {name}
    </ScreenLink>
  );
}

function AgendaRow({ item, className }: { item: AgendaItem; className?: string }) {
  const titleClass = cn("line-clamp-2 break-words text-sm font-medium", item.done ? "text-muted line-through" : "text-foreground");
  return (
    <li className={cn("flex items-start gap-3 py-2.5 first:pt-0 last:pb-0", className)}>
      <div className="w-11 shrink-0 pt-0.5">
        <span className={cn("block text-sm font-semibold tabular-nums", item.done ? "text-muted line-through" : item.overdue ? "text-danger-fg" : "text-foreground")}>{item.timeLabel}</span>
        {item.overdue ? <span className="block text-[10px] font-medium leading-tight text-danger-fg">atrasado</span> : null}
      </div>
      <span className={cn("mt-0.5 flex size-7 shrink-0 items-center justify-center rounded-md", item.done ? "bg-success-soft text-success-fg" : item.overdue ? "bg-danger-soft text-danger-fg" : "bg-surface-hover text-muted")}>
        {item.done ? <Check className="size-4" role="img" aria-label="Feito" /> : <AgendaIcon kind={item.kind} />}
      </span>
      <div className="min-w-0 flex-1">
        {item.kind === "tarefa" ? <span className="sr-only">Tarefa: </span> : null}
        <Link href={item.href} className={cn(titleClass, "hover:text-brand hover:underline")} title={item.title}>
          {item.title}
        </Link>
        {item.clientName || item.assigneeName ? (
          // Uma linha só: o cliente encurta; o "·" fica junto do responsável (nunca sozinho no começo da linha).
          <div className="flex min-w-0 items-baseline text-xs text-muted">
            {item.clientName ? <ClientName id={item.clientId} name={item.clientName} /> : null}
            {item.assigneeName ? (
              <span className="shrink-0 whitespace-nowrap">
                {item.clientName ? " · " : ""}
                {item.assigneeName}
              </span>
            ) : null}
          </div>
        ) : null}
      </div>
    </li>
  );
}

export interface AgendaPanelProps {
  days: AgendaDay[];
  /** Visão "Minha equipe": cada compromisso mostra de quem é. */
  team: boolean;
  /** Atalho para a agenda inteira (calculado no servidor conforme o perfil e o acesso). */
  link?: AgendaLink;
  className?: string;
}

export function AgendaPanel({ days, team, link, className }: AgendaPanelProps) {
  // O dia escolhido é guardado pela data (não pela posição): depois da meia-noite ou de um refresh a aba continua certa.
  const [selectedKey, setSelectedKey] = React.useState(days[0]?.key ?? "");
  const [expanded, setExpanded] = React.useState(false);
  const tabs = React.useRef<(HTMLButtonElement | null)[]>([]);
  const panelId = React.useId();
  if (!days.length) return null;
  const found = days.findIndex((d) => d.key === selectedKey);
  const selected = found >= 0 ? found : 0;
  const day = days[selected];
  const total = days.reduce((n, d) => n + d.total, 0);
  // Dia vazio: aponta o próximo compromisso ainda não feito.
  const next = day.items.length === 0 ? days.findIndex((d, i) => i > selected && d.items.some((x) => !x.done)) : -1;
  const nextItem = next > 0 ? days[next].items.find((x) => !x.done) : undefined;
  const shown = expanded ? day.items : day.items.slice(0, VISIBLE_ITEMS);
  const toggleMobile = day.items.length > VISIBLE_ITEMS_MOBILE;
  const toggleDesktop = day.items.length > VISIBLE_ITEMS;
  const beyond = day.total - day.items.length;

  const choose = (index: number) => {
    setSelectedKey(days[index].key);
    setExpanded(false);
  };

  /** Troca de dia pelo teclado (ou pelo atalho do dia vazio) levando o foco para a aba. */
  const select = (index: number) => {
    const i = ((index % days.length) + days.length) % days.length;
    choose(i);
    tabs.current[i]?.focus();
  };

  return (
    <Card className={cn("flex flex-col p-4 md:p-5", className)}>
      <section aria-labelledby={`${panelId}-titulo`} className="flex min-h-0 flex-1 flex-col">
        <div className="mb-3 flex shrink-0 flex-wrap items-center justify-between gap-x-2 gap-y-1">
          <h2 id={`${panelId}-titulo`} className="flex items-center gap-2 text-base font-semibold leading-tight tracking-tight text-foreground">
            <CalendarDays className="size-4 text-brand-fg" aria-hidden /> Agenda
            {team ? <span className="whitespace-nowrap text-xs font-normal text-muted">· equipe</span> : null}
            <span className="rounded-full bg-surface-hover px-2 py-0.5 text-xs font-medium tabular-nums text-muted" title="Compromissos nos próximos 7 dias">
              {total}
            </span>
          </h2>
          {link ? (
            <Link href={link.href} className="text-sm font-medium text-brand hover:underline">
              {link.label}
            </Link>
          ) : null}
        </div>

        {/* Os 7 dias cabem sempre (grade de 7 colunas): dia da semana, número e a quantidade num selo. */}
        <div role="tablist" aria-label="Dia da agenda" className="mb-3 grid shrink-0 grid-cols-7 gap-1">
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
                aria-label={`${d.label}: ${d.total === 0 ? "nenhum compromisso" : d.total === 1 ? "1 compromisso" : `${d.total} compromissos`}`}
                tabIndex={active ? 0 : -1}
                onClick={() => choose(i)}
                onKeyDown={(e) => {
                  const target = e.key === "ArrowRight" ? i + 1 : e.key === "ArrowLeft" ? i - 1 : e.key === "Home" ? 0 : e.key === "End" ? days.length - 1 : null;
                  if (target === null) return;
                  e.preventDefault();
                  select(target);
                }}
                className={cn(
                  "relative flex min-h-[48px] min-w-0 flex-col items-center justify-center rounded-lg border px-0.5 py-1 leading-tight",
                  active ? "border-brand bg-brand-soft text-foreground" : "border-border text-muted hover:bg-surface-hover hover:text-foreground",
                )}
              >
                <span className="text-[11px] font-medium">{d.tabLabel}</span>
                <span className={cn("text-sm font-semibold tabular-nums", active || d.total ? "text-foreground" : "text-muted")}>{d.dayNumber}</span>
                {d.total ? (
                  <>
                    {/* Telas muito estreitas: o número cobriria o dia da semana; fica um ponto (a quantidade está no rótulo). */}
                    <span
                      aria-hidden
                      className={cn(
                        "absolute -right-1 -top-1.5 min-w-[18px] rounded-full px-1 text-center text-[10px] font-semibold leading-[18px] tabular-nums max-[380px]:hidden",
                        active ? "bg-brand text-white" : "bg-surface-hover text-foreground ring-1 ring-border",
                      )}
                    >
                      {d.total}
                    </span>
                    <span aria-hidden className={cn("absolute right-1 top-1 hidden size-1.5 rounded-full max-[380px]:block", active ? "bg-brand" : "bg-muted")} />
                  </>
                ) : null}
              </button>
            );
          })}
        </div>

        {/* Rola por dentro quando o painel fica fixo no desktop e o dia é longo; trocar de dia volta ao topo (key). */}
        <div key={day.key} id={`${panelId}-dia`} role="tabpanel" tabIndex={0} aria-labelledby={`${panelId}-aba-${selected}`} className="-mx-1 min-h-0 flex-1 overflow-y-auto px-1 pb-1 outline-none">
          <p className="mb-2 text-xs text-muted first-letter:uppercase">
            {selected <= 1 ? `${day.label} · ` : ""}
            {day.longLabel}
          </p>
          {day.items.length === 0 ? (
            <div className="text-sm text-muted">
              <p>{selected === 0 ? "Nada agendado para hoje." : "Nada agendado para este dia."}</p>
              {nextItem ? (
                <button type="button" onClick={() => select(next)} className="mt-1 text-left text-sm font-medium text-brand hover:underline">
                  Próximo compromisso: {next === 1 ? "amanhã" : days[next].label}, {nextItem.timeLabel} · {nextItem.title}
                </button>
              ) : null}
            </div>
          ) : (
            <>
              <ul className="flex flex-col divide-y divide-border">
                {shown.map((item, index) => (
                  <AgendaRow key={item.id} item={item} className={!expanded && index >= VISIBLE_ITEMS_MOBILE ? "max-md:hidden" : undefined} />
                ))}
              </ul>
              {toggleMobile ? (
                <button
                  type="button"
                  aria-expanded={expanded}
                  onClick={() => setExpanded((v) => !v)}
                  className={cn("mt-3 text-sm font-medium text-brand hover:underline", !toggleDesktop && "md:hidden")}
                >
                  {expanded ? "Mostrar menos" : `Ver todos (${day.items.length})`}
                </button>
              ) : null}
              {expanded && beyond > 0 ? (
                <p className="mt-2 text-xs text-muted">
                  E mais {beyond} {beyond === 1 ? "compromisso" : "compromissos"} neste dia
                  {link ? (
                    <>
                      {" "}
                      ·{" "}
                      <Link href={link.href} className="font-medium text-brand hover:underline">
                        {link.label}
                      </Link>
                    </>
                  ) : null}
                </p>
              ) : null}
            </>
          )}
        </div>
      </section>
    </Card>
  );
}
