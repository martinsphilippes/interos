"use client";

import * as React from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { CheckCircle2, Hand, Inbox, Mail, MessageCircle, Reply, UserPlus } from "lucide-react";
import type { ActionResult } from "@/domain/types";
import { Avatar } from "@/components/ui/avatar";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Dialog, DialogBody, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { EmptyState } from "@/components/ui/empty-state";
import { SectionTitle } from "@/components/ui/section-title";
import { SegmentedControl } from "@/components/ui/segmented-control";
import { Textarea } from "@/components/ui/textarea";
import { toast } from "@/components/ui/toast";
import { formatPhone } from "@/lib/format";
import { assumeInboxItemAction, replyInboxAction } from "@/server/marketing/actions";
import { ScorePill, TemperatureBadge } from "./lead-badges";
import type { InboxData, InboxMessage } from "./marketing-model";
import { RelativeTime } from "@/components/ui/relative-time";

type ReplyTarget = { communicationId?: string; leadId?: string; name: string; channel: "whatsapp" | "email"; quote?: string };

/** Caixa de entrada unificada: mensagens recebidas (WhatsApp/e-mail) e leads novos sem responsável. */
export function InboxView({ data, currentUserId }: { data: InboxData; currentUserId: string }) {
  const router = useRouter();
  const [filter, setFilter] = React.useState<"pendentes" | "todas">("pendentes");
  const [reply, setReply] = React.useState<ReplyTarget | null>(null);
  const [busyId, setBusyId] = React.useState<string | null>(null);
  const [, startTransition] = React.useTransition();

  const run = (id: string, action: () => Promise<ActionResult<unknown>>, message: string) => {
    setBusyId(id);
    startTransition(async () => {
      const result = await action();
      setBusyId(null);
      if (!result.ok) {
        toast.error(result.error);
        return;
      }
      toast.success(message);
      router.refresh();
    });
  };

  const messages = filter === "pendentes" ? data.messages.filter((m) => !m.replied) : data.messages;
  const pendingCount = data.messages.filter((m) => !m.replied).length;

  return (
    <div className="grid gap-6 lg:grid-cols-[minmax(0,1.6fr)_minmax(0,1fr)]">
      <section>
        <SectionTitle
          title="Mensagens recebidas"
          count={pendingCount}
          description="WhatsApp e e-mail dos últimos 30 dias"
          actions={
            <SegmentedControl
              size="sm"
              aria-label="Filtro de mensagens"
              value={filter}
              onChange={setFilter}
              options={[
                { value: "pendentes", label: "Não respondidas" },
                { value: "todas", label: "Todas" },
              ]}
            />
          }
        />
        {messages.length === 0 ? (
          <Card>
            <EmptyState size="sm" icon={filter === "pendentes" ? <CheckCircle2 /> : <Inbox />} title={filter === "pendentes" ? "Tudo respondido" : "Nenhuma mensagem recebida"} description="Mensagens de entrada aparecem aqui assim que chegam." />
          </Card>
        ) : (
          <ul className="flex flex-col gap-2">
            {messages.map((m) => (
              <MessageItem
                key={m.id}
                message={m}
                currentUserId={currentUserId}
                busy={busyId === m.id}
                onAssume={() => run(m.id, () => assumeInboxItemAction({ kind: "message", id: m.id }), "Conversa assumida")}
                onReply={() => setReply({ communicationId: m.id, leadId: m.leadId, name: m.leadName ?? m.clientName ?? "contato", channel: m.channel === "email" ? "email" : "whatsapp", quote: m.body })}
              />
            ))}
          </ul>
        )}
      </section>

      <section>
        <SectionTitle title="Leads novos sem responsável" count={data.newLeads.length} description="Captados nas últimas 72 horas" />
        {data.newLeads.length === 0 ? (
          <Card>
            <EmptyState size="sm" icon={<UserPlus />} title="Nenhum lead esperando" description="Todo lead recente já tem responsável." />
          </Card>
        ) : (
          <ul className="flex flex-col gap-2">
            {data.newLeads.map((lead) => (
              <li key={lead.id} className="rounded-lg border border-border bg-surface p-3 shadow-card">
                <div className="flex items-start gap-3">
                  <ScorePill score={lead.score} temperature={lead.temperature} />
                  <div className="min-w-0 flex-1">
                    <Link href={`/marketing/leads?lead=${lead.id}`} className="block truncate font-medium hover:underline">
                      {lead.name}
                    </Link>
                    <p className="truncate text-xs text-muted">
                      {[lead.company, lead.originName, lead.phone ? formatPhone(lead.phone) : lead.email].filter(Boolean).join(" · ")}
                    </p>
                    <p className="mt-1 flex items-center gap-2 text-xs text-muted">
                      <TemperatureBadge temperature={lead.temperature} /> captado <RelativeTime value={lead.createdAt} />
                    </p>
                  </div>
                </div>
                <div className="mt-2 flex gap-2">
                  <Button size="sm" className="h-11 flex-1 md:h-8" loading={busyId === lead.id} onClick={() => run(lead.id, () => assumeInboxItemAction({ kind: "lead", id: lead.id }), "Lead assumido")}>
                    <Hand /> Assumir
                  </Button>
                  <Button
                    size="sm"
                    variant="outline"
                    className="h-11 flex-1 md:h-8"
                    disabled={!lead.phone && !lead.email}
                    onClick={() => setReply({ leadId: lead.id, name: lead.name, channel: lead.phone ? "whatsapp" : "email" })}
                  >
                    <Reply /> Responder
                  </Button>
                </div>
              </li>
            ))}
          </ul>
        )}
      </section>

      <ReplyDialog target={reply} onClose={() => setReply(null)} />
    </div>
  );
}

function MessageItem({ message: m, currentUserId, busy, onAssume, onReply }: { message: InboxMessage; currentUserId: string; busy: boolean; onAssume: () => void; onReply: () => void }) {
  const Icon = m.channel === "email" ? Mail : MessageCircle;
  const who = m.leadName ?? m.clientName ?? m.from ?? "Contato não identificado";
  const href = m.leadId ? `/marketing/leads?lead=${m.leadId}` : m.clientId ? `/clientes/${m.clientId}?aba=timeline` : null;
  return (
    <li className="rounded-lg border border-border bg-surface p-3 shadow-card">
      <div className="flex items-start gap-3">
        <span className="flex size-9 shrink-0 items-center justify-center rounded-full bg-secondary-soft text-secondary-fg">
          <Icon className="size-4" />
        </span>
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
            {href ? (
              <Link href={href} className="font-medium hover:underline">
                {who}
              </Link>
            ) : (
              <span className="font-medium">{who}</span>
            )}
            {m.leadName && m.clientName ? <span className="text-xs text-muted">· {m.clientName}</span> : null}
            <span className="text-xs text-muted"><RelativeTime value={m.receivedAt} /></span>
            {m.replied ? (
              <Badge variant="success" size="sm">
                Respondida
              </Badge>
            ) : (
              <Badge variant="warning" size="sm">
                Aguardando resposta
              </Badge>
            )}
          </div>
          {m.body ? <p className="mt-1 whitespace-pre-line text-sm">{m.body}</p> : null}
          <div className="mt-2 flex flex-wrap items-center gap-2">
            {m.assigneeName ? (
              <span className="flex items-center gap-1.5 text-xs text-muted">
                <Avatar name={m.assigneeName} size="xs" /> {m.assigneeId === currentUserId ? "Com você" : `Com ${m.assigneeName}`}
              </span>
            ) : (
              <Button size="sm" variant="outline" className="h-11 md:h-8" loading={busy} onClick={onAssume}>
                <Hand /> Assumir
              </Button>
            )}
            <Button size="sm" className="h-11 md:h-8" onClick={onReply}>
              <Reply /> Responder
            </Button>
          </div>
        </div>
      </div>
    </li>
  );
}

function ReplyDialog({ target, onClose }: { target: ReplyTarget | null; onClose: () => void }) {
  const router = useRouter();
  const [pending, startTransition] = React.useTransition();
  const [body, setBody] = React.useState("");
  const [channel, setChannel] = React.useState<"whatsapp" | "email">("whatsapp");
  const [prevTarget, setPrevTarget] = React.useState(target);
  if (target !== prevTarget) {
    setPrevTarget(target);
    if (target) {
      setChannel(target.channel);
      setBody("");
    }
  }

  const submit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!target) return;
    startTransition(async () => {
      const result = await replyInboxAction({ communicationId: target.communicationId, leadId: target.leadId, channel, body });
      if (!result.ok) {
        toast.error(result.error);
        return;
      }
      toast.success("Resposta registrada (envio simulado)");
      onClose();
      router.refresh();
    });
  };

  return (
    <Dialog open={target !== null} onOpenChange={(v) => !v && !pending && onClose()}>
      <DialogContent>
        <form onSubmit={submit} className="flex min-h-0 flex-col">
          <DialogHeader>
            <DialogTitle>Responder {target?.name}</DialogTitle>
            <DialogDescription>O envio é simulado até a integração real do WhatsApp; a mensagem fica registrada na timeline.</DialogDescription>
          </DialogHeader>
          <DialogBody className="flex flex-col gap-3">
            {target?.quote ? <blockquote className="rounded-md border-l-2 border-border-strong bg-surface-muted px-3 py-2 text-sm text-muted">{target.quote}</blockquote> : null}
            <SegmentedControl
              aria-label="Canal"
              value={channel}
              onChange={setChannel}
              options={[
                { value: "whatsapp", label: "WhatsApp", icon: <MessageCircle /> },
                { value: "email", label: "E-mail", icon: <Mail /> },
              ]}
            />
            <Textarea value={body} onChange={(e) => setBody(e.target.value)} required placeholder="Escreva a resposta…" aria-label="Resposta" autoFocus />
          </DialogBody>
          <DialogFooter>
            <Button variant="outline" onClick={onClose} disabled={pending}>
              Cancelar
            </Button>
            <Button type="submit" loading={pending} disabled={!body.trim()}>
              <Reply /> Enviar
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
