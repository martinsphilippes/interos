"use client";

import * as React from "react";
import Link from "next/link";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { ExternalLink, FileSignature, FileText, MessageCircle, MoreVertical, Phone, UserRound } from "lucide-react";
import type { BillingState, WorkspaceRow } from "@/server/finance/workspace";
import { formatCurrency, formatDate } from "@/lib/format";
import { cn } from "@/lib/utils";
import { CONTRACT_STATUS_LABELS, CONTRACT_STATUS_VARIANT } from "@/components/clients/labels";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuSeparator, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import { EmptyState } from "@/components/ui/empty-state";
import { Pagination, paginate } from "@/components/ui/pagination";
import { Select } from "@/components/ui/select";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { contractDocumentPath } from "./contract-links";

const BILLING_STATE: Record<BillingState, { label: string; variant: "success" | "warning" | "danger" | "muted" }> = {
  pago: { label: "Pago", variant: "success" },
  em_aberto: { label: "Em aberto", variant: "warning" },
  vencido: { label: "Vencido", variant: "danger" },
  sem_cobranca: { label: "Sem cobrança", variant: "muted" },
};

const PAGE_SIZES = [10, 20, 50];

/** Cor do texto do status do contrato (mesma semântica dos badges). */
const STATUS_TEXT: Record<string, string> = { muted: "text-muted", info: "text-info-fg", success: "text-success-fg", warning: "text-warning-fg", danger: "text-danger-fg" };

function SignatureBadge({ row }: { row: WorkspaceRow }) {
  if (row.signersTotal === 0) return <Badge variant="danger" size="sm">Sem signatários</Badge>;
  if (!row.documentGenerated) return <Badge variant="muted" size="sm">Sem documento</Badge>;
  if (row.signersSigned === row.signersTotal) return <Badge variant="success" size="sm">Assinado</Badge>;
  return (
    <Badge variant="warning" size="sm">
      Aguardando {row.signersSigned}/{row.signersTotal}
    </Badge>
  );
}

function dueText(row: WorkspaceRow, short = false): string {
  return row.nextDueDate ? formatDate(row.nextDueDate, short ? "dd/MM/yy" : "dd/MM/yyyy") : `dia ${row.billingDay}`;
}

function RowMenu({ row, onSelect }: { row: WorkspaceRow; onSelect: () => void }) {
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button variant="ghost" size="icon" className="relative z-10 size-10 md:size-8" aria-label={`Mais ações do contrato ${row.number}`} onClick={(e) => e.stopPropagation()}>
          <MoreVertical />
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" onClick={(e) => e.stopPropagation()}>
        <DropdownMenuItem onSelect={onSelect}>
          <FileSignature /> Ver no painel
        </DropdownMenuItem>
        <DropdownMenuItem asChild>
          <Link href={`/financeiro/contratos/${row.id}`}>
            <ExternalLink /> Abrir contrato completo
          </Link>
        </DropdownMenuItem>
        <DropdownMenuItem asChild>
          <Link href={contractDocumentPath(row.id)}>
            <FileText /> Ver documento
          </Link>
        </DropdownMenuItem>
        {row.whatsappUrl || row.telUrl ? <DropdownMenuSeparator /> : null}
        {row.whatsappUrl ? (
          <DropdownMenuItem asChild>
            <a href={row.whatsappUrl} target="_blank" rel="noreferrer">
              <MessageCircle /> WhatsApp (registro manual)
            </a>
          </DropdownMenuItem>
        ) : null}
        {row.telUrl ? (
          <DropdownMenuItem asChild>
            <a href={row.telUrl}>
              <Phone /> Ligar (discador)
            </a>
          </DropdownMenuItem>
        ) : null}
        <DropdownMenuSeparator />
        <DropdownMenuItem asChild>
          <Link href={`/clientes/${row.clientId}?aba=financeiro`}>
            <UserRound /> Ficha do cliente
          </Link>
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

function ContactActions({ row, className }: { row: WorkspaceRow; className?: string }) {
  const stop = (e: React.MouseEvent) => e.stopPropagation();
  return (
    <div className={cn("relative z-10 flex items-center justify-end gap-0.5", className)}>
      {row.whatsappUrl ? (
        <Button asChild variant="ghost" size="icon" className="size-10 text-success-fg md:size-8">
          <a href={row.whatsappUrl} target="_blank" rel="noreferrer" onClick={stop} aria-label={`WhatsApp de ${row.clientName} (abre o app; registro manual)`} title="WhatsApp (abre o app · registro manual)">
            <MessageCircle />
          </a>
        </Button>
      ) : null}
      {row.telUrl ? (
        <Button asChild variant="ghost" size="icon" className="size-10 text-info-fg md:size-8">
          <a href={row.telUrl} onClick={stop} aria-label={`Ligar para ${row.clientName} (discador; registro manual)`} title="Ligar (discador · registro manual)">
            <Phone />
          </a>
        </Button>
      ) : null}
    </div>
  );
}

/**
 * Gestão de contratos: tabela (desktop) ou cards (celular) com seleção destacada. Selecionar grava
 * ?contrato=<id> na URL e o servidor carrega o painel lateral do contrato.
 */
export function ContractsWorkspaceTable({ rows, selectedId }: { rows: WorkspaceRow[]; selectedId?: string }) {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const [pending, startTransition] = React.useTransition();
  const [pageSize, setPageSize] = React.useState(10);
  const selectedIndex = rows.findIndex((r) => r.id === selectedId);
  const [page, setPage] = React.useState(() => (selectedIndex >= 0 ? Math.floor(selectedIndex / 10) + 1 : 1));

  const select = (id: string) => {
    const next = new URLSearchParams(searchParams.toString());
    next.set("contrato", id);
    startTransition(() => router.replace(`${pathname}?${next.toString()}`, { scroll: false }));
  };

  if (rows.length === 0) {
    return <EmptyState icon={<FileSignature />} title="Nenhum contrato encontrado" description="Ajuste os filtros ou crie um novo contrato." />;
  }
  const visible = paginate(rows, page, pageSize);

  return (
    <div aria-busy={pending || undefined}>
      <ul className="flex flex-col divide-y divide-border md:hidden">
        {visible.map((r) => (
          <li key={r.id} className={cn("relative", r.id === selectedId && "bg-brand-soft/60")}>
            <button type="button" onClick={() => select(r.id)} className="flex min-h-[44px] w-full flex-col gap-1.5 px-4 py-3 pr-24 text-left active:bg-surface-hover">
              <span className="truncate font-medium">{r.clientName}</span>
              <span className="text-xs text-muted">
                {r.number} · {r.productName} · {formatCurrency(r.amount)}
                {r.amountKind === "mensal" ? "/mês" : ""} · vence {dueText(r)}
              </span>
              <span className="flex flex-wrap items-center gap-1.5">
                <SignatureBadge row={r} />
                <Badge variant={BILLING_STATE[r.billingState].variant} size="sm">
                  {BILLING_STATE[r.billingState].label}
                </Badge>
                {r.status === "pendencia" ? <Badge variant="danger" size="sm">Pendência</Badge> : null}
              </span>
            </button>
            <div className="absolute right-2 top-2">
              <ContactActions row={r} />
            </div>
          </li>
        ))}
      </ul>

      <div className="hidden md:block">
        {/* Com o painel lateral (xl) a tabela fica estreita: até 2xl produto/responsável vão para baixo do cliente,
            o vencimento para baixo do valor e WhatsApp/Ligar para o menu da linha. */}
        <Table className="min-w-[640px]">
          <TableHeader>
            <TableRow>
              <TableHead>Contrato</TableHead>
              <TableHead>Cliente</TableHead>
              <TableHead className="hidden 2xl:table-cell">Produto principal</TableHead>
              <TableHead className="text-right">Valor</TableHead>
              <TableHead className="hidden 2xl:table-cell">Vencimento</TableHead>
              <TableHead>Assinatura</TableHead>
              <TableHead>Financeiro</TableHead>
              <TableHead className="hidden 2xl:table-cell">Responsável</TableHead>
              <TableHead className="w-12 text-right">
                <span className="sr-only 2xl:not-sr-only">Ações</span>
              </TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {visible.map((r) => (
              <TableRow key={r.id} clickable selected={r.id === selectedId} className="relative cursor-pointer" onClick={() => select(r.id)}>
                <TableCell className="max-w-[130px] font-medium">
                  <span className="whitespace-nowrap">
                    <button
                      type="button"
                      className="text-left hover:text-brand-fg focus-visible:outline-brand"
                      onClick={(e) => {
                        e.stopPropagation();
                        select(r.id);
                      }}
                      aria-pressed={r.id === selectedId}
                    >
                      {r.number}
                    </button>
                    <span className="ml-1 text-xs text-muted">v{r.version}</span>
                  </span>
                  <span className={cn("mt-0.5 flex items-center gap-1.5 text-xs font-normal", STATUS_TEXT[CONTRACT_STATUS_VARIANT[r.status]] ?? "text-muted")}>
                    <span className="size-1.5 shrink-0 rounded-full bg-current" aria-hidden />
                    {CONTRACT_STATUS_LABELS[r.status]}
                  </span>
                </TableCell>
                <TableCell className="max-w-[150px] 2xl:max-w-[220px]">
                  <span className="block truncate">{r.clientName}</span>
                  <span className="block truncate text-xs text-muted 2xl:hidden">
                    {r.productName}
                    {r.extraProducts > 0 ? ` +${r.extraProducts}` : ""}
                    {r.ownerName ? ` · ${r.ownerName}` : ""}
                  </span>
                  {r.pendingReason ? (
                    <span className="block truncate text-xs text-danger-fg" title={r.pendingReason}>
                      {r.pendingReason}
                    </span>
                  ) : null}
                </TableCell>
                <TableCell className="hidden max-w-[180px] 2xl:table-cell">
                  <span className="block truncate">{r.productName}</span>
                  {r.extraProducts > 0 ? <span className="text-xs text-muted">+{r.extraProducts} item(ns)</span> : null}
                </TableCell>
                <TableCell className="whitespace-nowrap text-right tabular-nums">
                  {formatCurrency(r.amount)}
                  <span className="text-xs text-muted">{r.amountKind === "mensal" ? "/mês" : ""}</span>
                  {r.amountKind === "unico" ? <span className="block text-xs text-muted">valor único</span> : null}
                  <span className="block text-xs text-muted 2xl:hidden">vence {dueText(r, true)}</span>
                </TableCell>
                <TableCell className="hidden whitespace-nowrap tabular-nums 2xl:table-cell">{dueText(r)}</TableCell>
                <TableCell className="whitespace-nowrap">
                  <span className="inline-flex items-center gap-1">
                    <SignatureBadge row={r} />
                    <Link
                      href={contractDocumentPath(r.id)}
                      onClick={(e) => e.stopPropagation()}
                      className="relative z-10 inline-flex size-6 items-center justify-center rounded-md text-muted hover:bg-surface-hover hover:text-foreground"
                      aria-label={`Documento do contrato ${r.number}`}
                      title="Ver documento do contrato"
                    >
                      <FileText className="size-4" />
                    </Link>
                  </span>
                </TableCell>
                <TableCell>
                  <Badge variant={BILLING_STATE[r.billingState].variant} size="sm">
                    {BILLING_STATE[r.billingState].label}
                  </Badge>
                </TableCell>
                <TableCell className="hidden whitespace-nowrap text-sm 2xl:table-cell">{r.ownerName ?? <span className="text-muted-light">—</span>}</TableCell>
                <TableCell>
                  <div className="flex items-center justify-end gap-0.5">
                    <ContactActions row={r} className="hidden 2xl:flex" />
                    <RowMenu row={r} onSelect={() => select(r.id)} />
                  </div>
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </div>

      <div className="flex flex-col gap-3 border-t border-border px-4 py-3 sm:flex-row sm:items-center sm:justify-between">
        <label className="flex items-center gap-2 text-sm text-muted">
          Itens por página
          <Select
            size="sm"
            className="w-20"
            value={String(pageSize)}
            onChange={(e) => {
              setPageSize(Number(e.target.value));
              setPage(1);
            }}
            options={PAGE_SIZES.map((n) => ({ value: String(n), label: String(n) }))}
            aria-label="Itens por página"
          />
        </label>
        <Pagination page={page} pageSize={pageSize} total={rows.length} onPageChange={setPage} />
      </div>
    </div>
  );
}
