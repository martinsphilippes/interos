"use client";

import * as React from "react";
import { ChevronDown, ChevronUp, ListChecks, Pencil, Plus, Trash2 } from "lucide-react";
import { IMPLEMENTATION_PHASES, type ImplementationPhase } from "@/domain/types";
import type { ProductLite, TemplateRow } from "@/server/implementation/queries";
import { saveImplementationTemplate, toggleImplementationTemplate } from "@/server/implementation/actions";
import { cn } from "@/lib/utils";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Checkbox } from "@/components/ui/checkbox";
import { Drawer, DrawerBody, DrawerContent, DrawerDescription, DrawerFooter, DrawerHeader, DrawerTitle } from "@/components/ui/drawer";
import { EmptyState } from "@/components/ui/empty-state";
import { FormField } from "@/components/ui/form-field";
import { Input } from "@/components/ui/input";
import { Select } from "@/components/ui/select";
import { Switch } from "@/components/ui/switch";
import { IMPLEMENTATION_PHASE_LABELS } from "@/components/clients/labels";
import { useImplementationAction } from "./use-implementation-action";

interface DraftTask {
  key: string;
  title: string;
  description?: string;
  dueInDays: number;
  required: boolean;
}
interface DraftCheck {
  key: string;
  label: string;
  required: boolean;
}
interface DraftPhase {
  key: ImplementationPhase;
  name: string;
  tasks: DraftTask[];
  checklist: DraftCheck[];
}
interface Draft {
  id?: string;
  name: string;
  productId: string;
  totalDays: number;
  active: boolean;
  phases: DraftPhase[];
}

let seq = 0;
const k = () => `d${++seq}`;

function toDraft(t?: TemplateRow): Draft {
  if (!t) return { name: "", productId: "", totalDays: 5, active: true, phases: [{ key: "kickoff", name: IMPLEMENTATION_PHASE_LABELS.kickoff, tasks: [], checklist: [] }] };
  return {
    id: t.id,
    name: t.name,
    productId: t.productId ?? "",
    totalDays: t.totalDays,
    active: t.active,
    phases: t.phases.map((p) => ({
      key: p.key,
      name: p.name,
      tasks: p.tasks.map((x) => ({ key: k(), title: x.title, description: x.description, dueInDays: x.dueInDays, required: x.required })),
      checklist: p.checklist.map((c) => ({ key: k(), label: c.label, required: c.required })),
    })),
  };
}

/** Templates de checklist por produto: lista, ativar/desativar e edição em drawer. */
export function TemplatesManager({ templates, products, canOperate }: { templates: TemplateRow[]; products: ProductLite[]; canOperate: boolean }) {
  const [editing, setEditing] = React.useState<{ draft: Draft } | null>(null);
  const { pending, run } = useImplementationAction();

  return (
    <div className="flex flex-col gap-4">
      {canOperate ? (
        <Button className="h-11 self-start md:h-9" onClick={() => setEditing({ draft: toDraft() })}>
          <Plus /> Novo template
        </Button>
      ) : null}
      {templates.length === 0 ? (
        <Card>
          <EmptyState icon={<ListChecks />} title="Nenhum template" description="Crie um template por produto com as fases, tarefas e checklist da implantação." />
        </Card>
      ) : (
        <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">
          {templates.map((t) => (
            <Card key={t.id} className={cn(!t.active && "opacity-70")}>
              <CardHeader className="gap-2">
                <div className="flex items-start justify-between gap-2">
                  <CardTitle>{t.name}</CardTitle>
                  <Badge variant={t.active ? "success" : "muted"} size="sm">
                    {t.active ? "Ativo" : "Inativo"}
                  </Badge>
                </div>
                <CardDescription>
                  {t.productName ?? "Sem produto"} · {t.totalDays} dia(s) útil(eis) · {t.phases.length} fase(s) · {t.taskCount} tarefa(s) · {t.checklistCount} item(ns) de checklist
                </CardDescription>
              </CardHeader>
              <CardContent className="flex flex-col gap-3 pt-0">
                <div className="flex flex-wrap gap-1">
                  {t.phases.map((p) => (
                    <span key={p.key} className="rounded-sm bg-surface-hover px-1.5 py-0.5 text-[11px] text-muted">
                      {p.name}
                    </span>
                  ))}
                </div>
                {t.linkedProducts.length > 0 ? <p className="text-xs text-muted">Vinculado a: {t.linkedProducts.join(", ")}</p> : null}
                {canOperate ? (
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <Switch
                      size="sm"
                      label="Ativo"
                      checked={t.active}
                      disabled={pending}
                      onCheckedChange={(active) => run(() => toggleImplementationTemplate({ templateId: t.id, active }), active ? "Template ativado" : "Template desativado")}
                    />
                    <Button variant="outline" size="sm" className="h-11 md:h-8" onClick={() => setEditing({ draft: toDraft(t) })}>
                      <Pencil /> Editar
                    </Button>
                  </div>
                ) : null}
              </CardContent>
            </Card>
          ))}
        </div>
      )}
      {editing ? <TemplateEditor initial={editing.draft} products={products} onClose={() => setEditing(null)} /> : null}
    </div>
  );
}

function TemplateEditor({ initial, products, onClose }: { initial: Draft; products: ProductLite[]; onClose: () => void }) {
  const { pending, run } = useImplementationAction();
  const [draft, setDraft] = React.useState<Draft>(initial);
  const [addPhase, setAddPhase] = React.useState<ImplementationPhase | "">("");
  const available = IMPLEMENTATION_PHASES.filter((p) => !draft.phases.some((x) => x.key === p));

  const setPhase = (key: ImplementationPhase, patch: (p: DraftPhase) => DraftPhase) => setDraft((d) => ({ ...d, phases: d.phases.map((p) => (p.key === key ? patch(p) : p)) }));
  const sortedPhases = [...draft.phases].sort((a, b) => IMPLEMENTATION_PHASES.indexOf(a.key) - IMPLEMENTATION_PHASES.indexOf(b.key));

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    const payload = {
      id: draft.id,
      name: draft.name,
      productId: draft.productId,
      totalDays: Number(draft.totalDays),
      active: draft.active,
      phases: sortedPhases.map((p, i) => ({
        key: p.key,
        name: p.name,
        order: i + 1,
        tasks: p.tasks.map((t) => ({ title: t.title, description: t.description, dueInDays: Number(t.dueInDays), required: t.required })),
        checklist: p.checklist.map((c) => ({ label: c.label, required: c.required })),
      })),
    };
    if (await run(() => saveImplementationTemplate(payload), draft.id ? "Template atualizado" : "Template criado")) onClose();
  };

  return (
    <Drawer open onOpenChange={(v) => !v && !pending && onClose()}>
      <DrawerContent size="lg">
        <form onSubmit={submit} className="flex min-h-0 flex-1 flex-col">
          <DrawerHeader>
            <DrawerTitle>{draft.id ? "Editar template" : "Novo template"}</DrawerTitle>
            <DrawerDescription>Fases, tarefas (prazo em dias úteis a partir do início da fase) e checklist. Alterações valem para novos projetos.</DrawerDescription>
          </DrawerHeader>
          <DrawerBody className="flex flex-col gap-5">
            <div className="grid gap-4 sm:grid-cols-[1fr_1fr_120px]">
              <FormField label="Nome" htmlFor="tpl-name" required>
                <Input id="tpl-name" value={draft.name} onChange={(e) => setDraft({ ...draft, name: e.target.value })} required maxLength={120} />
              </FormField>
              <FormField label="Produto" htmlFor="tpl-product">
                <Select id="tpl-product" value={draft.productId} onChange={(e) => setDraft({ ...draft, productId: e.target.value })}>
                  <option value="">Sem produto (genérico)</option>
                  {products.map((p) => (
                    <option key={p.id} value={p.id}>
                      {p.name}
                    </option>
                  ))}
                </Select>
              </FormField>
              <FormField label="Total de dias" htmlFor="tpl-days" required>
                <Input id="tpl-days" type="number" min={1} max={365} value={draft.totalDays} onChange={(e) => setDraft({ ...draft, totalDays: Number(e.target.value) })} required />
              </FormField>
            </div>
            <Switch label="Template ativo" description="Templates inativos não entram em novos projetos." checked={draft.active} onCheckedChange={(active) => setDraft({ ...draft, active })} />

            {sortedPhases.map((phase) => (
              <fieldset key={phase.key} className="flex flex-col gap-3 rounded-lg border border-border p-3">
                <div className="flex items-end gap-2">
                  <FormField label={`Fase: ${IMPLEMENTATION_PHASE_LABELS[phase.key]}`} htmlFor={`ph-${phase.key}`} className="flex-1">
                    <Input id={`ph-${phase.key}`} value={phase.name} onChange={(e) => setPhase(phase.key, (p) => ({ ...p, name: e.target.value }))} required maxLength={80} />
                  </FormField>
                  <Button variant="ghost" size="icon" className="size-11 md:size-9" aria-label={`Remover fase ${phase.name}`} onClick={() => setDraft((d) => ({ ...d, phases: d.phases.filter((p) => p.key !== phase.key) }))}>
                    <Trash2 />
                  </Button>
                </div>
                <EditableList
                  title="Tarefas"
                  items={phase.tasks}
                  onAdd={() => setPhase(phase.key, (p) => ({ ...p, tasks: [...p.tasks, { key: k(), title: "", dueInDays: 1, required: true }] }))}
                  onRemove={(key) => setPhase(phase.key, (p) => ({ ...p, tasks: p.tasks.filter((t) => t.key !== key) }))}
                  onMove={(key, dir) => setPhase(phase.key, (p) => ({ ...p, tasks: move(p.tasks, key, dir) }))}
                  render={(t) => (
                    <>
                      <Input aria-label="Título da tarefa" value={t.title} onChange={(e) => setPhase(phase.key, (p) => ({ ...p, tasks: p.tasks.map((x) => (x.key === t.key ? { ...x, title: e.target.value } : x)) }))} required maxLength={160} className="min-w-0 flex-1" />
                      <Input
                        aria-label="Prazo em dias"
                        type="number"
                        min={0}
                        max={120}
                        value={t.dueInDays}
                        onChange={(e) => setPhase(phase.key, (p) => ({ ...p, tasks: p.tasks.map((x) => (x.key === t.key ? { ...x, dueInDays: Number(e.target.value) } : x)) }))}
                        className="w-20"
                        title="Prazo em dias úteis"
                      />
                      <Checkbox label="Obrig." checked={t.required} onCheckedChange={(v) => setPhase(phase.key, (p) => ({ ...p, tasks: p.tasks.map((x) => (x.key === t.key ? { ...x, required: v === true } : x)) }))} />
                    </>
                  )}
                />
                <EditableList
                  title="Checklist"
                  items={phase.checklist}
                  onAdd={() => setPhase(phase.key, (p) => ({ ...p, checklist: [...p.checklist, { key: k(), label: "", required: true }] }))}
                  onRemove={(key) => setPhase(phase.key, (p) => ({ ...p, checklist: p.checklist.filter((c) => c.key !== key) }))}
                  onMove={(key, dir) => setPhase(phase.key, (p) => ({ ...p, checklist: move(p.checklist, key, dir) }))}
                  render={(c) => (
                    <>
                      <Input aria-label="Item do checklist" value={c.label} onChange={(e) => setPhase(phase.key, (p) => ({ ...p, checklist: p.checklist.map((x) => (x.key === c.key ? { ...x, label: e.target.value } : x)) }))} required maxLength={200} className="min-w-0 flex-1" />
                      <Checkbox label="Obrig." checked={c.required} onCheckedChange={(v) => setPhase(phase.key, (p) => ({ ...p, checklist: p.checklist.map((x) => (x.key === c.key ? { ...x, required: v === true } : x)) }))} />
                    </>
                  )}
                />
              </fieldset>
            ))}
            {available.length > 0 ? (
              <div className="flex flex-col gap-2 sm:flex-row sm:items-center">
                <Select aria-label="Fase a adicionar" value={addPhase} onChange={(e) => setAddPhase(e.target.value as ImplementationPhase)} className="sm:max-w-[240px]">
                  <option value="">Adicionar fase…</option>
                  {available.map((p) => (
                    <option key={p} value={p}>
                      {IMPLEMENTATION_PHASE_LABELS[p]}
                    </option>
                  ))}
                </Select>
                <Button
                  variant="outline"
                  className="h-11 md:h-9"
                  disabled={!addPhase}
                  onClick={() => {
                    if (!addPhase) return;
                    setDraft((d) => ({ ...d, phases: [...d.phases, { key: addPhase, name: IMPLEMENTATION_PHASE_LABELS[addPhase], tasks: [], checklist: [] }] }));
                    setAddPhase("");
                  }}
                >
                  <Plus /> Adicionar fase
                </Button>
              </div>
            ) : null}
          </DrawerBody>
          <DrawerFooter>
            <Button variant="outline" onClick={onClose} disabled={pending}>
              Cancelar
            </Button>
            <Button type="submit" loading={pending}>
              Salvar template
            </Button>
          </DrawerFooter>
        </form>
      </DrawerContent>
    </Drawer>
  );
}

function move<T extends { key: string }>(items: T[], key: string, dir: -1 | 1): T[] {
  const i = items.findIndex((x) => x.key === key);
  const j = i + dir;
  if (i < 0 || j < 0 || j >= items.length) return items;
  const next = [...items];
  [next[i], next[j]] = [next[j], next[i]];
  return next;
}

function EditableList<T extends { key: string }>({ title, items, onAdd, onRemove, onMove, render }: { title: string; items: T[]; onAdd: () => void; onRemove: (key: string) => void; onMove: (key: string, dir: -1 | 1) => void; render: (item: T) => React.ReactNode }) {
  return (
    <div className="flex flex-col gap-2">
      <div className="flex items-center justify-between">
        <p className="label-caps">
          {title} ({items.length})
        </p>
        <Button variant="ghost" size="sm" className="h-11 md:h-8" onClick={onAdd}>
          <Plus /> Adicionar
        </Button>
      </div>
      {items.map((item, i) => (
        <div key={item.key} className="flex flex-wrap items-center gap-2 sm:flex-nowrap">
          {render(item)}
          <div className="flex shrink-0">
            <Button variant="ghost" size="icon" className="size-11 md:size-8" aria-label="Mover para cima" disabled={i === 0} onClick={() => onMove(item.key, -1)}>
              <ChevronUp />
            </Button>
            <Button variant="ghost" size="icon" className="size-11 md:size-8" aria-label="Mover para baixo" disabled={i === items.length - 1} onClick={() => onMove(item.key, 1)}>
              <ChevronDown />
            </Button>
            <Button variant="ghost" size="icon" className="size-11 md:size-8" aria-label="Remover" onClick={() => onRemove(item.key)}>
              <Trash2 />
            </Button>
          </div>
        </div>
      ))}
      {items.length === 0 ? <p className="text-xs text-muted">Nenhum item.</p> : null}
    </div>
  );
}
