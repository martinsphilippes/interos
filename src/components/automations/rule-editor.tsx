"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useMemo, useState, useTransition } from "react";
import { ArrowDown, ArrowUp, CheckCircle2, FlaskConical, Plus, Save, Trash2, XCircle } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { ConfirmDialog } from "@/components/ui/confirm-dialog";
import { FormField } from "@/components/ui/form-field";
import { Input } from "@/components/ui/input";
import { SegmentedControl } from "@/components/ui/segmented-control";
import { Select } from "@/components/ui/select";
import { EventTypeSelect } from "@/components/ui/event-type-select";
import { Switch } from "@/components/ui/switch";
import { Textarea } from "@/components/ui/textarea";
import { toast } from "@/components/ui/toast";
import { formatDateTime } from "@/lib/format";
import { shortId } from "@/lib/utils";
import { DEPARTMENT_KEYS, DEPARTMENT_LABELS, NOTIFICATION_KINDS, PRIORITIES, PRIORITY_LABELS, type EventType } from "@/domain/constants";
import { deleteAutomationRule, getPathSuggestionsAction, saveAutomationRule, testAutomationRule } from "@/server/automations/actions";
import type { SimulationResult } from "@/server/automations/engine";
import type { EditorOptions } from "@/server/automations/queries";
import {
  ACTION_TYPES,
  ACTION_TYPE_LABELS,
  CONDITION_OPERATORS,
  CONDITION_OPERATOR_LABELS,
  HANDOFF_DEPARTMENTS,
  SCAN_ENTITIES,
  SCAN_ENTITY_LABELS,
  SCHEDULES,
  SCHEDULE_LABELS,
  SLA_ENTITY_TYPES,
  STATUS_WHITELIST,
  SWEEP_DEFINITIONS,
  SWEEP_KEYS,
  type AutomationRuleRecord,
  type ConditionOperator,
  type RuleActionType,
  type RuleSchedule,
  type ScanEntity,
  type SweepKey,
} from "@/server/automations/schemas";
import { RUN_STATUS_LABELS, RUN_STATUS_VARIANT } from "./model";

type Params = Record<string, string>;

interface DraftCondition {
  key: string;
  path: string;
  operator: ConditionOperator;
  value: string;
}

interface DraftAction {
  key: string;
  type: RuleActionType;
  params: Params;
}

interface Draft {
  id?: string;
  name: string;
  description: string;
  active: boolean;
  triggerType: "evento" | "agendado";
  eventType: string;
  schedule: RuleSchedule;
  target: "sweep" | "entity";
  sweep: SweepKey | "";
  entity: ScanEntity | "";
  conditions: DraftCondition[];
  actions: DraftAction[];
}

const NOTIFICATION_KIND_LABELS: Record<string, string> = { informativa: "Informativa", acao: "Ação", atencao: "Atenção", critica: "Crítica" };
const SLA_ENTITY_LABELS: Record<string, string> = { tarefa: "Tarefa", workflow_step: "Etapa de workflow", chamado: "Chamado", projeto: "Projeto", cs: "Conta de CS", oportunidade: "Oportunidade" };

function defaultParams(type: RuleActionType, options: EditorOptions): Params {
  switch (type) {
    case "criar_tarefa":
      return { title: "", description: "", assignee: "", department: "", priority: "media", dueInHours: "24" };
    case "notificar":
      return { to: "responsavel_entidade", kind: "informativa", title: "", body: "", href: "" };
    case "mudar_status":
      return { collection: "tasks", field: "priority", value: "alta" };
    case "iniciar_sla":
      return { ruleKey: options.slaRules[0]?.key ?? "", entityType: "" };
    case "criar_handoff":
      return { department: "cs", title: "", note: "", dueInHours: "8" };
    case "criar_plano_sucesso":
      return { objective: "", actions: "", checkpointInDays: "15" };
    case "webhook":
      return { url: "", method: "POST" };
  }
}

function toDraft(rule: AutomationRuleRecord | null): Draft {
  if (!rule) {
    return { name: "", description: "", active: true, triggerType: "evento", eventType: "", schedule: "diaria", target: "sweep", sweep: "", entity: "", conditions: [], actions: [] };
  }
  const t = rule.trigger;
  return {
    id: rule.id,
    name: rule.name,
    description: rule.description ?? "",
    active: rule.active,
    triggerType: t.type,
    eventType: t.eventType ?? "",
    schedule: (SCHEDULES as readonly string[]).includes(t.schedule ?? "") ? (t.schedule as RuleSchedule) : "diaria",
    target: t.entity ? "entity" : "sweep",
    sweep: t.sweep ?? "",
    entity: t.entity ?? "",
    conditions: rule.conditions.map((c) => ({ key: shortId("c"), path: c.path, operator: c.operator, value: c.value === undefined || c.value === null ? "" : String(c.value) })),
    actions: rule.actions.map((a) => ({
      key: shortId("a"),
      type: a.type,
      params: Object.fromEntries(Object.entries(a.params ?? {}).map(([k, v]) => [k, Array.isArray(v) ? v.join(a.type === "notificar" ? ", " : "\n") : v === undefined || v === null ? "" : String(v)])),
    })),
  };
}

function toPayload(d: Draft) {
  const usesActions = d.triggerType === "evento" || d.target === "entity";
  return {
    id: d.id,
    name: d.name,
    description: d.description,
    active: d.active,
    trigger:
      d.triggerType === "evento"
        ? { type: "evento", eventType: d.eventType || undefined }
        : { type: "agendado", schedule: d.schedule, sweep: d.target === "sweep" ? d.sweep || undefined : undefined, entity: d.target === "entity" ? d.entity || undefined : undefined },
    conditions: usesActions ? d.conditions.map((c) => ({ path: c.path.trim(), operator: c.operator, value: c.operator === "exists" ? (c.value === "false" ? false : undefined) : c.value })) : [],
    actions: usesActions
      ? d.actions.map((a) => {
          const params: Record<string, unknown> = { ...a.params };
          if (a.type === "notificar") {
            const to = (a.params.to ?? "").split(",").map((s) => s.trim()).filter(Boolean);
            params.to = to.length <= 1 ? (to[0] ?? "") : to;
          }
          if (a.type === "criar_plano_sucesso") params.actions = (a.params.actions ?? "").split("\n").map((s) => s.trim()).filter(Boolean);
          return { type: a.type, params };
        })
      : [],
  };
}

function Field({ label, hint, children, className }: { label: string; hint?: string; children: React.ReactNode; className?: string }) {
  return (
    <FormField label={label} hint={hint} className={className}>
      {children}
    </FormField>
  );
}

function ActionParams({ action, options, onChange }: { action: DraftAction; options: EditorOptions; onChange: (params: Params) => void }) {
  const p = action.params;
  const set = (key: string, value: string) => onChange({ ...p, [key]: value });
  const text = (key: string, label: string, hint?: string, placeholder?: string) => (
    <Field label={label} hint={hint}>
      <Input value={p[key] ?? ""} onChange={(e) => set(key, e.target.value)} placeholder={placeholder} className="h-11 md:h-9" />
    </Field>
  );
  const recipient = (key: string, label: string, hint: string) => (
    <Field label={label} hint={hint}>
      <Input value={p[key] ?? ""} onChange={(e) => set(key, e.target.value)} list="automation-recipients" placeholder="responsavel_entidade" className="h-11 md:h-9" />
    </Field>
  );
  switch (action.type) {
    case "criar_tarefa":
      return (
        <div className="grid gap-3 md:grid-cols-2">
          {text("title", "Título", "Aceita {{client.tradeName}}, {{entity.title}}, {{payload.priority}}...", "Contato com {{client.tradeName}}")}
          {recipient("assignee", "Responsável", "Vazio = responsável do cliente/registro no departamento, senão o gestor")}
          <Field label="Departamento">
            <Select value={p.department ?? ""} onChange={(e) => set("department", e.target.value)} placeholder="Do evento/registro" options={DEPARTMENT_KEYS.map((d) => ({ value: d, label: DEPARTMENT_LABELS[d] }))} />
          </Field>
          <div className="grid grid-cols-2 gap-3">
            <Field label="Prioridade">
              <Select value={p.priority ?? "media"} onChange={(e) => set("priority", e.target.value)} options={PRIORITIES.map((v) => ({ value: v, label: PRIORITY_LABELS[v] }))} />
            </Field>
            <Field label="Prazo (horas)">
              <Input type="number" min={0} inputMode="numeric" value={p.dueInHours ?? ""} onChange={(e) => set("dueInHours", e.target.value)} className="h-11 md:h-9" />
            </Field>
          </div>
          <Field label="Descrição (opcional)" className="md:col-span-2">
            <Textarea value={p.description ?? ""} onChange={(e) => set("description", e.target.value)} rows={2} placeholder="Vazio = descrição automática com o gatilho" />
          </Field>
        </div>
      );
    case "notificar":
      return (
        <div className="grid gap-3 md:grid-cols-2">
          {recipient("to", "Destinatários", "Separe vários por vírgula (ex.: sla.ownerId, department.managerId)")}
          <Field label="Tipo">
            <Select value={p.kind ?? "informativa"} onChange={(e) => set("kind", e.target.value)} options={NOTIFICATION_KINDS.map((k) => ({ value: k, label: NOTIFICATION_KIND_LABELS[k] }))} />
          </Field>
          {text("title", "Título (opcional)", "Vazio = nome da regra")}
          {text("body", "Texto (opcional)", "Vazio = título do evento")}
          {text("href", "Link (opcional)", "Vazio = tela do registro", "/clientes/{{client.id}}")}
        </div>
      );
    case "mudar_status": {
      const collection = STATUS_WHITELIST[p.collection] ? p.collection : "tasks";
      const fields = STATUS_WHITELIST[collection].fields;
      const field = fields[p.field] ? p.field : Object.keys(fields)[0];
      return (
        <div className="grid gap-3 md:grid-cols-3">
          <Field label="Registro">
            <Select
              value={collection}
              onChange={(e) => {
                const next = e.target.value;
                const firstField = Object.keys(STATUS_WHITELIST[next].fields)[0];
                onChange({ collection: next, field: firstField, value: STATUS_WHITELIST[next].fields[firstField].values[0] });
              }}
              options={Object.entries(STATUS_WHITELIST).map(([k, v]) => ({ value: k, label: v.label }))}
            />
          </Field>
          <Field label="Campo">
            <Select value={field} onChange={(e) => onChange({ ...p, collection, field: e.target.value, value: fields[e.target.value].values[0] })} options={Object.entries(fields).map(([k, v]) => ({ value: k, label: v.label }))} />
          </Field>
          <Field label="Novo valor">
            <Select value={p.value ?? ""} onChange={(e) => set("value", e.target.value)} options={fields[field].values.map((v) => ({ value: v, label: v }))} />
          </Field>
        </div>
      );
    }
    case "iniciar_sla":
      return (
        <div className="grid gap-3 md:grid-cols-2">
          <Field label="Regra de SLA">
            <Select value={p.ruleKey ?? ""} onChange={(e) => set("ruleKey", e.target.value)} placeholder="Escolha" options={options.slaRules.map((r) => ({ value: r.key, label: `${r.name} (${r.key})` }))} />
          </Field>
          <Field label="Tipo do registro" hint="Vazio = deduzido do gatilho">
            <Select value={p.entityType ?? ""} onChange={(e) => set("entityType", e.target.value)} placeholder="Automático" options={SLA_ENTITY_TYPES.map((t) => ({ value: t, label: SLA_ENTITY_LABELS[t] }))} />
          </Field>
        </div>
      );
    case "criar_handoff":
      return (
        <div className="grid gap-3 md:grid-cols-2">
          <Field label="Departamento de destino">
            <Select value={p.department ?? "cs"} onChange={(e) => set("department", e.target.value)} options={HANDOFF_DEPARTMENTS.map((d) => ({ value: d, label: DEPARTMENT_LABELS[d] }))} />
          </Field>
          <Field label="Prazo (horas)">
            <Input type="number" min={1} inputMode="numeric" value={p.dueInHours ?? ""} onChange={(e) => set("dueInHours", e.target.value)} className="h-11 md:h-9" />
          </Field>
          {text("title", "Título (opcional)", "Vazio = “Handoff para <área>: <cliente>”")}
          {text("note", "Observação (opcional)", "Vai na tarefa junto com o resumo do cliente")}
        </div>
      );
    case "criar_plano_sucesso":
      return (
        <div className="grid gap-3 md:grid-cols-2">
          {text("objective", "Objetivo", "Aceita templates", "Recuperar adoção de {{client.tradeName}}")}
          <Field label="Checkpoint (dias)">
            <Input type="number" min={1} inputMode="numeric" value={p.checkpointInDays ?? ""} onChange={(e) => set("checkpointInDays", e.target.value)} className="h-11 md:h-9" />
          </Field>
          <Field label="Ações do plano (uma por linha, opcional)" hint="Vazio = contato, plano de ação e checkpoint" className="md:col-span-2">
            <Textarea value={p.actions ?? ""} onChange={(e) => set("actions", e.target.value)} rows={3} />
          </Field>
        </div>
      );
    case "webhook":
      return (
        <div className="grid gap-3 md:grid-cols-[1fr_140px]">
          {text("url", "URL", "Só é chamada com AUTOMATION_WEBHOOKS_ENABLED=true; senão a chamada não é feita e fica registrada como não executada", "https://")}
          <Field label="Método">
            <Select value={p.method ?? "POST"} onChange={(e) => set("method", e.target.value)} options={["POST", "PUT", "PATCH", "GET"].map((m) => ({ value: m, label: m }))} />
          </Field>
        </div>
      );
  }
}

function SimulationView({ result }: { result: SimulationResult }) {
  const executions = result.execution ? [result.execution] : (result.scan?.samples ?? []);
  return (
    <Card className="border-info/40">
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <FlaskConical className="size-4 text-info" /> Resultado do teste (simulação, sem efeitos)
        </CardTitle>
        <CardDescription>{result.message}</CardDescription>
      </CardHeader>
      <CardContent className="flex flex-col gap-4 pt-0">
        {result.event ? (
          <div className="rounded-md bg-surface-muted p-3 text-sm">
            <p className="label-caps mb-1">Evento usado</p>
            <p className="font-medium">{result.event.title}</p>
            <p className="text-xs text-muted">
              {result.event.type} · {formatDateTime(result.event.occurredAt)}
              {result.event.clientId ? (
                <>
                  {" · "}
                  <Link href={`/clientes/${result.event.clientId}`} className="underline">
                    cliente
                  </Link>
                </>
              ) : null}
            </p>
          </div>
        ) : null}
        {executions.map((exec, i) => (
          <div key={i} className="flex flex-col gap-2 rounded-md border border-border p-3">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <p className="text-sm font-medium">{exec.subject || "Registro"}</p>
              <Badge variant={RUN_STATUS_VARIANT[exec.status]} size="sm">
                {RUN_STATUS_LABELS[exec.status]}
              </Badge>
            </div>
            {exec.conditions.length > 0 ? (
              <ul className="flex flex-col gap-1 text-xs">
                {exec.conditions.map((c, j) => (
                  <li key={j} className="flex items-start gap-1.5">
                    {c.ok ? <CheckCircle2 className="mt-0.5 size-3.5 shrink-0 text-success" /> : <XCircle className="mt-0.5 size-3.5 shrink-0 text-danger" />}
                    <span>
                      <code>{c.path}</code> {CONDITION_OPERATOR_LABELS[c.operator]} {c.operator === "exists" ? "" : <strong>{String(c.expected ?? "")}</strong>} · valor atual: <strong>{c.actual === null || c.actual === "" ? "vazio" : String(c.actual)}</strong>
                    </span>
                  </li>
                ))}
              </ul>
            ) : (
              <p className="text-xs text-muted">Sem condições: sempre executa.</p>
            )}
            {exec.actions.length > 0 ? (
              <ul className="flex flex-col gap-1 border-t border-border pt-2 text-xs">
                {exec.actions.map((a, j) => (
                  <li key={j} className="flex items-start gap-2">
                    <Badge variant={RUN_STATUS_VARIANT[a.status]} size="sm" className="shrink-0">
                      {ACTION_TYPE_LABELS[a.type]}
                    </Badge>
                    <span>{a.detail}</span>
                  </li>
                ))}
              </ul>
            ) : null}
          </div>
        ))}
      </CardContent>
    </Card>
  );
}

export interface RuleEditorProps {
  rule: AutomationRuleRecord | null;
  options: EditorOptions;
  eventGroups: { domain: string; types: string[] }[];
}

/** Construtor de regras: gatilho, condições (caminho/operador/valor) e ações com parâmetros por tipo. */
export function RuleEditor({ rule, options, eventGroups }: RuleEditorProps) {
  const router = useRouter();
  const [draft, setDraft] = useState<Draft>(() => toDraft(rule));
  const [saving, startSave] = useTransition();
  const [testing, startTest] = useTransition();
  const [simulation, setSimulation] = useState<SimulationResult | null>(null);
  const [suggestions, setSuggestions] = useState<string[]>([]);
  const [confirmDelete, setConfirmDelete] = useState(false);

  const update = (patch: Partial<Draft>) => setDraft((d) => ({ ...d, ...patch }));
  const usesActions = draft.triggerType === "evento" || draft.target === "entity";

  // Sugestões de caminho conforme o gatilho (payload real dos últimos eventos + campos da entidade).
  useEffect(() => {
    let cancelled = false;
    const input = draft.triggerType === "evento" ? { eventType: draft.eventType || undefined } : { entity: draft.entity || undefined };
    if (!input.eventType && !("entity" in input && input.entity)) return;
    getPathSuggestionsAction(input).then((res) => {
      if (!cancelled && res.ok) setSuggestions(res.data);
    });
    return () => {
      cancelled = true;
    };
  }, [draft.triggerType, draft.eventType, draft.entity]);

  const recipientOptions = useMemo(() => options.recipients, [options.recipients]);

  const save = () =>
    startSave(async () => {
      const result = await saveAutomationRule(toPayload(draft));
      if (!result.ok) {
        toast.error(result.error);
        return;
      }
      toast.success(draft.id ? "Automação salva" : "Automação criada");
      if (!draft.id) router.push(`/admin/automacoes/${result.data.id}`);
      else router.refresh();
    });

  const test = () =>
    startTest(async () => {
      const result = await testAutomationRule(toPayload(draft));
      if (!result.ok) {
        toast.error(result.error);
        return;
      }
      setSimulation(result.data);
    });

  const remove = async () => {
    if (!draft.id) return;
    const result = await deleteAutomationRule({ id: draft.id });
    if (!result.ok) {
      toast.error(result.error);
      throw new Error(result.error);
    }
    toast.success("Automação excluída");
    router.push("/admin/automacoes");
  };

  const setCondition = (key: string, patch: Partial<DraftCondition>) => update({ conditions: draft.conditions.map((c) => (c.key === key ? { ...c, ...patch } : c)) });
  const setAction = (key: string, patch: Partial<DraftAction>) => update({ actions: draft.actions.map((a) => (a.key === key ? { ...a, ...patch } : a)) });
  const moveAction = (index: number, delta: number) => {
    const next = [...draft.actions];
    const [item] = next.splice(index, 1);
    next.splice(index + delta, 0, item);
    update({ actions: next });
  };

  return (
    <div className="flex flex-col gap-4">
      <datalist id="automation-paths">
        {suggestions.map((s) => (
          <option key={s} value={s} />
        ))}
      </datalist>
      <datalist id="automation-recipients">
        {recipientOptions.map((r) => (
          <option key={r.value} value={r.value}>
            {r.label}
          </option>
        ))}
      </datalist>

      <Card>
        <CardHeader>
          <CardTitle>Identificação</CardTitle>
        </CardHeader>
        <CardContent className="grid gap-3 pt-0 md:grid-cols-[1fr_auto]">
          <Field label="Nome">
            <Input value={draft.name} onChange={(e) => update({ name: e.target.value })} placeholder="Ex.: Chamado crítico notifica o gestor" className="h-11 md:h-9" />
          </Field>
          <div className="flex items-end">
            <Switch checked={draft.active} onCheckedChange={(v) => update({ active: v })} label="Ativa" description={draft.active ? "Dispara normalmente" : "Não dispara"} />
          </div>
          <Field label="Descrição (opcional)" className="md:col-span-2">
            <Textarea value={draft.description} onChange={(e) => update({ description: e.target.value })} rows={2} />
          </Field>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Gatilho</CardTitle>
          <CardDescription>Quando a regra é avaliada.</CardDescription>
        </CardHeader>
        <CardContent className="flex flex-col gap-3 pt-0">
          <SegmentedControl
            aria-label="Tipo de gatilho"
            value={draft.triggerType}
            onChange={(v) => update({ triggerType: v })}
            options={[
              { value: "evento", label: "Quando um evento acontece" },
              { value: "agendado", label: "Agendado" },
            ]}
          />
          {draft.triggerType === "evento" ? (
            <Field label="Evento" hint="Toda vez que este evento for emitido, as condições são avaliadas">
              <EventTypeSelect value={draft.eventType} onChange={(v) => update({ eventType: v })} types={eventGroups.flatMap((g) => g.types) as EventType[]} />
            </Field>
          ) : (
            <div className="grid gap-3 md:grid-cols-3">
              <Field label="Frequência">
                <Select value={draft.schedule} onChange={(e) => update({ schedule: e.target.value as RuleSchedule })} options={SCHEDULES.map((s) => ({ value: s, label: SCHEDULE_LABELS[s] }))} />
              </Field>
              <Field label="O que varrer">
                <Select
                  value={draft.target}
                  onChange={(e) => update({ target: e.target.value as Draft["target"] })}
                  options={[
                    { value: "sweep", label: "Varredura nativa" },
                    { value: "entity", label: "Registros com condições" },
                  ]}
                />
              </Field>
              {draft.target === "sweep" ? (
                <Field label="Varredura" hint={draft.sweep ? SWEEP_DEFINITIONS[draft.sweep].description : "A regra define a frequência da varredura"}>
                  <Select value={draft.sweep} onChange={(e) => update({ sweep: e.target.value as SweepKey })} placeholder="Escolha" options={SWEEP_KEYS.map((k) => ({ value: k, label: SWEEP_DEFINITIONS[k].label }))} />
                </Field>
              ) : (
                <Field label="Registros" hint="Dispara uma vez por registro até ele ser alterado">
                  <Select value={draft.entity} onChange={(e) => update({ entity: e.target.value as ScanEntity })} placeholder="Escolha" options={SCAN_ENTITIES.map((k) => ({ value: k, label: SCAN_ENTITY_LABELS[k] }))} />
                </Field>
              )}
            </div>
          )}
          {draft.triggerType === "agendado" ? (
            <p className="text-xs text-muted">
              Na Vercel (plano Hobby) o cron roda 1× por dia; frequências menores são atendidas quando as telas dos módulos ou o botão “Executar varreduras agora” rodam as varreduras.
            </p>
          ) : null}
        </CardContent>
      </Card>

      {usesActions ? (
        <>
          <Card>
            <CardHeader>
              <CardTitle>Condições</CardTitle>
              <CardDescription>
                Todas precisam ser verdadeiras. Caminhos com ponto sobre o contexto: <code>payload.*</code>, <code>entity.*</code>, <code>client.*</code>, <code>cs.*</code>, <code>sla.*</code>, <code>department.*</code>. Use <code>hoursSince&lt;Campo&gt;</code> para tempo decorrido.
              </CardDescription>
            </CardHeader>
            <CardContent className="flex flex-col gap-2 pt-0">
              {draft.conditions.length === 0 ? <p className="text-sm text-muted">Sem condições: a regra executa sempre que o gatilho ocorrer.</p> : null}
              {draft.conditions.map((c, i) => (
                <div key={c.key} className="grid gap-2 rounded-md border border-border p-2 md:grid-cols-[1fr_200px_1fr_auto] md:items-end md:border-0 md:p-0">
                  <Field label={i === 0 ? "Caminho" : ""}>
                    <Input value={c.path} onChange={(e) => setCondition(c.key, { path: e.target.value })} list="automation-paths" placeholder="payload.priority" aria-label={`Caminho da condição ${i + 1}`} className="h-11 font-mono text-[13px] md:h-9" />
                  </Field>
                  <Field label={i === 0 ? "Operador" : ""}>
                    <Select value={c.operator} onChange={(e) => setCondition(c.key, { operator: e.target.value as ConditionOperator })} aria-label={`Operador da condição ${i + 1}`} options={CONDITION_OPERATORS.map((o) => ({ value: o, label: CONDITION_OPERATOR_LABELS[o] }))} />
                  </Field>
                  <Field label={i === 0 ? "Valor" : ""}>
                    {c.operator === "exists" ? (
                      <Select
                        value={c.value === "false" ? "false" : "true"}
                        onChange={(e) => setCondition(c.key, { value: e.target.value })}
                        aria-label={`Valor da condição ${i + 1}`}
                        options={[
                          { value: "true", label: "preenchido" },
                          { value: "false", label: "vazio" },
                        ]}
                      />
                    ) : (
                      <Input
                        value={c.value}
                        onChange={(e) => setCondition(c.key, { value: e.target.value })}
                        placeholder={c.operator === "older_than_hours" ? "48" : "critico"}
                        inputMode={c.operator === "older_than_hours" ? "numeric" : undefined}
                        aria-label={`Valor da condição ${i + 1}`}
                        className="h-11 md:h-9"
                      />
                    )}
                  </Field>
                  <Button variant="ghost" size="icon" className="size-11 justify-self-end md:size-9" aria-label={`Remover condição ${i + 1}`} onClick={() => update({ conditions: draft.conditions.filter((x) => x.key !== c.key) })}>
                    <Trash2 />
                  </Button>
                </div>
              ))}
              <Button variant="outline" size="sm" className="min-h-[44px] self-start md:min-h-0" onClick={() => update({ conditions: [...draft.conditions, { key: shortId("c"), path: "", operator: "==", value: "" }] })}>
                <Plus /> Adicionar condição
              </Button>
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle>Ações</CardTitle>
              <CardDescription>Executadas em sequência. Destinatários aceitam atalhos (lista), caminhos do contexto (ex.: opportunity.ownerId) ou o ID do usuário.</CardDescription>
            </CardHeader>
            <CardContent className="flex flex-col gap-3 pt-0">
              {draft.actions.length === 0 ? <p className="text-sm text-muted">Nenhuma ação ainda.</p> : null}
              {draft.actions.map((a, i) => (
                <div key={a.key} className="flex flex-col gap-3 rounded-lg border border-border p-3">
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="flex size-6 items-center justify-center rounded-full bg-surface-hover text-xs font-semibold tabular-nums">{i + 1}</span>
                    <Select className="max-w-[240px]" value={a.type} onChange={(e) => setAction(a.key, { type: e.target.value as RuleActionType, params: defaultParams(e.target.value as RuleActionType, options) })} aria-label={`Tipo da ação ${i + 1}`} options={ACTION_TYPES.map((t) => ({ value: t, label: ACTION_TYPE_LABELS[t] }))} />
                    <div className="ml-auto flex items-center gap-1">
                      <Button variant="ghost" size="icon" className="size-11 md:size-9" disabled={i === 0} onClick={() => moveAction(i, -1)} aria-label="Mover para cima">
                        <ArrowUp />
                      </Button>
                      <Button variant="ghost" size="icon" className="size-11 md:size-9" disabled={i === draft.actions.length - 1} onClick={() => moveAction(i, 1)} aria-label="Mover para baixo">
                        <ArrowDown />
                      </Button>
                      <Button variant="ghost" size="icon" className="size-11 md:size-9" onClick={() => update({ actions: draft.actions.filter((x) => x.key !== a.key) })} aria-label={`Remover ação ${i + 1}`}>
                        <Trash2 />
                      </Button>
                    </div>
                  </div>
                  <ActionParams action={a} options={options} onChange={(params) => setAction(a.key, { params })} />
                </div>
              ))}
              <Button variant="outline" size="sm" className="min-h-[44px] self-start md:min-h-0" onClick={() => update({ actions: [...draft.actions, { key: shortId("a"), type: "criar_tarefa", params: defaultParams("criar_tarefa", options) }] })}>
                <Plus /> Adicionar ação
              </Button>
            </CardContent>
          </Card>
        </>
      ) : (
        <Card>
          <CardContent className="text-sm text-muted">Regras de varredura nativa não têm condições nem ações próprias: a varredura escolhida executa o trabalho (criar tarefas, emitir alertas, notificar) e cada execução fica no histórico da regra.</CardContent>
        </Card>
      )}

      {simulation ? <SimulationView result={simulation} /> : null}

      <div className="sticky bottom-[calc(var(--spacing-mobile-nav)+8px)] z-10 flex gap-2 rounded-lg border border-border bg-surface/95 p-3 shadow-pop backdrop-blur md:bottom-4 md:justify-end">
        {draft.id ? (
          <Button variant="ghost" className="min-h-[44px] text-danger md:mr-auto md:min-h-0" onClick={() => setConfirmDelete(true)}>
            <Trash2 /> <span className="hidden sm:inline">Excluir</span>
          </Button>
        ) : null}
        <Button variant="outline" className="min-h-[44px] flex-1 md:min-h-0 md:flex-none" loading={testing} onClick={test}>
          {testing ? null : <FlaskConical />} {draft.triggerType === "evento" ? "Testar com último evento" : "Testar"}
        </Button>
        <Button className="min-h-[44px] flex-1 md:min-h-0 md:flex-none" loading={saving} onClick={save}>
          {saving ? null : <Save />} Salvar
        </Button>
      </div>

      <ConfirmDialog
        open={confirmDelete}
        onOpenChange={setConfirmDelete}
        title="Excluir automação?"
        description="A regra deixa de disparar imediatamente. O histórico de execuções é mantido."
        confirmLabel="Excluir"
        destructive
        onConfirm={remove}
      />
    </div>
  );
}
