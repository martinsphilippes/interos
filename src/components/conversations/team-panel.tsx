"use client";

import * as React from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { AlertTriangle, ChevronDown, MoreHorizontal, Undo2, UserRoundCheck, UsersRound } from "lucide-react";
import type { OperatorRow, QueueNow } from "@/server/conversations/supervision";
import type { OperatorState } from "@/domain/central-ops";
import { redistributeConversationAction, releaseOperatorAction } from "@/server/conversations/actions";
import { formatDurationShort } from "@/domain/conversation-history";
import { Checkbox } from "@/components/ui/checkbox";
import { ConfirmDialog } from "@/components/ui/confirm-dialog";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuLabel, DropdownMenuSeparator, DropdownMenuSub, DropdownMenuSubContent, DropdownMenuSubTrigger, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import { EmptyState } from "@/components/ui/empty-state";
import { IconTile } from "@/components/ui/icon-tile";
import { StatusDot, type StatusTone } from "@/components/ui/status-dot";
import { toast } from "@/components/ui/toast";
import { cn } from "@/lib/utils";
import { CHANNEL_LABELS, waitingLabel } from "./model";
import { CHANNEL_TONE, ChannelGlyph } from "./channel-icon";

/** Equipe agora (aba Equipe da Central): só o necessário para a tela. */
export interface CentralTeam {
  operators: OperatorRow[];
  queues: QueueNow[];
  bottlenecks: string[];
  waiting: number;
  oldestWaitingSince?: string;
}

const STATE_TONE: Record<OperatorState, StatusTone> = { disponivel: "success", ocupado: "warning", pausa: "secondary", ausente: "muted", offline: "muted" };

function initials(name: string): string {
  const parts = name.trim().split(/\s+/);
  return ((parts[0]?.[0] ?? "") + (parts.length > 1 ? parts[parts.length - 1][0] : "")).toUpperCase();
}

/**
 * Aba Equipe (gestor): quem está atendendo, em que estado, com quantas conversas e quais. Dá para abrir a conversa ao
 * lado, passar para outra pessoa, devolver para a fila e liberar um atendente (devolve tudo e tira da distribuição).
 */
export function TeamPanel({ team, selectedId, hrefFor, queueHref, now }: { team: CentralTeam; selectedId?: string; hrefFor: (conversationId: string) => string; queueHref: string; now: number }) {
  const router = useRouter();
  const [pending, startTransition] = React.useTransition();
  const [releasing, setReleasing] = React.useState<OperatorRow | null>(null);
  const [away, setAway] = React.useState(true);
  const [showAway, setShowAway] = React.useState(false);
  const [collapsed, setCollapsed] = React.useState<Set<string>>(new Set());

  const present = team.operators.filter((o) => (o.state !== "offline" && o.state !== "ausente") || o.load > 0);
  const gone = team.operators.filter((o) => !present.includes(o));
  const count = (s: OperatorState) => team.operators.filter((o) => o.state === s).length;
  const targets = (except: string) => team.operators.filter((o) => o.id !== except && (o.state === "disponivel" || o.state === "ocupado"));

  const move = (conversationId: string, target: { toUserId?: string; toQueue?: boolean }, name: string) =>
    startTransition(async () => {
      const r = await redistributeConversationAction({ conversationId, ...target });
      if (!r.ok) return void toast.error(r.error);
      // Devolver para a fila distribui na hora: diz para quem foi (ou que ficou esperando).
      const who = r.data.assigneeName?.split(" ")[0];
      toast.success(target.toUserId ? `${name} passou para ${who ?? "a pessoa escolhida"}` : who ? `${name} voltou para a fila e foi para ${who}` : `${name} está na fila esperando alguém livre`);
      router.refresh();
    });

  const release = async () => {
    if (!releasing) return;
    const r = await releaseOperatorAction({ operatorId: releasing.id, away });
    if (!r.ok) return void toast.error(r.error);
    toast.success(`${r.data.returned} conversa(s) de ${releasing.name.split(" ")[0]} voltaram para a fila${r.data.failed ? ` (${r.data.failed} não puderam voltar)` : ""}`);
    router.refresh();
  };

  const toggle = (id: string) => setCollapsed((s) => {
    const next = new Set(s);
    if (next.has(id)) next.delete(id);
    else next.add(id);
    return next;
  });

  const oldest = team.oldestWaitingSince ? waitingLabel(team.oldestWaitingSince, now) : null;

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <div className="grid shrink-0 grid-cols-4 gap-1.5 border-b border-border p-3 text-center">
        {[
          { label: "Livres", value: count("disponivel"), tone: "text-success-fg" },
          { label: "Ocupados", value: count("ocupado"), tone: "text-warning-fg" },
          { label: "Pausa", value: count("pausa"), tone: "text-muted" },
        ].map((k) => (
          <div key={k.label} className="rounded-lg bg-surface-muted px-1 py-1.5">
            <p className={cn("text-base font-semibold tabular-nums", k.tone)}>{k.value}</p>
            <p className="text-[10px] uppercase tracking-wide text-muted">{k.label}</p>
          </div>
        ))}
        <Link href={queueHref} scroll={false} className={cn("rounded-lg px-1 py-1.5 hover:bg-surface-hover", team.waiting ? "bg-warning-soft" : "bg-surface-muted")} title={oldest ? `Mais antigo esperando ${oldest}` : undefined}>
          <p className={cn("text-base font-semibold tabular-nums", team.waiting ? "text-warning-fg" : "text-muted")}>{team.waiting}</p>
          <p className="text-[10px] uppercase tracking-wide text-muted">Na fila</p>
        </Link>
      </div>
      {team.bottlenecks.length ? (
        <ul className="shrink-0 border-b border-border bg-danger-soft px-3 py-2 text-xs text-danger-fg">
          {team.bottlenecks.map((b) => (
            <li key={b} className="flex gap-1.5">
              <AlertTriangle className="mt-0.5 size-3.5 shrink-0" /> {b}
            </li>
          ))}
        </ul>
      ) : null}

      <div className="scrollbar-thin min-h-0 flex-1 overflow-y-auto p-3">
        {team.operators.length === 0 ? (
          <EmptyState size="sm" icon={<UsersRound />} title="Ninguém na equipe" description="Coloque pessoas nas filas em Canais e filas." />
        ) : (
          <ul className="flex flex-col gap-2.5">
            {present.map((o) => (
              <li key={o.id} className="rounded-xl border border-border bg-surface-muted">
                <div className="flex items-center gap-1.5 p-2.5 pr-1.5">
                  <button type="button" onClick={() => toggle(o.id)} className="flex min-w-0 flex-1 items-center gap-2 text-left" aria-expanded={!collapsed.has(o.id)} title={collapsed.has(o.id) ? "Mostrar as conversas" : "Esconder as conversas"}>
                    <span className="relative inline-flex size-9 shrink-0 items-center justify-center rounded-full bg-surface-hover text-xs font-semibold">
                      {initials(o.name)}
                      <span className="absolute -bottom-0.5 -right-0.5 rounded-full bg-surface p-0.5">
                        <StatusDot tone={STATE_TONE[o.state]} />
                      </span>
                    </span>
                    <span className="min-w-0 flex-1">
                      <span className="block truncate text-sm font-semibold">{o.name}</span>
                      <span className={cn("block truncate text-xs", o.pauseOverdue ? "font-medium text-warning-fg" : "text-muted")}>
                        {o.stateLabel}
                        {o.pauseLabel ? ` · ${o.pauseLabel}` : ""}
                        {o.minutes !== undefined ? ` · ${formatDurationShort(o.minutes * 60_000)}` : ""}
                      </span>
                    </span>
                    <span className="shrink-0 text-right">
                      <span className={cn("block text-sm font-semibold tabular-nums", o.load >= o.limit ? "text-warning-fg" : "text-foreground")}>
                        {o.load}/{o.limit}
                      </span>
                      <span className="mt-1 block h-1 w-9 overflow-hidden rounded-full bg-surface-hover">
                        <span className={cn("block h-full rounded-full", o.load >= o.limit ? "bg-warning" : "bg-brand")} style={{ width: `${Math.min(100, (o.load / Math.max(1, o.limit)) * 100)}%` }} />
                      </span>
                    </span>
                  </button>
                  <DropdownMenu>
                    <DropdownMenuTrigger asChild>
                      <button type="button" className="inline-flex size-7 shrink-0 items-center justify-center rounded-lg text-muted hover:bg-surface-hover" aria-label={`Ações de ${o.name}`}>
                        <MoreHorizontal className="size-4" />
                      </button>
                    </DropdownMenuTrigger>
                    <DropdownMenuContent align="end">
                      <DropdownMenuItem
                        disabled={o.load === 0}
                        onSelect={() => {
                          setAway(true);
                          setReleasing(o);
                        }}
                      >
                        <Undo2 /> Devolver atendimentos para a fila
                      </DropdownMenuItem>
                    </DropdownMenuContent>
                  </DropdownMenu>
                </div>
                {!collapsed.has(o.id) && o.conversations.length > 0 ? (
                  <ul className="flex flex-col gap-1 border-t border-border p-1.5">
                    {o.conversations.map((c) => {
                      const waiting = c.awaitingReply ? waitingLabel(c.waitingSince, now) : null;
                      const others = targets(o.id);
                      return (
                        <li key={c.id} className={cn("flex items-center gap-1 rounded-lg", c.id === selectedId ? "bg-brand-soft" : "hover:bg-surface-hover")}>
                          <Link href={hrefFor(c.id)} scroll={false} className="flex min-w-0 flex-1 items-center gap-2 px-2 py-1.5" aria-current={c.id === selectedId ? "true" : undefined}>
                            <span title={CHANNEL_LABELS[c.channel]}>
                              <IconTile icon={<ChannelGlyph channel={c.channel} />} tone={CHANNEL_TONE[c.channel]} size="sm" />
                            </span>
                            <span className="min-w-0">
                              <span className="block truncate text-[13px] font-medium">{c.name}</span>
                              <span className="block truncate text-[11px]">
                                {c.escalated ? <span className="font-semibold text-danger-fg">Prioridade · </span> : null}
                                {waiting ? (
                                  <span className="font-medium text-warning-fg" suppressHydrationWarning>
                                    espera resposta {waiting}
                                  </span>
                                ) : (
                                  <span className="text-muted">em dia</span>
                                )}
                              </span>
                            </span>
                          </Link>
                          <DropdownMenu>
                            <DropdownMenuTrigger asChild>
                              <button type="button" disabled={pending} className="mr-1 inline-flex size-8 shrink-0 items-center justify-center rounded-lg text-muted hover:bg-surface" aria-label={`Redistribuir ${c.name}`}>
                                <MoreHorizontal className="size-4" />
                              </button>
                            </DropdownMenuTrigger>
                            <DropdownMenuContent align="end" className="w-60">
                              <DropdownMenuLabel className="truncate">{c.name}</DropdownMenuLabel>
                              <DropdownMenuSub>
                                <DropdownMenuSubTrigger disabled={others.length === 0}>
                                  <UserRoundCheck /> Passar para…
                                </DropdownMenuSubTrigger>
                                <DropdownMenuSubContent className="w-56">
                                  {others.map((t) => (
                                    <DropdownMenuItem key={t.id} onSelect={() => move(c.id, { toUserId: t.id }, c.name)}>
                                      <StatusDot tone={STATE_TONE[t.state]} />
                                      <span className="min-w-0 flex-1 truncate">{t.name}</span>
                                      <span className="text-xs tabular-nums text-muted">
                                        {t.load}/{t.limit}
                                      </span>
                                    </DropdownMenuItem>
                                  ))}
                                </DropdownMenuSubContent>
                              </DropdownMenuSub>
                              <DropdownMenuSeparator />
                              <DropdownMenuItem onSelect={() => move(c.id, { toQueue: true }, c.name)}>
                                <Undo2 /> Devolver para a fila
                              </DropdownMenuItem>
                            </DropdownMenuContent>
                          </DropdownMenu>
                        </li>
                      );
                    })}
                  </ul>
                ) : null}
              </li>
            ))}
          </ul>
        )}
        {gone.length ? (
          <div className="mt-3">
            <button type="button" onClick={() => setShowAway((v) => !v)} className="flex w-full items-center gap-1 text-xs font-medium text-muted hover:text-foreground" aria-expanded={showAway}>
              <ChevronDown className={cn("size-3.5 transition-transform", !showAway && "-rotate-90")} /> Fora agora ({gone.length})
            </button>
            {showAway ? (
              <ul className="mt-2 flex flex-col gap-1">
                {gone.map((o) => (
                  <li key={o.id} className="flex items-center gap-2 px-1 text-sm text-muted">
                    <StatusDot tone={STATE_TONE[o.state]} /> <span className="truncate">{o.name}</span> <span className="ml-auto text-xs">{o.stateLabel}</span>
                  </li>
                ))}
              </ul>
            ) : null}
          </div>
        ) : null}
      </div>

      <ConfirmDialog
        open={releasing !== null}
        onOpenChange={(v) => !v && setReleasing(null)}
        title={releasing ? `Devolver as ${releasing.load} conversa(s) de ${releasing.name.split(" ")[0]}?` : ""}
        description="Cada conversa volta para a sua fila (com nota) e é distribuída entre quem está livre."
        confirmLabel="Devolver para a fila"
        onConfirm={release}
      >
        {releasing ? <Checkbox checked={away} onCheckedChange={(v) => setAway(v === true)} label={`Tirar ${releasing.name.split(" ")[0]} da distribuição (fica Ausente)`} description="Sem isso, ele pode receber conversas de novo na próxima distribuição." /> : null}
      </ConfirmDialog>
    </div>
  );
}
