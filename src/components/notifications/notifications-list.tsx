"use client";

import * as React from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { Check, Inbox, Trash2 } from "lucide-react";
import { toast } from "@/components/ui/toast";
import { Button } from "@/components/ui/button";
import { EmptyState } from "@/components/ui/empty-state";
import { deleteNotification, markRead } from "@/server/notifications/actions";
import { groupByDay, type NotificationItem } from "./model";
import { NotificationIcon } from "./notification-icon";
import { cn } from "@/lib/utils";

export interface NotificationsListProps {
  items: NotificationItem[];
  /** "compact": lista curta do Meu Dia · "full": página de notificações (agrupada por dia, com excluir). */
  variant?: "compact" | "full";
  emptyTitle?: string;
  emptyDescription?: string;
  className?: string;
}

/**
 * Lista de notificações. Clicar marca como lida e navega para o href; o botão "marcar como lida"
 * só marca. Atualiza a tela com router.refresh() após a action.
 */
export function NotificationsList({ items, variant = "full", emptyTitle = "Nenhuma notificação", emptyDescription, className }: NotificationsListProps) {
  const router = useRouter();
  const [pending, startTransition] = React.useTransition();
  const [busyId, setBusyId] = React.useState<string | null>(null);

  const run = (id: string, fn: () => Promise<{ ok: boolean; error?: string }>, after?: () => void) => {
    setBusyId(id);
    startTransition(async () => {
      const result = await fn();
      setBusyId(null);
      if (!result.ok) {
        toast.error(result.error ?? "Não foi possível concluir");
        return;
      }
      after?.();
      router.refresh();
    });
  };

  const open = (n: NotificationItem) => {
    if (n.readAt) {
      if (n.href) router.push(n.href);
      return;
    }
    run(n.id, () => markRead(n.id), () => {
      if (n.href) router.push(n.href);
    });
  };

  if (items.length === 0) {
    return <EmptyState icon={<Inbox />} title={emptyTitle} description={emptyDescription} size={variant === "compact" ? "sm" : "md"} />;
  }

  const renderItem = (n: NotificationItem) => {
    const unread = !n.readAt;
    const busy = busyId === n.id && pending;
    return (
      <li key={n.id} className={cn("group flex items-start gap-3 rounded-lg px-2 py-2.5 transition-colors hover:bg-surface-hover", unread && "bg-brand-soft/30")}>
        <NotificationIcon kind={n.kind} size={variant === "compact" ? "sm" : "md"} className="mt-0.5" />
        <div className="min-w-0 flex-1">
          <button type="button" onClick={() => open(n)} disabled={busy} className="block w-full min-h-[44px] text-left md:min-h-0" aria-label={`${n.title}${unread ? " (não lida)" : ""}`}>
            <span className={cn("block text-sm leading-snug", unread ? "font-semibold text-foreground" : "text-foreground")}>{n.title}</span>
            {n.body && variant === "full" ? <span className="mt-0.5 block text-xs text-muted">{n.body}</span> : null}
            <span className="mt-0.5 flex items-center gap-1.5 text-xs text-muted">
              {unread ? <span className="size-1.5 rounded-full bg-brand" aria-hidden /> : null}
              <span title={`${n.dayLabel}, ${n.timeLabel}`}>{variant === "compact" ? n.relativeLabel : `${n.timeLabel} · ${n.relativeLabel}`}</span>
            </span>
          </button>
        </div>
        <div className="flex shrink-0 items-center gap-0.5">
          {unread ? (
            <Button variant="ghost" size="icon" className="size-9 text-muted md:size-8" title="Marcar como lida" aria-label="Marcar como lida" loading={busy} onClick={() => run(n.id, () => markRead(n.id))}>
              <Check />
            </Button>
          ) : null}
          {variant === "full" ? (
            <Button variant="ghost" size="icon" className="size-9 text-muted hover:text-danger md:size-8" title="Excluir" aria-label="Excluir notificação" disabled={busy} onClick={() => run(n.id, () => deleteNotification(n.id), () => toast.success("Notificação excluída"))}>
              <Trash2 />
            </Button>
          ) : null}
        </div>
      </li>
    );
  };

  if (variant === "compact") {
    return (
      <div className={className}>
        <ul className="-mx-2 flex flex-col">{items.map(renderItem)}</ul>
        <div className="mt-2 border-t border-border pt-2 text-right">
          <Link href="/notificacoes" className="text-sm font-medium text-brand hover:underline">
            Ver todas
          </Link>
        </div>
      </div>
    );
  }

  return (
    <div className={cn("flex flex-col gap-5", className)}>
      {groupByDay(items).map((group) => (
        <section key={group.dayKey} aria-label={group.dayLabel}>
          <h2 className="label-caps mb-1.5 px-2">{group.dayLabel}</h2>
          <ul className="flex flex-col">{group.items.map(renderItem)}</ul>
        </section>
      ))}
    </div>
  );
}
