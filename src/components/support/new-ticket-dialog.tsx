"use client";

import * as React from "react";
import { useRouter } from "next/navigation";
import { Building2, Check, Plus, Search, X } from "lucide-react";
import type { SupportOptions } from "@/server/support/queries";
import { createTicketAction, loadClientTicketContext } from "@/server/support/actions";
import {
  TICKET_CHANNELS,
  TICKET_CHANNEL_LABELS,
  TICKET_PRIORITIES,
  TICKET_PRIORITY_DEFINITIONS,
  TICKET_PRIORITY_LABELS,
  TICKET_QUEUES,
  TICKET_QUEUE_LABELS,
  type TicketChannel,
  type TicketPriority,
  type TicketQueue,
} from "@/server/support/schemas";
import { Button } from "@/components/ui/button";
import { Dialog, DialogBody, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { FormField } from "@/components/ui/form-field";
import { Input } from "@/components/ui/input";
import { Select } from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import { toast } from "@/components/ui/toast";
import { cn } from "@/lib/utils";
import { formatSlaHours } from "./format";

export type NewTicketOptions = Pick<SupportOptions, "clients" | "products" | "team" | "categories" | "slaRules">;

export interface NewTicketDialogProps {
  options: NewTicketOptions;
  /** Cliente fixo (ex.: aberto pela ficha 360º). */
  fixedClient?: { id: string; name: string };
  trigger?: React.ReactNode;
  /** Após criar, abre a página do chamado (padrão: só atualiza a tela). */
  openAfterCreate?: boolean;
}

interface ClientContext {
  contacts: { id: string; name: string; role?: string; isPrimary: boolean }[];
  products: { id: string; name: string; status: string }[];
}

const normalize = (v: string) =>
  v
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase();

const PRIORITY_TONE: Record<TicketPriority, string> = {
  critico: "border-danger/60 bg-danger-soft/50",
  alto: "border-warning/60 bg-warning-soft/50",
  medio: "border-info/50 bg-info-soft/40",
  baixo: "border-border-strong bg-surface-muted",
};

/** Botão + diálogo de novo chamado (Central, Chamados e ficha do cliente). */
export function NewTicketDialog({ options, fixedClient, trigger, openAfterCreate }: NewTicketDialogProps) {
  const router = useRouter();
  const [open, setOpen] = React.useState(false);
  const [pending, startTransition] = React.useTransition();
  const [clientId, setClientId] = React.useState(fixedClient?.id ?? "");
  const [clientQuery, setClientQuery] = React.useState("");
  const [context, setContext] = React.useState<ClientContext | null>(null);
  const [loadingContext, setLoadingContext] = React.useState(false);
  const [contactId, setContactId] = React.useState("");
  const [productId, setProductId] = React.useState("");
  const [subject, setSubject] = React.useState("");
  const [description, setDescription] = React.useState("");
  const [channel, setChannel] = React.useState<TicketChannel>("whatsapp");
  const [priority, setPriority] = React.useState<TicketPriority>("medio");
  const [queue, setQueue] = React.useState<TicketQueue>("n1");
  const [queueTouched, setQueueTouched] = React.useState(false);
  const [category, setCategory] = React.useState("");
  const [assigneeId, setAssigneeId] = React.useState("");
  const id = React.useId();

  const clientName = fixedClient?.name ?? options.clients.find((c) => c.id === clientId)?.name;
  const matches = React.useMemo(() => {
    const q = normalize(clientQuery.trim());
    if (!q) return [];
    const digits = clientQuery.replace(/\D/g, "");
    return options.clients.filter((c) => normalize(c.name).includes(q) || (digits.length >= 4 && (c.document ?? "").replace(/\D/g, "").includes(digits))).slice(0, 8);
  }, [clientQuery, options.clients]);

  const loadContext = React.useCallback((cid: string) => {
    setLoadingContext(true);
    setContext(null);
    loadClientTicketContext(cid).then((result) => {
      setLoadingContext(false);
      if (!result.ok) {
        toast.error(result.error);
        return;
      }
      setContext(result.data);
      const primary = result.data.contacts.find((c) => c.isPrimary) ?? result.data.contacts[0];
      setContactId(primary?.id ?? "");
      setProductId(result.data.products[0]?.id ?? "");
    });
  }, []);

  const reset = () => {
    setClientId(fixedClient?.id ?? "");
    setClientQuery("");
    setContext(null);
    setContactId("");
    setProductId("");
    setSubject("");
    setDescription("");
    setChannel("whatsapp");
    setPriority("medio");
    setQueue("n1");
    setQueueTouched(false);
    setCategory("");
    setAssigneeId("");
  };

  const choosePriority = (p: TicketPriority) => {
    setPriority(p);
    // Crítico e alto vão para o N2 por padrão (o usuário pode mudar).
    if (!queueTouched) setQueue(p === "critico" || p === "alto" ? "n2" : "n1");
  };

  const selectClient = (cid: string) => {
    setClientId(cid);
    setClientQuery("");
    loadContext(cid);
  };

  const submit = () => {
    startTransition(async () => {
      const result = await createTicketAction({
        clientId,
        contactId: contactId || undefined,
        productId: productId || undefined,
        subject,
        description,
        channel,
        priority,
        queue,
        category: category || undefined,
        assigneeId: assigneeId || undefined,
      });
      if (!result.ok) {
        toast.error(result.error);
        return;
      }
      toast.success(`Chamado ${result.data.number} aberto`, {
        action: { label: "Abrir", onClick: () => router.push(`/suporte/chamados/${result.data.id}`) },
      });
      setOpen(false);
      reset();
      if (openAfterCreate) router.push(`/suporte/chamados/${result.data.id}`);
      else router.refresh();
    });
  };

  const ownedIds = new Set(context?.products.map((p) => p.id) ?? []);
  const otherProducts = options.products.filter((p) => !ownedIds.has(p.id));
  const rule = (p: TicketPriority) => options.slaRules.find((r) => r.priority === p);

  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        if (pending) return;
        setOpen(next);
        if (next && fixedClient && !context) loadContext(fixedClient.id);
      }}
    >
      <DialogTrigger asChild>
        {trigger ?? (
          <Button className="min-h-[44px] md:min-h-0">
            <Plus /> Novo chamado
          </Button>
        )}
      </DialogTrigger>
      <DialogContent size="lg">
        <DialogHeader>
          <DialogTitle>Novo chamado</DialogTitle>
          <DialogDescription>O SLA começa a contar na abertura, pela criticidade escolhida.</DialogDescription>
        </DialogHeader>
        <form
          className="contents"
          onSubmit={(e) => {
            e.preventDefault();
            submit();
          }}
        >
          <DialogBody className="flex flex-col gap-4 py-2">
            {/* Cliente */}
            <FormField label="Cliente" htmlFor={`${id}-client`} required>
              {clientId ? (
                <div className="flex min-h-[44px] items-center justify-between gap-2 rounded-lg border border-border bg-surface-muted px-3 py-2 md:min-h-9">
                  <span className="inline-flex min-w-0 items-center gap-2 text-sm">
                    <Building2 className="size-4 shrink-0 text-muted" />
                    <span className="truncate font-medium">{clientName}</span>
                  </span>
                  {!fixedClient ? (
                    <Button
                      type="button"
                      variant="ghost"
                      size="sm"
                      onClick={() => {
                        setClientId("");
                        setContext(null);
                      }}
                    >
                      <X /> Trocar
                    </Button>
                  ) : null}
                </div>
              ) : (
                <div className="relative">
                  <Input id={`${id}-client`} leadingIcon={<Search />} value={clientQuery} onChange={(e) => setClientQuery(e.target.value)} placeholder="Buscar por nome ou CNPJ" autoComplete="off" />
                  {matches.length > 0 ? (
                    <ul className="mt-1 max-h-60 overflow-y-auto rounded-lg border border-border bg-surface p-1 shadow-pop" role="listbox" aria-label="Clientes encontrados">
                      {matches.map((c) => (
                        <li key={c.id}>
                          <button type="button" role="option" aria-selected={false} onClick={() => selectClient(c.id)} className="flex min-h-[44px] w-full items-center justify-between gap-2 rounded-md px-2 py-1.5 text-left text-sm hover:bg-surface-hover md:min-h-9">
                            <span className="truncate font-medium">{c.name}</span>
                            <span className="shrink-0 text-xs text-muted">{c.city ?? ""}</span>
                          </button>
                        </li>
                      ))}
                    </ul>
                  ) : clientQuery.trim().length >= 2 ? (
                    <p className="mt-1 text-xs text-muted">Nenhum cliente encontrado.</p>
                  ) : null}
                </div>
              )}
            </FormField>

            {clientId ? (
              <div className="grid gap-3 sm:grid-cols-2">
                <FormField label="Contato" htmlFor={`${id}-contact`} hint={loadingContext ? "Carregando…" : context && context.contacts.length === 0 ? "Cliente sem contatos cadastrados" : undefined}>
                  <Select id={`${id}-contact`} value={contactId} onChange={(e) => setContactId(e.target.value)} disabled={!context} placeholder="Sem contato específico">
                    {context?.contacts.map((c) => (
                      <option key={c.id} value={c.id}>
                        {c.name}
                        {c.role ? ` · ${c.role}` : ""}
                        {c.isPrimary ? " (principal)" : ""}
                      </option>
                    ))}
                  </Select>
                </FormField>
                <FormField label="Produto" htmlFor={`${id}-product`}>
                  <Select id={`${id}-product`} value={productId} onChange={(e) => setProductId(e.target.value)} placeholder="Não se aplica">
                    {context && context.products.length > 0 ? (
                      <optgroup label="Contratados pelo cliente">
                        {context.products.map((p) => (
                          <option key={p.id} value={p.id}>
                            {p.name}
                            {p.status === "em_implantacao" ? " (em implantação)" : ""}
                          </option>
                        ))}
                      </optgroup>
                    ) : null}
                    <optgroup label="Outros produtos">
                      {otherProducts.map((p) => (
                        <option key={p.id} value={p.id}>
                          {p.name}
                        </option>
                      ))}
                    </optgroup>
                  </Select>
                </FormField>
              </div>
            ) : null}

            <FormField label="Assunto" htmlFor={`${id}-subject`} required>
              <Input id={`${id}-subject`} value={subject} onChange={(e) => setSubject(e.target.value)} maxLength={160} required minLength={3} placeholder="Ex.: NFC-e rejeitada pela SEFAZ" />
            </FormField>
            <FormField label="Descrição" htmlFor={`${id}-description`} required>
              <Textarea id={`${id}-description`} value={description} onChange={(e) => setDescription(e.target.value)} required minLength={3} placeholder="O que o cliente relatou, desde quando, quantos caixas/usuários afetados…" />
            </FormField>

            {/* Criticidade com definição e prazos */}
            <fieldset>
              <legend className="mb-1.5 text-[13px] font-medium">
                Criticidade <span className="text-danger">*</span>
              </legend>
              <div className="grid gap-2 sm:grid-cols-2" role="radiogroup" aria-label="Criticidade">
                {TICKET_PRIORITIES.map((p) => {
                  const r = rule(p);
                  const active = priority === p;
                  return (
                    <button
                      key={p}
                      type="button"
                      role="radio"
                      aria-checked={active}
                      onClick={() => choosePriority(p)}
                      className={cn("flex min-h-[56px] flex-col items-start gap-0.5 rounded-lg border px-3 py-2 text-left transition-colors", active ? PRIORITY_TONE[p] : "border-border hover:border-border-strong")}
                    >
                      <span className="flex w-full items-center justify-between gap-2 text-sm font-semibold">
                        {TICKET_PRIORITY_LABELS[p]}
                        {active ? <Check className="size-4 text-foreground" /> : null}
                      </span>
                      <span className="text-xs text-muted">{TICKET_PRIORITY_DEFINITIONS[p]}</span>
                      {r ? (
                        <span className="text-[11px] text-muted">
                          Resposta {formatSlaHours(r.responseHours, r.businessHoursOnly)} · solução {formatSlaHours(r.resolutionHours, r.businessHoursOnly)}
                        </span>
                      ) : null}
                    </button>
                  );
                })}
              </div>
            </fieldset>

            <div className="grid gap-3 sm:grid-cols-3">
              <FormField label="Canal" htmlFor={`${id}-channel`} required>
                <Select id={`${id}-channel`} value={channel} onChange={(e) => setChannel(e.target.value as TicketChannel)} options={TICKET_CHANNELS.map((c) => ({ value: c, label: TICKET_CHANNEL_LABELS[c] }))} />
              </FormField>
              <FormField label="Fila" htmlFor={`${id}-queue`} required>
                <Select
                  id={`${id}-queue`}
                  value={queue}
                  onChange={(e) => {
                    setQueue(e.target.value as TicketQueue);
                    setQueueTouched(true);
                  }}
                  options={TICKET_QUEUES.map((q) => ({ value: q, label: TICKET_QUEUE_LABELS[q] }))}
                />
              </FormField>
              <FormField label="Categoria" htmlFor={`${id}-category`}>
                <Input id={`${id}-category`} list={`${id}-categories`} value={category} onChange={(e) => setCategory(e.target.value)} placeholder="Ex.: Fiscal" maxLength={60} />
                <datalist id={`${id}-categories`}>
                  {options.categories.map((c) => (
                    <option key={c} value={c} />
                  ))}
                </datalist>
              </FormField>
            </div>
            <FormField label="Atendente" htmlFor={`${id}-assignee`} hint="Em branco: o chamado fica na fila até alguém assumir.">
              <Select id={`${id}-assignee`} value={assigneeId} onChange={(e) => setAssigneeId(e.target.value)} placeholder="Deixar na fila">
                {options.team.map((u) => (
                  <option key={u.id} value={u.id}>
                    {u.name}
                    {u.jobTitle ? ` · ${u.jobTitle}` : ""}
                  </option>
                ))}
              </Select>
            </FormField>
          </DialogBody>
          <DialogFooter>
            <Button type="button" variant="outline" onClick={() => setOpen(false)} disabled={pending}>
              Cancelar
            </Button>
            <Button type="submit" loading={pending} disabled={!clientId || subject.trim().length < 3 || description.trim().length < 3}>
              <Plus /> Abrir chamado
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
