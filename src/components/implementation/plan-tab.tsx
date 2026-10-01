"use client";

import * as React from "react";
import { CheckCircle2, ChevronDown, Circle, Link2, Plus, RotateCcw } from "lucide-react";
import { IMPLEMENTATION_PHASES, type ImplementationPhase, type ImplementationTask } from "@/domain/types";
import { TASK_STATUS_LABELS } from "@/domain/constants";
import { addProjectTask, assignProjectTask, completeProjectTask, reopenProjectTask } from "@/server/implementation/actions";
import { formatDate } from "@/lib/format";
import { cn } from "@/lib/utils";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { DateInput, dateValueToIso } from "@/components/ui/date-input";
import { Dialog, DialogBody, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { EmptyState } from "@/components/ui/empty-state";
import { FormField } from "@/components/ui/form-field";
import { Input } from "@/components/ui/input";
import { Select } from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import { IMPLEMENTATION_PHASE_LABELS } from "@/components/clients/labels";
import { useImplementationAction } from "./use-implementation-action";

export interface PlanTabProps {
  projectId: string;
  tasks: ImplementationTask[];
  currentPhase: ImplementationPhase;
  users: { id: string; name: string }[];
  ownerId: string;
  /** Ações do plano permitidas ao usuário (calculadas no servidor pelo catálogo; as actions revalidam). */
  permissions: PlanPermissions;
  /** Projeto concluído ou cancelado: plano só leitura. */
  readOnly: boolean;
  now: string;
}

export interface PlanPermissions {
  /** Adicionar tarefa avulsa. */
  add: boolean;
  /** Concluir tarefa. */
  complete: boolean;
  /** Reabrir tarefa concluída. */
  reopen: boolean;
  /** Atribuir responsável da tarefa. */
  assign: boolean;
}

const STATUS_VARIANT: Record<ImplementationTask["status"], "success" | "info" | "warning" | "muted" | "danger"> = {
  concluida: "success",
  em_andamento: "info",
  aguardando: "warning",
  aberta: "muted",
  cancelada: "danger",
};

/**
 * Plano do projeto: fases em accordion com as tarefas (responsável, prazo, status, obrigatória,
 * dependências, evidência). Concluir todas as obrigatórias de uma fase avança a fase automaticamente.
 *
 * O accordion é controlado pelo React (botão + conteúdo condicional), não um `<details>` nativo: o `<details>`
 * pode ser aberto/fechado pelo navegador antes da hidratação terminar, e o atributo `open` divergia da prop
 * (aviso "some attributes of the server rendered HTML didn't match"). Cliques feitos antes da hidratação são
 * repetidos pelo React ao hidratar.
 */
export function PlanTab({ projectId, tasks, currentPhase, users, ownerId, permissions, readOnly, now }: PlanTabProps) {
  const [completing, setCompleting] = React.useState<ImplementationTask | null>(null);
  const [adding, setAdding] = React.useState(false);
  const phases = IMPLEMENTATION_PHASES.filter((ph) => ph === currentPhase || tasks.some((t) => t.phase === ph));
  const currentIdx = IMPLEMENTATION_PHASES.indexOf(currentPhase);
  const titles = new Map(tasks.map((t) => [t.id, t.title]));
  // Projeto encerrado: nada editável, qualquer que seja a permissão.
  const allowed: PlanPermissions = readOnly ? { add: false, complete: false, reopen: false, assign: false } : permissions;
  // Fases abertas: a fase atual começa aberta; o usuário abre/fecha as outras (estado por fase, reinicia se a fase mudar).
  const [openPhases, setOpenPhases] = React.useState<Record<string, boolean>>({});
  const isOpen = (ph: ImplementationPhase) => openPhases[ph] ?? ph === currentPhase;
  const toggle = (ph: ImplementationPhase) => setOpenPhases((cur) => ({ ...cur, [ph]: !isOpen(ph) }));

  return (
    <div className="flex flex-col gap-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <p className="text-sm text-muted">
          {tasks.filter((t) => t.status === "concluida").length}/{tasks.length} tarefas concluídas · {tasks.filter((t) => t.required && t.status !== "concluida" && t.status !== "cancelada").length} obrigatória(s) em aberto. Tarefas da fase Go-live
          são concluídas na aprovação do go-live.
        </p>
        {allowed.add ? (
          <Button variant="outline" className="h-11 md:h-9" onClick={() => setAdding(true)}>
            <Plus /> Tarefa avulsa
          </Button>
        ) : null}
      </div>
      {phases.length === 0 ? <EmptyState size="sm" title="Plano vazio" description="Nenhuma tarefa gerada pelos templates dos produtos. Adicione tarefas avulsas." /> : null}
      {phases.map((ph) => {
        const phaseTasks = tasks.filter((t) => t.phase === ph);
        const done = phaseTasks.filter((t) => t.status === "concluida").length;
        const requiredOpen = phaseTasks.filter((t) => t.required && t.status !== "concluida" && t.status !== "cancelada").length;
        const isCurrent = ph === currentPhase;
        const past = IMPLEMENTATION_PHASES.indexOf(ph) < currentIdx;
        const open = isOpen(ph);
        const panelId = `plano-fase-${ph}`;
        return (
          <section key={ph} data-phase={ph} data-open={open ? "true" : "false"} className="rounded-lg border border-border bg-surface">
            <button
              type="button"
              aria-expanded={open}
              aria-controls={open ? panelId : undefined}
              onClick={() => toggle(ph)}
              className="flex min-h-[48px] w-full cursor-pointer items-center gap-2 px-4 text-left text-sm focus-visible:outline-brand"
            >
              {phaseTasks.length > 0 && done === phaseTasks.length ? <CheckCircle2 className="size-4 shrink-0 text-success" aria-hidden /> : <Circle className={cn("size-4 shrink-0", isCurrent ? "text-brand" : "text-muted-light")} aria-hidden />}
              <span className={cn("font-medium", past && "text-muted")}>{IMPLEMENTATION_PHASE_LABELS[ph]}</span>
              {isCurrent ? (
                <Badge variant="brand" size="sm">
                  Fase atual
                </Badge>
              ) : null}
              {requiredOpen > 0 ? <span className="text-xs text-warning-fg">{requiredOpen} obrigatória(s) pendente(s)</span> : null}
              <span className="ml-auto flex shrink-0 items-center gap-2 text-xs tabular-nums text-muted">
                {done}/{phaseTasks.length}
                <ChevronDown className={cn("size-4 transition-transform", open && "rotate-180")} aria-hidden />
              </span>
            </button>
            {open ? (
              <div id={panelId}>
                {phaseTasks.length === 0 ? (
                  <p className="border-t border-border px-4 py-3 text-sm text-muted">Sem tarefas nesta fase.</p>
                ) : (
                  <ul className="divide-y divide-border border-t border-border">
                    {phaseTasks.map((t) => (
                      <TaskRow key={t.id} task={t} users={users} titles={titles} allowed={allowed} now={now} onComplete={() => setCompleting(t)} />
                    ))}
                  </ul>
                )}
              </div>
            ) : null}
          </section>
        );
      })}
      {completing ? <CompleteTaskDialog task={completing} onClose={() => setCompleting(null)} /> : null}
      {adding ? <AddTaskDialog projectId={projectId} tasks={tasks} users={users} defaultPhase={currentPhase} defaultAssigneeId={ownerId} onClose={() => setAdding(false)} /> : null}
    </div>
  );
}

function TaskRow({ task, users, titles, allowed, now, onComplete }: { task: ImplementationTask; users: { id: string; name: string }[]; titles: Map<string, string>; allowed: PlanPermissions; now: string; onComplete: () => void }) {
  const { pending, run } = useImplementationAction();
  const done = task.status === "concluida";
  const overdue = !done && task.dueAt && task.dueAt < now;
  const deps = (task.dependsOn ?? []).map((id) => titles.get(id) ?? "tarefa removida");
  return (
    <li className="flex flex-col gap-2 px-4 py-3 md:flex-row md:items-center md:gap-3">
      <div className="min-w-0 flex-1">
        <p className={cn("text-sm", done && "text-muted line-through")}>
          {task.title}
          {task.required ? null : <span className="ml-1 text-xs text-muted-light no-underline">(opcional)</span>}
        </p>
        {task.description ? <p className="text-xs text-muted">{task.description}</p> : null}
        <div className="mt-1 flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-muted">
          <Badge variant={STATUS_VARIANT[task.status]} size="sm">
            {TASK_STATUS_LABELS[task.status]}
          </Badge>
          {task.required ? <span className="font-medium text-foreground">Obrigatória</span> : null}
          {task.dueAt ? <span className={cn(overdue && "font-medium text-danger-fg")}>Prazo {formatDate(task.dueAt)}</span> : null}
          {done && task.completedAt ? <span>Concluída {formatDate(task.completedAt)}</span> : null}
          {deps.length > 0 ? (
            <span className="inline-flex items-center gap-1">
              <Link2 className="size-3" aria-hidden /> Depende de: {deps.join(", ")}
            </span>
          ) : null}
          {task.evidence ? <span>Evidência: {task.evidence}</span> : null}
        </div>
      </div>
      <div className="flex shrink-0 flex-wrap items-center gap-2">
        {allowed.assign ? (
          <Select
            aria-label={`Responsável por ${task.title}`}
            value={task.assigneeId ?? ""}
            size="sm"
            disabled={pending}
            onChange={(e) => e.target.value && run(() => assignProjectTask({ taskId: task.id, assigneeId: e.target.value }), "Responsável atualizado")}
            className="w-[180px] [&_select]:h-11 md:[&_select]:h-8"
          >
            <option value="" disabled>
              Sem responsável
            </option>
            {users.map((u) => (
              <option key={u.id} value={u.id}>
                {u.name}
              </option>
            ))}
          </Select>
        ) : (
          <span className="text-xs text-muted">{users.find((u) => u.id === task.assigneeId)?.name ?? "Sem responsável"}</span>
        )}
        {allowed.complete && !done && task.status !== "cancelada" ? (
          <Button size="sm" className="h-11 md:h-8" onClick={onComplete} disabled={pending}>
            <CheckCircle2 /> Concluir
          </Button>
        ) : null}
        {allowed.reopen && done ? (
          <Button size="sm" variant="ghost" className="h-11 md:h-8" loading={pending} onClick={() => run(() => reopenProjectTask({ taskId: task.id }), "Tarefa reaberta")}>
            <RotateCcw /> Reabrir
          </Button>
        ) : null}
      </div>
    </li>
  );
}

function CompleteTaskDialog({ task, onClose }: { task: ImplementationTask; onClose: () => void }) {
  const { pending, run } = useImplementationAction();
  const [evidence, setEvidence] = React.useState("");
  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (await run(() => completeProjectTask({ taskId: task.id, evidence }), "Tarefa concluída")) onClose();
  };
  return (
    <Dialog open onOpenChange={(v) => !v && !pending && onClose()}>
      <DialogContent>
        <form onSubmit={submit} className="flex min-h-0 flex-col">
          <DialogHeader>
            <DialogTitle>Concluir tarefa</DialogTitle>
            <DialogDescription>{task.title}</DialogDescription>
          </DialogHeader>
          <DialogBody>
            <FormField label="Evidência (opcional)" htmlFor="task-evidence" hint="Ex.: print, link do registro, número da nota emitida">
              <Textarea id="task-evidence" value={evidence} onChange={(e) => setEvidence(e.target.value)} maxLength={1000} className="min-h-[72px]" />
            </FormField>
          </DialogBody>
          <DialogFooter>
            <Button variant="outline" onClick={onClose} disabled={pending}>
              Cancelar
            </Button>
            <Button type="submit" loading={pending}>
              Concluir tarefa
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

function AddTaskDialog({ projectId, tasks, users, defaultPhase, defaultAssigneeId, onClose }: { projectId: string; tasks: ImplementationTask[]; users: { id: string; name: string }[]; defaultPhase: ImplementationPhase; defaultAssigneeId: string; onClose: () => void }) {
  const { pending, run } = useImplementationAction();
  const [phase, setPhase] = React.useState<ImplementationPhase>(defaultPhase);
  const [title, setTitle] = React.useState("");
  const [description, setDescription] = React.useState("");
  const [assigneeId, setAssigneeId] = React.useState(defaultAssigneeId);
  const [dueAt, setDueAt] = React.useState("");
  const [required, setRequired] = React.useState(false);
  const [dependsOn, setDependsOn] = React.useState<string[]>([]);
  const openTasks = tasks.filter((t) => t.status !== "concluida" && t.status !== "cancelada");

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (await run(() => addProjectTask({ projectId, phase, title, description, assigneeId, dueAt: dateValueToIso(dueAt), required, dependsOn }), "Tarefa adicionada ao plano")) onClose();
  };
  return (
    <Dialog open onOpenChange={(v) => !v && !pending && onClose()}>
      <DialogContent size="lg">
        <form onSubmit={submit} className="flex min-h-0 flex-col">
          <DialogHeader>
            <DialogTitle>Nova tarefa no plano</DialogTitle>
            <DialogDescription>Tarefa avulsa, fora dos templates dos produtos.</DialogDescription>
          </DialogHeader>
          <DialogBody className="flex flex-col gap-4">
            <FormField label="Título" htmlFor="nt-title" required>
              <Input id="nt-title" value={title} onChange={(e) => setTitle(e.target.value)} required maxLength={160} />
            </FormField>
            <FormField label="Descrição" htmlFor="nt-desc">
              <Textarea id="nt-desc" value={description} onChange={(e) => setDescription(e.target.value)} className="min-h-[64px]" maxLength={1000} />
            </FormField>
            <div className="grid gap-4 sm:grid-cols-3">
              <FormField label="Fase" htmlFor="nt-phase" required>
                <Select id="nt-phase" value={phase} onChange={(e) => setPhase(e.target.value as ImplementationPhase)}>
                  {IMPLEMENTATION_PHASES.map((p) => (
                    <option key={p} value={p}>
                      {IMPLEMENTATION_PHASE_LABELS[p]}
                    </option>
                  ))}
                </Select>
              </FormField>
              <FormField label="Responsável" htmlFor="nt-assignee">
                <Select id="nt-assignee" value={assigneeId} onChange={(e) => setAssigneeId(e.target.value)}>
                  {users.map((u) => (
                    <option key={u.id} value={u.id}>
                      {u.name}
                    </option>
                  ))}
                </Select>
              </FormField>
              <FormField label="Prazo" htmlFor="nt-due">
                <DateInput id="nt-due" mode="date" value={dueAt} onChange={(e) => setDueAt(e.target.value)} />
              </FormField>
            </div>
            <Checkbox label="Obrigatória" description="Conta no progresso e bloqueia o avanço de fase e o go-live." checked={required} onCheckedChange={(v) => setRequired(v === true)} />
            {openTasks.length > 0 ? (
              <fieldset className="flex flex-col gap-1">
                <legend className="mb-1 text-[13px] font-medium">Depende de</legend>
                <div className="max-h-40 overflow-y-auto rounded-lg border border-border px-3 py-1 scrollbar-thin">
                  {openTasks.map((t) => (
                    <Checkbox
                      key={t.id}
                      label={t.title}
                      description={IMPLEMENTATION_PHASE_LABELS[t.phase]}
                      checked={dependsOn.includes(t.id)}
                      onCheckedChange={(v) => setDependsOn((cur) => (v === true ? [...cur, t.id] : cur.filter((id) => id !== t.id)))}
                    />
                  ))}
                </div>
              </fieldset>
            ) : null}
          </DialogBody>
          <DialogFooter>
            <Button variant="outline" onClick={onClose} disabled={pending}>
              Cancelar
            </Button>
            <Button type="submit" loading={pending}>
              Adicionar
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
