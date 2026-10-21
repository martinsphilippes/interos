"use client";

import * as React from "react";
import Link from "next/link";
import { Building2, History, Mail, MessageCircle, Phone, Ticket, UserPlus, UserRound } from "lucide-react";
import type { ConversationDetail } from "@/server/conversations/queries";
import { CLIENT_STATUS_LABELS } from "@/domain/constants";
import { formatCurrency, formatDate, formatPhone } from "@/lib/format";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { useCanSeeFn } from "@/components/auth/access-provider";
import { cn } from "@/lib/utils";
import { CHANNEL_LABELS } from "./model";

function Section({ title, icon, action, children }: { title: string; icon: React.ReactNode; action?: React.ReactNode; children: React.ReactNode }) {
  return (
    <Card>
      <CardHeader className="flex-row items-center justify-between gap-2 px-4 pb-2 pt-3.5">
        <CardTitle className="inline-flex items-center gap-2 text-[15px] [&_svg]:size-4 [&_svg]:text-muted">
          {icon}
          {title}
        </CardTitle>
        {action}
      </CardHeader>
      <CardContent className="px-4 pb-4 pt-0">{children}</CardContent>
    </Card>
  );
}

const LEAD_STATUS: Record<string, string> = { novo: "Novo", em_contato: "Em contato", qualificado: "Qualificado", desqualificado: "Desqualificado", convertido: "Convertido" };

/** Coluna da direita: o cliente (resumo do Cliente 360), contatos, chamados abertos, atendimentos anteriores ou o lead. */
export function ConversationContext({ detail, onIdentify, className }: { detail: ConversationDetail; onIdentify?: () => void; className?: string }) {
  const canSee = useCanSeeFn();
  const { context, conversation, capabilities } = detail;
  const client = context.client;

  return (
    <aside className={cn("flex min-h-0 flex-col gap-3", className)} aria-label="Contexto do contato">
      {client ? (
        <Section
          title="Cliente"
          icon={<Building2 />}
          action={
            canSee(`/clientes/${client.id}`) ? (
              <Link href={`/clientes/${client.id}`} className="text-xs font-medium text-brand-fg hover:underline">
                Cliente 360
              </Link>
            ) : null
          }
        >
          <p className="text-sm font-semibold">{client.tradeName}</p>
          <div className="mt-1.5 flex flex-wrap items-center gap-1.5 text-xs">
            <Badge size="sm" variant={client.status === "cancelado" ? "muted" : client.status === "ativo" ? "success" : "info"}>
              {CLIENT_STATUS_LABELS[client.status]}
            </Badge>
            {client.healthScore !== undefined ? (
              <Badge size="sm" variant={client.healthLevel === "risco" ? "danger" : client.healthLevel === "atencao" ? "warning" : "success"}>
                saúde {client.healthScore}%
              </Badge>
            ) : null}
            {client.mrr > 0 ? <span className="text-muted">{formatCurrency(client.mrr)}/mês</span> : null}
          </div>
          {context.contact ? (
            <p className="mt-2 text-xs text-muted">
              Falando com <span className="font-medium text-foreground">{context.contact.name}</span>
              {context.contact.role ? ` · ${context.contact.role}` : ""}
            </p>
          ) : null}
        </Section>
      ) : context.lead ? (
        <Section
          title="Lead"
          icon={<UserRound />}
          action={
            canSee("/marketing/leads") ? (
              <Link href={`/marketing/leads?lead=${context.lead.id}`} className="text-xs font-medium text-brand-fg hover:underline">
                Abrir lead
              </Link>
            ) : null
          }
        >
          <p className="text-sm font-semibold">{context.lead.name}</p>
          {context.lead.company ? <p className="text-xs text-muted">{context.lead.company}</p> : null}
          <div className="mt-1.5 flex flex-wrap items-center gap-1.5 text-xs">
            <Badge size="sm" variant="info">
              {LEAD_STATUS[context.lead.status] ?? context.lead.status}
            </Badge>
            <span className="text-muted">origem {context.lead.origin}</span>
            <span className="text-muted">score {context.lead.score}</span>
          </div>
          <p className="mt-2 text-xs text-muted">Responsável: {context.lead.ownerName ?? "sem responsável"}</p>
        </Section>
      ) : (
        <Section title="Contato não identificado" icon={<UserPlus />}>
          <p className="text-sm text-muted">
            {conversation.displayName ? (
              <>
                Perfil no {CHANNEL_LABELS[conversation.channel]}: <span className="font-medium text-foreground">{conversation.displayName}</span>.{" "}
              </>
            ) : null}
            {conversation.channel === "whatsapp" ? "Este número não está cadastrado." : conversation.channel === "email" ? "Este e-mail não está cadastrado." : `Contato do ${CHANNEL_LABELS[conversation.channel]} ainda não identificado: use «Quem é?» para ligar a um cliente ou lead (as próximas conversas já vêm identificadas).`}
          </p>
          {capabilities.identify && onIdentify ? (
            <Button size="sm" variant="outline" className="mt-3 w-full" onClick={onIdentify}>
              <UserPlus /> Quem é?
            </Button>
          ) : null}
        </Section>
      )}

      {context.contacts.length > 0 ? (
        <Section title="Como falar com eles" icon={<UserRound />}>
          <ul className="flex flex-col gap-2">
            {context.contacts.map((c) => (
              <li key={c.id} className="rounded-lg border border-border px-3 py-2 text-xs">
                <p className="text-sm font-medium text-foreground">
                  {c.name}
                  {c.isPrimary ? <span className="ml-1 text-[11px] font-normal text-muted">(principal)</span> : null}
                </p>
                {c.role ? <p className="text-muted">{c.role}</p> : null}
                <div className="mt-1 flex flex-col gap-0.5 text-muted">
                  {c.whatsapp ? (
                    <span className="inline-flex items-center gap-1">
                      <MessageCircle className="size-3" aria-hidden /> {formatPhone(c.whatsapp)}
                    </span>
                  ) : null}
                  {c.phone && c.phone !== c.whatsapp ? (
                    <span className="inline-flex items-center gap-1">
                      <Phone className="size-3" aria-hidden /> {formatPhone(c.phone)}
                    </span>
                  ) : null}
                  {c.email ? (
                    <span className="inline-flex items-center gap-1 break-all">
                      <Mail className="size-3" aria-hidden /> {c.email}
                    </span>
                  ) : null}
                </div>
              </li>
            ))}
          </ul>
        </Section>
      ) : null}

      {client ? (
        <Section title="Chamados abertos" icon={<Ticket />}>
          {context.openTickets.length === 0 ? (
            <p className="text-xs text-muted">Nenhum chamado aberto.</p>
          ) : (
            <ul className="flex flex-col gap-1.5">
              {context.openTickets.map((t) => (
                <li key={t.id}>
                  <Link href={`/suporte?chamado=${t.id}`} className="block rounded-lg border border-border px-3 py-2 text-xs hover:border-border-strong hover:bg-surface-hover">
                    <span className="font-mono font-semibold text-secondary-fg">#{t.number}</span>
                    {t.id === conversation.ticketId ? <span className="ml-1 text-[11px] text-brand-fg">· ligado a esta conversa</span> : null}
                    <p className="mt-0.5 line-clamp-2 text-foreground">{t.subject}</p>
                  </Link>
                </li>
              ))}
            </ul>
          )}
        </Section>
      ) : null}

      <Section title="Atendimentos anteriores" icon={<History />}>
        {context.previous.length === 0 ? (
          <p className="text-xs text-muted">Primeiro atendimento deste contato por {CHANNEL_LABELS[conversation.channel]}.</p>
        ) : (
          <ul className="flex flex-col gap-1.5 text-xs">
            {context.previous.map((p) => (
              <li key={p.id} className="rounded-lg border border-border px-3 py-2">
                <span className="font-mono text-secondary-fg">{p.number}</span> <span className="text-muted">· {formatDate(p.at, "dd/MM/yyyy")}</span>
                <p className="text-muted">
                  {[p.reason, p.assigneeName].filter(Boolean).join(" · ") || "Encerrado"}
                </p>
              </li>
            ))}
          </ul>
        )}
      </Section>
    </aside>
  );
}
