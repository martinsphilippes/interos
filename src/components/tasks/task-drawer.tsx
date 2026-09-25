"use client";

import * as React from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { CheckCircle2, ExternalLink, GitBranch, History, MessageSquare, Plus, RotateCcw, ThumbsDown, ThumbsUp, Trash2, X, XCircle } from "lucide-react";
import { DEPARTMENT_KEYS, DEPARTMENT_LABELS, PRIORITIES, PRIORITY_LABELS, TASK_STATUS, TASK_STATUS_LABELS, type Priority, type TaskStatus, type DepartmentKey } from "@/domain/constants";
import type { ActionResult } from "@/domain/types";
import { Avatar } from "@/components/ui/avatar";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { ConfirmDialog } from "@/components/ui/confirm-dialog";
import { DateInput, dateValueToIso, isoToDateTimeLocal } from "@/components/ui/date-input";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Drawer, DrawerBody, DrawerContent, DrawerDescription, DrawerFooter, DrawerHeader, DrawerTitle } from "@/components/ui/drawer";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { PriorityBadge } from "@/components/ui/priority-badge";
import { Progress } from "@/components/ui/progress";
import { Select } from "@/components/ui/select";
import { SlaBadge } from "@/components/ui/sla-badge";
import { Textarea } from "@/components/ui/textarea";
import { toast } from "@/components/ui/toast";
import { cn } from "@/lib/utils";
import {
  addChecklistItem,
  addComment,
  assignTask,
  cancelTask,
  changeTaskStatus,
  completeTask,
  deleteTask,
  removeChecklistItem,
  reopenTask,
  toggleChecklistItem,
  updateTask,
} from "@/server/tasks/actions";
import { completeProcessTask } from "@/server/process-engine/actions";
import { ClientCombobox } from "./client-combobox";
import { ChecklistIndicator, DueLabel, RecurrenceHint, TaskStatusBadge } from "./task-bits";
import { ORIGIN_LABELS, PROCESS_TYPE_LABELS, clientHref, type AssignableUser, type ClientOption, type TaskDetail } from "./task-model";
import { useTaskUrl } from "./use-task-url";

export interface TaskDrawerProps {
  detail: TaskDetail | null;
  users: AssignableUser[];
  clients: ClientOption[];
  currentUserId: string;
  canDelete: boolean;
}

/**
 * Drawer de detalhe (?tarefa=<id>). Recebe tudo do servidor; cada edição chama uma Server Action
 * e faz router.refresh() para o servidor devolver o estado atualizado.
 */
export function TaskDrawer({ detail, users, clients, currentUserId, canDelete }: TaskDrawerProps) {
  const { navigate } = useTaskUrl();
  const close = () => navigate({ tarefa: null }, { replace: true });
  return (
    <Drawer open={Boolean(detail)} onOpenChange={(open) => !open && close()}>
      <DrawerContent size="lg">
        {detail ? <DrawerInner key={detail.task.id} detail={detail} users={users} clients={clients} currentUserId={currentUserId} canDelete={canDelete} onClose={close} /> : null}
      </DrawerContent>
    </Drawer>
  );
}

function DrawerInner({ detail, users, clients, currentUserId, canDelete, onClose }: TaskDrawerProps & { detail: TaskDetail; onClose: () => void }) {
  const router = useRouter();
  const { task, comments, events } = detail;
  const [pending, startTransition] = React.useTransition();
  const [title, setTitle] = React.useState(task.title);
  const [description, setDescription] = React.useState(task.description ?? "");
  const [tags, setTags] = React.useState(task.tags.join(", "));
  const [prevUpdatedAt, setPrevUpdatedAt] = React.useState(task.updatedAt);
  const [newItem, setNewItem] = React.useState("");
  const [comment, setComment] = React.useState("");
  const [confirm, setConfirm] = React.useState<"cancel" | "delete" | null>(null);
  const [askOutcome, setAskOutcome] = React.useState(false);
  const processContext = detail.processContext;

  // Quando o servidor devolve a tarefa atualizada, os rascunhos locais são realinhados.
  if (task.updatedAt !== prevUpdatedAt) {
    setPrevUpdatedAt(task.updatedAt);
    setTitle(task.title);
    setDescription(task.description ?? "");
    setTags(task.tags.join(", "));
  }

  const run = (action: () => Promise<ActionResult<unknown>>, successMessage?: string, after?: () => void) =>
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

  const patch = (fields: Record<string, unknown>, message?: string) => run(() => updateTask({ id: task.id, ...fields }), message);

  const saveTitle = () => {
    const next = title.trim();
    if (!next || next === task.title) {
      setTitle(task.title);
      return;
    }
    patch({ title: next }, "Título atualizado");
  };
  const saveDescription = () => {
    const next = description.trim();
    if (next === (task.description ?? "")) return;
    patch({ description: next || null }, "Descrição atualizada");
  };
  const saveTags = () => {
    const next = tags
      .split(",")
      .map((t) => t.trim())
      .filter(Boolean);
    if (next.join("|") === task.tags.join("|")) return;
    patch({ tags: next }, "Tags atualizadas");
  };

  const isOpen = task.status !== "concluida" && task.status !== "cancelada";
  const checklistPct = task.checklistTotal ? Math.round((task.checklistDone / task.checklistTotal) * 100) : 0;
  const assignee = users.find((u) => u.id === task.assigneeId);

  return (
    <>
      <DrawerHeader className="gap-2">
        <div className="flex flex-wrap items-center gap-2">
          <TaskStatusBadge status={task.status} />
          <PriorityBadge priority={task.priority} />
          {task.sla ? <SlaBadge state={task.sla.state} remainingMs={task.sla.remainingMs} /> : null}
          <Badge variant="muted" size="sm">
            {ORIGIN_LABELS[task.origin]}
          </Badge>
          <RecurrenceHint task={task} />
        </div>
        <DrawerTitle asChild>
          <h2 className="sr-only">{task.title}</h2>
        </DrawerTitle>
        <DrawerDescription className="sr-only">Detalhes da tarefa</DrawerDescription>
        <input
          value={title}
          onChange={(e) => setTitle(e.target.value)}
          onBlur={saveTitle}
          onKeyDown={(e) => {
            if (e.key === "Enter") (e.target as HTMLInputElement).blur();
            if (e.key === "Escape") setTitle(task.title);
          }}
          aria-label="Título da tarefa"
          disabled={pending}
          className="w-full rounded-md border border-transparent bg-transparent px-1 -mx-1 text-lg font-semibold leading-tight tracking-tight outline-none transition-colors hover:border-border focus:border-brand focus:ring-2 focus:ring-brand/25"
        />
        <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-muted">
          {task.clientId && task.clientName ? (
            <Link href={clientHref(task.clientId)} className="text-secondary hover:underline">
              {task.clientName}
            </Link>
          ) : null}
          <DueLabel task={task} />
          <ChecklistIndicator done={task.checklistDone} total={task.checklistTotal} />
          {processContext ? (
            <Badge variant="info" size="sm">
              <GitBranch className="size-3" /> Processo: {processContext.definitionName}
            </Badge>
          ) : null}
          {detail.processHref && task.processType ? (
            <Link href={detail.processHref} className="inline-flex items-center gap-1 text-brand hover:underline">
              <ExternalLink className="size-3.5" /> Abrir processo ({PROCESS_TYPE_LABELS[task.processType]})
            </Link>
          ) : null}
        </div>
      </DrawerHeader>

      <DrawerBody className="flex flex-col gap-6">
        {/* Descrição */}
        <section className="flex flex-col gap-1.5">
          <Label htmlFor="task-description">Descrição</Label>
          <Textarea id="task-description" value={description} onChange={(e) => setDescription(e.target.value)} onBlur={saveDescription} placeholder="Descreva o que precisa ser feito…" disabled={pending} className="min-h-[72px]" />
        </section>

        {/* Campos */}
        <section className="grid gap-3 sm:grid-cols-2">
          <Field label="Responsável" htmlFor="task-assignee">
            <Select id="task-assignee" value={task.assigneeId ?? ""} placeholder="Sem responsável" disabled={pending} onChange={(e) => e.target.value && run(() => assignTask({ id: task.id, assigneeId: e.target.value }), "Responsável atualizado")}>
              {users.map((u) => (
                <option key={u.id} value={u.id}>
                  {u.name}
                  {u.id === currentUserId ? " (eu)" : ""}
                </option>
              ))}
              {task.assigneeId && !assignee ? <option value={task.assigneeId}>{task.assigneeName ?? "Usuário inativo"}</option> : null}
            </Select>
          </Field>
          <Field label="Status" htmlFor="task-status">
            <Select id="task-status" value={task.status} disabled={pending} onChange={(e) => run(() => changeTaskStatus({ id: task.id, status: e.target.value as TaskStatus }), "Status atualizado")}>
              {TASK_STATUS.map((s) => (
                <option key={s} value={s}>
                  {TASK_STATUS_LABELS[s]}
                </option>
              ))}
            </Select>
          </Field>
          <Field label="Prioridade" htmlFor="task-priority">
            <Select id="task-priority" value={task.priority} disabled={pending} onChange={(e) => patch({ priority: e.target.value as Priority }, "Prioridade atualizada")}>
              {PRIORITIES.map((p) => (
                <option key={p} value={p}>
                  {PRIORITY_LABELS[p]}
                </option>
              ))}
            </Select>
          </Field>
          <Field label="Prazo" htmlFor="task-due">
            <div className="flex items-center gap-1">
              <DateInput
                key={task.dueAt ?? "sem-prazo"}
                id="task-due"
                mode="datetime-local"
                suppressHydrationWarning
                defaultValue={isoToDateTimeLocal(task.dueAt)}
                disabled={pending}
                onBlur={(e) => {
                  const iso = dateValueToIso(e.target.value);
                  if ((iso ?? null) !== (task.dueAt ?? null)) patch({ dueAt: iso ?? null }, "Prazo atualizado");
                }}
              />
              {task.dueAt ? (
                <Button variant="ghost" size="icon" className="size-9 shrink-0" aria-label="Remover prazo" disabled={pending} onClick={() => patch({ dueAt: null }, "Prazo removido")}>
                  <X />
                </Button>
              ) : null}
            </div>
          </Field>
          <Field label="Cliente" htmlFor="task-client">
            <ClientCombobox id="task-client" clients={clients} value={task.clientId} disabled={pending} onChange={(id) => patch({ clientId: id ?? null }, id ? "Cliente vinculado" : "Cliente removido")} />
          </Field>
          <Field label="Departamento" htmlFor="task-department">
            <Select id="task-department" value={task.departmentId} disabled={pending} onChange={(e) => patch({ departmentId: e.target.value as DepartmentKey }, "Departamento atualizado")}>
              {DEPARTMENT_KEYS.map((d) => (
                <option key={d} value={d}>
                  {DEPARTMENT_LABELS[d]}
                </option>
              ))}
            </Select>
          </Field>
          <Field label="Tags" htmlFor="task-tags" className="sm:col-span-2">
            <Input id="task-tags" value={tags} onChange={(e) => setTags(e.target.value)} onBlur={saveTags} onKeyDown={(e) => e.key === "Enter" && (e.target as HTMLInputElement).blur()} placeholder="separadas por vírgula" disabled={pending} />
          </Field>
        </section>

        {/* Checklist */}
        <section className="flex flex-col gap-2">
          <div className="flex items-center justify-between">
            <h3 className="text-sm font-semibold">Checklist</h3>
            {task.checklistTotal > 0 ? (
              <span className="text-xs tabular-nums text-muted">
                {task.checklistDone}/{task.checklistTotal}
              </span>
            ) : null}
          </div>
          {task.checklistTotal > 0 ? <Progress value={checklistPct} size="sm" tone={checklistPct === 100 ? "success" : "brand"} /> : null}
          <ul className="flex flex-col">
            {task.checklist.map((item) => (
              <li key={item.id} className="group flex items-center gap-2">
                <Checkbox
                  checked={item.done}
                  disabled={pending}
                  onCheckedChange={() => run(() => toggleChecklistItem({ id: task.id, itemId: item.id }))}
                  label={<span className={cn(item.done && "text-muted line-through")}>{item.label}</span>}
                  className="flex-1"
                />
                <Button variant="ghost" size="icon" className="size-9 shrink-0 text-muted-light hover:text-danger md:opacity-0 md:group-hover:opacity-100 md:focus-visible:opacity-100" aria-label={`Remover ${item.label}`} disabled={pending} onClick={() => run(() => removeChecklistItem({ id: task.id, itemId: item.id }))}>
                  <X />
                </Button>
              </li>
            ))}
          </ul>
          <form
            className="flex items-center gap-2"
            onSubmit={(e) => {
              e.preventDefault();
              const label = newItem.trim();
              if (!label) return;
              run(() => addChecklistItem({ id: task.id, label }), undefined, () => setNewItem(""));
            }}
          >
            <Input value={newItem} onChange={(e) => setNewItem(e.target.value)} placeholder="Novo item do checklist" aria-label="Novo item do checklist" disabled={pending} />
            <Button type="submit" variant="outline" size="icon" className="size-9 shrink-0" aria-label="Adicionar item" disabled={pending || !newItem.trim()}>
              <Plus />
            </Button>
          </form>
        </section>

        {/* Comentários */}
        <section className="flex flex-col gap-3">
          <h3 className="flex items-center gap-2 text-sm font-semibold">
            <MessageSquare className="size-4 text-muted" /> Comentários
            {comments.length > 0 ? <span className="rounded-full bg-surface-hover px-2 py-0.5 text-xs font-medium text-muted">{comments.length}</span> : null}
          </h3>
          {comments.length === 0 ? <p className="text-sm text-muted">Nenhum comentário ainda.</p> : null}
          <ul className="flex flex-col gap-3">
            {comments.map((c) => (
              <li key={c.id} className="flex gap-2.5">
                <Avatar name={c.authorName} size="sm" className="mt-0.5" />
                <div className="min-w-0 flex-1 rounded-lg bg-surface-muted px-3 py-2">
                  <div className="flex items-baseline justify-between gap-2">
                    <span className="text-sm font-medium">{c.authorName}</span>
                    <span className="shrink-0 text-[11px] text-muted">{c.createdAtLabel}</span>
                  </div>
                  <p className="mt-0.5 whitespace-pre-wrap text-sm">{c.body}</p>
                </div>
              </li>
            ))}
          </ul>
          <form
            className="flex flex-col gap-2"
            onSubmit={(e) => {
              e.preventDefault();
              const body = comment.trim();
              if (!body) return;
              run(() => addComment({ taskId: task.id, body }), "Comentário adicionado", () => setComment(""));
            }}
          >
            <Textarea value={comment} onChange={(e) => setComment(e.target.value)} placeholder="Escreva um comentário…" aria-label="Novo comentário" disabled={pending} className="min-h-[64px]" />
            <div className="flex justify-end">
              <Button type="submit" size="sm" variant="secondary" disabled={pending || !comment.trim()}>
                Comentar
              </Button>
            </div>
          </form>
        </section>

        {/* Histórico */}
        <section className="flex flex-col gap-2">
          <h3 className="flex items-center gap-2 text-sm font-semibold">
            <History className="size-4 text-muted" /> Histórico
          </h3>
          <p className="text-xs text-muted">
            Criada por {detail.creatorName ?? "—"} · {ORIGIN_LABELS[task.origin].toLowerCase()} · última atualização {task.updatedLabel}
          </p>
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
      </DrawerBody>

      <DrawerFooter className="sm:justify-between">
        <div className="flex gap-2">
          {canDelete ? (
            <Button variant="ghost" className="text-danger hover:bg-danger-soft" disabled={pending} onClick={() => setConfirm("delete")}>
              <Trash2 /> Excluir
            </Button>
          ) : null}
          {isOpen ? (
            <Button variant="outline" disabled={pending} onClick={() => setConfirm("cancel")}>
              <XCircle /> Cancelar tarefa
            </Button>
          ) : null}
        </div>
        {isOpen ? (
          <Button
            loading={pending}
            onClick={() => {
              // Etapa de processo: a conclusão passa pelo motor de processos (valida obrigatórios e segue o fluxo).
              if (processContext?.needsOutcome) setAskOutcome(true);
              else if (processContext) run(() => completeProcessTask(task.id), "Etapa do processo concluída");
              else run(() => completeTask({ id: task.id }), "Tarefa concluída");
            }}
          >
            <CheckCircle2 /> Concluir
          </Button>
        ) : (
          <Button variant="secondary" loading={pending} onClick={() => run(() => reopenTask({ id: task.id }), "Tarefa reaberta")}>
            <RotateCcw /> Reabrir
          </Button>
        )}
      </DrawerFooter>

      {processContext?.needsOutcome ? (
        <Dialog open={askOutcome} onOpenChange={setAskOutcome}>
          <DialogContent size="sm">
            <DialogHeader>
              <DialogTitle>{processContext.question ?? (processContext.isApproval ? "Aprovar esta etapa?" : "Qual o resultado desta etapa?")}</DialogTitle>
              <DialogDescription>
                Processo {processContext.definitionName}. A resposta define o próximo passo do fluxo.
              </DialogDescription>
            </DialogHeader>
            <DialogFooter>
              <Button
                variant="outline"
                disabled={pending}
                onClick={() => run(() => completeProcessTask(task.id, "nao"), processContext.isApproval ? "Etapa reprovada" : "Resposta registrada: Não", () => setAskOutcome(false))}
              >
                <ThumbsDown /> {processContext.isApproval ? "Reprovar" : "Não"}
              </Button>
              <Button
                variant="success"
                loading={pending}
                onClick={() => run(() => completeProcessTask(task.id, "sim"), processContext.isApproval ? "Etapa aprovada" : "Resposta registrada: Sim", () => setAskOutcome(false))}
              >
                <ThumbsUp /> {processContext.isApproval ? "Aprovar" : "Sim"}
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>
      ) : null}

      <ConfirmDialog
        open={confirm === "cancel"}
        onOpenChange={(o) => !o && setConfirm(null)}
        title="Cancelar esta tarefa?"
        description="A tarefa sai das listas de trabalho. Você pode reabri-la depois."
        confirmLabel="Cancelar tarefa"
        cancelLabel="Voltar"
        destructive
        onConfirm={async () => {
          const result = await cancelTask({ id: task.id });
          if (!result.ok) throw new Error(result.error);
          toast.success("Tarefa cancelada");
          router.refresh();
        }}
      />
      <ConfirmDialog
        open={confirm === "delete"}
        onOpenChange={(o) => !o && setConfirm(null)}
        title="Excluir definitivamente?"
        description="A tarefa, seu checklist e comentários deixam de aparecer. O histórico de eventos é mantido."
        confirmLabel="Excluir"
        destructive
        onConfirm={async () => {
          const result = await deleteTask({ id: task.id });
          if (!result.ok) throw new Error(result.error);
          toast.success("Tarefa excluída");
          onClose();
          router.refresh();
        }}
      />
    </>
  );
}

function Field({ label, htmlFor, className, children }: { label: string; htmlFor: string; className?: string; children: React.ReactNode }) {
  return (
    <div className={cn("flex flex-col gap-1.5", className)}>
      <Label htmlFor={htmlFor}>{label}</Label>
      {children}
    </div>
  );
}
