import Link from "next/link";
import { Building2, ChevronRight, Plus } from "lucide-react";
import type { ClientListItem } from "@/server/clients/queries";
import { formatCurrency, formatDocument, formatRelative } from "@/lib/format";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Avatar } from "@/components/ui/avatar";
import { EmptyState } from "@/components/ui/empty-state";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { ClientStatusBadge, HealthIndicator, StageBadge } from "./client-badges";

export interface ClientsTableProps {
  items: ClientListItem[];
  /** Há filtros ativos (muda o texto do estado vazio). */
  filtered?: boolean;
}

function Owners({ client }: { client: ClientListItem }) {
  const owners = [
    client.ownerSales ? { ...client.ownerSales, role: "Comercial" } : null,
    client.ownerCs ? { ...client.ownerCs, role: "CS" } : null,
  ].filter((o): o is NonNullable<typeof o> => o !== null);
  if (owners.length === 0) return <span className="text-muted-light">—</span>;
  return (
    <span className="flex -space-x-1.5">
      {owners.map((o) => (
        <Avatar key={`${o.role}-${o.id}`} name={o.name} src={o.avatarUrl} size="sm" className="ring-2 ring-surface" title={`${o.role}: ${o.name}`} />
      ))}
    </span>
  );
}

function cityLabel(client: ClientListItem): string {
  const city = client.address?.city;
  const state = client.address?.state;
  if (!city && !state) return "—";
  return [city, state].filter(Boolean).join("/");
}

/** Tabela densa (md+) e cards (mobile) da lista de clientes. Linhas inteiras levam à ficha 360º. */
export function ClientsTable({ items, filtered }: ClientsTableProps) {
  if (items.length === 0) {
    return (
      <Card>
        <EmptyState
          icon={<Building2 />}
          title={filtered ? "Nenhum cliente com esses filtros" : "Nenhum cliente cadastrado"}
          description={filtered ? "Ajuste a busca ou limpe os filtros para ver outros clientes." : "Cadastre o primeiro cliente para iniciar a jornada dele no INTEROS."}
          action={
            !filtered ? (
              <Button asChild>
                <Link href="/clientes/novo">
                  <Plus /> Novo cliente
                </Link>
              </Button>
            ) : undefined
          }
        />
      </Card>
    );
  }

  return (
    <>
      {/* Desktop */}
      <Card className="hidden overflow-hidden md:block">
        <Table className="min-w-[960px]">
          <TableHeader>
            <TableRow>
              <TableHead>Cliente</TableHead>
              <TableHead>CNPJ/CPF</TableHead>
              <TableHead>Cidade</TableHead>
              <TableHead>Status</TableHead>
              <TableHead>Etapa</TableHead>
              <TableHead className="text-right">MRR</TableHead>
              <TableHead>Saúde</TableHead>
              <TableHead>Responsáveis</TableHead>
              <TableHead>Última interação</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {items.map((client) => (
              <TableRow key={client.id} className="relative">
                <TableCell className="max-w-[280px]">
                  <Link href={`/clientes/${client.id}`} className="block min-w-0 after:absolute after:inset-0 after:content-['']">
                    <span className="block truncate font-medium text-foreground">{client.tradeName}</span>
                    <span className="block truncate text-xs text-muted">{client.legalName}</span>
                  </Link>
                </TableCell>
                <TableCell className="whitespace-nowrap tabular-nums text-muted">{formatDocument(client.document)}</TableCell>
                <TableCell className="whitespace-nowrap">{cityLabel(client)}</TableCell>
                <TableCell>
                  <ClientStatusBadge status={client.status} />
                </TableCell>
                <TableCell>
                  <StageBadge stage={client.currentStage} />
                </TableCell>
                <TableCell className="whitespace-nowrap text-right tabular-nums">{client.mrr > 0 ? formatCurrency(client.mrr) : <span className="text-muted-light">—</span>}</TableCell>
                <TableCell>
                  <HealthIndicator score={client.healthScore} level={client.healthLevel} />
                </TableCell>
                <TableCell>
                  <Owners client={client} />
                </TableCell>
                <TableCell className="whitespace-nowrap text-muted">{client.lastInteractionAt ? formatRelative(client.lastInteractionAt) : "—"}</TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </Card>

      {/* Mobile */}
      <ul className="flex flex-col gap-2 md:hidden">
        {items.map((client) => (
          <li key={client.id}>
            <Link href={`/clientes/${client.id}`} className="flex min-h-[44px] items-center gap-3 rounded-lg border border-border bg-surface p-3 shadow-card transition-colors active:bg-surface-hover">
              <div className="min-w-0 flex-1">
                <div className="flex items-center gap-2">
                  <p className="min-w-0 flex-1 truncate font-medium">{client.tradeName}</p>
                  <ClientStatusBadge status={client.status} />
                </div>
                <p className="mt-0.5 truncate text-xs text-muted">
                  {cityLabel(client)} · {formatDocument(client.document)}
                </p>
                <div className="mt-2 flex flex-wrap items-center gap-x-3 gap-y-1 text-xs">
                  <StageBadge stage={client.currentStage} />
                  {client.mrr > 0 ? <span className="tabular-nums text-foreground">{formatCurrency(client.mrr)}/mês</span> : null}
                  <HealthIndicator score={client.healthScore} level={client.healthLevel} />
                  <span className="text-muted">{client.lastInteractionAt ? formatRelative(client.lastInteractionAt) : "sem interação"}</span>
                </div>
              </div>
              <Owners client={client} />
              <ChevronRight className="size-4 shrink-0 text-muted-light" aria-hidden />
            </Link>
          </li>
        ))}
      </ul>
    </>
  );
}
