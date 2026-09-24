import Link from "next/link";
import { ExternalLink, Headset, Repeat, Smile, Ticket } from "lucide-react";
import type { Client360 } from "@/server/clients/queries";
import { formatDate, formatNumber, formatPercent, formatRelative } from "@/lib/format";
import { Badge } from "@/components/ui/badge";
import { Card } from "@/components/ui/card";
import { EmptyState } from "@/components/ui/empty-state";
import { SectionTitle } from "@/components/ui/section-title";
import { SlaBadge } from "@/components/ui/sla-badge";
import { StatCard } from "@/components/ui/stat-card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { UserCell } from "./client-badges";
import { TICKET_PRIORITY_LABELS, TICKET_PRIORITY_VARIANT, TICKET_STATUS_LABELS, TICKET_STATUS_VARIANT } from "./labels";

const CHANNEL_LABELS: Record<string, string> = { whatsapp: "WhatsApp", telefone: "Telefone", email: "E-mail", portal: "Portal", interno: "Interno" };

/** Aba Suporte: chamados com SLA calculado, reincidência (reabertos/total) e CSAT médio. */
export function TabSuporte({ data, action }: { data: Client360; action?: React.ReactNode }) {
  const { tickets, support, users } = data;
  const reopenTone = support.total === 0 ? "neutral" : support.reopenRate > 0.1 ? "danger" : support.reopenRate > 0 ? "warning" : "success";
  const csatTone = support.csatAverage === undefined ? "neutral" : support.csatAverage >= 8.5 ? "success" : support.csatAverage >= 7 ? "warning" : "danger";

  return (
    <div className="flex flex-col gap-5">
      {action ? <div className="flex flex-wrap items-center justify-end gap-2">{action}</div> : null}
      <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
        <StatCard label="Chamados abertos" value={formatNumber(support.open)} icon={<Ticket />} tone={support.open > 0 ? "info" : "neutral"} hint={`${formatNumber(support.total)} no total`} compact />
        <StatCard label="Reincidência" value={support.total > 0 ? formatPercent(support.reopenRate) : "—"} icon={<Repeat />} tone={reopenTone} hint={`${support.reopened} reaberto${support.reopened === 1 ? "" : "s"} · meta ≤ 10%`} compact />
        <StatCard
          label="CSAT médio"
          value={support.csatAverage !== undefined ? support.csatAverage.toFixed(1) : "—"}
          icon={<Smile />}
          tone={csatTone}
          hint={support.csatCount > 0 ? `${support.csatCount} avaliação${support.csatCount === 1 ? "" : "ões"} · meta > 8,5` : "sem avaliações"}
          compact
        />
        <StatCard label="Resolvidos" value={formatNumber(tickets.filter((t) => t.status === "resolvido" || t.status === "fechado").length)} icon={<Headset />} tone="success" compact />
      </div>

      <section>
        <SectionTitle title="Chamados" count={tickets.length} />
        <Card className="overflow-hidden">
          {tickets.length === 0 ? (
            <EmptyState size="sm" icon={<Headset />} title="Nenhum chamado" description="Chamados abertos pelo cliente em qualquer canal aparecem aqui." />
          ) : (
            <Table className="min-w-[960px]">
              <TableHeader>
                <TableRow>
                  <TableHead>Número</TableHead>
                  <TableHead>Assunto</TableHead>
                  <TableHead>Prioridade</TableHead>
                  <TableHead>Status</TableHead>
                  <TableHead>Atendente</TableHead>
                  <TableHead>Abertura</TableHead>
                  <TableHead>SLA</TableHead>
                  <TableHead className="text-right">CSAT</TableHead>
                  <TableHead className="w-10" />
                </TableRow>
              </TableHeader>
              <TableBody>
                {tickets.map((t) => (
                  <TableRow key={t.id}>
                    <TableCell className="whitespace-nowrap font-medium tabular-nums">
                      {t.number}
                      {t.reopenedFromId ? <p className="text-xs font-normal text-danger-fg">reaberto</p> : null}
                    </TableCell>
                    <TableCell className="max-w-[300px]">
                      <p className="truncate">{t.subject}</p>
                      <p className="truncate text-xs text-muted">
                        {[t.category, CHANNEL_LABELS[t.channel] ?? t.channel, t.queue?.toUpperCase()].filter(Boolean).join(" · ")}
                      </p>
                    </TableCell>
                    <TableCell>
                      <Badge variant={TICKET_PRIORITY_VARIANT[t.priority]} size="sm">
                        {TICKET_PRIORITY_LABELS[t.priority]}
                      </Badge>
                    </TableCell>
                    <TableCell>
                      <Badge variant={TICKET_STATUS_VARIANT[t.status]} size="sm">
                        {TICKET_STATUS_LABELS[t.status]}
                      </Badge>
                    </TableCell>
                    <TableCell>
                      <UserCell users={users} id={t.assigneeId} />
                    </TableCell>
                    <TableCell className="whitespace-nowrap text-muted" title={formatDate(t.openedAt, "dd/MM/yyyy HH:mm")}>
                      {formatRelative(t.openedAt)}
                      {t.resolvedAt ? <p className="text-xs">resolvido {formatDate(t.resolvedAt, "dd/MM HH:mm")}</p> : null}
                    </TableCell>
                    <TableCell>{t.sla ? <SlaBadge state={t.sla.state} remainingMs={t.sla.remainingMs} /> : <span className="text-muted-light">—</span>}</TableCell>
                    <TableCell className="text-right tabular-nums">{t.csatScore !== undefined ? t.csatScore : <span className="text-muted-light">—</span>}</TableCell>
                    <TableCell>
                      <Link href={`/suporte/chamados/${t.id}`} className="inline-flex size-8 items-center justify-center rounded-md text-muted hover:bg-surface-hover hover:text-foreground" aria-label={`Abrir chamado ${t.number}`}>
                        <ExternalLink className="size-4" />
                      </Link>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}
        </Card>
      </section>
    </div>
  );
}
