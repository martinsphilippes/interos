import { ArrowRightLeft, FileText, History, MessageCircle } from "lucide-react";
import type { TicketDetail } from "@/server/support/queries";
import { TICKET_CHANNEL_LABELS } from "@/server/support/schemas";
import { formatDateTime } from "@/lib/format";
import { ConversationThread as Thread, type ThreadItem } from "@/components/ui/conversation-thread";
import { ChannelIcon } from "./ticket-badges";
import { isRealRecording } from "./workspace-model";

type Interaction = TicketDetail["interactions"][number];

const CHANNEL_LABEL: Record<NonNullable<Interaction["channel"]>, string> = { whatsapp: "WhatsApp", email: "E-mail", portal: "Portal" };

/** Converte uma interação do chamado no item da conversa única do sistema. */
function toThreadItem(item: Interaction, detail: TicketDetail): ThreadItem {
  const author = item.authorId ? detail.users[item.authorId] : undefined;
  if (item.kind === "status") {
    const transfer = item.body.startsWith("Transferido") || item.body.startsWith("Chamado transferido");
    const Icon = transfer ? ArrowRightLeft : History;
    return {
      kind: "system",
      id: item.id,
      at: item.createdAt,
      title: item.body,
      actorName: author?.name.split(" ")[0],
      icon: <Icon className={transfer ? "size-3.5 text-secondary-fg" : "size-3.5 text-muted"} aria-hidden />,
    };
  }
  if (item.kind === "nota_interna") {
    return { kind: "note", id: item.id, at: item.createdAt, authorName: author?.name ?? "Equipe", body: item.body, attachments: item.attachments };
  }
  if (item.kind === "ligacao") {
    return {
      kind: "call",
      id: item.id,
      at: item.createdAt,
      direction: item.authorId ? "saida" : "entrada",
      durationSeconds: item.durationSeconds,
      body: item.body,
      authorName: author?.name,
      manual: item.manual !== false,
      recordingUrl: isRealRecording(item.recordingUrl) ? item.recordingUrl : undefined,
    };
  }
  const fromCustomer = !item.authorId;
  const channel = item.channel ?? (item.kind === "whatsapp" ? "whatsapp" : item.kind === "email" ? "email" : undefined);
  return {
    kind: "message",
    id: item.id,
    at: item.createdAt,
    direction: fromCustomer ? "entrada" : "saida",
    authorName: fromCustomer ? (detail.contact?.name ?? detail.client?.tradeName ?? "Cliente") : (author?.name ?? "Equipe"),
    authorRole: fromCustomer ? "Cliente" : "Atendente",
    avatarUrl: author?.avatarUrl,
    body: item.body,
    channel,
    channelLabel: channel ? CHANNEL_LABEL[channel] : undefined,
    manual: !fromCustomer && Boolean(item.manual),
    delivered: !fromCustomer && !item.manual && channel !== "portal",
    attachments: item.attachments,
  };
}

/**
 * Conversa completa do chamado (ticket_interactions em ordem cronológica) na conversa única do sistema
 * (`@/components/ui/conversation-thread`, a mesma da Central de Vendas).
 */
export function ConversationThread({ detail, className }: { detail: TicketDetail; className?: string }) {
  const { ticket } = detail;
  return (
    <Thread
      aria-label="Conversa do chamado"
      data-testid="conversa-chamado"
      className={className}
      items={detail.interactions.map((item) => toThreadItem(item, detail))}
      emptyText="Nenhuma interação registrada."
      header={
        <>
          <span className="inline-flex items-center gap-1.5 font-medium text-foreground">
            {ticket.channel === "whatsapp" ? <MessageCircle className="size-4 text-success-fg" aria-hidden /> : <ChannelIcon channel={ticket.channel} />}
            {TICKET_CHANNEL_LABELS[ticket.channel]}
          </span>
          <span>Conversa iniciada em {formatDateTime(ticket.openedAt).replace(" ", " às ")}</span>
          {detail.documents.length ? (
            <span className="inline-flex items-center gap-1">
              <FileText className="size-3.5" aria-hidden /> {detail.documents.length} anexo{detail.documents.length === 1 ? "" : "s"}
            </span>
          ) : null}
        </>
      }
    />
  );
}
