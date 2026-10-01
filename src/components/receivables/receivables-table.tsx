"use client";

import * as React from "react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { HandCoins } from "lucide-react";
import type { ReceivableRow } from "@/server/receivables/queries";
import { formatCurrency, formatDate } from "@/lib/format";
import { cn } from "@/lib/utils";
import { EmptyState } from "@/components/ui/empty-state";
import { Pagination, paginate } from "@/components/ui/pagination";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { SettlementBadge } from "@/components/finance/settlement-ui";

const money = (v: number | null) => (v === null ? "Restrito" : formatCurrency(v));

/**
 * Lista simples dos títulos a receber avulsos (etapa CP/CR 3): vencimento, descrição, cliente/pagador, categoria, valor,
 * em aberto e status calculado. Tabela no desktop, cards no celular; selecionar grava ?titulo=<id> (mantém ?aba=avulsos).
 * A lista com lote/acumulado/filtros por coluna é da etapa 6.
 */
export function ReceivablesTable({ rows, selectedId }: { rows: ReceivableRow[]; selectedId?: string }) {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const [pending, startTransition] = React.useTransition();
  const pageSize = 20;
  const selectedIndex = rows.findIndex((r) => r.id === selectedId);
  const [page, setPage] = React.useState(() => (selectedIndex >= 0 ? Math.floor(selectedIndex / pageSize) + 1 : 1));

  const select = (id: string) => {
    const next = new URLSearchParams(searchParams.toString());
    next.set("aba", "avulsos");
    next.set("titulo", id);
    startTransition(() => router.replace(`${pathname}?${next.toString()}`, { scroll: false }));
  };

  if (rows.length === 0) return <EmptyState icon={<HandCoins />} title="Nenhum título a receber avulso" description="Receitas fora de contrato (consultoria avulsa, reembolso, venda de equipamento…) aparecem aqui. Use “Novo título a receber”." />;
  const visible = paginate(rows, page, pageSize);

  return (
    <div aria-busy={pending || undefined} data-testid="receivables-table">
      <ul className="flex flex-col divide-y divide-border md:hidden">
        {visible.map((r) => (
          <li key={r.id} className={cn(r.id === selectedId && "bg-brand-soft/60")}>
            <button type="button" onClick={() => select(r.id)} className="flex min-h-[44px] w-full flex-col gap-1.5 px-4 py-3 text-left active:bg-surface-hover" data-receivable={r.code}>
              <span className="flex items-center justify-between gap-2">
                <span className="min-w-0 truncate font-medium">{r.description}</span>
                <span className="shrink-0 font-semibold tabular-nums">{money(r.amount)}</span>
              </span>
              <span className="truncate text-xs text-muted">
                {r.code} · {r.payerName} · vence {formatDate(r.dueDate)}
              </span>
              <span className="flex flex-wrap items-center gap-1.5">
                <SettlementBadge status={r.settlement} />
                {r.status === "aberto" && r.open !== null && r.paid ? <span className="text-xs tabular-nums text-muted">em aberto {formatCurrency(r.open)}</span> : null}
              </span>
            </button>
          </li>
        ))}
      </ul>
      <div className="hidden md:block">
        <Table className="min-w-[600px]">
          <TableHeader>
            <TableRow>
              <TableHead>Vencimento</TableHead>
              <TableHead>Descrição</TableHead>
              <TableHead className="hidden 2xl:table-cell">Cliente / pagador</TableHead>
              <TableHead className="hidden 2xl:table-cell">Categoria</TableHead>
              <TableHead className="text-right">Valor</TableHead>
              <TableHead className="text-right">Em aberto</TableHead>
              <TableHead>Situação</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {visible.map((r) => (
              <TableRow key={r.id} clickable selected={r.id === selectedId} className="cursor-pointer" onClick={() => select(r.id)}>
                <TableCell className={cn("whitespace-nowrap tabular-nums", r.settlement === "vencido" && "text-danger-fg")}>{formatDate(r.dueDate)}</TableCell>
                <TableCell className="max-w-[280px]">
                  <button
                    type="button"
                    className="block max-w-full truncate text-left font-medium hover:text-brand-fg focus-visible:outline-brand"
                    onClick={(e) => {
                      e.stopPropagation();
                      select(r.id);
                    }}
                    aria-pressed={r.id === selectedId}
                    data-receivable={r.code}
                    title={r.description}
                  >
                    {r.description}
                  </button>
                  <span className="block truncate text-xs text-muted">
                    {r.code}
                    {r.installments ? ` · ${r.installment}/${r.installments}` : ""}
                    <span className="2xl:hidden"> · {r.payerName}</span>
                  </span>
                </TableCell>
                <TableCell className="hidden max-w-[200px] truncate 2xl:table-cell">{r.payerName}</TableCell>
                <TableCell className="hidden max-w-[200px] truncate text-sm text-muted 2xl:table-cell">{r.categoryName ?? "—"}</TableCell>
                <TableCell className="whitespace-nowrap text-right font-semibold tabular-nums">{money(r.amount)}</TableCell>
                <TableCell className="whitespace-nowrap text-right tabular-nums">{r.status === "aberto" ? money(r.open) : "—"}</TableCell>
                <TableCell>
                  <SettlementBadge status={r.settlement} />
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </div>
      {rows.length > pageSize ? <Pagination className="border-t border-border px-4 py-3" page={page} pageSize={pageSize} total={rows.length} onPageChange={setPage} /> : null}
    </div>
  );
}
