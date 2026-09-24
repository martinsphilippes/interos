import Link from "next/link";
import { ChevronRight, FileSignature } from "lucide-react";
import type { ContractRow } from "@/server/finance/queries";
import { formatCurrency, formatDate, formatRelative } from "@/lib/format";
import { Badge } from "@/components/ui/badge";
import { EmptyState } from "@/components/ui/empty-state";
import { SlaBadge } from "@/components/ui/sla-badge";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { CONTRACT_STATUS_LABELS, CONTRACT_STATUS_VARIANT } from "@/components/clients/labels";
import { FINANCIAL_STATUS_LABELS, FINANCIAL_STATUS_VARIANT } from "@/server/finance/schemas";
import { cn } from "@/lib/utils";

const href = (id: string) => `/financeiro/contratos/${id}`;

function Signatures({ row }: { row: ContractRow }) {
  if (row.signersTotal === 0) return <span className="text-xs text-danger-fg">Sem signatários</span>;
  const done = row.signersSigned === row.signersTotal;
  return (
    <span className={cn("text-sm tabular-nums", done ? "text-success-fg" : "text-muted")}>
      {row.signersSigned}/{row.signersTotal} {done ? "assinado" : "assinaturas"}
    </span>
  );
}

function Sla({ row }: { row: ContractRow }) {
  if (!row.sla) return <span className="text-sm text-muted-light">—</span>;
  return <SlaBadge state={row.sla.state} remainingMs={row.sla.remainingMs} />;
}

/** Fila de contratos: tabela no desktop, cards no celular. Cada linha abre a página do contrato. */
export function ContractsTable({ rows, emptyDescription }: { rows: ContractRow[]; emptyDescription?: string }) {
  if (rows.length === 0) {
    return <EmptyState icon={<FileSignature />} title="Nenhum contrato encontrado" description={emptyDescription ?? "Ajuste os filtros ou aguarde novas vendas ganhas."} />;
  }
  return (
    <>
      <ul className="flex flex-col divide-y divide-border md:hidden">
        {rows.map((r) => (
          <li key={r.id}>
            <Link href={href(r.id)} className="flex min-h-[44px] items-start gap-3 px-4 py-3 active:bg-surface-hover">
              <div className="min-w-0 flex-1">
                <div className="flex items-center gap-2">
                  <span className="truncate font-medium">{r.clientName}</span>
                </div>
                <p className="text-xs text-muted">
                  {r.number} v{r.version} · {formatCurrency(r.monthlyTotal)}/mês{r.setupTotal > 0 ? ` · adesão ${formatCurrency(r.setupTotal)}` : ""}
                </p>
                <div className="mt-2 flex flex-wrap items-center gap-2">
                  <Badge variant={CONTRACT_STATUS_VARIANT[r.status]} size="sm">
                    {CONTRACT_STATUS_LABELS[r.status]}
                  </Badge>
                  <Signatures row={r} />
                  {r.sla ? <Sla row={r} /> : null}
                </div>
                {r.pendingReason ? <p className="mt-1 text-xs text-danger-fg">{r.pendingReason}</p> : null}
              </div>
              <ChevronRight className="mt-1 size-4 shrink-0 text-muted-light" aria-hidden />
            </Link>
          </li>
        ))}
      </ul>
      <div className="hidden md:block">
        <Table className="min-w-[1100px]">
          <TableHeader>
            <TableRow>
              <TableHead>Contrato</TableHead>
              <TableHead>Cliente</TableHead>
              <TableHead>Status</TableHead>
              <TableHead className="text-right">Adesão</TableHead>
              <TableHead className="text-right">Mensal</TableHead>
              <TableHead className="text-right">Hardware</TableHead>
              <TableHead>Assinatura</TableHead>
              <TableHead>Financeiro</TableHead>
              <TableHead>Responsável</TableHead>
              <TableHead>Criado / atualizado</TableHead>
              <TableHead>SLA da etapa</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {rows.map((r) => (
              <TableRow key={r.id} className="relative">
                <TableCell className="whitespace-nowrap font-medium">
                  <Link href={href(r.id)} className="after:absolute after:inset-0 hover:text-brand focus-visible:outline-brand">
                    {r.number}
                  </Link>{" "}
                  <span className="text-xs text-muted">v{r.version}</span>
                </TableCell>
                <TableCell className="max-w-[220px] truncate">{r.clientName}</TableCell>
                <TableCell>
                  <Badge variant={CONTRACT_STATUS_VARIANT[r.status]} size="sm">
                    {CONTRACT_STATUS_LABELS[r.status]}
                  </Badge>
                  {r.pendingReason ? <p className="mt-1 max-w-[220px] truncate text-xs text-danger-fg" title={r.pendingReason}>{r.pendingReason}</p> : null}
                </TableCell>
                <TableCell className="whitespace-nowrap text-right tabular-nums">{formatCurrency(r.setupTotal)}</TableCell>
                <TableCell className="whitespace-nowrap text-right tabular-nums">{formatCurrency(r.monthlyTotal)}</TableCell>
                <TableCell className="whitespace-nowrap text-right tabular-nums">{formatCurrency(r.hardwareTotal)}</TableCell>
                <TableCell className="whitespace-nowrap">
                  <Signatures row={r} />
                </TableCell>
                <TableCell>
                  <Badge variant={FINANCIAL_STATUS_VARIANT[r.financialStatus]} size="sm">
                    {FINANCIAL_STATUS_LABELS[r.financialStatus]}
                  </Badge>
                </TableCell>
                <TableCell className="whitespace-nowrap text-sm">{r.ownerName ?? <span className="text-muted-light">—</span>}</TableCell>
                <TableCell className="whitespace-nowrap text-xs text-muted">
                  {formatDate(r.createdAt)}
                  <br />
                  {formatRelative(r.updatedAt)}
                </TableCell>
                <TableCell className="whitespace-nowrap">
                  <Sla row={r} />
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </div>
    </>
  );
}
