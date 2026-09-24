"use client";

import * as React from "react";
import Link from "next/link";
import { ArrowRight, BadgeCheck, CalendarClock, Mail, MapPin, MessageCircle, Phone, Send, ShieldAlert, ShieldCheck, X } from "lucide-react";
import { formatDate, formatDateTime, formatPhone } from "@/lib/format";
import { RelativeTime } from "@/components/ui/relative-time";
import { Avatar } from "@/components/ui/avatar";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardHeader, CardLink, CardTitle } from "@/components/ui/card";
import { ScoreRing } from "@/components/ui/score-ring";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { cn } from "@/lib/utils";
import { telHref, whatsappHref } from "@/components/clients/contact-links";
import { ContactDialog, QualifyDialog } from "./lead-dialogs";
import { LeadStatusBadge } from "./lead-badges";
import { LeadChannelIcon } from "@/components/ui/lead-channel-icon";
import { TEMPERATURE_LABELS, leadsHref, type ContactChannel, type UserOption } from "./marketing-model";
import { INBOX_TABS, type InboxLead, type InboxTab, type SourcePerformance } from "./workspace-model";

const ROWS = 8;
const TEMPERATURE_TONE = { quente: "danger", morno: "warning", frio: "info" } as const;
const TEMPERATURE_TEXT = { quente: "text-danger-fg", morno: "text-warning-fg", frio: "text-info-fg" } as const;
const INTERACTION_CHANNEL = { whatsapp: "WhatsApp", ligacao: "ligação", email: "e-mail", outro: "registro" } as const;

export interface LeadCaptureProps {
  sources: SourcePerformance[];
  leads: InboxLead[];
  sellers: UserOption[];
  /** Canais conectados de fato (registro de integrações; passado pela página). */
  channels?: { whatsapp: boolean; voip: boolean };
}

/**
 * Origem dos leads (chips que filtram), caixa de entrada com abas por status e o painel do lead
 * selecionado com as ações de contato (registro manual + wa.me/tel:) e distribuição para vendas.
 */
export function LeadCapture({ sources, leads, sellers, channels = { whatsapp: false, voip: false } }: LeadCaptureProps) {
  const [origin, setOrigin] = React.useState<string | null>(null);
  const [tab, setTab] = React.useState<InboxTab>("todos");
  const [selectedId, setSelectedId] = React.useState<string | null>(null);
  const [dialog, setDialog] = React.useState<{ kind: "contato"; channel: ContactChannel } | { kind: "qualificar" } | null>(null);

  const byOrigin = origin ? leads.filter((l) => l.origin === origin) : leads;
  const counts = Object.fromEntries(INBOX_TABS.map((t) => [t.key, t.statuses ? byOrigin.filter((l) => (t.statuses as readonly string[]).includes(l.status)).length : byOrigin.length])) as Record<InboxTab, number>;
  const tabDef = INBOX_TABS.find((t) => t.key === tab)!;
  const filtered = tabDef.statuses ? byOrigin.filter((l) => (tabDef.statuses as readonly string[]).includes(l.status)) : byOrigin;
  const rows = filtered.slice(0, ROWS);
  const selected = leads.find((l) => l.id === selectedId) ?? rows[0] ?? null;
  const chips = sources.filter((s) => s.leads > 0);
  const moreHref = leadsHref({ origin: origin ?? undefined, status: tabDef.statuses ? [...tabDef.statuses] : undefined, sort: "data" });

  const openContact = (lead: InboxLead, channel: ContactChannel) => {
    setSelectedId(lead.id);
    setDialog({ kind: "contato", channel });
  };

  return (
    <div className="flex min-w-0 flex-col gap-4">
      <Card className="p-4">
        <div className="mb-3 flex items-center justify-between gap-2">
          <h2 className="text-[15px] font-semibold">Origem dos leads</h2>
          <span className="text-xs text-muted">{origin ? "Filtrando a caixa de entrada" : "Toque em um canal para filtrar"}</span>
        </div>
        {chips.length === 0 ? (
          <p className="text-sm text-muted">Nenhum lead captado no período.</p>
        ) : (
          <div className="-mx-1 flex gap-2 overflow-x-auto px-1 pb-1 scrollbar-thin">
            {chips.map((s) => {
              const active = origin === s.key;
              return (
                <button
                  key={s.key}
                  type="button"
                  onClick={() => setOrigin(active ? null : s.key)}
                  aria-pressed={active}
                  className={cn(
                    "flex min-h-[52px] shrink-0 items-center gap-2.5 rounded-lg border px-3 py-2 text-left transition-colors",
                    active ? "border-brand bg-brand-soft" : "border-border bg-surface-muted hover:border-border-strong hover:bg-surface-hover",
                  )}
                >
                  <LeadChannelIcon channel={s.channel} size="sm" />
                  <span className="leading-tight">
                    <span className="block max-w-[9rem] truncate text-xs text-muted">{s.name}</span>
                    <span className="block text-base font-semibold tabular-nums">{s.leads}</span>
                  </span>
                </button>
              );
            })}
            {origin ? (
              <button type="button" onClick={() => setOrigin(null)} className="flex shrink-0 items-center gap-1 self-center rounded-md px-2 py-1 text-xs font-medium text-brand-fg hover:underline">
                <X className="size-3.5" /> Limpar
              </button>
            ) : null}
          </div>
        )}
      </Card>

      <Card className="overflow-hidden">
        <CardHeader className="flex-col gap-3 pb-3 2xl:flex-row 2xl:items-center 2xl:justify-between">
          <CardTitle className="text-[17px]">Caixa de entrada de leads</CardTitle>
          <div role="tablist" aria-label="Status do lead" className="-mx-1 flex gap-1 overflow-x-auto px-1 scrollbar-none">
            {INBOX_TABS.map((t) => (
              <button
                key={t.key}
                type="button"
                role="tab"
                aria-selected={tab === t.key}
                onClick={() => setTab(t.key)}
                className={cn(
                  "inline-flex min-h-[36px] shrink-0 items-center gap-1.5 rounded-lg px-3 text-[13px] font-medium transition-colors",
                  tab === t.key ? "bg-brand text-white shadow-brand" : "text-muted hover:bg-surface-hover hover:text-foreground",
                )}
              >
                {t.label}
                <span className={cn("text-[11px] tabular-nums", tab === t.key ? "text-white/80" : "text-muted-light")}>{counts[t.key]}</span>
              </button>
            ))}
          </div>
        </CardHeader>

        {rows.length === 0 ? (
          <p className="mx-5 mb-5 rounded-lg bg-surface-muted px-3 py-8 text-center text-sm text-muted">Nenhum lead nesta visão.</p>
        ) : (
          <>
            {/* Desktop: tabela */}
            <div className="hidden md:block">
              <Table className="min-w-[640px]">
                <TableHeader>
                  <TableRow>
                    <TableHead className="pl-5">Lead</TableHead>
                    <TableHead className="hidden 2xl:table-cell">Origem</TableHead>
                    <TableHead className="hidden 2xl:table-cell">Interesse</TableHead>
                    <TableHead>Pontuação</TableHead>
                    <TableHead>Responsável</TableHead>
                    <TableHead>Próxima ação</TableHead>
                    <TableHead>Status</TableHead>
                    <TableHead className="pr-5 text-right">Ações</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {rows.map((l) => (
                    <TableRow key={l.id} clickable selected={selected?.id === l.id} onClick={() => setSelectedId(l.id)} className="cursor-pointer">
                      <TableCell className="max-w-[170px] pl-5">
                        <span className="flex items-center gap-2">
                          <span className="truncate text-sm font-medium">{l.name}</span>
                          <RecentDot lead={l} />
                        </span>
                        <span className="block truncate text-xs text-muted">
                          <span className="2xl:hidden">{l.originName} · </span>
                          {l.company ?? "—"}
                        </span>
                      </TableCell>
                      <TableCell className="hidden 2xl:table-cell">
                        <span className="flex items-center gap-2 text-sm" title={l.originName}>
                          <LeadChannelIcon channel={l.originChannel} size="xs" />
                          <span className="hidden max-w-[110px] truncate 2xl:inline">{l.originName}</span>
                        </span>
                      </TableCell>
                      <TableCell className="hidden max-w-[130px] truncate text-sm 2xl:table-cell">{l.productNames[0] ?? l.interest ?? "—"}</TableCell>
                      <TableCell>
                        <Score lead={l} labelClassName="hidden 2xl:inline" />
                      </TableCell>
                      <TableCell className="whitespace-nowrap text-sm">{l.ownerName ? l.ownerName.split(" ")[0] : <span className="text-warning-fg" title="Sem responsável">Sem resp.</span>}</TableCell>
                      <TableCell className="max-w-[120px]">
                        <p className="truncate text-sm">{l.nextAction ?? (l.awaitingReply ? "Responder agora" : "—")}</p>
                        {l.nextActionAt ? <p className={cn("whitespace-nowrap text-xs tabular-nums", l.overdue ? "text-danger-fg" : "text-muted")}>{formatDate(l.nextActionAt, "dd/MM HH:mm")}</p> : null}
                      </TableCell>
                      <TableCell>
                        <LeadStatusBadge status={l.status} />
                      </TableCell>
                      <TableCell className="pr-5">
                        <RowActions lead={l} onContact={openContact} />
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
            {/* Celular: cartões */}
            <ul className="flex flex-col gap-2 px-4 pb-4 md:hidden">
              {rows.map((l) => (
                <li key={l.id}>
                  <button
                    type="button"
                    onClick={() => setSelectedId(l.id)}
                    className={cn("flex w-full items-start gap-3 rounded-lg border p-3 text-left", selected?.id === l.id ? "border-brand bg-brand-soft" : "border-border bg-surface-muted")}
                  >
                    <Score lead={l} />
                    <span className="min-w-0 flex-1">
                      <span className="flex items-center gap-2">
                        <span className="truncate text-sm font-medium">{l.name}</span>
                        <RecentDot lead={l} />
                      </span>
                      <span className="block truncate text-xs text-muted">{[l.company, l.originName].filter(Boolean).join(" · ")}</span>
                      <span className="mt-1 flex items-center gap-2">
                        <LeadStatusBadge status={l.status} />
                        {l.nextActionAt ? <span className={cn("text-xs", l.overdue ? "text-danger-fg" : "text-muted")}>{formatDateTime(l.nextActionAt)}</span> : null}
                      </span>
                    </span>
                  </button>
                </li>
              ))}
            </ul>
          </>
        )}
        <div className="flex items-center justify-between gap-2 border-t border-border px-5 py-3 text-xs text-muted">
          <span>
            {Math.min(rows.length, filtered.length)} de {filtered.length} lead{filtered.length === 1 ? "" : "s"}
          </span>
          <CardLink href={moreHref}>Ver todos na lista de leads</CardLink>
        </div>
      </Card>

      {selected ? <LeadPanel key={selected.id} lead={selected} onClose={() => setSelectedId(null)} onContact={openContact} onQualify={() => setDialog({ kind: "qualificar" })} channels={channels} /> : null}

      {selected && dialog?.kind === "contato" ? (
        <ContactDialog
          key={`${selected.id}-${dialog.channel}`}
          open
          onOpenChange={(open) => !open && setDialog(null)}
          leadId={selected.id}
          leadName={selected.name}
          defaultChannel={dialog.channel}
          description={`Com ${selected.name}. ${dialog.channel === "ligacao" ? (channels.voip ? "VoIP conectado" : "VoIP não conectado") : channels.whatsapp ? "WhatsApp conectado" : "WhatsApp não conectado"}: a conversa acontece no app/discador e aqui fica o registro do que foi tratado.`}
        />
      ) : null}
      {selected ? <QualifyDialog open={dialog?.kind === "qualificar"} onOpenChange={(open) => setDialog(open ? { kind: "qualificar" } : null)} leadId={selected.id} leadName={selected.name} sellers={sellers} /> : null}
    </div>
  );
}

function RecentDot({ lead }: { lead: InboxLead }) {
  if (lead.awaitingReply) return <span className="size-2 shrink-0 rounded-full bg-warning" title="Mensagem recebida aguardando resposta" aria-label="Aguardando resposta" />;
  if (!lead.recent) return null;
  return <span className="size-2 shrink-0 rounded-full bg-success" title="Atividade nas últimas 24h" aria-label="Recente" />;
}

function Score({ lead, labelClassName }: { lead: InboxLead; labelClassName?: string }) {
  return (
    <span className="inline-flex items-center gap-1.5" title={`Pontuação ${lead.score} · ${TEMPERATURE_LABELS[lead.temperature].toLowerCase()}`}>
      <ScoreRing value={lead.score} display={<span className="text-[12px]">{lead.score}</span>} size={34} thickness={3} tone={TEMPERATURE_TONE[lead.temperature]} />
      <span className={cn("text-xs font-medium", TEMPERATURE_TEXT[lead.temperature], labelClassName)}>{TEMPERATURE_LABELS[lead.temperature].toLowerCase()}</span>
    </span>
  );
}

function RowActions({ lead, onContact }: { lead: InboxLead; onContact: (lead: InboxLead, channel: ContactChannel) => void }) {
  const wa = whatsappHref(lead.phone);
  const tel = telHref(lead.phone);
  const stop = (e: React.MouseEvent) => e.stopPropagation();
  return (
    <span className="flex items-center justify-end gap-1" onClick={stop}>
      <a
        href={wa ?? undefined}
        target="_blank"
        rel="noreferrer"
        aria-disabled={!wa}
        onClick={(e) => {
          if (!wa) e.preventDefault();
          onContact(lead, "whatsapp");
        }}
        className="inline-flex size-8 items-center justify-center rounded-md text-success-fg hover:bg-success-soft"
        aria-label={`WhatsApp com ${lead.name}`}
        title="WhatsApp (abre o app e registra o contato)"
      >
        <MessageCircle className="size-4" />
      </a>
      <a
        href={tel ?? undefined}
        aria-disabled={!tel}
        onClick={(e) => {
          if (!tel) e.preventDefault();
          onContact(lead, "ligacao");
        }}
        className="inline-flex size-8 items-center justify-center rounded-md text-info-fg hover:bg-info-soft"
        aria-label={`Ligar para ${lead.name}`}
        title="Ligar (abre o discador e registra o contato)"
      >
        <Phone className="size-4" />
      </a>
    </span>
  );
}

function PanelRow({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="grid grid-cols-[7.5rem_minmax(0,1fr)] items-start gap-3 py-1.5 text-sm">
      <dt className="text-muted">{label}</dt>
      <dd className="min-w-0 break-words">{children ?? <span className="text-muted-light">—</span>}</dd>
    </div>
  );
}

function LeadPanel({ lead, onClose, onContact, onQualify, channels }: { lead: InboxLead; onClose: () => void; onContact: (lead: InboxLead, channel: ContactChannel) => void; onQualify: () => void; channels: { whatsapp: boolean; voip: boolean } }) {
  const wa = whatsappHref(lead.phone);
  const tel = telHref(lead.phone);
  const last = lead.lastInteraction;
  const handedOff = lead.status === "qualificado" || lead.status === "convertido";
  const closed = lead.status === "desqualificado";

  return (
    <Card className="border-brand/40 p-4 md:p-5" aria-label={`Lead selecionado: ${lead.name}`}>
      <div className="flex items-start justify-between gap-3">
        <div className="flex min-w-0 items-start gap-3">
          <Avatar name={lead.name} size="lg" />
          <div className="min-w-0">
            <div className="flex flex-wrap items-center gap-2">
              <h3 className="truncate text-lg font-semibold">{lead.name}</h3>
              <RecentDot lead={lead} />
              <LeadStatusBadge status={lead.status} />
            </div>
            <div className="mt-1 flex flex-col gap-0.5 text-xs text-muted">
              {lead.phone ? (
                <span className="inline-flex items-center gap-1.5">
                  <Phone className="size-3.5" /> {formatPhone(lead.phone)}
                </span>
              ) : null}
              {lead.email ? (
                <span className="inline-flex min-w-0 items-center gap-1.5">
                  <Mail className="size-3.5 shrink-0" /> <span className="truncate">{lead.email}</span>
                </span>
              ) : null}
              {lead.city ? (
                <span className="inline-flex items-center gap-1.5">
                  <MapPin className="size-3.5" /> {[lead.city, lead.state].filter(Boolean).join(" — ")}
                </span>
              ) : null}
            </div>
          </div>
        </div>
        <Button variant="ghost" size="icon" onClick={onClose} aria-label="Fechar painel do lead" className="md:hidden">
          <X />
        </Button>
        <Link href={`/marketing/leads?lead=${lead.id}`} className="hidden shrink-0 items-center gap-1 text-[13px] font-medium text-brand-fg hover:underline md:inline-flex">
          Ficha do lead <ArrowRight className="size-4" />
        </Link>
      </div>

      <div className="mt-4 grid gap-x-6 gap-y-1 md:grid-cols-2">
        <dl className="flex flex-col divide-y divide-border/70">
          <PanelRow label="LGPD">
            {lead.consent ? (
              <Badge variant="success" size="sm">
                <ShieldCheck /> Consentimento obtido
              </Badge>
            ) : (
              <Badge variant="warning" size="sm">
                <ShieldAlert /> Sem consentimento
              </Badge>
            )}
          </PanelRow>
          <PanelRow label="Última interação">
            {last ? (
              <span>
                <RelativeTime value={last.at} /> via {INTERACTION_CHANNEL[last.channel]}
                {last.direction === "entrada" ? <span className="text-warning-fg"> · recebida, sem resposta</span> : null}
                {last.text ? <span className="mt-0.5 block truncate text-xs text-muted">“{last.text}”</span> : null}
              </span>
            ) : lead.lastContactAt ? (
              <RelativeTime value={lead.lastContactAt} />
            ) : (
              <span className="text-warning-fg">Nunca contatado</span>
            )}
          </PanelRow>
          <PanelRow label="Interesse">{lead.productNames.length ? lead.productNames.join(", ") : lead.interest}</PanelRow>
          <PanelRow label="Observação">{lead.notes ? <span className="line-clamp-3">{lead.notes}</span> : null}</PanelRow>
        </dl>
        <dl className="flex flex-col divide-y divide-border/70">
          <PanelRow label="Pontuação">
            <Score lead={lead} />
          </PanelRow>
          <PanelRow label="Responsável">
            {lead.ownerName ? (
              <span className="inline-flex items-center gap-2">
                <Avatar name={lead.ownerName} size="xs" /> {lead.ownerName}
              </span>
            ) : (
              <span className="text-warning-fg">Sem responsável</span>
            )}
          </PanelRow>
          <PanelRow label="Origem">
            <span className="inline-flex items-center gap-2">
              <LeadChannelIcon channel={lead.originChannel} size="xs" /> {lead.originName}
            </span>
            {lead.campaignName ? <span className="mt-0.5 block text-xs text-muted">Campanha: {lead.campaignName}</span> : null}
          </PanelRow>
          <PanelRow label="Criado em">{formatDateTime(lead.createdAt)}</PanelRow>
          {lead.nextActionAt ? (
            <PanelRow label="Próxima ação">
              <span className={cn("inline-flex items-center gap-1.5", lead.overdue && "text-danger-fg")}>
                <CalendarClock className="size-3.5" /> {lead.nextAction ?? "Ação"} · {formatDateTime(lead.nextActionAt)}
              </span>
            </PanelRow>
          ) : null}
        </dl>
      </div>

      <p className="mt-3 text-xs text-muted">
        {channels.whatsapp && channels.voip
          ? "WhatsApp e VoIP conectados."
          : `${[!channels.whatsapp ? "WhatsApp" : null, !channels.voip ? "VoIP" : null].filter(Boolean).join(" e ")} não ${!channels.whatsapp && !channels.voip ? "conectados" : "conectado"}: as ações abrem o app/discador e o contato fica como registro manual.`}
      </p>

      <div className="mt-4 grid gap-2 sm:grid-cols-[auto_auto_minmax(0,1fr)]">
        <Button asChild variant="success" className="min-h-[44px] md:min-h-0">
          <a
            href={wa ?? undefined}
            target="_blank"
            rel="noreferrer"
            onClick={(e) => {
              if (!wa) e.preventDefault();
              onContact(lead, "whatsapp");
            }}
          >
            <Send /> Iniciar conversa
          </a>
        </Button>
        <Button asChild variant="secondary" className="min-h-[44px] md:min-h-0">
          <a
            href={tel ?? undefined}
            onClick={(e) => {
              if (!tel) e.preventDefault();
              onContact(lead, "ligacao");
            }}
          >
            <Phone /> Ligar
          </a>
        </Button>
        {handedOff ? (
          <Button asChild variant="outline" className="min-h-[44px] md:min-h-0">
            <Link href={lead.opportunityId ? `/vendas/oportunidades?oportunidade=${lead.opportunityId}` : `/marketing/leads?lead=${lead.id}`}>
              <BadgeCheck /> Já com vendas · abrir oportunidade
            </Link>
          </Button>
        ) : (
          <Button onClick={onQualify} disabled={closed} className="min-h-[44px] md:min-h-0">
            <ArrowRight /> Distribuir para vendas
          </Button>
        )}
      </div>
    </Card>
  );
}
