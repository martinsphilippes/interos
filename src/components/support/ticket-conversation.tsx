"use client";

import * as React from "react";
import { useRouter } from "next/navigation";
import { ArrowRightLeft, Lock, Mail, MessageCircle, Globe, Paperclip, Phone, PhoneIncoming, PhoneOutgoing, PlayCircle, Send, StickyNote } from "lucide-react";
import type { TicketDetail } from "@/server/support/queries";
import { addNoteAction, registerCallAction, replyTicketAction } from "@/server/support/actions";
import { INTERACTION_KIND_LABELS, REPLY_CHANNELS, TICKET_CHANNEL_LABELS, type ReplyChannel } from "@/server/support/schemas";
import { formatDateTime, formatRelative } from "@/lib/format";
import { Avatar } from "@/components/ui/avatar";
import { Button } from "@/components/ui/button";
import { FormField } from "@/components/ui/form-field";
import { Input } from "@/components/ui/input";
import { SegmentedControl } from "@/components/ui/segmented-control";
import { Select } from "@/components/ui/select";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Textarea } from "@/components/ui/textarea";
import { toast } from "@/components/ui/toast";
import { cn } from "@/lib/utils";
import { formatCallDuration } from "./format";

type Interaction = TicketDetail["interactions"][number];

const REPLY_ICON: Record<ReplyChannel, typeof Mail> = { whatsapp: MessageCircle, email: Mail, portal: Globe };

function Bubble({ item, detail }: { item: Interaction; detail: TicketDetail }) {
  const author = item.authorId ? detail.users[item.authorId] : undefined;
  const fromCustomer = !item.authorId && item.kind !== "status";
  const customerName = detail.contact?.name ?? detail.client?.tradeName ?? "Cliente";
  const time = (
    <time dateTime={item.createdAt} title={formatDateTime(item.createdAt)} className="text-[11px] text-muted">
      {formatRelative(item.createdAt)}
    </time>
  );

  if (item.kind === "status") {
    return (
      <li className="flex items-center justify-center gap-2 py-1 text-center text-xs text-muted">
        <ArrowRightLeft className="size-3.5 shrink-0" aria-hidden />
        <span>
          {item.body}
          {author ? ` · ${author.name.split(" ")[0]}` : ""} · {formatDateTime(item.createdAt)}
        </span>
      </li>
    );
  }

  const isNote = item.kind === "nota_interna";
  const isCall = item.kind === "ligacao";
  const channelLabel = item.channel ? TICKET_CHANNEL_LABELS[item.channel] : item.kind === "whatsapp" ? "WhatsApp" : item.kind === "email" ? "E-mail" : undefined;

  return (
    <li className={cn("flex gap-2.5", !fromCustomer && !isNote && "flex-row-reverse")}>
      <Avatar name={fromCustomer ? customerName : (author?.name ?? "Equipe")} src={author?.avatarUrl} size="sm" className="mt-1" />
      <div
        className={cn(
          "min-w-0 max-w-[min(560px,85%)] rounded-xl border px-3.5 py-2.5",
          isNote ? "border-warning/50 bg-warning-soft" : fromCustomer ? "border-border bg-surface" : "border-brand/20 bg-brand-soft/60",
        )}
      >
        <div className="mb-1 flex flex-wrap items-center gap-x-2 gap-y-0.5 text-xs">
          <span className="font-semibold text-foreground">{fromCustomer ? customerName : (author?.name ?? "Equipe")}</span>
          <span className="inline-flex items-center gap-1 text-muted">
            {isNote ? <Lock className="size-3" aria-hidden /> : null}
            {isCall ? fromCustomer ? <PhoneIncoming className="size-3" aria-hidden /> : <Phone className="size-3" aria-hidden /> : null}
            {isNote ? "Nota interna (não visível ao cliente)" : isCall ? `Ligação · ${formatCallDuration(item.durationSeconds)}` : [INTERACTION_KIND_LABELS[item.kind], channelLabel && channelLabel !== INTERACTION_KIND_LABELS[item.kind] ? `via ${channelLabel}` : null].filter(Boolean).join(" ")}
          </span>
          {time}
        </div>
        <p className="whitespace-pre-line break-words text-sm text-foreground">{item.body}</p>
        {isCall && item.recordingUrl ? (
          <a href={item.recordingUrl} target="_blank" rel="noreferrer" className="mt-1.5 inline-flex min-h-[32px] items-center gap-1 text-xs font-medium text-secondary-fg hover:underline">
            <PlayCircle className="size-3.5" /> Ouvir gravação (simulada)
          </a>
        ) : null}
        {item.attachments?.length ? (
          <ul className="mt-1.5 flex flex-col gap-0.5">
            {item.attachments.map((url) => (
              <li key={url}>
                <a href={url} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1 break-all text-xs text-secondary-fg hover:underline">
                  <Paperclip className="size-3 shrink-0" /> {url}
                </a>
              </li>
            ))}
          </ul>
        ) : null}
      </div>
    </li>
  );
}

/** Conversa do chamado em ordem cronológica + composer (responder, nota interna, ligação). */
export function TicketConversation({ detail, canOperate }: { detail: TicketDetail; canOperate: boolean }) {
  const { ticket } = detail;
  const endRef = React.useRef<HTMLDivElement>(null);
  const closed = ticket.status === "fechado";

  return (
    <div className="flex flex-col gap-4">
      <ol className="flex flex-col gap-3" aria-label="Conversa do chamado">
        {detail.interactions.length === 0 ? <li className="py-6 text-center text-sm text-muted">Nenhuma interação registrada.</li> : null}
        {detail.interactions.map((item) => (
          <Bubble key={item.id} item={item} detail={detail} />
        ))}
      </ol>
      <div ref={endRef} />
      {canOperate ? (
        closed ? (
          <p className="rounded-lg border border-dashed border-border px-4 py-3 text-center text-sm text-muted">Chamado fechado. Para continuar o atendimento, reabra o chamado (a reabertura conta como reincidência).</p>
        ) : (
          <Composer detail={detail} onSent={() => endRef.current?.scrollIntoView({ behavior: "smooth", block: "end" })} />
        )
      ) : null}
    </div>
  );
}

function Composer({ detail, onSent }: { detail: TicketDetail; onSent: () => void }) {
  const router = useRouter();
  const { ticket } = detail;
  const [tab, setTab] = React.useState("responder");
  const defaultChannel: ReplyChannel = ticket.channel === "email" ? "email" : ticket.channel === "portal" ? "portal" : "whatsapp";
  const [channel, setChannel] = React.useState<ReplyChannel>(defaultChannel);
  const [reply, setReply] = React.useState("");
  const [note, setNote] = React.useState("");
  const [callDirection, setCallDirection] = React.useState<"saida" | "entrada">("saida");
  const [callMinutes, setCallMinutes] = React.useState("5");
  const [callSummary, setCallSummary] = React.useState("");
  const [pending, startTransition] = React.useTransition();
  const id = React.useId();

  const done = (message: string, clear: () => void) => {
    toast.success(message);
    clear();
    router.refresh();
    setTimeout(onSent, 300);
  };

  const sendReply = () =>
    startTransition(async () => {
      const result = await replyTicketAction({ ticketId: ticket.id, channel, body: reply });
      if (!result.ok) return void toast.error(result.error);
      done(channel === "whatsapp" ? "Resposta enviada por WhatsApp (simulado)" : channel === "email" ? "Resposta enviada por e-mail (simulado)" : "Resposta publicada no portal", () => setReply(""));
    });

  const sendNote = () =>
    startTransition(async () => {
      const result = await addNoteAction({ ticketId: ticket.id, body: note });
      if (!result.ok) return void toast.error(result.error);
      done("Nota interna registrada", () => setNote(""));
    });

  const sendCall = () =>
    startTransition(async () => {
      const result = await registerCallAction({ ticketId: ticket.id, direction: callDirection, durationMinutes: Number(callMinutes), summary: callSummary });
      if (!result.ok) return void toast.error(result.error);
      done("Ligação registrada", () => setCallSummary(""));
    });

  const ChannelIconCmp = REPLY_ICON[channel];

  return (
    <div className="sticky bottom-[calc(var(--spacing-mobile-nav)+8px)] z-10 rounded-xl border border-border bg-surface p-3 shadow-pop md:bottom-3">
      <Tabs value={tab} onValueChange={setTab}>
        <TabsList variant="pills" className="w-full md:w-auto">
          <TabsTrigger value="responder">
            <Send /> Responder
          </TabsTrigger>
          <TabsTrigger value="nota">
            <StickyNote /> Nota interna
          </TabsTrigger>
          <TabsTrigger value="ligacao">
            <Phone /> Registrar ligação
          </TabsTrigger>
        </TabsList>

        <TabsContent value="responder" className="mt-3">
          <form
            className="flex flex-col gap-2"
            onSubmit={(e) => {
              e.preventDefault();
              sendReply();
            }}
          >
            <div className="flex flex-wrap items-center gap-2">
              <span className="text-xs text-muted">Canal</span>
              <SegmentedControl
                size="sm"
                aria-label="Canal da resposta"
                value={channel}
                onChange={setChannel}
                options={REPLY_CHANNELS.map((c) => ({ value: c, label: TICKET_CHANNEL_LABELS[c] }))}
              />
              {!ticket.firstResponseAt ? <span className="text-xs font-medium text-warning-fg">Esta será a primeira resposta (conta para o SLA)</span> : null}
            </div>
            <Textarea
              aria-label="Resposta ao cliente"
              value={reply}
              onChange={(e) => setReply(e.target.value)}
              placeholder={`Escreva a resposta para ${detail.contact?.name ?? "o cliente"}…`}
              className="min-h-[88px]"
              onKeyDown={(e) => {
                if (e.key === "Enter" && (e.metaKey || e.ctrlKey) && reply.trim()) sendReply();
              }}
            />
            <div className="flex items-center justify-between gap-2">
              <span className="hidden text-xs text-muted md:inline">Ctrl + Enter para enviar</span>
              <Button type="submit" loading={pending} disabled={!reply.trim()} className="min-h-[44px] md:min-h-0">
                <ChannelIconCmp /> Enviar
              </Button>
            </div>
          </form>
        </TabsContent>

        <TabsContent value="nota" className="mt-3">
          <form
            className="flex flex-col gap-2"
            onSubmit={(e) => {
              e.preventDefault();
              sendNote();
            }}
          >
            <Textarea aria-label="Nota interna" value={note} onChange={(e) => setNote(e.target.value)} placeholder="Visível só para a equipe: diagnóstico, próximos passos, acessos…" className="min-h-[88px] border-warning/50 bg-warning-soft/40" />
            <div className="flex justify-end">
              <Button type="submit" variant="secondary" loading={pending} disabled={!note.trim()} className="min-h-[44px] md:min-h-0">
                <StickyNote /> Salvar nota
              </Button>
            </div>
          </form>
        </TabsContent>

        <TabsContent value="ligacao" className="mt-3">
          <form
            className="flex flex-col gap-3"
            onSubmit={(e) => {
              e.preventDefault();
              sendCall();
            }}
          >
            <div className="grid gap-3 sm:grid-cols-[1fr_140px]">
              <FormField label="Tipo" htmlFor={`${id}-dir`}>
                <Select id={`${id}-dir`} value={callDirection} onChange={(e) => setCallDirection(e.target.value as "saida" | "entrada")} options={[{ value: "saida", label: "Ligação feita para o cliente" }, { value: "entrada", label: "Ligação recebida do cliente" }]} />
              </FormField>
              <FormField label="Duração (min)" htmlFor={`${id}-min`} required>
                <Input id={`${id}-min`} type="number" inputMode="numeric" min={1} max={600} value={callMinutes} onChange={(e) => setCallMinutes(e.target.value)} required />
              </FormField>
            </div>
            <FormField label="Resumo da ligação" htmlFor={`${id}-sum`} required>
              <Textarea id={`${id}-sum`} value={callSummary} onChange={(e) => setCallSummary(e.target.value)} placeholder="O que foi tratado, testes feitos, combinados…" className="min-h-[72px]" required />
            </FormField>
            <div className="flex items-center justify-between gap-2">
              <span className="text-xs text-muted">A gravação é simulada até o provedor VoIP ser conectado.</span>
              <Button type="submit" loading={pending} disabled={!callSummary.trim() || !Number(callMinutes)} className="min-h-[44px] md:min-h-0">
                {callDirection === "saida" ? <PhoneOutgoing /> : <PhoneIncoming />} Registrar
              </Button>
            </div>
          </form>
        </TabsContent>
      </Tabs>
    </div>
  );
}
