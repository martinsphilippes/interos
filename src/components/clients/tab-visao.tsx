import Link from "next/link";
import {
  AlertTriangle,
  Building2,
  CalendarClock,
  CheckCircle2,
  Clock,
  FileSignature,
  GitBranch,
  Globe,
  Headset,
  History,
  Mail,
  MapPin,
  Megaphone,
  Navigation,
  Package,
  Phone,
  PlusCircle,
  Receipt,
  RefreshCw,
  Rocket,
  UserRound,
  UserCheck,
  ClipboardList,
} from "lucide-react";
import type { Client360 } from "@/server/clients/queries";
import type { NewTicketOptions } from "@/components/support/new-ticket-dialog";
import { NewTicketDialog } from "@/components/support/new-ticket-dialog";
import { PRODUCT_CATEGORY_LABELS, TASK_STATUS_LABELS, type TaskStatus } from "@/domain/constants";
import { formatCurrency, formatDate, formatDocument, formatPhone } from "@/lib/format";
import { Avatar } from "@/components/ui/avatar";
import { Badge, type BadgeProps } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardLink, CardTitle } from "@/components/ui/card";
import { DataList } from "@/components/ui/data-list";
import { IconTile } from "@/components/ui/icon-tile";
import { SlaBadge } from "@/components/ui/sla-badge";
import { StatusDot } from "@/components/ui/status-dot";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { TimelineList } from "@/components/ui/timeline-list";
import type { Tone } from "@/components/ui/tone";
import { eventIconComponent, eventTone } from "@/components/timeline/event-icon";
import { cn } from "@/lib/utils";
import { ContactsCard } from "./contacts-card";
import { CLIENT_PRODUCT_STATUS_LABELS, TICKET_STATUS_LABELS, TICKET_STATUS_VARIANT } from "./labels";
import { buildPendencies, buildUpcoming, productRenewalDate, type Pendency, type UpcomingItem } from "./overview-model";
import { productVisual } from "./product-visual";

const OPEN_TASK = new Set<TaskStatus>(["aberta", "em_andamento", "aguardando"]);
const TASK_STATUS_VARIANT: Record<TaskStatus, NonNullable<BadgeProps["variant"]>> = { aberta: "warning", em_andamento: "info", aguardando: "purple", concluida: "success", cancelada: "muted" };
const PRODUCT_STATUS_DOT = { ativo: "success", em_implantacao: "warning", suspenso: "muted", cancelado: "danger" } as const;
/** Eventos de bastidor que não entram no resumo da linha do tempo (continuam no Histórico). */
const TIMELINE_NOISE = new Set(["task.updated", "task.assigned", "sla.started", "sla.completed", "notification.sent", "workflow.stage.started", "workflow.step.updated", "automation.executed", "kpi.updated", "gamification.points_awarded", "client.updated"]);
const VISIT_STATUS: Record<string, { label: string; variant: NonNullable<BadgeProps["variant"]> }> = {
  agendada: { label: "Agendada", variant: "info" },
  realizada: { label: "Realizada", variant: "success" },
  cancelada: { label: "Cancelada", variant: "muted" },
  remarcada: { label: "Remarcada", variant: "warning" },
};

function SectionCard({ title, icon, action, children, className, contentClassName }: { title: string; icon: React.ReactNode; action?: React.ReactNode; children: React.ReactNode; className?: string; contentClassName?: string }) {
  return (
    <Card className={cn("flex min-w-0 flex-col", className)}>
      <CardHeader className="flex-row items-center justify-between gap-2 pb-3">
        <CardTitle className="flex items-center gap-2.5 text-[17px]">
          <span className="text-muted [&_svg]:size-5" aria-hidden>
            {icon}
          </span>
          {title}
        </CardTitle>
        {action}
      </CardHeader>
      <CardContent className={cn("flex-1 pt-0", contentClassName)}>{children}</CardContent>
    </Card>
  );
}

function ActionLink({ href, children }: { href: string; children: React.ReactNode }) {
  return (
    <Link href={href} className="inline-flex shrink-0 items-center gap-1.5 text-[13px] font-medium text-brand-fg transition-colors hover:text-brand-hover">
      {children}
      <PlusCircle className="size-4" aria-hidden />
    </Link>
  );
}

/** Avatar + primeiro nome (tabelas estreitas da Visão geral). */
function ShortUser({ users, id }: { users: Client360["users"]; id?: string }) {
  const u = id ? users[id] : undefined;
  if (!u) return <span className="text-sm text-muted-light">—</span>;
  return (
    <span className="inline-flex items-center gap-2 whitespace-nowrap text-sm" title={u.name}>
      <Avatar name={u.name} src={u.avatarUrl} size="xs" />
      {u.name.split(" ")[0]}
    </span>
  );
}

function Empty({ children }: { children: React.ReactNode }) {
  return <p className="rounded-lg bg-surface-muted px-3 py-5 text-center text-sm text-muted">{children}</p>;
}

const PENDENCY_ICON: Record<Pendency["kind"], React.ReactNode> = { contrato: <FileSignature />, cobranca: <Receipt />, etapa: <GitBranch />, implantacao: <Rocket /> };
const UPCOMING_ICON: Record<UpcomingItem["kind"], { icon: React.ReactNode; tone: Tone }> = {
  cobranca: { icon: <Receipt />, tone: "info" },
  contrato: { icon: <FileSignature />, tone: "purple" },
  renovacao: { icon: <RefreshCw />, tone: "warning" },
};

export interface TabVisaoProps {
  data: Client360;
  originName?: string;
  ticketOptions: NewTicketOptions | null;
}

/** Aba Visão geral (padrão da ficha): resumo de cada área com atalho para a aba de detalhe. */
export function TabVisao({ data, originName, ticketOptions }: TabVisaoProps) {
  const { client, contacts, products, catalog, users, tasks, tickets, timeline, visits, slaByEntity } = data;
  const base = `/clientes/${client.id}`;
  const primary = contacts.find((c) => c.isPrimary) ?? contacts[0];
  const city = [client.address?.city, client.address?.state].filter(Boolean).join(" — ");
  const categoryOf = (productId: string) => catalog.find((p) => p.id === productId)?.category;
  const shownProducts = products.filter((p) => p.status !== "cancelado").slice(0, 5);
  const recentEvents = timeline.filter((e) => !TIMELINE_NOISE.has(e.type)).slice(0, 5);
  const openTasks = tasks.filter((t) => OPEN_TASK.has(t.status)).slice(0, 6);
  const lastTickets = tickets.slice(0, 5);
  const pendencies = buildPendencies(data);
  const upcoming = buildUpcoming(data).slice(0, 5);
  const now = new Date().toISOString();
  const scheduledVisits = visits.filter((v) => v.status === "agendada" && v.scheduledAt >= now).sort((a, b) => a.scheduledAt.localeCompare(b.scheduledAt));
  const pastVisits = visits.filter((v) => !scheduledVisits.includes(v)).slice(0, 4);
  const shownVisits = [...scheduledVisits.slice(0, 3), ...pastVisits].slice(0, 5);
  const address = [[client.address?.street, client.address?.number].filter(Boolean).join(", "), client.address?.district, city].filter(Boolean).join(" · ");

  return (
    <div className="flex flex-col gap-4">
      <div className="grid gap-4 lg:grid-cols-2 xl:grid-cols-[minmax(0,1.15fr)_minmax(0,1fr)_minmax(0,1.1fr)]">
        <SectionCard title="Dados gerais" icon={<UserRound />}>
          <DataList
            labelWidth="7.75rem"
            items={[
              { key: "cnpj", icon: <Building2 />, label: "CNPJ", value: client.document ? formatDocument(client.document) : undefined },
              { key: "resp", icon: <UserRound />, label: "Responsável", value: primary ? `${primary.name}${primary.role ? ` · ${primary.role}` : ""}` : undefined },
              { key: "tel", icon: <Phone />, label: "Telefone", value: client.phone ? formatPhone(client.phone) : primary?.phone ? formatPhone(primary.phone) : undefined },
              { key: "email", icon: <Mail />, label: "E-mail", value: client.email ?? primary?.email },
              { key: "cidade", icon: <MapPin />, label: "Cidade", value: city || undefined },
              { key: "origem", icon: <Megaphone />, label: "Origem", value: originName ?? client.origin },
              { key: "entrada", icon: <CalendarClock />, label: "Data de entrada", value: formatDate(client.createdAt) },
              ...(client.website ? [{ key: "site", icon: <Globe />, label: "Site", value: client.website.replace(/^https?:\/\//, "") }] : []),
              {
                key: "ativo",
                icon: <UserCheck />,
                label: "Cliente ativo",
                value: <StatusDot tone={client.status === "ativo" ? "success" : "muted"} label={client.status === "ativo" ? "Sim" : "Não"} />,
              },
            ]}
          />
        </SectionCard>

        <SectionCard title="Produtos contratados" icon={<Package />} contentClassName="flex flex-col gap-3">
          {shownProducts.length === 0 ? (
            <Empty>Nenhum produto contratado ainda.</Empty>
          ) : (
            <ul className="flex flex-col gap-2">
              {shownProducts.map((p) => {
                const category = categoryOf(p.productId);
                const visual = productVisual(category);
                const Icon = visual.icon;
                const renewal = productRenewalDate(p, data);
                return (
                  <li key={p.id} className="flex items-center gap-3 rounded-lg border border-border bg-surface-muted px-3 py-2.5">
                    <IconTile icon={<Icon />} tone={visual.tone} size="sm" />
                    <div className="min-w-0 flex-1">
                      <p className="truncate text-sm font-medium">{p.productName}</p>
                      <p className="truncate text-xs text-muted">{[category ? PRODUCT_CATEGORY_LABELS[category] : null, p.plan].filter(Boolean).join(" · ") || "—"}</p>
                    </div>
                    <div className="shrink-0 text-right">
                      <StatusDot tone={PRODUCT_STATUS_DOT[p.status]} label={<span className="text-xs">{CLIENT_PRODUCT_STATUS_LABELS[p.status]}</span>} />
                      <p className="mt-0.5 text-[11px] text-muted">{renewal ? `Renovação: ${formatDate(renewal)}` : p.monthlyValue > 0 ? `${formatCurrency(p.monthlyValue)}/mês` : "—"}</p>
                    </div>
                  </li>
                );
              })}
            </ul>
          )}
          <CardLink href={`${base}?aba=produtos`} className="mt-auto" />
        </SectionCard>

        <SectionCard title="Linha do tempo" icon={<History />} action={<CardLink href={`${base}?aba=timeline`} />} className="lg:col-span-2 xl:col-span-1" contentClassName="flex flex-col gap-2">
          <TimelineList
            emptyText="Nenhum evento registrado ainda."
            items={recentEvents.map((e) => {
              const Icon = eventIconComponent(e.type);
              const tone = eventTone(e.type);
              return {
                id: e.id,
                icon: <Icon />,
                tone: (tone === "muted" ? "neutral" : tone) as Tone,
                title: e.title,
                subtitle: [e.actorName, e.description].filter(Boolean).join(" · "),
                date: (
                  <>
                    {formatDate(e.occurredAt)}
                    <br />
                    {formatDate(e.occurredAt, "HH:mm")}
                  </>
                ),
              };
            })}
          />
          {recentEvents.length > 0 ? <CardLink href={`${base}?aba=timeline`} className="mt-auto" /> : null}
        </SectionCard>
      </div>

      <div className="grid gap-4 2xl:grid-cols-2">
        <SectionCard title="Tarefas em aberto" icon={<ClipboardList />} action={<ActionLink href={`/tarefas?novo=1&cliente=${client.id}`}>Adicionar tarefa</ActionLink>} contentClassName="px-0 pb-2">
          {openTasks.length === 0 ? (
            <div className="px-5 pb-3">
              <Empty>Nenhuma tarefa em aberto para este cliente.</Empty>
            </div>
          ) : (
            <Table className="min-w-[500px]">
              <TableHeader>
                <TableRow>
                  <TableHead className="pl-5">Tarefa</TableHead>
                  <TableHead>Responsável</TableHead>
                  <TableHead>Prazo</TableHead>
                  <TableHead>SLA</TableHead>
                  <TableHead className="pr-5">Status</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {openTasks.map((t) => {
                  const sla = slaByEntity[t.id];
                  const overdue = Boolean(t.dueAt && t.dueAt < now);
                  return (
                    <TableRow key={t.id}>
                      <TableCell className="max-w-[200px] pl-5">
                        <Link href={`/tarefas?tarefa=${t.id}`} className="block truncate text-sm font-medium hover:text-brand-fg">
                          {t.title}
                        </Link>
                      </TableCell>
                      <TableCell>
                        <ShortUser users={users} id={t.assigneeId} />
                      </TableCell>
                      <TableCell className={cn("whitespace-nowrap text-sm tabular-nums", overdue ? "text-danger-fg" : "text-muted")}>{t.dueAt ? formatDate(t.dueAt) : "—"}</TableCell>
                      <TableCell>
                        {sla ? (
                          <SlaBadge state={sla.state} />
                        ) : t.dueAt ? (
                          <Badge variant={overdue ? "danger" : "success"} size="sm">
                            {overdue ? "Atrasada" : "No prazo"}
                          </Badge>
                        ) : (
                          <span className="text-muted-light">—</span>
                        )}
                      </TableCell>
                      <TableCell className="pr-5">
                        <Badge variant={TASK_STATUS_VARIANT[t.status]} size="sm">
                          {TASK_STATUS_LABELS[t.status]}
                        </Badge>
                      </TableCell>
                    </TableRow>
                  );
                })}
              </TableBody>
            </Table>
          )}
        </SectionCard>

        <SectionCard
          title="Últimos atendimentos"
          icon={<Headset />}
          action={
            ticketOptions ? (
              <NewTicketDialog
                options={ticketOptions}
                fixedClient={{ id: client.id, name: client.tradeName }}
                trigger={
                  <button type="button" className="inline-flex shrink-0 items-center gap-1.5 text-[13px] font-medium text-brand-fg transition-colors hover:text-brand-hover">
                    Abrir chamado <PlusCircle className="size-4" aria-hidden />
                  </button>
                }
              />
            ) : (
              <CardLink href={`${base}?aba=suporte`} />
            )
          }
          contentClassName="px-0 pb-2"
        >
          {lastTickets.length === 0 ? (
            <div className="px-5 pb-3">
              <Empty>Nenhum chamado registrado.</Empty>
            </div>
          ) : (
            <Table className="min-w-[540px]">
              <TableHeader>
                <TableRow>
                  <TableHead className="pl-5">Chamado</TableHead>
                  <TableHead>Assunto</TableHead>
                  <TableHead>Responsável</TableHead>
                  <TableHead>Abertura</TableHead>
                  <TableHead>SLA</TableHead>
                  <TableHead className="pr-5">Status</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {lastTickets.map((t) => (
                  <TableRow key={t.id}>
                    <TableCell className="whitespace-nowrap pl-5 text-sm font-medium tabular-nums">
                      <Link href={`/suporte/chamados/${t.id}`} className="hover:text-brand-fg">
                        {t.number}
                      </Link>
                    </TableCell>
                    <TableCell className="max-w-[180px]">
                      <p className="truncate text-sm" title={t.subject}>
                        {t.subject}
                      </p>
                    </TableCell>
                    <TableCell>
                      <ShortUser users={users} id={t.assigneeId} />
                    </TableCell>
                    <TableCell className="whitespace-nowrap text-xs tabular-nums text-muted">
                      {formatDate(t.openedAt)}
                      <br />
                      {formatDate(t.openedAt, "HH:mm")}
                    </TableCell>
                    <TableCell>{t.sla ? <SlaBadge state={t.sla.state} /> : <span className="text-muted-light">—</span>}</TableCell>
                    <TableCell className="pr-5">
                      <Badge variant={TICKET_STATUS_VARIANT[t.status]} size="sm">
                        {TICKET_STATUS_LABELS[t.status]}
                      </Badge>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}
        </SectionCard>
      </div>

      <div className="grid gap-4 lg:grid-cols-2 2xl:grid-cols-4">
        <SectionCard title="Pendências" icon={<AlertTriangle />}>
          {pendencies.length === 0 ? (
            <p className="flex items-center gap-2 rounded-lg bg-success-soft/40 px-3 py-4 text-sm text-success-fg">
              <CheckCircle2 className="size-4" aria-hidden /> Nenhuma pendência com este cliente.
            </p>
          ) : (
            <ul className="flex flex-col gap-2">
              {pendencies.slice(0, 6).map((p) => (
                <li key={p.id}>
                  <Link href={p.href} className="flex items-start gap-3 rounded-lg px-1 py-1.5 transition-colors hover:bg-surface-hover/60">
                    <IconTile icon={PENDENCY_ICON[p.kind]} tone={p.tone} size="xs" className="mt-0.5" />
                    <div className="min-w-0">
                      <p className="truncate text-sm font-medium">{p.title}</p>
                      <p className={cn("line-clamp-2 text-xs", p.tone === "danger" ? "text-danger-fg" : "text-warning-fg")}>{p.detail}</p>
                    </div>
                  </Link>
                </li>
              ))}
            </ul>
          )}
        </SectionCard>

        <SectionCard title="Próximos vencimentos" icon={<CalendarClock />} action={<CardLink href={`${base}?aba=financeiro`} />}>
          {upcoming.length === 0 ? (
            <Empty>Nada a vencer.</Empty>
          ) : (
            <ul className="flex flex-col gap-2">
              {upcoming.map((u) => (
                <li key={u.id}>
                  <Link href={u.href} className="flex items-center gap-3 rounded-lg px-1 py-1.5 transition-colors hover:bg-surface-hover/60">
                    <IconTile icon={UPCOMING_ICON[u.kind].icon} tone={UPCOMING_ICON[u.kind].tone} size="xs" />
                    <div className="min-w-0 flex-1">
                      <p className="truncate text-sm font-medium">{u.title}</p>
                      <p className="truncate text-xs text-muted">{[u.detail, u.amount ? formatCurrency(u.amount) : null].filter(Boolean).join(" · ")}</p>
                    </div>
                    <span className="shrink-0 text-xs tabular-nums text-foreground">{formatDate(u.date)}</span>
                  </Link>
                </li>
              ))}
            </ul>
          )}
        </SectionCard>

        <SectionCard title="Visitas" icon={<MapPin />} action={<CardLink href={`${base}?aba=comercial`} />}>
          {shownVisits.length === 0 ? (
            <Empty>Nenhuma visita registrada.</Empty>
          ) : (
            <ul className="flex flex-col gap-2">
              {shownVisits.map((v) => {
                const status = VISIT_STATUS[v.status] ?? VISIT_STATUS.agendada;
                return (
                  <li key={v.id}>
                    <Link href={`/vendas/visitas?visita=${v.id}`} className="flex items-start gap-3 rounded-lg px-1 py-1.5 transition-colors hover:bg-surface-hover/60">
                      <IconTile icon={<Clock />} tone={v.status === "agendada" ? "info" : v.status === "realizada" ? "success" : "neutral"} size="xs" className="mt-0.5" />
                      <div className="min-w-0 flex-1">
                        <p className="truncate text-sm font-medium">{v.objective}</p>
                        <p className="truncate text-xs text-muted">
                          {formatDate(v.scheduledAt, "dd/MM/yyyy HH:mm")}
                          {users[v.sellerId] ? ` · ${users[v.sellerId].name}` : ""}
                        </p>
                      </div>
                      <Badge variant={status.variant} size="sm">
                        {status.label}
                      </Badge>
                    </Link>
                  </li>
                );
              })}
            </ul>
          )}
          {address ? (
            <a
              href={`https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(address)}`}
              target="_blank"
              rel="noreferrer"
              className="mt-3 inline-flex items-center gap-1.5 text-[13px] font-medium text-secondary-fg hover:underline"
            >
              <Navigation className="size-4" aria-hidden /> Abrir endereço no mapa
            </a>
          ) : null}
        </SectionCard>

        <div id="contatos" className="min-w-0">
          <ContactsCard clientId={client.id} contacts={contacts} />
        </div>
      </div>
    </div>
  );
}
