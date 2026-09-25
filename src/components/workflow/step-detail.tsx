"use client";

import * as React from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { Building2, CheckSquare, ExternalLink, GitBranch, History, Hourglass, ListChecks, MessageSquare, Play, Settings2 } from "lucide-react";
import { DEPARTMENT_LABELS, PRIORITY_LABELS, TASK_STATUS_LABELS } from "@/domain/constants";
import { Avatar } from "@/components/ui/avatar";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Select } from "@/components/ui/select";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Textarea } from "@/components/ui/textarea";
import { toast } from "@/components/ui/toast";
import { cn } from "@/lib/utils";
import { addStepNoteAction, reassignStepAction, resumeStepAction, setWaitingClientAction } from "@/server/workflow/actions";
import { GatePanel } from "./gate-panel";
import { DepartmentBadge, SlaCountdown, StepStatusBadge } from "./step-bits";
import { clientHref, instanceHref, taskHref, type AssignableUserOption, type StepDetail as StepDetailData } from "./workflow-model";

export type StepTab = "gate" | "tarefas" | "historico" | "acoes";

export interface StepDetailProps {
  detail: StepDetailData;
  users: AssignableUserOption[];
  currentUserId: string;
  /** "drawer" (em /workflow) ou "page" (em /workflow/[instanceId]). */
  variant?: "drawer" | "page";
  onCompleted?: (nextStepId: string | undefined, instanceCompleted: boolean) => void;
  className?: string;
}

/** Corpo do detalhe de uma etapa: cabeçalho + abas Gate / Tarefas / Histórico / Ações. */
export function StepDetail({ detail, users, currentUserId, variant = "drawer", onCompleted, className }: StepDetailProps) {
  const router = useRouter();
  const { step, stage, sla, tasks, events, notes, instance } = detail;
  const [pending, startTransition] = React.useTransition();
  const [tab, setTab] = React.useState<StepTab>("gate");
  const [waitingReason, setWaitingReason] = React.useState("");
  const [note, setNote] = React.useState("");
  const isOpen = step.status === "em_andamento" || step.status === "aguardando_cliente" || step.status === "aguardando_aprovacao";
  const assignee = users.find((u) => u.id === step.assigneeId);

  const run = (action: () => Promise<{ ok: true; data: unknown } | { ok: false; error: string }>, successMessage?: string, after?: () => void) =>
    startTransition(async () => {
      const result = await action();
      if (!result.ok) {
        toast.error(result.error);
        return;
      }
      if (successMessage) toast.success(successMessage);
      after?.();
      router.refresh();
    });

  return (
    <div className={cn("flex flex-col gap-4", className)}>
      {/* Cabeçalho */}
      <header className="flex flex-col gap-2">
        <div className="flex flex-wrap items-center gap-2">
          <StepStatusBadge status={step.status} />
          <DepartmentBadge department={step.department} />
          {sla ? <SlaCountdown state={sla.state} dueAt={step.dueAt} remainingMs={sla.remainingMs} /> : <Badge variant="muted" size="sm">Sem SLA</Badge>}
          {instance.templateVersion ? <Badge variant="muted" size="sm">Template v{instance.templateVersion}</Badge> : null}
        </div>
        <div className="flex flex-col gap-0.5">
          <h2 className="text-lg font-semibold leading-tight tracking-tight">
            {stage.name} · {detail.client.tradeName}
          </h2>
          <p className="flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-muted">
            <Link href={clientHref(detail.client.id)} className="inline-flex items-center gap-1 text-secondary hover:underline">
              <Building2 className="size-3.5" /> Ficha do cliente
            </Link>
            {variant === "drawer" ? (
              <Link href={instanceHref(instance.id)} className="inline-flex items-center gap-1 text-secondary hover:underline">
                <GitBranch className="size-3.5" /> Jornada completa
              </Link>
            ) : null}
            {detail.startedAtLabel ? <span>Início: {detail.startedAtLabel}</span> : null}
            {detail.dueAtLabel ? <span>Prazo: {detail.dueAtLabel}</span> : null}
          </p>
        </div>
        <div className="flex flex-col gap-1.5 sm:max-w-sm">
          <Label htmlFor={`step-assignee-${step.id}`}>Responsável</Label>
          <div className="flex items-center gap-2">
            <Avatar name={step.assigneeName ?? "?"} src={detail.assigneeAvatarUrl ?? assignee?.avatarUrl} size="sm" />
            {isOpen ? (
              <Select id={`step-assignee-${step.id}`} size="sm" value={step.assigneeId ?? ""} placeholder="Sem responsável" disabled={pending} onChange={(e) => e.target.value && run(() => reassignStepAction({ stepId: step.id, assigneeId: e.target.value }), "Responsável atualizado")}>
                {users
                  .filter((u) => u.departmentId === step.department || u.id === step.assigneeId || u.id === currentUserId)
                  .map((u) => (
                    <option key={u.id} value={u.id}>
                      {u.name}
                      {u.id === currentUserId ? " (eu)" : ""}
                      {u.departmentId !== step.department ? ` · ${DEPARTMENT_LABELS[u.departmentId]}` : ""}
                    </option>
                  ))}
                {step.assigneeId && !assignee ? <option value={step.assigneeId}>{step.assigneeName ?? "Usuário inativo"}</option> : null}
              </Select>
            ) : (
              <span className="text-sm">{step.assigneeName ?? "—"}</span>
            )}
          </div>
        </div>
        {step.waitingClient ? (
          <p className="flex items-start gap-2 rounded-md bg-warning-soft px-3 py-2 text-sm text-warning-fg">
            <Hourglass className="mt-0.5 size-4 shrink-0" /> Aguardando cliente: {step.waitingClient.reason}
          </p>
        ) : null}
        {step.notes ? <p className="rounded-md bg-surface-muted px-3 py-2 text-sm text-foreground">{step.notes}</p> : null}
      </header>

      <Tabs value={tab} onValueChange={(v) => setTab(v as StepTab)}>
        <TabsList className="w-full">
          <TabsTrigger value="gate">
            <ListChecks /> Gate
          </TabsTrigger>
          <TabsTrigger value="tarefas">
            <CheckSquare /> Tarefas {tasks.length > 0 ? <span className="rounded-full bg-surface-hover px-1.5 text-[11px] tabular-nums">{tasks.length}</span> : null}
          </TabsTrigger>
          <TabsTrigger value="historico">
            <History /> Histórico
          </TabsTrigger>
          <TabsTrigger value="acoes">
            <Settings2 /> Ações
          </TabsTrigger>
        </TabsList>

        <TabsContent value="gate">
          <GatePanel key={step.id} detail={detail} onCompleted={onCompleted} />
        </TabsContent>

        <TabsContent value="tarefas" className="flex flex-col gap-2">
          {tasks.length === 0 ? <p className="text-sm text-muted">Nenhuma tarefa vinculada a esta etapa.</p> : null}
          <ul className="flex flex-col gap-2">
            {tasks.map((t) => (
              <li key={t.id} className="flex items-center justify-between gap-3 rounded-lg border border-border px-3 py-2">
                <div className="min-w-0">
                  <p className={cn("truncate text-sm font-medium", t.status === "concluida" && "text-muted line-through")}>{t.title}</p>
                  <p className="text-xs text-muted">
                    {TASK_STATUS_LABELS[t.status]} · {PRIORITY_LABELS[t.priority]}
                    {t.assigneeName ? ` · ${t.assigneeName}` : ""}
                    {t.dueLabel ? ` · prazo ${t.dueLabel}` : ""}
                  </p>
                </div>
                <Button asChild variant="ghost" size="sm" className="shrink-0">
                  <Link href={taskHref(t.id)}>
                    Abrir <ExternalLink />
                  </Link>
                </Button>
              </li>
            ))}
          </ul>
        </TabsContent>

        <TabsContent value="historico" className="flex flex-col gap-5">
          <section className="flex flex-col gap-3">
            <h3 className="flex items-center gap-2 text-sm font-semibold">
              <MessageSquare className="size-4 text-muted" /> Notas {notes.length > 0 ? <span className="rounded-full bg-surface-hover px-2 py-0.5 text-xs font-medium text-muted">{notes.length}</span> : null}
            </h3>
            {notes.length === 0 ? <p className="text-sm text-muted">Nenhuma nota nesta etapa.</p> : null}
            <ul className="flex flex-col gap-3">
              {notes.map((n) => (
                <li key={n.id} className="flex gap-2.5">
                  <Avatar name={n.authorName} size="sm" className="mt-0.5" />
                  <div className="min-w-0 flex-1 rounded-lg bg-surface-muted px-3 py-2">
                    <div className="flex items-baseline justify-between gap-2">
                      <span className="text-sm font-medium">{n.authorName}</span>
                      <span className="shrink-0 text-[11px] text-muted">{n.createdAtLabel}</span>
                    </div>
                    <p className="mt-0.5 whitespace-pre-wrap text-sm">{n.body}</p>
                  </div>
                </li>
              ))}
            </ul>
            <form
              className="flex flex-col gap-2"
              onSubmit={(e) => {
                e.preventDefault();
                const body = note.trim();
                if (!body) return;
                run(() => addStepNoteAction({ stepId: step.id, note: body }), "Nota adicionada", () => setNote(""));
              }}
            >
              <Textarea value={note} onChange={(e) => setNote(e.target.value)} placeholder="Registrar uma nota nesta etapa…" aria-label="Nova nota" disabled={pending} className="min-h-[64px]" />
              <div className="flex justify-end">
                <Button type="submit" size="sm" variant="secondary" disabled={pending || !note.trim()}>
                  Adicionar nota
                </Button>
              </div>
            </form>
          </section>
          <section className="flex flex-col gap-2">
            <h3 className="flex items-center gap-2 text-sm font-semibold">
              <History className="size-4 text-muted" /> Eventos da etapa
            </h3>
            {events.length === 0 ? <p className="text-sm text-muted">Sem eventos registrados.</p> : null}
            <ol className="relative flex flex-col gap-3 border-l border-border pl-4">
              {events.map((e) => (
                <li key={e.id} className="relative">
                  <span className="absolute -left-[21px] top-1.5 size-2 rounded-full bg-border-strong" aria-hidden />
                  <p className="text-sm">{e.title}</p>
                  {e.description ? <p className="text-xs text-muted">{e.description}</p> : null}
                  <p className="text-[11px] text-muted-light">
                    {e.occurredAtLabel} · {e.actorName} · <code className="text-[10px]">{e.type}</code>
                  </p>
                </li>
              ))}
            </ol>
          </section>
        </TabsContent>

        <TabsContent value="acoes" className="flex flex-col gap-4">
          {!isOpen ? <p className="text-sm text-muted">Etapa encerrada: não há ações disponíveis.</p> : null}
          {step.status === "em_andamento" ? (
            <section className="flex flex-col gap-2 rounded-lg border border-border p-3">
              <h3 className="flex items-center gap-2 text-sm font-semibold">
                <Hourglass className="size-4 text-warning-fg" /> Aguardando cliente
              </h3>
              <p className="text-xs text-muted">Pausa o SLA da etapa enquanto a dependência é do cliente. O motivo fica registrado no histórico.</p>
              <Textarea value={waitingReason} onChange={(e) => setWaitingReason(e.target.value)} placeholder="Ex.: aguardando certificado digital do cliente" aria-label="Motivo" disabled={pending} className="min-h-[64px]" />
              <div className="flex justify-end">
                <Button variant="outline" size="sm" loading={pending} disabled={waitingReason.trim().length < 3} onClick={() => run(() => setWaitingClientAction({ stepId: step.id, reason: waitingReason.trim() }), "Etapa marcada como aguardando cliente", () => setWaitingReason(""))}>
                  <Hourglass /> Marcar aguardando cliente
                </Button>
              </div>
            </section>
          ) : null}
          {step.status === "aguardando_cliente" ? (
            <section className="flex flex-col gap-2 rounded-lg border border-border p-3">
              <h3 className="flex items-center gap-2 text-sm font-semibold">
                <Play className="size-4 text-success-fg" /> Retomar etapa
              </h3>
              <p className="text-xs text-muted">Retoma o SLA descontando o tempo pausado. Motivo da pausa: {step.waitingClient?.reason}</p>
              <div className="flex justify-end">
                <Button size="sm" loading={pending} onClick={() => run(() => resumeStepAction({ stepId: step.id }), "Etapa retomada")}>
                  <Play /> Retomar
                </Button>
              </div>
            </section>
          ) : null}
          {isOpen ? (
            <section className="flex flex-col gap-2 rounded-lg border border-border p-3">
              <h3 className="text-sm font-semibold">Reatribuir</h3>
              <p className="text-xs text-muted">Use o seletor de responsável no cabeçalho. O novo responsável recebe notificação e passa a ser o dono do SLA.</p>
            </section>
          ) : null}
        </TabsContent>
      </Tabs>
    </div>
  );
}
