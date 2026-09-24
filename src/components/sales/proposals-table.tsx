"use client";

import * as React from "react";
import { FileText, Plus } from "lucide-react";
import type { Opportunity, Proposal } from "@/domain/types";
import { Button } from "@/components/ui/button";
import { EmptyState } from "@/components/ui/empty-state";
import { SearchInput } from "@/components/ui/search-input";
import { Select } from "@/components/ui/select";
import { Switch } from "@/components/ui/switch";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { formatCurrency, formatDate } from "@/lib/format";
import type { ProductOption, ProposalRow } from "@/server/sales/queries";
import { PROPOSAL_STATUS_LABELS } from "./model";
import { ProposalStatusBadge } from "./opportunity-bits";
import { ProposalEditorDialog } from "./proposal-editor-dialog";
import { useSalesUrl } from "./use-sales-url";

const STATUSES: Proposal["status"][] = ["rascunho", "enviada", "visualizada", "negociacao", "aceita", "recusada", "vencida"];

function normalize(text: string): string {
  return text
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase();
}

export interface ProposalsTableProps {
  rows: ProposalRow[];
  opportunityOptions: { id: string; title: string; clientName: string; products: Opportunity["products"] }[];
  products: ProductOption[];
}

/** Lista de propostas com filtro por status (efetivo, inclui vencida) e busca; vira cards no celular. */
export function ProposalsTable({ rows, opportunityOptions, products }: ProposalsTableProps) {
  const { searchParams, setLocal, navigate } = useSalesUrl();
  const [creating, setCreating] = React.useState(false);
  const q = searchParams.get("q") ?? "";
  const status = searchParams.get("status") ?? "";
  const allVersions = searchParams.get("versoes") === "1";
  const term = normalize(q.trim());
  const filtered = rows.filter(
    (r) =>
      (allVersions || r.isLatest) &&
      (!status || r.effectiveStatus === status) &&
      (!term || normalize(`${r.number} ${r.clientName} ${r.opportunityTitle} ${r.ownerName}`).includes(term)),
  );
  const open = (id: string) => navigate({ proposta: id });

  return (
    <div>
      <div className="mb-4 flex flex-col gap-2 md:flex-row md:items-center">
        <SearchInput value={q} onChange={(v) => setLocal({ q: v })} debounceMs={200} placeholder="Buscar número, cliente ou vendedor…" size="sm" className="md:w-80" />
        <Select size="sm" aria-label="Status" value={status} onChange={(e) => setLocal({ status: e.target.value })} className="md:w-48">
          <option value="">Todos os status</option>
          {STATUSES.map((s) => (
            <option key={s} value={s}>
              {PROPOSAL_STATUS_LABELS[s]}
            </option>
          ))}
        </Select>
        <Switch size="sm" checked={allVersions} onCheckedChange={(v) => setLocal({ versoes: v ? "1" : null })} label="Mostrar versões anteriores" />
        <span className="text-xs text-muted tabular-nums md:ml-auto">
          {filtered.length} de {rows.length}
        </span>
        <Button onClick={() => setCreating(true)} disabled={opportunityOptions.length === 0} className="min-h-[44px] md:min-h-0">
          <Plus /> Nova proposta
        </Button>
      </div>

      {filtered.length === 0 ? (
        <div className="rounded-lg border border-border bg-surface">
          <EmptyState icon={<FileText />} title="Nenhuma proposta encontrada" description={rows.length === 0 ? "Crie a primeira proposta a partir de uma oportunidade aberta." : "Ajuste os filtros."} />
        </div>
      ) : (
        <>
          <div className="hidden overflow-hidden rounded-lg border border-border bg-surface md:block">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Número</TableHead>
                  <TableHead>Cliente / oportunidade</TableHead>
                  <TableHead>Status</TableHead>
                  <TableHead className="text-right">Mensal</TableHead>
                  <TableHead className="text-right">Adesão</TableHead>
                  <TableHead>Validade</TableHead>
                  <TableHead>Vendedor</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {filtered.map((r) => (
                  <TableRow key={r.id} clickable onClick={() => open(r.id)}>
                    <TableCell className="whitespace-nowrap font-medium tabular-nums">
                      {r.number} <span className="text-muted">v{r.version}</span>
                    </TableCell>
                    <TableCell className="max-w-[300px]">
                      <p className="truncate font-medium">{r.clientName}</p>
                      <p className="truncate text-xs text-muted">{r.opportunityTitle}</p>
                    </TableCell>
                    <TableCell>
                      <ProposalStatusBadge status={r.effectiveStatus} />
                    </TableCell>
                    <TableCell className="text-right tabular-nums">{formatCurrency(r.monthlyTotal)}</TableCell>
                    <TableCell className="text-right tabular-nums">{formatCurrency(r.setupTotal)}</TableCell>
                    <TableCell className="whitespace-nowrap text-sm">{formatDate(r.validUntil)}</TableCell>
                    <TableCell className="text-sm">{r.ownerName}</TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>
          <ul className="flex flex-col gap-2 md:hidden">
            {filtered.map((r) => (
              <li key={r.id}>
                <button type="button" onClick={() => open(r.id)} className="w-full rounded-lg border border-border bg-surface p-3 text-left shadow-card active:bg-surface-hover">
                  <div className="flex items-center justify-between gap-2">
                    <span className="font-medium tabular-nums">
                      {r.number} v{r.version}
                    </span>
                    <ProposalStatusBadge status={r.effectiveStatus} />
                  </div>
                  <p className="mt-0.5 truncate text-sm">{r.clientName}</p>
                  <p className="mt-1 text-xs text-muted tabular-nums">
                    {formatCurrency(r.monthlyTotal)}/mês · {formatCurrency(r.setupTotal)} adesão · até {formatDate(r.validUntil)}
                  </p>
                </button>
              </li>
            ))}
          </ul>
        </>
      )}
      {creating ? <ProposalEditorDialog open onOpenChange={setCreating} opportunityOptions={opportunityOptions} products={products} onSaved={(id) => navigate({ proposta: id })} /> : null}
    </div>
  );
}
