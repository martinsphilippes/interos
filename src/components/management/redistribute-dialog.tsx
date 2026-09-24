"use client";

import * as React from "react";
import { useRouter } from "next/navigation";
import { ArrowRightLeft } from "lucide-react";
import { redistributeTasks } from "@/server/management/actions";
import type { ReassignTask } from "@/server/management/queries";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Dialog, DialogBody, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { EmptyState } from "@/components/ui/empty-state";
import { PriorityBadge } from "@/components/ui/priority-badge";
import { SelectField } from "@/components/ui/select";
import { toast } from "@/components/ui/toast";
import { cn } from "@/lib/utils";

export interface RedistributeDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  from: { id: string; name: string };
  tasks: ReassignTask[];
  targets: { id: string; name: string; subtitle: string }[];
}

/** Seleciona tarefas abertas/atrasadas de um colaborador e o novo responsável (reatribuição com evento e notificação). */
export function RedistributeDialog({ open, onOpenChange, from, tasks, targets }: RedistributeDialogProps) {
  const router = useRouter();
  const [pending, startTransition] = React.useTransition();
  const [selected, setSelected] = React.useState<Set<string>>(() => new Set(tasks.filter((t) => t.overdue).map((t) => t.id)));
  const [toUserId, setToUserId] = React.useState("");
  const options = targets.filter((t) => t.id !== from.id);

  const toggle = (id: string, checked: boolean) =>
    setSelected((prev) => {
      const next = new Set(prev);
      if (checked) next.add(id);
      else next.delete(id);
      return next;
    });

  const allChecked = tasks.length > 0 && selected.size === tasks.length;

  const submit = () => {
    startTransition(async () => {
      const result = await redistributeTasks({ fromUserId: from.id, toUserId, taskIds: Array.from(selected) });
      if (!result.ok) {
        toast.error(result.error);
        return;
      }
      const target = options.find((o) => o.id === toUserId)?.name ?? "o novo responsável";
      toast.success(`${result.data.moved} tarefa(s) redistribuída(s) para ${target}${result.data.skipped > 0 ? ` · ${result.data.skipped} ignorada(s)` : ""}`);
      onOpenChange(false);
      setSelected(new Set());
      router.refresh();
    });
  };

  return (
    <Dialog open={open} onOpenChange={(next) => !pending && onOpenChange(next)}>
      <DialogContent size="lg">
        <DialogHeader>
          <DialogTitle>Redistribuir tarefas de {from.name}</DialogTitle>
          <DialogDescription>Cada reatribuição fica registrada na auditoria e o novo responsável é notificado.</DialogDescription>
        </DialogHeader>
        <DialogBody className="flex flex-col gap-4">
          {tasks.length === 0 ? (
            <EmptyState size="sm" title="Sem tarefas abertas" description={`${from.name} não tem tarefas abertas para redistribuir.`} />
          ) : (
            <>
              <div className="flex items-center justify-between gap-2">
                <Checkbox
                  checked={allChecked ? true : selected.size > 0 ? "indeterminate" : false}
                  onCheckedChange={(v) => setSelected(v === true ? new Set(tasks.map((t) => t.id)) : new Set())}
                  label={`Selecionar todas (${tasks.length})`}
                />
                <span className="text-xs text-muted tabular-nums">{selected.size} selecionada(s)</span>
              </div>
              <ul className="max-h-[40dvh] divide-y divide-border overflow-y-auto rounded-lg border border-border scrollbar-thin">
                {tasks.map((t) => (
                  <li key={t.id} className={cn("px-3", t.overdue && "bg-danger-soft/30")}>
                    <Checkbox
                      checked={selected.has(t.id)}
                      onCheckedChange={(v) => toggle(t.id, v === true)}
                      className="md:min-h-[44px] md:items-center"
                      label={
                        <span className="flex flex-wrap items-center gap-x-2 gap-y-1">
                          <span className="font-medium">{t.title}</span>
                          <PriorityBadge priority={t.priority} />
                        </span>
                      }
                      description={[t.clientName, t.dueLabel ? `${t.overdue ? "Atrasada · " : "Prazo "}${t.dueLabel}` : "Sem prazo"].filter(Boolean).join(" · ")}
                    />
                  </li>
                ))}
              </ul>
              <SelectField
                label="Novo responsável"
                required
                placeholder="Escolha um colaborador"
                value={toUserId}
                onChange={(e) => setToUserId(e.target.value)}
                options={options.map((o) => ({ value: o.id, label: `${o.name} · ${o.subtitle}` }))}
              />
            </>
          )}
        </DialogBody>
        <DialogFooter>
          <Button variant="outline" className="h-11 md:h-9" onClick={() => onOpenChange(false)} disabled={pending}>
            Cancelar
          </Button>
          <Button className="h-11 md:h-9" onClick={submit} loading={pending} disabled={selected.size === 0 || !toUserId}>
            <ArrowRightLeft /> Redistribuir {selected.size > 0 ? selected.size : ""}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

/** Botão que abre o diálogo (usado na tabela da equipe e na visão do colaborador). */
export function RedistributeButton({ label = "Redistribuir tarefas", size = "sm", ...props }: Omit<RedistributeDialogProps, "open" | "onOpenChange"> & { label?: string; size?: "sm" | "md" }) {
  const [open, setOpen] = React.useState(false);
  return (
    <>
      <Button variant="outline" size={size} className="h-11 md:h-8" onClick={() => setOpen(true)} disabled={props.tasks.length === 0} title={props.tasks.length === 0 ? "Sem tarefas abertas" : undefined}>
        <ArrowRightLeft /> {label}
      </Button>
      {open ? <RedistributeDialog open={open} onOpenChange={setOpen} {...props} /> : null}
    </>
  );
}
