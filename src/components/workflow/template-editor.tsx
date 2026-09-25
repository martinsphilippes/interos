"use client";

import * as React from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { ArrowDown, ArrowUp, ChevronDown, ChevronRight, Lock, Plus, Rocket, Save, Trash2 } from "lucide-react";
import { DEPARTMENT_KEYS, DEPARTMENT_LABELS, PRIORITIES, PRIORITY_LABELS, ROLE_KEYS, ROLE_LABELS, type DepartmentKey, type Priority, type RoleKey } from "@/domain/constants";
import type { GateField, WorkflowStage, WorkflowTemplate } from "@/domain/types";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { ConfirmDialog } from "@/components/ui/confirm-dialog";
import { FormField } from "@/components/ui/form-field";
import { Input } from "@/components/ui/input";
import { Select } from "@/components/ui/select";
import { Switch } from "@/components/ui/switch";
import { Textarea } from "@/components/ui/textarea";
import { toast } from "@/components/ui/toast";
import { cn } from "@/lib/utils";
import { publishWorkflowTemplateAction, saveWorkflowTemplateAction } from "@/server/workflow/actions";

export interface TemplateEditorProps {
  template: WorkflowTemplate;
  versions: { id: string; version: number; published: boolean }[];
  instances: number;
  slaRuleKeys: string[];
}

type StageDraft = WorkflowStage;

const FIELD_TYPES: { value: GateField["type"]; label: string }[] = [
  { value: "texto", label: "Texto" },
  { value: "numero", label: "Número" },
  { value: "data", label: "Data" },
  { value: "booleano", label: "Sim/Não" },
  { value: "selecao", label: "Seleção" },
];

function slug(text: string): string {
  return text
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_|_$/g, "");
}

function emptyStage(order: number): StageDraft {
  return {
    key: `etapa_${order}`,
    name: `Nova etapa ${order}`,
    department: "vendas",
    order,
    description: "",
    defaultAssigneeRole: undefined,
    slaHours: undefined,
    slaRuleKey: undefined,
    gate: { name: "Gate", requiredFields: [], checklist: [], requiresApproval: false, approverRole: undefined, requiresDocuments: false, exitCriteria: "" },
    autoTasks: [],
  };
}

/**
 * Editor simples do template (sem editor visual): lista reordenável de etapas com formulário por etapa.
 * Salvar em uma versão publicada cria a versão seguinte como rascunho; "Publicar" ativa a versão.
 */
export function TemplateEditor({ template, versions, instances, slaRuleKeys }: TemplateEditorProps) {
  const router = useRouter();
  const [pending, startTransition] = React.useTransition();
  const [name, setName] = React.useState(template.name);
  const [description, setDescription] = React.useState(template.description ?? "");
  const [stages, setStages] = React.useState<StageDraft[]>(() => [...template.stages].sort((a, b) => a.order - b.order).map((s) => ({ ...s, gate: { ...s.gate, requiredFields: [...s.gate.requiredFields], checklist: [...s.gate.checklist] }, autoTasks: [...s.autoTasks] })));
  const [open, setOpen] = React.useState<Set<string>>(() => new Set(template.stages.slice(0, 1).map((s) => s.key)));
  const [confirmPublish, setConfirmPublish] = React.useState(false);
  const dirty = name !== template.name || description !== (template.description ?? "") || JSON.stringify(stages) !== JSON.stringify([...template.stages].sort((a, b) => a.order - b.order));

  const updateStage = (index: number, patch: Partial<StageDraft>) => setStages((list) => list.map((s, i) => (i === index ? { ...s, ...patch } : s)));
  const updateGate = (index: number, patch: Partial<StageDraft["gate"]>) => setStages((list) => list.map((s, i) => (i === index ? { ...s, gate: { ...s.gate, ...patch } } : s)));
  const move = (index: number, dir: -1 | 1) =>
    setStages((list) => {
      const target = index + dir;
      if (target < 0 || target >= list.length) return list;
      const next = [...list];
      [next[index], next[target]] = [next[target], next[index]];
      return next.map((s, i) => ({ ...s, order: i + 1 }));
    });
  const remove = (index: number) => setStages((list) => list.filter((_, i) => i !== index).map((s, i) => ({ ...s, order: i + 1 })));
  const add = () =>
    setStages((list) => {
      const stage = emptyStage(list.length + 1);
      setOpen((o) => new Set(o).add(stage.key));
      return [...list, stage];
    });
  const toggleOpen = (key: string) =>
    setOpen((o) => {
      const next = new Set(o);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });

  const save = () =>
    startTransition(async () => {
      const result = await saveWorkflowTemplateAction({
        id: template.id,
        name,
        description: description || undefined,
        stages: stages.map((s) => ({
          key: s.key,
          name: s.name,
          department: s.department,
          description: s.description || undefined,
          defaultAssigneeRole: s.defaultAssigneeRole || undefined,
          slaHours: s.slaHours || undefined,
          slaRuleKey: s.slaRuleKey || undefined,
          gate: {
            name: s.gate.name,
            requiredFields: s.gate.requiredFields.map((f) => ({ path: f.path, label: f.label, type: f.type, options: f.options })),
            checklist: s.gate.checklist.map((c) => ({ key: c.key, label: c.label, required: c.required })),
            requiresApproval: s.gate.requiresApproval,
            approverRole: s.gate.approverRole || undefined,
            requiresDocuments: Boolean(s.gate.requiresDocuments),
            exitCriteria: s.gate.exitCriteria,
          },
          autoTasks: s.autoTasks.map((t) => ({ title: t.title, description: t.description || undefined, dueInHours: t.dueInHours, priority: t.priority })),
        })),
      });
      if (!result.ok) {
        toast.error(result.error);
        return;
      }
      if (result.data.created) {
        toast.success(`Versão v${result.data.version} criada como rascunho. Publique quando estiver pronta.`);
        router.push(`/admin/workflows/${result.data.id}`);
      } else {
        toast.success("Rascunho salvo");
      }
      router.refresh();
    });

  const publish = async () => {
    const result = await publishWorkflowTemplateAction({ id: template.id });
    if (!result.ok) throw new Error(result.error);
    toast.success(`Versão v${result.data.version} publicada. Novas jornadas usam esta versão.`);
    router.refresh();
  };

  return (
    <div className="flex flex-col gap-5">
      {/* Cabeçalho do template */}
      <section className="flex flex-col gap-3 rounded-lg border border-border bg-surface p-4 shadow-card">
        <div className="flex flex-wrap items-center gap-2">
          <Badge variant={template.published ? "success" : "muted"}>{template.published ? "Publicado" : "Rascunho"}</Badge>
          <Badge variant="outline">v{template.version}</Badge>
          <Badge variant="outline">
            <code>{template.key}</code>
          </Badge>
          <span className="text-xs text-muted">
            {instances} jornada(s) nesta versão{template.published ? " · versão publicada é imutável: salvar cria a v" + (Math.max(...versions.map((v) => v.version)) + 1) : ""}
          </span>
        </div>
        <div className="grid gap-3 md:grid-cols-2">
          <FormField label="Nome" htmlFor="tpl-name" required>
            <Input id="tpl-name" value={name} onChange={(e) => setName(e.target.value)} disabled={pending} />
          </FormField>
          <FormField label="Descrição" htmlFor="tpl-desc">
            <Input id="tpl-desc" value={description} onChange={(e) => setDescription(e.target.value)} disabled={pending} />
          </FormField>
        </div>
        {versions.length > 1 ? (
          <p className="flex flex-wrap items-center gap-1.5 text-xs text-muted">
            Versões:
            {versions.map((v) => (
              <Link key={v.id} href={`/admin/workflows/${v.id}`} className={cn("rounded-full border px-2 py-0.5", v.id === template.id ? "border-brand text-brand-fg" : "border-border hover:border-border-strong")}>
                v{v.version}
                {v.published ? " · publicada" : ""}
              </Link>
            ))}
          </p>
        ) : null}
      </section>

      {/* Etapas */}
      <section className="flex flex-col gap-3">
        <div className="flex items-center justify-between">
          <h2 className="text-base font-semibold">Etapas ({stages.length})</h2>
          <Button variant="outline" size="sm" onClick={add} disabled={pending}>
            <Plus /> Adicionar etapa
          </Button>
        </div>
        <ol className="flex flex-col gap-3">
          {stages.map((stage, index) => {
            const expanded = open.has(stage.key);
            return (
              <li key={`${stage.key}-${index}`} className="rounded-lg border border-border bg-surface shadow-card">
                <div className="flex items-center gap-2 px-3 py-2">
                  <button type="button" onClick={() => toggleOpen(stage.key)} className="flex min-h-[40px] min-w-0 flex-1 items-center gap-2 text-left" aria-expanded={expanded}>
                    {expanded ? <ChevronDown className="size-4 shrink-0 text-muted" /> : <ChevronRight className="size-4 shrink-0 text-muted" />}
                    <span className="flex size-6 shrink-0 items-center justify-center rounded-full border border-brand/40 bg-brand-soft text-[11px] font-semibold text-brand-fg">{index + 1}</span>
                    <span className="truncate text-sm font-medium">{stage.name}</span>
                    <span className="hidden truncate text-xs text-muted sm:inline">
                      {DEPARTMENT_LABELS[stage.department]} · gate {stage.gate.name} · {stage.gate.requiredFields.length} campos · {stage.gate.checklist.length} itens · {stage.autoTasks.length} tarefas
                    </span>
                  </button>
                  <div className="flex shrink-0 items-center gap-1">
                    <Button variant="ghost" size="icon" className="size-9" aria-label="Subir etapa" disabled={pending || index === 0} onClick={() => move(index, -1)}>
                      <ArrowUp />
                    </Button>
                    <Button variant="ghost" size="icon" className="size-9" aria-label="Descer etapa" disabled={pending || index === stages.length - 1} onClick={() => move(index, 1)}>
                      <ArrowDown />
                    </Button>
                    <Button variant="ghost" size="icon" className="size-9 text-muted hover:text-danger" aria-label="Remover etapa" disabled={pending} onClick={() => remove(index)}>
                      <Trash2 />
                    </Button>
                  </div>
                </div>
                {expanded ? (
                  <div className="flex flex-col gap-5 border-t border-border px-3 py-4 md:px-4">
                    <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">
                      <FormField label="Nome" required>
                        <Input value={stage.name} onChange={(e) => updateStage(index, { name: e.target.value })} disabled={pending} />
                      </FormField>
                      <FormField label="Chave" required hint="Identificador estável (ex.: vendas)">
                        <Input value={stage.key} onChange={(e) => updateStage(index, { key: slug(e.target.value) || e.target.value })} disabled={pending} />
                      </FormField>
                      <FormField label="Departamento" required>
                        <Select value={stage.department} onChange={(e) => updateStage(index, { department: e.target.value as DepartmentKey })} disabled={pending} options={DEPARTMENT_KEYS.map((d) => ({ value: d, label: DEPARTMENT_LABELS[d] }))} />
                      </FormField>
                      <FormField label="Papel responsável" hint="Vazio: gestor do departamento">
                        <Select value={stage.defaultAssigneeRole ?? ""} onChange={(e) => updateStage(index, { defaultAssigneeRole: (e.target.value || undefined) as RoleKey | undefined })} disabled={pending}>
                          <option value="">Gestor do departamento</option>
                          {ROLE_KEYS.map((r) => (
                            <option key={r} value={r}>
                              {ROLE_LABELS[r]}
                            </option>
                          ))}
                        </Select>
                      </FormField>
                      <FormField label="Regra de SLA" hint="Chave em sla_rules (appliesTo workflow)">
                        <Select value={stage.slaRuleKey ?? ""} onChange={(e) => updateStage(index, { slaRuleKey: e.target.value || undefined })} disabled={pending}>
                          <option value="">Sem regra (usa horas fixas)</option>
                          {slaRuleKeys.map((k) => (
                            <option key={k} value={k}>
                              {k}
                            </option>
                          ))}
                          {stage.slaRuleKey && !slaRuleKeys.includes(stage.slaRuleKey) ? <option value={stage.slaRuleKey}>{stage.slaRuleKey}</option> : null}
                        </Select>
                      </FormField>
                      <FormField label="SLA em horas úteis" hint="Sobrescreve as horas da regra">
                        <Input type="number" min={1} value={stage.slaHours ?? ""} onChange={(e) => updateStage(index, { slaHours: e.target.value ? Number(e.target.value) : undefined })} disabled={pending} />
                      </FormField>
                      <FormField label="Descrição" className="md:col-span-2 xl:col-span-3">
                        <Input value={stage.description ?? ""} onChange={(e) => updateStage(index, { description: e.target.value })} disabled={pending} />
                      </FormField>
                    </div>

                    {/* Gate */}
                    <div className="flex flex-col gap-3 rounded-lg border border-border bg-surface-muted p-3">
                      <div className="grid gap-3 md:grid-cols-2">
                        <FormField label="Nome do gate" required>
                          <Input value={stage.gate.name} onChange={(e) => updateGate(index, { name: e.target.value })} disabled={pending} />
                        </FormField>
                        <FormField label="Critério de saída (exitCriteria)">
                          <Input value={stage.gate.exitCriteria} onChange={(e) => updateGate(index, { exitCriteria: e.target.value })} disabled={pending} />
                        </FormField>
                      </div>
                      <div className="grid gap-3 md:grid-cols-3">
                        <Switch checked={stage.gate.requiresApproval} onCheckedChange={(v) => updateGate(index, { requiresApproval: v, approverRole: v ? (stage.gate.approverRole ?? "gestor") : undefined })} label="Requer aprovação" disabled={pending} />
                        <FormField label="Papel aprovador">
                          <Select value={stage.gate.approverRole ?? ""} disabled={pending || !stage.gate.requiresApproval} onChange={(e) => updateGate(index, { approverRole: (e.target.value || undefined) as RoleKey | undefined })}>
                            <option value="">—</option>
                            {ROLE_KEYS.map((r) => (
                              <option key={r} value={r}>
                                {ROLE_LABELS[r]}
                              </option>
                            ))}
                          </Select>
                        </FormField>
                        <Switch checked={Boolean(stage.gate.requiresDocuments)} onCheckedChange={(v) => updateGate(index, { requiresDocuments: v })} label="Requer documentos" disabled={pending} />
                      </div>

                      <ListEditor
                        title="Campos obrigatórios"
                        items={stage.gate.requiredFields}
                        onAdd={() => updateGate(index, { requiredFields: [...stage.gate.requiredFields, { path: "", label: "", type: "texto" }] })}
                        onRemove={(i) => updateGate(index, { requiredFields: stage.gate.requiredFields.filter((_, k) => k !== i) })}
                        addLabel="Campo"
                        disabled={pending}
                        render={(f, i) => (
                          <div className="grid flex-1 gap-2 sm:grid-cols-[1fr_1fr_140px]">
                            <Input value={f.path} placeholder="path (ex.: lead.phone)" aria-label="Path" disabled={pending} onChange={(e) => updateGate(index, { requiredFields: stage.gate.requiredFields.map((x, k) => (k === i ? { ...x, path: e.target.value.trim() } : x)) })} />
                            <Input value={f.label} placeholder="Rótulo" aria-label="Rótulo" disabled={pending} onChange={(e) => updateGate(index, { requiredFields: stage.gate.requiredFields.map((x, k) => (k === i ? { ...x, label: e.target.value } : x)) })} />
                            <Select value={f.type} aria-label="Tipo" disabled={pending} options={FIELD_TYPES} onChange={(e) => updateGate(index, { requiredFields: stage.gate.requiredFields.map((x, k) => (k === i ? { ...x, type: e.target.value as GateField["type"] } : x)) })} />
                            {f.type === "selecao" ? (
                              <Input className="sm:col-span-3" value={(f.options ?? []).join(", ")} placeholder="Opções separadas por vírgula" aria-label="Opções" disabled={pending} onChange={(e) => updateGate(index, { requiredFields: stage.gate.requiredFields.map((x, k) => (k === i ? { ...x, options: e.target.value.split(",").map((o) => o.trim()).filter(Boolean) } : x)) })} />
                            ) : null}
                          </div>
                        )}
                      />

                      <ListEditor
                        title="Checklist"
                        items={stage.gate.checklist}
                        onAdd={() => updateGate(index, { checklist: [...stage.gate.checklist, { key: `item_${stage.gate.checklist.length + 1}`, label: "", required: true }] })}
                        onRemove={(i) => updateGate(index, { checklist: stage.gate.checklist.filter((_, k) => k !== i) })}
                        addLabel="Item"
                        disabled={pending}
                        render={(c, i) => (
                          <div className="grid flex-1 gap-2 sm:grid-cols-[160px_1fr_auto]">
                            <Input value={c.key} placeholder="chave" aria-label="Chave" disabled={pending} onChange={(e) => updateGate(index, { checklist: stage.gate.checklist.map((x, k) => (k === i ? { ...x, key: slug(e.target.value) || e.target.value } : x)) })} />
                            <Input value={c.label} placeholder="Rótulo do item" aria-label="Rótulo" disabled={pending} onChange={(e) => updateGate(index, { checklist: stage.gate.checklist.map((x, k) => (k === i ? { ...x, label: e.target.value } : x)) })} />
                            <Checkbox checked={c.required} label="Obrigatório" disabled={pending} onCheckedChange={(v) => updateGate(index, { checklist: stage.gate.checklist.map((x, k) => (k === i ? { ...x, required: v === true } : x)) })} className="md:min-h-9" />
                          </div>
                        )}
                      />
                    </div>

                    {/* Tarefas automáticas */}
                    <ListEditor
                      title="Tarefas automáticas"
                      items={stage.autoTasks}
                      onAdd={() => updateStage(index, { autoTasks: [...stage.autoTasks, { title: "", dueInHours: 8, priority: "media" }] })}
                      onRemove={(i) => updateStage(index, { autoTasks: stage.autoTasks.filter((_, k) => k !== i) })}
                      addLabel="Tarefa"
                      disabled={pending}
                      render={(t, i) => (
                        <div className="grid flex-1 gap-2 sm:grid-cols-[1fr_120px_140px]">
                          <Input value={t.title} placeholder="Título da tarefa" aria-label="Título" disabled={pending} onChange={(e) => updateStage(index, { autoTasks: stage.autoTasks.map((x, k) => (k === i ? { ...x, title: e.target.value } : x)) })} />
                          <Input type="number" min={1} value={t.dueInHours} aria-label="Prazo em horas" disabled={pending} onChange={(e) => updateStage(index, { autoTasks: stage.autoTasks.map((x, k) => (k === i ? { ...x, dueInHours: Number(e.target.value) || 0 } : x)) })} />
                          <Select value={t.priority} aria-label="Prioridade" disabled={pending} options={PRIORITIES.map((p) => ({ value: p, label: PRIORITY_LABELS[p] }))} onChange={(e) => updateStage(index, { autoTasks: stage.autoTasks.map((x, k) => (k === i ? { ...x, priority: e.target.value as Priority } : x)) })} />
                          <Textarea className="min-h-[40px] sm:col-span-3" value={t.description ?? ""} placeholder="Descrição (opcional)" aria-label="Descrição" disabled={pending} onChange={(e) => updateStage(index, { autoTasks: stage.autoTasks.map((x, k) => (k === i ? { ...x, description: e.target.value } : x)) })} />
                        </div>
                      )}
                    />
                  </div>
                ) : null}
              </li>
            );
          })}
        </ol>
      </section>

      {/* Rodapé fixo */}
      <div className="sticky bottom-[calc(var(--spacing-mobile-nav)+8px)] z-10 flex flex-col-reverse gap-2 rounded-lg border border-border bg-surface/95 p-3 shadow-pop backdrop-blur md:bottom-4 md:flex-row md:items-center md:justify-between">
        <p className="flex items-center gap-1.5 text-xs text-muted">
          {template.published ? <Lock className="size-3.5" /> : null}
          {template.published ? "Versão publicada: salvar cria uma nova versão em rascunho." : "Rascunho: salvar atualiza esta versão. Publique para usar em novas jornadas."}
        </p>
        <div className="flex gap-2">
          {!template.published ? (
            <Button variant="secondary" disabled={pending || dirty} title={dirty ? "Salve antes de publicar" : undefined} onClick={() => setConfirmPublish(true)}>
              <Rocket /> Publicar v{template.version}
            </Button>
          ) : null}
          <Button loading={pending} disabled={!dirty} onClick={save}>
            <Save /> {template.published ? `Salvar como v${Math.max(...versions.map((v) => v.version)) + 1}` : "Salvar rascunho"}
          </Button>
        </div>
      </div>

      <ConfirmDialog
        open={confirmPublish}
        onOpenChange={(o) => !o && setConfirmPublish(false)}
        title={`Publicar a versão v${template.version}?`}
        description="A versão publicada atual é despublicada. Jornadas em andamento continuam na versão em que começaram; novas jornadas usam esta."
        confirmLabel="Publicar"
        onConfirm={publish}
      />
    </div>
  );
}

function ListEditor<T>({ title, items, render, onAdd, onRemove, addLabel, disabled }: { title: string; items: T[]; render: (item: T, index: number) => React.ReactNode; onAdd: () => void; onRemove: (index: number) => void; addLabel: string; disabled?: boolean }) {
  return (
    <div className="flex flex-col gap-2">
      <div className="flex items-center justify-between">
        <h4 className="text-sm font-semibold">
          {title} <span className="text-xs font-normal text-muted">({items.length})</span>
        </h4>
        <Button variant="ghost" size="sm" onClick={onAdd} disabled={disabled}>
          <Plus /> {addLabel}
        </Button>
      </div>
      {items.length === 0 ? <p className="text-xs text-muted">Nenhum item.</p> : null}
      <ul className="flex flex-col gap-2">
        {items.map((item, i) => (
          <li key={i} className="flex items-start gap-2">
            {render(item, i)}
            <Button variant="ghost" size="icon" className="size-9 shrink-0 text-muted hover:text-danger" aria-label="Remover" disabled={disabled} onClick={() => onRemove(i)}>
              <Trash2 />
            </Button>
          </li>
        ))}
      </ul>
    </div>
  );
}
