"use client";

import * as React from "react";
import { useRouter } from "next/navigation";
import { Plus, X } from "lucide-react";
import { DEPARTMENT_KEYS, DEPARTMENT_LABELS, PRIORITIES, PRIORITY_LABELS, type DepartmentKey, type Priority } from "@/domain/constants";
import { Button } from "@/components/ui/button";
import { DateInput, dateValueToIso } from "@/components/ui/date-input";
import { Dialog, DialogBody, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { FormField } from "@/components/ui/form-field";
import { Input } from "@/components/ui/input";
import { Select } from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import { toast } from "@/components/ui/toast";
import { createTask } from "@/server/tasks/actions";
import type { CreateTaskInput } from "@/server/tasks/schemas";
import { ClientCombobox } from "./client-combobox";
import { RECURRENCE_LABELS, type AssignableUser, type ClientOption } from "./task-model";
import { useTaskUrl } from "./use-task-url";

export interface NewTaskDialogProps {
  users: AssignableUser[];
  clients: ClientOption[];
  currentUser: { id: string; departmentId: DepartmentKey };
}

type RecurrenceFreq = "" | "diaria" | "semanal" | "mensal";

interface FormState {
  title: string;
  description: string;
  clientId?: string;
  assigneeId: string;
  departmentId: DepartmentKey;
  priority: Priority;
  dueAt: string;
  checklist: string[];
  tags: string;
  recurrenceFreq: RecurrenceFreq;
  recurrenceInterval: string;
}

/** Botão para abrir o formulário de qualquer lugar da página (o diálogo lê ?novo=1). */
export function OpenNewTaskButton({ children = "Nova tarefa", variant = "primary", size }: { children?: React.ReactNode; variant?: "primary" | "outline" | "secondary"; size?: "sm" | "md" | "lg" }) {
  const { href } = useTaskUrl();
  return (
    <Button variant={variant} size={size} onClick={() => window.history.pushState(null, "", href({ novo: "1" }))}>
      <Plus /> {children}
    </Button>
  );
}

/** Formulário "Nova tarefa". Aberto/fechado pela URL (?novo=1) para ser acionável de qualquer componente. */
export function NewTaskDialog({ users, clients, currentUser }: NewTaskDialogProps) {
  const { searchParams, setLocal } = useTaskUrl();
  const open = searchParams.get("novo") === "1";
  // /tarefas?novo=1&cliente=<id> abre o formulário com o cliente pré-selecionado (contrato usado pela ficha do cliente).
  const initialClientId = searchParams.get("cliente") || undefined;
  return (
    <>
      <OpenNewTaskButton />
      <Dialog open={open} onOpenChange={(next) => !next && setLocal({ novo: null })}>
        <DialogContent size="lg">
          {open ? <NewTaskForm users={users} clients={clients} currentUser={currentUser} initialClientId={initialClientId} onClose={() => setLocal({ novo: null })} /> : null}
        </DialogContent>
      </Dialog>
    </>
  );
}

function NewTaskForm({ users, clients, currentUser, initialClientId, onClose }: NewTaskDialogProps & { initialClientId?: string; onClose: () => void }) {
  const router = useRouter();
  const [pending, startTransition] = React.useTransition();
  const [error, setError] = React.useState<string | null>(null);
  const [form, setForm] = React.useState<FormState>({
    title: "",
    description: "",
    clientId: initialClientId && clients.some((c) => c.id === initialClientId) ? initialClientId : undefined,
    assigneeId: currentUser.id,
    departmentId: currentUser.departmentId,
    priority: "media",
    dueAt: "",
    checklist: [],
    tags: "",
    recurrenceFreq: "",
    recurrenceInterval: "1",
  });
  const [newItem, setNewItem] = React.useState("");
  const set = <K extends keyof FormState>(key: K, value: FormState[K]) => setForm((f) => ({ ...f, [key]: value }));

  const addItem = () => {
    const label = newItem.trim();
    if (!label) return;
    set("checklist", [...form.checklist, label]);
    setNewItem("");
  };

  const submit = (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    const input: CreateTaskInput = {
      title: form.title,
      description: form.description || undefined,
      clientId: form.clientId,
      assigneeId: form.assigneeId || undefined,
      departmentId: form.departmentId,
      priority: form.priority,
      dueAt: dateValueToIso(form.dueAt),
      checklist: form.checklist,
      tags: form.tags
        .split(",")
        .map((t) => t.trim())
        .filter(Boolean),
      recurrence: form.recurrenceFreq ? { freq: form.recurrenceFreq, interval: Math.max(1, Number(form.recurrenceInterval) || 1) } : undefined,
    };
    startTransition(async () => {
      const result = await createTask(input);
      if (!result.ok) {
        setError(result.error);
        return;
      }
      toast.success("Tarefa criada");
      onClose();
      router.refresh();
    });
  };

  return (
    <form onSubmit={submit} className="flex min-h-0 flex-1 flex-col">
      <DialogHeader>
        <DialogTitle>Nova tarefa</DialogTitle>
        <DialogDescription>Defina responsável, prazo e o que precisa ser feito. Tudo fica registrado na timeline.</DialogDescription>
      </DialogHeader>
      <DialogBody className="flex flex-col gap-4 py-3">
        <FormField label="Título" htmlFor="nt-title" required>
          <Input id="nt-title" autoFocus value={form.title} onChange={(e) => set("title", e.target.value)} placeholder="Ex.: Enviar proposta revisada" required minLength={3} maxLength={200} />
        </FormField>
        <FormField label="Descrição" htmlFor="nt-description">
          <Textarea id="nt-description" value={form.description} onChange={(e) => set("description", e.target.value)} placeholder="Contexto, critérios de conclusão, links…" className="min-h-[72px]" />
        </FormField>
        <div className="grid gap-4 sm:grid-cols-2">
          <FormField label="Cliente" htmlFor="nt-client" hint="Opcional. A tarefa aparece na timeline do cliente.">
            <ClientCombobox id="nt-client" clients={clients} value={form.clientId} onChange={(id) => set("clientId", id)} placeholder="Sem cliente" />
          </FormField>
          <FormField label="Responsável" htmlFor="nt-assignee" required>
            <Select id="nt-assignee" value={form.assigneeId} onChange={(e) => set("assigneeId", e.target.value)} required>
              {users.map((u) => (
                <option key={u.id} value={u.id}>
                  {u.name}
                  {u.id === currentUser.id ? " (eu)" : ""}
                </option>
              ))}
            </Select>
          </FormField>
          <FormField label="Departamento" htmlFor="nt-department" required>
            <Select id="nt-department" value={form.departmentId} onChange={(e) => set("departmentId", e.target.value as DepartmentKey)}>
              {DEPARTMENT_KEYS.map((d) => (
                <option key={d} value={d}>
                  {DEPARTMENT_LABELS[d]}
                </option>
              ))}
            </Select>
          </FormField>
          <FormField label="Prioridade" htmlFor="nt-priority">
            <Select id="nt-priority" value={form.priority} onChange={(e) => set("priority", e.target.value as Priority)}>
              {PRIORITIES.map((p) => (
                <option key={p} value={p}>
                  {PRIORITY_LABELS[p]}
                </option>
              ))}
            </Select>
          </FormField>
          <FormField label="Prazo" htmlFor="nt-due">
            <DateInput id="nt-due" mode="datetime-local" value={form.dueAt} onChange={(e) => set("dueAt", e.target.value)} />
          </FormField>
          <FormField label="Tags" htmlFor="nt-tags" hint="Separadas por vírgula.">
            <Input id="nt-tags" value={form.tags} onChange={(e) => set("tags", e.target.value)} placeholder="rotina, contrato, urgente" />
          </FormField>
        </div>

        <FormField label="Checklist inicial" htmlFor="nt-checklist-item">
          <div className="flex flex-col gap-2">
            {form.checklist.length > 0 ? (
              <ul className="flex flex-col gap-1">
                {form.checklist.map((item, i) => (
                  <li key={`${item}-${i}`} className="flex items-center gap-2 rounded-md bg-surface-muted px-2 py-1 text-sm">
                    <span className="flex-1 truncate">{item}</span>
                    <Button type="button" variant="ghost" size="icon" className="size-8" aria-label={`Remover ${item}`} onClick={() => set("checklist", form.checklist.filter((_, k) => k !== i))}>
                      <X />
                    </Button>
                  </li>
                ))}
              </ul>
            ) : null}
            <div className="flex items-center gap-2">
              <Input
                id="nt-checklist-item"
                value={newItem}
                onChange={(e) => setNewItem(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Enter") {
                    e.preventDefault();
                    addItem();
                  }
                }}
                placeholder="Novo item (Enter adiciona)"
              />
              <Button type="button" variant="outline" size="icon" className="size-9 shrink-0" aria-label="Adicionar item" onClick={addItem} disabled={!newItem.trim()}>
                <Plus />
              </Button>
            </div>
          </div>
        </FormField>

        <div className="grid gap-4 sm:grid-cols-2">
          <FormField label="Recorrência" htmlFor="nt-recurrence" hint="Ao concluir, a próxima ocorrência é criada automaticamente.">
            <Select id="nt-recurrence" value={form.recurrenceFreq} onChange={(e) => set("recurrenceFreq", e.target.value as RecurrenceFreq)}>
              <option value="">Nenhuma</option>
              {(Object.keys(RECURRENCE_LABELS) as (keyof typeof RECURRENCE_LABELS)[]).map((k) => (
                <option key={k} value={k}>
                  {RECURRENCE_LABELS[k]}
                </option>
              ))}
            </Select>
          </FormField>
          {form.recurrenceFreq ? (
            <FormField label="Intervalo" htmlFor="nt-interval" hint={`A cada N ${form.recurrenceFreq === "diaria" ? "dias" : form.recurrenceFreq === "semanal" ? "semanas" : "meses"}.`}>
              <Input id="nt-interval" type="number" min={1} max={365} inputMode="numeric" value={form.recurrenceInterval} onChange={(e) => set("recurrenceInterval", e.target.value)} />
            </FormField>
          ) : null}
        </div>

        {error ? (
          <p role="alert" className="rounded-md bg-danger-soft px-3 py-2 text-sm text-danger-fg">
            {error}
          </p>
        ) : null}
      </DialogBody>
      <DialogFooter>
        <Button type="button" variant="outline" onClick={onClose} disabled={pending}>
          Cancelar
        </Button>
        <Button type="submit" loading={pending}>
          Criar tarefa
        </Button>
      </DialogFooter>
    </form>
  );
}
