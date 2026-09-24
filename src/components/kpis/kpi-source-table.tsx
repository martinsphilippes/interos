"use client";

import * as React from "react";
import Link from "next/link";
import { CheckCircle2, ExternalLink, XCircle } from "lucide-react";
import type { KpiSource } from "@/server/kpis/formulas";
import { formatKpiValue, type KpiUnit } from "@/server/kpis/schemas";
import { formatDate } from "@/lib/format";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { EmptyState } from "@/components/ui/empty-state";
import { SearchInput } from "@/components/ui/search-input";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";

const COLLECTION_LABELS: Record<string, string> = {
  leads: "Lead",
  opportunities: "Oportunidade",
  contracts: "Contrato",
  billing: "Cobrança",
  implementation_projects: "Projeto",
  support_tickets: "Chamado",
  clients: "Cliente",
  tasks: "Tarefa",
  workflow_steps: "Etapa",
  csat_responses: "Avaliação",
  churn_records: "Churn",
  renewals: "Renovação",
  cs_accounts: "Conta de CS",
  campaigns: "Campanha",
};

const PAGE = 50;

export interface KpiSourceTableProps {
  sources: KpiSource[];
  /** Coluna de valor (rótulo e unidade); omitida quando nenhum registro tem valor. */
  valueColumn?: { label: string; unit: KpiUnit; suffix?: string };
  /** Nomes dos colaboradores por id (coluna "Responsável"). */
  users: Record<string, string>;
  /** Rótulos da coluna de situação para razões (padrão: "Conta a favor" / "Conta contra"). */
  okLabels?: { ok: string; notOk: string };
}

function normalize(text: string): string {
  return text
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase();
}

/**
 * Tabela de origem do indicador: cada registro que compõe o número, com link para a tela do registro
 * (cliente, oportunidade, chamado, contrato, projeto, tarefa, lead). Vira lista de cartões no celular.
 */
export function KpiSourceTable({ sources, valueColumn, users, okLabels = { ok: "A favor", notOk: "Contra" } }: KpiSourceTableProps) {
  const [query, setQuery] = React.useState("");
  const [limit, setLimit] = React.useState(PAGE);
  const hasValue = Boolean(valueColumn) && sources.some((s) => typeof s.value === "number");
  const hasOk = sources.some((s) => s.ok !== undefined);

  const filtered = React.useMemo(() => {
    const term = normalize(query.trim());
    if (!term) return sources;
    return sources.filter((s) => normalize([s.label, s.detail, COLLECTION_LABELS[s.collection], s.userId ? users[s.userId] : ""].filter(Boolean).join(" ")).includes(term));
  }, [query, sources, users]);
  const visible = filtered.slice(0, limit);

  if (sources.length === 0) {
    return <EmptyState size="sm" title="Nenhum registro compõe este número" description="Não há registros no período e escopo selecionados." />;
  }

  const value = (s: KpiSource) => (typeof s.value === "number" && valueColumn ? formatKpiValue(s.value, valueColumn.unit, valueColumn.suffix) : "—");
  const okBadge = (s: KpiSource) =>
    s.ok === undefined ? null : s.ok ? (
      <Badge variant="success" size="sm">
        <CheckCircle2 aria-hidden /> {okLabels.ok}
      </Badge>
    ) : (
      <Badge variant="danger" size="sm">
        <XCircle aria-hidden /> {okLabels.notOk}
      </Badge>
    );

  return (
    <div className="flex flex-col gap-3">
      {sources.length > 8 ? (
        <SearchInput
          value={query}
          onChange={(next) => {
            setQuery(next);
            setLimit(PAGE);
          }}
          placeholder="Filtrar registros"
          aria-label="Filtrar registros de origem"
          className="max-w-sm"
        />
      ) : null}

      {/* Celular: cartões */}
      <ul className="flex flex-col gap-2 md:hidden">
        {visible.map((s, i) => (
          <li key={`${s.collection}-${s.id}-${i}`}>
            <Link href={s.href} className="flex min-h-[44px] flex-col gap-1 rounded-lg border border-border bg-surface p-3 transition-colors hover:bg-surface-muted">
              <span className="flex items-start justify-between gap-2">
                <span className="text-sm font-medium text-foreground">{s.label}</span>
                {hasValue ? <span className="shrink-0 text-sm font-semibold tabular-nums">{value(s)}</span> : null}
              </span>
              {s.detail ? <span className="text-xs text-muted">{s.detail}</span> : null}
              <span className="flex flex-wrap items-center gap-2 text-xs text-muted">
                <Badge variant="outline" size="sm">
                  {COLLECTION_LABELS[s.collection] ?? s.collection}
                </Badge>
                {s.date ? <span>{formatDate(s.date)}</span> : null}
                {s.userId && users[s.userId] ? <span>{users[s.userId]}</span> : null}
                {okBadge(s)}
              </span>
            </Link>
          </li>
        ))}
      </ul>

      {/* Desktop: tabela */}
      <div className="hidden md:block">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Registro</TableHead>
              <TableHead>Tipo</TableHead>
              <TableHead>Data</TableHead>
              <TableHead>Responsável</TableHead>
              {hasOk ? <TableHead>Situação</TableHead> : null}
              {hasValue ? <TableHead className="text-right">{valueColumn!.label}</TableHead> : null}
            </TableRow>
          </TableHeader>
          <TableBody>
            {visible.map((s, i) => (
              <TableRow key={`${s.collection}-${s.id}-${i}`}>
                <TableCell className="max-w-[360px]">
                  <Link href={s.href} className="group inline-flex items-start gap-1.5 font-medium text-foreground hover:text-brand">
                    <span className="line-clamp-2">{s.label}</span>
                    <ExternalLink className="mt-0.5 size-3.5 shrink-0 text-muted-light group-hover:text-brand" aria-hidden />
                  </Link>
                  {s.detail ? <p className="mt-0.5 truncate text-xs text-muted">{s.detail}</p> : null}
                </TableCell>
                <TableCell className="text-muted">{COLLECTION_LABELS[s.collection] ?? s.collection}</TableCell>
                <TableCell className="whitespace-nowrap tabular-nums text-muted">{s.date ? formatDate(s.date) : "—"}</TableCell>
                <TableCell className="text-muted">{s.userId ? (users[s.userId] ?? "—") : "—"}</TableCell>
                {hasOk ? <TableCell>{okBadge(s)}</TableCell> : null}
                {hasValue ? <TableCell className="text-right font-medium tabular-nums">{value(s)}</TableCell> : null}
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </div>

      <div className="flex flex-wrap items-center justify-between gap-2 text-xs text-muted">
        <span>
          {visible.length} de {filtered.length} registro(s){filtered.length !== sources.length ? ` (filtrados de ${sources.length})` : ""}
        </span>
        {filtered.length > limit ? (
          <Button variant="outline" size="sm" className="min-h-[44px] md:min-h-0" onClick={() => setLimit((l) => l + PAGE)}>
            Mostrar mais
          </Button>
        ) : null}
      </div>
    </div>
  );
}
