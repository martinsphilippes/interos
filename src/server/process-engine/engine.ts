import "server-only";
/**
 * Motor de execução dos PROCESSOS (grafos do construtor visual).
 *
 * - startRun: cria a execução (idempotente por definição + entidade) e percorre os nós automáticos
 *   (início, condição, notificação, integração) até parar em nós que esperam alguém ou algo:
 *   tarefa, aprovação, etapa manual, espera por horas úteis ou por evento.
 * - Tarefas e aprovações usam a Central de Tarefas (createTaskInternal) com processType "workflow" e
 *   processId "<runId>#<nodeId>"; o SLA é o motor de SLA (startSla, entityType "tarefa"), que a conclusão da
 *   tarefa encerra. A conclusão da tarefa (task.completed) avança a execução — ver handleProcessEvent.
 * - Decisões Sim/Não: completeProcessTask/answerOutcome gravam a resposta; se a tarefa for concluída sem
 *   resposta (ex.: pela Central de Tarefas), a execução fica "aguardando resposta" na tela de execuções.
 * - Esperas por horas úteis são liberadas por sweepProcessWaits() (varredura periódica).
 * - Eventos: automation.executed com payload.kind "process.*" (vão para a timeline do cliente).
 *
 * Proteção contra laço: eventos emitidos durante a execução de um processo não disparam novas execuções do
 * mesmo processo (cadeia em AsyncLocalStorage) e a profundidade de processos encadeados é limitada a 3.
 */
import { AsyncLocalStorage } from "node:async_hooks";
import { getById, nowIso, update } from "@/server/db";
import { emitEvent } from "@/server/events";
import { registerHandler } from "@/server/events/emit";
import { registerProcessEngineHandlers } from "@/server/events/handlers/process-engine";
import { notify } from "@/server/notifications";
import { addBusinessHours, businessDaysToHours, getHolidays, startSla } from "@/server/sla";
import { cancelTaskInternal, completeTaskInternal, createTaskInternal } from "@/server/tasks/service";
import { runAction } from "@/server/automations/actions-registry";
import { renderTemplate } from "@/server/automations/conditions";
import type { AutomationRuleRecord } from "@/server/automations/schemas";
import { formatDateTime } from "@/lib/format";
import { shortId } from "@/lib/utils";
import { COLLECTIONS, type ChecklistItem, type Client, type DomainEvent, type Task, type UserRef } from "@/domain/types";
import {
  nextEdges,
  nodeHasOutcome,
  parseProcessTaskId,
  processTaskId,
  type ProcessDefinition,
  type ProcessNode,
  type ProcessNodeOf,
  type ProcessOutcome,
  type ProcessPendingNode,
  type ProcessRun,
} from "@/domain/workflow-graph";
import { approvalTitle, approverDepartment, buildEvalContext, evaluateCondition, resolveAssignee, resolveNotifyRecipients } from "./resolve";
import { createRunIfAbsent, getDefinition, getRun, listDefinitions, listRuns, persistRun } from "./store";

// Registro idempotente do handler de eventos (o integrador também o chama em handlers/index.ts).
registerProcessEngineHandlers(registerHandler);

export const PROCESS_ACTOR: UserRef = { id: "system", name: "INTEROS (processos)" };
const MAX_AUTOMATIC_STEPS = 60;
const MAX_PROCESS_DEPTH = 3;
const OPEN_TASK = new Set<Task["status"]>(["aberta", "em_andamento", "aguardando"]);

// ---------------------------------------------------------------------------
// Escopo (cadeia de processos e execuções em edição neste fluxo assíncrono)
// ---------------------------------------------------------------------------

interface ProcessScope {
  chain: string[];
  lockedRuns: Set<string>;
}
const scope = new AsyncLocalStorage<ProcessScope>();

/** Serializa alterações de uma mesma execução dentro do processo Node (eventos quase simultâneos). */
const runLocks = new Map<string, Promise<unknown>>();

async function withRun<T>(runId: string, fn: (run: ProcessRun) => Promise<T>): Promise<T | null> {
  const current = scope.getStore();
  // Reentrada (evento emitido enquanto esta mesma execução está sendo alterada): ignora para não travar.
  if (current?.lockedRuns.has(runId)) return null;
  const previous = runLocks.get(runId) ?? Promise.resolve();
  let release: () => void = () => {};
  const mine = new Promise<void>((resolve) => (release = resolve));
  const chained = previous.then(() => mine);
  runLocks.set(runId, chained);
  await previous.catch(() => undefined);
  try {
    const run = await getRun(runId);
    if (!run) return null;
    const next: ProcessScope = { chain: current?.chain ?? [run.definitionKey], lockedRuns: new Set([...(current?.lockedRuns ?? []), runId]) };
    return await scope.run(next, () => fn(run));
  } finally {
    release();
    if (runLocks.get(runId) === chained) runLocks.delete(runId);
  }
}

// ---------------------------------------------------------------------------
// Utilidades
// ---------------------------------------------------------------------------

function nodeMap(def: ProcessDefinition): Map<string, ProcessNode> {
  return new Map(def.nodes.map((n) => [n.id, n]));
}

function history(run: ProcessRun, node: ProcessNode | { id: string; data: { label: string } }, result: string, detail?: string, extra: { via?: string; actorId?: string } = {}): void {
  run.history.push({ nodeId: node.id, nodeLabel: node.data.label, at: nowIso(), result, detail, via: extra.via, actorId: extra.actorId });
}

async function emitProcessEvent(run: ProcessRun, kind: string, actor: UserRef, title: string, description?: string, extra: Record<string, unknown> = {}): Promise<void> {
  await emitEvent({
    type: "automation.executed",
    actor,
    clientId: run.clientId,
    entity: { type: "process_run", id: run.id },
    title,
    description,
    payload: { kind, runId: run.id, definitionId: run.definitionId, definitionKey: run.definitionKey, version: run.version, ...extra },
  });
}

function runHref(run: Pick<ProcessRun, "id" | "definitionId">): string {
  return `/admin/workflows/processos/${run.definitionId}/execucoes?run=${run.id}`;
}

async function loadClient(clientId: string | undefined): Promise<Client | null> {
  return clientId ? getById<Client>(COLLECTIONS.clients, clientId) : null;
}

function refreshWaitingEvents(run: ProcessRun): void {
  run.waitingEventTypes = Array.from(new Set(Object.values(run.pending).flatMap((p) => (p.kind === "espera_evento" && p.untilEvent ? [p.untilEvent] : []))));
}

// ---------------------------------------------------------------------------
// Entrada nos nós
// ---------------------------------------------------------------------------

type EnterResult = { done: true; outcome?: ProcessOutcome } | { done: false };

async function createNodeTask(
  run: ProcessRun,
  def: ProcessDefinition,
  node: ProcessNodeOf<"tarefa"> | ProcessNodeOf<"aprovacao">,
  actor: UserRef,
): Promise<ProcessPendingNode> {
  const client = await loadClient(run.clientId);
  const holidays = await getHolidays();
  const now = nowIso();
  const isApproval = node.type === "aprovacao";
  const department = isApproval ? (node.data.department ?? (await approverDepartment(node.data.approverRole))) : node.data.department;
  const spec = isApproval ? `papel:${node.data.approverRole}` : node.data.assignee;
  const assignee = await resolveAssignee(spec, department, client);

  const checklist: ChecklistItem[] = isApproval
    ? []
    : [
        ...node.data.requiredFields.filter(Boolean).map((label) => ({ id: shortId("chk"), label, done: false, required: true })),
        ...node.data.checklist.filter(Boolean).map((label) => ({ id: shortId("chk"), label, done: false, required: false })),
      ];
  const dueDays = isApproval ? 0 : node.data.dueBusinessDays;
  const dueAt = dueDays > 0 ? addBusinessHours(new Date(now), businessDaysToHours(dueDays), holidays).toISOString() : undefined;
  const question = isApproval ? "Aprovar ou reprovar?" : node.data.outcome === "sim_nao" ? (node.data.outcomeQuestion || node.data.label) : undefined;
  const description = [
    `Etapa "${node.data.label}" do processo "${def.name}" (v${def.version}).`,
    !isApproval && node.data.description ? node.data.description : "",
    question ? `Ao concluir, responda: ${question} (Sim/Não).` : "",
    run.context.trigger.eventTitle ? `Gatilho: ${run.context.trigger.eventTitle}.` : "",
  ]
    .filter(Boolean)
    .join("\n");

  const task = await createTaskInternal(
    {
      title: isApproval ? approvalTitle(node.data.label) : node.data.label,
      description,
      clientId: client?.id,
      assigneeId: assignee.id,
      departmentId: department,
      priority: isApproval ? "alta" : node.data.priority,
      dueAt,
      checklist,
      processType: "workflow",
      processId: processTaskId(run.id, node.id),
      origin: "workflow",
      tags: ["processo", def.key],
    },
    actor,
  );

  let slaInstanceId: string | undefined;
  if (node.data.slaHours > 0) {
    const sla = await startSla({
      ruleKey: "tarefa.padrao",
      entityType: "tarefa",
      entityId: task.id,
      clientId: client?.id,
      ownerId: assignee.id,
      department,
      startedAt: now,
      resolutionHours: node.data.slaHours,
    });
    slaInstanceId = sla.id;
    await update<Task>(COLLECTIONS.tasks, task.id, { slaInstanceId: sla.id, dueAt: dueAt ?? sla.dueAt });
    await emitEvent({
      type: "sla.started",
      actor,
      clientId: client?.id,
      entity: { type: "task", id: task.id },
      title: `SLA da etapa "${node.data.label}" iniciado (${node.data.slaHours}h úteis)`,
      description: `Prazo: ${formatDateTime(sla.dueAt)}`,
      department,
      payload: { slaInstanceId: sla.id, dueAt: sla.dueAt, ownerId: assignee.id, ruleKey: sla.ruleKey, runId: run.id, nodeId: node.id },
      timeline: false,
    });
  }

  const shouldNotify = isApproval || node.data.notify;
  if (shouldNotify && assignee.id && assignee.id !== actor.id) {
    await notify({
      userIds: [assignee.id],
      kind: "acao",
      title: isApproval ? `Aprovação pendente: ${node.data.label}` : `Nova etapa com você: ${node.data.label}`,
      body: [def.name, client?.tradeName].filter(Boolean).join(" · "),
      href: `/tarefas?tarefa=${task.id}`,
      entity: { type: "task", id: task.id },
    });
  }

  history(run, node, "tarefa_criada", `Tarefa para ${assignee.name ?? "sem responsável"} (${assignee.how})${node.data.slaHours > 0 ? ` · SLA ${node.data.slaHours}h úteis` : ""}${dueAt ? ` · prazo ${formatDateTime(dueAt)}` : ""}`);
  return {
    kind: isApproval ? "aprovacao" : "tarefa",
    since: now,
    taskId: task.id,
    slaInstanceId,
    assigneeId: assignee.id,
    assigneeName: assignee.name,
    needsOutcome: nodeHasOutcome(node),
  };
}

async function enterNode(run: ProcessRun, def: ProcessDefinition, node: ProcessNode, actor: UserRef): Promise<EnterResult> {
  const nodes = nodeMap(def);
  switch (node.type) {
    case "inicio":
      return { done: true };
    case "fim":
      history(run, node, "concluido", "Fim do processo");
      return { done: true };
    case "tarefa":
    case "aprovacao": {
      delete run.context.outcomes[node.id];
      if (node.type === "tarefa" && !node.data.autoCreateTask) {
        run.pending[node.id] = { kind: "manual", since: nowIso(), needsOutcome: nodeHasOutcome(node) };
        history(run, node, "aguardando", "Etapa sem tarefa automática: concluir na tela de execuções");
        return { done: false };
      }
      run.pending[node.id] = await createNodeTask(run, def, node, actor);
      return { done: false };
    }
    case "condicao": {
      const ctx = await buildEvalContext(run);
      const result = evaluateCondition(node.data, ctx, (id) => nodes.get(id)?.data.label ?? id);
      run.context.outcomes[node.id] = result.outcome;
      history(run, node, result.outcome, result.detail);
      return { done: true, outcome: result.outcome };
    }
    case "espera": {
      if (node.data.mode === "evento" && node.data.untilEvent) {
        run.pending[node.id] = { kind: "espera_evento", since: nowIso(), untilEvent: node.data.untilEvent };
        refreshWaitingEvents(run);
        history(run, node, "aguardando", `Aguardando o evento ${node.data.untilEvent}`);
        return { done: false };
      }
      const hours = Number(node.data.businessHours) || 0;
      const waitUntil = addBusinessHours(new Date(), hours, await getHolidays()).toISOString();
      run.pending[node.id] = { kind: "espera_horas", since: nowIso(), waitUntil };
      history(run, node, "aguardando", `Espera de ${hours}h úteis, até ${formatDateTime(waitUntil)}`);
      return { done: false };
    }
    case "notificacao": {
      const client = await loadClient(run.clientId);
      const ctx = await buildEvalContext(run);
      const { ids, names, unresolved } = await resolveNotifyRecipients(node.data.to, node.data.department, client);
      if (ids.length === 0) {
        history(run, node, "ignorado", `Nenhum destinatário encontrado para ${node.data.to}`);
        return { done: true };
      }
      await notify({
        userIds: ids,
        kind: node.data.kind,
        title: renderTemplate(node.data.title, ctx),
        body: node.data.body ? renderTemplate(node.data.body, ctx) : [def.name, client?.tradeName].filter(Boolean).join(" · "),
        href: run.clientId ? `/clientes/${run.clientId}` : runHref(run),
        entity: run.entity ?? { type: "process_run", id: run.id },
      });
      history(run, node, "notificado", `Notificação para ${names.join(", ")}${unresolved.length ? ` · sem destinatário para: ${unresolved.join(", ")}` : ""}`);
      return { done: true };
    }
    case "integracao": {
      const client = await loadClient(run.clientId);
      const now = nowIso();
      const rule: AutomationRuleRecord = {
        id: `process:${def.id}`,
        organizationId: def.organizationId,
        createdAt: def.createdAt,
        updatedAt: now,
        name: `Processo ${def.name}`,
        active: true,
        runCount: 0,
        trigger: { type: "evento", eventType: run.context.trigger.eventType },
        conditions: [],
        actions: [],
      };
      const outcome = await runAction(
        { type: "webhook", params: { url: node.data.url, method: node.data.method } },
        { now, rule: { id: rule.id, name: rule.name }, payload: run.context.payload, client: client ?? undefined, entityType: run.entity?.type },
        { simulate: false, rule, actor },
      );
      history(run, node, outcome.status, outcome.detail);
      return { done: true };
    }
  }
}

/**
 * Conclui `fromNodeId` (com resultado opcional) e percorre os nós seguintes até parar em nós que esperam.
 * Muta `run`; quem chama persiste.
 */
async function proceed(run: ProcessRun, def: ProcessDefinition, fromNodeId: string, outcome: ProcessOutcome | undefined, actor: UserRef): Promise<void> {
  const nodes = nodeMap(def);
  run.currentNodeIds = run.currentNodeIds.filter((id) => id !== fromNodeId);
  delete run.pending[fromNodeId];
  refreshWaitingEvents(run);

  const queue = nextEdges(def.edges, fromNodeId, outcome).map((e) => ({ nodeId: e.target, via: e.id }));
  let steps = 0;
  while (queue.length > 0) {
    if (++steps > MAX_AUTOMATIC_STEPS) throw new Error(`Laço sem espera: mais de ${MAX_AUTOMATIC_STEPS} blocos automáticos seguidos`);
    const { nodeId, via } = queue.shift() as { nodeId: string; via: string };
    const node = nodes.get(nodeId);
    if (!node) continue;
    if (run.currentNodeIds.includes(node.id)) {
      history(run, node, "ignorado", "A etapa já está em andamento nesta execução", { via });
      continue;
    }
    history(run, node, "entrou", undefined, { via });
    const result = await enterNode(run, def, node, actor);
    if (result.done) {
      for (const e of nextEdges(def.edges, node.id, result.outcome)) queue.push({ nodeId: e.target, via: e.id });
    } else {
      run.currentNodeIds.push(node.id);
    }
  }

  if (run.currentNodeIds.length === 0 && run.status === "em_andamento") {
    run.status = "concluido";
    run.completedAt = nowIso();
    await emitProcessEvent(run, "process.completed", actor, `Processo "${run.definitionName}" concluído`, run.clientName ? `Cliente: ${run.clientName}` : undefined);
  }
}

async function failRun(run: ProcessRun, error: unknown, actor: UserRef): Promise<void> {
  const message = error instanceof Error ? error.message : String(error);
  console.error(`[process-engine] execução ${run.id}:`, error);
  run.status = "erro";
  run.error = message;
  run.history.push({ nodeId: run.currentNodeIds[0] ?? "", at: nowIso(), result: "erro", detail: message });
  await persistRun(run);
  await emitProcessEvent(run, "process.error", actor, `Erro no processo "${run.definitionName}"`, message);
}

// ---------------------------------------------------------------------------
// API do motor
// ---------------------------------------------------------------------------

export interface StartRunInput {
  clientId?: string;
  entity?: { type: string; id: string };
  payload?: Record<string, unknown>;
  event?: Pick<DomainEvent, "id" | "type" | "title">;
}

function runIdFor(def: ProcessDefinition, entity?: { type: string; id: string }): string {
  if (!entity) return `prun_${def.id}_${shortId()}${Date.now().toString(36)}`;
  return `prun_${def.id}_${entity.type}_${entity.id}`.replace(/[^A-Za-z0-9_-]/g, "_").slice(0, 700);
}

/**
 * Inicia uma execução. Idempotente por definição + entidade: o mesmo evento repetido (ou dois eventos da
 * mesma cobrança) não abre duas execuções. Devolve a execução e se foi criada agora.
 */
export async function startRun(def: ProcessDefinition, input: StartRunInput, actor: UserRef): Promise<{ run: ProcessRun; created: boolean }> {
  if (def.status !== "publicado") throw new Error("Só processos publicados podem ser executados");
  const start = def.nodes.find((n) => n.type === "inicio");
  if (!start) throw new Error("O processo não tem bloco Início");
  const client = await loadClient(input.clientId);
  const now = nowIso();
  const id = runIdFor(def, input.entity);
  const run: ProcessRun = {
    id,
    organizationId: def.organizationId,
    createdAt: now,
    updatedAt: now,
    createdBy: actor.id,
    definitionId: def.id,
    definitionKey: def.key,
    definitionName: def.name,
    version: def.version,
    clientId: client?.id,
    clientName: client?.tradeName,
    entity: input.entity,
    status: "em_andamento",
    currentNodeIds: [start.id],
    context: {
      payload: input.payload ?? {},
      outcomes: {},
      trigger: input.event ? { type: "evento", eventType: input.event.type, eventId: input.event.id, eventTitle: input.event.title } : { type: "manual" },
    },
    history: [{ nodeId: start.id, nodeLabel: start.data.label, at: now, result: "iniciado", detail: input.event ? `Gatilho: ${input.event.title}` : `Início manual por ${actor.name}`, actorId: actor.id }],
    pending: {},
    waitingEventTypes: [],
    startedAt: now,
    startedBy: actor,
  };
  const created = await createRunIfAbsent(run);
  if (!created) return { run: (await getRun(id)) ?? run, created: false };

  await emitProcessEvent(
    run,
    "process.started",
    actor,
    `Processo "${def.name}" iniciado`,
    [client ? `Cliente: ${client.tradeName}` : "", input.event ? `Gatilho: ${input.event.title}` : "Início manual"].filter(Boolean).join(" · "),
  );

  const result = await withRun(id, async (fresh) => {
    try {
      await proceed(fresh, def, start.id, undefined, actor);
      await persistRun(fresh);
    } catch (error) {
      await failRun(fresh, error, actor);
    }
    return fresh;
  });
  return { run: result ?? run, created: true };
}

/** Avança a execução concluindo um nó em andamento (com resultado Sim/Não quando o nó pede). */
export async function advance(runId: string, nodeId: string, result: ProcessOutcome | "concluido", actor: UserRef, detail?: string): Promise<ProcessRun | null> {
  return withRun(runId, async (run) => {
    if (run.status !== "em_andamento" || !run.currentNodeIds.includes(nodeId)) return run;
    const def = await getDefinition(run.definitionId);
    if (!def) throw new Error("Definição do processo não encontrada");
    const node = nodeMap(def).get(nodeId);
    if (!node) throw new Error("Etapa não encontrada no processo");
    const outcome = result === "concluido" ? run.context.outcomes[nodeId] : result;
    if (nodeHasOutcome(node) && !outcome) throw new Error("Informe o resultado (Sim ou Não) desta etapa");
    if (outcome && nodeHasOutcome(node)) run.context.outcomes[nodeId] = outcome;
    history(run, node, outcome && nodeHasOutcome(node) ? outcome : "concluido", detail, { actorId: actor.id });
    try {
      await proceed(run, def, nodeId, nodeHasOutcome(node) ? outcome : undefined, actor);
      await persistRun(run);
    } catch (error) {
      await failRun(run, error, actor);
    }
    return run;
  });
}

/** Conclusão de uma tarefa do processo (handler de task.completed). */
async function onProcessTaskCompleted(runId: string, nodeId: string, taskId: string, actor: UserRef): Promise<void> {
  const run = await getRun(runId);
  const pending = run?.pending[nodeId];
  if (!run || run.status !== "em_andamento" || !pending || pending.taskId !== taskId) return;
  if (pending.needsOutcome && !run.context.outcomes[nodeId]) {
    await withRun(runId, async (fresh) => {
      const p = fresh.pending[nodeId];
      if (!p || p.taskId !== taskId || fresh.context.outcomes[nodeId]) return;
      p.awaitingOutcome = true;
      fresh.history.push({ nodeId, nodeLabel: fresh.history.findLast((h) => h.nodeId === nodeId)?.nodeLabel, at: nowIso(), result: "aguardando_resposta", detail: `Tarefa concluída por ${actor.name} sem informar o resultado; responda na tela de execuções`, actorId: actor.id });
      await persistRun(fresh);
      if (actor.id !== PROCESS_ACTOR.id) {
        await notify({ userIds: [actor.id], kind: "acao", title: "Informe o resultado da etapa do processo", body: fresh.definitionName, href: runHref(fresh) });
      }
    });
    return;
  }
  await advance(runId, nodeId, "concluido", actor, `Tarefa concluída por ${actor.name}`);
}

/**
 * Registra a resposta Sim/Não de uma etapa (tarefa com resultado ou aprovação). Se a tarefa ainda está aberta,
 * ela é concluída (o handler de task.completed avança a execução); se já foi concluída, avança direto.
 */
export async function answerOutcome(runId: string, nodeId: string, outcome: ProcessOutcome, actor: UserRef): Promise<ProcessRun | null> {
  const run = await getRun(runId);
  if (!run) throw new Error("Execução não encontrada");
  const pending = run.pending[nodeId];
  if (run.status !== "em_andamento" || !pending) throw new Error("Esta etapa não está aguardando resposta");
  if (!pending.needsOutcome) throw new Error("Esta etapa não pede resposta Sim/Não");

  const task = pending.taskId ? await getById<Task>(COLLECTIONS.tasks, pending.taskId) : null;
  if (task && OPEN_TASK.has(task.status)) {
    await withRun(runId, async (fresh) => {
      fresh.context.outcomes[nodeId] = outcome;
      await persistRun(fresh);
    });
    await completeTaskInternal(task, actor);
    // Garante o avanço mesmo que o handler de eventos não esteja registrado neste processo.
    await onProcessTaskCompleted(runId, nodeId, task.id, actor);
    return getRun(runId);
  }
  return advance(runId, nodeId, outcome, actor, `Resposta registrada por ${actor.name}`);
}

/** Conclui uma etapa manual (sem tarefa) ou encerra uma espera antes do prazo. */
export async function completePendingNode(runId: string, nodeId: string, actor: UserRef, outcome?: ProcessOutcome): Promise<ProcessRun | null> {
  const run = await getRun(runId);
  const pending = run?.pending[nodeId];
  if (!run || !pending) throw new Error("Etapa não está em andamento");
  if (pending.kind === "tarefa" || pending.kind === "aprovacao") {
    if (pending.needsOutcome && outcome) return answerOutcome(runId, nodeId, outcome, actor);
    throw new Error("Conclua a tarefa vinculada na Central de Tarefas");
  }
  const detail = pending.kind === "manual" ? `Etapa concluída por ${actor.name}` : `Espera encerrada manualmente por ${actor.name}`;
  return advance(runId, nodeId, outcome ?? "concluido", actor, detail);
}

/** Cancela a execução e as tarefas abertas dela. */
export async function cancelRun(runId: string, actor: UserRef, reason?: string): Promise<ProcessRun | null> {
  const run = await withRun(runId, async (fresh) => {
    if (fresh.status !== "em_andamento") return fresh;
    const taskIds = Object.values(fresh.pending).flatMap((p) => (p.taskId ? [p.taskId] : []));
    fresh.status = "cancelado";
    fresh.completedAt = nowIso();
    fresh.history.push({ nodeId: fresh.currentNodeIds[0] ?? "", at: nowIso(), result: "cancelado", detail: reason ? `Cancelado por ${actor.name}: ${reason}` : `Cancelado por ${actor.name}`, actorId: actor.id });
    fresh.currentNodeIds = [];
    fresh.pending = {};
    fresh.waitingEventTypes = [];
    await persistRun(fresh);
    for (const id of taskIds) {
      const task = await getById<Task>(COLLECTIONS.tasks, id);
      if (task && OPEN_TASK.has(task.status)) await cancelTaskInternal(task, actor, `Processo "${fresh.definitionName}" cancelado`);
    }
    await emitProcessEvent(fresh, "process.cancelled", actor, `Processo "${fresh.definitionName}" cancelado`, reason);
    return fresh;
  });
  return run;
}

// ---------------------------------------------------------------------------
// Eventos e varredura
// ---------------------------------------------------------------------------

let publishedCache: { at: number; items: ProcessDefinition[] } | null = null;
const PUBLISHED_CACHE_MS = 30_000;

export function invalidateProcessDefinitionsCache(): void {
  publishedCache = null;
}

async function publishedEventDefinitions(): Promise<ProcessDefinition[]> {
  if (publishedCache && Date.now() - publishedCache.at < PUBLISHED_CACHE_MS) return publishedCache.items;
  const items = (await listDefinitions({ where: [["status", "==", "publicado"]] })).filter((d) => d.trigger.type === "evento");
  publishedCache = { at: Date.now(), items };
  return items;
}

/** Handler "*" do motor de processos (registrado por src/server/events/handlers/process-engine.ts). */
export async function handleProcessEvent(event: DomainEvent): Promise<void> {
  const kind = typeof event.payload?.kind === "string" ? event.payload.kind : "";
  if (event.type === "automation.executed" && kind.startsWith("process.")) return;
  const actor: UserRef = { id: event.actorId, name: event.actorName };

  // 1) Conclusão de tarefa de processo → avança a execução.
  if (event.type === "task.completed" && event.payload?.processType === "workflow" && event.entityId) {
    const ref = parseProcessTaskId(typeof event.payload.processId === "string" ? event.payload.processId : undefined);
    if (ref) await onProcessTaskCompleted(ref.runId, ref.nodeId, event.entityId, actor);
  }

  // 2) Gatilhos de processos publicados.
  const current = scope.getStore();
  const chain = current?.chain ?? [];
  for (const def of await publishedEventDefinitions()) {
    if (def.trigger.type !== "evento" || def.trigger.eventType !== event.type) continue;
    // Evento gerado pelo próprio processo (direta ou indiretamente) não o dispara de novo.
    if (chain.includes(def.key) || chain.length >= MAX_PROCESS_DEPTH) continue;
    try {
      await scope.run({ chain: [...chain, def.key], lockedRuns: current?.lockedRuns ?? new Set() }, () =>
        startRun(def, { clientId: event.clientId, entity: event.entityType && event.entityId ? { type: event.entityType, id: event.entityId } : undefined, payload: event.payload, event }, PROCESS_ACTOR),
      );
    } catch (error) {
      console.error(`[process-engine] gatilho ${event.type} → ${def.key}:`, error);
    }
  }

  // 3) Esperas por evento.
  const waiting = await listRuns({ where: [["waitingEventTypes", "array-contains", event.type]] });
  for (const run of waiting) {
    if (run.status !== "em_andamento") continue;
    if (run.clientId && event.clientId && run.clientId !== event.clientId) continue;
    if (run.clientId && !event.clientId) continue;
    for (const [nodeId, p] of Object.entries(run.pending)) {
      if (p.kind === "espera_evento" && p.untilEvent === event.type) await advance(run.id, nodeId, "concluido", actor, `Evento recebido: ${event.title}`);
    }
  }
}

export interface ProcessSweepResult {
  checked: number;
  advanced: number;
  errors: string[];
}

/** Libera as esperas por horas úteis vencidas. Registrar em runSweeps (ver relatório). */
export async function sweepProcessWaits(now: Date = new Date()): Promise<ProcessSweepResult> {
  const runs = await listRuns({ where: [["status", "==", "em_andamento"]] });
  const result: ProcessSweepResult = { checked: runs.length, advanced: 0, errors: [] };
  for (const run of runs) {
    for (const [nodeId, p] of Object.entries(run.pending)) {
      if (p.kind !== "espera_horas" || !p.waitUntil || p.waitUntil > now.toISOString()) continue;
      try {
        await advance(run.id, nodeId, "concluido", PROCESS_ACTOR, "Prazo da espera atingido");
        result.advanced++;
      } catch (error) {
        result.errors.push(`${run.id}/${nodeId}: ${error instanceof Error ? error.message : String(error)}`);
      }
    }
  }
  return result;
}

/**
 * Conclusão de uma tarefa de processo pedindo o resultado quando a etapa é uma decisão (Sim/Não).
 * Valida os itens obrigatórios do checklist da tarefa. Usada pela Server Action completeProcessTask.
 */
export async function completeProcessTaskInternal(task: Task, actor: UserRef, outcome?: ProcessOutcome): Promise<ProcessRun | null> {
  const ref = task.processType === "workflow" ? parseProcessTaskId(task.processId) : null;
  if (!ref) throw new Error("Esta tarefa não pertence a um processo");
  const run = await getRun(ref.runId);
  const pending = run?.pending[ref.nodeId];
  if (!run || run.status !== "em_andamento" || !pending || pending.taskId !== task.id) throw new Error("Esta etapa do processo não está mais aguardando esta tarefa");
  const missing = (task.checklist ?? []).filter((c) => c.required && !c.done);
  if (missing.length > 0) throw new Error(`Conclua os itens obrigatórios: ${missing.map((c) => c.label).join(", ")}`);
  if (pending.needsOutcome) {
    if (!outcome) throw new Error("Informe o resultado da etapa: Sim ou Não");
    return answerOutcome(run.id, ref.nodeId, outcome, actor);
  }
  await completeTaskInternal(task, actor);
  await onProcessTaskCompleted(run.id, ref.nodeId, task.id, actor);
  return getRun(run.id);
}
