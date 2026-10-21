"use client";

import * as React from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { ArrowLeft, ArrowRightLeft, CheckCircle2, Hand, UserCog, UserPlus } from "lucide-react";
import { assignConversationAction, assumeConversationAction } from "@/server/conversations/actions";
import type { ConversationDetail } from "@/server/conversations/queries";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { ConversationThread } from "@/components/ui/conversation-thread";
import { IconTile } from "@/components/ui/icon-tile";
import { Select } from "@/components/ui/select";
import { SlaBadge } from "@/components/ui/sla-badge";
import { toast } from "@/components/ui/toast";
import { displayPhone } from "@/domain/phone";
import { cn } from "@/lib/utils";
import { CloseDialog } from "./close-dialog";
import { ConversationComposer } from "./conversation-composer";
import { ConversationContext } from "./conversation-context";
import { IdentifyDialog } from "./identify-dialog";
import { CHANNEL_LABELS, toThreadItems } from "./model";
import { TransferDialog, type TransferOptions } from "./transfer-dialog";
import { CHANNEL_TONE, ChannelGlyph } from "./channel-icon";

export interface ConversationPanelProps {
  detail: ConversationDetail;
  transferOptions: TransferOptions;
  currentUserId: string;
  now: number;
  backHref: string;
  /** Abaixo de xl, o contexto fica numa aba do painel. */
  showContextTab: boolean;
  className?: string;
}

/** Coluna do meio: cabeçalho com as ações, avisos (janela de 24 h, canal manual), a conversa e o campo de resposta. */
export function ConversationPanel({ detail, transferOptions, currentUserId, now, backHref, showContextTab, className }: ConversationPanelProps) {
  const router = useRouter();
  const { conversation: c, row, capabilities: caps } = detail;
  const [dialog, setDialog] = React.useState<null | "transfer" | "close" | "identify">(null);
  const [tab, setTab] = React.useState<"conversa" | "contexto">("conversa");
  const [pending, startTransition] = React.useTransition();
  const mine = c.assigneeId === currentUserId;
  const slaRemaining = row.sla ? new Date(row.sla.dueAt).getTime() - now : undefined;

  const assume = () =>
    startTransition(async () => {
      const r = await assumeConversationAction({ conversationId: c.id });
      if (!r.ok) return void toast.error(r.error);
      toast.success("Conversa assumida");
      router.refresh();
    });

  const assign = (assigneeId: string) =>
    startTransition(async () => {
      if (!assigneeId) return;
      const r = await assignConversationAction({ conversationId: c.id, assigneeId });
      if (!r.ok) return void toast.error(r.error);
      toast.success("Conversa atribuída");
      router.refresh();
    });

  return (
    <section className={cn("flex min-h-0 flex-col overflow-hidden rounded-xl border border-border bg-surface shadow-card", className)} aria-label={`Conversa com ${row.name}`}>
      <header className="flex flex-col gap-2 border-b border-border px-4 py-3">
        <div className="flex flex-col gap-2 2xl:flex-row 2xl:items-start 2xl:justify-between">
          <div className="flex min-w-0 items-center gap-2.5">
            <Link href={backHref} className="inline-flex size-9 shrink-0 items-center justify-center rounded-lg text-muted hover:bg-surface-hover lg:hidden" aria-label="Voltar para a lista">
              <ArrowLeft className="size-4" />
            </Link>
            <IconTile icon={<ChannelGlyph channel={c.channel} />} tone={CHANNEL_TONE[c.channel]} />
            <div className="min-w-0">
              <h2 className="truncate text-base font-semibold">{row.name}</h2>
              <p className="truncate text-xs text-muted">
                {row.subtitle} · {CHANNEL_LABELS[c.channel]}{c.channel === "whatsapp" ? ` ${displayPhone(c.address)}` : c.channel === "email" ? ` ${c.address}` : ""} · <span className="font-mono">{c.number}</span>
              </p>
            </div>
          </div>
          <div className="flex shrink-0 flex-wrap gap-1.5">
            {caps.assume ? (
              <Button size="sm" onClick={assume} loading={pending} className="min-h-[40px] md:min-h-8">
                <Hand /> Assumir
              </Button>
            ) : null}
            {caps.identify && c.identity === "desconhecido" ? (
              <Button size="sm" variant="outline" onClick={() => setDialog("identify")} className="min-h-[40px] md:min-h-8">
                <UserPlus /> Quem é?
              </Button>
            ) : null}
            {caps.transfer ? (
              <Button size="sm" variant="outline" onClick={() => setDialog("transfer")} className="min-h-[40px] md:min-h-8">
                <ArrowRightLeft /> Transferir
              </Button>
            ) : null}
            {caps.close ? (
              <Button size="sm" variant="secondary" onClick={() => setDialog("close")} className="min-h-[40px] md:min-h-8">
                <CheckCircle2 /> Encerrar
              </Button>
            ) : null}
          </div>
        </div>
        <div className="flex flex-wrap items-center gap-2 text-xs">
          <Badge size="sm" variant={c.status === "encerrada" ? "muted" : c.status === "na_fila" ? "warning" : "info"}>
            {row.statusLabel}
          </Badge>
          {row.queueName ? <span className="text-muted">Fila {row.queueName}</span> : null}
          <span className="text-muted">·</span>
          {caps.assign ? (
            <span className="inline-flex items-center gap-1">
              <UserCog className="size-3.5 text-muted" aria-hidden />
              <Select
                aria-label="Responsável"
                size="sm"
                value={c.assigneeId ?? ""}
                disabled={pending}
                onChange={(e) => assign(e.target.value)}
                className="w-44"
                options={[
                  { value: "", label: "Sem responsável", disabled: true },
                  // Responsável atual fora das filas (ex.: gestor que assumiu) continua aparecendo.
                  ...(c.assigneeId && !transferOptions.users.some((u) => u.id === c.assigneeId) ? [{ value: c.assigneeId, label: row.assigneeName ?? "Responsável atual" }] : []),
                  ...transferOptions.users.map((u) => ({ value: u.id, label: `${u.name}${u.presence === "online" ? "" : " (fora)"}` })),
                ]}
              />
            </span>
          ) : (
            <span className={cn(mine ? "font-medium text-foreground" : "text-muted")}>{row.assigneeName ? (mine ? "Com você" : `Com ${row.assigneeName}`) : "Sem responsável"}</span>
          )}
          {row.sla ? <SlaBadge state={row.sla.state} remainingMs={slaRemaining} /> : null}
          {c.transfers ? <span className="text-muted">{c.transfers} transferência(s)</span> : null}
        </div>
        {showContextTab ? (
          <div role="tablist" aria-label="Seções da conversa" className="-mb-3 flex gap-1 xl:hidden">
            {(["conversa", "contexto"] as const).map((t) => (
              <button
                key={t}
                type="button"
                role="tab"
                aria-selected={tab === t}
                onClick={() => setTab(t)}
                className={cn("-mb-px inline-flex min-h-[36px] items-center border-b-2 px-2 text-xs font-medium", tab === t ? "border-brand text-brand-fg" : "border-transparent text-muted hover:text-foreground")}
              >
                {t === "conversa" ? "Conversa" : "Cliente"}
              </button>
            ))}
          </div>
        ) : null}
      </header>

      {tab === "contexto" ? (
        <div className="scrollbar-thin min-h-0 flex-1 overflow-y-auto p-3 xl:hidden">
          <ConversationContext detail={detail} onIdentify={() => setDialog("identify")} />
        </div>
      ) : null}

      <div className={cn("flex min-h-0 flex-1 flex-col", tab === "contexto" && "hidden xl:flex")}>
        {!detail.channelConnected && c.status !== "encerrada" ? (
          <p className="border-b border-border bg-surface-muted px-4 py-2 text-xs text-muted">
            {CHANNEL_LABELS[c.channel]} não está conectado: as respostas ficam como registro manual e você envia pelo aparelho.
          </p>
        ) : null}
        <ConversationThread items={toThreadItems(detail.thread)} autoScroll className="min-h-0 flex-1 px-4 py-3" emptyText="Nenhuma mensagem ainda." aria-label="Mensagens" />
        <div className="border-t border-border p-3">
          <ConversationComposer detail={detail} key={c.id} />
        </div>
      </div>

      {caps.transfer ? <TransferDialog detail={detail} options={transferOptions} open={dialog === "transfer"} onOpenChange={(v) => setDialog(v ? "transfer" : null)} currentUserId={currentUserId} /> : null}
      {caps.close ? <CloseDialog detail={detail} open={dialog === "close"} onOpenChange={(v) => setDialog(v ? "close" : null)} /> : null}
      {caps.identify ? <IdentifyDialog detail={detail} open={dialog === "identify"} onOpenChange={(v) => setDialog(v ? "identify" : null)} /> : null}
    </section>
  );
}
