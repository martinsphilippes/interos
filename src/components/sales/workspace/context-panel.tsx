"use client";

import * as React from "react";
import Link from "next/link";
import { CalendarClock, Car, CheckSquare, Clock, ExternalLink, FileText, Mail, MapPin, MessageCircle, Navigation, Package, Phone, User } from "lucide-react";
import { avatarColor } from "@/components/ui/avatar";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { ChannelCard } from "@/components/ui/channel-card";
import { IconTile } from "@/components/ui/icon-tile";
import type { Tone } from "@/components/ui/tone";
import { telHref, whatsappHref } from "@/components/clients/contact-links";
import { CLIENT_STATUS_LABELS, PRODUCT_CATEGORY_LABELS } from "@/domain/constants";
import { formatCurrency, formatDay, formatPhone, formatTime, initials } from "@/lib/format";
import { cn } from "@/lib/utils";
import type { WorkspaceDetail, WorkspaceLocation, WorkspaceNextAction } from "@/server/sales/workspace-queries";
import { formatCallDuration } from "@/lib/format";
import { MapEmbed } from "@/components/ui/map-embed";
import { useSalesUrl } from "../use-sales-url";

function travelLabel(minutes: number | undefined): string {
  if (minutes === undefined) return "";
  return minutes >= 60 ? `${Math.floor(minutes / 60)}h${String(minutes % 60).padStart(2, "0")}` : `${minutes} min`;
}

/** Botões WhatsApp (wa.me) e Ligar (tel:): abrem o app do usuário; o registro é feito no composer. */
export function ContactLinks({ detail, className, size = "md" }: { detail: WorkspaceDetail; className?: string; size?: "sm" | "md" }) {
  const wa = whatsappHref(detail.primaryContact.whatsapp ?? detail.primaryContact.phone);
  const tel = telHref(detail.primaryContact.phone ?? detail.primaryContact.whatsapp);
  if (!wa && !tel) return <p className={cn("text-xs text-muted", className)}>Sem telefone cadastrado.</p>;
  return (
    <div className={cn("grid grid-cols-2 gap-2", className)}>
      {wa ? (
        <Button asChild variant="success" size={size} className="min-h-[44px] md:min-h-0">
          <a href={wa} target="_blank" rel="noreferrer">
            <MessageCircle /> WhatsApp
          </a>
        </Button>
      ) : (
        <span />
      )}
      {tel ? (
        <Button asChild size={size} className="min-h-[44px] bg-info text-white shadow-card hover:bg-info-hover md:min-h-0">
          <a href={tel}>
            <Phone /> Ligar
          </a>
        </Button>
      ) : null}
    </div>
  );
}

function LeadCard({ detail }: { detail: WorkspaceDetail }) {
  const { client, primaryContact } = detail;
  const isLead = client.status === "lead" || client.status === "prospect";
  return (
    <Card>
      <CardHeader className="flex-row items-center justify-between gap-2 pb-3">
        <CardTitle>{isLead ? "Dados do lead" : "Dados do cliente"}</CardTitle>
        <Badge variant={isLead ? "info" : "success"} size="sm">
          {CLIENT_STATUS_LABELS[client.status]}
        </Badge>
      </CardHeader>
      <CardContent className="flex flex-col gap-3 pt-0">
        <div className="flex items-start gap-3">
          <span className="flex size-14 shrink-0 items-center justify-center rounded-xl text-lg font-bold text-white" style={{ backgroundColor: avatarColor(client.tradeName) }} aria-hidden>
            {initials(client.tradeName)}
          </span>
          <div className="min-w-0 flex-1">
            <Link href={`/clientes/${client.id}`} className="block truncate font-semibold hover:text-brand-fg hover:underline" title="Abrir ficha do cliente">
              {client.legalName || client.tradeName}
            </Link>
            <ul className="mt-1 flex flex-col gap-1 text-xs text-muted">
              <li className="flex min-w-0 items-center gap-1.5">
                <User className="size-3.5 shrink-0" aria-hidden />
                <span className="truncate">{primaryContact.name ? `${primaryContact.name}${primaryContact.role ? ` · ${primaryContact.role}` : ""}` : "Sem contato cadastrado"}</span>
              </li>
              <li className="flex items-center gap-1.5">
                <Phone className="size-3.5 shrink-0" aria-hidden />
                <span className="tabular-nums">{formatPhone(primaryContact.phone)}</span>
              </li>
              <li className="flex min-w-0 items-center gap-1.5">
                <Mail className="size-3.5 shrink-0" aria-hidden />
                {primaryContact.email ? (
                  <a href={`mailto:${primaryContact.email}`} className="truncate hover:text-foreground hover:underline">
                    {primaryContact.email}
                  </a>
                ) : (
                  <span>—</span>
                )}
              </li>
            </ul>
          </div>
        </div>
        <ContactLinks detail={detail} size="sm" className="max-lg:hidden" />
        {detail.lead ? (
          <p className="text-xs text-muted">
            Lead {detail.lead.name} · score {detail.lead.score}
            {detail.lead.origin ? ` · origem ${detail.lead.origin}` : ""}
          </p>
        ) : null}
      </CardContent>
    </Card>
  );
}

function ChannelsCard({ detail }: { detail: WorkspaceDetail }) {
  const wa = whatsappHref(detail.primaryContact.whatsapp ?? detail.primaryContact.phone);
  const tel = telHref(detail.primaryContact.phone ?? detail.primaryContact.whatsapp);
  const call = detail.lastCall;
  return (
    <Card>
      <CardHeader className="pb-3">
        <CardTitle>Canais de comunicação</CardTitle>
      </CardHeader>
      <CardContent className="flex flex-col gap-3 pt-0">
        <div className="grid grid-cols-2 gap-2">
          <ChannelCard channel="whatsapp" connected={detail.channels.whatsapp} actionLabel="Conversar" href={wa ?? undefined} className="p-3" />
          <ChannelCard channel="voip" title="VoIP" connected={detail.channels.voip} actionLabel="Ligar" href={tel ?? undefined} className="p-3" />
        </div>
        <div className="rounded-lg border border-border bg-surface-muted px-3 py-2 text-xs">
          <p className="text-muted">Última ligação registrada</p>
          {call ? (
            <p className="mt-0.5 flex items-center justify-between gap-2 text-foreground">
              <span className="tabular-nums">
                {formatDay(call.at)}, {formatTime(call.at)} · {call.authorName}
              </span>
              <span className={cn("tabular-nums", call.answered ? "text-foreground" : "text-danger-fg")}>{call.answered ? formatCallDuration(call.durationSeconds) || "—" : "Sem resposta"}</span>
            </p>
          ) : (
            <p className="mt-0.5 text-foreground">Nenhuma ligação registrada.</p>
          )}
          {!detail.channels.voip ? <p className="mt-1 text-muted-light">Sem VoIP conectado: não há gravação; registre a ligação no composer.</p> : null}
        </div>
      </CardContent>
    </Card>
  );
}

/** Mapa (iframe do Google Maps por endereço, sem chave), distância estimada da sede e links de rota. */
export function LocationBlock({ location, compact }: { location: WorkspaceLocation; compact?: boolean }) {
  return (
    <div className="flex flex-col gap-2.5">
      {location.embedUrl ? <MapEmbed src={location.embedUrl} title={`Mapa: ${location.addressLine}`} className={compact ? "h-32" : "h-44"} /> : null}
      <p className="text-xs text-muted">
        <MapPin className="mr-1 inline size-3.5" aria-hidden />
        {location.addressLine}
        {location.source === "visita" ? " (próxima visita)" : ""}
      </p>
      {location.distanceKm !== undefined ? (
        <p className="flex flex-wrap items-center gap-x-3 gap-y-1 text-sm tabular-nums" title={`Estimativa a partir da ${location.origin}${location.provider === "estimativa" ? " (linha reta × 1,25 a 60 km/h, sem Google Maps conectado)" : ""}`}>
          <span className="inline-flex items-center gap-1">
            <Car className="size-4 text-muted" aria-hidden /> {location.distanceKm.toLocaleString("pt-BR")} km
          </span>
          <span className="inline-flex items-center gap-1">
            <Clock className="size-4 text-muted" aria-hidden /> {travelLabel(location.travelMinutes)}
          </span>
          <span className="text-[11px] text-muted-light">estimativa da sede</span>
        </p>
      ) : (
        <p className="text-xs text-muted-light">Distância indisponível para este endereço.</p>
      )}
      {!compact ? (
        <div className="grid grid-cols-2 gap-2">
          {location.directionsUrl ? (
            <Button asChild size="sm" variant="secondary" className="min-h-[44px] md:min-h-0">
              <a href={location.directionsUrl} target="_blank" rel="noreferrer">
                <Navigation /> Traçar rota
              </a>
            </Button>
          ) : null}
          {location.mapsUrl ? (
            <Button asChild size="sm" variant="outline" className="min-h-[44px] md:min-h-0">
              <a href={location.mapsUrl} target="_blank" rel="noreferrer">
                Abrir no Google Maps <ExternalLink />
              </a>
            </Button>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}

function LocationCard({ detail, className }: { detail: WorkspaceDetail; className?: string }) {
  return (
    <Card className={className}>
      <CardHeader className="flex-row items-center justify-between gap-2 pb-3">
        <CardTitle>Localização e rota</CardTitle>
        <span className="text-[11px] text-muted-light">{detail.channels.maps ? "Google Maps" : "Google Maps (link)"}</span>
      </CardHeader>
      <CardContent className="pt-0">
        {detail.location ? (
          <LocationBlock location={detail.location} />
        ) : (
          <p className="text-sm text-muted">
            Sem endereço no cadastro.{" "}
            <Link href={`/clientes/${detail.client.id}`} className="text-brand-fg hover:underline">
              Completar na ficha do cliente
            </Link>
          </p>
        )}
      </CardContent>
    </Card>
  );
}

const ACTION_STYLE: Record<WorkspaceNextAction["kind"], { icon: React.ReactNode; tone: Tone }> = {
  followup: { icon: <CalendarClock />, tone: "warning" },
  visita: { icon: <MapPin />, tone: "brand" },
  tarefa: { icon: <CheckSquare />, tone: "info" },
  proposta: { icon: <FileText />, tone: "purple" },
};

export function NextActionsList({ detail, limit }: { detail: WorkspaceDetail; limit?: number }) {
  const { navigate } = useSalesUrl();
  const items = limit ? detail.nextActions.slice(0, limit) : detail.nextActions;
  if (items.length === 0) return <p className="text-sm text-muted">Nenhuma ação agendada. Use “Agendar” para marcar visita ou próxima ação.</p>;
  return (
    <ul className="flex flex-col gap-2">
      {items.map((a) => {
        const style = ACTION_STYLE[a.kind];
        const body = (
          <>
            <IconTile icon={style.icon} tone={a.overdue ? "danger" : style.tone} size="sm" />
            <span className="min-w-0 flex-1">
              <span className="block truncate text-sm text-foreground">{a.title}</span>
              <span className={cn("block text-xs tabular-nums", a.overdue ? "font-medium text-danger-fg" : "text-muted")}>
                {a.at ? `${a.kind === "proposta" ? "Validade " : ""}${formatDay(a.at)}${a.kind === "proposta" ? "" : `, ${formatTime(a.at)}`}` : "Sem data"}
                {a.overdue ? " · vencida" : ""}
              </span>
            </span>
          </>
        );
        const cls = "flex w-full items-center gap-2.5 rounded-lg border border-border bg-surface-muted p-2 text-left transition-colors hover:border-border-strong hover:bg-surface-hover";
        return (
          <li key={a.id}>
            {a.visitId ? (
              <button type="button" className={cls} onClick={() => navigate({ visita: a.visitId })}>
                {body}
              </button>
            ) : a.href ? (
              <Link href={a.href} className={cls}>
                {body}
              </Link>
            ) : (
              <div className={cls}>{body}</div>
            )}
          </li>
        );
      })}
    </ul>
  );
}

function InterestsList({ detail }: { detail: WorkspaceDetail }) {
  if (detail.interests.length === 0 && !detail.lead?.interest) return <p className="text-sm text-muted">Nenhum produto de interesse registrado.</p>;
  return (
    <div className="flex flex-col gap-2">
      <ul className="flex flex-col gap-2">
        {detail.interests.map((i) => (
          <li key={i.id} className="flex items-center gap-2.5 rounded-lg border border-border bg-surface-muted p-2">
            <IconTile icon={<Package />} tone="brand" size="sm" />
            <span className="min-w-0 flex-1">
              <span className="block truncate text-sm">{i.name}</span>
              <span className="block text-xs text-muted">
                {i.category ? PRODUCT_CATEGORY_LABELS[i.category] : "Produto"}
                {i.monthlyValue ? ` · ${formatCurrency(i.monthlyValue)}/mês` : ""}
              </span>
            </span>
            {i.source === "lead" ? (
              <Badge variant="muted" size="sm">
                Lead
              </Badge>
            ) : null}
          </li>
        ))}
      </ul>
      {detail.lead?.interest ? <p className="text-xs text-muted">Interesse informado: {detail.lead.interest}</p> : null}
    </div>
  );
}

/** Coluna direita: dados do lead/cliente, canais, localização/rota, próximas ações e interesses. */
export function ContextPanel({ detail, className, hideLocationOnMobile }: { detail: WorkspaceDetail; className?: string; hideLocationOnMobile?: boolean }) {
  return (
    <div className={cn("flex flex-col gap-4", className)}>
      <LeadCard detail={detail} />
      <ChannelsCard detail={detail} />
      <LocationCard detail={detail} className={hideLocationOnMobile ? "max-lg:hidden" : undefined} />
      <Card>
        <CardHeader className="pb-3">
          <CardTitle>Próximas ações</CardTitle>
        </CardHeader>
        <CardContent className="pt-0">
          <NextActionsList detail={detail} />
        </CardContent>
      </Card>
      <Card>
        <CardHeader className="pb-3">
          <CardTitle>Interesses</CardTitle>
        </CardHeader>
        <CardContent className="pt-0">
          <InterestsList detail={detail} />
        </CardContent>
      </Card>
    </div>
  );
}
