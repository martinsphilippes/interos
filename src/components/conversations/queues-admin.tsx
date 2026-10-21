"use client";

import * as React from "react";
import { useRouter } from "next/navigation";
import { Pencil, Plus, Users } from "lucide-react";
import { saveQueueAction } from "@/server/conversations/actions";
import type { QueuesAdmin, QueueAdminRow } from "@/server/conversations/queries";
import { DEPARTMENT_KEYS, DEPARTMENT_LABELS, type DepartmentKey } from "@/domain/constants";
import { CONVERSATION_CHANNELS, QUEUE_STRATEGIES, type ConversationChannel, type QueueStrategy } from "@/domain/types";
import { QUEUE_STRATEGY_LABELS } from "@/domain/conversations";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Dialog, DialogBody, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { FormField } from "@/components/ui/form-field";
import { Input } from "@/components/ui/input";
import { Select } from "@/components/ui/select";
import { Switch } from "@/components/ui/switch";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { toast } from "@/components/ui/toast";
import { CHANNEL_LABELS } from "./model";

interface Draft {
  id?: string;
  name: string;
  department: DepartmentKey;
  channels: ConversationChannel[];
  memberIds: string[];
  strategy: QueueStrategy;
  maxConcurrent: string;
  slaRuleKey: string;
  overflowQueueId: string;
  overflowAfterMinutes: string;
  isDefault: boolean;
  active: boolean;
}

function draftOf(row?: QueueAdminRow): Draft {
  const q = row?.queue;
  return {
    id: q?.id,
    name: q?.name ?? "",
    department: q?.department ?? "suporte",
    channels: q?.channels ?? ["whatsapp", "email"],
    memberIds: q?.memberIds ?? [],
    strategy: q?.strategy ?? "menor_carga",
    maxConcurrent: String(q?.maxConcurrent ?? 4),
    slaRuleKey: q?.slaRuleKey ?? "",
    overflowQueueId: q?.overflowQueueId ?? "",
    overflowAfterMinutes: q?.overflowAfterMinutes ? String(q.overflowAfterMinutes) : "10",
    isDefault: Boolean(q?.isDefault),
    active: q?.active ?? true,
  };
}

/** Filas da Central: quem atende, como distribui, limite por operador, SLA e transbordo. */
export function QueuesAdminView({ data, canEdit }: { data: QueuesAdmin; canEdit: boolean }) {
  const router = useRouter();
  const [draft, setDraft] = React.useState<Draft | null>(null);
  const [pending, startTransition] = React.useTransition();
  const set = <K extends keyof Draft>(k: K, v: Draft[K]) => setDraft((d) => (d ? { ...d, [k]: v } : d));

  const save = () =>
    startTransition(async () => {
      if (!draft) return;
      const r = await saveQueueAction({
        id: draft.id,
        name: draft.name,
        department: draft.department,
        channels: draft.channels,
        memberIds: draft.memberIds,
        strategy: draft.strategy,
        maxConcurrent: draft.maxConcurrent,
        slaRuleKey: draft.slaRuleKey || undefined,
        overflowQueueId: draft.overflowQueueId || undefined,
        overflowAfterMinutes: draft.overflowQueueId ? draft.overflowAfterMinutes : undefined,
        isDefault: draft.isDefault,
        active: draft.active,
      });
      if (!r.ok) return void toast.error(r.error);
      toast.success(draft.id ? "Fila atualizada" : "Fila criada");
      setDraft(null);
      router.refresh();
    });

  const toggle = <T,>(list: T[], value: T) => (list.includes(value) ? list.filter((x) => x !== value) : [...list, value]);

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <p className="text-sm text-muted">Uma fila serve WhatsApp e e-mail hoje, e ligações na fase de telefonia. A conversa entra pela fila e vai para um operador online abaixo do limite.</p>
        {canEdit ? (
          <Button onClick={() => setDraft(draftOf())}>
            <Plus /> Nova fila
          </Button>
        ) : null}
      </div>
      <div className="overflow-x-auto rounded-xl border border-border bg-surface shadow-card">
        <Table className="min-w-[860px]">
          <TableHeader>
            <TableRow>
              <TableHead>Fila</TableHead>
              <TableHead>Departamento</TableHead>
              <TableHead>Distribuição</TableHead>
              <TableHead>Operadores</TableHead>
              <TableHead>SLA</TableHead>
              <TableHead>Agora</TableHead>
              {canEdit ? <TableHead className="w-12" /> : null}
            </TableRow>
          </TableHeader>
          <TableBody>
            {data.rows.map((row) => {
              const online = row.members.filter((m) => m.presence === "online").length;
              return (
                <TableRow key={row.queue.id} className={row.queue.active ? undefined : "opacity-60"}>
                  <TableCell>
                    <span className="font-medium">{row.queue.name}</span>
                    <span className="ml-2 inline-flex gap-1">
                      {row.queue.isDefault ? <Badge size="sm" variant="brand">padrão</Badge> : null}
                      {!row.queue.active ? <Badge size="sm" variant="muted">inativa</Badge> : null}
                    </span>
                    {row.overflowName && row.queue.overflowAfterMinutes ? <p className="text-xs text-muted">transborda para {row.overflowName} em {row.queue.overflowAfterMinutes} min</p> : null}
                    {row.queue.active && row.members.length === 0 ? <p className="text-xs font-medium text-danger-fg">sem operadores: o que cai aqui fica visível para todos, mas ninguém recebe automaticamente</p> : null}
                  </TableCell>
                  <TableCell>{DEPARTMENT_LABELS[row.queue.department]}</TableCell>
                  <TableCell>
                    {QUEUE_STRATEGY_LABELS[row.queue.strategy]}
                    <p className="text-xs text-muted">até {row.queue.maxConcurrent} por operador</p>
                  </TableCell>
                  <TableCell>
                    <span className="inline-flex items-center gap-1">
                      <Users className="size-3.5 text-muted" aria-hidden /> {row.members.length}
                    </span>
                    <span className={online === 0 && row.members.length > 0 ? "ml-1 text-xs text-danger-fg" : "ml-1 text-xs text-muted"}>· {online} online</span>
                    <p className="max-w-[220px] truncate text-xs text-muted" title={row.members.map((m) => m.name).join(", ")}>
                      {row.members.map((m) => m.name.split(" ")[0]).join(", ") || "ninguém ainda"}
                    </p>
                  </TableCell>
                  <TableCell className="font-mono text-xs">{row.queue.slaRuleKey ?? <span className="font-sans text-muted">sem SLA</span>}</TableCell>
                  <TableCell>
                    {row.waiting > 0 ? <span className="font-medium text-warning-fg">{row.waiting} esperando</span> : <span className="text-muted">ninguém esperando</span>}
                    <p className="text-xs text-muted">{row.open} aberta(s)</p>
                  </TableCell>
                  {canEdit ? (
                    <TableCell>
                      <Button size="icon" variant="ghost" aria-label={`Editar ${row.queue.name}`} onClick={() => setDraft(draftOf(row))}>
                        <Pencil />
                      </Button>
                    </TableCell>
                  ) : null}
                </TableRow>
              );
            })}
          </TableBody>
        </Table>
      </div>

      <Dialog open={Boolean(draft)} onOpenChange={(v) => (!v ? setDraft(null) : null)}>
        <DialogContent size="lg">
          <DialogHeader>
            <DialogTitle>{draft?.id ? `Editar fila · ${draft.name}` : "Nova fila"}</DialogTitle>
            <DialogDescription>Mudanças valem para as próximas conversas; as que já estão com alguém continuam com essa pessoa.</DialogDescription>
          </DialogHeader>
          {draft ? (
            <DialogBody className="flex flex-col gap-4">
              <div className="grid gap-3 sm:grid-cols-2">
                <FormField label="Nome" htmlFor="q-name" required>
                  <Input id="q-name" value={draft.name} onChange={(e) => set("name", e.target.value)} />
                </FormField>
                <FormField label="Departamento" htmlFor="q-dep">
                  <Select id="q-dep" value={draft.department} onChange={(e) => set("department", e.target.value as DepartmentKey)} options={DEPARTMENT_KEYS.map((d) => ({ value: d, label: DEPARTMENT_LABELS[d] }))} />
                </FormField>
                <FormField label="Distribuição" htmlFor="q-strategy">
                  <Select id="q-strategy" value={draft.strategy} onChange={(e) => set("strategy", e.target.value as QueueStrategy)} options={QUEUE_STRATEGIES.map((s) => ({ value: s, label: QUEUE_STRATEGY_LABELS[s] }))} />
                </FormField>
                <FormField label="Conversas simultâneas por operador" htmlFor="q-max">
                  <Input id="q-max" type="number" inputMode="numeric" min={1} max={30} value={draft.maxConcurrent} onChange={(e) => set("maxConcurrent", e.target.value)} />
                </FormField>
                <FormField label="Regra de SLA" htmlFor="q-sla" hint="Regras cadastradas em Administração › Configurações › SLA (conversa ou chamado).">
                  <Select id="q-sla" value={draft.slaRuleKey} onChange={(e) => set("slaRuleKey", e.target.value)} options={[{ value: "", label: "Sem SLA" }, ...data.slaRules.map((r) => ({ value: r.key, label: `${r.name} (${r.key})` }))]} />
                </FormField>
                <FormField label="Sem operador disponível" htmlFor="q-overflow">
                  <Select
                    id="q-overflow"
                    value={draft.overflowQueueId}
                    onChange={(e) => set("overflowQueueId", e.target.value)}
                    options={[{ value: "", label: "Esperar nesta fila" }, ...data.rows.filter((r) => r.queue.id !== draft.id && r.queue.active).map((r) => ({ value: r.queue.id, label: `Transbordar para ${r.queue.name}` }))]}
                  />
                </FormField>
                {draft.overflowQueueId ? (
                  <FormField label="Transbordar depois de (min)" htmlFor="q-overflow-min" hint="O transbordo automático começa a valer com o agendador da próxima entrega.">
                    <Input id="q-overflow-min" type="number" inputMode="numeric" min={1} max={480} value={draft.overflowAfterMinutes} onChange={(e) => set("overflowAfterMinutes", e.target.value)} />
                  </FormField>
                ) : null}
              </div>
              <fieldset className="flex flex-wrap gap-4 text-sm">
                <legend className="mb-1 text-xs text-muted">Canais</legend>
                {CONVERSATION_CHANNELS.map((ch) => (
                  <Checkbox key={ch} checked={draft.channels.includes(ch)} onCheckedChange={() => set("channels", toggle(draft.channels, ch))} label={CHANNEL_LABELS[ch]} />
                ))}
              </fieldset>
              <fieldset>
                <legend className="mb-2 text-xs text-muted">Operadores ({draft.memberIds.length})</legend>
                <div className="grid max-h-56 gap-1.5 overflow-y-auto rounded-lg border border-border p-2 sm:grid-cols-2">
                  {data.users.map((u) => (
                    <Checkbox
                      key={u.id}
                      checked={draft.memberIds.includes(u.id)}
                      onCheckedChange={() => set("memberIds", toggle(draft.memberIds, u.id))}
                      label={
                        <span>
                          {u.name} <span className="text-xs text-muted">· {DEPARTMENT_LABELS[u.departmentId]}</span>
                        </span>
                      }
                    />
                  ))}
                </div>
              </fieldset>
              <div className="flex flex-wrap gap-6">
                <Switch checked={draft.isDefault} onCheckedChange={(v) => set("isDefault", v)} label="Fila padrão (quando nada mais se aplica)" />
                <Switch checked={draft.active} onCheckedChange={(v) => set("active", v)} label="Ativa" />
              </div>
            </DialogBody>
          ) : null}
          <DialogFooter>
            <Button variant="ghost" onClick={() => setDraft(null)} disabled={pending}>
              Cancelar
            </Button>
            <Button onClick={save} loading={pending} disabled={!draft || draft.name.trim().length < 2 || draft.channels.length === 0}>
              Salvar fila
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}

