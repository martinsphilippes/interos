"use client";

import * as React from "react";
import { AlertTriangle, ChevronRight, Copy, UserPlus } from "lucide-react";
import { Avatar } from "@/components/ui/avatar";
import { Badge } from "@/components/ui/badge";
import { Card } from "@/components/ui/card";
import { EmptyState } from "@/components/ui/empty-state";
import { Pagination, paginate } from "@/components/ui/pagination";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { formatDateTime, formatPhone } from "@/lib/format";
import { LeadStatusBadge, ScorePill, TemperatureBadge } from "./lead-badges";
import type { LeadListItem } from "./marketing-model";
import { useMarketingUrl } from "./use-marketing-url";
import { RelativeTime } from "@/components/ui/relative-time";

const PAGE_SIZE = 25;

function Flags({ lead }: { lead: LeadListItem }) {
  return (
    <span className="flex flex-wrap gap-1">
      {lead.noContact ? (
        <Badge variant="danger" size="sm">
          <AlertTriangle /> Sem contato
        </Badge>
      ) : null}
      {lead.overdue ? (
        <Badge variant="warning" size="sm">
          Ação vencida
        </Badge>
      ) : null}
      {lead.possibleDuplicate ? (
        <Badge variant="outline" size="sm">
          <Copy /> Duplicidade?
        </Badge>
      ) : null}
    </span>
  );
}

/** Lista de leads: tabela no desktop e cards no celular. Clicar abre o drawer (?lead=<id>). */
export function LeadsTable({ items, filtered }: { items: LeadListItem[]; filtered: boolean }) {
  const { navigate } = useMarketingUrl();
  const [page, setPage] = React.useState(1);
  const [prevItems, setPrevItems] = React.useState(items);
  if (items !== prevItems) {
    setPrevItems(items);
    setPage(1);
  }
  const open = (id: string) => navigate({ lead: id });

  if (items.length === 0) {
    return (
      <Card>
        <EmptyState
          icon={<UserPlus />}
          title={filtered ? "Nenhum lead com esses filtros" : "Nenhum lead cadastrado"}
          description={filtered ? "Ajuste a busca ou limpe os filtros." : "Cadastre um lead, importe um CSV ou conecte o webhook do site."}
        />
      </Card>
    );
  }
  const rows = paginate(items, page, PAGE_SIZE);

  return (
    <div className="flex flex-col gap-3">
      <Card className="hidden overflow-hidden md:block">
        <Table className="min-w-[980px]">
          <TableHeader>
            <TableRow>
              <TableHead>Lead</TableHead>
              <TableHead>Score</TableHead>
              <TableHead>Status</TableHead>
              <TableHead>Origem / campanha</TableHead>
              <TableHead>Responsável</TableHead>
              <TableHead>Último contato</TableHead>
              <TableHead>Próxima ação</TableHead>
              <TableHead>Alertas</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {rows.map((lead) => (
              <TableRow key={lead.id} clickable onClick={() => open(lead.id)}>
                <TableCell>
                  <button
                    type="button"
                    className="flex flex-col text-left"
                    onClick={(e) => {
                      e.stopPropagation();
                      open(lead.id);
                    }}
                  >
                    <span className="font-medium text-foreground">{lead.name}</span>
                    <span className="text-xs text-muted">
                      {[lead.company, lead.city, lead.phone ? formatPhone(lead.phone) : lead.email].filter(Boolean).join(" · ") || "—"}
                    </span>
                  </button>
                </TableCell>
                <TableCell>
                  <span className="flex items-center gap-1.5">
                    <ScorePill score={lead.score} temperature={lead.temperature} />
                    <TemperatureBadge temperature={lead.temperature} />
                  </span>
                </TableCell>
                <TableCell>
                  <LeadStatusBadge status={lead.status} />
                </TableCell>
                <TableCell className="text-sm">
                  <span className="block">{lead.originName}</span>
                  {lead.campaignName ? <span className="block max-w-[200px] truncate text-xs text-muted">{lead.campaignName}</span> : null}
                </TableCell>
                <TableCell>
                  {lead.ownerName ? (
                    <span className="flex items-center gap-2 text-sm">
                      <Avatar name={lead.ownerName} size="xs" /> {lead.ownerName.split(" ")[0]}
                    </span>
                  ) : (
                    <span className="text-sm text-muted-light">—</span>
                  )}
                </TableCell>
                <TableCell className="text-sm text-muted">{lead.lastContactAt ? <RelativeTime value={lead.lastContactAt} /> : "Nunca"}</TableCell>
                <TableCell className="text-sm">
                  {lead.nextActionAt ? <span className={lead.overdue ? "font-medium text-danger-fg" : undefined}>{formatDateTime(lead.nextActionAt)}</span> : <span className="text-muted-light">—</span>}
                  {lead.nextAction ? <span className="block max-w-[180px] truncate text-xs text-muted">{lead.nextAction}</span> : null}
                </TableCell>
                <TableCell>
                  <Flags lead={lead} />
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </Card>

      <ul className="flex flex-col gap-2 md:hidden">
        {rows.map((lead) => (
          <li key={lead.id}>
            <button type="button" onClick={() => open(lead.id)} className="flex min-h-[64px] w-full items-center gap-3 rounded-lg border border-border bg-surface p-3 text-left shadow-card">
              <ScorePill score={lead.score} temperature={lead.temperature} />
              <span className="flex min-w-0 flex-1 flex-col gap-1">
                <span className="truncate font-medium">{lead.name}</span>
                <span className="truncate text-xs text-muted">{[lead.company, lead.originName, lead.ownerName].filter(Boolean).join(" · ")}</span>
                <span className="flex flex-wrap items-center gap-1">
                  <LeadStatusBadge status={lead.status} />
                  <Flags lead={lead} />
                </span>
              </span>
              <ChevronRight className="size-4 shrink-0 text-muted-light" />
            </button>
          </li>
        ))}
      </ul>

      {items.length > PAGE_SIZE ? <Pagination page={page} pageSize={PAGE_SIZE} total={items.length} onPageChange={setPage} /> : null}
    </div>
  );
}
