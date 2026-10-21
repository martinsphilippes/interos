import Link from "next/link";
import { Clock, ExternalLink, Headset, Mail, MessageCircle, MessagesSquare, Repeat, Smile, Ticket } from "lucide-react";
import type { Client360 } from "@/server/clients/queries";
import type { ClientConversations } from "@/server/conversations/client-view";
import { formatDurationShort } from "@/domain/conversation-history";
import { formatDate, formatDateTime, formatNumber, formatPercent, formatPhone, formatRelative } from "@/lib/format";
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

/**
 * Aba Atendimentos (chave «suporte»): conversas da Central (WhatsApp e e-mail), como falar com cada contato, e os
 * chamados com SLA calculado, reincidência (reabertos/total) e CSAT médio.
 */
export function TabSuporte({
  data,
  action,
  conversations,
  links = { central: false, history: false },
}: {
  data: Client360;
  action?: React.ReactNode;
  conversations?: ClientConversations | null;
  links?: { central: boolean; history: boolean };
}) {
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
        {conversations ? (
          <>
            <StatCard
              label="Conversas (90 dias)"
              value={formatNumber(conversations.total90d)}
              icon={<MessagesSquare />}
              tone="neutral"
              hint={`WhatsApp ${conversations.byChannel90d.whatsapp} · e-mail ${conversations.byChannel90d.email}`}
              compact
            />
            <StatCard label="1ª resposta média" value={formatDurationShort(conversations.avgFirstResponseMs)} icon={<Clock />} tone="neutral" hint="conversas de 90 dias" compact />
          </>
        ) : null}
      </div>

      {conversations ? <ConversationsSection data={data} conversations={conversations} links={links} /> : null}

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

function ConversationsSection({ data, conversations, links }: { data: Client360; conversations: ClientConversations; links: { central: boolean; history: boolean } }) {
  const historyHref = `/comunicacao/historico?dias=365&q=${encodeURIComponent(data.client.tradeName)}`;
  return (
    <div className="grid gap-4 xl:grid-cols-[minmax(0,3fr)_minmax(280px,1fr)]">
      <section className="min-w-0">
        <SectionTitle title="Conversas" count={conversations.rows.length} actions={links.history ? <Link href={historyHref} className="text-sm font-medium text-brand-fg hover:underline">Ver no histórico</Link> : undefined} />
        <Card className="overflow-hidden">
          {conversations.rows.length === 0 ? (
            <EmptyState size="sm" icon={<MessagesSquare />} title="Nenhuma conversa" description="Conversas de WhatsApp e e-mail com este cliente aparecem aqui." />
          ) : (
            <div className="overflow-x-auto">
              <Table className="min-w-[680px]">
                <TableHeader>
                  <TableRow>
                    <TableHead>Quando</TableHead>
                    <TableHead>Canal</TableHead>
                    <TableHead>Contato</TableHead>
                    <TableHead>Fila · operador</TableHead>
                    <TableHead>Situação</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {conversations.rows.map((r) => (
                    <TableRow key={r.id}>
                      <TableCell className="whitespace-nowrap text-muted" title={formatDateTime(r.at)}>
                        {formatRelative(r.at)}
                        <p className="text-xs">{r.number}</p>
                      </TableCell>
                      <TableCell>
                        <span className="inline-flex items-center gap-1.5 whitespace-nowrap">
                          {r.channel === "whatsapp" ? <MessageCircle className="size-4 text-success-fg" aria-hidden /> : <Mail className="size-4 text-info-fg" aria-hidden />}
                          {r.channel === "whatsapp" ? "WhatsApp" : "E-mail"}
                        </span>
                      </TableCell>
                      <TableCell>{r.contactName ?? <span className="text-muted-light">—</span>}</TableCell>
                      <TableCell className="text-sm">
                        {r.queueName ?? "Sem fila"}
                        <span className="text-muted"> · {r.assigneeName ?? "sem responsável"}</span>
                      </TableCell>
                      <TableCell className="text-sm">
                        {r.open ? <span className="font-medium text-success-fg">{r.statusLabel}</span> : <span>Encerrada{r.reasonLabel ? ` · ${r.reasonLabel.toLowerCase()}` : ""}</span>}
                        {r.ticketId ? (
                          <>
                            {" · "}
                            <Link href={`/suporte/chamados/${r.ticketId}`} className="font-medium text-brand-fg hover:underline">
                              chamado
                            </Link>
                          </>
                        ) : null}
                        {links.central ? (
                          <>
                            {" · "}
                            <Link href={`/comunicacao?conversa=${r.id}`} className="font-medium text-brand-fg hover:underline">
                              {r.open ? "abrir na Central" : "ver conversa"}
                            </Link>
                          </>
                        ) : null}
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
          )}
        </Card>
      </section>

      <section>
        <SectionTitle title="Como falar com eles" />
        <Card className="flex flex-col gap-2 p-3 text-sm">
          {conversations.optOut.whatsapp || conversations.optOut.email ? (
            <p className="rounded-lg border border-warning/40 bg-warning-soft px-3 py-2 text-xs text-warning-fg">
              O cliente pediu para não receber {[conversations.optOut.whatsapp ? "WhatsApp" : null, conversations.optOut.email ? "e-mail" : null].filter(Boolean).join(" nem ")}.
            </p>
          ) : null}
          {conversations.contacts.length === 0 ? <p className="text-muted">Nenhum contato com telefone ou e-mail.</p> : null}
          {conversations.contacts.map((c) => (
            <div key={c.id} className="rounded-lg border border-border px-3 py-2">
              <p>
                <span className="font-medium">{c.name}</span>
                {c.role ? <span className="text-muted"> · {c.role}</span> : null}
              </p>
              {c.whatsapp ? (
                <p className={c.whatsapp.windowOpenUntil ? "text-success-fg" : "text-muted"}>
                  WhatsApp {formatPhone(c.whatsapp.number)}
                  {c.whatsapp.windowOpenUntil
                    ? ` · janela aberta até ${formatDateTime(c.whatsapp.windowOpenUntil)}`
                    : conversations.whatsappConnected
                      ? ` · só modelo aprovado${c.whatsapp.daysSinceLast !== undefined ? ` (${c.whatsapp.daysSinceLast} dia${c.whatsapp.daysSinceLast === 1 ? "" : "s"} sem escrever)` : " (nunca escreveu)"}`
                      : ""}
                </p>
              ) : null}
              {c.email ? <p className="truncate text-muted">E-mail {c.email}</p> : null}
            </div>
          ))}
        </Card>
      </section>
    </div>
  );
}
