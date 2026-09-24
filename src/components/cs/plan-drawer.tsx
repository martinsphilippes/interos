"use client";

import * as React from "react";
import Link from "next/link";
import { ExternalLink, Pencil, Plus, Trash2 } from "lucide-react";
import type { SuccessPlanWithTasks } from "@/server/cs/service";
import type { UserLite } from "@/server/cs/queries";
import { closePlan, saveSuccessPlan, togglePlanAction } from "@/server/cs/actions";
import { SUCCESS_PLAN_ORIGIN_LABELS, SUCCESS_PLAN_STATUS_LABELS, SUCCESS_PLAN_STATUS_VARIANT } from "@/server/cs/schemas";
import { formatDate } from "@/lib/format";
import { cn } from "@/lib/utils";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { DateInput, dateValueToIso, isoToDateValue } from "@/components/ui/date-input";
import { Drawer, DrawerBody, DrawerContent, DrawerDescription, DrawerFooter, DrawerHeader, DrawerTitle } from "@/components/ui/drawer";
import { FormField } from "@/components/ui/form-field";
import { Input } from "@/components/ui/input";
import { Progress } from "@/components/ui/progress";
import { Select } from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import { ClientCombobox } from "@/components/tasks/client-combobox";
import { useCsAction, useCsUrl } from "./use-cs";
import { RelativeTime } from "@/components/ui/relative-time";

type Plan = SuccessPlanWithTasks;

export interface PlanDrawerProps {
  /** Plano aberto (?plano=<id>). */
  plan: Plan | null;
  clientName?: string;
  /** Criação (?novo=1, opcionalmente &cliente=<id>). */
  creating: boolean;
  initialClientId?: string;
  users: UserLite[];
  clients: { id: string; tradeName: string }[];
  currentUserId: string;
}

interface ActionDraft {
  id?: string;
  description: string;
  responsibleId: string;
  dueAt: string;
}

const inDays = (n: number) => isoToDateValue(new Date(Date.now() + n * 86_400_000).toISOString());
/** Prazo no fim do expediente (18h) do dia escolhido. */
const toIso = (value: string) => dateValueToIso(value ? `${value}T18:00` : "") ?? "";

function PlanEditor({ plan, initialClientId, users, clients, currentUserId, onDone }: { plan: Plan | null; initialClientId?: string; users: UserLite[]; clients: PlanDrawerProps["clients"]; currentUserId: string; onDone: (id?: string) => void }) {
  const { pending, run } = useCsAction();
  const [clientId, setClientId] = React.useState<string | undefined>(plan?.clientId ?? initialClientId);
  const [ownerId, setOwnerId] = React.useState(plan?.ownerId ?? currentUserId);
  const [objective, setObjective] = React.useState(plan?.objective ?? "");
  const [checkpointAt, setCheckpointAt] = React.useState(plan?.checkpointAt ? isoToDateValue(plan.checkpointAt) : inDays(30));
  const [actions, setActions] = React.useState<ActionDraft[]>(
    plan ? plan.actions.map((a) => ({ id: a.id, description: a.description, responsibleId: a.responsibleId, dueAt: isoToDateValue(a.dueAt) })) : [{ description: "", responsibleId: currentUserId, dueAt: inDays(7) }],
  );
  const id = React.useId();
  const userOptions = users.map((u) => ({ value: u.id, label: u.name }));
  const csOptions = users.filter((u) => u.departmentId === "cs" || u.id === ownerId).map((u) => ({ value: u.id, label: u.name }));
  const doneIds = new Set((plan?.actions ?? []).filter((a) => a.done).map((a) => a.id));

  const setAction = (i: number, patch: Partial<ActionDraft>) => setActions((prev) => prev.map((a, idx) => (idx === i ? { ...a, ...patch } : a)));

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    await run(
      () =>
        saveSuccessPlan({
          id: plan?.id,
          clientId: clientId ?? "",
          ownerId,
          objective,
          checkpointAt: checkpointAt ? toIso(checkpointAt) : undefined,
          actions: actions.map((a) => ({ id: a.id, description: a.description, responsibleId: a.responsibleId, dueAt: toIso(a.dueAt) })),
        }),
      plan ? "Plano atualizado" : "Plano criado · ações viraram tarefas",
      (data) => onDone(data.id),
    );
  };

  return (
    <form onSubmit={submit} className="flex min-h-0 flex-1 flex-col">
      <DrawerHeader>
        <DrawerTitle>{plan ? "Editar plano de sucesso" : "Novo plano de sucesso"}</DrawerTitle>
        <DrawerDescription>Cada ação vira uma tarefa real para o responsável; concluir a tarefa marca a ação no plano.</DrawerDescription>
      </DrawerHeader>
      <DrawerBody className="flex flex-col gap-4">
        <FormField label="Cliente" htmlFor={`${id}-client`} required>
          <ClientCombobox id={`${id}-client`} clients={clients.map((c) => ({ ...c, status: "ativo" }))} value={clientId} onChange={setClientId} placeholder="Selecione o cliente" disabled={Boolean(plan)} />
        </FormField>
        <FormField label="Objetivo" htmlFor={`${id}-objective`} required>
          <Textarea id={`${id}-objective`} value={objective} onChange={(e) => setObjective(e.target.value)} className="min-h-[64px]" placeholder="Ex.: recuperar a adoção do módulo de estoque em 30 dias" required minLength={5} />
        </FormField>
        <div className="grid gap-4 sm:grid-cols-2">
          <FormField label="Responsável" htmlFor={`${id}-owner`} required>
            <Select id={`${id}-owner`} value={ownerId} onChange={(e) => setOwnerId(e.target.value)} options={csOptions.length > 0 ? csOptions : userOptions} />
          </FormField>
          <FormField label="Checkpoint do plano" htmlFor={`${id}-checkpoint`}>
            <DateInput id={`${id}-checkpoint`} value={checkpointAt} onChange={(e) => setCheckpointAt(e.target.value)} />
          </FormField>
        </div>
        <fieldset className="flex flex-col gap-3">
          <legend className="mb-1 text-[13px] font-medium">Ações</legend>
          {actions.map((a, i) => {
            const done = a.id ? doneIds.has(a.id) : false;
            return (
              <div key={a.id ?? `new-${i}`} className={cn("grid gap-2 rounded-md border border-border p-3 sm:grid-cols-[1fr_180px_150px_auto]", done && "bg-surface-muted")}>
                <Input aria-label={`Descrição da ação ${i + 1}`} value={a.description} onChange={(e) => setAction(i, { description: e.target.value })} placeholder="Descrição da ação" required minLength={3} disabled={done} />
                <Select aria-label={`Responsável da ação ${i + 1}`} value={a.responsibleId} onChange={(e) => setAction(i, { responsibleId: e.target.value })} options={userOptions} disabled={done} />
                <DateInput aria-label={`Prazo da ação ${i + 1}`} value={a.dueAt} onChange={(e) => setAction(i, { dueAt: e.target.value })} required disabled={done} />
                <Button type="button" variant="ghost" size="icon" className="size-11 md:size-9" aria-label={`Remover ação ${i + 1}`} disabled={actions.length === 1 || done} onClick={() => setActions((prev) => prev.filter((_, idx) => idx !== i))}>
                  <Trash2 />
                </Button>
              </div>
            );
          })}
          <Button type="button" variant="outline" size="sm" className="self-start" onClick={() => setActions((prev) => [...prev, { description: "", responsibleId: ownerId, dueAt: inDays(7) }])} disabled={actions.length >= 20}>
            <Plus /> Adicionar ação
          </Button>
        </fieldset>
      </DrawerBody>
      <DrawerFooter>
        <Button variant="outline" onClick={() => onDone()} disabled={pending}>
          Cancelar
        </Button>
        <Button type="submit" loading={pending}>
          {plan ? "Salvar plano" : "Criar plano"}
        </Button>
      </DrawerFooter>
    </form>
  );
}

function PlanDetail({ plan, clientName, users, onEdit }: { plan: Plan; clientName?: string; users: UserLite[]; onEdit: () => void }) {
  const { pending, run } = useCsAction();
  const [closeStatus, setCloseStatus] = React.useState<"concluido" | "cancelado">("concluido");
  const [result, setResult] = React.useState("");
  const userName = (uid: string) => users.find((u) => u.id === uid)?.name ?? uid;
  const done = plan.actions.filter((a) => a.done).length;
  const now = new Date().toISOString();
  const active = plan.status === "ativo";
  const id = React.useId();

  return (
    <>
      <DrawerHeader>
        <div className="flex flex-wrap items-center gap-2">
          <Badge variant={SUCCESS_PLAN_STATUS_VARIANT[plan.status]} size="sm">
            {SUCCESS_PLAN_STATUS_LABELS[plan.status]}
          </Badge>
          <Badge variant="outline" size="sm">
            {SUCCESS_PLAN_ORIGIN_LABELS[plan.origin]}
          </Badge>
        </div>
        <DrawerTitle>{plan.objective}</DrawerTitle>
        <DrawerDescription>
          <Link href={`/clientes/${plan.clientId}?aba=cs`} className="hover:underline">
            {clientName ?? plan.clientId}
          </Link>{" "}
          · responsável {userName(plan.ownerId)} · criado <RelativeTime value={plan.createdAt} />
          {plan.checkpointAt ? ` · checkpoint ${formatDate(plan.checkpointAt)}` : ""}
        </DrawerDescription>
      </DrawerHeader>
      <DrawerBody className="flex flex-col gap-5">
        <div>
          <div className="mb-1 flex justify-between text-sm">
            <span className="font-medium">Ações concluídas</span>
            <span className="tabular-nums text-muted">
              {done}/{plan.actions.length}
            </span>
          </div>
          <Progress value={plan.actions.length ? (done / plan.actions.length) * 100 : 0} tone="success" />
        </div>
        <ul className="flex flex-col gap-2">
          {plan.actions.map((a) => (
            <li key={a.id} className="flex items-start gap-3 rounded-md border border-border p-3">
              <Checkbox
                checked={a.done}
                disabled={!active || pending}
                aria-label={`${a.done ? "Reabrir" : "Concluir"} ação: ${a.description}`}
                onCheckedChange={(v) => run(() => togglePlanAction({ planId: plan.id, actionId: a.id, done: v === true }), v === true ? "Ação concluída" : "Ação reaberta")}
                className="mt-0.5 size-5"
              />
              <div className="min-w-0 flex-1">
                <p className={cn("text-sm", a.done && "text-muted line-through")}>{a.description}</p>
                <p className={cn("text-xs text-muted", !a.done && a.dueAt < now && "font-medium text-danger-fg")}>
                  {userName(a.responsibleId)} · {a.done ? `feito ${formatDate(a.doneAt)}` : `até ${formatDate(a.dueAt)}${a.dueAt < now ? " (atrasada)" : ""}`}
                </p>
              </div>
              {a.taskId ? (
                <Button asChild variant="ghost" size="icon" className="size-11 md:size-8" title="Abrir tarefa">
                  <Link href={`/tarefas?tarefa=${a.taskId}`} aria-label={`Abrir tarefa da ação ${a.description}`}>
                    <ExternalLink />
                  </Link>
                </Button>
              ) : null}
            </li>
          ))}
        </ul>
        {plan.result ? (
          <div className="rounded-md bg-surface-muted p-3 text-sm">
            <p className="label-caps mb-1">Resultado</p>
            {plan.result}
          </div>
        ) : null}
        {active ? (
          <form
            className="flex flex-col gap-3 rounded-md border border-border p-3"
            onSubmit={async (e) => {
              e.preventDefault();
              await run(() => closePlan({ planId: plan.id, status: closeStatus, result }), closeStatus === "concluido" ? "Plano concluído" : "Plano cancelado", () => setResult(""));
            }}
          >
            <p className="text-sm font-medium">Encerrar plano</p>
            <div className="grid gap-3 sm:grid-cols-[180px_1fr]">
              <Select aria-label="Como encerrar" value={closeStatus} onChange={(e) => setCloseStatus(e.target.value as "concluido" | "cancelado")} options={[{ value: "concluido", label: "Concluído" }, { value: "cancelado", label: "Cancelado" }]} />
              <FormField htmlFor={`${id}-result`}>
                <Textarea id={`${id}-result`} value={result} onChange={(e) => setResult(e.target.value)} className="min-h-[64px]" placeholder="Resultado alcançado (obrigatório)" required minLength={3} />
              </FormField>
            </div>
            <Button type="submit" variant="secondary" size="sm" loading={pending} className="self-end">
              Encerrar
            </Button>
          </form>
        ) : null}
      </DrawerBody>
      {active ? (
        <DrawerFooter>
          <Button variant="outline" onClick={onEdit}>
            <Pencil /> Editar plano
          </Button>
        </DrawerFooter>
      ) : null}
    </>
  );
}

/** Drawer do plano de sucesso: detalhe (?plano=<id>) ou criação (?novo=1). */
export function PlanDrawer({ plan, clientName, creating, initialClientId, users, clients, currentUserId }: PlanDrawerProps) {
  const { navigate } = useCsUrl();
  const [editing, setEditing] = React.useState(false);
  const open = creating || Boolean(plan);
  const close = () => {
    setEditing(false);
    navigate({ plano: null, novo: null, cliente: null });
  };
  return (
    <Drawer open={open} onOpenChange={(next) => !next && close()}>
      <DrawerContent size="lg">
        {creating || (plan && editing) ? (
          <PlanEditor
            key={plan?.id ?? "novo"}
            plan={creating ? null : plan}
            initialClientId={initialClientId}
            users={users}
            clients={clients}
            currentUserId={currentUserId}
            onDone={(savedId) => {
              setEditing(false);
              if (savedId) navigate({ plano: savedId, novo: null, cliente: null });
              else if (creating) close();
            }}
          />
        ) : plan ? (
          <PlanDetail plan={plan} clientName={clientName} users={users} onEdit={() => setEditing(true)} />
        ) : null}
      </DrawerContent>
    </Drawer>
  );
}
