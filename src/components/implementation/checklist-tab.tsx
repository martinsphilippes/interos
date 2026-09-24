"use client";

import * as React from "react";
import { ListChecks, Plus } from "lucide-react";
import type { ChecklistItem } from "@/domain/types";
import { addProjectChecklistItem, toggleProjectChecklist } from "@/server/implementation/actions";
import { formatDate } from "@/lib/format";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { EmptyState } from "@/components/ui/empty-state";
import { Input } from "@/components/ui/input";
import { Progress } from "@/components/ui/progress";
import { Switch } from "@/components/ui/switch";
import { useImplementationAction } from "./use-implementation-action";

/** Checklist do projeto (itens combinados dos templates dos produtos + itens avulsos). */
export function ChecklistTab({ projectId, items, users, editable }: { projectId: string; items: ChecklistItem[]; users: { id: string; name: string }[]; editable: boolean }) {
  const { pending, run } = useImplementationAction();
  const [label, setLabel] = React.useState("");
  const [required, setRequired] = React.useState(true);
  const [busyId, setBusyId] = React.useState<string | null>(null);
  const names = new Map(users.map((u) => [u.id, u.name]));
  const requiredItems = items.filter((c) => c.required !== false);
  const requiredDone = requiredItems.filter((c) => c.done).length;

  const toggle = async (item: ChecklistItem, done: boolean) => {
    setBusyId(item.id);
    await run(() => toggleProjectChecklist({ projectId, itemId: item.id, done }), done ? "Item concluído" : "Item reaberto");
    setBusyId(null);
  };
  const add = async (e: React.FormEvent) => {
    e.preventDefault();
    if (await run(() => addProjectChecklistItem({ projectId, label, required }), "Item adicionado")) setLabel("");
  };

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-col gap-1">
        <p className="text-sm text-muted">
          Obrigatórios: {requiredDone}/{requiredItems.length} · Total: {items.filter((c) => c.done).length}/{items.length}. O go-live exige todos os obrigatórios.
        </p>
        <Progress value={requiredItems.length ? (requiredDone / requiredItems.length) * 100 : 0} tone={requiredDone === requiredItems.length ? "success" : "brand"} size="sm" className="max-w-md" />
      </div>
      {items.length === 0 ? (
        <EmptyState size="sm" icon={<ListChecks />} title="Checklist vazio" description="Os templates dos produtos não trouxeram itens. Adicione os itens de controle do projeto." />
      ) : (
        <ul className="flex flex-col divide-y divide-border rounded-lg border border-border">
          {items.map((item) => (
            <li key={item.id} className="flex items-center gap-3 px-4">
              <Checkbox
                label={
                  <span className={item.done ? "text-muted line-through" : undefined}>
                    {item.label}
                    {item.required === false ? <span className="ml-1 text-xs text-muted-light">(opcional)</span> : null}
                  </span>
                }
                description={item.done && item.doneAt ? `Concluído em ${formatDate(item.doneAt)}${item.doneBy ? ` por ${names.get(item.doneBy) ?? "—"}` : ""}` : undefined}
                checked={item.done}
                disabled={!editable || busyId === item.id}
                onCheckedChange={(v) => toggle(item, v === true)}
                className="flex-1 py-3 md:py-3"
              />
            </li>
          ))}
        </ul>
      )}
      {editable ? (
        <form onSubmit={add} className="flex flex-col gap-2 rounded-lg border border-dashed border-border-strong p-3 md:flex-row md:items-center">
          <Input value={label} onChange={(e) => setLabel(e.target.value)} placeholder="Novo item do checklist" aria-label="Novo item do checklist" maxLength={200} required className="h-11 md:h-9" />
          <Switch label="Obrigatório" checked={required} onCheckedChange={setRequired} size="sm" className="shrink-0 md:min-h-0" />
          <Button type="submit" variant="outline" loading={pending && !busyId} className="h-11 shrink-0 md:h-9">
            <Plus /> Adicionar
          </Button>
        </form>
      ) : null}
    </div>
  );
}
