"use client";

import * as React from "react";
import Link from "next/link";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { Download, ExternalLink, RotateCcw, UserRound } from "lucide-react";
import { exportHistoryAction, reopenConversationAction } from "@/server/conversations/actions";
import type { HistoryFilters, HistoryPreview, HistoryResult, HistoryRow } from "@/server/conversations/history";
import { CONVERSATION_CLOSE_REASONS } from "@/domain/types";
import { CLOSE_REASON_LABELS } from "@/domain/conversations";
import { HISTORY_PERIODS, formatDurationShort, highlightParts } from "@/domain/conversation-history";
import { formatDateTime } from "@/lib/format";
import { cn } from "@/lib/utils";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { EmptyState } from "@/components/ui/empty-state";
import { FilterBar, FilterField } from "@/components/ui/filter-bar";
import { SearchInput } from "@/components/ui/search-input";
import { Select } from "@/components/ui/select";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { toast } from "@/components/ui/toast";
import { CHANNEL_LABELS } from "./model";
import { ChannelGlyph } from "./channel-icon";

const PARAM: Record<string, string> = { q: "q", channel: "canal", queueId: "filaId", assigneeId: "operador", reason: "motivo", sla: "sla", days: "dias" };

function Highlight({ text, term }: { text: string; term?: string }) {
  if (!term) return <>{text}</>;
  return (
    <>
      {highlightParts(text, term).map((p, i) =>
        p.match ? (
          <mark key={i} className="rounded bg-brand/25 px-0.5 text-inherit">
            {p.text}
          </mark>
        ) : (
          <React.Fragment key={i}>{p.text}</React.Fragment>
        ),
      )}
    </>
  );
}

function ChannelLabel({ channel }: { channel: HistoryRow["channel"] }) {
  return (
    <span className="inline-flex items-center gap-1.5 whitespace-nowrap text-sm">
      <ChannelGlyph channel={channel} colored className="size-4" />
      {CHANNEL_LABELS[channel]}
    </span>
  );
}

/**
 * Histórico de atendimentos: filtros (na URL), tabela das encerradas e prévia da conversa escolhida com reabrir,
 * abrir na Central e abrir o Cliente 360. A busca destaca o termo na prévia.
 */
export function HistoryView({ data, filters, preview, canExport }: { data: HistoryResult; filters: HistoryFilters; preview: HistoryPreview | null; canExport: boolean }) {
  const router = useRouter();
  const pathname = usePathname();
  const sp = useSearchParams();
  const [pending, startTransition] = React.useTransition();
  const [exporting, startExport] = React.useTransition();
  const term = filters.q;
  const previewRef = React.useRef<HTMLElement>(null);

  const setParam = (key: keyof typeof PARAM, value: string) => {
    const next = new URLSearchParams(sp.toString());
    if (value) next.set(PARAM[key], value);
    else next.delete(PARAM[key]);
    next.delete("ver");
    router.replace(`${pathname}${next.toString() ? `?${next.toString()}` : ""}`, { scroll: false });
  };

  const select = (id: string) => {
    const next = new URLSearchParams(sp.toString());
    next.set("ver", id);
    router.replace(`${pathname}?${next.toString()}`, { scroll: false });
    // No celular a prévia fica embaixo da lista.
    if (window.matchMedia("(max-width: 1279px)").matches) setTimeout(() => previewRef.current?.scrollIntoView({ behavior: "smooth", block: "start" }), 300);
  };

  const exportCsv = () =>
    startExport(async () => {
      const r = await exportHistoryAction({ ...filters });
      if (!r.ok) return void toast.error(r.error);
      const url = URL.createObjectURL(new Blob([r.data.csv], { type: "text/csv;charset=utf-8" }));
      const a = document.createElement("a");
      a.href = url;
      a.download = r.data.filename;
      a.click();
      URL.revokeObjectURL(url);
      if (r.data.truncated) toast.warning("Exportadas as 5.000 mais recentes. Use os filtros para o restante.");
    });

  const reopen = (id: string) =>
    startTransition(async () => {
      const r = await reopenConversationAction({ conversationId: id });
      if (!r.ok) return void toast.error(r.error);
      toast.success(r.data.assigned ? "Atendimento reaberto" : "Atendimento reaberto e colocado na fila");
      router.push(`/comunicacao?conversa=${r.data.id}`);
    });

  const active = Object.entries(filters).filter(([k, v]) => k !== "days" && v).length > 0 || filters.days !== 30;

  return (
    <div className="flex flex-col gap-4">
      <FilterBar
        className="mb-0"
        actions={
          <>
            {active ? (
              <Button variant="ghost" onClick={() => router.replace(pathname, { scroll: false })}>
                Limpar filtros
              </Button>
            ) : null}
            {canExport ? (
              <Button variant="outline" onClick={exportCsv} loading={exporting} disabled={data.rows.length === 0}>
                <Download /> Exportar CSV
              </Button>
            ) : null}
          </>
        }
      >
        <FilterField label="Buscar" htmlFor="h-q" className="min-w-[240px] flex-[2]">
          <SearchInput id="h-q" value={filters.q ?? ""} onChange={(v) => setParam("q", v)} debounceMs={450} placeholder="Cliente, telefone, e-mail ou texto da conversa" />
        </FilterField>
        <FilterField label="Canal" htmlFor="h-canal">
          <Select
            id="h-canal"
            value={filters.channel ?? ""}
            onChange={(e) => setParam("channel", e.target.value)}
            options={[
              { value: "", label: "Todos" },
              ...Object.entries(CHANNEL_LABELS).map(([value, label]) => ({ value, label })),
            ]}
          />
        </FilterField>
        <FilterField label="Fila" htmlFor="h-fila">
          <Select id="h-fila" value={filters.queueId ?? ""} onChange={(e) => setParam("queueId", e.target.value)} options={[{ value: "", label: "Todas" }, ...data.queues.map((q) => ({ value: q.id, label: q.name }))]} />
        </FilterField>
        {data.operators.length > 1 || filters.assigneeId ? (
          <FilterField label="Operador" htmlFor="h-op">
            <Select id="h-op" value={filters.assigneeId ?? ""} onChange={(e) => setParam("assigneeId", e.target.value)} options={[{ value: "", label: "Todos" }, ...data.operators.map((o) => ({ value: o.id, label: o.name }))]} />
          </FilterField>
        ) : null}
        <FilterField label="Motivo" htmlFor="h-motivo">
          <Select id="h-motivo" value={filters.reason ?? ""} onChange={(e) => setParam("reason", e.target.value)} options={[{ value: "", label: "Todos" }, ...CONVERSATION_CLOSE_REASONS.map((r) => ({ value: r, label: CLOSE_REASON_LABELS[r] }))]} />
        </FilterField>
        <FilterField label="SLA" htmlFor="h-sla">
          <Select
            id="h-sla"
            value={filters.sla ?? ""}
            onChange={(e) => setParam("sla", e.target.value)}
            options={[
              { value: "", label: "Todos" },
              { value: "dentro", label: "Dentro" },
              { value: "estourado", label: "Estourado" },
            ]}
          />
        </FilterField>
        <FilterField label="Período" htmlFor="h-dias">
          <Select id="h-dias" value={String(filters.days)} onChange={(e) => setParam("days", e.target.value === "30" ? "" : e.target.value)} options={HISTORY_PERIODS.map((p) => ({ value: String(p.days), label: p.label }))} />
        </FilterField>
      </FilterBar>

      <div className={cn("grid gap-4 xl:grid-cols-[minmax(0,1fr)_380px] xl:items-start", pending && "opacity-70")}>
        <section aria-label="Conversas encerradas" className="min-w-0 overflow-hidden rounded-xl border border-border bg-surface shadow-card">
          <p className="border-b border-border px-4 py-3 text-sm text-muted">
            {data.rows.length === 0 ? "Nenhuma conversa" : `${data.rows.length}${data.truncated ? "+" : ""} conversa${data.rows.length === 1 ? "" : "s"}`}
            {term ? ` com «${term}»` : ""} · mais recentes primeiro
            {data.truncated ? " — mostrando as 500 mais recentes; refine os filtros." : ""}
          </p>
          {data.rows.length === 0 ? (
            <EmptyState className="py-12" title="Nada por aqui" description={term ? "Nenhuma conversa encerrada com esse termo no período. Tente outro período." : "Nenhuma conversa encerrada no período e filtros escolhidos."} />
          ) : (
            <div className="overflow-x-auto">
              <Table className="min-w-[780px]">
                <TableHeader>
                  <TableRow>
                    <TableHead>Contato</TableHead>
                    <TableHead>Canal</TableHead>
                    <TableHead>Fila · operador</TableHead>
                    <TableHead>Encerrada</TableHead>
                    <TableHead>1ª resposta</TableHead>
                    <TableHead>SLA</TableHead>
                    <TableHead>Motivo</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {data.rows.map((r) => {
                    const selected = preview?.row.id === r.id;
                    return (
                      <TableRow key={r.id} className={cn("cursor-pointer", selected && "bg-brand/8")} onClick={() => select(r.id)} aria-selected={selected}>
                        <TableCell>
                          <button type="button" className="text-left font-medium hover:underline" onClick={(e) => (e.stopPropagation(), select(r.id))}>
                            <Highlight text={r.name} term={term} />
                          </button>
                          <p className="text-xs text-muted">
                            <Highlight text={r.subtitle} term={term} /> · {r.number}
                          </p>
                          {r.snippet ? (
                            <p className="mt-1 max-w-[360px] text-xs text-muted">
                              <Highlight text={r.snippet} term={term} />
                            </p>
                          ) : null}
                        </TableCell>
                        <TableCell>
                          <ChannelLabel channel={r.channel} />
                        </TableCell>
                        <TableCell className="text-sm">
                          {r.queueName ?? "Sem fila"}
                          <span className="text-muted"> · {r.assigneeName ?? "sem responsável"}</span>
                        </TableCell>
                        <TableCell className="whitespace-nowrap text-sm tabular-nums">{formatDateTime(r.closedAt)}</TableCell>
                        <TableCell className="text-sm tabular-nums">{formatDurationShort(r.firstResponseMs)}</TableCell>
                        <TableCell>
                          {r.sla ? (
                            <Badge size="sm" variant={r.sla === "estourado" ? "danger" : "success"}>
                              {r.sla === "estourado" ? "Estourado" : "Dentro"}
                            </Badge>
                          ) : (
                            <span className="text-sm text-muted">—</span>
                          )}
                        </TableCell>
                        <TableCell className="text-sm">
                          {r.reasonLabel ?? "—"}
                          {r.ticket ? (
                            <>
                              {" "}
                              <Link href={`/suporte/chamados/${r.ticket.id}`} className="font-medium text-brand-fg hover:underline" onClick={(e) => e.stopPropagation()}>
                                {r.ticket.number}
                              </Link>
                            </>
                          ) : null}
                        </TableCell>
                      </TableRow>
                    );
                  })}
                </TableBody>
              </Table>
            </div>
          )}
        </section>

        {preview ? (
          <aside ref={previewRef} aria-label="Prévia da conversa" className="flex scroll-mt-4 flex-col gap-3 rounded-xl border border-border bg-surface p-4 shadow-card xl:sticky xl:top-4">
            <div className="flex flex-wrap items-baseline justify-between gap-2">
              <h2 className="text-base font-semibold">{preview.row.name}</h2>
              <span className="text-xs text-muted">
                {CHANNEL_LABELS[preview.row.channel]} · {preview.messageCount} mensage{preview.messageCount === 1 ? "m" : "ns"}
              </span>
            </div>
            <p className="text-xs text-muted">
              {preview.row.number} · aberta {formatDateTime(preview.row.openedAt)} · encerrada {formatDateTime(preview.row.closedAt)}
              {preview.row.assigneeName ? ` · ${preview.row.assigneeName}` : ""}
              {preview.row.queueName ? ` · fila ${preview.row.queueName}` : ""}
            </p>
            {preview.row.summary ? <p className="rounded-lg border border-border bg-surface-muted px-3 py-2 text-sm">Resumo: {preview.row.summary}</p> : null}
            <ol className="flex max-h-[460px] flex-col gap-2 overflow-y-auto rounded-lg bg-surface-muted p-3 text-sm">
              {preview.thread.length === 0 ? <li className="text-muted">Sem mensagens.</li> : null}
              {preview.thread.map((t) =>
                t.kind === "message" ? (
                  <li key={t.id} className={cn("max-w-[88%] rounded-lg px-3 py-2", t.direction === "entrada" ? "self-start bg-surface" : "self-end bg-brand/15")}>
                    <p className="whitespace-pre-line break-words">
                      <Highlight text={t.body} term={term} />
                    </p>
                    <p className="mt-1 text-[11px] text-muted">
                      {t.authorName} · {formatDateTime(t.at)}
                      {t.manual ? " · registro manual" : ""}
                    </p>
                  </li>
                ) : t.kind === "note" ? (
                  <li key={t.id} className="rounded-lg border border-dashed border-warning/60 px-3 py-2 text-xs text-warning-fg">
                    Nota interna · {t.authorName}: <Highlight text={t.body} term={term} />
                  </li>
                ) : (
                  <li key={t.id} className="text-center text-xs text-muted">
                    {t.title}
                    {t.description ? ` · ${t.description}` : ""}
                  </li>
                ),
              )}
            </ol>
            <div className="flex flex-wrap gap-2">
              <Button asChild variant="outline" size="sm">
                <Link href={`/comunicacao?conversa=${preview.row.id}`}>
                  <ExternalLink /> Abrir conversa completa
                </Link>
              </Button>
              {preview.canReopen ? (
                preview.openElsewhere ? (
                  <Button asChild variant="outline" size="sm">
                    <Link href={`/comunicacao?conversa=${preview.openElsewhere.id}`}>
                      <RotateCcw /> Ir para o aberto ({preview.openElsewhere.number})
                    </Link>
                  </Button>
                ) : (
                  <Button variant="outline" size="sm" onClick={() => reopen(preview.row.id)} loading={pending}>
                    <RotateCcw /> Reabrir
                  </Button>
                )
              ) : null}
              {preview.canOpenClient && preview.row.clientId ? (
                <Button asChild variant="outline" size="sm">
                  <Link href={`/clientes/${preview.row.clientId}?aba=suporte`}>
                    <UserRound /> Abrir Cliente 360
                  </Link>
                </Button>
              ) : null}
            </div>
            {preview.canReopen ? (
              <p className="text-xs text-muted">
                {preview.openElsewhere
                  ? "Este contato já tem um atendimento aberto neste canal: continue por ele."
                  : "Reabrir devolve a conversa a quem atendeu, se a pessoa estiver disponível; se não, à fila. O SLA começa de novo."}
              </p>
            ) : null}
          </aside>
        ) : null}
      </div>
    </div>
  );
}
