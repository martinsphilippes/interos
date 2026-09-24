"use client";

import * as React from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { ArrowRight, Filter, Hand, Headset, Repeat, SlidersHorizontal } from "lucide-react";
import type { SupportTicket } from "@/domain/types";
import type { SupportUser, TicketRow } from "@/server/support/queries";
import { assumeTicketAction } from "@/server/support/actions";
import {
  OPEN_TICKET_STATUSES,
  TICKET_CHANNELS,
  TICKET_CHANNEL_LABELS,
  TICKET_PRIORITIES,
  TICKET_PRIORITY_LABELS,
  TICKET_QUEUES,
  TICKET_STATUSES,
  TICKET_STATUS_LABELS,
} from "@/server/support/schemas";
import { dateKey, formatDateTime, formatRelative } from "@/lib/format";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { EmptyState } from "@/components/ui/empty-state";
import { Pagination, paginate } from "@/components/ui/pagination";
import { SearchInput } from "@/components/ui/search-input";
import { Select } from "@/components/ui/select";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { toast } from "@/components/ui/toast";
import { UserChip } from "@/components/ui/user-chip";
import { cn } from "@/lib/utils";
import { SlaBadgeAt, useMinuteClock } from "./sla-live";
import { ChannelIcon, QueueBadge, TicketPriorityBadge, TicketStatusBadge } from "./ticket-badges";
import { EMPTY_FILTERS, type TicketFilterState } from "./filters";

const PERIOD_LABELS: Record<string, string> = { hoje: "Hoje", "7d": "Últimos 7 dias", "30d": "Últimos 30 dias", mes: "Este mês", "90d": "Últimos 90 dias" };

function inPeriod(iso: string | undefined, period: string, now: Date): boolean {
  if (!period) return true;
  if (!iso) return false;
  if (period === "hoje") return dateKey(iso) === dateKey(now);
  if (period === "mes") return dateKey(iso).slice(0, 7) === dateKey(now).slice(0, 7);
  const days = period === "7d" ? 7 : period === "30d" ? 30 : period === "90d" ? 90 : 0;
  return days === 0 || now.getTime() - new Date(iso).getTime() <= days * 86_400_000;
}

const SLA_RANK: Record<string, number> = { violado: 0, em_risco: 1 };
const PRIORITY_RANK: Record<SupportTicket["priority"], number> = { critico: 0, alto: 1, medio: 2, baixo: 3 };

function queueCompare(a: TicketRow, b: TicketRow): number {
  const sa = a.open && a.sla ? (SLA_RANK[a.sla.view.state] ?? 2) : 3;
  const sb = b.open && b.sla ? (SLA_RANK[b.sla.view.state] ?? 2) : 3;
  if (sa !== sb) return sa - sb;
  if (PRIORITY_RANK[a.priority] !== PRIORITY_RANK[b.priority]) return PRIORITY_RANK[a.priority] - PRIORITY_RANK[b.priority];
  const da = a.sla?.dueAt ?? "9";
  const db = b.sla?.dueAt ?? "9";
  if (da !== db) return da < db ? -1 : 1;
  return a.openedAt < b.openedAt ? -1 : 1;
}

export function applyTicketFilters(rows: TicketRow[], f: TicketFilterState, currentUserId: string, now: Date = new Date()): TicketRow[] {
  const q = f.q
    .trim()
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase();
  const statuses = f.status === "abertos" ? [...OPEN_TICKET_STATUSES] : f.status ? f.status.split(",") : [];
  let out = rows.filter((r) => {
    if (statuses.length && !statuses.includes(r.status)) return false;
    if (f.prioridade && r.priority !== f.prioridade) return false;
    if (f.fila && r.queue !== f.fila) return false;
    if (f.atendente === "meus" && r.assigneeId !== currentUserId) return false;
    if (f.atendente === "sem" && r.assigneeId) return false;
    if (f.atendente && f.atendente !== "meus" && f.atendente !== "sem" && r.assigneeId !== f.atendente) return false;
    if (f.canal && r.channel !== f.canal) return false;
    if (f.produto && r.productId !== f.produto) return false;
    if (f.sla && !(r.open && r.sla?.view.state === f.sla)) return false;
    if (f.resposta === "pendente" && (!r.open || r.firstResponseAt)) return false;
    if (f.reaberto === "1" && !r.reopenedFromId) return false;
    if (f.periodo && !inPeriod(r.status === "resolvido" || r.status === "fechado" ? r.resolvedAt : r.openedAt, f.periodo, now)) return false;
    if (q) {
      const hay = `${r.number} ${r.subject} ${r.clientName} ${r.category ?? ""} ${r.productName ?? ""}`
        .normalize("NFD")
        .replace(/[̀-ͯ]/g, "")
        .toLowerCase();
      if (!hay.includes(q)) return false;
    }
    return true;
  });
  const order = f.ordem || "fila";
  out = [...out].sort((a, b) => {
    if (order === "recentes") return a.openedAt < b.openedAt ? 1 : -1;
    if (order === "antigos") return a.openedAt < b.openedAt ? -1 : 1;
    if (order === "resolvidos") return (b.resolvedAt ?? "") < (a.resolvedAt ?? "") ? -1 : (b.resolvedAt ?? "") > (a.resolvedAt ?? "") ? 1 : 0;
    return queueCompare(a, b);
  });
  return out;
}

export interface TicketsTableProps {
  rows: TicketRow[];
  /** "fila": Central (abertos, ações inline, abre a página). "todos": lista completa (abre o drawer). */
  mode: "fila" | "todos";
  team: SupportUser[];
  products: { id: string; name: string }[];
  currentUserId: string;
  canOperate: boolean;
  initialFilters: TicketFilterState;
}

export function TicketsTable({ rows, mode, team, products, currentUserId, canOperate, initialFilters }: TicketsTableProps) {
  const router = useRouter();
  const now = useMinuteClock();
  const [filters, setFilters] = React.useState<TicketFilterState>(initialFilters);
  const [page, setPage] = React.useState(1);
  const [showFilters, setShowFilters] = React.useState(false);
  const [pendingId, setPendingId] = React.useState<string | null>(null);
  const [, startTransition] = React.useTransition();

  // Filtros ficam na URL (compartilháveis) sem recarregar dados do servidor.
  const update = (patch: Partial<TicketFilterState>) => {
    const next = { ...filters, ...patch };
    setFilters(next);
    setPage(1);
    const params = new URLSearchParams(window.location.search);
    for (const [k, v] of Object.entries(patch)) {
      if (v) params.set(k, v);
      else params.delete(k);
    }
    const qs = params.toString();
    window.history.replaceState(null, "", qs ? `${window.location.pathname}?${qs}` : window.location.pathname);
  };

  const filtered = React.useMemo(() => applyTicketFilters(rows, filters, currentUserId), [rows, filters, currentUserId]);
  const pageSize = mode === "todos" ? 25 : 50;
  const visible = paginate(filtered, page, pageSize);
  const activeCount = (Object.keys(EMPTY_FILTERS) as (keyof TicketFilterState)[]).filter((k) => k !== "q" && k !== "ordem" && filters[k]).length;

  const openTicket = (row: TicketRow) => {
    if (mode === "todos") {
      const params = new URLSearchParams(window.location.search);
      params.set("chamado", row.id);
      router.push(`${window.location.pathname}?${params.toString()}`, { scroll: false });
    } else router.push(`/suporte/chamados/${row.id}`);
  };

  const assume = (row: TicketRow) => {
    setPendingId(row.id);
    startTransition(async () => {
      const result = await assumeTicketAction({ ticketId: row.id });
      setPendingId(null);
      if (!result.ok) {
        toast.error(result.error);
        return;
      }
      toast.success(`Chamado ${row.number} assumido`);
      router.refresh();
    });
  };

  const statusOptions =
    mode === "fila"
      ? OPEN_TICKET_STATUSES.map((s) => ({ value: s, label: TICKET_STATUS_LABELS[s] }))
      : [{ value: "abertos", label: "Todos os abertos" }, { value: "aberto,reaberto", label: "Aguardando atendimento" }, ...TICKET_STATUSES.map((s) => ({ value: s, label: TICKET_STATUS_LABELS[s] })), { value: "resolvido,fechado", label: "Resolvidos e fechados" }];

  const filterBar = (
    <div className={cn("grid gap-2 sm:grid-cols-2 lg:grid-cols-4 xl:grid-cols-8", !showFilters && "hidden md:grid")}>
      <Select size="sm" aria-label="Status" value={filters.status} onChange={(e) => update({ status: e.target.value })} placeholder="Status: todos" options={statusOptions} />
      <Select size="sm" aria-label="Criticidade" value={filters.prioridade} onChange={(e) => update({ prioridade: e.target.value })} placeholder="Criticidade: todas" options={TICKET_PRIORITIES.map((p) => ({ value: p, label: TICKET_PRIORITY_LABELS[p] }))} />
      <Select size="sm" aria-label="Fila" value={filters.fila} onChange={(e) => update({ fila: e.target.value })} placeholder="Fila: todas" options={TICKET_QUEUES.map((q) => ({ value: q, label: q.toUpperCase() }))} />
      <Select
        size="sm"
        aria-label="Atendente"
        value={filters.atendente}
        onChange={(e) => update({ atendente: e.target.value })}
        placeholder="Atendente: todos"
        options={[{ value: "meus", label: "Meus chamados" }, { value: "sem", label: "Sem atendente" }, ...team.map((u) => ({ value: u.id, label: u.name }))]}
      />
      <Select size="sm" aria-label="Canal" value={filters.canal} onChange={(e) => update({ canal: e.target.value })} placeholder="Canal: todos" options={TICKET_CHANNELS.map((c) => ({ value: c, label: TICKET_CHANNEL_LABELS[c] }))} />
      <Select size="sm" aria-label="Produto" value={filters.produto} onChange={(e) => update({ produto: e.target.value })} placeholder="Produto: todos" options={products.map((p) => ({ value: p.id, label: p.name }))} />
      <Select
        size="sm"
        aria-label="SLA"
        value={filters.sla || (filters.resposta ? "resposta" : "")}
        onChange={(e) => (e.target.value === "resposta" ? update({ sla: "", resposta: "pendente" }) : update({ sla: e.target.value, resposta: "" }))}
        placeholder="SLA: todos"
        options={[
          { value: "violado", label: "SLA violado" },
          { value: "em_risco", label: "SLA em risco" },
          { value: "em_atencao", label: "SLA em atenção" },
          { value: "pausado", label: "SLA pausado" },
          { value: "resposta", label: "1ª resposta pendente" },
        ]}
      />
      {mode === "todos" ? (
        <Select size="sm" aria-label="Período" value={filters.periodo} onChange={(e) => update({ periodo: e.target.value })} placeholder="Período: todo" options={Object.entries(PERIOD_LABELS).map(([value, label]) => ({ value, label }))} />
      ) : (
        <Select size="sm" aria-label="Reabertos" value={filters.reaberto} onChange={(e) => update({ reaberto: e.target.value })} placeholder="Todos os chamados" options={[{ value: "1", label: "Só reabertos" }]} />
      )}
    </div>
  );

  return (
    <div className="flex flex-col gap-3">
      <div className="flex flex-col gap-2 md:flex-row md:items-center">
        <SearchInput value={filters.q} onChange={(q) => update({ q })} debounceMs={200} placeholder="Buscar número, assunto, cliente ou produto" className="md:max-w-sm" />
        <div className="flex items-center gap-2 md:ml-auto">
          <Button variant="outline" className="min-h-[44px] md:hidden" onClick={() => setShowFilters((v) => !v)} aria-expanded={showFilters}>
            <SlidersHorizontal /> Filtros{activeCount ? ` (${activeCount})` : ""}
          </Button>
          {mode === "todos" ? (
            <Select
              size="sm"
              aria-label="Ordenar"
              className="w-44"
              value={filters.ordem || "fila"}
              onChange={(e) => update({ ordem: e.target.value === "fila" ? "" : e.target.value })}
              options={[
                { value: "fila", label: "Ordem da fila (SLA)" },
                { value: "recentes", label: "Mais recentes" },
                { value: "antigos", label: "Mais antigos" },
                { value: "resolvidos", label: "Resolvidos recentes" },
              ]}
            />
          ) : null}
          {activeCount > 0 || filters.q ? (
            <Button variant="ghost" size="sm" className="min-h-[44px] md:min-h-0" onClick={() => update({ ...EMPTY_FILTERS, ordem: filters.ordem })}>
              <Filter /> Limpar
            </Button>
          ) : null}
        </div>
      </div>
      {filterBar}

      <p className="text-xs text-muted" aria-live="polite">
        {filtered.length} chamado{filtered.length === 1 ? "" : "s"}
        {filters.periodo ? ` · ${PERIOD_LABELS[filters.periodo] ?? ""}` : ""}
      </p>

      <Card className="overflow-hidden">
        {filtered.length === 0 ? (
          <EmptyState
            size="sm"
            icon={<Headset />}
            title={rows.length === 0 ? (mode === "fila" ? "Fila vazia" : "Nenhum chamado registrado") : "Nenhum chamado com esses filtros"}
            description={rows.length === 0 ? (mode === "fila" ? "Não há chamados em aberto no seu escopo. Bom trabalho!" : "Os chamados abertos em qualquer canal aparecem aqui.") : "Ajuste ou limpe os filtros para ver mais chamados."}
          />
        ) : (
          <>
            {/* Desktop: tabela */}
            <div className="hidden md:block">
              <Table className="min-w-[1080px]">
                <TableHeader>
                  <TableRow>
                    <TableHead className="w-[150px]">SLA</TableHead>
                    <TableHead>Chamado</TableHead>
                    <TableHead>Cliente</TableHead>
                    <TableHead className="w-12 text-center">Canal</TableHead>
                    <TableHead>Atendente</TableHead>
                    <TableHead className="w-14">Fila</TableHead>
                    <TableHead>Status</TableHead>
                    <TableHead>{mode === "todos" ? "Abertura / solução" : "Aberto há"}</TableHead>
                    <TableHead className="w-[168px] text-right">Ações</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {visible.map((row) => (
                    <TableRow key={row.id} clickable onClick={() => openTicket(row)} className={cn(row.open && row.sla?.view.state === "violado" && "bg-danger-soft/30")}>
                      <TableCell>
                        {row.open ? <SlaBadgeAt sla={row.sla} now={now} /> : <SlaBadgeAt sla={row.sla} now={null} />}
                        {row.open && !row.firstResponseAt ? <p className="mt-1 text-[11px] text-warning-fg">1ª resposta pendente</p> : null}
                      </TableCell>
                      <TableCell className="max-w-[320px]">
                        <div className="flex items-center gap-2">
                          <span className="font-mono text-xs text-muted">{row.number}</span>
                          <TicketPriorityBadge priority={row.priority} />
                          {row.reopenedFromId ? (
                            <span className="inline-flex items-center gap-0.5 text-[11px] font-medium text-danger-fg" title="Chamado reaberto (reincidência)">
                              <Repeat className="size-3" /> reaberto
                            </span>
                          ) : null}
                        </div>
                        <p className="mt-0.5 truncate font-medium text-foreground">{row.subject}</p>
                        <p className="truncate text-xs text-muted">{[row.productName, row.category].filter(Boolean).join(" · ") || "—"}</p>
                      </TableCell>
                      <TableCell className="max-w-[200px]">
                        <Link href={`/clientes/${row.clientId}?aba=suporte`} onClick={(e) => e.stopPropagation()} className="block truncate text-sm hover:text-brand hover:underline">
                          {row.clientName}
                        </Link>
                      </TableCell>
                      <TableCell className="text-center">
                        <ChannelIcon channel={row.channel} />
                      </TableCell>
                      <TableCell>{row.assigneeName ? <UserChip name={row.assigneeName} size="sm" /> : <span className="text-xs text-muted">Sem atendente</span>}</TableCell>
                      <TableCell>
                        <QueueBadge queue={row.queue} />
                      </TableCell>
                      <TableCell>
                        <TicketStatusBadge status={row.status} />
                        {row.csatScore !== undefined ? <p className="mt-1 text-[11px] text-muted">CSAT {row.csatScore}</p> : null}
                      </TableCell>
                      <TableCell className="whitespace-nowrap text-xs text-muted" title={formatDateTime(row.openedAt)}>
                        {formatRelative(row.openedAt)}
                        {mode === "todos" && row.resolvedAt ? <p>resolvido {formatDateTime(row.resolvedAt)}</p> : null}
                      </TableCell>
                      <TableCell className="text-right">
                        <div className="flex items-center justify-end gap-1">
                          {canOperate && row.open && row.assigneeId !== currentUserId ? (
                            <Button
                              size="sm"
                              variant="outline"
                              loading={pendingId === row.id}
                              onClick={(e) => {
                                e.stopPropagation();
                                assume(row);
                              }}
                            >
                              <Hand /> Assumir
                            </Button>
                          ) : null}
                          <Button size="sm" variant="ghost" asChild>
                            <Link href={`/suporte/chamados/${row.id}`} onClick={(e) => e.stopPropagation()} aria-label={`Abrir chamado ${row.number}`}>
                              Abrir <ArrowRight />
                            </Link>
                          </Button>
                        </div>
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>

            {/* Mobile: cards */}
            <ul className="divide-y divide-border md:hidden">
              {visible.map((row) => (
                <li key={row.id} className={cn("flex flex-col gap-2 p-4", row.open && row.sla?.view.state === "violado" && "bg-danger-soft/30")}>
                  <button type="button" onClick={() => openTicket(row)} className="flex flex-col gap-1.5 text-left">
                    <div className="flex flex-wrap items-center gap-2">
                      <span className="font-mono text-xs text-muted">{row.number}</span>
                      <TicketPriorityBadge priority={row.priority} />
                      <TicketStatusBadge status={row.status} />
                      <ChannelIcon channel={row.channel} className="ml-auto" />
                    </div>
                    <p className="font-medium leading-snug">{row.subject}</p>
                    <p className="text-sm text-muted">
                      {row.clientName} · {row.assigneeName ?? "sem atendente"} · {row.queue.toUpperCase()}
                    </p>
                  </button>
                  <div className="flex flex-wrap items-center gap-2">
                    {row.open ? <SlaBadgeAt sla={row.sla} now={now} /> : <SlaBadgeAt sla={row.sla} now={null} />}
                    <span className="text-xs text-muted">{formatRelative(row.openedAt)}</span>
                    {canOperate && row.open && row.assigneeId !== currentUserId ? (
                      <Button size="sm" variant="outline" className="ml-auto min-h-[44px]" loading={pendingId === row.id} onClick={() => assume(row)}>
                        <Hand /> Assumir
                      </Button>
                    ) : null}
                  </div>
                </li>
              ))}
            </ul>
          </>
        )}
      </Card>
      {filtered.length > pageSize ? <Pagination page={page} pageSize={pageSize} total={filtered.length} onPageChange={setPage} /> : null}
    </div>
  );
}
