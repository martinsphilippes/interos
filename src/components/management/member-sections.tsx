import Link from "next/link";
import { ArrowUpRight, Building2, ChevronRight, GitBranch } from "lucide-react";
import type { MemberEvent, SlaRow, StepRow, TaskRow, TeamMemberView, BonusProjection } from "@/server/management/queries";
import type { Scorecard } from "@/server/kpis/queries";
import { DEPARTMENT_LABELS } from "@/domain/constants";
import { Badge } from "@/components/ui/badge";
import { EmptyState } from "@/components/ui/empty-state";
import { PriorityBadge } from "@/components/ui/priority-badge";
import { SlaBadge } from "@/components/ui/sla-badge";
import { KpiCard } from "@/components/kpis/kpi-card";
import { formatCurrency, formatPercent } from "@/lib/format";
import { cn } from "@/lib/utils";

/** Tarefa com link para o drawer (/tarefas?tarefa=) e para o cliente e o processo de origem. */
export function TaskList({ tasks, empty }: { tasks: TaskRow[]; empty: string }) {
  if (tasks.length === 0) return <p className="py-3 text-sm text-muted">{empty}</p>;
  return (
    <ul className="divide-y divide-border">
      {tasks.map((t) => (
        <li key={t.id} className="flex flex-col gap-1.5 py-2.5 sm:flex-row sm:items-center sm:justify-between sm:gap-3">
          <div className="min-w-0">
            <Link href={t.href} className="inline-flex min-h-[32px] items-center text-sm font-medium text-foreground hover:underline">
              {t.title}
            </Link>
            <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-muted">
              {t.clientId ? (
                <Link href={`/clientes/${t.clientId}`} className="inline-flex min-h-[28px] items-center gap-1 hover:text-foreground hover:underline">
                  <Building2 className="size-3" aria-hidden /> {t.clientName ?? "Cliente"}
                </Link>
              ) : null}
              {t.processHref ? (
                <Link href={t.processHref} className="inline-flex min-h-[28px] items-center gap-1 hover:text-foreground hover:underline">
                  <GitBranch className="size-3" aria-hidden /> {t.processLabel ?? "Processo"}
                </Link>
              ) : t.processLabel ? (
                <span>{t.processLabel}</span>
              ) : null}
            </div>
          </div>
          <div className="flex shrink-0 flex-wrap items-center gap-2 text-xs">
            <PriorityBadge priority={t.priority} />
            <Badge variant="muted" size="sm">
              {t.statusLabel}
            </Badge>
            {t.status === "concluida" ? (
              <span className="tabular-nums text-muted">Concluída {t.completedLabel}</span>
            ) : t.dueLabel ? (
              <span className={cn("tabular-nums", t.overdue ? "font-medium text-danger-fg" : "text-muted")}>{t.overdue ? "Venceu" : "Prazo"} {t.dueLabel}</span>
            ) : (
              <span className="text-muted">Sem prazo</span>
            )}
          </div>
        </li>
      ))}
    </ul>
  );
}

export function SlaList({ slas }: { slas: SlaRow[] }) {
  if (slas.length === 0) return <EmptyState size="sm" title="Nenhum SLA ativo" description="Não há prazos de SLA em andamento sob a responsabilidade deste colaborador." />;
  return (
    <ul className="divide-y divide-border">
      {slas.map((s) => (
        <li key={s.id}>
          <Link href={s.href} className="flex min-h-[52px] items-center justify-between gap-3 py-2 transition-colors hover:bg-surface-muted">
            <span className="min-w-0">
              <span className="block truncate text-sm font-medium text-foreground">{s.ruleName}</span>
              <span className="block text-xs text-muted">{s.entityLabel}</span>
            </span>
            <span className="flex shrink-0 items-center gap-2">
              <SlaBadge state={s.view.state} remainingMs={s.view.remainingMs} />
              <ChevronRight className="size-4 text-muted-light" aria-hidden />
            </span>
          </Link>
        </li>
      ))}
    </ul>
  );
}

export function StepList({ steps }: { steps: StepRow[] }) {
  if (steps.length === 0) return <EmptyState size="sm" title="Nenhuma etapa aberta" description="O colaborador não é responsável por etapas de workflow em aberto." />;
  return (
    <ul className="divide-y divide-border">
      {steps.map((s) => (
        <li key={s.id} className="flex flex-col gap-1.5 py-2.5 sm:flex-row sm:items-center sm:justify-between">
          <div className="min-w-0">
            <Link href={s.href} className="inline-flex min-h-[32px] items-center text-sm font-medium text-foreground hover:underline">
              {s.stageName} · {s.clientName}
            </Link>
            <div className="flex flex-wrap items-center gap-x-3 text-xs text-muted">
              <span>{DEPARTMENT_LABELS[s.department]}</span>
              <span>{s.statusLabel}</span>
              <Link href={s.instanceHref} className="inline-flex min-h-[28px] items-center gap-1 hover:text-foreground hover:underline">
                Jornada <ArrowUpRight className="size-3" aria-hidden />
              </Link>
              <Link href={`/clientes/${s.clientId}`} className="inline-flex min-h-[28px] items-center gap-1 hover:text-foreground hover:underline">
                Cliente <ArrowUpRight className="size-3" aria-hidden />
              </Link>
            </div>
          </div>
          <div className="flex shrink-0 flex-wrap items-center gap-2">
            {s.reason ? (
              <Badge variant={s.status === "aguardando_aprovacao" ? "warning" : "danger"} size="sm">
                {s.reason}
              </Badge>
            ) : null}
            {s.sla ? <SlaBadge state={s.sla.state} remainingMs={s.sla.remainingMs} /> : null}
          </div>
        </li>
      ))}
    </ul>
  );
}

const HEALTH: Record<string, { label: string; variant: "success" | "warning" | "danger" }> = {
  saudavel: { label: "Saudável", variant: "success" },
  atencao: { label: "Atenção", variant: "warning" },
  risco: { label: "Risco", variant: "danger" },
};

export function ClientList({ clients }: { clients: TeamMemberView["clients"] }) {
  if (clients.length === 0) return <EmptyState size="sm" title="Sem clientes vinculados" description="O colaborador não é responsável por clientes nem tem chamados ou etapas abertas." />;
  return (
    <ul className="divide-y divide-border">
      {clients.map((c) => (
        <li key={c.id}>
          <Link href={c.href} className="flex min-h-[56px] flex-col gap-1 py-2 transition-colors hover:bg-surface-muted sm:flex-row sm:items-center sm:justify-between">
            <span className="min-w-0">
              <span className="block truncate text-sm font-medium text-foreground">{c.name}</span>
              <span className="block text-xs text-muted">
                {c.roles.join(" · ")} · MRR {formatCurrency(c.mrr)}
              </span>
            </span>
            <span className="flex flex-wrap items-center gap-1">
              {c.healthLevel ? (
                <Badge variant={HEALTH[c.healthLevel].variant} size="sm">
                  {HEALTH[c.healthLevel].label}
                  {c.healthScore !== undefined ? ` ${Math.round(c.healthScore)}` : ""}
                </Badge>
              ) : null}
              {c.critical.map((r) => (
                <Badge key={r} variant="danger" size="sm">
                  {r}
                </Badge>
              ))}
            </span>
          </Link>
        </li>
      ))}
    </ul>
  );
}

export function ScorecardGrid({ scorecard, onlyCritical }: { scorecard: Scorecard | null; onlyCritical?: boolean }) {
  if (!scorecard) return <EmptyState size="sm" title="Sem scorecard" description="Não foi possível montar os indicadores deste colaborador." />;
  const items = onlyCritical ? scorecard.items.filter((i) => i.status === "critico") : scorecard.items;
  if (items.length === 0) return <EmptyState size="sm" title={onlyCritical ? "Nenhuma meta crítica" : "Sem indicadores"} description={onlyCritical ? "Nenhum indicador do colaborador está em situação crítica." : "A função deste colaborador ainda não tem indicadores."} />;
  return (
    <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 xl:grid-cols-3">
      {items.map((r) => (
        <KpiCard key={r.key} result={r} compact />
      ))}
    </div>
  );
}

export function BonusSummary({ bonus }: { bonus: BonusProjection }) {
  return (
    <dl className="grid grid-cols-2 gap-3 text-sm">
      <div className="col-span-2 rounded-lg bg-surface-muted p-3">
        <dt className="label-caps">Bônus projetado</dt>
        <dd className={cn("mt-1 text-2xl font-semibold tabular-nums", bonus.blocked && "text-danger-fg")}>{bonus.projectedAmount === null ? "—" : formatCurrency(bonus.projectedAmount)}</dd>
        {bonus.blocked ? <dd className="mt-1 text-xs text-danger-fg">Bloqueado{bonus.blockReason ? `: ${bonus.blockReason}` : ""}</dd> : null}
      </div>
      <div>
        <dt className="text-xs text-muted">Atingimento</dt>
        <dd className="font-medium tabular-nums">{formatPercent(bonus.overallAttainment)}</dd>
      </div>
      <div>
        <dt className="text-xs text-muted">Faixa</dt>
        <dd className="font-medium">
          {bonus.tierLabel ?? "—"}
          {bonus.payoutPct !== null ? ` · paga ${bonus.payoutPct}%` : ""}
        </dd>
      </div>
      <div className="col-span-2">
        <dt className="text-xs text-muted">Extras</dt>
        <dd className="font-medium tabular-nums">{bonus.extrasAmount === null ? "—" : formatCurrency(bonus.extrasAmount)}</dd>
      </div>
    </dl>
  );
}

export function EventList({ events }: { events: MemberEvent[] }) {
  if (events.length === 0) return <EmptyState size="sm" title="Sem eventos recentes" description="Nenhuma ação registrada por ou para este colaborador." />;
  return (
    <ol className="relative flex flex-col gap-3 border-l border-border pl-4">
      {events.map((e) => (
        <li key={e.id} className="relative">
          <span className="absolute -left-[21px] top-1.5 size-2 rounded-full bg-secondary" aria-hidden />
          {e.href ? (
            <Link href={e.href} className="text-sm font-medium text-foreground hover:underline">
              {e.title}
            </Link>
          ) : (
            <p className="text-sm font-medium text-foreground">{e.title}</p>
          )}
          {e.description ? <p className="text-xs text-muted">{e.description}</p> : null}
          <p className="text-xs tabular-nums text-muted-light">{e.occurredLabel}</p>
        </li>
      ))}
    </ol>
  );
}
