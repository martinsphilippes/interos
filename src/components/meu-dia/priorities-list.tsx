"use client";

import * as React from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { Check, ChevronRight, Sparkles } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { EmptyState } from "@/components/ui/empty-state";
import { PriorityBadge } from "@/components/ui/priority-badge";
import { SlaBadge } from "@/components/ui/sla-badge";
import { toast } from "@/components/ui/toast";
import { completeTaskQuick } from "@/server/meu-dia/actions";
import { KindIcon } from "./kind-icon";
import { PRIORITY_FILTERS, PRIORITY_FILTER_LABELS, PRIORITY_KIND_LABELS, filterPriorities, type MeuDiaScope, type PriorityFilter, type PriorityItem, type ReasonTone } from "./model";
import { cn } from "@/lib/utils";

const PAGE = 30;

const REASON_CLASS: Record<ReasonTone, string> = {
  danger: "text-danger-fg",
  warning: "text-warning-fg",
  info: "text-info-fg",
  muted: "text-muted",
};

export interface PrioritiesListProps {
  items: PriorityItem[];
  filter: PriorityFilter;
  scope: MeuDiaScope;
}

/**
 * Lista unificada "Prioridades de agora". Filtros por chips (links, para a URL ficar compartilhável),
 * 30 itens por vez com "ver mais" e conclusão inline de tarefas via completeTaskQuick.
 */
export function PrioritiesList({ items, filter, scope }: PrioritiesListProps) {
  const router = useRouter();
  const [visible, setVisible] = React.useState(PAGE);
  const [completed, setCompleted] = React.useState<Set<string>>(() => new Set());
  const [busyId, setBusyId] = React.useState<string | null>(null);
  const [, startTransition] = React.useTransition();

  const filtered = React.useMemo(() => filterPriorities(items, filter).filter((i) => !completed.has(i.id)), [items, filter, completed]);
  const counts = React.useMemo(() => Object.fromEntries(PRIORITY_FILTERS.map((f) => [f, filterPriorities(items, f).length])) as Record<PriorityFilter, number>, [items]);
  const shown = filtered.slice(0, visible);

  const chipHref = (f: PriorityFilter) => {
    const params = new URLSearchParams();
    if (scope === "equipe") params.set("escopo", "equipe");
    if (f !== "todas") params.set("filtro", f);
    const qs = params.toString();
    return qs ? `/meu-dia?${qs}#prioridades` : "/meu-dia#prioridades";
  };

  const complete = (item: PriorityItem) => {
    setBusyId(item.id);
    startTransition(async () => {
      const result = await completeTaskQuick(item.entityId);
      setBusyId(null);
      if (!result.ok) {
        toast.error(result.error);
        return;
      }
      setCompleted((prev) => new Set(prev).add(item.id));
      toast.success(`Tarefa concluída: ${item.title}`);
      router.refresh();
    });
  };

  return (
    <section id="prioridades" aria-labelledby="prioridades-titulo" className="mb-6 scroll-mt-20">
      <div className="mb-3 flex flex-col gap-2 md:flex-row md:items-end md:justify-between">
        <div>
          <h2 id="prioridades-titulo" className="flex items-center gap-2 text-base font-semibold leading-tight tracking-tight text-foreground">
            Prioridades de agora
            <span className="rounded-full bg-surface-hover px-2 py-0.5 text-xs font-medium tabular-nums text-muted">{filtered.length}</span>
          </h2>
          <p className="mt-0.5 text-sm text-muted">Ordenadas por urgência, prazo, impacto e prioridade. Conclua tarefas direto daqui.</p>
        </div>
        <div className="-mx-4 flex gap-1.5 overflow-x-auto px-4 scrollbar-none md:mx-0 md:px-0" role="group" aria-label="Filtrar prioridades">
          {PRIORITY_FILTERS.map((f) => {
            const active = f === filter;
            return (
              <Link
                key={f}
                href={chipHref(f)}
                scroll={false}
                aria-pressed={active}
                className={cn(
                  "inline-flex h-9 shrink-0 items-center gap-1.5 rounded-full border px-3 text-[13px] font-medium transition-colors",
                  active ? "border-brand bg-brand text-white shadow-brand" : "border-border-strong bg-surface-muted text-muted hover:border-muted-light/60 hover:text-foreground",
                )}
              >
                {PRIORITY_FILTER_LABELS[f]}
                <span className={cn("tabular-nums", active ? "text-white/70" : "text-muted-light")}>{counts[f]}</span>
              </Link>
            );
          })}
        </div>
      </div>

      <Card>
        {shown.length === 0 ? (
          <EmptyState
            icon={<Sparkles />}
            title={filter === "todas" ? "Tudo em dia" : `Nada em "${PRIORITY_FILTER_LABELS[filter]}"`}
            description={filter === "todas" ? "Nenhuma pendência urgente agora. Aproveite para adiantar os follow-ups e a agenda." : "Sem itens nesse filtro no momento."}
            action={filter !== "todas" ? <Button asChild variant="outline"><Link href={chipHref("todas")}>Ver todas</Link></Button> : undefined}
          />
        ) : (
          <ul className="divide-y divide-border">
            {shown.map((item, index) => (
              <li key={item.id} className={cn("flex flex-col gap-3 px-4 py-3 md:flex-row md:items-center md:gap-4 md:px-5", index < 3 && "bg-surface-muted/60")}>
                <div className="flex min-w-0 flex-1 items-start gap-3">
                  <KindIcon kind={item.kind} />
                  <div className="min-w-0 flex-1">
                    <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
                      <Link href={item.href} className="truncate text-sm font-medium text-foreground hover:text-brand hover:underline">
                        {item.title}
                      </Link>
                      {item.clientId && item.clientName && item.kind !== "cliente" ? (
                        <Link href={`/clientes/${item.clientId}`} className="truncate text-xs text-muted hover:text-foreground hover:underline">
                          {item.clientName}
                        </Link>
                      ) : null}
                    </div>
                    <p className={cn("mt-0.5 text-[13px] font-medium", REASON_CLASS[item.reasonTone])}>{item.reason}</p>
                    <div className="mt-1.5 flex flex-wrap items-center gap-1.5">
                      <Badge variant="muted" size="sm">{PRIORITY_KIND_LABELS[item.kind]}</Badge>
                      {item.priority ? <PriorityBadge priority={item.priority} /> : null}
                      {item.sla ? <SlaBadge state={item.sla.state} remainingMs={item.sla.remainingMs} /> : null}
                      {item.dueLabel ? <span className="text-xs tabular-nums text-muted">{item.dueLabel}</span> : null}
                      {item.impactLabel ? <span className="text-xs text-muted">· {item.impactLabel}</span> : null}
                      {item.assigneeName ? <span className="text-xs text-muted">· {item.assigneeName}</span> : null}
                    </div>
                  </div>
                </div>
                <div className="flex shrink-0 items-center gap-2 md:justify-end">
                  {item.canComplete ? (
                    <Button variant="outline" size="lg" className="flex-1 md:h-9 md:flex-none md:px-3 md:text-sm" loading={busyId === item.id} onClick={() => complete(item)}>
                      <Check /> Concluir
                    </Button>
                  ) : null}
                  <Button asChild variant="ghost" size="lg" className="flex-1 md:h-9 md:w-9 md:flex-none md:px-0" aria-label={`Abrir ${item.title}`}>
                    <Link href={item.href}>
                      <span className="md:sr-only">Abrir</span>
                      <ChevronRight />
                    </Link>
                  </Button>
                </div>
              </li>
            ))}
          </ul>
        )}
        {filtered.length > shown.length ? (
          <div className="border-t border-border px-4 py-3 text-center">
            <Button variant="ghost" onClick={() => setVisible((v) => v + PAGE)}>
              Ver mais ({filtered.length - shown.length} restantes)
            </Button>
          </div>
        ) : null}
      </Card>
    </section>
  );
}
