"use client";

import "@xyflow/react/dist/style.css";
import * as React from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { Background, BackgroundVariant, Controls, ReactFlow, ReactFlowProvider } from "@xyflow/react";
import { Ban, CheckCircle2, Clock, ExternalLink, Hourglass, Play, RefreshCw, TriangleAlert, User, Workflow, XCircle } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { ConfirmDialog } from "@/components/ui/confirm-dialog";
import { Dialog, DialogBody, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { EmptyState } from "@/components/ui/empty-state";
import { FormField } from "@/components/ui/form-field";
import { SegmentedControl } from "@/components/ui/segmented-control";
import { Select } from "@/components/ui/select";
import { SlaBadge } from "@/components/ui/sla-badge";
import { TimelineList, type TimelineListItem } from "@/components/ui/timeline-list";
import { toast } from "@/components/ui/toast";
import type { Tone } from "@/components/ui/tone";
import { TASK_STATUS_LABELS } from "@/domain/constants";
import { formatDateTime, formatRelative } from "@/lib/format";
import { cn } from "@/lib/utils";
import {
  PROCESS_NODE_LABELS,
  PROCESS_RUN_STATUS_LABELS,
  type ProcessDefinition,
  type ProcessOutcome,
  type ProcessPendingNode,
  type ProcessRun,
  type ProcessRunStatus,
} from "@/domain/workflow-graph";
import { answerProcessOutcomeAction, cancelProcessRunAction, completeProcessNodeAction, runProcessSweepAction, startManualRunAction } from "@/server/process-engine/actions";
import type { RunTaskInfo, RunsPageData } from "@/server/process-engine/queries";
import { PROCESS_NODE_TYPES_MAP } from "./flow-nodes";
import { EDGE_STYLE, FLOW_THEME, toFlow } from "./flow-graph";

const RUN_VARIANT: Record<ProcessRunStatus, "info" | "success" | "muted" | "danger"> = { em_andamento: "info", concluido: "success", cancelado: "muted", erro: "danger" };

const RESULT_META: Record<string, { label: string; tone: Tone }> = {
  iniciado: { label: "Iniciado", tone: "brand" },
  entrou: { label: "Entrou na etapa", tone: "neutral" },
  tarefa_criada: { label: "Tarefa criada", tone: "info" },
  aguardando: { label: "Aguardando", tone: "purple" },
  aguardando_resposta: { label: "Aguardando resposta", tone: "warning" },
  concluido: { label: "Concluída", tone: "success" },
  sim: { label: "Sim", tone: "success" },
  nao: { label: "Não", tone: "danger" },
  notificado: { label: "Notificação enviada", tone: "secondary" },
  simulada: { label: "Webhook registrado (simulado)", tone: "secondary" },
  sucesso: { label: "Webhook chamado", tone: "secondary" },
  ignorado: { label: "Ignorado", tone: "neutral" },
  erro: { label: "Erro", tone: "danger" },
  cancelado: { label: "Cancelado", tone: "neutral" },
};

function currentLabel(run: ProcessRun): string {
  const labels = run.currentNodeIds.map((id) => run.history.findLast((h) => h.nodeId === id)?.nodeLabel ?? id);
  return labels.join(", ");
}

export function RunViewer({ data }: { data: RunsPageData }) {
  const router = useRouter();
  const [filter, setFilter] = React.useState<"em_andamento" | "encerradas" | "todas">("todas");
  const [startOpen, setStartOpen] = React.useState(false);
  const [sweeping, startSweep] = React.useTransition();
  const counts = data.runs.reduce<Record<ProcessRunStatus, number>>((acc, r) => ({ ...acc, [r.status]: acc[r.status] + 1 }), { em_andamento: 0, concluido: 0, cancelado: 0, erro: 0 });
  const runs = data.runs.filter((r) => filter === "todas" || (filter === "em_andamento" ? r.status === "em_andamento" : r.status !== "em_andamento"));
  const selectedId = data.selected?.run.id;

  const sweep = () =>
    startSweep(async () => {
      const res = await runProcessSweepAction();
      if (!res.ok) return void toast.error(res.error);
      toast.success(res.data.advanced ? `${res.data.advanced} espera(s) liberada(s)` : "Nenhuma espera vencida");
      router.refresh();
    });

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-wrap items-center justify-end gap-2">
        <Button variant="outline" onClick={sweep} loading={sweeping} title="Libera as esperas por horas úteis já vencidas (a varredura periódica faz o mesmo)">
          {sweeping ? null : <RefreshCw />} Verificar esperas
        </Button>
        {data.publishedId ? (
          <Button onClick={() => setStartOpen(true)}>
            <Play /> Iniciar execução
          </Button>
        ) : (
          <Badge variant="warning">Publique o processo para executá-lo</Badge>
        )}
      </div>

      <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
        {(Object.keys(counts) as ProcessRunStatus[]).map((s) => (
          <div key={s} className="rounded-xl border border-border bg-surface px-4 py-3 shadow-card">
            <p className="text-xs text-muted">{PROCESS_RUN_STATUS_LABELS[s]}</p>
            <p className={cn("text-2xl font-semibold tabular-nums", s === "em_andamento" && "text-brand-fg", s === "erro" && counts.erro > 0 && "text-danger-fg")}>{counts[s]}</p>
          </div>
        ))}
      </div>

      <div className="grid grid-cols-[minmax(0,1fr)] gap-4 xl:grid-cols-[340px_minmax(0,1fr)]">
        <Card className="flex flex-col xl:self-start">
          <CardHeader className="gap-3">
            <CardTitle>Execuções</CardTitle>
            <SegmentedControl
              size="sm"
              aria-label="Filtrar execuções"
              value={filter}
              onChange={setFilter}
              options={[
                { value: "todas", label: "Todas" },
                { value: "em_andamento", label: "Em andamento" },
                { value: "encerradas", label: "Encerradas" },
              ]}
            />
          </CardHeader>
          <CardContent className="flex-1">
            {runs.length === 0 ? (
              <EmptyState size="sm" icon={<Workflow />} title="Nenhuma execução" description={data.publishedId ? "Execuções começam pelo gatilho do processo ou pelo botão Iniciar execução." : "Publique o processo para que o gatilho comece a gerar execuções."} />
            ) : (
              <ul className="flex max-h-[640px] flex-col gap-2 overflow-y-auto pr-1 scrollbar-thin">
                {runs.map((r) => (
                  <li key={r.id}>
                    <Link
                      href={`?run=${r.id}`}
                      scroll={false}
                      className={cn("flex flex-col gap-1 rounded-lg border px-3 py-2.5 transition-colors hover:bg-surface-hover", r.id === selectedId ? "border-brand/60 bg-brand-soft" : "border-border bg-surface-muted")}
                      data-testid="run-item"
                    >
                      <span className="flex items-center justify-between gap-2">
                        <span className="truncate text-sm font-medium">{r.clientName ?? "Sem cliente"}</span>
                        <Badge size="sm" variant={RUN_VARIANT[r.status]}>
                          {PROCESS_RUN_STATUS_LABELS[r.status]}
                        </Badge>
                      </span>
                      <span className="truncate text-xs text-muted">{r.status === "em_andamento" ? `Etapa atual: ${currentLabel(r) || "—"}` : r.context.trigger.eventTitle ?? "Início manual"}</span>
                      <span className="text-[11px] text-muted-light">
                        v{r.version} · iniciada {formatRelative(r.startedAt)}
                      </span>
                    </Link>
                  </li>
                ))}
              </ul>
            )}
          </CardContent>
        </Card>

        {data.selected ? <RunDetail key={data.selected.run.id + data.selected.run.updatedAt} run={data.selected.run} definition={data.selected.definition} tasks={data.selected.tasks} /> : (
          <Card>
            <CardContent>
              <EmptyState icon={<Workflow />} title="Selecione uma execução" description="O caminho percorrido aparece desenhado sobre o grafo da versão em que a execução começou." />
            </CardContent>
          </Card>
        )}
      </div>

      <StartRunDialog open={startOpen} onOpenChange={setStartOpen} definitionId={data.publishedId ?? data.definition.id} clients={data.clients} />
    </div>
  );
}

function RunGraph({ run, definition }: { run: ProcessRun; definition: ProcessDefinition }) {
  const flow = React.useMemo(() => {
    const base = toFlow(definition.nodes, definition.edges);
    const visited = new Set(run.history.map((h) => h.nodeId));
    const current = new Set(run.currentNodeIds);
    const traversed = new Set(run.history.flatMap((h) => (h.via ? [h.via] : [])));
    return {
      nodes: base.nodes.map((n) => ({ ...n, className: current.has(n.id) ? "is-current" : visited.has(n.id) ? "is-done" : "is-dim", draggable: false, selectable: false, connectable: false })),
      edges: base.edges.map((e) => (traversed.has(e.id) ? { ...e, style: { ...EDGE_STYLE, stroke: "var(--color-success)", strokeWidth: 2.2 }, animated: current.has(e.target) } : { ...e, style: { ...EDGE_STYLE, opacity: 0.35 } })),
    };
  }, [run, definition]);
  return (
    <div className="relative h-[380px] overflow-hidden rounded-xl border border-border bg-canvas md:h-[460px]" style={FLOW_THEME} data-testid="run-graph">
      <ReactFlowProvider>
        <ReactFlow nodes={flow.nodes} edges={flow.edges} nodeTypes={PROCESS_NODE_TYPES_MAP} colorMode="dark" fitView fitViewOptions={{ padding: 0.15 }} nodesDraggable={false} nodesConnectable={false} elementsSelectable={false} attributionPosition="top-left" minZoom={0.2}>
          <Background variant={BackgroundVariant.Dots} gap={22} size={1.2} color="rgb(148 163 186 / 0.18)" />
          <Controls position="bottom-left" showInteractive={false} className="!rounded-lg !border !border-border" />
        </ReactFlow>
      </ReactFlowProvider>
      <div className="pointer-events-none absolute right-3 top-3 flex flex-wrap gap-2 text-[11px] text-muted">
        <span className="flex items-center gap-1 rounded-md bg-surface/90 px-2 py-1"><span className="size-2 rounded-full bg-brand" /> Em andamento</span>
        <span className="flex items-center gap-1 rounded-md bg-surface/90 px-2 py-1"><span className="size-2 rounded-full bg-success" /> Percorrido</span>
      </div>
    </div>
  );
}

function RunDetail({ run, definition, tasks }: { run: ProcessRun; definition: ProcessDefinition; tasks: Record<string, RunTaskInfo> }) {
  const router = useRouter();
  const [confirmCancel, setConfirmCancel] = React.useState(false);
  const nodes = new Map(definition.nodes.map((n) => [n.id, n]));
  const history: TimelineListItem[] = [...run.history].filter((h) => h.result !== "entrou").reverse().map((h, i) => {
    const meta = RESULT_META[h.result] ?? { label: h.result, tone: "neutral" as Tone };
    return {
      id: `${h.at}-${i}`,
      icon: h.result === "erro" ? <TriangleAlert /> : h.result === "concluido" || h.result === "sim" ? <CheckCircle2 /> : h.result === "nao" ? <XCircle /> : <Clock />,
      tone: meta.tone,
      title: (
        <span>
          {h.nodeLabel ?? nodes.get(h.nodeId)?.data.label ?? "Execução"} · <span className="text-muted">{meta.label}</span>
        </span>
      ),
      subtitle: h.detail,
      date: formatDateTime(h.at),
    };
  });

  const cancel = async () => {
    const res = await cancelProcessRunAction({ runId: run.id });
    if (!res.ok) return void toast.error(res.error);
    toast.success("Execução cancelada");
    router.refresh();
  };

  return (
    <div className="flex min-w-0 flex-col gap-4">
      <Card>
        <CardHeader className="flex-row flex-wrap items-start justify-between gap-3">
          <div className="min-w-0">
            <CardTitle className="flex flex-wrap items-center gap-2">
              {run.clientId ? (
                <Link href={`/clientes/${run.clientId}`} className="hover:underline">
                  {run.clientName}
                </Link>
              ) : (
                "Sem cliente"
              )}
              <Badge variant={RUN_VARIANT[run.status]}>{PROCESS_RUN_STATUS_LABELS[run.status]}</Badge>
              <Badge variant="muted">v{run.version}</Badge>
            </CardTitle>
            <p className="mt-1 text-sm text-muted">
              {run.context.trigger.type === "evento" ? `Gatilho ${run.context.trigger.eventType}: ${run.context.trigger.eventTitle ?? ""}` : `Início manual por ${run.startedBy.name}`} · iniciada em {formatDateTime(run.startedAt)}
              {run.completedAt ? ` · encerrada em ${formatDateTime(run.completedAt)}` : ""}
            </p>
            {run.error ? <p className="mt-1 text-sm text-danger-fg">Erro: {run.error}</p> : null}
          </div>
          {run.status === "em_andamento" ? (
            <Button variant="outline" size="sm" className="text-danger-fg" onClick={() => setConfirmCancel(true)}>
              <Ban /> Cancelar execução
            </Button>
          ) : null}
        </CardHeader>
        <CardContent>
          <RunGraph run={run} definition={definition} />
        </CardContent>
      </Card>

      <div className="grid grid-cols-[minmax(0,1fr)] gap-4 2xl:grid-cols-2">
        <Card>
          <CardHeader>
            <CardTitle>Etapas em andamento</CardTitle>
          </CardHeader>
          <CardContent className="flex flex-col gap-3">
            {Object.keys(run.pending).length === 0 ? <p className="text-sm text-muted">{run.status === "em_andamento" ? "Nenhuma etapa aguardando." : "Execução encerrada."}</p> : null}
            {Object.entries(run.pending).map(([nodeId, p]) => (
              <PendingItem key={nodeId} runId={run.id} nodeId={nodeId} pending={p} label={nodes.get(nodeId)?.data.label ?? nodeId} type={nodes.get(nodeId)?.type} task={p.taskId ? tasks[p.taskId] : undefined} />
            ))}
          </CardContent>
        </Card>
        <Card>
          <CardHeader>
            <CardTitle>Caminho percorrido</CardTitle>
          </CardHeader>
          <CardContent>
            <TimelineList items={history} className="max-h-[520px] overflow-y-auto pr-1 scrollbar-thin" />
          </CardContent>
        </Card>
      </div>

      <ConfirmDialog
        open={confirmCancel}
        onOpenChange={setConfirmCancel}
        title="Cancelar esta execução?"
        description="As tarefas abertas da execução serão canceladas e os SLAs encerrados."
        confirmLabel="Cancelar execução"
        cancelLabel="Voltar"
        destructive
        onConfirm={cancel}
      />
    </div>
  );
}

function PendingItem({ runId, nodeId, pending, label, type, task }: { runId: string; nodeId: string; pending: ProcessPendingNode; label: string; type?: keyof typeof PROCESS_NODE_LABELS; task?: RunTaskInfo }) {
  const router = useRouter();
  const [busy, startTransition] = React.useTransition();
  const act = (fn: () => Promise<{ ok: boolean; error?: string }>, success: string) =>
    startTransition(async () => {
      const res = await fn();
      if (!res.ok) return void toast.error(res.error ?? "Erro");
      toast.success(success);
      router.refresh();
    });
  const answer = (outcome: ProcessOutcome) => act(() => answerProcessOutcomeAction({ runId, nodeId, outcome }), "Resposta registrada");
  const isApproval = pending.kind === "aprovacao";

  return (
    <div className="flex flex-col gap-2 rounded-lg border border-border bg-surface-muted p-3" data-testid="pending-node">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <span className="text-sm font-medium">{label}</span>
        <Badge size="sm" variant="muted">
          {type ? PROCESS_NODE_LABELS[type] : pending.kind}
        </Badge>
      </div>
      {task ? (
        <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-muted">
          <Link href={`/tarefas?tarefa=${task.id}`} className="inline-flex items-center gap-1 text-secondary-fg hover:underline">
            <ExternalLink className="size-3.5" /> {task.title}
          </Link>
          <span>{TASK_STATUS_LABELS[task.status]}</span>
          {task.assigneeName ? (
            <span className="inline-flex items-center gap-1">
              <User className="size-3.5" /> {task.assigneeName}
            </span>
          ) : null}
          {task.sla ? <SlaBadge state={task.sla.state} remainingMs={task.sla.remainingMs} /> : null}
        </div>
      ) : null}
      {pending.kind === "espera_horas" && pending.waitUntil ? (
        <p className="inline-flex items-center gap-1 text-xs text-muted">
          <Hourglass className="size-3.5" /> Libera em {formatDateTime(pending.waitUntil)}
        </p>
      ) : null}
      {pending.kind === "espera_evento" ? <p className="text-xs text-muted">Aguardando o evento {pending.untilEvent}</p> : null}
      {pending.awaitingOutcome ? <p className="text-xs text-warning-fg">A tarefa foi concluída sem informar o resultado. Responda para o processo seguir.</p> : null}

      <div className="flex flex-wrap gap-2">
        {pending.needsOutcome ? (
          <>
            <Button size="sm" variant="success" loading={busy} onClick={() => answer("sim")}>
              {isApproval ? "Aprovar" : "Sim"}
            </Button>
            <Button size="sm" variant="destructive" disabled={busy} onClick={() => answer("nao")}>
              {isApproval ? "Reprovar" : "Não"}
            </Button>
          </>
        ) : null}
        {pending.kind === "manual" && !pending.needsOutcome ? (
          <Button size="sm" loading={busy} onClick={() => act(() => completeProcessNodeAction({ runId, nodeId }), "Etapa concluída")}>
            Concluir etapa
          </Button>
        ) : null}
        {pending.kind === "espera_horas" || pending.kind === "espera_evento" ? (
          <Button size="sm" variant="outline" loading={busy} onClick={() => act(() => completeProcessNodeAction({ runId, nodeId }), "Espera encerrada")}>
            Encerrar espera agora
          </Button>
        ) : null}
      </div>
    </div>
  );
}

function StartRunDialog({ open, onOpenChange, definitionId, clients }: { open: boolean; onOpenChange: (v: boolean) => void; definitionId: string; clients: { id: string; name: string }[] }) {
  const router = useRouter();
  const [clientId, setClientId] = React.useState("");
  const [pending, startTransition] = React.useTransition();
  const start = () =>
    startTransition(async () => {
      const res = await startManualRunAction({ definitionId, clientId: clientId || undefined });
      if (!res.ok) return void toast.error(res.error);
      toast.success("Execução iniciada");
      onOpenChange(false);
      router.push(`/admin/workflows/processos/${res.data.definitionId}/execucoes?run=${res.data.runId}`);
      router.refresh();
    });
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent size="sm">
        <DialogHeader>
          <DialogTitle>Iniciar execução</DialogTitle>
          <DialogDescription>Roda a versão publicada agora: cria tarefas, inicia SLAs e envia notificações de verdade.</DialogDescription>
        </DialogHeader>
        <DialogBody>
          <FormField label="Cliente" htmlFor="start-client" hint="Opcional. Com cliente, a execução aparece na linha do tempo dele.">
            <Select id="start-client" value={clientId} onChange={(e) => setClientId(e.target.value)}>
              <option value="">Sem cliente</option>
              {clients.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.name}
                </option>
              ))}
            </Select>
          </FormField>
        </DialogBody>
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            Cancelar
          </Button>
          <Button onClick={start} loading={pending}>
            Iniciar
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
