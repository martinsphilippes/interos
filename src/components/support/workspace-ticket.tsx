"use client";

import * as React from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import {
  ArrowLeft,
  ArrowRightLeft,
  BookPlus,
  CircleStop,
  ExternalLink,
  Hand,
  Lock,
  MoreVertical,
  PauseCircle,
  Phone,
  PlayCircle,
  RotateCcw,
  Star,
  Tags,
  TrendingUp,
  UserRound,
} from "lucide-react";
import type { TicketDetail } from "@/server/support/queries";
import { assumeTicketAction, closeTicketAction, resumeTicketAction } from "@/server/support/actions";
import { TICKET_QUEUE_LABELS, type TicketQueue } from "@/server/support/schemas";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { ConfirmDialog } from "@/components/ui/confirm-dialog";
import { Dialog, DialogBody, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuLabel, DropdownMenuSeparator, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import { toast } from "@/components/ui/toast";
import { cn } from "@/lib/utils";
import { ArticleEditor, articleDraftFromTicket } from "./article-editor";
import { ConversationThread } from "./conversation-thread";
import { LiveSlaBadge } from "./sla-live";
import { OpportunityDialog, ReopenDialog, ResolveDialog, TransferDialog, WaitingDialog } from "./ticket-actions";
import { TicketPriorityBadge, TicketStatusBadge } from "./ticket-badges";
import { TicketComposer, type ChannelStatus } from "./ticket-composer";
import { TicketClassification } from "./ticket-side-panels";
import { contactTarget, telHref } from "./workspace-model";

type DialogKey = "transferir" | "resolver" | "aguardar" | "reabrir" | "oportunidade" | "classificar" | "fechar" | "artigo" | null;

export type WorkspaceTab = "conversa" | "detalhes";

export interface WorkspaceTicketProps {
  detail: TicketDetail;
  channels: ChannelStatus;
  currentUserId: string;
  canOperate: boolean;
  canWriteArticles: boolean;
  articleCategories: string[];
  articleModules: string[];
  /** Volta para a fila (celular). */
  backHref: string;
  tab: WorkspaceTab;
  onTabChange: (tab: WorkspaceTab) => void;
  className?: string;
}

/**
 * Centro do workspace: cabeçalho do chamado com ações (Transferir, Encerrar atendimento, menu), conversa
 * completa e composer. No celular e em telas médias alterna entre Conversa e Detalhes.
 */
export function WorkspaceTicket({ detail, channels, currentUserId, canOperate, canWriteArticles, articleCategories, articleModules, backHref, tab, onTabChange, className }: WorkspaceTicketProps) {
  const router = useRouter();
  const { ticket, row } = detail;
  const [dialog, setDialog] = React.useState<DialogKey>(null);
  const [pending, startTransition] = React.useTransition();
  const threadRef = React.useRef<HTMLDivElement>(null);
  const isOpen = row.open;
  const closedOrResolved = ticket.status === "resolvido" || ticket.status === "fechado";
  const assignee = ticket.assigneeId ? detail.users[ticket.assigneeId] : undefined;
  const tel = telHref(contactTarget(detail).phone);

  // Conversa sempre aberta no fim (última mensagem) ao trocar de chamado ou receber interação nova.
  const lastInteraction = detail.interactions[detail.interactions.length - 1]?.id;
  React.useEffect(() => {
    const el = threadRef.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [ticket.id, lastInteraction, tab]);

  const run = (fn: () => Promise<{ ok: true } | { ok: false; error: string }>, success: string) =>
    startTransition(async () => {
      const result = await fn();
      if (!result.ok) return void toast.error(result.error);
      toast.success(success);
      router.refresh();
    });

  const open = (key: DialogKey) => () => setDialog(key);
  const dialogProps = (key: Exclude<DialogKey, null>) => ({ open: dialog === key, onOpenChange: (o: boolean) => setDialog(o ? key : null) });

  return (
    <section className={cn("flex min-h-0 flex-col rounded-xl border border-border bg-surface shadow-card", className)} aria-label={`Chamado ${ticket.number}`}>
      <header className="flex flex-col gap-3 border-b border-border px-4 py-3.5 md:px-5">
        <div className="flex items-center gap-2">
          <Link href={backHref} scroll={false} className="-ml-1 inline-flex size-9 shrink-0 items-center justify-center rounded-lg text-muted hover:bg-surface-hover hover:text-foreground lg:hidden" aria-label="Voltar para a fila">
            <ArrowLeft className="size-5" />
          </Link>
          <p className="min-w-0 flex-1 truncate font-mono text-lg font-semibold tracking-wide text-foreground md:text-xl">#{ticket.number}</p>
          {canOperate ? (
            <div className="flex shrink-0 items-center gap-2">
              {isOpen ? (
                <>
                  <Button variant="outline" size="sm" className="hidden md:inline-flex" onClick={open("transferir")}>
                    <ArrowRightLeft /> Transferir
                  </Button>
                  <Button size="sm" className="hidden md:inline-flex" onClick={open("resolver")}>
                    <CircleStop /> Encerrar<span className="hidden 2xl:inline"> atendimento</span>
                  </Button>
                </>
              ) : null}
              <DropdownMenu>
                <DropdownMenuTrigger asChild>
                  <Button variant="ghost" size="icon" aria-label="Mais ações do chamado" className="size-9">
                    <MoreVertical />
                  </Button>
                </DropdownMenuTrigger>
                <DropdownMenuContent align="end" className="w-60">
                  <DropdownMenuLabel>Chamado {ticket.number}</DropdownMenuLabel>
                  {isOpen && ticket.assigneeId !== currentUserId ? (
                    <DropdownMenuItem disabled={pending} onSelect={() => run(() => assumeTicketAction({ ticketId: ticket.id }), "Chamado assumido")}>
                      <Hand /> Assumir chamado
                    </DropdownMenuItem>
                  ) : null}
                  {isOpen ? (
                    <DropdownMenuItem className="md:hidden" onSelect={open("transferir")}>
                      <ArrowRightLeft /> Transferir
                    </DropdownMenuItem>
                  ) : null}
                  {ticket.status === "em_atendimento" || ticket.status === "aberto" || ticket.status === "reaberto" ? (
                    <DropdownMenuItem onSelect={open("aguardar")}>
                      <PauseCircle /> Aguardar cliente (pausar SLA)
                    </DropdownMenuItem>
                  ) : null}
                  {ticket.status === "aguardando_cliente" ? (
                    <DropdownMenuItem disabled={pending} onSelect={() => run(() => resumeTicketAction({ ticketId: ticket.id }), "Atendimento retomado · SLA voltou a contar")}>
                      <PlayCircle /> Retomar atendimento
                    </DropdownMenuItem>
                  ) : null}
                  <DropdownMenuItem onSelect={open("classificar")}>
                    <Tags /> Classificar
                  </DropdownMenuItem>
                  {closedOrResolved ? (
                    <DropdownMenuItem onSelect={open("reabrir")}>
                      <RotateCcw /> Reabrir (reincidência)
                    </DropdownMenuItem>
                  ) : null}
                  {ticket.status === "resolvido" ? (
                    <DropdownMenuItem onSelect={open("fechar")}>
                      <Lock /> Fechar chamado
                    </DropdownMenuItem>
                  ) : null}
                  <DropdownMenuSeparator />
                  {!detail.opportunity ? (
                    <DropdownMenuItem onSelect={open("oportunidade")}>
                      <TrendingUp /> Gerar oportunidade
                    </DropdownMenuItem>
                  ) : (
                    <DropdownMenuItem asChild>
                      <Link href={`/vendas/oportunidades?oportunidade=${detail.opportunity.id}`}>
                        <TrendingUp /> Ver oportunidade gerada
                      </Link>
                    </DropdownMenuItem>
                  )}
                  {canWriteArticles ? (
                    <DropdownMenuItem onSelect={open("artigo")}>
                      <BookPlus /> Criar artigo da base
                    </DropdownMenuItem>
                  ) : null}
                  {closedOrResolved && detail.csatLink && ticket.csatScore === undefined ? (
                    <DropdownMenuItem asChild>
                      <a href={detail.csatLink} target="_blank" rel="noreferrer">
                        <Star /> Link de avaliação do cliente
                      </a>
                    </DropdownMenuItem>
                  ) : null}
                  <DropdownMenuSeparator />
                  <DropdownMenuItem asChild>
                    <Link href={`/suporte/chamados/${ticket.id}`}>
                      <ExternalLink /> Abrir página do chamado
                    </Link>
                  </DropdownMenuItem>
                </DropdownMenuContent>
              </DropdownMenu>
            </div>
          ) : null}
        </div>
        <h2 className="-mt-1.5 text-base font-semibold leading-snug text-foreground md:text-lg">{ticket.subject}</h2>
        <div className="flex flex-wrap items-center gap-2 text-[13px]">
          <TicketPriorityBadge priority={ticket.priority} size="md" />
          <TicketStatusBadge status={ticket.status} size="md" />
          <span className="lg:hidden">
            <LiveSlaBadge sla={row.sla} size="md" timeOnly />
          </span>
          <Badge variant="outline" size="md" className="font-mono uppercase" title={TICKET_QUEUE_LABELS[ticket.queue as TicketQueue]}>
            {ticket.queue}
          </Badge>
          <span className="inline-flex items-center gap-1.5 text-muted">
            <UserRound className="size-3.5" aria-hidden />
            Atribuído a: <span className="font-medium text-foreground">{assignee?.name ?? "ninguém (na fila)"}</span>
          </span>
          {detail.reopenedFrom ? (
            <Link href={`/suporte?chamado=${detail.reopenedFrom.id}`} className="inline-flex items-center gap-1 text-xs text-danger-fg hover:underline">
              <RotateCcw className="size-3" /> reabertura de {detail.reopenedFrom.number}
            </Link>
          ) : null}
        </div>
        {ticket.solution ? (
          <p className="rounded-lg border border-success/30 bg-success-soft px-3 py-2 text-xs text-foreground">
            <span className="font-semibold text-success-fg">Solução: </span>
            {ticket.solution}
            {ticket.csatScore !== undefined ? <span className="ml-1 text-muted">· CSAT {ticket.csatScore}</span> : null}
          </p>
        ) : null}
      </header>

      <div role="tablist" aria-label="Seções do chamado" className="flex shrink-0 gap-1 border-b border-border px-4 xl:hidden">
        {(["conversa", "detalhes"] as const).map((t) => (
          <button
            key={t}
            type="button"
            role="tab"
            aria-selected={tab === t}
            onClick={() => onTabChange(t)}
            className={cn("-mb-px min-h-[44px] border-b-2 px-3 text-sm font-medium transition-colors", tab === t ? "border-brand text-brand-fg" : "border-transparent text-muted hover:text-foreground")}
          >
            {t === "conversa" ? "Conversa" : "Detalhes"}
          </button>
        ))}
      </div>

      <div className={cn("min-h-0 flex-1 flex-col", tab === "conversa" ? "flex" : "hidden xl:flex")}>
        <div ref={threadRef} className="scrollbar-thin min-h-0 flex-1 overflow-y-auto px-4 py-4 md:px-5">
          <ConversationThread detail={detail} />
        </div>
        {canOperate ? (
          <div className="sticky bottom-[calc(var(--spacing-mobile-nav)+env(safe-area-inset-bottom)+8px)] z-10 border-t border-border bg-surface px-3 pb-3 pt-3 md:bottom-0 md:px-4 lg:static">
            <TicketComposer detail={detail} channels={channels} onSent={() => threadRef.current?.scrollTo({ top: threadRef.current.scrollHeight, behavior: "smooth" })} />
            {isOpen ? (
              <div className="mt-2 grid grid-cols-2 gap-2 lg:hidden">
                {tel ? (
                  <Button asChild className="min-h-[44px] bg-info text-white shadow-none hover:bg-info-hover">
                    <a href={tel} title={channels.voip ? "Ligar pelo VoIP" : "VoIP não conectado: abre o discador do celular"}>
                      <Phone /> Ligar (VoIP)
                    </a>
                  </Button>
                ) : null}
                <Button className="min-h-[44px]" onClick={open("resolver")}>
                  Resolver chamado
                </Button>
              </div>
            ) : null}
          </div>
        ) : null}
      </div>

      <TransferDialog {...dialogProps("transferir")} detail={detail} />
      <ResolveDialog {...dialogProps("resolver")} detail={detail} />
      <WaitingDialog {...dialogProps("aguardar")} ticketId={ticket.id} />
      <ReopenDialog {...dialogProps("reabrir")} detail={detail} />
      <OpportunityDialog {...dialogProps("oportunidade")} detail={detail} />
      <Dialog {...dialogProps("classificar")}>
        <DialogContent size="sm">
          <DialogHeader>
            <DialogTitle>Classificar chamado</DialogTitle>
            <DialogDescription>Criticidade (recalcula o SLA), fila, produto e categoria.</DialogDescription>
          </DialogHeader>
          <DialogBody className="py-2">
            <TicketClassification key={ticket.updatedAt} detail={detail} canOperate={canOperate} bare onSaved={() => setDialog(null)} />
          </DialogBody>
        </DialogContent>
      </Dialog>
      <ConfirmDialog
        {...dialogProps("fechar")}
        title={`Fechar o chamado ${ticket.number}?`}
        description="Normalmente o chamado fecha sozinho quando o cliente avalia. Feche manualmente se o cliente confirmou a solução por outro canal."
        confirmLabel="Fechar chamado"
        onConfirm={async () => {
          const result = await closeTicketAction({ ticketId: ticket.id });
          if (!result.ok) return void toast.error(result.error);
          toast.success("Chamado fechado");
          router.refresh();
        }}
      />
      {/* Montado só ao abrir: o rascunho sempre reflete o chamado atual (inclusive a solução recém-registrada). */}
      {canWriteArticles && dialog === "artigo" ? (
        <ArticleEditor
          {...dialogProps("artigo")}
          products={detail.catalog}
          categories={articleCategories}
          modules={articleModules}
          sourceTicketId={ticket.id}
          initial={articleDraftFromTicket(detail)}
        />
      ) : null}
    </section>
  );
}
