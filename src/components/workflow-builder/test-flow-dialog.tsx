"use client";

import * as React from "react";
import { AlertTriangle, FlaskConical, Play, Repeat } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Dialog, DialogBody, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { FormField } from "@/components/ui/form-field";
import { SegmentedControl } from "@/components/ui/segmented-control";
import { Select } from "@/components/ui/select";
import { toast } from "@/components/ui/toast";
import { formatDateTime } from "@/lib/format";
import { cn } from "@/lib/utils";
import type { ProcessOutcome } from "@/domain/workflow-graph";
import { simulateProcessAction } from "@/server/process-engine/actions";
import type { GraphInput } from "@/server/process-engine/schemas";
import type { SimulationResult } from "@/server/process-engine/simulate";
import { NODE_KINDS } from "./node-kinds";

export interface TestFlowDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  clients: { id: string; name: string }[];
  decisions: { id: string; label: string; question?: string }[];
  getGraph: () => GraphInput;
  onResult: (result: SimulationResult | null) => void;
}

const RESULT_LABEL: Record<string, { label: string; variant: "success" | "danger" | "info" | "muted" | "warning" }> = {
  sim: { label: "Sim", variant: "success" },
  nao: { label: "Não", variant: "danger" },
  laco: { label: "Laço", variant: "warning" },
};

/** "Testar fluxo": simulação a seco com um cliente real. Nada é gravado. */
export function TestFlowDialog({ open, onOpenChange, clients, decisions, getGraph, onResult }: TestFlowDialogProps) {
  const [clientId, setClientId] = React.useState(clients[0]?.id ?? "");
  const [answers, setAnswers] = React.useState<Record<string, ProcessOutcome>>({});
  const [result, setResult] = React.useState<SimulationResult | null>(null);
  const [pending, startTransition] = React.useTransition();

  const run = () =>
    startTransition(async () => {
      const res = await simulateProcessAction({ graph: getGraph(), clientId, answers });
      if (!res.ok) {
        toast.error(res.error);
        return;
      }
      setResult(res.data);
      onResult(res.data);
    });

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent size="lg">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <FlaskConical className="size-5 text-brand-fg" /> Testar fluxo
          </DialogTitle>
          <DialogDescription>Percorre o desenho atual com os dados de um cliente real e mostra o caminho, as tarefas, os responsáveis e os SLAs. Nada é gravado.</DialogDescription>
        </DialogHeader>
        <DialogBody className="flex flex-col gap-4">
          <div className="grid gap-3 md:grid-cols-[minmax(0,1fr)_auto] md:items-end">
            <FormField label="Cliente de exemplo" htmlFor="test-client">
              <Select id="test-client" value={clientId} onChange={(e) => setClientId(e.target.value)} options={clients.map((c) => ({ value: c.id, label: c.name }))} />
            </FormField>
            <Button onClick={run} loading={pending} disabled={!clientId} className="min-h-[44px] md:min-h-0">
              {pending ? null : <Play />} Executar teste
            </Button>
          </div>
          {decisions.length > 0 ? (
            <div className="flex flex-col gap-2 rounded-lg border border-border bg-surface-muted p-3">
              <p className="text-xs font-medium text-muted">Respostas simuladas das decisões humanas</p>
              {decisions.map((d) => (
                <div key={d.id} className="flex flex-wrap items-center justify-between gap-2">
                  <span className="text-sm">{d.question || d.label}</span>
                  <SegmentedControl
                    size="sm"
                    aria-label={`Resposta de ${d.label}`}
                    value={answers[d.id] ?? "sim"}
                    onChange={(v) => setAnswers((a) => ({ ...a, [d.id]: v }))}
                    options={[
                      { value: "sim", label: "Sim" },
                      { value: "nao", label: "Não" },
                    ]}
                  />
                </div>
              ))}
            </div>
          ) : null}

          {result ? <SimulationView result={result} /> : null}
        </DialogBody>
        <DialogFooter>
          {result ? (
            <Button
              variant="ghost"
              onClick={() => {
                setResult(null);
                onResult(null);
              }}
            >
              Limpar destaque
            </Button>
          ) : null}
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            {result ? "Ver caminho no canvas" : "Fechar"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function SimulationView({ result }: { result: SimulationResult }) {
  return (
    <div className="flex flex-col gap-3" data-testid="simulation-result">
      <div className="flex flex-wrap items-center gap-2 text-sm">
        <Badge variant="info">{result.client.name}</Badge>
        {result.entity ? <Badge variant="muted">Registro de exemplo: {result.entity.label}</Badge> : null}
        <Badge variant="secondary">{result.steps.length} etapas no caminho</Badge>
        <Badge variant="brand">{result.tasksCount} tarefa(s) seriam criadas</Badge>
        {result.ending === "laco" ? (
          <Badge variant="warning">
            <Repeat /> Volta a uma etapa (laço)
          </Badge>
        ) : result.ending === "limite" ? (
          <Badge variant="danger">Caminho longo demais</Badge>
        ) : (
          <Badge variant="success">Chega ao Fim</Badge>
        )}
      </div>
      {result.issues.length > 0 ? (
        <div className="flex gap-2 rounded-lg border border-warning/30 bg-warning-soft px-3 py-2 text-xs text-warning-fg">
          <AlertTriangle className="mt-0.5 size-4 shrink-0" />
          <div>
            <p className="font-medium">Publicação bloqueada até corrigir:</p>
            <ul className="mt-1 list-disc pl-4">
              {result.issues.map((i) => (
                <li key={i.message}>{i.message}</li>
              ))}
            </ul>
          </div>
        </div>
      ) : null}
      <ol className="flex flex-col">
        {result.steps.map((s, i) => {
          const kind = NODE_KINDS[s.type];
          const Icon = kind.icon;
          const res = RESULT_LABEL[s.result];
          return (
            <li key={`${s.nodeId}-${i}`} className="relative flex gap-3 pb-3 last:pb-0">
              {i < result.steps.length - 1 ? <span className="absolute left-[15px] top-8 bottom-0 w-px bg-border-strong" aria-hidden /> : null}
              <span className={cn("relative flex size-8 shrink-0 items-center justify-center rounded-md [&_svg]:size-4", kind.iconBox)}>
                <Icon aria-hidden />
              </span>
              <div className="min-w-0 flex-1">
                <div className="flex flex-wrap items-center gap-2">
                  <span className="text-sm font-medium">{s.label}</span>
                  {res ? (
                    <Badge size="sm" variant={res.variant}>
                      {res.label}
                    </Badge>
                  ) : null}
                </div>
                <p className="text-xs text-muted">{s.detail}</p>
                {s.task ? (
                  <div className="mt-2 grid gap-x-4 gap-y-1 rounded-lg border border-border bg-surface-muted px-3 py-2 text-xs sm:grid-cols-2">
                    <span>
                      <span className="text-muted">Tarefa:</span> {s.task.title}
                    </span>
                    <span>
                      <span className="text-muted">Departamento:</span> {s.task.department}
                    </span>
                    <span className={cn(s.task.fallback && "text-warning-fg")}>
                      <span className="text-muted">Responsável:</span> {s.task.assigneeName} <span className="text-muted-light">({s.task.assigneeHow})</span>
                    </span>
                    <span>
                      <span className="text-muted">Prazo:</span> {s.task.dueAt ? formatDateTime(s.task.dueAt) : "sem prazo"}
                    </span>
                    <span>
                      <span className="text-muted">SLA:</span> {s.task.slaHours ? `${s.task.slaHours}h úteis · vence ${formatDateTime(s.task.slaDueAt)}` : "sem SLA"}
                    </span>
                    {s.task.checklist.length > 0 ? (
                      <span>
                        <span className="text-muted">Checklist:</span> {s.task.checklist.map((c) => `${c.label}${c.required ? "*" : ""}`).join(", ")}
                      </span>
                    ) : null}
                    {s.task.question ? (
                      <span className="sm:col-span-2">
                        <span className="text-muted">Ao concluir pergunta:</span> {s.task.question}
                      </span>
                    ) : null}
                  </div>
                ) : null}
              </div>
            </li>
          );
        })}
      </ol>
    </div>
  );
}
