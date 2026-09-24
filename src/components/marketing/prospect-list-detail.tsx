"use client";

import * as React from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { ArrowRightLeft, CalendarClock, Mail, MessageCircle, MoreHorizontal, Phone, PhoneCall, Upload, UserCheck, Users } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Checkbox } from "@/components/ui/checkbox";
import { DateInput, dateValueToIso } from "@/components/ui/date-input";
import { Dialog, DialogBody, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuSeparator, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import { EmptyState } from "@/components/ui/empty-state";
import { FormField } from "@/components/ui/form-field";
import { Input } from "@/components/ui/input";
import { SearchInput } from "@/components/ui/search-input";
import { SegmentedControl } from "@/components/ui/segmented-control";
import { Select } from "@/components/ui/select";
import { Switch } from "@/components/ui/switch";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Textarea } from "@/components/ui/textarea";
import { toast } from "@/components/ui/toast";
import { formatDateTime, formatPhone } from "@/lib/format";
import { assignProspectsAction, convertProspectAction, recordProspectAttempt, scheduleProspectAction, setProspectListStatus } from "@/server/marketing/actions";
import type { Prospect } from "@/domain/types";
import { ProspectStatusBadge } from "./lead-badges";
import { ImportProspectsDialog } from "./prospect-lists-view";
import { ATTEMPT_RESULT_LABELS, PROSPECT_LIST_STATUS_LABELS, PROSPECT_STATUS_LABELS, type AttemptResult, type ContactChannel, type MarketingOptions, type ProspectListDetail, type ProspectRowItem } from "./marketing-model";
import { RelativeTime } from "@/components/ui/relative-time";

type RowDialog = { kind: "attempt" | "schedule" | "convert"; prospect: ProspectRowItem } | null;

const STATUS_FILTERS: (Prospect["status"] | "")[] = ["", "novo", "tentativa", "contatado", "respondeu", "convertido", "descartado"];

/** Contatos da lista: filtros, seleção em lote (atribuir vendedor) e ações por contato. */
export function ProspectListDetailView({ detail, options, autoImport }: { detail: ProspectListDetail; options: MarketingOptions; autoImport: boolean }) {
  const router = useRouter();
  const { list, prospects } = detail;
  const [q, setQ] = React.useState("");
  const [status, setStatus] = React.useState<Prospect["status"] | "">("");
  const [selected, setSelected] = React.useState<Set<string>>(new Set());
  const [bulkOwner, setBulkOwner] = React.useState("");
  const [dialog, setDialog] = React.useState<RowDialog>(null);
  const [importOpen, setImportOpen] = React.useState(autoImport);
  const [pending, startTransition] = React.useTransition();

  const term = q.trim().toLowerCase();
  const visible = prospects.filter((p) => (!status || p.status === status) && (!term || [p.name, p.company, p.city, p.phone, p.email].filter(Boolean).join(" ").toLowerCase().includes(term)));
  const allSelected = visible.length > 0 && visible.every((p) => selected.has(p.id));

  const toggle = (id: string, on: boolean) =>
    setSelected((s) => {
      const next = new Set(s);
      if (on) next.add(id);
      else next.delete(id);
      return next;
    });

  const assign = () =>
    startTransition(async () => {
      const result = await assignProspectsAction({ listId: list.id, prospectIds: Array.from(selected), ownerId: bulkOwner });
      if (!result.ok) {
        toast.error(result.error);
        return;
      }
      toast.success(`${result.data.count} contato(s) atribuído(s)`);
      setSelected(new Set());
      router.refresh();
    });

  const changeStatus = (value: string) =>
    startTransition(async () => {
      const result = await setProspectListStatus({ listId: list.id, status: value });
      if (!result.ok) toast.error(result.error);
      else {
        toast.success("Status da lista atualizado");
        router.refresh();
      }
    });

  const actionsMenu = (p: ProspectRowItem) => {
    const done = p.status === "convertido";
    return (
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <Button variant="ghost" size="icon" className="size-11 md:size-8" aria-label={`Ações para ${p.name}`}>
            <MoreHorizontal />
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end">
          <DropdownMenuItem disabled={done} onSelect={() => setDialog({ kind: "attempt", prospect: p })}>
            <PhoneCall /> Registrar tentativa
          </DropdownMenuItem>
          <DropdownMenuItem disabled={done || p.status === "descartado"} onSelect={() => setDialog({ kind: "schedule", prospect: p })}>
            <CalendarClock /> Agendar próxima ação
          </DropdownMenuItem>
          <DropdownMenuSeparator />
          <DropdownMenuItem disabled={done} onSelect={() => setDialog({ kind: "convert", prospect: p })}>
            <ArrowRightLeft /> Converter em lead ou oportunidade
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>
    );
  };

  return (
    <section className="flex flex-col gap-3">
      <div className="flex flex-col gap-2 md:flex-row md:items-center md:justify-between">
        <div className="flex flex-col gap-2 sm:flex-row sm:items-center">
          <SearchInput value={q} onChange={setQ} placeholder="Buscar contato, empresa, cidade…" className="sm:w-72" aria-label="Buscar contatos" />
          <Select size="sm" aria-label="Status" value={status} onChange={(e) => setStatus(e.target.value as Prospect["status"] | "")} className="sm:w-48">
            {STATUS_FILTERS.map((s) => (
              <option key={s || "todos"} value={s}>
                {s ? PROSPECT_STATUS_LABELS[s] : "Todos os status"}
              </option>
            ))}
          </Select>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <Select size="sm" aria-label="Status da lista" value={list.status} onChange={(e) => changeStatus(e.target.value)} disabled={pending} className="w-40">
            {Object.entries(PROSPECT_LIST_STATUS_LABELS).map(([value, label]) => (
              <option key={value} value={value}>
                Lista {label.toLowerCase()}
              </option>
            ))}
          </Select>
          <Button variant="outline" size="sm" onClick={() => setImportOpen(true)}>
            <Upload /> Importar contatos
          </Button>
        </div>
      </div>

      {selected.size > 0 ? (
        <div className="sticky top-2 z-10 flex flex-col gap-2 rounded-lg border border-brand/40 bg-brand-soft p-3 shadow-card sm:flex-row sm:items-center">
          <span className="text-sm font-medium">{selected.size} selecionado(s)</span>
          <Select size="sm" aria-label="Atribuir a" value={bulkOwner} onChange={(e) => setBulkOwner(e.target.value)} className="sm:w-56">
            <option value="">Atribuir a…</option>
            <optgroup label="Vendas">
              {options.sellers.map((u) => (
                <option key={u.id} value={u.id}>
                  {u.name}
                </option>
              ))}
            </optgroup>
            <optgroup label="Todos">
              {options.users
                .filter((u) => !options.sellers.some((s) => s.id === u.id))
                .map((u) => (
                  <option key={u.id} value={u.id}>
                    {u.name}
                  </option>
                ))}
            </optgroup>
          </Select>
          <Button size="sm" onClick={assign} disabled={!bulkOwner} loading={pending}>
            <UserCheck /> Atribuir
          </Button>
          <Button size="sm" variant="ghost" onClick={() => setSelected(new Set())}>
            Limpar seleção
          </Button>
        </div>
      ) : null}

      {prospects.length === 0 ? (
        <Card>
          <EmptyState
            icon={<Users />}
            title="Lista sem contatos"
            description="Importe um CSV com nome, empresa, telefone, e-mail e cidade."
            action={
              <Button onClick={() => setImportOpen(true)}>
                <Upload /> Importar contatos
              </Button>
            }
          />
        </Card>
      ) : visible.length === 0 ? (
        <Card>
          <EmptyState size="sm" icon={<Users />} title="Nenhum contato com esses filtros" />
        </Card>
      ) : (
        <>
          <Card className="hidden overflow-hidden md:block">
            <Table className="min-w-[1000px]">
              <TableHeader>
                <TableRow>
                  <TableHead className="w-10">
                    <Checkbox checked={allSelected ? true : selected.size > 0 ? "indeterminate" : false} onCheckedChange={(c) => setSelected(c === true ? new Set(visible.map((p) => p.id)) : new Set())} aria-label="Selecionar todos" />
                  </TableHead>
                  <TableHead>Contato</TableHead>
                  <TableHead>Status</TableHead>
                  <TableHead className="text-right">Tentativas</TableHead>
                  <TableHead>Última tentativa</TableHead>
                  <TableHead>Próxima ação</TableHead>
                  <TableHead>Resultado</TableHead>
                  <TableHead>Responsável</TableHead>
                  <TableHead />
                </TableRow>
              </TableHeader>
              <TableBody>
                {visible.map((p) => (
                  <TableRow key={p.id} data-state={selected.has(p.id) ? "selected" : undefined}>
                    <TableCell>
                      <Checkbox checked={selected.has(p.id)} onCheckedChange={(c) => toggle(p.id, c === true)} aria-label={`Selecionar ${p.name}`} />
                    </TableCell>
                    <TableCell>
                      <span className="block font-medium">{p.name}</span>
                      <span className="text-xs text-muted">{[p.company !== p.name ? p.company : null, p.phone ? formatPhone(p.phone) : p.email, p.city].filter(Boolean).join(" · ")}</span>
                    </TableCell>
                    <TableCell>
                      <ProspectStatusBadge status={p.status} />
                    </TableCell>
                    <TableCell className="text-right tabular-nums">{p.attempts}</TableCell>
                    <TableCell className="text-sm text-muted">{p.lastAttemptAt ? <RelativeTime value={p.lastAttemptAt} /> : "—"}</TableCell>
                    <TableCell className="text-sm">{p.nextActionAt ? <span className={p.overdue ? "font-medium text-danger-fg" : undefined}>{formatDateTime(p.nextActionAt)}</span> : <span className="text-muted-light">—</span>}</TableCell>
                    <TableCell className="max-w-[220px] text-sm">
                      <span className="line-clamp-2">{p.result ?? <span className="text-muted-light">—</span>}</span>
                      {p.leadId ? (
                        <Link href={`/marketing/leads?lead=${p.leadId}`} className="text-xs font-medium text-brand hover:underline">
                          ver lead
                        </Link>
                      ) : null}
                      {p.opportunityId ? (
                        <Link href={`/vendas/oportunidades?oportunidade=${p.opportunityId}`} className="text-xs font-medium text-brand hover:underline">
                          ver oportunidade
                        </Link>
                      ) : null}
                    </TableCell>
                    <TableCell className="text-sm">{p.ownerName ?? <span className="text-muted-light">—</span>}</TableCell>
                    <TableCell className="text-right">{actionsMenu(p)}</TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </Card>
          <ul className="flex flex-col gap-2 md:hidden">
            {visible.map((p) => (
              <li key={p.id} className="flex gap-3 rounded-lg border border-border bg-surface p-3 shadow-card">
                <Checkbox checked={selected.has(p.id)} onCheckedChange={(c) => toggle(p.id, c === true)} aria-label={`Selecionar ${p.name}`} className="mt-1" />
                <div className="min-w-0 flex-1">
                  <p className="truncate font-medium">{p.name}</p>
                  <p className="truncate text-xs text-muted">{[p.company !== p.name ? p.company : null, p.phone ? formatPhone(p.phone) : p.email].filter(Boolean).join(" · ")}</p>
                  <p className="mt-1 flex flex-wrap items-center gap-2 text-xs text-muted">
                    <ProspectStatusBadge status={p.status} /> {p.attempts} tentativa(s)
                    {p.nextActionAt ? <span className={p.overdue ? "text-danger-fg" : undefined}>· próxima {formatDateTime(p.nextActionAt)}</span> : null}
                  </p>
                </div>
                {actionsMenu(p)}
              </li>
            ))}
          </ul>
        </>
      )}

      {dialog?.kind === "attempt" ? <AttemptDialog prospect={dialog.prospect} onClose={() => setDialog(null)} /> : null}
      {dialog?.kind === "schedule" ? <ScheduleDialog prospect={dialog.prospect} onClose={() => setDialog(null)} /> : null}
      {dialog?.kind === "convert" ? <ConvertDialog prospect={dialog.prospect} options={options} onClose={() => setDialog(null)} /> : null}
      <ImportProspectsDialog
        list={importOpen ? list : null}
        onClose={() => {
          setImportOpen(false);
          if (autoImport) router.replace(`/marketing/prospeccao/${list.id}`, { scroll: false });
        }}
      />
    </section>
  );
}

const CHANNELS: { value: ContactChannel; label: string; icon: React.ReactNode }[] = [
  { value: "ligacao", label: "Ligação", icon: <Phone /> },
  { value: "whatsapp", label: "WhatsApp", icon: <MessageCircle /> },
  { value: "email", label: "E-mail", icon: <Mail /> },
];

function useSubmit(onClose: () => void) {
  const router = useRouter();
  const [pending, startTransition] = React.useTransition();
  const submit = (action: () => Promise<{ ok: true } | { ok: false; error: string }>, message: string) =>
    startTransition(async () => {
      const result = await action();
      if (!result.ok) {
        toast.error(result.error);
        return;
      }
      toast.success(message);
      onClose();
      router.refresh();
    });
  return { pending, submit };
}

function AttemptDialog({ prospect, onClose }: { prospect: ProspectRowItem; onClose: () => void }) {
  const { pending, submit } = useSubmit(onClose);
  const [channel, setChannel] = React.useState<ContactChannel>("ligacao");
  const [result, setResult] = React.useState<AttemptResult>("sem_resposta");
  const [note, setNote] = React.useState("");
  const [nextActionAt, setNextActionAt] = React.useState("");
  return (
    <Dialog open onOpenChange={(v) => !v && !pending && onClose()}>
      <DialogContent>
        <form
          className="flex min-h-0 flex-col"
          onSubmit={(e) => {
            e.preventDefault();
            submit(() => recordProspectAttempt({ prospectId: prospect.id, channel, result, note, nextActionAt: dateValueToIso(nextActionAt) }), "Tentativa registrada");
          }}
        >
          <DialogHeader>
            <DialogTitle>Registrar tentativa</DialogTitle>
            <DialogDescription>
              {prospect.name}
              {prospect.phone ? ` · ${formatPhone(prospect.phone)}` : ""} · {prospect.attempts} tentativa(s) até agora
            </DialogDescription>
          </DialogHeader>
          <DialogBody className="flex flex-col gap-4">
            <SegmentedControl aria-label="Canal" options={CHANNELS} value={channel} onChange={setChannel} />
            <fieldset className="grid grid-cols-2 gap-2">
              <legend className="mb-2 text-[13px] font-medium">Resultado</legend>
              {(Object.keys(ATTEMPT_RESULT_LABELS) as AttemptResult[]).map((r) => (
                <label key={r} className="flex min-h-[44px] cursor-pointer items-center gap-2 rounded-lg border border-border px-3 text-sm has-[:checked]:border-brand has-[:checked]:bg-brand-soft/40">
                  <input type="radio" name="result" value={r} checked={result === r} onChange={() => setResult(r)} className="accent-[var(--color-brand)]" />
                  {ATTEMPT_RESULT_LABELS[r]}
                </label>
              ))}
            </fieldset>
            <FormField label="Anotação" htmlFor="att-note">
              <Textarea id="att-note" value={note} onChange={(e) => setNote(e.target.value)} className="min-h-[64px]" placeholder="Ex.: Pediu para ligar na segunda." />
            </FormField>
            {result !== "descartado" ? (
              <FormField label="Próxima ação em" htmlFor="att-next">
                <DateInput id="att-next" mode="datetime-local" value={nextActionAt} onChange={(e) => setNextActionAt(e.target.value)} />
              </FormField>
            ) : null}
          </DialogBody>
          <DialogFooter>
            <Button variant="outline" onClick={onClose} disabled={pending}>
              Cancelar
            </Button>
            <Button type="submit" loading={pending}>
              Registrar
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

function ScheduleDialog({ prospect, onClose }: { prospect: ProspectRowItem; onClose: () => void }) {
  const { pending, submit } = useSubmit(onClose);
  const [when, setWhen] = React.useState("");
  const [note, setNote] = React.useState("");
  return (
    <Dialog open onOpenChange={(v) => !v && !pending && onClose()}>
      <DialogContent size="sm">
        <form
          className="flex min-h-0 flex-col"
          onSubmit={(e) => {
            e.preventDefault();
            submit(() => scheduleProspectAction({ prospectId: prospect.id, nextActionAt: when, note: note || undefined }), "Próxima ação agendada");
          }}
        >
          <DialogHeader>
            <DialogTitle>Agendar próxima ação</DialogTitle>
            <DialogDescription>{prospect.name}</DialogDescription>
          </DialogHeader>
          <DialogBody className="flex flex-col gap-4">
            <FormField label="Quando" htmlFor="sch-when" required>
              <DateInput id="sch-when" mode="datetime-local" value={when} onChange={(e) => setWhen(e.target.value)} required />
            </FormField>
            <FormField label="O que fazer" htmlFor="sch-note">
              <Input id="sch-note" value={note} onChange={(e) => setNote(e.target.value)} placeholder="Ex.: Ligar para o dono após 14h" />
            </FormField>
          </DialogBody>
          <DialogFooter>
            <Button variant="outline" onClick={onClose} disabled={pending}>
              Cancelar
            </Button>
            <Button type="submit" loading={pending} disabled={!when}>
              Agendar
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

function ConvertDialog({ prospect, options, onClose }: { prospect: ProspectRowItem; options: MarketingOptions; onClose: () => void }) {
  const router = useRouter();
  const [pending, startTransition] = React.useTransition();
  const [target, setTarget] = React.useState<"lead" | "oportunidade">(prospect.status === "respondeu" ? "oportunidade" : "lead");
  const [interest, setInterest] = React.useState("");
  const [products, setProducts] = React.useState<string[]>([]);
  const [consent, setConsent] = React.useState(false);
  const [sellerId, setSellerId] = React.useState("");

  const submit = (e: React.FormEvent) => {
    e.preventDefault();
    startTransition(async () => {
      const result = await convertProspectAction({ prospectId: prospect.id, target, interest: interest || undefined, productInterestIds: products, consent, sellerId: sellerId || undefined });
      if (!result.ok) {
        toast.error(result.error);
        return;
      }
      onClose();
      if (result.data.target === "lead") {
        toast.success("Lead criado a partir do contato");
        router.push(`/marketing/leads?lead=${result.data.leadId}`);
      } else {
        toast.success(`Oportunidade criada para ${result.data.sellerName}`);
        for (const w of result.data.warnings) toast.warning(w);
        router.refresh();
      }
    });
  };

  return (
    <Dialog open onOpenChange={(v) => !v && !pending && onClose()}>
      <DialogContent size="lg">
        <form onSubmit={submit} className="flex min-h-0 flex-col">
          <DialogHeader>
            <DialogTitle>Converter contato</DialogTitle>
            <DialogDescription>
              {prospect.name}
              {prospect.company && prospect.company !== prospect.name ? ` · ${prospect.company}` : ""}
            </DialogDescription>
          </DialogHeader>
          <DialogBody className="flex flex-col gap-4">
            <SegmentedControl
              aria-label="Converter em"
              value={target}
              onChange={setTarget}
              options={[
                { value: "lead", label: "Lead (Marketing qualifica)" },
                { value: "oportunidade", label: "Oportunidade (direto para Vendas)" },
              ]}
            />
            <p className="text-sm text-muted">
              {target === "lead"
                ? "Cria um lead com origem “Lista de prospecção”, com score calculado, para seguir o funil até o MQL."
                : "Cria (ou reaproveita) o cliente como prospect, a oportunidade em Qualificação, a jornada na etapa Vendas e a tarefa de primeiro contato do vendedor."}
            </p>
            <FormField label="Interesse" htmlFor="cv-interest">
              <Input id="cv-interest" value={interest} onChange={(e) => setInterest(e.target.value)} placeholder="Ex.: ERP com PDV e TEF" />
            </FormField>
            <fieldset>
              <legend className="mb-2 text-[13px] font-medium">Produtos de interesse</legend>
              <div className="grid grid-cols-1 gap-x-4 sm:grid-cols-2 md:grid-cols-3">
                {options.products.map((p) => (
                  <Checkbox key={p.id} label={p.name} checked={products.includes(p.id)} onCheckedChange={(c) => setProducts((cur) => (c === true ? [...cur, p.id] : cur.filter((x) => x !== p.id)))} className="py-1.5 md:py-1" />
                ))}
              </div>
            </fieldset>
            {target === "oportunidade" ? (
              <FormField label="Vendedor" htmlFor="cv-seller" hint="Automático: rodízio entre os vendedores ativos.">
                <Select id="cv-seller" value={sellerId} onChange={(e) => setSellerId(e.target.value)}>
                  <option value="">Automático (rodízio)</option>
                  {options.sellers.map((s) => (
                    <option key={s.id} value={s.id}>
                      {s.name}
                    </option>
                  ))}
                </Select>
              </FormField>
            ) : null}
            <Switch label="Consentimento LGPD obtido" description="O contato autorizou o uso dos dados para contato comercial." checked={consent} onCheckedChange={setConsent} />
          </DialogBody>
          <DialogFooter>
            <Button variant="outline" onClick={onClose} disabled={pending}>
              Cancelar
            </Button>
            <Button type="submit" loading={pending}>
              Converter
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
