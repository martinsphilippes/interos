"use client";

import * as React from "react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { BadgePercent } from "lucide-react";
import type { CommissionRow } from "@/server/commissions/queries";
import { COMMISSION_REVENUE_LABELS } from "@/domain/commissions";
import { formatCompetence, formatCurrency } from "@/lib/format";
import { cn } from "@/lib/utils";
import { EmptyState } from "@/components/ui/empty-state";
import { Pagination, paginate } from "@/components/ui/pagination";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { CommissionStatusBadge } from "./commission-ui";

/**
 * Lista de comissões: tabela (desktop) ou cards (celular). Selecionar grava ?comissao=<id> na URL e o servidor
 * carrega o painel com a memória de cálculo.
 */
export function CommissionsTable({ rows, selectedId, showSeller }: { rows: CommissionRow[]; selectedId?: string; showSeller: boolean }) {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const [pending, startTransition] = React.useTransition();
  const pageSize = 20;
  const selectedIndex = rows.findIndex((r) => r.id === selectedId);
  const [page, setPage] = React.useState(() => (selectedIndex >= 0 ? Math.floor(selectedIndex / pageSize) + 1 : 1));

  const select = (id: string) => {
    const next = new URLSearchParams(searchParams.toString());
    next.set("comissao", id);
    startTransition(() => router.replace(`${pathname}?${next.toString()}`, { scroll: false }));
  };

  if (rows.length === 0) return <EmptyState icon={<BadgePercent />} title="Nenhuma comissão encontrada" description="As comissões nascem das vendas ganhas e evoluem com assinatura, recebimentos e carência. Ajuste os filtros." />;
  const visible = paginate(rows, page, pageSize);

  return (
    <div aria-busy={pending || undefined}>
      <ul className="flex flex-col divide-y divide-border md:hidden">
        {visible.map((r) => (
          <li key={r.id} className={cn(r.id === selectedId && "bg-brand-soft/60")}>
            <button type="button" onClick={() => select(r.id)} className="flex min-h-[44px] w-full flex-col gap-1.5 px-4 py-3 text-left active:bg-surface-hover" data-commission={r.code}>
              <span className="flex items-center justify-between gap-2">
                <span className="truncate font-medium">{r.clientName}</span>
                <span className="shrink-0 font-semibold tabular-nums">{formatCurrency(r.amount)}</span>
              </span>
              <span className="truncate text-xs text-muted">
                {r.code} · {r.slotLabel} · {r.productName}
                {showSeller ? ` · ${r.userName}` : ""}
              </span>
              <span className="flex flex-wrap items-center gap-1.5">
                <CommissionStatusBadge status={r.status} />
                <span className="text-xs text-muted">{formatCompetence(r.competence)}</span>
              </span>
            </button>
          </li>
        ))}
      </ul>
      <div className="hidden md:block">
        <Table className="min-w-[640px]">
          <TableHeader>
            <TableRow>
              <TableHead>Comissão</TableHead>
              <TableHead>Cliente / contrato</TableHead>
              {showSeller ? <TableHead className="hidden 2xl:table-cell">Vendedor</TableHead> : null}
              <TableHead className="hidden 2xl:table-cell">Competência</TableHead>
              <TableHead className="text-right">Base</TableHead>
              <TableHead className="text-right">Valor</TableHead>
              <TableHead>Situação</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {visible.map((r) => (
              <TableRow key={r.id} clickable selected={r.id === selectedId} className="cursor-pointer" onClick={() => select(r.id)}>
                <TableCell className="max-w-[170px]">
                  <button
                    type="button"
                    className="whitespace-nowrap text-left font-medium hover:text-brand-fg focus-visible:outline-brand"
                    onClick={(e) => {
                      e.stopPropagation();
                      select(r.id);
                    }}
                    aria-pressed={r.id === selectedId}
                    data-commission={r.code}
                  >
                    {r.code}
                  </button>
                  <span className="block truncate text-xs text-muted">
                    {COMMISSION_REVENUE_LABELS[r.revenueType]} · {r.slotLabel}
                  </span>
                </TableCell>
                <TableCell className="max-w-[220px]">
                  <span className="block truncate">{r.clientName}</span>
                  <span className="block truncate text-xs text-muted">
                    {[r.contractNumber, r.productName].filter(Boolean).join(" · ")}
                    {showSeller ? <span className="2xl:hidden"> · {r.userName}</span> : null}
                    <span className="2xl:hidden"> · {formatCompetence(r.competence)}</span>
                  </span>
                </TableCell>
                {showSeller ? <TableCell className="hidden whitespace-nowrap text-sm 2xl:table-cell">{r.userName}</TableCell> : null}
                <TableCell className="hidden whitespace-nowrap text-sm 2xl:table-cell">{formatCompetence(r.competence)}</TableCell>
                <TableCell className="whitespace-nowrap text-right tabular-nums text-muted">{formatCurrency(r.baseAmount)}</TableCell>
                <TableCell className="whitespace-nowrap text-right font-semibold tabular-nums">{formatCurrency(r.amount)}</TableCell>
                <TableCell>
                  <CommissionStatusBadge status={r.status} />
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
