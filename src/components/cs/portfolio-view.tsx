"use client";

import * as React from "react";
import Link from "next/link";
import { AlertTriangle, CalendarCheck, CheckSquare, MessageCircle, Phone, Users } from "lucide-react";
import type { PortfolioResult, PortfolioRow } from "@/server/cs/queries";
import { HEALTH_LEVEL_LABELS } from "@/server/cs/schemas";
import { HEALTH_LEVELS } from "@/domain/constants";
import { formatCurrency, formatDate, formatRelative } from "@/lib/format";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { EmptyState } from "@/components/ui/empty-state";
import { Progress } from "@/components/ui/progress";
import { SearchInput } from "@/components/ui/search-input";
import { Select } from "@/components/ui/select";
import { Switch } from "@/components/ui/switch";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { ContactEventDialog } from "@/components/clients/contact-event-dialog";
import { ActivateButton } from "./activate-button";
import { CheckpointDialog } from "./checkpoint-dialog";
import { ChipList, HealthIndicator, OwnerCell, relationshipLabel } from "./cs-bits";
import { ScopeSelect } from "./scope-select";
import { useCsUrl } from "./use-cs";

// ---------------------------------------------------------------------------
// Filtros
// ---------------------------------------------------------------------------

export function PortfolioFilters({ data }: { data: Pick<PortfolioResult, "scope" | "filters" | "owners" | "products"> }) {
  const { navigate } = useCsUrl();
  const { filters } = data;
  const levelOptions = [{ value: "", label: "Todas" }, ...HEALTH_LEVELS.map((l) => ({ value: l, label: HEALTH_LEVEL_LABELS[l] }))];
  return (
    <div className="flex flex-col gap-2 md:flex-row md:flex-wrap md:items-center">
      <SearchInput size="sm" value={filters.q ?? ""} onChange={(q) => navigate({ q }, { replace: true })} debounceMs={400} placeholder="Buscar cliente…" className="md:w-56" />
      <ScopeSelect owners={data.owners} value={data.scope.param} />
      <div className="grid grid-cols-3 gap-2 md:flex">
        <Select aria-label="Saúde" size="sm" className="md:w-36" value={filters.health ?? ""} onChange={(e) => navigate({ saude: e.target.value })} options={levelOptions.map((o) => (o.value ? o : { ...o, label: "Saúde: todas" }))} />
        <Select aria-label="Risco da conta" size="sm" className="md:w-36" value={filters.risk ?? ""} onChange={(e) => navigate({ risco: e.target.value })} options={levelOptions.map((o) => (o.value ? o : { ...o, label: "Risco: todos" }))} />
        <Select aria-label="Produto" size="sm" className="md:w-44" value={filters.productId ?? ""} onChange={(e) => navigate({ produto: e.target.value })} options={[{ value: "", label: "Produto: todos" }, ...data.products.map((p) => ({ value: p.id, label: p.name }))]} />
      </div>
      <Switch size="sm" label="Sem interação há 30+ dias" checked={Boolean(filters.noInteraction)} onCheckedChange={(v) => navigate({ sem_interacao: v ? "1" : null })} className="md:ml-1" />
    </div>
  );
}

// ---------------------------------------------------------------------------
// Ações da linha
// ---------------------------------------------------------------------------

function RowActions({ row, compact }: { row: PortfolioRow; compact?: boolean }) {
  const iconBtn = "size-11 md:size-8";
  return (
    <div className={cn("flex items-center gap-1", compact ? "flex-wrap" : "justify-end")}>
      <CheckpointDialog
        clientId={row.clientId}
        clientName={row.tradeName}
        adoptionPct={row.adoptionPct}
        trigger={
          <Button variant="ghost" size="icon" className={iconBtn} aria-label={`Registrar checkpoint de ${row.tradeName}`} title="Registrar checkpoint">
            <CalendarCheck />
          </Button>
        }
      />
      <ContactEventDialog
        clientId={row.clientId}
        clientName={row.tradeName}
        channel="whatsapp"
        contacts={row.contacts}
        clientPhone={row.phone}
        clientWhatsapp={row.whatsapp}
        trigger={
          <Button variant="ghost" size="icon" className={iconBtn} aria-label={`WhatsApp para ${row.tradeName}`} title="WhatsApp">
            <MessageCircle />
          </Button>
        }
      />
      <ContactEventDialog
        clientId={row.clientId}
        clientName={row.tradeName}
        channel="ligacao"
        contacts={row.contacts}
        clientPhone={row.phone}
        clientWhatsapp={row.whatsapp}
        trigger={
          <Button variant="ghost" size="icon" className={iconBtn} aria-label={`Ligar para ${row.tradeName}`} title="Ligar">
            <Phone />
          </Button>
        }
      />
      <Button asChild variant="ghost" size="icon" className={iconBtn} title="Nova tarefa">
        <Link href={`/tarefas?novo=1&cliente=${row.clientId}`} aria-label={`Nova tarefa para ${row.tradeName}`}>
          <CheckSquare />
        </Link>
      </Button>
      {row.activationPending ? <ActivateButton clientId={row.clientId} clientName={row.tradeName} variant="outline" /> : null}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Células
// ---------------------------------------------------------------------------

function FinanceCell({ row }: { row: PortfolioRow }) {
  if (row.overdueCount === 0) return <span className="text-sm text-success-fg">Em dia</span>;
  return (
    <span className="text-sm text-danger-fg" title={`${row.overdueCount} cobrança(s) vencida(s)`}>
      Vencido · {formatCurrency(row.overdueAmount)}
    </span>
  );
}

function NextCell({ row }: { row: PortfolioRow }) {
  if (!row.nextInteractionAt) return <span className="text-sm text-muted-light">Sem agenda</span>;
  return (
    <span className={cn("whitespace-nowrap text-sm", row.nextOverdue && "font-medium text-danger-fg")} title={formatDate(row.nextInteractionAt)}>
      {row.nextOverdue ? "Vencida " : ""}
      {formatRelative(row.nextInteractionAt)}
    </span>
  );
}

function RiskCell({ row }: { row: PortfolioRow }) {
  if (row.riskReasons.length === 0) return <span className="text-sm text-muted-light">—</span>;
  return (
    <span className={cn("inline-flex items-center gap-1 text-sm", row.riskLevel === "risco" ? "text-danger-fg" : "text-warning-fg")} title={row.riskReasons.join("\n")}>
      <AlertTriangle className="size-3.5" /> {row.riskReasons.length} motivo(s)
    </span>
  );
}

const adoptionTone = (v: number) => (v >= 70 ? "success" : v >= 40 ? "warning" : "danger");

// ---------------------------------------------------------------------------
// Tabela (desktop) e cards (celular)
// ---------------------------------------------------------------------------

export function PortfolioTable({ rows }: { rows: PortfolioRow[] }) {
  if (rows.length === 0) {
    return (
      <Card>
        <EmptyState icon={<Users />} title="Nenhum cliente na carteira" description="Ajuste os filtros ou escolha outra carteira. Clientes entram na carteira de CS após o go-live." />
      </Card>
    );
  }
  return (
    <>
      <Card className="hidden overflow-hidden md:block">
        <Table className="min-w-[1500px]">
          <TableHeader>
            <TableRow>
              <TableHead>Cliente</TableHead>
              <TableHead>Produtos</TableHead>
              <TableHead className="text-right">MRR</TableHead>
              <TableHead>Relacionamento</TableHead>
              <TableHead>Saúde</TableHead>
              <TableHead>Adoção</TableHead>
              <TableHead className="text-right">CSAT 90d</TableHead>
              <TableHead className="text-right">Chamados</TableHead>
              <TableHead>Financeiro</TableHead>
              <TableHead>Última interação</TableHead>
              <TableHead>Próxima</TableHead>
              <TableHead>Risco</TableHead>
              <TableHead className="text-right">Oport.</TableHead>
              <TableHead className="text-right">Ações</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {rows.map((r) => (
              <TableRow key={r.clientId}>
                <TableCell className="min-w-[200px]">
                  <Link href={`/clientes/${r.clientId}?aba=cs`} className="font-medium hover:text-brand hover:underline">
                    {r.tradeName}
                  </Link>
                  <div className="mt-0.5">
                    <OwnerCell owner={r.owner} />
                  </div>
                </TableCell>
                <TableCell className="max-w-[220px]">
                  <ChipList items={r.products.map((p) => p.name)} max={2} />
                </TableCell>
                <TableCell className="text-right tabular-nums">{formatCurrency(r.mrr)}</TableCell>
                <TableCell className="whitespace-nowrap text-muted">{relationshipLabel(r.activatedAt)}</TableCell>
                <TableCell>
                  <Link href={`/cs/saude?cliente=${r.clientId}`} className="hover:underline" title="Ver fatores do score">
                    <HealthIndicator score={r.healthScore} level={r.healthLevel} />
                  </Link>
                </TableCell>
                <TableCell className="w-32">{r.adoptionPct !== undefined ? <Progress value={r.adoptionPct} size="sm" showValue tone={adoptionTone(r.adoptionPct)} /> : <span className="text-muted-light">—</span>}</TableCell>
                <TableCell className="text-right tabular-nums">{r.csatAvg !== undefined ? r.csatAvg.toFixed(1) : <span className="text-muted-light">—</span>}</TableCell>
                <TableCell className={cn("text-right tabular-nums", r.openTickets > 0 && "font-medium")}>{r.openTickets}</TableCell>
                <TableCell className="whitespace-nowrap">
                  <FinanceCell row={r} />
                </TableCell>
                <TableCell className="whitespace-nowrap text-sm text-muted">{r.lastInteractionAt ? formatRelative(r.lastInteractionAt) : "—"}</TableCell>
                <TableCell>
                  <NextCell row={r} />
                </TableCell>
                <TableCell>
                  <RiskCell row={r} />
                </TableCell>
                <TableCell className="text-right tabular-nums">{r.openOpportunities}</TableCell>
                <TableCell>
                  <RowActions row={r} />
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </Card>

      <ul className="flex flex-col gap-3 md:hidden">
        {rows.map((r) => (
          <li key={r.clientId}>
            <Card className="flex flex-col gap-3 p-4">
              <div className="flex items-start justify-between gap-3">
                <div className="min-w-0">
                  <Link href={`/clientes/${r.clientId}?aba=cs`} className="font-medium hover:underline">
                    {r.tradeName}
                  </Link>
                  <p className="text-xs text-muted">
                    {formatCurrency(r.mrr)}/mês · cliente há {relationshipLabel(r.activatedAt)}
                  </p>
                </div>
                <Link href={`/cs/saude?cliente=${r.clientId}`}>
                  <HealthIndicator score={r.healthScore} level={r.healthLevel} showLabel />
                </Link>
              </div>
              <ChipList items={r.products.map((p) => p.name)} max={3} />
              <dl className="grid grid-cols-2 gap-x-3 gap-y-2 text-sm">
                <div>
                  <dt className="label-caps">Adoção</dt>
                  <dd>{r.adoptionPct !== undefined ? `${r.adoptionPct}%` : "—"}</dd>
                </div>
                <div>
                  <dt className="label-caps">CSAT 90d</dt>
                  <dd>{r.csatAvg !== undefined ? r.csatAvg.toFixed(1) : "—"}</dd>
                </div>
                <div>
                  <dt className="label-caps">Chamados abertos</dt>
                  <dd>{r.openTickets}</dd>
                </div>
                <div>
                  <dt className="label-caps">Financeiro</dt>
                  <dd>
                    <FinanceCell row={r} />
                  </dd>
                </div>
                <div>
                  <dt className="label-caps">Última interação</dt>
                  <dd>{r.lastInteractionAt ? formatRelative(r.lastInteractionAt) : "—"}</dd>
                </div>
                <div>
                  <dt className="label-caps">Próxima</dt>
                  <dd>
                    <NextCell row={r} />
                  </dd>
                </div>
              </dl>
              {r.riskReasons.length > 0 ? <ChipList items={r.riskReasons} max={2} variant={r.riskLevel === "risco" ? "danger" : "warning"} /> : null}
              <RowActions row={r} compact />
            </Card>
          </li>
        ))}
      </ul>
    </>
  );
}
