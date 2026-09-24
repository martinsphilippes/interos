"use client";

import * as React from "react";
import { CalendarDays, Clock, GitBranch, Plus, Trash2, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { FormField } from "@/components/ui/form-field";
import { Input } from "@/components/ui/input";
import { Select } from "@/components/ui/select";
import { SegmentedControl } from "@/components/ui/segmented-control";
import { Switch } from "@/components/ui/switch";
import { Textarea } from "@/components/ui/textarea";
import { cn } from "@/lib/utils";
import {
  DEPARTMENT_KEYS,
  DEPARTMENT_LABELS,
  EVENT_TYPES,
  NOTIFICATION_KINDS,
  PRIORITIES,
  PRIORITY_LABELS,
  ROLE_KEYS,
  ROLE_LABELS,
  type DepartmentKey,
  type EventType,
} from "@/domain/constants";
import {
  CLIENT_OWNER_FIELDS,
  CLIENT_OWNER_LABELS,
  PROCESS_CONDITION_OPERATORS,
  PROCESS_CONDITION_OPERATOR_LABELS,
  PROCESS_NODE_DESCRIPTIONS,
  PROCESS_NODE_LABELS,
  nodeHasOutcome,
  type GraphIssue,
  type ProcessNode,
  type ProcessNodeDataMap,
  type ProcessNodeType,
  type ProcessTrigger,
} from "@/domain/workflow-graph";
import type { BuilderUser } from "@/server/process-engine/queries";
import { NODE_KINDS } from "./node-kinds";
import type { FlowEdge, FlowNode } from "./flow-graph";

const NOTIFICATION_KIND_LABELS: Record<(typeof NOTIFICATION_KINDS)[number], string> = { informativa: "Informativa", acao: "Ação", atencao: "Atenção", critica: "Crítica" };

const PATH_SUGGESTIONS = [
  "entity.status",
  "entity.amount",
  "entity.priority",
  "entity.adoptionPct",
  "client.status",
  "client.healthScore",
  "client.healthLevel",
  "client.mrr",
  "client.currentStage",
  "payload.amount",
  "payload.priority",
];

/** Tipos de evento agrupados pelo domínio ("payment.overdue" → payment). */
export const EVENT_GROUPS: { domain: string; types: EventType[] }[] = Object.entries(
  EVENT_TYPES.reduce<Record<string, EventType[]>>((acc, t) => {
    const d = t.split(".")[0];
    (acc[d] ??= []).push(t);
    return acc;
  }, {}),
).map(([domain, types]) => ({ domain, types }));

function EventSelect({ value, onChange, id }: { value?: string; onChange: (v: EventType) => void; id?: string }) {
  return (
    <Select id={id} value={value ?? ""} onChange={(e) => onChange(e.target.value as EventType)} placeholder="Escolha o evento">
      {EVENT_GROUPS.map((g) => (
        <optgroup key={g.domain} label={g.domain}>
          {g.types.map((t) => (
            <option key={t} value={t}>
              {t}
            </option>
          ))}
        </optgroup>
      ))}
    </Select>
  );
}

function RecipientSelect({ value, onChange, users, allowTeams, id }: { value: string; onChange: (v: string) => void; users: BuilderUser[]; allowTeams?: boolean; id?: string }) {
  const known = value === "gestor_departamento" || value.startsWith("papel:") || value.startsWith("responsavel_cliente:") || value.startsWith("departamento:") || users.some((u) => u.id === value);
  return (
    <Select id={id} value={value} onChange={(e) => onChange(e.target.value)}>
      {!known && value ? <option value={value}>{value}</option> : null}
      <option value="gestor_departamento">Gestor do departamento</option>
      <optgroup label="Responsável do cliente">
        {CLIENT_OWNER_FIELDS.map((f) => (
          <option key={f} value={`responsavel_cliente:${f}`}>
            {CLIENT_OWNER_LABELS[f]}
          </option>
        ))}
      </optgroup>
      <optgroup label="Papel (quem tiver menos tarefas)">
        {ROLE_KEYS.map((r) => (
          <option key={r} value={`papel:${r}`}>
            Papel: {ROLE_LABELS[r]}
          </option>
        ))}
      </optgroup>
      {allowTeams ? (
        <optgroup label="Equipe inteira">
          {DEPARTMENT_KEYS.map((d) => (
            <option key={d} value={`departamento:${d}`}>
              Equipe de {DEPARTMENT_LABELS[d]}
            </option>
          ))}
        </optgroup>
      ) : null}
      <optgroup label="Usuário específico">
        {users.map((u) => (
          <option key={u.id} value={u.id}>
            {u.name} · {DEPARTMENT_LABELS[u.departmentId]}
          </option>
        ))}
      </optgroup>
    </Select>
  );
}

function DepartmentSelect({ value, onChange, id, allowEmpty }: { value?: DepartmentKey; onChange: (v: DepartmentKey | undefined) => void; id?: string; allowEmpty?: string }) {
  return (
    <Select id={id} value={value ?? ""} onChange={(e) => onChange((e.target.value || undefined) as DepartmentKey | undefined)}>
      {allowEmpty ? <option value="">{allowEmpty}</option> : null}
      {DEPARTMENT_KEYS.map((d) => (
        <option key={d} value={d}>
          {DEPARTMENT_LABELS[d]}
        </option>
      ))}
    </Select>
  );
}

function NumberInput({ value, onChange, suffix, id, min = 0, step = 1 }: { value: number | undefined; onChange: (v: number) => void; suffix: React.ReactNode; id?: string; min?: number; step?: number }) {
  return (
    <Input
      id={id}
      type="number"
      inputMode="decimal"
      min={min}
      step={step}
      value={Number.isFinite(value) ? String(value) : ""}
      onChange={(e) => onChange(e.target.value === "" ? 0 : Math.max(min, Number(e.target.value)))}
      trailing={<span className="flex items-center gap-1 pr-1 text-xs text-muted">{suffix}</span>}
    />
  );
}

/** Campos obrigatórios (marcados) e itens opcionais do checklist da tarefa. */
function ChecklistEditor({ required, optional, onChange }: { required: string[]; optional: string[]; onChange: (next: { requiredFields: string[]; checklist: string[] }) => void }) {
  const [draft, setDraft] = React.useState("");
  const items = [...required.map((label) => ({ label, required: true })), ...optional.map((label) => ({ label, required: false }))];
  const emit = (next: { label: string; required: boolean }[]) =>
    onChange({ requiredFields: next.filter((i) => i.required).map((i) => i.label), checklist: next.filter((i) => !i.required).map((i) => i.label) });
  const add = () => {
    const label = draft.trim();
    if (!label || items.some((i) => i.label === label)) return;
    emit([...items, { label, required: true }]);
    setDraft("");
  };
  return (
    <div className="flex flex-col gap-2">
      {items.length === 0 ? <p className="text-xs text-muted">Nenhum item. Itens marcados são obrigatórios para concluir a tarefa.</p> : null}
      <ul className="flex flex-col gap-1.5">
        {items.map((item, i) => (
          <li key={item.label} className="group flex min-h-[32px] items-center gap-2">
            <Checkbox
              checked={item.required}
              onCheckedChange={(v) => emit(items.map((it, j) => (j === i ? { ...it, required: v === true } : it)))}
              aria-label={`${item.label}: obrigatório`}
            />
            <span className={cn("flex-1 text-sm", item.required ? "text-foreground" : "text-muted")}>{item.label}</span>
            <button type="button" className="rounded p-1 text-muted-light hover:bg-surface-hover hover:text-danger-fg" onClick={() => emit(items.filter((_, j) => j !== i))} aria-label={`Remover ${item.label}`}>
              <X className="size-3.5" />
            </button>
          </li>
        ))}
      </ul>
      <div className="flex gap-2">
        <Input value={draft} onChange={(e) => setDraft(e.target.value)} onKeyDown={(e) => e.key === "Enter" && (e.preventDefault(), add())} placeholder="Novo item (Enter)" aria-label="Novo item do checklist" />
        <Button variant="outline" size="icon" onClick={add} aria-label="Adicionar item">
          <Plus />
        </Button>
      </div>
    </div>
  );
}

function Section({ title, hint, children }: { title: string; hint?: string; children: React.ReactNode }) {
  return (
    <section className="flex flex-col gap-3 border-t border-border pt-4">
      <div>
        <h3 className="text-sm font-semibold">{title}</h3>
        {hint ? <p className="text-xs text-muted">{hint}</p> : null}
      </div>
      {children}
    </section>
  );
}

export interface ProcessMeta {
  name: string;
  description?: string;
  trigger: ProcessTrigger;
}

export interface PropertiesPanelProps {
  node: FlowNode | null;
  edge: FlowEdge | null;
  nodes: FlowNode[];
  meta: ProcessMeta;
  users: BuilderUser[];
  issues: GraphIssue[];
  webhooksEnabled: boolean;
  onMetaChange: (patch: Partial<ProcessMeta>) => void;
  onNodeChange: (id: string, patch: Partial<ProcessNodeDataMap[ProcessNodeType]>) => void;
  onEdgeBranch: (id: string, branch: "sim" | "nao" | undefined) => void;
  onDeleteNode: (id: string) => void;
  onDeleteEdge: (id: string) => void;
  onAddRule: (id: string) => void;
  onClose?: () => void;
}

export function PropertiesPanel(props: PropertiesPanelProps) {
  const { node, edge, onClose } = props;
  const title = node ? (
    <span className="flex min-w-0 items-center gap-2.5">
      <span className={cn("flex size-7 shrink-0 items-center justify-center rounded-md [&_svg]:size-4", NODE_KINDS[node.type as ProcessNodeType].iconBox)}>
        {React.createElement(NODE_KINDS[node.type as ProcessNodeType].icon, { "aria-hidden": true })}
      </span>
      <span className="truncate">{node.data.label || PROCESS_NODE_LABELS[node.type as ProcessNodeType]}</span>
    </span>
  ) : edge ? (
    "Ligação"
  ) : (
    "Processo"
  );
  return (
    <div className="flex h-full flex-col">
      <div className="flex items-center justify-between gap-2 border-b border-border px-4 py-3">
        <h2 className="text-base font-semibold">Propriedades</h2>
        {onClose ? (
          <Button variant="ghost" size="icon" onClick={onClose} aria-label="Fechar propriedades">
            <X />
          </Button>
        ) : null}
      </div>
      <div className="flex-1 overflow-y-auto px-4 py-4 scrollbar-thin">
        <div className="mb-4 flex items-center gap-2 rounded-lg border border-border bg-surface-muted px-3 py-2.5 text-sm font-medium">{title}</div>
        {node ? <NodeForm {...props} node={node} /> : edge ? <EdgeForm {...props} edge={edge} /> : <MetaForm {...props} />}
      </div>
    </div>
  );
}

function MetaForm({ meta, onMetaChange }: PropertiesPanelProps) {
  return (
    <div className="flex flex-col gap-4">
      <p className="text-xs text-muted">Selecione um bloco no canvas para editar. Arraste blocos da paleta ou clique para adicioná-los; ligue os pontos de saída às entradas.</p>
      <MetaFields meta={meta} onMetaChange={onMetaChange} />
    </div>
  );
}

function MetaFields({ meta, onMetaChange }: Pick<PropertiesPanelProps, "meta" | "onMetaChange">) {
  return (
    <>
      <FormField label="Nome do processo" htmlFor="pp-name" required>
        <Input id="pp-name" value={meta.name} onChange={(e) => onMetaChange({ name: e.target.value })} />
      </FormField>
      <FormField label="Descrição" htmlFor="pp-desc">
        <Textarea id="pp-desc" rows={2} value={meta.description ?? ""} onChange={(e) => onMetaChange({ description: e.target.value })} />
      </FormField>
      <FormField label="Gatilho" hint={meta.trigger.type === "evento" ? "Cada ocorrência do evento inicia uma execução (uma por registro)." : "Iniciado pela tela de execuções."}>
        <SegmentedControl
          aria-label="Tipo de gatilho"
          value={meta.trigger.type}
          onChange={(v) => onMetaChange({ trigger: v === "manual" ? { type: "manual" } : { type: "evento", eventType: meta.trigger.type === "evento" ? meta.trigger.eventType : "payment.overdue" } })}
          options={[
            { value: "evento", label: "Evento" },
            { value: "manual", label: "Manual" },
          ]}
        />
        {meta.trigger.type === "evento" ? <EventSelect id="pp-event" value={meta.trigger.eventType} onChange={(eventType) => onMetaChange({ trigger: { type: "evento", eventType } })} /> : null}
      </FormField>
    </>
  );
}

function EdgeForm({ edge, nodes, onEdgeBranch, onDeleteEdge }: PropertiesPanelProps & { edge: FlowEdge }) {
  const source = nodes.find((n) => n.id === edge.source);
  const target = nodes.find((n) => n.id === edge.target);
  const branchable = source ? source.type === "condicao" || nodeHasOutcome({ id: source.id, type: source.type, position: source.position, data: source.data } as ProcessNode) : false;
  return (
    <div className="flex flex-col gap-4">
      <p className="text-sm text-muted">
        De <span className="text-foreground">{source?.data.label ?? "—"}</span> para <span className="text-foreground">{target?.data.label ?? "—"}</span>
      </p>
      {branchable ? (
        <FormField label="Saída" hint="Condições precisam de uma saída Sim e uma Não.">
          <SegmentedControl
            aria-label="Rótulo da saída"
            value={edge.data?.branch ?? "none"}
            onChange={(v) => onEdgeBranch(edge.id, v === "none" ? undefined : v)}
            options={[
              { value: "sim", label: "Sim" },
              { value: "nao", label: "Não" },
              { value: "none", label: "Sem rótulo" },
            ]}
          />
        </FormField>
      ) : null}
      <Button variant="outline" className="text-danger-fg" onClick={() => onDeleteEdge(edge.id)}>
        <Trash2 /> Remover ligação
      </Button>
    </div>
  );
}

function NodeForm(props: PropertiesPanelProps & { node: FlowNode }) {
  const { node, onNodeChange, onDeleteNode, issues } = props;
  const type = node.type as ProcessNodeType;
  const set = (patch: Partial<ProcessNodeDataMap[ProcessNodeType]>) => onNodeChange(node.id, patch);
  const nodeIssues = issues.filter((i) => i.nodeId === node.id);
  return (
    <div className="flex flex-col gap-4">
      <p className="text-xs text-muted">{PROCESS_NODE_DESCRIPTIONS[type]}</p>
      {nodeIssues.length > 0 ? (
        <ul className="flex flex-col gap-1 rounded-lg border border-danger/35 bg-danger-soft px-3 py-2 text-xs text-danger-fg">
          {nodeIssues.map((i) => (
            <li key={i.message}>{i.message}</li>
          ))}
        </ul>
      ) : null}
      <FormField label={type === "condicao" ? "Pergunta / nome da condição" : "Nome da etapa"} htmlFor="pp-label" required>
        <Input id="pp-label" value={node.data.label} onChange={(e) => set({ label: e.target.value })} />
      </FormField>

      {type === "inicio" ? <MetaFields meta={props.meta} onMetaChange={props.onMetaChange} /> : null}
      {type === "tarefa" ? <TaskFields {...props} data={node.data as ProcessNodeDataMap["tarefa"]} set={set} /> : null}
      {type === "aprovacao" ? <ApprovalFields data={node.data as ProcessNodeDataMap["aprovacao"]} set={set} /> : null}
      {type === "condicao" ? <ConditionFields {...props} data={node.data as ProcessNodeDataMap["condicao"]} set={set} /> : null}
      {type === "espera" ? <WaitFields data={node.data as ProcessNodeDataMap["espera"]} set={set} /> : null}
      {type === "notificacao" ? <NotificationFields users={props.users} data={node.data as ProcessNodeDataMap["notificacao"]} set={set} /> : null}
      {type === "integracao" ? <IntegrationFields enabled={props.webhooksEnabled} data={node.data as ProcessNodeDataMap["integracao"]} set={set} /> : null}

      {type !== "fim" && type !== "condicao" ? (
        <button
          type="button"
          onClick={() => props.onAddRule(node.id)}
          className="flex min-h-[44px] items-center justify-center gap-2 rounded-lg border border-dashed border-brand/50 text-sm font-medium text-brand-fg transition-colors hover:bg-brand-soft"
        >
          <Plus className="size-4" /> Adicionar regra
        </button>
      ) : null}
      <Button variant="ghost" className="self-start text-danger-fg" onClick={() => onDeleteNode(node.id)}>
        <Trash2 /> Remover bloco
      </Button>
    </div>
  );
}

type SetFn = (patch: Partial<ProcessNodeDataMap[ProcessNodeType]>) => void;

function TaskFields({ data, set, users }: { data: ProcessNodeDataMap["tarefa"]; set: SetFn; users: BuilderUser[] }) {
  return (
    <>
      <FormField label="Departamento responsável" htmlFor="pp-dept">
        <DepartmentSelect id="pp-dept" value={data.department} onChange={(v) => v && set({ department: v })} />
      </FormField>
      <FormField label="Responsável padrão" htmlFor="pp-assignee" hint="Sem ninguém encontrado, a tarefa vai para o gestor do departamento.">
        <RecipientSelect id="pp-assignee" value={data.assignee} onChange={(v) => set({ assignee: v })} users={users} />
      </FormField>
      <div className="grid grid-cols-2 gap-3">
        <FormField label="Prazo" htmlFor="pp-due">
          <NumberInput id="pp-due" value={data.dueBusinessDays} onChange={(v) => set({ dueBusinessDays: Math.round(v) })} suffix={<>dias úteis <CalendarDays className="size-3.5" /></>} />
        </FormField>
        <FormField label="SLA" htmlFor="pp-sla">
          <NumberInput id="pp-sla" value={data.slaHours} onChange={(v) => set({ slaHours: v })} suffix={<>horas <Clock className="size-3.5" /></>} />
        </FormField>
      </div>
      <FormField label="Prioridade" htmlFor="pp-priority">
        <Select id="pp-priority" value={data.priority} onChange={(e) => set({ priority: e.target.value as ProcessNodeDataMap["tarefa"]["priority"] })} options={PRIORITIES.map((p) => ({ value: p, label: PRIORITY_LABELS[p] }))} />
      </FormField>
      <Section title="Automação" hint="Ao entrar nesta etapa">
        <Switch size="sm" checked={data.autoCreateTask} onCheckedChange={(v) => set({ autoCreateTask: v })} label="Criar tarefa automaticamente" />
        <Switch size="sm" checked={data.notify} onCheckedChange={(v) => set({ notify: v })} label="Enviar notificação" />
        <Switch
          size="sm"
          checked={data.outcome === "sim_nao"}
          onCheckedChange={(v) => set({ outcome: v ? "sim_nao" : undefined, outcomeQuestion: v ? data.outcomeQuestion || `${data.label}?` : undefined })}
          label="Pedir resposta Sim/Não ao concluir"
        />
        {data.outcome === "sim_nao" ? (
          <FormField label="Pergunta" htmlFor="pp-question" hint="Lida por um bloco Condição (modo resposta de etapa).">
            <Input id="pp-question" value={data.outcomeQuestion ?? ""} onChange={(e) => set({ outcomeQuestion: e.target.value })} placeholder="Ex.: Cliente homologou?" />
          </FormField>
        ) : null}
      </Section>
      <Section title="Campos obrigatórios" hint="Marcados: obrigatórios para concluir. Desmarcados: checklist opcional.">
        <ChecklistEditor required={data.requiredFields} optional={data.checklist} onChange={(next) => set(next)} />
      </Section>
      <FormField label="Instruções" htmlFor="pp-desc-task">
        <Textarea id="pp-desc-task" rows={2} value={data.description ?? ""} onChange={(e) => set({ description: e.target.value })} />
      </FormField>
    </>
  );
}

function ApprovalFields({ data, set }: { data: ProcessNodeDataMap["aprovacao"]; set: SetFn }) {
  return (
    <>
      <FormField label="Papel aprovador" htmlFor="pp-role" hint="A tarefa vai para quem tem o papel e menos tarefas abertas.">
        <Select id="pp-role" value={data.approverRole} onChange={(e) => set({ approverRole: e.target.value as ProcessNodeDataMap["aprovacao"]["approverRole"] })} options={ROLE_KEYS.map((r) => ({ value: r, label: ROLE_LABELS[r] }))} />
      </FormField>
      <FormField label="Departamento da tarefa" htmlFor="pp-approval-dept">
        <DepartmentSelect id="pp-approval-dept" value={data.department} onChange={(v) => set({ department: v })} allowEmpty="O do aprovador" />
      </FormField>
      <FormField label="SLA" htmlFor="pp-approval-sla">
        <NumberInput id="pp-approval-sla" value={data.slaHours} onChange={(v) => set({ slaHours: v })} suffix={<>horas <Clock className="size-3.5" /></>} />
      </FormField>
      <p className="text-xs text-muted">Resposta Aprovar = Sim, Reprovar = Não. Use uma Condição (resposta de etapa) para desviar o fluxo.</p>
    </>
  );
}

function ConditionFields({ data, set, nodes }: { data: ProcessNodeDataMap["condicao"]; set: SetFn; nodes: FlowNode[] }) {
  const sources = nodes.filter((n) => nodeHasOutcome({ id: n.id, type: n.type, position: n.position, data: n.data } as ProcessNode));
  return (
    <>
      <FormField label="Avaliar">
        <SegmentedControl
          aria-label="Modo da condição"
          value={data.mode}
          onChange={(mode) => set({ mode })}
          options={[
            { value: "resultado", label: "Resposta de etapa" },
            { value: "contexto", label: "Dado do registro" },
          ]}
        />
      </FormField>
      {data.mode === "resultado" ? (
        <FormField label="Etapa com resposta Sim/Não" htmlFor="pp-from" hint={sources.length === 0 ? "Ative “Pedir resposta Sim/Não” em uma tarefa ou use uma Aprovação." : undefined}>
          <Select id="pp-from" value={data.fromNode ?? ""} onChange={(e) => set({ fromNode: e.target.value || undefined })} placeholder="Escolha a etapa">
            {sources.map((n) => (
              <option key={n.id} value={n.id}>
                {n.data.label}
              </option>
            ))}
          </Select>
        </FormField>
      ) : (
        <>
          <FormField label="Campo" htmlFor="pp-path" hint="Ex.: entity.status (registro do gatilho), client.healthScore, payload.amount.">
            <Input id="pp-path" list="pp-path-suggestions" value={data.path ?? ""} onChange={(e) => set({ path: e.target.value })} placeholder="entity.status" />
            <datalist id="pp-path-suggestions">
              {PATH_SUGGESTIONS.map((p) => (
                <option key={p} value={p} />
              ))}
            </datalist>
          </FormField>
          <div className="grid grid-cols-2 gap-3">
            <FormField label="Operador" htmlFor="pp-op">
              <Select id="pp-op" value={data.operator ?? "=="} onChange={(e) => set({ operator: e.target.value as ProcessNodeDataMap["condicao"]["operator"] })} options={PROCESS_CONDITION_OPERATORS.map((o) => ({ value: o, label: PROCESS_CONDITION_OPERATOR_LABELS[o] }))} />
            </FormField>
            {data.operator !== "exists" ? (
              <FormField label="Valor" htmlFor="pp-value">
                <Input id="pp-value" value={data.value ?? ""} onChange={(e) => set({ value: e.target.value })} placeholder="paga" />
              </FormField>
            ) : null}
          </div>
        </>
      )}
      <p className="flex items-center gap-1.5 text-xs text-muted">
        <GitBranch className="size-3.5" /> Saída de baixo = <span className="text-success-fg">Sim</span>; saída da direita = <span className="text-danger-fg">Não</span>.
      </p>
    </>
  );
}

function WaitFields({ data, set }: { data: ProcessNodeDataMap["espera"]; set: SetFn }) {
  const hours = Number(data.businessHours) || 0;
  return (
    <>
      <FormField label="Esperar por">
        <SegmentedControl
          aria-label="Tipo de espera"
          value={data.mode}
          onChange={(mode) => set({ mode })}
          options={[
            { value: "horas_uteis", label: "Horas úteis" },
            { value: "evento", label: "Evento" },
          ]}
        />
      </FormField>
      {data.mode === "horas_uteis" ? (
        <FormField label="Duração" htmlFor="pp-hours" hint={hours ? `≈ ${Math.round((hours / 10) * 10) / 10} dia(s) úteis (expediente de 10h)` : undefined}>
          <NumberInput id="pp-hours" value={data.businessHours} onChange={(v) => set({ businessHours: v })} suffix="horas úteis" />
        </FormField>
      ) : (
        <FormField label="Evento aguardado" htmlFor="pp-until" hint="Avança quando o evento ocorrer para o mesmo cliente.">
          <EventSelect id="pp-until" value={data.untilEvent} onChange={(untilEvent) => set({ untilEvent })} />
        </FormField>
      )}
    </>
  );
}

function NotificationFields({ data, set, users }: { data: ProcessNodeDataMap["notificacao"]; set: SetFn; users: BuilderUser[] }) {
  return (
    <>
      <FormField label="Destinatário" htmlFor="pp-to">
        <RecipientSelect id="pp-to" value={data.to} onChange={(v) => set({ to: v })} users={users} allowTeams />
      </FormField>
      <FormField label="Departamento de referência" htmlFor="pp-notif-dept" hint="Usado por “Gestor do departamento” e pelos papéis.">
        <DepartmentSelect id="pp-notif-dept" value={data.department} onChange={(v) => set({ department: v })} allowEmpty="—" />
      </FormField>
      <FormField label="Tipo" htmlFor="pp-kind">
        <Select id="pp-kind" value={data.kind} onChange={(e) => set({ kind: e.target.value as ProcessNodeDataMap["notificacao"]["kind"] })} options={NOTIFICATION_KINDS.map((k) => ({ value: k, label: NOTIFICATION_KIND_LABELS[k] }))} />
      </FormField>
      <FormField label="Título" htmlFor="pp-title" hint="Aceita {{client.tradeName}}, {{entity.status}}…">
        <Input id="pp-title" value={data.title} onChange={(e) => set({ title: e.target.value })} />
      </FormField>
      <FormField label="Mensagem" htmlFor="pp-body">
        <Textarea id="pp-body" rows={3} value={data.body ?? ""} onChange={(e) => set({ body: e.target.value })} />
      </FormField>
    </>
  );
}

function IntegrationFields({ data, set, enabled }: { data: ProcessNodeDataMap["integracao"]; set: SetFn; enabled: boolean }) {
  return (
    <>
      <FormField label="URL do webhook" htmlFor="pp-url">
        <Input id="pp-url" type="url" value={data.url} onChange={(e) => set({ url: e.target.value })} placeholder="https://" />
      </FormField>
      <FormField label="Método" htmlFor="pp-method">
        <Select id="pp-method" value={data.method} onChange={(e) => set({ method: e.target.value as ProcessNodeDataMap["integracao"]["method"] })} options={["POST", "PUT", "PATCH", "GET"].map((m) => ({ value: m, label: m }))} />
      </FormField>
      <p className={cn("rounded-lg border px-3 py-2 text-xs", enabled ? "border-success/30 bg-success-soft text-success-fg" : "border-warning/30 bg-warning-soft text-warning-fg")}>
        {enabled ? "Webhooks ligados: a chamada é feita de verdade (timeout de 5s)." : "Webhooks desligados (AUTOMATION_WEBHOOKS_ENABLED): a chamada é apenas registrada no histórico, não é enviada."}
      </p>
    </>
  );
}
