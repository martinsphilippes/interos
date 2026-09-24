"use client";

import * as React from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { ArrowRight, Building2, Hand, Repeat, Smile, TrendingUp } from "lucide-react";
import type { TicketDetail } from "@/server/support/queries";
import { assumeTicketAction } from "@/server/support/actions";
import { INTERACTION_KIND_LABELS, ROOT_CAUSE_LABELS, TICKET_QUEUE_LABELS, type TicketQueue } from "@/server/support/schemas";
import { formatDateTime, formatRelative } from "@/lib/format";
import { Button } from "@/components/ui/button";
import { Drawer, DrawerBody, DrawerContent, DrawerDescription, DrawerFooter, DrawerHeader, DrawerTitle } from "@/components/ui/drawer";
import { toast } from "@/components/ui/toast";
import { UserChip } from "@/components/ui/user-chip";
import { cn } from "@/lib/utils";
import { LiveSlaBadge } from "./sla-live";
import { ChannelIcon, TicketPriorityBadge, TicketStatusBadge } from "./ticket-badges";

/** Resumo do chamado (?chamado=<id>) com atalho para a página completa. */
export function TicketDrawer({ detail, currentUserId, canOperate }: { detail: TicketDetail | null; currentUserId: string; canOperate: boolean }) {
  const router = useRouter();
  const close = () => {
    const params = new URLSearchParams(window.location.search);
    params.delete("chamado");
    const qs = params.toString();
    router.replace(qs ? `${window.location.pathname}?${qs}` : window.location.pathname, { scroll: false });
  };
  return (
    <Drawer open={Boolean(detail)} onOpenChange={(open) => !open && close()}>
      <DrawerContent size="md">{detail ? <Inner key={detail.ticket.id} detail={detail} currentUserId={currentUserId} canOperate={canOperate} /> : null}</DrawerContent>
    </Drawer>
  );
}

function Row({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="flex items-start justify-between gap-3 py-2 text-sm">
      <span className="text-muted">{label}</span>
      <span className="min-w-0 text-right">{children}</span>
    </div>
  );
}

function Inner({ detail, currentUserId, canOperate }: { detail: TicketDetail; currentUserId: string; canOperate: boolean }) {
  const router = useRouter();
  const [pending, startTransition] = React.useTransition();
  const { ticket, row, client, contact, users } = detail;
  const assignee = ticket.assigneeId ? users[ticket.assigneeId] : undefined;
  const lastMessages = detail.interactions.filter((i) => i.kind !== "status").slice(-3);

  const assume = () =>
    startTransition(async () => {
      const result = await assumeTicketAction({ ticketId: ticket.id });
      if (!result.ok) {
        toast.error(result.error);
        return;
      }
      toast.success(`Chamado ${ticket.number} assumido`);
      router.refresh();
    });

  return (
    <>
      <DrawerHeader>
        <div className="flex flex-wrap items-center gap-2">
          <span className="font-mono text-xs text-muted">{ticket.number}</span>
          <TicketPriorityBadge priority={ticket.priority} />
          <TicketStatusBadge status={ticket.status} />
        </div>
        <DrawerTitle className="mt-1">{ticket.subject}</DrawerTitle>
        <DrawerDescription>
          Aberto {formatRelative(ticket.openedAt)} · {formatDateTime(ticket.openedAt)}
        </DrawerDescription>
      </DrawerHeader>
      <DrawerBody className="flex flex-col gap-4">
        <div className="divide-y divide-border rounded-lg border border-border px-3">
          <Row label="Cliente">
            {client ? (
              <Link href={`/clientes/${client.id}?aba=suporte`} className="inline-flex items-center gap-1.5 font-medium hover:text-brand hover:underline">
                <Building2 className="size-4 text-muted" /> {client.tradeName}
              </Link>
            ) : (
              "—"
            )}
            {contact ? <p className="text-xs text-muted">{contact.name}</p> : null}
          </Row>
          <Row label="SLA">
            <LiveSlaBadge sla={row.sla} />
          </Row>
          <Row label="Canal">
            <ChannelIcon channel={ticket.channel} showLabel />
          </Row>
          <Row label="Atendente">{assignee ? <UserChip name={assignee.name} avatarUrl={assignee.avatarUrl} size="sm" /> : <span className="text-muted">Sem atendente</span>}</Row>
          <Row label="Fila">{TICKET_QUEUE_LABELS[ticket.queue as TicketQueue] ?? ticket.queue}</Row>
          <Row label="Produto / categoria">{[row.productName, ticket.category].filter(Boolean).join(" · ") || "—"}</Row>
          {ticket.resolvedAt ? <Row label="Resolvido em">{formatDateTime(ticket.resolvedAt)}</Row> : null}
          {ticket.rootCause ? <Row label="Causa raiz">{ROOT_CAUSE_LABELS[ticket.rootCause] ?? ticket.rootCause}</Row> : null}
          {ticket.csatScore !== undefined ? (
            <Row label="CSAT">
              <span className="inline-flex items-center gap-1 font-medium">
                <Smile className="size-4 text-muted" /> {ticket.csatScore}
              </span>
            </Row>
          ) : null}
          {detail.reopenedFrom ? (
            <Row label="Reincidência">
              <Link href={`/suporte/chamados/${detail.reopenedFrom.id}`} className="inline-flex items-center gap-1 text-danger-fg hover:underline">
                <Repeat className="size-3.5" /> reabertura de {detail.reopenedFrom.number}
              </Link>
            </Row>
          ) : null}
          {detail.opportunity ? (
            <Row label="Oportunidade">
              <Link href={`/vendas/oportunidades?oportunidade=${detail.opportunity.id}`} className="inline-flex items-center gap-1 hover:underline">
                <TrendingUp className="size-3.5" /> {detail.opportunity.title}
              </Link>
            </Row>
          ) : null}
        </div>

        <section>
          <h3 className="mb-1 text-sm font-semibold">Descrição</h3>
          <p className="whitespace-pre-line text-sm text-foreground">{ticket.description}</p>
        </section>
        {ticket.solution ? (
          <section>
            <h3 className="mb-1 text-sm font-semibold">Solução</h3>
            <p className="whitespace-pre-line text-sm">{ticket.solution}</p>
          </section>
        ) : null}

        <section>
          <h3 className="mb-2 text-sm font-semibold">Últimas interações</h3>
          {lastMessages.length === 0 ? (
            <p className="text-sm text-muted">Nenhuma interação ainda.</p>
          ) : (
            <ul className="flex flex-col gap-2">
              {lastMessages.map((i) => (
                <li key={i.id} className={cn("rounded-lg border px-3 py-2 text-sm", i.kind === "nota_interna" ? "border-warning/40 bg-warning-soft/60" : "border-border")}>
                  <p className="text-xs text-muted">
                    {INTERACTION_KIND_LABELS[i.kind]} · {i.authorId ? (users[i.authorId]?.name ?? "Equipe") : "Cliente"} · {formatRelative(i.createdAt)}
                  </p>
                  <p className="mt-0.5 line-clamp-3 whitespace-pre-line">{i.body}</p>
                </li>
              ))}
            </ul>
          )}
        </section>
      </DrawerBody>
      <DrawerFooter>
        {canOperate && row.open && ticket.assigneeId !== currentUserId ? (
          <Button variant="outline" className="min-h-[44px] md:min-h-0" loading={pending} onClick={assume}>
            <Hand /> Assumir
          </Button>
        ) : null}
        <Button asChild className="min-h-[44px] md:min-h-0">
          <Link href={`/suporte/chamados/${ticket.id}`}>
            Abrir chamado completo <ArrowRight />
          </Link>
        </Button>
      </DrawerFooter>
    </>
  );
}
