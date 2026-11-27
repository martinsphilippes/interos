"use client";
/**
 * Lista de Administração › Empresas ERP: busca (cliente, empresa no ERP, id ou CNPJ) e filtro por situação, com a
 * opção "Sem empresa no ERP" para os clientes ativos que ainda não foram vinculados. Paginada (a tela aguenta milhares
 * de empresas). Cada linha leva à aba Módulos ERP do cliente, onde ficam as ações (alterar módulos, aprovar, tentar de
 * novo, vincular ou criar a empresa).
 */
import * as React from "react";
import Link from "next/link";
import { ArrowRight, Building2 } from "lucide-react";
import { CLIENT_STATUS_LABELS, type ClientStatus } from "@/domain/constants";
import { ERP_DISPLAY_SHORT, type ErpDisplayMode } from "@/domain/erp/license";
import { ERP_EVENT_LABELS, type ErpEventType } from "@/domain/erp/events";
import {
  ERP_COMPANY_SITUATIONS,
  ERP_COMPANY_SITUATION_HINTS,
  ERP_COMPANY_SITUATION_LABELS,
  countBySituation,
  matchesErpCompany,
  needsAttention,
  type ErpCompanyRow,
  type ErpCompanySituation,
} from "@/domain/erp/companies";
import { formatDateTime, formatDocument } from "@/lib/format";
import { Badge } from "@/components/ui/badge";
import { EmptyState } from "@/components/ui/empty-state";
import { FilterBar, FilterField } from "@/components/ui/filter-bar";
import { Pagination, paginate } from "@/components/ui/pagination";
import { SearchInput } from "@/components/ui/search-input";
import { Select } from "@/components/ui/select";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";

type Filter = "todas" | "atencao" | ErpCompanySituation | "sem_vinculo";
const PAGE_SIZE = 50;

const TONE: Record<ErpCompanySituation, "danger" | "warning" | "info" | "muted" | "success"> = {
  falha: "danger",
  nao_aplicada: "danger",
  aguardando_aprovacao: "warning",
  enviando: "info",
  erro_leitura: "warning",
  aviso_erp: "warning",
  sem_licenca: "muted",
  em_dia: "success",
};

export interface ErpUnlinkedRow {
  clientId: string;
  clientName: string;
  clientStatus: string;
  document: string | null;
}

export interface ErpCompaniesListProps {
  rows: ErpCompanyRow[];
  unlinked: ErpUnlinkedRow[];
  /** A pessoa abre a aba Módulos ERP do cliente (sem isso, a lista só informa). */
  canOpenClient: boolean;
  initialFilter?: string;
}

const clientHref = (clientId: string) => `/clientes/${encodeURIComponent(clientId)}?aba=erp`;
const eventLabel = (type: string) => ERP_EVENT_LABELS[type as ErpEventType] ?? type;
const statusLabel = (status: string | null) => (status ? (CLIENT_STATUS_LABELS[status as ClientStatus] ?? status) : "—");
/** "Aguardando aprovação" vale por qualquer alteração esperando aprovação, mesmo que outra seja mais urgente. */
const inFilter = (r: ErpCompanyRow, f: Filter) => (f === "todas" ? true : f === "atencao" ? needsAttention(r) : f === "aguardando_aprovacao" ? r.awaitingApproval : r.situation === f);

function licenseText(row: ErpCompanyRow): { main: string; detail: string | null } {
  if (!row.license) return { main: "Não registrada", detail: "a primeira alteração parte do que a empresa usa no ERP" };
  const l = row.license;
  const main = `v${l.appliedVersion} · ${l.units} ${l.units === 1 ? "unidade" : "unidades"} em ${l.modules} ${l.modules === 1 ? "módulo" : "módulos"}`;
  const parts = [
    l.issuedVersion > l.appliedVersion ? `emitida v${l.issuedVersion}` : null,
    l.display ? `desligado: ${ERP_DISPLAY_SHORT[l.display as ErpDisplayMode] ?? l.display}` : null,
    l.unitDisplays ? `${l.unitDisplays} por unidade` : null,
  ].filter(Boolean);
  return { main, detail: parts.length ? parts.join(" · ") : null };
}

function SituationCell({ row }: { row: ErpCompanyRow }) {
  return (
    <div className="flex flex-col gap-1">
      <Badge variant={TONE[row.situation]} size="sm" title={ERP_COMPANY_SITUATION_HINTS[row.situation]} className="w-fit">
        {ERP_COMPANY_SITUATION_LABELS[row.situation]}
      </Badge>
      {row.open ? (
        <span className="text-xs text-muted">
          {row.open.kind === "provisionamento" ? "Criação da empresa" : "Alteração"} de {row.open.requestedBy}, {formatDateTime(row.open.requestedAt)}
        </span>
      ) : null}
      {row.open?.lastError ? <span className="line-clamp-2 text-xs text-danger-fg">{row.open.lastError}</span> : null}
      {row.open?.status === "falhou" ? (
        <span className="text-xs text-muted">{row.open.nextAttemptAt ? `Nova tentativa automática: ${formatDateTime(row.open.nextAttemptAt)}` : "Sem nova tentativa automática: resolva na aba Módulos ERP."}</span>
      ) : null}
      {row.awaitingApproval && row.situation !== "aguardando_aprovacao" ? <span className="text-xs text-warning-fg">Também há alteração aguardando aprovação.</span> : null}
      {row.situation === "nao_aplicada" && row.notApplied ? (
        <span className="line-clamp-2 text-xs text-danger-fg">
          {row.notApplied.status === "conflito" ? "Outra versão já estava no ERP" : "Recusada pelo ERP"} em {formatDateTime(row.notApplied.at)}
          {row.notApplied.message ? `: ${row.notApplied.message}` : ""}
        </span>
      ) : null}
      {row.situation === "erro_leitura" && row.lastSyncError ? <span className="line-clamp-2 text-xs text-warning-fg">{row.lastSyncError.message}</span> : null}
      {row.warning ? (
        <span className="text-xs text-warning-fg">
          {eventLabel(row.warning.type)} · {formatDateTime(row.warning.at)}
        </span>
      ) : null}
    </div>
  );
}

function ClientName({ clientId, name, canOpen }: { clientId: string; name: string; canOpen: boolean }) {
  return canOpen ? (
    <Link href={clientHref(clientId)} className="font-medium hover:text-brand-fg hover:underline">
      {name}
    </Link>
  ) : (
    <span className="font-medium">{name}</span>
  );
}

function OpenLink({ row, canOpen }: { row: Pick<ErpCompanyRow, "clientId" | "clientName">; canOpen: boolean }) {
  if (!canOpen) return null;
  return (
    <Link href={clientHref(row.clientId)} aria-label={`Abrir os módulos ERP de ${row.clientName}`} className="inline-flex shrink-0 rounded p-1 text-muted hover:bg-surface-hover hover:text-foreground">
      <ArrowRight className="size-4" aria-hidden />
    </Link>
  );
}

export function ErpCompaniesList({ rows, unlinked, canOpenClient, initialFilter }: ErpCompaniesListProps) {
  const counts = React.useMemo(() => countBySituation(rows), [rows]);
  const attention = React.useMemo(() => rows.filter(needsAttention).length, [rows]);
  const awaiting = React.useMemo(() => rows.filter((r) => r.awaitingApproval).length, [rows]);
  const valid = (f: string | undefined): f is Filter => f === "todas" || f === "atencao" || f === "sem_vinculo" || (ERP_COMPANY_SITUATIONS as readonly string[]).includes(f ?? "");
  const [filter, setFilter] = React.useState<Filter>(valid(initialFilter) ? initialFilter : "todas");
  const [query, setQuery] = React.useState("");
  const [page, setPage] = React.useState(1);
  // filtro ou busca novos voltam à primeira página
  const changeFilter = (f: Filter) => {
    setFilter(f);
    setPage(1);
  };
  const changeQuery = (q: string) => {
    setQuery(q);
    setPage(1);
  };

  const shown = React.useMemo(() => rows.filter((r) => inFilter(r, filter) && matchesErpCompany(r, query)), [rows, filter, query]);
  const shownUnlinked = React.useMemo(() => unlinked.filter((c) => matchesErpCompany({ clientName: c.clientName, cnpj: c.document }, query)), [unlinked, query]);
  const pageRows = paginate(shown, page, PAGE_SIZE);
  const pageUnlinked = paginate(shownUnlinked, page, PAGE_SIZE);

  const options = [
    { value: "todas", label: `Todas as vinculadas (${rows.length})` },
    { value: "atencao", label: `Precisam de atenção (${attention})` },
    ...ERP_COMPANY_SITUATIONS.map((s) => ({ s, n: s === "aguardando_aprovacao" ? awaiting : counts[s] }))
      .filter(({ s, n }) => n > 0 || s === filter)
      .map(({ s, n }) => ({ value: s, label: `${ERP_COMPANY_SITUATION_LABELS[s]} (${n})` })),
    { value: "sem_vinculo", label: `Clientes sem empresa no ERP (${unlinked.length})` },
  ];

  return (
    <section className="flex flex-col gap-3">
      <FilterBar className="mb-0">
        <FilterField label="Buscar" htmlFor="erp-empresas-busca" className="min-w-[240px] flex-1">
          <SearchInput id="erp-empresas-busca" value={query} onChange={changeQuery} debounceMs={150} placeholder="Cliente, empresa no ERP, ID ou CNPJ" />
        </FilterField>
        <FilterField label="Situação" htmlFor="erp-empresas-filtro" className="min-w-[240px]">
          <Select id="erp-empresas-filtro" value={filter} onChange={(e) => changeFilter(e.target.value as Filter)} options={options} aria-label="Filtrar por situação" />
        </FilterField>
      </FilterBar>

      {filter === "sem_vinculo" ? (
        <>
          <UnlinkedList rows={pageUnlinked} total={shownUnlinked.length} canOpenClient={canOpenClient} />
          {shownUnlinked.length > PAGE_SIZE ? <Pagination page={page} pageSize={PAGE_SIZE} total={shownUnlinked.length} onPageChange={setPage} /> : null}
        </>
      ) : shown.length === 0 ? (
        <EmptyState
          icon={<Building2 />}
          title={rows.length === 0 ? "Nenhuma empresa vinculada ao ERP neste ambiente" : "Nenhuma empresa nesta busca"}
          description={
            rows.length === 0
              ? "Vincule ou crie a empresa na aba Módulos ERP do cliente. Os clientes ativos ainda sem empresa aparecem no filtro “Clientes sem empresa no ERP”."
              : "Tente outro termo ou outra situação."
          }
          size="sm"
        />
      ) : (
        <>
          <p className="text-xs text-muted">
            {shown.length} {shown.length === 1 ? "empresa" : "empresas"}. Estado registrado no INTEROS; o estado ao vivo de cada uma fica na aba Módulos ERP do cliente.
          </p>
          {/* Celular: cartões. */}
          <ul className="flex flex-col gap-2 md:hidden">
            {pageRows.map((r) => {
              const lic = licenseText(r);
              return (
                <li key={r.linkId} className="rounded-lg border border-border bg-surface p-3">
                  <div className="flex items-start justify-between gap-2">
                    <div className="min-w-0">
                      <ClientName clientId={r.clientId} name={r.clientName} canOpen={canOpenClient} />
                      <p className="truncate text-xs text-muted">
                        {r.erpCompanyName ?? "—"} · ID ERP <span className="font-mono">{r.erpCompanyId}</span>
                      </p>
                    </div>
                    <OpenLink row={r} canOpen={canOpenClient} />
                  </div>
                  <p className="mt-2 text-sm">{lic.main}</p>
                  {lic.detail ? <p className="text-xs text-muted">{lic.detail}</p> : null}
                  <div className="mt-2">
                    <SituationCell row={r} />
                  </div>
                  <p className="mt-2 text-xs text-muted">Última leitura do ERP: {r.lastSyncAt ? formatDateTime(r.lastSyncAt) : "—"}</p>
                </li>
              );
            })}
          </ul>
          {/* Telas maiores: tabela. */}
          <div className="hidden md:block">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Cliente</TableHead>
                  <TableHead>Empresa no ERP</TableHead>
                  <TableHead>Licença no INTEROS</TableHead>
                  <TableHead>Situação</TableHead>
                  <TableHead>ERP</TableHead>
                  <TableHead className="w-10">
                    <span className="sr-only">Abrir</span>
                  </TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {pageRows.map((r) => {
                  const lic = licenseText(r);
                  return (
                    <TableRow key={r.linkId}>
                      <TableCell className="align-top">
                        <ClientName clientId={r.clientId} name={r.clientName} canOpen={canOpenClient} />
                        <p className="text-xs text-muted">{statusLabel(r.clientStatus)}</p>
                      </TableCell>
                      <TableCell className="align-top">
                        <p>{r.erpCompanyName ?? "—"}</p>
                        <p className="text-xs text-muted">
                          <span className="font-mono">{r.erpCompanyId}</span>
                          {r.cnpj ? ` · ${formatDocument(r.cnpj)}` : ""}
                          {r.erpKind ? ` · ${r.erpKind}` : ""}
                        </p>
                      </TableCell>
                      <TableCell className="align-top">
                        <p>{lic.main}</p>
                        {lic.detail ? <p className="text-xs text-muted">{lic.detail}</p> : null}
                        {r.license?.appliedAt ? <p className="text-xs text-muted">confirmada {formatDateTime(r.license.appliedAt)}</p> : null}
                      </TableCell>
                      <TableCell className="align-top">
                        <SituationCell row={r} />
                      </TableCell>
                      <TableCell className="align-top text-xs text-muted">
                        <p>Leitura: {r.lastSyncAt ? formatDateTime(r.lastSyncAt) : "—"}</p>
                        <p>{r.lastEvent ? `${eventLabel(r.lastEvent.type)}: ${formatDateTime(r.lastEvent.at)}` : "Sem evento registrado"}</p>
                      </TableCell>
                      <TableCell className="align-top">
                        <OpenLink row={r} canOpen={canOpenClient} />
                      </TableCell>
                    </TableRow>
                  );
                })}
              </TableBody>
            </Table>
          </div>
          {shown.length > PAGE_SIZE ? <Pagination page={page} pageSize={PAGE_SIZE} total={shown.length} onPageChange={setPage} /> : null}
        </>
      )}
    </section>
  );
}

function UnlinkedList({ rows, total, canOpenClient }: { rows: ErpUnlinkedRow[]; total: number; canOpenClient: boolean }) {
  if (!total) return <EmptyState icon={<Building2 />} title="Todos os clientes ativos já têm empresa no ERP" description="Ou nenhum cliente desta busca está sem empresa." size="sm" />;
  return (
    <>
      <p className="text-xs text-muted">
        {total} {total === 1 ? "cliente ativo ou em implantação" : "clientes ativos ou em implantação"} sem empresa no ERP neste ambiente. Na aba Módulos ERP do cliente dá para vincular uma empresa que
        já usa o ERP ou criar a empresa.
      </p>
      <ul className="divide-y divide-border rounded-lg border border-border">
        {rows.map((c) => (
          <li key={c.clientId} className="flex flex-wrap items-center justify-between gap-2 px-3 py-2 text-sm">
            <span className="min-w-0">
              <ClientName clientId={c.clientId} name={c.clientName} canOpen={canOpenClient} />
              <span className="ml-2 text-xs text-muted">
                {statusLabel(c.clientStatus)}
                {c.document ? ` · ${formatDocument(c.document)}` : ""}
              </span>
            </span>
            {canOpenClient ? (
              <Link href={clientHref(c.clientId)} className="text-xs font-medium text-brand-fg hover:underline">
                Vincular ou criar no ERP
              </Link>
            ) : null}
          </li>
        ))}
      </ul>
    </>
  );
}
