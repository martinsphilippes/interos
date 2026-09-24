import type { Metadata } from "next";
import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { Repeat, Smile } from "lucide-react";
import { canAccessModule, requireUser } from "@/server/auth/session";
import { getTicket, getTicketTitle, listArticles } from "@/server/support/queries";
import { canEditArticles, canOperateSupport, ROOT_CAUSE_LABELS } from "@/server/support/schemas";
import { formatDateTime } from "@/lib/format";
import { PageContainer } from "@/components/layout/page-container";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent } from "@/components/ui/card";
import { PageHeader } from "@/components/ui/page-header";
import { OpportunityLink, TicketActions } from "@/components/support/ticket-actions";
import { TicketConversation } from "@/components/support/ticket-conversation";
import { SuggestedArticles, TicketAttachments, TicketClassification, TicketClientCard } from "@/components/support/ticket-side-panels";
import { ChannelIcon, QueueBadge, TicketPriorityBadge } from "@/components/support/ticket-badges";

type Params = Promise<{ id: string }>;

export async function generateMetadata({ params }: { params: Params }): Promise<Metadata> {
  const { id } = await params;
  return { title: (await getTicketTitle(id)) ?? "Chamado" };
}

/** Página completa do chamado: conversa + composer à esquerda, status, cliente e classificação à direita. */
export default async function TicketPage({ params }: { params: Params }) {
  const user = await requireUser();
  if (!canAccessModule(user, "suporte")) redirect("/meu-dia?erro=sem-permissao");
  const { id } = await params;
  const [detail, kb] = await Promise.all([getTicket(id, user), listArticles({ includeDrafts: true })]);
  if (!detail) notFound();
  const { ticket } = detail;
  const canOperate = canOperateSupport(user);

  return (
    <PageContainer>
      <PageHeader
        title={ticket.subject}
        breadcrumbs={[{ label: "Suporte", href: "/suporte" }, { label: "Chamados", href: "/suporte/chamados" }, { label: ticket.number }]}
        badge={<TicketPriorityBadge priority={ticket.priority} size="md" />}
        description={
          <span className="flex flex-wrap items-center gap-x-3 gap-y-1">
            <span className="font-mono">{ticket.number}</span>
            <span>Aberto em {formatDateTime(ticket.openedAt)}</span>
            <ChannelIcon channel={ticket.channel} showLabel />
            <QueueBadge queue={ticket.queue} />
            {detail.client ? (
              <Link href={`/clientes/${detail.client.id}?aba=suporte`} className="font-medium text-foreground hover:text-brand hover:underline">
                {detail.client.tradeName}
              </Link>
            ) : null}
          </span>
        }
      />

      {detail.reopenedFrom || detail.reopenedAs.length > 0 ? (
        <div className="mb-4 flex flex-wrap items-center gap-2 rounded-lg border border-danger/30 bg-danger-soft/50 px-4 py-2.5 text-sm">
          <Repeat className="size-4 text-danger-fg" />
          {detail.reopenedFrom ? (
            <span>
              Reincidência: reabertura do chamado{" "}
              <Link href={`/suporte/chamados/${detail.reopenedFrom.id}`} className="font-medium underline">
                {detail.reopenedFrom.number}
              </Link>
              .
            </span>
          ) : null}
          {detail.reopenedAs.map((r) => (
            <span key={r.id}>
              Reaberto como{" "}
              <Link href={`/suporte/chamados/${r.id}`} className="font-medium underline">
                {r.number}
              </Link>
              .
            </span>
          ))}
        </div>
      ) : null}

      <div className="grid gap-5 lg:grid-cols-[minmax(0,1fr)_360px]">
        <div className="flex min-w-0 flex-col gap-4">
          {ticket.solution || ticket.csatScore !== undefined ? (
            <Card className="border-success/30">
              <CardContent className="flex flex-col gap-2 py-4 text-sm">
                <div className="flex flex-wrap items-center gap-2">
                  <span className="font-semibold">Solução</span>
                  {ticket.rootCause ? <Badge variant="muted">Causa: {ROOT_CAUSE_LABELS[ticket.rootCause] ?? ticket.rootCause}</Badge> : null}
                  {ticket.trainingRelated ? <Badge variant="warning">Relacionado a treinamento</Badge> : null}
                  {ticket.customerConfirmation ? <Badge variant={ticket.customerConfirmation === "sim" ? "success" : "outline"}>Cliente {ticket.customerConfirmation === "sim" ? "confirmou" : "ainda não confirmou"}</Badge> : null}
                  {ticket.csatScore !== undefined ? (
                    <Badge variant={ticket.csatScore >= 9 ? "success" : ticket.csatScore >= 7 ? "warning" : "danger"}>
                      <Smile /> CSAT {ticket.csatScore}
                    </Badge>
                  ) : null}
                </div>
                {ticket.solution ? <p className="whitespace-pre-line">{ticket.solution}</p> : null}
                {detail.csat?.comment ? <p className="text-muted">Comentário do cliente: “{detail.csat.comment}”</p> : null}
              </CardContent>
            </Card>
          ) : null}
          <TicketConversation detail={detail} canOperate={canOperate} />
        </div>

        <aside className="flex flex-col gap-4">
          <TicketActions detail={detail} currentUserId={user.id} canOperate={canOperate} canWriteArticles={canEditArticles(user)} articleCategories={kb.categories} />
          <OpportunityLink detail={detail} />
          <TicketClientCard detail={detail} />
          <TicketClassification key={ticket.updatedAt} detail={detail} canOperate={canOperate} />
          <SuggestedArticles detail={detail} />
          <TicketAttachments detail={detail} canOperate={canOperate} />
        </aside>
      </div>
    </PageContainer>
  );
}
