"use client";

import * as React from "react";
import Link from "next/link";
import { Receipt } from "lucide-react";
import type { BillingRow } from "@/server/finance/queries";
import { paymentMethodLabel } from "@/server/finance/schemas";
import { formatCompetence, formatCurrency, formatDate } from "@/lib/format";
import { BILLING_STATUS_LABELS, BILLING_STATUS_VARIANT } from "@/components/clients/labels";
import { Badge } from "@/components/ui/badge";
import { EmptyState } from "@/components/ui/empty-state";
import { Pagination, paginate } from "@/components/ui/pagination";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { cn } from "@/lib/utils";
import { BillingActions, billingLabel } from "./billing-actions";

const PAGE_SIZE = 25;

function DueInfo({ row }: { row: BillingRow }) {
  if (row.status === "vencida") return <span className="text-xs text-danger-fg">{-row.daysToDue} dia(s) de atraso</span>;
  if (row.status === "aberta") return <span className="text-xs text-muted">{row.daysToDue === 0 ? "vence hoje" : `em ${row.daysToDue} dia(s)`}</span>;
  if (row.status === "paga") return <span className="text-xs text-muted">pago {formatDate(row.paidAt)} · {paymentMethodLabel(row.method)}</span>;
  return null;
}

/** Lista de cobranças com paginação em memória e ações (pagamento, WhatsApp, ligação, cancelamento). */
export function BillingsTable({ rows, canOperate }: { rows: BillingRow[]; canOperate: boolean }) {
  const [page, setPage] = React.useState(1);
  const [prevRows, setPrevRows] = React.useState(rows);
  if (rows !== prevRows) {
    setPrevRows(rows);
    setPage(1);
  }
  const visible = paginate(rows, page, PAGE_SIZE);

  if (rows.length === 0) return <EmptyState icon={<Receipt />} title="Nenhuma cobrança encontrada" description="Ajuste os filtros. Cobranças são geradas na página do contrato após a assinatura." />;

  return (
    <div>
      <ul className="flex flex-col divide-y divide-border md:hidden">
        {visible.map((b) => (
          <li key={b.id} className={cn("flex items-start gap-3 px-4 py-3", b.status === "vencida" && "bg-danger-soft/40")}>
            <div className="min-w-0 flex-1">
              <Link href={`/financeiro/contratos/${b.contractId}`} className="block truncate font-medium hover:text-brand">
                {b.clientName}
              </Link>
              <p className="text-xs text-muted">
                {billingLabel(b)} · {formatCurrency(b.amount)} · vence {formatDate(b.dueDate)}
              </p>
              <div className="mt-1.5 flex flex-wrap items-center gap-2">
                <Badge variant={BILLING_STATUS_VARIANT[b.status]} size="sm">
                  {BILLING_STATUS_LABELS[b.status]}
                </Badge>
                <DueInfo row={b} />
              </div>
            </div>
            {canOperate ? <BillingActions billing={b} compact /> : null}
          </li>
        ))}
      </ul>
      <div className="hidden md:block">
        <Table className="min-w-[980px]">
          <TableHeader>
            <TableRow>
              <TableHead>Cliente</TableHead>
              <TableHead>Contrato</TableHead>
              <TableHead>Cobrança</TableHead>
              <TableHead>Competência</TableHead>
              <TableHead className="text-right">Valor</TableHead>
              <TableHead>Vencimento</TableHead>
              <TableHead>Status</TableHead>
              {canOperate ? <TableHead className="text-right">Ações</TableHead> : null}
            </TableRow>
          </TableHeader>
          <TableBody>
            {visible.map((b) => (
              <TableRow key={b.id} className={cn(b.status === "vencida" && "bg-danger-soft/40 hover:bg-danger-soft/60")}>
                <TableCell className="max-w-[220px] truncate font-medium">
                  <Link href={`/clientes/${b.clientId}?aba=financeiro`} className="hover:text-brand">
                    {b.clientName}
                  </Link>
                </TableCell>
                <TableCell className="whitespace-nowrap text-sm">
                  <Link href={`/financeiro/contratos/${b.contractId}`} className="text-muted hover:text-brand">
                    {b.contractNumber}
                  </Link>
                </TableCell>
                <TableCell className="whitespace-nowrap">{billingLabel(b)}</TableCell>
                <TableCell className="whitespace-nowrap capitalize text-muted">{formatCompetence(b.competence)}</TableCell>
                <TableCell className="whitespace-nowrap text-right tabular-nums">
                  {formatCurrency(b.amount)}
                  {b.paidAmount !== undefined && b.paidAmount !== b.amount ? <span className="block text-xs text-muted">pago {formatCurrency(b.paidAmount)}</span> : null}
                </TableCell>
                <TableCell className="whitespace-nowrap">
                  <span className={b.status === "vencida" ? "text-danger-fg" : undefined}>{formatDate(b.dueDate)}</span>
                  <span className="block">
                    <DueInfo row={b} />
                  </span>
                </TableCell>
                <TableCell>
                  <Badge variant={BILLING_STATUS_VARIANT[b.status]} size="sm">
                    {BILLING_STATUS_LABELS[b.status]}
                  </Badge>
                </TableCell>
                {canOperate ? (
                  <TableCell className="text-right">
                    <BillingActions billing={b} />
                  </TableCell>
                ) : null}
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </div>
      {rows.length > PAGE_SIZE ? <Pagination className="border-t border-border px-4 py-3" page={page} pageSize={PAGE_SIZE} total={rows.length} onPageChange={setPage} /> : null}
    </div>
  );
}
