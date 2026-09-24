import "server-only";
/**
 * Leituras do construtor de processos e da tela de execuções (admin).
 */
import { getManyByIds, list } from "@/server/db";
import { computeSlaState } from "@/server/sla";
import { COLLECTIONS, type Client, type SlaInstance, type SlaView, type Task, type User } from "@/domain/types";
import type { DepartmentKey, RoleKey } from "@/domain/constants";
import { parseProcessTaskId, type ProcessDefinition, type ProcessDefinitionStatus, type ProcessRun, type ProcessRunStatus } from "@/domain/workflow-graph";
import { getDefinition, getRun, listDefinitions, listRuns } from "./store";

export interface ProcessSummary {
  key: string;
  name: string;
  description?: string;
  /** Versão mais recente (a que o construtor abre). */
  latestId: string;
  latestVersion: number;
  latestStatus: ProcessDefinitionStatus;
  publishedId?: string;
  publishedVersion?: number;
  trigger: ProcessDefinition["trigger"];
  versions: number;
  nodes: number;
  runs: Record<ProcessRunStatus, number>;
  updatedAt: string;
}

function emptyRunCounts(): Record<ProcessRunStatus, number> {
  return { em_andamento: 0, concluido: 0, cancelado: 0, erro: 0 };
}

/** Processos agrupados por chave (todas as versões), para a lista de /admin/workflows. */
export async function listProcessSummaries(): Promise<ProcessSummary[]> {
  const [defs, runs] = await Promise.all([listDefinitions(), listRuns()]);
  const byKey = new Map<string, ProcessDefinition[]>();
  for (const d of defs) byKey.set(d.key, [...(byKey.get(d.key) ?? []), d]);
  const summaries: ProcessSummary[] = [];
  for (const [key, versions] of byKey) {
    versions.sort((a, b) => b.version - a.version);
    const latest = versions[0];
    const published = versions.find((v) => v.status === "publicado");
    const counts = emptyRunCounts();
    for (const r of runs) if (r.definitionKey === key) counts[r.status]++;
    summaries.push({
      key,
      name: latest.name,
      description: latest.description,
      latestId: latest.id,
      latestVersion: latest.version,
      latestStatus: latest.status,
      publishedId: published?.id,
      publishedVersion: published?.version,
      trigger: (published ?? latest).trigger,
      versions: versions.length,
      nodes: latest.nodes.length,
      runs: counts,
      updatedAt: versions.map((v) => v.updatedAt).sort().pop() ?? latest.updatedAt,
    });
  }
  return summaries.sort((a, b) => a.name.localeCompare(b.name, "pt-BR"));
}

export interface BuilderUser {
  id: string;
  name: string;
  role: RoleKey;
  departmentId: DepartmentKey;
}

export interface VersionItem {
  id: string;
  version: number;
  status: ProcessDefinitionStatus;
  updatedAt: string;
  publishedAt?: string;
  publishedByName?: string;
}

export interface BuilderData {
  definition: ProcessDefinition;
  versions: VersionItem[];
  processes: { id: string; key: string; name: string }[];
  users: BuilderUser[];
  clients: { id: string; name: string }[];
  runCount: number;
}

export async function getBuilderData(id: string): Promise<BuilderData | null> {
  const definition = await getDefinition(id);
  if (!definition) return null;
  const [all, users, clients, runs] = await Promise.all([
    listDefinitions(),
    list<User>(COLLECTIONS.users),
    list<Client>(COLLECTIONS.clients),
    listRuns({ where: [["definitionKey", "==", definition.key]] }),
  ]);
  const names = new Map(users.map((u) => [u.id, u.name]));
  const versions = all
    .filter((d) => d.key === definition.key)
    .sort((a, b) => b.version - a.version)
    .map((d) => ({ id: d.id, version: d.version, status: d.status, updatedAt: d.updatedAt, publishedAt: d.publishedAt, publishedByName: d.publishedBy ? names.get(d.publishedBy) : undefined }));
  const latestByKey = new Map<string, ProcessDefinition>();
  for (const d of all) {
    const cur = latestByKey.get(d.key);
    if (!cur || d.version > cur.version) latestByKey.set(d.key, d);
  }
  return {
    definition,
    versions,
    processes: Array.from(latestByKey.values())
      .map((d) => ({ id: d.id, key: d.key, name: d.name }))
      .sort((a, b) => a.name.localeCompare(b.name, "pt-BR")),
    users: users
      .filter((u) => u.active !== false)
      .map((u) => ({ id: u.id, name: u.name, role: u.role, departmentId: u.departmentId }))
      .sort((a, b) => a.name.localeCompare(b.name, "pt-BR")),
    clients: clients
      .filter((c) => c.status !== "cancelado")
      .map((c) => ({ id: c.id, name: c.tradeName }))
      .sort((a, b) => a.name.localeCompare(b.name, "pt-BR")),
    runCount: runs.length,
  };
}

export interface RunTaskInfo {
  id: string;
  title: string;
  status: Task["status"];
  assigneeName?: string;
  dueAt?: string;
  sla?: SlaView;
}

export interface RunsPageData {
  definition: ProcessDefinition;
  publishedId?: string;
  runs: ProcessRun[];
  selected?: { run: ProcessRun; definition: ProcessDefinition; tasks: Record<string, RunTaskInfo> };
  clients: { id: string; name: string }[];
}

/** Execuções de um processo (todas as versões da chave) e a execução selecionada com o grafo da versão dela. */
export async function getRunsPageData(definitionId: string, runId?: string): Promise<RunsPageData | null> {
  const definition = await getDefinition(definitionId);
  if (!definition) return null;
  const [runs, siblings, clients] = await Promise.all([
    listRuns({ where: [["definitionKey", "==", definition.key]] }),
    listDefinitions({ where: [["key", "==", definition.key]] }),
    list<Client>(COLLECTIONS.clients),
  ]);
  runs.sort((a, b) => (a.status === "em_andamento" ? 0 : 1) - (b.status === "em_andamento" ? 0 : 1) || (a.startedAt < b.startedAt ? 1 : -1));
  const chosen = runs.find((r) => r.id === runId) ?? (runId ? undefined : runs[0]);

  let selected: RunsPageData["selected"];
  if (chosen) {
    const runDefinition = siblings.find((d) => d.id === chosen.definitionId) ?? definition;
    // Tarefas desta execução, abertas e concluídas (processId = "<runId>#<nodeId>").
    const workflowTasks = await list<Task>(COLLECTIONS.tasks, { where: [["processType", "==", "workflow"]] });
    const mine = workflowTasks.filter((t) => t.processId?.startsWith(`${chosen.id}#`));
    const slas = await getManyByIds<SlaInstance>(
      COLLECTIONS.slaInstances,
      mine.flatMap((t) => (t.slaInstanceId ? [t.slaInstanceId] : [])),
    );
    const tasks: Record<string, RunTaskInfo> = {};
    for (const t of mine) {
      const sla = t.slaInstanceId ? slas.get(t.slaInstanceId) : undefined;
      tasks[t.id] = { id: t.id, title: t.title, status: t.status, assigneeName: t.assigneeName, dueAt: t.dueAt, sla: sla ? computeSlaState(sla) : undefined };
    }
    selected = { run: chosen, definition: runDefinition, tasks };
  }

  return {
    definition,
    publishedId: siblings.find((d) => d.status === "publicado")?.id,
    runs,
    selected,
    clients: clients
      .filter((c) => c.status !== "cancelado")
      .map((c) => ({ id: c.id, name: c.tradeName }))
      .sort((a, b) => a.name.localeCompare(b.name, "pt-BR")),
  };
}

export interface ProcessTaskContext {
  runId: string;
  nodeId: string;
  definitionName: string;
  /** A conclusão pede Sim/Não (tarefa com resultado ou aprovação). */
  needsOutcome: boolean;
  isApproval: boolean;
  /** Pergunta a exibir ("Cliente homologou?"). */
  question?: string;
  /** Rota da execução (admin). */
  runHref: string;
}

/**
 * Contexto de processo de uma tarefa (para o drawer de tarefas pedir Sim/Não e chamar completeProcessTask).
 * Devolve null para tarefas que não são etapa pendente de um processo.
 */
export async function getProcessTaskContext(task: Pick<Task, "id" | "processType" | "processId">): Promise<ProcessTaskContext | null> {
  const ref = task.processType === "workflow" ? parseProcessTaskId(task.processId) : null;
  if (!ref) return null;
  const run = await getRun(ref.runId);
  const pending = run?.pending[ref.nodeId];
  if (!run || !pending || pending.taskId !== task.id) return null;
  const def = await getDefinition(run.definitionId);
  const node = def?.nodes.find((n) => n.id === ref.nodeId);
  return {
    runId: run.id,
    nodeId: ref.nodeId,
    definitionName: run.definitionName,
    needsOutcome: Boolean(pending.needsOutcome),
    isApproval: pending.kind === "aprovacao",
    question: node?.type === "tarefa" ? node.data.outcomeQuestion || node.data.label : node?.type === "aprovacao" ? `${node.data.label}: aprovar?` : undefined,
    runHref: `/admin/workflows/execucoes/${run.id}`,
  };
}
