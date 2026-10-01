"use client";

import * as React from "react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { HandCoins } from "lucide-react";
import type { PayableRow } from "@/server/commissions/queries";
import { payableCategoryLabel } from "@/domain/commissions";
import { formatCompetence, formatCurrency, formatDate } from "@/lib/format";
import { cn } from "@/lib/utils";
import { EmptyState } from "@/components/ui/empty-state";
import { Pagination, paginate } from "@/components/ui/pagination";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { PayableStatusBadge } from "./commission-ui";
import { SettlementBadge } from "@/components/finance/settlement-ui";

/** Tem baixa parcial e ainda há saldo (etapa CP/CR 3): mostra o badge "Parcial" e o valor em aberto. */
const partial = (r: PayableRow) => r.paid !== 0 && r.open !== 0 && r.status !== "pago" && r.status !== "cancelado";

/** Títulos a pagar: tabela (desktop) ou cards (celular). Selecionar grava ?titulo=<id>. */
export function PayablesTable({ rows, selectedId }: { rows: PayableRow[]; selectedId?: string }) {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const [pending, startTransition] = React.useTransition();
  const pageSize = 20;
  const selectedIndex = rows.findIndex((r) => r.id === selectedId);
  const [page, setPage] = React.useState(() => (selectedIndex >= 0 ? Math.floor(selectedIndex / pageSize) + 1 : 1));

  const select = (id: string) => {
    const next = new URLSearchParams(searchParams.toString());
    next.set("titulo", id);
    startTransition(() => router.replace(`${pathname}?${next.toString()}`, { scroll: false }));
  };

  if (rows.length === 0) return <EmptyState icon={<HandCoins />} title="Nenhum título encontrado" description="Os títulos de comissão nascem quando a comissão fica elegível; lançamentos manuais também aparecem aqui." />;
  const visible = paginate(rows, page, pageSize);

  return (
    <div aria-busy={pending || undefined}>
      <ul className="flex flex-col divide-y divide-border md:hidden">
        {visible.map((r) => (
          <li key={r.id} className={cn(r.id === selectedId && "bg-brand-soft/60")}>
            <button type="button" onClick={() => select(r.id)} className="flex min-h-[44px] w-full flex-col gap-1.5 px-4 py-3 text-left active:bg-surface-hover" data-payable={r.code}>
              <span className="flex items-center justify-between gap-2">
                <span className="truncate font-medium">{r.creditorName}</span>
                <span className={cn("shrink-0 font-semibold tabular-nums", r.amount < 0 && "text-danger-fg")}>{formatCurrency(r.amount)}</span>
              </span>
              <span className="truncate text-xs text-muted">
                {r.code} · {payableCategoryLabel(r.category)}{r.installments ? ` · ${r.installment}/${r.installments}` : ""}{r.recurring ? " · recorrente" : ""} · vence {formatDate(r.dueDate)}
              </span>
              <span className="flex flex-wrap items-center gap-1.5">
                <PayableStatusBadge status={r.status} overdue={r.overdue} />
                {partial(r) ? (
                  <>
                    <SettlementBadge status="parcial" />
                    <span className="text-xs tabular-nums text-muted">em aberto {formatCurrency(r.open)}</span>
                  </>
                ) : null}
              </span>
            </button>
          </li>
        ))}
      </ul>
      <div className="hidden md:block">
        <Table className="min-w-[640px]">
          <TableHeader>
            <TableRow>
              <TableHead>Título</TableHead>
              <TableHead>Credor / descrição</TableHead>
              <TableHead className="hidden 2xl:table-cell">Competência</TableHead>
              <TableHead>Vencimento</TableHead>
              <TableHead className="text-right">Valor</TableHead>
              <TableHead>Situação</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {visible.map((r) => (
              <TableRow key={r.id} clickable selected={r.id === selectedId} className="cursor-pointer" onClick={() => select(r.id)}>
                <TableCell className="max-w-[150px]">
                  <button
                    type="button"
                    className="whitespace-nowrap text-left font-medium hover:text-brand-fg focus-visible:outline-brand"
                    onClick={(e) => {
                      e.stopPropagation();
                      select(r.id);
                    }}
                    aria-pressed={r.id === selectedId}
                    data-payable={r.code}
                  >
                    {r.code}
                  </button>
                  <span className="block truncate text-xs text-muted">
                    {payableCategoryLabel(r.category)}
                    {r.installments ? ` · ${r.installment}/${r.installments}` : ""}
                    {r.recurring ? " · recorrente" : ""}
                  </span>
                </TableCell>
                <TableCell className="max-w-[260px]">
                  <span className="block truncate">{r.creditorName}</span>
                  <span className="block truncate text-xs text-muted" title={r.description}>
                    {r.description}
                  </span>
                </TableCell>
                <TableCell className="hidden whitespace-nowrap text-sm 2xl:table-cell">{formatCompetence(r.competence)}</TableCell>
                <TableCell className={cn("whitespace-nowrap tabular-nums", r.overdue && "text-danger-fg")}>{formatDate(r.dueDate)}</TableCell>
                <TableCell className={cn("whitespace-nowrap text-right font-semibold tabular-nums", r.amount < 0 && "text-danger-fg")}>
                  {formatCurrency(r.amount)}
                  {partial(r) ? <span className="block text-xs font-normal text-muted">em aberto {formatCurrency(r.open)}</span> : null}
                </TableCell>
                <TableCell>
                  <span className="flex flex-wrap items-center gap-1">
                    <PayableStatusBadge status={r.status} overdue={r.overdue} />
                    {partial(r) ? <SettlementBadge status="parcial" /> : null}
                  </span>
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
