"use client";

import * as React from "react";
import Link from "next/link";
import { BookOpen, Building2, Mail, MessageCircle, Package, Phone, Repeat, User } from "lucide-react";
import type { TicketDetail } from "@/server/support/queries";
import { CLIENT_STATUS_LABELS } from "@/domain/constants";
import { formatCallDuration, formatDate, formatDateTime, formatPhone } from "@/lib/format";
import { Avatar } from "@/components/ui/avatar";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardLink, CardTitle } from "@/components/ui/card";
import { ChannelCard } from "@/components/ui/channel-card";
import { cn } from "@/lib/utils";
import { slaStateAt } from "./sla-live";
import { ChannelIcon, TicketStatusBadge } from "./ticket-badges";
import type { ChannelStatus } from "./ticket-composer";
import { contactTarget, formatElapsed, formatSlaClock, isRealRecording, telHref, whatsappTextHref } from "./workspace-model";

const PRODUCT_STATUS: Record<string, { label: string; variant: "success" | "warning" | "muted" | "danger" }> = {
  ativo: { label: "Ativo", variant: "success" },
  em_implantacao: { label: "Em implantação", variant: "warning" },
  suspenso: { label: "Suspenso", variant: "danger" },
  cancelado: { label: "Cancelado", variant: "muted" },
};

function SectionCard({ title, action, children, className }: { title: string; action?: React.ReactNode; children: React.ReactNode; className?: string }) {
  return (
    <Card className={className}>
      <CardHeader className="flex-row items-center justify-between gap-2 px-4 pb-2 pt-3.5">
        <CardTitle className="text-[15px]">{title}</CardTitle>
        {action}
      </CardHeader>
      <CardContent className="px-4 pb-4 pt-0">{children}</CardContent>
    </Card>
  );
}

type Tone = "success" | "warning" | "danger" | "info" | "muted";
const TONE_TEXT: Record<Tone, string> = { success: "text-success-fg", warning: "text-warning-fg", danger: "text-danger-fg", info: "text-info-fg", muted: "text-muted" };

function SlaCell({ label, value, status, tone }: { label: string; value: string; status: string; tone: Tone }) {
  return (
    <div className="flex min-w-0 flex-col items-center gap-0.5 px-1.5 py-2.5 text-center">
      <span className="text-[11px] text-muted">{label}</span>
      <span className={cn("text-lg font-semibold tabular-nums leading-6", TONE_TEXT[tone])} suppressHydrationWarning>
        {value}
      </span>
      <span className={cn("text-[11px]", TONE_TEXT[tone])} suppressHydrationWarning>
        {status}
      </span>
    </div>
  );
}

/** SLA do chamado: primeira resposta, tempo de atendimento e prazo de solução (contagem regressiva). */
function TicketSla({ detail, now }: { detail: TicketDetail; now: number }) {
  const { ticket, row } = detail;
  const sla = row.sla;
  const opened = new Date(ticket.openedAt).getTime();

  let first: { value: string; status: string; tone: Tone };
  if (ticket.firstResponseAt) {
    const late = sla?.responseDueAt ? ticket.firstResponseAt > sla.responseDueAt : false;
    first = { value: formatElapsed(new Date(ticket.firstResponseAt).getTime() - opened), status: sla?.responseDueAt ? (late ? "Fora do prazo" : "Cumprido") : "Respondido", tone: late ? "danger" : "success" };
  } else if (sla?.responseDueAt) {
    const remaining = new Date(sla.responseDueAt).getTime() - (sla.status === "pausado" && sla.pausedAt ? new Date(sla.pausedAt).getTime() : now);
    first = remaining < 0 ? { value: formatSlaClock(remaining), status: "Atrasada", tone: "danger" } : { value: formatSlaClock(remaining), status: sla.status === "pausado" ? "Pausada" : "Pendente", tone: remaining < 30 * 60_000 ? "warning" : "info" };
  } else {
    first = { value: "—", status: "Pendente", tone: "muted" };
  }

  const end = ticket.resolvedAt ? new Date(ticket.resolvedAt).getTime() : now;
  const handling = {
    value: formatElapsed(end - opened),
    status: ticket.resolvedAt ? "Encerrado" : ticket.status === "aguardando_cliente" ? "Aguardando cliente" : ticket.status === "em_atendimento" ? "Em andamento" : "Na fila",
    tone: (ticket.resolvedAt ? "success" : ticket.status === "aguardando_cliente" ? "warning" : "info") as Tone,
  };

  let solution: { value: string; status: string; tone: Tone } = { value: "—", status: "Sem SLA", tone: "muted" };
  if (sla) {
    const view = slaStateAt(sla, now);
    const map: Record<string, { status: string; tone: Tone }> = {
      dentro_do_prazo: { status: "No prazo", tone: "success" },
      em_atencao: { status: "Em atenção", tone: "warning" },
      em_risco: { status: "Em risco", tone: "danger" },
      violado: { status: "Violado", tone: "danger" },
      pausado: { status: "Pausado", tone: "muted" },
      concluido: { status: "Cumprido", tone: "success" },
    };
    solution = { value: view.state === "concluido" ? "OK" : formatSlaClock(view.remainingMs), ...map[view.state] };
  }

  return (
    <SectionCard title="SLA do chamado">
      <div className="grid grid-cols-3 divide-x divide-border rounded-lg border border-border bg-surface-muted">
        <SlaCell label="Primeira resposta" {...first} />
        <SlaCell label="Tempo de atendimento" {...handling} />
        <SlaCell label="Prazo para solução" {...solution} />
      </div>
      {sla ? (
        <p className="mt-2 text-[11px] text-muted">
          {sla.ruleName} · solução até {formatDateTime(sla.dueAt)}
          {sla.status === "pausado" && sla.pauseReason ? ` · pausado: ${sla.pauseReason}` : ""}
        </p>
      ) : null}
    </SectionCard>
  );
}

export interface TicketContextPanelProps {
  detail: TicketDetail;
  channels: ChannelStatus;
  /** Instante de referência do servidor (evita divergência na hidratação); o relógio do navegador assume depois. */
  now: number;
  className?: string;
}

/**
 * Coluna de contexto do chamado: dados do cliente (link para o Cliente 360), canais com estado real, SLA,
 * produtos contratados, histórico de atendimentos e artigos sugeridos da base.
 */
export function TicketContextPanel({ detail, channels, now, className }: TicketContextPanelProps) {
  const { client, ticket } = detail;
  const target = contactTarget(detail);
  const wa = whatsappTextHref(target.whatsapp);
  const tel = telHref(target.phone);
  const lastCall = [...detail.interactions].reverse().find((i) => i.kind === "ligacao");

  return (
    <div className={cn("flex flex-col gap-3", className)}>
      <SectionCard title="Dados do cliente" action={client ? <CardLink href={`/clientes/${client.id}`}>Cliente 360</CardLink> : null}>
        {client ? (
          <div className="flex gap-3">
            <Avatar name={client.tradeName} size="lg" className="rounded-xl" />
            <div className="min-w-0 flex-1">
              <Link href={`/clientes/${client.id}`} className="block truncate font-semibold text-foreground hover:text-brand-fg hover:underline">
                {client.tradeName}
              </Link>
              <div className="mt-0.5 flex flex-wrap items-center gap-1.5">
                <Badge variant={client.status === "ativo" ? "success" : client.status === "cancelado" ? "muted" : "info"} size="sm">
                  {CLIENT_STATUS_LABELS[client.status]}
                </Badge>
                {client.healthScore !== undefined ? (
                  <Badge variant={client.healthLevel === "risco" ? "danger" : client.healthLevel === "atencao" ? "warning" : "success"} size="sm" title="Saúde do cliente (CS)">
                    Saúde {client.healthScore}
                  </Badge>
                ) : null}
              </div>
              <ul className="mt-2 flex flex-col gap-1 text-[13px] text-muted">
                {target.contactName ? (
                  <li className="flex items-center gap-2">
                    <User className="size-3.5 shrink-0" aria-hidden /> <span className="min-w-0 truncate">{target.contactName}</span>
                  </li>
                ) : null}
                {target.phone ? (
                  <li className="flex items-center gap-2">
                    <Phone className="size-3.5 shrink-0" aria-hidden /> <span className="min-w-0 truncate">{formatPhone(target.phone)}</span>
                  </li>
                ) : null}
                {target.email ? (
                  <li className="flex items-center gap-2">
                    <Mail className="size-3.5 shrink-0" aria-hidden /> <span className="min-w-0 truncate" title={target.email}>{target.email}</span>
                  </li>
                ) : null}
              </ul>
              <div className="mt-2.5 flex gap-2">
                {wa ? (
                  <a href={wa} target="_blank" rel="noreferrer" className="inline-flex h-9 flex-1 items-center justify-center gap-1.5 rounded-lg bg-success-strong text-xs font-medium text-white hover:bg-success-hover" title="Abrir conversa no WhatsApp (app)">
                    <MessageCircle className="size-4" /> WhatsApp
                  </a>
                ) : null}
                {tel ? (
                  <a href={tel} className="inline-flex h-9 flex-1 items-center justify-center gap-1.5 rounded-lg bg-info text-xs font-medium text-white hover:bg-info-hover" title="Ligar pelo discador">
                    <Phone className="size-4" /> Ligar
                  </a>
                ) : null}
              </div>
            </div>
          </div>
        ) : (
          <p className="text-sm text-muted">Cliente removido.</p>
        )}
      </SectionCard>

      <SectionCard title="Canais de comunicação">
        <div className="grid grid-cols-2 gap-2">
          <ChannelCard channel="whatsapp" connected={channels.whatsapp} actionLabel="Conversar" href={wa ?? undefined} className="p-3" />
          <ChannelCard channel="voip" connected={channels.voip} title="VoIP" actionLabel="Ligar" href={tel ?? undefined} className="p-3" />
        </div>
        <div className="mt-2 rounded-lg border border-border bg-surface-muted px-3 py-2 text-xs">
          {lastCall ? (
            <>
              <p className="text-muted">Última ligação</p>
              <p className="mt-0.5 flex items-center justify-between gap-2 text-foreground">
                <span>{formatDateTime(lastCall.createdAt)}</span>
                <span className="tabular-nums">{formatCallDuration(lastCall.durationSeconds) || "—"}</span>
              </p>
              <p className="mt-0.5 text-muted">
                {isRealRecording(lastCall.recordingUrl) ? (
                  <a href={lastCall.recordingUrl} target="_blank" rel="noreferrer" className="font-medium text-info-fg hover:underline">
                    Ouvir gravação
                  </a>
                ) : (
                  "Sem gravação — VoIP não conectado"
                )}
              </p>
            </>
          ) : (
            <p className="text-muted">Nenhuma ligação registrada neste chamado.</p>
          )}
        </div>
      </SectionCard>

      <TicketSla detail={detail} now={now} />

      <SectionCard title="Produtos contratados">
        {detail.clientProducts.length === 0 ? (
          <p className="text-sm text-muted">Nenhum produto registrado.</p>
        ) : (
          <ul className="flex flex-col divide-y divide-border rounded-lg border border-border">
            {detail.clientProducts.map((p) => {
              const st = PRODUCT_STATUS[p.status] ?? { label: p.status, variant: "muted" as const };
              return (
                <li key={p.id} className={cn("flex items-center justify-between gap-2 px-3 py-2 text-sm", p.productId === ticket.productId && "bg-brand-soft/40")}>
                  <span className="flex min-w-0 items-center gap-2">
                    <Package className="size-4 shrink-0 text-brand-fg" aria-hidden />
                    <span className="truncate">{p.productName}</span>
                  </span>
                  <span className={cn("text-xs font-medium", st.variant === "success" ? "text-success-fg" : st.variant === "warning" ? "text-warning-fg" : st.variant === "danger" ? "text-danger-fg" : "text-muted")}>{st.label}</span>
                </li>
              );
            })}
          </ul>
        )}
        {detail.contract ? (
          <p className="mt-2 text-[11px] text-muted">
            Contrato{" "}
            <Link href={`/financeiro/contratos?contrato=${detail.contract.id}`} className="font-medium text-foreground hover:underline">
              {detail.contract.number}
            </Link>
            {detail.contract.endDate ? ` · vigente até ${formatDate(detail.contract.endDate)}` : ""}
          </p>
        ) : null}
      </SectionCard>

      <SectionCard title="Histórico de atendimentos" action={client ? <CardLink href={`/clientes/${client.id}?aba=suporte`}>Ver todos</CardLink> : null}>
        {detail.previous.length === 0 ? (
          <p className="text-sm text-muted">Primeiro chamado deste cliente.</p>
        ) : (
          <ul className="flex flex-col divide-y divide-border rounded-lg border border-border">
            {detail.previous.slice(0, 5).map((t) => (
              <li key={t.id}>
                <Link href={`/suporte?chamado=${t.id}`} scroll={false} className="flex min-h-[44px] items-center gap-2 px-3 py-2 text-xs hover:bg-surface-hover md:min-h-0">
                  <span className="w-[92px] shrink-0 tabular-nums text-muted">{formatDate(t.openedAt, "dd/MM/yy HH:mm")}</span>
                  <span className="flex min-w-0 flex-1 items-center gap-1.5">
                    <ChannelIcon channel={t.channel} />
                    <span className="truncate text-foreground" title={t.subject}>
                      {t.subject}
                    </span>
                    {t.reopenedFromId ? <Repeat className="size-3 shrink-0 text-danger-fg" aria-label="reaberto" /> : null}
                  </span>
                  <TicketStatusBadge status={t.status} />
                </Link>
              </li>
            ))}
          </ul>
        )}
        <p className="mt-2 text-[11px] text-muted">
          {detail.clientStats.total} chamado{detail.clientStats.total === 1 ? "" : "s"} · reincidência {Math.round(detail.clientStats.reopenRate * 100)}%
          {detail.clientStats.csatAverage !== undefined ? ` · CSAT médio ${detail.clientStats.csatAverage.toFixed(1).replace(".", ",")}` : ""}
        </p>
      </SectionCard>

      <SectionCard title="Artigos sugeridos" action={<CardLink href="/suporte/base-de-conhecimento">Base</CardLink>}>
        {detail.suggestedArticles.length === 0 ? (
          <p className="text-sm text-muted">Nenhum artigo relacionado ao assunto e ao produto deste chamado.</p>
        ) : (
          <ul className="flex flex-col gap-1">
            {detail.suggestedArticles.map((a) => (
              <li key={a.id}>
                <Link href={`/suporte/base-de-conhecimento/${a.id}`} target="_blank" className="flex items-start gap-2 rounded-lg p-2 text-sm hover:bg-surface-hover">
                  <BookOpen className="mt-0.5 size-4 shrink-0 text-accent-purple-fg" aria-hidden />
                  <span className="min-w-0">
                    <span className="block font-medium leading-snug text-foreground">{a.title}</span>
                    <span className="block truncate text-xs text-muted">{[a.productName, a.module].filter(Boolean).join(" · ") || "Geral"}</span>
                  </span>
                </Link>
              </li>
            ))}
          </ul>
        )}
      </SectionCard>

      {!client ? null : (
        <p className="flex items-center gap-1.5 px-1 text-[11px] text-muted">
          <Building2 className="size-3.5" aria-hidden /> Todas as ações deste chamado aparecem na linha do tempo do Cliente 360.
        </p>
      )}
    </div>
  );
}
