/**
 * Blocos secundários do Meu Dia (server components de apresentação). Cada um recebe a fatia
 * pronta de MeuDiaData e renderiza dentro de um CollapsibleBlock (colapsável no celular).
 */
import Link from "next/link";
import { Check, FileSignature, MessageSquareReply, Ticket } from "lucide-react";
import { WORKFLOW_STEP_STATUS_LABELS, type WorkflowStepStatus } from "@/domain/constants";
import { Avatar } from "@/components/ui/avatar";
import { Badge } from "@/components/ui/badge";
import { Progress, type ProgressTone } from "@/components/ui/progress";
import { SlaBadge } from "@/components/ui/sla-badge";
import { StatusDot, type StatusTone } from "@/components/ui/status-dot";
import { NotificationsList } from "@/components/notifications/notifications-list";
import { formatCurrency, formatNumber, formatPercent } from "@/lib/format";
import { AgendaIcon, KindIcon } from "./kind-icon";
import { CollapsibleBlock } from "./collapsible-block";
import type { AgendaItem, AttentionClient, AwaitingItem, FollowupItem, GoalItem, NotificationItem, PendingContractItem, StepItem, TeamMember } from "./model";
import { cn } from "@/lib/utils";

function Empty({ children }: { children: React.ReactNode }) {
  return <p className="rounded-md bg-surface-muted px-3 py-4 text-center text-sm text-muted">{children}</p>;
}

function ClientLink({ id, name, className }: { id?: string; name?: string; className?: string }) {
  if (!name) return null;
  if (!id) return <span className={cn("truncate text-xs text-muted", className)}>{name}</span>;
  return (
    <Link href={`/clientes/${id}`} className={cn("truncate text-xs text-muted hover:text-foreground hover:underline", className)}>
      {name}
    </Link>
  );
}

// ---------------------------------------------------------------------------

export function AgendaBlock({ items }: { items: AgendaItem[] }) {
  return (
    <CollapsibleBlock title="Agenda de hoje" count={items.length} action={<Link href="/tarefas?view=calendario" className="font-medium text-brand hover:underline">Calendário</Link>}>
      {items.length === 0 ? (
        <Empty>Nada agendado para hoje.</Empty>
      ) : (
        <ul className="flex flex-col divide-y divide-border">
          {items.map((a) => (
            <li key={a.id} className="flex items-start gap-3 py-2.5 first:pt-0 last:pb-0">
              <span className={cn("w-11 shrink-0 pt-0.5 text-sm font-semibold tabular-nums", a.done ? "text-muted line-through" : "text-foreground")}>{a.timeLabel}</span>
              <span className={cn("mt-0.5 flex size-7 shrink-0 items-center justify-center rounded-md", a.done ? "bg-success-soft text-success-fg" : "bg-surface-hover text-muted")}>
                {a.done ? <Check className="size-4" aria-hidden /> : <AgendaIcon kind={a.kind} />}
              </span>
              <div className="min-w-0 flex-1">
                <Link href={a.href} className={cn("block truncate text-sm font-medium hover:text-brand hover:underline", a.done ? "text-muted line-through" : "text-foreground")}>
                  {a.title}
                </Link>
                <div className="flex flex-wrap items-center gap-x-2">
                  <ClientLink id={a.clientId} name={a.clientName} />
                  {a.assigneeName ? <span className="text-xs text-muted">· {a.assigneeName}</span> : null}
                </div>
              </div>
            </li>
          ))}
        </ul>
      )}
    </CollapsibleBlock>
  );
}

// ---------------------------------------------------------------------------

export function FollowupsBlock({ items }: { items: FollowupItem[] }) {
  return (
    <CollapsibleBlock title="Follow-ups" count={items.length} description="Próxima ação nos próximos 3 dias" action={<Link href="/vendas/oportunidades" className="font-medium text-brand hover:underline">Oportunidades</Link>}>
      {items.length === 0 ? (
        <Empty>Nenhum follow-up nos próximos 3 dias.</Empty>
      ) : (
        <ul className="flex flex-col divide-y divide-border">
          {items.map((f) => (
            <li key={f.id} className="flex items-start gap-3 py-2.5 first:pt-0 last:pb-0">
              <KindIcon kind={f.kind} className="size-7 [&_svg]:size-3.5" />
              <div className="min-w-0 flex-1">
                <Link href={f.href} className="block truncate text-sm font-medium text-foreground hover:text-brand hover:underline">
                  {f.title}
                </Link>
                <div className="flex flex-wrap items-center gap-x-2 text-xs text-muted">
                  {f.nextAction ? <span className="truncate">{f.nextAction}</span> : null}
                  {f.valueLabel ? <span>· {f.valueLabel}</span> : null}
                  {f.assigneeName ? <span>· {f.assigneeName}</span> : null}
                </div>
              </div>
              <span className={cn("shrink-0 text-xs font-medium tabular-nums", f.overdue ? "text-danger-fg" : "text-muted")}>{f.overdue ? `Vencido · ${f.nextActionLabel}` : f.nextActionLabel}</span>
            </li>
          ))}
        </ul>
      )}
    </CollapsibleBlock>
  );
}

// ---------------------------------------------------------------------------

export function StepsBlock({ items, team }: { items: StepItem[]; team: boolean }) {
  return (
    <CollapsibleBlock title={team ? "Etapas de workflow da equipe" : "Minhas etapas de workflow"} count={items.length} action={<Link href="/workflow" className="font-medium text-brand hover:underline">Workflow</Link>}>
      {items.length === 0 ? (
        <Empty>Nenhuma etapa atribuída no momento.</Empty>
      ) : (
        <ul className="flex flex-col divide-y divide-border">
          {items.slice(0, 12).map((s) => (
            <li key={s.id} className="flex items-start gap-3 py-2.5 first:pt-0 last:pb-0">
              <KindIcon kind="etapa" className="size-7 [&_svg]:size-3.5" />
              <div className="min-w-0 flex-1">
                <Link href={s.href} className="block truncate text-sm font-medium text-foreground hover:text-brand hover:underline">
                  {s.stageName} · {s.clientName}
                </Link>
                <div className="mt-1 flex flex-wrap items-center gap-1.5 text-xs text-muted">
                  <Badge variant={s.status === "aguardando_aprovacao" ? "warning" : s.status === "aguardando_cliente" ? "muted" : "info"} size="sm">
                    {WORKFLOW_STEP_STATUS_LABELS[s.status as WorkflowStepStatus] ?? s.status}
                  </Badge>
                  {s.sla ? <SlaBadge state={s.sla.state} remainingMs={s.sla.remainingMs} /> : <span>Sem SLA</span>}
                  {s.checklistTotal > 0 ? <span className="tabular-nums">Checklist {s.checklistDone}/{s.checklistTotal}</span> : null}
                  {s.assigneeName ? <span>· {s.assigneeName}</span> : null}
                </div>
              </div>
            </li>
          ))}
          {items.length > 12 ? (
            <li className="pt-2 text-center text-sm">
              <Link href="/workflow" className="font-medium text-brand hover:underline">
                Ver todas as {items.length} etapas
              </Link>
            </li>
          ) : null}
        </ul>
      )}
    </CollapsibleBlock>
  );
}

// ---------------------------------------------------------------------------

const HEALTH_TONE: Record<string, StatusTone> = { risco: "danger", atencao: "warning", saudavel: "success" };

export function AttentionClientsBlock({ items, total }: { items: AttentionClient[]; total: number }) {
  return (
    <CollapsibleBlock title="Clientes que precisam de atenção" count={total} action={<Link href="/cs/riscos" className="font-medium text-brand hover:underline">Riscos</Link>}>
      {items.length === 0 ? (
        <Empty>Nenhum cliente da sua carteira em risco ou com checkpoint vencido.</Empty>
      ) : (
        <ul className="flex flex-col divide-y divide-border">
          {items.map((c) => (
            <li key={c.id} className="flex items-start gap-3 py-2.5 first:pt-0 last:pb-0">
              <span className="mt-1.5">
                <StatusDot tone={c.healthLevel ? HEALTH_TONE[c.healthLevel] : "muted"} pulse={c.healthLevel === "risco"} />
              </span>
              <div className="min-w-0 flex-1">
                <div className="flex items-center gap-2">
                  <Link href={c.href} className="truncate text-sm font-medium text-foreground hover:text-brand hover:underline">
                    {c.tradeName}
                  </Link>
                  {c.healthScore !== undefined ? <span className="shrink-0 text-xs tabular-nums text-muted">saúde {c.healthScore}</span> : null}
                </div>
                <p className={cn("truncate text-xs", c.tone === "danger" ? "text-danger-fg" : c.tone === "warning" ? "text-warning-fg" : "text-muted")}>{c.reason}</p>
                {c.ownerName ? <p className="text-xs text-muted">{c.ownerName}</p> : null}
              </div>
              <span className="shrink-0 text-xs tabular-nums text-muted">{c.mrr > 0 ? `MRR ${formatCurrency(c.mrr, true)}` : "—"}</span>
            </li>
          ))}
        </ul>
      )}
    </CollapsibleBlock>
  );
}

// ---------------------------------------------------------------------------

function formatGoalValue(value: number, unit: GoalItem["unit"]): string {
  switch (unit) {
    case "moeda":
      return formatCurrency(value, Math.abs(value) >= 10_000);
    case "percentual":
      return formatPercent(value);
    case "horas":
      return `${formatNumber(value)} h`;
    case "dias":
      return `${formatNumber(value)} d`;
    default:
      return formatNumber(value);
  }
}

function goalTone(attainment: number | null): ProgressTone {
  if (attainment === null) return "secondary";
  if (attainment >= 1) return "success";
  if (attainment >= 0.85) return "warning";
  return "danger";
}

export function GoalsBlock({ items }: { items: GoalItem[] }) {
  return (
    <CollapsibleBlock title="Metas do mês" count={items.length} action={<Link href="/performance/metas" className="font-medium text-brand hover:underline">Metas</Link>}>
      {items.length === 0 ? (
        <Empty>Nenhuma meta cadastrada para você neste mês.</Empty>
      ) : (
        <ul className="flex flex-col gap-3">
          {items.map((g) => {
            const pct = g.attainment === null ? 0 : Math.min(100, Math.round(g.attainment * 100));
            return (
              <li key={g.id}>
                <div className="flex items-baseline justify-between gap-2">
                  {g.href ? (
                    <Link href={g.href} className="min-w-0 truncate text-sm font-medium text-foreground hover:text-brand hover:underline">
                      {g.name} <span className="text-xs font-normal text-muted">· {g.scopeLabel}</span>
                    </Link>
                  ) : (
                    <span className="min-w-0 truncate text-sm font-medium text-foreground">
                      {g.name} <span className="text-xs font-normal text-muted">· {g.scopeLabel}</span>
                    </span>
                  )}
                  <span className="shrink-0 text-xs tabular-nums text-muted">
                    {g.value === null ? "Sem dados" : `${formatGoalValue(g.value, g.unit)} / ${formatGoalValue(g.target, g.unit)}`}
                  </span>
                </div>
                <div className="mt-1 flex items-center gap-2">
                  <Progress value={pct} tone={goalTone(g.attainment)} size="sm" className="flex-1" aria-label={`${g.name}: ${pct}% da meta`} />
                  <span className={cn("w-12 shrink-0 text-right text-xs font-semibold tabular-nums", g.attainment === null ? "text-muted" : g.attainment >= 1 ? "text-success-fg" : g.attainment >= 0.85 ? "text-warning-fg" : "text-danger-fg")}>
                    {g.attainment === null ? "—" : `${Math.round(g.attainment * 100)}%`}
                  </span>
                </div>
                {g.direction === "menor_melhor" ? <p className="mt-0.5 text-[11px] text-muted-light">Quanto menor, melhor{g.source === "calculado" ? " · calculado" : ""}</p> : g.source === "calculado" ? <p className="mt-0.5 text-[11px] text-muted-light">Calculado a partir dos registros do mês</p> : null}
              </li>
            );
          })}
        </ul>
      )}
    </CollapsibleBlock>
  );
}

// ---------------------------------------------------------------------------

export function NotificationsBlock({ items, unreadTotal }: { items: NotificationItem[]; unreadTotal: number }) {
  return (
    <CollapsibleBlock title="Notificações recentes" count={unreadTotal} description="Não lidas" action={<Link href="/notificacoes" className="font-medium text-brand hover:underline">Central</Link>}>
      <NotificationsList items={items} variant="compact" emptyTitle="Nenhuma notificação não lida" />
    </CollapsibleBlock>
  );
}

// ---------------------------------------------------------------------------

function loadTone(load: number): ProgressTone {
  if (load >= 1.5) return "danger";
  if (load >= 1.15) return "warning";
  return "success";
}

export function TeamBlock({ members }: { members: TeamMember[] }) {
  return (
    <CollapsibleBlock title="Minha equipe" count={members.length} description="Carga = tarefas abertas em relação à média da equipe" action={<Link href="/tarefas?view=equipe" className="font-medium text-brand hover:underline">Tarefas da equipe</Link>} className="md:col-span-2">
      {members.length === 0 ? (
        <Empty>Nenhum colaborador vinculado a você.</Empty>
      ) : (
        <>
          {/* Desktop: tabela · Mobile: cards */}
          <div className="hidden md:block">
            <table className="w-full text-sm">
              <thead>
                <tr className="text-left text-xs font-semibold uppercase tracking-wide text-muted">
                  <th className="pb-2 pr-3 font-semibold">Colaborador</th>
                  <th className="pb-2 pr-3 text-right font-semibold">Abertas</th>
                  <th className="pb-2 pr-3 text-right font-semibold">Atrasadas</th>
                  <th className="pb-2 pr-3 text-right font-semibold">SLAs em risco</th>
                  <th className="pb-2 font-semibold">Carga</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-border">
                {members.map((m) => (
                  <tr key={m.id} className="hover:bg-surface-hover">
                    <td className="py-2 pr-3">
                      <Link href={m.href} className="flex items-center gap-2 hover:underline">
                        <Avatar name={m.name} src={m.avatarUrl} size="sm" />
                        <span className="flex min-w-0 flex-col leading-tight">
                          <span className="truncate font-medium text-foreground">{m.name}</span>
                          {m.jobTitle ? <span className="truncate text-xs text-muted">{m.jobTitle}</span> : null}
                        </span>
                      </Link>
                    </td>
                    <td className="py-2 pr-3 text-right tabular-nums">{m.openTasks}</td>
                    <td className={cn("py-2 pr-3 text-right tabular-nums", m.overdueTasks > 0 && "font-semibold text-danger-fg")}>{m.overdueTasks}</td>
                    <td className={cn("py-2 pr-3 text-right tabular-nums", m.slaRisk > 0 && "font-semibold text-danger-fg")}>{m.slaRisk}</td>
                    <td className="py-2">
                      <div className="flex items-center gap-2">
                        <Progress value={Math.min(100, m.load * 50)} tone={loadTone(m.load)} size="sm" className="w-28" aria-label={`Carga ${m.load.toFixed(1)}x`} />
                        <span className="w-10 text-xs tabular-nums text-muted">{m.load.toFixed(1)}x</span>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <ul className="flex flex-col gap-2 md:hidden">
            {members.map((m) => (
              <li key={m.id} className="rounded-lg border border-border p-3">
                <Link href={m.href} className="flex items-center gap-2">
                  <Avatar name={m.name} src={m.avatarUrl} size="sm" />
                  <span className="flex min-w-0 flex-col leading-tight">
                    <span className="truncate text-sm font-medium text-foreground">{m.name}</span>
                    {m.jobTitle ? <span className="truncate text-xs text-muted">{m.jobTitle}</span> : null}
                  </span>
                  <span className="ml-auto text-xs tabular-nums text-muted">{m.load.toFixed(1)}x</span>
                </Link>
                <div className="mt-2 grid grid-cols-3 gap-2 text-center text-xs">
                  <span className="rounded-md bg-surface-muted py-1"><strong className="block text-sm tabular-nums text-foreground">{m.openTasks}</strong>abertas</span>
                  <span className={cn("rounded-md bg-surface-muted py-1", m.overdueTasks > 0 && "bg-danger-soft text-danger-fg")}><strong className="block text-sm tabular-nums">{m.overdueTasks}</strong>atrasadas</span>
                  <span className={cn("rounded-md bg-surface-muted py-1", m.slaRisk > 0 && "bg-danger-soft text-danger-fg")}><strong className="block text-sm tabular-nums">{m.slaRisk}</strong>SLA</span>
                </div>
              </li>
            ))}
          </ul>
        </>
      )}
    </CollapsibleBlock>
  );
}

// ---------------------------------------------------------------------------

const AWAITING_KIND_LABEL: Record<AwaitingItem["kind"], string> = { lead: "Lead", oportunidade: "Oportunidade", cliente: "Cliente", chamado: "Chamado" };

/** Clientes/leads esperando resposta: mensagem recebida sem retorno ou chamado com a última fala do cliente. */
export function AwaitingBlock({ items }: { items: AwaitingItem[] }) {
  return (
    <CollapsibleBlock title="Aguardando seu retorno" count={items.length} description="Mensagens recebidas sem resposta e chamados com retorno do cliente" action={<Link href="/marketing/caixa-de-entrada" className="font-medium text-brand hover:underline">Caixa de entrada</Link>}>
      {items.length === 0 ? (
        <Empty>Ninguém aguardando retorno. Tudo respondido.</Empty>
      ) : (
        <ul className="flex flex-col divide-y divide-border">
          {items.slice(0, 8).map((a) => (
            <li key={a.id} className="flex items-start gap-3 py-2.5 first:pt-0 last:pb-0">
              <span className="mt-0.5 flex size-7 shrink-0 items-center justify-center rounded-md bg-warning-soft text-warning-fg [&_svg]:size-3.5" aria-hidden>
                {a.kind === "chamado" ? <Ticket /> : <MessageSquareReply />}
              </span>
              <div className="min-w-0 flex-1">
                <Link href={a.href} className="block truncate text-sm font-medium text-foreground hover:text-brand hover:underline">
                  {a.title}
                </Link>
                <p className="truncate text-xs text-muted">
                  {AWAITING_KIND_LABEL[a.kind]} · {a.channel}
                  {a.excerpt ? ` · “${a.excerpt}”` : ""}
                  {a.assigneeName ? ` · ${a.assigneeName}` : ""}
                </p>
              </div>
              <span className="shrink-0 text-xs tabular-nums text-warning-fg">{a.receivedLabel}</span>
            </li>
          ))}
        </ul>
      )}
    </CollapsibleBlock>
  );
}

/** Contratos parados no Financeiro sob responsabilidade do usuário (ou da equipe). */
export function ContractsBlock({ items }: { items: PendingContractItem[] }) {
  if (items.length === 0) return null;
  return (
    <CollapsibleBlock title="Contratos pendentes" count={items.length} description="Aguardando contrato, assinatura, pagamento ou com pendência" action={<Link href="/financeiro/contratos" className="font-medium text-brand hover:underline">Contratos</Link>}>
      <ul className="flex flex-col divide-y divide-border">
        {items.map((c) => (
          <li key={c.id} className="flex items-start gap-3 py-2.5 first:pt-0 last:pb-0">
            <span className="mt-0.5 flex size-7 shrink-0 items-center justify-center rounded-md bg-accent-purple-soft text-accent-purple-fg [&_svg]:size-3.5" aria-hidden>
              <FileSignature />
            </span>
            <div className="min-w-0 flex-1">
              <Link href={c.href} className="block truncate text-sm font-medium text-foreground hover:text-brand hover:underline">
                {c.number}
                {c.clientName ? <span className="font-normal text-muted"> · {c.clientName}</span> : null}
              </Link>
              <div className="mt-0.5 flex flex-wrap items-center gap-1.5 text-xs text-muted">
                <Badge variant={c.status === "pendencia" ? "danger" : "warning"} size="sm">
                  {c.statusLabel}
                </Badge>
                {c.detail ? <span className="truncate">{c.detail}</span> : null}
                {c.monthlyTotal > 0 ? <span>· {formatCurrency(c.monthlyTotal)}/mês</span> : null}
              </div>
            </div>
            <span className="shrink-0 text-xs text-muted">{c.sinceLabel}</span>
          </li>
        ))}
      </ul>
    </CollapsibleBlock>
  );
}
