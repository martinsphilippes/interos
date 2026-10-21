"use client";

import * as React from "react";
import Link from "next/link";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { Inbox, MessagesSquare, UserRound, UsersRound } from "lucide-react";
import type { CentralOverview, ConversationRow } from "@/server/conversations/queries";
import { formatDate, formatTime, dateKey } from "@/lib/format";
import { EmptyState } from "@/components/ui/empty-state";
import { IconTile } from "@/components/ui/icon-tile";
import { SearchInput } from "@/components/ui/search-input";
import { Select } from "@/components/ui/select";
import { SlaBadge } from "@/components/ui/sla-badge";
import { cn } from "@/lib/utils";
import { CENTRAL_TAB_LABELS, CENTRAL_TAB_ORDER, CHANNEL_LABELS, waitingLabel } from "./model";
import { CHANNEL_TONE, ChannelGlyph } from "./channel-icon";
import { TeamPanel, type CentralTeam } from "./team-panel";

export interface ConversationListProps {
  overview: CentralOverview;
  selectedId?: string;
  now: number;
  className?: string;
  /** Gestor: alterna entre as conversas e a equipe (atendentes e o que cada um atende). */
  teamEnabled?: boolean;
  /** Equipe agora (só quando a aba Equipe está aberta). */
  team?: CentralTeam | null;
}

/** Monta o link mantendo os filtros atuais e trocando só o que foi pedido. */
function useHref() {
  const pathname = usePathname();
  const params = useSearchParams();
  return React.useCallback(
    (changes: Record<string, string | undefined>) => {
      const next = new URLSearchParams(params.toString());
      for (const [k, v] of Object.entries(changes)) {
        if (v) next.set(k, v);
        else next.delete(k);
      }
      const qs = next.toString();
      return `${pathname}${qs ? `?${qs}` : ""}`;
    },
    [pathname, params],
  );
}

function Row({ row, selected, href, now }: { row: ConversationRow; selected: boolean; href: string; now: number }) {
  const today = dateKey(new Date(now).toISOString());
  const waiting = row.awaitingReply ? waitingLabel(row.waitingSince, now) : null;
  const slaRemaining = row.sla ? new Date(row.sla.dueAt).getTime() - now : undefined;
  return (
    <Link
      href={href}
      scroll={false}
      aria-current={selected ? "true" : undefined}
      className={cn(
        "flex flex-col gap-1.5 rounded-xl border p-3 transition-colors",
        selected ? "border-brand bg-brand-soft" : "border-border bg-surface-muted hover:border-border-strong hover:bg-surface-hover",
      )}
    >
      <div className="flex items-start justify-between gap-2">
        <div className="flex min-w-0 items-center gap-2">
          <span title={CHANNEL_LABELS[row.channel]}>
            <IconTile icon={<ChannelGlyph channel={row.channel} />} tone={CHANNEL_TONE[row.channel]} size="sm" />
            <span className="sr-only">{CHANNEL_LABELS[row.channel]}</span>
          </span>
          <div className="min-w-0">
            <p className="truncate text-sm font-semibold text-foreground">{row.name}</p>
            <p className="truncate text-xs text-muted">{row.subtitle}</p>
          </div>
        </div>
        <span className="shrink-0 text-[11px] tabular-nums text-muted" suppressHydrationWarning>
          {dateKey(row.lastMessageAt) === today ? formatTime(row.lastMessageAt) : formatDate(row.lastMessageAt, "dd/MM HH:mm")}
        </span>
      </div>
      {row.preview ? (
        <p className={cn("line-clamp-2 text-[13px]", row.awaitingReply ? "text-foreground" : "text-muted")}>
          {row.lastMessageDirection === "saida" ? <span className="text-muted">Você: </span> : null}
          {row.preview}
        </p>
      ) : null}
      <div className="flex flex-wrap items-center gap-x-2 gap-y-1 text-[11px]">
        {row.escalated ? <span className="rounded bg-danger-soft px-1.5 py-0.5 font-semibold text-danger-fg">Prioridade</span> : null}
        {waiting ? (
          <span className="font-medium text-warning-fg" suppressHydrationWarning>
            espera resposta {waiting}
          </span>
        ) : (
          <span className="text-muted">{row.statusLabel}</span>
        )}
        {row.sla ? <SlaBadge state={row.sla.state} remainingMs={slaRemaining} timeOnly /> : null}
        {row.channel === "whatsapp" && !row.windowOpen ? <span className="text-muted" title="Passou de 24 h desde a última mensagem do cliente">janela fechada</span> : null}
        <span className="ml-auto inline-flex items-center gap-1 text-muted">
          {row.assigneeName ? (
            <>
              <UserRound className="size-3" aria-hidden />
              {row.assigneeName.split(" ")[0]}
            </>
          ) : (
            <span className="text-warning-fg">{row.queueName ? `fila ${row.queueName}` : "sem fila"}</span>
          )}
        </span>
      </div>
    </Link>
  );
}

/**
 * Coluna da esquerda: abas (Minhas, Na fila, Aguardando cliente, Todas), filtros de fila/canal, busca e a lista. Quem
 * espera resposta vem primeiro, o mais antigo no topo.
 */
export function ConversationList({ overview, selectedId, now, className, teamEnabled, team }: ConversationListProps) {
  const router = useRouter();
  const params = useSearchParams();
  const href = useHref();
  const [q, setQ] = React.useState(params.get("q") ?? "");

  const onSearch = (value: string) => {
    setQ(value);
    router.replace(href({ q: value.trim() || undefined, conversa: undefined }), { scroll: false });
  };

  const switcher = teamEnabled ? (
    <div className="flex shrink-0 gap-1 border-b border-border p-2" role="tablist" aria-label="Ver">
      {[
        { key: "conversas", label: "Conversas", icon: <MessagesSquare className="size-4" />, href: href({ painel: undefined }) },
        { key: "equipe", label: "Equipe", icon: <UsersRound className="size-4" />, href: href({ painel: "equipe" }) },
      ].map((t) => {
        const active = (team ? "equipe" : "conversas") === t.key;
        return (
          <Link key={t.key} role="tab" aria-selected={active} href={t.href} scroll={false} className={cn("inline-flex min-h-[36px] flex-1 items-center justify-center gap-1.5 rounded-lg text-xs font-semibold transition-colors", active ? "bg-brand-soft text-brand-fg" : "text-muted hover:bg-surface-hover hover:text-foreground")}>
            {t.icon} {t.label}
          </Link>
        );
      })}
    </div>
  ) : null;

  if (team) {
    return (
      <section className={cn("flex min-h-0 flex-col overflow-hidden rounded-xl border border-border bg-surface shadow-card", className)} aria-label="Equipe">
        {switcher}
        <TeamPanel team={team} selectedId={selectedId} now={now} hrefFor={(id) => href({ conversa: id })} queueHref={href({ painel: undefined, ver: "fila", conversa: undefined })} />
      </section>
    );
  }

  return (
    <section className={cn("flex min-h-0 flex-col overflow-hidden rounded-xl border border-border bg-surface shadow-card", className)} aria-label="Conversas">
      {switcher}
      <div role="tablist" aria-label="Filtrar conversas" className="scrollbar-none flex shrink-0 gap-1 overflow-x-auto border-b border-border px-3 pt-2">
        {CENTRAL_TAB_ORDER.map((t) => (
          <Link
            key={t}
            role="tab"
            aria-selected={overview.tab === t}
            href={href({ ver: t, conversa: undefined })}
            scroll={false}
            className={cn(
              "-mb-px inline-flex min-h-[40px] shrink-0 items-center gap-1 whitespace-nowrap border-b-2 px-2 text-xs font-medium transition-colors",
              overview.tab === t ? "border-brand text-brand-fg" : "border-transparent text-muted hover:text-foreground",
            )}
          >
            {CENTRAL_TAB_LABELS[t]}
            <span className={cn("rounded px-1 text-[10px] tabular-nums", overview.tab === t ? "bg-brand-soft text-brand-fg" : "bg-surface-hover text-muted")}>{overview.counts[t]}</span>
          </Link>
        ))}
      </div>
      <div className="flex shrink-0 flex-col gap-2 border-b border-border p-3">
        <SearchInput value={q} onChange={onSearch} debounceMs={350} placeholder="Nome, telefone ou texto…" aria-label="Buscar conversa" />
        <div className="grid grid-cols-2 gap-2">
          <Select
            aria-label="Fila"
            size="sm"
            value={params.get("filaId") ?? ""}
            onChange={(e) => router.replace(href({ filaId: e.target.value || undefined, conversa: undefined }), { scroll: false })}
            options={[{ value: "", label: "Todas as filas" }, ...overview.queues.map((qq) => ({ value: qq.id, label: qq.waiting ? `${qq.name} (${qq.waiting})` : qq.name }))]}
          />
          <Select
            aria-label="Canal"
            size="sm"
            value={params.get("canal") ?? ""}
            onChange={(e) => router.replace(href({ canal: e.target.value || undefined, conversa: undefined }), { scroll: false })}
            options={[
              { value: "", label: "Todos os canais" },
              ...Object.entries(CHANNEL_LABELS).map(([value, label]) => ({ value, label })),
            ]}
          />
        </div>
      </div>
      <div className="scrollbar-thin min-h-0 flex-1 overflow-y-auto p-3">
        {overview.rows.length === 0 ? (
          <EmptyState
            icon={<Inbox />}
            size="sm"
            title={overview.tab === "fila" ? "Ninguém esperando na fila" : "Nenhuma conversa aqui"}
            description={overview.tab === "minhas" && overview.counts.fila > 0 ? `${overview.counts.fila} conversa(s) esperando na fila.` : "Novas mensagens dos clientes aparecem aqui assim que chegam."}
          />
        ) : (
          <ul className="flex flex-col gap-2.5">
            {overview.rows.map((row) => (
              <li key={row.id}>
                <Row row={row} selected={row.id === selectedId} href={href({ conversa: row.id })} now={now} />
              </li>
            ))}
          </ul>
        )}
      </div>
      <footer className="border-t border-border px-4 py-2.5 text-xs text-muted">
        {overview.rows.length} conversa{overview.rows.length === 1 ? "" : "s"} nesta aba
        {overview.counts.fila > 0 && overview.tab !== "fila" ? (
          <>
            {" · "}
            <Link href={href({ ver: "fila", conversa: undefined })} className="font-medium text-warning-fg hover:underline">
              {overview.counts.fila} na fila
            </Link>
          </>
        ) : null}
      </footer>
    </section>
  );
}
