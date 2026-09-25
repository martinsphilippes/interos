"use client";

import * as React from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { AlertTriangle, BookOpen, Building2, FileSignature, Paperclip, Plus, Repeat, Save } from "lucide-react";
import type { TicketDetail } from "@/server/support/queries";
import { addAttachmentAction, classifyTicketAction } from "@/server/support/actions";
import { TICKET_PRIORITIES, TICKET_PRIORITY_DEFINITIONS, TICKET_PRIORITY_LABELS, TICKET_QUEUES, TICKET_QUEUE_LABELS, type TicketPriority, type TicketQueue } from "@/server/support/schemas";
import { formatCurrency, formatDate, formatPercent } from "@/lib/format";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { FormField } from "@/components/ui/form-field";
import { Input } from "@/components/ui/input";
import { Select } from "@/components/ui/select";
import { toast } from "@/components/ui/toast";
import { TicketStatusBadge } from "./ticket-badges";
import { RelativeTime } from "@/components/ui/relative-time";

const PRODUCT_STATUS_LABELS: Record<string, string> = { ativo: "Ativo", em_implantacao: "Em implantação", suspenso: "Suspenso", cancelado: "Cancelado" };
const CONTRACT_STATUS_LABELS: Record<string, string> = {
  aguardando_contrato: "Aguardando contrato",
  aguardando_assinatura: "Aguardando assinatura",
  assinado: "Assinado",
  aguardando_pagamento: "Aguardando pagamento",
  pago: "Pago",
  pendencia: "Pendência",
  liberado: "Liberado",
  cancelado: "Cancelado",
};

/** Cliente: produtos contratados, contrato e histórico de chamados (reincidência e CSAT). */
export function TicketClientCard({ detail }: { detail: TicketDetail }) {
  const { client, contact, clientProducts, contract, previous, clientStats } = detail;
  if (!client) return null;
  return (
    <Card>
      <CardHeader className="pb-2">
        <CardTitle className="flex items-center gap-2 text-sm">
          <Building2 className="size-4 text-muted" /> Cliente
        </CardTitle>
      </CardHeader>
      <CardContent className="flex flex-col gap-4 pt-0">
        <div>
          <Link href={`/clientes/${client.id}?aba=suporte`} className="font-semibold hover:text-brand hover:underline">
            {client.tradeName}
          </Link>
          <p className="text-xs text-muted">{[client.address?.city, client.segment].filter(Boolean).join(" · ")}</p>
          {contact ? (
            <p className="mt-1 text-sm">
              {contact.name}
              {contact.role ? <span className="text-muted"> · {contact.role}</span> : null}
            </p>
          ) : null}
        </div>

        <div>
          <p className="label-caps mb-1.5">Produtos contratados</p>
          {clientProducts.length === 0 ? (
            <p className="text-sm text-muted">Nenhum produto registrado.</p>
          ) : (
            <ul className="flex flex-col gap-1">
              {clientProducts.map((p) => (
                <li key={p.id} className="flex items-center justify-between gap-2 text-sm">
                  <span className="truncate">{p.productName}</span>
                  <Badge variant={p.status === "ativo" ? "success" : p.status === "cancelado" ? "muted" : "warning"} size="sm">
                    {PRODUCT_STATUS_LABELS[p.status] ?? p.status}
                  </Badge>
                </li>
              ))}
            </ul>
          )}
        </div>

        {contract ? (
          <div className="flex items-start gap-2 text-sm">
            <FileSignature className="mt-0.5 size-4 shrink-0 text-muted" />
            <div>
              <Link href={`/financeiro/contratos?contrato=${contract.id}`} className="font-medium hover:underline">
                Contrato {contract.number}
              </Link>
              <p className="text-xs text-muted">
                {CONTRACT_STATUS_LABELS[contract.status] ?? contract.status}
                {contract.monthlyTotal ? ` · ${formatCurrency(contract.monthlyTotal)}/mês` : ""}
                {contract.endDate ? ` · até ${formatDate(contract.endDate)}` : ""}
              </p>
            </div>
          </div>
        ) : null}

        <div>
          <div className="mb-1.5 flex items-center justify-between">
            <p className="label-caps">Chamados do cliente</p>
            <span className="text-xs text-muted">{clientStats.total} no total</span>
          </div>
          <div className="mb-2 grid grid-cols-2 gap-2 text-center">
            <div className="rounded-md bg-surface-muted px-2 py-1.5">
              <p className={clientStats.reopenRate > 0.1 ? "font-semibold text-danger-fg" : "font-semibold"}>{formatPercent(clientStats.reopenRate)}</p>
              <p className="text-[11px] text-muted">reincidência ({clientStats.reopened})</p>
            </div>
            <div className="rounded-md bg-surface-muted px-2 py-1.5">
              <p className="font-semibold">{clientStats.csatAverage !== undefined ? clientStats.csatAverage.toFixed(1).replace(".", ",") : "—"}</p>
              <p className="text-[11px] text-muted">CSAT médio</p>
            </div>
          </div>
          {previous.length === 0 ? (
            <p className="text-sm text-muted">Primeiro chamado deste cliente.</p>
          ) : (
            <ul className="flex flex-col divide-y divide-border">
              {previous.slice(0, 6).map((t) => (
                <li key={t.id}>
                  <Link href={`/suporte/chamados/${t.id}`} className="flex min-h-[44px] items-center justify-between gap-2 py-1.5 text-sm hover:text-brand md:min-h-0">
                    <span className="min-w-0">
                      <span className="flex items-center gap-1 font-mono text-[11px] text-muted">
                        {t.number}
                        {t.reopenedFromId ? <Repeat className="size-3 text-danger-fg" aria-label="reaberto" /> : null}
                      </span>
                      <span className="block truncate">{t.subject}</span>
                    </span>
                    <span className="flex shrink-0 flex-col items-end gap-0.5">
                      <TicketStatusBadge status={t.status} />
                      <span className="text-[11px] text-muted"><RelativeTime value={t.openedAt} /></span>
                    </span>
                  </Link>
                </li>
              ))}
            </ul>
          )}
          {previous.length > 6 ? (
            <Link href={`/clientes/${client.id}?aba=suporte`} className="mt-1 inline-block text-xs font-medium text-secondary-fg hover:underline">
              Ver todos os {previous.length + 1} chamados
            </Link>
          ) : null}
        </div>
      </CardContent>
    </Card>
  );
}

/** Classificação editável: produto, categoria, criticidade (recalcula o SLA) e fila. */
export function TicketClassification({ detail, canOperate, bare, onSaved }: { detail: TicketDetail; canOperate: boolean; /** Só o formulário (dentro de um diálogo). */ bare?: boolean; onSaved?: () => void }) {
  const router = useRouter();
  const { ticket } = detail;
  const [productId, setProductId] = React.useState(ticket.productId ?? "");
  const [category, setCategory] = React.useState(ticket.category ?? "");
  const [priority, setPriority] = React.useState<TicketPriority>(ticket.priority);
  const [queue, setQueue] = React.useState<TicketQueue>((ticket.queue as TicketQueue) ?? "n1");
  const [pending, startTransition] = React.useTransition();
  const id = React.useId();
  const dirty = productId !== (ticket.productId ?? "") || category !== (ticket.category ?? "") || priority !== ticket.priority || queue !== ticket.queue;
  const priorityChanged = priority !== ticket.priority && detail.row.open;

  const save = () =>
    startTransition(async () => {
      const result = await classifyTicketAction({ ticketId: ticket.id, productId: productId || undefined, category: category || undefined, priority, queue });
      if (!result.ok) {
        toast.error(result.error);
        return;
      }
      toast.success(result.data.slaRestarted ? "Classificação salva · SLA recalculado pela nova criticidade" : "Classificação salva");
      onSaved?.();
      router.refresh();
    });

  const form = (
        <form
          className="flex flex-col gap-3"
          onSubmit={(e) => {
            e.preventDefault();
            save();
          }}
        >
          <FormField label="Criticidade" htmlFor={`${id}-priority`} hint={TICKET_PRIORITY_DEFINITIONS[priority]}>
            <Select id={`${id}-priority`} value={priority} onChange={(e) => setPriority(e.target.value as TicketPriority)} disabled={!canOperate} options={TICKET_PRIORITIES.map((p) => ({ value: p, label: TICKET_PRIORITY_LABELS[p] }))} />
          </FormField>
          {priorityChanged ? (
            <p className="flex items-start gap-1.5 rounded-md bg-warning-soft px-2.5 py-2 text-xs text-warning-fg">
              <AlertTriangle className="mt-0.5 size-3.5 shrink-0" /> O SLA será recalculado com a regra {TICKET_PRIORITY_LABELS[priority]}, mantendo o horário de abertura.
            </p>
          ) : null}
          <FormField label="Fila" htmlFor={`${id}-queue`}>
            <Select id={`${id}-queue`} value={queue} onChange={(e) => setQueue(e.target.value as TicketQueue)} disabled={!canOperate} options={TICKET_QUEUES.map((q) => ({ value: q, label: TICKET_QUEUE_LABELS[q] }))} />
          </FormField>
          <FormField label="Produto" htmlFor={`${id}-product`}>
            <Select id={`${id}-product`} value={productId} onChange={(e) => setProductId(e.target.value)} disabled={!canOperate} placeholder="Não se aplica" options={detail.catalog.map((p) => ({ value: p.id, label: p.name }))} />
          </FormField>
          <FormField label="Categoria" htmlFor={`${id}-category`}>
            <Input id={`${id}-category`} value={category} onChange={(e) => setCategory(e.target.value)} disabled={!canOperate} maxLength={60} placeholder="Ex.: Fiscal" />
          </FormField>
          {canOperate ? (
            <Button type="submit" variant={bare ? "primary" : "outline"} size="sm" loading={pending} disabled={!dirty} className="min-h-[44px] md:min-h-8">
              <Save /> Salvar classificação
            </Button>
          ) : null}
        </form>
  );
  if (bare) return form;
  return (
    <Card>
      <CardHeader className="pb-2">
        <CardTitle className="text-sm">Classificação</CardTitle>
      </CardHeader>
      <CardContent className="pt-0">{form}</CardContent>
    </Card>
  );
}

/** Anexos por URL (documents com entityType "ticket"). */
export function TicketAttachments({ detail, canOperate }: { detail: TicketDetail; canOperate: boolean }) {
  const router = useRouter();
  const [adding, setAdding] = React.useState(false);
  const [name, setName] = React.useState("");
  const [url, setUrl] = React.useState("");
  const [pending, startTransition] = React.useTransition();
  const id = React.useId();

  const submit = () =>
    startTransition(async () => {
      const result = await addAttachmentAction({ ticketId: detail.ticket.id, name, url });
      if (!result.ok) {
        toast.error(result.error);
        return;
      }
      toast.success("Anexo adicionado");
      setName("");
      setUrl("");
      setAdding(false);
      router.refresh();
    });

  return (
    <Card>
      <CardHeader className="flex-row items-center justify-between pb-2">
        <CardTitle className="flex items-center gap-2 text-sm">
          <Paperclip className="size-4 text-muted" /> Anexos
        </CardTitle>
        {canOperate && !adding ? (
          <Button size="sm" variant="ghost" onClick={() => setAdding(true)}>
            <Plus /> Adicionar
          </Button>
        ) : null}
      </CardHeader>
      <CardContent className="flex flex-col gap-3 pt-0">
        {detail.documents.length === 0 && !adding ? <p className="text-sm text-muted">Nenhum anexo. Prints, logs e vídeos podem ser anexados por link.</p> : null}
        {detail.documents.length > 0 ? (
          <ul className="flex flex-col gap-1.5">
            {detail.documents.map((d) => (
              <li key={d.id} className="text-sm">
                <a href={d.url} target="_blank" rel="noreferrer" className="font-medium text-secondary-fg hover:underline">
                  {d.name}
                </a>
                <p className="text-[11px] text-muted">
                  {detail.users[d.uploadedBy]?.name ?? "—"} · <RelativeTime value={d.createdAt} />
                </p>
              </li>
            ))}
          </ul>
        ) : null}
        {adding ? (
          <form
            className="flex flex-col gap-2"
            onSubmit={(e) => {
              e.preventDefault();
              submit();
            }}
          >
            <FormField label="Nome" htmlFor={`${id}-name`} required>
              <Input id={`${id}-name`} value={name} onChange={(e) => setName(e.target.value)} placeholder="Ex.: print do erro" required />
            </FormField>
            <FormField label="URL" htmlFor={`${id}-url`} required>
              <Input id={`${id}-url`} type="url" value={url} onChange={(e) => setUrl(e.target.value)} placeholder="https://" required />
            </FormField>
            <div className="flex justify-end gap-2">
              <Button type="button" size="sm" variant="ghost" onClick={() => setAdding(false)} disabled={pending}>
                Cancelar
              </Button>
              <Button type="submit" size="sm" loading={pending} disabled={!name.trim() || !url.trim()}>
                Anexar
              </Button>
            </div>
          </form>
        ) : null}
      </CardContent>
    </Card>
  );
}

/** Artigos da base sugeridos pelas palavras do assunto e pelo produto. */
export function SuggestedArticles({ detail }: { detail: TicketDetail }) {
  return (
    <Card>
      <CardHeader className="pb-2">
        <CardTitle className="flex items-center gap-2 text-sm">
          <BookOpen className="size-4 text-muted" /> Artigos sugeridos
        </CardTitle>
      </CardHeader>
      <CardContent className="pt-0">
        {detail.suggestedArticles.length === 0 ? (
          <p className="text-sm text-muted">
            Nenhum artigo relacionado.{" "}
            <Link href="/suporte/base-de-conhecimento" className="font-medium text-secondary-fg hover:underline">
              Buscar na base
            </Link>
          </p>
        ) : (
          <ul className="flex flex-col gap-2">
            {detail.suggestedArticles.map((a) => (
              <li key={a.id}>
                <Link href={`/suporte/base-de-conhecimento/${a.id}`} target="_blank" className="block rounded-md p-1.5 text-sm hover:bg-surface-hover">
                  <span className="font-medium">{a.title}</span>
                  {a.productName ? <span className="block text-xs text-muted">{a.productName}</span> : null}
                </Link>
              </li>
            ))}
          </ul>
        )}
      </CardContent>
    </Card>
  );
}
