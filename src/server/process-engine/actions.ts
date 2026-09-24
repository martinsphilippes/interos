"use server";
/**
 * Server Actions do construtor de processos e das execuções.
 * Padrão: sessão (requireRole/requireUser) → zod → motor/serviço → revalidação. Devolvem ActionResult.
 */
import { revalidatePath } from "next/cache";
import { z } from "zod";
import { requireRole, requireUser } from "@/server/auth/session";
import { create, getById, nowIso, update } from "@/server/db";
import { emitEvent } from "@/server/events";
import { COLLECTIONS, type ActionResult, type CurrentUser, type Task } from "@/domain/types";
import { slugifyProcessKey, validateProcessGraph, type ProcessDefinition, type ProcessNode, type ProcessEdge } from "@/domain/workflow-graph";
import {
  answerOutcomeSchema,
  cancelRunSchema,
  completeNodeSchema,
  completeProcessTaskSchema,
  createDefinitionSchema,
  definitionIdSchema,
  saveDefinitionSchema,
  simulateSchema,
  startManualRunSchema,
} from "./schemas";
import { answerOutcome, cancelRun, completePendingNode, completeProcessTaskInternal, invalidateProcessDefinitionsCache, startRun, sweepProcessWaits, type ProcessSweepResult } from "./engine";
import { simulateProcess, type SimulationResult } from "./simulate";
import { DEFINITIONS, getDefinition, getRun, listDefinitions } from "./store";

type Failure = { ok: false; error: string };

function fail(error: unknown): Failure {
  if (error instanceof z.ZodError) return { ok: false, error: error.issues.map((i) => `${i.path.join(".")}: ${i.message}`).join(" · ") };
  if (error instanceof Error && error.message) {
    console.error("[process-engine]", error);
    return { ok: false, error: error.message };
  }
  console.error("[process-engine]", error);
  return { ok: false, error: "Não foi possível concluir a operação. Tente novamente." };
}

function actorOf(user: CurrentUser) {
  return { id: user.id, name: user.name };
}

function revalidateBuilder(id?: string): void {
  revalidatePath("/admin/workflows");
  if (id) {
    revalidatePath(`/admin/workflows/processos/${id}`);
    revalidatePath(`/admin/workflows/processos/${id}/execucoes`);
  }
}

function revalidateRun(definitionId?: string, clientId?: string): void {
  revalidateBuilder(definitionId);
  revalidatePath("/tarefas");
  revalidatePath("/meu-dia");
  revalidatePath("/notificacoes");
  if (clientId) revalidatePath(`/clientes/${clientId}`);
}

// ---------------------------------------------------------------------------
// Definições (somente admin)
// ---------------------------------------------------------------------------

/** Cria um processo novo (v1, rascunho) com Início ligado a Fim. */
export async function createProcessDefinitionAction(input: unknown): Promise<ActionResult<{ id: string }>> {
  const user = await requireRole("admin");
  try {
    const data = createDefinitionSchema.parse(input);
    const existing = await listDefinitions();
    const base = slugifyProcessKey(data.name);
    let key = base;
    for (let i = 2; existing.some((d) => d.key === key); i++) key = `${base}-${i}`;
    const nodes: ProcessNode[] = [
      { id: "inicio", type: "inicio", position: { x: 0, y: 0 }, data: { label: "Início" } },
      { id: "fim", type: "fim", position: { x: 0, y: 260 }, data: { label: "Fim" } },
    ];
    const edges: ProcessEdge[] = [{ id: "e_inicio_fim", source: "inicio", target: "fim" }];
    const def = await create<ProcessDefinition>(DEFINITIONS, {
      key,
      name: data.name,
      description: data.description || undefined,
      version: 1,
      status: "rascunho",
      trigger: { type: "manual" },
      nodes,
      edges,
      createdBy: user.id,
    });
    await emitEvent({
      type: "automation.executed",
      actor: actorOf(user),
      entity: { type: "process_definition", id: def.id },
      title: `Processo "${def.name}" criado (rascunho v1)`,
      payload: { kind: "process_definition.created", definitionKey: key, version: 1 },
    });
    revalidateBuilder();
    return { ok: true, data: { id: def.id } };
  } catch (error) {
    return fail(error);
  }
}

/**
 * Salva o grafo. Rascunho: atualiza no lugar. Versão publicada (ou arquivada) é imutável: salvar cria a versão
 * seguinte em rascunho. Execuções em andamento continuam na versão em que começaram.
 */
export async function saveProcessDefinitionAction(input: unknown): Promise<ActionResult<{ id: string; version: number; created: boolean }>> {
  const user = await requireRole("admin");
  try {
    const data = saveDefinitionSchema.parse(input);
    const source = await getDefinition(data.id);
    if (!source) throw new Error("Processo não encontrado");
    const graph = { name: data.name, description: data.description || undefined, trigger: data.trigger, nodes: data.nodes as ProcessNode[], edges: data.edges };

    if (source.status === "rascunho") {
      await update<ProcessDefinition>(DEFINITIONS, source.id, graph);
      await emitEvent({
        type: "automation.executed",
        actor: actorOf(user),
        entity: { type: "process_definition", id: source.id },
        title: `Rascunho do processo "${data.name}" v${source.version} salvo`,
        payload: { kind: "process_definition.saved", definitionKey: source.key, version: source.version, nodes: graph.nodes.length },
      });
      revalidateBuilder(source.id);
      return { ok: true, data: { id: source.id, version: source.version, created: false } };
    }

    const siblings = await listDefinitions({ where: [["key", "==", source.key]] });
    const version = Math.max(0, ...siblings.map((d) => d.version)) + 1;
    const created = await create<ProcessDefinition>(DEFINITIONS, { key: source.key, version, status: "rascunho", ...graph, createdBy: user.id });
    await emitEvent({
      type: "automation.executed",
      actor: actorOf(user),
      entity: { type: "process_definition", id: created.id },
      title: `Nova versão v${version} do processo "${data.name}" criada (rascunho)`,
      payload: { kind: "process_definition.version_created", definitionKey: source.key, version, fromVersion: source.version },
    });
    revalidateBuilder(created.id);
    return { ok: true, data: { id: created.id, version, created: true } };
  } catch (error) {
    return fail(error);
  }
}

/** Publica um rascunho (valida o grafo) e arquiva a versão publicada anterior do mesmo processo. */
export async function publishProcessDefinitionAction(input: unknown): Promise<ActionResult<{ id: string; version: number }>> {
  const user = await requireRole("admin");
  try {
    const { id } = definitionIdSchema.parse(input);
    const target = await getDefinition(id);
    if (!target) throw new Error("Processo não encontrado");
    if (target.status !== "rascunho") throw new Error("Só rascunhos podem ser publicados. Salve para criar uma nova versão.");
    const issues = validateProcessGraph(target);
    if (issues.length > 0) throw new Error(`Corrija antes de publicar: ${issues.map((i) => i.message).join(" · ")}`);

    const now = nowIso();
    const siblings = await listDefinitions({ where: [["key", "==", target.key]] });
    for (const d of siblings) if (d.id !== id && d.status === "publicado") await update<ProcessDefinition>(DEFINITIONS, d.id, { status: "arquivado" });
    await update<ProcessDefinition>(DEFINITIONS, id, { status: "publicado", publishedAt: now, publishedBy: user.id });
    invalidateProcessDefinitionsCache();
    await emitEvent({
      type: "workflow.template.published",
      actor: actorOf(user),
      entity: { type: "process_definition", id },
      title: `Processo "${target.name}" v${target.version} publicado`,
      description: target.trigger.type === "evento" ? `Dispara em ${target.trigger.eventType}` : "Início manual",
      payload: { kind: "process_definition.published", definitionKey: target.key, version: target.version },
    });
    revalidateBuilder(id);
    return { ok: true, data: { id, version: target.version } };
  } catch (error) {
    return fail(error);
  }
}

/** Teste a seco do grafo atual do canvas (não precisa estar salvo) com um cliente real. Não grava nada. */
export async function simulateProcessAction(input: unknown): Promise<ActionResult<SimulationResult>> {
  await requireRole("admin");
  try {
    const { graph, clientId, answers } = simulateSchema.parse(input);
    const result = await simulateProcess({ ...graph, nodes: graph.nodes as ProcessNode[] }, clientId, answers);
    return { ok: true, data: result };
  } catch (error) {
    return fail(error);
  }
}

// ---------------------------------------------------------------------------
// Execuções
// ---------------------------------------------------------------------------

async function canActOnRun(user: CurrentUser, runId: string, nodeId: string): Promise<void> {
  if (user.isManager) return;
  const run = await getRun(runId);
  const pending = run?.pending[nodeId];
  if (pending?.assigneeId === user.id) return;
  throw new Error("Somente o responsável pela etapa ou um gestor pode responder");
}

/**
 * Conclui uma tarefa de processo informando o resultado quando a etapa é uma decisão Sim/Não.
 * INTEGRAÇÃO: o drawer de tarefas deve chamar esta ação (em vez da conclusão comum) quando a tarefa tiver
 * processType "workflow" e processId no formato "<runId>#<nodeId>", pedindo Sim/Não se a etapa exigir.
 */
export async function completeProcessTask(taskId: string, outcome?: "sim" | "nao"): Promise<ActionResult<{ runStatus?: string }>> {
  const user = await requireUser();
  try {
    const data = completeProcessTaskSchema.parse({ taskId, outcome });
    const task = await getById<Task>(COLLECTIONS.tasks, data.taskId);
    if (!task) throw new Error("Tarefa não encontrada");
    if (!user.isManager && task.assigneeId !== user.id) throw new Error("Somente o responsável ou um gestor pode concluir esta tarefa");
    const run = await completeProcessTaskInternal(task, actorOf(user), data.outcome);
    revalidateRun(run?.definitionId, task.clientId);
    return { ok: true, data: { runStatus: run?.status } };
  } catch (error) {
    return fail(error);
  }
}

/** Responde Sim/Não de uma etapa pendente (tela de execuções). */
export async function answerProcessOutcomeAction(input: unknown): Promise<ActionResult<{ runStatus?: string }>> {
  const user = await requireUser();
  try {
    const data = answerOutcomeSchema.parse(input);
    await canActOnRun(user, data.runId, data.nodeId);
    const run = await answerOutcome(data.runId, data.nodeId, data.outcome, actorOf(user));
    revalidateRun(run?.definitionId, run?.clientId);
    return { ok: true, data: { runStatus: run?.status } };
  } catch (error) {
    return fail(error);
  }
}

/** Conclui uma etapa manual ou encerra uma espera antes do prazo (gestores). */
export async function completeProcessNodeAction(input: unknown): Promise<ActionResult<{ runStatus?: string }>> {
  const user = await requireUser();
  try {
    const data = completeNodeSchema.parse(input);
    await canActOnRun(user, data.runId, data.nodeId);
    const run = await completePendingNode(data.runId, data.nodeId, actorOf(user), data.outcome);
    revalidateRun(run?.definitionId, run?.clientId);
    return { ok: true, data: { runStatus: run?.status } };
  } catch (error) {
    return fail(error);
  }
}

export async function cancelProcessRunAction(input: unknown): Promise<ActionResult> {
  const user = await requireRole("admin");
  try {
    const data = cancelRunSchema.parse(input);
    const run = await cancelRun(data.runId, actorOf(user), data.reason);
    revalidateRun(run?.definitionId, run?.clientId);
    return { ok: true, data: undefined };
  } catch (error) {
    return fail(error);
  }
}

/** Inicia manualmente a versão publicada de um processo (opcionalmente para um cliente). */
export async function startManualRunAction(input: unknown): Promise<ActionResult<{ runId: string; definitionId: string }>> {
  const user = await requireRole("admin");
  try {
    const data = startManualRunSchema.parse(input);
    const def = await getDefinition(data.definitionId);
    if (!def) throw new Error("Processo não encontrado");
    const published = def.status === "publicado" ? def : (await listDefinitions({ where: [["key", "==", def.key]] })).find((d) => d.status === "publicado");
    if (!published) throw new Error("Publique o processo antes de executá-lo");
    const { run } = await startRun(published, { clientId: data.clientId }, actorOf(user));
    revalidateRun(published.id, run.clientId);
    return { ok: true, data: { runId: run.id, definitionId: published.id } };
  } catch (error) {
    return fail(error);
  }
}

/** Libera agora as esperas por horas úteis vencidas (a varredura periódica faz o mesmo). */
export async function runProcessSweepAction(): Promise<ActionResult<ProcessSweepResult>> {
  await requireRole("admin");
  try {
    const result = await sweepProcessWaits();
    revalidateRun();
    return { ok: true, data: result };
  } catch (error) {
    return fail(error);
  }
}
