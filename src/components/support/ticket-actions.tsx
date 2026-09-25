"use client";

import * as React from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { BookPlus, CheckCircle2, ExternalLink, Hand, Lock, PauseCircle, PlayCircle, RotateCcw, Star, TrendingUp, UserRoundCog } from "lucide-react";
import type { TicketDetail } from "@/server/support/queries";
import type { ResolveResult } from "@/server/support/service";
import {
  assumeTicketAction,
  closeTicketAction,
  createTicketOpportunityAction,
  reopenTicketAction,
  resolveTicketAction,
  resumeTicketAction,
  transferTicketAction,
  waitingClientAction,
} from "@/server/support/actions";
import { ROOT_CAUSES, ROOT_CAUSE_LABELS, TICKET_QUEUES, TICKET_QUEUE_LABELS, type RootCause, type TicketQueue } from "@/server/support/schemas";
import { PRODUCT_CATEGORY_LABELS } from "@/domain/constants";
import { formatCurrency, formatDateTime } from "@/lib/format";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { ConfirmDialog } from "@/components/ui/confirm-dialog";
import { Dialog, DialogBody, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { FormField } from "@/components/ui/form-field";
import { Input } from "@/components/ui/input";
import { SegmentedControl } from "@/components/ui/segmented-control";
import { Select } from "@/components/ui/select";
import { Switch } from "@/components/ui/switch";
import { Textarea } from "@/components/ui/textarea";
import { toast } from "@/components/ui/toast";
import { ArticleEditor, articleDraftFromTicket } from "./article-editor";
import { LiveSlaBadge, responseDueLabel, useMinuteClock } from "./sla-live";
import { TicketStatusBadge } from "./ticket-badges";
import { contactTarget, mailtoHref, whatsappTextHref } from "./workspace-model";

type DialogKey = "aguardar" | "resolver" | "fechar" | "reabrir" | "oportunidade" | "transferir" | null;

export interface TicketActionsProps {
  detail: TicketDetail;
  currentUserId: string;
  canOperate: boolean;
  canWriteArticles: boolean;
  articleCategories: string[];
  articleModules?: string[];
}

/** Painel de status do chamado: SLA ao vivo, transições (com diálogos), transferência e atalhos. */
export function TicketActions({ detail, currentUserId, canOperate, canWriteArticles, articleCategories, articleModules = [] }: TicketActionsProps) {
  const router = useRouter();
  const { ticket, row } = detail;
  const now = useMinuteClock();
  const [dialog, setDialog] = React.useState<DialogKey>(null);
  const [pending, startTransition] = React.useTransition();
  const isOpen = row.open;
  const resolved = ticket.status === "resolvido";
  const closedOrResolved = ticket.status === "resolvido" || ticket.status === "fechado";
  const response = now === null ? null : responseDueLabel(row.sla, ticket.firstResponseAt, now);

  const run = (fn: () => Promise<{ ok: true } | { ok: false; error: string }>, success: string, after?: () => void) =>
    startTransition(async () => {
      const result = await fn();
      if (!result.ok) {
        toast.error(result.error);
        return;
      }
      toast.success(success);
      after?.();
      router.refresh();
    });

  return (
    <Card>
      <CardContent className="flex flex-col gap-4 py-4">
        <div className="flex flex-wrap items-center gap-2">
          <TicketStatusBadge status={ticket.status} size="md" />
          <LiveSlaBadge sla={row.sla} size="md" />
          {response ? (
            <Badge variant={response.tone} size="sm">
              {response.label}
            </Badge>
          ) : null}
        </div>
        {row.sla ? (
          <dl className="grid grid-cols-2 gap-x-3 gap-y-1 text-xs">
            <dt className="text-muted">Regra</dt>
            <dd className="text-right">{row.sla.ruleName}</dd>
            {row.sla.responseDueAt ? (
              <>
                <dt className="text-muted">1ª resposta até</dt>
                <dd className="text-right tabular-nums">{formatDateTime(row.sla.responseDueAt)}</dd>
              </>
            ) : null}
            <dt className="text-muted">Solução até</dt>
            <dd className="text-right tabular-nums">{formatDateTime(row.sla.dueAt)}</dd>
            {row.sla.status === "pausado" && row.sla.pauseReason ? (
              <>
                <dt className="text-muted">Pausado</dt>
                <dd className="text-right">{row.sla.pauseReason}</dd>
              </>
            ) : null}
          </dl>
        ) : null}

        {canOperate ? (
          <div className="flex flex-col gap-2">
            {isOpen && ticket.assigneeId !== currentUserId ? (
              <Button className="min-h-[44px] md:min-h-9" loading={pending} onClick={() => run(() => assumeTicketAction({ ticketId: ticket.id }), "Chamado assumido")}>
                <Hand /> Assumir chamado
              </Button>
            ) : null}
            {isOpen ? (
              <Button variant={ticket.assigneeId === currentUserId ? "primary" : "outline"} className="min-h-[44px] md:min-h-9" onClick={() => setDialog("resolver")}>
                <CheckCircle2 /> Resolver
              </Button>
            ) : null}
            {ticket.status === "em_atendimento" || ticket.status === "aberto" || ticket.status === "reaberto" ? (
              <Button variant="outline" className="min-h-[44px] md:min-h-9" onClick={() => setDialog("aguardar")}>
                <PauseCircle /> Aguardar cliente
              </Button>
            ) : null}
            {ticket.status === "aguardando_cliente" ? (
              <Button variant="outline" className="min-h-[44px] md:min-h-9" loading={pending} onClick={() => run(() => resumeTicketAction({ ticketId: ticket.id }), "Atendimento retomado · SLA voltou a contar")}>
                <PlayCircle /> Retomar atendimento
              </Button>
            ) : null}
            {resolved ? (
              <Button variant="outline" className="min-h-[44px] md:min-h-9" onClick={() => setDialog("fechar")}>
                <Lock /> Fechar chamado
              </Button>
            ) : null}
            {closedOrResolved && detail.csatLink && ticket.csatScore === undefined ? (
              <Button variant="outline" asChild className="min-h-[44px] md:min-h-9">
                <a href={detail.csatLink} target="_blank" rel="noreferrer">
                  <Star /> Formulário de avaliação (link do cliente) <ExternalLink className="ml-auto" />
                </a>
              </Button>
            ) : null}
            {!detail.opportunity ? (
              <Button variant="outline" className="min-h-[44px] md:min-h-9" onClick={() => setDialog("oportunidade")}>
                <TrendingUp /> Gerar oportunidade
              </Button>
            ) : null}
            {closedOrResolved && canWriteArticles ? (
              <ArticleEditor
                products={detail.catalog}
                categories={articleCategories}
                modules={articleModules}
                sourceTicketId={ticket.id}
                initial={articleDraftFromTicket(detail)}
                trigger={
                  <Button variant="outline" className="min-h-[44px] md:min-h-9">
                    <BookPlus /> Criar artigo a partir deste chamado
                  </Button>
                }
              />
            ) : null}
          </div>
        ) : null}
        {closedOrResolved ? (
          <Button variant="ghost" className="min-h-[44px] md:min-h-9" onClick={() => setDialog("reabrir")}>
            <RotateCcw /> Reabrir (reincidência)
          </Button>
        ) : null}

        {canOperate && isOpen ? (
          <Button variant="outline" className="min-h-[44px] md:min-h-9" onClick={() => setDialog("transferir")}>
            <UserRoundCog /> Transferir
          </Button>
        ) : null}
      </CardContent>

      <TransferDialog open={dialog === "transferir"} onOpenChange={(o) => setDialog(o ? "transferir" : null)} detail={detail} />
      <WaitingDialog open={dialog === "aguardar"} onOpenChange={(o) => setDialog(o ? "aguardar" : null)} ticketId={ticket.id} />
      <ResolveDialog open={dialog === "resolver"} onOpenChange={(o) => setDialog(o ? "resolver" : null)} detail={detail} />
      <ReopenDialog open={dialog === "reabrir"} onOpenChange={(o) => setDialog(o ? "reabrir" : null)} detail={detail} />
      <OpportunityDialog open={dialog === "oportunidade"} onOpenChange={(o) => setDialog(o ? "oportunidade" : null)} detail={detail} />
      <ConfirmDialog
        open={dialog === "fechar"}
        onOpenChange={(o) => setDialog(o ? "fechar" : null)}
        title={`Fechar o chamado ${ticket.number}?`}
        description="Normalmente o chamado fecha sozinho quando o cliente avalia. Feche manualmente se o cliente confirmou a solução por outro canal."
        confirmLabel="Fechar chamado"
        onConfirm={async () => {
          const result = await closeTicketAction({ ticketId: ticket.id });
          if (!result.ok) {
            toast.error(result.error);
            return;
          }
          toast.success("Chamado fechado");
          router.refresh();
        }}
      />
    </Card>
  );
}

// ---------------------------------------------------------------------------
// Diálogos
// ---------------------------------------------------------------------------

function useSubmit(onDone: () => void) {
  const router = useRouter();
  const [pending, startTransition] = React.useTransition();
  const submit = (fn: () => Promise<{ ok: true } | { ok: false; error: string }>, success: string | ((data: unknown) => string), after?: (data: unknown) => void) =>
    startTransition(async () => {
      const result = await fn();
      if (!result.ok) {
        toast.error(result.error);
        return;
      }
      const data = (result as { ok: true; data?: unknown }).data;
      toast.success(typeof success === "function" ? success(data) : success);
      onDone();
      if (after) after(data);
      else router.refresh();
    });
  return { pending, submit };
}

export function WaitingDialog({ open, onOpenChange, ticketId }: { open: boolean; onOpenChange: (open: boolean) => void; ticketId: string }) {
  const [reason, setReason] = React.useState("");
  const { pending, submit } = useSubmit(() => {
    onOpenChange(false);
    setReason("");
  });
  const id = React.useId();
  return (
    <Dialog open={open} onOpenChange={(o) => !pending && onOpenChange(o)}>
      <DialogContent size="sm">
        <DialogHeader>
          <DialogTitle>Aguardar o cliente</DialogTitle>
          <DialogDescription>O SLA fica pausado até o atendimento ser retomado. A pausa fica registrada com o motivo.</DialogDescription>
        </DialogHeader>
        <form
          className="contents"
          onSubmit={(e) => {
            e.preventDefault();
            submit(() => waitingClientAction({ ticketId, reason }), "Chamado aguardando o cliente · SLA pausado");
          }}
        >
          <DialogBody className="py-2">
            <FormField label="Motivo da pausa" htmlFor={`${id}-reason`} required>
              <Textarea id={`${id}-reason`} value={reason} onChange={(e) => setReason(e.target.value)} placeholder="Ex.: aguardando o cliente liberar acesso remoto ao servidor" className="min-h-[72px]" required minLength={3} />
            </FormField>
          </DialogBody>
          <DialogFooter>
            <Button type="button" variant="outline" onClick={() => onOpenChange(false)} disabled={pending}>
              Cancelar
            </Button>
            <Button type="submit" loading={pending} disabled={reason.trim().length < 3}>
              <PauseCircle /> Pausar SLA
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

/**
 * Sem integração conectada o pedido de CSAT não sai do sistema: o atendente recebe um aviso com o atalho para
 * enviar a mensagem com o link pelo WhatsApp/e-mail (ou copiar o link).
 */
function announceManualCsat(r: ResolveResult, detail: TicketDetail) {
  const link = `${window.location.origin}${r.csatLink}`;
  const text = `${r.csatMessage} ${link}`;
  const target = contactTarget(detail);
  const href = r.csatChannel === "whatsapp" ? whatsappTextHref(r.csatTo ?? target.whatsapp, text) : mailtoHref(r.csatTo ?? target.email, `Avalie o atendimento — chamado ${detail.ticket.number}`, text);
  toast.info(`Pedido de avaliação não enviado: ${r.csatChannel === "whatsapp" ? "WhatsApp" : "e-mail"} não conectado.`, {
    description: "Envie o link de avaliação ao cliente pelo app.",
    duration: 20_000,
    action: href
      ? { label: r.csatChannel === "whatsapp" ? "Abrir WhatsApp" : "Abrir e-mail", onClick: () => window.open(href, "_blank", "noopener") }
      : { label: "Copiar link", onClick: () => void navigator.clipboard?.writeText(link) },
  });
}

export function ResolveDialog({ open, onOpenChange, detail }: { open: boolean; onOpenChange: (open: boolean) => void; detail: TicketDetail }) {
  const router = useRouter();
  const [solution, setSolution] = React.useState("");
  const [rootCause, setRootCause] = React.useState<RootCause | "">("");
  const [trainingRelated, setTrainingRelated] = React.useState(false);
  const [confirmation, setConfirmation] = React.useState<"sim" | "pendente">("pendente");
  const { pending, submit } = useSubmit(() => onOpenChange(false));
  const id = React.useId();
  return (
    <Dialog open={open} onOpenChange={(o) => !pending && onOpenChange(o)}>
      <DialogContent size="md">
        <DialogHeader>
          <DialogTitle>Resolver chamado {detail.ticket.number}</DialogTitle>
          <DialogDescription>Conclui o SLA, registra a solução na conversa e gera o pedido de avaliação (CSAT) para o cliente.</DialogDescription>
        </DialogHeader>
        <form
          className="contents"
          onSubmit={(e) => {
            e.preventDefault();
            submit(
              () => resolveTicketAction({ ticketId: detail.ticket.id, solution, rootCause, trainingRelated, customerConfirmation: confirmation }),
              (data) => ((data as ResolveResult).csatSent ? "Chamado resolvido · pedido de avaliação enviado" : "Chamado resolvido"),
              (data) => {
                const r = data as ResolveResult;
                if (!r.csatSent) announceManualCsat(r, detail);
                router.refresh();
              },
            );
          }}
        >
          <DialogBody className="flex flex-col gap-4 py-2">
            <FormField label="Solução aplicada" htmlFor={`${id}-solution`} required hint="Fica visível para o cliente e alimenta a base de conhecimento.">
              <Textarea id={`${id}-solution`} value={solution} onChange={(e) => setSolution(e.target.value)} className="min-h-[110px]" required minLength={10} placeholder="O que foi feito para resolver" />
            </FormField>
            <FormField label="Causa raiz" htmlFor={`${id}-cause`} required>
              <Select id={`${id}-cause`} value={rootCause} onChange={(e) => setRootCause(e.target.value as RootCause)} placeholder="Selecione" required options={ROOT_CAUSES.map((c) => ({ value: c, label: ROOT_CAUSE_LABELS[c] }))} />
            </FormField>
            <Switch label="Relacionado a treinamento?" description="Marque quando o cliente não sabia usar o recurso (indicador de qualidade da implantação)." checked={trainingRelated} onCheckedChange={setTrainingRelated} />
            <div className="flex flex-col gap-1.5">
              <span className="text-[13px] font-medium">
                O cliente confirmou a solução? <span className="text-danger">*</span>
              </span>
              <SegmentedControl
                aria-label="Confirmação do cliente"
                value={confirmation}
                onChange={setConfirmation}
                options={[
                  { value: "sim", label: "Sim, confirmou" },
                  { value: "pendente", label: "Pendente" },
                ]}
              />
            </div>
          </DialogBody>
          <DialogFooter>
            <Button type="button" variant="outline" onClick={() => onOpenChange(false)} disabled={pending}>
              Cancelar
            </Button>
            <Button type="submit" loading={pending} disabled={solution.trim().length < 10 || !rootCause}>
              <CheckCircle2 /> Resolver
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

export function ReopenDialog({ open, onOpenChange, detail }: { open: boolean; onOpenChange: (open: boolean) => void; detail: TicketDetail }) {
  const router = useRouter();
  const [reason, setReason] = React.useState("");
  const { pending, submit } = useSubmit(() => {
    onOpenChange(false);
    setReason("");
  });
  const id = React.useId();
  return (
    <Dialog open={open} onOpenChange={(o) => !pending && onOpenChange(o)}>
      <DialogContent size="sm">
        <DialogHeader>
          <DialogTitle>Reabrir chamado</DialogTitle>
          <DialogDescription>Cria um novo chamado ligado a {detail.ticket.number}, com SLA novo. Conta como reincidência (meta ≤ 10%).</DialogDescription>
        </DialogHeader>
        <form
          className="contents"
          onSubmit={(e) => {
            e.preventDefault();
            submit(
              () => reopenTicketAction({ ticketId: detail.ticket.id, reason }),
              (data) => `Chamado reaberto como ${(data as { number: string }).number}`,
              (data) => router.push(`/suporte/chamados/${(data as { id: string }).id}`),
            );
          }}
        >
          <DialogBody className="py-2">
            <FormField label="Motivo da reabertura" htmlFor={`${id}-reason`} required>
              <Textarea id={`${id}-reason`} value={reason} onChange={(e) => setReason(e.target.value)} placeholder="Ex.: o erro voltou a acontecer após a atualização" className="min-h-[88px]" required minLength={5} />
            </FormField>
          </DialogBody>
          <DialogFooter>
            <Button type="button" variant="outline" onClick={() => onOpenChange(false)} disabled={pending}>
              Cancelar
            </Button>
            <Button type="submit" variant="destructive" loading={pending} disabled={reason.trim().length < 5}>
              <RotateCcw /> Reabrir
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

export function OpportunityDialog({ open, onOpenChange, detail }: { open: boolean; onOpenChange: (open: boolean) => void; detail: TicketDetail }) {
  const router = useRouter();
  const products = detail.availableProducts;
  const [productId, setProductId] = React.useState(products[0]?.id ?? "");
  const [need, setNeed] = React.useState("");
  const [notes, setNotes] = React.useState("");
  const { pending, submit } = useSubmit(() => onOpenChange(false));
  const id = React.useId();
  const product = products.find((p) => p.id === productId);
  return (
    <Dialog open={open} onOpenChange={(o) => !pending && onOpenChange(o)}>
      <DialogContent size="md">
        <DialogHeader>
          <DialogTitle>Gerar oportunidade</DialogTitle>
          <DialogDescription>
            Registra no CRM uma oportunidade para o vendedor de {detail.client?.tradeName ?? "cliente"}, com o atendente como origem (recompensa por oportunidade válida gerada pelo suporte).
          </DialogDescription>
        </DialogHeader>
        <form
          className="contents"
          onSubmit={(e) => {
            e.preventDefault();
            submit(
              () => createTicketOpportunityAction({ ticketId: detail.ticket.id, productId, need, notes: notes || undefined }),
              "Oportunidade criada e enviada ao vendedor",
              () => router.refresh(),
            );
          }}
        >
          <DialogBody className="flex flex-col gap-4 py-2">
            {products.length === 0 ? (
              <p className="rounded-md bg-surface-muted p-3 text-sm text-muted">O cliente já tem todos os produtos ativos do catálogo.</p>
            ) : (
              <>
                <FormField label="Produto" htmlFor={`${id}-product`} required hint="Só aparecem produtos que o cliente ainda não tem.">
                  <Select id={`${id}-product`} value={productId} onChange={(e) => setProductId(e.target.value)} required>
                    {products.map((p) => (
                      <option key={p.id} value={p.id}>
                        {p.name} · {PRODUCT_CATEGORY_LABELS[p.category]}
                      </option>
                    ))}
                  </Select>
                </FormField>
                {product ? (
                  <p className="text-xs text-muted">
                    Referência de preço: {product.monthlyPrice > 0 ? `${formatCurrency(product.monthlyPrice)}/mês` : "sem mensalidade"}
                    {product.setupPrice > 0 ? ` · adesão ${formatCurrency(product.setupPrice)}` : ""}
                  </p>
                ) : null}
                <FormField label="Necessidade identificada" htmlFor={`${id}-need`} required>
                  <Textarea id={`${id}-need`} value={need} onChange={(e) => setNeed(e.target.value)} required minLength={3} className="min-h-[80px]" placeholder="Ex.: cliente perde vendas por não aceitar cartão no balcão" />
                </FormField>
                <FormField label="Observação para o vendedor" htmlFor={`${id}-notes`}>
                  <Input id={`${id}-notes`} value={notes} onChange={(e) => setNotes(e.target.value)} placeholder="Opcional" />
                </FormField>
              </>
            )}
          </DialogBody>
          <DialogFooter>
            <Button type="button" variant="outline" onClick={() => onOpenChange(false)} disabled={pending}>
              Cancelar
            </Button>
            <Button type="submit" loading={pending} disabled={!productId || need.trim().length < 3}>
              <TrendingUp /> Criar oportunidade
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

export function OpportunityLink({ detail }: { detail: TicketDetail }) {
  if (!detail.opportunity) return null;
  const origin = detail.opportunity.originUserId ? detail.users[detail.opportunity.originUserId]?.name : undefined;
  return (
    <Link href={`/vendas/oportunidades?oportunidade=${detail.opportunity.id}`} className="flex items-start gap-2 rounded-lg border border-success/30 bg-success-soft/50 p-3 text-sm hover:border-success/60">
      <TrendingUp className="mt-0.5 size-4 shrink-0 text-success-fg" />
      <span className="min-w-0">
        <span className="block font-medium">{detail.opportunity.title}</span>
        <span className="text-xs text-muted">Oportunidade gerada pelo suporte{origin ? ` · origem: ${origin}` : ""}</span>
      </span>
    </Link>
  );
}

/** Transferência para outro atendente e/ou fila, com nota obrigatória (vira interação de status e notifica). */
export function TransferDialog({ open, onOpenChange, detail }: { open: boolean; onOpenChange: (open: boolean) => void; detail: TicketDetail }) {
  const { ticket } = detail;
  const [assigneeId, setAssigneeId] = React.useState("");
  const [queue, setQueue] = React.useState<TicketQueue>((ticket.queue as TicketQueue) ?? "n1");
  const [note, setNote] = React.useState("");
  const { pending, submit } = useSubmit(() => {
    onOpenChange(false);
    setAssigneeId("");
    setNote("");
  });
  const id = React.useId();
  const changed = Boolean(assigneeId) || queue !== ticket.queue;
  const current = ticket.assigneeId ? detail.users[ticket.assigneeId]?.name : undefined;
  return (
    <Dialog open={open} onOpenChange={(o) => !pending && onOpenChange(o)}>
      <DialogContent size="sm">
        <DialogHeader>
          <DialogTitle>Transferir chamado {ticket.number}</DialogTitle>
          <DialogDescription>
            Hoje com {current ?? "ninguém (na fila)"} · fila {(TICKET_QUEUE_LABELS[ticket.queue as TicketQueue] ?? ticket.queue).split(" ")[0]}. Quem recebe é notificado e a transferência fica registrada na conversa.
          </DialogDescription>
        </DialogHeader>
        <form
          className="contents"
          onSubmit={(e) => {
            e.preventDefault();
            submit(() => transferTicketAction({ ticketId: ticket.id, assigneeId: assigneeId || undefined, queue, note }), "Chamado transferido");
          }}
        >
          <DialogBody className="flex flex-col gap-4 py-2">
            <FormField label="Atendente" htmlFor={`${id}-to`} hint="Deixe em branco para devolver à fila escolhida, sem atendente.">
              <Select id={`${id}-to`} value={assigneeId} onChange={(e) => setAssigneeId(e.target.value)} placeholder="Somente trocar a fila">
                {detail.team
                  .filter((u) => u.id !== ticket.assigneeId)
                  .map((u) => (
                    <option key={u.id} value={u.id}>
                      {u.name}
                      {u.jobTitle ? ` · ${u.jobTitle}` : ""}
                    </option>
                  ))}
              </Select>
            </FormField>
            <FormField label="Fila" htmlFor={`${id}-queue`}>
              <Select id={`${id}-queue`} value={queue} onChange={(e) => setQueue(e.target.value as TicketQueue)} options={TICKET_QUEUES.map((q) => ({ value: q, label: TICKET_QUEUE_LABELS[q] }))} />
            </FormField>
            <FormField label="Nota da transferência" htmlFor={`${id}-note`} required>
              <Textarea id={`${id}-note`} value={note} onChange={(e) => setNote(e.target.value)} placeholder="Ex.: precisa de acesso ao servidor fiscal; cliente já reiniciou o TEF" className="min-h-[80px]" required minLength={3} />
            </FormField>
          </DialogBody>
          <DialogFooter>
            <Button type="button" variant="outline" onClick={() => onOpenChange(false)} disabled={pending}>
              Cancelar
            </Button>
            <Button type="submit" loading={pending} disabled={!changed || note.trim().length < 3}>
              <UserRoundCog /> Transferir
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
