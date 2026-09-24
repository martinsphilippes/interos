"use client";

import * as React from "react";
import { Target } from "lucide-react";
import { Avatar } from "@/components/ui/avatar";
import { EmptyState } from "@/components/ui/empty-state";
import { Pagination, paginate } from "@/components/ui/pagination";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { formatCurrency } from "@/lib/format";
import type { OpportunityRow, PipelineStage, ProductOption, UserLite } from "@/server/sales/queries";
import { NextActionLabel, ProposalIcon, StageBadge, TemperatureDot } from "./opportunity-bits";
import { OpportunityFilterBar, applyFilters, readFilters } from "./opportunity-filters";
import { useSalesUrl } from "./use-sales-url";
import { RelativeTime } from "@/components/ui/relative-time";

export interface OpportunitiesTableProps {
  rows: OpportunityRow[];
  stages: PipelineStage[];
  sellers: UserLite[];
  products: ProductOption[];
  currentUserId: string;
  competence: string;
}

const PAGE_SIZE = 25;

/** Tabela completa com filtros/ordenação na URL; vira cards no celular. Clique abre o drawer. */
export function OpportunitiesTable({ rows, stages, sellers, products, currentUserId, competence }: OpportunitiesTableProps) {
  const { searchParams, navigate } = useSalesUrl();
  const filters = React.useMemo(() => readFilters((k) => searchParams.get(k)), [searchParams]);
  const filtered = React.useMemo(() => applyFilters(rows, filters, { userId: currentUserId, competence }), [rows, filters, currentUserId, competence]);
  const [page, setPage] = React.useState(1);
  const [prevFiltered, setPrevFiltered] = React.useState(filtered);
  if (filtered !== prevFiltered) {
    setPrevFiltered(filtered);
    setPage(1);
  }
  const visible = paginate(filtered, page, PAGE_SIZE);
  const stageLabel = (key: string) => stages.find((s) => s.key === key)?.label;
  const open = (id: string) => navigate({ oportunidade: id });
  const totals = filtered.reduce((acc, r) => ({ monthly: acc.monthly + r.monthlyTotal, setup: acc.setup + r.setupTotal }), { monthly: 0, setup: 0 });

  return (
    <div>
      <OpportunityFilterBar filters={filters} sellers={sellers} products={products} variant="tabela" stages={stages} count={filtered.length} total={rows.length} />
      {filtered.length === 0 ? (
        <div className="rounded-lg border border-border bg-surface">
          <EmptyState icon={<Target />} title="Nenhuma oportunidade encontrada" description="Ajuste os filtros ou limpe-os para ver todas." />
        </div>
      ) : (
        <>
          <div className="hidden overflow-hidden rounded-lg border border-border bg-surface md:block">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Cliente / oportunidade</TableHead>
                  <TableHead>Etapa</TableHead>
                  <TableHead className="text-right">Mensal</TableHead>
                  <TableHead className="text-right">Adesão</TableHead>
                  <TableHead>Próxima ação</TableHead>
                  <TableHead>Vendedor</TableHead>
                  <TableHead>Atividade</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {visible.map((r) => (
                  <TableRow key={r.id} clickable onClick={() => open(r.id)}>
                    <TableCell className="max-w-[320px]">
                      <div className="flex items-center gap-2">
                        <TemperatureDot temperature={r.temperature} withLabel={false} />
                        <span className="truncate font-medium">{r.clientName}</span>
                        <ProposalIcon status={r.proposalStatus} />
                      </div>
                      <p className="truncate text-xs text-muted">{r.title}</p>
                    </TableCell>
                    <TableCell>
                      <StageBadge stage={r.stage} label={stageLabel(r.stage)} />
                      {r.stalled ? <span className="ml-1.5 text-xs font-medium text-warning-fg">parada</span> : null}
                    </TableCell>
                    <TableCell className="text-right tabular-nums">{formatCurrency(r.monthlyTotal)}</TableCell>
                    <TableCell className="text-right tabular-nums">{formatCurrency(r.setupTotal)}</TableCell>
                    <TableCell className="max-w-[240px]">
                      <NextActionLabel opp={r} />
                    </TableCell>
                    <TableCell>
                      <span className="inline-flex items-center gap-2">
                        <Avatar name={r.ownerName} src={r.ownerAvatarUrl} size="xs" />
                        <span className="truncate text-sm">{r.ownerName}</span>
                      </span>
                    </TableCell>
                    <TableCell className="whitespace-nowrap text-xs text-muted"><RelativeTime value={r.lastActivityAt} /></TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>
          <ul className="flex flex-col gap-2 md:hidden">
            {visible.map((r) => (
              <li key={r.id}>
                <button type="button" onClick={() => open(r.id)} className="w-full rounded-lg border border-border bg-surface p-3 text-left shadow-card active:bg-surface-hover">
                  <div className="flex items-center justify-between gap-2">
                    <span className="flex min-w-0 items-center gap-2">
                      <TemperatureDot temperature={r.temperature} withLabel={false} />
                      <span className="truncate font-medium">{r.clientName}</span>
                    </span>
                    <StageBadge stage={r.stage} label={stageLabel(r.stage)} />
                  </div>
                  <p className="mt-0.5 truncate text-xs text-muted">{r.title}</p>
                  <p className="mt-1.5 text-sm font-medium tabular-nums">
                    {formatCurrency(r.monthlyTotal)}/mês <span className="font-normal text-muted">+ {formatCurrency(r.setupTotal)} adesão</span>
                  </p>
                  <div className="mt-1.5 flex items-center justify-between gap-2">
                    <NextActionLabel opp={r} compact />
                    <Avatar name={r.ownerName} src={r.ownerAvatarUrl} size="xs" />
                  </div>
                </button>
              </li>
            ))}
          </ul>
          <div className="mt-3 flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
            <p className="text-xs text-muted tabular-nums">
              Soma do filtro: {formatCurrency(totals.monthly)}/mês · {formatCurrency(totals.setup)} adesão
            </p>
            <Pagination page={page} pageSize={PAGE_SIZE} total={filtered.length} onPageChange={setPage} />
          </div>
        </>
      )}
    </div>
  );
}
