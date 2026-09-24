import { ArrowRightLeft, CheckCheck, FileText, History, Lock, MessageCircle, Paperclip, Phone, PhoneIncoming, PlayCircle } from "lucide-react";
import type { TicketDetail } from "@/server/support/queries";
import { INTERACTION_KIND_LABELS, TICKET_CHANNEL_LABELS } from "@/server/support/schemas";
import { dateKey, formatDateTime, formatTime } from "@/lib/format";
import { Avatar } from "@/components/ui/avatar";
import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/utils";
import { formatCallDuration } from "./format";
import { ChannelIcon } from "./ticket-badges";
import { isRealRecording } from "./workspace-model";

type Interaction = TicketDetail["interactions"][number];

/** Hora curta (mesmo dia da abertura) ou data e hora. */
function When({ iso, sameDayAs }: { iso: string; sameDayAs?: string }) {
  const short = sameDayAs && dateKey(iso) === dateKey(sameDayAs);
  return (
    <time dateTime={iso} title={formatDateTime(iso)} className="shrink-0 text-[11px] tabular-nums text-muted">
      {short ? formatTime(iso) : formatDateTime(iso)}
    </time>
  );
}

function fileName(url: string): string {
  try {
    const last = new URL(url).pathname.split("/").filter(Boolean).pop();
    return last ? decodeURIComponent(last) : url;
  } catch {
    return url;
  }
}

function Attachments({ urls }: { urls?: string[] }) {
  if (!urls?.length) return null;
  return (
    <ul className="mt-2 flex flex-col gap-1.5">
      {urls.map((url) => (
        <li key={url}>
          <a href={url} target="_blank" rel="noreferrer" className="inline-flex max-w-full items-center gap-2 rounded-lg border border-border-strong bg-surface-muted px-3 py-2 text-xs text-foreground hover:border-brand/40">
            <Paperclip className="size-4 shrink-0 text-muted" aria-hidden />
            <span className="truncate">{fileName(url)}</span>
          </a>
        </li>
      ))}
    </ul>
  );
}

function Item({ item, detail }: { item: Interaction; detail: TicketDetail }) {
  const author = item.authorId ? detail.users[item.authorId] : undefined;
  const opened = detail.ticket.openedAt;

  // Eventos (status, transferências, avaliação): linha discreta centralizada.
  if (item.kind === "status") {
    const transfer = item.body.startsWith("Transferido") || item.body.startsWith("Chamado transferido");
    const Icon = transfer ? ArrowRightLeft : History;
    return (
      <li className="flex items-start justify-center gap-2 px-2 py-0.5 text-center text-xs text-muted">
        <Icon className={cn("mt-0.5 size-3.5 shrink-0", transfer && "text-secondary-fg")} aria-hidden />
        <span className="min-w-0">
          {item.body}
          {author ? ` · ${author.name.split(" ")[0]}` : ""} · <When iso={item.createdAt} sameDayAs={opened} />
        </span>
      </li>
    );
  }

  // Nota interna: faixa âmbar na largura toda, nunca vai ao cliente.
  if (item.kind === "nota_interna") {
    return (
      <li className="rounded-xl border border-warning/40 bg-warning-soft px-3.5 py-2.5">
        <div className="mb-1 flex flex-wrap items-center gap-x-2 gap-y-0.5 text-xs">
          <Lock className="size-3.5 text-warning-fg" aria-hidden />
          <span className="font-semibold text-warning-fg">Nota interna</span>
          <span className="text-muted">{author?.name ?? "Equipe"} · não visível ao cliente</span>
          <span className="ml-auto">
            <When iso={item.createdAt} sameDayAs={opened} />
          </span>
        </div>
        <p className="whitespace-pre-line break-words text-sm text-foreground">{item.body}</p>
        <Attachments urls={item.attachments} />
      </li>
    );
  }

  // Ligação: linha com ícone, duração e gravação (só quando há gravação real do VoIP).
  if (item.kind === "ligacao") {
    const incoming = !item.authorId;
    const recording = isRealRecording(item.recordingUrl);
    return (
      <li className="rounded-xl border border-border-strong bg-surface-muted px-3.5 py-2.5">
        <div className="flex flex-wrap items-center gap-x-2 gap-y-1 text-sm">
          <span className="flex size-7 shrink-0 items-center justify-center rounded-full bg-info-soft text-info-fg" aria-hidden>
            {incoming ? <PhoneIncoming className="size-3.5" /> : <Phone className="size-3.5" />}
          </span>
          <span className="font-medium text-foreground">{incoming ? "Ligação recebida" : "Ligação realizada"}</span>
          <span className="text-muted">— {formatCallDuration(item.durationSeconds)}</span>
          {recording ? (
            <a href={item.recordingUrl} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1 text-xs font-medium text-info-fg hover:underline">
              <PlayCircle className="size-3.5" /> Ouvir gravação
            </a>
          ) : (
            <span className="text-xs text-muted">— sem gravação (VoIP não conectado)</span>
          )}
          <span className="ml-auto">
            <When iso={item.createdAt} sameDayAs={opened} />
          </span>
        </div>
        {item.body ? <p className="mt-1.5 whitespace-pre-line break-words pl-9 text-sm text-foreground">{item.body}</p> : null}
        <p className="mt-1 pl-9 text-[11px] text-muted">
          {author ? `${author.name} · ` : ""}
          {item.manual !== false ? "registro manual" : "registrada pelo VoIP"}
        </p>
      </li>
    );
  }

  // Mensagens: cliente à esquerda, atendente à direita.
  const fromCustomer = !item.authorId;
  const customerName = detail.contact?.name ?? detail.client?.tradeName ?? "Cliente";
  const name = fromCustomer ? customerName : (author?.name ?? "Equipe");
  const channel = item.channel ? TICKET_CHANNEL_LABELS[item.channel] : item.kind === "whatsapp" ? "WhatsApp" : item.kind === "email" ? "E-mail" : undefined;
  return (
    <li className={cn("flex items-end gap-2.5", !fromCustomer && "flex-row-reverse")}>
      <Avatar name={name} src={author?.avatarUrl} size="md" className="mb-0.5 hidden sm:flex" />
      <div
        className={cn(
          "min-w-0 max-w-[min(560px,88%)] rounded-2xl border px-3.5 py-2.5",
          fromCustomer ? "rounded-bl-md border-border-strong bg-surface-muted" : "rounded-br-md border-success/30 bg-success-soft",
        )}
      >
        <div className="mb-1 flex flex-wrap items-center gap-x-1.5 gap-y-0.5 text-xs">
          <span className="font-semibold text-foreground">{name}</span>
          <span className="text-muted">({fromCustomer ? "Cliente" : "Atendente"})</span>
        </div>
        <p className="whitespace-pre-line break-words text-sm text-foreground">{item.body}</p>
        <Attachments urls={item.attachments} />
        <div className="mt-1.5 flex flex-wrap items-center justify-end gap-x-2 gap-y-1 text-[11px] text-muted">
          {channel && channel !== INTERACTION_KIND_LABELS[item.kind] ? <span>via {channel}</span> : channel ? <span>{channel}</span> : null}
          {!fromCustomer && item.manual ? (
            <Badge variant="outline" size="sm" title="A integração do canal não está conectada: a mensagem foi registrada no chamado e enviada pelo app do atendente.">
              registro manual
            </Badge>
          ) : null}
          <When iso={item.createdAt} sameDayAs={opened} />
          {!fromCustomer && !item.manual && item.channel !== "portal" ? <CheckCheck className="size-3.5 text-success-fg" aria-label="enviada" /> : null}
        </div>
      </div>
    </li>
  );
}

/**
 * Conversa completa do chamado (ticket_interactions em ordem cronológica): mensagens em balões, notas
 * internas destacadas, ligações com duração, anexos e mudanças de status/transferências como linhas discretas.
 */
export function ConversationThread({ detail, className }: { detail: TicketDetail; className?: string }) {
  const { ticket } = detail;
  return (
    <ol className={cn("flex flex-col gap-3", className)} aria-label="Conversa do chamado">
      <li className="flex flex-wrap items-center gap-x-3 gap-y-1 border-b border-border pb-3 text-xs text-muted">
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
      </li>
      {detail.interactions.length === 0 ? <li className="py-6 text-center text-sm text-muted">Nenhuma interação registrada.</li> : null}
      {detail.interactions.map((item) => (
        <Item key={item.id} item={item} detail={detail} />
      ))}
    </ol>
  );
}
