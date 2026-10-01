import type { Metadata } from "next";
import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { Repeat, Smile } from "lucide-react";
import { ACCESS_DENIED_REDIRECT, can, canSeeHref, getCurrentUser, requireScreen } from "@/server/auth/session";
import { getTicket, getTicketTitle, listArticles } from "@/server/support/queries";
import { ROOT_CAUSE_LABELS } from "@/server/support/schemas";
import { checkTicketAccess, supportCapabilities } from "@/server/support/access";
import { getSupportChannelStatus } from "@/server/support/integrations";
import { formatDateTime } from "@/lib/format";
import { PageContainer } from "@/components/layout/page-container";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent } from "@/components/ui/card";
import { PageHeader } from "@/components/ui/page-header";
import { OpportunityLink, TicketActions } from "@/components/support/ticket-actions";
import { TicketConversation } from "@/components/support/ticket-conversation";
import { SuggestedArticles, TicketAttachments, TicketClassification, TicketClientCard } from "@/components/support/ticket-side-panels";
import { ChannelIcon, QueueBadge, TicketPriorityBadge } from "@/components/support/ticket-badges";
import { AgentSuggestions } from "@/components/automations/agent-suggestions";

type Params = Promise<{ id: string }>;

/** Título da aba (A30): sem a tela ou fora do escopo, título genérico — o chamado nem é descrito. */
export async function generateMetadata({ params }: { params: Params }): Promise<Metadata> {
  const { id } = await params;
  const user = await getCurrentUser();
  if (!user || !can(user, "suporte.chamados.ver")) return { title: "Chamado" };
  return { title: (await getTicketTitle(id, user)) ?? "Chamado" };
}

/**
 * Página completa do chamado: conversa + composer à esquerda, status, cliente e classificação à direita.
 * Acesso: tela suporte.chamados + escopo do chamado (fora dele → acesso negado); seções (contexto do cliente,
 * sugestões do assistente) e botões pelas chaves do catálogo.
 */
export default async function TicketPage({ params }: { params: Params }) {
  const user = await requireScreen("suporte.chamados");
  const { id } = await params;
  const access = await checkTicketAccess(user, id);
  if (access === "missing") notFound();
  if (access === "denied") redirect(ACCESS_DENIED_REDIRECT);
  const caps = supportCapabilities(user);
  const [detail, kb, channels] = await Promise.all([getTicket(id, user), caps.createArticle ? listArticles({ includeDrafts: true }) : Promise.resolve(null), getSupportChannelStatus()]);
  if (!detail) notFound();
  const { ticket } = detail;
  const showSuggestions = can(user, "suporte.chamados.sugestoes.ver");

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
            {can(user, "suporte.central.workspace.ver") ? (
              <Link href={`/suporte?chamado=${ticket.id}`} className="font-medium text-brand-fg hover:underline">
                Abrir no workspace
              </Link>
            ) : null}
            {detail.client && canSeeHref(user, `/clientes/${detail.client.id}?aba=suporte`) ? (
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

      <div className="grid grid-cols-1 gap-5 lg:grid-cols-[minmax(0,1fr)_360px]">
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
          <TicketConversation detail={detail} capabilities={caps} channels={channels} />
        </div>

        <aside className="flex flex-col gap-4">
          <TicketActions detail={detail} currentUserId={user.id} capabilities={caps} articleCategories={kb?.categories ?? []} articleModules={kb?.modules ?? []} />
          <OpportunityLink detail={detail} />
          {detail.clientContext !== false ? <TicketClientCard detail={detail} /> : null}
          {showSuggestions && ticket.status !== "resolvido" && ticket.status !== "fechado" ? <AgentSuggestions kind="suporte" subjectId={ticket.id} title="Sugestões do assistente" limit={3} /> : null}
          <TicketClassification key={ticket.updatedAt} detail={detail} canOperate={caps.classify} />
          <SuggestedArticles detail={detail} />
          <TicketAttachments detail={detail} canOperate={caps.attach} />
        </aside>
      </div>
    </PageContainer>
  );
}
